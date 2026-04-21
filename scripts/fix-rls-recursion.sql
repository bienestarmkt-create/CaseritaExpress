-- ============================================================
-- CaseritaExpress — Fix recursión infinita en RLS de usuarios
-- EJECUTAR EN: Supabase → SQL Editor
-- PROBLEMA: policy "usuarios_select_own" consulta usuarios
--   → al evaluar pedidos_select_involucrado o detalle_pedidos_insert
--   → PostgreSQL detecta infinite recursion (error 42P17)
-- ============================================================

-- 1. Función SECURITY DEFINER para verificar admin sin recurrir a RLS
CREATE OR REPLACE FUNCTION auth_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'admin')
$$;

-- 2. Función SECURITY DEFINER para verificar repartidor/admin
CREATE OR REPLACE FUNCTION auth_is_repartidor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol IN ('repartidor', 'admin'))
$$;

-- 3. Corregir policy usuarios SELECT (era recursiva)
DROP POLICY IF EXISTS "usuarios_select_own" ON usuarios;
CREATE POLICY "usuarios_select_own" ON usuarios
  FOR SELECT USING (
    auth.uid() = id
    OR auth_is_admin()
  );

-- 4. Corregir policy usuarios UPDATE (era recursiva)
DROP POLICY IF EXISTS "usuarios_update_own" ON usuarios;
CREATE POLICY "usuarios_update_own" ON usuarios
  FOR UPDATE USING (
    auth.uid() = id
    OR auth_is_admin()
  );

-- 5. Corregir pedidos SELECT (reemplaza la de repartidores-migration.sql)
DROP POLICY IF EXISTS "pedidos_select_involucrado" ON pedidos;
CREATE POLICY "pedidos_select_involucrado" ON pedidos
  FOR SELECT USING (
    auth.uid() = cliente_id
    OR auth.uid() = repartidor_id
    OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
    OR auth_is_repartidor_or_admin()
  );

-- 6. Corregir pedidos UPDATE (reemplaza la de repartidores-migration.sql)
DROP POLICY IF EXISTS "pedidos_update_involucrado" ON pedidos;
CREATE POLICY "pedidos_update_involucrado" ON pedidos
  FOR UPDATE USING (
    auth.uid() = cliente_id
    OR auth.uid() = repartidor_id
    OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
    OR auth_is_repartidor_or_admin()
  );
