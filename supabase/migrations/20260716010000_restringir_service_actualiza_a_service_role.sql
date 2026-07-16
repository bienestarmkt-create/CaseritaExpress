-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Restringir policies service_actualiza_* a TO service_role
-- Tablas: public.pedidos, public.reservas, public.entradas
--
-- Motivo: auditoría de seguridad (2026-07-16) confirmó contra pg_policies
-- en producción que las policies "service_actualiza_pedidos",
-- "service_actualiza_reservas" y "service_actualiza_entradas" están
-- creadas como:
--   FOR UPDATE USING (true)   -- roles: {public}, sin WITH CHECK
--
-- Al no restringir el rol (TO service_role) ni tener WITH CHECK, esta
-- policy aplica a CUALQUIER llamada (incluso anon, sin sesión) y permite
-- reescribir CUALQUIER columna de CUALQUIER fila de pedidos/reservas/
-- entradas — incluyendo pedidos.total, estado, repartidor_id, etc.
-- Como Postgres combina policies permisivas del mismo comando con OR,
-- esta policy además anula todas las demás policies de UPDATE más
-- restrictivas ya existentes en esas tablas.
--
-- El propósito original (dejar que el service_role de los Edge Functions
-- actualice estas tablas) ya se cumple sin esta policy: service_role
-- bypassa RLS por completo, con o sin policies. Restringir a
-- "TO service_role" no cambia el comportamiento de los Edge Functions,
-- solo cierra el acceso indebido de anon/authenticated.
--
-- ⚠️ NO EJECUTAR AUTOMÁTICAMENTE — Álvaro revisa y corre manualmente
-- en el SQL Editor de Supabase (gmfjnzwmfcufgolptaoi) después de este commit.
-- ═══════════════════════════════════════════════════════════════════════

-- ── pedidos ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "service_actualiza_pedidos" ON public.pedidos;
CREATE POLICY "service_actualiza_pedidos"
  ON public.pedidos
  FOR UPDATE
  TO service_role
  USING (true);

-- ── reservas ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "service_actualiza_reservas" ON public.reservas;
CREATE POLICY "service_actualiza_reservas"
  ON public.reservas
  FOR UPDATE
  TO service_role
  USING (true);

-- ── entradas ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "service_actualiza_entradas" ON public.entradas;
CREATE POLICY "service_actualiza_entradas"
  ON public.entradas
  FOR UPDATE
  TO service_role
  USING (true);
