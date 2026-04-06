import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';

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
const relT = d => { if(!d) return '—'; const ms=Date.now()-new Date(d).getTime(), m=ms/60000; if(m<60) return `${Math.floor(m)}m ago`; const h=m/60; if(h<24) return `${Math.floor(h)}h ago`; const dy=h/24; if(dy<2) return 'Yesterday'; if(dy<7) return `${Math.floor(dy)}d ago`; return fD(d); };

const STS = ['contract_review','production_queue','in_production','complete'];
const SL = { contract_review:'Contract Review', production_queue:'Production Queue', in_production:'In Production', complete:'Complete' };
const SC = { contract_review:'#B45309', production_queue:'#1D4ED8', in_production:'#6D28D9', complete:'#065F46' };
const SB_ = { contract_review:'#FEF3C7', production_queue:'#DBEAFE', in_production:'#EDE9FE', complete:'#D1FAE5' };
const SS = { contract_review:'Review', production_queue:'Prod Queue', in_production:'In Prod', complete:'Complete' };
const MKTS = ['Austin','Dallas-Fort Worth','Houston','San Antonio'];
const MC = { Austin:'#C2410C', 'Dallas-Fort Worth':'#1D4ED8', Houston:'#065F46', 'San Antonio':'#9D174D' };
const MB = { Austin:'#FED7AA', 'Dallas-Fort Worth':'#DBEAFE', Houston:'#D1FAE5', 'San Antonio':'#FCE7F3' };
const MS = { Austin:'Austin', 'Dallas-Fort Worth':'DFW', Houston:'Houston', 'San Antonio':'SA' };
const REPS = ['Matt','Laura','Yuda','Nathan','Ryne'];
const DD = { status:STS.map(s=>({v:s,l:SL[s]})), market:MKTS.map(m=>({v:m,l:m})), fence_type:['PC','SW','PC/Gates','PC/Columns','PC/SW','PC/WI','SW/Columns','SW/Gate','SW/WI','WI','WI/Gate','Wood','PC/SW/Columns','SW/Columns/Gates','Slab','LABOR'].map(v=>({v,l:v})), style:['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'].map(v=>({v,l:v})), style_single_wythe:['Rock Style','Vertical Wood','Split Face CMU Block','Boxwood','Brick Style','Rock Z Panel','Smooth','Stucco','Horizontal B&B','Ledgestone','Used Brick Style','Combo Vert./Horizontal'].map(v=>({v,l:v})), color:['LAC','Painted','10#61078','Café','Adobe','8#860','Regular Brown','Outback','Silversmoke 8085','Green','Stain','10#860','8#677','3.5#860','1.5#860','Dune 6058','Sandstone 5237','Pebble 641','No Color','Other'].map(v=>({v,l:v})), billing_method:['Progress','Lump Sum','Milestone','T&M','AIA'].map(v=>({v,l:v})), job_type:['Commercial','Residential','Government','Industrial','Private','Public'].map(v=>({v,l:v})), sales_rep:REPS.map(v=>({v,l:v})) };
const NEXT_STATUS = { contract_review:'production_queue', production_queue:'in_production', in_production:'complete' };

/* ═══ STYLES ═══ */
const card = { background:'#FFF', border:'1px solid #E5E3E0', borderRadius:12, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' };
const inputS = { width:'100%', padding:'8px 12px', background:'#FFF', border:'1px solid #D1CEC9', borderRadius:8, color:'#1A1A1A', fontSize:13 };
const btnP = { padding:'8px 16px', background:'#8B2020', border:'none', borderRadius:8, color:'#fff', fontWeight:600, cursor:'pointer', fontSize:13 };
const btnS = { ...btnP, background:'#F4F4F2', color:'#6B6056', border:'1px solid #E5E3E0' };
const pill = (c,bg) => ({ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:bg||(c+'18'), color:c });
const gpill = a => ({ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', border:a?'1px solid #8B2020':'1px solid #E5E3E0', background:a?'#FDF4F4':'#FFF', color:a?'#8B2020':'#6B6056' });
const fpill = a => ({ padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', border:a?'1px solid #8B2020':'1px solid #E5E3E0', background:a?'#FDF4F4':'#FFF', color:a?'#8B2020':'#9E9B96' });

/* ═══ SHARED ═══ */
function Toast({message,onDone}){useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[onDone]);return<div style={{position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',background:'#8B2020',color:'#fff',padding:'8px 20px',borderRadius:20,fontSize:13,fontWeight:600,zIndex:9999}}>{message}</div>;}
function KPI({label,value,color='#8B2020'}){return<div style={card}><div style={{fontFamily:'Syne',fontSize:28,fontWeight:800,color}}>{value}</div><div style={{fontSize:12,color:'#6B6056',marginTop:4}}>{label}</div></div>;}
function PBar({pct:p,color='#8B2020',h=6}){return<div style={{height:h,background:'#E5E3E0',borderRadius:h,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(Math.max(p,0),100)}%`,background:color,borderRadius:h,transition:'width .3s'}}/></div>;}
const spSearch=jn=>`https://fencecrete0.sharepoint.com/sites/ProjectManager/_layouts/15/search.aspx?q=${encodeURIComponent(jn)}&scope=All`;
const SP_MKT={Austin:'Austin','Dallas-Fort Worth':'Dallas',Houston:'Houston','San Antonio':'San%20Antonio'};
const spFolder=mkt=>`https://fencecrete0.sharepoint.com/sites/ProjectManager/Shared%20Documents/Active%20Jobs/${SP_MKT[mkt]||''}`;
function renderCell(j,k){const v=j[k];if(k==='sharepoint')return j.job_number?<a href={spSearch(j.job_number)} target="_blank" rel="noopener noreferrer" style={{color:'#0078D4',textDecoration:'none',fontSize:18}} title="Open in SharePoint" onClick={e=>e.stopPropagation()}>📁</a>:<span style={{color:'#9E9B96'}}>—</span>;if(k==='status')return<span style={pill(SC[v]||'#6B6056',SB_[v]||'#F4F4F2')}>{SS[v]||v}</span>;if(k==='market')return<span style={pill(MC[v]||'#6B6056',MB[v]||'#F4F4F2')}>{MS[v]||v||'—'}</span>;if(['adj_contract_value','contract_value','left_to_bill','ytd_invoiced','net_contract_value'].includes(k))return<span style={{fontFamily:'Inter',fontWeight:700,fontSize:12,color:k==='left_to_bill'?(n(v)>100000?'#991B1B':n(v)>50000?'#B45309':'#065F46'):'#1A1A1A'}}>{$(v)}</span>;if(k==='pct_billed')return<span>{n(v)}%</span>;if(k==='total_lf')return<span>{n(v).toLocaleString()}</span>;if(['contract_date','last_billed','est_start_date','active_entry_date','complete_date'].includes(k))return fD(v);return v||'—';}

/* ═══ COLUMNS ═══ */
const ALL_COLS=[{key:'status',label:'Status',w:130},{key:'market',label:'Location',w:110},{key:'job_number',label:'Project Code',w:100},{key:'sharepoint',label:'SharePoint',w:90},{key:'included_on_billing_schedule',label:'Billing Sched.',w:100},{key:'included_on_lf_schedule',label:'LF Sched.',w:90},{key:'job_name',label:'Project Name',w:220},{key:'customer_name',label:'Customer',w:180},{key:'cust_number',label:'Cust #',w:80},{key:'fence_type',label:'Fence Type',w:100},{key:'documents_needed',label:'Docs Needed',w:140},{key:'file_location',label:'File Location',w:110},{key:'billing_method',label:'Billing Method',w:110},{key:'billing_date',label:'Billing Date',w:90},{key:'sales_rep',label:'Sales Rep',w:80},{key:'job_type',label:'Type',w:80},{key:'address',label:'Address',w:180},{key:'city',label:'City',w:100},{key:'state',label:'State',w:60},{key:'zip',label:'ZIP',w:70},{key:'lf_precast',label:'LF - Precast',w:90},{key:'height_precast',label:'Height - Precast',w:110},{key:'style',label:'Style - Precast',w:140},{key:'color',label:'Color - Precast',w:120},{key:'contract_rate_precast',label:'Rate - Precast',w:110},{key:'lf_single_wythe',label:'LF - Single Wythe',w:120},{key:'height_single_wythe',label:'Height - SW',w:90},{key:'contract_rate_single_wythe',label:'Rate - SW',w:90},{key:'style_single_wythe',label:'Style - SW',w:110},{key:'lf_wrought_iron',label:'LF - Wrought Iron',w:120},{key:'height_wrought_iron',label:'Height - WI',w:90},{key:'contract_rate_wrought_iron',label:'Rate - WI',w:90},{key:'lf_removal',label:'LF - Removal',w:100},{key:'height_removal',label:'Height - Removal',w:110},{key:'removal_material_type',label:'Removal Material',w:130},{key:'contract_rate_removal',label:'Rate - Removal',w:110},{key:'lf_other',label:'LF - Other',w:90},{key:'height_other',label:'Height - Other',w:100},{key:'other_material_type',label:'Other Material',w:120},{key:'contract_rate_other',label:'Rate - Other',w:100},{key:'number_of_gates',label:'# Gates',w:70},{key:'gate_height',label:'Gate Height',w:90},{key:'gate_description',label:'Gate Description',w:140},{key:'gate_rate',label:'Gate Rate',w:90},{key:'lump_sum_amount',label:'Lump Sum Amt',w:110},{key:'lump_sum_description',label:'Lump Sum Desc',w:150},{key:'total_lf',label:'Total LF Installed',w:130},{key:'average_height_installed',label:'Avg Height Installed',w:140},{key:'total_lf_removed',label:'Total LF Removed',w:130},{key:'average_height_removed',label:'Avg Height Removed',w:140},{key:'net_contract_value',label:'Net Contract Value',w:140},{key:'sales_tax',label:'Sales Tax',w:90},{key:'contract_value',label:'Contract Value',w:120},{key:'change_orders',label:'Change Orders',w:120},{key:'adj_contract_value',label:'Adj. Contract Value',w:140},{key:'contract_value_recalculation',label:'CV Recalc',w:100},{key:'contract_value_recalc_diff',label:'CV Recalc Diff',w:110},{key:'ytd_invoiced',label:'YTD Invoiced',w:110},{key:'pct_billed',label:'% Billed',w:80},{key:'left_to_bill',label:'Left to Bill',w:110},{key:'last_billed',label:'Last Billed',w:100},{key:'contract_date',label:'Contract Date',w:110},{key:'contract_month',label:'Contract Month',w:120},{key:'est_start_date',label:'Est. Start Date',w:120},{key:'start_month',label:'Start Month',w:100},{key:'contract_age',label:'Contract Age',w:100},{key:'active_entry_date',label:'Active Entry Date',w:130},{key:'complete_date',label:'Complete Date',w:110},{key:'complete_month',label:'Complete Month',w:120},{key:'notes',label:'Notes',w:220}];
const DEF_VIS=['status','market','job_number','sharepoint','job_name','customer_name','fence_type','sales_rep','adj_contract_value','left_to_bill','pct_billed','total_lf','contract_date','est_start_date','last_billed','notes'];

const SECS=[{key:'contract',label:'Contract & Billing',fields:['net_contract_value','sales_tax','contract_value','change_orders','adj_contract_value','ytd_invoiced','last_billed','billing_method','billing_date'],computed:['pct_billed','left_to_bill']},{key:'precast',label:'Precast',fields:['lf_precast','height_precast','style','color','contract_rate_precast']},{key:'wythe',label:'Single Wythe',fields:['lf_single_wythe','height_single_wythe','style_single_wythe','contract_rate_single_wythe']},{key:'iron',label:'Wrought Iron',fields:['lf_wrought_iron','height_wrought_iron','contract_rate_wrought_iron']},{key:'removal',label:'Removal',fields:['lf_removal','height_removal','removal_material_type','contract_rate_removal']},{key:'other',label:'Other/Lump',fields:['lf_other','height_other','other_material_type','contract_rate_other','lump_sum_amount','lump_sum_description']},{key:'gates',label:'Gates',fields:['number_of_gates','gate_height','gate_description','gate_rate']},{key:'totals',label:'Totals',fields:['total_lf','average_height_installed','total_lf_removed','product','fence_type']},{key:'details',label:'Details',fields:['sales_rep','job_type','documents_needed','file_location','address','city','state','zip','cust_number']},{key:'dates',label:'Dates',fields:['contract_date','contract_month','est_start_date','start_month','contract_age','active_entry_date','complete_date','complete_month']},{key:'notes',label:'Notes',fields:['notes']},{key:'co',label:'Change Orders',fields:['change_orders','contract_value_recalculation','contract_value_recalc_diff']},{key:'history',label:'History',fields:[]}];

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
  const handleSave=async()=>{setSaving(true);if(isNew){const{id,created_at,updated_at,...rest}=form;if(!rest.job_name){setSaving(false);return;}if(!rest.status)rest.status='contract_review';const saved=await sbPost('jobs',rest);if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',saved[0].job_number);}}else{const{id,created_at,updated_at,...rest}=form;await sbPatch('jobs',job.id,rest);fireAlert('job_updated',{id:job.id,...rest});logAct(job,'field_update','multiple_fields','','saved');}setSaving(false);onSaved(isNew?'Project created':'Project saved');};
  const handleDup=async()=>{const{id,created_at,updated_at,job_number,...rest}=form;rest.ytd_invoiced=0;rest.pct_billed=0;rest.left_to_bill=n(rest.adj_contract_value||rest.contract_value);rest.status='contract_review';rest.job_number='';const saved=await sbPost('jobs',rest);if(saved&&saved[0]){fireAlert('new_job',saved[0]);logAct(saved[0],'job_created','','',`Duplicated from ${job.job_number}`);}onSaved('Project duplicated');};
  const sec=SECS.find(s=>s.key===tab);const adjCV=n(form.adj_contract_value||form.contract_value);
  return(
    <div style={{position:'fixed',top:0,right:0,bottom:0,width:Math.min(540,window.innerWidth),background:'#FFF',borderLeft:'1px solid #E5E3E0',zIndex:200,display:'flex',flexDirection:'column',boxShadow:'-8px 0 30px rgba(0,0,0,.1)'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid #E5E3E0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,background:'#F9F8F6'}}>
        <div><div style={{fontFamily:'Inter',fontSize:16,fontWeight:800}}>{isNew?'New Project':(form.job_name||'Untitled')}</div><div style={{fontSize:12,color:'#6B6056'}}>{isNew?'Fill in details':`#${form.job_number} · ${form.customer_name}`}</div></div>
        <div style={{display:'flex',gap:8}}>{!isNew&&form.job_number&&<a href={spSearch(form.job_number)} target="_blank" rel="noopener noreferrer" style={{...btnP,background:'#0078D4',textDecoration:'none',display:'flex',alignItems:'center',gap:4,fontSize:12}}>📁 SharePoint</a>}<button onClick={handleSave} disabled={saving} style={{...btnP,background:isNew?'#065F46':'#8B2020'}}>{saving?'Saving...':isNew?'Create':'Save'}</button><button onClick={onClose} style={btnS}>Close</button></div>
      </div>
      {!isNew&&form.market&&SP_MKT[form.market]&&<div style={{padding:'6px 20px',borderBottom:'1px solid #E5E3E0',background:'#F9F8F6'}}><a href={spFolder(form.market)} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#0078D4',textDecoration:'none',fontWeight:500}}>Browse {form.market} folder →</a></div>}
      <div style={{display:'flex',flexWrap:'wrap',gap:4,padding:'10px 20px',borderBottom:'1px solid #E5E3E0',flexShrink:0}}>{SECS.map(s=><button key={s.key} onClick={()=>setTab(s.key)} style={{padding:'4px 10px',borderRadius:6,border:tab===s.key?'1px solid #8B2020':'1px solid #E5E3E0',background:tab===s.key?'#FDF4F4':'transparent',color:tab===s.key?'#8B2020':'#6B6056',fontSize:11,fontWeight:600,cursor:'pointer'}}>{s.label}</button>)}</div>
      <div style={{flex:1,overflow:'auto',padding:20}}>
        {tab==='history'?<ActivityHistory jobId={job?.id}/>:<>
          {sec&&sec.fields.map(f=>{const cd=ALL_COLS.find(c=>c.key===f);const lbl=cd?cd.label:f.replace(/_/g,' ');const dd=DD[f];return(
            <div key={f} style={{marginBottom:12}}><label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',letterSpacing:0.5}}>{lbl}</label>
              {f==='notes'?<textarea value={form[f]||''} onChange={e=>set(f,e.target.value)} rows={6} style={{...inputS,resize:'vertical'}}/>:dd?<select value={form[f]||''} onChange={e=>set(f,e.target.value)} style={inputS}><option value="">— Select —</option>{dd.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>:<>{f==='file_location'?<div style={{display:'flex',gap:8,alignItems:'center'}}><input value={form[f]??''} onChange={e=>set(f,e.target.value)} style={{...inputS,flex:1}}/>{form[f]&&(form[f].startsWith('http')||form[f].includes('sharepoint'))&&<a href={form[f]} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#0078D4',whiteSpace:'nowrap',fontWeight:600}}>Open →</a>}</div>:<input value={form[f]??''} onChange={e=>set(f,e.target.value)} style={inputS}/>}</>}
            </div>);})}
          {sec&&sec.computed&&<div style={{marginTop:16,padding:14,background:'#F9F8F6',borderRadius:8,border:'1px solid #E5E3E0'}}>
            <div style={{fontSize:10,color:'#9E9B96',marginBottom:8,fontWeight:600,textTransform:'uppercase'}}>Auto-calculated</div>
            {sec.computed.map(f=>{const cd=ALL_COLS.find(c=>c.key===f);const val=f==='pct_billed'?`${adjCV>0?Math.round(n(form.ytd_invoiced)/adjCV*1000)/10:0}%`:f==='left_to_bill'?$(adjCV-n(form.ytd_invoiced)):(form[f]??'—');return(
              <div key={f} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #E5E3E0'}}><span style={{fontSize:12,color:'#6B6056'}}>{cd?cd.label:f}</span><span style={{fontFamily:'Inter',fontWeight:700,fontSize:14}}>{val}</span></div>);})}
          </div>}
        </>}
      </div>
      {!isNew&&<div style={{padding:'12px 20px',borderTop:'1px solid #E5E3E0',flexShrink:0}}><button onClick={handleDup} style={{...btnS,fontSize:12}}>Duplicate Project</button></div>}
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

/* ═══ DASHBOARD ═══ */
function Dashboard({jobs}){
  const active=useMemo(()=>jobs.filter(j=>j.status!=='complete'),[jobs]);
  const tc=active.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const tl=active.reduce((s,j)=>s+n(j.left_to_bill),0);const ty=active.reduce((s,j)=>s+n(j.ytd_invoiced),0);const tlf=active.reduce((s,j)=>s+n(j.total_lf),0);
  const mktData=MKTS.map(m=>{const mj=active.filter(j=>j.market===m);return{name:MS[m],value:mj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0),fill:MC[m]};});
  const alerts=active.filter(j=>n(j.contract_age)>30&&n(j.ytd_invoiced)===0).sort((a,b)=>n(b.contract_age)-n(a.contract_age));
  const crit=alerts.filter(j=>n(j.contract_age)>=90);const warn=alerts.filter(j=>n(j.contract_age)>=60&&n(j.contract_age)<90);const watch=alerts.filter(j=>n(j.contract_age)>=30&&n(j.contract_age)<60);
  const top15=[...active].sort((a,b)=>n(b.left_to_bill)-n(a.left_to_bill)).slice(0,15);
  const now=new Date();const compThisMonth=jobs.filter(j=>j.complete_date&&new Date(j.complete_date).getMonth()===now.getMonth()&&new Date(j.complete_date).getFullYear()===now.getFullYear()).length;
  const largest=[...active].sort((a,b)=>n(b.adj_contract_value||b.contract_value)-n(a.adj_contract_value||a.contract_value))[0];
  const oldestUnbilled=alerts[0];
  const[actLogs,setActLogs]=useState([]);useEffect(()=>{sbGet('activity_log','order=created_at.desc&limit=10').then(d=>setActLogs(d||[]));},[]);

  return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Dashboard</h1>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:16}}><KPI label="Total Contract" value={$k(tc)}/><KPI label="Left to Bill" value={$k(tl)} color="#B45309"/><KPI label="YTD Billed" value={$k(ty)} color="#065F46"/><KPI label="Active LF" value={tlf.toLocaleString()} color="#1D4ED8"/></div>
    {/* Quick stats */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10,marginBottom:24}}>{[['Total',jobs.length],['Active',active.length],['Completed Mo.',compThisMonth],['Avg Contract',$k(active.length?tc/active.length:0)],['Largest',largest?largest.job_name?.slice(0,18):'—'],['Oldest Unbilled',oldestUnbilled?`${oldestUnbilled.contract_age}d`:'—']].map(([l,v])=><div key={l} style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:8,padding:'8px 12px'}}><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{v}</div><div style={{fontSize:10,color:'#9E9B96'}}>{l}</div></div>)}</div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
      <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Contract Value by Market</div><ResponsiveContainer width="100%" height={220}><BarChart data={mktData} barSize={40}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>'$'+(v/1e6).toFixed(1)+'M'}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#FFF',border:'1px solid #E5E3E0',borderRadius:8}}/><Bar dataKey="value" radius={[6,6,0,0]}>{mktData.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Bar></BarChart></ResponsiveContainer></div>
      <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Pipeline by Status</div>{STS.filter(s=>s!=='complete').map(s=>{const sj=active.filter(j=>j.status===s);const sv=sj.reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);return(<div key={s} style={{marginBottom:14}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span><span style={pill(SC[s],SB_[s])}>{SS[s]}</span> <span style={{color:'#6B6056',marginLeft:6}}>{sj.length}</span></span><span style={{color:'#9E9B96'}}>{$k(sv)}</span></div><PBar pct={tc>0?sv/tc*100:0} color={SC[s]}/></div>);})}</div>
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
    <div style={card}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:10}}>Recent Activity</div>{actLogs.length===0?<div style={{color:'#9E9B96',fontSize:12}}>No activity yet</div>:actLogs.map(l=><div key={l.id} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}><span style={pill(ACT_C[l.action]||'#6B6056',(ACT_C[l.action]||'#6B6056')+'18')}>{(l.action||'').replace(/_/g,' ')}</span><span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.job_name}</span><span style={{color:'#9E9B96',flexShrink:0}}>{relT(l.created_at)}</span></div>)}</div>
  </div>);
}

/* ═══ PROJECTS PAGE ═══ */
function ProjectsPage({jobs,onRefresh,openJob}){
  const[search,setSearch]=useState('');const[statusF,setStatusF]=useState(null);const[mktF,setMktF]=useState(null);
  const[sortCol,setSortCol]=useState('left_to_bill');const[sortDir,setSortDir]=useState('desc');
  const[visCols,setVisCols]=useState(()=>DEF_VIS);const[showCols,setShowCols]=useState(false);
  const[editJob,setEditJob]=useState(openJob||null);const[isNew,setIsNew]=useState(false);
  const[editMode,setEditMode]=useState(false);const[inlE,setInlE]=useState(null);
  const[sel,setSel]=useState(new Set());const[toast,setToast]=useState(null);
  useEffect(()=>{if(openJob)setEditJob(openJob);},[openJob]);
  useEffect(()=>setSel(new Set()),[search,statusF,mktF]);
  const toggleSort=k=>{if(sortCol===k)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(k);setSortDir('desc');}};
  const filtered=useMemo(()=>{let f=jobs;if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number} ${j.customer_name}`.toLowerCase().includes(q));}if(statusF)f=f.filter(j=>j.status===statusF);if(mktF)f=f.filter(j=>j.market===mktF);return[...f].sort((a,b)=>{let av=a[sortCol],bv=b[sortCol];if(typeof av==='string')return sortDir==='asc'?(av||'').localeCompare(bv||''):(bv||'').localeCompare(av||'');return sortDir==='asc'?n(av)-n(bv):n(bv)-n(av);});},[jobs,search,statusF,mktF,sortCol,sortDir]);
  const exportCSV=rows=>{const cols=ALL_COLS.filter(c=>visCols.includes(c.key));const h=cols.map(c=>c.label).join(',');const r=rows.map(j=>cols.map(c=>{const v=j[c.key];return typeof v==='string'&&v.includes(',')?`"${v}"`:(v??'');}).join(','));const b=new Blob([h+'\n'+r.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='fencecrete-projects.csv';a.click();};
  const saveInline=async()=>{if(!inlE)return;const u={[inlE.key]:inlE.value};if(inlE.key==='ytd_invoiced'){const adj=n(inlE.job.adj_contract_value||inlE.job.contract_value);const ytd=n(inlE.value);u.pct_billed=adj>0?Math.round(ytd/adj*10000)/100:0;u.left_to_bill=adj-ytd;}await sbPatch('jobs',inlE.id,u);const j=jobs.find(x=>x.id===inlE.id);if(['ytd_invoiced','last_billed'].includes(inlE.key)){fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update',inlE.key,j[inlE.key],inlE.value);}else{fireAlert('job_updated',{...j,...u});logAct(j,'field_update',inlE.key,j[inlE.key],inlE.value);}setInlE(null);setToast('Saved');onRefresh();};
  const bulkStatus=async s=>{for(const id of sel){const j=jobs.find(x=>x.id===id);if(j){await sbPatch('jobs',id,{status:s});fireAlert('job_updated',{...j,status:s});logAct(j,'status_change','status',j.status,s);}}setSel(new Set());setToast(`Updated ${sel.size} projects`);onRefresh();};
  const bulkRep=async r=>{for(const id of sel){const j=jobs.find(x=>x.id===id);if(j){await sbPatch('jobs',id,{sales_rep:r});logAct(j,'field_update','sales_rep',j.sales_rep,r);}}setSel(new Set());setToast(`Assigned to ${r}`);onRefresh();};
  const visCD=ALL_COLS.filter(c=>visCols.includes(c.key));
  const inlineField=(j,k)=>{const dd=DD[k];if(dd)return<select autoFocus value={inlE?.value||''} onChange={e=>{setInlE({...inlE,value:e.target.value});}} onBlur={saveInline} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12}}><option value="">—</option>{dd.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>;if(k==='est_start_date'||k==='last_billed')return<input autoFocus type="date" value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onKeyDown={e=>{if(e.key==='Enter')saveInline();if(e.key==='Escape')setInlE(null);}} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12,width:'100%'}}/>;return<input autoFocus value={inlE?.value||''} onChange={e=>setInlE({...inlE,value:e.target.value})} onBlur={saveInline} onKeyDown={e=>{if(e.key==='Enter')saveInline();if(e.key==='Escape')setInlE(null);}} onClick={e=>e.stopPropagation()} style={{...inputS,padding:'4px 6px',fontSize:12,width:'100%'}}/>;};
  return(<div>
    {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Projects</h1>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>setEditMode(!editMode)} style={{...btnS,background:editMode?'#FDF4F4':'#F4F4F2',color:editMode?'#8B2020':'#6B6056',border:editMode?'1px solid #8B2020':'1px solid #E5E3E0'}}>{editMode?'✏ Edit':'👁 View'}</button>
        <button onClick={()=>setShowCols(!showCols)} style={btnS}>Columns</button>
        <button onClick={()=>{setEditJob({job_name:'',job_number:'',customer_name:'',market:'',status:'contract_review'});setIsNew(true);}} style={{...btnP,background:'#065F46'}}>+ New Project</button>
        <button onClick={()=>exportCSV(filtered)} style={btnP}>Export</button>
      </div>
    </div>
    <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects..." style={{...inputS,width:240}}/>
      <select value={statusF||''} onChange={e=>setStatusF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Statuses</option>{STS.map(s=><option key={s} value={s}>{SL[s]}</option>)}</select>
      <select value={mktF||''} onChange={e=>setMktF(e.target.value||null)} style={{...inputS,width:160}}><option value="">All Markets</option>{MKTS.map(m=><option key={m} value={m}>{m}</option>)}</select>
      <span style={{fontSize:12,color:'#6B6056'}}>{statusF||mktF||search?`Showing ${filtered.length} of ${jobs.length}`:filtered.length} projects</span>
    </div>
    {showCols&&<div style={{...card,marginBottom:12,display:'flex',flexWrap:'wrap',gap:6}}>{ALL_COLS.map(c=><button key={c.key} onClick={()=>setVisCols(v=>v.includes(c.key)?v.filter(x=>x!==c.key):[...v,c.key])} style={gpill(visCols.includes(c.key))}>{c.label}</button>)}</div>}
    {sel.size>0&&<div style={{background:'#1A1A1A',borderRadius:8,padding:'8px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:12,color:'#fff',fontSize:13}}><span style={{fontWeight:700}}>{sel.size} selected</span><select onChange={e=>{if(e.target.value)bulkStatus(e.target.value);e.target.value='';}} style={{...inputS,width:160,background:'#2A2A2A',color:'#fff',border:'1px solid #444'}}><option value="">Change Status...</option>{STS.map(s=><option key={s} value={s}>{SL[s]}</option>)}</select><select onChange={e=>{if(e.target.value)bulkRep(e.target.value);e.target.value='';}} style={{...inputS,width:140,background:'#2A2A2A',color:'#fff',border:'1px solid #444'}}><option value="">Assign Rep...</option>{REPS.map(r=><option key={r} value={r}>{r}</option>)}</select><button onClick={()=>exportCSV(filtered.filter(j=>sel.has(j.id)))} style={{...btnP,padding:'4px 12px',fontSize:12}}>Export</button><button onClick={()=>setSel(new Set())} style={{background:'transparent',border:'1px solid #444',borderRadius:6,color:'#fff',padding:'4px 12px',fontSize:12,cursor:'pointer'}}>Clear</button></div>}
    <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 280px)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr><th style={{width:40,padding:'10px 8px',borderBottom:'1px solid #E5E3E0'}}><input type="checkbox" checked={sel.size===filtered.length&&filtered.length>0} onChange={()=>{if(sel.size===filtered.length)setSel(new Set());else setSel(new Set(filtered.map(j=>j.id)));}} /></th>{visCD.map(c=><th key={c.key} onClick={()=>toggleSort(c.key)} style={{textAlign:'left',padding:'10px 10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:0.5,userSelect:'none'}}>{c.label} {sortCol===c.key&&(sortDir==='asc'?'↑':'↓')}</th>)}</tr></thead>
        <tbody>{filtered.map((j,i)=><tr key={j.id} onClick={()=>{if(!editMode&&!sel.size){setEditJob(j);setIsNew(false);}}} style={{cursor:editMode?'default':'pointer',borderLeft:`3px solid ${SC[j.status]||'transparent'}`,background:i%2===0?'#FFF':'#FAFAF8'}} onMouseEnter={e=>e.currentTarget.style.background='#FDF9F6'} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#FFF':'#FAFAF8'}>
          <td style={{width:40,padding:'8px 8px'}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={sel.has(j.id)} onChange={()=>{const s=new Set(sel);if(s.has(j.id))s.delete(j.id);else s.add(j.id);setSel(s);}}/></td>
          {visCD.map(c=><td key={c.key} onClick={e=>{if(editMode){e.stopPropagation();setInlE({id:j.id,key:c.key,value:j[c.key]??'',job:j});}}} style={{padding:'8px 10px',whiteSpace:'nowrap',maxWidth:c.w,overflow:'hidden',textOverflow:'ellipsis',cursor:editMode?'cell':'pointer'}}>{inlE&&inlE.id===j.id&&inlE.key===c.key?inlineField(j,c.key):renderCell(j,c.key)}</td>)}
        </tr>)}</tbody></table>
    </div>
    {editJob&&<EditPanel job={editJob} isNew={isNew} onClose={()=>{setEditJob(null);setIsNew(false);}} onSaved={msg=>{setEditJob(null);setIsNew(false);if(msg)setToast(msg);onRefresh();}}/>}
  </div>);
}

/* ═══ BILLING PAGE ═══ */
function BillingPage({jobs,onRefresh}){
  const active=useMemo(()=>jobs.filter(j=>j.status!=='complete'),[jobs]);
  const withBal=useMemo(()=>[...active].filter(j=>n(j.left_to_bill)>0).sort((a,b)=>n(b.left_to_bill)-n(a.left_to_bill)),[active]);
  const ty=active.reduce((s,j)=>s+n(j.ytd_invoiced),0);const tl=active.reduce((s,j)=>s+n(j.left_to_bill),0);
  const avgDaysFirst=active.filter(j=>n(j.ytd_invoiced)>0&&j.contract_age);const avgD=avgDaysFirst.length?Math.round(avgDaysFirst.reduce((s,j)=>s+n(j.contract_age),0)/avgDaysFirst.length):0;
  const fully=active.filter(j=>n(j.pct_billed)>=99).length;
  const[editId,setEditId]=useState(null);const[editField,setEditField]=useState(null);const[editVal,setEditVal]=useState('');const[billingF,setBillingF]=useState(null);
  const[pmEntries,setPmEntries]=useState([]);const[showPmModal,setShowPmModal]=useState(null);const[toast,setToast]=useState(null);
  const[confirmFullJob,setConfirmFullJob]=useState(null);const[undoJob,setUndoJob]=useState(null);const[showRecent,setShowRecent]=useState(false);
  useEffect(()=>{sbGet('pm_billing_entries','select=*&status=eq.pending').then(d=>setPmEntries(d||[]));},[]);
  const getPendingForJob=(jobId)=>pmEntries.filter(e=>e.job_id===jobId);
  const startEdit=(j,f)=>{setEditId(j.id);setEditField(f);setEditVal(j[f]??'');};
  const saveEdit=async j=>{const u={[editField]:editVal};if(editField==='ytd_invoiced'){const adj=n(j.adj_contract_value||j.contract_value);const ytd=n(editVal);u.pct_billed=adj>0?Math.round(ytd/adj*10000)/100:0;u.left_to_bill=adj-ytd;}await sbPatch('jobs',j.id,u);fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update',editField,j[editField],editVal);setEditId(null);setEditField(null);onRefresh();};
  const confirmMarkFull=async()=>{if(!confirmFullJob)return;const j=confirmFullJob;const adj=n(j.adj_contract_value||j.contract_value);const u={ytd_invoiced:adj,pct_billed:100,left_to_bill:0};await sbPatch('jobs',j.id,u);fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update','ytd_invoiced',j.ytd_invoiced,adj);setConfirmFullJob(null);setToast(`${j.job_name} marked as 100% billed`);onRefresh();};
  const confirmUndo=async()=>{if(!undoJob)return;const j=undoJob;const adj=n(j.adj_contract_value||j.contract_value);const u={ytd_invoiced:0,pct_billed:0,left_to_bill:adj};await sbPatch('jobs',j.id,u);fireAlert('billing_logged',{...j,...u});logAct(j,'billing_update','ytd_invoiced',j.ytd_invoiced,0);setUndoJob(null);setToast(`Undo: ${j.job_name} YTD reset to $0`);onRefresh();};
  const recentlyBilled=useMemo(()=>jobs.filter(j=>n(j.pct_billed)>=99).sort((a,b)=>(b.last_billed||'').localeCompare(a.last_billed||'')).slice(0,10),[jobs]);
  const applyToYTD=async(job,pendingList)=>{
    const sumAmt=pendingList.reduce((s,e)=>s+n(e.amount_to_invoice),0);
    const newYTD=n(job.ytd_invoiced)+sumAmt;
    const adj=n(job.adj_contract_value||job.contract_value);
    const u={ytd_invoiced:newYTD,pct_billed:adj>0?Math.round(newYTD/adj*10000)/100:0,left_to_bill:adj-newYTD};
    await sbPatch('jobs',job.id,u);
    const today=new Date().toISOString().split('T')[0];
    for(const e of pendingList){await sbPatch('pm_billing_entries',e.id,{status:'invoiced',invoiced_by:'Accounting',invoiced_date:today});}
    fireAlert('billing_logged',{...job,...u});
    logAct(job,'billing_update','ytd_invoiced',job.ytd_invoiced,newYTD);
    setPmEntries(prev=>prev.filter(e=>!pendingList.some(p=>p.id===e.id)));
    setShowPmModal(null);
    setToast(`Applied ${$(sumAmt)} to YTD invoiced for ${job.job_name}`);
    onRefresh();
  };
  const shown=billingF?withBal.filter(j=>j.billing_method===billingF):withBal;
  return(<div>
    {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Billing</h1>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}><KPI label="YTD Billed" value={$k(ty)} color="#065F46"/><KPI label="Left to Bill" value={$k(tl)} color="#B45309"/><KPI label="Avg Days to 1st Invoice" value={avgD+'d'} color="#1D4ED8"/><KPI label="100% Billed" value={fully} color="#065F46"/></div>
    <div style={{...card,marginBottom:24}}><div style={{fontFamily:'Inter',fontWeight:700,marginBottom:12}}>Billing by Market</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>{MKTS.map(m=>{const mj=active.filter(j=>j.market===m);const mc=mj.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0);const mb=mj.reduce((s,j)=>s+n(j.ytd_invoiced),0);const mp=mc>0?Math.round(mb/mc*100):0;return<div key={m}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span style={{fontWeight:600,color:MC[m]}}>{MS[m]}</span><span style={{color:'#6B6056'}}>{mp}%</span></div><PBar pct={mp} color={MC[m]} h={8}/></div>;})}</div></div>
    <div style={{display:'flex',gap:8,marginBottom:12}}><span style={{fontSize:12,color:'#6B6056',lineHeight:'28px'}}>Filter:</span><button onClick={()=>setBillingF(null)} style={fpill(!billingF)}>All</button>{['Progress','Lump Sum','Milestone','AIA','T&M'].map(m=><button key={m} onClick={()=>setBillingF(m)} style={fpill(billingF===m)}>{m}</button>)}</div>
    <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 400px)'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Project','Market','Status','Contract','YTD Invoiced','Left to Bill','% Billed','PM Entries','Last Billed','Notes','SP',''].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
      <tbody>{shown.map(j=>{const pending=getPendingForJob(j.id);const pendingAmt=pending.reduce((s,e)=>s+n(e.amount_to_invoice),0);return<tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}>
        <td style={{padding:'8px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}}>{j.job_name}</td>
        <td style={{padding:'8px 10px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td>
        <td style={{padding:'8px 10px'}}><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]}</span></td>
        <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td>
        <td style={{padding:'8px 10px'}} onClick={()=>startEdit(j,'ytd_invoiced')}>{editId===j.id&&editField==='ytd_invoiced'?<input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={()=>saveEdit(j)} onKeyDown={e=>e.key==='Enter'&&saveEdit(j)} style={{...inputS,width:100,padding:'4px 8px'}}/>:<span style={{cursor:'pointer',borderBottom:'1px dashed #E5E3E0'}}>{$(j.ytd_invoiced)}</span>}</td>
        <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:800,color:n(j.left_to_bill)>100000?'#991B1B':n(j.left_to_bill)>50000?'#B45309':'#065F46',fontSize:13}}>{$(j.left_to_bill)}</td>
        <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}><PBar pct={n(j.pct_billed)} h={4}/><span style={{fontSize:11}}>{n(j.pct_billed)}%</span></div></td>
        <td style={{padding:'8px 10px'}}>{pending.length>0?<button onClick={()=>setShowPmModal({job:j,entries:pending})} style={{background:'#FEF3C7',border:'1px solid #F9731640',borderRadius:6,color:'#B45309',fontSize:11,fontWeight:700,cursor:'pointer',padding:'3px 8px'}}>{pending.length} pending · {$(pendingAmt)}</button>:<span style={{color:'#9E9B96',fontSize:11}}>—</span>}</td>
        <td style={{padding:'8px 10px'}} onClick={()=>startEdit(j,'last_billed')}>{editId===j.id&&editField==='last_billed'?<input autoFocus type="date" value={editVal||''} onChange={e=>setEditVal(e.target.value)} onBlur={()=>saveEdit(j)} onKeyDown={e=>e.key==='Enter'&&saveEdit(j)} style={{...inputS,width:130,padding:'4px 8px'}}/>:<span style={{cursor:'pointer',borderBottom:'1px dashed #E5E3E0'}}>{fD(j.last_billed)}</span>}</td>
        <td style={{padding:'8px 10px',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#9E9B96'}} title={j.notes}>{j.notes||'—'}</td>
        <td style={{padding:'8px 10px',textAlign:'center'}}>{j.job_number?<a href={spSearch(j.job_number)} target="_blank" rel="noopener noreferrer" style={{color:'#0078D4',textDecoration:'none',fontSize:16}} title="Open in SharePoint" onClick={e=>e.stopPropagation()}>📁</a>:'—'}</td>
        <td style={{padding:'8px 10px'}}><button onClick={()=>setConfirmFullJob(j)} title="Mark 100% billed" style={{background:'#D1FAE5',border:'1px solid #065F4630',borderRadius:6,color:'#065F46',fontSize:14,cursor:'pointer',padding:'2px 8px'}}>✓</button></td>
      </tr>;})}</tbody></table></div>
    {/* Recently Fully Billed */}
    <div style={{marginTop:24}}>
      <button onClick={()=>setShowRecent(!showRecent)} style={{display:'flex',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',fontFamily:'Inter',fontWeight:700,fontSize:14,color:'#6B6056',padding:0,marginBottom:showRecent?12:0}}>
        <span style={{fontSize:12,transition:'transform .2s',transform:showRecent?'rotate(90deg)':'rotate(0deg)',display:'inline-block'}}>▶</span>
        Recently Fully Billed ({recentlyBilled.length})
      </button>
      {showRecent&&<div style={{...card,padding:0,overflow:'auto',maxHeight:360}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}><tr>{['Job Name','Market','Contract Value','Date Billed','Sales Rep',''].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
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
    {/* Confirm Mark Full Modal */}
    {confirmFullJob&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setConfirmFullJob(null)}>
      <div style={{background:'#fff',borderRadius:16,padding:28,width:420}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:16,fontWeight:800,marginBottom:12}}>Mark {confirmFullJob.job_name} as 100% billed?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.6,marginBottom:20}}>
          This will set YTD Invoiced to <span style={{fontFamily:'Inter',fontWeight:700,color:'#1A1A1A'}}>{$(n(confirmFullJob.adj_contract_value||confirmFullJob.contract_value))}</span>.<br/>
          Current YTD: <span style={{fontFamily:'Inter',fontWeight:700,color:'#1A1A1A'}}>{$(confirmFullJob.ytd_invoiced)}</span><br/>
          Are you sure?
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setConfirmFullJob(null)} style={btnS}>Cancel</button><button onClick={confirmMarkFull} style={btnP}>Confirm</button></div>
      </div>
    </div>}
    {/* Confirm Undo Modal */}
    {undoJob&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setUndoJob(null)}>
      <div style={{background:'#fff',borderRadius:16,padding:28,width:420}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:16,fontWeight:800,marginBottom:12}}>Undo billing for {undoJob.job_name}?</div>
        <div style={{fontSize:13,color:'#6B6056',lineHeight:1.6,marginBottom:20}}>
          This will reset YTD Invoiced from <span style={{fontFamily:'Inter',fontWeight:700,color:'#1A1A1A'}}>{$(undoJob.ytd_invoiced)}</span> back to <span style={{fontFamily:'Inter',fontWeight:700,color:'#991B1B'}}>$0</span>.<br/>
          Are you sure?
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setUndoJob(null)} style={btnS}>Cancel</button><button onClick={confirmUndo} style={{...btnP,background:'#991B1B'}}>Confirm Undo</button></div>
      </div>
    </div>}
    {/* PM Entries Modal */}
    {showPmModal&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowPmModal(null)}>
      <div style={{background:'#fff',borderRadius:16,padding:24,width:500,maxHeight:'70vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:16,fontWeight:800,marginBottom:4}}>PM Billing Entries — {showPmModal.job.job_name}</div>
        <div style={{fontSize:12,color:'#6B6056',marginBottom:16}}>#{showPmModal.job.job_number} · {showPmModal.entries.length} pending entries</div>
        {showPmModal.entries.map(e=>{const pd=e.billing_period?new Date(e.billing_period+'T12:00:00'):null;return<div key={e.id} style={{padding:'10px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontWeight:600}}>{pd?pd.toLocaleDateString('en-US',{month:'long',year:'numeric'}):'—'}</span><span style={{color:'#6B6056'}}>by {e.pm}</span></div>
          <div style={{display:'flex',gap:12,color:'#6B6056'}}><span>{n(e.lf_this_period).toLocaleString()} LF</span><span style={{fontFamily:'Inter',fontWeight:700,color:'#1A1A1A'}}>{$(e.amount_to_invoice)}</span></div>
          {e.invoice_notes&&<div style={{color:'#9E9B96',marginTop:2}}>{e.invoice_notes}</div>}
        </div>;})}
        <div style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:8,padding:12,marginTop:16,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700}}>Total: {$(showPmModal.entries.reduce((s,e)=>s+n(e.amount_to_invoice),0))}</div>
          <div style={{fontSize:11,color:'#6B6056'}}>Will be added to YTD invoiced ({$(showPmModal.job.ytd_invoiced)} current)</div>
        </div>
        <div style={{display:'flex',gap:8}}><button onClick={()=>applyToYTD(showPmModal.job,showPmModal.entries)} style={{...btnP,flex:1,background:'#065F46'}}>Apply to YTD</button><button onClick={()=>setShowPmModal(null)} style={btnS}>Cancel</button></div>
      </div>
    </div>}
  </div>);
}

/* ═══ PM BILLING PAGE ═══ */
const PMS=['Max','Luis','Ray','Rafael','Manuel'];
const ACTIVE_STATUSES=['production_queue','in_production','ready_to_install'];

function PMBillingPage({jobs,onRefresh}){
  const[selPM,setSelPM]=useState(()=>localStorage.getItem('fc_pm')||'');
  const[tab,setTab]=useState('projects');
  const[entries,setEntries]=useState([]);
  const[toast,setToast]=useState(null);
  const[showLog,setShowLog]=useState(null);
  const[search,setSearch]=useState('');
  const[mktF,setMktF]=useState(null);
  const[histF,setHistF]=useState({status:null,market:null,period:null});
  const[logForm,setLogForm]=useState({billing_period:'',lf_this_period:'',amount_to_invoice:'',invoice_notes:''});

  const fetchEntries=useCallback(async()=>{const d=await sbGet('pm_billing_entries','select=*&order=created_at.desc');setEntries(d||[]);},[]);
  useEffect(()=>{fetchEntries();},[fetchEntries]);

  const pickPM=pm=>{setSelPM(pm);localStorage.setItem('fc_pm',pm);};

  const now=new Date();
  const curMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const curMonthLabel=now.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const curMonthFirst=`${curMonth}-01`;

  const activeJobs=useMemo(()=>jobs.filter(j=>['production_queue','in_production','ready_to_install'].includes(j.status)),[jobs]);

  const pmEntries=useMemo(()=>selPM?entries.filter(e=>e.pm===selPM):entries,[entries,selPM]);

  const getJobEntries=useCallback((jobId)=>entries.filter(e=>e.job_id===jobId),[entries]);
  const getThisMonthEntry=(jobId)=>pmEntries.find(e=>e.job_id===jobId&&e.billing_period&&e.billing_period.startsWith(curMonth));
  const getCumulativeLF=(jobId)=>{const je=getJobEntries(jobId);return je.reduce((s,e)=>s+n(e.lf_this_period),0);};

  const filteredProjects=useMemo(()=>{let f=activeJobs;if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.job_number}`.toLowerCase().includes(q));}if(mktF)f=f.filter(j=>j.market===mktF);return f;},[activeJobs,search,mktF]);

  const openLogForm=(job)=>{
    const prevCum=getCumulativeLF(job.id);
    const rate=n(job.contract_rate_precast);
    setLogForm({billing_period:curMonthFirst,lf_this_period:'',amount_to_invoice:'',invoice_notes:'',_prevCum:prevCum,_totalLF:n(job.total_lf),_rate:rate});
    setShowLog(job);
  };

  const editEntry=(job,entry)=>{
    const prevCum=getCumulativeLF(job.id)-n(entry.lf_this_period);
    const rate=n(job.contract_rate_precast);
    setLogForm({billing_period:entry.billing_period||curMonthFirst,lf_this_period:entry.lf_this_period||'',amount_to_invoice:entry.amount_to_invoice||'',invoice_notes:entry.invoice_notes||'',_prevCum:prevCum,_totalLF:n(job.total_lf),_rate:rate,_editId:entry.id});
    setShowLog(job);
  };

  const saveLog=async()=>{
    if(!showLog||!logForm.lf_this_period)return;
    const j=showLog;
    const lfPeriod=n(logForm.lf_this_period);
    const prevCum=n(logForm._prevCum);
    const cumulative=prevCum+lfPeriod;
    const body={
      job_id:j.id,job_number:j.job_number,job_name:j.job_name,market:j.market,pm:selPM,
      billing_period:logForm.billing_period,lf_this_period:lfPeriod,lf_cumulative:cumulative,
      amount_to_invoice:n(logForm.amount_to_invoice),invoice_notes:logForm.invoice_notes,status:'pending'
    };
    if(logForm._editId){
      await sbPatch('pm_billing_entries',logForm._editId,body);
    }else{
      await sbPost('pm_billing_entries',body);
    }
    fireAlert('billing_logged',{...j,pm:selPM,lf_this_period:lfPeriod,amount_to_invoice:n(logForm.amount_to_invoice)});
    logAct(j,'billing_update','pm_billing','',[selPM,lfPeriod+'LF',$(n(logForm.amount_to_invoice))].join(' · '));
    setShowLog(null);
    setToast(`Billing entry logged for ${j.job_name}`);
    fetchEntries();
  };

  const markInvoiced=async(entry)=>{
    await sbPatch('pm_billing_entries',entry.id,{status:'invoiced',invoiced_by:selPM,invoiced_date:new Date().toISOString().split('T')[0]});
    setToast('Marked as invoiced');
    fetchEntries();
  };

  const pendingEntries=pmEntries.filter(e=>e.status==='pending');
  const pendingTotal=pendingEntries.reduce((s,e)=>s+n(e.amount_to_invoice),0);

  const filteredHistory=useMemo(()=>{let h=pmEntries;if(histF.status)h=h.filter(e=>e.status===histF.status);if(histF.market)h=h.filter(e=>e.market===histF.market);if(histF.period)h=h.filter(e=>e.billing_period&&e.billing_period.startsWith(histF.period));return h;},[pmEntries,histF]);

  const getCardBorder=(job)=>{
    const thisMonth=getThisMonthEntry(job.id);
    if(thisMonth)return'#10B981';
    const anyEntry=entries.some(e=>e.job_id===job.id);
    if(anyEntry)return'#F59E0B';
    return'#E5E3E0';
  };

  if(!selPM)return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:24}}>PM Billing</h1>
    <div style={{...card,textAlign:'center',padding:40}}>
      <div style={{fontSize:16,color:'#6B6056',marginBottom:20}}>Select your name to get started</div>
      <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>{PMS.map(pm=><button key={pm} onClick={()=>pickPM(pm)} style={{padding:'14px 32px',borderRadius:12,border:'2px solid #E5E3E0',background:'#FFF',color:'#1A1A1A',fontSize:16,fontWeight:700,cursor:'pointer',fontFamily:'Inter',transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.background='#8B2020';e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='#8B2020';}} onMouseLeave={e=>{e.currentTarget.style.background='#FFF';e.currentTarget.style.color='#1A1A1A';e.currentTarget.style.borderColor='#E5E3E0';}}>{pm}</button>)}</div>
    </div>
  </div>);

  return(<div>
    {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:16}}>PM Billing</h1>

    {/* PM Selector */}
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
      {PMS.map(pm=><button key={pm} onClick={()=>pickPM(pm)} style={{padding:'8px 20px',borderRadius:20,border:'none',background:selPM===pm?'#8B2020':'#F4F4F2',color:selPM===pm?'#fff':'#6B6056',fontSize:14,fontWeight:700,cursor:'pointer',transition:'all .15s'}}>{pm}</button>)}
    </div>

    {/* Tabs */}
    <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'2px solid #E5E3E0'}}>
      {[['projects','My Projects'],['history','Billing History']].map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{padding:'10px 20px',border:'none',background:'transparent',color:tab===k?'#8B2020':'#6B6056',fontWeight:tab===k?700:400,fontSize:14,cursor:'pointer',borderBottom:tab===k?'2px solid #8B2020':'2px solid transparent',marginBottom:-2}}>{l}</button>)}
    </div>

    {/* TAB 1: MY PROJECTS */}
    {tab==='projects'&&<div>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by job name or number..." style={{...inputS,width:280}}/>
        <button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>
        {MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}
        <span style={{fontSize:12,color:'#6B6056',marginLeft:8}}>{filteredProjects.length} projects</span>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340,1fr))',gap:16}}>
        {filteredProjects.map(j=>{
          const totalLF=n(j.total_lf);
          const cumLF=getCumulativeLF(j.id);
          const lfRemaining=totalLF-cumLF;
          const pct=totalLF>0?Math.round(cumLF/totalLF*100):0;
          const pendingAmt=entries.filter(e=>e.job_id===j.id&&e.status==='pending').reduce((s,e)=>s+n(e.amount_to_invoice),0);
          const thisMonth=getThisMonthEntry(j.id);
          const borderColor=getCardBorder(j);

          return<div key={j.id} style={{...card,borderLeft:`4px solid ${borderColor}`,padding:16}}>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{j.job_name}</div>
            <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:12,color:'#6B6056'}}>#{j.job_number}</span>
              <span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span>
              {j.sales_rep&&<span style={{fontSize:11,color:'#9E9B96'}}>{j.sales_rep}</span>}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:12,color:'#6B6056',marginBottom:10}}>
              <div>Total LF: <span style={{fontWeight:700,color:'#1A1A1A'}}>{totalLF.toLocaleString()}</span></div>
              <div>LF This Mo: <span style={{fontWeight:700,color:'#1D4ED8'}}>{(thisMonth?n(thisMonth.lf_this_period):0).toLocaleString()}</span></div>
              <div>LF Remaining: <span style={{fontWeight:700,color:lfRemaining>0?'#B45309':'#065F46'}}>{lfRemaining.toLocaleString()}</span></div>
              {pendingAmt>0&&<div>Pending: <span style={{fontWeight:700,color:'#F97316'}}>{$(pendingAmt)}</span></div>}
            </div>
            <div style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#9E9B96',marginBottom:2}}>
                <span>{cumLF.toLocaleString()} / {totalLF.toLocaleString()} LF</span>
                <span>{pct}%</span>
              </div>
              <PBar pct={pct} color={pct>=100?'#065F46':'#8B2020'} h={6}/>
            </div>
            {thisMonth?<div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{color:'#10B981',fontWeight:600,fontSize:13}}>✓ Logged {fD(thisMonth.created_at)}</span>
              <button onClick={()=>editEntry(j,thisMonth)} style={{...btnS,padding:'4px 10px',fontSize:11}}>Edit</button>
            </div>:<button onClick={()=>openLogForm(j)} style={{...btnP,width:'100%',padding:'10px 0',fontSize:13}}>Log This Month</button>}
          </div>;
        })}
      </div>
      {filteredProjects.length===0&&<div style={{...card,textAlign:'center',padding:40,color:'#9E9B96'}}>No active projects found</div>}
    </div>}

    {/* TAB 2: BILLING HISTORY */}
    {tab==='history'&&<div>
      {/* Pending Summary */}
      {pendingEntries.length>0&&<div style={{...card,borderLeft:'4px solid #F97316',marginBottom:20,padding:16}}>
        <div style={{fontFamily:'Inter',fontWeight:700,fontSize:14,color:'#F97316',marginBottom:8}}>{pendingEntries.length} entries pending · {$(pendingTotal)} total pending invoice</div>
        <div style={{maxHeight:200,overflow:'auto'}}>
          {pendingEntries.map(e=><div key={e.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #F4F4F2',fontSize:12}}>
            <div style={{flex:1}}>
              <span style={{fontWeight:600}}>{e.job_name}</span>
              <span style={{color:'#6B6056',marginLeft:8}}>{n(e.lf_this_period).toLocaleString()} LF · {$(e.amount_to_invoice)}</span>
            </div>
            <button onClick={()=>markInvoiced(e)} style={{...btnS,padding:'3px 10px',fontSize:11,color:'#065F46',border:'1px solid #065F4640'}}>Mark as Invoiced</button>
          </div>)}
        </div>
      </div>}

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,color:'#9E9B96',fontWeight:600}}>Status:</span>
        <button onClick={()=>setHistF(f=>({...f,status:null}))} style={fpill(!histF.status)}>All</button>
        {['pending','invoiced','approved'].map(s=><button key={s} onClick={()=>setHistF(f=>({...f,status:s}))} style={fpill(histF.status===s)}>{s}</button>)}
        <span style={{color:'#E5E3E0'}}>|</span>
        <span style={{fontSize:11,color:'#9E9B96',fontWeight:600}}>Market:</span>
        <button onClick={()=>setHistF(f=>({...f,market:null}))} style={fpill(!histF.market)}>All</button>
        {MKTS.map(m=><button key={m} onClick={()=>setHistF(f=>({...f,market:m}))} style={fpill(histF.market===m)}>{MS[m]}</button>)}
      </div>

      <div style={{...card,padding:0,overflow:'auto',maxHeight:'calc(100vh - 400px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead style={{position:'sticky',top:0,background:'#F9F8F6',zIndex:2}}>
            <tr>{['Billing Period','Job Name','Market','LF This Period','Cumulative LF','Amount to Invoice','Status','Notes','Date Logged'].map(h=><th key={h} style={{textAlign:'left',padding:'10px',borderBottom:'1px solid #E5E3E0',color:'#6B6056',fontSize:11,fontWeight:600,textTransform:'uppercase'}}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filteredHistory.map(e=>{
              const statusColors={pending:['#B45309','#FEF3C7'],invoiced:['#065F46','#D1FAE5'],approved:['#1D4ED8','#DBEAFE']};
              const[sc2,sb2]=statusColors[e.status]||['#6B6056','#F4F4F2'];
              const periodDate=e.billing_period?new Date(e.billing_period+'T12:00:00'):null;
              const periodLabel=periodDate?periodDate.toLocaleDateString('en-US',{month:'long',year:'numeric'}):'—';
              return<tr key={e.id} style={{borderBottom:'1px solid #F4F4F2'}}>
                <td style={{padding:'8px 10px',fontWeight:500}}>{periodLabel}</td>
                <td style={{padding:'8px 10px',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.job_name}</td>
                <td style={{padding:'8px 10px'}}><span style={pill(MC[e.market]||'#6B6056',MB[e.market]||'#F4F4F2')}>{MS[e.market]||'—'}</span></td>
                <td style={{padding:'8px 10px'}}>{n(e.lf_this_period).toLocaleString()}</td>
                <td style={{padding:'8px 10px'}}>{n(e.lf_cumulative).toLocaleString()}</td>
                <td style={{padding:'8px 10px',fontFamily:'Inter',fontWeight:700}}>{$(e.amount_to_invoice)}</td>
                <td style={{padding:'8px 10px'}}><span style={pill(sc2,sb2)}>{e.status}</span></td>
                <td style={{padding:'8px 10px',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#9E9B96'}} title={e.invoice_notes}>{e.invoice_notes||'—'}</td>
                <td style={{padding:'8px 10px',color:'#9E9B96'}}>{fD(e.created_at)}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {filteredHistory.length===0&&<div style={{padding:24,textAlign:'center',color:'#9E9B96'}}>No billing entries found</div>}
      </div>
    </div>}

    {/* LOG BILLING MODAL */}
    {showLog&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>setShowLog(null)}>
      <div style={{background:'#fff',borderRadius:'20px 20px 0 0',padding:28,width:'100%',maxWidth:520,maxHeight:'85vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'Inter',fontSize:18,fontWeight:800,marginBottom:4}}>Log Billing — {showLog.job_name}</div>
        <div style={{fontSize:12,color:'#6B6056',marginBottom:20}}>#{showLog.job_number} · {showLog.market}</div>

        <div style={{marginBottom:16}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Billing Period</label>
          <input type="month" value={logForm.billing_period?logForm.billing_period.slice(0,7):curMonth} onChange={e=>setLogForm(f=>({...f,billing_period:e.target.value+'-01'}))} style={inputS}/>
        </div>

        <div style={{marginBottom:16}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>LF Installed This Period</label>
          <input type="number" value={logForm.lf_this_period} onChange={e=>{
            const lf=e.target.value;
            const sugAmt=logForm._rate>0?n(lf)*logForm._rate:'';
            setLogForm(f=>({...f,lf_this_period:lf,amount_to_invoice:sugAmt||f.amount_to_invoice}));
          }} placeholder="0" style={inputS} required/>
          <div style={{fontSize:11,color:'#9E9B96',marginTop:4}}>Running total will be: {(n(logForm._prevCum)+n(logForm.lf_this_period)).toLocaleString()} LF of {n(logForm._totalLF).toLocaleString()} total</div>
        </div>

        <div style={{marginBottom:16}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Amount to Invoice ($)</label>
          <input type="number" value={logForm.amount_to_invoice} onChange={e=>setLogForm(f=>({...f,amount_to_invoice:e.target.value}))} placeholder="0.00" style={inputS} required/>
          {logForm._rate>0&&<div style={{fontSize:11,color:'#1D4ED8',marginTop:4}}>Est. at ${logForm._rate.toFixed(2)}/LF = {$(n(logForm.lf_this_period)*logForm._rate)}</div>}
        </div>

        <div style={{marginBottom:16}}>
          <label style={{display:'block',fontSize:11,color:'#6B6056',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Section / Notes</label>
          <textarea value={logForm.invoice_notes} onChange={e=>setLogForm(f=>({...f,invoice_notes:e.target.value}))} rows={3} placeholder="e.g. North section complete, gates pending, sections 1-3 done" style={{...inputS,resize:'vertical'}}/>
        </div>

        <div style={{background:'#F9F8F6',border:'1px solid #E5E3E0',borderRadius:8,padding:12,marginBottom:20,fontSize:13,fontWeight:600,color:'#1A1A1A'}}>
          Logging {n(logForm.lf_this_period).toLocaleString()} LF for {$(n(logForm.amount_to_invoice))} — {logForm.billing_period?new Date(logForm.billing_period+'T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}):curMonthLabel}
        </div>

        <div style={{display:'flex',gap:8}}>
          <button onClick={saveLog} style={{...btnP,flex:1,padding:'12px 0',fontSize:14}}>{logForm._editId?'Update Entry':'Save Entry'}</button>
          <button onClick={()=>setShowLog(null)} style={{...btnS,padding:'12px 20px'}}>Cancel</button>
        </div>
      </div>
    </div>}
  </div>);
}

/* ═══ PRODUCTION PAGE ═══ */
function ProdCard({j,move}){const ns=NEXT_STATUS[j.status];return<div style={{...card,padding:12,marginBottom:6}}><div style={{fontWeight:600,fontSize:13,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{j.job_name}</div><div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span><span style={pill(SC[j.status]||'#6B6056',SB_[j.status]||'#F4F4F2')}>{SS[j.status]}</span>{j.sales_rep&&<span style={{fontSize:10,color:'#6B6056',background:'#F4F4F2',padding:'1px 5px',borderRadius:4}}>{j.sales_rep}</span>}</div><div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B6056',marginBottom:2}}><span>{n(j.total_lf).toLocaleString()} LF</span><span style={{fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(j.adj_contract_value||j.contract_value)}</span></div>{j.est_start_date&&<div style={{fontSize:10,color:'#9E9B96'}}>Start: {fD(j.est_start_date)}</div>}{j.contract_age&&<div style={{fontSize:10,color:'#9E9B96'}}>{j.contract_age}d old</div>}<div style={{display:'flex',gap:4,marginTop:6}}>{ns&&<button onClick={()=>move(j,ns)} style={{flex:2,padding:'5px 4px',borderRadius:6,border:`1px solid ${SC[ns]}40`,background:SB_[ns],color:SC[ns],fontSize:10,fontWeight:700,cursor:'pointer'}}>→ {SS[ns]}</button>}<select onChange={e=>{if(e.target.value)move(j,e.target.value);e.target.value='';}} style={{flex:1,padding:'4px',borderRadius:6,border:'1px solid #E5E3E0',fontSize:10,color:'#6B6056',cursor:'pointer',background:'#FFF'}}><option value="">More...</option>{STS.filter(s=>s!==j.status&&s!==ns).map(s=><option key={s} value={s}>{SS[s]}</option>)}</select></div></div>;}

function ProductionPage({jobs,onRefresh}){
  const[groupBy,setGroupBy]=useState('status');const[mktF,setMktF]=useState(null);const[statusF,setStatusF]=useState(null);const[search,setSearch]=useState('');
  const move=async(job,ns)=>{await sbPatch('jobs',job.id,{status:ns});fireAlert('job_updated',{...job,status:ns});logAct(job,'status_change','status',job.status,ns);onRefresh();};
  const filtered=useMemo(()=>{let f=jobs;if(mktF)f=f.filter(j=>j.market===mktF);if(statusF)f=f.filter(j=>j.status===statusF);if(search){const q=search.toLowerCase();f=f.filter(j=>`${j.job_name} ${j.customer_name}`.toLowerCase().includes(q));}return f;},[jobs,mktF,statusF,search]);
  const pipeLF=filtered.filter(j=>['production_queue','in_production'].includes(j.status)).reduce((s,j)=>s+n(j.total_lf),0);
  const columns=useMemo(()=>{if(groupBy==='status')return STS.map(s=>({key:s,label:SL[s],color:SC[s],bg:SB_[s],jobs:filtered.filter(j=>j.status===s)}));const groups={};filtered.forEach(j=>{const v=j[groupBy]||'';const k=v||'__u__';if(!groups[k])groups[k]={label:v||'Unspecified',jobs:[]};groups[k].jobs.push(j);});let cols=Object.entries(groups).map(([k,g])=>({key:k,label:g.label,color:'#8B2020',bg:'#FDF4F4',jobs:g.jobs,tv:g.jobs.reduce((s,j)=>s+n(j.adj_contract_value||j.contract_value),0)}));cols.sort((a,b)=>{if(a.key==='__u__')return 1;if(b.key==='__u__')return-1;return b.tv-a.tv;});return{cols:cols.slice(0,12),capped:cols.length>12};},[filtered,groupBy]);
  const isS=groupBy==='status';const colArr=isS?columns:columns.cols;
  return(<div>
    <h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:16}}>Production</h1>
    <div style={{...card,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}><span style={{fontFamily:'Inter',fontWeight:700,fontSize:16,color:pipeLF>200000?'#991B1B':pipeLF>100000?'#B45309':'#065F46'}}>{pipeLF.toLocaleString()} LF</span><span style={{fontSize:12,color:'#6B6056'}}>in pipeline</span><div style={{flex:1}}><PBar pct={Math.min(pipeLF/200000*100,100)} color={pipeLF>200000?'#991B1B':pipeLF>100000?'#B45309':'#065F46'} h={8}/></div></div>
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><span style={{fontSize:11,color:'#9E9B96',fontWeight:600,textTransform:'uppercase'}}>Group By:</span>{[{key:'status',label:'Status'},{key:'customer_name',label:'Customer'},{key:'style',label:'Style'},{key:'color',label:'Color'}].map(g=><button key={g.key} onClick={()=>setGroupBy(g.key)} style={gpill(groupBy===g.key)}>{g.label}</button>)}</div>
    <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputS,width:180,padding:'6px 10px',fontSize:12}}/><button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}{!isS&&<><span style={{color:'#E5E3E0'}}>|</span><button onClick={()=>setStatusF(null)} style={fpill(!statusF)}>All</button>{STS.map(s=><button key={s} onClick={()=>setStatusF(s)} style={fpill(statusF===s)}>{SS[s]}</button>)}</>}</div>
    <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(colArr.length,4)},1fr)`,gap:12,alignItems:'flex-start'}}>{colArr.map(col=>{const cv=col.jobs.reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);const lf=col.jobs.reduce((x,j)=>x+n(j.total_lf),0);return<div key={col.key}><div style={{background:col.bg||'#FDF4F4',border:`1px solid ${col.color}30`,borderRadius:12,padding:'12px 14px',marginBottom:8}}><div style={{fontFamily:'Inter',fontWeight:800,fontSize:14,color:col.color,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{col.label}</div><div style={{fontSize:11,color:'#6B6056',marginTop:2}}><span style={{background:'#E5E3E0',padding:'1px 6px',borderRadius:4,fontWeight:700,marginRight:6}}>{col.jobs.length}</span>{lf.toLocaleString()} LF · {$k(cv)}</div></div><div style={{maxHeight:'calc(100vh-300px)',overflow:'auto'}}>{col.jobs.map(j=><ProdCard key={j.id} j={j} move={move}/>)}</div></div>;})}</div>
  </div>);
}

/* ═══ REPORTS PAGE ═══ */
function ReportsPage({jobs}){
  const[activeRpt,setActiveRpt]=useState(null);const active=useMemo(()=>jobs.filter(j=>j.status!=='complete'),[jobs]);
  const reports=[{id:'ltb_rep',title:'Left to Bill by Sales Rep',desc:'Balance per rep'},{id:'aging',title:'Billing Aging',desc:'Unbilled projects by age'},{id:'lf_week',title:'LF by Week',desc:'LF scheduled by week'},{id:'pipeline',title:'Pipeline by Market',desc:'Values by status & market'},{id:'revenue',title:'Revenue vs Pipeline',desc:'Billed vs remaining'},{id:'prod_sched',title:'Production Schedule',desc:'Queued & in-production'},{id:'change_orders',title:'Change Orders Summary',desc:'All change order activity'},{id:'rep_matrix',title:'Rep × Market Matrix',desc:'Cross-tab by rep and market'}];
  const renderReport=()=>{
    if(activeRpt==='ltb_rep'){const reps={};active.forEach(j=>{const r=j.sales_rep||'Unassigned';if(!reps[r])reps[r]={rep:r,count:0,tc:0,ytd:0,ltb:0};reps[r].count++;reps[r].tc+=n(j.adj_contract_value||j.contract_value);reps[r].ytd+=n(j.ytd_invoiced);reps[r].ltb+=n(j.left_to_bill);});const data=Object.values(reps).sort((a,b)=>b.ltb-a.ltb);return<div><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Rep','Projects','Contract','YTD','LTB','%'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{data.map(r=><tr key={r.rep} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:8,fontWeight:600}}>{r.rep}</td><td style={{padding:8}}>{r.count}</td><td style={{padding:8,fontFamily:'Inter',fontWeight:700}}>{$(r.tc)}</td><td style={{padding:8}}>{$(r.ytd)}</td><td style={{padding:8,fontFamily:'Inter',fontWeight:700,color:'#8B2020'}}>{$(r.ltb)}</td><td style={{padding:8}}>{r.tc>0?Math.round(r.ytd/r.tc*100):0}%</td></tr>)}</tbody></table><div style={{marginTop:16}}><ResponsiveContainer width="100%" height={200}><BarChart data={data} barSize={30}><XAxis dataKey="rep" tick={{fill:'#6B6056',fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>$k(v)}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Bar dataKey="ltb" fill="#8B2020" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></div>;}
    if(activeRpt==='aging'){const unbilled=active.filter(j=>n(j.pct_billed)===0);const bkts={'Not Started':unbilled.filter(j=>n(j.contract_age)<30),Watch:unbilled.filter(j=>n(j.contract_age)>=30&&n(j.contract_age)<60),Overdue:unbilled.filter(j=>n(j.contract_age)>=60&&n(j.contract_age)<90),Critical:unbilled.filter(j=>n(j.contract_age)>=90)};const colors={'Not Started':'#9E9B96',Watch:'#B45309',Overdue:'#C2410C',Critical:'#991B1B'};return<div>{Object.entries(bkts).map(([name,bj])=>bj.length>0&&<div key={name} style={{marginBottom:16}}><div style={{fontFamily:'Inter',fontWeight:700,color:colors[name],marginBottom:6}}>{name} ({bj.length}) — {$(bj.reduce((s,j)=>s+n(j.contract_value),0))}</div><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><tbody>{bj.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2',borderLeft:`3px solid ${colors[name]}`}}><td style={{padding:'6px 8px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.contract_value)}</td><td style={{padding:'6px 8px',color:colors[name]}}>{j.contract_age}d</td></tr>)}</tbody></table></div>)}</div>;}
    if(activeRpt==='pipeline'){const data=MKTS.map(m=>{const d={name:MS[m]};STS.forEach(s=>{d[s]=jobs.filter(j=>j.market===m&&j.status===s).reduce((x,j)=>x+n(j.adj_contract_value||j.contract_value),0);});return d;});return<ResponsiveContainer width="100%" height={300}><BarChart data={data}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>$k(v)}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/>{STS.map(s=><Bar key={s} dataKey={s} stackId="a" fill={SC[s]} name={SS[s]}/>)}</BarChart></ResponsiveContainer>;}
    if(activeRpt==='revenue'){const data=MKTS.map(m=>{const mj=active.filter(j=>j.market===m);return{name:MS[m],billed:mj.reduce((s,j)=>s+n(j.ytd_invoiced),0),remaining:mj.reduce((s,j)=>s+n(j.left_to_bill),0)};});return<ResponsiveContainer width="100%" height={260}><BarChart data={data} barSize={30}><XAxis dataKey="name" tick={{fill:'#6B6056',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>$k(v)}/><Tooltip formatter={v=>$(v)} contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/><Bar dataKey="billed" fill="#065F46" name="Billed" radius={[4,4,0,0]}/><Bar dataKey="remaining" fill="#B45309" name="Remaining" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>;}
    if(activeRpt==='prod_sched'){const pj=jobs.filter(j=>['in_production','production_queue'].includes(j.status)).sort((a,b)=>new Date(a.est_start_date||'9999')-new Date(b.est_start_date||'9999'));return<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Code','Project','Market','Fence','LF','Est Start','Rep','Contract','LTB'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{pj.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px'}}>{j.job_number}</td><td style={{padding:'6px 8px',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px'}}>{j.fence_type||'—'}</td><td style={{padding:'6px 8px'}}>{n(j.total_lf).toLocaleString()}</td><td style={{padding:'6px 8px'}}>{fD(j.est_start_date)}</td><td style={{padding:'6px 8px'}}>{j.sales_rep||'—'}</td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value||j.contract_value)}</td><td style={{padding:'6px 8px',color:'#8B2020',fontFamily:'Inter',fontWeight:700}}>{$(j.left_to_bill)}</td></tr>)}</tbody></table>;}
    if(activeRpt==='lf_week'){const weeks={};active.forEach(j=>{if(!j.est_start_date)return;const d=new Date(j.est_start_date);const mon=new Date(d);mon.setDate(mon.getDate()-mon.getDay()+1);const k=mon.toISOString().split('T')[0];if(!weeks[k])weeks[k]={week:k,total:0};MKTS.forEach(m=>{if(!weeks[k][m])weeks[k][m]=0;});weeks[k][j.market]=(weeks[k][j.market]||0)+n(j.total_lf);weeks[k].total+=n(j.total_lf);});const data=Object.values(weeks).sort((a,b)=>a.week.localeCompare(b.week)).slice(0,16);return<ResponsiveContainer width="100%" height={250}><BarChart data={data}><XAxis dataKey="week" tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>{const d=new Date(v);return`${d.getMonth()+1}/${d.getDate()}`;}} /><YAxis tick={{fill:'#6B6056',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#fff',border:'1px solid #E5E3E0',borderRadius:8}}/><Legend/>{MKTS.map(m=><Bar key={m} dataKey={m} stackId="a" fill={MC[m]} name={MS[m]}/>)}</BarChart></ResponsiveContainer>;}
    if(activeRpt==='change_orders'){const co=jobs.filter(j=>n(j.change_orders)!==0).sort((a,b)=>n(b.change_orders)-n(a.change_orders));return<table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Project','Market','Original','Change Orders','Adj. Contract','CO %'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{co.map(j=><tr key={j.id} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[j.market]||'#6B6056',MB[j.market]||'#F4F4F2')}>{MS[j.market]||'—'}</span></td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.contract_value)}</td><td style={{padding:'6px 8px',color:n(j.change_orders)>0?'#065F46':'#991B1B',fontFamily:'Inter',fontWeight:700}}>{$(j.change_orders)}</td><td style={{padding:'6px 8px',fontFamily:'Inter',fontWeight:700}}>{$(j.adj_contract_value)}</td><td style={{padding:'6px 8px'}}>{n(j.contract_value)>0?Math.round(n(j.change_orders)/n(j.contract_value)*100):0}%</td></tr>)}</tbody></table>;}
    if(activeRpt==='rep_matrix'){const matrix={};jobs.forEach(j=>{const r=j.sales_rep||'Unassigned';const m=j.market||'Other';if(!matrix[r])matrix[r]={};if(!matrix[r][m])matrix[r][m]={count:0,val:0};matrix[r][m].count++;matrix[r][m].val+=n(j.adj_contract_value||j.contract_value);});const repKeys=Object.keys(matrix).sort();const allMkts=[...MKTS,'Other'];const maxVal=Math.max(...repKeys.flatMap(r=>allMkts.map(m=>matrix[r]?.[m]?.val||0)),1);return<div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr><th style={{padding:8,textAlign:'left',borderBottom:'2px solid #E5E3E0',color:'#6B6056',fontWeight:600,fontSize:11}}>Rep</th>{allMkts.map(m=><th key={m} style={{padding:8,textAlign:'center',borderBottom:'2px solid #E5E3E0',color:'#6B6056',fontWeight:600,fontSize:11}}>{MS[m]||m}</th>)}</tr></thead><tbody>{repKeys.map(r=><tr key={r} style={{borderBottom:'1px solid #F4F4F2'}}><td style={{padding:'6px 8px',fontWeight:600}}>{r}</td>{allMkts.map(m=>{const cell=matrix[r]?.[m];const intensity=cell?Math.min(cell.val/maxVal,1):0;return<td key={m} style={{padding:'6px 8px',textAlign:'center',background:`rgba(139,32,32,${intensity*0.15})`}}>{cell?<div><div style={{fontWeight:700}}>{cell.count}</div><div style={{fontSize:10,color:'#6B6056'}}>{$k(cell.val)}</div></div>:'—'}</td>;})}</tr>)}</tbody></table></div>;}
    return null;
  };
  return(<div><h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900,marginBottom:20}}>Reports</h1><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>{reports.map(r=><div key={r.id} style={{...card,display:'flex',flexDirection:'column',justifyContent:'space-between'}}><div><div style={{fontFamily:'Inter',fontWeight:700,fontSize:14,marginBottom:4}}>{r.title}</div><div style={{fontSize:12,color:'#6B6056',marginBottom:12}}>{r.desc}</div></div><button onClick={()=>setActiveRpt(activeRpt===r.id?null:r.id)} style={activeRpt===r.id?btnP:btnS}>{activeRpt===r.id?'Close':'Run'}</button></div>)}</div>{activeRpt&&<div style={card}>{renderReport()}</div>}</div>);
}

/* ═══ SCHEDULE PAGE ═══ */
function SchedulePage({jobs}){
  const[events,setEvents]=useState([]);const[view,setView]=useState('calendar');const[month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));const[showAdd,setShowAdd]=useState(false);const[mktF,setMktF]=useState(null);const[editEvt,setEditEvt]=useState(null);
  const[form,setForm]=useState({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});const[jobSearch,setJobSearch]=useState('');
  const fetchEvents=useCallback(async()=>{const d=await sbGet('schedule_events','order=scheduled_date.asc');setEvents(d||[]);},[]);
  useEffect(()=>{fetchEvents();},[fetchEvents]);
  const filteredEvents=mktF?events.filter(e=>e.market===mktF):events;
  const saveEvent=async e=>{e.preventDefault();const job=jobs.find(j=>j.id===form.job_id);if(!job&&!editEvt)return;const body={...form,job_number:job?.job_number||editEvt?.job_number,job_name:job?.job_name||editEvt?.job_name,market:job?.market||editEvt?.market,color:MC[job?.market||editEvt?.market]||'#8B2020',lf_scheduled:n(form.lf_scheduled)};if(editEvt){await sbPatch('schedule_events',editEvt.id,body);}else{await sbPost('schedule_events',body);}setShowAdd(false);setEditEvt(null);setForm({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});setJobSearch('');fetchEvents();};
  const deleteEvent=async id=>{if(!window.confirm('Delete this event?'))return;await sbDel('schedule_events',id);setEditEvt(null);setShowAdd(false);fetchEvents();};
  const openEdit=ev=>{setForm({job_id:ev.job_id||'',event_type:ev.event_type||'production_start',scheduled_date:ev.scheduled_date||'',end_date:ev.end_date||'',assigned_to:ev.assigned_to||'',crew:ev.crew||'',lf_scheduled:ev.lf_scheduled||'',notes:ev.notes||''});setJobSearch(ev.job_name||'');setEditEvt(ev);setShowAdd(true);};
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();const firstDay=new Date(month.getFullYear(),month.getMonth(),1).getDay();const today=new Date().toISOString().split('T')[0];
  const searchedJobs=jobSearch?jobs.filter(j=>`${j.job_number} ${j.job_name}`.toLowerCase().includes(jobSearch.toLowerCase())).slice(0,10):[];
  const getMonday=d=>{const dt=new Date(d);dt.setDate(dt.getDate()-dt.getDay()+1);return dt;};
  const weeks8=useMemo(()=>{const w=[];const s=getMonday(new Date());for(let i=0;i<8;i++){const d=new Date(s);d.setDate(d.getDate()+i*7);w.push(d);}return w;},[]);
  return(<div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h1 style={{fontFamily:'Syne',fontSize:24,fontWeight:900}}>Schedule</h1><div style={{display:'flex',gap:8}}><button onClick={()=>setView('calendar')} style={gpill(view==='calendar')}>Calendar</button><button onClick={()=>setView('list')} style={gpill(view==='list')}>List</button><button onClick={()=>{setEditEvt(null);setForm({job_id:'',event_type:'production_start',scheduled_date:'',end_date:'',assigned_to:'',crew:'',lf_scheduled:'',notes:''});setJobSearch('');setShowAdd(true);}} style={btnP}>+ Add Event</button></div></div>
    <div style={{display:'flex',gap:6,marginBottom:16}}><button onClick={()=>setMktF(null)} style={fpill(!mktF)}>All</button>{MKTS.map(m=><button key={m} onClick={()=>setMktF(m)} style={fpill(mktF===m)}>{MS[m]}</button>)}</div>
    <div style={{display:'flex',gap:20}}>
      <div style={{flex:1,minWidth:0}}>
        {view==='calendar'&&<><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} style={btnS}>← Prev</button><span style={{fontFamily:'Inter',fontWeight:800,fontSize:18}}>{month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span><div style={{display:'flex',gap:8}}><button onClick={()=>setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1))} style={btnS}>Today</button><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} style={btnS}>Next →</button></div></div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,background:'#E5E3E0',borderRadius:12,overflow:'hidden'}}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} style={{background:'#F9F8F6',padding:'6px 8px',fontSize:11,fontWeight:600,color:'#6B6056',textAlign:'center'}}>{d}</div>)}{Array.from({length:firstDay},(_,i)=><div key={`e${i}`} style={{background:'#FAFAF8',minHeight:80}}/>)}{Array.from({length:daysInMonth},(_,i)=>{const day=i+1;const ds=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const dayEv=filteredEvents.filter(e=>e.scheduled_date&&e.scheduled_date.startsWith(ds));const isToday=ds===today;const dayLF=dayEv.reduce((s,e)=>s+n(e.lf_scheduled),0);return<div key={day} style={{background:'#FFF',minHeight:80,padding:4,borderTop:isToday?'2px solid #8B2020':'none',position:'relative'}}><div style={{fontSize:11,fontWeight:isToday?800:400,color:isToday?'#8B2020':'#6B6056',marginBottom:2}}>{day}</div>{dayEv.slice(0,3).map(e=><div key={e.id} onClick={()=>openEdit(e)} style={{fontSize:9,padding:'1px 4px',borderRadius:3,marginBottom:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',background:(e.color||'#8B2020')+'20',color:e.color||'#8B2020',fontWeight:600,cursor:'pointer'}}>{e.job_name}</div>)}{dayEv.length>3&&<div style={{fontSize:9,color:'#9E9B96'}}>+{dayEv.length-3}</div>}{dayLF>0&&<div style={{position:'absolute',bottom:2,right:4,fontSize:9,color:'#9E9B96'}}>{dayLF.toLocaleString()} LF</div>}</div>;})}</div>
          <div style={{fontSize:11,color:'#9E9B96',marginTop:8,textAlign:'center'}}>Click any event to edit or reschedule</div>
        </>}
        {view==='list'&&<div style={card}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid #E5E3E0'}}>{['Date','Project','Market','Type','LF','Assigned','Notes'].map(h=><th key={h} style={{textAlign:'left',padding:8,color:'#6B6056',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{filteredEvents.map(e=><tr key={e.id} onClick={()=>openEdit(e)} style={{borderBottom:'1px solid #F4F4F2',cursor:'pointer'}} onMouseEnter={ev=>ev.currentTarget.style.background='#FDF9F6'} onMouseLeave={ev=>ev.currentTarget.style.background='transparent'}><td style={{padding:'6px 8px'}}>{fD(e.scheduled_date)}</td><td style={{padding:'6px 8px',fontWeight:500}}>{e.job_name}</td><td style={{padding:'6px 8px'}}><span style={pill(MC[e.market]||'#6B6056',MB[e.market]||'#F4F4F2')}>{MS[e.market]||'—'}</span></td><td style={{padding:'6px 8px'}}>{(e.event_type||'').replace(/_/g,' ')}</td><td style={{padding:'6px 8px'}}>{n(e.lf_scheduled).toLocaleString()}</td><td style={{padding:'6px 8px'}}>{e.assigned_to||'—'}</td><td style={{padding:'6px 8px',color:'#9E9B96',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.notes||'—'}</td></tr>)}</tbody></table></div>}
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

/* ═══ TOPBAR ═══ */
function Topbar({jobs,live,onSearch}){
  const alerts=jobs.filter(j=>j.status!=='complete'&&n(j.contract_age)>30&&n(j.ytd_invoiced)===0);
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
const NAV=[{key:'dashboard',label:'Dashboard',icon:'▣'},{key:'projects',label:'Projects',icon:'◧'},{key:'billing',label:'Billing',icon:'$'},{key:'pm_billing',label:'PM Billing',icon:'◧'},{key:'production',label:'Production',icon:'⚙'},{key:'reports',label:'Reports',icon:'◑'},{key:'schedule',label:'Schedule',icon:'◷'}];

export default function App(){
  const[page,setPage]=useState('dashboard');const[jobs,setJobs]=useState([]);const[loading,setLoading]=useState(true);const[openJob,setOpenJob]=useState(null);const[showSearch,setShowSearch]=useState(false);const[sideCollapsed,setSideCollapsed]=useState(false);
  const fetchJobs=useCallback(async()=>{try{const d=await sbGet('jobs','select=*&order=created_at.desc');setJobs(d||[]);}catch(e){console.error(e);}setLoading(false);},[]);
  useEffect(()=>{fetchJobs();},[fetchJobs]);
  const live=useRealtime(setJobs);
  const isMobile=typeof window!=='undefined'&&window.innerWidth<768;
  const sideW=sideCollapsed||isMobile?48:220;
  return(
    <div style={{display:'flex',height:'100vh',overflow:'hidden',width:'100%'}}>
      <div style={{width:sideW,minWidth:sideW,maxWidth:sideW,flexShrink:0,background:'#1A1A1A',borderRight:'1px solid #2A2A2A',display:'flex',flexDirection:'column',overflow:'hidden',transition:'width .2s'}}>
        <div style={{padding:sideCollapsed?'16px 8px':'24px 20px 20px',textAlign:sideCollapsed?'center':'left'}}>
          {!sideCollapsed&&<><div style={{fontFamily:'Syne',fontSize:16,fontWeight:900,color:'#8B2020',whiteSpace:'nowrap',overflow:'hidden'}}>FENCECRETE</div><div style={{fontSize:10,color:'#9E9B96',letterSpacing:2,textTransform:'uppercase',whiteSpace:'nowrap'}}>Operations</div></>}
          {sideCollapsed&&<div style={{fontFamily:'Syne',fontSize:14,fontWeight:900,color:'#8B2020'}}>F</div>}
        </div>
        <nav style={{flex:1,padding:sideCollapsed?'0 4px':'0 8px',overflow:'auto'}}>{NAV.map(ni=><button key={ni.key} onClick={()=>setPage(ni.key)} title={ni.label} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:sideCollapsed?'10px 0':'10px 12px',marginBottom:2,borderRadius:8,border:'none',background:page===ni.key?'#8B202018':'transparent',color:page===ni.key?'#8B2020':'#9E9B96',fontSize:14,fontWeight:page===ni.key?600:400,cursor:'pointer',textAlign:'left',justifyContent:sideCollapsed?'center':'flex-start',borderLeft:page===ni.key?'3px solid #8B2020':'3px solid transparent'}}><span style={{fontSize:16,width:20,textAlign:'center'}}>{ni.icon}</span>{!sideCollapsed&&ni.label}</button>)}</nav>
        <div style={{padding:sideCollapsed?'8px':'16px 20px',borderTop:'1px solid #2A2A2A'}}>
          {!sideCollapsed&&<div style={{fontSize:11,color:'#6B6056',marginBottom:6}}>{jobs.length} projects</div>}
          <button onClick={()=>setSideCollapsed(!sideCollapsed)} style={{background:'#2A2A2A',border:'none',borderRadius:6,color:'#9E9B96',fontSize:11,cursor:'pointer',padding:'4px 10px',width:'100%'}}>{sideCollapsed?'→':'←'}</button>
        </div>
      </div>
      <div style={{flex:1,minWidth:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <Topbar jobs={jobs} live={live} onSearch={()=>setShowSearch(true)}/>
        <div style={{flex:1,overflow:'auto',padding:'24px 32px'}}>
          {loading?<div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'50vh',color:'#9E9B96'}}>Loading...</div>:<>
            {page==='dashboard'&&<Dashboard jobs={jobs}/>}
            {page==='projects'&&<ProjectsPage jobs={jobs} onRefresh={fetchJobs} openJob={openJob}/>}
            {page==='billing'&&<BillingPage jobs={jobs} onRefresh={fetchJobs}/>}
            {page==='pm_billing'&&<PMBillingPage jobs={jobs} onRefresh={fetchJobs}/>}
            {page==='production'&&<ProductionPage jobs={jobs} onRefresh={fetchJobs}/>}
            {page==='reports'&&<ReportsPage jobs={jobs}/>}
            {page==='schedule'&&<SchedulePage jobs={jobs}/>}
          </>}
        </div>
      </div>
      {showSearch&&<GlobalSearch jobs={jobs} onSelect={j=>{setOpenJob(j);setPage('projects');setShowSearch(false);}}/>}
    </div>
  );
}
