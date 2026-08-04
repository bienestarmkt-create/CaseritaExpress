/**
 * app/mi-boleto.tsx
 * ─────────────────────────────────────────────────────────────
 * Vista del cliente: el boleto que cierra el ciclo de pago en los
 * 3 módulos (delivery / stay / evento). Reemplaza a mi-ticket.tsx y
 * mi-reserva.tsx, que mostraban la referencia de PAGO como si fuera un
 * código de entrada y no tenían datos reales ni QR.
 *
 * Funciona sin conexión una vez cargado: lib/boletos.ts cachea el
 * boleto en AsyncStorage la primera vez que carga con éxito.
 * ─────────────────────────────────────────────────────────────
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from '../components/QRCode';
import { obtenerBoleto, TIPO_LABEL, ESTADO_LABEL, type Boleto } from '../lib/boletos';

function formatFecha(fecha: string | null): string | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString('es-BO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function detallesPorTipo(boleto: Boleto): { icon: string; texto: string }[] {
  const s = boleto.datos_snapshot ?? {};
  if (boleto.tipo === 'evento') {
    const rows: { icon: string; texto: string }[] = [];
    if (s.evento) rows.push({ icon: '🎉', texto: s.evento });
    if (s.fecha_evento) rows.push({ icon: '📅', texto: formatFecha(s.fecha_evento) ?? s.fecha_evento });
    if (s.lugar) rows.push({ icon: '📍', texto: s.lugar });
    if (s.cantidad) rows.push({ icon: '🎟️', texto: `${s.cantidad} entrada${s.cantidad > 1 ? 's' : ''}` });
    return rows;
  }
  if (boleto.tipo === 'stay') {
    const rows: { icon: string; texto: string }[] = [];
    if (s.alojamiento) rows.push({ icon: '🏡', texto: s.alojamiento });
    if (s.tipo_habitacion) rows.push({ icon: '🛏️', texto: s.tipo_habitacion });
    if (s.check_in) rows.push({ icon: '📅', texto: `Check-in: ${formatFecha(s.check_in) ?? s.check_in}` });
    if (s.check_out) rows.push({ icon: '📅', texto: `Check-out: ${formatFecha(s.check_out) ?? s.check_out}` });
    if (s.noches) rows.push({ icon: '🌙', texto: `${s.noches} noche${s.noches > 1 ? 's' : ''}` });
    return rows;
  }
  const rows: { icon: string; texto: string }[] = [];
  if (s.negocio) rows.push({ icon: '🏪', texto: s.negocio });
  if (s.direccion_entrega) rows.push({ icon: '📍', texto: s.direccion_entrega });
  return rows;
}

export default function MiBoletoScreen() {
  const router = useRouter();
  const { codigo } = useLocalSearchParams<{ codigo: string }>();

  const [boleto, setBoleto]     = useState<Boleto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [avisoOffline, setAvisoOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function cargar() {
      if (!codigo) { setCargando(false); setErrorMsg('Falta el código del boleto.'); return; }
      const { boleto: b, fuente, error } = await obtenerBoleto(codigo);
      if (!mounted) return;
      if (b) {
        setBoleto(b);
        setAvisoOffline(fuente === 'cache');
      } else {
        setErrorMsg(error ?? 'No pudimos encontrar este boleto.');
      }
      setCargando(false);
    }
    cargar();
    return () => { mounted = false; };
  }, [codigo]);

  const compartir = async () => {
    if (!boleto) return;
    const detalles = detallesPorTipo(boleto).map(d => `${d.icon} ${d.texto}`).join('\n');
    try {
      await Share.share({
        message: `Mi boleto CaseritaExpress\nCódigo: ${boleto.codigo}\n${detalles}`,
      });
    } catch (e) {
      console.error('[mi-boleto] Error al compartir', e);
    }
  };

  if (cargando) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color="#6B21A8" />
        <Text style={s.loadingText}>Cargando tu boleto…</Text>
      </View>
    );
  }

  if (!boleto) {
    return (
      <View style={s.centered}>
        <Text style={s.errorIcon}>⚠️</Text>
        <Text style={s.errorTitle}>No pudimos mostrar tu boleto</Text>
        <Text style={s.errorSub}>{errorMsg}</Text>
        <TouchableOpacity style={s.btnVolver} onPress={() => router.replace('/mis-boletos' as any)}>
          <Text style={s.btnVolverText}>Ver mis boletos</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const usado = boleto.estado === 'usado';

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={['#1E0A3C', '#6B21A8']} style={s.header}>
        <Text style={s.emoji}>{TIPO_LABEL[boleto.tipo].split(' ')[0]}</Text>
        <Text style={s.titulo}>{usado ? 'Boleto usado' : '¡Pago confirmado!'}</Text>
        <Text style={s.subtitulo}>{usado ? `Usado el ${formatFecha(boleto.fecha_uso) ?? ''}` : 'Presentá este boleto donde corresponda'}</Text>
      </LinearGradient>

      {avisoOffline && (
        <View style={s.avisoOfflineBox}>
          <Text style={s.avisoOfflineText}>📴 Estás viendo la última copia guardada de este boleto (sin conexión).</Text>
        </View>
      )}

      <View style={s.ticketCard}>
        <View style={s.dentadoRow}>
          {Array.from({ length: 14 }).map((_, i) => <View key={i} style={s.diente} />)}
        </View>

        <View style={s.ticketBody}>
          {detallesPorTipo(boleto).map((d, i) => (
            <View key={i} style={s.detalleRow}>
              <Text style={s.detalleIcon}>{d.icon}</Text>
              <Text style={s.detalleTexto}>{d.texto}</Text>
            </View>
          ))}

          <View style={s.separadorPunteado} />

          <View style={[s.qrWrapper, usado && s.qrWrapperUsado]}>
            <QRCode value={boleto.codigo} size={180} />
            {usado && (
              <View style={s.usadoOverlay}>
                <Text style={s.usadoOverlayText}>USADO</Text>
              </View>
            )}
          </View>

          <Text style={s.codigoLabel}>Código del boleto</Text>
          <View style={s.codigoBox}>
            <Text style={s.codigoTexto}>{boleto.codigo}</Text>
          </View>
          <Text style={s.codigoHint}>Bs. {Number(boleto.monto).toFixed(2)} · {ESTADO_LABEL[boleto.estado]}</Text>
        </View>

        <View style={s.dentadoRow}>
          {Array.from({ length: 14 }).map((_, i) => <View key={i} style={s.diente} />)}
        </View>
      </View>

      <TouchableOpacity style={s.btnCompartir} onPress={compartir}>
        <Text style={s.btnCompartirText}>📤 Compartir</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.btnPerfil} onPress={() => router.replace('/mis-boletos' as any)}>
        <Text style={s.btnPerfilText}>Ver todos mis boletos →</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const PURPLE = '#6B21A8';
const PURPLE_LIGHT = '#EDE9FE';

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F8F7FF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F7FF', gap: 12, padding: 32 },
  loadingText: { color: '#9CA3AF', fontSize: 14 },
  errorIcon: { fontSize: 48 },
  errorTitle: { fontSize: 18, fontWeight: '800', color: '#1E0A3C' },
  errorSub: { fontSize: 13, color: '#6B7280', textAlign: 'center' },

  header: { paddingTop: 70, paddingBottom: 40, alignItems: 'center', paddingHorizontal: 24 },
  emoji: { fontSize: 64, marginBottom: 12 },
  titulo: { fontSize: 26, fontWeight: '900', color: '#FFF', textAlign: 'center', marginBottom: 8 },
  subtitulo: { fontSize: 14, color: '#DDD6FE', textAlign: 'center' },

  avisoOfflineBox: { backgroundColor: '#FEF3C7', marginHorizontal: 20, marginTop: 12, borderRadius: 10, padding: 10 },
  avisoOfflineText: { fontSize: 12, color: '#92400E', textAlign: 'center' },

  ticketCard: { backgroundColor: '#FFF', marginHorizontal: 20, marginTop: -20, borderRadius: 20, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, overflow: 'hidden' },
  dentadoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, backgroundColor: '#F8F7FF' },
  diente: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#F8F7FF' },
  ticketBody: { padding: 28, alignItems: 'center' },
  detalleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10, alignSelf: 'stretch' },
  detalleIcon: { fontSize: 18 },
  detalleTexto: { fontSize: 14, color: '#4B5563', flex: 1, lineHeight: 20 },
  separadorPunteado: { borderTopWidth: 1, borderTopColor: '#E5E7EB', borderStyle: 'dashed', marginVertical: 20, alignSelf: 'stretch' },

  qrWrapper: { padding: 12, backgroundColor: '#FFF', borderRadius: 12, borderWidth: 2, borderColor: PURPLE, marginBottom: 16, position: 'relative' },
  qrWrapperUsado: { opacity: 0.35 },
  usadoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  usadoOverlayText: { fontSize: 24, fontWeight: '900', color: '#DC2626', transform: [{ rotate: '-20deg' }], letterSpacing: 2 },

  codigoLabel: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },
  codigoBox: { backgroundColor: PURPLE_LIGHT, borderWidth: 2, borderColor: PURPLE, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', marginBottom: 10 },
  codigoTexto: { fontSize: 24, fontWeight: '900', color: PURPLE, letterSpacing: 3 },
  codigoHint: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },

  btnCompartir: { marginHorizontal: 20, marginTop: 16, backgroundColor: '#FFF', borderWidth: 2, borderColor: PURPLE, borderRadius: 16, padding: 16, alignItems: 'center' },
  btnCompartirText: { color: PURPLE, fontSize: 15, fontWeight: '800' },
  btnPerfil: { marginHorizontal: 20, marginTop: 12, backgroundColor: PURPLE, borderRadius: 16, padding: 18, alignItems: 'center' },
  btnPerfilText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  btnVolver: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, backgroundColor: PURPLE, borderRadius: 12 },
  btnVolverText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
