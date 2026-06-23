import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

// Sube tu QR de Altoke a Supabase Storage (bucket público) y configura esta variable:
// EXPO_PUBLIC_ALTOKE_QR_URL=https://tu-proyecto.supabase.co/storage/v1/object/public/assets/altoke-qr.png
const ALTOKE_QR_URL = process.env.EXPO_PUBLIC_ALTOKE_QR_URL ?? null;

type Estado = 'idle' | 'subiendo' | 'verificando' | 'aprobado' | 'rechazado' | 'error';

export default function PagoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    tipos: string;
    ids: string;
    codigo: string;
    total: string;
  }>();

  const tipos = (params.tipos ?? '').split(',').filter(Boolean);
  const ids   = (params.ids   ?? '').split(',').filter(Boolean);
  const codigo = params.codigo ?? '';
  const total  = parseFloat(params.total ?? '0');

  const [estado, setEstado]         = useState<Estado>('idle');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [mimeType, setMimeType]     = useState('image/jpeg');
  const [fileObj, setFileObj]       = useState<File | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [resultado, setResultado]   = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Realtime: escucha cambios de pago_estado mientras se verifica ──
  useEffect(() => {
    if (estado !== 'verificando' || ids.length === 0 || tipos.length === 0) return

    const tableName =
      tipos[0] === 'pedido' ? 'pedidos' :
      tipos[0] === 'reserva' ? 'reservas' : 'entradas'

    const channel = supabase
      .channel(`pago-rt-${ids[0]}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: tableName,
        filter: `id=eq.${ids[0]}`,
      }, (payload: any) => {
        const { pago_estado, ...rest } = payload.new as { pago_estado: string }
        if (pago_estado === 'verificado') {
          setEstado('aprobado')
        } else if (pago_estado === 'rechazado') {
          setResultado({ resultado: rest })
          setEstado('rechazado')
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [estado])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('La imagen supera 5 MB. Elige una más pequeña.');
      return;
    }
    setFileObj(file);
    setMimeType(file.type || 'image/jpeg');
    setErrorMsg('');
    setEstado('idle');
    const reader = new FileReader();
    reader.onload = ev => setPreviewUri(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!fileObj || tipos.length === 0) return;
    setEstado('subiendo');
    setErrorMsg('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Debes iniciar sesión.');

      // ── Subir a Supabase Storage ────────────────────────────
      const ext  = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
      const path = `${user.id}/${codigo}/comprobante.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('comprobantes')
        .upload(path, fileObj, { contentType: mimeType, upsert: true });

      if (uploadErr) throw new Error(`Upload: ${uploadErr.message}`);

      // ── URL firmada (1 hora) para que la API descargue la imagen ─
      const { data: signed, error: signErr } = await supabase.storage
        .from('comprobantes')
        .createSignedUrl(path, 3600);

      if (signErr || !signed?.signedUrl) throw new Error('No se pudo generar URL firmada');

      // ── Llamar a la Supabase Edge Function ──────────────────
      // El Realtime (useEffect arriba) también escucha cambios en paralelo.
      setEstado('verificando');

      const { data, error: fnError } = await supabase.functions.invoke('verificar-pago', {
        body: {
          tipos,
          ids,
          comprobante_url: signed.signedUrl,
          codigo_esperado:  codigo,
          monto_esperado:   total,
          mime_type:        mimeType,
        },
      });

      if (fnError) throw new Error(fnError.message ?? 'Error en la Edge Function');
      setResultado(data);
      setEstado(data.aprobado ? 'aprobado' : 'rechazado');

    } catch (err: any) {
      console.error('[pago]', err);
      setErrorMsg(err.message ?? 'Error inesperado. Intenta de nuevo.');
      setEstado('error');
    }
  };

  // ── Pantalla: APROBADO ──────────────────────────────────────────
  if (estado === 'aprobado') {
    return (
      <View style={s.flex1}>
        <LinearGradient colors={['#064E3B', '#047857']} style={s.fullScreen}>
          <Text style={s.bigEmoji}>✅</Text>
          <Text style={s.resultTitle}>¡Pago verificado!</Text>
          <Text style={s.resultSub}>
            Tu pedido fue confirmado automáticamente.{'\n'}Recibirás novedades por notificación.
          </Text>
          <View style={s.codeChip}>
            <Text style={s.codeChipText}>{codigo}</Text>
          </View>
          <TouchableOpacity style={s.resultBtn} onPress={() => router.replace('/seguimiento')}>
            <Text style={s.resultBtnText}>Ver estado del pedido →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.resultBtnSec} onPress={() => router.replace('/')}>
            <Text style={s.resultBtnSecText}>Ir al inicio</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  }

  // ── Pantalla: RECHAZADO ─────────────────────────────────────────
  if (estado === 'rechazado') {
    const r = resultado?.resultado ?? {};
    return (
      <View style={s.flex1}>
        <LinearGradient colors={['#7F1D1D', '#B91C1C']} style={s.fullScreen}>
          <Text style={s.bigEmoji}>❌</Text>
          <Text style={s.resultTitle}>Comprobante rechazado</Text>
          <Text style={s.resultSub}>
            {r.razon_rechazo || 'El monto o código de referencia no coinciden con el pago esperado.'}
          </Text>
          <View style={s.rechazadoCard}>
            <Row label="Código esperado"    valor={codigo}              />
            <Row label="Código encontrado"  valor={r.codigo_encontrado || 'No detectado'} />
            <Row label="Monto esperado"     valor={`Bs. ${total}`}      />
            <Row label="Monto encontrado"   valor={r.monto_encontrado != null ? `Bs. ${r.monto_encontrado}` : 'No detectado'} />
            <Row label="Confianza IA"       valor={r.confianza ?? '—'}  />
          </View>
          <TouchableOpacity style={s.resultBtn} onPress={() => { setEstado('idle'); setPreviewUri(null); setFileObj(null); }}>
            <Text style={[s.resultBtnText, { color: '#7F1D1D' }]}>Intentar de nuevo</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  }

  // ── Pantalla principal ──────────────────────────────────────────
  return (
    <View style={s.flex1}>
      {/* Header */}
      <LinearGradient colors={['#1E0A3C', '#4C1D95']} style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="arrow-back" size={18} color="#DDD6FE" />
          <Text style={s.backText}>Volver</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Confirmar Pago</Text>
        <Text style={s.headerSub}>
          {tipos.length} {tipos.length === 1 ? 'pedido' : 'pedidos'} · Bs. {total.toFixed(2)}
        </Text>
      </LinearGradient>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Código de referencia ── */}
        <View style={s.card}>
          <Label text="Código de referencia" />
          <View style={s.codeBox}>
            <Text style={s.codeText} selectable>{codigo}</Text>
          </View>
          <Text style={s.hint}>
            Escribe este código en el campo "concepto" o "descripción" al realizar el pago
          </Text>
        </View>

        {/* ── Monto ── */}
        <View style={[s.card, s.row]}>
          <Text style={s.montoLabel}>Total a pagar</Text>
          <Text style={s.montoValor}>Bs. {total.toFixed(2)}</Text>
        </View>

        {/* ── Pasos ── */}
        <View style={s.card}>
          <Label text="¿Cómo pagar?" />
          {[
            { n: '1', titulo: 'Escanea el QR de Altoke',  desc: 'Abre tu app de banco o Altoke y escanea el código QR' },
            { n: '2', titulo: `Ingresa Bs. ${total.toFixed(2)}`, desc: `En el concepto escribe exactamente: ${codigo}` },
            { n: '3', titulo: 'Sube el comprobante',      desc: 'Captura la confirmación y súbela aquí abajo' },
          ].map(step => (
            <View key={step.n} style={s.step}>
              <View style={s.stepBubble}><Text style={s.stepN}>{step.n}</Text></View>
              <View style={s.stepBody}>
                <Text style={s.stepTitulo}>{step.titulo}</Text>
                <Text style={s.stepDesc}>{step.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── QR de Altoke ── */}
        <View style={s.card}>
          <Label text="QR de pago — Altoke" />
          {ALTOKE_QR_URL ? (
            <Image source={{ uri: ALTOKE_QR_URL }} style={s.qrImg} resizeMode="contain" />
          ) : (
            <View style={s.qrPlaceholder}>
              <Ionicons name="qr-code-outline" size={56} color="#6B21A8" />
              <Text style={s.qrPlaceholderTitle}>QR no configurado</Text>
              <Text style={s.qrPlaceholderSub}>
                Agrega en .env.local:{'\n'}EXPO_PUBLIC_ALTOKE_QR_URL=https://...
              </Text>
            </View>
          )}
          <Text style={s.hint}>Escanea con tu app bancaria · El monto lo ingresas tú</Text>
        </View>

        {/* ── Upload comprobante ── */}
        <View style={s.card}>
          <Label text="Comprobante de pago" />

          {/* Input nativo para web */}
          {Platform.OS === 'web' && (
            // @ts-ignore
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          )}

          {previewUri ? (
            <View style={s.previewWrap}>
              <Image source={{ uri: previewUri }} style={s.previewImg} resizeMode="cover" />
              <TouchableOpacity
                style={s.changeImgBtn}
                onPress={() => Platform.OS === 'web' && fileInputRef.current?.click()}
              >
                <Ionicons name="refresh-outline" size={14} color="#6B21A8" />
                <Text style={s.changeImgText}>Cambiar imagen</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={s.uploadBtn}
              onPress={() => Platform.OS === 'web' && fileInputRef.current?.click()}
            >
              <Ionicons name="cloud-upload-outline" size={36} color="#6B21A8" />
              <Text style={s.uploadTitle}>Seleccionar comprobante</Text>
              <Text style={s.uploadSub}>JPG · PNG · WebP · máx. 5 MB</Text>
            </TouchableOpacity>
          )}
        </View>

        {errorMsg !== '' && (
          <View style={s.errorBox}>
            <Ionicons name="warning-outline" size={16} color="#DC2626" />
            <Text style={s.errorText}>{errorMsg}</Text>
          </View>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* ── Footer fijo ── */}
      <View style={s.footer}>
        {estado === 'subiendo' || estado === 'verificando' ? (
          <View style={s.loadingPill}>
            <ActivityIndicator color="#FFF" size="small" />
            <Text style={s.loadingText}>
              {estado === 'subiendo' ? 'Subiendo imagen...' : '🤖 Verificando con IA...'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.submitBtn, !fileObj && s.submitDisabled]}
            onPress={handleSubmit}
            disabled={!fileObj}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={fileObj ? ['#6B21A8', '#4C1D95'] : ['#D1D5DB', '#9CA3AF']}
              style={s.submitGradient}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color="#FFF" />
              <Text style={s.submitText}>Verificar y confirmar pago</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Subcomponentes pequeños ─────────────────────────────────────
function Label({ text }: { text: string }) {
  return <Text style={s.cardLabel}>{text}</Text>;
}

function Row({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={s.rechazadoRow}>
      <Text style={s.rechazadoLabel}>{label}:</Text>
      <Text style={s.rechazadoValor}>{valor}</Text>
    </View>
  );
}

// ── Estilos ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: '#F8F7FF' },
  // Header
  header: { paddingTop: 55, paddingBottom: 20, paddingHorizontal: 20 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  backText: { color: '#DDD6FE', fontSize: 14 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#FFF' },
  headerSub: { fontSize: 13, color: '#C4B5FD', marginTop: 4 },
  // Scroll
  scroll: { flex: 1, padding: 16 },
  // Card base
  card: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B21A8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  // Código
  codeBox: {
    backgroundColor: '#F3F0FF',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#DDD6FE',
  },
  codeText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1E0A3C',
    letterSpacing: 2,
  },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: 10, lineHeight: 18, textAlign: 'center' },
  // Monto
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  montoLabel: { fontSize: 16, fontWeight: '700', color: '#374151' },
  montoValor: { fontSize: 26, fontWeight: '900', color: '#6B21A8' },
  // Pasos
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  stepBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#6B21A8',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, marginTop: 1,
  },
  stepN: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  stepBody: { flex: 1 },
  stepTitulo: { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 3 },
  stepDesc: { fontSize: 12, color: '#9CA3AF', lineHeight: 18 },
  // QR
  qrImg: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#F9F9F9' },
  qrPlaceholder: {
    height: 180,
    backgroundColor: '#F3F0FF',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  qrPlaceholderTitle: { fontSize: 14, fontWeight: '700', color: '#6B21A8' },
  qrPlaceholderSub: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18 },
  // Upload
  uploadBtn: {
    borderWidth: 2,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F9F8FF',
  },
  uploadTitle: { fontSize: 15, fontWeight: '700', color: '#6B21A8' },
  uploadSub: { fontSize: 12, color: '#9CA3AF' },
  previewWrap: { borderRadius: 14, overflow: 'hidden' },
  previewImg: { width: '100%', height: 220, backgroundColor: '#F3F4F6' },
  changeImgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F3F0FF',
    paddingVertical: 12,
  },
  changeImgText: { fontSize: 13, color: '#6B21A8', fontWeight: '600' },
  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { flex: 1, color: '#DC2626', fontSize: 13, lineHeight: 20 },
  // Footer
  footer: { padding: 16, paddingBottom: 24, backgroundColor: '#F8F7FF' },
  loadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#6B21A8',
    borderRadius: 16,
    padding: 18,
  },
  loadingText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  submitBtn: { borderRadius: 16, overflow: 'hidden' },
  submitDisabled: { opacity: 0.55 },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    gap: 10,
  },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  // Pantallas de resultado
  fullScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  bigEmoji: { fontSize: 72, marginBottom: 20 },
  resultTitle: { fontSize: 26, fontWeight: '800', color: '#FFF', textAlign: 'center', marginBottom: 12 },
  resultSub: { fontSize: 15, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  codeChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginBottom: 32,
  },
  codeChipText: { fontSize: 18, fontWeight: '800', color: '#FFF', letterSpacing: 2 },
  resultBtn: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 16,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  resultBtnText: { fontSize: 16, fontWeight: '800', color: '#064E3B' },
  resultBtnSec: { paddingVertical: 10 },
  resultBtnSecText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  // Rechazado
  rechazadoCard: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 18,
    width: '100%',
    marginBottom: 28,
    gap: 8,
  },
  rechazadoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rechazadoLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1 },
  rechazadoValor: { fontSize: 12, color: '#FFF', fontWeight: '700', flex: 1, textAlign: 'right' },
});
