-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: ciudad NOT NULL + default + índice, en comercios y usuarios
-- (repartidores son usuarios con rol='repartidor' — no hay tabla aparte).
--
-- OJO: el CHECK ('Tarija','Santa Cruz') que pedía la Fase 4 NO se aplicó
-- acá a propósito. Hay datos reales fuera de ese set:
--   - 1 fila en alojamientos con ciudad = 'La Paz'
--   - 1 fila en usuarios con ciudad = 'La Paz'
-- Forzar el CHECK haría fallar la migración, y reescribirlas a 'Tarija'
-- en silencio sería inventar un cambio de ciudad sobre datos reales de
-- usuarios/alojamientos sin avisar — justo lo que las reglas duras de
-- este proyecto prohíben. Queda pendiente de decisión: ¿son datos de
-- prueba a borrar, hay que ampliar el CHECK, o se reasignan a mano?
--
-- Aplicar con (NO usar `supabase db push`):
--   npx supabase db query --linked --file supabase/migrations/20260804000300_ciudad_check_index.sql
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['negocios', 'alojamientos', 'eventos', 'usuarios']
  LOOP
    EXECUTE format('UPDATE public.%I SET ciudad = %L WHERE ciudad IS NULL', t, 'Tarija');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN ciudad SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN ciudad SET DEFAULT %L', t, 'Tarija');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (ciudad)', t || '_ciudad_idx', t);
  END LOOP;
END $$;
