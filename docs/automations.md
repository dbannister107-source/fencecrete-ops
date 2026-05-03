# Fencecrete OPS — External Automations Inventory

This file documents automations that run **outside the OPS codebase** —
Microsoft Power Automate flows, SharePoint hooks, third-party webhooks,
etc. Each entry should answer enough that a successor with admin access
to your Microsoft tenant could rebuild the flow from scratch.

If an automation isn't here, it isn't documented. Fix that.

---

## Bill sheet submitted → AR notification (Power Automate)

**Status:** Active. Single point of failure: lives in one user's Office
account; if that account loses access or leaves, AR notifications
silently stop. **Migration target:** rebuild as a Supabase edge function
using the `dispatch_system_event` pattern; once verified, retire the
Power Automate flow.

### What it does

When a PM uploads a bill sheet (via OPS / SharePoint / both — TBD), this
flow sends an email to Accounts Receivable so they know an invoice is
ready to be cut.

### Owner

- **Account that hosts the flow:** `<TODO: which Office user account
  does the flow live under? Usually visible at https://make.powerautomate.com
  → My flows. Likely david@ but confirm.>`
- **Backup admin:** `<TODO: anyone else with edit access to this flow?>`

### Trigger

- **Source:** `<TODO: SharePoint folder watch? OPS direct webhook?
  Email-based trigger? OPS edge function call?>`
- **Specifically:** `<TODO: which SharePoint library / folder, or which
  webhook URL, or which OPS code path posts to it?>`

### Recipients

- **To:** Virginia Garcia (`virginiag@fencecrete.com`)
- **Historically also:** Mary Barbe (`mary@fencecrete.com`) — **departed,
  remove if still listed in the flow.**
- `<TODO: confirm Cc/Bcc list, if any>`

### Email content (current)

- **Subject template:** `<TODO: paste current subject line, with any
  variable substitutions noted (e.g., {{job_name}})>`
- **Body fields:** `<TODO: list the data points the email surfaces —
  job name, job number, billing period, amount, attached PDF, etc.>`
- **Attachments:** `<TODO: does the email include the bill sheet
  PDF/photo? Or just a link?>`

### Related OPS surfaces (verified)

- The OPS edge function `bill-sheet-submitted-notification`
  (`supabase/functions/bill-sheet-submitted-notification/index.ts`) fires
  on the same trigger and notifies leadership (`david@`, `ccontreras@`)
  via Resend. **It does NOT send to Virginia.** The Power Automate flow
  is what reaches AR.
- The OPS edge function `bill-sheet-reminder` runs monthly to nudge PMs
  with missing bill sheets — separate flow, not this one.

### How to inspect / edit

1. Sign in to https://make.powerautomate.com with the owner account.
2. **My flows** → search "bill sheet" or filter to active flows.
3. Open the flow → **Edit** to see the trigger, conditions, and email
   action. **Run history** shows recent invocations and any failures.

### How to verify it's working

- Trigger a test bill sheet submission in OPS.
- Check Virginia's inbox (or her preview if you have her account
  delegated) for the notification within ~2 minutes.
- In Power Automate: **My flows → [this flow] → Run history** should
  show a successful run.

### Migration plan (when ready)

- Reuse `bill-sheet-submitted-notification` edge function. Add
  `virginiag@fencecrete.com` to its `AR_EMAILS` array. Same email
  payload pattern as the existing AR alerts.
- Run both flows in parallel for ~1 week to confirm payload parity.
- Disable the Power Automate flow once Virginia confirms she's getting
  the edge-function-sent emails.
- Add a CLAUDE.md "Recently shipped" entry noting Power Automate
  retired; remove this entry from `docs/automations.md` and replace
  with a "(retired — see edge function)" note pointing at the migration
  commit.

---

## Other automations

`<TODO: enumerate any other Power Automate flows, SharePoint hooks,
QuickBooks integrations, etc. The same questions apply: who owns it,
what triggers it, who receives, how to verify.>`

Candidates to investigate (mentioned in code or CLAUDE.md):

- **SharePoint folder creation on new job** — handled by edge function
  `create-sharepoint-folder`, which IS in the repo. But: the flow uses
  Microsoft Graph API with `MS_GRAPH_*` secrets — those credentials
  live in someone's Azure AD app registration. Document the Azure AD
  app registration: which tenant, which app, which scopes, how to
  rotate the client secret.
- **QuickBooks sync** — none visible in the repo, but worth checking
  whether one exists.
- **Resend (email)** — owned by the Fencecrete account; DSN/API keys
  live in Supabase secrets. Document where they're rotated.

---

## Maintenance

- Review this file quarterly.
- Anytime an automation is added, modified, or removed: update the
  matching entry here in the same commit.
- If the flow's owner is leaving Fencecrete: re-assign or migrate
  before their last day.
