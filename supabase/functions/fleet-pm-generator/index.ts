import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = () => new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });

const sb = (path: string, opts: any = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) }
  }).then(r => r.json());

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const schedules: any[] = await sb(
      `fleet_pm_schedules?is_active=eq.true&auto_generate_wo=eq.true&select=*,fleet_equipment(unit_number,make_model,city,current_hours,current_mileage)`
    );

    const generated: any[] = [];
    const alerts: { unit: string; city: string; task: string; reason: string; isOverdue: boolean }[] = [];

    for (const sched of schedules) {
      const eq = sched.fleet_equipment;
      if (!eq) continue;

      let isDue = false;
      let reason = '';
      let isOverdue = false;

      if (sched.trigger_type === 'time' && sched.next_due_date) {
        const dueDate = new Date(sched.next_due_date);
        const advanceDays = sched.advance_notice_days ?? 7;
        const alertDate = new Date(dueDate);
        alertDate.setDate(alertDate.getDate() - advanceDays);
        if (today >= alertDate) {
          isDue = true;
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
          isOverdue = daysUntil <= 0;
          reason = isOverdue ? `OVERDUE by ${Math.abs(daysUntil)} days` : `Due in ${daysUntil} days`;
        }
      } else if (sched.trigger_type === 'hours' && sched.next_due_hours && eq.current_hours) {
        const hoursRemaining = sched.next_due_hours - eq.current_hours;
        if (hoursRemaining <= 50) {
          isDue = true;
          isOverdue = hoursRemaining <= 0;
          reason = isOverdue ? `OVERDUE by ${Math.abs(hoursRemaining)} hrs` : `Due in ${hoursRemaining} hrs`;
        }
      }

      if (!isDue) continue;

      if (sched.last_wo_generated_at) {
        const lastGen = new Date(sched.last_wo_generated_at);
        const daysSince = (today.getTime() - lastGen.getTime()) / 86400000;
        if (daysSince < 7) continue;
      }

      const woData = {
        equipment_id: sched.equipment_id,
        title: `PM Due: ${sched.task_name} — ${eq.unit_number} ${eq.make_model}`,
        description: `${sched.description || sched.task_name}\n\nTrigger: ${reason}\nSchedule: ${sched.trigger_type === 'time' ? `Every ${sched.interval_days} days` : `Every ${sched.interval_hours} hours`}`,
        wo_type: 'preventive',
        priority: isOverdue ? 'high' : 'medium',
        status: 'new',
        reported_by: 'PM Auto-Generator',
        due_date: sched.next_due_date || todayStr,
      };

      const [wo] = await sb('fleet_work_orders', { method: 'POST', body: JSON.stringify(woData) });

      await fetch(`${SB_URL}/rest/v1/fleet_pm_schedules?id=eq.${sched.id}`, {
        method: 'PATCH',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_wo_generated_at: today.toISOString() })
      });

      generated.push({ schedule: sched, workOrder: wo, reason });
      alerts.push({
        unit: `${eq.unit_number} ${eq.make_model}`,
        city: eq.city || '—',
        task: sched.task_name,
        reason,
        isOverdue,
      });
    }

    if (generated.length > 0 && RESEND_KEY) {
      const alertRows = alerts.map((a, idx) => {
        const borderTop = idx === 0 ? '' : `border-top:1px solid ${BRAND_BORDER};`;
        const reasonColor = a.isOverdue ? BRAND_RED : '#B45309';
        return `<tr>
          <td style="padding:10px 14px;color:${BRAND_TEXT};font-size:13px;font-weight:600;${borderTop}">${a.unit}</td>
          <td style="padding:10px 14px;color:${BRAND_TEXT2};font-size:12px;${borderTop}">${a.city}</td>
          <td style="padding:10px 14px;color:${BRAND_TEXT};font-size:13px;${borderTop}">${a.task}</td>
          <td style="padding:10px 14px;color:${reasonColor};font-size:12px;font-weight:700;${borderTop}">${a.reason}</td>
        </tr>`;
      }).join('');

      const bodyHtml = `<p style="color:${BRAND_TEXT};font-size:14px;line-height:1.7;margin:0 0 16px 0;">${generated.length} preventive maintenance work order${generated.length > 1 ? 's have' : ' has'} been automatically created:</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};border:1px solid ${BRAND_BORDER};border-radius:10px;margin-bottom:16px;">
        <tr>
          <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Unit</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">City</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Task</th>
          <th style="padding:8px 14px;text-align:left;font-size:10px;color:${BRAND_TEXT2};text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Status</th>
        </tr>
        ${alertRows}
      </table>`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND_PAGE};font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:${BRAND_TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAGE};padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_CARD};border-radius:12px;border:1px solid ${BRAND_BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
<tr><td style="background:#065F46;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:bottom;"><img src="${LOGO_URL}" alt="Fencecrete" width="150" style="display:block;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;"/></td>
      <td style="padding-left:14px;padding-bottom:6px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:700;color:${BRAND_TEXT2};letter-spacing:.12em;vertical-align:bottom;">FLEET</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 8px;">
  <div style="display:inline-block;background:#D1FAE5;color:#065F46;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:5px 12px;border-radius:6px;margin-bottom:14px;">📅 PM Work Orders Generated</div>
  <div style="font-size:24px;font-weight:800;color:${BRAND_TEXT};margin-bottom:6px;line-height:1.2;">${todayStr}</div>
  <div style="font-size:13px;color:${BRAND_TEXT2};font-weight:500;">${generated.length} new work order${generated.length === 1 ? '' : 's'} created from PM schedules</div>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
${bodyHtml}
<div style="text-align:left;margin-top:8px;"><a href="${APP_URL}" style="display:inline-block;background:${BRAND_RED};color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(138,38,29,0.3);">View Work Orders →</a></div>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_PAGE};">
  <p style="font-size:11px;color:${BRAND_TEXT3};margin:0;line-height:1.5;">Fencecrete America, LLC &middot; 15089 Tradesman Drive, San Antonio, TX 78249 &middot; (210) 492-7911</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          reply_to: 'ops@fencecrete.com',
          to: ['david@fencecrete.com', 'max@fencecrete.com'],
          subject: `[Fencecrete] 📅 PM Alert: ${generated.length} Work Order${generated.length > 1 ? 's' : ''} Created`,
          html
        })
      });
      if (!r.ok) {
        const errBody = await r.text();
        console.error(`Resend send failed: ${errBody}`);
      }
    }

    return new Response(JSON.stringify({ success: true, generated: generated.length, schedules_checked: schedules.length }), {
      status: 200, headers: jsonHeaders()
    });

  } catch (err: any) {
    console.error('Edge function crashed:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders() });
  }
});
