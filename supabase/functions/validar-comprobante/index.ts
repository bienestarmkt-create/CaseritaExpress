// supabase/functions/validar-comprobante/index.ts
// Valida comprobante de pago ALTOKE con Claude Vision — multi-tabla:
// pedidos (delivery), reservas (stay), entradas (evento).
// Invocado desde app/pago-qr.tsx via supabase.functions.invoke()
//
// Secrets requeridos:
//   ANTHROPIC_API_KEY
//   CUENTA_DESTINO_VALIDA — número de cuenta BancoSol al que debe llegar el pago
//
// Si el pago es válido, llama a la función de base de datos
// confirmar_pago_y_emitir_boleto(): confirma el pago Y emite el boleto en
// una sola transacción atómica — si algo falla, ninguno de los dos queda
// hecho (ver supabase/migrations/20260804000100_tabla_boletos.sql).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Tipo = 'delivery' | 'stay' | 'evento'

const TABLA_POR_TIPO: Record<Tipo, string> = {
  delivery: 'pedidos',
  stay:     'reservas',
  evento:   'entradas',
}

// Tolerancia máxima entre el monto que Claude lee en el comprobante y el
// total real registrado en la base. Bs. 0.50, no un rango más laxo.
const TOLERANCIA_MONTO = 0.50

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err(401, 'No token')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    if (authErr || !user) return err(401, 'Token inválido')

    const { tipo, id, comprobante_url } = await req.json() as {
      tipo?: string; id?: string; comprobante_url?: string
    }

    if (!tipo || !id || !comprobante_url) {
      return err(400, 'Parámetros incompletos: tipo, id, comprobante_url requeridos')
    }
    if (!(tipo in TABLA_POR_TIPO)) {
      return err(400, `tipo inválido: "${tipo}" — debe ser delivery, stay o evento`)
    }

    const tipoValido = tipo as Tipo
    const tabla = TABLA_POR_TIPO[tipoValido]

    // ── Obtener el registro real: dueño + monto + datos para el boleto ──
    // Nunca confiar en lo que manda el cliente para el monto.
    const { data: registro, error: fetchErr } = await obtenerRegistro(supabase, tipoValido, id)

    if (fetchErr || !registro) {
      console.error(`Error leyendo ${tabla}`, id, fetchErr?.message)
      return err(404, `${tipoValido} no encontrado: ${id}`)
    }

    if (registro.cliente_id !== user.id) {
      return err(403, 'No autorizado: esta transacción no te pertenece')
    }

    const totalEsperado = Number(registro.total)
    if (!totalEsperado || totalEsperado <= 0) {
      return err(500, 'La transacción no tiene un total válido registrado')
    }

    // El cliente manda el path de storage, pero las tablas guardan la URL
    // pública — normalizamos para que el chequeo de duplicados matchee.
    const { data: urlData } = supabase.storage
      .from('comprobantes')
      .getPublicUrl(comprobante_url)
    const comprobanteUrlPublica = urlData.publicUrl

    // ── Rechazar comprobante reutilizado (cruza las 3 tablas) ──
    const dupUrl = await buscarDuplicadoEnTodas(supabase, 'comprobante_url', comprobanteUrlPublica, id)
    if (dupUrl) {
      return json({ valido: false, motivo: 'Este comprobante ya fue usado para confirmar otro pago' })
    }

    const { error: intentoErr } = await supabase
      .from(tabla)
      .update({ intentos_validacion: (registro.intentos_validacion ?? 0) + 1 })
      .eq('id', id)

    if (intentoErr) {
      console.error('Error incrementando intentos_validacion', tabla, id, intentoErr.message)
      return err(500, 'No se pudo registrar el intento: ' + intentoErr.message)
    }

    // También persistimos comprobante_url en la tabla de origen ahora
    // (antes lo hacía app/pago-qr.tsx solo para pedidos) — necesario para
    // que el chequeo de duplicados de arriba encuentre coincidencias en
    // el próximo intento, sea cual sea el tipo.
    await supabase.from(tabla).update({ comprobante_url: comprobanteUrlPublica }).eq('id', id)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return err(500, 'ANTHROPIC_API_KEY no configurada en secrets')

    const cuentaDestinoValida = Deno.env.get('CUENTA_DESTINO_VALIDA')
    if (!cuentaDestinoValida) return err(500, 'CUENTA_DESTINO_VALIDA no configurada en secrets')

    const filePath = comprobante_url as string
    console.log('Descargando imagen desde path:', filePath)

    const { data: fileData, error: downloadErr } = await supabase.storage
      .from('comprobantes')
      .download(filePath)

    if (downloadErr || !fileData) {
      console.error('Error descargando imagen:', downloadErr?.message)
      return json({ valido: false, motivo: 'No se pudo obtener el comprobante del almacenamiento' })
    }

    const arrayBuffer = await fileData.arrayBuffer()
    const imageBase64 = toBase64(arrayBuffer)
    const mimeType = detectarMimeType(new Uint8Array(arrayBuffer))

    console.log('Llamando Claude Vision...')
    const resultado = await verificarConClaude(apiKey, imageBase64, mimeType, totalEsperado)
    console.log('Respuesta Claude:', JSON.stringify(resultado))

    const numeroTransaccion = typeof resultado.numero_transaccion === 'string'
      ? resultado.numero_transaccion.trim() || null
      : null
    const cuentaDestino = typeof resultado.cuenta_destino === 'string'
      ? resultado.cuenta_destino.trim()
      : null
    const montoDetectado = typeof resultado.monto_detectado === 'number'
      ? resultado.monto_detectado
      : null

    let valido = Boolean(resultado.es_comprobante)
    let motivo: string | null = valido
      ? null
      : ((resultado.motivo_rechazo as string | null) ?? 'Comprobante no válido')

    if (valido && !numeroTransaccion) {
      valido = false
      motivo = 'Comprobante ilegible, subí una captura más nítida'
    }

    if (valido && cuentaDestino !== cuentaDestinoValida) {
      valido = false
      motivo = 'La cuenta destino del comprobante no coincide con la cuenta de CaseritaExpress'
    }

    // ── Validación de monto EXACTA, calculada acá (no delegada al
    // juicio de Claude): tolerancia máxima Bs. 0.50, motivo con las
    // cifras reales para que el cliente entienda qué pasó. ──
    if (valido) {
      if (montoDetectado === null) {
        valido = false
        motivo = 'No pudimos leer el monto del comprobante, subí una foto más nítida'
      } else if (Math.abs(montoDetectado - totalEsperado) > TOLERANCIA_MONTO) {
        valido = false
        motivo = `Pagaste Bs. ${montoDetectado.toFixed(2)}, el total es Bs. ${totalEsperado.toFixed(2)}`
      }
    }

    // ── Rechazar transacción bancaria reutilizada (cruza las 3 tablas) ──
    if (valido) {
      const dupTx = await buscarDuplicadoEnTodas(supabase, 'numero_transaccion', numeroTransaccion!, id)
      if (dupTx) {
        valido = false
        motivo = 'Este comprobante ya fue utilizado'
      }
    }

    // ── Confirmar pago + emitir boleto, atómico ────────────────────
    // Si esto falla, NO devolvemos valido:true — el cliente vería
    // "aprobado" sin que la transacción quede realmente confirmada.
    let boleto: unknown = null
    if (valido) {
      const { data: boletoCreado, error: rpcErr } = await supabase.rpc(
        'confirmar_pago_y_emitir_boleto',
        {
          p_tipo: tipoValido,
          p_id: id,
          p_numero_transaccion: numeroTransaccion,
          p_datos_snapshot: construirSnapshot(tipoValido, registro),
        },
      )

      if (rpcErr) {
        console.error('Error confirmando pago / emitiendo boleto', tabla, id, rpcErr.message)
        // Índice único de numero_transaccion saltó por una carrera entre
        // dos requests casi simultáneos validando la misma transacción.
        if (rpcErr.code === '23505') {
          return json({ valido: false, motivo: 'Este comprobante ya fue utilizado' })
        }
        return err(500, 'Comprobante válido pero no se pudo confirmar: ' + rpcErr.message)
      }
      boleto = boletoCreado
    }

    return json({ valido, motivo, boleto })

  } catch (error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error))
    console.error('ERROR DETALLADO:', e.message, e.stack)
    return err(500, e.message)
  }
})

// ── Helpers ──────────────────────────────────────────────────────────

type RegistroBase = {
  intentos_validacion: number | null
  total: number
  cliente_id: string
  [key: string]: unknown
}

async function obtenerRegistro(
  supabase: ReturnType<typeof createClient>,
  tipo: Tipo,
  id: string,
): Promise<{ data: RegistroBase | null; error: { message: string } | null }> {
  if (tipo === 'delivery') {
    return await supabase
      .from('pedidos')
      .select('intentos_validacion, total, cliente_id, direccion_entrega, negocio_id, negocios(nombre)')
      .eq('id', id)
      .single() as any
  }
  if (tipo === 'stay') {
    return await supabase
      .from('reservas')
      .select('intentos_validacion, total, cliente_id, fecha_entrada, fecha_salida, noches, alojamiento_id, alojamientos(nombre, tipo)')
      .eq('id', id)
      .single() as any
  }
  return await supabase
    .from('entradas')
    .select('intentos_validacion, total, cliente_id, cantidad, evento_id, eventos(nombre, fecha_evento, lugar)')
    .eq('id', id)
    .single() as any
}

// Datos que la vista "Mis boletos" necesita mostrar, sin depender de más
// queries — quedan congelados al momento de la emisión (si el evento
// cambia de lugar después, el boleto ya emitido sigue mostrando lo que
// era cierto cuando se pagó).
function construirSnapshot(tipo: Tipo, registro: RegistroBase): Record<string, unknown> {
  if (tipo === 'delivery') {
    return {
      direccion_entrega: registro.direccion_entrega ?? null,
      negocio: (registro.negocios as any)?.nombre ?? null,
    }
  }
  if (tipo === 'stay') {
    return {
      alojamiento:    (registro.alojamientos as any)?.nombre ?? null,
      tipo_habitacion:(registro.alojamientos as any)?.tipo ?? null,
      check_in:       registro.fecha_entrada ?? null,
      check_out:      registro.fecha_salida ?? null,
      noches:         registro.noches ?? null,
    }
  }
  return {
    evento:       (registro.eventos as any)?.nombre ?? null,
    fecha_evento: (registro.eventos as any)?.fecha_evento ?? null,
    lugar:        (registro.eventos as any)?.lugar ?? null,
    cantidad:     registro.cantidad ?? null,
  }
}

// Busca `campo = valor` con comprobante_validado = true en las 3 tablas
// de transacciones — un mismo comprobante o número de transacción no
// puede confirmar dos pagos, sea cual sea el módulo.
async function buscarDuplicadoEnTodas(
  supabase: ReturnType<typeof createClient>,
  campo: 'comprobante_url' | 'numero_transaccion',
  valor: string,
  idActual: string,
): Promise<{ tabla: string; id: string } | null> {
  for (const tabla of Object.values(TABLA_POR_TIPO)) {
    const { data, error } = await supabase
      .from(tabla)
      .select('id')
      .eq(campo, valor)
      .neq('id', idActual)
      .eq('comprobante_validado', true)
      .maybeSingle()

    if (error) {
      throw new Error(`Error chequeando ${campo} duplicado en ${tabla}: ${error.message}`)
    }
    if (data) return { tabla, id: data.id as string }
  }
  return null
}

function detectarMimeType(bytes: Uint8Array): string {
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  // WEBP: "RIFF" ... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  // JPEG: FF D8 FF (y fallback si no matchea ningún magic byte conocido)
  return 'image/jpeg'
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

async function verificarConClaude(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  totalEsperado: number,
): Promise<Record<string, unknown>> {
  const prompt = `Analiza este comprobante de transferencia bancaria boliviana.

Responde SOLO JSON sin texto extra:
{
  "es_comprobante": boolean,
  "monto_detectado": number | null,
  "numero_transaccion": string | null,
  "cuenta_destino": string | null,
  "titular_destino": string | null,
  "motivo_rechazo": string | null
}

Reglas:
- es_comprobante: true si es pantalla real de confirmación de transferencia bancaria boliviana (BancoSol ALTOKE, Mercantil Santa Cruz, BNB, Banco Union, Tigo Money u otro banco boliviano)
- monto_detectado: número exacto que aparece en el comprobante, sin redondear. null si no se puede leer con certeza (la validación del monto la hace el backend, no vos — no marques es_comprobante:false por el monto, solo si la imagen NO es un comprobante bancario real)
- numero_transaccion: el número que aparece como "Transacción N°" (o equivalente: N° de operación, N° de comprobante, referencia). Copialo tal cual aparece en la imagen. null si no se puede leer con certeza.
- cuenta_destino: el número de cuenta destino de la transferencia, tal cual aparece en la imagen. null si no se puede leer con certeza.
- titular_destino: nombre del titular de la cuenta destino, si aparece en la imagen. null si no aparece.
- motivo_rechazo: null si es_comprobante es true. Si es false: razón específica (ej: "La imagen no es un comprobante bancario", "La imagen está borrosa y no se puede verificar")`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json() as { content: { text: string }[] }
  const text = data.content[0].text.trim()
  console.log('Respuesta Claude raw:', text.slice(0, 200))
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Claude no devolvió JSON válido: ${text.slice(0, 100)}`)
  return JSON.parse(match[0]) as Record<string, unknown>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
