import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { BrandColors } from '../constants/theme';

const { width } = Dimensions.get('window');

type UserInfo = { name: string; avatarUrl: string | null };

export default function HomeScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  // 'cargando' = hay sesión y su rol aún no se confirmó; 'error' = /api/get-rol
  // falló tras reintentos; 'repartidor' / 'cliente' = rol confirmado. Arranca en
  // 'cliente' para que el visitante sin sesión vea la vitrina pública de inmediato,
  // sin esperar — el gate de carga solo se activa una vez que resolverSesion()
  // detecta una sesión real. Nunca se cae a 'cliente' por timeout o error.
  const [rolEstado, setRolEstado] = useState<'cargando' | 'error' | 'repartidor' | 'cliente'>('cliente');

  const extractUserInfo = (session: any): UserInfo | null => {
    if (!session?.user) return null;
    const meta = session.user.user_metadata ?? {};
    const name: string =
      meta.full_name ?? meta.name ?? session.user.email?.split('@')[0] ?? 'Usuario';
    const avatarUrl: string | null = meta.avatar_url ?? meta.picture ?? null;
    return { name, avatarUrl };
  };

  // Evita que un await cuelgue para siempre cuando la red se queda muda.
  const conTimeout = <T,>(promesa: PromiseLike<T>, ms: number): Promise<T> => {
    return Promise.race([
      promesa,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms)),
    ]);
  };

  // Misma fuente de verdad que _layout.tsx (/api/get-rol, usa service_role y
  // bypasea RLS) — a diferencia de la query directa anterior a 'usuarios', que
  // quedaba sujeta a RLS y podía fallar en silencio. Nunca devuelve 'cliente'
  // por defecto: si todos los intentos fallan, lanza para que el caller decida.
  const obtenerRol = async (token: string): Promise<string> => {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://www.caseritaexpress.com';

    let ultimoError: any = null;
    for (let intento = 0; intento < 3; intento++) {
      try {
        const res = await conTimeout(
          fetch(`${base}/api/get-rol`, { headers: { Authorization: `Bearer ${token}` } }),
          8000
        );
        if (!res.ok) throw new Error(`get-rol respondió ${res.status}`);
        const json = await res.json();
        return (json.rol as string) ?? 'cliente';
      } catch (e) {
        ultimoError = e;
        if (intento < 2) await new Promise(r => setTimeout(r, 600 * (intento + 1)));
      }
    }
    throw ultimoError;
  };

  const resolverSesion = async (session: any) => {
    setUserInfo(extractUserInfo(session));

    if (!session?.user) {
      // Sin sesión es un dato confirmado (vitrina pública), no un fallback por error.
      setRolEstado('cliente');
      return;
    }

    setRolEstado('cargando');
    try {
      const rol = await obtenerRol(session.access_token);
      setRolEstado(rol === 'repartidor' ? 'repartidor' : 'cliente');
    } catch (e) {
      console.error('[index] Error obteniendo rol:', e);
      setRolEstado('error');
    }
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start();

    supabase.auth.getSession().then(({ data }) => resolverSesion(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolverSesion(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Repartidor confirmado: redirigir a su panel sin mostrar antes la vista de cliente.
  useEffect(() => {
    if (rolEstado === 'repartidor') {
      router.replace('/repartidor' as any);
    }
  }, [rolEstado]);

  // ── CARGANDO / REDIRIGIENDO: nunca mostrar la vitrina de cliente a un repartidor ──
  if (rolEstado === 'cargando' || rolEstado === 'repartidor') {
    return (
      <View style={styles.estadoCentradoContainer}>
        <ActivityIndicator size="large" color="#F97316" />
        <Text style={styles.estadoCentradoTexto}>Cargando...</Text>
      </View>
    );
  }

  // ── ERROR: la verificación de rol falló tras los reintentos ──────────────────
  if (rolEstado === 'error') {
    return (
      <View style={styles.estadoCentradoContainer}>
        <Text style={styles.estadoCentradoEmoji}>⚠️</Text>
        <Text style={styles.estadoCentradoTitulo}>No pudimos verificar tu cuenta</Text>
        <Text style={styles.estadoCentradoTexto}>Revisa tu conexión e intenta de nuevo</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => supabase.auth.getSession().then(({ data }) => resolverSesion(data.session))}>
          <Text style={styles.retryBtnText}>🔄 Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={BrandColors.gradient} style={styles.hero}>
        <Animated.View style={[styles.heroContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* ===== LOGO DE CASERITAEXPRESS ===== */}
          <Image
            source={require('../assets/images/CaseritaExpress.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.brandName}>Caserita Express</Text>
          <Text style={styles.tagline}>Delivery • Stay • Eventos en Bolivia</Text>

          <Animated.View style={[styles.statsRow, { opacity: fadeAnim }]}>
            <View style={styles.stat}><Text style={styles.statNum}>150+</Text><Text style={styles.statLabel}>Aliados</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.stat}><Text style={styles.statNum}>4.8★</Text><Text style={styles.statLabel}>Rating</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.stat}><Text style={styles.statNum}>3</Text><Text style={styles.statLabel}>Ciudades</Text></View>
          </Animated.View>

          {userInfo ? (
            <TouchableOpacity onPress={() => router.push('/perfil')} style={styles.profileBtn}>
              {userInfo.avatarUrl ? (
                <Image source={{ uri: userInfo.avatarUrl }} style={styles.profileAvatar} />
              ) : (
                <View style={styles.profileInitialCircle}>
                  <Text style={styles.profileInitial}>
                    {userInfo.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.profileTextBlock}>
                <Text style={styles.profileGreeting}>Hola,</Text>
                <Text style={styles.profileName} numberOfLines={1}>
                  {userInfo.name.split(' ')[0]}
                </Text>
              </View>
              <View style={styles.profileArrow}>
                <Text style={styles.profileArrowText}>›</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => router.push('/login')} style={styles.loginBtn}>
              <Text style={styles.loginBtnText}>👤 Iniciar Sesión / Registrarse</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </LinearGradient>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>¿Qué necesitas?</Text>

        <TouchableOpacity style={styles.cardPrimary} onPress={() => router.push('/delivery')}>
          <LinearGradient colors={['#F97316', '#EA580C']} style={styles.cardGradient}>
            <Text style={styles.cardIcon}>🚚</Text>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle}>Delivery</Text>
              <Text style={styles.cardDesc}>Comida, farmacias y supermercados</Text>
            </View>
            <Text style={styles.cardArrow}>→</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cardSecondary} onPress={() => router.push('/stay')}>
          <View style={styles.cardInner}>
            <Text style={styles.cardIcon}>🏠</Text>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitleDark}>Caserita Stay</Text>
              <Text style={styles.cardDescDark}>Alojamientos auténticos en Bolivia</Text>
            </View>
            <Text style={styles.cardArrowDark}>→</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cardSecondary} onPress={() => router.push('/eventos')}>
          <View style={styles.cardInner}>
            <Text style={styles.cardIcon}>🎉</Text>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitleDark}>Eventos</Text>
              <Text style={styles.cardDescDark}>Conciertos y cultura local</Text>
            </View>
            <Text style={styles.cardArrowDark}>→</Text>
          </View>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.hostCTA} onPress={() => router.push('/anfitrion')}>
        <LinearGradient colors={BrandColors.gradient} style={styles.hostGradient}>
          <Text style={styles.hostTitle}>¿Tienes un negocio o espacio?</Text>
          <Text style={styles.hostDesc}>Únete como aliado y genera ingresos extra →</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  estadoCentradoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F7FF', paddingHorizontal: 32, gap: 8 },
  estadoCentradoEmoji: { fontSize: 48, marginBottom: 8 },
  estadoCentradoTitulo: { fontSize: 17, fontWeight: '800', color: '#1E0A3C', textAlign: 'center' },
  estadoCentradoTexto: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  retryBtn: { marginTop: 16, backgroundColor: '#F97316', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  hero: { paddingTop: 60, paddingBottom: 30, paddingHorizontal: 24 },
  heroContent: { alignItems: 'center', marginBottom: 30 },
  logoImage: { width: 110, height: 110, borderRadius: 55, marginBottom: 12, borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' },
  brandName: { fontSize: 32, fontWeight: '800', color: '#FFF', textAlign: 'center' },
  tagline: { fontSize: 14, color: BrandColors.onPrimaryMuted, marginTop: 8, textAlign: 'center' },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 16, marginTop: 24, alignItems: 'center' },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  statLabel: { fontSize: 11, color: BrandColors.onPrimaryMuted, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  section: { padding: 24 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#1E0A3C', marginBottom: 16 },
  cardPrimary: { borderRadius: 20, marginBottom: 12, elevation: 4, shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  cardGradient: { borderRadius: 20, padding: 20, flexDirection: 'row', alignItems: 'center' },
  cardSecondary: { borderRadius: 20, marginBottom: 12, backgroundColor: '#FFF', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
  cardInner: { padding: 20, flexDirection: 'row', alignItems: 'center' },
  cardIcon: { fontSize: 32, marginRight: 16 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  cardTitleDark: { fontSize: 18, fontWeight: '700', color: '#1E0A3C' },
  cardDesc: { fontSize: 13, color: '#FED7AA', marginTop: 4 },
  cardDescDark: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  cardArrow: { fontSize: 20, color: '#FFF' },
  cardArrowDark: { fontSize: 20, color: BrandColors.primary },
  hostCTA: { marginHorizontal: 24, borderRadius: 24, overflow: 'hidden' },
  hostGradient: { padding: 24 },
  hostTitle: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  hostDesc: { fontSize: 14, color: BrandColors.onPrimaryMuted, marginTop: 8 },
  loginBtn: { marginHorizontal: 20, marginTop: 16, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  loginBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  profileBtn: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1.5, borderColor: '#F97316', gap: 12 },
  profileAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#F97316' },
  profileInitialCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  profileInitial: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  profileTextBlock: { flex: 1 },
  profileGreeting: { color: '#FED7AA', fontSize: 11, fontWeight: '500' },
  profileName: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  profileArrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  profileArrowText: { color: '#FFF', fontSize: 20, fontWeight: '700', lineHeight: 24 },
});