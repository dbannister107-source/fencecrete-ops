// dispatch_system_event
//
// Triggered by a Supabase database webhook on INSERT into public.system_events.
// 1. Atomically claims the row (status pending → processing) — guards against
//    duplicate webhook deliveries and concurrent invocations.
// 2. Runs every rule registered under RULES[event_type].
// 3. Records what each rule returned (or threw) into actions_taken and
//    flips status to succeeded / failed / skipped.
//
// Adding a new agent: declare an event_type, call logEvent(...) from the
// trigger point in the app, write a rule function here, register it under
// RULES. See docs/AGENTIC_ARCHITECTURE.md.
//
// SECRETS: never hardcode. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// populated automatically for every edge function — read via Deno.env.get.

// @ts-ignore — Deno runtime resolves the imports at deploy time
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-ignore — Deno runtime global
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type SystemEvent = {
  id: string;
  event_type: string;
  event_category: string;
  actor_id: string | null;
  actor_type: string;
  actor_label: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: string;
  processing_attempts: number;
  created_at: string;
};

type RuleFn = (event: SystemEvent) => Promise<unknown>;

// ── Rule: test.ping ────────────────────────────────────────────────────────
// Trivial rule used to verify spine health from the System Events admin page.
async function pingRule(event: SystemEvent) {
  return {
    type: 'pong',
    message: 'Spine is alive',
    event_received_at: event.created_at,
    dispatcher_processed_at: new Date().toISOString(),
    payload_echo: event.payload,
  };
}

const RULES: Record<string, RuleFn[]> = {
  'test.ping': [pingRule],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return json({ error: 'invalid JSON body' }, 400);
  }

  // Supabase database webhooks send { type, table, schema, record, old_record }.
  // The spec also tolerates a direct event payload for replay-from-UI.
  const event: SystemEvent | undefined = body?.record || body?.event;
  if (!event || !event.id) {
    return json({ error: 'no event in payload' }, 400);
  }

  // Atomic claim: only one invocation can flip pending → processing.
  const { data: claimed, error: claimErr } = await supabase
    .from('system_events')
    .update({
      status: 'processing',
      processing_attempts: (event.processing_attempts || 0) + 1,
    })
    .eq('id', event.id)
    .eq('status', 'pending')
    .select()
    .single();

  if (claimErr || !claimed) {
    // Either someone else already claimed it, or the event row no longer exists.
    return json({ skipped: true, reason: claimErr?.message || 'not pending' });
  }

  const rules = RULES[claimed.event_type] || [];
  const actions: Array<{ rule: string; ok: boolean; result?: unknown; error?: string }> = [];

  for (const rule of rules) {
    try {
      const result = await rule(claimed as SystemEvent);
      actions.push({ rule: rule.name, ok: true, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      actions.push({ rule: rule.name, ok: false, error: msg });
    }
  }

  const finalStatus =
    actions.length === 0
      ? 'skipped'
      : actions.some((a) => !a.ok)
      ? 'failed'
      : 'succeeded';

  const failedReason = actions.find((a) => !a.ok)?.error || null;

  const { error: updateErr } = await supabase
    .from('system_events')
    .update({
      status: finalStatus,
      processed_at: new Date().toISOString(),
      actions_taken: actions,
      failed_reason: failedReason,
    })
    .eq('id', claimed.id);

  if (updateErr) {
    console.error('[dispatcher] final update failed:', updateErr);
    return json({ error: 'final update failed', details: updateErr.message }, 500);
  }

  return json({ ok: true, event_id: claimed.id, status: finalStatus, actions });
});
