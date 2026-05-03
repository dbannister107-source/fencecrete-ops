import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_ADDRESS = 'Fencecrete Ops <ops@mail.fencecrete.com>';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = () => new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });

const sbFetch = async (path: string, opts: any = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  return r.json();
};

async function runResearch(): Promise<{ newCompanies: any[]; digest: string }> {
  const existing: any[] = await sbFetch('prospect_companies?select=company_name,relationship_notes');
  const existingNames = new Set(existing.map((c: any) => c.company_name.toLowerCase()));

  const today = new Date().toISOString().split('T')[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const systemPrompt = `You are a business development research agent for Fencecrete America, a Texas-based precast concrete fence manufacturer serving San Antonio, Houston, DFW, and Austin.

Your job: Research and identify NEW master-planned community (MPC) developers and homebuilders active in the San Antonio metro area that Fencecrete should be prospecting.

Fencecrete's ideal customer profile:
- National homebuilders (like DR Horton, Lennar, KB Home, Taylor Morrison, Meritage, Pulte)
- Regional Texas homebuilders (Perry Homes, David Weekley, Scott Felder, LGI)
- MPC land developers (like Southstar, Forestar, Bitterblue, Provident Realty)
- Anyone building 50+ residential lots in SA metro requiring perimeter or community fencing

For each new target found, extract:
- company_name: exact company name
- company_type: 'homebuilder' | 'mpc_developer' | 'gc'
- tier: 'A' (national/large regional) | 'B' (smaller regional) | 'C' (local/small)
- website: domain only (no https://), or null
- hq_city: headquarters city
- active_communities: array of SA-area community names
- estimated_annual_lots: rough estimate of annual lot deliveries in SA, or null
- relationship_notes: 2-3 sentence summary of who they are, what communities they're building, why Fencecrete should contact them
- next_action: specific first outreach action
- source_url: the URL or source where this was found

Only include companies NOT in this existing list: ${JSON.stringify([...existingNames])}

Return ONLY valid minified JSON — no preamble, no backticks:
{
  "research_summary": "2-3 sentence summary of SA MPC market conditions this week",
  "new_targets": [
    {
      "company_name": "...",
      "company_type": "homebuilder",
      "tier": "A",
      "website": "example.com",
      "hq_city": "San Antonio",
      "active_communities": ["Community Name (location)"],
      "estimated_annual_lots": 300,
      "relationship_notes": "...",
      "next_action": "...",
      "source_url": "https://..."
    }
  ],
  "market_intel": [
    "Bullet point of SA MPC market intelligence relevant to Fencecrete sales"
  ]
}`;

  const userPrompt = `Research date range: ${oneWeekAgo} to ${today}

Search for and report on:
1. New master-planned community announcements or groundbreakings in San Antonio metro (Bexar, Comal, Medina, Guadalupe counties)
2. Homebuilders expanding into new SA communities
3. New land development companies active in SA residential
4. Any press releases, news articles, or permits about large residential subdivision activity in SA area
5. Builder rankings or new entrants to the SA market

Focus on companies with 50+ lots. Prioritize: new community announcements, groundbreakings, new builder entrants to SA market, phase expansions of existing large communities.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(`Anthropic API error: ${resp.status} - ${data?.error?.message || JSON.stringify(data)}`);
  }

  let resultText = '';
  for (const block of (data.content || [])) {
    if (block.type === 'text') {
      resultText = block.text;
      break;
    }
  }

  const clean = resultText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (parseErr) {
    throw new Error(`Invalid JSON from AI: ${clean.slice(0, 300)}`);
  }

  const newTargets = (parsed.new_targets || []).filter(
    (t: any) => !existingNames.has((t.company_name || '').toLowerCase())
  );

  const inserted: any[] = [];
  for (const t of newTargets) {
    try {
      const result = await sbFetch('prospect_companies', {
        method: 'POST',
        body: JSON.stringify({
          company_name: t.company_name,
          company_type: t.company_type || 'homebuilder',
          tier: t.tier || 'B',
          website: t.website || null,
          hq_city: t.hq_city || null,
          hq_state: 'TX',
          markets_active: ['San Antonio'],
          active_communities: t.active_communities || [],
          estimated_annual_lots: t.estimated_annual_lots || null,
          known_fence_spend: 'unknown',
          fencecrete_relationship: 'prospect',
          relationship_notes: t.relationship_notes || '',
          assigned_rep: t.tier === 'A' ? 'Matt' : 'Laura',
          status: 'new',
          source: 'ai_research',
          next_action: t.next_action || 'Research and identify key contact',
          next_action_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        }),
      });
      if (Array.isArray(result) && result[0]?.id) {
        inserted.push({ ...t, id: result[0].id });
        await sbFetch('prospect_activities', {
          method: 'POST',
          body: JSON.stringify({
            company_id: result[0].id,
            activity_type: 'note',
            subject: 'Auto-discovered by AI Research Agent',
            body: `Source: ${t.source_url || 'AI web research'}\n\n${t.relationship_notes}`,
            ai_generated: true,
            created_by: 'prospect-researcher',
            activity_date: new Date().toISOString(),
          }),
        });
      }
    } catch (e) {
      console.error('Insert error:', e);
    }
  }

  const digest = [
    `**SA MPC Research Digest — ${today}**`,
    '',
    `**Market Summary:** ${parsed.research_summary || 'No summary available.'}`,
    '',
    inserted.length > 0
      ? `**${inserted.length} New Target${inserted.length > 1 ? 's' : ''} Added to Prospecting:**\n` +
        inserted.map(t => `• **${t.company_name}** (Tier ${t.tier}) — ${t.relationship_notes?.split('.')[0]}.`).join('\n')
      : '**No new targets found this week** — all identified companies already in your system.',
    '',
    (parsed.market_intel || []).length > 0
      ? `**Market Intelligence:**\n` + (parsed.market_intel || []).map((m: string) => `• ${m}`).join('\n')
      : '',
    '',
    `View your full prospecting list: https://fencecrete-ops.vercel.app`,
  ].filter(Boolean).join('\n');

  return { newCompanies: inserted, digest };
}

async function sendDigestEmail(digest: string, newCount: number) {
  if (!RESEND_KEY) return;

  const html = digest
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/• /g, '&bull; ')
    .replace(/\n/g, '<br>');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      reply_to: 'ops@fencecrete.com',
      to: ['david@fencecrete.com', 'alex@fencecrete.com'],
      subject: `🎯 SA Prospect Research — ${newCount} new target${newCount !== 1 ? 's' : ''} found`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;"><div style="background:#8B2020;padding:20px;border-radius:8px 8px 0 0;"><h2 style="color:white;margin:0;font-size:20px;">🎯 SA MPC Prospect Research</h2><p style="color:#f4f4f2;margin:4px 0 0;font-size:13px;">Weekly AI Research Digest</p></div><div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;font-size:14px;line-height:1.7;">${html}</div></div>`,
    }),
  });
  if (!r.ok) {
    const errBody = await r.text();
    console.error(`Resend send failed: ${errBody}`);
  }
}

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
    console.log('Starting SA MPC prospect research...');
    const { newCompanies, digest } = await runResearch();

    await sendDigestEmail(digest, newCompanies.length);

    return new Response(JSON.stringify({
      success: true,
      new_targets_found: newCompanies.length,
      companies: newCompanies.map(c => c.company_name),
      digest,
    }), { status: 200, headers: jsonHeaders() });

  } catch (err: any) {
    console.error('Research error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: jsonHeaders() });
  }
});
