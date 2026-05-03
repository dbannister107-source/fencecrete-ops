-- 20260503_add_user_fk_columns.sql
--
-- Identity-by-email-text → real UUID FK conversion (top 3 columns).
-- Adds FK columns alongside existing text columns. Backfill from current
-- text values via name match against user_profiles.full_name. Sync triggers
-- keep the FK columns in lockstep going forward without app changes.
--
-- Three columns converted:
--   jobs.pm                     → jobs.pm_user_id
--   jobs.sales_rep              → jobs.sales_rep_user_id
--   pm_daily_reports.submitted_by → pm_daily_reports.submitted_by_user_id
--
-- Backfill expectations (from 2026-05-03 discovery):
--   jobs.pm_user_id        : 298 of 298 populated
--   jobs.sales_rep_user_id : 297 of 298 populated (1 row "Alexis" has no
--                            user_profile; backfill leaves NULL)
--   pm_daily_reports.submitted_by_user_id : 52 of 53 (1 row "Hugo Rodriguez"
--                            has no user_profile yet; backfill leaves NULL)
--
-- Text columns are NOT dropped here. Plan: 90-day dual-write window so app
-- code can iteratively migrate to using the FK; then drop text columns in a
-- follow-up.

-- =====================================================================
-- Section 1: Schema additions
-- =====================================================================

ALTER TABLE jobs
  ADD COLUMN pm_user_id        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN sales_rep_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE pm_daily_reports
  ADD COLUMN submitted_by_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_jobs_pm_user_id        ON jobs(pm_user_id)        WHERE pm_user_id        IS NOT NULL;
CREATE INDEX idx_jobs_sales_rep_user_id ON jobs(sales_rep_user_id) WHERE sales_rep_user_id IS NOT NULL;
CREATE INDEX idx_pm_daily_reports_submitted_by_user_id
  ON pm_daily_reports(submitted_by_user_id) WHERE submitted_by_user_id IS NOT NULL;

-- =====================================================================
-- Section 2: One-time backfill
-- =====================================================================

-- jobs.pm → pm_user_id (matches by full_name)
UPDATE jobs j
SET pm_user_id = up.id
FROM user_profiles up
WHERE j.pm IS NOT NULL
  AND j.pm = up.full_name;

-- jobs.sales_rep → sales_rep_user_id (matches by first token of full_name,
-- restricted to sales roles to avoid e.g. "David" matching David Bannister
-- if anyone ever entered just "David")
UPDATE jobs j
SET sales_rep_user_id = up.id
FROM user_profiles up
WHERE j.sales_rep IS NOT NULL
  AND split_part(up.full_name, ' ', 1) = j.sales_rep
  AND up.role IN ('sales_rep', 'sales_director');

-- pm_daily_reports.submitted_by → submitted_by_user_id (matches by full_name)
UPDATE pm_daily_reports pdr
SET submitted_by_user_id = up.id
FROM user_profiles up
WHERE pdr.submitted_by IS NOT NULL
  AND pdr.submitted_by = up.full_name;

-- =====================================================================
-- Section 3: Sync triggers (dual-write, zero app-side changes required)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_jobs_user_fks()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pm IS NOT NULL THEN
    SELECT id INTO NEW.pm_user_id
    FROM user_profiles WHERE full_name = NEW.pm LIMIT 1;
  ELSE
    NEW.pm_user_id := NULL;
  END IF;

  IF NEW.sales_rep IS NOT NULL THEN
    SELECT id INTO NEW.sales_rep_user_id
    FROM user_profiles
    WHERE split_part(full_name, ' ', 1) = NEW.sales_rep
      AND role IN ('sales_rep', 'sales_director')
    LIMIT 1;
  ELSE
    NEW.sales_rep_user_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_jobs_user_fks ON public.jobs;
CREATE TRIGGER trg_sync_jobs_user_fks
  BEFORE INSERT OR UPDATE OF pm, sales_rep ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_jobs_user_fks();

CREATE OR REPLACE FUNCTION public.sync_pm_daily_reports_submitted_by_fk()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.submitted_by IS NOT NULL THEN
    SELECT id INTO NEW.submitted_by_user_id
    FROM user_profiles WHERE full_name = NEW.submitted_by LIMIT 1;
  ELSE
    NEW.submitted_by_user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pm_daily_reports_submitted_by_fk ON public.pm_daily_reports;
CREATE TRIGGER trg_sync_pm_daily_reports_submitted_by_fk
  BEFORE INSERT OR UPDATE OF submitted_by ON public.pm_daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pm_daily_reports_submitted_by_fk();
