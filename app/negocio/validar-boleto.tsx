/**
 * app/negocio/validar-boleto.tsx
 * ─────────────────────────────────────────────────────────────
 * Portal empresas — validación de boletos (los 3 módulos: delivery,
 * stay, evento). Sirve para cualquier tipo de comercio: la RLS de
 * `boletos` ya filtra por el negocio/alojamiento/evento del usuario
 * logueado, cualquiera sea su tipo.
 *
 * Búsqueda por código. Escaneo de QR con cámara queda pendiente — requiere
 * expo-camera (dependencia nativa nueva, exige build de EAS), no se
 * agregó en esta sesión para no bloquear el resto del trabajo en un
 * rebuild nativo. Buscar por código cubre el caso de uso completo hoy.
 * ─────────────────────────────────────────────────────────────
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { TIPO_LABEL, ESTADO_LABEL, type Boleto } from '../../lib/boletos';

function formatFecha(fecha: string | null): string {
  if (!fecha) return '—';
  const d = new Date(fecha);
  return isNaN(d.getTime()) ? fecha : d.toLocaleString('es-BO');
}

export default function ValidarBoletoScreen() {
  const [codigo, setCodigo]     = useState('');
  const [buscando, setBuscando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [boleto, setBoleto]     = useState<Boleto | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const buscar = async () => {
    const codigoLimpio = codigo.trim().toUpperCase();
    if (!codigoLimpio) return;

    setBuscando(true);
    setErrorMsg(null);
    setBoleto(null);

    const { data, error } = await supabase
      .from('boletos')
      .select('*')
      .eq('codigo', codigoLimpio)
      .maybeSingle();

    setBuscando(false);

    if (error) {
      console.error('[validar-boleto] Error buscando boleto', error.message);
      setErrorMsg('No se pudo buscar el boleto: ' + error.message);
      return;
    }
    if (!data) {
      setErrorMsg('No existe un boleto con ese código, o no pertenece a tu negocio.');
      return;
    }
    setBoleto(data as Boleto);
  };

  const marcarUsado = async () => {
    if (!boleto) return;
    setMarcando(true);

    const { data, error } = await supabase.rpc('marcar_boleto_usado', { p_codigo: boleto.codigo });

    setMarcando(false);

    if (error) {
      console.error('[validar-boleto] Error marcando usado', boleto.codigo, error.message);
      Alert.alert('No se pudo marcar como usado', error.message);
      return;
    }
    setBoleto(data as Boleto);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🎟️ Validar boleto</Text>
        <Text style={s.headerSub}>Buscá por código para verificar y marcar como usado</Text>
      </View>

      <View style={s.buscarRow}>
        <TextInput
          style={s.input}
          placeholder="CE-XXXXXX"
          placeholderTextColor="#9CA3AF"
          value={codigo}
          onChangeText={setCodigo}
          autoCapitalize="characters"
          onSubmitEditing={buscar}
        />
        <TouchableOpacity style={s.btnBuscar} onPress={buscar} disabled={buscando}>
          {buscando ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.btnBuscarText}>Buscar</Text>}
        </TouchableOpacity>
      </View>

      {errorMsg && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>⚠️ {errorMsg}</Text>
        </View>
      )}

      {boleto && (
        <View style={s.resultCard}>
          <View style={s.resultHeader}>
            <Text style={s.resultTipo}>{TIPO_LABEL[boleto.tipo]}</Text>
            <View style={[s.badge, boleto.estado === 'usado' ? s.badgeUsado : s.badgeEmitido]}>
              <Text style={[s.badgeText, boleto.estado === 'usado' ? s.badgeTextUsado : s.badgeTextEmitido]}>
                {ESTADO_LABEL[boleto.estado]}
              </Text>
            </View>
          </View>

          <Text style={s.resultCodigo}>{boleto.codigo}</Text>
          <Text style={s.resultMonto}>Bs. {Number(boleto.monto).toFixed(2)}</Text>

          {Object.entries(boleto.datos_snapshot ?? {}).map(([k, v]) => (
            v ? <Text key={k} style={s.snapshotLine}>{k}: {String(v)}</Text> : null
          ))}

          {boleto.estado === 'usado' ? (
            <View style={s.usadoBox}>
              <Text style={s.usadoText}>✅ Ya fue usado el {formatFecha(boleto.fecha_uso)}</Text>
              <Text style={s.usadoSub}>No se puede volver a usar.</Text>
            </View>
          ) : boleto.estado !== 'emitido' ? (
            <View style={s.usadoBox}>
              <Text style={s.usadoText}>⚠️ Este boleto está {ESTADO_LABEL[boleto.estado].toLowerCase()}, no se puede usar.</Text>
            </View>
          ) : (
            <TouchableOpacity style={s.btnMarcar} onPress={marcarUsado} disabled={marcando}>
              {marcando
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.btnMarcarText}>✓ Marcar como usado</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', padding: 16 },
  header: { marginBottom: 16 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1E0A3C' },
  headerSub: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  buscarRow: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB',
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, fontWeight: '700', letterSpacing: 1, color: '#1E0A3C',
  },
  btnBuscar: { backgroundColor: '#6B21A8', borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  btnBuscarText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 10, padding: 12, marginTop: 12 },
  errorText: { color: '#991B1B', fontSize: 13 },
  resultCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginTop: 16, gap: 6, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultTipo: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeEmitido: { backgroundColor: '#DCFCE7' },
  badgeUsado: { backgroundColor: '#F3F4F6' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextEmitido: { color: '#16A34A' },
  badgeTextUsado: { color: '#6B7280' },
  resultCodigo: { fontSize: 26, fontWeight: '900', color: '#1E0A3C', letterSpacing: 2, marginTop: 4 },
  resultMonto: { fontSize: 16, fontWeight: '700', color: '#6B21A8', marginBottom: 8 },
  snapshotLine: { fontSize: 13, color: '#4B5563' },
  usadoBox: { backgroundColor: '#F3F4F6', borderRadius: 10, padding: 14, marginTop: 12 },
  usadoText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  usadoSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  btnMarcar: { backgroundColor: '#16A34A', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 12 },
  btnMarcarText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
