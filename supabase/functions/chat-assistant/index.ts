import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

async function querySupabase(endpoint: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

async function getDataAnswer(question: string): Promise<string | null> {
  const q = question.toLowerCase();
  const pmMatch = q.match(/(?:left to bill|ltb|pipeline|balance).*?(?:for|by)?\s+(ray|manuel|rafael|doug|ray garcia|manuel salazar|rafael anaya|doug monroe)/) || q.match(/(ray|manuel|rafael|doug|ray garcia|manuel salazar|rafael anaya|doug monroe).*?(?:left to bill|ltb|pipeline|balance)/);
  if (pmMatch) {
    const pmName = pmMatch[1].toLowerCase();
    const pmMap: Record<string,string> = { ray:'Ray Garcia', manuel:'Manuel Salazar', rafael:'Rafael Anaya Jr.', doug:'Doug Monroe', 'ray garcia':'Ray Garcia', 'manuel salazar':'Manuel Salazar', 'rafael anaya':'Rafael Anaya Jr.', 'doug monroe':'Doug Monroe' };
    const pm = pmMap[pmName];
    if (pm) {
      const jobs = await querySupabase(`jobs?pm=eq.${encodeURIComponent(pm)}&status=not.in.(closed,canceled)&select=job_name,job_number,left_to_bill,ytd_invoiced,adj_contract_value,status`);
      const total = jobs.reduce((s: number, j: any) => s + parseFloat(j.left_to_bill || 0), 0);
      const totalContract = jobs.reduce((s: number, j: any) => s + parseFloat(j.adj_contract_value || 0), 0);
      const topJobs = [...jobs].sort((a: any, b: any) => parseFloat(b.left_to_bill) - parseFloat(a.left_to_bill)).slice(0, 5);
      return `${pm} has $${total.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})} left to bill across ${jobs.length} active jobs (total contract: $${totalContract.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}).\n\nTop jobs by remaining balance:\n${topJobs.map((j: any) => `• ${j.job_name} — $${parseFloat(j.left_to_bill).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})} remaining`).join('\n')}`;
    }
  }
  const pmJobsMatch = q.match(/(?:jobs?|projects?).*?(ray|manuel|rafael|doug|ray garcia|manuel salazar|rafael anaya|doug monroe)/) || q.match(/(ray|manuel|rafael|doug|ray garcia|manuel salazar|rafael anaya|doug monroe).*?(?:jobs?|projects?)/);
  if (pmJobsMatch && !pmMatch) {
    const pmName = pmJobsMatch[1].toLowerCase();
    const pmMap: Record<string,string> = { ray:'Ray Garcia', manuel:'Manuel Salazar', rafael:'Rafael Anaya Jr.', doug:'Doug Monroe', 'ray garcia':'Ray Garcia', 'manuel salazar':'Manuel Salazar', 'rafael anaya':'Rafael Anaya Jr.', 'doug monroe':'Doug Monroe' };
    const pm = pmMap[pmName];
    if (pm) {
      const jobs = await querySupabase(`jobs?pm=eq.${encodeURIComponent(pm)}&status=not.in.(closed,canceled)&select=job_name,job_number,status,adj_contract_value,left_to_bill&order=status.asc`);
      const statusLabel: Record<string,string> = { active_install:'Active Install', in_production:'In Production', material_ready:'Material Ready', production_queue:'Production Queue', contract_review:'Contract Review' };
      return `${pm} has ${jobs.length} active jobs:\n\n${jobs.map((j: any) => `• ${j.job_name} (${j.job_number}) — ${statusLabel[j.status]||j.status} — $${parseFloat(j.left_to_bill||0).toLocaleString('en-US',{maximumFractionDigits:0})} left to bill`).join('\n')}`;
    }
  }
  const marketMatch = q.match(/(houston|san antonio|dallas|austin|dfw).*?(?:pipeline|total|left to bill|balance|contract)/) || q.match(/(?:pipeline|total|left to bill|balance|contract).*?(houston|san antonio|dallas|austin|dfw)/);
  if (marketMatch) {
    const mktRaw = marketMatch[1].toLowerCase();
    const mktMap: Record<string,string> = { houston:'Houston', 'san antonio':'San Antonio', dallas:'Dallas-Fort Worth', dfw:'Dallas-Fort Worth', austin:'Austin' };
    const mkt = mktMap[mktRaw];
    if (mkt) {
      const jobs = await querySupabase(`jobs?market=eq.${encodeURIComponent(mkt)}&status=not.in.(closed,canceled)&select=adj_contract_value,ytd_invoiced,left_to_bill,status`);
      const ltb = jobs.reduce((s: number, j: any) => s + parseFloat(j.left_to_bill||0), 0);
      const contract = jobs.reduce((s: number, j: any) => s + parseFloat(j.adj_contract_value||0), 0);
      const invoiced = jobs.reduce((s: number, j: any) => s + parseFloat(j.ytd_invoiced||0), 0);
      return `${mkt} market — ${jobs.length} active jobs:\n• Total contract: $${contract.toLocaleString('en-US',{maximumFractionDigits:0})}\n• YTD invoiced: $${invoiced.toLocaleString('en-US',{maximumFractionDigits:0})}\n• Left to bill: $${ltb.toLocaleString('en-US',{maximumFractionDigits:0})}`;
    }
  }
  if (q.includes('unbilled') || q.includes('not been billed') || q.includes('never billed') || (q.includes('billed') && (q.includes('60') || q.includes('30') || q.includes('90') || q.includes('overdue')))) {
    const jobs = await querySupabase(`jobs?status=not.in.(closed,canceled,contract_review)&ytd_invoiced=eq.0&select=job_name,job_number,pm,market,adj_contract_value,contract_date&order=contract_date.asc`);
    if (jobs.length === 0) return `No active jobs with zero billing found.`;
    return `${jobs.length} active jobs with $0 invoiced:\n\n${jobs.slice(0,10).map((j: any) => `• ${j.job_name} (${j.job_number}) — ${j.pm||'No PM'} — $${parseFloat(j.adj_contract_value||0).toLocaleString('en-US',{maximumFractionDigits:0})}`).join('\n')}${jobs.length > 10 ? `\n...and ${jobs.length-10} more` : ''}`;
  }
  const jobLookup = q.match(/(?:what is|show me|tell me about|find|look up|status of)\s+(.{5,50}?)(?:'s|\?|$)/);
  if (jobLookup) {
    const search = jobLookup[1].trim();
    if (search.length > 3) {
      const jobs = await querySupabase(`jobs?or=(job_name.ilike.*${encodeURIComponent(search)}*,job_number.ilike.*${encodeURIComponent(search)}*)&select=job_name,job_number,status,pm,market,adj_contract_value,ytd_invoiced,left_to_bill,pct_billed&limit=3`);
      if (jobs.length > 0) {
        const j = jobs[0];
        const statusLabel: Record<string,string> = { active_install:'Active Install', in_production:'In Production', material_ready:'Material Ready', production_queue:'Production Queue', contract_review:'Contract Review', closed:'Closed' };
        return `${j.job_name} (${j.job_number}):\n• Status: ${statusLabel[j.status]||j.status}\n• PM: ${j.pm||'—'}\n• Market: ${j.market||'—'}\n• Contract: $${parseFloat(j.adj_contract_value||0).toLocaleString('en-US',{maximumFractionDigits:0})}\n• YTD Invoiced: $${parseFloat(j.ytd_invoiced||0).toLocaleString('en-US',{maximumFractionDigits:0})}\n• Left to Bill: $${parseFloat(j.left_to_bill||0).toLocaleString('en-US',{maximumFractionDigits:0})}\n• % Billed: ${Math.round(parseFloat(j.pct_billed||0)*100)}%`;
      }
    }
  }
  if (q.includes('change order') || q.includes(' co ') || q.includes('pending approval')) {
    const cos = await querySupabase(`change_orders?status=in.(pending,Pending)&select=co_number,amount,description,job_number,date_submitted&order=date_submitted.asc`);
    if (cos.length === 0) return 'No change orders pending approval right now.';
    const total = cos.reduce((s: number, c: any) => s + parseFloat(c.amount||0), 0);
    return `${cos.length} change orders pending Amiee's approval — total $${total.toLocaleString('en-US',{maximumFractionDigits:0})}:\n\n${cos.map((c: any) => `• CO #${c.co_number||'—'} on ${c.job_number} — $${parseFloat(c.amount||0).toLocaleString('en-US',{maximumFractionDigits:0})}${c.description?' — '+c.description.slice(0,50):''}`).join('\n')}`;
  }
  if (q.includes('production queue') || q.includes('in production') || (q.includes('production') && q.includes('schedule'))) {
    const jobs = await querySupabase(`jobs?status=in.(production_queue,in_production)&select=job_name,job_number,pm,lf_precast,est_start_date,style,color&order=est_start_date.asc.nullslast`);
    if (jobs.length === 0) return 'No jobs currently in the production queue.';
    return `${jobs.length} jobs in production queue/in production:\n\n${jobs.map((j: any) => `• ${j.job_name} — ${j.lf_precast?j.lf_precast.toLocaleString()+' LF ':''} ${j.style||''} ${j.color||''}${j.est_start_date?' — Install: '+new Date(j.est_start_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}`).join('\n')}`;
  }
  if (q.includes('material request') || q.includes('material order')) {
    const reqs = await querySupabase(`material_requests?status=in.(pending,acknowledged)&select=job_name,job_number,requested_by,status,linear_feet,material_style,created_at&order=created_at.asc`);
    if (reqs.length === 0) return 'No pending material requests right now.';
    return `${reqs.length} material requests pending:\n\n${reqs.map((r: any) => `• ${r.job_name} (${r.job_number}) — ${r.requested_by||'—'} — ${r.status} — ${r.linear_feet?r.linear_feet+' LF ':''} ${r.material_style||''}`).join('\n')}`;
  }
  if (q.includes('total') || q.includes('overall') || q.includes('company') || q.includes('summary') || q.includes('how much') || q.includes('pipeline')) {
    const jobs = await querySupabase(`jobs?status=not.in.(closed,canceled)&select=adj_contract_value,ytd_invoiced,left_to_bill,status`);
    const ltb = jobs.reduce((s: number, j: any) => s + parseFloat(j.left_to_bill||0), 0);
    const contract = jobs.reduce((s: number, j: any) => s + parseFloat(j.adj_contract_value||0), 0);
    const invoiced = jobs.reduce((s: number, j: any) => s + parseFloat(j.ytd_invoiced||0), 0);
    const byStatus: Record<string,number> = {};
    jobs.forEach((j: any) => { byStatus[j.status] = (byStatus[j.status]||0) + 1; });
    const statusLabel: Record<string,string> = { active_install:'Active Install', in_production:'In Production', material_ready:'Material Ready', production_queue:'Production Queue', contract_review:'Contract Review' };
    return `FCA Company Summary — ${jobs.length} active jobs:\n• Total contract: $${contract.toLocaleString('en-US',{maximumFractionDigits:0})}\n• YTD invoiced: $${invoiced.toLocaleString('en-US',{maximumFractionDigits:0})}\n• Left to bill: $${ltb.toLocaleString('en-US',{maximumFractionDigits:0})}\n\nBy status:\n${Object.entries(byStatus).map(([s,c]) => `• ${statusLabel[s]||s}: ${c} jobs`).join('\n')}`;
  }
  const overMatch = q.match(/(houston|san antonio|dallas|austin|dfw).*?(?:over|above|more than|>)\s*\$?([\d,]+)/);
  if (overMatch) {
    const mktRaw = overMatch[1].toLowerCase();
    const mktMap: Record<string,string> = { houston:'Houston', 'san antonio':'San Antonio', dallas:'Dallas-Fort Worth', dfw:'Dallas-Fort Worth', austin:'Austin' };
    const mkt = mktMap[mktRaw];
    const threshold = parseFloat(overMatch[2].replace(/,/g,''));
    if (mkt && threshold) {
      const jobs = await querySupabase(`jobs?market=eq.${encodeURIComponent(mkt)}&status=not.in.(closed,canceled)&adj_contract_value=gte.${threshold}&select=job_name,job_number,pm,adj_contract_value,left_to_bill,status&order=adj_contract_value.desc`);
      if (jobs.length === 0) return `No active ${mkt} jobs over $${threshold.toLocaleString()}.`;
      const statusLabel: Record<string,string> = { active_install:'Active Install', in_production:'In Production', material_ready:'Material Ready', production_queue:'Production Queue', contract_review:'Contract Review' };
      return `${jobs.length} active ${mkt} jobs over $${threshold.toLocaleString()}:\n\n${jobs.map((j: any) => `• ${j.job_name} (${j.job_number}) — $${parseFloat(j.adj_contract_value||0).toLocaleString('en-US',{maximumFractionDigits:0})} — ${statusLabel[j.status]||j.status} — PM: ${j.pm||'—'}`).join('\n')}`;
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are Chorizo 🌶️ — a helpful assistant built into the Fencecrete America project tracker app. You help users understand the app AND answer live questions about their jobs, billing, and operations.

You have access to live data from the FCA database. When users ask about specific jobs, PMs, markets, billing, or production — you will receive the actual data to answer with. Use it to give precise, helpful answers.

KEY TERMINOLOGY:
- LF = Linear Feet
- PC = Precast (produced in-house)
- SW = Single Wythe (masonry, purchased)
- WI = Wrought Iron (purchased)
- Left to Bill = contract value not yet invoiced
- Adj Contract Value = net contract + approved COs + permits + bonds + sales tax
- PMs: Ray Garcia (SA), Manuel Salazar (Houston Precast), Rafael Anaya Jr. (Houston Masonry/SW), Doug Monroe (DFW & Austin)
- Status flow: Contract Review → Production Queue → In Production → Material Ready → Active Install → Closed

Be concise and direct. When you have live data, lead with the numbers.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!ANTHROPIC_KEY) {
    console.error('ANTHROPIC_API_KEY not configured in Supabase secrets');
    return new Response(
      JSON.stringify({ error: 'Configuration error', details: 'ANTHROPIC_API_KEY not set' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  try {
    const body = await req.json();
    const messages = body.messages || [];
    const currentPage = body.currentPage || 'Dashboard';
    const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
    let dataContext = '';
    if (lastUserMsg) {
      try {
        const dataAnswer = await getDataAnswer(lastUserMsg.content);
        if (dataAnswer) dataContext = `\n\nLIVE DATA FROM FCA DATABASE:\n${dataAnswer}\n\nUse this data to answer the user's question directly and precisely.`;
      } catch(e) { console.error('Data query failed:', e); }
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: SYSTEM_PROMPT + `\nThe user is on the ${currentPage} page.` + dataContext, messages }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', response.status, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: 'Anthropic API error', status: response.status, anthropic_error: data?.error?.message || JSON.stringify(data) }),
        { status: 502, headers: CORS_HEADERS }
      );
    }
    const assistantMessage = data.content?.[0]?.text || 'Sorry, I could not generate a response.';
    return new Response(JSON.stringify({ message: assistantMessage }), { status: 200, headers: CORS_HEADERS });
  } catch (error) {
    console.error('Edge function crashed:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: String(error) }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
