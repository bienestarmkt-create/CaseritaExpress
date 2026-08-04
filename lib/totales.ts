// lib/totales.ts
// Único lugar donde se deriva el desglose de totales por tipo de
// transacción. Antes el costo de envío estaba hardcodeado y esparcido
// (app/carrito.tsx, app/delivery.tsx) — eso fue lo que permitió que el
// bug de "envío en Stay/Eventos" se reintrodujera. Todo pasa por acá.

import { supabase } from './supabase';

export type TipoTransaccion = 'delivery' | 'stay' | 'evento';

export type Desglose = {
  subtotal: number;
  envio: number | null; // null para stay/evento — nunca 0: un 0 se renderiza como línea de envío
  total: number;
};

// Solo Delivery tiene envío. Stay y Eventos ni siquiera tienen la columna
// en su tabla — esto es la fuente de la verdad en el cliente.
export function tieneEnvio(tipo: TipoTransaccion): boolean {
  return tipo === 'delivery';
}

export function armarDesglose(
  tipo: TipoTransaccion,
  subtotal: number,
  costoEnvio: number | null,
): Desglose {
  const envio = tieneEnvio(tipo) ? (costoEnvio ?? 0) : null;
  return {
    subtotal,
    envio,
    total: subtotal + (envio ?? 0),
  };
}

export type TarifasCiudad = {
  qr:       number | null;
  efectivo: number | null;
};

// Trae las dos tarifas de envío (qr / efectivo) de `ciudades` para la
// ciudad dada — única fuente de verdad, ya no `tarifas_envio` (deprecada
// y eliminada, ver supabase/migrations/20260805000000_tabla_ciudades.sql).
// Si no hay fila para esa ciudad, no inventa un número — devuelve null y
// el llamador decide cómo avisar (nunca un fallback silencioso).
export async function obtenerTarifasEnvio(
  ciudad: string,
): Promise<{ tarifas: TarifasCiudad | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ciudades')
    .select('tarifa_envio_qr, tarifa_envio_efectivo')
    .eq('nombre', ciudad)
    .maybeSingle();

  if (error) {
    console.error('[totales] Error cargando tarifas de envío', ciudad, error.message);
    return { tarifas: null, error: error.message };
  }
  if (!data) {
    console.error('[totales] Ciudad no encontrada en tabla ciudades', ciudad);
    return { tarifas: null, error: `No hay tarifas de envío configuradas para ${ciudad}` };
  }

  return {
    tarifas: {
      qr:       data.tarifa_envio_qr != null ? Number(data.tarifa_envio_qr) : null,
      efectivo: data.tarifa_envio_efectivo != null ? Number(data.tarifa_envio_efectivo) : null,
    },
    error: null,
  };
}

// Atajo para cuando solo hace falta un método de pago (mismo llamado
// que antes tenía app/carrito.tsx, ahora resuelto desde ciudades).
export async function obtenerTarifaEnvio(
  ciudad: string,
  metodoPago: 'qr' | 'efectivo',
): Promise<{ tarifa: number | null; error: string | null }> {
  const { tarifas, error } = await obtenerTarifasEnvio(ciudad);
  if (error || !tarifas) return { tarifa: null, error };
  return { tarifa: metodoPago === 'qr' ? tarifas.qr : tarifas.efectivo, error: null };
}
