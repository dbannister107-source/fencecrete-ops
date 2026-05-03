import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const APP_URL = 'https://fencecrete-ops.vercel.app';
const LOGO_URL = `${APP_URL}/logo.png`;
const FROM_ADDRESS = 'Fencecrete <ops@mail.fencecrete.com>';

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

// Leadership heads-up only. NOT an AR routing channel.
// Virginia (AR) sees bill-sheet submissions on the OPS Billing page —
// pull-based, all markets in one screen. Don't add her here, it would
// be email-per-submission noise. See docs/automations.md (Power Automate
// retirement record) for the full context. Renamed from AR_EMAILS
// 2026-05-03 because the prior name was misleading.
const LEADERSHIP_NOTIFY_EMAILS = ['david@fencecrete.com', 'ccontreras@fencecrete.com'];

async function isPaused(category: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_kill_switch?category=eq.${category}&select=paused`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].paused === true) {
      console.log(`[bill-sheet-submitted-notification] PAUSED — category=${category}`);
      return true;
    }
  } catch (e) {
    console.error('[bill-sheet-submitted-notification] kill-switch lookup failed:', e);
  }
  return false;
}

const brandShell = (params: { label: string; stripe: string; pillBg: string; pillFg: string; pillText: string; title: string; subtitle: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string; }) => {
  const cta = params.ctaUrl ? `<div style="text-align:left;margin-top:12px;"><a href="${params.ctaUrl}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">${params.ctaLabel || 'Open Fencecrete OPS →'}</a></div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
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

async function sendEmail(to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_ADDRESS, reply_to: 'ops@fencecrete.com', to, subject, html }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Resend send failed for ${to}: ${errBody}`);
  }
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (await isPaused('bill_sheet_submitted')) {
      return new Response(JSON.stringify({ success: true, paused: true, category: 'bill_sheet_submitted' }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { submission, job } = body;

    if (!submission || !job) {
      return new Response(JSON.stringify({ error: 'Missing submission or job' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const monthLabel = new Date(submission.billing_month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });

    const submittedDateStr = new Date(submission.submitted_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const successPanel = `<div style="background:#D1FAE5;border:1px solid #065F46;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
  <p style="margin:0;color:#065F46;font-weight:700;font-size:14px;">✓ Submitted by ${submission.pm}</p>
  <p style="margin:4px 0 0;color:${BRAND_TEXT2};font-size:12px;">${submittedDateStr}</p>
</div>`;

    const rows: [string, string][] = [
      ['Project',           `${job.job_name} (${job.job_number})`],
      ['Market',            job.market ?? ''],
      ['Style',             [submission.style, submission.color, submission.height ? submission.height + 'ft' : ''].filter(Boolean).join(' · ')],
      ['Total LF Submitted', submission.total_lf ? `${submission.total_lf} LF` : '0 LF'],
      ['% Complete (PM)',   submission.pct_complete_pm != null ? `${submission.pct_complete_pm}%` : ''],
      ['Billing Month',     monthLabel],
      ['PM Notes',          submission.notes || ''],
    ];

    const bodyHtml = successPanel + dataTable(rows);

    const html = brandShell({
      label: 'BILL SHEETS',
      stripe: '#065F46',
      pillBg: '#D1FAE5',
      pillFg: '#065F46',
      pillText: `Submitted — ${monthLabel}`,
      title: 'Bill Sheet Submitted',
      subtitle: `${job.job_name} · ${submission.pm}`,
      bodyHtml,
      ctaUrl: APP_URL,
      ctaLabel: 'Review in Fencecrete OPS →',
    });

    await sendEmail(LEADERSHIP_NOTIFY_EMAILS, `[Fencecrete] Bill Sheet Submitted: ${job.job_name} — ${monthLabel}`, html);

    return new Response(JSON.stringify({ success: true, recipients: LEADERSHIP_NOTIFY_EMAILS }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('Bill sheet notification error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
