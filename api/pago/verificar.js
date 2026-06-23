// api/pago/verificar.js
// Vercel serverless function: verifica comprobante de pago con Claude Vision
// POST { tipos[], ids[], comprobante_url, codigo_esperado, monto_esperado, mime_type? }

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const TABLA = { pedido: 'pedidos', reserva: 'reservas', entrada: 'entradas' };

function initSupabase() {
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function initWebPush() {
  webpush.setVapidDetails(
    'mailto:hola@caseritaexpress.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function getImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

async function verifyWithClaude(imageBase64, mimeType, codigoEsperado, montoEsperado) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Analiza este comprobante de pago (captura de pantalla de Altoke, banca móvil u otra app de pagos) y extrae la siguiente información.

BUSCA:
1. El monto total pagado en Bolivianos (solo el número)
2. Un código de referencia con formato CE-XXXX-BSYYY (ej: CE-A3F2-BS150) — puede estar en el campo "concepto", "descripción" o "referencia"
3. Si la transacción fue exitosa (verde, confirmada, completada) o fallida

VALORES ESPERADOS:
- Código de referencia: ${codigoEsperado}
- Monto mínimo: Bs. ${montoEsperado}

Responde ÚNICAMENTE con este JSON (sin texto adicional, sin markdown):
{
  "monto_encontrado": 150.00,
  "codigo_encontrado": "${codigoEsperado}",
  "transaccion_exitosa": true,
  "monto_valido": true,
  "codigo_valido": true,
  "confianza": "alta",
  "razon_rechazo": ""
}

Reglas de validación:
- monto_valido = true si monto_encontrado >= ${(parseFloat(montoEsperado) * 0.99).toFixed(2)}
- codigo_valido = true si codigo_encontrado coincide exactamente con "${codigoEsperado}" (sensible a mayúsculas)
- Si no encuentras el código en la imagen, codigo_valido = false y codigo_encontrado = ""
- confianza: "alta" si la imagen es clara, "media" si hay dudas, "baja" si apenas se puede leer
- razon_rechazo: texto breve explicando por qué rechazas (vacío si aprobado)`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude no devolvió JSON válido');
  return JSON.parse(jsonMatch[0]);
}

async function updateRecords(supabase, tipos, ids, pagoEstado, comprobanteUrl) {
  const estadoNuevo = pagoEstado === 'verificado' ? 'confirmado' : undefined;
  const updates = tipos.map((tipo, i) => {
    const tabla = TABLA[tipo];
    if (!tabla) return Promise.resolve();
    const patch = { pago_estado: pagoEstado, comprobante_url: comprobanteUrl };
    if (estadoNuevo) patch.estado = estadoNuevo;
    return supabase.from(tabla).update(patch).eq('id', ids[i]);
  });
  await Promise.all(updates);
}

async function getClienteId(supabase, tipo, id) {
  const tabla = TABLA[tipo];
  if (!tabla) return null;
  const { data } = await supabase.from(tabla).select('cliente_id').eq('id', id).single();
  return data?.cliente_id ?? null;
}

async function sendPushToUser(supabase, userId, payload) {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single();
  if (!data?.subscription) return;
  try {
    await webpush.sendNotification(data.subscription, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    }
    console.warn('[verificar] push failed:', err.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const supabase = initSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

  const {
    tipos,
    ids,
    comprobante_url,
    codigo_esperado,
    monto_esperado,
    mime_type = 'image/jpeg',
  } = req.body;

  if (
    !Array.isArray(tipos) || !Array.isArray(ids) ||
    tipos.length === 0 || tipos.length !== ids.length ||
    !comprobante_url || !codigo_esperado || !monto_esperado
  ) {
    return res.status(400).json({ error: 'Parámetros inválidos' });
  }

  // Validar tipos conocidos
  const tiposValidos = ['pedido', 'reserva', 'entrada'];
  if (tipos.some(t => !tiposValidos.includes(t))) {
    return res.status(400).json({ error: 'Tipo de registro desconocido' });
  }

  // Marcar todos como "verificando"
  await updateRecords(supabase, tipos, ids, 'verificando', comprobante_url);

  try {
    const imageBase64 = await getImageAsBase64(comprobante_url);
    const resultado = await verifyWithClaude(imageBase64, mime_type, codigo_esperado, monto_esperado);

    const aprobado =
      resultado.transaccion_exitosa === true &&
      resultado.monto_valido === true &&
      resultado.codigo_valido === true;

    const pagoEstado = aprobado ? 'verificado' : 'rechazado';
    await updateRecords(supabase, tipos, ids, pagoEstado, comprobante_url);

    // Push notification al cliente
    const clienteId = await getClienteId(supabase, tipos[0], ids[0]);
    if (clienteId) {
      initWebPush();
      const pushPayload = aprobado
        ? {
            title: '✅ Pago verificado',
            body: `Tu pedido (${codigo_esperado}) ha sido confirmado. ¡Gracias!`,
            url: '/seguimiento',
            tag: `pago-ok-${ids[0]}`,
          }
        : {
            title: '❌ Comprobante rechazado',
            body: resultado.razon_rechazo || 'El monto o código no coinciden. Intenta de nuevo.',
            url: '/pago',
            tag: `pago-fail-${ids[0]}`,
          };
      await sendPushToUser(supabase, clienteId, pushPayload);
    }

    return res.status(200).json({ aprobado, pago_estado: pagoEstado, resultado });

  } catch (err) {
    console.error('[verificar] Error:', err);
    await updateRecords(supabase, tipos, ids, 'rechazado', comprobante_url);
    return res.status(500).json({ error: 'Error al verificar comprobante', detalle: err.message });
  }
};
