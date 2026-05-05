-- 20260505_wire_jobs_billing_columns.sql
--
-- Phase A.4 of the Accounting Sheet / Billing Engine.
--
-- jobs.retainage_held and jobs.final_invoice_amount have been schema
-- placeholders for years (visible in EditPanel, never written by any
-- code path — confirmed by the 2026-05-05 survey). The new triggers in
-- 20260505_create_invoice_applications.sql wire retainage_held; this
-- migration makes the column shape match what the trigger writes and
-- backfills any existing nonsensical values to NULL.
--
-- final_invoice_amount stays a manual field for now — Virginia sets it
-- when the contract closes and the final figure is locked. The Phase D
-- UI will surface a "Mark Final" button on the last filed App that
-- writes this column. No trigger needed today.

-- Ensure both columns exist with the right shape. (No-op on prod where
-- they already exist; defensive for any forked/fresh DBs.)
ALTER TABLE public.jobs
  ALTER COLUMN retainage_held       TYPE numeric(12,2)
  USING retainage_held::numeric(12,2);

ALTER TABLE public.jobs
  ALTER COLUMN final_invoice_amount TYPE numeric(12,2)
  USING final_invoice_amount::numeric(12,2);

-- Reset stale values to NULL so the Acct Sheet trigger has a clean slate.
-- Production DB had retainage_held populated nowhere; this is defensive.
UPDATE public.jobs
   SET retainage_held = NULL
 WHERE retainage_held IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.invoice_applications ia
      WHERE ia.job_id = public.jobs.id
        AND ia.status IN ('filed','paid')
   );

COMMENT ON COLUMN public.jobs.retainage_held IS
  'Cumulative retainage withheld to date — derived. Auto-maintained by trg_set_retainage_held on invoice_applications. Reset to 0 when a retainage-release App is filed.';

COMMENT ON COLUMN public.jobs.final_invoice_amount IS
  'Final billed total — set manually when the contract closes (Phase D "Mark Final" action).';
