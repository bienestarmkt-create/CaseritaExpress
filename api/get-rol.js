// api/get-rol.js
// Devuelve el rol del usuario autenticado usando service_role (bypasea RLS).
// Headers: Authorization: Bearer <supabase-jwt>
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers['authorization'] ?? '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Verificar el JWT obteniendo el usuario
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  // Leer rol con service_role (no importa la política RLS)
  const { data, error } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (error && error.code === 'PGRST116') {
    // Usuario no existe en la tabla — insertarlo como cliente
    await supabase.from('usuarios').insert({ id: user.id, email: user.email, rol: 'cliente' });
    return res.json({ rol: 'cliente', inserted: true });
  }

  if (error) return res.status(500).json({ error: error.message, code: error.code });

  return res.json({ rol: data?.rol ?? 'cliente' });
};
