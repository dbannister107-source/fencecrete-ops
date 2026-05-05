-- v_job_production_remaining
--
-- Single source of truth for "how many pieces does this job still need produced?"
-- Replaces ad-hoc client-side math that was reading the (potentially stale)
-- jobs.produced_* cache columns. Joins:
--   - jobs.material_*   = total pieces needed (set by Material Calc)
--   - production_actuals = real production logged so far
--   - production_plan_lines + production_plans = future-planned production
--
-- Per-pool fields:
--   X_total       = pieces required for the job (from Material Calc)
--   X_produced    = actuals logged so far
--   X_remaining   = max(0, total - produced)         "still to make"
--   X_planned     = sum of plan lines on/after today  "scheduled but not done"
--   X_unplanned   = max(0, remaining - planned)       "no one has scheduled this yet"
--
-- Used by:
--   - Plan-line progress chips (partial-run X/Y display)
--   - Production board card progress bars
--   - AI scheduler (knows what's actually left, not what the cache says)
--   - Future: Production Pulse mid-day widget

CREATE OR REPLACE VIEW public.v_job_production_remaining AS
WITH actuals_rollup AS (
  SELECT
    job_id,
    SUM(COALESCE(actual_panels, actual_pieces, 0)) FILTER (WHERE actual_panels IS NOT NULL OR actual_pieces IS NOT NULL) AS panels_produced,
    SUM(COALESCE(actual_posts, 0)) AS posts_produced,
    SUM(COALESCE(actual_rails, 0)) AS rails_produced,
    SUM(COALESCE(actual_caps,  0)) AS caps_produced
  FROM production_actuals
  WHERE job_id IS NOT NULL
  GROUP BY job_id
),
future_plan AS (
  -- Plan lines on or after today — represents "scheduled but not yet done."
  SELECT
    pl.job_id,
    SUM(COALESCE(pl.planned_panels, 0)) AS panels_planned,
    SUM(COALESCE(pl.planned_posts,  0)) AS posts_planned,
    SUM(COALESCE(pl.planned_rails,  0)) AS rails_planned,
    SUM(COALESCE(pl.planned_caps,   0)) AS caps_planned
  FROM production_plan_lines pl
  JOIN production_plans pp ON pp.id = pl.plan_id
  WHERE pp.plan_date >= CURRENT_DATE
    AND pl.job_id IS NOT NULL
  GROUP BY pl.job_id
)
SELECT
  j.id              AS job_id,
  j.job_number,
  j.job_name,
  j.status,
  j.style,
  j.color,
  j.height_precast,
  j.market,
  j.pm,
  j.est_start_date,
  j.material_calc_date,

  -- ── Panels ──
  (COALESCE(j.material_panels_regular, 0) + COALESCE(j.material_panels_half, 0)
   + COALESCE(j.material_panels_top, 0)   + COALESCE(j.material_panels_bottom, 0))::int  AS panels_total,
  COALESCE(ar.panels_produced, 0)::int                                                    AS panels_produced,
  GREATEST(0, (COALESCE(j.material_panels_regular, 0) + COALESCE(j.material_panels_half, 0)
              + COALESCE(j.material_panels_top, 0)   + COALESCE(j.material_panels_bottom, 0))
              - COALESCE(ar.panels_produced, 0))::int                                     AS panels_remaining,
  COALESCE(fp.panels_planned, 0)::int                                                     AS panels_planned,
  GREATEST(0, (COALESCE(j.material_panels_regular, 0) + COALESCE(j.material_panels_half, 0)
              + COALESCE(j.material_panels_top, 0)   + COALESCE(j.material_panels_bottom, 0))
              - COALESCE(ar.panels_produced, 0)
              - COALESCE(fp.panels_planned, 0))::int                                      AS panels_unplanned,

  -- ── Posts ──
  (COALESCE(j.material_posts_line, 0) + COALESCE(j.material_posts_corner, 0) + COALESCE(j.material_posts_stop, 0))::int AS posts_total,
  COALESCE(ar.posts_produced, 0)::int AS posts_produced,
  GREATEST(0, (COALESCE(j.material_posts_line, 0) + COALESCE(j.material_posts_corner, 0) + COALESCE(j.material_posts_stop, 0))
              - COALESCE(ar.posts_produced, 0))::int AS posts_remaining,
  COALESCE(fp.posts_planned, 0)::int AS posts_planned,
  GREATEST(0, (COALESCE(j.material_posts_line, 0) + COALESCE(j.material_posts_corner, 0) + COALESCE(j.material_posts_stop, 0))
              - COALESCE(ar.posts_produced, 0) - COALESCE(fp.posts_planned, 0))::int AS posts_unplanned,

  -- ── Rails ──
  (COALESCE(j.material_rails_regular, 0) + COALESCE(j.material_rails_top, 0)
   + COALESCE(j.material_rails_bottom, 0) + COALESCE(j.material_rails_center, 0))::int AS rails_total,
  COALESCE(ar.rails_produced, 0)::int AS rails_produced,
  GREATEST(0, (COALESCE(j.material_rails_regular, 0) + COALESCE(j.material_rails_top, 0)
              + COALESCE(j.material_rails_bottom, 0) + COALESCE(j.material_rails_center, 0))
              - COALESCE(ar.rails_produced, 0))::int AS rails_remaining,
  COALESCE(fp.rails_planned, 0)::int AS rails_planned,
  GREATEST(0, (COALESCE(j.material_rails_regular, 0) + COALESCE(j.material_rails_top, 0)
              + COALESCE(j.material_rails_bottom, 0) + COALESCE(j.material_rails_center, 0))
              - COALESCE(ar.rails_produced, 0) - COALESCE(fp.rails_planned, 0))::int AS rails_unplanned,

  -- ── Caps ──
  (COALESCE(j.material_caps_line, 0) + COALESCE(j.material_caps_stop, 0))::int AS caps_total,
  COALESCE(ar.caps_produced, 0)::int AS caps_produced,
  GREATEST(0, (COALESCE(j.material_caps_line, 0) + COALESCE(j.material_caps_stop, 0))
              - COALESCE(ar.caps_produced, 0))::int AS caps_remaining,
  COALESCE(fp.caps_planned, 0)::int AS caps_planned,
  GREATEST(0, (COALESCE(j.material_caps_line, 0) + COALESCE(j.material_caps_stop, 0))
              - COALESCE(ar.caps_produced, 0) - COALESCE(fp.caps_planned, 0))::int AS caps_unplanned

FROM jobs j
LEFT JOIN actuals_rollup ar ON ar.job_id = j.id
LEFT JOIN future_plan    fp ON fp.job_id = j.id
WHERE j.status NOT IN ('canceled', 'cancelled', 'lost', 'closed');

COMMENT ON VIEW public.v_job_production_remaining IS
'Per-job production progress: total / produced / remaining / planned / unplanned for each of the 4 mold pools (panels, posts, rails, caps). Computes produced fresh from production_actuals (jobs.produced_* cache fields are not trigger-maintained and can drift). Excludes terminal-status jobs. Added 2026-05-04 as Sprint 4 foundation.';
