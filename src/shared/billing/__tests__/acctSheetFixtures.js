// Test fixtures for acctSheet.js — HEB Madera Run sample.
//
// Numbers verified cell-for-cell against the Excel sample file
// (!ProjectName_Number_Customer Name Job Set up Sample.xlsx) on 2026-05-05.
// Picked the 6' pc block for the primary fixture because it exercises a
// non-trivial tax basis ($26/LF) and a clean LF count (100) that makes
// the expected outputs easy to verify by hand.
//
// Three scenarios:
//   1. Cycle 1 — 100 LF reach Posts Only stage (the typical first bill)
//   2. Cycle 2 — same 100 LF advance to Posts & Panels stage
//   3. Tax-exempt — same Cycle 1 inputs but job.tax_exempt = true
//
// The verifier (verify.mjs) imports these and asserts the engine
// outputs match cell-for-cell.

// ─── Primary fixture: HEB Madera Run, 6' pc, 100 LF ──────────────────
export const HEB_MADERA_RUN = {
  job: {
    id: 'fix-job-1',
    job_number: '23H047',
    retainage_pct: 10,
    tax_exempt: false,
    retainage_held: 0,
  },
  pricingLines: [
    {
      id: 'pl-6pc',
      line_number: 1,
      category: 'precast',
      label: "6' pc",
      height: '6',
      style: null,
      qty: 100,
      unit: 'LF',
      price_per_unit: 98,
      labor_per_unit: 72,
      tax_basis_per_unit: 26,
      tax_exempt: false,
      extended_total: 9800,
    },
  ],
  effectiveWeights: [
    { category: 'precast', stage_key: 'posts_only',   stage_label: 'Posts Only',     weight: 0.65, display_order: 1 },
    { category: 'precast', stage_key: 'posts_panels', stage_label: 'Posts & Panels', weight: 0.20, display_order: 2 },
    { category: 'precast', stage_key: 'complete',     stage_label: 'Complete',       weight: 0.15, display_order: 3 },
  ],
  pmSubmission: {
    id: 'sub-1',
    labor_post_only:   100,
    labor_post_panels: 0,
    labor_complete:    0,
  },
  priorAppLines: [],
  priorApps: [],
  cycleOverrides: {},
};

// Cycle 1 — 100 LF at Posts Only.
//   labor_amount     = 100 × 72 × 0.65 = 4680.00
//   tax_basis_amount = 100 × 26 × 0.65 = 1690.00
//   tax_amount       = 1690.00 × 0.0825 = 139.425 → 139.43
//   total            = 4680.00 + 1690.00 + 139.43 = 6509.43
//   retainage @ 10%  = 650.943 → 650.94
//   net_due          = 6509.43 − 650.94 = 5858.49
export const CYCLE_1_EXPECTED = {
  posts_only: {
    cumulative_qty: 100,
    prior_qty: 0,
    current_qty: 100,
    current_labor_amount:     4680.00,
    current_tax_basis_amount: 1690.00,
    current_tax_amount:        139.43,
    current_total:            6509.43,
    warning: null,
  },
  posts_panels: { current_qty: 0, current_total: 0 },
  complete:     { current_qty: 0, current_total: 0 },
  totals: {
    current_amount:    6509.43,
    current_retainage:  650.94,
    net_due:           5858.49,
    retainage_pct:        10,
  },
  contract: {
    contract_value: 9800,
    billed_to_date: 0,
    pending_amount: 6509.43,
    pct_complete:   66.4,   // 6509.43 / 9800 × 100 = 66.422... → 66.4
  },
};

// ─── Cycle 2 — Cycle 1 has been filed; PM reports 100 LF Posts & Panels ─
//
// Cumulative inputs: posts_only=100 (unchanged from Cycle 1), posts_panels=100 (new).
// Engine should produce:
//   Posts Only      cumulative=100, prior=100, current=0     → all amounts 0
//   Posts & Panels  cumulative=100, prior=0,   current=100   → bill 20% of price
//   Complete        cumulative=0                              → all 0

export const CYCLE_2_PM = {
  id: 'sub-2',
  labor_post_only:   100,
  labor_post_panels: 100,
  labor_complete:    0,
};

// Prior app lines from Cycle 1 (filed).
export const CYCLE_2_PRIOR_APP_LINES = [
  {
    job_pricing_line_id: 'pl-6pc',
    stage_key: 'posts_only',
    cumulative_qty: 100,
    prior_qty: 0,
    current_qty: 100,
    current_total: 6509.43,
  },
];

export const CYCLE_2_PRIOR_APPS = [
  {
    id: 'app-1',
    app_number: 1,
    invoice_number: 'INV-23H047-01',
    status: 'filed',
    current_amount: 6509.43,
    current_retainage: 650.94,
    net_due: 5858.49,
    billed_to_date: 0,
    retainage_to_date: 650.94,
  },
];

// Cycle 2 expected:
//   posts_panels labor     = 100 × 72 × 0.20 = 1440.00
//   posts_panels tax_basis = 100 × 26 × 0.20 =  520.00
//   posts_panels tax       =  520.00 × 0.0825 = 42.90
//   posts_panels total     = 1440 + 520 + 42.90 = 2002.90
export const CYCLE_2_EXPECTED = {
  posts_only:   { current_qty: 0, current_total: 0 },
  posts_panels: {
    cumulative_qty: 100,
    prior_qty: 0,
    current_qty: 100,
    current_labor_amount:     1440.00,
    current_tax_basis_amount:  520.00,
    current_tax_amount:         42.90,
    current_total:            2002.90,
  },
  complete:     { current_qty: 0, current_total: 0 },
  totals: {
    current_amount:   2002.90,
    current_retainage: 200.29,
    net_due:          1802.61,
  },
  contract: {
    contract_value: 9800,
    billed_to_date: 6509.43,
    pending_amount: 2002.90,
    // 6509.43 + 2002.90 = 8512.33; 8512.33 / 9800 = 86.85 → 86.9 (or 86.8 depending on rounding mode)
    pct_complete_low:  86.8,
    pct_complete_high: 86.9,
  },
};

// ─── Tax-exempt scenario — same Cycle 1 inputs, job.tax_exempt = true ───
export const TAX_EXEMPT_JOB = {
  ...HEB_MADERA_RUN,
  job: { ...HEB_MADERA_RUN.job, tax_exempt: true },
};

// Tax-exempt expected: tax_amount = 0, total = labor + tax_basis = 6370.00
export const TAX_EXEMPT_EXPECTED = {
  posts_only: {
    current_tax_amount: 0,
    current_total:      6370.00, // 4680.00 + 1690.00 + 0
  },
  totals: {
    current_amount:   6370.00,
    current_retainage: 637.00,
    net_due:          5733.00,
  },
};
