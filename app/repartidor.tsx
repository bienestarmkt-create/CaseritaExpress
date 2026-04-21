import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

type Pedido = {
  id: string;
  cliente_id: string;
  negocio_id?: string;
  items: any[];
  total: number;
  subtotal?: number;
  estado: string;
  tipo?: string;
  direccion_entrega?: string;
  repartidor_id?: string;
  repartidor_nombre?: string;
  created_at: string;
  negocios?: { nombre: string };
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const ESTADO_COLOR: Record<string, string> = {
  pendiente: '#F59E0B',
  confirmado: '#3B82F6',
  en_camino: '#F97316',
  entregado: '#10B981',
  cancelado: '#EF4444',
};

export default function RepartidorScreen() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<any>(null);
  const [pedidosDisponibles, setPedidosDisponibles] = useState<Pedido[]>([]);
  const [misEntregas, setMisEntregas] = useState<Pedido[]>([]);
  const [tab, setTab] = useState<'disponibles' | 'mis_entregas'>('disponibles');
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    init();
    const sub = supabase
      .channel('repartidor-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar())
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  async function init() {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { data: perfil } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
    setUsuario(perfil);
    await cargar(user.id);
    setCargando(false);
  }

  async function cargar(uid?: string) {
    const { data: { user } } = await supabase.auth.getUser();
    const userId = uid ?? user?.id;
    if (!userId) return;

    const { data: disponibles } = await supabase
      .from('pedidos')
      .select('*, negocios(nombre)')
      .eq('estado', 'confirmado')
      .is('repartidor_id', null)
      .order('created_at', { ascending: true });

    const { data: mias } = await supabase
      .from('pedidos')
      .select('*, negocios(nombre)')
      .eq('repartidor_id', userId)
      .in('estado', ['en_camino', 'entregado'])
      .order('created_at', { ascending: false });

    setPedidosDisponibles(disponibles ?? []);
    setMisEntregas(mias ?? []);
  }

  async function aceptarPedido(pedido: Pedido) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setActualizando(pedido.id);
    const nombre = usuario?.nombre ?? user.email?.split('@')[0] ?? 'Repartidor';
    const { error } = await supabase
      .from('pedidos')
      .update({ estado: 'en_camino', repartidor_id: user.id, repartidor_nombre: nombre })
      .eq('id', pedido.id);
    if (error) Alert.alert('Error', 'No se pudo aceptar el pedido');
    else { setTab('mis_entregas'); await cargar(); }
    setActualizando(null);
  }

  async function marcarEntregado(pedidoId: string) {
    setActualizando(pedidoId);
    const { error } = await supabase
      .from('pedidos')
      .update({ estado: 'entregado' })
      .eq('id', pedidoId);
    if (error) Alert.alert('Error', 'No se pudo actualizar el estado');
    else await cargar();
    setActualizando(null);
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await cargar();
    setRefreshing(false);
  };

  if (cargando) {
    return (
      <View style={s.loadingBox}>
        <ActivityIndicator size="large" color="#F97316" />
        <Text style={s.loadingText}>Cargando...</Text>
      </View>
    );
  }

  const lista = tab === 'disponibles' ? pedidosDisponibles : misEntregas;

  return (
    <View style={s.container}>
      {/* Header */}
      <LinearGradient colors={['#EA580C', '#F97316']} style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Volver</Text>
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Text style={s.headerTitle}>🏍️ Panel Repartidor</Text>
          <Text style={s.headerSub}>Hola, {usuario?.nombre ?? 'Repartidor'}</Text>
        </View>
        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statNum}>{pedidosDisponibles.length}</Text>
            <Text style={s.statLabel}>Disponibles</Text>
          </View>
          <View style={s.statDiv} />
          <View style={s.statBox}>
            <Text style={s.statNum}>{misEntregas.filter(p => p.estado === 'en_camino').length}</Text>
            <Text style={s.statLabel}>En camino</Text>
          </View>
          <View style={s.statDiv} />
          <View style={s.statBox}>
            <Text style={s.statNum}>{misEntregas.filter(p => p.estado === 'entregado').length}</Text>
            <Text style={s.statLabel}>Entregados</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Tabs */}
      <View style={s.tabsBar}>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'disponibles' && s.tabActivo]}
          onPress={() => setTab('disponibles')}>
          <Text style={[s.tabLabel, tab === 'disponibles' && s.tabLabelActivo]}>
            📦 Disponibles ({pedidosDisponibles.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'mis_entregas' && s.tabActivo]}
          onPress={() => setTab('mis_entregas')}>
          <Text style={[s.tabLabel, tab === 'mis_entregas' && s.tabLabelActivo]}>
            🏍️ Mis entregas ({misEntregas.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Lista */}
      <ScrollView
        style={s.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#F97316']} />}>
        {lista.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyEmoji}>{tab === 'disponibles' ? '📭' : '🏍️'}</Text>
            <Text style={s.emptyTitle}>
              {tab === 'disponibles' ? 'No hay pedidos disponibles' : 'Sin entregas aún'}
            </Text>
            <Text style={s.emptySubtitle}>
              {tab === 'disponibles'
                ? 'Cuando haya pedidos confirmados aparecerán aquí'
                : 'Acepta un pedido disponible para comenzar'}
            </Text>
          </View>
        ) : (
          lista.map(pedido => (
            <PedidoCard
              key={pedido.id}
              pedido={pedido}
              tab={tab}
              actualizando={actualizando === pedido.id}
              onAceptar={() => aceptarPedido(pedido)}
              onEntregado={() => marcarEntregado(pedido.id)}
            />
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function PedidoCard({ pedido, tab, actualizando, onAceptar, onEntregado }: {
  pedido: Pedido;
  tab: string;
  actualizando: boolean;
  onAceptar: () => void;
  onEntregado: () => void;
}) {
  const estadoColor = ESTADO_COLOR[pedido.estado] ?? '#9CA3AF';
  const estadoLabel = ESTADO_LABEL[pedido.estado] ?? pedido.estado;
  const items = Array.isArray(pedido.items) ? pedido.items : [];

  return (
    <View style={s.card}>
      {/* Header card */}
      <View style={s.cardHeader}>
        <View style={s.cardHeaderLeft}>
          <Text style={s.cardNegocio}>{pedido.negocios?.nombre ?? '🛒 Pedido'}</Text>
          <Text style={s.cardId}>#{pedido.id.slice(-8)}</Text>
        </View>
        <View style={[s.estadoBadge, { backgroundColor: estadoColor + '20', borderColor: estadoColor }]}>
          <Text style={[s.estadoText, { color: estadoColor }]}>{estadoLabel}</Text>
        </View>
      </View>

      {/* Dirección */}
      <View style={s.dirRow}>
        <Text style={s.dirEmoji}>📍</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.dirLabel}>Entregar en</Text>
          <Text style={s.dirTexto}>{pedido.direccion_entrega ?? 'Sin dirección especificada'}</Text>
        </View>
      </View>

      {/* Items */}
      {items.length > 0 && (
        <View style={s.itemsBox}>
          {items.slice(0, 3).map((item: any, i: number) => (
            <Text key={i} style={s.itemText}>
              • {item.nombre ?? item.name} {item.cantidad > 1 ? `×${item.cantidad}` : ''}
            </Text>
          ))}
          {items.length > 3 && (
            <Text style={s.itemText}>+{items.length - 3} más...</Text>
          )}
        </View>
      )}

      {/* Total + hora */}
      <View style={s.cardFooter}>
        <Text style={s.cardTotal}>Bs. {(pedido.total ?? 0).toLocaleString()}</Text>
        <Text style={s.cardHora}>
          {new Date(pedido.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Acciones */}
      {tab === 'disponibles' && pedido.estado === 'confirmado' && (
        <TouchableOpacity
          style={[s.btnAceptar, actualizando && s.btnDisabled]}
          onPress={onAceptar}
          disabled={actualizando}>
          <LinearGradient colors={['#F97316', '#EA580C']} style={s.btnGrad}>
            {actualizando
              ? <ActivityIndicator color="#FFF" size="small" />
              : <Text style={s.btnText}>✅ Aceptar pedido</Text>}
          </LinearGradient>
        </TouchableOpacity>
      )}

      {tab === 'mis_entregas' && pedido.estado === 'en_camino' && (
        <View style={s.botonesRow}>
          <View style={[s.enCaminoBadge]}>
            <Text style={s.enCaminoText}>🏍️ En camino</Text>
          </View>
          <TouchableOpacity
            style={[s.btnEntregado, actualizando && s.btnDisabled]}
            onPress={onEntregado}
            disabled={actualizando}>
            {actualizando
              ? <ActivityIndicator color="#FFF" size="small" />
              : <Text style={s.btnEntregadoText}>📦 Marcar entregado</Text>}
          </TouchableOpacity>
        </View>
      )}

      {pedido.estado === 'entregado' && (
        <View style={s.completadoRow}>
          <Text style={s.completadoText}>✅ Entregado exitosamente</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#F9FAFB' },
  loadingBox:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:      { color: '#9CA3AF', fontSize: 14 },
  header:           { paddingTop: 55, paddingBottom: 20, paddingHorizontal: 20 },
  backBtn:          { marginBottom: 8 },
  backText:         { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  headerContent:    { marginBottom: 16 },
  headerTitle:      { fontSize: 22, fontWeight: '800', color: '#FFF' },
  headerSub:        { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  statsRow:         { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16 },
  statBox:          { flex: 1, alignItems: 'center' },
  statNum:          { fontSize: 24, fontWeight: '800', color: '#FFF' },
  statLabel:        { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  statDiv:          { width: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  tabsBar:          { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  tabBtn:           { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActivo:        { borderBottomColor: '#F97316' },
  tabLabel:         { fontSize: 13, fontWeight: '600', color: '#9CA3AF' },
  tabLabelActivo:   { color: '#F97316' },
  body:             { flex: 1, padding: 16 },
  emptyBox:         { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji:       { fontSize: 52, marginBottom: 12 },
  emptyTitle:       { fontSize: 17, fontWeight: '700', color: '#374151', marginBottom: 6 },
  emptySubtitle:    { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingHorizontal: 32 },
  card:             { backgroundColor: '#FFF', borderRadius: 20, padding: 16, marginBottom: 14, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
  cardHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardHeaderLeft:   { flex: 1 },
  cardNegocio:      { fontSize: 16, fontWeight: '700', color: '#1E0A3C' },
  cardId:           { fontSize: 11, color: '#9CA3AF', marginTop: 2, fontFamily: 'monospace' },
  estadoBadge:      { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  estadoText:       { fontSize: 11, fontWeight: '700' },
  dirRow:           { flexDirection: 'row', gap: 10, backgroundColor: '#FFF7ED', borderRadius: 12, padding: 12, marginBottom: 10 },
  dirEmoji:         { fontSize: 18 },
  dirLabel:         { fontSize: 11, color: '#9CA3AF', fontWeight: '600', marginBottom: 2 },
  dirTexto:         { fontSize: 14, color: '#1E0A3C', fontWeight: '600', lineHeight: 20 },
  itemsBox:         { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, marginBottom: 10 },
  itemText:         { fontSize: 12, color: '#6B7280', lineHeight: 20 },
  cardFooter:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTotal:        { fontSize: 18, fontWeight: '800', color: '#F97316' },
  cardHora:         { fontSize: 12, color: '#9CA3AF' },
  btnAceptar:       { borderRadius: 14, overflow: 'hidden' },
  btnGrad:          { padding: 16, alignItems: 'center' },
  btnText:          { color: '#FFF', fontWeight: '800', fontSize: 15 },
  btnDisabled:      { opacity: 0.6 },
  botonesRow:       { flexDirection: 'row', gap: 10, alignItems: 'center' },
  enCaminoBadge:    { flex: 1, backgroundColor: '#FFF7ED', borderRadius: 12, padding: 12, alignItems: 'center' },
  enCaminoText:     { color: '#F97316', fontWeight: '700', fontSize: 13 },
  btnEntregado:     { flex: 1, backgroundColor: '#10B981', borderRadius: 12, padding: 12, alignItems: 'center' },
  btnEntregadoText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  completadoRow:    { backgroundColor: '#ECFDF5', borderRadius: 12, padding: 12, alignItems: 'center' },
  completadoText:   { color: '#10B981', fontWeight: '700', fontSize: 14 },
});
