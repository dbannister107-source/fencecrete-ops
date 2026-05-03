import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const APP_URL = 'https://fencecrete-ops.vercel.app';
const LOGO_URL = `${APP_URL}/logo.png`;
const FROM_ADDRESS = 'Fencecrete <ops@mail.fencecrete.com>';

// Brand palette
const BRAND_RED = '#8A261D';
const BRAND_TEXT = '#1A1A1A';
const BRAND_TEXT2 = '#625650';
const BRAND_TEXT3 = '#9E9B96';
const BRAND_BORDER = '#E5E3E0';
const BRAND_PAGE = '#F9F8F6';
const BRAND_CARD = '#FFFFFF';

const PM_EMAILS: Record<string, string> = {
  'Doug Monroe': 'doug@fencecrete.com',
  'Ray Garcia': 'ray@fencecrete.com',
  'Manuel Salazar': 'manuel@fencecrete.com',
  'Rafael Anaya Jr.': 'jr@fencecrete.com',
  'Hugo Rodriguez': 'hugo@fencecrete.com',
  'Israel Santibanez': 'israel@fencecrete.com',
};

const AR_EMAIL = 'david@fencecrete.com';
const CC_EMAILS = ['ccontreras@fencecrete.com'];

const DONE_STATUSES = 'fence_complete,fully_complete,closed,canceled,cancelled,lost';

async function isPaused(category: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_kill_switch?category=eq.${category}&select=paused`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].paused === true) {
      console.log(`[bill-sheet-reminder] PAUSED — category=${category}`);
      return true;
    }
  } catch (e) {
    console.error(`[bill-sheet-reminder] kill-switch lookup failed:`, e);
  }
  return false;
}

// Brand-aligned shell
const brandShell = (params: { width?: number; label: string; stripe: string; pillBg: string; pillFg: string; pillText: string; title: string; subtitle: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string; }) => {
  const cta = params.ctaUrl ? `<div style="text-align:left;margin-top:12px;"><a href="${params.ctaUrl}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">${params.ctaLabel || 'Open Fencecrete OPS →'}</a></div>` : '';
  const w = params.width || 600;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="${w}" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
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

async function fetchActiveJobs() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?status=not.in.(${DONE_STATUSES})&select=id,job_number,job_name,pm,market`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

async function fetchSubmissions(billingMonth: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pm_bill_submissions?billing_month=eq.${billingMonth}&select=job_id,submitted_by,submitted_at`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

async function sendEmail(to: string | string[], subject: string, html: string, cc?: string[]) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      reply_to: 'ops@fencecrete.com',
      to: Array.isArray(to) ? to : [to],
      cc: cc ?? [],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Resend send failed for ${to}: ${errBody}`);
  }
  return res.json();
}

Deno.serve(async (req: Request) => {
  try {
    if (await isPaused('bill_sheet_reminder')) {
      return new Response(JSON.stringify({ success: true, paused: true, category: 'bill_sheet_reminder' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const billingMonth = `20${year}-${month}`;
    const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    const [jobs, submissions] = await Promise.all([fetchActiveJobs(), fetchSubmissions(billingMonth)]);
    const submittedJobIds = new Set(submissions.map((s: any) => s.job_id));
    const missingByPM: Record<string, any[]> = {};
    for (const job of jobs) {
      if (!submittedJobIds.has(job.id)) {
        if (!missingByPM[job.pm]) missingByPM[job.pm] = [];
        missingByPM[job.pm].push(job);
      }
    }
    const totalMissing = Object.values(missingByPM).flat().length;
    const totalSubmitted = submissions.length;
    const totalJobs = jobs.length;
    const results: any[] = [];

    for (const [pm, missingJobs] of Object.entries(missingByPM)) {
      const email = PM_EMAILS[pm];
      if (!email) continue;

      const jobRows = missingJobs.map((j, i) => {
        const borderTop = i === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
        return `<tr><td style="padding:10px 14px;color:${BRAND_TEXT};font-size:13px;font-weight:600;${borderTop}">${j.job_number}</td><td style="padding:10px 14px;color:${BRAND_TEXT2};font-size:13px;${borderTop}">${j.job_name}</td><td style="padding:10px 14px;color:${BRAND_TEXT2};font-size:13px;${borderTop}">${j.market || '—'}</td></tr>`;
      }).join('');

      const bodyHtml = `<p style="font-size:14px;color:${BRAND_TEXT};line-height:1.7;margin:0 0 12px 0;">Hi ${pm},</p>
<p style="color:${BRAND_TEXT};font-size:14px;line-height:1.7;margin:0 0 12px 0;">You have <strong>${missingJobs.length} project${missingJobs.length > 1 ? 's' : ''}</strong> missing a bill sheet for <strong>${monthName}</strong>.</p>
<p style="color:${BRAND_TEXT2};font-size:13px;margin:0 0 16px 0;">Please log into Fencecrete OPS and submit your bill sheet for each project below:</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;margin-bottom:16px;">
  <tr><th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Job #</th><th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Job Name</th><th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Market</th></tr>
  ${jobRows}
</table>
<p style="color:${BRAND_TEXT3};font-size:12px;margin:16px 0 0 0;">Please submit by the 20th of the month. Contact AR if you have any questions.</p>`;

      const html = brandShell({
        label: 'BILL SHEETS',
        stripe: BRAND_RED,
        pillBg: '#FDF4F4',
        pillFg: BRAND_RED,
        pillText: `Reminder — ${monthName}`,
        title: 'Bill Sheet Reminder',
        subtitle: `${missingJobs.length} project${missingJobs.length > 1 ? 's' : ''} missing for ${monthName}`,
        bodyHtml,
        ctaUrl: APP_URL,
        ctaLabel: 'Submit Bill Sheets →',
      });
      const result = await sendEmail(email, `[Fencecrete] Action Required: ${missingJobs.length} Bill Sheet${missingJobs.length > 1 ? 's' : ''} Missing — ${monthName}`, html, CC_EMAILS);
      results.push({ pm, email, missing: missingJobs.length, result });
    }

    // AR summary email
    const allPMs = Object.keys(PM_EMAILS);
    const submittedPMs = allPMs.filter(pm => !missingByPM[pm] || missingByPM[pm].length === 0);
    const missingPMs = Object.entries(missingByPM);

    const pmStatusRows = [
      ...submittedPMs.map((pm, i) => {
        const borderTop = i === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
        return `<tr><td style="padding:10px 14px;color:${BRAND_TEXT};font-size:13px;font-weight:600;${borderTop}">${pm}</td><td style="padding:10px 14px;text-align:center;${borderTop}"><span style="background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">✓ All submitted</span></td></tr>`;
      }),
      ...missingPMs.map(([pm, jobs], i) => {
        const borderTop = (submittedPMs.length + i) === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
        return `<tr><td style="padding:10px 14px;color:${BRAND_TEXT};font-size:13px;font-weight:600;${borderTop}">${pm}</td><td style="padding:10px 14px;text-align:center;${borderTop}"><span style="background:#FDF4F4;color:${BRAND_RED};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">${jobs.length} missing</span></td></tr>`;
      }),
    ].join('');

    const arBody = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
  <tr>
    <td width="33%" style="padding:0 6px 0 0;">
      <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};padding:16px;border-radius:10px;text-align:center;">
        <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};">${totalJobs}</div>
        <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-top:4px;">Total Active</div>
      </div>
    </td>
    <td width="33%" style="padding:0 3px;">
      <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};padding:16px;border-radius:10px;text-align:center;">
        <div style="font-size:24px;font-weight:800;color:#065F46;">${totalSubmitted}</div>
        <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-top:4px;">Submitted</div>
      </div>
    </td>
    <td width="33%" style="padding:0 0 0 6px;">
      <div style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};padding:16px;border-radius:10px;text-align:center;">
        <div style="font-size:24px;font-weight:800;color:${BRAND_RED};">${totalMissing}</div>
        <div style="font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-top:4px;">Missing</div>
      </div>
    </td>
  </tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;margin-bottom:16px;">
  <tr><th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">PM</th><th style="padding:8px 14px;text-align:center;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Status</th></tr>
  ${pmStatusRows}
</table>
<p style="color:${BRAND_TEXT3};font-size:12px;margin:16px 0 0 0;">Reminders have been sent to PMs with missing submissions.</p>`;

    const arHtml = brandShell({
      label: 'AR SUMMARY',
      stripe: BRAND_RED,
      pillBg: '#FDF4F4',
      pillFg: BRAND_RED,
      pillText: monthName,
      title: 'Bill Sheet Status',
      subtitle: `${totalSubmitted} of ${totalJobs} active projects submitted`,
      bodyHtml: arBody,
      ctaUrl: APP_URL,
    });
    await sendEmail(AR_EMAIL, `[Fencecrete] Bill Sheet Status: ${totalSubmitted}/${totalJobs} submitted — ${monthName}`, arHtml, CC_EMAILS);

    return new Response(JSON.stringify({ success: true, billingMonth, totalJobs, totalSubmitted, totalMissing, remindersSent: results.length, results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('Bill sheet reminder error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
