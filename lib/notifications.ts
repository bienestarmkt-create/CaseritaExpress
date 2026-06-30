/**
 * lib/notifications.ts
 * ─────────────────────────────────────────────────────────────
 * Helper reutilizable para push notifications en CaseritaExpress.
 *
 * Estrategia dual:
 *  • Web  → usa el sistema existente (web-push + Service Worker, lib/usePush.ts)
 *  • Native → usa Expo Push API (https://exp.host/--/api/v2/push/send)
 *             Requiere expo-notifications para obtener el token.
 *             Si la librería no está instalada, todas las funciones
 *             fallan silenciosamente — NUNCA lanzan excepciones.
 *
 * Para activar push en dispositivos nativos:
 *   npx expo install expo-notifications
 *   (luego las funciones funcionarán automáticamente sin más cambios)
 *
 * REGLAS:
 *  • Nunca lanzar excepciones — try/catch en todo
 *  • Si token es null/undefined → no hacer nada
 *  • Fallar silenciosamente siempre
 * ─────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native'
import { supabase } from './supabase'
import { sendPushTo } from './usePush'

// ─── Mensajes por estado ───────────────────────────────────────
const MENSAJES: Record<string, { title: string; body: string }> = {
  asignado:  { title: 'Pedido confirmado 🛵', body: 'Tu pedido fue asignado a un repartidor'  },
  en_camino: { title: 'En camino 📦',         body: 'Tu repartidor está en camino'            },
  entregado: { title: 'Entregado ✅',          body: 'Tu pedido fue entregado exitosamente'   },
  cancelado: { title: 'Pedido cancelado ❌',   body: 'Tu pedido fue cancelado'                },
}

// ─── Obtener Expo push token en native ───────────────────────
// Usa require() dinámico en try/catch.
// Si expo-notifications no está instalado → retorna null silenciosamente.
// Cuando se ejecute `npx expo install expo-notifications` funcionará sin
// necesidad de cambios adicionales aquí.
async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications')

    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permiso denegado — no se obtendrá token')
      return null
    }

    const tokenData = await Notifications.getExpoPushTokenAsync()
    return tokenData?.data ?? null
  } catch {
    // expo-notifications no instalado o error inesperado — fallo silencioso
    return null
  }
}

// ─── 1. registerPushToken ──────────────────────────────────────
/**
 * Registra el token de push del dispositivo y lo guarda en usuarios.push_token.
 * - Native: obtiene Expo push token (requiere expo-notifications instalado).
 * - Web:    el registro web-push ya lo maneja PushInitializer en _layout.tsx,
 *           esta función retorna null sin hacer nada extra.
 * - Si el usuario deniega permisos → retorna null silenciosamente.
 * - Si algo falla → retorna null silenciosamente.
 */
export async function registerPushToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      // Web push ya está manejado por el sistema existente (lib/usePush.ts)
      return null
    }

    const token = await getExpoPushToken()
    if (!token) return null

    // Guardar en la tabla usuarios
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { error } = await supabase
      .from('usuarios')
      .update({ push_token: token })
      .eq('id', user.id)

    if (error) {
      console.log('[Notifications] Error guardando push_token:', error.message)
    } else {
      console.log('[Notifications] push_token guardado ✓')
    }

    return token
  } catch {
    return null
  }
}

// ─── 2. sendPushNotification ──────────────────────────────────
/**
 * Envía una notificación push via Expo Push API.
 * - Si pushToken es null/undefined/vacío → no hace nada.
 * - Si la request falla → falla silenciosamente.
 */
export async function sendPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string
): Promise<void> {
  if (!pushToken) return

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: {
        Accept:         'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to:     pushToken,
        title,
        body,
        sound:  'default',
        data:   { app: 'CaseritaExpress' },
      }),
    })
  } catch {
    // Red no disponible u otro error — fallo silencioso
  }
}

// ─── 3. notificarCambioEstado ─────────────────────────────────
/**
 * Notifica al cliente del pedido cuando cambia el estado.
 * 1. Busca el push_token del cliente en tabla usuarios via join con pedidos.
 * 2. Envía push via Expo Push API (native) si hay token.
 * 3. Envía web push via sendPushTo (web) usando el userId del cliente.
 * Si algo falla → falla silenciosamente.
 */
export async function notificarCambioEstado(
  pedidoId: string,
  nuevoEstado: string
): Promise<void> {
  try {
    const mensaje = MENSAJES[nuevoEstado]
    if (!mensaje) return  // Estado sin mensaje definido — no notificar

    // Obtener cliente_id y push_token del cliente del pedido
    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select('cliente_id, usuarios!cliente_id(push_token)')
      .eq('id', pedidoId)
      .single()

    if (error || !pedido) return

    const clienteId  = pedido.cliente_id as string | null
    // El join retorna un objeto o array dependiendo del esquema
    const usuarioRaw = pedido.usuarios as any
    const pushToken  = Array.isArray(usuarioRaw)
      ? usuarioRaw[0]?.push_token
      : usuarioRaw?.push_token

    // Envío nativo via Expo Push API
    await sendPushNotification(pushToken ?? null, mensaje.title, mensaje.body)

    // Envío web via web-push existente (funciona en PWA / navegador)
    if (clienteId) {
      await sendPushTo(
        clienteId,
        mensaje.title,
        mensaje.body,
        '/seguimiento',
        `pedido-estado-${pedidoId}`
      )
    }
  } catch {
    // Nunca propagar errores — fallo silencioso
  }
}
