// supabase/functions/validar-comprobante/index.ts
// Valida comprobante de pago ALTOKE con Claude Vision.
// Invocado desde app/pago-qr.tsx via supabase.functions.invoke()
//
// Secrets requeridos:
//   ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

    const { pedidoId, comprobante_url, total_esperado } = await req.json()

    if (!pedidoId || !comprobante_url || total_esperado == null) {
      return err(400, 'Parámetros incompletos: pedidoId, comprobante_url, total_esperado requeridos')
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return err(500, 'ANTHROPIC_API_KEY no configurada en secrets')

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
    console.log('Imagen descargada, tamaño:', arrayBuffer.byteLength)

    const imageBase64 = toBase64(arrayBuffer)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

    console.log('Llamando Claude Vision...')
    const resultado = await verificarConClaude(
      apiKey,
      imageBase64,
      mimeType,
      parseFloat(String(total_esperado)),
    )
    console.log('Respuesta Claude:', JSON.stringify(resultado))

    const valido = Boolean(resultado.es_comprobante && resultado.monto_correcto)
    return json({
      valido,
      motivo: valido ? null : (resultado.motivo_rechazo ?? 'Comprobante no válido'),
    })

  } catch (error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error))
    console.error('ERROR DETALLADO:', e.message, e.stack)
    return err(500, e.message)
  }
})

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
  "monto_correcto": boolean,
  "motivo_rechazo": string | null
}

Reglas:
- es_comprobante: true si es pantalla real de confirmación de transferencia bancaria boliviana (BancoSol ALTOKE, Mercantil Santa Cruz, BNB, Banco Union, Tigo Money u otro banco boliviano)
- monto_detectado: número exacto que aparece en el comprobante
- monto_correcto: true si monto_detectado está entre ${totalEsperado - 1} y ${totalEsperado + 1}
- motivo_rechazo: null si aprobado. Si rechazado: razón específica (ej: "El monto Bs. 1 no coincide con Bs. ${totalEsperado} requerido", "La imagen no es un comprobante bancario")`

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
