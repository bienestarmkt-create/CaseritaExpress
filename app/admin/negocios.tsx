/**
 * app/admin/negocios.tsx
 * ─────────────────────────────────────────────────────────────
 * Sección 2 del Panel Admin: Gestión de negocios.
 *
 * Características:
 *  • Lista todos los negocios con nombre, categoría y estado.
 *  • Switch para activar/desactivar (campo `activo` en negocios).
 *  • Feedback visual optimista: el Switch responde inmediato
 *    y se revierte si el UPDATE falla.
 *  • Buscador por nombre de negocio.
 *
 * Supuestos de esquema:
 *  negocios: id, nombre, categoria (opcional), activo, created_at
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  Switch,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Platform,
  Alert,
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
  inputBg:   '#F1F3F5',
}

// ─── Tipo Negocio ──────────────────────────────────────────────
type Negocio = {
  id:         string
  nombre:     string
  categoria?: string
  activo:     boolean
  created_at: string
}

// ─── Componente NegocioRow ────────────────────────────────────
function NegocioRow({
  negocio,
  onToggle,
  toggling,
}: {
  negocio:  Negocio
  onToggle: (id: string, activo: boolean) => void
  toggling: boolean
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.info}>
        <View style={[rowStyles.avatar, { backgroundColor: negocio.activo ? C.success + '22' : C.border }]}>
          <Text style={rowStyles.avatarText}>🏪</Text>
        </View>
        <View style={rowStyles.infoText}>
          <Text style={rowStyles.nombre} numberOfLines={1}>{negocio.nombre}</Text>
          {negocio.categoria ? (
            <Text style={rowStyles.categoria}>{negocio.categoria}</Text>
          ) : null}
          <Text style={[rowStyles.estadoLabel, { color: negocio.activo ? C.success : C.textLight }]}>
            {negocio.activo ? '● Activo' : '○ Inactivo'}
          </Text>
        </View>
      </View>
      <Switch
        value={negocio.activo}
        onValueChange={val => onToggle(negocio.id, val)}
        disabled={toggling}
        trackColor={{ false: C.border, true: C.success + '88' }}
        thumbColor={negocio.activo ? C.success : '#ccc'}
        ios_backgroundColor={C.border}
      />
    </View>
  )
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    backgroundColor: C.surface,
    borderRadius:    12,
    padding:         14,
    marginBottom:    8,
    borderWidth:     1,
    borderColor:     C.border,
    ...(Platform.OS === 'web' ? { boxShadow: '0 1px 3px rgba(0,0,0,0.05)' } as any : {
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
    }),
  },
  info: {
    flexDirection: 'row',
    alignItems:    'center',
    flex:          1,
    marginRight:   12,
    gap:           12,
  },
  avatar: {
    width:        44,
    height:       44,
    borderRadius: 10,
    alignItems:   'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20 },
  infoText:   { flex: 1 },
  nombre: {
    fontSize:   15,
    fontWeight: '700',
    color:      C.text,
  },
  categoria: {
    fontSize:  12,
    color:     C.textLight,
    marginTop: 2,
  },
  estadoLabel: {
    fontSize:   12,
    fontWeight: '600',
    marginTop:  2,
  },
})

// ─── Pantalla principal ───────────────────────────────────────
export default function NegociosAdminScreen() {
  const [negocios,   setNegocios]   = useState<Negocio[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busqueda,   setBusqueda]   = useState('')
  const [toggling,   setToggling]   = useState<string | null>(null) // id del negocio en toggle

  // ── Cargar negocios ─────────────────────────────────────────
  const fetchNegocios = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase
      .from('negocios')
      .select('id, nombre, categoria, activo, created_at')
      .order('nombre', { ascending: true })

    if (!error && data) setNegocios(data as Negocio[])
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchNegocios() }, [fetchNegocios])

  // ── Toggle activo ───────────────────────────────────────────
  const handleToggle = async (id: string, nuevoValor: boolean) => {
    // Optimistic update
    setNegocios(prev =>
      prev.map(n => n.id === id ? { ...n, activo: nuevoValor } : n)
    )
    setToggling(id)

    const { error } = await supabase
      .from('negocios')
      .update({ activo: nuevoValor })
      .eq('id', id)

    if (error) {
      // Revertir en caso de error
      setNegocios(prev =>
        prev.map(n => n.id === id ? { ...n, activo: !nuevoValor } : n)
      )
      const msg = `No se pudo ${nuevoValor ? 'activar' : 'desactivar'} el negocio.`
      if (Platform.OS === 'web') {
        window.alert(msg)
      } else {
        Alert.alert('Error', msg)
      }
    }
    setToggling(null)
  }

  // ── Filtro por búsqueda ─────────────────────────────────────
  const negociosFiltrados = negocios.filter(n =>
    n.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (n.categoria ?? '').toLowerCase().includes(busqueda.toLowerCase())
  )

  const activos   = negociosFiltrados.filter(n => n.activo).length
  const inactivos = negociosFiltrados.filter(n => !n.activo).length

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
          <Text style={styles.title}>Gestión de negocios</Text>
          <Text style={styles.subtitle}>
            {activos} activos · {inactivos} inactivos
          </Text>
        </View>
      </View>

      {/* Buscador */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar negocio…"
            placeholderTextColor={C.textLight}
            value={busqueda}
            onChangeText={setBusqueda}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Lista */}
      <FlatList
        data={negociosFiltrados}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <NegocioRow
            negocio={item}
            onToggle={handleToggle}
            toggling={toggling === item.id}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchNegocios() }}
            colors={[C.primary]}
            tintColor={C.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🏪</Text>
            <Text style={styles.emptyTitle}>
              {busqueda ? 'Sin resultados' : 'No hay negocios registrados'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {busqueda
                ? `No encontramos negocios con "${busqueda}".`
                : 'Los negocios aparecerán aquí cuando se registren.'}
            </Text>
          </View>
        }
      />
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
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
  searchWrapper: {
    paddingHorizontal: 16,
    paddingVertical:   10,
    backgroundColor:   C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems:    'center',
    backgroundColor: C.inputBg,
    borderRadius:  10,
    paddingHorizontal: 10,
    gap: 6,
  },
  searchIcon:  { fontSize: 14, color: C.textLight },
  searchInput: {
    flex:          1,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize:      14,
    color:         C.text,
    outlineStyle:  'none' as any,
  },
  list: { padding: 16, paddingBottom: 32 },
  empty: {
    alignItems:   'center',
    paddingTop:   60,
    paddingHorizontal: 32,
  },
  emptyIcon:     { fontSize: 48, marginBottom: 12 },
  emptyTitle:    { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: C.textLight, textAlign: 'center', lineHeight: 20 },
})
