/**
 * app/repartidor/tracking.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Repartidor — Tracking GPS
 *
 * - Transmisión de ubicación 100% automática: se activa sola en
 *   cuanto el repartidor tiene un pedido asignado en estado
 *   'en_camino', y se detiene sola si deja de estarlo. El switch
 *   en pantalla es solo un indicador visual, no un control manual.
 * - GPS continuo cada 10 s con expo-location.
 * - Upsert en tabla ubicaciones_repartidores (conflict: pedido_id).
 * - Escucha cambios de pedido en tiempo real (Realtime) para
 *   detectar la transición a 'en_camino' sin recargar la pantalla.
 * - Muestra coordenadas actuales, última actualización, estado.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Location from 'expo-location'
import { supabase } from '../../lib/supabase'
import { watchPositionWeb, type GeoErrorTipo, type GeoSubscription } from '../../lib/geolocationWeb'

// ─── Tema ─────────────────────────────────────────────────────
const C = {
  primary:   '#F97316',
  bg:        '#F9FAFB',
  surface:   '#FFFFFF',
  border:    '#F3F4F6',
  text:      '#1E0A3C',
  textLight: '#9CA3AF',
  success:   '#22C55E',
  danger:    '#EF4444',
}

// ─── Componente principal ─────────────────────────────────────
export default function TrackingScreen() {
  const [userId,       setUserId]       = useState<string | null>(null)
  const [pedidoId,     setPedidoId]     = useState<string | null>(null)  // pedido activo asignado
  const [pedidoEstado, setPedidoEstado] = useState<string | null>(null)  // estado del pedido activo
  const [pedidoError,  setPedidoError]  = useState(false)                // falló la consulta del pedido activo
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
  // Apunta siempre a la última versión de enviarUbicacion (definida dentro
  // del efecto de abajo, con pedidoId/userId ya cerrados) para poder
  // reintentar manualmente desde el botón sin duplicar la lógica de envío.
  const enviarUbicacionRef = useRef<((lat: number, lng: number) => Promise<void>) | null>(null)

  // Evita que el upsert cuelgue para siempre cuando la red se queda muda
  // (mismo patrón que app/repartidor/mapa.tsx).
  const conTimeout = <T,>(promesa: PromiseLike<T>, ms: number): Promise<T> => {
    return Promise.race([
      promesa,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms)),
    ])
  }

  // Transmisión automática: solo depende de tener permiso + pedido 'en_camino'.
  const activo = permisoOk === true && !!pedidoId && pedidoEstado === 'en_camino'

  // ── Obtener usuario y pedir permiso (solo native) ──────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setUserId(user.id)

      if (Platform.OS !== 'web') {
        const { status } = await Location.requestForegroundPermissionsAsync()
        setPermisoOk(status === 'granted')
      }
      // En web el permiso se pide implícitamente al arrancar el watch más
      // abajo, no acá (ver comentario en el useState de permisoOk).
    }
    init()
  }, [])

  // ── Buscar el pedido activo asignado a este repartidor ────
  // El tracking se envía por pedido (ubicaciones_repartidores.pedido_id
  // es UNIQUE). Se re-consulta ante cualquier cambio en los pedidos del
  // repartidor (Realtime) para detectar la transición a 'en_camino' sin
  // que el repartidor tenga que recargar la pantalla.
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
      .channel(`repartidor-pedido-activo-${userId}`)
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

  // ── Watch GPS cuando activo ───────────────────────────────
  // Native: expo-location, sin cambios. Web: navigator.geolocation directo
  // (ver lib/geolocationWeb.ts) — es lo único que dispara el popup real del
  // navegador; expo-location en web puede resolver a 'denied' sin mostrarlo.
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

  // ── Cleanup al desmontar ──────────────────────────────────
  useEffect(() => {
    return () => {
      locationSub.current?.remove()
    }
  }, [])

  // ── Reintentar envío manualmente tras un error/timeout ────
  const reintentarEnvio = () => {
    if (lat != null && lng != null) enviarUbicacionRef.current?.(lat, lng)
  }

  // ── Permiso pendiente ─────────────────────────────────────
  if (permisoOk === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Verificando permisos de GPS…</Text>
      </View>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Encabezado */}
      <View style={styles.header}>
        <Text style={styles.headerIcon}>📍</Text>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>Tracking GPS</Text>
          <Text style={styles.headerSub}>
            {activo ? 'Transmitiendo ubicación en tiempo real' : 'Transmisión inactiva'}
          </Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: activo ? C.success : C.textLight }]} />
      </View>

      {/* Sin permiso */}
      {!permisoOk && (
        <View style={styles.alertaBanner}>
          <Text style={styles.alertaTitle}>⚠️ Permiso de ubicación denegado</Text>
          <Text style={styles.alertaText}>
            {Platform.OS === 'web'
              ? 'Tocá el ícono de candado/información junto a la URL del navegador y habilitá el permiso de ubicación para este sitio.'
              : 'Debes conceder permiso de ubicación en los ajustes del dispositivo para poder activar el tracking.'}
          </Text>
        </View>
      )}

      {/* GPS sin señal o tiempo agotado (no es un problema de permiso) */}
      {permisoOk && gpsError && gpsError.tipo !== 'denied' && (
        <View style={styles.errorBannerBig}>
          <Text style={styles.errorBannerTitle}>⚠️ Problema obteniendo tu ubicación</Text>
          <Text style={styles.errorBannerText}>{gpsError.mensaje}</Text>
        </View>
      )}

      {/* Error consultando el pedido activo */}
      {permisoOk && pedidoError && (
        <View style={styles.errorBannerBig}>
          <Text style={styles.errorBannerTitle}>⚠️ Error de conexión, reintentando…</Text>
          <Text style={styles.errorBannerText}>
            No se pudo verificar tu pedido activo. Reintentando automáticamente cada 5 segundos.
          </Text>
        </View>
      )}

      {/* Sin pedido activo */}
      {permisoOk && !pedidoError && !pedidoId && (
        <View style={styles.alertaBanner}>
          <Text style={styles.alertaTitle}>⚠️ No tienes un pedido activo</Text>
          <Text style={styles.alertaText}>
            El tracking se activará automáticamente en cuanto tengas un pedido asignado en camino.
          </Text>
        </View>
      )}

      {/* Pedido asignado pero aún no en camino */}
      {permisoOk && !pedidoError && pedidoId && pedidoEstado !== 'en_camino' && (
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerTitle}>🕐 Pedido asignado ({pedidoEstado})</Text>
          <Text style={styles.infoBannerText}>
            El tracking se activará automáticamente cuando el pedido pase a "en camino".
          </Text>
        </View>
      )}

      {/* Indicador de transmisión — automático, no editable */}
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleLeft}>
            <Text style={styles.toggleLabel}>
              {activo ? '🟢 Transmitiendo ubicación ✅' : '⚫ Transmisión inactiva ❌'}
            </Text>
            <Text style={styles.toggleSub}>
              {activo
                ? 'Tu posición se envía automáticamente cada 10 segundos'
                : 'Se activa sola cuando tengas un pedido en camino'
              }
            </Text>
          </View>
          <Switch
            value={activo}
            disabled
            trackColor={{ false: C.border, true: C.primary + '80' }}
            thumbColor={activo ? C.primary : '#ccc'}
          />
        </View>
      </View>

      {/* Coordenadas actuales */}
      {activo && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Posición actual</Text>

          <View style={styles.coordRow}>
            <View style={styles.coordBox}>
              <Text style={styles.coordLabel}>LATITUD</Text>
              <Text style={styles.coordValue}>
                {lat != null ? lat.toFixed(6) : '—'}
              </Text>
            </View>
            <View style={styles.coordDivider} />
            <View style={styles.coordBox}>
              <Text style={styles.coordLabel}>LONGITUD</Text>
              <Text style={styles.coordValue}>
                {lng != null ? lng.toFixed(6) : '—'}
              </Text>
            </View>
          </View>

          {/* Estado envío */}
          <View style={styles.envioRow}>
            {enviando ? (
              <>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.envioText}>Enviando…</Text>
              </>
            ) : ultimaVez ? (
              <>
                <Text style={styles.checkIcon}>✅</Text>
                <Text style={styles.envioText}>
                  Último envío: {ultimaVez.toLocaleTimeString()}
                </Text>
              </>
            ) : (
              <Text style={styles.envioWaiting}>Esperando primera señal GPS…</Text>
            )}
          </View>

          {errorMsg && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{errorMsg}</Text>
              <TouchableOpacity onPress={reintentarEnvio} style={styles.retryBtnSmall} activeOpacity={0.7}>
                <Text style={styles.retryBtnSmallText}>🔄 Reintentar envío</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>ℹ️ ¿Cómo funciona?</Text>
        <Text style={styles.infoText}>
          Cuando aceptas un pedido y lo marcas como "en camino", tu posición GPS se envía automáticamente a la plataforma cada 10 segundos.
          El administrador y el cliente pueden ver tu ubicación en tiempo real para hacer seguimiento de la entrega.
        </Text>
        <Text style={styles.infoText}>
          La transmisión se detiene sola cuando entregas el pedido o cambias de estado.
        </Text>
      </View>
    </ScrollView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { padding: 16, paddingBottom: 40, gap: 12 },

  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.bg, gap: 12,
  },
  loadingText: { color: C.textLight, fontSize: 14 },

  // Encabezado
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerIcon:  { fontSize: 32 },
  headerBody:  { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  headerSub:   { fontSize: 12, color: C.textLight, marginTop: 2 },
  statusDot:   { width: 10, height: 10, borderRadius: 5 },

  // Alerta (permiso denegado / sin pedido)
  alertaBanner: {
    backgroundColor: '#FEF3C7', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  alertaTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  alertaText:  { fontSize: 13, color: '#92400E', lineHeight: 18 },

  // Info banner (pedido asignado, aún no en camino)
  infoBanner: {
    backgroundColor: '#EFF6FF', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#93C5FD',
  },
  infoBannerTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  infoBannerText:  { fontSize: 13, color: '#1E40AF', lineHeight: 18 },

  // Error banner grande (fallo consultando el pedido activo)
  errorBannerBig: {
    backgroundColor: '#FEE2E2', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#EF4444',
  },
  errorBannerTitle: { fontSize: 14, fontWeight: '700', color: '#991B1B' },
  errorBannerText:  { fontSize: 13, color: '#991B1B', lineHeight: 18 },

  // Cards
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },

  // Toggle (indicador)
  toggleRow:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLeft: { flex: 1 },
  toggleLabel:{ fontSize: 15, fontWeight: '600', color: C.text },
  toggleSub:  { fontSize: 12, color: C.textLight, marginTop: 2 },

  // Coordenadas
  coordRow:     { flexDirection: 'row', gap: 0 },
  coordBox:     { flex: 1, alignItems: 'center', gap: 4 },
  coordDivider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  coordLabel:   {
    fontSize: 10, fontWeight: '700', color: C.textLight,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  coordValue: {
    fontSize: Platform.OS === 'web' ? 16 : 14,
    fontWeight: '700', color: C.text,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },

  // Estado envío
  envioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border,
  },
  checkIcon:    { fontSize: 14 },
  envioText:    { fontSize: 13, color: C.textLight },
  envioWaiting: { fontSize: 13, color: C.textLight, fontStyle: 'italic' },

  // Error
  errorBanner: {
    backgroundColor: '#FEE2E2', borderRadius: 8,
    padding: 10, borderWidth: 1, borderColor: C.danger,
  },
  errorText: { fontSize: 12, color: '#991B1B' },
  retryBtnSmall: {
    marginTop: 8, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: C.danger, borderRadius: 8,
  },
  retryBtnSmallText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Info
  infoCard: {
    backgroundColor: '#EFF6FF', borderRadius: 14,
    padding: 16, gap: 8,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  infoText:  { fontSize: 13, color: '#1E40AF', lineHeight: 20 },
})
