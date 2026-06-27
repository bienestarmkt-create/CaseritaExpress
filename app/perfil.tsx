import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  const [userId, setUserId]   = useState<string | null>(null);
  const [pedidos, setPedidos]   = useState<any[]>([]);
  const [reservas, setReservas] = useState<any[]>([]);
  const [entradas, setEntradas] = useState<any[]>([]);
  // 'cargando' = rol aún no confirmado; 'error' = la query falló tras reintentos;
  // 'repartidor' / 'cliente' = rol confirmado desde la fila real en usuarios.
  // Nunca se cae a 'cliente' por timeout o error — solo por dato confirmado.
  const [rolEstado, setRolEstado] = useState<'cargando' | 'error' | 'repartidor' | 'cliente'>('cargando');
  const [entregasCompletadas, setEntregasCompletadas] = useState(0);
  const [enCaminoCount, setEnCaminoCount] = useState(0);
  // Edición de perfil — repartidor
  const [perfilForm, setPerfilForm] = useState({
    nombre: '', telefono: '', ci: '', edad: '',
    vehiculo_tipo: 'moto', vehiculo_placa: '', licencia: '', foto_url: '',
  });
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  useFocusEffect(useCallback(() => { cargarPerfil(); }, []));

  const cargarPerfil = async () => {
    setRolEstado('cargando');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRolEstado('error'); return; }
    setUserId(user.id);

    // Hasta 3 intentos en total antes de rendirse. Nunca caemos a la vista
    // de cliente por una query lenta o fallida — solo por dato confirmado.
    let perfil: any = null;
    let ultimoError: any = null;
    for (let intento = 0; intento < 3; intento++) {
      const { data, error } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
      if (!error) { perfil = data; ultimoError = null; break; }
      ultimoError = error;
      if (intento < 2) await new Promise(r => setTimeout(r, 600 * (intento + 1)));
    }

    if (ultimoError) {
      setRolEstado('error');
      return;
    }

    setUsuario(perfil);

    if (perfil?.rol === 'repartidor') {
      setPerfilForm({
        nombre:         perfil.nombre        ?? '',
        telefono:       perfil.telefono      ?? '',
        ci:             perfil.ci            ?? '',
        edad:           perfil.edad != null  ? String(perfil.edad) : '',
        vehiculo_tipo:  perfil.vehiculo_tipo ?? 'moto',
        vehiculo_placa: perfil.vehiculo_placa ?? '',
        licencia:       perfil.licencia      ?? '',
        foto_url:       perfil.foto_url      ?? '',
      });

      const { count: completadas } = await supabase
        .from('pedidos').select('id', { count: 'exact', head: true })
        .eq('repartidor_id', user.id).eq('estado', 'entregado');
      setEntregasCompletadas(completadas ?? 0);

      const { count: enCamino } = await supabase
        .from('pedidos').select('id', { count: 'exact', head: true })
        .eq('repartidor_id', user.id).eq('estado', 'en_camino');
      setEnCaminoCount(enCamino ?? 0);

      setRolEstado('repartidor');
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

      setRolEstado('cliente');
    }
  };

  const cerrarSesion = async () => {
    setModalCerrar(false);
    // Si signOut() lanza una excepción, el redirect debe ejecutarse igual —
    // antes, un error aquí dejaba al usuario "atascado" con sesión visualmente activa.
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('[logout] Error al cerrar sesión:', e);
    }
    router.replace('/login');
  };

  const seleccionarFoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets.length || !userId) return;
    setGuardandoPerfil(true);
    try {
      const uri = result.assets[0].uri;
      const blob = await (await fetch(uri)).blob();
      const buf  = await new Response(blob).arrayBuffer();
      const path = `${userId}/foto_perfil.jpg`;
      await supabase.storage.from('comprobantes').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      const { data: urlData } = supabase.storage.from('comprobantes').getPublicUrl(path);
      setPerfilForm(p => ({ ...p, foto_url: urlData.publicUrl }));
    } catch (e: any) { Alert.alert('Error', e.message); }
    setGuardandoPerfil(false);
  };

  const guardarPerfilRepartidor = async () => {
    if (!userId) return;
    setGuardandoPerfil(true);
    const { error } = await supabase.from('usuarios').update({
      nombre:          perfilForm.nombre,
      telefono:        perfilForm.telefono,
      ci:              perfilForm.ci,
      edad:            perfilForm.edad ? parseInt(perfilForm.edad) : null,
      vehiculo_tipo:   perfilForm.vehiculo_tipo,
      vehiculo_placa:  perfilForm.vehiculo_placa,
      licencia:        perfilForm.licencia,
      foto_url:        perfilForm.foto_url,
    }).eq('id', userId);
    setGuardandoPerfil(false);
    if (error) Alert.alert('Error', error.message);
    else {
      Alert.alert('✅ Perfil guardado', 'Tus datos han sido actualizados.');
      setUsuario((prev: any) => ({ ...prev, ...perfilForm }));
    }
  };

  const toggleSeccion = (sec: string) => setSeccionActiva(seccionActiva === sec ? null : sec);

  // ── CARGANDO: nunca mostrar la vista de cliente como default ───────────────────
  if (rolEstado === 'cargando') {
    return (
      <View style={styles.estadoCentradoContainer}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={styles.estadoCentradoTexto}>Cargando tu perfil...</Text>
      </View>
    );
  }

  // ── ERROR: la consulta del rol falló tras los reintentos ────────────────────────
  if (rolEstado === 'error') {
    return (
      <View style={styles.estadoCentradoContainer}>
        <Text style={styles.estadoCentradoEmoji}>⚠️</Text>
        <Text style={styles.estadoCentradoTitulo}>No pudimos cargar tu perfil</Text>
        <Text style={styles.estadoCentradoTexto}>Revisa tu conexión e intenta de nuevo</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => cargarPerfil()}>
          <Text style={styles.retryBtnText}>🔄 Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── VISTA REPARTIDOR — solo cuando el rol fue confirmado ────────────────────────
  if (rolEstado === 'repartidor') {
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

          {/* Editar mis datos */}
          <View style={styles.seccionCardRepartidor}>
            <TouchableOpacity onPress={seleccionarFoto} style={styles.fotoWrapper}>
              <View style={styles.fotoCirculo}>
                {perfilForm.foto_url
                  ? <Image source={{ uri: perfilForm.foto_url }} style={styles.fotoImg} />
                  : <Text style={styles.avatarEmoji}>🏍️</Text>}
              </View>
              <View style={styles.camaraBadge}>
                <Text style={styles.camaraBadgeText}>📷</Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.datoCardTitle}>📋 Datos personales</Text>
            <Text style={styles.fieldLabel}>Nombre completo</Text>
            <TextInput style={styles.input} value={perfilForm.nombre} onChangeText={v => setPerfilForm(p => ({ ...p, nombre: v }))} placeholder="Tu nombre completo" placeholderTextColor="#9CA3AF" />
            <Text style={styles.fieldLabel}>Número de celular</Text>
            <TextInput style={styles.input} value={perfilForm.telefono} onChangeText={v => setPerfilForm(p => ({ ...p, telefono: v }))} placeholder="Ej: 70123456" placeholderTextColor="#9CA3AF" keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Carnet de Identidad (CI)</Text>
            <TextInput style={styles.input} value={perfilForm.ci} onChangeText={v => setPerfilForm(p => ({ ...p, ci: v }))} placeholder="Ej: 12345678 LP" placeholderTextColor="#9CA3AF" />
            <Text style={styles.fieldLabel}>Edad</Text>
            <TextInput style={styles.input} value={perfilForm.edad} onChangeText={v => setPerfilForm(p => ({ ...p, edad: v }))} placeholder="Ej: 28" placeholderTextColor="#9CA3AF" keyboardType="numeric" />
          </View>

          <View style={styles.seccionCardRepartidor}>
            <Text style={styles.datoCardTitle}>Vehículo</Text>
            <Text style={styles.fieldLabel}>Tipo de vehículo</Text>
            <View style={styles.vehiculoRow}>
              {(['moto', 'bicicleta', 'a pie'] as const).map(tipo => (
                <TouchableOpacity
                  key={tipo}
                  style={[styles.vehiculoBtn, perfilForm.vehiculo_tipo === tipo && styles.vehiculoBtnActivo]}
                  onPress={() => setPerfilForm(p => ({ ...p, vehiculo_tipo: tipo }))}>
                  <Text style={[styles.vehiculoBtnText, perfilForm.vehiculo_tipo === tipo && styles.vehiculoBtnTextActivo]}>
                    {tipo === 'moto' ? '🏍️ Moto' : tipo === 'bicicleta' ? '🚲 Bici' : '🚶 A pie'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {perfilForm.vehiculo_tipo !== 'a pie' && <>
              <Text style={styles.fieldLabel}>Placa del vehículo</Text>
              <TextInput style={styles.input} value={perfilForm.vehiculo_placa} onChangeText={v => setPerfilForm(p => ({ ...p, vehiculo_placa: v }))} placeholder="Ej: 1234-ABC" placeholderTextColor="#9CA3AF" autoCapitalize="characters" />
            </>}
            <Text style={styles.fieldLabel}>Número de licencia de conducir</Text>
            <TextInput style={styles.input} value={perfilForm.licencia} onChangeText={v => setPerfilForm(p => ({ ...p, licencia: v }))} placeholder="Ej: 00123456" placeholderTextColor="#9CA3AF" />
          </View>

          <TouchableOpacity
            style={[styles.btnGuardarPerfil, guardandoPerfil && styles.btnDisabled]}
            onPress={guardarPerfilRepartidor}
            disabled={guardandoPerfil}>
            {guardandoPerfil
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.btnGuardarPerfilText}>💾 Guardar perfil</Text>}
          </TouchableOpacity>

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
  // Estados de carga / error (gate de rol)
  estadoCentradoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F7FF', paddingHorizontal: 32, gap: 8 },
  estadoCentradoEmoji:     { fontSize: 48, marginBottom: 8 },
  estadoCentradoTitulo:    { fontSize: 17, fontWeight: '800', color: '#1E0A3C', textAlign: 'center' },
  estadoCentradoTexto:     { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  retryBtn:                { marginTop: 16, backgroundColor: '#7C3AED', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText:            { color: '#FFF', fontWeight: '700', fontSize: 14 },
  // Repartidor — Mi Panel button
  repartidorBtn:       { marginHorizontal: 16, marginTop: 16, borderRadius: 16, overflow: 'hidden', elevation: 4, shadowColor: '#F97316', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8 },
  repartidorGrad:      { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14 },
  repartidorBtnEmoji:  { fontSize: 30 },
  repartidorBtnTitle:  { color: '#FFF', fontWeight: '800', fontSize: 16 },
  repartidorBtnSub:    { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  repartidorBtnArrow:  { color: '#FFF', fontSize: 28, fontWeight: '300' },
  // Repartidor — Editar perfil
  datoCardTitle:        { fontSize: 14, fontWeight: '700', color: '#1E0A3C', marginBottom: 12 },
  seccionCardRepartidor:{ marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF', borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
  fotoWrapper:          { alignSelf: 'center', marginBottom: 16 },
  fotoCirculo:          { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFF7ED', borderWidth: 3, borderColor: '#F97316', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fotoImg:              { width: 72, height: 72, borderRadius: 36 },
  camaraBadge:          { position: 'absolute', bottom: 0, right: -4, backgroundColor: '#F97316', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  camaraBadgeText:      { fontSize: 11 },
  fieldLabel:           { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 4, marginTop: 10 },
  input:                { backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#111827' },
  vehiculoRow:          { flexDirection: 'row', gap: 8, marginBottom: 4 },
  vehiculoBtn:          { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', alignItems: 'center', backgroundColor: '#F9FAFB' },
  vehiculoBtnActivo:    { borderColor: '#F97316', backgroundColor: '#FFF7ED' },
  vehiculoBtnText:      { fontSize: 12, fontWeight: '600', color: '#9CA3AF' },
  vehiculoBtnTextActivo:{ color: '#EA580C' },
  btnGuardarPerfil:     { marginHorizontal: 16, backgroundColor: '#F97316', borderRadius: 16, padding: 17, alignItems: 'center', marginBottom: 8 },
  btnGuardarPerfilText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  btnDisabled:          { opacity: 0.6 },
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
