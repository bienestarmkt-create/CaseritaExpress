-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Coordenadas de destino en pedidos — CaseritaExpress
-- Tabla modificada: pedidos
-- Descripción: Agrega columnas destino_lat y destino_lng para guardar
--              las coordenadas exactas del punto de entrega de cada pedido.
--              Usadas por el mapa de seguimiento para mostrar el marcador
--              de destino y calcular la ruta del repartidor.
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Idempotente: IF NOT EXISTS — seguro ejecutar más de una vez
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. AGREGAR COLUMNAS DE COORDENADAS
--    DOUBLE PRECISION = 64 bits, ~15 decimales de precisión.
--    Más que suficiente para GPS (6 decimales = precisión de ~0.11 m).
--    NULL permitido: pedidos antiguos no tendrán coordenadas.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS destino_lat  DOUBLE PRECISION
        CHECK (destino_lat  IS NULL OR destino_lat  BETWEEN -90  AND 90),
    ADD COLUMN IF NOT EXISTS destino_lng  DOUBLE PRECISION
        CHECK (destino_lng  IS NULL OR destino_lng  BETWEEN -180 AND 180);

COMMENT ON COLUMN public.pedidos.destino_lat
    IS 'Latitud WGS-84 del punto de entrega. NULL en pedidos históricos sin coordenadas.';
COMMENT ON COLUMN public.pedidos.destino_lng
    IS 'Longitud WGS-84 del punto de entrega. NULL en pedidos históricos sin coordenadas.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. ÍNDICE PARCIAL
--    Solo indexa filas que SÍ tienen coordenadas, para no desperdiciar
--    espacio en los pedidos históricos que tienen NULL.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_destino_coords
    ON public.pedidos (destino_lat, destino_lng)
    WHERE destino_lat IS NOT NULL AND destino_lng IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────
-- 3. PERMISOS
--    Las RLS de pedidos ya existentes cubren estas columnas automáticamente
--    (RLS opera a nivel de fila, no de columna).
--    Solo necesitamos asegurarnos de que el cliente pueda escribir
--    estas columnas al crear su pedido.
--
--    NOTA: Si tienes una política "cliente_inserta_pedido" que usa WITH CHECK,
--    no hace falta cambiar nada — las columnas nuevas se heredan.
--    Si tu inserción de pedido la hace una función SECURITY DEFINER,
--    tampoco hace falta ningún cambio adicional aquí.
-- ─────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────
-- 4. VERIFICACIÓN FINAL
-- ─────────────────────────────────────────────────────────────────────
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'pedidos'
  AND column_name  IN (
      'destino_lat',
      'destino_lng',
      'direccion_entrega'   -- columna de texto ya existente, para comparar
  )
ORDER BY column_name;

-- Verificar que el índice se creó
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'pedidos'
  AND indexname = 'idx_pedidos_destino_coords';

-- ═══════════════════════════════════════════════════════════════════════
-- FIN: migration_destino_coords.sql
--
-- Uso desde la app al CREAR un pedido:
--
--   await supabase.from('pedidos').insert({
--     cliente_id:        user.id,
--     negocio_id:        negocioId,
--     direccion_entrega: direccionTexto,   // texto legible (ya existía)
--     destino_lat:       location.latitude,
--     destino_lng:       location.longitude,
--     ...resto de campos
--   });
--
-- Uso desde seguimiento.tsx para mostrar marcador de destino:
--
--   const { data: pedido } = await supabase
--     .from('pedidos')
--     .select('destino_lat, destino_lng, direccion_entrega, ...')
--     .eq('id', pedidoId)
--     .single();
--
--   // si el pedido tiene coordenadas, mostrar marcador en el mapa
--   if (pedido.destino_lat && pedido.destino_lng) {
--     setDestino({ lat: pedido.destino_lat, lng: pedido.destino_lng });
--   }
-- ═══════════════════════════════════════════════════════════════════════
