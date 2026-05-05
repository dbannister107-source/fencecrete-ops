-- 20260505_create_invoice_applications.sql
--
-- Phase A.3 of the Accounting Sheet / Billing Engine.
--
-- The App #1/#2/#3 ledger that replaces Virginia's Excel "Application"
-- columns. Each invoice_applications row is one billing cycle for a job;
-- each invoice_application_lines row is one (pricing line × stage)
-- breakdown that contributes to the App's total.
--
-- Integration point: trg_post_to_invoice_entries_on_file fires when the
-- App goes draft → filed and INSERTs into the existing invoice_entries
-- table. The existing trg_recalc_ytd_invoiced on invoice_entries then
-- propagates to jobs.ytd_invoiced. No parallel ledger, no double-write
-- risk: invoice_applications sits ABOVE invoice_entries.
--
-- Synthetic backfill (decision #5): existing invoice_entries rows get
-- a corresponding invoice_applications row with source_invoice_entry_id
-- set. The post-on-file trigger short-circuits when this is non-null so
-- backfill doesn't double-write back into invoice_entries.

-- ── Application header ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_applications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                   uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  app_number               int  NOT NULL,
  invoice_number           text,
  invoice_number_manual    boolean NOT NULL DEFAULT false,
  invoice_date             date,
  billing_period           date,
  pm_bill_submission_id    uuid REFERENCES public.pm_bill_submissions(id),

  billed_to_date           numeric(12,2),
  current_amount           numeric(12,2),
  current_retainage        numeric(12,2),
  net_due                  numeric(12,2),
  retainage_to_date        numeric(12,2),

  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','filed','paid','void')),
  filed_at                 timestamptz,
  filed_by                 text,
  paid_at                  timestamptz,
  paid_amount              numeric(12,2),

  is_retainage_release     boolean NOT NULL DEFAULT false,
  source_invoice_entry_id  uuid REFERENCES public.invoice_entries(id),

  notes                    text,
  pdf_storage_path         text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_applications_job_app UNIQUE (job_id, app_number)
);

CREATE INDEX IF NOT EXISTS ix_invoice_applications_job
  ON public.invoice_applications (job_id, app_number);
CREATE INDEX IF NOT EXISTS ix_invoice_applications_pm_sub
  ON public.invoice_applications (pm_bill_submission_id) WHERE pm_bill_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_invoice_applications_source
  ON public.invoice_applications (source_invoice_entry_id) WHERE source_invoice_entry_id IS NOT NULL;

ALTER TABLE public.invoice_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.invoice_applications;
CREATE POLICY "public access" ON public.invoice_applications
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.invoice_applications IS
  'App #1/#2/#3 ledger — one row per billing cycle for a job. Sits above invoice_entries: when status flips draft→filed, trg_post_to_invoice_entries_on_file inserts the corresponding invoice_entries row, which then drives jobs.ytd_invoiced via the existing recalc trigger. Synthetic rows from backfill carry source_invoice_entry_id and skip the post-on-file step.';

COMMENT ON COLUMN public.invoice_applications.invoice_number IS
  'Auto-generated as INV-{job_number}-{NN} (zero-padded app_number) by trg_set_invoice_number when invoice_number IS NULL AND invoice_number_manual=false. Set invoice_number_manual=true to keep a custom value.';

COMMENT ON COLUMN public.invoice_applications.is_retainage_release IS
  'Final App that bills the cumulative held retainage and zeroes the balance. trg_set_retainage_held resets jobs.retainage_held to 0 when this App is filed.';

COMMENT ON COLUMN public.invoice_applications.source_invoice_entry_id IS
  'Backfill provenance: when set, this App was generated from an existing invoice_entries row by the synthetic-backfill migration. trg_post_to_invoice_entries_on_file short-circuits when this is non-null so backfill does not double-write.';

-- ── Application line breakdown ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_application_lines (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_application_id      uuid NOT NULL REFERENCES public.invoice_applications(id) ON DELETE CASCADE,
  job_pricing_line_id         uuid NOT NULL REFERENCES public.job_pricing_lines(id) ON DELETE CASCADE,
  stage_key                   text NOT NULL,
  cumulative_qty              numeric(10,2),
  prior_qty                   numeric(10,2),
  current_qty                 numeric(10,2),
  rate_per_unit               numeric(10,2),
  current_labor_amount        numeric(12,2),
  current_tax_basis_amount    numeric(12,2),
  current_tax_amount          numeric(12,2),
  current_total               numeric(12,2)
);

CREATE INDEX IF NOT EXISTS ix_invoice_app_lines_app
  ON public.invoice_application_lines (invoice_application_id);
CREATE INDEX IF NOT EXISTS ix_invoice_app_lines_pricing
  ON public.invoice_application_lines (job_pricing_line_id);

ALTER TABLE public.invoice_application_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.invoice_application_lines;
CREATE POLICY "public access" ON public.invoice_application_lines
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.invoice_application_lines IS
  'Per-(pricing line × stage) breakdown of an App. Empty for synthetic backfilled apps (no historical stage detail to reconstruct). Fully populated for every App generated post-cutover.';

-- ────────────────────────────────────────────────────────────────────
-- TRIGGERS
-- ────────────────────────────────────────────────────────────────────

-- Trigger 1: auto-assign app_number per job on INSERT when not provided
CREATE OR REPLACE FUNCTION public.fn_set_app_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.app_number IS NULL THEN
    SELECT COALESCE(MAX(app_number), 0) + 1
      INTO NEW.app_number
      FROM public.invoice_applications
     WHERE job_id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_app_number ON public.invoice_applications;
CREATE TRIGGER trg_set_app_number
  BEFORE INSERT ON public.invoice_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_app_number();

-- Trigger 2: auto-generate invoice_number from job_number + app_number
-- Format: INV-{job_number}-{NN}  e.g.  INV-23H047-01
-- Skipped when invoice_number_manual=true OR invoice_number is already set.
CREATE OR REPLACE FUNCTION public.fn_set_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_job_number text;
BEGIN
  IF NEW.invoice_number IS NULL AND NEW.invoice_number_manual = false THEN
    SELECT job_number INTO v_job_number FROM public.jobs WHERE id = NEW.job_id;
    IF v_job_number IS NOT NULL THEN
      NEW.invoice_number := 'INV-' || v_job_number || '-' || LPAD(NEW.app_number::text, 2, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_invoice_number ON public.invoice_applications;
CREATE TRIGGER trg_set_invoice_number
  BEFORE INSERT ON public.invoice_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_invoice_number();

-- Trigger 3: maintain invoice_applications.{current_amount, current_retainage,
-- net_due, billed_to_date, retainage_to_date} from invoice_application_lines.
-- Fires on any line write. For synthetic backfilled apps with no lines, the
-- header values are left untouched (they were set explicitly at backfill time).
CREATE OR REPLACE FUNCTION public.fn_compute_invoice_app_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_app_id              uuid;
  v_job_id              uuid;
  v_app_number          int;
  v_current_amount      numeric;
  v_retainage_pct       numeric;
  v_current_retainage   numeric;
  v_billed_to_date      numeric;
  v_retainage_to_date   numeric;
BEGIN
  v_app_id := COALESCE(NEW.invoice_application_id, OLD.invoice_application_id);

  SELECT job_id, app_number INTO v_job_id, v_app_number
    FROM public.invoice_applications WHERE id = v_app_id;

  -- Sum the breakdown into the header.
  SELECT COALESCE(SUM(current_total), 0)
    INTO v_current_amount
    FROM public.invoice_application_lines
   WHERE invoice_application_id = v_app_id;

  -- Pull retainage_pct off the job (single source of truth).
  SELECT COALESCE(retainage_pct, 0) INTO v_retainage_pct
    FROM public.jobs WHERE id = v_job_id;

  v_current_retainage := ROUND(v_current_amount * v_retainage_pct / 100, 2);

  -- Cumulative billed = sum of current_amount for all PRIOR (lower app_number)
  -- filed/paid apps on this job. Excludes draft and void.
  SELECT COALESCE(SUM(current_amount), 0)
    INTO v_billed_to_date
    FROM public.invoice_applications
   WHERE job_id = v_job_id
     AND app_number < v_app_number
     AND status IN ('filed','paid');

  -- Cumulative retainage = sum of current_retainage for filed/paid apps THROUGH
  -- this app (so retainage_to_date includes this app's contribution if/when it
  -- becomes filed). Computed inclusive so the on-file trigger doesn't have to
  -- recompute downstream apps.
  v_retainage_to_date := v_billed_to_date * v_retainage_pct / 100 + v_current_retainage;

  UPDATE public.invoice_applications
     SET current_amount     = v_current_amount,
         current_retainage  = v_current_retainage,
         net_due            = v_current_amount - v_current_retainage,
         billed_to_date     = v_billed_to_date,
         retainage_to_date  = v_retainage_to_date,
         updated_at         = now()
   WHERE id = v_app_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_invoice_app_totals ON public.invoice_application_lines;
CREATE TRIGGER trg_compute_invoice_app_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_application_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_compute_invoice_app_totals();

-- Trigger 4: when status flips draft → filed, post into invoice_entries.
-- Skipped when source_invoice_entry_id IS NOT NULL (synthetic backfill).
-- The existing trg_recalc_ytd_invoiced on invoice_entries propagates from
-- there to jobs.ytd_invoiced — no manual cascading needed.
CREATE OR REPLACE FUNCTION public.fn_post_to_invoice_entries_on_file()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_inv_entry_id uuid;
BEGIN
  -- Only act on draft→filed transitions, never on backfilled apps.
  IF NEW.status = 'filed'
     AND COALESCE(OLD.status, '') <> 'filed'
     AND NEW.source_invoice_entry_id IS NULL
  THEN
    INSERT INTO public.invoice_entries (
      job_id, invoice_amount, invoice_date, billing_month,
      invoice_number, notes, entered_by, created_at
    ) VALUES (
      NEW.job_id,
      NEW.current_amount,
      COALESCE(NEW.invoice_date, CURRENT_DATE),
      COALESCE(NEW.billing_period, DATE_TRUNC('month', CURRENT_DATE)::date),
      NEW.invoice_number,
      'Auto-posted from invoice_applications App #' || NEW.app_number || COALESCE(' — ' || NEW.notes, ''),
      COALESCE(NEW.filed_by, 'system'),
      now()
    )
    RETURNING id INTO v_inv_entry_id;

    NEW.filed_at := COALESCE(NEW.filed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_to_invoice_entries_on_file ON public.invoice_applications;
CREATE TRIGGER trg_post_to_invoice_entries_on_file
  BEFORE UPDATE OF status ON public.invoice_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_post_to_invoice_entries_on_file();

-- Trigger 5: maintain jobs.retainage_held = MAX(retainage_to_date) of
-- filed/paid apps for that job. is_retainage_release apps reset to 0.
CREATE OR REPLACE FUNCTION public.fn_set_retainage_held()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_job_id   uuid;
  v_held     numeric;
  v_release  boolean;
BEGIN
  v_job_id := COALESCE(NEW.job_id, OLD.job_id);

  -- If the latest filed/paid app for this job is a retainage release, the
  -- held balance is zero by construction. Otherwise it's the cumulative
  -- retainage_to_date of the most-recent (highest app_number) filed/paid app.
  SELECT is_retainage_release, retainage_to_date
    INTO v_release, v_held
    FROM public.invoice_applications
   WHERE job_id = v_job_id
     AND status IN ('filed','paid')
   ORDER BY app_number DESC
   LIMIT 1;

  UPDATE public.jobs
     SET retainage_held = CASE WHEN COALESCE(v_release, false) THEN 0 ELSE COALESCE(v_held, 0) END
   WHERE id = v_job_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_retainage_held ON public.invoice_applications;
CREATE TRIGGER trg_set_retainage_held
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_retainage_held();
