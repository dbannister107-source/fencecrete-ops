# Fencecrete OPS — External Automations Inventory

This file documents automations that run **outside the OPS codebase** —
SharePoint hooks, third-party webhooks, Azure resources, etc. Each entry
should answer enough that a successor with admin access could rebuild
the dependency from scratch.

If an automation isn't here, it isn't documented. Fix that.

---

## Microsoft Power Automate — RETIRED 2026-05-03

**Status:** Retired. Not in production use.

Three per-market cloud flows existed in `david@fencecrete.com`'s Power
Automate account, all named `Bill Sheet Notification-<Market>`:

- Bill Sheet Notification-Austin
- Bill Sheet Notification - San Antonio
- Bill Sheet Notification-Dallas

(No Houston flow ever existed. Houston is the largest market.)

### What they did

Watched a SharePoint folder for new bill-sheet uploads from PMs and
emailed Accounts Receivable so Virginia could cut invoices.

### Why retired

Bill-sheet submission moved entirely into the OPS web app
(2025–2026 buildout). PMs now submit via the Bill Sheets tab in
Production. Virginia monitors the **Billing page** in OPS — pull-based,
one screen, all markets, all jobs — instead of receiving per-event
emails. This is a cleaner workflow than email-per-submission noise,
which is why we never bothered porting Houston into Power Automate.

The OPS edge function `bill-sheet-submitted-notification` (Resend-backed)
still fires on bill-sheet submission and emails leadership (David +
Carlos) — that's a leadership heads-up, NOT an AR routing channel. AR
sees them on the Billing page; leadership gets the email.

### Current state of the disabled flows

- All three are **disabled** in Power Automate (prohibition icon visible
  on the SharePoint connector in My flows).
- Last-modified: 4 days ago (when David disabled them).
- They sit in `david@fencecrete.com`'s personal Power Automate account.

### Cleanup follow-up (operational, not engineering)

- David should **delete** the three disabled flows when convenient.
  Reasons: (a) they show up as visual debris on every My flows view,
  (b) they're in a personal account — if that account ever lapses,
  they'd be lost without ceremony anyway, (c) tiny risk of accidental
  re-enable. No engineering action needed; this is one click in the
  Power Automate UI per flow.

### What replaced this (the live workflow)

| Component | Where |
|---|---|
| Bill-sheet capture UI | OPS Production page → Bill Sheets tab (PM submits) |
| Trigger | DB trigger on `pm_bill_sheets` insert calls `bill-sheet-submitted-notification` edge function |
| Leadership notification | Edge function `bill-sheet-submitted-notification` → David + Carlos via Resend |
| AR access | Virginia opens the OPS Billing page; sees every submitted bill sheet across markets in one view |
| Reminders | Edge function `bill-sheet-reminder` (monthly cron) — separate concern, lives in repo |

---

## Other automations to inventory

`<TODO: enumerate any non-Power-Automate external dependencies. Same
questions: who owns it, what triggers it, who receives, how to verify.>`

Candidates to investigate (mentioned in code or CLAUDE.md):

- **Microsoft Graph / Azure AD app registration** — used by edge
  functions `create-sharepoint-folder`, `pis-extract-from-sharepoint`,
  the new bulk SharePoint pull (planned). Credentials in Supabase
  secrets as `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_TENANT_ID` /
  `MS_GRAPH_CLIENT_SECRET`. Document: which Azure AD tenant, which
  app registration name, which Graph scopes are granted, where the
  client secret lives, expiration date, how to rotate.
- **Resend (transactional email)** — owned under the Fencecrete
  account. API key in Supabase secrets as `RESEND_API_KEY`. DNS
  verification at Sharkmatic still pending for `mail.fencecrete.com`.
  Document: which Resend account, who's the billing contact, when the
  API key was last rotated, where to find DNS records.
- **Anthropic API** — used by `chat-assistant`, `demand-copilot`,
  `production-scheduler`, `prospect-researcher`, `proposal-validator`,
  `job-explainer`. Single key `ANTHROPIC_API_KEY` in Supabase secrets.
  Document: which Anthropic workspace, billing contact, current spend
  pattern.

---

## Maintenance

- Review this file quarterly.
- Anytime an automation is added, modified, retired, or removed:
  update the matching entry here in the same commit.
- If an automation's owner is leaving Fencecrete: re-assign or migrate
  before their last day. Power Automate flows in personal Office
  accounts are the canonical example of why this matters.
