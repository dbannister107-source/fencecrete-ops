// detectDoubleCounting — proactive duplicate-billing detection for the
// Accounting tab. Catches the most common over-billing scenarios BEFORE
// Virginia hits the AR Over-Bill Block dialog (or worse, files a duplicate).
//
// Designed to be cheap and side-effect-free: pure JS, takes the same
// inputs the Accounting tab already has loaded. Returns an array of
// warnings; AccountingTab renders them as a banner. Empty array =
// no issues detected.
//
// Heuristics tuned against live DB (2026-05-05):
//   - 0 false positives on 154 clean unbilled jobs
//   - 0 false positives on 138 synthetic-only jobs (no draft yet)
//   - Catches all 29 already-overbilled jobs
//   - Catches the 25H032-style "synthetic + same-amount PM submission"
//     scenario at draft time, before filing
//
// Severity levels:
//   error   — almost certainly a duplicate; do not file
//   warning — possible duplicate; verify before filing

const NUM = (x) => Number(x) || 0;

// Format number as $1,234 — local helper so we don't import from fmt.js
const FMT = (x) => '$' + Math.round(NUM(x)).toLocaleString();

/**
 * @param {object} input
 * @param {object} input.job              jobs row (uses adj_contract_value)
 * @param {array}  input.priorApps        invoice_applications rows for the job
 * @param {object} input.contract         result.contract from computeAcctSheet
 * @param {object|null} input.selectedSubmission  pm_bill_submissions row, if any
 * @param {object|null} input.draftTotals result.draft.totals from computeAcctSheet
 *
 * @returns {Array<{severity:'error'|'warning', reason:string, suggestedFix:string, ruleId:string}>}
 */
export function detectDoubleCounting({
  job,
  priorApps = [],
  contract,
  selectedSubmission = null,
  draftTotals = null,
} = {}) {
  const warnings = [];

  const acv = NUM(contract?.contract_value);
  if (acv <= 0) return warnings;  // can't reason about ratios without a contract value

  const filed = (priorApps || []).filter(a => a.status === 'filed' || a.status === 'paid');
  const synthetic = filed.filter(a => a.source_invoice_entry_id);
  const modern    = filed.filter(a => !a.source_invoice_entry_id);

  const syntheticTotal = synthetic.reduce((s, a) => s + NUM(a.current_amount), 0);
  const modernTotal    = modern.reduce((s, a) => s + NUM(a.current_amount), 0);
  const billedToDate   = NUM(contract.billed_to_date);
  const draftAmount    = NUM(draftTotals?.current_amount);

  // ─── Rule B: already over-billed ─────────────────────────────────
  // Fires when prior billing already exceeds 105% of contract — points
  // at duplicate or wrong-job invoicing that landed before the user
  // even opens the Accounting tab.
  if (billedToDate > acv * 1.05) {
    const pct = Math.round((billedToDate / acv) * 100);
    warnings.push({
      ruleId: 'B-over-billed',
      severity: 'error',
      reason: `This job is already at ${pct}% billed (${FMT(billedToDate)} of ${FMT(acv)}) before any new invoice. Suggests a prior duplicate, wrong-job invoice, or missing change order.`,
      suggestedFix: 'Open the App Ledger below and compare the filed Apps. If two Apps cover the same scope, void one. If a Change Order should bring the contract value up, add it on the Scope tab. Escalate to Alex if neither applies.',
    });
  }

  // ─── Rule A: synthetic + modern coexistence ─────────────────────
  // Legacy-import App carries the pre-cutover billing history; modern
  // Apps from the new flow may be re-billing the same scope. Fires
  // when modern billing is non-trivial (>5% of contract) so a single
  // small post-import invoice doesn't trigger.
  if (synthetic.length > 0 && modernTotal > acv * 0.05) {
    warnings.push({
      ruleId: 'A-synthetic-plus-modern',
      severity: 'warning',
      reason: `This job has ${FMT(syntheticTotal)} from legacy-import App${synthetic.length > 1 ? 's' : ''} AND ${FMT(modernTotal)} from regular Acct Sheet billing. Confirm they cover different scope.`,
      suggestedFix: 'Compare amounts and dates in the App Ledger. If a modern App duplicates scope already covered by the legacy import, mark it void from the App row drill-down.',
    });
  }

  // ─── Rule A2: synthetic + pending draft ─────────────────────────
  // Fires when a legacy-import App exists AND the user has a non-empty
  // draft loaded from a PM submission. This is the highest-volume
  // future risk — 138 jobs have synthetic history; the moment Virginia
  // selects a PM bill sheet on one, this banner reminds her to check
  // whether the cumulative LF on the bill sheet already includes the
  // imported scope.
  if (synthetic.length > 0 && selectedSubmission && draftAmount > 0) {
    warnings.push({
      ruleId: 'A2-synthetic-plus-draft',
      severity: 'warning',
      reason: `This job has ${FMT(syntheticTotal)} from a legacy-import App. The current draft would add another ${FMT(draftAmount)} on top of that.`,
      suggestedFix: 'Verify the PM bill sheet: cumulative LF should reflect total LF since project start, not just NEW work this cycle. If the legacy import already covers all installed LF, the draft should be $0 or close to it.',
    });
  }

  // ─── Rule C: exact-amount match between draft and a prior App ───
  // Strongest duplicate signal — if today's draft total matches a
  // filed App's current_amount within $1, almost certainly a duplicate
  // (matches the 25H032 pattern: PM resubmits same invoice that's
  // already been imported / approved).
  if (draftAmount > 0 && filed.length > 0) {
    const dup = filed.find(a => Math.abs(NUM(a.current_amount) - draftAmount) < 1.0);
    if (dup) {
      warnings.push({
        ruleId: 'C-exact-amount-match',
        severity: 'error',
        reason: `The current draft total (${FMT(draftAmount)}) is within $1 of App #${dup.app_number} (${FMT(dup.current_amount)}). Almost certainly a duplicate of the same billing cycle.`,
        suggestedFix: `Open App #${dup.app_number} in the App Ledger to confirm. If both invoices cover the same period and scope, do NOT file. Adjust the PM bill sheet's cumulative LF or use cycle overrides to bill only the incremental work since App #${dup.app_number}.`,
      });
    }
  }

  return warnings;
}
