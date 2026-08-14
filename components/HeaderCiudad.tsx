// components/HeaderCiudad.tsx
// Encabezado "📍 Entregando en X ▾" — reemplaza los chips de selección
// manual de ciudad en Delivery/Stay/Eventos (ver GEOLOCALIZACIÓN
// AUTOMÁTICA DE CIUDAD). Al tocarlo abre un selector con las ciudades
// ACTIVAS solamente, sin opción "Todas" — nadie pide comida en otra
// ciudad. Cambiar acá actualiza la ciudad global (context/CiudadContext),
// así que los otros módulos (Delivery/Stay/Eventos) quedan sincronizados.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCiudad } from '../context/CiudadContext';

export default function HeaderCiudad() {
  const { ciudad, ciudadesActivas, setCiudad } = useCiudad();
  const [abierto, setAbierto] = useState(false);

  // AppShell no deja llegar acá sin ciudad resuelta, pero por las dudas
  // (cero fallback silencioso: mejor no mostrar nada que mostrar "null").
  if (!ciudad) return null;

  return (
    <>
      <TouchableOpacity style={styles.boton} onPress={() => setAbierto(true)} activeOpacity={0.7}>
        <Text style={styles.texto}>📍 Entregando en {ciudad} ▾</Text>
      </TouchableOpacity>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={styles.overlay} onPress={() => setAbierto(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.titulo}>Elegí tu ciudad</Text>
            {ciudadesActivas.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.opcion, c === ciudad && styles.opcionActiva]}
                onPress={() => { setCiudad(c); setAbierto(false); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.opcionTexto, c === ciudad && styles.opcionTextoActivo]}>
                  {c === ciudad ? '📍' : '🏙️'} {c}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  boton: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 4,
  },
  texto: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 32, paddingTop: 12, maxHeight: '70%',
  },
  handle: { width: 44, height: 5, backgroundColor: '#E5E7EB', borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
  titulo: { fontSize: 18, fontWeight: '800', color: '#1E0A3C', textAlign: 'center', marginBottom: 16 },
  opcion: {
    paddingVertical: 14, paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', marginBottom: 8,
  },
  opcionActiva: { backgroundColor: '#FFF7ED', borderColor: '#F97316' },
  opcionTexto: { fontSize: 15, fontWeight: '600', color: '#1E0A3C' },
  opcionTextoActivo: { color: '#EA580C', fontWeight: '800' },
});
