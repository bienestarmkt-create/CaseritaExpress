import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [form, setForm] = useState({ nombre: '', email: '', password: '', telefono: '' });
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [exitoMsg, setExitoMsg] = useState('');

  const actualizar = (campo: string, valor: string) => {
    setForm({ ...form, [campo]: valor });
    setErrorMsg('');
    setExitoMsg('');
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    setExitoMsg('');

    if (!form.email || !form.password) {
      setErrorMsg('Por favor completa el correo y la contraseña');
      return;
    }
    if (modo === 'registro' && !form.nombre) {
      setErrorMsg('Por favor ingresa tu nombre completo');
      return;
    }
    if (form.password.length < 6) {
      setErrorMsg('La contraseña debe tener mínimo 6 caracteres');
      return;
    }

    setCargando(true);

    if (modo === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      if (error) {
        setErrorMsg('Correo o contraseña incorrectos. Intenta de nuevo.');
      } else {
        setExitoMsg('¡Bienvenido! Iniciando sesión...');
        setTimeout(() => router.push('/'), 1000);
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { nombre: form.nombre, telefono: form.telefono } },
      });
      if (error) {
        if (error.message.includes('already registered')) {
          setErrorMsg('Este correo ya está registrado. Intenta iniciar sesión.');
        } else {
          setErrorMsg('Error al crear la cuenta. Intenta de nuevo.');
        }
      } else {
        if (data.user) {
          await supabase.from('usuarios').insert({
            id: data.user.id,
            nombre: form.nombre,
            email: form.email.trim(),
            telefono: form.telefono,
          });
        }
        setExitoMsg('¡Cuenta creada! Redirigiendo...');
        setTimeout(() => router.push('/'), 1000);
      }
    }
    setCargando(false);
  };

  const handleGoogle = async () => {
    setCargando(true);
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:8082',
      },
    });
    if (error) setErrorMsg('Error al iniciar sesión con Google.');
    setCargando(false);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#6B21A8', '#4C1D95', '#1E0A3C']} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Volver</Text>
          </TouchableOpacity>
          <Text style={styles.logoEmoji}>🏠</Text>
          <Text style={styles.brandName}>Caserita Express</Text>
          <Text style={styles.headerSub}>Tu plataforma boliviana de confianza</Text>
          <View style={styles.tabRow}>
            <TouchableOpacity onPress={() => { setModo('login'); setErrorMsg(''); setExitoMsg(''); }} style={[styles.tab, modo === 'login' && styles.tabActivo]}>
              <Text style={[styles.tabText, modo === 'login' && styles.tabTextActivo]}>Iniciar Sesión</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setModo('registro'); setErrorMsg(''); setExitoMsg(''); }} style={[styles.tab, modo === 'registro' && styles.tabActivo]}>
              <Text style={[styles.tabText, modo === 'registro' && styles.tabTextActivo]}>Registrarse</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.form}>
          {errorMsg !== '' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}
          {exitoMsg !== '' && (
            <View style={styles.exitoBox}>
              <Text style={styles.exitoText}>✅ {exitoMsg}</Text>
            </View>
          )}

          {/* BOTÓN GOOGLE */}
          <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle} disabled={cargando}>
            <Text style={styles.googleEmoji}>🇬</Text>
            <Text style={styles.googleText}>Continuar con Google</Text>
          </TouchableOpacity>

          <View style={styles.divisorRow}>
            <View style={styles.divisorLine} />
            <Text style={styles.divisorText}>o continúa con email</Text>
            <View style={styles.divisorLine} />
          </View>

          {modo === 'registro' && (
            <>
              <Text style={styles.label}>Nombre completo</Text>
              <View style={styles.inputRow}>
                <Text style={styles.inputIcon}>👤</Text>
                <TextInput style={styles.input} placeholder="Ej: María García" value={form.nombre} onChangeText={v => actualizar('nombre', v)} />
              </View>
            </>
          )}

          <Text style={styles.label}>Correo electrónico</Text>
          <View style={styles.inputRow}>
            <Text style={styles.inputIcon}>✉️</Text>
            <TextInput style={styles.input} placeholder="tu@correo.com" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={v => actualizar('email', v)} />
          </View>

          {modo === 'registro' && (
            <>
              <Text style={styles.label}>WhatsApp</Text>
              <View style={styles.inputRow}>
                <Text style={styles.inputIcon}>📱</Text>
                <TextInput style={styles.input} placeholder="Ej: 59176543210" keyboardType="phone-pad" value={form.telefono} onChangeText={v => actualizar('telefono', v)} />
              </View>
            </>
          )}

          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.inputRow}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput style={styles.input} placeholder="Mínimo 6 caracteres" secureTextEntry value={form.password} onChangeText={v => actualizar('password', v)} />
          </View>

          {modo === 'login' && (
            <TouchableOpacity style={styles.forgotBtn}>
              <Text style={styles.forgotText}>¿Olvidaste tu contraseña?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.submitBtn, cargando && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={cargando}>
            <LinearGradient colors={cargando ? ['#9CA3AF', '#6B7280'] : ['#6B21A8', '#4C1D95']} style={styles.submitGradient}>
              <Text style={styles.submitText}>
                {cargando ? '⏳ Procesando...' : modo === 'login' ? '🚀 Iniciar Sesión' : '✅ Crear mi cuenta'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{modo === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}</Text>
            <TouchableOpacity onPress={() => { setModo(modo === 'login' ? 'registro' : 'login'); setErrorMsg(''); setExitoMsg(''); }}>
              <Text style={styles.switchLink}>{modo === 'login' ? 'Regístrate gratis' : 'Inicia sesión'}</Text>
            </TouchableOpacity>
          </View>

          {modo === 'registro' && (
            <Text style={styles.terminos}>Al registrarte aceptas nuestros Términos de Uso y Política de Privacidad de CaseritaExpress</Text>
          )}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  header: { paddingTop: 55, paddingBottom: 0, paddingHorizontal: 24 },
  backBtn: { marginBottom: 16 },
  backText: { color: '#DDD6FE', fontSize: 14 },
  logoEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  brandName: { fontSize: 28, fontWeight: '800', color: '#FFF', textAlign: 'center' },
  headerSub: { fontSize: 13, color: '#C4B5FD', textAlign: 'center', marginTop: 6, marginBottom: 24 },
  tabRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  tabActivo: { backgroundColor: '#FFF' },
  tabText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  tabTextActivo: { color: '#6B21A8', fontWeight: '800' },
  form: { padding: 24 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' },
  errorText: { color: '#DC2626', fontSize: 14, fontWeight: '600' },
  exitoBox: { backgroundColor: '#D1FAE5', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#A7F3D0' },
  exitoText: { color: '#065F46', fontSize: 14, fontWeight: '600' },
  googleBtn: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 14, padding: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB', gap: 10, marginBottom: 8 },
  googleEmoji: { fontSize: 22 },
  googleText: { fontSize: 16, fontWeight: '700', color: '#374151' },
  divisorRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  divisorLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  divisorText: { fontSize: 13, color: '#9CA3AF', marginHorizontal: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 16 },
  inputRow: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  inputIcon: { fontSize: 18, marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: '#1E0A3C' },
  forgotBtn: { alignSelf: 'flex-end', marginTop: 8 },
  forgotText: { fontSize: 13, color: '#6B21A8', fontWeight: '600' },
  submitBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.7 },
  submitGradient: { padding: 18, alignItems: 'center' },
  submitText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  switchText: { fontSize: 14, color: '#6B7280' },
  switchLink: { fontSize: 14, color: '#6B21A8', fontWeight: '700' },
  terminos: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 16, lineHeight: 18 },
});