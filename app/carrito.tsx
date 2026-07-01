import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { supabase } from '../lib/supabase';
import { sendPushTo } from '../lib/usePush';
import { BrandColors } from '../constants/theme';

// Formato: CE-PED-XXXXXXXX (primeros 8 chars del UUID en mayúsculas)
function generarReferencia(pedidoId: string): string {
  return 'CE-PED-' + pedidoId.substring(0, 8).toUpperCase();
}

function parseStayDetalle(detalle: string) {
  const noches      = parseInt(detalle.match(/(\d+)\s*noche/)?.[1]     ?? '1');
  const huespedes   = parseInt(detalle.match(/(\d+)\s*hu[eé]sped/)?.[1] ?? '1');
  const diaEntrada  = detalle.match(/entrada:(\d+)/)?.[1] ?? null;
  const diaSalida   = detalle.match(/salida:(\d+)/)?.[1]  ?? null;
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
  const fecha_entrada = diaEntrada ? `${yyyy}-${mm}-${diaEntrada.padStart(2, '0')}` : null;
  const fecha_salida  = diaSalida  ? `${yyyy}-${mm}-${diaSalida.padStart(2, '0')}`  : null;
  return { noches, huespedes, fecha_entrada, fecha_salida };
}

type TipoItem = 'delivery' | 'stay' | 'evento';

const TIPO_CONFIG = {
  delivery: { color: '#F97316', label: '🍔 Delivery' },
  stay:     { color: '#6B21A8', label: '🏡 Stay'     },
  evento:   { color: '#7C3AED', label: '🎉 Eventos'  },
};

export default function CarritoScreen() {
  const router = useRouter();
  const { items, aumentar, disminuir, eliminar, limpiarCarrito, totalItems } = useCarrito();
  const [mostrarConfirm, setMostrarConfirm] = useState(false);
  const [guardando, setGuardando]           = useState(false);
  const [errorMsg, setErrorMsg]             = useState('');
  const [metodoPago, setMetodoPago]         = useState<'qr' | 'efectivo'>('qr');
  const [direccionEntrega, setDireccionEntrega] = useState('');
  const [destinoCoords, setDestinoCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [capturandoGPS, setCapturandoGPS]       = useState(false);
  const [mostrarErrorDir, setMostrarErrorDir]   = useState(false);

  const tieneDelivery    = items.some(i => i.tipo === 'delivery');
  const subtotal         = items.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
  const costoEnvio       = tieneDelivery ? (metodoPago === 'qr' ? 8 : 12) : 0;
  const total            = subtotal + costoEnvio;
  const tiposEnCarrito   = [...new Set(items.map(i => i.tipo))];

  const capturarUbicacion = async () => {
    setCapturandoGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso de ubicación', 'Activa el GPS para usar esta función. Tu dirección escrita sigue siendo válida.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setDestinoCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch {
      Alert.alert('GPS no disponible', 'No se pudo obtener la ubicación. Escribe tu dirección manualmente.');
    } finally {
      setCapturandoGPS(false);
    }
  };

  const confirmarPedido = async () => {
    // Validar dirección antes de proceder
    if (tieneDelivery && !direccionEntrega.trim()) {
      setMostrarErrorDir(true);
      return;
    }
    setGuardando(true);
    setErrorMsg('');

    // Intentar capturar GPS silenciosamente si el usuario no lo hizo antes (5 s máx)
    let finalDestinoCoords = destinoCoords;
    if (tieneDelivery && !finalDestinoCoords) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const locPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const nulAfterTimeout = new Promise<null>(res => setTimeout(() => res(null), 5000));
          const result = await Promise.race([locPromise, nulAfterTimeout]);
          if (result) finalDestinoCoords = { lat: result.coords.latitude, lng: result.coords.longitude };
        }
      } catch { /* falla silenciosa — el pedido se crea sin coords */ }
    }
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setErrorMsg('Debes iniciar sesión para confirmar un pedido.');
        setGuardando(false);
        router.push('/login');
        return;
      }

      // ── Delivery → pedidos ─────────────────────────────────────
      const itemsDelivery = items.filter(i => i.tipo === 'delivery');
      let pedidoPrincipalId: string | null = null;
      let tipoNavegacion: TipoItem = 'delivery';

      if (itemsDelivery.length > 0) {
        const subtotalDelivery = itemsDelivery.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
        const negocioId = itemsDelivery[0].negocio_id ?? null;

        const { data: pedido, error: errorPedido } = await supabase
          .from('pedidos')
          .insert({
            cliente_id:        user.id,
            negocio_id:        negocioId,
            subtotal:          subtotalDelivery,
            comision:          Math.round(subtotalDelivery * 0.15),
            total:             subtotalDelivery + costoEnvio,
            estado:            'pendiente',
            direccion_entrega: direccionEntrega.trim(),
            destino_lat:       finalDestinoCoords?.lat ?? null,
            destino_lng:       finalDestinoCoords?.lng ?? null,
            // Campos de pago ALTOKE
            metodo_pago:       metodoPago,
            estado_pago:       'pendiente',
            costo_envio:       costoEnvio,
          })
          .select()
          .single();

        if (errorPedido) throw errorPedido;

        pedidoPrincipalId = pedido.id;
        tipoNavegacion = 'delivery';

        // Agregar referencia ahora que tenemos el ID
        const referencia = generarReferencia(pedido.id);
        await supabase
          .from('pedidos')
          .update({ referencia_pago: referencia })
          .eq('id', pedido.id);

        const { error: errorDetalle } = await supabase
          .from('detalle_pedidos')
          .insert(itemsDelivery.map(item => ({
            pedido_id:      pedido.id,
            producto_id:    item.id,
            cantidad:       item.cantidad,
            precio_unitario:item.precio,
            subtotal:       item.precio * item.cantidad,
          })));

        if (errorDetalle) throw errorDetalle;

        // Notificar al negocio
        if (negocioId) {
          const { data: negocio } = await supabase
            .from('negocios').select('usuario_id').eq('id', negocioId).single();
          if (negocio?.usuario_id) {
            await sendPushTo(
              negocio.usuario_id,
              '🆕 Nuevo pedido recibido',
              `Bs. ${pedido.total} · ${metodoPago === 'qr' ? 'Pago QR' : 'Efectivo'}`,
              '/anfitrion',
              `pedido-nuevo-${pedido.id}`
            );
          }
        }
      }

      // ── Stay → reservas ────────────────────────────────────────
      for (const item of items.filter(i => i.tipo === 'stay')) {
        const { noches, huespedes, fecha_entrada, fecha_salida } = parseStayDetalle(item.detalle);
        const { data: reserva, error: errReserva } = await supabase
          .from('reservas')
          .insert({
            cliente_id:    user.id,
            alojamiento_id:item.id.substring(0, 36),
            huespedes,
            fecha_entrada,
            fecha_salida,
            noches,
            subtotal:      item.precio * item.cantidad,
            comision:      Math.round(item.precio * item.cantidad * 0.15),
            total:         item.precio * item.cantidad,
            pago_estado:   'pendiente',
          })
          .select().single();
        if (errReserva) {
          console.log('[reservas INSERT error]', JSON.stringify(errReserva, null, 2));
          throw errReserva;
        }
        if (!pedidoPrincipalId) { pedidoPrincipalId = reserva.id; tipoNavegacion = 'stay'; }
        await supabase.from('reservas')
          .update({ codigo_referencia: generarReferencia(reserva.id) })
          .eq('id', reserva.id);
      }

      // ── Eventos → entradas ─────────────────────────────────────
      for (const item of items.filter(i => i.tipo === 'evento')) {
        const { data: entrada, error: errEntrada } = await supabase
          .from('entradas')
          .insert({
            cliente_id:      user.id,
            evento_id:       item.id,
            cantidad:        item.cantidad,
            precio_unitario: item.precio,
            total:           item.precio * item.cantidad,
            pago_estado:     'pendiente',
          })
          .select().single();
        if (errEntrada) {
          console.log('[entradas INSERT error]', JSON.stringify(errEntrada, null, 2));
          throw errEntrada;
        }
        if (!pedidoPrincipalId) { pedidoPrincipalId = entrada.id; tipoNavegacion = 'evento'; }
        await supabase.from('entradas')
          .update({ codigo_referencia: generarReferencia(entrada.id) })
          .eq('id', entrada.id);
      }

      limpiarCarrito();
      setMostrarConfirm(false);

      const primerEvento       = items.find(i => i.tipo === 'evento');
      const primerAlojamiento  = items.find(i => i.tipo === 'stay');

      if (metodoPago === 'qr' && pedidoPrincipalId) {
        router.push({
          pathname: '/pago-qr',
          params: {
            pedidoId:          pedidoPrincipalId,
            total:             String(total),
            referenciaPago:    generarReferencia(pedidoPrincipalId),
            tipo:              tipoNavegacion,
            nombreEvento:      primerEvento?.nombre      ?? '',
            nombreAlojamiento: primerAlojamiento?.nombre ?? '',
          },
        });
      } else {
        router.push({
          pathname: '/seguimiento',
          params: { pedidoId: pedidoPrincipalId ?? '' },
        });
      }

    } catch (error: any) {
      const msg = error?.message || error?.details || String(error);
      setErrorMsg(`[${error?.code ?? 'ERR'}] ${msg}`);
      Alert.alert(
        'Error al confirmar pedido',
        `${error?.message ?? ''}\n${error?.details ?? ''}\n${error?.hint ?? ''}`.trim(),
        [{ text: 'OK' }]
      );
    }
    setGuardando(false);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={BrandColors.gradient} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🛒 Mi Carrito</Text>
        <Text style={styles.headerSub}>{totalItems} productos • {tiposEnCarrito.length} módulos</Text>
        <View style={styles.tiposRow}>
          {tiposEnCarrito.map(tipo => (
            <View key={tipo} style={[styles.tipoBadge, { backgroundColor: TIPO_CONFIG[tipo].color }]}>
              <Text style={styles.tipoBadgeText}>{TIPO_CONFIG[tipo].label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
        {errorMsg !== '' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
          </View>
        )}

        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🛒</Text>
            <Text style={styles.emptyTitle}>Tu carrito está vacío</Text>
            <Text style={styles.emptySubtitle}>Agrega productos desde Delivery, Stay o Eventos</Text>
            <TouchableOpacity onPress={() => router.push('/')}>
              <Text style={styles.emptyLink}>Explorar productos →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          (['delivery', 'stay', 'evento'] as TipoItem[]).map(tipo => {
            const grupo = items.filter(i => i.tipo === tipo);
            if (grupo.length === 0) return null;
            return (
              <View key={tipo} style={styles.grupo}>
                <View style={[styles.grupoHeader, { backgroundColor: TIPO_CONFIG[tipo].color }]}>
                  <Text style={styles.grupoTitle}>{TIPO_CONFIG[tipo].label}</Text>
                </View>
                {grupo.map(item => (
                  <View key={item.id} style={styles.itemCard}>
                    <Text style={styles.itemEmoji}>{item.emoji}</Text>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemNombre}>{item.nombre}</Text>
                      <Text style={styles.itemDetalle}>{item.detalle}</Text>
                      <Text style={styles.itemPrecio}>Bs. {item.precio} c/u</Text>
                    </View>
                    <View style={styles.itemControls}>
                      <TouchableOpacity onPress={() => disminuir(item.id)} style={styles.controlBtn}>
                        <Text style={styles.controlText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.cantidad}>{item.cantidad}</Text>
                      <TouchableOpacity onPress={() => aumentar(item.id)} style={[styles.controlBtn, { backgroundColor: TIPO_CONFIG[tipo].color }]}>
                        <Text style={[styles.controlText, { color: '#FFF' }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => eliminar(item.id)} style={styles.deleteBtn}>
                      <Text>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            );
          })
        )}

        {/* ── Selector método de pago ── */}
        {items.length > 0 && (
          <View style={styles.metodosBox}>
            <Text style={styles.metodosTitle}>Método de pago</Text>

            {/* Tarjeta QR */}
            <TouchableOpacity
              style={[styles.metodoCard, metodoPago === 'qr' && styles.metodoCardActivo]}
              onPress={() => setMetodoPago('qr')}
              activeOpacity={0.8}
            >
              {/* Badge recomendado */}
              <View style={styles.badgeRecomendado}>
                <Text style={styles.badgeRecomendadoText}>Recomendado</Text>
              </View>
              <View style={styles.metodoRow}>
                <View style={styles.metodoTextos}>
                  <Text style={styles.metodoNombre}>
                    <Text style={styles.metodoNombreAlt}>altoke</Text>
                    {'  '}
                    <Text style={styles.metodoBanco}>BancoSol</Text>
                  </Text>
                  <View style={styles.metodoChips}>
                    <Text style={styles.chipVerde}>Envío Bs. 8</Text>
                    <Text style={styles.chipGris}>✓ Confirmación automática</Text>
                  </View>
                </View>
                <View style={[styles.radioOuter, metodoPago === 'qr' && styles.radioOuterActivo]}>
                  {metodoPago === 'qr' && <View style={styles.radioInner} />}
                </View>
              </View>
            </TouchableOpacity>

            {/* Tarjeta Efectivo */}
            <TouchableOpacity
              style={[styles.metodoCard, styles.metodoCardEfectivo, metodoPago === 'efectivo' && styles.metodoCardEfectivoActivo]}
              onPress={() => setMetodoPago('efectivo')}
              activeOpacity={0.8}
            >
              <View style={styles.metodoRow}>
                <View style={styles.metodoTextos}>
                  <Text style={styles.metodoNombreEfectivo}>💵  Efectivo al repartidor</Text>
                  <Text style={styles.chipGris}>Envío Bs. 12</Text>
                </View>
                <View style={[styles.radioOuter, metodoPago === 'efectivo' && styles.radioOuterActivo]}>
                  {metodoPago === 'efectivo' && <View style={styles.radioInner} />}
                </View>
              </View>
              {metodoPago === 'efectivo' && (
                <Text style={styles.avisoEfectivo}>
                  ⚠️ Ten el monto exacto. El repartidor no lleva cambio.
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Dirección de entrega ── */}
        {tieneDelivery && (
          <View style={styles.direccionBox}>
            <Text style={styles.direccionTitle}>📍 Dirección de entrega</Text>
            <Text style={styles.direccionSub}>Calle, número, referencia (edificio, color de puerta, etc.)</Text>
            <TextInput
              style={[styles.direccionInput, mostrarErrorDir && !direccionEntrega.trim() && styles.direccionInputError]}
              placeholder="Ej: Calle Bolívar #234, frente a la plaza, puerta azul..."
              placeholderTextColor="#9CA3AF"
              value={direccionEntrega}
              onChangeText={v => { setDireccionEntrega(v); if (v.trim()) setMostrarErrorDir(false); }}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            {mostrarErrorDir && !direccionEntrega.trim() && (
              <Text style={styles.direccionErrorText}>⚠️ Escribe tu dirección para continuar</Text>
            )}
            <TouchableOpacity
              style={[styles.gpsBtn, capturandoGPS && styles.gpsBtnDisabled]}
              onPress={capturarUbicacion}
              disabled={capturandoGPS}
              activeOpacity={0.75}
            >
              {capturandoGPS
                ? <ActivityIndicator size="small" color="#F97316" />
                : <Text style={styles.gpsBtnText}>📡 Usar mi ubicación actual (opcional)</Text>}
            </TouchableOpacity>
            {destinoCoords && (
              <Text style={styles.gpsConfirmado}>✅ Ubicación GPS capturada — el repartidor verá tu pin en el mapa</Text>
            )}
          </View>
        )}

        {/* ── Resumen ── */}
        {items.length > 0 && (
          <View style={styles.resumenBox}>
            <Text style={styles.resumenTitle}>Resumen del pedido</Text>
            <View style={styles.resumenRow}>
              <Text style={styles.resumenLabel}>Subtotal</Text>
              <Text style={styles.resumenValor}>Bs. {subtotal}</Text>
            </View>
            {costoEnvio > 0 && (
              <View style={styles.resumenRow}>
                <Text style={styles.resumenLabel}>Envío delivery</Text>
                <Text style={styles.resumenValor}>Bs. {costoEnvio}</Text>
              </View>
            )}
            <View style={[styles.resumenRow, styles.resumenTotal]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValor}>Bs. {total}</Text>
            </View>
          </View>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Modal confirmación ── */}
      {mostrarConfirm && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalEmoji}>{metodoPago === 'qr' ? '📱' : '💵'}</Text>
            <Text style={styles.modalTitle}>¿Confirmar pedido?</Text>
            <Text style={styles.modalSub}>
              Total: Bs. {total}{'\n'}
              {metodoPago === 'qr'
                ? 'Pagarás con QR ALTOKE'
                : 'Pagarás en efectivo al repartidor'}
            </Text>
            <TouchableOpacity
              style={[styles.modalBtnSi, guardando && { opacity: 0.7 }]}
              onPress={confirmarPedido}
              disabled={guardando}
            >
              <Text style={styles.modalBtnSiText}>
                {guardando ? '⏳ Guardando...' : '✅ Confirmar'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnNo} onPress={() => setMostrarConfirm(false)}>
              <Text style={styles.modalBtnNoText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Footer ── */}
      {items.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity
          style={styles.pedidoBtn}
          onPress={() => {
            if (tieneDelivery && !direccionEntrega.trim()) {
              setMostrarErrorDir(true);
              return;
            }
            setMostrarConfirm(true);
          }}
        >
            <LinearGradient colors={BrandColors.gradient} style={styles.pedidoGradient}>
              <Text style={styles.pedidoText}>
                {metodoPago === 'qr' ? '📱' : '💵'} Confirmar • Bs. {total}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F8F7FF' },
  header:       { paddingTop: 55, paddingBottom: 20, paddingHorizontal: 20 },
  backBtn:      { marginBottom: 12 },
  backText:     { color: BrandColors.onPrimaryMuted, fontSize: 14 },
  headerTitle:  { fontSize: 26, fontWeight: '800', color: '#FFF' },
  headerSub:    { fontSize: 13, color: BrandColors.onPrimaryMuted, marginTop: 4, marginBottom: 12 },
  tiposRow:     { flexDirection: 'row', gap: 8 },
  tipoBadge:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tipoBadgeText:{ color: '#FFF', fontSize: 12, fontWeight: '700' },
  lista:        { flex: 1, padding: 16 },
  errorBox:     { backgroundColor: '#FEE2E2', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#FECACA' },
  errorText:    { color: '#DC2626', fontSize: 14, fontWeight: '600' },
  grupo:        { marginBottom: 16 },
  grupoHeader:  { borderRadius: 12, padding: 10, marginBottom: 8 },
  grupoTitle:   { color: '#FFF', fontWeight: '700', fontSize: 14 },
  itemCard:     { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 8, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  itemEmoji:    { fontSize: 28, marginRight: 12 },
  itemInfo:     { flex: 1 },
  itemNombre:   { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 2 },
  itemDetalle:  { fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  itemPrecio:   { fontSize: 13, color: '#6B7280' },
  itemControls: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  controlBtn:   { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  controlText:  { fontSize: 18, color: '#374151', fontWeight: '700', lineHeight: 22 },
  cantidad:     { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginHorizontal: 8 },
  deleteBtn:    { padding: 4 },
  emptyBox:     { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji:   { fontSize: 64, marginBottom: 16 },
  emptyTitle:   { fontSize: 18, fontWeight: '700', color: '#374151', marginBottom: 8 },
  emptySubtitle:{ fontSize: 13, color: '#9CA3AF', marginBottom: 12, textAlign: 'center' },
  emptyLink:    { fontSize: 15, color: BrandColors.primary, fontWeight: '600' },
  // ── Métodos de pago
  metodosBox:   { marginBottom: 14 },
  metodosTitle: { fontSize: 15, fontWeight: '800', color: '#1E0A3C', marginBottom: 10 },
  metodoCard:   {
    backgroundColor: '#FFF7ED',
    borderWidth: 2,
    borderColor: '#F97316',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    position: 'relative',
  },
  metodoCardActivo: { borderColor: '#F97316', backgroundColor: '#FFF7ED' },
  metodoCardEfectivo:      { backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E0E0E0' },
  metodoCardEfectivoActivo:{ borderColor: '#9CA3AF' },
  metodoRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metodoTextos: { flex: 1 },
  metodoNombre: { fontSize: 14, marginBottom: 6 },
  metodoNombreAlt: { fontWeight: '800', color: '#F97316' },
  metodoBanco:  { fontSize: 12, color: '#9CA3AF' },
  metodoNombreEfectivo: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 6 },
  metodoChips:  { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chipVerde:    { fontSize: 12, color: '#16A34A', fontWeight: '600' },
  chipGris:     { fontSize: 12, color: '#9CA3AF' },
  badgeRecomendado: {
    position: 'absolute', top: -1, right: -1,
    backgroundColor: '#F97316', borderTopRightRadius: 10, borderBottomLeftRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeRecomendadoText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  radioOuter:  { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  radioOuterActivo: { borderColor: '#F97316' },
  radioInner:  { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F97316' },
  avisoEfectivo: { color: '#DC2626', fontSize: 12, marginTop: 8, fontWeight: '600' },
  // ── Resumen
  resumenBox:   { backgroundColor: '#FFF', borderRadius: 20, padding: 20, marginTop: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  resumenTitle: { fontSize: 16, fontWeight: '800', color: '#1E0A3C', marginBottom: 16 },
  resumenRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  resumenLabel: { fontSize: 14, color: '#6B7280' },
  resumenValor: { fontSize: 14, color: '#374151', fontWeight: '600' },
  resumenTotal: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 10, marginTop: 4 },
  totalLabel:   { fontSize: 16, fontWeight: '800', color: '#1E0A3C' },
  totalValor:   { fontSize: 18, fontWeight: '800', color: BrandColors.primary },
  footer:       { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#F8F7FF' },
  pedidoBtn:    { borderRadius: 16, overflow: 'hidden' },
  pedidoGradient:{ padding: 18, alignItems: 'center' },
  pedidoText:   { color: '#FFF', fontSize: 17, fontWeight: '800' },
  // ── Dirección de entrega
  direccionBox:        { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 14, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  direccionTitle:      { fontSize: 15, fontWeight: '800', color: '#1E0A3C', marginBottom: 4 },
  direccionSub:        { fontSize: 12, color: '#9CA3AF', marginBottom: 10 },
  direccionInput:      { backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#111827', minHeight: 64 },
  direccionInputError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  direccionErrorText:  { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 6 },
  gpsBtn:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: '#F97316', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 6 },
  gpsBtnDisabled:      { opacity: 0.5 },
  gpsBtnText:          { color: '#EA580C', fontWeight: '700', fontSize: 13 },
  gpsConfirmado:       { color: '#059669', fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalBox:     { backgroundColor: '#FFF', borderRadius: 24, padding: 32, width: '80%', alignItems: 'center' },
  modalEmoji:   { fontSize: 48, marginBottom: 12 },
  modalTitle:   { fontSize: 20, fontWeight: '800', color: '#1E0A3C', marginBottom: 8 },
  modalSub:     { fontSize: 15, color: '#6B7280', marginBottom: 24, textAlign: 'center', lineHeight: 22 },
  modalBtnSi:   { backgroundColor: '#F97316', borderRadius: 14, padding: 16, width: '100%', alignItems: 'center', marginBottom: 10 },
  modalBtnSiText:{ color: '#FFF', fontWeight: '800', fontSize: 16 },
  modalBtnNo:   { padding: 12, width: '100%', alignItems: 'center' },
  modalBtnNoText:{ color: '#9CA3AF', fontSize: 15 },
});
