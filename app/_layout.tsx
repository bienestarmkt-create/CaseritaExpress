import { CarritoProvider } from '@/context/CarritoContext';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
import { registerPushToken } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { registerServiceWorker, setupPedidosRealtime, subscribeToPush } from '../lib/usePush';

function CarritoBadge() {
  const { totalItems } = useCarrito();
  if (totalItems === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{totalItems}</Text>
    </View>
  );
}

function CarritoIcon({ color, size }: { color: string; size: number }) {
  return (
    <View>
      <Ionicons name="cart-outline" size={size} color={color} />
      <CarritoBadge />
    </View>
  );
}

function PushInitializer() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    let cleanupRealtime: (() => void) | undefined;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      await registerServiceWorker();
      await subscribeToPush();
      cleanupRealtime = setupPedidosRealtime(session.user.id);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      cleanupRealtime?.();
      if (!session?.user) return;
      await registerServiceWorker();
      await subscribeToPush();
      cleanupRealtime = setupPedidosRealtime(session.user.id);
    });

    return () => {
      subscription.unsubscribe();
      cleanupRealtime?.();
    };
  }, []);

  return null;
}

async function getRol(token: string): Promise<string> {
  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://www.caseritaexpress.com';
    const res = await fetch(`${base}/api/get-rol`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return 'cliente';
    const json = await res.json();
    return (json.rol as string) ?? 'cliente';
  } catch {
    return 'cliente';
  }
}

export default function RootLayout() {
  const router = useRouter();
  // undefined = cargando | null = sin sesión | string = rol confirmado
  const [rol, setRol] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // Carga inicial
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setRol(null); return; }
      const r = await getRol(session.access_token);
      setRol(r);
      // Registrar push token (falla silenciosamente si no hay permisos o expo-notifications no instalado)
      registerPushToken().catch(() => {});
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setRol(null);
        router.replace('/login');
        return;
      }
      if (event === 'SIGNED_IN' && session) {
        const r = await getRol(session.access_token);
        setRol(r);
        // Registrar push token al iniciar sesión (falla silenciosamente)
        registerPushToken().catch(() => {});
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Spinner mientras se resuelve el rol
  if (rol === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1E0A3C', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    );
  }

  const esRepartidor = rol === 'repartidor';
  const esAdmin      = rol === 'admin';

  return (
    <CarritoProvider>
      <PushInitializer />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: '#1E0A3C', borderTopColor: '#2D1B4E', height: 65, paddingBottom: 8 },
          tabBarActiveTintColor: '#F97316',
          tabBarInactiveTintColor: '#9CA3AF',
        }}
      >
        {/* Siempre visible */}
        <Tabs.Screen
          name="index"
          options={{ title: 'Inicio', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
        />

        {/* Solo clientes */}
        <Tabs.Screen name="delivery" options={{ title: 'Delivery', href: esRepartidor ? null : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="bicycle-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="stay"     options={{ title: 'Stay',     href: esRepartidor ? null : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="bed-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="eventos"  options={{ title: 'Eventos',  href: esRepartidor ? null : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="musical-notes-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="carrito"  options={{ title: 'Carrito',  href: esRepartidor ? null : undefined, tabBarIcon: ({ color, size }) => <CarritoIcon color={color} size={size} /> }} />

        {/* Solo repartidores */}
        <Tabs.Screen
          name="repartidor"
          options={{ title: 'Mis Entregas', href: esRepartidor ? undefined : null, tabBarIcon: ({ color, size }) => <Ionicons name="bicycle-outline" size={size} color={color} /> }}
        />

        {/* Siempre visible */}
        <Tabs.Screen
          name="perfil"
          options={{ title: 'Perfil', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }}
        />

        {/* Solo admins */}
        <Tabs.Screen
          name="admin"
          options={{ title: 'Admin', href: esAdmin ? undefined : null, tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} /> }}
        />

        {/* Pantallas sin tab */}
        <Tabs.Screen name="login"       options={{ href: null }} />
        <Tabs.Screen name="anfitrion"   options={{ href: null }} />
        <Tabs.Screen name="negocio"     options={{ href: null }} />
        <Tabs.Screen name="seguimiento" options={{ href: null }} />
        <Tabs.Screen name="pago"        options={{ href: null }} />
        <Tabs.Screen name="pago-qr"     options={{ href: null }} />
        <Tabs.Screen name="mi-ticket"   options={{ href: null }} />
        <Tabs.Screen name="mi-reserva"  options={{ href: null }} />
      </Tabs>
    </CarritoProvider>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#F97316', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
});
