-- mold_pours + v_mold_availability — Sprint 3 foundation, 2026-05-04
--
-- Tracks every pour as a discrete event with a cure deadline. Lets us answer
-- "which molds are free RIGHT NOW?" in real time — the question the existing
-- daily-aggregate capacity views can't answer.
--
-- Auto-populated via a trigger on production_actuals. When Carlos logs "we
-- poured 18 panels of Rock Style at 9:14 AM today," the trigger creates a
-- mold_pours row with ready_at = 9:14 AM tomorrow. Until then, those 18
-- panels' worth of mold capacity is "in cure."
--
-- v_mold_availability rolls active (ready_at > now()) pours back up by style
-- + pour_type so any UI can read "X panels in cure for Rock Style right now."
-- Plant Floor view (next sprint) consumes this directly.
--
-- Cure time is currently 24h flat (per David). When per-style cure_time_hours
-- becomes a real input from material_calc_styles, the trigger will read it
-- per pour instead of the constant.

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mold_pours (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actual_id       uuid REFERENCES public.production_actuals(id) ON DELETE CASCADE,
  job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_number      text,
  style           text NOT NULL,
  color           text,
  height          text,
  pour_type       text NOT NULL CHECK (pour_type IN ('panels','posts','rails','caps')),
  pieces_poured   int  NOT NULL CHECK (pieces_poured > 0),
  shift           int,
  poured_at       timestamptz NOT NULL,
  ready_at        timestamptz NOT NULL,
  cure_hours      int  NOT NULL DEFAULT 24,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mold_pours_active
  ON public.mold_pours (style, pour_type, ready_at);

ALTER TABLE public.mold_pours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.mold_pours;
CREATE POLICY "public access" ON public.mold_pours
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.mold_pours IS
  'Per-pour log auto-populated from production_actuals via trigger. Each row represents one piece-type batch (N panels of style X poured at time T, ready at T+cure_hours). Source for v_mold_availability and the Plant Floor real-time mold occupancy view.';

-- ── Trigger function: production_actuals → mold_pours ──────────────
CREATE OR REPLACE FUNCTION public.create_mold_pours_from_actual()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_poured_at timestamptz;
  v_cure_h    int := 24;
BEGIN
  v_poured_at := COALESCE(NEW.submitted_at, NEW.created_at, now());
  IF NEW.style IS NULL OR NEW.style = '' THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.mold_pours WHERE actual_id = NEW.id;

  IF COALESCE(NEW.actual_panels, NEW.actual_pieces, 0) > 0 THEN
    INSERT INTO public.mold_pours
      (actual_id, job_id, job_number, style, color, height, pour_type, pieces_poured, shift, poured_at, ready_at, cure_hours)
    VALUES
      (NEW.id, NEW.job_id, NEW.job_number, NEW.style, NEW.color, NEW.height,
       'panels', COALESCE(NEW.actual_panels, NEW.actual_pieces),
       NEW.shift, v_poured_at, v_poured_at + (v_cure_h || ' hours')::interval, v_cure_h);
  END IF;

  IF COALESCE(NEW.actual_posts, 0) > 0 THEN
    INSERT INTO public.mold_pours
      (actual_id, job_id, job_number, style, color, height, pour_type, pieces_poured, shift, poured_at, ready_at, cure_hours)
    VALUES
      (NEW.id, NEW.job_id, NEW.job_number, NEW.style, NEW.color, NEW.height,
       'posts', NEW.actual_posts,
       NEW.shift, v_poured_at, v_poured_at + (v_cure_h || ' hours')::interval, v_cure_h);
  END IF;

  IF COALESCE(NEW.actual_rails, 0) > 0 THEN
    INSERT INTO public.mold_pours
      (actual_id, job_id, job_number, style, color, height, pour_type, pieces_poured, shift, poured_at, ready_at, cure_hours)
    VALUES
      (NEW.id, NEW.job_id, NEW.job_number, NEW.style, NEW.color, NEW.height,
       'rails', NEW.actual_rails,
       NEW.shift, v_poured_at, v_poured_at + (v_cure_h || ' hours')::interval, v_cure_h);
  END IF;

  IF COALESCE(NEW.actual_caps, 0) > 0 THEN
    INSERT INTO public.mold_pours
      (actual_id, job_id, job_number, style, color, height, pour_type, pieces_poured, shift, poured_at, ready_at, cure_hours)
    VALUES
      (NEW.id, NEW.job_id, NEW.job_number, NEW.style, NEW.color, NEW.height,
       'caps', NEW.actual_caps,
       NEW.shift, v_poured_at, v_poured_at + (v_cure_h || ' hours')::interval, v_cure_h);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mold_pours_from_actual_ai ON public.production_actuals;
CREATE TRIGGER trg_mold_pours_from_actual_ai
  AFTER INSERT ON public.production_actuals
  FOR EACH ROW
  EXECUTE FUNCTION public.create_mold_pours_from_actual();

DROP TRIGGER IF EXISTS trg_mold_pours_from_actual_au ON public.production_actuals;
CREATE TRIGGER trg_mold_pours_from_actual_au
  AFTER UPDATE OF actual_panels, actual_posts, actual_rails, actual_caps,
                  actual_pieces, style, color, height, submitted_at
  ON public.production_actuals
  FOR EACH ROW
  EXECUTE FUNCTION public.create_mold_pours_from_actual();

COMMENT ON FUNCTION public.create_mold_pours_from_actual IS
  'AFTER INSERT/UPDATE on production_actuals: creates one mold_pours row per non-zero piece-type batch. Idempotent (deletes prior pours for the same actual_id before inserting). Cure time hardcoded to 24h until material_calc_styles.cure_time_hours is wired in.';

-- ── v_mold_availability ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_mold_availability AS
WITH active AS (
  SELECT style, pour_type, SUM(pieces_poured)::int AS pieces_in_cure,
         MIN(ready_at) AS earliest_ready_at,
         MAX(ready_at) AS latest_ready_at,
         COUNT(*)::int AS active_pour_count
  FROM public.mold_pours
  WHERE ready_at > now()
  GROUP BY style, pour_type
)
SELECT
  COALESCE(p.style, po.style, r.style, c.style) AS style,
  COALESCE(p.pieces_in_cure, 0)  AS panels_in_cure,
  COALESCE(po.pieces_in_cure, 0) AS posts_in_cure,
  COALESCE(r.pieces_in_cure, 0)  AS rails_in_cure,
  COALESCE(c.pieces_in_cure, 0)  AS caps_in_cure,
  LEAST(p.earliest_ready_at, po.earliest_ready_at, r.earliest_ready_at, c.earliest_ready_at) AS earliest_ready_at,
  (COALESCE(p.active_pour_count, 0) + COALESCE(po.active_pour_count, 0)
    + COALESCE(r.active_pour_count, 0) + COALESCE(c.active_pour_count, 0)) AS total_active_pours
FROM (SELECT * FROM active WHERE pour_type='panels') p
FULL OUTER JOIN (SELECT * FROM active WHERE pour_type='posts') po ON po.style = p.style
FULL OUTER JOIN (SELECT * FROM active WHERE pour_type='rails') r  ON r.style  = COALESCE(p.style, po.style)
FULL OUTER JOIN (SELECT * FROM active WHERE pour_type='caps')  c  ON c.style  = COALESCE(p.style, po.style, r.style);

COMMENT ON VIEW public.v_mold_availability IS
  'Real-time mold occupancy: for each style, pieces currently in cure across the 4 pour types + earliest ready_at. Joins under the hood against the partial-indexed active mold_pours rows so the query stays fast even after the table grows. Source for the Plant Floor view.';
