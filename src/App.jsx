import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

/* ═══ CONFIG ═══ */
const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const get = async (t, q = '') => { const r = await fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H }); return r.json(); };
const patch = async (t, id, b) => { await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) }); };
const post = async (t, b) => { const r = await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: H, body: JSON.stringify(b) }); return r.json(); };
const alert_ = (type, job) => { try { fetch(`${SB}/functions/v1/send-alert`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ type, job }) }); } catch {} };

const $ = v => { const x = Number(v) || 0; return '$' + x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
const $k = v => { const x = Number(v) || 0; return x >= 1e6 ? '$' + (x/1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x/1e3).toFixed(0) + 'K' : '$' + x; };
const n = v => Number(v) || 0;
const fD = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

const STATUSES = ['contract_review', 'production_queue', 'in_production', 'complete'];
const S_LABEL = { contract_review: 'Contract Review', production_queue: 'Production Queue', in_production: 'In Production', complete: 'Complete' };
const S_COLOR = { contract_review: '#B45309', production_queue: '#1D4ED8', in_production: '#6D28D9', complete: '#065F46' };
const S_BG = { contract_review: '#FEF3C7', production_queue: '#DBEAFE', in_production: '#EDE9FE', complete: '#D1FAE5' };
const S_SHORT = { contract_review: 'Review', production_queue: 'Prod Queue', in_production: 'In Prod', complete: 'Complete' };
const MKTS = ['Austin', 'Dallas-Fort Worth', 'Houston', 'San Antonio'];
const M_COLOR = { Austin: '#C2410C', 'Dallas-Fort Worth': '#1D4ED8', Houston: '#065F46', 'San Antonio': '#9D174D' };
const M_BG = { Austin: '#FED7AA', 'Dallas-Fort Worth': '#DBEAFE', Houston: '#D1FAE5', 'San Antonio': '#FCE7F3' };
const M_SHORT = { Austin: 'Austin', 'Dallas-Fort Worth': 'DFW', Houston: 'Houston', 'San Antonio': 'SA' };

/* ═══ STYLES ═══ */
const card = { background: '#FFFFFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const inputS = { width: '100%', padding: '8px 12px', background: '#FFFFFF', border: '1px solid #D1CEC9', borderRadius: 8, color: '#1A1A1A', fontSize: 13 };
const btnP = { padding: '8px 16px', background: '#8B2020', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
const btnS = { ...btnP, background: '#F4F4F2', color: '#6B6056', border: '1px solid #E5E3E0' };
const pill = (c, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: bg || (c + '18'), color: c });

/* ═══ COMPONENTS ═══ */
function KPI({ label, value, color = '#8B2020' }) {
  return <div style={card}><div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800, color }}>{value}</div><div style={{ fontSize: 12, color: '#6B6056', marginTop: 4 }}>{label}</div></div>;
}

function PBar({ pct: p, color = '#8B2020', h = 6 }) {
  return <div style={{ height: h, background: '#E5E3E0', borderRadius: h, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(Math.max(p, 0), 100)}%`, background: color, borderRadius: h, transition: 'width .3s' }} /></div>;
}

/* ═══ DASHBOARD ═══ */
function Dashboard({ jobs }) {
  const active = useMemo(() => jobs.filter(j => j.status !== 'complete'), [jobs]);
  const tc = active.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0);
  const tl = active.reduce((s, j) => s + n(j.left_to_bill), 0);
  const ty = active.reduce((s, j) => s + n(j.ytd_invoiced), 0);
  const tlf = active.reduce((s, j) => s + n(j.total_lf), 0);

  const mktData = MKTS.map(m => {
    const mj = active.filter(j => j.market === m);
    return { name: M_SHORT[m], value: mj.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0), fill: M_COLOR[m], ltb: mj.reduce((s, j) => s + n(j.left_to_bill), 0), count: mj.length };
  });

  const alerts = active.filter(j => n(j.contract_age) > 30 && n(j.ytd_invoiced) === 0).sort((a, b) => n(b.contract_age) - n(a.contract_age));
  const top15 = [...active].sort((a, b) => n(b.left_to_bill) - n(a.left_to_bill)).slice(0, 15);

  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <KPI label="Total Contract Value" value={$k(tc)} />
        <KPI label="Left to Bill" value={$k(tl)} color="#B45309" />
        <KPI label="YTD Billed" value={$k(ty)} color="#065F46" />
        <KPI label="Active LF" value={tlf.toLocaleString()} color="#1D4ED8" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Chart */}
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Contract Value by Market</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mktData} barSize={40}>
              <XAxis dataKey="name" tick={{ fill: '#6B6056', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6B6056', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v/1e6).toFixed(1) + 'M'} />
              <Tooltip formatter={v => $(v)} contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E3E0', borderRadius: 8, color: '#1A1A1A' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>{mktData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pipeline */}
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Pipeline by Status</div>
          {STATUSES.filter(s => s !== 'complete').map(s => {
            const sj = active.filter(j => j.status === s);
            const sv = sj.reduce((x, j) => x + n(j.adj_contract_value || j.contract_value), 0);
            const sl = sj.reduce((x, j) => x + n(j.left_to_bill), 0);
            return (
              <div key={s} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span><span style={pill(S_COLOR[s], S_BG[s])}>{S_SHORT[s]}</span> <span style={{ color: '#6B6056', marginLeft: 6 }}>{sj.length} projects</span></span>
                  <span style={{ color: '#9E9B96' }}>{$k(sv)} &middot; LTB {$k(sl)}</span>
                </div>
                <PBar pct={tc > 0 ? sv / tc * 100 : 0} color={S_COLOR[s]} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Top 15 LTB */}
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Top 15 Left to Bill</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #E5E3E0', fontSize: 11, color: '#6B6056' }}><th style={{ textAlign: 'left', padding: '6px 8px' }}>Job</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Market</th><th style={{ textAlign: 'right', padding: '6px 8px' }}>LTB</th><th style={{ textAlign: 'right', padding: '6px 8px' }}>%</th></tr></thead>
            <tbody>{top15.map(j => (
              <tr key={j.id} style={{ borderBottom: '1px solid #E5E3E0' }}>
                <td style={{ padding: '5px 8px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name}</td>
                <td style={{ padding: '5px 8px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'Syne', fontWeight: 700, color: '#8B2020', fontSize: 13 }}>{$(j.left_to_bill)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 12, color: '#6B6056' }}>{n(j.pct_billed)}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        {/* Alerts */}
        <div style={{ ...card, borderColor: alerts.length > 0 ? '#F59E0B30' : '#E5E3E0' }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12, color: '#B45309' }}>Billing Alerts ({alerts.length})</div>
          {alerts.length === 0 && <div style={{ color: '#6B6056', padding: 20, textAlign: 'center' }}>No alerts</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{alerts.slice(0, 15).map(j => (
              <tr key={j.id} style={{ borderBottom: '1px solid #E5E3E0' }}>
                <td style={{ padding: '5px 8px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name}</td>
                <td style={{ padding: '5px 8px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}>{$(j.contract_value)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 12, color: '#B45309' }}>{j.contract_age}d</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══ EDIT PANEL (slide from right) ═══ */
const SECTIONS = [
  { key: 'contract', label: 'Contract & Billing', fields: ['net_contract_value', 'sales_tax', 'contract_value', 'change_orders', 'adj_contract_value', 'ytd_invoiced', 'pct_billed', 'left_to_bill', 'last_billed', 'billing_method', 'billing_date'] },
  { key: 'precast', label: 'Precast Fence', fields: ['lf_precast', 'height_precast', 'style', 'color', 'contract_rate_precast'] },
  { key: 'wythe', label: 'Single Wythe', fields: ['lf_single_wythe', 'height_single_wythe', 'style_single_wythe', 'contract_rate_single_wythe'] },
  { key: 'iron', label: 'Wrought Iron', fields: ['lf_wrought_iron', 'height_wrought_iron', 'contract_rate_wrought_iron'] },
  { key: 'removal', label: 'Removal', fields: ['lf_removal', 'height_removal', 'removal_material_type', 'contract_rate_removal'] },
  { key: 'other', label: 'Other / Lump Sum', fields: ['lf_other', 'height_other', 'other_material_type', 'contract_rate_other', 'lump_sum_amount', 'lump_sum_description'] },
  { key: 'gates', label: 'Gates', fields: ['number_of_gates', 'gate_height', 'gate_description', 'gate_rate'] },
  { key: 'totals', label: 'Production Totals', fields: ['total_lf', 'average_height_installed', 'total_lf_removed', 'product', 'fence_type'] },
  { key: 'details', label: 'Job Details', fields: ['sales_rep', 'job_type', 'documents_needed', 'file_location', 'address', 'city', 'state', 'zip', 'cust_number'] },
  { key: 'dates', label: 'Dates', fields: ['contract_date', 'contract_month', 'est_start_date', 'start_month', 'contract_age', 'active_entry_date', 'complete_date', 'complete_month'] },
  { key: 'notes', label: 'Notes', fields: ['notes'] },
  { key: 'co', label: 'Change Order Info', fields: ['change_orders', 'contract_value_recalculation', 'contract_value_recalc_diff'] },
];

function EditPanel({ job, onClose, onSaved, isNew }) {
  const [form, setForm] = useState({ ...job });
  const [tab, setTab] = useState(isNew ? 'details' : 'contract');
  const [saving, setSaving] = useState(false);
  const set = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleSave = async () => {
    setSaving(true);
    if (isNew) {
      const { id, created_at, updated_at, ...rest } = form;
      if (!rest.job_name) { setSaving(false); return; }
      if (!rest.status) rest.status = 'contract_review';
      const saved = await post('jobs', rest);
      if (saved && saved[0]) alert_('new_job', saved[0]);
    } else {
      const { id, created_at, updated_at, ...rest } = form;
      await patch('jobs', job.id, rest);
      alert_('job_updated', { id: job.id, ...rest });
    }
    setSaving(false);
    onSaved(isNew ? 'Project created' : null);
  };

  const sec = SECTIONS.find(s => s.key === tab);

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 520, background: '#FFFFFF', borderLeft: '1px solid #E5E3E0', zIndex: 200, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,.1)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E3E0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800 }}>{isNew ? 'New Project' : (form.job_name || 'Untitled')}</div>
          <div style={{ fontSize: 12, color: '#6B6056' }}>{isNew ? 'Fill in project details below' : `#${form.job_number} · ${form.customer_name}`}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={saving} style={{ ...btnP, background: isNew ? '#065F46' : '#8B2020' }}>{saving ? 'Saving...' : isNew ? 'Create Project' : 'Save'}</button>
          <button onClick={onClose} style={btnS}>Close</button>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '10px 20px', borderBottom: '1px solid #E5E3E0', flexShrink: 0 }}>
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setTab(s.key)} style={{ padding: '4px 10px', borderRadius: 6, border: tab === s.key ? '1px solid #8B2020' : '1px solid #E5E3E0', background: tab === s.key ? '#8B202015' : 'transparent', color: tab === s.key ? '#8B2020' : '#6B6056', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{s.label}</button>
        ))}
      </div>
      {/* Fields */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {sec && sec.fields.map(f => {
          const colDef = ALL_COLS.find(c => c.key === f);
          const friendlyLabel = colDef ? colDef.label : f.replace(/_/g, ' ');
          const dd = DROPDOWN_FIELDS[f];
          return (
            <div key={f} style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{friendlyLabel}</label>
              {f === 'notes' ? (
                <textarea value={form[f] || ''} onChange={e => set(f, e.target.value)} rows={6} style={{ ...inputS, resize: 'vertical' }} />
              ) : dd ? (
                <select value={form[f] || ''} onChange={e => set(f, e.target.value)} style={inputS}>
                  <option value="">— Select —</option>
                  {dd.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              ) : (
                <input value={form[f] ?? ''} onChange={e => set(f, e.target.value)} style={inputS} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══ DROPDOWN OPTIONS ═══ */
const OPT_FENCE = ['PC','SW','PC/Gates','PC/Columns','PC/SW','PC/WI','SW/Columns','SW/Gate','SW/WI','WI','WI/Gate','Wood','PC/SW/Columns','SW/Columns/Gates','Slab','LABOR'];
const OPT_STYLE = ['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'];
const OPT_COLOR = ['LAC','Painted','10#61078','Café','Adobe','8#860','Regular Brown','Outback','Silversmoke 8085','Green','Stain','10#860','8#677','3.5#860','1.5#860','Dune 6058','Sandstone 5237','Pebble 641','No Color','Other'];
const OPT_BILLING = ['Progress','Lump Sum','Milestone','T&M'];
const OPT_JOB_TYPE = ['Commercial','Residential','Government','Industrial','Private','Public'];
const DROPDOWN_FIELDS = { status: STATUSES.map(s => ({ v: s, l: S_LABEL[s] })), market: MKTS.map(m => ({ v: m, l: m })), fence_type: OPT_FENCE.map(v => ({ v, l: v })), style: OPT_STYLE.map(v => ({ v, l: v })), style_single_wythe: OPT_STYLE.map(v => ({ v, l: v })), color: OPT_COLOR.map(v => ({ v, l: v })), billing_method: OPT_BILLING.map(v => ({ v, l: v })), job_type: OPT_JOB_TYPE.map(v => ({ v, l: v })) };

/* ═══ JOBS PAGE ═══ */
const ALL_COLS = [
  { key: 'status', label: 'Status', w: 120 },
  { key: 'market', label: 'Location', w: 110 },
  { key: 'job_number', label: 'Job Code', w: 90 },
  { key: 'included_on_billing_schedule', label: 'On Billing Sched', w: 120 },
  { key: 'included_on_lf_schedule', label: 'On LF Sched', w: 100 },
  { key: 'job_name', label: 'Job Name', w: 220 },
  { key: 'customer_name', label: 'Customer', w: 160 },
  { key: 'cust_number', label: 'Cust #', w: 70 },
  { key: 'fence_type', label: 'Fence Type', w: 110 },
  { key: 'documents_needed', label: 'Docs Needed', w: 120 },
  { key: 'file_location', label: 'File Location', w: 120 },
  { key: 'billing_method', label: 'Billing Method', w: 110 },
  { key: 'billing_date', label: 'Billing Date', w: 90 },
  { key: 'sales_rep', label: 'Sales Rep', w: 120 },
  { key: 'job_type', label: 'Job Type', w: 100 },
  { key: 'address', label: 'Address', w: 160 },
  { key: 'city', label: 'City', w: 100 },
  { key: 'state', label: 'State', w: 50 },
  { key: 'zip', label: 'Zip', w: 70 },
  { key: 'lf_precast', label: 'LF - Precast', w: 90 },
  { key: 'height_precast', label: 'Height - Precast', w: 100 },
  { key: 'style', label: 'Style', w: 130 },
  { key: 'color', label: 'Color', w: 110 },
  { key: 'contract_rate_precast', label: 'Contract Rate - Precast', w: 140 },
  { key: 'lf_single_wythe', label: 'LF - Single Wythe', w: 110 },
  { key: 'height_single_wythe', label: 'Height - Single Wythe', w: 120 },
  { key: 'contract_rate_single_wythe', label: 'Contract Rate - SW', w: 130 },
  { key: 'style_single_wythe', label: 'Style - Single Wythe', w: 130 },
  { key: 'lf_wrought_iron', label: 'LF - Wrought Iron', w: 110 },
  { key: 'height_wrought_iron', label: 'Height - Wrought Iron', w: 120 },
  { key: 'contract_rate_wrought_iron', label: 'Contract Rate - WI', w: 130 },
  { key: 'lf_removal', label: 'LF - Removal', w: 100 },
  { key: 'height_removal', label: 'Height - Removal', w: 110 },
  { key: 'removal_material_type', label: 'Removal Material', w: 120 },
  { key: 'contract_rate_removal', label: 'Contract Rate - Removal', w: 140 },
  { key: 'lf_other', label: 'LF - Other', w: 90 },
  { key: 'height_other', label: 'Height - Other', w: 100 },
  { key: 'other_material_type', label: 'Other Material', w: 120 },
  { key: 'contract_rate_other', label: 'Contract Rate - Other', w: 140 },
  { key: 'number_of_gates', label: '# of Gates', w: 80 },
  { key: 'gate_height', label: 'Gate Height', w: 90 },
  { key: 'gate_description', label: 'Gate Description', w: 130 },
  { key: 'gate_rate', label: 'Gate Rate', w: 90 },
  { key: 'lump_sum_amount', label: 'Lump Sum Amount', w: 120 },
  { key: 'lump_sum_description', label: 'Lump Sum Desc', w: 130 },
  { key: 'total_lf', label: 'Total LF', w: 80 },
  { key: 'average_height_installed', label: 'Avg Height Installed', w: 130 },
  { key: 'total_lf_removed', label: 'Total LF Removed', w: 110 },
  { key: 'average_height_removed', label: 'Avg Height Removed', w: 130 },
  { key: 'net_contract_value', label: 'Net Contract Value', w: 120 },
  { key: 'sales_tax', label: 'Sales Tax', w: 80 },
  { key: 'contract_value', label: 'Contract Value', w: 120 },
  { key: 'change_orders', label: 'Change Orders', w: 110 },
  { key: 'adj_contract_value', label: 'Adj Contract Value', w: 130 },
  { key: 'contract_value_recalculation', label: 'Contract Recalc', w: 120 },
  { key: 'contract_value_recalc_diff', label: 'Recalc Diff', w: 100 },
  { key: 'ytd_invoiced', label: 'YTD Invoiced', w: 110 },
  { key: 'pct_billed', label: '% Billed', w: 80 },
  { key: 'left_to_bill', label: 'Left to Bill', w: 110 },
  { key: 'last_billed', label: 'Last Billed', w: 100 },
  { key: 'contract_date', label: 'Contract Date', w: 110 },
  { key: 'contract_month', label: 'Contract Month', w: 110 },
  { key: 'est_start_date', label: 'Est Start Date', w: 110 },
  { key: 'start_month', label: 'Start Month', w: 100 },
  { key: 'contract_age', label: 'Contract Age', w: 90 },
  { key: 'active_entry_date', label: 'Active Entry Date', w: 120 },
  { key: 'complete_date', label: 'Complete Date', w: 110 },
  { key: 'complete_month', label: 'Complete Month', w: 110 },
  { key: 'notes', label: 'Notes', w: 200 },
];

const DEFAULT_VIS = ['status','job_number','job_name','customer_name','market','fence_type','sales_rep','adj_contract_value','left_to_bill','pct_billed','total_lf','contract_date','est_start_date','last_billed','notes'];

function JobsPage({ jobs, onRefresh }) {
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState(null);
  const [mktF, setMktF] = useState(null);
  const [sortCol, setSortCol] = useState('left_to_bill');
  const [sortDir, setSortDir] = useState('desc');
  const [visCols, setVisCols] = useState(() => DEFAULT_VIS);
  const [showCols, setShowCols] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [isNewJob, setIsNewJob] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(null); // { id, key, value }
  const [toast, setToast] = useState(null);

  const toggleCol = k => setVisCols(v => v.includes(k) ? v.filter(x => x !== k) : [...v, k]);
  const toggleSort = k => { if (sortCol === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(k); setSortDir('desc'); } };

  const filtered = useMemo(() => {
    let f = jobs;
    if (search) { const q = search.toLowerCase(); f = f.filter(j => `${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q)); }
    if (statusF) f = f.filter(j => j.status === statusF);
    if (mktF) f = f.filter(j => j.market === mktF);
    return [...f].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'string') return sortDir === 'asc' ? (av || '').localeCompare(bv || '') : (bv || '').localeCompare(av || '');
      return sortDir === 'asc' ? n(av) - n(bv) : n(bv) - n(av);
    });
  }, [jobs, search, statusF, mktF, sortCol, sortDir]);

  const exportCSV = () => {
    const cols = ALL_COLS.filter(c => visCols.includes(c.key));
    const header = cols.map(c => c.label).join(',');
    const rows = filtered.map(j => cols.map(c => { const v = j[c.key]; return typeof v === 'string' && v.includes(',') ? `"${v}"` : (v ?? ''); }).join(','));
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fencecrete-projects.csv'; a.click();
  };

  const openNewJob = () => {
    setEditJob({ job_name: '', job_number: '', customer_name: '', market: '', status: 'contract_review', fence_type: '', product: '', sales_rep: '' });
    setIsNewJob(true);
  };

  const handlePanelSaved = (msg) => {
    setEditJob(null);
    setIsNewJob(false);
    if (msg) setToast(msg);
    onRefresh();
  };

  const startInlineEdit = (j, k) => {
    if (!editMode) return;
    setInlineEdit({ id: j.id, key: k, value: j[k] ?? '' });
  };

  const saveInlineEdit = async () => {
    if (!inlineEdit) return;
    const updates = { [inlineEdit.key]: inlineEdit.value };
    await patch('jobs', inlineEdit.id, updates);
    const job = jobs.find(j => j.id === inlineEdit.id);
    if (['ytd_invoiced', 'last_billed'].includes(inlineEdit.key)) alert_('billing_logged', { ...job, ...updates });
    else alert_('job_updated', { ...job, ...updates });
    setInlineEdit(null);
    setToast('Saved');
    onRefresh();
  };

  const visColDefs = ALL_COLS.filter(c => visCols.includes(c.key));

  const renderCell = (j, k) => {
    // Inline edit active for this cell
    if (inlineEdit && inlineEdit.id === j.id && inlineEdit.key === k) {
      return (
        <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit({ ...inlineEdit, value: e.target.value })}
          onBlur={saveInlineEdit} onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
          onClick={e => e.stopPropagation()}
          style={{ ...inputS, padding: '4px 6px', fontSize: 12, width: '100%' }} />
      );
    }
    const v = j[k];
    if (k === 'status') return <span style={pill(S_COLOR[v] || '#6B6056', S_BG[v] || '#F4F4F2')}>{S_SHORT[v] || v}</span>;
    if (k === 'market') return <span style={pill(M_COLOR[v] || '#6B6056', M_BG[v] || '#F4F4F2')}>{M_SHORT[v] || v || '—'}</span>;
    if (['adj_contract_value', 'contract_value', 'left_to_bill', 'ytd_invoiced', 'net_contract_value'].includes(k)) return <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: k === 'left_to_bill' ? (n(v) > 100000 ? '#991B1B' : n(v) > 50000 ? '#B45309' : '#065F46') : '#E2E8F0' }}>{$(v)}</span>;
    if (k === 'pct_billed') return <span>{n(v)}%</span>;
    if (k === 'total_lf') return <span>{n(v).toLocaleString()}</span>;
    if (['contract_date', 'last_billed', 'est_start_date', 'active_entry_date', 'complete_date'].includes(k)) return fD(v);
    return v || '—';
  };

  return (
    <div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900 }}>Projects</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditMode(!editMode)} style={{ ...btnS, background: editMode ? '#FDF4F4' : '#E5E3E0', color: editMode ? '#8B2020' : '#6B6056', border: editMode ? '1px solid #8B2020' : '1px solid #E5E3E0' }}>
            {editMode ? '✏ Edit Mode' : '👁 View Mode'}
          </button>
          <button onClick={() => setShowCols(!showCols)} style={btnS}>Columns</button>
          <button onClick={openNewJob} style={{ ...btnP, background: '#065F46' }}>+ New Project</button>
          <button onClick={exportCSV} style={btnP}>Export CSV</button>
        </div>
      </div>

      {editMode && <div style={{ background: '#FDF4F4', border: '1px solid #8B202030', borderRadius: 8, padding: '6px 14px', marginBottom: 12, fontSize: 12, color: '#8B2020' }}>✏ Edit Mode — click any cell to edit inline. Press Enter to save, Escape to cancel.</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." style={{ ...inputS, width: 240 }} />
        <select value={statusF || ''} onChange={e => setStatusF(e.target.value || null)} style={{ ...inputS, width: 160 }}>
          <option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{S_LABEL[s]}</option>)}
        </select>
        <select value={mktF || ''} onChange={e => setMktF(e.target.value || null)} style={{ ...inputS, width: 160 }}>
          <option value="">All Markets</option>{MKTS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#6B6056' }}>{filtered.length} projects · {$(filtered.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0))} contract · {$(filtered.reduce((s, j) => s + n(j.left_to_bill), 0))} LTB</span>
      </div>

      {/* Column picker */}
      {showCols && (
        <div style={{ ...card, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALL_COLS.map(c => (
            <button key={c.key} onClick={() => toggleCol(c.key)} style={{ padding: '4px 10px', borderRadius: 6, border: visCols.includes(c.key) ? '1px solid #8B2020' : '1px solid #E5E3E0', background: visCols.includes(c.key) ? '#8B202015' : 'transparent', color: visCols.includes(c.key) ? '#8B2020' : '#6B6056', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{c.label}</button>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#F9F8F6', zIndex: 2 }}>
            <tr>{visColDefs.map(c => (
              <th key={c.key} onClick={() => toggleSort(c.key)} style={{ textAlign: 'left', padding: '10px 10px', borderBottom: '1px solid #E5E3E0', color: '#6B6056', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.5, userSelect: 'none' }}>
                {c.label} {sortCol === c.key && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
            ))}</tr>
          </thead>
          <tbody>{filtered.map(j => (
            <tr key={j.id} onClick={() => { if (!editMode) { setEditJob(j); setIsNewJob(false); } }} style={{ cursor: editMode ? 'default' : 'pointer', borderBottom: '1px solid #F4F4F2' }} onMouseEnter={e => e.currentTarget.style.background = editMode ? '#E5E3E020' : '#FDF9F6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {visColDefs.map(c => (
                <td key={c.key} onClick={(e) => { if (editMode) { e.stopPropagation(); startInlineEdit(j, c.key); } }}
                  style={{ padding: '8px 10px', whiteSpace: 'nowrap', maxWidth: c.w, overflow: 'hidden', textOverflow: 'ellipsis', cursor: editMode ? 'cell' : 'pointer', ...(editMode ? { borderRight: '1px dashed #E5E3E0' } : {}) }}>
                  {renderCell(j, c.key)}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>

      {editJob && <EditPanel job={editJob} isNew={isNewJob} onClose={() => { setEditJob(null); setIsNewJob(false); }} onSaved={handlePanelSaved} />}
    </div>
  );
}

/* ═══ BILLING PAGE ═══ */
function BillingPage({ jobs, onRefresh }) {
  const active = useMemo(() => jobs.filter(j => j.status !== 'complete'), [jobs]);
  const withBal = useMemo(() => [...active].filter(j => n(j.left_to_bill) > 0).sort((a, b) => n(b.left_to_bill) - n(a.left_to_bill)), [active]);
  const ty = active.reduce((s, j) => s + n(j.ytd_invoiced), 0);
  const tl = active.reduce((s, j) => s + n(j.left_to_bill), 0);
  const [editId, setEditId] = useState(null);
  const [editField, setEditField] = useState(null);
  const [editVal, setEditVal] = useState('');

  const startEdit = (j, field) => { setEditId(j.id); setEditField(field); setEditVal(j[field] ?? ''); };
  const saveEdit = async (j) => {
    const updates = {};
    updates[editField] = editVal;
    await patch('jobs', j.id, updates);
    alert_('billing_logged', { ...j, ...updates });
    setEditId(null); setEditField(null);
    onRefresh();
  };

  const ltbColor = v => { const x = n(v); return x > 100000 ? '#991B1B' : x > 50000 ? '#B45309' : '#065F46'; };

  const totals = { contract: withBal.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0), ytd: withBal.reduce((s, j) => s + n(j.ytd_invoiced), 0), ltb: withBal.reduce((s, j) => s + n(j.left_to_bill), 0) };

  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Billing</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPI label="Total YTD Billed" value={$k(ty)} color="#10B981" />
        <KPI label="Total Left to Bill" value={$k(tl)} color="#F59E0B" />
      </div>

      {/* Market progress */}
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Billing by Market</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {MKTS.map(m => {
            const mj = active.filter(j => j.market === m);
            const mc = mj.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0);
            const mb = mj.reduce((s, j) => s + n(j.ytd_invoiced), 0);
            const mp = mc > 0 ? Math.round(mb / mc * 100) : 0;
            return (
              <div key={m}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: M_COLOR[m] }}>{M_SHORT[m]}</span>
                  <span style={{ color: '#6B6056' }}>{mp}% · {$k(mb)} / {$k(mc)}</span>
                </div>
                <PBar pct={mp} color={M_COLOR[m]} h={8} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#F9F8F6', zIndex: 2 }}>
            <tr>{['Job Name', 'Market', 'Status', 'Contract', 'YTD Invoiced', 'Left to Bill', '% Billed', 'Last Billed', 'Billing Date'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #E5E3E0', color: '#6B6056', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {withBal.map(j => (
              <tr key={j.id} style={{ borderBottom: '1px solid #F4F4F2' }}>
                <td style={{ padding: '8px 10px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{j.job_name}</td>
                <td style={{ padding: '8px 10px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td>
                <td style={{ padding: '8px 10px' }}><span style={pill(S_COLOR[j.status] || '#6B6056')}>{S_SHORT[j.status]}</span></td>
                <td style={{ padding: '8px 10px', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}>{$(j.adj_contract_value || j.contract_value)}</td>
                <td style={{ padding: '8px 10px' }} onClick={(e) => { e.stopPropagation(); startEdit(j, 'ytd_invoiced'); }}>
                  {editId === j.id && editField === 'ytd_invoiced' ? (
                    <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => saveEdit(j)} onKeyDown={e => e.key === 'Enter' && saveEdit(j)} style={{ ...inputS, width: 100, padding: '4px 8px' }} />
                  ) : <span style={{ cursor: 'pointer', borderBottom: '1px dashed #E5E3E0' }}>{$(j.ytd_invoiced)}</span>}
                </td>
                <td style={{ padding: '8px 10px', fontFamily: 'Syne', fontWeight: 800, color: ltbColor(j.left_to_bill), fontSize: 13 }}>{$(j.left_to_bill)}</td>
                <td style={{ padding: '8px 10px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PBar pct={n(j.pct_billed)} h={4} color="#8B2020" /><span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{n(j.pct_billed)}%</span></div></td>
                <td style={{ padding: '8px 10px' }} onClick={(e) => { e.stopPropagation(); startEdit(j, 'last_billed'); }}>
                  {editId === j.id && editField === 'last_billed' ? (
                    <input autoFocus type="date" value={editVal || ''} onChange={e => setEditVal(e.target.value)} onBlur={() => saveEdit(j)} onKeyDown={e => e.key === 'Enter' && saveEdit(j)} style={{ ...inputS, width: 130, padding: '4px 8px' }} />
                  ) : <span style={{ cursor: 'pointer', borderBottom: '1px dashed #E5E3E0' }}>{fD(j.last_billed)}</span>}
                </td>
                <td style={{ padding: '8px 10px', color: '#6B6056' }}>{j.billing_date || '—'}</td>
              </tr>
            ))}
            {/* Totals row */}
            <tr style={{ background: '#F9F8F6', fontWeight: 700, borderTop: '2px solid #E5E3E0' }}>
              <td style={{ padding: '10px', fontFamily: 'Syne' }}>TOTALS ({withBal.length})</td>
              <td colSpan={2} /><td style={{ padding: '10px', fontFamily: 'Syne', fontSize: 13 }}>{$(totals.contract)}</td>
              <td style={{ padding: '10px', fontFamily: 'Syne', fontSize: 13 }}>{$(totals.ytd)}</td>
              <td style={{ padding: '10px', fontFamily: 'Syne', fontSize: 13, color: '#B45309' }}>{$(totals.ltb)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══ PRODUCTION PAGE (Kanban) ═══ */
function ProductionPage({ jobs, onRefresh }) {
  const move = async (job, newStatus) => {
    await patch('jobs', job.id, { status: newStatus });
    alert_('job_updated', { ...job, status: newStatus });
    onRefresh();
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Production</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, alignItems: 'flex-start' }}>
        {STATUSES.map(s => {
          const col = jobs.filter(j => j.status === s);
          const colVal = col.reduce((x, j) => x + n(j.adj_contract_value || j.contract_value), 0);
          const colLf = col.reduce((x, j) => x + n(j.total_lf), 0);
          return (
            <div key={s}>
              <div style={{ background: S_COLOR[s] + '15', border: `1px solid ${S_COLOR[s]}30`, borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 14, color: S_COLOR[s] }}>{S_LABEL[s]}</div>
                <div style={{ fontSize: 11, color: '#6B6056', marginTop: 2 }}>{col.length} projects · {$k(colVal)} · {colLf.toLocaleString()} LF</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}>
                {col.map(j => (
                  <div key={j.id} style={{ background: '#F9F8F6', border: '1px solid #E5E3E0', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.job_name}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span>
                      {j.fence_type && <span style={pill('#6B6056')}>{j.fence_type}</span>}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B6056', marginBottom: 8 }}>
                      <span>{n(j.total_lf).toLocaleString()} LF</span>
                      <span style={{ fontFamily: 'Syne', fontWeight: 700, color: '#8B2020' }}>{$(j.adj_contract_value || j.contract_value)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {STATUSES.filter(ns => ns !== s).map(ns => (
                        <button key={ns} onClick={() => move(j, ns)} style={{ flex: 1, padding: '4px 2px', borderRadius: 6, border: `1px solid ${S_COLOR[ns]}30`, background: 'transparent', color: S_COLOR[ns], fontSize: 9, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>→ {S_SHORT[ns]}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══ APP ═══ */
const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '▣' },
  { key: 'jobs', label: 'Projects', icon: '◧' },
  { key: 'billing', label: 'Billing', icon: '$' },
  { key: 'production', label: 'Production', icon: '⚙' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try { const d = await get('jobs', 'select=*&order=created_at.desc'); setJobs(d || []); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: '#1A1A1A', borderRight: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, bottom: 0, zIndex: 50 }}>
        <div style={{ padding: '24px 20px 20px' }}>
          <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 900, color: '#8B2020' }}>FENCECRETE</div>
          <div style={{ fontSize: 10, color: '#9E9B96', letterSpacing: 2, textTransform: 'uppercase' }}>Operations</div>
        </div>
        <nav style={{ flex: 1, padding: '0 8px' }}>
          {NAV.map(n => (
            <button key={n.key} onClick={() => setPage(n.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', marginBottom: 2, borderRadius: 8, border: 'none', background: page === n.key ? '#8B202018' : 'transparent', color: page === n.key ? '#8B2020' : '#9E9B96', fontSize: 14, fontWeight: page === n.key ? 600 : 400, cursor: 'pointer', textAlign: 'left', borderLeft: page === n.key ? '3px solid #8B2020' : '3px solid transparent' }}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid #2A2A2A', fontSize: 11, color: '#6B6056' }}>
          {jobs.length} projects loaded
          <button onClick={fetchJobs} style={{ display: 'block', marginTop: 6, padding: '4px 10px', background: '#2A2A2A', border: 'none', borderRadius: 6, color: '#9E9B96', fontSize: 11, cursor: 'pointer' }}>Refresh</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, marginLeft: 220, padding: '24px 32px' }}>
        {loading ? <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', color: '#9E9B96' }}>Loading...</div> : (
          <>
            {page === 'dashboard' && <Dashboard jobs={jobs} />}
            {page === 'jobs' && <JobsPage jobs={jobs} onRefresh={fetchJobs} />}
            {page === 'billing' && <BillingPage jobs={jobs} onRefresh={fetchJobs} />}
            {page === 'production' && <ProductionPage jobs={jobs} onRefresh={fetchJobs} />}
          </>
        )}
      </div>
    </div>
  );
}
