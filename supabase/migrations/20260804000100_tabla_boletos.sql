-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: tabla boletos (cierre del ciclo para Stay y Eventos) +
-- función atómica de confirmación de pago + emisión de boleto.
--
-- El boleto se emite en la MISMA transacción en que se confirma el pago:
-- confirmar_pago_y_emitir_boleto() hace el UPDATE de la tabla de origen
-- (pedidos/reservas/entradas) y el INSERT en boletos dentro de un único
-- bloque plpgsql — si algo falla, plpgsql revierte toda la función
-- (todo o nada), no hay forma de que quede un pago confirmado sin boleto
-- ni un boleto sin pago confirmado.
--
-- Aplicar con (NO usar `supabase db push`):
--   npx supabase db query --linked --file supabase/migrations/20260804000100_tabla_boletos.sql
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.boletos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              text NOT NULL UNIQUE,
  tipo                text NOT NULL CHECK (tipo = ANY (ARRAY['delivery'::text, 'stay'::text, 'evento'::text])),
  -- referencia_id y comercio_id son polimórficas (apuntan a pedidos/
  -- reservas/entradas y a negocios/alojamientos/eventos según `tipo`) —
  -- sin FK, resueltas en código/RLS a partir de `tipo`.
  referencia_id       uuid NOT NULL,
  usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
  comercio_id         uuid NOT NULL,
  monto               numeric NOT NULL,
  ciudad              text NOT NULL,
  estado              text NOT NULL DEFAULT 'emitido'
                        CHECK (estado = ANY (ARRAY['emitido'::text, 'usado'::text, 'vencido'::text, 'anulado'::text])),
  fecha_emision       timestamptz NOT NULL DEFAULT now(),
  fecha_uso           timestamptz,
  fecha_vencimiento   timestamptz,
  datos_snapshot      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boletos_usuario_id_idx  ON public.boletos (usuario_id);
CREATE INDEX IF NOT EXISTS boletos_comercio_id_idx ON public.boletos (comercio_id);
CREATE INDEX IF NOT EXISTS boletos_referencia_idx  ON public.boletos (tipo, referencia_id);

ALTER TABLE public.boletos ENABLE ROW LEVEL SECURITY;

-- Cliente ve los suyos
CREATE POLICY "cliente_ve_sus_boletos" ON public.boletos
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

-- Comercio ve los boletos de SU negocio/alojamiento/evento (según tipo).
-- Para delivery, el repartidor asignado al pedido también (los necesita
-- para marcarlos usados al entregar).
CREATE POLICY "comercio_ve_sus_boletos" ON public.boletos
  FOR SELECT TO authenticated
  USING (
    (tipo = 'delivery' AND (
      EXISTS (SELECT 1 FROM public.negocios n WHERE n.id = comercio_id AND n.usuario_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = referencia_id AND p.repartidor_id = auth.uid())
    ))
    OR (tipo = 'stay'    AND EXISTS (SELECT 1 FROM public.alojamientos a WHERE a.id = comercio_id AND a.usuario_id = auth.uid()))
    OR (tipo = 'evento'  AND EXISTS (SELECT 1 FROM public.eventos e WHERE e.id = comercio_id AND e.usuario_id = auth.uid()))
  );

-- Comercio puede marcar como usado (y solo eso: estado + fecha_uso, ver
-- función marcar_boleto_usado más abajo, que es el único camino previsto
-- para escribir desde el portal empresas). Para delivery, el repartidor
-- asignado al pedido también puede — es quien marca al entregar, no el
-- dueño del negocio.
CREATE POLICY "comercio_actualiza_sus_boletos" ON public.boletos
  FOR UPDATE TO authenticated
  USING (
    (tipo = 'delivery' AND (
      EXISTS (SELECT 1 FROM public.negocios n WHERE n.id = comercio_id AND n.usuario_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = referencia_id AND p.repartidor_id = auth.uid())
    ))
    OR (tipo = 'stay'    AND EXISTS (SELECT 1 FROM public.alojamientos a WHERE a.id = comercio_id AND a.usuario_id = auth.uid()))
    OR (tipo = 'evento'  AND EXISTS (SELECT 1 FROM public.eventos e WHERE e.id = comercio_id AND e.usuario_id = auth.uid()))
  )
  WITH CHECK (
    (tipo = 'delivery' AND (
      EXISTS (SELECT 1 FROM public.negocios n WHERE n.id = comercio_id AND n.usuario_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = referencia_id AND p.repartidor_id = auth.uid())
    ))
    OR (tipo = 'stay'    AND EXISTS (SELECT 1 FROM public.alojamientos a WHERE a.id = comercio_id AND a.usuario_id = auth.uid()))
    OR (tipo = 'evento'  AND EXISTS (SELECT 1 FROM public.eventos e WHERE e.id = comercio_id AND e.usuario_id = auth.uid()))
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.boletos;

-- ── Generador de código legible en voz alta ───────────────────────────
-- Alfabeto sin 0/O/1/I/L (se confunden al dictarlos), formato CE-XXXXXX.
CREATE OR REPLACE FUNCTION public.generar_codigo_boleto()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alfabeto  text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidato text;
  intento   int := 0;
BEGIN
  LOOP
    candidato := 'CE-';
    FOR i IN 1..6 LOOP
      candidato := candidato || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.boletos b WHERE b.codigo = candidato);
    intento := intento + 1;
    IF intento > 20 THEN
      RAISE EXCEPTION 'No se pudo generar un código de boleto único tras % intentos', intento;
    END IF;
  END LOOP;
  RETURN candidato;
END;
$$;

-- ── Confirmación de pago + emisión de boleto, atómica ─────────────────
-- Llamada desde supabase/functions/validar-comprobante con el cliente
-- service_role (bypassa RLS). SECURITY DEFINER además por si alguna vez
-- se llama con un rol distinto. Si cualquier paso falla, plpgsql revierte
-- toda la función — no hay estado parcial posible.
CREATE OR REPLACE FUNCTION public.confirmar_pago_y_emitir_boleto(
  p_tipo               text,
  p_id                 uuid,
  p_numero_transaccion text,
  p_datos_snapshot     jsonb
)
RETURNS public.boletos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id  uuid;
  v_comercio_id uuid;
  v_monto       numeric;
  v_ciudad      text;
  v_codigo      text;
  v_boleto      public.boletos;
BEGIN
  IF p_tipo = 'delivery' THEN
    UPDATE public.pedidos
       SET estado = 'confirmado', estado_pago = 'pagado_qr',
           comprobante_validado = true, numero_transaccion = p_numero_transaccion
     WHERE id = p_id
     RETURNING cliente_id, negocio_id, total INTO v_usuario_id, v_comercio_id, v_monto;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pedido % no encontrado', p_id;
    END IF;

    SELECT ciudad INTO v_ciudad FROM public.negocios WHERE id = v_comercio_id;

  ELSIF p_tipo = 'stay' THEN
    UPDATE public.reservas
       SET estado = 'confirmada', estado_pago = 'pagado_qr',
           comprobante_validado = true, numero_transaccion = p_numero_transaccion
     WHERE id = p_id
     RETURNING cliente_id, alojamiento_id, total INTO v_usuario_id, v_comercio_id, v_monto;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reserva % no encontrada', p_id;
    END IF;

    SELECT ciudad INTO v_ciudad FROM public.alojamientos WHERE id = v_comercio_id;

  ELSIF p_tipo = 'evento' THEN
    UPDATE public.entradas
       SET estado_pago = 'pagado_qr',
           comprobante_validado = true, numero_transaccion = p_numero_transaccion
     WHERE id = p_id
     RETURNING cliente_id, evento_id, total INTO v_usuario_id, v_comercio_id, v_monto;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Entrada % no encontrada', p_id;
    END IF;

    SELECT ciudad INTO v_ciudad FROM public.eventos WHERE id = v_comercio_id;

  ELSE
    RAISE EXCEPTION 'Tipo de transacción inválido: %', p_tipo;
  END IF;

  v_codigo := public.generar_codigo_boleto();

  INSERT INTO public.boletos (
    codigo, tipo, referencia_id, usuario_id, comercio_id, monto, ciudad,
    estado, datos_snapshot
  ) VALUES (
    v_codigo, p_tipo, p_id, v_usuario_id, v_comercio_id, v_monto, COALESCE(v_ciudad, 'Tarija'),
    'emitido', p_datos_snapshot
  )
  RETURNING * INTO v_boleto;

  RETURN v_boleto;
END;
$$;

-- ── Marcar boleto como usado (portal empresas / repartidor) ───────────
-- Función en vez de UPDATE directo desde el cliente: fuerza la regla de
-- "nunca permitir doble uso" server-side, no solo en la UI.
CREATE OR REPLACE FUNCTION public.marcar_boleto_usado(p_codigo text)
RETURNS public.boletos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_boleto public.boletos;
BEGIN
  SELECT * INTO v_boleto FROM public.boletos WHERE codigo = upper(p_codigo);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe un boleto con código %', p_codigo;
  END IF;

  IF v_boleto.estado = 'usado' THEN
    RETURN v_boleto; -- idempotente: el caller decide qué mostrar según fecha_uso
  END IF;

  IF v_boleto.estado <> 'emitido' THEN
    RAISE EXCEPTION 'Este boleto está %, no se puede marcar como usado', v_boleto.estado;
  END IF;

  UPDATE public.boletos
     SET estado = 'usado', fecha_uso = now()
   WHERE codigo = upper(p_codigo)
     AND estado = 'emitido' -- doble chequeo anti-carrera
   RETURNING * INTO v_boleto;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este boleto ya fue usado';
  END IF;

  RETURN v_boleto;
END;
$$;
