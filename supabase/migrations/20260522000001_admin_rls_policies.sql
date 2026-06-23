-- Políticas RLS para la tabla usuarios
-- NOTA: admin_lee_todos fue eliminada — causa recursión infinita (42P17).
-- El admin panel usa service_role key que bypasea RLS completamente.

-- ── usuarios ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_read_all_usuarios" ON public.usuarios;
DROP POLICY IF EXISTS "usuario_lee_su_propia_fila" ON public.usuarios;
DROP POLICY IF EXISTS "admin_lee_todos" ON public.usuarios;

CREATE POLICY "usuario_lee_su_propia_fila"
  ON public.usuarios FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- ── pedidos: lectura ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_read_all_pedidos" ON public.pedidos;
CREATE POLICY "admin_read_all_pedidos"
  ON public.pedidos FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin'
    )
  );

-- ── pedidos: actualización (asignar repartidor) ───────────────────────────
DROP POLICY IF EXISTS "admin_update_pedidos" ON public.pedidos;
CREATE POLICY "admin_update_pedidos"
  ON public.pedidos FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.rol = 'admin'
    )
  );

-- ── reservas: cliente lee sus propias ─────────────────────────────────────
DROP POLICY IF EXISTS "cliente_read_own_reservas" ON public.reservas;
CREATE POLICY "cliente_read_own_reservas"
  ON public.reservas FOR SELECT TO authenticated
  USING (auth.uid() = cliente_id);

-- ── entradas: cliente lee sus propias ─────────────────────────────────────
DROP POLICY IF EXISTS "cliente_read_own_entradas" ON public.entradas;
CREATE POLICY "cliente_read_own_entradas"
  ON public.entradas FOR SELECT TO authenticated
  USING (auth.uid() = cliente_id);
