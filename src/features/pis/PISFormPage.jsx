import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// PIS (Project Information Sheet) public form — v2 (2026-04-29).
//
// This page is rendered OUTSIDE the auth wrapper — recipients (customers,
// GCs, builders) reach it via a tokenized link in the email sent by the
// pis-send edge function. The form posts back to the pis-public edge
// function, which writes to project_info_sheets and notifies AR.
//
// V2 CHANGES (2026-04-29):
//   - City/State/Zip split into 3 fields throughout (job site, owner, GC,
//     billing, surety, agent). Edge function reassembles legacy
//     `*_city_state_zip` columns for backward compat with reports.
//   - "Accounting / BLD Job #" renamed → "Job Number"
//   - Added "Fence Install Date" field (target install date from customer)
//   - "Estimated Completion Date" renamed → "Project Completion Date"
//   - "Owner of Property" section renamed → "Property Owner"
//   - Property Owner Contact Person + Contact Phone now REQUIRED
//   - Fax fields removed from PM, Surety, Agent sections (paperless)
//   - Non-Taxable now triggers an in-form file upload for the tax-exempt
//     certificate. File uploads via signed Storage URL; spine routes to
//     SharePoint folder asynchronously via notifyTaxCertUploadedRule.
//
// Why this lives in the React app instead of the edge function:
// Supabase rewrites text/html responses to text/plain on default domains
// (only Pro + custom domain can serve HTML). So the form HTML must live
// somewhere that can serve text/html — i.e. our Vercel app. The edge
// function stayed as the API endpoint.
// ─────────────────────────────────────────────────────────────────────────

const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';
const PIS_API = `${SB}/functions/v1/pis-public`;

// Supabase edge functions occasionally return 503 with deployment_id=null on
// cold starts (their gateway rejects before routing). They warm up within
// 1-3 seconds. Without retry, customers see "HTTP 503" the first time they
// click a PIS link if no one else has hit the function recently.
//
// Retry with exponential backoff for: network errors, 502, 503, 504.
// Do NOT retry: 4xx (client errors), 500 (genuine server error in our code).
async function fetchWithRetry(url, init = {}, maxAttempts = 4) {
  const transientStatuses = new Set([502, 503, 504]);
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (transientStatuses.has(res.status) && attempt < maxAttempts - 1) {
        // Wait 600ms, 1200ms, 2400ms before each retry
        await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  // Should not reach here, but fall through with a final attempt response
  return fetch(url, init);
}

const fcRed = '#8A261D';
const fcRedDark = '#6B1D16';
const fcBg = '#F4F4F2';
const fcText = '#1A1A1A';
const fcMuted = '#625650';
const fcBorder = '#E5E3E0';

const wrap = { maxWidth: 760, margin: '0 auto', padding: '24px 16px' };
const card = { background: '#FFF', borderRadius: 12, padding: 24, marginBottom: 16, border: `1px solid ${fcBorder}` };
const sectionTitle = { fontWeight: 800, fontSize: 14, color: fcRed, textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 16, paddingBottom: 8, borderBottom: `2px solid ${fcBg}` };
const labelStyle = { fontSize: 11, fontWeight: 700, color: fcMuted, textTransform: 'uppercase', letterSpacing: 0.05, display: 'block', marginBottom: 4 };
const reqStar = { color: fcRed };
const inputStyle = { border: `1.5px solid ${fcBorder}`, borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit', color: fcText, background: '#FAFAF9', width: '100%', boxSizing: 'border-box' };
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 };
const submitBtn = { background: fcRed, color: '#fff', border: 'none', borderRadius: 10, padding: '14px 48px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' };

// Field helper for consistent rendering. `name` is used in form data
// AND becomes the key sent to the API.
function Field({ label, name, required, type = 'text', full, value, onChange, gridSpan, maxLength, placeholder, autoComplete }) {
  const wrapperStyle = { ...fieldStyle, ...(full ? { gridColumn: '1/-1' } : {}), ...(gridSpan ? { gridColumn: `span ${gridSpan}` } : {}) };
  if (type === 'textarea') {
    return <div style={wrapperStyle}>
      <label style={labelStyle}>{label}{required && <span style={reqStar}> *</span>}</label>
      <textarea name={name} required={!!required} value={value || ''} onChange={onChange} style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }} />
    </div>;
  }
  return <div style={wrapperStyle}>
    <label style={labelStyle}>{label}{required && <span style={reqStar}> *</span>}</label>
    <input
      name={name}
      type={type}
      required={!!required}
      value={value || ''}
      onChange={onChange}
      style={inputStyle}
      maxLength={maxLength}
      placeholder={placeholder}
      autoComplete={autoComplete}
    />
  </div>;
}

// AddressRow renders the standard 3-column City | State | Zip pattern used
// throughout the form. Replaces the legacy single "City, State, Zip" field.
// `prefix` is the field-name prefix (e.g. 'owner' yields owner_city/owner_state/owner_zip).
function AddressRow({ prefix, form, onChange, required }) {
  // 2fr 1fr 1fr keeps City widest (most variable length), State narrowest.
  const rowStyle = { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 };
  return <div style={rowStyle}>
    <Field label="City" name={`${prefix}_city`} required={required} value={form[`${prefix}_city`]} onChange={onChange} autoComplete="address-level2" />
    <Field label="State" name={`${prefix}_state`} required={required} value={form[`${prefix}_state`]} onChange={onChange} maxLength={2} placeholder="TX" autoComplete="address-level1" />
    <Field label="Zip" name={`${prefix}_zip`} required={required} value={form[`${prefix}_zip`]} onChange={onChange} maxLength={10} autoComplete="postal-code" />
  </div>;
}

// State page wrappers — for invalid/expired/loading/submitted/error.
function StatePage({ icon, title, body }) {
  return <div style={{ minHeight: '100vh', background: fcBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, Arial, sans-serif' }}>
    <div style={{ background: '#FFF', borderRadius: 16, padding: '48px 40px', maxWidth: 560, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
      <img src="/logo.png" alt="Fencecrete" style={{ display: 'block', height: 36, width: 'auto', maxWidth: 160, margin: '0 auto 32px' }} />
      <div style={{ fontSize: 56, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: fcText, marginBottom: 12 }}>{title}</div>
      <div style={{ fontSize: 15, color: fcMuted, lineHeight: 1.6 }}>{body}</div>
    </div>
  </div>;
}

export default function PISFormPage({ token }) {
  // Status: 'loading' | 'ready' | 'submitted' | 'invalid' | 'expired' | 'already_submitted' | 'error' | 'submitting' | 'success'
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [tok, setTok] = useState(null);
  const [job, setJob] = useState(null);
  const [form, setForm] = useState({});
  const [submitErr, setSubmitErr] = useState('');

  // Tax cert upload state. Lifted to component scope so the spinner +
  // success state survive re-renders during the actual upload.
  // certStatus: 'idle' | 'uploading' | 'done' | 'failed'
  const [certStatus, setCertStatus] = useState('idle');
  const [certFilename, setCertFilename] = useState('');
  const [certUrl, setCertUrl] = useState('');
  const [certError, setCertError] = useState('');
  const fileInputRef = useRef(null);

  // Load token + job context from the API.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setStatus('invalid'); return; }
      try {
        const res = await fetchWithRetry(`${PIS_API}?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'apikey': KEY, 'Authorization': `Bearer ${KEY}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) { setStatus('invalid'); return; }
          if (res.status === 410) { setStatus('expired'); return; }
          setStatus('error');
          setErrorMsg(data?.error || `HTTP ${res.status}`);
          return;
        }
        if (data?.already_submitted) {
          setStatus('already_submitted');
          return;
        }
        setTok(data.token || null);
        setJob(data.job || null);
        // Pre-fill project_name from job if not already set
        setForm({ project_name: data?.job?.job_name || '' });
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e.message || 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const onChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }, []);

  const onRadio = useCallback((name, value) => () => {
    setForm((f) => ({ ...f, [name]: value }));
  }, []);

  // Tax-exempt cert upload handler. Two-step flow:
  //   1. GET pis-public ?action=mint_tax_cert_upload to obtain a signed
  //      PUT URL into the pis-tax-certs Storage bucket.
  //   2. Browser PUTs the file directly to Storage (no base64 inflation).
  // We store the resulting object URL on form state under
  // tax_exempt_cert_url + tax_exempt_cert_filename. The edge function on
  // submit picks these up, saves them on the PIS row, and emits the
  // pis.tax_cert_uploaded spine event so the file is routed to SharePoint.
  const onCertUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCertError('');
    setCertStatus('uploading');
    setCertFilename(file.name);

    try {
      // Step 1: Mint a signed upload URL
      const mintRes = await fetchWithRetry(
        `${PIS_API}?token=${encodeURIComponent(token)}&action=mint_tax_cert_upload&filename=${encodeURIComponent(file.name)}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'apikey': KEY, 'Authorization': `Bearer ${KEY}` },
        }
      );
      const mintData = await mintRes.json();
      if (!mintRes.ok) {
        throw new Error(mintData?.error || `Could not start upload (HTTP ${mintRes.status})`);
      }

      // Step 2: PUT the file to the signed URL.
      // Supabase signed upload URLs expect the file as the request body
      // with Content-Type matching the file's type.
      const uploadRes = await fetch(mintData.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Upload failed (HTTP ${uploadRes.status}): ${errText.slice(0, 200)}`);
      }

      // Step 3: Save the storage path on form state so submission carries it.
      // Bucket is private — OPS team accesses via createSignedUrl when viewing.
      const cert_url = `${SB}/storage/v1/object/${mintData.storage_path}`;
      setCertUrl(cert_url);
      setCertStatus('done');
      setForm((f) => ({
        ...f,
        tax_exempt_cert_url: cert_url,
        tax_exempt_cert_path: mintData.storage_path,
        tax_exempt_cert_filename: file.name,
      }));
    } catch (err) {
      console.error('Cert upload failed:', err);
      setCertError(err.message || 'Upload failed');
      setCertStatus('failed');
      setCertFilename('');
    }
  }, [token]);

  const onCertRemove = useCallback(() => {
    setCertStatus('idle');
    setCertFilename('');
    setCertUrl('');
    setCertError('');
    setForm((f) => {
      const next = { ...f };
      delete next.tax_exempt_cert_url;
      delete next.tax_exempt_cert_path;
      delete next.tax_exempt_cert_filename;
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    setSubmitErr('');

    // Block submission if Non-Taxable selected but cert upload is in flight.
    // We don't make the cert mandatory (some customers will email it later)
    // but we shouldn't let them submit while an upload is mid-flight.
    if (certStatus === 'uploading') {
      setSubmitErr('Please wait for the tax-exempt certificate upload to finish before submitting.');
      return;
    }

    setStatus('submitting');
    try {
      const payload = { ...form, token };
      const res = await fetchWithRetry(`${PIS_API}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': `Bearer ${KEY}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSubmitErr(data?.error || `Submission failed (HTTP ${res.status})`);
        setStatus('ready');
        return;
      }
      setStatus('success');
    } catch (err) {
      setSubmitErr(err.message || 'Network error');
      setStatus('ready');
    }
  }, [form, token, certStatus]);

  // Render gating
  if (status === 'loading') {
    return <StatePage icon="⏳" title="Loading…" body="One moment while we look up your project." />;
  }
  if (status === 'invalid') {
    return <StatePage icon="🔗" title="Link not found" body={<>This link is invalid or has expired.<br /><br />Contact <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a> or call (210) 492-7911.</>} />;
  }
  if (status === 'expired') {
    return <StatePage icon="⌛" title="Link expired" body={<>This link has expired. Please contact <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a> for a new one.</>} />;
  }
  if (status === 'already_submitted' || status === 'success') {
    return <StatePage icon="✅" title="Thank you!" body={<>Your project information has been received. Our team at Fencecrete will review it and be in touch shortly.<br /><br />If you have questions, contact us at <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a> or (210) 492-7911.</>} />;
  }
  if (status === 'error') {
    return <div style={{ minHeight: '100vh', background: fcBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ background: '#FFF', borderRadius: 16, padding: '48px 40px', maxWidth: 560, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        <img src="/logo.png" alt="Fencecrete" style={{ display: 'block', height: 36, width: 'auto', maxWidth: 160, margin: '0 auto 32px' }} />
        <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: fcText, marginBottom: 12 }}>We're having trouble loading the form</div>
        <div style={{ fontSize: 15, color: fcMuted, lineHeight: 1.6, marginBottom: 24 }}>
          This usually clears up in a few seconds. Please try again.
          <br /><br />
          If it keeps happening, contact <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a> or call (210) 492-7911.
          <br /><br />
          <span style={{ fontSize: 11, color: '#9E9B96' }}>Reference: {errorMsg || 'unknown'}</span>
        </div>
        <button
          onClick={() => { setStatus('loading'); setErrorMsg(''); window.location.reload(); }}
          style={{ background: fcRed, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 32px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Try again
        </button>
      </div>
    </div>;
  }

  // Status is 'ready' or 'submitting' — render the form
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
  const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 };
  const radioGroup = { display: 'flex', gap: 16, paddingTop: 4 };
  const radioLabel = { fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: fcText };

  return <div style={{ minHeight: '100vh', background: fcBg, fontFamily: 'Inter, Arial, sans-serif', color: fcText }}>
    <div style={wrap}>
      {/* Header */}
      <div style={{ background: fcText, borderRadius: 12, padding: '20px 24px', marginBottom: 24, color: '#FFF', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ background: '#FFF', borderRadius: 8, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
          <img src="/logo.png" alt="Fencecrete" style={{ display: 'block', height: 36, width: 'auto', maxWidth: 160 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#FFF', letterSpacing: 0.02 }}>Project Information Request</div>
          <div style={{ fontSize: 12, color: '#9E9B96', marginTop: 2 }}>Pursuant to Section 53.159 of the Texas Property Code</div>
        </div>
      </div>

      {/* Banner */}
      <div style={{ background: fcRed, color: '#FFF', borderRadius: 10, padding: '16px 20px', marginBottom: 24, fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Action Required: Project Information Sheet</div>
        Please complete all fields below for <strong>{job?.job_name || tok?.job_name || 'your project'}</strong> (Job #{tok?.job_number || ''}).
        Return this form by emailing <a href="mailto:contracts@fencecrete.com" style={{ color: '#FFD9D9' }}>contracts@fencecrete.com</a> or submitting below.
        <br /><span style={{ opacity: 0.8, fontSize: 12 }}>Contact Amiee Gonzales at (210) 492-7911 with questions.</span>
      </div>

      <form onSubmit={onSubmit}>
        {submitErr && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '12px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{submitErr}</div>}

        {/* Project Details */}
        <div style={card}>
          <div style={sectionTitle}>Project Details</div>
          <Field label="Project Name" name="project_name" required full value={form.project_name} onChange={onChange} />
          <Field label="Job Address (Physical)" name="job_address" required full value={form.job_address} onChange={onChange} autoComplete="street-address" />
          {/* v2: split City | State | Zip + County on a separate row for layout balance */}
          <AddressRow prefix="job" form={form} onChange={onChange} required />
          <div style={grid2}>
            <Field label="County" name="county" value={form.county} onChange={onChange} />
            <span />
          </div>
          <div style={{ ...labelStyle, marginTop: 12, marginBottom: 8 }}>Legal Description (Per Tax Assessor Records)</div>
          <div style={grid3}>
            <Field label="Lot #" name="lot_number" value={form.lot_number} onChange={onChange} />
            <Field label="Subdivision" name="subdivision" value={form.subdivision} onChange={onChange} />
            <Field label="Block/Section" name="block_section" value={form.block_section} onChange={onChange} />
          </div>
          <Field label="Other" name="legal_other" value={form.legal_other} onChange={onChange} />
          {/* v2: 'Accounting / BLD Job #' renamed to 'Job Number'.
                  'Estimated Completion Date' renamed to 'Project Completion Date'.
                  'Fence Install Date' added — customers care most about install
                  date (it's what they communicate to GCs). Project completion follows. */}
          <div style={grid3}>
            <Field label="Job Number" name="accounting_job_number" value={form.accounting_job_number} onChange={onChange} />
            <Field label="Fence Install Date" name="fence_install_date" type="date" value={form.fence_install_date} onChange={onChange} />
            <Field label="Project Completion Date" name="est_completion_date" type="date" value={form.est_completion_date} onChange={onChange} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Type of Job <span style={reqStar}>*</span></label>
            <div style={radioGroup}>
              {['Private', 'Public', 'Government'].map((opt) => (
                <label key={opt} style={radioLabel}>
                  <input type="radio" name="job_type" value={opt} checked={form.job_type === opt} onChange={onRadio('job_type', opt)} required />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* v2: Renamed "Owner of Property" → "Property Owner".
                Contact Person + Contact Phone now REQUIRED — these are the
                primary escalation contact for the AR team and historically
                we've gotten too many PIS forms back with these blank. */}
        <div style={card}>
          <div style={sectionTitle}>Property Owner</div>
          <Field label="Owner / Company Name" name="owner_company" required full value={form.owner_company} onChange={onChange} />
          <Field label="Address" name="owner_address" full value={form.owner_address} onChange={onChange} autoComplete="street-address" />
          <AddressRow prefix="owner" form={form} onChange={onChange} />
          <div style={grid2}>
            <Field label="Phone Number" name="owner_phone" type="tel" value={form.owner_phone} onChange={onChange} autoComplete="tel" />
            <Field label="Contact Person" name="owner_contact" required value={form.owner_contact} onChange={onChange} />
            <Field label="Contact Phone" name="owner_contact_phone" type="tel" required value={form.owner_contact_phone} onChange={onChange} autoComplete="tel" />
            <Field label="Contact Email" name="owner_email" type="email" value={form.owner_email} onChange={onChange} autoComplete="email" />
            <Field label="Alternate Contact" name="owner_alt_contact" value={form.owner_alt_contact} onChange={onChange} gridSpan={2} />
          </div>
        </div>

        {/* General Contractor */}
        <div style={card}>
          <div style={sectionTitle}>General Contractor</div>
          <Field label="GC / Company Name" name="gc_company" full value={form.gc_company} onChange={onChange} />
          <Field label="Address" name="gc_address" full value={form.gc_address} onChange={onChange} autoComplete="street-address" />
          <AddressRow prefix="gc" form={form} onChange={onChange} />
          <div style={grid2}>
            <Field label="Phone Number" name="gc_phone" type="tel" value={form.gc_phone} onChange={onChange} autoComplete="tel" />
            <Field label="Contact Person" name="gc_contact" value={form.gc_contact} onChange={onChange} />
            <Field label="Contact Phone" name="gc_contact_phone" type="tel" value={form.gc_contact_phone} onChange={onChange} autoComplete="tel" />
            <Field label="Contact Email" name="gc_email" type="email" value={form.gc_email} onChange={onChange} autoComplete="email" />
            <Field label="Alternate Contact" name="gc_alt_contact" value={form.gc_alt_contact} onChange={onChange} gridSpan={2} />
          </div>
        </div>

        {/* Billing Contact */}
        <div style={card}>
          <div style={sectionTitle}>Billing Contact</div>
          <Field label="Billing Contact Name" name="billing_contact" required full value={form.billing_contact} onChange={onChange} />
          <Field label="Address" name="billing_address" full value={form.billing_address} onChange={onChange} autoComplete="street-address" />
          <AddressRow prefix="billing" form={form} onChange={onChange} />
          <div style={grid2}>
            <Field label="Phone Number" name="billing_phone" type="tel" value={form.billing_phone} onChange={onChange} autoComplete="tel" />
            <Field label="Email Address" name="billing_email" type="email" required value={form.billing_email} onChange={onChange} autoComplete="email" />
          </div>
        </div>

        {/* PM / Superintendent — v2: Fax field removed (paperless). */}
        <div style={card}>
          <div style={sectionTitle}>Project Manager / Superintendent</div>
          <Field label="Name" name="pm_name" required full value={form.pm_name} onChange={onChange} />
          <div style={grid3}>
            <Field label="Mobile Phone" name="pm_mobile" type="tel" required value={form.pm_mobile} onChange={onChange} autoComplete="tel" />
            <Field label="Office Phone" name="pm_office" type="tel" value={form.pm_office} onChange={onChange} autoComplete="tel" />
            <Field label="Email Address" name="pm_email" type="email" required value={form.pm_email} onChange={onChange} autoComplete="email" />
          </div>
        </div>

        {/* Bonding Information — v2: Fax fields removed from Surety + Agent. */}
        <div style={card}>
          <div style={sectionTitle}>Bonding Information</div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Is your contract subject to bond requirements? <span style={reqStar}>*</span></label>
            <div style={radioGroup}>
              <label style={radioLabel}>
                <input type="radio" name="bonding_required" value="yes" checked={form.bonding_required === 'yes'} onChange={onRadio('bonding_required', 'yes')} required />
                Yes
              </label>
              <label style={radioLabel}>
                <input type="radio" name="bonding_required" value="no" checked={form.bonding_required === 'no'} onChange={onRadio('bonding_required', 'no')} />
                No — N/A
              </label>
            </div>
          </div>
          {form.bonding_required === 'yes' && <>
            <Field label="Name of Surety" name="surety_name" full value={form.surety_name} onChange={onChange} />
            <Field label="Address" name="surety_address" full value={form.surety_address} onChange={onChange} autoComplete="street-address" />
            <AddressRow prefix="surety" form={form} onChange={onChange} />
            <div style={grid2}>
              <Field label="Contact Person" name="surety_contact" value={form.surety_contact} onChange={onChange} />
              <Field label="Office Phone" name="surety_phone" type="tel" value={form.surety_phone} onChange={onChange} autoComplete="tel" />
              <Field label="Contact Email" name="surety_email" type="email" value={form.surety_email} onChange={onChange} autoComplete="email" />
              <Field label="Bond Number" name="bond_number" value={form.bond_number} onChange={onChange} />
              <Field label="Bond Amount ($)" name="bond_amount" type="number" value={form.bond_amount} onChange={onChange} gridSpan={2} />
            </div>
            <div style={{ marginTop: 16, fontWeight: 700, fontSize: 13, color: fcMuted }}>Bonding Agent</div>
            <Field label="Agent Name" name="agent_name" full value={form.agent_name} onChange={onChange} />
            <Field label="Address" name="agent_address" full value={form.agent_address} onChange={onChange} autoComplete="street-address" />
            <AddressRow prefix="agent" form={form} onChange={onChange} />
            <div style={grid2}>
              <Field label="Office Phone" name="agent_phone" type="tel" value={form.agent_phone} onChange={onChange} autoComplete="tel" />
              <Field label="Email" name="agent_email" type="email" value={form.agent_email} onChange={onChange} autoComplete="email" />
            </div>
          </>}
        </div>

        {/* Tax Status — v2: Inline cert upload when Non-Taxable selected.
                          File uploads to private 'pis-tax-certs' Storage
                          bucket via signed URL minted by pis-public.
                          Spine routes the file to SharePoint asynchronously
                          (notifyTaxCertUploadedRule). */}
        <div style={card}>
          <div style={sectionTitle}>Tax Status</div>
          <div style={radioGroup}>
            <label style={radioLabel}>
              <input type="radio" name="taxable" value="yes" checked={form.taxable === 'yes'} onChange={onRadio('taxable', 'yes')} required />
              Taxable
            </label>
            <label style={radioLabel}>
              <input type="radio" name="taxable" value="no" checked={form.taxable === 'no'} onChange={onRadio('taxable', 'no')} />
              Non-Taxable
            </label>
          </div>

          {form.taxable === 'no' && <div style={{ marginTop: 16 }}>
            <div style={{ background: '#FEF3C7', border: '1px solid #B45309', borderRadius: 10, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#B45309', fontWeight: 600, lineHeight: 1.5 }}>
              ⚠ Texas tax-exempt certificate required. Please attach below — the file will be saved to your project's records and routed to our Contracts team automatically.
            </div>

            {/* Idle / picker state */}
            {certStatus === 'idle' && <label style={{ display: 'block', border: `2px dashed ${fcBorder}`, borderRadius: 10, padding: 24, textAlign: 'center', cursor: 'pointer', background: '#FAFAF9' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
                onChange={onCertUpload}
                style={{ display: 'none' }}
              />
              <div style={{ fontSize: 32, marginBottom: 8 }}>📎</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: fcText, marginBottom: 4 }}>Click to attach Tax-Exempt Certificate</div>
              <div style={{ fontSize: 12, color: fcMuted }}>PDF or photo · max 15 MB</div>
            </label>}

            {/* Uploading */}
            {certStatus === 'uploading' && <div style={{ border: `1.5px solid ${fcBorder}`, borderRadius: 10, padding: 16, background: '#FFF', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>⏳</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: fcText }}>Uploading {certFilename}…</div>
                <div style={{ fontSize: 11, color: fcMuted, marginTop: 2 }}>Please don't submit until this finishes.</div>
              </div>
            </div>}

            {/* Success */}
            {certStatus === 'done' && <div style={{ border: '1.5px solid #065F46', borderRadius: 10, padding: 16, background: '#D1FAE5', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>✅</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>{certFilename}</div>
                <div style={{ fontSize: 11, color: '#065F46', marginTop: 2 }}>Attached. Will be saved with your project record.</div>
              </div>
              <button type="button" onClick={onCertRemove} style={{ background: 'transparent', border: '1px solid #065F46', color: '#065F46', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Replace</button>
            </div>}

            {/* Failed */}
            {certStatus === 'failed' && <div style={{ border: '1.5px solid #991B1B', borderRadius: 10, padding: 16, background: '#FEE2E2', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>Upload failed</div>
                <div style={{ fontSize: 11, color: '#991B1B', marginTop: 2 }}>{certError || 'Please try again.'}</div>
              </div>
              <button type="button" onClick={onCertRemove} style={{ background: 'transparent', border: '1px solid #991B1B', color: '#991B1B', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Try again</button>
            </div>}

            <div style={{ fontSize: 11, color: '#9E9B96', marginTop: 10, lineHeight: 1.5 }}>
              Your certificate will be stored securely and shared only with the Fencecrete Contracts team. If you'd rather email it, send to <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a>.
            </div>
          </div>}
        </div>

        {/* Additional Notes */}
        <div style={card}>
          <div style={sectionTitle}>Additional Notes</div>
          <Field label="Anything else we should know?" name="notes" type="textarea" full value={form.notes} onChange={onChange} />
        </div>

        {/* Submit */}
        <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
          <button type="submit" disabled={status === 'submitting' || certStatus === 'uploading'} style={{ ...submitBtn, opacity: (status === 'submitting' || certStatus === 'uploading') ? 0.6 : 1, cursor: (status === 'submitting' || certStatus === 'uploading') ? 'wait' : 'pointer' }}>
            {status === 'submitting' ? 'Submitting…' : 'Submit Project Information'}
          </button>
          <div style={{ fontSize: 12, color: '#9E9B96', marginTop: 12 }}>
            By submitting, you confirm the information above is accurate. Questions? Email <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a>
          </div>
        </div>
      </form>
      {/* Legal entity footer — required for the Tex. Prop. Code 53.159
          statutory context this form is sent under. Brand-facing copy
          uses "Fencecrete"; legal entity name only appears here. */}
      <div style={{ textAlign: 'center', padding: '20px 0 32px', fontSize: 11, color: '#9E9B96', borderTop: '1px solid #E5E3E0', marginTop: 24 }}>
        Fencecrete America, LLC · 15089 Tradesman Drive, San Antonio, TX 78249 · (210) 492-7911
      </div>
    </div>
  </div>;
}
