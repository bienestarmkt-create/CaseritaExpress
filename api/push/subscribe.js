const { createClient } = require('@supabase/supabase-js')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  // Validate JWT
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No token' })

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { subscription } = req.body
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' })

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: user.id, subscription, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
