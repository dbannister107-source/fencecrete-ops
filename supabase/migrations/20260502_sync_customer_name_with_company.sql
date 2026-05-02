-- 20260502_sync_customer_name_with_company.sql
--
-- Eliminate jobs.customer_name vs companies.name drift (21% of linked jobs
-- as of 2026-05-02 — 40 rows). Two-direction sync via triggers, plus a
-- one-time backfill in the same migration.
--
-- HARD SYNC: when a job has a company_id, its customer_name is always the
-- canonical company name. Manual overrides on linked jobs are reverted by
-- the BEFORE UPDATE trigger. If you ever need a per-job display variant
-- (e.g., "Lennar - Houston Division" while company is "Lennar Homes"),
-- add a separate column rather than edit customer_name on a linked job.
--
-- Residential / unlinked jobs (company_id IS NULL) are untouched — the
-- trigger short-circuits when company_id is null.
--
-- A pre-migration snapshot of the drifted rows is preserved as
-- public._bak_customer_name_drift_20260502 (created separately right
-- before this migration applied).

-- ─── Forward sync: company_id -> customer_name on jobs ───
CREATE OR REPLACE FUNCTION public.sync_customer_name_from_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    SELECT name INTO NEW.customer_name
    FROM companies
    WHERE id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_name_bi ON public.jobs;
CREATE TRIGGER trg_sync_customer_name_bi
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_name_from_company();

DROP TRIGGER IF EXISTS trg_sync_customer_name_bu ON public.jobs;
CREATE TRIGGER trg_sync_customer_name_bu
  BEFORE UPDATE OF company_id, customer_name ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_name_from_company();

-- ─── Reverse propagation: companies.name -> all linked jobs.customer_name ───
CREATE OR REPLACE FUNCTION public.propagate_company_name_to_jobs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE jobs
  SET customer_name = NEW.name
  WHERE company_id = NEW.id
    AND customer_name IS DISTINCT FROM NEW.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_company_name_au ON public.companies;
CREATE TRIGGER trg_propagate_company_name_au
  AFTER UPDATE OF name ON public.companies
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION public.propagate_company_name_to_jobs();

-- ─── One-time backfill of the 40 drifted rows ───
-- Will fire trg_sync_customer_name_bu, which is idempotent.
UPDATE jobs j
SET customer_name = c.name
FROM companies c
WHERE c.id = j.company_id
  AND j.customer_name IS DISTINCT FROM c.name;
