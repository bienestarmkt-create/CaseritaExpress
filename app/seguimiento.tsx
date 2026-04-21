import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

// ─── ESTADO → ÍNDICE ─────────────────────────────────────
function estadoAIndice(estado: string): number {
  const map: Record<string, number> = {
    pendiente: 1,
    confirmado: 2,
    en_camino: 3,
    entregado: 5,
    cancelado: 1,
  };
  return map[estado] ?? 1;
}

const REPARTIDOR_DEFAULT = {
  nombre: 'Repartidor CaseritaExpress',
  emoji: '🏍️',
  rating: 4.9,
  entregas: 342,
  telefono: '+591 71234567',
  vehiculo: 'Honda CB 125',
  placa: '2341-BJK',
  verificado: true,
};

const ESTADOS_PEDIDO = [
  { id: 1, label: 'Pedido confirmado',     emoji: '✅', descripcion: 'Tu pedido fue recibido',           completado: true,  hora: '14:32' },
  { id: 2, label: 'Preparando tu pedido',  emoji: '👨‍🍳', descripcion: 'El restaurante está cocinando',   completado: true,  hora: '14:35' },
  { id: 3, label: 'Repartidor en camino',  emoji: '🏍️', descripcion: 'Carlos recogió tu pedido',        completado: true,  hora: '14:48' },
  { id: 4, label: 'Llegando a tu puerta',  emoji: '📍', descripcion: 'A pocos minutos de tu ubicación', completado: false, hora: '--:--' },
  { id: 5, label: 'Pedido entregado',      emoji: '🎉', descripcion: '¡Disfruta tu pedido!',            completado: false, hora: '--:--' },
];

const MENSAJES_INICIALES = [
  { id: 1, tipo: 'sistema',     texto: 'Chat iniciado con Carlos Mamani',               hora: '14:48' },
  { id: 2, tipo: 'repartidor',  texto: '¡Hola! Ya recogí tu pedido, voy en camino 🛵',  hora: '14:48' },
  { id: 3, tipo: 'usuario',     texto: 'Perfecto, te espero en la puerta',              hora: '14:49' },
  { id: 4, tipo: 'repartidor',  texto: 'Estoy a unos 5 minutos aproximadamente 👍',     hora: '14:52' },
];

const RESPUESTAS_RAPIDAS = [
  '¿Cuánto falta? ⏱️',
  'Te espero abajo 👋',
  'Toca el timbre 🔔',
  'Gracias! 😊',
  'Sin problema 👍',
];

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────
export default function SeguimientoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pedidoId?: string }>();
  const [tabActiva, setTabActiva] = useState<'seguimiento' | 'repartidor' | 'chat' | 'pedido'>('seguimiento');
  const [tiempoRestante, setTiempoRestante] = useState(8);
  const [estadoActual, setEstadoActual] = useState(3);
  const [mensajes, setMensajes] = useState(MENSAJES_INICIALES);
  const [pedidoEntregado, setPedidoEntregado] = useState(false);
  const [modalCalificar, setModalCalificar] = useState(false);
  const [estrellas, setEstrellas] = useState(0);
  const [calificado, setCalificado] = useState(false);
  const [notifChat, setNotifChat] = useState(0);
  const [pedidoReal, setPedidoReal] = useState<any>(null);
  const [repartidorReal, setRepartidorReal] = useState<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Cargar pedido real desde Supabase
  useEffect(() => {
    let sub: any;
    async function cargar() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let pedidoId = params.pedidoId;
      if (!pedidoId) {
        const { data } = await supabase
          .from('pedidos')
          .select('*')
          .eq('cliente_id', user.id)
          .not('estado', 'eq', 'cancelado')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        pedidoId = data?.id;
        if (data) actualizarDesdeDB(data);
      } else {
        const { data } = await supabase.from('pedidos').select('*').eq('id', pedidoId).single();
        if (data) actualizarDesdeDB(data);
      }

      if (pedidoId) {
        sub = supabase
          .channel(`pedido-${pedidoId}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'pedidos',
            filter: `id=eq.${pedidoId}`,
          }, (payload) => actualizarDesdeDB(payload.new))
          .subscribe();
      }
    }

    function actualizarDesdeDB(data: any) {
      setPedidoReal(data);
      const idx = estadoAIndice(data.estado);
      setEstadoActual(idx);
      if (data.estado === 'entregado') {
        setPedidoEntregado(true);
        setTiempoRestante(0);
      }
      if (data.repartidor_nombre) {
        setRepartidorReal({ ...REPARTIDOR_DEFAULT, nombre: data.repartidor_nombre });
      }
    }

    cargar();
    return () => { if (sub) supabase.removeChannel(sub); };
  }, [params.pedidoId]);

  const REPARTIDOR = repartidorReal ?? REPARTIDOR_DEFAULT;

  const PEDIDO = pedidoReal ? {
    numero: `#CE-${pedidoReal.id.slice(-8).toUpperCase()}`,
    fecha: new Date(pedidoReal.created_at).toLocaleString('es-BO'),
    restaurante: pedidoReal.negocios?.nombre ?? 'Restaurante',
    restauranteEmoji: '🍔',
    items: Array.isArray(pedidoReal.items) ? pedidoReal.items : [],
    subtotal: pedidoReal.subtotal ?? pedidoReal.total ?? 0,
    envio: 10,
    total: pedidoReal.total ?? 0,
    direccion: pedidoReal.direccion_entrega ?? 'Dirección de entrega',
    referencia: '',
  } : {
    numero: '#CE-2024-0847',
    fecha: '12 Mar 2026 • 14:32',
    restaurante: 'El Rancho Chapaco',
    restauranteEmoji: '🥩',
    items: [
      { nombre: 'Silpancho completo', cantidad: 1, precio: 35 },
      { nombre: 'Salteñas (x3)', cantidad: 1, precio: 15 },
      { nombre: 'Refresco', cantidad: 1, precio: 10 },
    ],
    subtotal: 50,
    envio: 10,
    total: 60,
    direccion: 'Av. Las Américas #342, Tarija',
    referencia: 'Casa de rejas negras, frente a la farmacia',
  };

  // Animación pulso repartidor en mapa
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const enviarMensaje = (texto: string) => {
    const hora = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
    setMensajes(prev => [...prev, { id: Date.now(), tipo: 'usuario', texto, hora }]);
    setTimeout(() => {
      setMensajes(prev => [...prev, {
        id: Date.now() + 1,
        tipo: 'repartidor',
        texto: '👍 ¡Entendido! Ya casi llego.',
        hora: new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }),
      }]);
      if (tabActiva !== 'chat') setNotifChat(n => n + 1);
    }, 1500);
  };

  const confirmarCalificacion = () => {
    setModalCalificar(false);
    setCalificado(true);
  };

  const TABS = [
    { id: 'seguimiento', emoji: '🗺️',  label: 'Mapa'       },
    { id: 'repartidor',  emoji: '🏍️',  label: 'Repartidor' },
    { id: 'chat',        emoji: '💬',   label: 'Chat',  notif: notifChat },
    { id: 'pedido',      emoji: '📦',   label: 'Pedido'     },
  ];

  return (
    <View style={s.container}>

      {/* ══ HEADER ══════════════════════════════════════ */}
      <LinearGradient colors={pedidoEntregado ? ['#059669','#10B981'] : ['#EA580C','#F97316']} style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Volver</Text>
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Text style={s.headerTitle}>
            {pedidoEntregado ? '🎉 ¡Pedido entregado!' : '🏍️ Pedido en camino'}
          </Text>
          <Text style={s.headerNumero}>{PEDIDO.numero} • {PEDIDO.fecha}</Text>
          {!pedidoEntregado && (
            <View style={s.tiempoBox}>
              <Text style={s.tiempoNum}>{tiempoRestante}</Text>
              <Text style={s.tiempoLabel}>min aprox.</Text>
            </View>
          )}
          {pedidoEntregado && (
            <View style={s.entregadoTag}>
              <Text style={s.entregadoText}>✅ Entregado exitosamente</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* ══ TABS ════════════════════════════════════════ */}
      <View style={s.tabsBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[s.tabBtn, tabActiva === tab.id && s.tabBtnActivo]}
            onPress={() => { setTabActiva(tab.id as any); if (tab.id === 'chat') setNotifChat(0); }}>
            <View style={s.tabInner}>
              <Text style={s.tabEmoji}>{tab.emoji}</Text>
              {tab.notif ? (
                <View style={s.tabNotifBadge}>
                  <Text style={s.tabNotifText}>{tab.notif}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[s.tabLabel, tabActiva === tab.id && s.tabLabelActivo]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ══ CONTENIDO ═══════════════════════════════════ */}
      <ScrollView style={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── TAB: MAPA / SEGUIMIENTO ─────────────────── */}
        {tabActiva === 'seguimiento' && (
          <View>
            {/* Mapa simulado */}
            <View style={s.mapaBox}>
              <LinearGradient colors={['#BBF7D0','#A7F3D0']} style={s.mapaFondo}>
                {/* Calles */}
                {[20,42,65,85].map(p => (
                  <View key={`h${p}`} style={[s.calleH, { top: `${p}%` as any }]} />
                ))}
                {[20,42,65,85].map(p => (
                  <View key={`v${p}`} style={[s.calleV, { left: `${p}%` as any }]} />
                ))}
                {/* Restaurante */}
                <View style={[s.pin, { top: '15%', left: '15%' }]}>
                  <View style={[s.pinIcon, { backgroundColor: '#F97316' }]}>
                    <Text style={s.pinEmoji}>🍔</Text>
                  </View>
                  <Text style={s.pinLabel}>Restaurante</Text>
                </View>
                {/* Repartidor */}
                <Animated.View style={[s.pin, { top: '42%', left: '45%' }, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={[s.pinIcon, s.pinRepartidor]}>
                    <Text style={s.pinEmoji}>🏍️</Text>
                  </View>
                  <Text style={s.pinLabel}>Carlos</Text>
                </Animated.View>
                {/* Destino */}
                <View style={[s.pin, { top: '65%', left: '68%' }]}>
                  <View style={[s.pinIcon, { backgroundColor: '#EF4444' }]}>
                    <Text style={s.pinEmoji}>📍</Text>
                  </View>
                  <Text style={s.pinLabel}>Tu casa</Text>
                </View>
                {/* Etiqueta ciudad */}
                <View style={s.ciudadTag}>
                  <Text style={s.ciudadTagText}>📍 Tarija, Bolivia — Simulación</Text>
                </View>
              </LinearGradient>
            </View>

            {/* Línea de estados */}
            <View style={s.estadosCard}>
              <Text style={s.estadosTitle}>📋 Estado del pedido</Text>
              {ESTADOS_PEDIDO.map((est, i) => {
                const completado = est.completado || i + 1 < estadoActual;
                const activo = i + 1 === estadoActual;
                return (
                  <View key={est.id} style={s.estadoFila}>
                    <View style={s.estadoIzq}>
                      <View style={[s.estadoCirculo, completado && s.circuloOk, activo && s.circuloActivo]}>
                        <Text style={s.circuloEmoji}>{completado ? '✓' : activo ? est.emoji : '○'}</Text>
                      </View>
                      {i < ESTADOS_PEDIDO.length - 1 && (
                        <View style={[s.estadoLinea, completado && s.lineaOk]} />
                      )}
                    </View>
                    <View style={s.estadoDer}>
                      <Text style={[s.estadoLabel, completado && s.labelOk, activo && s.labelActivo]}>
                        {est.label}
                      </Text>
                      <Text style={s.estadoDesc}>{activo ? est.descripcion : est.hora}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Dirección */}
            <View style={s.dirCard}>
              <View style={s.dirRow}>
                <Text style={s.dirEmoji}>📍</Text>
                <View style={s.dirInfo}>
                  <Text style={s.dirLabel}>Entregando en</Text>
                  <Text style={s.dirTexto}>{PEDIDO.direccion}</Text>
                  <Text style={s.dirRef}>{PEDIDO.referencia}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── TAB: REPARTIDOR ─────────────────────────── */}
        {tabActiva === 'repartidor' && (
          <View style={s.repartidorPad}>
            {/* Card principal */}
            <View style={s.repartidorCard}>
              <View style={s.repartidorAvatarBox}>
                <Text style={s.repartidorAvatarEmoji}>{REPARTIDOR.emoji}</Text>
                {REPARTIDOR.verificado && (
                  <View style={s.verificadoBadge}>
                    <Text style={s.verificadoText}>✓</Text>
                  </View>
                )}
              </View>
              <Text style={s.repartidorNombre}>{REPARTIDOR.nombre}</Text>
              <View style={s.repartidorStatsRow}>
                <View style={s.repartidorStat}>
                  <Text style={s.repartidorStatNum}>⭐ {REPARTIDOR.rating}</Text>
                  <Text style={s.repartidorStatLabel}>Calificación</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.repartidorStat}>
                  <Text style={s.repartidorStatNum}>{REPARTIDOR.entregas}</Text>
                  <Text style={s.repartidorStatLabel}>Entregas</Text>
                </View>
              </View>
              <View style={s.vehiculoTag}>
                <Text style={s.vehiculoText}>🏍️ {REPARTIDOR.vehiculo} • {REPARTIDOR.placa}</Text>
              </View>
            </View>

            {/* Botones contacto */}
            <View style={s.contactoRow}>
              <TouchableOpacity style={s.contactoBtn}>
                <LinearGradient colors={['#059669','#10B981']} style={s.contactoGrad}>
                  <Text style={s.contactoBtnEmoji}>📞</Text>
                  <Text style={s.contactoBtnLabel}>Llamar</Text>
                  <Text style={s.contactoBtnSub}>{REPARTIDOR.telefono}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={s.contactoBtn} onPress={() => setTabActiva('chat')}>
                <LinearGradient colors={['#7C3AED','#5B21B6']} style={s.contactoGrad}>
                  <Text style={s.contactoBtnEmoji}>💬</Text>
                  <Text style={s.contactoBtnLabel}>Chat</Text>
                  <Text style={s.contactoBtnSub}>Enviar mensaje</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* Aviso seguridad */}
            <View style={s.seguridadCard}>
              <Text style={s.seguridadTitle}>🔒 Tu seguridad importa</Text>
              {[
                'Verifica el nombre y foto del repartidor antes de entregar.',
                'No compartas contraseñas ni datos bancarios.',
                'El pago ya fue procesado de forma segura por CaseritaExpress.',
                'Ante cualquier problema, contacta soporte en la app.',
              ].map((t, i) => (
                <Text key={i} style={s.seguridadItem}>• {t}</Text>
              ))}
            </View>
          </View>
        )}

        {/* ── TAB: CHAT ───────────────────────────────── */}
        {tabActiva === 'chat' && (
          <View>
            {/* Header chat */}
            <View style={s.chatHeader}>
              <Text style={s.chatAvatarEmoji}>{REPARTIDOR.emoji}</Text>
              <View>
                <Text style={s.chatNombre}>{REPARTIDOR.nombre}</Text>
                <Text style={s.chatEstado}>🟢 En camino a tu ubicación</Text>
              </View>
            </View>

            {/* Mensajes */}
            <View style={s.mensajesBox}>
              {mensajes.map(msg => {
                if (msg.tipo === 'sistema') return (
                  <View key={msg.id} style={s.msgSistemaRow}>
                    <Text style={s.msgSistemaText}>{msg.texto}</Text>
                  </View>
                );
                const esUsuario = msg.tipo === 'usuario';
                return (
                  <View key={msg.id} style={[s.msgRow, esUsuario && s.msgRowUsuario]}>
                    {!esUsuario && <Text style={s.msgAvatar}>{REPARTIDOR.emoji}</Text>}
                    <View style={[s.msgBurbuja, esUsuario ? s.msgBurbujaUsuario : s.msgBurbujaRepartidor]}>
                      <Text style={[s.msgTexto, esUsuario && s.msgTextoUsuario]}>{msg.texto}</Text>
                      <Text style={[s.msgHora, esUsuario && s.msgHoraUsuario]}>{msg.hora}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Respuestas rápidas */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.rapidas} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {RESPUESTAS_RAPIDAS.map(r => (
                <TouchableOpacity key={r} onPress={() => enviarMensaje(r)} style={s.rapidaBtn}>
                  <Text style={s.rapidaText}>{r}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Input */}
            <View style={s.inputRow}>
              <TouchableOpacity style={s.inputBox} onPress={() => enviarMensaje('¿Cuánto tiempo falta? ⏱️')}>
                <Text style={s.inputPlaceholder}>💬 Toca para enviar un mensaje...</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => enviarMensaje('👍')} style={s.sendBtn}>
                <LinearGradient colors={['#F97316','#EA580C']} style={s.sendGrad}>
                  <Text style={s.sendText}>→</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── TAB: PEDIDO ─────────────────────────────── */}
        {tabActiva === 'pedido' && (
          <View style={s.pedidoPad}>
            <View style={s.pedidoCard}>
              <View style={s.pedidoHeaderRow}>
                <Text style={s.pedidoRestEmoji}>{PEDIDO.restauranteEmoji}</Text>
                <View>
                  <Text style={s.pedidoRestNombre}>{PEDIDO.restaurante}</Text>
                  <Text style={s.pedidoNumero}>{PEDIDO.numero}</Text>
                </View>
              </View>
              <View style={s.divider} />
              {PEDIDO.items.map((item, i) => (
                <View key={i} style={s.itemFila}>
                  <Text style={s.itemCant}>{item.cantidad}x</Text>
                  <Text style={s.itemNombre}>{item.nombre}</Text>
                  <Text style={s.itemPrecio}>Bs.{item.precio}</Text>
                </View>
              ))}
              <View style={s.divider} />
              <View style={s.totalFila}>
                <Text style={s.totalLabel}>Subtotal</Text>
                <Text style={s.totalValor}>Bs.{PEDIDO.subtotal}</Text>
              </View>
              <View style={s.totalFila}>
                <Text style={s.totalLabel}>Envío</Text>
                <Text style={s.totalValor}>Bs.{PEDIDO.envio}</Text>
              </View>
              <View style={[s.totalFila, s.totalFinal]}>
                <Text style={s.totalFinalLabel}>Total pagado</Text>
                <Text style={s.totalFinalValor}>Bs.{PEDIDO.total}</Text>
              </View>
            </View>

            {/* Calificar */}
            {!calificado && pedidoEntregado && (
              <TouchableOpacity style={s.calificarBtn} onPress={() => setModalCalificar(true)}>
                <LinearGradient colors={['#F97316','#EA580C']} style={s.calificarGrad}>
                  <Text style={s.calificarText}>⭐ Calificar pedido y repartidor</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            {calificado && (
              <View style={s.calificadoCard}>
                <Text style={s.calificadoEmoji}>🌟</Text>
                <Text style={s.calificadoTitulo}>¡Gracias por calificar!</Text>
                <Text style={s.calificadoSub}>Tu opinión ayuda a mejorar CaseritaExpress</Text>
              </View>
            )}

            <TouchableOpacity style={s.verHistorialBtn} onPress={() => router.push('/perfil')}>
              <Text style={s.verHistorialText}>Ver historial completo de pedidos →</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ══ MODAL: CALIFICAR ════════════════════════════ */}
      {modalCalificar && (
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalEmoji}>🎉</Text>
            <Text style={s.modalTitulo}>¡Pedido entregado!</Text>
            <Text style={s.modalSub}>¿Cómo estuvo tu experiencia con {REPARTIDOR.nombre}?</Text>
            <View style={s.estrellasRow}>
              {[1,2,3,4,5].map(n => (
                <TouchableOpacity key={n} onPress={() => setEstrellas(n)}>
                  <Text style={[s.estrella, n <= estrellas && s.estrellaOn]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            {estrellas > 0 && (
              <Text style={s.estrellaFeedback}>
                {estrellas === 5 ? '¡Excelente servicio! 🚀' : estrellas >= 4 ? 'Muy bueno 👍' : estrellas >= 3 ? 'Regular 😐' : 'Puede mejorar 😕'}
              </Text>
            )}
            <TouchableOpacity
              style={[s.modalBtnOk, estrellas === 0 && s.modalBtnDisabled]}
              onPress={confirmarCalificacion}
              disabled={estrellas === 0}>
              <Text style={s.modalBtnOkText}>✅ Enviar calificación</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalCalificar(false)} style={s.modalBtnSkip}>
              <Text style={s.modalBtnSkipText}>Ahora no</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── ESTILOS ──────────────────────────────────────────────
const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#F8F7FF' },
  header:               { paddingTop: 55, paddingBottom: 24, paddingHorizontal: 20 },
  backBtn:              { marginBottom: 12 },
  backText:             { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  headerContent:        { alignItems: 'center' },
  headerTitle:          { fontSize: 22, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerNumero:         { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 12 },
  tiempoBox:            { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 32, paddingVertical: 12, alignItems: 'center' },
  tiempoNum:            { fontSize: 40, fontWeight: '800', color: '#FFF', lineHeight: 44 },
  tiempoLabel:          { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  entregadoTag:         { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  entregadoText:        { color: '#FFF', fontWeight: '700', fontSize: 14 },
  tabsBar:              { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', elevation: 2 },
  tabBtn:               { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActivo:         { borderBottomColor: '#F97316' },
  tabInner:             { position: 'relative', marginBottom: 2 },
  tabEmoji:             { fontSize: 20 },
  tabNotifBadge:        { position: 'absolute', top: -4, right: -8, backgroundColor: '#EF4444', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  tabNotifText:         { color: '#FFF', fontSize: 9, fontWeight: '800' },
  tabLabel:             { fontSize: 10, color: '#9CA3AF', fontWeight: '500' },
  tabLabelActivo:       { color: '#F97316', fontWeight: '700' },
  body:                 { flex: 1 },
  mapaBox:              { margin: 16, borderRadius: 20, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10 },
  mapaFondo:            { height: 230, position: 'relative' },
  calleH:               { position: 'absolute', left: 0, right: 0, height: 10, backgroundColor: 'rgba(255,255,255,0.55)' },
  calleV:               { position: 'absolute', top: 0, bottom: 0, width: 10, backgroundColor: 'rgba(255,255,255,0.55)' },
  pin:                  { position: 'absolute', alignItems: 'center' },
  pinIcon:              { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF', elevation: 4 },
  pinRepartidor:        { backgroundColor: '#7C3AED', width: 48, height: 48, borderRadius: 24, borderWidth: 3 },
  pinEmoji:             { fontSize: 20 },
  pinLabel:             { fontSize: 10, fontWeight: '700', color: '#1E0A3C', backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 3, overflow: 'hidden' },
  ciudadTag:            { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  ciudadTagText:        { fontSize: 11, color: '#374151', fontWeight: '600' },
  estadosCard:          { marginHorizontal: 16, marginTop: 0, backgroundColor: '#FFF', borderRadius: 20, padding: 20, elevation: 2 },
  estadosTitle:         { fontSize: 15, fontWeight: '700', color: '#1E0A3C', marginBottom: 16 },
  estadoFila:           { flexDirection: 'row' },
  estadoIzq:            { alignItems: 'center', marginRight: 14, width: 32 },
  estadoCirculo:        { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E5E7EB' },
  circuloOk:            { backgroundColor: '#10B981', borderColor: '#10B981' },
  circuloActivo:        { backgroundColor: '#F97316', borderColor: '#F97316' },
  circuloEmoji:         { fontSize: 13, color: '#FFF', fontWeight: '700' },
  estadoLinea:          { width: 2, flex: 1, minHeight: 20, backgroundColor: '#E5E7EB', marginVertical: 2 },
  lineaOk:              { backgroundColor: '#10B981' },
  estadoDer:            { flex: 1, paddingBottom: 18 },
  estadoLabel:          { fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  labelOk:              { color: '#10B981', fontWeight: '600' },
  labelActivo:          { color: '#F97316', fontWeight: '700' },
  estadoDesc:           { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  dirCard:              { marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF', borderRadius: 16, padding: 16, elevation: 2 },
  dirRow:               { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dirEmoji:             { fontSize: 24, marginTop: 2 },
  dirInfo:              { flex: 1 },
  dirLabel:             { fontSize: 12, color: '#9CA3AF', fontWeight: '600', marginBottom: 2 },
  dirTexto:             { fontSize: 15, color: '#1E0A3C', fontWeight: '700', marginBottom: 2 },
  dirRef:               { fontSize: 12, color: '#6B7280' },
  repartidorPad:        { padding: 16 },
  repartidorCard:       { backgroundColor: '#FFF', borderRadius: 20, padding: 24, alignItems: 'center', elevation: 3, marginBottom: 16 },
  repartidorAvatarBox:  { position: 'relative', marginBottom: 12 },
  repartidorAvatarEmoji:{ fontSize: 52, width: 80, height: 80, textAlign: 'center', lineHeight: 80, backgroundColor: '#FFF7ED', borderRadius: 40, borderWidth: 3, borderColor: '#F97316', overflow: 'hidden' },
  verificadoBadge:      { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#10B981', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  verificadoText:       { color: '#FFF', fontSize: 12, fontWeight: '800' },
  repartidorNombre:     { fontSize: 20, fontWeight: '800', color: '#1E0A3C', marginBottom: 12 },
  repartidorStatsRow:   { flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14, marginBottom: 12, width: '100%', justifyContent: 'center' },
  repartidorStat:       { flex: 1, alignItems: 'center' },
  repartidorStatNum:    { fontSize: 18, fontWeight: '800', color: '#1E0A3C', marginBottom: 2 },
  repartidorStatLabel:  { fontSize: 11, color: '#9CA3AF' },
  statDiv:              { width: 1, backgroundColor: '#E5E7EB' },
  vehiculoTag:          { backgroundColor: '#F3F4F6', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  vehiculoText:         { fontSize: 13, color: '#374151', fontWeight: '500' },
  contactoRow:          { flexDirection: 'row', gap: 12, marginBottom: 16 },
  contactoBtn:          { flex: 1, borderRadius: 16, overflow: 'hidden' },
  contactoGrad:         { padding: 16, alignItems: 'center' },
  contactoBtnEmoji:     { fontSize: 26, marginBottom: 4 },
  contactoBtnLabel:     { color: '#FFF', fontWeight: '800', fontSize: 15 },
  contactoBtnSub:       { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
  seguridadCard:        { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderLeftWidth: 4, borderLeftColor: '#F97316' },
  seguridadTitle:       { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 10 },
  seguridadItem:        { fontSize: 12, color: '#6B7280', marginBottom: 6, lineHeight: 18 },
  chatHeader:           { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  chatAvatarEmoji:      { fontSize: 36 },
  chatNombre:           { fontSize: 15, fontWeight: '700', color: '#1E0A3C' },
  chatEstado:           { fontSize: 12, color: '#10B981', marginTop: 2 },
  mensajesBox:          { padding: 16, gap: 10 },
  msgSistemaRow:        { alignItems: 'center', marginVertical: 4 },
  msgSistemaText:       { fontSize: 11, color: '#9CA3AF', backgroundColor: '#F3F4F6', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  msgRow:               { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUsuario:        { flexDirection: 'row-reverse' },
  msgAvatar:            { fontSize: 26 },
  msgBurbuja:           { maxWidth: '75%', padding: 12, borderRadius: 18 },
  msgBurbujaRepartidor: { backgroundColor: '#FFF', borderBottomLeftRadius: 4, elevation: 1 },
  msgBurbujaUsuario:    { backgroundColor: '#F97316', borderBottomRightRadius: 4 },
  msgTexto:             { fontSize: 14, color: '#1E0A3C', lineHeight: 20 },
  msgTextoUsuario:      { color: '#FFF' },
  msgHora:              { fontSize: 10, color: '#9CA3AF', marginTop: 4 },
  msgHoraUsuario:       { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  rapidas:              { maxHeight: 44, marginBottom: 8 },
  rapidaBtn:            { backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#F97316', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  rapidaText:           { fontSize: 12, color: '#F97316', fontWeight: '600' },
  inputRow:             { flexDirection: 'row', padding: 16, gap: 10, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  inputBox:             { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  inputPlaceholder:     { color: '#9CA3AF', fontSize: 14 },
  sendBtn:              { borderRadius: 24, overflow: 'hidden' },
  sendGrad:             { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  sendText:             { color: '#FFF', fontSize: 22, fontWeight: '800' },
  pedidoPad:            { padding: 16 },
  pedidoCard:           { backgroundColor: '#FFF', borderRadius: 20, padding: 20, elevation: 3, marginBottom: 16 },
  pedidoHeaderRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  pedidoRestEmoji:      { fontSize: 36 },
  pedidoRestNombre:     { fontSize: 17, fontWeight: '800', color: '#1E0A3C' },
  pedidoNumero:         { fontSize: 12, color: '#9CA3AF' },
  divider:              { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  itemFila:             { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  itemCant:             { fontSize: 13, color: '#F97316', fontWeight: '700', width: 28 },
  itemNombre:           { flex: 1, fontSize: 14, color: '#374151' },
  itemPrecio:           { fontSize: 14, color: '#1E0A3C', fontWeight: '600' },
  totalFila:            { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel:           { fontSize: 14, color: '#6B7280' },
  totalValor:           { fontSize: 14, color: '#374151', fontWeight: '600' },
  totalFinal:           { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  totalFinalLabel:      { fontSize: 16, fontWeight: '800', color: '#1E0A3C' },
  totalFinalValor:      { fontSize: 18, fontWeight: '800', color: '#F97316' },
  calificarBtn:         { borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  calificarGrad:        { padding: 18, alignItems: 'center' },
  calificarText:        { color: '#FFF', fontWeight: '800', fontSize: 16 },
  calificadoCard:       { backgroundColor: '#FFF', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 12 },
  calificadoEmoji:      { fontSize: 44, marginBottom: 8 },
  calificadoTitulo:     { fontSize: 17, fontWeight: '800', color: '#10B981', marginBottom: 4 },
  calificadoSub:        { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  verHistorialBtn:      { backgroundColor: '#FFF', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  verHistorialText:     { color: '#7C3AED', fontWeight: '700', fontSize: 14 },
  modalOverlay:         { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  modalBox:             { backgroundColor: '#FFF', borderRadius: 28, padding: 28, width: '88%', alignItems: 'center' },
  modalEmoji:           { fontSize: 56, marginBottom: 8 },
  modalTitulo:          { fontSize: 24, fontWeight: '800', color: '#1E0A3C', marginBottom: 8 },
  modalSub:             { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 20 },
  estrellasRow:         { flexDirection: 'row', gap: 6, marginBottom: 10 },
  estrella:             { fontSize: 44, color: '#E5E7EB' },
  estrellaOn:           { color: '#F59E0B' },
  estrellaFeedback:     { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 20 },
  modalBtnOk:           { backgroundColor: '#F97316', borderRadius: 16, padding: 16, width: '100%', alignItems: 'center', marginBottom: 10 },
  modalBtnDisabled:     { backgroundColor: '#FED7AA' },
  modalBtnOkText:       { color: '#FFF', fontWeight: '800', fontSize: 16 },
  modalBtnSkip:         { padding: 10 },
  modalBtnSkipText:     { color: '#9CA3AF', fontSize: 14 },
});