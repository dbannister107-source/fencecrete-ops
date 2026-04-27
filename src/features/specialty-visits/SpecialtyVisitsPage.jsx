// SpecialtyVisitsPage
//
// Max's dispatch worklist for welder + painter visits. Auto-spawned rows
// appear here when a job hits fence_complete (welder if WI/G addons, painter
// always). Max picks who's going + a date, then marks complete after the
// visit happens.
//
// Why this exists: ad-hoc scheduling was letting jobs fall through cracks —
// "fence is up, customer is calling about gates, nobody remembered to send
// the welder." This page is the single source of truth for "what specialty
// work is open across all 4 markets."
//
// Three sections, all on one page:
//   🔴 Needed     — auto-spawned, no person/date assigned yet
//   📅 Scheduled  — Max picked someone + a date; not done yet
//   ✓ Completed   — last 30 days, collapsed by default
//
// Mark a row "not_required" if the painter visit isn't needed for that job.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet, sbPatch } from '../../shared/sb';

const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const btnP = { padding: '8px 14px', background: '#8A261D', border: 'none', borderRadius: 8, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 12 };
const btnS = { padding: '6px 12px', background: '#F4F4F2', color: '#625650', border: '1px solid #E5E3E0', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 };
const inputS = { padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };

const MARKET_COLORS = {
  HOU: { bg: '#FEE2E2', fg: '#991B1B' },
  SA:  { bg: '#DBEAFE', fg: '#1D4ED8' },
  AUS: { bg: '#D1FAE5', fg: '#065F46' },
  DFW: { bg: '#FEF3C7', fg: '#854F0B' },
  CS:  { bg: '#EDE9FE', fg: '#6D28D9' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function daysBetween(iso1, iso2) {
  if (!iso1 || !iso2) return null;
  const d1 = new Date(iso1).getTime();
  const d2 = new Date(iso2).getTime();
  return Math.round((d2 - d1) / 86400000);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function VisitTypeBadge({ type }) {
  const isWelder = type === 'welder';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      background: isWelder ? '#FEF3C7' : '#DBEAFE',
      color: isWelder ? '#854F0B' : '#1D4ED8',
    }}>
      {isWelder ? '🔧 Welder' : '🎨 Painter'}
    </span>
  );
}

function MarketBadge({ market }) {
  const c = MARKET_COLORS[market] || { bg: '#F4F4F2', fg: '#625650' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg }}>
      {market || '—'}
    </span>
  );
}

function AssignPanel({ visit, job, roster, onCancel, onSaved }) {
  // Pre-fill from any existing values on the visit row
  const [assignedToId, setAssignedToId] = useState(visit.assigned_to_id || '');
  const [scheduledDate, setScheduledDate] = useState(visit.scheduled_date || '');
  const [scopeNotes, setScopeNotes] = useState(visit.scope_notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const eligibleRoster = useMemo(
    () => roster.filter(m => m.role === visit.visit_type),
    [roster, visit.visit_type]
  );

  const save = async () => {
    if (!assignedToId) { setErr('Please pick a person to assign.'); return; }
    if (!scheduledDate) { setErr('Please pick a date.'); return; }
    setSaving(true); setErr(null);
    try {
      const member = eligibleRoster.find(m => m.id === assignedToId);
      await sbPatch('specialty_visits', visit.id, {
        status: 'scheduled',
        assigned_to_id: assignedToId,
        assigned_to_name: member?.name || null,
        scheduled_date: scheduledDate,
        scope_notes: scopeNotes || null,
      });
      onSaved && onSaved();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: '#F9F8F6', border: '1px solid #E5E3E0', borderRadius: 8, padding: 14, marginTop: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#625650', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>
            Assign to
          </label>
          <select value={assignedToId} onChange={e => setAssignedToId(e.target.value)} style={inputS}>
            <option value="">— pick a {visit.visit_type} —</option>
            {eligibleRoster.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {eligibleRoster.length === 0 && (
            <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>
              ⚠ No {visit.visit_type}s in team_members. Add via Team page.
            </div>
          )}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#625650', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>
            Scheduled date
          </label>
          <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} style={inputS} />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 11, color: '#625650', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>
          Scope notes
        </label>
        <textarea value={scopeNotes} onChange={e => setScopeNotes(e.target.value)} rows={2} style={{ ...inputS, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>
      {err && <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btnS}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...btnP, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Schedule'}
        </button>
      </div>
    </div>
  );
}

function VisitRow({ visit, job, roster, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const ageDays = visit.status === 'needed'
    ? daysBetween(visit.created_at, new Date().toISOString())
    : null;
  const overdue = visit.status === 'scheduled' && visit.scheduled_date && visit.scheduled_date < todayIso();

  const markComplete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sbPatch('specialty_visits', visit.id, {
        status: 'completed',
        completed_date: todayIso(),
      });
      onChanged && onChanged();
    } catch (e) {
      alert('Mark complete failed: ' + (e.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const markNotRequired = async () => {
    if (busy) return;
    if (!window.confirm(`Mark this ${visit.visit_type} visit as NOT REQUIRED for ${job?.job_name || 'this job'}?`)) return;
    setBusy(true);
    try {
      await sbPatch('specialty_visits', visit.id, { status: 'not_required' });
      onChanged && onChanged();
    } catch (e) {
      alert('Update failed: ' + (e.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const reschedule = () => setExpanded(true);

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: '1px solid #F4F4F2',
      background: overdue ? '#FFFBEB' : '#FFF',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <VisitTypeBadge type={visit.visit_type} />
            <MarketBadge market={job?.market} />
            <span style={{ fontWeight: 700, fontSize: 14, color: '#1A1A1A' }}>
              {job?.job_name || `Job ${visit.job_id?.slice(0, 8)}`}
            </span>
            {job?.job_number && (
              <span style={{ fontSize: 11, color: '#9E9B96' }}>#{job.job_number}</span>
            )}
            {job?.pm && (
              <span style={{ fontSize: 11, color: '#625650', background: '#F4F4F2', padding: '1px 6px', borderRadius: 4 }}>
                {job.pm}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#625650', marginBottom: 6 }}>
            {visit.scope_notes || <span style={{ color: '#9E9B96' }}>(no scope notes)</span>}
          </div>
          {visit.status === 'needed' && ageDays !== null && (
            <div style={{ fontSize: 11, color: ageDays >= 7 ? '#991B1B' : ageDays >= 3 ? '#B45309' : '#9E9B96', fontWeight: 600 }}>
              {ageDays === 0 ? 'just now' : `${ageDays} day${ageDays === 1 ? '' : 's'} waiting`}
              {ageDays >= 7 && ' ⚠'}
            </div>
          )}
          {visit.status === 'scheduled' && (
            <div style={{ fontSize: 12, color: overdue ? '#991B1B' : '#1D4ED8', fontWeight: 600 }}>
              📅 {fmtDate(visit.scheduled_date)} · {visit.assigned_to_name || '(unassigned)'}
              {overdue && ' — OVERDUE'}
            </div>
          )}
          {visit.status === 'completed' && (
            <div style={{ fontSize: 12, color: '#065F46', fontWeight: 600 }}>
              ✓ Completed {fmtDate(visit.completed_date)} · {visit.assigned_to_name || '—'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {visit.status === 'needed' && (
            <>
              <button onClick={() => setExpanded(v => !v)} style={btnP} disabled={busy}>
                {expanded ? 'Cancel' : 'Assign'}
              </button>
              {visit.visit_type === 'painter' && (
                <button onClick={markNotRequired} style={btnS} disabled={busy} title="Mark not required (painter not needed for this job)">
                  Not needed
                </button>
              )}
            </>
          )}
          {visit.status === 'scheduled' && (
            <>
              <button onClick={markComplete} style={btnP} disabled={busy}>
                {busy ? '…' : '✓ Mark Complete'}
              </button>
              <button onClick={reschedule} style={btnS} disabled={busy}>
                Reschedule
              </button>
            </>
          )}
        </div>
      </div>
      {expanded && (
        <AssignPanel
          visit={visit}
          job={job}
          roster={roster}
          onCancel={() => setExpanded(false)}
          onSaved={() => { setExpanded(false); onChanged && onChanged(); }}
        />
      )}
    </div>
  );
}

function Section({ title, count, color, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          padding: '14px 18px',
          background: '#FFF',
          border: 'none',
          borderBottom: open ? '1px solid #E5E3E0' : 'none',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color }}>{title}</span>
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 12,
            background: color + '20',
            color,
            fontSize: 12,
            fontWeight: 700,
          }}>{count}</span>
        </div>
        <span style={{ fontSize: 14, color: '#9E9B96' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </div>
  );
}

export default function SpecialtyVisitsPage({ jobs }) {
  const [visits, setVisits] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState({ market: 'all', type: 'all' });

  const jobsById = useMemo(() => {
    const m = {};
    (jobs || []).forEach(j => { m[j.id] = j; });
    return m;
  }, [jobs]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [v, tm] = await Promise.all([
        sbGet('specialty_visits', 'select=*&order=created_at.desc&limit=500'),
        sbGet('team_members', 'select=id,name,email,role,active&active=eq.true&role=in.(welder,painter)&order=name.asc'),
      ]);
      setVisits(Array.isArray(v) ? v : []);
      setRoster(Array.isArray(tm) ? tm : []);
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Apply filters
  const filtered = useMemo(() => {
    return visits.filter(v => {
      if (filter.type !== 'all' && v.visit_type !== filter.type) return false;
      if (filter.market !== 'all') {
        const j = jobsById[v.job_id];
        if (!j || j.market !== filter.market) return false;
      }
      return true;
    });
  }, [visits, filter, jobsById]);

  // Bucket the filtered list
  const needed = filtered.filter(v => v.status === 'needed');
  const scheduled = filtered.filter(v => v.status === 'scheduled');
  const recentCompleted = filtered.filter(v => {
    if (v.status !== 'completed') return false;
    const days = daysBetween(v.completed_date, todayIso());
    return days !== null && days <= 30;
  });
  const notRequired = filtered.filter(v => v.status === 'not_required');

  // Sort
  needed.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest first
  scheduled.sort((a, b) => (a.scheduled_date || '9999') > (b.scheduled_date || '9999') ? 1 : -1); // soonest first
  recentCompleted.sort((a, b) => (b.completed_date || '') > (a.completed_date || '') ? 1 : -1); // most recent first

  const overdueScheduledCount = scheduled.filter(v => v.scheduled_date && v.scheduled_date < todayIso()).length;
  const oldestNeededDays = needed.length ? daysBetween(needed[0].created_at, new Date().toISOString()) : 0;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 28, color: '#1A1A1A', margin: 0, marginBottom: 4 }}>
          Specialty Visits
        </h1>
        <div style={{ fontSize: 13, color: '#625650' }}>
          Welder & painter dispatch. Auto-spawned when a job hits Fence Complete.
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #B45309' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#B45309' }}>{needed.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>🔴 Needed (waiting assignment)</div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #1D4ED8' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#1D4ED8' }}>{scheduled.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>📅 Scheduled
            {overdueScheduledCount > 0 && <span style={{ color: '#991B1B', fontWeight: 700 }}> · {overdueScheduledCount} overdue</span>}
          </div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #065F46' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#065F46' }}>{recentCompleted.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>✓ Completed (last 30d)</div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: `4px solid ${oldestNeededDays >= 7 ? '#991B1B' : '#9E9B96'}` }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: oldestNeededDays >= 7 ? '#991B1B' : '#1A1A1A' }}>
            {oldestNeededDays || 0}d
          </div>
          <div style={{ fontSize: 11, color: '#625650' }}>Oldest unassigned</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: '12px 18px', marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9E9B96', textTransform: 'uppercase', fontWeight: 700 }}>Type:</span>
          {['all', 'welder', 'painter'].map(t => (
            <button
              key={t}
              onClick={() => setFilter(f => ({ ...f, type: t }))}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: filter.type === t ? '1px solid #8A261D' : '1px solid #E5E3E0',
                background: filter.type === t ? '#FDF4F4' : '#FFF',
                color: filter.type === t ? '#8A261D' : '#625650',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9E9B96', textTransform: 'uppercase', fontWeight: 700 }}>Market:</span>
          {['all', 'HOU', 'SA', 'AUS', 'DFW', 'CS'].map(m => (
            <button
              key={m}
              onClick={() => setFilter(f => ({ ...f, market: m }))}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: filter.market === m ? '1px solid #8A261D' : '1px solid #E5E3E0',
                background: filter.market === m ? '#FDF4F4' : '#FFF',
                color: filter.market === m ? '#8A261D' : '#625650',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >{m}</button>
          ))}
        </div>
        <button onClick={load} style={{ ...btnS, marginLeft: 'auto' }} disabled={loading}>
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {err && (
        <div style={{ ...card, background: '#FEE2E2', borderColor: '#991B1B', color: '#991B1B', marginBottom: 16 }}>
          ⚠ {err}
        </div>
      )}

      {!loading && visits.length === 0 && !err && (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: '#625650' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>No specialty visits yet</div>
          <div style={{ fontSize: 13, color: '#9E9B96', maxWidth: 480, margin: '0 auto' }}>
            Visit rows are auto-created when a job moves to Fence Complete status. As soon as a fence install wraps up, this page will populate with welder + painter work.
          </div>
        </div>
      )}

      {!loading && visits.length > 0 && (
        <>
          <Section title="🔴 Needed — waiting for assignment" count={needed.length} color="#B45309" defaultOpen={true}>
            {needed.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#9E9B96', fontSize: 13 }}>
                ✓ All caught up — nothing waiting.
              </div>
            ) : (
              needed.map(v => <VisitRow key={v.id} visit={v} job={jobsById[v.job_id]} roster={roster} onChanged={load} />)
            )}
          </Section>

          <Section title="📅 Scheduled" count={scheduled.length} color="#1D4ED8" defaultOpen={true}>
            {scheduled.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#9E9B96', fontSize: 13 }}>
                Nothing on the schedule.
              </div>
            ) : (
              scheduled.map(v => <VisitRow key={v.id} visit={v} job={jobsById[v.job_id]} roster={roster} onChanged={load} />)
            )}
          </Section>

          <Section title="✓ Completed (last 30 days)" count={recentCompleted.length} color="#065F46" defaultOpen={false}>
            {recentCompleted.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#9E9B96', fontSize: 13 }}>
                Nothing completed in the last 30 days.
              </div>
            ) : (
              recentCompleted.map(v => <VisitRow key={v.id} visit={v} job={jobsById[v.job_id]} roster={roster} onChanged={load} />)
            )}
          </Section>

          {notRequired.length > 0 && (
            <Section title="✕ Not Required" count={notRequired.length} color="#9E9B96" defaultOpen={false}>
              {notRequired.map(v => <VisitRow key={v.id} visit={v} job={jobsById[v.job_id]} roster={roster} onChanged={load} />)}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
