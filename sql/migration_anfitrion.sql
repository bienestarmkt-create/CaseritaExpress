-- ═══════════════════════════════════════════════════════════════════════════
-- migration_anfitrion.sql
-- Panel Anfitrión — CaseritaExpress
--
-- Qué hace este archivo:
--   1. Amplía el CHECK de profiles.rol para incluir 'anfitrion'
--   2. Agrega imagen_url a productos (si no existe)
--   3. Función helper is_anfitrion()
--   4. RLS: anfitrión lee/edita su propio negocio
--   5. RLS: anfitrión lee pedidos de su negocio y puede cambiar estado
--   6. RLS: anfitrión CRUD de sus propios productos
--
-- INSTRUCCIONES:
--   Supabase Dashboard → SQL Editor → pegar todo y ejecutar.
--
-- ─── PASO PREVIO MANUAL (Dashboard, NO SQL) ────────────────────────────────
-- Crear dos Storage Buckets con acceso PÚBLICO:
--   1. Nombre: negocios-fotos
--      - Public bucket: true
--      - Allowed MIME types: image/jpeg, image/png, image/webp
--      - Max file size: 5 MB
--   2. Nombre: productos-fotos
--      - Public bucket: true
--      - Allowed MIME types: image/jpeg, image/png, image/webp
--      - Max file size: 3 MB
--
-- Cómo crearlos:
--   Storage → New bucket → escribir nombre → marcar "Public bucket" → Save
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AMPLIAR CHECK CONSTRAINT de profiles.rol
--    Paso A: quitar el constraint viejo (nombre exacto depende de tu esquema)
--    Paso B: agregar uno nuevo con los 4 roles
-- ─────────────────────────────────────────────────────────────────────────────

-- Eliminar constraint existente (puede llamarse distinto — ajusta si falla)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_rol_check;

-- Volver a agregar con 'anfitrion' incluido
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_rol_check
  CHECK (rol IN ('cliente', 'repartidor', 'admin', 'anfitrion'));

COMMENT ON COLUMN public.profiles.rol IS
  'Rol del usuario: cliente | repartidor | admin | anfitrion.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLA negocio_fotos
--    Almacena las URLs de las fotos del local (máximo 5 por negocio).
--    El código de fotos.tsx usa: supabase.from('negocio_fotos').insert/select/delete
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.negocio_fotos (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  negocio_id  UUID        NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.negocio_fotos IS
  'Fotos del local del negocio. Máximo 5 por negocio. URLs apuntan al bucket negocios-fotos.';
COMMENT ON COLUMN public.negocio_fotos.url IS
  'URL pública en Supabase Storage bucket negocios-fotos.';

-- Índice para buscar fotos por negocio rápidamente
CREATE INDEX IF NOT EXISTS idx_negocio_fotos_negocio_id
  ON public.negocio_fotos (negocio_id);

-- RLS para negocio_fotos
ALTER TABLE public.negocio_fotos ENABLE ROW LEVEL SECURITY;

-- Lectura pública (clientes pueden ver fotos del local)
DROP POLICY IF EXISTS "fotos_negocio_lectura_publica" ON public.negocio_fotos;
CREATE POLICY "fotos_negocio_lectura_publica"
  ON public.negocio_fotos
  FOR SELECT TO anon, authenticated
  USING (true);

-- El anfitrión puede insertar fotos de su propio negocio
DROP POLICY IF EXISTS "anfitrion_inserta_foto_negocio" ON public.negocio_fotos;
CREATE POLICY "anfitrion_inserta_foto_negocio"
  ON public.negocio_fotos
  FOR INSERT TO authenticated
  WITH CHECK (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion());

-- El anfitrión puede eliminar fotos de su propio negocio
DROP POLICY IF EXISTS "anfitrion_elimina_foto_negocio" ON public.negocio_fotos;
CREATE POLICY "anfitrion_elimina_foto_negocio"
  ON public.negocio_fotos
  FOR DELETE TO authenticated
  USING (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion());

-- El admin puede hacer todo
DROP POLICY IF EXISTS "admin_crud_negocio_fotos" ON public.negocio_fotos;
CREATE POLICY "admin_crud_negocio_fotos"
  ON public.negocio_fotos
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COLUMNA imagen_url EN productos (si no existe)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS imagen_url TEXT DEFAULT NULL;

COMMENT ON COLUMN public.productos.imagen_url IS
  'URL pública de la foto del producto en Storage bucket productos-fotos.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FUNCIÓN HELPER: is_anfitrion()
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_anfitrion()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id  = auth.uid()
      AND rol = 'anfitrion'
  );
$$;

COMMENT ON FUNCTION public.is_anfitrion()
  IS 'Devuelve true si el usuario autenticado tiene rol anfitrion.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FUNCIÓN HELPER: get_mi_negocio_id()
--    Retorna el negocio_id del anfitrión autenticado.
--    Usada en las políticas RLS para filtrar pedidos y productos.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_mi_negocio_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.negocios
  WHERE usuario_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_mi_negocio_id()
  IS 'Retorna el UUID del negocio cuyo usuario_id coincide con el usuario autenticado.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — negocios
--    El anfitrión puede leer y actualizar su propio negocio.
-- ─────────────────────────────────────────────────────────────────────────────

-- El anfitrión lee su propio negocio (además de la política pública existente)
DROP POLICY IF EXISTS "anfitrion_lee_su_negocio" ON public.negocios;
CREATE POLICY "anfitrion_lee_su_negocio"
  ON public.negocios
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

-- El anfitrión actualiza su propio negocio (nombre, descripción, etc.)
-- NO puede cambiar activo (eso lo hace el admin)
DROP POLICY IF EXISTS "anfitrion_actualiza_su_negocio" ON public.negocios;
CREATE POLICY "anfitrion_actualiza_su_negocio"
  ON public.negocios
  FOR UPDATE TO authenticated
  USING  (usuario_id = auth.uid() AND public.is_anfitrion())
  WITH CHECK (usuario_id = auth.uid() AND public.is_anfitrion());

-- El anfitrión puede insertar su negocio (cuando se registra desde /anfitrion)
DROP POLICY IF EXISTS "anfitrion_inserta_su_negocio" ON public.negocios;
CREATE POLICY "anfitrion_inserta_su_negocio"
  ON public.negocios
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND public.is_anfitrion());


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — pedidos
--    El anfitrión puede leer pedidos de su negocio y cambiar su estado.
-- ─────────────────────────────────────────────────────────────────────────────

-- El anfitrión lee los pedidos de su negocio
DROP POLICY IF EXISTS "anfitrion_lee_pedidos_de_su_negocio" ON public.pedidos;
CREATE POLICY "anfitrion_lee_pedidos_de_su_negocio"
  ON public.pedidos
  FOR SELECT TO authenticated
  USING (
    cliente_id  = auth.uid()                        -- el propio cliente
    OR public.is_admin()                             -- el admin ve todo
    OR negocio_id = public.get_mi_negocio_id()       -- el anfitrión ve sus pedidos
    -- repartidor_id = auth.uid() lo agrega la política de repartidor si existe
  );

-- El anfitrión puede actualizar el estado de pedidos de su negocio
DROP POLICY IF EXISTS "anfitrion_actualiza_estado_pedido" ON public.pedidos;
CREATE POLICY "anfitrion_actualiza_estado_pedido"
  ON public.pedidos
  FOR UPDATE TO authenticated
  USING  (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion())
  WITH CHECK (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion());


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — productos
--    El anfitrión hace CRUD completo de sus propios productos.
-- ─────────────────────────────────────────────────────────────────────────────

-- El anfitrión lee sus productos
DROP POLICY IF EXISTS "anfitrion_lee_sus_productos" ON public.productos;
CREATE POLICY "anfitrion_lee_sus_productos"
  ON public.productos
  FOR SELECT TO authenticated
  USING (
    disponible = true                                -- clientes ven activos
    OR negocio_id = public.get_mi_negocio_id()       -- anfitrión ve todos los suyos
    OR public.is_admin()
  );

-- El anfitrión inserta productos de su negocio
DROP POLICY IF EXISTS "anfitrion_inserta_productos" ON public.productos;
CREATE POLICY "anfitrion_inserta_productos"
  ON public.productos
  FOR INSERT TO authenticated
  WITH CHECK (
    negocio_id = public.get_mi_negocio_id()
    AND public.is_anfitrion()
  );

-- El anfitrión actualiza productos de su negocio
DROP POLICY IF EXISTS "anfitrion_actualiza_productos" ON public.productos;
CREATE POLICY "anfitrion_actualiza_productos"
  ON public.productos
  FOR UPDATE TO authenticated
  USING  (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion())
  WITH CHECK (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion());

-- El anfitrión elimina productos de su negocio
DROP POLICY IF EXISTS "anfitrion_elimina_productos" ON public.productos;
CREATE POLICY "anfitrion_elimina_productos"
  ON public.productos
  FOR DELETE TO authenticated
  USING (negocio_id = public.get_mi_negocio_id() AND public.is_anfitrion());


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — Storage: negocios-fotos
--    Crear las políticas DESPUÉS de crear el bucket manualmente.
--    Descomenta y ejecuta este bloque una vez creado el bucket.
-- ─────────────────────────────────────────────────────────────────────────────

/*
-- Anfitrión sube fotos a su carpeta (negocio_id como prefijo)
CREATE POLICY "anfitrion_sube_fotos_negocio"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'negocios-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_negocio_id()::text
  );

-- Anfitrión elimina sus fotos
CREATE POLICY "anfitrion_elimina_fotos_negocio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'negocios-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_negocio_id()::text
  );

-- Lectura pública de fotos de negocios
CREATE POLICY "fotos_negocio_publicas"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'negocios-fotos');
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS — Storage: productos-fotos
--    Igual: descomenta DESPUÉS de crear el bucket.
-- ─────────────────────────────────────────────────────────────────────────────

/*
CREATE POLICY "anfitrion_sube_fotos_productos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'productos-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_negocio_id()::text
  );

CREATE POLICY "anfitrion_elimina_fotos_productos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'productos-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_negocio_id()::text
  );

CREATE POLICY "fotos_productos_publicas"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'productos-fotos');
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'profiles'       AND column_name = 'rol')
    OR (table_name = 'productos'   AND column_name = 'imagen_url')
    OR (table_name = 'negocio_fotos' AND column_name IN ('id', 'negocio_id', 'url'))
  )
ORDER BY table_name, column_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN: migration_anfitrion.sql
-- ═══════════════════════════════════════════════════════════════════════════
