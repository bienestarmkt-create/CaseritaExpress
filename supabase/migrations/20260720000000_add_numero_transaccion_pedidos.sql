-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: numero_transaccion en pedidos + índice único parcial
--
-- Motivo: hallazgo en prueba real de pago (2026-07-20) — el chequeo de
-- comprobantes duplicados por comprobante_url no detecta un comprobante
-- RESUBIDO, porque cada subida a Storage genera un path/URL nuevo aunque
-- sea la misma transferencia bancaria reutilizada en otro pedido.
--
-- validar-comprobante ahora extrae el número de transacción del
-- comprobante vía Claude Vision (campo "Transacción N°" en ALTOKE/
-- BancoSol) y lo guarda acá al confirmar el pago. El índice único parcial
-- es el backstop a nivel de base de datos: aunque el chequeo de la
-- función falle o haya una carrera entre dos requests simultáneos, dos
-- pedidos confirmados nunca pueden terminar con el mismo número de
-- transacción.
--
-- Se ignoran los NULL (WHERE numero_transaccion IS NOT NULL) porque el
-- campo solo se completa cuando el comprobante fue validado con éxito
-- (ver validar-comprobante/index.ts) — pedidos sin pago confirmado no
-- deben competir por unicidad.
--
-- ⚠️ NO EJECUTAR AUTOMÁTICAMENTE — Álvaro la corre manualmente con
-- `supabase db query --file` en el proyecto (gmfjnzwmfcufgolptaoi).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS numero_transaccion TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_numero_transaccion_unique
  ON public.pedidos (numero_transaccion)
  WHERE numero_transaccion IS NOT NULL;
