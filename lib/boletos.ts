// lib/boletos.ts
// Tipos y helpers compartidos para el sistema de boletos (cierre del
// ciclo de pago en los 3 módulos). Ver supabase/migrations/20260804000100_tabla_boletos.sql.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type TipoBoleto = 'delivery' | 'stay' | 'evento';
export type EstadoBoleto = 'emitido' | 'usado' | 'vencido' | 'anulado';

export type Boleto = {
  id: string;
  codigo: string;
  tipo: TipoBoleto;
  referencia_id: string;
  usuario_id: string;
  comercio_id: string;
  monto: number;
  ciudad: string;
  estado: EstadoBoleto;
  fecha_emision: string;
  fecha_uso: string | null;
  fecha_vencimiento: string | null;
  datos_snapshot: Record<string, any>;
  created_at: string;
};

const CACHE_PREFIX = 'ce_boleto_';

// Cachea localmente cada boleto que se carga con éxito, para que la
// pantalla funcione sin conexión la próxima vez (el cliente puede llegar
// al evento sin datos móviles).
export async function cachearBoleto(boleto: Boleto): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + boleto.codigo, JSON.stringify(boleto));
  } catch {
    // Cache es best-effort: si falla, la pantalla igual funcionó con datos de red.
  }
}

export async function leerBoletoCacheado(codigo: string): Promise<Boleto | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + codigo);
    return raw ? (JSON.parse(raw) as Boleto) : null;
  } catch {
    return null;
  }
}

// Trae el boleto de red y lo cachea; si la red falla, cae al caché local.
// Devuelve también de dónde salió el dato, para que la UI pueda avisar
// "estás viendo la última copia guardada" en vez de fallar en silencio.
export async function obtenerBoleto(
  codigo: string,
): Promise<{ boleto: Boleto | null; fuente: 'red' | 'cache' | 'ninguna'; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('boletos')
      .select('*')
      .eq('codigo', codigo)
      .maybeSingle();

    if (error) {
      const cacheado = await leerBoletoCacheado(codigo);
      if (cacheado) return { boleto: cacheado, fuente: 'cache', error: error.message };
      return { boleto: null, fuente: 'ninguna', error: error.message };
    }

    if (data) {
      await cachearBoleto(data as Boleto);
      return { boleto: data as Boleto, fuente: 'red', error: null };
    }

    const cacheado = await leerBoletoCacheado(codigo);
    return { boleto: cacheado, fuente: cacheado ? 'cache' : 'ninguna', error: cacheado ? null : 'Boleto no encontrado' };
  } catch (e: any) {
    // Sin conexión: el fetch mismo tira (no es un error de Supabase, es de red).
    const cacheado = await leerBoletoCacheado(codigo);
    if (cacheado) return { boleto: cacheado, fuente: 'cache', error: null };
    return { boleto: null, fuente: 'ninguna', error: e?.message ?? 'Sin conexión y sin copia local' };
  }
}

export const TIPO_LABEL: Record<TipoBoleto, string> = {
  delivery: '🍔 Delivery',
  stay:     '🏡 Stay',
  evento:   '🎉 Evento',
};

export const ESTADO_LABEL: Record<EstadoBoleto, string> = {
  emitido: 'Válido',
  usado:   'Usado',
  vencido: 'Vencido',
  anulado: 'Anulado',
};
