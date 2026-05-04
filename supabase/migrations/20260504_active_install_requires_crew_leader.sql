-- Forcing function: a job CANNOT advance to status='active_install' without
-- a crew_leader_id. This eliminates the "55 active install jobs / 0 assigned"
-- silent gap surfaced by the live-app review on 2026-05-03.
--
-- Pattern follows enforce_contract_readiness() — fires BEFORE UPDATE OF status,
-- raises check_violation if the gate is not met, lets all other transitions
-- through unchanged. Insert path is also protected so a job that is created
-- directly in active_install (rare but possible via import) must come with a
-- crew leader.
--
-- Bypass: there is no application-level bypass. If you need to set
-- status='active_install' on a row temporarily without a crew, set
-- crew_leader_id to a placeholder leader first, then null it out — that's
-- friction by design. The forcing-function philosophy in CLAUDE.md
-- principle #4 is the rationale.

CREATE OR REPLACE FUNCTION public.enforce_crew_leader_for_active_install()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- The trigger fires only on UPDATE OF status, crew_leader_id (or INSERT), so any
  -- update that touches neither column passes through without invoking this fn.
  -- When the trigger DOES fire, we evaluate the post-write state: if the row would
  -- be in active_install with no crew leader, block it. This catches both:
  --   1. status change FROM contract_review/production_queue/etc TO active_install
  --      while crew_leader_id is still NULL
  --   2. crew_leader_id being CLEARED to NULL on a row that's already in active_install
  -- Both are real scenarios we want to prevent — case 2 is how the data ended up
  -- in its current state (crew leaders were never set in the first place).
  IF NEW.status = 'active_install' AND NEW.crew_leader_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot save job % (%) in active_install without a crew leader assigned. Open the Crew Assignment page or set crew_leader_id first.',
      COALESCE(NEW.job_number, 'unknown'),
      COALESCE(NEW.job_name, 'unnamed')
      USING ERRCODE = 'check_violation',
            HINT = 'Use the bulk-assign action bar on Crew Assignment to fix many jobs at once.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_crew_leader_for_active_install_bu ON public.jobs;
CREATE TRIGGER trg_enforce_crew_leader_for_active_install_bu
  BEFORE UPDATE OF status, crew_leader_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_crew_leader_for_active_install();

DROP TRIGGER IF EXISTS trg_enforce_crew_leader_for_active_install_bi ON public.jobs;
CREATE TRIGGER trg_enforce_crew_leader_for_active_install_bi
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_crew_leader_for_active_install();

COMMENT ON FUNCTION public.enforce_crew_leader_for_active_install IS
  'Gate: a job cannot be in status=active_install without a crew_leader_id. Raises check_violation on attempted transition without one. Added 2026-05-04 to close the silent-data-gap surfaced by live review (55 active jobs, 0 assigned).';
