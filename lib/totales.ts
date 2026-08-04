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

// Trae la tarifa de envío real de tarifas_envio para la ciudad dada. Si
// no hay fila para esa ciudad, no inventa un número — devuelve null y el
// llamador decide cómo avisar (nunca un fallback silencioso a un valor
// hardcodeado).
export async function obtenerTarifaEnvio(
  ciudad: string,
  metodoPago: 'qr' | 'efectivo',
): Promise<{ tarifa: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from('tarifas_envio')
    .select('tarifa_qr, tarifa_efectivo')
    .eq('ciudad', ciudad)
    .maybeSingle();

  if (error) {
    console.error('[totales] Error cargando tarifa de envío', ciudad, error.message);
    return { tarifa: null, error: error.message };
  }
  if (!data) {
    console.error('[totales] Sin tarifa de envío configurada para', ciudad);
    return { tarifa: null, error: `No hay tarifa de envío configurada para ${ciudad}` };
  }

  const tarifa = metodoPago === 'qr' ? Number(data.tarifa_qr) : Number(data.tarifa_efectivo);
  return { tarifa, error: null };
}
