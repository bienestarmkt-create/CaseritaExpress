/**
 * app/admin/index.tsx
 * ─────────────────────────────────────────────────────────────
 * Redirect inmediato de /admin → /admin/pedidos.
 * El guard de autenticación ya está en _layout.tsx.
 * ─────────────────────────────────────────────────────────────
 */

import { Redirect } from 'expo-router'

export default function AdminIndex() {
  return <Redirect href="/admin/pedidos" />
}
