import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapaLeaflet from '../components/MapaLeaflet';
import StarRating from '../components/StarRating';
import { supabase } from '../lib/supabase';

// ─── ESTADO REAL DE pedidos.estado ───────────────────────
// Orden real usado en app/negocio/pedidos.tsx, app/repartidor/pedidos.tsx y
// app/admin/pedidos.tsx (constraint pedidos_estado_check). No todos los
// pasos se alcanzan siempre — el ranking es solo para saber qué ya quedó
// atrás, no una promesa de que cada paso individual ocurrió.
const ORDEN_ESTADOS = [
  'pendiente', 'confirmado', 'asignado', 'preparando', 'en_camino', 'entregado',
] as const;

function rangoEstado(estado: string | undefined): number {
  const i = ORDEN_ESTADOS.indexOf(estado as typeof ORDEN_ESTADOS[number]);
  return i === -1 ? 0 : i;
}

const PASOS_PEDIDO = [
  { estado: 'confirmado', label: 'Pedido confirmado',    emoji: '✅',   descripcion: 'Tu pago fue validado' },
  { estado: 'asignado',   label: 'Repartidor asignado',  emoji: '🏍️',  descripcion: 'Un repartidor tomó tu pedido' },
  { estado: 'preparando', label: 'Preparando tu pedido', emoji: '👨‍🍳', descripcion: 'El negocio está preparando tu pedido' },
  { estado: 'en_camino',  label: 'Repartidor en camino', emoji: '🏍️',  descripcion: 'Tu pedido va en camino' },
  { estado: 'entregado',  label: 'Pedido entregado',     emoji: '🎉',   descripcion: '¡Disfruta tu pedido!' },
] as const;

// Título del header — refleja el estado real de pedidos.estado en vez de
// un ternario fijo entre solo dos textos.
const HEADER_TITULO: Record<string, string> = {
  pendiente:  '⏳ Esperando confirmación de pago',
  confirmado: '✅ Pedido confirmado',
  asignado:   '🏍️ Repartidor asignado',
  preparando: '👨‍🍳 Preparando tu pedido',
  en_camino:  '🏍️ Pedido en camino',
  entregado:  '🎉 ¡Pedido entregado!',
  cancelado:  '❌ Pedido cancelado',
};

// BACKLOG post-piloto: reemplazar por datos reales del repartidor asignado
// (nombre/foto/vehículo ya existen en `usuarios`; rating real vía
// v_promedios_repartidores, igual que en app/repartidor/pedidos.tsx).
// telefono queda null a propósito: nunca se debe mostrar un número fake,
// solo el real que llega desde `usuarios.telefono`.
const REPARTIDOR_DEFAULT = {
  nombre: 'Repartidor CaseritaExpress',
  emoji: '🏍️',
  rating: 4.9,
  entregas: 342,
  telefono: null as string | null,
  vehiculo: 'Honda CB 125',
  placa: '2341-BJK',
  verificado: true,
};

function telefonoNormalizado(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 8 ? `591${digits}` : digits;
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────
export default function SeguimientoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pedidoId?: string }>();
  const [tabActiva, setTabActiva] = useState<'seguimiento' | 'repartidor' | 'chat' | 'pedido'>('seguimiento');
  const [pedidoEntregado, setPedidoEntregado] = useState(false);
  const [modalCalificar, setModalCalificar] = useState(false);
  // ── Estado de calificación (nuevo sistema completo) ──────────
  const [estrellasNegocio,       setEstrellasNegocio]       = useState(0);
  const [estrellasRepartidor,    setEstrellasRepartidor]     = useState(0);
  const [comentarioNegocio,      setComentarioNegocio]       = useState('');
  const [comentarioRepartidor,   setComentarioRepartidor]    = useState('');
  const [guardandoRating,        setGuardandoRating]         = useState(false);
  const [calificado,             setCalificado]              = useState(false);
  const [yaOfrecioModal,         setYaOfrecioModal]          = useState(false); // evita mostrar modal 2 veces en misma sesión
  const [pedidoReal, setPedidoReal] = useState<any>(null);
  const [repartidorReal, setRepartidorReal] = useState<any>(null);
  const [repartidorCoords, setRepartidorCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destinoCoords, setDestinoCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Cargar pedido real desde Supabase
  useEffect(() => {
    let pedidoSub: any;
    let ubicacionSub: any;

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
        // Suscripción a cambios de estado del pedido
        pedidoSub = supabase
          .channel(`pedido-${pedidoId}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'pedidos',
            filter: `id=eq.${pedidoId}`,
          }, (payload) => actualizarDesdeDB(payload.new))
          .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('[seguimiento] error suscripción pedido:', err ?? status)
            }
          });

        // Cargar última ubicación conocida del repartidor
        const { data: ubicActual } = await supabase
          .from('ubicaciones_repartidores')
          .select('lat, lng')
          .eq('pedido_id', pedidoId)
          .maybeSingle();
        if (ubicActual) setRepartidorCoords({ lat: Number(ubicActual.lat), lng: Number(ubicActual.lng) });

        // Suscripción Realtime a ubicación GPS del repartidor
        ubicacionSub = supabase
          .channel(`ubicacion-${pedidoId}`)
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'ubicaciones_repartidores',
            filter: `pedido_id=eq.${pedidoId}`,
          }, (payload) => {
            const d = payload.new as any;
            if (d?.lat && d?.lng) {
              setRepartidorCoords({ lat: Number(d.lat), lng: Number(d.lng) });
            }
          })
          .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('[seguimiento] error suscripción ubicación GPS:', err ?? status)
            }
          });
      }
    }

    async function actualizarDesdeDB(data: any) {
      setPedidoReal(data);
      if (data.destino_lat && data.destino_lng) {
        setDestinoCoords({ lat: Number(data.destino_lat), lng: Number(data.destino_lng) });
      }
      if (data.estado === 'entregado') {
        setPedidoEntregado(true);

        // ── Verificar si ya calificó este pedido ──────────────
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: yaRating } = await supabase
            .from('ratings')
            .select('id')
            .eq('pedido_id', data.id)
            .eq('cliente_id', user.id)
            .maybeSingle();

          if (yaRating) {
            // Ya calificó — mostrar badge de "gracias"
            setCalificado(true);
          } else {
            // No calificó — ofrecer modal UNA sola vez en esta sesión
            setYaOfrecioModal(prev => {
              if (!prev) {
                setTimeout(() => setModalCalificar(true), 800);
                return true;
              }
              return prev;
            });
          }
        }
      }
      if (data.repartidor_nombre) {
        setRepartidorReal({ ...REPARTIDOR_DEFAULT, nombre: data.repartidor_nombre, telefono: null });
      } else if (data.repartidor_id) {
        const { data: u } = await supabase
          .from('usuarios')
          .select('nombre, telefono')
          .eq('id', data.repartidor_id)
          .single();
        if (u?.nombre) setRepartidorReal({ ...REPARTIDOR_DEFAULT, nombre: u.nombre, telefono: u.telefono ?? null });
      }
    }

    cargar();
    return () => {
      if (pedidoSub) supabase.removeChannel(pedidoSub);
      if (ubicacionSub) supabase.removeChannel(ubicacionSub);
    };
  }, [params.pedidoId]);

  const REPARTIDOR = repartidorReal ?? REPARTIDOR_DEFAULT;

  const PEDIDO = pedidoReal ? {
    numero: `#CE-${pedidoReal.id.slice(-8).toUpperCase()}`,
    fecha: new Date(pedidoReal.created_at).toLocaleString('es-BO'),
    restaurante: pedidoReal.negocios?.nombre ?? 'Restaurante',
    restauranteEmoji: '🍔',
    items: Array.isArray(pedidoReal.items) ? pedidoReal.items : [],
    subtotal: pedidoReal.subtotal ?? pedidoReal.total ?? 0,
    envio: pedidoReal.costo_envio ?? 0,
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

  const telefonoRepartidor = telefonoNormalizado(REPARTIDOR.telefono);

  const llamarRepartidor = () => {
    if (!telefonoRepartidor) return;
    Linking.openURL(`tel:+${telefonoRepartidor}`);
  };

  const whatsappRepartidor = () => {
    if (!telefonoRepartidor) return;
    const url = `https://wa.me/${telefonoRepartidor}`;
    if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
    else Linking.openURL(url);
  };

  const confirmarCalificacion = async () => {
    if (estrellasNegocio === 0) return; // negocio es obligatorio
    setGuardandoRating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && pedidoReal?.id) {
        await supabase.from('ratings').insert({
          pedido_id:               pedidoReal.id,
          cliente_id:              user.id,
          calificacion_negocio:    estrellasNegocio,
          calificacion_repartidor: estrellasRepartidor > 0 ? estrellasRepartidor : null,
          comentario_negocio:      comentarioNegocio.trim()    || null,
          comentario_repartidor:   comentarioRepartidor.trim() || null,
        });
      }
    } catch { /* falla silenciosamente */ }
    setGuardandoRating(false);
    setModalCalificar(false);
    setCalificado(true);
  };

  const TABS = [
    { id: 'seguimiento', emoji: '🗺️',  label: 'Mapa'       },
    { id: 'repartidor',  emoji: '🏍️',  label: 'Repartidor' },
    { id: 'chat',        emoji: '📞',   label: 'Contacto'   },
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
            {HEADER_TITULO[pedidoReal?.estado as string] ?? (pedidoEntregado ? '🎉 ¡Pedido entregado!' : '🏍️ Pedido en camino')}
          </Text>
          <Text style={s.headerNumero}>{PEDIDO.numero} • {PEDIDO.fecha}</Text>
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
            onPress={() => setTabActiva(tab.id as any)}>
            <View style={s.tabInner}>
              <Text style={s.tabEmoji}>{tab.emoji}</Text>
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
            {/* Mapa GPS — componente con Platform check interno.
                Sin ubicación real todavía: nunca mostrar el grid decorativo
                fijo del componente, mostrar el estado real de espera. */}
            {repartidorCoords ? (
              <View style={s.mapaBox}>
                <MapaLeaflet
                  mode="readonly"
                  markers={[
                    { id: 'repartidor', lat: repartidorCoords.lat, lng: repartidorCoords.lng, emoji: '🏍️', label: 'Repartidor' },
                    ...(destinoCoords
                      ? [{ id: 'destino', lat: destinoCoords.lat, lng: destinoCoords.lng, emoji: '📍', label: 'Dirección de entrega' }]
                      : []),
                  ]}
                />
              </View>
            ) : (
              <View style={[s.mapaBox, s.mapaEsperando]}>
                <Text style={s.mapaEsperandoEmoji}>📡</Text>
                <Text style={s.mapaEsperandoTexto}>Esperando señal del repartidor</Text>
                <Text style={s.mapaEsperandoSub}>
                  {pedidoReal?.repartidor_id
                    ? 'El mapa se activará en cuanto el repartidor empiece a transmitir su ubicación.'
                    : 'El mapa se activará cuando se asigne un repartidor a tu pedido.'}
                </Text>
              </View>
            )}

            {/* Línea de estados — refleja exclusivamente pedidos.estado */}
            <View style={s.estadosCard}>
              <Text style={s.estadosTitle}>📋 Estado del pedido</Text>
              {pedidoReal?.estado === 'cancelado' ? (
                <Text style={s.estadoDesc}>❌ Este pedido fue cancelado</Text>
              ) : (
                (() => {
                  const rangoActual = rangoEstado(pedidoReal?.estado);
                  return PASOS_PEDIDO.map((paso, i) => {
                    const rangoPaso = rangoEstado(paso.estado);
                    const completado = rangoActual > rangoPaso;
                    const activo = rangoActual === rangoPaso;
                    return (
                      <View key={paso.estado} style={s.estadoFila}>
                        <View style={s.estadoIzq}>
                          <View style={[s.estadoCirculo, completado && s.circuloOk, activo && s.circuloActivo]}>
                            <Text style={s.circuloEmoji}>{completado ? '✓' : activo ? paso.emoji : '○'}</Text>
                          </View>
                          {i < PASOS_PEDIDO.length - 1 && (
                            <View style={[s.estadoLinea, completado && s.lineaOk]} />
                          )}
                        </View>
                        <View style={s.estadoDer}>
                          <Text style={[s.estadoLabel, completado && s.labelOk, activo && s.labelActivo]}>
                            {paso.label}
                          </Text>
                          {activo && <Text style={s.estadoDesc}>{paso.descripcion}</Text>}
                        </View>
                      </View>
                    );
                  });
                })()
              )}
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
              <TouchableOpacity
                style={[s.contactoBtn, !telefonoRepartidor && s.contactoBtnDisabled]}
                onPress={llamarRepartidor}
                disabled={!telefonoRepartidor}
              >
                <LinearGradient colors={['#059669','#10B981']} style={s.contactoGrad}>
                  <Text style={s.contactoBtnEmoji}>📞</Text>
                  <Text style={s.contactoBtnLabel}>Llamar</Text>
                  <Text style={s.contactoBtnSub}>{telefonoRepartidor ? REPARTIDOR.telefono : 'No disponible'}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.contactoBtn, !telefonoRepartidor && s.contactoBtnDisabled]}
                onPress={whatsappRepartidor}
                disabled={!telefonoRepartidor}
              >
                <LinearGradient colors={['#25D366','#128C7E']} style={s.contactoGrad}>
                  <Text style={s.contactoBtnEmoji}>💬</Text>
                  <Text style={s.contactoBtnLabel}>WhatsApp</Text>
                  <Text style={s.contactoBtnSub}>{telefonoRepartidor ? REPARTIDOR.telefono : 'No disponible'}</Text>
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

        {/* ── TAB: CONTACTO ───────────────────────────── */}
        {tabActiva === 'chat' && (
          <View>
            <View style={s.chatHeader}>
              <Text style={s.chatAvatarEmoji}>{REPARTIDOR.emoji}</Text>
              <View>
                <Text style={s.chatNombre}>{REPARTIDOR.nombre}</Text>
                <Text style={s.chatEstado}>
                  {telefonoRepartidor ? '🟢 Contactalo directamente' : '⚠️ Teléfono no disponible'}
                </Text>
              </View>
            </View>

            <View style={[s.contactoRow, { padding: 16 }]}>
              <TouchableOpacity
                style={[s.contactoBtn, !telefonoRepartidor && s.contactoBtnDisabled]}
                onPress={llamarRepartidor}
                disabled={!telefonoRepartidor}
              >
                <LinearGradient colors={['#059669','#10B981']} style={s.contactoGrad}>
                  <Text style={s.contactoBtnEmoji}>📞</Text>
                  <Text style={s.contactoBtnLabel}>Llamar</Text>
                  <Text style={s.contactoBtnSub}>{telefonoRepartidor ? REPARTIDOR.telefono : 'No disponible'}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.contactoBtn, !telefonoRepartidor && s.contactoBtnDisabled]}
                onPress={whatsappRepartidor}
                disabled={!telefonoRepartidor}
              >
                <LinearGradient colors={['#25D366','#128C7E']} style={s.contactoGrad}>
                  <Text style={s.contactoBtnEmoji}>💬</Text>
                  <Text style={s.contactoBtnLabel}>WhatsApp</Text>
                  <Text style={s.contactoBtnSub}>{telefonoRepartidor ? REPARTIDOR.telefono : 'No disponible'}</Text>
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
          <ScrollView
            contentContainerStyle={s.modalScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.modalBox}>
              <Text style={s.modalEmoji}>🎉</Text>
              <Text style={s.modalTitulo}>¡Pedido entregado!</Text>
              <Text style={s.modalSub}>Tu opinión ayuda a mejorar CaseritaExpress</Text>

              {/* ── Calificación del negocio ── */}
              <View style={s.ratingSection}>
                <Text style={s.ratingSectionTitle}>🍽️ {PEDIDO.restaurante}</Text>
                <Text style={s.ratingSectionSub}>¿Cómo estuvo la comida?</Text>
                <StarRating value={estrellasNegocio} onChange={setEstrellasNegocio} size={40} />
                {estrellasNegocio > 0 && (
                  <Text style={s.ratingFeedback}>
                    {estrellasNegocio === 5 ? '¡Excelente! 🔥' : estrellasNegocio >= 4 ? 'Muy buena 👍' : estrellasNegocio >= 3 ? 'Regular 😐' : 'Puede mejorar 😕'}
                  </Text>
                )}
                <TextInput
                  style={s.comentarioInput}
                  placeholder="Comentario opcional sobre el restaurante..."
                  placeholderTextColor="#9CA3AF"
                  value={comentarioNegocio}
                  onChangeText={setComentarioNegocio}
                  multiline
                  numberOfLines={2}
                  maxLength={200}
                />
              </View>

              {/* ── Calificación del repartidor ── */}
              <View style={s.ratingSection}>
                <Text style={s.ratingSectionTitle}>🛵 {REPARTIDOR.nombre}</Text>
                <Text style={s.ratingSectionSub}>¿Cómo fue la entrega? (opcional)</Text>
                <StarRating value={estrellasRepartidor} onChange={setEstrellasRepartidor} size={40} />
                {estrellasRepartidor > 0 && (
                  <Text style={s.ratingFeedback}>
                    {estrellasRepartidor === 5 ? '¡Entrega perfecta! 🚀' : estrellasRepartidor >= 4 ? 'Muy buena 👍' : estrellasRepartidor >= 3 ? 'Regular 😐' : 'Tardó mucho 😕'}
                  </Text>
                )}
                <TextInput
                  style={s.comentarioInput}
                  placeholder="Comentario opcional sobre el repartidor..."
                  placeholderTextColor="#9CA3AF"
                  value={comentarioRepartidor}
                  onChangeText={setComentarioRepartidor}
                  multiline
                  numberOfLines={2}
                  maxLength={200}
                />
              </View>

              <TouchableOpacity
                style={[s.modalBtnOk, (estrellasNegocio === 0 || guardandoRating) && s.modalBtnDisabled]}
                onPress={confirmarCalificacion}
                disabled={estrellasNegocio === 0 || guardandoRating}
                activeOpacity={0.85}
              >
                <Text style={s.modalBtnOkText}>
                  {guardandoRating ? 'Enviando...' : '✅ Enviar calificación'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModalCalificar(false)} style={s.modalBtnSkip}>
                <Text style={s.modalBtnSkipText}>Ahora no</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
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
  entregadoTag:         { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  entregadoText:        { color: '#FFF', fontWeight: '700', fontSize: 14 },
  tabsBar:              { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', elevation: 2 },
  tabBtn:               { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActivo:         { borderBottomColor: '#F97316' },
  tabInner:             { position: 'relative', marginBottom: 2 },
  tabEmoji:             { fontSize: 20 },
  tabLabel:             { fontSize: 10, color: '#9CA3AF', fontWeight: '500' },
  tabLabelActivo:       { color: '#F97316', fontWeight: '700' },
  body:                 { flex: 1 },
  mapaBox:              { margin: 16, borderRadius: 20, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10 },
  mapaEsperando:        { height: 230, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 },
  mapaEsperandoEmoji:   { fontSize: 40 },
  mapaEsperandoTexto:   { fontSize: 14, fontWeight: '700', color: '#1E0A3C' },
  mapaEsperandoSub:     { fontSize: 12, color: '#6B7280', textAlign: 'center' },
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
  contactoBtnDisabled:  { opacity: 0.5 },
  seguridadCard:        { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderLeftWidth: 4, borderLeftColor: '#F97316' },
  seguridadTitle:       { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 10 },
  seguridadItem:        { fontSize: 12, color: '#6B7280', marginBottom: 6, lineHeight: 18 },
  chatHeader:           { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  chatAvatarEmoji:      { fontSize: 36 },
  chatNombre:           { fontSize: 15, fontWeight: '700', color: '#1E0A3C' },
  chatEstado:           { fontSize: 12, color: '#10B981', marginTop: 2 },
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
  // ── Modal nuevo: scroll + secciones ─────────────────────
  modalScroll:          { flexGrow: 1, justifyContent: 'center', padding: 16 },
  ratingSection:        { width: '100%', marginBottom: 20, alignItems: 'center' },
  ratingSectionTitle:   { fontSize: 16, fontWeight: '800', color: '#1E0A3C', marginBottom: 2 },
  ratingSectionSub:     { fontSize: 13, color: '#6B7280', marginBottom: 10 },
  ratingFeedback:       { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 6, marginBottom: 4 },
  comentarioInput:      { width: '100%', backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: 12, fontSize: 13, color: '#1E0A3C', marginTop: 8, textAlignVertical: 'top', minHeight: 56 },
});