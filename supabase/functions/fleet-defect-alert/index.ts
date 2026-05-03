import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = () => new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });

const PRIORITY_COLORS: Record<string, string> = {
  low: BRAND_TEXT2, medium: '#B45309', high: BRAND_RED, critical: '#991B1B'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { equipment, inspection, defects, workOrderId } = await req.json();

    const failedItems = defects.map((key: string) => {
      const labels: Record<string, string> = {
        engine_oil: 'Engine Oil Level', coolant: 'Coolant Level',
        brakes: 'Brakes', tires: 'Tires & Wheels', lights: 'Lights',
        windshield: 'Windshield & Wipers', steering: 'Steering',
        fuel: 'Fuel Level', horn: 'Horn', mirrors: 'Mirrors',
        seatbelt: 'Seat Belts', fire_ext: 'Fire Extinguisher',
        leaks: 'Fluid Leaks', body: 'Body / Frame Damage', cab: 'Cab Cleanliness'
      };
      return labels[key] || key;
    });

    const priority = defects.length >= 3 ? 'high' : 'medium';
    const priorityColor = PRIORITY_COLORS[priority];

    const unitCard = `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;margin-bottom:16px;border-left:4px solid ${priorityColor};">
      <h3 style="margin:0 0 6px;font-size:15px;font-weight:700;color:${BRAND_TEXT};">Unit ${equipment?.unit_number || '—'} — ${equipment?.make_model || ''}</h3>
      <p style="margin:0;color:${BRAND_TEXT2};font-size:12px;">City: ${equipment?.city || '—'} &middot; Inspector: ${inspection?.inspector_name || '—'}</p>
      ${workOrderId ? `<p style="margin:8px 0 0;font-size:12px;color:${BRAND_RED};font-weight:700;">→ Work Order Created Automatically</p>` : ''}
    </div>`;

    const failedList = `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:16px 18px;margin-bottom:16px;">
      <div style="font-size:11px;color:${BRAND_RED};text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:10px;">Failed Inspection Items (${failedItems.length})</div>
      ${failedItems.map((item: string) => `<div style="padding:8px 12px;background:#FDF4F4;border:1px solid #FBE2DF;border-radius:6px;margin-bottom:6px;font-size:13px;color:${BRAND_RED};font-weight:600;">✗ ${item}</div>`).join('')}
    </div>`;

    const notesPanel = inspection?.defects_found ? `<div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;margin-bottom:16px;">
      <div style="font-size:11px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:8px;">Additional Notes</div>
      <p style="margin:0;font-size:13px;color:${BRAND_TEXT};line-height:1.6;">${inspection.defects_found}</p>
    </div>` : '';

    const bodyHtml = unitCard + failedList + notesPanel;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:${BRAND_RED};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:${BRAND_TEXT2};letter-spacing:.12em;vertical-align:bottom;">FLEET</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:#FDF4F4;color:${BRAND_RED};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">⚠ Inspection Defects</div>
  <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};margin-bottom:6px;line-height:1.2;">Immediate attention required</div>
  <div style="font-size:13px;color:${BRAND_TEXT2};font-weight:500;">${failedItems.length} item${failedItems.length === 1 ? '' : 's'} failed inspection on Unit ${equipment?.unit_number || '—'}</div>
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

    if (RESEND_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          reply_to: 'ops@fencecrete.com',
          to: ['david@fencecrete.com', 'max@fencecrete.com'],
          subject: `[Fencecrete] ⚠ Fleet Defects: ${equipment?.unit_number || 'Unknown Unit'} — ${failedItems.length} item(s) failed`,
          html,
        }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        console.error(`Resend send failed: ${errBody}`);
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: jsonHeaders() });
  } catch (err: any) {
    console.error('Edge function crashed:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders() });
  }
});
