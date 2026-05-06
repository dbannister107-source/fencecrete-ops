# Money & Billing Workflow — v3 (May 2026)

**Replaces the Excel "Acct Sheet" template with a native OPS flow.**

This document walks the monthly billing cycle for the three roles that touch it: **Amiee** (Contracts), the **PMs** (Doug, Ray, Manuel, Rafael Jr.), and **Virginia** (AR / Billing).

---

## At a glance

```
   AMIEE ──────────► PM ──────────► VIRGINIA ──────────► invoice_entries
  (Contracts)   (Bill Sheet)    (Accounting tab)      (canonical ledger)

   ▲ once per     ▲ monthly       ▲ monthly             ▲ ytd_invoiced
     contract       per job         per job               recalcs auto
     (+ COs)
```

Each role hands off cleanly to the next. No emails, no Excel files, no Power Automate — everything happens inside OPS.

---

## Stage 1 — AMIEE (Contracts)

**Role:** Sets the contract up correctly so Virginia's billing engine has the right numbers to apportion against.

### Once per contract — Money group → Contract tab

1. **Open the job → Money → Contract.**
2. Confirm:
   - Net Contract Value
   - Sales Tax Amount (auto-calculated from height/style — verify)
   - Bonds / Permit amounts
   - Retainage % (typically 5% or 10%)
   - Billing Method (Progress / Lump Sum / Milestone / T&M / AIA — defaults to Progress)
3. Verify the **Adjusted Contract Value** at the top — this is what the system measures billed % against. Must match the signed contract.

### Money group → Scope tab

4. **Line Items** are pre-seeded from the contract setup (qty / category / fence_type / height / unit price). Verify each row matches the signed contract.
5. **Labor / Unit** and **Tax Basis / Unit** columns auto-fill from height + style + unit price. Read-only — no separate Pricing Book to maintain:
   - **Precast:** tax_basis from height ($23 at 4ft → $31.75 at 10ft); labor = unit price − tax_basis
   - **Gates:** labor = 66% of price; tax_basis = 34%
   - **Permits / Bonds:** 100% labor (non-taxable)
   - **Stick-Built / Wood / Other:** blank — manual entry only when needed
6. Click **Save Lines**.

### Whenever a Change Order comes in — Scope tab → Change Orders card

7. Add the CO with description, amount, customer signature reference.
8. Add **CO Line Items** inside the CO card (auto-derive applies — labor / tax_basis fill automatically).
9. Mark the CO **Approved** when signed (only Amiee can do this).

### What changes if Amiee skips a step

- **No Line Items** → Virginia's draft is empty; she has to bill manually.
- **CO entered but no CO Line Items** → Adjusted Contract Value goes up but the engine has no rows to bill against; Virginia hits over-bill blocks.
- **CO not marked Approved** → Adjusted Contract Value doesn't include it; legitimate billing trips the over-bill block.

---

## Stage 2 — PM (Bill Sheet — Monthly)

**Role:** Once a month per active job, reports cumulative LF installed by stage. **The PM workflow has not changed.**

### Each cycle — OPS app → PM Bill Sheet (mobile-friendly)

1. Pick the job from your assigned list.
2. Fill in **cumulative LF since project start** for each stage that has activity:
   - **Precast:** Posts Only · Posts & Panels · Complete
   - **Stick-built:** Foundation · Columns · Panels · Cleanup
3. Enter your reported **Invoiced Amount** (total dollar value of work this cycle).
4. Or click **No Bill Required** + reason (rain delays, awaiting permit, etc.).
5. Submit.

### Critical reminder

> **Cumulative, not incremental.** If you have 500 LF installed at Posts Only and 400 LF were already billed last cycle, report **500** — not 100. The engine subtracts prior billing automatically. This is the #1 source of cycle-to-cycle errors.

### What happens after you submit

Your submission lands in the system. Virginia sees it within minutes on her Accounting queue. The PM Bill Sheet page shows your submission in history immediately.

---

## Stage 3 — VIRGINIA (Billing — Accounting tab)

**Role:** Reviews the auto-generated draft, files the invoice, marks paid, releases retainage at job close.

### Where Virginia picks it up — job → Money → Accounting

1. The **Cycle Source dropdown auto-selects** the most recent unbilled PM submission.
2. The **draft table** populates automatically — the engine apportions the PM's per-stage LF across Line Items proportionally to contract qty share.

### What Virginia reviews (top to bottom)

- **Contract Summary card** — Contract / Billed / Pending / Balance / Retainage tiles + progress bar.
- **Double-Counting Banner** (when applicable) — amber banner with specific reason(s) + collapsible **Show Fix Steps** guide. Click the banner to scroll to the App Ledger.
- **Billing Method banner** — confirms which flow this contract uses (Progress / Lump Sum / Milestone / T&M / AIA).
- **Draft table** — per-line × per-stage breakdown. Cells with red borders are over-billing warnings.
- **Single-stage rows** (gates, options, permits, bonds) — checkbox to bill all-or-nothing, or type a partial qty.

### File the invoice

3. Verify the totals.
4. Click **📋 File Invoice ($amount)**.
5. The system creates an `invoice_applications` row (App #N), posts to the canonical `invoice_entries` ledger, and recalcs `ytd_invoiced` automatically.

### What the system blocks

| Problem | What Virginia sees |
|---|---|
| Already filed | Amber "⚠ Already billed via Acct Sheet" pill in dropdown |
| Likely duplicate | Amber double-counting banner + Show Fix Steps guide |
| Pending + Billed > Contract | File Invoice button hard-disabled, reason shown |
| Approved CO needed | Generic "common causes" message in Over-Bill Block modal |

### Mark Paid (when customer pays)

6. In the **App Ledger**, click **✓ Mark Paid** on the App row.
7. Enter payment date, method, and reference.
8. Submit. App turns green; status flips to `paid`. Partial payments stay `filed` until cumulative payment matches net due.

### Release Retainage (at job close)

9. In the **App Ledger**, click **↳ Release Retainage**.
10. Confirm the held amount.
11. The system creates a final App, zeroes out `retainage_held`, posts to `invoice_entries`.

### Drill into history (any App row)

12. Click any App row to open the **Drill-Down Modal**:
    - **PM Bill Sheet Source** — original submission: cycle, PM, submitted date, reported total vs filed amount (with drift % if any), per-stage LF table.
    - **Line Breakdown** — how the engine apportioned the PM totals to your line items.
    - **Payment History** — all payments recorded against this App.

This answers "where did this number come from?" — full chain in one modal.

---

## What changes for each role

| Role | Before | Now |
|---|---|---|
| **Amiee** | Set contract value + COs in Excel; no link to billing | Line Items in OPS feed Virginia's draft engine directly. Labor / tax_basis split auto-derives — single edit point. CO setup is a forcing function. |
| **PM** | Submit monthly bill sheet | **Unchanged.** Same form, same fields, same cadence. |
| **Virginia** | Open Excel "Acct Sheet" template per job → manually plug PM numbers in → file invoice in QuickBooks | Open Accounting tab → review auto-generated draft → click File Invoice. App Ledger replaces the per-job Excel. Drill-down modal replaces digging through old emails. |

---

## Common questions

**Q: What if the PM enters the wrong LF on a stage?**
A: Virginia spots it during draft review (over-billing warnings, drift % in the App drill-down). She edits per-cell quantities via cycle overrides, or sends the PM back to fix the bill sheet before filing.

**Q: What if Virginia files an invoice and the PM resubmits the same cycle?**
A: The amber "⚠ Already billed via Acct Sheet" pill appears in the Cycle Source dropdown. The double-counting banner fires Rule C (exact-amount match) if the resubmission's total matches what was already filed.

**Q: What if a job has historical billing from before the cutover?**
A: Each historical `invoice_entries` row was synthesized into an `invoice_applications` row during the cutover backfill. Those Apps carry a "Legacy Import" badge in the App Ledger; dollar amounts are accurate but per-stage breakdown isn't available.

**Q: How does Amiee know if her CO setup is incomplete?**
A: When Virginia opens the Accounting tab and the draft is wrong (e.g., over-billing because CO scope isn't entered), she pings Amiee.

**Q: What if the customer disputes the invoice?**
A: Open the App row drill-down. The PM Bill Sheet Source panel shows exactly what the PM reported. The Line Breakdown shows how those totals became dollars.

**Q: Where does the labor / tax_basis split come from?**
A: It auto-derives from category + height + style + unit price the moment a Line Item is saved. Sales tax is calculated on the tax_basis portion only. There's no separate price book — Line Items is the single source of truth.

---

*Document v3 (May 2026) — canonical end-user reference. Supersedes the v1 / v2 / v2.1 docs which were patched mid-build; this version describes the system as-is, no historical baggage.*
