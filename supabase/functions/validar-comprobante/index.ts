// supabase/functions/validar-comprobante/index.ts — v16
// Valida comprobante de pago ALTOKE con Claude Vision — multi-tabla:
// pedidos (delivery), reservas (stay), entradas (evento).
// Invocado desde app/pago-qr.tsx via supabase.functions.invoke()
//
// v16 — antifraude: un cliente subió un comprobante bancario de OTRA
// fecha (mismo monto exacto, Bs. 9.00) para un pedido de hoy. La
// unicidad de numero_transaccion (único chequeo de duplicados de v15)
// no lo detectó porque ese comprobante nunca se había usado en la
// plataforma. v16 agrega: hash SHA-256 del archivo (comprobantes_usados,
// unicidad GLOBAL), validación de la referencia que el cliente declaró
// al subir el comprobante, y "frescura" — la fecha implícita en el
// propio numero_transaccion no puede diferir de la del pedido.
// Cada chequeo nuevo se puede apagar individualmente vía config_validacion
// (ver supabase/migrations/20260811100000_antifraude_v16.sql).
//
// Contrato de respuesta: se mantiene { valido, motivo, boleto } (lo que
// lee app/pago-qr.tsx hoy, que en este deploy NO se toca) y se le suman
// { ok, codigo } para consumo futuro/backend. Los códigos que pide la
// tarea (COMPROBANTE_REUTILIZADO, REFERENCIA_NO_COINCIDE,
// MONTO_INSUFICIENTE, TRANSACCION_DUPLICADA) se devuelven con status
// HTTP 200, no 409/400: supabase-js trata cualquier status no-2xx como
// FunctionsHttpError y pago-qr.tsx solo ve fnError.message genérico (no
// el JSON), perdiendo el motivo real. v15 ya usaba 200 para todo
// resultado de negocio y reservaba los status de error para fallos de
// sistema/auth — v16 sigue el mismo patrón para no romper la UI actual.
//
// Secrets requeridos:
//   ANTHROPIC_API_KEY
//   CUENTA_DESTINO_VALIDA — número de cuenta BancoSol al que debe llegar el pago
//
// Si el pago es válido, llama a la función de base de datos
// confirmar_pago_y_emitir_boleto(): confirma el pago, emite el boleto Y
// registra el comprobante en comprobantes_usados en una sola transacción
// atómica — si algo falla, nada de eso queda hecho (ver
// supabase/migrations/20260811100000_antifraude_v16.sql).
//
// Actualización: la llamada a Claude Vision ahora tiene timeout (20s) y,
// ante timeout o cualquier error de la API de Vision, ya NO deja el
// registro "pendiente sin resolver" (que era el comportamiento anterior:
// se devolvía error 500 sin tocar estado_validacion) — ahora escribe
// estado_validacion='revision' con codigo VISION_NO_DISPONIBLE, igual que
// cualquier otro chequeo que no se pudo ejecutar (nunca aprobación por
// defecto). También se agregó el chequeo de cuenta_destino/titular_destino
// normalizado (flag check_cuenta_destino, ver
// supabase/migrations/20260811130000_antifraude_v16_cuenta_destino_flag.sql
// — default FALSE, implementado pero desactivado a propósito).

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
// total real registrado en la base. Bs. 0.50 en cada dirección — ver
// chequeo MONTO más abajo (ya no es un rechazo simétrico como en v15).
const TOLERANCIA_MONTO = 0.50

// Timeout de la llamada a Claude Vision. No existía antes (fetch sin
// límite, a merced del timeout de plataforma de la Edge Function).
const VISION_TIMEOUT_MS = 20_000

// Cuenta y titular "reales" de la tarea — chequeo nuevo, gateado por
// check_cuenta_destino (default false). Distinto del chequeo legacy de
// más abajo, que compara contra el secret CUENTA_DESTINO_VALIDA y NO
// verifica titular.
const CUENTA_DESTINO_ESPERADA = '4013271000001'
const APELLIDOS_TITULAR_ESPERADO = ['OCAMPO', 'YUCRA']

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

    const { tipo, id, comprobante_url, referencia_declarada } = await req.json() as {
      tipo?: string; id?: string; comprobante_url?: string; referencia_declarada?: string
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

    // Flags de config_validacion — una sola consulta, cada chequeo abajo
    // lee su propia clave de este mapa antes de ejecutarse.
    const flags = await cargarFlags(supabase)

    // El cliente manda el path de storage, pero las tablas guardan la URL
    // pública — normalizamos para que el chequeo de duplicados matchee.
    const { data: urlData } = supabase.storage
      .from('comprobantes')
      .getPublicUrl(comprobante_url)
    const comprobanteUrlPublica = urlData.publicUrl

    // ── Duplicado por URL exacta (legacy v15, se mantiene además del
    // hash — cambio aditivo, no reemplaza protección existente) ──
    const dupUrl = await buscarDuplicadoEnTodas(supabase, 'comprobante_url', comprobanteUrlPublica, id)
    if (dupUrl) {
      return json({ valido: false, ok: false, codigo: 'COMPROBANTE_REUTILIZADO', motivo: 'Este comprobante ya fue usado para confirmar otro pago' })
    }

    // ── Descargar el archivo (hace falta para MIME y para el hash) ──
    const filePath = comprobante_url as string
    console.log('Descargando imagen desde path:', filePath)

    const { data: fileData, error: downloadErr } = await supabase.storage
      .from('comprobantes')
      .download(filePath)

    if (downloadErr || !fileData) {
      console.error('Error descargando imagen:', downloadErr?.message)
      return json({ valido: false, ok: false, codigo: 'COMPROBANTE_NO_DISPONIBLE', motivo: 'No se pudo obtener el comprobante del almacenamiento' })
    }

    const arrayBuffer = await fileData.arrayBuffer()

    // ── 1. MIME por magic bytes — misma lógica de v15, sin cambios ──
    const mimeType = detectarMimeType(new Uint8Array(arrayBuffer))
    const mimeOk = true // detectarMimeType siempre devuelve un tipo válido (fallback jpeg)

    const detalle: ValidacionDetalle = {
      hash: null,
      mime_ok: mimeOk,
      referencia_declarada: referencia_declarada?.trim() || null,
      referencia_esperada: (registro.codigo_referencia as string | null) ?? null,
      numero_transaccion: null,
      numero_no_parseado: null,
      fecha_parseada: null,
      fecha_pedido: null,
      monto_comprobante: null,
      monto_esperado: totalEsperado,
      resultado_por_chequeo: {},
      flags_activos: flags,
      timestamp: new Date().toISOString(),
    }

    // ── 2. HASH (flag check_hash) ──────────────────────────────────
    const hashArchivo = await calcularHashSha256(arrayBuffer)
    detalle.hash = hashArchivo

    if (flags.check_hash) {
      const { data: hashDup, error: hashErr } = await supabase
        .from('comprobantes_usados')
        .select('id')
        .eq('hash_archivo', hashArchivo)
        .maybeSingle()

      if (hashErr) throw new Error(`Error chequeando hash duplicado: ${hashErr.message}`)

      if (hashDup) {
        // No tocamos la tabla transaccional en este caso puntual (spec
        // explícita) — el mismo archivo ya confirmó otro pago, no hay
        // nada nuevo que auditar en ESTE registro.
        return json({ valido: false, ok: false, codigo: 'COMPROBANTE_REUTILIZADO', motivo: 'Este comprobante ya fue utilizado' })
      }
      detalle.resultado_por_chequeo.hash = 'ok'
    } else {
      detalle.resultado_por_chequeo.hash = 'omitido_por_config'
    }

    // Pasaron los dedup "gratis" (URL + hash) — recién ahora gastamos un
    // intento y guardamos la URL, igual que hacía v15 en este punto.
    const { error: intentoErr } = await supabase
      .from(tabla)
      .update({ intentos_validacion: (registro.intentos_validacion ?? 0) + 1 })
      .eq('id', id)

    if (intentoErr) {
      console.error('Error incrementando intentos_validacion', tabla, id, intentoErr.message)
      return err(500, 'No se pudo registrar el intento: ' + intentoErr.message)
    }

    await supabase.from(tabla).update({ comprobante_url: comprobanteUrlPublica }).eq('id', id)

    // ── 3. REFERENCIA (flag check_referencia) ───────────────────────
    // cortocircuita (rechazo duro) solo si AMBOS valores existen y no
    // coinciden. Los otros dos casos son revisión manual, no rechazo.
    const revisionFlags: string[] = []
    const codigoReferencia = (registro.codigo_referencia as string | null) ?? null
    const referenciaDeclarada = referencia_declarada?.trim() || null

    if (!flags.check_referencia) {
      detalle.resultado_por_chequeo.referencia = 'omitido_por_config'
    } else if (codigoReferencia === null) {
      // Registro creado antes de este deploy — el cliente nunca vio la
      // instrucción de escribir una referencia. Excepción temporal:
      // NO rechazar, solo marcar para revisión manual.
      detalle.resultado_por_chequeo.referencia = 'omitido_pre_deploy'
      revisionFlags.push('referencia_pre_deploy')
    } else if (!referenciaDeclarada) {
      // El frontend que pide este campo se despliega en Deploy B — hasta
      // entonces no rechazamos por ausencia, solo marcamos revisión.
      detalle.resultado_por_chequeo.referencia = 'declarada_vacia'
      revisionFlags.push('referencia_vacia')
    } else if (referenciaDeclarada.toLowerCase() !== codigoReferencia.trim().toLowerCase()) {
      detalle.resultado_por_chequeo.referencia = 'no_coincide'
      await escribirAuditoria(supabase, tabla, id, 'rechazado', detalle)
      return json({ valido: false, ok: false, codigo: 'REFERENCIA_NO_COINCIDE', motivo: 'El código de referencia no coincide con tu pedido' })
    } else {
      detalle.resultado_por_chequeo.referencia = 'ok'
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return err(500, 'ANTHROPIC_API_KEY no configurada en secrets')

    const cuentaDestinoValida = Deno.env.get('CUENTA_DESTINO_VALIDA')
    if (!cuentaDestinoValida) return err(500, 'CUENTA_DESTINO_VALIDA no configurada en secrets')

    const imageBase64 = toBase64(arrayBuffer)

    console.log('Llamando Claude Vision...')
    const visionStart = Date.now()
    let resultado: Record<string, unknown>
    try {
      resultado = await verificarConClaude(apiKey, imageBase64, mimeType, totalEsperado, VISION_TIMEOUT_MS)
    } catch (visionErr) {
      // Antes: sin timeout, y un error acá se propagaba al catch general →
      // 500 sin tocar estado_validacion (quedaba "pendiente" sin resolver,
      // el cliente veía un error genérico y podía reintentar indefinidamente).
      // Ahora: nunca aprobación por defecto, pero tampoco lo dejamos sin
      // resolver — va a revisión manual con motivo explícito.
      const e = visionErr instanceof Error ? visionErr : new Error(String(visionErr))
      const duracionMs = Date.now() - visionStart
      const esTimeout = e.name === 'AbortError'
      console.error(`Vision ${esTimeout ? 'timeout' : 'error'} tras ${duracionMs}ms:`, e.message)
      detalle.resultado_por_chequeo.vision = esTimeout ? 'timeout' : 'error'
      await escribirAuditoria(supabase, tabla, id, 'revision', detalle)
      return json({
        valido: false, ok: false, codigo: 'VISION_NO_DISPONIBLE',
        motivo: 'No pudimos verificar tu comprobante automáticamente. Quedó en revisión manual, te confirmaremos en breve.',
      })
    }
    console.log(`Vision respondió en ${Date.now() - visionStart}ms:`, JSON.stringify(resultado))

    const numeroTransaccion = typeof resultado.numero_transaccion === 'string'
      ? resultado.numero_transaccion.trim() || null
      : null
    const cuentaDestino = typeof resultado.cuenta_destino === 'string'
      ? resultado.cuenta_destino.trim()
      : null
    const titularDestino = typeof resultado.titular_destino === 'string'
      ? resultado.titular_destino.trim() || null
      : null
    const montoDetectado = typeof resultado.monto_detectado === 'number'
      ? resultado.monto_detectado
      : null

    detalle.numero_transaccion = numeroTransaccion
    detalle.monto_comprobante = montoDetectado

    // ── Chequeos de validez de v15 (no están en la lista numerada de la
    // tarea, pero son protecciones existentes — se mantienen sin cambios,
    // "todo cambio aditivo"). Rechazo duro en los tres casos. ──
    if (!resultado.es_comprobante) {
      const motivo = (resultado.motivo_rechazo as string | null) ?? 'Comprobante no válido'
      await escribirAuditoria(supabase, tabla, id, 'rechazado', detalle)
      return json({ valido: false, ok: false, codigo: 'COMPROBANTE_INVALIDO', motivo })
    }
    if (!numeroTransaccion) {
      await escribirAuditoria(supabase, tabla, id, 'rechazado', detalle)
      return json({ valido: false, ok: false, codigo: 'COMPROBANTE_ILEGIBLE', motivo: 'Comprobante ilegible, subí una captura más nítida' })
    }
    if (cuentaDestino !== cuentaDestinoValida) {
      await escribirAuditoria(supabase, tabla, id, 'rechazado', detalle)
      return json({ valido: false, ok: false, codigo: 'CUENTA_DESTINO_INVALIDA', motivo: 'La cuenta destino del comprobante no coincide con la cuenta de CaseritaExpress' })
    }

    // ── Cuenta destino / titular — chequeo NUEVO normalizado (flag
    // check_cuenta_destino, default false). El chequeo legacy de arriba ya
    // rechaza en duro por número de cuenta contra el secret
    // CUENTA_DESTINO_VALIDA; este agrega verificación de TITULAR (que el
    // legacy no hace) contra valores fijos de esta tarea. Se registra
    // siempre en validacion_detalle, esté o no el flag activo — así se
    // puede ver qué habría pasado antes de activarlo.
    detalle.cuenta_destino_extraida = cuentaDestino
    detalle.titular_destino_extraido = titularDestino

    const cuentaCoincide = cuentaDestino !== null
      && normalizarCuenta(cuentaDestino) === normalizarCuenta(CUENTA_DESTINO_ESPERADA)
    const titularCoincide = coincideTitular(titularDestino, APELLIDOS_TITULAR_ESPERADO)

    if (cuentaDestino === null || titularDestino === null) {
      detalle.resultado_por_chequeo.cuenta_destino_titular = 'no_extraible'
      if (flags.check_cuenta_destino) revisionFlags.push('cuenta_destino_distinta')
    } else if (!cuentaCoincide || !titularCoincide) {
      detalle.resultado_por_chequeo.cuenta_destino_titular = 'no_coincide'
      if (flags.check_cuenta_destino) revisionFlags.push('cuenta_destino_distinta')
    } else {
      detalle.resultado_por_chequeo.cuenta_destino_titular = 'coincide'
    }

    if (montoDetectado === null) {
      // No se pudo leer el monto — chequeo que no se pudo ejecutar:
      // revisión manual, nunca aprobación por defecto.
      detalle.resultado_por_chequeo.monto = 'ilegible'
      revisionFlags.push('monto_ilegible')
    }

    // ── 4. FRESCURA (flag check_frescura) ────────────────────────────
    if (!flags.check_frescura) {
      detalle.resultado_por_chequeo.frescura = 'omitido_por_config'
    } else {
      const match = numeroTransaccion.match(/^\d{6}(\d{2})(\d{2})\d+$/)
      const mes = match ? Number(match[1]) : null
      const dia = match ? Number(match[2]) : null
      const patronValido = match !== null && mes !== null && dia !== null && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31

      if (!patronValido) {
        // No matchea (u otro banco emisor con otro formato) — nunca
        // aprobar por defecto. Se guarda el número completo para poder
        // ampliar el patrón más adelante.
        detalle.numero_no_parseado = numeroTransaccion
        detalle.resultado_por_chequeo.frescura = 'no_parseado'
        revisionFlags.push('frescura_no_parseado')
      } else {
        const fechaPedido = fechaEnLaPaz(registro.created_at as string)
        const diffDias = diasDeDiferencia(mes!, dia!, fechaPedido)
        detalle.fecha_parseada = `${String(mes).padStart(2, '0')}/${String(dia).padStart(2, '0')}`
        detalle.fecha_pedido = `${String(fechaPedido.month).padStart(2, '0')}/${String(fechaPedido.day).padStart(2, '0')}/${fechaPedido.year}`

        if (diffDias > 1) {
          detalle.resultado_por_chequeo.frescura = 'revision'
          revisionFlags.push('frescura_vieja')
        } else {
          detalle.resultado_por_chequeo.frescura = 'ok'
        }
      }
    }

    // ── 5. MONTO — asimétrico (flag check_monto_asimetrico) ─────────
    // Reemplaza el ±0.50 simétrico de v15. Usa registro.total tal cual
    // viene de la tabla (ya incluye tarifa_envio_qr cuando aplica — ver
    // lib/totales.ts / app/carrito.tsx, no se recalcula acá).
    if (montoDetectado !== null) {
      if (!flags.check_monto_asimetrico) {
        detalle.resultado_por_chequeo.monto = 'omitido_por_config'
      } else if (montoDetectado < totalEsperado - TOLERANCIA_MONTO) {
        detalle.resultado_por_chequeo.monto = 'insuficiente'
        await escribirAuditoria(supabase, tabla, id, 'rechazado', detalle)
        return json({
          valido: false, ok: false, codigo: 'MONTO_INSUFICIENTE',
          motivo: `Pagaste Bs. ${montoDetectado.toFixed(2)}, el total es Bs. ${totalEsperado.toFixed(2)}`,
        })
      } else if (montoDetectado > totalEsperado + TOLERANCIA_MONTO) {
        // Pagó de más — no bloqueamos ni confirmamos automáticamente.
        detalle.resultado_por_chequeo.monto = 'revision'
        revisionFlags.push('monto_excedente')
      } else {
        detalle.resultado_por_chequeo.monto = 'ok'
      }
    }

    // ── 6. UNICIDAD de numero_transaccion — GLOBAL contra
    // comprobantes_usados (las tres tablas), ya no contra la tabla del
    // módulo con comprobante_validado=true como hacía v15. ──
    const { data: txDup, error: txDupErr } = await supabase
      .from('comprobantes_usados')
      .select('id')
      .eq('numero_transaccion', numeroTransaccion)
      .maybeSingle()

    if (txDupErr) throw new Error(`Error chequeando numero_transaccion duplicado: ${txDupErr.message}`)

    if (txDup) {
      detalle.resultado_por_chequeo.unicidad = 'duplicada'
      await escribirAuditoria(supabase, tabla, id, 'rechazado', detalle)
      return json({ valido: false, ok: false, codigo: 'TRANSACCION_DUPLICADA', motivo: 'Este comprobante ya fue utilizado' })
    }
    detalle.resultado_por_chequeo.unicidad = 'ok'

    // ── Si algún chequeo quedó en revisión, no aprobamos ni rechazamos:
    // queda pendiente de revisión manual. Si hay un solo motivo, el
    // `codigo` de respuesta es el específico de ese motivo (p. ej.
    // CUENTA_DESTINO_DISTINTA); con varios motivos a la vez, el genérico
    // EN_REVISION — el detalle completo siempre queda en
    // validacion_detalle.resultado_por_chequeo, sea cual sea el codigo. ──
    if (revisionFlags.length > 0) {
      await escribirAuditoria(supabase, tabla, id, 'revision', detalle)
      const codigo = revisionFlags.length === 1
        ? (CODIGO_POR_REVISION[revisionFlags[0]] ?? 'EN_REVISION')
        : 'EN_REVISION'
      return json({
        valido: false, ok: false, codigo,
        motivo: 'Tu comprobante quedó en revisión manual, te confirmaremos en breve.',
      })
    }

    // ── 7. APROBACIÓN — confirmar pago + emitir boleto + registrar en
    // comprobantes_usados, todo atómico dentro de la función de DB. Si
    // esto falla, NO devolvemos valido:true. ──
    detalle.resultado_por_chequeo.final = 'aprobado'
    let boleto: unknown = null
    const { data: boletoCreado, error: rpcErr } = await supabase.rpc(
      'confirmar_pago_y_emitir_boleto',
      {
        p_tipo: tipoValido,
        p_id: id,
        p_numero_transaccion: numeroTransaccion,
        p_datos_snapshot: construirSnapshot(tipoValido, registro),
        p_hash_archivo: hashArchivo,
        p_validacion_detalle: detalle,
      },
    )

    if (rpcErr) {
      console.error('Error confirmando pago / emitiendo boleto', tabla, id, rpcErr.message)
      // Índice único de hash o numero_transaccion saltó por una carrera
      // entre dos requests casi simultáneos validando la misma transacción.
      if (rpcErr.code === '23505') {
        return json({ valido: false, ok: false, codigo: 'TRANSACCION_DUPLICADA', motivo: 'Este comprobante ya fue utilizado' })
      }
      return err(500, 'Comprobante válido pero no se pudo confirmar: ' + rpcErr.message)
    }
    boleto = boletoCreado

    return json({ valido: true, ok: true, codigo: 'APROBADO', motivo: null, boleto })

  } catch (error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error))
    console.error('ERROR DETALLADO:', e.message, e.stack)
    return err(500, e.message)
  }
})

// ── Helpers ──────────────────────────────────────────────────────────

type ValidacionDetalle = {
  hash: string | null
  mime_ok: boolean
  referencia_declarada: string | null
  referencia_esperada: string | null
  numero_transaccion: string | null
  numero_no_parseado: string | null
  fecha_parseada: string | null
  fecha_pedido: string | null
  monto_comprobante: number | null
  monto_esperado: number
  cuenta_destino_extraida?: string | null
  titular_destino_extraido?: string | null
  resultado_por_chequeo: Record<string, string>
  flags_activos: Record<string, boolean>
  timestamp: string
}

type RegistroBase = {
  intentos_validacion: number | null
  total: number
  cliente_id: string
  codigo_referencia: string | null
  created_at: string
  [key: string]: unknown
}

async function cargarFlags(supabase: ReturnType<typeof createClient>): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('config_validacion').select('clave, valor')
  if (error) throw new Error(`Error leyendo config_validacion: ${error.message}`)
  const flags: Record<string, boolean> = {
    check_hash: true,
    check_referencia: true,
    check_frescura: true,
    check_monto_asimetrico: true,
    check_cuenta_destino: false,
  }
  for (const row of (data ?? []) as { clave: string; valor: boolean }[]) {
    flags[row.clave] = row.valor
  }
  return flags
}

// Mapea el motivo interno de revisión al `codigo` público de la respuesta
// cuando es el único motivo activo (ver uso más abajo).
const CODIGO_POR_REVISION: Record<string, string> = {
  referencia_pre_deploy: 'REFERENCIA_PENDIENTE',
  referencia_vacia: 'REFERENCIA_PENDIENTE',
  frescura_no_parseado: 'FECHA_NO_VERIFICADA',
  frescura_vieja: 'FECHA_NO_VERIFICADA',
  monto_ilegible: 'MONTO_NO_LEGIBLE',
  monto_excedente: 'MONTO_EXCEDENTE',
  cuenta_destino_distinta: 'CUENTA_DESTINO_DISTINTA',
}

// Normaliza un número de cuenta para comparar: sin espacios/guiones,
// insensible a mayúsculas.
function normalizarCuenta(s: string | null): string | null {
  if (!s) return null
  return s.replace(/[\s-]/g, '').toLowerCase()
}

// Coincidencia parcial de apellidos — el banco emisor puede truncar el
// nombre del titular en el comprobante.
function coincideTitular(titular: string | null, apellidos: string[]): boolean {
  if (!titular) return false
  const normalizado = titular
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return apellidos.some(ap => normalizado.includes(ap))
}

async function escribirAuditoria(
  supabase: ReturnType<typeof createClient>,
  tabla: string,
  id: string,
  estadoValidacion: 'rechazado' | 'revision',
  detalle: ValidacionDetalle,
): Promise<void> {
  const { error } = await supabase
    .from(tabla)
    .update({ estado_validacion: estadoValidacion, validacion_detalle: detalle })
    .eq('id', id)
  if (error) {
    // No abortamos la respuesta al cliente por un fallo de auditoría,
    // pero sí lo logueamos fuerte: sin esto no queda rastro del motivo.
    console.error('Error escribiendo validacion_detalle', tabla, id, error.message)
  }
}

async function calcularHashSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Fecha calendario (año/mes/día) de un timestamp en zona America/La_Paz.
function fechaEnLaPaz(iso: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

// Menor diferencia en días entre MM/DD (sin año, tomado del número de
// transacción) y la fecha del pedido — prueba el año del pedido y los
// adyacentes para cubrir el borde de fin de año sin complicar de más.
function diasDeDiferencia(mesTx: number, diaTx: number, fechaPedido: { year: number; month: number; day: number }): number {
  const pedidoEpoch = Date.UTC(fechaPedido.year, fechaPedido.month - 1, fechaPedido.day)
  let minDiff = Infinity
  for (const yearOffset of [-1, 0, 1]) {
    const candidatoEpoch = Date.UTC(fechaPedido.year + yearOffset, mesTx - 1, diaTx)
    const diff = Math.abs(candidatoEpoch - pedidoEpoch) / 86_400_000
    if (diff < minDiff) minDiff = diff
  }
  return minDiff
}

async function obtenerRegistro(
  supabase: ReturnType<typeof createClient>,
  tipo: Tipo,
  id: string,
): Promise<{ data: RegistroBase | null; error: { message: string } | null }> {
  if (tipo === 'delivery') {
    return await supabase
      .from('pedidos')
      .select('intentos_validacion, total, cliente_id, codigo_referencia, created_at, direccion_entrega, negocio_id, negocios(nombre)')
      .eq('id', id)
      .single() as any
  }
  if (tipo === 'stay') {
    return await supabase
      .from('reservas')
      .select('intentos_validacion, total, cliente_id, codigo_referencia, created_at, fecha_entrada, fecha_salida, noches, alojamiento_id, alojamientos(nombre, tipo)')
      .eq('id', id)
      .single() as any
  }
  return await supabase
    .from('entradas')
    .select('intentos_validacion, total, cliente_id, codigo_referencia, created_at, cantidad, evento_id, eventos(nombre, fecha_evento, lugar)')
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
// de transacciones — un mismo comprobante (por URL) no puede confirmar
// dos pagos, sea cual sea el módulo. Legacy de v15, se mantiene como
// capa extra junto al hash SHA-256 (que es el chequeo autoritativo).
async function buscarDuplicadoEnTodas(
  supabase: ReturnType<typeof createClient>,
  campo: 'comprobante_url',
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
  timeoutMs: number,
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

  // Antes no había timeout acá — un fetch colgado quedaba a merced del
  // límite de la plataforma de la Edge Function. AbortController fuerza
  // el corte a los timeoutMs indicados (ver VISION_TIMEOUT_MS).
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
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
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

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
