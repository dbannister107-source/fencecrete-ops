import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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

const RECIPIENTS = ['max@fencecrete.com','david@fencecrete.com'];

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  try {
    const body = await req.json();
    const { date, planLines, notes, totalPlanned } = body;

    const fmtDate = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : date;

    const linesHtml = (planLines || []).map((l: any, idx: number) => {
      const borderTop = idx === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
      return `<tr>
        <td style="padding:10px 14px;font-size:13px;color:${BRAND_TEXT};font-weight:600;${borderTop}">${l.job_name || l.job_number || '—'}</td>
        <td style="padding:10px 14px;font-size:13px;text-align:center;color:${BRAND_TEXT2};${borderTop}">${l.style || '—'}</td>
        <td style="padding:10px 14px;font-size:13px;text-align:center;color:${BRAND_TEXT2};${borderTop}">${l.height ? l.height + 'ft' : '—'}</td>
        <td style="padding:10px 14px;font-size:14px;text-align:center;font-weight:800;color:${BRAND_TEXT};${borderTop}">${l.planned_pieces || 0}</td>
      </tr>`;
    }).join('');

    const totalCard = `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;">
      <div style="font-size:36px;font-weight:800;color:#1D4ED8;letter-spacing:-.02em;">${totalPlanned || 0}</div>
      <div style="font-size:10px;color:${BRAND_TEXT2};font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-top:6px;">Total Planned Pieces</div>
    </div>`;

    const lineTable = `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;overflow:hidden;margin-bottom:16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <thead>
          <tr style="background:${BRAND_CARD};">
            <th style="padding:10px 14px;color:${BRAND_TEXT2};font-size:10px;text-align:left;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Job</th>
            <th style="padding:10px 14px;color:${BRAND_TEXT2};font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Style</th>
            <th style="padding:10px 14px;color:${BRAND_TEXT2};font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Height</th>
            <th style="padding:10px 14px;color:${BRAND_TEXT2};font-size:10px;text-align:center;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Pieces</th>
          </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
      </table>
    </div>`;

    const notesBlock = notes ? `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;margin-bottom:16px;">
      <div style="font-size:11px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:8px;">Plan Notes</div>
      <p style="margin:0;font-size:13px;color:${BRAND_TEXT};line-height:1.6;">${notes}</p>
    </div>` : '';

    const bodyHtml = totalCard + lineTable + notesBlock;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:#1D4ED8;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:${BRAND_TEXT2};letter-spacing:.12em;vertical-align:bottom;">PRODUCTION</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">📅 Production Plan Saved</div>
  <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};margin-bottom:6px;line-height:1.2;">${fmtDate}</div>
  <div style="font-size:13px;color:${BRAND_TEXT2};font-weight:500;">${(planLines || []).length} job line${(planLines || []).length === 1 ? '' : 's'} on plan</div>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
${bodyHtml}
<div style="text-align:left;margin-top:8px;"><a href="${APP_URL}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">View Production Plan →</a></div>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_PAGE};">
  <p style="font-size:11px;color:${BRAND_TEXT3};margin:0;line-height:1.5;">Fencecrete America, LLC &middot; 15089 Tradesman Drive, San Antonio, TX 78249 &middot; (210) 492-7911</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await sendEmail(RECIPIENTS, `[Fencecrete] Production Plan — ${fmtDate} — ${totalPlanned || 0} pieces`, html);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
});
