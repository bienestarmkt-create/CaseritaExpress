/**
 * app/negocio/menu.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Anfitrión — Gestión de Menú (Productos)
 *
 * - Lista de productos del negocio con Realtime.
 * - Switch para activar/desactivar cada producto.
 * - Modal para agregar o editar producto: nombre, descripción,
 *   precio, categoría, foto (Supabase Storage 'productos-fotos').
 * - Botón eliminar con confirmación.
 * - Usa expo-image-picker (ya en package.json), mismo patrón
 *   que pago-qr.tsx: fetch → blob → arrayBuffer → upload.
 * ─────────────────────────────────────────────────────────────
 */

import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Tipos ────────────────────────────────────────────────────
type Producto = {
  id:          string
  negocio_id:  string
  nombre:      string
  descripcion: string | null
  precio:      number
  categoria:   string | null
  disponible:  boolean
  imagen_url:  string | null
}

type FormProducto = {
  nombre:      string
  descripcion: string
  precio:      string
  categoria:   string
  imageUri:    string | null    // URI local seleccionada (aún no subida)
  imagen_url:  string | null    // URL pública ya en Storage
}

const FORM_INICIAL: FormProducto = {
  nombre: '', descripcion: '', precio: '', categoria: '', imageUri: null, imagen_url: null,
}

const CATEGORIAS = ['Plato principal', 'Entrada', 'Bebida', 'Postre', 'Snack', 'Otro']

// ─── Tema ─────────────────────────────────────────────────────
const C = {
  primary:   '#16A34A',
  bg:        '#F9FAFB',
  surface:   '#FFFFFF',
  border:    '#E5E7EB',
  text:      '#1E0A3C',
  textLight: '#9CA3AF',
  danger:    '#EF4444',
}

// ─── Componente principal ─────────────────────────────────────
export default function MenuScreen() {
  const [productos,    setProductos]    = useState<Producto[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [negocioId,    setNegocioId]    = useState<string | null>(null)
  const [toggling,     setToggling]     = useState<string | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [editando,     setEditando]     = useState<Producto | null>(null)  // null = nuevo
  const [form,         setForm]         = useState<FormProducto>(FORM_INICIAL)
  const [saving,       setSaving]       = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)

  // ── Obtener negocio_id ────────────────────────────────────
  const initNegocio = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('negocios').select('id').eq('usuario_id', user.id).single()
    return data?.id ?? null
  }, [])

  // ── Cargar productos ──────────────────────────────────────
  const fetchProductos = useCallback(async (nid?: string) => {
    const id = nid ?? negocioId
    if (!id) return
    const { data, error } = await supabase
      .from('productos')
      .select('id, negocio_id, nombre, descripcion, precio, categoria, disponible, imagen_url')
      .eq('negocio_id', id)
      .order('nombre', { ascending: true })
    if (!error && data) setProductos(data as Producto[])
  }, [negocioId])

  // ── Init ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true
    const init = async () => {
      const nid = await initNegocio()
      if (!nid || !mounted) { setLoading(false); return }
      setNegocioId(nid)
      await fetchProductos(nid)
      setLoading(false)
      const ch = supabase
        .channel(`negocio-menu-${nid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'productos', filter: `negocio_id=eq.${nid}` },
          () => fetchProductos(nid))
        .subscribe()
      channelRef.current = ch
    }
    init()
    return () => { mounted = false; channelRef.current?.unsubscribe() }
  }, [])

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchProductos()
    setRefreshing(false)
  }

  // ── Toggle disponible ─────────────────────────────────────
  const toggleDisponible = async (producto: Producto) => {
    setToggling(producto.id)
    const nuevoValor = !producto.disponible
    setProductos(prev => prev.map(p => p.id === producto.id ? { ...p, disponible: nuevoValor } : p))
    const { error } = await supabase
      .from('productos').update({ disponible: nuevoValor }).eq('id', producto.id)
    if (error) {
      setProductos(prev => prev.map(p => p.id === producto.id ? { ...p, disponible: producto.disponible } : p))
    }
    setToggling(null)
  }

  // ── Seleccionar imagen ────────────────────────────────────
  const seleccionarImagen = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para subir fotos de productos.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    })
    if (!result.canceled && result.assets.length > 0) {
      setForm(f => ({ ...f, imageUri: result.assets[0].uri }))
    }
  }

  // ── Subir imagen a Storage ────────────────────────────────
  const subirImagen = async (uri: string, productoId: string): Promise<string | null> => {
    try {
      const response = await fetch(uri)
      const blob = await response.blob()
      const arrayBuffer = await new Response(blob).arrayBuffer()
      const filePath = `${negocioId}/${productoId}/foto_${Date.now()}.jpg`
      const { error } = await supabase.storage
        .from('productos-fotos')
        .upload(filePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true })
      if (error) return null
      const { data } = supabase.storage.from('productos-fotos').getPublicUrl(filePath)
      return data.publicUrl
    } catch {
      return null
    }
  }

  // ── Abrir modal ───────────────────────────────────────────
  const abrirNuevo = () => {
    setEditando(null)
    setForm(FORM_INICIAL)
    setModalVisible(true)
  }

  const abrirEditar = (producto: Producto) => {
    setEditando(producto)
    setForm({
      nombre:      producto.nombre,
      descripcion: producto.descripcion ?? '',
      precio:      String(producto.precio),
      categoria:   producto.categoria ?? '',
      imageUri:    null,
      imagen_url:  producto.imagen_url,
    })
    setModalVisible(true)
  }

  // ── Guardar producto ──────────────────────────────────────
  const guardar = async () => {
    if (!form.nombre.trim()) { Alert.alert('Campo requerido', 'El nombre del producto es obligatorio.'); return }
    const precioNum = parseFloat(form.precio)
    if (isNaN(precioNum) || precioNum <= 0) { Alert.alert('Precio inválido', 'Ingresa un precio válido mayor a 0.'); return }
    if (!negocioId) return

    setSaving(true)
    try {
      if (editando) {
        // ── EDITAR ──
        let imagenUrl = form.imagen_url
        if (form.imageUri) {
          const url = await subirImagen(form.imageUri, editando.id)
          if (url) imagenUrl = url
        }
        const { error } = await supabase.from('productos').update({
          nombre:      form.nombre.trim(),
          descripcion: form.descripcion.trim() || null,
          precio:      precioNum,
          categoria:   form.categoria || null,
          imagen_url:  imagenUrl,
        }).eq('id', editando.id)
        if (error) throw error
      } else {
        // ── CREAR ──
        const { data: nuevo, error: insertError } = await supabase.from('productos').insert({
          negocio_id:  negocioId,
          nombre:      form.nombre.trim(),
          descripcion: form.descripcion.trim() || null,
          precio:      precioNum,
          categoria:   form.categoria || null,
          disponible:  true,
          imagen_url:  null,
        }).select('id').single()
        if (insertError || !nuevo) throw insertError
        // Subir imagen después de tener el ID
        if (form.imageUri) {
          const url = await subirImagen(form.imageUri, nuevo.id)
          if (url) await supabase.from('productos').update({ imagen_url: url }).eq('id', nuevo.id)
        }
      }
      setModalVisible(false)
      await fetchProductos()
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar el producto.')
    } finally {
      setSaving(false)
    }
  }

  // ── Eliminar producto ─────────────────────────────────────
  const eliminar = (producto: Producto) => {
    Alert.alert(
      'Eliminar producto',
      `¿Eliminar "${producto.nombre}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            setProductos(prev => prev.filter(p => p.id !== producto.id))
            await supabase.from('productos').delete().eq('id', producto.id)
          },
        },
      ]
    )
  }

  // ── Render ítem ───────────────────────────────────────────
  const renderProducto = ({ item }: { item: Producto }) => (
    <View style={styles.card}>
      {item.imagen_url ? (
        <Image source={{ uri: item.imagen_url }} style={styles.cardImg} resizeMode="cover" />
      ) : (
        <View style={styles.cardImgPlaceholder}>
          <Text style={styles.cardImgPlaceholderIcon}>🍽️</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <View style={styles.cardInfo}>
            <Text style={styles.cardNombre} numberOfLines={1}>{item.nombre}</Text>
            {item.categoria ? <Text style={styles.cardCategoria}>{item.categoria}</Text> : null}
            {item.descripcion ? <Text style={styles.cardDesc} numberOfLines={2}>{item.descripcion}</Text> : null}
            <Text style={styles.cardPrecio}>Bs {Number(item.precio).toFixed(2)}</Text>
          </View>
          <Switch
            value={item.disponible}
            onValueChange={() => toggleDisponible(item)}
            disabled={toggling === item.id}
            trackColor={{ false: C.border, true: C.primary + '80' }}
            thumbColor={item.disponible ? C.primary : '#ccc'}
          />
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.btnEditar} onPress={() => abrirEditar(item)} activeOpacity={0.7}>
            <Text style={styles.btnEditarText}>✏️ Editar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnEliminar} onPress={() => eliminar(item)} activeOpacity={0.7}>
            <Text style={styles.btnEliminarText}>🗑️ Eliminar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )

  // ── Modal form ────────────────────────────────────────────
  const renderModal = () => (
    <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => !saving && setModalVisible(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.modalOverlay} onPress={() => !saving && setModalVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{editando ? 'Editar producto' : 'Nuevo producto'}</Text>

              {/* Foto */}
              <TouchableOpacity style={styles.fotoBtn} onPress={seleccionarImagen} activeOpacity={0.7}>
                {(form.imageUri ?? form.imagen_url) ? (
                  <Image source={{ uri: form.imageUri ?? form.imagen_url! }} style={styles.fotoPreview} resizeMode="cover" />
                ) : (
                  <View style={styles.fotoPlaceholder}>
                    <Text style={styles.fotoIcon}>📷</Text>
                    <Text style={styles.fotoLabel}>Agregar foto</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={styles.formLabel}>Nombre *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Ej: Salteña de pollo"
                value={form.nombre}
                onChangeText={v => setForm(f => ({ ...f, nombre: v }))}
              />

              <Text style={styles.formLabel}>Descripción</Text>
              <TextInput
                style={[styles.formInput, { height: 72, textAlignVertical: 'top' }]}
                placeholder="Describe el producto…"
                multiline
                value={form.descripcion}
                onChangeText={v => setForm(f => ({ ...f, descripcion: v }))}
              />

              <Text style={styles.formLabel}>Precio (Bs) *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={form.precio}
                onChangeText={v => setForm(f => ({ ...f, precio: v }))}
              />

              <Text style={styles.formLabel}>Categoría</Text>
              <View style={styles.categoriasRow}>
                {CATEGORIAS.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, form.categoria === cat && styles.catChipActive]}
                    onPress={() => setForm(f => ({ ...f, categoria: f.categoria === cat ? '' : cat }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.catChipText, form.categoria === cat && styles.catChipTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.btnGuardar, saving && styles.btnDisabled]}
                onPress={guardar}
                disabled={saving}
                activeOpacity={0.7}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.btnGuardarText}>{editando ? '💾 Guardar cambios' : '✅ Agregar producto'}</Text>
                }
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Cargando menú…</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Encabezado con botón agregar */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Mis productos ({productos.length})</Text>
        <TouchableOpacity style={styles.btnAgregar} onPress={abrirNuevo} activeOpacity={0.7}>
          <Text style={styles.btnAgregarText}>+ Agregar</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={productos}
        keyExtractor={item => item.id}
        renderItem={renderProducto}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🍽️</Text>
            <Text style={styles.emptyTitle}>Sin productos todavía</Text>
            <Text style={styles.emptySub}>Toca "+ Agregar" para crear tu primer producto.</Text>
          </View>
        }
      />

      {renderModal()}
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg, gap: 12 },
  loadingText: { color: C.textLight, fontSize: 14 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  topBarTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  btnAgregar: {
    backgroundColor: C.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
  },
  btnAgregarText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  listContent: { padding: 16, paddingBottom: 32, gap: 12 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardImg:             { width: 90, height: 90 },
  cardImgPlaceholder:  { width: 90, height: 90, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  cardImgPlaceholderIcon: { fontSize: 28 },
  cardBody:      { flex: 1, padding: 12, gap: 8 },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardInfo:      { flex: 1, gap: 2 },
  cardNombre:    { fontSize: 14, fontWeight: '700', color: C.text },
  cardCategoria: { fontSize: 11, color: C.primary, fontWeight: '600' },
  cardDesc:      { fontSize: 12, color: C.textLight, lineHeight: 16 },
  cardPrecio:    { fontSize: 15, fontWeight: '700', color: C.text, marginTop: 2 },
  cardActions:   { flexDirection: 'row', gap: 8 },
  btnEditar:     {
    flex: 1, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.primary + '15', alignItems: 'center',
  },
  btnEditarText:   { fontSize: 12, fontWeight: '600', color: C.primary },
  btnEliminar:     {
    flex: 1, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.danger + '12', alignItems: 'center',
  },
  btnEliminarText: { fontSize: 12, fontWeight: '600', color: C.danger },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 32, paddingTop: 12, maxHeight: '92%',
  },
  modalHandle: {
    width: 44, height: 5, backgroundColor: C.border, borderRadius: 3,
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },

  fotoBtn:         { alignSelf: 'center', marginBottom: 16 },
  fotoPreview:     { width: 120, height: 120, borderRadius: 12 },
  fotoPlaceholder: {
    width: 120, height: 120, borderRadius: 12, backgroundColor: '#F3F4F6',
    borderWidth: 2, borderColor: C.border, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', gap: 6,
  },
  fotoIcon:  { fontSize: 32 },
  fotoLabel: { fontSize: 12, color: C.textLight, fontWeight: '600' },

  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 6, marginTop: 12 },
  formInput: {
    backgroundColor: C.bg, borderRadius: 10, padding: 12,
    fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border,
  },

  categoriasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  catChipActive:    { backgroundColor: C.primary, borderColor: C.primary },
  catChipText:      { fontSize: 12, color: C.textLight, fontWeight: '600' },
  catChipTextActive:{ color: '#fff' },

  btnGuardar: {
    marginTop: 20, paddingVertical: 14, borderRadius: 12,
    backgroundColor: C.primary, alignItems: 'center',
  },
  btnGuardarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled:    { opacity: 0.6 },

  empty:      { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptySub:   { fontSize: 13, color: C.textLight, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
})
