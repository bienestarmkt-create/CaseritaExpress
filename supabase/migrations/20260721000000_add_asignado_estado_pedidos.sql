-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: agregar 'asignado' a pedidos_estado_check
--
-- Motivo: el flujo de "Tomar pedido" del pool de repartidores
-- (app/repartidor/pedidos.tsx, función tomarPedido) necesita setear
-- estado='asignado' al asignar un repartidor a un pedido confirmado sin
-- repartidor. El constraint vigente no incluía ese valor, por lo que el
-- UPDATE fallaba siempre con:
--   ERROR 23514 (check_violation): pedidos_estado_check
-- confirmado probando el UPDATE literal contra la base real (2026-07-21).
--
-- Valores previos del constraint: pendiente, confirmado, preparando,
-- en_camino, entregado, cancelado. Se agrega 'asignado'; el resto se
-- mantiene igual (no se tocan 'listo' ni 'en_preparacion' — quedan
-- pendientes de una decisión y migración separadas).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pedidos DROP CONSTRAINT pedidos_estado_check;

ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_check
  CHECK (estado = ANY (ARRAY[
    'pendiente'::text,
    'confirmado'::text,
    'asignado'::text,
    'preparando'::text,
    'en_camino'::text,
    'entregado'::text,
    'cancelado'::text
  ]));
