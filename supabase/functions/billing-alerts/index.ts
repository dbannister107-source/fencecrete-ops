import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const APP_URL = 'https://ops.fencecrete.com';
const LOGO_URL = `${APP_URL}/logo.png`;
const FROM_ADDRESS = 'Fencecrete <ops@mail.fencecrete.com>';

// Brand palette — see src/App.jsx for color authority
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

const DONE_STATUSES = `fully_complete,closed,canceled,cancelled,lost`;
const IN_PROGRESS_STATUSES = `in_production,production_queue,material_ready,active_install`;
const COMPLETE_STATUSES = `fence_complete,fully_complete`;

const sb = async (path: string, opts: any = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opts.headers },
    ...opts
  });
  return r.json();
};

// Kill-switch helper
const isPaused = async (category: string): Promise<boolean> => {
  try {
    const rows = await sb(`notification_kill_switch?category=eq.${category}&select=paused`);
    if (Array.isArray(rows) && rows.length > 0 && rows[0].paused === true) {
      console.log(`[billing-alerts] PAUSED — category=${category}.`);
      return true;
    }
  } catch (e) {
    console.error(`[billing-alerts] kill-switch lookup failed for ${category}:`, e);
  }
  return false;
};

const sendEmail = async (to: string, subject: string, html: string) => {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, reply_to: 'ops@fencecrete.com', to: [to], subject, html })
  });
  if (!r.ok) {
    const errBody = await r.text();
    console.error(`Resend send failed for ${to}: ${errBody}`);
  }
};

const fmtMoney = (n: any) => n ? `$${Number(n).toLocaleString()}` : '$0';

// Brand-aligned shell. Wider card (640) for tabular reports.
const brandShellWide = (params: { label: string; stripe: string; pillBg: string; pillFg: string; pillText: string; title: string; subtitle: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string; }) => {
  const cta = params.ctaUrl ? `<div style="text-align:left;margin-top:12px;"><a href="${params.ctaUrl}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">${params.ctaLabel || 'Open Fencecrete OPS →'}</a></div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const agingPaused = await isPaused('billing_aging');
  const digestPaused = await isPaused('weekly_digest');

  if (agingPaused && digestPaused) {
    return new Response(JSON.stringify({ success: true, paused: true, reason: 'Both billing_aging and weekly_digest are paused' }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const today = new Date();

  let aging30Count = 0, aging60Count = 0, aging90Count = 0, neverBilledCount = 0, completeUnbilledCount = 0;

  if (!agingPaused) {
    const activeJobs = await sb(`jobs?status=not.in.(${DONE_STATUSES})&left_to_bill=gt.0&select=id,job_name,customer_name,market,left_to_bill,ytd_invoiced,adj_contract_value,last_billed,contract_value,contract_date,billing_alert_sent_30,billing_alert_sent_60,billing_alert_sent_90,pm`);

    const alertRecipients = await sb('team_members?role=in.(ar,cfo,ceo)&active=eq.true');
    const recipientEmails = alertRecipients.map((m: any) => m.email);

    const aging30: any[] = [];
    const aging60: any[] = [];
    const aging90: any[] = [];
    const neverBilled: any[] = [];

    for (const job of activeJobs) {
      if (!job.last_billed) {
        const contractDate = job.contract_date ? new Date(job.contract_date) : null;
        if (contractDate) {
          const daysSinceContract = Math.floor((today.getTime() - contractDate.getTime()) / 86400000);
          if (daysSinceContract >= 30) {
            neverBilled.push({ ...job, days: daysSinceContract });
          }
        }
        continue;
      }

      const lastBilled = new Date(job.last_billed);
      const daysSince = Math.floor((today.getTime() - lastBilled.getTime()) / 86400000);

      if (daysSince >= 90 && !job.billing_alert_sent_90) {
        aging90.push({ ...job, days: daysSince });
        await sb(`jobs?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ billing_alert_sent_90: true }) });
      } else if (daysSince >= 60 && !job.billing_alert_sent_60) {
        aging60.push({ ...job, days: daysSince });
        await sb(`jobs?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ billing_alert_sent_60: true }) });
      } else if (daysSince >= 30 && !job.billing_alert_sent_30) {
        aging30.push({ ...job, days: daysSince });
        await sb(`jobs?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ billing_alert_sent_30: true }) });
      }
    }

    const completedJobs = await sb(`jobs?status=in.(${COMPLETE_STATUSES})&left_to_bill=gt.100&select=id,job_name,customer_name,market,left_to_bill,last_billed`);
    const completeUnbilled = [...completedJobs];

    aging30Count = aging30.length;
    aging60Count = aging60.length;
    aging90Count = aging90.length;
    neverBilledCount = neverBilled.length;
    completeUnbilledCount = completeUnbilled.length;

    // Build aging row — light theme
    const buildAgingRow = (job: any, color: string, idx: number) => {
      const borderTop = idx === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
      return `<tr><td style="padding:10px 14px;color:${BRAND_TEXT};font-size:13px;font-weight:600;${borderTop}">${job.job_name}</td><td style="padding:10px 14px;color:${BRAND_TEXT2};font-size:13px;${borderTop}">${job.customer_name || ''}</td><td style="padding:10px 14px;color:${BRAND_TEXT2};font-size:13px;${borderTop}">${job.market || '—'}</td><td style="padding:10px 14px;color:${color};font-size:13px;font-weight:700;${borderTop}">${fmtMoney(job.left_to_bill)}</td><td style="padding:10px 14px;color:${BRAND_TEXT2};font-size:13px;${borderTop}">${job.pm || '—'}</td><td style="padding:10px 14px;color:${color};font-size:13px;font-weight:700;${borderTop}">${job.days || '—'}d</td></tr>`;
    };

    const buildSection = (title: string, jobs: any[], color: string) => {
      if (!jobs.length) return '';
      const totalValue = jobs.reduce((a: number, j: any) => a + Number(j.left_to_bill || 0), 0);
      const sorted = jobs.sort((a: any, b: any) => (b.days || 0) - (a.days || 0)).slice(0, 20);
      return `<div style="margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">${title} (${jobs.length} jobs &middot; ${fmtMoney(totalValue)})</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;">
          <tr style="background:#FFFFFF;">
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Job</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Customer</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Market</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Left to Bill</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">PM</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Days</th>
          </tr>
          ${sorted.map((j: any, i: number) => buildAgingRow(j, color, i + 1)).join('')}
        </table>
      </div>`;
    };

    const hasAlerts = aging30.length || aging60.length || aging90.length || neverBilled.length || completeUnbilled.length;

    if (hasAlerts) {
      const totalAlerts = neverBilled.length + aging90.length + aging60.length + aging30.length + completeUnbilled.length;
      const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

      const bodyHtml = `${buildSection('Never Billed — Contract 30+ Days Old', neverBilled, '#DC2626')}
${buildSection('90+ Days Since Last Invoice', aging90, '#DC2626')}
${buildSection('60+ Days Since Last Invoice', aging60, '#B45309')}
${buildSection('30+ Days Since Last Invoice', aging30, '#D97706')}
${completeUnbilled.length ? buildSection('Complete Jobs With Outstanding Balance', completeUnbilled.map((j: any) => ({ ...j, days: undefined })), '#7C3AED') : ''}`;

      const html = brandShellWide({
        label: 'BILLING ALERT',
        stripe: '#DC2626',
        pillBg: '#FDF4F4',
        pillFg: '#DC2626',
        pillText: 'Action Required',
        title: 'Billing Aging Report',
        subtitle: dateStr,
        bodyHtml,
        ctaUrl: APP_URL,
        ctaLabel: 'Open Billing Dashboard →',
      });

      for (const email of recipientEmails) {
        await sendEmail(email, `[Fencecrete] Billing Alert — ${totalAlerts} Jobs Need Attention`, html);
      }
    }
  }

  const isMonday = today.getDay() === 1;
  if (isMonday && !digestPaused) {
    const weekAgo = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];

    const [newJobs, completedThisWeek, allActive, openLeads, bidsStale] = await Promise.all([
      sb(`jobs?created_at=gte.${weekAgo}&select=job_name,customer_name,market,contract_value`),
      sb(`jobs?status=in.(${COMPLETE_STATUSES})&fully_complete_date=gte.${weekAgo}&select=job_name,customer_name,market,contract_value`),
      sb(`jobs?status=in.(${IN_PROGRESS_STATUSES})&select=market,total_lf,total_lf_precast,status,left_to_bill`),
      sb(`leads?stage=not.in.(won,lost)&select=company_name,estimated_value,proposal_value,stage,market`),
      sb(`leads?stage=eq.proposal_sent&updated_at=lte.${new Date(today.getTime() - 14 * 86400000).toISOString()}&select=company_name,estimated_value,proposal_value,market`),
    ]);

    const totalLFProd = allActive.filter((j: any) => j.status === 'in_production').reduce((a: number, j: any) => a + (j.total_lf_precast || j.total_lf || 0), 0);
    const totalLeftToBill = allActive.reduce((a: number, j: any) => a + Number(j.left_to_bill || 0), 0);
    const pipelineValue = openLeads.reduce((a: number, l: any) => a + Number(l.estimated_value || l.proposal_value || 0), 0);

    const statCard = (label: string, value: string, sub: string, color: string) => `<td width="50%" style="padding:0 6px 12px 0;">
      <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:16px 18px;">
        <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px;">${label}</div>
        <div style="font-size:24px;font-weight:800;color:${color};margin-bottom:4px;">${value}</div>
        <div style="font-size:11px;color:${BRAND_TEXT3};">${sub}</div>
      </div>
    </td>`;
    const statCardRight = (label: string, value: string, sub: string, color: string) => statCard(label, value, sub, color).replace('padding:0 6px 12px 0', 'padding:0 0 12px 6px');

    const stalePanel = bidsStale.length ? `<div style="background:#FEF3C7;border:1px solid #B45309;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">⚠ ${bidsStale.length} Proposals Outstanding 14+ Days</div>
      ${bidsStale.slice(0,5).map((l: any) => `<div style="font-size:13px;color:${BRAND_TEXT};margin-bottom:3px;"><strong>${l.company_name}</strong> &middot; $${Number(l.estimated_value || l.proposal_value || 0).toLocaleString()} &middot; <span style="color:${BRAND_TEXT2};">${l.market || ''}</span></div>`).join('')}
    </div>` : '';

    const bodyHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
      <tr>
        ${statCard('Open Pipeline', `$${(pipelineValue/1000000).toFixed(1)}M`, `${openLeads.length} open leads`, BRAND_RED)}
        ${statCardRight('Left to Bill', `$${(totalLeftToBill/1000000).toFixed(1)}M`, 'Active jobs', '#DC2626')}
      </tr>
      <tr>
        ${statCard('In Production', totalLFProd.toLocaleString(), 'LF on floor', '#B45309')}
        ${statCardRight('New Jobs This Week', String(newJobs.length), `Jobs completed: ${completedThisWeek.length}`, '#065F46')}
      </tr>
    </table>
    ${stalePanel}`;

    const digestHtml = brandShellWide({
      label: 'WEEKLY DIGEST',
      stripe: BRAND_RED,
      pillBg: '#FDF4F4',
      pillFg: BRAND_RED,
      pillText: 'Monday Briefing',
      title: 'Good morning, team.',
      subtitle: `Week of ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      bodyHtml,
      ctaUrl: APP_URL,
    });

    const leadershipTeam = await sb('team_members?role=in.(ceo,cfo)&active=eq.true');
    for (const member of leadershipTeam) {
      await sendEmail(member.email, `[Fencecrete] Weekly Digest — ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, digestHtml);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    agingPaused, digestPaused,
    aging30: aging30Count, aging60: aging60Count, aging90: aging90Count,
    neverBilled: neverBilledCount, completeUnbilled: completeUnbilledCount
  }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
});
