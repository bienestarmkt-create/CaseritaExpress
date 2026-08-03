// lib/geolocationWeb.ts
// GPS en navegador vía la API nativa del browser (navigator.geolocation),
// en vez de expo-location — expo-location en web puede resolver a
// 'denied' sin disparar nunca el popup de permiso del navegador.
// navigator.geolocation.watchPosition() SÍ dispara ese popup: el permiso
// se pide implícitamente al invocarla, no con un paso previo separado.

export type GeoErrorTipo = 'denied' | 'unavailable' | 'timeout'

export type GeoSubscription = { remove: () => void }

const MENSAJES: Record<GeoErrorTipo, string> = {
  denied:      'Permiso de ubicación denegado en el navegador.',
  unavailable: 'No se pudo determinar tu ubicación (sin señal de GPS).',
  timeout:     'Se agotó el tiempo esperando la ubicación.',
}

export function watchPositionWeb(
  onPosition: (coords: { lat: number; lng: number }) => void,
  onError: (tipo: GeoErrorTipo, mensaje: string) => void,
): GeoSubscription {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError('unavailable', 'Este navegador no soporta geolocalización.')
    return { remove: () => {} }
  }

  const watchId = navigator.geolocation.watchPosition(
    pos => {
      onPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    },
    err => {
      let tipo: GeoErrorTipo = 'unavailable'
      if (err.code === err.PERMISSION_DENIED)      tipo = 'denied'
      else if (err.code === err.POSITION_UNAVAILABLE) tipo = 'unavailable'
      else if (err.code === err.TIMEOUT)              tipo = 'timeout'
      onError(tipo, MENSAJES[tipo])
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
  )

  return { remove: () => navigator.geolocation.clearWatch(watchId) }
}

// Captura puntual (no watch) — para flujos de "un solo tiro" como marcar el
// destino en carrito.tsx. Igual que watchPositionWeb, usa navigator.geolocation
// directo (no expo-location) porque es lo único que dispara el popup real del
// navegador. Resuelve null en cualquier falla (denegado, sin señal, timeout)
// en vez de rechazar — el llamador solo necesita distinguir "hay coords" de
// "no hay coords", no el motivo puntual.
export function getCurrentPositionWeb(timeoutMs = 5000): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }

    let done = false
    const finish = (v: { lat: number; lng: number } | null) => {
      if (done) return
      done = true
      resolve(v)
    }

    navigator.geolocation.getCurrentPosition(
      pos => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 },
    )

    // Respaldo: algunos navegadores no honran bien su propio `timeout`.
    setTimeout(() => finish(null), timeoutMs + 500)
  })
}
