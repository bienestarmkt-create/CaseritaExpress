-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Tracking GPS en tiempo real — CaseritaExpress
-- Tabla: ubicaciones_repartidores
-- Descripción: Una fila por repartidor, se actualiza vía UPSERT desde
--              la app. Supabase Realtime publica el cambio al cliente.
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Prerequisito: migration_admin_panel.sql ejecutado previamente
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. FUNCIÓN HELPER: is_repartidor()
--    Usada en políticas RLS. SECURITY DEFINER para no exponer profiles.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_repartidor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   public.profiles
        WHERE  id  = auth.uid()
          AND  rol = 'repartidor'
    );
$$;

COMMENT ON FUNCTION public.is_repartidor()
    IS 'Devuelve true si el usuario autenticado tiene rol repartidor.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. TABLA: ubicaciones_repartidores
--    Una sola fila por repartidor (PK = repartidor_id).
--    La app hace UPSERT → updated_at cambia → Realtime lo propaga.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ubicaciones_repartidores (
    -- Identificador único: el propio repartidor (1 fila por persona)
    repartidor_id   UUID        NOT NULL
                    REFERENCES  public.profiles(id) ON DELETE CASCADE,

    -- Coordenadas GPS — DOUBLE PRECISION = 15 decimales (más que suficiente)
    lat             DOUBLE PRECISION NOT NULL
                    CHECK (lat  BETWEEN -90  AND 90),
    lng             DOUBLE PRECISION NOT NULL
                    CHECK (lng  BETWEEN -180 AND 180),

    -- Rumbo en grados (0–359). NULL si el dispositivo no lo reporta.
    heading         NUMERIC(5,1)     DEFAULT NULL
                    CHECK (heading IS NULL OR heading BETWEEN 0 AND 360),

    -- Precisión horizontal del GPS en metros. Útil para descartar señal mala.
    precision_m     NUMERIC(7,2)     DEFAULT NULL
                    CHECK (precision_m IS NULL OR precision_m >= 0),

    -- Marca de tiempo del último ping (con zona horaria)
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Clave primaria: un repartidor, una fila
    CONSTRAINT ubicaciones_repartidores_pkey PRIMARY KEY (repartidor_id)
);

COMMENT ON TABLE public.ubicaciones_repartidores
    IS 'Posición GPS en tiempo real de cada repartidor activo. '
       'Se actualiza vía UPSERT; Realtime transmite los cambios al cliente.';

COMMENT ON COLUMN public.ubicaciones_repartidores.repartidor_id
    IS 'FK a profiles.id. Un repartidor = una fila.';
COMMENT ON COLUMN public.ubicaciones_repartidores.lat
    IS 'Latitud WGS-84. Rango válido: -90 a 90.';
COMMENT ON COLUMN public.ubicaciones_repartidores.lng
    IS 'Longitud WGS-84. Rango válido: -180 a 180.';
COMMENT ON COLUMN public.ubicaciones_repartidores.heading
    IS 'Dirección de movimiento en grados (0 = Norte). NULL si no disponible.';
COMMENT ON COLUMN public.ubicaciones_repartidores.precision_m
    IS 'Precisión horizontal del GPS en metros. NULL si no disponible.';
COMMENT ON COLUMN public.ubicaciones_repartidores.updated_at
    IS 'Timestamp del último ping GPS. Se actualiza en cada UPSERT.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. ÍNDICE para consultas por updated_at (detectar repartidores offline)
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ubicaciones_updated_at
    ON public.ubicaciones_repartidores (updated_at DESC);


-- ─────────────────────────────────────────────────────────────────────
-- 4. FUNCIÓN: actualizar updated_at automáticamente en cada UPDATE
--    (extra de seguridad por si la app olvida enviarlo)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_ubicacion_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ubicacion_updated_at
    ON public.ubicaciones_repartidores;

CREATE TRIGGER trg_touch_ubicacion_updated_at
    BEFORE UPDATE ON public.ubicaciones_repartidores
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_ubicacion_updated_at();


-- ─────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ubicaciones_repartidores ENABLE ROW LEVEL SECURITY;


-- ── 5a. El repartidor escribe (INSERT + UPDATE) solo su propia fila ──
DROP POLICY IF EXISTS "repartidor_escribe_su_ubicacion"
    ON public.ubicaciones_repartidores;
CREATE POLICY "repartidor_escribe_su_ubicacion"
    ON public.ubicaciones_repartidores
    FOR ALL                          -- cubre INSERT y UPDATE (UPSERT)
    TO authenticated
    USING      (repartidor_id = auth.uid())
    WITH CHECK (repartidor_id = auth.uid());


-- ── 5b. El cliente lee la ubicación SI tiene un pedido activo
--        con ese repartidor (estado: confirmado, en_camino, preparando) ──
DROP POLICY IF EXISTS "cliente_lee_ubicacion_de_su_repartidor"
    ON public.ubicaciones_repartidores;
CREATE POLICY "cliente_lee_ubicacion_de_su_repartidor"
    ON public.ubicaciones_repartidores
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM   public.pedidos p
            WHERE  p.repartidor_id = ubicaciones_repartidores.repartidor_id
              AND  p.cliente_id    = auth.uid()
              AND  p.estado IN ('confirmado', 'preparando', 'en_camino')
        )
    );


-- ── 5c. El admin lee todas las ubicaciones (panel de despacho) ──
DROP POLICY IF EXISTS "admin_lee_todas_las_ubicaciones"
    ON public.ubicaciones_repartidores;
CREATE POLICY "admin_lee_todas_las_ubicaciones"
    ON public.ubicaciones_repartidores
    FOR SELECT
    TO authenticated
    USING (public.is_admin());


-- ── 5d. El repartidor puede leer su propia fila (para mostrar su posición) ──
DROP POLICY IF EXISTS "repartidor_lee_su_propia_ubicacion"
    ON public.ubicaciones_repartidores;
CREATE POLICY "repartidor_lee_su_propia_ubicacion"
    ON public.ubicaciones_repartidores
    FOR SELECT
    TO authenticated
    USING (repartidor_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────
-- 6. PUBLICACIÓN REALTIME
--    Habilita la tabla en el canal de Realtime de Supabase para que
--    los UPDATE sean transmitidos automáticamente a los suscriptores.
--    Si ya existe la publicación supabase_realtime, solo agrega la tabla.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    -- Verificar si la publicación existe
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        -- Agregar la tabla a la publicación existente
        ALTER PUBLICATION supabase_realtime
            ADD TABLE public.ubicaciones_repartidores;
    END IF;
EXCEPTION
    -- Si la tabla ya estaba en la publicación, ignorar el error
    WHEN duplicate_object THEN NULL;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 7. VERIFICACIÓN FINAL
-- ─────────────────────────────────────────────────────────────────────
SELECT
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name   = 'ubicaciones_repartidores'
ORDER BY c.ordinal_position;

-- ═══════════════════════════════════════════════════════════════════════
-- FIN: migration_tracking.sql
--
-- Uso desde la app (React Native / TypeScript):
--
--   // UPSERT — el repartidor envía su posición cada N segundos
--   await supabase.from('ubicaciones_repartidores').upsert({
--     repartidor_id: user.id,
--     lat: coords.latitude,
--     lng: coords.longitude,
--     heading: coords.heading ?? null,
--     precision_m: coords.accuracy ?? null,
--   }, { onConflict: 'repartidor_id' });
--
--   // SUSCRIPCIÓN — el cliente escucha cambios en tiempo real
--   const channel = supabase
--     .channel('tracking-' + repartidorId)
--     .on('postgres_changes', {
--       event: 'UPDATE',
--       schema: 'public',
--       table: 'ubicaciones_repartidores',
--       filter: `repartidor_id=eq.${repartidorId}`,
--     }, (payload) => {
--       const { lat, lng } = payload.new;
--       // actualizar marcador en el mapa
--     })
--     .subscribe();
--
--   // LIMPIEZA al desconectar el repartidor (opcional)
--   await supabase
--     .from('ubicaciones_repartidores')
--     .delete()
--     .eq('repartidor_id', user.id);
-- ═══════════════════════════════════════════════════════════════════════
