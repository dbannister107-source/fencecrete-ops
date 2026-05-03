// demand-copilot edge function
// Deno-runtime serverless function. Receives a structured snapshot of the
// Demand Planning dashboard data + a user question. Returns a grounded,
// actionable answer from Claude Haiku. No autonomous mutations — read-only
// analysis surfaced back to the dashboard.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MODEL = 'claude-haiku-4-5-20251001';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are the Fencecrete Demand Planning Co-Pilot. You help the CEO, CFO, and SVP of Operations at Fencecrete America (precast concrete fencing manufacturer, ~$27M revenue, target $60M by 2030) understand bottlenecks and make decisions.

You are given a JSON snapshot of the company's current operational state — production backlog by style, mold capacity, crew leader workload, schedule projections, pipeline forecasts, cash conversion, and exception flags.

Your job:
1. Answer the user's question directly using the snapshot data
2. Quantify whenever possible — cite numbers from the snapshot
3. Suggest specific actions, not generic advice
4. If the snapshot doesn't have the data needed to answer, say so clearly and explain what data would be needed
5. Stay grounded — don't speculate beyond what the data supports

You DO NOT take actions. You only analyze and explain.

Style:
- Direct, executive tone — no fluff
- Use numbers and data points
- Lead with the answer, then context
- Keep responses under 200 words unless the question demands more
- Format with short paragraphs or bullet points (not headers)

Critical context about Fencecrete:
- 4 markets: San Antonio (HQ), Houston (largest), Austin, DFW (subcontractor markets for AUS/DFW/CS)
- 26 W-2 crew leaders, mostly in HOU (15) and SA (11)
- Houston is the operational concentration risk
- Plant in San Antonio — molds are style-dedicated, color-agnostic

Crew & install rates (per David ground truth, 2026-05-03):
- Each install crew = 1 W-2 leader + 3 helpers = 4 people total. "Crew count" == "leader count".
- Per-crew install rates: precast 50 LF/day, masonry 60, architectural 80, wrought iron 150.
  Multiply by leader count for market-level weekly capacity (× 5 working days/wk).
- Worked example: 26 leaders × 50 LF × 5 = 6,500 LF/week of precast install capacity total
  before subs. Houston has 15 of those leaders.

Plant capacity (gang molds + component bottlenecks):
- Every panel mold is a 12-cavity gang mold: 1 production cycle/day → 12 panels per mold per day.
- BUT plant throughput per style is gated by whichever component is shortest — panels, posts,
  rails, or caps. Many styles are NOT panel-constrained today; they're rail- or cap-constrained.
- snapshot.plant_load includes bottleneck_component ('panels'|'posts'|'rails'|'caps') and
  bottlenecked_lf_per_day from view v_mold_capacity. Cite the component explicitly when
  discussing plant capacity for a style.
  Example: "Rock Style is capped at 191 LF/day plant output because of caps (28 cap molds),
  not panels — even though we have 28 panel molds (504 panels/day theoretical)."
- Hire-vs-buy framing: if plant.weeks_to_clear > crew.weeks_to_clear by a clear margin, the
  bottleneck_component is the binding constraint and crews hires won't help. Vice versa.

"Track 2" data hygiene work in progress: PM Daily Reports, crew leader assignment, mold cycle
time instrumentation. The PM Daily Report sample is still small (n=12 precast in 90 days);
default rates above are the operating assumption until n≥20 enables calibration.

Answering style:
- When user asks "can we hit X by Y," answer with the binding constraint (plant component or
  crews) explicitly, citing the numbers from the snapshot.
- Don't say "we have plenty of capacity" without naming the binding constraint.
`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const body = await req.json();
    const { question, snapshot, conversation } = body;

    if (!question || typeof question !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing question' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const snapshotJson = JSON.stringify(snapshot || {}, null, 2);
    const truncated = snapshotJson.length > 60000 ? snapshotJson.slice(0, 60000) + '\n... (truncated)' : snapshotJson;

    const messages = [];
    if (Array.isArray(conversation)) {
      for (const m of conversation) {
        if (m && typeof m.role === 'string' && typeof m.content === 'string') {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }

    messages.push({
      role: 'user',
      content: `<dashboard_snapshot>\n${truncated}\n</dashboard_snapshot>\n\nQuestion: ${question}`,
    });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(JSON.stringify({ error: `Claude API error: ${claudeRes.status} ${text}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const claudeData = await claudeRes.json();
    const answer = claudeData?.content?.[0]?.text || '(no response)';
    const usage = claudeData?.usage || {};

    return new Response(JSON.stringify({
      answer,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
