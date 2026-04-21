import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { supabase } from '../lib/supabase';

const CATEGORIAS = [
  { id: 1, nombre: 'Restaurantes', emoji: '🍽️' },
  { id: 2, nombre: 'Supermercados', emoji: '🛒' },
  { id: 3, nombre: 'Farmacias', emoji: '💊' },
  { id: 4, nombre: 'Bebidas', emoji: '🥤' },
  { id: 5, nombre: 'Cafeterías', emoji: '☕' },
  { id: 6, nombre: 'Heladerías', emoji: '🍦' },
];

const CIUDADES = ['Todas', 'Tarija', 'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí', 'Sucre', 'Trinidad', 'Cobija'];

export default function DeliveryScreen() {
  const router = useRouter();
  const { agregarItem, quitarItem, getCantidad, totalItems } = useCarrito();
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('Restaurantes');
  const [ciudadActiva, setCiudadActiva] = useState('Todas');
  const [restauranteActivo, setRestauranteActivo] = useState<string | null>(null);
  const [restaurantes, setRestaurantes] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setCargando(true);
    const { data: negocios } = await supabase.from('negocios').select('*').eq('activo', true);
    const { data: prods } = await supabase.from('productos').select('*').eq('disponible', true);
    if (negocios) setRestaurantes(negocios);
    if (prods) setProductos(prods);
    setCargando(false);
  };

  const restaurantesFiltrados = restaurantes.filter(r => {
    const coincideBusqueda = r.nombre.toLowerCase().includes(busqueda.toLowerCase());
    const coincideCiudad = ciudadActiva === 'Todas' || r.ciudad === ciudadActiva;
    return coincideBusqueda && coincideCiudad;
  });

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F97316', '#EA580C']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Inicio</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>🛵 Delivery</Text>
            <Text style={styles.headerSub}>Rápido y confiable en Bolivia</Text>
          </View>
          {totalItems > 0 && (
            <TouchableOpacity onPress={() => router.push('/carrito')} style={styles.carritoBtn}>
              <Text style={styles.carritoEmoji}>🛒</Text>
              <View style={styles.carritoBadge}>
                <Text style={styles.carritoBadgeText}>{totalItems}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.searchBox}>
          <Text>🔍 </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar restaurante o producto..."
            placeholderTextColor="#9CA3AF"
            value={busqueda}
            onChangeText={setBusqueda}
          />
        </View>
      </LinearGradient>

      {/* Selector de ciudad */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ciudadesBar} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {CIUDADES.map(ciudad => (
          <TouchableOpacity
            key={ciudad}
            onPress={() => setCiudadActiva(ciudad)}
            style={[styles.ciudadBtn, ciudadActiva === ciudad && styles.ciudadBtnActivo]}>
            <Text style={[styles.ciudadText, ciudadActiva === ciudad && styles.ciudadTextActivo]}>
              {ciudad === 'Todas' ? '📍 Todas' : `🏙️ ${ciudad}`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <Text style={styles.bannerEmoji}>🎉</Text>
          <View>
            <Text style={styles.bannerTitle}>Primera entrega GRATIS</Text>
            <Text style={styles.bannerSub}>Usa el código: CASERITA</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Categorías</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriasRow}>
          {CATEGORIAS.map(cat => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => setCategoriaActiva(cat.nombre)}
              style={[styles.categoriaBtn, categoriaActiva === cat.nombre && styles.categoriaBtnActivo]}>
              <Text style={styles.categoriaEmoji}>{cat.emoji}</Text>
              <Text style={[styles.categoriaNombre, categoriaActiva === cat.nombre && styles.categoriaNombreActivo]}>
                {cat.nombre}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>
          {ciudadActiva === 'Todas' ? 'Cerca de ti' : `En ${ciudadActiva}`}
        </Text>

        {cargando ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={styles.loadingText}>Cargando restaurantes...</Text>
          </View>
        ) : restaurantesFiltrados.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyText}>No se encontraron restaurantes{ciudadActiva !== 'Todas' ? ` en ${ciudadActiva}` : ''}</Text>
          </View>
        ) : (
          restaurantesFiltrados.map(rest => (
            <TouchableOpacity
              key={rest.id}
              style={styles.restCard}
              onPress={() => setRestauranteActivo(restauranteActivo === rest.id ? null : rest.id)}>
              <Image
                source={{ uri: rest.imagen_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800' }}
                style={styles.restImagen}
                resizeMode="cover"
              />
              <View style={styles.restCardHeader}>
                <View style={styles.restInfo}>
                  <Text style={styles.restNombre}>{rest.nombre}</Text>
                  <Text style={styles.restTipo}>{rest.categoria} • {rest.direccion}</Text>
                  <View style={styles.restMeta}>
                    <Text style={styles.restRating}>⭐ {rest.rating || '4.5'}</Text>
                    <Text style={styles.restPrecio}>Bs. 8 envío</Text>
                    {rest.ciudad && <Text style={styles.restCiudad}>📍 {rest.ciudad}</Text>}
                  </View>
                </View>
                <Text style={styles.restArrow}>{restauranteActivo === rest.id ? '▲' : '▼'}</Text>
              </View>

              {restauranteActivo === rest.id && (
                <View style={styles.platosBox}>
                  <Text style={styles.platosTitle}>🍴 Menú</Text>
                  {productos.filter(p => p.negocio_id === rest.id).length === 0 ? (
                    <Text style={styles.emptyMenuText}>Sin productos disponibles</Text>
                  ) : (
                    productos.filter(p => p.negocio_id === rest.id).map(plato => (
                      <View key={plato.id} style={styles.platoRow}>
                        <Text style={styles.platoEmoji}>🍽️</Text>
                        <View style={styles.platoInfo}>
                          <Text style={styles.platoNombre}>{plato.nombre}</Text>
                          <Text style={styles.platoDesc}>{plato.descripcion}</Text>
                          <Text style={styles.platoPrecio}>Bs. {plato.precio}</Text>
                        </View>
                        <View style={styles.platoControls}>
                          {getCantidad(plato.id) > 0 ? (
                            <>
                              <TouchableOpacity style={styles.controlBtn} onPress={() => quitarItem(plato.id)}>
                                <Text style={styles.controlText}>−</Text>
                              </TouchableOpacity>
                              <Text style={styles.controlCantidad}>{getCantidad(plato.id)}</Text>
                            </>
                          ) : null}
                          <TouchableOpacity style={styles.agregarBtn} onPress={() => agregarItem({
                            id: plato.id,
                            nombre: plato.nombre,
                            precio: plato.precio,
                            emoji: '🍽️',
                            tipo: 'delivery',
                            detalle: rest.nombre,
                            negocio_id: rest.id,
                          })}>
                            <Text style={styles.agregarText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {totalItems > 0 && (
        <View style={styles.footerCarrito}>
          <TouchableOpacity onPress={() => router.push('/carrito')} style={styles.footerBtn}>
            <LinearGradient colors={['#F97316', '#EA580C']} style={styles.footerGradient}>
              <Text style={styles.footerText}>🛒 Ver carrito ({totalItems} items)</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  header: { paddingTop: 55, paddingBottom: 20, paddingHorizontal: 20 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#FED7AA', fontSize: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#FFF' },
  headerSub: { fontSize: 13, color: '#FED7AA', marginTop: 4 },
  carritoBtn: { position: 'relative', padding: 8 },
  carritoEmoji: { fontSize: 28 },
  carritoBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FFF', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  carritoBadgeText: { fontSize: 11, fontWeight: '800', color: '#F97316' },
  searchBox: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center' },
  searchInput: { flex: 1, fontSize: 15, color: '#1E0A3C' },
  ciudadesBar: { paddingVertical: 10, maxHeight: 52, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  ciudadBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  ciudadBtnActivo: { backgroundColor: '#F97316', borderColor: '#F97316' },
  ciudadText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  ciudadTextActivo: { color: '#FFF' },
  content: { flex: 1, padding: 16 },
  banner: { flexDirection: 'row', backgroundColor: '#FFF7ED', borderRadius: 16, padding: 16, marginBottom: 20, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#FED7AA' },
  bannerEmoji: { fontSize: 32 },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: '#92400E' },
  bannerSub: { fontSize: 13, color: '#F97316', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1E0A3C', marginBottom: 12 },
  categoriasRow: { marginBottom: 20 },
  categoriaBtn: { alignItems: 'center', marginRight: 12, backgroundColor: '#FFF', borderRadius: 16, padding: 12, width: 85, borderWidth: 1, borderColor: '#E5E7EB' },
  categoriaBtnActivo: { backgroundColor: '#F97316', borderColor: '#F97316' },
  categoriaEmoji: { fontSize: 28, marginBottom: 4 },
  categoriaNombre: { fontSize: 11, color: '#6B7280', fontWeight: '600', textAlign: 'center' },
  categoriaNombreActivo: { color: '#FFF' },
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#6B7280', fontSize: 15, textAlign: 'center' },
  emptyMenuText: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  restCard: { backgroundColor: '#FFF', borderRadius: 20, marginBottom: 12, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8, overflow: 'hidden' },
  restImagen: { height: 160, width: '100%' },
  restCardHeader: { flexDirection: 'row', padding: 16, alignItems: 'center' },
  restInfo: { flex: 1 },
  restNombre: { fontSize: 16, fontWeight: '700', color: '#1E0A3C', marginBottom: 4 },
  restTipo: { fontSize: 13, color: '#9CA3AF', marginBottom: 6 },
  restMeta: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  restPrecio: { fontSize: 12, color: '#F97316', fontWeight: '600' },
  restRating: { fontSize: 12, color: '#6B7280' },
  restCiudad: { fontSize: 12, color: '#9CA3AF' },
  restArrow: { fontSize: 12, color: '#9CA3AF', marginLeft: 8 },
  platosBox: { borderTopWidth: 1, borderTopColor: '#F3F4F6', padding: 16 },
  platosTitle: { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginBottom: 12 },
  platoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  platoEmoji: { fontSize: 28, marginRight: 12 },
  platoInfo: { flex: 1 },
  platoNombre: { fontSize: 14, fontWeight: '600', color: '#1E0A3C' },
  platoDesc: { fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  platoPrecio: { fontSize: 13, color: '#F97316', fontWeight: '600' },
  platoControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controlBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  controlText: { fontSize: 18, color: '#374151', fontWeight: '700', lineHeight: 22 },
  controlCantidad: { fontSize: 15, fontWeight: '700', color: '#1E0A3C', minWidth: 20, textAlign: 'center' },
  agregarBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  agregarText: { fontSize: 20, color: '#FFF', fontWeight: '700', lineHeight: 24 },
  footerCarrito: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#F8F7FF' },
  footerBtn: { borderRadius: 16, overflow: 'hidden' },
  footerGradient: { padding: 18, alignItems: 'center' },
  footerText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});

