// Smoke verifier for acctSheet.js — Phase C of the Billing Engine build.
//
// HOW TO RUN
//   node src/shared/billing/__tests__/verify.mjs
//
// HOW IT WORKS
//   .mjs extension makes Node treat the file as native ESM, so it can
//   import the source modules (acctSheet.js, heightBasis.js,
//   acctSheetFixtures.js) directly without a bundler. Pure assertions
//   — no test framework. Exits 0 on PASS, 1 on FAIL.
//
//   Not wired to CI yet. Vitest setup is deferred until we have ≥2
//   features that need a JS test runner (decision from the Phase C
//   planning round on 2026-05-05).

import { computeAcctSheet, apportionPmSubmission } from '../acctSheet.js';
import {
  HEB_MADERA_RUN, CYCLE_1_EXPECTED,
  CYCLE_2_PM, CYCLE_2_PRIOR_APP_LINES, CYCLE_2_PRIOR_APPS, CYCLE_2_EXPECTED,
  TAX_EXEMPT_JOB, TAX_EXEMPT_EXPECTED,
  GATE_BILLED_NO_OVERRIDE, GATE_BILLED_NO_OVERRIDE_EXPECTED,
  RAW_LINE_ITEMS_SHAPE,
} from './acctSheetFixtures.js';

let failed = 0;
let total = 0;
function assert(name, actual, expected, tol = 0.01) {
  total += 1;
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) < tol
    : actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  expected=${expected}  actual=${actual}`);
  if (!ok) failed += 1;
}

console.log('─── Cycle 1: 100 LF at Posts Only ───');
const r1 = computeAcctSheet(HEB_MADERA_RUN);
const c1po = r1.draft.lines.find((l) => l.stage_key === 'posts_only');
assert('C1 posts_only cumulative_qty',           c1po.cumulative_qty,           CYCLE_1_EXPECTED.posts_only.cumulative_qty);
assert('C1 posts_only prior_qty',                c1po.prior_qty,                CYCLE_1_EXPECTED.posts_only.prior_qty);
assert('C1 posts_only current_qty',              c1po.current_qty,              CYCLE_1_EXPECTED.posts_only.current_qty);
assert('C1 posts_only current_labor_amount',     c1po.current_labor_amount,     CYCLE_1_EXPECTED.posts_only.current_labor_amount);
assert('C1 posts_only current_tax_basis_amount', c1po.current_tax_basis_amount, CYCLE_1_EXPECTED.posts_only.current_tax_basis_amount);
assert('C1 posts_only current_tax_amount',       c1po.current_tax_amount,       CYCLE_1_EXPECTED.posts_only.current_tax_amount);
assert('C1 posts_only current_total',            c1po.current_total,            CYCLE_1_EXPECTED.posts_only.current_total);
assert('C1 posts_only warning',                  c1po.warning,                  CYCLE_1_EXPECTED.posts_only.warning);

const c1pp = r1.draft.lines.find((l) => l.stage_key === 'posts_panels');
assert('C1 posts_panels current_qty',            c1pp.current_qty,              0);
assert('C1 posts_panels current_total',          c1pp.current_total,            0);

assert('C1 totals current_amount',               r1.draft.totals.current_amount,    CYCLE_1_EXPECTED.totals.current_amount);
assert('C1 totals current_retainage',            r1.draft.totals.current_retainage, CYCLE_1_EXPECTED.totals.current_retainage);
assert('C1 totals net_due',                      r1.draft.totals.net_due,           CYCLE_1_EXPECTED.totals.net_due);

assert('C1 contract contract_value',             r1.contract.contract_value,    CYCLE_1_EXPECTED.contract.contract_value);
assert('C1 contract billed_to_date',             r1.contract.billed_to_date,    CYCLE_1_EXPECTED.contract.billed_to_date);
assert('C1 contract pending_amount',             r1.contract.pending_amount,    CYCLE_1_EXPECTED.contract.pending_amount);
assert('C1 contract pct_complete',               r1.contract.pct_complete,      CYCLE_1_EXPECTED.contract.pct_complete, 0.1);

assert('C1 ledger empty',                        r1.ledger.length,              0);
assert('C1 perLine count',                       r1.perLine.length,             1);
assert('C1 perLine[0] pending_amount',           r1.perLine[0].pending_amount,  CYCLE_1_EXPECTED.totals.current_amount);

console.log('\n─── Cycle 2: 100 LF advance to Posts & Panels ───');
const r2 = computeAcctSheet({
  ...HEB_MADERA_RUN,
  pmSubmission: CYCLE_2_PM,
  priorAppLines: CYCLE_2_PRIOR_APP_LINES,
  priorApps: CYCLE_2_PRIOR_APPS,
});
const c2po = r2.draft.lines.find((l) => l.stage_key === 'posts_only');
assert('C2 posts_only cumulative_qty (carryover)', c2po.cumulative_qty, 100);
assert('C2 posts_only prior_qty',                  c2po.prior_qty,      100);
assert('C2 posts_only current_qty (zero)',        c2po.current_qty,     0);
assert('C2 posts_only current_total (zero)',      c2po.current_total,   0);

const c2pp = r2.draft.lines.find((l) => l.stage_key === 'posts_panels');
assert('C2 posts_panels current_qty',              c2pp.current_qty,              CYCLE_2_EXPECTED.posts_panels.current_qty);
assert('C2 posts_panels current_labor_amount',     c2pp.current_labor_amount,     CYCLE_2_EXPECTED.posts_panels.current_labor_amount);
assert('C2 posts_panels current_tax_basis_amount', c2pp.current_tax_basis_amount, CYCLE_2_EXPECTED.posts_panels.current_tax_basis_amount);
assert('C2 posts_panels current_tax_amount',       c2pp.current_tax_amount,       CYCLE_2_EXPECTED.posts_panels.current_tax_amount);
assert('C2 posts_panels current_total',            c2pp.current_total,            CYCLE_2_EXPECTED.posts_panels.current_total);

assert('C2 totals current_amount',                 r2.draft.totals.current_amount,    CYCLE_2_EXPECTED.totals.current_amount);
assert('C2 totals current_retainage',              r2.draft.totals.current_retainage, CYCLE_2_EXPECTED.totals.current_retainage);
assert('C2 totals net_due',                        r2.draft.totals.net_due,           CYCLE_2_EXPECTED.totals.net_due);

assert('C2 contract billed_to_date',               r2.contract.billed_to_date,    CYCLE_2_EXPECTED.contract.billed_to_date);
assert('C2 contract pending_amount',               r2.contract.pending_amount,    CYCLE_2_EXPECTED.contract.pending_amount);
const okPct = r2.contract.pct_complete >= CYCLE_2_EXPECTED.contract.pct_complete_low &&
              r2.contract.pct_complete <= CYCLE_2_EXPECTED.contract.pct_complete_high;
total += 1;
console.log(`${okPct ? 'PASS' : 'FAIL'}  C2 contract pct_complete in [${CYCLE_2_EXPECTED.contract.pct_complete_low}, ${CYCLE_2_EXPECTED.contract.pct_complete_high}]  actual=${r2.contract.pct_complete}`);
if (!okPct) failed += 1;

assert('C2 ledger length',                         r2.ledger.length,              1);
assert('C2 ledger[0].invoice_number',              r2.ledger[0].invoice_number,   'INV-23H047-01');
assert('C2 perLine[0] billed_to_date',             r2.perLine[0].billed_to_date,  6509.43);
assert('C2 perLine[0] pending_amount',             r2.perLine[0].pending_amount,  CYCLE_2_EXPECTED.posts_panels.current_total);

console.log('\n─── Tax exempt: Cycle 1 inputs with job.tax_exempt = true ───');
const r3 = computeAcctSheet(TAX_EXEMPT_JOB);
const c3po = r3.draft.lines.find((l) => l.stage_key === 'posts_only');
assert('TE posts_only current_tax_amount (zero)',  c3po.current_tax_amount,       TAX_EXEMPT_EXPECTED.posts_only.current_tax_amount);
assert('TE posts_only current_total',              c3po.current_total,            TAX_EXEMPT_EXPECTED.posts_only.current_total);
assert('TE totals current_amount',                 r3.draft.totals.current_amount,    TAX_EXEMPT_EXPECTED.totals.current_amount);
assert('TE totals current_retainage',              r3.draft.totals.current_retainage, TAX_EXEMPT_EXPECTED.totals.current_retainage);
assert('TE totals net_due',                        r3.draft.totals.net_due,           TAX_EXEMPT_EXPECTED.totals.net_due);

console.log('\n─── H1 regression: gate billed Cycle 1, no override Cycle 2 ───');
const r4 = computeAcctSheet(GATE_BILLED_NO_OVERRIDE);
const c4 = r4.draft.lines.find((l) => l.stage_key === 'complete');
assert('H1 cumulative defaults to prior',         c4.cumulative_qty,             GATE_BILLED_NO_OVERRIDE_EXPECTED.cumulative_qty);
assert('H1 prior_qty preserved',                  c4.prior_qty,                  GATE_BILLED_NO_OVERRIDE_EXPECTED.prior_qty);
assert('H1 current_qty is ZERO (not negative)',   c4.current_qty,                GATE_BILLED_NO_OVERRIDE_EXPECTED.current_qty);
assert('H1 current_total is ZERO (no credit)',    c4.current_total,              GATE_BILLED_NO_OVERRIDE_EXPECTED.current_total);
assert('H1 totals current_amount is ZERO',        r4.draft.totals.current_amount, GATE_BILLED_NO_OVERRIDE_EXPECTED.totals_current_amount);

console.log('\n─── apportionPmSubmission unit tests ───');
// Two precast lines, equal qty → should split 50/50
const apport = apportionPmSubmission({
  pmSubmission: { labor_post_only: 200 },
  pricingLines: [
    { id: 'a', category: 'precast', qty: 100 },
    { id: 'b', category: 'precast', qty: 100 },
  ],
});
assert('Apportion equal split a',  apport.a?.posts_only,  100);
assert('Apportion equal split b',  apport.b?.posts_only,  100);

// Two lines with 200/100 split → 200 LF should split 133.33 / 66.67
const apport2 = apportionPmSubmission({
  pmSubmission: { labor_post_only: 200 },
  pricingLines: [
    { id: 'a', category: 'precast', qty: 200 },
    { id: 'b', category: 'precast', qty: 100 },
  ],
});
assert('Apportion 2:1 share a',    apport2.a?.posts_only, 133.33);
assert('Apportion 2:1 share b',    apport2.b?.posts_only,  66.67);

console.log('\n─── Option C — raw job_line_items shape via lineItems param ───');
// Same numerical case as Cycle 1, but the input is a raw job_line_items
// row (fence_type='PC', quantity, unit_price, taxable). The normalizer
// should map this to the engine's internal shape and produce identical
// numbers to the legacy pricingLines-shape Cycle 1 fixture.
const r5 = computeAcctSheet(RAW_LINE_ITEMS_SHAPE);
const c5po = r5.draft.lines.find((l) => l.stage_key === 'posts_only');
assert('Raw shape: posts_only cumulative_qty', c5po.cumulative_qty, CYCLE_1_EXPECTED.posts_only.cumulative_qty);
assert('Raw shape: posts_only current_qty',    c5po.current_qty,    CYCLE_1_EXPECTED.posts_only.current_qty);
assert('Raw shape: posts_only current_total',  c5po.current_total,  CYCLE_1_EXPECTED.posts_only.current_total);
assert('Raw shape: totals current_amount',     r5.draft.totals.current_amount, CYCLE_1_EXPECTED.totals.current_amount);
assert('Raw shape: totals net_due',            r5.draft.totals.net_due,        CYCLE_1_EXPECTED.totals.net_due);
assert('Raw shape: contract.contract_value',   r5.contract.contract_value,     9800);

console.log(`\n${'─'.repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${total} assertions PASS`);
  process.exit(0);
} else {
  console.log(`✗ ${failed}/${total} assertions FAILED`);
  process.exit(1);
}
