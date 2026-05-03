// demand-digest edge function
// Compiles a snapshot of demand-planning data, asks Claude Haiku for a
// 150-word executive summary of what changed and what needs attention,
// and emails it to David, Alex, and Carlos.
//
// Triggers:
//   - Manual: GET or POST to this URL (any auth)
//   - Future: pg_cron daily at 6am Central

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get('SUPABASE_URL') || 'https://bdnwjokehfxudheshmmj.supabase.co';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const MODEL = 'claude-haiku-4-5-20251001';

const RECIPIENTS = [
  'david@fencecrete.com',
  'alex@fencecrete.com',
  'ccontreras@fencecrete.com',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

async function sb(endpoint: string): Promise<any> {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} on ${endpoint}`);
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // Optional: dryRun flag to test without sending email
    let dryRun = false;
    let testRecipient: string | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        dryRun = !!body?.dryRun;
        testRecipient = body?.testRecipient || null;
      } catch (_) {}
    }

    // ─── Pull snapshot ───
    const [jobs, leaders, reports, leads, rates] = await Promise.all([
      sb('jobs?select=id,job_number,status,market,style,total_lf,adj_contract_value,left_to_bill,est_start_date,est_complete_date,install_duration_days,crew_leader_id,pm,contract_date'),
      sb('crew_leaders?select=*&active=eq.true'),
      sb('pm_daily_reports?select=lf_panels_installed,fence_style,crew_leader_id,report_date&lf_panels_installed=gt.0&order=report_date.desc&limit=200'),
      sb('leads?select=stage,proposal_value,win_probability,expected_close_date&stage=in.(proposal_sent,qualifying,new_lead)'),
      sb('install_rates?select=*'),
    ]);

    // Compute key metrics
    const CLOSED = new Set(['closed', 'cancelled']);
    const openJobs = jobs.filter((j: any) => !CLOSED.has(j.status));
    const activeInstall = openJobs.filter((j: any) => j.status === 'active_install');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const fortnight = new Date(today); fortnight.setDate(today.getDate() + 14);
    const materialRisk = openJobs.filter((j: any) => {
      if (!j.est_start_date) return false;
      const start = new Date(j.est_start_date);
      const days = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return days >= -7 && days <= 14 && !['material_ready', 'active_install'].includes(j.status);
    });

    // Crew load by market
    const crewByMkt: Record<string, any> = {};
    activeInstall.forEach((j: any) => {
      const mkt = j.market || 'unknown';
      if (!crewByMkt[mkt]) crewByMkt[mkt] = { market: mkt, lf: 0, jobs: 0, install_days: 0 };
      crewByMkt[mkt].lf += Number(j.total_lf) || 0;
      crewByMkt[mkt].jobs += 1;
      crewByMkt[mkt].install_days += Number(j.install_duration_days) || 0;
    });
    const MKT_LONG = { 'San Antonio': 'SA', 'Houston': 'HOU', 'Austin': 'AUS', 'Dallas-Fort Worth': 'DFW', 'College Station': 'CS' };
    leaders.forEach((cl: any) => {
      const short = (MKT_LONG as any)[cl.market];
      if (!short) return;
      if (!crewByMkt[short]) crewByMkt[short] = { market: short, lf: 0, jobs: 0, install_days: 0, leaders: 0 };
      crewByMkt[short].leaders = (crewByMkt[short].leaders || 0) + 1;
    });

    // Pipeline expected
    let pipeline_expected = 0, pipeline_value = 0;
    leads.forEach((l: any) => {
      const v = Number(l.proposal_value) || 0;
      pipeline_value += v;
      pipeline_expected += v * ((Number(l.win_probability) || 0) / 100);
    });

    const snapshot = {
      summary: {
        open_jobs: openJobs.length,
        active_install: activeInstall.length,
        backlog_lf: openJobs.reduce((s: number, j: any) => s + (Number(j.total_lf) || 0), 0),
        contract_value: openJobs.reduce((s: number, j: any) => s + (Number(j.adj_contract_value) || 0), 0),
        left_to_bill: openJobs.reduce((s: number, j: any) => s + (Number(j.left_to_bill) || 0), 0),
      },
      crew_load: Object.values(crewByMkt),
      material_risks_count: materialRisk.length,
      material_risks_critical: materialRisk.filter((j: any) => {
        const start = new Date(j.est_start_date);
        const days = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return days < 3;
      }).length,
      pipeline: {
        active_proposals: leads.length,
        proposal_value: Math.round(pipeline_value),
        expected_value: Math.round(pipeline_expected),
      },
      data_coverage: {
        pm_reports_recent: reports.length,
        active_jobs_with_leader: activeInstall.filter((j: any) => j.crew_leader_id).length,
        active_jobs_total: activeInstall.length,
      },
      install_rates: rates.map((r: any) => ({ category: r.category, lf_per_day: r.lf_per_day, source: r.data_source })),
    };

    // ─── Ask Claude for digest ───
    const SYSTEM = `You are writing the Fencecrete daily executive digest. Audience: CEO David, CFO Alex, SVP Ops Carlos. Each is busy.\n\nFormat the email as plain text (no markdown headers, no asterisks). Sections:\n1. ONE-LINE STATUS ("backlog up X, schedule on track, Y critical issues")\n2. TOP 3 THINGS TO LOOK AT (numbered, each 1 sentence + the dashboard tab name in parens)\n3. ONE NUMBER WORTH KNOWING (a metric David would mention to investors)\n\nKeep it under 200 words total. Be direct. Numbers, not adjectives. No emoji except the section dividers below.`;

    const userMsg = `<dashboard_snapshot>\n${JSON.stringify(snapshot, null, 2)}\n</dashboard_snapshot>\n\nWrite today's digest email body. Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 600, system: SYSTEM, messages: [{ role: 'user', content: userMsg }] }),
    });

    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      return new Response(JSON.stringify({ error: `Claude API: ${claudeRes.status} ${t}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    const claudeData = await claudeRes.json();
    const digest = claudeData?.content?.[0]?.text || '(no response)';

    if (dryRun) {
      return new Response(JSON.stringify({ digest, snapshot, sent: false }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ─── Send via Resend ───
    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured', digest }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1A1A1A;max-width:600px;">
      <h2 style="font-family:Syne,sans-serif;color:#8A261D;font-size:18px;margin:0 0 16px;">Fencecrete Daily Digest</h2>
      <pre style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;color:#1A1A1A;">${digest.replace(/[<>&]/g, (c: string) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c])}</pre>
      <div style="margin-top:24px;padding-top:14px;border-top:1px solid #E5E3E0;font-size:11px;color:#9E9B96;">
        Auto-generated by Demand Planner Co-Pilot · <a href="https://fencecrete-ops.vercel.app/" style="color:#8A261D;">Open dashboard</a>
      </div>
    </div>`;

    const to = testRecipient ? [testRecipient] : RECIPIENTS;
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Fencecrete <onboarding@resend.dev>',  // → noreply@mail.fencecrete.com once DNS verified
        to,
        subject: `Fencecrete Daily Digest — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        html,
      }),
    });
    const emailData = await emailRes.json();

    return new Response(JSON.stringify({ digest, sent: emailRes.ok, to, email_response: emailData }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
