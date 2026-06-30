/**
 * app/repartidor.tsx
 * ─────────────────────────────────────────────────────────────
 * ARCHIVO DE COMPATIBILIDAD — NO ELIMINAR
 *
 * Expo Router no puede tener simultáneamente `app/repartidor.tsx`
 * y la carpeta `app/repartidor/`. Este archivo se mantiene como
 * redirect automático hacia el nuevo panel modular en `/repartidor/`.
 *
 * El código original del repartidor fue migrado a:
 *   app/repartidor/_layout.tsx   → guard + navegación
 *   app/repartidor/index.tsx     → redirect a /repartidor/pedidos
 *   app/repartidor/pedidos.tsx   → lista de pedidos con Realtime
 *   app/repartidor/mapa.tsx      → mapa de entrega
 *   app/repartidor/tracking.tsx  → tracking GPS continuo
 * ─────────────────────────────────────────────────────────────
 */

import { Redirect } from 'expo-router'

export default function RepartidorLegacy() {
  return <Redirect href="/repartidor/pedidos" />
}
