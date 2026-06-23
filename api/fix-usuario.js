// api/fix-usuario.js — endpoint temporal para upsert de usuario con rol específico
// POST { userId, rol, secret }
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { userId, rol, secret } = req.body ?? {};
  if (secret !== process.env.FIX_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!userId || !rol) return res.status(400).json({ error: 'userId and rol required' });

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: existing } = await supabase.from('usuarios').select('id, rol').eq('id', userId).single();

  if (!existing) {
    const { error } = await supabase.from('usuarios').insert({ id: userId, rol });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ action: 'inserted', rol });
  }

  const { error } = await supabase.from('usuarios').update({ rol }).eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ action: 'updated', previousRol: existing.rol, rol });
};
