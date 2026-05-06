// Acct Sheet calc engine — Phase C of the Billing Engine build (2026-05-05).
//
// Pure JS, no I/O, no React, no DB. Phase D fetches all the inputs in
// parallel and hands them to computeAcctSheet(); the engine returns a
// structured object that drives the entire Acct Sheet UI.
//
// Mirrors the math the Excel "Acct Sheet" produces — for each pricing
// line × each billing stage, compute a cell with cumulative_qty,
// prior_qty, current_qty, labor_amount, tax_basis_amount, tax_amount,
// total. Roll up to the App-level totals (with retainage) and the
// per-line + contract-level summaries.
//
// Apportionment (function 1): the OPS PM bill submission stores aggregate
// per-stage LF (e.g. labor_post_only = 200), not per-height. The engine
// distributes that aggregate across pricing lines in the same category
// proportionally to contract qty share. Decision A from the Phase C
// planning round (2026-05-05) — least-surprising default; over-billing
// protection catches mistakes either way.
//
// All money values rounded to 2 decimals via ROUND_2 to keep the engine's
// outputs stable across float-arithmetic rounding paths.

// Explicit .js extension so native Node ESM (used by verify.mjs) resolves
// the path; webpack/CRA accept either form.
import { TAX_RATE } from './heightBasis.js';

// ─── Constants ───────────────────────────────────────────────────────

// PM bill submission column → (pricing_lines.category, stage_weights.stage_key).
// Only fence categories (precast, sw) are auto-mapped. Gates / options /
// permits / bonds are single-stage and need explicit cycleOverrides
// from the UI — they're billed all-or-nothing per cycle.
const PM_STAGE_MAP = {
  labor_post_only:   ['precast', 'posts_only'],
  labor_post_panels: ['precast', 'posts_panels'],
  labor_complete:    ['precast', 'complete'],
  sw_foundation:     ['sw',      'foundation'],
  sw_columns:        ['sw',      'columns'],
  sw_panels:         ['sw',      'panels'],
  sw_complete:       ['sw',      'cleanup'],
};

// Tolerance for over-billing detection. cumulative > contract × 1.001
// means the user is asking us to bill more LF than the contract has.
// 0.1% slack absorbs harmless float drift from apportionment.
const OVER_BILL_TOL = 1.001;

// ─── Helpers ─────────────────────────────────────────────────────────

const NUM = (x) => Number(x) || 0;
const ROUND_2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// 2026-05-05 (Option C — Phase 1) — adapter for the new single-source-of-
// truth model where `job_line_items` is the only pricing table. Translates
// a job_line_items row into the engine's internal shape (qty / category /
// price_per_unit / labor_per_unit / tax_basis_per_unit / tax_exempt /
// extended_total / label).
//
// Idempotent: rows that already look normalized (have `qty` AND
// `price_per_unit`) pass through unchanged so existing test fixtures keep
// working without churn.
//
// Category normalization mirrors classifyForPricing() in JobPricingEditor.jsx
// so the engine's PM_STAGE_MAP keys still match. Raw job_line_items.category
// vocabulary (lump_sum / wi / gate / change_order / wood / site_work /
// removal) is mapped to the engine's normalized vocabulary (precast / sw /
// wi_gate / permit / bond / option / other) via category-then-fence_type
// resolution.
export function normalizeLineItem(li) {
  if (!li) return li;
  // Already normalized — bypass (test fixture path).
  if (li.qty != null && li.price_per_unit != null) return li;

  const rawCat = (li.category || '').toLowerCase();
  const ft = li.fence_type || '';
  let category = 'other';
  if (rawCat === 'precast' || ft === 'PC')                                category = 'precast';
  else if (rawCat === 'sw' || rawCat === 'site_work' || rawCat === 'wi' || rawCat === 'wood' || ft === 'SW' || ft === 'WI') category = 'sw';
  else if (rawCat === 'gate' || rawCat === 'wi_gate' || ft === 'Gate')    category = 'wi_gate';
  else if (rawCat === 'permit' || ft === 'Permit')                         category = 'permit';
  else if (rawCat === 'bond' || ft === 'P&P Bond' || ft === 'Maint Bond' || ft === 'Insurance') category = 'bond';
  else if (rawCat === 'lump_sum' || ft === 'Lump Sum' || ft === 'Columns' || ft === 'Gate Controls') category = 'option';

  const qty            = NUM(li.quantity != null ? li.quantity : li.lf);
  const price_per_unit = NUM(li.unit_price != null ? li.unit_price : li.contract_rate);
  const extended_total = li.line_value != null ? NUM(li.line_value) : ROUND_2(qty * price_per_unit);

  // Label: prefer description; fall back to "{height}' pc" / "{height}' sw"
  // / "WI Gate" pattern, mirroring buildLabel() from JobPricingEditor.jsx.
  let label = li.description || '';
  if (!label) {
    const h = String(li.height ?? '').replace(/['"]/g, '').trim();
    if (category === 'precast' && h)    label = `${h}' pc`;
    else if (category === 'sw' && h)    label = `${h}' sw`;
    else if (category === 'wi_gate')    label = li.fence_type || 'WI Gate';
    else                                label = li.fence_type || category;
  }

  return {
    id:                 li.id,
    co_id:              li.co_id || null,
    line_number:        li.line_number,
    category,
    label,
    height:             li.height || null,
    style:              li.style || null,
    fence_type:         li.fence_type || null,
    qty,
    unit:               li.unit || (category === 'wi_gate' ? 'EA' : (category === 'permit' || category === 'bond' || category === 'option') ? 'LS' : 'LF'),
    price_per_unit,
    labor_per_unit:     li.labor_per_unit != null ? NUM(li.labor_per_unit) : null,
    tax_basis_per_unit: li.tax_basis_per_unit != null ? NUM(li.tax_basis_per_unit) : null,
    tax_exempt:         li.taxable === false,  // inverted: taxable=false → exempt
    extended_total,
  };
}

// ─── 1. apportionPmSubmission ───────────────────────────────────────
//
// Maps the PM bill submission's aggregate per-stage LF columns onto
// per-pricing-line cumulative qty. Proportional split by contract qty
// share within each category.
//
// Returns: { [pricing_line_id]: { [stage_key]: cumulative_qty } }
//
// Skips:
//   - PM submission missing entirely
//   - Stage column with 0 / null value
//   - Categories where total contract qty = 0 (cannot divide)

export function apportionPmSubmission({ pmSubmission, pricingLines } = {}) {
  const out = {};
  if (!pmSubmission) return out;

  // Index pricing lines by category for fast per-column lookup.
  const byCategory = {};
  (pricingLines || []).forEach((pl) => {
    if (!byCategory[pl.category]) byCategory[pl.category] = [];
    byCategory[pl.category].push(pl);
  });

  Object.entries(PM_STAGE_MAP).forEach(([col, [category, stage]]) => {
    const stageQty = NUM(pmSubmission[col]);
    if (stageQty <= 0) return;
    const lines = byCategory[category] || [];
    const totalQty = lines.reduce((s, l) => s + NUM(l.qty), 0);
    if (totalQty <= 0) return;
    lines.forEach((line) => {
      const share = NUM(line.qty) / totalQty;
      if (!out[line.id]) out[line.id] = {};
      out[line.id][stage] = ROUND_2(stageQty * share);
    });
  });

  return out;
}

// ─── 2. mergeCumulativeQtys ─────────────────────────────────────────
//
// Layers user-provided cycleOverrides on top of the apportioned PM
// values. Overrides win per (pricing_line_id, stage_key) cell — used for
// gates / options / permits / bonds (single-stage manual checkboxes)
// AND for any per-cell PM corrections the user wants to apply.

export function mergeCumulativeQtys(apportioned = {}, cycleOverrides = {}) {
  // Shallow clone the per-line maps so we don't mutate the input.
  const merged = {};
  Object.entries(apportioned || {}).forEach(([k, v]) => { merged[k] = { ...v }; });
  Object.entries(cycleOverrides || {}).forEach(([pricing_line_id, stages]) => {
    if (!merged[pricing_line_id]) merged[pricing_line_id] = {};
    Object.entries(stages || {}).forEach(([stage_key, qty]) => {
      merged[pricing_line_id][stage_key] = NUM(qty);
    });
  });
  return merged;
}

// ─── 3. computeDraftCells ───────────────────────────────────────────
//
// The core math. For each (pricing_line × stage), produce a draft cell
// with the full breakdown (current qty, labor / tax_basis / tax / total
// amounts) plus an over-billing warning when applicable.
//
// Returns ALL cells regardless of whether qty is 0 — the UI decides
// what to show. Phase D's "File App" path filters to non-zero cells
// when persisting to invoice_application_lines.

export function computeDraftCells({
  pricingLines = [],
  effectiveWeights = [],
  cumulativeQtys = {},
  priorAppLines = [],
  jobTaxExempt = false,
} = {}) {
  // Index weights: { [category]: [{stage_key, stage_label, weight, display_order}] }
  const weightsByCategory = {};
  effectiveWeights.forEach((w) => {
    if (!weightsByCategory[w.category]) weightsByCategory[w.category] = [];
    weightsByCategory[w.category].push(w);
  });

  // Index prior cumulative qty per (job_line_item_id, stage_key).
  // Multiple prior apps can have lines for the same cell; cumulative_qty
  // is monotonically non-decreasing across apps, so MAX = latest.
  const priorCumByCell = {};
  priorAppLines.forEach((pl) => {
    const k = `${pl.job_line_item_id}|${pl.stage_key}`;
    const v = NUM(pl.cumulative_qty);
    if (priorCumByCell[k] == null || v > priorCumByCell[k]) priorCumByCell[k] = v;
  });

  const cells = [];
  pricingLines.forEach((line) => {
    const stages = (weightsByCategory[line.category] || [])
      .slice()
      .sort((a, b) => NUM(a.display_order) - NUM(b.display_order));

    stages.forEach((s) => {
      const k = `${line.id}|${s.stage_key}`;
      const prior_qty = NUM(priorCumByCell[k]);
      // 2026-05-05 (H1 fix): default cumulative to prior when no input is
      // provided for this cell. Without this, an already-billed cell with no
      // override and no PM apportionment would compute current_qty = 0 - prior
      // = NEGATIVE, causing the File flow to post a credit invoice. The
      // semantic is "no input = no change since last cycle"; the user must
      // explicitly set cumulative=0 (or a partial value) to bill less than
      // already billed (which the engine surfaces via the decreasing-cumulative
      // path — see validateAcctSheet).
      const cumRaw = cumulativeQtys?.[line.id]?.[s.stage_key];
      const cumulative_qty = cumRaw == null ? prior_qty : NUM(cumRaw);
      const current_qty = ROUND_2(cumulative_qty - prior_qty);

      const weight = NUM(s.weight);
      const rate_per_unit = ROUND_2(NUM(line.price_per_unit) * weight);
      const current_labor_amount     = ROUND_2(current_qty * NUM(line.labor_per_unit)     * weight);
      const current_tax_basis_amount = ROUND_2(current_qty * NUM(line.tax_basis_per_unit) * weight);
      const exempt = !!line.tax_exempt || !!jobTaxExempt;
      const current_tax_amount = exempt ? 0 : ROUND_2(current_tax_basis_amount * TAX_RATE);
      const current_total = ROUND_2(current_labor_amount + current_tax_basis_amount + current_tax_amount);

      const warning = cumulative_qty > NUM(line.qty) * OVER_BILL_TOL ? 'over_billing' : null;

      cells.push({
        pricing_line_id: line.id,
        line_number: line.line_number,
        label: line.label,
        category: line.category,
        height: line.height,
        style: line.style,
        stage_key: s.stage_key,
        stage_label: s.stage_label,
        stage_display_order: NUM(s.display_order),
        cumulative_qty,
        prior_qty,
        current_qty,
        rate_per_unit,
        current_labor_amount,
        current_tax_basis_amount,
        current_tax_amount,
        current_total,
        warning,
      });
    });
  });

  return cells;
}

// ─── 4. aggregateDraftTotals ────────────────────────────────────────
//
// Rolls draft cells up to the App-level totals (current_amount,
// current_retainage, net_due). Mirrors the Phase A
// trg_compute_invoice_app_totals trigger so client-side preview matches
// what the DB will store after the App is filed.

export function aggregateDraftTotals({ draftLines = [], retainagePct = 0 } = {}) {
  const current_amount = ROUND_2((draftLines || []).reduce((s, l) => s + NUM(l.current_total), 0));
  const pct = NUM(retainagePct);
  const current_retainage = ROUND_2(current_amount * pct / 100);
  const net_due = ROUND_2(current_amount - current_retainage);
  return { current_amount, current_retainage, net_due, retainage_pct: pct };
}

// ─── 5. computePerLineSummary ───────────────────────────────────────
//
// Per-pricing-line rollup for the Acct Sheet header (one row per
// pricing line, summed across all stages). Mirrors what
// v_acct_sheet_summary returns from the DB; engine version includes
// the in-flight draft so the UI reflects pending billing immediately.

export function computePerLineSummary({ pricingLines = [], priorAppLines = [], draftLines = [] } = {}) {
  const priorTotalById = {};
  priorAppLines.forEach((pl) => {
    priorTotalById[pl.job_line_item_id] = NUM(priorTotalById[pl.job_line_item_id]) + NUM(pl.current_total);
  });

  const draftTotalById = {};
  draftLines.forEach((c) => {
    draftTotalById[c.pricing_line_id] = NUM(draftTotalById[c.pricing_line_id]) + NUM(c.current_total);
  });

  return pricingLines.map((line) => {
    const contract_value = NUM(line.extended_total);
    const billed_to_date = ROUND_2(priorTotalById[line.id] || 0);
    const pending_amount = ROUND_2(draftTotalById[line.id] || 0);
    const balance_to_bill = ROUND_2(contract_value - billed_to_date - pending_amount);
    const pct_complete = contract_value > 0
      ? Math.round(((billed_to_date + pending_amount) / contract_value) * 1000) / 10
      : 0;
    return {
      pricing_line_id: line.id,
      line_number: line.line_number,
      label: line.label,
      category: line.category,
      contract_value,
      billed_to_date,
      pending_amount,
      balance_to_bill,
      pct_complete,
    };
  });
}

// ─── 6. buildLedger ─────────────────────────────────────────────────
//
// Reverse-chron App ledger. Includes ALL fields per decision #5 — UI
// decides what to render. is_legacy_import = true iff the App was
// generated by the synthetic backfill from invoice_entries.

export function buildLedger(priorApps = []) {
  return (priorApps || [])
    .slice()
    .sort((a, b) => NUM(b.app_number) - NUM(a.app_number))
    .map((a) => ({
      id: a.id,
      app_number: NUM(a.app_number),
      invoice_number: a.invoice_number,
      invoice_date: a.invoice_date,
      billing_period: a.billing_period,
      current_amount: NUM(a.current_amount),
      current_retainage: NUM(a.current_retainage),
      net_due: NUM(a.net_due),
      billed_to_date: NUM(a.billed_to_date),
      retainage_to_date: NUM(a.retainage_to_date),
      status: a.status,
      filed_at: a.filed_at,
      filed_by: a.filed_by,
      paid_at: a.paid_at,
      paid_amount: NUM(a.paid_amount),
      is_retainage_release: !!a.is_retainage_release,
      is_legacy_import: !!a.source_invoice_entry_id,
      pdf_storage_path: a.pdf_storage_path,
      notes: a.notes,
    }));
}

// ─── 7. validateAcctSheet ───────────────────────────────────────────
//
// Cross-cutting warnings — the UI surfaces these as a banner above the
// Acct Sheet so Virginia notices issues before clicking File App.

export function validateAcctSheet({
  pricingLines = [],
  draftLines = [],
  pmSubmission = null,
  cycleOverrides = {},
  priorApps = [],
  contract = null,
} = {}) {
  const warnings = [];

  // L4 fix: distinguish "no pricing rows" from "no input"
  if (!pricingLines || pricingLines.length === 0) {
    warnings.push('No line items yet — add them on the Scope tab first.');
  } else {
    // No data input at all → empty draft. Surface so the user knows why.
    const hasOverrides = cycleOverrides && Object.keys(cycleOverrides).length > 0;
    if (!pmSubmission && !hasOverrides) {
      warnings.push('No PM bill submission selected and no manual cycle overrides — draft is empty.');
    }
  }

  // Per-cell over-billing warnings (collected from computeDraftCells).
  draftLines
    .filter((c) => c.warning === 'over_billing')
    .forEach((c) => {
      warnings.push(`Over-billing: ${c.label} ${c.stage_label} — cumulative qty exceeds contract qty.`);
    });

  // Pricing lines missing the labor / tax_basis split — these will
  // produce $0 amounts in the draft and would silently underbill.
  pricingLines.forEach((line) => {
    if (NUM(line.price_per_unit) > 0 && (line.labor_per_unit == null || line.tax_basis_per_unit == null)) {
      warnings.push(`Line "${line.label}" is missing labor / tax_basis split — set unit price + height/style on the Scope tab so the trigger can derive it, or enter the split manually.`);
    }
  });

  // 2026-05-05 (H3 fix): synthetic-history advisory.
  // Jobs with legacy-imported invoice_applications have NO per-stage
  // breakdown (the backfill only created header totals). Per-stage prior
  // tracking starts from 0 in the engine, which means PM bill sheet
  // values will be treated as "all new work" — risk of over-billing
  // scope already covered by historical invoices.
  const syntheticTotal = (priorApps || [])
    .filter((a) => a.source_invoice_entry_id && (a.status === 'filed' || a.status === 'paid'))
    .reduce((s, a) => s + NUM(a.current_amount), 0);
  if (syntheticTotal > 0) {
    warnings.push(
      `Heads up — this job has $${Math.round(syntheticTotal).toLocaleString()} billed via legacy imports (pre-cutover invoices, header-only). Per-stage tracking starts at 0 for those amounts; ensure your PM bill sheet reflects only NEW work this cycle, otherwise you may double-bill.`
    );
  }

  // 2026-05-05 (H3 fix): contract-level over-billing guard.
  // Pending + Billed > Contract is almost always a mistake. Surface as a
  // hard warning; AccountingTab gates File on this same condition.
  if (contract && NUM(contract.contract_value) > 0) {
    const total = NUM(contract.billed_to_date) + NUM(contract.pending_amount);
    if (total > NUM(contract.contract_value) * 1.001) {
      const over = ROUND_2(total - NUM(contract.contract_value));
      warnings.push(
        `Pending + Billed To Date exceeds contract value by $${over.toLocaleString()}. Verify the draft before filing.`
      );
    }
  }

  return warnings;
}

// ─── 8. computeAcctSheet (main entry) ───────────────────────────────
//
// Orchestrates 1–7 + computes the contract-level summary card. Returns
// the full structured object the Acct Sheet UI consumes.

export function computeAcctSheet({
  job = {},
  lineItems = [],
  effectiveWeights = [],
  pmSubmission = null,
  priorAppLines = [],
  priorApps = [],
  cycleOverrides = {},
} = {}) {
  const pricingLines = lineItems.map(normalizeLineItem);

  const apportioned = apportionPmSubmission({ pmSubmission, pricingLines });
  const cumulativeQtys = mergeCumulativeQtys(apportioned, cycleOverrides);

  const draftLines = computeDraftCells({
    pricingLines,
    effectiveWeights,
    cumulativeQtys,
    priorAppLines,
    jobTaxExempt: !!job.tax_exempt,
  });

  const draftTotals = aggregateDraftTotals({
    draftLines,
    retainagePct: NUM(job.retainage_pct),
  });

  const perLine = computePerLineSummary({ pricingLines, priorAppLines, draftLines });
  const ledger = buildLedger(priorApps);

  // Contract summary card.
  const contract_value = ROUND_2(pricingLines.reduce((s, l) => s + NUM(l.extended_total), 0));
  const billed_to_date = ROUND_2(
    priorApps
      .filter((a) => a.status === 'filed' || a.status === 'paid')
      .reduce((s, a) => s + NUM(a.current_amount), 0)
  );
  const pending_amount = draftTotals.current_amount;
  const retainage_held = NUM(job.retainage_held);
  const balance_to_bill = ROUND_2(contract_value - billed_to_date - pending_amount);
  const pct_complete = contract_value > 0
    ? Math.round(((billed_to_date + pending_amount) / contract_value) * 1000) / 10
    : 0;
  const contract = {
    contract_value,
    billed_to_date,
    pending_amount,
    retainage_held,
    balance_to_bill,
    pct_complete,
  };

  // 2026-05-05 (H3): pass priorApps + contract so validateAcctSheet can
  // emit the synthetic-history advisory and the over-billing guard.
  const warnings = validateAcctSheet({
    pricingLines, draftLines, pmSubmission, cycleOverrides, priorApps, contract,
  });

  return {
    draft: { lines: draftLines, totals: draftTotals },
    contract,
    perLine,
    ledger,
    warnings,
  };
}
