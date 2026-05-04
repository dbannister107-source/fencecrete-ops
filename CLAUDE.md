# CLAUDE.md — Fencecrete OPS

This file is read by Claude Code automatically at the start of every session. It contains the architectural principles, technical context, and operational patterns you need to be effective on this codebase. Read it carefully before making changes.

## Safety Rules (Critical - Always Follow)

- NEVER run `rm -rf`, `rm -r`, `del`, or any destructive commands without explicit user confirmation.
- Always show the exact command and affected paths first and wait for "YES" or "PROCEED".
- Prefer safer alternatives (e.g. `git clean`, moving to trash, or asking user to delete manually).
- Before any file system modification that could delete data, summarize the risk and get explicit approval.
- Never assume current working directory — always use full paths when running dangerous commands.
- If something seems risky, stop and ask for confirmation instead of proceeding.

I am very sensitive about data loss after the recent folder deletion incident.

---

## What This Is

**Fencecrete OPS** is the internal operations platform for Fencecrete America, LLC — a Texas-based precast concrete fence and wall manufacturer/installer. The platform replaces the company's Excel-based tracking and serves as the system of record for projects, billing, production, scheduling, sales, and fleet operations.

- **Live URL:** https://fencecrete-ops.vercel.app
- **GitHub:** dbannister107-source/fencecrete-ops
- **Local path:** `C:\Users\DavidBannister\fencecrete-ops`
- **Deployment:** Vercel auto-deploys on push to `main`. ~90 sec build time.

The CEO (David Bannister) is the sole developer. Sessions are typically long working sprints across multiple workstreams. Default to direct, outcome-focused communication. Most decisions get a short approval and execution should proceed without environment-switching.

---

## Tech Stack (current)

- **Frontend:** React + Tailwind, single-file architecture in `src/App.jsx` (~1.93 MB / ~24,900 lines)
- **Build:** Create React App (CRA). Will migrate to Vite/Next.js during the eventual Hurricane port.
- **Backend:** Supabase (project ID `bdnwjokehfxudheshmmj`, us-east-1)
- **Edge functions:** Deno-based, ~25 functions deployed
- **Email:** Resend via SMTP (port 465). DNS verification at Sharkmatic still pending.
- **Storage:** Supabase Storage buckets (`proposals`, `pm-daily-reports`, `project-attachments`, `pis-tax-certs`)
- **AI chat widget:** Chorizo (Claude Haiku) embedded in the platform

A planned **Hurricane port** (3-4 months part-time) will move this to Next.js 15 / React 19 / TypeScript / Prisma / tRPC monorepo. Until then, this CRA app is what runs the business.

---

## Six Architecture Principles

These are codified in `ARCHITECTURE.md` at the repo root. Don't violate them.

1. **Triggers, not agents, for propagation.** Deterministic DB triggers compute derived fields (`adj_contract_value`, `ytd_invoiced`, `pct_billed`, `left_to_bill`). Never use AI agents for propagation logic — only for cleanup/analysis.

2. **Computed fields are read-only at the app layer.** Setting `adj_contract_value` directly does nothing — the trigger overwrites it. To change it, update its inputs (`net_contract_value`, change orders, bonds, permit, sales_tax_amount).

3. **Source of truth is the source table, not the cached column.** Billing source of truth = `invoice_entries`. `jobs.ytd_invoiced` is derived. If they disagree, trust `invoice_entries` and figure out why the trigger missed.

4. **Forcing functions over nudges.** Real workflow gates (Contract Readiness Gate, Validator Gate) physically block bad data from advancing. Nudges/dashboards are decorative; gates change behavior.

5. **Fold, don't sprout, in the UI.** When adding a feature, fold it into existing tabs/panels. Don't sprout new pages unless the workflow genuinely doesn't fit anywhere.

6. **App.jsx hard cap.** New pages go in `src/features/<name>/<Name>Page.jsx`, not into App.jsx. Currently 8 modular features live there:
   - `src/features/contracts-workbench/ContractsWorkbenchPage.jsx`
   - `src/features/cv-reconciliation/CVReconciliationPage.jsx`
   - (others)

---

## Critical Patterns You Must Know

### RLS pattern (the single most important rule)

**All RLS policies in OPS use this exact form:**
```sql
CREATE POLICY "public access" ON <table>
  FOR ALL TO public USING (true) WITH CHECK (true);
```

The OPS web client uses the **anon key for everything** (single shared key, no per-user JWT). Authorization is enforced at the **application layer** via `canEditProjects`, `canApproveCO`, role-based UI hiding, etc.

**Role-targeted RLS policies (`TO authenticated`, `TO anon`) silently break the OPS client.** This caused 4 production bugs that we've already fixed (project_info_sheets, mold_inventory_cap/post/rail, style_specifications). If you encounter `42501 new row violates row-level security policy`, the table almost certainly has the wrong RLS pattern. Replace with the standard form above.

This will look "wrong" by Supabase advisor standards (the advisor flags `rls_policy_always_true`). Those warnings are deliberate, not bugs. Don't "fix" them by switching to role-targeted policies.

### Color vocabulary

- **Red / pink** → action required, error, warning. Reserved for items the user must address.
- **Yellow / amber** → caution, awaiting decision
- **Blue / grey** → informational, reference only
- **Green** → success, ready, complete

Don't put informational content in red boxes. (Bug we fixed: the Sales Origin card on Candela WWTP was styled red, Amiee asked "do I need to do something with this red box?" — UI miscommunicated intent.)

### Computed field dependencies

| Field | Computed by | Inputs |
|---|---|---|
| `jobs.adj_contract_value` | `trg_recalc_adj_contract` | `net_contract_value` + `change_orders` + `bonds_amount` + `permit_amount` + `sales_tax_amount` |
| `jobs.ytd_invoiced` | `trg_recalc_ytd_invoiced` | `SUM(invoice_entries.invoice_amount)` |
| `jobs.pct_billed` | trigger | `ytd_invoiced / adj_contract_value` |
| `jobs.left_to_bill` | trigger | `adj_contract_value - ytd_invoiced` |

Never set these directly. If you need a different value, change the upstream input.

### Two ID conventions on jobs

`jobs` has two keys, used for different purposes — codified to stop the back-and-forth:

| Field | When to use |
|---|---|
| `jobs.id` (UUID) | Joins, FKs, REST filters, anything the database ingests. The technical key. |
| `jobs.job_number` (text, e.g. `"24H007"`) | Display, search, conversation, customer-facing references (PIS links, contract docs). The human-readable key. |

When you receive input that might be either form (e.g., the PIS send flow takes a `job` object that occasionally is a lead, or URL deep-link params), use the shared utility instead of rolling your own:

```js
import { resolveJobId, isUuid } from './shared/jobs';

const id = await resolveJobId(input); // returns canonical jobs.id, or null
if (!id) { /* handle "couldn't resolve" — typically a not-found error to the user */ }
```

`isUuid(str)` is the synchronous companion when you want to skip the DB roundtrip for already-UUID inputs.

**Structural debt** (separate from this utility): some child tables (`job_line_items`, `leads`) FK by `job_number` text rather than `job_id` UUID. That's a real inconsistency, not addressed by `resolveJobId()`. Eventually those should be migrated to UUID FKs. Until then, queries against those tables filter by `job_number=eq.${...}` and that's expected.

### Two plant-capacity models — coexist on purpose

There are **two correct ways** to talk about plant capacity, answering **different questions**:

| Model | Formula | Question it answers | Where used |
|---|---|---|---|
| **Daily run capacity** | `molds × panels_per_mold × MOLD_UTIL_RATE (0.88)` | "Can today's plan fit in the plant?" | Production Planning's leadership table; daily plan-line capacity stripe; DailyReport |
| **Horizon capacity / weeks-to-clear** | `LEAST(panels, posts, rails, caps) × (24 / cure_time_hours) × SHIFT_FACTOR (0.524) × 5 days` | "How many weeks to clear backlog at our actual binding constraint?" | Demand Planning Capacity tab; Co-Pilot home insights; AI scheduler; MoldsWhatIf |

Both numbers can be true at the same time. **Daily** measures shop-floor cycle output; **horizon** measures backlog burndown after the binding mold component is exhausted. The "Limited by" column on the Production Planning leadership table bridges the two — if a style shows `caps (28)` there, you can run today's panels but the cap-mold inventory will bottleneck the WEEK's output even though daily panels can still go.

`SHIFT_FACTOR` = 88h plant operation / 168h theoretical (Shift 1 Mon–Sat 8a–4p + Shift 2 Mon–Fri 6p–2a). v_mold_capacity exposes `theoretical_lf_per_day` assuming 24/7 operation; multiply by SHIFT_FACTOR for what actually ships.

`v_mold_capacity` is the source of truth for the horizon model. Don't roll your own panel-LF math elsewhere — read this view.

### Supabase calls go through `src/shared/sb.js` only

All REST / Storage / Edge-function calls go through helpers exported from `src/shared/sb.js` (`sbGet`, `sbGetOne`, `sbPost`, `sbPatch`, `sbPatchWhere`, `sbDel`, `sbDelWhere`, `sbUpsert`, `sbRpc`, `sbStorageUpload`, `sbStorageDelete`, `sbStorageSign`, `sbFn`). An ESLint rule (`no-restricted-syntax`) errors on direct `fetch(\`${SB}/...\`)` outside that file. Phase-1 transition: `src/App.jsx` is grandfathered as `warn`-only until its ~95 inline fetches are migrated; new code there still surfaces a warning. If your call pattern isn't covered by an existing helper, add a new one in `sb.js` rather than reaching around the rule.

### App.jsx editing strategy (when working on the monolith)

1. **View first, edit second.** App.jsx is 1.93 MB — always grep before editing to confirm anchor uniqueness.
2. **Validate before push:** `npx @babel/parser` against the file to catch syntax errors before they hit Vercel (Vercel build is ~90s — local validation is faster).
3. **Tab discipline:** Fold features into existing tabs unless absolutely necessary to add one. The nav has 8 groups, 34 items, 34 unique icons — don't break this.

---

## Active Workstreams (snapshot)

### Currently in flight
- **A3 line items + tax basis migration:** Blocked on 3 questions for Alex (PC tax basis universal? WI=33%? Wood basis?). 82 jobs need data hygiene first. 51 active 'Exempt' jobs.
- **Customer Master Phase 2 + 3:** Code is COMPLETE. Diagnostic + Reconcile (with bulk actions + auto-accept high-confidence) shipped 2026-04-30. Companies & Docs tab + `trg_company_attachment_fan_out_ai` fan-out trigger also live. Remaining work is operational, not engineering: 83 active jobs still unmatched to companies (trend was wrong direction, +25 since last snapshot); 0 company documents uploaded so far (zero adoption of Phase 3). The contract-readiness gate now correctly enforces `company_id` linkage (see "Recently shipped").
- **Proposal Intelligence Phase 2:** 1,162 proposals ingested. **959 still tagged `pending`** — Amiee tagging sprint is the unlock for everything downstream.
- **Demand Planning v1:** Recently shipped. Co-Pilot home + drift detection working.

### Recently shipped (2026-05-04)

**Session summary (2026-05-04, FINAL — full day + extended evening):** 12 commits to `main` (`492b5ef`..`7137b6b`), 2 DB migrations, 1 new shared module, 2 new DB triggers + backfill, 1 new test file. Driven entirely by a live-app review of ops.fencecrete.com — **all 20 findings (P0/P1/P2/P3) closed by end of day**. Plus: Tier 1 mobile improvements for PM workflows (role-driven bottom nav, camera-first photo capture, PM Bill Sheet mobile card layout), TDZ crash fix on Material Calculator caught mid-QA-sweep, sidebar icon dict completion (28 → 41 entries), sidebar count alignment with Dashboard's canonical `active` definition. App.jsx gained ~280 lines net across the day (consolidations + new mobile-aware branches + new icons). All builds green; all CI green.

**By commit:**

🔴 **`492b5ef` — All 3 P0s from live review in one shot**
- **Crew Assignment bulk UI**: multi-select checkboxes + sticky black action bar that appears on N>0 selected, with market-filtered leader picker, cross-market warning, Promise.allSettled batch assign. Backstory: 0 of 174 active jobs had `crew_leader_id` set (the field existed but no data entry path was writing to it). Per-row dropdown made backfilling 55 jobs = 55 clicks; bulk UI makes it 1.
- **Forcing-function gate**: `enforce_crew_leader_for_active_install()` trigger fires `BEFORE UPDATE OF status, crew_leader_id` (and `BEFORE INSERT`) on jobs; raises `check_violation` if the row would land in `active_install` with `crew_leader_id IS NULL`. Catches both transition INTO active_install AND clearing crew_leader_id ON active_install. Migration: `20260504_active_install_requires_crew_leader.sql`. Existing 55 unassigned active_install rows are NOT touched (trigger only fires on writes that touch those columns); first attempt to clear or replace will be the first validation. Test file: `supabase/tests/crew_leader_gate.sql` (5 PASS assertions, runs in CI).
- **Billing metrics single source of truth**: new `src/shared/billing.js` exports `neverBilledJobs / neverBilledTotal / staleBillingJobs / daysToFirstInvoice / fullyBilledCount / totalLeftToBill / totalYtdInvoiced` plus `BILLING_ELIGIBLE_STATUSES`. Dashboard's "Never Billed" KPI + Billing page's "Never Billed" filter now consume the same definition. The "Avg Days to 1st Invoice" KPI relabelled "**Median Days to 1st Invoice**" (median 268d vs mean 312d in current cohort; max=794d outlier was dragging the mean ~50d off the typical experience). Sub-line shows N + P25 + P75 for distribution context.
- **Color audit Pass 1**: `fpill()` filter-pill helper active state shifted from brand red `#8A261D` → info blue `#1D4ED8`. One-line change in a shared helper recolored ~30 filter chips across the app.

🎨 **`48002a1` — Color audit Pass 2 (semantic discipline on tertiary surfaces)**
- Brand-guide-informed (FC_logo_guide.pdf): only red `#8A261D` and warm gray `#625650` are official brand colors. Brand red now reserved for the SINGLE primary action per screen + actual danger states + the brand mark itself.
- `gpill()` (group/view-mode toggles, ~10 surfaces) shifted from red active → blue active, matching `fpill()`.
- "📧 Send Reminders" tertiary text-link → amber (warning, not primary).
- "View All →" navigation → warm gray.
- Two "Clear All" filter-clear buttons → warm gray.
- AR "View" detail buttons → neutral gray.
- "🔓 Editing Unlocked" badge → amber (elevated state, not danger).
- PM Daily Report "Clear Form" → warm gray.
- Net effect: red on the live app drops from "everywhere" to "only the actions you actually need to look at."

🔧 **`4e0328c` — Three P1s from live review**
- **PRODUCT vs PRIMARY TYPE contradiction retired**: `sync_product_from_primary_fence_type()` trigger auto-populates `jobs.product` from `jobs.primary_fence_type` on INSERT/UPDATE. Mapping: Precast→Precast Fence, Masonry→Masonry, Wood→Wood, Wrought Iron→Wrought Iron. Legacy values (custom strings, primary_fence_type=NULL or 'Other') are preserved. Backfill resolved ~6 active contradictions plus ~37 NULL-product rows; snapshot in `_bak_product_drift_20260504`. EditPanel marks the `product` field as Auto (read-only) with a tooltip pointing at `primary_fence_type`. Migration: `20260504_sync_product_with_primary_fence_type.sql`.
- **Currency formatting on EditPanel money fields**: new `MoneyInput` component (in App.jsx near the SkeletonRows helpers) renders `$891,280` formatted by default, switches to raw editing on click/focus. Storage value stays a numeric string. `MONEY_FIELDS` set lists the ~16 fields that route through it (`contract_value`, `adj_contract_value`, `sales_tax_amount`, `bonds_amount`, all line-item rates, etc.). Retires the 2026-05-03 review finding that Contract & Billing tab showed `891280` while the project list showed `$891,280` for the same field.
- **Project Map clusters colored by readiness**: `clusterProperties` aggregator on the GeoJSON source counts `_is_overdue` / `_is_risk` / `_is_ready` flags per cluster. Bubble paint is now a `case` expression: any overdue → red `#DC2626`, any risk → amber `#EAB308`, all ready → green `#16A34A`, fall-through → slate `#475569` (used in 'crew' / 'market' colorMode where readiness doesn't apply). Replaces the "all clusters brand red" rendering that misled review readers into "everything Houston is overdue."

🌆 **Evening session — every remaining live-review finding closed + Tier 1 mobile + sidebar polish**

`d22707e` — **9 more live-review items at once** (P1 #4 + P1 #9 + P2 #10-16 + P3 #17 + P3 #20). Initial pass at the EditPanel 2-level tab grouping (Setup/Money/Workflow), Map loading skeleton scaffolding, status palette differentiation, and Sunday-zero stats softening on capacity tiles. (Most of these got further hardened in `87c7197` later in the session.)

`c224ee7` — **Material Calc TDZ fix** caught mid-QA-sweep. `useEffect` on line 8742 had `calcCfg` in dep array, but `calcCfg` (a `useMemo`) was declared on line 8766 — temporal dead zone. The page crashed on first render with `ReferenceError: Cannot access 'ee' before initialization` (mangled minified name). Moved `calcCfg` above the useEffect.

`81e8d4b` — **5 quick wins from final QA sweep**:
- Duplicate ADMIN sidebar group: `filteredNav` was appending a second 'ADMIN' group via `[...NAV_GROUPS, {label:'ADMIN', items:conditional}]` instead of merging. Now uses `NAV_GROUPS.map(g => g.label==='ADMIN' ? {...g, items:[...g.items, ...conditional]} : g)`. Single ADMIN section regardless of which conditional items render.
- Page header showing "Fencecrete" everywhere: `PAGE_LABELS` dict was missing 11 keys (`mold_inventory`, `weather_days`, `customer_master`, etc.) so the topbar fell back to the brand name. Expanded the dict with every NAV_GROUPS key, organized by group.
- TEST leads polluting Sales Dashboard counts: 2 leads with company_name='TEST' and NULL elsewhere. `DELETE FROM leads WHERE company_name='TEST' AND fields NULL`.
- Change Order status casing inconsistency: DB had 27 'approved' (lowercase) and 4 'Pending' (titlecase). `UPDATE INITCAP` normalize + new `fmtCOStatus()` helper + made 3 lowercase comparisons case-insensitive.
- EditPanel default tab landing on `lineitems` for existing projects (which 404'd briefly when LineItemsEditor's data hadn't loaded). Default for both new + existing is now `details` so the user always lands on something coherent.

`8457c54` — **Role-based sidebar nav** (live-review #18 + #19). `ROLE_NAV_GROUPS` dict maps role → `Set` of nav-group labels. Sidebar filters via `baseGroups.filter(g => allowedGroups.has(g.label))`. Falls open if role is missing/unknown so a profile-fetch failure can't lock anyone out. PMs see `HOME / PROJECT MANAGEMENT / CONTRACTS & PROJECTS`; sales reps see `HOME / SALES`; production sees `HOME / PRODUCTION / FLEET & EQUIPMENT`; billing sees `HOME / FINANCE / CONTRACTS & PROJECTS`. Admin sees all. Same dict shape backs `MOBILE_NAV_BY_ROLE` for the bottom-nav (Tier 1B below).

📱 **Tier 1 mobile improvements (PM workflow priority — 3 commits)**

`6901d9b` — **Tier 1B: role-driven mobile bottom nav.** `MOBILE_NAV_BY_ROLE` dict gives each role its 5 most-used items: PMs get `Dashboard / My Plate / Bill Sheet / Daily / More`; sales reps get `Dashboard / Pipeline / Proposals / Tasks / More`; etc. Hit-tap saving for PMs in the field who were previously tapping `More → PM Bill Sheet` every cycle.

`be35cd7` — **Tier 1A: camera-first photo capture on EditPanel Documents.** Dual file inputs: a hidden one with `capture="environment"` (rear camera direct on iOS), a hidden plain file picker, and two labeled buttons — 📷 Take Photo (brand red, primary action) and 📄 Upload File (white, secondary). PMs no longer detour through the Files app.

`18d4389` — **Tier 1C: PM Bill Sheet rows wrap to a card on mobile.** Was a single horizontal flex row that overflowed on `<768px`. Now `flexWrap:'wrap'` on the outer row, `flexBasis:'100%'` on the job-name span, action buttons drop to a full-width line with a dashed top-border separator. Submit / No Bill buttons hit 44px min-height on mobile (iOS HIG). iPad + desktop layouts byte-for-byte unchanged.

🧹 **`87c7197` — Final live-review cleanup pass (P1 #4 + #9 final + P2 + P3 polish)**

- **P1 #4 — Notes tab folded into Details.** Notes was a single textarea wasting a top-level tab slot. Now appended to `Details` field list. Workflow group: 4 → 3 tabs (Documents / Tasks / History). Combined with the 2-level Setup/Money/Workflow grouping from `d22707e` earlier, the EditPanel reads cleaner.
- **P1 #9 — Map blank-on-load hardened.** Skeleton now hides on Mapbox `'idle'` (tiles painted) instead of `'load'` (style ready). Added a `ResizeObserver` around the map container — Mapbox snapshots its container size at construction; in flex layouts the container can be 0px tall for a frame, then grow, leaving the canvas stuck at 0 (looks blank). Observer triggers `.resize()` on any subsequent change.
- **P2 — Production Planning + Mold Utilization labels:**
  - Mold Inventory tabs: 🪺 → 🎩 (Caps).
  - Production Planning leadership "Limited by" column: lowercased raw component names ("caps (28)") title-cased + tooltip rewritten to name the style.
  - Demand Planning weeks-to-clear pill: "CAPS MOLDS-CONSTRAINED" → "Caps molds-constrained" with explanatory tooltip. Stop shouting.

🎨 **`72dddb6` — Sidebar icons for 13 missing nav items.** The `_icons` SVG dict had drifted out of sync with NAV_GROUPS. Items rendering an empty 16x16 spacer next to their label: `my_plate`, `proposal_validator`, `proposal_triage`, `contracts_workbench`, `specialty_visits`, `demand_planning`, `crew_assignment`, `cv_reconciliation`, `admin`, `sharepoint_links`, `customer_master`, `crew_leaders_admin`, `system_events`. All new icons follow the existing 16×16 stroked-line style (stroke-width 1.5, `currentColor`) so they inherit the active/inactive sidebar color treatment automatically.

🔢 **`7137b6b` — Sidebar count alignment.** First pass (`87c7197`) split the count into `active · total`, but used a custom Set that included `fully_complete` as "active". The Dashboard's canonical `active` filter (line 4211) excludes `fully_complete` via `CLOSED_SET` because the work is done — the job's awaiting close-out. Aligned the sidebar to reuse `CLOSED_SET` so the two surfaces never drift.

**State going into 2026-05-05 (FINAL — all 20 live-review findings closed):**

| Live-review finding | Status |
|---|---|
| P0 #1 — 0/55 active install jobs had a crew leader | ✅ Bulk UI + DB gate shipped (Carlos backfills operationally) |
| P0 #2 — Billing metric mismatch | ✅ `src/shared/billing.js` single source of truth |
| P0 #3 — "325 days to 1st invoice" | ✅ Real cycle (median 268d). Relabelled, distribution shown |
| P0 #4 — "Everything is red" | ✅ Pass 1 + Pass 2; red now means action-required |
| P1 #4 — EditPanel: 12 tabs too many | ✅ 2-level Setup/Money/Workflow grouping + Notes folded into Details |
| P1 #5 — Money field formatting | ✅ MoneyInput component routes ~16 money fields |
| P1 #6 — PRODUCT vs PRIMARY TYPE | ✅ DB trigger + backfill + UI Auto badge |
| P1 #8 — Map clusters all red | ✅ Cluster bubble paint reflects readiness state |
| P1 #9 — Map blank-on-load | ✅ Skeleton + 'idle' event + ResizeObserver |
| P2 #10–16 — Production Planning + Mold labels + PM Bill Sheet alarm | ✅ Title-case labels, weekend-aware capacity tiles, missing-bill softening pre-cutoff |
| P3 #17 — Status pill differentiation | ✅ Each post-production stage gets distinct shade (`SC` / `SB_` arrays diff'd 2026-05-04) |
| P3 #18 — Role-based sidebar nav | ✅ `ROLE_NAV_GROUPS` dict |
| P3 #19 — Sidebar project count | ✅ `253 active · 1,019 total` format using same `CLOSED_SET` as Dashboard |
| P3 #20 — Sunday-zero stats | ✅ Capacity tiles say "No production scheduled — weekend" instead of 0% |
| All 13 nav items missing icons | ✅ SVG dict expanded 28 → 41 entries |

**Pickup tomorrow (2026-05-05):**

- **Operational, no engineering**: Carlos backfills crew leaders on 55 active_install jobs via the bulk UI (5 minutes of clicks).
- **Operational, no engineering**: David runs the bulk PIS pull on Customer Master to populate the 133 eligible projects.
- Live-review backlog is **fully closed** — David's review notes are retired. Next iteration of issues comes from real users hitting the live app.
- Tech-debt #11 (latent ESLint warnings ~134) is the natural next-up engineering chip, but it's mechanical cleanup, not user-facing. Defer until after a real-user pain point surfaces.
- Refactor retry-on-missing-column pattern (~1 hr) — 6 eslint-disabled fetches in production_plan_lines + production_actuals. Last bits of the H constant.
- Identity-by-email FK conversion for the remaining ~27 columns (workflow backlog #3, low priority — convert as features need them).

### Recently shipped (2026-05-03)

**Session summary (2026-05-03, FINAL — full day plus evening):** 28 commits to `main`, 5 DB migrations, 4 edge function deploys, 1 GitHub Actions workflow added. **9 tech-debt + workflow backlog items retired**, 1 long-standing data bug fixed, 1 deploy chain fixed mid-session. Major surfaces shipped or completed: full Demand Planning + Production Planning + AI Scheduler integration with `v_mold_capacity`; full PIS-extract feature (single per-project pull + bulk pull on 133 eligible projects with quality filter + audit log); CI wired for DB tests and verified green; Power Automate retired from inventory (was already disabled — docs caught up to reality); **App.jsx fetch migration Phase 2 fully complete, 113 → 0 no-restricted-syntax warnings (100% retired)**; permissions moved from hardcoded email Sets to `user_profiles.permissions` JSONB; xlsx → exceljs (closed only production high-severity vulnerability); first DB test wrote precedent for `supabase/tests/*.sql`. All builds green; CI green on every commit.

**Final closing state (`7222c7b` HEAD):**

| Tech debt | Status going into 2026-05-04 |
|---|---|
| #1 Zero CI on tests | ✅ Wired and verified green; 7 readiness-gate assertions pass on every push/PR |
| #2 Edge function source not in repo | ✅ All 25 functions in repo |
| #3 Power Automate dependency | ✅ Retired (was already disabled — docs caught up) |
| #4 App.jsx 25,000-line monolith | Ongoing chip-away; today added 2 new shared modules + landed bulk PIS in feature module not App.jsx |
| #5 npm vulnerabilities | All 14 high-severity gated on Hurricane port (CRA dev tooling); `xlsx` (only prod-path high) replaced with `exceljs` |
| #6 No API abstraction (App.jsx fetches) | ✅ 100% complete (113 → 0). 6 fetches remain with eslint-disable + justifying comments (retry-on-missing-column pattern) |
| #7 No error tracking | ✅ Sentry installed earlier this week |
| #8 No type safety | Hurricane-port-gated |
| #9 Hardcoded permissions | ✅ JSONB |
| #10 Duplicated design tokens | Substantially resolved |
| #11 Latent ESLint warnings | ~134 remaining (no-unused-vars, react-hooks/exhaustive-deps); now actually visible since the 113 fetch warnings cleared |

**Pickup tomorrow morning** (in priority order):

1. **Refactor retry-on-missing-column pattern** (~1 hr) — 6 eslint-disabled fetches in production_plan_lines + production_actuals POSTs. Replace each retry loop with try/catch around `sbPost throwOnError`, parse `e.message` for the missing column, retry with cleaned rows. Ships: 6 disabled comments → 0, retire `H` constant entirely from App.jsx.
2. **Trigger the bulk PIS pull** — operational, ~5 min of clicking. Open Customer Master → scroll to bottom → "📥 Pull PIS data for all 133 projects" → confirm. Watch the progress bar. Review the failure detail table. Logs hit `pis_extract_log` for the audit trail. This is where demand-from-the-business gets met.
3. **Latent ESLint cleanup pass** (~2-3 hrs) — 134 mostly-mechanical warnings. ~100 `no-unused-vars` (dead imports, abandoned variables — find/delete), ~10 `react-hooks/exhaustive-deps` (per-site investigation needed; some intentionally omitted to avoid loops), ~25 misc.
4. **Write more DB tests** (~1-2 hrs each) — high-value targets: `customer_name` sync trigger (the 2026-05-02 backfill behavior), `pm_user_id` / `sales_rep_user_id` identity FK sync triggers, PIS bulk extract idempotency (mock data, run twice, assert second run is a no-op).
5. **Validate AI scheduler v13 with Carlos** — operational; does it pace Rock Style at ~191 LF/day correctly? Houston backlog handled? Family pool sharing make sense?
6. **Resolve Franklin + Watermark company duplicates** — pending Matt's confirmation on whether Austin and SA jobs are the same business.

**Live verification points after this session:**
- Co-Pilot home → bottleneck-component insights fire ("Rock Style: cap molds are the binding mold constraint, 33 weeks of plant")
- Demand Planning Capacity tab → top table + MoldsWhatIf below it agree (both read v_mold_capacity)
- Production Planning leadership view → new "Limited by" column shows `caps (28)` for Rock, `rails (6)` for Ledgestone, etc.
- Click "Generate AI Schedule" → next schedule respects per-style daily limits + family pool sharing
- Demand Co-Pilot Q&A → cites bottleneck component when discussing capacity
- New plan line → click "📅 Split across days" → segments created on subsequent working days, tied by `run_id`
- Sign in as anyone → permissions read from `user_profiles.permissions` JSONB (not the deleted hardcoded sets)

**Evening additions (2026-05-03 ~6pm onward):**
- **PIS extract feature complete — single + bulk** [`35e32fb`, `79e0e01`]. Edge function `pis-extract-from-sharepoint` v1→v4 (filename heuristic broadened: matches PIS-alone OR ≥2 of {project, info|information, sheet}); Parties tab "Pull from SharePoint PIS file" button with preview/confirm modal; Customer Master Bulk Operations card running 133 eligible projects in parallel batches of 5 with quality filter (strips "Same as Owner", template placeholders, short values) + idempotent merge (only writes empty fields) + new `pis_extract_log` audit table. Migration: `20260503_project_info_sheets_add_engineer_fields.sql` (engineer_*) + `20260503_pis_extract_log.sql`.
- **CI wired for DB tests** [`10ffacd`]. `.github/workflows/db-tests.yml` runs every `supabase/tests/*.sql` against the production Supabase DB via the Management API on push + PR + manual dispatch. BEGIN/ROLLBACK keeps it safe. Failures gate merges. Required secrets `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` configured by David same evening; first run green with all 7 readiness-gate assertions passing (run `25292455965`). Tech debt #1 advanced from "pattern set" to "wired and proven."
- **Power Automate retired in docs** [`be6dbcf`]. Investigation revealed all three `Bill Sheet Notification-{Austin/SA/Dallas}` flows already disabled — bill-sheet submission moved into the OPS web app. Virginia views submissions on the Billing page (pull-based) instead of email-per-event. Doc rewritten as a retirement record; tech debt #3 marked ✅. Edge function `bill-sheet-submitted-notification` v15→v16: renamed `AR_EMAILS` → `LEADERSHIP_NOTIFY_EMAILS` to remove the misleading suggestion that AR is on the recipient list.
- **App.jsx fetch migration Phase 2A + 2B + 2C** [`1f9b6d6`, `ae3f2d2`, `bf8af3a`]. Phase 2A foundation: replaced 4 local `sbGet/sbPatch/sbPost/sbDel` wrappers with imports from `shared/sb.js`; added `sbAuth*` namespace covering 6 GoTrue endpoints; migrated 6 auth functions + 23 functions/v1 fetches → `sbFn` (33 retired). Phase 2B: migrated 5 storage/v1 fetches → `sbStorage*` helpers (5 retired). Phase 2C: migrated remaining 75 inline rest/v1 fetches by pattern (DELETEs/PATCHes/POSTs/UPSERTs/RPC) plus added `sbCount(t,q)` helper. **113 → 0 no-restricted-syntax warnings (100% retired)**. App.jsx -200 lines net (manual error handling collapsed into helpers). 6 fetches remain with `eslint-disable` comments + justifying citations of the retry-on-missing-column pattern that needs response.text() inspection; H constant kept for those callers.
- **Misc bug fix** [`dd9fad4`]. `no-dupe-keys` regression in App.jsx L18210 (lead pipeline card had `transition` declared twice; second value was already winning so visual behavior unchanged, but it tripped ESLint).

**By theme:**

🔴 **Tech debt — 8 backlog items retired or substantially advanced**
- **Tech debt #9 (hardcoded permissions → JSONB) ✅ retired** [`b5dbad9`]. 8 email Sets in App.jsx (`EDIT_EMAILS`, `STATUS_EDIT_EMAILS`, `REOPEN_EMAILS`, `INSTALL_DATE_EDIT_EMAILS`, `WORKBENCH_VIEW_EMAILS`, `AMIEE_EMAILS`, `SYSTEM_ADMIN_EMAILS`, `PLANT_EDIT_EMAILS`) replaced with `user_profiles.permissions` JSONB. Adding/removing a permission is now a SQL UPDATE; no app deploy. Backfill: 5/8/6/19/11/2/2/8 across the 8 keys (totals match expected exactly; "contracts@" routing alias correctly absent). Pre-created profile rows for Mike Martin (production role, fleet+supply chain) and Mike Dean (sales_rep, pending first SSO). `src/shared/permissions.js` is the new helper module. Migration: `20260503_user_permissions_jsonb.sql`.
- **Tech debt #6 Phase 1 (sb.js as single Supabase entry) ✅ done; Phase 2 open** [`1f78b17`, `c0c3991`]. `src/shared/sb.js` extended with 10 new helpers (`sbGetOne`, `sbPatchWhere`, `sbDelWhere`, `sbUpsert`, `sbRpc`, `sbStorageUpload`, `sbStorageDelete`, `sbStorageSign`, `sbFn`). 15 violations migrated in CustomerMasterPage / ContractsWorkbenchPage / shared/systemEvents.js. ESLint `no-restricted-syntax` rule installed; errors on direct `fetch(\`${SB}/...\`)` outside sb.js. App.jsx grandfathered as warn-only (108 warnings = Phase 2 work-in-progress markers). **Side discovery**: adding `eslintConfig` activated CI strictness which broke Vercel deploys via 3 failed builds; fixed with a `node build.js` wrapper that sets `CI=false` (warnings stay visible in build logs but don't gate deploys).
- **Tech debt #10 (duplicated design tokens) ✅ substantially retired** [`19e17a5`, `cd00887`]. `src/shared/ui.js` exports `COLOR`/`FONT`/`RADIUS`/`SHADOW` tokens + canonical style objects (`card`, `btnP`, `btnPL`, `btnS`, `btnG`, `btnB`, `inputS`, `stat`, `statLabel`, `statValue`). Migrated: CustomerMasterPage, ContractsWorkbenchPage, SpecialtyVisitsPage, CVReconciliationPage, SharePointLinksPage, SystemEventsPage. Still local: App.jsx module-scope (older 8/16px shape), MyPlatePage card (table-wrapper variant), PISFormPage (external portal styling), small-button + full-width-input variants used by 2-3 callers each.
- **Tech debt #11 (NEW — latent ESLint warnings) — documented for incremental cleanup** [`c0c3991`]. ~37 pre-existing across the codebase (no-unused-vars, react-hooks/exhaustive-deps, 1 no-useless-escape, 1 no-dupe-keys) plus 108 `no-restricted-syntax` Phase-2 markers in App.jsx. Audit cmd: `CI=true npm run build 2>&1 | grep 'Line '`.
- **16 pre-existing no-undef references in App.jsx ✅ retired** [`a14a711`]. Four code paths had references to variables never in scope, shipping silently because surrounding control flow kept them from executing (or React ErrorBoundary swallowed the crashes). Fixed: dead `<JobDiagnostic jobId={job.id}/>` in NewProjectForm; broken Contract Breakdown block in ProductionPage's prodBillModal (referenced undefined `arCOs`); missing `useAuth()` in PipelinePage's `saveProposal` plus `auth?.profile?.name` typo → `full_name`; missing `pipelineForecast` useMemo in SalesDashboardPage. **Side effect, important**: PipelinePage's validator-bypass gate is **now actually functional** — the missing `auth` ref was triggering a swallowed ReferenceError, so the dialog never appeared and reps could promote leads to `proposal_sent` without challenge. Bypass logging will start populating `proposal_validations` with rep names from now on.

🏭 **Demand planning + production planning + AI scheduler integration**
- **Install rate corrected: precast 100 → 50 LF/day per 4-person crew** [`0496344`]. `install_rates.precast.lf_per_day` was wrong by 2× — assumed an aggregate of multiple crews / experienced-team rate. Per David ground truth: 1 W-2 leader + 3 helpers = 4 people = 50 LF/day. Added explicit `people_per_crew` (4), `lead_per_crew` (1), `lf_per_day_per_crew` columns to `install_rates` so the per-crew vs aggregate ambiguity that caused the bug can't recur. Migration: `20260503_install_rates_real_precast_rate_with_crew_composition.sql`. Existing jobs' `install_duration_days` stays as-is (Option A); new contracts get realistic 2× duration estimates from now on.
- **Two-shift plant model codified** [`6f9a718`]. `install_rates.shifts_per_day INT DEFAULT 2`. Plant operating reality: Shift 1 Mon–Sat 8a–4p + Shift 2 Mon–Fri 6p–2a = 88h/wk plant coverage vs 168h theoretical. App.jsx derate factor was wrong: `(8/24)*(5/7)=0.238` (single shift × 5 days). Fixed to `88/168 ≈ 0.524`, expressed as `PLANT_HOURS_PER_WEEK` constant. Updated stale "single shift" labels in MoldsTab + plant-load detail. Realized capacity numbers in Capacity tab roughly double from the prior display. Migration: `20260503_install_rates_add_shifts_per_day.sql`.
- **CoPilotHome wired to v_mold_capacity (bug fix + enrichment)** [`0496344`]. Existing `plantLoad` math in CoPilotHome was reading non-existent `mold_inventory.style_alias` / `panel_mold_count` fields, so `weeks_to_clear` was always null and the mold-constrained insight never fired. Now reads `v_mold_capacity` which honors 12-cavity gang molds, family-shared mold pools, and the binding component (panels/posts/rails/caps). New per-style bottleneck-component insight names the SPECIFIC mold to acquire — so the recurring "should we hire or buy" conversation gets specific. With current backlog this fires on: 🏭 Rock Style: cap molds are the binding constraint (33 weeks of plant); 🏭 Used Brick: cap molds (10 weeks); 🏭 Split Face CMU: cap molds (9 weeks); 👷 Vertical Wood 6': crews are binding (1.9 weeks of plant vs ~16 weeks of crew).
- **MoldsWhatIf simulator on Demand Planning Capacity tab** [`6f9a718`]. Per-style sliders for panel/post/rail/cap molds with live recompute of `weeks_to_clear` AND crew-vs-plant binding-constraint flip detection. Mirrors `v_mold_capacity`'s formula 1:1 (`(molds + Δ) × 12 cavities × 24/cure_time_hours`, then `LEAST(panels, posts, rails, caps) × panel_lf × shift_factor`). Includes editable per-component cost placeholders ($25k panel / $5k post / $3k rail / $1.5k cap) — David/Carlos to tune. Pure client-side, no DB writes.
- **HiringWhatIf math made honest** [`6f9a718`]. Recomputes weeks-per-leader from `active_lf / (leaders × 50 × 5)` instead of summing already-stored `install_duration_days` (which mixed old 100 LF/day estimates with new 50 LF/day estimates). Adds "Leaders → People (×4)" column showing market headcount totals.
- **Multi-day partial production runs** [`6f9a718`]. New `production_plan_lines.run_id` UUID + `run_total_panels` + `run_segment_seq` columns (optional, null = single-segment). `SplitAcrossDaysWidget` on saved plan lines: click 📅 Split across days → segments distributed across N consecutive working days (skips weekends), evenly proportional with remainder to last segment. Future segments get auto-created `production_plans` rows. Already-split lines show 🔗 Segment X badge. Migration: `20260503_production_plan_lines_add_run_grouping.sql`. Future v2: cross-segment progress view (`Run X of N — Y/Z panels (P%)`) by joining `production_actuals.plan_line_id` → `run_id`. Schema supports it now.
- **EditPanel implied-rate warning** [`0496344`]. NewProjectForm Schedule tab warns `⚠ above 50 default` when implied LF/day > 75 for precast. Catches sales reps committing aggressive install dates that imply multiple crews on one job.
- **demand-copilot edge function v2** [`0496344`]. System prompt rewritten with crew composition (1 lead + 3 helpers = 4 ppl), 12-cavity gang molds, per-component bottleneck framing, install-vs-production race math. Snapshot now carries `bottleneck_component` + `bottleneck_lf_per_day` per style. LLM stops saying "plenty of capacity" without naming the binding constraint.
- **AI Production Scheduler v13 — full integration with v_mold_capacity** [`0a67c4a`]. Was the most stale piece (last regen Apr 29 used hardcoded "5,000 LF/weekday flat"). Edge function `production-scheduler` now receives per-style `styleCapacity[]` arrays + per-pool `poolCapacity[]` arrays in body. Prompt rewritten with: 12-cavity gang mold facts, mold-pool sharing rules (Wood + Boxed Wood + Vertical Wood share one 26-mold pool), install-vs-production race check (50 LF/day × 26 leaders = 6,500 LF/wk). Drops hardcoded Saturday 2,500 LF cap (per-style limits supersede). App.jsx scheduler caller fetches v_mold_capacity + active crew_leaders count and passes them in body. Drops dead duplicated systemPrompt/userPrompt blocks (edge function builds prompt from input; client copies were never sent). Model bumped `claude-sonnet-4-20250514` → `claude-sonnet-4-5`.
- **DemandPlanningPage self-consistency fix** [`0a67c4a`]. Top "Production Backlog by Style" table now reads v_mold_capacity (matches MoldsWhatIf below it on the same page). Was using the legacy `molds × FT_PER_PANEL × TURNS_PER_WEEK` formula. "MOLD-CONSTRAINED" badge now names the actual binding component (e.g. "CAPS MOLDS-CONSTRAINED" for Rock).
- **Production Planning leadership table integration** [`0a67c4a`]. New "Limited by" column shows the binding mold component per style (panels / posts / rails / caps) with count. Computed from `v_style_capacity_lookup` already loaded by the page — no new fetch. Bridges daily-run capacity (`MOLD_UTIL_RATE × molds`, kept) and horizon-capacity (`v_mold_capacity`). Max sees in one table that he has enough panel molds to run today AND that the week's output is capped on caps.
- **Two capacity models documented in CLAUDE.md** [`0a67c4a`]. Daily-run capacity (`molds × panels_per_mold × 0.88` — answers "can today's plan fit?") vs horizon weeks-to-clear (`LEAST(panels, posts, rails, caps) × 24/cure_time × 0.524 × 5` — answers "how many weeks at the binding constraint?"). Both correct, different questions. Documented to avoid relitigating.

🛠 **Operational fixes**
- **Vercel deploy chain unblocked** [`c0c3991`]. After commit `1f78b17` added `eslintConfig`, Vercel's `CI=true` escalated all ESLint warnings to errors. Three deploys failed in a row. Fix: `node build.js` wrapper sets `process.env.CI = 'false'` before spawning `react-scripts build`. Cross-platform (Vercel Linux + Windows local). Warnings stay visible in build logs but don't gate deploys. The ~37 latent warnings + 108 `no-restricted-syntax` Phase-2 markers documented as Tech debt #11 for incremental cleanup.

**State after this session:**
- Permissions live in JSONB on user_profiles. App.jsx no longer hardcodes the email allowlists.
- 5 of 5 surfaces (Demand Planning, Co-Pilot home, AI scheduler, Production Planning leadership, Demand Co-Pilot Q&A) read v_mold_capacity for horizon planning. Numbers agree across pages.
- `install_rates.precast.lf_per_day = 50` (was 100). `shifts_per_day = 2` codified.
- Production planning supports multi-day partial runs via `run_id` grouping.
- 9 commits today: `19e17a5`..`0a67c4a`. All live.

### Recently shipped (2026-05-02)

**Session summary (2026-05-02, complete):** 9 commits to `main`, all live. Two reviews completed: a code/security/perf review (8 findings) and a workflow & data architecture review (8 findings). 6 of 8 items from the second review retired or partial. **3 of 4 HIGH-priority issues from the code review fully resolved.** App.jsx is 32 lines smaller (24,923 → 24,891) — small bite out of the monolith via two new shared modules (`src/shared/readiness.js`, `src/shared/upload.js`). Database state: 4 new migrations applied + checked into `supabase/migrations/`; performance advisor went from 343 findings → ~50; 0 multi-permissive-policy warnings; 0 auth_rls_initplan warnings; 0 customer_name drift; 21 contract_review jobs newly hard-blocked by the gate (visible on Co-Pilot home). **Pickup tomorrow: #7 (ID conventions polish, ~30 min) or #3 (identity-by-email FK conversion, ~2-3 hours, deserves its own session).** Pending external: Matt's confirmation on Franklin and Watermark company dups.

- **Customer-linked contract gate fixed.** `v_contract_readiness.auto_checks.customer_linked` now checks `company_id IS NOT NULL OR is_residential = TRUE` (previously only checked the free-text `customer_name` string, which never failed). 21 contract_review jobs newly blocked from advancing status until reconciled in Customer Master. Migration: `20260502_fix_customer_linked_gate.sql`. UI label updated to "Linked to company".
- **Documents tab: HEIC support, paste-to-upload, inline thumbnails.** iOS HEIC photos auto-convert to JPEG client-side via `heic2any` (~338 KB lazy chunk, only loads when a HEIC is actually picked — main bundle unchanged). Cmd/Ctrl+V on the Documents tab uploads pasted screenshots/images. Image rows render small thumbnails (signed URLs, 5-min expiry — refresh the tab if they go stale). No edge function — all client-side. Touched: `src/App.jsx` around line 1770 (loadAttachments thumbnail augmentation) and 1958 (handleFiles HEIC interception + paste listener).
- **Readiness-gate trigger no longer fails open.** `enforce_contract_readiness()` previously caught any view-read exception with `v_ready := true; -- fail open`, silently letting status moves through on internal errors. Now: failures are logged to `system_events` (`event_type='readiness_gate_internal_error'` with sqlstate/sqlerrm/job/attempted_status payload) and the trigger raises a distinct `internal_error` ERRCODE. Normal user-facing "checklist incomplete" path is byte-for-byte identical. Migration: `20260502_fix_readiness_trigger_fail_open.sql`. To audit any internal-error events going forward: `SELECT * FROM system_events WHERE event_type='readiness_gate_internal_error' ORDER BY created_at DESC;`
- **RLS cleanup: dropped 60 redundant permissive policies across 35 tables.** Pattern was layered legacy policies (`"auth read"`, `"auth write"`, etc.) sitting alongside the canonical `"public access" FOR ALL USING(true) WITH CHECK(true)`. RLS OR-evaluates permissive policies, so the redundant ones were dead weight evaluated on every query. Performance advisor: 270 `multiple_permissive_policies` → 0; 26 `auth_rls_initplan` → 2 (24 of those were `auth.role()='authenticated'` checks inside the dropped policies). Total perf findings 343 → ~50. Migration: `20260502_drop_redundant_rls_policies.sql`. Any new table going forward should follow ONLY the canonical pattern — no extra "auth read"/"auth write" policies needed; the canonical permits everything.
- **Retired `job_documents` (dead parallel checklist system).** It was a checklist tracker (not a file store) that auto-populated 6 pending rows per job via `trg auto_create_job_checklist` on every `jobs` INSERT — 1,788 rows total, all `pending`, never read or updated. The OPS app uses `contract_readiness_items` / `v_contract_readiness` for the same purpose. Trigger dropped, table renamed to `legacy_job_documents` (slated for `DROP TABLE` after 2026-06-02 if no consumer surfaces). The `create_job_checklist()` function is left in place; will drop with the table. Migration: `20260502_retire_legacy_job_documents.sql`.
- **Co-Pilot home: blocked-contracts surface + shared readiness module.** New top-level insight on Co-Pilot home: `🚧 N contracts blocked from advancing to production_queue` with the top 3 blocker reasons (using human-readable labels) and a CTA to Contracts Workbench. Closes the discovery loop on the readiness gate — Amiee no longer has to open the Workbench to find out that a contract is blocked. Also extracted `src/shared/readiness.js` as the single source of truth for `AUTO_LABELS` / `MANUAL_ITEMS`; previously duplicated in `ContractsWorkbenchPage.jsx`, EditPanel readiness card (App.jsx), and now Co-Pilot. Retires backlog item #8.
- **`jobs.customer_name` now hard-synced to `companies.name`.** Triggers `trg_sync_customer_name_bi` (jobs INSERT), `trg_sync_customer_name_bu` (jobs UPDATE OF company_id, customer_name), and `trg_propagate_company_name_au` (companies UPDATE OF name) keep them in lockstep. Backfill resolved 42 drifted rows (the count grew from the 40 in the review snapshot to 42 by apply time — a few writes in the interval). Real drift fixed included typos ("AHV Communites" → "AHV Communities"), abbreviation variants ("Lift Station" → "LS"), and punctuation differences. Pre-migration snapshot preserved as `public._bak_customer_name_drift_20260502` (42 rows) — drop it after a few weeks if no recovery needed. **Future implication:** if you ever need a per-job customer-name variant, add a separate column — manual edits to `customer_name` on linked jobs will be reverted by the trigger. Migration: `20260502_sync_customer_name_with_company.sql`. Retires backlog item #2.
- **Merged Peltier Brothers Construction duplicate (1 of 3 suspected dups resolved).** The 2026-03-29 bulk import created two rows for Peltier; one had 0 dependents across all 6 FK tables (jobs, contacts, deals, proposals, tasks, company_attachments) — a stale empty placeholder. Deleted via `20260502_merge_peltier_dup.sql`. Companies: 142 → 141. Franklin and Watermark pairs **deliberately not touched** — their jobs span different markets (Austin vs San Antonio for Franklin; DFW vs Austin for Watermark) and there's no second data point (address/phone/website all NULL) to disambiguate same-business-two-markets vs. distinct-businesses. Pending confirmation from Matt before merging or splitting. Unique normalized-name index also deferred until those pairs are resolved.
- **Shared upload utility module + HEIC support in PM Daily Report.** Extracted `convertHeicIfNeeded` and a new `usePasteUpload` React hook into `src/shared/upload.js` (single source of truth for client-side upload pre-processing). EditPanel Documents tab now imports from there; PMReportPhotos (PM Daily Report) gets HEIC→JPEG conversion on its existing `Promise.all(uploadPhoto(...))` path. PMs uploading field photos from iPhones (HEIC default) now get usable JPEGs that render anywhere. App.jsx shrank by 32 lines net (small bite out of the monolith). Bundle: main +20 B; heic2any lazy chunk unchanged. Retires backlog item #5.
- **Map quick-wins bundle (Project Map / `MapPage`).** Six low-risk improvements from the Mapbox best-practices review: (1) honor `prefers-reduced-motion` on all `flyTo` / `fitBounds` calls (3 sites), (2) honor `prefers-color-scheme: dark` on initial map load — picks `mapbox://styles/mapbox/dark-v11` vs `light-v11` and swaps pin border color (`#FFFFFF` vs `#1A1A1A`) to match, (3) deleted the diagnostic `[PIN] mouseenter/mouseleave` console.logs left over from the marker-flicker debugging, (4) added `mapboxgl.GeolocateControl` ("find my location" — useful for PMs in the field), (5) added `mapboxgl.ScaleControl` (distance bar in imperial), (6) extended the readiness legend with a "Complete / other" gray entry (only when `fence_complete` layer is on) AND added the previously-missing legend block for `colorMode='market'` (used `MKT_PIN` keys/colors). Foundation for the bigger DOM-markers→layer migration deferred to a dedicated session. Known limitation: dark-mode swap is initial-load only; OS theme changes mid-session don't auto-swap (would require `setStyle()` + re-adding all custom layers). Cluster-layer text/halo aren't theme-aware in dark mode but the white halo provides legibility.
- **Map accessibility (Project Map / `MapPage`).** Added `role="region"` + `aria-label` + `tabIndex={0}` to the map container so keyboard users can focus the map and use Mapbox's built-in arrow-key pan and `+`/`-` zoom. Added `role="region"` + dynamic `aria-label` + `aria-live="polite"` to the right side panel so screen readers announce when a different job is selected. No focus-stealing on click (would be intrusive for mouse users); screen reader users get the announcement via the live region. Retires backlog item #8 from the Mapbox review. Remaining map work for tomorrow: #1 (DOM markers → GeoJSON layer with data-driven `match` expressions), then #2/#3/#4 fold in cleanly.
- **Map: DOM markers → GeoJSON layer (Mapbox #1, #3, #4 in one).** Replaced the per-job DOM marker rendering (one `<div>` + listeners per job, full rebuild on every filter toggle) with a single GeoJSON source + three layers (`jobs-pins` visible circles, `jobs-hit` 18px transparent hit-area for finger-friendly tap, `jobs-selected` red halo). Color is precomputed on each feature as `_color` and consumed via `['get', '_color']` paint expression — handles status/crew/market modes uniformly without complex Mapbox match expressions for the hsl-hashed crew colors. Filter changes call `getSource('jobs').setData(...)` instead of removing+rebuilding markers — no DOM churn. Selection updates via `setFilter` on the halo layer. Eliminated the marker-flicker bug class permanently — no DOM elements to fight with, so the `!important visibility/opacity` defenses are gone. App.jsx -32 lines net (delete 60 + replace 60 with denser layer code). Retires Mapbox review items #1, #3 (`setFilter`), and #4 (hit targets) in one commit.
- **Map: native clustering (Mapbox #2).** Added `cluster: true` to the `jobs` GeoJSON source (`clusterRadius: 50`, `clusterMaxZoom: 12`). Existing pin layers got `filter: ['!', ['has', 'point_count']]` so they only render unclustered features. Two new layers handle clusters: `jobs-clusters-bubble` (brand-red circle, step-sized by `point_count` — 18px base / 24px at 10+ / 32px at 30+) and `jobs-clusters-count` (white text label inside bubble showing `point_count_abbreviated`). Click on a cluster calls `getClusterExpansionZoom` and eases to the zoom where the cluster breaks apart. Eliminates the Houston pin pile at low zoom — when you open the map you now see "42" over Houston instead of dozens of overlapping red dots. The existing JS-computed "Show Clusters" analytical overlay is unaffected and still works (different purpose: it shows total_lf + $k aggregates while staying visible at all zooms; native clustering is purely visual density management). All Mapbox best-practice quick wins now retired (#1-#11). Bundle: main +208 B.
- **Identity-by-email FK conversion (top 3 columns).** Added real UUID FK columns alongside existing text columns and backfilled from `user_profiles.full_name` matches. **Three new columns:** `jobs.pm_user_id`, `jobs.sales_rep_user_id`, `pm_daily_reports.submitted_by_user_id` — all `UUID REFERENCES user_profiles(id) ON DELETE SET NULL`, partial-indexed `WHERE col IS NOT NULL`. **Backfill outcome:** 298/298 jobs.pm matched, 297/298 sales_rep ("Alexis" — 1 row, no user_profile), 52/53 submitted_by ("Hugo Rodriguez" — 1 row, no user_profile yet). **Two sync triggers** (`trg_sync_jobs_user_fks`, `trg_sync_pm_daily_reports_submitted_by_fk`) BEFORE INSERT/UPDATE OF the text columns — keep the FK in lockstep automatically; **zero app changes required**. Verified: change `jobs.pm` from "Doug Monroe" to "Ray Garcia" → `pm_user_id` auto-updated to Ray's UUID; restore → auto-updates back. **Note**: `pm_daily_reports.pm_name` (originally targeted by the audit) was empty in all 53 rows — actual identity lives in `submitted_by`. Migration: `20260503_add_user_fk_columns.sql`. **Future implications:** (a) "Show my jobs" filter can use `WHERE pm_user_id = $1` (faster, more correct than name match); (b) renaming a person updates `user_profiles.full_name` and propagates to jobs automatically (no cross-cutting find-replace); (c) tech-debt #9 (hardcoded permissions in App.jsx) is now unblocked — can replace `EDIT_EMAILS` set with a `permissions` JSONB column or join table; (d) text columns NOT dropped — 90-day dual-write window before deprecation. Retires workflow & data architecture backlog #3.
- **First test in repo: readiness gate (`supabase/tests/readiness_gate.sql`).** Sets the precedent for DB-side tests. **7 assertions covering:** (1A/1B/1C) the `customer_linked` auto-check across all 3 cases — `company_id` NULL + not residential → false, `company_id` set → true, `is_residential` TRUE → true (regression target: `20260502_fix_customer_linked_gate.sql`); (2) `enforce_contract_readiness` trigger raises `check_violation` when status moves out of `contract_review` while `is_ready=false`; (3A/3B/3C) static check on the trigger function source — has `v_view_failed` variable, emits `readiness_gate_internal_error` to system_events, no `-- fail open` comment (regression target: `20260502_fix_readiness_trigger_fail_open.sql`). **All 7 PASS** as of 2026-05-03. **Pattern**: BEGIN/ROLLBACK wrapper makes tests safe to run on the production DB; assertions via `RAISE EXCEPTION` (fail aborts the run); each pass `INSERT`s into a `_test_results` TEMP table and the final SELECT returns the rowset to the caller. **Not yet wired to CI** — runs manually via Supabase MCP `execute_sql` or `supabase db remote query --file`. CI workflow (GitHub Actions) is a separate, larger setup. New tests slot into `supabase/tests/<name>.sql` following the same template; see `supabase/tests/readme.md`. Retires the precedent-setting half of tech-debt #1.

### Known data hygiene issues (don't bulk-fix without explicit approval)
- 178 jobs have `contract_executed=false` (flag never backfilled) — silent SQL backfill OK
- 38 jobs have `last_billed` set but `ytd_invoiced=0` — case-by-case with Jalen
- 8 jobs billed but status is pre-install — case-by-case
- ~20 jobs with adj_contract_value gaps — case-by-case with Alex/Jalen
- Emberly 25H046 has $14k phantom in `jobs.ytd_invoiced` not traceable to `invoice_entries` — needs Jalen review

### Pending fixes/decisions
- Mike Dean (mdean@fencecrete.com, Dallas sales rep) needs first-time SSO login to auto-create user_profiles row
- 6 active jobs overbilled by $1.03M total (Elyson 24H052 alone is $799k) — Alex/Jalen Monday review
- The Trails Ph 2A (25H065) actively billing $169k but `contract_executed=false` — Laura confirms
- 25 contract_review jobs blocked on missing style/color (sales rep data hygiene)
- 17 contract_review jobs blocked on line-items mismatch — Amiee/Laura sprint
- 55 active-install jobs missing `crew_leader_id` — Carlos backfill
- `notification_kill_switch` for `billing_aging` paused since Apr 28 — decide whether to re-enable

### Workflow & data architecture backlog (2026-05-02 review)
Findings from the 2026-05-02 architecture review. Ordered by impact, not sequence.

🔴 **HIGH**
1. ~~**Document-store fragmentation.**~~ ✅ Resolved 2026-05-02: `job_documents` was a dead checklist system (not a file store), retired via `20260502_retire_legacy_job_documents.sql`. The "1,788 rows" turned out to be 6 auto-generated `pending` rows × 298 jobs from a forgotten trigger. The actual canonical Documents tab is `project_attachments` and that's the only file store now.
2. ~~**`jobs.customer_name` drifts from `companies.name`**~~ ✅ Resolved 2026-05-02: hard-sync triggers in both directions + 42-row backfill via `20260502_sync_customer_name_with_company.sql`. Drift count is now 0; future linked-job edits to `customer_name` are auto-reverted.
3. ~~**Identity-by-email-text** across 30+ columns~~ ✅ Top 3 columns resolved 2026-05-03: `jobs.pm_user_id`, `jobs.sales_rep_user_id`, `pm_daily_reports.submitted_by_user_id` added as real UUID FKs to `user_profiles`. Backfill matched 647 of 649 rows (2 misses: "Alexis" sales_rep + "Hugo Rodriguez" submitted_by — neither has a user_profile yet). Sync triggers keep FK in lockstep with text columns; zero app changes needed. Migration: `20260503_add_user_fk_columns.sql`. **Remaining identity-by-email columns** (~27 across the schema) are lower-priority — convert opportunistically as features need them. Tech-debt #9 (hardcoded permissions sets) is now unblocked.
4. ~~**No discovery path for blocked contract advances.**~~ ✅ Resolved 2026-05-02: Co-Pilot home now surfaces a top-level `🚧 N contracts blocked` card with top blockers + CTA to Contracts Workbench. Server-side rejection logging (Part B in the plan) was deferred — App.jsx has 8+ status-update call sites with no central handler, so it's a refactor pass not a small change.

🟡 **MEDIUM**
5. ~~**PM Daily Report** has its own upload path with no HEIC/paste support.~~ ✅ Resolved 2026-05-02: extracted `convertHeicIfNeeded` + `usePasteUpload` hook to `src/shared/upload.js`; wired HEIC conversion into PMReportPhotos. Paste support not added there (PMs are on phones; paste-from-clipboard is a desktop flow). Hook is available for any future surface.
6. **`companies` dedup risk** — 1 of 3 resolved 2026-05-02 (Peltier merged via `20260502_merge_peltier_dup.sql`; clean orphan delete, 0 dependents). **Franklin** (Austin vs San Antonio jobs) and **Watermark** (DFW vs Austin jobs) need Matt's confirmation — could be one company in two markets OR two distinct companies; addresses are all NULL so data alone can't tell. Decision items for Matt: (a) Is "Franklin Construction LTD" (AUS) the same business as "Franklin Construction, Ltd" (SA)? (b) Is "Watermark Commercial Contractors" (DFW) the same as "Watermark Commercial Contractors, LLC" (AUS)? After resolution, add unique normalized-name index as a ratchet to prevent new dupes.
7. ~~**Two ID conventions on `jobs`**~~ ✅ Resolved 2026-05-02: `src/shared/jobs.js` exports `resolveJobId(input)` (handles UUID strings, job_number strings, and job-shaped objects) plus `isUuid(str)` for the sync case. Convention documented under "Critical Patterns You Must Know" → "Two ID conventions on jobs". The PIS send flow now uses it (`src/App.jsx` around line 2018). Structural follow-up (some child tables still FK by `job_number` text, not `job_id` UUID) noted in the pattern doc as separate work.
8. ~~**Readiness UI duplicated** across Workbench + EditPanel.~~ ✅ Resolved 2026-05-02: `src/shared/readiness.js` is now the single source of truth (`AUTO_LABELS`, `MANUAL_ITEMS`, `MANUAL_LABELS`, `REQUIRED_MANUAL`). Imported by Workbench, EditPanel readiness card, and CoPilotHome blocked-contracts insight. The pattern is now established for future shared-module extractions (STATUS_LABELS, STATUS_COLORS, etc., when needed).

**Architecture confirmed solid (no action needed):** Phase 3 doc fan-out is properly wired in BOTH directions — `trg_jobs_auto_attach_company_docs_ai` (jobs INSERT) AND `trg_jobs_auto_attach_company_docs_au` (jobs UPDATE when company_id changes). Zero adoption today is purely because no docs uploaded yet, not a plumbing gap.

### Tech debt backlog (2026-05-02 audit)
Findings from the 2026-05-02 tech debt audit. Some overlap with the workflow backlog above by nature; ordered by impact, not sequence.

🔴 **CRITICAL**
1. **Zero automated tests** ⚠️ further resolved 2026-05-03 (later in same day): CI now wired. `.github/workflows/db-tests.yml` runs every `supabase/tests/*.sql` against the production Supabase DB via the Management API on every push to main + every PR + manual dispatch. Tests are BEGIN/ROLLBACK wrapped so production data is never mutated. New test files are auto-discovered (glob — no workflow edit needed when adding). Failure of any assertion → `RAISE EXCEPTION` → 4xx → workflow fails → PR check turns red. **Still TODO**: more tests covering other high-risk surfaces (customer_name sync trigger, identity FK sync trigger, PIS bulk extract idempotency, frontend logic). Pattern is ready for new tests to slot in (`supabase/tests/<name>.sql`); see `supabase/tests/readme.md`. **Required secrets** (one-time setup, status: pending until David adds them): `SUPABASE_ACCESS_TOKEN` (PAT from https://supabase.com/dashboard/account/tokens), `SUPABASE_PROJECT_REF` (`bdnwjokehfxudheshmmj`). Until those secrets are added, the workflow fails fast with a clear error message pointing at the Settings UI.
2. ~~**Edge function source not in repo**~~ ✅ Resolved 2026-05-02: pulled all 23 missing edge functions via Supabase MCP `get_edge_function` and committed to `supabase/functions/`. Also refreshed `chat-assistant` from deployed v19 (repo had drifted). All 25 deployed functions are now version-controlled. Secret scrub on every pulled file (grep for `sk_*`, `re_*`, `eyJ*`, `AIza*`, `ghp_*`, `-----BEGIN ... KEY-----`, `password=`, `api_key=`) returned **zero hits** — every function uses `Deno.env.get()` correctly. Two follow-ups now reviewable in repo: (a) `bill-sheet-submitted-notification` v15 has the documented "500 on OPTIONS" bug (the OPTIONS handler looks correct on inspection — needs runtime repro to confirm); (b) `dispatch_system_event` v16 is in repo but the deployed source was too large to diff against in this session; if a v17 PIS-path fix is still pending, that's where it lives.
3. ~~**Power Automate single point of failure for billing notifications.**~~ ✅ Retired 2026-05-03. Investigation revealed the three Power Automate flows (`Bill Sheet Notification-Austin/SA/Dallas`) were already disabled — bill-sheet submission moved into the OPS web app. Virginia (AR) views submissions via the OPS **Billing page** (pull-based) instead of email-per-event (push-based); cleaner UX than the prior model and the reason no Houston flow ever existed. The `bill-sheet-submitted-notification` edge function continues to email leadership (David + Carlos) on submission — leadership heads-up, NOT AR routing. Cleanup: renamed the misleading `AR_EMAILS` variable to `LEADERSHIP_NOTIFY_EMAILS` to remove the implication that AR is on the list. `docs/automations.md` rewritten as a retirement record. Operational follow-up (David, no engineering): delete the three disabled flows from the Power Automate UI when convenient — visual debris only.

🟠 **HIGH**
4. **App.jsx 24,891-line monolith** — same item as workflow backlog #3; ongoing incremental extraction.
5. **npm vulnerabilities — triaged 2026-05-02, xlsx replaced 2026-05-03.** Current count: 29 (14 high, 6 moderate, 9 low). The breakdown:
   - **14 of 14 high-severity in build/dev tooling only** — `@svgr/*`, `workbox-*`, `webpack-dev-server`, `sockjs`, `nth-check`, `css-select`, `serialize-javascript`, `rollup-plugin-terser`, `react-scripts` itself. **None ship in the production bundle.** All gated on `react-scripts` upgrade — eliminated by the Hurricane port (Vite/Next), not before.
   - **6 of 6 moderate in same CRA dev chain** — same story.
   - **9 low-severity in jest/jsdom** — test-time only.
   - ~~1 high-severity in PRODUCTION code path: `xlsx`~~ ✅ Resolved 2026-05-03: replaced with `exceljs` (no fix was ever going to come from SheetJS). The Prototype Pollution + ReDoS advisories are now off the audit. exceljs is lazy-loaded — main bundle shrank 110 KB; the ~255 KB exceljs chunk only downloads when a user actually picks an XLSX file. Helper at `src/shared/excel.js` mirrors xlsx's `sheet_to_json` data shape so call sites (ImportProjectsPage, Pipeline lead import) didn't change semantics. Migration: no DB migration; pure JS. **Now:** zero high-severity vulns ship in production code paths.
6. ~~**No API abstraction — direct `fetch()` in App.jsx**.~~ ✅ Resolved 2026-05-03 across three commits. Phase 1 (`1f78b17`/`c0c3991`): `src/shared/sb.js` as canonical entry + ESLint `no-restricted-syntax` rule. Phase 2A (`1f9b6d6`): replaced 4 local sb wrappers; added `sbAuth*` namespace + migrated 6 auth functions; migrated 23 functions/v1 fetches → `sbFn` (33 retired). Phase 2B (`ae3f2d2`): migrated 5 storage/v1 fetches → `sbStorage*` helpers (5 retired). Phase 2C (`bf8af3a`): migrated remaining 75 inline rest/v1 fetches by pattern — DELETEs (10), PATCHes (15), POSTs (28), UPSERT (1), RPC (1), plus new `sbCount(t,q)` helper for `Prefer: count=exact` patterns at 2 sites. **113 warnings → 0**. App.jsx -200 lines net (manual response-status checks + `.text()/.json()` parsing collapsed into the helpers' `_check` + content-type-aware parse). **Six fetches remain with `eslint-disable-next-line no-restricted-syntax` + justifying comments** (production_plan_lines + production_actuals retry-on-missing-column loops that read response.text() to detect schema drift; sbPost throwOnError obscures body inspection; refactor is its own cleanup item). The `H` constant in App.jsx is still used by those 6 disabled fetches; it can go when those refactors land.
7. ~~**No error tracking beyond `console.error`.**~~ ✅ Resolved 2026-05-02: `@sentry/react` installed; `src/index.js` initializes Sentry with `Sentry.ErrorBoundary` wrapping `<App />`, browser-tracing, and replay integration (5% baseline / 100% on-error). Guarded by `REACT_APP_SENTRY_DSN` env var so missing-DSN = silently no-op. Build version (`BUILD_INFO.shortSha`) tagged on every event. Bundle: main +86 KB gzipped (Replay integration is heavier than the SDK alone — defensible for the debug value). To verify: open the live site, DevTools console, run `Sentry.captureException(new Error('test'))` → event should appear in Sentry within ~30s. **Follow-ups (not done in this commit):** (a) call `Sentry.setUser({email, id})` after auth so events group per-person, (b) wire Vercel ↔ Sentry source map upload integration so stack traces show real source instead of minified line numbers.

🟡 **MEDIUM**
8. **No type safety (CRA + plain JS).** 24k-line file with no compile-time shape checks. Hurricane port adds TypeScript. Until then, JSDoc `@typedef` on the most-used shapes (`Job`, `Lead`, `ContractReadiness`) in `src/shared/types.js` gives VSCode IntelliSense without a build step change.
9. **Hardcoded role/permission sets** (`EDIT_EMAILS`, `STATUS_EDIT_EMAILS`, `REOPEN_EMAILS`, `PLANT_EDIT_EMAILS`, `SYSTEM_ADMIN_EMAILS` near `src/App.jsx:36`). Adding/removing a person requires a commit. Fix as part of identity-by-email FK conversion (workflow backlog #3): add a `permissions` JSONB column or `user_permissions` join table; replace the JS sets with a single fetch on app load.
10. ⚠️ **Duplicated design tokens** — substantially resolved across two passes (2026-05-03): `src/shared/ui.js` exports `COLOR`/`FONT`/`RADIUS`/`SHADOW` token vocabulary + canonical style objects (`card`, `btnP`, `btnPL`, `btnS`, `btnG`, `btnB`, `inputS`, `stat`, `statLabel`, `statValue`). **Migrated**: CustomerMasterPage (full), ContractsWorkbenchPage (partial — small `btnS` variant local), SpecialtyVisitsPage (partial — small `btnS` + full-width `inputS` local), CVReconciliationPage (`card` + `btnP`; small `btnS` + full-width `inputS` local), SharePointLinksPage (`card` + `btnS`; large `btnG` variant local), SystemEventsPage (`card` + `btnS` + `btnPL`). **Still local** (genuinely intentional or visual-design call required to merge): App.jsx module-scope (older 8px/16px / fs 13 / fw 600 shape powers most of the monolith — visual realignment is its own project), MyPlatePage `card` (table-wrapper variant: `padding: 0, overflow: hidden`), MyPlatePage `btnP` (small red variant), PISFormPage (external portal styling — different design language by design), small/full-width input variants used by 2-3 callers each (would need a canonical font-size pick to unify). New work should `import { ... } from 'shared/ui'` rather than defining locally.

🟡 **MEDIUM**
11. **Latent ESLint warning population** (~37 across the codebase). Surfaced 2026-05-03 when commit `1f78b17` added `eslintConfig` to `package.json` — Vercel sets `CI=true` by default which escalates ESLint warnings to errors and broke the deploy chain. **Workaround in place**: build script sets `CI=false` so warnings stay warnings (visible in build logs, don't gate deploys). Real cleanup: ~25 `no-unused-vars` (dead imports / abandoned variables — mostly mechanical), ~10 `react-hooks/exhaustive-deps` (useMemo/useEffect deps; some intentionally omitted to avoid loops, some real bugs — investigate per-site), 1 `no-useless-escape` in App.jsx L17063 (regex), 1 `no-dupe-keys` in App.jsx L17495 (duplicate `transition` key in a style object — pick the intended one). Plus 108 `no-restricted-syntax` warnings in App.jsx that are the Phase-2 marker for tech-debt #6 (sb.js migration); those retire as Phase 2 lands. To audit current state: `CI=true npm run build 2>&1 | grep 'Line '`.

🔵 **LOW (parking lot, not on radar unless something changes)**
- localStorage breadcrumb pattern (`fc_customer_master_focus_*`) — fragile multi-tab
- `!important` + `visibility: visible` in marker CSS — disappears when Mapbox #1 lands
- `create_job_checklist()` function orphaned — drop after 2026-06-02 with `legacy_job_documents`
- Hardcoded anon JWT in App.jsx + CustomerMasterPage.jsx — anon keys ship publicly; rotation pain only
- Multiple money/date formatters — cosmetic drift surface
- No CHANGELOG.md — git log + "Recently shipped" cover it

---

## Team & Routing

| Role | Name | Email | Notes |
|---|---|---|---|
| CEO | David Bannister | david@ | Sole developer |
| CFO | Alex Hanno | alex@ | Tax/billing decisions |
| SVP Operations | Carlos Contreras | ccontreras@ | Crew + production |
| AR Lead | Jalen Nicholas | jalen@ | **No user_profile** — receives emails only |
| AP Manager | Nicole Martino | nicole@ | **No user_profile** |
| Contracts | Amiee Gonzales | amiee@ (auth) → contracts@fencecrete.com (routing) | edge functions use `CONTRACTS_EMAIL` constant |
| Production Manager | Max Rodriguez | max@ | Mold inventory entry |
| **PMs** | Doug Monroe (DFW/AUS), Ray Garcia (SA), Manuel Salazar (HOU Precast), Rafael "Jr." Anaya (HOU SW) | | |
| **Sales Reps** | Matt Booth (SA), Laura Sheffy (HOU, sales_director), Yuda Doliner (SA), Nathan Savage (HOU), Ryne Tutor (HOU), Mike Dean (DFW — pending login) | | |
| PE Sponsors (viewer role) | Chester Wang, Mike Kell | wang@woodlake-group.com, mike@lakestatepartners.com | |

**Departed (don't include in alerts):** Mary Barbe, Marisol Gonzalez

---

## Edge Function Patterns

- **Secrets:** ALL secrets must use `Deno.env.get()`. Anthropic's secret scanner auto-revokes hardcoded keys committed to GitHub.
- **CORS headers:** Any function receiving requests from the Supabase JS client must include `apikey` and `x-client-info` in `Access-Control-Allow-Headers`. Use `new Headers({...CORS_BASE, 'Content-Type': '...'})` rather than object spread to avoid Supabase edge runtime overriding Content-Type.
- **200-wrapped-error gap:** Supabase edge function logs show HTTP status per invocation but do NOT surface response body content. A function returning `{error: "..."}` inside a 200 appears healthy in logs. **Always verify response content via curl, not just status code.** 6 functions still have this pattern — fix opportunistically.
- **`dispatch_system_event` v16** is the central router. Currently has rules for: notifyChangeOrderApproved, notifyDocumentUploaded, PIS submitted/expired. Known v17 fix needed: PIS path bug.

---

## Deployment Workflow

```bash
npm run build          # Build locally first to catch errors
git add -A
git commit -m "..."
git push origin main   # Vercel auto-deploys
```

**Never use Vercel CLI directly.** Always go through git push.

**Verify production deploys** by fetching the deployed JS bundle URL from the HTML and grepping for specific string literals:
```bash
curl -sk https://fencecrete-ops.vercel.app/ | grep -o '/static/js/main\.[a-f0-9]*\.js' | head -1 | xargs -I {} curl -sk "https://fencecrete-ops.vercel.app{}" -o bundle.js
grep -F -c "expected_string" bundle.js
```

---

## Brand & Communication Discipline

- **Brand name:** "Fencecrete" everywhere except legal/statutory contexts (PIS footer, contract docs, Texas Property Code 53.159 notice — those use "Fencecrete America, LLC")
- **Tone with David:** PE-caliber CEO advisor framing. EBITDA quality > revenue growth. Pragmatic over perfect. Tech as force multiplier. Tradeoffs / risks / now-vs-later explicit. Tables and bullets. Stop and let real users hit it before speculating about edge cases.
- **No fluff, no academic framing.** Direct. Decisive. Challenge assumptions when they don't hold up.

---

## Operational Defaults

- **Default to case-by-case for data fixes** (billing, status, money). Bulk fixes only with explicit approval from David + relevant owner (Alex for financial, Carlos for production).
- **Silent SQL backfill OK** only for non-spine fields like flags (`contract_executed`, `tax_exempt`).
- **Major architectural decisions** (trigger refactors, bulk fixes) are parked until further notice; active-user safety is the priority.
- **Co-Pilot is read-only AI.** Never autonomous mutations.

---

## Tools Available

- **Supabase MCP:** Use `apply_migration` for schema changes and data writes. Use `execute_sql` for read-only verification only. Project ID: `bdnwjokehfxudheshmmj`
- **GitHub PAT:** Available in your environment. Use for direct API operations when local git is awkward.
- **Resend:** Transactional email (smtp.resend.com:465). Pending DNS at Sharkmatic for mail.fencecrete.com.

---

## When Starting a Session

1. `git pull origin main` first — David runs sessions in both Chat (web) and Code (terminal). Chat-side commits don't auto-sync.
2. If editing App.jsx: grep before editing, validate before pushing.
3. If touching the database: read the relevant trigger first to understand what's computed vs stored.
4. If you encounter `42501 RLS error`: the table has the wrong RLS pattern. Apply the platform pattern above.
5. **Don't bulk-fix data without explicit approval.** Even when it looks obvious.

---

*Last updated: May 4, 2026 — FINAL end-of-day. 12 commits across the full-day session (`492b5ef`..`7137b6b`), 2 DB migrations, 0 edge function deploys. **Every one of the 20 live-review findings closed** (P0/P1/P2/P3) plus Tier 1 mobile improvements for PM workflows (role-driven bottom nav, camera-first photo capture on Documents, PM Bill Sheet mobile card view) plus a TDZ crash fix on Material Calculator caught during the QA sweep. Notable systems-level adds: 2-level EditPanel tab grouping (Setup / Money / Workflow); `MoneyInput` component with currency formatting; `MOBILE_NAV_BY_ROLE` + `ROLE_NAV_GROUPS` role-aware nav; sidebar icon dict completed (28 → 41 entries — every nav item now has an icon); sidebar count split into `active · total` aligned with Dashboard's canonical `CLOSED_SET` definition. Two new DB triggers + backfills (crew_leader_id forcing-function gate; PRODUCT ↔ PRIMARY_TYPE auto-sync). New shared module: `src/shared/billing.js` as the single source of truth for billing metrics. **State going into 2026-05-05:** live-review backlog fully closed; David's review notes retired. Tomorrow is operational (Carlos backfills crew leaders via the bulk UI, David runs the bulk PIS pull on Customer Master) — no engineering pressure unless real users surface new issues. Next-up engineering chips when needed: tech-debt #11 (latent ESLint warnings ~134 mechanical cleanup); retire-on-missing-column pattern (~1 hr — last 6 eslint-disabled fetches); identity-by-email FK conversion for the remaining ~27 columns. All builds green, all CI green on every commit.*
