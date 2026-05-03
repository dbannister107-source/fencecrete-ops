-- Multi-day partial runs (per David, 2026-05-03):
-- A single job's production order can be split into multiple plan lines across
-- different days/shifts. This adds a run_id grouping so the UI can show
-- "Run 3 of 5 — 144/240 panels (60%) — completes Tue" alongside each
-- segment, and aggregate progress across days from production_actuals.
--
-- run_id is OPTIONAL — existing plan lines without a run_id are treated as
-- single-day runs (the historical default). New "Split across days" workflow
-- assigns a run_id when creating multi-segment plans.

ALTER TABLE public.production_plan_lines
  ADD COLUMN IF NOT EXISTS run_id UUID,
  ADD COLUMN IF NOT EXISTS run_total_panels INT,
  ADD COLUMN IF NOT EXISTS run_segment_seq INT;

CREATE INDEX IF NOT EXISTS idx_ppl_run_id ON public.production_plan_lines(run_id) WHERE run_id IS NOT NULL;

COMMENT ON COLUMN public.production_plan_lines.run_id IS
  'Groups multiple plan lines that are segments of one logical production run for a single job. NULL = single-segment run. Created by the "Split across days" UI.';
COMMENT ON COLUMN public.production_plan_lines.run_total_panels IS
  'Total panels planned across the entire run (sum of planned_panels across all segments with this run_id). Stored on every segment for UI convenience.';
COMMENT ON COLUMN public.production_plan_lines.run_segment_seq IS
  '1-indexed ordinal position within the run. 1 = first segment (earliest plan_date/shift), 2 = second, etc.';
