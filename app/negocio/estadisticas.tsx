/**
 * app/negocio/estadisticas.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Anfitrión — Estadísticas del negocio
 *
 * KPIs: pedidos hoy, ingresos hoy, pedidos del mes,
 *       ingresos del mes, tasa de completados.
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'

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
}

type Stats = {
  pedidosHoy:       number
  ingresosHoy:      number
  pedidosMes:       number
  ingresosMes:      number
  canceladosMes:    number
  completadosMes:   number
  tasaCompletados:  number
  productoActivo:   string | null
}

const STATS_INICIAL: Stats = {
  pedidosHoy: 0, ingresosHoy: 0,
  pedidosMes: 0, ingresosMes: 0,
  canceladosMes: 0, completadosMes: 0,
  tasaCompletados: 0, productoActivo: null,
}

// ─── Helpers de fecha ─────────────────────────────────────────
function inicioHoy(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function inicioMes(): string {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ─── Componente principal ─────────────────────────────────────
export default function EstadisticasNegocioScreen() {
  const [stats,      setStats]      = useState<Stats>(STATS_INICIAL)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [negocioId,  setNegocioId]  = useState<string | null>(null)

  // ── Obtener negocio ───────────────────────────────────────
  const initNegocio = useCallback(async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('negocios').select('id').eq('usuario_id', user.id).single()
    return data?.id ?? null
  }, [])

  // ── Calcular stats ────────────────────────────────────────
  const fetchStats = useCallback(async (nid?: string) => {
    const id = nid ?? negocioId
    if (!id) return

    // Pedidos del mes
    const { data: mesPedidos } = await supabase
      .from('pedidos')
      .select('id, estado, total')
      .eq('negocio_id', id)
      .gte('created_at', inicioMes())

    const mesData = mesPedidos ?? []
    const completados = mesData.filter(p => p.estado === 'entregado')
    const cancelados  = mesData.filter(p => p.estado === 'cancelado')
    const ingresosMes = completados.reduce((acc, p) => acc + Number(p.total), 0)

    // Pedidos de hoy
    const { data: hoyPedidos } = await supabase
      .from('pedidos')
      .select('id, estado, total')
      .eq('negocio_id', id)
      .gte('created_at', inicioHoy())

    const hoyData = hoyPedidos ?? []
    const ingresosHoy = hoyData
      .filter(p => p.estado === 'entregado')
      .reduce((acc, p) => acc + Number(p.total), 0)

    // Producto más pedido del mes (via detalle_pedidos)
    // Query simplificada: agrupamos por negocio_id en pedidos
    // Si existe tabla detalle_pedidos, podría refinarse. Por ahora top producto se omite si no hay datos.
    const tasaCompletados = mesData.length > 0
      ? Math.round((completados.length / mesData.length) * 100)
      : 0

    setStats({
      pedidosHoy:      hoyData.length,
      ingresosHoy,
      pedidosMes:      mesData.length,
      ingresosMes,
      canceladosMes:   cancelados.length,
      completadosMes:  completados.length,
      tasaCompletados,
      productoActivo:  null,
    })
  }, [negocioId])

  // ── Init ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true
    const init = async () => {
      const nid = await initNegocio()
      if (!nid || !mounted) { setLoading(false); return }
      setNegocioId(nid)
      await fetchStats(nid)
      setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [])

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchStats()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Calculando estadísticas…</Text>
      </View>
    )
  }

  const mesActual = new Date().toLocaleString('es-BO', { month: 'long', year: 'numeric' })

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* Título */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>Estadísticas</Text>
        <Text style={styles.subtitle}>{mesActual}</Text>
      </View>

      {/* KPIs Hoy */}
      <Text style={styles.sectionLabel}>HOY</Text>
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { flex: 1 }]}>
          <Text style={styles.kpiIcon}>📦</Text>
          <Text style={styles.kpiValue}>{stats.pedidosHoy}</Text>
          <Text style={styles.kpiLabel}>Pedidos</Text>
        </View>
        <View style={[styles.kpiCard, { flex: 1 }]}>
          <Text style={styles.kpiIcon}>💰</Text>
          <Text style={styles.kpiValue}>Bs {stats.ingresosHoy.toFixed(0)}</Text>
          <Text style={styles.kpiLabel}>Ingresos</Text>
        </View>
      </View>

      {/* KPIs Mes */}
      <Text style={styles.sectionLabel}>ESTE MES</Text>
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { flex: 1 }]}>
          <Text style={styles.kpiIcon}>📊</Text>
          <Text style={styles.kpiValue}>{stats.pedidosMes}</Text>
          <Text style={styles.kpiLabel}>Total pedidos</Text>
        </View>
        <View style={[styles.kpiCard, { flex: 1 }]}>
          <Text style={styles.kpiIcon}>💵</Text>
          <Text style={styles.kpiValue}>Bs {stats.ingresosMes.toFixed(0)}</Text>
          <Text style={styles.kpiLabel}>Ingresos totales</Text>
        </View>
      </View>

      {/* Tasa de completados */}
      <View style={styles.tasaCard}>
        <View style={styles.tasaHeader}>
          <Text style={styles.tasaTitle}>Tasa de completados</Text>
          <Text style={[
            styles.tasaValor,
            { color: stats.tasaCompletados >= 70 ? C.success : stats.tasaCompletados >= 40 ? C.warning : C.danger }
          ]}>
            {stats.tasaCompletados}%
          </Text>
        </View>
        <View style={styles.tasaBarBg}>
          <View style={[
            styles.tasaBarFill,
            {
              width: `${stats.tasaCompletados}%` as any,
              backgroundColor: stats.tasaCompletados >= 70 ? C.success : stats.tasaCompletados >= 40 ? C.warning : C.danger,
            }
          ]} />
        </View>
        <View style={styles.tasaLegend}>
          <Text style={styles.tasaLegendItem}>✅ {stats.completadosMes} entregados</Text>
          <Text style={styles.tasaLegendItem}>❌ {stats.canceladosMes} cancelados</Text>
          <Text style={styles.tasaLegendItem}>
            ⏳ {stats.pedidosMes - stats.completadosMes - stats.canceladosMes} en curso
          </Text>
        </View>
      </View>

      {/* Consejo */}
      {stats.tasaCompletados < 70 && stats.pedidosMes > 0 && (
        <View style={styles.consejo}>
          <Text style={styles.consejoTitle}>💡 Consejo</Text>
          <Text style={styles.consejoText}>
            Tu tasa de completados es {stats.tasaCompletados < 40 ? 'baja' : 'mejorable'}.
            Revisa los pedidos cancelados para identificar patrones y mejorar tu servicio.
          </Text>
        </View>
      )}

      {stats.pedidosMes === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyTitle}>Sin datos todavía</Text>
          <Text style={styles.emptySub}>Las estadísticas aparecerán cuando tengas pedidos este mes.</Text>
        </View>
      )}
    </ScrollView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  content:     { padding: 16, paddingBottom: 40, gap: 12 },
  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg, gap: 12 },
  loadingText: { color: C.textLight, fontSize: 14 },

  titleRow:  { gap: 2, marginBottom: 4 },
  title:     { fontSize: 22, fontWeight: '800', color: C.text },
  subtitle:  { fontSize: 13, color: C.textLight, textTransform: 'capitalize' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.textLight,
    letterSpacing: 1, textTransform: 'uppercase', marginTop: 4,
  },

  kpiRow: { flexDirection: 'row', gap: 10 },
  kpiCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16, alignItems: 'center', gap: 4,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  kpiIcon:  { fontSize: 24 },
  kpiValue: { fontSize: 22, fontWeight: '800', color: C.text },
  kpiLabel: { fontSize: 12, color: C.textLight, textAlign: 'center' },

  // Tasa
  tasaCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  tasaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tasaTitle:  { fontSize: 14, fontWeight: '700', color: C.text },
  tasaValor:  { fontSize: 26, fontWeight: '800' },
  tasaBarBg:  { height: 10, backgroundColor: C.border, borderRadius: 5, overflow: 'hidden' },
  tasaBarFill:{ height: '100%', borderRadius: 5 },
  tasaLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tasaLegendItem: { fontSize: 12, color: C.textLight },

  // Consejo
  consejo: {
    backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  consejoTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  consejoText:  { fontSize: 13, color: '#78350F', lineHeight: 18 },

  empty:      { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptySub:   { fontSize: 13, color: C.textLight, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
})
