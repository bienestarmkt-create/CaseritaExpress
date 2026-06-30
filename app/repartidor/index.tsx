/**
 * app/repartidor/index.tsx
 * Redirect automático: /repartidor → /repartidor/pedidos
 * El guard de autenticación ya está en _layout.tsx.
 */
import { Redirect } from 'expo-router'

export default function RepartidorIndex() {
  return <Redirect href="/repartidor/pedidos" />
}
