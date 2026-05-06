# Updated Money Workflow — May 2026

**Replaces the Excel "Acct Sheet" template with a native OPS flow.**

This document walks through the new monthly billing cycle for the three roles that touch it: **Amiee** (Contracts), the **PMs** (Doug, Ray, Manuel, Rafael Jr.), and **Virginia** (AR).

---

## At a glance

```
   AMIEE ──────────► PM ──────────► VIRGINIA ──────────► invoice_entries
  (Contracts)    (Bill Sheet)    (Accounting tab)      (canonical ledger)

   ▲ once per     ▲ monthly       ▲ monthly             ▲ ytd_invoiced
     contract       per job         per job               recalcs auto
     (+ COs)
```

Each role hands off cleanly to the next. No emails, no Excel files, no Power Automate — everything happens inside the OPS app.

---

## Stage 1 — AMIEE (Contracts)

**Role:** Sets the contract up correctly so Virginia's billing engine has the right numbers to apportion against.

### One-time per contract

1. **Open the job → Money group → Contract tab.**
2. Confirm:
   - Net Contract Value
   - Sales Tax Amount (auto-calculated from height/style — verify)
   - Bonds / Permit amounts
   - Retainage % (typically 5% or 10%)
   - Billing Method (Progress / Lump Sum / Milestone / T&M / AIA — defaults to Progress)
3. Verify the **Adjusted Contract Value** at the top — this is what the system will measure billed % against.

### Money group → Scope tab

4. **Line Items** are pre-seeded from the contract setup (qty / category / fence_type / height / unit price). Verify each row.
5. The **Labor / Unit** and **Tax Basis / Unit** columns auto-fill from height and style. No separate Pricing Book to maintain — the system derives the split automatically (precast: $23 basis at 4ft up to $31.75 at 10ft; gates: 66% labor; permits/bonds: 100% labor).
6. Click **Save Lines**.

### Whenever a Change Order comes in

7. Open the job → **Scope tab → Change Orders card.**
8. Add the CO with description, amount, customer signature reference.
9. Add **CO Line Items** inside the CO card (same auto-derive applies — labor/tax_basis fill automatically).
10. Mark the CO **Approved** when signed (only Amiee can do this).

### What changes if Amiee skips a step

- **No Line Items** → Virginia's draft is empty; she has to bill manually.
- **CO entered but no CO Line Items** → Adjusted Contract Value goes up but the engine has no rows to bill against; Virginia hits over-bill blocks.
- **CO not marked Approved** → Adjusted Contract Value doesn't include it; legitimate billing trips the over-bill block.

---

## Stage 2 — PM (Bill Sheet Submission)

**Role:** Once a month per active job, reports cumulative LF installed by stage. Same as today — no workflow change for the PM.

### Each cycle

1. **Open the OPS app → PM Bill Sheet (mobile-friendly).**
2. Pick the job from your assigned list.
3. Fill in **cumulative LF since project start** for each stage that has activity:

   **Precast jobs:**
   - Posts Only (LF where posts are set but panels not yet)
   - Posts & Panels (LF where panels are also installed)
   - Complete (LF fully installed including caps/finish)

   **Stick-built jobs:**
   - Foundation
   - Columns
   - Panels
   - Cleanup

4. Enter your reported **Invoiced Amount** (total dollar value of work this cycle).
5. **OR** click **No Bill Required** + reason if the job had no billable activity (rain delays, awaiting permit, etc.).
6. Submit.

### Critical reminder

> **Cumulative, not incremental.** If the job has 500 LF installed at Posts Only this month and 400 LF were already billed last cycle, you still report **500** — not 100. The engine subtracts prior billing automatically.

### What happens after you submit

- Your submission lands in the system. Virginia sees it within minutes on her Accounting queue.
- You don't get an email confirmation today (that's an old Power Automate flow that's been retired). The PM Bill Sheet page shows the submission in your history immediately.

---

## Stage 3 — VIRGINIA (Accounting tab) — the new heart of the flow

**Role:** Picks up the PM submission, files the invoice, marks paid, releases retainage.

### Where Virginia picks it up

1. Open the job → **Money group → Accounting tab.**
2. **Cycle Source dropdown auto-selects** the most recent un-billed PM submission. (No more hunting through the AR Pending list.) The selection is shown above the draft along with the PM, billing month, and reported amount.
3. The **draft table** populates automatically — the engine apportions the PM's per-stage LF across the pricing lines proportionally to contract qty share.

### What Virginia reviews

- **Contract Summary card** at the top — Contract / Billed / Pending / Balance / Retainage tiles + progress bar.
- **Double-Counting Banner** (new) — if the system spots a likely duplicate (legacy import + new draft, exact-amount match against a prior App, already over-billed), an amber banner appears with specific reasons + a collapsible **Show Fix Steps** guide.
- **Draft table** — per-pricing-line × per-stage breakdown. Cells with red borders are over-billing warnings.
- **Single-stage rows** (gates, options, permits, bonds) — Virginia toggles a checkbox or types a partial qty for these (the PM doesn't track them).

### File the invoice

4. Verify the totals.
5. Click **📋 File Invoice ($amount)**.
6. The system creates an `invoice_applications` record (App #N), posts to the canonical `invoice_entries` ledger, recalcs `ytd_invoiced` automatically.

### What happens if there's a problem

| Problem | What Virginia sees |
|---|---|
| Already filed via Acct Sheet | Amber "⚠ Already billed via Acct Sheet" pill in the Cycle Source dropdown |
| Likely duplicate | Amber double-counting banner with reason + Show Fix Steps |
| Pending + Billed > Contract | Hard-block — File Invoice button disabled, reason shown |
| Approved CO needed | Generic "common causes" message in the Over-Bill Block modal |

### Mark Paid (when customer pays)

7. In the **App Ledger** at the bottom of the Accounting tab, click the **✓ Mark Paid** button on the relevant App row.
8. Enter payment date + method + reference.
9. The App row turns green; status flips to `paid`.

### Release Retainage (at job close)

10. When the contract is complete and retainage is due, click **↳ Release Retainage** in the App Ledger.
11. Confirm the held amount.
12. The system creates a final App, zeroes out the retainage_held balance, and posts to invoice_entries.

### Drill into history (any App row)

13. Click any row in the App Ledger to open the **Drill-Down Modal**:
    - **PM Bill Sheet Source** panel (new) — shows the original PM submission: cycle, PM, submitted date, reported total vs filed amount (with drift % if any), per-stage LF table.
    - **Line Breakdown** — how the engine apportioned those PM totals to your pricing lines.
    - **Payment History** — all payments recorded against this App.

This is the answer to "where can I see the history?" — one modal, full chain, top to bottom.

---

## Stage 4 — Coexistence with the legacy AR path

**For now, both paths work.** Virginia can still process a submission via the BillingPage AR Approve flow (legacy). The cutover is operational, not engineering.

- An amber **📋 Acct Sheet App #N** pill appears on BillingPage rows when a submission has already been filed via the new Accounting tab — visual heads-up to prevent double-billing.
- Once Virginia is fully comfortable on the new tab, the legacy AR Approve path can be deprecated (1–2 hours of cleanup).

---

## What changes for each role

| Role | Before | Now |
|---|---|---|
| **Amiee** | Set contract value + COs in Excel; no link to billing | Line Items in OPS feed Virginia's draft engine directly. Labor / tax_basis split auto-derives from height + style + unit price (no Pricing Book to maintain). CO setup is a forcing function — skip it and Virginia's draft fails. |
| **PM** | Submit monthly bill sheet | **No change.** Same submission, same form, same fields. |
| **Virginia** | Open Excel "Acct Sheet" template per job → manually plug PM numbers in → File invoice in QuickBooks | Open Accounting tab → review auto-generated draft → click File Invoice. App Ledger replaces the per-job Excel file. Drill-down modal replaces "where did this number come from?" digging. |

---

## Common questions

**Q: What if the PM enters the wrong LF on a stage?**
A: Virginia spots it during draft review (over-billing warnings, drift in the drill-down). She can edit per-cell quantities via cycle overrides, or send the PM back to fix the bill sheet.

**Q: What if Virginia files an invoice and the PM resubmits the same cycle?**
A: The amber "⚠ Already billed via Acct Sheet" pill appears on the dropdown. The double-counting banner fires Rule C (exact-amount match) if the resubmission matches what was already filed.

**Q: What if a job has historical billing from before the cutover?**
A: Each historical `invoice_entries` row was synthesized into an `invoice_applications` row during Phase A backfill. Those Apps carry a "Legacy Import" badge in the App Ledger; their dollars are accurate but per-stage breakdown isn't available (the original Excel didn't capture it).

**Q: How does Amiee know if her CO setup is incomplete?**
A: When Virginia opens the Accounting tab and the draft is wrong (e.g., over-billing because CO scope isn't priced), she pings Amiee. Phase E will add a Contract Readiness check that flags missing CO pricing before the next cycle starts.

**Q: What if the customer disputes the invoice?**
A: Open the App row drill-down. The PM Bill Sheet Source panel shows exactly what the PM reported and when. The Line Breakdown shows how those totals became dollars. Forward the modal screenshot or quote the figures back to the customer.

---

*Document version: v2.1 (May 2026). Supersedes `billing-workflow.md` for end-user guidance; the older doc remains for historical reference. Built alongside the May 2026 Accounting System launch. v2.1 reflects the Pricing Book retirement (Option C) — labor / tax_basis split now auto-derives from Line Items, no separate price book to maintain.*
