-- 20260505_backfill_synthetic_apps.sql
--
-- Phase A.5 of the Accounting Sheet / Billing Engine — synthetic backfill.
--
-- For every existing invoice_entries row, generate one invoice_applications
-- row with status='filed', source_invoice_entry_id pointing at the source,
-- and per-job app_number assigned in invoice_date order.
--
-- The post-on-file trigger short-circuits when source_invoice_entry_id is
-- non-null, so this insert does NOT cascade back into invoice_entries.
-- The compute-totals trigger only fires on application_lines writes (not
-- header writes), so the header values we explicitly set here are the
-- final stored values for synthetic apps.
--
-- Synthetic apps have NO invoice_application_lines rows. The Acct Sheet
-- UI shows them as "App #N (legacy import — no stage detail)" and
-- displays only the header totals.
--
-- Idempotent: safe to re-run. Skips invoice_entries rows that already
-- have a synthetic app pointing at them.
--
-- NOTE: invoice_entries.billing_month is TEXT in 'YYYY-MM' format
-- (verified 2026-05-05). Parsed via TO_DATE with a regex guard; falls
-- back to invoice_date / created_at month when billing_month is null
-- or non-conforming.

DO $$
DECLARE
  v_entry             record;
  v_billed_to_date    numeric;
  v_retainage_pct     numeric;
  v_current_retainage numeric;
  v_retainage_to_date numeric;
  v_billing_period    date;
  v_inserted          int := 0;
BEGIN
  FOR v_entry IN
    SELECT ie.id              AS entry_id,
           ie.job_id,
           ie.invoice_amount,
           ie.invoice_date,
           ie.billing_month,
           ie.invoice_number,
           ie.notes,
           ie.entered_by,
           ie.created_at
      FROM public.invoice_entries ie
     WHERE NOT EXISTS (
       SELECT 1 FROM public.invoice_applications ia
        WHERE ia.source_invoice_entry_id = ie.id
     )
     ORDER BY ie.job_id, COALESCE(ie.invoice_date, ie.created_at::date), ie.created_at
  LOOP
    -- Pull the job's retainage_pct so synthetic apps reflect the same math
    -- post-cutover real apps will use.
    SELECT COALESCE(retainage_pct, 0) INTO v_retainage_pct
      FROM public.jobs WHERE id = v_entry.job_id;

    -- Cumulative billed BEFORE this app on this job.
    SELECT COALESCE(SUM(current_amount), 0)
      INTO v_billed_to_date
      FROM public.invoice_applications
     WHERE job_id = v_entry.job_id
       AND status IN ('filed','paid');

    v_current_retainage := ROUND(v_entry.invoice_amount * v_retainage_pct / 100, 2);
    v_retainage_to_date := v_billed_to_date * v_retainage_pct / 100 + v_current_retainage;

    -- billing_month in invoice_entries is text 'YYYY-MM'. Parse to first-of-month date.
    -- Fall back to invoice_date or created_at when billing_month is missing/malformed.
    BEGIN
      IF v_entry.billing_month IS NOT NULL AND v_entry.billing_month ~ '^\d{4}-\d{2}$' THEN
        v_billing_period := TO_DATE(v_entry.billing_month || '-01', 'YYYY-MM-DD');
      ELSE
        v_billing_period := DATE_TRUNC('month', COALESCE(v_entry.invoice_date, v_entry.created_at::date))::date;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_billing_period := DATE_TRUNC('month', COALESCE(v_entry.invoice_date, v_entry.created_at::date))::date;
    END;

    INSERT INTO public.invoice_applications (
      job_id, invoice_number, invoice_number_manual, invoice_date, billing_period,
      billed_to_date, current_amount, current_retainage, net_due, retainage_to_date,
      status, filed_at, filed_by,
      source_invoice_entry_id,
      notes,
      created_at, updated_at
    ) VALUES (
      v_entry.job_id,
      v_entry.invoice_number,        -- copy as-is; manual flag prevents trigger overwrite
      true,                          -- mark manual so post-cutover trigger doesn't regenerate
      v_entry.invoice_date,
      v_billing_period,
      v_billed_to_date,
      v_entry.invoice_amount,
      v_current_retainage,
      v_entry.invoice_amount - v_current_retainage,
      v_retainage_to_date,
      'filed',
      v_entry.created_at,
      COALESCE(v_entry.entered_by, 'legacy-import'),
      v_entry.entry_id,
      'Legacy import — pre-cutover invoice, no stage detail. Original notes: ' || COALESCE(v_entry.notes, '(none)'),
      v_entry.created_at,
      v_entry.created_at
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE 'Synthetic backfill complete: % applications inserted.', v_inserted;
END
$$;
