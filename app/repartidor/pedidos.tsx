/**
 * app/repartidor/pedidos.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Repartidor — Mis Pedidos
 *
 * Muestra los pedidos asignados al repartidor autenticado.
 * Estados visibles: asignado / confirmado / en_camino
 * Transiciones: asignado|confirmado → en_camino → entregado
 * Realtime: suscripción automática a cambios en pedidos propios.
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { notificarCambioEstado } from '../../lib/notifications'
import StarRating from '../../components/StarRating'
import { supabase } from '../../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Tipos ────────────────────────────────────────────────────
type Pedido = {
  id:                 string
  estado:             'asignado' | 'confirmado' | 'en_camino' | 'entregado' | 'cancelado'
  total:              number
  direccion_entrega:  string
  created_at:         string
  usuarios:           { nombre: string } | null   // cliente
  negocios:           { nombre: string } | null
}

// ─── Tema ─────────────────────────────────────────────────────
const C = {
  primary:     '#F97316',
  primaryDark: '#EA580C',
  bg:          '#F9FAFB',
  surface:     '#FFFFFF',
  border:      '#F3F4F6',
  text:        '#1E0A3C',
  textLight:   '#9CA3AF',
  danger:      '#EF4444',
  success:     '#22C55E',
  warning:     '#F59E0B',
  info:        '#3B82F6',
}

// ─── Helpers de estado ────────────────────────────────────────
const ESTADO_LABELS: Record<string, string> = {
  asignado:  'Asignado',
  confirmado:'Confirmado',
  en_camino: 'En camino',
}

const ESTADO_COLORS: Record<string, string> = {
  asignado:  C.warning,
  confirmado:C.info,
  en_camino: C.primary,
}

const ACCION_LABEL: Record<string, string> = {
  asignado:  'Iniciar entrega',
  confirmado:'Iniciar entrega',
  en_camino: 'Marcar entregado',
}

const NEXT_STATE: Record<string, 'en_camino' | 'entregado'> = {
  asignado:  'en_camino',
  confirmado:'en_camino',
  en_camino: 'entregado',
}

// ─── Componente principal ─────────────────────────────────────
export default function PedidosScreen() {
  const router = useRouter()

  const [pedidos,      setPedidos]      = useState<Pedido[]>([])
  const [disponibles,  setDisponibles]  = useState<Pedido[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState(false)
  const [reintentos,   setReintentos]   = useState(0)
  const [refreshing,   setRefreshing]   = useState(false)
  const [updatingId,   setUpdatingId]   = useState<string | null>(null)
  const [tomandoId,    setTomandoId]    = useState<string | null>(null)
  const [avisoTomado,  setAvisoTomado]  = useState<string | null>(null)
  const [userId,       setUserId]       = useState<string | null>(null)
  const [miPromedio,   setMiPromedio]   = useState<{ promedio: number; total_ratings: number } | null>(null)
  const [errorMisPedidos,   setErrorMisPedidos]   = useState<string | null>(null)
  const [errorDisponibles, setErrorDisponibles]   = useState<string | null>(null)
  const [miCiudad, setMiCiudad] = useState<string | null>(null)
  // La suscripción Realtime del pool se registra una sola vez al montar
  // y su closure queda fija con el miCiudad de ese momento (null). Un ref
  // evita ese problema de stale closure — fetchDisponibles siempre lee
  // la ciudad más reciente, la llame quien la llame.
  const miCiudadRef = useRef<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const disponiblesChannelRef = useRef<RealtimeChannel | null>(null)

  // Evita que un await cuelgue para siempre cuando la red se queda muda
  // (mismo patrón que app/index.tsx).
  const conTimeout = <T,>(promesa: PromiseLike<T>, ms: number): Promise<T> => {
    return Promise.race([
      promesa,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms)),
    ])
  }

  // ── Cargar pedidos propios ────────────────────────────────
  const fetchPedidos = useCallback(async (uid?: string) => {
    const targetId = uid ?? userId
    if (!targetId) return

    const { data, error } = await supabase
      .from('pedidos')
      .select('id, estado, total, direccion_entrega, created_at, usuarios!cliente_id(nombre), negocios(nombre)')
      .eq('repartidor_id', targetId)
      .in('estado', ['asignado', 'confirmado', 'en_camino'])
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[repartidor/pedidos] Error cargando mis pedidos', error.message)
      setErrorMisPedidos('No se pudieron cargar tus pedidos. Revisá tu conexión.')
      return
    }

    setErrorMisPedidos(null)
    setPedidos(data as unknown as Pedido[])
  }, [userId])

  // ── Cargar pool de pedidos sin repartidor asignado ────────
  // Solo pedidos de negocios en la misma ciudad del repartidor (!inner
  // fuerza el join para poder filtrar por negocios.ciudad). Si todavía no
  // sabemos la ciudad del repartidor, no se muestra nada — mejor una
  // lista vacía momentánea que un pool con pedidos de otra ciudad.
  const fetchDisponibles = useCallback(async (ciudad?: string | null) => {
    const ciudadActual = ciudad ?? miCiudadRef.current
    if (!ciudadActual) return

    const { data, error } = await supabase
      .from('pedidos')
      .select('id, estado, total, direccion_entrega, created_at, usuarios!cliente_id(nombre), negocios!inner(nombre, ciudad)')
      .is('repartidor_id', null)
      .eq('estado', 'confirmado')
      .eq('negocios.ciudad', ciudadActual)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[repartidor/pedidos] Error cargando pedidos disponibles', error.message)
      setErrorDisponibles('No se pudieron cargar los pedidos disponibles. Revisá tu conexión.')
      return
    }

    setErrorDisponibles(null)
    setDisponibles(data as unknown as Pedido[])
  }, [])

  // ── Inicialización ────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    const init = async () => {
      setLoading(true)
      setLoadError(false)

      try {
        const { data: { user } } = await conTimeout(supabase.auth.getUser(), 8000)
        if (!mounted) return
        if (!user) throw new Error('Sin sesión activa')

        setUserId(user.id)

        const { data: perfil } = await supabase
          .from('usuarios')
          .select('ciudad')
          .eq('id', user.id)
          .single()
        const ciudadRepartidor = perfil?.ciudad ?? null
        miCiudadRef.current = ciudadRepartidor
        if (mounted) setMiCiudad(ciudadRepartidor)

        await conTimeout(Promise.all([fetchPedidos(user.id), fetchDisponibles(ciudadRepartidor)]), 8000)
        if (!mounted) return

        // Cargar promedio propio del repartidor
        const { data: prom } = await supabase
          .from('v_promedios_repartidores')
          .select('promedio, total_ratings')
          .eq('repartidor_id', user.id)
          .maybeSingle()
        if (prom) setMiPromedio({ promedio: Number(prom.promedio), total_ratings: Number(prom.total_ratings) })

        // Realtime
        const ch = supabase
          .channel(`repartidor-pedidos-${user.id}`)
          .on(
            'postgres_changes',
            {
              event:  '*',
              schema: 'public',
              table:  'pedidos',
              filter: `repartidor_id=eq.${user.id}`,
            },
            () => { fetchPedidos(user.id) }
          )
          .subscribe()

        channelRef.current = ch

        // Realtime del pool — sin filtro: un pedido nuevo confirmado tiene
        // que aparecer, y uno que otro repartidor toma tiene que desaparecer
        // (mismo patrón sin filtro que usa app/admin/pedidos.tsx).
        const chDisponibles = supabase
          .channel('repartidor-disponibles')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'pedidos' },
            () => { fetchDisponibles() }
          )
          .subscribe()

        disponiblesChannelRef.current = chDisponibles
      } catch (e) {
        console.error('[repartidor/pedidos] Error al inicializar', e)
        if (mounted) setLoadError(true)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()
    return () => {
      mounted = false
      channelRef.current?.unsubscribe()
      disponiblesChannelRef.current?.unsubscribe()
    }
  }, [reintentos])   // reintentos fuerza un nuevo init() al tocar "Reintentar"

  // ── Pull to refresh ───────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchPedidos(), fetchDisponibles()])
    setRefreshing(false)
  }

  // ── Tomar un pedido del pool ───────────────────────────────
  const tomarPedido = async (pedido: Pedido) => {
    if (!userId) return
    setTomandoId(pedido.id)

    // .is('repartidor_id', null) es la protección contra carrera: si otro
    // repartidor ya lo tomó, esta condición ya no matchea ninguna fila.
    const { data, error } = await supabase
      .from('pedidos')
      .update({ repartidor_id: userId, estado: 'asignado' })
      .eq('id', pedido.id)
      .is('repartidor_id', null)
      .select('id')

    if (error) {
      console.error('[repartidor/pedidos] Error al tomar pedido', pedido.id, error.message)
    } else if (!data || data.length === 0) {
      setAvisoTomado('Este pedido ya fue tomado')
      setTimeout(() => setAvisoTomado(null), 3000)
    } else {
      notificarCambioEstado(pedido.id, 'asignado').catch(() => {})
    }

    setTomandoId(null)
    await Promise.all([fetchDisponibles(), fetchPedidos(userId)])
  }

  // ── Cambiar estado ────────────────────────────────────────
  const cambiarEstado = async (pedido: Pedido) => {
    const nextEstado = NEXT_STATE[pedido.estado]
    if (!nextEstado) return

    // Optimistic
    setUpdatingId(pedido.id)
    setPedidos(prev =>
      nextEstado === 'entregado'
        ? prev.filter(p => p.id !== pedido.id)   // sale de la lista
        : prev.map(p => p.id === pedido.id ? { ...p, estado: nextEstado } : p)
    )

    const { error } = await supabase
      .from('pedidos')
      .update({ estado: nextEstado })
      .eq('id', pedido.id)

    if (error) {
      // Revert optimistic update
      setPedidos(prev =>
        nextEstado === 'entregado'
          ? [pedido, ...prev]
          : prev.map(p => p.id === pedido.id ? { ...p, estado: pedido.estado } : p)
      )
    } else {
      // Notificar al cliente — falla silenciosamente si hay error
      notificarCambioEstado(pedido.id, nextEstado).catch(() => {})
    }

    setUpdatingId(null)
  }

  // ── Pedido en camino (para banner) ────────────────────────
  const enCamino = pedidos.find(p => p.estado === 'en_camino')

  // ── Render tarjeta ────────────────────────────────────────
  const renderPedido = ({ item }: { item: Pedido }) => {
    const isUpdating = updatingId === item.id
    const color      = ESTADO_COLORS[item.estado] ?? C.textLight
    const isEnCamino = item.estado === 'en_camino'

    return (
      <View style={[styles.card, isEnCamino && styles.cardHighlight]}>
        {/* Encabezado */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.cardNegocio}>
              🏪 {item.negocios?.nombre ?? 'Negocio'}
            </Text>
            <Text style={styles.cardCliente}>
              👤 {item.usuarios?.nombre ?? 'Cliente'}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: color + '20' }]}>
            <Text style={[styles.badgeText, { color }]}>
              {ESTADO_LABELS[item.estado] ?? item.estado}
            </Text>
          </View>
        </View>

        {/* Dirección */}
        <View style={styles.cardDir}>
          <Text style={styles.cardDirIcon}>📍</Text>
          <Text style={styles.cardDirText} numberOfLines={2}>{item.direccion_entrega}</Text>
        </View>

        {/* Total */}
        <Text style={styles.cardTotal}>Bs {Number(item.total).toFixed(2)}</Text>

        {/* Acciones */}
        <View style={styles.cardActions}>
          {isEnCamino && (
            <TouchableOpacity
              style={styles.btnMapa}
              onPress={() => router.push('/repartidor/mapa' as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.btnMapaText}>🗺️ Ver mapa</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.btnAccion,
              isEnCamino && styles.btnAccionSuccess,
              isUpdating && styles.btnDisabled,
            ]}
            onPress={() => cambiarEstado(item)}
            disabled={isUpdating}
            activeOpacity={0.7}
          >
            {isUpdating
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnAccionText}>{ACCION_LABEL[item.estado]}</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Render tarjeta disponible ──────────────────────────────
  const renderDisponible = (item: Pedido) => {
    const isTomando = tomandoId === item.id

    return (
      <View key={item.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.cardNegocio}>
              🏪 {item.negocios?.nombre ?? 'Negocio'}
            </Text>
            <Text style={styles.cardCliente}>
              👤 {item.usuarios?.nombre ?? 'Cliente'}
            </Text>
          </View>
        </View>

        <View style={styles.cardDir}>
          <Text style={styles.cardDirIcon}>📍</Text>
          <Text style={styles.cardDirText} numberOfLines={2}>{item.direccion_entrega}</Text>
        </View>

        <Text style={styles.cardTotal}>Bs {Number(item.total).toFixed(2)}</Text>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.btnAccion, isTomando && styles.btnDisabled]}
            onPress={() => tomarPedido(item)}
            disabled={isTomando}
            activeOpacity={0.7}
          >
            {isTomando
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnAccionText}>Tomar pedido</Text>
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

  // ── Error de carga ────────────────────────────────────────
  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyIcon}>⚠️</Text>
        <Text style={styles.emptyTitle}>No pudimos cargar tus pedidos</Text>
        <Text style={styles.emptySub}>Revisá tu conexión e intentá de nuevo</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => setReintentos(n => n + 1)}
          activeOpacity={0.7}
        >
          <Text style={styles.retryBtnText}>🔄 Reintentar</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Render principal ──────────────────────────────────────
  const ListHeader = () => (
    <View>
      {/* ── Mi calificación promedio ─────────────────── */}
      <View style={styles.ratingCard}>
        <View style={styles.ratingCardLeft}>
          <Text style={styles.ratingCardTitle}>Mi calificación</Text>
          {miPromedio ? (
            <>
              <StarRating value={miPromedio.promedio} size={18} readonly />
              <Text style={styles.ratingCardNum}>
                {miPromedio.promedio.toFixed(1)} · {miPromedio.total_ratings} {miPromedio.total_ratings === 1 ? 'reseña' : 'reseñas'}
              </Text>
            </>
          ) : (
            <Text style={styles.ratingCardNuevo}>Aún sin calificaciones</Text>
          )}
        </View>
        <Text style={styles.ratingCardEmoji}>⭐</Text>
      </View>

      {/* Banner pedido en camino */}
      {enCamino && (
        <TouchableOpacity
          style={styles.banner}
          onPress={() => router.push('/repartidor/mapa' as any)}
          activeOpacity={0.85}
        >
          <Text style={styles.bannerIcon}>🏍️</Text>
          <View style={styles.bannerBody}>
            <Text style={styles.bannerTitle}>¡Entrega en curso!</Text>
            <Text style={styles.bannerSub} numberOfLines={1}>{enCamino.direccion_entrega}</Text>
          </View>
          <Text style={styles.bannerArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* Aviso de carrera perdida (otro repartidor tomó el pedido) */}
      {avisoTomado && (
        <View style={styles.avisoBox}>
          <Text style={styles.avisoText}>⚠️ {avisoTomado}</Text>
        </View>
      )}

      {/* Pool de pedidos sin repartidor asignado */}
      <Text style={styles.sectionTitle}>
        Pedidos disponibles ({disponibles.length})
      </Text>
      {errorDisponibles ? (
        <TouchableOpacity style={styles.avisoBox} onPress={() => fetchDisponibles()} activeOpacity={0.7}>
          <Text style={styles.avisoText}>⚠️ {errorDisponibles} Tocá para reintentar.</Text>
        </TouchableOpacity>
      ) : disponibles.length === 0 ? (
        <Text style={styles.disponiblesEmpty}>Sin pedidos disponibles por ahora</Text>
      ) : (
        <View style={styles.disponiblesList}>
          {disponibles.map(renderDisponible)}
        </View>
      )}

      <Text style={styles.sectionTitle}>
        Mis pedidos activos ({pedidos.length})
      </Text>
      {errorMisPedidos && (
        <TouchableOpacity
          style={styles.avisoBox}
          onPress={() => fetchPedidos(userId ?? undefined)}
          activeOpacity={0.7}
        >
          <Text style={styles.avisoText}>⚠️ {errorMisPedidos} Tocá para reintentar.</Text>
        </TouchableOpacity>
      )}
    </View>
  )

  const ListEmpty = () => (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📭</Text>
      <Text style={styles.emptyTitle}>Sin pedidos por ahora</Text>
      <Text style={styles.emptySub}>
        Cuando te asignen un pedido aparecerá aquí automáticamente.
      </Text>
    </View>
  )

  // Web: ScrollView; móvil: FlatList
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
      >
        <ListHeader />
        {pedidos.length === 0
          ? <ListEmpty />
          : pedidos.map(p => renderPedido({ item: p }))
        }
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
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
      }
    />
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { padding: 16, paddingBottom: 32, gap: 12 },

  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.bg, gap: 12,
  },
  loadingText: { color: C.textLight, fontSize: 14 },

  // Card calificación propia
  ratingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderRadius: 14,
    padding: 14, marginBottom: 12, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  ratingCardLeft:  { gap: 4 },
  ratingCardTitle: { fontSize: 12, fontWeight: '600', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  ratingCardNum:   { fontSize: 13, color: C.text, fontWeight: '600', marginTop: 4 },
  ratingCardNuevo: { fontSize: 13, color: C.textLight, marginTop: 4 },
  ratingCardEmoji: { fontSize: 32 },

  // Banner pedido en camino
  banner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.primary, borderRadius: 14,
    padding: 14, marginBottom: 16, gap: 10,
  },
  bannerIcon:  { fontSize: 24 },
  bannerBody:  { flex: 1 },
  bannerTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  bannerSub:   { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  bannerArrow: { color: '#fff', fontSize: 24, fontWeight: '300' },

  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: C.textLight,
    letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase',
  },

  // Pool de pedidos disponibles
  disponiblesList:  { gap: 12, marginBottom: 16 },
  disponiblesEmpty: { fontSize: 13, color: C.textLight, marginBottom: 16 },
  avisoBox: {
    backgroundColor: C.warning + '20', borderRadius: 10,
    padding: 12, marginBottom: 12,
  },
  avisoText: { fontSize: 13, color: C.warning, fontWeight: '600' },

  // Tarjeta
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHighlight: {
    borderWidth: 2, borderColor: C.primary,
  },

  cardHeader:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardHeaderLeft: { flex: 1, gap: 2 },
  cardNegocio:    { fontSize: 15, fontWeight: '700', color: C.text },
  cardCliente:    { fontSize: 13, color: C.textLight },

  badge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },

  cardDir:     { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  cardDirIcon: { fontSize: 14, marginTop: 1 },
  cardDirText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 18 },

  cardTotal: {
    fontSize: 18, fontWeight: '700', color: C.text,
  },

  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },

  btnMapa: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: C.primary + '15', alignItems: 'center',
  },
  btnMapaText: { fontSize: 13, fontWeight: '700', color: C.primary },

  btnAccion: {
    flex: 2, paddingVertical: 10, borderRadius: 10,
    backgroundColor: C.primary, alignItems: 'center',
  },
  btnAccionSuccess: { backgroundColor: C.success },
  btnDisabled:      { opacity: 0.6 },
  btnAccionText:    { fontSize: 13, fontWeight: '700', color: '#fff' },

  // Empty
  empty: {
    alignItems: 'center', paddingVertical: 60, gap: 12,
  },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptySub:   {
    fontSize: 13, color: C.textLight, textAlign: 'center',
    maxWidth: 260, lineHeight: 20,
  },

  retryBtn: {
    marginTop: 8, paddingVertical: 12, paddingHorizontal: 28,
    backgroundColor: C.primary, borderRadius: 12,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
