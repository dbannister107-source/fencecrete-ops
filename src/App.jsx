import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
// Fix default Leaflet icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({iconRetinaUrl:require('leaflet/dist/images/marker-icon-2x.png'),iconUrl:require('leaflet/dist/images/marker-icon.png'),shadowUrl:require('leaflet/dist/images/marker-shadow.png')});

/* ═══ CONFIG ═══ */
const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const sbGet = async (t, q = '') => (await fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H })).json();
const sbPatch = async (t, id, b) => (await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) })).json();
const sbPost = async (t, b) => (await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const sbDel = async (t, id) => fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'DELETE', headers: H });
const fireAlert = (type, job) => { try { fetch(`${SB}/functions/v1/send-alert`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ type, job }) }); } catch(e) {} };
const logAct = (job, action, field, ov, nv) => { try { sbPost('activity_log', { job_id: job?.id, job_number: job?.job_number, job_name: job?.job_name, action, field_name: field, old_value: String(ov||''), new_value: String(nv||''), changed_by: 'desktop' }); } catch(e) {} };
// Keeps fence_addons in sync with a job row's scalar fields. Adds/removes the
// auto-managed codes G (Gates), WI (Wrought Iron), C (Columns, from Single Wythe)
// based on current data. Preserves any other codes outside {G, WI, C}.
const syncFenceAddons = (row) => {
  const existing = Array.isArray(row?.fence_addons) ? row.fence_addons : [];
  const preserved = existing.filter(c => c !== 'G' && c !== 'WI' && c !== 'C');
  const next = new Set(preserved);
  if (Number(row?.number_of_gates) > 0) next.add('G');
  if (Number(row?.lf_wrought_iron) > 0 || Number(row?.total_lf_wrought_iron) > 0) next.add('WI');
  if (Number(row?.lf_single_wythe) > 0 || Number(row?.total_lf_masonry) > 0) next.add('C');
  return [...next];
};
// Fires a non-blocking "new project created" email via billing-alerts edge function.
// Intentionally NOT called from the bulk import flow.
const fireNewProjectEmail = (j) => {
  if (!j) return;
  try {
    fetch(`${SB}/functions/v1/billing-alerts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_project',
        jobNumber: j.job_number || '',
        jobName: j.job_name || '',
        market: j.market || '',
        pm: j.pm || '',
        salesRep: j.sales_rep || '',
        contractValue: Number(j.contract_value) || 0,
        status: j.status || '',
        recipient: 'violet@fencecrete.com',
        subject: `New Project Created — ${j.job_name || 'Untitled'} (${j.job_number || '—'})`
      })
    }).catch(e => console.error('[new_project email] failed:', e));
  } catch (e) { console.error('[new_project email] threw:', e); }
};

/* ═══ HELPERS ═══ */
const $ = v => '$' + (Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0});
const $k = v => { const x=Number(v)||0; return x>=1e6?'$'+(x/1e6).toFixed(1)+'M':x>=1e3?'$'+(x/1e3).toFixed(0)+'K':'$'+x; };
const n = v => Number(v)||0;
const fD = d => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—';
const fmtPct = v => (!v && v !== 0) ? '—' : `${(parseFloat(v) * 100).toFixed(1)}%`;
const relT = d => { if(!d) return '—'; const ms=Date.now()-new Date(d).getTime(), m=ms/60000; if(m<60) return `${Math.floor(m)}m ago`; const h=m/60; if(h<24) return `${Math.floor(h)}h ago`; const dy=h/24; if(dy<2) return 'Yesterday'; if(dy<7) return `${Math.floor(dy)}d ago`; return fD(d); };

const STS = ['contract_review','production_queue','in_production','inventory_ready','active_install','fence_complete','fully_complete','closed'];
const SL = { contract_review:'Contract Review', production_queue:'Production Queue', in_production:'In Production', inventory_ready:'Inventory (Ready to Install)', active_install:'Active Install', fence_complete:'Fence Complete', fully_complete:'Fully Complete', closed:'Closed' };
const SC = { contract_review:'#6B7280', production_queue:'#7C3AED', in_production:'#1D4ED8', inventory_ready:'#B45309', active_install:'#C2410C', fence_complete:'#0F766E', fully_complete:'#15803D', closed:'#FFFFFF' };
const SB_ = { contract_review:'#F9FAFB', production_queue:'#EDE9FE', in_production:'#DBEAFE', inventory_ready:'#FEF3C7', active_install:'#FFEDD5', fence_complete:'#CCFBF1', fully_complete:'#DCFCE7', closed:'#374151' };
const SS = { contract_review:'Contract Review', production_queue:'Production Queue', in_production:'In Production', inventory_ready:'Inventory', active_install:'Active Install', fence_complete:'Fence Complete', fully_complete:'Fully Complete', closed:'Closed' };
const CLOSED_SET=new Set(['fully_complete','closed']);
const MKTS = ['Austin','Dallas-Fort Worth','Houston','San Antonio'];
const MC = { Austin:'#C2410C', 'Dallas-Fort Worth':'#1D4ED8', Houston:'#065F46', 'San Antonio':'#9D174D' };
const MB = { Austin:'#FED7AA', 'Dallas-Fort Worth':'#DBEAFE', Houston:'#D1FAE5', 'San Antonio':'#FCE7F3' };
const MS = { Austin:'Austin', 'Dallas-Fort Worth':'DFW', Houston:'Houston', 'San Antonio':'SA' };
const MKT_CODE={Austin:'A','Dallas-Fort Worth':'D',Houston:'H','San Antonio':'S'};
const getNextJobNumber=async(market)=>{const yr=new Date().getFullYear().toString().slice(-2);const code=MKT_CODE[market];if(!code)return'';const prefix=yr+code;const d=await sbGet('jobs',`job_number=like.${prefix}*&select=job_number&order=job_number.desc&limit=1`);if(d&&d[0]&&d[0].job_number){const seq=parseInt(d[0].job_number.slice(-3))||0;return prefix+String(seq+1).padStart(3,'0');}return prefix+'001';};
const REPS = ['Matt','Laura','Yuda','Nathan','Ryne'];
const PM_LIST=[{id:'Doug Monroe',short:'Doug',label:'Doug Monroe'},{id:'Ray Garcia',short:'Ray',label:'Ray Garcia'},{id:'Manuel Salazar',short:'Manuel',label:'Manuel Salazar'},{id:'Rafael Anaya Jr.',short:'Jr',label:'Rafael Anaya Jr.'}];
const PMS=PM_LIST.map(p=>p.id);
// Maps underlying style values to their display labels. DB values are preserved
// for back-compat; only the user-visible label changes.
const STYLE_LABEL = (v) => /cmu|split.?face.*block/i.test(v||'') ? 'Block Style' : v;
const _STYLE_LIST = ['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'];
// Canonical 6-color palette used for NEW jobs and line items.
// Existing jobs may hold legacy colors (Painted, Adobe, 860, etc.) — those are preserved via colorOptionsFor().
const STANDARD_COLORS=['LAC','Silversmoke #860','Café','Outback #677','Regular Brown','Buff Green'];
const isLegacyColor=(c)=>!!c&&!STANDARD_COLORS.includes(c);
// Builds the color dropdown options for an EXISTING job: 6 standard colors + the job's current
// legacy color (tagged " (legacy)") if present, so users don't accidentally lose it.
const colorOptionsFor=(current)=>{
  const opts=STANDARD_COLORS.map(c=>({v:c,l:c}));
  if(isLegacyColor(current))opts.push({v:current,l:`${current} (legacy)`});
  return opts;
};
const DD = { status:STS.map(s=>({v:s,l:SL[s]})), market:MKTS.map(m=>({v:m,l:m})), fence_type:['PC','SW','PC/Gates','PC/Columns','PC/SW','PC/WI','SW/Columns','SW/Gate','SW/WI','WI','WI/Gate','Wood','PC/SW/Columns','SW/Columns/Gates','Slab','LABOR'].map(v=>({v,l:v})), style:_STYLE_LIST.map(v=>({v,l:STYLE_LABEL(v)})), style_single_wythe:_STYLE_LIST.map(v=>({v,l:STYLE_LABEL(v)})), color:STANDARD_COLORS.map(v=>({v,l:v})), billing_method:['Progress','Lump Sum','Milestone','T&M','AIA'].map(v=>({v,l:v})), job_type:['Commercial','Residential','Government','Industrial','Private','Public'].map(v=>({v,l:v})), sales_rep:REPS.map(v=>({v,l:v})), pm:PM_LIST.map(p=>({v:p.id,l:p.label})), primary_fence_type:['Precast','Masonry','Wrought Iron'].map(v=>({v,l:v})) };
const NEXT_STATUS = { contract_review:'production_queue', production_queue:'in_production', in_production:'inventory_ready', inventory_ready:'active_install', active_install:'fence_complete', fence_complete:'fully_complete', fully_complete:'closed' };

// ═══ MOLD SHARING ═══
// Some styles share the same physical mold sets. When calculating mold utilization,
// map child styles to the parent that actually owns the molds.
const MOLD_SHARING = {
  "Boxed Wood": "Vertical Wood 6'",
  "Vertical Wood 8'": "Vertical Wood 6'",
  "Vertical Wood 8' on Vertical": "Vertical Wood 6'",
  "Board & Batten Fence Style 6'": "Vertical Wood 6'",
  "Stucco Style": "Rock Style",
  "Rock Style Z Panels": "Rock Style",
};
const canonicalStyle = (s) => s && MOLD_SHARING[s] ? MOLD_SHARING[s] : s;
const isChildStyle = (s) => !!(s && MOLD_SHARING[s]);
// Inverse map: parent → [children]
const MOLD_CHILDREN = Object.entries(MOLD_SHARING).reduce((acc,[child,parent])=>{if(!acc[parent])acc[parent]=[];acc[parent].push(child);return acc;},{});

// All styles (including Vertical Wood) confirmed at 12 panels per gang mold by engineering.
// Set kept as extension point if any future style turns out to be unconfirmed.
const UNCONFIRMED_PANELS_PER_MOLD = new Set();
const isPanelsPerMoldConfirmed = (style) => !UNCONFIRMED_PANELS_PER_MOLD.has(canonicalStyle(style));
const panelsPerMoldLookup = (style) => isPanelsPerMoldConfirmed(style) ? 12 : null;

// ═══ PIECE TYPES — shared by plan lines and actuals ═══
// Each entry defines a single piece type that can be independently partial-run-adjusted.
// Key is used as the dynamic field name in both the UI state and the DB columns (planned_* / actual_* / material_*).
const PLAN_PIECE_TYPES = [
  {group:'POSTS',key:'posts_line',label:'Line Posts'},
  {group:'POSTS',key:'posts_corner',label:'Corner Posts'},
  {group:'POSTS',key:'posts_stop',label:'Stop Posts'},
  {group:'PANELS',key:'panels_regular',label:'Regular Panels'},
  {group:'PANELS',key:'panels_half',label:'Half Panels'},
  {group:'PANELS',key:'panels_bottom',label:'Bottom Panels'},
  {group:'PANELS',key:'panels_top',label:'Top Panels'},
  {group:'RAILS',key:'rails_regular',label:'Cap Rails'},
  {group:'RAILS',key:'rails_top',label:'Top Rails'},
  {group:'RAILS',key:'rails_bottom',label:'Bottom Rails'},
  {group:'RAILS',key:'rails_center',label:'Center Rails'},
  {group:'POST CAPS',key:'caps_line',label:'Line Caps'},
  {group:'POST CAPS',key:'caps_stop',label:'Stop Caps'},
];
const PLAN_PIECE_KEYS = PLAN_PIECE_TYPES.map(pt=>pt.key);
const PLAN_PIECE_GROUPS = ['POSTS','PANELS','RAILS','POST CAPS'];
// Sum helper: given a job/plan-line and a group, return total for that group from a per-piece object
const sumGroup = (obj, group) => PLAN_PIECE_TYPES.filter(pt=>pt.group===group).reduce((s,pt)=>{const v=obj?.[pt.key];return s+(Number(v)||0);},0);

/* ═══ STYLES ═══ */
const card = { background:'#FFF', border:'1px solid #E5E3E0', borderRadius:12, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' };
const inputS = { width:'100%', padding:'8px 12px', background:'#FFF', border:'1px solid #D1CEC9', borderRadius:8, color:'#1A1A1A', fontSize:13 };
const btnP = { padding:'8px 16px', background:'#8B2020', border:'none', borderRadius:8, color:'#fff', fontWeight:600, cursor:'pointer', fontSize:13 };
const btnS = { ...btnP, background:'#F4F4F2', color:'#6B6056', border:'1px solid #E5E3E0' };
const pill = (c,bg) => ({ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:bg||(c+'18'), color:c });
const gpill = a => ({ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', border:a?'1px solid #8B2020':'1px solid #E5E3E0', background:a?'#FDF4F4':'#FFF', color:a?'#8B2020':'#6B6056' });
const fpill = a => ({ padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', border:a?'1px solid #8B2020':'1px solid #E5E3E0', background:a?'#FDF4F4':'#FFF', color:a?'#8B2020':'#9E9B96' });

/* ═══ SHARED ═══ */
function Toast({message,onDone,isError}){useEffect(()=>{const t=setTimeout(onDone,isError?6000:2500);return()=>clearTimeout(t);},[onDone,isError]);return<div style={{position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',background:isError?'#DC2626':'#8B2020',color:'#fff',padding:isError?'12px 24px':'8px 20px',borderRadius:isError?10:20,fontSize:13,fontWeight:600,zIndex:9999,maxWidth:'90vw',boxShadow:isError?'0 4px 16px rgba(220,38,38,0.4)':'none'}}>{message}</div>;}
function KPI({label,value,color='#8B2020',sub}){return<div style={card}><div style={{fontFamily:'Syne',fontSize:28,fontWeight:800,color}}>{value}</div><div style={{fontSize:12,color:'#6B6056',marginTop:4}}>{label}</div>{sub&&<div style={{fontSize:10,color:'#9E9B96',marginTop:2}}>{sub}</div>}</div>;}
function PBar({pct:p,color='#8B2020',h=6}){return<div style={{height:h,background:'#E5E3E0',borderRadius:h,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(Math.max(p,0),100)}%`,background:color,borderRadius:h,transition:'width .3s'}}/></div>;}
// Multi-select dropdown with checkbox options, "All" clear row, and click-outside close.
// `selected` is a Set; `onChange` receives a new Set.
function MultiSelect({label,options,selected,onChange,width=160}){
  const[open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{if(!open)return;const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h);},[open]);
  const sel=selected instanceof Set?selected:new Set();
  const toggle=(v)=>{const next=new Set(sel);if(next.has(v))next.delete(v);else next.add(v);onChange(next);};
  const clearAll=()=>onChange(new Set());
  const sz=sel.size;
  const displayText=sz===0?label:sz>2?`${sz} selected`:[...sel].map(v=>{const o=options.find(x=>x.v===v);return o?o.l:v;}).join(', ');
  const cbox=(on)=><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:14,height:14,borderRadius:3,border:on?'2px solid #8B2020':'1px solid #D1CEC9',background:on?'#8B2020':'#FFF',color:'#FFF',fontSize:9,fontWeight:700,flexShrink:0}}>{on?'✓':''}</span>;
  return<div ref={ref} style={{position:'relative',width}}>
    <button onClick={()=>setOpen(o=>!o)} style={{...inputS,width:'100%',textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',gap:4,overflow:'hidden',padding:'8px 10px'}}>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:sz===0?'#9E9B96':'#1A1A1A',fontSize:13}}>{displayText}</span>
      <span style={{fontSize:10,color:'#9E9B96'}}>▾</span>
    </button>
    {open&&<div style={{position:'absolute',top:'100%',left:0,marginTop:4,minWidth:Math.max(width,200),background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8,boxShadow:'0 8px 30px rgba(0,0,0,.12)',zIndex:50,maxHeight:320,overflow:'auto',padding:'4px 0'}}>
      <div onClick={clearAll} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',cursor:'pointer',fontSize:12,fontWeight:sz===0?700:500,color:sz===0?'#8B2020':'#6B6056',background:sz===0?'#FDF4F4':'transparent'}}>{cbox(sz===0)}<span>All</span></div>
      <div style={{borderTop:'1px solid #F4F4F2',margin:'2px 0'}}/>
      {options.map(o=>{const on=sel.has(o.v);return<div key={o.v} onClick={()=>toggle(o.v)} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',cursor:'pointer',fontSize:12,fontWeight:on?700:400,color:on?'#8B2020':'#1A1A1A',background:on?'#FDF4F4':'transparent'}}>{cbox(on)}<span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.l}</span></div>;})}
    </div>}
  </div>;
}
// ─── LF display helpers ───
// Plant-produced LF (new "total_lf_precast" column, falls back to legacy lf_precast if null)
const lfPC=(j)=>n(j?.total_lf_precast)||n(j?.lf_precast);
const lfSW=(j)=>n(j?.total_lf_masonry)||n(j?.lf_single_wythe);
const lfWI=(j)=>n(j?.total_lf_wrought_iron)||n(j?.lf_wrought_iron);
const lfGates=(j)=>n(j?.number_of_gates);
const lfTotal=(j)=>n(j?.total_lf)||(lfPC(j)+lfSW(j)+lfWI(j));
// Render a job's LF badges on kanban-style cards — primary "X PC LF" + small gray badges for SW/WI/gates
function LfBadges({job,size='sm'}){
  const pc=lfPC(job),sw=lfSW(job),wi=lfWI(job),g=lfGates(job);
  if(pc<=0&&sw<=0&&wi<=0&&g<=0)return null;
  const fs=size==='lg'?12:11;
  const b={display:'inline-block',padding:'1px 6px',borderRadius:4,background:'#F4F4F2',color:'#6B6056',fontSize:fs-1,fontWeight:600,marginLeft:4};
  return<span style={{display:'inline-flex',alignItems:'center',flexWrap:'wrap',gap:2,fontSize:fs}}>
    {pc>0&&<b style={{color:'#1A1A1A',fontWeight:700}}>{pc.toLocaleString()} PC LF</b>}
    {pc<=0&&sw>0&&<b style={{color:'#1A1A1A',fontWeight:700}}>{sw.toLocaleString()} SW LF</b>}
    {pc<=0&&sw<=0&&wi>0&&<b style={{color:'#1A1A1A',fontWeight:700}}>{wi.toLocaleString()} WI LF</b>}
    {pc>0&&sw>0&&<span style={b}>+{sw.toLocaleString()} SW</span>}
    {pc>0&&wi>0&&<span style={b}>+{wi.toLocaleString()} WI</span>}
    {pc<=0&&sw>0&&wi>0&&<span style={b}>+{wi.toLocaleString()} WI</span>}
    {g>0&&<span style={b}>{g} gates</span>}
  </span>;
}
function renderCell(j,k){const v=j[k];if(k==='status')return<span style={pill(SC[v]||'#6B6056',SB_[v]||'#F4F4F2')}>{SS[v]||v}</span>;if(k==='market')return<span style={pill(MC[v]||'#6B6056',MB[v]||'#F4F4F2')}>{MS[v]||v||'—'}</span>;if(['adj_contract_value','contract_value','left_to_bill','ytd_invoiced','net_contract_value'].includes(k))return<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:k==='left_to_bill'?(n(v)>100000?'#991B1B':n(v)>50000?'#B45309':'#065F46'):'#1A1A1A'}}>{$(v)}</span>;if(k==='pct_billed')return<span>{fmtPct(v)}</span>;if(k==='total_lf_precast'){const x=lfPC(j);return x>0?<span style={{fontWeight:700,color:'#065F46'}}>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='lf_single_wythe'){const x=n(j.lf_single_wythe);return x>0?<span>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='lf_wrought_iron'){const x=n(j.lf_wrought_iron);return x>0?<span>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='total_lf_masonry'){const x=lfSW(j);return x>0?<span>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='total_lf_wrought_iron'){const x=lfWI(j);return x>0?<span>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='number_of_gates'){const x=lfGates(j);return x>0?<span>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='total_lf'){const x=lfTotal(j);return x>0?<span style={{fontWeight:700}}>{x.toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(['contract_date','last_billed','est_start_date','active_entry_date','complete_date'].includes(k))return fD(v);if(['aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing'].includes(k))return v?<span style={{color:'#22c55e',fontWeight:700}}>✓</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='retainage_pct')return n(v)?<span style={{fontWeight:600}}>{n(v)}%</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='retainage_held')return n(v)?<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:'#991B1B'}}>{$(v)}</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='collected')return v?<span style={pill('#065F46','#D1FAE5')}>COLLECTED</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='primary_fence_type'){const ptc={Precast:'#8B2020',Masonry:'#185FA5','Wrought Iron':'#374151'};return v?<span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:ptc[v]||'#6B6056',color:'#FFF'}}>{v}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='fence_addons'){const arr=Array.isArray(v)?v:[];return arr.length>0?<div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{arr.map(a=><span key={a} style={{display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:'#F4F4F2',color:'#1A1A1A',border:'1px solid #E5E3E0'}}>{a}</span>)}</div>:<span style={{color:'#9E9B96'}}>—</span>;}return v||'—';}

/* ═══ PROJECT QUICK VIEW ═══ */
function ProjectQuickView({job,onClose,onNav,billSub,onCalcMaterials}){
  if(!job)return null;
  const reqFlags=[{k:'aia_billing',l:'AIA'},{k:'bonds',l:'Bonds'},{k:'certified_payroll',l:'Cert Payroll'},{k:'ocip_ccip',l:'OCIP/CCIP'},{k:'third_party_billing',l:'3rd Party'}];
  const secStyle={marginBottom:16};
  const secTitle={fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8,paddingBottom:4,borderBottom:'1px solid #E5E3E0'};
  const grd={display:'grid',gridTemplateColumns:'1fr 1fr',gap:8};
  const lbl={fontSize:10,color:'#9E9B96',textTransform:'uppercase',fontWeight:600};
  const val={fontFamily:'Inter',fontSize:13,fontWeight:700,color:'#1A1A1A'};
  const addC={G:['#B45309','Gates'],C:['#6D28D9','Columns'],WI:['#374151','WI']};
  return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:350,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
    <div style={{background:'#FFF',borderRadius:16,width:680,maxWidth:'96vw',maxHeight:'92vh',overflow:'auto',boxShadow:'0 12px 40px rgba(0,0,0,0.2)'}} onClick={e=>e.stopPropagation()}>
      {/* Header */}
      <div style={{background:'#8B2020',borderRadius:'16px 16px 0 0',padding:'16px 24px',color:'#FFF',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <div style={{fontSize:12,opacity:0.7,marginBottom:2}}>#{job.job_number}</div>
          <div style={{fontFamily:'Syne',fontSize:20,fontWeight:800}}>{job.job_name}</div>
          <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:SC[job.status]||'#6B6056',color:job.status==='closed'?'#FFF':'#FFF'}}>{SS[job.status]}</span>
            <span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600,background:'rgba(255,255,255,0.2)'}}>{MS[job.market]||job.market||'—'}</span>
            {job.pm&&<span style={{fontSize:12,opacity:0.9}}>{job.pm}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:22,cursor:'pointer',padding:'0 4px',lineHeight:1}}>×</button>
      </div>
      <div style={{padding:'20px 24px'}}>
        {/* Section 1: Project Info */}
        <div style={secStyle}><div style={secTitle}>Project Info</div>
          <div style={grd}>
            <div><div style={lbl}>Customer</div><div style={val}>{job.customer_name||'—'}</div></div>
            <div><div style={lbl}>Job Type</div><div style={val}>{job.job_type||'—'}</div></div>
            <div><div style={lbl}>Primary Fence Type</div><div style={{marginTop:2}}>{job.primary_fence_type?<span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:job.primary_fence_type==='Precast'?'#8B2020':job.primary_fence_type==='Masonry'?'#185FA5':'#374151',color:'#FFF'}}>{job.primary_fence_type}</span>:<span style={{color:'#9E9B96'}}>—</span>}{Array.isArray(job.fence_addons)&&job.fence_addons.length>0&&<span style={{marginLeft:6}}>{job.fence_addons.map(a=>{const[bg,l2]=addC[a]||['#6B6056',a];return<span key={a} style={{display:'inline-block',padding:'1px 5px',borderRadius:4,fontSize:9,fontWeight:700,background:bg,color:'#FFF',marginRight:3}}>{l2}</span>;})}</span>}</div></div>
            <div><div style={lbl}>Address</div><div style={val}>{[job.address,job.city,job.state].filter(Boolean).join(', ')||'—'}</div></div>
            <div><div style={lbl}>Contract Date</div><div style={val}>{fD(job.contract_date)}</div></div>
            <div><div style={lbl}>Est. Start Date</div><div style={val}>{fD(job.est_start_date)}</div></div>
          </div>
        </div>
        {/* Section 2: Fence Details */}
        <div style={secStyle}><div style={secTitle}>Fence Details</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
            <div><div style={lbl}>Style</div><div style={val}>{job.style||'—'}</div></div>
            <div><div style={lbl}>Color</div><div style={val}>{job.color||'—'}</div></div>
            <div><div style={lbl}>Height</div><div style={val}>{job.height_precast?job.height_precast+'ft':'—'}</div></div>
            <div><div style={lbl}>PC LF</div><div style={{...val,color:lfPC(job)>0?'#065F46':'#9E9B96'}}>{lfPC(job)>0?lfPC(job).toLocaleString():'—'}</div></div>
            <div><div style={lbl}>SW LF</div><div style={val}>{lfSW(job)>0?lfSW(job).toLocaleString():'—'}</div></div>
            <div><div style={lbl}>WI LF</div><div style={val}>{lfWI(job)>0?lfWI(job).toLocaleString():'—'}</div></div>
            <div><div style={lbl}>Total LF</div><div style={{...val,color:'#8B2020'}}>{lfTotal(job).toLocaleString()}</div></div>
            <div><div style={lbl}># Gates</div><div style={val}>{n(job.number_of_gates)||'—'}</div></div>
            <div><div style={lbl}>Gate Height</div><div style={val}>{job.gate_height||'—'}</div></div>
          </div>
        </div>
        {/* Section 2.5: Install Progress */}
        {(n(job.lf_precast)>0||n(job.lf_installed_to_date)>0)&&(()=>{
          const contracted=n(job.lf_precast)||n(job.total_lf);
          const installed=n(job.lf_installed_to_date);
          const remaining=Math.max(contracted-installed,0);
          const pct=contracted>0?Math.min(Math.round(installed/contracted*100),100):n(job.pct_lf_complete);
          const barCol=pct>=100?'#065F46':pct>=70?'#B45309':'#1D4ED8';
          return<div style={secStyle}><div style={secTitle}>Install Progress</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>
              <div><div style={lbl}>LF Contracted</div><div style={val}>{contracted.toLocaleString()} LF</div></div>
              <div><div style={lbl}>LF Installed</div><div style={{...val,color:'#065F46'}}>{installed.toLocaleString()} LF</div></div>
              <div><div style={lbl}>LF Remaining</div><div style={{...val,color:'#B45309'}}>{remaining.toLocaleString()} LF</div></div>
            </div>
            <div style={{height:10,background:'#E5E3E0',borderRadius:5,overflow:'hidden',marginBottom:4}}>
              <div style={{width:`${Math.min(pct,100)}%`,height:'100%',background:barCol,transition:'width 0.3s'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B6056'}}>
              <span style={{fontWeight:700,color:barCol}}>{pct}% complete</span>
              {job.lf_last_billed_date&&<span>Last billed: {fD(job.lf_last_billed_date)}</span>}
            </div>
          </div>;
        })()}
        {/* Section 3: Contract & Billing */}
        <div style={secStyle}><div style={secTitle}>Contract & Billing</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:10}}>
            <div><div style={lbl}>Contract Value</div><div style={val}>{$(job.contract_value)}</div></div>
            <div><div style={lbl}>Change Orders</div><div style={{...val,color:n(job.change_orders)>0?'#065F46':n(job.change_orders)<0?'#991B1B':'#9E9B96'}}>{n(job.change_orders)?$(job.change_orders):'—'}</div></div>
            <div><div style={lbl}>Adj Contract</div><div style={{...val,color:'#8B2020'}}>{$(job.adj_contract_value||job.contract_value)}</div></div>
            <div><div style={lbl}>YTD Invoiced</div><div style={{...val,color:'#065F46'}}>{$(job.ytd_invoiced)}</div></div>
            <div><div style={lbl}>% Billed</div><div style={val}>{fmtPct(job.pct_billed)}</div></div>
            <div><div style={lbl}>Left to Bill</div><div style={{...val,color:'#B45309'}}>{$(job.left_to_bill)}</div></div>
          </div>
          <div style={{display:'flex',gap:8,marginBottom:8,fontSize:12,color:'#6B6056'}}>
            <span>Method: <b style={{color:'#1A1A1A'}}>{job.billing_method||'—'}</b></span>
            {job.billing_date&&<span>Date: <b style={{color:'#1A1A1A'}}>{job.billing_date}</b></span>}
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{reqFlags.map(f=><span key={f.k} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:job[f.k]?'#065F46':'#9E9B96',fontWeight:600}}>{job[f.k]?'✓':'—'} {f.l}</span>)}</div>
        </div>
        {/* Section 4: Bill Sheet Status */}
        <div style={secStyle}><div style={secTitle}>Bill Sheet Status — {monthLabel(curBillingMonth())}</div>
          {billSub?<div style={{background:'#D1FAE5',border:'1px solid #10B98140',borderRadius:8,padding:10}}>
            <div style={{fontSize:13,fontWeight:700,color:'#065F46',marginBottom:4}}>✓ Submitted {billSub.submitted_at?new Date(billSub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}{billSub.submitted_by?' by '+billSub.submitted_by:''}</div>
            <div style={{display:'flex',gap:12,fontSize:12,color:'#6B6056'}}>{n(billSub.total_lf)>0&&<span>Total LF: <b>{n(billSub.total_lf).toLocaleString()}</b></span>}{billSub.pct_complete_pm!=null&&<span>PM % Complete: <b>{billSub.pct_complete_pm}%</b></span>}</div>
          </div>:<div style={{background:'#FEE2E2',border:'1px solid #EF444440',borderRadius:8,padding:10}}>
            <div style={{fontSize:13,fontWeight:700,color:'#991B1B'}}>✗ Not submitted for {monthLabel(curBillingMonth())}</div>
          </div>}
        </div>
        {/* Section 5: Notes */}
        {job.notes&&<div style={secStyle}><div style={secTitle}>Notes</div>
          <div style={{fontSize:13,color:'#1A1A1A',whiteSpace:'pre-wrap',background:'#F9F8F6',borderRadius:8,padding:12}}>{job.notes}</div>
        </div>}
      </div>
      {/* Footer */}
      <div style={{padding:'12px 24px',borderTop:'1px solid #E5E3E0',display:'flex',gap:8,justifyContent:'flex-end'}}>
        {onNav&&<button onClick={()=>{onClose();onNav(job);}} style={{...btnP,background:'#065F46'}}>View Full Project →</button>}
        {onCalcMaterials&&<button onClick={()=>{onClose();onCalcMaterials(job);}} style={{...btnP,background:'#B45309'}}>🧮 Calculate Materials</button>}
        <button onClick={onClose} style={btnS}>Close</button>
      </div>
    </div>
  </div>;
}

/* ═══ COLUMNS ═══ */
const ALL_COLS=[{key:'status',label:'Status',w:130},{key:'market',label:'Location',w:110},{key:'job_number',label:'Project Code',w:100},{key:'included_on_billing_schedule',label:'Billing Sched.',w:100},{key:'included_on_lf_schedule',label:'LF Sched.',w:90},{key:'job_name',label:'Project Name',w:220},{key:'customer_name',label:'Customer',w:180},{key:'cust_number',label:'Cust #',w:80},{key:'fence_type',label:'Fence Type',w:100},{key:'primary_fence_type',label:'Primary Type',w:110},{key:'fence_addons',label:'Add-ons',w:140},{key:'documents_needed',label:'Docs Needed',w:140},{key:'file_location',label:'File Location',w:110},{key:'billing_method',label:'Billing Method',w:110},{key:'billing_date',label:'Billing Date',w:90},{key:'sales_rep',label:'Sales Rep',w:80},{key:'pm',label:'Project Manager',w:100},{key:'job_type',label:'Type',w:80},{key:'address',label:'Address',w:180},{key:'city',label:'City',w:100},{key:'state',label:'State',w:60},{key:'zip',label:'ZIP',w:70},{key:'height_precast',label:'Height - Precast',w:110},{key:'style',label:'Style - Precast',w:140},{key:'color',label:'Color - Precast',w:120},{key:'contract_rate_precast',label:'Rate - Precast',w:110},{key:'height_single_wythe',label:'Height - SW',w:90},{key:'contract_rate_single_wythe',label:'Rate - SW',w:90},{key:'style_single_wythe',label:'Style - SW',w:110},{key:'height_wrought_iron',label:'Height - WI',w:90},{key:'contract_rate_wrought_iron',label:'Rate - WI',w:90},{key:'lf_removal',label:'LF - Removal',w:100},{key:'height_removal',label:'Height - Removal',w:110},{key:'removal_material_type',label:'Removal Material',w:130},{key:'contract_rate_removal',label:'Rate - Removal',w:110},{key:'height_other',label:'Height - Other',w:100},{key:'other_material_type',label:'Other Material',w:120},{key:'contract_rate_other',label:'Rate - Other',w:100},{key:'number_of_gates',label:'# Gates',w:70},{key:'gate_height',label:'Gate Height',w:90},{key:'gate_description',label:'Gate Description',w:140},{key:'gate_rate',label:'Gate Rate',w:90},{key:'lump_sum_amount',label:'Lump Sum Amt',w:110},{key:'lump_sum_description',label:'Lump Sum Desc',w:150},{key:'total_lf_precast',label:'PC LF',w:80,tint:'#ECFDF5',tintHdr:'#D1FAE5'},{key:'lf_single_wythe',label:'SW LF',w:80},{key:'lf_wrought_iron',label:'WI LF',w:80},{key:'total_lf',label:'Total LF',w:90,tint:'#F9F8F6',tintHdr:'#F4F4F2'},{key:'average_height_installed',label:'Avg Height Installed',w:140},{key:'average_height_removed',label:'Avg Height Removed',w:140},{key:'net_contract_value',label:'Net Contract Value',w:140},{key:'sales_tax',label:'Sales Tax',w:90},{key:'contract_value',label:'Contract Value',w:120},{key:'change_orders',label:'Change Orders',w:120},{key:'adj_contract_value',label:'Adj. Contract Value',w:140},{key:'contract_value_recalculation',label:'CV Recalc',w:100},{key:'contract_value_recalc_diff',label:'CV Recalc Diff',w:110},{key:'ytd_invoiced',label:'YTD Invoiced',w:110},{key:'pct_billed',label:'% Billed',w:80},{key:'left_to_bill',label:'Left to Bill',w:110},{key:'last_billed',label:'Last Billed',w:100},{key:'contract_date',label:'Contract Date',w:110},{key:'contract_month',label:'Contract Month',w:120},{key:'est_start_date',label:'Est. Start Date',w:120},{key:'start_month',label:'Start Month',w:100},{key:'contract_age',label:'Contract Age',w:100},{key:'active_entry_date',label:'Active Entry Date',w:130},{key:'complete_date',label:'Complete Date',w:110},{key:'complete_month',label:'Complete Month',w:120},{key:'aia_billing',label:'AIA',w:60},{key:'bonds',label:'Bonds',w:60},{key:'certified_payroll',label:'Cert Pay',w:60},{key:'ocip_ccip',label:'OCIP',w:60},{key:'third_party_billing',label:'3rd Party',w:60},{key:'notes',label:'Notes',w:220},{key:'retainage_pct',label:'Retainage %',w:90},{key:'retainage_held',label:'Retainage Held',w:110},{key:'collected',label:'Collected',w:90}];
const DEF_VIS=['status','market','job_number','job_name','customer_name','fence_type','primary_fence_type','fence_addons','sales_rep','pm','adj_contract_value','left_to_bill','pct_billed','total_lf_precast','lf_single_wythe','lf_wrought_iron','number_of_gates','total_lf','contract_date','est_start_date','last_billed','aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing','notes'];

// Monthly billing cycle — maps the 10 LF fields on jobs to the cycle table columns,
// plus the grouped layout for the review modal. Used by PMBillingPage (Start Cycle),
// BillingPage (Monthly Cycles tab + review modal), and Dashboard (status card).
const CYCLE_LF_MAP=[['labor_post_only','lf_precast_post_only','Post Only'],['labor_post_panels','lf_precast_post_panels','Post & Panels'],['labor_complete','lf_precast_complete','Complete'],['sw_foundation','lf_sw_foundation','Foundation'],['sw_columns','lf_sw_columns','Columns'],['sw_panels','lf_sw_panels','Panels'],['sw_complete','lf_sw_complete','Complete'],['wi_gates','lf_wi_gates','Gates'],['wi_fencing','lf_wi_fencing','Fencing'],['wi_columns','lf_wi_columns','Columns']];
const CYCLE_LF_GROUPS=[
  {title:'Precast',keys:['lf_precast_post_only','lf_precast_post_panels','lf_precast_complete'],labels:['Post Only','Post & Panels','Complete']},
  {title:'Single Wythe',keys:['lf_sw_foundation','lf_sw_columns','lf_sw_panels','lf_sw_complete'],labels:['Foundation','Columns','Panels','Complete']},
  {title:'Wrought Iron',keys:['lf_wi_gates','lf_wi_fencing','lf_wi_columns'],labels:['Gates','Fencing','Columns']},
];
const cycleStatus=(c)=>c.invoice_sent?'invoiced':c.accounting_approved?'approved':c.accounting_approved_by?'review':'pending';
const CYCLE_STATUS_META={pending:{label:'Pending',c:'#6B6056',bg:'#F4F4F2'},review:{label:'In Review',c:'#B45309',bg:'#FEF3C7'},approved:{label:'Approved',c:'#065F46',bg:'#D1FAE5'},invoiced:{label:'Invoiced',c:'#1D4ED8',bg:'#DBEAFE'}};
const curBillingMonth=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const monthLabel=(ym)=>{if(!ym)return'';const[y,m]=ym.split('-');return new Date(+y,+m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});};
const fmtPct1=(v)=>(Math.round(n(v)*1000)/10).toFixed(1)+'%';

// PM Bill Sheet LF fields — written to pm_billing_entries by PMBillingPage. Surfaced
// here as read-only context for the Billing page (table column group, modal, EditPanel).
const PM_BILL_LF_TABLE=[['labor_post_only','Post Only'],['labor_post_panels','Post & Panels'],['labor_complete','Complete'],['sw_foundation','SW Found.'],['sw_columns','SW Col.'],['sw_panels','SW Panels'],['sw_complete','SW Complete'],['wi_gates','WI Gates'],['wi_fencing','WI Fencing']];
const PM_BILL_LF_GROUPS=[
  {title:'Precast',fields:[['labor_post_only','Post Only'],['labor_post_panels','Post & Panels'],['labor_complete','Complete']]},
  {title:'Single Wythe',fields:[['sw_foundation','SW Foundation'],['sw_columns','SW Columns'],['sw_panels','SW Panels'],['sw_complete','SW Complete']]},
  {title:'One Line Items',fields:[['wi_gates','WI Gates'],['wi_fencing','WI Fencing'],['wi_columns','WI Columns'],['line_bonds','Line Bonds'],['line_permits','Line Permits'],['remove_existing','Remove Existing'],['gate_controls','Gate Controls']]},
];
const SECS=[{key:'lineitems',label:'Line Items',fields:[]},{key:'contract',label:'Contract & Billing',fields:['net_contract_value','sales_tax','contract_value','change_orders','adj_contract_value','ytd_invoiced','last_billed','billing_method','billing_date','retainage_pct','retainage_held','collected','collected_date','final_invoice_amount'],computed:['pct_billed','left_to_bill']},{key:'gates',label:'Gates & Extras',fields:['number_of_gates','gate_height','gate_description','gate_rate','lump_sum_amount','lump_sum_description']},{key:'totals',label:'Totals',fields:['total_lf','total_lf_precast','total_lf_masonry','total_lf_wrought_iron','average_height_installed','product','fence_type','primary_fence_type','fence_addons']},{key:'requirements',label:'Project Requirements',fields:[]},{key:'details',label:'Details',fields:['sales_rep','pm','job_type','documents_needed','file_location','address','city','state','zip','cust_number']},{key:'dates',label:'Dates',fields:['contract_date','contract_month','est_start_date','start_month','contract_age','active_entry_date','complete_date','complete_month']},{key:'notes',label:'Notes',fields:['notes']},{key:'co',label:'Change Orders',fields:['change_orders','contract_value_recalculation','contract_value_recalc_diff']},{key:'history',label:'History',fields:[]}];

const ACT_C={status_change:'#1D4ED8',billing_update:'#065F46',note_update:'#B45309',field_update:'#6B6056',job_created:'#8B2020'};

/* ═══ REALTIME HOOK ═══ */
function useRealtime(setJobs) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let ws, hb;
    try {
      ws = new WebSocket(`wss://bdnwjokehfxudheshmmj.supabase.co/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`);
      ws.onopen = () => {
        setLive(true);
        ws.send(JSON.stringify({ topic: 'realtime:public:jobs', event: 'phx_join', payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table: 'jobs' }] } }, ref: '1' }));
        hb = setInterval(() => { try { ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' })); } catch(e) {} }, 30000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'postgres_changes') {
            const p = msg.payload?.data || msg.payload;
            if (p?.type === 'UPDATE' && p.record) setJobs(prev => prev.map(j => j.id === p.record.id ? { ...j, ...p.record } : j));
            if (p?.type === 'INSERT' && p.record) setJobs(prev => [p.record, ...prev]);
            if (p?.type === 'DELETE' && p.old_record) setJobs(prev => prev.filter(j => j.id !== p.old_record.id));
          }
        } catch(e) {}
      };
      ws.onclose = () => setLive(false);
      ws.onerror = () => setLive(false);
    } catch(e) { setLive(false); }
    return () => { if (hb) clearInterval(hb); if (ws) ws.close(); };
  }, [setJobs]);
  return live;
}

/* ═══ LINE ITEMS EDITOR ═══ */
const LINE_FENCE_TYPES=['PC','SW','WI','Wood','Other'];
function LineItemsEditor({job,onChange}){
  const[lines,setLines]=useState([]);
  const[loading,setLoading]=useState(true);
  const[dirty,setDirty]=useState(false);
  const[saving,setSaving]=useState(false);
  const[err,setErr]=useState('');
  const[toast,setToast]=useState('');
  const[confirmDel,setConfirmDel]=useState(null);
  const loadLines=useCallback(async()=>{
    if(!job?.job_number){setLines([]);setLoading(false);return;}
    setLoading(true);
    try{const d=await sbGet('job_line_items',`job_number=eq.${encodeURIComponent(job.job_number)}&order=line_number.asc`);setLines((d||[]).map(l=>({...l,_existing:true})));}
    catch(e){setErr('Load failed: '+e.message);}
    setLoading(false);
  },[job?.job_number]);
  useEffect(()=>{loadLines();},[loadLines]);
  const updateLine=(idx,field,val)=>{setLines(prev=>prev.map((l,i)=>{if(i!==idx)return l;const next={...l,[field]:val,_touched:true};if(field==='lf'||field==='contract_rate'){const lf=n(next.lf),r=n(next.contract_rate);next.line_value=Math.round(lf*r*100)/100;}return next;}));setDirty(true);};
  const addLine=()=>{const nextNum=Math.max(0,...lines.map(l=>n(l.line_number)))+1;setLines(prev=>[...prev,{job_id:job?.id||null,job_number:job?.job_number||'',line_number:nextNum,fence_type:'PC',lf:0,height:'',style:'',color:'',contract_rate:0,line_value:0,description:'',is_produced:true,_new:true,_touched:true}]);setDirty(true);};
  const removeLine=async(idx)=>{
    const l=lines[idx];
    if(l._new){setLines(prev=>prev.filter((_,i)=>i!==idx));setDirty(true);setConfirmDel(null);return;}
    try{await sbDel('job_line_items',l.id);setLines(prev=>prev.filter((_,i)=>i!==idx));setDirty(true);setConfirmDel(null);setToast('Line removed');}
    catch(e){setErr('Delete failed: '+e.message);}
  };
  const totals=useMemo(()=>{
    const t={pc_produced:0,sw:0,wi:0,wood:0,other:0,total:0,value:0};
    lines.forEach(l=>{const lf=n(l.lf);const v=n(l.line_value);t.total+=lf;t.value+=v;if(l.fence_type==='PC'&&l.is_produced)t.pc_produced+=lf;if(l.fence_type==='SW')t.sw+=lf;if(l.fence_type==='WI')t.wi+=lf;if(l.fence_type==='Wood')t.wood+=lf;if(l.fence_type==='Other')t.other+=lf;});
    return t;
  },[lines]);
  const saveAll=async()=>{
    setSaving(true);setErr('');
    try{
      // Upsert each touched line
      for(const l of lines){
        if(!l._touched)continue;
        const body={job_id:job.id,job_number:job.job_number,line_number:n(l.line_number),fence_type:l.fence_type||'PC',lf:n(l.lf),height:l.height?String(l.height):null,style:l.style||null,color:l.color||null,contract_rate:n(l.contract_rate),description:l.description||null,is_produced:l.is_produced!==false};
        if(l._new){await sbPost('job_line_items',body);}
        else{await sbPatch('job_line_items',l.id,body);}
      }
      // Recompute jobs summary fields from ALL line items (reload first)
      const fresh=await sbGet('job_line_items',`job_number=eq.${encodeURIComponent(job.job_number)}&order=line_number.asc`);
      const all=fresh||[];
      const pcLines=all.filter(x=>x.fence_type==='PC');
      // Also count gates (line items with description starting with "GATE:")
      const gateLines=all.filter(x=>(x.description||'').toUpperCase().startsWith('GATE:'));
      const summary={
        lf_precast:pcLines.filter(x=>n(x.line_number)===1).reduce((s,x)=>s+n(x.lf),0),
        lf_other:pcLines.filter(x=>n(x.line_number)>1).reduce((s,x)=>s+n(x.lf),0),
        lf_single_wythe:all.filter(x=>x.fence_type==='SW').reduce((s,x)=>s+n(x.lf),0),
        lf_wrought_iron:all.filter(x=>x.fence_type==='WI').reduce((s,x)=>s+n(x.lf),0),
        number_of_gates:gateLines.reduce((s,x)=>s+n(x.lf),0),
        total_lf_precast:all.filter(x=>x.is_produced).reduce((s,x)=>s+n(x.lf),0),
        total_lf_masonry:all.filter(x=>x.fence_type==='SW').reduce((s,x)=>s+n(x.lf),0),
        total_lf:all.reduce((s,x)=>s+n(x.lf),0),
      };
      // Auto-sync fence_addons (G/WI/C) to reflect the new summary data
      summary.fence_addons=syncFenceAddons({...job,...summary});
      await sbPatch('jobs',job.id,summary);
      setLines(all.map(l=>({...l,_existing:true})));
      setDirty(false);
      setToast('Line items saved — summary fields updated');
      if(onChange)onChange();
    }catch(e){setErr('Save failed: '+e.message);}
    setSaving(false);
  };
  const th={textAlign:'left',padding:'6px 6px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.3,borderBottom:'1px solid #E5E3E0',background:'#F9F8F6'};
  const td={padding:'4px 6px',fontSize:11,borderBottom:'1px solid #F4F4F2'};
  const inp={...inputS,padding:'3px 6px',fontSize:11};
  if(loading)return<div style={{padding:20,color:'#9E9B96',fontSize:12}}>Loading line items…</div>;
  return<div>
    {toast&&<div style={{background:'#D1FAE5',color:'#065F46',padding:'6px 10px',borderRadius:6,fontSize:11,marginBottom:8}}>{toast}</div>}
    {err&&<div style={{background:'#FEE2E2',color:'#991B1B',padding:'6px 10px',borderRadius:6,fontSize:11,marginBottom:8}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
      <div style={{fontSize:11,color:'#6B6056',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>Fence Line Items ({lines.length})</div>
      <div style={{display:'flex',gap:6}}>
        <button onClick={addLine} style={{...btnS,padding:'4px 10px',fontSize:11}}>+ Add Line</button>
        <button onClick={saveAll} disabled={!dirty||saving} style={{...btnP,padding:'4px 10px',fontSize:11,opacity:(!dirty||saving)?0.5:1}}>{saving?'Saving…':'Save Lines'}</button>
      </div>
    </div>
    <div style={{overflow:'auto',border:'1px solid #E5E3E0',borderRadius:8}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead><tr>
          <th style={{...th,width:30}}>#</th>
          <th style={{...th,width:70}}>Type</th>
          <th style={{...th,width:70}}>LF</th>
          <th style={{...th,width:60}}>Height</th>
          <th style={th}>Style</th>
          <th style={th}>Color</th>
          <th style={{...th,width:70}}>Rate</th>
          <th style={{...th,width:90}}>Line Value</th>
          <th style={{...th,width:60}}>Produced</th>
          <th style={th}>Description</th>
          <th style={{...th,width:30}}></th>
        </tr></thead>
        <tbody>
          {lines.map((l,idx)=><tr key={l.id||'new'+idx}>
            <td style={td}><input type="number" value={l.line_number||''} onChange={e=>updateLine(idx,'line_number',e.target.value)} style={{...inp,width:'100%'}}/></td>
            <td style={td}><select value={l.fence_type||'PC'} onChange={e=>updateLine(idx,'fence_type',e.target.value)} style={{...inp,width:'100%'}}>{LINE_FENCE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></td>
            <td style={td}><input type="number" value={l.lf||''} onChange={e=>updateLine(idx,'lf',e.target.value)} style={{...inp,width:'100%'}}/></td>
            <td style={td}><input value={l.height||''} onChange={e=>updateLine(idx,'height',e.target.value)} style={{...inp,width:'100%'}}/></td>
            <td style={td}><input value={l.style||''} onChange={e=>updateLine(idx,'style',e.target.value)} style={{...inp,width:'100%'}}/></td>
            <td style={td}>
              <select value={l.color||''} onChange={e=>updateLine(idx,'color',e.target.value)} style={{...inp,width:'100%'}} title={isLegacyColor(l.color)?'Legacy color — contact admin to change':''}>
                <option value="">—</option>
                {colorOptionsFor(l.color).map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              {isLegacyColor(l.color)&&<div style={{fontSize:9,color:'#B45309',fontStyle:'italic',marginTop:2}}>Legacy color — contact admin to change</div>}
            </td>
            <td style={td}><input type="number" value={l.contract_rate||''} onChange={e=>updateLine(idx,'contract_rate',e.target.value)} style={{...inp,width:'100%'}}/></td>
            <td style={{...td,fontFamily:'Inter',fontWeight:700,color:'#1A1A1A'}}>{$(l.line_value)}</td>
            <td style={{...td,textAlign:'center'}}><input type="checkbox" checked={l.is_produced!==false} onChange={e=>updateLine(idx,'is_produced',e.target.checked)} style={{accentColor:'#8B2020'}}/></td>
            <td style={td}><input value={l.description||''} onChange={e=>updateLine(idx,'description',e.target.value)} style={{...inp,width:'100%'}}/></td>
            <td style={td}>{confirmDel===idx?<span style={{display:'flex',gap:2}}><button onClick={()=>removeLine(idx)} style={{background:'#DC2626',color:'#fff',border:'none',borderRadius:4,padding:'2px 5px',fontSize:9,cursor:'pointer'}}>✓</button><button onClick={()=>setConfirmDel(null)} style={{background:'#F4F4F2',color:'#6B6056',border:'none',borderRadius:4,padding:'2px 5px',fontSize:9,cursor:'pointer'}}>×</button></span>:<button onClick={()=>setConfirmDel(idx)} style={{background:'none',border:'none',color:'#DC2626',fontSize:14,cursor:'pointer',padding:0}}>×</button>}</td>
          </tr>)}
          {lines.length===0&&<tr><td colSpan={11} style={{padding:20,textAlign:'center',color:'#9E9B96',fontSize:11}}>No line items — click "+ Add Line" to create one</td></tr>}
        </tbody>
        {lines.length>0&&<tfoot>
          <tr style={{background:'#F9F8F6',borderTop:'2px solid #E5E3E0'}}>
            <td colSpan={2} style={{padding:'8px 6px',fontSize:10,fontWeight:800,color:'#6B6056',textTransform:'uppercase'}}>Totals</td>
            <td colSpan={9} style={{padding:'8px 6px',fontSize:11}}>
              <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{background:'#D1FAE5',color:'#065F46',padding:'2px 8px',borderRadius:4,fontWeight:700}}>PC LF (produced): {totals.pc_produced.toLocaleString()}</span>
                {totals.sw>0&&<span style={{background:'#F4F4F2',padding:'2px 8px',borderRadius:4}}>SW LF: {totals.sw.toLocaleString()}</span>}
                {totals.wi>0&&<span style={{background:'#F4F4F2',padding:'2px 8px',borderRadius:4}}>WI LF: {totals.wi.toLocaleString()}</span>}
                {totals.wood>0&&<span style={{background:'#F4F4F2',padding:'2px 8px',borderRadius:4}}>Wood LF: {totals.wood.toLocaleString()}</span>}
                {totals.other>0&&<span style={{background:'#F4F4F2',padding:'2px 8px',borderRadius:4}}>Other LF: {totals.other.toLocaleString()}</span>}
                <span style={{marginLeft:'auto',fontWeight:800}}>Total LF: {totals.total.toLocaleString()}</span>
                <span style={{fontFamily:'Inter',fontWeight:800,color:'#8B2020'}}>Total Value: {$(totals.value)}</span>
              </div>
            </td>
          </tr>
        </tfoot>}
      </table>
    </div>
    {dirty&&<div style={{marginTop:8,fontSize:11,color:'#B45309',fontStyle:'italic'}}>⚠ Unsaved changes — click "Save Lines" to commit</div>}
  </div>;
}

/* ═══ ACTIVITY HISTORY ═══ */
function ActivityHistory({jobId}){const[logs,setLogs]=useState([]);const[ld,setLd]=useState(true);useEffect(()=>{sbGet('activity_log',`job_id=eq.${jobId}&order=created_at.desc&limit=50`).then(d=>{setLogs(d||[]);setLd(false);});},[jobId]);if(ld)return<div style={{padding:20,color:'#9E9B96'}}>Loading...</div>;if(!logs.length)return<div style={{padding:20,color:'#9E9B96'}}>No activity yet</div>;return<div>{logs.map(l=><div key={l.id} style={{padding:'8px 0',borderBottom:'1px solid #E5E3E0',display:'flex',gap:10,alignItems:'flex-start'}}><span style={{...pill(ACT_C[l.action]||'#6B6056',(ACT_C[l.action]||'#6B6056')+'18'),fontSize:10,whiteSpace:'nowrap',marginTop:2}}>{(l.action||'').replace(/_/g,' ')}</span><div style={{flex:1}}><div style={{fontSize:12}}>{l.field_name==='status'?`Status: ${l.old_value} → ${l.new_value}`:l.action==='job_created'?`Created: ${l.new_value}`:l.field_name==='notes'?'Notes updated':`${l.field_name}: updated`}</div><div style={{fontSize:10,color:'#9E9B96'}} title={new Date(l.created_at).toLocaleString()}>{relT(l.created_at)} · {l.changed_by}</div></div></div>)}</div>;}

/* ═══ EDIT PANEL ═══ */
function EditPanel({job,onClose,onSaved,isNew,onDuplicate,onNav}){
  const[form,setForm]=useState({...job});const[tab,setTab]=useState(isNew?'details':'lineitems');const[saving,setSaving]=useState(false);
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));
  const[saveErr,setSaveErr]=useState(null);
  const handleSave=async()=>{setSaving(true);setSaveErr(null);try{if(isNew){const{id,created_at,updated_at,...rest}=form;if(!rest.job_name){setSaving(false);return;}if(!rest.status)rest.status='contract_review';rest.fence_addons=syncFenceAddons(rest);const res=await fetch(`${SB}/rest/v1/jobs`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(rest)});const txt=await res.text();if(!res.ok)throw new Error(txt);const saved=txt?JSON.parse(txt):[];if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',saved[0].job_number);fireNewProjectEmail(saved[0]);}}else{const{id,created_at,updated_at,...rest}=form;rest.fence_addons=syncFenceAddons(rest);const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`,{method:'PATCH',headers:H,body:JSON.stringify(rest)});const txt=await res.text();if(!res.ok)throw new Error(txt);fireAlert('job_updated',{id:job.id,...rest});logAct(job,'field_update','multiple_fields','','saved');}setSaving(false);onSaved(isNew?'Project created':'Project saved');}catch(e){console.error('[EditPanel] Save failed:',e);setSaveErr(e.message);setSaving(false);}};
  const handleDup=async()=>{const{id,created_at,updated_at,job_number,...rest}=form;rest.ytd_invoiced=0;rest.pct_billed=0;rest.left_to_bill=n(rest.adj_contract_value||rest.contract_value);rest.status='contract_review';rest.last_billed=null;rest.notes='';rest.contract_date=null;rest.est_start_date=null;try{rest.job_number=await getNextJobNumber(rest.market);}catch(e){rest.job_number='';}rest.fence_addons=syncFenceAddons(rest);const saved=await sbPost('jobs',rest);if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',`Duplicated from ${job.job_number}`);fireNewProjectEmail(saved[0]);}onSaved('Project duplicated');};
  const[coList,setCOList]=useState([]);const[showCOForm,setShowCOForm]=useState(false);
  const[coForm,setCOForm]=useState({co_number:'',date_submitted:'',date_approved:'',amount:'',description:'',status:'Pending',approved_by:'',notes:''});
  const[latestPmLF,setLatestPmLF]=useState(null);
  useEffect(()=>{if(job?.id)sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`).then(d=>setCOList(d||[]));},[job?.id]);
  useEffect(()=>{if(job?.id)sbGet('pm_billing_entries',`job_id=eq.${job.id}&order=billing_period.desc&limit=1`).then(d=>setLatestPmLF(d&&d[0]||null));else setLatestPmLF(null);},[job?.id]);
  const[coToast,setCOToast]=useState(null);
  const saveCO=async()=>{const body={job_id:job.id,co_number:coForm.co_number||null,amount:n(coForm.amount),description:coForm.description||null,status:coForm.status||'Pending',date_submitted:coForm.date_submitted||null,date_approved:coForm.date_approved||null,approved_by:coForm.approved_by||null,notes:coForm.notes||null};try{const res=await fetch(`${SB}/rest/v1/change_orders`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});if(!res.ok){const txt=await res.text();console.error('CO save failed:',txt);}
    // Non-blocking email alert for CO submission
    fetch(`${SB}/functions/v1/billing-alerts`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({type:'co_submitted',jobName:job.job_name,jobNumber:job.job_number,coNumber:coForm.co_number||'—',amount:n(coForm.amount),description:coForm.description||'',submittedBy:job.pm||'PM',recipients:['david@fencecrete.com','alex@fencecrete.com'],subject:`New Change Order Submitted — ${job.job_name} CO#${coForm.co_number||'—'}`})}).catch(e=>console.error('CO email alert failed:',e));
    setShowCOForm(false);setCOForm({co_number:'',date_submitted:'',date_approved:'',amount:'',description:'',status:'Pending',approved_by:'',notes:''});sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`).then(d=>setCOList(d||[]));setCOToast({msg:'CO submitted — notification sent',kind:'success'});}catch(e){console.error('CO error:',e);setCOToast({msg:'CO save failed: '+e.message,kind:'error'});}};
  const approveCO=async(c)=>{
    const today=new Date().toISOString().split('T')[0];
    try{
      await sbPatch('change_orders',c.id,{status:'Approved',approved_by:'David Bannister',date_approved:today});
      const fresh=await sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`);
      setCOList(fresh||[]);
      const approvedSum=(fresh||[]).filter(x=>x.status==='Approved').reduce((s,x)=>s+n(x.amount),0);
      const newAdj=n(job.contract_value)+approvedSum;
      await sbPatch('jobs',job.id,{adj_contract_value:newAdj,change_orders:approvedSum});
      set('adj_contract_value',newAdj);set('change_orders',approvedSum);
      logAct(job,'field_update','co_approved',c.co_number||'—',`Approved $${n(c.amount)}`);
      setCOToast({msg:`CO #${c.co_number||'—'} approved — contract updated`,kind:'success'});
    }catch(e){console.error('[CO approve] failed:',e);setCOToast({msg:'Approve failed: '+e.message,kind:'error'});}
  };
  const rejectCO=async(c)=>{
    try{
      await sbPatch('change_orders',c.id,{status:'Rejected'});
      const fresh=await sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`);
      setCOList(fresh||[]);
      logAct(job,'field_update','co_rejected',c.co_number||'—','Rejected');
      setCOToast({msg:`CO #${c.co_number||'—'} rejected`,kind:'gray'});
    }catch(e){console.error('[CO reject] failed:',e);setCOToast({msg:'Reject failed: '+e.message,kind:'error'});}
  };
  const approvedTotal=coList.filter(c=>c.status==='Approved').reduce((s,c)=>s+n(c.amount),0);
  const coStatusC2={Pending:['#B45309','#FEF3C7'],Approved:['#065F46','#D1FAE5'],Rejected:['#6B6056','#F4F4F2']};
  const sec=SECS.find(s=>s.key===tab);const adjCV=n(form.adj_contract_value||form.contract_value);
  return(
    <div style={{position:'fixed',top:0,right:0,bottom:0,width:Math.min(540,window.innerWidth),background:'#FFF',borderLeft:'1px solid #E5E3E0',zIndex:200,display:'flex',flexDirection:'column',boxShadow:'-8px 0 30px rgba(0,0,0,.1)'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid #E5E3E0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,background:'#F9F8F6'}}>
        <div><div style={{fontFamily:'Inter',fontSize:16,fontWeight:800}}>{isNew?'New Project':(form.job_name||'Untitled')}</div><div style={{fontSize:12,color:'#6B6056'}}>{isNew?'Fill in details':`#${form.job_number} · ${form.customer_name}`}</div></div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {saveErr&&<span style={{color:'#DC2626',fontSize:12,fontWeight:600,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={saveErr}>Error: {saveErr.substring(0,60)}</span>}
          {!isNew&&onNav&&<button onClick={()=>{
            try{localStorage.setItem('fc_matreq_prejob',JSON.stringify({job_number:form.job_number||'',job_name:form.job_name||'',address:form.address||'',city:form.city||'',state:form.state||'',zip:form.zip||'',style:form.style||'',color:form.color||'',height_precast:form.height_precast||'',lf_precast:form.lf_precast||form.total_lf_precast||'',height_other:form.height_other||'',lf_other:form.lf_other||''}));}catch(e){}
            onNav('material_requests');
          }} title="Request materials from plant for this job" style={{background:'#FFF',border:'1px solid #8B2020',borderRadius:8,padding:'8px 14px',color:'#8B2020',fontWeight:700,fontSize:13,cursor:'pointer'}}>📦 Request Material</button>}
          <button onClick={handleSave} disabled={saving} style={{...btnP,background:isNew?'#065F46':'#8B2020'}}>{saving?'Saving...':isNew?'Create':'Save'}</button>
          <button onClick={onClose} style={btnS}>Close</button>
        </div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,padding:'10px 20px',borderBottom:'1px solid #E5E3E0',flexShrink:0}}>{SECS.map(s=><button key={s.key} onClick={()=>setTab(s.key)} style={{padding:'4px 10px',borderRadius:6,border:tab===s.key?'1px solid #8B2020':'1px solid #E5E3E0',background:tab===s.key?'#FDF4F4':'transparent',color:tab===s.key?'#8B2020':'#6B6056',fontSize:11,fontWeight:600,cursor:'pointer'}}>{s.label}</button>)}</div>
      <div style={{flex:1,overflow:'auto',padding:20}}>
        {tab==='lineitems'?(isNew?<div style={{padding:20,color:'#9E9B96',fontSize:12}}>Save the project first, then return to add line items.</div>:<LineItemsEditor job={job} onChange={onSaved?()=>{}:null}/>):tab==='history'?<ActivityHistory jobId={job?.id}/>:tab==='requirements'?<div>
          <div style={{fontSize:11,color:'#6B6056',marginBottom:12,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>Project Requirements</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {[{label:'AIA (G702/703)',field:'aia_billing'},{label:'Bonds',field:'bonds'},{label:'Certified Payroll',field:'certified_payroll'},{label:'OCIP/CCIP',field:'ocip_ccip'},{label:'3rd Party Billing',field:'third_party_billing'}].map(cb=><label key={cb.field} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#F9F8F6',borderRadius:8,border:'1px solid #E5E3E0',cursor:'pointer',fontSize:13,color:'#1A1A1A'}}>
              <input type="checkbox" checked={!!form[cb.field]} onChange={async e=>{const val=e.target.checked;set(cb.field,val);if(!isNew&&job?.id){await sbPatch('jobs',job.id,{[cb.field]:val});logAct(job,'field_update',cb.field,String(!val),String(val));}}} style={{width:16,height:16,accentColor:'#8B2020'}}/>
              {cb.label}
            </label>)}
          </div>
          <div style={{marginTop:20}}>
            <div style={{fontSize:11,color:'#6B6056',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>Project Manager</div>
            <select value={form.pm||''} onChange={async e=>{const val=e.target.value;set('pm',val);if(!isNew&&job?.id){await sbPatch('jobs',job.id,{pm:val});logAct(job,'field_update','pm',form.pm,val);}}} style={inputS}><option value="">— Select —</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
          </div>
        </div>:<>
          {sec&&sec.fields.map(f=>{const cd=ALL_COLS.find(c=>c.key===f);const lbl=cd?cd.label:f.replace(/_/g,' ');const dd=DD[f];return(
            <div key={f} style={{marginBottom:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',letterSpacing:0.5}}>{lbl}</label>
              {f==='fence_addons'?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{['Gates','Columns','Wrought Iron'].map(opt=>{const cur=Array.isArray(form.fence_addons)?form.fence_addons:[];const on=cur.includes(opt);return<label key={opt} style={{display:'flex',alignItems:'center',gap:5,padding:'6px 10px',background:on?'#FDF4F4':'#F9F8F6',borderRadius:6,border:on?'1px solid #8B2020':'1px solid #E5E3E0',cursor:'pointer',fontSize:12,color:on?'#8B2020':'#6B6056',fontWeight:on?700:400}}><input type="checkbox" checked={on} onChange={()=>{const next=on?cur.filter(x=>x!==opt):[...cur,opt];set('fence_addons',next);}} style={{width:14,height:14,accentColor:'#8B2020'}}/>{opt}</label>;})}</div>:f==='notes'?<textarea value={form[f]||''} onChange={e=>set(f,e.target.value)} rows={6} style={{...inputS,resize:'vertical'}}/>:dd?<select value={form[f]||''} onChange={e=>set(f,e.target.value)} style={inputS}><option value="">— Select —</option>{dd.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>:<>{f==='file_location'?<div style={{display:'flex',gap:8,alignItems:'center'}}><input value={form[f]??''} onChange={e=>set(f,e.target.value)} style={{...inputS,flex:1}}/>{form[f]&&(form[f].startsWith('http')||form[f].includes('sharepoint'))&&<a href={form[f]} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#0078D4',whiteSpace:'nowrap',fontWeight:600}}>Open →</a>}</div>:<input value={form[f]??''} onChange={e=>set(f,e.target.value)} style={inputS}/>}</>}
            </div>);})}
          {sec&&sec.computed&&<div style={{marginTop:16,padding:14,background:'#F9F8F6',borderRadius:8,border:'1px solid #E5E3E0'}}>
            <div style={{fontSize:10,color:'#9E9B96',marginBottom:8,fontWeight:600,textTransform:'uppercase'}}>Auto-calculated</div>
            {sec.computed.map(f=>{const cd=ALL_COLS.find(c=>c.key===f);const val=f==='pct_billed'?`${adjCV>0?Math.round(n(form.ytd_invoiced)/adjCV*1000)/10:0}%`:f==='left_to_bill'?$(adjCV-n(form.ytd_invoiced)):(form[f]??'—');return(
              <div key={f} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #E5E3E0'}}><span style={{fontSize:12,color:'#6B6056'}}>{cd?cd.label:f}</span><span style={{fontFamily:'Inter',fontWeight:700,fontSize:14}}>{val}</span></div>);})}
          </div>}
          {tab==='contract'&&<div style={{marginTop:16,padding:14,background:'#F9F8F6',borderRadius:8,border:'1px solid #E5E3E0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
              <div style={{fontSize:10,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>LF on File from PM Bill Sheet</div>
              {latestPmLF?.billing_period&&<div style={{fontSize:9,color:'#9E9B96'}}>{new Date(latestPmLF.billing_period+'T12:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'})}</div>}
            </div>
            {!latestPmLF?<div style={{color:'#9E9B96',fontSize:11,padding:8,textAlign:'center'}}>No PM bill sheet entries on file</div>:PM_BILL_LF_GROUPS.map(g=><div key={g.title} style={{marginBottom:8}}>
              <div style={{fontSize:9,fontWeight:700,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>{g.title}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(100px,1fr))',gap:6}}>
                {g.fields.map(([k,l])=>{const v=n(latestPmLF[k]);return<div key={k} style={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,padding:'5px 7px'}}>
                  <div style={{fontSize:8,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>{l}</div>
                  <div style={{fontFamily:'Inter',fontSize:12,fontWeight:700,color:v>0?'#1A1A1A':'#C8C4BD'}}>{v>0?v.toLocaleString():'—'}</div>
                </div>;})}
              </div>
            </div>)}
          </div>}
        </>}
      </div>
      {!isNew&&<div style={{padding:'12px 20px',borderTop:'1px solid #E5E3E0',flexShrink:0}}>
        <div style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><span style={{fontFamily:'Inter',fontWeight:700,fontSize:13}}>Change Orders</span><button onClick={()=>setShowCOForm(!showCOForm)} style={{...btnP,padding:'4px 12px',fontSize:11}}>+ Add CO</button></div>
          {showCOForm&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:8,border:'1px solid #E5E3E0'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>CO Number</label><input value={coForm.co_number} onChange={e=>setCOForm(f=>({...f,co_number:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Date Submitted</label><input type="date" value={coForm.date_submitted} onChange={e=>setCOForm(f=>({...f,date_submitted:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Amount ($)</label><input type="number" value={coForm.amount} onChange={e=>setCOForm(f=>({...f,amount:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Status</label><select value={coForm.status} onChange={e=>setCOForm(f=>({...f,status:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}>{['Pending','Approved','Rejected'].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Approved By</label><input value={coForm.approved_by} onChange={e=>setCOForm(f=>({...f,approved_by:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Date Approved</label><input type="date" value={coForm.date_approved} onChange={e=>setCOForm(f=>({...f,date_approved:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
            </div>
            <div style={{marginBottom:8}}><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Description</label><textarea value={coForm.description} onChange={e=>setCOForm(f=>({...f,description:e.target.value}))} rows={2} style={{...inputS,padding:'4px 8px',fontSize:11,resize:'vertical'}}/></div>
            <div style={{marginBottom:8}}><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Notes</label><textarea value={coForm.notes} onChange={e=>setCOForm(f=>({...f,notes:e.target.value}))} rows={2} style={{...inputS,padding:'4px 8px',fontSize:11,resize:'vertical'}}/></div>
            <div style={{display:'flex',gap:6}}><button onClick={saveCO} style={{...btnP,padding:'4px 12px',fontSize:11}}>Save</button><button onClick={()=>setShowCOForm(false)} style={{...btnS,padding:'4px 12px',fontSize:11}}>Cancel</button></div>
          </div>}
          {coToast&&<div style={{marginBottom:6,padding:'5px 10px',borderRadius:6,fontSize:11,fontWeight:600,background:coToast.kind==='success'?'#D1FAE5':coToast.kind==='error'?'#FEE2E2':'#F4F4F2',color:coToast.kind==='success'?'#065F46':coToast.kind==='error'?'#991B1B':'#6B6056',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>{coToast.msg}</span><button onClick={()=>setCOToast(null)} style={{background:'none',border:'none',cursor:'pointer',color:'inherit',fontSize:14,padding:0,lineHeight:1}}>×</button></div>}
          {coList.length>0&&<div style={{fontSize:12}}>
            {coList.map(c=>{const[sc2,sb2]=coStatusC2[c.status]||['#6B6056','#F4F4F2'];return<div key={c.id} style={{display:'flex',flexDirection:'column',gap:3,padding:'6px 0',borderBottom:'1px solid #F4F4F2',fontSize:11}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontWeight:600}}>{c.co_number||'—'}</span>
                <span style={{color:'#9E9B96'}}>{fD(c.date_submitted||c.date)}</span>
                <span style={{fontFamily:'Inter',fontWeight:700}}>{$(c.amount)}</span>
                <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6B6056'}}>{c.description||''}</span>
                <span style={pill(sc2,sb2)}>{c.status}</span>
                {c.status==='Pending'&&<span style={{display:'flex',gap:4}}>
                  <button onClick={()=>approveCO(c)} style={{background:'#065F46',border:'none',borderRadius:4,padding:'3px 8px',color:'#FFF',fontSize:10,fontWeight:700,cursor:'pointer'}}>Approve</button>
                  <button onClick={()=>rejectCO(c)} style={{background:'#6B6056',border:'none',borderRadius:4,padding:'3px 8px',color:'#FFF',fontSize:10,fontWeight:700,cursor:'pointer'}}>Reject</button>
                </span>}
              </div>
              {c.status==='Approved'&&(c.approved_by||c.date_approved)&&<div style={{fontSize:10,color:'#065F46',paddingLeft:4}}>
                ✓ Approved {c.date_approved?`on ${fD(c.date_approved)}`:''} {c.approved_by?`by ${c.approved_by}`:''}
              </div>}
            </div>;})}
            <div style={{display:'flex',justifyContent:'space-between',marginTop:6,fontSize:11,fontWeight:700}}><span>Approved Total:</span><span style={{color:'#065F46'}}>{$(approvedTotal)}</span></div>
          </div>}
          {coList.length===0&&!showCOForm&&<div style={{fontSize:11,color:'#9E9B96'}}>No change orders</div>}
        </div>
        <button onClick={handleDup} style={{...btnS,fontSize:12}}>Duplicate Project</button>
      </div>}
    </div>);
}

/* ═══ NEW PROJECT FORM ═══ */
const NP_SECS=['info','fence','contract','requirements','schedule','review'];
const NP_LABELS={info:'Job Info',fence:'Fence & Dimensions',contract:'Contract & Billing',requirements:'Requirements',schedule:'Schedule',review:'Review & Submit'};
const AUTO_PM=(mkt,ft)=>{if(mkt==='Austin'||mkt==='Dallas-Fort Worth')return'Doug Monroe';if(mkt==='San Antonio')return'Ray Garcia';if(mkt==='Houston'){if(ft&&(ft.includes('SW')||ft.includes('Wythe')))return'Rafael Anaya Jr.';return'Manuel Salazar';}return'';};
const LINE_TYPES=['Precast','Single Wythe','Wrought Iron','Wood','Gate','Removal','Lump Sum / Other'];
const emptyLineItem=(line_type='Precast')=>({line_type,lf:'',height:'',style:'',color:'',rate:'',quantity:'',description:'',material_type:'',amount:''});
const lineSubtotal=(li)=>{
  const lt=li.line_type;
  if(lt==='Gate')return n(li.quantity)*n(li.rate);
  if(lt==='Lump Sum / Other')return n(li.amount);
  return n(li.lf)*n(li.rate);
};
function NewProjectForm({jobs,onClose,onSaved}){
  const todayISO=new Date().toISOString().split('T')[0];
  const[sec,setSec]=useState('info');const[saving,setSaving]=useState(false);const[saveErr,setSaveErr]=useState(null);
  const emptyF=()=>({job_number:'',job_name:'',customer_name:'',cust_number:'',status:'contract_review',market:'',job_type:'Commercial',sales_rep:'',pm:'',address:'',city:'',state:'TX',zip:'',notes:'',fence_type:'PC',lineItems:[emptyLineItem('Precast')],contract_date:'',billing_method:'Progress',billing_date:'',sales_tax:'',retainage_pct:0,aia_billing:false,bonds:false,certified_payroll:false,ocip_ccip:false,third_party_billing:false,documents_needed:'',file_location:'',included_on_billing_schedule:false,included_on_lf_schedule:false,est_start_date:'',active_entry_date:todayISO});
  const[f,setF]=useState(emptyF);
  const[avgRates,setAvgRates]=useState({});
  const[jnLoading,setJnLoading]=useState(false);
  // 'auto' = generate ##X### from market (commercial); 'manual' internal key = 'Residential' UI label — free-form plain text
  const[jobCodeMode,setJobCodeMode]=useState('auto');
  const genJobNum=async(mkt)=>{if(!mkt)return;setJnLoading(true);try{const num=await getNextJobNumber(mkt);setF(p=>({...p,job_number:num}));}catch(e){console.error('Job number gen failed:',e);}setJnLoading(false);};
  // Only auto-generate on market change when the user hasn't switched to residential mode
  const set=(k,v)=>{setF(p=>{const u={...p,[k]:v};if(k==='market'){u.pm=AUTO_PM(v,u.fence_type);if(jobCodeMode==='auto')genJobNum(v);}if(k==='fence_type')u.pm=AUTO_PM(u.market,v);return u;});};
  const switchJobCodeMode=(mode)=>{
    setJobCodeMode(mode);
    if(mode==='auto'&&f.market){genJobNum(f.market);}
    else if(mode==='manual'){setF(p=>({...p,job_number:''}));}
  };
  // Line item helpers
  const addLineItem=()=>setF(p=>({...p,lineItems:[...p.lineItems,emptyLineItem('Precast')]}));
  const removeLineItem=(idx)=>setF(p=>({...p,lineItems:p.lineItems.length<=1?p.lineItems:p.lineItems.filter((_,i)=>i!==idx)}));
  const updateLineItem=(idx,key,val)=>setF(p=>({...p,lineItems:p.lineItems.map((l,i)=>i===idx?{...l,[key]:val}:l)}));
  // Fetch avg rates when market changes
  useEffect(()=>{if(!f.market)return;const mj=jobs.filter(j=>j.market===f.market);const avg=(field)=>{const valid=mj.filter(j=>n(j[field])>0);return valid.length?Math.round(valid.reduce((s,j)=>s+n(j[field]),0)/valid.length*100)/100:0;};setAvgRates({contract_rate_precast:avg('contract_rate_precast'),contract_rate_single_wythe:avg('contract_rate_single_wythe'),contract_rate_wrought_iron:avg('contract_rate_wrought_iron'),gate_rate:avg('gate_rate')});},[f.market,jobs]);
  const fLbl=(l,req)=>(<label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>{l}{req&&<span style={{color:'#991B1B'}}> *</span>}</label>);
  // Auto-calc from line items
  const ncv=f.lineItems.reduce((s,li)=>s+lineSubtotal(li),0);
  const stax=n(f.sales_tax);const cv=ncv+stax;const acv=cv;
  const totalLF=f.lineItems.reduce((s,li)=>{
    if(['Precast','Single Wythe','Wrought Iron','Wood','Removal'].includes(li.line_type))return s+n(li.lf);
    if(li.line_type==='Lump Sum / Other')return s+n(li.lf);
    return s;
  },0);
  // Derive legacy aggregate fields from line items for back-compat with existing jobs-table schema
  const lineAgg=useMemo(()=>{
    const a={lf_precast:0,height_precast:null,style:null,color:null,contract_rate_precast:null,lf_single_wythe:0,height_single_wythe:null,style_single_wythe:null,contract_rate_single_wythe:null,lf_wrought_iron:0,height_wrought_iron:null,contract_rate_wrought_iron:null,lf_removal:0,height_removal:null,removal_material_type:null,contract_rate_removal:null,lf_other:0,contract_rate_other:null,number_of_gates:0,gate_height:null,gate_description:null,gate_rate:null,lump_sum_amount:0,lump_sum_description:null};
    f.lineItems.forEach(li=>{
      if(li.line_type==='Precast'){a.lf_precast+=n(li.lf);if(a.height_precast==null)a.height_precast=li.height||null;if(a.style==null)a.style=li.style||null;if(a.color==null)a.color=li.color||null;if(a.contract_rate_precast==null)a.contract_rate_precast=n(li.rate)||null;}
      else if(li.line_type==='Single Wythe'){a.lf_single_wythe+=n(li.lf);if(a.height_single_wythe==null)a.height_single_wythe=li.height||null;if(a.style_single_wythe==null)a.style_single_wythe=li.style||null;if(a.contract_rate_single_wythe==null)a.contract_rate_single_wythe=n(li.rate)||null;}
      else if(li.line_type==='Wrought Iron'){a.lf_wrought_iron+=n(li.lf);if(a.height_wrought_iron==null)a.height_wrought_iron=li.height||null;if(a.contract_rate_wrought_iron==null)a.contract_rate_wrought_iron=n(li.rate)||null;}
      else if(li.line_type==='Wood'){a.lf_other+=n(li.lf);if(a.contract_rate_other==null)a.contract_rate_other=n(li.rate)||null;}
      else if(li.line_type==='Removal'){a.lf_removal+=n(li.lf);if(a.height_removal==null)a.height_removal=li.height||null;if(a.removal_material_type==null)a.removal_material_type=li.material_type||null;if(a.contract_rate_removal==null)a.contract_rate_removal=n(li.rate)||null;}
      else if(li.line_type==='Gate'){a.number_of_gates+=n(li.quantity);if(a.gate_height==null)a.gate_height=li.height||null;if(a.gate_description==null)a.gate_description=li.description||null;if(a.gate_rate==null)a.gate_rate=n(li.rate)||null;}
      else if(li.line_type==='Lump Sum / Other'){a.lump_sum_amount+=n(li.amount);if(a.lump_sum_description==null)a.lump_sum_description=li.description||null;}
    });
    return a;
  },[f.lineItems]);
  // Derive fence_type from line item types
  const derivedFenceType=useMemo(()=>{
    const types=new Set();
    f.lineItems.forEach(l=>{
      if(l.line_type==='Precast')types.add('PC');
      else if(l.line_type==='Single Wythe')types.add('SW');
      else if(l.line_type==='Wrought Iron')types.add('WI');
      else if(l.line_type==='Wood')types.add('Wood');
      else if(l.line_type==='Gate')types.add('Gates');
    });
    return[...types].join('/')||f.fence_type||'PC';
  },[f.lineItems,f.fence_type]);
  // Map a UI line item to the job_line_items DB row shape
  const toDBLineItem=(li,idx,jobRow)=>{
    const base={job_id:jobRow.id,job_number:jobRow.job_number,line_number:idx+1};
    const lt=li.line_type;
    if(lt==='Precast')return{...base,fence_type:'PC',lf:n(li.lf),height:li.height?String(li.height):null,style:li.style||null,color:li.color||null,contract_rate:n(li.rate),description:null,is_produced:true};
    if(lt==='Single Wythe')return{...base,fence_type:'SW',lf:n(li.lf),height:li.height?String(li.height):null,style:li.style||null,color:li.color||null,contract_rate:n(li.rate),description:null,is_produced:false};
    if(lt==='Wrought Iron')return{...base,fence_type:'WI',lf:n(li.lf),height:li.height?String(li.height):null,style:li.style||null,color:null,contract_rate:n(li.rate),description:null,is_produced:false};
    if(lt==='Wood')return{...base,fence_type:'Wood',lf:n(li.lf),height:li.height?String(li.height):null,style:li.style||null,color:null,contract_rate:n(li.rate),description:null,is_produced:false};
    if(lt==='Gate')return{...base,fence_type:'Other',lf:n(li.quantity),height:li.height?String(li.height):null,style:null,color:null,contract_rate:n(li.rate),description:`GATE: ${li.description||''}`.trim(),is_produced:false};
    if(lt==='Removal')return{...base,fence_type:'Other',lf:n(li.lf),height:li.height?String(li.height):null,style:null,color:null,contract_rate:n(li.rate),description:`REMOVAL: ${li.material_type||''}`.trim(),is_produced:false};
    if(lt==='Lump Sum / Other')return{...base,fence_type:'Other',lf:n(li.lf)||1,height:null,style:null,color:null,contract_rate:n(li.rate)||n(li.amount),description:`LUMP SUM: ${li.description||''}`.trim(),is_produced:false};
    return null;
  };
  const missing=[];if(!f.job_name)missing.push('Job Name');if(!f.customer_name)missing.push('Customer Name');if(!f.market)missing.push('Market');
  const submit=async()=>{
    if(missing.length){setSaveErr(`Missing required fields: ${missing.join(', ')}`);return;}
    setSaving(true);
    setSaveErr(null);
    try{
      // Build the job row body
      const body={...f,...lineAgg,fence_type:derivedFenceType,net_contract_value:ncv,contract_value:cv,adj_contract_value:acv,sales_tax:stax,retainage_pct:n(f.retainage_pct),total_lf:totalLF,ytd_invoiced:0,pct_billed:0,left_to_bill:acv,change_orders:0};
      delete body.lineItems;delete body.id;delete body.created_at;delete body.updated_at;
      // Sanitize empty-string date fields — PostgREST rejects '' for date columns
      ['contract_date','est_start_date','active_entry_date','billing_date','complete_date','last_billed'].forEach(k=>{if(body[k]==='')body[k]=null;});
      // Coerce optional text-ish fields that were empty strings to null (safer than empty strings for nullable columns)
      ['job_number','address','city','zip','notes','file_location','documents_needed','gate_description','lump_sum_description','pm','sales_rep'].forEach(k=>{if(body[k]==='')body[k]=null;});
      body.fence_addons=syncFenceAddons(body);
      // Filter out line items that have no meaningful data — user may add an empty row and not fill it
      const filled=f.lineItems.filter(li=>{
        const lt=li.line_type;
        if(lt==='Gate')return n(li.quantity)>0||n(li.rate)>0||(li.description||'').trim();
        if(lt==='Lump Sum / Other')return n(li.amount)>0||n(li.rate)>0||(li.description||'').trim();
        return n(li.lf)>0||n(li.rate)>0;
      });
      // STEP 1 — Insert the jobs row with explicit fetch + response.ok check so errors surface clearly
      const jobRes=await fetch(`${SB}/rest/v1/jobs`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(body)});
      const jobTxt=await jobRes.text();
      if(!jobRes.ok){
        // Try to extract a useful error message from PostgREST's JSON error body
        let msg=`Job insert failed (${jobRes.status})`;
        try{const err=JSON.parse(jobTxt);msg=err.message||err.hint||err.details||msg;}catch(_){if(jobTxt)msg=jobTxt.slice(0,200);}
        throw new Error(msg);
      }
      const saved=jobTxt?JSON.parse(jobTxt):[];
      if(!saved||!saved[0]||!saved[0].id){
        throw new Error('Job created but no row was returned from Supabase. Check PostgREST Prefer header.');
      }
      const jobRow=saved[0];
      // STEP 2 — Insert line items with the new job_id (failures here do NOT roll back the job —
      // the user can add/edit line items from the Edit Panel if this batch fails)
      let liWarning=null;
      if(filled.length>0){
        const dbItems=filled.map((li,i)=>toDBLineItem(li,i,jobRow)).filter(Boolean);
        if(dbItems.length>0){
          try{
            const liRes=await fetch(`${SB}/rest/v1/job_line_items`,{method:'POST',headers:H,body:JSON.stringify(dbItems)});
            if(!liRes.ok){
              const liTxt=await liRes.text();
              console.error('[NewProject] line items POST failed:',liRes.status,liTxt);
              liWarning=`Job saved, but line items failed: ${liTxt.slice(0,150)}. Edit the project to add them.`;
            }
          }catch(liErr){
            console.error('[NewProject] line items save threw:',liErr);
            liWarning=`Job saved, but line items failed: ${liErr.message}. Edit the project to add them.`;
          }
        }
      }
      // STEP 3 — Post-save side effects
      fireAlert('new_job',jobRow);
      logAct(jobRow,'job_created','','',jobRow.job_number||jobRow.job_name);
      fireNewProjectEmail(jobRow);
      setSaving(false);
      // If a non-blocking line-items warning fired, show it for 3 seconds before closing.
      if(liWarning){
        setSaveErr(liWarning);
        setTimeout(()=>onSaved(`Project ${f.job_name} created (with warnings)`),3000);
      }else{
        onSaved(`Project ${f.job_name} created`);
      }
    }catch(e){
      console.error('[NewProject] save failed:',e);
      setSaveErr(e.message||'Save failed — check console for details');
      setSaving(false);
      // Do NOT call onSaved — keep the form open so the user can fix and retry
    }
  };
  const secIdx=NP_SECS.indexOf(sec)+1;
  const grd='repeat(auto-fill,minmax(220px,1fr))';
  const rateHint=(field)=>avgRates[field]?`Avg ${f.market}: $${avgRates[field].toFixed(2)}/LF`:'';
  return(<div style={{position:'fixed',inset:0,background:'#F4F4F2',zIndex:250,display:'flex',flexDirection:'column'}}>
    {/* Header */}
    <div style={{padding:'12px 24px',background:'#FFF',borderBottom:'1px solid #E5E3E0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
      <div><div style={{fontFamily:'Syne',fontSize:18,fontWeight:900,color:'#8B2020'}}>New Project</div><div style={{fontSize:11,color:'#9E9B96'}}>Section {secIdx} of {NP_SECS.length} — {NP_LABELS[sec]}</div></div>
      <div style={{display:'flex',gap:8}}><button onClick={onClose} style={btnS}>Cancel</button></div>
    </div>
    {/* Progress bar */}
    <div style={{height:3,background:'#E5E3E0',flexShrink:0}}><div style={{height:'100%',background:'#8B2020',width:`${secIdx/NP_SECS.length*100}%`,transition:'width .3s'}}/></div>
    {/* Section tabs */}
    <div style={{display:'flex',gap:4,padding:'10px 24px',background:'#FFF',borderBottom:'1px solid #E5E3E0',flexShrink:0,flexWrap:'wrap'}}>{NP_SECS.map(s=><button key={s} onClick={()=>setSec(s)} style={{padding:'6px 14px',borderRadius:8,border:sec===s?'1px solid #8B2020':'1px solid #E5E3E0',background:sec===s?'#8B2020':'#FFF',color:sec===s?'#fff':'#6B6056',fontSize:12,fontWeight:600,cursor:'pointer'}}>{NP_LABELS[s]}</button>)}</div>
    {/* Body */}
    <div style={{flex:1,overflow:'auto',padding:'20px 24px'}}>
      {/* Sticky Contract Summary — visible on fence & contract sections */}
      {(sec==='fence'||sec==='contract')&&<div style={{position:'sticky',top:0,zIndex:5,marginBottom:16,background:'#1A1A1A',borderRadius:10,padding:'12px 20px',color:'#fff',display:'flex',gap:20,alignItems:'center',flexWrap:'wrap',boxShadow:'0 4px 12px rgba(0,0,0,.15)'}}>
        <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Net Contract</div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{$(ncv)}</div></div>
        <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Sales Tax</div><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14}}>{stax?$(stax):'Exempt'}</div></div>
        <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Contract Value</div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{$(cv)}</div></div>
        <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Change Orders</div><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14}}>$0</div></div>
        <div style={{marginLeft:'auto'}}><div style={{fontSize:9,color:'#10B981',textTransform:'uppercase',fontWeight:700}}>Adj Contract Value</div><div style={{fontFamily:'Inter',fontWeight:900,fontSize:22,color:'#10B981'}}>{$(acv)}</div></div>
        <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Total LF</div><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14}}>{totalLF.toLocaleString()}</div></div>
      </div>}
      {sec==='info'&&<div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
            {fLbl('Job Code')}
            <div style={{display:'inline-flex',border:'1px solid #E5E3E0',borderRadius:6,overflow:'hidden',marginBottom:4}}>
              <button type="button" onClick={()=>switchJobCodeMode('auto')} title="Auto-generate commercial job code (e.g. 26H017)" style={{padding:'3px 10px',border:'none',background:jobCodeMode==='auto'?'#8B2020':'#FFF',color:jobCodeMode==='auto'?'#FFF':'#6B6056',fontSize:10,fontWeight:700,cursor:'pointer'}}>Auto</button>
              <button type="button" onClick={()=>switchJobCodeMode('manual')} title="Residential entry — plain-number job code (e.g. 10167)" style={{padding:'3px 10px',border:'none',borderLeft:'1px solid #E5E3E0',background:jobCodeMode==='manual'?'#8B2020':'#FFF',color:jobCodeMode==='manual'?'#FFF':'#6B6056',fontSize:10,fontWeight:700,cursor:'pointer'}}>Residential</button>
            </div>
          </div>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            <input value={f.job_number} onChange={e=>set('job_number',e.target.value)} placeholder={jobCodeMode==='auto'?(jnLoading?'Generating...':'e.g. 26H017'):'e.g. 10167'} style={{...inputS,flex:1}}/>
            {jobCodeMode==='auto'&&f.market&&<button type="button" onClick={()=>genJobNum(f.market)} title="Regenerate job number" style={{background:'none',border:'1px solid #D1CEC9',borderRadius:6,padding:'6px 8px',cursor:'pointer',fontSize:14,color:'#6B6056',lineHeight:1}} disabled={jnLoading}>↻</button>}
          </div>
          {jobCodeMode==='auto'&&f.job_number&&f.market&&<div style={{fontSize:10,color:'#10B981',marginTop:2}}>Auto-generated — edit if needed</div>}
          {jobCodeMode==='manual'&&<div style={{fontSize:10,color:'#6B6056',marginTop:2}}>Residential entry — type any job code</div>}
        </div>
        <div>{fLbl('Job Name',true)}<input value={f.job_name} onChange={e=>set('job_name',e.target.value)} style={inputS}/></div>
        <div>{fLbl('Customer Name',true)}<input value={f.customer_name} onChange={e=>set('customer_name',e.target.value)} style={inputS}/></div>
        <div>{fLbl('Cust #')}<input value={f.cust_number} onChange={e=>set('cust_number',e.target.value)} style={inputS}/></div>
        <div>{fLbl('Status')}<select value={f.status} onChange={e=>set('status',e.target.value)} style={inputS}>{[['contract_review','Contract Review'],['production_queue','Production Queue'],['in_production','In Production'],['inventory_ready','Inventory (Ready to Install)'],['active_install','Active Install'],['fence_complete','Fence Complete'],['fully_complete','Fully Complete'],['closed','Closed']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        <div>{fLbl('Market',true)}<select value={f.market} onChange={e=>set('market',e.target.value)} style={inputS}><option value="">— Select —</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
        <div>{fLbl('Job Type')}<select value={f.job_type} onChange={e=>set('job_type',e.target.value)} style={inputS}>{['Commercial','Residential','Government','Municipal/MUD'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
        <div>{fLbl('Sales Rep')}<select value={f.sales_rep} onChange={e=>set('sales_rep',e.target.value)} style={inputS}><option value="">— Select —</option>{REPS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
        <div>{fLbl('Project Manager')}<select value={f.pm} onChange={e=>set('pm',e.target.value)} style={inputS}><option value="">— Auto-assigned —</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>{f.pm&&<div style={{fontSize:10,color:'#065F46',marginTop:2}}>Assigned: {f.pm}</div>}</div>
        <div>{fLbl('Address')}<input value={f.address} onChange={e=>set('address',e.target.value)} style={inputS}/></div>
        <div>{fLbl('City')}<input value={f.city} onChange={e=>set('city',e.target.value)} style={inputS}/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}><div>{fLbl('State')}<input value={f.state} onChange={e=>set('state',e.target.value)} style={inputS}/></div><div>{fLbl('ZIP')}<input value={f.zip} onChange={e=>set('zip',e.target.value)} style={inputS}/></div></div>
        <div style={{gridColumn:'1/-1'}}>{fLbl('Notes')}<textarea value={f.notes} onChange={e=>set('notes',e.target.value)} rows={3} style={{...inputS,resize:'vertical'}}/></div>
      </div>}
      {sec==='fence'&&<div>
        <div style={{marginBottom:14,fontSize:12,color:'#6B6056'}}>Add one or more line items to build the contract. Each line represents a discrete scope — LF of fence, gates, removal, or lump sum.</div>
        {f.lineItems.map((li,idx)=>{
          const sub=lineSubtotal(li);
          const u=(k,v)=>updateLineItem(idx,k,v);
          const lt=li.line_type;
          const isLFType=['Precast','Single Wythe','Wrought Iron','Wood','Removal'].includes(lt);
          return<div key={idx} style={{background:'#FAFAFA',border:'1px solid #E5E3E0',borderRadius:10,padding:14,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <span style={{fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,background:'#FDF4F4',padding:'3px 8px',borderRadius:4,border:'1px solid #8B202030'}}>Line {idx+1}</span>
                <select value={lt} onChange={e=>u('line_type',e.target.value)} style={{...inputS,width:200,fontWeight:700,fontSize:13}}>
                  {LINE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'#8B2020'}}>{$(sub)}</span>
                {f.lineItems.length>1&&<button onClick={()=>removeLineItem(idx)} style={{background:'none',border:'1px solid #DC2626',borderRadius:6,padding:'4px 10px',color:'#DC2626',fontSize:11,fontWeight:700,cursor:'pointer'}}>× Remove</button>}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
              {(lt==='Precast'||lt==='Single Wythe')&&<>
                <div>{fLbl('LF')}<input type="number" value={li.lf} onChange={e=>u('lf',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Height (ft)')}<input type="number" value={li.height} onChange={e=>u('height',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Style')}<select value={li.style||''} onChange={e=>u('style',e.target.value)} style={inputS}><option value="">— Select —</option>{DD.style.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
                <div>{fLbl('Color')}<select value={li.color||''} onChange={e=>u('color',e.target.value)} style={inputS}><option value="">— Select —</option>{STANDARD_COLORS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                <div>{fLbl('Rate ($/LF)')}<input type="number" value={li.rate} onChange={e=>u('rate',e.target.value)} placeholder={lt==='Precast'?rateHint('contract_rate_precast'):rateHint('contract_rate_single_wythe')} style={inputS}/></div>
              </>}
              {(lt==='Wrought Iron'||lt==='Wood')&&<>
                <div>{fLbl('LF')}<input type="number" value={li.lf} onChange={e=>u('lf',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Height (ft)')}<input type="number" value={li.height} onChange={e=>u('height',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Style')}<input value={li.style} onChange={e=>u('style',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Rate ($/LF)')}<input type="number" value={li.rate} onChange={e=>u('rate',e.target.value)} placeholder={lt==='Wrought Iron'?rateHint('contract_rate_wrought_iron'):''} style={inputS}/></div>
              </>}
              {lt==='Gate'&&<>
                <div>{fLbl('Quantity')}<input type="number" value={li.quantity} onChange={e=>u('quantity',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Gate Height (ft)')}<input type="number" value={li.height} onChange={e=>u('height',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Gate Description')}<input value={li.description} onChange={e=>u('description',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Rate ($) each')}<input type="number" value={li.rate} onChange={e=>u('rate',e.target.value)} placeholder={rateHint('gate_rate')} style={inputS}/></div>
              </>}
              {lt==='Removal'&&<>
                <div>{fLbl('LF')}<input type="number" value={li.lf} onChange={e=>u('lf',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Height (ft)')}<input type="number" value={li.height} onChange={e=>u('height',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Material Type')}<input value={li.material_type} onChange={e=>u('material_type',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Rate ($/LF)')}<input type="number" value={li.rate} onChange={e=>u('rate',e.target.value)} style={inputS}/></div>
              </>}
              {lt==='Lump Sum / Other'&&<>
                <div>{fLbl('Amount ($)')}<input type="number" value={li.amount} onChange={e=>u('amount',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Description')}<input value={li.description} onChange={e=>u('description',e.target.value)} style={inputS}/></div>
                <div>{fLbl('LF (optional)')}<input type="number" value={li.lf} onChange={e=>u('lf',e.target.value)} style={inputS}/></div>
                <div>{fLbl('Rate ($/LF) (optional)')}<input type="number" value={li.rate} onChange={e=>u('rate',e.target.value)} style={inputS}/></div>
              </>}
            </div>
            {isLFType&&n(li.lf)>0&&n(li.rate)>0&&<div style={{marginTop:8,textAlign:'right',fontSize:11,color:'#6B6056'}}>{n(li.lf).toLocaleString()} LF × ${n(li.rate)}/LF = <b style={{color:'#8B2020'}}>{$(sub)}</b></div>}
            {lt==='Gate'&&n(li.quantity)>0&&n(li.rate)>0&&<div style={{marginTop:8,textAlign:'right',fontSize:11,color:'#6B6056'}}>{n(li.quantity)} × {$(n(li.rate))} = <b style={{color:'#8B2020'}}>{$(sub)}</b></div>}
          </div>;
        })}
        <button onClick={addLineItem} style={{width:'100%',padding:'12px',border:'1px dashed #8B2020',background:'#FDF4F4',color:'#8B2020',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',marginTop:6}}>+ Add Line Item</button>
      </div>}
      {sec==='contract'&&<div>
        <div style={{display:'grid',gridTemplateColumns:grd,gap:12,marginBottom:20}}>
          <div>{fLbl('Contract Date')}<input type="date" value={f.contract_date} onChange={e=>set('contract_date',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Billing Method')}<select value={f.billing_method} onChange={e=>set('billing_method',e.target.value)} style={inputS}>{['Progress','Lump Sum','Milestone','AIA','T&M'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div>{fLbl('Billing Date')}<input value={f.billing_date} onChange={e=>set('billing_date',e.target.value)} placeholder="e.g. 25th of month" style={inputS}/></div>
          <div>{fLbl('Sales Tax ($)')}<input type="number" value={f.sales_tax} onChange={e=>set('sales_tax',e.target.value)} placeholder="0" style={inputS}/></div>
          <div>{fLbl('Retainage %')}<input type="number" value={f.retainage_pct} onChange={e=>set('retainage_pct',e.target.value)} placeholder="0" style={inputS}/></div>
        </div>
        <div style={{background:'#1A1A1A',borderRadius:12,padding:20,color:'#fff'}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,color:'#9E9B96',marginBottom:12}}>Auto-Calculated Contract Summary</div>
          {[['Net Contract Value',$(ncv)],['Sales Tax',stax?$(stax):'Exempt'],['Contract Value',$(cv)],['Change Orders','$0'],['Adj Contract Value',$(acv)],['Total LF',totalLF.toLocaleString()],['Retainage',n(f.retainage_pct)+'%']].map(([l,v])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #333',fontSize:l==='Adj Contract Value'?16:13}}><span style={{color:l==='Adj Contract Value'?'#10B981':'#9E9B96',fontWeight:l==='Adj Contract Value'?700:400}}>{l}</span><span style={{fontFamily:'Inter',fontWeight:l==='Adj Contract Value'?900:700,color:l==='Adj Contract Value'?'#10B981':'#fff'}}>{v}</span></div>)}
        </div>
      </div>}
      {sec==='requirements'&&<div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
          {[['AIA (G702/703)','aia_billing'],['Bonds','bonds'],['Certified Payroll','certified_payroll'],['OCIP/CCIP','ocip_ccip'],['3rd Party Billing','third_party_billing'],['Included on Billing Schedule','included_on_billing_schedule'],['Included on LF Schedule','included_on_lf_schedule']].map(([l,k])=><label key={k} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',background:'#F9F8F6',borderRadius:8,border:'1px solid #E5E3E0',cursor:'pointer',fontSize:13}}>
            <input type="checkbox" checked={!!f[k]} onChange={e=>set(k,e.target.checked)} style={{width:18,height:18,accentColor:'#8B2020'}}/>{l}
          </label>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>{fLbl('Documents Needed')}<input value={f.documents_needed} onChange={e=>set('documents_needed',e.target.value)} style={inputS}/></div>
          <div>{fLbl('File Location')}<input value={f.file_location} onChange={e=>set('file_location',e.target.value)} style={inputS}/></div>
        </div>
      </div>}
      {sec==='schedule'&&<div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
        <div>{fLbl('Est. Start Date')}<input type="date" value={f.est_start_date} onChange={e=>set('est_start_date',e.target.value)} style={inputS}/></div>
        <div>{fLbl('Active Entry Date')}<input type="date" value={f.active_entry_date} onChange={e=>set('active_entry_date',e.target.value)} style={inputS}/></div>
        <div>{fLbl('Contract Age')}<div style={{...inputS,background:'#F9F8F6',color:'#6B6056'}}>{f.contract_date?Math.round((Date.now()-new Date(f.contract_date).getTime())/86400000)+' days':'—'}</div></div>
      </div>}
      {sec==='review'&&<div>
        {missing.length>0&&<div style={{background:'#FEE2E2',border:'1px solid #991B1B30',borderRadius:8,padding:'10px 14px',fontSize:12,fontWeight:600,color:'#991B1B',marginBottom:16}}>Missing required fields: {missing.join(', ')}</div>}
        {saveErr&&<div style={{background:'#FEE2E2',border:'1px solid #DC2626',borderRadius:8,padding:'12px 16px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div style={{fontSize:12,fontWeight:800,color:'#991B1B',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>⚠ Save failed</div>
            <div style={{fontSize:13,color:'#991B1B',fontWeight:600,lineHeight:1.5,wordBreak:'break-word'}}>{saveErr}</div>
          </div>
          <button onClick={()=>setSaveErr(null)} style={{background:'none',border:'none',color:'#991B1B',fontSize:18,cursor:'pointer',padding:0,lineHeight:1,flexShrink:0}}>×</button>
        </div>}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {[{t:'Job Info',items:[['Job Code',f.job_number],['Job Name',f.job_name],['Customer',f.customer_name],['Market',f.market],['PM',f.pm],['Sales Rep',f.sales_rep],['Status',SL[f.status]||f.status]]},{t:'Fence',items:[['Type',derivedFenceType],['Line Items',f.lineItems.length],['Total LF',totalLF.toLocaleString()],['Gates',lineAgg.number_of_gates||'0']]},{t:'Contract',items:[['Net Value',$(ncv)],['Sales Tax',stax?$(stax):'Exempt'],['Contract Value',$(cv)],['Adj Contract Value',$(acv)],['Left to Bill',$(acv)],['Billing Method',f.billing_method],['Retainage',n(f.retainage_pct)+'%']]},{t:'Schedule',items:[['Est Start',fD(f.est_start_date)],['Contract Date',fD(f.contract_date)]]}].map(g=><div key={g.t} style={{...card,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:'#8B2020',textTransform:'uppercase',marginBottom:8}}>{g.t}</div>
            {g.items.map(([l,v])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:12,borderBottom:'1px solid #F4F4F2'}}><span style={{color:'#6B6056'}}>{l}</span><span style={{fontWeight:600,color:v?'#1A1A1A':'#991B1B'}}>{v||'Missing'}</span></div>)}
          </div>)}
        </div>
        <div style={{display:'flex',gap:8,marginTop:20}}><button onClick={()=>setSec('schedule')} style={btnS}>← Go Back</button><button onClick={submit} disabled={saving||missing.length>0} style={{...btnP,flex:1,padding:'14px 0',fontSize:16,opacity:saving||missing.length>0?0.5:1}}>{saving?'Creating...':'Create Project'}</button></div>
      </div>}
    </div>
    {/* Bottom nav for non-review sections */}
    {sec!=='review'&&<div style={{padding:'12px 24px',background:'#FFF',borderTop:'1px solid #E5E3E0',display:'flex',justifyContent:'space-between',flexShrink:0}}>
      <button onClick={()=>{const i=NP_SECS.indexOf(sec);if(i>0)setSec(NP_SECS[i-1]);}} disabled={sec==='info'} style={{...btnS,opacity:sec==='info'?0.3:1}}>← Previous</button>
      <button onClick={()=>{const i=NP_SECS.indexOf(sec);if(i<NP_SECS.length-1)setSec(NP_SECS[i+1]);}} style={btnP}>Next →</button>
    </div>}
  </div>);
}

/* ═══ GLOBAL SEARCH ═══ */
function GlobalSearch({jobs,onSelect}){
  const[q,setQ]=useState('');const[open,setOpen]=useState(false);const ref=useRef();
  useEffect(()=>{const h=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setOpen(true);setTimeout(()=>ref.current?.focus(),50);}if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);},[]);
  const results=useMemo(()=>{if(!q||q.length<2)return[];const lq=q.toLowerCase();return jobs.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name} ${j.address} ${j.notes}`.toLowerCase().includes(lq)).slice(0,8);},[q,jobs]);
  const pick=j=>{onSelect(j);setQ('');setOpen(false);};
  if(!open)return null;
  return(<div style={{position:'fixed',inset:0,zIndex:500,background:'rgba(0,0,0,0.2)'}} onClick={()=>setOpen(false)}><div onClick={e=>e.stopPropagation()} style={{position:'absolute',top:60,left:'50%',transform:'translateX(-50%)',width:460,background:'#FFF',borderRadius:12,border:'1px solid #E5E3E0',boxShadow:'0 8px 30px rgba(0,0,0,0.15)',overflow:'hidden'}}>
    <div style={{display:'flex',alignItems:'center',padding:'12px 16px',borderBottom:'1px solid #E5E3E0'}}><span style={{color:'#9E9B96',marginRight:8}}>⌕</span><input ref={ref} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search projects... (Esc to close)" style={{flex:1,border:'none',outline:'none',fontSize:14,color:'#1A1A1A',background:'transparent'}} onKeyDown={e=>{if(e.key==='Enter'&&results[0])pick(results[0]);if(e.key==='Escape')setOpen(false);}}/>{q&&<button onClick={()=>setQ('')} style={{background:'none',border:'none',color:'#9E9B96',cursor:'pointer',fontSize:16}}>×</button>}</div>
    {q.length>=2&&<div style={{maxHeight:320,overflow:'auto'}}>{results.length===0?<div style={{padding:20,textAlign:'center',color:'#9E9B96'}}>No results</div>:results.map(j=><div key={j.id} onClick={()=>pick(j)} style={{padding:'10px 16px',cursor:'pointer',borderBottom:'1px solid #F4F4F2',display:'flex',gap:8,alignItems:'center'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{j.job_name}</div><div style={{fontSize:11,color:'#6B6056'}}>#{j.job_number} · {j.customer_name}</div></div><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]}</span></div>)}</div>}
  </div></div>);
}

/* ═══ WEEKLY DIGEST ═══ */
function WeeklyDigest({jobs,active}){
  const[sending,setSending]=useState(false);const[lastSent,setLastSent]=useState(null);const[digestStats,setDigestStats]=useState(null);
  useEffect(()=>{
    const tl=active.reduce((s,j)=>s+n(j.left_to_bill),0);
    const zeroBilled=active.filter(j=>n(j.ytd_invoiced)===0).length;
    const now=new Date();const weekAgo=new Date(now.getTime()-7*86400000).toISOString();
    const weekAgoDate=weekAgo.split('T')[0];
    const newJobs=jobs.filter(j=>j.created_at&&j.created_at>=weekAgo).length;
    const compJobs=jobs.filter(j=>j.complete_date&&j.complete_date>=weekAgoDate).length;
    Promise.all([
      sbGet('weather_days',`weather_date=gte.${weekAgoDate}&select=id`).catch(()=>[]),
      sbGet('change_orders',`status=eq.Pending&select=id`).catch(()=>[]),
      sbGet('production_removals',`removed_date=gte.${weekAgoDate}&select=reason`).catch(()=>[]),
    ]).then(([wd,co,rem])=>{
      // Compute top reason from removals
      const reasonCounts={};(rem||[]).forEach(r=>{const k=r.reason||'Unspecified';reasonCounts[k]=(reasonCounts[k]||0)+1;});
      let topReason=null,topCount=0;Object.entries(reasonCounts).forEach(([k,c])=>{if(c>topCount){topReason=k;topCount=c;}});
      setDigestStats({leftToBill:tl,zeroBilled,weatherDays:(wd||[]).length,pendingCO:(co||[]).length,newJobs,compJobs,productionRemovals:{count:(rem||[]).length,topReason}});
    });
  },[jobs,active]);
  const sendDigest=async()=>{setSending(true);try{
    await fetch(`${SB}/functions/v1/billing-alerts`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${KEY}`},body:JSON.stringify(digestStats?{productionRemovals:digestStats.productionRemovals}:{})});
    setLastSent(new Date().toLocaleString());
  }catch(e){}setSending(false);};
  const pr=digestStats?.productionRemovals;
  return(<div style={card}>
    <div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Weekly Digest</div>
    {digestStats&&<div style={{marginBottom:12}}>
      {[['Total Left to Bill',$(digestStats.leftToBill)],['Jobs with 0% billed (active)',digestStats.zeroBilled+' jobs'],['Weather days logged this week',digestStats.weatherDays],['Change orders pending approval',digestStats.pendingCO],['New jobs added this week',digestStats.newJobs],['Jobs completed this week',digestStats.compJobs]].map(([l,v])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}><span style={{color:'#6B6056'}}>{l}</span><span style={{fontWeight:700}}>{v}</span></div>)}
      <div style={{padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between'}}>
          <span style={{color:'#6B6056'}}>Jobs pulled from production this week</span>
          <span style={{fontWeight:700,color:pr&&pr.count>0?'#B45309':'#1A1A1A'}}>{pr?pr.count:0}</span>
        </div>
        {pr&&pr.count>0&&pr.topReason&&<div style={{fontSize:10,color:'#9E9B96',fontStyle:'italic',marginTop:2}}>Most common: {pr.topReason}</div>}
      </div>
    </div>}
    <div style={{fontSize:11,color:'#9E9B96',marginBottom:8}}>Recipients: david@fencecrete.com, alex@fencecrete.com</div>
    {lastSent&&<div style={{fontSize:11,color:'#065F46',marginBottom:8}}>Last sent: {lastSent}</div>}
    <button onClick={sendDigest} disabled={sending} style={{...btnP,width:'100%',opacity:sending?0.5:1}}>{sending?'Sending...':'Send Digest Now'}</button>
  </div>);
}

/* ═══ DASHBOARD ═══ */
function Dashboard({jobs,onNav,refreshKey=0}){
  const[showRemindConfirm,setShowRemindConfirm]=useState(false);
  const[remindSending,setRemindSending]=useState(false);
  const[dashToast,setDashToast]=useState(null);
  const sendReminders=async()=>{setRemindSending(true);setShowRemindConfirm(false);try{const res=await fetch(`${SB}/functions/v1/bill-sheet-reminder`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'}});const txt=await res.text();console.log('[Reminders] status=',res.status,'response=',txt);if(!res.ok)throw new Error(txt);const data=txt?JSON.parse(txt):{};setDashToast({msg:`Reminders sent! ${data.remindersSent||0} PMs notified, ${data.totalMissing||0} jobs missing. AR summary sent to david@fencecrete.com`,ok:true});}catch(e){console.error('[Reminders] Error:',e);setDashToast({msg:e.message||'Failed to send reminders',ok:false});}setRemindSending(false);};
  const active=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  const closedJobs=useMemo(()=>jobs.filter(j=>j.status==='closed'),[jobs]);
  const closedCV=closedJobs.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);
  const allBillable=useMemo(()=>jobs.filter(j=>j.status!=='cancelled'&&j.status!=='lost'),[jobs]);
  const tc=allBillable.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const tl=allBillable.reduce((s,j)=>s+n(j.left_to_bill),0);const ty=allBillable.reduce((s,j)=>s+n(j.ytd_invoiced),0);const BACKLOG_STS=new Set(['contract_review','production_queue','in_production','inventory_ready','active_install']);const tlfPC=jobs.filter(j=>BACKLOG_STS.has(j.status)).reduce((s,j)=>s+lfPC(j),0);const tlf=jobs.filter(j=>BACKLOG_STS.has(j.status)).reduce((s,j)=>s+lfTotal(j),0);
  // Backlog months + market breakdown (shown inside Backlog LF card)
  const blCurrentMo=new Date().getMonth()+1;
  const blRunRate=blCurrentMo>0?ty/blCurrentMo:0;
  const blMonths=blRunRate>0?tl/blRunRate:0;
  const blColor=blMonths>=4?'#065F46':blMonths>=2?'#B45309':'#991B1B';
  const blMktLTB=MKTS.map(m=>{const mj=active.filter(j=>j.market===m);return{name:MS[m],market:m,ltb:mj.reduce((s,j)=>s+n(j.left_to_bill),0)};});
  const blMktTotal=blMktLTB.reduce((s,m)=>s+m.ltb,0);
  // 2026 Revenue Goal — includes closed jobs (money already earned)
  const GOAL_2026=36000000;
  const ytd2026=ty;
  const pct2026=Math.min(ytd2026/GOAL_2026,1);
  const achieved2026=ytd2026>=GOAL_2026;
  const remaining2026=Math.max(GOAL_2026-ytd2026,0);
  const mktData=MKTS.map(m=>{const mj=active.filter(j=>j.market===m);return{name:MS[m],value:mj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0),fill:MC[m]};});
  const alerts=active.filter(j=>n(j.contract_age)>30&&n(j.ytd_invoiced)===0).sort((a,b)=>n(b.contract_age)-n(a.contract_age));
  const crit=alerts.filter(j=>n(j.contract_age)>=90);const warn=alerts.filter(j=>n(j.contract_age)>=60&&n(j.contract_age)<90);const watch=alerts.filter(j=>n(j.contract_age)>=30&&n(j.contract_age)<60);
  const top15=[...active].sort((a,b)=>n(b.left_to_bill)-n(a.left_to_bill)).slice(0,15);
  const now=new Date();const compThisMonth=jobs.filter(j=>j.complete_date&&new Date(j.complete_date).getMonth()===now.getMonth()&&new Date(j.complete_date).getFullYear()===now.getFullYear()).length;
  const largest=[...active].sort((a,b)=>n(b.adj_contract_value||b.contract_value)-n(a.adj_contract_value||a.contract_value))[0];
  const oldestUnbilled=alerts[0];
  const[actLogs,setActLogs]=useState([]);useEffect(()=>{sbGet('activity_log','order=created_at.desc&limit=10').then(d=>setActLogs(d||[]));},[]);
  // Capacity snapshot (mold + batch CY) for today — correct math: panels × cy × 1.4, mold capacity = molds × panels × 0.88
  const[capSnap,setCapSnap]=useState({panelsPlanned:0,panelCapacity:0,cyPlanned:0,cyCap:52.8});
  useEffect(()=>{(async()=>{try{
    const panelsPerMoldFor=(style)=>panelsPerMoldLookup(style);
    const cfgRows=await sbGet('plant_config','select=key,value');const cfg={};(cfgRows||[]).forEach(r=>{cfg[r.key]=n(r.value);});
    const UTIL=n(cfg.mold_utilization_rate)||0.88;
    const ACC=n(cfg.accessory_overhead_multiplier)||1.4;
    const cyCap=n(cfg.daily_cy_capacity)||52.8;
    const molds=await sbGet('mold_inventory','select=style_name,total_molds');
    // Only count physical mold sets — exclude child styles that share molds
    const physical=(molds||[]).filter(r=>n(r.total_molds)>0&&!isChildStyle(r.style_name));
    const panelCapacity=physical.reduce((s,r)=>{const ppm=panelsPerMoldFor(r.style_name);if(ppm==null)return s;return s+Math.floor(n(r.total_molds)*ppm*UTIL);},0);
    const stylesRows=await sbGet('material_calc_styles','select=style_name,cy_per_panel');const sMap={};(stylesRows||[]).forEach(s=>{sMap[s.style_name]=s;});
    const today=new Date().toISOString().split('T')[0];
    const plans=await sbGet('production_plans',`plan_date=eq.${today}&select=id&limit=1`);
    let panelsPlanned=0,cyPlanned=0;
    if(plans&&plans[0]){const lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&select=style,planned_panels`);(lines||[]).forEach(l=>{const panels=n(l.planned_panels);panelsPlanned+=panels;const sr=sMap[l.style]||{};cyPlanned+=panels*n(sr.cy_per_panel)*ACC;});}
    setCapSnap({panelsPlanned,panelCapacity,cyPlanned,cyCap});
  }catch(e){console.error('Capacity snap failed',e);}})();},[]);
  // Current month bill sheet submissions for dashboard
  const dashBillingMonth=curBillingMonth();
  const[dashBillSubs,setDashBillSubs]=useState([]);
  useEffect(()=>{sbGet('pm_bill_submissions',`billing_month=eq.${dashBillingMonth}&select=id,job_id,submitted_by,submitted_at,total_lf,pct_complete_pm`).then(d=>setDashBillSubs(d||[]));},[dashBillingMonth,refreshKey]);

  return(<div>
    {dashToast&&<Toast message={dashToast.msg} isError={!dashToast.ok} onDone={()=>setDashToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Dashboard</h1>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:16}}>
      <KPI label="Total Contract" value={$k(tc)} sub={`All ${allBillable.length} jobs`}/>
      <KPI label="YTD Billed" value={$k(ty)} color="#065F46" sub="All jobs incl. closed"/>
      <KPI label="Left to Bill" value={$k(tl)} color="#B45309" sub="All jobs incl. closed"/>
      <div style={card}>
        <div style={{fontFamily:'Syne',fontSize:28,fontWeight:800,color:'#065F46'}}>{tlfPC.toLocaleString()}</div>
        <div style={{fontSize:12,color:'#6B6056',marginTop:4}}>Precast LF <span style={{fontSize:10,color:'#9E9B96',fontWeight:500}}>(production)</span></div>
        <div style={{fontSize:10,color:'#9E9B96',marginTop:2}}>Backlog — active pipeline</div>
        <div style={{fontSize:11,color:'#6B6056',marginTop:4}}>Total LF (all types): <b style={{color:'#1A1A1A'}}>{tlf.toLocaleString()}</b></div>
        <div style={{borderTop:'1px solid #E5E3E0',marginTop:10,paddingTop:10}}>
          <div style={{display:'flex',alignItems:'baseline',gap:6}}>
            <span style={{fontFamily:'Inter',fontSize:20,fontWeight:800,color:blColor}}>{blMonths.toFixed(1)}</span>
            <span style={{fontSize:11,fontWeight:700,color:blColor}}>months backlog</span>
          </div>
          <div style={{fontSize:10,color:'#9E9B96',marginBottom:6}}>at {$k(blRunRate)}/mo run rate</div>
          {blMktTotal>0&&<div style={{display:'flex',height:8,borderRadius:4,overflow:'hidden',background:'#E5E3E0',marginBottom:4}}>
            {blMktLTB.filter(m=>m.ltb>0).map(m=><div key={m.market} style={{width:`${m.ltb/blMktTotal*100}%`,background:MC[m.market]}} title={`${m.name}: ${$k(m.ltb)} (${Math.round(m.ltb/blMktTotal*100)}%)`}/>)}
          </div>}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',fontSize:9}}>
            {blMktLTB.filter(m=>m.ltb>0).map(m=><div key={m.market} style={{display:'flex',alignItems:'center',gap:3}}>
              <div style={{width:6,height:6,borderRadius:1,background:MC[m.market]}}/>
              <span style={{color:'#6B6056'}}>{m.name}</span>
              <span style={{fontWeight:700}}>{$k(m.ltb)}</span>
              <span style={{color:'#9E9B96'}}>{Math.round(m.ltb/blMktTotal*100)}%</span>
            </div>)}
          </div>
        </div>
      </div>
    </div>
    {/* Capacity KPIs — mold + batch plant */}
    {(()=>{const moldPct=capSnap.panelCapacity>0?Math.round(capSnap.panelsPlanned/capSnap.panelCapacity*100):0;const cyPct=capSnap.cyCap>0?Math.round(capSnap.cyPlanned/capSnap.cyCap*100):0;const moldCol=moldPct>=70?'#B45309':'#15803D';const cyCol=cyPct>=70?'#B45309':'#15803D';return<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
      <div style={{...card,padding:14,borderLeft:`4px solid ${moldCol}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
          <div style={{fontSize:11,color:'#6B6056',textTransform:'uppercase',fontWeight:700}}>🔧 Mold Capacity</div>
          <div style={{fontFamily:'Inter',fontSize:22,fontWeight:900,color:moldCol}}>{capSnap.panelsPlanned.toLocaleString()}/{capSnap.panelCapacity.toLocaleString()}</div>
        </div>
        <div style={{height:8,background:'#E5E3E0',borderRadius:4,overflow:'hidden',marginTop:8}}><div style={{width:`${Math.min(moldPct,100)}%`,height:'100%',background:moldCol}}/></div>
        <div style={{fontSize:11,color:'#6B6056',marginTop:4,fontWeight:600}}>{moldPct}% of panel capacity today (primary)</div>
      </div>
      <div style={{...card,padding:14,borderLeft:`4px solid ${cyCol}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
          <div style={{fontSize:11,color:'#6B6056',textTransform:'uppercase',fontWeight:700}}>🏭 Batch Plant</div>
          <div style={{fontFamily:'Inter',fontSize:22,fontWeight:900,color:cyCol}}>{capSnap.cyPlanned.toFixed(1)}/{capSnap.cyCap} CYD</div>
        </div>
        <div style={{height:8,background:'#E5E3E0',borderRadius:4,overflow:'hidden',marginTop:8}}><div style={{width:`${Math.min(cyPct,100)}%`,height:'100%',background:cyCol}}/></div>
        <div style={{fontSize:11,color:'#6B6056',marginTop:4,fontWeight:600}}>{cyPct}% — panels × cy × 1.4 / 52.8 (secondary)</div>
      </div>
    </div>;})()}
    {/* 2026 Revenue Goal */}
    {(()=>{
      const r=140,cx=160,cy=160;const circ=Math.PI*r;const offset=circ*(1-pct2026);const arcColor=achieved2026?'#065F46':'#8B2020';
      const goalEmoji=pct2026>=1?'🎯🏆':pct2026>=0.9?'🤑':pct2026>=0.8?'😤':pct2026>=0.66?'🚀':pct2026>=0.51?'🔥':pct2026>=0.36?'💪':pct2026>=0.21?'👀':pct2026>=0.11?'🐢':'😴';
      return<div style={{...card,marginBottom:16,borderTop:`3px solid ${arcColor}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4,flexWrap:'wrap',gap:8}}>
          <div>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'#1A1A1A'}}>2026 Revenue Goal</div>
            <div style={{fontSize:11,color:'#9E9B96'}}>YTD Contract Value vs $36M Target</div>
          </div>
          {achieved2026&&<div style={{fontSize:14,fontWeight:800,color:'#065F46'}}>🎯 Goal Achieved!</div>}
        </div>
        <div style={{display:'flex',gap:24,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
          {/* Arc gauge — semicircle, stroke-dashoffset for fill */}
          <div style={{flex:'0 0 auto',position:'relative',width:'100%',maxWidth:340}}>
            <svg viewBox="0 0 320 215" style={{width:'100%',height:'auto',display:'block'}}>
              <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="#E5E7EB" strokeWidth="22" strokeLinecap="round"/>
              <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={arcColor} strokeWidth="22" strokeLinecap="round" strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} style={{transition:'stroke-dashoffset .8s ease-out, stroke .3s'}}/>
              <text x={cx} y={cy-46} textAnchor="middle" style={{fontFamily:'Inter',fontWeight:900,fontSize:42,fill:'#1A1A1A'}}>{$k(ytd2026)}</text>
              <text x={cx} y={cy+18} textAnchor="middle" style={{fontFamily:'Inter',fontWeight:600,fontSize:14,fill:arcColor}}>{Math.round(pct2026*100)}% of goal</text>
              <text x={cx-r} y={cy+44} textAnchor="middle" style={{fontFamily:'Inter',fontSize:10,fill:'#9E9B96'}}>$0</text>
              <text x={cx+r} y={cy+44} textAnchor="middle" style={{fontFamily:'Inter',fontSize:10,fill:'#9E9B96'}}>$36M</text>
            </svg>
            {/* Emoji overlay — rendered as HTML so color-emoji fonts work in all browsers
               (SVG <text> doesn't reliably fall back to Apple/Segoe/Noto Color Emoji). */}
            <div style={{position:'absolute',left:0,right:0,top:'66%',textAlign:'center',fontSize:32,lineHeight:1,pointerEvents:'none'}}>{goalEmoji}</div>
          </div>
          {/* Stats column */}
          <div style={{flex:'1 1 240px',minWidth:220}}>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
              <span style={{padding:'6px 14px',borderRadius:20,background:'#FDF4F4',color:'#8B2020',fontSize:13,fontWeight:700,border:'1px solid #8B202020'}}>YTD: {$k(ytd2026)}</span>
              <span style={{padding:'6px 14px',borderRadius:20,background:'#F4F4F2',color:'#6B6056',fontSize:13,fontWeight:700,border:'1px solid #E5E3E0'}}>Remaining: {$k(remaining2026)}</span>
              <span style={{padding:'6px 14px',borderRadius:20,background:'#1A1A1A',color:'#FFF',fontSize:13,fontWeight:700}}>Goal: $36M</span>
            </div>
            <PBar pct={pct2026*100} color={arcColor} h={8}/>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#9E9B96',marginTop:4}}><span>$0</span><span>{Math.round(pct2026*100)}%</span><span>$36M</span></div>
          </div>
        </div>
      </div>;
    })()}
    {/* ═══ BILL SHEET STATUS CARD ═══ */}
    {(()=>{const bsActive=jobs.filter(j=>ACTIVE_BILL_STATUSES.includes(j.status));const bsTotal=bsActive.length;const bsSubs=dashBillSubs;const bsSubIds=new Set(bsSubs.map(s=>s.job_id));const bsSubmitted=bsActive.filter(j=>bsSubIds.has(j.id)).length;const bsPct=bsTotal>0?Math.round(bsSubmitted/bsTotal*100):0;const bsColor=bsPct>80?'#10B981':bsPct>50?'#F59E0B':'#EF4444';const pmCounts=PM_LIST.map(p=>{const pj=bsActive.filter(j=>j.pm===p.id);const ps=pj.filter(j=>bsSubIds.has(j.id)).length;return{...p,total:pj.length,submitted:ps};});return<div style={{...card,marginBottom:16,borderTop:`3px solid ${bsColor}`}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10}}>
        <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'#1A1A1A'}}>Bill Sheets — {monthLabel(dashBillingMonth)}</div>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <button onClick={()=>setShowRemindConfirm(true)} disabled={remindSending} title="Send reminder emails to PMs with missing bill sheets" style={{background:'none',border:'none',color:'#8B2020',fontSize:12,fontWeight:700,cursor:'pointer',opacity:remindSending?0.5:1}}>{remindSending?'Sending...':'📧 Send Reminders'}</button>
          {onNav&&<button onClick={()=>onNav('billing')} style={{background:'none',border:'none',color:'#8B2020',fontSize:12,fontWeight:700,cursor:'pointer'}}>View All →</button>}
        </div>
      </div>
      <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:8}}>
        <span style={{fontFamily:'Inter',fontWeight:900,fontSize:28,color:bsColor}}>{bsSubmitted}</span>
        <span style={{fontSize:14,color:'#6B6056'}}>/ {bsTotal} Submitted</span>
        <span style={{fontSize:20,fontWeight:800,color:bsColor,marginLeft:'auto'}}>{bsPct}%</span>
      </div>
      <PBar pct={bsPct} color={bsColor} h={10}/>
      <div style={{display:'flex',gap:12,marginTop:12,flexWrap:'wrap'}}>{pmCounts.map(p=><div key={p.id} style={{flex:'1 1 0',minWidth:100,background:'#F9F8F6',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
        <div style={{fontSize:11,fontWeight:700,color:'#6B6056',marginBottom:2}}>{p.short}</div>
        <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:p.submitted===p.total&&p.total>0?'#10B981':'#EF4444'}}>{p.submitted}/{p.total}</div>
      </div>)}</div>
    </div>;})()}
    {/* ═══ PIPELINE STAGE SUMMARY ═══ */}
    {(()=>{const PIPELINE_STAGES=[{key:'contract_review',label:'Review',color:'#6B7280',bg:'#F3F4F6'},{key:'production_queue',label:'Prod Queue',color:'#7C3AED',bg:'#EDE9FE'},{key:'in_production',label:'In Prod',color:'#1D4ED8',bg:'#DBEAFE'},{key:'inventory_ready',label:'Inventory',color:'#B45309',bg:'#FEF3C7'},{key:'active_install',label:'Active Install',color:'#C2410C',bg:'#FFEDD5'},{key:'fence_complete',label:'Fence Complete',color:'#0F766E',bg:'#CCFBF1'},{key:'fully_complete',label:'Fully Complete',color:'#15803D',bg:'#DCFCE7'}];const stData=PIPELINE_STAGES.map(s=>{const sj=jobs.filter(j=>j.status===s.key);return{...s,count:sj.length,lf:sj.reduce((x,j)=>x+lfPC(j),0),lfAll:sj.reduce((x,j)=>x+lfTotal(j),0)};});const fcCount=stData.find(s=>s.key==='fully_complete')?.count||0;const pipeTotal=stData.reduce((s2,d)=>s2+d.count,0);const pipeLF=stData.reduce((s2,d)=>s2+d.lf,0);const pipeLFAll=stData.reduce((s2,d)=>s2+d.lfAll,0);return<div style={{...card,marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:12}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'#1A1A1A'}}>Production Pipeline</div><div style={{fontSize:12,color:'#6B6056'}}>{pipeTotal} active projects | <b style={{color:'#065F46'}}>{pipeLF.toLocaleString()} Precast LF</b> <span style={{color:'#9E9B96'}}>({pipeLFAll.toLocaleString()} total)</span></div></div>
      <div style={{display:'flex',gap:4,alignItems:'stretch',flexWrap:'wrap'}}>
        {stData.map((s,i)=><React.Fragment key={s.key}>
          {i>0&&<span style={{color:'#D1CEC9',fontSize:16,alignSelf:'center'}}>→</span>}
          <div onClick={()=>onNav&&onNav('production')} style={{flex:'1 1 0',minWidth:80,background:s.bg,border:`1px solid ${s.color}40`,borderRadius:10,padding:'10px 6px',textAlign:'center',cursor:onNav?'pointer':'default'}}>
            <div style={{fontSize:9,fontWeight:700,color:s.color,textTransform:'uppercase',marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.label}</div>
            <div style={{fontFamily:'Inter',fontWeight:900,fontSize:22,color:s.color}}>{s.count}</div>
            <div style={{fontSize:10,color:'#6B6056',marginTop:2}}>{s.lf.toLocaleString()} PC LF</div>
          </div>
        </React.Fragment>)}
      </div>
      <div style={{fontSize:12,color:'#6B6056',marginTop:10}}>Fully Complete: {fcCount} jobs | Closed: {closedJobs.length} jobs</div>
    </div>;})()}
    {/* ═══ PM WORKLOAD CARDS ═══ */}
    <div style={{...card,marginBottom:16}}>
      <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'#1A1A1A',marginBottom:12}}>PM Workload</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        {PM_LIST.map(p=>{const pj=jobs.filter(j=>j.pm===p.id&&j.status!=='closed'&&j.status!=='cancelled'&&j.status!=='lost');const pLF=pj.reduce((s,j)=>s+n(j.total_lf),0);const pCV=pj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const bsSubIds=new Set(dashBillSubs.map(s2=>s2.job_id));const pSub=pj.filter(j=>bsSubIds.has(j.id)).length;const pAll=pj.length;return<div key={p.id} onClick={()=>onNav&&onNav('projects')} style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:10,padding:14,cursor:onNav?'pointer':'default'}}>
          <div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:'#8B2020',marginBottom:8}}>{p.label}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:11,color:'#6B6056',marginBottom:8}}>
            <div>Jobs: <b style={{color:'#1A1A1A'}}>{pAll}</b></div>
            <div>LF: <b style={{color:'#1A1A1A'}}>{pLF.toLocaleString()}</b></div>
            <div style={{gridColumn:'1/-1'}}>Contract: <b style={{color:'#1A1A1A'}}>{$k(pCV)}</b></div>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:pSub===pAll&&pAll>0?'#10B981':'#EF4444'}}>{pSub} of {pAll} bill sheets</div>
        </div>;})}
      </div>
    </div>
    {showRemindConfirm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowRemindConfirm(false)}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:440,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:12,color:'#1A1A1A'}}>Send Bill Sheet Reminders?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7,marginBottom:20}}>This will email all PMs with missing bill sheets for <b style={{color:'#1A1A1A'}}>{monthLabel(curBillingMonth())}</b> and send you an AR summary. Continue?</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setShowRemindConfirm(false)} style={btnS}>Cancel</button><button onClick={sendReminders} style={btnP}>Send Reminders</button></div>
      </div>
    </div>}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
      <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Contract Value by Market</div><ResponsiveContainer width="100%" height={220}><BarChart data={mktData} barSize={40}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>'$'+(v/1e6).toFixed(1)+'M'}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8}}/><Bar dataKey="value" radius={[6,6,0,0]}>{mktData.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Bar></BarChart></ResponsiveContainer></div>
      <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Pipeline by Status</div>{STS.filter(s=>!CLOSED_SET.has(s)).map(s=>{const sj=active.filter(j=>j.status===s);const sv=sj.reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);return(<div key={s} style={{marginBottom:14}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span><span style={pill(SC[s],SB_[s])}>{SS[s]}</span> <span style={{color:'#6B6056',marginLeft:6}}>{sj.length}</span></span><span style={{color:'#9E9B96'}}>{$k(sv)}</span></div><PBar pct={tc>0?sv/tc*100:0} color={SC[s]}/></div>);})}</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
      <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Top 15 Left to Bill</div><table style={{width:'100%',borderCollapse:'collapse'}}><tbody>{top15.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'5px 8px',fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'5px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'5px 8px',textAlign:'right',fontFamily:'Inter',fontWeight:700,color:'#8B2020',fontSize:13}}>{$(j.left_to_bill)}</td></tr>)}</tbody></table></div>
      {/* Alerts */}
      <div style={{...card,borderColor:alerts.length>0?'#B4530930':'#E5E3E0'}}>
        <div style={{fontFamily:'Inter',fontWeight:700,marginBottom:8,color:'#B45309'}}>Billing Alerts ({alerts.length})</div>
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>{[['🔴 Critical',crit],['🟡 Warning',warn],['🟠 Watch',watch]].map(([l,b])=>b.length>0&&<span key={l} style={{fontSize:11,color:'#6B6056'}}>{l}: {b.length} — {$k(b.reduce((s,j)=>s+n(j.contract_value),0))}</span>)}</div>
        <table style={{width:'100%',borderCollapse:'collapse'}}><tbody>{alerts.slice(0,12).map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2',borderLeft:`3px solid ${n(j.contract_age)>=90?'#991B1B':n(j.contract_age)>=60?'#B45309':'#D97706'}`}}><td style={{padding:'5px 8px',fontSize:12,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'5px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'5px 8px',textAlign:'right',fontFamily:'Inter',fontWeight:700,fontSize:12}}>{$(j.contract_value)}</td><td style={{padding:'5px 8px',textAlign:'right',fontSize:12,color:'#B45309'}}>{j.contract_age}d</td></tr>)}</tbody></table>
      </div>
    </div>
    {/* Activity Feed */}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
      <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:10}}>Recent Activity</div>{actLogs.length===0?<div style={{color:'#9E9B96',fontSize:12}}>No activity yet</div>:actLogs.map(l=><div key={l.id} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}><span style={pill(ACT_C[l.action]||'#6B6056',(ACT_C[l.action]||'#6B6056')+'18')}>{(l.action||'').replace(/_/g,' ')}</span><span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.job_name}</span><span style={{color:'#9E9B96',flexShrink:0}}>{relT(l.created_at)}</span></div>)}</div>
      <WeeklyDigest jobs={jobs} active={active}/>
    </div>
  </div>);
}

/* ═══ PROJECTS PAGE ═══ */
const COL_GROUPS=[
  {label:'Job Info',keys:['status','market','job_number','job_name','customer_name','cust_number']},
  {label:'Product',keys:['fence_type','primary_fence_type','fence_addons','total_lf_precast','lf_single_wythe','lf_wrought_iron','number_of_gates','total_lf','style','color','height_precast']},
  {label:'Contract',keys:['contract_value','change_orders','adj_contract_value','net_contract_value','sales_tax','billing_method','billing_date']},
  {label:'Billing',keys:['ytd_invoiced','pct_billed','left_to_bill','last_billed','contract_date','retainage_pct','retainage_held']},
  {label:'Schedule',keys:['est_start_date','start_month','contract_age','active_entry_date','complete_date','complete_month']},
  {label:'Requirements',keys:['aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing']},
  {label:'Team',keys:['sales_rep','pm','job_type']},
  {label:'Other',keys:['notes','documents_needed','file_location','address','city','state','zip']}
];
function ProjectsPage({jobs,onRefresh,openJob,refreshKey=0,onNav}){
  const[projTab,setProjTab]=useState('active');
  const[search,setSearch]=useState('');
  const[statusF,setStatusF]=useState(new Set());
  const[mktF,setMktF]=useState(new Set());
  const[pmF,setPmF]=useState(new Set());
  const[primaryTypeF,setPrimaryTypeF]=useState(new Set());
  const[addonsF,setAddonsF]=useState(new Set());
  const clearAllFilters=()=>{setStatusF(new Set());setMktF(new Set());setPmF(new Set());setPrimaryTypeF(new Set());setAddonsF(new Set());};
  // Fetch line items so add-on badges auto-derive from actual line data (Gate, Removal, Lump Sum, SW, WI)
  const[plLineItems,setPlLineItems]=useState([]);
  useEffect(()=>{sbGet('job_line_items','select=job_number,fence_type,description&limit=5000').then(d=>setPlLineItems(d||[])).catch(()=>{});},[refreshKey]);
  const addonsByJobNum=useMemo(()=>{
    const m={};
    plLineItems.forEach(li=>{
      if(!li.job_number)return;
      if(!m[li.job_number])m[li.job_number]=new Set();
      const ft=li.fence_type;
      const desc=(li.description||'').toUpperCase();
      // Single Wythe adds both SW (display-only marker) and C (Columns) since SW fences include columns
      if(ft==='SW'){m[li.job_number].add('SW');m[li.job_number].add('C');}
      if(ft==='WI')m[li.job_number].add('WI');
      if(desc.startsWith('GATE:'))m[li.job_number].add('G');
      if(desc.startsWith('REMOVAL:'))m[li.job_number].add('R');
      if(desc.startsWith('LUMP SUM:'))m[li.job_number].add('LS');
    });
    return m;
  },[plLineItems]);
  // Augment each job with auto-derived add-on codes (merged with any manually-set fence_addons)
  const augmentedJobs=useMemo(()=>jobs.map(j=>{
    const derived=new Set();
    if(n(j.number_of_gates)>0)derived.add('G');
    if(n(j.lf_wrought_iron)>0||n(j.total_lf_wrought_iron)>0)derived.add('WI');
    if(n(j.lf_single_wythe)>0||n(j.total_lf_masonry)>0){derived.add('SW');derived.add('C');}
    if(n(j.lump_sum_amount)>0)derived.add('LS');
    const fromLI=addonsByJobNum[j.job_number];
    if(fromLI)fromLI.forEach(c=>derived.add(c));
    // Preserve any manually-set codes that aren't auto-derivable
    const existing=Array.isArray(j.fence_addons)?j.fence_addons:[];
    existing.forEach(c=>derived.add(c));
    return{...j,fence_addons:[...derived]};
  }),[jobs,addonsByJobNum]);
  const[sortCol,setSortCol]=useState('left_to_bill');const[sortDir,setSortDir]=useState('desc');
  const[closedYearF,setClosedYearF]=useState('');
  const[visCols,setVisCols]=useState(()=>{try{
    const s=localStorage.getItem('fc_vis_cols');
    if(!s)return DEF_VIS;
    let saved=JSON.parse(s);
    // Migration: strip retired/duplicate LF column keys and ensure the new canonical set is present
    const RETIRED=new Set(['lf_precast','lf_other','total_lf_masonry','total_lf_wrought_iron','total_lf_removed']);
    saved=saved.filter(k=>!RETIRED.has(k));
    // Drop any keys that no longer exist in ALL_COLS at all
    const validKeys=new Set(ALL_COLS.map(c=>c.key));
    saved=saved.filter(k=>validKeys.has(k));
    // Ensure the canonical LF + product columns are present
    const ensure=['primary_fence_type','fence_addons','total_lf_precast','lf_single_wythe','lf_wrought_iron','number_of_gates','total_lf'];
    const missing=ensure.filter(k=>!saved.includes(k));
    if(missing.length>0){
      const ftIdx=saved.indexOf('fence_type');
      const insertAt=ftIdx>=0?ftIdx+1:saved.length;
      saved=[...saved.slice(0,insertAt),...missing,...saved.slice(insertAt)];
    }
    localStorage.setItem('fc_vis_cols',JSON.stringify(saved));
    return saved;
  }catch(e){return DEF_VIS;}});const[showCols,setShowCols]=useState(false);
  useEffect(()=>{try{localStorage.setItem('fc_vis_cols',JSON.stringify(visCols));}catch(e){}},[visCols]);
  const[editJob,setEditJob]=useState(openJob||null);const[isNew,setIsNew]=useState(false);const[showNewForm,setShowNewForm]=useState(false);
  const[editMode,setEditMode]=useState(false);const[inlE,setInlE]=useState(null);
  const[sel,setSel]=useState(new Set());const[toast,setToast]=useState(null);
  useEffect(()=>{if(openJob)setEditJob(openJob);},[openJob]);
  useEffect(()=>setSel(new Set()),[search,statusF,mktF,pmF]);
  const toggleSort=k=>{if(sortCol===k)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(k);setSortDir('desc');}};
  const closedJobs=useMemo(()=>{let f=augmentedJobs.filter(j=>j.status==='closed');if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}if(mktF.size>0)f=f.filter(j=>mktF.has(j.market));if(pmF.size>0)f=f.filter(j=>pmF.has(j.pm));if(closedYearF){if(closedYearF==='older')f=f.filter(j=>j.closed_date&&parseInt(j.closed_date.slice(0,4))<=2023);else f=f.filter(j=>j.closed_date&&j.closed_date.startsWith(closedYearF));}return[...f].sort((a,b)=>(b.closed_date||'').localeCompare(a.closed_date||''));},[augmentedJobs,search,mktF,pmF,closedYearF]);
  const closedCount=augmentedJobs.filter(j=>j.status==='closed').length;
  const closedStats=useMemo(()=>{const cj=augmentedJobs.filter(j=>j.status==='closed');return{count:cj.length,cv:cj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0),lfPC:cj.reduce((s,j)=>s+lfPC(j),0),lf:cj.reduce((s,j)=>s+lfTotal(j),0),avgPct:cj.length>0?Math.round(cj.reduce((s,j)=>s+n(j.pct_billed),0)/cj.length*100):0};},[augmentedJobs]);
  const filtered=useMemo(()=>{
    let f=augmentedJobs.filter(j=>j.status!=='closed');
    if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}
    if(statusF.size>0)f=f.filter(j=>statusF.has(j.status));
    if(mktF.size>0)f=f.filter(j=>mktF.has(j.market));
    if(pmF.size>0)f=f.filter(j=>pmF.has(j.pm));
    if(primaryTypeF.size>0)f=f.filter(j=>primaryTypeF.has(j.primary_fence_type));
    if(addonsF.size>0){
      if(addonsF.has('has_any'))f=f.filter(j=>Array.isArray(j.fence_addons)&&j.fence_addons.length>0);
      else f=f.filter(j=>Array.isArray(j.fence_addons)&&j.fence_addons.some(a=>addonsF.has(a)));
    }
    return[...f].sort((a,b)=>{let av=a[sortCol],bv=b[sortCol];if(typeof av==='string')return sortDir==='asc'?(av||'').localeCompare(bv||''):(bv||'').localeCompare(av||'');return sortDir==='asc'?n(av)-n(bv):n(bv)-n(av);});
  },[augmentedJobs,search,statusF,mktF,pmF,primaryTypeF,addonsF,sortCol,sortDir]);
  const exportCSV=rows=>{const cols=ALL_COLS.filter(c=>visCols.includes(c.key));const h=cols.map(c=>c.label).join(',');const r=rows.map(j=>cols.map(c=>{let v=j[c.key];if(Array.isArray(v))v=v.join('; ');return typeof v==='string'&&v.includes(',')?`"${v}"`:(v??'');}).join(','));const b=new Blob([h+'\n'+r.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='fencecrete-projects.csv';a.click();};
  const saveInline=async()=>{if(!inlE)return;const u={[inlE.key]:inlE.value};if(inlE.key==='ytd_invoiced'){const adj=n(inlE.job.adj_contract_value||inlE.job.contract_value);const ytd=n(inlE.value);u.pct_billed=adj>0?Math.round(ytd/adj*10000)/10000:0;u.left_to_bill=adj-ytd;}await sbPatch('jobs',inlE.id,u);const j=jobs.find(x=>x.id===inlE.id);if(['ytd_invoiced','last_billed'].includes(inlE.key)){fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update',inlE.key,j[inlE.key],inlE.value);}else{fireAlert('job_updated',{...j,...u});logAct(j,'field_update',inlE.key,j[inlE.key],inlE.value);}setInlE(null);setToast('Saved');onRefresh();};
  const bulkStatus=async s=>{for(const id of sel){const j=jobs.find(x=>x.id===id);if(j){await sbPatch('jobs',id,{status:s});fireAlert('job_updated',{...j,status:s});logAct(j,'status_change','status',j.status,s);}}setSel(new Set());setToast(`Updated ${sel.size} projects`);onRefresh();};
  const bulkRep=async r=>{for(const id of sel){const j=jobs.find(x=>x.id===id);if(j){await sbPatch('jobs',id,{sales_rep:r});logAct(j,'field_update','sales_rep',j.sales_rep,r);}}setSel(new Set());setToast(`Assigned to ${r}`);onRefresh();};
  const visCD=ALL_COLS.filter(c=>visCols.includes(c.key));
  const inlineField=(j,k)=>{
    // For the color column, compose standard palette + the row's current legacy value (if any)
    // so editing an existing job never silently drops the legacy color.
    if(k==='color'){
      const opts=colorOptionsFor(j?.color);
      return<select autoFocus value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12}}><option value="">—</option>{opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>;
    }
    const dd=DD[k];if(dd)return<select autoFocus value={inlE?.value||''} onChange={e=>{setInlE({...inlE,value:e.target.value});}} onBlur={saveInline} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12}}><option value="">—</option>{dd.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>;if(k==='est_start_date'||k==='last_billed')return<input autoFocus type="date" value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onKeyDown={e=>{if(e.key==='Enter')saveInline();if(e.key==='Escape')setInlE(null);}} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12,width:'100%'}}/>;return<input autoFocus value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onKeyDown={e=>{if(e.key==='Enter')saveInline();if(e.key==='Escape')setInlE(null);}} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12,width:'100%'}}/>;
  };
  const fTC=filtered.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);
  const fLTB=filtered.reduce((s,j)=>s+n(j.left_to_bill),0);
  const fAvgB=filtered.length>0?filtered.reduce((s,j)=>s+n(j.pct_billed),0)/filtered.length:0;
  const colRef=useRef();
  useEffect(()=>{if(!showCols)return;const h=e=>{if(colRef.current&&!colRef.current.contains(e.target))setShowCols(false);};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h);},[showCols]);
  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{position:'sticky',top:0,zIndex:10,background:'#F4F4F2',paddingBottom:8,marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div style={{display:'flex',alignItems:'baseline',gap:16}}>
          <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,margin:0}}>Projects</h1>
          <div style={{display:'flex',gap:4}}>
            <button onClick={()=>setProjTab('active')} style={{padding:'6px 14px',border:'none',background:'transparent',color:projTab==='active'?'#8B2020':'#6B6056',fontWeight:projTab==='active'?700:400,fontSize:13,cursor:'pointer',borderBottom:projTab==='active'?'2px solid #8B2020':'2px solid transparent'}}>Active</button>
            <button onClick={()=>setProjTab('closed')} style={{padding:'6px 14px',border:'none',background:'transparent',color:projTab==='closed'?'#8B2020':'#6B6056',fontWeight:projTab==='closed'?700:400,fontSize:13,cursor:'pointer',borderBottom:projTab==='closed'?'2px solid #8B2020':'2px solid transparent'}}>Closed{closedCount>0&&<span style={{marginLeft:4,background:'#F4F4F2',color:'#6B6056',padding:'1px 6px',borderRadius:8,fontSize:10,fontWeight:600}}>{closedCount}</span>}</button>
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {projTab==='active'&&<button onClick={()=>setEditMode(!editMode)} style={{...btnS,background:editMode?'#FDF4F4':'#F4F4F2',color:editMode?'#8B2020':'#6B6056',border:editMode?'1px solid #8B2020':'1px solid #E5E3E0'}}>{editMode?'✏ Edit':'👁 View'}</button>}
          <div style={{position:'relative'}} ref={colRef}><button onClick={()=>setShowCols(!showCols)} style={btnS}>Columns ({visCols.length})</button>
            {showCols&&<div style={{position:'absolute',right:0,top:36,width:360,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:12,boxShadow:'0 8px 30px rgba(0,0,0,.12)',zIndex:100,padding:16,maxHeight:480,overflow:'auto'}}>
              {COL_GROUPS.map(g=>{const gk=g.keys.filter(k=>ALL_COLS.some(c=>c.key===k));const allOn=gk.every(k=>visCols.includes(k));return<div key={g.label} style={{marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}><span style={{fontSize:11,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5}}>{g.label}</span><button onClick={()=>{if(allOn)setVisCols(v=>v.filter(k=>!gk.includes(k)));else setVisCols(v=>[...new Set([...v,...gk])]);}} style={{background:'none',border:'none',color:'#8B2020',fontSize:10,fontWeight:600,cursor:'pointer'}}>{allOn?'Deselect All':'Select All'}</button></div>
                <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{gk.map(k=>{const c=ALL_COLS.find(x=>x.key===k);if(!c)return null;const on=visCols.includes(k);return<button key={k} onClick={()=>setVisCols(v=>on?v.filter(x=>x!==k):[...v,k])} style={{padding:'3px 8px',borderRadius:4,fontSize:10,fontWeight:on?600:400,border:on?'1px solid #8B2020':'1px solid #E5E3E0',background:on?'#FDF4F4':'#FFF',color:on?'#8B2020':'#9E9B96',cursor:'pointer'}}>{c.label}</button>;})}</div>
              </div>;})}
            </div>}
          </div>
          {projTab==='active'&&<button onClick={()=>setShowNewForm(true)} style={{...btnP,background:'#065F46'}}>+ New Project</button>}
          <button onClick={()=>exportCSV(projTab==='active'?filtered:closedJobs)} style={btnP}>Export</button>
        </div>
      </div>
      {projTab==='active'&&<div style={{display:'flex',gap:8,marginBottom:4,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects..." style={{...inputS,width:240}}/>
        <MultiSelect label="All Statuses" width={160} selected={statusF} onChange={setStatusF} options={STS.map(s=>({v:s,l:SL[s]}))}/>
        <MultiSelect label="All Markets" width={160} selected={mktF} onChange={setMktF} options={MKTS.map(m=>({v:m,l:m}))}/>
        <MultiSelect label="All PMs" width={160} selected={pmF} onChange={setPmF} options={PM_LIST.map(p=>({v:p.id,l:p.label}))}/>
        <MultiSelect label="All Types" width={140} selected={primaryTypeF} onChange={setPrimaryTypeF} options={[{v:'Precast',l:'Precast'},{v:'Masonry',l:'Masonry'},{v:'Wrought Iron',l:'Wrought Iron'}]}/>
        <MultiSelect label="All Add-ons" width={160} selected={addonsF} onChange={setAddonsF} options={[{v:'has_any',l:'Has Any Add-on'},{v:'G',l:'Gates (G)'},{v:'C',l:'Columns (C)'},{v:'WI',l:'Wrought Iron (WI)'},{v:'SW',l:'Single Wythe (SW)'},{v:'R',l:'Removal (R)'},{v:'LS',l:'Lump Sum (LS)'}]}/>
        {(statusF.size+mktF.size+pmF.size+primaryTypeF.size+addonsF.size>0)&&<button onClick={clearAllFilters} style={{background:'none',border:'1px solid #8B2020',borderRadius:6,padding:'6px 12px',color:'#8B2020',fontSize:11,fontWeight:700,cursor:'pointer'}}>Clear All</button>}
      </div>}
      {projTab==='closed'&&<div style={{display:'flex',gap:8,marginBottom:4,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search closed projects..." style={{...inputS,width:240}}/>
        <MultiSelect label="All Markets" width={160} selected={mktF} onChange={setMktF} options={MKTS.map(m=>({v:m,l:m}))}/>
        <MultiSelect label="All PMs" width={160} selected={pmF} onChange={setPmF} options={PM_LIST.map(p=>({v:p.id,l:p.label}))}/>
        <select value={closedYearF} onChange={e=>setClosedYearF(e.target.value)} style={{...inputS,width:140}}><option value="">All Years</option><option value="2026">2026</option><option value="2025">2025</option><option value="2024">2024</option><option value="older">2023 & Earlier</option></select>
        {(mktF.size+pmF.size>0||closedYearF)&&<button onClick={()=>{clearAllFilters();setClosedYearF('');}} style={{background:'none',border:'1px solid #8B2020',borderRadius:6,padding:'6px 12px',color:'#8B2020',fontSize:11,fontWeight:700,cursor:'pointer'}}>Clear All</button>}
      </div>}
      {projTab==='active'&&<div style={{fontSize:12,color:'#6B6056',padding:'4px 0'}}>Showing {filtered.length} jobs | {$k(fTC)} contract value | {$k(fLTB)} left to bill | {Math.round(fAvgB*100)}% avg billed</div>}
    </div>
    {/* Closed tab stats */}
    {projTab==='closed'&&<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:12}}>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{closedStats.count}</div><div style={{fontSize:10,color:'#6B6056'}}>Total Closed Jobs</div></div>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#065F46'}}>{$k(closedStats.cv)}</div><div style={{fontSize:10,color:'#6B6056'}}>Total Contract Value</div></div>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#065F46'}}>{closedStats.lfPC.toLocaleString()}</div><div style={{fontSize:10,color:'#6B6056'}}>Precast LF</div><div style={{fontSize:9,color:'#9E9B96',marginTop:2}}>Total: {closedStats.lf.toLocaleString()} LF</div></div>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:closedStats.avgPct>=90?'#065F46':'#B45309'}}>{closedStats.avgPct}%</div><div style={{fontSize:10,color:'#6B6056'}}>Avg % Billed at Close</div></div>
    </div>}
    {/* Active tab bulk actions + table */}
    {projTab==='active'&&<>
    {sel.size>0&&<div style={{background:'#1A1A1A',borderRadius:8,padding:'8px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12,color:'#fff',fontSize:13}}><span style={{fontWeight:700}}>{sel.size} selected</span><select onChange={e=>{if(e.target.value)bulkStatus(e.target.value);e.target.value='';}} style={{...inputS,width:160,background:'#2A2A2A',color:'#fff',border:'1px solid #444'}}><option value="">Change Status...</option>{STS.map(s=><option key={s} value={s}>{SL[s]}</option>)}</select><select onChange={e=>{if(e.target.value)bulkRep(e.target.value);e.target.value='';}} style={{...inputS,width:140,background:'#2A2A2A',color:'#fff',border:'1px solid #444'}}><option value="">Assign Rep...</option>{REPS.map(r=><option key={r} value={r}>{r}</option>)}</select><button onClick={()=>exportCSV(filtered.filter(j=>sel.has(j.id)))} style={{...btnP,padding:'4px 12px',fontSize:12}}>Export</button><button onClick={()=>setSel(new Set())} style={{background:'transparent',border:'1px solid #444',borderRadius:6,color:'#fff',padding:'4px 12px',fontSize:12,cursor:'pointer'}}>Clear</button></div>}
    <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 220px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr><th style={{width:40,padding:'10px 8px',borderBottom:'1px solid #E5E3E0'}}><input type="checkbox" checked={sel.size===filtered.length&&filtered.length>0} onChange={()=>{if(sel.size===filtered.length)setSel(new Set());else setSel(new Set(filtered.map(j=>j.id)));}} /></th>{visCD.map(c=><th key={c.key} onClick={()=>toggleSort(c.key)} style={{textAlign:'left',padding:'10px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0.5,userSelect:'none',background:c.tintHdr||'#F9F8F6'}}>{c.label} {sortCol===c.key&&(sortDir==='asc'?'↑':'↓')}</th>)}</tr></thead>
        <tbody>{filtered.map((j,i)=><tr key={j.id} onClick={()=>{if(!editMode&&!sel.size){setEditJob(j);setIsNew(false);}}} style={{cursor:editMode?'default':'pointer',borderLeft:`3px solid ${SC[j.status]||'transparent'}`,background:i%2===0?'#FFF':'#FAFAF8'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#FFF':'#FAFAF8'}>
          <td style={{width:40,padding:'8px 8px'}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={sel.has(j.id)} onChange={()=>{const s=new Set(sel);if(s.has(j.id))s.delete(j.id);else s.add(j.id);setSel(s);}}/></td>
          {visCD.map(c=><td key={c.key} onClick={e=>{if(editMode){e.stopPropagation();setInlE({id:j.id,key:c.key,value:j[c.key]??'',job:j});}}} style={{padding:'8px 10px',whiteSpace:'nowrap',maxWidth:c.w,overflow:'hidden',textOverflow:'ellipsis',cursor:editMode?'cell':'pointer',background:c.tint||'transparent'}}>{inlE&&inlE.id===j.id&&inlE.key===c.key?inlineField(j,c.key):renderCell(j,c.key)}</td>)}
        </tr>)}</tbody></table>
    </div>
    </>}
    {/* Closed tab table */}
    {projTab==='closed'&&<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 320px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}>
        <tr>{[['Job #',''],['Job Name',''],['PM',''],['Market',''],['Style',''],['Color',''],['Closed Date',''],['Contract Value',''],['PC LF','#D1FAE5'],['SW LF',''],['WI LF',''],['Gates',''],['Total LF','#F4F4F2'],['YTD Invoiced',''],['% Billed','']].map(([h,bg])=><th key={h} style={{textAlign:'left',padding:'10px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0.5,background:bg||'transparent'}}>{h}</th>)}</tr>
      </thead>
      <tbody>{closedJobs.map((j,i)=><tr key={j.id} onClick={()=>{setEditJob(j);setIsNew(false);}} style={{cursor:'pointer',background:i%2===0?'#FFF':'#FAFAF8',color:'#6B6056'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#FFF':'#FAFAF8'}>
        <td style={{padding:'8px 10px',fontSize:11}}>{j.job_number||'—'}</td>
        <td style={{padding:'8px 10px',fontWeight:500,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td>
        <td style={{padding:'8px 10px',fontSize:11}}>{j.pm||'—'}</td>
        <td style={{padding:'8px 10px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td>
        <td style={{padding:'8px 10px',fontSize:11}}>{j.style||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11}}>{j.color||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11}}>{fD(j.closed_date)}</td>
        <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td>
        <td style={{padding:'8px 10px',background:'#ECFDF5'}}>{lfPC(j)>0?<span style={{fontWeight:700,color:'#065F46'}}>{lfPC(j).toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>}</td>
        <td style={{padding:'8px 10px'}}>{n(j.lf_single_wythe)>0?n(j.lf_single_wythe).toLocaleString():<span style={{color:'#9E9B96'}}>—</span>}</td>
        <td style={{padding:'8px 10px'}}>{n(j.lf_wrought_iron)>0?n(j.lf_wrought_iron).toLocaleString():<span style={{color:'#9E9B96'}}>—</span>}</td>
        <td style={{padding:'8px 10px'}}>{lfGates(j)>0?lfGates(j).toLocaleString():<span style={{color:'#9E9B96'}}>—</span>}</td>
        <td style={{padding:'8px 10px',background:'#F9F8F6'}}>{lfTotal(j)>0?<span style={{fontWeight:700}}>{lfTotal(j).toLocaleString()}</span>:<span style={{color:'#9E9B96'}}>—</span>}</td>
        <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:600,color:'#065F46'}}>{$(j.ytd_invoiced)}</td>
        <td style={{padding:'8px 10px'}}>{fmtPct(j.pct_billed)}</td>
      </tr>)}</tbody></table>
      {closedJobs.length===0&&<div style={{padding:40,textAlign:'center',color:'#9E9B96'}}>No closed projects found</div>}
    </div>}
    {editJob&&<EditPanel job={editJob} isNew={false} onClose={()=>{setEditJob(null);setIsNew(false);}} onSaved={msg=>{setEditJob(null);setIsNew(false);if(msg)setToast(msg);onRefresh();}} onNav={onNav}/>}
    {showNewForm&&<NewProjectForm jobs={jobs} onClose={()=>setShowNewForm(false)} onSaved={msg=>{setShowNewForm(false);if(msg)setToast(msg);onRefresh();}}/>}
  </div>);
}

/* ═══ BILLING PAGE ═══ */
function BillingPage({jobs,onRefresh,onNav}){
  const[bilQuickView,setBilQuickView]=useState(null);
  const[bilAdminPin,setBilAdminPin]=useState(null);const[bilPin,setBilPin]=useState('');const[bilPinErr,setBilPinErr]=useState(false);
  const bilAdminReset=async(sub)=>{try{await fetch(`${SB}/rest/v1/pm_bill_submissions?id=eq.${sub.id}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});try{await sbPost('activity_log',{job_id:sub.job_id,job_number:sub.job_number,job_name:sub.job_name,action:'admin_bill_sheet_reset',field_name:'pm_bill_submissions',old_value:'reviewed',new_value:'reset',changed_by:'admin'});}catch(e2){}setBilAdminPin(null);setBilPin('');setArDetail(null);fetchArSubs();setToast('Submission reset by admin');}catch(e){setToast({message:e.message||'Reset failed',isError:true});}};
  const[bilRemindSending,setBilRemindSending]=useState(false);
  const sendBilReminders=async()=>{setBilRemindSending(true);try{const res=await fetch(`${SB}/functions/v1/bill-sheet-reminder`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'}});const txt=await res.text();if(!res.ok)throw new Error(txt);const data=txt?JSON.parse(txt):{};setToast(`Reminders sent! ${data.remindersSent||0} PMs notified, ${data.totalMissing||0} jobs missing.`);}catch(e){setToast({message:e.message||'Failed to send reminders',isError:true});}setBilRemindSending(false);};
  const active=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  const withBal=useMemo(()=>[...active].filter(j=>n(j.left_to_bill)>0).sort((a,b)=>n(b.left_to_bill)-n(a.left_to_bill)),[active]);
  const ty=active.reduce((s,j)=>s+n(j.ytd_invoiced),0);const tl=active.reduce((s,j)=>s+n(j.left_to_bill),0);
  const cutoff='2024-01-01';const avgDaysFirst=jobs.filter(j=>{if(!j.contract_date||!j.last_billed)return false;if(j.contract_date<cutoff)return false;const cd=new Date(j.contract_date).getTime();const lb=new Date(j.last_billed).getTime();return lb>=cd;}).map(j=>Math.round((new Date(j.last_billed).getTime()-new Date(j.contract_date).getTime())/86400000));const avgD=avgDaysFirst.length?Math.round(avgDaysFirst.reduce((s,d)=>s+d,0)/avgDaysFirst.length):-1;const avgDColor=avgD<0?'#9E9B96':avgD<=30?'#1D4ED8':avgD<=60?'#B45309':'#991B1B';
  const fully=active.filter(j=>n(j.pct_billed)>=0.99).length;
  const[billingTab,setBillingTab]=useState('submissions');
  const[toast,setToast]=useState(null);
  // ─── All Jobs tab state ───
  const[bSearch,setBSearch]=useState('');const[bMktF,setBMktF]=useState(null);const[bPmF,setBPmF]=useState('');const[bStatusF,setBStatusF]=useState(null);const[billingF,setBillingF]=useState(null);const[showLfDetail,setShowLfDetail]=useState(false);
  const[confirmFullJob,setConfirmFullJob]=useState(null);const[undoJob,setUndoJob]=useState(null);const[showRecent,setShowRecent]=useState(false);
  const[editId,setEditId]=useState(null);const[editField,setEditField]=useState(null);const[editVal,setEditVal]=useState('');
  const startEdit=(j,f)=>{setEditId(j.id);setEditField(f);setEditVal(j[f]??'');};
  const saveEdit=async j=>{const u={[editField]:editVal};if(editField==='ytd_invoiced'){const adj=n(j.adj_contract_value||j.contract_value);const ytd=n(editVal);u.pct_billed=adj>0?Math.round(ytd/adj*10000)/10000:0;u.left_to_bill=adj-ytd;}await sbPatch('jobs',j.id,u);fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update',editField,j[editField],editVal);setEditId(null);setEditField(null);onRefresh();};
  const confirmMarkFull=async()=>{if(!confirmFullJob)return;const j=confirmFullJob;const adj=n(j.adj_contract_value||j.contract_value);const u={ytd_invoiced:adj,pct_billed:1,left_to_bill:0};await sbPatch('jobs',j.id,u);fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update','ytd_invoiced',j.ytd_invoiced,adj);setConfirmFullJob(null);setToast(`${j.job_name} marked as 100% billed`);onRefresh();};
  const confirmUndo=async()=>{if(!undoJob)return;const j=undoJob;const adj=n(j.adj_contract_value||j.contract_value);const u={ytd_invoiced:0,pct_billed:0,left_to_bill:adj};await sbPatch('jobs',j.id,u);fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update','ytd_invoiced',j.ytd_invoiced,0);setUndoJob(null);setToast(`Undo: ${j.job_name} YTD reset to $0`);onRefresh();};
  const recentlyBilled=useMemo(()=>jobs.filter(j=>n(j.pct_billed)>=0.99).sort((a,b)=>(b.last_billed||'').localeCompare(a.last_billed||'')).slice(0,10),[jobs]);
  const shown=useMemo(()=>{let f=withBal;if(billingF)f=f.filter(j=>j.billing_method===billingF);if(bSearch){const q=bSearch.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}if(bMktF)f=f.filter(j=>j.market===bMktF);if(bPmF)f=f.filter(j=>j.pm===bPmF);if(bStatusF==='zero')f=f.filter(j=>n(j.pct_billed)===0);return f;},[withBal,billingF,bSearch,bMktF,bPmF,bStatusF]);
  // ─── PM Submissions (AR Exception Dashboard) ───
  const[arMonth,setArMonth]=useState(curBillingMonth);
  const[arSubs,setArSubs]=useState([]);
  const[arPmF,setArPmF]=useState('');
  const[arMktF,setArMktF]=useState(null);
  const[arViewF,setArViewF]=useState('all');
  const[arDetail,setArDetail]=useState(null);
  const[arForm,setArForm]=useState({ar_notes:'',ar_reviewed_by:'',invoiced_amount:'',invoice_number:'',invoice_date:new Date().toISOString().split('T')[0]});
  const arMonthLabel=monthLabel(arMonth);
  const arIsCurrent=arMonth===curBillingMonth();
  const fetchArSubs=useCallback(async()=>{const d=await sbGet('pm_bill_submissions',`billing_month=eq.${arMonth}&order=job_name.asc`);setArSubs(d||[]);},[arMonth]);
  useEffect(()=>{if(billingTab==='submissions')fetchArSubs();},[fetchArSubs,billingTab]);
  const arActiveJobs=useMemo(()=>jobs.filter(j=>ACTIVE_BILL_STATUSES.includes(j.status)),[jobs]);
  const arSubByJob=useMemo(()=>{const m={};arSubs.forEach(s=>{m[s.job_id]=s;});return m;},[arSubs]);
  const arFilteredJobs=useMemo(()=>{let f=arActiveJobs;if(arPmF)f=f.filter(j=>j.pm===arPmF);if(arMktF)f=f.filter(j=>j.market===arMktF);return f;},[arActiveJobs,arPmF,arMktF]);
  const arStats=useMemo(()=>{const total=arFilteredJobs.length;let submitted=0,reviewed=0,missing=0;arFilteredJobs.forEach(j=>{const s=arSubByJob[j.id];if(!s)missing++;else if(s.ar_reviewed)reviewed++;else submitted++;});return{total,submitted,missing,reviewed};},[arFilteredJobs,arSubByJob]);
  const arTableData=useMemo(()=>{let data=arFilteredJobs.map(j=>{const sub=arSubByJob[j.id];const status=sub?(sub.ar_reviewed?'reviewed':'submitted'):'missing';return{job:j,sub,status};});if(arViewF!=='all')data=data.filter(d=>d.status===arViewF);const order={missing:0,submitted:1,reviewed:2};data.sort((a,b)=>order[a.status]-order[b.status]||(a.job.job_name||'').localeCompare(b.job.job_name||''));return data;},[arFilteredJobs,arSubByJob,arViewF]);
  const markArReviewed=async()=>{if(!arDetail)return;const amt=n(arForm.invoiced_amount);if(!amt){setToast({message:'Invoice amount is required',isError:true});return;}const s=arDetail.sub;try{await sbPatch('pm_bill_submissions',s.id,{ar_reviewed:true,ar_reviewed_at:new Date().toISOString(),ar_reviewed_by:arForm.ar_reviewed_by||'AR',ar_notes:arForm.ar_notes||null,invoiced_amount:amt,invoice_number:arForm.invoice_number||null,invoice_date:arForm.invoice_date||null});const job=jobs.find(j=>j.id===s.job_id);if(job){const newYTD=n(job.ytd_invoiced)+amt;const adj=n(job.adj_contract_value||job.contract_value);await sbPatch('jobs',job.id,{ytd_invoiced:newYTD,pct_billed:adj>0?Math.round(newYTD/adj*10000)/10000:0,left_to_bill:adj-newYTD,last_billed:arForm.invoice_date||new Date().toISOString().split('T')[0]});onRefresh();}setArDetail(null);setArForm({ar_notes:'',ar_reviewed_by:'',invoiced_amount:'',invoice_number:'',invoice_date:new Date().toISOString().split('T')[0]});fetchArSubs();setToast(`Reviewed — ${$(amt)} added to ${s.job_name} YTD invoiced`);}catch(e){setToast({message:e.message||'Review failed',isError:true});}};
  const openArDetail=(sub)=>{setArDetail({sub});setArForm({ar_notes:sub.ar_notes||'',ar_reviewed_by:sub.ar_reviewed_by||'',invoiced_amount:sub.invoiced_amount||'',invoice_number:sub.invoice_number||'',invoice_date:sub.invoice_date||new Date().toISOString().split('T')[0]});};
  const[resetConfirm,setResetConfirm]=useState(null);
  const arUnreviewed=useMemo(()=>arSubs.filter(s=>!s.ar_reviewed),[arSubs]);
  const arReviewedCount=useMemo(()=>arSubs.filter(s=>s.ar_reviewed).length,[arSubs]);
  const hasAnyReviewed=arReviewedCount>0;
  const resetMonth=async(pmFilter)=>{const toDelete=pmFilter?arUnreviewed.filter(s=>s.pm===pmFilter):arUnreviewed;if(!toDelete.length)return;let deleted=0;for(const s of toDelete){try{await fetch(`${SB}/rest/v1/pm_bill_submissions?id=eq.${s.id}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});deleted++;}catch(e){console.error('Delete failed:',s.id,e);}}setResetConfirm(null);fetchArSubs();const preserved=pmFilter?arSubs.filter(s=>s.ar_reviewed&&s.pm===pmFilter).length:arReviewedCount;setToast(`Reset complete — ${deleted} submissions cleared${preserved>0?', '+preserved+' reviewed preserved':''}`);};
  const AR_LF_SECTIONS=[{title:'Precast',bg:'#FEF3C7',fields:[['Post Only','labor_post_only'],['Post+Panels','labor_post_panels'],['Complete','labor_complete']]},{title:'Single Wythe',bg:'#DBEAFE',fields:[['Foundation','sw_foundation'],['Columns','sw_columns'],['Panels','sw_panels'],['Complete','sw_complete']]},{title:'One Line Items',bg:'#EDE9FE',fields:[['WI Gates','wi_gates'],['WI Fencing','wi_fencing'],['WI Columns','wi_columns'],['Bonds','line_bonds'],['Permits','line_permits'],['Remove','remove_existing'],['Gate Ctrl','gate_controls']]}];
  const thS={textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'};
  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Billing</h1>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}><KPI label="YTD Billed" value={$k(ty)} color="#065F46"/><KPI label="Left to Bill" value={$k(tl)} color="#B45309"/><KPI label="Avg Days to 1st Invoice" value={avgD>=0?avgD+'d':'—'} color={avgDColor}/><KPI label="100% Billed" value={fully} color="#065F46"/></div>
    {/* Tabs — 2 only */}
    <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'2px solid #E5E3E0'}}>
      {[['submissions','PM Submissions'],['alljobs','All Jobs']].map(([k,l])=><button key={k} onClick={()=>setBillingTab(k)} style={{padding:'10px 20px',border:'none',background:'transparent',color:billingTab===k?'#8B2020':'#6B6056',fontWeight:billingTab===k?700:400,fontSize:14,cursor:'pointer',borderBottom:billingTab===k?'2px solid #8B2020':'2px solid transparent',marginBottom:-2}}>{l}{k==='submissions'&&arStats.missing>0&&<span style={{marginLeft:6,background:'#FEE2E2',color:'#991B1B',padding:'1px 6px',borderRadius:8,fontSize:11,fontWeight:700}}>{arStats.missing} missing</span>}</button>)}
    </div>

    {/* ═══ TAB: PM SUBMISSIONS ═══ */}
    {billingTab==='submissions'&&<div>
      {/* Month + Filters */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,gap:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <label style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>Billing Month</label>
          <input type="month" value={arMonth} onChange={e=>setArMonth(e.target.value||curBillingMonth())} style={{...inputS,width:170}}/>
          <span style={{fontSize:14,fontWeight:800,color:'#8B2020'}}>{arMonthLabel}</span>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={sendBilReminders} disabled={bilRemindSending} style={{...btnP,padding:'8px 16px',fontSize:12,opacity:bilRemindSending?0.6:1}}>{bilRemindSending?'Sending...':'📧 Send Reminders'}</button>
          {arIsCurrent&&<button onClick={()=>setResetConfirm({type:'month'})} disabled={arUnreviewed.length===0} style={{background:'none',border:'1px solid #D1CEC9',borderRadius:6,padding:'6px 12px',fontSize:11,color:'#9E9B96',cursor:arUnreviewed.length===0?'not-allowed':'pointer',opacity:arUnreviewed.length===0?0.4:1}}>Reset Month</button>}
        </div>
      </div>
      {!arIsCurrent&&<div style={{background:'#FEF3C7',border:'1px solid #F9731640',borderRadius:8,padding:'8px 16px',marginBottom:14,fontSize:13,color:'#92400E',fontWeight:600}}>Viewing historical data — {arMonthLabel}</div>}
      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,color:'#9E9B96',fontWeight:600}}>PM:</span>
        <button onClick={()=>setArPmF('')} style={fpill(!arPmF)}>All PMs</button>
        {PM_LIST.map(p=><span key={p.id} style={{display:'inline-flex',alignItems:'center',gap:2}}><button onClick={()=>setArPmF(p.id)} style={fpill(arPmF===p.id)}>{p.short}</button>{arIsCurrent&&arUnreviewed.some(s=>s.pm===p.id)&&<button onClick={()=>setResetConfirm({type:'pm',pm:p.id,label:p.short})} title={`Reset ${p.short}'s unreviewed`} style={{background:'none',border:'none',color:'#9E9B96',fontSize:12,cursor:'pointer',padding:'0 2px',lineHeight:1}}>↺</button>}</span>)}
        <span style={{color:'#E5E3E0'}}>|</span>
        <span style={{fontSize:11,color:'#9E9B96',fontWeight:600}}>Market:</span>
        <button onClick={()=>setArMktF(null)} style={fpill(!arMktF)}>All</button>
        {MKTS.map(m=><button key={m} onClick={()=>setArMktF(m)} style={fpill(arMktF===m)}>{MS[m]}</button>)}
        <span style={{color:'#E5E3E0'}}>|</span>
        <span style={{fontSize:11,color:'#9E9B96',fontWeight:600}}>View:</span>
        {[['all','All Jobs'],['missing','Missing Only'],['submitted','Submitted'],['reviewed','Reviewed']].map(([k,l])=><button key={k} onClick={()=>setArViewF(k)} style={fpill(arViewF===k)}>{l}</button>)}
      </div>
      {/* Summary stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #8B2020'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20}}>{arStats.total}</div><div style={{fontSize:11,color:'#6B6056'}}>Total Active Jobs</div></div>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #10B981'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#10B981'}}>{arStats.submitted}</div><div style={{fontSize:11,color:'#6B6056'}}>Submitted</div></div>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #EF4444'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#EF4444'}}>{arStats.missing}</div><div style={{fontSize:11,color:'#6B6056'}}>Missing</div></div>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #3B82F6'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#3B82F6'}}>{arStats.reviewed}</div><div style={{fontSize:11,color:'#6B6056'}}>Reviewed by AR</div></div>
      </div>
      {/* Main table */}
      <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 480px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}>
            <tr>{['Job #','Job Name','PM','Market','Style','Color','Height','Bill Sheet','Submitted Date','% Complete','AR Status','Actions'].map(h=><th key={h} style={thS}>{h}</th>)}</tr>
          </thead>
          <tbody>{arTableData.map(({job:j,sub,status})=>{
            const borderColor=status==='missing'?'#EF4444':status==='reviewed'?'#3B82F6':'#10B981';
            return<tr key={j.id} style={{borderBottom:'1px solid #F4F4F2',borderLeft:`3px solid ${borderColor}`,opacity:status==='reviewed'?0.75:1}}>
              <td style={{padding:'8px 10px',fontSize:11}}>{j.job_number||'—'}</td>
              <td style={{padding:'8px 10px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><span onClick={e=>{e.stopPropagation();setBilQuickView(j);}} style={{cursor:'pointer',borderBottom:'1px dashed transparent'}} onMouseEnter={e=>e.currentTarget.style.borderBottomColor='#8B2020'} onMouseLeave={e=>e.currentTarget.style.borderBottomColor='transparent'}>{j.job_name||'—'}</span></td>
              <td style={{padding:'8px 10px',fontSize:11}}>{j.pm||'—'}</td>
              <td style={{padding:'8px 10px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td>
              <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056'}}>{j.style||'—'}</td>
              <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056'}}>{j.color||'—'}</td>
              <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056'}}>{j.height_precast||'—'}</td>
              <td style={{padding:'8px 10px'}}>{status==='missing'?<span style={pill('#991B1B','#FEE2E2')}>✗ Missing</span>:status==='reviewed'?<span style={pill('#1D4ED8','#DBEAFE')}>● Reviewed</span>:<span style={pill('#065F46','#D1FAE5')}>✓ Submitted</span>}</td>
              <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056'}}>{sub&&sub.submitted_at?new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'}</td>
              <td style={{padding:'8px 10px',fontSize:11}}>{sub&&sub.pct_complete_pm!=null?sub.pct_complete_pm+'%':'—'}</td>
              <td style={{padding:'8px 10px'}}>{sub&&sub.ar_reviewed?<span style={pill('#1D4ED8','#DBEAFE')}>Reviewed</span>:sub?<span style={pill('#B45309','#FEF3C7')}>Pending Review</span>:<span style={{color:'#9E9B96',fontSize:11}}>—</span>}</td>
              <td style={{padding:'8px 10px'}}><div style={{display:'flex',gap:4}}>
                {status==='missing'&&<button onClick={()=>setToast('Reminder noted for '+(j.pm||'PM'))} style={{background:'#FEF3C7',border:'1px solid #F9731640',borderRadius:6,color:'#B45309',fontSize:11,fontWeight:600,cursor:'pointer',padding:'4px 10px',whiteSpace:'nowrap'}}>Send Reminder</button>}
                {sub&&<button onClick={()=>openArDetail(sub)} style={{background:'#FDF4F4',border:'1px solid #8B202030',borderRadius:6,color:'#8B2020',fontSize:11,fontWeight:700,cursor:'pointer',padding:'4px 10px'}}>View</button>}
              </div></td>
            </tr>;})}
          </tbody>
        </table>
        {arTableData.length===0&&<div style={{padding:40,textAlign:'center'}}><div style={{color:'#9E9B96',fontSize:14}}>No jobs match current filters</div></div>}
      </div>
    </div>}

    {/* ═══ TAB: ALL JOBS ═══ */}
    {billingTab==='alljobs'&&<div>
      <div style={{...card,marginBottom:24}}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Billing by Market</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>{MKTS.map(m=>{const mj=active.filter(j=>j.market===m);const mc=mj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const mb=mj.reduce((s,j)=>s+n(j.ytd_invoiced),0);const mp=mc>0?Math.round(mb/mc*100):0;return<div key={m}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span style={{fontWeight:600,color:MC[m]}}>{MS[m]}</span><span style={{color:'#6B6056'}}>{mp}%</span></div><PBar pct={mp} color={MC[m]} h={8}/></div>;})}</div></div>
      <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}>
        <input value={bSearch} onChange={e=>setBSearch(e.target.value)} placeholder="Search by job name, number, or customer..." style={{...inputS,width:280}}/>
        <button onClick={()=>setBMktF(null)} style={fpill(!bMktF)}>All</button>
        {MKTS.map(m=><button key={m} onClick={()=>setBMktF(m)} style={fpill(bMktF===m)}>{MS[m]}</button>)}
        <select value={bPmF} onChange={e=>setBPmF(e.target.value)} style={{...inputS,width:160}}><option value="">All PMs</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <button onClick={()=>setBStatusF(null)} style={fpill(!bStatusF)}>All</button>
        <button onClick={()=>setBStatusF('zero')} style={fpill(bStatusF==='zero')}>0% Billed</button>
        <span style={{fontSize:12,color:'#6B6056'}}>{shown.length} jobs</span>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:12}}><span style={{fontSize:12,color:'#6B6056',lineHeight:'28px'}}>Billing Method:</span><button onClick={()=>setBillingF(null)} style={fpill(!billingF)}>All</button>{['Progress','Lump Sum','Milestone','AIA','T&M'].map(m=><button key={m} onClick={()=>setBillingF(m)} style={fpill(billingF===m)}>{m}</button>)}</div>
      <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 440px)'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}>
        <tr>{['Project','Style','Color','Market','Status','Contract','YTD Invoiced','Left to Bill','% Billed','Last Billed',''].map(h=><th key={h} style={thS}>{h}</th>)}</tr>
        </thead>
        <tbody>{shown.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
          <td style={{padding:'8px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}}><span onClick={e=>{e.stopPropagation();setBilQuickView(j);}} style={{cursor:'pointer',borderBottom:'1px dashed transparent'}} onMouseEnter={e=>e.currentTarget.style.borderBottomColor='#8B2020'} onMouseLeave={e=>e.currentTarget.style.borderBottomColor='transparent'}>{j.job_name}</span></td>
          <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={j.style||''}>{j.style||'—'}</td>
          <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={j.color||''}>{j.color||'—'}</td>
          <td style={{padding:'8px 10px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td>
          <td style={{padding:'8px 10px'}}><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]}</span></td>
          <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td>
          <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:600,color:'#065F46'}}>{$(j.ytd_invoiced)}</td>
          <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:800,color:n(j.left_to_bill)>100000?'#991B1B':n(j.left_to_bill)>50000?'#B45309':'#065F46',fontSize:13}}>{$(j.left_to_bill)}</td>
          <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}><PBar pct={n(j.pct_billed)*100} h={4}/><span style={{fontSize:11}}>{fmtPct(j.pct_billed)}</span></div></td>
          <td style={{padding:'8px 10px'}} onClick={()=>startEdit(j,'last_billed')}>{editId===j.id&&editField==='last_billed'?<input autoFocus type="date" value={editVal||''} onChange={e=>setEditVal(e.target.value)} onBlur={()=>saveEdit(j)} onKeyDown={e=>e.key==='Enter'&&saveEdit(j)} style={{...inputS,width:130,padding:'4px 8px'}}/>:<span style={{cursor:'pointer',borderBottom:'1px dashed #E5E3E0'}}>{fD(j.last_billed)}</span>}</td>
          <td style={{padding:'8px 10px'}}><button onClick={()=>setConfirmFullJob(j)} title="Mark 100% billed" style={{background:'#D1FAE5',border:'1px solid #065F4630',borderRadius:6,color:'#065F46',fontSize:14,cursor:'pointer',padding:'2px 8px'}}>✓</button></td>
        </tr>)}</tbody></table></div>
      {/* Recently Fully Billed */}
      <div style={{marginTop:24}}>
        <button onClick={()=>setShowRecent(!showRecent)} style={{display:'flex',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',fontFamily:'Inter',fontWeight:700,fontSize:14,color:'#6B6056',padding:0,marginBottom:showRecent?12:0}}>
          <span style={{fontSize:12,transition:'transform .2s',transform:showRecent?'rotate(90deg)':'rotate(0deg)',display:'inline-block'}}>▶</span>
          Recently Fully Billed ({recentlyBilled.length})
        </button>
        {showRecent&&<div style={{...card,padding:0,overflow:'auto',maxHeight:360}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Job Name','Market','Contract Value','Date Billed','Sales Rep',''].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>{recentlyBilled.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
              <td style={{padding:'8px 10px',fontWeight:500,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td>
              <td style={{padding:'8px 10px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td>
              <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td>
              <td style={{padding:'8px 10px'}}>{fD(j.last_billed)}</td>
              <td style={{padding:'8px 10px'}}>{j.sales_rep||'—'}</td>
              <td style={{padding:'8px 10px'}}><button onClick={()=>setUndoJob(j)} style={{background:'#FEF3C7',border:'1px solid #B4530930',borderRadius:6,color:'#B45309',fontSize:11,fontWeight:600,cursor:'pointer',padding:'3px 10px'}}>Undo</button></td>
            </tr>)}</tbody>
          </table>
          {recentlyBilled.length===0&&<div style={{padding:20,textAlign:'center',color:'#9E9B96'}}>No fully billed jobs</div>}
        </div>}
      </div>
    </div>}

    {resetConfirm&&(()=>{const isPm=resetConfirm.type==='pm';const toDelete=isPm?arUnreviewed.filter(s=>s.pm===resetConfirm.pm):arUnreviewed;const preserved=isPm?arSubs.filter(s=>s.ar_reviewed&&s.pm===resetConfirm.pm).length:arReviewedCount;return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setResetConfirm(null)}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:460,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:12,color:'#1A1A1A'}}>{isPm?`Reset ${resetConfirm.label}'s Bill Sheets?`:`Reset All Bill Sheets for ${arMonthLabel}?`}</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7,marginBottom:20}}>This will delete <b style={{color:'#991B1B'}}>{toDelete.length}</b> unreviewed submission{toDelete.length!==1?'s':''}. {preserved>0?<><b style={{color:'#1D4ED8'}}>{preserved}</b> reviewed submission{preserved!==1?'s':''} will NOT be affected. </>:''}PMs will need to resubmit. This cannot be undone.</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setResetConfirm(null)} style={btnS}>Cancel</button><button onClick={()=>resetMonth(isPm?resetConfirm.pm:null)} style={{...btnP,background:'#991B1B'}}>Reset Unreviewed ({toDelete.length})</button></div>
      </div>
    </div>;})()}
    {bilQuickView&&<ProjectQuickView job={bilQuickView} onClose={()=>setBilQuickView(null)} billSub={arSubByJob[bilQuickView.id]}/>}
    {/* AR Detail Modal */}
    {arDetail&&(()=>{const s=arDetail.sub;const arJob=jobs.find(x=>x.id===s.job_id)||{};return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>{setArDetail(null);setArForm({ar_notes:'',ar_reviewed_by:''});}}>
      <div style={{background:'#fff',borderRadius:16,padding:24,width:600,maxWidth:'94vw',maxHeight:'92vh',overflow:'auto',boxShadow:'0 8px 30px rgba(0,0,0,0.18)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
          <div style={{fontSize:18,fontWeight:800,color:'#1A1A1A'}}>{s.job_name}</div>
          {s.ar_reviewed?<span style={pill('#1D4ED8','#DBEAFE')}>Reviewed</span>:<span style={pill('#B45309','#FEF3C7')}>Pending Review</span>}
        </div>
        <div style={{fontSize:12,color:'#6B6056',marginBottom:4}}>#{s.job_number} · {s.pm} · {MS[s.market]||s.market||'—'}</div>
        <div style={{display:'flex',gap:8,marginBottom:12,fontSize:12,color:'#6B6056',flexWrap:'wrap'}}>
          {s.style&&<span>Style: <b style={{color:'#1A1A1A'}}>{s.style}</b></span>}
          {s.color&&<span>Color: <b style={{color:'#1A1A1A'}}>{s.color}</b></span>}
          {s.height&&<span>Height: <b style={{color:'#1A1A1A'}}>{s.height}ft</b></span>}
          {n(s.adj_contract_value)>0&&<span>Contract: <b style={{color:'#1A1A1A'}}>{$(s.adj_contract_value)}</b></span>}
        </div>
        <div style={{fontSize:11,color:'#9E9B96',marginBottom:14}}>Submitted {s.submitted_at?new Date(s.submitted_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'}{s.submitted_by?' by '+s.submitted_by:''}</div>
        {/* LF Sections */}
        <div style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>LF Detail</div>
          {AR_LF_SECTIONS.map(sec=>{const hasData=sec.fields.some(([,f])=>n(s[f])>0);if(!hasData)return null;return<div key={sec.title} style={{marginBottom:8}}>
            <div style={{fontSize:9,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4,padding:'3px 6px',background:sec.bg,borderRadius:4,display:'inline-block'}}>{sec.title}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:6}}>
              {sec.fields.map(([label,field])=>{const v=n(s[field]);return v>0?<div key={field} style={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,padding:'4px 8px'}}>
                <div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase'}}>{label}</div>
                <div style={{fontFamily:'Inter',fontSize:13,fontWeight:700}}>{v.toLocaleString()}</div>
              </div>:null;}).filter(Boolean)}
            </div>
          </div>;})}
          <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #E5E3E0',display:'flex',gap:16}}>
            <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Total LF</div><div style={{fontFamily:'Inter',fontSize:15,fontWeight:800,color:'#8B2020'}}>{n(s.total_lf).toLocaleString()}</div></div>
            {s.pct_complete_pm!=null&&<div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>PM % Complete</div><div style={{fontFamily:'Inter',fontSize:15,fontWeight:800}}>{s.pct_complete_pm}%</div></div>}
          </div>
          {(n(arJob.lf_precast)>0||n(arJob.lf_installed_to_date)>0)&&(()=>{const existing=n(arJob.lf_installed_to_date);const thisSub=n(s.total_lf);const afterTotal=s.ar_reviewed?existing:existing+thisSub;const contracted=n(arJob.lf_precast)||n(arJob.total_lf);const pctAfter=contracted>0?Math.round(afterTotal/contracted*100):0;return<div style={{marginTop:8,padding:'8px 10px',background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:6,fontSize:12,color:'#1D4ED8'}}>
            {s.ar_reviewed?<span>📊 <b>LF installed to date:</b> {existing.toLocaleString()} LF ({pctAfter}% of {contracted.toLocaleString()} LF contracted)</span>:<span>📊 <b>LF installed after this submission:</b> {existing.toLocaleString()} + {thisSub.toLocaleString()} = <b>{afterTotal.toLocaleString()} LF</b> ({pctAfter}% of {contracted.toLocaleString()} contracted)</span>}
          </div>;})()}
        </div>
        {s.notes&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:14}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',marginBottom:4}}>PM Notes</div><div style={{fontSize:13,color:'#1A1A1A',whiteSpace:'pre-wrap'}}>{s.notes}</div></div>}
        {/* AR Review Section */}
        <div style={{border:'1px solid #E5E3E0',borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,color:'#1A1A1A',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>AR Review & Invoice</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Invoice Amount ($) *</label>
              <input type="number" value={arForm.invoiced_amount} onChange={e=>setArForm(p=>({...p,invoiced_amount:e.target.value}))} placeholder="0" style={inputS} disabled={s.ar_reviewed}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Invoice Number</label>
              <input value={arForm.invoice_number} onChange={e=>setArForm(p=>({...p,invoice_number:e.target.value}))} placeholder="Optional" style={inputS} disabled={s.ar_reviewed}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Invoice Date</label>
              <input type="date" value={arForm.invoice_date} onChange={e=>setArForm(p=>({...p,invoice_date:e.target.value}))} style={inputS} disabled={s.ar_reviewed}/>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>AR Notes</label>
            <textarea value={arForm.ar_notes} onChange={e=>setArForm(p=>({...p,ar_notes:e.target.value}))} rows={2} placeholder="Review notes, adjustments, flags..." style={{...inputS,resize:'vertical'}} disabled={s.ar_reviewed}/>
          </div>
          <div>
            <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Reviewer Name</label>
            <input value={arForm.ar_reviewed_by} onChange={e=>setArForm(p=>({...p,ar_reviewed_by:e.target.value}))} placeholder="Your name" style={inputS} disabled={s.ar_reviewed}/>
          </div>
          {s.ar_reviewed&&<div style={{marginTop:10,padding:10,background:'#EFF6FF',borderRadius:8}}>
            <div style={{fontSize:12,color:'#1D4ED8',fontWeight:600}}>Reviewed by {s.ar_reviewed_by||'AR'} on {s.ar_reviewed_at?new Date(s.ar_reviewed_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'—'}</div>
            {n(s.invoiced_amount)>0&&<div style={{fontSize:12,color:'#065F46',fontWeight:600,marginTop:4}}>Invoice: {$(s.invoiced_amount)}{s.invoice_number?' — #'+s.invoice_number:''}{s.invoice_date?' — '+fD(s.invoice_date):''}</div>}
          </div>}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          {s.ar_reviewed&&<button onClick={()=>{setBilAdminPin(s);setBilPin('');setBilPinErr(false);}} style={{background:'none',border:'none',padding:0,fontSize:10,color:'#9E9B96',cursor:'pointer',textDecoration:'underline',marginRight:'auto'}}>Admin Reset</button>}
          <button onClick={()=>{setArDetail(null);setArForm({ar_notes:'',ar_reviewed_by:'',invoiced_amount:'',invoice_number:'',invoice_date:new Date().toISOString().split('T')[0]});}} style={btnS}>Close</button>
          {!s.ar_reviewed&&<button onClick={markArReviewed} style={{...btnP,background:'#1D4ED8'}}>Mark as Reviewed</button>}
        </div>
      </div>
    </div>;})()}
    {/* Confirm Mark Full Modal */}
    {confirmFullJob&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setConfirmFullJob(null)}>
      <div style={{background:'#fff',borderRadius:16,padding:28,width:440,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:17,fontWeight:800,marginBottom:16,color:'#1A1A1A'}}>Mark as 100% Billed?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7,marginBottom:8}}>
          This will set YTD Invoiced to <span style={{fontWeight:700,color:'#1A1A1A'}}>{$(n(confirmFullJob.adj_contract_value||confirmFullJob.contract_value))}</span> for <span style={{fontWeight:700,color:'#1A1A1A'}}>{confirmFullJob.job_name}</span>.
        </div>
        <div style={{fontSize:13,color:'#6B6056',marginBottom:20}}>
          Current YTD Invoiced: <span style={{fontWeight:700,color:'#1A1A1A'}}>{$(confirmFullJob.ytd_invoiced)}</span>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setConfirmFullJob(null)} style={btnS}>Cancel</button><button onClick={confirmMarkFull} style={btnP}>Confirm — Mark Fully Billed</button></div>
      </div>
    </div>}
    {/* Confirm Undo Modal */}
    {undoJob&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setUndoJob(null)}>
      <div style={{background:'#fff',borderRadius:16,padding:28,width:420}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:16,fontWeight:800,marginBottom:12}}>Undo billing for {undoJob.job_name}?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.6,marginBottom:20}}>
          This will reset YTD Invoiced from <span style={{fontFamily:'Inter',fontWeight:700,color:'#1A1A1A'}}>{$(undoJob.ytd_invoiced)}</span> back to <span style={{fontFamily:'Inter',fontWeight:700,color:'#991B1B'}}>$0</span>.
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setUndoJob(null)} style={btnS}>Cancel</button><button onClick={confirmUndo} style={{...btnP,background:'#991B1B'}}>Confirm Undo</button></div>
      </div>
    </div>}
    {bilAdminPin&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>{setBilAdminPin(null);setBilPin('');setBilPinErr(false);}}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:380,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:6,color:'#1A1A1A'}}>Admin Override Required</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.6,marginBottom:16}}>This submission for <b>{bilAdminPin.job_name}</b> has been reviewed by AR. Enter admin PIN to reset.</div>
        <input autoFocus type="password" inputMode="numeric" maxLength={4} value={bilPin} onChange={e=>{setBilPin(e.target.value.replace(/\D/g,'').slice(0,4));setBilPinErr(false);}} onKeyDown={e=>{if(e.key==='Enter'){if(bilPin==='2020')bilAdminReset(bilAdminPin);else setBilPinErr(true);}}} placeholder="••••" style={{width:'100%',padding:'12px 16px',fontSize:20,textAlign:'center',letterSpacing:8,border:`2px solid ${bilPinErr?'#DC2626':'#E5E3E0'}`,borderRadius:10,marginBottom:8,fontFamily:'Inter',fontWeight:700}}/>
        {bilPinErr&&<div style={{color:'#DC2626',fontSize:12,fontWeight:600,textAlign:'center',marginBottom:8}}>Incorrect PIN</div>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>{setBilAdminPin(null);setBilPin('');setBilPinErr(false);}} style={btnS}>Cancel</button><button onClick={()=>{if(bilPin==='2020')bilAdminReset(bilAdminPin);else setBilPinErr(true);}} style={{...btnP,background:'#991B1B'}}>Confirm</button></div>
      </div>
    </div>}
  </div>);
}

/* ═══ PM BILLING PAGE ═══ */
const ACTIVE_BILL_STATUSES=['in_production','inventory_ready','active_install','fence_complete','fully_complete'];

function PMBillingPage({jobs,onRefresh,refreshKey=0}){
  // Line items are fetched lazily — only when a job row is expanded — keyed by job_number.
  // This replaces the prior bulk fetch to keep the initial page load fast.
  const[pmLineItemsByJob,setPmLineItemsByJob]=useState({});
  const fetchLineItemsForJob=useCallback(async(jobNumber)=>{
    if(!jobNumber||pmLineItemsByJob[jobNumber])return;
    try{
      const d=await sbGet('job_line_items',`select=*&job_number=eq.${encodeURIComponent(jobNumber)}&order=line_number.asc&limit=50`);
      setPmLineItemsByJob(prev=>({...prev,[jobNumber]:d||[]}));
    }catch(e){console.error('[PMBill] line items fetch failed:',e);}
  },[pmLineItemsByJob]);
  // Clear cached line items on global refresh so lazy loads re-fetch fresh data
  useEffect(()=>{setPmLineItemsByJob({});},[refreshKey]);
  // Approved CO totals per job — used in the "COs" column
  const[pmAllCOs,setPmAllCOs]=useState([]);
  useEffect(()=>{sbGet('change_orders','select=job_id,amount,status&limit=2000').then(d=>setPmAllCOs(d||[])).catch(()=>{});},[refreshKey]);
  const pmApprovedCOByJob=useMemo(()=>{const m={};pmAllCOs.forEach(c=>{if(c.status!=='Approved')return;if(!m[c.job_id])m[c.job_id]=0;m[c.job_id]+=n(c.amount);});return m;},[pmAllCOs]);
  const[selPM,setSelPM]=useState(()=>localStorage.getItem('fc_pm')||'');
  const[selMonth,setSelMonth]=useState(curBillingMonth);
  const[subs,setSubs]=useState([]);
  const[expandedRow,setExpandedRow]=useState(null);
  const[forms,setForms]=useState({});
  const[editingRow,setEditingRow]=useState(null);
  const[saving,setSaving]=useState(null);
  const[toast,setToast]=useState(null);
  const[filterTab,setFilterTab]=useState('missing');
  const[selected,setSelected]=useState(new Set());
  const[showBatchConfirm,setShowBatchConfirm]=useState(false);
  const[batchSubmitting,setBatchSubmitting]=useState(false);
  const[confirmReset,setConfirmReset]=useState(null);
  const[adminPinJob,setAdminPinJob]=useState(null);const[adminPin,setAdminPin]=useState('');const[adminPinErr,setAdminPinErr]=useState(false);
  // Accent/add-ons filter — when true, only show jobs with at least one non-zero accent field
  const[hasAddOnsFilter,setHasAddOnsFilter]=useState(false);
  // Per-job accent helpers
  const gateValueOf=(j)=>n(j.number_of_gates)*n(j.gate_rate);
  const hasAnyAddOn=(j)=>n(j.lf_single_wythe)>0||n(j.lf_wrought_iron)>0||n(j.number_of_gates)>0||gateValueOf(j)>0||n(j.lf_removal)>0||n(j.lump_sum_amount)>0||((j.lump_sum_description||'').trim().length>0);
  const truncDesc=(s,lim=30)=>{if(!s)return'';const t=String(s);return t.length>lim?t.slice(0,lim)+'…':t;};

  const LF_FIELDS=['labor_post_only','labor_post_panels','labor_complete','sw_foundation','sw_columns','sw_panels','sw_complete','wi_gates','wi_fencing','wi_columns','line_bonds','line_permits','remove_existing','gate_controls'];
  const calcLFTotal=(form)=>LF_FIELDS.reduce((s,f)=>s+n(form[f]),0);
  const emptyForm=()=>({pct_complete:'',notes:'',...Object.fromEntries(LF_FIELDS.map(f=>[f,'']))});
  const pickPM=pm=>{setSelPM(pm);localStorage.setItem('fc_pm',pm);setExpandedRow(null);setEditingRow(null);setSelected(new Set());};
  const selMonthLabel=monthLabel(selMonth);
  const activeJobs=useMemo(()=>{let j2=jobs.filter(j=>ACTIVE_BILL_STATUSES.includes(j.status));if(selPM)j2=j2.filter(j=>j.pm===selPM);return j2.sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||''));},[jobs,selPM]);
  const fetchSubs=useCallback(async()=>{if(!selPM)return;const d=await sbGet('pm_bill_submissions',`billing_month=eq.${selMonth}&pm=eq.${selPM}&order=created_at.desc`);setSubs(d||[]);},[selMonth,selPM]);
  useEffect(()=>{fetchSubs();},[fetchSubs,refreshKey]);
  const subByJob=useMemo(()=>{const m={};(subs||[]).forEach(s=>{if(!m[s.job_id])m[s.job_id]=s;});return m;},[subs]);
  const submittedCount=activeJobs.filter(j=>subByJob[j.id]).length;
  const reviewedCount=activeJobs.filter(j=>{const s=subByJob[j.id];return s&&s.ar_reviewed;}).length;
  const submittedNotReviewed=submittedCount-reviewedCount;
  const missingCount=activeJobs.length-submittedCount;
  const totalCount=activeJobs.length;
  const pct=totalCount>0?Math.round(submittedCount/totalCount*100):0;
  const pctColor=pct>=100?'#10B981':pct>50?'#F59E0B':'#EF4444';
  const totalLFSubmitted=useMemo(()=>(subs||[]).reduce((s,x)=>s+n(x.total_lf),0),[subs]);

  const getStatus=(j)=>{const s=subByJob[j.id];if(!s)return'missing';if(s.ar_reviewed)return'reviewed';return'submitted';};
  const filteredJobs=useMemo(()=>{
    let f=filterTab==='all'?activeJobs:activeJobs.filter(j=>getStatus(j)===filterTab);
    if(hasAddOnsFilter)f=f.filter(hasAnyAddOn);
    return f;
  },[activeJobs,filterTab,subByJob,hasAddOnsFilter]);// eslint-disable-line

  const getForm=(jobId)=>forms[jobId]||emptyForm();
  const updateForm=(jobId,field,val)=>setForms(prev=>({...prev,[jobId]:{...(prev[jobId]||emptyForm()),[field]:val}}));
  const expandRow=(jobId)=>{if(expandedRow===jobId){setExpandedRow(null);setEditingRow(null);}else{setExpandedRow(jobId);setEditingRow(null);const j=jobs.find(x=>x.id===jobId);if(j)fetchLineItemsForJob(j.job_number);}};
  const openEdit=(job,sub)=>{const form={pct_complete:sub.pct_complete_pm!=null?String(sub.pct_complete_pm):'',notes:sub.notes||'',...Object.fromEntries(LF_FIELDS.map(f=>[f,n(sub[f])!==0?String(n(sub[f])):'']))};setForms(prev=>({...prev,[job.id]:form}));setEditingRow(job.id);setExpandedRow(job.id);};

  const resetSub=async(job,isAdmin)=>{const sub=subByJob[job.id];if(!sub)return;try{await fetch(`${SB}/rest/v1/pm_bill_submissions?id=eq.${sub.id}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});if(isAdmin){try{await sbPost('activity_log',{job_id:job.id,job_number:job.job_number,job_name:job.job_name,action:'admin_bill_sheet_reset',field_name:'pm_bill_submissions',old_value:'reviewed',new_value:'reset',changed_by:'admin'});}catch(e2){}}setSubs(prev=>prev.filter(s=>s.id!==sub.id));setConfirmReset(null);setAdminPinJob(null);setAdminPin('');setToast(isAdmin?'Submission reset by admin':`Bill sheet reset for ${job.job_name}`);}catch(e){setToast({message:e.message||'Reset failed',isError:true});}};

  const buildPayload=(job,formVals)=>({billing_month:selMonth,job_id:job.id,job_number:job.job_number,job_name:job.job_name,pm:selPM,market:job.market,style:job.style||null,color:job.color||null,height:job.height_precast||null,adj_contract_value:parseFloat(job.adj_contract_value)||0,total_lf:parseInt(job.total_lf)||0,labor_post_only:parseFloat(formVals.labor_post_only)||0,labor_post_panels:parseFloat(formVals.labor_post_panels)||0,labor_complete:parseFloat(formVals.labor_complete)||0,sw_foundation:parseFloat(formVals.sw_foundation)||0,sw_columns:parseFloat(formVals.sw_columns)||0,sw_panels:parseFloat(formVals.sw_panels)||0,sw_complete:parseFloat(formVals.sw_complete)||0,wi_gates:parseFloat(formVals.wi_gates)||0,wi_fencing:parseFloat(formVals.wi_fencing)||0,wi_columns:parseFloat(formVals.wi_columns)||0,line_bonds:parseFloat(formVals.line_bonds)||0,line_permits:parseFloat(formVals.line_permits)||0,remove_existing:parseFloat(formVals.remove_existing)||0,gate_controls:parseFloat(formVals.gate_controls)||0,lf_panels_washed:0,pct_complete_pm:parseFloat(formVals.pct_complete)||0,notes:formVals.notes||null,submitted_by:selPM,submitted_at:new Date().toISOString(),ar_reviewed:false});

  const submitEntry=async(job)=>{const form=getForm(job.id);setSaving(job.id);try{const payload=buildPayload(job,form);const res=await fetch(`${SB}/rest/v1/pm_bill_submissions`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});const resTxt=await res.text();if(!res.ok)throw new Error(`Save failed (${res.status}): ${resTxt}`);const saved=resTxt?JSON.parse(resTxt):[];const rec=saved[0]||saved;const existing=subByJob[job.id];if(existing){setSubs(prev=>prev.map(s=>s.id===existing.id?rec:s));}else{setSubs(prev=>[rec,...prev]);}setToast(`Submitted: ${job.job_name}`);fetch(`${SB}/functions/v1/bill-sheet-submitted-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submission:rec,job})}).catch(e=>console.error('Notification failed:',e));setEditingRow(null);setExpandedRow(null);}catch(e){setToast({message:e.message||'Submit failed',isError:true});}setSaving(null);};

  // CSV export with all 19 columns matching the on-screen table
  const exportPMBillCSV=()=>{
    const headers=['Job #','Job Name','Customer','Market','PM','Status','PC LF','SW LF','WI LF','# Gates','Gate Value','Removal LF','Lump Sum','Lump Sum Desc','Contract Value','Adj Contract Value','YTD Invoiced','% Billed','Left to Bill'];
    const csvEscape=v=>{if(v==null)return'';const s=String(v);return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
    const rows=filteredJobs.map(j=>{
      const status=getStatus(j);
      const gv=gateValueOf(j);
      return[j.job_number||'',j.job_name||'',j.customer_name||'',j.market||'',j.pm||'',SL[j.status]||j.status||'',lfPC(j)||0,n(j.lf_single_wythe)||0,n(j.lf_wrought_iron)||0,n(j.number_of_gates)||0,gv||0,n(j.lf_removal)||0,n(j.lump_sum_amount)||0,j.lump_sum_description||'',n(j.contract_value)||0,n(j.adj_contract_value)||0,n(j.ytd_invoiced)||0,j.pct_billed!=null?Math.round(n(j.pct_billed)*100)+'%':'',n(j.left_to_bill)||0];
    });
    const csv=[headers.map(csvEscape).join(','),...rows.map(r=>r.map(csvEscape).join(','))].join('\n');
    const b=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`pm-bill-sheet-${selMonth}.csv`;a.click();
  };
  const missingJobs=activeJobs.filter(j=>!subByJob[j.id]);
  const toggleSelect=(jobId)=>setSelected(prev=>{const s=new Set(prev);if(s.has(jobId))s.delete(jobId);else s.add(jobId);return s;});
  const toggleSelectAll=()=>{if(selected.size===missingJobs.length)setSelected(new Set());else setSelected(new Set(missingJobs.map(j=>j.id)));};
  const batchSubmitNoActivity=async()=>{setBatchSubmitting(true);const toSubmit=missingJobs.filter(j=>selected.has(j.id));const emptyF={pct_complete:'0',notes:'No activity this month',...Object.fromEntries(LF_FIELDS.map(f=>[f,'0']))};let success=0;const newRecs=[];for(const job of toSubmit){try{const payload=buildPayload(job,emptyF);const res=await fetch(`${SB}/rest/v1/pm_bill_submissions`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});if(res.ok){const txt=await res.text();const saved=JSON.parse(txt);newRecs.push(saved[0]||saved);success++;}}catch(e){console.error('Batch submit failed for',job.job_number,e);}}setSubs(prev=>[...newRecs,...prev.filter(s=>!newRecs.some(n2=>n2.id===s.id))]);setSelected(new Set());setShowBatchConfirm(false);setBatchSubmitting(false);setToast(`Submitted ${success} jobs with no activity`);};

  if(!selPM)return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:24}}>PM Bill Sheet</h1>
    <div style={{...card,textAlign:'center',padding:40}}>
      <div style={{fontSize:16,color:'#6B6056',marginBottom:20}}>Select your name to get started</div>
      <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>{PM_LIST.map(pm=><button key={pm.id} onClick={()=>pickPM(pm.id)} style={{padding:'14px 32px',borderRadius:12,border:'2px solid #E5E3E0',background:'#FFF',color:'#1A1A1A',fontSize:16,fontWeight:700,cursor:'pointer',transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.background='#8B2020';e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='#8B2020';}} onMouseLeave={e=>{e.currentTarget.style.background='#FFF';e.currentTarget.style.color='#1A1A1A';e.currentTarget.style.borderColor='#E5E3E0';}}>{pm.label}</button>)}</div>
    </div>
  </div>);

  const LF_SECTIONS=[{title:'Precast',bg:'#FEF3C7',fields:[['Post Only','labor_post_only'],['Post+Panels','labor_post_panels'],['Complete','labor_complete']]},{title:'Single Wythe',bg:'#DBEAFE',fields:[['Foundation','sw_foundation'],['Columns','sw_columns'],['Panels','sw_panels'],['Complete','sw_complete']]},{title:'One Line Items',bg:'#EDE9FE',fields:[['WI Gates','wi_gates'],['WI Fencing','wi_fencing'],['WI Columns','wi_columns'],['Bonds','line_bonds'],['Permits','line_permits'],['Remove','remove_existing'],['Gate Ctrl','gate_controls']]}];
  const renderLFReadOnly=(sub)=>LF_SECTIONS.map(sec=>{const hasData=sec.fields.some(([,f])=>n(sub[f])>0);if(!hasData)return null;return<div key={sec.title} style={{marginBottom:8}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4,padding:'3px 8px',background:sec.bg,borderRadius:4,display:'inline-block'}}>{sec.title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:6}}>{sec.fields.map(([label,field])=>{const v=n(sub[field]);return v>0?<div key={field} style={{background:'#F9F8F6',borderRadius:6,padding:'4px 8px'}}><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase'}}>{label}</div><div style={{fontFamily:'Inter',fontSize:13,fontWeight:700}}>{v.toLocaleString()}</div></div>:null;}).filter(Boolean)}</div></div>;}).filter(Boolean);
  const renderLFForm=(jobId)=>{const form=getForm(jobId);return LF_SECTIONS.map(sec=><div key={sec.title} style={{marginBottom:10}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4,padding:'3px 8px',background:sec.bg,borderRadius:4,display:'inline-block'}}>{sec.title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:6}}>{sec.fields.map(([label,field])=><div key={field}><label style={{display:'block',fontSize:9,color:'#9E9B96',marginBottom:1}}>{label}</label><input type="number" value={form[field]} onChange={e=>updateForm(jobId,field,e.target.value)} placeholder="0" style={{...inputS,padding:'6px 8px',fontSize:13,minHeight:36}}/></div>)}</div></div>);};

  const filterTabs=[['all','All',activeJobs.length,'#6B6056','#F4F4F2'],['missing','Missing',missingCount,'#991B1B','#FEE2E2'],['submitted','Submitted',submittedNotReviewed,'#065F46','#D1FAE5'],['reviewed','Reviewed',reviewedCount,'#1D4ED8','#DBEAFE']];

  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>PM Bill Sheet</h1>
    </div>
    {/* PM Selector + Month */}
    <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
      {PM_LIST.map(pm=><button key={pm.id} onClick={()=>pickPM(pm.id)} style={{padding:'8px 18px',borderRadius:20,border:'none',background:selPM===pm.id?'#8B2020':'#F4F4F2',color:selPM===pm.id?'#fff':'#6B6056',fontSize:14,fontWeight:700,cursor:'pointer'}}>{pm.short}</button>)}
      <span style={{color:'#E5E3E0',margin:'0 4px'}}>|</span>
      <input type="month" value={selMonth} onChange={e=>setSelMonth(e.target.value||curBillingMonth())} style={{...inputS,width:170}}/>
      <span style={{fontSize:14,fontWeight:800,color:'#8B2020'}}>{selMonthLabel}</span>
    </div>
    {/* Progress bar */}
    <div style={{...card,marginBottom:12,padding:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>{submittedCount} of {totalCount} submitted — {pct}%</span>
        <span style={{fontSize:12,color:'#6B6056'}}>Total LF submitted: <b style={{color:'#1A1A1A'}}>{totalLFSubmitted.toLocaleString()}</b></span>
      </div>
      <div style={{height:8,background:'#E5E3E0',borderRadius:8,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pctColor,borderRadius:8,transition:'width .4s ease'}}/></div>
    </div>
    {/* Filter tabs + Add-ons toggle + CSV export */}
    <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
      {filterTabs.map(([k,l,c,col,bg])=><button key={k} onClick={()=>{setFilterTab(k);setExpandedRow(null);setEditingRow(null);setSelected(new Set());}} style={{padding:'7px 14px',borderRadius:8,border:filterTab===k?`2px solid ${col}`:'1px solid #E5E3E0',background:filterTab===k?bg:'#FFF',color:filterTab===k?col:'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>{l} ({c})</button>)}
      <span style={{width:1,height:24,background:'#E5E3E0',margin:'0 4px'}}/>
      <button onClick={()=>setHasAddOnsFilter(v=>!v)} title="Only show jobs with at least one non-zero accent/add-on value" style={{padding:'7px 14px',borderRadius:8,border:hasAddOnsFilter?'2px solid #8B2020':'1px solid #E5E3E0',background:hasAddOnsFilter?'#FDF4F4':'#FFF',color:hasAddOnsFilter?'#8B2020':'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>{hasAddOnsFilter?'✓ ':''}Has Add-Ons</button>
      <button onClick={exportPMBillCSV} title="Export visible rows to CSV" style={{marginLeft:'auto',padding:'7px 14px',borderRadius:8,border:'1px solid #E5E3E0',background:'#FFF',color:'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>⬇ Export CSV</button>
    </div>
    {/* Batch submit for Missing tab */}
    {filterTab==='missing'&&missingJobs.length>0&&<div style={{...card,marginBottom:10,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:'#6B6056',cursor:'pointer'}}><input type="checkbox" checked={selected.size===missingJobs.length&&missingJobs.length>0} onChange={toggleSelectAll} style={{width:16,height:16,accentColor:'#8B2020'}}/>Select all missing jobs</label>
      {selected.size>0&&<button onClick={()=>setShowBatchConfirm(true)} style={{...btnP,padding:'6px 14px',fontSize:12,background:'#B45309'}}>Submit {selected.size} as $0 / No Activity</button>}
    </div>}
    {/* Job list — table with accent/add-ons column group */}
    {filteredJobs.length===0?<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No jobs in this filter</div>:<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 320px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:1800}}>
        <thead>
          {/* Row 1: group headers */}
          <tr style={{background:'#F9F8F6'}}>
            <th colSpan={7} style={{borderBottom:'1px solid #E5E3E0',padding:0}}></th>
            <th colSpan={1} style={{borderBottom:'1px solid #E5E3E0',background:'#D1FAE5',padding:'6px 4px',fontSize:9,fontWeight:800,color:'#065F46',textAlign:'center',textTransform:'uppercase',letterSpacing:0.5}}>Primary</th>
            <th colSpan={7} style={{borderBottom:'1px solid #E5E3E0',background:'#FDF4F4',padding:'6px 4px',fontSize:9,fontWeight:800,color:'#8B2020',textAlign:'center',textTransform:'uppercase',letterSpacing:0.5}}>Accent / Add-Ons</th>
            <th colSpan={5} style={{borderBottom:'1px solid #E5E3E0',background:'#F4F4F2',padding:'6px 4px',fontSize:9,fontWeight:800,color:'#6B6056',textAlign:'center',textTransform:'uppercase',letterSpacing:0.5}}>Financial</th>
          </tr>
          {/* Row 2: column headers */}
          <tr style={{background:'#F9F8F6',position:'sticky',top:0,zIndex:1}}>
            {[['Job #',90],['Job Name',220],['Customer',160],['Market',90],['PM',110],['Status',80],['PC LF',70],['SW LF',70],['WI LF',70],['# Gates',70],['Gate Value',90],['Removal LF',80],['Lump Sum',90],['Lump Sum Desc',160],['Contract',100],['Adj Contract',100],['YTD',90],['% Billed',70],['Left to Bill',100]].map(([h,w])=><th key={h} style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,whiteSpace:'nowrap',minWidth:w}}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
        {filteredJobs.map(j=>{const sub=subByJob[j.id];const status=getStatus(j);const isExp=expandedRow===j.id;const isEditing=editingRow===j.id;const form=getForm(j.id);const subDate=sub&&sub.submitted_at?new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';const rowBg=status==='reviewed'?'#EFF6FF':status==='submitted'?'#ECFDF5':'#FFF';const statusColor=status==='reviewed'?'#1D4ED8':status==='submitted'?'#065F46':'#991B1B';const statusLabel=status==='reviewed'?'Reviewed':status==='submitted'?'Submitted':'Missing';
          const gv=gateValueOf(j);const adjCV=n(j.adj_contract_value)||n(j.contract_value);const ltb=n(j.left_to_bill)||0;
          const td={padding:'8px 10px',borderBottom:'1px solid #F4F4F2',fontSize:11,verticalAlign:'middle',whiteSpace:'nowrap'};
          const tdDim={...td,color:'#9E9B96'};
          const tdNum={...td,fontFamily:'Inter',fontWeight:600,textAlign:'right'};
          const onRowClick=()=>{if(status!=='reviewed')expandRow(j.id);};
          return<React.Fragment key={j.id}>
            <tr onClick={onRowClick} style={{background:rowBg,cursor:status==='reviewed'?'default':'pointer'}} onMouseEnter={e=>{if(status!=='reviewed')e.currentTarget.style.background='#FDF9F6';}} onMouseLeave={e=>{e.currentTarget.style.background=rowBg;}}>
              <td style={{...td,fontFamily:'Inter',color:'#6B6056'}}>{j.job_number||'—'}</td>
              <td style={{...td,fontWeight:700,color:'#1A1A1A',maxWidth:260,overflow:'hidden',textOverflow:'ellipsis'}}>{j.job_name}</td>
              <td style={{...td,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}}>{j.customer_name||'—'}</td>
              <td style={td}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td>
              <td style={td}>{j.pm||'—'}</td>
              <td style={td}><span style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:status==='reviewed'?'#DBEAFE':status==='submitted'?'#D1FAE5':'#FEE2E2',color:statusColor}}>{statusLabel}{status==='submitted'&&subDate?` ${subDate}`:''}</span></td>
              <td style={{...tdNum,background:'#ECFDF5',color:'#065F46',fontWeight:700}}>{lfPC(j)>0?lfPC(j).toLocaleString():'—'}</td>
              <td style={tdNum}>{n(j.lf_single_wythe)>0?n(j.lf_single_wythe).toLocaleString():<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={tdNum}>{n(j.lf_wrought_iron)>0?n(j.lf_wrought_iron).toLocaleString():<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={tdNum}>{n(j.number_of_gates)>0?n(j.number_of_gates).toLocaleString():<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={tdNum}>{gv>0?$(gv):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={tdNum}>{n(j.lf_removal)>0?n(j.lf_removal).toLocaleString():<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={tdNum}>{n(j.lump_sum_amount)>0?$(j.lump_sum_amount):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={{...td,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',color:j.lump_sum_description?'#1A1A1A':'#9E9B96'}} title={j.lump_sum_description||''}>{j.lump_sum_description?truncDesc(j.lump_sum_description):'—'}</td>
              <td style={tdNum}>{n(j.contract_value)>0?$(j.contract_value):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={{...tdNum,color:'#8B2020',fontWeight:800}}>{adjCV>0?$(adjCV):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={{...tdNum,color:'#065F46'}}>{n(j.ytd_invoiced)>0?$(j.ytd_invoiced):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={tdNum}>{j.pct_billed!=null?fmtPct(j.pct_billed):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
              <td style={{...tdNum,color:ltb>100000?'#991B1B':ltb>50000?'#B45309':'#1A1A1A'}}>{ltb>0?$(ltb):<span style={{color:'#9E9B96',fontWeight:400}}>—</span>}</td>
            </tr>
            {isExp&&status!=='reviewed'&&<tr><td colSpan={19} style={{padding:'12px 14px',background:'#FFF',borderBottom:'1px solid #E5E3E0',borderLeft:`3px solid ${status==='submitted'?'#10B981':'#EF4444'}`}}>
            {(pmLineItemsByJob[j.job_number]||[]).length>0&&(()=>{const lis=pmLineItemsByJob[j.job_number];const lineTotal=lis.reduce((s,x)=>s+n(x.line_value),0);const contractTotal=lineTotal+n(j.lump_sum_amount)+n(j.change_orders);return<div style={{marginBottom:10,padding:'8px 12px',background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:6}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>Contract Line Items ({lis.length})</div><div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:6}}>{lis.map(li=><div key={li.id} style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#1A1A1A'}}><span>#{li.line_number} · <b>{li.fence_type}</b> · {n(li.lf).toLocaleString()} LF {li.height&&`@ ${li.height}ft`} {li.style||''} {li.color?'· '+li.color:''}</span><span style={{fontFamily:'Inter',fontWeight:700}}>{$(li.line_value)}</span></div>)}</div><div style={{borderTop:'1px solid #E5E3E0',paddingTop:6,display:'flex',flexDirection:'column',gap:2,fontSize:11}}><div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#6B6056'}}>Line items subtotal</span><span style={{fontFamily:'Inter',fontWeight:700}}>{$(lineTotal)}</span></div>{n(j.lump_sum_amount)>0&&<div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#6B6056'}}>Lump sum</span><span style={{fontFamily:'Inter',fontWeight:700}}>{$(j.lump_sum_amount)}</span></div>}{n(j.change_orders)>0&&<div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#6B6056'}}>Change orders</span><span style={{fontFamily:'Inter',fontWeight:700}}>{$(j.change_orders)}</span></div>}<div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #E5E3E0',paddingTop:4,marginTop:2}}><span style={{fontWeight:700,color:'#8B2020'}}>Total contract value</span><span style={{fontFamily:'Inter',fontWeight:800,color:'#8B2020'}}>{$(contractTotal)}</span></div></div></div>;})()}
            {status==='submitted'&&!isEditing?<>
              {renderLFReadOnly(sub)}
              <div style={{display:'flex',gap:12,marginTop:8,fontSize:12,color:'#6B6056'}}>{n(sub.total_lf)>0&&<span>Total LF: <b style={{color:'#1A1A1A'}}>{n(sub.total_lf).toLocaleString()}</b></span>}{sub.pct_complete_pm!=null&&<span>% Complete: <b style={{color:'#1A1A1A'}}>{sub.pct_complete_pm}%</b></span>}</div>
              {sub.notes&&<div style={{fontSize:12,color:'#6B6056',marginTop:4}}>Notes: {sub.notes}</div>}
              <div style={{marginTop:10,display:'flex',gap:8}}><button onClick={e=>{e.stopPropagation();openEdit(j,sub);}} style={{...btnS,padding:'6px 14px',fontSize:12}}>Edit Submission</button><button onClick={e=>{e.stopPropagation();setConfirmReset(j);}} style={{background:'none',border:'1px solid #EF444440',borderRadius:6,padding:'5px 10px',fontSize:11,color:'#EF4444',cursor:'pointer'}}>Reset</button></div>
            </>:<>
              {(n(j.lf_installed_to_date)>0||n(j.lf_precast)>0)&&(()=>{const installed=n(j.lf_installed_to_date);const contracted=n(j.lf_precast)||n(j.total_lf);const pct=contracted>0?Math.round(installed/contracted*100):0;return<div style={{marginBottom:10,padding:'8px 12px',background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:6,fontSize:12,color:'#1D4ED8'}}>
                📊 <b>Previously billed:</b> {installed.toLocaleString()} LF ({pct}% of {contracted.toLocaleString()} LF contracted){j.lf_last_billed_date&&<span style={{color:'#6B6056'}}> · last {fD(j.lf_last_billed_date)}</span>}
              </div>;})()}
              {renderLFForm(j.id)}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2,textTransform:'uppercase',fontWeight:600}}>% Complete</label><input type="number" min="0" max="100" value={form.pct_complete} onChange={e=>updateForm(j.id,'pct_complete',e.target.value)} placeholder="e.g. 65" style={{...inputS,padding:'6px 10px',fontSize:13}}/></div>
                <div style={{display:'flex',alignItems:'flex-end'}}><div style={{background:'#F9F8F6',borderRadius:6,padding:'6px 10px',fontSize:12}}>Total LF: <span style={{fontFamily:'Inter',fontWeight:800,color:'#8B2020'}}>{calcLFTotal(form).toLocaleString()}</span></div></div>
              </div>
              <div style={{marginBottom:10}}><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2,textTransform:'uppercase',fontWeight:600}}>Notes</label><textarea value={form.notes} onChange={e=>updateForm(j.id,'notes',e.target.value)} rows={2} placeholder="Section completed, upcoming work, issues..." style={{...inputS,padding:'6px 10px',fontSize:13,resize:'vertical'}}/></div>
              <div style={{display:'flex',gap:8}}><button onClick={()=>submitEntry(j)} disabled={saving===j.id} style={{...btnP,flex:1,padding:'8px 0',fontSize:13,opacity:saving===j.id?0.5:1}}>{saving===j.id?'Saving...':sub?'Update Submission':'Submit'}</button><button onClick={()=>{setExpandedRow(null);setEditingRow(null);}} style={btnS}>Cancel</button></div>
            </>}
            </td></tr>}
            {status==='reviewed'&&<tr><td colSpan={19} style={{padding:'6px 14px',borderBottom:'1px solid #BFDBFE',background:'#EFF6FF',fontSize:11,color:'#1D4ED8'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Reviewed by AR{sub.ar_reviewed_by?' — '+sub.ar_reviewed_by:''}</span>
                <button onClick={()=>{setAdminPinJob(j);setAdminPin('');setAdminPinErr(false);}} style={{background:'none',border:'none',padding:0,fontSize:10,color:'#9E9B96',cursor:'pointer',textDecoration:'underline'}}>Admin Reset</button>
              </div>
            </td></tr>}
          </React.Fragment>;
        })}
        </tbody>
      </table>
    </div>}
    {/* Batch confirm modal */}
    {showBatchConfirm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>!batchSubmitting&&setShowBatchConfirm(false)}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:440,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:12,color:'#1A1A1A'}}>Submit {selected.size} jobs with no activity?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7,marginBottom:20}}>This will submit <b>{selected.size}</b> bill sheets for <b>{selMonthLabel}</b> with all LF fields set to 0 and notes "No activity this month". This cannot be undone individually but can be reset per-job.</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setShowBatchConfirm(false)} disabled={batchSubmitting} style={btnS}>Cancel</button><button onClick={batchSubmitNoActivity} disabled={batchSubmitting} style={{...btnP,background:'#B45309'}}>{batchSubmitting?'Submitting...':'Yes, Submit'}</button></div>
      </div>
    </div>}
    {confirmReset&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setConfirmReset(null)}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:420,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:12,color:'#1A1A1A'}}>Reset Bill Sheet?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7,marginBottom:20}}>Reset bill sheet for <b style={{color:'#1A1A1A'}}>{confirmReset.job_name}</b>? This cannot be undone.</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setConfirmReset(null)} style={btnS}>Cancel</button><button onClick={()=>resetSub(confirmReset,false)} style={{...btnP,background:'#991B1B'}}>Yes, Reset</button></div>
      </div>
    </div>}
    {adminPinJob&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>{setAdminPinJob(null);setAdminPin('');setAdminPinErr(false);}}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:380,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:6,color:'#1A1A1A'}}>Admin Override Required</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.6,marginBottom:16}}>This submission for <b>{adminPinJob.job_name}</b> has been reviewed by AR. Enter admin PIN to reset.</div>
        <input autoFocus type="password" inputMode="numeric" maxLength={4} value={adminPin} onChange={e=>{setAdminPin(e.target.value.replace(/\D/g,'').slice(0,4));setAdminPinErr(false);}} onKeyDown={e=>{if(e.key==='Enter'){if(adminPin==='2020')resetSub(adminPinJob,true);else setAdminPinErr(true);}}} placeholder="••••" style={{width:'100%',padding:'12px 16px',fontSize:20,textAlign:'center',letterSpacing:8,border:`2px solid ${adminPinErr?'#DC2626':'#E5E3E0'}`,borderRadius:10,marginBottom:8,fontFamily:'Inter',fontWeight:700}}/>
        {adminPinErr&&<div style={{color:'#DC2626',fontSize:12,fontWeight:600,textAlign:'center',marginBottom:8}}>Incorrect PIN</div>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>{setAdminPinJob(null);setAdminPin('');setAdminPinErr(false);}} style={btnS}>Cancel</button><button onClick={()=>{if(adminPin==='2020')resetSub(adminPinJob,true);else setAdminPinErr(true);}} style={{...btnP,background:'#991B1B'}}>Confirm</button></div>
      </div>
    </div>}
  </div>);
}

/* ═══ PRODUCTION PAGE ═══ */
function StartDateBadge({date,status}){
  if(!date)return null;
  const now=new Date();now.setHours(0,0,0,0);const d=new Date(date+'T12:00:00');const diff=Math.round((d-now)/86400000);
  const isPast=diff<0&&!CLOSED_SET.has(status);const isSoon=diff>=0&&diff<=7;
  if(isPast)return<span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:700,background:'#991B1B',color:'#FFF'}}>🚩 {fD(date)}</span>;
  if(isSoon)return<span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:700,background:'#FEF3C7',color:'#B45309',border:'1px solid #F9731640'}}>📅 {fD(date)}</span>;
  return<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:10,fontWeight:700,color:'#8B2020'}}>📅 {fD(date)}</span>;
}
const STAGE_THRESHOLDS={contract_review:[30,60],production_queue:[21,45],in_production:[30,60],inventory_ready:[14,30],active_install:[30,60],fence_complete:[7,14],fully_complete:[7,14]};
const STAGE_DATE_KEY={inventory_ready:'inventory_ready_date',active_install:'active_install_date',fence_complete:'fence_complete_date',fully_complete:'fully_complete_date',in_production:'production_start_date'};
function ProdCard({j,move,locked,billSub,onViewBill,onQuickView,onPrintOrder,onCalcMaterials,onAddToPlan,inPlanDate,progressInfo,lineItems}){const ns=NEXT_STATUS[j.status];const stageDate=j[STAGE_DATE_KEY[j.status]]||j.est_start_date;const daysIn=stageDate?Math.max(0,Math.round((Date.now()-new Date(stageDate).getTime())/86400000)):null;const thresh=STAGE_THRESHOLDS[j.status];const ageSev=daysIn!=null&&thresh?(daysIn>=thresh[1]?'critical':daysIn>=thresh[0]?'warn':null):null;const totalPieces=(n(j.material_posts_line)+n(j.material_posts_corner)+n(j.material_posts_stop))||(n(j.material_panels_regular)+n(j.material_panels_half));return<div style={{...card,padding:12,marginBottom:6,position:'relative'}}>{Array.isArray(j.fence_addons)&&j.fence_addons.length>0&&<div style={{position:'absolute',top:8,right:8,display:'flex',flexDirection:'column',gap:3,zIndex:1}}>{j.fence_addons.map(a=>{const ac={G:['#B45309','G'],C:['#6D28D9','C'],WI:['#374151','WI']};const[bg,lbl]=ac[a]||['#6B6056',a];return<span key={a} style={{display:'block',padding:'3px 8px',borderRadius:5,fontSize:11,fontWeight:700,background:bg,color:'#FFF',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}>{lbl}</span>;})}</div>}<div style={{fontSize:10,color:'#9E9B96',marginBottom:1}}>#{j.job_number}</div><div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',paddingRight:Array.isArray(j.fence_addons)&&j.fence_addons.length>0?36:0}}><span onClick={e=>{e.stopPropagation();if(onQuickView)onQuickView(j);}} style={{cursor:'pointer',borderBottom:'1px dashed transparent'}} onMouseEnter={e=>e.currentTarget.style.borderBottomColor='#8B2020'} onMouseLeave={e=>e.currentTarget.style.borderBottomColor='transparent'}>{j.job_name}</span></div><div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span>{j.pm&&<span style={{fontSize:10,color:'#6B6056',background:'#F4F4F2',padding:'1px 5px',borderRadius:4}}>{j.pm}</span>}</div>{lineItems&&lineItems.length>0?<div style={{marginBottom:2}}>{lineItems.map((li,idx)=><div key={li.id||idx} style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B6056',lineHeight:1.35}}><span>{n(li.lf).toLocaleString()} LF {li.height&&`@ ${li.height}ft`}{li.style&&` ${li.style}`}{li.color&&` · ${li.color}`}</span>{idx===0&&<span style={{fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(j.adj_contract_value||j.contract_value)}</span>}</div>)}</div>:<><div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B6056',marginBottom:2}}><span>{lfPC(j)>0?lfPC(j).toLocaleString()+' PC LF':lfTotal(j).toLocaleString()+' LF'}</span><span style={{fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(j.adj_contract_value||j.contract_value)}</span></div>{(j.style||j.color||j.height_precast)&&<div style={{fontSize:10,color:'#9E9B96',marginBottom:2}}>{[j.style,j.color,j.height_precast?j.height_precast+'ft':null].filter(Boolean).join(' | ')}</div>}</>}{j.est_start_date&&<div style={{marginBottom:2}}><StartDateBadge date={j.est_start_date} status={j.status}/></div>}{j.status==='contract_review'&&!j.material_calc_date&&onCalcMaterials&&<div onClick={e=>{e.stopPropagation();onCalcMaterials(j);}} style={{marginTop:4,padding:'6px 8px',background:'#FEF3C7',border:'1px solid #B4530940',borderRadius:6,fontSize:10,fontWeight:700,color:'#B45309',cursor:'pointer',textAlign:'center'}}>📋 Calculate materials to schedule →</div>}{j.status==='contract_review'&&j.material_calc_date&&<div style={{marginTop:4,padding:'6px 8px',background:'#D1FAE5',border:'1px solid #065F4640',borderRadius:6,fontSize:10,fontWeight:700,color:'#065F46',textAlign:'center'}}>✓ Materials calculated {new Date(j.material_calc_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}{j.status==='production_queue'&&j.material_calc_date&&<div style={{marginTop:4,padding:'6px 8px',background:'#EDE9FE',border:'1px solid #7C3AED40',borderRadius:6,fontSize:10,color:'#5B21B6'}}>{totalPieces>0&&<div style={{fontWeight:700}}>📦 {totalPieces} pcs | {n(j.total_lf).toLocaleString()} LF</div>}{inPlanDate?<div style={{marginTop:2,fontWeight:600}}>✓ In plan for {inPlanDate}</div>:onAddToPlan&&<div onClick={e=>{e.stopPropagation();onAddToPlan(j);}} style={{marginTop:2,cursor:'pointer',fontWeight:700,textAlign:'center'}}>📅 Add to Plan →</div>}</div>}{j.status==='in_production'&&progressInfo&&<div style={{marginTop:4,padding:'6px 8px',background:'#DBEAFE',border:'1px solid #1D4ED840',borderRadius:6,fontSize:10,color:'#1D4ED8'}}><div style={{display:'flex',justifyContent:'space-between',fontWeight:700,marginBottom:3}}><span>{progressInfo.pct}%</span><span>{progressInfo.actual} of {progressInfo.planned} pcs</span></div><div style={{height:4,background:'#E5E3E0',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(progressInfo.pct,100)}%`,background:'#1D4ED8'}}/></div><div style={{fontSize:9,marginTop:3,color:progressInfo.loggedToday?'#065F46':'#B45309'}}>{progressInfo.loggedToday?'✓ Logged today':'⚠ Not logged today'}</div></div>}{j.status==='inventory_ready'&&<div style={{marginTop:4,padding:'6px 8px',background:'#D1FAE5',border:'1px solid #10B98140',borderRadius:6,fontSize:10,fontWeight:700,color:'#065F46',textAlign:'center'}}>✅ Production complete{totalPieces>0?` — ${totalPieces} pcs ready`:''}</div>}<div style={{marginTop:4,paddingTop:4,borderTop:'1px solid #F4F4F2',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div>{ageSev&&<span style={{display:'inline-block',padding:'1px 5px',borderRadius:4,fontSize:10,fontWeight:700,marginRight:4,background:ageSev==='critical'?'#FEE2E2':'#FEF3C7',color:ageSev==='critical'?'#991B1B':'#B45309'}}>{ageSev==='critical'?'🔴':'⏱'} {daysIn}d</span>}</div><div style={{display:'flex',gap:6,alignItems:'center'}}>{j.material_calc_date?<span onClick={e=>{e.stopPropagation();if(onPrintOrder)onPrintOrder(j);}} title={`Production order saved ${new Date(j.material_calc_date).toLocaleDateString()}`} style={{cursor:onPrintOrder?'pointer':'default',fontSize:12}}>📋</span>:<span title="No production order" style={{fontSize:9,color:'#C8C4BD'}}>📋</span>}{(()=>{const hasStyle=!!(j.style&&j.style.trim());const hasColor=!!(j.color&&j.color.trim());let bg,fg,label;if(hasStyle&&hasColor){bg='#DCFCE7';fg='#15803D';label='✓ Style & Color';}else if(hasStyle&&!hasColor){bg='#FEF3C7';fg='#B45309';label='⚠ No Color';}else if(!hasStyle&&hasColor){bg='#FEF3C7';fg='#B45309';label='⚠ No Style';}else{bg='#FEE2E2';fg='#DC2626';label='✗ Style & Color';}const missing=!hasStyle||!hasColor;return<span onClick={e=>{if(missing&&onQuickView){e.stopPropagation();onQuickView(j);}}} title={missing?'Click to fix missing info':'Style and color confirmed'} style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:4,background:bg,color:fg,cursor:missing?'pointer':'default',whiteSpace:'nowrap'}}>{label}</span>;})()}</div></div>{!locked&&<div style={{display:'flex',gap:4,marginTop:6}}>{ns&&<button onClick={()=>move(j,ns)} style={{flex:2,padding:'5px 4px',borderRadius:6,border:`1px solid ${SC[ns]}40`,background:SB_[ns],color:SC[ns],fontSize:10,fontWeight:700,cursor:'pointer'}}>→ {SS[ns]}</button>}<select onChange={e=>{if(e.target.value)move(j,e.target.value);e.target.value='';}} style={{flex:1,padding:'4px',borderRadius:6,border:'1px solid #E5E3E0',fontSize:10,color:'#6B6056',cursor:'pointer',background:'#FFF'}}><option value="">More...</option>{STS.filter(s=>s!==j.status&&s!==ns).map(s=><option key={s} value={s}>{SS[s]}</option>)}</select></div>}</div>;}

function ProductionPage({jobs,setJobs,onRefresh,onNav,refreshKey=0}){
  const[quickViewJob,setQuickViewJob]=useState(null);
  // Actuals + plan membership for kanban cards
  const[prodActuals,setProdActuals]=useState([]);
  const[prodPlanLines,setProdPlanLines]=useState([]);
  const todayIsoProd=new Date().toISOString().split('T')[0];
  useEffect(()=>{sbGet('production_actuals','select=job_id,actual_pieces,production_date&limit=1000').then(d=>setProdActuals(Array.isArray(d)?d:[])).catch(e=>console.error('Fetch actuals failed:',e));},[refreshKey]);
  useEffect(()=>{sbGet('production_plan_lines','select=job_id,plan_id,planned_pieces&limit=500').then(d=>setProdPlanLines(d||[])).catch(()=>{});},[refreshKey]);
  // Fetch produced line items ONLY for currently-visible (non-closed) jobs to limit payload
  const[prodLineItems,setProdLineItems]=useState([]);
  const visibleJobNumbers=useMemo(()=>jobs.filter(j=>j.status!=='closed'&&j.job_number).map(j=>j.job_number),[jobs]);
  useEffect(()=>{
    if(visibleJobNumbers.length===0){setProdLineItems([]);return;}
    // Chunk IN filter to stay under URL length limits (~100 job numbers per batch)
    const chunks=[];
    for(let i=0;i<visibleJobNumbers.length;i+=100){chunks.push(visibleJobNumbers.slice(i,i+100));}
    Promise.all(chunks.map(chunk=>{
      const inList=chunk.map(jn=>`"${encodeURIComponent(jn)}"`).join(',');
      return sbGet('job_line_items',`select=*&is_produced=eq.true&job_number=in.(${inList})&order=line_number.asc&limit=500`).catch(()=>[]);
    })).then(results=>{setProdLineItems([].concat(...results.map(r=>r||[])));});
  },[visibleJobNumbers.join('|'),refreshKey]);// eslint-disable-line
  const lineItemsByJob=useMemo(()=>{const m={};prodLineItems.forEach(li=>{if(!li.job_number)return;if(!m[li.job_number])m[li.job_number]=[];m[li.job_number].push(li);});return m;},[prodLineItems]);
  const plannedByJob=useMemo(()=>{const m={};prodPlanLines.forEach(l=>{if(!m[l.job_id])m[l.job_id]=0;m[l.job_id]=Math.max(m[l.job_id],n(l.planned_pieces));});return m;},[prodPlanLines]);
  const actualsByJob=useMemo(()=>{const m={};prodActuals.forEach(a=>{if(!m[a.job_id])m[a.job_id]={actual:0,planned:0,loggedToday:false};m[a.job_id].actual+=n(a.actual_pieces);if(a.production_date===todayIsoProd)m[a.job_id].loggedToday=true;});Object.entries(m).forEach(([jobId,x])=>{x.planned=plannedByJob[jobId]||0;x.pct=x.planned>0?Math.round(x.actual/x.planned*100):0;});return m;},[prodActuals,plannedByJob,todayIsoProd]);
  const planJobIds=useMemo(()=>new Set(prodPlanLines.map(l=>l.job_id)),[prodPlanLines]);
  // Bill sheet submissions for current month
  const prodBillingMonth=curBillingMonth();
  const[prodBillSubs,setProdBillSubs]=useState([]);
  const[prodBillModal,setProdBillModal]=useState(null);
  const fetchProdBillSubs=useCallback(async()=>{const d=await sbGet('pm_bill_submissions',`billing_month=eq.${prodBillingMonth}&order=created_at.desc`);setProdBillSubs(d||[]);},[prodBillingMonth]);
  useEffect(()=>{fetchProdBillSubs();},[fetchProdBillSubs,refreshKey]);
  const prodSubByJob=useMemo(()=>{const m={};(prodBillSubs||[]).forEach(s=>{if(!m[s.job_id])m[s.job_id]=s;});return m;},[prodBillSubs]);
  const PROD_LF_SECTIONS=[{title:'Precast',bg:'#FEF3C7',fields:[['Post Only','labor_post_only'],['Post+Panels','labor_post_panels'],['Complete','labor_complete']]},{title:'Single Wythe',bg:'#DBEAFE',fields:[['Foundation','sw_foundation'],['Columns','sw_columns'],['Panels','sw_panels'],['Complete','sw_complete']]},{title:'One Line Items',bg:'#EDE9FE',fields:[['WI Gates','wi_gates'],['WI Fencing','wi_fencing'],['WI Columns','wi_columns'],['Bonds','line_bonds'],['Permits','line_permits'],['Remove','remove_existing'],['Gate Ctrl','gate_controls']]}];
  const[groupBy,setGroupBy]=useState('status');const[mktF,setMktF]=useState(null);const[statusF,setStatusF]=useState(null);const[search,setSearch]=useState('');const[addonsF,setAddonsF]=useState(new Set());
  // Edit lock — defaults to locked on every page load (intentionally not persisted).
  const[editUnlocked,setEditUnlocked]=useState(false);const[showPinModal,setShowPinModal]=useState(false);const[pinInput,setPinInput]=useState('');const[pinError,setPinError]=useState(false);
  const submitPin=()=>{if(pinInput==='2020'){setEditUnlocked(true);setShowPinModal(false);setPinInput('');setPinError(false);}else{setPinError(true);setPinInput('');}};
  useEffect(()=>{if(!showPinModal)return;const onKey=(e)=>{if(e.key==='Escape'){setShowPinModal(false);setPinInput('');setPinError(false);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[showPinModal]);
  const[moveToast,setMoveToast]=useState(null);
  const move=async(job,ns)=>{if(!editUnlocked){console.warn('[Kanban] Move blocked — editing locked');return;}const u={status:ns};const today=new Date().toISOString().split('T')[0];if(ns==='inventory_ready')u.inventory_ready_date=today;if(ns==='active_install')u.active_install_date=today;if(ns==='fence_complete')u.fence_complete_date=today;if(ns==='fully_complete')u.fully_complete_date=today;if(ns==='closed')u.closed_date=today;console.log('[Kanban] Moving',job.job_name,'('+job.id+') from',job.status,'→',ns);try{const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(u)});if(!res.ok){const txt=await res.text();console.error('[Kanban] PATCH failed:',res.status,txt);setMoveToast({msg:`Move failed (${res.status}): ${txt}`,ok:false});return;}setJobs(prev=>prev.map(j=>j.id===job.id?{...j,...u}:j));fireAlert('job_updated',{...job,...u});logAct(job,'status_change','status',job.status,ns);setMoveToast({msg:`Moved ${job.job_name} to ${SL[ns]||ns}`,ok:true});fetch(`${SB}/functions/v1/job-stage-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{job_name:job.job_name,job_number:job.job_number,market:job.market,pm:job.pm,sales_rep:job.sales_rep,style:job.style,color:job.color,height_precast:job.height_precast,total_lf:job.total_lf,adj_contract_value:job.adj_contract_value},from_status:job.status,to_status:ns})}).catch(e=>console.error('Stage notification failed:',e));}catch(e){console.error('[Kanban] Move error:',e);setMoveToast({msg:e.message||'Move failed',ok:false});}};
  const toggleAddon=code=>setAddonsF(prev=>{const s=new Set(prev);if(s.has(code))s.delete(code);else s.add(code);return s;});
  const filtered=useMemo(()=>{const seen=new Set();let f=jobs.filter(j=>{if(seen.has(j.id))return false;seen.add(j.id);return j.status!=='closed';});if(mktF)f=f.filter(j=>j.market===mktF);if(statusF)f=f.filter(j=>j.status===statusF);if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.customer_name}`.toLowerCase().includes(q));}if(addonsF.size>0)f=f.filter(j=>Array.isArray(j.fence_addons)&&j.fence_addons.some(a=>addonsF.has(a)));return f;},[jobs,mktF,statusF,search,addonsF]);
  const pipeLF=filtered.filter(j=>['production_queue','in_production','inventory_ready','active_install','fence_complete'].includes(j.status)).reduce((s,j)=>s+lfPC(j),0);
  const sortByStart=(arr)=>[...arr].sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999'));
  const KANBAN_STS=['contract_review','production_queue','in_production','inventory_ready','active_install','fence_complete','fully_complete'];
  const columns=useMemo(()=>{if(groupBy==='status')return KANBAN_STS.map(s=>({key:s,label:SL[s],color:SC[s],bg:SB_[s],jobs:sortByStart(filtered.filter(j=>j.status===s))}));const groups={};filtered.forEach(j=>{const v=j[groupBy]||'';const k=v||'__u__';if(!groups[k])groups[k]={label:v||'Unspecified',jobs:[]};groups[k].jobs.push(j);});let cols=Object.entries(groups).map(([k,g])=>({key:k,label:g.label,color:'#8B2020',bg:'#FDF4F4',jobs:sortByStart(g.jobs),tv:g.jobs.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0)}));cols.sort((a,b)=>{if(a.key==='__u__')return 1;if(b.key==='__u__')return-1;return b.tv-a.tv;});return{cols:cols.slice(0,12),capped:cols.length>12};},[filtered,groupBy]);
  const isS=groupBy==='status';const colArr=isS?columns:columns.cols;
  return(<div>
    {moveToast&&<Toast message={moveToast.msg} isError={!moveToast.ok} onDone={()=>setMoveToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,gap:12,flexWrap:'wrap'}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Production</h1>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        {editUnlocked
          ?<span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:20,background:'#FDF4F4',border:'1px solid #8B202040',color:'#8B2020',fontSize:12,fontWeight:700}}>🔓 Editing Unlocked</span>
          :<span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:20,background:'#F4F4F2',border:'1px solid #E5E3E0',color:'#6B6056',fontSize:12,fontWeight:700}}>🔒 View Only</span>}
        {editUnlocked
          ?<button onClick={()=>setEditUnlocked(false)} style={btnS}>Lock</button>
          :<button onClick={()=>{setPinError(false);setPinInput('');setShowPinModal(true);}} style={btnP}>Unlock Editing</button>}
      </div>
    </div>
    <div style={{...card,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}><span style={{fontFamily:'Inter',fontWeight:700,fontSize:16,color:pipeLF>200000?'#991B1B':pipeLF>100000?'#B45309':'#065F46'}}>{pipeLF.toLocaleString()} Precast LF</span><span style={{fontSize:12,color:'#6B6056'}}>in production pipeline</span><div style={{flex:1}}><PBar pct={Math.min(pipeLF/200000*100,100)} color={pipeLF>200000?'#991B1B':pipeLF>100000?'#B45309':'#065F46'} h={8}/></div></div>
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><span style={{fontSize:11,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>Group By:</span>{[{key:'status',label:'Status'},{key:'customer_name',label:'Customer'},{key:'style',label:'Style'},{key:'color',label:'Color'}].map(g=><button key={g.key} onClick={()=>setGroupBy(g.key)} style={gpill(groupBy===g.key)}>{g.label}</button>)}</div>
    <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputS,width:180,padding:'6px 10px',fontSize:12}}/><button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}{!isS&&<><span style={{color:'#E5E3E0'}}>|</span><button onClick={()=>setStatusF(null)} style={fpill(!statusF)}>All</button>{KANBAN_STS.map(s=><button key={s} onClick={()=>setStatusF(s)} style={fpill(statusF===s)}>{SS[s]}</button>)}</>}</div>
    <div style={{display:'flex',gap:6,marginBottom:14,alignItems:'center'}}><span style={{fontSize:11,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>Add-ons:</span><button onClick={()=>setAddonsF(new Set())} style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',border:addonsF.size===0?'1px solid #8B2020':'1px solid #E5E3E0',background:addonsF.size===0?'#FDF4F4':'#FFF',color:addonsF.size===0?'#8B2020':'#9E9B96'}}>All</button>{[{code:'G',label:'Gates',color:'#B45309',bg:'#FEF3C7'},{code:'WI',label:'WI',color:'#374151',bg:'#F3F4F6'},{code:'C',label:'Columns',color:'#6D28D9',bg:'#EDE9FE'}].map(a=><button key={a.code} onClick={()=>toggleAddon(a.code)} style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',border:addonsF.has(a.code)?`2px solid ${a.color}`:'1px solid #E5E3E0',background:addonsF.has(a.code)?a.bg:'#FFF',color:addonsF.has(a.code)?a.color:'#9E9B96'}}>{a.label}</button>)}{addonsF.size>0&&<span style={{fontSize:11,color:'#6B6056',marginLeft:4}}>{filtered.length} jobs</span>}</div>
    <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(colArr.length,7)},1fr)`,gap:12,alignItems:'flex-start'}}>{colArr.map(col=>{const cv=col.jobs.reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);const lf=col.jobs.reduce((x,j)=>x+lfPC(j),0);return<div key={col.key}><div style={{background:col.bg||'#FDF4F4',border:`1px solid ${col.color}30`,borderRadius:12,padding:'12px 14px',marginBottom:8}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:col.color,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{col.label}</div><div style={{fontSize:11,color:'#6B6056',marginTop:2}}><span style={{background:'#E5E3E0',padding:'1px 6px',borderRadius:4,fontWeight:700,marginRight:6}}>{col.jobs.length}</span>{lf.toLocaleString()} PC LF · {$k(cv)}</div></div><div style={{maxHeight:'calc(100vh-300px)',overflow:'auto'}}>{col.jobs.map(j=><ProdCard key={j.id} j={j} move={move} locked={!editUnlocked} billSub={prodSubByJob[j.id]} onViewBill={s=>setProdBillModal(s)} onQuickView={setQuickViewJob} onPrintOrder={onNav?()=>onNav('production_orders'):null} onCalcMaterials={onNav?()=>{try{localStorage.setItem('fc_matcalc_prejob',j.id);}catch(e){}onNav('material_calc');}:null} onAddToPlan={onNav?()=>{try{localStorage.setItem('fc_plan_addjob',j.id);}catch(e){}onNav('daily_report');}:null} inPlanDate={planJobIds.has(j.id)?'active plan':null} progressInfo={actualsByJob[j.id]} lineItems={lineItemsByJob[j.job_number]}/>)}</div></div>;})}</div>
    {quickViewJob&&<ProjectQuickView job={quickViewJob} onClose={()=>setQuickViewJob(null)} billSub={prodSubByJob[quickViewJob.id]}/>}
    {/* Bill Sheet Detail Modal */}
    {prodBillModal&&(()=>{const s=prodBillModal;return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setProdBillModal(null)}>
      <div style={{background:'#fff',borderRadius:16,padding:24,width:560,maxWidth:'94vw',maxHeight:'92vh',overflow:'auto',boxShadow:'0 8px 30px rgba(0,0,0,0.18)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:18,fontWeight:800,color:'#1A1A1A',marginBottom:4}}>{s.job_name} \u2014 Bill Sheet {monthLabel(s.billing_month)}</div>
        <div style={{display:'flex',gap:8,marginBottom:12,fontSize:12,color:'#6B6056',flexWrap:'wrap'}}>
          {s.style&&<span>Style: <b style={{color:'#1A1A1A'}}>{s.style}</b></span>}
          {s.color&&<span>Color: <b style={{color:'#1A1A1A'}}>{s.color}</b></span>}
          {s.height&&<span>Height: <b style={{color:'#1A1A1A'}}>{s.height}ft</b></span>}
          {n(s.adj_contract_value)>0&&<span>Contract: <b style={{color:'#1A1A1A'}}>{$(s.adj_contract_value)}</b></span>}
        </div>
        <div style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>LF Detail</div>
          {PROD_LF_SECTIONS.map(sec=>{const hasData=sec.fields.some(([,f])=>n(s[f])>0);if(!hasData)return null;return<div key={sec.title} style={{marginBottom:8}}>
            <div style={{fontSize:9,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4,padding:'3px 6px',background:sec.bg,borderRadius:4,display:'inline-block'}}>{sec.title}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:6}}>
              {sec.fields.map(([label,field])=>{const v=n(s[field]);return v>0?<div key={field} style={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,padding:'4px 8px'}}>
                <div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase'}}>{label}</div>
                <div style={{fontFamily:'Inter',fontSize:13,fontWeight:700}}>{v.toLocaleString()}</div>
              </div>:null;}).filter(Boolean)}
            </div>
          </div>;})}
          <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #E5E3E0',display:'flex',gap:16}}>
            <div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Total LF</div><div style={{fontFamily:'Inter',fontSize:15,fontWeight:800,color:'#8B2020'}}>{n(s.total_lf).toLocaleString()}</div></div>
            {s.pct_complete_pm!=null&&<div><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>PM % Complete</div><div style={{fontFamily:'Inter',fontSize:15,fontWeight:800}}>{s.pct_complete_pm}%</div></div>}
          </div>
        </div>
        {s.notes&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:14}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',marginBottom:4}}>PM Notes</div><div style={{fontSize:13,color:'#1A1A1A',whiteSpace:'pre-wrap'}}>{s.notes}</div></div>}
        <div style={{fontSize:12,color:'#6B6056',marginBottom:14}}>
          Submitted by <b>{s.pm||'\u2014'}</b> on {s.submitted_at?new Date(s.submitted_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'\u2014'}
          {s.ar_reviewed&&<span style={{marginLeft:12,color:'#1D4ED8',fontWeight:600}}>\u2713 Reviewed by AR{s.ar_reviewed_by?' \u2014 '+s.ar_reviewed_by:''}</span>}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end'}}><button onClick={()=>setProdBillModal(null)} style={btnS}>Close</button></div>
      </div>
    </div>;})()}
    {showPinModal&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowPinModal(false)}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:320,boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:18,fontWeight:800,marginBottom:6,textAlign:'center'}}>Unlock Editing</div>
        <div style={{fontSize:12,color:'#6B6056',marginBottom:16,textAlign:'center'}}>Enter the 4-digit PIN to enable edits</div>
        <input autoFocus type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pinInput} onChange={e=>{setPinInput(e.target.value.replace(/\D/g,'').slice(0,4));setPinError(false);}} onKeyDown={e=>{if(e.key==='Enter')submitPin();}} placeholder="••••" style={{width:'100%',padding:'14px 16px',fontSize:24,textAlign:'center',letterSpacing:8,border:`2px solid ${pinError?'#DC2626':'#E5E3E0'}`,borderRadius:10,outline:'none',marginBottom:10,fontFamily:'Inter',fontWeight:700}}/>
        {pinError&&<div style={{color:'#DC2626',fontSize:12,fontWeight:600,textAlign:'center',marginBottom:10}}>Incorrect PIN</div>}
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setShowPinModal(false)} style={{...btnS,flex:1}}>Cancel</button>
          <button onClick={submitPin} style={{...btnP,flex:2}}>Submit</button>
        </div>
      </div>
    </div>}
  </div>);
}

/* ═══ REPORTS PAGE ═══ */
function ReportsPage({jobs,onNav,onOpenJob}){
  const[activeRpt,setActiveRpt]=useState(null);const active=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  // Production data (molds + plant config + per-style CY) — fetched once for the production reports
  const[moldInventory,setMoldInventory]=useState([]);
  const[plantCfg,setPlantCfg]=useState({});
  const[calcStyles,setCalcStyles]=useState([]);
  const[reportsLoadedAt,setReportsLoadedAt]=useState(null);
  useEffect(()=>{
    Promise.all([
      sbGet('mold_inventory','select=style_name,total_molds'),
      sbGet('plant_config','select=key,value'),
      sbGet('material_calc_styles','select=style_name,cy_per_panel'),
    ]).then(([molds,cfg,cs])=>{
      setMoldInventory(molds||[]);
      const m={};(cfg||[]).forEach(r=>{m[r.key]=n(r.value);});setPlantCfg(m);
      setCalcStyles(cs||[]);
      setReportsLoadedAt(new Date());
    }).catch(e=>console.error('Reports data load failed:',e));
  },[]);
  // Only physical mold sets — drop child styles that share a parent's molds
  const physicalMolds=useMemo(()=>moldInventory.filter(r=>n(r.total_molds)>0&&!isChildStyle(r.style_name)),[moldInventory]);
  const moldsByCanonical=useMemo(()=>{const m={};physicalMolds.forEach(r=>{m[r.style_name]=n(r.total_molds);});return m;},[physicalMolds]);
  const cyByStyle=useMemo(()=>{const m={};calcStyles.forEach(s=>{m[s.style_name]=n(s.cy_per_panel);});return m;},[calcStyles]);
  const UTIL_RATE=n(plantCfg.mold_utilization_rate)||0.88;
  const SCRAP=n(plantCfg.scrap_rate_warm)||0.03;
  const ACC=n(plantCfg.accessory_overhead_multiplier)||1.4;
  const dailyCapacityFor=(style)=>{const c=canonicalStyle(style);const molds=moldsByCanonical[c]||0;if(!molds)return 0;return Math.floor(molds*12*UTIL_RATE);};
  const sumJobMaterial=(j,group)=>{const keys=PLAN_PIECE_TYPES.filter(pt=>pt.group===group).map(pt=>'material_'+pt.key);return keys.reduce((s,k)=>s+n(j[k]),0);};

  const reports=[{id:'ltb_rep',title:'Left to Bill by Sales Rep',desc:'Balance per rep'},{id:'aging',title:'Billing Aging',desc:'Unbilled projects by age'},{id:'lf_week',title:'LF by Week',desc:'LF scheduled by week'},{id:'pipeline',title:'Pipeline by Market',desc:'Values by status & market'},{id:'revenue',title:'Revenue vs Pipeline',desc:'Billed vs remaining'},{id:'prod_sched',title:'Production Schedule',desc:'Queued & in-production'},{id:'change_orders',title:'Change Orders Summary',desc:'All change order activity'},{id:'rep_matrix',title:'Rep × Market Matrix',desc:'Cross-tab by rep and market'},{id:'sales_product',title:'Sales by Product',desc:'Revenue and LF breakdown by product type — Precast, Masonry/SW, Wrought Iron, Gates'},{id:'outstanding',title:'Outstanding Collections',desc:'Complete jobs not yet collected'}];
  const productionReports=[
    {id:'prod_backlog',title:'Production Backlog by Style',desc:'LF, panels, CYD, and estimated production days for all queued and in-production jobs grouped by style.'},
    {id:'prod_missing',title:'Jobs Not Ready for Production',desc:'Active jobs missing material calculation, style, or color — blocking them from being added to a production plan.'},
    {id:'prod_outlook',title:'Production Schedule Outlook',desc:'Projected ready date per job vs install start date — flags jobs at risk of missing their install window.'},
  ];
  const comingSoonReports=[
    {id:'daily_pva',title:'Daily Planned vs Actual',desc:'Shift-by-shift plan achievement over time'},
    {id:'mold_util',title:'Mold Utilization Over Time',desc:'Historical capacity usage trend'},
    {id:'prod_eff',title:'Production Efficiency by Shift',desc:'Shift 1 vs Shift 2 throughput comparison'},
    {id:'lf_prod_vs_install',title:'LF Produced vs LF Installed',desc:'Gap between plant output and field consumption'},
  ];
  const[prodSec,setProdSec]=useState({pc:false,sw:false,wi:false});
  const renderReport=()=>{
    if(activeRpt==='ltb_rep'){const reps={};active.forEach(j=>{const r=j.sales_rep||'Unassigned';if(!reps[r])reps[r]={rep:r,count:0,tc:0,ytd:0,ltb:0};reps[r].count++;reps[r].tc+=n(j.adj_contract_value||j.contract_value);reps[r].ytd+=n(j.ytd_invoiced);reps[r].ltb+=n(j.left_to_bill);});const data=Object.values(reps).sort((a,b)=>b.ltb-a.ltb);return<div><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Rep','Projects','Contract','YTD','LTB','%'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{data.map(r=><tr key={r.rep} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:8,fontWeight:600}}>{r.rep}</td><td style={{padding:8}}>{r.count}</td><td style={{padding:8,fontFamily:'Inter',fontWeight:700}}>{$(r.tc)}</td><td style={{padding:8}}>{$(r.ytd)}</td><td style={{padding:8,fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(r.ltb)}</td><td style={{padding:8}}>{r.tc>0?Math.round(r.ytd/r.tc*100):0}%</td></tr>)}</tbody></table><div style={{marginTop:16}}><ResponsiveContainer width="100%" height={200}><BarChart data={data} barSize={30}><XAxis dataKey="rep" tick={{fill:'#6B6056',fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>$k(v)}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Bar dataKey="ltb" fill="#8B2020" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></div>;}
    if(activeRpt==='aging'){const unbilled=active.filter(j=>n(j.pct_billed)===0);const bkts={'Not Started':unbilled.filter(j=>n(j.contract_age)<30),Watch:unbilled.filter(j=>n(j.contract_age)>=30&&n(j.contract_age)<60),Overdue:unbilled.filter(j=>n(j.contract_age)>=60&&n(j.contract_age)<90),Critical:unbilled.filter(j=>n(j.contract_age)>=90)};const colors={'Not Started':'#9E9B96',Watch:'#B45309',Overdue:'#C2410C',Critical:'#991B1B'};return<div>{Object.entries(bkts).map(([name,bj])=>bj.length>0&&<div key={name} style={{marginBottom:16}}><div style={{fontFamily:'Inter',fontWeight:700,color:colors[name],marginBottom:6}}>{name} ({bj.length}) — {$(bj.reduce((s,j)=>s+n(j.contract_value),0))}</div><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><tbody>{bj.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2',borderLeft:`3px solid ${colors[name]}`}}><td style={{padding:'6px 8px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.contract_value)}</td><td style={{padding:'6px 8px',color:colors[name]}}>{j.contract_age}d</td></tr>)}</tbody></table></div>)}</div>;}
    if(activeRpt==='pipeline'){const data=MKTS.map(m=>{const d={name:MS[m]};STS.forEach(s=>{d[s]=jobs.filter(j=>j.market===m&&j.status===s).reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);});return d;});return<ResponsiveContainer width="100%" height={300}><BarChart data={data}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>$k(v)}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/>{STS.map(s=><Bar key={s} dataKey={s} stackId="a" fill={SC[s]} name={SS[s]}/>)}</BarChart></ResponsiveContainer>;}
    if(activeRpt==='revenue'){const data=MKTS.map(m=>{const mj=active.filter(j=>j.market===m);return{name:MS[m],billed:mj.reduce((s,j)=>s+n(j.ytd_invoiced),0),remaining:mj.reduce((s,j)=>s+n(j.left_to_bill),0)};});return<ResponsiveContainer width="100%" height={260}><BarChart data={data} barSize={30}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>$k(v)}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/><Bar dataKey="billed" fill="#065F46" name="Billed" radius={[4,4,0,0]}/><Bar dataKey="remaining" fill="#B45309" name="Remaining" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>;}
    if(activeRpt==='prod_sched'){const pj=jobs.filter(j=>['production_queue','in_production','inventory_ready','active_install','fence_complete'].includes(j.status)).sort((a,b)=>new Date(a.est_start_date||'9999')-new Date(b.est_start_date||'9999'));return<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Code','Project','Market','Fence','LF','Est Start','Rep','Contract','LTB'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{pj.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px'}}>{j.job_number}</td><td style={{padding:'6px 8px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px'}}>{j.fence_type||'—'}</td><td style={{padding:'6px 8px'}}>{n(j.total_lf).toLocaleString()}</td><td style={{padding:'6px 8px'}}><StartDateBadge date={j.est_start_date} status={j.status}/></td><td style={{padding:'6px 8px'}}>{j.sales_rep||'—'}</td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td><td style={{padding:'6px 8px',color:'#8B2020',fontFamily:'Inter',fontWeight:700}}>{$(j.left_to_bill)}</td></tr>)}</tbody></table>;}
    if(activeRpt==='lf_week'){const weeks={};active.forEach(j=>{if(!j.est_start_date)return;const d=new Date(j.est_start_date);const mon=new Date(d);mon.setDate(mon.getDate()-mon.getDay()+1);const k=mon.toISOString().split('T')[0];if(!weeks[k])weeks[k]={week:k,total:0};MKTS.forEach(m=>{if(!weeks[k][m])weeks[k][m]=0;});weeks[k][j.market]=(weeks[k][j.market]||0)+n(j.total_lf);weeks[k].total+=n(j.total_lf);});const data=Object.values(weeks).sort((a,b)=>a.week.localeCompare(b.week)).slice(0,16);return<ResponsiveContainer width="100%" height={250}><BarChart data={data}><XAxis dataKey="week" tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>{const d=new Date(v);return`${d.getMonth()+1}/${d.getDate()}`;}} /><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/>{MKTS.map(m=><Bar key={m} dataKey={m} stackId="a" fill={MC[m]} name={MS[m]}/>)}</BarChart></ResponsiveContainer>;}
    if(activeRpt==='change_orders'){const co=jobs.filter(j=>n(j.change_orders)!==0).sort((a,b)=>n(b.change_orders)-n(a.change_orders));return<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Project','Market','Original','Change Orders','Adj. Contract','CO %'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{co.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.contract_value)}</td><td style={{padding:'6px 8px',color:n(j.change_orders)>0?'#065F46':'#991B1B',fontFamily:'Inter',fontWeight:700}}>{$(j.change_orders)}</td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value)}</td><td style={{padding:'6px 8px'}}>{n(j.contract_value)>0?Math.round(n(j.change_orders)/n(j.contract_value)*100):0}%</td></tr>)}</tbody></table>;}
    if(activeRpt==='rep_matrix'){const matrix={};jobs.forEach(j=>{const r=j.sales_rep||'Unassigned';const m=j.market||'Other';if(!matrix[r])matrix[r]={};if(!matrix[r][m])matrix[r][m]={count:0,val:0};matrix[r][m].count++;matrix[r][m].val+=n(j.adj_contract_value||j.contract_value);});const repKeys=Object.keys(matrix).sort();const allMkts=[...MKTS,'Other'];const maxVal=Math.max(...repKeys.flatMap(r=>allMkts.map(m=>matrix[r]?.[m]?.val||0)),1);return<div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr><th style={{padding:8,textAlign:'left',borderBottom:'2px solid #E5E3E0',color:'#6B6056',fontWeight:600,fontSize:11}}>Rep</th>{allMkts.map(m=><th key={m} style={{padding:8,textAlign:'center',borderBottom:'2px solid #E5E3E0',color:'#6B6056',fontWeight:600,fontSize:11}}>{MS[m]||m}</th>)}</tr></thead><tbody>{repKeys.map(r=><tr key={r} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px',fontWeight:600}}>{r}</td>{allMkts.map(m=>{const cell=matrix[r]?.[m];const intensity=cell?Math.min(cell.val/maxVal,1):0;return<td key={m} style={{padding:'6px 8px',textAlign:'center',background:`rgba(139,32,32,${intensity*0.15})`}}>{cell?<div><div style={{fontWeight:700}}>{cell.count}</div><div style={{fontSize:10,color:'#6B6056'}}>{$k(cell.val)}</div></div>:'—'}</td>;})}</tr>)}</tbody></table></div>;}
    if(activeRpt==='sales_product'){
      const aj=active;const totalLF=aj.reduce((s,j)=>s+n(j.total_lf),0);
      const pc={jobs:aj.filter(j=>n(j.lf_precast)>0),lf:aj.reduce((s,j)=>s+n(j.lf_precast),0),rev:aj.reduce((s,j)=>n(j.lf_precast)>0&&n(j.contract_rate_precast)>0?s+n(j.lf_precast)*n(j.contract_rate_precast):s,0)};
      const sw={jobs:aj.filter(j=>n(j.lf_single_wythe)>0),lf:aj.reduce((s,j)=>s+n(j.lf_single_wythe),0),rev:aj.reduce((s,j)=>n(j.lf_single_wythe)>0&&n(j.contract_rate_single_wythe)>0?s+n(j.lf_single_wythe)*n(j.contract_rate_single_wythe):s,0)};
      const wi={jobs:aj.filter(j=>n(j.lf_wrought_iron)>0),lf:aj.reduce((s,j)=>s+n(j.lf_wrought_iron),0),rev:aj.reduce((s,j)=>n(j.lf_wrought_iron)>0&&n(j.contract_rate_wrought_iron)>0?s+n(j.lf_wrought_iron)*n(j.contract_rate_wrought_iron):s,0)};
      const gt={jobs:aj.filter(j=>n(j.number_of_gates)>0),count:aj.reduce((s,j)=>s+n(j.number_of_gates),0),rev:aj.reduce((s,j)=>n(j.number_of_gates)>0&&n(j.gate_rate)>0?s+n(j.number_of_gates)*n(j.gate_rate):s,0)};
      const chartData=MKTS.map(m=>{const mj=aj.filter(j=>j.market===m);return{name:MS[m],PC:mj.reduce((s,j)=>s+n(j.lf_precast),0),SW:mj.reduce((s,j)=>s+n(j.lf_single_wythe),0),WI:mj.reduce((s,j)=>s+n(j.lf_wrought_iron),0)};});
      const mixData=MKTS.map(m=>{const mj=aj.filter(j=>j.market===m);const pclf=mj.reduce((s,j)=>s+n(j.lf_precast),0);const swlf=mj.reduce((s,j)=>s+n(j.lf_single_wythe),0);const wilf=mj.reduce((s,j)=>s+n(j.lf_wrought_iron),0);const tlf=mj.reduce((s,j)=>s+n(j.total_lf),0);const gates=mj.reduce((s,j)=>s+n(j.number_of_gates),0);const cv=mj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);return{market:MS[m],jobs:mj.length,pclf,pcPct:tlf>0?Math.round(pclf/tlf*1000)/10:0,swlf,swPct:tlf>0?Math.round(swlf/tlf*1000)/10:0,wilf,wiPct:tlf>0?Math.round(wilf/tlf*1000)/10:0,gates,tlf,cv};});
      const totRow={market:'Total',jobs:aj.length,pclf:pc.lf,pcPct:totalLF>0?Math.round(pc.lf/totalLF*1000)/10:0,swlf:sw.lf,swPct:totalLF>0?Math.round(sw.lf/totalLF*1000)/10:0,wilf:wi.lf,wiPct:totalLF>0?Math.round(wi.lf/totalLF*1000)/10:0,gates:gt.count,tlf:totalLF,cv:aj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0)};
      const avgRate=(field,rateField)=>{const valid=aj.filter(j=>n(j[field])>0&&n(j[rateField])>0);return valid.length>0?valid.reduce((s,j)=>s+n(j[rateField]),0)/valid.length:0;};
      const avgByMkt=(mkt,field,rateField)=>{const mj=aj.filter(j=>j.market===mkt&&n(j[field])>0&&n(j[rateField])>0);return mj.length>0?mj.reduce((s,j)=>s+n(j[rateField]),0)/mj.length:0;};
      const overallPC=avgRate('lf_precast','contract_rate_precast');const overallSW=avgRate('lf_single_wythe','contract_rate_single_wythe');const overallWI=avgRate('lf_wrought_iron','contract_rate_wrought_iron');const overallGt=avgRate('number_of_gates','gate_rate');
      const rateColor=(v,avg)=>v===0?'#9E9B96':v>=avg?'#065F46':'#991B1B';
      const exportProductCSV=()=>{const rows=[['Product','Jobs','LF','Est Revenue'],['Precast',pc.jobs.length,pc.lf,pc.rev],['Single Wythe',sw.jobs.length,sw.lf,sw.rev],['Wrought Iron',wi.jobs.length,wi.lf,wi.rev],['Gates',gt.jobs.length,gt.count,gt.rev]];const csv=rows.map(r=>r.join(',')).join('\n');const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='sales-by-product.csv';a.click();};
      const thS={textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase',borderBottom:'2px solid #E5E3E0'};
      const tdS={padding:'6px 8px',fontSize:12};
      const pcJobs=[...pc.jobs].sort((a,b)=>n(b.lf_precast)-n(a.lf_precast));
      const swJobs=[...sw.jobs].sort((a,b)=>n(b.lf_single_wythe)-n(a.lf_single_wythe));
      const wiGateJobs=[...aj.filter(j=>n(j.lf_wrought_iron)>0||n(j.number_of_gates)>0)].sort((a,b)=>(n(b.lf_wrought_iron)*n(b.contract_rate_wrought_iron)+n(b.number_of_gates)*n(b.gate_rate))-(n(a.lf_wrought_iron)*n(a.contract_rate_wrought_iron)+n(a.number_of_gates)*n(a.gate_rate)));
      return<div>
        {/* Export */}
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}><button onClick={exportProductCSV} style={btnP}>Export CSV</button></div>
        {/* Section 1 — Product Summary Cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
          <div style={{...card,borderTop:'3px solid #8B2020'}}><div style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase',marginBottom:8}}>Precast (PC)</div><div style={{fontSize:22,fontWeight:800,color:'#8B2020',marginBottom:4}}>{pc.lf.toLocaleString()} LF</div><div style={{fontSize:12,color:'#6B6056'}}>{pc.jobs.length} jobs · {totalLF>0?Math.round(pc.lf/totalLF*100):0}% of total LF</div><div style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginTop:6}}>Est. Rev: {$(pc.rev)}</div></div>
          <div style={{...card,borderTop:'3px solid #1D4ED8'}}><div style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase',marginBottom:8}}>Single Wythe / Masonry (SW)</div><div style={{fontSize:22,fontWeight:800,color:'#1D4ED8',marginBottom:4}}>{sw.lf.toLocaleString()} LF</div><div style={{fontSize:12,color:'#6B6056'}}>{sw.jobs.length} jobs · {totalLF>0?Math.round(sw.lf/totalLF*100):0}% of total LF</div><div style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginTop:6}}>Est. Rev: {$(sw.rev)}</div></div>
          <div style={{...card,borderTop:'3px solid #6D28D9'}}><div style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase',marginBottom:8}}>Wrought Iron (WI)</div><div style={{fontSize:22,fontWeight:800,color:'#6D28D9',marginBottom:4}}>{wi.lf.toLocaleString()} LF</div><div style={{fontSize:12,color:'#6B6056'}}>{wi.jobs.length} jobs · {totalLF>0?Math.round(wi.lf/totalLF*100):0}% of total LF</div><div style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginTop:6}}>Est. Rev: {$(wi.rev)}</div></div>
          <div style={{...card,borderTop:'3px solid #F59E0B'}}><div style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase',marginBottom:8}}>Gates</div><div style={{fontSize:22,fontWeight:800,color:'#F59E0B',marginBottom:4}}>{gt.count.toLocaleString()} Gates</div><div style={{fontSize:12,color:'#6B6056'}}>{gt.jobs.length} jobs · {aj.length>0?Math.round(gt.jobs.length/aj.length*100):0}% of jobs</div><div style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginTop:6}}>Est. Rev: {$(gt.rev)}</div></div>
        </div>
        {/* Section 2 — Stacked Bar Chart */}
        <div style={{marginBottom:24}}><div style={{fontWeight:700,fontSize:13,marginBottom:12}}>LF by Product Type — by Market</div>
          <ResponsiveContainer width="100%" height={280}><BarChart data={chartData}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>v.toLocaleString()}/><Tooltip formatter={(v,name)=>[v.toLocaleString()+' LF',name]} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/><Bar dataKey="PC" stackId="a" fill="#8B2020" name="Precast"/><Bar dataKey="SW" stackId="a" fill="#1D4ED8" name="Single Wythe"/><Bar dataKey="WI" stackId="a" fill="#6D28D9" name="Wrought Iron"/></BarChart></ResponsiveContainer>
        </div>
        {/* Section 3 — Product Mix Table */}
        <div style={{marginBottom:24}}><div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Product Mix by Market</div>
          <div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Market','Jobs','PC LF','PC %','SW LF','SW %','WI LF','WI %','Gates','Total LF','Contract Value'].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>{[...mixData,totRow].map((r,i)=>{const isTotal=r.market==='Total';return<tr key={r.market} style={{borderBottom:'1px solid #F4F4F2',fontWeight:isTotal?700:400,background:isTotal?'#F9F8F6':'transparent'}}>
              <td style={tdS}>{r.market}</td><td style={tdS}>{r.jobs}</td>
              <td style={tdS}>{r.pclf.toLocaleString()}</td><td style={{...tdS,color:r.pcPct<50?'#991B1B':'#1A1A1A',background:r.pcPct<50?'#FEF2F210':'transparent'}}>{r.pcPct}%</td>
              <td style={tdS}>{r.swlf.toLocaleString()}</td><td style={{...tdS,color:r.swPct>20?'#1D4ED8':'#1A1A1A',background:r.swPct>20?'#DBEAFE30':'transparent'}}>{r.swPct}%</td>
              <td style={tdS}>{r.wilf.toLocaleString()}</td><td style={{...tdS,color:r.wiPct>5?'#6D28D9':'#1A1A1A',background:r.wiPct>5?'#EDE9FE30':'transparent'}}>{r.wiPct}%</td>
              <td style={tdS}>{r.gates}</td><td style={{...tdS,fontWeight:700}}>{r.tlf.toLocaleString()}</td><td style={{...tdS,fontWeight:700}}>{$(r.cv)}</td>
            </tr>;})}</tbody></table></div>
        </div>
        {/* Section 4 — Product Detail Tables */}
        <div style={{marginBottom:24}}>
          {/* A. Precast */}
          <div style={{marginBottom:12}}><button onClick={()=>setProdSec(p=>({...p,pc:!p.pc}))} style={{display:'flex',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',fontWeight:700,fontSize:13,color:'#8B2020',padding:0}}>
            <span style={{fontSize:11,transition:'transform .2s',transform:prodSec.pc?'rotate(90deg)':'rotate(0deg)',display:'inline-block'}}>▶</span>
            Precast Jobs ({pcJobs.length}) — {pc.lf.toLocaleString()} LF · {$(pc.rev)} est. revenue
          </button>
          {prodSec.pc&&<div style={{overflow:'auto',marginTop:8}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Code','Project','Market','Style','Color','LF Precast','Height','Rate/LF','Est. PC Revenue','Status','Rep'].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>{pcJobs.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
              <td style={tdS}>{j.job_number}</td><td style={{...tdS,fontWeight:500,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={tdS}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={tdS}>{j.style||'—'}</td><td style={tdS}>{j.color||'—'}</td><td style={{...tdS,fontWeight:700}}>{n(j.lf_precast).toLocaleString()}</td><td style={tdS}>{j.height_precast||'—'}</td><td style={tdS}>{n(j.contract_rate_precast)>0?'$'+n(j.contract_rate_precast).toFixed(2):'—'}</td><td style={{...tdS,fontWeight:700}}>{n(j.lf_precast)>0&&n(j.contract_rate_precast)>0?$(n(j.lf_precast)*n(j.contract_rate_precast)):'—'}</td><td style={tdS}><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]||'—'}</span></td><td style={tdS}>{j.sales_rep||'—'}</td>
            </tr>)}</tbody></table></div>}</div>
          {/* B. Single Wythe */}
          <div style={{marginBottom:12}}><button onClick={()=>setProdSec(p=>({...p,sw:!p.sw}))} style={{display:'flex',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',fontWeight:700,fontSize:13,color:'#1D4ED8',padding:0}}>
            <span style={{fontSize:11,transition:'transform .2s',transform:prodSec.sw?'rotate(90deg)':'rotate(0deg)',display:'inline-block'}}>▶</span>
            Single Wythe / Masonry Jobs ({swJobs.length}) — {sw.lf.toLocaleString()} LF · {$(sw.rev)} est. revenue
          </button>
          {prodSec.sw&&<div style={{overflow:'auto',marginTop:8}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Code','Project','Market','Style SW','LF SW','Height SW','Rate/LF','Est. SW Revenue','Status','Rep'].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>{swJobs.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
              <td style={tdS}>{j.job_number}</td><td style={{...tdS,fontWeight:500,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={tdS}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={tdS}>{j.style_single_wythe||'—'}</td><td style={{...tdS,fontWeight:700}}>{n(j.lf_single_wythe).toLocaleString()}</td><td style={tdS}>{j.height_single_wythe||'—'}</td><td style={tdS}>{n(j.contract_rate_single_wythe)>0?'$'+n(j.contract_rate_single_wythe).toFixed(2):'—'}</td><td style={{...tdS,fontWeight:700}}>{n(j.lf_single_wythe)>0&&n(j.contract_rate_single_wythe)>0?$(n(j.lf_single_wythe)*n(j.contract_rate_single_wythe)):'—'}</td><td style={tdS}><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]||'—'}</span></td><td style={tdS}>{j.sales_rep||'—'}</td>
            </tr>)}</tbody></table></div>}</div>
          {/* C. Wrought Iron & Gates */}
          <div style={{marginBottom:12}}><button onClick={()=>setProdSec(p=>({...p,wi:!p.wi}))} style={{display:'flex',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',fontWeight:700,fontSize:13,color:'#6D28D9',padding:0}}>
            <span style={{fontSize:11,transition:'transform .2s',transform:prodSec.wi?'rotate(90deg)':'rotate(0deg)',display:'inline-block'}}>▶</span>
            Wrought Iron & Gates ({wiGateJobs.length}) — {wi.lf.toLocaleString()} LF WI · {gt.count} gates · {$(wi.rev+gt.rev)} est. revenue
          </button>
          {prodSec.wi&&<div style={{overflow:'auto',marginTop:8}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Code','Project','Market','Fence Type','LF WI','WI Rate','Gates','Gate Rate','Est. WI Rev','Est. Gate Rev','Status','Rep'].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>{wiGateJobs.map(j=>{const hasWI=n(j.lf_wrought_iron)>0;const hasGt=n(j.number_of_gates)>0;const ftPill=hasWI&&hasGt?pill('#6D28D9','#EDE9FE'):hasWI?pill('#6D28D9','#EDE9FE'):pill('#F59E0B','#FEF3C7');return<tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
              <td style={tdS}>{j.job_number}</td><td style={{...tdS,fontWeight:500,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={tdS}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={tdS}><span style={ftPill}>{j.fence_type||'—'}</span></td><td style={{...tdS,fontWeight:700}}>{hasWI?n(j.lf_wrought_iron).toLocaleString():'—'}</td><td style={tdS}>{n(j.contract_rate_wrought_iron)>0?'$'+n(j.contract_rate_wrought_iron).toFixed(2):'—'}</td><td style={{...tdS,fontWeight:700}}>{hasGt?n(j.number_of_gates):'—'}</td><td style={tdS}>{n(j.gate_rate)>0?'$'+n(j.gate_rate).toFixed(2):'—'}</td><td style={{...tdS,fontWeight:700,color:'#6D28D9'}}>{hasWI&&n(j.contract_rate_wrought_iron)>0?$(n(j.lf_wrought_iron)*n(j.contract_rate_wrought_iron)):'—'}</td><td style={{...tdS,fontWeight:700,color:'#F59E0B'}}>{hasGt&&n(j.gate_rate)>0?$(n(j.number_of_gates)*n(j.gate_rate)):'—'}</td><td style={tdS}><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]||'—'}</span></td><td style={tdS}>{j.sales_rep||'—'}</td>
            </tr>;})}</tbody></table></div>}</div>
        </div>
        {/* Section 5 — Average Rates */}
        <div><div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Average Rates by Product & Market</div>
          <div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Market','Avg PC Rate/LF','Avg SW Rate/LF','Avg WI Rate/LF','Avg Gate Rate'].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>{[...MKTS.map(m=>{const pcR=avgByMkt(m,'lf_precast','contract_rate_precast');const swR=avgByMkt(m,'lf_single_wythe','contract_rate_single_wythe');const wiR=avgByMkt(m,'lf_wrought_iron','contract_rate_wrought_iron');const gtR=avgByMkt(m,'number_of_gates','gate_rate');return{market:MS[m],pcR,swR,wiR,gtR};}),{market:'Overall',pcR:overallPC,swR:overallSW,wiR:overallWI,gtR:overallGt}].map((r,i)=>{const isOv=r.market==='Overall';return<tr key={r.market} style={{borderBottom:'1px solid #F4F4F2',fontWeight:isOv?700:400,background:isOv?'#F9F8F6':'transparent'}}>
              <td style={tdS}>{r.market}</td>
              <td style={{...tdS,color:isOv?'#1A1A1A':rateColor(r.pcR,overallPC),fontWeight:600}}>{r.pcR>0?'$'+r.pcR.toFixed(2):'—'}</td>
              <td style={{...tdS,color:isOv?'#1A1A1A':rateColor(r.swR,overallSW),fontWeight:600}}>{r.swR>0?'$'+r.swR.toFixed(2):'—'}</td>
              <td style={{...tdS,color:isOv?'#1A1A1A':rateColor(r.wiR,overallWI),fontWeight:600}}>{r.wiR>0?'$'+r.wiR.toFixed(2):'—'}</td>
              <td style={{...tdS,color:isOv?'#1A1A1A':rateColor(r.gtR,overallGt),fontWeight:600}}>{r.gtR>0?'$'+r.gtR.toFixed(2):'—'}</td>
            </tr>;})}</tbody></table></div>
        </div>
      </div>;
    }
    if(activeRpt==='outstanding'){const oc=jobs.filter(j=>j.status==='fully_complete'&&!j.collected).sort((a,b)=>{const ad=a.complete_date?Math.round((Date.now()-new Date(a.complete_date).getTime())/86400000):0;const bd=b.complete_date?Math.round((Date.now()-new Date(b.complete_date).getTime())/86400000):0;return bd-ad;});const totalOut=oc.reduce((s,j)=>s+n(j.left_to_bill),0);return<div><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Project','Job #','PM','Market','Contract','Left to Bill','Complete Date','Days Since'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{oc.map(j=>{const days=j.complete_date?Math.round((Date.now()-new Date(j.complete_date).getTime())/86400000):0;return<tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}>{j.job_number||'—'}</td><td style={{padding:'6px 8px'}}>{j.pm||'—'}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700,color:'#991B1B'}}>{$(j.left_to_bill)}</td><td style={{padding:'6px 8px'}}>{fD(j.complete_date)}</td><td style={{padding:'6px 8px',fontWeight:700,color:days>90?'#991B1B':days>30?'#B45309':'#6B6056'}}>{days}d</td></tr>;})}</tbody></table>{oc.length===0&&<div style={{padding:20,textAlign:'center',color:'#9E9B96'}}>No outstanding collections</div>}<div style={{marginTop:12,padding:12,background:'#F9F8F6',borderRadius:8,fontFamily:'Inter',fontWeight:700}}>Total Outstanding: <span style={{color:'#991B1B'}}>{$(totalOut)}</span> across {oc.length} jobs</div></div>;}
    // ═══ PRODUCTION REPORTS ═══
    if(activeRpt==='prod_backlog'){
      const backlogJobs=jobs.filter(j=>['production_queue','in_production'].includes(j.status));
      const byStyle={};
      backlogJobs.forEach(j=>{
        const s=j.style||'(Unknown)';
        if(!byStyle[s])byStyle[s]={style:s,jobs:0,lf:0,panels:0,cyd:0,capacity:dailyCapacityFor(s)};
        byStyle[s].jobs++;
        byStyle[s].lf+=n(j.total_lf);
        const panelsJob=sumJobMaterial(j,'PANELS');
        byStyle[s].panels+=panelsJob;
        byStyle[s].cyd+=panelsJob*n(cyByStyle[j.style])*ACC;
      });
      const rows=Object.values(byStyle).map(r=>({...r,days:r.capacity>0&&r.panels>0?Math.ceil(r.panels/r.capacity):null})).sort((a,b)=>b.lf-a.lf);
      const totJobs=rows.reduce((s,r)=>s+r.jobs,0);
      const totLf=rows.reduce((s,r)=>s+r.lf,0);
      const totPanels=rows.reduce((s,r)=>s+r.panels,0);
      const totCyd=rows.reduce((s,r)=>s+r.cyd,0);
      const maxLf=Math.max(...rows.map(r=>r.lf),1);
      return<div>
        <div style={{fontSize:13,color:'#6B6056',marginBottom:12}}>All jobs in <b style={{color:'#1A1A1A'}}>production_queue</b> or <b style={{color:'#1A1A1A'}}>in_production</b> — grouped by style, with daily mold capacity and estimated production days.</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Style','Jobs','Total LF','Total Panels','Daily Capacity','Est Prod Days','CYD Required'].map(h=><th key={h} style={{textAlign:h==='Style'?'left':'right',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(r=><tr key={r.style} style={{borderBottom:'1px solid #F4F4F2'}}>
            <td style={{padding:'6px 8px',fontWeight:600}}>{r.style}</td>
            <td style={{padding:'6px 8px',textAlign:'right'}}>{r.jobs}</td>
            <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Inter',fontWeight:700}}>{r.lf.toLocaleString()}</td>
            <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Inter',fontWeight:700}}>{r.panels.toLocaleString()}</td>
            <td style={{padding:'6px 8px',textAlign:'right',color:'#6B6056'}}>{r.capacity>0?`${r.capacity}/day`:'—'}</td>
            <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Inter',fontWeight:700,color:'#7C3AED'}}>{r.days!=null?`~${r.days.toLocaleString()} days`:'—'}</td>
            <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Inter',fontWeight:700,color:'#1D4ED8'}}>{r.cyd>0?r.cyd.toFixed(1)+' CYD':'—'}</td>
          </tr>)}
          <tr style={{borderTop:'2px solid #1A1A1A',background:'#F9F8F6'}}>
            <td style={{padding:'8px',fontWeight:800}}>TOTAL</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800}}>{totJobs}</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800}}>{totLf.toLocaleString()}</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800}}>{totPanels.toLocaleString()}</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800,color:'#6B6056'}}>—</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800,color:'#7C3AED'}}>—</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800,color:'#1D4ED8'}}>{totCyd.toFixed(1)} CYD</td>
          </tr>
          </tbody>
        </table>
        <div style={{marginTop:20}}>
          <div style={{fontSize:11,fontWeight:700,color:'#6B6056',textTransform:'uppercase',marginBottom:8}}>LF by Style</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>{rows.map(r=><div key={r.style}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}>
              <span style={{fontWeight:600}}>{r.style}</span>
              <span style={{fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{r.lf.toLocaleString()} LF</span>
            </div>
            <div style={{height:10,background:'#E5E3E0',borderRadius:5,overflow:'hidden'}}><div style={{width:`${r.lf/maxLf*100}%`,height:'100%',background:'#8B2020'}}/></div>
          </div>)}</div>
        </div>
        <div style={{marginTop:16,padding:'10px 14px',background:'#F9F8F6',borderRadius:8,fontSize:12,color:'#6B6056'}}>
          Total: <b style={{color:'#1A1A1A'}}>{totJobs} jobs</b> · <b style={{color:'#1A1A1A'}}>{totLf.toLocaleString()} LF</b> · <b style={{color:'#1A1A1A'}}>{totPanels.toLocaleString()} panels</b> · <b style={{color:'#1D4ED8'}}>{totCyd.toFixed(1)} CYD required</b> at current mold capacity
        </div>
      </div>;
    }
    if(activeRpt==='prod_missing'){
      const activeForProd=jobs.filter(j=>!CLOSED_SET.has(j.status)&&j.status!=='fully_complete'&&j.status!=='fence_complete');
      const missingCalc=activeForProd.filter(j=>!j.material_calc_date&&j.style&&j.color);
      const missingStyle=activeForProd.filter(j=>!j.style||!String(j.style).trim());
      const missingColor=activeForProd.filter(j=>j.style&&String(j.style).trim()&&(!j.color||!String(j.color).trim()));
      const total=missingCalc.length+missingStyle.length+missingColor.length;
      const sec=(title,color,bg,rows,cols,emptyMsg)=>rows.length===0?<div style={{padding:10,color:'#9E9B96',fontSize:12,fontStyle:'italic'}}>{emptyMsg}</div>:<div style={{marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:800,color,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>{title} ({rows.length})</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:bg}}>{[...cols.map(c=>c[0]),'Action'].map(h=><th key={h} style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
            {cols.map(([label,get])=><td key={label} style={{padding:'6px 10px',fontSize:12}}>{get(j)||'—'}</td>)}
            <td style={{padding:'6px 10px'}}><button onClick={()=>{if(onOpenJob)onOpenJob(j);}} style={{background:'none',border:`1px solid ${color}40`,color,padding:'3px 10px',borderRadius:5,fontSize:10,fontWeight:700,cursor:'pointer'}}>Edit Job →</button></td>
          </tr>)}</tbody>
        </table>
      </div>;
      return<div>
        <div style={{padding:'12px 16px',background:total>0?'#FEF3C7':'#D1FAE5',border:`1px solid ${total>0?'#B45309':'#065F46'}`,borderRadius:8,marginBottom:16,fontSize:13,fontWeight:700,color:total>0?'#B45309':'#065F46'}}>
          {total>0?`⚠️ ${total} ${total===1?'job needs':'jobs need'} attention before production can start`:'✓ All active jobs are ready for production'}
        </div>
        <div style={{fontSize:11,fontWeight:800,color:'#991B1B',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>A) Missing Style ({missingStyle.length})</div>
        <div style={{fontSize:11,color:'#6B6056',marginBottom:8}}>Can't calculate materials without style confirmed.</div>
        {sec('',(''),'#FEE2E2',missingStyle,[['Job #',j=>j.job_number],['Job Name',j=>j.job_name],['PM',j=>j.pm],['Market',j=>MS[j.market]||j.market],['LF',j=>n(j.total_lf).toLocaleString()]],'All active jobs have a style assigned')}
        <div style={{fontSize:11,fontWeight:800,color:'#B45309',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6,marginTop:16}}>B) Missing Color ({missingColor.length})</div>
        <div style={{fontSize:11,color:'#6B6056',marginBottom:8}}>Style confirmed but color not yet chosen.</div>
        {sec('',(''),'#FEF3C7',missingColor,[['Job #',j=>j.job_number],['Job Name',j=>j.job_name],['Style',j=>j.style],['PM',j=>j.pm],['LF',j=>n(j.total_lf).toLocaleString()]],'All active jobs with a style also have a color')}
        <div style={{fontSize:11,fontWeight:800,color:'#7C3AED',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6,marginTop:16}}>C) Missing Material Calculation ({missingCalc.length})</div>
        <div style={{fontSize:11,color:'#6B6056',marginBottom:8}}>Style + color are set but materials haven't been calculated yet — can't be added to a production plan.</div>
        {missingCalc.length===0?<div style={{padding:10,color:'#9E9B96',fontSize:12,fontStyle:'italic'}}>All eligible jobs have material calculations</div>:
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:'#EDE9FE'}}>{['Job #','Job Name','PM','Style','Color','LF','Est Start','Action'].map(h=><th key={h} style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{missingCalc.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
            <td style={{padding:'6px 10px'}}>{j.job_number}</td>
            <td style={{padding:'6px 10px',fontWeight:500}}>{j.job_name}</td>
            <td style={{padding:'6px 10px'}}>{j.pm||'—'}</td>
            <td style={{padding:'6px 10px'}}>{j.style||'—'}</td>
            <td style={{padding:'6px 10px'}}>{j.color||'—'}</td>
            <td style={{padding:'6px 10px'}}>{n(j.total_lf).toLocaleString()}</td>
            <td style={{padding:'6px 10px'}}>{j.est_start_date?fD(j.est_start_date):'—'}</td>
            <td style={{padding:'6px 10px'}}><button onClick={()=>{try{localStorage.setItem('fc_matcalc_prejob',j.id);}catch(e){}if(onNav)onNav('material_calc');}} style={{background:'none',border:'1px solid #7C3AED40',color:'#7C3AED',padding:'3px 10px',borderRadius:5,fontSize:10,fontWeight:700,cursor:'pointer'}}>Calculate Materials →</button></td>
          </tr>)}</tbody>
        </table>}
      </div>;
    }
    if(activeRpt==='prod_outlook'){
      const jobsList=jobs.filter(j=>['production_queue','in_production'].includes(j.status)&&j.material_calc_date).sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999'));
      const today0=new Date();today0.setHours(0,0,0,0);
      const rows=jobsList.map(j=>{
        const panels=sumJobMaterial(j,'PANELS');
        const cap=dailyCapacityFor(j.style);
        const days=cap>0&&panels>0?Math.ceil(panels/cap):null;
        let projReady=null;
        if(days!=null){const d=new Date(today0);d.setDate(d.getDate()+days+1);projReady=d;}
        const estStart=j.est_start_date?new Date(j.est_start_date+'T12:00:00'):null;
        let status='no_date',daysLate=0;
        if(estStart){
          if(projReady&&projReady<=estStart)status='on_track';
          else if(projReady){status='at_risk';daysLate=Math.ceil((projReady-estStart)/86400000);}
        }
        return{job:j,panels,cap,days,projReady,estStart,status,daysLate};
      });
      const onTrack=rows.filter(r=>r.status==='on_track').length;
      const atRisk=rows.filter(r=>r.status==='at_risk').length;
      const noDate=rows.filter(r=>r.status==='no_date').length;
      return<div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #065F46'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#065F46'}}>{onTrack}</div><div style={{fontSize:11,color:'#6B6056'}}>✓ On track</div></div>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #991B1B'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#991B1B'}}>{atRisk}</div><div style={{fontSize:11,color:'#6B6056'}}>⚠ At risk</div></div>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #9E9B96'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#6B6056'}}>{noDate}</div><div style={{fontSize:11,color:'#6B6056'}}>No install date</div></div>
        </div>
        <div style={{fontSize:11,color:'#6B6056',marginBottom:10}}>Projected ready date = today + estimated production days (assumes production starts tomorrow at current mold capacity).</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Job','Style','Panels','Prod Days','Projected Ready','Est Install Start','Status'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r,i)=>{const bg=r.status==='at_risk'?'#FEE2E2':r.status==='on_track'?'#F0FDF4':'#FFF';const col=r.status==='at_risk'?'#991B1B':r.status==='on_track'?'#065F46':'#9E9B96';return<tr key={r.job.id} style={{borderBottom:'1px solid #F4F4F2',background:bg}}>
            <td style={{padding:'6px 8px'}}><div style={{fontWeight:600}}>{r.job.job_name}</div><div style={{fontSize:10,color:'#9E9B96'}}>#{r.job.job_number}</div></td>
            <td style={{padding:'6px 8px'}}>{r.job.style||'—'}</td>
            <td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{r.panels.toLocaleString()}</td>
            <td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700,color:'#7C3AED'}}>{r.days!=null?`~${r.days} days`:'—'}</td>
            <td style={{padding:'6px 8px'}}>{r.projReady?r.projReady.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}</td>
            <td style={{padding:'6px 8px'}}>{r.job.est_start_date?fD(r.job.est_start_date):<span style={{color:'#9E9B96'}}>—</span>}</td>
            <td style={{padding:'6px 8px',fontWeight:700,color:col}}>{r.status==='on_track'?'✓ On Track':r.status==='at_risk'?`⚠ At Risk — ${r.daysLate} ${r.daysLate===1?'day':'days'} late`:'No install date set'}</td>
          </tr>;})}</tbody>
        </table>
        {rows.length===0&&<div style={{padding:24,textAlign:'center',color:'#9E9B96',fontSize:13}}>No jobs in production queue or in-production with material calculations.</div>}
      </div>;
    }
    return null;
  };
  const fmtLoadedAt=reportsLoadedAt?reportsLoadedAt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'—';
  const renderReportCard=(r)=><div key={r.id} style={{...card,display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
    <div>
      <div style={{fontFamily:'Inter',fontWeight:700,fontSize:14,marginBottom:4}}>{r.title}</div>
      <div style={{fontSize:12,color:'#6B6056',marginBottom:12}}>{r.desc}</div>
    </div>
    <button onClick={()=>setActiveRpt(activeRpt===r.id?null:r.id)} style={activeRpt===r.id?btnP:btnS}>{activeRpt===r.id?'Close':'View Report'}</button>
  </div>;
  return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:6}}>Reports</h1>
    {/* PRODUCTION REPORTS */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginTop:18,marginBottom:10}}>
      <div style={{fontSize:11,fontWeight:800,color:'#7C3AED',textTransform:'uppercase',letterSpacing:0.5}}>🏭 Production</div>
      <div style={{fontSize:10,color:'#9E9B96'}}>Data refreshed at {fmtLoadedAt}</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:16}}>{productionReports.map(renderReportCard)}</div>
    {/* PRODUCTION COMING SOON */}
    <div style={{...card,padding:14,background:'#F9F8F6',borderStyle:'dashed',marginBottom:24}}>
      <div style={{fontSize:11,fontWeight:800,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>📊 Coming Soon</div>
      <div style={{fontSize:11,color:'#9E9B96',marginBottom:10}}>These reports activate once production actuals are being logged consistently:</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>{comingSoonReports.map(r=><div key={r.id} style={{border:'1px dashed #D1CEC9',borderRadius:8,padding:10,background:'#FFF',opacity:0.6}}>
        <div style={{fontSize:12,fontWeight:700,color:'#6B6056',marginBottom:2}}>{r.title}</div>
        <div style={{fontSize:10,color:'#9E9B96'}}>{r.desc}</div>
      </div>)}</div>
    </div>
    {/* FINANCIAL + EXISTING REPORTS */}
    <div style={{fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>💰 Sales, Finance & Operations</div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>{reports.map(renderReportCard)}</div>
    {activeRpt&&<div style={card}>{renderReport()}</div>}
  </div>);
}

/* ═══ MATERIAL CALCULATOR PAGE ═══ */
function MaterialCalcPage({jobs,preJob}){
  const[styles,setStyles]=useState([]);
  const[selJob,setSelJob]=useState(preJob||null);
  const[jobSearch,setJobSearch]=useState(preJob?preJob.job_name:'');
  const[selStyle,setSelStyle]=useState('');
  const[color,setColor]=useState('');
  const[height,setHeight]=useState('');
  const[lf,setLf]=useState('');
  const[result,setResult]=useState(null);
  const[overrides,setOverrides]=useState({});
  const[toast,setToast]=useState(null);
  const[showPrint,setShowPrint]=useState(false);
  const[autoFilled,setAutoFilled]=useState({style:false,height:false,lf:false});
  const[autoCalculated,setAutoCalculated]=useState(false);
  const[loadedSaved,setLoadedSaved]=useState(false);

  useEffect(()=>{sbGet('material_calc_styles','is_active=eq.true&order=style_name').then(d=>setStyles(d||[]));},[]);

  const applyJob=useCallback((j)=>{
    setSelJob(j);setJobSearch(j.job_name);
    const hasStyle=!!j.style,hasHeight=n(j.height_precast)>0,hasLf=n(j.lf_precast)>0;
    setSelStyle(j.style||'');
    setColor(j.color||'');
    setHeight(hasHeight?j.height_precast:'');
    setLf(hasLf?j.lf_precast:'');
    setAutoFilled({style:hasStyle,height:hasHeight,lf:hasLf});
    setResult(null);setOverrides({});setAutoCalculated(false);setLoadedSaved(false);
  },[]);

  useEffect(()=>{if(preJob){applyJob(preJob);}else{try{const preId=localStorage.getItem('fc_matcalc_prejob');if(preId){const j=jobs.find(x=>x.id===preId);if(j)applyJob(j);localStorage.removeItem('fc_matcalc_prejob');}}catch(e){}}},[preJob,jobs,applyJob]);

  const[autoCalcPending,setAutoCalcPending]=useState(false);
  const styleInCalc=useMemo(()=>!!styles.find(s=>s.style_name===selStyle),[styles,selStyle]);
  useEffect(()=>{if(selJob&&selStyle&&styleInCalc&&n(height)>0&&n(lf)>0&&!result&&styles.length>0&&!loadedSaved){setAutoCalcPending(true);}},[selJob,selStyle,styleInCalc,height,lf,styles.length,result,loadedSaved]);

  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)).sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||'')),[jobs]);
  const searchResults=jobSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,8):[];

  const pickJob=j=>applyJob(j);

  const loadSavedResult=()=>{
    if(!selJob)return;
    const j=selJob;
    setSelStyle(j.material_calc_style||j.style||'');
    setHeight(j.material_calc_height||j.height_precast||'');
    setLf(j.material_calc_lf||j.lf_precast||'');
    setResult({
      postHeight:n(j.material_post_height),
      sections:0,sectCeil:0,
      totalPosts:n(j.material_posts_line)+n(j.material_posts_corner)+n(j.material_posts_stop),
      linePosts:n(j.material_posts_line),cornerPosts:n(j.material_posts_corner),stopPosts:n(j.material_posts_stop),
      regularPanels:n(j.material_panels_regular),halfPanels:n(j.material_panels_half),
      bottomPanels:n(j.material_panels_bottom),topPanels:n(j.material_panels_top),middlePanels:0,
      totalPanels:n(j.material_panels_regular)+n(j.material_panels_half)+n(j.material_panels_bottom)+n(j.material_panels_top),
      capRails:n(j.material_rails_regular),bottomRails:n(j.material_rails_bottom),
      middleRails:n(j.material_rails_center),topRails:n(j.material_rails_top),
      totalRails:n(j.material_rails_regular)+n(j.material_rails_bottom)+n(j.material_rails_center)+n(j.material_rails_top),
      lineCaps:n(j.material_caps_line),stopCaps:n(j.material_caps_stop),
      totalCaps:n(j.material_caps_line)+n(j.material_caps_stop),
      isCMU:false,isZPanel:false,isRanch:false,hasVertPanels:false,specialLabel:'Saved'
    });
    setOverrides({});setLoadedSaved(true);setAutoCalculated(false);
  };

  const calculate=()=>{
    const cfg=styles.find(s=>s.style_name===selStyle);
    if(!cfg||!n(height)||!n(lf))return;
    const h=n(height);const linearFt=n(lf);
    const postHeight=Math.ceil((h+2)/2)*2;
    const sections=linearFt/cfg.column_spacing;
    const sectCeil=Math.ceil(sections);
    const totalPosts=sectCeil+1;
    const cornerPosts=4;const stopPosts=2;
    const linePosts=Math.max(totalPosts-cornerPosts-stopPosts,0);

    // Panels
    let regularPanels=0,halfPanels=0,bottomPanels=0,topPanels=0,middlePanels=0,specialLabel='';
    const isCMU=selStyle.includes('CMU')||selStyle.includes('Split Faced');
    const isZPanel=selStyle.includes('Z Panel');
    const isRanch=selStyle==='Ranch Rail';

    const hasVertPanels=cfg.panel_multiplier===0&&(n(cfg.bottom_panels)>0||n(cfg.top_panels)>0);
    if(isCMU){
      regularPanels=sectCeil*Math.ceil((h*12)/16)*cfg.panel_multiplier;
      halfPanels=sectCeil;
      specialLabel='CMU';
    }else if(isZPanel){
      topPanels=sectCeil;bottomPanels=sectCeil;
      middlePanels=sectCeil*Math.max(h-2,0);
      regularPanels=middlePanels;specialLabel='Z Panel';
    }else if(hasVertPanels){
      bottomPanels=sectCeil*n(cfg.bottom_panels);
      topPanels=sectCeil*n(cfg.top_panels);
      specialLabel='Vertical';
    }else if(!isRanch){
      regularPanels=sectCeil*h*cfg.panel_multiplier;
    }
    const totalPanels=regularPanels+halfPanels+bottomPanels+topPanels;

    // Rails
    let capRails=sectCeil*(cfg.cap_rails_per_section||0);
    let bottomRails=sectCeil*(cfg.bottom_rails||0);
    let middleRails=sectCeil*(cfg.middle_rails||0);
    let topRails=sectCeil*(cfg.top_rails||0);
    let totalRails=capRails+bottomRails+middleRails+topRails;

    if(isRanch){
      const holes=h<=6?2:h<=8?3:4;
      totalRails=holes*sectCeil;capRails=0;bottomRails=0;middleRails=totalRails;topRails=0;
    }

    // Caps
    const lineCaps=Math.round(totalPosts*(cfg.line_cap_ratio||0));
    const stopCaps=Math.round(totalPosts*(cfg.stop_cap_ratio||0));
    const totalCaps=lineCaps+stopCaps;

    setResult({postHeight,sections:Math.round(sections*10)/10,sectCeil,totalPosts,linePosts,cornerPosts,stopPosts,regularPanels:Math.round(regularPanels),halfPanels,bottomPanels,topPanels,middlePanels,totalPanels:Math.round(totalPanels),capRails,bottomRails,middleRails,topRails,totalRails,lineCaps,stopCaps,totalCaps,isCMU,isZPanel,isRanch,hasVertPanels,specialLabel});
    setOverrides({});
  };
  useEffect(()=>{if(autoCalcPending&&styles.length>0&&selStyle&&n(height)>0&&n(lf)>0){setAutoCalcPending(false);calculate();setAutoCalculated(true);}},[autoCalcPending,styles,selStyle,height,lf]);

  const ov=(key,def)=>overrides[key]!=null?overrides[key]:def;
  const setOv=(key,val)=>setOverrides(p=>({...p,[key]:val===''?undefined:parseInt(val)}));
  const isOv=key=>overrides[key]!=null;
  const ovInput=(key,def)=><input type="number" value={ov(key,def)} onChange={e=>setOv(key,e.target.value)} style={{width:60,padding:'4px 6px',border:'1px solid #D1CEC9',borderRadius:6,fontSize:14,fontWeight:700,textAlign:'center',fontFamily:'Inter',background:isOv(key)?'#FEF3C7':'#FFF'}}/>;

  const secHead=(label,color,bg)=>({background:bg,color,padding:'10px 16px',borderRadius:'10px 10px 0 0',fontFamily:'Inter',fontWeight:800,fontSize:13,textTransform:'uppercase',letterSpacing:0.5});
  const rowS={display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 16px',borderBottom:'1px solid #F4F4F2',fontSize:13};

  return(<div>
    {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Material Calculator</h1>
    {/* Inputs */}
    <div style={{...card,marginBottom:20,padding:20}}>
      <div style={{display:'grid',gridTemplateColumns:'1.3fr 1.1fr 1.2fr 1fr auto',gap:12,alignItems:'start'}}>
        <div style={{position:'relative'}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Job (optional)</label>
          <input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setSelJob(null);setAutoFilled({style:false,height:false,lf:false});}} placeholder="Search by name or number..." style={inputS}/>
          {searchResults.length>0&&!selJob&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:10,maxHeight:240,overflow:'auto'}}>
            {searchResults.map(j=><button key={j.id} onClick={()=>pickJob(j)} style={{display:'block',width:'100%',padding:'8px 12px',border:'none',background:'transparent',textAlign:'left',cursor:'pointer',fontSize:12,borderBottom:'1px solid #F4F4F2'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF4F4'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><span style={{fontWeight:600}}>{j.job_name}</span> <span style={{color:'#9E9B96'}}>#{j.job_number}</span></button>)}
          </div>}
          {selJob&&<div style={{marginTop:6,fontSize:11,color:'#065F46',fontWeight:600}}>Loaded: {selJob.job_name} (#{selJob.job_number})</div>}
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Style {autoFilled.style&&styleInCalc&&<span style={{color:'#1D4ED8',fontWeight:700,textTransform:'none'}}>(from project)</span>}</label>
          <select value={selStyle} onChange={e=>{setSelStyle(e.target.value);setAutoFilled(a=>({...a,style:false}));}} style={{...inputS,background:autoFilled.style&&styleInCalc?'#EFF6FF':'#FFF'}}><option value="">— Select Style —</option>{styles.map(s=><option key={s.id} value={s.style_name}>{s.style_name}</option>)}</select>
          {selJob&&selJob.style&&!styleInCalc&&<div style={{marginTop:4,fontSize:10,color:'#B45309',fontWeight:600}}>⚠ "{selJob.style}" not in calculator — select manually</div>}
          {selJob&&<div style={{marginTop:4,fontSize:11,color:'#6B6056'}}>Color: <span style={{fontWeight:700,color:'#1A1A1A'}}>{color||'—'}</span></div>}
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Height (ft) {autoFilled.height&&<span style={{color:'#1D4ED8',fontWeight:700,textTransform:'none'}}>(from project)</span>}</label>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            {[6,8,10,12].map(h2=><button key={h2} onClick={()=>{setHeight(h2);setAutoFilled(a=>({...a,height:false}));}} style={{padding:'6px 10px',borderRadius:6,border:n(height)===h2?'2px solid #8B2020':'1px solid #D1CEC9',background:n(height)===h2?(autoFilled.height?'#EFF6FF':'#FDF4F4'):'#FFF',color:n(height)===h2?'#8B2020':'#6B6056',fontSize:13,fontWeight:700,cursor:'pointer'}}>{h2}</button>)}
            <input type="number" value={[6,8,10,12].includes(n(height))?'':height} onChange={e=>{setHeight(e.target.value);setAutoFilled(a=>({...a,height:false}));}} placeholder="Custom" style={{...inputS,width:70,padding:'6px 8px',background:autoFilled.height&&![6,8,10,12].includes(n(height))?'#EFF6FF':'#FFF'}}/>
          </div>
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Linear Feet {autoFilled.lf&&<span style={{color:'#1D4ED8',fontWeight:700,textTransform:'none'}}>(from project)</span>}</label>
          <input type="number" value={lf} onChange={e=>{setLf(e.target.value);setAutoFilled(a=>({...a,lf:false}));}} placeholder="0" style={{...inputS,background:autoFilled.lf?'#EFF6FF':'#FFF'}}/>
        </div>
        <div style={{paddingTop:18}}>
          <button onClick={()=>{calculate();setLoadedSaved(false);setAutoCalculated(false);}} disabled={!selStyle||!n(height)||!n(lf)} style={{...btnP,padding:'10px 24px',fontSize:14,opacity:!selStyle||!n(height)||!n(lf)?0.4:1}}>Calculate</button>
        </div>
      </div>
      {selJob&&selJob.material_calc_date&&<div style={{marginTop:12,padding:'10px 14px',background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:8,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div style={{fontSize:12,color:'#78350F'}}>
          <span style={{fontWeight:700}}>📋 Materials previously calculated</span> on {new Date(selJob.material_calc_date).toLocaleDateString()}
          {selJob.material_calc_style&&<span> — {selJob.material_calc_style}</span>}
          {selJob.material_calc_lf&&<span> | {selJob.material_calc_lf} LF</span>}
          {selJob.material_calc_height&&<span> | {selJob.material_calc_height}ft</span>}
        </div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={loadSavedResult} style={{...btnP,padding:'6px 12px',fontSize:11,background:'#B45309'}}>Use saved values →</button>
          <button onClick={()=>{setLoadedSaved(false);calculate();}} style={{...btnS,padding:'6px 12px',fontSize:11}}>Recalculate</button>
        </div>
      </div>}
    </div>

    {/* Results */}
    {result&&<div>
      {(autoCalculated||loadedSaved)&&<div style={{marginBottom:10,padding:'6px 12px',background:loadedSaved?'#FFFBEB':'#EFF6FF',border:`1px solid ${loadedSaved?'#FCD34D':'#BFDBFE'}`,borderRadius:6,fontSize:11,fontWeight:700,color:loadedSaved?'#78350F':'#1D4ED8',display:'inline-block'}}>{loadedSaved?'📋 Showing saved values from project':'⚡ Auto-calculated from project data'}</div>}
      {/* Summary bar */}
      <div style={{...card,padding:'12px 20px',marginBottom:16,display:'flex',gap:20,alignItems:'center',flexWrap:'wrap',background:'#1A1A1A',color:'#FFF',border:'none'}}>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Style</span><div style={{fontWeight:700,fontSize:14}}>{selStyle}</div></div>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Height</span><div style={{fontWeight:700,fontSize:14}}>{height}ft</div></div>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Linear Feet</span><div style={{fontWeight:700,fontSize:14}}>{n(lf).toLocaleString()}</div></div>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Sections</span><div style={{fontWeight:700,fontSize:14}}>{result.sections}</div></div>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          {selJob&&<button onClick={async()=>{try{const shouldAdvance=selJob.status==='contract_review';const matBody={material_posts_line:ov('linePosts',result.linePosts),material_posts_corner:ov('cornerPosts',result.cornerPosts),material_posts_stop:ov('stopPosts',result.stopPosts),material_panels_regular:ov('regularPanels',result.regularPanels),material_panels_half:ov('halfPanels',result.halfPanels)||0,material_rails_regular:ov('capRails',result.capRails),material_rails_top:ov('topRails',result.topRails),material_rails_bottom:ov('bottomRails',result.bottomRails),material_rails_center:ov('middleRails',result.middleRails),material_caps_line:ov('lineCaps',result.lineCaps),material_caps_stop:ov('stopCaps',result.stopCaps),material_post_height:result.postHeight,material_calc_date:new Date().toISOString(),...(shouldAdvance&&{status:'production_queue'})};await sbPatch('jobs',selJob.id,matBody);setToast(shouldAdvance?'Materials saved + job moved to Production Queue':'Materials saved to '+selJob.job_name);fetch(`${SB}/functions/v1/production-order-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{...selJob,...matBody}})}).catch(e=>console.error('Production order notification failed:',e));if(shouldAdvance){fetch(`${SB}/functions/v1/job-stage-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{job_name:selJob.job_name,job_number:selJob.job_number,market:selJob.market,pm:selJob.pm,sales_rep:selJob.sales_rep,style:selJob.style,color:selJob.color,height_precast:selJob.height_precast,total_lf:selJob.total_lf,adj_contract_value:selJob.adj_contract_value},from_status:'contract_review',to_status:'production_queue'})}).catch(e=>console.error('Stage notification failed:',e));}}catch(e){setToast('Save failed');}}} style={{...btnP,background:'#065F46',padding:'6px 16px',fontSize:12}}>Save & Send to Production</button>}
          <button onClick={()=>setShowPrint(true)} style={{...btnP,padding:'6px 16px',fontSize:12}}>Print Production Order</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        {/* POSTS */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={secHead('#FFF','#8B2020')}>Posts</div>
          <div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Post Height</span><span style={{fontFamily:'Inter',fontWeight:800,fontSize:16}}>{result.postHeight}ft</span></div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Line Posts</span>{ovInput('linePosts',result.linePosts)}</div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Corner Posts</span>{ovInput('cornerPosts',result.cornerPosts)}</div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Stop Posts</span>{ovInput('stopPosts',result.stopPosts)}</div>
            <div style={{...rowS,background:'#FDF4F4',fontWeight:700,borderBottom:'none'}}><span>Total Posts</span><span style={{fontFamily:'Inter',fontWeight:900,fontSize:18,color:'#8B2020'}}>{ov('linePosts',result.linePosts)+ov('cornerPosts',result.cornerPosts)+ov('stopPosts',result.stopPosts)}</span></div>
          </div>
        </div>
        {/* PANELS */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={secHead('#FFF','#1D4ED8')}>Panels{result.specialLabel?' ('+result.specialLabel+')':''}</div>
          <div>
            {!result.isRanch&&<>{result.regularPanels>0&&<div style={rowS}><span style={{color:'#6B6056'}}>Regular Panels</span>{ovInput('regularPanels',result.regularPanels)}</div>}
            {result.isCMU&&<div style={rowS}><span style={{color:'#6B6056'}}>Half Panels</span>{ovInput('halfPanels',result.halfPanels)}</div>}
            {(result.isZPanel||result.bottomPanels>0)&&<div style={rowS}><span style={{color:'#6B6056'}}>Bottom Panels</span>{ovInput('bottomPanels',result.bottomPanels)}</div>}
            {(result.isZPanel||result.topPanels>0)&&<div style={rowS}><span style={{color:'#6B6056'}}>Top Panels</span>{ovInput('topPanels',result.topPanels)}</div>}
            <div style={{...rowS,background:'#EFF6FF',fontWeight:700,borderBottom:'none'}}><span>Total Panels</span><span style={{fontFamily:'Inter',fontWeight:900,fontSize:18,color:'#1D4ED8'}}>{(ov('regularPanels',result.regularPanels)||0)+(ov('halfPanels',result.halfPanels)||0)+(ov('topPanels',result.topPanels)||0)+(ov('bottomPanels',result.bottomPanels)||0)}</span></div></>}
            {result.isRanch&&<div style={{padding:16,textAlign:'center',color:'#9E9B96'}}>Ranch Rail — no panels</div>}
          </div>
        </div>
        {/* RAILS */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={secHead('#FFF','#B45309')}>Rails</div>
          <div>
            {!result.isRanch&&<><div style={rowS}><span style={{color:'#6B6056'}}>Cap Rails</span>{ovInput('capRails',result.capRails)}</div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Bottom Rails</span>{ovInput('bottomRails',result.bottomRails)}</div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Middle Rails</span>{ovInput('middleRails',result.middleRails)}</div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Top Rails</span>{ovInput('topRails',result.topRails)}</div></>}
            {result.isRanch&&<div style={rowS}><span style={{color:'#6B6056'}}>Rails ({n(height)<=6?2:n(height)<=8?3:4}-hole)</span>{ovInput('totalRails',result.totalRails)}</div>}
            <div style={{...rowS,background:'#FFFBEB',fontWeight:700,borderBottom:'none'}}><span>Total Rails</span><span style={{fontFamily:'Inter',fontWeight:900,fontSize:18,color:'#B45309'}}>{result.isRanch?ov('totalRails',result.totalRails):(ov('capRails',result.capRails)+ov('bottomRails',result.bottomRails)+ov('middleRails',result.middleRails)+ov('topRails',result.topRails))}</span></div>
          </div>
        </div>
        {/* CAPS */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={secHead('#FFF','#065F46')}>Post Caps</div>
          <div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Line Caps</span>{ovInput('lineCaps',result.lineCaps)}</div>
            <div style={rowS}><span style={{color:'#6B6056'}}>Stop Caps</span>{ovInput('stopCaps',result.stopCaps)}</div>
            <div style={{...rowS,background:'#ECFDF5',fontWeight:700,borderBottom:'none'}}><span>Total Caps</span><span style={{fontFamily:'Inter',fontWeight:900,fontSize:18,color:'#065F46'}}>{ov('lineCaps',result.lineCaps)+ov('stopCaps',result.stopCaps)}</span></div>
            {result.totalCaps===0&&<div style={{padding:8,textAlign:'center',fontSize:11,color:'#9E9B96'}}>No caps for this style</div>}
          </div>
        </div>
      </div>
      {Object.keys(overrides).length>0&&<div style={{marginTop:12,fontSize:11,color:'#B45309',fontWeight:600}}>* Yellow fields have been manually adjusted</div>}
    </div>}
    {!result&&<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}><div style={{fontSize:28,marginBottom:8}}>🧮</div><div style={{fontSize:14}}>Select a style, height, and linear feet to calculate materials</div></div>}
    {/* Print Preview Modal */}
    {showPrint&&result&&(()=>{const ph=result.postHeight;const phCol=ph<=8?'8':ph<=10?'10':'12';const d=(v)=>v>0?v:'—';const lp=ov('linePosts',result.linePosts);const cp=ov('cornerPosts',result.cornerPosts);const sp=ov('stopPosts',result.stopPosts);const rp=ov('regularPanels',result.regularPanels);const hp=ov('halfPanels',result.halfPanels)||0;const cr=ov('capRails',result.capRails);const tr2=ov('topRails',result.topRails);const br=ov('bottomRails',result.bottomRails);const mr=ov('middleRails',result.middleRails);const lc=ov('lineCaps',result.lineCaps);const sc2=ov('stopCaps',result.stopCaps);const jobColor=color||selJob?.color||'';const mktShort=selJob?MS[selJob.market]||selJob.market||'':'';
    return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowPrint(false)}>
      <div style={{background:'#FFF',width:816,maxWidth:'98vw',maxHeight:'96vh',overflow:'auto',boxShadow:'0 12px 40px rgba(0,0,0,0.3)'}} onClick={e=>e.stopPropagation()}>
        {/* Print-only controls */}
        <div className="no-print" style={{display:'flex',gap:8,justifyContent:'flex-end',padding:'12px 20px',borderBottom:'1px solid #E5E3E0'}}>
          <button onClick={()=>window.print()} style={{...btnP,padding:'8px 20px',fontSize:13}}>Print</button>
          <button onClick={()=>setShowPrint(false)} style={{...btnS,padding:'8px 20px',fontSize:13}}>Close</button>
        </div>
        {/* Production Order Form */}
        <div id="production-order" style={{padding:'32px 40px',fontFamily:'Arial,sans-serif',color:'#000'}}>
          {/* Header */}
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:24}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1,color:'#666',textTransform:'uppercase'}}>Material Custom</div>
              <div style={{fontSize:22,fontWeight:900,letterSpacing:1}}>PRODUCTION ORDER</div>
              <div style={{marginTop:12,fontSize:16,fontWeight:700}}>Style: {selStyle}</div>
              <div style={{fontSize:16,fontWeight:700,color:'#333'}}>Color: {jobColor||'—'}</div>
            </div>
            <div style={{border:'2px solid #000',borderRadius:4,padding:'10px 16px',width:180}}>
              <div style={{fontSize:11,fontWeight:700,textAlign:'center',marginBottom:8}}>Batch</div>
              {[1,2,3].map(i=><div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,fontSize:12}}><span style={{width:30}}>___ LB.</span><span style={{borderBottom:'1px solid #ccc',flex:1}}>&nbsp;</span></div>)}
              <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><span style={{width:30}}>___ LB.</span><span style={{fontWeight:700}}>{jobColor||''}</span></div>
            </div>
          </div>
          {/* EST INSTALL START BANNER */}
          {(()=>{const d2=selJob?.est_start_date;const hasDate=!!d2;const label=hasDate?new Date(d2+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'TBD — Contact PM';return<div style={{background:hasDate?'#8B2020':'#B45309',color:'#FFF',padding:'16px 20px',marginBottom:24,borderRadius:4,textAlign:'center',fontSize:24,fontWeight:900,letterSpacing:0.5}}>📅&nbsp;&nbsp;EST. INSTALL START:&nbsp;&nbsp;{label}</div>;})()}
          {/* POSTS */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>POSTS</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
              <thead><tr><td style={{width:30}}></td><td style={{width:140,fontWeight:600}}></td><td style={{width:100,textAlign:'center',fontWeight:700}}>12'</td><td style={{width:100,textAlign:'center',fontWeight:700}}>10'</td><td style={{width:100,textAlign:'center',fontWeight:700}}>8'</td></tr></thead>
              <tbody>{[['Line Post',lp],['Corner Post',cp],['Stop Post',sp]].map(([label,qty])=><tr key={label} style={{borderBottom:'1px solid #eee'}}>
                <td style={{padding:'6px 0',fontSize:16}}>{qty>0?'✓':''}</td>
                <td style={{padding:'6px 0',fontWeight:500}}>{label}</td>
                <td style={{padding:'6px 0',textAlign:'center',fontSize:28,fontWeight:900}}>{phCol==='12'?d(qty):'—'}</td>
                <td style={{padding:'6px 0',textAlign:'center',fontSize:28,fontWeight:900}}>{phCol==='10'?d(qty):'—'}</td>
                <td style={{padding:'6px 0',textAlign:'center',fontSize:28,fontWeight:900}}>{phCol==='8'?d(qty):'—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {/* PANELS */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>PANELS</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
              <tbody>
                <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 0',fontSize:28,fontWeight:900,width:80,textAlign:'center'}}>{d(rp)}</td><td style={{padding:'6px 0'}}>Each / Pallet</td><td style={{padding:'6px 0',fontWeight:600}}>Regular Panels</td><td style={{padding:'6px 0',color:'#666'}}>Short / Long / <b>Reg</b></td></tr>
                <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 0',fontSize:28,fontWeight:900,textAlign:'center'}}>{d(hp)}</td><td style={{padding:'6px 0'}}>Each / Pallet</td><td style={{padding:'6px 0',fontWeight:600}}>Half Panels</td><td style={{padding:'6px 0',color:'#666'}}>Short / Long / Reg</td></tr>
                <tr><td style={{padding:'6px 0',fontSize:28,fontWeight:900,textAlign:'center'}}>—</td><td style={{padding:'6px 0'}}>Each / Pallets</td><td style={{padding:'6px 0',fontWeight:600}}>Diamond/Bottle Panels</td><td></td></tr>
              </tbody>
            </table>
          </div>
          {/* RAILS */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>RAILS</div>
            <div style={{display:'flex',gap:32,fontSize:14}}>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(cr)}</span> <span style={{color:'#666'}}>Regular</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(tr2)}</span> <span style={{color:'#666'}}>Top</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(br)}</span> <span style={{color:'#666'}}>Bottom</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(mr)}</span> <span style={{color:'#666'}}>Center</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>—</span> <span style={{color:'#666'}}>Top Short</span></div>
            </div>
          </div>
          {/* POST CAPS */}
          <div style={{marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>POST CAPS</div>
            <div style={{display:'flex',gap:40,fontSize:14}}>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(lc)}</span> <span style={{color:'#666'}}>Line Caps</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(sc2)}</span> <span style={{color:'#666'}}>Stop Caps</span></div>
            </div>
          </div>
          {/* Footer */}
          <div style={{border:'2px solid #000',borderRadius:4,padding:'12px 16px',position:'relative'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:13}}>
              <div>Jobcode: <b>{selJob?.job_number||'___________'}</b></div>
              <div style={{textAlign:'right',color:'#1D4ED8',fontWeight:700,fontSize:14}}>{n(lf)}x{height}</div>
              <div>City: <b>{mktShort||'___________'}</b></div>
              <div></div>
            </div>
            <div style={{marginTop:8,fontSize:14}}>PROJECT: <b style={{fontSize:16}}>{selJob?.job_name||'______________________________'}</b></div>
          </div>
        </div>
      </div>
    </div>;})()}
    <style>{`@media print{body *{visibility:hidden}#production-order,#production-order *{visibility:visible}#production-order{position:absolute;left:0;top:0;width:100%;padding:24px 32px!important}.no-print{display:none!important}}`}</style>
  </div>);
}

/* ═══ PRODUCTION ORDERS PAGE ═══ */
function ProductionOrdersPage({jobs,setJobs,onNav}){
  const[filterTab,setFilterTab]=useState('all');
  const[expanded,setExpanded]=useState(null);
  const[toast,setToast]=useState(null);
  const[printJob,setPrintJob]=useState(null);
  const[moldInventory,setMoldInventory]=useState([]);
  const[todayPlanLines,setTodayPlanLines]=useState([]);
  const[plantCfg,setPlantCfg]=useState({});
  const[todayActuals,setTodayActuals]=useState([]);
  const[todayHasPlan,setTodayHasPlan]=useState(false);
  const todayStr=new Date().toISOString().split('T')[0];
  useEffect(()=>{
    sbGet('mold_inventory','select=style_name,total_molds&order=style_name').then(d=>setMoldInventory(d||[]));
    sbGet('plant_config','select=key,value').then(d=>{const m={};(d||[]).forEach(r=>{m[r.key]=n(r.value);});setPlantCfg(m);});
    (async()=>{try{const plans=await sbGet('production_plans',`plan_date=eq.${todayStr}&select=id&limit=1`);if(plans&&plans[0]){setTodayHasPlan(true);const lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&order=sort_order.asc`);setTodayPlanLines(lines||[]);const acts=await sbGet('production_actuals',`production_date=eq.${todayStr}&select=*`);setTodayActuals(acts||[]);}else{setTodayHasPlan(false);setTodayPlanLines([]);setTodayActuals([]);}}catch(e){console.error('Today plan load failed',e);}})();
  },[todayStr]);
  const todayByLine=useMemo(()=>{const m={};todayActuals.forEach(a=>{const k=a.plan_line_id;if(!k)return;if(!m[k])m[k]={1:0,2:0};const p=n(a.actual_panels_regular)+n(a.actual_panels_half)+n(a.actual_panels_bottom)+n(a.actual_panels_top);m[k][n(a.shift)||1]=(m[k][n(a.shift)||1]||0)+p;});return m;},[todayActuals]);
  const panelsPerMoldFor=useCallback((style)=>panelsPerMoldLookup(style),[]);
  const MOLD_UTIL_RATE=n(plantCfg.mold_utilization_rate)||0.88;
  const SCRAP_RATE=n(plantCfg.scrap_rate_warm)||0.03;
  // Only rows that represent physical mold sets (not shared child styles)
  const physicalMoldInv=useMemo(()=>moldInventory.filter(r=>n(r.total_molds)>0&&!isChildStyle(r.style_name)),[moldInventory]);
  const moldUtilization=useMemo(()=>{
    // Sum planned panels by canonical (parent) style
    const inUseByParent={};const childStylesByParent={};
    todayPlanLines.forEach(l=>{const s=l.style||'—';const p=canonicalStyle(s);inUseByParent[p]=(inUseByParent[p]||0)+n(l.planned_panels);if(!childStylesByParent[p])childStylesByParent[p]=new Set();childStylesByParent[p].add(s);});
    return physicalMoldInv.map(m=>{
      let used=n(inUseByParent[m.style_name]);
      // Fuzzy fallback for any canonical key that isn't an exact match
      if(!used){Object.keys(inUseByParent).forEach(k=>{if(k&&m.style_name&&k!==m.style_name&&(k.toLowerCase().includes(m.style_name.toLowerCase())||m.style_name.toLowerCase().includes(k.toLowerCase())))used+=inUseByParent[k];});}
      const ppm=panelsPerMoldFor(m.style_name);
      const confirmed=ppm!=null;
      const capacity=confirmed?Math.floor(m.total_molds*ppm*MOLD_UTIL_RATE):0;
      const panelsPerDay=confirmed?Math.floor((m.total_molds*ppm*MOLD_UTIL_RATE)/(1+SCRAP_RATE)):0;
      const avail=confirmed?Math.max(capacity-used,0):0;
      const pct=capacity>0?Math.round(used/capacity*100):0;
      const children=MOLD_CHILDREN[m.style_name]||[];
      const label=children.length>0?`${m.style_name} / ${children.join(' / ')}`:m.style_name;
      return{style:m.style_name,label,molds:m.total_molds,panelsPerMold:ppm,confirmed,capacity,panelsPerDay,inUse:used,available:avail,pct,notPlanned:used===0,children};
    });
  },[physicalMoldInv,todayPlanLines,panelsPerMoldFor,MOLD_UTIL_RATE,SCRAP_RATE]);
  const moldTotals=useMemo(()=>{const molds=moldUtilization.reduce((s,r)=>s+r.molds,0);const capacity=moldUtilization.reduce((s,r)=>s+r.capacity,0);const panelsPerDay=moldUtilization.reduce((s,r)=>s+r.panelsPerDay,0);const inUse=moldUtilization.reduce((s,r)=>s+r.inUse,0);const avail=capacity-inUse;const pct=capacity>0?Math.round(inUse/capacity*100):0;return{molds,capacity,panelsPerDay,inUse,avail,pct};},[moldUtilization]);

  const ordersJobs=useMemo(()=>jobs.filter(j=>j.material_calc_date&&j.status!=='closed').sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999')),[jobs]);

  // Queue only includes jobs in production_queue with a saved material order — auto-clears as status advances
  const needsProd=ordersJobs.filter(j=>j.status==='production_queue'&&j.material_calc_date);
  const inProd=ordersJobs.filter(j=>j.status==='in_production');
  const complete=ordersJobs.filter(j=>['inventory_ready','active_install','fence_complete','fully_complete'].includes(j.status));
  const today=new Date();const weekOut=new Date();weekOut.setDate(weekOut.getDate()+7);
  const thisWeek=ordersJobs.filter(j=>j.est_start_date&&new Date(j.est_start_date+'T12:00:00')<=weekOut&&new Date(j.est_start_date+'T12:00:00')>=today);

  const filtered=useMemo(()=>{
    if(filterTab==='needs')return needsProd;
    if(filterTab==='in_prod')return inProd;
    if(filterTab==='complete')return complete;
    return ordersJobs;
  },[filterTab,ordersJobs]);

  const updateStatus=async(job,newStatus)=>{const u={status:newStatus};const t=new Date().toISOString().split('T')[0];if(newStatus==='inventory_ready')u.inventory_ready_date=t;if(newStatus==='active_install')u.active_install_date=t;if(newStatus==='fence_complete')u.fence_complete_date=t;if(newStatus==='fully_complete')u.fully_complete_date=t;if(newStatus==='closed')u.closed_date=t;try{const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(u)});if(!res.ok)throw new Error(await res.text());setJobs(prev=>prev.map(j=>j.id===job.id?{...j,...u}:j));setToast(`${job.job_name} → ${SL[newStatus]}`);}catch(e){setToast({message:e.message||'Update failed',isError:true});}};

  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{marginBottom:8}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:2}}>Production Orders</h1>
      <div style={{fontSize:12,color:'#9E9B96'}}>Jobs with saved material calculations</div>
    </div>
    {/* Summary cards */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16,marginTop:12}}>
      <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #8B2020'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22}}>{ordersJobs.length}</div><div style={{fontSize:11,color:'#6B6056'}}>Total Orders</div></div>
      <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #7C3AED'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#7C3AED'}}>{needsProd.length}</div><div style={{fontSize:11,color:'#6B6056'}}>Needs Production</div></div>
      <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #1D4ED8'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#1D4ED8'}}>{inProd.length}</div><div style={{fontSize:11,color:'#6B6056'}}>In Production</div></div>
      <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #B45309'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#B45309'}}>{thisWeek.length}</div><div style={{fontSize:11,color:'#6B6056'}}>Starting This Week</div></div>
    </div>
    {/* Plant Summary Stats */}
    {moldUtilization.length>0&&<div style={{...card,marginBottom:12,padding:14,borderLeft:'4px solid #1A1A1A'}}>
      <div style={{fontSize:12,fontWeight:800,color:'#1A1A1A',textTransform:'uppercase',marginBottom:8}}>🏭 Plant Summary</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        <div><div style={{fontFamily:'Inter',fontWeight:900,fontSize:22}}>{moldTotals.molds}</div><div style={{fontSize:10,color:'#6B6056'}}>Total Molds</div></div>
        <div><div style={{fontFamily:'Inter',fontWeight:900,fontSize:22,color:'#7C3AED'}}>~{moldTotals.panelsPerDay.toLocaleString()}</div><div style={{fontSize:10,color:'#6B6056'}}>Max Panels/Day</div></div>
        <div><div style={{fontFamily:'Inter',fontWeight:900,fontSize:22,color:'#B45309'}}>{n(plantCfg.max_lf_per_day)||2640} LF</div><div style={{fontSize:10,color:'#6B6056'}}>Max LF/Day</div></div>
        <div><div style={{fontFamily:'Inter',fontWeight:900,fontSize:22,color:'#1D4ED8'}}>{(n(plantCfg.daily_cy_capacity)||52.8).toFixed(1)} CYD</div><div style={{fontSize:10,color:'#6B6056'}}>Batch Plant/Day</div></div>
      </div>
      <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #E5E3E0',fontSize:10,color:'#9E9B96'}}>2× WIGGERT HPGM 500 mixers · 60 batches/shift × 0.44 CYD · 24hr cure · {Math.round(MOLD_UTIL_RATE*100)}% mold util · {Math.round(SCRAP_RATE*100)}% scrap rate</div>
    </div>}
    {/* Mold Utilization Table */}
    {moldUtilization.length>0&&<div style={{...card,marginBottom:16,padding:14,borderLeft:'4px solid #7C3AED'}}>
      <div style={{fontSize:12,fontWeight:800,color:'#7C3AED',textTransform:'uppercase',marginBottom:10}}>🔧 Mold Utilization — Today</div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr style={{borderBottom:'1px solid #E5E3E0'}}>{['Style','Molds','Panels/Mold','Capacity','In Use','Available','Utilization'].map((h,i)=><th key={h} style={{textAlign:i===0?'left':i===6?'left':'right',padding:'6px 8px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
        <tbody>
          {moldUtilization.map(r=>{
            if(!r.confirmed)return<tr key={r.style} style={{borderBottom:'1px solid #F4F4F2',background:'#FAFAF8'}}>
              <td style={{padding:'6px 8px',fontWeight:600}}>{r.label}</td>
              <td style={{padding:'6px 8px',textAlign:'right'}}>{r.molds}</td>
              <td style={{padding:'6px 8px',textAlign:'right',color:'#6B7280',fontWeight:700}}>[?]</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#6B7280'}}>TBD</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:r.inUse>0?'#1A1A1A':'#9E9B96'}}>{r.inUse.toLocaleString()}</td>
              <td style={{padding:'6px 8px',textAlign:'right',color:'#6B7280'}}>—</td>
              <td style={{padding:'6px 8px'}}><span style={{fontSize:10,color:'#6B7280',fontWeight:700,background:'#F4F4F2',padding:'2px 6px',borderRadius:4}}>⚙️ Verify with Max</span></td>
            </tr>;
            const col=r.pct>=70?'#B45309':'#15803D';const emoji=r.notPlanned?'':r.pct>=70?'🟡':'🟢';
            return<tr key={r.style} style={{borderBottom:'1px solid #F4F4F2'}}>
              <td style={{padding:'6px 8px',fontWeight:600}}>{r.label}</td>
              <td style={{padding:'6px 8px',textAlign:'right'}}>{r.molds}</td>
              <td style={{padding:'6px 8px',textAlign:'right',color:'#9E9B96'}}>{r.panelsPerMold}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#7C3AED'}}>{r.capacity.toLocaleString()}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:r.inUse>0?'#1A1A1A':'#9E9B96'}}>{r.inUse.toLocaleString()}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:r.available===0?'#B45309':'#1A1A1A'}}>{r.available.toLocaleString()}</td>
              <td style={{padding:'6px 8px'}}>{r.notPlanned?<span style={{fontSize:10,color:'#9E9B96',fontStyle:'italic'}}>Not planned</span>:<div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{flex:1,height:8,background:'#E5E3E0',borderRadius:4,overflow:'hidden',maxWidth:140}}>
                  <div style={{width:`${Math.min(r.pct,100)}%`,height:'100%',background:col}}/>
                </div>
                <span style={{fontSize:11,fontWeight:700,color:col,minWidth:42}}>{r.pct}% {emoji}</span>
              </div>}</td>
            </tr>;
          })}
          <tr style={{borderTop:'2px solid #1A1A1A',background:'#F9F8F6'}}>
            <td style={{padding:'8px',fontWeight:800}}>TOTAL</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800}}>{moldTotals.molds}</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800,color:'#9E9B96'}}>—</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800,color:'#7C3AED'}}>{moldTotals.capacity.toLocaleString()}*</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800}}>{moldTotals.inUse.toLocaleString()}</td>
            <td style={{padding:'8px',textAlign:'right',fontWeight:800}}>{moldTotals.avail.toLocaleString()}</td>
            <td style={{padding:'8px'}}><div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{flex:1,height:8,background:'#E5E3E0',borderRadius:4,overflow:'hidden',maxWidth:140}}>
                <div style={{width:`${Math.min(moldTotals.pct,100)}%`,height:'100%',background:moldTotals.pct>=70?'#B45309':'#15803D'}}/>
              </div>
              <span style={{fontSize:11,fontWeight:800,minWidth:42}}>{moldTotals.pct}% {moldTotals.pct>=70?'🟡':'🟢'}</span>
            </div></td>
          </tr>
        </tbody>
      </table>
      {moldUtilization.some(r=>!r.confirmed)&&<div style={{marginTop:10,padding:'8px 12px',background:'#F4F4F2',border:'1px solid #D1CEC9',borderRadius:6,fontSize:11,color:'#6B6056'}}>
        <b>*</b> Excludes Vertical Wood — panels/mold unconfirmed. <b>⚙️ Vertical Wood panels/mold needs confirmation from Max.</b> Contact Max to verify how many panels each gang mold produces per pour for Vertical Wood styles.
      </div>}
    </div>}
    {/* Today's Plan section */}
    <div style={{...card,marginBottom:16,padding:14,borderLeft:'4px solid #8B2020'}}>
      <div style={{fontSize:12,fontWeight:800,color:'#8B2020',textTransform:'uppercase',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
        <span>📅 Today's Plan — {new Date(todayStr+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</span>
        {!todayHasPlan&&<button onClick={()=>{const t=new Date();t.setDate(t.getDate()+1);const tISO=t.toISOString().split('T')[0];try{localStorage.setItem('fc_daily_goto',JSON.stringify({tab:'plan',date:tISO}));}catch(e){}if(onNav)onNav('daily_report');window.scrollTo({top:0,behavior:'smooth'});}} style={{...btnS,padding:'4px 10px',fontSize:11}}>View Tomorrow's Plan →</button>}
      </div>
      {!todayHasPlan?<div style={{fontSize:12,color:'#9E9B96',padding:'8px 0'}}>No plan for today. Plans are created by Max for the next day (default).</div>:
      todayPlanLines.length===0?<div style={{fontSize:12,color:'#9E9B96',padding:'8px 0'}}>Plan exists but has no lines.</div>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {todayPlanLines.map(l=>{const planned=n(l.planned_panels);const s1=n(todayByLine[l.id]?.[1]);const s2=n(todayByLine[l.id]?.[2]);const total=s1+s2;const pct=planned>0?Math.round(total/planned*100):0;const col=pct>=100?'#065F46':pct>=70?'#B45309':'#1D4ED8';return<div key={l.id} style={{padding:10,background:'#F9F8F6',borderRadius:8,border:'1px solid #E5E3E0'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4,flexWrap:'wrap',gap:6}}>
            <div style={{fontWeight:700,fontSize:13}}>{l.job_name} <span style={{color:'#9E9B96',fontWeight:500,fontSize:11}}>#{l.job_number}</span></div>
            <div style={{fontSize:11,color:col,fontWeight:700}}>{total.toLocaleString()} / {planned.toLocaleString()} panels ({pct}%)</div>
          </div>
          <div style={{fontSize:10,color:'#6B6056',marginBottom:6}}>{[l.style,l.color,l.height?l.height+'ft':null].filter(Boolean).join(' | ')}</div>
          {/* Shift bars */}
          <div style={{display:'flex',gap:12,marginBottom:4}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10,color:'#6B6056',marginBottom:2}}>Shift 1: <b>{s1.toLocaleString()}</b></div>
              <div style={{height:6,background:'#E5E3E0',borderRadius:3,overflow:'hidden'}}><div style={{width:`${Math.min(planned>0?s1/planned*100:0,100)}%`,height:'100%',background:'#1D4ED8'}}/></div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:10,color:'#6B6056',marginBottom:2}}>Shift 2: <b>{s2.toLocaleString()}</b></div>
              <div style={{height:6,background:'#E5E3E0',borderRadius:3,overflow:'hidden'}}><div style={{width:`${Math.min(planned>0?s2/planned*100:0,100)}%`,height:'100%',background:'#7C3AED'}}/></div>
            </div>
          </div>
          <div style={{height:8,background:'#E5E3E0',borderRadius:4,overflow:'hidden',marginTop:4}}><div style={{width:`${Math.min(pct,100)}%`,height:'100%',background:col,transition:'width 0.3s'}}/></div>
        </div>;})}
      </div>}
    </div>
    {/* Filter tabs */}
    <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
      {[['all','All',ordersJobs.length],['needs','Needs Production',needsProd.length],['in_prod','In Production',inProd.length],['complete','Complete',complete.length]].map(([k,l,c])=><button key={k} onClick={()=>setFilterTab(k)} style={{padding:'7px 14px',borderRadius:8,border:filterTab===k?'2px solid #8B2020':'1px solid #E5E3E0',background:filterTab===k?'#FDF4F4':'#FFF',color:filterTab===k?'#8B2020':'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>{l} ({c})</button>)}
    </div>
    {/* Job list */}
    {filtered.length===0?<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No production orders in this filter</div>:<div style={{display:'flex',flexDirection:'column',gap:10}}>
      {filtered.map(j=>{const isExp=expanded===j.id;const lp=n(j.material_posts_line),cp=n(j.material_posts_corner),sp=n(j.material_posts_stop);const totalPosts=lp+cp+sp;const rp=n(j.material_panels_regular),hp=n(j.material_panels_half);const totalPanels=rp+hp;const cr=n(j.material_rails_regular),tr2=n(j.material_rails_top),br=n(j.material_rails_bottom),mr=n(j.material_rails_center);const totalRails=cr+tr2+br+mr;const lc=n(j.material_caps_line),sc=n(j.material_caps_stop);const totalCaps=lc+sc;const calcDate=j.material_calc_date?new Date(j.material_calc_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
        return<div key={j.id} style={{...card,padding:0,overflow:'hidden'}}>
          <div onClick={()=>setExpanded(isExp?null:j.id)} style={{padding:'12px 16px',cursor:'pointer'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,flexWrap:'wrap'}}>
              <span style={{fontSize:16}}>📋</span>
              <span style={{fontFamily:'Inter',fontSize:11,color:'#9E9B96',fontWeight:600}}>{j.job_number||'—'}</span>
              <span style={{fontWeight:700,fontSize:14,flex:'1 1 200px',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</span>
              <span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span>
              <select value={j.status} onClick={e=>e.stopPropagation()} onChange={e=>updateStatus(j,e.target.value)} style={{padding:'4px 8px',borderRadius:6,fontSize:11,fontWeight:700,border:`1px solid ${SC[j.status]}40`,background:SB_[j.status],color:SC[j.status],cursor:'pointer'}}>{STS.filter(s=>s!=='closed').map(s=><option key={s} value={s}>{SL[s]}</option>)}</select>
              <span style={{fontSize:12,color:'#9E9B96'}}>{isExp?'▲':'▼'}</span>
            </div>
            <div style={{display:'flex',gap:14,fontSize:11,color:'#6B6056',marginLeft:26,flexWrap:'wrap'}}>
              {j.est_start_date&&<span>Est Start: <b style={{color:'#1A1A1A'}}>{fD(j.est_start_date)}</b></span>}
              {(lfPC(j)>0||lfSW(j)>0||lfWI(j)>0||lfGates(j)>0)&&<span><LfBadges job={j}/></span>}
              {j.style&&<span>{j.style}</span>}
              {j.color&&<span>{j.color}</span>}
              {j.height_precast&&<span>{j.height_precast}ft</span>}
              <span>Calculated: <b style={{color:'#1A1A1A'}}>{calcDate}</b></span>
            </div>
            {!isExp&&<div style={{marginLeft:26,marginTop:8,fontSize:12,color:'#6B6056',display:'flex',gap:16,flexWrap:'wrap'}}>
              <span><b style={{color:'#8B2020'}}>POSTS:</b> {lp}/{cp}/{sp}{j.material_post_height?` — ${j.material_post_height}ft`:''}</span>
              <span><b style={{color:'#1D4ED8'}}>PANELS:</b> {totalPanels}</span>
              <span><b style={{color:'#B45309'}}>RAILS:</b> {totalRails}</span>
              <span><b style={{color:'#065F46'}}>CAPS:</b> {lc}/{sc}</span>
            </div>}
          </div>
          {isExp&&<div style={{padding:'14px 16px',borderTop:'1px solid #E5E3E0',background:'#F9F8F6'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,marginBottom:12}}>
              <div style={{background:'#FFF',borderRadius:8,padding:12,border:'1px solid #8B202020'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#8B2020',textTransform:'uppercase',marginBottom:6}}>Posts{j.material_post_height?` (${j.material_post_height}ft)`:''}</div>
                <div style={{fontSize:12,color:'#6B6056'}}>Line: <b style={{color:'#1A1A1A',fontSize:16}}>{lp||'—'}</b></div>
                <div style={{fontSize:12,color:'#6B6056'}}>Corner: <b style={{color:'#1A1A1A',fontSize:16}}>{cp||'—'}</b></div>
                <div style={{fontSize:12,color:'#6B6056'}}>Stop: <b style={{color:'#1A1A1A',fontSize:16}}>{sp||'—'}</b></div>
                <div style={{marginTop:6,paddingTop:6,borderTop:'1px solid #E5E3E0',fontSize:11,fontWeight:700}}>Total: {totalPosts}</div>
              </div>
              <div style={{background:'#FFF',borderRadius:8,padding:12,border:'1px solid #1D4ED820'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#1D4ED8',textTransform:'uppercase',marginBottom:6}}>Panels</div>
                <div style={{fontSize:12,color:'#6B6056'}}>Regular: <b style={{color:'#1A1A1A',fontSize:16}}>{rp||'—'}</b></div>
                {hp>0&&<div style={{fontSize:12,color:'#6B6056'}}>Half: <b style={{color:'#1A1A1A',fontSize:16}}>{hp}</b></div>}
                <div style={{marginTop:6,paddingTop:6,borderTop:'1px solid #E5E3E0',fontSize:11,fontWeight:700}}>Total: {totalPanels}</div>
              </div>
              <div style={{background:'#FFF',borderRadius:8,padding:12,border:'1px solid #B4530920'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#B45309',textTransform:'uppercase',marginBottom:6}}>Rails</div>
                <div style={{fontSize:12,color:'#6B6056'}}>Regular: <b style={{color:'#1A1A1A',fontSize:16}}>{cr||'—'}</b></div>
                {tr2>0&&<div style={{fontSize:12,color:'#6B6056'}}>Top: <b style={{color:'#1A1A1A',fontSize:16}}>{tr2}</b></div>}
                {br>0&&<div style={{fontSize:12,color:'#6B6056'}}>Bottom: <b style={{color:'#1A1A1A',fontSize:16}}>{br}</b></div>}
                {mr>0&&<div style={{fontSize:12,color:'#6B6056'}}>Center: <b style={{color:'#1A1A1A',fontSize:16}}>{mr}</b></div>}
                <div style={{marginTop:6,paddingTop:6,borderTop:'1px solid #E5E3E0',fontSize:11,fontWeight:700}}>Total: {totalRails}</div>
              </div>
              <div style={{background:'#FFF',borderRadius:8,padding:12,border:'1px solid #065F4620'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#065F46',textTransform:'uppercase',marginBottom:6}}>Post Caps</div>
                <div style={{fontSize:12,color:'#6B6056'}}>Line: <b style={{color:'#1A1A1A',fontSize:16}}>{lc||'—'}</b></div>
                <div style={{fontSize:12,color:'#6B6056'}}>Stop: <b style={{color:'#1A1A1A',fontSize:16}}>{sc||'—'}</b></div>
                <div style={{marginTop:6,paddingTop:6,borderTop:'1px solid #E5E3E0',fontSize:11,fontWeight:700}}>Total: {totalCaps}</div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setPrintJob(j)} style={{...btnP,padding:'7px 16px',fontSize:12}}>🖨 Print Production Order</button>
              {onNav&&<button onClick={()=>onNav('material_calc')} style={{...btnS,padding:'7px 16px',fontSize:12}}>Recalculate</button>}
            </div>
          </div>}
        </div>;
      })}
    </div>}
    {/* Print Preview Modal */}
    {printJob&&(()=>{const j=printJob;const ph=n(j.material_post_height)||8;const phCol=ph<=8?'8':ph<=10?'10':'12';const d=(v)=>v>0?v:'—';const lp=n(j.material_posts_line),cp=n(j.material_posts_corner),sp=n(j.material_posts_stop);const rp=n(j.material_panels_regular),hp=n(j.material_panels_half);const cr=n(j.material_rails_regular),tr2=n(j.material_rails_top),br=n(j.material_rails_bottom),mr=n(j.material_rails_center);const lc=n(j.material_caps_line),sc=n(j.material_caps_stop);const mktShort=MS[j.market]||j.market||'';
    return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setPrintJob(null)}>
      <div style={{background:'#FFF',width:816,maxWidth:'98vw',maxHeight:'96vh',overflow:'auto',boxShadow:'0 12px 40px rgba(0,0,0,0.3)'}} onClick={e=>e.stopPropagation()}>
        <div className="no-print" style={{display:'flex',gap:8,justifyContent:'flex-end',padding:'12px 20px',borderBottom:'1px solid #E5E3E0'}}>
          <button onClick={()=>window.print()} style={{...btnP,padding:'8px 20px',fontSize:13}}>Print</button>
          <button onClick={()=>setPrintJob(null)} style={{...btnS,padding:'8px 20px',fontSize:13}}>Close</button>
        </div>
        <div id="production-order" style={{padding:'32px 40px',fontFamily:'Arial,sans-serif',color:'#000'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:24}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1,color:'#666',textTransform:'uppercase'}}>Material Custom</div>
              <div style={{fontSize:22,fontWeight:900,letterSpacing:1}}>PRODUCTION ORDER</div>
              <div style={{marginTop:12,fontSize:16,fontWeight:700}}>Style: {j.style||'—'}</div>
              <div style={{fontSize:16,fontWeight:700,color:'#333'}}>Color: {j.color||'—'}</div>
            </div>
            <div style={{border:'2px solid #000',borderRadius:4,padding:'10px 16px',width:180}}>
              <div style={{fontSize:11,fontWeight:700,textAlign:'center',marginBottom:8}}>Batch</div>
              {[1,2,3].map(i=><div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,fontSize:12}}><span style={{width:30}}>___ LB.</span><span style={{borderBottom:'1px solid #ccc',flex:1}}>&nbsp;</span></div>)}
              <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><span style={{width:30}}>___ LB.</span><span style={{fontWeight:700}}>{j.color||''}</span></div>
            </div>
          </div>
          {/* EST INSTALL START BANNER */}
          {(()=>{const d2=j.est_start_date;const hasDate=!!d2;const label=hasDate?new Date(d2+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'TBD — Contact PM';return<div style={{background:hasDate?'#8B2020':'#B45309',color:'#FFF',padding:'16px 20px',marginBottom:24,borderRadius:4,textAlign:'center',fontSize:24,fontWeight:900,letterSpacing:0.5}}>📅&nbsp;&nbsp;EST. INSTALL START:&nbsp;&nbsp;{label}</div>;})()}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>POSTS</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
              <thead><tr><td style={{width:30}}></td><td style={{width:140,fontWeight:600}}></td><td style={{width:100,textAlign:'center',fontWeight:700}}>12'</td><td style={{width:100,textAlign:'center',fontWeight:700}}>10'</td><td style={{width:100,textAlign:'center',fontWeight:700}}>8'</td></tr></thead>
              <tbody>{[['Line Post',lp],['Corner Post',cp],['Stop Post',sp]].map(([label,qty])=><tr key={label} style={{borderBottom:'1px solid #eee'}}>
                <td style={{padding:'6px 0',fontSize:16}}>{qty>0?'✓':''}</td>
                <td style={{padding:'6px 0',fontWeight:500}}>{label}</td>
                <td style={{padding:'6px 0',textAlign:'center',fontSize:28,fontWeight:900}}>{phCol==='12'?d(qty):'—'}</td>
                <td style={{padding:'6px 0',textAlign:'center',fontSize:28,fontWeight:900}}>{phCol==='10'?d(qty):'—'}</td>
                <td style={{padding:'6px 0',textAlign:'center',fontSize:28,fontWeight:900}}>{phCol==='8'?d(qty):'—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>PANELS</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
              <tbody>
                <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 0',fontSize:28,fontWeight:900,width:80,textAlign:'center'}}>{d(rp)}</td><td style={{padding:'6px 0'}}>Each / Pallet</td><td style={{padding:'6px 0',fontWeight:600}}>Regular Panels</td><td style={{padding:'6px 0',color:'#666'}}>Short / Long / <b>Reg</b></td></tr>
                <tr style={{borderBottom:'1px solid #eee'}}><td style={{padding:'6px 0',fontSize:28,fontWeight:900,textAlign:'center'}}>{d(hp)}</td><td style={{padding:'6px 0'}}>Each / Pallet</td><td style={{padding:'6px 0',fontWeight:600}}>Half Panels</td><td style={{padding:'6px 0',color:'#666'}}>Short / Long / Reg</td></tr>
                <tr><td style={{padding:'6px 0',fontSize:28,fontWeight:900,textAlign:'center'}}>—</td><td style={{padding:'6px 0'}}>Each / Pallets</td><td style={{padding:'6px 0',fontWeight:600}}>Diamond/Bottle Panels</td><td></td></tr>
              </tbody>
            </table>
          </div>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>RAILS</div>
            <div style={{display:'flex',gap:32,fontSize:14}}>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(cr)}</span> <span style={{color:'#666'}}>Regular</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(tr2)}</span> <span style={{color:'#666'}}>Top</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(br)}</span> <span style={{color:'#666'}}>Bottom</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(mr)}</span> <span style={{color:'#666'}}>Center</span></div>
            </div>
          </div>
          <div style={{marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:900,borderBottom:'2px solid #000',paddingBottom:4,marginBottom:10}}>POST CAPS</div>
            <div style={{display:'flex',gap:40,fontSize:14}}>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(lc)}</span> <span style={{color:'#666'}}>Line Caps</span></div>
              <div><span style={{fontSize:28,fontWeight:900}}>{d(sc)}</span> <span style={{color:'#666'}}>Stop Caps</span></div>
            </div>
          </div>
          <div style={{border:'2px solid #000',borderRadius:4,padding:'12px 16px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:13}}>
              <div>Jobcode: <b>{j.job_number||'___________'}</b></div>
              <div style={{textAlign:'right',color:'#1D4ED8',fontWeight:700,fontSize:14}}>{n(j.total_lf)}x{j.height_precast||'—'}</div>
              <div>City: <b>{mktShort||'___________'}</b></div>
              <div></div>
            </div>
            <div style={{marginTop:8,fontSize:14}}>PROJECT: <b style={{fontSize:16}}>{j.job_name||'______________________________'}</b></div>
          </div>
        </div>
      </div>
    </div>;})()}
  </div>);
}

/* ═══ SCHEDULE PAGE ═══ */
function SchedulePage({jobs}){
  const[events,setEvents]=useState([]);const[view,setView]=useState('calendar');const[month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));const[showAdd,setShowAdd]=useState(false);const[mktF,setMktF]=useState(null);const[pmF,setPmF]=useState('');const[editEvt,setEditEvt]=useState(null);
  const jobsById=useMemo(()=>{const m={};jobs.forEach(j=>{m[j.id]=j;});return m;},[jobs]);
  const pmJobCounts=useMemo(()=>{const c={};jobs.forEach(j=>{if(!CLOSED_SET.has(j.status)&&j.pm)c[j.pm]=(c[j.pm]||0)+1;});return c;},[jobs]);
  const[form,setForm]=useState({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});const[jobSearch,setJobSearch]=useState('');
  const fetchEvents=useCallback(async()=>{const d=await sbGet('schedule_events','order=scheduled_date.asc');setEvents(d||[]);},[]);
  useEffect(()=>{fetchEvents();},[fetchEvents]);
  const filteredEvents=useMemo(()=>events.filter(e=>(!mktF||e.market===mktF)&&(!pmF||jobsById[e.job_id]?.pm===pmF)),[events,mktF,pmF,jobsById]);
  const saveEvent=async e=>{e.preventDefault();const job=jobs.find(j=>j.id===form.job_id);if(!job&&!editEvt)return;const body={...form,job_number:job?.job_number||editEvt?.job_number,job_name:job?.job_name||editEvt?.job_name,market:job?.market||editEvt?.market,color:MC[job?.market||editEvt?.market]||'#8B2020',lf_scheduled:n(form.lf_scheduled)};if(editEvt){await sbPatch('schedule_events',editEvt.id,body);}else{await sbPost('schedule_events',body);}setShowAdd(false);setEditEvt(null);setForm({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});setJobSearch('');fetchEvents();};
  const deleteEvent=async id=>{if(!window.confirm('Delete this event?'))return;await sbDel('schedule_events',id);setEditEvt(null);setShowAdd(false);fetchEvents();};
  const openEdit=ev=>{setForm({job_id:ev.job_id||'',event_type:ev.event_type||'production_start',scheduled_date:ev.scheduled_date||'',end_date:ev.end_date||'',assigned_to:ev.assigned_to||'',crew:ev.crew||'',lf_scheduled:ev.lf_scheduled||'',notes:ev.notes||''});setJobSearch(ev.job_name||'');setEditEvt(ev);setShowAdd(true);};
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();const firstDay=new Date(month.getFullYear(),month.getMonth(),1).getDay();const today=new Date().toISOString().split('T')[0];
  const searchedJobs=jobSearch?jobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,10):[];
  const getMonday=d=>{const dt=new Date(d);dt.setDate(dt.getDate()-dt.getDay()+1);return dt;};
  const weeks8=useMemo(()=>{const w=[];const s=getMonday(new Date());for(let i=0;i<8;i++){const d=new Date(s);d.setDate(d.getDate()+i*7);w.push(d);}return w;},[]);
  return(<div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Schedule</h1><div style={{display:'flex',gap:8}}><button onClick={()=>setView('calendar')} style={gpill(view==='calendar')}>Calendar</button><button onClick={()=>setView('list')} style={gpill(view==='list')}>List</button><button onClick={()=>setView('gantt')} style={gpill(view==='gantt')}>Gantt</button><button onClick={()=>setView('weather')} style={gpill(view==='weather')}>Weather Days</button><button onClick={()=>setView('changeorders')} style={gpill(view==='changeorders')}>Change Orders</button>{view!=='weather'&&view!=='changeorders'&&<button onClick={()=>{setEditEvt(null);setForm({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});setJobSearch('');setShowAdd(true);}} style={btnP}>+ Add Event</button>}</div></div>
    {view==='weather'&&<WeatherDaysPage jobs={jobs}/>}
    {view==='changeorders'&&<ChangeOrdersPage jobs={jobs}/>}
    {view!=='weather'&&view!=='changeorders'&&<><div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
      <div style={{display:'flex',gap:6}}><button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}</div>
      <div style={{display:'flex',gap:6,alignItems:'center'}}><label style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>PM</label><select value={pmF} onChange={e=>setPmF(e.target.value)} style={{...inputS,width:180}}><option value="">All PMs</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}{pmJobCounts[p.id]?` (${pmJobCounts[p.id]})`:''}</option>)}</select></div>
    </div>
    <div style={{display:'flex',gap:20}}>
      <div style={{flex:1,minWidth:0}}>
        {view==='calendar'&&<><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} style={btnS}>← Prev</button><span style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span><div style={{display:'flex',gap:8}}><button onClick={()=>setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1))} style={btnS}>Today</button><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} style={btnS}>Next →</button></div></div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,background:'#E5E3E0',borderRadius:12,overflow:'hidden'}}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} style={{background:'#F9F8F6',padding:'6px 8px',fontSize:11,fontWeight:600,color:'#6B6056',textAlign:'center'}}>{d}</div>)}{Array.from({length:firstDay},(_,i)=><div key={`e${i}`} style={{background:'#FAFAF8',minHeight:80}}/>)}{Array.from({length:daysInMonth},(_,i)=>{const day=i+1;const ds=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const dayEv=filteredEvents.filter(e=>e.scheduled_date&&e.scheduled_date.startsWith(ds));const isToday=ds===today;const dayLF=dayEv.reduce((s,e)=>s+n(e.lf_scheduled),0);return<div key={day} style={{background:'#FFF',minHeight:80,padding:4,borderTop:isToday?'2px solid #8B2020':'none',position:'relative'}}><div style={{fontSize:11,fontWeight:isToday?800:400,color:isToday?'#8B2020':'#6B6056',marginBottom:2}}>{day}</div>{dayEv.slice(0,3).map(e=><div key={e.id} onClick={()=>openEdit(e)} style={{fontSize:9,padding:'1px 4px',borderRadius:3,marginBottom:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',background:(e.color||'#8B2020')+'20',color:e.color||'#8B2020',fontWeight:600,cursor:'pointer'}}>{e.job_name}</div>)}{dayEv.length>3&&<div style={{fontSize:9,color:'#9E9B96'}}>+{dayEv.length-3}</div>}{dayLF>0&&<div style={{position:'absolute',bottom:2,right:4,fontSize:9,color:'#9E9B96'}}>{dayLF.toLocaleString()} LF</div>}</div>;})}</div>
          <div style={{fontSize:11,color:'#9E9B96',marginTop:8,textAlign:'center'}}>Click any event to edit or reschedule</div>
        </>}
        {view==='list'&&<div style={card}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Date','Project','Market','Type','LF','Assigned','Notes'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{filteredEvents.map(e=><tr key={e.id} onClick={()=>openEdit(e)} style={{borderBottom:'1px solid #F4F4F2',cursor:'pointer'}} onMouseEnter={ev=>ev.currentTarget.style.background='#FDF9F6'} onMouseLeave={ev=>ev.currentTarget.style.background='transparent'}><td style={{padding:'6px 8px'}}>{fD(e.scheduled_date)}</td><td style={{padding:'6px 8px',fontWeight:500}}>{e.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[e.market]||'#6B6056',MB[e.market]||'#F4F4F2')}>{MS[e.market]||'—'}</span></td><td style={{padding:'6px 8px'}}>{(e.event_type||'').replace(/_/g,' ')}</td><td style={{padding:'6px 8px'}}>{n(e.lf_scheduled).toLocaleString()}</td><td style={{padding:'6px 8px'}}>{e.assigned_to||'—'}</td><td style={{padding:'6px 8px',color:'#9E9B96',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.notes||'—'}</td></tr>)}</tbody></table></div>}
        {view==='gantt'&&(()=>{
          const GANTT_MKT_C={Austin:'#FB923C','Dallas-Fort Worth':'#60A5FA',Houston:'#34D399','San Antonio':'#F472B6'};
          let ganttJobs=jobs.filter(j=>!CLOSED_SET.has(j.status)&&j.est_start_date).sort((a,b)=>a.est_start_date.localeCompare(b.est_start_date));
          if(mktF)ganttJobs=ganttJobs.filter(j=>j.market===mktF);
          if(pmF)ganttJobs=ganttJobs.filter(j=>j.pm===pmF);
          ganttJobs=ganttJobs.slice(0,40);
          if(ganttJobs.length===0)return<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No active projects with start dates</div>;
          const parseD=d=>new Date(d+'T12:00:00').getTime();
          const allStarts=ganttJobs.map(j=>parseD(j.est_start_date));
          const allEnds=ganttJobs.map(j=>j.install_complete_date?parseD(j.install_complete_date):parseD(j.est_start_date)+60*86400000);
          const minDate=Math.min(...allStarts);
          const threeMonths=90*86400000;
          const maxDate=Math.max(Math.max(...allEnds),minDate+threeMonths);
          const totalDays=Math.ceil((maxDate-minDate)/86400000);
          const todayMs=new Date(new Date().toISOString().split('T')[0]+'T12:00:00').getTime();
          const todayPct=todayMs>=minDate&&todayMs<=maxDate?((todayMs-minDate)/(maxDate-minDate))*100:null;
          const chartW=Math.max(800,totalDays*8);
          const rowH=28;const chartH=ganttJobs.length*rowH+60;
          const monthTicks=[];
          const mStart=new Date(minDate);mStart.setDate(1);
          while(mStart.getTime()<=maxDate){if(mStart.getTime()>=minDate)monthTicks.push({ms:mStart.getTime(),label:mStart.toLocaleDateString('en-US',{month:'short',year:'2-digit'})});const nm=new Date(mStart);nm.setMonth(nm.getMonth()+1);mStart.setTime(nm.getTime());}
          return<div style={card}>
            <div style={{overflow:'auto',maxHeight:'calc(100vh - 300px)'}}>
              <div style={{display:'flex',minWidth:chartW}}>
                <div style={{width:200,flexShrink:0,borderRight:'1px solid #E5E3E0'}}>
                  <div style={{height:30,borderBottom:'1px solid #E5E3E0',padding:'6px 8px',fontSize:10,fontWeight:600,color:'#6B6056'}}>PROJECT</div>
                  {ganttJobs.map(j=><div key={j.id} style={{height:rowH,padding:'0 8px',display:'flex',alignItems:'center',borderBottom:'1px solid #F4F4F2',fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={j.job_name}>{(j.job_name||'').slice(0,25)}</div>)}
                </div>
                <div style={{flex:1,position:'relative',minWidth:0}}>
                  <div style={{height:30,borderBottom:'1px solid #E5E3E0',position:'relative'}}>
                    {monthTicks.map(t=><div key={t.ms} style={{position:'absolute',left:`${((t.ms-minDate)/(maxDate-minDate))*100}%`,fontSize:9,fontWeight:600,color:'#6B6056',top:8,borderLeft:'1px solid #E5E3E0',paddingLeft:4}}>{t.label}</div>)}
                  </div>
                  {ganttJobs.map((j,i)=>{
                    const s=parseD(j.est_start_date);
                    const e2=j.install_complete_date?parseD(j.install_complete_date):s+60*86400000;
                    const left=((s-minDate)/(maxDate-minDate))*100;
                    const width=((e2-s)/(maxDate-minDate))*100;
                    const c=GANTT_MKT_C[j.market]||'#8B2020';
                    return<div key={j.id} style={{height:rowH,position:'relative',borderBottom:'1px solid #F4F4F2',display:'flex',alignItems:'center'}}>
                      <div title={`${j.job_name}\n${j.market}\nStart: ${fD(j.est_start_date)}\nEnd: ${j.install_complete_date?fD(j.install_complete_date):'Est. +60d'}\nStatus: ${SL[j.status]||j.status}\nLF: ${n(j.total_lf).toLocaleString()}`} style={{position:'absolute',left:`${left}%`,width:`${Math.max(width,0.5)}%`,height:18,background:c,borderRadius:4,opacity:0.85,cursor:'pointer'}}/>
                    </div>;
                  })}
                  {todayPct!==null&&<div style={{position:'absolute',top:0,bottom:0,left:`${todayPct}%`,borderLeft:'2px dashed #EF4444',zIndex:1,pointerEvents:'none'}}><div style={{position:'absolute',top:2,left:4,fontSize:8,color:'#EF4444',fontWeight:700}}>TODAY</div></div>}
                </div>
              </div>
            </div>
          </div>;
        })()}
      </div>
      {view==='calendar'&&<div style={{width:220,flexShrink:0}}><div style={{fontFamily:'Inter',fontWeight:700,fontSize:13,marginBottom:10}}>Weekly Capacity</div>{weeks8.map(w=>{const wk=w.toISOString().split('T')[0];const wEnd=new Date(w);wEnd.setDate(wEnd.getDate()+6);const wEv=events.filter(e=>e.scheduled_date>=wk&&e.scheduled_date<=wEnd.toISOString().split('T')[0]);const wLF=wEv.reduce((s,e)=>s+n(e.lf_scheduled),0);const color=wLF>8000?'#991B1B':wLF>5000?'#B45309':'#065F46';return<div key={wk} style={{marginBottom:8}}><div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}><span style={{color:'#6B6056'}}>Wk {w.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span><span style={{fontWeight:700,color}}>{wLF.toLocaleString()} LF</span></div><PBar pct={wLF/8000*100} color={color} h={4}/></div>;})}</div>}
    </div>
    {showAdd&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>{setShowAdd(false);setEditEvt(null);}}><div style={{background:'#fff',borderRadius:16,padding:24,width:480,maxHeight:'80vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
      <div style={{fontFamily:'Inter',fontSize:18,fontWeight:800,marginBottom:16}}>{editEvt?'Edit Event':'Add Event'}</div>
      <form onSubmit={saveEvent}>
        <div style={{marginBottom:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase'}}>Project</label><input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setForm(f=>({...f,job_id:''}));}} placeholder="Search..." style={inputS}/>{jobSearch&&!form.job_id&&<div style={{border:'1px solid #E5E3E0',borderRadius:8,marginTop:4,maxHeight:150,overflow:'auto'}}>{searchedJobs.map(j=><div key={j.id} onClick={()=>{setForm(f=>({...f,job_id:j.id}));setJobSearch(`${j.job_number} - ${j.job_name}`);}} style={{padding:'6px 10px',cursor:'pointer',fontSize:12,borderBottom:'1px solid #F4F4F2'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{j.job_number} - {j.job_name}</div>)}</div>}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>{[['Event Type','event_type','select'],['LF Scheduled','lf_scheduled','number'],['Start Date','scheduled_date','date'],['End Date','end_date','date'],['Assigned To','assigned_to','text'],['Crew','crew','text']].map(([l,k,t])=><div key={k}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase'}}>{l}</label>{t==='select'?<select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inputS}>{['production_start','production_end','install_start','install_end','delivery'].map(t2=><option key={t2} value={t2}>{t2.replace(/_/g,' ')}</option>)}</select>:<input type={t} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inputS} required={k==='scheduled_date'}/> }</div>)}</div>
        <div style={{marginTop:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase'}}>Notes</label><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={3} style={{...inputS,resize:'vertical'}}/></div>
        <div style={{display:'flex',gap:8,marginTop:16}}><button type="submit" style={btnP}>{editEvt?'Update':'Save'}</button>{editEvt&&<button type="button" onClick={()=>deleteEvent(editEvt.id)} style={{...btnP,background:'#991B1B'}}>Delete</button>}<button type="button" onClick={()=>{setShowAdd(false);setEditEvt(null);}} style={btnS}>Cancel</button></div>
      </form>
    </div></div>}
    </>}
  </div>);
}

/* ═══ PRODUCTION PLANNING PAGE — queue (left) + plan builder (right) ═══ */
function ProductionPlanningPage({jobs,setJobs,onNav,refreshKey=0}){
  const[toast,setToast]=useState(null);
  const tomorrowISO=(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().split('T')[0];})();
  const todayISO=new Date().toISOString().split('T')[0];
  const shiftDate=(iso,delta)=>{const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+delta);return d.toISOString().split('T')[0];};
  const fmtDateLabel=(iso)=>new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});

  // Plan state
  const[planDate,setPlanDate]=useState(tomorrowISO);
  const[planId,setPlanId]=useState(null);
  const[planLines,setPlanLines]=useState([]);
  const[planNotes,setPlanNotes]=useState('');
  const[savingPlan,setSavingPlan]=useState(false);
  const[queueFilter,setQueueFilter]=useState('all');
  const[leadershipOpen,setLeadershipOpen]=useState(false);
  const[carryForward,setCarryForward]=useState([]);

  // Capacity data (molds + plant config + styles)
  const[moldInventory,setMoldInventory]=useState([]);
  const[plantCfg,setPlantCfg]=useState({});
  const[calcStyles,setCalcStyles]=useState([]);
  useEffect(()=>{
    sbGet('mold_inventory','select=style_name,total_molds,mold_type').then(d=>setMoldInventory(d||[]));
    sbGet('plant_config','select=key,value').then(d=>{const m={};(d||[]).forEach(r=>{m[r.key]=n(r.value);});setPlantCfg(m);});
    sbGet('material_calc_styles','select=style_name,cy_per_panel,cy_per_post,cy_per_cap_rail').then(d=>setCalcStyles(d||[]));
  },[]);
  const stylesByName=useMemo(()=>{const m={};calcStyles.forEach(s=>{m[s.style_name]=s;});return m;},[calcStyles]);
  const physicalMolds=useMemo(()=>moldInventory.filter(r=>n(r.total_molds)>0&&!isChildStyle(r.style_name)),[moldInventory]);
  const moldsByStyle=useMemo(()=>{const m={};physicalMolds.forEach(r=>{m[r.style_name]=n(r.total_molds);});return m;},[physicalMolds]);
  const panelsPerMoldForStyle=useCallback((style)=>panelsPerMoldLookup(style),[]);
  const MOLD_UTIL_RATE=n(plantCfg.mold_utilization_rate)||0.88;
  const SCRAP_RATE=n(plantCfg.scrap_rate_warm)||0.03;
  const ACCESSORY_MULT=n(plantCfg.accessory_overhead_multiplier)||1.4;
  const moldsForStyle=useCallback((style)=>{if(!style)return 0;const c=canonicalStyle(style);if(moldsByStyle[c])return moldsByStyle[c];const k=Object.keys(moldsByStyle).find(key=>key.toLowerCase().includes((c||'').toLowerCase())||(c||'').toLowerCase().includes(key.toLowerCase()));return k?moldsByStyle[k]:0;},[moldsByStyle]);
  const moldCapacityPanels=useCallback((style)=>{const m=moldsForStyle(style);const ppm=panelsPerMoldForStyle(canonicalStyle(style));return Math.floor(m*ppm*MOLD_UTIL_RATE);},[moldsForStyle,panelsPerMoldForStyle,MOLD_UTIL_RATE]);
  const panelsPerDayForStyle=useCallback((style)=>{const m=moldsForStyle(style);const ppm=panelsPerMoldForStyle(canonicalStyle(style));return Math.floor((m*ppm*MOLD_UTIL_RATE)/(1+SCRAP_RATE));},[moldsForStyle,panelsPerMoldForStyle,MOLD_UTIL_RATE,SCRAP_RATE]);
  const cyForLine=useCallback((l)=>{const panels=sumGroup(l.planned,'PANELS');const sRow=stylesByName[l.style]||{};return panels*n(sRow.cy_per_panel)*ACCESSORY_MULT;},[stylesByName,ACCESSORY_MULT]);
  const totalPanelCapacity=useMemo(()=>physicalMolds.reduce((s,r)=>{const ppm=panelsPerMoldForStyle(r.style_name);if(ppm==null)return s;return s+Math.floor(n(r.total_molds)*ppm*MOLD_UTIL_RATE);},0),[physicalMolds,panelsPerMoldForStyle,MOLD_UTIL_RATE]);
  const totalMoldsOwned=useMemo(()=>physicalMolds.reduce((s,r)=>s+n(r.total_molds),0)||n(plantCfg.total_molds),[physicalMolds,plantCfg]);
  const dailyCyCap=n(plantCfg.daily_cy_capacity)||52.8;

  // Plan builder helpers
  const groupTotals=useCallback((j)=>({
    posts:n(j?.material_posts_line)+n(j?.material_posts_corner)+n(j?.material_posts_stop),
    panels:n(j?.material_panels_regular)+n(j?.material_panels_half)+n(j?.material_panels_bottom)+n(j?.material_panels_top),
    rails:n(j?.material_rails_regular)+n(j?.material_rails_top)+n(j?.material_rails_bottom)+n(j?.material_rails_center),
    caps:n(j?.material_caps_line)+n(j?.material_caps_stop),
  }),[]);
  const buildPlanLine=useCallback((job,existing)=>{
    const gt=groupTotals(job);
    const material={posts_line:n(job?.material_posts_line),posts_corner:n(job?.material_posts_corner),posts_stop:n(job?.material_posts_stop),panels_regular:n(job?.material_panels_regular),panels_half:n(job?.material_panels_half),panels_bottom:n(job?.material_panels_bottom),panels_top:n(job?.material_panels_top),rails_regular:n(job?.material_rails_regular),rails_top:n(job?.material_rails_top),rails_bottom:n(job?.material_rails_bottom),rails_center:n(job?.material_rails_center),caps_line:n(job?.material_caps_line),caps_stop:n(job?.material_caps_stop)};
    // Per-piece planned object: each piece type independently editable, defaults to full material order
    const planned={};PLAN_PIECE_KEYS.forEach(k=>{const dbCol='planned_'+k;const existingVal=existing?.[dbCol];planned[k]=existingVal!=null?String(existingVal):(n(material[k])?String(n(material[k])):'');});
    // Stale detection: if existing plan line records a calc date, compare to job's current material_calc_date
    const savedCalcDate=existing?.material_calc_date_at_plan||null;
    const currentCalcDate=job?.material_calc_date||null;
    const staleFromDB=!!existing?.quantities_stale;
    const staleFromCompare=!!(savedCalcDate&&currentCalcDate&&new Date(currentCalcDate).getTime()>new Date(savedCalcDate).getTime());
    return{
      id:existing?.id||null,job_id:job?.id||existing?.job_id||null,job_number:job?.job_number||existing?.job_number||'',job_name:job?.job_name||existing?.job_name||'',
      style:job?.style||existing?.style||'',color:job?.color||existing?.color||'',height:job?.height_precast||existing?.height||'',post_height:n(job?.material_post_height)||0,material_calc_date:currentCalcDate,
      material,material_totals:gt,
      planned,
      planned_lf:existing?.planned_lf!=null?String(existing.planned_lf):(lfPC(job)?String(lfPC(job)):''),
      shift_assignment:existing?.shift_assignment||'both',
      partial_run_reason:existing?.partial_run_reason||'',notes:existing?.notes||'',
      material_calc_date_at_plan:existing?existing.material_calc_date_at_plan||null:currentCalcDate,
      quantities_stale:staleFromDB||staleFromCompare,
    };
  },[groupTotals]);

  // Load plan for selected date
  const loadPlan=useCallback(async(date)=>{
    try{
      const plans=await sbGet('production_plans',`plan_date=eq.${date}&select=*&limit=1`);
      if(plans&&plans[0]){
        setPlanId(plans[0].id);setPlanNotes(plans[0].plan_notes||'');
        // Explicit column list forces PostgREST to return per-piece columns even if schema cache is stale
        const pieceCols=PLAN_PIECE_KEYS.map(k=>'planned_'+k).join(',');
        const selectList=`id,plan_id,job_id,job_number,job_name,style,color,height,sort_order,planned_pieces,planned_lf,planned_post_height,${pieceCols},planned_posts,planned_panels,planned_rails,planned_caps,is_partial_run,partial_run_reason,notes,material_calc_date_at_plan,quantities_stale`;
        let lines=null;
        try{lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&select=${selectList}&order=sort_order.asc`);}
        catch(e1){console.warn('Explicit column fetch failed, falling back to select=*',e1);lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&order=sort_order.asc`);}
        // Pass the raw DB row as "existing" so buildPlanLine picks up all per-piece planned_* columns
        setPlanLines((lines||[]).map(l=>{const j=jobs.find(x=>x.id===l.job_id);return buildPlanLine(j||{id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style,color:l.color,height_precast:l.height,total_lf:l.planned_lf},l);}));
      }else{setPlanId(null);setPlanLines([]);setPlanNotes('');}
    }catch(e){console.error('Load plan failed:',e);}
  },[jobs,buildPlanLine]);
  useEffect(()=>{loadPlan(planDate);},[planDate,loadPlan,refreshKey]);

  // Carry forward from previous day — per-piece remaining based on full order - cumulative actuals for each job
  const loadCarryForward=useCallback(async(forDate)=>{
    try{
      const pd=new Date(forDate+'T12:00:00');pd.setDate(pd.getDate()-1);const prevISO=pd.toISOString().split('T')[0];
      const plans=await sbGet('production_plans',`plan_date=eq.${prevISO}&select=id&limit=1`);
      if(!plans||!plans[0]){setCarryForward([]);return;}
      const yLines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}`);
      // For each job in yesterday's plan, sum ALL historical actuals (every date, every shift) per piece type
      const jobIds=[...new Set((yLines||[]).map(l=>l.job_id).filter(Boolean))];
      const actualsByJob={};
      if(jobIds.length>0){
        const idFilter=jobIds.map(id=>`job_id.eq.${id}`).join(',');
        const allActs=await sbGet('production_actuals',`or=(${idFilter})&select=job_id,${PLAN_PIECE_KEYS.map(k=>'actual_'+k).join(',')},actual_lf`);
        (allActs||[]).forEach(a=>{const jid=a.job_id;if(!actualsByJob[jid]){actualsByJob[jid]={};PLAN_PIECE_KEYS.forEach(k=>{actualsByJob[jid][k]=0;});actualsByJob[jid].lf=0;}PLAN_PIECE_KEYS.forEach(k=>{actualsByJob[jid][k]+=n(a['actual_'+k]);});actualsByJob[jid].lf+=n(a.actual_lf);});
      }
      const incomplete=(yLines||[]).map(l=>{
        const job=jobs.find(x=>x.id===l.job_id);
        const acts=actualsByJob[l.job_id]||{};
        const remaining={};let anyRemaining=false;let totalRemainingPanels=0;let totalPlannedPanels=0;let totalActualPanels=0;
        PLAN_PIECE_KEYS.forEach(k=>{
          const full=n(job?.['material_'+k]);
          const done=n(acts[k]);
          const rem=Math.max(full-done,0);
          remaining[k]=rem;
          if(rem>0&&full>0)anyRemaining=true;
          if(k.startsWith('panels_')){totalRemainingPanels+=rem;totalPlannedPanels+=full;totalActualPanels+=done;}
        });
        const fullLf=lfPC(job);
        const remainingLf=Math.max(fullLf-n(acts.lf),0);
        return{job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style,remaining,remainingLf,totalRemainingPanels,plannedPanels:totalPlannedPanels,actualPanels:totalActualPanels,anyRemaining,prevDate:prevISO};
      }).filter(cf=>cf.anyRemaining);
      setCarryForward(incomplete);
    }catch(e){console.error('Carry forward failed:',e);setCarryForward([]);}
  },[jobs]);
  useEffect(()=>{loadCarryForward(planDate);},[planDate,loadCarryForward]);

  // Helpers
  const updatePlanLine=(idx,field,val)=>setPlanLines(prev=>prev.map((l,i)=>i===idx?{...l,[field]:val}:l));
  const removePlanLine=(idx)=>setPlanLines(prev=>prev.filter((_,i)=>i!==idx));
  const movePlanLine=(idx,dir)=>setPlanLines(prev=>{const n2=[...prev];const t=idx+dir;if(t<0||t>=n2.length)return n2;[n2[idx],n2[t]]=[n2[t],n2[idx]];return n2;});
  const addJobToPlan=(j)=>{setPlanLines(prev=>prev.some(l=>l.job_id===j.id)?prev:[...prev,buildPlanLine(j,null)]);};
  const addJobFromCarryForward=(cf)=>{
    const j=jobs.find(x=>x.id===cf.job_id);if(!j)return;
    if(planLines.some(l=>l.job_id===cf.job_id))return;
    const line=buildPlanLine(j,null);
    // Override planned per-piece with the carry-forward remaining (zero-out pieces already done)
    const planned={};PLAN_PIECE_KEYS.forEach(k=>{const rem=n(cf.remaining?.[k]);planned[k]=rem>0?String(rem):'0';});
    line.planned=planned;
    if(cf.remainingLf!=null)line.planned_lf=String(n(cf.remainingLf));
    setPlanLines(prev=>[...prev,line]);
    setCarryForward(prev=>prev.filter(c=>c.job_id!==cf.job_id));
  };

  // Refresh a plan line's material quantities to match current job record — clears stale flag
  const updatePlanLineToLatest=(idx)=>{
    setPlanLines(prev=>prev.map((l,i)=>{
      if(i!==idx)return l;
      const job=jobs.find(x=>x.id===l.job_id);if(!job)return l;
      const gt=groupTotals(job);
      const material={posts_line:n(job.material_posts_line),posts_corner:n(job.material_posts_corner),posts_stop:n(job.material_posts_stop),panels_regular:n(job.material_panels_regular),panels_half:n(job.material_panels_half),panels_bottom:n(job.material_panels_bottom),panels_top:n(job.material_panels_top),rails_regular:n(job.material_rails_regular),rails_top:n(job.material_rails_top),rails_bottom:n(job.material_rails_bottom),rails_center:n(job.material_rails_center),caps_line:n(job.material_caps_line),caps_stop:n(job.material_caps_stop)};
      const planned={};PLAN_PIECE_KEYS.forEach(k=>{planned[k]=n(material[k])?String(n(material[k])):'';});
      return{...l,material,material_totals:gt,post_height:n(job.material_post_height)||l.post_height,material_calc_date:job.material_calc_date||l.material_calc_date,planned,material_calc_date_at_plan:job.material_calc_date||l.material_calc_date_at_plan,quantities_stale:false};
    }));
    setToast({msg:'Plan line refreshed to latest material calc',ok:true});
  };

  // Update one piece's planned value on a specific plan line
  const updatePlanPiece=(idx,pieceKey,val)=>setPlanLines(prev=>prev.map((l,i)=>i===idx?{...l,planned:{...l.planned,[pieceKey]:val}}:l));

  // Queue jobs — ALL production_queue jobs, split into "ready to plan" (has material calc) and "needs calc" (missing)
  const queueGroups=useMemo(()=>{
    const all=jobs.filter(j=>j.status==='production_queue'&&!planLines.some(l=>l.job_id===j.id));
    const weekOut=new Date();weekOut.setDate(weekOut.getDate()+7);const today=new Date();today.setHours(0,0,0,0);
    const applyFilter=(list)=>list.filter(j=>{
      if(queueFilter==='urgent'){if(!j.est_start_date)return false;const d=new Date(j.est_start_date+'T12:00:00');return d<=weekOut;}
      if(queueFilter==='this_week'){if(!j.est_start_date)return false;const d=new Date(j.est_start_date+'T12:00:00');return d>=today&&d<=weekOut;}
      return true;
    });
    const sortByEst=(a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999');
    const ready=applyFilter(all.filter(j=>j.material_calc_date)).sort(sortByEst);
    const needsCalc=applyFilter(all.filter(j=>!j.material_calc_date)).sort(sortByEst);
    return{ready,needsCalc,total:ready.length+needsCalc.length};
  },[jobs,planLines,queueFilter]);
  // Legacy alias so the rest of the page keeps working while we refactor the render
  const queueJobs=queueGroups.ready;

  // Plan totals
  // Sum all piece totals for a single line (today's run total)
  const lineDailyTotal=(l)=>PLAN_PIECE_KEYS.reduce((s,k)=>s+n(l.planned?.[k]),0);
  // Check if ANY piece is less than its full material order — partial run at piece level
  const lineIsPartial=(l)=>PLAN_PIECE_KEYS.some(k=>{const full=n(l.material?.[k]);const today=n(l.planned?.[k]);return full>0&&today<full;});
  // Convenience: per-line panels sum (regular + half + bottom + top)
  const linePanels=(l)=>sumGroup(l.planned,'PANELS');
  const linePosts=(l)=>sumGroup(l.planned,'POSTS');
  const lineRails=(l)=>sumGroup(l.planned,'RAILS');
  const lineCaps=(l)=>sumGroup(l.planned,'POST CAPS');
  const planTotals=useMemo(()=>{let panels=0,posts=0,rails=0,caps=0,lf=0,cy=0;planLines.forEach(l=>{panels+=linePanels(l);posts+=linePosts(l);rails+=lineRails(l);caps+=lineCaps(l);lf+=n(l.planned_lf);cy+=cyForLine(l);});return{panels,posts,rails,caps,lf,cy,count:planLines.length,total:panels+posts+rails+caps};},[planLines,cyForLine]);

  // Mold utilization grouped by physical mold set (for capacity bar + leadership view)
  const moldUsageByStyle=useMemo(()=>{
    const m={};planLines.forEach(l=>{const canonical=canonicalStyle(l.style||'—');if(!m[canonical]){const children=MOLD_CHILDREN[canonical]||[];const ppm=panelsPerMoldForStyle(canonical);m[canonical]={style:canonical,label:children.length>0?`${canonical} / ${children.join(' / ')}`:canonical,panels:0,capacity:moldCapacityPanels(canonical),molds:moldsForStyle(canonical),panelsPerMold:ppm,confirmed:ppm!=null};}m[canonical].panels+=linePanels(l);});
    return Object.values(m).filter(x=>x.panels>0||x.capacity>0||!x.confirmed&&x.panels>0).sort((a,b)=>b.panels-a.panels);
  },[planLines,moldCapacityPanels,moldsForStyle,panelsPerMoldForStyle]);
  const leadershipTable=useMemo(()=>physicalMolds.map(m=>{const ppm=panelsPerMoldForStyle(m.style_name);const confirmed=ppm!=null;const capacity=confirmed?Math.floor(m.total_molds*ppm*MOLD_UTIL_RATE):0;const inUse=moldUsageByStyle.find(u=>u.style===m.style_name)?.panels||0;const pct=capacity>0?Math.round(inUse/capacity*100):0;const children=MOLD_CHILDREN[m.style_name]||[];return{style:m.style_name,label:children.length>0?`${m.style_name} / ${children.join(' / ')}`:m.style_name,molds:m.total_molds,panelsPerMold:ppm,confirmed,capacity,inUse,available:confirmed?Math.max(capacity-inUse,0):0,pct,notPlanned:inUse===0};}),[physicalMolds,panelsPerMoldForStyle,MOLD_UTIL_RATE,moldUsageByStyle]);

  // Save plan
  const savePlan=async()=>{
    setSavingPlan(true);
    try{
      let curId=planId;
      if(curId){
        await fetch(`${SB}/rest/v1/production_plans?id=eq.${curId}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({plan_notes:planNotes||null,updated_at:new Date().toISOString()})});
        await fetch(`${SB}/rest/v1/production_plan_lines?plan_id=eq.${curId}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
      }else{
        const res=await fetch(`${SB}/rest/v1/production_plans`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({plan_date:planDate,created_by:'Max',plan_notes:planNotes||null})});
        if(!res.ok)throw new Error(await res.text());
        const saved=await res.json();curId=saved[0].id;setPlanId(curId);
      }
      if(planLines.length>0){
        const lineRows=planLines.map((l,i)=>{
          const jobForLine=jobs.find(x=>x.id===l.job_id);
          const calcAtPlan=l.material_calc_date_at_plan||jobForLine?.material_calc_date||l.material_calc_date||null;
          const pieceCols={};PLAN_PIECE_KEYS.forEach(k=>{pieceCols['planned_'+k]=n(l.planned?.[k])||0;});
          const aggCols={planned_posts:linePosts(l),planned_panels:linePanels(l),planned_rails:lineRails(l),planned_caps:lineCaps(l)};
          return{plan_id:curId,sort_order:i,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||null,color:l.color||null,height:l.height||null,planned_pieces:lineDailyTotal(l),...pieceCols,...aggCols,planned_post_height:n(l.post_height)||0,planned_lf:n(l.planned_lf)||0,is_partial_run:lineIsPartial(l),partial_run_reason:l.partial_run_reason||null,notes:l.notes||null,material_calc_date_at_plan:calcAtPlan,quantities_stale:false};
        });
        const OPTIONAL_PLAN_COLS=[...PLAN_PIECE_KEYS.map(k=>'planned_'+k),'planned_post_height','material_calc_date_at_plan','quantities_stale','shift_assignment'];
        let res2=await fetch(`${SB}/rest/v1/production_plan_lines`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(lineRows)});
        let attempts=0;let currentRows=lineRows;
        while(!res2.ok&&attempts<15){
          const errTxt=await res2.text();
          const missingCol=OPTIONAL_PLAN_COLS.find(c=>errTxt.includes(`'${c}'`)||errTxt.includes(`"${c}"`)||errTxt.includes(` ${c} `));
          if(!missingCol){throw new Error(errTxt);}
          console.warn(`Retrying production_plan_lines POST without column "${missingCol}"`);
          currentRows=currentRows.map(r=>{const c={...r};delete c[missingCol];return c;});
          res2=await fetch(`${SB}/rest/v1/production_plan_lines`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(currentRows)});
          attempts++;
        }
        if(!res2.ok)throw new Error(await res2.text());
      }
      // Auto-advance production_queue → in_production
      const today2=new Date().toISOString().split('T')[0];
      for(const l of planLines){
        const j=jobs.find(x=>x.id===l.job_id);
        if(j&&j.status==='production_queue'){
          try{
            await fetch(`${SB}/rest/v1/jobs?id=eq.${j.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'in_production',production_start_date:j.production_start_date||today2})});
            if(setJobs)setJobs(prev=>prev.map(x=>x.id===j.id?{...x,status:'in_production',production_start_date:x.production_start_date||today2}:x));
            fetch(`${SB}/functions/v1/job-stage-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{job_name:j.job_name,job_number:j.job_number,market:j.market,pm:j.pm,sales_rep:j.sales_rep,style:j.style,color:j.color,height_precast:j.height_precast,total_lf:j.total_lf,adj_contract_value:j.adj_contract_value},from_status:'production_queue',to_status:'in_production'})}).catch(()=>{});
          }catch(e){console.error('Auto-advance failed:',e);}
        }
      }
      setToast({msg:`Plan saved for ${planDate}`,ok:true});
      fetch(`${SB}/functions/v1/production-plan-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_date:planDate,plan_notes:planNotes,lines:planLines,totals:planTotals})}).catch(()=>{});
    }catch(e){console.error('Save plan error:',e);setToast({msg:'Save failed: '+e.message,ok:false});}
    setSavingPlan(false);
  };

  const cyPct=dailyCyCap>0?Math.round(planTotals.cy/dailyCyCap*100):0;
  const totalPlannedPanels=planTotals.panels;
  const moldPct=totalPanelCapacity>0?Math.round(totalPlannedPanels/totalPanelCapacity*100):0;
  // Over-capacity is informational (amber) not alarming (red) — bar visually caps at 100%, number shown as-is
  const cyCol=cyPct>=70?'#B45309':'#15803D';
  const moldCol=moldPct>=70?'#B45309':'#15803D';
  // Detect plan lines where Today's Run still matches the full material order (likely unadjusted)
  const hasUnadjustedLines=useMemo(()=>planLines.some(l=>{const full=l.material_totals?.panels||0;const today=linePanels(l);return full>0&&today>=full;}),[planLines]);

  const todayIsoStart=new Date();todayIsoStart.setHours(0,0,0,0);
  const sevenOut=new Date();sevenOut.setDate(sevenOut.getDate()+7);

  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.msg} isError={typeof toast==='object'&&!toast.ok} onDone={()=>setToast(null)}/>}
    <div style={{marginBottom:16}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:2}}>Production Planning</h1>
      <div style={{fontSize:12,color:'#9E9B96'}}>Build tomorrow's plan from the production queue</div>
    </div>

    {/* CAPACITY BAR */}
    <div style={{...card,marginBottom:16,padding:14,borderLeft:'4px solid #7C3AED'}}>
      <div style={{fontSize:12,fontWeight:800,color:'#7C3AED',textTransform:'uppercase',marginBottom:10}}>🏭 Plant Capacity — {fmtDateLabel(planDate)}</div>
      {hasUnadjustedLines&&<div style={{fontSize:11,color:'#1D4ED8',background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:6,padding:'6px 10px',marginBottom:10}}>ℹ️ One or more plan lines still show the full material order. Adjust "Today's Run" quantities on each plan card to see accurate daily capacity — these numbers reflect today's run, not the entire job.</div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
            <span style={{fontWeight:700}}>🏭 Batch Plant</span>
            <span style={{fontWeight:700,color:cyCol}}>{planTotals.cy.toFixed(1)} / {dailyCyCap} CYD · {cyPct}%</span>
          </div>
          <div style={{height:10,background:'#E5E3E0',borderRadius:5,overflow:'hidden'}}><div style={{width:`${Math.min(cyPct,100)}%`,height:'100%',background:cyCol,transition:'width 0.3s'}}/></div>
        </div>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
            <span style={{fontWeight:700}}>🔧 Mold Utilization</span>
            <span style={{fontWeight:700,color:moldCol}}>{totalPlannedPanels.toLocaleString()} / {totalPanelCapacity.toLocaleString()} panels · {moldPct}%</span>
          </div>
          <div style={{height:10,background:'#E5E3E0',borderRadius:5,overflow:'hidden'}}><div style={{width:`${Math.min(moldPct,100)}%`,height:'100%',background:moldCol,transition:'width 0.3s'}}/></div>
        </div>
      </div>
    </div>

    {/* TWO COLUMN LAYOUT */}
    <div style={{display:'grid',gridTemplateColumns:'40% 60%',gap:16,alignItems:'start'}}>
      {/* LEFT — QUEUE */}
      <div style={{...card,padding:14,borderTop:'3px solid #7C3AED'}}>
        <div style={{marginBottom:8}}>
          <div style={{display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:'#7C3AED',textTransform:'uppercase'}}>Production Queue</div>
            <span style={{background:'#EDE9FE',color:'#7C3AED',padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:700}}>{queueGroups.total}</span>
          </div>
          <div style={{fontSize:11,color:'#9E9B96',marginTop:2}}>All jobs in production queue — sorted by est. start date</div>
        </div>
        <div style={{display:'flex',gap:4,marginBottom:10}}>
          {[['all','All'],['urgent','Urgent'],['this_week','This Week']].map(([k,lbl])=><button key={k} onClick={()=>setQueueFilter(k)} style={{padding:'5px 10px',borderRadius:6,border:queueFilter===k?'2px solid #7C3AED':'1px solid #E5E3E0',background:queueFilter===k?'#EDE9FE':'#FFF',color:queueFilter===k?'#7C3AED':'#6B6056',fontSize:11,fontWeight:700,cursor:'pointer'}}>{lbl}</button>)}
        </div>
        <div style={{maxHeight:720,overflow:'auto',display:'flex',flexDirection:'column',gap:12}}>
          {queueGroups.total===0&&<div style={{textAlign:'center',padding:20,color:'#9E9B96',fontSize:12}}>No jobs in queue</div>}

          {/* GROUP 1 — Ready to Plan */}
          {queueGroups.ready.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,color:'#15803D',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6,display:'flex',alignItems:'center',gap:6}}>
              <span>✓ Ready to Plan</span>
              <span style={{background:'#DCFCE7',color:'#15803D',padding:'1px 6px',borderRadius:8,fontSize:10,fontWeight:700}}>{queueGroups.ready.length}</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {queueGroups.ready.map(j=>{
                const gt=groupTotals(j);const pcs=gt.posts+gt.panels+gt.rails+gt.caps;
                const molds=moldsForStyle(j.style);const ppd=panelsPerDayForStyle(j.style);const days=ppd>0&&gt.panels>0?Math.ceil(gt.panels/ppd):0;
                const est=j.est_start_date?new Date(j.est_start_date+'T12:00:00'):null;
                const overdue=est&&est<todayIsoStart;const urgent=est&&!overdue&&est<=sevenOut;
                return<div key={j.id} style={{border:'1px solid #E5E3E0',borderLeft:`3px solid ${overdue?'#DC2626':urgent?'#B45309':'#15803D'}`,borderRadius:8,padding:10,background:'#FAFAF8'}}>
                  <div style={{fontSize:13,fontWeight:700}}>{j.job_name} <span style={{color:'#9E9B96',fontWeight:500,fontSize:11}}>#{j.job_number}</span></div>
                  <div style={{fontSize:11,color:'#6B6056',marginTop:2}}>{[j.style,j.color,j.height_precast?j.height_precast+'ft':null].filter(Boolean).join(' | ')||'—'}</div>
                  <div style={{fontSize:11,color:'#6B6056',marginTop:2}}>{pcs>0&&<span><b style={{color:'#1A1A1A'}}>{gt.panels.toLocaleString()}</b> panels</span>} {(lfPC(j)>0||lfSW(j)>0||lfWI(j)>0||lfGates(j)>0)&&<span style={{marginLeft:8}}><LfBadges job={j}/></span>}</div>
                  <div style={{fontSize:10,color:overdue?'#DC2626':urgent?'#B45309':'#9E9B96',fontWeight:600,marginTop:2}}>
                    {j.est_start_date?`Est start: ${fD(j.est_start_date)}`:'No est start'} {days>0&&<span>· ~{days} prod days</span>}
                    {overdue&&<span style={{marginLeft:6}}>⚠ OVERDUE</span>}
                    {urgent&&!overdue&&<span style={{marginLeft:6}}>🟡 URGENT</span>}
                  </div>
                  <button onClick={()=>addJobToPlan(j)} style={{width:'100%',marginTop:6,padding:'5px 10px',background:'#7C3AED',border:'none',borderRadius:6,color:'#FFF',fontSize:11,fontWeight:700,cursor:'pointer'}}>+ Add to Plan →</button>
                </div>;
              })}
            </div>
          </div>}

          {/* GROUP 2 — Needs Production Order */}
          {queueGroups.needsCalc.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,color:'#B45309',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6,display:'flex',alignItems:'center',gap:6}}>
              <span>⚠ Needs Production Order</span>
              <span style={{background:'#FEF3C7',color:'#B45309',padding:'1px 6px',borderRadius:8,fontSize:10,fontWeight:700}}>{queueGroups.needsCalc.length}</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {queueGroups.needsCalc.map(j=>{
                const est=j.est_start_date?new Date(j.est_start_date+'T12:00:00'):null;
                const overdue=est&&est<todayIsoStart;const urgent=est&&!overdue&&est<=sevenOut;
                const hasStyleColor=!!(j.style&&j.color);
                return<div key={j.id} style={{border:'1px solid #FCD34D',borderLeft:`3px solid ${overdue?'#DC2626':'#B45309'}`,borderRadius:8,padding:10,background:'#FFFBEB'}}>
                  <div style={{fontSize:13,fontWeight:700}}>{j.job_name} <span style={{color:'#9E9B96',fontWeight:500,fontSize:11}}>#{j.job_number}</span></div>
                  <div style={{fontSize:11,color:'#6B6056',marginTop:2}}>{[j.style||<span key="s" style={{color:'#DC2626'}}>no style</span>,j.color||<span key="c" style={{color:'#DC2626'}}>no color</span>,j.height_precast?j.height_precast+'ft':null].filter(Boolean).reduce((acc,el,i)=>i===0?[el]:[...acc,' | ',el],[])}</div>
                  {(lfPC(j)>0||lfSW(j)>0||lfWI(j)>0||lfGates(j)>0)&&<div style={{fontSize:11,color:'#6B6056',marginTop:2}}><LfBadges job={j}/></div>}
                  <div style={{fontSize:10,color:overdue?'#DC2626':urgent?'#B45309':'#9E9B96',fontWeight:600,marginTop:2}}>
                    {j.est_start_date?`Est start: ${fD(j.est_start_date)}`:'No est start'}
                    {overdue&&<span style={{marginLeft:6}}>⚠ OVERDUE</span>}
                    {urgent&&!overdue&&<span style={{marginLeft:6}}>🟡 URGENT</span>}
                  </div>
                  <div style={{fontSize:10,color:'#B45309',fontWeight:600,marginTop:4,fontStyle:'italic'}}>⚠ No production order — run Material Calculator first</div>
                  <button onClick={()=>{try{localStorage.setItem('fc_matcalc_prejob',j.id);}catch(e){}if(onNav)onNav('material_calc');}} disabled={!hasStyleColor} title={!hasStyleColor?'Set style and color on the project first':'Open Material Calculator with this job pre-loaded'} style={{width:'100%',marginTop:6,padding:'5px 10px',background:hasStyleColor?'#B45309':'#E5E3E0',border:'none',borderRadius:6,color:hasStyleColor?'#FFF':'#9E9B96',fontSize:11,fontWeight:700,cursor:hasStyleColor?'pointer':'not-allowed'}}>{hasStyleColor?'Calculate Materials →':'Missing style/color'}</button>
                </div>;
              })}
            </div>
          </div>}
        </div>
      </div>

      {/* RIGHT — PLAN BUILDER */}
      <div style={{...card,padding:14,borderTop:'3px solid #8B2020'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10,flexWrap:'wrap',gap:8}}>
          <div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:'#8B2020',textTransform:'uppercase'}}>{planDate===tomorrowISO?"Tomorrow's Plan":'Plan for '+fmtDateLabel(planDate)}</div>
          <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
            <button onClick={()=>setPlanDate(shiftDate(planDate,-1))} style={{padding:'5px 9px',border:'1px solid #E5E3E0',background:'#FFF',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700,color:'#6B6056'}}>←</button>
            <input type="date" value={planDate} onChange={e=>setPlanDate(e.target.value)} style={{...inputS,width:150}}/>
            <button onClick={()=>setPlanDate(shiftDate(planDate,1))} style={{padding:'5px 9px',border:'1px solid #E5E3E0',background:'#FFF',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700,color:'#6B6056'}}>→</button>
            <button onClick={()=>setPlanDate(todayISO)} style={{padding:'5px 9px',border:planDate===todayISO?'2px solid #8B2020':'1px solid #E5E3E0',background:planDate===todayISO?'#FDF4F4':'#FFF',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:700,color:planDate===todayISO?'#8B2020':'#6B6056'}}>Today</button>
            <button onClick={()=>setPlanDate(tomorrowISO)} style={{padding:'5px 9px',border:planDate===tomorrowISO?'2px solid #8B2020':'1px solid #E5E3E0',background:planDate===tomorrowISO?'#FDF4F4':'#FFF',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:700,color:planDate===tomorrowISO?'#8B2020':'#6B6056'}}>Tomorrow</button>
          </div>
        </div>

        {/* Carry forward */}
        {carryForward.length>0&&<div style={{padding:10,background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:8,marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:'#B45309',textTransform:'uppercase',marginBottom:6}}>↩ Carry Forward — {carryForward.length} {carryForward.length===1?'job':'jobs'} incomplete from yesterday</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {carryForward.map(cf=>{const added=planLines.some(l=>l.job_id===cf.job_id);return<div key={cf.job_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'4px 8px',background:'#FFF',borderRadius:6,fontSize:11}}>
              <div>
                <b>{cf.job_name}</b> <span style={{color:'#9E9B96'}}>#{cf.job_number}</span>
                <span style={{marginLeft:6,color:'#B45309',fontWeight:700}}>{cf.totalRemainingPanels.toLocaleString()} panels remaining</span>
              </div>
              <button onClick={()=>addJobFromCarryForward(cf)} disabled={added} style={{padding:'3px 8px',background:added?'#E5E3E0':'#B45309',border:'none',borderRadius:5,color:added?'#9E9B96':'#FFF',fontSize:10,fontWeight:700,cursor:added?'default':'pointer'}}>{added?'✓ Added':'+ Add'}</button>
            </div>;})}
          </div>
        </div>}

        {/* Plan lines */}
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {planLines.map((l,idx)=>{
            const m=l.material||{};const gt=l.material_totals||{posts:0,panels:0,rails:0,caps:0};
            const partial=lineIsPartial(l);
            const row=(label,val)=>val>0?<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:'#6B6056'}}>{label}:</span><b style={{color:'#1A1A1A'}}>{val.toLocaleString()}</b></div>:null;
            const phLabel=l.post_height?`${l.post_height}ft`:(l.height?`${l.height}ft`:'');
            return<div key={idx} style={{border:'1px solid #E5E3E0',borderLeft:`4px solid ${partial?'#B45309':'#7C3AED'}`,borderRadius:8,padding:10,background:'#FFF'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                <div style={{display:'flex',flexDirection:'column',gap:1}}>
                  <button onClick={()=>movePlanLine(idx,-1)} disabled={idx===0} style={{background:'none',border:'none',fontSize:9,cursor:idx===0?'not-allowed':'pointer',color:'#9E9B96',padding:0,lineHeight:1}}>▲</button>
                  <button onClick={()=>movePlanLine(idx,1)} disabled={idx===planLines.length-1} style={{background:'none',border:'none',fontSize:9,cursor:idx===planLines.length-1?'not-allowed':'pointer',color:'#9E9B96',padding:0,lineHeight:1}}>▼</button>
                </div>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                    <b style={{fontSize:13}}>{l.job_name}</b>
                    <span style={{color:'#9E9B96',fontSize:10}}>#{l.job_number}</span>
                    {partial&&<span style={{background:'#FEF3C7',color:'#B45309',fontSize:9,fontWeight:800,padding:'1px 5px',borderRadius:3}}>⚡ PARTIAL</span>}
                  </div>
                  <div style={{fontSize:10,color:'#6B6056',marginTop:1}}>{[l.style,l.color,l.height?l.height+'ft':null,n(l.planned_lf)?`${n(l.planned_lf).toLocaleString()} LF`:null].filter(Boolean).join(' | ')}</div>
                  {l.material_calc_date&&<div style={{fontSize:9,color:'#065F46',fontWeight:600}}>📋 Material order calculated {new Date(l.material_calc_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}
                </div>
                <button onClick={()=>removePlanLine(idx)} style={{background:'none',border:'none',color:'#9E9B96',fontSize:14,cursor:'pointer'}}>✕</button>
              </div>
              {l.quantities_stale&&<div style={{marginTop:6,padding:'8px 10px',background:'#FEF3C7',border:'1px solid #B45309',borderRadius:6,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{fontSize:11,color:'#B45309',fontWeight:700}}>⚠️ Material calculation was updated{l.material_calc_date?' on '+new Date(l.material_calc_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''} — plan quantities may be outdated</div>
                <button onClick={()=>updatePlanLineToLatest(idx)} style={{...btnP,background:'#B45309',padding:'4px 10px',fontSize:10}}>Update to Latest →</button>
              </div>}
              {/* Full Order vs Today's Run — per-piece table */}
              {(gt.posts+gt.panels+gt.rails+gt.caps)>0&&(()=>{
                const thCell={padding:'6px 10px',fontSize:9,fontWeight:800,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,borderBottom:'1px solid #E5E3E0',background:'#F9F8F6'};
                const tdLabel={padding:'5px 10px',fontSize:11,color:'#1A1A1A',fontWeight:600,borderBottom:'1px solid #F4F4F2'};
                const tdFull={padding:'5px 10px',fontSize:12,textAlign:'right',fontFamily:'Inter',fontWeight:700,color:'#6B6056',background:'#FAFAF8',borderBottom:'1px solid #F4F4F2'};
                const tdInput={padding:'3px 6px',textAlign:'right',borderBottom:'1px solid #F4F4F2'};
                const sectionHdr=(label)=><tr><td colSpan={3} style={{padding:'4px 10px',background:'#EFEEEB',fontSize:9,fontWeight:800,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,borderTop:'1px solid #E5E3E0',borderBottom:'1px solid #E5E3E0'}}>{label}</td></tr>;
                const pieceRow=(pt)=>{
                  const full=n(l.material?.[pt.key]);
                  if(full===0)return null;
                  const val=l.planned?.[pt.key]??'';
                  const isPartial=n(val)<full;
                  return<tr key={pt.key}>
                    <td style={tdLabel}>{pt.label}</td>
                    <td style={tdFull}>{full.toLocaleString()}</td>
                    <td style={tdInput}><input type="number" value={val} onChange={e=>updatePlanPiece(idx,pt.key,e.target.value)} placeholder="0" style={{width:80,padding:'5px 8px',fontSize:12,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:5,textAlign:'center',background:isPartial?'#FEF3C7':'#FFF'}}/></td>
                  </tr>;
                };
                const groupHas=(g)=>PLAN_PIECE_TYPES.filter(pt=>pt.group===g).some(pt=>n(l.material?.[pt.key])>0);
                return<div style={{marginTop:6,border:'1px solid #E5E3E0',borderRadius:6,overflow:'hidden'}}>
                  <div style={{padding:'6px 10px',background:'#F5F3FF',fontSize:9,fontWeight:800,color:'#7C3AED',textTransform:'uppercase',letterSpacing:0.5}}>Today's Run (adjust any quantity for partial runs)</div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>
                      <th style={{...thCell,textAlign:'left'}}>Piece Type</th>
                      <th style={{...thCell,textAlign:'right'}}>Full Order</th>
                      <th style={{...thCell,textAlign:'right'}}>Today's Run</th>
                    </tr></thead>
                    <tbody>
                      {groupHas('POSTS')&&<>{sectionHdr(`Posts${phLabel?' ('+phLabel+')':''}`)}{PLAN_PIECE_TYPES.filter(pt=>pt.group==='POSTS').map(pieceRow)}</>}
                      {groupHas('PANELS')&&<>{sectionHdr('Panels')}{PLAN_PIECE_TYPES.filter(pt=>pt.group==='PANELS').map(pieceRow)}</>}
                      {groupHas('RAILS')&&<>{sectionHdr('Rails')}{PLAN_PIECE_TYPES.filter(pt=>pt.group==='RAILS').map(pieceRow)}</>}
                      {groupHas('POST CAPS')&&<>{sectionHdr('Post Caps')}{PLAN_PIECE_TYPES.filter(pt=>pt.group==='POST CAPS').map(pieceRow)}</>}
                      {sectionHdr('Linear Feet')}
                      <tr>
                        <td style={tdLabel}>LF</td>
                        <td style={tdFull}>{n(l.material?.panels_regular)>0||n(l.material_totals?.panels)>0?(n(jobs.find(x=>x.id===l.job_id)?.lf_precast)||n(jobs.find(x=>x.id===l.job_id)?.total_lf)||n(l.planned_lf)||0).toLocaleString():'—'}</td>
                        <td style={tdInput}><input type="number" value={l.planned_lf} onChange={e=>updatePlanLine(idx,'planned_lf',e.target.value)} placeholder="0" style={{width:80,padding:'5px 8px',fontSize:12,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:5,textAlign:'center'}}/></td>
                      </tr>
                    </tbody>
                  </table>
                </div>;
              })()}
              <div style={{marginTop:8,display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                <label style={{fontSize:9,color:'#6B6056',fontWeight:600}}>Shift:</label>
                {['1','2','both'].map(s=><button key={s} onClick={()=>updatePlanLine(idx,'shift_assignment',s)} style={{padding:'3px 8px',border:l.shift_assignment===s?'2px solid #7C3AED':'1px solid #E5E3E0',background:l.shift_assignment===s?'#EDE9FE':'#FFF',borderRadius:4,fontSize:10,fontWeight:700,color:l.shift_assignment===s?'#7C3AED':'#6B6056',cursor:'pointer'}}>{s==='both'?'Both':'Shift '+s}</button>)}
              </div>
              {partial&&<div style={{marginTop:8,padding:'8px 10px',background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:6}}>
                <label style={{display:'block',fontSize:9,color:'#B45309',fontWeight:800,textTransform:'uppercase',marginBottom:3}}>⚡ Partial run reason (required)</label>
                <input value={l.partial_run_reason} onChange={e=>updatePlanLine(idx,'partial_run_reason',e.target.value)} placeholder="Why is today's run less than the full order?" style={{...inputS,padding:'6px 8px',fontSize:11,background:'#FFF'}}/>
              </div>}
              <div style={{marginTop:6}}>
                <input value={l.notes} onChange={e=>updatePlanLine(idx,'notes',e.target.value)} placeholder="Notes..." style={{...inputS,padding:'5px 8px',fontSize:11}}/>
              </div>
            </div>;
          })}
          {planLines.length===0&&<div style={{textAlign:'center',padding:32,color:'#9E9B96',fontSize:12}}>
            <div style={{fontSize:24,marginBottom:6}}>📋</div>
            <div style={{fontWeight:700,color:'#6B6056',marginBottom:4}}>No plan yet — add jobs from the queue</div>
          </div>}
        </div>

        {/* Plan summary + save */}
        {planLines.length>0&&<>
          <div style={{marginTop:12,padding:10,background:'#FDF4F4',borderRadius:8,display:'flex',gap:16,fontSize:11,fontWeight:600,color:'#8B2020',flexWrap:'wrap'}}>
            <span>Jobs: <b>{planTotals.count}</b></span>
            <span>Panels: <b>{planTotals.panels.toLocaleString()}</b></span>
            <span>Posts: <b>{planTotals.posts.toLocaleString()}</b></span>
            <span>Rails: <b>{planTotals.rails.toLocaleString()}</b></span>
            <span>Caps: <b>{planTotals.caps.toLocaleString()}</b></span>
            <span>LF: <b>{planTotals.lf.toLocaleString()}</b></span>
            <span>CYD: <b>{planTotals.cy.toFixed(1)}</b> / {dailyCyCap} ({cyPct}%)</span>
          </div>
          <div style={{marginTop:10}}>
            <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Plan Notes</label>
            <textarea value={planNotes} onChange={e=>setPlanNotes(e.target.value)} rows={2} placeholder="General notes for the day..." style={{...inputS,resize:'vertical'}}/>
          </div>
        </>}
        <button onClick={savePlan} disabled={savingPlan||planLines.length===0} style={{...btnP,background:'#8B2020',width:'100%',padding:'12px 0',marginTop:12,fontSize:14,opacity:savingPlan||planLines.length===0?0.5:1}}>{savingPlan?'Saving...':planId?'Update Plan':'Save Plan'}</button>
      </div>
    </div>

    {/* LEADERSHIP VIEW — collapsed */}
    <div style={{...card,marginTop:16,padding:0,overflow:'hidden'}}>
      <button onClick={()=>setLeadershipOpen(!leadershipOpen)} style={{width:'100%',padding:'12px 16px',background:'#F9F8F6',border:'none',textAlign:'left',cursor:'pointer',fontSize:13,fontWeight:800,color:'#1A1A1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>📊 Mold Utilization & Capacity (Leadership View)</span>
        <span style={{color:'#9E9B96'}}>{leadershipOpen?'▲':'▼'}</span>
      </button>
      {leadershipOpen&&<div style={{padding:16,borderTop:'1px solid #E5E3E0'}}>
        <div style={{fontSize:11,color:'#6B6056',marginBottom:10}}>Physical mold sets — {totalMoldsOwned} total molds across {physicalMolds.length} sets</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{borderBottom:'1px solid #E5E3E0'}}>{['Style','Molds','Panels/Mold','Capacity','In Use','Available','Utilization'].map((h,i)=><th key={h} style={{textAlign:i===0?'left':i===6?'left':'right',padding:'6px 8px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>
            {leadershipTable.map(r=>{
              if(!r.confirmed)return<tr key={r.style} style={{borderBottom:'1px solid #F4F4F2',background:'#FAFAF8'}}>
                <td style={{padding:'6px 8px',fontWeight:600}}>{r.label}</td>
                <td style={{padding:'6px 8px',textAlign:'right'}}>{r.molds}</td>
                <td style={{padding:'6px 8px',textAlign:'right',color:'#6B7280',fontWeight:700}}>[?]</td>
                <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#6B7280'}}>TBD</td>
                <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:r.inUse>0?'#1A1A1A':'#9E9B96'}}>{r.inUse.toLocaleString()}</td>
                <td style={{padding:'6px 8px',textAlign:'right',color:'#6B7280'}}>—</td>
                <td style={{padding:'6px 8px'}}><span style={{fontSize:10,color:'#6B7280',fontWeight:700,background:'#F4F4F2',padding:'2px 6px',borderRadius:4}}>⚙️ Verify with Max</span></td>
              </tr>;
              const col=r.pct>=70?'#B45309':'#15803D';
              return<tr key={r.style} style={{borderBottom:'1px solid #F4F4F2'}}>
                <td style={{padding:'6px 8px',fontWeight:600}}>{r.label}</td>
                <td style={{padding:'6px 8px',textAlign:'right'}}>{r.molds}</td>
                <td style={{padding:'6px 8px',textAlign:'right',color:'#9E9B96'}}>{r.panelsPerMold}</td>
                <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#7C3AED'}}>{r.capacity.toLocaleString()}</td>
                <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:r.inUse>0?'#1A1A1A':'#9E9B96'}}>{r.inUse.toLocaleString()}</td>
                <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:r.available===0?'#B45309':'#1A1A1A'}}>{r.available.toLocaleString()}</td>
                <td style={{padding:'6px 8px'}}>{r.notPlanned?<span style={{fontSize:10,color:'#9E9B96',fontStyle:'italic'}}>Not planned</span>:<div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{flex:1,height:6,background:'#E5E3E0',borderRadius:3,overflow:'hidden',maxWidth:120}}><div style={{width:`${Math.min(r.pct,100)}%`,height:'100%',background:col}}/></div>
                  <span style={{fontSize:10,fontWeight:700,color:col,minWidth:32}}>{r.pct}%</span>
                </div>}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {leadershipTable.some(r=>!r.confirmed)&&<div style={{marginTop:8,padding:'6px 10px',background:'#F4F4F2',border:'1px solid #D1CEC9',borderRadius:6,fontSize:10,color:'#6B6056'}}>
          ⚙️ Vertical Wood panels/mold needs confirmation from Max. Total capacity excludes Vertical Wood until verified.
        </div>}
        <div style={{marginTop:10,padding:10,background:'#F9F8F6',borderRadius:6,fontSize:11,color:'#6B6056'}}>
          <b style={{color:'#1A1A1A'}}>Batch Plant:</b> {planTotals.cy.toFixed(1)} / {dailyCyCap} CYD ({cyPct}%) · 2× WIGGERT HPGM 500 · 60 batches/shift × 0.44 CYD
        </div>
      </div>}
    </div>
  </div>);
}

/* ═══ DAILY REPORT PAGE ═══ */
function DailyReportPage({jobs,onNav,refreshKey=0}){
  const[tab,setTab]=useState('actuals');
  const[toast,setToast]=useState(null);
  // Produced line items for per-line planned display
  const[drLineItems,setDrLineItems]=useState([]);
  useEffect(()=>{sbGet('job_line_items','select=*&is_produced=eq.true&order=line_number.asc&limit=2000').then(d=>setDrLineItems(d||[])).catch(()=>{});},[refreshKey]);
  const drLineItemsByJob=useMemo(()=>{const m={};drLineItems.forEach(li=>{if(!li.job_number)return;if(!m[li.job_number])m[li.job_number]=[];m[li.job_number].push(li);});return m;},[drLineItems]);
  // Per-split actual LF state for multi-line-item jobs — key: `${idx}-${line_item_id}` → entered value
  const[lfSplitActuals,setLfSplitActuals]=useState({});
  // Tomorrow + today date helpers
  const tomorrowISO=(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().split('T')[0];})();
  const todayISO=new Date().toISOString().split('T')[0];
  // Helpers to shift dates
  const shiftDate=(iso,delta)=>{const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+delta);return d.toISOString().split('T')[0];};
  const fmtDateLabel=(iso)=>new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});

  // ─── PLAN TAB STATE ───
  const[planDate,setPlanDate]=useState(tomorrowISO);
  const[planId,setPlanId]=useState(null);
  const[planLines,setPlanLines]=useState([]);
  const[planNotes,setPlanNotes]=useState('');
  const[savingPlan,setSavingPlan]=useState(false);
  const[showAddPicker,setShowAddPicker]=useState(false);
  const[jobSearch,setJobSearch]=useState('');

  // ─── ACTUALS TAB STATE ───
  const[actualsDate,setActualsDate]=useState(todayISO);
  const[shift,setShift]=useState(1);
  const[loggedBy,setLoggedBy]=useState('Luis Rodriguez');
  const[crewSize,setCrewSize]=useState('');
  const[actualsLines,setActualsLines]=useState([]);
  const[actualsNotes,setActualsNotes]=useState('');
  const[actualsPlanId,setActualsPlanId]=useState(null);
  const[submittingActuals,setSubmittingActuals]=useState(false);
  const[showUnplanPicker,setShowUnplanPicker]=useState(false);
  const[unplanSearch,setUnplanSearch]=useState('');
  const[shiftSubs,setShiftSubs]=useState({1:null,2:null});  // {1: {count, submittedAt, lines[]}, 2: ...}
  const[editingShift,setEditingShift]=useState(false);
  const[removeConfirmIdx,setRemoveConfirmIdx]=useState(null); // which line is in "confirm remove" state
  const[removeBusyIdx,setRemoveBusyIdx]=useState(null); // which line is currently PATCHing
  const[removeReason,setRemoveReason]=useState(''); // selected reason for the pending removal
  const[removeNotes,setRemoveNotes]=useState(''); // optional notes for the pending removal
  // ─── CARRY FORWARD STATE ───
  const[carryForward,setCarryForward]=useState([]);
  // Pick up cross-page handoff (e.g. "View Tomorrow's Plan" from Production Orders)
  useEffect(()=>{try{const raw=localStorage.getItem('fc_daily_goto');if(raw){const g=JSON.parse(raw);if(g.tab==='actuals'||g.tab==='history')setTab(g.tab);if(g.date&&g.tab==='actuals')setActualsDate(g.date);localStorage.removeItem('fc_daily_goto');}}catch(e){}},[]);

  // ─── HISTORY TAB STATE ───
  const[histRange,setHistRange]=useState('week');
  const[histShift,setHistShift]=useState('');
  const[histPlans,setHistPlans]=useState([]);const[histPlanLines,setHistPlanLines]=useState([]);
  const[histActuals,setHistActuals]=useState([]);
  const[histLoading,setHistLoading]=useState(false);
  const[expandedDate,setExpandedDate]=useState(null);

  // ─── CAPACITY DATA (molds + plant config + styles) ───
  const[moldInventory,setMoldInventory]=useState([]);
  const[plantCfg,setPlantCfg]=useState({});
  const[calcStyles,setCalcStyles]=useState([]);
  useEffect(()=>{
    sbGet('mold_inventory','select=style_name,total_molds,mold_type').then(d=>setMoldInventory(d||[]));
    sbGet('plant_config','select=key,value').then(d=>{const m={};(d||[]).forEach(r=>{m[r.key]=n(r.value);});setPlantCfg(m);});
    sbGet('material_calc_styles','select=style_name,cy_per_panel,cy_per_post,cy_per_cap_rail').then(d=>setCalcStyles(d||[]));
  },[]);
  const stylesByName=useMemo(()=>{const m={};calcStyles.forEach(s=>{m[s.style_name]=s;});return m;},[calcStyles]);
  // Only count physical mold sets — exclude child styles that share a parent's molds
  const physicalMolds=useMemo(()=>moldInventory.filter(r=>n(r.total_molds)>0&&!isChildStyle(r.style_name)),[moldInventory]);
  const moldsByStyle=useMemo(()=>{const m={};physicalMolds.forEach(r=>{m[r.style_name]=n(r.total_molds);});return m;},[physicalMolds]);
  // Vertical Wood uses 1 panel per mold (full height panel); all other styles use 12 panels/mold
  const panelsPerMoldForStyle=useCallback((style)=>panelsPerMoldLookup(style),[]);
  const MOLD_UTIL_RATE=n(plantCfg.mold_utilization_rate)||0.88;
  const SCRAP_RATE=n(plantCfg.scrap_rate_warm)||0.03;
  const ACCESSORY_MULT=n(plantCfg.accessory_overhead_multiplier)||1.4;
  // moldsForStyle canonicalizes first, then looks up the parent's physical mold count
  const moldsForStyle=useCallback((style)=>{if(!style)return 0;const c=canonicalStyle(style);if(moldsByStyle[c])return moldsByStyle[c];const k=Object.keys(moldsByStyle).find(key=>key.toLowerCase().includes((c||'').toLowerCase())||(c||'').toLowerCase().includes(key.toLowerCase()));return k?moldsByStyle[k]:0;},[moldsByStyle]);
  // mold_capacity_panels = molds × panels × util_rate (uses parent's molds via canonicalStyle)
  const moldCapacityPanels=useCallback((style)=>{const molds=moldsForStyle(style);const ppm=panelsPerMoldForStyle(canonicalStyle(style));if(ppm==null)return 0;return Math.floor(molds*ppm*MOLD_UTIL_RATE);},[moldsForStyle,panelsPerMoldForStyle,MOLD_UTIL_RATE]);
  // panels_per_day = molds × panels × 0.88 / 1.03 (scrap adjustment)
  const panelsPerDayForStyle=useCallback((style)=>{const molds=moldsForStyle(style);const ppm=panelsPerMoldForStyle(canonicalStyle(style));if(ppm==null)return 0;return Math.floor((molds*ppm*MOLD_UTIL_RATE)/(1+SCRAP_RATE));},[moldsForStyle,panelsPerMoldForStyle,MOLD_UTIL_RATE,SCRAP_RATE]);
  // CYD = panels × cy_per_panel × 1.4 (1.4 accessory multiplier covers posts/rails/caps)
  const cyForLine=useCallback((l)=>{
    const panels=sumGroup(l.planned,'PANELS');
    const sRow=stylesByName[l.style]||{};
    const cyPanel=n(sRow.cy_per_panel);
    return panels*cyPanel*ACCESSORY_MULT;
  },[stylesByName,ACCESSORY_MULT]);
  // Physical molds owned = sum across non-child rows only (≈113 not 273)
  const totalMoldsOwned=useMemo(()=>physicalMolds.reduce((s,r)=>s+n(r.total_molds),0)||n(plantCfg.total_molds),[physicalMolds,plantCfg]);
  // Total panel capacity across physical mold sets only
  const totalPanelCapacity=useMemo(()=>physicalMolds.reduce((s,r)=>{const ppm=panelsPerMoldForStyle(r.style_name);if(ppm==null)return s;return s+Math.floor(n(r.total_molds)*ppm*MOLD_UTIL_RATE);},0),[physicalMolds,panelsPerMoldForStyle,MOLD_UTIL_RATE]);
  const dailyCyCap=n(plantCfg.daily_cy_capacity)||52.8;

  // Mold utilization grouped by PHYSICAL mold set (canonical style) — combined planned panels across all child styles
  const moldUsageByStyle=useMemo(()=>{
    const m={};
    planLines.forEach(l=>{
      const canonical=canonicalStyle(l.style||'—');
      if(!m[canonical]){
        const children=MOLD_CHILDREN[canonical]||[];
        const ppm=panelsPerMoldForStyle(canonical);
        m[canonical]={style:canonical,label:children.length>0?`${canonical} / ${children.join(' / ')}`:canonical,panels:0,capacity:moldCapacityPanels(canonical),molds:moldsForStyle(canonical),panelsPerMold:ppm,confirmed:ppm!=null,childStyles:[...children,canonical],actualStyles:new Set()};
      }
      m[canonical].panels+=sumGroup(l.planned,'PANELS');
      if(l.style)m[canonical].actualStyles.add(l.style);
    });
    return Object.values(m).filter(x=>x.panels>0||x.capacity>0).sort((a,b)=>b.panels-a.panels);
  },[planLines,moldCapacityPanels,moldsForStyle,panelsPerMoldForStyle]);
  const totalPanelsPlanned=useMemo(()=>planLines.reduce((s,l)=>s+sumGroup(l.planned,'PANELS'),0),[planLines]);
  const totalCyPlanned=useMemo(()=>planLines.reduce((s,l)=>s+cyForLine(l),0),[planLines,cyForLine]);

  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)).sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||'')),[jobs]);
  const prodOrderJobs=useMemo(()=>jobs.filter(j=>j.material_calc_date&&['contract_review','production_queue','in_production','inventory_ready'].includes(j.status)).sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999')),[jobs]);
  const jobSearchResults=jobSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,8):[];
  const unplanSearchResults=unplanSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(unplanSearch.toLowerCase())).slice(0,8):[];

  // ─── MATERIAL GROUP TOTALS HELPER ───
  const groupTotals=useCallback((j)=>({
    posts:n(j?.material_posts_line)+n(j?.material_posts_corner)+n(j?.material_posts_stop),
    panels:n(j?.material_panels_regular)+n(j?.material_panels_half)+n(j?.material_panels_bottom)+n(j?.material_panels_top),
    rails:n(j?.material_rails_regular)+n(j?.material_rails_top)+n(j?.material_rails_bottom)+n(j?.material_rails_center),
    caps:n(j?.material_caps_line)+n(j?.material_caps_stop),
  }),[]);

  const buildPlanLine=useCallback((job,existing)=>{
    const gt=groupTotals(job);
    const material={
      posts_line:n(job?.material_posts_line),posts_corner:n(job?.material_posts_corner),posts_stop:n(job?.material_posts_stop),
      panels_regular:n(job?.material_panels_regular),panels_half:n(job?.material_panels_half),panels_bottom:n(job?.material_panels_bottom),panels_top:n(job?.material_panels_top),
      rails_regular:n(job?.material_rails_regular),rails_top:n(job?.material_rails_top),rails_bottom:n(job?.material_rails_bottom),rails_center:n(job?.material_rails_center),
      caps_line:n(job?.material_caps_line),caps_stop:n(job?.material_caps_stop),
    };
    // Per-piece planned object — each piece independently editable
    const planned={};PLAN_PIECE_KEYS.forEach(k=>{const dbCol='planned_'+k;const existingVal=existing?.[dbCol];planned[k]=existingVal!=null?String(existingVal):(n(material[k])?String(n(material[k])):'');});
    const savedCalcDate=existing?.material_calc_date_at_plan||null;
    const currentCalcDate=job?.material_calc_date||null;
    const staleFromDB=!!existing?.quantities_stale;
    const staleFromCompare=!!(savedCalcDate&&currentCalcDate&&new Date(currentCalcDate).getTime()>new Date(savedCalcDate).getTime());
    return{
      id:existing?.id||null,
      job_id:job?.id||existing?.job_id||null,
      job_number:job?.job_number||existing?.job_number||'',
      job_name:job?.job_name||existing?.job_name||'',
      style:job?.style||existing?.style||'',
      color:job?.color||existing?.color||'',
      height:job?.height_precast||existing?.height||'',
      post_height:n(job?.material_post_height)||0,
      material_calc_date:currentCalcDate,
      material,
      material_totals:gt,
      planned,
      planned_lf:existing?.planned_lf!=null?String(existing.planned_lf):(lfPC(job)?String(lfPC(job)):''),
      partial_run_reason:existing?.partial_run_reason||'',
      notes:existing?.notes||'',
      material_calc_date_at_plan:existing?existing.material_calc_date_at_plan||null:currentCalcDate,
      quantities_stale:staleFromDB||staleFromCompare,
    };
  },[groupTotals]);

  // ─── LOAD PLAN FOR SELECTED DATE ───
  const loadPlan=useCallback(async(date)=>{
    try{
      const plans=await sbGet('production_plans',`plan_date=eq.${date}&select=*&limit=1`);
      if(plans&&plans[0]){
        setPlanId(plans[0].id);
        setPlanNotes(plans[0].plan_notes||'');
        const lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&order=sort_order.asc`);
        // Pass raw DB row as "existing" so buildPlanLine picks up all per-piece planned_* columns
        setPlanLines((lines||[]).map(l=>{
          const job=jobs.find(x=>x.id===l.job_id);
          return buildPlanLine(job||{id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style,color:l.color,height_precast:l.height,total_lf:l.planned_lf},l);
        }));
      }else{
        setPlanId(null);setPlanLines([]);setPlanNotes('');
      }
    }catch(e){console.error('Load plan failed:',e);setPlanId(null);setPlanLines([]);setPlanNotes('');}
  },[jobs,buildPlanLine]);
  useEffect(()=>{if(tab==='plan')loadPlan(planDate);},[tab,planDate,loadPlan]);

  // ─── PIECE TYPE DEFINITIONS (for per-piece actuals) ───
  const PIECE_TYPES=useMemo(()=>[
    {group:'POSTS',key:'posts_line',label:'Line Posts',jobCol:'material_posts_line'},
    {group:'POSTS',key:'posts_corner',label:'Corner Posts',jobCol:'material_posts_corner'},
    {group:'POSTS',key:'posts_stop',label:'Stop Posts',jobCol:'material_posts_stop'},
    {group:'PANELS',key:'panels_regular',label:'Regular Panels',jobCol:'material_panels_regular'},
    {group:'PANELS',key:'panels_half',label:'Half Panels',jobCol:'material_panels_half'},
    {group:'PANELS',key:'panels_bottom',label:'Bottom Panels',jobCol:'material_panels_bottom'},
    {group:'PANELS',key:'panels_top',label:'Top Panels',jobCol:'material_panels_top'},
    {group:'RAILS',key:'rails_regular',label:'Cap Rails',jobCol:'material_rails_regular'},
    {group:'RAILS',key:'rails_top',label:'Top Rails',jobCol:'material_rails_top'},
    {group:'RAILS',key:'rails_bottom',label:'Bottom Rails',jobCol:'material_rails_bottom'},
    {group:'RAILS',key:'rails_center',label:'Center Rails',jobCol:'material_rails_center'},
    {group:'POST CAPS',key:'caps_line',label:'Line Caps',jobCol:'material_caps_line'},
    {group:'POST CAPS',key:'caps_stop',label:'Stop Caps',jobCol:'material_caps_stop'},
  ],[]);

  const buildActualsLine=useCallback((opts)=>{
    const{plan_line_id,job,planned_lf,unplanned,planLineRow}=opts;
    // Resolve job from live jobs array if caller passed a plan-line-stub (which has no material_* fields)
    const liveJob=job?.material_posts_line!=null||job?.material_panels_regular!=null?job:(jobs.find(x=>x.id===(job?.id||planLineRow?.job_id))||job);
    const planned={};const actual={};
    // Prefer per-piece planned values from the plan_line row; fall back to job's full material order
    PIECE_TYPES.forEach(pt=>{
      const fromPlan=planLineRow?.['planned_'+pt.key];
      const hasPlanVal=fromPlan!=null&&fromPlan!=='';
      planned[pt.key]=hasPlanVal?n(fromPlan):n(liveJob?.[pt.jobCol])||0;
      actual[pt.key]='';
    });
    return{
      plan_line_id:plan_line_id||null,
      job_id:liveJob?.id||job?.id||null,
      job_number:liveJob?.job_number||job?.job_number||planLineRow?.job_number||'',
      job_name:liveJob?.job_name||job?.job_name||planLineRow?.job_name||'',
      style:liveJob?.style||job?.style||planLineRow?.style||'',
      color:liveJob?.color||job?.color||planLineRow?.color||'',
      height:liveJob?.height_precast||job?.height_precast||planLineRow?.height||'',
      post_height:n(planLineRow?.planned_post_height)||n(liveJob?.material_post_height)||0,
      planned,actual,
      planned_lf:n(planLineRow?.planned_lf)||n(planned_lf)||n(liveJob?.total_lf)||0,
      actual_lf:'',
      adjustment_reason:'',
      notes:'',
      unplanned:!!unplanned,
    };
  },[PIECE_TYPES,jobs]);

  // ─── LOAD PLAN FOR ACTUALS TAB ───
  const loadActualsPlan=useCallback(async(date)=>{
    try{
      const plans=await sbGet('production_plans',`plan_date=eq.${date}&select=*&limit=1`);
      if(plans&&plans[0]){
        setActualsPlanId(plans[0].id);
        // Explicit column list — forces PostgREST to return per-piece columns even if schema cache is stale
        const pieceSelectCols=PIECE_TYPES.map(pt=>'planned_'+pt.key).join(',');
        const selectList=`id,plan_id,job_id,job_number,job_name,style,color,height,sort_order,planned_pieces,planned_lf,planned_post_height,${pieceSelectCols},planned_posts,planned_panels,planned_rails,planned_caps,is_partial_run,partial_run_reason,notes,material_calc_date_at_plan,quantities_stale`;
        let lines=null;
        try{lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&select=${selectList}&order=sort_order.asc`);}
        catch(e1){
          console.warn('Explicit column fetch failed, falling back to select=*',e1);
          lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&order=sort_order.asc`);
        }
        setActualsLines((lines||[]).map(l=>{
          const j=jobs.find(x=>x.id===l.job_id);
          return buildActualsLine({plan_line_id:l.id,job:j||{id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style,color:l.color,height_precast:l.height},planned_lf:l.planned_lf,unplanned:false,planLineRow:l});
        }));
      }else{
        setActualsPlanId(null);setActualsLines([]);
      }
    }catch(e){console.error('Load actuals plan failed:',e);}
  },[jobs,buildActualsLine,PIECE_TYPES]);
  useEffect(()=>{if(tab==='actuals')loadActualsPlan(actualsDate);},[tab,actualsDate,loadActualsPlan,refreshKey]);

  // ─── LOAD SHIFT SUBMISSIONS for actuals date ───
  const loadShiftSubs=useCallback(async(date)=>{
    try{
      // Explicit column list forces PostgREST to return every per-piece column
      const actualPieceCols=PIECE_TYPES.map(pt=>'actual_'+pt.key).join(',');
      const actualsSelect=`id,plan_id,plan_line_id,job_id,job_number,job_name,production_date,shift,submitted_at,${actualPieceCols},actual_lf,actual_panels,actual_posts,actual_rails,actual_caps,actual_pieces,variance_reason,adjustment_reason,notes`;
      let acts=null;
      try{acts=await sbGet('production_actuals',`production_date=eq.${date}&select=${actualsSelect}&order=submitted_at.asc`);}
      catch(e1){
        try{acts=await sbGet('production_actuals',`production_date=eq.${date}&select=${actualsSelect}&order=id.asc`);}
        catch(e2){acts=await sbGet('production_actuals',`production_date=eq.${date}&select=*`);}
      }
      const s1=[],s2=[];(acts||[]).forEach(a=>{if(n(a.shift)===1)s1.push(a);else if(n(a.shift)===2)s2.push(a);});
      setShiftSubs({
        1:s1.length>0?{count:s1.length,submittedAt:s1[s1.length-1].submitted_at||s1[s1.length-1].created_at||null,lines:s1,totalPanels:s1.reduce((s,a)=>s+n(a.actual_panels_regular)+n(a.actual_panels_half)+n(a.actual_panels_bottom)+n(a.actual_panels_top),0)}:null,
        2:s2.length>0?{count:s2.length,submittedAt:s2[s2.length-1].submitted_at||s2[s2.length-1].created_at||null,lines:s2,totalPanels:s2.reduce((s,a)=>s+n(a.actual_panels_regular)+n(a.actual_panels_half)+n(a.actual_panels_bottom)+n(a.actual_panels_top),0)}:null,
      });
    }catch(e){console.error('Load shift subs failed:',e);setShiftSubs({1:null,2:null});}
  },[PIECE_TYPES]);
  useEffect(()=>{if(tab==='actuals'){loadShiftSubs(actualsDate);setEditingShift(false);}},[tab,actualsDate,loadShiftSubs]);

  // Shift 1 actuals keyed by plan_line_id (for shift 2 "already produced" column)
  const shift1ByLine=useMemo(()=>{
    const map={};if(!shiftSubs[1])return map;
    shiftSubs[1].lines.forEach(a=>{
      const k=a.plan_line_id||a.job_id;if(!map[k]){map[k]={};PIECE_TYPES.forEach(pt=>{map[k][pt.key]=0;});map[k].lf=0;}
      PIECE_TYPES.forEach(pt=>{map[k][pt.key]+=n(a['actual_'+pt.key]);});
      map[k].lf+=n(a.actual_lf);
    });
    return map;
  },[shiftSubs,PIECE_TYPES]);

  // ─── LOAD CARRY FORWARD from previous day — per-piece remaining from cumulative actuals ───
  const loadCarryForward=useCallback(async(forDate)=>{
    try{
      const pd=new Date(forDate+'T12:00:00');pd.setDate(pd.getDate()-1);
      const prevISO=pd.toISOString().split('T')[0];
      const plans=await sbGet('production_plans',`plan_date=eq.${prevISO}&select=id&limit=1`);
      if(!plans||!plans[0]){setCarryForward([]);return;}
      const yLines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}`);
      const jobIds=[...new Set((yLines||[]).map(l=>l.job_id).filter(Boolean))];
      const actualsByJob={};
      if(jobIds.length>0){
        const idFilter=jobIds.map(id=>`job_id.eq.${id}`).join(',');
        const allActs=await sbGet('production_actuals',`or=(${idFilter})&select=job_id,${PLAN_PIECE_KEYS.map(k=>'actual_'+k).join(',')},actual_lf`);
        (allActs||[]).forEach(a=>{const jid=a.job_id;if(!actualsByJob[jid]){actualsByJob[jid]={};PLAN_PIECE_KEYS.forEach(k=>{actualsByJob[jid][k]=0;});actualsByJob[jid].lf=0;}PLAN_PIECE_KEYS.forEach(k=>{actualsByJob[jid][k]+=n(a['actual_'+k]);});actualsByJob[jid].lf+=n(a.actual_lf);});
      }
      const incomplete=(yLines||[]).map(l=>{
        const job=jobs.find(x=>x.id===l.job_id);
        const acts=actualsByJob[l.job_id]||{};
        const remaining={};let anyRemaining=false;let totalRemainingPanels=0;let totalPlannedPanels=0;let totalActualPanels=0;
        PLAN_PIECE_KEYS.forEach(k=>{
          const full=n(job?.['material_'+k]);
          const done=n(acts[k]);
          const rem=Math.max(full-done,0);
          remaining[k]=rem;
          if(rem>0&&full>0)anyRemaining=true;
          if(k.startsWith('panels_')){totalRemainingPanels+=rem;totalPlannedPanels+=full;totalActualPanels+=done;}
        });
        const fullLf=lfPC(job);
        const remainingLf=Math.max(fullLf-n(acts.lf),0);
        return{plan_line_id:l.id,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style,remaining,remainingLf,totalRemainingPanels,plannedPanels:totalPlannedPanels,actualPanels:totalActualPanels,anyRemaining,prevDate:prevISO};
      }).filter(cf=>cf.anyRemaining);
      setCarryForward(incomplete);
    }catch(e){console.error('Carry forward load failed:',e);setCarryForward([]);}
  },[jobs]);
  useEffect(()=>{if(tab==='plan')loadCarryForward(planDate);},[tab,planDate,loadCarryForward]);

  // ─── PLAN BUILDER HELPERS ───
  const addJobFromCarryForward=(cf)=>{
    const j=jobs.find(x=>x.id===cf.job_id);if(!j)return;
    if(planLines.some(l=>l.job_id===cf.job_id))return;
    const line=buildPlanLine(j,null);
    const planned={};PLAN_PIECE_KEYS.forEach(k=>{const rem=n(cf.remaining?.[k]);planned[k]=rem>0?String(rem):'0';});
    line.planned=planned;
    if(cf.remainingLf!=null)line.planned_lf=String(n(cf.remainingLf));
    setPlanLines(prev=>[...prev,line]);
    setCarryForward(prev=>prev.filter(c=>c.job_id!==cf.job_id));
  };
  // Refresh a plan line's material quantities to match current job record — clears stale flag
  const updatePlanLineToLatest=(idx)=>{
    setPlanLines(prev=>prev.map((l,i)=>{
      if(i!==idx)return l;
      const job=jobs.find(x=>x.id===l.job_id);if(!job)return l;
      const gt=groupTotals(job);
      const material={posts_line:n(job.material_posts_line),posts_corner:n(job.material_posts_corner),posts_stop:n(job.material_posts_stop),panels_regular:n(job.material_panels_regular),panels_half:n(job.material_panels_half),panels_bottom:n(job.material_panels_bottom),panels_top:n(job.material_panels_top),rails_regular:n(job.material_rails_regular),rails_top:n(job.material_rails_top),rails_bottom:n(job.material_rails_bottom),rails_center:n(job.material_rails_center),caps_line:n(job.material_caps_line),caps_stop:n(job.material_caps_stop)};
      const planned={};PLAN_PIECE_KEYS.forEach(k=>{planned[k]=n(material[k])?String(n(material[k])):'';});
      return{...l,material,material_totals:gt,post_height:n(job.material_post_height)||l.post_height,material_calc_date:job.material_calc_date||l.material_calc_date,planned,material_calc_date_at_plan:job.material_calc_date||l.material_calc_date_at_plan,quantities_stale:false};
    }));
    setToast({msg:'Plan line refreshed to latest material calc',ok:true});
  };
  const updatePlanPiece=(idx,pieceKey,val)=>setPlanLines(prev=>prev.map((l,i)=>i===idx?{...l,planned:{...l.planned,[pieceKey]:val}}:l));
  const addJobToPlan=(j)=>{
    setPlanLines(prev=>prev.some(l=>l.job_id===j.id)?prev:[...prev,buildPlanLine(j,null)]);
    setShowAddPicker(false);setJobSearch('');
  };
  // Pick up job from kanban handoff via localStorage
  useEffect(()=>{if(tab==='plan'&&jobs.length>0){try{const preId=localStorage.getItem('fc_plan_addjob');if(preId){const j=jobs.find(x=>x.id===preId);if(j)addJobToPlan(j);localStorage.removeItem('fc_plan_addjob');}}catch(e){}}},[tab,jobs]);
  const updatePlanLine=(idx,field,val)=>setPlanLines(prev=>prev.map((l,i)=>i===idx?{...l,[field]:val}:l));
  const removePlanLine=(idx)=>setPlanLines(prev=>prev.filter((_,i)=>i!==idx));
  const movePlanLine=(idx,dir)=>setPlanLines(prev=>{const n2=[...prev];const target=idx+dir;if(target<0||target>=n2.length)return n2;[n2[idx],n2[target]]=[n2[target],n2[idx]];return n2;});

  // Sum all piece totals for a single line (today's run total)
  const lineDailyTotal=(l)=>PLAN_PIECE_KEYS.reduce((s,k)=>s+n(l.planned?.[k]),0);
  const lineIsPartial=(l)=>PLAN_PIECE_KEYS.some(k=>{const full=n(l.material?.[k]);const today=n(l.planned?.[k]);return full>0&&today<full;});
  const linePanels=(l)=>sumGroup(l.planned,'PANELS');
  const linePosts=(l)=>sumGroup(l.planned,'POSTS');
  const lineRails=(l)=>sumGroup(l.planned,'RAILS');
  const lineCaps=(l)=>sumGroup(l.planned,'POST CAPS');
  const planTotals=useMemo(()=>{let pcs=0,lf=0;planLines.forEach(l=>{pcs+=lineDailyTotal(l);lf+=n(l.planned_lf);});return{pcs,lf,count:planLines.length};},[planLines]);

  const savePlan=async()=>{
    setSavingPlan(true);
    try{
      let curId=planId;
      if(curId){
        await fetch(`${SB}/rest/v1/production_plans?id=eq.${curId}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({plan_notes:planNotes||null,updated_at:new Date().toISOString()})});
        await fetch(`${SB}/rest/v1/production_plan_lines?plan_id=eq.${curId}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
      }else{
        const res=await fetch(`${SB}/rest/v1/production_plans`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({plan_date:planDate,created_by:'Max',plan_notes:planNotes||null})});
        if(!res.ok)throw new Error(await res.text());
        const saved=await res.json();curId=saved[0].id;setPlanId(curId);
      }
      if(planLines.length>0){
        const lineRows=planLines.map((l,i)=>{
          const jobForLine=jobs.find(x=>x.id===l.job_id);
          const calcAtPlan=l.material_calc_date_at_plan||jobForLine?.material_calc_date||l.material_calc_date||null;
          const pieceCols={};PLAN_PIECE_KEYS.forEach(k=>{pieceCols['planned_'+k]=n(l.planned?.[k])||0;});
          const aggCols={planned_posts:linePosts(l),planned_panels:linePanels(l),planned_rails:lineRails(l),planned_caps:lineCaps(l)};
          return{plan_id:curId,sort_order:i,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||null,color:l.color||null,height:l.height||null,planned_pieces:lineDailyTotal(l),...pieceCols,...aggCols,planned_post_height:n(l.post_height)||0,planned_lf:n(l.planned_lf)||0,is_partial_run:lineIsPartial(l),partial_run_reason:l.partial_run_reason||null,notes:l.notes||null,material_calc_date_at_plan:calcAtPlan,quantities_stale:false};
        });
        const OPTIONAL_PLAN_COLS=[...PLAN_PIECE_KEYS.map(k=>'planned_'+k),'planned_post_height','material_calc_date_at_plan','quantities_stale','shift_assignment'];
        let res2=await fetch(`${SB}/rest/v1/production_plan_lines`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(lineRows)});
        let attempts=0;let currentRows=lineRows;
        while(!res2.ok&&attempts<15){
          const errTxt=await res2.text();
          const missingCol=OPTIONAL_PLAN_COLS.find(c=>errTxt.includes(`'${c}'`)||errTxt.includes(`"${c}"`)||errTxt.includes(` ${c} `));
          if(!missingCol){throw new Error(errTxt);}
          console.warn(`Retrying production_plan_lines POST without column "${missingCol}"`);
          currentRows=currentRows.map(r=>{const c={...r};delete c[missingCol];return c;});
          res2=await fetch(`${SB}/rest/v1/production_plan_lines`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(currentRows)});
          attempts++;
        }
        if(!res2.ok)throw new Error(await res2.text());
      }
      // Auto-advance production_queue jobs → in_production
      const today2=new Date().toISOString().split('T')[0];
      for(const l of planLines){
        const j=jobs.find(x=>x.id===l.job_id);
        if(j&&j.status==='production_queue'){
          try{await fetch(`${SB}/rest/v1/jobs?id=eq.${j.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'in_production',production_start_date:j.production_start_date||today2})});
            fetch(`${SB}/functions/v1/job-stage-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{job_name:j.job_name,job_number:j.job_number,market:j.market,pm:j.pm,sales_rep:j.sales_rep,style:j.style,color:j.color,height_precast:j.height_precast,total_lf:j.total_lf,adj_contract_value:j.adj_contract_value},from_status:'production_queue',to_status:'in_production'})}).catch(()=>{});
          }catch(e){console.error('Auto-advance failed:',j.job_number,e);}
        }
      }
      setToast({msg:`Plan saved for ${planDate}`,ok:true});
      fetch(`${SB}/functions/v1/production-plan-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_date:planDate,plan_notes:planNotes,lines:planLines,totals:planTotals})}).catch(e=>console.error('Plan notification failed:',e));
    }catch(e){console.error('Save plan error:',e);setToast({msg:'Save failed: '+e.message,ok:false});}
    setSavingPlan(false);
  };

  // ─── ACTUALS HELPERS ───
  const updateActualsLine=(idx,field,val)=>setActualsLines(prev=>prev.map((l,i)=>i===idx?{...l,[field]:val}:l));
  const updateActualsPiece=(idx,key,val)=>setActualsLines(prev=>prev.map((l,i)=>i===idx?{...l,actual:{...l.actual,[key]:val}}:l));
  const removeActualsLine=(idx)=>setActualsLines(prev=>prev.filter((_,i)=>i!==idx));
  // Confirmed remove: PATCH job status back to production_queue, log the removal with reason, then drop the line from local state.
  // If the PATCH fails, do NOT remove the line — show an error toast and revert to the default Remove button.
  // If the production_removals log POST fails, still complete the removal but log to console — don't block Luis.
  const confirmRemoveActualsLine=async(idx)=>{
    const line=actualsLines[idx];if(!line)return;
    const jobId=line.job_id;const jobName=line.job_name||'Job';
    const reason=removeReason;
    const notes=removeNotes.trim()||null;
    if(!reason){setToast({msg:'Please select a reason for removal',ok:false});return;}
    if(!jobId){setActualsLines(prev=>prev.filter((_,i)=>i!==idx));setRemoveConfirmIdx(null);setRemoveReason('');setRemoveNotes('');setToast({msg:`${jobName} removed from today's log`,ok:true});return;}
    setRemoveBusyIdx(idx);
    try{
      const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${jobId}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'production_queue'})});
      if(!res.ok)throw new Error(await res.text());
      // Log the removal to production_removals — non-blocking, failures only go to console
      try{
        const logRes=await fetch(`${SB}/rest/v1/production_removals`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({
          job_id:jobId,job_number:line.job_number||null,job_name:jobName,
          removed_date:actualsDate,shift:`Shift ${shift}`,reason,removed_by:loggedBy||'Luis Rodriguez',notes
        })});
        if(!logRes.ok){const t=await logRes.text();console.error('production_removals log failed (non-blocking):',t);}
      }catch(logErr){console.error('production_removals log failed (non-blocking):',logErr);}
      // Success — drop from local state and toast
      setActualsLines(prev=>prev.filter((_,i)=>i!==idx));
      setRemoveConfirmIdx(null);
      setRemoveBusyIdx(null);
      setRemoveReason('');
      setRemoveNotes('');
      setToast({msg:`${jobName} removed and returned to Production Queue.`,ok:true});
    }catch(e){
      console.error('Remove job status PATCH failed:',e);
      setRemoveBusyIdx(null);
      setRemoveConfirmIdx(null); // revert confirmation UI back to default Remove button
      setRemoveReason('');
      setRemoveNotes('');
      setToast({msg:'Failed to update job status. Please try again.',ok:false});
    }
  };
  const REMOVAL_REASONS=['Material Shortage','Equipment Down','Customer Request / Delay','Re-prioritized','Weather','Other'];
  const addUnplannedLine=(j)=>{
    setActualsLines(prev=>[...prev,buildActualsLine({plan_line_id:null,job:j,planned_lf:0,unplanned:true})]);
    setShowUnplanPicker(false);setUnplanSearch('');
  };

  const linePlannedTotal=(l)=>PIECE_TYPES.reduce((s,pt)=>s+n(l.planned[pt.key]),0);
  const lineActualTotal=(l)=>PIECE_TYPES.reduce((s,pt)=>s+n(l.actual[pt.key]),0);
  const lineHasVariance=(l)=>PIECE_TYPES.some(pt=>{const a=n(l.actual[pt.key]);const p=n(l.planned[pt.key]);return (a>0||p>0)&&a!==p;})||(n(l.actual_lf)>0&&n(l.actual_lf)!==n(l.planned_lf));

  const actualsTotals=useMemo(()=>{let pcs=0,lf=0,plannedPcs=0,plannedLf=0;actualsLines.forEach(l=>{pcs+=lineActualTotal(l);lf+=n(l.actual_lf);plannedPcs+=linePlannedTotal(l);plannedLf+=n(l.planned_lf);});return{pcs,lf,plannedPcs,plannedLf,count:actualsLines.length};},[actualsLines,PIECE_TYPES]);
  // Shift-wide group totals (Panels / Posts / Rails / Caps) — aggregated across all actualsLines
  const shiftGroupTotals=useMemo(()=>{
    const groups={PANELS:{planned:0,actual:0},POSTS:{planned:0,actual:0},RAILS:{planned:0,actual:0},'POST CAPS':{planned:0,actual:0}};
    actualsLines.forEach(l=>{
      PIECE_TYPES.forEach(pt=>{
        if(!groups[pt.group])return;
        groups[pt.group].planned+=n(l.planned[pt.key]);
        groups[pt.group].actual+=n(l.actual[pt.key]);
      });
    });
    const lf={planned:0,actual:0};
    actualsLines.forEach(l=>{lf.planned+=n(l.planned_lf);lf.actual+=n(l.actual_lf);});
    return{...groups,LF:lf};
  },[actualsLines,PIECE_TYPES]);

  const submitActuals=async()=>{
    const toSubmit=actualsLines.filter(l=>lineActualTotal(l)>0||n(l.actual_lf)>0||l.notes);
    if(toSubmit.length===0){setToast({msg:'No actuals to submit — fill in at least one line',ok:false});return;}
    // Require adjustment reason on any line with variance
    const missingReason=toSubmit.find(l=>lineHasVariance(l)&&!l.adjustment_reason.trim());
    if(missingReason){setToast({msg:`Adjustment reason required for ${missingReason.job_name}`,ok:false});return;}
    setSubmittingActuals(true);
    try{
      const rows=toSubmit.map(l=>{
        const pieceCols={};PIECE_TYPES.forEach(pt=>{pieceCols['actual_'+pt.key]=n(l.actual[pt.key])||0;});
        // Aggregated group totals — required by the spec
        const actualPosts=n(l.actual.posts_line)+n(l.actual.posts_corner)+n(l.actual.posts_stop);
        const actualPanels=n(l.actual.panels_regular)+n(l.actual.panels_half)+n(l.actual.panels_bottom)+n(l.actual.panels_top);
        const actualRails=n(l.actual.rails_regular)+n(l.actual.rails_top)+n(l.actual.rails_bottom)+n(l.actual.rails_center);
        const actualCaps=n(l.actual.caps_line)+n(l.actual.caps_stop);
        return{production_date:actualsDate,shift:shift,logged_by:loggedBy||'Luis Rodriguez',crew_size:n(crewSize)||null,plan_id:actualsPlanId,plan_line_id:l.plan_line_id,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||null,color:l.color||null,height:l.height||null,actual_pieces:lineActualTotal(l),actual_posts:actualPosts,actual_panels:actualPanels,actual_rails:actualRails,actual_caps:actualCaps,actual_lf:n(l.actual_lf)||0,...pieceCols,adjustment_reason:l.adjustment_reason||null,variance_reason:l.adjustment_reason||null,notes:l.notes||null,unplanned:!!l.unplanned,shift_notes:actualsNotes||null,submitted_at:new Date().toISOString()};
      });
      // POST — if PostgREST rejects an unknown column, progressively strip optional columns and retry
      const OPTIONAL_COLS=['variance_reason','submitted_at','actual_posts','actual_panels','actual_rails','actual_caps','shift_notes','crew_size','unplanned'];
      let res=await fetch(`${SB}/rest/v1/production_actuals`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(rows)});
      if(!res.ok){
        const errTxt=await res.text();
        // Detect "column ... does not exist" errors and retry by stripping the offending column
        const missingCol=OPTIONAL_COLS.find(c=>errTxt.includes(`'${c}'`)||errTxt.includes(`"${c}"`)||errTxt.includes(` ${c} `));
        if(missingCol){
          console.warn(`Retrying production_actuals POST without column "${missingCol}"`);
          const cleanRows=rows.map(r=>{const c={...r};delete c[missingCol];return c;});
          res=await fetch(`${SB}/rest/v1/production_actuals`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(cleanRows)});
          if(!res.ok)throw new Error(await res.text());
        }else{
          throw new Error(errTxt);
        }
      }
      // Auto-advance in_production → inventory_ready when cumulative actuals >= planned
      try{
        const jobIds=[...new Set(toSubmit.map(l=>l.job_id).filter(Boolean))];
        for(const jobId of jobIds){
          const j=jobs.find(x=>x.id===jobId);
          if(!j||j.status!=='in_production')continue;
          const allActuals=await sbGet('production_actuals',`job_id=eq.${jobId}&select=actual_pieces`);
          const totalActual=(allActuals||[]).reduce((s,a)=>s+n(a.actual_pieces),0);
          const allPlanned=await sbGet('production_plan_lines',`job_id=eq.${jobId}&select=planned_pieces`);
          const maxPlanned=Math.max(...(allPlanned||[]).map(l=>n(l.planned_pieces)),0);
          if(maxPlanned>0&&totalActual>=maxPlanned){
            const today3=new Date().toISOString().split('T')[0];
            await fetch(`${SB}/rest/v1/jobs?id=eq.${jobId}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'inventory_ready',inventory_ready_date:today3})});
            fetch(`${SB}/functions/v1/job-stage-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{job_name:j.job_name,job_number:j.job_number,market:j.market,pm:j.pm,sales_rep:j.sales_rep,style:j.style,color:j.color,height_precast:j.height_precast,total_lf:j.total_lf,adj_contract_value:j.adj_contract_value},from_status:'in_production',to_status:'inventory_ready'})}).catch(()=>{});
          }
        }
      }catch(e){console.error('Auto-advance inventory check failed:',e);}
      setToast({msg:`Shift ${shift} report submitted for ${actualsDate}`,ok:true});
      fetch(`${SB}/functions/v1/production-actuals-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actuals_date:actualsDate,shift,logged_by:loggedBy,crew_size:crewSize,lines:toSubmit,totals:actualsTotals,shift_notes:actualsNotes})}).catch(e=>console.error('Actuals notification failed:',e));
      // Clear for next shift + refresh shift submissions
      setActualsLines(prev=>prev.map(l=>{const blankAct={};PIECE_TYPES.forEach(pt=>{blankAct[pt.key]='';});return{...l,actual:blankAct,actual_lf:'',adjustment_reason:'',notes:''};}));
      setActualsNotes('');
      setEditingShift(false);
      loadShiftSubs(actualsDate);
    }catch(e){console.error('Submit actuals error:',e);setToast({msg:'Submit failed: '+e.message,ok:false});}
    setSubmittingActuals(false);
  };

  // ─── HISTORY ───
  const fetchHistory=useCallback(async()=>{
    setHistLoading(true);
    try{
      let fromDate=new Date();
      if(histRange==='today'){/* today only */}
      else if(histRange==='week'){fromDate.setDate(fromDate.getDate()-7);}
      else if(histRange==='month'){fromDate.setDate(fromDate.getDate()-30);}
      else{fromDate.setDate(fromDate.getDate()-30);}
      const fromISO=fromDate.toISOString().split('T')[0];
      let q=`production_date=gte.${fromISO}&order=production_date.desc,shift.asc`;
      if(histShift)q+=`&shift=eq.${histShift}`;
      const acts=await sbGet('production_actuals',q);
      setHistActuals(acts||[]);
      const plns=await sbGet('production_plans',`plan_date=gte.${fromISO}&order=plan_date.desc`);
      setHistPlans(plns||[]);
      const planLineData=await sbGet('production_plan_lines','select=id,planned_pieces,plan_id&limit=1000');
      setHistPlanLines(planLineData||[]);
    }catch(e){console.error('Fetch history error:',e);}
    setHistLoading(false);
  },[histRange,histShift]);
  useEffect(()=>{if(tab==='history')fetchHistory();},[tab,fetchHistory]);

  const histStats=useMemo(()=>{const planLineMap={};histPlanLines.forEach(l=>{planLineMap[l.id]=n(l.planned_pieces);});let totalPcs=0,totalLf=0,totalPlanned=0;const byDate={};histActuals.forEach(a=>{const planned=planLineMap[a.plan_line_id]||0;const d=a.production_date;totalPcs+=n(a.actual_pieces);totalLf+=n(a.actual_lf);totalPlanned+=planned;if(!byDate[d])byDate[d]={date:d,s1Pcs:0,s2Pcs:0,totalPcs:0,totalLf:0,totalPlanned:0,lines:[]};byDate[d].lines.push({...a,planned_pieces:planned});byDate[d].totalPcs+=n(a.actual_pieces);byDate[d].totalLf+=n(a.actual_lf);byDate[d].totalPlanned+=planned;if(a.shift===1)byDate[d].s1Pcs+=n(a.actual_pieces);if(a.shift===2)byDate[d].s2Pcs+=n(a.actual_pieces);});const daily=Object.values(byDate).sort((a,b)=>(b.date||'').localeCompare(a.date||''));const achievement=totalPlanned>0?Math.round(totalPcs/totalPlanned*100):0;const byStyle={};histActuals.forEach(a=>{const s=a.style||'—';if(!byStyle[s])byStyle[s]={style:s,pcs:0,lf:0};byStyle[s].pcs+=n(a.actual_pieces);byStyle[s].lf+=n(a.actual_lf);});return{totalPcs,totalLf,totalPlanned,achievement,daily,byStyle:Object.values(byStyle).sort((a,b)=>b.pcs-a.pcs),daysReported:daily.length};},[histActuals,histPlanLines]);

  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.msg} isError={typeof toast==='object'&&!toast.ok} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:16}}>Production Daily Report</h1>
    {/* Tabs */}
    <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'2px solid #E5E3E0'}}>
      {[['actuals','✅ Log Actuals','#8B2020'],['history','📊 History','#0F766E']].map(([k,l,c])=><button key={k} onClick={()=>setTab(k)} style={{padding:'10px 20px',border:'none',background:'transparent',color:tab===k?c:'#6B6056',fontWeight:tab===k?700:400,fontSize:14,cursor:'pointer',borderBottom:tab===k?`3px solid ${c}`:'3px solid transparent',marginBottom:-2}}>{l}</button>)}
    </div>


    {/* ═══ TAB 1: LOG ACTUALS ═══ */}
    {tab==='actuals'&&<div>
      <div style={{...card,marginBottom:16,borderTop:'3px solid #8B2020'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10,flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#8B2020'}}>Log Production Actuals</div>
            <div style={{fontSize:11,color:'#9E9B96'}}>{actualsPlanId?`Plan loaded — ${actualsLines.length} ${actualsLines.length===1?'job':'jobs'} · fill in what was actually produced`:'No production plan for this date'}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
            <button onClick={()=>setActualsDate(shiftDate(actualsDate,-1))} title="Previous day" style={{padding:'6px 10px',border:'1px solid #E5E3E0',background:'#FFF',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700,color:'#6B6056'}}>←</button>
            <input type="date" value={actualsDate} onChange={e=>setActualsDate(e.target.value)} title={fmtDateLabel(actualsDate)} style={{...inputS,width:170}}/>
            <button onClick={()=>setActualsDate(shiftDate(actualsDate,1))} title="Next day" style={{padding:'6px 10px',border:'1px solid #E5E3E0',background:'#FFF',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700,color:'#6B6056'}}>→</button>
            <button onClick={()=>setActualsDate(todayISO)} style={{padding:'6px 10px',border:actualsDate===todayISO?'2px solid #8B2020':'1px solid #E5E3E0',background:actualsDate===todayISO?'#FDF4F4':'#FFF',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:700,color:actualsDate===todayISO?'#8B2020':'#6B6056'}}>Today</button>
            <div style={{display:'flex',gap:4}}>
              {[1,2].map(s=><button key={s} onClick={()=>setShift(s)} style={{padding:'8px 16px',borderRadius:6,border:shift===s?'2px solid #8B2020':'1px solid #E5E3E0',background:shift===s?'#FDF4F4':'#FFF',color:shift===s?'#8B2020':'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>Shift {s}</button>)}
            </div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10,marginBottom:12}}>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Logged By</label><input value={loggedBy} onChange={e=>setLoggedBy(e.target.value)} style={inputS}/></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Crew Size</label><input type="number" value={crewSize} onChange={e=>setCrewSize(e.target.value)} placeholder="0" style={inputS}/></div>
        </div>
        {/* Shift status / handoff banners */}
        {shiftSubs[1]&&shiftSubs[2]&&<div style={{padding:'10px 14px',background:'#DCFCE7',border:'1px solid #15803D',borderRadius:8,marginBottom:12,fontSize:12}}>
          <div style={{fontWeight:800,color:'#15803D',marginBottom:4}}>✓ Both shifts submitted for {actualsDate}</div>
          <div style={{color:'#065F46'}}>Shift 1: <b>{shiftSubs[1].totalPanels.toLocaleString()}</b> panels + Shift 2: <b>{shiftSubs[2].totalPanels.toLocaleString()}</b> panels = <b>{(shiftSubs[1].totalPanels+shiftSubs[2].totalPanels).toLocaleString()}</b> total today</div>
        </div>}
        {shiftSubs[shift]&&!editingShift&&<div style={{padding:'12px 16px',background:'#FEF3C7',border:'1px solid #B45309',borderRadius:8,marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontWeight:800,color:'#B45309',fontSize:13}}>Shift {shift} already submitted {shiftSubs[shift].submittedAt?'at '+new Date(shiftSubs[shift].submittedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):''}</div>
            <div style={{fontSize:11,color:'#78350F',marginTop:2}}>{shiftSubs[shift].totalPanels.toLocaleString()} panels logged across {shiftSubs[shift].count} lines</div>
          </div>
          <button onClick={()=>{if(window.confirm(`Edit Shift ${shift} actuals? This will add new entries — previous entries remain in history.`))setEditingShift(true);}} style={{...btnS,padding:'6px 14px',fontSize:12}}>Edit Shift {shift} →</button>
        </div>}
        {shift===2&&shiftSubs[1]&&<div style={{padding:'10px 14px',background:'#EFF6FF',border:'1px solid #1D4ED8',borderRadius:8,marginBottom:12,fontSize:12,color:'#1D4ED8'}}>
          <b>↪ Shift handoff:</b> Shift 1 produced {shiftSubs[1].totalPanels.toLocaleString()} panels. Enter only what Shift 2 produced below — the "Already Produced" column shows Shift 1's contribution.
        </div>}
        {/* Empty state when no plan exists for the selected date */}
        {!actualsPlanId&&<div style={{...card,textAlign:'center',padding:40,background:'#F9F8F6',border:'1px dashed #D1CEC9'}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:15,fontWeight:800,color:'#1A1A1A',marginBottom:6}}>No production plan found for {new Date(actualsDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
          <div style={{fontSize:12,color:'#6B6056',marginBottom:16,maxWidth:440,margin:'0 auto 16px'}}>Max needs to save a plan for this date before actuals can be logged. You can create one now or switch to a date that already has a plan.</div>
          <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
            <button onClick={()=>{if(onNav)onNav('production_planning');window.scrollTo({top:0,behavior:'smooth'});}} style={{...btnP,padding:'10px 18px',fontSize:13}}>← Go to Production Planning</button>
            <button onClick={()=>setActualsDate(todayISO)} style={{...btnS,padding:'10px 18px',fontSize:13}}>Jump to Today</button>
          </div>
        </div>}
        {/* Actuals cards — full piece breakdown per job */}
        {actualsPlanId&&(!shiftSubs[shift]||editingShift)&&<>
        <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:12}}>
          {actualsLines.map((l,idx)=>{
            const plannedTot=linePlannedTotal(l);const actualTot=lineActualTotal(l);
            const variance=actualTot-plannedTot;
            const pct=plannedTot>0?Math.round(actualTot/plannedTot*100):0;
            const hasVar=lineHasVariance(l);
            const groups=['POSTS','PANELS','RAILS','POST CAPS'];
            const pieceIcon=(planned,act)=>{const p=n(planned),a=n(act);if(a===0&&p>0)return<span style={{color:'#991B1B',fontWeight:700}}>✗</span>;if(a===p)return<span style={{color:'#065F46',fontWeight:700}}>✓</span>;if(a<p)return<span style={{color:'#B45309',fontWeight:700}}>⚠</span>;return<span style={{color:'#1D4ED8',fontWeight:700}}>↑</span>;};
            return<div key={idx} style={{...card,padding:0,overflow:'hidden',borderLeft:l.unplanned?'3px solid #1D4ED8':'3px solid #8B2020'}}>
              {/* Header */}
              <div style={{padding:'12px 16px',background:'#F9F8F6',borderBottom:'1px solid #E5E3E0',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>{l.job_name} <span style={{color:'#9E9B96',fontWeight:500}}>— #{l.job_number}</span>{l.unplanned&&<span style={{marginLeft:6,fontSize:9,padding:'2px 6px',background:'#DBEAFE',color:'#1D4ED8',borderRadius:4,fontWeight:700,textTransform:'uppercase'}}>Unplanned</span>}</div>
                  <div style={{fontSize:11,color:'#6B6056',marginTop:2}}>{[l.style,l.color,l.height?l.height+'ft':null].filter(Boolean).join(' | ')||'—'}</div>
                  {(drLineItemsByJob[l.job_number]||[]).length>0&&<div style={{marginTop:4,display:'flex',flexDirection:'column',gap:2}}>{drLineItemsByJob[l.job_number].map(li=><div key={li.id} style={{fontSize:10,color:'#6B6056',background:'#FFF',border:'1px solid #E5E3E0',borderRadius:4,padding:'2px 6px',display:'inline-block',width:'fit-content'}}><b style={{color:'#1A1A1A'}}>{n(li.lf).toLocaleString()} LF</b> {li.height&&`@ ${li.height}ft`} {li.style} {li.color&&`· ${li.color}`}</div>)}</div>}
                </div>
                {/* Remove job — two-step confirm w/ reason capture. PATCHes job status back to production_queue on success. */}
                {removeConfirmIdx===idx?<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:10,minWidth:280,maxWidth:380}}>
                  <div style={{fontSize:11,color:'#991B1B',fontWeight:700,marginBottom:6}}>Remove and return to Production Queue?</div>
                  <label style={{display:'block',fontSize:10,color:'#991B1B',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:3}}>Reason *</label>
                  <select value={removeReason} onChange={e=>setRemoveReason(e.target.value)} disabled={removeBusyIdx===idx} style={{...inputS,padding:'6px 8px',fontSize:12,marginBottom:6}}>
                    <option value="">— Select reason —</option>
                    {REMOVAL_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
                  </select>
                  <label style={{display:'block',fontSize:10,color:'#6B6056',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:3}}>Notes (optional)</label>
                  <textarea value={removeNotes} onChange={e=>setRemoveNotes(e.target.value)} disabled={removeBusyIdx===idx} rows={2} placeholder="Additional detail..." style={{...inputS,padding:'6px 8px',fontSize:12,resize:'vertical',marginBottom:8}}/>
                  <div style={{display:'flex',gap:6}}>
                    <button disabled={removeBusyIdx===idx||!removeReason} onClick={()=>confirmRemoveActualsLine(idx)} style={{background:!removeReason?'#E5E3E0':'#991B1B',border:'none',borderRadius:6,padding:'6px 12px',color:!removeReason?'#9E9B96':'#FFF',fontSize:11,fontWeight:700,cursor:(removeBusyIdx===idx||!removeReason)?'not-allowed':'pointer',opacity:removeBusyIdx===idx?0.6:1,flex:1}}>{removeBusyIdx===idx?'Removing...':'Yes, Remove'}</button>
                    <button disabled={removeBusyIdx===idx} onClick={()=>{setRemoveConfirmIdx(null);setRemoveReason('');setRemoveNotes('');}} style={{background:'none',border:'1px solid #E5E3E0',borderRadius:6,padding:'6px 12px',color:'#6B6056',fontSize:11,cursor:'pointer'}}>Cancel</button>
                  </div>
                </div>:<button onClick={()=>{setRemoveConfirmIdx(idx);setRemoveReason('');setRemoveNotes('');}} style={{background:'none',border:'1px solid #E5E3E0',borderRadius:6,padding:'4px 10px',color:'#991B1B',fontSize:11,cursor:'pointer',fontWeight:600}}>× Remove Job</button>}
              </div>
              {/* Planned vs Actual vs Variance table */}
              {(()=>{
                const s1=shift===2?shift1ByLine[l.plan_line_id]:null;
                const showShift1=!!s1;
                const cellTh={padding:'10px 12px',fontSize:10,fontWeight:800,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,textAlign:'center',borderBottom:'1px solid #E5E3E0'};
                const cellThLeft={...cellTh,textAlign:'left'};
                const cellTd={padding:'8px 12px',fontSize:14,textAlign:'center',borderBottom:'1px solid #F4F4F2'};
                const cellLabel={...cellTd,textAlign:'left',color:'#1A1A1A',fontWeight:600,fontSize:13};
                const cellPlanned={...cellTd,background:'#F9F8F6',color:'#6B6056',fontWeight:700,fontFamily:'Inter'};
                const cellActual={...cellTd,background:'#FFF'};
                const cellVar=(plan,act)=>{const hasAct=act!==''&&act!=null;const p=n(plan),a=n(act);const v=a-p;const col=!hasAct?'#9E9B96':v===0?'#065F46':v>0?'#065F46':'#991B1B';const text=!hasAct?'—':v===0?'✓':(v>0?'+':'')+v;return{...cellTd,color:col,fontWeight:800,fontFamily:'Inter'};};
                const varText=(plan,act)=>{const hasAct=act!==''&&act!=null;const p=n(plan),a=n(act);const v=a-p;if(!hasAct)return'—';if(v===0)return'✓';return(v>0?'+':'')+v;};
                const sectionHeader=(label)=><tr><td colSpan={showShift1?5:4} style={{padding:'6px 12px',background:'#EFEEEB',fontSize:10,fontWeight:800,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,borderTop:'1px solid #E5E3E0',borderBottom:'1px solid #E5E3E0'}}>{label}</td></tr>;
                const pieceRow=(pt)=>{
                  if(n(l.planned[pt.key])===0)return null;
                  const plan=n(l.planned[pt.key]);
                  const act=l.actual[pt.key];
                  const s1val=s1?n(s1[pt.key]):0;
                  return<tr key={pt.key}>
                    <td style={cellLabel}>{pt.label}</td>
                    <td style={cellPlanned}>{plan.toLocaleString()}</td>
                    {showShift1&&<td style={{...cellTd,background:'#EFF6FF',color:'#1D4ED8',fontWeight:700}}>{s1val||'—'}</td>}
                    <td style={cellActual}><input type="number" value={act} onChange={e=>updateActualsPiece(idx,pt.key,e.target.value)} placeholder="0" style={{width:'100%',maxWidth:100,padding:'8px 10px',fontSize:16,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:6,textAlign:'center',fontFamily:'Inter'}}/></td>
                    <td style={cellVar(plan,act)}>{varText(plan,act)}</td>
                  </tr>;
                };
                const groupHasRows=(g)=>PIECE_TYPES.filter(pt=>pt.group===g).some(pt=>n(l.planned[pt.key])>0);
                return<table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'#FDF4F4'}}>
                    <th style={cellThLeft}>Piece Type</th>
                    <th style={cellTh}>Planned</th>
                    {showShift1&&<th style={{...cellTh,color:'#1D4ED8'}}>Shift 1</th>}
                    <th style={{...cellTh,color:'#8B2020'}}>Actual (Shift {shift})</th>
                    <th style={cellTh}>Variance</th>
                  </tr></thead>
                  <tbody>
                    {groupHasRows('POSTS')&&<>{sectionHeader('Posts')}
                      {PIECE_TYPES.filter(pt=>pt.group==='POSTS').map(pieceRow)}
                      {n(l.post_height)>0&&<tr>
                        <td style={cellLabel}>Post Height</td>
                        <td style={cellPlanned}>{l.post_height}ft</td>
                        {showShift1&&<td style={{...cellTd,background:'#EFF6FF'}}></td>}
                        <td style={cellTd}></td>
                        <td style={cellTd}></td>
                      </tr>}
                    </>}
                    {groupHasRows('PANELS')&&<>{sectionHeader('Panels')}
                      {PIECE_TYPES.filter(pt=>pt.group==='PANELS').map(pieceRow)}
                    </>}
                    {groupHasRows('RAILS')&&<>{sectionHeader('Rails')}
                      {PIECE_TYPES.filter(pt=>pt.group==='RAILS').map(pieceRow)}
                    </>}
                    {groupHasRows('POST CAPS')&&<>{sectionHeader('Post Caps')}
                      {PIECE_TYPES.filter(pt=>pt.group==='POST CAPS').map(pieceRow)}
                    </>}
                    {sectionHeader('Linear Feet')}
                    {(()=>{
                      const splits=drLineItemsByJob[l.job_number]||[];
                      if(splits.length<2){
                        // Single or no line items — original single-row rendering
                        return<tr>
                          <td style={cellLabel}>Linear Feet</td>
                          <td style={cellPlanned}>{n(l.planned_lf)?n(l.planned_lf).toLocaleString():'—'}</td>
                          {showShift1&&<td style={{...cellTd,background:'#EFF6FF',color:'#1D4ED8',fontWeight:700}}>{n(s1?.lf)||'—'}</td>}
                          <td style={cellActual}><input type="number" value={l.actual_lf} onChange={e=>updateActualsLine(idx,'actual_lf',e.target.value)} placeholder="0" style={{width:'100%',maxWidth:120,padding:'8px 10px',fontSize:16,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:6,textAlign:'center',fontFamily:'Inter'}}/></td>
                          <td style={cellVar(l.planned_lf,l.actual_lf)}>{varText(l.planned_lf,l.actual_lf)}</td>
                        </tr>;
                      }
                      // Multi-line-item render: one row per produced line item + an aggregated total row
                      const splitsTotalPlanned=splits.reduce((s,li)=>s+n(li.lf),0);
                      const splitsTotalActual=splits.reduce((s,li)=>s+n(lfSplitActuals[`${idx}-${li.id}`]),0);
                      const setSplit=(liId,val)=>{setLfSplitActuals(prev=>{const next={...prev,[`${idx}-${liId}`]:val};let sum=0;splits.forEach(x=>{sum+=n(next[`${idx}-${x.id}`]);});updateActualsLine(idx,'actual_lf',sum);return next;});};
                      return<>
                        {splits.map(li=>{const keyA=`${idx}-${li.id}`;const va=lfSplitActuals[keyA]||'';const lbl=`${n(li.lf).toLocaleString()} LF${li.height?` @ ${li.height}ft`:''}${li.style?` ${li.style}`:''}`;return<tr key={li.id}>
                          <td style={{...cellLabel,fontSize:11,fontWeight:600}} title={lbl}>{lbl}</td>
                          <td style={cellPlanned}>{n(li.lf).toLocaleString()}</td>
                          {showShift1&&<td style={{...cellTd,background:'#EFF6FF',color:'#9E9B96'}}>—</td>}
                          <td style={cellActual}><input type="number" value={va} onChange={e=>setSplit(li.id,e.target.value)} placeholder="0" style={{width:'100%',maxWidth:120,padding:'8px 10px',fontSize:14,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:6,textAlign:'center',fontFamily:'Inter'}}/></td>
                          <td style={cellVar(li.lf,va)}>{varText(li.lf,va)}</td>
                        </tr>;})}
                        <tr style={{background:'#F9F8F6'}}>
                          <td style={{...cellLabel,fontWeight:800,fontStyle:'italic'}}>Total LF</td>
                          <td style={{...cellPlanned,fontWeight:800}}>{splitsTotalPlanned.toLocaleString()}</td>
                          {showShift1&&<td style={{...cellTd,background:'#EFF6FF',color:'#1D4ED8',fontWeight:700}}>{n(s1?.lf)||'—'}</td>}
                          <td style={{...cellActual,fontWeight:800}}>{splitsTotalActual.toLocaleString()}</td>
                          <td style={cellVar(splitsTotalPlanned,splitsTotalActual)}>{varText(splitsTotalPlanned,splitsTotalActual)}</td>
                        </tr>
                      </>;
                    })()}
                  </tbody>
                </table>;
              })()}
              {/* Variance reason */}
              {hasVar&&<div style={{padding:'10px 16px',borderBottom:'1px solid #F4F4F2',background:'#FFFBEB'}}>
                <label style={{display:'block',fontSize:10,fontWeight:800,color:'#B45309',textTransform:'uppercase',marginBottom:4}}>⚠ Reason for variance (required)</label>
                <input value={l.adjustment_reason} onChange={e=>updateActualsLine(idx,'adjustment_reason',e.target.value)} placeholder="e.g. Mold issue, material shortage, equipment down, crew short..." style={{...inputS,background:'#FFF',fontSize:14,padding:'10px 12px'}}/>
              </div>}
              {/* Notes */}
              <div style={{padding:'10px 16px',borderBottom:'1px solid #F4F4F2'}}>
                <label style={{display:'block',fontSize:10,fontWeight:800,color:'#9E9B96',textTransform:'uppercase',marginBottom:4}}>Notes</label>
                <input value={l.notes} onChange={e=>updateActualsLine(idx,'notes',e.target.value)} placeholder="—" style={inputS}/>
              </div>
              {/* Summary */}
              {(()=>{const variancePct=plannedTot>0?Math.round((variance/plannedTot)*100):0;return<div style={{padding:'12px 16px',background:'#1A1A1A',color:'#FFF'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,marginBottom:8,fontSize:12}}>
                  <div>Total Planned: <b>{plannedTot.toLocaleString()}</b> pieces</div>
                  <div>Total Actual: <b style={{color:actualTot>=plannedTot?'#6EE7B7':'#FCD34D'}}>{actualTot.toLocaleString()}</b> pieces</div>
                  <div>Variance: <b style={{color:variance===0?'#9CA3AF':variance>0?'#6EE7B7':'#FCA5A5'}}>{variance>=0?'+':''}{variance.toLocaleString()}</b>{plannedTot>0&&<span style={{color:variance===0?'#9CA3AF':variance>0?'#6EE7B7':'#FCA5A5',marginLeft:4}}>({variancePct>=0?'+':''}{variancePct}%)</span>}</div>
                  <div><b>{pct}%</b> complete</div>
                </div>
                <div style={{height:8,background:'#374151',borderRadius:4,overflow:'hidden'}}>
                  <div style={{width:`${Math.min(pct,100)}%`,height:'100%',background:pct>=100?'#10B981':pct>=80?'#F59E0B':'#EF4444',transition:'width 0.3s'}}/>
                </div>
              </div>;})()}
            </div>;
          })}
          {actualsLines.length===0&&<div style={{textAlign:'center',padding:24,color:'#9E9B96',fontSize:12,...card}}>No lines yet. Add jobs below.</div>}
        </div>
        <button onClick={()=>setShowUnplanPicker(true)} style={{...btnS,padding:'6px 14px',fontSize:12,marginBottom:12}}>+ Add Unplanned Line</button>
        {showUnplanPicker&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:12}}>
          <input autoFocus value={unplanSearch} onChange={e=>setUnplanSearch(e.target.value)} placeholder="Search by name or number..." style={inputS}/>
          {unplanSearchResults.length>0&&<div style={{marginTop:6,maxHeight:200,overflow:'auto'}}>{unplanSearchResults.map(j=><button key={j.id} onClick={()=>addUnplannedLine(j)} style={{display:'block',width:'100%',padding:'6px 10px',marginBottom:3,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,textAlign:'left',cursor:'pointer',fontSize:12}}><b>{j.job_name}</b> <span style={{color:'#9E9B96'}}>#{j.job_number}</span></button>)}</div>}
          <button onClick={()=>{setShowUnplanPicker(false);setUnplanSearch('');}} style={{...btnS,padding:'4px 10px',fontSize:11,marginTop:6}}>Cancel</button>
        </div>}
        {/* Shift Summary — aggregated totals across all jobs */}
        {actualsLines.length>0&&(()=>{
          const g=shiftGroupTotals;
          const rows=[['Total Panels',g.PANELS],['Total Posts',g.POSTS],['Total Rails',g.RAILS],['Total Caps',g['POST CAPS']],['Total LF',g.LF]];
          const cellTh={padding:'10px 12px',fontSize:10,fontWeight:800,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,textAlign:'center',borderBottom:'1px solid #E5E3E0',background:'#FDF4F4'};
          const cellThLeft={...cellTh,textAlign:'left'};
          const cellTd={padding:'10px 12px',fontSize:14,textAlign:'center',borderBottom:'1px solid #F4F4F2',fontFamily:'Inter',fontWeight:700};
          const cellLabel={...cellTd,textAlign:'left',color:'#1A1A1A'};
          return<div style={{...card,padding:0,overflow:'hidden',marginBottom:12,borderTop:'3px solid #8B2020'}}>
            <div style={{padding:'10px 14px',background:'#8B2020',color:'#FFF',fontSize:12,fontWeight:800,textTransform:'uppercase',letterSpacing:0.5}}>📊 Shift {shift} Summary — {actualsLines.length} job{actualsLines.length===1?'':'s'}</div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={cellThLeft}></th>
                <th style={cellTh}>Planned</th>
                <th style={{...cellTh,color:'#8B2020'}}>Actual</th>
                <th style={cellTh}>Variance</th>
              </tr></thead>
              <tbody>{rows.map(([label,g2])=>{const v=g2.actual-g2.planned;const hasAct=g2.actual>0;const col=!hasAct?'#9E9B96':v===0?'#065F46':v>0?'#065F46':'#991B1B';const text=!hasAct?'—':v===0?'✓':(v>0?'+':'')+v.toLocaleString();return<tr key={label}>
                <td style={cellLabel}>{label}</td>
                <td style={{...cellTd,background:'#F9F8F6',color:'#6B6056'}}>{g2.planned.toLocaleString()}</td>
                <td style={cellTd}>{g2.actual.toLocaleString()}</td>
                <td style={{...cellTd,color:col}}>{text}</td>
              </tr>;})}</tbody>
            </table>
          </div>;
        })()}
        <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Shift Notes</label><textarea value={actualsNotes} onChange={e=>setActualsNotes(e.target.value)} rows={2} placeholder="General notes for this shift..." style={{...inputS,resize:'vertical'}}/></div>
        <button onClick={submitActuals} disabled={submittingActuals||actualsLines.length===0} style={{...btnP,width:'100%',padding:'12px 0',marginTop:12,fontSize:14,opacity:submittingActuals||actualsLines.length===0?0.5:1}}>{submittingActuals?'Submitting...':`Submit Shift ${shift} Report`}</button>
        </>}
      </div>
    </div>}

    {/* ═══ TAB 2: HISTORY ═══ */}
    {tab==='history'&&<div>
      <div style={{...card,marginBottom:16,borderTop:'3px solid #0F766E'}}>
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
          {[['today','Today'],['week','This Week'],['month','This Month']].map(([k,l])=><button key={k} onClick={()=>setHistRange(k)} style={fpill(histRange===k)}>{l}</button>)}
          <span style={{color:'#E5E3E0'}}>|</span>
          <button onClick={()=>setHistShift('')} style={fpill(!histShift)}>All Shifts</button>
          <button onClick={()=>setHistShift('1')} style={fpill(histShift==='1')}>Shift 1</button>
          <button onClick={()=>setHistShift('2')} style={fpill(histShift==='2')}>Shift 2</button>
        </div>
        {/* Summary stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #0F766E'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#0F766E'}}>{histStats.totalPcs.toLocaleString()}</div><div style={{fontSize:10,color:'#6B6056'}}>Total Pieces Produced</div></div>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #1D4ED8'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#1D4ED8'}}>{histStats.totalLf.toLocaleString()}</div><div style={{fontSize:10,color:'#6B6056'}}>Total LF Produced</div></div>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #B45309'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:histStats.achievement>=100?'#065F46':histStats.achievement>=80?'#B45309':'#991B1B'}}>{histStats.achievement}%</div><div style={{fontSize:10,color:'#6B6056'}}>Plan Achievement</div></div>
          <div style={{...card,padding:'12px 14px',borderLeft:'4px solid #6B7280'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22}}>{histStats.daysReported}</div><div style={{fontSize:10,color:'#6B6056'}}>Days Reported</div></div>
        </div>
        {/* Daily breakdown */}
        {histLoading?<div style={{padding:40,textAlign:'center',color:'#9E9B96'}}>Loading...</div>:histStats.daily.length===0?<div style={{padding:40,textAlign:'center',color:'#9E9B96'}}>No actuals reported in this range</div>:<div>
          <div style={{fontSize:12,fontWeight:700,color:'#6B6056',textTransform:'uppercase',marginBottom:8}}>Daily Breakdown</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {histStats.daily.map(d=>{const pct=d.totalPlanned>0?Math.round(d.totalPcs/d.totalPlanned*100):0;const isExp=expandedDate===d.date;return<div key={d.date} style={{...card,padding:0,overflow:'hidden'}}>
              <div onClick={()=>setExpandedDate(isExp?null:d.date)} style={{padding:'10px 14px',cursor:'pointer',display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
                <div style={{flex:'1 1 150px',fontWeight:700}}>{new Date(d.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
                <div style={{fontSize:11,color:'#6B6056'}}>S1: <b style={{color:'#1A1A1A'}}>{d.s1Pcs}</b></div>
                <div style={{fontSize:11,color:'#6B6056'}}>S2: <b style={{color:'#1A1A1A'}}>{d.s2Pcs}</b></div>
                <div style={{fontSize:12,fontWeight:800,color:'#0F766E'}}>{d.totalPcs} pcs</div>
                <div style={{fontSize:11,color:'#6B6056'}}>{d.totalLf.toLocaleString()} LF</div>
                <div style={{fontSize:11,fontWeight:700,color:pct>=100?'#065F46':pct>=80?'#B45309':'#991B1B'}}>{pct}% of plan</div>
                <span style={{color:'#9E9B96',fontSize:11}}>{isExp?'▲':'▼'}</span>
              </div>
              {isExp&&<div style={{padding:'12px 14px',borderTop:'1px solid #E5E3E0',background:'#F9F8F6'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead><tr>{['Job','Style','Color','Ht','Shift','Planned','Actual','LF','Notes'].map(h=><th key={h} style={{textAlign:'left',padding:'4px 6px',color:'#9E9B96',fontSize:10}}>{h}</th>)}</tr></thead>
                  <tbody>{d.lines.map((a,i)=><tr key={i} style={{borderBottom:'1px solid #E5E3E0',background:a.unplanned?'#EFF6FF':'transparent'}}>
                    <td style={{padding:'4px 6px',fontWeight:500}}>{a.job_name}{a.unplanned&&<span style={{color:'#1D4ED8',fontSize:9,marginLeft:4}}>[unplanned]</span>}</td>
                    <td style={{padding:'4px 6px',color:'#6B6056'}}>{a.style||'—'}</td>
                    <td style={{padding:'4px 6px',color:'#6B6056'}}>{a.color||'—'}</td>
                    <td style={{padding:'4px 6px',color:'#6B6056'}}>{a.height||'—'}</td>
                    <td style={{padding:'4px 6px'}}>{a.shift}</td>
                    <td style={{padding:'4px 6px',color:'#9E9B96'}}>{n(a.planned_pieces)||'—'}</td>
                    <td style={{padding:'4px 6px',fontWeight:700,color:n(a.actual_pieces)>=n(a.planned_pieces)?'#065F46':'#B45309'}}>{n(a.actual_pieces)||'—'}</td>
                    <td style={{padding:'4px 6px'}}>{n(a.actual_lf).toLocaleString()}</td>
                    <td style={{padding:'4px 6px',color:'#6B6056',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.notes||'—'}</td>
                  </tr>)}</tbody>
                </table>
              </div>}
            </div>;})}
          </div>
          {/* Style summary */}
          {histStats.byStyle.length>0&&<div style={{marginTop:20}}>
            <div style={{fontSize:12,fontWeight:700,color:'#6B6056',textTransform:'uppercase',marginBottom:8}}>By Style</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:'#F9F8F6'}}>{['Style','Pieces','LF'].map(h=><th key={h} style={{textAlign:'left',padding:'8px 10px',fontSize:11,color:'#6B6056',fontWeight:700,borderBottom:'1px solid #E5E3E0'}}>{h}</th>)}</tr></thead>
              <tbody>{histStats.byStyle.map(s=><tr key={s.style} style={{borderBottom:'1px solid #F4F4F2'}}>
                <td style={{padding:'8px 10px',fontWeight:500}}>{s.style}</td>
                <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{s.pcs.toLocaleString()}</td>
                <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{s.lf.toLocaleString()}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>}
      </div>
    </div>}
  </div>);
}

/* ═══ WEATHER DAYS PAGE ═══ */
function WeatherDaysPage({jobs}){
  const[days,setDays]=useState([]);const[loading,setLoading]=useState(true);const[showForm,setShowForm]=useState(false);const[editDay,setEditDay]=useState(null);
  const[mktF,setMktF]=useState(null);const[pmF,setPmF]=useState('');const[toast,setToast]=useState(null);
  const[form,setForm]=useState({job_id:'',weather_date:new Date().toISOString().split('T')[0],hours_lost:'',reason:'Rain',logged_by:'',notes:''});
  const[jobSearch,setJobSearch]=useState('');
  const fetchDays=useCallback(async()=>{const d=await sbGet('weather_days','select=*&order=weather_date.desc');setDays(d||[]);setLoading(false);},[]);
  useEffect(()=>{fetchDays();},[fetchDays]);
  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  const searchedJobs=jobSearch?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,10):[];
  const filtered=useMemo(()=>{let f=days;if(mktF)f=f.filter(d=>d.market===mktF);if(pmF)f=f.filter(d=>d.pm===pmF);return f;},[days,mktF,pmF]);
  const now=new Date();const thisMonth=filtered.filter(d=>d.weather_date&&new Date(d.weather_date).getMonth()===now.getMonth()&&new Date(d.weather_date).getFullYear()===now.getFullYear());
  const thisYear=filtered.filter(d=>d.weather_date&&new Date(d.weather_date).getFullYear()===now.getFullYear());
  const totalHours=filtered.reduce((s,d)=>s+n(d.hours_lost),0);
  const openForm=(day)=>{if(day){setForm({job_id:day.job_id||'',weather_date:day.weather_date||'',hours_lost:day.hours_lost||'',reason:day.reason||'Rain',logged_by:day.logged_by||'',notes:day.notes||''});setJobSearch(day.job_name||'');setEditDay(day);}else{setForm({job_id:'',weather_date:new Date().toISOString().split('T')[0],hours_lost:'',reason:'Rain',logged_by:'',notes:''});setJobSearch('');setEditDay(null);}setShowForm(true);};
  const saveDay=async()=>{const job=jobs.find(j=>j.id===form.job_id);const body={weather_date:form.weather_date,hours_lost:n(form.hours_lost),reason:form.reason,logged_by:form.logged_by,notes:form.notes,job_id:form.job_id,job_number:job?.job_number||editDay?.job_number||'',job_name:job?.job_name||editDay?.job_name||'',market:job?.market||editDay?.market||'',pm:job?.pm||editDay?.pm||''};if(editDay){await sbPatch('weather_days',editDay.id,body);}else{await sbPost('weather_days',body);}setShowForm(false);setEditDay(null);setToast('Weather day saved');fetchDays();};
  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Weather Days Tracker</h1>
      <button onClick={()=>openForm(null)} style={btnP}>+ Log Weather Day</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
      <KPI label="Total Weather Days" value={filtered.length}/><KPI label="Total Hours Lost" value={totalHours} color="#B45309"/><KPI label="This Month" value={thisMonth.length} color="#1D4ED8"/><KPI label="This Year" value={thisYear.length} color="#065F46"/>
    </div>
    <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
      <select value={mktF||''} onChange={e=>setMktF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Markets</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select>
      <select value={pmF} onChange={e=>setPmF(e.target.value)} style={{...inputS,width:160}}><option value="">All PMs</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
    </div>
    {loading?<div style={{color:'#9E9B96',padding:40,textAlign:'center'}}>Loading...</div>:<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 380px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Date','Job Name','Market','PM','Hours Lost','Reason','Notes','Actions'].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map(d=><tr key={d.id} onClick={()=>openForm(d)} style={{borderBottom:'1px solid #F4F4F2',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <td style={{padding:'8px 10px'}}>{fD(d.weather_date)}</td>
          <td style={{padding:'8px 10px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.job_name||'—'}</td>
          <td style={{padding:'8px 10px'}}><span style={pill(MC[d.market]||'#6B6056',MB[d.market]||'#F4F4F2')}>{MS[d.market]||'—'}</span></td>
          <td style={{padding:'8px 10px'}}>{d.pm||'—'}</td>
          <td style={{padding:'8px 10px',fontWeight:700,color:'#B45309'}}>{d.hours_lost||'—'}</td>
          <td style={{padding:'8px 10px'}}>{d.reason||'—'}</td>
          <td style={{padding:'8px 10px',color:'#9E9B96',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.notes||'—'}</td>
          <td style={{padding:'8px 10px'}} onClick={e=>e.stopPropagation()}><button onClick={()=>openForm(d)} style={{...btnS,padding:'3px 10px',fontSize:11}}>Edit</button></td>
        </tr>)}{filtered.length===0&&<tr><td colSpan={8} style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>☁</div><div style={{color:'#9E9B96',fontSize:14,marginBottom:12}}>No weather days logged yet</div><button onClick={()=>openForm(null)} style={{...btnP,fontSize:12}}>+ Log First Weather Day</button></td></tr>}</tbody></table>
    </div>}
    {showForm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowForm(false)}>
      <div style={{background:'#fff',borderRadius:16,padding:28,width:480,maxHeight:'80vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:18,fontWeight:800,marginBottom:16}}>{editDay?'Edit Weather Day':'Log Weather Day'}</div>
        <div style={{marginBottom:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Job</label><input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setForm(f=>({...f,job_id:''}));}} placeholder="Search jobs..." style={inputS}/>{jobSearch&&!form.job_id&&<div style={{border:'1px solid #E5E3E0',borderRadius:8,marginTop:4,maxHeight:150,overflow:'auto'}}>{searchedJobs.map(j=><div key={j.id} onClick={()=>{setForm(f=>({...f,job_id:j.id}));setJobSearch(`${j.job_number} - ${j.job_name}`);}} style={{padding:'6px 10px',cursor:'pointer',fontSize:12,borderBottom:'1px solid #F4F4F2'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{j.job_number} - {j.job_name}</div>)}</div>}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Date</label><input type="date" value={form.weather_date} onChange={e=>setForm(f=>({...f,weather_date:e.target.value}))} style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Hours Lost</label><select value={form.hours_lost} onChange={e=>setForm(f=>({...f,hours_lost:e.target.value}))} style={inputS}><option value="">— Select —</option>{[0.5,1,2,3,4,5,6,7,8,'8+'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Reason</label><select value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} style={inputS}>{['Rain','Wind','Lightning','Extreme Heat','Other'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Logged By</label><input value={form.logged_by} onChange={e=>setForm(f=>({...f,logged_by:e.target.value}))} style={inputS}/></div>
        </div>
        <div style={{marginBottom:16}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Notes</label><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={3} style={{...inputS,resize:'vertical'}}/></div>
        <div style={{display:'flex',gap:8}}><button onClick={saveDay} style={{...btnP,flex:1}}>{editDay?'Update':'Save'}</button><button onClick={()=>setShowForm(false)} style={btnS}>Cancel</button></div>
      </div>
    </div>}
  </div>);
}

/* ═══ CHANGE ORDERS PAGE ═══ */
function ChangeOrdersPage({jobs}){
  const[orders,setOrders]=useState([]);const[loading,setLoading]=useState(true);
  const[statusF,setStatusF]=useState(null);const[toast,setToast]=useState(null);
  const[showForm,setShowForm]=useState(false);const[editCO,setEditCO]=useState(null);
  const[coForm,setCOForm]=useState({job_id:'',co_number:'',date_submitted:new Date().toISOString().split('T')[0],amount:'',description:'',status:'Pending',approved_by:'',date_approved:'',notes:''});
  const[jobSearch,setJobSearch]=useState('');
  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)).sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||'')),[jobs]);
  const searchResults=jobSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,8):[];
  const jobsById=useMemo(()=>{const m={};jobs.forEach(j=>{m[j.id]=j;});return m;},[jobs]);
  const fetchOrders=useCallback(async()=>{const d=await sbGet('change_orders','order=created_at.desc');setOrders(d||[]);setLoading(false);},[]);
  useEffect(()=>{fetchOrders();},[fetchOrders]);
  const enriched=useMemo(()=>orders.map(o=>{const j=jobsById[o.job_id]||{};return{...o,_jobName:j.job_name||'—'};}),[orders,jobsById]);
  const filtered=useMemo(()=>{let f=enriched;if(statusF)f=f.filter(o=>o.status===statusF);return f;},[enriched,statusF]);
  const totalApproved=enriched.filter(o=>o.status==='Approved').reduce((s,o)=>s+n(o.amount),0);
  const totalPending=enriched.filter(o=>o.status==='Pending').reduce((s,o)=>s+n(o.amount),0);
  const coStatusC={Pending:['#B45309','#FEF3C7'],Approved:['#065F46','#D1FAE5'],Rejected:['#991B1B','#FEE2E2']};
  const openNew=()=>{setEditCO(null);setCOForm({job_id:'',co_number:'',date_submitted:new Date().toISOString().split('T')[0],amount:'',description:'',status:'Pending',approved_by:'',date_approved:'',notes:''});setJobSearch('');setShowForm(true);};
  const openEditCO=(o)=>{setEditCO(o);setCOForm({job_id:o.job_id,co_number:o.co_number||'',date_submitted:o.date_submitted||'',amount:o.amount||'',description:o.description||'',status:o.status||'Pending',approved_by:o.approved_by||'',date_approved:o.date_approved||'',notes:o.notes||''});setJobSearch(o._jobName||'');setShowForm(true);};
  const saveCO=async()=>{const body={job_id:coForm.job_id,co_number:coForm.co_number||null,amount:n(coForm.amount),description:coForm.description||null,status:coForm.status||'Pending',date_submitted:coForm.date_submitted||null,date_approved:coForm.date_approved||null,approved_by:coForm.approved_by||null,notes:coForm.notes||null};if(!body.job_id){setToast({message:'Select a job',isError:true});return;}try{if(editCO){await fetch(`${SB}/rest/v1/change_orders?id=eq.${editCO.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});}else{const res=await fetch(`${SB}/rest/v1/change_orders`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});if(!res.ok){const txt=await res.text();throw new Error(txt);}}setShowForm(false);fetchOrders();setToast(editCO?'Change order updated':'Change order added');}catch(e){setToast({message:e.message||'Save failed',isError:true});}};
  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Change Orders</h1>
      <button onClick={openNew} style={btnP}>+ Add Change Order</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{enriched.length}</div><div style={{fontSize:10,color:'#6B6056'}}>Total COs</div></div>
      <div style={{...card,padding:'10px 14px',borderLeft:'4px solid #065F46'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#065F46'}}>{$(totalApproved)}</div><div style={{fontSize:10,color:'#6B6056'}}>Approved</div></div>
      <div style={{...card,padding:'10px 14px',borderLeft:'4px solid #B45309'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#B45309'}}>{$(totalPending)}</div><div style={{fontSize:10,color:'#6B6056'}}>Pending</div></div>
    </div>
    <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
      <select value={statusF||''} onChange={e=>setStatusF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Statuses</option>{['Pending','Approved','Rejected'].map(s=><option key={s} value={s}>{s}</option>)}</select>
      <span style={{fontSize:12,color:'#6B6056'}}>{filtered.length} change orders</span>
    </div>
    {loading?<div style={{color:'#9E9B96',padding:40,textAlign:'center'}}>Loading...</div>:<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 340px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Job','CO#','Date Submitted','Amount','Description','Status','Approved By','Date Approved',''].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map(o=>{const[sc2,sb2]=coStatusC[o.status]||['#6B6056','#F4F4F2'];return<tr key={o.id} style={{borderBottom:'1px solid #F4F4F2',opacity:o.status==='Rejected'?0.5:1}}>
          <td style={{padding:'8px 10px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o._jobName}</td>
          <td style={{padding:'8px 10px'}}>{o.co_number||'—'}</td>
          <td style={{padding:'8px 10px'}}>{fD(o.date_submitted)}</td>
          <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700,color:o.status==='Rejected'?'#991B1B':n(o.amount)>0?'#065F46':'#1A1A1A'}}>{o.status==='Rejected'?<s>{$(o.amount)}</s>:$(o.amount)}</td>
          <td style={{padding:'8px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6B6056'}}>{o.description||'—'}</td>
          <td style={{padding:'8px 10px'}}><span style={pill(sc2,sb2)}>{o.status||'—'}</span></td>
          <td style={{padding:'8px 10px'}}>{o.approved_by||'—'}</td>
          <td style={{padding:'8px 10px'}}>{fD(o.date_approved)}</td>
          <td style={{padding:'8px 10px'}}><button onClick={()=>openEditCO(o)} style={{background:'#FDF4F4',border:'1px solid #8B202030',borderRadius:6,color:'#8B2020',fontSize:11,fontWeight:600,cursor:'pointer',padding:'3px 10px'}}>Edit</button></td>
        </tr>;})}
        {filtered.length===0&&<tr><td colSpan={9} style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>±</div><div style={{color:'#9E9B96',fontSize:14}}>No change orders found</div></td></tr>}</tbody></table>
    </div>}
    {/* CO Form Modal */}
    {showForm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowForm(false)}>
      <div style={{background:'#FFF',borderRadius:16,padding:24,width:520,maxWidth:'94vw',maxHeight:'92vh',overflow:'auto',boxShadow:'0 8px 30px rgba(0,0,0,0.18)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:18,fontWeight:800,color:'#1A1A1A',marginBottom:16}}>{editCO?'Edit Change Order':'Add Change Order'}</div>
        <div style={{marginBottom:12,position:'relative'}}>
          <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Job *</label>
          <input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);if(coForm.job_id)setCOForm(p=>({...p,job_id:''}));}} placeholder="Search by name or number..." style={inputS} disabled={!!editCO}/>
          {searchResults.length>0&&!coForm.job_id&&!editCO&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:10,maxHeight:200,overflow:'auto'}}>
            {searchResults.map(j=><button key={j.id} onClick={()=>{setCOForm(p=>({...p,job_id:j.id}));setJobSearch(j.job_name);}} style={{display:'block',width:'100%',padding:'8px 12px',border:'none',background:'transparent',textAlign:'left',cursor:'pointer',fontSize:12,borderBottom:'1px solid #F4F4F2'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF4F4'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><span style={{fontWeight:600}}>{j.job_name}</span> <span style={{color:'#9E9B96'}}>#{j.job_number}</span></button>)}
          </div>}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>CO Number</label><input value={coForm.co_number} onChange={e=>setCOForm(p=>({...p,co_number:e.target.value}))} placeholder="CO-001" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Date Submitted</label><input type="date" value={coForm.date_submitted} onChange={e=>setCOForm(p=>({...p,date_submitted:e.target.value}))} style={inputS}/></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Amount ($)</label><input type="number" value={coForm.amount} onChange={e=>setCOForm(p=>({...p,amount:e.target.value}))} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Status</label><select value={coForm.status} onChange={e=>setCOForm(p=>({...p,status:e.target.value}))} style={inputS}>{['Pending','Approved','Rejected'].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Approved By</label><input value={coForm.approved_by} onChange={e=>setCOForm(p=>({...p,approved_by:e.target.value}))} style={inputS}/></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Date Approved</label><input type="date" value={coForm.date_approved} onChange={e=>setCOForm(p=>({...p,date_approved:e.target.value}))} style={inputS}/></div>
        </div>
        <div style={{marginBottom:10}}><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Description</label><textarea value={coForm.description} onChange={e=>setCOForm(p=>({...p,description:e.target.value}))} rows={2} style={{...inputS,resize:'vertical'}}/></div>
        <div style={{marginBottom:14}}><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Notes</label><textarea value={coForm.notes} onChange={e=>setCOForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inputS,resize:'vertical'}}/></div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setShowForm(false)} style={btnS}>Cancel</button><button onClick={saveCO} style={btnP}>{editCO?'Update':'Save'}</button></div>
      </div>
    </div>}
  </div>);
}

/* ═══ PM DAILY REPORT PAGE ═══ */
// Hoisted to module scope so its component identity is stable across PMDailyReportPage
// re-renders. If this were defined inside the parent's render, every keystroke would
// remount the section subtree and cause focused inputs/textareas to lose their cursor.
function PMReportSection({sk,title,filled,isOpen,onToggle,children}){
  return <div style={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:12,marginBottom:12,overflow:'hidden',boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}}>
    <button onClick={onToggle} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 18px',background:'#FDF4F4',border:'none',borderBottom:isOpen?'1px solid #F0E0E0':'none',cursor:'pointer',minHeight:52}}>
      <span style={{fontSize:14,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,display:'flex',alignItems:'center',gap:8}}>{title}{filled&&<span style={{fontSize:12,color:'#065F46',background:'#D1FAE5',padding:'2px 8px',borderRadius:10}}>✓</span>}</span>
      <span style={{fontSize:18,color:'#8B2020',fontWeight:700}}>{isOpen?'▾':'▸'}</span>
    </button>
    {isOpen&&<div style={{padding:18}}>{children}</div>}
  </div>;
}
function PMDailyReportPage({jobs}){
  const[tab,setTab]=useState('new');const[toast,setToast]=useState(null);const[reports,setReports]=useState([]);const[detailRpt,setDetailRpt]=useState(null);const[loading,setLoading]=useState(false);
  const[selPM,setSelPM]=useState(()=>localStorage.getItem('selected_pm')||'');
  const[selJobId,setSelJobId]=useState('');const[jobTotals,setJobTotals]=useState(null);
  const[showAllPMs,setShowAllPMs]=useState(false);
  const todayISO=new Date().toISOString().split('T')[0];
  const yesterdayISO=(()=>{const d=new Date();d.setDate(d.getDate()-1);return d.toISOString().split('T')[0];})();
  const emptyForm=()=>({job_number:'',repair_location:'',job_type:'Commercial',crew:localStorage.getItem('last_crew')||'',num_employees:'',daily_target:'',gate_style:'Precast',gate_height:'',num_gates_installed:'',num_holes_dug:'',num_posts_placed:'',lf_panels_installed:'',fence_style:'Precast',fence_height:'',num_cut_sections:'',num_sections_leveled:'',lf_panels_washed:'',precast_style_onsite:'',drill_piercing_lf:'',num_columns_laid_out:'',num_columns_34_built:'',num_columns_capped:'',lf_panels_shoulder:'',lf_panels_completed:'',machinery_used:localStorage.getItem('last_machinery')||'',soil_type:'Soil',soil_quality:'3',terrain_rating:'3',weather_condition:'',weather_temp_f:'',weather_notes:'',delay_reason:'None',delay_time:'None',lf_impacted_delays:'',num_defective_panels:'',num_defective_posts:'',other_defective_materials:'',delay_notes:'',submitted_by:selPM,report_date:todayISO});
  const[form,setForm]=useState(emptyForm);
  const[collapsed,setCollapsed]=useState({});
  const SECTIONS=[
    {key:'job',title:'Job Info',fields:['job_number','repair_location','crew','num_employees','daily_target']},
    {key:'gates',title:'Gates',fields:['gate_height','num_gates_installed']},
    {key:'posts',title:'Posts & Foundation',fields:['num_holes_dug','num_posts_placed']},
    {key:'panels',title:'Panels & Fence',fields:['lf_panels_installed','fence_height','num_cut_sections','num_sections_leveled','lf_panels_washed','precast_style_onsite']},
    {key:'sw',title:'Single Wythe Fields',fields:['drill_piercing_lf','num_columns_laid_out','num_columns_34_built','num_columns_capped','lf_panels_shoulder','lf_panels_completed']},
    {key:'site',title:'Site Conditions',fields:['machinery_used']},
    {key:'weather',title:'Weather Conditions',fields:['weather_condition','weather_temp_f','weather_notes']},
    {key:'delays',title:'Delays',fields:['lf_impacted_delays','num_defective_panels','num_defective_posts','other_defective_materials','delay_notes']},
  ];
  const sectionFilled=(s)=>s.fields.some(f=>{const v=form[f];return v!==''&&v!==undefined&&v!==null&&v!=='0'&&v!==0;});
  const sectionsFilledCount=SECTIONS.filter(sectionFilled).length;
  const clearForm=()=>{if(window.confirm('Clear all fields? This cannot be undone.')){setForm(emptyForm());setSelJobId('');setJobTotals(null);}};
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));
  const pickPM=(pm)=>{setSelPM(pm);localStorage.setItem('selected_pm',pm);setForm(f=>({...f,submitted_by:pm}));setSelJobId('');setJobTotals(null);};
  const pmJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)&&j.pm===selPM),[jobs,selPM]);
  const selectJob=(jobId)=>{setSelJobId(jobId);const job=jobs.find(j=>j.id===jobId);if(job){set('job_number',job.job_number||'');const ft=job.fence_type||'';const fs=ft.includes('SW')?'Single Wythe':ft.includes('WI')?'Wrought Iron':'Precast';set('fence_style',fs);sbGet('pm_daily_reports',`job_number=eq.${encodeURIComponent(job.job_number)}&select=lf_panels_installed,gates_installed,posts_placed,id`).then(d=>{if(d&&d.length){setJobTotals({lf:d.reduce((s,r)=>s+n(r.lf_panels_installed),0),gates:d.reduce((s,r)=>s+n(r.gates_installed),0),posts:d.reduce((s,r)=>s+n(r.posts_placed),0),count:d.length});}else{setJobTotals({lf:0,gates:0,posts:0,count:0});}});}else{setJobTotals(null);}};
  const fetchReports=useCallback(async()=>{setLoading(true);const d=await sbGet('pm_daily_reports','order=created_at.desc');setReports(d||[]);setLoading(false);},[]);
  useEffect(()=>{if(tab==='history'&&!detailRpt)fetchReports();},[tab,detailRpt]);
  const filteredReports=useMemo(()=>{if(showAllPMs)return reports;return selPM?reports.filter(r=>r.submitted_by===selPM):reports;},[reports,selPM,showAllPMs]);
  const submitReport=async()=>{
    // Body keys must match the pm_daily_reports schema exactly. Form uses legacy field
    // names (num_*, lf_panels_completed, etc.); we map them to actual DB column names here.
    const body={
      report_date:form.report_date||todayISO,
      job_number:form.job_number,
      repair_location:form.repair_location,
      job_type:form.job_type,
      crew:form.crew,
      employee_count:n(form.num_employees),
      daily_target:form.daily_target,
      gate_style:form.gate_style,
      gate_height:n(form.gate_height),
      gates_installed:n(form.num_gates_installed),
      holes_dug:n(form.num_holes_dug),
      posts_placed:n(form.num_posts_placed),
      lf_panels_installed:n(form.lf_panels_installed),
      fence_style:form.fence_style,
      fence_height:n(form.fence_height),
      cut_sections:n(form.num_cut_sections),
      sections_leveled:n(form.num_sections_leveled),
      lf_panels_washed:n(form.lf_panels_washed),
      precast_style_onsite:form.precast_style_onsite||null,
      drill_piercing_lf:n(form.drill_piercing_lf),
      columns_laid_out:n(form.num_columns_laid_out),
      columns_three_quarter:n(form.num_columns_34_built),
      columns_capped:n(form.num_columns_capped),
      lf_panels_shoulder:n(form.lf_panels_shoulder),
      lf_panels_capped:n(form.lf_panels_completed),
      machinery_used:form.machinery_used,
      soil_type:form.soil_type,
      soil_quality:parseInt(form.soil_quality)||0,
      terrain_rating:parseInt(form.terrain_rating)||0,
      delay_reason:form.delay_reason,
      delay_time:form.delay_time,
      lf_impacted_by_delays:n(form.lf_impacted_delays),
      defective_panels:n(form.num_defective_panels),
      defective_posts:n(form.num_defective_posts),
      other_defective:form.other_defective_materials,
      delay_notes:form.delay_notes,
      weather_condition:form.weather_condition||null,
      weather_temp_f:form.weather_temp_f?n(form.weather_temp_f):null,
      weather_notes:form.weather_notes||null,
      submitted_by:selPM||form.submitted_by,
    };
    if(form.crew)localStorage.setItem('last_crew',form.crew);
    if(form.machinery_used)localStorage.setItem('last_machinery',form.machinery_used);
    try{
      const res=await fetch(`${SB}/rest/v1/pm_daily_reports`,{method:'POST',headers:H,body:JSON.stringify(body)});
      if(res.status!==201){const txt=await res.text();throw new Error(`Supabase ${res.status}: ${txt||'no body'}`);}
      setToast({message:'Report submitted',isError:false});
      setSelJobId('');setJobTotals(null);setForm(emptyForm());
      setTimeout(()=>{setTab('history');fetchReports();},600);
    }catch(err){
      console.error('PM Daily Report submit failed:',err,'body:',body);
      setToast({message:`Submit failed: ${err.message||err}`,isError:true});
    }
  };
  const mInp={...inputS,minHeight:44,fontSize:16};const mSel={...mInp};const mTxt={...mInp,resize:'vertical'};
  const secStyle={fontSize:11,fontWeight:700,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10,marginTop:20,padding:'6px 10px',background:'#FDF4F4',borderRadius:6};
  const lblStyle={display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600};
  const gridR='repeat(auto-fit,minmax(240px,1fr))';
  // Detail view
  if(detailRpt)return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <button onClick={()=>setDetailRpt(null)} style={{background:'none',border:'none',color:'#8B2020',fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:16}}>← Back to History</button>
    <h2 style={{fontFamily:'Syne',fontSize:20,fontWeight:900,marginBottom:16}}>PM Daily Report — {fD(detailRpt.created_at)}</h2>
    <div style={{...card,marginBottom:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,fontSize:13}}>
        {[['Job Number',detailRpt.job_number],['Job Type',detailRpt.job_type],['Crew',detailRpt.crew],['Employees',detailRpt.employee_count],['Fence Style',detailRpt.fence_style],['Precast Style on Site',detailRpt.precast_style_onsite],['LF Panels Installed',detailRpt.lf_panels_installed],['LF Panels Washed',detailRpt.lf_panels_washed],['Gates Installed',detailRpt.gates_installed],['Posts Placed',detailRpt.posts_placed],['Holes Dug',detailRpt.holes_dug],['Weather',detailRpt.weather_condition],['Temperature (°F)',detailRpt.weather_temp_f],['Weather Notes',detailRpt.weather_notes],['Delay Reason',detailRpt.delay_reason],['Delay Time',detailRpt.delay_time],['Submitted By',detailRpt.submitted_by]].map(([l,v])=><div key={l}><div style={{fontSize:10,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>{l}</div><div style={{fontWeight:600}}>{v||'—'}</div></div>)}
      </div>
      {detailRpt.delay_notes&&<div style={{marginTop:12,padding:10,background:'#F9F8F6',borderRadius:8}}><div style={{fontSize:10,color:'#9E9B96',fontWeight:600,textTransform:'uppercase',marginBottom:4}}>Delay Notes</div><div style={{fontSize:13}}>{detailRpt.delay_notes}</div></div>}
    </div>
  </div>);
  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>PM Daily Report</h1>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>setTab('new')} style={gpill(tab==='new')}>+ New Report</button><button onClick={()=>{setTab('history');fetchReports();}} style={gpill(tab==='history')}>History</button>{tab==='new'&&selPM&&<button onClick={clearForm} style={{...gpill(false),color:'#8B2020',borderColor:'#E5C4C4'}}>Clear Form</button>}</div>
    </div>
    {/* PM Selector - always visible */}
    <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
      {PM_LIST.map(pm=><button key={pm.id} onClick={()=>pickPM(pm.id)} style={{padding:'12px 28px',borderRadius:12,border:selPM===pm.id?'2px solid #8B2020':'2px solid #E5E3E0',background:selPM===pm.id?'#8B2020':'#FFF',color:selPM===pm.id?'#fff':'#1A1A1A',fontSize:16,fontWeight:700,cursor:'pointer',minHeight:44,transition:'all .15s'}}>{pm.short}</button>)}
    </div>
    {!selPM&&<div style={{...card,textAlign:'center',padding:40,color:'#6B6056'}}>Select your name above to get started</div>}
    {selPM&&tab==='history'&&<div>
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center'}}><button onClick={()=>setShowAllPMs(false)} style={fpill(!showAllPMs)}>My Reports</button><button onClick={()=>setShowAllPMs(true)} style={fpill(showAllPMs)}>All PMs</button><span style={{fontSize:12,color:'#6B6056'}}>{filteredReports.length} reports</span></div>
      {loading?<div style={{color:'#9E9B96',padding:40,textAlign:'center'}}>Loading...</div>:filteredReports.length===0?<div style={{textAlign:'center',padding:40}}><div style={{fontSize:28,marginBottom:8}}>📋</div><div style={{color:'#9E9B96',fontSize:14,marginBottom:12}}>No reports submitted yet</div><button onClick={()=>setTab('new')} style={{...btnP,fontSize:12}}>+ New Report</button></div>:<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 300px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Date','Job Number','Job Type','Crew','LF Installed','Submitted By',''].map((h,i)=><th key={i} style={{textAlign:'left',padding:'12px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{filteredReports.map(r=><tr key={r.id} onClick={()=>setDetailRpt(r)} style={{borderBottom:'1px solid #F4F4F2',cursor:'pointer',minHeight:48}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <td style={{padding:'14px 10px'}}>{fD(r.report_date||r.created_at)}</td>
            <td style={{padding:'14px 10px',fontWeight:500}}>{r.job_number||'—'}</td>
            <td style={{padding:'14px 10px'}}>{r.job_type||'—'}</td>
            <td style={{padding:'14px 10px'}}>{r.crew||'—'}</td>
            <td style={{padding:'14px 10px',fontWeight:700}}>{n(r.lf_panels_installed).toLocaleString()}</td>
            <td style={{padding:'14px 10px'}}>{r.submitted_by||'—'}</td>
            <td style={{padding:'14px 10px',textAlign:'right',color:'#8B2020',fontSize:20,fontWeight:700,width:32}}>›</td>
          </tr>)}</tbody></table>
      </div>}
    </div>}
    {selPM&&tab==='new'&&(()=>{
      const secProps=(sk)=>{const s=SECTIONS.find(x=>x.key===sk);return{sk,isOpen:!collapsed[sk],filled:!!(s&&sectionFilled(s)),onToggle:()=>setCollapsed(p=>({...p,[sk]:!p[sk]}))};};
      return<div style={{paddingBottom:120}}>
      {/* Progress indicator */}
      <div style={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:12,padding:'12px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:12}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}><span>Progress</span><span>{sectionsFilledCount} of {SECTIONS.length} sections complete</span></div>
          <div style={{height:8,background:'#F4F4F2',borderRadius:4,overflow:'hidden'}}><div style={{width:`${(sectionsFilledCount/SECTIONS.length)*100}%`,height:'100%',background:'#8B2020',transition:'width .2s'}}/></div>
        </div>
      </div>
      <PMReportSection {...secProps('job')} title="Job Info">
        <div style={{marginBottom:12}}><label style={lblStyle}>Select Job</label>
          <select value={selJobId} onChange={e=>selectJob(e.target.value)} style={mSel}><option value="">— Select a job —</option>{pmJobs.map(j=><option key={j.id} value={j.id}>{j.job_number} — {j.job_name}</option>)}</select>
        </div>
        {jobTotals&&<div style={{background:'#F0F9FF',border:'1px solid #BAE6FD',borderRadius:10,padding:14,marginBottom:16,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10}}>
          <div><div style={{fontSize:10,color:'#0369A1',fontWeight:600,textTransform:'uppercase'}}>LF Installed to Date</div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#0C4A6E'}}>{jobTotals.lf.toLocaleString()}</div></div>
          <div><div style={{fontSize:10,color:'#0369A1',fontWeight:600,textTransform:'uppercase'}}>Gates to Date</div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#0C4A6E'}}>{jobTotals.gates}</div></div>
          <div><div style={{fontSize:10,color:'#0369A1',fontWeight:600,textTransform:'uppercase'}}>Posts to Date</div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#0C4A6E'}}>{jobTotals.posts}</div></div>
          <div><div style={{fontSize:10,color:'#0369A1',fontWeight:600,textTransform:'uppercase'}}>Reports Filed</div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#0C4A6E'}}>{jobTotals.count}</div></div>
        </div>}
        {selJobId&&(()=>{const sj=jobs.find(j=>j.id===selJobId);return sj?<div style={{display:'flex',gap:12,marginBottom:12,fontSize:12,color:'#6B6056',flexWrap:'wrap'}}><span>Market: <span style={pill(MC[sj.market]||'#6B6056',MB[sj.market]||'#F4F4F2')}>{MS[sj.market]||sj.market||'—'}</span></span><span>Fence Type: <strong>{sj.fence_type||'—'}</strong></span></div>:null;})()}
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Job Number (N/A for Repair)</label><input value={form.job_number} onChange={e=>set('job_number',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Repair Location (optional)</label><input value={form.repair_location} onChange={e=>set('repair_location',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Job Type</label><select value={form.job_type} onChange={e=>set('job_type',e.target.value)} style={mSel}>{['Commercial','Residential','Repair - Damage to Fencecrete Fence','Rework - Repair to Non-Fencecrete Fence','Municipal / MUD'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Crew</label><input value={form.crew} onChange={e=>set('crew',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Employees on Job</label><input type="number" value={form.num_employees} onChange={e=>set('num_employees',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Daily Target</label><input value={form.daily_target} onChange={e=>set('daily_target',e.target.value)} placeholder="LF of Panels/Foundation, # Posts/Columns, or Other" style={mInp}/></div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'flex-end',marginTop:12}}>
          <div style={{flex:1}}><label style={lblStyle}>Report Date</label><input type="date" value={form.report_date} onChange={e=>set('report_date',e.target.value)} style={mInp}/></div>
          <button onClick={()=>set('report_date',yesterdayISO)} style={{...btnS,minHeight:44,fontSize:13,whiteSpace:'nowrap'}}>Yesterday</button>
        </div>
      </PMReportSection>
      <PMReportSection {...secProps('gates')} title="Gates">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Gate Style</label><select value={form.gate_style} onChange={e=>set('gate_style',e.target.value)} style={mSel}>{['Precast','Wrought Iron','Single Wythe'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Gate Height (ft)</label><input type="number" value={form.gate_height} onChange={e=>set('gate_height',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Gates Installed</label><input type="number" value={form.num_gates_installed} onChange={e=>set('num_gates_installed',e.target.value)} style={mInp}/></div>
        </div>
      </PMReportSection>
      <PMReportSection {...secProps('posts')} title="Posts & Foundation">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Number of Holes Dug</label><input type="number" value={form.num_holes_dug} onChange={e=>set('num_holes_dug',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Posts Placed</label><input type="number" value={form.num_posts_placed} onChange={e=>set('num_posts_placed',e.target.value)} style={mInp}/></div>
        </div>
      </PMReportSection>
      <PMReportSection {...secProps('panels')} title="Panels & Fence">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Linear Feet of Panels Installed</label><input type="number" value={form.lf_panels_installed} onChange={e=>set('lf_panels_installed',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Fence Style</label><select value={form.fence_style} onChange={e=>set('fence_style',e.target.value)} style={mSel}>{['Precast','Wrought Iron','Single Wythe'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Fence Height (ft)</label><input type="number" value={form.fence_height} onChange={e=>set('fence_height',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Cut Sections</label><input type="number" value={form.num_cut_sections} onChange={e=>set('num_cut_sections',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Sections Leveled</label><input type="number" value={form.num_sections_leveled} onChange={e=>set('num_sections_leveled',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>LF of Panels Washed</label><input type="number" value={form.lf_panels_washed} onChange={e=>set('lf_panels_washed',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Precast Style at Time of Visit</label><input value={form.precast_style_onsite} onChange={e=>set('precast_style_onsite',e.target.value)} placeholder="e.g. Vertical Wood 6, Santa Barbara 8" style={mInp}/></div>
        </div>
      </PMReportSection>
      <PMReportSection {...secProps('sw')} title="Single Wythe Fields">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Drill Piercing LF Completed</label><input type="number" value={form.drill_piercing_lf} onChange={e=>set('drill_piercing_lf',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Columns Laid Out</label><input type="number" value={form.num_columns_laid_out} onChange={e=>set('num_columns_laid_out',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Columns 3/4 Built</label><input type="number" value={form.num_columns_34_built} onChange={e=>set('num_columns_34_built',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Columns Capped / Solid Filled</label><input type="number" value={form.num_columns_capped} onChange={e=>set('num_columns_capped',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>LF of Panels Built up to Shoulder</label><input type="number" value={form.lf_panels_shoulder} onChange={e=>set('lf_panels_shoulder',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>LF of Panels Capped / Completed</label><input type="number" value={form.lf_panels_completed} onChange={e=>set('lf_panels_completed',e.target.value)} style={mInp}/></div>
        </div>
      </PMReportSection>
      <PMReportSection {...secProps('site')} title="Site Conditions">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Types of Machinery Used</label><input value={form.machinery_used} onChange={e=>set('machinery_used',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Soil Type</label><select value={form.soil_type} onChange={e=>set('soil_type',e.target.value)} style={mSel}>{['Soil','Rock'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Soil Quality</label><select value={form.soil_quality} onChange={e=>set('soil_quality',e.target.value)} style={mSel}>{['1 - Worst','2','3','4','5 - Best'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Terrain Rating</label><select value={form.terrain_rating} onChange={e=>set('terrain_rating',e.target.value)} style={mSel}>{['1 - Most Difficult','2','3','4','5 - Easiest'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
        </div>
      </PMReportSection>
      <PMReportSection {...secProps('weather')} title="Weather Conditions">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Weather Condition</label><select value={form.weather_condition} onChange={e=>set('weather_condition',e.target.value)} style={mSel}><option value="">— Select —</option>{['Clear','Partly Cloudy','Overcast','Light Rain','Heavy Rain','Light Wind','High Wind','Extreme Heat','Fog','Other'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Temperature (°F)</label><input type="number" value={form.weather_temp_f} onChange={e=>set('weather_temp_f',e.target.value)} placeholder="°F" style={mInp}/></div>
        </div>
        <div style={{marginTop:12}}><label style={lblStyle}>Weather Notes</label><textarea value={form.weather_notes} onChange={e=>set('weather_notes',e.target.value)} rows={2} placeholder="Describe conditions affecting work" style={{...mInp,resize:'vertical'}}/></div>
      </PMReportSection>
      <PMReportSection {...secProps('delays')} title="Delays">
        <div style={{display:'grid',gridTemplateColumns:gridR,gap:12}}>
          <div><label style={lblStyle}>Delay Reason</label><select value={form.delay_reason} onChange={e=>set('delay_reason',e.target.value)} style={mSel}>{['None','Weather','General Contractor','Equipment Repair/Failure','Material Defect','Material Shortage','Utilities','Ongoing Issue'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>Delay Time</label><select value={form.delay_time} onChange={e=>set('delay_time',e.target.value)} style={mSel}>{['None','Less than 1 Hour','1 Hour','2 Hours','3 Hours','4 Hours','5 Hours','6 Hours','7 Hours','8 Hours','Greater than 8 Hours'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div><label style={lblStyle}>LF Impacted by Ongoing Delays</label><input type="number" value={form.lf_impacted_delays} onChange={e=>set('lf_impacted_delays',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Defective Panels</label><input type="number" value={form.num_defective_panels} onChange={e=>set('num_defective_panels',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Number of Defective Posts</label><input type="number" value={form.num_defective_posts} onChange={e=>set('num_defective_posts',e.target.value)} style={mInp}/></div>
          <div><label style={lblStyle}>Other Defective Materials</label><input value={form.other_defective_materials} onChange={e=>set('other_defective_materials',e.target.value)} style={mInp}/></div>
        </div>
        <div style={{marginTop:12}}><label style={lblStyle}>Delay Notes</label><textarea value={form.delay_notes} onChange={e=>set('delay_notes',e.target.value)} rows={3} placeholder="Describe GC delays, weather type, equipment failure, etc." style={mTxt}/></div>
      </PMReportSection>
      {/* Sticky submit bar — fixed to viewport bottom */}
      <div style={{position:'sticky',bottom:0,left:0,right:0,background:'#FFF',borderTop:'2px solid #8B2020',padding:'12px 14px',marginTop:8,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',boxShadow:'0 -6px 16px rgba(0,0,0,0.08)',zIndex:50,marginLeft:-32,marginRight:-32,paddingLeft:32,paddingRight:32}}>
        <input value={form.submitted_by||selPM} onChange={e=>set('submitted_by',e.target.value)} placeholder="Submitted by" style={{...mInp,flex:'0 1 200px',minWidth:140,minHeight:48}}/>
        <button onClick={submitReport} style={{...btnP,flex:'1 1 200px',padding:'14px 24px',fontSize:16,fontWeight:800,minHeight:48,background:'#8B2020',color:'#fff'}}>Submit Report</button>
      </div>
    </div>;})()}
  </div>);
}

/* ═══ ESTIMATING PAGE ═══ */
const EST_SC={draft:['#6B6056','#F4F4F2'],sent:['#1D4ED8','#DBEAFE'],won:['#065F46','#D1FAE5'],lost:['#991B1B','#FEE2E2']};
const RATE_PCTILES={pc:{Houston:{p25:89,med:92,p75:136,min:83,max:195},Austin:{p25:92,med:106,p75:146,min:88,max:455},'Dallas-Fort Worth':{p25:105,med:120,p75:148,min:93,max:192},'San Antonio':{p25:95,med:108,p75:160,min:85,max:180}},sw:{Houston:{p25:123,med:126,p75:192,min:118,max:192},Austin:{p25:138,med:148,p75:158,min:138,max:158},'Dallas-Fort Worth':{p25:192,med:192,p75:192,min:192,max:192}}};
function RateBar({rate,market,type}){
  if(!rate||!market)return null;const d=RATE_PCTILES[type]?.[market];if(!d)return<div style={{fontSize:9,color:'#9E9B96',marginTop:2}}>Limited data for {market}</div>;
  const r=n(rate);const range=d.max-d.min;if(range<=0)return null;const pct=Math.max(0,Math.min(100,(r-d.min)/range*100));
  const color=r<d.p25?'#2563EB':r<=d.p75?'#065F46':r<=d.p75+(d.max-d.p75)*0.6?'#B45309':'#991B1B';
  const label=r<d.p25?'Below market':r<=d.p75?'Competitive':r<=d.p75+(d.max-d.p75)*0.6?'Premium':'Very high';
  return<div style={{marginTop:4}}>
    <div style={{position:'relative',height:8,background:'#E5E3E0',borderRadius:4,overflow:'visible'}}>
      <div style={{position:'absolute',left:`${(d.p25-d.min)/range*100}%`,width:`${(d.p75-d.p25)/range*100}%`,height:'100%',background:'#D1FAE5',borderRadius:2}}/>
      <div style={{position:'absolute',left:`${(d.med-d.min)/range*100}%`,width:2,height:'100%',background:'#065F46'}}/>
      <div style={{position:'absolute',left:`${pct}%`,top:-2,width:12,height:12,borderRadius:6,background:color,border:'2px solid #fff',transform:'translateX(-6px)',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/>
    </div>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:8,color:'#9E9B96',marginTop:1}}><span>${d.min}</span><span>${d.med} med</span><span>${d.max}</span></div>
    <div style={{fontSize:9,fontWeight:600,color,marginTop:1}}>${r} — {label}</div>
  </div>;
}
function EstimatingPage(){
  const[view,setView]=useState('list');
  const[estimates,setEstimates]=useState([]);
  const[loading,setLoading]=useState(true);
  const[toast,setToast]=useState(null);
  const[saving,setSaving]=useState(false);
  const emptyForm={customer_name:'',market:'',sales_rep:'',job_type:'Commercial',lf_precast:0,rate_precast:0,lf_sw:0,rate_sw:0,gate_qty:0,rate_gate:0,notes:'',estimate_number:'',status:'draft'};
  const[f,setF]=useState(emptyForm);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const fetchEst=useCallback(async()=>{setLoading(true);try{const d=await sbGet('estimates','select=*&order=created_at.desc');setEstimates(Array.isArray(d)?d:[]);}catch(e){setEstimates([]);}setLoading(false);},[]);
  useEffect(()=>{fetchEst();},[fetchEst]);
  const pcSub=n(f.lf_precast)*n(f.rate_precast);
  const swSub=n(f.lf_sw)*n(f.rate_sw);
  const gtSub=n(f.gate_qty)*n(f.rate_gate);
  const netEst=pcSub+swSub+gtSub;
  const nextNum=`EST-${new Date().getFullYear()}-${String(estimates.length+1).padStart(3,'0')}`;
  const saveEst=async(status)=>{setSaving(true);try{const body={estimate_number:f.estimate_number||nextNum,customer_name:f.customer_name,market:f.market,sales_rep:f.sales_rep,job_type:f.job_type,lf_precast:n(f.lf_precast),rate_precast:n(f.rate_precast),lf_sw:n(f.lf_sw),rate_sw:n(f.rate_sw),gate_qty:n(f.gate_qty),rate_gate:n(f.rate_gate),net_estimate:netEst,total_estimate:netEst,notes:f.notes,status:status};await sbPost('estimates',body);setToast('Estimate saved');setView('list');setF(emptyForm);fetchEst();}catch(e){setToast('Error saving estimate');}setSaving(false);};
  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Estimating</h1>
      {view==='list'&&<button onClick={()=>{setF({...emptyForm,estimate_number:nextNum});setView('form');}} style={btnP}>+ New Estimate</button>}
    </div>
    {view==='list'&&<div>
      {loading?<div style={{padding:40,textAlign:'center',color:'#9E9B96'}}>Loading...</div>:estimates.length===0?<div style={{...card,padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>📊</div><div style={{color:'#9E9B96',fontSize:14,marginBottom:12}}>No estimates yet</div><button onClick={()=>{setF({...emptyForm,estimate_number:nextNum});setView('form');}} style={{...btnP,fontSize:12}}>+ Create First Estimate</button></div>:<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 220px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Estimate #','Customer','Market','Sales Rep','Total','Status','Date'].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{estimates.map(e=>{const[sc2,sb2]=EST_SC[e.status]||['#6B6056','#F4F4F2'];return<tr key={e.id} style={{borderBottom:'1px solid #F4F4F2'}} onMouseEnter={ev=>ev.currentTarget.style.background='#FDF9F6'} onMouseLeave={ev=>ev.currentTarget.style.background='transparent'}>
            <td style={{padding:'8px 10px',fontWeight:600}}>{e.estimate_number||'—'}</td>
            <td style={{padding:'8px 10px'}}>{e.customer_name||'—'}</td>
            <td style={{padding:'8px 10px'}}>{e.market?<span style={pill(MC[e.market]||'#6B6056',MB[e.market]||'#F4F4F2')}>{MS[e.market]||e.market}</span>:'—'}</td>
            <td style={{padding:'8px 10px'}}>{e.sales_rep||'—'}</td>
            <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(e.total_estimate||e.net_estimate)}</td>
            <td style={{padding:'8px 10px'}}><span style={pill(sc2,sb2)}>{e.status||'draft'}</span></td>
            <td style={{padding:'8px 10px',color:'#9E9B96'}}>{fD(e.created_at)}</td>
          </tr>;})}</tbody></table>
      </div>}
    </div>}
    {view==='form'&&<div style={{maxWidth:600}}>
      <button onClick={()=>setView('list')} style={{background:'none',border:'none',color:'#8B2020',fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:16}}>← All Estimates</button>
      <div style={card}>
        <div style={{marginBottom:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Customer Name</label><input value={f.customer_name} onChange={e=>set('customer_name',e.target.value)} style={inputS}/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Market</label><select value={f.market} onChange={e=>set('market',e.target.value)} style={inputS}><option value="">— Select —</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Sales Rep</label><select value={f.sales_rep} onChange={e=>set('sales_rep',e.target.value)} style={inputS}><option value="">— Select —</option>{REPS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Job Type</label><select value={f.job_type} onChange={e=>set('job_type',e.target.value)} style={inputS}>{['Commercial','Residential','Government','Municipal/MUD'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:'#8B2020',marginTop:16,marginBottom:8,padding:'6px 10px',background:'#FDF4F4',borderRadius:6}}>PRECAST</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:4}}>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>LF</label><input type="number" value={f.lf_precast||''} onChange={e=>set('lf_precast',e.target.value)} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>Rate ($/LF)</label><input type="number" value={f.rate_precast||''} onChange={e=>set('rate_precast',e.target.value)} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>Subtotal</label><div style={{...inputS,background:'#F9F8F6',fontWeight:700}}>{$(pcSub)}</div></div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:'#1D4ED8',marginTop:16,marginBottom:8,padding:'6px 10px',background:'#DBEAFE',borderRadius:6}}>SINGLE WYTHE</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:4}}>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>LF</label><input type="number" value={f.lf_sw||''} onChange={e=>set('lf_sw',e.target.value)} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>Rate ($/LF)</label><input type="number" value={f.rate_sw||''} onChange={e=>set('rate_sw',e.target.value)} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>Subtotal</label><div style={{...inputS,background:'#F9F8F6',fontWeight:700}}>{$(swSub)}</div></div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:'#6B6056',marginTop:16,marginBottom:8,padding:'6px 10px',background:'#F4F4F2',borderRadius:6}}>GATES</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:4}}>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}># of Gates</label><input type="number" value={f.gate_qty||''} onChange={e=>set('gate_qty',e.target.value)} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>Rate per Gate ($)</label><input type="number" value={f.rate_gate||''} onChange={e=>set('rate_gate',e.target.value)} placeholder="0" style={inputS}/></div>
          <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4}}>Subtotal</label><div style={{...inputS,background:'#F9F8F6',fontWeight:700}}>{$(gtSub)}</div></div>
        </div>
        <div style={{background:'#1A1A1A',borderRadius:10,padding:16,marginTop:20,marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{color:'#9E9B96',fontSize:14,fontWeight:600}}>NET ESTIMATE</span>
          <span style={{fontFamily:'Inter',fontWeight:900,fontSize:28,color:'#8B2020'}}>{$(netEst)}</span>
        </div>
        <div style={{marginBottom:16}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Notes</label><textarea value={f.notes||''} onChange={e=>set('notes',e.target.value)} rows={3} style={{...inputS,resize:'vertical'}}/></div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>saveEst('draft')} disabled={saving} style={btnS}>{saving?'Saving...':'Save Draft'}</button>
          <button onClick={()=>saveEst('sent')} disabled={saving} style={{...btnP,background:'#1D4ED8'}}>Mark as Sent</button>
        </div>
      </div>
    </div>}
  </div>);
}

/* ═══ IMPORT PROJECTS PAGE ═══ */
const IMPORT_COL_MAP={
  'Job Code':'job_number',
  'Cust #':'cust_number',
  'Job Name ':'job_name',
  'Customer Name':'customer_name',
  'Status':'status',
  'Location':'market',
  'Sales Rep':'sales_rep',
  'Type':'job_type',
  'Fence Type':'fence_type',
  'Billing Method':'billing_method',
  'Address':'address',
  'City':'city',
  'State':'state',
  'Zip':'zip',
  'Documents Needed':'documents_needed',
  'File Location':'file_location',
  'LF - Precast':'lf_precast',
  'Style - Clean':'style',
  'Color - Precast':'color',
  'Height - Precast':'height_precast',
  'Contract Rate - Precast':'contract_rate_precast',
  'LF - Single Wythe':'lf_single_wythe',
  'Height - Single Wythe':'height_single_wythe',
  'Contract Rate - Single Wythe':'contract_rate_single_wythe',
  'Style - Single Wythe':'style_single_wythe',
  'LF - Wrought Iron':'lf_wrought_iron',
  'Height - Wrought Iron':'height_wrought_iron',
  'Contract Rate - Wrought Iron':'contract_rate_wrought_iron',
  'LF - Removal':'lf_removal',
  'Height - Removal':'height_removal',
  'Removal Material Type':'removal_material_type',
  'Contract Rate - Removal':'contract_rate_removal',
  'Number of Gates':'number_of_gates',
  'Gate Height':'gate_height',
  'Gate Description':'gate_description',
  'Gate Rate':'gate_rate',
  'Lump Sum or Other Payment Amount':'lump_sum_amount',
  'Lump Sum or Other Description':'lump_sum_description',
  'Net Contract Value':'net_contract_value',
  'Change Orders':'change_orders',
  'Adj Contract Value':'adj_contract_value',
  'Sales Tax':'sales_tax',
  'YTD Amt\nInvoiced':'ytd_invoiced',
  'Left to Bill':'left_to_bill',
  '% Billed':'pct_billed',
  'Last Billed':'last_billed',
  'Contract Date':'contract_date',
  'Est. Start Date':'est_start_date',
  'Active Entry date':'active_entry_date',
  'Complete/Pass\nDate':'complete_date',
  'Billing\nDate':'billing_date',
  'Notes':'notes'
};
// Status mapping for NEW jobs only — existing jobs keep their current app status (kanban owns it)
const IMPORT_STATUS_MAP={
  // Active jobs
  'Active Project':'active_install','Active':'active_install',
  // Booked but not started
  'Booked-Not Started':'inventory_ready','Booked Not Started':'inventory_ready','Booked':'inventory_ready',
  // In contract review / pending
  'Pending':'contract_review','Contract Review':'contract_review','New':'contract_review',
  // In production
  'In Production':'in_production','Production':'in_production',
  // Closed / complete
  'Closed':'closed','Complete':'closed','Pass':'closed','Cancelled':'closed','Lost':'closed',
};
const IMPORT_STATUS_DEFAULT='contract_review';
const mapImportStatus=(raw)=>{if(raw==null||raw==='')return{mapped:IMPORT_STATUS_DEFAULT,matched:false,raw:''};const s=String(raw).trim();return{mapped:IMPORT_STATUS_MAP[s]||IMPORT_STATUS_DEFAULT,matched:!!IMPORT_STATUS_MAP[s],raw:s};};
const IMPORT_MARKET_MAP={'San Antonio':'San Antonio','Houston':'Houston','Austin':'Austin','Dallas':'Dallas-Fort Worth','DFW':'Dallas-Fort Worth','Dallas-Fort Worth':'Dallas-Fort Worth'};
// Fields protected from UPDATES on existing jobs (kanban/AR/material calc own these — never overwritten from Excel)
const PROTECTED_FIELDS=new Set(['ytd_invoiced','amount_billed','pct_billed','left_to_bill','status','material_posts_line','material_posts_corner','material_posts_stop','material_panels_regular','material_panels_half','material_rails_regular','material_rails_top','material_rails_bottom','material_rails_center','material_caps_line','material_caps_stop','material_post_height','material_calc_date','inventory_ready_date','active_install_date','fence_complete_date','fully_complete_date','closed_date']);
// Fields stripped on INSERT of new jobs (derived/computed fields only — status IS set on insert so it's NOT here)
const INSERT_PROTECTED_FIELDS=new Set(['ytd_invoiced','amount_billed','pct_billed','left_to_bill','material_posts_line','material_posts_corner','material_posts_stop','material_panels_regular','material_panels_half','material_rails_regular','material_rails_top','material_rails_bottom','material_rails_center','material_caps_line','material_caps_stop','material_post_height','material_calc_date','inventory_ready_date','active_install_date','fence_complete_date','fully_complete_date','closed_date']);
const IMPORT_NUMERIC_FIELDS=new Set(['lf_precast','height_precast','contract_rate_precast','lf_single_wythe','height_single_wythe','contract_rate_single_wythe','lf_wrought_iron','number_of_gates','gate_height','gate_rate','contract_value','change_orders','adj_contract_value','sales_tax','ytd_invoiced','amount_billed','left_to_bill','pct_billed','height','contract_rate','lump_sum_amount','net_contract_value','height_wrought_iron','contract_rate_wrought_iron','lf_removal','contract_rate_removal']);
const IMPORT_DATE_FIELDS=new Set(['contract_date','est_start_date','billing_date','start_date','completion_date','last_billed','active_entry_date','complete_date','contract_month','start_month','complete_month']);

function ImportProjectsPage({jobs,onRefresh,onNav}){
  const[step,setStep]=useState(1);
  const[fileName,setFileName]=useState('');
  const[workbook,setWorkbook]=useState(null);
  const[sheetNames,setSheetNames]=useState([]);
  const[selectedSheet,setSelectedSheet]=useState('');
  const[rawRows,setRawRows]=useState([]);
  const[headers,setHeaders]=useState([]);
  const[mapping,setMapping]=useState({});
  const[preview,setPreview]=useState(null);
  const[previewTab,setPreviewTab]=useState('new');
  const[skipUpdates,setSkipUpdates]=useState(new Set());
  const[importing,setImporting]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0});
  const[results,setResults]=useState(null);
  const[error,setError]=useState('');
  const[toast,setToast]=useState(null);
  const fileInputRef=useRef();

  const parseSheet=(wb,sheetName)=>{
    try{
      const sheet=wb.Sheets[sheetName];
      if(!sheet){setError('Sheet "'+sheetName+'" not found');return;}
      // Headers on row 1 (0-indexed 0)
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:false});
      if(rows.length<2){setError('Sheet must have a header row and at least one data row');return;}
      const hdrs=rows[0].map(h=>h?String(h):'');
      const dataRows=rows.slice(1).filter(r=>r.some(c=>c!=null&&String(c).trim()!==''));
      const objRows=dataRows.map(r=>{const o={};hdrs.forEach((h,i)=>{if(h)o[h]=r[i];});return o;});
      setHeaders(hdrs.filter(Boolean));
      setRawRows(objRows);
      // Auto-map (exact match against IMPORT_COL_MAP, preserving whitespace/newlines)
      const autoMap={};
      hdrs.forEach(h=>{if(h&&IMPORT_COL_MAP[h])autoMap[h]=IMPORT_COL_MAP[h];});
      setMapping(autoMap);
      setStep(2);
    }catch(err){setError('Failed to parse sheet: '+err.message);}
  };

  const loadWorkbook=(file)=>{
    setError('');
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const data=new Uint8Array(e.target.result);
        const wb=XLSX.read(data,{type:'array',cellDates:true});
        if(!wb.SheetNames||wb.SheetNames.length===0){setError('No sheets found in workbook');return;}
        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        // Default: prefer "Active Jobs" if present, else first sheet
        const def=wb.SheetNames.find(n=>n.trim().toLowerCase()==='active jobs')||wb.SheetNames[0];
        setSelectedSheet(def);
        setFileName(file.name);
      }catch(err){setError('Failed to parse file: '+err.message);}
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFile=(e)=>{const f=e.target.files[0];if(f)loadWorkbook(f);};
  const handleDrop=(e)=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)loadWorkbook(f);};

  const parseNum=(v)=>{if(v==null||v==='')return null;const s=String(v).replace(/[$,\s]/g,'');const n2=parseFloat(s);return isNaN(n2)?null:n2;};
  const INTEGER_FIELDS=new Set(['lf_precast','lf_single_wythe','lf_wrought_iron','lf_other','lf_removal','total_lf','total_lf_removed','number_of_gates','contract_age']);
  const parseIntSafe=(v)=>{if(v==null||v==='')return null;const s=String(v).replace(/[$,\s]/g,'');const n=parseFloat(s);if(isNaN(n))return null;const r=Math.round(n);return isNaN(r)?null:r;};
  const safeDate=(val)=>{
    if(val===null||val===undefined||val==='')return null;
    // Excel serial date (number)
    if(typeof val==='number'){
      const d=new Date(Math.round((val-25569)*86400*1000));
      if(isNaN(d.getTime()))return null;
      return d.toISOString().split('T')[0];
    }
    // JS Date object — use UTC to avoid timezone shifts
    if(val instanceof Date){
      if(isNaN(val.getTime()))return null;
      const y=val.getUTCFullYear();
      const m=String(val.getUTCMonth()+1).padStart(2,'0');
      const d=String(val.getUTCDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }
    // String
    if(typeof val==='string'){
      const trimmed=val.trim();
      if(!trimmed)return null;
      if(/^\d{4}-\d{2}-\d{2}$/.test(trimmed))return trimmed;
      // Numeric string → Excel serial
      if(/^\d+(\.\d+)?$/.test(trimmed)){
        const n=parseFloat(trimmed);
        const d=new Date(Math.round((n-25569)*86400*1000));
        if(isNaN(d.getTime()))return null;
        return d.toISOString().split('T')[0];
      }
      const d=new Date(trimmed);
      if(isNaN(d.getTime()))return null;
      // Guard against extended-year ISO output (e.g. "+045964-01-01")
      const y=d.getUTCFullYear();
      if(y<1900||y>2200)return null;
      const mm=String(d.getUTCMonth()+1).padStart(2,'0');
      const dd=String(d.getUTCDate()).padStart(2,'0');
      return `${y}-${mm}-${dd}`;
    }
    return null;
  };
  const parseDate=safeDate;

  const buildPreview=()=>{
    const jobsByNumber={};jobs.forEach(j=>{if(j.job_number)jobsByNumber[j.job_number.trim()]=j;});
    const jobsByName={};jobs.forEach(j=>{if(j.job_name)jobsByName[j.job_name.trim().toLowerCase()]=j;});
    const newJobs=[];const updates=[];const warnings=[];
    rawRows.forEach((row,idx)=>{
      const mapped={};
      let statusRaw='';let statusMatched=true;
      Object.entries(mapping).forEach(([excelCol,dbCol])=>{
        if(!dbCol)return;
        let v=row[excelCol];
        if(v==null||v==='')return;
        if(dbCol==='status'){
          const r=mapImportStatus(v);
          statusRaw=r.raw;statusMatched=r.matched;
          v=r.mapped;
        }
        else if(dbCol==='market'){v=IMPORT_MARKET_MAP[String(v).trim()]||String(v).trim();}
        else if(INTEGER_FIELDS.has(dbCol)){v=parseIntSafe(v);}
        else if(IMPORT_NUMERIC_FIELDS.has(dbCol)){v=parseNum(v);}
        else if(IMPORT_DATE_FIELDS.has(dbCol)){v=parseDate(v);}
        else{v=String(v).trim();}
        if(v!=null&&v!=='')mapped[dbCol]=v;
      });
      const jobNumber=mapped.job_number;
      if(!jobNumber){warnings.push({row:idx+7,issue:'Missing job_number',data:JSON.stringify(row).substring(0,80)});return;}
      if(!mapped.job_name){warnings.push({row:idx+7,issue:'Missing job_name',data:jobNumber});return;}
      // Default status for new jobs when no status column or empty
      if(!mapped.status)mapped.status=IMPORT_STATUS_DEFAULT;
      const existing=jobsByNumber[jobNumber]||jobsByName[mapped.job_name.toLowerCase()];
      if(existing){
        // Existing jobs: never change status. Find other changed fields (excluding protected)
        const changes=[];
        Object.entries(mapped).forEach(([k,v])=>{
          if(PROTECTED_FIELDS.has(k))return;
          const cur=existing[k];
          if(cur==null&&v==null)return;
          if(String(cur||'')!==String(v||'')){changes.push({field:k,cur,newVal:v});}
        });
        if(changes.length>0)updates.push({rowNum:idx+7,existing,mapped,changes,statusRaw,keepingStatus:existing.status});
      }else{
        // New jobs: status IS set — warn if Excel status was unrecognized
        if(statusRaw&&!statusMatched){
          warnings.push({row:idx+7,issue:`Status "${statusRaw}" not recognized → will default to Contract Review`,data:`${jobNumber} · ${mapped.job_name}`});
        }
        newJobs.push({rowNum:idx+7,mapped,statusRaw,statusMatched});
      }
    });
    setPreview({newJobs,updates,warnings});
    setSkipUpdates(new Set());
    setStep(3);
  };

  const runImport=async()=>{
    if(!preview)return;
    setImporting(true);
    const errors=[];let inserted=0;let updated=0;
    const total=preview.newJobs.length+preview.updates.filter(u=>!skipUpdates.has(u.rowNum)).length;
    setProgress({done:0,total});
    // List of every date field that must be normalized via safeDate before sending to Postgres
    const DATE_FIELDS_TO_NORMALIZE=['contract_date','est_start_date','active_entry_date','complete_date','last_billed','contract_month','start_month','complete_month','billing_date'];
    // Insert new jobs (batch of 50) — all rows in a batch must have identical key sets
    for(let i=0;i<preview.newJobs.length;i+=50){
      const slice=preview.newJobs.slice(i,i+50);
      // First pass: build each row body and re-normalize every date field via safeDate
      const rawRows=slice.map(nj=>{
        const body={...nj.mapped,created_at:new Date().toISOString()};
        INSERT_PROTECTED_FIELDS.forEach(f=>{delete body[f];});
        if(!body.status)body.status=IMPORT_STATUS_DEFAULT;
        // Defensive: re-run safeDate over all known date fields
        DATE_FIELDS_TO_NORMALIZE.forEach(f=>{if(f in body)body[f]=safeDate(body[f]);});
        return body;
      });
      // Second pass: compute the union of all keys across the batch
      const allKeys=new Set();
      rawRows.forEach(r=>{Object.keys(r).forEach(k=>allKeys.add(k));});
      // Third pass: ensure every row has every key (fill missing with null) — required by PostgREST batch insert
      const batch=rawRows.map(r=>{const out={};allKeys.forEach(k=>{out[k]=(k in r&&r[k]!==undefined&&r[k]!=='')?r[k]:null;});return out;});
      try{
        const res=await fetch(`${SB}/rest/v1/jobs`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(batch)});
        if(res.ok){inserted+=batch.length;}else{const txt=await res.text();errors.push({type:'insert_batch',error:txt.substring(0,200)});}
      }catch(e){errors.push({type:'insert_batch',error:e.message});}
      setProgress({done:Math.min(i+50,preview.newJobs.length),total});
    }
    // Update existing jobs one by one (PATCH by job_number)
    const toUpdate=preview.updates.filter(u=>!skipUpdates.has(u.rowNum));
    for(let i=0;i<toUpdate.length;i++){
      const u=toUpdate[i];
      const body={};u.changes.forEach(c=>{if(!PROTECTED_FIELDS.has(c.field))body[c.field]=c.newVal;});
      // Defensive: re-run safeDate on every date field before PATCH
      DATE_FIELDS_TO_NORMALIZE.forEach(f=>{if(f in body)body[f]=safeDate(body[f]);});
      if(Object.keys(body).length===0)continue;
      try{
        const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${u.existing.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(res.ok){updated++;}else{const txt=await res.text();errors.push({type:'update',job:u.existing.job_number,error:txt.substring(0,200)});}
      }catch(e){errors.push({type:'update',job:u.existing.job_number,error:e.message});}
      setProgress({done:preview.newJobs.length+i+1,total});
    }
    setResults({inserted,updated,skipped:preview.warnings.length+skipUpdates.size,errors});
    setImporting(false);
    setStep(4);
    if(onRefresh)onRefresh();
  };

  const downloadErrorLog=()=>{
    if(!results||!results.errors.length)return;
    const rows=[['Type','Job','Error'],...results.errors.map(e=>[e.type||'',e.job||'',e.error||''])];
    const csv=rows.map(r=>r.map(v=>typeof v==='string'&&v.includes(',')?`"${v}"`:v).join(',')).join('\n');
    const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='import-errors.csv';a.click();
  };

  const reset=()=>{setStep(1);setFileName('');setWorkbook(null);setSheetNames([]);setSelectedSheet('');setRawRows([]);setHeaders([]);setMapping({});setPreview(null);setSkipUpdates(new Set());setResults(null);setError('');};
  const toggleSkipUpdate=(rowNum)=>setSkipUpdates(prev=>{const s=new Set(prev);if(s.has(rowNum))s.delete(rowNum);else s.add(rowNum);return s;});

  const stepIndicator=<div style={{display:'flex',gap:4,marginBottom:24}}>{[1,2,3,4].map(n=>{const labels={1:'Upload',2:'Mapping',3:'Preview',4:'Results'};return<div key={n} style={{flex:1,padding:'10px 14px',background:step===n?'#8B2020':step>n?'#D1FAE5':'#F4F4F2',color:step===n?'#FFF':step>n?'#065F46':'#9E9B96',borderRadius:8,fontSize:12,fontWeight:700,textAlign:'center'}}>Step {n}: {labels[n]}</div>;})}</div>;

  return(<div>
    {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:8}}>Import Projects</h1>
    <div style={{fontSize:12,color:'#9E9B96',marginBottom:12}}>Safely import the Master Project Tracker from Excel</div>
    <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#1D4ED8'}}>
      <div style={{fontWeight:800,marginBottom:4}}>ℹ️ Status mapping for new jobs:</div>
      <div style={{color:'#1E40AF',lineHeight:1.6}}>
        <b>Active Project</b> → Active Install · <b>Booked-Not Started</b> → Inventory Ready · <b>Pending / Contract Review / New</b> → Contract Review · <b>In Production</b> → In Production · <b>Closed / Complete / Pass / Cancelled / Lost</b> → Closed
      </div>
      <div style={{marginTop:6,fontSize:11,color:'#1E40AF',fontStyle:'italic'}}>Note: Status is only set on import for <b>new</b> jobs. Existing jobs keep their current app status — the kanban owns it.</div>
    </div>
    {stepIndicator}
    {error&&<div style={{background:'#FEE2E2',border:'1px solid #EF4444',borderRadius:8,padding:12,marginBottom:16,color:'#991B1B',fontSize:13,fontWeight:600}}>{error}</div>}

    {/* STEP 1: UPLOAD */}
    {step===1&&<div style={{...card,padding:40,textAlign:'center'}}>
      <div onDragOver={e=>e.preventDefault()} onDrop={handleDrop} style={{border:'3px dashed #D1CEC9',borderRadius:16,padding:60,cursor:'pointer',transition:'all .2s'}} onClick={()=>fileInputRef.current?.click()} onMouseEnter={e=>{e.currentTarget.style.borderColor='#8B2020';e.currentTarget.style.background='#FDF4F4';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#D1CEC9';e.currentTarget.style.background='transparent';}}>
        <div style={{fontSize:48,marginBottom:12}}>📤</div>
        <div style={{fontSize:16,fontWeight:700,color:'#1A1A1A',marginBottom:4}}>Drop Excel file here or click to upload</div>
        <div style={{fontSize:12,color:'#9E9B96'}}>.xlsx — pick the sheet to import (headers expected on row 1)</div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{display:'none'}}/>
      </div>
      {fileName&&<div style={{marginTop:16,fontSize:13,color:'#065F46',fontWeight:600}}>✓ {fileName} — {sheetNames.length} sheet{sheetNames.length===1?'':'s'} found</div>}
      {sheetNames.length>0&&<div style={{marginTop:20,padding:20,background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:12,display:'inline-block',textAlign:'left'}}>
        <div style={{fontSize:11,fontWeight:700,color:'#6B6056',textTransform:'uppercase',marginBottom:6}}>Select Sheet</div>
        <select value={selectedSheet} onChange={e=>setSelectedSheet(e.target.value)} style={{...inputS,fontSize:13,minWidth:260,padding:'8px 10px'}}>
          {sheetNames.map(n=><option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{marginTop:12,display:'flex',gap:8}}>
          <button onClick={reset} style={btnS}>← Cancel</button>
          <button onClick={()=>workbook&&selectedSheet&&parseSheet(workbook,selectedSheet)} disabled={!workbook||!selectedSheet} style={{...btnP,opacity:(!workbook||!selectedSheet)?0.5:1}}>Next: Mapping →</button>
        </div>
      </div>}
    </div>}

    {/* STEP 2: MAPPING */}
    {step===2&&<div style={card}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>Column Mapping — {headers.length} columns found</div>
      <div style={{maxHeight:480,overflow:'auto',border:'1px solid #E5E3E0',borderRadius:8}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6'}}><tr><th style={{textAlign:'left',padding:10,borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:700,textTransform:'uppercase'}}>Excel Column</th><th style={{textAlign:'left',padding:10,borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:700,textTransform:'uppercase'}}>→ App Field</th></tr></thead>
          <tbody>{headers.map(h=><tr key={h} style={{borderBottom:'1px solid #F4F4F2'}}>
            <td style={{padding:'8px 10px',fontWeight:500}}>{h}</td>
            <td style={{padding:'8px 10px'}}>
              <select value={mapping[h]||''} onChange={e=>setMapping(prev=>({...prev,[h]:e.target.value||undefined}))} style={{...inputS,padding:'4px 8px',fontSize:12,width:280,background:mapping[h]?'#D1FAE5':'#FFF'}}>
                <option value="">— Skip this column —</option>
                {Object.values(IMPORT_COL_MAP).map(dbCol=><option key={dbCol} value={dbCol}>{dbCol}</option>)}
              </select>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <div style={{marginTop:16,display:'flex',gap:8,justifyContent:'space-between'}}>
        <button onClick={reset} style={btnS}>← Start Over</button>
        <button onClick={buildPreview} style={btnP}>Next: Preview →</button>
      </div>
    </div>}

    {/* STEP 3: PREVIEW */}
    {step===3&&preview&&<div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #065F46'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#065F46'}}>{preview.newJobs.length}</div><div style={{fontSize:11,color:'#6B6056'}}>✅ New jobs to INSERT</div></div>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #B45309'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#B45309'}}>{preview.updates.length-skipUpdates.size}</div><div style={{fontSize:11,color:'#6B6056'}}>🔄 Existing to UPDATE</div></div>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #F59E0B'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#F59E0B'}}>{preview.warnings.length}</div><div style={{fontSize:11,color:'#6B6056'}}>⚠️ Warnings</div></div>
        <div style={{...card,padding:'12px 16px',borderLeft:'4px solid #6B7280'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:22,color:'#6B7280'}}>{PROTECTED_FIELDS.size}</div><div style={{fontSize:11,color:'#6B6056'}}>🔒 Protected fields</div></div>
      </div>
      <div style={{fontSize:11,color:'#6B6056',background:'#F9F8F6',padding:'8px 12px',borderRadius:8,marginBottom:12}}>
        <b>Protected on update (never overwritten for existing jobs):</b> status, ytd_invoiced, pct_billed, left_to_bill, material_calc_*, stage dates. The kanban, AR review, and material calculator own these fields. <b>Status IS set on insert</b> for new jobs (mapped from Excel above).
      </div>
      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:12,borderBottom:'2px solid #E5E3E0'}}>
        {[['new',`NEW JOBS (${preview.newJobs.length})`,'#065F46'],['updates',`UPDATES (${preview.updates.length})`,'#B45309'],['warnings',`WARNINGS (${preview.warnings.length})`,'#F59E0B']].map(([k,l,c])=><button key={k} onClick={()=>setPreviewTab(k)} style={{padding:'10px 18px',border:'none',background:'transparent',color:previewTab===k?c:'#6B6056',fontWeight:previewTab===k?800:400,fontSize:13,cursor:'pointer',borderBottom:previewTab===k?`3px solid ${c}`:'3px solid transparent',marginBottom:-2}}>{l}</button>)}
      </div>
      {/* Tab content */}
      <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 460px)'}}>
        {previewTab==='new'&&<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Job #','Job Name','Status (Excel → App)','Market','PM','Contract Value','Style'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:700,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{preview.newJobs.map(nj=><tr key={nj.rowNum} style={{borderBottom:'1px solid #F4F4F2',background:'#F0FDF4'}}>
            <td style={{padding:'8px 10px',fontWeight:600}}>{nj.mapped.job_number||'—'}</td>
            <td style={{padding:'8px 10px'}}>{nj.mapped.job_name||'—'}</td>
            <td style={{padding:'8px 10px',fontSize:11}}>
              {nj.statusRaw?<span style={{color:'#6B6056'}}>{nj.statusRaw}</span>:<span style={{color:'#9E9B96',fontStyle:'italic'}}>(blank)</span>}
              <span style={{color:'#9E9B96'}}> → </span>
              <span style={{color:nj.statusMatched===false?'#B45309':'#065F46',fontWeight:700}}>{SL[nj.mapped.status]||nj.mapped.status}</span>
              {nj.statusMatched===false&&nj.statusRaw&&<span style={{marginLeft:4,fontSize:10,color:'#B45309'}}>(default)</span>}
            </td>
            <td style={{padding:'8px 10px'}}>{nj.mapped.market||'—'}</td>
            <td style={{padding:'8px 10px'}}>{nj.mapped.pm||'—'}</td>
            <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{nj.mapped.contract_value?$(nj.mapped.contract_value):'—'}</td>
            <td style={{padding:'8px 10px',color:'#6B6056'}}>{nj.mapped.style||'—'}</td>
          </tr>)}
          {preview.newJobs.length===0&&<tr><td colSpan={7} style={{padding:40,textAlign:'center',color:'#9E9B96'}}>No new jobs to insert</td></tr>}</tbody>
        </table>}
        {previewTab==='updates'&&<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Skip','Job #','Job Name','Field','Current','New'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:700,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{preview.updates.flatMap(u=>u.changes.map((c,ci)=><tr key={u.rowNum+'-'+ci} style={{borderBottom:'1px solid #F4F4F2',opacity:skipUpdates.has(u.rowNum)?0.4:1}}>
            {ci===0&&<td rowSpan={u.changes.length} style={{padding:'8px 10px',verticalAlign:'top'}}><input type="checkbox" checked={!skipUpdates.has(u.rowNum)} onChange={()=>toggleSkipUpdate(u.rowNum)} style={{width:16,height:16,accentColor:'#8B2020'}}/></td>}
            {ci===0&&<td rowSpan={u.changes.length} style={{padding:'8px 10px',fontWeight:600,verticalAlign:'top'}}>{u.existing.job_number}</td>}
            {ci===0&&<td rowSpan={u.changes.length} style={{padding:'8px 10px',verticalAlign:'top',maxWidth:220}}><div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.existing.job_name}</div><div style={{fontSize:10,color:'#9E9B96',marginTop:2}}>Keeping: <b style={{color:'#6B6056'}}>{SL[u.existing.status]||u.existing.status||'—'}</b></div></td>}
            <td style={{padding:'8px 10px',fontSize:11,color:'#6B6056'}}>{c.field}</td>
            <td style={{padding:'8px 10px',fontSize:11,color:'#991B1B',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.cur!=null?String(c.cur):'—'}</td>
            <td style={{padding:'8px 10px',fontSize:11,fontWeight:700,background:'#FEF3C7',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{String(c.newVal)}</td>
          </tr>))}
          {preview.updates.length===0&&<tr><td colSpan={6} style={{padding:40,textAlign:'center',color:'#9E9B96'}}>No updates — all existing jobs match Excel values</td></tr>}</tbody>
        </table>}
        {previewTab==='warnings'&&<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Row #','Issue','Data'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:700,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{preview.warnings.map((w,i)=><tr key={i} style={{borderBottom:'1px solid #F4F4F2',background:'#FFFBEB'}}>
            <td style={{padding:'8px 10px'}}>{w.row}</td>
            <td style={{padding:'8px 10px',color:'#B45309',fontWeight:600}}>{w.issue}</td>
            <td style={{padding:'8px 10px',fontSize:11,color:'#9E9B96',maxWidth:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{w.data}</td>
          </tr>)}
          {preview.warnings.length===0&&<tr><td colSpan={3} style={{padding:40,textAlign:'center',color:'#9E9B96'}}>No warnings — all rows valid</td></tr>}</tbody>
        </table>}
      </div>
      <div style={{marginTop:16,display:'flex',gap:8,justifyContent:'space-between'}}>
        <button onClick={()=>setStep(2)} style={btnS}>← Back</button>
        <button onClick={runImport} disabled={preview.newJobs.length===0&&preview.updates.length-skipUpdates.size===0} style={{...btnP,opacity:(preview.newJobs.length===0&&preview.updates.length-skipUpdates.size===0)?0.4:1}}>Import Now →</button>
      </div>
    </div>}

    {/* STEP 4: RESULTS */}
    {step===4&&<div>
      {importing?<div style={{...card,padding:40,textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:12}}>⚙️</div>
        <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>Importing... {progress.done} / {progress.total}</div>
        <div style={{height:12,background:'#E5E3E0',borderRadius:12,overflow:'hidden',maxWidth:400,margin:'0 auto'}}><div style={{height:'100%',width:`${progress.total>0?progress.done/progress.total*100:0}%`,background:'#8B2020',transition:'width .3s'}}/></div>
      </div>:results&&<div>
        <div style={{...card,padding:24,marginBottom:16}}>
          <div style={{fontSize:18,fontWeight:800,marginBottom:16,color:results.errors.length>0?'#B45309':'#065F46'}}>{results.errors.length>0?'⚠️ Import complete with errors':'✅ Import complete!'}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:24,color:'#065F46'}}>{results.inserted}</div><div style={{fontSize:11,color:'#6B6056'}}>Inserted</div></div>
            <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:24,color:'#B45309'}}>{results.updated}</div><div style={{fontSize:11,color:'#6B6056'}}>Updated</div></div>
            <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:24,color:'#6B7280'}}>{results.skipped}</div><div style={{fontSize:11,color:'#6B6056'}}>Skipped</div></div>
            <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:24,color:'#991B1B'}}>{results.errors.length}</div><div style={{fontSize:11,color:'#6B6056'}}>Errors</div></div>
          </div>
        </div>
        {results.errors.length>0&&<div style={{...card,padding:16,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:'#991B1B'}}>Errors ({results.errors.length})</div>
          <div style={{maxHeight:200,overflow:'auto'}}>{results.errors.slice(0,20).map((e,i)=><div key={i} style={{fontSize:11,color:'#6B6056',padding:'4px 0',borderBottom:'1px solid #F4F4F2'}}><b style={{color:'#991B1B'}}>{e.type}</b> {e.job?`— ${e.job}`:''} — {e.error}</div>)}</div>
          {results.errors.length>20&&<div style={{fontSize:11,color:'#9E9B96',marginTop:6}}>+{results.errors.length-20} more</div>}
        </div>}
        <div style={{display:'flex',gap:8}}>
          {onNav&&<button onClick={()=>onNav('projects')} style={btnP}>View Projects</button>}
          {results.errors.length>0&&<button onClick={downloadErrorLog} style={btnS}>Download Error Log</button>}
          <button onClick={reset} style={btnS}>Import Another File</button>
        </div>
      </div>}
    </div>}
  </div>);
}

/* ═══ MAP PAGE ═══ */
const MKT_COORDS={Austin:[30.2672,-97.7431],'Dallas-Fort Worth':[32.7767,-96.7970],Houston:[29.7604,-95.3698],'San Antonio':[29.4241,-98.4936]};
const MKT_PIN={Austin:'#FB923C','Dallas-Fort Worth':'#60A5FA',Houston:'#34D399','San Antonio':'#F472B6'};
function FitBounds({positions}){const map=useMap();useEffect(()=>{if(positions.length>0){const b=L.latLngBounds(positions);map.fitBounds(b,{padding:[40,40]});}},[positions,map]);return null;}
function MapPage({jobs,onNav}){
  const[pins,setPins]=useState([]);const[geocoding,setGeocoding]=useState(false);const[geoProgress,setGeoProgress]=useState('');
  const[mktF,setMktF]=useState(null);const[statusF,setStatusF]=useState(null);
  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  useEffect(()=>{let cancelled=false;
    const run=async()=>{setGeocoding(true);const result=[];let toGeo=0;
      for(const j of activeJobs){
        if(j.lat&&j.lng){result.push({...j,lat:n(j.lat),lng:n(j.lng)});continue;}
        toGeo++;
      }
      // Batch geocode jobs without coords
      const needGeo=activeJobs.filter(j=>!j.lat||!j.lng);
      setGeoProgress(`Locating ${needGeo.length} jobs...`);
      for(let i=0;i<needGeo.length;i++){
        if(cancelled)return;const j=needGeo[i];
        setGeoProgress(`Locating ${i+1}/${needGeo.length}...`);
        const q=`${j.address||''} ${j.city||''} ${j.state||'TX'}`.trim();
        let lat=0,lng=0;
        if(q.length>3){try{const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,{headers:{'User-Agent':'FencecreteOps/1.0'}});const d=await r.json();if(d&&d[0]){lat=parseFloat(d[0].lat);lng=parseFloat(d[0].lon);}}catch(e){}}
        // Fallback to market center
        if(!lat&&j.market&&MKT_COORDS[j.market]){const c=MKT_COORDS[j.market];lat=c[0]+(Math.random()-0.5)*0.05;lng=c[1]+(Math.random()-0.5)*0.05;}
        if(lat&&lng){try{sbPatch('jobs',j.id,{lat,lng});}catch(e){}result.push({...j,lat,lng});}
        if(i<needGeo.length-1&&q.length>3)await new Promise(r=>setTimeout(r,1100));
      }
      // Add already-geocoded
      for(const j of activeJobs){if(j.lat&&j.lng&&!result.some(r=>r.id===j.id))result.push({...j,lat:n(j.lat),lng:n(j.lng)});}
      if(!cancelled){setPins(result);setGeocoding(false);}
    };run();return()=>{cancelled=true;};
  },[activeJobs]);
  const filtered=useMemo(()=>{let f=pins;if(mktF)f=f.filter(j=>j.market===mktF);if(statusF)f=f.filter(j=>j.status===statusF);return f;},[pins,mktF,statusF]);
  const fTC=filtered.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);
  const fLTB=filtered.reduce((s,j)=>s+n(j.left_to_bill),0);
  const positions=filtered.filter(j=>j.lat&&j.lng).map(j=>[j.lat,j.lng]);
  return(<div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 96px)'}}>
    <div style={{display:'flex',gap:8,padding:'0 0 12px',flexWrap:'wrap',alignItems:'center'}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,margin:0,marginRight:12}}>Map</h1>
      <button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>
      {MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}
      <span style={{color:'#E5E3E0'}}>|</span>
      <button onClick={()=>setStatusF(null)} style={fpill(!statusF)}>All Statuses</button>
      {STS.filter(s=>!CLOSED_SET.has(s)).map(s=><button key={s} onClick={()=>setStatusF(s)} style={fpill(statusF===s)}>{SS[s]}</button>)}
      <span style={{fontSize:12,color:'#6B6056',marginLeft:8}}>{filtered.length} jobs | {$k(fTC)} contract | {$k(fLTB)} LTB</span>
    </div>
    {geocoding&&<div style={{padding:'8px 0',fontSize:12,color:'#6B6056'}}>{geoProgress}</div>}
    <div style={{flex:1,borderRadius:12,overflow:'hidden',border:'1px solid #E5E3E0',position:'relative'}}>
      <MapContainer center={[31.0,-99.0]} zoom={6} style={{height:'100%',width:'100%'}} scrollWheelZoom={true}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap'/>
        {positions.length>1&&<FitBounds positions={positions}/>}
        <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
          {filtered.filter(j=>j.lat&&j.lng).map(j=><CircleMarker key={j.id} center={[j.lat,j.lng]} radius={10} pathOptions={{fillColor:MKT_PIN[j.market]||'#8B2020',color:'#1A1A1A',weight:2,fillOpacity:0.85}}>
            <Popup maxWidth={280}><div style={{fontFamily:'Inter,sans-serif',fontSize:13}}>
              <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>{j.job_name}</div>
              <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:'#6B6056'}}>#{j.job_number}</span>
                <span style={{...pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2'),display:'inline-block'}}>{MS[j.market]||'—'}</span>
                <span style={{...pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2'),display:'inline-block'}}>{SS[j.status]||j.status}</span>
              </div>
              {j.pm&&<div style={{fontSize:11,color:'#6B6056',marginBottom:2}}>PM: {j.pm}</div>}
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:2}}><span style={{color:'#6B6056'}}>Contract</span><span style={{fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:2}}><span style={{color:'#6B6056'}}>Left to Bill</span><span style={{fontWeight:700,color:'#8B2020'}}>{$(j.left_to_bill)}</span></div>
              {j.est_start_date&&<div style={{fontSize:11,color:'#6B6056'}}>Est. Start: {fD(j.est_start_date)}</div>}
              <button onClick={()=>{if(onNav)onNav('projects',j);}} style={{marginTop:8,padding:'6px 14px',background:'#8B2020',color:'#fff',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',width:'100%'}}>View Job</button>
            </div></Popup>
          </CircleMarker>)}
        </MarkerClusterGroup>
      </MapContainer>
      {/* Legend */}
      <div style={{position:'absolute',bottom:24,right:12,background:'rgba(255,255,255,0.92)',borderRadius:8,padding:'8px 12px',zIndex:1000,border:'1px solid #E5E3E0',display:'flex',gap:10,fontSize:11}}>
        {MKTS.map(m=><div key={m} style={{display:'flex',alignItems:'center',gap:3}}><div style={{width:10,height:10,borderRadius:5,background:MKT_PIN[m],border:'1.5px solid #1A1A1A'}}/>{MS[m]}</div>)}
      </div>
    </div>
  </div>);
}

/* ═══ MATERIAL REQUESTS — digitized PMR form ═══ */
const MR_REQUESTERS=['Ray Garcia','Manuel Salazar','Rafael Anaya Jr.','Doug Monroe'];
const MR_ITEM_TYPES=['Line Post','Corner Post','Stop Post','Panel','Rail','Post Cap','Rebar','Cement','Caulking'];
const MR_PANEL_SIZES=['Full','Bottoms','2 Regular','1/2 Long','Center','Middle','Diamond','Bottled'];
const MR_RAIL_SIZES=['Top','Center','Bottom','Top (short)','Short'];
// Builds the default line-items list. Post rows are regenerated whenever heights change;
// panel/rail/cap rows are static.
const buildDefaultMRItems=(h1,h2)=>{
  const rows=[];
  const postHeightRows=(h)=>{
    if(!h||!String(h).trim())return[];
    return[
      {group:'POSTS',size_design:h,item_type:'Line Post',mat_qty_each:'',ship_date:'',backorder:false,notes:''},
      {group:'POSTS',size_design:h,item_type:'Corner Post',mat_qty_each:'',ship_date:'',backorder:false,notes:''},
      {group:'POSTS',size_design:h,item_type:'Stop Post',mat_qty_each:'',ship_date:'',backorder:false,notes:''},
    ];
  };
  rows.push(...postHeightRows(h1));
  if(h2&&String(h2).trim()&&h2!==h1)rows.push(...postHeightRows(h2));
  MR_PANEL_SIZES.forEach(s=>rows.push({group:'PANELS',size_design:s,item_type:'Panel',mat_qty_each:'',ship_date:'',backorder:false,notes:''}));
  MR_RAIL_SIZES.forEach(s=>rows.push({group:'RAILS',size_design:s,item_type:'Rail',mat_qty_each:'',ship_date:'',backorder:false,notes:''}));
  rows.push({group:'CAPS & OTHER',size_design:'Line',item_type:'Post Cap',mat_qty_each:'',ship_date:'',backorder:false,notes:''});
  rows.push({group:'CAPS & OTHER',size_design:'Stop',item_type:'Post Cap',mat_qty_each:'',ship_date:'',backorder:false,notes:''});
  rows.push({group:'CAPS & OTHER',size_design:'—',item_type:'Rebar',mat_qty_each:'',ship_date:'',backorder:false,notes:''});
  rows.push({group:'CAPS & OTHER',size_design:'—',item_type:'Cement',mat_qty_each:'',ship_date:'',backorder:false,notes:''});
  rows.push({group:'CAPS & OTHER',size_design:'—',item_type:'Caulking',mat_qty_each:'',ship_date:'',backorder:false,notes:''});
  return rows;
};
const MR_STATUS_STYLE={
  pending:{bg:'#FEF3C7',color:'#B45309',label:'Pending'},
  confirmed:{bg:'#DBEAFE',color:'#1D4ED8',label:'Confirmed'},
  fulfilled:{bg:'#D1FAE5',color:'#065F46',label:'Fulfilled'},
  cancelled:{bg:'#F4F4F2',color:'#6B6056',label:'Cancelled'},
};
function MaterialRequestsPage({jobs,refreshKey=0}){
  const todayISO=new Date().toISOString().split('T')[0];
  const[tab,setTab]=useState('new');
  const[toast,setToast]=useState(null);
  // ─── New Request Form ───
  const emptyForm=()=>({request_date:todayISO,requested_by:'',projected_start_date:'',job_number:'',job_name:'',address:'',city_state_zip:'',crew_on_job:'',material_style:'',color_name:'',color_code:'',height_of_fence:'',linear_feet:'',second_height:'',second_linear_feet:'',notes:''});
  // Hydrate form from localStorage if a job was pre-selected from the Edit Panel
  const initialFormFromPrefill=()=>{
    try{
      const raw=localStorage.getItem('fc_matreq_prejob');
      if(!raw)return emptyForm();
      const p=JSON.parse(raw);
      localStorage.removeItem('fc_matreq_prejob');// consume once
      return{
        request_date:todayISO,
        requested_by:'',
        projected_start_date:'',
        job_number:p.job_number||'',
        job_name:p.job_name||'',
        address:p.address||'',
        city_state_zip:[p.city,p.state,p.zip].filter(Boolean).join(', '),
        crew_on_job:'',
        material_style:p.style||'',
        color_name:p.color||'',
        color_code:'',
        height_of_fence:p.height_precast?String(p.height_precast):'',
        linear_feet:p.lf_precast?String(p.lf_precast):'',
        second_height:p.height_other?String(p.height_other):'',
        second_linear_feet:p.lf_other?String(p.lf_other):'',
        notes:''
      };
    }catch(e){return emptyForm();}
  };
  const initialForm=useMemo(initialFormFromPrefill,[]);// eslint-disable-line
  const wasPrefilled=!!initialForm.job_number;
  const[form,setForm]=useState(initialForm);
  const[items,setItems]=useState(()=>buildDefaultMRItems(initialForm.height_of_fence,initialForm.second_height));
  // If we pre-filled, land on the New Request tab
  useEffect(()=>{if(wasPrefilled)setTab('new');},[wasPrefilled]);
  const[saving,setSaving]=useState(false);
  const[saveErr,setSaveErr]=useState(null);
  const[jobSearch,setJobSearch]=useState('');
  const[showJobDD,setShowJobDD]=useState(false);
  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));
  // Regenerate POSTS rows when heights change, preserve all other rows' quantities
  const prevHeightsRef=useRef({h1:'',h2:''});
  useEffect(()=>{
    const prev=prevHeightsRef.current;
    if(prev.h1===form.height_of_fence&&prev.h2===form.second_height)return;
    prevHeightsRef.current={h1:form.height_of_fence,h2:form.second_height};
    setItems(curr=>{
      const nonPosts=curr.filter(r=>r.group!=='POSTS');
      const newPosts=buildDefaultMRItems(form.height_of_fence,form.second_height).filter(r=>r.group==='POSTS');
      return[...newPosts,...nonPosts];
    });
  },[form.height_of_fence,form.second_height]);
  // Job autocomplete — filter jobs as user types
  const jobMatches=useMemo(()=>{
    const q=(jobSearch||'').toLowerCase().trim();
    if(!q)return[];
    return jobs.filter(j=>j.status!=='closed'&&((j.job_number||'').toLowerCase().includes(q)||(j.job_name||'').toLowerCase().includes(q))).slice(0,8);
  },[jobSearch,jobs]);
  const pickJob=(j)=>{
    setForm(p=>({...p,job_number:j.job_number||'',job_name:j.job_name||'',address:j.address||'',city_state_zip:[j.city,j.state,j.zip].filter(Boolean).join(', '),material_style:j.style||p.material_style,color_name:j.color||p.color_name,height_of_fence:j.height_precast?String(j.height_precast):p.height_of_fence,linear_feet:j.lf_precast?String(j.lf_precast):(j.total_lf_precast?String(j.total_lf_precast):p.linear_feet)}));
    setJobSearch(j.job_number||j.job_name||'');
    setShowJobDD(false);
  };
  const updateItem=(idx,key,val)=>setItems(prev=>prev.map((r,i)=>i===idx?{...r,[key]:val}:r));
  const removeItem=(idx)=>setItems(prev=>prev.filter((_,i)=>i!==idx));
  const addCustomItem=()=>setItems(prev=>[...prev,{group:'CUSTOM',size_design:'',item_type:MR_ITEM_TYPES[0],mat_qty_each:'',ship_date:'',backorder:false,notes:''}]);
  // Submit handler
  const submit=async()=>{
    if(!form.job_number||!form.requested_by){setSaveErr('Job Code and Requested By are required');return;}
    const filled=items.filter(r=>n(r.mat_qty_each)>0);
    if(filled.length===0){setSaveErr('Add at least one line item with quantity > 0');return;}
    setSaving(true);setSaveErr(null);
    try{
      const body={
        request_date:form.request_date||null,
        requested_by:form.requested_by||null,
        job_number:form.job_number||null,
        job_name:form.job_name||null,
        address:form.address||null,
        city_state_zip:form.city_state_zip||null,
        crew_on_job:form.crew_on_job||null,
        material_style:form.material_style||null,
        color_name:form.color_name||null,
        color_code:form.color_code||null,
        height_of_fence:form.height_of_fence||null,
        linear_feet:n(form.linear_feet)||null,
        second_height:form.second_height||null,
        second_linear_feet:n(form.second_linear_feet)||null,
        projected_start_date:form.projected_start_date||null,
        status:'pending',
        notes:form.notes||null,
      };
      const saved=await sbPost('material_requests',body);
      if(!saved||!saved[0]||!saved[0].id)throw new Error('Request insert returned no data');
      const req=saved[0];
      const dbItems=filled.map(r=>({request_id:req.id,size_design:r.size_design||null,item_type:r.item_type||null,mat_qty_each:n(r.mat_qty_each)||0,ship_date:r.ship_date||null,backorder:!!r.backorder,notes:r.notes||null}));
      await sbPost('material_request_items',dbItems);
      // Fire email alert (non-blocking)
      fetch(`${SB}/functions/v1/billing-alerts`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({type:'material_request',jobNumber:form.job_number,jobName:form.job_name,requestedBy:form.requested_by,linearFeet:n(form.linear_feet),height:form.height_of_fence,style:form.material_style,color:form.color_name,projectedStartDate:form.projected_start_date,itemCount:filled.length,recipients:['max@fencecrete.com','carlos@fencecrete.com'],subject:`New Material Request — ${form.job_name} (${form.job_number})`})}).catch(e=>console.error('[MR email] failed:',e));
      setToast({msg:`Material request submitted for ${form.job_name}`,ok:true});
      setForm(emptyForm());
      setItems(buildDefaultMRItems('',''));
      setJobSearch('');
      setTab('queue');
      fetchRequests();
    }catch(e){
      console.error('[MR submit] failed:',e);
      setSaveErr(e.message||'Submit failed');
    }
    setSaving(false);
  };
  // ─── Request Queue ───
  const[requests,setRequests]=useState([]);
  const[reqItems,setReqItems]=useState({});
  const[queueFilter,setQueueFilter]=useState('all');
  const[expandedId,setExpandedId]=useState(null);
  const[confirmForm,setConfirmForm]=useState({confirmed_by:'',estimated_ship_date:'',notes:''});
  const[cancelConfirmId,setCancelConfirmId]=useState(null);
  const fetchRequests=useCallback(async()=>{
    try{const d=await sbGet('material_requests','select=*&order=created_at.desc&limit=200');setRequests(d||[]);}
    catch(e){console.error('[MR fetch] failed:',e);}
  },[]);
  useEffect(()=>{fetchRequests();},[fetchRequests,refreshKey]);
  const loadItemsFor=useCallback(async(reqId)=>{
    if(reqItems[reqId])return;
    try{const d=await sbGet('material_request_items',`select=*&request_id=eq.${reqId}&order=id.asc`);setReqItems(prev=>({...prev,[reqId]:d||[]}));}
    catch(e){console.error('[MR items fetch] failed:',e);}
  },[reqItems]);
  const toggleExpand=(id)=>{if(expandedId===id){setExpandedId(null);}else{setExpandedId(id);loadItemsFor(id);}};
  const filteredRequests=useMemo(()=>queueFilter==='all'?requests:requests.filter(r=>r.status===queueFilter),[requests,queueFilter]);
  const confirmReceipt=async(req)=>{
    if(!confirmForm.confirmed_by||!confirmForm.estimated_ship_date){setToast({msg:'Confirmed By and Ship Date are required',ok:false});return;}
    try{
      const patch={status:'confirmed',confirmed_by:confirmForm.confirmed_by,confirmed_at:new Date().toISOString(),estimated_ship_date:confirmForm.estimated_ship_date,notes:confirmForm.notes||req.notes||null,updated_at:new Date().toISOString()};
      await sbPatch('material_requests',req.id,patch);
      setRequests(prev=>prev.map(r=>r.id===req.id?{...r,...patch}:r));
      setConfirmForm({confirmed_by:'',estimated_ship_date:'',notes:''});
      fetch(`${SB}/functions/v1/billing-alerts`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({type:'material_request_confirmed',jobNumber:req.job_number,jobName:req.job_name,requestedBy:req.requested_by,confirmedBy:confirmForm.confirmed_by,estimatedShipDate:confirmForm.estimated_ship_date,subject:`Material Request Confirmed — ${req.job_name}`})}).catch(()=>{});
      setToast({msg:'Request confirmed — PM notified',ok:true});
    }catch(e){console.error('[MR confirm] failed:',e);setToast({msg:e.message||'Confirm failed',ok:false});}
  };
  const markFulfilled=async(req)=>{
    try{
      const patch={status:'fulfilled',updated_at:new Date().toISOString()};
      await sbPatch('material_requests',req.id,patch);
      setRequests(prev=>prev.map(r=>r.id===req.id?{...r,...patch}:r));
      fetch(`${SB}/functions/v1/billing-alerts`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({type:'material_request_fulfilled',jobNumber:req.job_number,jobName:req.job_name,requestedBy:req.requested_by,subject:`Material Request Fulfilled — ${req.job_name}`})}).catch(()=>{});
      setToast({msg:'Request marked fulfilled — PM notified',ok:true});
    }catch(e){console.error('[MR fulfill] failed:',e);setToast({msg:e.message||'Update failed',ok:false});}
  };
  const cancelRequest=async(req)=>{
    try{
      const patch={status:'cancelled',updated_at:new Date().toISOString()};
      await sbPatch('material_requests',req.id,patch);
      setRequests(prev=>prev.map(r=>r.id===req.id?{...r,...patch}:r));
      setCancelConfirmId(null);
      setToast({msg:'Request cancelled',ok:true});
    }catch(e){console.error('[MR cancel] failed:',e);setToast({msg:e.message||'Cancel failed',ok:false});}
  };
  // ─── Render helpers ───
  const lbl={display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600};
  const sectionHdr={fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10,paddingBottom:6,borderBottom:'1px solid #E5E3E0'};
  const grd2={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:16};
  const countCounts=useMemo(()=>({
    all:requests.length,
    pending:requests.filter(r=>r.status==='pending').length,
    confirmed:requests.filter(r=>r.status==='confirmed').length,
    fulfilled:requests.filter(r=>r.status==='fulfilled').length,
  }),[requests]);
  return(<div>
    {toast&&<Toast message={toast.msg} isError={toast.ok===false} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:8}}>Material Requests</h1>
    <div style={{fontSize:12,color:'#9E9B96',marginBottom:16}}>Digital PMR form — request materials from the production plant</div>
    {/* Tabs */}
    <div style={{display:'flex',gap:6,marginBottom:16}}>
      <button onClick={()=>setTab('new')} style={{padding:'8px 18px',borderRadius:8,border:tab==='new'?'2px solid #8B2020':'1px solid #E5E3E0',background:tab==='new'?'#FDF4F4':'#FFF',color:tab==='new'?'#8B2020':'#6B6056',fontWeight:700,fontSize:13,cursor:'pointer'}}>+ New Request</button>
      <button onClick={()=>setTab('queue')} style={{padding:'8px 18px',borderRadius:8,border:tab==='queue'?'2px solid #8B2020':'1px solid #E5E3E0',background:tab==='queue'?'#FDF4F4':'#FFF',color:tab==='queue'?'#8B2020':'#6B6056',fontWeight:700,fontSize:13,cursor:'pointer'}}>Request Queue ({requests.length})</button>
    </div>
    {/* NEW REQUEST FORM */}
    {tab==='new'&&<div>
      <div style={{background:'#8B2020',color:'#FFF',padding:'14px 20px',borderRadius:'10px 10px 0 0',fontFamily:'Syne',fontSize:16,fontWeight:800}}>Project Material Request</div>
      <div style={{...card,borderRadius:'0 0 10px 10px',borderTop:'none',padding:20}}>
        {saveErr&&<div style={{background:'#FEE2E2',border:'1px solid #DC2626',borderRadius:8,padding:'10px 14px',marginBottom:14,color:'#991B1B',fontSize:12,fontWeight:600}}>⚠ {saveErr}</div>}
        {/* Request Info */}
        <div style={sectionHdr}>Request Info</div>
        <div style={grd2}>
          <div><label style={lbl}>Request Date</label><input type="date" value={form.request_date} onChange={e=>setF('request_date',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>Requested By *</label><select value={form.requested_by} onChange={e=>setF('requested_by',e.target.value)} style={inputS}><option value="">— Select —</option>{MR_REQUESTERS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
          <div><label style={lbl}>Projected Start Date</label><input type="date" value={form.projected_start_date} onChange={e=>setF('projected_start_date',e.target.value)} style={inputS}/></div>
        </div>
        {/* Job Info */}
        <div style={sectionHdr}>Job Info</div>
        <div style={grd2}>
          <div style={{position:'relative'}}>
            <label style={lbl}>Job Code *</label>
            <input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setShowJobDD(true);setF('job_number',e.target.value);}} onFocus={()=>setShowJobDD(true)} onBlur={()=>setTimeout(()=>setShowJobDD(false),200)} placeholder="Search jobs..." style={inputS}/>
            {showJobDD&&jobMatches.length>0&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:50,marginTop:2,maxHeight:240,overflow:'auto'}}>
              {jobMatches.map(j=><div key={j.id} onMouseDown={()=>pickJob(j)} style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid #F4F4F2',fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background='#FDF4F4'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{fontWeight:700,color:'#1A1A1A'}}>{j.job_number}</div>
                <div style={{color:'#6B6056'}}>{j.job_name}</div>
              </div>)}
            </div>}
          </div>
          <div><label style={lbl}>Project Name</label><input value={form.job_name} onChange={e=>setF('job_name',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>Address</label><input value={form.address} onChange={e=>setF('address',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>City, State, Zip</label><input value={form.city_state_zip} onChange={e=>setF('city_state_zip',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>Crew on Job</label><input value={form.crew_on_job} onChange={e=>setF('crew_on_job',e.target.value)} style={inputS}/></div>
        </div>
        {/* Material Info */}
        <div style={sectionHdr}>Material Info</div>
        <div style={grd2}>
          <div><label style={lbl}>Material Style</label><input value={form.material_style} onChange={e=>setF('material_style',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>Color Name</label><input value={form.color_name} onChange={e=>setF('color_name',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>Color Code</label><input value={form.color_code} onChange={e=>setF('color_code',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>Height of Fence</label><input value={form.height_of_fence} onChange={e=>setF('height_of_fence',e.target.value)} placeholder="e.g. 8 or 8' Combo" style={inputS}/></div>
          <div><label style={lbl}>Linear Feet</label><input type="number" value={form.linear_feet} onChange={e=>setF('linear_feet',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>2nd Height (optional)</label><input value={form.second_height} onChange={e=>setF('second_height',e.target.value)} style={inputS}/></div>
          <div><label style={lbl}>2nd Linear Feet (optional)</label><input type="number" value={form.second_linear_feet} onChange={e=>setF('second_linear_feet',e.target.value)} style={inputS}/></div>
        </div>
        {/* Material Line Items */}
        <div style={sectionHdr}>Material Line Items</div>
        <div style={{border:'1px solid #E5E3E0',borderRadius:8,overflow:'auto',marginBottom:14}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr style={{background:'#F9F8F6'}}>
              {['Size / Design','Type','Mat. Qty Each','Ship Date','Backorder','Notes',''].map(h=><th key={h} style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(()=>{
                const out=[];
                let lastGroup=null;
                items.forEach((row,idx)=>{
                  if(row.group!==lastGroup){
                    out.push(<tr key={`hdr-${row.group}-${idx}`} style={{background:'#FDF4F4'}}>
                      <td colSpan={7} style={{padding:'6px 10px',fontSize:10,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5}}>{row.group}</td>
                    </tr>);
                    lastGroup=row.group;
                  }
                  const isEmpty=!n(row.mat_qty_each);
                  const td={padding:'6px 10px',borderBottom:'1px solid #F4F4F2',verticalAlign:'middle',opacity:isEmpty?0.55:1};
                  const inp={...inputS,padding:'4px 8px',fontSize:12};
                  out.push(<tr key={idx} style={{background:idx%2===0?'#FFF':'#FAFAF8'}}>
                    <td style={td}>{row.group==='CUSTOM'?<input value={row.size_design} onChange={e=>updateItem(idx,'size_design',e.target.value)} placeholder="Size" style={{...inp,width:90}}/>:row.size_design}</td>
                    <td style={td}>{row.group==='CUSTOM'?<select value={row.item_type} onChange={e=>updateItem(idx,'item_type',e.target.value)} style={{...inp,width:120}}>{MR_ITEM_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select>:row.item_type}</td>
                    <td style={td}><input type="number" value={row.mat_qty_each} onChange={e=>updateItem(idx,'mat_qty_each',e.target.value)} style={{...inp,width:70,fontWeight:700}}/></td>
                    <td style={td}><input type="date" value={row.ship_date} onChange={e=>updateItem(idx,'ship_date',e.target.value)} style={{...inp,width:135}}/></td>
                    <td style={{...td,textAlign:'center'}}><input type="checkbox" checked={!!row.backorder} onChange={e=>updateItem(idx,'backorder',e.target.checked)} style={{accentColor:'#8B2020',width:16,height:16}}/></td>
                    <td style={td}><input value={row.notes} onChange={e=>updateItem(idx,'notes',e.target.value)} style={{...inp,width:'100%',minWidth:100}}/></td>
                    <td style={td}>{row.group==='CUSTOM'?<button onClick={()=>removeItem(idx)} style={{background:'none',border:'none',color:'#DC2626',fontSize:14,cursor:'pointer'}} title="Remove">×</button>:null}</td>
                  </tr>);
                });
                return out;
              })()}
            </tbody>
          </table>
        </div>
        <button onClick={addCustomItem} style={{...btnS,marginBottom:14,padding:'6px 14px',fontSize:12}}>+ Add Custom Item</button>
        {/* Extra Notes */}
        <div style={sectionHdr}>Extra Notes</div>
        <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={3} placeholder="Additional instructions, special requirements, delivery notes..." style={{...inputS,resize:'vertical',marginBottom:14}}/>
        {/* Submit */}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={()=>{setForm(emptyForm());setItems(buildDefaultMRItems('',''));setJobSearch('');setSaveErr(null);}} style={btnS}>Clear Form</button>
          <button onClick={submit} disabled={saving} style={{...btnP,padding:'10px 24px',fontSize:14,opacity:saving?0.5:1}}>{saving?'Submitting...':'Submit Request'}</button>
        </div>
      </div>
    </div>}
    {/* REQUEST QUEUE */}
    {tab==='queue'&&<div>
      {/* Filter pills */}
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
        {[['all','All'],['pending','Pending'],['confirmed','Confirmed'],['fulfilled','Fulfilled'],['cancelled','Cancelled']].map(([k,l])=><button key={k} onClick={()=>setQueueFilter(k)} style={{padding:'6px 14px',borderRadius:20,border:queueFilter===k?'2px solid #8B2020':'1px solid #E5E3E0',background:queueFilter===k?'#FDF4F4':'#FFF',color:queueFilter===k?'#8B2020':'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>{l} ({countCounts[k]??requests.filter(r=>r.status===k).length})</button>)}
      </div>
      {filteredRequests.length===0?<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No material requests{queueFilter!=='all'?` with status "${queueFilter}"`:''}</div>:<div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filteredRequests.map(r=>{
          const s=MR_STATUS_STYLE[r.status]||MR_STATUS_STYLE.pending;
          const isExp=expandedId===r.id;
          const isCancelConfirm=cancelConfirmId===r.id;
          return<div key={r.id} style={{...card,padding:0,overflow:'hidden',borderLeft:`4px solid ${s.color}`}}>
            <div onClick={()=>toggleExpand(r.id)} style={{padding:'14px 18px',cursor:'pointer'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4,flexWrap:'wrap'}}>
                    <span style={{display:'inline-block',padding:'3px 10px',borderRadius:12,background:s.bg,color:s.color,fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:0.5}}>{s.label}</span>
                    <span style={{fontFamily:'Inter',fontSize:11,color:'#9E9B96',fontWeight:600}}>#{r.job_number||'—'}</span>
                    <span style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{r.job_name||'—'}</span>
                  </div>
                  <div style={{fontSize:11,color:'#6B6056',display:'flex',gap:14,flexWrap:'wrap'}}>
                    <span>Requested by <b style={{color:'#1A1A1A'}}>{r.requested_by||'—'}</b></span>
                    <span>{fD(r.request_date)}</span>
                    {r.height_of_fence&&<span>Height: <b style={{color:'#1A1A1A'}}>{r.height_of_fence}</b></span>}
                    {n(r.linear_feet)>0&&<span>LF: <b style={{color:'#1A1A1A'}}>{n(r.linear_feet).toLocaleString()}</b></span>}
                    {r.material_style&&<span>Style: <b style={{color:'#1A1A1A'}}>{r.material_style}</b></span>}
                    {r.color_name&&<span>Color: <b style={{color:'#1A1A1A'}}>{r.color_name}</b></span>}
                    {r.projected_start_date&&<span>Start: <b style={{color:'#1A1A1A'}}>{fD(r.projected_start_date)}</b></span>}
                  </div>
                  {r.status==='confirmed'&&<div style={{marginTop:6,fontSize:11,color:'#1D4ED8',fontWeight:600}}>✓ Confirmed by {r.confirmed_by||'—'}{r.estimated_ship_date?` — Ship: ${fD(r.estimated_ship_date)}`:''}</div>}
                </div>
                <span style={{fontSize:12,color:'#9E9B96'}}>{isExp?'▲':'▼'}</span>
              </div>
            </div>
            {isExp&&<div style={{padding:'0 18px 18px',borderTop:'1px solid #E5E3E0'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10,marginTop:12,fontSize:12}}>
                {[['Address',r.address],['City/State/Zip',r.city_state_zip],['Crew',r.crew_on_job],['Color Code',r.color_code],['2nd Height',r.second_height],['2nd LF',r.second_linear_feet]].filter(([,v])=>v).map(([l,v])=><div key={l}><div style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>{l}</div><div style={{fontWeight:600,color:'#1A1A1A'}}>{v}</div></div>)}
              </div>
              {/* Items table */}
              <div style={{marginTop:14}}>
                <div style={{fontSize:11,fontWeight:800,color:'#8B2020',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>Line Items</div>
                {!reqItems[r.id]?<div style={{padding:12,color:'#9E9B96',fontSize:12}}>Loading...</div>:reqItems[r.id].length===0?<div style={{padding:12,color:'#9E9B96',fontSize:12}}>No items</div>:<div style={{border:'1px solid #E5E3E0',borderRadius:6,overflow:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead><tr style={{background:'#F9F8F6'}}>{['Size','Type','Qty','Ship Date','Backorder','Notes'].map(h=><th key={h} style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',borderBottom:'1px solid #E5E3E0'}}>{h}</th>)}</tr></thead>
                    <tbody>{reqItems[r.id].map((it,i)=><tr key={it.id||i} style={{borderBottom:'1px solid #F4F4F2'}}>
                      <td style={{padding:'6px 10px'}}>{it.size_design||'—'}</td>
                      <td style={{padding:'6px 10px'}}>{it.item_type||'—'}</td>
                      <td style={{padding:'6px 10px',fontWeight:700}}>{it.mat_qty_each||'—'}</td>
                      <td style={{padding:'6px 10px'}}>{fD(it.ship_date)}</td>
                      <td style={{padding:'6px 10px'}}>{it.backorder?'✓':''}</td>
                      <td style={{padding:'6px 10px',color:'#6B6056'}}>{it.notes||''}</td>
                    </tr>)}</tbody>
                  </table>
                </div>}
              </div>
              {r.notes&&<div style={{marginTop:10,padding:'8px 12px',background:'#F9F8F6',borderRadius:6,fontSize:12,color:'#6B6056'}}><b>Notes:</b> {r.notes}</div>}
              {/* Action buttons */}
              <div style={{marginTop:14,display:'flex',gap:8,flexWrap:'wrap'}}>
                {r.status==='pending'&&<div style={{flex:1,minWidth:280,padding:12,background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:8}}>
                  <div style={{fontSize:11,fontWeight:800,color:'#B45309',textTransform:'uppercase',marginBottom:8}}>Confirm Receipt</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                    <div><label style={{...lbl,fontSize:10}}>Confirmed By</label><input value={confirmForm.confirmed_by} onChange={e=>setConfirmForm(p=>({...p,confirmed_by:e.target.value}))} placeholder="Max / Carlos" style={{...inputS,padding:'6px 10px',fontSize:12}}/></div>
                    <div><label style={{...lbl,fontSize:10}}>Est. Ship Date</label><input type="date" value={confirmForm.estimated_ship_date} onChange={e=>setConfirmForm(p=>({...p,estimated_ship_date:e.target.value}))} style={{...inputS,padding:'6px 10px',fontSize:12}}/></div>
                  </div>
                  <input value={confirmForm.notes} onChange={e=>setConfirmForm(p=>({...p,notes:e.target.value}))} placeholder="Notes (optional)" style={{...inputS,padding:'6px 10px',fontSize:12,marginBottom:8}}/>
                  <button onClick={()=>confirmReceipt(r)} style={{...btnP,padding:'6px 16px',fontSize:12,background:'#065F46'}}>Confirm</button>
                </div>}
                {r.status==='confirmed'&&<button onClick={()=>markFulfilled(r)} style={{...btnP,padding:'8px 18px',fontSize:12,background:'#065F46'}}>Mark Fulfilled</button>}
                {(r.status==='pending'||r.status==='confirmed')&&(isCancelConfirm?<div style={{display:'flex',gap:4,alignItems:'center',padding:'6px 10px',background:'#FEF2F2',borderRadius:6,border:'1px solid #FECACA'}}>
                  <span style={{fontSize:11,color:'#991B1B',fontWeight:700}}>Cancel this request?</span>
                  <button onClick={()=>cancelRequest(r)} style={{background:'#991B1B',border:'none',borderRadius:4,padding:'4px 10px',color:'#FFF',fontSize:11,fontWeight:700,cursor:'pointer'}}>Yes</button>
                  <button onClick={()=>setCancelConfirmId(null)} style={{background:'none',border:'1px solid #E5E3E0',borderRadius:4,padding:'4px 10px',color:'#6B6056',fontSize:11,cursor:'pointer'}}>No</button>
                </div>:<button onClick={()=>setCancelConfirmId(r.id)} style={{background:'none',border:'1px solid #EF444440',borderRadius:6,padding:'6px 12px',color:'#EF4444',fontSize:11,fontWeight:600,cursor:'pointer'}}>Cancel Request</button>)}
              </div>
            </div>}
          </div>;
        })}
      </div>}
    </div>}
  </div>);
}

/* ═══ FCA ASSISTANT CHAT WIDGET — Phase 1 help/FAQ bot ═══ */
const CHAT_WELCOME = "Hi! I'm the FCA Assistant. Ask me anything about the app — how to find something, what a field means, or how to complete a task.";
const CHAT_QUICK_PROMPTS = {
  projects: ["How do I add a new project?","What do the status colors mean?","How do I filter by market?"],
  production: ["How do I move a job to production?","What does group by do?","How do I schedule a job?"],
  pm_billing: ["What's Left to Bill?","How is % Billed calculated?","How do I edit billing?"],
  _default: ["What can I do here?","How do I find a project?","What do the add-on badges mean?"],
};
function ChatWidget({currentPage}){
  const[open,setOpen]=useState(false);
  const[messages,setMessages]=useState([]);// array of {role:'user'|'assistant',content}
  const[input,setInput]=useState('');
  const[sending,setSending]=useState(false);
  const[err,setErr]=useState(null);
  const lastSentRef=useRef(0);
  const scrollRef=useRef(null);
  const quickPrompts=CHAT_QUICK_PROMPTS[currentPage]||CHAT_QUICK_PROMPTS._default;
  // Auto-scroll to bottom when messages or typing-indicator changes
  useEffect(()=>{if(scrollRef.current){scrollRef.current.scrollTop=scrollRef.current.scrollHeight;}},[messages,sending,open]);
  // Reset conversation when panel closes
  const closeChat=()=>{setOpen(false);setMessages([]);setInput('');setErr(null);};
  const sendMessage=async(text)=>{
    const trimmed=(text||'').trim();
    if(!trimmed||sending)return;
    // Rate limit: 1 request per 2 seconds
    const now=Date.now();
    if(now-lastSentRef.current<2000){setErr('Please wait a moment before sending another message.');setTimeout(()=>setErr(null),2000);return;}
    lastSentRef.current=now;
    const nextMessages=[...messages,{role:'user',content:trimmed}];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setErr(null);
    try{
      const res=await fetch(`${SB}/functions/v1/chat-assistant`,{
        method:'POST',
        headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({messages:nextMessages,currentPage:currentPage||'dashboard'})
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){throw new Error(data?.error||`Request failed (${res.status})`);}
      const reply=(data?.text||'').trim();
      if(!reply)throw new Error('Empty response from assistant');
      setMessages(m=>[...m,{role:'assistant',content:reply}]);
    }catch(e){
      console.error('[ChatWidget] send failed:',e);
      setErr("Sorry, I couldn't connect. Try again.");
      // Roll back the user message? No — keep it visible so they can see what they asked and retry
    }
    setSending(false);
  };
  const onInputKey=(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input);}};
  // Chat button (closed state)
  if(!open){
    return<button onClick={()=>setOpen(true)} title="Ask the FCA Assistant" style={{position:'fixed',bottom:24,right:24,width:56,height:56,borderRadius:28,background:'#8B2020',border:'none',color:'#FFF',fontSize:24,cursor:'pointer',boxShadow:'0 4px 16px rgba(139,32,32,0.35)',zIndex:800,display:'flex',alignItems:'center',justifyContent:'center',transition:'transform 0.15s, box-shadow 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.transform='scale(1.08)';e.currentTarget.style.boxShadow='0 6px 22px rgba(139,32,32,0.45)';}} onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='0 4px 16px rgba(139,32,32,0.35)';}}>💬</button>;
  }
  // Typing indicator (3 animated dots)
  const typingDots=<div style={{display:'inline-flex',gap:4,padding:'10px 14px',background:'#E8E8E6',borderRadius:14,alignSelf:'flex-start',maxWidth:'80%'}}>
    <span style={{width:6,height:6,borderRadius:3,background:'#9E9B96',animation:'fcDot 1.2s infinite ease-in-out',animationDelay:'0s'}}/>
    <span style={{width:6,height:6,borderRadius:3,background:'#9E9B96',animation:'fcDot 1.2s infinite ease-in-out',animationDelay:'0.2s'}}/>
    <span style={{width:6,height:6,borderRadius:3,background:'#9E9B96',animation:'fcDot 1.2s infinite ease-in-out',animationDelay:'0.4s'}}/>
  </div>;
  return<div style={{position:'fixed',bottom:24,right:24,width:380,maxWidth:'calc(100vw - 32px)',height:520,maxHeight:'calc(100vh - 48px)',background:'#F4F4F2',borderRadius:14,boxShadow:'0 8px 40px rgba(0,0,0,0.22)',display:'flex',flexDirection:'column',overflow:'hidden',zIndex:800,border:'1px solid #E5E3E0'}}>
    <style>{`@keyframes fcDot{0%,80%,100%{opacity:0.3;transform:scale(0.8);}40%{opacity:1;transform:scale(1);}}`}</style>
    {/* Header */}
    <div style={{padding:'12px 16px',background:'#8B2020',color:'#FFF',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:18}}>💬</span>
        <span style={{fontFamily:'Inter',fontWeight:800,fontSize:14}}>FCA Assistant</span>
      </div>
      <button onClick={closeChat} title="Close" style={{background:'none',border:'none',color:'#FFF',fontSize:20,cursor:'pointer',padding:0,lineHeight:1,width:24,height:24,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.15)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>×</button>
    </div>
    {/* Messages area */}
    <div ref={scrollRef} style={{flex:1,overflow:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:10,background:'#F4F4F2'}}>
      {messages.length===0&&<div style={{alignSelf:'flex-start',background:'#E8E8E6',color:'#1A1A1A',padding:'10px 14px',borderRadius:14,maxWidth:'85%',fontSize:13,lineHeight:1.5}}>{CHAT_WELCOME}</div>}
      {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==='user'?'flex-end':'flex-start',background:m.role==='user'?'#8B2020':'#E8E8E6',color:m.role==='user'?'#FFF':'#1A1A1A',padding:'10px 14px',borderRadius:14,maxWidth:'85%',fontSize:13,lineHeight:1.5,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{m.content}</div>)}
      {sending&&typingDots}
      {err&&<div style={{alignSelf:'center',background:'#FEE2E2',color:'#991B1B',padding:'8px 12px',borderRadius:10,fontSize:11,fontWeight:600,textAlign:'center',maxWidth:'85%'}}>{err}</div>}
    </div>
    {/* Quick prompts */}
    {messages.length<2&&<div style={{padding:'0 14px 8px',display:'flex',gap:6,flexWrap:'wrap',flexShrink:0}}>
      {quickPrompts.map((q,i)=><button key={i} onClick={()=>sendMessage(q)} disabled={sending} style={{padding:'6px 10px',border:'1px solid #8B202040',background:'#FFF',color:'#8B2020',borderRadius:14,fontSize:11,fontWeight:600,cursor:sending?'not-allowed':'pointer',opacity:sending?0.5:1,lineHeight:1.3,textAlign:'left'}}>{q}</button>)}
    </div>}
    {/* Input area */}
    <div style={{padding:'10px 12px',background:'#FFF',borderTop:'1px solid #E5E3E0',display:'flex',gap:8,flexShrink:0}}>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onInputKey} disabled={sending} placeholder="Ask me anything about the app..." style={{flex:1,padding:'10px 12px',border:'1px solid #D1CEC9',borderRadius:10,fontSize:13,background:'#FFF',color:'#1A1A1A',outline:'none'}}/>
      <button onClick={()=>sendMessage(input)} disabled={sending||!input.trim()} style={{padding:'10px 16px',background:'#8B2020',border:'none',borderRadius:10,color:'#FFF',fontSize:13,fontWeight:700,cursor:(sending||!input.trim())?'not-allowed':'pointer',opacity:(sending||!input.trim())?0.5:1}}>{sending?'…':'Send'}</button>
    </div>
  </div>;
}

/* ═══ TOPBAR ═══ */
function Topbar({jobs,live,onSearch,onRefresh}){
  const alerts=jobs.filter(j=>!CLOSED_SET.has(j.status)&&n(j.contract_age)>30&&n(j.ytd_invoiced)===0);
  const[showBell,setShowBell]=useState(false);const[showHelp,setShowHelp]=useState(false);
  const[refreshState,setRefreshState]=useState('idle'); // 'idle' | 'spinning' | 'done'
  const today=new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  const handleRefresh=async()=>{
    if(refreshState==='spinning')return;
    setRefreshState('spinning');
    try{if(onRefresh)await onRefresh();}
    catch(e){console.error('[Topbar refresh]',e);}
    setRefreshState('done');
    setTimeout(()=>setRefreshState('idle'),1000);
  };
  return(<div style={{height:48,borderBottom:'1px solid #E5E3E0',background:'#FFF',display:'flex',alignItems:'center',padding:'0 24px',gap:16,flexShrink:0}}>
    <style>{`@keyframes fcSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    <div style={{flex:1}}/>
    <div style={{display:'flex',alignItems:'center',gap:12}}>
      <button onClick={onSearch} style={{background:'#F4F4F2',border:'1px solid #E5E3E0',borderRadius:8,padding:'6px 16px',color:'#9E9B96',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>⌕ Search... <span style={{fontSize:10,color:'#D1CEC9'}}>⌘K</span></button>
      <button onClick={handleRefresh} title="Refresh data" disabled={refreshState==='spinning'} style={{background:refreshState==='done'?'#D1FAE5':'none',border:'none',borderRadius:20,width:32,height:32,cursor:refreshState==='spinning'?'wait':'pointer',color:refreshState==='done'?'#065F46':'#6B6056',fontSize:16,display:'inline-flex',alignItems:'center',justifyContent:'center',transition:'background 0.2s'}}>
        <span style={{display:'inline-block',animation:refreshState==='spinning'?'fcSpin 0.8s linear infinite':'none'}}>{refreshState==='done'?'✓':'↻'}</span>
      </button>
      <div style={{width:8,height:8,borderRadius:4,background:live?'#10B981':'#9E9B96'}} title={live?'Live':'Disconnected'}/>
      <span style={{fontSize:12,color:'#6B6056'}}>{today}</span>
      <div style={{position:'relative'}}><button onClick={()=>setShowBell(!showBell)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',position:'relative'}}>🔔{alerts.length>0&&<span style={{position:'absolute',top:-4,right:-6,background:'#991B1B',color:'#fff',fontSize:9,fontWeight:700,borderRadius:8,padding:'1px 4px',minWidth:14,textAlign:'center'}}>{alerts.length}</span>}</button>{showBell&&<div style={{position:'absolute',right:0,top:32,width:300,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:12,boxShadow:'0 8px 30px rgba(0,0,0,.1)',zIndex:100,padding:12}}><div style={{fontFamily:'Inter',fontWeight:700,fontSize:13,marginBottom:8}}>Billing Alerts</div>{alerts.slice(0,5).map(j=><div key={j.id} style={{padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}>{j.job_name} <span style={{color:'#B45309'}}>{j.contract_age}d</span></div>)}{alerts.length===0&&<div style={{color:'#9E9B96',fontSize:12}}>No alerts</div>}</div>}</div>
      <div style={{position:'relative'}}><button onClick={()=>setShowHelp(!showHelp)} style={{background:'none',border:'none',fontSize:16,cursor:'pointer',color:'#9E9B96'}}>?</button>{showHelp&&<div style={{position:'absolute',right:0,top:32,width:220,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:12,boxShadow:'0 8px 30px rgba(0,0,0,.1)',zIndex:100,padding:12,fontSize:12,color:'#6B6056'}}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:6}}>Shortcuts</div><div>⌘K — Global search</div><div>Esc — Close panel</div></div>}</div>
    </div>
  </div>);
}

/* ═══ APP ═══ */
/* ═══ INSTALL SCHEDULE PAGE ═══ */
function InstallSchedulePage({jobs}){
  return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:8}}>Install Schedule</h1>
    <div style={{fontSize:12,color:'#9E9B96',marginBottom:20}}>Field install scheduling and crew coordination</div>
    <div style={{...card,textAlign:'center',padding:60}}>
      <div style={{fontSize:48,marginBottom:12}}>📅</div>
      <div style={{fontSize:16,fontWeight:700,color:'#1A1A1A',marginBottom:6}}>Install Schedule</div>
      <div style={{fontSize:13,color:'#6B6056'}}>Coming soon — this page will show field install schedules, crew assignments, and upcoming installs.</div>
    </div>
  </div>);
}

/* ═══ HELP PAGE ═══ */
function HelpPage(){
  return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:8}}>Help</h1>
    <div style={{fontSize:12,color:'#9E9B96',marginBottom:20}}>Documentation and support</div>
    <div style={{...card,padding:24}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:'#8B2020'}}>Quick Help</div>
      <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7}}>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Dashboard</b> — overview of active projects, KPIs, pipeline status, and PM workload.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Projects</b> — full project database with filters, inline edit, and CSV export. Active and Closed tabs.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Production Plan</b> — kanban board showing jobs by stage. Unlock with PIN 2020 to move cards.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Material Calculator</b> — calculates posts/panels/rails/caps from style, height, and LF. Save to job creates a production order.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Production Orders</b> — Max's view of all jobs with saved material calculations.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Daily Production Report</b> — Max builds tomorrow's plan; Luis logs actuals per shift; leadership reviews history.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>PM Bill Sheet</b> — PMs submit monthly LF reports per project. AR reviews and marks invoiced.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Billing</b> — AR exception dashboard showing submitted vs missing bill sheets.</div>
        <div style={{marginBottom:16}}><b style={{color:'#1A1A1A'}}>Import Projects</b> — 4-step Excel import for the Master Project Tracker with preview and safety guards.</div>
      </div>
      <div style={{fontSize:13,color:'#6B6056',marginTop:20,paddingTop:16,borderTop:'1px solid #E5E3E0'}}>For issues or feature requests, contact <b style={{color:'#8B2020'}}>david@fencecrete.com</b></div>
    </div>
  </div>);
}

const NAV_GROUPS=[
  {label:'OVERVIEW',items:[{key:'dashboard',label:'Dashboard',icon:'🏠'}]},
  {label:'PROJECTS',items:[{key:'projects',label:'Projects',icon:'📋'}]},
  {label:'OPERATIONS',items:[{key:'production',label:'Production Board',icon:'🗂'},{key:'production_planning',label:'Production Planning',icon:'⚙'},{key:'material_calc',label:'Material Calculator',icon:'🧮'},{key:'material_requests',label:'Material Requests',icon:'🚚'},{key:'daily_report',label:'Daily Production Report',icon:'🏭'}]},
  {label:'PROJECT MANAGEMENT',items:[{key:'pm_billing',label:'PM Bill Sheet',icon:'📊'},{key:'pm_daily_report',label:'PM Daily Report',icon:'📋'},{key:'schedule',label:'Install Schedule',icon:'📅'}]},
  {label:'FINANCE',items:[{key:'billing',label:'Billing',icon:'💰'},{key:'reports',label:'Reports',icon:'📈'},{key:'import_projects',label:'Import Projects',icon:'📤'}]},
  {label:'HELP',items:[{key:'help',label:'Help',icon:'❓'}]},
];

export default function App(){
  const[page,setPage]=useState('dashboard');const[jobs,setJobs]=useState([]);const[loading,setLoading]=useState(true);const[openJob,setOpenJob]=useState(null);const[showSearch,setShowSearch]=useState(false);const[sideCollapsed,setSideCollapsed]=useState(false);
  const[refreshKey,setRefreshKey]=useState(0);
  const fetchJobs=useCallback(async()=>{try{const d=await sbGet('jobs','select=*&order=created_at.desc');setJobs(d||[]);}catch(e){console.error(e);}setLoading(false);},[]);
  useEffect(()=>{fetchJobs();},[fetchJobs]);
  // Global refresh — fetches the main jobs list AND increments refreshKey so pages with internal fetches can re-run them.
  const handleGlobalRefresh=useCallback(async()=>{await fetchJobs();setRefreshKey(k=>k+1);},[fetchJobs]);
  useEffect(()=>{sbGet('material_calc_styles','is_active=eq.true&select=style_name&order=style_name').then(d=>{if(d&&d.length){const opts=d.map(s=>({v:s.style_name,l:STYLE_LABEL(s.style_name)}));DD.style=opts;DD.style_single_wythe=opts;}});},[]);
  const live=useRealtime(setJobs);
  const isMobile=typeof window!=='undefined'&&window.innerWidth<768;
  const sideW=sideCollapsed||isMobile?48:220;
  return(
    <div style={{display:'flex',height:'100vh',overflow:'hidden',width:'100%'}}>
      <style>{`@media(max-width:768px){input,select,textarea{min-height:48px!important;font-size:16px!important}}`}</style>
      <div style={{width:sideW,minWidth:sideW,maxWidth:sideW,flexShrink:0,background:'#1A1A1A',borderRight:'1px solid #2A2A2A',display:'flex',flexDirection:'column',overflow:'hidden',transition:'width .2s'}}>
        <div style={{padding:sideCollapsed?'16px 8px':'24px 20px 20px',textAlign:sideCollapsed?'center':'left'}}>
          {!sideCollapsed&&<><div style={{fontFamily:'Syne',fontSize:15,fontWeight:900,color:'#8B2020',whiteSpace:'nowrap',overflow:'hidden'}}>FCA Command Center</div></>}
          {sideCollapsed&&<div style={{fontFamily:'Syne',fontSize:14,fontWeight:900,color:'#8B2020'}}>F</div>}
        </div>
        <nav style={{flex:1,padding:sideCollapsed?'0 4px':'0 8px',overflow:'auto'}}>{NAV_GROUPS.map(g=><div key={g.label||'top'}>{!sideCollapsed&&g.label&&<div style={{fontSize:10,color:'#6B7280',textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:700,padding:'16px 12px 4px'}}>{g.label}</div>}{sideCollapsed&&<div style={{borderTop:'1px solid #2A2A2A',margin:'6px 4px'}}/>}{g.items.map(ni=><button key={ni.key} onClick={()=>setPage(ni.key)} title={ni.label} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:sideCollapsed?'10px 0':'10px 12px',marginBottom:2,borderRadius:8,border:'none',background:page===ni.key?'#8B202018':'transparent',color:page===ni.key?'#8B2020':'#9E9B96',fontSize:14,fontWeight:page===ni.key?600:400,cursor:'pointer',textAlign:'left',justifyContent:sideCollapsed?'center':'flex-start',borderLeft:page===ni.key?'3px solid #8B2020':'3px solid transparent'}}><span style={{fontSize:16,width:20,textAlign:'center'}}>{ni.icon}</span>{!sideCollapsed&&ni.label}</button>)}</div>)}</nav>
        <div style={{padding:sideCollapsed?'8px':'16px 20px',borderTop:'1px solid #2A2A2A'}}>
          {!sideCollapsed&&<div style={{fontSize:11,color:'#6B6056',marginBottom:6}}>{jobs.length} projects</div>}
          <button onClick={()=>setSideCollapsed(!sideCollapsed)} style={{background:'#2A2A2A',border:'none',borderRadius:6,color:'#9E9B96',fontSize:11,cursor:'pointer',padding:'4px 10px',width:'100%'}}>{sideCollapsed?'→':'←'}</button>
        </div>
      </div>
      <div style={{flex:1,minWidth:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <Topbar jobs={jobs} live={live} onSearch={()=>setShowSearch(true)} onRefresh={handleGlobalRefresh}/>
        <div style={{flex:1,overflow:'auto',padding:'24px 32px'}}>
          {loading?<div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'50vh',color:'#9E9B96'}}>Loading...</div>:<>
            {page==='dashboard'&&<Dashboard jobs={jobs} onNav={setPage} refreshKey={refreshKey}/>}
            {page==='estimating'&&<EstimatingPage jobs={jobs} onNav={(pg,job)=>{if(job){setOpenJob(job);}setPage(pg);}}/>}
            {page==='map'&&<MapPage jobs={jobs} onNav={(pg,job)=>{if(job){setOpenJob(job);}setPage(pg);}}/>}
            {page==='projects'&&<ProjectsPage jobs={jobs} onRefresh={fetchJobs} openJob={openJob} refreshKey={refreshKey} onNav={setPage}/>}
            {page==='billing'&&<BillingPage jobs={jobs} onRefresh={fetchJobs} onNav={setPage} refreshKey={refreshKey}/>}
            {page==='pm_billing'&&<PMBillingPage jobs={jobs} onRefresh={fetchJobs} refreshKey={refreshKey}/>}
            {page==='production'&&<ProductionPage jobs={jobs} setJobs={setJobs} onRefresh={fetchJobs} onNav={setPage} refreshKey={refreshKey}/>}
            {page==='production_planning'&&<ProductionPlanningPage jobs={jobs} setJobs={setJobs} onNav={setPage} refreshKey={refreshKey}/>}
            {page==='reports'&&<ReportsPage jobs={jobs} onNav={setPage} onOpenJob={j=>{setOpenJob(j);setPage('projects');}} refreshKey={refreshKey}/>}
            {page==='import_projects'&&<ImportProjectsPage jobs={jobs} onRefresh={fetchJobs} onNav={setPage}/>}
            {page==='change_orders'&&<ChangeOrdersPage jobs={jobs}/>}
            {page==='material_calc'&&<MaterialCalcPage jobs={jobs}/>}
            {page==='material_requests'&&<MaterialRequestsPage jobs={jobs} refreshKey={refreshKey}/>}
            {page==='production_orders'&&<ProductionPlanningPage jobs={jobs} setJobs={setJobs} onNav={setPage} refreshKey={refreshKey}/>}
            {page==='schedule'&&<SchedulePage jobs={jobs}/>}
            {page==='weather_days'&&<WeatherDaysPage jobs={jobs}/>}
            {page==='pm_daily_report'&&<PMDailyReportPage jobs={jobs}/>}
            {page==='daily_report'&&<DailyReportPage jobs={jobs} onNav={setPage} refreshKey={refreshKey}/>}
            {page==='install_schedule'&&<InstallSchedulePage jobs={jobs}/>}
            {page==='help'&&<HelpPage/>}
          </>}
        </div>
      </div>
      {showSearch&&<GlobalSearch jobs={jobs} onSelect={j=>{setOpenJob(j);setPage('projects');setShowSearch(false);}}/>}
      <ChatWidget currentPage={page}/>
    </div>
  );
}
