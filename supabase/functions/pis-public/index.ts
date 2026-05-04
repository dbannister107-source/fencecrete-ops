import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const APP_URL = 'https://forms.fencecrete.com';

// Contracts role mailbox—NOT amiee@fencecrete.com.
const CONTRACTS_EMAIL = 'contracts@fencecrete.com';

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonResponse = (data: unknown, status = 200): Response => {
  const h = new Headers();
  h.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(CORS_BASE)) h.set(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
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
  if (r.status === 204 || r.status === 205 || r.headers.get('content-length') === '0') {
    return null;
  }
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
};

// ---------------------------------------------------------------------
// Helpers for v2 form (2026-04-29)
// ---------------------------------------------------------------------
// V21 (2026-04-29): Removed the legacy direct PIS-received notification
//   email block (~60 lines, plus RESEND_KEY constant + LOGO_URL +
//   FROM_ADDRESS + certPanel + notifyHtml + the Resend POST). Spine now
//   owns ALL PIS notifications via dispatch_system_event:
//     - pis.submitted          → notifyPisSubmittedRule
//     - pis.tax_cert_uploaded  → notifyTaxCertUploadedRule
//   Same playbook used when job-stage-notification was deprecated in
//   favor of notifyJobStatusChangedRule on the spine. Pre-v21 we were
//   sending 2x "PIS Received" emails to contracts@ for every submission
//   (one direct, one spine) which was annoying and duplicative.
// V20 (2026-04-29): Removed pm_fax / surety_fax / agent_fax from insert
//   payload. Columns dropped from project_info_sheets in migration
//   drop_fax_columns_paperless_2026_04_29. Paperless mandate.
// V19 (2026-04-29): Added v2 form support — split city/state/zip,
//   fence_install_date, tax_exempt_cert_* fields, mint_tax_cert_upload
//   GET endpoint for signed Storage upload URLs.

const joinCsz = (city?: string | null, state?: string | null, zip?: string | null): string | null => {
  const c = (city || '').trim();
  const s = (state || '').trim();
  const z = (zip || '').trim();
  if (!c && !s && !z) return null;
  const stateZip = [s, z].filter(Boolean).join(' ');
  return [c, stateZip].filter(Boolean).join(', ');
};

const sanitizeFilename = (name: string): string => {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return base || 'upload';
};

const mintTaxCertUploadUrl = async (jobNumber: string, originalFilename: string) => {
  const ts = Date.now();
  const rand = crypto.randomUUID().split('-')[0];
  const cleaned = sanitizeFilename(originalFilename);
  const path = `${jobNumber}/${ts}-${rand}-${cleaned}`;

  const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/pis-tax-certs/${path}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`signed upload mint failed (${r.status}): ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  const fullUrl = data.url?.startsWith('http') ? data.url : `${SB_URL}/storage/v1${data.url}`;
  return {
    upload_url: fullUrl,
    token: data.token,
    path,
    bucket: 'pis-tax-certs',
    storage_path: `pis-tax-certs/${path}`,
  };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_BASE });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const action = url.searchParams.get('action');

  if (req.method === 'GET' && action === 'mint_tax_cert_upload') {
    if (!token) return jsonResponse({ error: 'Missing token' }, 400);
    const filename = url.searchParams.get('filename') || 'tax-cert.pdf';
    const rows = await sb(`pis_tokens?token=eq.${token}&select=*`);
    const tok = rows?.[0];
    if (!tok) return jsonResponse({ error: 'Token not found' }, 404);
    if (new Date(tok.expires_at) < new Date()) return jsonResponse({ error: 'Link expired' }, 410);
    if (tok.submitted_at) return jsonResponse({ error: 'Form already submitted' }, 409);
    try {
      const upload = await mintTaxCertUploadUrl(tok.job_number || 'unknown-job', filename);
      return jsonResponse(upload);
    } catch (err: any) {
      console.error('mint_tax_cert_upload failed:', err);
      return jsonResponse({ error: err.message || 'Upload URL mint failed' }, 500);
    }
  }

  if (req.method === 'GET') {
    if (!token) return jsonResponse({ error: 'Missing token' }, 400);
    const rows = await sb(`pis_tokens?token=eq.${token}&select=*`);
    const tok = rows?.[0];
    if (!tok) return jsonResponse({ error: 'Token not found' }, 404);
    if (new Date(tok.expires_at) < new Date()) return jsonResponse({ error: 'Link expired' }, 410);
    if (tok.submitted_at) {
      return jsonResponse({ token: tok, already_submitted: true });
    }
    const jobs = await sb(`jobs?id=eq.${tok.job_id}&select=job_name,job_number,customer_name,market`);
    const job = jobs?.[0] || null;
    return jsonResponse({ token: tok, job });
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const tok_val = body.token || token;
      if (!tok_val) return jsonResponse({ error: 'Missing token' }, 400);

      const rows = await sb(`pis_tokens?token=eq.${tok_val}&select=*`);
      const tok = rows?.[0];
      if (!tok) return jsonResponse({ error: 'Invalid token' }, 404);
      if (new Date(tok.expires_at) < new Date()) return jsonResponse({ error: 'Link expired' }, 410);
      if (tok.submitted_at) return jsonResponse({ error: 'Already submitted' }, 409);

      const job_csz = joinCsz(body.job_city, body.job_state, body.job_zip) || body.city_state_zip || null;
      const owner_csz = joinCsz(body.owner_city, body.owner_state, body.owner_zip) || body.owner_city_state_zip || null;
      const gc_csz = joinCsz(body.gc_city, body.gc_state, body.gc_zip) || body.gc_city_state_zip || null;
      const billing_csz = joinCsz(body.billing_city, body.billing_state, body.billing_zip) || body.billing_city_state_zip || null;
      const surety_csz = joinCsz(body.surety_city, body.surety_state, body.surety_zip) || body.surety_city_state_zip || null;
      const agent_csz = joinCsz(body.agent_city, body.agent_state, body.agent_zip) || body.agent_city_state_zip || null;

      const sheet = {
        token_id: tok.id,
        job_id: tok.job_id,
        job_number: tok.job_number,
        submitted_by_name: body.submitted_by_name || null,
        project_name: body.project_name || null,
        job_address: body.job_address || null,
        job_city: body.job_city || null,
        job_state: body.job_state || null,
        job_zip: body.job_zip || null,
        city_state_zip: job_csz,
        county: body.county || null,
        lot_number: body.lot_number || null,
        subdivision: body.subdivision || null,
        block_section: body.block_section || null,
        legal_other: body.legal_other || null,
        accounting_job_number: body.accounting_job_number || null,
        est_completion_date: body.est_completion_date || null,
        fence_install_date: body.fence_install_date || null,
        job_type: body.job_type || null,
        owner_company: body.owner_company || null,
        owner_address: body.owner_address || null,
        owner_city: body.owner_city || null,
        owner_state: body.owner_state || null,
        owner_zip: body.owner_zip || null,
        owner_city_state_zip: owner_csz,
        owner_phone: body.owner_phone || null,
        owner_contact: body.owner_contact || null,
        owner_contact_phone: body.owner_contact_phone || null,
        owner_email: body.owner_email || null,
        owner_alt_contact: body.owner_alt_contact || null,
        // General Contractor — paperless, no fax field
        gc_company: body.gc_company || null,
        gc_address: body.gc_address || null,
        gc_city: body.gc_city || null,
        gc_state: body.gc_state || null,
        gc_zip: body.gc_zip || null,
        gc_city_state_zip: gc_csz,
        gc_phone: body.gc_phone || null,
        gc_contact: body.gc_contact || null,
        gc_contact_phone: body.gc_contact_phone || null,
        gc_email: body.gc_email || null,
        gc_alt_contact: body.gc_alt_contact || null,
        billing_contact: body.billing_contact || null,
        billing_address: body.billing_address || null,
        billing_city: body.billing_city || null,
        billing_state: body.billing_state || null,
        billing_zip: body.billing_zip || null,
        billing_city_state_zip: billing_csz,
        billing_phone: body.billing_phone || null,
        billing_email: body.billing_email || null,
        // Project Manager / Superintendent — paperless, no fax field
        pm_name: body.pm_name || null,
        pm_mobile: body.pm_mobile || null,
        pm_office: body.pm_office || null,
        pm_email: body.pm_email || null,
        // Bonding — paperless, no surety/agent fax fields
        bonding_required: body.bonding_required === 'yes',
        surety_name: body.surety_name || null,
        surety_address: body.surety_address || null,
        surety_city: body.surety_city || null,
        surety_state: body.surety_state || null,
        surety_zip: body.surety_zip || null,
        surety_city_state_zip: surety_csz,
        surety_contact: body.surety_contact || null,
        surety_phone: body.surety_phone || null,
        surety_email: body.surety_email || null,
        bond_number: body.bond_number || null,
        bond_amount: body.bond_amount ? parseFloat(body.bond_amount) : null,
        contract_bond_required: body.bonding_required === 'yes',
        agent_name: body.agent_name || null,
        agent_address: body.agent_address || null,
        agent_city: body.agent_city || null,
        agent_state: body.agent_state || null,
        agent_zip: body.agent_zip || null,
        agent_city_state_zip: agent_csz,
        agent_phone: body.agent_phone || null,
        agent_email: body.agent_email || null,
        taxable: body.taxable === 'yes',
        tax_exempt_cert_provided: body.taxable === 'no' && !!body.tax_exempt_cert_path,
        tax_exempt_cert_url: body.tax_exempt_cert_url || null,
        tax_exempt_cert_filename: body.tax_exempt_cert_filename || null,
        tax_exempt_cert_uploaded_at: body.tax_exempt_cert_url ? new Date().toISOString() : null,
        notes: body.notes || null,
      };

      const insertResult = await sb('project_info_sheets', { method: 'POST', body: JSON.stringify(sheet) });
      const insertedRow = Array.isArray(insertResult) ? insertResult[0] : insertResult;

      await sb(`pis_tokens?id=eq.${tok.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ submitted_at: new Date().toISOString() }),
      });

      let jobRow: any = null;
      try {
        const jrows = await sb(`jobs?id=eq.${tok.job_id}&select=sales_rep,pm,market,customer_name,customer_email,billing_email,billing_contact,gc_company,accounting_job_number,tax_exempt,bonds_amount,active_install_date,est_start_date`);
        jobRow = jrows?.[0] || null;
      } catch (jobErr) {
        console.error('PIS: job lookup failed (continuing without sales_rep)', jobErr);
      }

      // PROPAGATION: fill blank jobs fields. Fill-blanks-only.
      // v2 also propagates fence_install_date → jobs.est_start_date when blank.
      try {
        if (jobRow) {
          const updates: Record<string, unknown> = {};
          const fillIfBlank = (jobsField: string, jobsVal: any, pisVal: any) => {
            if ((jobsVal === null || jobsVal === undefined || jobsVal === '') && pisVal && String(pisVal).trim() !== '') {
              updates[jobsField] = pisVal;
            }
          };
          fillIfBlank('customer_email', jobRow.customer_email, sheet.owner_email || sheet.billing_email);
          fillIfBlank('billing_email', jobRow.billing_email, sheet.billing_email);
          fillIfBlank('billing_contact', jobRow.billing_contact, sheet.billing_contact);
          fillIfBlank('gc_company', jobRow.gc_company, sheet.gc_company);
          fillIfBlank('accounting_job_number', jobRow.accounting_job_number, sheet.accounting_job_number);
          fillIfBlank('est_start_date', jobRow.est_start_date, sheet.fence_install_date);
          if (jobRow.tax_exempt === null && sheet.taxable === false) {
            updates['tax_exempt'] = true;
          }
          if ((jobRow.bonds_amount === null || Number(jobRow.bonds_amount) === 0) && sheet.bond_amount && Number(sheet.bond_amount) > 0) {
            updates['bonds_amount'] = sheet.bond_amount;
          }
          if (Object.keys(updates).length > 0) {
            await sb(`jobs?id=eq.${tok.job_id}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify(updates),
            });
            console.log(`PIS: propagated ${Object.keys(updates).length} field(s) to jobs ${tok.job_number}: ${Object.keys(updates).join(', ')}`);
          }
        }
      } catch (propErr) {
        console.error('PIS: propagation to jobs failed (PIS row already saved):', propErr);
      }

      // ---------------------------------------------------------------
      // Spine emit — fire-and-forget. Spine owns all PIS notifications
      // as of v21:
      //   pis.submitted          → notifyPisSubmittedRule
      //   pis.tax_cert_uploaded  → notifyTaxCertUploadedRule
      // ---------------------------------------------------------------
      try {
        const spinePayload = {
          event_type: 'pis.submitted',
          event_category: 'contracts',
          actor_type: 'external',
          actor_label: sheet.submitted_by_name || tok.sent_to_name || 'customer',
          entity_type: 'pis_token',
          entity_id: tok.id,
          payload: {
            job_id: tok.job_id,
            job_number: tok.job_number,
            job_name: tok.job_name,
            customer_name: jobRow?.customer_name || null,
            sales_rep: jobRow?.sales_rep || null,
            pm: jobRow?.pm || null,
            market: jobRow?.market || null,
            submitted_by_name: sheet.submitted_by_name,
            sent_to_email: tok.sent_to_email,
            sent_to_name: tok.sent_to_name,
            project_name: sheet.project_name,
            accounting_job_number: sheet.accounting_job_number,
            fence_install_date: sheet.fence_install_date,
            est_completion_date: sheet.est_completion_date,
            owner_company: sheet.owner_company,
            gc_company: sheet.gc_company,
            billing_contact: sheet.billing_contact,
            billing_email: sheet.billing_email,
            pm_name: sheet.pm_name,
            pm_mobile: sheet.pm_mobile,
            bonding_required: sheet.bonding_required,
            bond_number: sheet.bond_number,
            taxable: sheet.taxable,
            tax_exempt_cert_url: sheet.tax_exempt_cert_url,
            tax_exempt_cert_filename: sheet.tax_exempt_cert_filename,
          },
        };
        await sb('system_events', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(spinePayload),
        });

        if (sheet.tax_exempt_cert_url && insertedRow?.id) {
          await sb('system_events', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              event_type: 'pis.tax_cert_uploaded',
              event_category: 'contracts',
              actor_type: 'external',
              actor_label: sheet.submitted_by_name || tok.sent_to_name || 'customer',
              entity_type: 'project_info_sheet',
              entity_id: insertedRow.id,
              payload: {
                pis_id: insertedRow.id,
                job_id: tok.job_id,
                job_number: tok.job_number,
                job_name: tok.job_name,
                tax_exempt_cert_url: sheet.tax_exempt_cert_url,
                tax_exempt_cert_filename: sheet.tax_exempt_cert_filename,
              },
            }),
          });
        }
      } catch (spineErr) {
        // Hard log: spine failure means contracts gets NO email. Used to
        // be a soft fallback on the legacy direct send; v21 removed that
        // safety net. If we see this in logs we need to triage immediately.
        console.error('PIS: system_events emit failed — NO notification will be sent:', spineErr);
      }

      return jsonResponse({ success: true });
    } catch (err: any) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
