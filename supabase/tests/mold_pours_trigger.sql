-- supabase/tests/mold_pours_trigger.sql
--
-- Regression target: 20260504_mold_pours_and_availability.sql
-- Tests the trigger that auto-populates mold_pours from production_actuals
-- INSERT / UPDATE, plus the v_mold_availability view.
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
-- Test 1: INSERTing a production_actual creates one mold_pours row per
-- non-zero pour_type, with ready_at = poured_at + 24h
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id     uuid;
  v_actual_id  uuid;
  v_pour_count int;
  v_panel_pour mold_pours%ROWTYPE;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status NOT IN ('canceled','cancelled','lost','closed') LIMIT 1;
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'TEST 1 SETUP: no eligible jobs'; END IF;

  INSERT INTO production_actuals (job_id, job_number, style, color, height, actual_panels, actual_posts, submitted_at, production_date, shift)
  VALUES (v_job_id, 'TEST-MP-1', 'Rock Style', 'Cafe', '8', 12, 6, '2026-05-04 09:00:00+00', '2026-05-04', 1)
  RETURNING id INTO v_actual_id;

  SELECT COUNT(*)::int INTO v_pour_count FROM mold_pours WHERE actual_id = v_actual_id;
  IF v_pour_count <> 2 THEN
    RAISE EXCEPTION 'TEST 1: expected 2 mold_pours rows (panels + posts), got %', v_pour_count;
  END IF;
  INSERT INTO _test_results (test) VALUES ('1: INSERT creates one mold_pours per non-zero pour_type');

  SELECT * INTO v_panel_pour FROM mold_pours WHERE actual_id = v_actual_id AND pour_type = 'panels';
  IF v_panel_pour.pieces_poured <> 12 THEN
    RAISE EXCEPTION 'TEST 1B: expected 12 panels poured, got %', v_panel_pour.pieces_poured;
  END IF;
  IF v_panel_pour.ready_at <> v_panel_pour.poured_at + interval '24 hours' THEN
    RAISE EXCEPTION 'TEST 1B: ready_at should be poured_at + 24h, got %', v_panel_pour.ready_at - v_panel_pour.poured_at;
  END IF;
  INSERT INTO _test_results (test) VALUES ('1B: pieces + 24h cure window correct');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 2: UPDATE on production_actuals re-syncs mold_pours
-- (delete-and-insert pattern; idempotent)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_actual_id  uuid;
  v_pour_count int;
  v_panels     int;
BEGIN
  SELECT id INTO v_actual_id FROM production_actuals WHERE job_number = 'TEST-MP-1' LIMIT 1;
  IF v_actual_id IS NULL THEN RAISE EXCEPTION 'TEST 2 SETUP: missing test actual from Test 1'; END IF;

  -- Update the actual to add caps and bump panel count
  UPDATE production_actuals
     SET actual_panels = 24, actual_caps = 8
   WHERE id = v_actual_id;

  SELECT COUNT(*)::int INTO v_pour_count FROM mold_pours WHERE actual_id = v_actual_id;
  IF v_pour_count <> 3 THEN
    RAISE EXCEPTION 'TEST 2: expected 3 mold_pours rows after UPDATE (panels + posts + caps), got %', v_pour_count;
  END IF;

  SELECT pieces_poured INTO v_panels FROM mold_pours WHERE actual_id = v_actual_id AND pour_type = 'panels';
  IF v_panels <> 24 THEN
    RAISE EXCEPTION 'TEST 2B: expected 24 panels after UPDATE, got %', v_panels;
  END IF;
  INSERT INTO _test_results (test) VALUES ('2: UPDATE re-syncs mold_pours');
  INSERT INTO _test_results (test) VALUES ('2B: UPDATE pieces_poured reflects new value');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 3: v_mold_availability rolls active pours up correctly
-- Inserts a fresh-poured batch, then reads the view to confirm it surfaces.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_job_id     uuid;
  v_panels     int;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status NOT IN ('canceled','cancelled','lost','closed') LIMIT 1;

  -- Pour timestamp = now() so ready_at = now() + 24h is firmly in the future
  INSERT INTO production_actuals (job_id, job_number, style, color, height, actual_panels, submitted_at, production_date, shift)
  VALUES (v_job_id, 'TEST-MP-3', 'Used Brick Style', 'Adobe', '6', 18, now(), CURRENT_DATE, 1);

  SELECT panels_in_cure INTO v_panels FROM v_mold_availability WHERE style = 'Used Brick Style';
  IF v_panels IS NULL OR v_panels < 18 THEN
    RAISE EXCEPTION 'TEST 3: v_mold_availability should surface the 18 in-cure panels for Used Brick Style, got %', v_panels;
  END IF;
  INSERT INTO _test_results (test) VALUES ('3: v_mold_availability rolls up active pours');
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Test 4: function source has the expected pour-creation logic intact
-- (static check protects against accidental refactors silently dropping
-- one of the four pour_type branches)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_func_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'create_mold_pours_from_actual'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'TEST 4 SETUP: create_mold_pours_from_actual function not found';
  END IF;

  IF v_func_def NOT LIKE '%''panels''%' OR v_func_def NOT LIKE '%''posts''%'
     OR v_func_def NOT LIKE '%''rails''%'  OR v_func_def NOT LIKE '%''caps''%' THEN
    RAISE EXCEPTION 'TEST 4: function should INSERT for all four pour_types';
  END IF;
  INSERT INTO _test_results (test) VALUES ('4: function handles all four pour_types');
END $$;

SELECT id, test, status FROM _test_results ORDER BY id;
ROLLBACK;
