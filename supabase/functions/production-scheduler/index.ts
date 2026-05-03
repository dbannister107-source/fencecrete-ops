import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

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
    const { jobs, weekStart, horizonEnd } = body;

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

    const slimJobs = jobs.map((j: any) => ({
      n: j.job_number,
      name: j.job_name?.slice(0, 40),
      lf: j.lf,
      style: j.style?.slice(0, 20),
      color: j.color?.slice(0, 15),
      ht: j.height,
      install: j.install_date,
      posts: (j.posts_line || 0) + (j.posts_corner || 0) + (j.posts_stop || 0),
      panels: (j.panels_regular || 0) + (j.panels_half || 0),
      status: j.status,
      produced_lf: j.produced_lf || 0,
    }));

    const systemPrompt = `You are a production scheduling AI for Fencecrete America, a precast concrete fence manufacturer.

CAPACITY: 5000 LF/weekday (2 shifts), 0 on weekends.

PRIORITY: 1) Install date (earliest first). 2) Size (larger first). 3) Style+color grouping (batch same style/color). 4) Posts-first: if delaying panels for grouping, schedule posts entry first on an earlier date.

RULES:
- ONLY schedule on these exact business days: ${businessDays.join(', ')}
- NEVER schedule on weekends — no Saturdays or Sundays
- Never exceed 5000 LF per day
- Split large jobs across multiple days if needed
- production_type: "posts" | "panels" | "full"
- Posts = ~20% of job LF, Panels = ~80%
- If capacity is exceeded, schedule highest priority jobs first
- Only output entries for the ${businessDays.length} business days listed above

Respond ONLY with minified JSON:
{"reasoning":"brief 2-3 sentence summary","schedule":[{"n":"JOB_NUM","name":"NAME","date":"YYYY-MM-DD","type":"posts|panels|full","lf":NUMBER,"style":"STYLE","color":"COLOR","install":"YYYY-MM-DD","seq":1,"notes":"optional"}]}`;

    const userPrompt = `Today: ${new Date().toISOString().split('T')[0]}.
Schedule ONLY these ${businessDays.length} business days: ${businessDays.join(', ')}.
Jobs to schedule: ${JSON.stringify(slimJobs)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
          planned_caps: 0,
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
