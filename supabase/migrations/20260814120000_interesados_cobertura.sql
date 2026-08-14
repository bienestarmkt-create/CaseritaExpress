-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: tabla `interesados_cobertura` — captura de demanda cuando
-- la geolocalización detecta al visitante en una ciudad INACTIVA
-- (Cochabamba, La Paz) o fuera de todo radio de cobertura (ver
-- context/CiudadContext.tsx + components/FueraCobertura.tsx). En vez de
-- mostrarle un catálogo vacío o de otra ciudad, se le pide el WhatsApp
-- para avisarle cuando abramos ahí — convierte un rechazo en señal real
-- de dónde expandir.
--
-- Aplicar con (NO usar `supabase db push`, mismo criterio que
-- 20260805000000_tabla_ciudades.sql):
--   npx supabase db query --linked --file supabase/migrations/20260814120000_interesados_cobertura.sql
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.interesados_cobertura (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp          text NOT NULL,
  latitud           numeric,
  longitud          numeric,
  ciudad_detectada  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interesados_cobertura ENABLE ROW LEVEL SECURITY;

-- Insert público: esta pantalla se ve ANTES de cualquier login (es lo
-- que reemplaza el catálogo cuando no hay cobertura), así que anon
-- también tiene que poder escribir acá.
CREATE POLICY "cualquiera_deja_su_whatsapp" ON public.interesados_cobertura
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Sin policy de SELECT/UPDATE/DELETE para anon/authenticated: con RLS
-- activo eso los deja bloqueados por defecto (mismo patrón que el resto
-- de la app — ver 20260716010000_restringir_service_actualiza_a_service_role.sql).
-- Solo service_role (que bypasea RLS) puede leer estos leads.
