// Recibe Supabase Database Webhooks para la tabla `pedidos`
// Configurar en Supabase Dashboard > Database > Webhooks:
//   Table: pedidos | Events: INSERT, UPDATE
//   URL: https://www.caseritaexpress.com/api/push/webhook
//   HTTP Header: x-webhook-secret: <SUPABASE_WEBHOOK_SECRET>

const webpush = require('web-push')
const { createClient } = require('@supabase/supabase-js')

const STATUS_MESSAGES = {
  confirmado:  '✅ Tu pedido fue confirmado por el negocio',
  preparando:  '👨‍🍳 El negocio está preparando tu pedido',
  en_camino:   '🛵 ¡Tu pedido está en camino!',
  entregado:   '🎉 ¡Pedido entregado! Buen provecho',
  cancelado:   '❌ Tu pedido fue cancelado',
}

function initWebPush() {
  webpush.setVapidDetails(
    'mailto:hola@caseritaexpress.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

async function sendPushToUser(supabase, userId, payload) {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single()

  if (!data?.subscription) return

  try {
    await webpush.sendNotification(data.subscription, JSON.stringify(payload))
  } catch (err) {
    if (err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId)
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Validar secreto del webhook
  const secret = req.headers['x-webhook-secret']
  if (secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  initWebPush()

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { type, record, old_record } = req.body

  if (type === 'INSERT') {
    // Nuevo pedido → notificar al dueño del negocio
    const { data: negocio } = await supabase
      .from('negocios')
      .select('usuario_id, nombre')
      .eq('id', record.negocio_id)
      .single()

    if (negocio?.usuario_id) {
      await sendPushToUser(supabase, negocio.usuario_id, {
        title: '🆕 Nuevo pedido recibido',
        body: `Bs. ${record.total} • ${record.direccion_entrega || 'Sin dirección'}`,
        url: '/anfitrion',
        tag: `pedido-nuevo-${record.id}`,
      })
    }
  } else if (type === 'UPDATE') {
    const estadoCambio = record.estado !== old_record?.estado
    if (!estadoCambio) return res.status(200).json({ ok: true, skipped: true })

    // Estado cambió → notificar al cliente
    const body = STATUS_MESSAGES[record.estado] || `Estado actualizado: ${record.estado}`

    await sendPushToUser(supabase, record.cliente_id, {
      title: 'CaseritaExpress',
      body,
      url: '/seguimiento',
      tag: `pedido-estado-${record.id}`,
    })
  }

  return res.status(200).json({ ok: true })
}
