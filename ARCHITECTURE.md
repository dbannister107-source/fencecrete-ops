# Fencecrete OPS — Architecture & Build Principles

This document is the source of truth for how Fencecrete OPS is structured, how new features get added, and what's *off-limits*. It exists because the platform is approaching a complexity threshold where the cost of adding to it has started to exceed the cost of restraint.

If you're modifying the app — yourself, Claude Code, a future contractor — read this first.

---

## What this app is

A single-tenant operations platform for Fencecrete America (precast concrete fence manufacturer + installer, ~$27M revenue, target $60M by 2030). Today: ~30 navigation routes, ~100 React components, a single 1.9M-character `src/App.jsx` file. Backed by Supabase Postgres + edge functions, hosted on Vercel.

The platform's job is to be a **system of record** while NetSuite + Intrasyn (planned Q4 2026) get implemented. It is intentionally pragmatic, not architecturally pure. Most decisions favor "ship something useful this week" over "build the right abstraction." That trade-off has served us well to a point. We are now past that point in a few specific places.

---

## The principles, in priority order

### 1. The Co-Pilot is the home page
`/dashboard` renders `<CoPilotHome>` above `<Dashboard>`. The Co-Pilot is the front door. Every other page is downstream of "what should I look at today?" Insights, recommendations, and the ask-anything box live at the top of the home page. Don't bury them in sub-tabs. Don't put a new dashboard page above them.

If a feature surfaces a new exception or recommendation, the **first place it goes is the Co-Pilot rule set**, not a new tab.

### 2. App.jsx has a hard cap
The single-file React app pattern was a starting move, not a destination. As of May 2026, App.jsx is **~1.9M characters / ~24,000 lines / ~100 components**. We do not add new top-level pages to it.

**What this means in practice:**
- New pages **do not** get added to `NAV_GROUPS`, `PAGE_LABELS`, or the `{page==='...'&&<...>}` ladder in `AppShell`.
- New features should fold into existing pages (as a tab, sub-view, or card) — see Principle 3.
- If a feature genuinely cannot fold into anything existing, it gets built as a parallel module (Next.js subpath, embedded iframe, or a new entry point in `src/`) and integrates with App.jsx through navigation links, not by being inlined.

There are exactly two acceptable reasons to bypass this cap:
1. A bug fix to existing functionality that happens to require a new helper component.
2. An edit that reduces total App.jsx size (refactoring, deletion).

This is not a theoretical pattern — `src/features/` already contains 7 extracted modules (`system-events`, `specialty-visits`, `cv-reconciliation`, `my-plate`, `pis`, `sharepoint-links`, `customer-master`). New features follow that template; they are not declared inline in App.jsx.

Anything else is a fold-in or a parallel module.

### 3. Tab discipline: fold, don't sprout
Demand Planning previously had 9 tabs. We collapsed it to 5 in commit `409c7aa` because every tab past ~5 starts costing more in cognitive load than it adds in capability. **Future "improvements" should fold into existing tabs or become Co-Pilot prompts, not new tabs.**

The Demand Planning surface is **frozen at 5 tabs**: Capacity, Crews, Schedule, Data Health, Cash. Sub-views inside a tab (e.g., the Crews tab's Load / Gantt / Scorecard switcher) are fine. New top-level tabs are not.

Same principle applies to other multi-tab surfaces (Sales Dashboard, Project EditPanel, etc.). If you find yourself adding a 6th tab to anything, that's a signal to ask whether one of the existing tabs is the wrong abstraction.

### 4. Forcing functions over nudges
Where data hygiene matters and humans aren't doing it voluntarily, **block the action**, don't just nudge. The Proposal Validator gate on `saveProposal` is the canonical example: a rep can't promote a lead to `proposal_sent` without confirming they bypassed validation, and bypasses are logged.

This applies to:
- Crew leader assignment → already a workflow page, will eventually block production-stage transitions
- PM Daily Reports → eventually block bill sheet submission without a recent report
- Style canonicalization → eventually block contract execution on jobs missing style

Always log bypasses. Never block silently. Never block hard if the gate-check itself errors (fail open).

### 5. Agentic, but never autonomous
The Co-Pilot reads, reasons, and recommends. It does not act. We do not build features that auto-reschedule jobs, auto-email customers, auto-create POs, or auto-anything that touches a third party. Read-only AI surfaces are fine and encouraged. Autonomous mutations are not.

Why: at our scale, one bad autonomous action wipes out the EBITDA gain from a hundred good ones. The risk asymmetry doesn't justify the convenience.

### 6. Track 2 data hygiene is everyone's problem
Half the dashboard surface depends on PMs filing daily reports, leaders being assigned to jobs, styles being canonicalized, and molds being counted. Until those four things move, half the platform is showing zeros. The Co-Pilot already flags this; the rest of the team needs to actually do the work. Don't build features that paper over data gaps — surface them.

---

## What's frozen

| Thing | Status | What that means |
|---|---|---|
| App.jsx new pages | FROZEN | No new entries in NAV_GROUPS / PAGE_LABELS |
| Demand Planning tabs | FROZEN at 5 | Capacity, Crews, Schedule, Data Health, Cash |
| Sales Dashboard tabs | LOOSE | Single page; cards welcome |
| Co-Pilot insertion point | FROZEN | `/dashboard`, above existing KPI Dashboard |
| Auto-actions in agents | FROZEN OFF | Read-only reasoning only |

---

## Where new code should go

Use this table when you have a new feature in mind:

| Feature shape | Goes where |
|---|---|
| New rule / insight / what-changed-overnight | Co-Pilot rule set in `DemandPlannerCopilot` |
| New AI question users want to ask | `demand-copilot` edge function (no UI work needed) |
| New chart / table that augments existing analysis | New card on existing tab, or a sub-view inside an existing tab |
| New workflow tied to an existing entity (lead, job, leader) | EditPanel tab on that entity, or modal triggered from existing list view |
| New entirely-different concept that doesn't fit anywhere | Parallel module in `src/features/<feature-name>/` — same pattern as the existing `system-events`, `specialty-visits`, `cv-reconciliation`, `my-plate`, `pis`, `sharepoint-links`, and `customer-master` features. App.jsx imports the page component and the routing line is the only addition to App.jsx itself. **Not** a new component declared inside App.jsx |
| New scheduled job | Edge function + pg_cron entry. Use jobid 5/6 pattern (literal anon key, `timeout_milliseconds:60000`) |
| New audit log | Postgres table named `<entity>_validations`, `<entity>_history`, or `<entity>_events` with `created_at`, FK to entity, JSONB result |

---

## What we still owe ourselves (Q3-Q4 2026)

These are *acknowledged* deferred work — recorded so the next person doesn't think we forgot:

- **Hurricane port plan**: Port App.jsx to Next.js + Hurricane shell. Page-by-page migration, not big-bang. The Co-Pilot edge function and Supabase schema do not need to change. Estimate: 3-4 months part-time.
- **Real RBAC**: Today we use email allowlists and string role checks. Move to a proper `permissions` table with role inheritance.
- **Background processing**: Replace pg_cron with a proper job queue (Inngest, Defer, or Trigger.dev) for jobs that need retries / observability.
- **Test coverage**: Currently zero. Hurricane port is the right time to introduce Vitest + Playwright.
- **API typing**: Generate Supabase types from the schema; replace direct `fetch` calls with a typed client.

None of this is urgent. All of it is real.

---

## Editing App.jsx — the actual mechanics

If you must edit App.jsx (and you've justified bypassing Principle 2):

1. **Always** download the current file via the GitHub blob API. Local copies go stale fast — multiple sessions push to `main` weekly.
2. **Always** use exact `str.replace` for edits. Never regex over JSX. The file's quotes, escaped characters, and JSX expressions break naive regex.
3. **Always** `@babel/parser` parse-check after each edit before pushing. The file is too big to eyeball.
4. Make the smallest edit that achieves the goal. Avoid wrapping/restructuring existing JSX — it's the #1 source of "unterminated JSX" bugs.
5. Push via the GitHub Contents API; Vercel auto-deploys in ~90 seconds. Verify the deployed bundle by curling the JS bundle and grepping for distinctive strings.

---

## Maintenance contract

This document gets updated whenever a frozen principle changes, a deferred item gets done, or a new architectural decision is made. If a principle is being violated, either fix the code or update the doc — don't let them drift apart.

Last updated: 2026-05-02 (commit a/b/c sprint — Co-Pilot home, tab consolidation, validator forcing function, daily digest cron, App.jsx cap formalized)
