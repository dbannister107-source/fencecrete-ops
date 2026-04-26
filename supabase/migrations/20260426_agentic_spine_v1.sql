-- agentic_spine_v1
-- Foundational event-bus + dispatcher table. Every business-meaningful
-- action emits one row here; the dispatch_system_event edge function picks
-- pending rows up via a database webhook, runs registered rules, and writes
-- back actions_taken + final status. Doubles as audit log and agent input.
-- Already applied via the Supabase MCP apply_migration tool on 2026-04-26;
-- file committed so the schema can be replayed from scratch in a fresh env.

CREATE TABLE IF NOT EXISTS system_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  event_category  text NOT NULL DEFAULT 'general',
  actor_id        uuid,
  actor_type      text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','system','schedule','agent')),
  actor_label     text,
  entity_type     text,
  entity_id       uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata        jsonb DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','skipped')),
  processing_attempts int NOT NULL DEFAULT 0,
  processed_at    timestamptz,
  failed_reason   text,
  actions_taken   jsonb DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_events_status_created ON system_events(status, created_at) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(event_type);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC);

COMMENT ON TABLE system_events IS 'Append-only event log + work queue for the agentic dispatcher. Every business-meaningful action writes one row. Dispatcher processes pending rows asynchronously and records what it did in actions_taken. Acts as both audit trail and agent input. See docs/AGENTIC_ARCHITECTURE.md.';
