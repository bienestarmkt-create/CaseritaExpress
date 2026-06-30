/**
 * app/negocio/pedidos.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Anfitrión — Mis Pedidos
 *
 * Muestra pedidos activos del negocio del anfitrión autenticado.
 * - Realtime via Supabase channel.
 * - Botón "Marcar como listo" → estado 'listo'.
 * - Botón "Rechazar" → confirmación → estado 'cancelado'.
 * - Notifica al cliente via notificarCambioEstado().
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'
import { notificarCambioEstado } from '../../lib/notifications'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Tipos ────────────────────────────────────────────────────
type EstadoPedido = 'pendiente' | 'confirmado' | 'asignado' | 'en_preparacion' | 'listo' | 'en_camino' | 'entregado' | 'cancelado'

type Pedido = {
  id:         string
  estado:     EstadoPedido
  total:      number
  created_at: string
  direccion:  string
  usuarios:   { nombre: string } | null
}

// ─── Tema ─────────────────────────────────────────────────────
const C = {
  primary:   '#16A34A',
  bg:        '#F9FAFB',
  surface:   '#FFFFFF',
  border:    '#E5E7EB',
  text:      '#1E0A3C',
  textLight: '#9CA3AF',
  danger:    '#EF4444',
  warning:   '#F59E0B',
  success:   '#16A34A',
  info:      '#3B82F6',
}

const ESTADO_LABELS: Record<string, string> = {
  pendiente:      'Pendiente',
  confirmado:     'Confirmado',
  asignado:       'Asignado',
  en_preparacion: 'En preparación',
  listo:          'Listo para retirar',
  en_camino:      'En camino',
  entregado:      'Entregado',
  cancelado:      'Cancelado',
}

const ESTADO_COLOR: Record<string, string> = {
  pendiente:      C.warning,
  confirmado:     C.info,
  asignado:       '#8B5CF6',
  en_preparacion: '#F97316',
  listo:          C.success,
  en_camino:      '#06B6D4',
  entregado:      C.success,
  cancelado:      C.textLight,
}

// Estados activos visibles en la lista
const ESTADOS_ACTIVOS: EstadoPedido[] = ['pendiente', 'confirmado', 'asignado', 'en_preparacion']

function tiempoTranscurrido(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1)  return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  return `hace ${Math.floor(mins / 60)}h ${mins % 60}min`
}

// ─── Componente principal ─────────────────────────────────────
export default function PedidosNegocioScreen() {
  const [pedidos,     setPedidos]     = useState<Pedido[]>([])
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [negocioId,   setNegocioId]   = useState<string | null>(null)
  const [updatingId,  setUpdatingId]  = useState<string | null>(null)
  const [modalPedido, setModalPedido] = useState<Pedido | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  // ── Obtener negocio del usuario autenticado ───────────────
  const initNegocio = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: negocio } = await supabase
      .from('negocios')
      .select('id')
      .eq('usuario_id', user.id)
      .single()

    return negocio?.id ?? null
  }, [])

  // ── Cargar pedidos ────────────────────────────────────────
  const fetchPedidos = useCallback(async (nid?: string) => {
    const id = nid ?? negocioId
    if (!id) return

    const { data, error } = await supabase
      .from('pedidos')
      .select('id, estado, total, created_at, direccion, usuarios!cliente_id(nombre)')
      .eq('negocio_id', id)
      .in('estado', ESTADOS_ACTIVOS)
      .order('created_at', { ascending: false })

    if (!error && data) setPedidos(data as unknown as Pedido[])
  }, [negocioId])

  // ── Inicialización ────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    const init = async () => {
      const nid = await initNegocio()
      if (!nid || !mounted) { setLoading(false); return }
      setNegocioId(nid)
      await fetchPedidos(nid)
      setLoading(false)

      // Realtime
      const ch = supabase
        .channel(`negocio-pedidos-${nid}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'pedidos',
          filter: `negocio_id=eq.${nid}`,
        }, () => fetchPedidos(nid))
        .subscribe()
      channelRef.current = ch
    }

    init()
    return () => { mounted = false; channelRef.current?.unsubscribe() }
  }, [])

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchPedidos()
    setRefreshing(false)
  }

  // ── Cambiar estado ────────────────────────────────────────
  const cambiarEstado = async (pedido: Pedido, nuevoEstado: EstadoPedido) => {
    setUpdatingId(pedido.id)
    setModalPedido(null)

    // Optimistic: sacar de la lista si es estado final
    const estadosFinales: EstadoPedido[] = ['listo', 'cancelado']
    if (estadosFinales.includes(nuevoEstado)) {
      setPedidos(prev => prev.filter(p => p.id !== pedido.id))
    } else {
      setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, estado: nuevoEstado } : p))
    }

    const { error } = await supabase
      .from('pedidos')
      .update({ estado: nuevoEstado })
      .eq('id', pedido.id)

    if (error) {
      // Revert
      setPedidos(prev => {
        const exists = prev.find(p => p.id === pedido.id)
        if (exists) return prev.map(p => p.id === pedido.id ? { ...p, estado: pedido.estado } : p)
        return [pedido, ...prev]
      })
    } else {
      notificarCambioEstado(pedido.id, nuevoEstado).catch(() => {})
    }

    setUpdatingId(null)
  }

  // ── Rechazar con confirmación ─────────────────────────────
  const confirmarRechazo = (pedido: Pedido) => {
    setModalPedido(null)
    Alert.alert(
      'Rechazar pedido',
      `¿Seguro que quieres rechazar el pedido de ${pedido.usuarios?.nombre ?? 'este cliente'}? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Rechazar', style: 'destructive', onPress: () => cambiarEstado(pedido, 'cancelado') },
      ]
    )
  }

  // ── Render tarjeta ────────────────────────────────────────
  const renderPedido = ({ item }: { item: Pedido }) => {
    const color      = ESTADO_COLOR[item.estado] ?? C.textLight
    const isUpdating = updatingId === item.id

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.cardCliente}>👤 {item.usuarios?.nombre ?? 'Cliente'}</Text>
            <Text style={styles.cardTiempo}>{tiempoTranscurrido(item.created_at)}</Text>
          </View>
          <View>
            <Text style={styles.cardTotal}>Bs {Number(item.total).toFixed(2)}</Text>
            <View style={[styles.badge, { backgroundColor: color + '20' }]}>
              <Text style={[styles.badgeText, { color }]}>{ESTADO_LABELS[item.estado] ?? item.estado}</Text>
            </View>
          </View>
        </View>

        {item.direccion ? (
          <View style={styles.cardDir}>
            <Text style={styles.cardDirIcon}>📍</Text>
            <Text style={styles.cardDirText} numberOfLines={1}>{item.direccion}</Text>
          </View>
        ) : null}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.btnRechazar, isUpdating && styles.btnDisabled]}
            onPress={() => confirmarRechazo(item)}
            disabled={isUpdating}
            activeOpacity={0.7}
          >
            <Text style={styles.btnRechazarText}>✕ Rechazar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnListo, isUpdating && styles.btnDisabled]}
            onPress={() => cambiarEstado(item, 'listo')}
            disabled={isUpdating}
            activeOpacity={0.7}
          >
            {isUpdating
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnListoText}>✓ Marcar listo</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Cargando pedidos…</Text>
      </View>
    )
  }

  // ── Render ────────────────────────────────────────────────
  const ListHeader = () => (
    <View style={styles.listHeader}>
      <Text style={styles.sectionTitle}>Pedidos activos ({pedidos.length})</Text>
      <View style={styles.liveDot}>
        <Text style={styles.liveText}>● EN VIVO</Text>
      </View>
    </View>
  )

  const ListEmpty = () => (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📭</Text>
      <Text style={styles.emptyTitle}>Sin pedidos activos</Text>
      <Text style={styles.emptySub}>Los nuevos pedidos aparecerán aquí automáticamente.</Text>
    </View>
  )

  if (Platform.OS === 'web') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        <ListHeader />
        {pedidos.length === 0 ? <ListEmpty /> : pedidos.map(p => renderPedido({ item: p }))}
      </ScrollView>
    )
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={pedidos}
      keyExtractor={item => item.id}
      renderItem={renderPedido}
      ListHeaderComponent={<ListHeader />}
      ListEmptyComponent={<ListEmpty />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    />
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { padding: 16, paddingBottom: 32, gap: 10 },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg, gap: 12 },
  loadingText: { color: C.textLight, fontSize: 14 },

  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  liveDot:    { flexDirection: 'row', alignItems: 'center' },
  liveText:   { fontSize: 11, color: C.primary, fontWeight: '700' },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeaderLeft: { flex: 1, gap: 2 },
  cardCliente:    { fontSize: 15, fontWeight: '700', color: C.text },
  cardTiempo:     { fontSize: 12, color: C.textLight },
  cardTotal:      { fontSize: 16, fontWeight: '700', color: C.text, textAlign: 'right' },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginTop: 4, alignSelf: 'flex-end' },
  badgeText:      { fontSize: 11, fontWeight: '700' },
  cardDir:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardDirIcon:    { fontSize: 13 },
  cardDirText:    { flex: 1, fontSize: 13, color: C.textLight },
  cardActions:    { flexDirection: 'row', gap: 8, marginTop: 4 },

  btnRechazar: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.danger, alignItems: 'center',
  },
  btnRechazarText: { fontSize: 13, fontWeight: '700', color: C.danger },
  btnListo: {
    flex: 2, paddingVertical: 10, borderRadius: 10,
    backgroundColor: C.primary, alignItems: 'center',
  },
  btnListoText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled:  { opacity: 0.6 },

  empty:      { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptySub:   { fontSize: 13, color: C.textLight, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
})
