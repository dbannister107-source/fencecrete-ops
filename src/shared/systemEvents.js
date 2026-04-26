// logEvent — canonical entry point for emitting a row into system_events.
//
// Every business-meaningful action that should drive an automated workflow
// (or just be auditable) calls this. The dispatch_system_event edge function
// picks the row up via a database webhook, runs the registered rule(s) for
// event_type, and records what it did in actions_taken.
//
// See docs/AGENTIC_ARCHITECTURE.md for the full pattern.

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

  const result = await sbPost('system_events', row);
  // sbPost returns the JSON body — for an INSERT with Prefer: return=representation
  // PostgREST returns an array of inserted rows. PostgREST error responses come
  // back as { code, message, ... } (an object, not an array), so detect that.
  if (result && !Array.isArray(result) && result.code) {
    console.error('[logEvent] failed:', result, row);
    throw new Error(`logEvent failed: ${result.message || result.code}`);
  }
  return Array.isArray(result) ? result[0] : result;
}
