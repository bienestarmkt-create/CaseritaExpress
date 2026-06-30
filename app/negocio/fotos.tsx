/**
 * app/negocio/fotos.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Anfitrión — Fotos del Local
 *
 * - Grilla de fotos actuales del negocio.
 * - Máximo 5 fotos por negocio.
 * - Botón "Subir foto" deshabilitado al llegar a 5 (con mensaje).
 * - Botón eliminar por foto individual con confirmación.
 * - Storage bucket: 'negocios-fotos'.
 * - Mismo patrón de upload que pago-qr.tsx.
 * - Las URLs se guardan en tabla: negocio_fotos (ver SQL).
 *   Columnas: id, negocio_id, url, created_at
 * ─────────────────────────────────────────────────────────────
 */

import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'

const MAX_FOTOS = 5

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

type FotoNegocio = {
  id:        string
  negocio_id:string
  url:       string
  created_at:string
}

// ─── Componente principal ─────────────────────────────────────
export default function FotosScreen() {
  const [fotos,      setFotos]      = useState<FotoNegocio[]>([])
  const [loading,    setLoading]    = useState(true)
  const [subiendo,   setSubiendo]   = useState(false)
  const [negocioId,  setNegocioId]  = useState<string | null>(null)
  const [eliminando, setEliminando] = useState<string | null>(null)

  // ── Obtener negocio_id ────────────────────────────────────
  const initNegocio = useCallback(async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('negocios').select('id').eq('usuario_id', user.id).single()
    return data?.id ?? null
  }, [])

  // ── Cargar fotos ──────────────────────────────────────────
  const fetchFotos = useCallback(async (nid?: string) => {
    const id = nid ?? negocioId
    if (!id) return
    const { data, error } = await supabase
      .from('negocio_fotos')
      .select('id, negocio_id, url, created_at')
      .eq('negocio_id', id)
      .order('created_at', { ascending: true })
    if (!error && data) setFotos(data as FotoNegocio[])
  }, [negocioId])

  // ── Init ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true
    const init = async () => {
      const nid = await initNegocio()
      if (!nid || !mounted) { setLoading(false); return }
      setNegocioId(nid)
      await fetchFotos(nid)
      setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [])

  // ── Subir foto ────────────────────────────────────────────
  const subirFoto = async () => {
    if (fotos.length >= MAX_FOTOS) return

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    })
    if (result.canceled || !result.assets.length) return

    const uri = result.assets[0].uri
    setSubiendo(true)

    try {
      // Upload a Storage
      const response = await fetch(uri)
      const blob = await response.blob()
      const arrayBuffer = await new Response(blob).arrayBuffer()
      const fileName = `${negocioId}/foto_${Date.now()}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('negocios-fotos')
        .upload(fileName, arrayBuffer, { contentType: 'image/jpeg', upsert: false })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('negocios-fotos')
        .getPublicUrl(fileName)

      // Guardar referencia en tabla negocio_fotos
      const { error: insertError } = await supabase
        .from('negocio_fotos')
        .insert({ negocio_id: negocioId, url: urlData.publicUrl })

      if (insertError) throw insertError

      await fetchFotos()
    } catch (e: any) {
      Alert.alert('Error al subir', e?.message ?? 'No se pudo subir la foto. Verifica que el bucket "negocios-fotos" exista en Supabase Storage.')
    } finally {
      setSubiendo(false)
    }
  }

  // ── Eliminar foto ─────────────────────────────────────────
  const confirmarEliminar = (foto: FotoNegocio) => {
    Alert.alert(
      'Eliminar foto',
      '¿Seguro que quieres eliminar esta foto?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            setEliminando(foto.id)
            // Eliminar de la tabla
            await supabase.from('negocio_fotos').delete().eq('id', foto.id)
            // Eliminar del Storage (extraer path del URL)
            try {
              const url = new URL(foto.url)
              const pathParts = url.pathname.split('/negocios-fotos/')
              if (pathParts.length > 1) {
                await supabase.storage.from('negocios-fotos').remove([pathParts[1]])
              }
            } catch { /* si falla el delete de Storage, la fila ya no está */ }
            setFotos(prev => prev.filter(f => f.id !== foto.id))
            setEliminando(null)
          },
        },
      ]
    )
  }

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Cargando fotos…</Text>
      </View>
    )
  }

  const limiteAlcanzado = fotos.length >= MAX_FOTOS

  // ── Render ────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Encabezado */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Fotos del local</Text>
          <Text style={styles.headerSub}>{fotos.length} de {MAX_FOTOS} fotos</Text>
        </View>
        <TouchableOpacity
          style={[styles.btnSubir, (limiteAlcanzado || subiendo) && styles.btnDisabled]}
          onPress={subirFoto}
          disabled={limiteAlcanzado || subiendo}
          activeOpacity={0.7}
        >
          {subiendo
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnSubirText}>📷 Subir foto</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Aviso de límite */}
      {limiteAlcanzado && (
        <View style={styles.limiteBanner}>
          <Text style={styles.limiteText}>
            ✋ Alcanzaste el máximo de {MAX_FOTOS} fotos. Elimina una para poder agregar otra.
          </Text>
        </View>
      )}

      {/* Barra de progreso */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(fotos.length / MAX_FOTOS) * 100}%` as any }]} />
      </View>

      {/* Grilla de fotos */}
      {fotos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📸</Text>
          <Text style={styles.emptyTitle}>Sin fotos todavía</Text>
          <Text style={styles.emptySub}>
            Agrega fotos atractivas de tu local para que los clientes se animen a pedir.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {fotos.map(foto => (
            <View key={foto.id} style={styles.gridItem}>
              <Image
                source={{ uri: foto.url }}
                style={styles.gridImg}
                resizeMode="cover"
              />
              <TouchableOpacity
                style={[styles.btnEliminar, eliminando === foto.id && styles.btnDisabled]}
                onPress={() => confirmarEliminar(foto)}
                disabled={eliminando === foto.id}
                activeOpacity={0.7}
              >
                {eliminando === foto.id
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.btnEliminarText}>🗑️</Text>
                }
              </TouchableOpacity>
            </View>
          ))}

          {/* Placeholder vacíos */}
          {Array.from({ length: MAX_FOTOS - fotos.length }).map((_, i) => (
            <View key={`placeholder-${i}`} style={[styles.gridItem, styles.gridPlaceholder]}>
              <Text style={styles.gridPlaceholderIcon}>+</Text>
            </View>
          ))}
        </View>
      )}

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>💡 Consejos para tus fotos</Text>
        <Text style={styles.infoText}>• Usa buena iluminación natural.</Text>
        <Text style={styles.infoText}>• Muestra el interior y el ambiente del local.</Text>
        <Text style={styles.infoText}>• Incluye fotos de tus platos más populares.</Text>
        <Text style={styles.infoText}>• Formato recomendado: horizontal (16:9).</Text>
      </View>
    </ScrollView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const ITEM_SIZE = Platform.OS === 'web' ? 180 : 160

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  content:     { padding: 16, paddingBottom: 40, gap: 16 },
  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg, gap: 12 },
  loadingText: { color: C.textLight, fontSize: 14 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  headerSub:   { fontSize: 12, color: C.textLight, marginTop: 2 },
  btnSubir: {
    backgroundColor: C.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10,
  },
  btnSubirText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDisabled:  { opacity: 0.5 },

  limiteBanner: {
    backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  limiteText: { fontSize: 13, color: '#92400E', lineHeight: 18 },

  progressBar: {
    height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 3 },

  // Grilla
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  gridItem: {
    width: ITEM_SIZE, height: ITEM_SIZE, borderRadius: 12, overflow: 'hidden',
    position: 'relative',
  },
  gridImg:             { width: '100%', height: '100%' },
  gridPlaceholder:     {
    backgroundColor: C.border, borderWidth: 2, borderColor: C.border,
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center',
  },
  gridPlaceholderIcon: { fontSize: 28, color: C.textLight },

  btnEliminar: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20,
    width: 32, height: 32, justifyContent: 'center', alignItems: 'center',
  },
  btnEliminarText: { fontSize: 14 },

  // Empty
  empty:      { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptySub:   { fontSize: 13, color: C.textLight, textAlign: 'center', maxWidth: 260, lineHeight: 20 },

  // Info
  infoCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 16, gap: 6,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#166534', marginBottom: 2 },
  infoText:  { fontSize: 13, color: '#15803D', lineHeight: 20 },
})
