-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: columnas necesarias para que validar-comprobante confirme
-- pago en reservas y entradas, no solo en pedidos.
--
-- Hallazgo (FASE 0 del ciclo de boletos): reservas y entradas no tenían
-- numero_transaccion, y entradas tampoco tenía estado_pago (la columna
-- canónica de estado de pago — pago_estado quedó deprecada, ver
-- app/pago.tsx). Sin esto, validar-comprobante no puede confirmar el
-- pago de una reserva/entrada ni detectar reutilización de una misma
-- transacción bancaria.
--
-- Aditivo, no rompe nada existente. Aplicar con (NO usar `supabase db push`):
--   npx supabase db query --linked --file supabase/migrations/20260804000000_pago_multitabla_reservas_entradas.sql
-- ═══════════════════════════════════════════════════════════════════════

-- entradas: le faltaba la columna canónica de estado de pago
ALTER TABLE public.entradas
  ADD COLUMN IF NOT EXISTS estado_pago text NOT NULL DEFAULT 'pendiente'
    CHECK (estado_pago = ANY (ARRAY['pendiente'::text, 'pagado_qr'::text, 'liquidado'::text]));

ALTER TABLE public.entradas
  ADD COLUMN IF NOT EXISTS numero_transaccion text;

ALTER TABLE public.entradas
  ADD COLUMN IF NOT EXISTS intentos_validacion integer NOT NULL DEFAULT 0;

-- reservas: le faltaba numero_transaccion (ya tenía estado_pago)
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS numero_transaccion text;

-- Unicidad por tabla (mismo patrón que pedidos_numero_transaccion_unique).
-- La detección real de reutilización cruzada entre las tres tablas la
-- hace validar-comprobante con un SELECT explícito contra las tres antes
-- de confirmar; este índice es el backstop de carrera dentro de cada
-- tabla, igual que ya funcionaba para pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS reservas_numero_transaccion_unique
  ON public.reservas (numero_transaccion) WHERE (numero_transaccion IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS entradas_numero_transaccion_unique
  ON public.entradas (numero_transaccion) WHERE (numero_transaccion IS NOT NULL);
