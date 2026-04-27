// MyPlatePage
//
// Role-aware action center. Each user lands here and sees only the cards
// relevant to their role, populated with their own work. The goal is one
// scrollable feed that answers "what should I be doing right now?"
//
// Why this exists: the agentic spine has been growing card by card --
// Specialty Install for Max, CV Reconciliation for Amiee, AR review for
// Virginia/Jalen, kanban for PMs. Without a unifying surface, each tool
// is a separate URL. This page is the single landing pad that pulls
// from every worklist and presents only what's mine, sorted by urgency.
//
// Architecture:
// - One MyPlatePage component
// - N "card definitions" -- pure objects describing how to fetch + render
//   a single card. Each card declares which roles see it, its data fetcher,
//   and a render function for its preview.
// - The page reads the current user's email from useAuth, looks up their
//   role in team_members, then renders only the cards visible to that role.
// - "Open full list" buttons navigate via the onNavigate prop (passed down
//   to App.jsx's setPage).
//
// Roles vs cards (12 roles total today):
//   ceo, cfo                 -> see everything
//   contracts                -> contract review queue, CV recon, PIS
//   ar, ap                   -> AR review queue, aging billables
//   pm                       -> PMs see jobs in their market only
//   sales                    -> their own leads, stale proposals
//   production               -> Specialty Install + production_queue health
//   welder, painter          -> their own specialty assignments
//   admin, mechanic          -> generic "tasks assigned to me" only
//
// The page is intentionally NOT meant to replace existing pages. Each card
// has an "Open full list" link that takes you to the canonical worklist
// page (which has filters and bulk actions). My Plate is the "what's hot"
// summary; the dedicated pages are still where heavy lifting happens.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet } from '../../shared/sb';

// ============================================================
// Styling helpers (match existing pages -- Fencecrete brand)
// ============================================================
const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' };
const btnP = { padding: '6px 12px', background: '#8A261D', border: 'none', borderRadius: 6, color: '#FFF', fontWeight: 600, cursor: 'pointer', fontSize: 12 };

const URGENCY_COLORS = {
  high:   { bar: '#991B1B', bg: '#FEE2E2', fg: '#7F1D1D' },
  normal: { bar: '#854F0B', bg: '#FEF3C7', fg: '#854F0B' },
  low:    { bar: '#065F46', bg: '#D1FAE5', fg: '#065F46' },
};

const fmt$ = (n) => {
  const v = Number(n) || 0;
  return '$' + Math.round(v).toLocaleString();
};
const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

// ============================================================
// CARD WRAPPER -- shared chrome for every card
// ============================================================
function PlateCard({ icon, title, count, urgency, totalDollars, fullListPage, onNavigate, children, emptyMessage }) {
  const c = URGENCY_COLORS[urgency] || URGENCY_COLORS.normal;
  const isEmpty = !count;

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ background: c.bar, height: 3 }} />
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 24, lineHeight: 1, marginTop: 2 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>{title}</span>
            <span style={{ display: 'inline-block', padding: '1px 9px', borderRadius: 12, background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700 }}>
              {isEmpty ? '0' : count}
            </span>
            {totalDollars !== undefined && totalDollars > 0 && (
              <span style={{ fontSize: 11, color: '#625650' }}>· {fmt$(totalDollars)} total</span>
            )}
            <span style={{ flex: 1 }} />
            {fullListPage && !isEmpty && (
              <button onClick={() => onNavigate(fullListPage)} style={btnP}>Open full list →</button>
            )}
          </div>
          {isEmpty ? (
            <div style={{ fontSize: 12, color: '#9E9B96', fontStyle: 'italic' }}>{emptyMessage || 'Nothing here right now.'}</div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}

// Inline list-row used inside cards
function PreviewRow({ left, middle, right, onClick }) {
  return (
    <div onClick={onClick}
      style={{
        display: 'flex',
        gap: 8,
        padding: '6px 0',
        borderTop: '1px solid #F4F4F2',
        fontSize: 12,
        cursor: onClick ? 'pointer' : 'default',
        alignItems: 'center',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = '#FDF4F4'; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = 'transparent'; }}>
      <div style={{ flex: 1, minWidth: 0, color: '#1A1A1A', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {left}
      </div>
      {middle && <div style={{ color: '#625650', fontSize: 11, whiteSpace: 'nowrap' }}>{middle}</div>}
      {right && <div style={{ color: '#625650', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{right}</div>}
    </div>
  );
}

// ============================================================
// CARDS -- each one is a function returning <PlateCard>
// ============================================================

// 1. MY TASKS -- everyone
function MyTasksCard({ me, tasks, onNavigate }) {
  const myEmail = (me?.email || '').toLowerCase();
  const myName = (me?.name || '').toLowerCase();
  const mine = (tasks || []).filter(t => {
    if (t.status === 'completed') return false;
    const a = (t.assigned_to || '').toLowerCase();
    return a && (a === myEmail || a === myName || a.includes(myEmail) || a.includes(myName));
  });
  // Sort by overdue first, then due date
  mine.sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return da - db;
  });
  const overdueCount = mine.filter(t => t.due_date && new Date(t.due_date) < new Date()).length;
  return (
    <PlateCard
      icon="📋" title="My Tasks" count={mine.length}
      urgency={overdueCount > 0 ? 'high' : 'normal'}
      fullListPage="tasks" onNavigate={onNavigate}
      emptyMessage="No open tasks assigned to you."
    >
      {mine.slice(0, 5).map(t => {
        const overdue = t.due_date && new Date(t.due_date) < new Date();
        return (
          <PreviewRow key={t.id}
            left={t.title}
            middle={t.priority ? t.priority.toUpperCase() : null}
            right={t.due_date ? `${overdue ? '⚠ ' : ''}${t.due_date}` : 'no due date'}
          />
        );
      })}
    </PlateCard>
  );
}

// 2. SPECIALTY INSTALL -- production, ceo. Welders/painters see only theirs.
function SpecialtyCard({ me, specialty, onNavigate }) {
  const role = me?.role;
  let rows = (specialty || []).filter(s => s.status === 'needed' || s.status === 'scheduled');

  if (role === 'welder') {
    rows = rows.filter(s => s.visit_type === 'welder' && (s.assigned_to_id === me.id || !s.assigned_to_id));
  } else if (role === 'painter') {
    rows = rows.filter(s => s.visit_type === 'painter' && (s.assigned_to_id === me.id || !s.assigned_to_id));
  }
  // Sort: needed without scheduled date first, then by scheduled date
  rows.sort((a, b) => {
    if (a.status === 'needed' && b.status !== 'needed') return -1;
    if (b.status === 'needed' && a.status !== 'needed') return 1;
    const da = a.scheduled_date ? new Date(a.scheduled_date).getTime() : Infinity;
    const db = b.scheduled_date ? new Date(b.scheduled_date).getTime() : Infinity;
    return da - db;
  });
  const neededCount = rows.filter(r => r.status === 'needed').length;
  return (
    <PlateCard
      icon="🔧" title="Specialty Install" count={rows.length}
      urgency={neededCount > 2 ? 'high' : 'normal'}
      fullListPage="specialty_visits" onNavigate={onNavigate}
      emptyMessage="No welder or painter visits pending."
    >
      {rows.slice(0, 5).map(r => (
        <PreviewRow key={r.id}
          left={`${r.visit_type === 'welder' ? '🔥' : '🎨'} ${r.job_name || 'Unknown job'}`}
          middle={r.status === 'needed' ? 'NEEDED' : `→ ${r.scheduled_date || '?'}`}
          right={r.assigned_to_name || 'unassigned'}
        />
      ))}
    </PlateCard>
  );
}

// 3. AR REVIEW -- ar, cfo, ceo
function ARReviewCard({ submissions, onNavigate }) {
  const pending = (submissions || []).filter(s => !s.ar_reviewed);
  pending.sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0));
  const oldestDays = pending.length > 0 && pending[0].submitted_at ? daysSince(pending[0].submitted_at) : 0;
  return (
    <PlateCard
      icon="🧾" title="AR Review Queue" count={pending.length}
      urgency={oldestDays > 7 ? 'high' : 'normal'}
      fullListPage="billing" onNavigate={onNavigate}
      emptyMessage="All PM bill submissions are reviewed."
    >
      {pending.slice(0, 5).map(s => (
        <PreviewRow key={s.id}
          left={s.job_name}
          middle={s.pm}
          right={s.submitted_at ? `${daysSince(s.submitted_at)}d ago` : '?'}
        />
      ))}
    </PlateCard>
  );
}

// 4. CONTRACT RECONCILIATION -- contracts, cfo, ceo
function ReconciliationCard({ jobs, lineItems, onNavigate }) {
  const sumsByJob = {};
  (lineItems || []).forEach(li => {
    sumsByJob[li.job_id] = (sumsByJob[li.job_id] || 0) + (Number(li.line_value) || 0);
  });
  const gaps = [];
  (jobs || []).forEach(j => {
    if (['lost', 'canceled', 'cancelled'].includes(j.status)) return;
    if (j.cv_reconciliation_acked_at) {
      const ackedGap = Number(j.cv_reconciliation_acked_gap) || 0;
      const adj = Number(j.adj_contract_value) || 0;
      const lt = sumsByJob[j.id] || 0;
      const expected = (Number(j.bonds_amount)||0) + (Number(j.permits_amount)||0)
                     + (Number(j.pp_bond_amount)||0) + (Number(j.maint_bond_amount)||0)
                     + (Number(j.sales_tax_amount)||0);
      const unexplained = (adj - lt) - expected;
      if (Math.abs(unexplained - ackedGap) <= 5000) return; // ack still valid
    }
    const adj = Number(j.adj_contract_value) || 0;
    const lt = sumsByJob[j.id] || 0;
    if (adj <= 0 || lt <= 0) return;
    const expected = (Number(j.bonds_amount)||0) + (Number(j.permits_amount)||0)
                   + (Number(j.pp_bond_amount)||0) + (Number(j.maint_bond_amount)||0)
                   + (Number(j.sales_tax_amount)||0);
    const unexplained = (adj - lt) - expected;
    if (Math.abs(unexplained) < 10000) return; // only "real" or worse
    gaps.push({ ...j, unexplained });
  });
  gaps.sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained));
  const hugeCount = gaps.filter(g => Math.abs(g.unexplained) >= 250000).length;
  return (
    <PlateCard
      icon="⚖️" title="Contract Reconciliation" count={gaps.length}
      urgency={hugeCount > 0 ? 'high' : 'normal'}
      fullListPage="cv_reconciliation" onNavigate={onNavigate}
      emptyMessage="No unexplained contract gaps. ✓"
    >
      {gaps.slice(0, 5).map(g => (
        <PreviewRow key={g.id}
          left={g.job_name}
          middle={g.market}
          right={fmt$(g.unexplained)}
        />
      ))}
    </PlateCard>
  );
}

// 5. PIS PENDING -- contracts, pm (their market), ceo
function PISPendingCard({ me, jobs, pisSheets, onNavigate }) {
  const role = me?.role;
  // Jobs with executed contracts but no PIS
  const sentJobIds = new Set((pisSheets || []).map(p => p.job_id));
  let rows = (jobs || []).filter(j => {
    if (!j.contract_executed) return false;
    if (sentJobIds.has(j.id)) return false;
    if (j.status !== 'contract_review' && j.status !== 'production_queue') return false;
    return true;
  });
  if (role === 'pm') {
    rows = rows.filter(j => j.pm === me.name);
  }
  rows.sort((a, b) => new Date(a.contract_date || 0) - new Date(b.contract_date || 0));
  return (
    <PlateCard
      icon="📋" title="PIS Pending" count={rows.length}
      urgency={rows.length > 5 ? 'high' : 'normal'}
      fullListPage="projects" onNavigate={onNavigate}
      emptyMessage="All executed contracts have a PIS submitted. ✓"
    >
      {rows.slice(0, 5).map(j => (
        <PreviewRow key={j.id}
          left={j.job_name}
          middle={j.pm}
          right={j.contract_date ? `executed ${daysSince(j.contract_date)}d ago` : 'no contract date'}
        />
      ))}
    </PlateCard>
  );
}

// 6. STALE PRODUCTION QUEUE -- pm (their market), production, ceo
function StaleProductionCard({ me, jobs, onNavigate }) {
  const role = me?.role;
  let rows = (jobs || []).filter(j => {
    if (j.status !== 'production_queue') return false;
    const d = daysSince(j.updated_at);
    return d !== null && d > 7;
  });
  if (role === 'pm') {
    rows = rows.filter(j => j.pm === me.name);
  }
  rows.sort((a, b) => new Date(a.updated_at || 0) - new Date(b.updated_at || 0));
  const reallyStale = rows.filter(j => daysSince(j.updated_at) > 14).length;
  return (
    <PlateCard
      icon="⏰" title="Stale in Production Queue" count={rows.length}
      urgency={reallyStale > 0 ? 'high' : 'normal'}
      fullListPage="production_planning" onNavigate={onNavigate}
      emptyMessage="No jobs sitting in production queue >7 days."
    >
      {rows.slice(0, 5).map(j => (
        <PreviewRow key={j.id}
          left={j.job_name}
          middle={j.pm || 'no PM'}
          right={`${daysSince(j.updated_at)}d`}
        />
      ))}
    </PlateCard>
  );
}

// 7. AGING BILLABLES -- ar, cfo, ceo
function AgingBillablesCard({ jobs, onNavigate }) {
  const ACTIVE_BILLABLE = ['contract_review','production_queue','in_production','material_ready','active_install','fence_complete'];
  const rows = (jobs || []).filter(j => {
    if (!ACTIVE_BILLABLE.includes(j.status)) return false;
    const ltb = Number(j.left_to_bill) || 0;
    if (ltb <= 0) return false;
    if (!j.last_billed) {
      // never billed -- check contract age
      const cd = daysSince(j.contract_date);
      return cd !== null && cd > 30;
    }
    const d = daysSince(j.last_billed);
    return d !== null && d >= 30;
  });
  rows.forEach(j => {
    j.__days = j.last_billed ? daysSince(j.last_billed) : daysSince(j.contract_date);
    j.__never = !j.last_billed;
  });
  rows.sort((a, b) => (b.__days || 0) - (a.__days || 0));
  const over90 = rows.filter(j => j.__days >= 90).length;
  const totalLTB = rows.reduce((s, j) => s + (Number(j.left_to_bill) || 0), 0);
  return (
    <PlateCard
      icon="💰" title="Aging Billables" count={rows.length}
      urgency={over90 > 0 ? 'high' : 'normal'}
      totalDollars={totalLTB}
      fullListPage="billing" onNavigate={onNavigate}
      emptyMessage="No active jobs with stale billing. ✓"
    >
      {rows.slice(0, 5).map(j => (
        <PreviewRow key={j.id}
          left={j.job_name}
          middle={j.__never ? `NEVER BILLED · contract ${j.__days}d old` : `${j.__days}d since last bill`}
          right={fmt$(j.left_to_bill)}
        />
      ))}
    </PlateCard>
  );
}

// 8. STALE LEADS -- sales (their own), ceo
function StaleLeadsCard({ me, leads, onNavigate }) {
  const role = me?.role;
  const myName = (me?.name || '').toLowerCase();
  let rows = (leads || []).filter(l => {
    if (['won', 'lost'].includes(l.stage)) return false;
    const ts = l.last_outreach_at || l.stage_entered_at;
    if (!ts) return false;
    return daysSince(ts) > 14;
  });
  if (role === 'sales') {
    rows = rows.filter(l => (l.sales_rep || '').toLowerCase() === myName);
  }
  rows.sort((a, b) => {
    const ta = new Date(a.last_outreach_at || a.stage_entered_at || 0).getTime();
    const tb = new Date(b.last_outreach_at || b.stage_entered_at || 0).getTime();
    return ta - tb;
  });
  const reallyStale = rows.filter(l => daysSince(l.last_outreach_at || l.stage_entered_at) > 30).length;
  const totalValue = rows.reduce((s, l) => s + (Number(l.estimated_value || l.proposal_value) || 0), 0);
  return (
    <PlateCard
      icon="📞" title="Stale Leads (>14 days)" count={rows.length}
      urgency={reallyStale > 3 ? 'high' : 'normal'}
      totalDollars={totalValue}
      fullListPage="sales_pipeline" onNavigate={onNavigate}
      emptyMessage="No stale leads. ✓"
    >
      {rows.slice(0, 5).map(l => (
        <PreviewRow key={l.id}
          left={l.company_name}
          middle={l.stage}
          right={`${daysSince(l.last_outreach_at || l.stage_entered_at)}d`}
        />
      ))}
    </PlateCard>
  );
}

// 9. CONTRACTS AWAITING EXECUTION -- contracts, ceo
function ContractsPendingCard({ jobs, onNavigate }) {
  const rows = (jobs || []).filter(j => {
    if (j.status !== 'contract_review') return false;
    if (j.contract_executed) return false;
    return true;
  });
  rows.forEach(j => {
    j.__days = daysSince(j.contract_date) || 0;
  });
  rows.sort((a, b) => b.__days - a.__days);
  const overdue = rows.filter(j => j.__days > 7).length;
  return (
    <PlateCard
      icon="✍️" title="Contracts Awaiting Execution" count={rows.length}
      urgency={overdue > 3 ? 'high' : 'normal'}
      fullListPage="projects" onNavigate={onNavigate}
      emptyMessage="No contracts pending execution."
    >
      {rows.slice(0, 5).map(j => (
        <PreviewRow key={j.id}
          left={j.job_name}
          middle={j.market}
          right={j.contract_date ? `${j.__days}d` : 'no date'}
        />
      ))}
    </PlateCard>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function MyPlatePage({ jobs, auth, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [me, setMe] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [specialty, setSpecialty] = useState([]);
  const [leads, setLeads] = useState([]);
  const [pisSheets, setPisSheets] = useState([]);
  const [lineItems, setLineItems] = useState([]);

  const myEmail = (auth?.user?.email || '').toLowerCase().trim();

  const load = useCallback(async () => {
    if (!myEmail) { setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      // Resolve current user's team_member record
      const meRows = await sbGet('team_members', `email=ilike.${encodeURIComponent(myEmail)}&active=eq.true&limit=1`);
      const meRow = (meRows && meRows[0]) || null;
      setMe(meRow);

      const role = meRow?.role || null;
      // Decide which data each role needs to load
      const promises = [
        sbGet('tasks', 'status=neq.completed&select=*&limit=500'),  // everyone gets tasks
      ];
      const dataKeys = ['tasks'];
      const isLeadership = role === 'ceo' || role === 'cfo';
      const wantsAR = isLeadership || role === 'ar' || role === 'ap';
      const wantsRecon = isLeadership || role === 'contracts';
      const wantsSpecialty = isLeadership || role === 'production' || role === 'welder' || role === 'painter';
      const wantsPIS = isLeadership || role === 'contracts' || role === 'pm';
      const wantsLeads = isLeadership || role === 'sales';

      if (wantsAR) {
        promises.push(sbGet('pm_bill_submissions', 'select=id,job_id,job_name,job_number,pm,market,submitted_at,ar_reviewed&order=submitted_at.asc.nullsfirst&limit=500'));
        dataKeys.push('submissions');
      }
      if (wantsSpecialty) {
        promises.push(sbGet('specialty_visits', 'select=*,jobs(job_name)&limit=500'));
        dataKeys.push('specialty');
      }
      if (wantsLeads) {
        promises.push(sbGet('leads', 'select=*&limit=500'));
        dataKeys.push('leads');
      }
      if (wantsPIS) {
        promises.push(sbGet('project_info_sheets', 'select=job_id&limit=2000'));
        dataKeys.push('pisSheets');
      }
      if (wantsRecon) {
        promises.push(sbGet('job_line_items', 'select=job_id,line_value&limit=10000'));
        dataKeys.push('lineItems');
      }

      const results = await Promise.all(promises);
      const out = {};
      dataKeys.forEach((k, i) => { out[k] = results[i] || []; });
      setTasks(out.tasks || []);
      setSubmissions(out.submissions || []);
      // Flatten the joined job_name into the specialty rows
      setSpecialty((out.specialty || []).map(s => ({ ...s, job_name: s.jobs?.job_name || s.job_name })));
      setLeads(out.leads || []);
      setPisSheets(out.pisSheets || []);
      setLineItems(out.lineItems || []);
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [myEmail]);

  useEffect(() => { load(); }, [load]);

  const role = me?.role;
  const isLeadership = role === 'ceo' || role === 'cfo';

  // Decide which cards to render based on role
  const showTasks       = !!role;                                // everyone
  const showSpecialty   = isLeadership || role === 'production' || role === 'welder' || role === 'painter';
  const showAR          = isLeadership || role === 'ar' || role === 'ap';
  const showRecon       = isLeadership || role === 'contracts';
  const showPIS         = isLeadership || role === 'contracts' || role === 'pm';
  const showStaleProd   = isLeadership || role === 'production' || role === 'pm';
  const showAging       = isLeadership || role === 'ar' || role === 'ap';
  const showStaleLeads  = isLeadership || role === 'sales';
  const showContractExe = isLeadership || role === 'contracts';

  // Compute total open-action count for the header
  const totalOpenActions = useMemo(() => {
    // Rough estimate: count items each visible card would show
    let n = 0;
    if (showTasks) {
      const myEmailLower = myEmail;
      const myNameLower = (me?.name || '').toLowerCase();
      n += (tasks || []).filter(t => {
        const a = (t.assigned_to || '').toLowerCase();
        return a && (a === myEmailLower || a === myNameLower);
      }).length;
    }
    return n; // rough; the cards themselves show accurate counts
  }, [showTasks, tasks, myEmail, me]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#625650' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
        Loading your plate...
      </div>
    );
  }

  if (!me) {
    return (
      <div>
        <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 28, color: '#1A1A1A', margin: 0, marginBottom: 8 }}>My Plate</h1>
        <div style={{ ...card, padding: 24, marginTop: 16 }}>
          <div style={{ fontSize: 14, color: '#625650', marginBottom: 8 }}>
            We couldn't find a team_members record for <b>{myEmail || '(unknown email)'}</b>, so My Plate doesn't know what to show you.
          </div>
          <div style={{ fontSize: 12, color: '#9E9B96' }}>
            Ask David to add you to the team_members table, or use the dedicated pages in the sidebar in the meantime.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 28, color: '#1A1A1A', margin: 0, marginBottom: 4 }}>
          My Plate
        </h1>
        <div style={{ fontSize: 13, color: '#625650' }}>
          Hello, {me.name}. Here's what's on your plate today
          {role && <> · <span style={{ background: '#F4F4F2', padding: '1px 8px', borderRadius: 4, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: '#625650' }}>{role}</span></>}
        </div>
      </div>

      {err && (
        <div style={{ ...card, background: '#FEE2E2', borderColor: '#991B1B', color: '#991B1B', padding: 12, marginBottom: 16 }}>
          ⚠ {err}
        </div>
      )}

      {showTasks && <MyTasksCard me={me} tasks={tasks} onNavigate={onNavigate} />}
      {showAR && <ARReviewCard submissions={submissions} onNavigate={onNavigate} />}
      {showSpecialty && <SpecialtyCard me={me} specialty={specialty} onNavigate={onNavigate} />}
      {showRecon && <ReconciliationCard jobs={jobs} lineItems={lineItems} onNavigate={onNavigate} />}
      {showAging && <AgingBillablesCard jobs={jobs} onNavigate={onNavigate} />}
      {showContractExe && <ContractsPendingCard jobs={jobs} onNavigate={onNavigate} />}
      {showPIS && <PISPendingCard me={me} jobs={jobs} pisSheets={pisSheets} onNavigate={onNavigate} />}
      {showStaleProd && <StaleProductionCard me={me} jobs={jobs} onNavigate={onNavigate} />}
      {showStaleLeads && <StaleLeadsCard me={me} leads={leads} onNavigate={onNavigate} />}

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#9E9B96' }}>
        My Plate auto-refreshes when you reload the page. Counts may differ slightly from canonical pages while data is in flight.
      </div>
    </div>
  );
}
