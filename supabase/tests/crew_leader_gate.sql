-- supabase/tests/crew_leader_gate.sql
--
-- Regression target: 20260504_active_install_requires_crew_leader.sql
-- Gate: a job cannot exist in status='active_install' without a crew_leader_id.
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
-- Test 1: gate blocks UPDATE that leaves a job in active_install with NULL crew_leader_id
-- Regression target: enforce_crew_leader_for_active_install() — UPDATE path
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id  uuid;
  v_blocked boolean := false;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='active_install' AND crew_leader_id IS NULL LIMIT 1;
  IF v_job_id IS NULL THEN
    INSERT INTO _test_results (test, status) VALUES ('1: gate blocks NULL crew_leader on active_install (UPDATE)', 'SKIP (no unassigned active_install jobs)');
    RETURN;
  END IF;

  BEGIN
    -- Trigger fires on UPDATE OF crew_leader_id even when value isn't changing.
    UPDATE jobs SET crew_leader_id = NULL WHERE id = v_job_id;
    RAISE EXCEPTION 'TEST 1: gate did not fire — UPDATE went through';
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST 1: expected check_violation, got something else';
  END IF;
  INSERT INTO _test_results (test) VALUES ('1: gate blocks NULL crew_leader on active_install (UPDATE)');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 2: gate allows assigning a real crew leader to an active_install job
-- (i.e. the gate doesn't over-fire and break the happy path)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id    uuid;
  v_leader_id uuid;
  v_blocked   boolean := false;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='active_install' AND crew_leader_id IS NULL LIMIT 1;
  IF v_job_id IS NULL THEN
    INSERT INTO _test_results (test, status) VALUES ('2: gate allows real leader assignment on active_install', 'SKIP (no unassigned active_install jobs)');
    RETURN;
  END IF;

  SELECT id INTO v_leader_id FROM crew_leaders WHERE active=TRUE LIMIT 1;
  IF v_leader_id IS NULL THEN
    RAISE EXCEPTION 'TEST 2 SETUP: no active crew_leaders to test against';
  END IF;

  BEGIN
    UPDATE jobs SET crew_leader_id = v_leader_id WHERE id = v_job_id;
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
  END;

  IF v_blocked THEN
    RAISE EXCEPTION 'TEST 2: gate fired on legitimate leader assignment';
  END IF;
  INSERT INTO _test_results (test) VALUES ('2: gate allows real leader assignment on active_install');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 3: gate blocks moving a job INTO active_install when crew_leader_id is NULL
-- (the original problem the gate was built to solve)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id  uuid;
  v_blocked boolean := false;
BEGIN
  -- Find a material_ready job (the typical previous status before active_install)
  SELECT id INTO v_job_id FROM jobs WHERE status='material_ready' AND crew_leader_id IS NULL LIMIT 1;
  IF v_job_id IS NULL THEN
    -- Fall back: any non-terminal status without a crew leader
    SELECT id INTO v_job_id FROM jobs WHERE status NOT IN ('active_install','closed','canceled','cancelled','lost') AND crew_leader_id IS NULL LIMIT 1;
    IF v_job_id IS NULL THEN
      INSERT INTO _test_results (test, status) VALUES ('3: gate blocks transition INTO active_install without leader', 'SKIP (no jobs to test against)');
      RETURN;
    END IF;
  END IF;

  BEGIN
    UPDATE jobs SET status = 'active_install' WHERE id = v_job_id;
    RAISE EXCEPTION 'TEST 3: status move to active_install went through without a crew leader';
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST 3: expected check_violation';
  END IF;
  INSERT INTO _test_results (test) VALUES ('3: gate blocks transition INTO active_install without leader');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 4: function source has the expected gate logic (static check —
-- catches accidental "fail open" or removed checks)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_func_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'enforce_crew_leader_for_active_install'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'TEST 4 SETUP: enforce_crew_leader_for_active_install function not found';
  END IF;

  IF v_func_def NOT LIKE '%active_install%' OR v_func_def NOT LIKE '%crew_leader_id IS NULL%' THEN
    RAISE EXCEPTION 'TEST 4: function source no longer contains the gate condition';
  END IF;
  INSERT INTO _test_results (test) VALUES ('4: function source has gate condition intact');

  IF v_func_def NOT LIKE '%check_violation%' THEN
    RAISE EXCEPTION 'TEST 4B: function should raise check_violation on gate failure';
  END IF;
  INSERT INTO _test_results (test) VALUES ('4B: function raises check_violation on gate failure');
END $$;

-- Result rowset (returned to caller before ROLLBACK)
SELECT id, test, status FROM _test_results ORDER BY id;

ROLLBACK;
