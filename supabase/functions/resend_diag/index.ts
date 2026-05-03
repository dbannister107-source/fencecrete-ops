// resend_diag v4 — simplified single-send. Multi-send was hitting Deno
// edge-runtime DNS cache overflow on rapid successive fetch() calls.

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// @ts-ignore
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  let target = 'david@fencecrete.com';
  let from = 'Fencecrete <ops@mail.fencecrete.com>';
  try {
    const body = await req.json();
    if (body?.to) target = body.to;
    if (body?.from) from = body.from;
  } catch {}

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from,
      to: [target],
      subject: '[POST-ALLOWLIST] Inbox check after Defender policies',
      html: `<p>Test sent at ${new Date().toISOString()} from <code>${from}</code>.</p><p>If this lands in inbox, the Defender allowlists worked. If it lands in junk, more work is needed (likely 210 IT or transport rules).</p>`,
    }),
  });
  const txt = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch {}

  return new Response(JSON.stringify({ http_status: res.status, body: parsed || txt }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
