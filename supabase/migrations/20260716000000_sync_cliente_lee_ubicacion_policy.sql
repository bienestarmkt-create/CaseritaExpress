-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Sincronizar policy "cliente_read_ubicacion" con producción
-- Tabla: public.ubicaciones_repartidores
--
-- Motivo: en producción (gmfjnzwmfcufgolptaoi) la policy de lectura del
-- cliente YA incluye los estados 'confirmado', 'preparando' y 'en_camino'
-- (confirmado manualmente en el dashboard de Supabase). El archivo
-- versionado supabase/migrations/20260524000000_gps_tracking.sql quedó
-- desactualizado y solo tenía 'en_camino', lo cual no reflejaba la
-- realidad del schema en producción.
--
-- Este archivo es SOLO para que el repo documente correctamente el
-- estado real de producción. La policy en gmfjnzwmfcufgolptaoi YA está
-- correcta — no hace falta volver a aplicarla ahí. Es idempotente
-- (DROP + CREATE) por si se necesita reconstruir el schema en un
-- entorno nuevo (local, staging, etc).
-- ═══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "cliente_read_ubicacion" ON public.ubicaciones_repartidores;

CREATE POLICY "cliente_read_ubicacion"
  ON public.ubicaciones_repartidores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_id
        AND p.cliente_id = auth.uid()
        AND p.estado = ANY (ARRAY['confirmado', 'preparando', 'en_camino'])
    )
  );
