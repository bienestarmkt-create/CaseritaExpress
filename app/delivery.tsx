import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { useCiudad } from '../context/CiudadContext';
import HeaderCiudad from '../components/HeaderCiudad';
import StarRating from '../components/StarRating';
import { supabase } from '../lib/supabase';

const CATEGORIAS = [
  { id: 1, nombre: 'Restaurantes', emoji: '🍽️' },
  { id: 2, nombre: 'Supermercados', emoji: '🛒' },
  { id: 3, nombre: 'Farmacias', emoji: '💊' },
  { id: 4, nombre: 'Bebidas', emoji: '🥤' },
  { id: 5, nombre: 'Cafeterías', emoji: '☕' },
  { id: 6, nombre: 'Heladerías', emoji: '🍦' },
];

// Categorías de producto que obligan a elegir una salsa (categoría
// 'Salsas', mismo negocio) antes de agregar al carrito. Se activa por
// categoría del producto, no por negocio — cualquier negocio que cargue
// pastas con este mismo esquema de categorías obtiene el modal gratis;
// un negocio sin estas categorías (ej. QTP Carnes) nunca lo ve.
const CATEGORIAS_PASTA_CON_SALSA = ['Pastas Largas', 'Pastas Cortas', 'Pastas Rellenas', 'Pastas al Horno'];

// Menú de un negocio para el cliente: productos con foto primero (venden
// más), después los sin foto — dentro de cada grupo, por categoría y
// nombre alfabético. Se hace client-side (no en la query) porque ya no
// hay paginación de productos acá — todo el menú de un negocio se trae
// de una vez — así que ordenar en memoria es lo más simple y no arriesga
// romper nada si en el futuro se agrega paginación server-side.
// También oculta categoria='Prueba' — ítems internos para validar el
// flujo de pago (ver PRUEBA INTERNA - Ítem Bs. 1 en QTP Carnes y
// Chapakingo), nunca deben verse en el menú público. Siguen existiendo
// en la tabla y son pedibles desde el panel del negocio — esto solo
// filtra la vista del cliente.
// Las salsas (categoría 'Salsas') no se muestran como producto pedible
// suelto — solo existen como opción dentro del modal de pasta+salsa (ver
// CATEGORIAS_PASTA_CON_SALSA más abajo). Los registros siguen intactos
// en la tabla, esto solo filtra la vista del cliente.
function productosVisibles(productos: any[], negocioId: string) {
  return productos
    .filter(p => p.negocio_id === negocioId && p.categoria !== 'Prueba' && p.categoria !== 'Salsas')
    .sort((a, b) => {
      const aConFoto = a.imagen_url ? 0 : 1;
      const bConFoto = b.imagen_url ? 0 : 1;
      if (aConFoto !== bConFoto) return aConFoto - bConFoto;
      const catCmp = (a.categoria ?? '').localeCompare(b.categoria ?? '');
      if (catCmp !== 0) return catCmp;
      return (a.nombre ?? '').localeCompare(b.nombre ?? '');
    });
}

export default function DeliveryScreen() {
  const router = useRouter();
  const { agregarItem, quitarItem, getCantidad, getCantidadBase, totalItems } = useCarrito();
  // Ciudad global (detectada por geolocalización o elegida a mano desde
  // el header "Entregando en" — ver components/HeaderCiudad.tsx). AppShell
  // no deja llegar acá sin ciudad resuelta.
  const { ciudad } = useCiudad();
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('Restaurantes');
  const [restauranteActivo, setRestauranteActivo] = useState<string | null>(null);
  const [restaurantes, setRestaurantes] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [promedios, setPromedios] = useState<Record<string, { promedio: number; total_ratings: number }>>({});
  const [tarifasEnvio, setTarifasEnvio] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // ── Modal de salsa obligatoria (pasta + salsa) ────────────────
  const [modalSalsaVisible, setModalSalsaVisible] = useState(false);
  const [platoParaSalsa, setPlatoParaSalsa] = useState<any | null>(null);
  const [negocioParaSalsa, setNegocioParaSalsa] = useState<any | null>(null);
  const [salsaElegida, setSalsaElegida] = useState<any | null>(null);

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setCargando(true);
    setErrorCarga(null);
    const TIMEOUT_MS = 12000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Tiempo de espera agotado. Verifica tu conexión.')), TIMEOUT_MS)
    );
    try {
      const [
        { data: negocios, error: errNegocios },
        { data: prods,    error: errProds },
        { data: promsData },
        { data: tarifasData },
      ] =
        await Promise.race([
          Promise.all([
            supabase.from('negocios').select('*').eq('activo', true),
            supabase.from('productos').select('*').eq('disponible', true),
            supabase.from('v_promedios_negocios').select('negocio_id, promedio, total_ratings'),
            supabase.from('ciudades').select('nombre, tarifa_envio_qr'),
          ]),
          timeout,
        ]);
      if (errNegocios) throw new Error(errNegocios.message);
      if (errProds) throw new Error(errProds.message);
      setRestaurantes(negocios ?? []);
      setProductos(prods ?? []);
      // Construir mapa negocio_id → { promedio, total_ratings }
      const pMap: Record<string, { promedio: number; total_ratings: number }> = {};
      for (const p of (promsData ?? [])) {
        pMap[p.negocio_id] = { promedio: Number(p.promedio), total_ratings: Number(p.total_ratings) };
      }
      setPromedios(pMap);
      // Mapa ciudad → tarifa de envío QR (ver lib/totales.ts). Se
      // muestra la de QR acá (la más barata) — el desglose completo
      // (qr vs. efectivo) se ve recién en el carrito.
      const tMap: Record<string, number> = {};
      for (const t of (tarifasData ?? [])) {
        if (t.tarifa_envio_qr != null) tMap[t.nombre] = Number(t.tarifa_envio_qr);
      }
      setTarifasEnvio(tMap);
    } catch (e: any) {
      setErrorCarga(e?.message ?? 'Error al conectar con el servidor');
    } finally {
      setCargando(false);
    }
  };

  const restaurantesFiltrados = restaurantes.filter(r => {
    const coincideBusqueda = r.nombre.toLowerCase().includes(busqueda.toLowerCase());
    const coincideCiudad = r.ciudad === ciudad;
    return coincideBusqueda && coincideCiudad;
  });

  // Salsas disponibles del negocio activo en el modal (ya vienen
  // disponible=true desde cargarDatos, no hace falta refiltrar).
  const salsasDisponibles = negocioParaSalsa
    ? productos.filter(p => p.negocio_id === negocioParaSalsa.id && p.categoria === 'Salsas')
    : [];

  const abrirModalSalsa = (plato: any, rest: any) => {
    setPlatoParaSalsa(plato);
    setNegocioParaSalsa(rest);
    setSalsaElegida(null);
    setModalSalsaVisible(true);
  };

  const cerrarModalSalsa = () => {
    setModalSalsaVisible(false);
    setPlatoParaSalsa(null);
    setNegocioParaSalsa(null);
    setSalsaElegida(null);
  };

  const confirmarAgregarConSalsa = () => {
    // El botón de confirmar ya está disabled sin salsa elegida — esto es
    // solo defensivo, nunca debería dispararse sin los tres datos.
    if (!platoParaSalsa || !negocioParaSalsa || !salsaElegida) return;
    agregarItem({
      id:         `${platoParaSalsa.id}__${salsaElegida.id}`,
      productoId: platoParaSalsa.id,
      nombre:     platoParaSalsa.nombre,
      precio:     platoParaSalsa.precio + salsaElegida.precio,
      precioBase: platoParaSalsa.precio,
      salsa:      { id: salsaElegida.id, nombre: salsaElegida.nombre, precio: salsaElegida.precio },
      emoji:      '🍝',
      tipo:       'delivery',
      detalle:    negocioParaSalsa.nombre,
      negocio_id: negocioParaSalsa.id,
    });
    cerrarModalSalsa();
  };

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
        <HeaderCiudad />
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

        <Text style={styles.sectionTitle}>En {ciudad}</Text>

        {cargando ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={styles.loadingText}>Cargando restaurantes...</Text>
          </View>
        ) : errorCarga ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>⚠️</Text>
            <Text style={styles.emptyText}>No se pudo cargar los restaurantes</Text>
            <Text style={[styles.emptyText, { fontSize: 12, color: '#EF4444', marginTop: 4 }]}>{errorCarga}</Text>
            <TouchableOpacity onPress={cargarDatos} style={{ marginTop: 16, backgroundColor: '#F97316', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 }}>
              <Text style={{ color: '#FFF', fontWeight: '700' }}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : restaurantesFiltrados.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyText}>No se encontraron restaurantes en {ciudad}</Text>
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
                    {promedios[rest.id] ? (
                      <View style={styles.ratingRow}>
                        <StarRating value={promedios[rest.id].promedio} size={12} readonly />
                        <Text style={styles.restRating}>
                          {promedios[rest.id].promedio.toFixed(1)} ({promedios[rest.id].total_ratings})
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.restNuevo}>✨ Nuevo</Text>
                    )}
                    <Text style={styles.restPrecio}>
                      {rest.ciudad && tarifasEnvio[rest.ciudad] != null ? `Bs. ${tarifasEnvio[rest.ciudad]} envío` : 'Envío a confirmar'}
                    </Text>
                    {rest.ciudad && <Text style={styles.restCiudad}>📍 {rest.ciudad}</Text>}
                  </View>
                </View>
                <Text style={styles.restArrow}>{restauranteActivo === rest.id ? '▲' : '▼'}</Text>
              </View>

              {restauranteActivo === rest.id && (
                <View style={styles.platosBox}>
                  <Text style={styles.platosTitle}>🍴 Menú</Text>
                  {productosVisibles(productos, rest.id).length === 0 ? (
                    <Text style={styles.emptyMenuText}>Sin productos disponibles</Text>
                  ) : (
                    productosVisibles(productos, rest.id).map(plato => {
                      const requiereSalsa = CATEGORIAS_PASTA_CON_SALSA.includes(plato.categoria);
                      return (
                      <View key={plato.id} style={styles.platoRow}>
                        {plato.imagen_url ? (
                          <Image source={{ uri: plato.imagen_url }} style={styles.platoImg} resizeMode="cover" />
                        ) : (
                          <View style={styles.platoImgPlaceholder}>
                            <Text style={styles.platoImgPlaceholderText}>
                              {plato.nombre.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={styles.platoInfo}>
                          <Text style={styles.platoNombre}>{plato.nombre}</Text>
                          <Text style={styles.platoDesc}>{plato.descripcion}</Text>
                          <Text style={styles.platoPrecio}>Bs. {plato.precio}</Text>
                        </View>
                        <View style={styles.platoControls}>
                          {!requiereSalsa && getCantidad(plato.id) > 0 ? (
                            <>
                              <TouchableOpacity style={styles.controlBtn} onPress={() => quitarItem(plato.id)}>
                                <Text style={styles.controlText}>−</Text>
                              </TouchableOpacity>
                              <Text style={styles.controlCantidad}>{getCantidad(plato.id)}</Text>
                            </>
                          ) : null}
                          {/* Con salsa la cantidad puede estar repartida en varias
                              líneas del carrito (una por salsa elegida) — no hay
                              un único "−" válido acá; se ajusta cada línea desde
                              la pantalla del carrito. Solo se muestra el total. */}
                          {requiereSalsa && getCantidadBase(plato.id) > 0 ? (
                            <Text style={styles.controlCantidad}>{getCantidadBase(plato.id)}</Text>
                          ) : null}
                          <TouchableOpacity
                            style={styles.agregarBtn}
                            onPress={() => requiereSalsa
                              ? abrirModalSalsa(plato, rest)
                              : agregarItem({
                                  id: plato.id,
                                  nombre: plato.nombre,
                                  precio: plato.precio,
                                  emoji: '🍽️',
                                  tipo: 'delivery',
                                  detalle: rest.nombre,
                                  negocio_id: rest.id,
                                })}
                          >
                            <Text style={styles.agregarText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      );
                    })
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

      {/* ── Modal: salsa obligatoria para pastas ── */}
      <Modal visible={modalSalsaVisible} transparent animationType="slide" onRequestClose={cerrarModalSalsa}>
        <Pressable style={styles.salsaOverlay} onPress={cerrarModalSalsa}>
          <Pressable style={styles.salsaSheet} onPress={() => {}}>
            <View style={styles.salsaHandle} />
            <Text style={styles.salsaTitle}>Elige tu salsa</Text>
            <Text style={styles.salsaSubtitle}>{platoParaSalsa?.nombre}</Text>

            <ScrollView style={styles.salsaLista} showsVerticalScrollIndicator={false}>
              {salsasDisponibles.length === 0 ? (
                <Text style={styles.salsaVacio}>
                  Este negocio no configuró salsas disponibles todavía. No se puede agregar este plato por ahora.
                </Text>
              ) : (
                salsasDisponibles.map(salsa => (
                  <TouchableOpacity
                    key={salsa.id}
                    style={[styles.salsaOpcion, salsaElegida?.id === salsa.id && styles.salsaOpcionActiva]}
                    onPress={() => setSalsaElegida(salsa)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.salsaOpcionNombre, salsaElegida?.id === salsa.id && styles.salsaOpcionTextoActivo]}>
                      {salsa.nombre}
                    </Text>
                    <Text style={[styles.salsaOpcionPrecio, salsaElegida?.id === salsa.id && styles.salsaOpcionTextoActivo]}>
                      + Bs. {salsa.precio}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <View style={styles.salsaPrecioBox}>
              <Text style={styles.salsaPrecioTexto}>
                {salsaElegida
                  ? `${platoParaSalsa?.nombre} + ${salsaElegida.nombre} = Bs. ${(platoParaSalsa?.precio ?? 0) + salsaElegida.precio}`
                  : 'Elige una salsa para ver el precio final'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.salsaBtnAgregar, !salsaElegida && styles.salsaBtnDisabled]}
              onPress={confirmarAgregarConSalsa}
              disabled={!salsaElegida}
              activeOpacity={0.8}
            >
              <Text style={styles.salsaBtnAgregarText}>✅ Agregar al carrito</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.salsaBtnCancelar} onPress={cerrarModalSalsa} activeOpacity={0.7}>
              <Text style={styles.salsaBtnCancelarText}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
  restPrecio:  { fontSize: 12, color: '#F97316', fontWeight: '600' },
  restRating:  { fontSize: 12, color: '#6B7280', marginLeft: 4 },
  restCiudad:  { fontSize: 12, color: '#9CA3AF' },
  ratingRow:   { flexDirection: 'row', alignItems: 'center' },
  restNuevo:   { fontSize: 12, color: '#10B981', fontWeight: '600' },
  restArrow: { fontSize: 12, color: '#9CA3AF', marginLeft: 8 },
  platosBox: { borderTopWidth: 1, borderTopColor: '#F3F4F6', padding: 16 },
  platosTitle: { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginBottom: 12 },
  platoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  platoImg: { width: 52, height: 52, borderRadius: 10, marginRight: 12, backgroundColor: '#F3F4F6' },
  platoImgPlaceholder: {
    width: 52, height: 52, borderRadius: 10, marginRight: 12,
    backgroundColor: '#FFF1E6', alignItems: 'center', justifyContent: 'center',
  },
  platoImgPlaceholderText: { fontSize: 20, fontWeight: '800', color: '#F97316' },
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

  // ── Modal salsa obligatoria ──
  salsaOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  salsaSheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 32, paddingTop: 12, maxHeight: '80%',
  },
  salsaHandle: { width: 44, height: 5, backgroundColor: '#E5E7EB', borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
  salsaTitle: { fontSize: 18, fontWeight: '800', color: '#1E0A3C', textAlign: 'center' },
  salsaSubtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginTop: 2, marginBottom: 16 },
  salsaLista: { maxHeight: 300 },
  salsaVacio: { fontSize: 13, color: '#EF4444', textAlign: 'center', paddingVertical: 24, lineHeight: 19 },
  salsaOpcion: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', marginBottom: 8,
  },
  salsaOpcionActiva: { backgroundColor: '#FFF7ED', borderColor: '#F97316' },
  salsaOpcionNombre: { fontSize: 14, fontWeight: '600', color: '#1E0A3C' },
  salsaOpcionPrecio: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  salsaOpcionTextoActivo: { color: '#EA580C' },
  salsaPrecioBox: {
    backgroundColor: '#F0FDF4', borderRadius: 12, padding: 14, marginTop: 12, marginBottom: 16,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  salsaPrecioTexto: { fontSize: 13, fontWeight: '700', color: '#166534', textAlign: 'center', lineHeight: 19 },
  salsaBtnAgregar: { backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  salsaBtnDisabled: { opacity: 0.4 },
  salsaBtnAgregarText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  salsaBtnCancelar: { paddingVertical: 12, alignItems: 'center' },
  salsaBtnCancelarText: { color: '#9CA3AF', fontSize: 14, fontWeight: '600' },
});

