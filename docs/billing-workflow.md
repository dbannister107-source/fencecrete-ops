# OPS Billing Workflow

A practical guide for Amiee (Contracts) and Virginia (AR). Plain language, no jargon.

> Last updated: 2026-05-05 — covers the new Accounting System (Phases A–D) that replaces Virginia's manual Excel "Acct Sheet" template.

---

## The big picture

```
┌─────────────────┐    ┌────────────────┐    ┌─────────────────┐
│  PROJECT SETUP  │───▶│  PM BILL SHEET │───▶│   ACCT SHEET    │───▶ Customer
│    (Amiee)      │    │ (PM, monthly)  │    │   (Virginia)    │     pays
└─────────────────┘    └────────────────┘    └─────────────────┘
        │                       │                     │
   "What's on the          "What got built       "Generate the
    contract + how          this month?"          invoice + send
    do we price it?"                              to customer"
```

The whole flow lives on each project's **EditPanel** in the Money group:
**Contract & Billing → Pricing → Line Items → Totals → Change Orders → Accounting**

---

## 1. Project Setup (Amiee)

When you create a new project on the **Details & Requirements** tab, these fields matter most for billing:

| Field | Why it matters |
|---|---|
| **Customer** (use Customer Master Lookup) | Links the project to the right billing entity |
| **Retainage %** (Yes/No + 0/5/10/15) | How much we hold back from each invoice |
| **Billing Date** (day of month, 1–31) | Which day each cycle's invoice is sent |
| **Contract Date** | When the contract was signed (drives age calcs) |
| **Tax Exempt?** | Switches off sales tax across the whole job |

Then on the **Line Items** tab, add what's actually on the contract — one row per scope (each precast height, each gate, each permit/bond, etc.).

```
Example Line Items for "Project ABC":
  Line 1 — Precast 6'    100 LF  @ $98/LF  =  $9,800
  Line 2 — Precast 8'     50 LF  @ $155/LF =  $7,750
  Line 3 — 16' Gate        2 EA  @ $12,495 = $24,990
  Line 4 — Permit          1 LS  @ $1,500  =  $1,500
```

---

## 2. Pricing Book (Amiee, once per project)

The **Pricing** tab is your price book. It's the bridge between "what's on the contract" (Line Items) and "how we bill it" (Acct Sheet).

**First time you open it:** the system pre-fills rows based on your Line Items. Each row gets:

```
   Total Price/LF   =   Labor portion   +   Tax basis portion
       $98          =       $72        +       $26     ← (sales tax applies to this)
```

Standard tax basis values are auto-filled (4'=$23, 5'=$24.75, 6'=$26, 7'=$27.50, 8'=$29.25, 9'=$30.50, 10'=$31.75). You can override any of them.

**Stage weights** (collapsible panel below the table):

| Category | Stages | Weight |
|---|---|---|
| **Precast** | Posts Only / Posts & Panels / Complete | 65% / 20% / 15% |
| **Single Wythe** | Foundation / Columns / Panels / Cleanup | 25% / 30% / 42% / 3% |
| **Gates / Options / Permits / Bonds** | Complete | 100% |

These are the same defaults Virginia's Excel used — you only need to override if THIS contract recognizes milestones differently.

Click **Save Pricing** when done.

---

## 3. PM Bill Sheet (PMs, monthly)

Each month, the project's PM (Doug, Ray, Manuel, or Rafael Jr.) submits a Bill Sheet via the **PM Bill Sheet** page in OPS. They report cumulative LF that hit each milestone:

```
April 2026 PM Bill Sheet for Project ABC (Doug)
  Posts Only  ........... 100 LF  ← all 100 LF have posts in
  Posts & Panels ........  60 LF  ← 60 of those also have panels stacked
  Complete ..............   0 LF  ← none fully done yet
```

**Important: these are CUMULATIVE numbers, not "this month."** PMs report total LF that have reached each milestone since project start.

---

## 4. Generate Draft Invoice (Virginia)

Open the project → **Accounting** tab.

```
┌─ Contract Summary ──────────────────────────────────────────┐
│ Contract  $42,040  │ Billed  $0  │ Pending  $0  │ Bal $42K │
│ Retainage Held $0                          ▓▓░░░░░░ 0.0%   │
└─────────────────────────────────────────────────────────────┘

Cycle Source: [▾ April 2026 — Doug — $XX,XXX]
Invoice Date: [📅 2026-04-30]   Notes: [_____________________]

┌─ Draft Table (auto-computed) ──────────────────────────────┐
│ Pricing Line │ Stage          │ Cum │ Prior │ Curr │ Total│
│ 6' pc        │ Posts Only     │ 100 │   0   │ 100  │$6,509│
│              │ Posts & Panels │  60 │   0   │  60  │$1,201│
│              │ Complete       │   0 │   0   │   0  │   $0 │
│ 16' Gate     │ ☐ Bill         │   0 │   0   │   0  │   $0 │
│ Permit       │ ☑ Bill         │   1 │   0   │   1  │$1,500│
└─────────────────────────────────────────────────────────────┘

Current Amount: $9,210   Retainage @ 10%: $921   NET DUE: $8,289

[📋 File Invoice ($9,210)]    [Save Draft]
```

The system has **already done the math** — pulled the PM's cumulative LF, applied stage weights, computed labor + tax basis + sales tax for each cell.

For **single-stage items** (gates, options, permits, bonds), use the checkbox to toggle "bill in this cycle." For partial billing, click the qty and type a number.

If you see a **yellow warning banner**, read it before filing. Common warnings:

- *Heads up — this job has $X billed via legacy imports* → make sure the PM's numbers reflect ONLY new work this cycle, not historical.
- *Pending + Billed exceeds contract value* → File button is locked until resolved.
- *Pricing row "X" is missing labor/tax_basis split* → fix on Pricing tab.

---

## 5. File the Invoice (Virginia)

Click **📋 File Invoice**. The system:

1. Locks in the App number (App #1, #2, #3...)
2. Generates the invoice number: `INV-{job_number}-{NN}` (e.g., `INV-26H017-03`)
3. Posts the gross amount to the AR ledger
4. Updates the contract's **Billed To Date** and **Retainage Held**

You'll see a green confirmation: *"App #3 filed: INV-26H017-03"*

The invoice now appears in the **Application Ledger** at the bottom of the page:

```
Application Ledger
   App # │ Invoice #         │ Date     │ Period   │ Amount  │ Net Due │ Status
   ──────┼───────────────────┼──────────┼──────────┼─────────┼─────────┼───────
    #3   │ INV-26H017-03     │ Apr 30   │ Apr 2026 │ $9,210  │ $8,289  │ Filed
    #2   │ INV-26H017-02     │ Mar 31   │ Mar 2026 │ $5,400  │ $4,860  │ Paid
    #1   │ INV-26H017-01     │ Feb 28   │ Feb 2026 │ $3,800  │ $3,420  │ Paid
```

Send the customer the invoice for the **Net Due** amount.

---

## 6. Customer Pays + Retainage Release

When the customer pays an App, mark its status as **Paid** (Phase E will add a one-click button; until then, edit on the App row).

When the contract is **fully complete** and you're ready to release the held retainage:

1. The **Application Ledger** header shows: `↳ Release Retainage ($X,XXX)` button (only visible when Retainage Held > 0)
2. Click it → confirm dialog appears
3. System creates a final App with the held retainage as the invoice amount
4. Retainage Held drops to $0; contract is fully billed

---

## 7. End-to-End Flow

```
1. AMIEE creates project
   └─▶ Sets Retainage %, Billing Date, links Customer
       └─▶ Adds Line Items (what's on the contract)

2. AMIEE sets up Pricing Book
   └─▶ Auto-fills from Line Items
       └─▶ Reviews labor + tax basis split
           └─▶ Saves

3. PROJECT MANAGER works the job each month
   └─▶ Reports cumulative LF per milestone
       └─▶ Submits PM Bill Sheet by month-end

4. VIRGINIA opens Accounting tab
   └─▶ Picks the PM Bill Sheet
       └─▶ Reviews auto-computed draft
           └─▶ Toggles gates/permits/bonds to bill this cycle
               └─▶ Resolves any yellow warnings

5. VIRGINIA clicks File Invoice
   └─▶ App # + Invoice # auto-assigned
       └─▶ Posts to AR ledger (Billed To Date updates)
           └─▶ Retainage Held updates

6. VIRGINIA sends invoice to customer
   └─▶ Customer pays Net Due
       └─▶ App status → Paid

   ↻ Repeat steps 3–6 each month until contract is complete

7. CONTRACT COMPLETE → VIRGINIA clicks Release Retainage
   └─▶ Final App created for the held amount
       └─▶ Customer pays → contract fully billed
```

---

## Common scenarios

### "The PM's bill sheet is wrong this month"
PM corrects + re-submits the Bill Sheet, then you re-pick it on the Accounting tab. Draft updates automatically.

### "I need to bill less than what's already been billed (correction)"
Override the cumulative qty cell directly on the Draft Table. The engine will surface a warning if the new amount goes negative — verify before filing.

### "What about Change Orders?"
**For Phase D (today):** CO sub-pricing isn't yet wired into the Accounting tab. For projects with active CO billing (8 jobs as of 2026-05-05), use the legacy AR Review workflow on the **Billing** page until Phase E ships.

The Accounting tab will show an amber `📋 Acct Sheet App #N` pill on submissions you've already filed via the new tab — that's your heads-up to **not** also approve them on the Billing page (would create a duplicate invoice).

### "This job is tax-exempt"
Set `Tax Exempt = Yes` on the Project Setup tab. The Acct Sheet draft will zero out the sales tax row across all cells automatically.

### "I see 'legacy imports' warning on a job"
Jobs that had `invoice_entries` from before the new system are imported as headers-only (no per-stage detail). The first cycle you bill on a legacy job, **double-check the PM's cumulative numbers** — they should reflect TOTAL LF since project start, not just new work, otherwise you'll over-bill.

---

## Quick reference: who does what

| Person | Tab(s) they live in | Action |
|---|---|---|
| **Amiee** | Details / Line Items / Pricing / Parties | Sets up new projects + maintains pricing |
| **PMs** (Doug, Ray, Manuel, Rafael Jr.) | PM Bill Sheet (own page) | Submits monthly cumulative LF |
| **Virginia** | Accounting / Billing | Generates + files invoices, releases retainage |

---

## Glossary

| Term | What it means |
|---|---|
| **Pricing Book** | The job's price list — one row per scope (each precast height, each gate type, each permit, etc.). Decomposes total $/unit into labor + tax basis. |
| **Stage Weights** | How a price gets split across milestones. Precast: 65% Posts Only / 20% Posts & Panels / 15% Complete. SW: 25/30/42/3. Gates/etc: 100% Complete. |
| **App** (Application) | One billing cycle's invoice. App #1, #2, #3... per project. |
| **Cumulative qty** | Total LF that have reached a stage, since project start (not "this month"). |
| **Prior qty** | Cumulative qty already billed via prior Apps. |
| **Current qty** | What this App is billing for = Cumulative − Prior. |
| **Retainage** | Portion held back from each invoice (typically 10%) until project completion. |
| **Retainage Release** | Final invoice that bills the cumulative held retainage and zeroes the balance. |
| **Tax Basis** | The portion of price/LF that sales tax applies to (the "material" portion, vs. labor which is non-taxable in Texas). |
| **Filed** | An App's status after Virginia clicks File Invoice — locks the invoice into the AR ledger. |
| **Paid** | An App's status once the customer has paid the Net Due. |
