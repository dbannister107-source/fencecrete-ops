-- 20260505_create_stage_weights.sql
--
-- Phase A.2 of the Accounting Sheet / Billing Engine.
--
-- The Excel Acct Sheet bills each pricing line in stages. Precast splits
-- 65% Posts Only / 20% Posts & Panels / 15% Complete. Single-wythe splits
-- 25% Foundation / 30% Columns / 42% Panels / 3% Cleanup. Gates/Options
-- bill at 100% Complete (single-stage).
--
-- These splits are universal defaults seeded into stage_weights. Per-job
-- overrides live in job_stage_weights — Virginia can adjust them in the
-- Pricing editor when a contract recognizes milestones differently.
--
-- v_effective_stage_weights resolves to the override when present, else
-- the global default. Calc engine reads this view exclusively.

-- ── Global defaults ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stage_weights (
  category       text NOT NULL,
  stage_key      text NOT NULL,
  stage_label    text NOT NULL,
  weight         numeric(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  display_order  int NOT NULL DEFAULT 0,
  PRIMARY KEY (category, stage_key)
);

ALTER TABLE public.stage_weights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.stage_weights;
CREATE POLICY "public access" ON public.stage_weights
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.stage_weights IS
  'Universal billing-stage weights per pricing category. Precast: 65/20/15. SW: 25/30/42/3. Gates/Options/Permits/Bonds: 100% Complete (single stage). Per-job overrides live in job_stage_weights and supersede these.';

-- Idempotent seed
INSERT INTO public.stage_weights (category, stage_key, stage_label, weight, display_order) VALUES
  ('precast','posts_only',    'Posts Only',     0.65, 1),
  ('precast','posts_panels',  'Posts & Panels', 0.20, 2),
  ('precast','complete',      'Complete',       0.15, 3),
  ('sw',     'foundation',    'Foundation',     0.25, 1),
  ('sw',     'columns',       'Columns',        0.30, 2),
  ('sw',     'panels',        'Panels',         0.42, 3),
  ('sw',     'cleanup',       'Cleanup',        0.03, 4),
  ('wi_gate','complete',      'Complete',       1.00, 1),
  ('option', 'complete',      'Complete',       1.00, 1),
  ('permit', 'complete',      'Complete',       1.00, 1),
  ('bond',   'complete',      'Complete',       1.00, 1),
  ('other',  'complete',      'Complete',       1.00, 1)
ON CONFLICT (category, stage_key) DO NOTHING;

-- ── Per-job overrides ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_stage_weights (
  job_id     uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  category   text NOT NULL,
  stage_key  text NOT NULL,
  weight     numeric(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  PRIMARY KEY (job_id, category, stage_key)
);

ALTER TABLE public.job_stage_weights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.job_stage_weights;
CREATE POLICY "public access" ON public.job_stage_weights
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.job_stage_weights IS
  'Per-job overrides for stage_weights. Sparse — only stores rows where a job differs from the universal defaults. "Reset to defaults" = DELETE FROM job_stage_weights WHERE job_id = X.';

-- ── Validation: weights for any (job_id, category) sum to 1.00 ───────
-- Tolerance ±0.01 to allow rounding.
--
-- STATEMENT-level (not ROW). Fires once after each INSERT/UPDATE/DELETE
-- statement, sees the post-statement state of the table, and validates
-- every (job_id, category) group with rows present. This lets the UI
-- write all rows for a category in one multi-row VALUES clause without
-- tripping the trigger on intermediate states.
--
-- Trade-off: scans the whole table on each fire. job_stage_weights is
-- sparse (only stores per-job overrides; most jobs have zero rows) so
-- the scan is essentially free in practice.
--
-- Initial design used a CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED
-- + per-row firing, but that required SET CONSTRAINTS ALL IMMEDIATE in
-- both UI batch flows and tests — STATEMENT-level is simpler and matches
-- the natural UX where Virginia hits Save and expects validation now.

CREATE OR REPLACE FUNCTION public.fn_jsw_validate_sum()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_record record;
BEGIN
  FOR v_record IN
    SELECT job_id, category, SUM(weight) AS total
      FROM public.job_stage_weights
     GROUP BY job_id, category
     HAVING SUM(weight) > 0
  LOOP
    IF v_record.total < 0.99 OR v_record.total > 1.01 THEN
      RAISE EXCEPTION 'Stage weight overrides for job % category % sum to % — must equal 1.00 (±0.01) or be deleted entirely', v_record.job_id, v_record.category, v_record.total
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_jsw_validate_sum ON public.job_stage_weights;
CREATE TRIGGER trg_jsw_validate_sum
  AFTER INSERT OR UPDATE OR DELETE
  ON public.job_stage_weights
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_jsw_validate_sum();

-- ── Effective weights view ───────────────────────────────────────────
-- Calc engine reads from here. Returns (job_id, category, stage_key,
-- stage_label, weight, display_order, is_overridden) for every job ×
-- every (category, stage_key) combo, with the per-job override winning.
--
-- CROSS JOIN against jobs gives every job a full set of rows even when
-- there are no overrides — keeps consumer queries simple (always join
-- this view, never decide "should I check overrides first").

CREATE OR REPLACE VIEW public.v_effective_stage_weights AS
SELECT
  j.id            AS job_id,
  s.category,
  s.stage_key,
  s.stage_label,
  COALESCE(o.weight, s.weight) AS weight,
  s.display_order,
  (o.weight IS NOT NULL)       AS is_overridden
FROM public.jobs j
CROSS JOIN public.stage_weights s
LEFT JOIN public.job_stage_weights o
  ON o.job_id   = j.id
 AND o.category = s.category
 AND o.stage_key = s.stage_key;

COMMENT ON VIEW public.v_effective_stage_weights IS
  'Resolved stage weights per job (override if present, else global default). The single source of truth for the Acct Sheet calc engine.';
