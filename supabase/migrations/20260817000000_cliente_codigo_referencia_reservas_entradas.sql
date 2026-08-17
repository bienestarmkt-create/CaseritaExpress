-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: permitir que el cliente fije codigo_referencia en su propia
-- reserva/entrada — hoy falla en silencio.
--
-- HALLAZGO (auditoría del flujo de pago Stay/Eventos, 2026-08-17):
-- app/carrito.tsx hace, justo después de insertar la reserva/entrada:
--   await supabase.from('reservas').update({ codigo_referencia: ... }).eq('id', reserva.id)
-- (mismo patrón para entradas, y para pedidos con referencia_pago/codigo_referencia).
-- Ese UPDATE no chequea el error de respuesta. Contra reservas/entradas
-- devuelve 200 OK con 0 filas afectadas (confirmado en producción con el
-- JWT real de un cliente de prueba) — no es un error, RLS simplemente no
-- tiene ninguna policy que permita a `authenticated` actualizar su propia
-- fila en estas dos tablas. Solo existe "service_actualiza_*" (TO
-- service_role, ver 20260716010000_restringir_service_actualiza_a_service_role.sql)
-- y las de SELECT. Esa migración de julio fue una restricción deliberada
-- (cerró un policy `FOR UPDATE USING (true)` peligrosamente abierto a
-- `public`) — este archivo NO la revierte ni la afloja: agrega una policy
-- nueva, acotada, que nunca existió.
--
-- Impacto real hoy: ninguno visible — el chequeo de referencia en
-- validar-comprobante (config_validacion.check_referencia) está
-- desactivado en producción, así que un codigo_referencia ausente no
-- rechaza ni frena ningún pago. Pero si ese flag se activa alguna vez,
-- TODA reserva/entrada quedaría atascada en "revisión" por este gap, no
-- por un problema real del comprobante. Se documenta como hallazgo — NO
-- se aplicó en esta sesión (sin acceso a la CLI de Supabase para
-- correrla ni verificarla en vivo, ver reporte).
--
-- Diseño: en vez de repetir el error de julio (policy de fila sin acotar
-- columnas), se combinan dos mecanismos:
--   1. Policy de RLS: el cliente solo puede tocar su propia fila, y solo
--      mientras sigue pendiente de pago (comprobante_validado = false en
--      la fila ANTES del update — bloquea manipular una reserva ya
--      confirmada).
--   2. GRANT a nivel de COLUMNA: `authenticated` solo tiene permiso de
--      UPDATE sobre la columna codigo_referencia en estas dos tablas —
--      aunque la policy de fila sea permisiva, Postgres igual rechaza
--      cualquier intento de tocar otra columna (total, estado, etc.).
--      Así no se repite el patrón "USING(true) sin restricción real" que
--      motivó la migración de julio.
--
-- ⚠️ Revisar y correr manualmente (mismo criterio que
-- 20260716010000_restringir_service_actualiza_a_service_role.sql) —
-- Álvaro corre esto en el SQL Editor de Supabase (gmfjnzwmfcufgolptaoi)
-- o vía `npx supabase db query --linked --file <este archivo>` cuando la
-- CLI tenga sesión. NO se ejecutó en producción desde esta sesión.
-- ═══════════════════════════════════════════════════════════════════════

-- ── reservas ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_fija_referencia_reserva_pendiente" ON public.reservas;
CREATE POLICY "cliente_fija_referencia_reserva_pendiente"
  ON public.reservas
  FOR UPDATE
  TO authenticated
  USING (cliente_id = auth.uid() AND comprobante_validado = false)
  WITH CHECK (cliente_id = auth.uid());

REVOKE UPDATE ON public.reservas FROM authenticated;
GRANT UPDATE (codigo_referencia) ON public.reservas TO authenticated;

-- ── entradas ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_fija_referencia_entrada_pendiente" ON public.entradas;
CREATE POLICY "cliente_fija_referencia_entrada_pendiente"
  ON public.entradas
  FOR UPDATE
  TO authenticated
  USING (cliente_id = auth.uid() AND comprobante_validado = false)
  WITH CHECK (cliente_id = auth.uid());

REVOKE UPDATE ON public.entradas FROM authenticated;
GRANT UPDATE (codigo_referencia) ON public.entradas TO authenticated;
