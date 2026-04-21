// usePush — hook para push notifications web + Supabase Realtime
// Solo se activa en web (Platform.OS === 'web') y cuando hay sesión activa.

import { Platform } from 'react-native'
import { supabase } from './supabase'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

// ─── Registrar Service Worker ────────────────────────────────────────────────
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator)) return null

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    console.log('[Push] SW registrado:', reg.scope)
    return reg
  } catch (err) {
    console.error('[Push] Error registrando SW:', err)
    return null
  }
}

// ─── Suscribir al usuario a Push Notifications ──────────────────────────────
export async function subscribeToPush(): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false
  if (!('Notification' in window) || !('PushManager' in window)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    console.log('[Push] Permiso denegado')
    return false
  }

  const reg = await navigator.serviceWorker.ready

  // Obtener VAPID public key del servidor
  const keyRes = await fetch('/api/push/vapid-key')
  if (!keyRes.ok) return false
  const { publicKey } = await keyRes.json()

  let subscription: PushSubscription
  try {
    // Reusar suscripción existente o crear una nueva
    const existing = await reg.pushManager.getSubscription()
    subscription = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  } catch (err) {
    console.error('[Push] Error suscribiendo:', err)
    return false
  }

  const token = await getAccessToken()
  if (!token) return false

  const saveRes = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  })

  const ok = saveRes.ok
  if (ok) console.log('[Push] Suscripción guardada ✓')
  return ok
}

// ─── Enviar push a otro usuario via API ─────────────────────────────────────
export async function sendPushTo(
  userId: string,
  title: string,
  body: string,
  url = '/',
  tag?: string
): Promise<void> {
  if (Platform.OS !== 'web') return
  const token = await getAccessToken()
  if (!token) return

  try {
    await fetch('/api/push/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId, title, body, url, tag }),
    })
  } catch (err) {
    console.error('[Push] Error enviando push:', err)
  }
}

// ─── Listener Realtime para cambios en pedidos ───────────────────────────────
// Detecta:
//   INSERT → notifica al dueño del negocio (si está en línea la suscripción queda cubierta por webhook)
//   UPDATE → notifica al cliente cuando cambia el estado
export function setupPedidosRealtime(currentUserId: string) {
  if (Platform.OS !== 'web') return () => {}

  const channel = supabase
    .channel(`pedidos-push-${currentUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pedidos' },
      async (payload) => {
        const record = payload.new as any
        // Buscar dueño del negocio y notificar
        const { data: negocio } = await supabase
          .from('negocios')
          .select('usuario_id, nombre')
          .eq('id', record.negocio_id)
          .single()

        if (negocio?.usuario_id && negocio.usuario_id !== currentUserId) {
          await sendPushTo(
            negocio.usuario_id,
            '🆕 Nuevo pedido recibido',
            `Bs. ${record.total} · ${record.direccion_entrega || 'Sin dirección'}`,
            '/anfitrion',
            `pedido-nuevo-${record.id}`
          )
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pedidos' },
      async (payload) => {
        const record = payload.new as any
        const old = payload.old as any
        if (record.estado === old.estado) return
        if (record.cliente_id === currentUserId) return // el cliente ya verá el cambio en UI

        const statusMessages: Record<string, string> = {
          confirmado:  '✅ Tu pedido fue confirmado',
          preparando:  '👨‍🍳 Están preparando tu pedido',
          en_camino:   '🛵 ¡Tu pedido está en camino!',
          entregado:   '🎉 ¡Pedido entregado! Buen provecho',
          cancelado:   '❌ Tu pedido fue cancelado',
        }

        await sendPushTo(
          record.cliente_id,
          'CaseritaExpress',
          statusMessages[record.estado] ?? `Estado: ${record.estado}`,
          '/seguimiento',
          `pedido-estado-${record.id}`
        )
      }
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}
