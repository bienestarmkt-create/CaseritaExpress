-- sql/trigger_proteger_pago.sql
-- Protege estado_pago y comprobante_validado de pedidos contra escritura
-- directa del cliente/negocio vía RLS.
--
-- Motivo: la policy "pedidos_update_involucrado" (scripts/rls-policies.sql)
-- permite UPDATE con USING (auth.uid() = cliente_id OR ...) sin restricción
-- de columnas. Cualquier cliente autenticado podía hacer
--   supabase.from('pedidos').update({estado_pago:'pagado_qr', comprobante_validado:true})
-- y autoconfirmarse el pago sin comprobante real.
--
-- Se implementa como trigger (no como WITH CHECK con subquery a la misma
-- tabla) porque este proyecto ya tuvo una policy recursiva
-- (admin_select_usuarios) que causó 500 en perfil.tsx.
--
-- auth.role() lee el claim "role" del JWT de la sesión actual (anon,
-- authenticated o service_role) — no consulta la tabla pedidos, así que
-- no hay riesgo de recursión.

CREATE OR REPLACE FUNCTION proteger_columnas_pago()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF NEW.estado_pago IS DISTINCT FROM OLD.estado_pago THEN
      RAISE EXCEPTION 'No autorizado: estado_pago solo puede modificarse vía service_role';
    END IF;
    IF NEW.comprobante_validado IS DISTINCT FROM OLD.comprobante_validado THEN
      RAISE EXCEPTION 'No autorizado: comprobante_validado solo puede modificarse vía service_role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proteger_columnas_pago ON pedidos;

CREATE TRIGGER trg_proteger_columnas_pago
  BEFORE UPDATE ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION proteger_columnas_pago();
