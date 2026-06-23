import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

const getEstadoColor = (estado: string) => {
  if (estado === 'Entregado' || estado === 'Completado' || estado === 'entregado') return '#10B981';
  if (estado === 'Próximo' || estado === 'pendiente') return '#F97316';
  if (estado === 'En camino') return '#3B82F6';
  if (estado === 'Cancelado') return '#EF4444';
  return '#9CA3AF';
};

export default function PerfilScreen() {
  const router = useRouter();
  const [seccionActiva, setSeccionActiva] = useState<string | null>(null);
  const [modalCerrar, setModalCerrar] = useState(false);
  const [usuario, setUsuario] = useState<any>(null);
  const [pedidos, setPedidos]   = useState<any[]>([]);
  const [reservas, setReservas] = useState<any[]>([]);
  const [entradas, setEntradas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [entregasCompletadas, setEntregasCompletadas] = useState(0);
  const [enCaminoCount, setEnCaminoCount] = useState(0);

  useFocusEffect(useCallback(() => { cargarPerfil(); }, []));

  const cargarPerfil = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: perfil } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
      const u = perfil || { email: user.email, nombre: user.email?.split('@')[0] };
      setUsuario(u);

      if (u?.rol === 'repartidor') {
        const { count: completadas } = await supabase
          .from('pedidos').select('id', { count: 'exact', head: true })
          .eq('repartidor_id', user.id).eq('estado', 'entregado');
        setEntregasCompletadas(completadas ?? 0);

        const { count: enCamino } = await supabase
          .from('pedidos').select('id', { count: 'exact', head: true })
          .eq('repartidor_id', user.id).eq('estado', 'en_camino');
        setEnCaminoCount(enCamino ?? 0);
      } else {
        const [{ data: misPedidos }, { data: misReservas }, { data: misEntradas }] = await Promise.all([
          supabase.from('pedidos')
            .select('id, created_at, total, estado, negocios(nombre)')
            .eq('cliente_id', user.id).order('created_at', { ascending: false }),
          supabase.from('reservas')
            .select('id, created_at, total, pago_estado, noches, fecha_entrada, alojamientos(nombre)')
            .eq('cliente_id', user.id).order('created_at', { ascending: false }),
          supabase.from('entradas')
            .select('id, created_at, total, pago_estado, cantidad, eventos(nombre)')
            .eq('cliente_id', user.id).order('created_at', { ascending: false }),
        ]);
        if (misPedidos)  setPedidos(misPedidos);
        if (misReservas) setReservas(misReservas);
        if (misEntradas) setEntradas(misEntradas);
      }
    }
    setCargando(false);
  };

  const cerrarSesion = async () => {
    setModalCerrar(false);
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const toggleSeccion = (sec: string) => setSeccionActiva(seccionActiva === sec ? null : sec);

  // ── VISTA REPARTIDOR ─────────────────────────────────────────────────────────
  if (!cargando && usuario?.rol === 'repartidor') {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#EA580C', '#F97316']} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backTextNaranja}>← Inicio</Text>
          </TouchableOpacity>

          <View style={styles.perfilHero}>
            <View style={styles.avatarBox}>
              {usuario?.foto_url
                ? <Image source={{ uri: usuario.foto_url }} style={styles.avatarImg} />
                : <Text style={styles.avatarEmoji}>🏍️</Text>}
            </View>
            <Text style={styles.nombreText}>{usuario?.nombre || 'Repartidor'}</Text>
            <Text style={styles.emailTextoNaranja}>{usuario?.email || ''}</Text>
            <View style={styles.repartidorBadge}>
              <Text style={styles.repartidorBadgeText}>🛵 Repartidor</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{entregasCompletadas}</Text>
              <Text style={styles.statLabelNaranja}>Entregas</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{enCaminoCount}</Text>
              <Text style={styles.statLabelNaranja}>En camino</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statNum}>5.0 ⭐</Text>
              <Text style={styles.statLabelNaranja}>Calificación</Text>
            </View>
          </View>
        </LinearGradient>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

          {/* Mi Panel */}
          <TouchableOpacity
            style={styles.repartidorBtn}
            onPress={() => router.push('/repartidor' as any)}>
            <LinearGradient colors={['#F97316', '#EA580C']} style={styles.repartidorGrad}>
              <Text style={styles.repartidorBtnEmoji}>🏍️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.repartidorBtnTitle}>Mi Panel</Text>
                <Text style={styles.repartidorBtnSub}>Pedidos disponibles y entregas activas</Text>
              </View>
              <Text style={styles.repartidorBtnArrow}>›</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Mis datos (solo lectura) */}
          <View style={styles.datoCard}>
            <Text style={styles.datoCardTitle}>📋 Mis datos</Text>
            <View style={styles.datoRow}>
              <Text style={styles.datoLabel}>Nombre</Text>
              <Text style={styles.datoValor}>{usuario?.nombre || '—'}</Text>
            </View>
            <View style={styles.datoRow}>
              <Text style={styles.datoLabel}>Teléfono</Text>
              <Text style={styles.datoValor}>{usuario?.telefono || '—'}</Text>
            </View>
            <View style={[styles.datoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.datoLabel}>Vehículo</Text>
              <Text style={styles.datoValor}>
                {usuario?.vehiculo_tipo === 'moto' ? '🏍️ Moto'
                  : usuario?.vehiculo_tipo === 'bicicleta' ? '🚲 Bicicleta'
                  : usuario?.vehiculo_tipo === 'a pie' ? '🚶 A pie'
                  : '—'}
              </Text>
            </View>
          </View>
          <Text style={styles.datoHint}>Edita tus datos en Mi Panel → Perfil</Text>

          {/* Cerrar sesión */}
          <TouchableOpacity style={styles.cerrarBtn} onPress={() => setModalCerrar(true)}>
            <Text style={styles.cerrarText}>🚪 Cerrar sesión</Text>
          </TouchableOpacity>

          <Text style={styles.version}>CaseritaExpress v1.0 • Tarija, Bolivia 🇧🇴</Text>
          <View style={{ height: 40 }} />
        </ScrollView>

        {modalCerrar && <ModalCerrar onConfirm={cerrarSesion} onCancel={() => setModalCerrar(false)} />}
      </View>
    );
  }

  // ── VISTA CLIENTE (normal) ────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <LinearGradient colors={['#4C1D95', '#7C3AED']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Inicio</Text>
        </TouchableOpacity>

        <View style={styles.perfilHero}>
          <View style={styles.avatarBox}>
            <Text style={styles.avatarEmoji}>👤</Text>
          </View>
          <Text style={styles.nombreText}>{usuario?.nombre || 'Usuario'}</Text>
          <Text style={styles.emailText}>{usuario?.email || ''}</Text>
          {usuario?.telefono && <Text style={styles.telefonoText}>📱 {usuario.telefono}</Text>}
          <View style={styles.miembroTag}>
            <Text style={styles.miembroText}>⭐ Miembro de CaseritaExpress</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{pedidos.length}</Text>
            <Text style={styles.statLabel}>🍔 Pedidos</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{reservas.length}</Text>
            <Text style={styles.statLabel}>🏡 Reservas</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{entradas.length}</Text>
            <Text style={styles.statLabel}>🎟️ Eventos</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

        {/* HISTORIAL — DELIVERY */}
        <TouchableOpacity style={styles.seccionHeader} onPress={() => toggleSeccion('pedidos')}>
          <View style={styles.seccionLeft}>
            <Text style={styles.seccionEmoji}>🍔</Text>
            <Text style={styles.seccionTitle}>Mis pedidos</Text>
          </View>
          <View style={styles.seccionRight}>
            <View style={styles.seccionBadge}><Text style={styles.seccionBadgeText}>{pedidos.length}</Text></View>
            <Text style={styles.seccionArrow}>{seccionActiva === 'pedidos' ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>
        {seccionActiva === 'pedidos' && (
          <View style={styles.seccionBody}>
            {pedidos.length === 0 ? (
              <Text style={styles.emptyText}>No tienes pedidos de delivery aún</Text>
            ) : (
              pedidos.map(p => (
                <View key={p.id} style={styles.itemCard}>
                  <View style={[styles.itemIconBox, { backgroundColor: '#FFF7ED' }]}>
                    <Text style={styles.itemEmoji}>🍔</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemNombre}>{p.negocios?.nombre || 'Pedido'}</Text>
                    <Text style={styles.itemDetalle}>Delivery</Text>
                    <Text style={styles.itemFecha}>{new Date(p.created_at).toLocaleDateString('es-BO')}</Text>
                  </View>
                  <View style={styles.itemDerecha}>
                    <Text style={styles.itemTotal}>Bs. {p.total}</Text>
                    <View style={[styles.estadoBadge, { backgroundColor: getEstadoColor(p.estado) + '20' }]}>
                      <Text style={[styles.estadoText, { color: getEstadoColor(p.estado) }]}>{p.estado}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* HISTORIAL — STAY */}
        <TouchableOpacity style={styles.seccionHeader} onPress={() => toggleSeccion('reservas')}>
          <View style={styles.seccionLeft}>
            <Text style={styles.seccionEmoji}>🏡</Text>
            <Text style={styles.seccionTitle}>Mis reservas</Text>
          </View>
          <View style={styles.seccionRight}>
            <View style={styles.seccionBadge}><Text style={styles.seccionBadgeText}>{reservas.length}</Text></View>
            <Text style={styles.seccionArrow}>{seccionActiva === 'reservas' ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>
        {seccionActiva === 'reservas' && (
          <View style={styles.seccionBody}>
            {reservas.length === 0 ? (
              <Text style={styles.emptyText}>No tienes reservas de alojamiento aún</Text>
            ) : (
              reservas.map(r => (
                <View key={r.id} style={styles.itemCard}>
                  <View style={[styles.itemIconBox, { backgroundColor: '#EDE9FE' }]}>
                    <Text style={styles.itemEmoji}>🏡</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemNombre}>{r.alojamientos?.nombre || 'Alojamiento'}</Text>
                    <Text style={styles.itemDetalle}>{r.noches} noche{r.noches !== 1 ? 's' : ''}{r.fecha_entrada ? ` · ${new Date(r.fecha_entrada).toLocaleDateString('es-BO')}` : ''}</Text>
                    <Text style={styles.itemFecha}>{new Date(r.created_at).toLocaleDateString('es-BO')}</Text>
                  </View>
                  <View style={styles.itemDerecha}>
                    <Text style={styles.itemTotal}>Bs. {r.total}</Text>
                    <View style={[styles.estadoBadge, { backgroundColor: getEstadoColor(r.pago_estado) + '20' }]}>
                      <Text style={[styles.estadoText, { color: getEstadoColor(r.pago_estado) }]}>{r.pago_estado}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* HISTORIAL — EVENTOS */}
        <TouchableOpacity style={styles.seccionHeader} onPress={() => toggleSeccion('entradas')}>
          <View style={styles.seccionLeft}>
            <Text style={styles.seccionEmoji}>🎟️</Text>
            <Text style={styles.seccionTitle}>Mis entradas</Text>
          </View>
          <View style={styles.seccionRight}>
            <View style={styles.seccionBadge}><Text style={styles.seccionBadgeText}>{entradas.length}</Text></View>
            <Text style={styles.seccionArrow}>{seccionActiva === 'entradas' ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>
        {seccionActiva === 'entradas' && (
          <View style={styles.seccionBody}>
            {entradas.length === 0 ? (
              <Text style={styles.emptyText}>No tienes entradas de eventos aún</Text>
            ) : (
              entradas.map(e => (
                <View key={e.id} style={styles.itemCard}>
                  <View style={[styles.itemIconBox, { backgroundColor: '#F3E8FF' }]}>
                    <Text style={styles.itemEmoji}>🎟️</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemNombre}>{e.eventos?.nombre || 'Evento'}</Text>
                    <Text style={styles.itemDetalle}>{e.cantidad} entrada{e.cantidad !== 1 ? 's' : ''}</Text>
                    <Text style={styles.itemFecha}>{new Date(e.created_at).toLocaleDateString('es-BO')}</Text>
                  </View>
                  <View style={styles.itemDerecha}>
                    <Text style={styles.itemTotal}>Bs. {e.total}</Text>
                    <View style={[styles.estadoBadge, { backgroundColor: getEstadoColor(e.pago_estado) + '20' }]}>
                      <Text style={[styles.estadoText, { color: getEstadoColor(e.pago_estado) }]}>{e.pago_estado}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* MENÚ OPCIONES */}
        <View style={styles.menuBox}>
          {[
            { emoji: '❤️', label: 'Mis favoritos' },
            { emoji: '🔔', label: 'Notificaciones' },
            { emoji: '💳', label: 'Métodos de pago' },
            { emoji: '🎁', label: 'Mis cupones y promociones' },
            { emoji: '⭐', label: 'Calificar la app' },
            { emoji: '❓', label: 'Ayuda y soporte' },
            { emoji: '📄', label: 'Términos y condiciones' },
            { emoji: '🔒', label: 'Privacidad y seguridad' },
          ].map((op, i) => (
            <TouchableOpacity key={i} style={styles.menuItem}>
              <Text style={styles.menuEmoji}>{op.emoji}</Text>
              <Text style={styles.menuLabel}>{op.label}</Text>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.cerrarBtn} onPress={() => setModalCerrar(true)}>
          <Text style={styles.cerrarText}>🚪 Cerrar sesión</Text>
        </TouchableOpacity>

        <Text style={styles.version}>CaseritaExpress v1.0 • Tarija, Bolivia 🇧🇴</Text>
        <View style={{ height: 40 }} />
      </ScrollView>

      {modalCerrar && <ModalCerrar onConfirm={cerrarSesion} onCancel={() => setModalCerrar(false)} />}
    </View>
  );
}

function ModalCerrar({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalBox}>
        <Text style={styles.modalEmoji}>🚪</Text>
        <Text style={styles.modalTitle}>¿Cerrar sesión?</Text>
        <Text style={styles.modalSub}>Tendrás que volver a iniciar sesión para hacer pedidos</Text>
        <TouchableOpacity style={styles.modalBtnRojo} onPress={onConfirm}>
          <Text style={styles.modalBtnRojoText}>Sí, cerrar sesión</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.modalBtnGris} onPress={onCancel}>
          <Text style={styles.modalBtnGrisText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#F8F7FF' },
  header:              { paddingTop: 55, paddingBottom: 24, paddingHorizontal: 20 },
  backBtn:             { marginBottom: 16 },
  backText:            { color: '#DDD6FE', fontSize: 14 },
  backTextNaranja:     { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  perfilHero:          { alignItems: 'center', marginBottom: 20 },
  avatarBox:           { width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 10, borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)', overflow: 'hidden' },
  avatarEmoji:         { fontSize: 44 },
  avatarImg:           { width: 90, height: 90, borderRadius: 45 },
  nombreText:          { fontSize: 22, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  emailText:           { fontSize: 13, color: '#C4B5FD', marginBottom: 2 },
  emailTextoNaranja:   { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 10 },
  telefonoText:        { fontSize: 13, color: '#C4B5FD', marginBottom: 10 },
  miembroTag:          { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 8 },
  miembroText:         { color: '#FFF', fontSize: 12, fontWeight: '600' },
  repartidorBadge:     { backgroundColor: '#F97316', paddingHorizontal: 18, paddingVertical: 6, borderRadius: 20, marginTop: 8 },
  repartidorBadgeText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  statsRow:            { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16, marginTop: 8 },
  statBox:             { flex: 1, alignItems: 'center' },
  statNum:             { fontSize: 22, fontWeight: '800', color: '#FFF' },
  statLabel:           { fontSize: 11, color: '#C4B5FD', marginTop: 2 },
  statLabelNaranja:    { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  statDivider:         { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  body:                { flex: 1 },
  // Repartidor — Mi Panel button
  repartidorBtn:       { marginHorizontal: 16, marginTop: 16, borderRadius: 16, overflow: 'hidden', elevation: 4, shadowColor: '#F97316', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8 },
  repartidorGrad:      { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14 },
  repartidorBtnEmoji:  { fontSize: 30 },
  repartidorBtnTitle:  { color: '#FFF', fontWeight: '800', fontSize: 16 },
  repartidorBtnSub:    { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  repartidorBtnArrow:  { color: '#FFF', fontSize: 28, fontWeight: '300' },
  // Repartidor — Mis datos
  datoCard:            { marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
  datoCardTitle:       { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 12 },
  datoRow:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  datoLabel:           { fontSize: 13, color: '#9CA3AF', fontWeight: '500' },
  datoValor:           { fontSize: 13, color: '#1E0A3C', fontWeight: '600' },
  datoHint:            { textAlign: 'center', fontSize: 11, color: '#9CA3AF', marginTop: 6, marginBottom: 4 },
  // Cliente — Historial
  seccionHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
  seccionLeft:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seccionEmoji:        { fontSize: 20 },
  seccionTitle:        { fontSize: 15, fontWeight: '700', color: '#1E0A3C' },
  seccionRight:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seccionBadge:        { backgroundColor: '#7C3AED', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  seccionBadgeText:    { color: '#FFF', fontSize: 11, fontWeight: '700' },
  seccionArrow:        { fontSize: 12, color: '#7C3AED' },
  seccionBody:         { marginHorizontal: 16, backgroundColor: '#FFF', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, paddingHorizontal: 16, paddingBottom: 8, elevation: 1 },
  emptyText:           { textAlign: 'center', color: '#9CA3AF', fontSize: 14, paddingVertical: 16 },
  itemCard:            { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F9FAFB', alignItems: 'center' },
  itemIconBox:         { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  itemEmoji:           { fontSize: 22 },
  itemInfo:            { flex: 1 },
  itemNombre:          { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 2 },
  itemDetalle:         { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  itemFecha:           { fontSize: 11, color: '#9CA3AF' },
  itemDerecha:         { alignItems: 'flex-end' },
  itemTotal:           { fontSize: 15, fontWeight: '800', color: '#1E0A3C', marginBottom: 4 },
  estadoBadge:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  estadoText:          { fontSize: 11, fontWeight: '700' },
  // Cliente — Menú
  menuBox:             { marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF', borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, overflow: 'hidden' },
  menuItem:            { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  menuEmoji:           { fontSize: 20, marginRight: 14 },
  menuLabel:           { flex: 1, fontSize: 14, color: '#1E0A3C', fontWeight: '500' },
  menuArrow:           { fontSize: 20, color: '#9CA3AF' },
  // Compartido
  cerrarBtn:           { marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#FEE2E2' },
  cerrarText:          { color: '#EF4444', fontSize: 15, fontWeight: '700' },
  version:             { textAlign: 'center', color: '#9CA3AF', fontSize: 12, marginTop: 16 },
  // Modal
  modalOverlay:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  modalBox:            { backgroundColor: '#FFF', borderRadius: 24, padding: 28, width: '85%', alignItems: 'center' },
  modalEmoji:          { fontSize: 48, marginBottom: 8 },
  modalTitle:          { fontSize: 22, fontWeight: '800', color: '#1E0A3C', marginBottom: 8 },
  modalSub:            { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 24 },
  modalBtnRojo:        { backgroundColor: '#EF4444', borderRadius: 14, padding: 16, width: '100%', alignItems: 'center', marginBottom: 10 },
  modalBtnRojoText:    { color: '#FFF', fontWeight: '800', fontSize: 16 },
  modalBtnGris:        { padding: 10 },
  modalBtnGrisText:    { color: '#9CA3AF', fontSize: 14 },
});
