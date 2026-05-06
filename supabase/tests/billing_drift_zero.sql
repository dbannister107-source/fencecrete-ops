-- billing_drift_zero.sql
-- Asserts that the four canonical billing equations hold across all jobs.
-- Runs in CI on every push via .github/workflows/db-tests.yml.
-- Failure = a trigger has stopped maintaining the canonical equation;
--          investigate which trigger before fixing the data.
--
-- 2026-05-06 — Added as part of Tier 1 cleanup of the PM Bill Sheets system.

DO $$
DECLARE
  v_ytd_drift  INT;
  v_pct_drift  INT;
  v_left_drift INT;
  v_lf_drift   INT;
BEGIN
  -- 1) ytd_invoiced = SUM(invoice_entries.invoice_amount)
  --    Maintained by recalc_ytd_invoiced() AFTER trigger on invoice_entries.
  SELECT COUNT(*) INTO v_ytd_drift
  FROM jobs j
  LEFT JOIN (
    SELECT job_id, SUM(invoice_amount) AS tot FROM invoice_entries GROUP BY job_id
  ) e ON e.job_id = j.id
  WHERE ABS(COALESCE(j.ytd_invoiced, 0) - COALESCE(e.tot, 0)) > 1;
  IF v_ytd_drift > 0 THEN
    RAISE EXCEPTION 'ytd_invoiced drift on % job(s) — recalc_ytd_invoiced trigger may have failed', v_ytd_drift;
  END IF;

  -- 2) pct_billed = ROUND(ytd_invoiced / adj_contract_value, 4)
  --    Maintained by calculate_billing_fields() BEFORE trigger on jobs.
  SELECT COUNT(*) INTO v_pct_drift
  FROM jobs
  WHERE COALESCE(adj_contract_value, 0) > 0
    AND ABS(COALESCE(pct_billed, 0)
            - ROUND((COALESCE(ytd_invoiced, 0) / adj_contract_value)::numeric, 4)) > 0.0001;
  IF v_pct_drift > 0 THEN
    RAISE EXCEPTION 'pct_billed drift on % job(s) — calculate_billing_fields trigger may have failed', v_pct_drift;
  END IF;

  -- 3) left_to_bill = GREATEST(adj_contract_value - ytd_invoiced, 0)
  --    Clamp at 0 is intentional: over-billed jobs (ytd > adj) show $0 left,
  --    not negative dollars. Same trigger as #2.
  SELECT COUNT(*) INTO v_left_drift
  FROM jobs
  WHERE ABS(COALESCE(left_to_bill, 0)
            - GREATEST(COALESCE(adj_contract_value, 0) - COALESCE(ytd_invoiced, 0), 0)) > 1;
  IF v_left_drift > 0 THEN
    RAISE EXCEPTION 'left_to_bill drift on % job(s) — calculate_billing_fields trigger may have failed', v_left_drift;
  END IF;

  -- 4) lf_installed_to_date = SUM(reviewed pm_bill_submissions.total_lf)
  --    Maintained by recalc_lf_installed_to_date() AFTER trigger on
  --    pm_bill_submissions (replaced the legacy additive trigger 2026-05-06).
  SELECT COUNT(*) INTO v_lf_drift
  FROM jobs j
  LEFT JOIN (
    SELECT job_id, SUM(total_lf) AS tot
    FROM pm_bill_submissions
    WHERE ar_reviewed = true
    GROUP BY job_id
  ) s ON s.job_id = j.id
  WHERE ABS(COALESCE(j.lf_installed_to_date, 0) - COALESCE(s.tot, 0)) > 1;
  IF v_lf_drift > 0 THEN
    RAISE EXCEPTION 'lf_installed_to_date drift on % job(s) — recalc_lf_installed_to_date trigger may have failed', v_lf_drift;
  END IF;

  RAISE NOTICE 'billing_drift_zero PASS — ytd / pct / left / lf all canonical';
END $$;
