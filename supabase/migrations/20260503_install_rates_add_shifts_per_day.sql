-- Plant operating reality (per David, 2026-05-03):
-- - Shift 1: Mon–Sat 8am–4pm
-- - Shift 2: Mon–Fri 6pm–2am
-- That's effectively 2 shifts of plant coverage. v_mold_capacity already assumes
-- 24h coverage (panels × 24/cure_time_hours), so the realized-capacity derate
-- factor used on display surfaces was wrong (0.238 = single shift × 5 days/wk).
-- Codify shifts_per_day on install_rates so it's explicit and tunable.

ALTER TABLE public.install_rates
  ADD COLUMN IF NOT EXISTS shifts_per_day INT DEFAULT 2;

COMMENT ON COLUMN public.install_rates.shifts_per_day IS
  'Number of plant shifts running per day. 2 = current operating reality (Shift 1 Mon-Sat 8a-4p + Shift 2 Mon-Fri 6p-2a). install_rates is a slightly imperfect home for a plant-level constant — this column is read by capacity calcs. Will likely move to a plant_config table when we have a third constant.';

UPDATE public.install_rates SET shifts_per_day = 2;
