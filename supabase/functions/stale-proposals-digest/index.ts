import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const APP_URL = 'https://ops.fencecrete.com';
const LOGO_URL = `${APP_URL}/logo.png`;
const FROM_ADDRESS = 'Fencecrete <ops@mail.fencecrete.com>';

const BRAND_RED = '#8A261D';
const BRAND_TEXT = '#1A1A1A';
const BRAND_TEXT2 = '#625650';
const BRAND_TEXT3 = '#9E9B96';
const BRAND_BORDER = '#E5E3E0';
const BRAND_PAGE = '#F9F8F6';
const BRAND_CARD = '#FFFFFF';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const REP_EMAILS: Record<string, string> = {
  'Matt':      'matt@fencecrete.com',
  'Laura':     'laura@fencecrete.com',
  'Yuda':      'yuda@fencecrete.com',
  'Nathan':    'nathan@fencecrete.com',
  'Ryne':      'ryne@fencecrete.com',
  'Mike Dean': 'mdean@fencecrete.com',
};

const sb = async (path: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  return r.json();
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
  return r.json();
};

const daysSince = (dateStr: string) => {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
};

const fmt = (n: number) => n ? `$${Number(n).toLocaleString()}` : '—';

const buildDigestEmail = (rep: string, staleLeads: any[], totalOpen: number, winRate: number | null) => {
  const urgentCount = staleLeads.filter(l => daysSince(l.updated_at) > 30).length;
  const isUrgent = urgentCount > 0;
  const stripeColor = isUrgent ? '#B45309' : BRAND_RED;
  const pillBg = isUrgent ? '#FEF3C7' : '#FDF4F4';
  const pillFg = isUrgent ? '#B45309' : BRAND_RED;

  const rows = staleLeads.map((l, idx) => {
    const days = daysSince(l.updated_at);
    const dayColor = days > 30 ? '#B45309' : BRAND_TEXT2;
    const borderTop = idx === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
    return `<tr>
      <td style="padding:10px 14px;font-size:13px;font-weight:600;color:${BRAND_TEXT};${borderTop}">${l.company_name || '—'}</td>
      <td style="padding:10px 14px;font-size:12px;color:${BRAND_TEXT2};${borderTop}">${l.project_description || '—'}</td>
      <td style="padding:10px 14px;font-size:12px;color:${BRAND_TEXT2};${borderTop}">${l.market || '—'}</td>
      <td style="padding:10px 14px;font-size:13px;font-weight:700;color:${BRAND_RED};${borderTop}">${fmt(l.proposal_value || l.estimated_value)}</td>
      <td style="padding:10px 14px;font-size:12px;font-weight:700;color:${dayColor};${borderTop}">${days}d ago</td>
      <td style="padding:10px 14px;font-size:12px;color:${BRAND_TEXT2};${borderTop}">${l.follow_up_date || '—'}</td>
    </tr>`;
  }).join('');

  const winRateStr = winRate != null ? `${winRate}%` : '—';

  const statRow = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
    <tr>
      <td width="33%" style="padding:0 6px 0 0;">
        <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px;">Open Proposals</div>
          <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};">${totalOpen}</div>
        </div>
      </td>
      <td width="33%" style="padding:0 3px;">
        <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px;">Stale (14d+)</div>
          <div style="font-size:24px;font-weight:800;color:${isUrgent ? '#B45309' : BRAND_TEXT};">${staleLeads.length}</div>
        </div>
      </td>
      <td width="33%" style="padding:0 0 0 6px;">
        <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px;">Win Rate</div>
          <div style="font-size:24px;font-weight:800;color:#065F46;">${winRateStr}</div>
        </div>
      </td>
    </tr>
  </table>`;

  const tableOrEmptyState = staleLeads.length === 0
    ? `<div style="background:#D1FAE5;border:1px solid #065F46;border-radius:10px;padding:20px;text-align:center;color:#065F46;font-weight:700;font-size:14px;">✓ All caught up. No stale proposals this week.</div>`
    : `<div style="font-size:13px;font-weight:700;color:${BRAND_TEXT};margin-bottom:10px;">Proposals not updated in 14+ days:</div>
      <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;overflow:hidden;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <thead>
            <tr style="background:${BRAND_CARD};">
              <th style="padding:8px 14px;font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;">Company</th>
              <th style="padding:8px 14px;font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;">Project</th>
              <th style="padding:8px 14px;font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;">Market</th>
              <th style="padding:8px 14px;font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;">Value</th>
              <th style="padding:8px 14px;font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;">Last Update</th>
              <th style="padding:8px 14px;font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;">Follow-up</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

  const bodyHtml = statRow + tableOrEmptyState;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:${stripeColor};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:${BRAND_TEXT2};letter-spacing:.12em;vertical-align:bottom;">SALES</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:${pillBg};color:${pillFg};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">Weekly Pipeline Digest</div>
  <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};margin-bottom:6px;line-height:1.2;">Hey ${rep}, here's your pipeline update</div>
  <div style="font-size:13px;color:${BRAND_TEXT2};font-weight:500;">Proposals that need follow-up this week</div>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
${bodyHtml}
<div style="text-align:left;margin-top:16px;"><a href="${APP_URL}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">Open Pipeline →</a></div>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_PAGE};">
  <p style="font-size:11px;color:${BRAND_TEXT3};margin:0;line-height:1.5;">Fencecrete America, LLC &middot; Weekly digest every Monday &middot; ops.fencecrete.com</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const leads = await sb('leads?stage=eq.proposal_sent&select=*&order=updated_at.asc');
    const wonLeads = await sb('leads?stage=eq.won&select=sales_rep,won_date');
    const lostLeads = await sb('leads?stage=eq.lost&select=sales_rep');

    const results = [];

    for (const [rep, email] of Object.entries(REP_EMAILS)) {
      const repOpen = leads.filter((l: any) => l.sales_rep === rep);
      const repStale = repOpen.filter((l: any) => daysSince(l.updated_at) >= 14);

      if (repOpen.length === 0) continue;

      const repWon = wonLeads.filter((l: any) => l.sales_rep === rep).length;
      const repLost = lostLeads.filter((l: any) => l.sales_rep === rep).length;
      const repClosed = repWon + repLost;
      const winRate = repClosed > 0 ? Math.round(repWon / repClosed * 100) : null;

      const urgentCount = repStale.filter((l: any) => daysSince(l.updated_at) > 30).length;
      const subject = urgentCount > 0
        ? `[Fencecrete] Action needed: ${urgentCount} proposals overdue — ${rep}`
        : `[Fencecrete] Weekly pipeline digest — ${rep} (${repStale.length} stale)`;

      const html = buildDigestEmail(rep, repStale, repOpen.length, winRate);
      const result = await sendEmail(email, subject, html);
      results.push({ rep, email, stale: repStale.length, open: repOpen.length, result });
    }

    return new Response(JSON.stringify({ success: true, sent: results.length, results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
