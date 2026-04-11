import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={['#6B21A8', '#4C1D95', '#1E0A3C']} style={styles.hero}>
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

          <TouchableOpacity onPress={() => router.push('/login')} style={styles.loginBtn}>
            <Text style={styles.loginBtnText}>👤 Iniciar Sesión / Registrarse</Text>
          </TouchableOpacity>
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
        <LinearGradient colors={['#6B21A8', '#4C1D95']} style={styles.hostGradient}>
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
  hero: { paddingTop: 60, paddingBottom: 30, paddingHorizontal: 24 },
  heroContent: { alignItems: 'center', marginBottom: 30 },
  logoImage: { width: 110, height: 110, borderRadius: 55, marginBottom: 12, borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' },
  brandName: { fontSize: 32, fontWeight: '800', color: '#FFF', textAlign: 'center' },
  tagline: { fontSize: 14, color: '#DDD6FE', marginTop: 8, textAlign: 'center' },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 16, marginTop: 24, alignItems: 'center' },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  statLabel: { fontSize: 11, color: '#C4B5FD', marginTop: 2 },
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
  cardArrowDark: { fontSize: 20, color: '#6B21A8' },
  hostCTA: { marginHorizontal: 24, borderRadius: 24, overflow: 'hidden' },
  hostGradient: { padding: 24 },
  hostTitle: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  hostDesc: { fontSize: 14, color: '#DDD6FE', marginTop: 8 },
  loginBtn: { marginHorizontal: 20, marginTop: 16, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  loginBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});