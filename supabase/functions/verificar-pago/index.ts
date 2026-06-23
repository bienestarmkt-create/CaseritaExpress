// supabase/functions/verificar-pago/index.ts
// Supabase Edge Function (Deno) — verifica comprobante de pago con Claude Vision
//
// Secrets requeridos (supabase secrets set KEY=value):
//   ANTHROPIC_API_KEY  → clave de Anthropic
//   VAPID_PUBLIC_KEY   → ya configurado para push notifications
//   VAPID_PRIVATE_KEY  → ya configurado para push notifications
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son inyectados automáticamente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — npm: specifier disponible en Supabase Edge Runtime (Deno 1.30+)
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TABLA: Record<string, string> = {
  pedido: 'pedidos',
  reserva: 'reservas',
  entrada: 'entradas',
}

// ── Entry point ────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err(401, 'No token')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Autenticar usuario ────────────────────────────────────────
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    if (authErr || !user) return err(401, 'Token inválido')

    const {
      tipos,
      ids,
      comprobante_url,
      codigo_esperado,
      monto_esperado,
      mime_type = 'image/jpeg',
    } = await req.json()

    if (
      !Array.isArray(tipos) || !Array.isArray(ids) ||
      tipos.length === 0 || tipos.length !== ids.length ||
      !comprobante_url || !codigo_esperado || !monto_esperado
    ) return err(400, 'Parámetros inválidos')

    if (tipos.some((t: string) => !TABLA[t])) return err(400, 'Tipo de registro desconocido')

    // ── 1. Marcar como "verificando" ──────────────────────────────
    await updateRecords(supabase, tipos, ids, 'verificando', comprobante_url)

    // ── 2. Descargar imagen → base64 ─────────────────────────────
    const imgRes = await fetch(comprobante_url)
    if (!imgRes.ok) throw new Error(`No se pudo descargar la imagen (${imgRes.status})`)
    const imageBase64 = toBase64(await imgRes.arrayBuffer())

    // ── 3. Verificar con Claude Vision ────────────────────────────
    const resultado = await verificarConClaude(
      Deno.env.get('ANTHROPIC_API_KEY')!,
      imageBase64,
      mime_type as string,
      codigo_esperado as string,
      parseFloat(String(monto_esperado)),
    )

    const aprobado =
      resultado.transaccion_exitosa === true &&
      resultado.monto_valido === true &&
      resultado.codigo_valido === true

    // ── 4. Actualizar estado en todas las tablas afectadas ────────
    const pagoEstado = aprobado ? 'verificado' : 'rechazado'
    await updateRecords(supabase, tipos, ids, pagoEstado, comprobante_url)

    // ── 5. Push notification al cliente ───────────────────────────
    const clienteId = await getClienteId(supabase, tipos[0], ids[0])
    if (clienteId) {
      await enviarPush(supabase, clienteId, aprobado, codigo_esperado as string, ids[0])
    }

    return json({ aprobado, pago_estado: pagoEstado, resultado })

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error interno'
    console.error('[verificar-pago]', error)
    return err(500, msg)
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Procesar en chunks para evitar stack overflow con imágenes grandes
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

async function verificarConClaude(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  codigoEsperado: string,
  montoEsperado: number,
): Promise<Record<string, unknown>> {
  const prompt = `Analiza este comprobante de pago (Altoke u otra app de pagos boliviana) y extrae:
1. El monto total pagado en Bolivianos (número)
2. Un código de referencia con formato CE-XXXX-BSYYY (ej: CE-A3F2-BS150) — puede estar en el campo "concepto", "descripción" o "referencia"
3. Si la transacción fue exitosa (confirmada/completada)

VALORES ESPERADOS:
- Código: ${codigoEsperado}
- Monto mínimo: Bs. ${montoEsperado}

Responde SOLO con este JSON (sin texto adicional ni markdown):
{
  "monto_encontrado": 150.00,
  "codigo_encontrado": "${codigoEsperado}",
  "transaccion_exitosa": true,
  "monto_valido": true,
  "codigo_valido": true,
  "confianza": "alta",
  "razon_rechazo": ""
}

Reglas:
- monto_valido = true si monto_encontrado >= ${(montoEsperado * 0.99).toFixed(2)}
- codigo_valido = true si codigo_encontrado es exactamente "${codigoEsperado}"
- Si no ves el código, codigo_valido = false y codigo_encontrado = ""
- confianza: "alta" | "media" | "baja" según claridad de la imagen
- razon_rechazo: breve explicación si alguna validación falla, vacío si todo ok`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
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
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json() as { content: { text: string }[] }
  const text = data.content[0].text.trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Claude no devolvió JSON válido. Respuesta: ${text.slice(0, 100)}`)
  return JSON.parse(match[0]) as Record<string, unknown>
}

async function updateRecords(
  supabase: ReturnType<typeof createClient>,
  tipos: string[],
  ids: string[],
  pagoEstado: string,
  comprobanteUrl: string,
) {
  const estadoNuevo = pagoEstado === 'verificado' ? 'confirmado' : undefined
  await Promise.all(
    tipos.map((tipo, i) => {
      const tabla = TABLA[tipo]
      if (!tabla) return Promise.resolve()
      const patch: Record<string, string> = { pago_estado: pagoEstado, comprobante_url: comprobanteUrl }
      if (estadoNuevo) patch.estado = estadoNuevo
      return supabase.from(tabla).update(patch).eq('id', ids[i])
    }),
  )
}

async function getClienteId(
  supabase: ReturnType<typeof createClient>,
  tipo: string,
  id: string,
): Promise<string | null> {
  const tabla = TABLA[tipo]
  if (!tabla) return null
  const { data } = await supabase.from(tabla).select('cliente_id').eq('id', id).single()
  return (data as { cliente_id: string } | null)?.cliente_id ?? null
}

async function enviarPush(
  supabase: ReturnType<typeof createClient>,
  clienteId: string,
  aprobado: boolean,
  codigo: string,
  pedidoId: string,
) {
  try {
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!vapidPublic || !vapidPrivate) return

    const { data } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', clienteId)
      .single()

    if (!(data as { subscription: unknown } | null)?.subscription) return

    webpush.setVapidDetails('mailto:hola@caseritaexpress.com', vapidPublic, vapidPrivate)

    const payload = aprobado
      ? { title: '✅ Pago verificado', body: `Tu pedido ${codigo} fue confirmado. ¡Gracias!`, url: '/seguimiento', tag: `pago-ok-${pedidoId}` }
      : { title: '❌ Comprobante rechazado', body: 'El monto o código no coinciden. Sube el comprobante nuevamente.', url: '/pago', tag: `pago-fail-${pedidoId}` }

    await webpush.sendNotification(
      (data as { subscription: unknown }).subscription,
      JSON.stringify(payload),
    )
  } catch (e) {
    // Push es best-effort: no interrumpir el flujo principal si falla
    console.warn('[verificar-pago] push notification falló:', e)
  }
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
