import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { supabase } from '../lib/supabase';
import { sendPushTo } from '../lib/usePush';

type TipoItem = 'delivery' | 'stay' | 'evento';

const TIPO_CONFIG = {
  delivery: { color: '#F97316', label: '🍔 Delivery' },
  stay: { color: '#6B21A8', label: '🏡 Stay' },
  evento: { color: '#7C3AED', label: '🎉 Eventos' },
};

export default function CarritoScreen() {
  const router = useRouter();
  const { items, aumentar, disminuir, eliminar, limpiarCarrito, totalItems } = useCarrito();
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const [totalConfirmado, setTotalConfirmado] = useState(0);
  const [mostrarConfirm, setMostrarConfirm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const subtotal = items.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
  const envio = items.some(i => i.tipo === 'delivery') ? 10 : 0;
  const total = subtotal + envio;
  const comision = Math.round(subtotal * 0.15);
  const tiposEnCarrito = [...new Set(items.map(i => i.tipo))];

  const confirmarPedido = async () => {
    setGuardando(true);
    setErrorMsg('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        setErrorMsg('Debes iniciar sesión para confirmar un pedido.');
        setGuardando(false);
        router.push('/login');
        return;
      }

      const itemsDelivery = items.filter(i => i.tipo === 'delivery');

      if (itemsDelivery.length > 0) {
        const subtotalDelivery = itemsDelivery.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
        const comisionDelivery = Math.round(subtotalDelivery * 0.15);
        const totalDelivery = subtotalDelivery + envio;
        const negocioId = itemsDelivery[0].negocio_id ?? null;

        const payload = {
          cliente_id: user.id,
          negocio_id: negocioId,
          subtotal: subtotalDelivery,
          comision: comisionDelivery,
          total: totalDelivery,
          estado: 'pendiente',
          direccion_entrega: 'Por confirmar',
        };

        console.log('[carrito] inserting pedido payload:', JSON.stringify(payload));

        const { data: pedido, error: errorPedido } = await supabase
          .from('pedidos')
          .insert(payload)
          .select()
          .single();

        if (errorPedido) {
          console.error('[carrito] error inserting pedido:', JSON.stringify({
            code: errorPedido.code,
            message: errorPedido.message,
            details: errorPedido.details,
            hint: errorPedido.hint,
          }));
          throw errorPedido;
        }

        console.log('[carrito] pedido created:', pedido.id);

        const detalles = itemsDelivery.map(item => ({
          pedido_id: pedido.id,
          producto_id: item.id,
          cantidad: item.cantidad,
          precio_unitario: item.precio,
          subtotal: item.precio * item.cantidad,
        }));

        console.log('[carrito] inserting detalle_pedidos:', JSON.stringify(detalles));

        const { error: errorDetalle } = await supabase
          .from('detalle_pedidos')
          .insert(detalles);

        if (errorDetalle) {
          console.error('[carrito] error inserting detalle_pedidos:', JSON.stringify({
            code: errorDetalle.code,
            message: errorDetalle.message,
            details: errorDetalle.details,
            hint: errorDetalle.hint,
            pedido_id: pedido?.id,
            cliente_id: user.id,
          }));
          throw errorDetalle;
        }

        // Notificar al negocio inmediatamente (respaldo: el webhook de Supabase también lo hace)
        if (negocioId) {
          const { data: negocio } = await supabase
            .from('negocios')
            .select('usuario_id, nombre')
            .eq('id', negocioId)
            .single();

          if (negocio?.usuario_id) {
            await sendPushTo(
              negocio.usuario_id,
              '🆕 Nuevo pedido recibido',
              `Bs. ${pedido.total} · ${pedido.direccion_entrega || 'Sin dirección'}`,
              '/anfitrion',
              `pedido-nuevo-${pedido.id}`
            );
          }
        }
      }

      setMostrarConfirm(false);
      setTotalConfirmado(total);
      limpiarCarrito();
      setPedidoEnviado(true);

    } catch (error: any) {
      const errInfo = {
        code: error?.code ?? '',
        message: error?.message ?? '',
        details: error?.details ?? '',
        hint: error?.hint ?? '',
        raw: String(error),
      };
      console.error('[carrito] confirmarPedido caught:', JSON.stringify(errInfo));

      const supaMsg = errInfo.message || errInfo.details || errInfo.code || errInfo.raw;
      const displayMsg = supaMsg
        ? `[${errInfo.code || 'ERR'}] ${supaMsg}`
        : 'Error al confirmar el pedido. Intenta de nuevo.';
      setErrorMsg(displayMsg);

      Alert.alert(
        'Error al confirmar pedido',
        `Código: ${errInfo.code}\nMensaje: ${errInfo.message}\nDetalles: ${errInfo.details}\nHint: ${errInfo.hint}`,
        [{ text: 'OK' }]
      );
    }
    setGuardando(false);
  };

  if (pedidoEnviado) {
    return (
      <View style={styles.successContainer}>
        <LinearGradient colors={['#6B21A8', '#4C1D95']} style={styles.successGradient}>
          <Text style={styles.successEmoji}>🎉</Text>
          <Text style={styles.successTitle}>¡Pedido confirmado!</Text>
          <Text style={styles.successSub}>Gracias por usar CaseritaExpress</Text>
          <View style={styles.successCard}>
            {items.some(i => i.tipo === 'delivery') && <Text style={styles.successItem}>🍔 Delivery: 30-45 min</Text>}
            {items.some(i => i.tipo === 'stay') && <Text style={styles.successItem}>🏡 Stay: confirmación por email</Text>}
            {items.some(i => i.tipo === 'evento') && <Text style={styles.successItem}>🎉 Entradas enviadas por WhatsApp</Text>}
            <Text style={styles.successItem}>💰 Total pagado: Bs. {totalConfirmado}</Text>
          </View>
          <TouchableOpacity style={styles.successBtn} onPress={() => { limpiarCarrito(); setPedidoEnviado(false); router.push('/'); }}>
            <Text style={styles.successBtnText}>Volver al inicio</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1E0A3C', '#4C1D95']} style={styles.header}>
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

        {items.length > 0 && (
          <View style={styles.resumenBox}>
            <Text style={styles.resumenTitle}>Resumen del pedido</Text>
            <View style={styles.resumenRow}>
              <Text style={styles.resumenLabel}>Subtotal</Text>
              <Text style={styles.resumenValor}>Bs. {subtotal}</Text>
            </View>
            {envio > 0 && (
              <View style={styles.resumenRow}>
                <Text style={styles.resumenLabel}>Envío delivery</Text>
                <Text style={styles.resumenValor}>Bs. {envio}</Text>
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

      {mostrarConfirm && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalEmoji}>🛒</Text>
            <Text style={styles.modalTitle}>¿Confirmar pedido?</Text>
            <Text style={styles.modalSub}>Total a pagar: Bs. {total}</Text>
            <TouchableOpacity
              style={[styles.modalBtnSi, guardando && { opacity: 0.7 }]}
              onPress={confirmarPedido}
              disabled={guardando}>
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

      {items.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.pedidoBtn} onPress={() => setMostrarConfirm(true)}>
            <LinearGradient colors={['#6B21A8', '#4C1D95']} style={styles.pedidoGradient}>
              <Text style={styles.pedidoText}>Confirmar todo • Bs. {total}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  header: { paddingTop: 55, paddingBottom: 20, paddingHorizontal: 20 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#DDD6FE', fontSize: 14 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#FFF' },
  headerSub: { fontSize: 13, color: '#C4B5FD', marginTop: 4, marginBottom: 12 },
  tiposRow: { flexDirection: 'row', gap: 8 },
  tipoBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tipoBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  lista: { flex: 1, padding: 16 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#FECACA' },
  errorText: { color: '#DC2626', fontSize: 14, fontWeight: '600' },
  grupo: { marginBottom: 16 },
  grupoHeader: { borderRadius: 12, padding: 10, marginBottom: 8 },
  grupoTitle: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  itemCard: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 8, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  itemEmoji: { fontSize: 28, marginRight: 12 },
  itemInfo: { flex: 1 },
  itemNombre: { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 2 },
  itemDetalle: { fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  itemPrecio: { fontSize: 13, color: '#6B7280' },
  itemControls: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  controlBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  controlText: { fontSize: 18, color: '#374151', fontWeight: '700', lineHeight: 22 },
  cantidad: { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginHorizontal: 8 },
  deleteBtn: { padding: 4 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151', marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: '#9CA3AF', marginBottom: 12, textAlign: 'center' },
  emptyLink: { fontSize: 15, color: '#6B21A8', fontWeight: '600' },
  resumenBox: { backgroundColor: '#FFF', borderRadius: 20, padding: 20, marginTop: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  resumenTitle: { fontSize: 16, fontWeight: '800', color: '#1E0A3C', marginBottom: 16 },
  resumenRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  resumenLabel: { fontSize: 14, color: '#6B7280' },
  resumenValor: { fontSize: 14, color: '#374151', fontWeight: '600' },
  resumenTotal: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 10, marginTop: 4 },
  totalLabel: { fontSize: 16, fontWeight: '800', color: '#1E0A3C' },
  totalValor: { fontSize: 18, fontWeight: '800', color: '#6B21A8' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#F8F7FF' },
  pedidoBtn: { borderRadius: 16, overflow: 'hidden' },
  pedidoGradient: { padding: 18, alignItems: 'center' },
  pedidoText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalBox: { backgroundColor: '#FFF', borderRadius: 24, padding: 32, width: '80%', alignItems: 'center' },
  modalEmoji: { fontSize: 48, marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E0A3C', marginBottom: 8 },
  modalSub: { fontSize: 15, color: '#6B7280', marginBottom: 24 },
  modalBtnSi: { backgroundColor: '#6B21A8', borderRadius: 14, padding: 16, width: '100%', alignItems: 'center', marginBottom: 10 },
  modalBtnSiText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  modalBtnNo: { padding: 12, width: '100%', alignItems: 'center' },
  modalBtnNoText: { color: '#9CA3AF', fontSize: 15 },
  successContainer: { flex: 1 },
  successGradient: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successEmoji: { fontSize: 80, marginBottom: 20 },
  successTitle: { fontSize: 28, fontWeight: '800', color: '#FFF', marginBottom: 8 },
  successSub: { fontSize: 15, color: '#C4B5FD', marginBottom: 32 },
  successCard: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 24, width: '100%', marginBottom: 32 },
  successItem: { fontSize: 15, color: '#FFF', marginBottom: 12, fontWeight: '600' },
  successBtn: { backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 40, paddingVertical: 16 },
  successBtnText: { color: '#6B21A8', fontSize: 17, fontWeight: '800' },
});