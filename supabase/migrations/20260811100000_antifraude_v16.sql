-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: antifraude_v16 — comprobantes_usados (hash + numero_transaccion
-- global), config_validacion (flags por chequeo), columnas de auditoría
-- (estado_validacion, validacion_detalle) en pedidos/reservas/entradas, y
-- extensión de confirmar_pago_y_emitir_boleto para insertar en
-- comprobantes_usados dentro de la MISMA transacción que la confirmación
-- del pago (si la confirmación falla, el hash no queda registrado).
--
-- Motivo: un comprobante bancario de OTRA fecha (mismo monto exacto) fue
-- aprobado porque la unicidad de numero_transaccion no lo detectó — nunca
-- se había usado antes en la plataforma. Este set de chequeos agrega hash
-- de archivo, validación de referencia declarada por el cliente y
-- frescura de fecha (parseada del propio numero_transaccion).
--
-- Aplicar con (NO usar `supabase db push` — este proyecto tiene
-- desincronización de migraciones):
--   supabase db query --linked --file supabase/migrations/20260811100000_antifraude_v16.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ── comprobantes_usados: unicidad GLOBAL de hash de archivo y de número
-- de transacción, cruzando las tres tablas. Sin políticas RLS — acceso
-- exclusivo vía service_role (que bypassa RLS), igual que config_validacion.
create table if not exists comprobantes_usados (
  id uuid primary key default gen_random_uuid(),
  hash_archivo text not null,
  numero_transaccion text,
  modulo text not null check (modulo in ('pedidos','reservas','entradas')),
  referencia_id uuid not null,
  cliente_id uuid,
  monto numeric,
  created_at timestamptz default now()
);
create unique index if not exists idx_comprobante_hash on comprobantes_usados (hash_archivo);
create unique index if not exists idx_comprobante_nrotx on comprobantes_usados (numero_transaccion) where numero_transaccion is not null;
alter table comprobantes_usados enable row level security;

create table if not exists config_validacion (
  clave text primary key,
  valor boolean not null default true,
  updated_at timestamptz default now()
);
insert into config_validacion (clave, valor) values
  ('check_hash', true),
  ('check_referencia', true),
  ('check_frescura', true),
  ('check_monto_asimetrico', true)
on conflict (clave) do nothing;
alter table config_validacion enable row level security;

-- codigo_referencia ya existía en las tres tablas (usado por
-- app/carrito.tsx::generarReferencia — el código real que el cliente ve
-- en pago-qr.tsx y escribe en la glosa de su transferencia). Estas
-- columnas son nuevas.
alter table pedidos  add column if not exists codigo_referencia text;
alter table reservas add column if not exists codigo_referencia text;
alter table entradas add column if not exists codigo_referencia text;
alter table pedidos  add column if not exists estado_validacion text default 'pendiente';
alter table reservas add column if not exists estado_validacion text default 'pendiente';
alter table entradas add column if not exists estado_validacion text default 'pendiente';
alter table pedidos  add column if not exists validacion_detalle jsonb;
alter table reservas add column if not exists validacion_detalle jsonb;
alter table entradas add column if not exists validacion_detalle jsonb;

-- ── Backfill codigo_referencia con la MISMA derivación que
-- app/carrito.tsx::generarReferencia (primeros 8 chars del id, mayúsculas,
-- prefijo CE-PED-) — es el código que el cliente efectivamente vio y
-- pudo haber escrito en la glosa de su transferencia, NO el "#CE-<últimos
-- 8>" decorativo de app/seguimiento.tsx (ese es solo un número de pedido
-- para mostrar en pantalla, nunca se persistió ni se le pidió al cliente
-- que lo declare).
-- pedidos: 0/31 tenían codigo_referencia poblado (columna nueva, sin uso
-- previo) — se poblán todos.
-- reservas/entradas: ya estaban 100% pobladas por carrito.tsx con este
-- mismo formato — el WHERE ... IS NULL es un no-op de seguridad.
update pedidos  set codigo_referencia = 'CE-PED-' || upper(left(id::text, 8)) where codigo_referencia is null;
update reservas set codigo_referencia = 'CE-PED-' || upper(left(id::text, 8)) where codigo_referencia is null;
update entradas set codigo_referencia = 'CE-PED-' || upper(left(id::text, 8)) where codigo_referencia is null;

-- ── confirmar_pago_y_emitir_boleto: agrega p_hash_archivo y
-- p_validacion_detalle, e inserta en comprobantes_usados dentro de la
-- misma transacción plpgsql que confirma el pago y emite el boleto — si
-- cualquier paso falla, plpgsql revierte todo (ni pago confirmado, ni
-- boleto emitido, ni hash registrado).
-- DROP explícito: CREATE OR REPLACE no cambia la lista de parámetros de
-- una función existente (crearía un overload de 4 args conviviendo con
-- el de 6) — hay que tirar la firma vieja primero.
drop function if exists public.confirmar_pago_y_emitir_boleto(text, uuid, text, jsonb);

create or replace function public.confirmar_pago_y_emitir_boleto(
  p_tipo               text,
  p_id                 uuid,
  p_numero_transaccion text,
  p_datos_snapshot     jsonb,
  p_hash_archivo       text,
  p_validacion_detalle jsonb default null
)
returns public.boletos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id  uuid;
  v_comercio_id uuid;
  v_monto       numeric;
  v_ciudad      text;
  v_codigo      text;
  v_modulo      text;
  v_boleto      public.boletos;
begin
  if p_tipo = 'delivery' then
    v_modulo := 'pedidos';
    update public.pedidos
       set estado = 'confirmado', estado_pago = 'pagado_qr',
           comprobante_validado = true, numero_transaccion = p_numero_transaccion,
           estado_validacion = 'aprobado', validacion_detalle = p_validacion_detalle
     where id = p_id
     returning cliente_id, negocio_id, total into v_usuario_id, v_comercio_id, v_monto;

    if not found then
      raise exception 'Pedido % no encontrado', p_id;
    end if;

    select ciudad into v_ciudad from public.negocios where id = v_comercio_id;

  elsif p_tipo = 'stay' then
    v_modulo := 'reservas';
    update public.reservas
       set estado = 'confirmada', estado_pago = 'pagado_qr',
           comprobante_validado = true, numero_transaccion = p_numero_transaccion,
           estado_validacion = 'aprobado', validacion_detalle = p_validacion_detalle
     where id = p_id
     returning cliente_id, alojamiento_id, total into v_usuario_id, v_comercio_id, v_monto;

    if not found then
      raise exception 'Reserva % no encontrada', p_id;
    end if;

    select ciudad into v_ciudad from public.alojamientos where id = v_comercio_id;

  elsif p_tipo = 'evento' then
    v_modulo := 'entradas';
    update public.entradas
       set estado_pago = 'pagado_qr',
           comprobante_validado = true, numero_transaccion = p_numero_transaccion,
           estado_validacion = 'aprobado', validacion_detalle = p_validacion_detalle
     where id = p_id
     returning cliente_id, evento_id, total into v_usuario_id, v_comercio_id, v_monto;

    if not found then
      raise exception 'Entrada % no encontrada', p_id;
    end if;

    select ciudad into v_ciudad from public.eventos where id = v_comercio_id;

  else
    raise exception 'Tipo de transacción inválido: %', p_tipo;
  end if;

  insert into public.comprobantes_usados (
    hash_archivo, numero_transaccion, modulo, referencia_id, cliente_id, monto
  ) values (
    p_hash_archivo, p_numero_transaccion, v_modulo, p_id, v_usuario_id, v_monto
  );

  v_codigo := public.generar_codigo_boleto();

  insert into public.boletos (
    codigo, tipo, referencia_id, usuario_id, comercio_id, monto, ciudad,
    estado, datos_snapshot
  ) values (
    v_codigo, p_tipo, p_id, v_usuario_id, v_comercio_id, v_monto, coalesce(v_ciudad, 'Tarija'),
    'emitido', p_datos_snapshot
  )
  returning * into v_boleto;

  return v_boleto;
end;
$$;
