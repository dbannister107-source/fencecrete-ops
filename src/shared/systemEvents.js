// logEvent — canonical entry point for emitting a row into system_events.
//
// Every business-meaningful action that should drive an automated workflow
// (or just be auditable) calls this. The dispatch_system_event edge function
// picks the row up via a database webhook, runs the registered rule(s) for
// event_type, and records what it did in actions_taken.
//
// See docs/AGENTIC_ARCHITECTURE.md for the full pattern.
//
// IMPORTANT (2026-04-28): Uses Prefer: return=minimal because the anon role
// has INSERT permission on system_events but no SELECT permission (intentional
// — event payloads may carry sensitive job/customer data). When PostgREST
// honors return=representation it must SELECT the row back to return it,
// which fails the missing SELECT policy and surfaces as a misleading "INSERT
// RLS violation" 42501 error. return=minimal returns 201 with no body and
// bypasses the SELECT step.

import { sbPost } from './sb';

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

  try {
    await sbPost('system_events', row, { returnMinimal: true, throwOnError: true });
    return null;
  } catch (e) {
    console.error('[logEvent] failed:', { error: e.message, row });
    throw new Error(`logEvent failed: ${e.message}`);
  }
}
