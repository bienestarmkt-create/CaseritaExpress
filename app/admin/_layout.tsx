/**
 * app/admin/_layout.tsx
 * ─────────────────────────────────────────────────────────────
 * Layout protegido del Panel Admin de CaseritaExpress.
 *
 * Responsabilidades:
 *  1. Verificar que el usuario esté autenticado y tenga rol 'admin'.
 *  2. Redirigir a '/' si no tiene permiso.
 *  3. Renderizar la navegación lateral (web) o inferior (móvil).
 *
 * Ajusta COLORS si tu proyecto tiene un tema centralizado.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  SafeAreaView,
} from 'react-native'
import { Slot, useRouter, usePathname } from 'expo-router'
import { supabase } from '../../lib/supabase' // ← ajusta la ruta si difiere

// ─── Tema ────────────────────────────────────────────────────
// Reemplaza estos valores con los colores de tu proyecto.
const COLORS = {
  primary:    '#E63946',  // rojo CaseritaExpress
  primaryDark:'#C1121F',
  bg:         '#F8F9FA',
  surface:    '#FFFFFF',
  border:     '#E9ECEF',
  text:       '#212529',
  textLight:  '#6C757D',
  tabActive:  '#E63946',
  tabInactive:'#6C757D',
  sidebar:    '#1A1A2E',
  sidebarText:'#FFFFFF',
  sidebarSub: '#A0AEC0',
  sidebarActive: '#E63946',
}

// ─── Tipos ───────────────────────────────────────────────────
type NavTab = {
  label:  string
  route:  `/admin/${string}` | '/admin/pedidos'
  icon:   string
  mobileIcon: string
}

const NAV_TABS: NavTab[] = [
  { label: 'Pedidos activos', route: '/admin/pedidos',      icon: '📦', mobileIcon: '📦' },
  { label: 'Negocios',        route: '/admin/negocios',     icon: '🏪', mobileIcon: '🏪' },
  { label: 'Usuarios',        route: '/admin/usuarios',     icon: '👥', mobileIcon: '👥' },
  { label: 'Estadísticas',    route: '/admin/estadisticas', icon: '📊', mobileIcon: '📊' },
]

// ─── Componente principal ─────────────────────────────────────
export default function AdminLayout() {
  const router   = useRouter()
  const pathname = usePathname()

  const [loading,  setLoading]  = useState(true)
  const [isAdmin,  setIsAdmin]  = useState(false)
  const [adminName, setAdminName] = useState('')

  // ── Verificar acceso admin ─────────────────────────────────
  const checkAccess = useCallback(async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        router.replace('/')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('rol, nombre')
        .eq('id', user.id)
        .single()

      if (profileError || profile?.rol !== 'admin') {
        router.replace('/')
        return
      }

      setAdminName(profile.nombre ?? user.email ?? 'Admin')
      setIsAdmin(true)
    } catch {
      router.replace('/')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    checkAccess()
  }, [checkAccess])

  // ── Cerrar sesión ──────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  // ── Estados de carga / no autorizado ──────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Verificando acceso…</Text>
      </View>
    )
  }

  if (!isAdmin) return null  // La redirección ya está en curso

  // ── Layout web: sidebar lateral ────────────────────────────
  if (Platform.OS === 'web') {
    return (
      <View style={styles.webContainer}>
        {/* Sidebar */}
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarLogo}>🛵</Text>
            <Text style={styles.sidebarTitle}>CaseritaExpress</Text>
            <Text style={styles.sidebarSubtitle}>Panel Admin</Text>
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
            <Text style={styles.sidebarAdminName} numberOfLines={1}>
              👤 {adminName}
            </Text>
            <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
              <Text style={styles.signOutText}>Cerrar sesión</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Contenido principal */}
        <View style={styles.webContent}>
          <Slot />
        </View>
      </View>
    )
  }

  // ── Layout móvil: barra inferior ───────────────────────────
  return (
    <SafeAreaView style={styles.mobileContainer}>
      <View style={styles.mobileHeader}>
        <Text style={styles.mobileHeaderTitle}>🛵 Admin</Text>
        <Text style={styles.mobileHeaderName} numberOfLines={1}>{adminName}</Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.mobileSignOut}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mobileContent}>
        <Slot />
      </View>

      {/* Bottom Tab Bar */}
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
              <Text style={styles.bottomTabIcon}>{tab.mobileIcon}</Text>
              <Text style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]}>
                {tab.label.split(' ')[0]}
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
  // Pantalla de carga
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    gap: 12,
  },
  loadingText: {
    color: COLORS.textLight,
    fontSize: 14,
  },

  // ── Web ──────────────────────────────────────────────────
  webContainer: {
    flex:           1,
    flexDirection:  'row',
    backgroundColor: COLORS.bg,
  },

  // Sidebar
  sidebar: {
    width:           240,
    backgroundColor: COLORS.sidebar,
    flexDirection:   'column',
  },
  sidebarHeader: {
    paddingHorizontal: 20,
    paddingTop:        32,
    paddingBottom:     24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    alignItems:        'flex-start',
  },
  sidebarLogo: {
    fontSize:     28,
    marginBottom: 6,
  },
  sidebarTitle: {
    color:        COLORS.sidebarText,
    fontSize:     16,
    fontWeight:   '700',
    letterSpacing: 0.3,
  },
  sidebarSubtitle: {
    color:     COLORS.sidebarSub,
    fontSize:  12,
    marginTop: 2,
  },
  sidebarNav: {
    flex:             1,
    paddingVertical:  12,
    paddingHorizontal: 8,
  },
  sidebarTab: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius:   10,
    marginBottom:   4,
    gap:            10,
  },
  sidebarTabActive: {
    backgroundColor: COLORS.sidebarActive,
  },
  sidebarTabIcon: {
    fontSize: 18,
  },
  sidebarTabLabel: {
    color:      COLORS.sidebarSub,
    fontSize:   14,
    fontWeight: '500',
  },
  sidebarTabLabelActive: {
    color:      COLORS.sidebarText,
    fontWeight: '700',
  },
  sidebarFooter: {
    padding:           16,
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,255,255,0.1)',
    gap:               8,
  },
  sidebarAdminName: {
    color:    COLORS.sidebarSub,
    fontSize: 13,
  },
  signOutBtn: {
    paddingVertical:   8,
    paddingHorizontal: 12,
    borderRadius:      8,
    backgroundColor:   'rgba(255,255,255,0.1)',
    alignItems:        'center',
  },
  signOutText: {
    color:      COLORS.sidebarText,
    fontSize:   13,
    fontWeight: '600',
  },

  // Contenido web
  webContent: {
    flex:             1,
    backgroundColor:  COLORS.bg,
    overflow:         'hidden' as any,
  },

  // ── Móvil ────────────────────────────────────────────────
  mobileContainer: {
    flex:            1,
    backgroundColor: COLORS.bg,
  },
  mobileHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   12,
    backgroundColor:   COLORS.sidebar,
    gap:               8,
  },
  mobileHeaderTitle: {
    color:      COLORS.sidebarText,
    fontSize:   16,
    fontWeight: '700',
  },
  mobileHeaderName: {
    flex:     1,
    color:    COLORS.sidebarSub,
    fontSize: 13,
  },
  mobileSignOut: {
    color:      COLORS.primary,
    fontSize:   13,
    fontWeight: '600',
  },
  mobileContent: {
    flex: 1,
  },
  bottomBar: {
    flexDirection:    'row',
    backgroundColor:  COLORS.surface,
    borderTopWidth:   1,
    borderTopColor:   COLORS.border,
    paddingBottom:    Platform.OS === 'ios' ? 20 : 8,
    paddingTop:       8,
  },
  bottomTab: {
    flex:        1,
    alignItems:  'center',
    gap:         2,
  },
  bottomTabIcon: {
    fontSize: 20,
  },
  bottomTabLabel: {
    fontSize:   10,
    color:      COLORS.tabInactive,
    fontWeight: '500',
  },
  bottomTabLabelActive: {
    color:      COLORS.tabActive,
    fontWeight: '700',
  },
})
