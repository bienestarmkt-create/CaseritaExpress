/**
 * app/admin/estadisticas.tsx
 * ─────────────────────────────────────────────────────────────
 * Sección 4 del Panel Admin: Estadísticas del día.
 *
 * Métricas mostradas:
 *  • Total de pedidos hoy
 *  • Pedidos completados (estado = 'entregado')
 *  • Pedidos cancelados (estado = 'cancelado')
 *  • Ingresos del día (suma de `total` de pedidos entregados)
 *  • Tasa de éxito (% completados sobre no cancelados)
 *  • Desglose de pedidos por estado (barra proporcional)
 *  • Top 3 negocios del día
 *
 * Supuestos de esquema:
 *  pedidos:  id, estado, total, created_at, negocio_id
 *  negocios: id, nombre
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native'
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
  purple:    '#9B59B6',
}

// ─── Helpers ──────────────────────────────────────────────────
function formatMoneda(value: number): string {
  return `Bs. ${value.toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function hoyRangoUTC(): { inicio: string; fin: string } {
  const now   = new Date()
  const inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const fin    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return {
    inicio: inicio.toISOString(),
    fin:    fin.toISOString(),
  }
}

// ─── Tipos ────────────────────────────────────────────────────
type EstadoPedido = string

type PedidoRaw = {
  id:         string
  estado:     EstadoPedido
  total:      number | null
  created_at: string
  negocio:    { id: string; nombre: string } | null
}

type StatsData = {
  totalHoy:        number
  completados:     number
  cancelados:      number
  ingresos:        number
  tasaExito:       number
  porEstado:       { estado: string; count: number; color: string }[]
  topNegocios:     { nombre: string; count: number; ingresos: number }[]
}

// Colores por estado para el desglose
const ESTADO_COLORS: Record<string, string> = {
  pendiente:      '#F4A261',
  aceptado:       '#4A90E2',
  en_preparacion: '#9B59B6',
  listo:          '#2DC653',
  asignado:       '#1ABC9C',
  en_camino:      '#E67E22',
  entregado:      '#27AE60',
  cancelado:      '#95A5A6',
}

// ─── Componente StatCard ──────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  color,
  sub,
}: {
  icon:   string
  label:  string
  value:  string
  color:  string
  sub?:   string
}) {
  return (
    <View style={[cardS.card, { borderTopColor: color }]}>
      <Text style={cardS.icon}>{icon}</Text>
      <Text style={cardS.value}>{value}</Text>
      <Text style={cardS.label}>{label}</Text>
      {sub ? <Text style={cardS.sub}>{sub}</Text> : null}
    </View>
  )
}

const cardS = StyleSheet.create({
  card: {
    flex:              1,
    backgroundColor:   C.surface,
    borderRadius:      12,
    padding:           16,
    borderTopWidth:    3,
    borderWidth:       1,
    borderColor:       C.border,
    alignItems:        'flex-start',
    ...(Platform.OS === 'web' ? { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any : {
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    }),
  },
  icon:  { fontSize: 24, marginBottom: 8 },
  value: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 2 },
  label: { fontSize: 12, color: C.textLight, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sub:   { fontSize: 11, color: C.textLight, marginTop: 4 },
})

// ─── Pantalla principal ───────────────────────────────────────
export default function EstadisticasAdminScreen() {
  const [stats,      setStats]      = useState<StatsData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  // ── Calcular estadísticas ───────────────────────────────────
  const fetchStats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)

    const { inicio, fin } = hoyRangoUTC()

    const { data, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        estado,
        total,
        created_at,
        negocio:negocios!negocio_id ( id, nombre )
      `)
      .gte('created_at', inicio)
      .lte('created_at', fin)

    if (!error && data) {
      const pedidos = data as PedidoRaw[]
      const totalHoy    = pedidos.length
      const completados = pedidos.filter(p => p.estado === 'entregado').length
      const cancelados  = pedidos.filter(p => p.estado === 'cancelado').length
      const ingresos    = pedidos
        .filter(p => p.estado === 'entregado')
        .reduce((sum, p) => sum + (p.total ?? 0), 0)

      const noCancel = totalHoy - cancelados
      const tasaExito = noCancel > 0 ? Math.round((completados / noCancel) * 100) : 0

      // Desglose por estado
      const estadoMap: Record<string, number> = {}
      pedidos.forEach(p => {
        estadoMap[p.estado] = (estadoMap[p.estado] ?? 0) + 1
      })
      const porEstado = Object.entries(estadoMap)
        .sort((a, b) => b[1] - a[1])
        .map(([estado, count]) => ({
          estado,
          count,
          color: ESTADO_COLORS[estado] ?? C.textLight,
        }))

      // Top negocios
      const negMap: Record<string, { nombre: string; count: number; ingresos: number }> = {}
      pedidos.forEach(p => {
        const nid   = p.negocio?.id ?? 'desconocido'
        const nname = p.negocio?.nombre ?? 'Desconocido'
        if (!negMap[nid]) negMap[nid] = { nombre: nname, count: 0, ingresos: 0 }
        negMap[nid].count++
        if (p.estado === 'entregado') negMap[nid].ingresos += p.total ?? 0
      })
      const topNegocios = Object.values(negMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)

      setStats({ totalHoy, completados, cancelados, ingresos, tasaExito, porEstado, topNegocios })
      setLastUpdate(new Date())
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  // ── Renderizado ─────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    )
  }

  const s = stats!
  const maxEstado = s.porEstado[0]?.count ?? 1

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); fetchStats() }}
          colors={[C.primary]}
          tintColor={C.primary}
        />
      }
    >
      {/* Encabezado */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Estadísticas del día</Text>
          <Text style={styles.subtitle}>
            {new Date().toLocaleDateString('es-BO', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => { setRefreshing(true); fetchStats() }}
        >
          <Text style={styles.refreshBtnText}>↻ Actualizar</Text>
        </TouchableOpacity>
      </View>

      {/* Última actualización */}
      <Text style={styles.lastUpdate}>
        Última actualización: {lastUpdate.toLocaleTimeString('es-BO')}
      </Text>

      {/* Grid de KPIs */}
      <View style={styles.kpiRow}>
        <StatCard
          icon="📦"
          label="Total pedidos"
          value={String(s.totalHoy)}
          color={C.info}
          sub="en las últimas 24 h"
        />
        <StatCard
          icon="✅"
          label="Completados"
          value={String(s.completados)}
          color={C.success}
          sub={`${s.totalHoy > 0 ? Math.round((s.completados / s.totalHoy) * 100) : 0}% del total`}
        />
      </View>

      <View style={styles.kpiRow}>
        <StatCard
          icon="❌"
          label="Cancelados"
          value={String(s.cancelados)}
          color={C.danger}
          sub={`${s.totalHoy > 0 ? Math.round((s.cancelados / s.totalHoy) * 100) : 0}% del total`}
        />
        <StatCard
          icon="💰"
          label="Ingresos"
          value={formatMoneda(s.ingresos)}
          color={C.success}
          sub="de pedidos entregados"
        />
      </View>

      {/* Tasa de éxito */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tasa de éxito</Text>
        <View style={styles.tasaContainer}>
          <View style={styles.tasaBar}>
            <View
              style={[
                styles.tasaFill,
                {
                  width:           `${s.tasaExito}%` as any,
                  backgroundColor: s.tasaExito >= 70 ? C.success : s.tasaExito >= 40 ? C.warning : C.danger,
                },
              ]}
            />
          </View>
          <Text style={styles.tasaValue}>{s.tasaExito}%</Text>
        </View>
        <Text style={styles.tasaDesc}>
          {s.completados} entregados de {s.totalHoy - s.cancelados} pedidos no cancelados
        </Text>
      </View>

      {/* Desglose por estado */}
      {s.porEstado.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desglose por estado</Text>
          {s.porEstado.map(e => (
            <View key={e.estado} style={styles.estadoRow}>
              <View style={[styles.estadoDot, { backgroundColor: e.color }]} />
              <Text style={styles.estadoNombre} numberOfLines={1}>
                {e.estado.replace(/_/g, ' ')}
              </Text>
              <View style={styles.estadoBarWrap}>
                <View
                  style={[
                    styles.estadoBarFill,
                    {
                      width:           `${Math.round((e.count / maxEstado) * 100)}%` as any,
                      backgroundColor: e.color,
                    },
                  ]}
                />
              </View>
              <Text style={styles.estadoCount}>{e.count}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Top negocios */}
      {s.topNegocios.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏆 Top negocios del día</Text>
          {s.topNegocios.map((n, i) => (
            <View key={n.nombre} style={styles.negocioRow}>
              <Text style={styles.negocioPos}>#{i + 1}</Text>
              <View style={styles.negocioInfo}>
                <Text style={styles.negocioNombre} numberOfLines={1}>{n.nombre}</Text>
                <Text style={styles.negocioSub}>
                  {n.count} {n.count === 1 ? 'pedido' : 'pedidos'} ·{' '}
                  {formatMoneda(n.ingresos)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Vacío */}
      {s.totalHoy === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTitle}>Sin pedidos hoy</Text>
          <Text style={styles.emptySubtitle}>
            Las estadísticas se actualizarán en tiempo real cuando lleguen pedidos.
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 48 },
  centered:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },

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
  title:    { fontSize: 20, fontWeight: '700', color: C.text },
  subtitle: { fontSize: 13, color: C.textLight, marginTop: 2 },
  refreshBtn: {
    paddingVertical:   7,
    paddingHorizontal: 14,
    borderRadius:      20,
    borderWidth:       1,
    borderColor:       C.border,
    backgroundColor:   C.surface,
  },
  refreshBtnText: { fontSize: 13, color: C.textLight, fontWeight: '600' },
  lastUpdate: {
    fontSize:          11,
    color:             C.textLight,
    textAlign:         'center',
    paddingVertical:   6,
    backgroundColor:   C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  kpiRow: {
    flexDirection:     'row',
    paddingHorizontal: 16,
    paddingTop:        16,
    gap:               12,
  },

  // Secciones
  section: {
    marginHorizontal: 16,
    marginTop:        20,
    backgroundColor:  C.surface,
    borderRadius:     14,
    padding:          16,
    borderWidth:      1,
    borderColor:      C.border,
    ...(Platform.OS === 'web' ? { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any : {
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    }),
  },
  sectionTitle: {
    fontSize:    15,
    fontWeight:  '700',
    color:       C.text,
    marginBottom: 12,
  },

  // Tasa de éxito
  tasaContainer: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    marginBottom:  6,
  },
  tasaBar: {
    flex:            1,
    height:          12,
    backgroundColor: C.border,
    borderRadius:    6,
    overflow:        'hidden',
  },
  tasaFill: {
    height:       12,
    borderRadius: 6,
    minWidth:     4,
  },
  tasaValue: {
    fontSize:   18,
    fontWeight: '800',
    color:      C.text,
    minWidth:   44,
    textAlign:  'right',
  },
  tasaDesc: {
    fontSize: 12,
    color:    C.textLight,
  },

  // Desglose por estado
  estadoRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  8,
    gap:           8,
  },
  estadoDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
    flexShrink:   0,
  },
  estadoNombre: {
    fontSize:  13,
    color:     C.text,
    width:     110,
    textTransform: 'capitalize',
  },
  estadoBarWrap: {
    flex:            1,
    height:          8,
    backgroundColor: C.border,
    borderRadius:    4,
    overflow:        'hidden',
  },
  estadoBarFill: {
    height:       8,
    borderRadius: 4,
    minWidth:     4,
  },
  estadoCount: {
    fontSize:   13,
    fontWeight: '700',
    color:      C.text,
    minWidth:   24,
    textAlign:  'right',
  },

  // Top negocios
  negocioRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap:            12,
  },
  negocioPos: {
    fontSize:   16,
    fontWeight: '800',
    color:      C.textLight,
    width:      26,
  },
  negocioInfo: { flex: 1 },
  negocioNombre: {
    fontSize:   14,
    fontWeight: '700',
    color:      C.text,
  },
  negocioSub: {
    fontSize:  12,
    color:     C.textLight,
    marginTop: 2,
  },

  // Empty
  empty: {
    alignItems:        'center',
    paddingTop:        48,
    paddingHorizontal: 32,
  },
  emptyIcon:     { fontSize: 48, marginBottom: 12 },
  emptyTitle:    { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: C.textLight, textAlign: 'center', lineHeight: 20 },
})
