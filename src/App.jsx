import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
function KPI({label,value,color='#8B2020'}){return<div style={card}><div style={{fontFamily:'Syne',fontSize:28,fontWeight:800,color}}>{value}</div><div style={{fontSize:12,color:'#6B6056',marginTop:4}}>{label}</div></div>;}
function PBar({pct:p,color='#8B2020',h=6}){return<div style={{height:h,background:'#E5E3E0',borderRadius:h,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(Math.max(p,0),100)}%`,background:color,borderRadius:h,transition:'width .3s'}}/></div>;}
function renderCell(j,k){const v=j[k];if(k==='status')return<span style={pill(SC[v]||'#6B6056',SB_[v]||'#F4F4F2')}>{SS[v]||v}</span>;if(k==='market')return<span style={pill(MC[v]||'#6B6056',MB[v]||'#F4F4F2')}>{MS[v]||v||'—'}</span>;if(['adj_contract_value','contract_value','left_to_bill','ytd_invoiced','net_contract_value'].includes(k))return<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:k==='left_to_bill'?(n(v)>100000?'#991B1B':n(v)>50000?'#B45309':'#065F46'):'#1A1A1A'}}>{$(v)}</span>;if(k==='pct_billed')return<span>{fmtPct(v)}</span>;if(k==='total_lf')return<span>{n(v).toLocaleString()}</span>;if(['contract_date','last_billed','est_start_date','active_entry_date','complete_date'].includes(k))return fD(v);if(['aia_billing','bonds','certified_payroll','ocip_ccip','third_party_billing'].includes(k))return v?<span style={{color:'#22c55e',fontWeight:700}}>✓</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='retainage_pct')return n(v)?<span style={{fontWeight:600}}>{n(v)}%</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='retainage_held')return n(v)?<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:'#991B1B'}}>{$(v)}</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='collected')return v?<span style={pill('#065F46','#D1FAE5')}>COLLECTED</span>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='primary_fence_type'){const ptc={Precast:'#8B2020',Masonry:'#185FA5','Wrought Iron':'#374151'};return v?<span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:ptc[v]||'#6B6056',color:'#FFF'}}>{v}</span>:<span style={{color:'#9E9B96'}}>—</span>;}if(k==='fence_addons'){const arr=Array.isArray(v)?v:[];return arr.length>0?<div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{arr.map(a=><span key={a} style={{display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:'#F4F4F2',color:'#1A1A1A',border:'1px solid #E5E3E0'}}>{a}</span>)}</div>:<span style={{color:'#9E9B96'}}>—</span>;}return v||'—';}

/* ═══ PROJECT QUICK VIEW ═══ */
function ProjectQuickView({job,onClose,onNav,billSub}){
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
  const[coForm,setCOForm]=useState({co_number:'',date:'',amount:'',description:'',status:'Pending',approved_by:'',notes:''});
  const[latestPmLF,setLatestPmLF]=useState(null);
  useEffect(()=>{if(job?.id)sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`).then(d=>setCOList(d||[]));},[job?.id]);
  useEffect(()=>{if(job?.id)sbGet('pm_billing_entries',`job_id=eq.${job.id}&order=billing_period.desc&limit=1`).then(d=>setLatestPmLF(d&&d[0]||null));else setLatestPmLF(null);},[job?.id]);
  const saveCO=async()=>{const body={...coForm,amount:n(coForm.amount),job_id:job.id,job_number:job.job_number,job_name:job.job_name,market:job.market,pm:job.pm};await sbPost('change_orders',body);setShowCOForm(false);setCOForm({co_number:'',date:'',amount:'',description:'',status:'Pending',approved_by:'',notes:''});sbGet('change_orders',`job_id=eq.${job.id}&order=created_at.desc`).then(d=>setCOList(d||[]));};
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
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Date</label><input type="date" value={coForm.date} onChange={e=>setCOForm(f=>({...f,date:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Amount ($)</label><input type="number" value={coForm.amount} onChange={e=>setCOForm(f=>({...f,amount:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Status</label><select value={coForm.status} onChange={e=>setCOForm(f=>({...f,status:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}>{['Pending','Approved','Rejected'].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              <div><label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:2}}>Approved By</label><input value={coForm.approved_by} onChange={e=>setCOForm(f=>({...f,approved_by:e.target.value}))} style={{...inputS,padding:'4px 8px',fontSize:11}}/></div>
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
          <div>{fLbl('Style')}<input value={f.style} onChange={e=>set('style',e.target.value)} style={inputS}/></div>
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
      sbGet('weather_days',`date=gte.${weekAgo.split('T')[0]}&select=id`),
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
  const tc=active.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const tl=active.reduce((s,j)=>s+n(j.left_to_bill),0);const ty=allBillable.reduce((s,j)=>s+n(j.ytd_invoiced),0);const BACKLOG_STS=new Set(['contract_review','production_queue','in_production','inventory_ready','active_install']);const tlf=jobs.filter(j=>BACKLOG_STS.has(j.status)).reduce((s,j)=>s+n(j.total_lf),0);
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
  // Current month billing cycle status — small card for the dashboard
  const dashBillingMonth=curBillingMonth();
  const[dashCycles,setDashCycles]=useState([]);useEffect(()=>{sbGet('monthly_billing_cycles',`billing_month=eq.${dashBillingMonth}&select=id,invoice_sent,amount_to_invoice,accounting_approved`).then(d=>setDashCycles(d||[]));},[dashBillingMonth]);
  const dashCycleStats=useMemo(()=>{const total=dashCycles.length;const invoiced=dashCycles.filter(c=>c.invoice_sent).length;const invoicedAmt=dashCycles.filter(c=>c.invoice_sent).reduce((s,c)=>s+n(c.amount_to_invoice),0);const pending=dashCycles.filter(c=>!c.accounting_approved&&!c.invoice_sent).length;return{total,invoiced,invoicedAmt,pending};},[dashCycles]);

  return(<div>
    {dashToast&&<Toast message={dashToast.msg} isError={!dashToast.ok} onDone={()=>setDashToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Dashboard</h1>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:16}}><KPI label="Total Contract" value={$k(tc)}/><KPI label="Left to Bill" value={$k(tl)} color="#B45309"/><KPI label="YTD Billed" value={$k(ty)} color="#065F46"/><KPI label="Backlog LF" value={tlf.toLocaleString()} color="#1D4ED8"/></div>
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
    {/* Billing Cycle status card */}
    <div style={{...card,marginBottom:16,display:'flex',alignItems:'center',gap:18,flexWrap:'wrap',borderLeft:'4px solid #8B2020'}}>
      <div style={{flex:'0 0 auto'}}>
        <div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:'#1A1A1A'}}>{monthLabel(dashBillingMonth)} Billing Cycle</div>
        <div style={{fontSize:11,color:'#9E9B96'}}>{dashCycleStats.total>0?'Cycle active':'No cycle started'}</div>
      </div>
      <div style={{display:'flex',gap:24,flex:1,flexWrap:'wrap'}}>
        <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#1D4ED8'}}>{dashCycleStats.invoiced} of {dashCycleStats.total}</div><div style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Jobs invoiced</div></div>
        <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#065F46'}}>{$k(dashCycleStats.invoicedAmt)}</div><div style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Invoiced this month</div></div>
        <div><div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:dashCycleStats.pending>0?'#B45309':'#9E9B96'}}>{dashCycleStats.pending}</div><div style={{fontSize:10,color:'#9E9B96',textTransform:'uppercase',fontWeight:600}}>Pending approval</div></div>
      </div>
      {onNav&&<button onClick={()=>onNav('billing')} style={{...btnS,fontSize:12,whiteSpace:'nowrap'}}>Go to Monthly Cycles →</button>}
    </div>
    {/* Quick Actions */}
    {onNav&&<div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
      {[['+ New Project','projects'],['Log Weather Day','weather_days'],['Log Daily Report','pm_daily_report'],['View Billing','billing']].map(([l,k])=><button key={k} onClick={()=>onNav(k)} style={{...btnP,padding:'10px 20px',fontSize:13}}>{l}</button>)}
      <button onClick={()=>setShowRemindConfirm(true)} disabled={remindSending} style={{...btnP,padding:'10px 20px',fontSize:13,opacity:remindSending?0.6:1}}>{remindSending?'Sending...':'📧 Send Bill Sheet Reminders'}</button>
    </div>}
    {showRemindConfirm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowRemindConfirm(false)}>
      <div style={{background:'#FFF',borderRadius:16,padding:28,width:440,boxShadow:'0 8px 30px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:17,fontWeight:800,marginBottom:12,color:'#1A1A1A'}}>Send Bill Sheet Reminders?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.7,marginBottom:20}}>This will email all PMs with missing bill sheets for <b style={{color:'#1A1A1A'}}>{monthLabel(curBillingMonth())}</b> and send you an AR summary. Continue?</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setShowRemindConfirm(false)} style={btnS}>Cancel</button><button onClick={sendReminders} style={btnP}>Send Reminders</button></div>
      </div>
    </div>}
    {/* Quick stats */}
    {(()=>{const aiCount=jobs.filter(j=>j.status==='active_install').length;const icCount=jobs.filter(j=>j.status==='fence_complete').length;const collMo=jobs.filter(j=>j.collected&&j.collected_date&&new Date(j.collected_date).getMonth()===now.getMonth()&&new Date(j.collected_date).getFullYear()===now.getFullYear()).length;const outstanding=jobs.filter(j=>j.status==='fully_complete'&&!j.collected).length;return<div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:24}}>{[['Active',active.length],['Active Install',aiCount],['Fence Done',icCount],['Collected Mo.',collMo],['Outstanding',outstanding],['Completed Mo.',compThisMonth],['Closed',closedJobs.length],['Total',jobs.length]].map(([l,v])=><div key={l} style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:8,padding:'8px 12px'}}><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{v}</div><div style={{fontSize:10,color:'#9E9B96'}}>{l}</div></div>)}</div>;})()}
    {/* Backlog Health */}
    {(()=>{
      const blJobs=active;
      const blLTB=tl;
      const currentMo=new Date().getMonth()+1;
      const runRate=currentMo>0?ty/currentMo:0;
      const blCount=blJobs.length;
      const blLF=blJobs.reduce((s,j)=>s+n(j.total_lf),0);
      const blMonths=runRate>0?blLTB/runRate:0;
      const blColor=blMonths>=4?'#065F46':blMonths>=2?'#B45309':'#991B1B';
      const blBg=blMonths>=4?'#D1FAE5':blMonths>=2?'#FEF3C7':'#FEE2E2';
      const mktLTB=MKTS.map(m=>{const mj=blJobs.filter(j=>j.market===m);return{name:MS[m],market:m,ltb:mj.reduce((s,j)=>s+n(j.left_to_bill),0)};});
      const mktTotal=mktLTB.reduce((s,m)=>s+m.ltb,0);
      return<div style={{...card,marginBottom:24,border:`1px solid ${blColor}30`}}>
        <div style={{display:'flex',gap:24,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
          <div>
            <div style={{fontFamily:'Inter',fontWeight:900,fontSize:36,color:blColor}}>{blMonths.toFixed(1)}</div>
            <div style={{fontSize:14,fontWeight:700,color:blColor}}>Months of Backlog</div>
            <div style={{fontSize:11,color:'#9E9B96',marginTop:2}}>at {$k(runRate)}/mo run rate</div>
          </div>
          <div style={{display:'flex',gap:20,flex:1,justifyContent:'flex-end',flexWrap:'wrap'}}>
            <div style={{textAlign:'center'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#1A1A1A'}}>{$k(blLTB)}</div><div style={{fontSize:10,color:'#9E9B96'}}>Left to Bill</div></div>
            <div style={{textAlign:'center'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#1A1A1A'}}>{$k(runRate)}/mo</div><div style={{fontSize:10,color:'#9E9B96'}}>Monthly Run Rate</div></div>
            <div style={{textAlign:'center'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#1A1A1A'}}>{blCount}</div><div style={{fontSize:10,color:'#9E9B96'}}>Active Jobs</div></div>
            <div style={{textAlign:'center'}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'#1A1A1A'}}>{blLF.toLocaleString()}</div><div style={{fontSize:10,color:'#9E9B96'}}>Total LF</div></div>
          </div>
        </div>
        {/* Market breakdown bar */}
        <div style={{marginBottom:8}}>
          <div style={{display:'flex',height:24,borderRadius:6,overflow:'hidden',background:'#E5E3E0'}}>
            {mktLTB.filter(m=>m.ltb>0).map(m=><div key={m.market} style={{width:`${mktTotal>0?m.ltb/mktTotal*100:0}%`,background:MC[m.market],display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'#fff',fontWeight:700,minWidth:m.ltb/mktTotal>0.08?0:'fit-content'}} title={`${m.name}: ${$(m.ltb)} (${Math.round(m.ltb/mktTotal*100)}%)`}>{mktTotal>0&&m.ltb/mktTotal>0.12?m.name:''}</div>)}
          </div>
          <div style={{display:'flex',gap:16,marginTop:6,flexWrap:'wrap'}}>
            {mktLTB.filter(m=>m.ltb>0).map(m=><div key={m.market} style={{display:'flex',alignItems:'center',gap:4,fontSize:11}}>
              <div style={{width:8,height:8,borderRadius:2,background:MC[m.market]}}/>
              <span style={{color:'#6B6056'}}>{m.name}</span>
              <span style={{fontWeight:700}}>{$k(m.ltb)}</span>
              <span style={{color:'#9E9B96'}}>{mktTotal>0?Math.round(m.ltb/mktTotal*100):0}%</span>
            </div>)}
          </div>
        </div>
        {/* Warning banners */}
        {blMonths<2&&<div style={{background:'#FEE2E2',border:'1px solid #991B1B30',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:600,color:'#991B1B',marginTop:8}}>Critical: Less than 2 months of backlog remaining</div>}
        {blMonths>=2&&blMonths<4&&<div style={{background:'#FEF3C7',border:'1px solid #B4530930',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:600,color:'#B45309',marginTop:8}}>Backlog below 4-month target — new contracts needed to maintain revenue pace</div>}
      </div>;
    })()}
    {/* Fence Type Breakdown — grouped job detail */}
    {(()=>{
      const ftGroups=[
        {key:'Precast',label:'Precast',filter:j=>(j.fence_type||'').toLowerCase().includes('pc')||(j.fence_type||'').toLowerCase().includes('precast')},
        {key:'Masonry',label:'Masonry',filter:j=>(j.fence_type||'').toLowerCase().includes('masonry')||(j.fence_type||'').toLowerCase().includes('sw')},
        {key:'Wrought Iron',label:'Wrought Iron',filter:j=>(j.fence_type||'').toLowerCase().includes('wi')||(j.fence_type||'').toLowerCase().includes('wrought')},
        {key:'Other',label:'Other',filter:j=>true},
      ];
      const assigned=new Set();
      const grouped=ftGroups.map(g=>{
        const gjobs=active.filter(j=>{if(assigned.has(j.id))return false;return g.filter(j);});
        gjobs.forEach(j=>assigned.add(j.id));
        return{...g,jobs:gjobs};
      });
      const[ftCollapsed,setFtCollapsed]=React.useState({});
      const toggleFt=k=>setFtCollapsed(p=>({...p,[k]:!p[k]}));
      const thS={textAlign:'left',padding:'6px 10px',fontSize:10,color:'#6B6056',fontWeight:600,textTransform:'uppercase',borderBottom:'1px solid #E5E3E0'};
      const tdS={padding:'6px 10px',fontSize:12,borderBottom:'1px solid #F4F4F2',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:180};
      return <div style={{...card,marginBottom:24}}>
        <div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Fence Type Breakdown — Active Jobs</div>
        {grouped.filter(g=>g.jobs.length>0).map(g=><div key={g.key} style={{marginBottom:12}}>
          <button onClick={()=>toggleFt(g.key)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'#FDF4F4',border:'1px solid #E5E3E0',borderRadius:8,cursor:'pointer',marginBottom:ftCollapsed[g.key]?0:4}}>
            <span style={{fontSize:13,fontWeight:800,color:'#8B2020'}}>{g.label} ({g.jobs.length} jobs)</span>
            <span style={{fontSize:16,color:'#8B2020'}}>{ftCollapsed[g.key]?'▸':'▾'}</span>
          </button>
          {!ftCollapsed[g.key]&&<div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>
            {['Job Name','Job #','City','Style','Color','Height','LF'].map(h=><th key={h} style={thS}>{h}</th>)}
          </tr></thead><tbody>{g.jobs.map(j=>{
            const isPC=g.key==='Precast';
            return <tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
              <td style={{...tdS,fontWeight:500}}>{j.job_name||'—'}</td>
              <td style={tdS}>{j.job_number||'—'}</td>
              <td style={tdS}>{j.city||'—'}</td>
              <td style={tdS}>{isPC?(j.style_precast||j.style_clean||'—'):(j.style_clean||'—')}</td>
              <td style={tdS}>{j.color_precast||'—'}</td>
              <td style={{...tdS,textAlign:'right'}}>{isPC?(j.height_precast||j.average_height_installed||'—'):(j.average_height_installed||'—')}</td>
              <td style={{...tdS,textAlign:'right',fontWeight:700}}>{(()=>{const lf=isPC?(n(j.lf_precast)||n(j.total_lf_installed)):n(j.total_lf_installed);return lf?lf.toLocaleString():'—';})()}</td>
            </tr>;
          })}</tbody></table></div>}
        </div>)}
      </div>;
    })()}
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
  const[search,setSearch]=useState('');const[statusF,setStatusF]=useState(null);const[mktF,setMktF]=useState(null);const[pmF,setPmF]=useState('');
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
  const filtered=useMemo(()=>{let f=jobs.filter(j=>j.status!=='closed');if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}if(statusF)f=f.filter(j=>j.status===statusF);if(mktF)f=f.filter(j=>j.market===mktF);if(pmF)f=f.filter(j=>j.pm===pmF);return[...f].sort((a,b)=>{let av=a[sortCol],bv=b[sortCol];if(typeof av==='string')return sortDir==='asc'?(av||'').localeCompare(bv||''):(bv||'').localeCompare(av||'');return sortDir==='asc'?n(av)-n(bv):n(bv)-n(av);});},[jobs,search,statusF,mktF,pmF,sortCol,sortDir]);
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
  const[arForm,setArForm]=useState({ar_notes:'',ar_reviewed_by:''});
  const arMonthLabel=monthLabel(arMonth);
  const arIsCurrent=arMonth===curBillingMonth();
  const fetchArSubs=useCallback(async()=>{const d=await sbGet('pm_bill_submissions',`billing_month=eq.${arMonth}&order=job_name.asc`);setArSubs(d||[]);},[arMonth]);
  useEffect(()=>{if(billingTab==='submissions')fetchArSubs();},[fetchArSubs,billingTab]);
  const arActiveJobs=useMemo(()=>jobs.filter(j=>ACTIVE_BILL_STATUSES.includes(j.status)),[jobs]);
  const arSubByJob=useMemo(()=>{const m={};arSubs.forEach(s=>{m[s.job_id]=s;});return m;},[arSubs]);
  const arStats=useMemo(()=>{const total=arActiveJobs.length;let submitted=0,reviewed=0,missing=0;arActiveJobs.forEach(j=>{const s=arSubByJob[j.id];if(!s)missing++;else if(s.ar_reviewed)reviewed++;else submitted++;});return{total,submitted,missing,reviewed};},[arActiveJobs,arSubByJob]);
  const arTableData=useMemo(()=>{let data=arActiveJobs.map(j=>{const sub=arSubByJob[j.id];const status=sub?(sub.ar_reviewed?'reviewed':'submitted'):'missing';return{job:j,sub,status};});if(arPmF)data=data.filter(d=>d.job.pm===arPmF);if(arMktF)data=data.filter(d=>d.job.market===arMktF);if(arViewF!=='all')data=data.filter(d=>d.status===arViewF);const order={missing:0,submitted:1,reviewed:2};data.sort((a,b)=>order[a.status]-order[b.status]||(a.job.job_name||'').localeCompare(b.job.job_name||''));return data;},[arActiveJobs,arSubByJob,arPmF,arMktF,arViewF]);
  const markArReviewed=async()=>{if(!arDetail)return;try{await sbPatch('pm_bill_submissions',arDetail.sub.id,{ar_reviewed:true,ar_reviewed_at:new Date().toISOString(),ar_reviewed_by:arForm.ar_reviewed_by||'AR',ar_notes:arForm.ar_notes||null});setArDetail(null);setArForm({ar_notes:'',ar_reviewed_by:''});fetchArSubs();setToast('Marked as reviewed');}catch(e){setToast({message:e.message||'Review failed',isError:true});}};
  const openArDetail=(sub)=>{setArDetail({sub});setArForm({ar_notes:sub.ar_notes||'',ar_reviewed_by:sub.ar_reviewed_by||''});};
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
        <button onClick={sendBilReminders} disabled={bilRemindSending} style={{...btnP,padding:'8px 16px',fontSize:12,opacity:bilRemindSending?0.6:1}}>{bilRemindSending?'Sending...':'📧 Send Reminders'}</button>
      </div>
      {!arIsCurrent&&<div style={{background:'#FEF3C7',border:'1px solid #F9731640',borderRadius:8,padding:'8px 16px',marginBottom:14,fontSize:13,color:'#92400E',fontWeight:600}}>Viewing historical data — {arMonthLabel}</div>}
      {/* Filter bar */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,color:'#9E9B96',fontWeight:600}}>PM:</span>
        <button onClick={()=>setArPmF('')} style={fpill(!arPmF)}>All PMs</button>
        {PM_LIST.map(p=><button key={p.id} onClick={()=>setArPmF(p.id)} style={fpill(arPmF===p.id)}>{p.short}</button>)}
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
          <div style={{fontSize:11,fontWeight:800,color:'#1A1A1A',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>AR Review</div>
          <div style={{marginBottom:10}}>
            <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>AR Notes</label>
            <textarea value={arForm.ar_notes} onChange={e=>setArForm(p=>({...p,ar_notes:e.target.value}))} rows={3} placeholder="Review notes, adjustments, flags..." style={{...inputS,resize:'vertical'}} disabled={s.ar_reviewed}/>
          </div>
          <div>
            <label style={{display:'block',fontSize:10,color:'#6B6056',marginBottom:3,textTransform:'uppercase',fontWeight:600}}>Reviewer Name</label>
            <input value={arForm.ar_reviewed_by} onChange={e=>setArForm(p=>({...p,ar_reviewed_by:e.target.value}))} placeholder="Your name" style={inputS} disabled={s.ar_reviewed}/>
          </div>
          {s.ar_reviewed&&<div style={{marginTop:10,fontSize:12,color:'#1D4ED8',fontWeight:600}}>Reviewed by {s.ar_reviewed_by||'AR'} on {s.ar_reviewed_at?new Date(s.ar_reviewed_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'—'}</div>}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={()=>{setArDetail(null);setArForm({ar_notes:'',ar_reviewed_by:''});}} style={btnS}>Close</button>
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
  </div>);
}

/* ═══ PM BILLING PAGE ═══ */
const ACTIVE_BILL_STATUSES=['in_production','inventory_ready','active_install','fence_complete','fully_complete'];

function PMBillingPage({jobs,onRefresh}){
  const[selPM,setSelPM]=useState(()=>localStorage.getItem('fc_pm')||'');
  const[selMonth,setSelMonth]=useState(curBillingMonth);
  const[subs,setSubs]=useState([]);
  const[expanded,setExpanded]=useState(new Set());
  const[forms,setForms]=useState({});
  const[editMode,setEditMode]=useState(new Set());
  const[saving,setSaving]=useState(null);
  const[toast,setToast]=useState(null);
  const LF_FIELDS=['labor_post_only','labor_post_panels','labor_complete','sw_foundation','sw_columns','sw_panels','sw_complete','wi_gates','wi_fencing','wi_columns','line_bonds','line_permits','remove_existing','gate_controls'];
  const calcLFTotal=(form)=>LF_FIELDS.reduce((s,f)=>s+n(form[f]),0);
  const emptyForm=()=>({pct_complete:'',notes:'',...Object.fromEntries(LF_FIELDS.map(f=>[f,'']))});
  const pickPM=pm=>{setSelPM(pm);localStorage.setItem('fc_pm',pm);};
  const selMonthLabel=monthLabel(selMonth);
  const activeJobs=useMemo(()=>{let j2=jobs.filter(j=>ACTIVE_BILL_STATUSES.includes(j.status));if(selPM)j2=j2.filter(j=>j.pm===selPM);return j2.sort((a,b)=>(a.job_name||'').localeCompare(b.job_name||''));},[jobs,selPM]);
  const fetchSubs=useCallback(async()=>{if(!selPM)return;const d=await sbGet('pm_bill_submissions',`billing_month=eq.${selMonth}&pm=eq.${selPM}&order=created_at.desc`);setSubs(d||[]);},[selMonth,selPM]);
  useEffect(()=>{fetchSubs();},[fetchSubs]);
  const subByJob=useMemo(()=>{const m={};(subs||[]).forEach(s=>{if(!m[s.job_id])m[s.job_id]=s;});return m;},[subs]);
  const submittedCount=activeJobs.filter(j=>subByJob[j.id]).length;
  const totalCount=activeJobs.length;
  const pct=totalCount>0?Math.round(submittedCount/totalCount*100):0;
  const pctColor=pct>=100?'#10B981':pct>50?'#F59E0B':'#EF4444';
  const getForm=(jobId)=>forms[jobId]||emptyForm();
  const updateForm=(jobId,field,val)=>setForms(prev=>({...prev,[jobId]:{...(prev[jobId]||emptyForm()),[field]:val}}));
  const toggleCard=(jobId)=>setExpanded(prev=>{const s=new Set(prev);if(s.has(jobId))s.delete(jobId);else s.add(jobId);return s;});
  const expandAll=()=>setExpanded(new Set(activeJobs.map(j=>j.id)));
  const collapseAll=()=>setExpanded(new Set());
  const openEdit=(job,sub)=>{const form={pct_complete:sub.pct_complete_pm!=null?String(sub.pct_complete_pm):'',notes:sub.notes||'',...Object.fromEntries(LF_FIELDS.map(f=>[f,n(sub[f])!==0?String(n(sub[f])):'']))};setForms(prev=>({...prev,[job.id]:form}));setEditMode(prev=>{const s=new Set(prev);s.add(job.id);return s;});setExpanded(prev=>{const s=new Set(prev);s.add(job.id);return s;});};
  const cancelEdit=(jobId)=>setEditMode(prev=>{const s=new Set(prev);s.delete(jobId);return s;});
  const submitEntry=async(job)=>{const form=getForm(job.id);setSaving(job.id);try{const payload={billing_month:selMonth,job_id:job.id,job_number:job.job_number,job_name:job.job_name,pm:selPM,market:job.market,style:job.style||null,color:job.color||null,height:job.height_precast||null,adj_contract_value:parseFloat(job.adj_contract_value)||0,total_lf:parseInt(job.total_lf)||0,labor_post_only:parseFloat(form.labor_post_only)||0,labor_post_panels:parseFloat(form.labor_post_panels)||0,labor_complete:parseFloat(form.labor_complete)||0,sw_foundation:parseFloat(form.sw_foundation)||0,sw_columns:parseFloat(form.sw_columns)||0,sw_panels:parseFloat(form.sw_panels)||0,sw_complete:parseFloat(form.sw_complete)||0,wi_gates:parseFloat(form.wi_gates)||0,wi_fencing:parseFloat(form.wi_fencing)||0,wi_columns:parseFloat(form.wi_columns)||0,line_bonds:parseFloat(form.line_bonds)||0,line_permits:parseFloat(form.line_permits)||0,remove_existing:parseFloat(form.remove_existing)||0,gate_controls:parseFloat(form.gate_controls)||0,lf_panels_washed:0,pct_complete_pm:parseFloat(form.pct_complete)||0,notes:form.notes||null,submitted_by:selPM,submitted_at:new Date().toISOString(),ar_reviewed:false};console.log('[PM Bill Sheet] Submitting payload:',JSON.stringify(payload));const res=await fetch(`${SB}/rest/v1/pm_bill_submissions`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});const resTxt=await res.text();console.log('[PM Bill Sheet] Response status:',res.status);console.log('[PM Bill Sheet] Response body:',resTxt);if(!res.ok){throw new Error(`Save failed (${res.status}): ${resTxt}`);}const saved=resTxt?JSON.parse(resTxt):[];const rec=saved[0]||saved;const existing=subByJob[job.id];if(existing){setSubs(prev=>prev.map(s=>s.id===existing.id?rec:s));}else{setSubs(prev=>[rec,...prev]);}setToast(`Bill sheet submitted for ${job.job_name}`);setEditMode(prev=>{const s=new Set(prev);s.delete(job.id);return s;});setExpanded(prev=>{const s=new Set(prev);s.delete(job.id);return s;});}catch(e){console.error('[PM Bill Sheet] Submit error:',e);setToast({message:e.message||'Submit failed',isError:true});}setSaving(null);};

  const LF_SECTIONS=[{title:'Precast',bg:'#FEF3C7',fields:[['Post Only','labor_post_only'],['Post+Panels','labor_post_panels'],['Complete','labor_complete']]},{title:'Single Wythe',bg:'#DBEAFE',fields:[['Foundation','sw_foundation'],['Columns','sw_columns'],['Panels','sw_panels'],['Complete','sw_complete']]},{title:'One Line Items',bg:'#EDE9FE',fields:[['WI Gates','wi_gates'],['WI Fencing','wi_fencing'],['WI Columns','wi_columns'],['Bonds','line_bonds'],['Permits','line_permits'],['Remove','remove_existing'],['Gate Ctrl','gate_controls']]}];
  const renderLFReadOnly=(sub)=>LF_SECTIONS.map(sec=>{const hasData=sec.fields.some(([,f])=>n(sub[f])>0);if(!hasData)return null;return<div key={sec.title} style={{marginBottom:10}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4,padding:'3px 8px',background:sec.bg,borderRadius:4,display:'inline-block'}}>{sec.title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:6}}>{sec.fields.map(([label,field])=>{const v=n(sub[field]);return v>0?<div key={field} style={{background:'#F9F8F6',borderRadius:6,padding:'4px 8px'}}><div style={{fontSize:9,color:'#9E9B96',textTransform:'uppercase'}}>{label}</div><div style={{fontFamily:'Inter',fontSize:13,fontWeight:700}}>{v.toLocaleString()}</div></div>:null;}).filter(Boolean)}</div></div>;}).filter(Boolean);
  const renderLFForm=(jobId)=>{const form=getForm(jobId);return LF_SECTIONS.map(sec=><div key={sec.title} style={{marginBottom:12}}><div style={{fontSize:10,fontWeight:700,color:'#6B6056',textTransform:'uppercase',letterSpacing:0.5,marginBottom:6,padding:'4px 8px',background:sec.bg,borderRadius:4}}>{sec.title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>{sec.fields.map(([label,field])=><div key={field}><label style={{display:'block',fontSize:9,color:'#9E9B96',marginBottom:1}}>{label}</label><input type="number" value={form[field]} onChange={e=>updateForm(jobId,field,e.target.value)} placeholder="0" style={{...inputS,padding:'4px 8px',fontSize:12}}/></div>)}</div></div>);};

  if(!selPM)return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:24}}>PM Bill Sheet</h1>
    <div style={{...card,textAlign:'center',padding:40}}>
      <div style={{fontSize:16,color:'#6B6056',marginBottom:20}}>Select your name to get started</div>
      <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>{PM_LIST.map(pm=><button key={pm.id} onClick={()=>pickPM(pm.id)} style={{padding:'14px 32px',borderRadius:12,border:'2px solid #E5E3E0',background:'#FFF',color:'#1A1A1A',fontSize:16,fontWeight:700,cursor:'pointer',transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.background='#8B2020';e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='#8B2020';}} onMouseLeave={e=>{e.currentTarget.style.background='#FFF';e.currentTarget.style.color='#1A1A1A';e.currentTarget.style.borderColor='#E5E3E0';}}>{pm.label}</button>)}</div>
    </div>
  </div>);

  return(<div>
    {toast&&<Toast message={typeof toast==='string'?toast:toast.message} isError={typeof toast==='object'&&toast.isError} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>PM Bill Sheet</h1>
    </div>
    {/* PM Selector + Month */}
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
      {PM_LIST.map(pm=><button key={pm.id} onClick={()=>pickPM(pm.id)} style={{padding:'8px 20px',borderRadius:20,border:'none',background:selPM===pm.id?'#8B2020':'#F4F4F2',color:selPM===pm.id?'#fff':'#6B6056',fontSize:14,fontWeight:700,cursor:'pointer',transition:'all .15s'}}>{pm.short}</button>)}
      <span style={{color:'#E5E3E0',margin:'0 4px'}}>|</span>
      <input type="month" value={selMonth} onChange={e=>setSelMonth(e.target.value||curBillingMonth())} style={{...inputS,width:170}}/>
      <span style={{fontSize:14,fontWeight:800,color:'#8B2020'}}>{selMonthLabel}</span>
    </div>
    {/* Progress bar */}
    <div style={{...card,marginBottom:16,padding:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontSize:14,fontWeight:700,color:'#1A1A1A'}}>{submittedCount} of {totalCount} jobs submitted for {selMonthLabel}</span>
        <span style={{fontSize:24,fontWeight:800,color:pctColor}}>{pct}%</span>
      </div>
      <div style={{height:10,background:'#E5E3E0',borderRadius:10,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pctColor,borderRadius:10,transition:'width .4s ease'}}/></div>
    </div>
    {/* Expand/Collapse All */}
    <div style={{display:'flex',gap:8,marginBottom:12}}>
      <button onClick={expandAll} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #D1CEC9',background:'#FFF',color:'#6B6056',fontSize:12,fontWeight:600,cursor:'pointer'}}>Expand All</button>
      <button onClick={collapseAll} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #D1CEC9',background:'#FFF',color:'#6B6056',fontSize:12,fontWeight:600,cursor:'pointer'}}>Collapse All</button>
      <span style={{fontSize:12,color:'#9E9B96',lineHeight:'30px',marginLeft:8}}>{activeJobs.length} active jobs</span>
    </div>
    {/* Job cards */}
    {activeJobs.map(j=>{const sub=subByJob[j.id];const isExp=expanded.has(j.id);const isEditing=editMode.has(j.id);const arReviewed=sub&&sub.ar_reviewed;const form=getForm(j.id);const subDate=sub&&sub.submitted_at?new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
      return<div key={j.id} style={{...card,padding:0,marginBottom:12,overflow:'hidden',borderLeft:sub?arReviewed?'4px solid #3B82F6':'4px solid #10B981':'4px solid #EF4444'}}>
        {/* Header */}
        <div onClick={()=>toggleCard(j.id)} style={{background:'#333',color:'#FFF',padding:'10px 16px',display:'flex',gap:10,alignItems:'center',cursor:'pointer',flexWrap:'wrap'}}>
          <div style={{flex:'1 1 200px',minWidth:0}}>
            <span style={{fontSize:14,fontWeight:700}}>{j.job_name}</span>
            <span style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginLeft:8}}>#{j.job_number}</span>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center',fontSize:12,color:'rgba(255,255,255,0.7)'}}>
            {j.style&&<span>{j.style}</span>}{j.color&&<><span style={{opacity:0.4}}>|</span><span>{j.color}</span></>}{j.height_precast&&<><span style={{opacity:0.4}}>|</span><span>{j.height_precast}ft</span></>}
          </div>
          <div>{arReviewed?<span style={{display:'inline-block',padding:'3px 10px',borderRadius:6,fontSize:11,fontWeight:700,background:'#3B82F6',color:'#FFF'}}>Reviewed {sub.ar_reviewed_at?new Date(sub.ar_reviewed_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}</span>:sub?<span style={{display:'inline-block',padding:'3px 10px',borderRadius:6,fontSize:11,fontWeight:700,background:'#10B981',color:'#FFF'}}>✓ Submitted {subDate}</span>:<span style={{display:'inline-block',padding:'3px 10px',borderRadius:6,fontSize:11,fontWeight:700,background:'#EF4444',color:'#FFF'}}>✗ Not Submitted</span>}</div>
          <span style={{fontSize:12,color:'rgba(255,255,255,0.5)',transition:'transform 0.3s',display:'inline-block',transform:isExp?'rotate(0deg)':'rotate(-90deg)'}}>▼</span>
        </div>
        {/* Body */}
        <div style={{maxHeight:isExp?'5000px':'0',overflow:'hidden',transition:'max-height 0.3s ease-in-out'}}>
          <div style={{padding:16}}>
            {arReviewed?<div>
              <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:8,padding:12,marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:700,color:'#1D4ED8',marginBottom:2}}>Reviewed by AR{sub.ar_reviewed_by?' — '+sub.ar_reviewed_by:''} on {sub.ar_reviewed_at?new Date(sub.ar_reviewed_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'—'}</div>
                {sub.ar_notes&&<div style={{fontSize:12,color:'#6B6056',marginTop:4}}>AR Notes: {sub.ar_notes}</div>}
              </div>
              {renderLFReadOnly(sub)}
              <div style={{display:'flex',gap:12,marginTop:8,fontSize:12,color:'#6B6056'}}>{n(sub.total_lf)>0&&<span>Total LF: <b style={{color:'#1A1A1A'}}>{n(sub.total_lf).toLocaleString()}</b></span>}{sub.pct_complete_pm!=null&&<span>% Complete: <b style={{color:'#1A1A1A'}}>{sub.pct_complete_pm}%</b></span>}</div>
              {sub.notes&&<div style={{fontSize:12,color:'#6B6056',marginTop:4}}>Notes: {sub.notes}</div>}
            </div>:sub&&!isEditing?<div>
              {renderLFReadOnly(sub)}
              <div style={{display:'flex',gap:12,marginTop:8,fontSize:12,color:'#6B6056'}}>{n(sub.total_lf)>0&&<span>Total LF: <b style={{color:'#1A1A1A'}}>{n(sub.total_lf).toLocaleString()}</b></span>}{sub.pct_complete_pm!=null&&<span>% Complete: <b style={{color:'#1A1A1A'}}>{sub.pct_complete_pm}%</b></span>}</div>
              {sub.notes&&<div style={{fontSize:12,color:'#6B6056',marginTop:4}}>Notes: {sub.notes}</div>}
              <div style={{marginTop:12}}><button onClick={e=>{e.stopPropagation();openEdit(j,sub);}} style={{...btnP,padding:'8px 20px',fontSize:12}}>Edit</button></div>
            </div>:<div>
              {renderLFForm(j.id)}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>% Complete (estimate)</label><input type="number" min="0" max="100" value={form.pct_complete} onChange={e=>updateForm(j.id,'pct_complete',e.target.value)} placeholder="e.g. 65" style={inputS}/></div>
                <div style={{display:'flex',alignItems:'flex-end'}}><div style={{background:'#F9F8F6',borderRadius:8,padding:'8px 12px',fontSize:13}}>Total LF: <span style={{fontFamily:'Inter',fontWeight:800,color:'#8B2020'}}>{calcLFTotal(form).toLocaleString()}</span></div></div>
              </div>
              <div style={{marginBottom:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Notes</label><textarea value={form.notes} onChange={e=>updateForm(j.id,'notes',e.target.value)} rows={2} placeholder="Section completed, upcoming work, issues..." style={{...inputS,resize:'vertical'}}/></div>
              <div style={{display:'flex',gap:8}}><button onClick={()=>submitEntry(j)} disabled={saving===j.id} style={{...btnP,flex:1,padding:'10px 0',opacity:saving===j.id?0.5:1}}>{saving===j.id?'Saving...':sub?'Update Submission':'Submit Bill Sheet'}</button>{isEditing&&<button onClick={()=>cancelEdit(j.id)} style={btnS}>Cancel</button>}</div>
            </div>}
          </div>
        </div>
      </div>;
    })}
    {activeJobs.length===0&&<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No active projects found for {selPM}</div>}
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
function ProdCard({j,move,locked,billSub,onViewBill,onQuickView}){const ns=NEXT_STATUS[j.status];return<div style={{...card,padding:12,marginBottom:6}}><div style={{fontSize:10,color:'#9E9B96',marginBottom:1}}>#{j.job_number}</div><div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><span onClick={e=>{e.stopPropagation();if(onQuickView)onQuickView(j);}} style={{cursor:'pointer',borderBottom:'1px dashed transparent'}} onMouseEnter={e=>e.currentTarget.style.borderBottomColor='#8B2020'} onMouseLeave={e=>e.currentTarget.style.borderBottomColor='transparent'}>{j.job_name}</span></div><div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span>{j.pm&&<span style={{fontSize:10,color:'#6B6056',background:'#F4F4F2',padding:'1px 5px',borderRadius:4}}>{j.pm}</span>}</div><div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B6056',marginBottom:2}}><span>{n(j.total_lf).toLocaleString()} LF</span><span style={{fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(j.adj_contract_value||j.contract_value)}</span></div>{(j.style||j.color||j.height_precast)&&<div style={{fontSize:10,color:'#9E9B96',marginBottom:2}}>{[j.style,j.color,j.height_precast?j.height_precast+'ft':null].filter(Boolean).join(' | ')}</div>}{Array.isArray(j.fence_addons)&&j.fence_addons.length>0&&<div style={{display:'flex',gap:3,marginBottom:2}}>{j.fence_addons.map(a=>{const ac={G:['#B45309','Gates'],C:['#6D28D9','Columns'],WI:['#374151','WI']};const[bg,lbl]=ac[a]||['#6B6056',a];return<span key={a} style={{display:'inline-block',padding:'1px 5px',borderRadius:4,fontSize:9,fontWeight:700,background:bg,color:'#FFF'}}>{lbl}</span>;})}</div>}{j.est_start_date&&<div style={{marginBottom:2}}><StartDateBadge date={j.est_start_date} status={j.status}/></div>}<div style={{marginTop:4,paddingTop:4,borderTop:'1px solid #F4F4F2'}}>{billSub?<button onClick={e=>{e.stopPropagation();onViewBill(billSub);}} style={{background:'none',border:'none',padding:0,cursor:'pointer',fontSize:10,fontWeight:700,color:'#10B981'}}>📋 Bill Sheet ✓</button>:<span style={{fontSize:10,fontWeight:600,color:'#EF4444'}}>📋 No Bill Sheet</span>}</div>{!locked&&<div style={{display:'flex',gap:4,marginTop:6}}>{ns&&<button onClick={()=>move(j,ns)} style={{flex:2,padding:'5px 4px',borderRadius:6,border:`1px solid ${SC[ns]}40`,background:SB_[ns],color:SC[ns],fontSize:10,fontWeight:700,cursor:'pointer'}}>→ {SS[ns]}</button>}<select onChange={e=>{if(e.target.value)move(j,e.target.value);e.target.value='';}} style={{flex:1,padding:'4px',borderRadius:6,border:'1px solid #E5E3E0',fontSize:10,color:'#6B6056',cursor:'pointer',background:'#FFF'}}><option value="">More...</option>{STS.filter(s=>s!==j.status&&s!==ns).map(s=><option key={s} value={s}>{SS[s]}</option>)}</select></div>}</div>;}

function ProductionPage({jobs,setJobs,onRefresh}){
  const[quickViewJob,setQuickViewJob]=useState(null);
  // Bill sheet submissions for current month
  const prodBillingMonth=curBillingMonth();
  const[prodBillSubs,setProdBillSubs]=useState([]);
  const[prodBillModal,setProdBillModal]=useState(null);
  const fetchProdBillSubs=useCallback(async()=>{const d=await sbGet('pm_bill_submissions',`billing_month=eq.${prodBillingMonth}&order=created_at.desc`);setProdBillSubs(d||[]);},[prodBillingMonth]);
  useEffect(()=>{fetchProdBillSubs();},[fetchProdBillSubs]);
  const prodSubByJob=useMemo(()=>{const m={};(prodBillSubs||[]).forEach(s=>{if(!m[s.job_id])m[s.job_id]=s;});return m;},[prodBillSubs]);
  const PROD_LF_SECTIONS=[{title:'Precast',bg:'#FEF3C7',fields:[['Post Only','labor_post_only'],['Post+Panels','labor_post_panels'],['Complete','labor_complete']]},{title:'Single Wythe',bg:'#DBEAFE',fields:[['Foundation','sw_foundation'],['Columns','sw_columns'],['Panels','sw_panels'],['Complete','sw_complete']]},{title:'One Line Items',bg:'#EDE9FE',fields:[['WI Gates','wi_gates'],['WI Fencing','wi_fencing'],['WI Columns','wi_columns'],['Bonds','line_bonds'],['Permits','line_permits'],['Remove','remove_existing'],['Gate Ctrl','gate_controls']]}];
  const[groupBy,setGroupBy]=useState('status');const[mktF,setMktF]=useState(null);const[statusF,setStatusF]=useState(null);const[search,setSearch]=useState('');
  // Edit lock — defaults to locked on every page load (intentionally not persisted).
  const[editUnlocked,setEditUnlocked]=useState(false);const[showPinModal,setShowPinModal]=useState(false);const[pinInput,setPinInput]=useState('');const[pinError,setPinError]=useState(false);
  const submitPin=()=>{if(pinInput==='2020'){setEditUnlocked(true);setShowPinModal(false);setPinInput('');setPinError(false);}else{setPinError(true);setPinInput('');}};
  useEffect(()=>{if(!showPinModal)return;const onKey=(e)=>{if(e.key==='Escape'){setShowPinModal(false);setPinInput('');setPinError(false);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[showPinModal]);
  const[moveToast,setMoveToast]=useState(null);
  const move=async(job,ns)=>{if(!editUnlocked){console.warn('[Kanban] Move blocked — editing locked');return;}const u={status:ns};const today=new Date().toISOString().split('T')[0];if(ns==='inventory_ready')u.inventory_ready_date=today;if(ns==='active_install')u.active_install_date=today;if(ns==='fence_complete')u.fence_complete_date=today;if(ns==='fully_complete')u.fully_complete_date=today;if(ns==='closed')u.closed_date=today;console.log('[Kanban] Moving',job.job_name,'('+job.id+') from',job.status,'→',ns);try{const res=await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`,{method:'PATCH',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(u)});if(!res.ok){const txt=await res.text();console.error('[Kanban] PATCH failed:',res.status,txt);setMoveToast({msg:`Move failed (${res.status}): ${txt}`,ok:false});return;}setJobs(prev=>prev.map(j=>j.id===job.id?{...j,...u}:j));fireAlert('job_updated',{...job,...u});logAct(job,'status_change','status',job.status,ns);setMoveToast({msg:`Moved ${job.job_name} to ${SL[ns]||ns}`,ok:true});}catch(e){console.error('[Kanban] Move error:',e);setMoveToast({msg:e.message||'Move failed',ok:false});}};
  const filtered=useMemo(()=>{const seen=new Set();let f=jobs.filter(j=>{if(seen.has(j.id))return false;seen.add(j.id);return j.status!=='closed';});if(mktF)f=f.filter(j=>j.market===mktF);if(statusF)f=f.filter(j=>j.status===statusF);if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.customer_name}`.toLowerCase().includes(q));}return f;},[jobs,mktF,statusF,search]);
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
    <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputS,width:180,padding:'6px 10px',fontSize:12}}/><button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}{!isS&&<><span style={{color:'#E5E3E0'}}>|</span><button onClick={()=>setStatusF(null)} style={fpill(!statusF)}>All</button>{KANBAN_STS.map(s=><button key={s} onClick={()=>setStatusF(s)} style={fpill(statusF===s)}>{SS[s]}</button>)}</>}</div>
    <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(colArr.length,7)},1fr)`,gap:12,alignItems:'flex-start'}}>{colArr.map(col=>{const cv=col.jobs.reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);const lf=col.jobs.reduce((x,j)=>x+n(j.total_lf),0);return<div key={col.key}><div style={{background:col.bg||'#FDF4F4',border:`1px solid ${col.color}30`,borderRadius:12,padding:'12px 14px',marginBottom:8}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:col.color,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{col.label}</div><div style={{fontSize:11,color:'#6B6056',marginTop:2}}><span style={{background:'#E5E3E0',padding:'1px 6px',borderRadius:4,fontWeight:700,marginRight:6}}>{col.jobs.length}</span>{lf.toLocaleString()} LF · {$k(cv)}</div></div><div style={{maxHeight:'calc(100vh-300px)',overflow:'auto'}}>{col.jobs.map(j=><ProdCard key={j.id} j={j} move={move} locked={!editUnlocked} billSub={prodSubByJob[j.id]} onViewBill={s=>setProdBillModal(s)} onQuickView={setQuickViewJob}/>)}</div></div>;})}</div>
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
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Schedule</h1><div style={{display:'flex',gap:8}}><button onClick={()=>setView('calendar')} style={gpill(view==='calendar')}>Calendar</button><button onClick={()=>setView('list')} style={gpill(view==='list')}>List</button><button onClick={()=>setView('gantt')} style={gpill(view==='gantt')}>Gantt</button><button onClick={()=>{setEditEvt(null);setForm({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});setJobSearch('');setShowAdd(true);}} style={btnP}>+ Add Event</button></div></div>
    <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
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
  </div>);
}

/* ═══ DAILY REPORT PAGE ═══ */
function DailyReportPage(){
  // ─── Row config: planned field → actual field ──────────────────────────
  const DETAIL_GROUPS=[
    {label:'POSTS',rows:[
      {label:'8ft Line',p:'posts_8ft_line',a:'actual_posts_8ft_line'},{label:'8ft Corner',p:'posts_8ft_corner',a:'actual_posts_8ft_corner'},{label:'8ft Stop',p:'posts_8ft_stop',a:'actual_posts_8ft_stop'},
      {label:'10ft Line',p:'posts_10ft_line',a:'actual_posts_10ft_line'},{label:'10ft Corner',p:'posts_10ft_corner',a:'actual_posts_10ft_corner'},{label:'10ft Stop',p:'posts_10ft_stop',a:'actual_posts_10ft_stop'},
      {label:'12ft Line',p:'posts_12ft_line',a:'actual_posts_12ft_line'},{label:'12ft Corner',p:'posts_12ft_corner',a:'actual_posts_12ft_corner'},{label:'12ft Stop',p:'posts_12ft_stop',a:'actual_posts_12ft_stop'},
    ]},
    {label:'PANELS',rows:[
      {label:'Regular',p:'panels_regular',a:'actual_panels_regular'},{label:'Long',p:'panels_long',a:'actual_panels_long'},
      {label:'1/2 Regular',p:'panels_half_regular',a:'actual_panels_half_regular'},{label:'1/2 Long',p:'panels_half_long',a:'actual_panels_half_long'},
      {label:'Center',p:'panels_center',a:'actual_panels_center'},{label:'Middle',p:'panels_middle',a:'actual_panels_middle'},
      {label:'Diamond',p:'panels_diamond',a:'actual_panels_diamond'},{label:'Bottled',p:'panels_bottled',a:'actual_panels_bottled'},
    ]},
    {label:'RAILS',rows:[
      {label:'Regular',p:'rails_regular',a:'actual_rails_regular'},{label:'Long',p:'rails_long',a:'actual_rails_long'},
      {label:'Bottom',p:'rails_bottom',a:'actual_rails_bottom'},{label:'Top',p:'rails_top',a:'actual_rails_top'},{label:'Short',p:'rails_short',a:'actual_rails_short'},
    ]},
    {label:'POST CAPS',rows:[
      {label:'Line Caps',p:'caps_line',a:'actual_caps_line'},{label:'Stop Caps',p:'caps_stop',a:'actual_caps_stop'},
    ]},
    {label:'OTHER MATERIALS',rows:[
      {label:'Cement Bags',p:'cement_bags',a:'actual_cement_bags'},{label:'Rebar',p:'rebar_count',a:'actual_rebar_count'},{label:'Silicone Tubes',p:'silicone_tubes',a:'actual_silicone_tubes'},
    ]},
  ];
  const ALL_P_FIELDS=DETAIL_GROUPS.flatMap(g=>g.rows.map(r=>r.p));
  const ALL_A_FIELDS=DETAIL_GROUPS.flatMap(g=>g.rows.map(r=>r.a));
  const ALL_FIELDS=[...ALL_P_FIELDS,...ALL_A_FIELDS,'fence_style','fence_color','fence_height'];

  const emptyCard=()=>({job_name:'',fence_style:'',fence_color:'',fence_height:'',...Object.fromEntries([...ALL_P_FIELDS,...ALL_A_FIELDS].map(f=>[f,null]))});
  const sumF=(row,fields)=>fields.reduce((s,f)=>s+(parseInt(row[f])||0),0);

  const[tab,setTab]=useState('new');
  const[reportId,setReportId]=useState(null);
  const todayISO=new Date().toISOString().slice(0,10);
  const[date,setDate]=useState(todayISO);
  const[scheduler,setScheduler]=useState('');
  const[shift,setShift]=useState('');
  const[cards,setCards]=useState(()=>Array.from({length:3},emptyCard));
  const[commentary,setCommentary]=useState({});
  const[submitting,setSubmitting]=useState(false);
  const[toast,setToast]=useState(null);
  const[expanded,setExpanded]=useState(new Set());
  const toggleCard=(i)=>setExpanded(prev=>{const n=new Set(prev);if(n.has(i))n.delete(i);else n.add(i);return n;});
  const expandAll=()=>setExpanded(new Set(cards.map((_,i)=>i)));
  const collapseAll=()=>setExpanded(new Set());

  const[reports,setReports]=useState([]);
  const[histLoading,setHistLoading]=useState(false);
  const[detailReport,setDetailReport]=useState(null);
  const[detailCards,setDetailCards]=useState([]);

  const showToast=(msg,ok)=>{setToast({msg,ok});setTimeout(()=>setToast(null),3500);};
  const updateCard=(i,field,val)=>setCards(prev=>prev.map((c,idx)=>idx===i?{...c,[field]:val}:c));
  const addCard=()=>setCards(prev=>[...prev,emptyCard()]);
  const removeCard=(i)=>{setCards(prev=>prev.filter((_,idx)=>idx!==i));setExpanded(prev=>{const n=new Set();prev.forEach(idx=>{if(idx<i)n.add(idx);else if(idx>i)n.add(idx-1);});return n;});};

  // Overall adherence
  const overallPlanned=cards.reduce((s,c)=>s+sumF(c,ALL_P_FIELDS),0);
  const overallActual=cards.reduce((s,c)=>s+sumF(c,ALL_A_FIELDS),0);
  const overallAdh=overallPlanned>0?(overallActual/overallPlanned)*100:null;

  const adhBadge=(val)=>{if(val===null||val===undefined||isNaN(val))return<span style={{...pill('#6B6056','#E5E3E0'),fontSize:11}}>—</span>;const pct=Math.round(val);const bg=pct>=90?'#3B6D11':pct>=75?'#854F0B':'#A32D2D';return<span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:bg,color:'#FFF'}}>{pct}%</span>;};
  const formatDate=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  const fetchHistory=async()=>{setHistLoading(true);try{const data=await sbGet('daily_schedule_reports','order=report_date.desc');const enriched=await Promise.all(data.map(async r=>{const rows=await sbGet('daily_schedule_rows',`report_id=eq.${r.id}&section=eq.today`);const tp=rows.reduce((s,row)=>s+sumF(row,ALL_P_FIELDS),0);const ta=rows.reduce((s,row)=>s+sumF(row,ALL_A_FIELDS),0);return{...r,adherence:tp>0?(ta/tp)*100:null};}));setReports(enriched);}catch(e){console.error(e);}setHistLoading(false);};

  const openDetail=async(id)=>{try{const rArr=await sbGet('daily_schedule_reports',`id=eq.${id}`);if(!rArr||!rArr[0])return;setDetailReport(rArr[0]);const rows=await sbGet('daily_schedule_rows',`report_id=eq.${id}&section=eq.today&order=row_order.asc`);setDetailCards(rows||[]);setReportId(id);}catch(e){console.error(e);}};

  const resetForm=()=>{setDate(todayISO);setScheduler('');setShift('');setCards(Array.from({length:3},emptyCard));setCommentary({});setExpanded(new Set());};

  const submitReport=async()=>{setSubmitting(true);try{const rpt=await sbPost('daily_schedule_reports',{report_date:date,scheduler:scheduler||null,shift:shift||null,...commentary});const rowPayloads=[];cards.forEach((c,i)=>{if(!c.job_name&&sumF(c,ALL_P_FIELDS)===0&&sumF(c,ALL_A_FIELDS)===0)return;rowPayloads.push({report_id:rpt[0].id,section:'today',row_order:i,job_name:c.job_name,fence_style:c.fence_style||null,fence_color:c.fence_color||null,fence_height:c.fence_height||null,...Object.fromEntries(ALL_P_FIELDS.map(f=>[f,parseInt(c[f])||null])),...Object.fromEntries(ALL_A_FIELDS.map(f=>[f,parseInt(c[f])||null]))});});if(rowPayloads.length>0)await sbPost('daily_schedule_rows',rowPayloads);showToast(`Production Daily Report submitted for ${date}`,true);resetForm();setTimeout(()=>{setTab('history');fetchHistory();},600);}catch(e){showToast(e.message||'Submit failed',false);}setSubmitting(false);};

  useEffect(()=>{if(tab==='history'&&!reportId)fetchHistory();},[tab,reportId]);

  // ─── Shared styles ───
  const schedBg='#EBF3FB';const actualBg='#EAF3DE';const varBg='#F9FAFB';
  const nI={width:60,padding:'3px 2px',border:'1px solid #E5E3E0',borderRadius:4,fontSize:12,textAlign:'center',background:'transparent',color:'#1A1A1A',fontFamily:'inherit'};
  const varColor=(v)=>v>0?'#3B6D11':v<0?'#A32D2D':'#9E9B96';
  const varText=(v)=>v>0?`+${v}`:v<0?`${v}`:'—';

  // ─── Render one project card ───
  const renderProjectCard=(c,i,readOnly,update,isCollapsible=false,isExp=true,onToggle=null)=>{
    const cardPlanned=sumF(c,ALL_P_FIELDS);const cardActual=sumF(c,ALL_A_FIELDS);const cardAdh=cardPlanned>0?(cardActual/cardPlanned)*100:null;
    const hasData=cardPlanned>0||cardActual>0;
    const stopProp=(e)=>e.stopPropagation();
    return(
    <div key={i} style={{...card,padding:0,marginBottom:16,overflow:'hidden'}}>
      {/* Project header */}
      <div onClick={isCollapsible&&onToggle?onToggle:undefined} style={{background:'#333',color:'#FFF',padding:'10px 16px',display:'flex',flexWrap:'wrap',gap:10,alignItems:'center',cursor:isCollapsible?'pointer':'default'}}>
        <div style={{flex:'1 1 200px'}} onClick={isCollapsible?stopProp:undefined}>{readOnly?<span style={{fontSize:14,fontWeight:700}}>{c.job_name||'—'}</span>:<input value={c.job_name||''} onChange={e=>update(i,'job_name',e.target.value)} placeholder="Project Name" style={{background:'rgba(255,255,255,0.12)',color:'#FFF',border:'1px solid rgba(255,255,255,0.25)',borderRadius:6,padding:'4px 10px',fontSize:13,fontWeight:600,width:'100%'}}/>}</div>
        <div style={{display:'flex',gap:8,alignItems:'center',fontSize:12}} onClick={isCollapsible?stopProp:undefined}>
          <span style={{color:'rgba(255,255,255,0.6)'}}>Style:</span>{readOnly?<span>{c.fence_style||'—'}</span>:<input value={c.fence_style||''} onChange={e=>update(i,'fence_style',e.target.value)} style={{background:'rgba(255,255,255,0.12)',color:'#FFF',border:'1px solid rgba(255,255,255,0.25)',borderRadius:6,padding:'3px 8px',fontSize:12,width:80}}/>}
          <span style={{color:'rgba(255,255,255,0.6)'}}>Color:</span>{readOnly?<span>{c.fence_color||'—'}</span>:<input value={c.fence_color||''} onChange={e=>update(i,'fence_color',e.target.value)} style={{background:'rgba(255,255,255,0.12)',color:'#FFF',border:'1px solid rgba(255,255,255,0.25)',borderRadius:6,padding:'3px 8px',fontSize:12,width:80}}/>}
          <span style={{color:'rgba(255,255,255,0.6)'}}>Height:</span>{readOnly?<span>{c.fence_height||'—'}</span>:<select value={c.fence_height||''} onChange={e=>update(i,'fence_height',e.target.value)} style={{background:'rgba(255,255,255,0.12)',color:'#FFF',border:'1px solid rgba(255,255,255,0.25)',borderRadius:6,padding:'3px 8px',fontSize:12}}><option value="">—</option><option value="6">6</option><option value="8">8</option><option value="10">10</option><option value="12">12</option><option value="Other">Other</option></select>}
        </div>
        {isCollapsible&&<div style={{display:'flex',gap:8,alignItems:'center',fontSize:12,color:'rgba(255,255,255,0.7)',marginLeft:8}}>
          {hasData?<><span>Planned: <b style={{color:'#FFF'}}>{cardPlanned}</b></span><span style={{opacity:0.4}}>|</span><span>Actual: <b style={{color:'#FFF'}}>{cardActual}</b></span><span style={{opacity:0.4}}>|</span>{adhBadge(cardAdh)}</>:<span style={{fontStyle:'italic'}}>No data entered</span>}
        </div>}
        {!readOnly&&cards.length>1&&<button onClick={(e)=>{e.stopPropagation();removeCard(i);}} title="Remove" style={{background:'none',border:'none',color:'rgba(255,255,255,0.5)',fontSize:18,cursor:'pointer',padding:'0 4px'}}>×</button>}
        {isCollapsible&&<span style={{fontSize:12,color:'rgba(255,255,255,0.5)',flexShrink:0,marginLeft:4,transition:'transform 0.3s ease',display:'inline-block',transform:isExp?'rotate(0deg)':'rotate(-90deg)'}}>▼</span>}
      </div>
      {/* Table */}
      <div style={{maxHeight:(!isCollapsible||isExp)?'5000px':'0',overflow:'hidden',transition:'max-height 0.3s ease-in-out'}}>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>
          <th style={{padding:'6px 12px',fontSize:11,fontWeight:600,color:'#6B6056',textAlign:'left',borderBottom:'2px solid #E5E3E0',width:140}}></th>
          <th style={{padding:'6px 8px',fontSize:11,fontWeight:700,color:'#185FA5',textAlign:'center',borderBottom:'2px solid #E5E3E0',background:schedBg,width:80}}>Planned</th>
          <th style={{padding:'6px 8px',fontSize:11,fontWeight:700,color:'#3B6D11',textAlign:'center',borderBottom:'2px solid #E5E3E0',background:actualBg,width:80}}>Actual</th>
          <th style={{padding:'6px 8px',fontSize:11,fontWeight:700,color:'#6B6056',textAlign:'center',borderBottom:'2px solid #E5E3E0',background:varBg,width:70}}>Variance</th>
        </tr></thead>
        <tbody>
          {DETAIL_GROUPS.map(g=>{
            const gp=g.rows.reduce((s,r)=>s+(parseInt(c[r.p])||0),0);
            const ga=g.rows.reduce((s,r)=>s+(parseInt(c[r.a])||0),0);
            const gv=ga-gp;
            return<React.Fragment key={g.label}>
              <tr><td colSpan={4} style={{padding:'8px 12px 4px',fontSize:10,fontWeight:700,color:'#8B2020',textTransform:'uppercase',letterSpacing:1,borderBottom:'1px solid #E5E3E0',background:'#FAFAF8'}}>{g.label}</td></tr>
              {g.rows.map(r=>{const pv=parseInt(c[r.p])||0;const av=parseInt(c[r.a])||0;const v=av-pv;return<tr key={r.p}>
                <td style={{padding:'3px 12px',fontSize:12,color:'#6B6056',borderBottom:'1px solid #F4F4F2'}}>{r.label}</td>
                <td style={{padding:'3px 4px',textAlign:'center',borderBottom:'1px solid #F4F4F2',background:schedBg}}>{readOnly?<span style={{fontSize:12,fontWeight:500}}>{pv||'—'}</span>:<input type="number" min="0" value={c[r.p]??''} onChange={e=>update(i,r.p,e.target.value)} style={{...nI,background:'transparent'}}/>}</td>
                <td style={{padding:'3px 4px',textAlign:'center',borderBottom:'1px solid #F4F4F2',background:actualBg}}>{readOnly?<span style={{fontSize:12,fontWeight:500}}>{av||'—'}</span>:<input type="number" min="0" value={c[r.a]??''} onChange={e=>update(i,r.a,e.target.value)} style={{...nI,background:'transparent'}}/>}</td>
                <td style={{padding:'3px 4px',textAlign:'center',borderBottom:'1px solid #F4F4F2',background:varBg,fontWeight:600,fontSize:12,color:varColor(v)}}>{varText(v)}</td>
              </tr>;})}
              <tr style={{fontWeight:700,background:'#F3F4F6'}}><td style={{padding:'4px 12px',fontSize:11,borderBottom:'2px solid #E5E3E0'}}>TOTAL {g.label}</td><td style={{padding:'4px 4px',textAlign:'center',fontSize:12,borderBottom:'2px solid #E5E3E0',background:schedBg}}>{gp}</td><td style={{padding:'4px 4px',textAlign:'center',fontSize:12,borderBottom:'2px solid #E5E3E0',background:actualBg}}>{ga}</td><td style={{padding:'4px 4px',textAlign:'center',fontSize:12,borderBottom:'2px solid #E5E3E0',background:varBg,color:varColor(gv)}}>{varText(gv)}</td></tr>
            </React.Fragment>;
          })}
          <tr style={{fontWeight:700,background:'#EEEDEB'}}><td style={{padding:'8px 12px',fontSize:13}}>TOTAL ALL PIECES</td><td style={{padding:'8px 4px',textAlign:'center',fontSize:14,fontWeight:800,color:'#185FA5',background:schedBg}}>{cardPlanned}</td><td style={{padding:'8px 4px',textAlign:'center',fontSize:14,fontWeight:800,color:'#3B6D11',background:actualBg}}>{cardActual}</td><td style={{padding:'8px 4px',textAlign:'center',fontSize:13,fontWeight:700,background:varBg}}>{adhBadge(cardAdh)}</td></tr>
        </tbody>
      </table></div>
      </div>
    </div>);
  };

  // ─── DETAIL VIEW ───
  if(tab==='history'&&reportId&&detailReport){
    const dtPlanned=detailCards.reduce((s,c)=>s+sumF(c,ALL_P_FIELDS),0);
    const dtActual=detailCards.reduce((s,c)=>s+sumF(c,ALL_A_FIELDS),0);
    const dtAdh=dtPlanned>0?(dtActual/dtPlanned)*100:null;
    return(<div>
      {toast&&<div style={{position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',background:toast.ok?'#3B6D11':'#A32D2D',color:'#fff',padding:'8px 20px',borderRadius:20,fontSize:13,fontWeight:600,zIndex:9999}}>{toast.msg}</div>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <button onClick={()=>setReportId(null)} style={{background:'none',border:'none',color:'#8B2020',fontSize:13,fontWeight:600,cursor:'pointer'}}>← Back to History</button>
        <span style={{fontSize:12,color:'#9E9B96'}}>Submitted {detailReport.submitted_at?new Date(detailReport.submitted_at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):''}</span>
      </div>
      <div style={{background:'#8B2020',borderRadius:12,padding:16,marginBottom:16,display:'flex',gap:24,alignItems:'center',flexWrap:'wrap'}}>
        <div><div style={{fontSize:10,color:'rgba(255,255,255,0.7)'}}>Date</div><div style={{color:'#FFF',fontSize:13,fontWeight:600}}>{formatDate(detailReport.report_date)}</div></div>
        <div><div style={{fontSize:10,color:'rgba(255,255,255,0.7)'}}>Scheduler</div><div style={{color:'#FFF',fontSize:13,fontWeight:600}}>{detailReport.scheduler||'—'}</div></div>
        <div><div style={{fontSize:10,color:'rgba(255,255,255,0.7)'}}>Shift</div><div style={{color:'#FFF',fontSize:13,fontWeight:600}}>{detailReport.shift||'—'}</div></div>
        <div style={{marginLeft:'auto'}}><div style={{fontSize:10,color:'rgba(255,255,255,0.7)'}}>Overall Adherence</div><div>{adhBadge(dtAdh)}</div></div>
      </div>
      {detailCards.map((c,i)=>renderProjectCard(c,i,true,()=>{}))}
      {detailCards.length===0&&<div style={{textAlign:'center',color:'#9E9B96',padding:40}}>No project data in this report.</div>}
      {/* Commentary read-only */}
      <div style={{...card,padding:0,overflow:'hidden'}}>
        <div style={{background:'#854F0B',color:'#FFF',padding:'8px 16px',fontWeight:700,fontSize:13}}>Constraints, Readiness & Commentary</div>
        <div style={{padding:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {[{k:'blockers',l:'Schedule Blockers / Constraints',full:true},{k:'labor_readiness',l:'Labor Readiness for Tomorrow'},{k:'material_readiness',l:'Material Readiness for Tomorrow'},{k:'equipment_status',l:'Equipment Status'},{k:'scheduling_conflicts',l:'Scheduling Conflicts / Reprioritizations'},{k:'other_comments',l:'Other Comments',full:true}].map(f=><div key={f.k} style={f.full?{gridColumn:'1 / -1'}:{}}><div style={{fontSize:11,fontWeight:700,color:'#6B6056',marginBottom:4}}>{f.l}</div><div style={{fontSize:13,color:'#1A1A1A',background:'#FAFAF8',borderRadius:8,padding:10,minHeight:48,whiteSpace:'pre-wrap'}}>{detailReport[f.k]||'—'}</div></div>)}
        </div>
      </div>
    </div>);
  }

  // ─── HISTORY VIEW ───
  if(tab==='history'){
    return(<div>
      {toast&&<div style={{position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',background:toast.ok?'#3B6D11':'#A32D2D',color:'#fff',padding:'8px 20px',borderRadius:20,fontSize:13,fontWeight:600,zIndex:9999}}>{toast.msg}</div>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Production Daily Report</h1>
        <div style={{display:'flex',gap:8}}><button onClick={()=>setTab('new')} style={gpill(tab==='new')}>+ New Report</button><button onClick={()=>setTab('history')} style={gpill(tab==='history')}>History</button></div>
      </div>
      {histLoading?<div style={{textAlign:'center',color:'#9E9B96',padding:40}}>Loading...</div>:reports.length===0?<div style={{textAlign:'center',color:'#9E9B96',padding:40}}>No reports submitted yet. Start with New Report.</div>:<div style={{display:'flex',flexDirection:'column',gap:12}}>
        {reports.map(r=><div key={r.id} style={{...card,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><div style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{formatDate(r.report_date)}</div><div style={{fontSize:12,color:'#6B6056',marginTop:2}}>{r.scheduler||'—'} | {r.shift||'—'}</div></div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>{adhBadge(r.adherence)}<button onClick={()=>openDetail(r.id)} style={{fontSize:12,fontWeight:600,color:'#8B2020',background:'none',border:'none',cursor:'pointer'}}>View Report →</button></div>
        </div>)}
      </div>}
    </div>);
  }

  // ─── NEW REPORT VIEW ───
  return(<div>
    {toast&&<div style={{position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',background:toast.ok?'#3B6D11':'#A32D2D',color:'#fff',padding:'8px 20px',borderRadius:20,fontSize:13,fontWeight:600,zIndex:9999}}>{toast.msg}</div>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Production Daily Report</h1>
      <div style={{display:'flex',gap:8}}><button onClick={()=>setTab('new')} style={gpill(tab==='new')}>+ New Report</button><button onClick={()=>{setTab('history');fetchHistory();}} style={gpill(tab==='history')}>History</button></div>
    </div>

    {/* Header bar */}
    <div style={{background:'#8B2020',borderRadius:12,padding:16,marginBottom:16,display:'flex',flexWrap:'wrap',gap:16,alignItems:'center'}}>
      <div style={{color:'#FFF',flex:'1 1 100%',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div style={{fontFamily:'Syne',fontSize:18,fontWeight:800}}>Production Daily Report</div><div style={{fontSize:12,opacity:0.8}}>Fencecrete America — San Antonio Plant</div></div><div>{adhBadge(overallAdh)}<span style={{fontSize:10,color:'rgba(255,255,255,0.7)',marginLeft:6}}>Overall</span></div></div>
      <div><div style={{fontSize:10,color:'rgba(255,255,255,0.7)',marginBottom:2}}>Date</div><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{background:'rgba(255,255,255,0.15)',color:'#FFF',border:'1px solid rgba(255,255,255,0.3)',borderRadius:6,padding:'4px 8px',fontSize:12}}/></div>
      <div><div style={{fontSize:10,color:'rgba(255,255,255,0.7)',marginBottom:2}}>Scheduler</div><input value={scheduler} onChange={e=>setScheduler(e.target.value)} placeholder="Max" style={{background:'rgba(255,255,255,0.15)',color:'#FFF',border:'1px solid rgba(255,255,255,0.3)',borderRadius:6,padding:'4px 8px',fontSize:12}}/></div>
      <div><div style={{fontSize:10,color:'rgba(255,255,255,0.7)',marginBottom:2}}>Shift</div><input value={shift} onChange={e=>setShift(e.target.value)} placeholder="Day / Eve" style={{background:'rgba(255,255,255,0.15)',color:'#FFF',border:'1px solid rgba(255,255,255,0.3)',borderRadius:6,padding:'4px 8px',fontSize:12}}/></div>
    </div>

    {/* Project cards */}
    <div style={{display:'flex',gap:8,marginBottom:12}}>
      <button onClick={addCard} style={{padding:'6px 14px',borderRadius:8,border:'2px dashed #D1CEC9',background:'transparent',color:'#8B2020',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'Syne'}}>+ Add Project</button>
      <button onClick={expandAll} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #D1CEC9',background:'#FFF',color:'#6B6056',fontSize:12,fontWeight:600,cursor:'pointer'}}>Expand All</button>
      <button onClick={collapseAll} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #D1CEC9',background:'#FFF',color:'#6B6056',fontSize:12,fontWeight:600,cursor:'pointer'}}>Collapse All</button>
    </div>
    {cards.map((c,i)=>renderProjectCard(c,i,false,updateCard,true,expanded.has(i),()=>toggleCard(i)))}

    {/* Commentary */}
    <div style={{...card,padding:0,marginBottom:16,overflow:'hidden'}}>
      <div style={{background:'#854F0B',color:'#FFF',padding:'8px 16px',fontWeight:700,fontSize:13}}>Constraints, Readiness & Commentary</div>
      <div style={{padding:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        {[{k:'blockers',l:'Schedule Blockers / Constraints',h:'What prevented hitting today\'s schedule',full:true},{k:'labor_readiness',l:'Labor Readiness for Tomorrow',h:'Headcount confirmed, gaps, call-outs expected'},{k:'material_readiness',l:'Material Readiness for Tomorrow',h:'Any shortages, deliveries pending'},{k:'equipment_status',l:'Equipment Status',h:'Down units, expected return'},{k:'scheduling_conflicts',l:'Scheduling Conflicts / Reprioritizations',h:''},{k:'other_comments',l:'Other Comments',h:'',full:true}].map(f=><div key={f.k} style={f.full?{gridColumn:'1 / -1'}:{}}>
          <label style={{display:'block',fontSize:11,fontWeight:700,color:'#6B6056',marginBottom:4}}>{f.l}</label>
          <textarea value={commentary[f.k]||''} onChange={e=>setCommentary(prev=>({...prev,[f.k]:e.target.value}))} placeholder={f.h} rows={3} style={{...inputS,resize:'vertical',minHeight:56}}/>
        </div>)}
      </div>
    </div>

    {/* Submit footer */}
    <div style={{...card,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
      <div style={{fontSize:11,color:'#9E9B96'}}>Submit by end of shift | Archive: SharePoint &gt; Production &gt; Scheduling &gt; YYYY-MM</div>
      <button onClick={submitReport} disabled={submitting} style={{...btnP,opacity:submitting?0.5:1}}>{submitting?'Submitting...':'Submit Report'}</button>
    </div>
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
  const[mktF,setMktF]=useState(null);const[pmF,setPmF]=useState('');const[statusF,setStatusF]=useState(null);
  const fetchOrders=useCallback(async()=>{const d=await sbGet('change_orders','order=created_at.desc');setOrders(d||[]);setLoading(false);},[]);
  useEffect(()=>{fetchOrders();},[fetchOrders]);
  const filtered=useMemo(()=>{let f=orders;if(mktF)f=f.filter(o=>o.market===mktF);if(pmF)f=f.filter(o=>o.pm===pmF);if(statusF)f=f.filter(o=>o.status===statusF);return f;},[orders,mktF,pmF,statusF]);
  const coStatusC={Pending:['#B45309','#FEF3C7'],Approved:['#065F46','#D1FAE5'],Rejected:['#991B1B','#FEE2E2']};
  return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Change Orders</h1>
    <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
      <select value={mktF||''} onChange={e=>setMktF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Markets</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select>
      <select value={pmF} onChange={e=>setPmF(e.target.value)} style={{...inputS,width:160}}><option value="">All PMs</option>{PM_LIST.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
      <select value={statusF||''} onChange={e=>setStatusF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Statuses</option>{['Pending','Approved','Rejected'].map(s=><option key={s} value={s}>{s}</option>)}</select>
      <span style={{fontSize:12,color:'#6B6056'}}>{filtered.length} change orders</span>
    </div>
    {loading?<div style={{color:'#9E9B96',padding:40,textAlign:'center'}}>Loading...</div>:<div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 280px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Job','CO#','Date','Amount','Description','Status','PM','Market'].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map(o=>{const[sc2,sb2]=coStatusC[o.status]||['#6B6056','#F4F4F2'];return<tr key={o.id} style={{borderBottom:'1px solid #F4F4F2'}}>
          <td style={{padding:'8px 10px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.job_name||'—'}</td>
          <td style={{padding:'8px 10px'}}>{o.co_number||'—'}</td>
          <td style={{padding:'8px 10px'}}>{fD(o.date)}</td>
          <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(o.amount)}</td>
          <td style={{padding:'8px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6B6056'}}>{o.description||'—'}</td>
          <td style={{padding:'8px 10px'}}><span style={pill(sc2,sb2)}>{o.status||'—'}</span></td>
          <td style={{padding:'8px 10px'}}>{o.pm||'—'}</td>
          <td style={{padding:'8px 10px'}}><span style={pill(MC[o.market]||'#6B6056',MB[o.market]||'#F4F4F2')}>{MS[o.market]||'—'}</span></td>
        </tr>;})}
        {filtered.length===0&&<tr><td colSpan={8} style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>±</div><div style={{color:'#9E9B96',fontSize:14}}>No change orders found</div></td></tr>}</tbody></table>
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
const NAV_GROUPS=[
  {label:'Overview',items:[{key:'dashboard',label:'Dashboard',icon:'▣'},{key:'map',label:'Map',icon:'📍'}]},
  {label:'Sales',items:[{key:'estimating',label:'Estimating',icon:'📊'},{key:'projects',label:'Projects',icon:'◧'}]},
  {label:'Operations',items:[{key:'production',label:'Production',icon:'⚙'},{key:'schedule',label:'Schedule',icon:'◷'},{key:'weather_days',label:'Weather Days',icon:'☁'}]},
  {label:'Finance',items:[{key:'billing',label:'Billing',icon:'$'},{key:'pm_billing',label:'PM Bill Sheet',icon:'◧'},{key:'change_orders',label:'Change Orders',icon:'±'}]},
  {label:'Field',items:[{key:'pm_daily_report',label:'PM Daily Report',icon:'📋'},{key:'daily_report',label:'Production Daily Report',icon:'📋'}]},
  {label:'Reports',items:[{key:'reports',label:'Reports',icon:'◑'}]}
];

export default function App(){
  const[page,setPage]=useState('dashboard');const[jobs,setJobs]=useState([]);const[loading,setLoading]=useState(true);const[openJob,setOpenJob]=useState(null);const[showSearch,setShowSearch]=useState(false);const[sideCollapsed,setSideCollapsed]=useState(false);
  const fetchJobs=useCallback(async()=>{try{const d=await sbGet('jobs','select=*&order=created_at.desc');setJobs(d||[]);}catch(e){console.error(e);}setLoading(false);},[]);
  useEffect(()=>{fetchJobs();},[fetchJobs]);
  const live=useRealtime(setJobs);
  const isMobile=typeof window!=='undefined'&&window.innerWidth<768;
  const sideW=sideCollapsed||isMobile?48:220;
  return(
    <div style={{display:'flex',height:'100vh',overflow:'hidden',width:'100%'}}>
      <style>{`@media(max-width:768px){input,select,textarea{min-height:48px!important;font-size:16px!important}}`}</style>
      <div style={{width:sideW,minWidth:sideW,maxWidth:sideW,flexShrink:0,background:'#1A1A1A',borderRight:'1px solid #2A2A2A',display:'flex',flexDirection:'column',overflow:'hidden',transition:'width .2s'}}>
        <div style={{padding:sideCollapsed?'16px 8px':'24px 20px 20px',textAlign:sideCollapsed?'center':'left'}}>
          {!sideCollapsed&&<><div style={{fontFamily:'Syne',fontSize:16,fontWeight:900,color:'#8B2020',whiteSpace:'nowrap',overflow:'hidden'}}>FENCECRETE</div><div style={{fontSize:10,color:'#9E9B96',letterSpacing:2,textTransform:'uppercase',whiteSpace:'nowrap'}}>Operations</div></>}
          {sideCollapsed&&<div style={{fontFamily:'Syne',fontSize:14,fontWeight:900,color:'#8B2020'}}>F</div>}
        </div>
        <nav style={{flex:1,padding:sideCollapsed?'0 4px':'0 8px',overflow:'auto'}}>{NAV_GROUPS.map(g=><div key={g.label}>{!sideCollapsed&&<div style={{fontSize:10,color:'#6B7280',textTransform:'uppercase',letterSpacing:1,fontWeight:600,padding:'12px 12px 4px'}}>{g.label}</div>}{sideCollapsed&&<div style={{borderTop:'1px solid #2A2A2A',margin:'6px 4px'}}/>}{g.items.map(ni=><button key={ni.key} onClick={()=>setPage(ni.key)} title={ni.label} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:sideCollapsed?'10px 0':'10px 12px',marginBottom:2,borderRadius:8,border:'none',background:page===ni.key?'#8B202018':'transparent',color:page===ni.key?'#8B2020':'#9E9B96',fontSize:14,fontWeight:page===ni.key?600:400,cursor:'pointer',textAlign:'left',justifyContent:sideCollapsed?'center':'flex-start',borderLeft:page===ni.key?'3px solid #8B2020':'3px solid transparent'}}><span style={{fontSize:16,width:20,textAlign:'center'}}>{ni.icon}</span>{!sideCollapsed&&ni.label}</button>)}</div>)}</nav>
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
            {page==='production'&&<ProductionPage jobs={jobs} setJobs={setJobs} onRefresh={fetchJobs}/>}
            {page==='reports'&&<ReportsPage jobs={jobs}/>}
            {page==='change_orders'&&<ChangeOrdersPage jobs={jobs}/>}
            {page==='schedule'&&<SchedulePage jobs={jobs}/>}
            {page==='weather_days'&&<WeatherDaysPage jobs={jobs}/>}
            {page==='pm_daily_report'&&<PMDailyReportPage jobs={jobs}/>}
            {page==='daily_report'&&<DailyReportPage/>}
          </>}
        </div>
      </div>
      {showSearch&&<GlobalSearch jobs={jobs} onSelect={j=>{setOpenJob(j);setPage('projects');setShowSearch(false);}}/>}
    </div>
  );
}
