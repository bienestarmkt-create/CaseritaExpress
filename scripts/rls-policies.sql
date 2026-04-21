-- ============================================================
-- CaseritaExpress — RLS policies para 9 tablas
-- ============================================================

-- 1. ACTIVAR RLS EN TODAS LAS TABLAS
ALTER TABLE usuarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE negocios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_pedidos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alojamientos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE entradas         ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. USUARIOS — solo ve y edita sus propios datos
-- ============================================================
DROP POLICY IF EXISTS "usuarios_select_own"  ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert_own"  ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_own"  ON usuarios;

CREATE POLICY "usuarios_select_own" ON usuarios
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "usuarios_insert_own" ON usuarios
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "usuarios_update_own" ON usuarios
  FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- 3. NEGOCIOS — visibles para todos, editables solo por su dueño
-- ============================================================
DROP POLICY IF EXISTS "negocios_select_all"   ON negocios;
DROP POLICY IF EXISTS "negocios_insert_own"   ON negocios;
DROP POLICY IF EXISTS "negocios_update_own"   ON negocios;
DROP POLICY IF EXISTS "negocios_delete_own"   ON negocios;

CREATE POLICY "negocios_select_all" ON negocios
  FOR SELECT USING (true);

CREATE POLICY "negocios_insert_own" ON negocios
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "negocios_update_own" ON negocios
  FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "negocios_delete_own" ON negocios
  FOR DELETE USING (auth.uid() = usuario_id);

-- ============================================================
-- 4. PRODUCTOS — visibles para todos, editables solo por el dueño del negocio
-- ============================================================
DROP POLICY IF EXISTS "productos_select_all"  ON productos;
DROP POLICY IF EXISTS "productos_insert_own"  ON productos;
DROP POLICY IF EXISTS "productos_update_own"  ON productos;
DROP POLICY IF EXISTS "productos_delete_own"  ON productos;

CREATE POLICY "productos_select_all" ON productos
  FOR SELECT USING (true);

CREATE POLICY "productos_insert_own" ON productos
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
  );

CREATE POLICY "productos_update_own" ON productos
  FOR UPDATE USING (
    auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
  );

CREATE POLICY "productos_delete_own" ON productos
  FOR DELETE USING (
    auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
  );

-- ============================================================
-- 5. PEDIDOS — visibles solo para el cliente y el negocio involucrado
-- ============================================================
DROP POLICY IF EXISTS "pedidos_select_involucrado"  ON pedidos;
DROP POLICY IF EXISTS "pedidos_insert_cliente"      ON pedidos;
DROP POLICY IF EXISTS "pedidos_update_involucrado"  ON pedidos;

CREATE POLICY "pedidos_select_involucrado" ON pedidos
  FOR SELECT USING (
    auth.uid() = cliente_id
    OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
  );

CREATE POLICY "pedidos_insert_cliente" ON pedidos
  FOR INSERT WITH CHECK (auth.uid() = cliente_id);

CREATE POLICY "pedidos_update_involucrado" ON pedidos
  FOR UPDATE USING (
    auth.uid() = cliente_id
    OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = negocio_id)
  );

-- ============================================================
-- 6. DETALLE_PEDIDOS — acceso ligado al pedido (cliente o negocio)
-- ============================================================
DROP POLICY IF EXISTS "detalle_pedidos_select"  ON detalle_pedidos;
DROP POLICY IF EXISTS "detalle_pedidos_insert"  ON detalle_pedidos;
DROP POLICY IF EXISTS "detalle_pedidos_update"  ON detalle_pedidos;

CREATE POLICY "detalle_pedidos_select" ON detalle_pedidos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pedidos p
      WHERE p.id = pedido_id
        AND (
          auth.uid() = p.cliente_id
          OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = p.negocio_id)
        )
    )
  );

CREATE POLICY "detalle_pedidos_insert" ON detalle_pedidos
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT cliente_id FROM pedidos WHERE id = pedido_id)
  );

CREATE POLICY "detalle_pedidos_update" ON detalle_pedidos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM pedidos p
      WHERE p.id = pedido_id
        AND (
          auth.uid() = p.cliente_id
          OR auth.uid() = (SELECT usuario_id FROM negocios WHERE id = p.negocio_id)
        )
    )
  );

-- ============================================================
-- 7. ALOJAMIENTOS — visibles para todos, editables solo por el anfitrión
-- ============================================================
DROP POLICY IF EXISTS "alojamientos_select_all"   ON alojamientos;
DROP POLICY IF EXISTS "alojamientos_insert_own"   ON alojamientos;
DROP POLICY IF EXISTS "alojamientos_update_own"   ON alojamientos;
DROP POLICY IF EXISTS "alojamientos_delete_own"   ON alojamientos;

CREATE POLICY "alojamientos_select_all" ON alojamientos
  FOR SELECT USING (true);

CREATE POLICY "alojamientos_insert_own" ON alojamientos
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "alojamientos_update_own" ON alojamientos
  FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "alojamientos_delete_own" ON alojamientos
  FOR DELETE USING (auth.uid() = usuario_id);

-- ============================================================
-- 8. RESERVAS — visibles solo para cliente y anfitrión
-- ============================================================
DROP POLICY IF EXISTS "reservas_select_involucrado"  ON reservas;
DROP POLICY IF EXISTS "reservas_insert_cliente"      ON reservas;
DROP POLICY IF EXISTS "reservas_update_involucrado"  ON reservas;

CREATE POLICY "reservas_select_involucrado" ON reservas
  FOR SELECT USING (
    auth.uid() = cliente_id
    OR auth.uid() = (SELECT usuario_id FROM alojamientos WHERE id = alojamiento_id)
  );

CREATE POLICY "reservas_insert_cliente" ON reservas
  FOR INSERT WITH CHECK (auth.uid() = cliente_id);

CREATE POLICY "reservas_update_involucrado" ON reservas
  FOR UPDATE USING (
    auth.uid() = cliente_id
    OR auth.uid() = (SELECT usuario_id FROM alojamientos WHERE id = alojamiento_id)
  );

-- ============================================================
-- 9. EVENTOS — visibles para todos, editables solo por el organizador
-- ============================================================
DROP POLICY IF EXISTS "eventos_select_all"   ON eventos;
DROP POLICY IF EXISTS "eventos_insert_own"   ON eventos;
DROP POLICY IF EXISTS "eventos_update_own"   ON eventos;
DROP POLICY IF EXISTS "eventos_delete_own"   ON eventos;

CREATE POLICY "eventos_select_all" ON eventos
  FOR SELECT USING (true);

CREATE POLICY "eventos_insert_own" ON eventos
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "eventos_update_own" ON eventos
  FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "eventos_delete_own" ON eventos
  FOR DELETE USING (auth.uid() = usuario_id);

-- ============================================================
-- 10. ENTRADAS — visibles solo para cliente y organizador del evento
-- ============================================================
DROP POLICY IF EXISTS "entradas_select_involucrado"  ON entradas;
DROP POLICY IF EXISTS "entradas_insert_cliente"      ON entradas;
DROP POLICY IF EXISTS "entradas_update_involucrado"  ON entradas;

CREATE POLICY "entradas_select_involucrado" ON entradas
  FOR SELECT USING (
    auth.uid() = cliente_id
    OR auth.uid() = (SELECT usuario_id FROM eventos WHERE id = evento_id)
  );

CREATE POLICY "entradas_insert_cliente" ON entradas
  FOR INSERT WITH CHECK (auth.uid() = cliente_id);

CREATE POLICY "entradas_update_involucrado" ON entradas
  FOR UPDATE USING (
    auth.uid() = cliente_id
    OR auth.uid() = (SELECT usuario_id FROM eventos WHERE id = evento_id)
  );
