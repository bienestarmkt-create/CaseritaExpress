import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Validacion = 'idle' | 'subiendo' | 'validando' | 'aprobado' | 'rechazado';

function formatTimer(seg: number): string {
  const m = Math.floor(seg / 60).toString().padStart(2, '0');
  const s = (seg % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function PagoQrScreen() {
  const router = useRouter();
  const { pedidoId, total, referenciaPago, tipo, nombreEvento, nombreAlojamiento } = useLocalSearchParams<{
    pedidoId: string;
    total: string;
    referenciaPago: string;
    tipo: string;
    nombreEvento: string;
    nombreAlojamiento: string;
  }>();

  const [segundos, setSegundos]       = useState(1800);
  const [tiempoAgotado, setTiempoAgotado] = useState(false);
  const [imageUri, setImageUri]       = useState<string | null>(null);
  const [validacion, setValidacion]   = useState<Validacion>('idle');
  const [intentos, setIntentos]       = useState(0);
  const [motivoRechazo, setMotivoRechazo] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Reset completo + reinicio del timer cuando cambia el pedido ─
  // Expo Router no desmonta el componente al navegar al mismo route
  // con params distintos, por lo que el estado del pedido anterior
  // quedaría visible. Este efecto garantiza un inicio limpio.
  useEffect(() => {
    setSegundos(1800);
    setTiempoAgotado(false);
    setImageUri(null);
    setValidacion('idle');
    setIntentos(0);
    setMotivoRechazo(null);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setSegundos(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          setTiempoAgotado(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { clearInterval(intervalRef.current!); };
  }, [pedidoId]);

  const timerColor =
    segundos < 300 ? '#DC2626' :
    segundos < 600 ? '#F97316' : '#6B7280';

  // ── Seleccionar imagen ─────────────────────────────────────────
  async function seleccionarImagen() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para subir el comprobante.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
      setValidacion('idle');
      setMotivoRechazo(null);
    }
  }

  // ── Confirmar pago ─────────────────────────────────────────────
  async function confirmarPago() {
    if (!imageUri || !pedidoId) return;

    try {
      setValidacion('subiendo');

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('No hay sesión activa');

      // Descargar imagen como blob y convertir a ArrayBuffer
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const filePath = `${userId}/${pedidoId}/comprobante_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('comprobantes')
        .upload(filePath, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw new Error('Error al subir imagen: ' + uploadError.message);

      const { data: urlData } = supabase.storage
        .from('comprobantes')
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

      await supabase
        .from('pedidos')
        .update({ comprobante_url: publicUrl })
        .eq('id', pedidoId);

      // ── Llamar Edge Function de validación ────────────────────
      setValidacion('validando');

      const { data: resultado, error: fnError } = await supabase.functions.invoke(
        'validar-comprobante',
        {
          body: {
            pedidoId,
            comprobante_url:  filePath,
            total_esperado:   Number(total),
          },
        }
      );

      if (fnError) throw new Error(fnError.message);

      if (resultado?.valido) {
        clearInterval(intervalRef.current!);
        setValidacion('aprobado');
        setTimeout(() => {
          if (tipo === 'evento') {
            router.replace({ pathname: '/mi-ticket', params: { pedidoId, referenciaPago, nombreEvento } });
          } else if (tipo === 'stay') {
            router.replace({ pathname: '/mi-reserva', params: { pedidoId, referenciaPago, nombreAlojamiento } });
          } else {
            router.replace({ pathname: '/seguimiento', params: { pedidoId } });
          }
        }, 2500);
      } else {
        const nuevosIntentos = intentos + 1;
        setIntentos(nuevosIntentos);
        setMotivoRechazo(resultado?.motivo ?? 'Comprobante no válido');
        setValidacion('rechazado');
        setImageUri(null);
      }
    } catch (error: any) {
      const nuevosIntentos = intentos + 1;
      setIntentos(nuevosIntentos);
      setMotivoRechazo('Error: ' + error.message);
      setValidacion('rechazado');
      setImageUri(null);
    }
  }

  const puedeReintentar = validacion !== 'aprobado' && intentos < 2;
  const mostrarBotonSeleccionar =
    (validacion === 'idle' || validacion === 'rechazado') && puedeReintentar;
  const mostrarBotonConfirmar =
    imageUri !== null &&
    (validacion === 'idle' || (validacion === 'rechazado' && puedeReintentar));

  return (
    <View style={s.flex1}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backText}>←</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Completa tu pago</Text>
          <Text style={s.headerSub}>Escanea • Transfiere • Sube comprobante</Text>
        </View>

        {/* ── SECCIÓN 1: Referencia + Total ── */}
        <View style={s.referenciaCard}>
          <Text style={s.referenciaLabel}>Referencia de tu pedido:</Text>
          <Text style={s.referenciaCodigo}>{referenciaPago}</Text>
          <Text style={s.referenciaHint}>Escríbela en la glosa de tu transferencia</Text>
          <View style={s.separador} />
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total a pagar:</Text>
            <Text style={s.totalValor}>Bs. {total}</Text>
          </View>
        </View>

        {/* ── SECCIÓN 2: QR ── */}
        <View style={s.qrSection}>
          <Text style={s.qrInstruccion}>
            Escanea con cualquier app bancaria boliviana
          </Text>
          {Platform.OS === 'web' ? (
            <img
              src="/images/qr-altoke.png"
              style={{ width: 300, height: 300, objectFit: 'contain', display: 'block', margin: '0 auto' }}
            />
          ) : (
            <Image
              source={require('@/assets/images/qr-altoke/qr_recortado.png')}
              style={{ width: 300, height: 300 }}
              resizeMode="contain"
            />
          )}
          <Text style={s.qrBanco}>BancoSol ALTOKE • QR Interoperable</Text>
        </View>

        {/* ── SECCIÓN 3: Timer ── */}
        <View style={s.timerCard}>
          <Text style={s.timerLabel}>Tiempo restante para pagar</Text>
          <Text style={[s.timerValor, { color: tiempoAgotado ? '#DC2626' : timerColor }]}>
            {tiempoAgotado ? '00:00' : formatTimer(segundos)}
          </Text>
          {tiempoAgotado ? (
            <View style={s.tiempoAgotadoBox}>
              <Text style={s.tiempoAgotadoTexto}>
                ⏰ Tiempo agotado — si ya realizaste la transferencia, podés igualmente subir tu comprobante.
              </Text>
            </View>
          ) : segundos < 600 ? (
            <Text style={[s.timerAviso, { color: timerColor }]}>
              {segundos < 300 ? '⚠️ ¡Menos de 5 minutos!' : '⏱ Apúrate, el tiempo se acaba'}
            </Text>
          ) : null}
        </View>

        {/* ── SECCIÓN 4: Comprobante ── */}
        <View style={s.comprobanteSection}>
          <Text style={s.comprobanteTitle}>Sube tu comprobante de pago</Text>
          <Text style={s.comprobanteHint}>
            Foto de la confirmación de tu transferencia ALTOKE
          </Text>

          {/* Preview imagen seleccionada */}
          {imageUri && (
            <Image source={{ uri: imageUri }} style={s.previewImg} />
          )}

          {/* Estados de validación */}
          {(validacion === 'subiendo' || validacion === 'validando') && (
            <View style={s.estadoRow}>
              <ActivityIndicator color="#F97316" size="small" />
              <Text style={s.estadoTexto}>
                {validacion === 'subiendo' ? 'Subiendo comprobante...' : 'Verificando con IA...'}
              </Text>
            </View>
          )}

          {validacion === 'aprobado' && (
            <Text style={s.aprobadoTexto}>
              ✅ ¡Pago confirmado! Tu pedido está en preparación.
            </Text>
          )}

          {validacion === 'rechazado' && (
            <View style={s.rechazadoBox}>
              <Text style={s.rechazadoTexto}>
                ❌ {motivoRechazo}
              </Text>
              <Text style={s.rechazadoIntentos}>
                Intento {intentos} de 2
              </Text>
            </View>
          )}

          {intentos >= 2 && validacion !== 'aprobado' && (
            <View style={s.limiteBox}>
              <Text style={s.limiteTexto}>
                Has superado el límite de intentos.{'\n'}
                Contacta a soporte por WhatsApp.
              </Text>
            </View>
          )}

          {/* Botón seleccionar */}
          {mostrarBotonSeleccionar && (
            <TouchableOpacity style={s.btnSeleccionar} onPress={seleccionarImagen}>
              <Text style={s.btnSeleccionarText}>📷 Seleccionar comprobante</Text>
            </TouchableOpacity>
          )}

          {/* Botón confirmar */}
          {mostrarBotonConfirmar && (
            <TouchableOpacity
              style={s.btnConfirmar}
              onPress={confirmarPago}
            >
              <Text style={s.btnConfirmarText}>✅ Confirmar pago</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: '#F8F7FF' },
  scroll: { flex: 1 },
  // Header
  header: { paddingTop: 55, paddingBottom: 20, paddingHorizontal: 20, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', alignItems: 'center' },
  backBtn: { position: 'absolute', left: 20, top: 55 },
  backText: { fontSize: 22, color: '#374151' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1E0A3C', marginTop: 4 },
  headerSub: { fontSize: 13, color: '#9CA3AF', marginTop: 4 },
  // Referencia
  referenciaCard: { backgroundColor: '#FFF7ED', borderWidth: 2, borderColor: '#F97316', borderRadius: 16, margin: 16, padding: 20 },
  referenciaLabel: { fontSize: 12, color: '#9CA3AF', marginBottom: 6 },
  referenciaCodigo: { fontSize: 22, fontWeight: '900', color: '#F97316', letterSpacing: 1, marginBottom: 4 },
  referenciaHint: { fontSize: 12, color: '#9CA3AF', marginBottom: 14 },
  separador: { height: 1, backgroundColor: '#FED7AA', marginBottom: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 14, color: '#6B7280' },
  totalValor: { fontSize: 22, fontWeight: '900', color: '#1E0A3C' },
  // QR
  qrSection: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  qrInstruccion: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  qrImage: { width: 260, height: 260, borderRadius: 16 },
  qrBanco: { fontSize: 12, color: '#9CA3AF', marginTop: 12 },
  // Timer
  timerCard: { backgroundColor: '#FFF', borderRadius: 16, marginHorizontal: 16, padding: 20, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
  timerLabel: { fontSize: 13, color: '#9CA3AF', marginBottom: 6 },
  timerValor: { fontSize: 36, fontWeight: '900', letterSpacing: 2 },
  timerAviso: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  tiempoAgotadoBox: { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 10 },
  tiempoAgotadoTexto: { fontSize: 13, color: '#DC2626', fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  // Comprobante
  comprobanteSection: { backgroundColor: '#FFF', borderRadius: 16, margin: 16, padding: 20, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
  comprobanteTitle: { fontSize: 16, fontWeight: '800', color: '#1E0A3C', marginBottom: 4 },
  comprobanteHint: { fontSize: 13, color: '#9CA3AF', marginBottom: 16 },
  previewImg: { width: 180, height: 180, borderRadius: 12, borderWidth: 2, borderColor: '#F97316', alignSelf: 'center', marginBottom: 16 },
  estadoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  estadoTexto: { fontSize: 14, color: '#F97316', fontWeight: '600' },
  aprobadoTexto: { fontSize: 16, color: '#16A34A', fontWeight: '800', textAlign: 'center', marginBottom: 16, lineHeight: 24 },
  rechazadoBox: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, marginBottom: 14 },
  rechazadoTexto: { fontSize: 14, color: '#DC2626', fontWeight: '600', lineHeight: 20 },
  rechazadoIntentos: { fontSize: 12, color: '#EF4444', marginTop: 6 },
  limiteBox: { backgroundColor: '#FFF7ED', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#FED7AA' },
  limiteTexto: { fontSize: 14, color: '#92400E', textAlign: 'center', lineHeight: 22 },
  btnSeleccionar: { backgroundColor: '#FFF7ED', borderWidth: 2, borderColor: '#F97316', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 },
  btnSeleccionarText: { color: '#F97316', fontSize: 15, fontWeight: '800' },
  btnConfirmar: { backgroundColor: '#F97316', borderRadius: 14, padding: 18, alignItems: 'center' },
  btnConfirmarText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
