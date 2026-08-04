-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: tabla `ciudades` — reemplaza el CHECK de ciudad que nunca
-- se pudo aplicar (20260804000300 lo dejó pendiente: había 1 alojamiento
-- y 1 usuario/repartidor reales con ciudad='La Paz', fuera del set
-- Tarija/Santa Cruz).
--
-- Decisión: La Paz queda como ciudad registrada pero INACTIVA. No se
-- borra ni se reasigna el alojamiento ni el usuario que ya la tienen —
-- siguen apuntando a 'La Paz' vía FK, solo que esa ciudad no aparece
-- como opción para nadie nuevo.
--
-- Tarifas: se mantienen las dos columnas (qr / efectivo) que ya existían
-- en tarifas_envio — cero cambio de precio para el cliente. Esa tabla
-- queda deprecada: `ciudades` es la única fuente de verdad de ahora en
-- más.
--
-- Aplicar con (NO usar `supabase db push`):
--   npx supabase db query --linked --file supabase/migrations/20260805000000_tabla_ciudades.sql
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ciudades (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  text NOT NULL UNIQUE,
  activa                  boolean NOT NULL DEFAULT false,
  tarifa_envio_qr         numeric,
  tarifa_envio_efectivo   numeric,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ciudades ENABLE ROW LEVEL SECURITY;

-- Lectura pública: el cliente necesita ver TODAS las ciudades (activas
-- para el selector, e inactivas para detectar "tu ciudad ya no está
-- activa, elegí otra" sin reasignar nada solo).
CREATE POLICY "cualquiera_lee_ciudades" ON public.ciudades
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "admin_modifica_ciudades" ON public.ciudades
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Migrar tarifas_envio → ciudades (Tarija, Santa Cruz), leyendo los
-- valores reales en vez de hardcodearlos de nuevo.
INSERT INTO public.ciudades (nombre, activa, tarifa_envio_qr, tarifa_envio_efectivo)
SELECT ciudad, true, tarifa_qr, tarifa_efectivo
FROM public.tarifas_envio
WHERE ciudad IN ('Tarija', 'Santa Cruz')
ON CONFLICT (nombre) DO NOTHING;

-- La Paz: inactiva, sin tarifa (no hay dato real, no se inventa uno).
INSERT INTO public.ciudades (nombre, activa, tarifa_envio_qr, tarifa_envio_efectivo)
VALUES ('La Paz', false, NULL, NULL)
ON CONFLICT (nombre) DO NOTHING;

-- Deprecar tarifas_envio — ciudades es la única fuente de verdad.
DROP TABLE IF EXISTS public.tarifas_envio;

-- FK desde las columnas ciudad existentes (siguen siendo TEXT con el
-- nombre de la ciudad, no se migra a un ciudad_id — evita tocar toda la
-- app que hoy lee/escribe ciudad como string). Los 3 valores reales que
-- existen hoy (Tarija, Santa Cruz, La Paz) ya están todos en `ciudades`,
-- así que el FK aplica limpio sin romper ninguna fila existente.
ALTER TABLE public.negocios
  ADD CONSTRAINT negocios_ciudad_fkey FOREIGN KEY (ciudad) REFERENCES public.ciudades(nombre);
ALTER TABLE public.alojamientos
  ADD CONSTRAINT alojamientos_ciudad_fkey FOREIGN KEY (ciudad) REFERENCES public.ciudades(nombre);
ALTER TABLE public.eventos
  ADD CONSTRAINT eventos_ciudad_fkey FOREIGN KEY (ciudad) REFERENCES public.ciudades(nombre);
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_ciudad_fkey FOREIGN KEY (ciudad) REFERENCES public.ciudades(nombre);

-- Por si alguna vez se agregó un CHECK de ciudad por fuera de esta
-- sesión — no debería existir ninguno (verificado contra la DB real
-- antes de escribir esta migración), pero queda defensivo.
ALTER TABLE public.negocios     DROP CONSTRAINT IF EXISTS negocios_ciudad_check;
ALTER TABLE public.alojamientos DROP CONSTRAINT IF EXISTS alojamientos_ciudad_check;
ALTER TABLE public.eventos      DROP CONSTRAINT IF EXISTS eventos_ciudad_check;
ALTER TABLE public.usuarios     DROP CONSTRAINT IF EXISTS usuarios_ciudad_check;
