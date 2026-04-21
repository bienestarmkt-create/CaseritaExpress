// CaseritaExpress — Service Worker para Push Notifications

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()))

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const {
    title = 'CaseritaExpress',
    body = '',
    url = '/',
    icon = '/assets/images/favicon.png',
    tag = 'caserita',
  } = data

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/assets/images/favicon.png',
      tag,
      renotify: true,
      data: { url },
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ('focus' in client) {
            client.focus()
            if ('navigate' in client) client.navigate(url)
            return
          }
        }
        if (clients.openWindow) return clients.openWindow(url)
      })
  )
})
