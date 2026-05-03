// job-explainer edge function (v2 — corrected schema)
// Given a job_id, pull every signal we have on that job and ask Claude to
// explain timeline, slippage, risks, and what to watch.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get('SUPABASE_URL') || 'https://bdnwjokehfxudheshmmj.supabase.co';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MODEL = 'claude-haiku-4-5-20251001';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sb(endpoint: string): Promise<any> {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase error: ${res.status} on ${endpoint}: ${txt}`);
  }
  return res.json();
}

const SYSTEM_PROMPT = `You are the Fencecrete job diagnostic. Given a JSON snapshot of a single job (its current state, activity log, change orders, and PM daily reports), explain in plain language:

1. WHAT HAPPENED: A short timeline of the key milestones (contract, production start, install start, etc.)
2. WHERE IT IS NOW: Status, schedule vs. plan, what's blocking
3. WHY IT SLIPPED (if behind): Root causes — weather, change orders, material delays, crew availability, soil/terrain issues, customer-driven changes, or PM reporting gaps. Use the delay_reason and delay_notes fields when present.
4. RISKS GOING FORWARD: What could still go wrong
5. RECOMMENDED ACTIONS: 1-3 specific next steps for the PM or planner

Be direct and grounded — only state things supported by the data. If a question can't be answered from the data, say so. Use exact dates and dollar amounts where available.

Format as plain text with section headers in CAPS. Keep under 350 words.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const body = await req.json();
    const { job_id } = body;
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'Missing job_id' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const [jobRows, activityRows, coRows, reportRows] = await Promise.all([
      sb(`jobs?id=eq.${job_id}&select=*`),
      sb(`activity_log?job_id=eq.${job_id}&select=created_at,action,field_name,old_value,new_value,changed_by&order=created_at.desc&limit=80`),
      sb(`change_orders?job_id=eq.${job_id}&select=co_number,date_submitted,date_approved,amount,description,status&order=date_submitted.asc`),
      sb(`pm_daily_reports?job_id=eq.${job_id}&select=report_date,lf_panels_installed,fence_style,delay_reason,delay_time,lf_impacted_by_delays,weather_condition,weather_notes,delay_notes,general_notes,crew_leader_id&order=report_date.asc`),
    ]);

    if (!jobRows || jobRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    const job = jobRows[0];

    const compactJob = {
      job_number: job.job_number,
      job_name: job.job_name,
      status: job.status,
      market: job.market,
      style: job.style,
      total_lf: job.total_lf,
      contract_value: job.adj_contract_value || job.contract_value,
      ytd_invoiced: job.ytd_invoiced,
      left_to_bill: job.left_to_bill,
      contract_date: job.contract_date,
      est_start_date: job.est_start_date,
      est_complete_date: job.est_complete_date,
      install_duration_days: job.install_duration_days,
      install_rate_override: job.install_rate_override,
      active_entry_date: job.active_entry_date,
      pm: job.pm,
      crew_leader_id: job.crew_leader_id,
    };

    const snapshot = {
      job: compactJob,
      activity_log: activityRows.map((a: any) => ({
        date: a.created_at,
        action: a.action,
        field: a.field_name,
        from: a.old_value,
        to: a.new_value,
        by: a.changed_by,
      })),
      change_orders: coRows,
      pm_reports: reportRows,
      today: new Date().toISOString().slice(0, 10),
    };

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `<job_snapshot>\n${JSON.stringify(snapshot, null, 2)}\n</job_snapshot>\n\nDiagnose this job. Why is it where it is? What should the PM do?`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      return new Response(JSON.stringify({ error: `Claude API: ${claudeRes.status} ${t}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    const claudeData = await claudeRes.json();
    const explanation = claudeData?.content?.[0]?.text || '(no response)';
    const usage = claudeData?.usage || {};

    return new Response(JSON.stringify({
      explanation,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      data_summary: {
        activity_events: activityRows.length,
        change_orders: coRows.length,
        pm_reports: reportRows.length,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
