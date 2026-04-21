-- ============================================================
-- CaseritaExpress — Módulo Repartidores
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Agregar campo rol a usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'cliente';
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('cliente', 'repartidor', 'admin'));

-- 2. Agregar campos repartidor a pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repartidor_id UUID;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repartidor_nombre TEXT;

-- 3. Actualizar RLS pedidos — incluir repartidores asignados
DROP POLICY IF EXISTS "pedidos_select_involucrado" ON pedidos;
DROP POLICY IF EXISTS "pedidos_update_involucrado" ON pedidos;

CREATE POLICY "pedidos_select_involucrado" ON pedidos
  FOR SELECT USING (
    auth.uid() = cliente_id
    OR auth.uid() = repartidor_id
    OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
    OR EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol IN ('repartidor', 'admin')
    )
  );

CREATE POLICY "pedidos_update_involucrado" ON pedidos
  FOR UPDATE USING (
    auth.uid() = cliente_id
    OR auth.uid() = repartidor_id
    OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
    OR EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol IN ('repartidor', 'admin')
    )
  );

-- 4. Política usuarios — admins pueden ver y editar todos
DROP POLICY IF EXISTS "usuarios_select_own" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_own" ON usuarios;

CREATE POLICY "usuarios_select_own" ON usuarios
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'admin')
  );

CREATE POLICY "usuarios_update_own" ON usuarios
  FOR UPDATE USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND rol = 'admin')
  );
