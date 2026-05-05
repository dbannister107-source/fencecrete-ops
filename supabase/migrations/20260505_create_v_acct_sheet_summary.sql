-- 20260505_create_v_acct_sheet_summary.sql
--
-- Phase C of the Acct Sheet / Billing Engine. Per-pricing-line rollup
-- view used by Reports and ad-hoc SQL queries. Phase D's UI uses the
-- JS calc engine (src/shared/billing/acctSheet.js) for live drafts;
-- this view is for "what's already been billed" snapshots without
-- recomputing in the app.
--
-- Distinct name from the existing v_acct_sheet_lines view (which reads
-- from job_line_items and predates Phase A — left in place untouched
-- per CLAUDE.md no-destructive-ops rule, but deprecated by this work).
--
-- One row per job_pricing_lines row (= per-pricing-scope on the contract).
-- billed_to_date sums current_total across all filed/paid invoice
-- application lines for that pricing line × stage. balance_to_bill and
-- pct_complete derive from contract_value and billed_to_date.

CREATE OR REPLACE VIEW public.v_acct_sheet_summary AS
SELECT
  jpl.job_id,
  jpl.id                              AS pricing_line_id,
  jpl.co_id,
  jpl.line_number,
  jpl.category,
  jpl.label,
  jpl.height,
  jpl.style,
  jpl.qty                             AS contract_qty,
  jpl.unit,
  jpl.price_per_unit,
  jpl.labor_per_unit,
  jpl.tax_basis_per_unit,
  jpl.tax_exempt,
  jpl.extended_total                  AS contract_value,
  COALESCE(billed.billed_to_date, 0)  AS billed_to_date,
  jpl.extended_total - COALESCE(billed.billed_to_date, 0)
                                      AS balance_to_bill,
  CASE WHEN jpl.extended_total > 0
       THEN ROUND(COALESCE(billed.billed_to_date, 0) / jpl.extended_total * 100, 1)
       ELSE 0 END                     AS pct_complete
FROM public.job_pricing_lines jpl
LEFT JOIN (
  SELECT
    ial.job_pricing_line_id,
    SUM(ial.current_total) AS billed_to_date
  FROM public.invoice_application_lines ial
  JOIN public.invoice_applications ia ON ia.id = ial.invoice_application_id
  WHERE ia.status IN ('filed','paid')
  GROUP BY ial.job_pricing_line_id
) billed ON billed.job_pricing_line_id = jpl.id;

COMMENT ON VIEW public.v_acct_sheet_summary IS
  'Per-pricing-line rollup for the Acct Sheet. Each row = one job_pricing_lines row with billed-to-date, balance, and pct_complete computed from filed/paid invoice_applications. Phase D Acct Sheet header and Reports/exports read from here. Unrelated to the legacy v_acct_sheet_lines view (which reads from job_line_items and predates Phase A).';
