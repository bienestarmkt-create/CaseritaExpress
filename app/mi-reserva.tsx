import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

type ReservaDetalle = {
  nombre_alojamiento: string | null;
  fecha_entrada: string | null;
  fecha_salida: string | null;
  noches: number | null;
  huespedes: number | null;
  codigo_referencia: string | null;
};

function formatFecha(fecha: string): string {
  const d = new Date(fecha);
  return d.toLocaleDateString('es-BO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export default function MiReservaScreen() {
  const router = useRouter();
  const { pedidoId, referenciaPago, nombreAlojamiento } = useLocalSearchParams<{
    pedidoId: string;
    referenciaPago: string;
    nombreAlojamiento: string;
  }>();

  const [reserva, setReserva] = useState<ReservaDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargarReserva() {
      if (!pedidoId) { setCargando(false); return; }
      const { data } = await supabase
        .from('reservas')
        .select('nombre_alojamiento, fecha_entrada, fecha_salida, noches, huespedes, codigo_referencia')
        .eq('id', pedidoId)
        .single();
      if (data) setReserva(data as ReservaDetalle);
      setCargando(false);
    }
    cargarReserva();
  }, [pedidoId]);

  const nombreMostrado = reserva?.nombre_alojamiento ?? nombreAlojamiento ?? 'Alojamiento';
  const codigoMostrado = reserva?.codigo_referencia ?? referenciaPago ?? '—';

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={['#1E0A3C', '#6B21A8']} style={s.header}>
        <Text style={s.emoji}>🏡</Text>
        <Text style={s.titulo}>¡Reserva confirmada!</Text>
        <Text style={s.subtitulo}>Tu pago fue verificado exitosamente</Text>
      </LinearGradient>

      <View style={s.reservaCard}>
        <View style={s.dentadoRow}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={s.diente} />
          ))}
        </View>

        <View style={s.cardBody}>
          {cargando ? (
            <ActivityIndicator color="#6B21A8" size="large" style={{ marginVertical: 24 }} />
          ) : (
            <>
              <Text style={s.nombreAlojamiento}>{nombreMostrado}</Text>

              {reserva?.fecha_entrada ? (
                <View style={s.detalleRow}>
                  <Text style={s.detalleIcon}>📅</Text>
                  <View>
                    <Text style={s.detalleLabel}>Check-in</Text>
                    <Text style={s.detalleTexto}>{formatFecha(reserva.fecha_entrada)}</Text>
                  </View>
                </View>
              ) : null}

              {reserva?.fecha_salida ? (
                <View style={s.detalleRow}>
                  <Text style={s.detalleIcon}>📅</Text>
                  <View>
                    <Text style={s.detalleLabel}>Check-out</Text>
                    <Text style={s.detalleTexto}>{formatFecha(reserva.fecha_salida)}</Text>
                  </View>
                </View>
              ) : null}

              {(reserva?.noches || reserva?.huespedes) ? (
                <View style={s.chipsRow}>
                  {reserva.noches ? (
                    <View style={s.chip}>
                      <Text style={s.chipText}>🌙 {reserva.noches} noche{reserva.noches > 1 ? 's' : ''}</Text>
                    </View>
                  ) : null}
                  {reserva.huespedes ? (
                    <View style={s.chip}>
                      <Text style={s.chipText}>👤 {reserva.huespedes} huésped{reserva.huespedes > 1 ? 'es' : ''}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={s.separadorPunteado} />

              <Text style={s.codigoLabel}>Código de reserva</Text>
              <View style={s.codigoBox}>
                <Text style={s.codigoTexto}>{codigoMostrado}</Text>
              </View>
              <Text style={s.codigoHint}>Presenta este código al anfitrión</Text>
            </>
          )}
        </View>

        <View style={s.dentadoRow}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={s.diente} />
          ))}
        </View>
      </View>

      <TouchableOpacity style={s.btnPerfil} onPress={() => router.replace('/perfil')}>
        <Text style={s.btnPerfilText}>Ver mis reservas →</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const PURPLE = '#6B21A8';
const PURPLE_LIGHT = '#EDE9FE';

const s = StyleSheet.create({
  scroll:             { flex: 1, backgroundColor: '#F8F7FF' },
  header:             { paddingTop: 70, paddingBottom: 40, alignItems: 'center', paddingHorizontal: 24 },
  emoji:              { fontSize: 64, marginBottom: 12 },
  titulo:             { fontSize: 26, fontWeight: '900', color: '#FFF', textAlign: 'center', marginBottom: 8 },
  subtitulo:          { fontSize: 14, color: '#DDD6FE', textAlign: 'center' },
  reservaCard:        { backgroundColor: '#FFF', marginHorizontal: 20, marginTop: -20, borderRadius: 20, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, overflow: 'hidden' },
  dentadoRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, backgroundColor: '#F8F7FF' },
  diente:             { width: 14, height: 14, borderRadius: 7, backgroundColor: '#F8F7FF' },
  cardBody:           { padding: 28 },
  nombreAlojamiento:  { fontSize: 22, fontWeight: '900', color: '#1E0A3C', textAlign: 'center', marginBottom: 20 },
  detalleRow:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  detalleIcon:        { fontSize: 18, marginTop: 2 },
  detalleLabel:       { fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detalleTexto:       { fontSize: 14, color: '#374151', fontWeight: '600' },
  chipsRow:           { flexDirection: 'row', gap: 10, marginBottom: 4 },
  chip:               { backgroundColor: PURPLE_LIGHT, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipText:           { fontSize: 13, color: PURPLE, fontWeight: '700' },
  separadorPunteado:  { borderTopWidth: 1, borderTopColor: '#E5E7EB', borderStyle: 'dashed', marginVertical: 20 },
  codigoLabel:        { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },
  codigoBox:          { backgroundColor: PURPLE_LIGHT, borderWidth: 2, borderColor: PURPLE, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', marginBottom: 10 },
  codigoTexto:        { fontSize: 24, fontWeight: '900', color: PURPLE, letterSpacing: 3 },
  codigoHint:         { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },
  btnPerfil:          { marginHorizontal: 20, marginTop: 24, backgroundColor: PURPLE, borderRadius: 16, padding: 18, alignItems: 'center' },
  btnPerfilText:      { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
