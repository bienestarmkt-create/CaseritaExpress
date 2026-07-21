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
