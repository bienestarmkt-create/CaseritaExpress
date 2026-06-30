/**
 * app/repartidor/mapa.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Repartidor — Mapa de entrega
 *
 * Muestra el mapa con la posición actual del repartidor y el
 * destino del pedido que esté en estado 'en_camino'.
 * - Usa MapaRepartidor (native/web) existente.
 * - GPS con expo-location (watchPositionAsync).
 * - Tarjeta de info del pedido debajo del mapa.
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// MapaRepartidor se importa por platform (native / web)
import MapaRepartidor from '../../components/MapaRepartidor'

// ─── Tipos ────────────────────────────────────────────────────
type Coords = { lat: number; lng: number }

type PedidoActivo = {
  id:          string
  direccion:   string
  total:       number
  destino_lat: number | null
  destino_lng: number | null
  usuarios:    { nombre: string } | null
  negocios:    { nombre: string } | null
}

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
export default function MapaScreen() {
  const router = useRouter()

  const [loading,      setLoading]      = useState(true)
  const [pedido,       setPedido]       = useState<PedidoActivo | null>(null)
  const [miCoords,     setMiCoords]     = useState<Coords | null>(null)
  const [permisoOk,    setPermisoOk]    = useState(false)
  const [updatingId,   setUpdatingId]   = useState<string | null>(null)
  const [userId,       setUserId]       = useState<string | null>(null)

  const locationSub = useRef<Location.LocationSubscription | null>(null)
  const channelRef  = useRef<RealtimeChannel | null>(null)

  // ── Pedir permiso GPS ────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      setPermisoOk(status === 'granted')
    })()
  }, [])

  // ── Cargar pedido en_camino ───────────────────────────────
  const fetchPedido = useCallback(async (uid?: string) => {
    const targetId = uid ?? userId
    if (!targetId) return

    const { data, error } = await supabase
      .from('pedidos')
      .select('id, direccion, total, destino_lat, destino_lng, usuarios!cliente_id(nombre), negocios(nombre)')
      .eq('repartidor_id', targetId)
      .eq('estado', 'en_camino')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error) {
      setPedido(data as unknown as PedidoActivo | null)
    }
  }, [userId])

  // ── Inicialización ────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) return

      setUserId(user.id)
      await fetchPedido(user.id)
      setLoading(false)

      // Realtime — re-fetch si cambia estado del pedido
      const ch = supabase
        .channel(`repartidor-mapa-${user.id}`)
        .on(
          'postgres_changes',
          {
            event:  '*',
            schema: 'public',
            table:  'pedidos',
            filter: `repartidor_id=eq.${user.id}`,
          },
          () => { fetchPedido(user.id) }
        )
        .subscribe()
      channelRef.current = ch
    }

    init()
    return () => {
      mounted = false
      channelRef.current?.unsubscribe()
    }
  }, [])

  // ── Watch GPS ─────────────────────────────────────────────
  useEffect(() => {
    if (!permisoOk) return

    ;(async () => {
      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy:         Location.Accuracy.High,
          timeInterval:     5000,
          distanceInterval: 10,
        },
        loc => {
          setMiCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude })
        }
      )
    })()

    return () => {
      locationSub.current?.remove()
    }
  }, [permisoOk])

  // ── Marcar entregado ──────────────────────────────────────
  const marcarEntregado = async () => {
    if (!pedido) return
    setUpdatingId(pedido.id)

    const { error } = await supabase
      .from('pedidos')
      .update({ estado: 'entregado' })
      .eq('id', pedido.id)

    if (!error) {
      setPedido(null)
      router.push('/repartidor/pedidos' as any)
    }

    setUpdatingId(null)
  }

  // ── Destino coords ────────────────────────────────────────
  const destinoCoords: Coords | null =
    pedido?.destino_lat != null && pedido?.destino_lng != null
      ? { lat: pedido.destino_lat, lng: pedido.destino_lng }
      : null

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Cargando mapa…</Text>
      </View>
    )
  }

  // ── Sin pedido en camino ──────────────────────────────────
  if (!pedido) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyIcon}>🗺️</Text>
        <Text style={styles.emptyTitle}>Sin entrega en curso</Text>
        <Text style={styles.emptySub}>
          El mapa se activa cuando tengas un pedido en estado "En camino".
        </Text>
        <TouchableOpacity
          style={styles.btnVolver}
          onPress={() => router.push('/repartidor/pedidos' as any)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnVolverText}>Ver mis pedidos</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Mapa */}
      <View style={styles.mapaWrapper}>
        <MapaRepartidor
          coords={miCoords}
          destinoCoords={destinoCoords}
        />
      </View>

      {/* Aviso sin permiso GPS */}
      {!permisoOk && (
        <View style={styles.alertaBanner}>
          <Text style={styles.alertaText}>
            ⚠️ Permiso de ubicación denegado. El mapa no puede rastrear tu posición.
          </Text>
        </View>
      )}

      {/* Tarjeta info pedido */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>ENTREGA EN CURSO</Text>

        <Text style={styles.cardNegocio}>
          🏪 {pedido.negocios?.nombre ?? 'Negocio'}
        </Text>
        <Text style={styles.cardCliente}>
          👤 Cliente: {pedido.usuarios?.nombre ?? 'N/A'}
        </Text>

        <View style={styles.divider} />

        <View style={styles.cardRow}>
          <Text style={styles.cardDirIcon}>📍</Text>
          <Text style={styles.cardDir}>{pedido.direccion}</Text>
        </View>

        <Text style={styles.cardTotal}>Total: Bs {Number(pedido.total).toFixed(2)}</Text>

        {/* Coord destino */}
        {destinoCoords ? (
          <Text style={styles.cardCoords}>
            🎯 {destinoCoords.lat.toFixed(5)}, {destinoCoords.lng.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.cardCoordsEmpty}>
            Sin coordenadas de destino registradas
          </Text>
        )}

        <TouchableOpacity
          style={[styles.btnEntregado, updatingId ? styles.btnDisabled : null]}
          onPress={marcarEntregado}
          disabled={!!updatingId}
          activeOpacity={0.7}
        >
          {updatingId
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnEntregadoText}>✅ Marcar como entregado</Text>
          }
        </TouchableOpacity>
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
    backgroundColor: C.bg, gap: 14, padding: 32,
  },
  loadingText: { color: C.textLight, fontSize: 14 },

  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptySub:   {
    fontSize: 13, color: C.textLight, textAlign: 'center',
    maxWidth: 260, lineHeight: 20,
  },
  btnVolver: {
    marginTop: 8, paddingVertical: 12, paddingHorizontal: 28,
    backgroundColor: C.primary, borderRadius: 12,
  },
  btnVolverText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  mapaWrapper: {
    borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

  alertaBanner: {
    backgroundColor: '#FEF3C7', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: '#F59E0B',
  },
  alertaText: { color: '#92400E', fontSize: 13 },

  // Tarjeta info
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 18, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardLabel: {
    fontSize: 11, fontWeight: '700', color: C.primary,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2,
  },
  cardNegocio: { fontSize: 16, fontWeight: '700', color: C.text },
  cardCliente: { fontSize: 13, color: C.textLight },
  divider:     { height: 1, backgroundColor: C.border, marginVertical: 4 },
  cardRow:     { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  cardDirIcon: { fontSize: 14, marginTop: 1 },
  cardDir:     { flex: 1, fontSize: 14, color: C.text, lineHeight: 20 },
  cardTotal:   { fontSize: 18, fontWeight: '700', color: C.text },
  cardCoords:      { fontSize: 12, color: C.textLight, fontFamily: 'monospace' },
  cardCoordsEmpty: { fontSize: 12, color: C.textLight, fontStyle: 'italic' },

  btnEntregado: {
    marginTop: 8, paddingVertical: 14, borderRadius: 12,
    backgroundColor: C.success, alignItems: 'center',
  },
  btnDisabled:      { opacity: 0.6 },
  btnEntregadoText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
