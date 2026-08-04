-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: tarifas_envio — configuración de costo de envío por ciudad.
--
-- Antes estaba hardcodeado en dos lugares (app/carrito.tsx: Bs.8 QR /
-- Bs.12 efectivo fijo; app/delivery.tsx: texto literal "Bs. 8 envío").
-- Solo aplica a Delivery — Stay y Eventos no tienen envío (ni columna
-- costo_envio en sus tablas).
--
-- Los valores de Tarija son los que ya estaban hardcodeados (únicos
-- reales conocidos). Santa Cruz arranca con el mismo valor por no haber
-- un número real todavía — no se inventa una tarifa distinta; Álvaro
-- la ajusta cuando tenga el dato real de Santa Cruz.
--
-- Aplicar con (NO usar `supabase db push`):
--   npx supabase db query --linked --file supabase/migrations/20260804000200_tarifas_envio.sql
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tarifas_envio (
  ciudad            text PRIMARY KEY,
  tarifa_qr         numeric NOT NULL,
  tarifa_efectivo   numeric NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tarifas_envio ENABLE ROW LEVEL SECURITY;

-- Lectura pública (el cliente necesita verla para calcular el total antes
-- de pagar). Solo admin la modifica — desde el SQL editor por ahora, no
-- hay pantalla de administración de tarifas en el alcance de este ciclo.
CREATE POLICY "cualquiera_lee_tarifas_envio" ON public.tarifas_envio
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "admin_modifica_tarifas_envio" ON public.tarifas_envio
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.tarifas_envio (ciudad, tarifa_qr, tarifa_efectivo) VALUES
  ('Tarija',     8, 12),
  ('Santa Cruz', 8, 12)
ON CONFLICT (ciudad) DO NOTHING;
