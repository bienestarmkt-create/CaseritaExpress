-- sql/webhook_notificar_pedido.sql
-- Database Webhook (vía trigger + pg_net) que invoca la Edge Function
-- notificar-pedido en cada INSERT o UPDATE de pedidos.
--
-- Este proyecto nunca activó la feature "Database Webhooks" desde el
-- dashboard, así que no existe el schema/función supabase_functions.http_request
-- que la UI genera automáticamente la primera vez que se usa. Se replica el
-- mismo resultado con pg_net directamente (net.http_post), que es lo que
-- supabase_functions.http_request llama internamente.
--
-- No requiere Authorization en el payload porque notificar-pedido se
-- deployó con --no-verify-jwt.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notificar_pedido_webhook()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://gmfjnzwmfcufgolptaoi.supabase.co/functions/v1/notificar-pedido',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = net, public;

DROP TRIGGER IF EXISTS notificar_pedido_webhook ON public.pedidos;

CREATE TRIGGER notificar_pedido_webhook
  AFTER INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION public.notificar_pedido_webhook();
