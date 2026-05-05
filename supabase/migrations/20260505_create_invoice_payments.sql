-- 20260505_create_invoice_payments.sql
--
-- Per-payment ledger for invoice_applications. Multiple payments per App
-- allowed (partial payments + corrections). Triggered status maintenance:
--   filed → paid  when SUM(payments) >= net_due
--   paid  → filed when payments are deleted/reduced below net_due
-- Other statuses (draft, void) are not auto-flipped — manual control only.
--
-- The Phase A invoice_applications schema already had paid_at + paid_amount
-- columns reserved; this migration wires them via the new payments table
-- + trigger. paid_at = MAX(payment_date) of payments that close the App.
--
-- ON DELETE CASCADE on invoice_application_id — if an App is removed,
-- its payments go with it (rare; mostly for void / orphan-draft cleanup).

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_application_id   uuid NOT NULL REFERENCES public.invoice_applications(id) ON DELETE CASCADE,
  payment_date             date NOT NULL DEFAULT CURRENT_DATE,
  amount                   numeric(12,2) NOT NULL CHECK (amount > 0),
  method                   text CHECK (method IN ('check','wire','ach','cash','credit','other')),
  reference                text,
  notes                    text,
  recorded_by              text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_invoice_payments_app
  ON public.invoice_payments (invoice_application_id);
CREATE INDEX IF NOT EXISTS ix_invoice_payments_date
  ON public.invoice_payments (payment_date);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.invoice_payments;
CREATE POLICY "public access" ON public.invoice_payments
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.invoice_payments IS
  'Per-payment ledger for invoice_applications. Multiple payments per App allowed (partial payments + corrections). The trg_apply_payment_to_application trigger keeps invoice_applications.paid_amount + paid_at + status in lockstep with the SUM of payments.';

CREATE OR REPLACE FUNCTION public.fn_apply_payment_to_application()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_app_id uuid;
  v_total_paid numeric;
  v_net_due numeric;
  v_current_status text;
  v_latest_payment_at timestamptz;
BEGIN
  v_app_id := COALESCE(NEW.invoice_application_id, OLD.invoice_application_id);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total_paid
    FROM public.invoice_payments
   WHERE invoice_application_id = v_app_id;

  SELECT MAX(payment_date)
    INTO v_latest_payment_at
    FROM public.invoice_payments
   WHERE invoice_application_id = v_app_id;

  SELECT net_due, status
    INTO v_net_due, v_current_status
    FROM public.invoice_applications
   WHERE id = v_app_id;

  -- Status flip rules:
  --   filed → paid  when total_paid >= net_due (and net_due > 0)
  --   paid  → filed when total_paid <  net_due (e.g. payment was deleted)
  --   draft / void  → unchanged (manual control)
  UPDATE public.invoice_applications
     SET paid_amount = v_total_paid,
         paid_at = CASE
                     WHEN v_total_paid > 0 AND v_total_paid >= COALESCE(v_net_due, 0)
                     THEN COALESCE(v_latest_payment_at, CURRENT_DATE)::timestamptz
                     ELSE NULL
                   END,
         status = CASE
                    WHEN v_total_paid >= COALESCE(v_net_due, 0)
                         AND v_total_paid > 0
                         AND v_current_status = 'filed' THEN 'paid'
                    WHEN v_total_paid < COALESCE(v_net_due, 0)
                         AND v_current_status = 'paid' THEN 'filed'
                    ELSE v_current_status
                  END,
         updated_at = now()
   WHERE id = v_app_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_payment_to_application ON public.invoice_payments;
CREATE TRIGGER trg_apply_payment_to_application
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_apply_payment_to_application();
