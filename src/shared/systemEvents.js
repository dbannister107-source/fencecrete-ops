
// logEvent — canonical entry point for emitting a row into system_events.
//
// Every business-meaningful action that should drive an automated workflow
// (or just be auditable) calls this. The dispatch_system_event edge function
// picks the row up via a database webhook, runs the registered rule(s) for
// event_type, and records what it did in actions_taken.
//
// See docs/AGENTIC_ARCHITECTURE.md for the full pattern.
//
// IMPORTANT (2026-04-28): This calls fetch() directly with Prefer: return=minimal
// rather than using sbPost(), which defaults to return=representation. Anon role
// has INSERT permission on system_events but no SELECT permission (intentional —
// event payloads may carry sensitive job/customer data). When PostgREST honors
// return=representation it must SELECT the row back to return it, which fails
// the missing SELECT policy and surfaces as a misleading "INSERT RLS violation"
// 42501 error. return=minimal returns 201 with no body and bypasses the SELECT
// step. Callers don't need the inserted row anyway.

import { SB, KEY } from './sb';

const INSERT_HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

export async function logEvent({
  event_type,
  event_category = 'general',
  actor_label,
  actor_type = 'user',
  entity_type = null,
  entity_id = null,
  payload = {},
  metadata = {},
}) {
  if (!event_type) throw new Error('logEvent: event_type required');

  const row = {
    event_type,
    event_category,
    actor_label: actor_label || null,
    actor_type,
    entity_type,
    entity_id,
    payload,
    metadata,
  };

  const res = await fetch(`${SB}/rest/v1/system_events`, {
    method: 'POST',
    headers: INSERT_HEADERS,
    body: JSON.stringify(row),
  });

  // 201 Created with empty body on success when Prefer: return=minimal.
  // 204 No Content is also acceptable per the spec.
  if (res.ok) return null;

  // Non-2xx: parse PostgREST error envelope and throw with detail
  let errBody = null;
  try { errBody = await res.json(); } catch {}
  const msg = errBody?.message || `HTTP ${res.status}`;
  console.error('[logEvent] failed:', { status: res.status, body: errBody, row });
  throw new Error(`logEvent failed: ${msg}`);
}
