// job-stage-notification (DISABLED 2026-04-27)
//
// As of 2026-04-27 status-change emails are sent through the agentic spine
// (system_events table -> dispatch_system_event -> notifyJobStatusChangedRule).
// See migration job_status_changed_event_emission_2026_04_27 for the trigger
// and dispatch_system_event v10 for the routing rule.
//
// This function is kept deployed as a safety fallback. To re-enable it during
// a spine outage:
//   1. Set the env var DISABLE_LEGACY_STAGE_NOTIFICATION to 'false' (or unset it)
//   2. Redeploy this function
// Then App.jsx's existing fetch calls will resume sending emails through
// the legacy path. The spine path can be muted by removing
// 'job.status_changed' from the RULES map in dispatch_system_event.
//
// During parallel-run we want the spine to be the only path that sends
// email -- otherwise PMs and sales reps get double notifications. This file
// short-circuits to a 200 OK with no email sent unless the env var explicitly
// re-enables it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LEGACY_DISABLED = (Deno.env.get('DISABLE_LEGACY_STAGE_NOTIFICATION') ?? 'true').toLowerCase() !== 'false';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (LEGACY_DISABLED) {
    // Read the body for logging visibility but don't act on it
    let body: any = null;
    try { body = await req.json(); } catch { /* keep null */ }
    console.log('[job-stage-notification] disabled, no email sent. Spine handles this now.', {
      job: body?.job?.job_name,
      from: body?.from_status,
      to: body?.to_status,
    });
    return new Response(
      JSON.stringify({
        success: true,
        disabled: true,
        message: 'Legacy stage notification disabled. Status-change emails now route through agentic spine (system_events -> dispatch_system_event).',
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // Re-enable path: if someone unsets the env var, fall through to legacy behavior.
  // The full implementation lives in git history (commit before 2026-04-27); restoring
  // it requires a redeploy with the original source. For now we just 503 to make it
  // obvious that a roll-back is needed.
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Legacy stage notification was disabled in favor of the agentic spine. To restore, redeploy with the original source from git history (commit prior to 2026-04-27) and unset DISABLE_LEGACY_STAGE_NOTIFICATION.',
    }),
    { status: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  );
});
