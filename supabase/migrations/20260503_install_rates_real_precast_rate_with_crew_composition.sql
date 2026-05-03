-- Per David ground truth (2026-05-03):
-- - Each install crew = 1 W-2 leader + 3 helpers = 4 people total
-- - Precast install rate = 50 LF/day per crew (was 100, which silently
--   assumed an aggregate of multiple crews / experienced-team rate)
--
-- Adds explicit crew-composition columns so future updates can never
-- conflate "per-crew" with "aggregate" again. Source of truth is now
-- lf_per_day_per_crew; legacy lf_per_day kept in sync for callers that
-- haven't been migrated yet.

ALTER TABLE public.install_rates
  ADD COLUMN IF NOT EXISTS people_per_crew INT,
  ADD COLUMN IF NOT EXISTS lead_per_crew INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lf_per_day_per_crew NUMERIC;

COMMENT ON COLUMN public.install_rates.people_per_crew IS
  'Total bodies on a crew (lead + helpers). Default 4 (1 lead + 3 helpers) per David 2026-05-03.';
COMMENT ON COLUMN public.install_rates.lead_per_crew IS
  'How many W-2 crew leaders make one crew. Always 1 today; column exists for completeness if a future market splits a crew across leaders.';
COMMENT ON COLUMN public.install_rates.lf_per_day_per_crew IS
  'LF installed per day by ONE crew (4 people). Multiply by leader count for market capacity. Source of truth — lf_per_day kept in sync for legacy callers.';

-- Precast: the actual ground-truth correction. 50 not 100.
UPDATE public.install_rates SET
  people_per_crew      = 4,
  lead_per_crew        = 1,
  lf_per_day_per_crew  = 50,
  lf_per_day           = 50,
  notes                = '50 LF/day per 4-person crew (1 lead + 3 helpers). Updated from 100 default 2026-05-03 per David ground truth. Multiply by crew/leader count for market capacity. Will be calibrated from pm_daily_reports as data accumulates.'
WHERE category = 'precast';

-- Other categories: pre-existing rates were already per-crew (60/80/150 ladder
-- only made sense as per-crew anyway) — just attach the composition data.
UPDATE public.install_rates SET
  people_per_crew     = 4,
  lead_per_crew       = 1,
  lf_per_day_per_crew = lf_per_day
WHERE category IN ('masonry','architectural','wrought_iron');
