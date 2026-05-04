import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RECIPIENTS = ['max@fencecrete.com', 'david@fencecrete.com'];

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

const fmt = (n: any) => (!n || n === 0) ? '—' : Number(n).toLocaleString();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { job } = await req.json();
    if (!job) return new Response(JSON.stringify({ error: 'Missing job' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

    const marketAbbr: Record<string,string> = { 'San Antonio': 'SA', 'Houston': 'Houston', 'Austin': 'Austin', 'Dallas-Fort Worth': 'DFW' };
    const city = marketAbbr[job.market] ?? job.market ?? '';
    const postHt = job.material_post_height ? `${job.material_post_height}ft` : '—';
    const calcDate = job.material_calc_date ? new Date(job.material_calc_date).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : 'Today';
    const dims = job.material_calc_lf && job.material_calc_height ? `${job.material_calc_lf}x${job.material_calc_height}` : '';

    // Material category section: each one gets a colored header bar followed
    // by a clean data table with prominent quantity numbers (these are the
    // numbers production reads off the email).
    const buildSection = (title: string, headerColor: string, rows: [string, any][]) => {
      const filtered = rows.filter(([, v]) => v !== null && v !== undefined && v !== 0);
      if (!filtered.length) return '';
      const dataRows = filtered.map(([label, val], idx) => {
        const borderTop = idx === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
        return `<tr><td style="padding:10px 16px;color:${BRAND_TEXT2};font-size:12px;width:62%;${borderTop}">${label}</td><td style="padding:10px 16px;color:${BRAND_TEXT};font-size:18px;font-weight:800;letter-spacing:-.01em;${borderTop}">${fmt(val)}</td></tr>`;
      }).join('');
      return `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;overflow:hidden;margin-bottom:14px;">
        <div style="background:${headerColor};padding:8px 16px;"><div style="color:#FFFFFF;margin:0;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">${title}</div></div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${dataRows}</table>
      </div>`;
    };

    const sections = [
      buildSection(`Posts — ${postHt}`, BRAND_RED, [
        ['Line Posts', job.material_posts_line],
        ['Corner Posts', job.material_posts_corner],
        ['Stop Posts', job.material_posts_stop],
      ]),
      buildSection('Panels', '#1D4ED8', [
        ['Regular Panels', job.material_panels_regular],
        ['Half Panels', job.material_panels_half],
        ['Bottom Panels', job.material_panels_bottom],
        ['Top Panels', job.material_panels_top],
      ]),
      buildSection('Rails', '#B45309', [
        ['Regular (Cap) Rails', job.material_rails_regular],
        ['Top Rails', job.material_rails_top],
        ['Bottom Rails', job.material_rails_bottom],
        ['Center (Middle) Rails', job.material_rails_center],
      ]),
      buildSection('Post Caps', '#065F46', [
        ['Line Caps', job.material_caps_line],
        ['Stop Caps', job.material_caps_stop],
      ]),
    ].join('');

    const summaryCard = `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;margin-bottom:18px;">
      <div style="font-size:11px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px;">Project Summary</div>
      <div style="font-size:13px;color:${BRAND_TEXT};margin-bottom:3px;"><strong>Jobcode:</strong> ${job.job_number ?? '—'}${dims ? ` &middot; <span style="color:${BRAND_RED};font-weight:700;">${dims}</span>` : ''}</div>
      <div style="font-size:13px;color:${BRAND_TEXT};margin-bottom:3px;"><strong>City:</strong> ${city}</div>
      <div style="font-size:14px;font-weight:700;color:${BRAND_TEXT};"><strong>Project:</strong> ${job.job_name ?? '—'}</div>
    </div>`;

    const bodyHtml = sections + summaryCard;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:${BRAND_RED};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:${BRAND_TEXT2};letter-spacing:.12em;vertical-align:bottom;">PRODUCTION</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:#FDF4F4;color:${BRAND_RED};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">📋 Production Order — ${calcDate}</div>
  <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};margin-bottom:6px;line-height:1.2;">${job.job_name ?? 'Unknown Job'}</div>
  <div style="font-size:13px;color:${BRAND_TEXT2};font-weight:500;">${[job.job_number, city, job.material_calc_style ?? job.style, job.color, dims ? dims + ' LF' : ''].filter(Boolean).join(' · ')}</div>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
${bodyHtml}
<div style="text-align:left;margin-top:8px;"><a href="${APP_URL}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">View in Fencecrete OPS →</a></div>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_PAGE};">
  <p style="font-size:11px;color:${BRAND_TEXT3};margin:0;line-height:1.5;">Fencecrete America, LLC &middot; 15089 Tradesman Drive, San Antonio, TX 78249 &middot; (210) 492-7911</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await sendEmail(RECIPIENTS, `[Fencecrete] Production Order: ${job.job_name} — ${job.material_calc_style ?? job.style ?? ''} ${dims}`, html);

    return new Response(JSON.stringify({ success: true, recipients: RECIPIENTS }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
