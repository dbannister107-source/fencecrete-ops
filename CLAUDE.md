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
1. **Zero automated tests** ⚠️ partially resolved 2026-05-03: precedent set with `supabase/tests/readiness_gate.sql` (7 PASS assertions covering the gate machinery). Pattern: BEGIN/ROLLBACK + DO $$ blocks + `_test_results` TEMP table. Runs via Supabase MCP today; CI workflow is a separate setup. **Still TODO**: more tests covering other high-risk surfaces (customer_name sync trigger, identity FK sync trigger, frontend logic), and CI wiring so PRs run them automatically. Pattern is ready for new tests to slot in (`supabase/tests/<name>.sql`); see `supabase/tests/readme.md`.
2. ~~**Edge function source not in repo**~~ ✅ Resolved 2026-05-02: pulled all 23 missing edge functions via Supabase MCP `get_edge_function` and committed to `supabase/functions/`. Also refreshed `chat-assistant` from deployed v19 (repo had drifted). All 25 deployed functions are now version-controlled. Secret scrub on every pulled file (grep for `sk_*`, `re_*`, `eyJ*`, `AIza*`, `ghp_*`, `-----BEGIN ... KEY-----`, `password=`, `api_key=`) returned **zero hits** — every function uses `Deno.env.get()` correctly. Two follow-ups now reviewable in repo: (a) `bill-sheet-submitted-notification` v15 has the documented "500 on OPTIONS" bug (the OPTIONS handler looks correct on inspection — needs runtime repro to confirm); (b) `dispatch_system_event` v16 is in repo but the deployed source was too large to diff against in this session; if a v17 PIS-path fix is still pending, that's where it lives.
3. **Power Automate single point of failure for billing notifications.** ⚠️ Skeleton in place 2026-05-03 (`docs/automations.md`); content TODOs still pending. "PM uploads bill sheet → Power Automate notifies Virginia/Mary" — flow lives in someone's Office account, undocumented, ungoverned. The repo's `bill-sheet-submitted-notification` edge function notifies leadership (David + Carlos) on the same trigger, but does NOT send to Virginia (AR) — Power Automate is what reaches her. Mary is departed; she should be removed from the flow's recipient list. **Next step**: open the Power Automate UI, fill in the `<TODO>` placeholders in `docs/automations.md` (account/trigger/recipients/email content). **Migration target after that**: extend the edge function to include `virginiag@fencecrete.com`, run parallel for a week, retire Power Automate. Eliminates the existential risk.

🟠 **HIGH**
4. **App.jsx 24,891-line monolith** — same item as workflow backlog #3; ongoing incremental extraction.
5. **npm vulnerabilities — triaged 2026-05-02, xlsx replaced 2026-05-03.** Current count: 29 (14 high, 6 moderate, 9 low). The breakdown:
   - **14 of 14 high-severity in build/dev tooling only** — `@svgr/*`, `workbox-*`, `webpack-dev-server`, `sockjs`, `nth-check`, `css-select`, `serialize-javascript`, `rollup-plugin-terser`, `react-scripts` itself. **None ship in the production bundle.** All gated on `react-scripts` upgrade — eliminated by the Hurricane port (Vite/Next), not before.
   - **6 of 6 moderate in same CRA dev chain** — same story.
   - **9 low-severity in jest/jsdom** — test-time only.
   - ~~1 high-severity in PRODUCTION code path: `xlsx`~~ ✅ Resolved 2026-05-03: replaced with `exceljs` (no fix was ever going to come from SheetJS). The Prototype Pollution + ReDoS advisories are now off the audit. exceljs is lazy-loaded — main bundle shrank 110 KB; the ~255 KB exceljs chunk only downloads when a user actually picks an XLSX file. Helper at `src/shared/excel.js` mirrors xlsx's `sheet_to_json` data shape so call sites (ImportProjectsPage, Pipeline lead import) didn't change semantics. Migration: no DB migration; pure JS. **Now:** zero high-severity vulns ship in production code paths.
6. **No API abstraction — direct `fetch()` to Supabase REST in dozens of call sites in App.jsx.** `src/shared/sb.js` has `sbGet/sbPost/sbPatch/H` but App.jsx still re-rolls fetches. Fix: make `src/shared/sb.js` the only allowed entry; add an ESLint rule (or grep CI check) that fails the build on `fetch(\`${SB}/rest/v1` outside that file. ~3-4 hours migration; the lint rule is the actual unlock.
7. ~~**No error tracking beyond `console.error`.**~~ ✅ Resolved 2026-05-02: `@sentry/react` installed; `src/index.js` initializes Sentry with `Sentry.ErrorBoundary` wrapping `<App />`, browser-tracing, and replay integration (5% baseline / 100% on-error). Guarded by `REACT_APP_SENTRY_DSN` env var so missing-DSN = silently no-op. Build version (`BUILD_INFO.shortSha`) tagged on every event. Bundle: main +86 KB gzipped (Replay integration is heavier than the SDK alone — defensible for the debug value). To verify: open the live site, DevTools console, run `Sentry.captureException(new Error('test'))` → event should appear in Sentry within ~30s. **Follow-ups (not done in this commit):** (a) call `Sentry.setUser({email, id})` after auth so events group per-person, (b) wire Vercel ↔ Sentry source map upload integration so stack traces show real source instead of minified line numbers.

🟡 **MEDIUM**
8. **No type safety (CRA + plain JS).** 24k-line file with no compile-time shape checks. Hurricane port adds TypeScript. Until then, JSDoc `@typedef` on the most-used shapes (`Job`, `Lead`, `ContractReadiness`) in `src/shared/types.js` gives VSCode IntelliSense without a build step change.
9. **Hardcoded role/permission sets** (`EDIT_EMAILS`, `STATUS_EDIT_EMAILS`, `REOPEN_EMAILS`, `PLANT_EDIT_EMAILS`, `SYSTEM_ADMIN_EMAILS` near `src/App.jsx:36`). Adding/removing a person requires a commit. Fix as part of identity-by-email FK conversion (workflow backlog #3): add a `permissions` JSONB column or `user_permissions` join table; replace the JS sets with a single fetch on app load.
10. ⚠️ **Duplicated design tokens** — substantially resolved across two passes (2026-05-03): `src/shared/ui.js` exports `COLOR`/`FONT`/`RADIUS`/`SHADOW` token vocabulary + canonical style objects (`card`, `btnP`, `btnPL`, `btnS`, `btnG`, `btnB`, `inputS`, `stat`, `statLabel`, `statValue`). **Migrated**: CustomerMasterPage (full), ContractsWorkbenchPage (partial — small `btnS` variant local), SpecialtyVisitsPage (partial — small `btnS` + full-width `inputS` local), CVReconciliationPage (`card` + `btnP`; small `btnS` + full-width `inputS` local), SharePointLinksPage (`card` + `btnS`; large `btnG` variant local), SystemEventsPage (`card` + `btnS` + `btnPL`). **Still local** (genuinely intentional or visual-design call required to merge): App.jsx module-scope (older 8px/16px / fs 13 / fw 600 shape powers most of the monolith — visual realignment is its own project), MyPlatePage `card` (table-wrapper variant: `padding: 0, overflow: hidden`), MyPlatePage `btnP` (small red variant), PISFormPage (external portal styling — different design language by design), small/full-width input variants used by 2-3 callers each (would need a canonical font-size pick to unify). New work should `import { ... } from 'shared/ui'` rather than defining locally.

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

*Last updated: May 2, 2026 — full-day session: 9 commits, 4 DB migrations, 2 reviews, 6/8 backlog items retired or partial, App.jsx -32 lines via shared module extractions (readiness.js, upload.js). See "Recently shipped (2026-05-02)" for details and tomorrow's pickup point.*
