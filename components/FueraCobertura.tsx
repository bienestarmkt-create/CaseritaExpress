// components/FueraCobertura.tsx
// Pantalla de "todavía no llegamos a tu zona" — se muestra en vez del
// catálogo cuando la geolocalización detecta al visitante en una ciudad
// INACTIVA (Cochabamba, La Paz) o fuera de todo radio de cobertura (ver
// GEOLOCALIZACIÓN AUTOMÁTICA DE CIUDAD, TAREA 3). Captura el WhatsApp en
// `interesados_cobertura` — convierte el rechazo en señal real de dónde
// expandir, en vez de mostrar una lista vacía o el catálogo de otra
// ciudad.
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useCiudad } from '../context/CiudadContext';
import { supabase } from '../lib/supabase';

export default function FueraCobertura() {
  const { fueraCobertura, usarSelectorManual } = useCiudad();
  const [whatsapp, setWhatsapp] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  // AppShell solo renderiza esto cuando fueraCobertura existe, pero por
  // las dudas (cero fallback silencioso: mejor nada que una pantalla rota).
  if (!fueraCobertura) return null;

  const nombreZona = fueraCobertura.ciudadDetectada ?? 'tu zona';

  const enviar = async () => {
    const limpio = whatsapp.trim();
    if (limpio.length < 6) {
      setErrorEnvio('Ingresá un número de WhatsApp válido.');
      return;
    }
    setEnviando(true);
    setErrorEnvio(null);
    const { error } = await supabase.from('interesados_cobertura').insert({
      whatsapp:         limpio,
      latitud:          fueraCobertura.lat,
      longitud:         fueraCobertura.lon,
      ciudad_detectada: fueraCobertura.ciudadDetectada,
    });
    setEnviando(false);
    if (error) {
      console.error('[FueraCobertura] Error guardando interesado', error.message);
      setErrorEnvio('No se pudo guardar. Probá de nuevo en un momento.');
      return;
    }
    setEnviado(true);
  };

  return (
    <View style={s.container}>
      <Text style={s.emoji}>🚧</Text>
      <Text style={s.titulo}>Todavía no llegamos a {nombreZona}</Text>

      {enviado ? (
        <Text style={s.gracias}>¡Gracias! Te avisamos por WhatsApp apenas abramos ahí.</Text>
      ) : (
        <>
          <Text style={s.subtitulo}>Dejanos tu WhatsApp y te avisamos cuando abramos.</Text>
          <TextInput
            style={s.input}
            placeholder="Ej: 71234567"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            value={whatsapp}
            onChangeText={setWhatsapp}
          />
          {errorEnvio && <Text style={s.error}>⚠️ {errorEnvio}</Text>}
          <TouchableOpacity style={s.boton} onPress={enviar} disabled={enviando} activeOpacity={0.8}>
            {enviando ? <ActivityIndicator color="#FFF" /> : <Text style={s.botonTexto}>📲 Avisame cuando abran</Text>}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity onPress={usarSelectorManual} style={s.otraCiudad}>
        <Text style={s.otraCiudadTexto}>Ver otra ciudad</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1E0A3C', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emoji: { fontSize: 56, marginBottom: 8 },
  titulo: { fontSize: 22, fontWeight: '900', color: '#FFF', textAlign: 'center' },
  subtitulo: { fontSize: 14, color: '#C4B5FD', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  gracias: { fontSize: 15, color: '#86EFAC', textAlign: 'center', marginTop: 8, fontWeight: '600', lineHeight: 22 },
  input: {
    width: '100%', backgroundColor: '#2D1B4E', borderRadius: 14, borderWidth: 1.5, borderColor: '#4C3575',
    paddingHorizontal: 16, paddingVertical: 14, color: '#FFF', fontSize: 15, marginBottom: 8,
  },
  error: { fontSize: 12, color: '#FCA5A5', marginBottom: 8, textAlign: 'center' },
  boton: { width: '100%', backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  botonTexto: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  otraCiudad: { marginTop: 28, padding: 8 },
  otraCiudadTexto: { color: '#9CA3AF', fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
