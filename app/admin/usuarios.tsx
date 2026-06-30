/**
 * app/admin/usuarios.tsx
 * ─────────────────────────────────────────────────────────────
 * Sección 3 del Panel Admin: Gestión de usuarios.
 *
 * Características:
 *  • Lista todos los usuarios con nombre, email y rol actual.
 *  • Selector de rol inline (cliente / repartidor / admin).
 *  • Confirmación antes de elevar a admin (medida de seguridad).
 *  • Buscador por nombre o email.
 *  • Feedback optimista con rollback en error.
 *  • Badge de color por rol.
 *
 * Supuestos de esquema:
 *  profiles: id, nombre, email, rol, created_at
 *  rol:      'cliente' | 'repartidor' | 'admin'
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Platform,
  Alert,
  Modal,
  Pressable,
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
  inputBg:   '#F1F3F5',
}

// ─── Roles ─────────────────────────────────────────────────────
type Rol = 'cliente' | 'repartidor' | 'admin'

const ROLES: { value: Rol; label: string; color: string; bg: string }[] = [
  { value: 'cliente',    label: 'Cliente',    color: '#4A90E2', bg: '#4A90E222' },
  { value: 'repartidor', label: 'Repartidor', color: '#F4A261', bg: '#F4A26122' },
  { value: 'admin',      label: 'Admin',      color: '#E63946', bg: '#E6394622' },
]

// ─── Tipo Usuario ──────────────────────────────────────────────
type Usuario = {
  id:         string
  nombre:     string
  email:      string
  rol:        Rol
  created_at: string
}

// ─── Componente RolBadge ────────────────────────────────────
function RolBadge({ rol }: { rol: Rol }) {
  const info = ROLES.find(r => r.value === rol)
  if (!info) return null
  return (
    <View style={[badgeS.badge, { backgroundColor: info.bg }]}>
      <Text style={[badgeS.text, { color: info.color }]}>{info.label}</Text>
    </View>
  )
}
const badgeS = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      12,
  },
  text: { fontSize: 12, fontWeight: '700' },
})

// ─── Componente UsuarioRow ────────────────────────────────────
function UsuarioRow({
  usuario,
  onCambiarRol,
  saving,
}: {
  usuario:       Usuario
  onCambiarRol:  (id: string, currentRol: Rol) => void
  saving:        boolean
}) {
  const initials = (usuario.nombre ?? '?')
    .split(' ')
    .map((w: string) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <View style={rowS.row}>
      {/* Avatar con iniciales */}
      <View style={rowS.avatar}>
        <Text style={rowS.avatarText}>{initials || '?'}</Text>
      </View>

      {/* Info */}
      <View style={rowS.info}>
        <Text style={rowS.nombre} numberOfLines={1}>
          {usuario.nombre || 'Sin nombre'}
        </Text>
        <Text style={rowS.email} numberOfLines={1}>{usuario.email}</Text>
        <RolBadge rol={usuario.rol} />
      </View>

      {/* Botón cambiar rol */}
      <TouchableOpacity
        style={[rowS.btn, saving && rowS.btnDisabled]}
        onPress={() => onCambiarRol(usuario.id, usuario.rol)}
        disabled={saving}
        activeOpacity={0.7}
      >
        {saving ? (
          <ActivityIndicator size="small" color={C.primary} />
        ) : (
          <Text style={rowS.btnText}>Rol ›</Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const rowS = StyleSheet.create({
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: C.surface,
    borderRadius:    12,
    padding:         14,
    marginBottom:    8,
    borderWidth:     1,
    borderColor:     C.border,
    gap:             12,
    ...(Platform.OS === 'web' ? { boxShadow: '0 1px 3px rgba(0,0,0,0.05)' } as any : {
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
    }),
  },
  avatar: {
    width:           44,
    height:          44,
    borderRadius:    22,
    backgroundColor: C.primary + '22',
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: C.primary },
  info: { flex: 1, gap: 2 },
  nombre: { fontSize: 14, fontWeight: '700', color: C.text },
  email:  { fontSize: 12, color: C.textLight },
  btn: {
    paddingVertical:   7,
    paddingHorizontal: 14,
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       C.primary,
    backgroundColor:   C.primary + '10',
    minWidth:          60,
    alignItems:        'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: C.primary, fontSize: 13, fontWeight: '700' },
})

// ─── Pantalla principal ───────────────────────────────────────
export default function UsuariosAdminScreen() {
  const [usuarios,    setUsuarios]    = useState<Usuario[]>([])
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [busqueda,    setBusqueda]    = useState('')
  const [savingId,    setSavingId]    = useState<string | null>(null)
  const [modalData,   setModalData]   = useState<{ id: string; rolActual: Rol } | null>(null)

  // ── Cargar usuarios ─────────────────────────────────────────
  const fetchUsuarios = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nombre, email, rol, created_at')
      .order('nombre', { ascending: true })

    if (!error && data) setUsuarios(data as Usuario[])
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchUsuarios() }, [fetchUsuarios])

  // ── Cambiar rol ─────────────────────────────────────────────
  const abrirSelectorRol = (id: string, rolActual: Rol) => {
    setModalData({ id, rolActual })
  }

  const confirmarCambioRol = async (nuevoRol: Rol) => {
    if (!modalData) return

    const usuario = usuarios.find(u => u.id === modalData.id)
    if (!usuario || usuario.rol === nuevoRol) {
      setModalData(null)
      return
    }

    // Advertir antes de elevar a admin
    if (nuevoRol === 'admin') {
      const confirmar = Platform.OS === 'web'
        ? window.confirm(`¿Estás seguro de que quieres hacer admin a ${usuario.nombre || usuario.email}? Tendrá acceso total al panel.`)
        : await new Promise<boolean>(resolve =>
            Alert.alert(
              'Promover a Admin',
              `¿Hacer admin a ${usuario.nombre || usuario.email}? Tendrá acceso total al panel.`,
              [
                { text: 'Cancelar', onPress: () => resolve(false), style: 'cancel' },
                { text: 'Confirmar', onPress: () => resolve(true), style: 'destructive' },
              ]
            )
          )
      if (!confirmar) { setModalData(null); return }
    }

    setModalData(null)
    setSavingId(modalData.id)

    // Optimistic update
    setUsuarios(prev =>
      prev.map(u => u.id === modalData.id ? { ...u, rol: nuevoRol } : u)
    )

    const { error } = await supabase
      .from('profiles')
      .update({ rol: nuevoRol })
      .eq('id', modalData.id)

    if (error) {
      // Revertir
      setUsuarios(prev =>
        prev.map(u => u.id === modalData.id ? { ...u, rol: usuario.rol } : u)
      )
      const msg = 'No se pudo actualizar el rol. Intenta nuevamente.'
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg)
    }
    setSavingId(null)
  }

  // ── Filtro ──────────────────────────────────────────────────
  const usuariosFiltrados = usuarios.filter(u => {
    const q = busqueda.toLowerCase()
    return (
      (u.nombre ?? '').toLowerCase().includes(q) ||
      (u.email  ?? '').toLowerCase().includes(q) ||
      u.rol.toLowerCase().includes(q)
    )
  })

  // ── Contadores por rol ──────────────────────────────────────
  const counts = usuarios.reduce(
    (acc, u) => { acc[u.rol] = (acc[u.rol] ?? 0) + 1; return acc },
    {} as Record<Rol, number>
  )

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
          <Text style={styles.title}>Gestión de usuarios</Text>
          <Text style={styles.subtitle}>
            {counts.cliente ?? 0} clientes · {counts.repartidor ?? 0} repartidores · {counts.admin ?? 0} admins
          </Text>
        </View>
      </View>

      {/* Buscador */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre, email o rol…"
            placeholderTextColor={C.textLight}
            value={busqueda}
            onChangeText={setBusqueda}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Lista */}
      <FlatList
        data={usuariosFiltrados}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <UsuarioRow
            usuario={item}
            onCambiarRol={abrirSelectorRol}
            saving={savingId === item.id}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchUsuarios() }}
            colors={[C.primary]}
            tintColor={C.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>
              {busqueda ? 'Sin resultados' : 'No hay usuarios'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {busqueda
                ? `No encontramos usuarios con "${busqueda}".`
                : 'Los usuarios aparecerán aquí cuando se registren.'}
            </Text>
          </View>
        }
      />

      {/* Modal selector de rol */}
      <Modal
        visible={!!modalData}
        transparent
        animationType="slide"
        onRequestClose={() => setModalData(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setModalData(null)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Cambiar rol</Text>
            <Text style={styles.modalSubtitle}>
              {usuarios.find(u => u.id === modalData?.id)?.nombre || 'Usuario'}
            </Text>

            {ROLES.map(r => {
              const isActual = modalData?.rolActual === r.value
              return (
                <TouchableOpacity
                  key={r.value}
                  style={[styles.rolOption, isActual && styles.rolOptionActive]}
                  onPress={() => confirmarCambioRol(r.value)}
                  disabled={isActual}
                  activeOpacity={0.7}
                >
                  <View style={[styles.rolDot, { backgroundColor: r.color }]} />
                  <Text style={[styles.rolLabel, { color: isActual ? r.color : C.text }]}>
                    {r.label}
                  </Text>
                  {isActual && (
                    <View style={[styles.rolActualBadge, { backgroundColor: r.bg }]}>
                      <Text style={[styles.rolActualText, { color: r.color }]}>Actual</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )
            })}

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setModalData(null)}
            >
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  header: {
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
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   C.inputBg,
    borderRadius:      10,
    paddingHorizontal: 10,
    gap:               6,
  },
  searchIcon:  { fontSize: 14, color: C.textLight },
  searchInput: {
    flex:            1,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize:        14,
    color:           C.text,
    outlineStyle:    'none' as any,
  },
  list: { padding: 16, paddingBottom: 32 },
  empty: {
    alignItems:        'center',
    paddingTop:        60,
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
    backgroundColor:      C.surface,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    paddingHorizontal:    20,
    paddingBottom:        40,
    paddingTop:           12,
  },
  modalHandle: {
    width:           44,
    height:          5,
    backgroundColor: C.border,
    borderRadius:    3,
    alignSelf:       'center',
    marginBottom:    20,
  },
  modalTitle:    { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: C.textLight, marginBottom: 16 },
  rolOption: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   14,
    paddingHorizontal: 14,
    borderRadius:      10,
    marginBottom:      6,
    backgroundColor:   C.bg,
    gap:               10,
  },
  rolOptionActive: {
    backgroundColor: '#F8F9FA',
    borderWidth:     1,
    borderColor:     C.border,
    opacity:         0.7,
  },
  rolDot:  { width: 10, height: 10, borderRadius: 5 },
  rolLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  rolActualBadge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      10,
  },
  rolActualText: { fontSize: 11, fontWeight: '700' },
  cancelBtn: {
    marginTop:       12,
    paddingVertical: 14,
    borderRadius:    12,
    backgroundColor: C.inputBg,
    alignItems:      'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: C.textLight },
})
