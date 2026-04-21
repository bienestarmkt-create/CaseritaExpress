import { CarritoProvider } from '@/context/CarritoContext';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useCarrito } from '../context/CarritoContext';
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
    if (Platform.OS !== 'web' || typeof window === 'undefined') return

    let cleanupRealtime: (() => void) | undefined

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      await registerServiceWorker()
      await subscribeToPush()
      cleanupRealtime = setupPedidosRealtime(session.user.id)
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      cleanupRealtime?.()
      if (!session?.user) return
      await registerServiceWorker()
      await subscribeToPush()
      cleanupRealtime = setupPedidosRealtime(session.user.id)
    })

    return () => {
      subscription.unsubscribe()
      cleanupRealtime?.()
    }
  }, [])

  return null
}

export default function RootLayout() {
  return (
    <CarritoProvider>
      <PushInitializer />
      <Tabs screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: '#1E0A3C', borderTopColor: '#2D1B4E', height: 65, paddingBottom: 8 }, tabBarActiveTintColor: '#F97316', tabBarInactiveTintColor: '#9CA3AF' }}>
        <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="delivery" options={{ title: 'Delivery', tabBarIcon: ({ color, size }) => <Ionicons name="bicycle-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="stay" options={{ title: 'Stay', tabBarIcon: ({ color, size }) => <Ionicons name="bed-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="eventos" options={{ title: 'Eventos', tabBarIcon: ({ color, size }) => <Ionicons name="musical-notes-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="carrito" options={{ title: 'Carrito', tabBarIcon: ({ color, size }) => <CarritoIcon color={color} size={size} /> }} />
        <Tabs.Screen name="perfil" options={{ title: 'Perfil', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="login" options={{ href: null }} />
        <Tabs.Screen name="anfitrion" options={{ href: null }} />
        <Tabs.Screen name="seguimiento" options={{ href: null }} />
        <Tabs.Screen name="repartidor" options={{ href: null }} />
      </Tabs>
    </CarritoProvider>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#F97316', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
});