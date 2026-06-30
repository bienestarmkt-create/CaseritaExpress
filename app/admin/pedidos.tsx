/**
 * app/admin/pedidos.tsx
 * ─────────────────────────────────────────────────────────────
 * Sección 1 del Panel Admin: Pedidos activos en tiempo real.
 *
 * Características:
 *  • Se suscribe a Supabase Realtime en tabla `pedidos`.
 *  • Muestra: nombre del cliente, negocio, estado, tiempo transcurrido.
 *  • Botón de cambio de estado manual con menú modal.
 *  • Filtra pedidos no finalizados (excluye 'entregado' y 'cancelado').
 *  • Limpia el channel al desmontar para evitar memory leaks.
 *
 * Supuestos de esquema:
 *  pedidos:   id, cliente_id, negocio_id, estado, total, created_at
 *  profiles:  id, nombre
 *  negocios:  id, nombre
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  Platform,
} from 'react-native'
import { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase' // ← ajusta si difiere

// ─── Colores (ajusta a tu tema) ───────────────────────────────
const C = {
  bg:        '#F8F9FA',
  surface:   '#FFFFFF',
  border:    '#E9ECEF',
  primary:   '#E63946',
  text:      '#212529',
  textLight: '#6C757D',
  success:   '#2DC653',
  warning:   '#F4A261',
  danger:    '#E63946',
  info:      '#4A90E2',
}

// ─── Estados del pedido ────────────────────────────────────────
type EstadoPedido =
  | 'pendiente'
  | 'aceptado'
  | 'en_preparacion'
  | 'listo'
  | 'asignado'
  | 'en_camino'
  | 'entregado'
  | 'cancelado'

// Estados que el admin puede asignar manualmente
const ESTADOS_DISPONIBLES: { value: EstadoPedido; label: string }[] = [
  { value: 'pendiente',      label: 'Pendiente'      },
  { value: 'aceptado',       label: 'Aceptado'       },
  { value: 'en_preparacion', label: 'En preparación' },
  { value: 'listo',          label: 'Listo'           },
  { value: 'asignado',       label: 'Asignado'        },
  { value: 'en_camino',      label: 'En camino'       },
  { value: 'entregado',      label: 'Entregado'       },
  { value: 'cancelado',      label: 'Cancelado'       },
]

// Estados "activos" que se muestran por defecto
const ESTADOS_ACTIVOS: EstadoPedido[] = [
  'pendiente', 'aceptado', 'en_preparacion', 'listo', 'asignado', 'en_camino',
]

// ─── Colores por estado ────────────────────────────────────────
const ESTADO_COLOR: Record<EstadoPedido, string> = {
  pendiente:      '#F4A261',
  aceptado:       '#4A90E2',
  en_preparacion: '#9B59B6',
  listo:          '#2DC653',
  asignado:       '#1ABC9C',
  en_camino:      '#E63946',
  entregado:      '#27AE60',
  cancelado:      '#95A5A6',
}

// ─── Tipo Pedido ───────────────────────────────────────────────
type Pedido = {
  id:         string
  estado:     EstadoPedido
  total:      number
  created_at: string
  cliente:    { id: string; nombre: string } | null
  negocio:    { id: string; nombre: string } | null
}

// ─── Helpers ──────────────────────────────────────────────────
function tiempoTranscurrido(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'ahora mismo'
  if (mins < 60)  return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  return `hace ${hrs}h ${mins % 60}min`
}

// ─── Componente BadgeEstado ────────────────────────────────────
function BadgeEstado({ estado }: { estado: EstadoPedido }) {
  const label = ESTADOS_DISPONIBLES.find(e => e.value === estado)?.label ?? estado
  return (
    <View style={[badgeStyles.badge, { backgroundColor: ESTADO_COLOR[estado] + '22' }]}>
      <View style={[badgeStyles.dot, { backgroundColor: ESTADO_COLOR[estado] }]} />
      <Text style={[badgeStyles.text, { color: ESTADO_COLOR[estado] }]}>{label}</Text>
    </View>
  )
}
const badgeStyles = StyleSheet.create({
  badge: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:    20,
    gap:             5,
  },
  dot: {
    width:       7,
    height:      7,
    borderRadius: 4,
  },
  text: {
    fontSize:   12,
    fontWeight: '600',
  },
})

// ─── Componente PedidoCard ────────────────────────────────────
function PedidoCard({
  pedido,
  onChangeEstado,
}: {
  pedido: Pedido
  onChangeEstado: (pedido: Pedido) => void
}) {
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.header}>
        <View style={cardStyles.headerLeft}>
          <Text style={cardStyles.clienteNombre}>
            👤 {pedido.cliente?.nombre ?? 'Cliente desconocido'}
          </Text>
          <Text style={cardStyles.negocioNombre}>
            🏪 {pedido.negocio?.nombre ?? 'Negocio desconocido'}
          </Text>
        </View>
        <View style={cardStyles.headerRight}>
          <Text style={cardStyles.total}>Bs. {pedido.total?.toFixed(2) ?? '0.00'}</Text>
          <Text style={cardStyles.tiempo}>{tiempoTranscurrido(pedido.created_at)}</Text>
        </View>
      </View>

      <View style={cardStyles.footer}>
        <BadgeEstado estado={pedido.estado} />
        <TouchableOpacity
          style={cardStyles.btn}
          onPress={() => onChangeEstado(pedido)}
          activeOpacity={0.7}
        >
          <Text style={cardStyles.btnText}>Cambiar estado ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius:    12,
    padding:         16,
    marginBottom:    10,
    borderWidth:     1,
    borderColor:     C.border,
    ...(Platform.OS === 'web' ? { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any : {
      shadowColor:   '#000',
      shadowOffset:  { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius:  4,
      elevation:     2,
    }),
  },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   10,
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: 'flex-end', gap: 2 },
  clienteNombre: { fontSize: 15, fontWeight: '700', color: C.text },
  negocioNombre: { fontSize: 13, color: C.textLight, marginTop: 2 },
  total:         { fontSize: 15, fontWeight: '700', color: C.primary },
  tiempo:        { fontSize: 11, color: C.textLight },
  footer: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:      8,
    paddingTop:     8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  btn: {
    backgroundColor: C.primary,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius:   8,
  },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})

// ─── Pantalla principal ───────────────────────────────────────
export default function PedidosAdminScreen() {
  const [pedidos,      setPedidos]      = useState<Pedido[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [pedidoActivo, setPedidoActivo] = useState<Pedido | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)

  // ── Cargar pedidos ──────────────────────────────────────────
  const fetchPedidos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)

    const query = supabase
      .from('pedidos')
      .select(`
        id,
        estado,
        total,
        created_at,
        cliente:profiles!cliente_id ( id, nombre ),
        negocio:negocios!negocio_id ( id, nombre )
      `)
      .order('created_at', { ascending: false })

    // Filtrar por estados activos (o mostrar todos)
    if (!mostrarTodos) {
      query.in('estado', ESTADOS_ACTIVOS)
    }

    const { data, error } = await query

    if (!error && data) {
      setPedidos(data as Pedido[])
    }
    setLoading(false)
    setRefreshing(false)
  }, [mostrarTodos])

  // ── Realtime ────────────────────────────────────────────────
  useEffect(() => {
    fetchPedidos()

    // Limpiar canal anterior si existía
    channelRef.current?.unsubscribe()

    const channel = supabase
      .channel('admin-pedidos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos' },
        () => {
          // Recarga silenciosa cuando hay un INSERT, UPDATE o DELETE
          fetchPedidos(true)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [fetchPedidos])

  // ── Cambiar estado ──────────────────────────────────────────
  const abrirModalEstado = (pedido: Pedido) => {
    setPedidoActivo(pedido)
    setModalVisible(true)
  }

  const cambiarEstado = async (nuevoEstado: EstadoPedido) => {
    if (!pedidoActivo) return
    setSaving(true)
    const { error } = await supabase
      .from('pedidos')
      .update({ estado: nuevoEstado })
      .eq('id', pedidoActivo.id)

    if (!error) {
      // Actualizar localmente sin esperar a Realtime
      setPedidos(prev =>
        prev.map(p =>
          p.id === pedidoActivo.id ? { ...p, estado: nuevoEstado } : p
        )
      )
    }
    setSaving(false)
    setModalVisible(false)
    setPedidoActivo(null)
  }

  // ── Renderizado ─────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Encabezado */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Pedidos activos</Text>
          <Text style={styles.subtitle}>
            {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'} •{' '}
            <Text style={styles.live}>● EN VIVO</Text>
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, mostrarTodos && styles.filterBtnActive]}
          onPress={() => setMostrarTodos(v => !v)}
        >
          <Text style={[styles.filterBtnText, mostrarTodos && styles.filterBtnTextActive]}>
            {mostrarTodos ? 'Solo activos' : 'Ver todos'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Lista */}
      <FlatList
        data={pedidos}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PedidoCard pedido={item} onChangeEstado={abrirModalEstado} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchPedidos() }}
            colors={[C.primary]}
            tintColor={C.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>Sin pedidos activos</Text>
            <Text style={styles.emptySubtitle}>
              Cuando lleguen nuevos pedidos aparecerán aquí automáticamente.
            </Text>
          </View>
        }
      />

      {/* Modal cambio de estado */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !saving && setModalVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Cambiar estado del pedido</Text>
            <Text style={styles.modalSubtitle}>
              Cliente: {pedidoActivo?.cliente?.nombre ?? '—'}
            </Text>

            {saving ? (
              <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
            ) : (
              ESTADOS_DISPONIBLES.map(e => {
                const isActual = pedidoActivo?.estado === e.value
                return (
                  <TouchableOpacity
                    key={e.value}
                    style={[styles.estadoOption, isActual && styles.estadoOptionActive]}
                    onPress={() => cambiarEstado(e.value)}
                    activeOpacity={0.7}
                    disabled={isActual}
                  >
                    <View
                      style={[
                        styles.estadoDot,
                        { backgroundColor: ESTADO_COLOR[e.value] },
                      ]}
                    />
                    <Text
                      style={[
                        styles.estadoLabel,
                        isActual && styles.estadoLabelActive,
                      ]}
                    >
                      {e.label}
                    </Text>
                    {isActual && (
                      <Text style={styles.estadoActualTag}>Estado actual</Text>
                    )}
                  </TouchableOpacity>
                )
              })
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: C.bg,
  },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg,
  },
  header: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: 20,
    paddingVertical:   16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor:   C.surface,
  },
  title:       { fontSize: 20, fontWeight: '700', color: C.text },
  subtitle:    { fontSize: 13, color: C.textLight, marginTop: 2 },
  live:        { color: C.success, fontWeight: '700' },
  filterBtn: {
    paddingVertical:   7,
    paddingHorizontal: 14,
    borderRadius:      20,
    borderWidth:       1,
    borderColor:       C.border,
    backgroundColor:   C.surface,
  },
  filterBtnActive: {
    backgroundColor: C.primary,
    borderColor:     C.primary,
  },
  filterBtnText:       { fontSize: 13, color: C.textLight, fontWeight: '600' },
  filterBtnTextActive: { color: '#fff' },
  list: {
    padding:     16,
    paddingBottom: 32,
  },
  empty: {
    alignItems:   'center',
    paddingTop:   60,
    paddingHorizontal: 32,
  },
  emptyIcon:     { fontSize: 48, marginBottom: 12 },
  emptyTitle:    { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: C.textLight, textAlign: 'center', lineHeight: 20 },

  // Modal
  modalOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  modalSheet: {
    backgroundColor:    C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal:  20,
    paddingBottom:      40,
    paddingTop:         12,
    maxHeight:          '80%',
  },
  modalHandle: {
    width:           44,
    height:          5,
    backgroundColor: C.border,
    borderRadius:    3,
    alignSelf:       'center',
    marginBottom:    16,
  },
  modalTitle:    { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: C.textLight, marginBottom: 16 },
  estadoOption: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius:    10,
    marginBottom:    6,
    backgroundColor: C.bg,
    gap:             10,
  },
  estadoOptionActive: {
    backgroundColor: C.primary + '12',
    borderWidth:     1,
    borderColor:     C.primary + '44',
  },
  estadoDot: {
    width:        10,
    height:       10,
    borderRadius: 5,
  },
  estadoLabel: {
    flex:       1,
    fontSize:   14,
    fontWeight: '500',
    color:      C.text,
  },
  estadoLabelActive: {
    color:      C.primary,
    fontWeight: '700',
  },
  estadoActualTag: {
    fontSize:          11,
    color:             C.primary,
    fontWeight:        '600',
    backgroundColor:   C.primary + '18',
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      10,
  },
})
