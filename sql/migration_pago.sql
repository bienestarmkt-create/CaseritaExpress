-- ═══════════════════════════════════════════════════════════════
-- Migración: Sistema de Pagos con Comprobante — CaseritaExpress
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════
-- SECCIÓN 1: DDL — crear/ampliar todas las tablas
-- ════════════════════════════════════════════════

-- ── 1a. Ampliar tabla pedidos (delivery) ──────────────────────
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS codigo_referencia TEXT,
  ADD COLUMN IF NOT EXISTS pago_estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (pago_estado IN ('pendiente','verificando','verificado','rechazado')),
  ADD COLUMN IF NOT EXISTS comprobante_url TEXT;

-- ── 1b. Tabla reservas (alojamientos / Stay) ──────────────────
CREATE TABLE IF NOT EXISTS reservas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alojamiento_id     UUID REFERENCES alojamientos(id) ON DELETE SET NULL,
  nombre_alojamiento TEXT,
  fecha_entrada      DATE,
  fecha_salida       DATE,
  huespedes          INT  NOT NULL DEFAULT 1,
  precio_noche       NUMERIC(10,2) NOT NULL DEFAULT 0,
  noches             INT  NOT NULL DEFAULT 1,
  total              NUMERIC(10,2) NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','confirmado','cancelado')),
  codigo_referencia  TEXT,
  pago_estado        TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (pago_estado IN ('pendiente','verificando','verificado','rechazado')),
  comprobante_url    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agregar columnas faltantes si la tabla ya existía antes de esta migración
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS codigo_referencia  TEXT;
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pago_estado        TEXT NOT NULL DEFAULT 'pendiente'
  CHECK (pago_estado IN ('pendiente','verificando','verificado','rechazado'));
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS comprobante_url    TEXT;

-- ── 1c. Tabla entradas (eventos) ──────────────────────────────
CREATE TABLE IF NOT EXISTS entradas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evento_id       UUID REFERENCES eventos(id) ON DELETE SET NULL,
  nombre_evento   TEXT,
  cantidad        INT  NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','confirmado','cancelado')),
  codigo_referencia TEXT,
  pago_estado     TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (pago_estado IN ('pendiente','verificando','verificado','rechazado')),
  comprobante_url TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agregar columnas faltantes si la tabla ya existía antes de esta migración
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS codigo_referencia TEXT;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS pago_estado       TEXT NOT NULL DEFAULT 'pendiente'
  CHECK (pago_estado IN ('pendiente','verificando','verificado','rechazado'));
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS comprobante_url   TEXT;

-- ═══════════════════════════════════════════════════
-- SECCIÓN 2: ÍNDICES — siempre después del DDL completo
-- ═══════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_codigo_referencia_idx
  ON pedidos (codigo_referencia)
  WHERE codigo_referencia IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservas_codigo_referencia_idx
  ON reservas (codigo_referencia)
  WHERE codigo_referencia IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entradas_codigo_referencia_idx
  ON entradas (codigo_referencia)
  WHERE codigo_referencia IS NOT NULL;

-- ════════════════════════════
-- SECCIÓN 3: RLS Y POLÍTICAS
-- ════════════════════════════

ALTER TABLE reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE entradas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- reservas
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservas' AND policyname='cliente_ve_reservas') THEN
    CREATE POLICY cliente_ve_reservas ON reservas
      FOR SELECT TO authenticated USING (cliente_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservas' AND policyname='cliente_inserta_reservas') THEN
    CREATE POLICY cliente_inserta_reservas ON reservas
      FOR INSERT TO authenticated WITH CHECK (cliente_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservas' AND policyname='service_actualiza_reservas') THEN
    CREATE POLICY service_actualiza_reservas ON reservas
      FOR UPDATE USING (true);
  END IF;
  -- entradas
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='entradas' AND policyname='cliente_ve_entradas') THEN
    CREATE POLICY cliente_ve_entradas ON entradas
      FOR SELECT TO authenticated USING (cliente_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='entradas' AND policyname='cliente_inserta_entradas') THEN
    CREATE POLICY cliente_inserta_entradas ON entradas
      FOR INSERT TO authenticated WITH CHECK (cliente_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='entradas' AND policyname='service_actualiza_entradas') THEN
    CREATE POLICY service_actualiza_entradas ON entradas
      FOR UPDATE USING (true);
  END IF;
  -- pedidos (permite que service_role actualice pago_estado)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pedidos' AND policyname='service_actualiza_pedidos') THEN
    CREATE POLICY service_actualiza_pedidos ON pedidos
      FOR UPDATE USING (true);
  END IF;
END $$;

-- ══════════════════════════════════════
-- SECCIÓN 4: STORAGE BUCKET comprobantes
-- ══════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes',
  'comprobantes',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comprobantes_upload'
  ) THEN
    CREATE POLICY comprobantes_upload ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'comprobantes' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comprobantes_read'
  ) THEN
    CREATE POLICY comprobantes_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'comprobantes' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comprobantes_upsert'
  ) THEN
    CREATE POLICY comprobantes_upsert ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'comprobantes' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;
