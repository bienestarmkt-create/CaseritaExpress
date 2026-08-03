// supabase/functions/notificar-pedido/index.ts
// Recibe un Database Webhook de Supabase (INSERT/UPDATE en tabla `pedidos`)
// y envía una notificación a Telegram.
//
// Payload esperado (formato estándar de Supabase Database Webhooks):
//   { type: 'INSERT' | 'UPDATE' | 'DELETE', table, schema, record, old_record }
//
// Columnas usadas de pedidos: id, negocio_id, total, estado, entrega_sospechosa
// Columnas usadas de negocios: nombre
//
// Secrets requeridos (supabase secrets set KEY=value):
//   TELEGRAM_BOT_TOKEN → token del bot de Telegram
//   TELEGRAM_CHAT_ID   → chat ID donde se envían las notificaciones
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son inyectados automáticamente.
//
// Esta función debe deployarse con --no-verify-jwt (ver instrucciones de deploy)
// porque los Database Webhooks de Supabase no envían un JWT de usuario.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Pedido = {
  id: string
  negocio_id: string | null
  total: number | null
  estado: string | null
  entrega_sospechosa: boolean | null
}

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: Pedido | null
  old_record: Pedido | null
}

const MENSAJES_ESTADO: Record<string, string> = {
  confirmado: 'pagado y confirmado',
  en_camino: 'en camino',
  entregado: 'entregado',
}

const EMOJI_ESTADO: Record<string, string> = {
  confirmado: '✅',
  en_camino: '🛵',
  entregado: '📦',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const payload = await req.json() as WebhookPayload
    const { type, table, record, old_record } = payload

    if (table !== 'pedidos') {
      return json({ skipped: true, motivo: `tabla ignorada: ${table}` })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (type === 'INSERT' && record) {
      const nombreNegocio = await getNombreNegocio(supabase, record.negocio_id)
      const total = Number(record.total ?? 0).toFixed(2)
      const mensaje = `🆕 Nuevo pedido #${record.id} — Bs. ${total} — ${nombreNegocio}`

      await enviarTelegram(mensaje)
      return json({ ok: true, mensaje })

    } else if (type === 'UPDATE' && record) {
      // Un mismo UPDATE puede traer más de un hecho notificable a la vez
      // (p. ej. estado -> 'entregado' Y entrega_sospechosa -> true en el
      // mismo update de app/repartidor/mapa.tsx), así que se acumulan y
      // se manda un mensaje de Telegram por cada uno.
      const mensajes: string[] = []

      const estadoAnterior = old_record?.estado
      const estadoNuevo = record.estado
      if (estadoAnterior !== estadoNuevo && estadoNuevo && estadoNuevo in MENSAJES_ESTADO) {
        mensajes.push(`${EMOJI_ESTADO[estadoNuevo]} Pedido #${record.id} ${MENSAJES_ESTADO[estadoNuevo]}`)
      }

      // Bandera de auditoría (ver app/repartidor/mapa.tsx): GPS del
      // repartidor a más de 200m del destino al marcar entregado. No
      // bloquea nada — solo avisa para revisión manual.
      if (record.entrega_sospechosa && !old_record?.entrega_sospechosa) {
        mensajes.push(`🚩 Pedido #${record.id} entregado a más de 200m del destino registrado — revisar en el panel admin`)
      }

      if (mensajes.length === 0) {
        return json({ skipped: true, motivo: 'sin cambios notificables' })
      }

      for (const m of mensajes) await enviarTelegram(m)
      return json({ ok: true, mensajes })

    } else {
      return json({ skipped: true, motivo: `tipo de evento ignorado: ${type}` })
    }

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error interno'
    console.error('[notificar-pedido]', error)
    return err(500, msg)
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getNombreNegocio(
  supabase: ReturnType<typeof createClient>,
  negocioId: string | null,
): Promise<string> {
  if (!negocioId) throw new Error('Pedido sin negocio_id')

  const { data, error } = await supabase
    .from('negocios')
    .select('nombre')
    .eq('id', negocioId)
    .single()

  if (error || !data) {
    throw new Error(`No se pudo obtener el negocio ${negocioId}: ${error?.message}`)
  }

  return (data as { nombre: string }).nombre
}

async function enviarTelegram(texto: string): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')

  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados en secrets')
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[notificar-pedido] Telegram API error', res.status, body)
    throw new Error(`Telegram API ${res.status}: ${body}`)
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
