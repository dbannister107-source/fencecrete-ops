// supabase/functions/chat-assistant/index.ts
// FCA Assistant — Phase 1 help/FAQ chatbot backed by Anthropic Claude.
// Deploy via: supabase functions deploy chat-assistant --no-verify-jwt
// Required secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const SYSTEM_PROMPT = `You are the FCA Assistant — a helpful guide built into the Fencecrete America project tracker app. You help users understand the app, answer questions about fields and features, and explain how to do things.

ABOUT THE APP:
This is the Fencecrete Ops Platform — a web app for managing precast concrete fence projects across 4 Texas markets: San Antonio (SA), Houston (H), Dallas-Fort Worth (D), and Austin (A).

KEY PAGES:
- Dashboard: CEO overview with weekly digest, KPIs, billing alerts
- Projects: Master list of all jobs with filters, search, edit panel. 71 data columns per job.
- Production Board: Kanban board for tracking production status. Can group by customer, style, or color.
- Production Planning: Where Max schedules daily production runs
- Daily Production Report: Where Luis logs actual pieces/LF produced per shift
- Material Calculator: Calculates panels, posts, rails needed for a job based on LF and height
- PM Bill Sheet: Billing view for Project Managers showing contract values, invoiced amounts, % billed, left to bill, plus accent/add-on columns
- Install Schedule: Calendar + list + Gantt chart for install scheduling
- Weather Days: Log weather delays by market and date
- Change Order Log: Track change orders by job with approval workflow
- PM Daily Report: Field reports from PMs logging daily install progress
- Reports: 6 built-in reports with charts

KEY TERMINOLOGY:
- Job Code format: 26H015 = year (26) + market letter (H=Houston, A=Austin, D=DFW, S=SA, CS=Central/Special) + sequence number. Residential jobs use plain numbers like 10167.
- LF = Linear Feet (how fence is measured)
- PC = Precast (produced in-house at the SA plant)
- SW = Single Wythe (masonry/brick, purchased and installed)
- WI = Wrought Iron (purchased and installed)
- Gates = purchased and installed, measured in pieces not LF
- Columns (C) = associated with single wythe jobs
- Add-Ons: G=Gates, WI=Wrought Iron, C=Columns
- Primary Type: PC, Masonry, or WI
- Status flow: Contract Review → Inventory Ready → In Production → Active Install → Closed
- PM = Project Manager: Ray (SA), Manuel (Houston Precast), Rafael Jr. (Houston Masonry/SW), Doug (DFW & Austin)

KEY FIELDS:
- Net Contract Value: base contract amount before tax
- Sales Tax: tax amount (or "Exempt")
- Contract Value: net + tax
- Adj Contract Value: contract value + approved change orders
- YTD Invoiced: total invoiced to date
- % Billed: YTD Invoiced ÷ Adj Contract Value (auto-calculated)
- Left to Bill: Adj Contract Value - YTD Invoiced (auto-calculated)
- Style: fence panel style (Rock Style, Vertical Wood 6', Block Style, etc.)
- Color: 6 standard colors for new projects: LAC, Silversmoke #860, Café, Outback #677, Regular Brown, Buff Green. Legacy colors exist on older jobs.
- is_produced: true = precast (made in plant), false = purchased item

PEOPLE:
- David Bannister: CEO
- Alex Hanno: CFO
- Amiee: Contracts admin, enters new projects
- Mary & Virginia: Accounting/billing
- Max: Production scheduler
- Luis: Daily production reporting
- Matt, Laura, Yuda, Nathan, Ryne: Sales reps

RULES:
- You ONLY answer questions about the app, its features, fields, and workflows
- You do NOT access, query, or modify any data
- You do NOT make promises about features that don't exist yet
- Keep answers concise and practical
- If you don't know something, say so and suggest they contact David`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// @ts-ignore — Deno runtime global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await req.json();
    const { messages, currentPage } = body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or empty messages array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // @ts-ignore — Deno runtime global
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server missing ANTHROPIC_API_KEY secret' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const contextualSystem = `${SYSTEM_PROMPT}\n\nCONTEXT: The user is currently on the "${currentPage || 'dashboard'}" page. Tailor examples and suggestions to that page when relevant.`;
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: contextualSystem,
        messages,
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      const msg = data?.error?.message || `Anthropic API error ${apiRes.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const text = Array.isArray(data?.content) && data.content[0]?.text ? data.content[0].text : '';
    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
