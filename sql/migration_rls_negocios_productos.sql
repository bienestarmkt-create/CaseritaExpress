-- ═══════════════════════════════════════════════════════════════
-- Migración: Políticas RLS públicas para Delivery
-- Tabla: negocios, productos
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Habilitar RLS (idempotente — no falla si ya está activo)
ALTER TABLE public.negocios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

-- ── Negocios: lectura pública (anon + authenticated) ──────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'negocios'
      AND policyname = 'negocios_lectura_publica'
  ) THEN
    CREATE POLICY negocios_lectura_publica ON public.negocios
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- ── Productos: lectura pública (anon + authenticated) ─────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'productos'
      AND policyname = 'productos_lectura_publica'
  ) THEN
    CREATE POLICY productos_lectura_publica ON public.productos
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- ── Verificar que las políticas quedaron activas ──────────────
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('negocios', 'productos')
ORDER BY tablename, policyname;
