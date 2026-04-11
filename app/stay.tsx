import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { supabase } from '../lib/supabase';

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const hoy = new Date();

export default function StayScreen() {
  const router = useRouter();
  const { agregarItem, totalItems } = useCarrito();
  const [filtroCiudad, setFiltroCiudad] = useState('Todos');
  const [soloOfertas, setSoloOfertas] = useState(false);
  const [alojamientoActivo, setAlojamientoActivo] = useState<string | null>(null);
  const [modalReserva, setModalReserva] = useState<any | null>(null);
  const [fechaEntrada, setFechaEntrada] = useState<number | null>(null);
  const [fechaSalida, setFechaSalida] = useState<number | null>(null);
  const [huespedes, setHuespedes] = useState(1);
  const [alojamientos, setAlojamientos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarAlojamientos();
  }, []);

  const cargarAlojamientos = async () => {
    setCargando(true);
    const { data } = await supabase
      .from('alojamientos')
      .select('*')
      .eq('activo', true);
    if (data) setAlojamientos(data);
    setCargando(false);
  };

  const alojamientosFiltrados = alojamientos.filter(a => {
    if (filtroCiudad !== 'Todos' && a.ciudad !== filtroCiudad) return false;
    return true;
  });

  const noches = fechaEntrada && fechaSalida ? Math.abs(fechaSalida - fechaEntrada) : 1;

  const getEmoji = (tipo: string) => {
    const emojis: any = { Casa: '🏛️', Departamento: '🌄', Cabaña: '🍷', Suite: '🏙️' };
    return emojis[tipo] || '🏠';
  };

  const confirmarReserva = () => {
    if (!modalReserva || !fechaEntrada || !fechaSalida) return;
    agregarItem({
      id: modalReserva.id + '-' + fechaEntrada + '-' + fechaSalida,
      nombre: modalReserva.nombre,
      precio: modalReserva.precio_noche * noches,
      emoji: getEmoji(modalReserva.tipo),
      tipo: 'stay',
      detalle: `${noches} noche${noches > 1 ? 's' : ''} • ${modalReserva.ciudad}`,
    });
    setModalReserva(null);
    setFechaEntrada(null);
    setFechaSalida(null);
  };

  const dias = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#6B21A8', '#4C1D95']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Inicio</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>🏡 Caserita Stay</Text>
            <Text style={styles.headerSub}>Tu alojamiento en Bolivia</Text>
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtrosBar} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {['Todos', 'Tarija', 'La Paz', 'Santa Cruz'].map(c => (
          <TouchableOpacity key={c} onPress={() => setFiltroCiudad(c)} style={[styles.filtroBtn, filtroCiudad === c && styles.filtroBtnActivo]}>
            <Text style={[styles.filtroText, filtroCiudad === c && styles.filtroTextActivo]}>📍 {c}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setSoloOfertas(!soloOfertas)} style={[styles.filtroBtn, soloOfertas && styles.filtroBtnOferta]}>
          <Text style={[styles.filtroText, soloOfertas && styles.filtroTextActivo]}>🔥 Ofertas</Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
        {cargando ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#6B21A8" />
            <Text style={styles.loadingText}>Cargando alojamientos...</Text>
          </View>
        ) : (
          <>
            <Text style={styles.resultados}>{alojamientosFiltrados.length} alojamientos disponibles</Text>
            {alojamientosFiltrados.map(aloj => (
              <TouchableOpacity
                key={aloj.id}
                style={styles.card}
                onPress={() => setAlojamientoActivo(alojamientoActivo === aloj.id ? null : aloj.id)}
                activeOpacity={0.9}>
                <Image
                  source={{ uri: aloj.imagen_url || 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800' }}
                  style={styles.cardImagen}
                  resizeMode="cover"
                />
                <View style={styles.cardBody}>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardCiudad}>📍 {aloj.ciudad}</Text>
                    <Text style={styles.cardRating}>⭐ {aloj.rating || '4.8'}</Text>
                  </View>
                  <Text style={styles.cardNombre}>{aloj.nombre}</Text>
                  <Text style={styles.cardDesc}>{aloj.descripcion}</Text>
                  <Text style={styles.cardDesde}>Desde <Text style={styles.cardPrecio}>Bs. {aloj.precio_noche}</Text>/noche</Text>
                  <Text style={styles.cardTap}>{alojamientoActivo === aloj.id ? '▲ Ocultar detalles' : '▼ Ver detalles y reservar'}</Text>
                </View>

                {alojamientoActivo === aloj.id && (
                  <View style={styles.detalleBox}>
                    <Text style={styles.habTitle}>📋 Detalles</Text>
                    <View style={styles.detalleRow}>
                      <Text style={styles.detalleItem}>🏠 Tipo: {aloj.tipo}</Text>
                      <Text style={styles.detalleItem}>👥 Hasta {aloj.huespedes_max} huéspedes</Text>
                    </View>
                    <Text style={styles.detalleItem}>📍 {aloj.direccion}</Text>
                    <TouchableOpacity
                      style={styles.reservarBtn}
                      onPress={() => {
                        setModalReserva(aloj);
                        setFechaEntrada(null);
                        setFechaSalida(null);
                        setHuespedes(1);
                      }}>
                      <Text style={styles.reservarText}>📅 Seleccionar fechas y reservar</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {modalReserva && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>📅 Selecciona tus fechas</Text>
            <Text style={styles.modalSub}>{modalReserva.nombre}</Text>

            <Text style={styles.modalLabel}>📅 Fecha de entrada</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.diasRow}>
              {dias.map(d => (
                <TouchableOpacity key={d} onPress={() => { setFechaEntrada(d); setFechaSalida(null); }} style={[styles.diaBtn, fechaEntrada === d && styles.diaBtnActivo]}>
                  <Text style={[styles.diaText, fechaEntrada === d && styles.diaTextActivo]}>{d}</Text>
                  <Text style={[styles.mesText, fechaEntrada === d && styles.diaTextActivo]}>{MESES[hoy.getMonth()]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.modalLabel}>📅 Fecha de salida</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.diasRow}>
              {dias.filter(d => !fechaEntrada || d > fechaEntrada).map(d => (
                <TouchableOpacity key={d} onPress={() => setFechaSalida(d)} style={[styles.diaBtn, fechaSalida === d && styles.diaBtnActivo]}>
                  <Text style={[styles.diaText, fechaSalida === d && styles.diaTextActivo]}>{d}</Text>
                  <Text style={[styles.mesText, fechaSalida === d && styles.diaTextActivo]}>{MESES[hoy.getMonth()]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.modalLabel}>👥 Número de huéspedes</Text>
            <View style={styles.huespedesRow}>
              <TouchableOpacity onPress={() => setHuespedes(Math.max(1, huespedes - 1))} style={styles.huespedesBtn}>
                <Text style={styles.huespedBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.huespedesNum}>{huespedes}</Text>
              <TouchableOpacity onPress={() => setHuespedes(Math.min(modalReserva.huespedes_max || 6, huespedes + 1))} style={styles.huespedesBtn}>
                <Text style={styles.huespedBtnText}>+</Text>
              </TouchableOpacity>
              <Text style={styles.huespedesMax}>máx. {modalReserva.huespedes_max}</Text>
            </View>

            {fechaEntrada && fechaSalida && (
              <View style={styles.resumenBox}>
                <Text style={styles.resumenText}>{noches} noche{noches > 1 ? 's' : ''} × Bs. {modalReserva.precio_noche}</Text>
                <Text style={styles.resumenTotal}>Total: Bs. {modalReserva.precio_noche * noches}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.confirmarBtn, (!fechaEntrada || !fechaSalida) && styles.confirmarBtnDisabled]}
              onPress={confirmarReserva}
              disabled={!fechaEntrada || !fechaSalida}>
              <Text style={styles.confirmarText}>✅ Agregar al carrito</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalReserva(null)} style={styles.cancelarBtn}>
              <Text style={styles.cancelarText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {totalItems > 0 && (
        <View style={styles.footerCarrito}>
          <TouchableOpacity onPress={() => router.push('/carrito')} style={styles.footerBtn}>
            <LinearGradient colors={['#6B21A8', '#4C1D95']} style={styles.footerGradient}>
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
  headerSub: { fontSize: 13, color: '#C4B5FD', marginTop: 4 },
  carritoBtn: { position: 'relative', padding: 8 },
  carritoEmoji: { fontSize: 28 },
  carritoBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FFF', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  carritoBadgeText: { fontSize: 11, fontWeight: '800', color: '#6B21A8' },
  filtrosBar: { paddingVertical: 12, maxHeight: 56 },
  filtroBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  filtroBtnActivo: { backgroundColor: '#6B21A8', borderColor: '#6B21A8' },
  filtroBtnOferta: { backgroundColor: '#F97316', borderColor: '#F97316' },
  filtroText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  filtroTextActivo: { color: '#FFF' },
  lista: { flex: 1, paddingHorizontal: 16 },
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  resultados: { fontSize: 13, color: '#9CA3AF', marginVertical: 10 },
  card: { backgroundColor: '#FFF', borderRadius: 20, marginBottom: 16, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8, overflow: 'hidden' },
  cardImagen: { height: 180, width: '100%' },
  cardEmoji: { fontSize: 56 },
  cardBody: { padding: 16 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardCiudad: { fontSize: 12, color: '#9CA3AF' },
  cardRating: { fontSize: 13, color: '#6B21A8', fontWeight: '600' },
  cardNombre: { fontSize: 17, fontWeight: '700', color: '#1E0A3C', marginBottom: 4 },
  cardDesc: { fontSize: 12, color: '#9CA3AF', marginBottom: 6 },
  cardDesde: { fontSize: 13, color: '#9CA3AF', marginBottom: 4 },
  cardPrecio: { fontSize: 16, fontWeight: '800', color: '#6B21A8' },
  cardTap: { fontSize: 12, color: '#6B21A8', fontWeight: '600' },
  detalleBox: { borderTopWidth: 1, borderTopColor: '#F3F4F6', padding: 16 },
  habTitle: { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginBottom: 12 },
  detalleRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  detalleItem: { fontSize: 13, color: '#6B7280', marginBottom: 6 },
  reservarBtn: { backgroundColor: '#6B21A8', borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 8 },
  reservarText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  modalBox: { backgroundColor: '#FFF', borderRadius: 24, padding: 24, width: '90%', maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E0A3C', marginBottom: 4 },
  modalSub: { fontSize: 13, color: '#9CA3AF', marginBottom: 16 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 12 },
  diasRow: { maxHeight: 64 },
  diaBtn: { alignItems: 'center', marginRight: 8, backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  diaBtnActivo: { backgroundColor: '#6B21A8' },
  diaText: { fontSize: 16, fontWeight: '700', color: '#374151' },
  mesText: { fontSize: 10, color: '#9CA3AF' },
  diaTextActivo: { color: '#FFF' },
  huespedesRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  huespedesBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#6B21A8', alignItems: 'center', justifyContent: 'center' },
  huespedBtnText: { fontSize: 20, color: '#FFF', fontWeight: '700', lineHeight: 24 },
  huespedesNum: { fontSize: 22, fontWeight: '800', color: '#1E0A3C', minWidth: 30, textAlign: 'center' },
  huespedesMax: { fontSize: 12, color: '#9CA3AF' },
  resumenBox: { backgroundColor: '#F3F0FF', borderRadius: 14, padding: 14, marginTop: 12 },
  resumenText: { fontSize: 14, color: '#6B7280', marginBottom: 4 },
  resumenTotal: { fontSize: 18, fontWeight: '800', color: '#6B21A8' },
  confirmarBtn: { backgroundColor: '#6B21A8', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16 },
  confirmarBtnDisabled: { backgroundColor: '#C4B5FD' },
  confirmarText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  cancelarBtn: { padding: 12, alignItems: 'center' },
  cancelarText: { color: '#9CA3AF', fontSize: 14 },
  footerCarrito: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#F8F7FF' },
  footerBtn: { borderRadius: 16, overflow: 'hidden' },
  footerGradient: { padding: 18, alignItems: 'center' },
  footerText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});
