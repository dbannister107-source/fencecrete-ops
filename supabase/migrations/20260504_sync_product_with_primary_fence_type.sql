-- Auto-sync jobs.product from jobs.primary_fence_type.
--
-- Background: the live-app review on 2026-05-03 surfaced a "PRODUCT vs
-- PRIMARY TYPE contradiction" — Sofi Lakes showed PRODUCT='Masonry' while
-- PRIMARY TYPE='Precast'. Audit shows ~6 active jobs with that exact bug
-- plus ~37 with product=NULL.
--
-- Decision: primary_fence_type is the canonical field (it drives the
-- project-list type pill and the Map filter). product is the legacy field;
-- it's kept for back-compat but is now derived. Trigger auto-populates it
-- on every INSERT/UPDATE so it can never drift again.
--
-- Mapping (primary_fence_type → product):
--   'Precast'        → 'Precast Fence'
--   'Masonry'        → 'Masonry'
--   'Wood'           → 'Wood'
--   'Wrought Iron'   → 'Wrought Iron'
--   'Other' / NULL   → keep current product (could be a custom legacy value)
--
-- The "keep current value when source is Other/NULL" rule preserves edge
-- cases where someone wrote a custom product label long ago. Those rows
-- should be reviewed and migrated to a real primary_fence_type, but we're
-- not going to clobber them en masse from this migration.

CREATE OR REPLACE FUNCTION public.sync_product_from_primary_fence_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip if primary_fence_type is NULL or 'Other' — keep whatever was there.
  IF NEW.primary_fence_type IS NULL OR NEW.primary_fence_type = 'Other' THEN
    RETURN NEW;
  END IF;

  NEW.product := CASE NEW.primary_fence_type
    WHEN 'Precast'      THEN 'Precast Fence'
    WHEN 'Masonry'      THEN 'Masonry'
    WHEN 'Wood'         THEN 'Wood'
    WHEN 'Wrought Iron' THEN 'Wrought Iron'
    ELSE NEW.product   -- unknown future value: keep what was set
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_from_primary_fence_type_bi ON public.jobs;
CREATE TRIGGER trg_sync_product_from_primary_fence_type_bi
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_from_primary_fence_type();

DROP TRIGGER IF EXISTS trg_sync_product_from_primary_fence_type_bu ON public.jobs;
CREATE TRIGGER trg_sync_product_from_primary_fence_type_bu
  BEFORE UPDATE OF primary_fence_type, product ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_from_primary_fence_type();

-- Backfill: snapshot the current contradictions for safety, then resolve.
CREATE TABLE IF NOT EXISTS public._bak_product_drift_20260504 AS
SELECT id, job_number, job_name, product AS old_product, primary_fence_type, fence_type, status
FROM public.jobs
WHERE primary_fence_type IS NOT NULL
  AND primary_fence_type <> 'Other'
  AND (
    product IS NULL
    OR product <> CASE primary_fence_type
      WHEN 'Precast'      THEN 'Precast Fence'
      WHEN 'Masonry'      THEN 'Masonry'
      WHEN 'Wood'         THEN 'Wood'
      WHEN 'Wrought Iron' THEN 'Wrought Iron'
      ELSE product
    END
  );

-- Resolve them. Trigger fires on this UPDATE which is exactly what we want.
UPDATE public.jobs
SET product = CASE primary_fence_type
  WHEN 'Precast'      THEN 'Precast Fence'
  WHEN 'Masonry'      THEN 'Masonry'
  WHEN 'Wood'         THEN 'Wood'
  WHEN 'Wrought Iron' THEN 'Wrought Iron'
  ELSE product
END
WHERE primary_fence_type IS NOT NULL
  AND primary_fence_type <> 'Other';

COMMENT ON FUNCTION public.sync_product_from_primary_fence_type IS
  'Auto-populates jobs.product from jobs.primary_fence_type on INSERT/UPDATE. primary_fence_type is the canonical field; product is kept derived for back-compat. Added 2026-05-04 to retire the PRODUCT-vs-PRIMARY TYPE contradiction surfaced by the live-app review.';
COMMENT ON TABLE public._bak_product_drift_20260504 IS
  'Snapshot of jobs.product values before the 2026-05-04 sync migration. Drop after a few weeks if no recovery needed.';
