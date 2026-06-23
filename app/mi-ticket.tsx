import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

type EventoDetalle = {
  nombre: string;
  fecha_evento: string | null;
  lugar: string | null;
};

function formatFecha(fecha: string): string {
  const d = new Date(fecha);
  return d.toLocaleDateString('es-BO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export default function MiTicketScreen() {
  const router = useRouter();
  const { pedidoId, referenciaPago, nombreEvento } = useLocalSearchParams<{
    pedidoId: string;
    referenciaPago: string;
    nombreEvento: string;
  }>();

  const [evento, setEvento] = useState<EventoDetalle | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargarEvento() {
      if (!pedidoId) { setCargando(false); return; }
      const { data } = await supabase
        .from('entradas')
        .select('eventos(nombre, fecha_evento, lugar)')
        .eq('id', pedidoId)
        .single();
      const ev = (data as any)?.eventos;
      if (ev) {
        setEvento({ nombre: ev.nombre, fecha_evento: ev.fecha_evento ?? null, lugar: ev.lugar ?? null });
      }
      setCargando(false);
    }
    cargarEvento();
  }, [pedidoId]);

  const nombreMostrado = evento?.nombre ?? nombreEvento ?? 'Evento';

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={['#1E0A3C', '#6B21A8']} style={s.header}>
        <Text style={s.emoji}>🎟️</Text>
        <Text style={s.titulo}>¡Entrada confirmada!</Text>
        <Text style={s.subtitulo}>Tu pago fue verificado exitosamente</Text>
      </LinearGradient>

      <View style={s.ticketCard}>
        {/* Borde dentado superior */}
        <View style={s.dentadoRow}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={s.diente} />
          ))}
        </View>

        <View style={s.ticketBody}>
          {cargando ? (
            <ActivityIndicator color="#6B21A8" size="large" style={{ marginVertical: 24 }} />
          ) : (
            <>
              <Text style={s.nombreEvento}>{nombreMostrado}</Text>

              {evento?.fecha_evento ? (
                <View style={s.detalleRow}>
                  <Text style={s.detalleIcon}>📅</Text>
                  <Text style={s.detalleTexto}>{formatFecha(evento.fecha_evento)}</Text>
                </View>
              ) : null}

              {evento?.lugar ? (
                <View style={s.detalleRow}>
                  <Text style={s.detalleIcon}>📍</Text>
                  <Text style={s.detalleTexto}>{evento.lugar}</Text>
                </View>
              ) : null}

              <View style={s.separadorPunteado} />

              <Text style={s.codigoLabel}>Código de entrada</Text>
              <View style={s.codigoBox}>
                <Text style={s.codigoTexto}>{referenciaPago ?? '—'}</Text>
              </View>
              <Text style={s.codigoHint}>Presenta este código en la entrada</Text>
            </>
          )}
        </View>

        {/* Borde dentado inferior */}
        <View style={s.dentadoRow}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={s.diente} />
          ))}
        </View>
      </View>

      <TouchableOpacity style={s.btnPerfil} onPress={() => router.replace('/perfil')}>
        <Text style={s.btnPerfilText}>Ver mis entradas →</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const PURPLE = '#6B21A8';
const PURPLE_LIGHT = '#EDE9FE';

const s = StyleSheet.create({
  scroll:           { flex: 1, backgroundColor: '#F8F7FF' },
  header:           { paddingTop: 70, paddingBottom: 40, alignItems: 'center', paddingHorizontal: 24 },
  emoji:            { fontSize: 64, marginBottom: 12 },
  titulo:           { fontSize: 26, fontWeight: '900', color: '#FFF', textAlign: 'center', marginBottom: 8 },
  subtitulo:        { fontSize: 14, color: '#DDD6FE', textAlign: 'center' },
  ticketCard:       { backgroundColor: '#FFF', marginHorizontal: 20, marginTop: -20, borderRadius: 20, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, overflow: 'hidden' },
  dentadoRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, backgroundColor: '#F8F7FF' },
  diente:           { width: 14, height: 14, borderRadius: 7, backgroundColor: '#F8F7FF' },
  ticketBody:       { padding: 28 },
  nombreEvento:     { fontSize: 22, fontWeight: '900', color: '#1E0A3C', textAlign: 'center', marginBottom: 20 },
  detalleRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  detalleIcon:      { fontSize: 18 },
  detalleTexto:     { fontSize: 14, color: '#4B5563', flex: 1, lineHeight: 20 },
  separadorPunteado:{ borderTopWidth: 1, borderTopColor: '#E5E7EB', borderStyle: 'dashed', marginVertical: 20 },
  codigoLabel:      { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },
  codigoBox:        { backgroundColor: PURPLE_LIGHT, borderWidth: 2, borderColor: PURPLE, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', marginBottom: 10 },
  codigoTexto:      { fontSize: 24, fontWeight: '900', color: PURPLE, letterSpacing: 3 },
  codigoHint:       { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },
  btnPerfil:        { marginHorizontal: 20, marginTop: 24, backgroundColor: PURPLE, borderRadius: 16, padding: 18, alignItems: 'center' },
  btnPerfilText:    { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
