-- 20260505_billing_method_validation.sql
--
-- Phase G1: enforce canonical billing_method values for new writes.
--
-- Background: jobs.billing_method is free-text and has accumulated 34 legacy
-- rows with non-canonical values (COMPLETE/Complete=27, Procore=2, DUC=1,
-- plus 4 'Complete' variants). Per CLAUDE.md these can't be bulk-fixed
-- without Virginia + Alex review; meanwhile the form dropdown only offers
-- the canonical 5.
--
-- Initial attempt: ALTER TABLE … ADD CONSTRAINT … CHECK … NOT VALID. Failed
-- in practice — Postgres validates the CHECK on every UPDATE regardless of
-- whether the constrained column is being touched, so a tangential edit
-- (e.g. updating notes) on a legacy row would fail.
--
-- Working approach: a column-scoped BEFORE UPDATE trigger with WHEN clause
-- (NEW.billing_method IS DISTINCT FROM OLD.billing_method). The trigger
-- only fires when billing_method itself is changing, leaving tangential
-- updates on legacy rows untouched. INSERT validation also fires.
--
-- Canonical set: Progress | Lump Sum | Milestone | T&M | AIA | NULL.
-- Cleanup of legacy rows is a separate operational sprint pending
-- Virginia + Alex review.

CREATE OR REPLACE FUNCTION public.fn_jobs_validate_billing_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.billing_method IS NOT NULL
     AND NEW.billing_method NOT IN ('Progress','Lump Sum','Milestone','T&M','AIA')
  THEN
    RAISE EXCEPTION 'Invalid billing_method: %. Must be one of Progress, Lump Sum, Milestone, T&M, AIA, or NULL.', NEW.billing_method
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_validate_billing_method_bi ON public.jobs;
DROP TRIGGER IF EXISTS trg_jobs_validate_billing_method_bu ON public.jobs;

CREATE TRIGGER trg_jobs_validate_billing_method_bi
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_jobs_validate_billing_method();

CREATE TRIGGER trg_jobs_validate_billing_method_bu
  BEFORE UPDATE OF billing_method ON public.jobs
  FOR EACH ROW
  WHEN (NEW.billing_method IS DISTINCT FROM OLD.billing_method)
  EXECUTE FUNCTION public.fn_jobs_validate_billing_method();
