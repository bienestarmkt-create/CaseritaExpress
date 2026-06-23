-- GPS tracking en tiempo real del repartidor
-- Ejecutar en: https://supabase.com/dashboard/project/gmfjnzwmfcufgolptaoi/sql/new

CREATE TABLE IF NOT EXISTS public.ubicaciones_repartidores (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid        UNIQUE REFERENCES public.pedidos(id) ON DELETE CASCADE,
  repartidor_id uuid      REFERENCES public.usuarios(id),
  lat         numeric(10,7) NOT NULL,
  lng         numeric(10,7) NOT NULL,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.ubicaciones_repartidores ENABLE ROW LEVEL SECURITY;

-- Repartidor puede insertar y actualizar su propia ubicación
CREATE POLICY "repartidor_upsert_ubicacion"
  ON public.ubicaciones_repartidores
  FOR ALL TO authenticated
  USING  (auth.uid() = repartidor_id)
  WITH CHECK (auth.uid() = repartidor_id);

-- Cliente puede leer la ubicación solo si tiene un pedido en_camino con ese repartidor
CREATE POLICY "cliente_read_ubicacion"
  ON public.ubicaciones_repartidores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_id
        AND p.cliente_id = auth.uid()
        AND p.estado = 'en_camino'
    )
  );

-- Activar Realtime para updates en tiempo real
ALTER PUBLICATION supabase_realtime ADD TABLE public.ubicaciones_repartidores;
