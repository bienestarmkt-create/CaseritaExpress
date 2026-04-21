import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { supabase } from '../lib/supabase';

const CIUDADES = ['Todas', 'Tarija', 'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí', 'Sucre', 'Trinidad', 'Cobija'];

export default function EventosScreen() {
  const router = useRouter();
  const { agregarItem, totalItems } = useCarrito();
  const [eventos, setEventos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [categoriaActiva, setCategoriaActiva] = useState('Todos');
  const [ciudadActiva, setCiudadActiva] = useState('Todas');
  const [eventoActivo, setEventoActivo] = useState<string | null>(null);
  const [ticketsSeleccionados, setTicketsSeleccionados] = useState<{[key: string]: number}>({});

  const CATEGORIAS = ['Todos', 'Festival', 'Concierto', 'Feria', 'Música'];

  useEffect(() => {
    cargarEventos();
  }, []);

  const cargarEventos = async () => {
    setCargando(true);
    const { data } = await supabase
      .from('eventos')
      .select('*')
      .eq('activo', true)
      .order('fecha_evento', { ascending: true });
    if (data) setEventos(data);
    setCargando(false);
  };

  const eventosFiltrados = eventos.filter(e => {
    const coincideCategoria = categoriaActiva === 'Todos' || e.categoria === categoriaActiva;
    const coincideCiudad = ciudadActiva === 'Todas' || e.ciudad === ciudadActiva;
    return coincideCategoria && coincideCiudad;
  });

  const formatFecha = (fecha: string) => {
    const d = new Date(fecha);
    return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const getTickets = (eventoId: string) => ticketsSeleccionados[eventoId] || 1;

  const setTickets = (eventoId: string, cantidad: number) => {
    setTicketsSeleccionados(prev => ({ ...prev, [eventoId]: Math.max(1, cantidad) }));
  };

  const agregarTickets = (evento: any) => {
    const cantidad = getTickets(evento.id);
    agregarItem({
      id: evento.id,
      nombre: evento.nombre,
      precio: evento.precio_entrada * cantidad,
      emoji: '🎟️',
      tipo: 'evento',
      detalle: `${cantidad} entrada${cantidad > 1 ? 's' : ''} • ${formatFecha(evento.fecha_evento)}`,
    });
    setEventoActivo(null);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Inicio</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>🎪 Eventos</Text>
            <Text style={styles.headerSub}>Conciertos y cultura en Bolivia</Text>
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

      {/* Selector de categoría */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtrosBar} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {CATEGORIAS.map(cat => (
          <TouchableOpacity key={cat} onPress={() => setCategoriaActiva(cat)} style={[styles.filtroBtn, categoriaActiva === cat && styles.filtroBtnActivo]}>
            <Text style={[styles.filtroText, categoriaActiva === cat && styles.filtroTextActivo]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
        {cargando ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={styles.loadingText}>Cargando eventos...</Text>
          </View>
        ) : eventosFiltrados.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🎪</Text>
            <Text style={styles.emptyText}>No hay eventos{ciudadActiva !== 'Todas' ? ` en ${ciudadActiva}` : ''}</Text>
          </View>
        ) : (
          eventosFiltrados.map(evento => (
            <TouchableOpacity
              key={evento.id}
              style={styles.card}
              onPress={() => setEventoActivo(eventoActivo === evento.id ? null : evento.id)}
              activeOpacity={0.9}>
              <Image
                source={{ uri: evento.imagen_url || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800' }}
                style={styles.cardImagen}
                resizeMode="cover"
              />
              <View style={styles.categoriaBadge}>
                <Text style={styles.categoriaText}>{evento.categoria}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardNombre}>{evento.nombre}</Text>
                <Text style={styles.cardDesc}>{evento.descripcion}</Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.cardFecha}>📅 {formatFecha(evento.fecha_evento)}</Text>
                  <Text style={styles.cardLugar}>📍 {evento.lugar}</Text>
                  <Text style={styles.cardCiudad}>🏙️ {evento.ciudad}</Text>
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardPrecio}>Bs. {evento.precio_entrada} <Text style={styles.cardPrecioLabel}>por entrada</Text></Text>
                  <Text style={styles.cardTap}>{eventoActivo === evento.id ? '▲ Ocultar' : '▼ Comprar'}</Text>
                </View>
              </View>

              {eventoActivo === evento.id && (
                <View style={styles.compraBox}>
                  <Text style={styles.compraTitle}>🎫 Selecciona tus entradas</Text>
                  <View style={styles.ticketsRow}>
                    <TouchableOpacity onPress={() => setTickets(evento.id, getTickets(evento.id) - 1)} style={styles.ticketBtn}>
                      <Text style={styles.ticketBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.ticketNum}>{getTickets(evento.id)}</Text>
                    <TouchableOpacity onPress={() => setTickets(evento.id, getTickets(evento.id) + 1)} style={styles.ticketBtn}>
                      <Text style={styles.ticketBtnText}>+</Text>
                    </TouchableOpacity>
                    <Text style={styles.ticketLabel}>entrada{getTickets(evento.id) > 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.totalBox}>
                    <Text style={styles.totalText}>{getTickets(evento.id)} × Bs. {evento.precio_entrada}</Text>
                    <Text style={styles.totalPrecio}>Total: Bs. {evento.precio_entrada * getTickets(evento.id)}</Text>
                  </View>
                  <TouchableOpacity style={styles.comprarBtn} onPress={() => agregarTickets(evento)}>
                    <Text style={styles.comprarText}>🛒 Agregar al carrito</Text>
                  </TouchableOpacity>
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
            <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.footerGradient}>
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
  backText: { color: '#DDD6FE', fontSize: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#FFF' },
  headerSub: { fontSize: 13, color: '#DDD6FE', marginTop: 4 },
  carritoBtn: { position: 'relative', padding: 8 },
  carritoEmoji: { fontSize: 28 },
  carritoBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FFF', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  carritoBadgeText: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  ciudadesBar: { paddingVertical: 10, maxHeight: 52, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  ciudadBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  ciudadBtnActivo: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  ciudadText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  ciudadTextActivo: { color: '#FFF' },
  filtrosBar: { paddingVertical: 10, maxHeight: 52, backgroundColor: '#FAFAFA', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  filtroBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  filtroBtnActivo: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  filtroText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  filtroTextActivo: { color: '#FFF' },
  lista: { flex: 1, paddingHorizontal: 16 },
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#6B7280', fontSize: 15, textAlign: 'center' },
  card: { backgroundColor: '#FFF', borderRadius: 20, marginBottom: 16, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8, overflow: 'hidden' },
  cardImagen: { height: 180, width: '100%' },
  categoriaBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: '#7C3AED', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  categoriaText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  cardBody: { padding: 16 },
  cardNombre: { fontSize: 17, fontWeight: '800', color: '#1E0A3C', marginBottom: 6 },
  cardDesc: { fontSize: 13, color: '#9CA3AF', marginBottom: 10 },
  cardMeta: { gap: 4, marginBottom: 12 },
  cardFecha: { fontSize: 13, color: '#7C3AED', fontWeight: '600' },
  cardLugar: { fontSize: 12, color: '#6B7280' },
  cardCiudad: { fontSize: 12, color: '#6B7280' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardPrecio: { fontSize: 18, fontWeight: '800', color: '#7C3AED' },
  cardPrecioLabel: { fontSize: 12, fontWeight: '400', color: '#9CA3AF' },
  cardTap: { fontSize: 12, color: '#7C3AED', fontWeight: '600' },
  compraBox: { borderTopWidth: 1, borderTopColor: '#F3F4F6', padding: 16 },
  compraTitle: { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginBottom: 12 },
  ticketsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  ticketBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' },
  ticketBtnText: { fontSize: 20, color: '#FFF', fontWeight: '700', lineHeight: 24 },
  ticketNum: { fontSize: 22, fontWeight: '800', color: '#1E0A3C', minWidth: 30, textAlign: 'center' },
  ticketLabel: { fontSize: 14, color: '#6B7280' },
  totalBox: { backgroundColor: '#F3F0FF', borderRadius: 12, padding: 12, marginBottom: 12 },
  totalText: { fontSize: 14, color: '#6B7280', marginBottom: 4 },
  totalPrecio: { fontSize: 18, fontWeight: '800', color: '#7C3AED' },
  comprarBtn: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 14, alignItems: 'center' },
  comprarText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  footerCarrito: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#F8F7FF' },
  footerBtn: { borderRadius: 16, overflow: 'hidden' },
  footerGradient: { padding: 18, alignItems: 'center' },
  footerText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});

