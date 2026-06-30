/**
 * app/repartidor/tracking.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Repartidor — Tracking GPS
 *
 * - Toggle para activar/desactivar transmisión de ubicación.
 * - GPS continuo cada 10 s con expo-location.
 * - Upsert en tabla tracking_repartidores (conflict: repartidor_id).
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
  View,
} from 'react-native'
import * as Location from 'expo-location'
import { supabase } from '../../lib/supabase'

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
  const [userId,      setUserId]      = useState<string | null>(null)
  const [permisoOk,   setPermisoOk]   = useState<boolean | null>(null)  // null = pendiente
  const [activo,      setActivo]      = useState(false)
  const [lat,         setLat]         = useState<number | null>(null)
  const [lng,         setLng]         = useState<number | null>(null)
  const [ultimaVez,   setUltimaVez]   = useState<Date | null>(null)
  const [enviando,    setEnviando]     = useState(false)
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)

  const locationSub = useRef<Location.LocationSubscription | null>(null)

  // ── Obtener usuario y pedir permiso ───────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setUserId(user.id)

      const { status } = await Location.requestForegroundPermissionsAsync()
      setPermisoOk(status === 'granted')
    }
    init()
  }, [])

  // ── Watch GPS cuando activo ───────────────────────────────
  useEffect(() => {
    if (!activo || !permisoOk || !userId) {
      locationSub.current?.remove()
      locationSub.current = null
      return
    }

    let mounted = true

    ;(async () => {
      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy:         Location.Accuracy.High,
          timeInterval:     10_000,   // 10 s
          distanceInterval: 0,        // siempre emite por tiempo
        },
        async loc => {
          if (!mounted) return

          const newLat = loc.coords.latitude
          const newLng = loc.coords.longitude

          setLat(newLat)
          setLng(newLng)
          setEnviando(true)
          setErrorMsg(null)

          const { error } = await supabase
            .from('tracking_repartidores')
            .upsert(
              { repartidor_id: userId, lat: newLat, lng: newLng, updated_at: new Date().toISOString() },
              { onConflict: 'repartidor_id' }
            )

          if (error) {
            setErrorMsg(`Error al enviar: ${error.message}`)
          } else {
            setUltimaVez(new Date())
          }

          setEnviando(false)
        }
      )
    })()

    return () => {
      mounted = false
      locationSub.current?.remove()
      locationSub.current = null
    }
  }, [activo, permisoOk, userId])

  // ── Cleanup al desmontar ──────────────────────────────────
  useEffect(() => {
    return () => {
      locationSub.current?.remove()
    }
  }, [])

  // ── Toggle tracking ───────────────────────────────────────
  const toggleTracking = (value: boolean) => {
    setActivo(value)
    if (!value) {
      setLat(null)
      setLng(null)
      setUltimaVez(null)
      setErrorMsg(null)
    }
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
            Debes conceder permiso de ubicación en los ajustes del dispositivo para poder activar el tracking.
          </Text>
        </View>
      )}

      {/* Toggle */}
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleLeft}>
            <Text style={styles.toggleLabel}>
              {activo ? '🟢 Tracking activo' : '⚫ Tracking inactivo'}
            </Text>
            <Text style={styles.toggleSub}>
              {activo
                ? 'Tu posición se envía cada 10 segundos'
                : 'Activa para compartir tu posición'
              }
            </Text>
          </View>
          <Switch
            value={activo}
            onValueChange={toggleTracking}
            disabled={!permisoOk}
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
            </View>
          )}
        </View>
      )}

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>ℹ️ ¿Cómo funciona?</Text>
        <Text style={styles.infoText}>
          Cuando el tracking está activo, tu posición GPS se envía automáticamente a la plataforma cada 10 segundos.
          El administrador y los clientes pueden ver tu ubicación en tiempo real para hacer seguimiento de las entregas.
        </Text>
        <Text style={styles.infoText}>
          Desactiva el tracking cuando termines tu jornada o no estés haciendo entregas.
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

  // Alerta
  alertaBanner: {
    backgroundColor: '#FEF3C7', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  alertaTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  alertaText:  { fontSize: 13, color: '#92400E', lineHeight: 18 },

  // Cards
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },

  // Toggle
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

  // Info
  infoCard: {
    backgroundColor: '#EFF6FF', borderRadius: 14,
    padding: 16, gap: 8,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  infoText:  { fontSize: 13, color: '#1E40AF', lineHeight: 20 },
})
