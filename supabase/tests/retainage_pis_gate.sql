-- retainage_pis_gate.sql
-- Asserts that fn_enforce_pis_for_retainage_release behaves correctly:
--   1. Blocks insert of is_retainage_release=true when PIS readiness item
--      is unchecked AND not_applicable=false.
--   2. Allows insert when PIS readiness item is checked (any path).
--   3. Allows insert when PIS readiness item is marked not_applicable=true.
--   4. Does NOT interfere with regular (is_retainage_release=false) inserts.
--
-- Wraps everything in BEGIN/ROLLBACK so production data is never mutated.
--
-- 2026-05-06 — Tier 1 retainage release gate.

BEGIN;

DO $$
DECLARE
  v_job_id      UUID;
  v_caught      BOOLEAN;
  v_app_id      UUID;
  v_cri_id      UUID;
  v_orig_state  RECORD;
BEGIN
  -- Pick a real job for testing. Any active job will do; we'll save and
  -- restore its readiness state, and roll back the whole transaction at end.
  SELECT id INTO v_job_id FROM jobs WHERE status NOT IN ('closed','canceled','lost') LIMIT 1;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'retainage_pis_gate test: no candidate job found in jobs';
  END IF;

  -- Save the current readiness state for this job + 'pis_submitted'
  SELECT id, checked_at, not_applicable, checked_by
    INTO v_orig_state
    FROM contract_readiness_items
   WHERE job_id = v_job_id AND item_key = 'pis_submitted';

  -- ─── 1. BLOCKED when PIS is unchecked + not_applicable=false ───
  IF v_orig_state.id IS NULL THEN
    -- No row yet; that already represents "unchecked + N/A=false". Skip a setup.
    NULL;
  ELSE
    UPDATE contract_readiness_items
       SET checked_at = NULL, checked_by = NULL, not_applicable = false
     WHERE id = v_orig_state.id;
  END IF;

  v_caught := false;
  BEGIN
    INSERT INTO invoice_applications (job_id, status, current_amount, is_retainage_release)
    VALUES (v_job_id, 'draft', 100, true);
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'retainage_pis_gate test #1 FAILED: gate did not block release on PIS-unchecked job';
  END IF;
  RAISE NOTICE 'retainage_pis_gate #1 PASS (block when PIS unchecked)';

  -- ─── 2. ALLOWED when PIS is checked ───
  IF v_orig_state.id IS NULL THEN
    INSERT INTO contract_readiness_items (job_id, item_key, checked_at, checked_by, not_applicable)
    VALUES (v_job_id, 'pis_submitted', now(), 'test', false)
    RETURNING id INTO v_cri_id;
  ELSE
    UPDATE contract_readiness_items
       SET checked_at = now(), checked_by = 'test', not_applicable = false
     WHERE id = v_orig_state.id;
  END IF;

  INSERT INTO invoice_applications (job_id, status, current_amount, is_retainage_release)
  VALUES (v_job_id, 'draft', 100, true)
  RETURNING id INTO v_app_id;

  IF v_app_id IS NULL THEN
    RAISE EXCEPTION 'retainage_pis_gate test #2 FAILED: insert returned no id';
  END IF;
  DELETE FROM invoice_applications WHERE id = v_app_id;
  RAISE NOTICE 'retainage_pis_gate #2 PASS (allow when PIS checked)';

  -- ─── 3. ALLOWED when not_applicable=true ───
  UPDATE contract_readiness_items
     SET checked_at = NULL, checked_by = 'test:na', not_applicable = true
   WHERE job_id = v_job_id AND item_key = 'pis_submitted';

  INSERT INTO invoice_applications (job_id, status, current_amount, is_retainage_release)
  VALUES (v_job_id, 'draft', 100, true)
  RETURNING id INTO v_app_id;

  IF v_app_id IS NULL THEN
    RAISE EXCEPTION 'retainage_pis_gate test #3 FAILED: insert returned no id';
  END IF;
  DELETE FROM invoice_applications WHERE id = v_app_id;
  RAISE NOTICE 'retainage_pis_gate #3 PASS (allow when N/A)';

  -- ─── 4. REGULAR (non-release) inserts are unaffected ───
  UPDATE contract_readiness_items
     SET checked_at = NULL, checked_by = NULL, not_applicable = false
   WHERE job_id = v_job_id AND item_key = 'pis_submitted';

  INSERT INTO invoice_applications (job_id, status, current_amount, is_retainage_release)
  VALUES (v_job_id, 'draft', 100, false)
  RETURNING id INTO v_app_id;

  IF v_app_id IS NULL THEN
    RAISE EXCEPTION 'retainage_pis_gate test #4 FAILED: regular insert returned no id';
  END IF;
  DELETE FROM invoice_applications WHERE id = v_app_id;
  RAISE NOTICE 'retainage_pis_gate #4 PASS (regular Apps unaffected)';

  RAISE NOTICE 'retainage_pis_gate ALL PASS';
END $$;

ROLLBACK;
