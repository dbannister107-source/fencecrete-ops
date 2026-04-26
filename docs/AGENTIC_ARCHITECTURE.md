# Agentic Architecture

The agentic spine is one table, one edge function, and one helper. Every
automated workflow in Fencecrete OPS — current or future — rides on it.

## What `system_events` is

`system_events` is an append-only log + work queue. Every business-meaningful
action in the app writes one row: who did it, what they did, and what the
event "means" in domain terms. Rows are also the input that drives any
downstream automation. The table doubles as audit trail and agent input,
so we never need a separate side-channel for either.

## The dispatcher pattern

The flow is the same for every event:

1. **Emit.** App code calls `logEvent(...)` from `src/shared/systemEvents.js`,
   which inserts a row with `status='pending'`.
2. **Webhook.** A Supabase database webhook on INSERT fires the
   `dispatch_system_event` edge function with the new row in `body.record`.
3. **Atomic claim.** The function flips `pending → processing` with a
   conditional UPDATE. Only one invocation ever wins; duplicate webhook
   deliveries no-op.
4. **Run rules.** `RULES[event_type]` is an array of rule functions. The
   dispatcher runs each one and captures `{rule, ok, result | error}`.
5. **Record.** It writes the array to `actions_taken`, sets
   `status = succeeded | failed | skipped`, and stamps `processed_at`.

If no rule is registered for an event_type, the dispatcher records `skipped`.
The event is still in the audit log — you just haven't taught the system
what to do with it yet.

## How to add a new agent

1. **Pick an event_type** — dotted, lowercase, namespaced by domain
   (e.g. `proposal.viewed`, `scrap.logged`, `plant.down`).
2. **Call `logEvent(...)`** at the trigger point in app code. Pass
   `event_type`, a useful `payload`, and ideally `entity_type` + `entity_id`
   so the event is queryable by the thing it's about.
3. **Write a rule function** in `supabase/functions/dispatch_system_event/index.ts`.
   Rules are `async (event) => result`. Return value lands in `actions_taken`.
   Throw to fail. Keep them small; chain multiple rules under one event_type
   if you need to.
4. **Register it** by adding `'your.event_type': [yourRule]` to the `RULES`
   map. Redeploy the edge function.

That's it. No new tables, no new webhooks, no new infra.

## How to debug

- Visit **System Events** in the sidebar (admin allowlist gated).
- Filter for `status='failed'` to see what's broken — `failed_reason` and
  `actions_taken[].error` carry the details.
- Click any row for the full event + actions JSON.
- The **Replay this event** button on the detail drawer re-fires the
  dispatcher against the same row. Useful when you've fixed a bug in a rule
  and want to retry the events that previously failed.
- Or query directly: `SELECT * FROM system_events WHERE status='failed'
  ORDER BY created_at DESC;`.

## The `test.ping` convention

`event_type='test.ping'` is the canonical health check. The page's **Send
Test Ping** button emits one; the registered `pingRule` returns
`{type:'pong', message:'Spine is alive', ...}`. If you see the row turn
green within a few seconds, the spine — table → webhook → function → rule
→ writeback — is healthy end to end.

## Secrets

Edge function code **never** hardcodes secrets. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are populated automatically for every Supabase
edge function — read them with `Deno.env.get(...)`. Anthropic, Resend, etc.
go in as named secrets via `supabase secrets set ...` and are read the same
way. The April 19 incident was a hardcoded key — don't repeat it.
