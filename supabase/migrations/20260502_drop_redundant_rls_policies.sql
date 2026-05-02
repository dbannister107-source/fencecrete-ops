-- 20260502_drop_redundant_rls_policies.sql
--
-- Drops ~60 redundant permissive RLS policies that generate ~270
-- multiple_permissive_policies advisor warnings. RLS is OR-evaluated
-- across permissive policies — each redundant policy is dead weight that
-- gets re-evaluated on every query.
--
-- Three patterns:
--
-- Pattern 1: tables with the canonical "public access" FOR ALL TO public
--   USING(true) WITH CHECK(true) policy. The redundant "auth read",
--   "auth write", and a few legacy ad-hoc policies don't restrict
--   anything (canonical already permits everything) — they're just
--   evaluation overhead.
--
-- Pattern 2: 4 catalog tables (color_aliases, colors, style_aliases,
--   styles) lack a canonical policy but have a "public write X" policy
--   with cmd=ALL USING(true). That covers SELECT already, so the
--   "public read X" SELECT-only policy is redundant.
--
-- Pattern 3: 5 proposal_* tables have TWO literal-duplicate FOR ALL
--   USING(true) WITH CHECK(true) policies — "public access" and
--   "Public access X". Drop the latter, keep the canonical name.
--
-- No app behavior changes — every query is still permitted by the
-- remaining canonical policy. Expected effect: advisor warnings drop
-- from ~270 to near-zero, and queries on these tables get one fewer
-- policy to evaluate per row.

-- =====================================================================
-- Pattern 1: redundant "auth read" / "auth write" / one-offs (alongside canonical "public access")
-- =====================================================================

DROP POLICY IF EXISTS "auth read"  ON public.activities;
DROP POLICY IF EXISTS "auth write" ON public.activities;

DROP POLICY IF EXISTS "auth read"  ON public.alert_config;
DROP POLICY IF EXISTS "auth write" ON public.alert_config;

DROP POLICY IF EXISTS "auth read"  ON public.billing_entries;
DROP POLICY IF EXISTS "auth write" ON public.billing_entries;

DROP POLICY IF EXISTS "auth read"  ON public.daily_schedule_reports;
DROP POLICY IF EXISTS "auth write" ON public.daily_schedule_reports;
DROP POLICY IF EXISTS "Allow public insert on daily_schedule_reports" ON public.daily_schedule_reports;

DROP POLICY IF EXISTS "auth read"  ON public.daily_schedule_rows;
DROP POLICY IF EXISTS "auth write" ON public.daily_schedule_rows;
DROP POLICY IF EXISTS "Allow public insert on daily_schedule_rows" ON public.daily_schedule_rows;

DROP POLICY IF EXISTS "auth read"  ON public.deals;
DROP POLICY IF EXISTS "auth write" ON public.deals;

DROP POLICY IF EXISTS "auth read"  ON public.estimates;
DROP POLICY IF EXISTS "auth write" ON public.estimates;

DROP POLICY IF EXISTS "auth read"  ON public.install_assignments;
DROP POLICY IF EXISTS "auth write" ON public.install_assignments;

DROP POLICY IF EXISTS "auth read"  ON public.install_schedule;
DROP POLICY IF EXISTS "auth write" ON public.install_schedule;

DROP POLICY IF EXISTS "auth read"  ON public.job_documents;
DROP POLICY IF EXISTS "auth write" ON public.job_documents;

DROP POLICY IF EXISTS "auth read"  ON public.job_files;
DROP POLICY IF EXISTS "auth write" ON public.job_files;

DROP POLICY IF EXISTS "auth read"  ON public.job_line_items;
DROP POLICY IF EXISTS "auth write" ON public.job_line_items;

DROP POLICY IF EXISTS "auth read"  ON public.job_status_log;
DROP POLICY IF EXISTS "auth write" ON public.job_status_log;

-- jobs: legacy FOR UPDATE policy; canonical "public access" already covers UPDATE
DROP POLICY IF EXISTS "public update" ON public.jobs;

DROP POLICY IF EXISTS "auth read"  ON public.material_calc_styles;
DROP POLICY IF EXISTS "auth write" ON public.material_calc_styles;

DROP POLICY IF EXISTS "auth read"  ON public.mold_inventory;
DROP POLICY IF EXISTS "auth write" ON public.mold_inventory;

DROP POLICY IF EXISTS "auth read"  ON public.monthly_billing_cycles;
DROP POLICY IF EXISTS "auth write" ON public.monthly_billing_cycles;

DROP POLICY IF EXISTS "auth read"  ON public.plant_config;
-- (plant_config has only "auth read" duplicate; no "auth write")

DROP POLICY IF EXISTS "auth read"  ON public.pm_daily_reports;
DROP POLICY IF EXISTS "auth write" ON public.pm_daily_reports;

DROP POLICY IF EXISTS "auth read"  ON public.production_assignments;
DROP POLICY IF EXISTS "auth write" ON public.production_assignments;

DROP POLICY IF EXISTS "auth read"  ON public.production_plan_lines;
DROP POLICY IF EXISTS "auth write" ON public.production_plan_lines;

DROP POLICY IF EXISTS "auth read"  ON public.production_plans;
DROP POLICY IF EXISTS "auth write" ON public.production_plans;

DROP POLICY IF EXISTS "auth read"  ON public.production_schedule;
DROP POLICY IF EXISTS "auth write" ON public.production_schedule;

DROP POLICY IF EXISTS "auth read"  ON public.production_weeks;
DROP POLICY IF EXISTS "auth write" ON public.production_weeks;

DROP POLICY IF EXISTS "auth read"  ON public.team_members;
DROP POLICY IF EXISTS "auth write" ON public.team_members;

DROP POLICY IF EXISTS "auth read"  ON public.weather_days;
DROP POLICY IF EXISTS "auth write" ON public.weather_days;

-- =====================================================================
-- Pattern 2: 4 catalog tables — drop the SELECT-only policy; ALL-cmd policy already covers SELECT
-- =====================================================================

DROP POLICY IF EXISTS "public read color_aliases" ON public.color_aliases;
DROP POLICY IF EXISTS "public read colors"        ON public.colors;
DROP POLICY IF EXISTS "public read style_aliases" ON public.style_aliases;
DROP POLICY IF EXISTS "public read styles"        ON public.styles;

-- =====================================================================
-- Pattern 3: 5 proposal_* tables — drop the literal-duplicate "Public access X" policy; canonical "public access" remains
-- =====================================================================

DROP POLICY IF EXISTS "Public access documents"    ON public.proposal_documents;
DROP POLICY IF EXISTS "Public access ingest_runs"  ON public.proposal_ingest_runs;
DROP POLICY IF EXISTS "Public access job_matches"  ON public.proposal_job_matches;
DROP POLICY IF EXISTS "Public access line_items"   ON public.proposal_line_items;
DROP POLICY IF EXISTS "Public access review_queue" ON public.proposal_review_queue;
