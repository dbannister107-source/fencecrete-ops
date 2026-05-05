-- supabase/tests/billing_engine.sql
--
-- Tests for the Accounting Sheet / Billing Engine schema (Phase A).
--
-- HOW TO RUN  (same pattern as readiness_gate.sql)
--   GitHub Actions runs this on every push + PR.
--   Local: paste into a Supabase MCP execute_sql call, or
--          psql "$SUPABASE_DB_URL" -f supabase/tests/billing_engine.sql
--
-- HOW IT WORKS
--   BEGIN ... ROLLBACK around the whole file. Each DO block raises on
--   failure (aborts the run) or INSERTs into _test_results on pass.
--
-- COVERAGE
--   1.  job_pricing_lines.extended_total auto-recomputes on UPDATE
--   2a. job_stage_weights accepts a balanced override set
--   2b. job_stage_weights rejects mis-summed overrides
--   3.  v_effective_stage_weights resolves override-then-default
--   4.  invoice_applications.app_number auto-increments per job
--   5.  invoice_applications.invoice_number auto-generates;
--       manual override preserved
--   6.  trg_compute_invoice_app_totals: current_retainage and net_due
--   7.  draft -> filed posts to invoice_entries
--   8.  synthetic apps (source_invoice_entry_id set) skip the post-back
--   9.  jobs.retainage_held mirrors latest filed App
--   10. retainage-release App resets jobs.retainage_held to 0

BEGIN;

CREATE TEMP TABLE _test_results (
  id     serial PRIMARY KEY,
  test   text,
  status text DEFAULT 'PASS'
);

-- Test 1: extended_total auto-recomputes on qty / price_per_unit UPDATE
DO $$
DECLARE v_job_id uuid; v_line_id uuid; v_total numeric;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'TEST 1 SETUP: no jobs available'; END IF;

  INSERT INTO job_pricing_lines (job_id, line_number, category, label, qty, unit, price_per_unit, labor_per_unit, tax_basis_per_unit)
  VALUES (v_job_id, 9001, 'precast', 'TEST', 100, 'LF', 95, 72, 23) RETURNING id INTO v_line_id;
  SELECT extended_total INTO v_total FROM job_pricing_lines WHERE id = v_line_id;
  IF v_total <> 9500 THEN RAISE EXCEPTION 'TEST 1: expected 9500, got %', v_total; END IF;

  UPDATE job_pricing_lines SET qty=200 WHERE id=v_line_id;
  SELECT extended_total INTO v_total FROM job_pricing_lines WHERE id=v_line_id;
  IF v_total <> 19000 THEN RAISE EXCEPTION 'TEST 1 (UPDATE qty): expected 19000, got %', v_total; END IF;

  UPDATE job_pricing_lines SET price_per_unit=100 WHERE id=v_line_id;
  SELECT extended_total INTO v_total FROM job_pricing_lines WHERE id=v_line_id;
  IF v_total <> 20000 THEN RAISE EXCEPTION 'TEST 1 (UPDATE price): expected 20000, got %', v_total; END IF;

  INSERT INTO _test_results (test) VALUES ('1: extended_total recomputes on qty + price_per_unit UPDATE');
END;
$$;

-- Test 2a: balanced override (sum = 1.00) accepted
DO $$
DECLARE v_job_id uuid;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  INSERT INTO job_stage_weights (job_id, category, stage_key, weight) VALUES
    (v_job_id, 'precast', 'posts_only',   0.70),
    (v_job_id, 'precast', 'posts_panels', 0.20),
    (v_job_id, 'precast', 'complete',     0.10);
  DELETE FROM job_stage_weights WHERE job_id=v_job_id;
  INSERT INTO _test_results (test) VALUES ('2a: balanced override (0.70/0.20/0.10) accepted');
END;
$$;

-- Test 2b: mis-summed override (sum = 0.85) rejected
DO $$
DECLARE v_job_id uuid; v_caught boolean := false;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  BEGIN
    INSERT INTO job_stage_weights (job_id, category, stage_key, weight) VALUES
      (v_job_id, 'precast', 'posts_only',   0.50),
      (v_job_id, 'precast', 'posts_panels', 0.25),
      (v_job_id, 'precast', 'complete',     0.10);
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'TEST 2b: mis-summed override (sum=0.85) was accepted'; END IF;
  INSERT INTO _test_results (test) VALUES ('2b: mis-summed override (sum=0.85) rejected');
END;
$$;

-- Test 3: v_effective_stage_weights resolves override-then-default
DO $$
DECLARE v_job_id uuid; v_w numeric;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  DELETE FROM job_stage_weights WHERE job_id = v_job_id;

  -- baseline (no override): defaults to seeded 0.65 for posts_only
  SELECT weight INTO v_w FROM v_effective_stage_weights
   WHERE job_id=v_job_id AND category='precast' AND stage_key='posts_only';
  IF v_w <> 0.65 THEN RAISE EXCEPTION 'TEST 3 default: expected 0.65, got %', v_w; END IF;

  -- with override: should resolve to 0.70
  INSERT INTO job_stage_weights VALUES
    (v_job_id,'precast','posts_only',0.70),
    (v_job_id,'precast','posts_panels',0.20),
    (v_job_id,'precast','complete',0.10);
  SELECT weight INTO v_w FROM v_effective_stage_weights
   WHERE job_id=v_job_id AND category='precast' AND stage_key='posts_only';
  IF v_w <> 0.70 THEN RAISE EXCEPTION 'TEST 3 override: expected 0.70, got %', v_w; END IF;

  INSERT INTO _test_results (test) VALUES ('3: v_effective_stage_weights resolves override-then-default');
END;
$$;

-- Test 4: app_number auto-increments per job on INSERT
DO $$
DECLARE v_job_id uuid; v_n1 int; v_n2 int;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  INSERT INTO invoice_applications (job_id, current_amount) VALUES (v_job_id, 1000) RETURNING app_number INTO v_n1;
  INSERT INTO invoice_applications (job_id, current_amount) VALUES (v_job_id, 2000) RETURNING app_number INTO v_n2;
  IF v_n2 <> v_n1 + 1 THEN RAISE EXCEPTION 'TEST 4: expected increment, got % then %', v_n1, v_n2; END IF;
  INSERT INTO _test_results (test) VALUES ('4: app_number auto-increments per job');
END;
$$;

-- Test 5: invoice_number auto-gen INV-{job}-{NN}; manual flag preserves
DO $$
DECLARE v_job_id uuid; v_jn text; v_inv text; v_inv2 text;
BEGIN
  SELECT id, job_number INTO v_job_id, v_jn FROM jobs WHERE status='contract_review' AND job_number IS NOT NULL LIMIT 1;
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'TEST 5 SETUP: no jobs with job_number'; END IF;

  -- auto-gen path
  INSERT INTO invoice_applications (job_id, current_amount) VALUES (v_job_id, 100) RETURNING invoice_number INTO v_inv;
  IF v_inv NOT LIKE 'INV-' || v_jn || '-%' THEN
    RAISE EXCEPTION 'TEST 5 (auto): expected prefix INV-%-, got %', v_jn, v_inv;
  END IF;

  -- manual override path
  INSERT INTO invoice_applications (job_id, invoice_number, invoice_number_manual, current_amount)
       VALUES (v_job_id, 'CUSTOM-INV-XYZ', true, 200) RETURNING invoice_number INTO v_inv2;
  IF v_inv2 <> 'CUSTOM-INV-XYZ' THEN
    RAISE EXCEPTION 'TEST 5 (manual): expected CUSTOM-INV-XYZ, got %', v_inv2;
  END IF;

  INSERT INTO _test_results (test) VALUES ('5: invoice_number auto-gen + manual override preserved');
END;
$$;

-- Test 6: current_retainage = current_amount × retainage_pct/100; net_due = current - retainage
DO $$
DECLARE v_job_id uuid; v_pl_id uuid; v_app_id uuid; v_ret numeric; v_net numeric;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  UPDATE jobs SET retainage_pct = 10 WHERE id = v_job_id;

  INSERT INTO job_pricing_lines (job_id, line_number, category, label, qty, unit, price_per_unit, labor_per_unit, tax_basis_per_unit)
       VALUES (v_job_id, 9100, 'precast', 'TEST', 100, 'LF', 95, 72, 23) RETURNING id INTO v_pl_id;
  INSERT INTO invoice_applications (job_id) VALUES (v_job_id) RETURNING id INTO v_app_id;
  INSERT INTO invoice_application_lines (
    invoice_application_id, job_pricing_line_id, stage_key,
    cumulative_qty, prior_qty, current_qty, rate_per_unit,
    current_labor_amount, current_tax_basis_amount, current_tax_amount, current_total
  ) VALUES (
    v_app_id, v_pl_id, 'posts_only', 100, 0, 100, 61.75,
    4680.00, 1495.00, 123.34, 6298.34
  );

  SELECT current_retainage, net_due INTO v_ret, v_net FROM invoice_applications WHERE id=v_app_id;
  IF v_ret <> 629.83 THEN RAISE EXCEPTION 'TEST 6 retainage: expected 629.83, got %', v_ret; END IF;
  IF v_net <> 5668.51 THEN RAISE EXCEPTION 'TEST 6 net_due: expected 5668.51, got %', v_net; END IF;

  INSERT INTO _test_results (test) VALUES ('6: current_retainage = current_amount * retainage_pct/100; net_due correct');
END;
$$;

-- Test 7: status draft -> filed posts a row into invoice_entries
DO $$
DECLARE v_job_id uuid; v_app_id uuid; v_inv text; v_count int;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;

  INSERT INTO invoice_applications (job_id) VALUES (v_job_id)
    RETURNING id, invoice_number INTO v_app_id, v_inv;
  UPDATE invoice_applications SET current_amount = 5000, invoice_date = CURRENT_DATE WHERE id=v_app_id;
  UPDATE invoice_applications SET status='filed', filed_by='test-suite' WHERE id=v_app_id;

  SELECT count(*) INTO v_count FROM invoice_entries WHERE job_id=v_job_id AND invoice_number=v_inv;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 7: expected 1 entry for %, got %', v_inv, v_count; END IF;

  INSERT INTO _test_results (test) VALUES ('7: draft->filed posts to invoice_entries');
END;
$$;

-- Test 8: synthetic apps (source_invoice_entry_id set) do NOT post back
DO $$
DECLARE v_job_id uuid; v_existing_id uuid; v_app_id uuid; v_before int; v_after int;
BEGIN
  SELECT ie.id, ie.job_id INTO v_existing_id, v_job_id FROM invoice_entries ie LIMIT 1;
  IF v_existing_id IS NULL THEN
    INSERT INTO _test_results (test, status) VALUES ('8: synthetic-app no-leak (skipped — no invoice_entries)', 'SKIP');
    RETURN;
  END IF;

  SELECT count(*) INTO v_before FROM invoice_entries WHERE job_id=v_job_id;
  INSERT INTO invoice_applications (
    job_id, current_amount, source_invoice_entry_id, invoice_number, invoice_number_manual
  ) VALUES (
    v_job_id, 999, v_existing_id, 'SYNTH-TEST-001', true
  ) RETURNING id INTO v_app_id;
  UPDATE invoice_applications SET status='filed', filed_by='test-suite' WHERE id=v_app_id;

  SELECT count(*) INTO v_after FROM invoice_entries WHERE job_id=v_job_id;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'TEST 8: synthetic filing leaked into invoice_entries (was %, now %)', v_before, v_after;
  END IF;

  INSERT INTO _test_results (test) VALUES ('8: synthetic apps (source_invoice_entry_id set) do NOT post back to invoice_entries');
END;
$$;

-- Test 9: jobs.retainage_held tracks latest filed App
DO $$
DECLARE v_job_id uuid; v_held numeric;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  UPDATE jobs SET retainage_pct = 10 WHERE id = v_job_id;
  DELETE FROM invoice_applications WHERE job_id = v_job_id;  -- predictable starting state

  INSERT INTO invoice_applications (job_id, current_amount, current_retainage, retainage_to_date, status, filed_by)
       VALUES (v_job_id, 10000, 1000, 1000, 'filed', 'test-suite');

  SELECT retainage_held INTO v_held FROM jobs WHERE id = v_job_id;
  IF v_held <> 1000 THEN RAISE EXCEPTION 'TEST 9: expected retainage_held=1000, got %', v_held; END IF;

  INSERT INTO _test_results (test) VALUES ('9: jobs.retainage_held mirrors latest filed App retainage_to_date');
END;
$$;

-- Test 10: retainage-release App resets jobs.retainage_held to 0
DO $$
DECLARE v_job_id uuid; v_held numeric;
BEGIN
  SELECT id INTO v_job_id FROM jobs WHERE status='contract_review' LIMIT 1;
  UPDATE jobs SET retainage_pct = 10 WHERE id = v_job_id;
  DELETE FROM invoice_applications WHERE job_id = v_job_id;

  INSERT INTO invoice_applications (job_id, current_amount, current_retainage, retainage_to_date, status, filed_by)
       VALUES (v_job_id, 10000, 1000, 1000, 'filed', 'test-suite');

  SELECT retainage_held INTO v_held FROM jobs WHERE id = v_job_id;
  IF v_held <> 1000 THEN RAISE EXCEPTION 'TEST 10 PRE: expected 1000, got %', v_held; END IF;

  INSERT INTO invoice_applications (
    job_id, current_amount, current_retainage, retainage_to_date,
    status, filed_by, is_retainage_release
  ) VALUES (
    v_job_id, 1000, 0, 0, 'filed', 'test-suite', true
  );

  SELECT retainage_held INTO v_held FROM jobs WHERE id = v_job_id;
  IF v_held <> 0 THEN RAISE EXCEPTION 'TEST 10 POST: expected 0 after release, got %', v_held; END IF;

  INSERT INTO _test_results (test) VALUES ('10: retainage-release App resets jobs.retainage_held to 0');
END;
$$;

-- Final readout
SELECT id, status, test FROM _test_results ORDER BY id;

ROLLBACK;
