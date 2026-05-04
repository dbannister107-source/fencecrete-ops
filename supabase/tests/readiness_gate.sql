-- supabase/tests/readiness_gate.sql
--
-- First high-value tests for the contract-readiness gate machinery.
-- Targets the v_contract_readiness view + enforce_contract_readiness
-- trigger. Sets the precedent for how DB tests are written and run in
-- this repo.
--
-- HOW TO RUN
--   Primary signal:
--     GitHub Actions runs this on every push + PR. See .github/workflows/db-tests.yml.
--   Local dev iteration:
--     Paste this file's contents into a single Supabase MCP execute_sql call.
--   Via psql:
--     psql "$SUPABASE_DB_URL" -f supabase/tests/readiness_gate.sql
--
-- HOW IT WORKS
--   BEGIN ... ROLLBACK wraps the whole file -- mutations to real data
--   are rolled back at the end. Each test is a DO $$ ... $$ block that
--   asserts via RAISE EXCEPTION on failure (which aborts the run). On
--   success, each assertion INSERTs a row into _test_results -- the
--   final SELECT returns those rows so the caller sees what passed.
--
--   No mutations escape this script -- ROLLBACK is mandatory.
--
-- HOW TO ADD A TEST
--   Append a new DO $$ ... $$ block. Inside:
--     - Use RAISE EXCEPTION '<msg>' to fail
--     - INSERT INTO _test_results (test) VALUES ('<name>') on pass
--   Then re-run.

BEGIN;

CREATE TEMP TABLE _test_results (
  id     serial PRIMARY KEY,
  test   text,
  status text DEFAULT 'PASS'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 1: customer_linked auto-check across all 3 cases
-- Regression target: 20260502_fix_customer_linked_gate.sql
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id      uuid;
  v_co_id       uuid;
  v_auto_checks jsonb;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'TEST 1 SETUP: no contract_review jobs to test against'; END IF;
  SELECT id INTO v_co_id FROM companies LIMIT 1;
  IF v_co_id  IS NULL THEN RAISE EXCEPTION 'TEST 1 SETUP: no companies in db'; END IF;

  -- 1A: company_id NULL + is_residential FALSE -> customer_linked should be false
  UPDATE jobs SET company_id = NULL, is_residential = FALSE WHERE id = v_job_id;
  SELECT auto_checks INTO v_auto_checks FROM v_contract_readiness WHERE job_id = v_job_id;
  IF (v_auto_checks->>'customer_linked')::boolean THEN
    RAISE EXCEPTION 'TEST 1A: customer_linked should be false when company_id NULL and not residential';
  END IF;
  INSERT INTO _test_results (test) VALUES ('1A: customer_linked=false when no company and not residential');

  -- 1B: company_id set -> customer_linked should be true
  UPDATE jobs SET company_id = v_co_id, is_residential = FALSE WHERE id = v_job_id;
  SELECT auto_checks INTO v_auto_checks FROM v_contract_readiness WHERE job_id = v_job_id;
  IF NOT (v_auto_checks->>'customer_linked')::boolean THEN
    RAISE EXCEPTION 'TEST 1B: customer_linked should be true when company_id set';
  END IF;
  INSERT INTO _test_results (test) VALUES ('1B: customer_linked=true with company_id');

  -- 1C: company_id NULL + is_residential TRUE -> customer_linked should be true
  UPDATE jobs SET company_id = NULL, is_residential = TRUE WHERE id = v_job_id;
  SELECT auto_checks INTO v_auto_checks FROM v_contract_readiness WHERE job_id = v_job_id;
  IF NOT (v_auto_checks->>'customer_linked')::boolean THEN
    RAISE EXCEPTION 'TEST 1C: customer_linked should be true when is_residential';
  END IF;
  INSERT INTO _test_results (test) VALUES ('1C: customer_linked=true with is_residential');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 2: trigger blocks status move when is_ready=false
-- Regression target: enforce_contract_readiness() forcing function
-- Also asserts the error message lists specific blockers (regression
-- target: 20260504_readiness_gate_specific_blockers_in_error.sql) so a
-- future change can't quietly drop the field-by-field guidance Amiee
-- needs.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id  uuid;
  v_blocked boolean := false;
  v_msg     text;
BEGIN
  SELECT job_id INTO v_job_id
  FROM v_contract_readiness
  WHERE status='contract_review' AND is_ready = false
  LIMIT 1;

  IF v_job_id IS NULL THEN
    -- All blocked jobs got reconciled — not a regression, just nothing to assert against
    INSERT INTO _test_results (test, status) VALUES ('2: trigger blocks status move', 'SKIP (no blocked contract_review jobs)');
    RETURN;
  END IF;

  BEGIN
    UPDATE jobs SET status = 'production_queue' WHERE id = v_job_id;
    -- if we reach here, the trigger did NOT block -> fail
    RAISE EXCEPTION 'TEST 2: status move should have been blocked but went through';
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST 2: expected check_violation';
  END IF;
  INSERT INTO _test_results (test) VALUES ('2: trigger blocks status move when is_ready=false');

  -- 2B: error message lists specific blockers, not just generic text
  IF v_msg NOT ILIKE '%missing%' THEN
    RAISE EXCEPTION 'TEST 2B: error message should contain "missing — <items>" with specific blockers, got: %', v_msg;
  END IF;
  INSERT INTO _test_results (test) VALUES ('2B: error message lists specific blockers');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 3: enforce_contract_readiness has fail-CLOSED mechanism intact
-- Regression target: 20260502_fix_readiness_trigger_fail_open.sql
-- Static check on function source -- catches any reintroduction of the
-- silent fail-open path without needing to simulate a view error.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_func_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'enforce_contract_readiness'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'TEST 3 SETUP: enforce_contract_readiness function not found';
  END IF;

  IF v_func_def NOT LIKE '%v_view_failed%' THEN
    RAISE EXCEPTION 'TEST 3A: enforce_contract_readiness should have v_view_failed variable (fail-closed mechanism)';
  END IF;
  INSERT INTO _test_results (test) VALUES ('3A: v_view_failed variable present');

  IF v_func_def NOT LIKE '%readiness_gate_internal_error%' THEN
    RAISE EXCEPTION 'TEST 3B: enforce_contract_readiness should emit readiness_gate_internal_error event';
  END IF;
  INSERT INTO _test_results (test) VALUES ('3B: emits readiness_gate_internal_error to system_events');

  IF v_func_def ILIKE '%-- fail open%' THEN
    RAISE EXCEPTION 'TEST 3C: -- fail open comment is back -- the 2026-05-02 fix has regressed';
  END IF;
  INSERT INTO _test_results (test) VALUES ('3C: fail-open mechanism is gone');
END $$;

-- Result rowset (returned to caller before ROLLBACK)
SELECT id, test, status FROM _test_results ORDER BY id;

ROLLBACK;
