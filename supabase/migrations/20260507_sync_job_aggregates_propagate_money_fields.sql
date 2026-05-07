-- Extend sync_job_aggregates_from_line_items to also propagate the dollar
-- aggregates that come from line items: net_contract_value, pp_bond_amount,
-- maint_bond_amount, permit_amount.
--
-- Pre-existing gap (since the Pricing Book retirement on 2026-05-05): the
-- trigger only synced LF aggregates and primary style/color/height.
-- net_contract_value stayed at whatever value was last manually written,
-- so jobs created or edited via line items had jobs.net_contract_value=$0
-- → trg_recalc_adj_contract → adj_contract_value=$0 even when the job had
-- $33k of line items. Surfaced 2026-05-07 by Amiee's Woodhavyn job (26H033).
--
-- Categorization:
--   * net_contract_value  ← SUM(line_value) where fence_type is anything
--                          EXCEPT bonds and permits.
--   * pp_bond_amount      ← SUM(line_value) where fence_type='P&P Bond'.
--   * maint_bond_amount   ← SUM(line_value) where fence_type='Maint Bond'.
--   * permit_amount       ← SUM(line_value) where fence_type='Permit'.
--
-- trg_recalc_adj_contract then computes:
--   adj = net + COs + permit + pp_bond + maint_bond + sales_tax
-- automatically when these inputs change.
--
-- See the companion migration 20260507_sync_job_aggregates_guard_zero_sum_legacy
-- for the safety guard that protects 9 legacy jobs (line items with
-- contract_rate=NULL → line_value=0 → would have zeroed out a real
-- net_contract_value).

CREATE OR REPLACE FUNCTION public.sync_job_aggregates_from_line_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job_id        uuid;
  v_lf_pc         integer;
  v_lf_sw         integer;
  v_lf_wi         integer;
  v_lf_wood       integer;
  v_lf_other_raw  integer;
  v_lf_other_bkt  integer;
  v_lf_total      integer;
  v_gate_count    integer;
  v_net_value     numeric;
  v_pp_bond       numeric;
  v_maint_bond    numeric;
  v_permit        numeric;
  v_primary_style       text;
  v_primary_color       text;
  v_primary_height      text;
  v_primary_fence_type  text;
  v_primary_fence_label text;
  v_line_count    integer;
BEGIN
  v_job_id := COALESCE(NEW.job_id, OLD.job_id);
  IF v_job_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN fence_type = 'PC'    THEN lf ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'SW'    THEN lf ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'WI'    THEN lf ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'Wood'  THEN lf ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'Other' THEN lf ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type NOT IN ('Gate','Lump Sum','Columns','Permit','P&P Bond','Maint Bond') THEN lf ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'Gate' OR UPPER(LEFT(COALESCE(description,''),5)) = 'GATE:' THEN GREATEST(COALESCE(quantity,lf,1),1) ELSE 0 END), 0),
    COUNT(*),
    -- Net contract value: everything that isn't a bond or permit.
    COALESCE(SUM(CASE WHEN fence_type NOT IN ('P&P Bond','Maint Bond','Permit') THEN line_value ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'P&P Bond'   THEN line_value ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'Maint Bond' THEN line_value ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN fence_type = 'Permit'     THEN line_value ELSE 0 END), 0)
  INTO
    v_lf_pc, v_lf_sw, v_lf_wi, v_lf_wood, v_lf_other_raw,
    v_lf_total, v_gate_count, v_line_count,
    v_net_value, v_pp_bond, v_maint_bond, v_permit
  FROM job_line_items
  WHERE job_id = v_job_id;

  v_lf_other_bkt := v_lf_wood + v_lf_other_raw;

  SELECT style, color, COALESCE(height::text, NULL), fence_type
  INTO v_primary_style, v_primary_color, v_primary_height, v_primary_fence_type
  FROM job_line_items
  WHERE job_id = v_job_id
    AND fence_type = 'PC'
    AND is_produced IS DISTINCT FROM false
  ORDER BY line_value DESC NULLS LAST
  LIMIT 1;

  IF v_primary_fence_type IS NULL THEN
    SELECT fence_type
    INTO v_primary_fence_type
    FROM job_line_items
    WHERE job_id = v_job_id
      AND fence_type NOT IN ('Gate','Lump Sum','Columns','Permit','P&P Bond','Maint Bond')
    ORDER BY line_number NULLS LAST
    LIMIT 1;
  END IF;

  v_primary_fence_label := CASE v_primary_fence_type
    WHEN 'PC'    THEN 'Precast'
    WHEN 'SW'    THEN 'Masonry'
    WHEN 'WI'    THEN 'Wrought Iron'
    WHEN 'Wood'  THEN 'Wood'
    WHEN 'Other' THEN 'Other'
    ELSE NULL
  END;

  IF v_line_count = 0 THEN
    -- All line items removed: clean-slate the line-item-derived columns.
    UPDATE jobs
    SET
      lf_precast            = 0,
      lf_single_wythe       = 0,
      lf_wrought_iron       = 0,
      lf_wood               = 0,
      lf_other              = 0,
      total_lf_precast      = 0,
      total_lf_masonry      = 0,
      total_lf_wrought_iron = 0,
      total_lf              = 0,
      number_of_gates       = 0,
      net_contract_value    = 0,
      pp_bond_amount        = 0,
      maint_bond_amount     = 0,
      permit_amount         = 0
    WHERE id = v_job_id;
  ELSE
    -- Line items exist. LF aggregates always propagate (lf column reliable).
    -- Dollar aggregates use COALESCE(NULLIF(...,0), existing) — if SUM is 0,
    -- preserve the stored value. Protects 9 legacy jobs with contract_rate=NULL.
    UPDATE jobs
    SET
      lf_precast            = v_lf_pc,
      lf_single_wythe       = v_lf_sw,
      lf_wrought_iron       = v_lf_wi,
      lf_wood               = v_lf_wood,
      lf_other              = v_lf_other_bkt,
      total_lf_precast      = v_lf_pc,
      total_lf_masonry      = v_lf_sw,
      total_lf_wrought_iron = v_lf_wi,
      total_lf              = v_lf_total,
      number_of_gates       = v_gate_count,
      net_contract_value    = COALESCE(NULLIF(v_net_value, 0),  net_contract_value),
      pp_bond_amount        = COALESCE(NULLIF(v_pp_bond,    0), pp_bond_amount),
      maint_bond_amount     = COALESCE(NULLIF(v_maint_bond, 0), maint_bond_amount),
      permit_amount         = COALESCE(NULLIF(v_permit,     0), permit_amount),
      style                 = COALESCE(v_primary_style, style),
      color                 = COALESCE(v_primary_color, color),
      height_precast        = COALESCE(v_primary_height, height_precast),
      fence_type            = v_primary_fence_type,
      primary_fence_type    = COALESCE(v_primary_fence_label, primary_fence_type)
    WHERE id = v_job_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
