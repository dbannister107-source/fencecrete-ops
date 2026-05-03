import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const APP_URL = 'https://fencecrete-ops.vercel.app';
const LOGO_URL = `${APP_URL}/logo.png`;
const FROM_ADDRESS = 'Fencecrete <ops@mail.fencecrete.com>';

// =====================================================================
// BRAND EMAIL TEMPLATE — Fencecrete light theme (2026-04-29)
// Inline copy-pasted into each edge function. When updating brand colors,
// update all functions OR migrate to a shared module via deno.json imports.
// Reference: src/App.jsx for color authority.
// =====================================================================
const BRAND_RED = '#8A261D';
const BRAND_TEXT = '#1A1A1A';
const BRAND_TEXT2 = '#625650';
const BRAND_TEXT3 = '#9E9B96';
const BRAND_BORDER = '#E5E3E0';
const BRAND_PAGE = '#F9F8F6';
const BRAND_CARD = '#FFFFFF';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Events listed here are silently dropped instead of emailed.
// Status-change events (production_queue, ready_to_install, complete, lead_won)
// continue to fire normally. job_updated and new_job are paused per David's
// request 2026-04-27 to reduce email volume during reconciliation work. Unmute
// by removing from this Set and redeploying.
const MUTED_EVENTS = new Set<string>(['job_updated', 'new_job']);

const sb = async (path: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  return r.json();
};

const EVENT_ROLES: Record<string, string[]> = {
  new_job:          ['contracts', 'ceo'],
  production_queue: ['production', 'pm', 'ceo'],
  ready_to_install: ['pm', 'ceo'],
  complete:         ['ar', 'cfo', 'ceo'],
  billing_logged:   ['ar', 'cfo', 'ceo'],
  job_updated:      ['ceo'],
  pm_billing_entry: ['ar', 'cfo', 'ceo'],
  lead_won:         ['contracts', 'ceo'],
};

const EVENT_LABELS: Record<string, string> = {
  new_job:          'New Project Added',
  production_queue: 'Project Moved to Production Queue',
  ready_to_install: 'Project Ready to Install',
  complete:         'Project Marked Complete',
  billing_logged:   'Invoice Logged',
  job_updated:      'Project Updated',
  pm_billing_entry: 'PM Billing Entry Logged',
  lead_won:         '🏆 Deal Won — Action Required',
};

// Brand-aligned accent colors for each event type. Used for the top stripe
// and the eyebrow pill background. Brand red is the default; only use other
// hues for events that need a distinct semantic signal (success vs warning).
const EVENT_ACCENTS: Record<string, { stripe: string; pillBg: string; pillFg: string }> = {
  new_job:          { stripe: BRAND_RED,  pillBg: '#FDF4F4', pillFg: BRAND_RED },
  production_queue: { stripe: '#B45309',  pillBg: '#FEF3C7', pillFg: '#B45309' },
  ready_to_install: { stripe: '#065F46',  pillBg: '#D1FAE5', pillFg: '#065F46' },
  complete:         { stripe: '#1D4ED8',  pillBg: '#DBEAFE', pillFg: '#1D4ED8' },
  billing_logged:   { stripe: BRAND_RED,  pillBg: '#FDF4F4', pillFg: BRAND_RED },
  job_updated:      { stripe: BRAND_RED,  pillBg: '#FDF4F4', pillFg: BRAND_RED },
  pm_billing_entry: { stripe: '#065F46',  pillBg: '#D1FAE5', pillFg: '#065F46' },
  lead_won:         { stripe: '#065F46',  pillBg: '#D1FAE5', pillFg: '#065F46' },
};

// Brand-aligned shell. All emails share this layout; only the title/body vary.
const brandShell = (params: { label: string; stripe: string; pillBg: string; pillFg: string; pillText: string; title: string; subtitle: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string; }) => {
  const cta = params.ctaUrl ? `<div style="text-align:left;margin-top:8px;"><a href="${params.ctaUrl}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">${params.ctaLabel || 'Open Fencecrete OPS →'}</a></div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:${params.stripe};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:${BRAND_TEXT2};letter-spacing:.12em;vertical-align:bottom;">${params.label}</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:${params.pillBg};color:${params.pillFg};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">${params.pillText}</div>
  <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};margin-bottom:6px;line-height:1.2;">${params.title}</div>
  <div style="font-size:13px;color:${BRAND_TEXT2};font-weight:500;">${params.subtitle}</div>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
${params.bodyHtml}
${cta}
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_PAGE};">
  <p style="font-size:11px;color:${BRAND_TEXT3};margin:0;line-height:1.5;">Fencecrete America, LLC &middot; 15089 Tradesman Drive, San Antonio, TX 78249 &middot; (210) 492-7911</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
};

const dataTable = (rows: [string, string][]) => {
  const filtered = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!filtered.length) return '';
  const cells = filtered.map(([k, v], idx) => {
    const borderTop = idx === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
    return `<tr><td style="padding:10px 16px;color:${BRAND_TEXT2};font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;width:42%;${borderTop}">${k}</td><td style="padding:10px 16px;color:${BRAND_TEXT};font-size:13px;font-weight:600;${borderTop}">${v}</td></tr>`;
  }).join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;margin-bottom:20px;">${cells}</table>`;
};

const buildLeadWonEmail = (lead: any, jobNumber: string) => {
  const accents = EVENT_ACCENTS['lead_won'];
  const rows: [string, string][] = [
    ['Company',       lead.company_name],
    ['Project',       lead.project_description],
    ['Market',        lead.market],
    ['Sales Rep',     lead.sales_rep],
    ['Fence Type',    lead.fence_type],
    ['Est. LF',       lead.estimated_lf ? `${Number(lead.estimated_lf).toLocaleString()} LF` : ''],
    ['Est. Value',    lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : lead.proposal_value ? `$${Number(lead.proposal_value).toLocaleString()}` : ''],
    ['Job Number',    jobNumber],
    ['Contact',       lead.contact_name],
    ['Contact Email', lead.contact_email],
    ['Contact Phone', lead.contact_phone],
    ['Notes',         lead.notes],
  ];
  const intro = `<div style="font-size:14px;color:${BRAND_TEXT};line-height:1.7;margin-bottom:16px;">Please set up the project details in the ops system and assign a PM. Job number <strong>${jobNumber}</strong> has been reserved.</div>`;
  return brandShell({
    label: 'SALES',
    stripe: accents.stripe,
    pillBg: accents.pillBg,
    pillFg: accents.pillFg,
    pillText: '🏆 Deal Won — Action Required',
    title: lead.company_name,
    subtitle: `${lead.project_description || ''}${lead.market ? ' · ' + lead.market : ''}${jobNumber ? ' · Job #' + jobNumber : ''}`,
    bodyHtml: intro + dataTable(rows),
    ctaUrl: APP_URL,
  });
};

const buildEmail = (event: string, job: any, extra?: any) => {
  const label = EVENT_LABELS[event] || event;
  const accents = EVENT_ACCENTS[event] || EVENT_ACCENTS['new_job'];
  const rows: [string, string][] = [
    ['Project Name',   job.job_name],
    ['Project Code',   job.job_number],
    ['Customer',       job.customer_name],
    ['Market',         job.market],
    ['Fence Type',     job.fence_type],
    ['Total LF',       job.total_lf ? `${Number(job.total_lf).toLocaleString()} LF` : ''],
    ['Contract Value', job.adj_contract_value ? `$${Number(job.adj_contract_value).toLocaleString()}` : ''],
    ['Left to Bill',   job.left_to_bill ? `$${Number(job.left_to_bill).toLocaleString()}` : ''],
    ['% Billed',       job.pct_billed ? `${(Number(job.pct_billed)*100).toFixed(1)}%` : ''],
    ['Sales Rep',      job.sales_rep],
    ['Est. Start Date', job.est_start_date],
    ...(extra ? [
      ['PM',                extra.pm || ''] as [string, string],
      ['Billing Period',    extra.billing_period || ''] as [string, string],
      ['LF This Period',    extra.lf_this_period ? `${Number(extra.lf_this_period).toLocaleString()} LF` : ''] as [string, string],
      ['Amount to Invoice', extra.amount_to_invoice ? `$${Number(extra.amount_to_invoice).toLocaleString()}` : ''] as [string, string],
      ['Notes',             extra.invoice_notes || ''] as [string, string],
    ] : []),
  ];
  return brandShell({
    label: 'OPERATIONS',
    stripe: accents.stripe,
    pillBg: accents.pillBg,
    pillFg: accents.pillFg,
    pillText: label,
    title: job.job_name || '—',
    subtitle: `${job.customer_name || ''}${job.market ? ' · ' + job.market : ''}${job.job_number ? ' · ' + job.job_number : ''}`,
    bodyHtml: dataTable(rows),
    ctaUrl: APP_URL,
  });
};

const sendEmail = async (to: string, subject: string, html: string) => {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      reply_to: 'ops@fencecrete.com',
      to: [to],
      subject,
      html,
    })
  });
  if (!r.ok) {
    const errBody = await r.text();
    console.error(`Resend send failed for ${to}: ${errBody}`);
  }
  return r.json();
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { event, job_id, job, lead, job_number, extra, updated_by } = body;

    if (event && MUTED_EVENTS.has(event)) {
      return new Response(JSON.stringify({ success: true, muted: true, event }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (event === 'lead_won') {
      if (!lead) {
        return new Response(JSON.stringify({ error: 'lead required for lead_won event' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
      const html = buildLeadWonEmail(lead, job_number || '');
      const subject = `[Fencecrete] 🏆 Deal Won — ${lead.company_name} | Job #${job_number || 'TBD'}`;
      const roles = EVENT_ROLES['lead_won'];
      const roleQuery = roles.map(r => `role.eq.${r}`).join(',');
      const members = await sb(`team_members?or=(${roleQuery})&active=eq.true`);
      const results = [];
      for (const member of members) {
        const result = await sendEmail(member.email, subject, html);
        results.push({ name: member.name, email: member.email, result });
      }
      return new Response(JSON.stringify({ success: true, sent: results.length, recipients: results.map(r => ({ name: r.name, email: r.email })) }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    let jobData = job;
    if (!jobData && job_id) {
      const jobs = await sb(`jobs?id=eq.${job_id}`);
      jobData = jobs[0];
    }

    if (!event || !jobData) {
      return new Response(JSON.stringify({ error: 'event and job (or job_id) required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const roles = EVENT_ROLES[event] || ['ceo'];
    const roleQuery = roles.map(r => `role.eq.${r}`).join(',');
    const members = await sb(`team_members?or=(${roleQuery})&active=eq.true`);

    const label = EVENT_LABELS[event] || event;
    const updatedByStr = updated_by ? ` (by ${updated_by})` : '';
    const subject = `[Fencecrete] ${label}: ${jobData.job_name}${updatedByStr}`;
    const html = buildEmail(event, jobData, extra);

    const results = [];
    for (const member of members) {
      const result = await sendEmail(member.email, subject, html);
      results.push({ name: member.name, email: member.email, role: member.role, result });

      await fetch(`${SUPABASE_URL}/rest/v1/alert_log`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          event,
          job_id: jobData.id || job_id,
          recipient_email: member.email,
          recipient_name: member.name,
          subject,
          status: 'sent'
        })
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sent: results.length,
      recipients: results.map(r => ({ name: r.name, email: r.email, role: r.role }))
    }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
});
