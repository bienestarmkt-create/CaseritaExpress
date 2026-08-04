/**
 * components/SelectorCiudad.tsx
 * Selector de ciudad de primer arranque — pantalla completa, se muestra
 * una sola vez (hasta que el cliente la cambie desde perfil.tsx), o de
 * nuevo si la ciudad guardada dejó de estar activa.
 */
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useCiudad } from '../context/CiudadContext';

const EMOJI_CIUDAD: Record<string, string> = {
  Tarija: '🏞️',
  'Santa Cruz': '🌴',
};
const EMOJI_DEFAULT = '📍';

export default function SelectorCiudad() {
  const { ciudadesActivas, error, setCiudad } = useCiudad();

  return (
    <View style={s.container}>
      <Text style={s.emoji}>📍</Text>
      <Text style={s.titulo}>¿Desde dónde nos visitás?</Text>
      <Text style={s.subtitulo}>Te mostramos negocios, alojamientos y eventos de tu ciudad</Text>

      {error ? (
        <Text style={s.errorTexto}>⚠️ {error}</Text>
      ) : ciudadesActivas.length === 0 ? (
        <Text style={s.errorTexto}>No hay ciudades activas por el momento.</Text>
      ) : (
        <View style={s.opciones}>
          {ciudadesActivas.map(c => (
            <TouchableOpacity key={c} style={s.opcion} onPress={() => setCiudad(c)} activeOpacity={0.8}>
              <Text style={s.opcionEmoji}>{EMOJI_CIUDAD[c] ?? EMOJI_DEFAULT}</Text>
              <Text style={s.opcionTexto}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={s.hint}>Podés cambiarla después desde tu perfil</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1E0A3C', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emoji: { fontSize: 56, marginBottom: 8 },
  titulo: { fontSize: 22, fontWeight: '900', color: '#FFF', textAlign: 'center' },
  subtitulo: { fontSize: 14, color: '#C4B5FD', textAlign: 'center', marginTop: 4, marginBottom: 24 },
  errorTexto: { fontSize: 13, color: '#FCA5A5', textAlign: 'center', marginBottom: 12 },
  opciones: { width: '100%', gap: 12 },
  opcion: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#2D1B4E', borderRadius: 16, padding: 18,
    borderWidth: 1.5, borderColor: '#4C3575',
  },
  opcionEmoji: { fontSize: 28 },
  opcionTexto: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: 24 },
});
