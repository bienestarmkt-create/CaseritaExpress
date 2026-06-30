-- ─────────────────────────────────────────────────────────────────────────────
-- migration_push_token.sql
-- Agrega columna push_token a la tabla usuarios para push notifications native.
--
-- INSTRUCCIONES:
--   1. Abrir Supabase Dashboard → SQL Editor
--   2. Ejecutar este archivo completo
--   3. No requiere datos previos — la columna arranca en NULL para todos los
--      usuarios existentes y se poblará la próxima vez que inicien sesión
--      en un dispositivo físico con expo-notifications instalado.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Agregar columna push_token a usuarios (si no existe)
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT NULL;

-- 2. Índice para búsquedas rápidas por token (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_usuarios_push_token
  ON public.usuarios (push_token)
  WHERE push_token IS NOT NULL;

-- 3. Comentario descriptivo
COMMENT ON COLUMN public.usuarios.push_token IS
  'Expo Push Token del dispositivo nativo. Se registra via lib/notifications.ts#registerPushToken(). NULL en web (usa web-push) o si el usuario denegó permisos.';
