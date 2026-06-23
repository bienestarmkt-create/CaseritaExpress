-- migration_pago_altoke.sql
-- Nuevas columnas para el flujo de pago ALTOKE (QR + Efectivo)
-- Ejecutar en Supabase SQL Editor

-- ── 1. Columnas en pedidos ────────────────────────────────────────────────────

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS metodo_pago          TEXT    NOT NULL DEFAULT 'qr'
      CHECK (metodo_pago IN ('qr', 'efectivo')),
  ADD COLUMN IF NOT EXISTS estado_pago          TEXT    NOT NULL DEFAULT 'pendiente'
      CHECK (estado_pago IN ('pendiente', 'pagado_qr', 'cobrado_efectivo', 'liquidado')),
  ADD COLUMN IF NOT EXISTS costo_envio          NUMERIC(10, 2) NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS referencia_pago      TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_validado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intentos_validacion  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repartidor_cobro_efectivo BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice único para referencia_pago (ignorar NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_referencia_pago
  ON pedidos (referencia_pago)
  WHERE referencia_pago IS NOT NULL;

-- ── 2. Tabla liquidaciones_diarias ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS liquidaciones_diarias (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id    UUID        REFERENCES negocios(id) ON DELETE SET NULL,
  usuario_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  fecha         DATE        NOT NULL,
  pedido_ids    UUID[]      NOT NULL DEFAULT '{}',
  total_ventas  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_envio   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_liquido NUMERIC(10, 2) NOT NULL DEFAULT 0,
  estado        TEXT        NOT NULL DEFAULT 'pendiente'
      CHECK (estado IN ('pendiente', 'pagado', 'cancelado')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultas por negocio y fecha
CREATE INDEX IF NOT EXISTS idx_liquidaciones_negocio_fecha
  ON liquidaciones_diarias (negocio_id, fecha DESC);

-- ── 3. RLS liquidaciones_diarias ──────────────────────────────────────────────

ALTER TABLE liquidaciones_diarias ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Anfitrión/negocio ve sus propias liquidaciones
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'liquidaciones_diarias' AND policyname = 'liquidaciones_propias'
  ) THEN
    CREATE POLICY liquidaciones_propias ON liquidaciones_diarias
      FOR SELECT USING (auth.uid() = usuario_id);
  END IF;

  -- Service role puede insertar/actualizar (desde Edge Functions)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'liquidaciones_diarias' AND policyname = 'liquidaciones_service_insert'
  ) THEN
    CREATE POLICY liquidaciones_service_insert ON liquidaciones_diarias
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
