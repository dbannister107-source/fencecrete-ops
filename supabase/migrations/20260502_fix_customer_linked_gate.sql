-- 20260502_fix_customer_linked_gate.sql
--
-- Tighten the contract-readiness `customer_linked` gate to require an actual
-- company linkage (or the residential flag), not just a non-empty
-- `customer_name` string. The previous check passed every job with any text
-- in customer_name, including obvious garbage ("TX"), so the gate never
-- actually fired.
--
-- After this migration:
--   - auto_checks.customer_linked is TRUE iff company_id IS NOT NULL OR is_residential = TRUE
--   - is_ready (and therefore the trg_enforce_contract_readiness hard-stop)
--     uses the same definition
--
-- 21 contract_review jobs are expected to flip from passing -> failing on
-- this check. They will be unable to advance status until either linked to
-- a company in Customer Master -> Reconcile, or marked residential.

CREATE OR REPLACE VIEW public.v_contract_readiness AS
WITH manual_items AS (
  SELECT j_1.id AS job_id,
    jsonb_object_agg(
      cri.item_key,
      jsonb_build_object(
        'checked_at', cri.checked_at,
        'checked_by', cri.checked_by,
        'not_applicable', cri.not_applicable,
        'notes', cri.notes
      )
    ) FILTER (WHERE cri.id IS NOT NULL) AS items
  FROM jobs j_1
  LEFT JOIN contract_readiness_items cri ON cri.job_id = j_1.id
  GROUP BY j_1.id
), line_height AS (
  SELECT job_line_items.job_id,
    bool_or(job_line_items.height IS NOT NULL AND job_line_items.height <> ''::text) AS has_height
  FROM job_line_items
  GROUP BY job_line_items.job_id
), line_style AS (
  SELECT job_line_items.job_id,
    bool_or(job_line_items.style IS NOT NULL AND job_line_items.style <> ''::text) AS has_style,
    bool_or(job_line_items.color IS NOT NULL AND job_line_items.color <> ''::text) AS has_color
  FROM job_line_items
  GROUP BY job_line_items.job_id
), line_value AS (
  SELECT job_line_items.job_id,
    COALESCE(sum(job_line_items.line_value), 0::numeric) AS line_total
  FROM job_line_items
  GROUP BY job_line_items.job_id
), co_value AS (
  SELECT change_orders.job_id,
    COALESCE(sum(change_orders.amount), 0::numeric) AS co_total
  FROM change_orders
  WHERE change_orders.status = 'approved'::text
  GROUP BY change_orders.job_id
)
SELECT
  j.id AS job_id,
  j.job_number,
  j.job_name,
  j.status,
  j.contract_executed,
  jsonb_build_object(
    'customer_linked',           j.company_id IS NOT NULL OR COALESCE(j.is_residential, FALSE) = TRUE,
    'style_set',                 (j.style IS NOT NULL AND j.style <> ''::text) OR COALESCE(ls.has_style, FALSE),
    'color_set',                 (j.color IS NOT NULL AND j.color <> ''::text) OR COALESCE(ls.has_color, FALSE),
    'height_set',                COALESCE(lh.has_height, FALSE),
    'total_lf_set',              COALESCE(j.total_lf, 0) > 0,
    'contract_value_set',        COALESCE(j.adj_contract_value, 0::numeric) > 0::numeric,
    'line_items_entered',        EXISTS (SELECT 1 FROM job_line_items WHERE job_line_items.job_id = j.id),
    'line_items_match_contract', abs(
      COALESCE(j.adj_contract_value, 0::numeric)
      - COALESCE(lv.line_total, 0::numeric)
      - COALESCE(cv.co_total, 0::numeric)
      - COALESCE(j.sales_tax_amount, 0::numeric)
      - COALESCE(j.permit_amount, 0::numeric)
      - COALESCE(j.pp_bond_amount, 0::numeric)
      - COALESCE(j.maint_bond_amount, 0::numeric)
    ) <= 1::numeric
  ) AS auto_checks,
  COALESCE(mi.items, '{}'::jsonb) AS manual_items,
  (j.company_id IS NOT NULL OR COALESCE(j.is_residential, FALSE) = TRUE)
  AND ((j.style IS NOT NULL AND j.style <> ''::text) OR COALESCE(ls.has_style, FALSE))
  AND ((j.color IS NOT NULL AND j.color <> ''::text) OR COALESCE(ls.has_color, FALSE))
  AND COALESCE(lh.has_height, FALSE)
  AND COALESCE(j.total_lf, 0) > 0
  AND COALESCE(j.adj_contract_value, 0::numeric) > 0::numeric
  AND EXISTS (SELECT 1 FROM job_line_items WHERE job_line_items.job_id = j.id)
  AND abs(
    COALESCE(j.adj_contract_value, 0::numeric)
    - COALESCE(lv.line_total, 0::numeric)
    - COALESCE(cv.co_total, 0::numeric)
    - COALESCE(j.sales_tax_amount, 0::numeric)
    - COALESCE(j.permit_amount, 0::numeric)
    - COALESCE(j.pp_bond_amount, 0::numeric)
    - COALESCE(j.maint_bond_amount, 0::numeric)
  ) <= 1::numeric
  AND (
    SELECT count(*)
    FROM contract_readiness_items
    WHERE contract_readiness_items.job_id = j.id
      AND (contract_readiness_items.checked_at IS NOT NULL OR contract_readiness_items.not_applicable = TRUE)
      AND contract_readiness_items.item_key = ANY (ARRAY['pis_submitted'::text, 'payment_terms'::text])
  ) = 2 AS is_ready
FROM jobs j
LEFT JOIN manual_items mi ON mi.job_id = j.id
LEFT JOIN line_height  lh ON lh.job_id = j.id
LEFT JOIN line_style   ls ON ls.job_id = j.id
LEFT JOIN line_value   lv ON lv.job_id = j.id
LEFT JOIN co_value     cv ON cv.job_id = j.id;
