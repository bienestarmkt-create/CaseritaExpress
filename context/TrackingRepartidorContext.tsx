/**
 * context/TrackingRepartidorContext.tsx
 * ─────────────────────────────────────────────────────────────
 * Transmisión GPS del repartidor — DIAGNÓSTICO (ver commit): esta
 * lógica vivía antes dentro de app/repartidor/tracking.tsx, una
 * pantalla que se desmonta al navegar a "Mis pedidos" o "Mapa" (el
 * layout usa <Slot />: solo una pantalla montada a la vez). El flujo
 * real de una entrega NUNCA pasa por "Tracking GPS" — desde
 * pedidos.tsx se va a mapa.tsx (banner "¡Entrega en curso!" y botón
 * "Ver mapa"), que tiene su PROPIO watch de posición pero nunca
 * escribía en `ubicaciones_repartidores`. Resultado: la transmisión
 * se cortaba en cuanto el repartidor salía de la pestaña Tracking —
 * que es inmediato, porque nunca hay motivo para entrar ahí durante
 * una entrega real. Cero filas nuevas en la tabla durante semanas,
 * sin ningún error visible porque nadie estaba parado en la pantalla
 * que lo mostraba.
 *
 * Fix: este mismo watch+upsert (sin cambios de lógica) ahora vive acá,
 * en un provider montado en app/repartidor/_layout.tsx — que persiste
 * mientras el repartidor esté logueado, sin importar en qué pestaña
 * esté parado. Así queda realmente "100% automático" como decía el
 * comentario original de tracking.tsx.
 * ─────────────────────────────────────────────────────────────
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import * as Location from 'expo-location'
import { supabase } from '../lib/supabase'
import { watchPositionWeb, type GeoErrorTipo, type GeoSubscription } from '../lib/geolocationWeb'

interface TrackingState {
  permisoOk:       boolean | null
  gpsError:        { tipo: GeoErrorTipo; mensaje: string } | null
  lat:             number | null
  lng:             number | null
  ultimaVez:       Date | null
  enviando:        boolean
  errorMsg:        string | null
  activo:          boolean
  pedidoId:        string | null
  pedidoEstado:    string | null
  pedidoError:     boolean
  reintentarEnvio: () => void
}

const TrackingRepartidorContext = createContext<TrackingState | null>(null)

export function TrackingRepartidorProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [pedidoId,     setPedidoId]     = useState<string | null>(null)
  const [pedidoEstado, setPedidoEstado] = useState<string | null>(null)
  const [pedidoError,  setPedidoError]  = useState(false)
  // En web no hay paso previo de "pedir permiso": expo-location en web puede
  // devolver 'denied' sin que el navegador llegue a mostrar el popup real.
  // navigator.geolocation.watchPosition() es lo que realmente lo dispara, así
  // que en web arrancamos optimistas (true) y dejamos que el propio intento
  // de watch confirme o desmienta el permiso.
  const [permisoOk,    setPermisoOk]    = useState<boolean | null>(Platform.OS === 'web' ? true : null)
  const [gpsError,     setGpsError]     = useState<{ tipo: GeoErrorTipo; mensaje: string } | null>(null)
  const [lat,          setLat]          = useState<number | null>(null)
  const [lng,          setLng]          = useState<number | null>(null)
  const [ultimaVez,    setUltimaVez]    = useState<Date | null>(null)
  const [enviando,     setEnviando]     = useState(false)
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)

  const locationSub = useRef<Location.LocationSubscription | GeoSubscription | null>(null)
  const enviarUbicacionRef = useRef<((lat: number, lng: number) => Promise<void>) | null>(null)

  const activo = permisoOk === true && !!pedidoId && pedidoEstado === 'en_camino'

  const conTimeout = <T,>(promesa: PromiseLike<T>, ms: number): Promise<T> => {
    return Promise.race([
      promesa,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms)),
    ])
  }

  // ── Pedir permiso (solo native) ────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      setPermisoOk(status === 'granted')
    })()
  }, [])

  // ── Pedido activo asignado a este repartidor ───────────────
  useEffect(() => {
    if (!userId) return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const fetchPedidoActivo = async () => {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, estado')
        .eq('repartidor_id', userId)
        .in('estado', ['confirmado', 'preparando', 'en_camino'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setPedidoError(true)
        retryTimer = setTimeout(fetchPedidoActivo, 5000)
        return
      }

      setPedidoError(false)
      setPedidoId(data?.id ?? null)
      setPedidoEstado(data?.estado ?? null)
    }

    fetchPedidoActivo()

    const channel = supabase
      .channel(`repartidor-tracking-pedido-activo-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pedidos',
        filter: `repartidor_id=eq.${userId}`,
      }, () => fetchPedidoActivo())
      .subscribe()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      supabase.removeChannel(channel)
    }
  }, [userId])

  // ── Limpiar datos mostrados cuando la transmisión se apaga ─
  useEffect(() => {
    if (!activo) {
      setLat(null)
      setLng(null)
      setUltimaVez(null)
      setErrorMsg(null)
      setGpsError(null)
    }
  }, [activo])

  // ── Watch GPS cuando activo (persiste entre pestañas) ──────
  useEffect(() => {
    if (!activo || !userId || !pedidoId) {
      enviarUbicacionRef.current = null
      locationSub.current?.remove()
      locationSub.current = null
      return
    }

    let mounted = true

    const enviarUbicacion = async (newLat: number, newLng: number) => {
      if (!mounted) return

      setLat(newLat)
      setLng(newLng)
      setEnviando(true)
      setErrorMsg(null)

      try {
        const { error } = await conTimeout(
          supabase
            .from('ubicaciones_repartidores')
            .upsert(
              { pedido_id: pedidoId, repartidor_id: userId, lat: newLat, lng: newLng, updated_at: new Date().toISOString() },
              { onConflict: 'pedido_id' }
            ),
          8000
        )

        if (error) {
          setErrorMsg(`Error al enviar: ${error.message}`)
        } else {
          setUltimaVez(new Date())
        }
      } catch {
        setErrorMsg('Tiempo de espera agotado enviando tu ubicación. Revisá tu conexión.')
      }

      if (mounted) setEnviando(false)
    }

    enviarUbicacionRef.current = enviarUbicacion

    if (Platform.OS === 'web') {
      locationSub.current = watchPositionWeb(
        ({ lat: newLat, lng: newLng }) => {
          if (!mounted) return
          setGpsError(null)
          enviarUbicacion(newLat, newLng)
        },
        (tipo, mensaje) => {
          if (!mounted) return
          setGpsError({ tipo, mensaje })
          if (tipo === 'denied') setPermisoOk(false)
        },
      )
      return () => {
        mounted = false
        enviarUbicacionRef.current = null
        locationSub.current?.remove()
        locationSub.current = null
      }
    }

    ;(async () => {
      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy:         Location.Accuracy.High,
          timeInterval:     10_000,   // 10 s
          distanceInterval: 0,        // siempre emite por tiempo
        },
        loc => enviarUbicacion(loc.coords.latitude, loc.coords.longitude)
      )
    })()

    return () => {
      mounted = false
      enviarUbicacionRef.current = null
      locationSub.current?.remove()
      locationSub.current = null
    }
  }, [activo, userId, pedidoId])

  // ── Cleanup al desmontar (logout / cierre del layout) ──────
  useEffect(() => {
    return () => {
      locationSub.current?.remove()
    }
  }, [])

  const reintentarEnvio = () => {
    if (lat != null && lng != null) enviarUbicacionRef.current?.(lat, lng)
  }

  return (
    <TrackingRepartidorContext.Provider
      value={{ permisoOk, gpsError, lat, lng, ultimaVez, enviando, errorMsg, activo, pedidoId, pedidoEstado, pedidoError, reintentarEnvio }}
    >
      {children}
    </TrackingRepartidorContext.Provider>
  )
}

export function useTrackingRepartidor() {
  const ctx = useContext(TrackingRepartidorContext)
  if (!ctx) throw new Error('useTrackingRepartidor debe usarse dentro de TrackingRepartidorProvider')
  return ctx
}
