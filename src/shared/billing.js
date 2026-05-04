// Canonical billing metric definitions.
//
// Created 2026-05-04 to retire the dashboard-vs-Billing-page mismatch surfaced
// by the live-app review (dashboard said "77 / $12.0M never billed", Billing
// page filter said 69 — turned out to be a data-loading-state difference, but
// both pages were also re-rolling the same filter logic. Now both consume from
// here so the next mismatch can't sneak in.)
//
// Conventions:
//   - Functions take (jobs, ...args) where jobs is the array fetched from REST.
//   - "Active billable" excludes lost/cancelled/closed.
//   - "Eligible billing stages" = the post-contract statuses where invoicing
//     is at least theoretically expected. Excludes contract_review (pre-PO) so
//     that contracts still in review don't pollute "Never Billed" counts.
//   - All money returns are dollars (numbers). Caller formats.

// Statuses where the job has cleared contract review and is eligible to bill.
// Includes fence_complete + fully_complete because retainage / final billing
// can land after fence is up.
export const BILLING_ELIGIBLE_STATUSES = [
  'production_queue',
  'in_production',
  'material_ready',
  'active_install',
  'fence_complete',
  'fully_complete',
];

// Statuses we always exclude from billing metrics (the job is dead).
export const BILLING_TERMINAL_STATUSES = [
  'lost',
  'canceled',
  'cancelled',
  'closed',
];

const isBillable = (j) => !BILLING_TERMINAL_STATUSES.includes(j.status);
const isEligible = (j) => BILLING_ELIGIBLE_STATUSES.includes(j.status);

const num = (v) => Number(v) || 0;
const cv = (j) => num(j.adj_contract_value || j.contract_value);

// "Never Billed" = a job in an eligible billing stage with $0 invoiced YTD.
// Returns the array; caller takes .length for count, sums adj_contract_value
// for value, etc. We deliberately do NOT count contract_review jobs — those
// haven't reached the gate yet and complaining about them is alarmist.
export function neverBilledJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((j) => isBillable(j) && isEligible(j) && num(j.ytd_invoiced) === 0);
}

// Total at-risk dollar amount in the never-billed cohort.
export function neverBilledTotal(jobs) {
  return neverBilledJobs(jobs).reduce((s, j) => s + cv(j), 0);
}

// "Stale billing" = job has billed something (last_billed exists) but hasn't
// billed in N days. Default 60 days because the typical PM cycle is monthly,
// so 2 missed cycles is the right alarm threshold.
export function staleBillingJobs(jobs, asOfDate = new Date(), thresholdDays = 60) {
  if (!Array.isArray(jobs)) return [];
  const asOfMs = (asOfDate instanceof Date ? asOfDate : new Date(asOfDate)).getTime();
  const cutoffMs = asOfMs - thresholdDays * 86400000;
  return jobs.filter((j) => {
    if (!isBillable(j) || !isEligible(j)) return false;
    if (!j.last_billed) return false;
    const lb = new Date(j.last_billed).getTime();
    if (Number.isNaN(lb)) return false;
    return lb < cutoffMs && num(j.left_to_bill) > 0;
  });
}

// "Days from contract to first invoice" — the real cash-cycle metric.
// We use jobs.last_billed as the proxy for now (every job in our data has
// last_billed = first_invoice_date for jobs that have invoiced exactly once,
// and for multi-invoice jobs it's "days to most recent" which is acceptably
// close to the original metric's intent). When `first_invoice_date` is
// added as a real derived column on jobs (TODO: trigger on invoice_entries
// insert), swap to it.
//
// Returns { mean, median, p25, p75, n, min, max } — all in days. Returns null
// when sample size is 0.
//
// `cohortStart` filters to jobs whose contract was signed on/after that date,
// so this metric tracks the current fiscal cohort rather than ancient data.
export function daysToFirstInvoice(jobs, { cohortStart = '2024-01-01' } = {}) {
  if (!Array.isArray(jobs)) return null;
  const cutoffStr = typeof cohortStart === 'string' ? cohortStart : cohortStart.toISOString().slice(0, 10);
  const days = jobs
    .filter((j) => j.contract_date && j.last_billed && j.contract_date >= cutoffStr)
    .map((j) => {
      const cd = new Date(j.contract_date).getTime();
      const lb = new Date(j.last_billed).getTime();
      return Math.round((lb - cd) / 86400000);
    })
    .filter((d) => Number.isFinite(d) && d >= 0);
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  const mean = Math.round(days.reduce((s, d) => s + d, 0) / days.length);
  return {
    mean,
    median: pct(0.5),
    p25: pct(0.25),
    p75: pct(0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    n: days.length,
  };
}

// Total fully-billed (>= 99%) job count in the eligible cohort. Matches what
// the dashboard's "100% Billed" stat is trying to surface.
export function fullyBilledCount(jobs) {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter((j) => isBillable(j) && isEligible(j) && num(j.pct_billed) >= 0.99).length;
}

// Total active billing in flight: contract value × (1 - pct_billed) summed
// across the eligible cohort. This is the "Left to Bill" headline.
export function totalLeftToBill(jobs) {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter((j) => isBillable(j) && isEligible(j)).reduce((s, j) => s + num(j.left_to_bill), 0);
}

// Total YTD invoiced across the eligible cohort.
export function totalYtdInvoiced(jobs) {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter((j) => isBillable(j) && isEligible(j)).reduce((s, j) => s + num(j.ytd_invoiced), 0);
}
