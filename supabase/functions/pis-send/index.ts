import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
// V16 (2026-05-01): Form domain split. APP_URL now points at forms.fencecrete.com
//   so newly minted tokens link directly to the safe form domain (no redirect hop)
//   and the customer-facing logo loads from the non-flagged domain. The vercel.app
//   domain is currently flagged by Google Safe Browsing as Dangerous, so any link
//   or image hosted there will not load in customer email clients/browsers.
const APP_URL = 'https://forms.fencecrete.com';
const LOGO_URL = `${APP_URL}/logo.png`;
const PIS_FORM_BASE = `${APP_URL}/#/pis`;
const FROM_ADDRESS = 'Fencecrete <ops@mail.fencecrete.com>';

// Contracts role mailbox — NOT amiee@fencecrete.com.
const CONTRACTS_EMAIL = 'contracts@fencecrete.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sb = async (path: string, opts: RequestInit = {}) => {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { job_id, job_number, job_name, sent_to_email, sent_to_name, sent_by } = await req.json();

    if (!job_id || !sent_to_email) {
      return new Response(JSON.stringify({ error: 'job_id and sent_to_email are required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    const rows = await sb('pis_tokens', {
      method: 'POST',
      body: JSON.stringify({ job_id, job_number, job_name, sent_to_email, sent_to_name: sent_to_name || sent_to_email, sent_by: sent_by || CONTRACTS_EMAIL }),
    });
    const tok = Array.isArray(rows) ? rows[0] : rows;
    if (!tok?.token) throw new Error('Token creation failed');

    const formUrl = `${PIS_FORM_BASE}/${tok.token}`;

    // V16 (2026-05-01): Form domain split. URLs in this email now point at
    //   forms.fencecrete.com (safe domain). Replaces vercel.app which was
    //   flagged Dangerous by Google Safe Browsing.
    // V15 (2026-04-29): Added one-liner mentioning the in-form tax cert
    //   upload. Customers who select Non-Taxable can attach their cert
    //   directly in the form (spine routes it to SharePoint via
    //   notifyTaxCertUploadedRule). Reduces inbound cert emails to AR.
    // V14 (2026-04-29): Brand light theme matching app palette.
    const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#F9F8F6;font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#1A1A1A;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9F8F6;padding:32px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #E5E3E0;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:#8A261D;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:#625650;letter-spacing:.12em;vertical-align:bottom;">CONTRACTS</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:#FDF4F4;color:#8A261D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">Action Required</div>
  <div style="font-size:24px;font-weight:800;color:#1A1A1A;margin-bottom:6px;line-height:1.2;">Project Information Sheet</div>
  <div style="font-size:13px;color:#625650;margin-bottom:4px;font-weight:500;">Job #${job_number || ''} &mdash; ${job_name || ''}</div>
  <div style="font-size:11px;color:#9E9B96;">Pursuant to Section 53.159 of the Texas Property Code</div>
</td></tr>
<tr><td style="padding:16px 32px 8px;">
  <div style="font-size:14px;color:#1A1A1A;line-height:1.7;margin-bottom:20px;">
    Please complete the required <strong>Project Information Sheet</strong> for your upcoming project with Fencecrete. This information is required before work can begin and must be returned at your earliest convenience.
  </div>
  <div style="background:#F9F8F6;border:1px solid #E5E3E0;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:11px;color:#625650;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:10px;">The form covers</div>
    <div style="font-size:13px;color:#1A1A1A;line-height:1.9;">
      &bull; Property Owner &amp; General Contractor details<br>
      &bull; Billing Contact &amp; Project Manager / Superintendent<br>
      &bull; Bonding Information &amp; Tax Status<br>
      &bull; Project Address &amp; Legal Description
    </div>
  </div>
  <div style="background:#FDF4F4;border:1px solid #E5E3E0;border-radius:10px;padding:12px 18px;margin-bottom:24px;font-size:13px;color:#1A1A1A;line-height:1.6;">
    <strong style="color:#8A261D;">Tax-exempt?</strong> If your project qualifies as Non-Taxable, you can attach your Texas tax-exempt certificate directly in the form. No need to email it separately.
  </div>
  <div style="text-align:center;margin-bottom:24px;">
    <a href="${formUrl}" style="display:inline-block;background:#8A261D;color:#FFFFFF;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">Complete Project Info Sheet &rarr;</a>
  </div>
  <div style="font-size:12px;color:#625650;text-align:center;line-height:1.6;">This link is unique to your project and expires in 30 days.<br>Questions? Contact our Contracts team at <a href="mailto:${CONTRACTS_EMAIL}" style="color:#8A261D;text-decoration:none;font-weight:600;">${CONTRACTS_EMAIL}</a> or (210) 492-7911.</div>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #E5E3E0;background:#F9F8F6;">
  <p style="font-size:11px;color:#9E9B96;margin:0;line-height:1.5;">Fencecrete America, LLC &middot; 15089 Tradesman Drive, San Antonio, TX 78249 &middot; (210) 492-7911</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        reply_to: CONTRACTS_EMAIL,
        to: [sent_to_email],
        cc: [CONTRACTS_EMAIL],
        subject: `[Fencecrete] Project Information Sheet Required — Job #${job_number || ''} ${job_name || ''}`,
        html: emailHtml,
      }),
    });
    const emailJson = await emailRes.json();

    if (!emailRes.ok) {
      throw new Error(`Resend API error: ${emailJson.message || JSON.stringify(emailJson)}`);
    }

    return new Response(JSON.stringify({
      success: true,
      token: tok.token,
      form_url: formUrl,
      email_id: emailJson.id,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
