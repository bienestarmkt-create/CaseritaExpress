/**
 * app/repartidor/tracking.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel Repartidor — Tracking GPS
 *
 * Pantalla de ESTADO/diagnóstico — ya no dueña de la transmisión. El
 * watch GPS + upsert a `ubicaciones_repartidores` vive ahora en
 * context/TrackingRepartidorContext.tsx, montado en
 * app/repartidor/_layout.tsx (persiste entre pestañas — ver el
 * comentario largo en ese contexto para el porqué: esta pantalla se
 * desmontaba al navegar a "Mapa", que es justamente adonde va un
 * repartidor durante una entrega real, así que la transmisión se
 * cortaba sola). Esta pantalla solo LEE ese estado compartido para
 * mostrar coordenadas, última actualización y errores — el aviso
 * crítico ya no depende de que el repartidor esté parado acá (ver
 * AvisoTrackingGlobal en _layout.tsx).
 * ─────────────────────────────────────────────────────────────
 */

import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTrackingRepartidor } from '../../context/TrackingRepartidorContext'

// ─── Tema ─────────────────────────────────────────────────────
const C = {
  primary:   '#F97316',
  bg:        '#F9FAFB',
  surface:   '#FFFFFF',
  border:    '#F3F4F6',
  text:      '#1E0A3C',
  textLight: '#9CA3AF',
  success:   '#22C55E',
  danger:    '#EF4444',
}

// ─── Componente principal ─────────────────────────────────────
export default function TrackingScreen() {
  const {
    permisoOk, gpsError, lat, lng, ultimaVez, enviando, errorMsg,
    activo, pedidoId, pedidoEstado, pedidoError, reintentarEnvio,
  } = useTrackingRepartidor()

  // ── Permiso pendiente ─────────────────────────────────────
  if (permisoOk === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Verificando permisos de GPS…</Text>
      </View>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Encabezado */}
      <View style={styles.header}>
        <Text style={styles.headerIcon}>📍</Text>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>Tracking GPS</Text>
          <Text style={styles.headerSub}>
            {activo ? 'Transmitiendo ubicación en tiempo real' : 'Transmisión inactiva'}
          </Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: activo ? C.success : C.textLight }]} />
      </View>

      {/* Sin permiso */}
      {!permisoOk && (
        <View style={styles.alertaBanner}>
          <Text style={styles.alertaTitle}>⚠️ Permiso de ubicación denegado</Text>
          <Text style={styles.alertaText}>
            {Platform.OS === 'web'
              ? 'Tocá el ícono de candado/información junto a la URL del navegador y habilitá el permiso de ubicación para este sitio.'
              : 'Debes conceder permiso de ubicación en los ajustes del dispositivo para poder activar el tracking.'}
          </Text>
        </View>
      )}

      {/* GPS sin señal o tiempo agotado (no es un problema de permiso) */}
      {permisoOk && gpsError && gpsError.tipo !== 'denied' && (
        <View style={styles.errorBannerBig}>
          <Text style={styles.errorBannerTitle}>⚠️ Problema obteniendo tu ubicación</Text>
          <Text style={styles.errorBannerText}>{gpsError.mensaje}</Text>
        </View>
      )}

      {/* Error consultando el pedido activo */}
      {permisoOk && pedidoError && (
        <View style={styles.errorBannerBig}>
          <Text style={styles.errorBannerTitle}>⚠️ Error de conexión, reintentando…</Text>
          <Text style={styles.errorBannerText}>
            No se pudo verificar tu pedido activo. Reintentando automáticamente cada 5 segundos.
          </Text>
        </View>
      )}

      {/* Sin pedido activo */}
      {permisoOk && !pedidoError && !pedidoId && (
        <View style={styles.alertaBanner}>
          <Text style={styles.alertaTitle}>⚠️ No tienes un pedido activo</Text>
          <Text style={styles.alertaText}>
            El tracking se activará automáticamente en cuanto tengas un pedido asignado en camino.
          </Text>
        </View>
      )}

      {/* Pedido asignado pero aún no en camino */}
      {permisoOk && !pedidoError && pedidoId && pedidoEstado !== 'en_camino' && (
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerTitle}>🕐 Pedido asignado ({pedidoEstado})</Text>
          <Text style={styles.infoBannerText}>
            El tracking se activará automáticamente cuando el pedido pase a "en camino".
          </Text>
        </View>
      )}

      {/* Indicador de transmisión — automático, no editable */}
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleLeft}>
            <Text style={styles.toggleLabel}>
              {activo ? '🟢 Transmitiendo ubicación ✅' : '⚫ Transmisión inactiva ❌'}
            </Text>
            <Text style={styles.toggleSub}>
              {activo
                ? 'Tu posición se envía automáticamente cada 10 segundos'
                : 'Se activa sola cuando tengas un pedido en camino'
              }
            </Text>
          </View>
          <Switch
            value={activo}
            disabled
            trackColor={{ false: C.border, true: C.primary + '80' }}
            thumbColor={activo ? C.primary : '#ccc'}
          />
        </View>
      </View>

      {/* Coordenadas actuales */}
      {activo && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Posición actual</Text>

          <View style={styles.coordRow}>
            <View style={styles.coordBox}>
              <Text style={styles.coordLabel}>LATITUD</Text>
              <Text style={styles.coordValue}>
                {lat != null ? lat.toFixed(6) : '—'}
              </Text>
            </View>
            <View style={styles.coordDivider} />
            <View style={styles.coordBox}>
              <Text style={styles.coordLabel}>LONGITUD</Text>
              <Text style={styles.coordValue}>
                {lng != null ? lng.toFixed(6) : '—'}
              </Text>
            </View>
          </View>

          {/* Estado envío */}
          <View style={styles.envioRow}>
            {enviando ? (
              <>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.envioText}>Enviando…</Text>
              </>
            ) : ultimaVez ? (
              <>
                <Text style={styles.checkIcon}>✅</Text>
                <Text style={styles.envioText}>
                  Último envío: {ultimaVez.toLocaleTimeString()}
                </Text>
              </>
            ) : (
              <Text style={styles.envioWaiting}>Esperando primera señal GPS…</Text>
            )}
          </View>

          {errorMsg && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{errorMsg}</Text>
              <TouchableOpacity onPress={reintentarEnvio} style={styles.retryBtnSmall} activeOpacity={0.7}>
                <Text style={styles.retryBtnSmallText}>🔄 Reintentar envío</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>ℹ️ ¿Cómo funciona?</Text>
        <Text style={styles.infoText}>
          Cuando aceptas un pedido y lo marcas como "en camino", tu posición GPS se envía automáticamente a la plataforma cada 10 segundos.
          El administrador y el cliente pueden ver tu ubicación en tiempo real para hacer seguimiento de la entrega.
        </Text>
        <Text style={styles.infoText}>
          La transmisión se detiene sola cuando entregas el pedido o cambias de estado.
        </Text>
      </View>
    </ScrollView>
  )
}

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { padding: 16, paddingBottom: 40, gap: 12 },

  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.bg, gap: 12,
  },
  loadingText: { color: C.textLight, fontSize: 14 },

  // Encabezado
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerIcon:  { fontSize: 32 },
  headerBody:  { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  headerSub:   { fontSize: 12, color: C.textLight, marginTop: 2 },
  statusDot:   { width: 10, height: 10, borderRadius: 5 },

  // Alerta (permiso denegado / sin pedido)
  alertaBanner: {
    backgroundColor: '#FEF3C7', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  alertaTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  alertaText:  { fontSize: 13, color: '#92400E', lineHeight: 18 },

  // Info banner (pedido asignado, aún no en camino)
  infoBanner: {
    backgroundColor: '#EFF6FF', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#93C5FD',
  },
  infoBannerTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  infoBannerText:  { fontSize: 13, color: '#1E40AF', lineHeight: 18 },

  // Error banner grande (fallo consultando el pedido activo)
  errorBannerBig: {
    backgroundColor: '#FEE2E2', borderRadius: 10,
    padding: 14, gap: 4,
    borderWidth: 1, borderColor: '#EF4444',
  },
  errorBannerTitle: { fontSize: 14, fontWeight: '700', color: '#991B1B' },
  errorBannerText:  { fontSize: 13, color: '#991B1B', lineHeight: 18 },

  // Cards
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },

  // Toggle (indicador)
  toggleRow:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLeft: { flex: 1 },
  toggleLabel:{ fontSize: 15, fontWeight: '600', color: C.text },
  toggleSub:  { fontSize: 12, color: C.textLight, marginTop: 2 },

  // Coordenadas
  coordRow:     { flexDirection: 'row', gap: 0 },
  coordBox:     { flex: 1, alignItems: 'center', gap: 4 },
  coordDivider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  coordLabel:   {
    fontSize: 10, fontWeight: '700', color: C.textLight,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  coordValue: {
    fontSize: Platform.OS === 'web' ? 16 : 14,
    fontWeight: '700', color: C.text,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },

  // Estado envío
  envioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border,
  },
  checkIcon:    { fontSize: 14 },
  envioText:    { fontSize: 13, color: C.textLight },
  envioWaiting: { fontSize: 13, color: C.textLight, fontStyle: 'italic' },

  // Error
  errorBanner: {
    backgroundColor: '#FEE2E2', borderRadius: 8,
    padding: 10, borderWidth: 1, borderColor: C.danger,
  },
  errorText: { fontSize: 12, color: '#991B1B' },
  retryBtnSmall: {
    marginTop: 8, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: C.danger, borderRadius: 8,
  },
  retryBtnSmallText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Info
  infoCard: {
    backgroundColor: '#EFF6FF', borderRadius: 14,
    padding: 16, gap: 8,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF' },
  infoText:  { fontSize: 13, color: '#1E40AF', lineHeight: 20 },
})
