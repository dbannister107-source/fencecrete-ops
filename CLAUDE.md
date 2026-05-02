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
- **Customer-linked contract gate fixed.** `v_contract_readiness.auto_checks.customer_linked` now checks `company_id IS NOT NULL OR is_residential = TRUE` (previously only checked the free-text `customer_name` string, which never failed). 21 contract_review jobs newly blocked from advancing status until reconciled in Customer Master. Migration: `20260502_fix_customer_linked_gate.sql`. UI label updated to "Linked to company".
- **Documents tab: HEIC support, paste-to-upload, inline thumbnails.** iOS HEIC photos auto-convert to JPEG client-side via `heic2any` (~338 KB lazy chunk, only loads when a HEIC is actually picked — main bundle unchanged). Cmd/Ctrl+V on the Documents tab uploads pasted screenshots/images. Image rows render small thumbnails (signed URLs, 5-min expiry — refresh the tab if they go stale). No edge function — all client-side. Touched: `src/App.jsx` around line 1770 (loadAttachments thumbnail augmentation) and 1958 (handleFiles HEIC interception + paste listener).
- **Readiness-gate trigger no longer fails open.** `enforce_contract_readiness()` previously caught any view-read exception with `v_ready := true; -- fail open`, silently letting status moves through on internal errors. Now: failures are logged to `system_events` (`event_type='readiness_gate_internal_error'` with sqlstate/sqlerrm/job/attempted_status payload) and the trigger raises a distinct `internal_error` ERRCODE. Normal user-facing "checklist incomplete" path is byte-for-byte identical. Migration: `20260502_fix_readiness_trigger_fail_open.sql`. To audit any internal-error events going forward: `SELECT * FROM system_events WHERE event_type='readiness_gate_internal_error' ORDER BY created_at DESC;`
- **RLS cleanup: dropped 60 redundant permissive policies across 35 tables.** Pattern was layered legacy policies (`"auth read"`, `"auth write"`, etc.) sitting alongside the canonical `"public access" FOR ALL USING(true) WITH CHECK(true)`. RLS OR-evaluates permissive policies, so the redundant ones were dead weight evaluated on every query. Performance advisor: 270 `multiple_permissive_policies` → 0; 26 `auth_rls_initplan` → 2 (24 of those were `auth.role()='authenticated'` checks inside the dropped policies). Total perf findings 343 → ~50. Migration: `20260502_drop_redundant_rls_policies.sql`. Any new table going forward should follow ONLY the canonical pattern — no extra "auth read"/"auth write" policies needed; the canonical permits everything.
- **Retired `job_documents` (dead parallel checklist system).** It was a checklist tracker (not a file store) that auto-populated 6 pending rows per job via `trg auto_create_job_checklist` on every `jobs` INSERT — 1,788 rows total, all `pending`, never read or updated. The OPS app uses `contract_readiness_items` / `v_contract_readiness` for the same purpose. Trigger dropped, table renamed to `legacy_job_documents` (slated for `DROP TABLE` after 2026-06-02 if no consumer surfaces). The `create_job_checklist()` function is left in place; will drop with the table. Migration: `20260502_retire_legacy_job_documents.sql`.
- **Co-Pilot home: blocked-contracts surface + shared readiness module.** New top-level insight on Co-Pilot home: `🚧 N contracts blocked from advancing to production_queue` with the top 3 blocker reasons (using human-readable labels) and a CTA to Contracts Workbench. Closes the discovery loop on the readiness gate — Amiee no longer has to open the Workbench to find out that a contract is blocked. Also extracted `src/shared/readiness.js` as the single source of truth for `AUTO_LABELS` / `MANUAL_ITEMS`; previously duplicated in `ContractsWorkbenchPage.jsx`, EditPanel readiness card (App.jsx), and now Co-Pilot. Retires backlog item #8.

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
2. **`jobs.customer_name` drifts from `companies.name`** for 40 of 191 linked jobs (21%). Sync trigger + 40-row backfill; long-term, expose customer name via view of companies.
3. **Identity-by-email-text** across 30+ columns (`jobs.pm`, `jobs.sales_rep`, etc.). Dead emails persist forever; no "show my jobs" without text matches. Convert top 3 columns first (jobs.pm, jobs.sales_rep, pm_daily_reports.pm) — don't try the full 30+ at once. Per `804c60c`'s "identity-column relational debt".
4. ~~**No discovery path for blocked contract advances.**~~ ✅ Resolved 2026-05-02: Co-Pilot home now surfaces a top-level `🚧 N contracts blocked` card with top blockers + CTA to Contracts Workbench. Server-side rejection logging (Part B in the plan) was deferred — App.jsx has 8+ status-update call sites with no central handler, so it's a refactor pass not a small change.

🟡 **MEDIUM**
5. **PM Daily Report** (`src/App.jsx:12592`) has its own upload path with no HEIC/paste support — daily friction for the highest-volume photo uploaders. Extract `convertHeicIfNeeded` + paste-listener pattern into `src/shared/upload.js`.
6. **`companies` dedup risk** — 3 confirmed near-dupes (Franklin Construction, Peltier Brothers, Watermark Commercial). Add unique index on normalized name; merge the 3.
7. **Two ID conventions on `jobs`** — `id` (UUID) and `job_number` (text). Both used as keys depending on context. Codify rule: id for joins/REST, job_number for display. Add `resolveJobId()` utility.
8. ~~**Readiness UI duplicated** across Workbench + EditPanel.~~ ✅ Resolved 2026-05-02: `src/shared/readiness.js` is now the single source of truth (`AUTO_LABELS`, `MANUAL_ITEMS`, `MANUAL_LABELS`, `REQUIRED_MANUAL`). Imported by Workbench, EditPanel readiness card, and CoPilotHome blocked-contracts insight. The pattern is now established for future shared-module extractions (STATUS_LABELS, STATUS_COLORS, etc., when needed).

**Architecture confirmed solid (no action needed):** Phase 3 doc fan-out is properly wired in BOTH directions — `trg_jobs_auto_attach_company_docs_ai` (jobs INSERT) AND `trg_jobs_auto_attach_company_docs_au` (jobs UPDATE when company_id changes). Zero adoption today is purely because no docs uploaded yet, not a plumbing gap.

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

*Last updated: May 2, 2026 (added Safety Rules section + customer-linked gate fix + Customer Master Phase 2/3 status corrected)*
