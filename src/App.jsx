import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';

/* ═══ CONFIG ═══ */
const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const sbGet = async (t, q = '') => { const r = await fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H }); return r.json(); };
const sbPatch = async (t, id, b) => { const r = await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) }); return r.json(); };
const sbPost = async (t, b) => { const r = await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: H, body: JSON.stringify(b) }); return r.json(); };

const fireAlert = (type, job) => { try { fetch(`${SB}/functions/v1/send-alert`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ type, job }) }); } catch(e) {} };
const logActivity = (job, action, fieldName, oldVal, newVal) => { try { sbPost('activity_log', { job_id: job.id, job_number: job.job_number, job_name: job.job_name, action, field_name: fieldName, old_value: String(oldVal || ''), new_value: String(newVal || ''), changed_by: 'desktop' }); } catch(e) {} };

/* ═══ HELPERS ═══ */
const $ = v => { const x = Number(v) || 0; return '$' + x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
const $k = v => { const x = Number(v) || 0; return x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(0) + 'K' : '$' + x; };
const n = v => Number(v) || 0;
const fD = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const relTime = d => { if (!d) return '—'; const ms = Date.now() - new Date(d).getTime(); const m = ms / 60000; if (m < 60) return `${Math.floor(m)}m ago`; const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`; const dy = h / 24; if (dy < 2) return 'Yesterday'; if (dy < 7) return `${Math.floor(dy)}d ago`; return fD(d); };

const STATUSES = ['contract_review', 'production_queue', 'in_production', 'complete'];
const S_LABEL = { contract_review: 'Contract Review', production_queue: 'Production Queue', in_production: 'In Production', complete: 'Complete' };
const S_COLOR = { contract_review: '#B45309', production_queue: '#1D4ED8', in_production: '#6D28D9', complete: '#065F46' };
const S_BG = { contract_review: '#FEF3C7', production_queue: '#DBEAFE', in_production: '#EDE9FE', complete: '#D1FAE5' };
const S_SHORT = { contract_review: 'Review', production_queue: 'Prod Queue', in_production: 'In Prod', complete: 'Complete' };
const MKTS = ['Austin', 'Dallas-Fort Worth', 'Houston', 'San Antonio'];
const M_COLOR = { Austin: '#C2410C', 'Dallas-Fort Worth': '#1D4ED8', Houston: '#065F46', 'San Antonio': '#9D174D' };
const M_BG = { Austin: '#FED7AA', 'Dallas-Fort Worth': '#DBEAFE', Houston: '#D1FAE5', 'San Antonio': '#FCE7F3' };
const M_SHORT = { Austin: 'Austin', 'Dallas-Fort Worth': 'DFW', Houston: 'Houston', 'San Antonio': 'SA' };
const REPS = ['Matt', 'Laura', 'Yuda', 'Nathan', 'Ryne'];
const OPT_FENCE = ['PC','SW','PC/Gates','PC/Columns','PC/SW','PC/WI','SW/Columns','SW/Gate','SW/WI','WI','WI/Gate','Wood','PC/SW/Columns','SW/Columns/Gates','Slab','LABOR'];
const OPT_STYLE = ['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'];
const OPT_COLOR = ['LAC','Painted','10#61078','Café','Adobe','8#860','Regular Brown','Outback','Silversmoke 8085','Green','Stain','10#860','8#677','3.5#860','1.5#860','Dune 6058','Sandstone 5237','Pebble 641','No Color','Other'];
const DD = { status: STATUSES.map(s => ({ v: s, l: S_LABEL[s] })), market: MKTS.map(m => ({ v: m, l: m })), fence_type: OPT_FENCE.map(v => ({ v, l: v })), style: OPT_STYLE.map(v => ({ v, l: v })), style_single_wythe: OPT_STYLE.map(v => ({ v, l: v })), color: OPT_COLOR.map(v => ({ v, l: v })), billing_method: ['Progress','Lump Sum','Milestone','T&M'].map(v => ({ v, l: v })), job_type: ['Commercial','Residential','Government','Industrial','Private','Public'].map(v => ({ v, l: v })) };

/* ═══ STYLES ═══ */
const card = { background: '#FFFFFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const inputS = { width: '100%', padding: '8px 12px', background: '#FFFFFF', border: '1px solid #D1CEC9', borderRadius: 8, color: '#1A1A1A', fontSize: 13 };
const btnP = { padding: '8px 16px', background: '#8B2020', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
const btnS = { ...btnP, background: '#F4F4F2', color: '#6B6056', border: '1px solid #E5E3E0' };
const pill = (c, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: bg || (c + '18'), color: c });
const gpill = (active) => ({ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: active ? '1px solid #8B2020' : '1px solid #E5E3E0', background: active ? '#FDF4F4' : '#FFFFFF', color: active ? '#8B2020' : '#6B6056' });
const fpill = (active) => ({ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: active ? '1px solid #8B2020' : '1px solid #E5E3E0', background: active ? '#FDF4F4' : '#FFFFFF', color: active ? '#8B2020' : '#9E9B96' });

/* ═══ SHARED COMPONENTS ═══ */
function Toast({ message, onDone }) { useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [onDone]); return <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', background: '#8B2020', color: '#fff', padding: '8px 20px', borderRadius: 20, fontSize: 13, fontWeight: 600, zIndex: 9999 }}>{message}</div>; }
function KPI({ label, value, color = '#8B2020' }) { return <div style={card}><div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800, color }}>{value}</div><div style={{ fontSize: 12, color: '#6B6056', marginTop: 4 }}>{label}</div></div>; }
function PBar({ pct: p, color = '#8B2020', h = 6 }) { return <div style={{ height: h, background: '#E5E3E0', borderRadius: h, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(Math.max(p, 0), 100)}%`, background: color, borderRadius: h, transition: 'width .3s' }} /></div>; }

/* ═══ COLUMNS ═══ */
const ALL_COLS = [
  { key: 'status', label: 'Status', w: 130 }, { key: 'market', label: 'Location', w: 110 }, { key: 'job_number', label: 'Project Code', w: 100 },
  { key: 'included_on_billing_schedule', label: 'Billing Sched.', w: 100 }, { key: 'included_on_lf_schedule', label: 'LF Sched.', w: 90 },
  { key: 'job_name', label: 'Project Name', w: 220 }, { key: 'customer_name', label: 'Customer', w: 180 }, { key: 'cust_number', label: 'Cust #', w: 80 },
  { key: 'fence_type', label: 'Fence Type', w: 100 }, { key: 'documents_needed', label: 'Docs Needed', w: 140 }, { key: 'file_location', label: 'File Location', w: 110 },
  { key: 'billing_method', label: 'Billing Method', w: 110 }, { key: 'billing_date', label: 'Billing Date', w: 90 }, { key: 'sales_rep', label: 'Sales Rep', w: 80 },
  { key: 'job_type', label: 'Type', w: 80 }, { key: 'address', label: 'Address', w: 180 }, { key: 'city', label: 'City', w: 100 }, { key: 'state', label: 'State', w: 60 }, { key: 'zip', label: 'ZIP', w: 70 },
  { key: 'lf_precast', label: 'LF - Precast', w: 90 }, { key: 'height_precast', label: 'Height - Precast', w: 110 }, { key: 'style', label: 'Style - Precast', w: 140 }, { key: 'color', label: 'Color - Precast', w: 120 }, { key: 'contract_rate_precast', label: 'Rate - Precast', w: 110 },
  { key: 'lf_single_wythe', label: 'LF - Single Wythe', w: 120 }, { key: 'height_single_wythe', label: 'Height - SW', w: 90 }, { key: 'contract_rate_single_wythe', label: 'Rate - SW', w: 90 }, { key: 'style_single_wythe', label: 'Style - SW', w: 110 },
  { key: 'lf_wrought_iron', label: 'LF - Wrought Iron', w: 120 }, { key: 'height_wrought_iron', label: 'Height - WI', w: 90 }, { key: 'contract_rate_wrought_iron', label: 'Rate - WI', w: 90 },
  { key: 'lf_removal', label: 'LF - Removal', w: 100 }, { key: 'height_removal', label: 'Height - Removal', w: 110 }, { key: 'removal_material_type', label: 'Removal Material', w: 130 }, { key: 'contract_rate_removal', label: 'Rate - Removal', w: 110 },
  { key: 'lf_other', label: 'LF - Other', w: 90 }, { key: 'height_other', label: 'Height - Other', w: 100 }, { key: 'other_material_type', label: 'Other Material', w: 120 }, { key: 'contract_rate_other', label: 'Rate - Other', w: 100 },
  { key: 'number_of_gates', label: '# Gates', w: 70 }, { key: 'gate_height', label: 'Gate Height', w: 90 }, { key: 'gate_description', label: 'Gate Description', w: 140 }, { key: 'gate_rate', label: 'Gate Rate', w: 90 },
  { key: 'lump_sum_amount', label: 'Lump Sum Amt', w: 110 }, { key: 'lump_sum_description', label: 'Lump Sum Desc', w: 150 },
  { key: 'total_lf', label: 'Total LF Installed', w: 130 }, { key: 'average_height_installed', label: 'Avg Height Installed', w: 140 }, { key: 'total_lf_removed', label: 'Total LF Removed', w: 130 }, { key: 'average_height_removed', label: 'Avg Height Removed', w: 140 },
  { key: 'net_contract_value', label: 'Net Contract Value', w: 140 }, { key: 'sales_tax', label: 'Sales Tax', w: 90 }, { key: 'contract_value', label: 'Contract Value', w: 120 }, { key: 'change_orders', label: 'Change Orders', w: 120 },
  { key: 'adj_contract_value', label: 'Adj. Contract Value', w: 140 }, { key: 'contract_value_recalculation', label: 'CV Recalc', w: 100 }, { key: 'contract_value_recalc_diff', label: 'CV Recalc Diff', w: 110 },
  { key: 'ytd_invoiced', label: 'YTD Invoiced', w: 110 }, { key: 'pct_billed', label: '% Billed', w: 80 }, { key: 'left_to_bill', label: 'Left to Bill', w: 110 }, { key: 'last_billed', label: 'Last Billed', w: 100 },
  { key: 'contract_date', label: 'Contract Date', w: 110 }, { key: 'contract_month', label: 'Contract Month', w: 120 }, { key: 'est_start_date', label: 'Est. Start Date', w: 120 }, { key: 'start_month', label: 'Start Month', w: 100 },
  { key: 'contract_age', label: 'Contract Age', w: 100 }, { key: 'active_entry_date', label: 'Active Entry Date', w: 130 }, { key: 'complete_date', label: 'Complete Date', w: 110 }, { key: 'complete_month', label: 'Complete Month', w: 120 },
  { key: 'notes', label: 'Notes', w: 220 },
];
const DEF_VIS = ['status','market','job_number','job_name','customer_name','fence_type','sales_rep','adj_contract_value','left_to_bill','pct_billed','total_lf','contract_date','est_start_date','last_billed','notes'];

const SECTIONS = [
  { key: 'contract', label: 'Contract & Billing', fields: ['net_contract_value','sales_tax','contract_value','change_orders','adj_contract_value','ytd_invoiced','last_billed','billing_method','billing_date'], computed: ['pct_billed','left_to_bill'] },
  { key: 'precast', label: 'Precast Fence', fields: ['lf_precast','height_precast','style','color','contract_rate_precast'] },
  { key: 'wythe', label: 'Single Wythe', fields: ['lf_single_wythe','height_single_wythe','style_single_wythe','contract_rate_single_wythe'] },
  { key: 'iron', label: 'Wrought Iron', fields: ['lf_wrought_iron','height_wrought_iron','contract_rate_wrought_iron'] },
  { key: 'removal', label: 'Removal', fields: ['lf_removal','height_removal','removal_material_type','contract_rate_removal'] },
  { key: 'other', label: 'Other / Lump Sum', fields: ['lf_other','height_other','other_material_type','contract_rate_other','lump_sum_amount','lump_sum_description'] },
  { key: 'gates', label: 'Gates', fields: ['number_of_gates','gate_height','gate_description','gate_rate'] },
  { key: 'totals', label: 'Production Totals', fields: ['total_lf','average_height_installed','total_lf_removed','product','fence_type'] },
  { key: 'details', label: 'Project Details', fields: ['sales_rep','job_type','documents_needed','file_location','address','city','state','zip','cust_number'] },
  { key: 'dates', label: 'Dates', fields: ['contract_date','contract_month','est_start_date','start_month','contract_age','active_entry_date','complete_date','complete_month'] },
  { key: 'notes', label: 'Notes', fields: ['notes'] },
  { key: 'co', label: 'Change Orders', fields: ['change_orders','contract_value_recalculation','contract_value_recalc_diff'] },
  { key: 'history', label: 'History', fields: [] },
];

/* ═══ ACTIVITY HISTORY ═══ */
const ACT_COLORS = { status_change: '#1D4ED8', billing_update: '#065F46', note_update: '#B45309', field_update: '#6B6056', job_created: '#8B2020' };
function ActivityHistory({ jobId }) {
  const [logs, setLogs] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => { sbGet('activity_log', `job_id=eq.${jobId}&order=created_at.desc&limit=50`).then(d => { setLogs(d || []); setLoading(false); }); }, [jobId]);
  if (loading) return <div style={{ padding: 20, color: '#9E9B96' }}>Loading history...</div>;
  if (logs.length === 0) return <div style={{ padding: 20, color: '#9E9B96' }}>No activity recorded yet for this project</div>;
  return <div style={{ padding: '4px 0' }}>{logs.map(l => (
    <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #E5E3E0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ ...pill(ACT_COLORS[l.action] || '#6B6056', (ACT_COLORS[l.action] || '#6B6056') + '18'), fontSize: 10, whiteSpace: 'nowrap', marginTop: 2 }}>{(l.action || '').replace(/_/g, ' ')}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#1A1A1A' }}>{l.field_name === 'status' ? `Status: ${l.old_value} → ${l.new_value}` : l.field_name === 'notes' ? 'Notes updated' : l.field_name === 'ytd_invoiced' ? `YTD Invoiced: ${l.old_value} → ${l.new_value}` : l.action === 'job_created' ? `Project created: ${l.new_value}` : `${l.field_name}: updated`}</div>
        <div style={{ fontSize: 10, color: '#9E9B96' }} title={new Date(l.created_at).toLocaleString()}>{relTime(l.created_at)} · {l.changed_by}</div>
      </div>
    </div>
  ))}</div>;
}

/* ═══ EDIT PANEL ═══ */
function EditPanel({ job, onClose, onSaved, isNew }) {
  const [form, setForm] = useState({ ...job }); const [tab, setTab] = useState(isNew ? 'details' : 'contract'); const [saving, setSaving] = useState(false);
  const set = (f, v) => setForm(p => ({ ...p, [f]: v }));
  const handleSave = async () => {
    setSaving(true);
    if (isNew) {
      const { id, created_at, updated_at, ...rest } = form; if (!rest.job_name) { setSaving(false); return; } if (!rest.status) rest.status = 'contract_review';
      const saved = await sbPost('jobs', rest);
      if (saved && saved[0]) { fireAlert('new_job', saved[0]); logActivity(saved[0], 'job_created', '', '', saved[0].job_number); }
    } else {
      const { id, created_at, updated_at, ...rest } = form;
      await sbPatch('jobs', job.id, rest); fireAlert('job_updated', { id: job.id, ...rest }); logActivity(job, 'field_update', 'multiple_fields', '', 'saved');
    }
    setSaving(false); onSaved(isNew ? 'Project created' : 'Project saved');
  };
  const sec = SECTIONS.find(s => s.key === tab);
  const adjCV = n(form.adj_contract_value || form.contract_value);
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 540, background: '#FFFFFF', borderLeft: '1px solid #E5E3E0', zIndex: 200, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,.1)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E3E0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#F9F8F6' }}>
        <div><div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800 }}>{isNew ? 'New Project' : (form.job_name || 'Untitled')}</div><div style={{ fontSize: 12, color: '#6B6056' }}>{isNew ? 'Fill in project details' : `#${form.job_number} · ${form.customer_name}`}</div></div>
        <div style={{ display: 'flex', gap: 8 }}><button onClick={handleSave} disabled={saving} style={{ ...btnP, background: isNew ? '#065F46' : '#8B2020' }}>{saving ? 'Saving...' : isNew ? 'Create' : 'Save'}</button><button onClick={onClose} style={btnS}>Close</button></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '10px 20px', borderBottom: '1px solid #E5E3E0', flexShrink: 0 }}>
        {SECTIONS.map(s => <button key={s.key} onClick={() => setTab(s.key)} style={{ padding: '4px 10px', borderRadius: 6, border: tab === s.key ? '1px solid #8B2020' : '1px solid #E5E3E0', background: tab === s.key ? '#FDF4F4' : 'transparent', color: tab === s.key ? '#8B2020' : '#6B6056', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{s.label}</button>)}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'history' ? <ActivityHistory jobId={job?.id} /> : <>
          {sec && sec.fields.map(f => { const cd = ALL_COLS.find(c => c.key === f); const lbl = cd ? cd.label : f.replace(/_/g, ' '); const dd = DD[f]; return (
            <div key={f} style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lbl}</label>
              {f === 'notes' ? <textarea value={form[f] || ''} onChange={e => set(f, e.target.value)} rows={6} style={{ ...inputS, resize: 'vertical' }} />
              : dd ? <select value={form[f] || ''} onChange={e => set(f, e.target.value)} style={inputS}><option value="">— Select —</option>{dd.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
              : <input value={form[f] ?? ''} onChange={e => set(f, e.target.value)} style={inputS} />}
            </div>); })}
          {sec && sec.computed && <div style={{ marginTop: 16, padding: 14, background: '#F9F8F6', borderRadius: 8, border: '1px solid #E5E3E0' }}>
            <div style={{ fontSize: 10, color: '#9E9B96', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Auto-calculated</div>
            {sec.computed.map(f => { const cd = ALL_COLS.find(c => c.key === f); const val = f === 'pct_billed' ? `${adjCV > 0 ? Math.round(n(form.ytd_invoiced) / adjCV * 1000) / 10 : 0}%` : f === 'left_to_bill' ? $(adjCV - n(form.ytd_invoiced)) : (form[f] ?? '—'); return (
              <div key={f} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #E5E3E0' }}>
                <span style={{ fontSize: 12, color: '#6B6056' }}>{cd ? cd.label : f}</span>
                <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#1A1A1A' }}>{val}</span>
              </div>); })}
          </div>}
        </>}
      </div>
    </div>
  );
}

/* ═══ CELL RENDERER ═══ */
function renderCell(j, k) {
  const v = j[k];
  if (k === 'status') return <span style={pill(S_COLOR[v] || '#6B6056', S_BG[v] || '#F4F4F2')}>{S_SHORT[v] || v}</span>;
  if (k === 'market') return <span style={pill(M_COLOR[v] || '#6B6056', M_BG[v] || '#F4F4F2')}>{M_SHORT[v] || v || '—'}</span>;
  if (['adj_contract_value','contract_value','left_to_bill','ytd_invoiced','net_contract_value'].includes(k)) return <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: k === 'left_to_bill' ? (n(v) > 100000 ? '#991B1B' : n(v) > 50000 ? '#B45309' : '#065F46') : '#1A1A1A' }}>{$(v)}</span>;
  if (k === 'pct_billed') return <span>{n(v)}%</span>;
  if (k === 'total_lf') return <span>{n(v).toLocaleString()}</span>;
  if (['contract_date','last_billed','est_start_date','active_entry_date','complete_date'].includes(k)) return fD(v);
  return v || '—';
}

/* ═══ DASHBOARD ═══ */
function Dashboard({ jobs }) {
  const active = useMemo(() => jobs.filter(j => j.status !== 'complete'), [jobs]);
  const tc = active.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0);
  const tl = active.reduce((s, j) => s + n(j.left_to_bill), 0);
  const ty = active.reduce((s, j) => s + n(j.ytd_invoiced), 0);
  const tlf = active.reduce((s, j) => s + n(j.total_lf), 0);
  const mktData = MKTS.map(m => { const mj = active.filter(j => j.market === m); return { name: M_SHORT[m], value: mj.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0), fill: M_COLOR[m], ltb: mj.reduce((s, j) => s + n(j.left_to_bill), 0), count: mj.length }; });
  const alerts = active.filter(j => n(j.contract_age) > 30 && n(j.ytd_invoiced) === 0).sort((a, b) => n(b.contract_age) - n(a.contract_age));
  const top15 = [...active].sort((a, b) => n(b.left_to_bill) - n(a.left_to_bill)).slice(0, 15);
  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <KPI label="Total Contract Value" value={$k(tc)} /><KPI label="Left to Bill" value={$k(tl)} color="#B45309" /><KPI label="YTD Billed" value={$k(ty)} color="#065F46" /><KPI label="Active LF" value={tlf.toLocaleString()} color="#1D4ED8" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Contract Value by Market</div>
          <ResponsiveContainer width="100%" height={220}><BarChart data={mktData} barSize={40}><XAxis dataKey="name" tick={{ fill: '#6B6056', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#6B6056', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v / 1e6).toFixed(1) + 'M'} /><Tooltip formatter={v => $(v)} contentStyle={{ background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 8 }} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{mktData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar></BarChart></ResponsiveContainer>
        </div>
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Pipeline by Status</div>
          {STATUSES.filter(s => s !== 'complete').map(s => { const sj = active.filter(j => j.status === s); const sv = sj.reduce((x, j) => x + n(j.adj_contract_value || j.contract_value), 0); const sl = sj.reduce((x, j) => x + n(j.left_to_bill), 0); return (
            <div key={s} style={{ marginBottom: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span><span style={pill(S_COLOR[s], S_BG[s])}>{S_SHORT[s]}</span> <span style={{ color: '#6B6056', marginLeft: 6 }}>{sj.length} projects</span></span><span style={{ color: '#9E9B96' }}>{$k(sv)} · LTB {$k(sl)}</span></div><PBar pct={tc > 0 ? sv / tc * 100 : 0} color={S_COLOR[s]} /></div>); })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Top 15 Left to Bill</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr style={{ borderBottom: '1px solid #E5E3E0', fontSize: 11, color: '#6B6056' }}><th style={{ textAlign: 'left', padding: '6px 8px' }}>Project</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Market</th><th style={{ textAlign: 'right', padding: '6px 8px' }}>LTB</th><th style={{ textAlign: 'right', padding: '6px 8px' }}>%</th></tr></thead><tbody>{top15.map(j => (
            <tr key={j.id} style={{ borderBottom: '1px solid #F4F4F2' }}><td style={{ padding: '5px 8px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name}</td><td style={{ padding: '5px 8px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td><td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'Syne', fontWeight: 700, color: '#8B2020', fontSize: 13 }}>{$(j.left_to_bill)}</td><td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 12, color: '#6B6056' }}>{n(j.pct_billed)}%</td></tr>))}</tbody></table>
        </div>
        <div style={{ ...card, borderColor: alerts.length > 0 ? '#B4530930' : '#E5E3E0' }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12, color: '#B45309' }}>Billing Alerts ({alerts.length})</div>
          {alerts.length === 0 && <div style={{ color: '#9E9B96', padding: 20, textAlign: 'center' }}>No alerts</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{alerts.slice(0, 15).map(j => (
            <tr key={j.id} style={{ borderBottom: '1px solid #F4F4F2' }}><td style={{ padding: '5px 8px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name}</td><td style={{ padding: '5px 8px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td><td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}>{$(j.contract_value)}</td><td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 12, color: '#B45309' }}>{j.contract_age}d</td></tr>))}</tbody></table>
        </div>
      </div>
    </div>
  );
}

/* ═══ PROJECTS PAGE ═══ */
function ProjectsPage({ jobs, onRefresh }) {
  const [search, setSearch] = useState(''); const [statusF, setStatusF] = useState(null); const [mktF, setMktF] = useState(null);
  const [sortCol, setSortCol] = useState('left_to_bill'); const [sortDir, setSortDir] = useState('desc');
  const [visCols, setVisCols] = useState(() => DEF_VIS); const [showCols, setShowCols] = useState(false);
  const [editJob, setEditJob] = useState(null); const [isNewJob, setIsNewJob] = useState(false);
  const [editMode, setEditMode] = useState(false); const [inlineEdit, setInlineEdit] = useState(null);
  const [selected, setSelected] = useState(new Set()); const [toast, setToast] = useState(null);

  const toggleCol = k => setVisCols(v => v.includes(k) ? v.filter(x => x !== k) : [...v, k]);
  const toggleSort = k => { if (sortCol === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(k); setSortDir('desc'); } };

  const filtered = useMemo(() => {
    let f = jobs;
    if (search) { const q = search.toLowerCase(); f = f.filter(j => `${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q)); }
    if (statusF) f = f.filter(j => j.status === statusF); if (mktF) f = f.filter(j => j.market === mktF);
    return [...f].sort((a, b) => { let av = a[sortCol], bv = b[sortCol]; if (typeof av === 'string') return sortDir === 'asc' ? (av || '').localeCompare(bv || '') : (bv || '').localeCompare(av || ''); return sortDir === 'asc' ? n(av) - n(bv) : n(bv) - n(av); });
  }, [jobs, search, statusF, mktF, sortCol, sortDir]);

  useEffect(() => setSelected(new Set()), [search, statusF, mktF]);

  const exportCSV = (rows) => { const cols = ALL_COLS.filter(c => visCols.includes(c.key)); const h = cols.map(c => c.label).join(','); const r = rows.map(j => cols.map(c => { const v = j[c.key]; return typeof v === 'string' && v.includes(',') ? `"${v}"` : (v ?? ''); }).join(',')); const b = new Blob([h + '\n' + r.join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'fencecrete-projects.csv'; a.click(); };

  const saveInlineEdit = async () => { if (!inlineEdit) return; const u = { [inlineEdit.key]: inlineEdit.value }; if (inlineEdit.key === 'ytd_invoiced') { const adj = n(inlineEdit.job.adj_contract_value || inlineEdit.job.contract_value); const ytd = n(inlineEdit.value); u.pct_billed = adj > 0 ? Math.round(ytd / adj * 10000) / 100 : 0; u.left_to_bill = adj - ytd; } await sbPatch('jobs', inlineEdit.id, u); const j = jobs.find(x => x.id === inlineEdit.id); if (['ytd_invoiced','last_billed'].includes(inlineEdit.key)) { fireAlert('billing_logged', { ...j, ...u }); logActivity(j, 'billing_update', inlineEdit.key, j[inlineEdit.key], inlineEdit.value); } else { fireAlert('job_updated', { ...j, ...u }); logActivity(j, 'field_update', inlineEdit.key, j[inlineEdit.key], inlineEdit.value); } setInlineEdit(null); setToast('Saved'); onRefresh(); };

  const bulkStatus = async (s) => { for (const id of selected) { const j = jobs.find(x => x.id === id); if (j) { await sbPatch('jobs', id, { status: s }); fireAlert('job_updated', { ...j, status: s }); logActivity(j, 'status_change', 'status', j.status, s); } } setSelected(new Set()); setToast(`Updated ${selected.size} projects`); onRefresh(); };
  const bulkRep = async (rep) => { for (const id of selected) { const j = jobs.find(x => x.id === id); if (j) { await sbPatch('jobs', id, { sales_rep: rep }); logActivity(j, 'field_update', 'sales_rep', j.sales_rep, rep); } } setSelected(new Set()); setToast(`Assigned ${selected.size} projects to ${rep}`); onRefresh(); };

  const toggleAll = () => { if (selected.size === filtered.length) setSelected(new Set()); else setSelected(new Set(filtered.map(j => j.id))); };
  const toggleOne = (id) => { const s = new Set(selected); if (s.has(id)) s.delete(id); else s.add(id); setSelected(s); };

  const visColDefs = ALL_COLS.filter(c => visCols.includes(c.key));

  return (
    <div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900 }}>Projects</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditMode(!editMode)} style={{ ...btnS, background: editMode ? '#FDF4F4' : '#F4F4F2', color: editMode ? '#8B2020' : '#6B6056', border: editMode ? '1px solid #8B2020' : '1px solid #E5E3E0' }}>{editMode ? '✏ Edit' : '👁 View'}</button>
          <button onClick={() => setShowCols(!showCols)} style={btnS}>Columns</button>
          <button onClick={() => { setEditJob({ job_name: '', job_number: '', customer_name: '', market: '', status: 'contract_review' }); setIsNewJob(true); }} style={{ ...btnP, background: '#065F46' }}>+ New Project</button>
          <button onClick={() => exportCSV(filtered)} style={btnP}>Export CSV</button>
        </div>
      </div>
      {editMode && <div style={{ background: '#FDF4F4', border: '1px solid #8B202030', borderRadius: 8, padding: '6px 14px', marginBottom: 12, fontSize: 12, color: '#8B2020' }}>✏ Edit Mode — click any cell to edit inline. Enter to save, Escape to cancel.</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." style={{ ...inputS, width: 240 }} />
        <select value={statusF || ''} onChange={e => setStatusF(e.target.value || null)} style={{ ...inputS, width: 160 }}><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{S_LABEL[s]}</option>)}</select>
        <select value={mktF || ''} onChange={e => setMktF(e.target.value || null)} style={{ ...inputS, width: 160 }}><option value="">All Markets</option>{MKTS.map(m => <option key={m} value={m}>{m}</option>)}</select>
        <span style={{ fontSize: 12, color: '#6B6056' }}>{filtered.length} projects · {$(filtered.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0))} · {$(filtered.reduce((s, j) => s + n(j.left_to_bill), 0))} LTB</span>
      </div>
      {showCols && <div style={{ ...card, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{ALL_COLS.map(c => <button key={c.key} onClick={() => toggleCol(c.key)} style={gpill(visCols.includes(c.key))}>{c.label}</button>)}</div>}

      {/* Bulk action bar */}
      {selected.size > 0 && <div style={{ background: '#1A1A1A', borderRadius: 8, padding: '8px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, color: '#fff', fontSize: 13 }}>
        <span style={{ fontWeight: 700 }}>{selected.size} selected</span>
        <select onChange={e => { if (e.target.value) bulkStatus(e.target.value); e.target.value = ''; }} style={{ ...inputS, width: 160, background: '#2A2A2A', color: '#fff', border: '1px solid #444' }}><option value="">Change Status...</option>{STATUSES.map(s => <option key={s} value={s}>{S_LABEL[s]}</option>)}</select>
        <select onChange={e => { if (e.target.value) bulkRep(e.target.value); e.target.value = ''; }} style={{ ...inputS, width: 140, background: '#2A2A2A', color: '#fff', border: '1px solid #444' }}><option value="">Assign Rep...</option>{REPS.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <button onClick={() => exportCSV(filtered.filter(j => selected.has(j.id)))} style={{ ...btnP, padding: '4px 12px', fontSize: 12 }}>Export</button>
        <button onClick={() => setSelected(new Set())} style={{ ...btnS, padding: '4px 12px', fontSize: 12, color: '#fff', background: 'transparent', border: '1px solid #444' }}>Clear</button>
      </div>}

      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#F9F8F6', zIndex: 2 }}>
            <tr>
              <th style={{ width: 40, padding: '10px 8px', borderBottom: '1px solid #E5E3E0' }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></th>
              {visColDefs.map(c => <th key={c.key} onClick={() => toggleSort(c.key)} style={{ textAlign: 'left', padding: '10px 10px', borderBottom: '1px solid #E5E3E0', color: '#6B6056', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.5, userSelect: 'none' }}>{c.label} {sortCol === c.key && (sortDir === 'asc' ? '↑' : '↓')}</th>)}
            </tr>
          </thead>
          <tbody>{filtered.map((j, i) => (
            <tr key={j.id} onClick={() => { if (!editMode && !selected.size) { setEditJob(j); setIsNewJob(false); } }} style={{ cursor: editMode ? 'default' : 'pointer', background: i % 2 === 0 ? '#FFFFFF' : '#FAFAF8' }} onMouseEnter={e => { e.currentTarget.style.background = '#FDF9F6'; }} onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? '#FFFFFF' : '#FAFAF8'; }}>
              <td style={{ width: 40, padding: '8px 8px' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(j.id)} onChange={() => toggleOne(j.id)} /></td>
              {visColDefs.map(c => <td key={c.key} onClick={e => { if (editMode) { e.stopPropagation(); setInlineEdit({ id: j.id, key: c.key, value: j[c.key] ?? '', job: j }); } }} style={{ padding: '8px 10px', whiteSpace: 'nowrap', maxWidth: c.w, overflow: 'hidden', textOverflow: 'ellipsis', cursor: editMode ? 'cell' : 'pointer', ...(editMode ? { borderRight: '1px dashed #E5E3E0' } : {}) }}>
                {inlineEdit && inlineEdit.id === j.id && inlineEdit.key === c.key ? <input autoFocus value={inlineEdit.value} onChange={e => setInlineEdit({ ...inlineEdit, value: e.target.value })} onBlur={saveInlineEdit} onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }} onClick={e => e.stopPropagation()} style={{ ...inputS, padding: '4px 6px', fontSize: 12, width: '100%' }} /> : renderCell(j, c.key)}
              </td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {editJob && <EditPanel job={editJob} isNew={isNewJob} onClose={() => { setEditJob(null); setIsNewJob(false); }} onSaved={(msg) => { setEditJob(null); setIsNewJob(false); if (msg) setToast(msg); onRefresh(); }} />}
    </div>
  );
}

/* ═══ BILLING PAGE ═══ */
function BillingPage({ jobs, onRefresh }) {
  const active = useMemo(() => jobs.filter(j => j.status !== 'complete'), [jobs]);
  const withBal = useMemo(() => [...active].filter(j => n(j.left_to_bill) > 0).sort((a, b) => n(b.left_to_bill) - n(a.left_to_bill)), [active]);
  const ty = active.reduce((s, j) => s + n(j.ytd_invoiced), 0); const tl = active.reduce((s, j) => s + n(j.left_to_bill), 0);
  const [editId, setEditId] = useState(null); const [editField, setEditField] = useState(null); const [editVal, setEditVal] = useState('');
  const startEdit = (j, f) => { setEditId(j.id); setEditField(f); setEditVal(j[f] ?? ''); };
  const saveEdit = async (j) => { const u = { [editField]: editVal }; if (editField === 'ytd_invoiced') { const adj = n(j.adj_contract_value || j.contract_value); const ytd = n(editVal); u.pct_billed = adj > 0 ? Math.round(ytd / adj * 10000) / 100 : 0; u.left_to_bill = adj - ytd; } await sbPatch('jobs', j.id, u); fireAlert('billing_logged', { ...j, ...u }); logActivity(j, 'billing_update', editField, j[editField], editVal); setEditId(null); setEditField(null); onRefresh(); };
  const totals = { c: withBal.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0), y: withBal.reduce((s, j) => s + n(j.ytd_invoiced), 0), l: withBal.reduce((s, j) => s + n(j.left_to_bill), 0) };
  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Billing</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}><KPI label="Total YTD Billed" value={$k(ty)} color="#065F46" /><KPI label="Total Left to Bill" value={$k(tl)} color="#B45309" /></div>
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: 12 }}>Billing by Market</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>{MKTS.map(m => { const mj = active.filter(j => j.market === m); const mc = mj.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0); const mb = mj.reduce((s, j) => s + n(j.ytd_invoiced), 0); const mp = mc > 0 ? Math.round(mb / mc * 100) : 0; return (<div key={m}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span style={{ fontWeight: 600, color: M_COLOR[m] }}>{M_SHORT[m]}</span><span style={{ color: '#6B6056' }}>{mp}% · {$k(mb)} / {$k(mc)}</span></div><PBar pct={mp} color={M_COLOR[m]} h={8} /></div>); })}</div>
      </div>
      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead style={{ position: 'sticky', top: 0, background: '#F9F8F6', zIndex: 2 }}><tr>{['Project','Market','Status','Contract','YTD Invoiced','Left to Bill','% Billed','Last Billed','Billing Date'].map(h => <th key={h} style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #E5E3E0', color: '#6B6056', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>)}</tr></thead>
          <tbody>{withBal.map(j => (
            <tr key={j.id} style={{ borderBottom: '1px solid #F4F4F2' }}>
              <td style={{ padding: '8px 10px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{j.job_name}</td>
              <td style={{ padding: '8px 10px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td>
              <td style={{ padding: '8px 10px' }}><span style={pill(S_COLOR[j.status] || '#6B6056', S_BG[j.status] || '#F4F4F2')}>{S_SHORT[j.status]}</span></td>
              <td style={{ padding: '8px 10px', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}>{$(j.adj_contract_value || j.contract_value)}</td>
              <td style={{ padding: '8px 10px' }} onClick={() => startEdit(j, 'ytd_invoiced')}>{editId === j.id && editField === 'ytd_invoiced' ? <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => saveEdit(j)} onKeyDown={e => e.key === 'Enter' && saveEdit(j)} style={{ ...inputS, width: 100, padding: '4px 8px' }} /> : <span style={{ cursor: 'pointer', borderBottom: '1px dashed #E5E3E0' }}>{$(j.ytd_invoiced)}</span>}</td>
              <td style={{ padding: '8px 10px', fontFamily: 'Syne', fontWeight: 800, color: n(j.left_to_bill) > 100000 ? '#991B1B' : n(j.left_to_bill) > 50000 ? '#B45309' : '#065F46', fontSize: 13 }}>{$(j.left_to_bill)}</td>
              <td style={{ padding: '8px 10px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PBar pct={n(j.pct_billed)} h={4} /><span style={{ fontSize: 11 }}>{n(j.pct_billed)}%</span></div></td>
              <td style={{ padding: '8px 10px' }} onClick={() => startEdit(j, 'last_billed')}>{editId === j.id && editField === 'last_billed' ? <input autoFocus type="date" value={editVal || ''} onChange={e => setEditVal(e.target.value)} onBlur={() => saveEdit(j)} onKeyDown={e => e.key === 'Enter' && saveEdit(j)} style={{ ...inputS, width: 130, padding: '4px 8px' }} /> : <span style={{ cursor: 'pointer', borderBottom: '1px dashed #E5E3E0' }}>{fD(j.last_billed)}</span>}</td>
              <td style={{ padding: '8px 10px', color: '#6B6056' }}>{j.billing_date || '—'}</td>
            </tr>))}
            <tr style={{ background: '#F9F8F6', fontWeight: 700, borderTop: '2px solid #E5E3E0' }}><td style={{ padding: '10px', fontFamily: 'Syne' }}>TOTALS ({withBal.length})</td><td colSpan={2} /><td style={{ padding: '10px', fontFamily: 'Syne', fontSize: 13 }}>{$(totals.c)}</td><td style={{ padding: '10px', fontFamily: 'Syne', fontSize: 13 }}>{$(totals.y)}</td><td style={{ padding: '10px', fontFamily: 'Syne', fontSize: 13, color: '#B45309' }}>{$(totals.l)}</td><td colSpan={3} /></tr>
          </tbody></table>
      </div>
    </div>
  );
}

/* ═══ PRODUCTION PAGE ═══ */
function ProdCard({ j, move }) {
  return (<div style={{ ...card, padding: 12, marginBottom: 6 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.job_name}</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span><span style={pill(S_COLOR[j.status] || '#6B6056', S_BG[j.status] || '#F4F4F2')}>{S_SHORT[j.status]}</span></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B6056', marginBottom: 4 }}><span>{n(j.total_lf).toLocaleString()} LF</span><span style={{ fontFamily: 'Syne', fontWeight: 700, color: '#8B2020' }}>{$(j.adj_contract_value || j.contract_value)}</span></div>{n(j.left_to_bill) > 0 && <div style={{ fontSize: 10, color: '#B45309', marginBottom: 6 }}>LTB {$(j.left_to_bill)}</div>}<div style={{ display: 'flex', gap: 4 }}>{STATUSES.filter(ns => ns !== j.status).map(ns => <button key={ns} onClick={() => move(j, ns)} style={{ flex: 1, padding: '4px 2px', borderRadius: 6, border: `1px solid ${S_COLOR[ns]}30`, background: S_BG[ns], color: S_COLOR[ns], fontSize: 9, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>→ {S_SHORT[ns]}</button>)}</div></div>);
}
function ProductionPage({ jobs, onRefresh }) {
  const [groupBy, setGroupBy] = useState('status'); const [mktF, setMktF] = useState(null); const [statusF, setStatusF] = useState(null); const [search, setSearch] = useState('');
  const move = async (job, ns) => { await sbPatch('jobs', job.id, { status: ns }); fireAlert('job_updated', { ...job, status: ns }); logActivity(job, 'status_change', 'status', job.status, ns); onRefresh(); };
  const filtered = useMemo(() => { let f = jobs; if (mktF) f = f.filter(j => j.market === mktF); if (statusF) f = f.filter(j => j.status === statusF); if (search) { const q = search.toLowerCase(); f = f.filter(j => `${j.job_name} ${j.customer_name}`.toLowerCase().includes(q)); } return f; }, [jobs, mktF, statusF, search]);
  const columns = useMemo(() => {
    if (groupBy === 'status') return STATUSES.map(s => ({ key: s, label: S_LABEL[s], color: S_COLOR[s], bg: S_BG[s], jobs: filtered.filter(j => j.status === s) }));
    const groups = {}; filtered.forEach(j => { const v = j[groupBy] || ''; const k = v || '__unspec__'; if (!groups[k]) groups[k] = { label: v || 'Unspecified', jobs: [] }; groups[k].jobs.push(j); });
    let cols = Object.entries(groups).map(([k, g]) => ({ key: k, label: g.label, color: '#8B2020', bg: '#FDF4F4', jobs: g.jobs, tv: g.jobs.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0) }));
    cols.sort((a, b) => { if (a.key === '__unspec__') return 1; if (b.key === '__unspec__') return -1; return b.tv - a.tv; });
    const capped = cols.length > 12; return { cols: cols.slice(0, 12), capped };
  }, [filtered, groupBy]);
  const isStatus = groupBy === 'status'; const colArr = isStatus ? columns : columns.cols; const isCapped = !isStatus && columns.capped;
  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 16 }}>Production</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><span style={{ fontSize: 11, color: '#9E9B96', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Group By:</span>{[{ key: 'status', label: 'Status' }, { key: 'customer_name', label: 'Customer' }, { key: 'style', label: 'Style' }, { key: 'color', label: 'Color' }].map(g => <button key={g.key} onClick={() => setGroupBy(g.key)} style={gpill(groupBy === g.key)}>{g.label}</button>)}</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ ...inputS, width: 180, padding: '6px 10px', fontSize: 12 }} />
        <button onClick={() => setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m => <button key={m} onClick={() => setMktF(m)} style={fpill(mktF === m)}>{M_SHORT[m]}</button>)}
        {!isStatus && <><span style={{ color: '#E5E3E0' }}>|</span><button onClick={() => setStatusF(null)} style={fpill(!statusF)}>All</button>{STATUSES.map(s => <button key={s} onClick={() => setStatusF(s)} style={fpill(statusF === s)}>{S_SHORT[s]}</button>)}</>}
      </div>
      {isCapped && <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B40', borderRadius: 8, padding: '6px 14px', marginBottom: 12, fontSize: 12, color: '#B45309' }}>Showing top 12 by contract value</div>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(colArr.length, 4)},1fr)`, gap: 12, alignItems: 'flex-start' }}>
        {colArr.map(col => { const cv = col.jobs.reduce((x, j) => x + n(j.adj_contract_value || j.contract_value), 0); const lf = col.jobs.reduce((x, j) => x + n(j.total_lf), 0); return (
          <div key={col.key}><div style={{ background: col.bg || '#FDF4F4', border: `1px solid ${col.color}30`, borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}><div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 14, color: col.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</div><div style={{ fontSize: 11, color: '#6B6056', marginTop: 2 }}><span style={{ background: '#E5E3E0', padding: '1px 6px', borderRadius: 4, fontWeight: 700, marginRight: 6 }}>{col.jobs.length}</span>{lf.toLocaleString()} LF · {$k(cv)}</div></div><div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>{col.jobs.map(j => <ProdCard key={j.id} j={j} move={move} />)}{col.jobs.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#9E9B96', fontSize: 12 }}>No projects</div>}</div></div>); })}
      </div>
    </div>
  );
}

/* ═══ REPORTS PAGE ═══ */
function ReportsPage({ jobs }) {
  const [activeRpt, setActiveRpt] = useState(null);
  const active = useMemo(() => jobs.filter(j => j.status !== 'complete'), [jobs]);
  const rptExport = (rows, cols) => { const h = cols.join(','); const r = rows.map(row => cols.map((_, i) => row[i] ?? '').join(',')); const b = new Blob([h + '\n' + r.join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'report.csv'; a.click(); };

  const reports = [
    { id: 'ltb_rep', title: 'Left to Bill by Sales Rep', desc: 'Contract value, YTD invoiced, and remaining balance per sales representative' },
    { id: 'aging', title: 'Billing Aging', desc: 'Projects with zero billing grouped by contract age' },
    { id: 'lf_week', title: 'LF by Week', desc: 'Linear feet scheduled by week and market' },
    { id: 'pipeline', title: 'Pipeline by Market', desc: 'Contract values by status and market' },
    { id: 'revenue', title: 'Revenue vs Pipeline', desc: 'Billed revenue compared to remaining pipeline by market' },
    { id: 'prod_sched', title: 'Production Schedule', desc: 'All in-production and queued projects sorted by start date' },
  ];

  const renderReport = () => {
    if (activeRpt === 'ltb_rep') {
      const reps = {}; active.forEach(j => { const r = j.sales_rep || 'Unassigned'; if (!reps[r]) reps[r] = { rep: r, count: 0, tc: 0, ytd: 0, ltb: 0 }; reps[r].count++; reps[r].tc += n(j.adj_contract_value || j.contract_value); reps[r].ytd += n(j.ytd_invoiced); reps[r].ltb += n(j.left_to_bill); });
      const data = Object.values(reps).sort((a, b) => b.ltb - a.ltb);
      return (<div><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ borderBottom: '2px solid #E5E3E0' }}>{['Rep','Projects','Contract','YTD Invoiced','Left to Bill','Avg %'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px', color: '#6B6056', fontWeight: 600, textTransform: 'uppercase', fontSize: 11 }}>{h}</th>)}</tr></thead><tbody>{data.map(r => <tr key={r.rep} style={{ borderBottom: '1px solid #F4F4F2' }}><td style={{ padding: 8, fontWeight: 600 }}>{r.rep}</td><td style={{ padding: 8 }}>{r.count}</td><td style={{ padding: 8, fontFamily: 'Syne', fontWeight: 700 }}>{$(r.tc)}</td><td style={{ padding: 8 }}>{$(r.ytd)}</td><td style={{ padding: 8, fontFamily: 'Syne', fontWeight: 700, color: '#8B2020' }}>{$(r.ltb)}</td><td style={{ padding: 8 }}>{r.tc > 0 ? Math.round(r.ytd / r.tc * 100) : 0}%</td></tr>)}</tbody></table>
        <div style={{ marginTop: 16 }}><ResponsiveContainer width="100%" height={200}><BarChart data={data} barSize={30}><XAxis dataKey="rep" tick={{ fill: '#6B6056', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#6B6056', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => $k(v)} /><Tooltip formatter={v => $(v)} contentStyle={{ background: '#fff', border: '1px solid #E5E3E0', borderRadius: 8 }} /><Bar dataKey="ltb" fill="#8B2020" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>);
    }
    if (activeRpt === 'aging') {
      const unbilled = active.filter(j => n(j.pct_billed) === 0);
      const buckets = { 'Not Started': unbilled.filter(j => n(j.contract_age) < 30), Watch: unbilled.filter(j => n(j.contract_age) >= 30 && n(j.contract_age) < 60), Overdue: unbilled.filter(j => n(j.contract_age) >= 60 && n(j.contract_age) < 90), Critical: unbilled.filter(j => n(j.contract_age) >= 90) };
      const colors = { 'Not Started': '#9E9B96', Watch: '#B45309', Overdue: '#C2410C', Critical: '#991B1B' };
      return (<div>{Object.entries(buckets).map(([name, bj]) => bj.length > 0 && <div key={name} style={{ marginBottom: 16 }}><div style={{ fontFamily: 'Syne', fontWeight: 700, color: colors[name], marginBottom: 6 }}>{name} ({bj.length}) — {$(bj.reduce((s, j) => s + n(j.contract_value), 0))}</div><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><tbody>{bj.map(j => <tr key={j.id} style={{ borderBottom: '1px solid #F4F4F2', borderLeft: `3px solid ${colors[name]}` }}><td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name}</td><td style={{ padding: '6px 8px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td><td style={{ padding: '6px 8px', fontFamily: 'Syne', fontWeight: 700 }}>{$(j.contract_value)}</td><td style={{ padding: '6px 8px', color: colors[name] }}>{j.contract_age}d</td></tr>)}</tbody></table></div>)}</div>);
    }
    if (activeRpt === 'pipeline') {
      const data = MKTS.map(m => { const d = { name: M_SHORT[m] }; STATUSES.forEach(s => { d[s] = jobs.filter(j => j.market === m && j.status === s).reduce((x, j) => x + n(j.adj_contract_value || j.contract_value), 0); }); return d; });
      return (<div><ResponsiveContainer width="100%" height={300}><BarChart data={data}><XAxis dataKey="name" tick={{ fill: '#6B6056', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#6B6056', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => $k(v)} /><Tooltip formatter={v => $(v)} contentStyle={{ background: '#fff', border: '1px solid #E5E3E0', borderRadius: 8 }} /><Legend />{STATUSES.map(s => <Bar key={s} dataKey={s} stackId="a" fill={S_COLOR[s]} name={S_SHORT[s]} />)}</BarChart></ResponsiveContainer></div>);
    }
    if (activeRpt === 'revenue') {
      const data = MKTS.map(m => { const mj = active.filter(j => j.market === m); return { name: M_SHORT[m], billed: mj.reduce((s, j) => s + n(j.ytd_invoiced), 0), remaining: mj.reduce((s, j) => s + n(j.left_to_bill), 0) }; });
      return (<div><ResponsiveContainer width="100%" height={260}><BarChart data={data} barSize={30}><XAxis dataKey="name" tick={{ fill: '#6B6056', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#6B6056', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => $k(v)} /><Tooltip formatter={v => $(v)} contentStyle={{ background: '#fff', border: '1px solid #E5E3E0', borderRadius: 8 }} /><Legend /><Bar dataKey="billed" fill="#065F46" name="Billed" radius={[4, 4, 0, 0]} /><Bar dataKey="remaining" fill="#B45309" name="Remaining" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>);
    }
    if (activeRpt === 'prod_sched') {
      const pj = jobs.filter(j => ['in_production','production_queue'].includes(j.status)).sort((a, b) => new Date(a.est_start_date || '9999') - new Date(b.est_start_date || '9999'));
      const tLF = pj.reduce((s, j) => s + n(j.total_lf), 0); const tCV = pj.reduce((s, j) => s + n(j.adj_contract_value || j.contract_value), 0); const tLTB = pj.reduce((s, j) => s + n(j.left_to_bill), 0);
      return (<div><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ borderBottom: '2px solid #E5E3E0' }}>{['Code','Project','Market','Fence','LF','Est. Start','Rep','Contract','LTB','Notes'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px', color: '#6B6056', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead><tbody>{pj.map(j => <tr key={j.id} style={{ borderBottom: '1px solid #F4F4F2' }}><td style={{ padding: '6px 8px' }}>{j.job_number}</td><td style={{ padding: '6px 8px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name}</td><td style={{ padding: '6px 8px' }}><span style={pill(M_COLOR[j.market] || '#6B6056', M_BG[j.market] || '#F4F4F2')}>{M_SHORT[j.market] || '—'}</span></td><td style={{ padding: '6px 8px' }}>{j.fence_type || '—'}</td><td style={{ padding: '6px 8px' }}>{n(j.total_lf).toLocaleString()}</td><td style={{ padding: '6px 8px' }}>{fD(j.est_start_date)}</td><td style={{ padding: '6px 8px' }}>{j.sales_rep || '—'}</td><td style={{ padding: '6px 8px', fontFamily: 'Syne', fontWeight: 700 }}>{$(j.adj_contract_value || j.contract_value)}</td><td style={{ padding: '6px 8px', color: '#8B2020', fontFamily: 'Syne', fontWeight: 700 }}>{$(j.left_to_bill)}</td><td style={{ padding: '6px 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9E9B96' }}>{j.notes || '—'}</td></tr>)}
        <tr style={{ background: '#F9F8F6', fontWeight: 700, borderTop: '2px solid #E5E3E0' }}><td colSpan={4} style={{ padding: 8, fontFamily: 'Syne' }}>TOTALS ({pj.length})</td><td style={{ padding: 8 }}>{tLF.toLocaleString()}</td><td colSpan={2} /><td style={{ padding: 8, fontFamily: 'Syne' }}>{$(tCV)}</td><td style={{ padding: 8, fontFamily: 'Syne', color: '#8B2020' }}>{$(tLTB)}</td><td /></tr></tbody></table></div>);
    }
    if (activeRpt === 'lf_week') {
      const weeks = {}; active.forEach(j => { if (!j.est_start_date) return; const d = new Date(j.est_start_date); const mon = new Date(d); mon.setDate(mon.getDate() - mon.getDay() + 1); const k = mon.toISOString().split('T')[0]; if (!weeks[k]) weeks[k] = { week: k, total: 0 }; MKTS.forEach(m => { if (!weeks[k][m]) weeks[k][m] = 0; }); weeks[k][j.market] = (weeks[k][j.market] || 0) + n(j.total_lf); weeks[k].total += n(j.total_lf); });
      const data = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).slice(0, 16);
      return (<div><ResponsiveContainer width="100%" height={250}><BarChart data={data}><XAxis dataKey="week" tick={{ fill: '#6B6056', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => { const d = new Date(v); return `${d.getMonth() + 1}/${d.getDate()}`; }} /><YAxis tick={{ fill: '#6B6056', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#fff', border: '1px solid #E5E3E0', borderRadius: 8 }} /><Legend />{MKTS.map(m => <Bar key={m} dataKey={m} stackId="a" fill={M_COLOR[m]} name={M_SHORT[m]} />)}</BarChart></ResponsiveContainer></div>);
    }
    return null;
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Reports</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>{reports.map(r => (
        <div key={r.id} style={{ ...card, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div><div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{r.title}</div><div style={{ fontSize: 12, color: '#6B6056', marginBottom: 12 }}>{r.desc}</div></div>
          <button onClick={() => setActiveRpt(activeRpt === r.id ? null : r.id)} style={activeRpt === r.id ? btnP : btnS}>{activeRpt === r.id ? 'Close' : 'Run Report'}</button>
        </div>))}</div>
      {activeRpt && <div style={card}>{renderReport()}</div>}
    </div>
  );
}

/* ═══ SCHEDULE PAGE ═══ */
function SchedulePage({ jobs }) {
  const [events, setEvents] = useState([]); const [view, setView] = useState('calendar'); const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [showAdd, setShowAdd] = useState(false); const [mktF, setMktF] = useState(null);
  const [form, setForm] = useState({ job_id: '', event_type: 'production_start', scheduled_date: '', end_date: '', assigned_to: '', crew: '', lf_scheduled: '', notes: '' });
  const [jobSearch, setJobSearch] = useState('');

  const fetchEvents = useCallback(async () => { const d = await sbGet('schedule_events', 'order=scheduled_date.asc'); setEvents(d || []); }, []);
  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const filteredEvents = mktF ? events.filter(e => e.market === mktF) : events;

  const saveEvent = async (e) => { e.preventDefault(); const job = jobs.find(j => j.id === form.job_id); if (!job) return; await sbPost('schedule_events', { ...form, job_number: job.job_number, job_name: job.job_name, market: job.market, color: M_COLOR[job.market] || '#8B2020', lf_scheduled: n(form.lf_scheduled) }); setShowAdd(false); setForm({ job_id: '', event_type: 'production_start', scheduled_date: '', end_date: '', assigned_to: '', crew: '', lf_scheduled: '', notes: '' }); fetchEvents(); };

  // Calendar helpers
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const today = new Date().toISOString().split('T')[0];

  const prevMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
  const nextMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const goToday = () => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // Weekly capacity
  const getMonday = (d) => { const dt = new Date(d); dt.setDate(dt.getDate() - dt.getDay() + 1); return dt; };
  const weeks8 = useMemo(() => { const w = []; const start = getMonday(new Date()); for (let i = 0; i < 8; i++) { const d = new Date(start); d.setDate(d.getDate() + i * 7); w.push(d); } return w; }, []);

  const searchedJobs = jobSearch ? jobs.filter(j => `${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0, 10) : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 900 }}>Schedule</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setView('calendar')} style={gpill(view === 'calendar')}>Calendar</button>
          <button onClick={() => setView('list')} style={gpill(view === 'list')}>List</button>
          <button onClick={() => setShowAdd(true)} style={btnP}>+ Add Event</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}><button onClick={() => setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m => <button key={m} onClick={() => setMktF(m)} style={fpill(mktF === m)}>{M_SHORT[m]}</button>)}</div>

      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {view === 'calendar' && <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <button onClick={prevMonth} style={btnS}>← Prev</button>
              <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18 }}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              <div style={{ display: 'flex', gap: 8 }}><button onClick={goToday} style={btnS}>Today</button><button onClick={nextMonth} style={btnS}>Next →</button></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: '#E5E3E0', borderRadius: 12, overflow: 'hidden' }}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} style={{ background: '#F9F8F6', padding: '6px 8px', fontSize: 11, fontWeight: 600, color: '#6B6056', textAlign: 'center' }}>{d}</div>)}
              {Array.from({ length: firstDay }, (_, i) => <div key={`e${i}`} style={{ background: '#FAFAF8', minHeight: 80 }} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1; const dateStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayEvents = filteredEvents.filter(e => e.scheduled_date && e.scheduled_date.startsWith(dateStr));
                const isToday = dateStr === today;
                const dayLF = dayEvents.reduce((s, e) => s + n(e.lf_scheduled), 0);
                return (<div key={day} style={{ background: '#FFFFFF', minHeight: 80, padding: 4, borderTop: isToday ? '2px solid #8B2020' : 'none', position: 'relative' }}>
                  <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 400, color: isToday ? '#8B2020' : '#6B6056', marginBottom: 2 }}>{day}</div>
                  {dayEvents.slice(0, 3).map(e => <div key={e.id} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, marginBottom: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: (e.color || '#8B2020') + '20', color: e.color || '#8B2020', fontWeight: 600 }}>{e.job_name}</div>)}
                  {dayEvents.length > 3 && <div style={{ fontSize: 9, color: '#9E9B96' }}>+{dayEvents.length - 3} more</div>}
                  {dayLF > 0 && <div style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 9, color: '#9E9B96' }}>{dayLF.toLocaleString()} LF</div>}
                </div>);
              })}
            </div>
          </>}
          {view === 'list' && <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ borderBottom: '2px solid #E5E3E0' }}>{['Date','Project','Market','Type','LF','Assigned','Notes'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px', color: '#6B6056', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>{filteredEvents.map(e => <tr key={e.id} style={{ borderBottom: '1px solid #F4F4F2' }}><td style={{ padding: '6px 8px' }}>{fD(e.scheduled_date)}</td><td style={{ padding: '6px 8px', fontWeight: 500 }}>{e.job_name}</td><td style={{ padding: '6px 8px' }}><span style={pill(M_COLOR[e.market] || '#6B6056', M_BG[e.market] || '#F4F4F2')}>{M_SHORT[e.market] || '—'}</span></td><td style={{ padding: '6px 8px' }}>{(e.event_type || '').replace(/_/g, ' ')}</td><td style={{ padding: '6px 8px' }}>{n(e.lf_scheduled).toLocaleString()}</td><td style={{ padding: '6px 8px' }}>{e.assigned_to || '—'}</td><td style={{ padding: '6px 8px', color: '#9E9B96', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.notes || '—'}</td></tr>)}</tbody></table>
          </div>}
        </div>

        {/* Weekly capacity */}
        {view === 'calendar' && <div style={{ width: 220, flexShrink: 0 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Weekly Capacity</div>
          {weeks8.map(w => { const wk = w.toISOString().split('T')[0]; const wEnd = new Date(w); wEnd.setDate(wEnd.getDate() + 6); const wEvents = events.filter(e => e.scheduled_date >= wk && e.scheduled_date <= wEnd.toISOString().split('T')[0]); const wLF = wEvents.reduce((s, e) => s + n(e.lf_scheduled), 0); const pct = wLF / 8000 * 100; const color = wLF > 8000 ? '#991B1B' : wLF > 5000 ? '#B45309' : '#065F46';
            return (<div key={wk} style={{ marginBottom: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}><span style={{ color: '#6B6056' }}>Wk {w.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span style={{ fontWeight: 700, color }}>{wLF.toLocaleString()} LF</span></div><PBar pct={pct} color={color} h={4} /></div>); })}
        </div>}
      </div>

      {/* Add Event Modal */}
      {showAdd && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAdd(false)}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 480, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Add Event</div>
          <form onSubmit={saveEvent}>
            <div style={{ marginBottom: 12 }}><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>Project</label><input value={jobSearch} onChange={e => { setJobSearch(e.target.value); setForm(f => ({ ...f, job_id: '' })); }} placeholder="Search projects..." style={inputS} />{jobSearch && !form.job_id && <div style={{ border: '1px solid #E5E3E0', borderRadius: 8, marginTop: 4, maxHeight: 150, overflow: 'auto' }}>{searchedJobs.map(j => <div key={j.id} onClick={() => { setForm(f => ({ ...f, job_id: j.id })); setJobSearch(`${j.job_number} - ${j.job_name}`); }} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #F4F4F2' }} onMouseEnter={e => e.currentTarget.style.background = '#FDF9F6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{j.job_number} - {j.job_name}</div>)}</div>}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>Event Type</label><select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))} style={inputS}>{['production_start','production_end','install_start','install_end','delivery'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
              <div><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>LF Scheduled</label><input type="number" value={form.lf_scheduled} onChange={e => setForm(f => ({ ...f, lf_scheduled: e.target.value }))} style={inputS} /></div>
              <div><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>Start Date</label><input type="date" required value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} style={inputS} /></div>
              <div><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>End Date</label><input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={inputS} /></div>
              <div><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>Assigned To</label><input value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} style={inputS} /></div>
              <div><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>Crew</label><input value={form.crew} onChange={e => setForm(f => ({ ...f, crew: e.target.value }))} style={inputS} /></div>
            </div>
            <div style={{ marginTop: 12 }}><label style={{ display: 'block', fontSize: 11, color: '#6B6056', marginBottom: 4, textTransform: 'uppercase' }}>Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...inputS, resize: 'vertical' }} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button type="submit" style={btnP}>Save Event</button><button type="button" onClick={() => setShowAdd(false)} style={btnS}>Cancel</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

/* ═══ APP ═══ */
const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '▣' }, { key: 'projects', label: 'Projects', icon: '◧' }, { key: 'billing', label: 'Billing', icon: '$' },
  { key: 'production', label: 'Production', icon: '⚙' }, { key: 'reports', label: 'Reports', icon: '◑' }, { key: 'schedule', label: 'Schedule', icon: '◷' },
];

export default function App() {
  const [page, setPage] = useState('dashboard'); const [jobs, setJobs] = useState([]); const [loading, setLoading] = useState(true);
  const fetchJobs = useCallback(async () => { try { const d = await sbGet('jobs', 'select=*&order=created_at.desc'); setJobs(d || []); } catch (e) { console.error(e); } setLoading(false); }, []);
  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', width: '100%' }}>
      <div style={{ width: 220, minWidth: 220, maxWidth: 220, flexShrink: 0, background: '#1A1A1A', borderRight: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '24px 20px 20px' }}><div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 900, color: '#8B2020', whiteSpace: 'nowrap', overflow: 'hidden' }}>FENCECRETE</div><div style={{ fontSize: 10, color: '#9E9B96', letterSpacing: 2, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden' }}>Operations</div></div>
        <nav style={{ flex: 1, padding: '0 8px', overflow: 'auto' }}>{NAV.map(ni => <button key={ni.key} onClick={() => setPage(ni.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', marginBottom: 2, borderRadius: 8, border: 'none', background: page === ni.key ? '#8B202018' : 'transparent', color: page === ni.key ? '#8B2020' : '#9E9B96', fontSize: 14, fontWeight: page === ni.key ? 600 : 400, cursor: 'pointer', textAlign: 'left', borderLeft: page === ni.key ? '3px solid #8B2020' : '3px solid transparent' }}><span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{ni.icon}</span>{ni.label}</button>)}</nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid #2A2A2A', fontSize: 11, color: '#6B6056' }}>{jobs.length} projects<button onClick={fetchJobs} style={{ display: 'block', marginTop: 6, padding: '4px 10px', background: '#2A2A2A', border: 'none', borderRadius: 6, color: '#9E9B96', fontSize: 11, cursor: 'pointer' }}>Refresh</button></div>
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, padding: '24px 32px' }}>
          {loading ? <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', color: '#9E9B96' }}>Loading...</div> : <>
            {page === 'dashboard' && <Dashboard jobs={jobs} />}
            {page === 'projects' && <ProjectsPage jobs={jobs} onRefresh={fetchJobs} />}
            {page === 'billing' && <BillingPage jobs={jobs} onRefresh={fetchJobs} />}
            {page === 'production' && <ProductionPage jobs={jobs} onRefresh={fetchJobs} />}
            {page === 'reports' && <ReportsPage jobs={jobs} />}
            {page === 'schedule' && <SchedulePage jobs={jobs} />}
          </>}
        </div>
      </div>
    </div>
  );
}
