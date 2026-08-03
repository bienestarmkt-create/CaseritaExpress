-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: agregar columna entrega_sospechosa a pedidos
--
-- Bandera de auditoría, NO bloquea nada. Se setea en
-- app/repartidor/mapa.tsx (marcarEntregado) cuando la posición GPS del
-- repartidor al momento de tocar "Marcar entregado" está a más de 200m
-- de pedidos.destino_lat/destino_lng. Umbral elegido con margen sobre el
-- error típico de GPS en ciudad (20-50m) para evitar banderas falsas.
-- Default false: si falta señal GPS o destino registrado, no se marca
-- nada (sin evidencia, no hay sospecha).
--
-- Aplicar con (NO usar `supabase db push`):
--   npx supabase db query --linked --file supabase/migrations/20260729000000_add_entrega_sospechosa_pedidos.sql
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS entrega_sospechosa boolean NOT NULL DEFAULT false;
