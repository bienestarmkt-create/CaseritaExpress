import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function AnfitrionScreen() {
  const router = useRouter();
  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState({
    nombre: '', whatsapp: '', ciudad: '', tipo: '', capacidad: '', precio: '', descripcion: '',
  });

  const actualizar = (campo: string, valor: string) => setForm({ ...form, [campo]: valor });

  const siguiente = () => {
    if (paso < 3) setPaso(paso + 1);
    else Alert.alert('¡Registro exitoso! 🎉', 'Tu alojamiento será revisado en 24 horas. Te contactaremos por WhatsApp.', [
      { text: 'Perfecto', onPress: () => router.push('/') }
    ]);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F97316', '#EA580C']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏠 Ser Anfitrión</Text>
        <Text style={styles.headerSub}>Genera ingresos con tu espacio</Text>
        <View style={styles.progressRow}>
          {[1, 2, 3].map(n => (
            <View key={n} style={styles.progressItem}>
              <View style={[styles.dot, paso >= n && styles.dotActivo]}>
                <Text style={[styles.dotNum, paso >= n && styles.dotNumActivo]}>{n}</Text>
              </View>
              <Text style={styles.dotLabel}>{n === 1 ? 'Tus datos' : n === 2 ? 'Alojamiento' : 'Precio'}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
        {paso === 1 && (
          <View>
            <Text style={styles.pasoTitle}>Cuéntanos de ti</Text>
            <Text style={styles.label}>Nombre completo *</Text>
            <TextInput style={styles.input} placeholder="Ej: María García" value={form.nombre} onChangeText={v => actualizar('nombre', v)} />
            <Text style={styles.label}>WhatsApp *</Text>
            <TextInput style={styles.input} placeholder="Ej: 59176543210" keyboardType="phone-pad" value={form.whatsapp} onChangeText={v => actualizar('whatsapp', v)} />
            <Text style={styles.label}>Ciudad *</Text>
            <View style={styles.opcionesRow}>
              {['Tarija', 'La Paz', 'Santa Cruz', 'Cochabamba'].map(c => (
                <TouchableOpacity key={c} onPress={() => actualizar('ciudad', c)} style={[styles.opcion, form.ciudad === c && styles.opcionActivo]}>
                  <Text style={[styles.opcionText, form.ciudad === c && styles.opcionTextActivo]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {paso === 2 && (
          <View>
            <Text style={styles.pasoTitle}>Tu alojamiento</Text>
            <Text style={styles.label}>Tipo *</Text>
            <View style={styles.opcionesRow}>
              {['Casa completa', 'Departamento', 'Habitación privada', 'Cabaña'].map(t => (
                <TouchableOpacity key={t} onPress={() => actualizar('tipo', t)} style={[styles.opcion, form.tipo === t && styles.opcionActivo]}>
                  <Text style={[styles.opcionText, form.tipo === t && styles.opcionTextActivo]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Capacidad (personas)</Text>
            <TextInput style={styles.input} placeholder="Ej: 4" keyboardType="number-pad" value={form.capacidad} onChangeText={v => actualizar('capacidad', v)} />
            <Text style={styles.label}>Descripción</Text>
            <TextInput style={[styles.input, { height: 100, textAlignVertical: 'top' }]} placeholder="Describe tu espacio..." multiline value={form.descripcion} onChangeText={v => actualizar('descripcion', v)} />
          </View>
        )}

        {paso === 3 && (
          <View>
            <Text style={styles.pasoTitle}>Define tu precio</Text>
            <View style={styles.precioBox}>
              <Text style={styles.precioLabel}>Precio por noche (USD)</Text>
              <TextInput style={styles.precioInput} placeholder="0" keyboardType="number-pad" value={form.precio} onChangeText={v => actualizar('precio', v)} />
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>💡 Referencia de precios</Text>
              <Text style={styles.infoItem}>🏠 Habitación: $15 - $30/noche</Text>
              <Text style={styles.infoItem}>🏡 Departamento: $30 - $60/noche</Text>
              <Text style={styles.infoItem}>🏰 Casa completa: $50 - $120/noche</Text>
            </View>
            {form.precio ? (
              <View style={styles.gananciaBox}>
                <Text style={styles.gananciaTitle}>💰 Tu ganancia estimada</Text>
                <Text style={styles.gananciaNum}>Por mes (10 noches): ${(parseFloat(form.precio) * 0.9 * 10).toFixed(0)} USD</Text>
                <Text style={styles.gananciaNota}>CaseritaExpress cobra solo 10% de comisión</Text>
              </View>
            ) : null}
          </View>
        )}

        <TouchableOpacity style={styles.nextBtn} onPress={siguiente}>
          <LinearGradient colors={['#F97316', '#EA580C']} style={styles.nextGradient}>
            <Text style={styles.nextText}>{paso < 3 ? 'Continuar →' : '✅ Registrarme como Anfitrión'}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  header: { paddingTop: 55, paddingBottom: 24, paddingHorizontal: 20 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#FED7AA', fontSize: 14 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#FFF' },
  headerSub: { fontSize: 13, color: '#FED7AA', marginTop: 4, marginBottom: 20 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-around' },
  progressItem: { alignItems: 'center' },
  dot: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  dotActivo: { backgroundColor: '#FFF' },
  dotNum: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  dotNumActivo: { color: '#EA580C' },
  dotLabel: { fontSize: 11, color: '#FED7AA' },
  form: { flex: 1, padding: 20 },
  pasoTitle: { fontSize: 22, fontWeight: '800', color: '#1E0A3C', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, fontSize: 15, color: '#1E0A3C', borderWidth: 1, borderColor: '#E5E7EB' },
  opcionesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  opcionActivo: { backgroundColor: '#F97316', borderColor: '#F97316' },
  opcionText: { fontSize: 13, color: '#6B7280' },
  opcionTextActivo: { color: '#FFF', fontWeight: '700' },
  precioBox: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 16, borderWidth: 2, borderColor: '#F97316' },
  precioLabel: { fontSize: 14, color: '#6B7280', marginBottom: 8 },
  precioInput: { fontSize: 48, fontWeight: '800', color: '#F97316', textAlign: 'center', minWidth: 100 },
  infoBox: { backgroundColor: '#FFF7ED', borderRadius: 16, padding: 16, marginBottom: 16 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#92400E', marginBottom: 8 },
  infoItem: { fontSize: 13, color: '#78350F', marginBottom: 4 },
  gananciaBox: { backgroundColor: '#F0FDF4', borderRadius: 16, padding: 16, marginBottom: 20 },
  gananciaTitle: { fontSize: 14, fontWeight: '700', color: '#14532D', marginBottom: 8 },
  gananciaNum: { fontSize: 15, color: '#166534', fontWeight: '600', marginBottom: 4 },
  gananciaNota: { fontSize: 12, color: '#4ADE80', marginTop: 4 },
  nextBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 16 },
  nextGradient: { padding: 18, alignItems: 'center' },
  nextText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});