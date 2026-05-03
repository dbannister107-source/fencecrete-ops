import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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
    const { company, contacts, recentActivities, existingCustomer } = await req.json();

    const primaryContact = contacts?.find((c:any) => c.is_primary) || contacts?.[0];
    const contactName = primaryContact?.name || 'there';
    const contactTitle = primaryContact?.title || '';

    const activitySummary = recentActivities?.length > 0
      ? recentActivities.map((a:any) => `${a.activity_type}: ${a.subject || a.body?.slice(0,80)}`).join('; ')
      : 'No prior contact';

    const systemPrompt = `You are a senior business development writer for Fencecrete America, a Texas-based precast concrete fence manufacturer and installer.

Fencecrete facts:
- Manufactures and installs precast concrete fence systems across Texas (San Antonio, Houston, DFW, Austin)
- Current major customers include D.R. Horton, Lennar, KB Home, and Holmes Homes
- Known for: faster production lead times than competitors, local Texas presence, high-quality precast systems
- Precast concrete outperforms wood and vinyl on durability, HOA compliance, aesthetics, and long-term maintenance cost
- Can serve entire master-planned communities from one source — posts, panels, rails, caps

Email writing rules:
- 4-6 sentences MAX. Busy builders and developers do not read long emails.
- Open with something specific to their company or project — never generic openers
- ONE clear call to action (typically: quick call, site visit, or introduce to their purchasing manager)
- Sound like a person, not a template
- Never say "I hope this email finds you well" or "touching base" or "circle back"
- If existing customer: reference the relationship, focus on expanding to more communities
- If new prospect: lead with peer credibility (DR Horton, Lennar, KB) and Texas presence

Respond ONLY with minified JSON — no preamble, no backticks:
{"subject":"...","body":"...","reasoning":"1 sentence on the angle"}`;

    const userPrompt = `Draft a cold outreach email for this target:

Company: ${company.company_name}
Type: ${company.company_type}
Tier: ${company.tier}
Relationship: ${company.fencecrete_relationship}
Active communities: ${(company.active_communities||[]).join(', ') || 'unknown'}
Intelligence: ${company.relationship_notes || 'none'}
Next action goal: ${company.next_action || 'introduce Fencecrete'}
Contact: ${contactName}${contactTitle ? ', ' + contactTitle : ''}
Prior contact history: ${activitySummary}
Existing customer expanding: ${existingCustomer ? 'YES — focus on expanding to more communities' : 'NO — new prospect'}
Assigned rep: ${company.assigned_rep || 'Matt'}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('Anthropic API error:', resp.status, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: 'Anthropic API error', status: resp.status, anthropic_error: data?.error?.message || JSON.stringify(data) }),
        { status: 502, headers: jsonHeaders() }
      );
    }

    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr, clean.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'Invalid JSON from AI', raw: clean.slice(0, 300) }),
        { status: 502, headers: jsonHeaders() }
      );
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers: jsonHeaders() });

  } catch (err: any) {
    console.error('Edge function crashed:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: err.message }),
      { status: 500, headers: jsonHeaders() }
    );
  }
});
