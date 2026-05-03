// production-scheduler edge function
//
// Generates a 4-week production schedule from the queue. Receives:
//   - jobs:           the eligible job list with material requirements
//   - weekStart, horizonEnd: the planning horizon
//   - styleCapacity:  per-style daily LF limits from v_mold_capacity (added 2026-05-03)
//   - poolCapacity:   per-mold-family pool limits for shared molds (added 2026-05-03)
//   - installCrewLfPerDay: 50 LF/day per 4-person crew (per David)
//   - leaderCount: total active W-2 crew leaders
//
// Emits a JSON schedule to be persisted in ai_schedule_entries.
//
// 2026-05-03: replaced flat "5000 LF/weekday" with per-style + per-pool limits.
// Mold-pool sharing example: Wood + Boxed Wood + Vertical Wood share one
// 26-mold pool — running them in parallel can't exceed pool capacity total.
//
// Bumped model claude-sonnet-4-20250514 -> claude-sonnet-4-5.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = 'claude-sonnet-4-5';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = () => new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!ANTHROPIC_KEY) {
    console.error('ANTHROPIC_API_KEY not configured');
    return new Response(
      JSON.stringify({ error: 'Configuration error', details: 'ANTHROPIC_API_KEY not set' }),
      { status: 500, headers: jsonHeaders() }
    );
  }

  try {
    const body = await req.json();
    const {
      jobs,
      weekStart,
      horizonEnd,
      styleCapacity,            // [{style, mold_pool_family, bottleneck_lf_per_day, bottleneck_component, panel_lf, panels_per_mold}, ...]
      poolCapacity,             // [{mold_pool_family, pool_capacity_lf_per_day}, ...]
      installCrewLfPerDay,      // 50 (default)
      leaderCount,              // 26 (default)
    } = body;

    const businessDays: string[] = [];
    const cursor = new Date(weekStart + 'T12:00:00Z');
    const end = new Date(horizonEnd + 'T12:00:00Z');
    while (cursor <= end) {
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        businessDays.push(cursor.toISOString().split('T')[0]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const slimJobs = (jobs || []).map((j: any) => ({
      n: j.job_number,
      name: j.job_name?.slice(0, 40),
      lf: j.lf,
      style: j.style?.slice(0, 30),
      color: j.color?.slice(0, 15),
      ht: j.height,
      install: j.install_date,
      posts: (j.posts_line || 0) + (j.posts_corner || 0) + (j.posts_stop || 0),
      panels: (j.panels_regular || 0) + (j.panels_half || 0),
      caps: (j.caps_line || 0) + (j.caps_stop || 0),
      status: j.status,
      produced_lf: j.produced_lf || 0,
    }));

    // Compact representation of per-style limits — only styles in the job list,
    // with the fields the AI needs to reason about constraints.
    const slimStyleCapacity = Array.isArray(styleCapacity)
      ? styleCapacity.map((s: any) => ({
          style: s.style,
          pool: s.mold_pool_family,
          lf_per_day: s.bottleneck_lf_per_day,
          bottleneck: s.bottleneck_component,
          panel_lf: s.panel_lf,
          panels_per_mold: s.panels_per_mold,
        }))
      : [];

    const slimPoolCapacity = Array.isArray(poolCapacity)
      ? poolCapacity.map((p: any) => ({
          pool: p.mold_pool_family,
          pool_lf_per_day: p.pool_capacity_lf_per_day,
        }))
      : [];

    const crewWeeklyLF = (Number(leaderCount) || 26) * (Number(installCrewLfPerDay) || 50) * 5;

    const systemPrompt = `You are a production scheduling AI for Fencecrete America, a precast concrete fence manufacturer.

PLANT OPERATING REALITY:
- Plant runs 2 shifts: Shift 1 Mon-Sat 8a-4p + Shift 2 Mon-Fri 6p-2a (88h/wk vs 168h theoretical, derate ≈ 0.524).
- Every panel mold is a 12-cavity gang mold: 1 cycle pours 12 panels.
- Panel LF and cycle time vary per style; capacity per style is provided in style_capacity (already factors in cure_time, gang molds, and bottleneck component).

PER-STYLE DAILY LIMITS (do not exceed):
The style_capacity input tells you each style's bottlenecked_lf_per_day. This is the
realistic daily plant output AFTER the binding constraint (panels, posts, rails, OR caps —
whichever is shortest for that style). NEVER schedule more LF for a style on a single day
than its bottleneck_lf_per_day.

MOLD POOL SHARING (additional constraint):
Some style families share one panel-mold pool. If multiple styles in the same mold_pool_family
run on the same day, their COMBINED LF cannot exceed the pool's pool_capacity_lf_per_day.
Example: Wood + Boxed Wood + Vertical Wood share a 26-mold pool. You can run any one of them
at full pool capacity, OR split between them — but the total can't exceed the pool's daily LF.

INSTALL-VS-PRODUCTION RACE CHECK:
Install crews can install ${installCrewLfPerDay || 50} LF/day per crew (1 lead + 3 helpers = 4 people).
Total install capacity = ${leaderCount || 26} leaders × ${installCrewLfPerDay || 50} LF/day × 5 days = ${crewWeeklyLF} LF/week.
If a job's panels finish but install can't keep up, flag it in notes: "panels ready ahead of install — Houston install backlog".

PRIORITY (in order):
1. INSTALL DATE: jobs with earliest install dates get scheduled first.
2. POSTS-FIRST: Posts can be produced before panels. If a job's install date is close,
   schedule posts on an earlier day, panels later. Posts ≈ 20% of LF, panels ≈ 80% by default
   (use actual job posts/panels counts when present).
3. SIZE: among jobs with similar install dates, schedule larger LF jobs first.
4. STYLE+COLOR BATCHING: batch same style/color back-to-back to reduce mold changeover (~25 min
   per change). May delay panels (NOT posts) by up to 3 days for batching.

RULES:
- ONLY schedule on these exact business days: ${businessDays.join(', ')}
- NEVER schedule on weekends — no Saturdays or Sundays
- Per-style daily limit from style_capacity[].lf_per_day MUST NOT be exceeded
- Pool limit from pool_capacity[].pool_lf_per_day MUST NOT be exceeded across styles in same pool
- Split large jobs across multiple days when needed
- production_type: "posts" | "panels" | "caps" | "full"
- If a style has no entry in style_capacity, treat as 200 LF/day default and add a note.

OUTPUT (minified JSON only, no markdown):
{
  "reasoning": "2-4 sentence summary citing key constraints encountered",
  "schedule": [
    {"n":"JOB_NUM","name":"NAME","date":"YYYY-MM-DD","type":"posts|panels|full",
     "lf":NUMBER,"style":"STYLE","color":"COLOR","install":"YYYY-MM-DD",
     "seq":1,"notes":"optional — flag any constraints hit"}
  ]
}`;

    const userPrompt = `Today: ${new Date().toISOString().split('T')[0]}.
Schedule ONLY these ${businessDays.length} business days: ${businessDays.join(', ')}.

style_capacity (per-style daily limits — DO NOT EXCEED):
${JSON.stringify(slimStyleCapacity)}

pool_capacity (per-pool combined daily limits when multiple styles share):
${JSON.stringify(slimPoolCapacity)}

Jobs to schedule:
${JSON.stringify(slimJobs)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: 'Anthropic API error', status: response.status, anthropic_error: data?.error?.message || JSON.stringify(data) }),
        { status: 502, headers: jsonHeaders() }
      );
    }

    const rawText = data.content?.[0]?.text || '';
    let parsed;
    try {
      const clean = rawText.replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch(e2) {
          console.error('JSON parse failed:', e2, rawText.slice(0, 300));
          return new Response(
            JSON.stringify({ error: 'Invalid JSON from AI', raw: rawText.slice(0, 300) }),
            { status: 502, headers: jsonHeaders() }
          );
        }
      } else {
        console.error('No JSON in response:', rawText.slice(0, 300));
        return new Response(
          JSON.stringify({ error: 'Invalid JSON from AI', raw: rawText.slice(0, 300) }),
          { status: 502, headers: jsonHeaders() }
        );
      }
    }

    if (parsed.schedule) {
      parsed.schedule = parsed.schedule
        .filter((e: any) => {
          if (!e.date) return false;
          const d = new Date(e.date + 'T12:00:00Z').getUTCDay();
          return d !== 0 && d !== 6;
        })
        .map((e: any) => ({
          job_number: e.n || e.job_number,
          job_name: e.name || e.job_name,
          date: e.date,
          production_type: e.type || e.production_type || 'full',
          planned_lf: e.lf || e.planned_lf || 0,
          planned_posts: e.posts || e.planned_posts || 0,
          planned_panels: e.panels || e.planned_panels || 0,
          planned_caps: e.caps || e.planned_caps || 0,
          style: e.style || '',
          color: e.color || '',
          height: e.ht || e.height || '',
          install_date: e.install || e.install_date || null,
          total_job_lf: e.total_lf || e.total_job_lf || 0,
          day_sequence: e.seq || e.day_sequence || 1,
          notes: e.notes || null,
        }));
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers: jsonHeaders() });

  } catch (error) {
    console.error('Edge function crashed:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: String(error) }),
      { status: 500, headers: jsonHeaders() }
    );
  }
});
