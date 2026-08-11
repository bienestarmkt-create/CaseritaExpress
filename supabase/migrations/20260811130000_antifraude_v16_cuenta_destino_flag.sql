-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: antifraude_v16 — flag check_cuenta_destino (DEFAULT FALSE).
--
-- Nuevo chequeo (implementado en validar-comprobante, ver index.ts) que
-- compara cuenta_destino/titular_destino extraídos por Vision contra
-- 4013271000001 / ALVARO FABIAN OCAMPO YUCRA, normalizado y con
-- coincidencia parcial de apellidos. Queda DESACTIVADO a propósito hasta
-- que Álvaro verifique los tests pendientes del Deploy A — se activa
-- después con: update config_validacion set valor=true where clave='check_cuenta_destino';
--
-- Aplicar con (NO usar `supabase db push`):
--   supabase db query --linked --file supabase/migrations/20260811130000_antifraude_v16_cuenta_destino_flag.sql
-- ═══════════════════════════════════════════════════════════════════════

insert into config_validacion (clave, valor) values
  ('check_cuenta_destino', false)
on conflict (clave) do nothing;
