-- ═══════════════════════════════════════════════════════════════════════════
-- migration_ratings.sql
-- Sistema de Calificaciones — CaseritaExpress
--
-- Qué hace este archivo (en orden de ejecución):
--   1. Tabla `ratings` con FK a pedidos y usuarios
--   2. RLS: cliente crea/ve la suya · admin ve todas · anon/negocio/repartidor solo promedios vía función
--   3. Vista `v_promedios_negocios`  — promedio decimal con 1 dígito + conteo
--   4. Vista `v_promedios_repartidores` — misma lógica para repartidores
--   5. Función `promedio_calificacion_negocio(negocio_id)`
--   6. Función `promedio_calificacion_repartidor(repartidor_id)`
--
-- INSTRUCCIONES:
--   Supabase Dashboard → SQL Editor → pegar TODO y ejecutar.
--   No requiere pasos manuales previos.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLA ratings
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ratings (
  id                       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id                UUID        NOT NULL REFERENCES public.pedidos(id)   ON DELETE CASCADE,
  cliente_id               UUID        NOT NULL REFERENCES public.usuarios(id)  ON DELETE CASCADE,
  calificacion_negocio     INTEGER     NOT NULL CHECK (calificacion_negocio     BETWEEN 1 AND 5),
  calificacion_repartidor  INTEGER              CHECK (calificacion_repartidor  BETWEEN 1 AND 5),
  comentario_negocio       TEXT,
  comentario_repartidor    TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),

  -- Un cliente solo puede calificar cada pedido una vez
  CONSTRAINT ratings_pedido_cliente_unique UNIQUE (pedido_id, cliente_id)
);

COMMENT ON TABLE public.ratings IS
  'Calificaciones de 1-5 estrellas por pedido. Un cliente califica una vez por pedido.';

-- Índices de búsqueda frecuente
CREATE INDEX IF NOT EXISTS idx_ratings_pedido_id   ON public.ratings (pedido_id);
CREATE INDEX IF NOT EXISTS idx_ratings_cliente_id  ON public.ratings (cliente_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS — ratings
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- El cliente ve y crea solo sus propias calificaciones
DROP POLICY IF EXISTS "cliente_ve_sus_ratings"   ON public.ratings;
CREATE POLICY "cliente_ve_sus_ratings"
  ON public.ratings FOR SELECT TO authenticated
  USING (cliente_id = auth.uid());

DROP POLICY IF EXISTS "cliente_inserta_su_rating" ON public.ratings;
CREATE POLICY "cliente_inserta_su_rating"
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (
    cliente_id = auth.uid()
    -- Solo puede calificar pedidos que le pertenecen y están entregados
    AND EXISTS (
      SELECT 1 FROM public.pedidos
      WHERE id     = pedido_id
        AND cliente_id = auth.uid()
        AND estado = 'entregado'
    )
  );

-- El admin ve todas las calificaciones
DROP POLICY IF EXISTS "admin_ve_todos_ratings" ON public.ratings;
CREATE POLICY "admin_ve_todos_ratings"
  ON public.ratings FOR ALL TO authenticated
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

-- Negocio y repartidor NO tienen acceso directo a la tabla.
-- Solo acceden al promedio via las vistas/funciones de abajo.


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VISTA v_promedios_negocios
--    Promedio de calificación por negocio, con total de reseñas.
--    NULL si el negocio no tiene calificaciones aún.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_promedios_negocios AS
SELECT
  p.negocio_id,
  ROUND(AVG(r.calificacion_negocio)::NUMERIC, 1)  AS promedio,
  COUNT(r.id)::INTEGER                             AS total_ratings
FROM public.pedidos  p
JOIN public.ratings  r ON r.pedido_id = p.id
WHERE r.calificacion_negocio IS NOT NULL
  AND p.negocio_id            IS NOT NULL
GROUP BY p.negocio_id;

COMMENT ON VIEW public.v_promedios_negocios IS
  'Promedio de calificacion_negocio por negocio_id. NULL si no tiene ratings.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. VISTA v_promedios_repartidores
--    Promedio de calificación por repartidor, con total de reseñas.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_promedios_repartidores AS
SELECT
  p.repartidor_id,
  ROUND(AVG(r.calificacion_repartidor)::NUMERIC, 1) AS promedio,
  COUNT(r.id)::INTEGER                               AS total_ratings
FROM public.pedidos  p
JOIN public.ratings  r ON r.pedido_id = p.id
WHERE r.calificacion_repartidor IS NOT NULL
  AND p.repartidor_id             IS NOT NULL
GROUP BY p.repartidor_id;

COMMENT ON VIEW public.v_promedios_repartidores IS
  'Promedio de calificacion_repartidor por repartidor_id. NULL si no tiene ratings.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FUNCIÓN promedio_calificacion_negocio(negocio_id)
--    Devuelve el promedio como NUMERIC(3,1) o NULL si no hay calificaciones.
--    Ejemplo: 4.5, 3.7, NULL → "Nuevo"
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promedio_calificacion_negocio(p_negocio_id UUID)
RETURNS NUMERIC(3,1)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(AVG(r.calificacion_negocio)::NUMERIC, 1)
  FROM public.pedidos  p
  JOIN public.ratings  r ON r.pedido_id = p.id
  WHERE p.negocio_id           = p_negocio_id
    AND r.calificacion_negocio IS NOT NULL;
$$;

COMMENT ON FUNCTION public.promedio_calificacion_negocio(UUID) IS
  'Promedio decimal (ej: 4.5) de calificaciones del negocio. NULL si no tiene ninguna.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. FUNCIÓN promedio_calificacion_repartidor(repartidor_id)
--    Misma lógica para repartidores.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promedio_calificacion_repartidor(p_repartidor_id UUID)
RETURNS NUMERIC(3,1)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(AVG(r.calificacion_repartidor)::NUMERIC, 1)
  FROM public.pedidos  p
  JOIN public.ratings  r ON r.pedido_id = p.id
  WHERE p.repartidor_id               = p_repartidor_id
    AND r.calificacion_repartidor IS NOT NULL;
$$;

COMMENT ON FUNCTION public.promedio_calificacion_repartidor(UUID) IS
  'Promedio decimal (ej: 4.8) de calificaciones del repartidor. NULL si no tiene ninguna.';


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  t.table_name,
  STRING_AGG(c.column_name, ', ' ORDER BY c.ordinal_position) AS columnas
FROM information_schema.tables  t
JOIN information_schema.columns c
  ON c.table_name   = t.table_name
 AND c.table_schema = t.table_schema
WHERE t.table_schema = 'public'
  AND t.table_name   = 'ratings'
GROUP BY t.table_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN: migration_ratings.sql
-- ═══════════════════════════════════════════════════════════════════════════
