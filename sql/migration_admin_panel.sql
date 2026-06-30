-- ============================================================
-- MIGRATION: Panel Admin — CaseritaExpress
-- Descripción: Añade columna `rol` a profiles, columna `activo`
--              a negocios, función is_admin() y políticas RLS
--              para que el admin pueda gestionar toda la plataforma.
-- ORDEN DE EJECUCIÓN: 1° este archivo (único).
-- ============================================================


-- ------------------------------------------------------------
-- 1. COLUMNA rol EN profiles
--    Si ya existe, no hace nada. Tres roles posibles.
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'cliente'
    CHECK (rol IN ('cliente', 'repartidor', 'admin'));

COMMENT ON COLUMN public.profiles.rol
    IS 'Rol del usuario: cliente | repartidor | admin.';


-- ------------------------------------------------------------
-- 2. COLUMNA activo EN negocios
--    Permite activar/desactivar negocios desde el panel admin.
-- ------------------------------------------------------------
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.negocios.activo
    IS 'true = negocio visible y activo en la app; false = desactivado.';

-- Índice para filtrar negocios activos rápidamente
CREATE INDEX IF NOT EXISTS idx_negocios_activo
    ON public.negocios (activo)
    WHERE activo = true;


-- ------------------------------------------------------------
-- 3. FUNCIÓN HELPER: is_admin()
--    Usada en las políticas RLS para verificar el rol sin
--    exponer la tabla profiles a otros usuarios.
--    SECURITY DEFINER = corre con permisos del owner (postgres).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
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
          AND  rol = 'admin'
    );
$$;

COMMENT ON FUNCTION public.is_admin()
    IS 'Devuelve true si el usuario autenticado tiene rol admin.';


-- ============================================================
-- POLÍTICAS RLS — profiles
-- ============================================================

-- El usuario puede leer su propio perfil. El admin puede leer todos.
DROP POLICY IF EXISTS "usuario_lee_su_perfil_o_admin_lee_todos"
    ON public.profiles;
CREATE POLICY "usuario_lee_su_perfil_o_admin_lee_todos"
    ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid()
        OR public.is_admin()
    );

-- Solo el admin puede actualizar el rol de cualquier usuario.
DROP POLICY IF EXISTS "admin_actualiza_rol_de_usuario"
    ON public.profiles;
CREATE POLICY "admin_actualiza_rol_de_usuario"
    ON public.profiles
    FOR UPDATE TO authenticated
    USING      (public.is_admin())
    WITH CHECK (public.is_admin());

-- El propio usuario puede actualizar su perfil (excepto rol).
-- Si ya tienes esta política, ajusta los nombres para evitar conflictos.
DROP POLICY IF EXISTS "usuario_actualiza_su_propio_perfil"
    ON public.profiles;
CREATE POLICY "usuario_actualiza_su_propio_perfil"
    ON public.profiles
    FOR UPDATE TO authenticated
    USING      (id = auth.uid() AND NOT public.is_admin())
    WITH CHECK (id = auth.uid() AND NOT public.is_admin());


-- ============================================================
-- POLÍTICAS RLS — negocios
-- ============================================================

-- Todos los autenticados leen negocios (activos en la app).
-- Si ya tienes esta política, omítela o renómbrala.
DROP POLICY IF EXISTS "autenticados_leen_negocios_activos"
    ON public.negocios;
CREATE POLICY "autenticados_leen_negocios_activos"
    ON public.negocios
    FOR SELECT TO authenticated
    USING (activo = true OR public.is_admin());

-- Solo admin puede actualizar negocios (ej: activar/desactivar).
DROP POLICY IF EXISTS "admin_actualiza_negocios"
    ON public.negocios;
CREATE POLICY "admin_actualiza_negocios"
    ON public.negocios
    FOR UPDATE TO authenticated
    USING      (public.is_admin())
    WITH CHECK (public.is_admin());


-- ============================================================
-- POLÍTICAS RLS — pedidos
-- ============================================================

-- El admin puede leer TODOS los pedidos (para el panel de gestión).
DROP POLICY IF EXISTS "admin_lee_todos_los_pedidos"
    ON public.pedidos;
CREATE POLICY "admin_lee_todos_los_pedidos"
    ON public.pedidos
    FOR SELECT TO authenticated
    USING (
        cliente_id = auth.uid()     -- el propio cliente
        OR public.is_admin()        -- el admin ve todo
        -- Agrega aquí: OR repartidor_id = auth.uid() si quieres que el repartidor vea sus pedidos
    );

-- El admin puede cambiar el estado de cualquier pedido.
DROP POLICY IF EXISTS "admin_actualiza_estado_pedido"
    ON public.pedidos;
CREATE POLICY "admin_actualiza_estado_pedido"
    ON public.pedidos
    FOR UPDATE TO authenticated
    USING      (public.is_admin())
    WITH CHECK (public.is_admin());


-- ============================================================
-- VERIFICACIÓN: muestra columnas añadidas
-- ============================================================
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'profiles'  AND column_name = 'rol')
   OR (table_name = 'negocios'  AND column_name = 'activo')
  )
ORDER BY table_name, column_name;

-- ============================================================
-- FIN: migration_admin_panel.sql
-- ============================================================
