import React, { useState, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// PIS (Project Information Sheet) public form.
// This page is rendered OUTSIDE the auth wrapper — recipients (customers,
// GCs, builders) reach it via a tokenized link in the email sent by the
// pis-send edge function. The form posts back to the pis-public edge
// function, which writes to project_info_sheets and notifies AR.
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
function Field({ label, name, required, type = 'text', full, value, onChange, gridSpan }) {
  const wrapperStyle = { ...fieldStyle, ...(full ? { gridColumn: '1/-1' } : {}), ...(gridSpan ? { gridColumn: `span ${gridSpan}` } : {}) };
  if (type === 'textarea') {
    return <div style={wrapperStyle}>
      <label style={labelStyle}>{label}{required && <span style={reqStar}> *</span>}</label>
      <textarea name={name} required={!!required} value={value || ''} onChange={onChange} style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }} />
    </div>;
  }
  return <div style={wrapperStyle}>
    <label style={labelStyle}>{label}{required && <span style={reqStar}> *</span>}</label>
    <input name={name} type={type} required={!!required} value={value || ''} onChange={onChange} style={inputStyle} />
  </div>;
}

// State page wrappers — for invalid/expired/loading/submitted/error.
function StatePage({ icon, title, body, color = fcRed }) {
  return <div style={{ minHeight: '100vh', background: fcBg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, Arial, sans-serif' }}>
    <div style={{ background: '#FFF', borderRadius: 16, padding: '48px 40px', maxWidth: 560, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
      <div style={{ fontWeight: 900, fontSize: 22, color, letterSpacing: -0.02, marginBottom: 32 }}>FENCECRETE</div>
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

  // Load token + job context from the API.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setStatus('invalid'); return; }
      try {
        const res = await fetch(`${PIS_API}?token=${encodeURIComponent(token)}`, {
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

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    setSubmitErr('');
    setStatus('submitting');
    try {
      const payload = { ...form, token };
      const res = await fetch(`${PIS_API}?token=${encodeURIComponent(token)}`, {
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
  }, [form, token]);

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
    return <StatePage icon="✅" title="Thank you!" body={<>Your project information has been received. Our team at Fencecrete America will review it and be in touch shortly.<br /><br />If you have questions, contact us at <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a> or (210) 492-7911.</>} color={fcRed} />;
  }
  if (status === 'error') {
    return <StatePage icon="⚠️" title="Something went wrong" body={<>{errorMsg || 'Please try again.'}<br /><br />If this keeps happening, contact <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a>.</>} />;
  }

  // Status is 'ready' or 'submitting' — render the form
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
  const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 };
  const radioGroup = { display: 'flex', gap: 16, paddingTop: 4 };
  const radioLabel = { fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: fcText };

  return <div style={{ minHeight: '100vh', background: fcBg, fontFamily: 'Inter, Arial, sans-serif', color: fcText }}>
    <div style={wrap}>
      {/* Header */}
      <div style={{ background: fcText, borderRadius: 12, padding: '24px 28px', marginBottom: 24, color: '#FFF' }}>
        <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: -0.02 }}>FENCECRETE AMERICA</div>
        <div style={{ fontSize: 12, color: '#9E9B96', marginTop: 2 }}>Project Information Request · Pursuant to Section 53.159 of the Texas Property Code</div>
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
          <Field label="Job Address (Physical)" name="job_address" required full value={form.job_address} onChange={onChange} />
          <div style={grid2}>
            <Field label="City, State, Zip" name="city_state_zip" required value={form.city_state_zip} onChange={onChange} />
            <Field label="County" name="county" value={form.county} onChange={onChange} />
          </div>
          <div style={{ ...labelStyle, marginTop: 12, marginBottom: 8 }}>Legal Description (Per Tax Assessor Records)</div>
          <div style={grid3}>
            <Field label="Lot #" name="lot_number" value={form.lot_number} onChange={onChange} />
            <Field label="Subdivision" name="subdivision" value={form.subdivision} onChange={onChange} />
            <Field label="Block/Section" name="block_section" value={form.block_section} onChange={onChange} />
          </div>
          <Field label="Other" name="legal_other" value={form.legal_other} onChange={onChange} />
          <div style={grid2}>
            <Field label="Accounting / BLD Job #" name="accounting_job_number" value={form.accounting_job_number} onChange={onChange} />
            <Field label="Estimated Completion Date" name="est_completion_date" type="date" value={form.est_completion_date} onChange={onChange} />
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

        {/* Owner of Property */}
        <div style={card}>
          <div style={sectionTitle}>Owner of Property</div>
          <Field label="Owner / Company Name" name="owner_company" required full value={form.owner_company} onChange={onChange} />
          <Field label="Address" name="owner_address" full value={form.owner_address} onChange={onChange} />
          <div style={grid2}>
            <Field label="City, State, Zip" name="owner_city_state_zip" value={form.owner_city_state_zip} onChange={onChange} />
            <Field label="Phone Number" name="owner_phone" type="tel" value={form.owner_phone} onChange={onChange} />
            <Field label="Contact Person" name="owner_contact" value={form.owner_contact} onChange={onChange} />
            <Field label="Contact Phone" name="owner_contact_phone" type="tel" value={form.owner_contact_phone} onChange={onChange} />
            <Field label="Contact Email" name="owner_email" type="email" value={form.owner_email} onChange={onChange} />
            <Field label="Alternate Contact" name="owner_alt_contact" value={form.owner_alt_contact} onChange={onChange} />
          </div>
        </div>

        {/* General Contractor */}
        <div style={card}>
          <div style={sectionTitle}>General Contractor</div>
          <Field label="GC / Company Name" name="gc_company" full value={form.gc_company} onChange={onChange} />
          <Field label="Address" name="gc_address" full value={form.gc_address} onChange={onChange} />
          <div style={grid2}>
            <Field label="City, State, Zip" name="gc_city_state_zip" value={form.gc_city_state_zip} onChange={onChange} />
            <Field label="Phone Number" name="gc_phone" type="tel" value={form.gc_phone} onChange={onChange} />
            <Field label="Contact Person" name="gc_contact" value={form.gc_contact} onChange={onChange} />
            <Field label="Contact Phone" name="gc_contact_phone" type="tel" value={form.gc_contact_phone} onChange={onChange} />
            <Field label="Contact Email" name="gc_email" type="email" value={form.gc_email} onChange={onChange} />
            <Field label="Alternate Contact" name="gc_alt_contact" value={form.gc_alt_contact} onChange={onChange} />
          </div>
        </div>

        {/* Billing Contact */}
        <div style={card}>
          <div style={sectionTitle}>Billing Contact</div>
          <Field label="Billing Contact Name" name="billing_contact" required full value={form.billing_contact} onChange={onChange} />
          <Field label="Address" name="billing_address" full value={form.billing_address} onChange={onChange} />
          <div style={grid2}>
            <Field label="City, State, Zip" name="billing_city_state_zip" value={form.billing_city_state_zip} onChange={onChange} />
            <Field label="Phone Number" name="billing_phone" type="tel" value={form.billing_phone} onChange={onChange} />
          </div>
          <Field label="Email Address" name="billing_email" type="email" required full value={form.billing_email} onChange={onChange} />
        </div>

        {/* PM / Superintendent */}
        <div style={card}>
          <div style={sectionTitle}>Project Manager / Superintendent</div>
          <Field label="Name" name="pm_name" required full value={form.pm_name} onChange={onChange} />
          <div style={grid2}>
            <Field label="Mobile Phone" name="pm_mobile" type="tel" required value={form.pm_mobile} onChange={onChange} />
            <Field label="Office Phone" name="pm_office" type="tel" value={form.pm_office} onChange={onChange} />
            <Field label="Fax" name="pm_fax" type="tel" value={form.pm_fax} onChange={onChange} />
            <Field label="Email Address" name="pm_email" type="email" required value={form.pm_email} onChange={onChange} />
          </div>
        </div>

        {/* Bonding Information */}
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
            <Field label="Address" name="surety_address" full value={form.surety_address} onChange={onChange} />
            <div style={grid2}>
              <Field label="City, State, Zip" name="surety_city_state_zip" value={form.surety_city_state_zip} onChange={onChange} />
              <Field label="Contact Person" name="surety_contact" value={form.surety_contact} onChange={onChange} />
              <Field label="Office Phone" name="surety_phone" type="tel" value={form.surety_phone} onChange={onChange} />
              <Field label="Fax" name="surety_fax" type="tel" value={form.surety_fax} onChange={onChange} />
              <Field label="Contact Email" name="surety_email" type="email" value={form.surety_email} onChange={onChange} />
              <Field label="Bond Number" name="bond_number" value={form.bond_number} onChange={onChange} />
              <Field label="Bond Amount ($)" name="bond_amount" type="number" value={form.bond_amount} onChange={onChange} />
            </div>
            <div style={{ marginTop: 16, fontWeight: 700, fontSize: 13, color: fcMuted }}>Bonding Agent</div>
            <Field label="Agent Name" name="agent_name" full value={form.agent_name} onChange={onChange} />
            <Field label="Address" name="agent_address" full value={form.agent_address} onChange={onChange} />
            <div style={grid2}>
              <Field label="City, State, Zip" name="agent_city_state_zip" value={form.agent_city_state_zip} onChange={onChange} />
              <Field label="Office Phone" name="agent_phone" type="tel" value={form.agent_phone} onChange={onChange} />
              <Field label="Fax" name="agent_fax" type="tel" value={form.agent_fax} onChange={onChange} />
              <Field label="Email" name="agent_email" type="email" value={form.agent_email} onChange={onChange} />
            </div>
          </>}
        </div>

        {/* Tax Status */}
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
          {form.taxable === 'no' && <div style={{ marginTop: 12, fontSize: 13, color: '#B45309', fontWeight: 600 }}>
            ⚠ Please email your completed Tax Exempt Certificate to <a href="mailto:contracts@fencecrete.com" style={{ color: '#B45309' }}>contracts@fencecrete.com</a>
          </div>}
        </div>

        {/* Additional Notes */}
        <div style={card}>
          <div style={sectionTitle}>Additional Notes</div>
          <Field label="Anything else we should know?" name="notes" type="textarea" full value={form.notes} onChange={onChange} />
        </div>

        {/* Submit */}
        <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
          <button type="submit" disabled={status === 'submitting'} style={{ ...submitBtn, opacity: status === 'submitting' ? 0.6 : 1, cursor: status === 'submitting' ? 'wait' : 'pointer' }}>
            {status === 'submitting' ? 'Submitting…' : 'Submit Project Information'}
          </button>
          <div style={{ fontSize: 12, color: '#9E9B96', marginTop: 12 }}>
            By submitting, you confirm the information above is accurate. Questions? Email <a href="mailto:contracts@fencecrete.com" style={{ color: fcRed }}>contracts@fencecrete.com</a>
          </div>
        </div>
      </form>
    </div>
  </div>;
}
