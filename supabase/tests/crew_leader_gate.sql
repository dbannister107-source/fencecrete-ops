-- supabase/tests/crew_leader_gate.sql
--
-- Regression target: 20260504_drop_enforce_crew_leader_for_active_install.sql
--
-- The original gate (20260504_active_install_requires_crew_leader.sql) was
-- retired the same day after Carlos's backfill completed and David found the
-- rigidity created friction during legitimate admin operations (leader
-- leaving mid-project, reassignment gaps, etc.). This test file now asserts
-- the OPPOSITE: the trigger should NOT exist, and clearing crew_leader_id on
-- an active_install job should succeed.
--
-- If a future engineer is tempted to re-introduce the gate, this test will
-- catch the regression and force them to update the test file consciously.
--
-- HOW TO RUN
--   Primary signal: GitHub Actions on every push + PR (.github/workflows/db-tests.yml)
--   Local dev: paste contents into a Supabase MCP execute_sql call
--
-- HOW IT WORKS
--   BEGIN ... ROLLBACK wraps. Each test asserts via RAISE EXCEPTION on failure.
--   Passes are written to _test_results; the final SELECT returns the pass list.

BEGIN;

CREATE TEMP TABLE _test_results (
  id     serial PRIMARY KEY,
  test   text,
  status text DEFAULT 'PASS'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 1: enforce_crew_leader_for_active_install function does NOT exist
-- Regression target: 20260504_drop_enforce_crew_leader_for_active_install.sql
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'enforce_crew_leader_for_active_install'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'TEST 1: enforce_crew_leader_for_active_install function exists — gate was re-introduced. Update this test file consciously if that is intentional.';
  END IF;
  INSERT INTO _test_results (test) VALUES ('1: enforce_crew_leader_for_active_install function is dropped');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 2: clearing crew_leader_id on an active_install job succeeds
-- (the user-visible behavior the gate-removal enables)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id      uuid;
  v_orig_leader uuid;
BEGIN
  SELECT id, crew_leader_id INTO v_job_id, v_orig_leader
  FROM jobs
  WHERE status = 'active_install' AND crew_leader_id IS NOT NULL
  LIMIT 1;

  IF v_job_id IS NULL THEN
    INSERT INTO _test_results (test, status) VALUES ('2: clearing crew_leader_id on active_install succeeds', 'SKIP (no active_install jobs with assigned leaders)');
    RETURN;
  END IF;

  -- This is the call that used to throw check_violation. The whole
  -- file is wrapped in BEGIN/ROLLBACK so the change does not persist.
  UPDATE jobs SET crew_leader_id = NULL WHERE id = v_job_id;
  INSERT INTO _test_results (test) VALUES ('2: clearing crew_leader_id on active_install succeeds');
END $$;

-- Result rowset (returned to caller before ROLLBACK)
SELECT id, test, status FROM _test_results ORDER BY id;

ROLLBACK;
