# Contract Value Drift Audit — 2026-05-07

**For:** Amiee
**From:** David / OPS Engineering
**Status:** 56 active jobs (1 urgent + 55 net-drift) — review when convenient

## TL;DR

We discovered that `jobs.net_contract_value` and `SUM(job_line_items.line_value)` disagree on 104 projects across the database (55 active + 49 closed). Closed jobs are inert and not in scope. The active 55 plus one urgent permit case need your eyes on the line items vs. stored contract value.

The CSV `contract_value_drift_audit_2026-05-07.csv` lists all 56 with priority, PM, market, stored vs. line-items sum, and a per-row note where useful.

## What changed and why this audit exists

On 2026-05-07 the `sync_job_aggregates_from_line_items` trigger was fixed to also propagate dollar fields (`net_contract_value`, `pp_bond_amount`, `maint_bond_amount`, `permit_amount`) from `job_line_items` — closing the gap exposed by Woodhavyn (26H033) where line items totaled $33,810 but stored net was $0.

A safety guard was added so the trigger doesn't zero out stored values for jobs whose line items have `line_value=0` (9 legacy jobs, e.g. Cane Island, Medina Development).

This audit surfaces the next layer: jobs where both stored and line-items have non-zero values but disagree by more than $1.

## Priority levels

| Level | Threshold | Action |
|---|---|---|
| 🚨 URGENT | Different category — Sofi Lakes only | Verify line item now before any edit |
| 🔴 HIGH | Delta ≥ $100,000 | Reconcile this week |
| 🟠 MED | Delta $25,000–$100,000 | Reconcile when you next touch the project |
| 🟡 LOW | Delta $1–$25,000 | Address opportunistically |

## 🚨 URGENT — Sofi Lakes 25H088

The reason this is in the CSV at all: there's a **Permit line item with `line_value = $195,550`** on this project. That's suspiciously large — most permits are $1k–$5k. If you edit any line item on Sofi Lakes (even unrelated), the trigger will copy that $195,550 into `jobs.permit_amount` and bump `adj_contract_value` by ~$195k.

**Action:** Open Sofi Lakes → Money → Scope tab → review line item #2 (or whichever is the Permit row). It's likely either (a) a Lump Sum miscategorized as Permit, or (b) the entire contract scope entered into a Permit row by mistake. Recategorize or split before doing anything else on this job.

## Pattern A — Stored > Line items (most common)

Examples: South Austin Commerce ($175k stored / $64k line items), Monet Estates ($478k / $382k), Cedar Tech Leander ($299k / $208k).

Likely cause: the contract value was set in NewProjectForm (or pre-Pricing-Book imports), but line items were entered partially. Stored value is probably the source of truth; line items need to be enriched.

Recommended approach: open the project's Scope tab and add the missing line items so the sum matches the stored contract.

## Pattern B — Line items > Stored

Examples: Tam III Boilerplate ($53k / $155k), Telge Ranch West LS ($42k / $122k).

Likely cause: line items were enriched after the contract was first booked at a lower value, or COs were filed via line items but not via change_orders. Line items are likely closer to the true scope; stored value needs updating.

Recommended approach: open the project, verify the line items are correct, then update `net_contract_value` either via the EditPanel (if there's a form field) or by deleting and re-saving a line item to retrigger the sync.

## Heavily-billed jobs in the list

Some jobs have YTD billings that approach or exceed the stored contract value, so they may already be over-billed (a known data hygiene issue from CLAUDE.md):

| Job | Stored | YTD | % billed |
|---|---|---|---|
| 24H043 BraeBurn Country Club | $1,774,215 | $1,414,913 | 80% |
| 25H013 Monet Estates | $478,267 | $429,396 | 90% |
| 25H071 Dunham Pointe Sec 16 | $220,422 | $202,332 | 92% |
| 25H068 Wildrye LS #1 | $54,820 | $53,017 | 97% |
| 25H042 Wildrye Phase 1 | $832,033 | $832,068 | 100% |
| 25H040 Edinburgh Estates | $122,650 | $112,994 | 92% |
| 25H076 Grand Prairie Ph 8 | $155,940 | $144,437 | 93% |
| 25A011 CR 158 Pump Station | $163,625 | $157,045 | 96% |

These reconcile naturally — once the contract value is correct, the % billed reflects reality.

## What's intentionally NOT in scope

- **49 closed/canceled/fully_complete jobs with the same drift pattern.** They're inert; no action required unless you want a clean historical baseline.
- **9 zero-sum legacy jobs** (Cane Island, FBC MUD 250, etc.) where line_value=0 across all line items. Protected by the trigger guard; will not get clobbered. Stored value is preserved as the source of truth on these.

## Next step (engineering)

A small "Drift Watch" banner is being added to the EditPanel that will surface this disagreement automatically when you open an affected project — so the issue is visible at the moment you'd act on it, not buried in this report. Threshold: $50.

## Questions for you

1. For Pattern A jobs — should I auto-zero the stored value and let line items take over, or leave it as a manual review per project?
2. For Pattern B jobs — same question, opposite direction. Trust line items or trust stored?
3. The 49 closed jobs — leave alone, or should we backfill for clean historical data?

No urgency on those answers. Tackle the URGENT one first; the rest can be a slow burn.
