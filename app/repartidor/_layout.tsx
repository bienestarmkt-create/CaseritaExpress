/**
 * app/repartidor/_layout.tsx
 * ─────────────────────────────────────────────────────────────
 * Layout protegido del Panel Repartidor de CaseritaExpress.
 *
 * Sigue el mismo patrón de guard que app/admin/_layout.tsx:
 *  1. Verifica autenticación y rol 'repartidor' vía tabla profiles.
 *  2. Redirige a '/' si no tiene permiso.
 *  3. Navegación lateral en web, barra inferior en móvil.
 *
 * Colores: tema naranja (#F97316) del repartidor existente.
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Slot, usePathname, useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

// ─── Tema (colores del repartidor existente) ─────────────────
const C = {
  primary:      '#F97316',
  primaryDark:  '#EA580C',
  bg:           '#F9FAFB',
  surface:      '#FFFFFF',
  border:       '#F3F4F6',
  text:         '#1E0A3C',
  textLight:    '#9CA3AF',
  tabActive:    '#F97316',
  tabInactive:  '#9CA3AF',
  sidebar:      '#1E0A3C',
  sidebarText:  '#FFFFFF',
  sidebarSub:   '#A0AEC0',
  sidebarActive:'#F97316',
}

// ─── Tabs de navegación ───────────────────────────────────────
const NAV_TABS = [
  { label: 'Mis pedidos',  route: '/repartidor/pedidos',  icon: '📦', mobileLabel: 'Pedidos'  },
  { label: 'Mapa',         route: '/repartidor/mapa',     icon: '🗺️', mobileLabel: 'Mapa'     },
  { label: 'Tracking GPS', route: '/repartidor/tracking', icon: '📍', mobileLabel: 'GPS'      },
] as const

export default function RepartidorLayout() {
  const router   = useRouter()
  const pathname = usePathname()

  const [loading,    setLoading]    = useState(true)
  const [autorizado, setAutorizado] = useState(false)
  const [nombre,     setNombre]     = useState('')

  // ── Guard: mismo patrón que admin/_layout.tsx ─────────────
  const checkAccess = useCallback(async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) { router.replace('/'); return }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('rol, nombre')
        .eq('id', user.id)
        .single()

      if (profileError || profile?.rol !== 'repartidor') {
        router.replace('/')
        return
      }

      setNombre(profile.nombre ?? user.email ?? 'Repartidor')
      setAutorizado(true)
    } catch {
      router.replace('/')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { checkAccess() }, [checkAccess])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  // ── Cargando ───────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Verificando acceso…</Text>
      </View>
    )
  }

  if (!autorizado) return null  // redirect en curso

  // ── Web: sidebar lateral ───────────────────────────────────
  if (Platform.OS === 'web') {
    return (
      <View style={styles.webContainer}>
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarLogo}>🏍️</Text>
            <Text style={styles.sidebarTitle}>CaseritaExpress</Text>
            <Text style={styles.sidebarSubtitle}>Panel Repartidor</Text>
          </View>

          <ScrollView style={styles.sidebarNav} showsVerticalScrollIndicator={false}>
            {NAV_TABS.map(tab => {
              const active = pathname === tab.route
              return (
                <TouchableOpacity
                  key={tab.route}
                  style={[styles.sidebarTab, active && styles.sidebarTabActive]}
                  onPress={() => router.push(tab.route as any)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sidebarTabIcon}>{tab.icon}</Text>
                  <Text style={[styles.sidebarTabLabel, active && styles.sidebarTabLabelActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          <View style={styles.sidebarFooter}>
            <Text style={styles.sidebarName} numberOfLines={1}>🏍️ {nombre}</Text>
            <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
              <Text style={styles.signOutText}>Cerrar sesión</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.webContent}>
          <Slot />
        </View>
      </View>
    )
  }

  // ── Móvil: barra inferior ──────────────────────────────────
  return (
    <SafeAreaView style={styles.mobileContainer}>
      <View style={styles.mobileHeader}>
        <Text style={styles.mobileHeaderLogo}>🏍️</Text>
        <Text style={styles.mobileHeaderTitle}>Mis Entregas</Text>
        <Text style={styles.mobileHeaderName} numberOfLines={1}>{nombre}</Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.mobileSignOut}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mobileContent}>
        <Slot />
      </View>

      <View style={styles.bottomBar}>
        {NAV_TABS.map(tab => {
          const active = pathname === tab.route
          return (
            <TouchableOpacity
              key={tab.route}
              style={styles.bottomTab}
              onPress={() => router.push(tab.route as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.bottomTabIcon}>{tab.icon}</Text>
              <Text style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]}>
                {tab.mobileLabel}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </SafeAreaView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.bg, gap: 12,
  },
  loadingText: { color: C.textLight, fontSize: 14 },

  // Web
  webContainer:  { flex: 1, flexDirection: 'row', backgroundColor: C.bg },
  sidebar:       { width: 220, backgroundColor: C.sidebar, flexDirection: 'column' },
  sidebarHeader: {
    paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', alignItems: 'flex-start',
  },
  sidebarLogo:     { fontSize: 28, marginBottom: 6 },
  sidebarTitle:    { color: C.sidebarText, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  sidebarSubtitle: { color: C.sidebarSub, fontSize: 12, marginTop: 2 },
  sidebarNav:      { flex: 1, paddingVertical: 12, paddingHorizontal: 8 },
  sidebarTab: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, marginBottom: 4, gap: 10,
  },
  sidebarTabActive:      { backgroundColor: C.sidebarActive },
  sidebarTabIcon:        { fontSize: 18 },
  sidebarTabLabel:       { color: C.sidebarSub, fontSize: 14, fontWeight: '500' },
  sidebarTabLabelActive: { color: C.sidebarText, fontWeight: '700' },
  sidebarFooter: {
    padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 8,
  },
  sidebarName: { color: C.sidebarSub, fontSize: 13 },
  signOutBtn:  {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center',
  },
  signOutText: { color: C.sidebarText, fontSize: 13, fontWeight: '600' },
  webContent:  { flex: 1, backgroundColor: C.bg, overflow: 'hidden' as any },

  // Móvil
  mobileContainer: { flex: 1, backgroundColor: C.bg },
  mobileHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.sidebar, gap: 8,
  },
  mobileHeaderLogo:  { fontSize: 18 },
  mobileHeaderTitle: { color: C.sidebarText, fontSize: 15, fontWeight: '700' },
  mobileHeaderName:  { flex: 1, color: C.sidebarSub, fontSize: 12 },
  mobileSignOut:     { color: C.primary, fontSize: 13, fontWeight: '600' },
  mobileContent:     { flex: 1 },
  bottomBar: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8, paddingTop: 8,
  },
  bottomTab:           { flex: 1, alignItems: 'center', gap: 2 },
  bottomTabIcon:       { fontSize: 20 },
  bottomTabLabel:      { fontSize: 10, color: C.tabInactive, fontWeight: '500' },
  bottomTabLabelActive:{ color: C.tabActive, fontWeight: '700' },
})
