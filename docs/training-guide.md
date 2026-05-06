# Money & Billing Workflow — Training Guide (May 2026)

**Audience:** PMs (Doug, Ray, Manuel, Rafael Jr.), Amiee (Contracts), Virginia (AR/Billing)

**Format:** Each section is a stand-alone training script. Walk through the steps with the person doing the work; have them click; verify the result.

---

## How to use this document

1. Pick the role (PM, Amiee, Virginia)
2. Walk through each step IN ORDER on a real job (use a small test job if available)
3. The trainee clicks; you watch
4. At each ✅ checkpoint, verify the system shows what the script says it should
5. At each ⚠ red-flag, walk through the "if this happens" branch

Estimated time per role: **15–25 min** for first walkthrough.

---

# PART 1 — PMs (Bill Sheet Submission)

> **Bottom line:** No workflow change. Same form, same fields, same monthly cadence. This section is to confirm habits are correct.

## When to submit

- Once a month per active job
- Submit on or before AR's monthly cutoff (Virginia announces)
- Even if no work happened this month → submit "No Bill Required"

## Where to go

OPS app → **PM Bill Sheet** (left nav under your role). Mobile-friendly — works on your phone.

## Step-by-step

### Step 1 — Pick the job

Click your job from the assigned list.

✅ **Verify:** the job header shows your name as PM.

⚠ **If the job isn't on your list:** ping Carlos or Amiee — assignment may be wrong.

### Step 2 — Fill in cumulative LF by stage

For each stage that has activity this month, enter the **cumulative LF since project start** (NOT just this month's increment).

**Precast jobs:**
- Posts Only — LF where posts are set but panels not yet
- Posts & Panels — LF where panels are also installed
- Complete — LF fully installed including caps/finish

**Stick-built jobs:**
- Foundation — LF poured
- Columns — LF columns set
- Panels — LF panels installed
- Cleanup — LF fully complete

✅ **Verify:** numbers should be **monotonically non-decreasing** from prior months. If a stage drops below last month's number, you typed wrong.

### Step 3 — Enter the invoiced amount

This is the **dollar value of work this cycle** (not cumulative, not contract total — just what should be billed for this submission).

⚠ **If you don't know the invoiced amount:** leave it blank or check with Virginia. Don't guess by typing your cumulative total — that's the #1 cause of double-billing alerts on Virginia's side.

### Step 4 — Or click "No Bill Required"

If the job had no billable activity this month (rain delays, awaiting permit, design hold, etc.):
- Click **No Bill Required**
- Pick a reason from the dropdown
- Add notes if needed

### Step 5 — Submit

Click Submit. You'll see your submission appear in your history immediately.

✅ **Verify:** the submission shows up in your "Submitted this month" list.

## Common PM mistakes

| Mistake | What happens | Fix |
|---|---|---|
| **Reporting incremental LF instead of cumulative** | Engine subtracts wrong amount; under-bills | Always report total since project start |
| **Same `invoiced_amount` as previous month's** | Triggers double-counting alert on Virginia's screen | Enter cycle amount, not running total |
| **Forgetting to submit when nothing happened** | Job appears "missing" in Virginia's view | Submit "No Bill Required" with reason |
| **Submitting before month-end final numbers locked** | LF figures drift later in the month | Submit after the cutoff date Virginia sends |

## Practice scenario for PM training

**Test job:** any active install with prior submissions.

1. Open the job. Note last month's reported LF (e.g. Posts Only = 800).
2. Add 200 LF of new Posts Only this month.
3. **What you should enter:** Posts Only = 1,000 (cumulative). NOT 200.
4. Submit and verify in your history.
5. Repeat with a "No Bill Required" submission on a different test job.

---

# PART 2 — AMIEE (Contracts, Project Setup, COs, Line Items)

> **Bottom line:** Amiee is the upstream gate. Contract setup → Line Items → COs → Approve. If any of these is incomplete, Virginia's billing breaks downstream.

## Where to go

OPS app → **Projects** → click the job → **Money tab** at top → sub-tabs **Contract** / **Scope** / **Accounting**.

## Workflow A — New job setup (one-time per contract)

### Step 1 — Open the job

Projects page → click the job name. The EditPanel opens.

### Step 2 — Setup tab → Details & Requirements

Verify (or fill in) the basics:
- Customer Master link (search at top)
- Sales Rep, PM, Type
- Address, City, State, ZIP
- Customer #
- Notes

✅ **Verify:** Customer Master shows a green "Linked" badge. If not, link it now (search the master, click Apply).

### Step 3 — Setup tab → Parties / Dates / Info Sheet

Confirm parties (architect, GC, owner if applicable). Confirm contract date + expected start.

### Step 4 — Money → Contract

Confirm/fill in:
- Net Contract Value (matches signed contract)
- Sales Tax Amount (auto-calculates from height/style — verify it's right)
- Bonds amount (if any)
- Permit amount (if any)
- Retainage % — typically 5% or 10%
- Billing Method — Progress / Lump Sum / Milestone / T&M / AIA

✅ **Verify:** the **Adjusted Contract Value** at the top equals what's on the signed contract (Net + sales tax + bonds + permit). This is what the system measures % billed against.

### Step 5 — Money → Scope → Line Items

Line Items are pre-seeded from the proposal. Verify each row:
- Type (PC / SW / Gate / Permit / etc.)
- Height
- LF (or piece count for Gates)
- Unit price
- Style + Color (precast only)

The **Labor / Unit** and **Tax Basis / Unit** columns auto-fill from height + unit price (read-only):
- Precast 6ft → Tax Basis = $26
- Precast 8ft → Tax Basis = $29.25
- Gates → 66% labor / 34% tax basis
- Permits / Bonds → 100% labor

For SW / Wood / WI / Stick-Built rows, the labor + tax_basis are blank — manual entry IF needed for billing.

Click **Save Lines**.

✅ **Verify:**
- Line Items match the signed contract scope
- Adjusted Contract Value at the top recomputes correctly
- Sum of line_value across rows ≈ contract value (minor variance OK)

⚠ **If labor/tax_basis is blank on a precast row:**
- Check height — non-standard heights (12ft) won't auto-derive
- Check style — non-canonical styles won't match
- Manual entry: click into the cell and type the value

## Workflow B — Adding a Change Order

### Step 1 — Money → Scope → Change Orders card

Click **+ Add Change Order**.

### Step 2 — Fill in CO header

- CO number (auto-suggests next sequential)
- Description
- Date submitted
- Status: Pending until signed

### Step 3 — Add CO Line Items

Inside the CO card, click **Add Line Items**. Same auto-derive applies (labor/tax_basis fill from height + unit price).

### Step 4 — Sign + Approve

When the customer signs:
1. Update Date Approved
2. Change Status to **Approved** (only Amiee can do this)

✅ **Verify:**
- Adjusted Contract Value increases by the CO amount
- The CO appears in the App Ledger summary on the Accounting tab

⚠ **CRITICAL — Common Amiee mistake:**

If you add a CO header but skip the Line Items inside it, the system thinks the contract grew (Adjusted Contract Value goes up) but has no rows to bill against. Virginia hits the over-bill block. **Always add Line Items inside the CO card before approving.**

## What changes if Amiee skips a step

| Skipped step | Symptom |
|---|---|
| Customer Master link | Job won't link to company billing history |
| Line Items missing | Virginia's draft is empty; billing fails |
| CO without Line Items | Adjusted Contract goes up; engine has no rows; over-bill block fires |
| CO not Approved | Adjusted Contract doesn't include it; legitimate billing trips block |
| Wrong Sales Tax | Adjusted Contract Value is off; downstream % billed is wrong |

## Practice scenario for Amiee training

**Test job:** create a duplicate of an existing simple job.

1. Open the duplicate. Verify Adjusted Contract Value at top matches the original.
2. Open Scope → Line Items. Confirm pre-seeded rows are correct.
3. Edit one line's unit price; save. Verify Adjusted Contract Value recomputes.
4. Add a fake CO ($5,000 with one Line Item). Save header only (no line items). Confirm the warning when you try to mark Approved without line items.
5. Add the CO Line Item. Now mark Approved. Verify Adjusted Contract goes up by $5,000.
6. Open Accounting tab — verify the new CO is reflected in the Contract Summary.

---

# PART 3 — VIRGINIA (Billing Page + Accounting Tab)

> **Bottom line:** Two paths exist today. **AR Pending tab on Billing Page** is the legacy path. **Accounting tab inside each job** is the new path. Both work; pick one per submission. The Accounting tab is recommended for new cycles; the AR path is fine for catch-up / migrations.

## Path 1 — Billing page (AR Pending review)

### Where to go

Left nav → **Billing**. Pick the month at top (defaults to current).

### Step 1 — Review the queue

The Pending tab shows submissions waiting for AR review. Each row has:
- Job # / Name / PM
- Style / Color / Height
- Bill Sheet status (Submitted / No Bill / Missing)
- Submitted date

✅ **Verify:** counts at the top match expectations (e.g. ~80 pending in a typical month).

### Step 2 — Pick a job to review

Click **View** on a row → opens the AR Detail modal.

### Step 3 — Review the submission

In the modal:
- Confirm PM-reported LF makes sense for the job's progress
- Compare to invoice_entries already entered for this job (shown in modal)
- Review change orders (shown in Contract Breakdown card)

### Step 4 — Add an Invoice (if needed)

If the PM submission corresponds to an actual invoice you're entering:
- Fill **Amount**, **Invoice Number**, **Invoice Date**
- Click **+ Add Invoice**
- Confirm the YTD update preview at the bottom (shows new pct billed)

✅ **Verify:** the new YTD shown matches your expectation. If it would push past 105%, the system warns you.

### Step 5 — Mark Reviewed

Once invoice entries are in (or if there's nothing to enter), click **Mark Reviewed** OR **↺ Revert to Pending** if you change your mind (works for current + previous month).

✅ **Verify:** the submission moves to the Reviewed tab.

⚠ **If the Over-Bill Block modal appears:**

- Read the **specific reasons** in the amber box (this is the new double-counting detection — added 2026-05-05)
- Click **Show Fix Steps** for the 4-step guide
- For Opening Balance migration jobs (which are most April 2026 submissions): the system is correctly catching that the entry is already in YTD. **Don't override; click No Bill Required** if no real new work, or send back to PM for a corrected amount.

## Path 2 — Accounting tab (per-job, the new flow)

### Where to go

Projects page → pick the job → **Money tab** → **Accounting** sub-tab.

### Step 1 — Review the Contract Summary card

Top of the screen shows 5 tiles: Contract Value / Billed / Pending / Balance / Retainage + a progress bar.

✅ **Verify:** Contract = signed amount + approved COs. Billed ≈ what's been actually invoiced.

### Step 2 — Cycle Source dropdown

Auto-selects the most recent unbilled PM submission. Shows: month · PM · invoiced amount.

⚠ **If the dropdown shows "⚠ Already billed via Acct Sheet":** that submission has already been filed via this tab. Don't re-file.

### Step 3 — Review the draft table

Shows per-line × per-stage billing breakdown:
- Cells with red borders = over-billing warnings
- Multi-stage rows (precast, sw) — driven by PM apportionment, read-only
- Single-stage rows (gates, options, permits, bonds) — toggleable checkboxes

✅ **Verify:**
- Total at the bottom matches what should be billed this cycle
- No red over-billing cells

### Step 4 — Watch for the Double-Counting Banner (amber)

Above the draft, an amber banner may appear with specific reasons:
- "Synthetic backfill + new draft" → legacy import already covers; verify
- "Exact-amount match against App #N" → likely duplicate of a prior cycle
- "Already at >105% billed" → real over-bill; check COs

Click **Show Fix Steps** for the 4-step guide:
1. Verify Adjusted Contract Value on Contract tab
2. Check Change Orders entered on Scope tab
3. Look for duplicate Opening Balance / old invoices in App Ledger
4. Delete or correct the duplicate

### Step 5 — File Invoice

Click **📋 File Invoice ($amount)**.

System creates an `invoice_applications` row, posts to `invoice_entries` (canonical money ledger), and recalculates YTD.

✅ **Verify:**
- Toast confirms App #N filed
- Contract Summary at top updates (Billed +; Balance −)
- App Ledger at bottom shows the new App row

⚠ **If the File Invoice button is disabled:**
- Reason is shown in italics next to the button
- Common: "Pending + Billed exceeds contract" → too much in this cycle
- Common: "Over-billing warnings" → red cells in the draft
- Fix the underlying issue; the button re-enables

### Step 6 — Mark Paid (when customer pays)

In the App Ledger, click **✓ Mark Paid** on the App row.
- Enter date, method (check / wire / ACH), reference number
- Submit

App turns green; status flips to `paid`. Partial payments stay `filed` until the cumulative payment matches `net_due`.

### Step 7 — Release Retainage (at job close)

When the contract is complete:
- App Ledger → **↳ Release Retainage** button
- Confirm held amount in dialog

System creates a final App, zeroes `retainage_held`, posts to invoice_entries.

### Step 8 — Drill into history (audit trail)

Click any App row in the App Ledger to open the **Drill-Down Modal**:
- **PM Bill Sheet Source** — original submission with per-stage LF
- **Line Breakdown** — how the engine apportioned to lines
- **Payment History** — all payments

This is your audit trail when a customer disputes an invoice.

## Common Virginia mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Over-Bill Block: clicking "Override & Approve at 165%" without checking | Doubles YTD; corrupts data | Read the amber reasons; if double-counting, click Cancel + No Bill Required |
| Filing on Accounting tab AND clicking Mark Reviewed on Billing page | Same submission billed twice | Pick ONE path per submission. The amber pill on BillingPage warns you |
| Entering invoice amount before reading the over-bill warning | YTD goes past contract | Read the warning preview at the bottom of the Add Invoice form |
| Marking Reviewed when invoice not yet entered | Submission flagged complete with $0 billed | Add Invoice first, then Mark Reviewed |

## Practice scenario for Virginia training

**Test job:** any active job with a Pending April 2026 submission.

1. Open Billing → April → Pending tab. Click View on a row.
2. Try clicking Mark Reviewed without adding an invoice. Note the warning.
3. Open the same job's Accounting tab (Money → Accounting).
4. Review the Contract Summary, Cycle Source dropdown, and draft.
5. Click File Invoice (only if the draft is correct — if not, leave it).
6. Confirm App Ledger shows the new App.
7. Click the App row to open Drill-Down. Walk through PM Source, Line Breakdown, Payments History.
8. Use ↺ Revert to Pending if you accidentally clicked Mark Reviewed.

---

# Cross-role decision tree

When someone hits a problem, this is the diagnosis path:

| Problem | First check | Second check | Owner |
|---|---|---|---|
| PM bill sheet not showing in Pending | Was it submitted with No Bill = false? | Is it under the right billing month? | PM → Virginia |
| Over-Bill Block on a legitimate cycle | Is there a CO that should be Approved? | Is the Adjusted Contract Value correct? | Virginia → Amiee |
| Over-Bill Block on a duplicate-looking cycle | Is this an Opening Balance migration job? | Read amber double-counting reasons | Virginia |
| File Invoice button disabled | Read the italic reason next to the button | Check draft for red over-billing cells | Virginia → Amiee |
| Customer disputes an invoice | Open App row drill-down | Compare PM Source vs Line Breakdown vs Payments | Virginia |
| Material calc shows wrong piece counts | Is style + height confirmed? | Check Production Planning for capacity issues | Amiee → Carlos |
| Job has stale data after import | Customer Master link missing? | Pricing Book = Line Items now, no separate setup | Amiee |

---

# Quick reference — where to find each thing

| What | Where |
|---|---|
| **PM bill sheet submission** | Left nav → PM Bill Sheet |
| **AR review pending list** | Left nav → Billing → Pending tab |
| **Project setup** | Projects → click job → Setup tab |
| **Contract value + sales tax** | Projects → click job → Money → Contract |
| **Line Items + Change Orders** | Projects → click job → Money → Scope |
| **Accounting tab (file invoice / mark paid / release retainage)** | Projects → click job → Money → Accounting |
| **App Ledger (history)** | Inside Accounting tab, scroll down |
| **App row drill-down** | Click any App row in the App Ledger |
| **Revert to Pending** | Billing page → Reviewed tab → row's ↺ button (current + previous month only) |

---

*Document v1 (May 2026) — companion to `billing-workflow-v3.md` (canonical reference) and `money-billing-workflow.html` (visual swimlane). This guide is action-oriented for live training sessions.*
