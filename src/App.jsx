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
const DD = { status:STS.map(s=>({v:s,l:SL[s]})), market:MKTS.map(m=>({v:m,l:m})), fence_type:['PC','SW','PC/Gates','PC/Columns','PC/SW','PC/WI','SW/Columns','SW/Gate','SW/WI','WI','WI/Gate','Wood','PC/SW/Columns','SW/Columns/Gates','Slab','LABOR'].map(v=>({v,l:v})), style:['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'].map(v=>({v,l:v})), style_single_wythe:['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'].map(v=>({v,l:v})), color:['LAC','Painted','10#61078','Café','Adobe','8#860','Regular Brown','Outback','Silversmoke 8085','Green','Stain','10#860','8#677','3.5#860','1.5#860','Dune 6058','Sandstone 5237','Pebble 641','No Color','Other'].map(v=>({v,l:v})), billing_method:['Progress','Lump Sum','Milestone','T&M','AIA'].map(v=>({v,l:v})), job_type:['Commercial','Residential','Government','Industrial','Private','Public'].map(v=>({v,l:v})), sales_rep:REPS.map(v=>({v,l:v})), pm:PM_LIST.map(p=>({v:p.id,l:p.label})), primary_fence_type:['Precast','Masonry','Wrought Iron'].map(v=>({v,l:v})) };
const NEXT_STATUS = { contract_review:'production_queue', production_queue:'in_production', in_production:'inventory_ready', inventory_ready:'active_install', active_install:'fence_complete', fence_complete:'fully_complete', fully_complete:'closed' };

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
function renderCell(j,k){const v=j[k];if(k==='status')return<span style={pill(SC[v]||'#6B6056',SB_[v]||'#F4F4F2')}>{SS[v]||v}</span>;if(k==='market')return<span style={pill(MC[v]||'#6B6056',MB[v]||'#F4F4F2')}>{MS[v]||v||'—'}</span>;if(['adj_contract_value','contract_value','left_to_bill','ytd_invoiced','net_contract_value'].includes(k))return<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:k==='left_to_bill'?(n(v)>100000?'#991B1B':n(v)>50000?'#B45309':'#065F46'):'#1A1A1A'}}>{$(v)}</span>;if(k==='pct_billed')return<span>{fmtPct(v)}</span>;if(k==='total_lf')return<span>{n(v).toLocaleString()}</span>;if(['contract_date','last_billed','est_start_date','active_entry_date','complete_date'].includes(k))return fD(v);if(['aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing'].includes(k))return v?<span style={{color:'#22c55e',fontWeight:700}}>✓</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='retainage_pct')return n(v)?<span style={{fontWeight:600}}>{n(v)}%</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='retainage_held')return n(v)?<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:'#991B1B'}}>{$(v)}</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='collected')return v?<span style={pill('#065F46','#D1FAE5')}>COLLECTED</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='primary_fence_type'){const ptc={Precast:'#8B2020',Masonry:'#185FA5','Wrought Iron':'#374151'};return v?<span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:ptc[v]||'#6B6056',color:'#FFF'}}>{v}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='fence_addons'){const arr=Array.isArray(v)?v:[];return arr.length>0?<div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{arr.map(a=><span key={a} style={{display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:'#F4F4F2',color:'#1A1A1A',border:'1px solid #E5E3E0'}}>{a}</span>)}</div>:<span style={{color:'#9E9B96'}}>—</span>;}return v||'—';}

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
            <div><div style={lbl}>LF Precast</div><div style={val}>{n(job.lf_precast)>0?n(job.lf_precast).toLocaleString():'—'}</div></div>
            <div><div style={lbl}>LF Single Wythe</div><div style={val}>{n(job.lf_single_wythe)>0?n(job.lf_single_wythe).toLocaleString():'—'}</div></div>
            <div><div style={lbl}>LF Wrought Iron</div><div style={val}>{n(job.lf_wrought_iron)>0?n(job.lf_wrought_iron).toLocaleString():'—'}</div></div>
            <div><div style={lbl}>Total LF</div><div style={{...val,color:'#8B2020'}}>{n(job.total_lf).toLocaleString()}</div></div>
            <div><div style={lbl}># Gates</div><div style={val}>{n(job.number_of_gates)||'—'}</div></div>
            <div><div style={lbl}>Gate Height</div><div style={val}>{job.gate_height||'—'}</div></div>
          </div>
        </div>
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
const ALL_COLS=[{key:'status',label:'Status',w:130},{key:'market',label:'Location',w:110},{key:'job_number',label:'Project Code',w:100},{key:'included_on_billing_schedule',label:'Billing Sched.',w:100},{key:'included_on_lf_schedule',label:'LF Sched.',w:90},{key:'job_name',label:'Project Name',w:220},{key:'customer_name',label:'Customer',w:180},{key:'cust_number',label:'Cust #',w:80},{key:'fence_type',label:'Fence Type',w:100},{key:'primary_fence_type',label:'Primary Type',w:110},{key:'fence_addons',label:'Add-ons',w:140},{key:'documents_needed',label:'Docs Needed',w:140},{key:'file_location',label:'File Location',w:110},{key:'billing_method',label:'Billing Method',w:110},{key:'billing_date',label:'Billing Date',w:90},{key:'sales_rep',label:'Sales Rep',w:80},{key:'pm',label:'Project Manager',w:100},{key:'job_type',label:'Type',w:80},{key:'address',label:'Address',w:180},{key:'city',label:'City',w:100},{key:'state',label:'State',w:60},{key:'zip',label:'ZIP',w:70},{key:'lf_precast',label:'LF - Precast',w:90},{key:'height_precast',label:'Height - Precast',w:110},{key:'style',label:'Style - Precast',w:140},{key:'color',label:'Color - Precast',w:120},{key:'contract_rate_precast',label:'Rate - Precast',w:110},{key:'lf_single_wythe',label:'LF - Single Wythe',w:120},{key:'height_single_wythe',label:'Height - SW',w:90},{key:'contract_rate_single_wythe',label:'Rate - SW',w:90},{key:'style_single_wythe',label:'Style - SW',w:110},{key:'lf_wrought_iron',label:'LF - Wrought Iron',w:120},{key:'height_wrought_iron',label:'Height - WI',w:90},{key:'contract_rate_wrought_iron',label:'Rate - WI',w:90},{key:'lf_removal',label:'LF - Removal',w:100},{key:'height_removal',label:'Height - Removal',w:110},{key:'removal_material_type',label:'Removal Material',w:130},{key:'contract_rate_removal',label:'Rate - Removal',w:110},{key:'lf_other',label:'LF - Other',w:90},{key:'height_other',label:'Height - Other',w:100},{key:'other_material_type',label:'Other Material',w:120},{key:'contract_rate_other',label:'Rate - Other',w:100},{key:'number_of_gates',label:'# Gates',w:70},{key:'gate_height',label:'Gate Height',w:90},{key:'gate_description',label:'Gate Description',w:140},{key:'gate_rate',label:'Gate Rate',w:90},{key:'lump_sum_amount',label:'Lump Sum Amt',w:110},{key:'lump_sum_description',label:'Lump Sum Desc',w:150},{key:'total_lf',label:'Total LF Installed',w:130},{key:'average_height_installed',label:'Avg Height Installed',w:140},{key:'total_lf_removed',label:'Total LF Removed',w:130},{key:'average_height_removed',label:'Avg Height Removed',w:140},{key:'net_contract_value',label:'Net Contract Value',w:140},{key:'sales_tax',label:'Sales Tax',w:90},{key:'contract_value',label:'Contract Value',w:120},{key:'change_orders',label:'Change Orders',w:120},{key:'adj_contract_value',label:'Adj. Contract Value',w:140},{key:'contract_value_recalculation',label:'CV Recalc',w:100},{key:'contract_value_recalc_diff',label:'CV Recalc Diff',w:110},{key:'ytd_invoiced',label:'YTD Invoiced',w:110},{key:'pct_billed',label:'% Billed',w:80},{key:'left_to_bill',label:'Left to Bill',w:110},{key:'last_billed',label:'Last Billed',w:100},{key:'contract_date',label:'Contract Date',w:110},{key:'contract_month',label:'Contract Month',w:120},{key:'est_start_date',label:'Est. Start Date',w:120},{key:'start_month',label:'Start Month',w:100},{key:'contract_age',label:'Contract Age',w:100},{key:'active_entry_date',label:'Active Entry Date',w:130},{key:'complete_date',label:'Complete Date',w:110},{key:'complete_month',label:'Complete Month',w:120},{key:'aia_billing',label:'AIA',w:60},{key:'bonds',label:'Bonds',w:60},{key:'certified_payroll',label:'Cert Pay',w:60},{key:'ocip_ccip',label:'OCIP',w:60},{key:'third_party_billing',label:'3rd Party',w:60},{key:'notes',label:'Notes',w:220},{key:'retainage_pct',label:'Retainage %',w:90},{key:'retainage_held',label:'Retainage Held',w:110},{key:'collected',label:'Collected',w:90}];
const DEF_VIS=['status','market','job_number','job_name','customer_name','fence_type','primary_fence_type','fence_addons','sales_rep','pm','adj_contract_value','left_to_bill','pct_billed','total_lf','contract_date','est_start_date','last_billed','aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing','notes'];

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
const SECS=[{key:'contract',label:'Contract & Billing',fields:['net_contract_value','sales_tax','contract_value','change_orders','adj_contract_value','ytd_invoiced','last_billed','billing_method','billing_date','retainage_pct','retainage_held','collected','collected_date','final_invoice_amount'],computed:['pct_billed','left_to_bill']},{key:'precast',label:'Precast',fields:['lf_precast','height_precast','style','color','contract_rate_precast']},{key:'wythe',label:'Single Wythe',fields:['lf_single_wythe','height_single_wythe','style_single_wythe','contract_rate_single_wythe']},{key:'iron',label:'Wrought Iron',fields:['lf_wrought_iron','height_wrought_iron','contract_rate_wrought_iron']},{key:'removal',label:'Removal',fields:['lf_removal','height_removal','removal_material_type','contract_rate_removal']},{key:'other',label:'Other/Lump',fields:['lf_other','height_other','other_material_type','contract_rate_other','lump_sum_amount','lump_sum_description']},{key:'gates',label:'Gates',fields:['number_of_gates','gate_height','gate_description','gate_rate']},{key:'totals',label:'Totals',fields:['total_lf','average_height_installed','total_lf_removed','product','fence_type','primary_fence_type','fence_addons']},{key:'requirements',label:'Project Requirements',fields:[]},{key:'details',label:'Details',fields:['sales_rep','pm','job_type','documents_needed','file_location','address','city','state','zip','cust_number']},{key:'dates',label:'Dates',fields:['contract_date','contract_month','est_start_date','start_month','contract_age','active_entry_date','complete_date','complete_month']},{key:'notes',label:'Notes',fields:['notes']},{key:'co',label:'Change Orders',fields:['change_orders','contract_value_recalculation','contract_value_recalc_diff']},{key:'history',label:'History',fields:[]}];

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

/* ═══ ACTIVITY HISTORY ═══ */
function ActivityHistory({jobId}){const[logs,setLogs]=useState([]);const[ld,setLd]=useState(true);useEffect(()=>{sbGet('activity_log',`job_id=eq.${jobId}&order=created_at.desc&limit=50`).then(d=>{setLogs(d||[]);setLd(false);});},[jobId]);if(ld)return<div style={{padding:20,color:'#9E9B96'}}>Loading...</div>;if(!logs.length)return<div style={{padding:20,color:'#9E9B96'}}>No activity yet</div>;return<div>{logs.map(l=><div key={l.id} style={{padding:'8px 0',borderBottom:'1px solid #E5E3E0',display:'flex',gap:10,alignItems:'flex-start'}}><span style={{...pill(ACT_C[l.action]||'#6B6056',(ACT_C[l.action]||'#6B6056')+'18'),fontSize:10,whiteSpace:'nowrap',marginTop:2}}>{(l.action||'').replace(/_/g,' ')}</span><div style={{flex:1}}><div style={{fontSize:12}}>{l.field_name==='status'?`Status: ${l.old_value} → ${l.new_value}`:l.action==='job_created'?`Created: ${l.new_value}`:l.field_name==='notes'?'Notes updated':`${l.field_name}: updated`}</div><div style={{fontSize:10,color:'#9E9B96'}} title={new Date(l.created_at).toLocaleString()}>{relT(l.created_at)} · {l.changed_by}</div></div></div>)}</div>;}

/* ═══ EDIT PANEL ═══ */
function EditPanel({job,onClose,onSaved,isNew,onDuplicate}){
  const[form,setForm]=useState({...job});const[tab,setTab]=useState(isNew?'details':'contract');const[saving,setSaving]=useState(false);
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));
  const[saveErr,setSaveErr]=useState(null);
  const handleSave=async()=>{setSaving(true);setSaveErr(null);try{if(isNew){const{id,created_at,updated_at,...rest}=form;if(!rest.job_name){setSaving(false);return;}if(!rest.status)rest.status='contract_review';const res=await fetch(`${SB}/rest/v1/jobs`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(rest)});const txt=await res.text();if(!res.ok)throw new Error(txt);const saved=txt?JSON.parse(txt):[];if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',saved[0].job_number);}}else{const{id,created_at,updated_at,...rest}=form;const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`,{method:'PATCH',headers:H,body:JSON.stringify(rest)});const txt=await res.text();if(!res.ok)throw new Error(txt);fireAlert('job_updated',{id:job.id,...rest});logAct(job,'field_update','multiple_fields','','saved');}setSaving(false);onSaved(isNew?'Project created':'Project saved');}catch(e){console.error('[EditPanel] Save failed:',e);setSaveErr(e.message);setSaving(false);}};
  const handleDup=async()=>{const{id,created_at,updated_at,job_number,...rest}=form;rest.ytd_invoiced=0;rest.pct_billed=0;rest.left_to_bill=n(rest.adj_contract_value||rest.contract_value);rest.status='contract_review';rest.last_billed=null;rest.notes='';rest.contract_date=null;rest.est_start_date=null;try{rest.job_number=await getNextJobNumber(rest.market);}catch(e){rest.job_number='';}const saved=await sbPost('jobs',rest);if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',`Duplicated from ${job.job_number}`);}onSaved('Project duplicated');};
  const[coList,setCOList]=useState([]);const[showCOForm,setShowCOForm]=useState(false);
  const[coForm,setCOForm]=useState({co_number:'',date_submitted:'',date_approved:'',amount:'',description:'',status:'Pending',approved_by:'',notes:''});
  const[latestPmLF,setLatestPmLF]=useState(null);
  useEffect(()=>{if(job?.id)sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`).then(d=>setCOList(d||[]));},[job?.id]);
  useEffect(()=>{if(job?.id)sbGet('pm_billing_entries',`job_id=eq.${job.id}&order=billing_period.desc&limit=1`).then(d=>setLatestPmLF(d&&d[0]||null));else setLatestPmLF(null);},[job?.id]);
  const saveCO=async()=>{const body={job_id:job.id,co_number:coForm.co_number||null,amount:n(coForm.amount),description:coForm.description||null,status:coForm.status||'Pending',date_submitted:coForm.date_submitted||null,date_approved:coForm.date_approved||null,approved_by:coForm.approved_by||null,notes:coForm.notes||null};try{const res=await fetch(`${SB}/rest/v1/change_orders`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});if(!res.ok){const txt=await res.text();console.error('CO save failed:',txt);}setShowCOForm(false);setCOForm({co_number:'',date_submitted:'',date_approved:'',amount:'',description:'',status:'Pending',approved_by:'',notes:''});sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`).then(d=>setCOList(d||[]));}catch(e){console.error('CO error:',e);}};
  const approvedTotal=coList.filter(c=>c.status==='Approved').reduce((s,c)=>s+n(c.amount),0);
  const coStatusC2={Pending:['#B45309','#FEF3C7'],Approved:['#065F46','#D1FAE5'],Rejected:['#991B1B','#FEE2E2']};
  const sec=SECS.find(s=>s.key===tab);const adjCV=n(form.adj_contract_value||form.contract_value);
  return(
    <div style={{position:'fixed',top:0,right:0,bottom:0,width:Math.min(540,window.innerWidth),background:'#FFF',borderLeft:'1px solid #E5E3E0',zIndex:200,display:'flex',flexDirection:'column',boxShadow:'-8px 0 30px rgba(0,0,0,.1)'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid #E5E3E0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,background:'#F9F8F6'}}>
        <div><div style={{fontFamily:'Inter',fontSize:16,fontWeight:800}}>{isNew?'New Project':(form.job_name||'Untitled')}</div><div style={{fontSize:12,color:'#6B6056'}}>{isNew?'Fill in details':`#${form.job_number} · ${form.customer_name}`}</div></div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>{saveErr&&<span style={{color:'#DC2626',fontSize:12,fontWeight:600,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={saveErr}>Error: {saveErr.substring(0,60)}</span>}<button onClick={handleSave} disabled={saving} style={{...btnP,background:isNew?'#065F46':'#8B2020'}}>{saving?'Saving...':isNew?'Create':'Save'}</button><button onClick={onClose} style={btnS}>Close</button></div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,padding:'10px 20px',borderBottom:'1px solid #E5E3E0',flexShrink:0}}>{SECS.map(s=><button key={s.key} onClick={()=>setTab(s.key)} style={{padding:'4px 10px',borderRadius:6,border:tab===s.key?'1px solid #8B2020':'1px solid #E5E3E0',background:tab===s.key?'#FDF4F4':'transparent',color:tab===s.key?'#8B2020':'#6B6056',fontSize:11,fontWeight:600,cursor:'pointer'}}>{s.label}</button>)}</div>
      <div style={{flex:1,overflow:'auto',padding:20}}>
        {tab==='history'?<ActivityHistory jobId={job?.id}/>:tab==='requirements'?<div>
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
          {coList.length>0&&<div style={{fontSize:12}}>
            {coList.map(c=>{const[sc2,sb2]=coStatusC2[c.status]||['#6B6056','#F4F4F2'];return<div key={c.id} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:11}}>
              <span style={{fontWeight:600}}>{c.co_number||'—'}</span>
              <span style={{color:'#9E9B96'}}>{fD(c.date)}</span>
              <span style={{fontFamily:'Inter',fontWeight:700}}>{$(c.amount)}</span>
              <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6B6056'}}>{c.description||''}</span>
              <span style={pill(sc2,sb2)}>{c.status}</span>
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
function NewProjectForm({jobs,onClose,onSaved}){
  const todayISO=new Date().toISOString().split('T')[0];
  const[sec,setSec]=useState('info');const[saving,setSaving]=useState(false);
  const emptyF=()=>({job_number:'',job_name:'',customer_name:'',cust_number:'',status:'contract_review',market:'',job_type:'Commercial',sales_rep:'',pm:'',address:'',city:'',state:'TX',zip:'',notes:'',fence_type:'PC',lf_precast:'',height_precast:'',style:'',color:'',contract_rate_precast:'',lf_single_wythe:'',height_single_wythe:'',style_single_wythe:'',contract_rate_single_wythe:'',lf_wrought_iron:'',height_wrought_iron:'',contract_rate_wrought_iron:'',lf_removal:'',height_removal:'',removal_material_type:'',contract_rate_removal:'',lf_other:'',height_other:'',other_material_type:'',contract_rate_other:'',number_of_gates:'',gate_height:'',gate_description:'',gate_rate:'',lump_sum_amount:'',lump_sum_description:'',contract_date:'',billing_method:'Progress',billing_date:'',sales_tax:'',retainage_pct:0,aia_billing:false,bonds:false,certified_payroll:false,ocip_ccip:false,third_party_billing:false,documents_needed:'',file_location:'',included_on_billing_schedule:false,included_on_lf_schedule:false,est_start_date:'',active_entry_date:todayISO});
  const[f,setF]=useState(emptyF);
  const[avgRates,setAvgRates]=useState({});
  const[jnLoading,setJnLoading]=useState(false);
  const genJobNum=async(mkt)=>{if(!mkt)return;setJnLoading(true);try{const num=await getNextJobNumber(mkt);setF(p=>({...p,job_number:num}));}catch(e){console.error('Job number gen failed:',e);}setJnLoading(false);};
  const set=(k,v)=>{setF(p=>{const u={...p,[k]:v};if(k==='market'){u.pm=AUTO_PM(v,u.fence_type);genJobNum(v);}if(k==='fence_type')u.pm=AUTO_PM(u.market,v);return u;});};
  // Fetch avg rates when market changes
  useEffect(()=>{if(!f.market)return;const mj=jobs.filter(j=>j.market===f.market);const avg=(field)=>{const valid=mj.filter(j=>n(j[field])>0);return valid.length?Math.round(valid.reduce((s,j)=>s+n(j[field]),0)/valid.length*100)/100:0;};setAvgRates({contract_rate_precast:avg('contract_rate_precast'),contract_rate_single_wythe:avg('contract_rate_single_wythe'),contract_rate_wrought_iron:avg('contract_rate_wrought_iron'),gate_rate:avg('gate_rate')});},[f.market,jobs]);
  const fLbl=(l,req)=>(<label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>{l}{req&&<span style={{color:'#991B1B'}}> *</span>}</label>);
  // Auto-calc contract values — recalculates on every render as f changes
  const ncv=n(f.lf_precast)*n(f.contract_rate_precast)+n(f.lf_single_wythe)*n(f.contract_rate_single_wythe)+n(f.lf_wrought_iron)*n(f.contract_rate_wrought_iron)+n(f.lf_removal)*n(f.contract_rate_removal)+n(f.lf_other)*n(f.contract_rate_other)+n(f.number_of_gates)*n(f.gate_rate)+n(f.lump_sum_amount);
  const stax=n(f.sales_tax);const cv=ncv+stax;const acv=cv;
  const totalLF=n(f.lf_precast)+n(f.lf_single_wythe)+n(f.lf_wrought_iron)+n(f.lf_removal)+n(f.lf_other);
  const ft=f.fence_type||'';const showPC=ft.includes('PC');const showSW=ft.includes('SW');const showWI=ft.includes('WI');
  const missing=[];if(!f.job_name)missing.push('Job Name');if(!f.customer_name)missing.push('Customer Name');if(!f.market)missing.push('Market');
  const submit=async()=>{if(missing.length)return;setSaving(true);const body={...f,net_contract_value:ncv,contract_value:cv,adj_contract_value:acv,sales_tax:stax,retainage_pct:n(f.retainage_pct),total_lf:totalLF,ytd_invoiced:0,pct_billed:0,left_to_bill:acv,change_orders:0};delete body.id;delete body.created_at;delete body.updated_at;const saved=await sbPost('jobs',body);if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',saved[0].job_number||saved[0].job_name);}setSaving(false);onSaved(`Project ${f.job_name} created`);};
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
        <div>{fLbl('Job Code')}<div style={{display:'flex',gap:4,alignItems:'center'}}><input value={f.job_number} onChange={e=>set('job_number',e.target.value)} placeholder={jnLoading?'Generating...':'e.g. 26H017'} style={{...inputS,flex:1}}/>{f.market&&<button type="button" onClick={()=>genJobNum(f.market)} title="Regenerate job number" style={{background:'none',border:'1px solid #D1CEC9',borderRadius:6,padding:'6px 8px',cursor:'pointer',fontSize:14,color:'#6B6056',lineHeight:1}} disabled={jnLoading}>↻</button>}</div>{f.job_number&&f.market&&<div style={{fontSize:10,color:'#10B981',marginTop:2}}>Auto-generated — edit if needed</div>}</div>
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
        <div style={{marginBottom:16}}>{fLbl('Fence Type')}<select value={f.fence_type} onChange={e=>set('fence_type',e.target.value)} style={inputS}>{['PC','SW','WI','PC/SW','PC/WI','PC/Columns','PC/Gates','SW/Columns','SW/Gate','SW/WI','WI/Gate','PC/SW/Columns','LABOR','Other'].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
        {showPC&&<div style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:700,color:'#8B2020',marginBottom:8,padding:'6px 10px',background:'#FDF4F4',borderRadius:6}}>PRECAST</div><div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
          <div>{fLbl('LF - Precast')}<input type="number" value={f.lf_precast} onChange={e=>set('lf_precast',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Height (ft)')}<input type="number" value={f.height_precast} onChange={e=>set('height_precast',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Style')}<select value={f.style||''} onChange={e=>set('style',e.target.value)} style={inputS}><option value="">— Select —</option>{DD.style.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
          <div>{fLbl('Color')}<input value={f.color} onChange={e=>set('color',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Rate ($/LF)')}<input type="number" value={f.contract_rate_precast} onChange={e=>set('contract_rate_precast',e.target.value)} placeholder={rateHint('contract_rate_precast')} style={inputS}/></div>
        </div></div>}
        {showSW&&<div style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:700,color:'#1D4ED8',marginBottom:8,padding:'6px 10px',background:'#DBEAFE',borderRadius:6}}>SINGLE WYTHE</div><div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
          <div>{fLbl('LF - Single Wythe')}<input type="number" value={f.lf_single_wythe} onChange={e=>set('lf_single_wythe',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Height (ft)')}<input type="number" value={f.height_single_wythe} onChange={e=>set('height_single_wythe',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Style')}<input value={f.style_single_wythe} onChange={e=>set('style_single_wythe',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Rate ($/LF)')}<input type="number" value={f.contract_rate_single_wythe} onChange={e=>set('contract_rate_single_wythe',e.target.value)} placeholder={rateHint('contract_rate_single_wythe')} style={inputS}/></div>
        </div></div>}
        {showWI&&<div style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:700,color:'#6D28D9',marginBottom:8,padding:'6px 10px',background:'#EDE9FE',borderRadius:6}}>WROUGHT IRON</div><div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
          <div>{fLbl('LF - Wrought Iron')}<input type="number" value={f.lf_wrought_iron} onChange={e=>set('lf_wrought_iron',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Height (ft)')}<input type="number" value={f.height_wrought_iron} onChange={e=>set('height_wrought_iron',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Rate ($/LF)')}<input type="number" value={f.contract_rate_wrought_iron} onChange={e=>set('contract_rate_wrought_iron',e.target.value)} placeholder={rateHint('contract_rate_wrought_iron')} style={inputS}/></div>
        </div></div>}
        <div style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:700,color:'#6B6056',marginBottom:8,padding:'6px 10px',background:'#F4F4F2',borderRadius:6}}>REMOVAL</div><div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
          <div>{fLbl('LF - Removal')}<input type="number" value={f.lf_removal} onChange={e=>set('lf_removal',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Height (ft)')}<input type="number" value={f.height_removal} onChange={e=>set('height_removal',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Material Type')}<input value={f.removal_material_type} onChange={e=>set('removal_material_type',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Rate ($/LF)')}<input type="number" value={f.contract_rate_removal} onChange={e=>set('contract_rate_removal',e.target.value)} style={inputS}/></div>
        </div></div>
        <div style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:700,color:'#6B6056',marginBottom:8,padding:'6px 10px',background:'#F4F4F2',borderRadius:6}}>GATES</div><div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
          <div>{fLbl('# of Gates')}<input type="number" value={f.number_of_gates} onChange={e=>set('number_of_gates',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Gate Height (ft)')}<input type="number" value={f.gate_height} onChange={e=>set('gate_height',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Gate Description')}<input value={f.gate_description} onChange={e=>set('gate_description',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Gate Rate ($)')}<input type="number" value={f.gate_rate} onChange={e=>set('gate_rate',e.target.value)} placeholder={rateHint('gate_rate')} style={inputS}/></div>
        </div></div>
        <div style={{marginBottom:20}}><div style={{fontSize:12,fontWeight:700,color:'#6B6056',marginBottom:8,padding:'6px 10px',background:'#F4F4F2',borderRadius:6}}>LUMP SUM / OTHER</div><div style={{display:'grid',gridTemplateColumns:grd,gap:12}}>
          <div>{fLbl('Lump Sum Amount')}<input type="number" value={f.lump_sum_amount} onChange={e=>set('lump_sum_amount',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Lump Sum Description')}<input value={f.lump_sum_description} onChange={e=>set('lump_sum_description',e.target.value)} style={inputS}/></div>
          <div>{fLbl('LF - Other')}<input type="number" value={f.lf_other} onChange={e=>set('lf_other',e.target.value)} style={inputS}/></div>
          <div>{fLbl('Rate - Other ($/LF)')}<input type="number" value={f.contract_rate_other} onChange={e=>set('contract_rate_other',e.target.value)} style={inputS}/></div>
        </div></div>
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
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {[{t:'Job Info',items:[['Job Code',f.job_number],['Job Name',f.job_name],['Customer',f.customer_name],['Market',f.market],['PM',f.pm],['Sales Rep',f.sales_rep],['Status',SL[f.status]||f.status]]},{t:'Fence',items:[['Type',f.fence_type],['Total LF',totalLF.toLocaleString()],['Gates',f.number_of_gates||'0']]},{t:'Contract',items:[['Net Value',$(ncv)],['Sales Tax',stax?$(stax):'Exempt'],['Contract Value',$(cv)],['Adj Contract Value',$(acv)],['Left to Bill',$(acv)],['Billing Method',f.billing_method],['Retainage',n(f.retainage_pct)+'%']]},{t:'Schedule',items:[['Est Start',fD(f.est_start_date)],['Contract Date',fD(f.contract_date)]]}].map(g=><div key={g.t} style={{...card,padding:14}}>
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
    const newJobs=jobs.filter(j=>j.created_at&&j.created_at>=weekAgo).length;
    const compJobs=jobs.filter(j=>j.complete_date&&j.complete_date>=weekAgo.split('T')[0]).length;
    Promise.all([
      sbGet('weather_days',`weather_date=gte.${weekAgo.split('T')[0]}&select=id`).catch(()=>[]),
      sbGet('change_orders',`status=eq.Pending&select=id`)
    ]).then(([wd,co])=>{
      setDigestStats({leftToBill:tl,zeroBilled,weatherDays:(wd||[]).length,pendingCO:(co||[]).length,newJobs,compJobs});
    });
  },[jobs,active]);
  const sendDigest=async()=>{setSending(true);try{await fetch(`${SB}/functions/v1/billing-alerts`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${KEY}`}});setLastSent(new Date().toLocaleString());}catch(e){}setSending(false);};
  return(<div style={card}>
    <div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Weekly Digest</div>
    {digestStats&&<div style={{marginBottom:12}}>
      {[['Total Left to Bill',$(digestStats.leftToBill)],['Jobs with 0% billed (active)',digestStats.zeroBilled+' jobs'],['Weather days logged this week',digestStats.weatherDays],['Change orders pending approval',digestStats.pendingCO],['New jobs added this week',digestStats.newJobs],['Jobs completed this week',digestStats.compJobs]].map(([l,v])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}><span style={{color:'#6B6056'}}>{l}</span><span style={{fontWeight:700}}>{v}</span></div>)}
    </div>}
    <div style={{fontSize:11,color:'#9E9B96',marginBottom:8}}>Recipients: david@fencecrete.com, alex@fencecrete.com</div>
    {lastSent&&<div style={{fontSize:11,color:'#065F46',marginBottom:8}}>Last sent: {lastSent}</div>}
    <button onClick={sendDigest} disabled={sending} style={{...btnP,width:'100%',opacity:sending?0.5:1}}>{sending?'Sending...':'Send Digest Now'}</button>
  </div>);
}

/* ═══ DASHBOARD ═══ */
function Dashboard({jobs,onNav}){
  const[showRemindConfirm,setShowRemindConfirm]=useState(false);
  const[remindSending,setRemindSending]=useState(false);
  const[dashToast,setDashToast]=useState(null);
  const sendReminders=async()=>{setRemindSending(true);setShowRemindConfirm(false);try{const res=await fetch(`${SB}/functions/v1/bill-sheet-reminder`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'}});const txt=await res.text();console.log('[Reminders] status=',res.status,'response=',txt);if(!res.ok)throw new Error(txt);const data=txt?JSON.parse(txt):{};setDashToast({msg:`Reminders sent! ${data.remindersSent||0} PMs notified, ${data.totalMissing||0} jobs missing. AR summary sent to david@fencecrete.com`,ok:true});}catch(e){console.error('[Reminders] Error:',e);setDashToast({msg:e.message||'Failed to send reminders',ok:false});}setRemindSending(false);};
  const active=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  const closedJobs=useMemo(()=>jobs.filter(j=>j.status==='closed'),[jobs]);
  const closedCV=closedJobs.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);
  const allBillable=useMemo(()=>jobs.filter(j=>j.status!=='cancelled'&&j.status!=='lost'),[jobs]);
  const tc=allBillable.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const tl=allBillable.reduce((s,j)=>s+n(j.left_to_bill),0);const ty=allBillable.reduce((s,j)=>s+n(j.ytd_invoiced),0);const BACKLOG_STS=new Set(['contract_review','production_queue','in_production','inventory_ready','active_install']);const tlf=jobs.filter(j=>BACKLOG_STS.has(j.status)).reduce((s,j)=>s+n(j.total_lf),0);
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
  // Current month bill sheet submissions for dashboard
  const dashBillingMonth=curBillingMonth();
  const[dashBillSubs,setDashBillSubs]=useState([]);
  useEffect(()=>{sbGet('pm_bill_submissions',`billing_month=eq.${dashBillingMonth}&select=id,job_id,submitted_by,submitted_at,total_lf,pct_complete_pm`).then(d=>setDashBillSubs(d||[]));},[dashBillingMonth]);

  return(<div>
    {dashToast&&<Toast message={dashToast.msg} isError={!dashToast.ok} onDone={()=>setDashToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Dashboard</h1>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:16}}>
      <KPI label="Total Contract" value={$k(tc)} sub={`All ${allBillable.length} jobs`}/>
      <KPI label="YTD Billed" value={$k(ty)} color="#065F46" sub="All jobs incl. closed"/>
      <KPI label="Left to Bill" value={$k(tl)} color="#B45309" sub="All jobs incl. closed"/>
      <div style={card}>
        <div style={{fontFamily:'Syne',fontSize:28,fontWeight:800,color:'#1D4ED8'}}>{tlf.toLocaleString()}</div>
        <div style={{fontSize:12,color:'#6B6056',marginTop:4}}>Backlog LF</div>
        <div style={{fontSize:10,color:'#9E9B96',marginTop:2}}>Active pipeline only</div>
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
    {(()=>{const PIPELINE_STAGES=[{key:'contract_review',label:'Review',color:'#6B7280',bg:'#F3F4F6'},{key:'production_queue',label:'Prod Queue',color:'#7C3AED',bg:'#EDE9FE'},{key:'in_production',label:'In Prod',color:'#1D4ED8',bg:'#DBEAFE'},{key:'inventory_ready',label:'Inventory',color:'#B45309',bg:'#FEF3C7'},{key:'active_install',label:'Active Install',color:'#C2410C',bg:'#FFEDD5'},{key:'fence_complete',label:'Fence Complete',color:'#0F766E',bg:'#CCFBF1'},{key:'fully_complete',label:'Fully Complete',color:'#15803D',bg:'#DCFCE7'}];const stData=PIPELINE_STAGES.map(s=>{const sj=jobs.filter(j=>j.status===s.key);return{...s,count:sj.length,lf:sj.reduce((x,j)=>x+n(j.total_lf),0)};});const fcCount=stData.find(s=>s.key==='fully_complete')?.count||0;const pipeTotal=stData.reduce((s2,d)=>s2+d.count,0);const pipeLF=stData.reduce((s2,d)=>s2+d.lf,0);return<div style={{...card,marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:12}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'#1A1A1A'}}>Production Pipeline</div><div style={{fontSize:12,color:'#6B6056'}}>{pipeTotal} active projects | {pipeLF.toLocaleString()} LF</div></div>
      <div style={{display:'flex',gap:4,alignItems:'stretch',flexWrap:'wrap'}}>
        {stData.map((s,i)=><React.Fragment key={s.key}>
          {i>0&&<span style={{color:'#D1CEC9',fontSize:16,alignSelf:'center'}}>→</span>}
          <div onClick={()=>onNav&&onNav('production')} style={{flex:'1 1 0',minWidth:80,background:s.bg,border:`1px solid ${s.color}40`,borderRadius:10,padding:'10px 6px',textAlign:'center',cursor:onNav?'pointer':'default'}}>
            <div style={{fontSize:9,fontWeight:700,color:s.color,textTransform:'uppercase',marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.label}</div>
            <div style={{fontFamily:'Inter',fontWeight:900,fontSize:22,color:s.color}}>{s.count}</div>
            <div style={{fontSize:10,color:'#6B6056',marginTop:2}}>{s.lf.toLocaleString()} LF</div>
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
  {label:'Product',keys:['fence_type','primary_fence_type','fence_addons','lf_precast','lf_single_wythe','lf_wrought_iron','total_lf','style','color','height_precast']},
  {label:'Contract',keys:['contract_value','change_orders','adj_contract_value','net_contract_value','sales_tax','billing_method','billing_date']},
  {label:'Billing',keys:['ytd_invoiced','pct_billed','left_to_bill','last_billed','contract_date','retainage_pct','retainage_held']},
  {label:'Schedule',keys:['est_start_date','start_month','contract_age','active_entry_date','complete_date','complete_month']},
  {label:'Requirements',keys:['aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing']},
  {label:'Team',keys:['sales_rep','pm','job_type']},
  {label:'Other',keys:['notes','documents_needed','file_location','address','city','state','zip']}
];
function ProjectsPage({jobs,onRefresh,openJob}){
  const[projTab,setProjTab]=useState('active');
  const[search,setSearch]=useState('');const[statusF,setStatusF]=useState(null);const[mktF,setMktF]=useState(null);const[pmF,setPmF]=useState('');const[primaryTypeF,setPrimaryTypeF]=useState('');const[addonsF,setAddonsF]=useState('');
  const[sortCol,setSortCol]=useState('left_to_bill');const[sortDir,setSortDir]=useState('desc');
  const[closedYearF,setClosedYearF]=useState('');
  const[visCols,setVisCols]=useState(()=>{try{const s=localStorage.getItem('fc_vis_cols');if(!s)return DEF_VIS;const saved=JSON.parse(s);const ensure=['primary_fence_type','fence_addons'];const missing=ensure.filter(k=>!saved.includes(k));if(missing.length>0){const ftIdx=saved.indexOf('fence_type');const insertAt=ftIdx>=0?ftIdx+1:saved.length;const updated=[...saved.slice(0,insertAt),...missing,...saved.slice(insertAt)];localStorage.setItem('fc_vis_cols',JSON.stringify(updated));return updated;}return saved;}catch(e){return DEF_VIS;}});const[showCols,setShowCols]=useState(false);
  useEffect(()=>{try{localStorage.setItem('fc_vis_cols',JSON.stringify(visCols));}catch(e){}},[visCols]);
  const[editJob,setEditJob]=useState(openJob||null);const[isNew,setIsNew]=useState(false);const[showNewForm,setShowNewForm]=useState(false);
  const[editMode,setEditMode]=useState(false);const[inlE,setInlE]=useState(null);
  const[sel,setSel]=useState(new Set());const[toast,setToast]=useState(null);
  useEffect(()=>{if(openJob)setEditJob(openJob);},[openJob]);
  useEffect(()=>setSel(new Set()),[search,statusF,mktF,pmF]);
  const toggleSort=k=>{if(sortCol===k)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(k);setSortDir('desc');}};
  const closedJobs=useMemo(()=>{let f=jobs.filter(j=>j.status==='closed');if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}if(mktF)f=f.filter(j=>j.market===mktF);if(pmF)f=f.filter(j=>j.pm===pmF);if(closedYearF){if(closedYearF==='older')f=f.filter(j=>j.closed_date&&parseInt(j.closed_date.slice(0,4))<=2023);else f=f.filter(j=>j.closed_date&&j.closed_date.startsWith(closedYearF));}return[...f].sort((a,b)=>(b.closed_date||'').localeCompare(a.closed_date||''));},[jobs,search,mktF,pmF,closedYearF]);
  const closedCount=jobs.filter(j=>j.status==='closed').length;
  const closedStats=useMemo(()=>{const cj=jobs.filter(j=>j.status==='closed');return{count:cj.length,cv:cj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0),lf:cj.reduce((s,j)=>s+n(j.total_lf),0),avgPct:cj.length>0?Math.round(cj.reduce((s,j)=>s+n(j.pct_billed),0)/cj.length*100):0};},[jobs]);
  const filtered=useMemo(()=>{let f=jobs.filter(j=>j.status!=='closed');if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}if(statusF)f=f.filter(j=>j.status===statusF);if(mktF)f=f.filter(j=>j.market===mktF);if(pmF)f=f.filter(j=>j.pm===pmF);if(primaryTypeF)f=f.filter(j=>j.primary_fence_type===primaryTypeF);if(addonsF==='has_any')f=f.filter(j=>Array.isArray(j.fence_addons)&&j.fence_addons.length>0);else if(addonsF)f=f.filter(j=>Array.isArray(j.fence_addons)&&j.fence_addons.includes(addonsF));return[...f].sort((a,b)=>{let av=a[sortCol],bv=b[sortCol];if(typeof av==='string')return sortDir==='asc'?(av||'').localeCompare(bv||''):(bv||'').localeCompare(av||'');return sortDir==='asc'?n(av)-n(bv):n(bv)-n(av);});},[jobs,search,statusF,mktF,pmF,primaryTypeF,addonsF,sortCol,sortDir]);
  const exportCSV=rows=>{const cols=ALL_COLS.filter(c=>visCols.includes(c.key));const h=cols.map(c=>c.label).join(',');const r=rows.map(j=>cols.map(c=>{let v=j[c.key];if(Array.isArray(v))v=v.join('; ');return typeof v==='string'&&v.includes(',')?`"${v}"`:(v??'');}).join(','));const b=new Blob([h+'\n'+r.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='fencecrete-projects.csv';a.click();};
  const saveInline=async()=>{if(!inlE)return;const u={[inlE.key]:inlE.value};if(inlE.key==='ytd_invoiced'){const adj=n(inlE.job.adj_contract_value||inlE.job.contract_value);const ytd=n(inlE.value);u.pct_billed=adj>0?Math.round(ytd/adj*10000)/10000:0;u.left_to_bill=adj-ytd;}await sbPatch('jobs',inlE.id,u);const j=jobs.find(x=>x.id===inlE.id);if(['ytd_invoiced','last_billed'].includes(inlE.key)){fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update',inlE.key,j[inlE.key],inlE.value);}else{fireAlert('job_updated',{...j,...u});logAct(j,'field_update',inlE.key,j[inlE.key],inlE.value);}setInlE(null);setToast('Saved');onRefresh();};
  const bulkStatus=async s=>{for(const id of sel){const j=jobs.find(x=>x.id===id);if(j){await sbPatch('jobs',id,{status:s});fireAlert('job_updated',{...j,status:s});logAct(j,'status_change','status',j.status,s);}}setSel(new Set());setToast(`Updated ${sel.size} projects`);onRefresh();};
  const bulkRep=async r=>{for(const id of sel){const j=jobs.find(x=>x.id===id);if(j){await sbPatch('jobs',id,{sales_rep:r});logAct(j,'field_update','sales_rep',j.sales_rep,r);}}setSel(new Set());setToast(`Assigned to ${r}`);onRefresh();};
  const visCD=ALL_COLS.filter(c=>visCols.includes(c.key));
  const inlineField=(j,k)=>{const dd=DD[k];if(dd)return<select autoFocus value={inlE?.value||''} onChange={e=>{setInlE({...inlE,value:e.target.value});}} onBlur={saveInline} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12}}><option value="">—</option>{dd.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>;if(k==='est_start_date'||k==='last_billed')return<input autoFocus type="date" value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onKeyDown={e=>{if(e.key==='Enter')saveInline();if(e.key==='Escape')setInlE(null);}} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12,width:'100%'}}/>;return<input autoFocus value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onKeyDown={e=>{if(e.key==='Enter')saveInline();if(e.key==='Escape')setInlE(null);}} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12,width:'100%'}}/>;};
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
        <select value={statusF||''} onChange={e=>setStatusF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Statuses</option>{STS.map(s=><option key={s} value={s}>{SL[s]}</option>)}</select>
        <select value={mktF||''} onChange={e=>setMktF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Markets</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select>
        <select value={pmF} onChange={e=>setPmF(e.target.value)} style={{...inputS,width:160}}><option value="">All PMs</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <select value={primaryTypeF} onChange={e=>setPrimaryTypeF(e.target.value)} style={{...inputS,width:140}}><option value="">All Types</option><option value="Precast">Precast</option><option value="Masonry">Masonry</option><option value="Wrought Iron">Wrought Iron</option></select>
        <select value={addonsF} onChange={e=>setAddonsF(e.target.value)} style={{...inputS,width:160}}><option value="">All Add-ons</option><option value="has_any">Has Any Add-on</option><option value="G">Gates (G)</option><option value="C">Columns (C)</option><option value="WI">Wrought Iron (WI)</option></select>
      </div>}
      {projTab==='closed'&&<div style={{display:'flex',gap:8,marginBottom:4,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search closed projects..." style={{...inputS,width:240}}/>
        <select value={mktF||''} onChange={e=>setMktF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Markets</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select>
        <select value={pmF} onChange={e=>setPmF(e.target.value)} style={{...inputS,width:160}}><option value="">All PMs</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <select value={closedYearF} onChange={e=>setClosedYearF(e.target.value)} style={{...inputS,width:140}}><option value="">All Years</option><option value="2026">2026</option><option value="2025">2025</option><option value="2024">2024</option><option value="older">2023 & Earlier</option></select>
      </div>}
      {projTab==='active'&&<div style={{fontSize:12,color:'#6B6056',padding:'4px 0'}}>Showing {filtered.length} jobs | {$k(fTC)} contract value | {$k(fLTB)} left to bill | {Math.round(fAvgB*100)}% avg billed</div>}
    </div>
    {/* Closed tab stats */}
    {projTab==='closed'&&<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:12}}>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{closedStats.count}</div><div style={{fontSize:10,color:'#6B6056'}}>Total Closed Jobs</div></div>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#065F46'}}>{$k(closedStats.cv)}</div><div style={{fontSize:10,color:'#6B6056'}}>Total Contract Value</div></div>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{closedStats.lf.toLocaleString()}</div><div style={{fontSize:10,color:'#6B6056'}}>Total LF</div></div>
      <div style={{...card,padding:'10px 14px'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:closedStats.avgPct>=90?'#065F46':'#B45309'}}>{closedStats.avgPct}%</div><div style={{fontSize:10,color:'#6B6056'}}>Avg % Billed at Close</div></div>
    </div>}
    {/* Active tab bulk actions + table */}
    {projTab==='active'&&<>
    {sel.size>0&&<div style={{background:'#1A1A1A',borderRadius:8,padding:'8px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12,color:'#fff',fontSize:13}}><span style={{fontWeight:700}}>{sel.size} selected</span><select onChange={e=>{if(e.target.value)bulkStatus(e.target.value);e.target.value='';}} style={{...inputS,width:160,background:'#2A2A2A',color:'#fff',border:'1px solid #444'}}><option value="">Change Status...</option>{STS.map(s=><option key={s} value={s}>{SL[s]}</option>)}</select><select onChange={e=>{if(e.target.value)bulkRep(e.target.value);e.target.value='';}} style={{...inputS,width:140,background:'#2A2A2A',color:'#fff',border:'1px solid #444'}}><option value="">Assign Rep...</option>{REPS.map(r=><option key={r} value={r}>{r}</option>)}</select><button onClick={()=>exportCSV(filtered.filter(j=>sel.has(j.id)))} style={{...btnP,padding:'4px 12px',fontSize:12}}>Export</button><button onClick={()=>setSel(new Set())} style={{background:'transparent',border:'1px solid #444',borderRadius:6,color:'#fff',padding:'4px 12px',fontSize:12,cursor:'pointer'}}>Clear</button></div>}
    <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 220px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr><th style={{width:40,padding:'10px 8px',borderBottom:'1px solid #E5E3E0'}}><input type="checkbox" checked={sel.size===filtered.length&&filtered.length>0} onChange={()=>{if(sel.size===filtered.length)setSel(new Set());else setSel(new Set(filtered.map(j=>j.id)));}} /></th>{visCD.map(c=><th key={c.key} onClick={()=>toggleSort(c.key)} style={{textAlign:'left',padding:'10px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0.5,userSelect:'none'}}>{c.label} {sortCol===c.key&&(sortDir==='asc'?'↑':'↓')}</th>)}</tr></thead>
        <tbody>{filtered.map((j,i)=><tr key={j.id} onClick={()=>{if(!editMode&&!sel.size){setEditJob(j);setIsNew(false);}}} style={{cursor:editMode?'default':'pointer',borderLeft:`3px solid ${SC[j.status]||'transparent'}`,background:i%2===0?'#FFF':'#FAFAF8'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#FFF':'#FAFAF8'}>
          <td style={{width:40,padding:'8px 8px'}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={sel.has(j.id)} onChange={()=>{const s=new Set(sel);if(s.has(j.id))s.delete(j.id);else s.add(j.id);setSel(s);}}/></td>
          {visCD.map(c=><td key={c.key} onClick={e=>{if(editMode){e.stopPropagation();setInlE({id:j.id,key:c.key,value:j[c.key]??'',job:j});}}} style={{padding:'8px 10px',whiteSpace:'nowrap',maxWidth:c.w,overflow:'hidden',textOverflow:'ellipsis',cursor:editMode?'cell':'pointer'}}>{inlE&&inlE.id===j.id&&inlE.key===c.key?inlineField(j,c.key):renderCell(j,c.key)}</td>)}
        </tr>)}</tbody></table>
    </div>
    </>}
    {/* Closed tab table */}
    {projTab==='closed'&&<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 320px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}>
        <tr>{['Job #','Job Name','PM','Market','Style','Color','Closed Date','Contract Value','Total LF','YTD Invoiced','% Billed'].map(h=><th key={h} style={{textAlign:'left',padding:'10px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0.5}}>{h}</th>)}</tr>
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
        <td style={{padding:'8px 10px'}}>{n(j.total_lf).toLocaleString()}</td>
        <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:600,color:'#065F46'}}>{$(j.ytd_invoiced)}</td>
        <td style={{padding:'8px 10px'}}>{fmtPct(j.pct_billed)}</td>
      </tr>)}</tbody></table>
      {closedJobs.length===0&&<div style={{padding:40,textAlign:'center',color:'#9E9B96'}}>No closed projects found</div>}
    </div>}
    {editJob&&<EditPanel job={editJob} isNew={false} onClose={()=>{setEditJob(null);setIsNew(false);}} onSaved={msg=>{setEditJob(null);setIsNew(false);if(msg)setToast(msg);onRefresh();}}/>}
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
    {arDetail&&(()=>{const s=arDetail.sub;return<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>{setArDetail(null);setArForm({ar_notes:'',ar_reviewed_by:''});}}>
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

function PMBillingPage({jobs,onRefresh}){
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

  const LF_FIELDS=['labor_post_only','labor_post_panels','labor_complete','sw_foundation','sw_columns','sw_panels','sw_complete','wi_gates','wi_fencing','wi_columns','line_bonds','line_permits','remove_existing','gate_controls'];
  const calcLFTotal=(form)=>LF_FIELDS.reduce((s,f)=>s+n(form[f]),0);
  const emptyForm=()=>({pct_complete:'',notes:'',...Object.fromEntries(LF_FIELDS.map(f=>[f,'']))});
  const pickPM=pm=>{setSelPM(pm);localStorage.setItem('fc_pm',pm);setExpandedRow(null);setEditingRow(null);setSelected(new Set());};
  const selMonthLabel=monthLabel(selMonth);
  const activeJobs=useMemo(()=>{let j2=jobs.filter(j=>ACTIVE_BILL_STATUSES.includes(j.status));if(selPM)j2=j2.filter(j=>j.pm===selPM);return j2.sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||''));},[jobs,selPM]);
  const fetchSubs=useCallback(async()=>{if(!selPM)return;const d=await sbGet('pm_bill_submissions',`billing_month=eq.${selMonth}&pm=eq.${selPM}&order=created_at.desc`);setSubs(d||[]);},[selMonth,selPM]);
  useEffect(()=>{fetchSubs();},[fetchSubs]);
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
  const filteredJobs=useMemo(()=>{if(filterTab==='all')return activeJobs;return activeJobs.filter(j=>getStatus(j)===filterTab);},[activeJobs,filterTab,subByJob]);

  const getForm=(jobId)=>forms[jobId]||emptyForm();
  const updateForm=(jobId,field,val)=>setForms(prev=>({...prev,[jobId]:{...(prev[jobId]||emptyForm()),[field]:val}}));
  const expandRow=(jobId)=>{if(expandedRow===jobId){setExpandedRow(null);setEditingRow(null);}else{setExpandedRow(jobId);setEditingRow(null);}};
  const openEdit=(job,sub)=>{const form={pct_complete:sub.pct_complete_pm!=null?String(sub.pct_complete_pm):'',notes:sub.notes||'',...Object.fromEntries(LF_FIELDS.map(f=>[f,n(sub[f])!==0?String(n(sub[f])):'']))};setForms(prev=>({...prev,[job.id]:form}));setEditingRow(job.id);setExpandedRow(job.id);};

  const resetSub=async(job,isAdmin)=>{const sub=subByJob[job.id];if(!sub)return;try{await fetch(`${SB}/rest/v1/pm_bill_submissions?id=eq.${sub.id}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});if(isAdmin){try{await sbPost('activity_log',{job_id:job.id,job_number:job.job_number,job_name:job.job_name,action:'admin_bill_sheet_reset',field_name:'pm_bill_submissions',old_value:'reviewed',new_value:'reset',changed_by:'admin'});}catch(e2){}}setSubs(prev=>prev.filter(s=>s.id!==sub.id));setConfirmReset(null);setAdminPinJob(null);setAdminPin('');setToast(isAdmin?'Submission reset by admin':`Bill sheet reset for ${job.job_name}`);}catch(e){setToast({message:e.message||'Reset failed',isError:true});}};

  const buildPayload=(job,formVals)=>({billing_month:selMonth,job_id:job.id,job_number:job.job_number,job_name:job.job_name,pm:selPM,market:job.market,style:job.style||null,color:job.color||null,height:job.height_precast||null,adj_contract_value:parseFloat(job.adj_contract_value)||0,total_lf:parseInt(job.total_lf)||0,labor_post_only:parseFloat(formVals.labor_post_only)||0,labor_post_panels:parseFloat(formVals.labor_post_panels)||0,labor_complete:parseFloat(formVals.labor_complete)||0,sw_foundation:parseFloat(formVals.sw_foundation)||0,sw_columns:parseFloat(formVals.sw_columns)||0,sw_panels:parseFloat(formVals.sw_panels)||0,sw_complete:parseFloat(formVals.sw_complete)||0,wi_gates:parseFloat(formVals.wi_gates)||0,wi_fencing:parseFloat(formVals.wi_fencing)||0,wi_columns:parseFloat(formVals.wi_columns)||0,line_bonds:parseFloat(formVals.line_bonds)||0,line_permits:parseFloat(formVals.line_permits)||0,remove_existing:parseFloat(formVals.remove_existing)||0,gate_controls:parseFloat(formVals.gate_controls)||0,lf_panels_washed:0,pct_complete_pm:parseFloat(formVals.pct_complete)||0,notes:formVals.notes||null,submitted_by:selPM,submitted_at:new Date().toISOString(),ar_reviewed:false});

  const submitEntry=async(job)=>{const form=getForm(job.id);setSaving(job.id);try{const payload=buildPayload(job,form);const res=await fetch(`${SB}/rest/v1/pm_bill_submissions`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});const resTxt=await res.text();if(!res.ok)throw new Error(`Save failed (${res.status}): ${resTxt}`);const saved=resTxt?JSON.parse(resTxt):[];const rec=saved[0]||saved;const existing=subByJob[job.id];if(existing){setSubs(prev=>prev.map(s=>s.id===existing.id?rec:s));}else{setSubs(prev=>[rec,...prev]);}setToast(`Submitted: ${job.job_name}`);fetch(`${SB}/functions/v1/bill-sheet-submitted-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submission:rec,job})}).catch(e=>console.error('Notification failed:',e));setEditingRow(null);setExpandedRow(null);}catch(e){setToast({message:e.message||'Submit failed',isError:true});}setSaving(null);};

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
    {/* Filter tabs */}
    <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>{filterTabs.map(([k,l,c,col,bg])=><button key={k} onClick={()=>{setFilterTab(k);setExpandedRow(null);setEditingRow(null);setSelected(new Set());}} style={{padding:'7px 14px',borderRadius:8,border:filterTab===k?`2px solid ${col}`:'1px solid #E5E3E0',background:filterTab===k?bg:'#FFF',color:filterTab===k?col:'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>{l} ({c})</button>)}</div>
    {/* Batch submit for Missing tab */}
    {filterTab==='missing'&&missingJobs.length>0&&<div style={{...card,marginBottom:10,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:'#6B6056',cursor:'pointer'}}><input type="checkbox" checked={selected.size===missingJobs.length&&missingJobs.length>0} onChange={toggleSelectAll} style={{width:16,height:16,accentColor:'#8B2020'}}/>Select all missing jobs</label>
      {selected.size>0&&<button onClick={()=>setShowBatchConfirm(true)} style={{...btnP,padding:'6px 14px',fontSize:12,background:'#B45309'}}>Submit {selected.size} as $0 / No Activity</button>}
    </div>}
    {/* Job list — compact rows */}
    {filteredJobs.length===0?<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No jobs in this filter</div>:<div style={{display:'flex',flexDirection:'column',gap:6}}>
      {filteredJobs.map(j=>{const sub=subByJob[j.id];const status=getStatus(j);const isExp=expandedRow===j.id;const isEditing=editingRow===j.id;const form=getForm(j.id);const subDate=sub&&sub.submitted_at?new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';const rowBg=status==='reviewed'?'#EFF6FF':status==='submitted'?'#ECFDF5':'#FFF';const borderColor=status==='reviewed'?'#3B82F6':status==='submitted'?'#10B981':'#EF4444';const icon=status==='reviewed'?'✅':status==='submitted'?'✓':'✗';const iconColor=status==='reviewed'?'#1D4ED8':status==='submitted'?'#10B981':'#EF4444';
        return<div key={j.id} style={{background:rowBg,borderLeft:`3px solid ${borderColor}`,borderRadius:6,border:'1px solid #E5E3E0',overflow:'hidden'}}>
          {/* Compact row */}
          <div onClick={()=>status!=='reviewed'&&expandRow(j.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:status==='reviewed'?'default':'pointer',minHeight:48}}>
            {filterTab==='missing'&&status==='missing'&&<input type="checkbox" checked={selected.has(j.id)} onChange={e=>{e.stopPropagation();toggleSelect(j.id);}} onClick={e=>e.stopPropagation()} style={{width:16,height:16,accentColor:'#8B2020'}}/>}
            <span style={{fontSize:16,color:iconColor,fontWeight:700,width:18,textAlign:'center'}}>{icon}</span>
            <span style={{fontSize:11,color:'#9E9B96',fontFamily:'Inter',fontWeight:600,width:60}}>{j.job_number||'—'}</span>
            <span style={{fontSize:13,fontWeight:600,color:'#1A1A1A',flex:'1 1 200px',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</span>
            <span style={{fontSize:11,color:'#6B6056',display:'flex',gap:6,flexWrap:'nowrap'}}>
              {j.style&&<span>{j.style}</span>}
              {j.height_precast&&<span style={{opacity:0.7}}>{j.height_precast}ft</span>}
              {n(j.total_lf)>0&&<span style={{fontWeight:700,color:'#1A1A1A'}}>{n(j.total_lf).toLocaleString()}LF</span>}
            </span>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {status==='missing'&&<button onClick={e=>{e.stopPropagation();expandRow(j.id);}} style={{...btnP,padding:'5px 14px',fontSize:11}}>Submit</button>}
              {status==='submitted'&&<><span style={{fontSize:11,color:'#065F46',fontWeight:600}}>Submitted {subDate}</span><span style={{fontSize:11,color:'#9E9B96',transition:'transform .3s',display:'inline-block',transform:isExp?'rotate(180deg)':'rotate(0deg)'}}>▼</span></>}
              {status==='reviewed'&&<span style={{fontSize:11,color:'#1D4ED8',fontWeight:600}}>Reviewed {sub.ar_reviewed_at?new Date(sub.ar_reviewed_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}</span>}
            </div>
          </div>
          {/* Expanded inline form */}
          {isExp&&status!=='reviewed'&&<div style={{padding:'12px 14px',borderTop:'1px solid #E5E3E0',background:'#FFF'}}>
            {status==='submitted'&&!isEditing?<>
              {renderLFReadOnly(sub)}
              <div style={{display:'flex',gap:12,marginTop:8,fontSize:12,color:'#6B6056'}}>{n(sub.total_lf)>0&&<span>Total LF: <b style={{color:'#1A1A1A'}}>{n(sub.total_lf).toLocaleString()}</b></span>}{sub.pct_complete_pm!=null&&<span>% Complete: <b style={{color:'#1A1A1A'}}>{sub.pct_complete_pm}%</b></span>}</div>
              {sub.notes&&<div style={{fontSize:12,color:'#6B6056',marginTop:4}}>Notes: {sub.notes}</div>}
              <div style={{marginTop:10,display:'flex',gap:8}}><button onClick={e=>{e.stopPropagation();openEdit(j,sub);}} style={{...btnS,padding:'6px 14px',fontSize:12}}>Edit Submission</button><button onClick={e=>{e.stopPropagation();setConfirmReset(j);}} style={{background:'none',border:'1px solid #EF444440',borderRadius:6,padding:'5px 10px',fontSize:11,color:'#EF4444',cursor:'pointer'}}>Reset</button></div>
            </>:<>
              {renderLFForm(j.id)}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2,textTransform:'uppercase',fontWeight:600}}>% Complete</label><input type="number" min="0" max="100" value={form.pct_complete} onChange={e=>updateForm(j.id,'pct_complete',e.target.value)} placeholder="e.g. 65" style={{...inputS,padding:'6px 10px',fontSize:13}}/></div>
                <div style={{display:'flex',alignItems:'flex-end'}}><div style={{background:'#F9F8F6',borderRadius:6,padding:'6px 10px',fontSize:12}}>Total LF: <span style={{fontFamily:'Inter',fontWeight:800,color:'#8B2020'}}>{calcLFTotal(form).toLocaleString()}</span></div></div>
              </div>
              <div style={{marginBottom:10}}><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2,textTransform:'uppercase',fontWeight:600}}>Notes</label><textarea value={form.notes} onChange={e=>updateForm(j.id,'notes',e.target.value)} rows={2} placeholder="Section completed, upcoming work, issues..." style={{...inputS,padding:'6px 10px',fontSize:13,resize:'vertical'}}/></div>
              <div style={{display:'flex',gap:8}}><button onClick={()=>submitEntry(j)} disabled={saving===j.id} style={{...btnP,flex:1,padding:'8px 0',fontSize:13,opacity:saving===j.id?0.5:1}}>{saving===j.id?'Saving...':sub?'Update Submission':'Submit'}</button><button onClick={()=>{setExpandedRow(null);setEditingRow(null);}} style={btnS}>Cancel</button></div>
            </>}
          </div>}
          {status==='reviewed'&&<div style={{padding:'8px 14px',borderTop:'1px solid #BFDBFE',background:'#EFF6FF',fontSize:11,color:'#1D4ED8',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>Reviewed by AR{sub.ar_reviewed_by?' — '+sub.ar_reviewed_by:''}</span>
            <button onClick={()=>{setAdminPinJob(j);setAdminPin('');setAdminPinErr(false);}} style={{background:'none',border:'none',padding:0,fontSize:10,color:'#9E9B96',cursor:'pointer',textDecoration:'underline'}}>Admin Reset</button>
          </div>}
        </div>;
      })}
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
function ProdCard({j,move,locked,billSub,onViewBill,onQuickView,onPrintOrder,onCalcMaterials,onAddToPlan,inPlanDate,progressInfo}){const ns=NEXT_STATUS[j.status];const stageDate=j[STAGE_DATE_KEY[j.status]]||j.est_start_date;const daysIn=stageDate?Math.max(0,Math.round((Date.now()-new Date(stageDate).getTime())/86400000)):null;const thresh=STAGE_THRESHOLDS[j.status];const ageSev=daysIn!=null&&thresh?(daysIn>=thresh[1]?'critical':daysIn>=thresh[0]?'warn':null):null;const totalPieces=(n(j.material_posts_line)+n(j.material_posts_corner)+n(j.material_posts_stop))||(n(j.material_panels_regular)+n(j.material_panels_half));return<div style={{...card,padding:12,marginBottom:6,position:'relative'}}>{Array.isArray(j.fence_addons)&&j.fence_addons.length>0&&<div style={{position:'absolute',top:8,right:8,display:'flex',flexDirection:'column',gap:3,zIndex:1}}>{j.fence_addons.map(a=>{const ac={G:['#B45309','G'],C:['#6D28D9','C'],WI:['#374151','WI']};const[bg,lbl]=ac[a]||['#6B6056',a];return<span key={a} style={{display:'block',padding:'3px 8px',borderRadius:5,fontSize:11,fontWeight:700,background:bg,color:'#FFF',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}>{lbl}</span>;})}</div>}<div style={{fontSize:10,color:'#9E9B96',marginBottom:1}}>#{j.job_number}</div><div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',paddingRight:Array.isArray(j.fence_addons)&&j.fence_addons.length>0?36:0}}><span onClick={e=>{e.stopPropagation();if(onQuickView)onQuickView(j);}} style={{cursor:'pointer',borderBottom:'1px dashed transparent'}} onMouseEnter={e=>e.currentTarget.style.borderBottomColor='#8B2020'} onMouseLeave={e=>e.currentTarget.style.borderBottomColor='transparent'}>{j.job_name}</span></div><div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span>{j.pm&&<span style={{fontSize:10,color:'#6B6056',background:'#F4F4F2',padding:'1px 5px',borderRadius:4}}>{j.pm}</span>}</div><div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B6056',marginBottom:2}}><span>{n(j.total_lf).toLocaleString()} LF</span><span style={{fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(j.adj_contract_value||j.contract_value)}</span></div>{(j.style||j.color||j.height_precast)&&<div style={{fontSize:10,color:'#9E9B96',marginBottom:2}}>{[j.style,j.color,j.height_precast?j.height_precast+'ft':null].filter(Boolean).join(' | ')}</div>}{j.est_start_date&&<div style={{marginBottom:2}}><StartDateBadge date={j.est_start_date} status={j.status}/></div>}{j.status==='contract_review'&&!j.material_calc_date&&onCalcMaterials&&<div onClick={e=>{e.stopPropagation();onCalcMaterials(j);}} style={{marginTop:4,padding:'6px 8px',background:'#FEF3C7',border:'1px solid #B4530940',borderRadius:6,fontSize:10,fontWeight:700,color:'#B45309',cursor:'pointer',textAlign:'center'}}>📋 Calculate materials to schedule →</div>}{j.status==='contract_review'&&j.material_calc_date&&<div style={{marginTop:4,padding:'6px 8px',background:'#D1FAE5',border:'1px solid #065F4640',borderRadius:6,fontSize:10,fontWeight:700,color:'#065F46',textAlign:'center'}}>✓ Materials calculated {new Date(j.material_calc_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}{j.status==='production_queue'&&j.material_calc_date&&<div style={{marginTop:4,padding:'6px 8px',background:'#EDE9FE',border:'1px solid #7C3AED40',borderRadius:6,fontSize:10,color:'#5B21B6'}}>{totalPieces>0&&<div style={{fontWeight:700}}>📦 {totalPieces} pcs | {n(j.total_lf).toLocaleString()} LF</div>}{inPlanDate?<div style={{marginTop:2,fontWeight:600}}>✓ In plan for {inPlanDate}</div>:onAddToPlan&&<div onClick={e=>{e.stopPropagation();onAddToPlan(j);}} style={{marginTop:2,cursor:'pointer',fontWeight:700,textAlign:'center'}}>📅 Add to Plan →</div>}</div>}{j.status==='in_production'&&progressInfo&&<div style={{marginTop:4,padding:'6px 8px',background:'#DBEAFE',border:'1px solid #1D4ED840',borderRadius:6,fontSize:10,color:'#1D4ED8'}}><div style={{display:'flex',justifyContent:'space-between',fontWeight:700,marginBottom:3}}><span>{progressInfo.pct}%</span><span>{progressInfo.actual} of {progressInfo.planned} pcs</span></div><div style={{height:4,background:'#E5E3E0',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(progressInfo.pct,100)}%`,background:'#1D4ED8'}}/></div><div style={{fontSize:9,marginTop:3,color:progressInfo.loggedToday?'#065F46':'#B45309'}}>{progressInfo.loggedToday?'✓ Logged today':'⚠ Not logged today'}</div></div>}{j.status==='inventory_ready'&&<div style={{marginTop:4,padding:'6px 8px',background:'#D1FAE5',border:'1px solid #10B98140',borderRadius:6,fontSize:10,fontWeight:700,color:'#065F46',textAlign:'center'}}>✅ Production complete{totalPieces>0?` — ${totalPieces} pcs ready`:''}</div>}<div style={{marginTop:4,paddingTop:4,borderTop:'1px solid #F4F4F2',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div>{ageSev&&<span style={{display:'inline-block',padding:'1px 5px',borderRadius:4,fontSize:10,fontWeight:700,marginRight:4,background:ageSev==='critical'?'#FEE2E2':'#FEF3C7',color:ageSev==='critical'?'#991B1B':'#B45309'}}>{ageSev==='critical'?'🔴':'⏱'} {daysIn}d</span>}</div><div style={{display:'flex',gap:6,alignItems:'center'}}>{j.material_calc_date?<span onClick={e=>{e.stopPropagation();if(onPrintOrder)onPrintOrder(j);}} title={`Production order saved ${new Date(j.material_calc_date).toLocaleDateString()}`} style={{cursor:onPrintOrder?'pointer':'default',fontSize:12}}>📋</span>:<span title="No production order" style={{fontSize:9,color:'#C8C4BD'}}>📋</span>}{billSub?<button onClick={e=>{e.stopPropagation();onViewBill(billSub);}} style={{background:'none',border:'none',padding:0,cursor:'pointer',fontSize:10,fontWeight:700,color:'#10B981'}}>Bill ✓</button>:<span style={{fontSize:10,fontWeight:600,color:'#EF4444'}}>No Bill</span>}</div></div>{!locked&&<div style={{display:'flex',gap:4,marginTop:6}}>{ns&&<button onClick={()=>move(j,ns)} style={{flex:2,padding:'5px 4px',borderRadius:6,border:`1px solid ${SC[ns]}40`,background:SB_[ns],color:SC[ns],fontSize:10,fontWeight:700,cursor:'pointer'}}>→ {SS[ns]}</button>}<select onChange={e=>{if(e.target.value)move(j,e.target.value);e.target.value='';}} style={{flex:1,padding:'4px',borderRadius:6,border:'1px solid #E5E3E0',fontSize:10,color:'#6B6056',cursor:'pointer',background:'#FFF'}}><option value="">More...</option>{STS.filter(s=>s!==j.status&&s!==ns).map(s=><option key={s} value={s}>{SS[s]}</option>)}</select></div>}</div>;}

function ProductionPage({jobs,setJobs,onRefresh,onNav}){
  const[quickViewJob,setQuickViewJob]=useState(null);
  // Actuals + plan membership for kanban cards
  const[prodActuals,setProdActuals]=useState([]);
  const[prodPlanLines,setProdPlanLines]=useState([]);
  const todayIsoProd=new Date().toISOString().split('T')[0];
  useEffect(()=>{sbGet('production_actuals','select=job_id,actual_pieces,production_date&limit=1000').then(d=>setProdActuals(Array.isArray(d)?d:[])).catch(e=>console.error('Fetch actuals failed:',e));},[]);
  useEffect(()=>{sbGet('production_plan_lines','select=job_id,plan_id,planned_pieces&limit=500').then(d=>setProdPlanLines(d||[])).catch(()=>{});},[]);
  const plannedByJob=useMemo(()=>{const m={};prodPlanLines.forEach(l=>{if(!m[l.job_id])m[l.job_id]=0;m[l.job_id]=Math.max(m[l.job_id],n(l.planned_pieces));});return m;},[prodPlanLines]);
  const actualsByJob=useMemo(()=>{const m={};prodActuals.forEach(a=>{if(!m[a.job_id])m[a.job_id]={actual:0,planned:0,loggedToday:false};m[a.job_id].actual+=n(a.actual_pieces);if(a.production_date===todayIsoProd)m[a.job_id].loggedToday=true;});Object.entries(m).forEach(([jobId,x])=>{x.planned=plannedByJob[jobId]||0;x.pct=x.planned>0?Math.round(x.actual/x.planned*100):0;});return m;},[prodActuals,plannedByJob,todayIsoProd]);
  const planJobIds=useMemo(()=>new Set(prodPlanLines.map(l=>l.job_id)),[prodPlanLines]);
  // Bill sheet submissions for current month
  const prodBillingMonth=curBillingMonth();
  const[prodBillSubs,setProdBillSubs]=useState([]);
  const[prodBillModal,setProdBillModal]=useState(null);
  const fetchProdBillSubs=useCallback(async()=>{const d=await sbGet('pm_bill_submissions',`billing_month=eq.${prodBillingMonth}&order=created_at.desc`);setProdBillSubs(d||[]);},[prodBillingMonth]);
  useEffect(()=>{fetchProdBillSubs();},[fetchProdBillSubs]);
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
  const pipeLF=filtered.filter(j=>['production_queue','in_production','inventory_ready','active_install','fence_complete'].includes(j.status)).reduce((s,j)=>s+n(j.total_lf),0);
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
    <div style={{...card,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}><span style={{fontFamily:'Inter',fontWeight:700,fontSize:16,color:pipeLF>200000?'#991B1B':pipeLF>100000?'#B45309':'#065F46'}}>{pipeLF.toLocaleString()} LF</span><span style={{fontSize:12,color:'#6B6056'}}>in pipeline</span><div style={{flex:1}}><PBar pct={Math.min(pipeLF/200000*100,100)} color={pipeLF>200000?'#991B1B':pipeLF>100000?'#B45309':'#065F46'} h={8}/></div></div>
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><span style={{fontSize:11,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>Group By:</span>{[{key:'status',label:'Status'},{key:'customer_name',label:'Customer'},{key:'style',label:'Style'},{key:'color',label:'Color'}].map(g=><button key={g.key} onClick={()=>setGroupBy(g.key)} style={gpill(groupBy===g.key)}>{g.label}</button>)}</div>
    <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputS,width:180,padding:'6px 10px',fontSize:12}}/><button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}{!isS&&<><span style={{color:'#E5E3E0'}}>|</span><button onClick={()=>setStatusF(null)} style={fpill(!statusF)}>All</button>{KANBAN_STS.map(s=><button key={s} onClick={()=>setStatusF(s)} style={fpill(statusF===s)}>{SS[s]}</button>)}</>}</div>
    <div style={{display:'flex',gap:6,marginBottom:14,alignItems:'center'}}><span style={{fontSize:11,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>Add-ons:</span><button onClick={()=>setAddonsF(new Set())} style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',border:addonsF.size===0?'1px solid #8B2020':'1px solid #E5E3E0',background:addonsF.size===0?'#FDF4F4':'#FFF',color:addonsF.size===0?'#8B2020':'#9E9B96'}}>All</button>{[{code:'G',label:'Gates',color:'#B45309',bg:'#FEF3C7'},{code:'WI',label:'WI',color:'#374151',bg:'#F3F4F6'},{code:'C',label:'Columns',color:'#6D28D9',bg:'#EDE9FE'}].map(a=><button key={a.code} onClick={()=>toggleAddon(a.code)} style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',border:addonsF.has(a.code)?`2px solid ${a.color}`:'1px solid #E5E3E0',background:addonsF.has(a.code)?a.bg:'#FFF',color:addonsF.has(a.code)?a.color:'#9E9B96'}}>{a.label}</button>)}{addonsF.size>0&&<span style={{fontSize:11,color:'#6B6056',marginLeft:4}}>{filtered.length} jobs</span>}</div>
    <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(colArr.length,7)},1fr)`,gap:12,alignItems:'flex-start'}}>{colArr.map(col=>{const cv=col.jobs.reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);const lf=col.jobs.reduce((x,j)=>x+n(j.total_lf),0);return<div key={col.key}><div style={{background:col.bg||'#FDF4F4',border:`1px solid ${col.color}30`,borderRadius:12,padding:'12px 14px',marginBottom:8}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:col.color,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{col.label}</div><div style={{fontSize:11,color:'#6B6056',marginTop:2}}><span style={{background:'#E5E3E0',padding:'1px 6px',borderRadius:4,fontWeight:700,marginRight:6}}>{col.jobs.length}</span>{lf.toLocaleString()} LF · {$k(cv)}</div></div><div style={{maxHeight:'calc(100vh-300px)',overflow:'auto'}}>{col.jobs.map(j=><ProdCard key={j.id} j={j} move={move} locked={!editUnlocked} billSub={prodSubByJob[j.id]} onViewBill={s=>setProdBillModal(s)} onQuickView={setQuickViewJob} onPrintOrder={onNav?()=>onNav('production_orders'):null} onCalcMaterials={onNav?()=>{try{localStorage.setItem('fc_matcalc_prejob',j.id);}catch(e){}onNav('material_calc');}:null} onAddToPlan={onNav?()=>{try{localStorage.setItem('fc_plan_addjob',j.id);}catch(e){}onNav('daily_report');}:null} inPlanDate={planJobIds.has(j.id)?'active plan':null} progressInfo={actualsByJob[j.id]}/>)}</div></div>;})}</div>
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
function ReportsPage({jobs}){
  const[activeRpt,setActiveRpt]=useState(null);const active=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)),[jobs]);
  const reports=[{id:'ltb_rep',title:'Left to Bill by Sales Rep',desc:'Balance per rep'},{id:'aging',title:'Billing Aging',desc:'Unbilled projects by age'},{id:'lf_week',title:'LF by Week',desc:'LF scheduled by week'},{id:'pipeline',title:'Pipeline by Market',desc:'Values by status & market'},{id:'revenue',title:'Revenue vs Pipeline',desc:'Billed vs remaining'},{id:'prod_sched',title:'Production Schedule',desc:'Queued & in-production'},{id:'change_orders',title:'Change Orders Summary',desc:'All change order activity'},{id:'rep_matrix',title:'Rep × Market Matrix',desc:'Cross-tab by rep and market'},{id:'sales_product',title:'Sales by Product',desc:'Revenue and LF breakdown by product type — Precast, Masonry/SW, Wrought Iron, Gates'},{id:'outstanding',title:'Outstanding Collections',desc:'Complete jobs not yet collected'}];
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
    return null;
  };
  return(<div><h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Reports</h1><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>{reports.map(r=><div key={r.id} style={{...card,display:'flex',flexDirection:'column',justifyContent:'space-between'}}><div><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14,marginBottom:4}}>{r.title}</div><div style={{fontSize:12,color:'#6B6056',marginBottom:12}}>{r.desc}</div></div><button onClick={()=>setActiveRpt(activeRpt===r.id?null:r.id)} style={activeRpt===r.id?btnP:btnS}>{activeRpt===r.id?'Close':'Run'}</button></div>)}</div>{activeRpt&&<div style={card}>{renderReport()}</div>}</div>);
}

/* ═══ MATERIAL CALCULATOR PAGE ═══ */
function MaterialCalcPage({jobs,preJob}){
  const[styles,setStyles]=useState([]);
  const[selJob,setSelJob]=useState(preJob||null);
  const[jobSearch,setJobSearch]=useState(preJob?preJob.job_name:'');
  const[selStyle,setSelStyle]=useState('');
  const[height,setHeight]=useState('');
  const[lf,setLf]=useState('');
  const[result,setResult]=useState(null);
  const[overrides,setOverrides]=useState({});
  const[toast,setToast]=useState(null);
  const[showPrint,setShowPrint]=useState(false);

  useEffect(()=>{sbGet('material_calc_styles','is_active=eq.true&order=style_name').then(d=>setStyles(d||[]));},[]);
  useEffect(()=>{if(preJob){setSelJob(preJob);setJobSearch(preJob.job_name);setSelStyle(preJob.style||'');setHeight(preJob.height_precast||'');setLf(preJob.lf_precast||preJob.total_lf||'');}else{try{const preId=localStorage.getItem('fc_matcalc_prejob');if(preId){const j=jobs.find(x=>x.id===preId);if(j){setSelJob(j);setJobSearch(j.job_name);setSelStyle(j.style||'');setHeight(j.height_precast||'');setLf(j.lf_precast||j.total_lf||'');}localStorage.removeItem('fc_matcalc_prejob');}}catch(e){}}},[preJob,jobs]);
  const[autoCalcPending,setAutoCalcPending]=useState(false);
  useEffect(()=>{if(selJob&&selStyle&&n(height)>0&&n(lf)>0&&!result&&styles.length>0){setAutoCalcPending(true);}},[selJob,selStyle,height,lf,styles.length,result]);

  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)).sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||'')),[jobs]);
  const searchResults=jobSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,8):[];

  const pickJob=j=>{setSelJob(j);setJobSearch(j.job_name);setSelStyle(j.style||'');setHeight(j.height_precast||'');setLf(j.lf_precast||j.total_lf||'');};

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
  useEffect(()=>{if(autoCalcPending&&styles.length>0&&selStyle&&n(height)>0&&n(lf)>0){setAutoCalcPending(false);calculate();}},[autoCalcPending,styles,selStyle,height,lf]);

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
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 120px 120px auto',gap:12,alignItems:'end'}}>
        <div style={{position:'relative'}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Job (optional)</label>
          <input value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setSelJob(null);}} placeholder="Search by name or number..." style={inputS}/>
          {searchResults.length>0&&!selJob&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',zIndex:10,maxHeight:240,overflow:'auto'}}>
            {searchResults.map(j=><button key={j.id} onClick={()=>pickJob(j)} style={{display:'block',width:'100%',padding:'8px 12px',border:'none',background:'transparent',textAlign:'left',cursor:'pointer',fontSize:12,borderBottom:'1px solid #F4F4F2'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF4F4'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><span style={{fontWeight:600}}>{j.job_name}</span> <span style={{color:'#9E9B96'}}>#{j.job_number}</span></button>)}
          </div>}
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Style</label>
          <select value={selStyle} onChange={e=>setSelStyle(e.target.value)} style={inputS}><option value="">— Select Style —</option>{styles.map(s=><option key={s.id} value={s.style_name}>{s.style_name}</option>)}</select>
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Height (ft)</label>
          <div style={{display:'flex',gap:4}}>
            {[6,8,10,12].map(h2=><button key={h2} onClick={()=>setHeight(h2)} style={{padding:'6px 10px',borderRadius:6,border:n(height)===h2?'2px solid #8B2020':'1px solid #D1CEC9',background:n(height)===h2?'#FDF4F4':'#FFF',color:n(height)===h2?'#8B2020':'#6B6056',fontSize:13,fontWeight:700,cursor:'pointer'}}>{h2}</button>)}
          </div>
        </div>
        <div>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Linear Feet</label>
          <input type="number" value={lf} onChange={e=>setLf(e.target.value)} placeholder="0" style={inputS}/>
        </div>
        <div>
          <button onClick={calculate} disabled={!selStyle||!n(height)||!n(lf)} style={{...btnP,padding:'10px 24px',fontSize:14,opacity:!selStyle||!n(height)||!n(lf)?0.4:1}}>Calculate</button>
        </div>
      </div>
      {selJob&&<div style={{marginTop:8,fontSize:12,color:'#065F46',fontWeight:600}}>Loaded from: {selJob.job_name} (#{selJob.job_number})</div>}
    </div>

    {/* Results */}
    {result&&<div>
      {/* Summary bar */}
      <div style={{...card,padding:'12px 20px',marginBottom:16,display:'flex',gap:20,alignItems:'center',flexWrap:'wrap',background:'#1A1A1A',color:'#FFF',border:'none'}}>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Style</span><div style={{fontWeight:700,fontSize:14}}>{selStyle}</div></div>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Height</span><div style={{fontWeight:700,fontSize:14}}>{height}ft</div></div>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Linear Feet</span><div style={{fontWeight:700,fontSize:14}}>{n(lf).toLocaleString()}</div></div>
        <div><span style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase'}}>Sections</span><div style={{fontWeight:700,fontSize:14}}>{result.sections}</div></div>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          {selJob&&<button onClick={async()=>{try{const shouldAdvance=selJob.status==='contract_review';const matBody={material_posts_line:ov('linePosts',result.linePosts),material_posts_corner:ov('cornerPosts',result.cornerPosts),material_posts_stop:ov('stopPosts',result.stopPosts),material_panels_regular:ov('regularPanels',result.regularPanels),material_panels_half:ov('halfPanels',result.halfPanels)||0,material_rails_regular:ov('capRails',result.capRails),material_rails_top:ov('topRails',result.topRails),material_rails_bottom:ov('bottomRails',result.bottomRails),material_rails_center:ov('middleRails',result.middleRails),material_caps_line:ov('lineCaps',result.lineCaps),material_caps_stop:ov('stopCaps',result.stopCaps),material_post_height:result.postHeight,material_calc_date:new Date().toISOString(),...(shouldAdvance&&{status:'production_queue'})};await sbPatch('jobs',selJob.id,matBody);setToast(shouldAdvance?'Materials saved + job moved to Production Queue':'Materials saved to '+selJob.job_name);fetch(`${SB}/functions/v1/production-order-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{...selJob,...matBody}})}).catch(e=>console.error('Production order notification failed:',e));if(shouldAdvance){fetch(`${SB}/functions/v1/job-stage-notification`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:{job_name:selJob.job_name,job_number:selJob.job_number,market:selJob.market,pm:selJob.pm,sales_rep:selJob.sales_rep,style:selJob.style,color:selJob.color,height_precast:selJob.height_precast,total_lf:selJob.total_lf,adj_contract_value:selJob.adj_contract_value},from_status:'contract_review',to_status:'production_queue'})}).catch(e=>console.error('Stage notification failed:',e));}}catch(e){setToast('Save failed');}}} style={{...btnP,background:'#065F46',padding:'6px 16px',fontSize:12}}>Save to Job</button>}
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
    {showPrint&&result&&(()=>{const ph=result.postHeight;const phCol=ph<=8?'8':ph<=10?'10':'12';const d=(v)=>v>0?v:'—';const lp=ov('linePosts',result.linePosts);const cp=ov('cornerPosts',result.cornerPosts);const sp=ov('stopPosts',result.stopPosts);const rp=ov('regularPanels',result.regularPanels);const hp=ov('halfPanels',result.halfPanels)||0;const cr=ov('capRails',result.capRails);const tr2=ov('topRails',result.topRails);const br=ov('bottomRails',result.bottomRails);const mr=ov('middleRails',result.middleRails);const lc=ov('lineCaps',result.lineCaps);const sc2=ov('stopCaps',result.stopCaps);const jobColor=selJob?.color||'';const mktShort=selJob?MS[selJob.market]||selJob.market||'':'';
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

  const ordersJobs=useMemo(()=>jobs.filter(j=>j.material_calc_date&&j.status!=='closed').sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999')),[jobs]);

  const needsProd=ordersJobs.filter(j=>['contract_review','production_queue'].includes(j.status));
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
              {n(j.total_lf)>0&&<span>{n(j.total_lf).toLocaleString()} LF</span>}
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

/* ═══ DAILY REPORT PAGE ═══ */
function DailyReportPage({jobs}){
  const[tab,setTab]=useState('plan');
  const[toast,setToast]=useState(null);
  // Tomorrow + today date helpers
  const tomorrowISO=(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().split('T')[0];})();
  const todayISO=new Date().toISOString().split('T')[0];

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

  // ─── HISTORY TAB STATE ───
  const[histRange,setHistRange]=useState('week');
  const[histShift,setHistShift]=useState('');
  const[histPlans,setHistPlans]=useState([]);const[histPlanLines,setHistPlanLines]=useState([]);
  const[histActuals,setHistActuals]=useState([]);
  const[histLoading,setHistLoading]=useState(false);
  const[expandedDate,setExpandedDate]=useState(null);

  const activeJobs=useMemo(()=>jobs.filter(j=>!CLOSED_SET.has(j.status)).sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||'')),[jobs]);
  const prodOrderJobs=useMemo(()=>jobs.filter(j=>j.material_calc_date&&['contract_review','production_queue','in_production','inventory_ready'].includes(j.status)).sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999')),[jobs]);
  const jobSearchResults=jobSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,8):[];
  const unplanSearchResults=unplanSearch.length>=2?activeJobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(unplanSearch.toLowerCase())).slice(0,8):[];

  // ─── LOAD PLAN FOR SELECTED DATE ───
  const loadPlan=useCallback(async(date)=>{
    try{
      const plans=await sbGet('production_plans',`plan_date=eq.${date}&select=*&limit=1`);
      if(plans&&plans[0]){
        setPlanId(plans[0].id);
        setPlanNotes(plans[0].plan_notes||'');
        const lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&order=sort_order.asc`);
        setPlanLines((lines||[]).map(l=>({id:l.id,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||'',color:l.color||'',height:l.height||'',planned_pieces:l.planned_pieces||'',planned_lf:l.planned_lf||'',notes:l.notes||''})));
      }else{
        setPlanId(null);setPlanLines([]);setPlanNotes('');
      }
    }catch(e){console.error('Load plan failed:',e);setPlanId(null);setPlanLines([]);setPlanNotes('');}
  },[]);
  useEffect(()=>{if(tab==='plan')loadPlan(planDate);},[tab,planDate,loadPlan]);

  // ─── LOAD PLAN FOR ACTUALS TAB ───
  const loadActualsPlan=useCallback(async(date)=>{
    try{
      const plans=await sbGet('production_plans',`plan_date=eq.${date}&select=*&limit=1`);
      if(plans&&plans[0]){
        setActualsPlanId(plans[0].id);
        const lines=await sbGet('production_plan_lines',`plan_id=eq.${plans[0].id}&order=sort_order.asc`);
        setActualsLines((lines||[]).map(l=>({plan_line_id:l.id,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||'',color:l.color||'',height:l.height||'',planned_pieces:l.planned_pieces||0,planned_lf:l.planned_lf||0,actual_pieces:'',actual_lf:'',notes:'',unplanned:false})));
      }else{
        setActualsPlanId(null);setActualsLines([]);
      }
    }catch(e){console.error('Load actuals plan failed:',e);}
  },[]);
  useEffect(()=>{if(tab==='actuals')loadActualsPlan(actualsDate);},[tab,actualsDate,loadActualsPlan]);

  // ─── PLAN BUILDER HELPERS ───
  const addJobToPlan=(j)=>{
    // If job already has material calcs, use totalPieces / total_lf
    const totalPcs=(n(j.material_posts_line)+n(j.material_posts_corner)+n(j.material_posts_stop))||n(j.material_panels_regular);
    setPlanLines(prev=>prev.some(l=>l.job_id===j.id)?prev:[...prev,{job_id:j.id,job_number:j.job_number,job_name:j.job_name,style:j.style||'',color:j.color||'',height:j.height_precast||'',planned_pieces:totalPcs?String(totalPcs):'',planned_lf:n(j.total_lf)?String(n(j.total_lf)):'',notes:''}]);
    setShowAddPicker(false);setJobSearch('');
  };
  // Pick up job from kanban handoff via localStorage
  useEffect(()=>{if(tab==='plan'&&jobs.length>0){try{const preId=localStorage.getItem('fc_plan_addjob');if(preId){const j=jobs.find(x=>x.id===preId);if(j)addJobToPlan(j);localStorage.removeItem('fc_plan_addjob');}}catch(e){}}},[tab,jobs]);
  const updatePlanLine=(idx,field,val)=>setPlanLines(prev=>prev.map((l,i)=>i===idx?{...l,[field]:val}:l));
  const removePlanLine=(idx)=>setPlanLines(prev=>prev.filter((_,i)=>i!==idx));
  const movePlanLine=(idx,dir)=>setPlanLines(prev=>{const n2=[...prev];const target=idx+dir;if(target<0||target>=n2.length)return n2;[n2[idx],n2[target]]=[n2[target],n2[idx]];return n2;});

  const planTotals=useMemo(()=>{let pcs=0,lf=0;planLines.forEach(l=>{pcs+=n(l.planned_pieces);lf+=n(l.planned_lf);});return{pcs,lf,count:planLines.length};},[planLines]);

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
        const lineRows=planLines.map((l,i)=>({plan_id:curId,sort_order:i,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||null,color:l.color||null,height:l.height||null,planned_pieces:n(l.planned_pieces)||0,planned_lf:n(l.planned_lf)||0,notes:l.notes||null}));
        const res2=await fetch(`${SB}/rest/v1/production_plan_lines`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(lineRows)});
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
  const removeActualsLine=(idx)=>setActualsLines(prev=>prev.filter((_,i)=>i!==idx));
  const addUnplannedLine=(j)=>{
    setActualsLines(prev=>[...prev,{plan_line_id:null,job_id:j.id,job_number:j.job_number,job_name:j.job_name,style:j.style||'',color:j.color||'',height:j.height_precast||'',planned_pieces:0,planned_lf:0,actual_pieces:'',actual_lf:'',notes:'',unplanned:true}]);
    setShowUnplanPicker(false);setUnplanSearch('');
  };

  const actualsTotals=useMemo(()=>{let pcs=0,lf=0,plannedPcs=0,plannedLf=0;actualsLines.forEach(l=>{pcs+=n(l.actual_pieces);lf+=n(l.actual_lf);plannedPcs+=n(l.planned_pieces);plannedLf+=n(l.planned_lf);});return{pcs,lf,plannedPcs,plannedLf,count:actualsLines.length};},[actualsLines]);

  const submitActuals=async()=>{
    const toSubmit=actualsLines.filter(l=>n(l.actual_pieces)>0||n(l.actual_lf)>0||l.notes);
    if(toSubmit.length===0){setToast({msg:'No actuals to submit — fill in at least one line',ok:false});return;}
    setSubmittingActuals(true);
    try{
      const rows=toSubmit.map(l=>({production_date:actualsDate,shift:shift,logged_by:loggedBy||'Luis Rodriguez',crew_size:n(crewSize)||null,plan_id:actualsPlanId,plan_line_id:l.plan_line_id,job_id:l.job_id,job_number:l.job_number,job_name:l.job_name,style:l.style||null,color:l.color||null,height:l.height||null,actual_pieces:n(l.actual_pieces)||0,actual_lf:n(l.actual_lf)||0,notes:l.notes||null,unplanned:!!l.unplanned,shift_notes:actualsNotes||null,submitted_at:new Date().toISOString()}));
      const res=await fetch(`${SB}/rest/v1/production_actuals`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify(rows)});
      if(!res.ok)throw new Error(await res.text());
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
      // Clear for next shift
      setActualsLines(prev=>prev.map(l=>({...l,actual_pieces:'',actual_lf:'',notes:''})));
      setActualsNotes('');
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
      {[['plan','📋 Production Plan','#7C3AED'],['actuals','✅ Log Actuals','#8B2020'],['history','📊 History','#0F766E']].map(([k,l,c])=><button key={k} onClick={()=>setTab(k)} style={{padding:'10px 20px',border:'none',background:'transparent',color:tab===k?c:'#6B6056',fontWeight:tab===k?700:400,fontSize:14,cursor:'pointer',borderBottom:tab===k?`3px solid ${c}`:'3px solid transparent',marginBottom:-2}}>{l}</button>)}
    </div>

    {/* ═══ TAB 1: PRODUCTION PLAN ═══ */}
    {tab==='plan'&&<div>
      {/* Smart Production Queue panel */}
      {(()=>{const queueJobs=jobs.filter(j=>j.status==='production_queue'&&j.material_calc_date&&!planLines.some(l=>l.job_id===j.id)).sort((a,b)=>(a.est_start_date||'9999').localeCompare(b.est_start_date||'9999')).slice(0,20);if(queueJobs.length===0)return null;return<div style={{...card,marginBottom:12,borderLeft:'4px solid #7C3AED'}}>
        <div style={{fontSize:12,fontWeight:800,color:'#7C3AED',textTransform:'uppercase',marginBottom:8}}>Production Queue ({queueJobs.length} jobs with orders)</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8,maxHeight:260,overflow:'auto'}}>
          {queueJobs.map(j=>{const pcs=(n(j.material_posts_line)+n(j.material_posts_corner)+n(j.material_posts_stop))||n(j.material_panels_regular);return<div key={j.id} style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:8,padding:10}}>
            <div style={{fontSize:12,fontWeight:700}}>{j.job_name}</div>
            <div style={{fontSize:10,color:'#9E9B96',marginBottom:4}}>#{j.job_number}</div>
            <div style={{fontSize:10,color:'#6B6056',marginBottom:4}}>{[j.style,j.color,j.height_precast?j.height_precast+'ft':null].filter(Boolean).join(' | ')}</div>
            <div style={{fontSize:10,color:'#6B6056',marginBottom:6}}>{pcs>0&&<span><b style={{color:'#1A1A1A'}}>{pcs}</b> pcs</span>} {n(j.total_lf)>0&&<span style={{marginLeft:8}}><b style={{color:'#1A1A1A'}}>{n(j.total_lf).toLocaleString()}</b> LF</span>}</div>
            {j.est_start_date&&<div style={{fontSize:10,color:'#9E9B96',marginBottom:6}}>Est start: {fD(j.est_start_date)}</div>}
            <button onClick={()=>addJobToPlan(j)} style={{width:'100%',padding:'5px 10px',background:'#7C3AED',border:'none',borderRadius:6,color:'#FFF',fontSize:11,fontWeight:700,cursor:'pointer'}}>+ Add to Plan</button>
          </div>;})}
        </div>
      </div>;})()}
      <div style={{...card,marginBottom:16,borderTop:'3px solid #7C3AED'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10,flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#7C3AED'}}>Production Plan</div>
            <div style={{fontSize:11,color:'#9E9B96'}}>Created by Max {planId?'— editing existing plan':'— new plan'}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <label style={{fontSize:11,color:'#6B6056',fontWeight:600,textTransform:'uppercase'}}>Plan Date</label>
            <input type="date" value={planDate} onChange={e=>setPlanDate(e.target.value)} style={{...inputS,width:170}}/>
          </div>
        </div>
        {/* Add buttons */}
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <button onClick={()=>setShowAddPicker('orders')} style={{...btnP,background:'#7C3AED',padding:'8px 16px',fontSize:12}}>＋ Add from Production Orders</button>
          <button onClick={()=>setShowAddPicker('manual')} style={{...btnS,padding:'8px 16px',fontSize:12}}>＋ Add Job Manually</button>
        </div>
        {/* Picker */}
        {showAddPicker==='orders'&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:12,maxHeight:300,overflow:'auto'}}>
          <div style={{fontSize:11,fontWeight:700,color:'#6B6056',marginBottom:6}}>Jobs with saved production orders:</div>
          {prodOrderJobs.length===0?<div style={{color:'#9E9B96',fontSize:12}}>No jobs with production orders found</div>:prodOrderJobs.map(j=><button key={j.id} onClick={()=>addJobToPlan(j)} style={{display:'block',width:'100%',padding:'6px 10px',marginBottom:4,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,textAlign:'left',cursor:'pointer',fontSize:12}}><b>{j.job_name}</b> <span style={{color:'#9E9B96'}}>#{j.job_number}</span> — {j.style||'—'} / {j.color||'—'} / {j.height_precast||'?'}ft</button>)}
          <button onClick={()=>setShowAddPicker(false)} style={{...btnS,padding:'4px 10px',fontSize:11,marginTop:4}}>Cancel</button>
        </div>}
        {showAddPicker==='manual'&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:12}}>
          <input autoFocus value={jobSearch} onChange={e=>setJobSearch(e.target.value)} placeholder="Search by name or number..." style={inputS}/>
          {jobSearchResults.length>0&&<div style={{marginTop:6,maxHeight:240,overflow:'auto'}}>{jobSearchResults.map(j=><button key={j.id} onClick={()=>addJobToPlan(j)} style={{display:'block',width:'100%',padding:'6px 10px',marginBottom:3,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,textAlign:'left',cursor:'pointer',fontSize:12}}><b>{j.job_name}</b> <span style={{color:'#9E9B96'}}>#{j.job_number}</span></button>)}</div>}
          <button onClick={()=>{setShowAddPicker(false);setJobSearch('');}} style={{...btnS,padding:'4px 10px',fontSize:11,marginTop:6}}>Cancel</button>
        </div>}
        {/* Plan lines */}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {planLines.map((l,idx)=><div key={idx} style={{border:'1px solid #E5E3E0',borderLeft:'4px solid #7C3AED',borderRadius:8,padding:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <div style={{display:'flex',flexDirection:'column',gap:2}}>
                <button onClick={()=>movePlanLine(idx,-1)} disabled={idx===0} style={{background:'none',border:'none',fontSize:10,cursor:idx===0?'not-allowed':'pointer',color:'#9E9B96',padding:0,lineHeight:1}}>▲</button>
                <button onClick={()=>movePlanLine(idx,1)} disabled={idx===planLines.length-1} style={{background:'none',border:'none',fontSize:10,cursor:idx===planLines.length-1?'not-allowed':'pointer',color:'#9E9B96',padding:0,lineHeight:1}}>▼</button>
              </div>
              <div style={{flex:1}}><b style={{fontSize:14}}>{l.job_name}</b> <span style={{color:'#9E9B96',fontSize:11}}>#{l.job_number}</span></div>
              <button onClick={()=>removePlanLine(idx)} style={{background:'none',border:'none',color:'#9E9B96',fontSize:16,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 80px',gap:8,marginBottom:8}}>
              <div><label style={{display:'block',fontSize:9,color:'#6B6056',marginBottom:2}}>Style</label><input value={l.style} onChange={e=>updatePlanLine(idx,'style',e.target.value)} style={{...inputS,padding:'5px 8px',fontSize:12}}/></div>
              <div><label style={{display:'block',fontSize:9,color:'#6B6056',marginBottom:2}}>Color</label><input value={l.color} onChange={e=>updatePlanLine(idx,'color',e.target.value)} style={{...inputS,padding:'5px 8px',fontSize:12}}/></div>
              <div><label style={{display:'block',fontSize:9,color:'#6B6056',marginBottom:2}}>Height</label><input value={l.height} onChange={e=>updatePlanLine(idx,'height',e.target.value)} placeholder="8'" style={{...inputS,padding:'5px 8px',fontSize:12}}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
              <div><label style={{display:'block',fontSize:9,color:'#6B6056',marginBottom:2}}>Planned Pieces</label><input type="number" value={l.planned_pieces} onChange={e=>updatePlanLine(idx,'planned_pieces',e.target.value)} placeholder="0" style={{...inputS,padding:'5px 8px',fontSize:14,fontWeight:700}}/></div>
              <div><label style={{display:'block',fontSize:9,color:'#6B6056',marginBottom:2}}>Planned LF</label><input type="number" value={l.planned_lf} onChange={e=>updatePlanLine(idx,'planned_lf',e.target.value)} placeholder="0" style={{...inputS,padding:'5px 8px',fontSize:14,fontWeight:700}}/></div>
            </div>
            <div><label style={{display:'block',fontSize:9,color:'#6B6056',marginBottom:2}}>Notes</label><input value={l.notes} onChange={e=>updatePlanLine(idx,'notes',e.target.value)} style={{...inputS,padding:'5px 8px',fontSize:12}}/></div>
          </div>)}
          {planLines.length===0&&<div style={{textAlign:'center',padding:24,color:'#9E9B96',fontSize:12}}>No jobs planned yet. Add jobs above to build the plan.</div>}
        </div>
        {/* Summary */}
        {planLines.length>0&&<div style={{marginTop:12,padding:10,background:'#F5F3FF',borderRadius:8,display:'flex',gap:20,fontSize:12,fontWeight:600,color:'#7C3AED',flexWrap:'wrap'}}>
          <span>Total jobs: <b>{planTotals.count}</b></span>
          <span>Total planned pieces: <b>{planTotals.pcs.toLocaleString()}</b></span>
          <span>Total planned LF: <b>{planTotals.lf.toLocaleString()}</b></span>
        </div>}
        {/* Plan notes */}
        <div style={{marginTop:12}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Plan Notes</label>
          <textarea value={planNotes} onChange={e=>setPlanNotes(e.target.value)} rows={2} placeholder="General notes for the day..." style={{...inputS,resize:'vertical'}}/>
        </div>
        <button onClick={savePlan} disabled={savingPlan||planLines.length===0} style={{...btnP,background:'#7C3AED',width:'100%',padding:'12px 0',marginTop:12,fontSize:14,opacity:savingPlan||planLines.length===0?0.5:1}}>{savingPlan?'Saving...':planId?'Update Plan':'Save Plan'}</button>
      </div>
    </div>}

    {/* ═══ TAB 2: LOG ACTUALS ═══ */}
    {tab==='actuals'&&<div>
      <div style={{...card,marginBottom:16,borderTop:'3px solid #8B2020'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10,flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#8B2020'}}>Log Production Actuals</div>
            <div style={{fontSize:11,color:'#9E9B96'}}>{actualsPlanId?'Plan loaded — fill in what was actually produced':'No plan for this date — add lines manually below'}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <input type="date" value={actualsDate} onChange={e=>setActualsDate(e.target.value)} style={{...inputS,width:170}}/>
            <div style={{display:'flex',gap:4}}>
              {[1,2].map(s=><button key={s} onClick={()=>setShift(s)} style={{padding:'8px 16px',borderRadius:6,border:shift===s?'2px solid #8B2020':'1px solid #E5E3E0',background:shift===s?'#FDF4F4':'#FFF',color:shift===s?'#8B2020':'#6B6056',fontSize:12,fontWeight:700,cursor:'pointer'}}>Shift {s}</button>)}
            </div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10,marginBottom:12}}>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Logged By</label><input value={loggedBy} onChange={e=>setLoggedBy(e.target.value)} style={inputS}/></div>
          <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Crew Size</label><input type="number" value={crewSize} onChange={e=>setCrewSize(e.target.value)} placeholder="0" style={inputS}/></div>
        </div>
        {/* Actuals table */}
        <div style={{overflow:'auto',marginBottom:12}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr style={{background:'#F9F8F6'}}>{['Job','Style','Color','Ht','Planned','Actual Pcs','Actual LF','Notes',''].map(h=><th key={h} style={{textAlign:'left',padding:'8px 6px',fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',borderBottom:'1px solid #E5E3E0'}}>{h}</th>)}</tr></thead>
            <tbody>{actualsLines.map((l,idx)=>{const pctVsPlan=n(l.planned_pieces)>0?n(l.actual_pieces)/n(l.planned_pieces):0;const actColor=n(l.actual_pieces)===0?'#9E9B96':pctVsPlan>=1?'#065F46':'#B45309';return<tr key={idx} style={{borderBottom:'1px solid #F4F4F2',borderLeft:l.unplanned?'3px solid #1D4ED8':'3px solid transparent'}}>
              <td style={{padding:'6px',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><div style={{fontWeight:600,fontSize:12}}>{l.job_name}</div><div style={{fontSize:10,color:'#9E9B96'}}>#{l.job_number}{l.unplanned&&' · unplanned'}</div></td>
              <td style={{padding:'6px',fontSize:11,color:'#6B6056'}}>{l.style||'—'}</td>
              <td style={{padding:'6px',fontSize:11,color:'#6B6056'}}>{l.color||'—'}</td>
              <td style={{padding:'6px',fontSize:11,color:'#6B6056'}}>{l.height||'—'}</td>
              <td style={{padding:'6px',fontSize:12,color:'#9E9B96',fontWeight:600}}>{n(l.planned_pieces)||'—'}</td>
              <td style={{padding:'6px'}}><input type="number" autoFocus={idx===0} value={l.actual_pieces} onChange={e=>updateActualsLine(idx,'actual_pieces',e.target.value)} placeholder="0" style={{width:70,padding:'6px 8px',fontSize:14,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:6,color:actColor,textAlign:'center'}}/></td>
              <td style={{padding:'6px'}}><input type="number" value={l.actual_lf} onChange={e=>updateActualsLine(idx,'actual_lf',e.target.value)} placeholder="0" style={{width:70,padding:'6px 8px',fontSize:14,fontWeight:700,border:'1px solid #D1CEC9',borderRadius:6,textAlign:'center'}}/></td>
              <td style={{padding:'6px'}}><input value={l.notes} onChange={e=>updateActualsLine(idx,'notes',e.target.value)} placeholder="—" style={{width:140,padding:'6px 8px',fontSize:11,border:'1px solid #D1CEC9',borderRadius:6}}/></td>
              <td style={{padding:'6px'}}>{l.unplanned&&<button onClick={()=>removeActualsLine(idx)} style={{background:'none',border:'none',color:'#9E9B96',fontSize:14,cursor:'pointer'}}>✕</button>}</td>
            </tr>;})}</tbody>
          </table>
          {actualsLines.length===0&&<div style={{textAlign:'center',padding:24,color:'#9E9B96',fontSize:12}}>No lines yet. Add jobs below.</div>}
        </div>
        <button onClick={()=>setShowUnplanPicker(true)} style={{...btnS,padding:'6px 14px',fontSize:12,marginBottom:12}}>+ Add Unplanned Line</button>
        {showUnplanPicker&&<div style={{background:'#F9F8F6',borderRadius:8,padding:12,marginBottom:12}}>
          <input autoFocus value={unplanSearch} onChange={e=>setUnplanSearch(e.target.value)} placeholder="Search by name or number..." style={inputS}/>
          {unplanSearchResults.length>0&&<div style={{marginTop:6,maxHeight:200,overflow:'auto'}}>{unplanSearchResults.map(j=><button key={j.id} onClick={()=>addUnplannedLine(j)} style={{display:'block',width:'100%',padding:'6px 10px',marginBottom:3,background:'#FFF',border:'1px solid #E5E3E0',borderRadius:6,textAlign:'left',cursor:'pointer',fontSize:12}}><b>{j.job_name}</b> <span style={{color:'#9E9B96'}}>#{j.job_number}</span></button>)}</div>}
          <button onClick={()=>{setShowUnplanPicker(false);setUnplanSearch('');}} style={{...btnS,padding:'4px 10px',fontSize:11,marginTop:6}}>Cancel</button>
        </div>}
        {/* Totals */}
        {actualsLines.length>0&&<div style={{padding:10,background:'#FDF4F4',borderRadius:8,display:'flex',gap:20,fontSize:12,fontWeight:600,color:'#8B2020',flexWrap:'wrap',marginBottom:12}}>
          <span>Actual pieces: <b>{actualsTotals.pcs.toLocaleString()}</b> / {actualsTotals.plannedPcs.toLocaleString()} planned</span>
          <span>Actual LF: <b>{actualsTotals.lf.toLocaleString()}</b> / {actualsTotals.plannedLf.toLocaleString()} planned</span>
          {actualsTotals.plannedPcs>0&&<span>{Math.round(actualsTotals.pcs/actualsTotals.plannedPcs*100)}% of plan</span>}
        </div>}
        <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Shift Notes</label><textarea value={actualsNotes} onChange={e=>setActualsNotes(e.target.value)} rows={2} placeholder="General notes for this shift..." style={{...inputS,resize:'vertical'}}/></div>
        <button onClick={submitActuals} disabled={submittingActuals||actualsLines.length===0} style={{...btnP,width:'100%',padding:'12px 0',marginTop:12,fontSize:14,opacity:submittingActuals||actualsLines.length===0?0.5:1}}>{submittingActuals?'Submitting...':`Submit Shift ${shift} Report`}</button>
      </div>
    </div>}

    {/* ═══ TAB 3: HISTORY ═══ */}
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
  'Job Code':'job_number','Job Name':'job_name','Customer Name':'customer_name','Status':'status','Location':'market','Sales Rep':'sales_rep','Type':'job_type','Address':'address','City':'city','State':'state','Zip':'zip',
  'LF - Precast':'lf_precast','Height - Precast':'height_precast','Style - Clean':'style','Color - Precast':'color','Contract Rate - Precast':'contract_rate_precast',
  'LF - Single Wythe':'lf_single_wythe','Height - Single Wythe':'height_single_wythe','Contract Rate - Single Wythe':'contract_rate_single_wythe',
  'LF - Wrought Iron':'lf_wrought_iron','Number of Gates':'number_of_gates','Gate Height':'gate_height','Gate Description':'gate_description','Gate Rate':'gate_rate',
  'Net Contract Value':'contract_value','Change Orders':'change_orders','Adj Contract Value':'adj_contract_value','Sales Tax':'sales_tax','YTD Amt Invoiced':'ytd_invoiced',
  'Contract Date':'contract_date','Est. Start Date':'est_start_date','Notes':'notes','Documents Needed':'documents_needed','Billing Method':'billing_method','Billing Date':'billing_date'
};
const IMPORT_STATUS_MAP={'Active Project':'active_install','Booked-Not Started':'inventory_ready','Pending':'contract_review','Contract Review':'contract_review','Closed':'closed','Pass':'closed','Cancelled':'closed'};
const IMPORT_MARKET_MAP={'San Antonio':'San Antonio','Houston':'Houston','Austin':'Austin','Dallas':'Dallas-Fort Worth','DFW':'Dallas-Fort Worth','Dallas-Fort Worth':'Dallas-Fort Worth'};
const PROTECTED_FIELDS=new Set(['ytd_invoiced','pct_billed','left_to_bill','status','material_posts_line','material_posts_corner','material_posts_stop','material_panels_regular','material_panels_half','material_rails_regular','material_rails_top','material_rails_bottom','material_rails_center','material_caps_line','material_caps_stop','material_post_height','material_calc_date','inventory_ready_date','active_install_date','fence_complete_date','fully_complete_date','closed_date']);
const IMPORT_NUMERIC_FIELDS=new Set(['lf_precast','height_precast','contract_rate_precast','lf_single_wythe','height_single_wythe','contract_rate_single_wythe','lf_wrought_iron','number_of_gates','gate_height','gate_rate','contract_value','change_orders','adj_contract_value','sales_tax','ytd_invoiced']);
const IMPORT_DATE_FIELDS=new Set(['contract_date','est_start_date','billing_date']);

function ImportProjectsPage({jobs,onRefresh,onNav}){
  const[step,setStep]=useState(1);
  const[fileName,setFileName]=useState('');
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

  const parseFile=(file)=>{
    setError('');
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const data=new Uint8Array(e.target.result);
        const wb=XLSX.read(data,{type:'array',cellDates:true});
        const sheetName=wb.SheetNames[0];
        const sheet=wb.Sheets[sheetName];
        // Header row is row 6 (0-indexed 5)
        const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:false});
        if(rows.length<7){setError('File must have at least 7 rows (headers at row 6)');return;}
        const hdrs=rows[5].map(h=>h?String(h).trim():'');
        const dataRows=rows.slice(6).filter(r=>r.some(c=>c!=null&&String(c).trim()!==''));
        const objRows=dataRows.map(r=>{const o={};hdrs.forEach((h,i)=>{if(h)o[h]=r[i];});return o;});
        setHeaders(hdrs.filter(Boolean));
        setRawRows(objRows);
        setFileName(file.name);
        // Auto-map
        const autoMap={};
        hdrs.forEach(h=>{if(h&&IMPORT_COL_MAP[h])autoMap[h]=IMPORT_COL_MAP[h];});
        setMapping(autoMap);
        setStep(2);
      }catch(err){setError('Failed to parse file: '+err.message);}
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFile=(e)=>{const f=e.target.files[0];if(f)parseFile(f);};
  const handleDrop=(e)=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)parseFile(f);};

  const parseNum=(v)=>{if(v==null||v==='')return null;const s=String(v).replace(/[$,\s]/g,'');const n2=parseFloat(s);return isNaN(n2)?null:n2;};
  const parseDate=(v)=>{if(!v)return null;if(v instanceof Date)return v.toISOString().split('T')[0];const s=String(v).trim();if(!s)return null;const d=new Date(s);if(!isNaN(d.getTime()))return d.toISOString().split('T')[0];return null;};

  const buildPreview=()=>{
    const jobsByNumber={};jobs.forEach(j=>{if(j.job_number)jobsByNumber[j.job_number.trim()]=j;});
    const jobsByName={};jobs.forEach(j=>{if(j.job_name)jobsByName[j.job_name.trim().toLowerCase()]=j;});
    const newJobs=[];const updates=[];const warnings=[];
    rawRows.forEach((row,idx)=>{
      const mapped={};
      Object.entries(mapping).forEach(([excelCol,dbCol])=>{
        if(!dbCol)return;
        let v=row[excelCol];
        if(v==null||v==='')return;
        if(dbCol==='status'){v=IMPORT_STATUS_MAP[String(v).trim()]||null;}
        else if(dbCol==='market'){v=IMPORT_MARKET_MAP[String(v).trim()]||String(v).trim();}
        else if(IMPORT_NUMERIC_FIELDS.has(dbCol)){v=parseNum(v);}
        else if(IMPORT_DATE_FIELDS.has(dbCol)){v=parseDate(v);}
        else{v=String(v).trim();}
        if(v!=null&&v!=='')mapped[dbCol]=v;
      });
      const jobNumber=mapped.job_number;
      if(!jobNumber){warnings.push({row:idx+7,issue:'Missing job_number',data:JSON.stringify(row).substring(0,80)});return;}
      if(!mapped.job_name){warnings.push({row:idx+7,issue:'Missing job_name',data:jobNumber});return;}
      const existing=jobsByNumber[jobNumber]||jobsByName[mapped.job_name.toLowerCase()];
      if(existing){
        // Find changed fields (excluding protected)
        const changes=[];
        Object.entries(mapped).forEach(([k,v])=>{
          if(PROTECTED_FIELDS.has(k))return;
          const cur=existing[k];
          if(cur==null&&v==null)return;
          if(String(cur||'')!==String(v||'')){changes.push({field:k,cur,newVal:v});}
        });
        if(changes.length>0)updates.push({rowNum:idx+7,existing,mapped,changes});
      }else{
        newJobs.push({rowNum:idx+7,mapped});
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
    // Insert new jobs (batch of 50)
    for(let i=0;i<preview.newJobs.length;i+=50){
      const batch=preview.newJobs.slice(i,i+50).map(nj=>{const body={...nj.mapped,created_at:new Date().toISOString()};PROTECTED_FIELDS.forEach(f=>{delete body[f];});return body;});
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

  const reset=()=>{setStep(1);setFileName('');setRawRows([]);setHeaders([]);setMapping({});setPreview(null);setSkipUpdates(new Set());setResults(null);setError('');};
  const toggleSkipUpdate=(rowNum)=>setSkipUpdates(prev=>{const s=new Set(prev);if(s.has(rowNum))s.delete(rowNum);else s.add(rowNum);return s;});

  const stepIndicator=<div style={{display:'flex',gap:4,marginBottom:24}}>{[1,2,3,4].map(n=>{const labels={1:'Upload',2:'Mapping',3:'Preview',4:'Results'};return<div key={n} style={{flex:1,padding:'10px 14px',background:step===n?'#8B2020':step>n?'#D1FAE5':'#F4F4F2',color:step===n?'#FFF':step>n?'#065F46':'#9E9B96',borderRadius:8,fontSize:12,fontWeight:700,textAlign:'center'}}>Step {n}: {labels[n]}</div>;})}</div>;

  return(<div>
    {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:8}}>Import Projects</h1>
    <div style={{fontSize:12,color:'#9E9B96',marginBottom:20}}>Safely import the Master Project Tracker from Excel</div>
    {stepIndicator}
    {error&&<div style={{background:'#FEE2E2',border:'1px solid #EF4444',borderRadius:8,padding:12,marginBottom:16,color:'#991B1B',fontSize:13,fontWeight:600}}>{error}</div>}

    {/* STEP 1: UPLOAD */}
    {step===1&&<div style={{...card,padding:40,textAlign:'center'}}>
      <div onDragOver={e=>e.preventDefault()} onDrop={handleDrop} style={{border:'3px dashed #D1CEC9',borderRadius:16,padding:60,cursor:'pointer',transition:'all .2s'}} onClick={()=>fileInputRef.current?.click()} onMouseEnter={e=>{e.currentTarget.style.borderColor='#8B2020';e.currentTarget.style.background='#FDF4F4';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#D1CEC9';e.currentTarget.style.background='transparent';}}>
        <div style={{fontSize:48,marginBottom:12}}>📤</div>
        <div style={{fontSize:16,fontWeight:700,color:'#1A1A1A',marginBottom:4}}>Drop Excel file here or click to upload</div>
        <div style={{fontSize:12,color:'#9E9B96'}}>.xlsx — reads the "Active Jobs" sheet, headers at row 6</div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{display:'none'}}/>
      </div>
      {fileName&&<div style={{marginTop:16,fontSize:13,color:'#065F46',fontWeight:600}}>✓ {fileName} — {rawRows.length} data rows parsed</div>}
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
        <b>Protected fields (never overwritten):</b> ytd_invoiced, pct_billed, left_to_bill, status, material_calc_*, stage dates. The kanban, AR review, and material calculator own these fields.
      </div>
      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:12,borderBottom:'2px solid #E5E3E0'}}>
        {[['new',`NEW JOBS (${preview.newJobs.length})`,'#065F46'],['updates',`UPDATES (${preview.updates.length})`,'#B45309'],['warnings',`WARNINGS (${preview.warnings.length})`,'#F59E0B']].map(([k,l,c])=><button key={k} onClick={()=>setPreviewTab(k)} style={{padding:'10px 18px',border:'none',background:'transparent',color:previewTab===k?c:'#6B6056',fontWeight:previewTab===k?800:400,fontSize:13,cursor:'pointer',borderBottom:previewTab===k?`3px solid ${c}`:'3px solid transparent',marginBottom:-2}}>{l}</button>)}
      </div>
      {/* Tab content */}
      <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 460px)'}}>
        {previewTab==='new'&&<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Job #','Job Name','Customer','Market','PM','Contract Value','Style'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:700,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
          <tbody>{preview.newJobs.map(nj=><tr key={nj.rowNum} style={{borderBottom:'1px solid #F4F4F2',background:'#F0FDF4'}}>
            <td style={{padding:'8px 10px',fontWeight:600}}>{nj.mapped.job_number||'—'}</td>
            <td style={{padding:'8px 10px'}}>{nj.mapped.job_name||'—'}</td>
            <td style={{padding:'8px 10px',color:'#6B6056'}}>{nj.mapped.customer_name||'—'}</td>
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
            {ci===0&&<td rowSpan={u.changes.length} style={{padding:'8px 10px',verticalAlign:'top',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.existing.job_name}</td>}
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

/* ═══ TOPBAR ═══ */
function Topbar({jobs,live,onSearch}){
  const alerts=jobs.filter(j=>!CLOSED_SET.has(j.status)&&n(j.contract_age)>30&&n(j.ytd_invoiced)===0);
  const[showBell,setShowBell]=useState(false);const[showHelp,setShowHelp]=useState(false);
  const today=new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  return(<div style={{height:48,borderBottom:'1px solid #E5E3E0',background:'#FFF',display:'flex',alignItems:'center',padding:'0 24px',gap:16,flexShrink:0}}>
    <div style={{flex:1}}/>
    <div style={{display:'flex',alignItems:'center',gap:12}}>
      <button onClick={onSearch} style={{background:'#F4F4F2',border:'1px solid #E5E3E0',borderRadius:8,padding:'6px 16px',color:'#9E9B96',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>⌕ Search... <span style={{fontSize:10,color:'#D1CEC9'}}>⌘K</span></button>
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
  {label:'OPERATIONS',items:[{key:'production',label:'Production Plan',icon:'⚙'},{key:'material_calc',label:'Material Calculator',icon:'🧮'},{key:'production_orders',label:'Production Orders',icon:'📦'},{key:'daily_report',label:'Daily Production Report',icon:'🏭'}]},
  {label:'PROJECT MANAGEMENT',items:[{key:'pm_billing',label:'PM Bill Sheet',icon:'📊'},{key:'schedule',label:'Install Schedule',icon:'📅'}]},
  {label:'FINANCE',items:[{key:'billing',label:'Billing',icon:'💰'},{key:'reports',label:'Reports',icon:'📈'},{key:'import_projects',label:'Import Projects',icon:'📤'}]},
  {label:'HELP',items:[{key:'help',label:'Help',icon:'❓'}]},
];

export default function App(){
  const[page,setPage]=useState('dashboard');const[jobs,setJobs]=useState([]);const[loading,setLoading]=useState(true);const[openJob,setOpenJob]=useState(null);const[showSearch,setShowSearch]=useState(false);const[sideCollapsed,setSideCollapsed]=useState(false);
  const fetchJobs=useCallback(async()=>{try{const d=await sbGet('jobs','select=*&order=created_at.desc');setJobs(d||[]);}catch(e){console.error(e);}setLoading(false);},[]);
  useEffect(()=>{fetchJobs();},[fetchJobs]);
  useEffect(()=>{sbGet('material_calc_styles','is_active=eq.true&select=style_name&order=style_name').then(d=>{if(d&&d.length){const opts=d.map(s=>({v:s.style_name,l:s.style_name}));DD.style=opts;DD.style_single_wythe=opts;}});},[]);
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
        <Topbar jobs={jobs} live={live} onSearch={()=>setShowSearch(true)}/>
        <div style={{flex:1,overflow:'auto',padding:'24px 32px'}}>
          {loading?<div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'50vh',color:'#9E9B96'}}>Loading...</div>:<>
            {page==='dashboard'&&<Dashboard jobs={jobs} onNav={setPage}/>}
            {page==='estimating'&&<EstimatingPage jobs={jobs} onNav={(pg,job)=>{if(job){setOpenJob(job);}setPage(pg);}}/>}
            {page==='map'&&<MapPage jobs={jobs} onNav={(pg,job)=>{if(job){setOpenJob(job);}setPage(pg);}}/>}
            {page==='projects'&&<ProjectsPage jobs={jobs} onRefresh={fetchJobs} openJob={openJob}/>}
            {page==='billing'&&<BillingPage jobs={jobs} onRefresh={fetchJobs} onNav={setPage}/>}
            {page==='pm_billing'&&<PMBillingPage jobs={jobs} onRefresh={fetchJobs}/>}
            {page==='production'&&<ProductionPage jobs={jobs} setJobs={setJobs} onRefresh={fetchJobs} onNav={setPage}/>}
            {page==='reports'&&<ReportsPage jobs={jobs}/>}
            {page==='import_projects'&&<ImportProjectsPage jobs={jobs} onRefresh={fetchJobs} onNav={setPage}/>}
            {page==='change_orders'&&<ChangeOrdersPage jobs={jobs}/>}
            {page==='material_calc'&&<MaterialCalcPage jobs={jobs}/>}
            {page==='production_orders'&&<ProductionOrdersPage jobs={jobs} setJobs={setJobs} onNav={setPage}/>}
            {page==='schedule'&&<SchedulePage jobs={jobs}/>}
            {page==='weather_days'&&<WeatherDaysPage jobs={jobs}/>}
            {page==='pm_daily_report'&&<PMDailyReportPage jobs={jobs}/>}
            {page==='daily_report'&&<DailyReportPage jobs={jobs}/>}
            {page==='install_schedule'&&<InstallSchedulePage jobs={jobs}/>}
            {page==='help'&&<HelpPage/>}
          </>}
        </div>
      </div>
      {showSearch&&<GlobalSearch jobs={jobs} onSelect={j=>{setOpenJob(j);setPage('projects');setShowSearch(false);}}/>}
    </div>
  );
}
