-- ═══════════════════════════════════════════════════════════════
-- Migración: Coordenadas de destino en pedidos (V2 Tracking)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- No modifica ninguna columna existente
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS destino_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS destino_lng NUMERIC;

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'pedidos'
  AND column_name IN ('destino_lat', 'destino_lng', 'direccion_entrega');
