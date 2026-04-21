const webpush = require('web-push')
const { createClient } = require('@supabase/supabase-js')

function initWebPush() {
  webpush.setVapidDetails(
    'mailto:hola@caseritaexpress.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

async function sendPushToUser(supabase, userId, payload) {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single()

  if (error || !data) return { sent: false, reason: 'no_subscription' }

  try {
    await webpush.sendNotification(data.subscription, JSON.stringify(payload))
    return { sent: true }
  } catch (err) {
    if (err.statusCode === 410) {
      // Suscripción expirada: eliminar
      await supabase.from('push_subscriptions').delete().eq('user_id', userId)
    }
    return { sent: false, reason: err.message }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  // Auth: JWT de usuario autenticado
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No token' })

  initWebPush()

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { userId, title, body, url = '/', tag } = req.body
  if (!userId || !title || !body) return res.status(400).json({ error: 'Missing fields' })

  const result = await sendPushToUser(supabase, userId, { title, body, url, tag })
  return res.status(200).json(result)
}
