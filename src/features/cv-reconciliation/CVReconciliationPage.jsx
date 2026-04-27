// CVReconciliationPage
//
// Worklist for Amiee + Jalen to reconcile jobs where adj_contract_value
// disagrees with the sum of job_line_items by more than tax/bonds/permits
// can legitimately explain.
//
// Why this exists: an audit on 2026-04-27 found ~115 active jobs with
// unexplained contract-value gaps totaling ~$8M, including 6 jobs with
// individual gaps over $250K. These came from Excel imports (and
// VP-era data) where line_items were not always populated or were
// out of sync with the imported adj_contract_value. The Wildrye LS #1
// case was the trigger: net_contract_value was $206K but proposal +
// line items said $54K. AR was about to bill against the wrong number.
//
// How the gap is computed:
//   actual_gap   = adj_contract_value - SUM(line_items.line_value)
//   expected_gap = tax + bonds + permits + pp_bond + maint_bond
//   unexplained  = actual_gap - expected_gap
//
// Severity buckets (matches the 2026-04-27 audit):
//   minor   $1K  - $10K
//   real    $10K - $50K
//   big     $50K - $250K
//   huge    >$250K
//
// What Amiee/Jalen do here:
//   - Open the worklist, sorted by impact (biggest first)
//   - Click a row to see the breakdown
//   - Click "Open in Projects" to fix the line items or net_cv directly
//     in the existing edit panel (where they already know the workflow)
//   - When a job's gap is intentional (legitimate untracked tax/bond),
//     click "Acknowledge" so it leaves the list. If the gap later changes
//     by more than $5K, the ack is treated as stale and it reappears.
//
// What this page deliberately does NOT do:
//   - It does NOT auto-fix anything. All edits go through existing UI
//     so audit trails (activity_log) capture the changes the way they
//     would for any other manual edit.
//   - It does NOT add a trigger that recomputes net_cv from line_items.
//     That trigger is the Phase 2 fix and is only safe AFTER the
//     historical mess is cleaned up. Adding it now would silently
//     corrupt jobs where line_items are incomplete (nukes contract value).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet, sbPatch } from '../../shared/sb';

const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const btnP = { padding: '8px 14px', background: '#8A261D', border: 'none', borderRadius: 8, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 12 };
const btnS = { padding: '6px 12px', background: '#F4F4F2', color: '#625650', border: '1px solid #E5E3E0', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 };
const inputS = { padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };

const ACK_DRIFT_THRESHOLD = 5000;     // gap can move $5K from ack baseline before ack is stale
const SEVERITY_FLOOR = 1000;          // gaps under $1K are not shown — too noisy
const PCT_FLOOR = 0.10;               // gaps under 10% of contract are not shown — likely tax noise

const MARKET_COLORS = {
  HOU: { bg: '#FEE2E2', fg: '#991B1B' },
  SA:  { bg: '#DBEAFE', fg: '#1D4ED8' },
  AUS: { bg: '#D1FAE5', fg: '#065F46' },
  DFW: { bg: '#FEF3C7', fg: '#854F0B' },
  CS:  { bg: '#EDE9FE', fg: '#6D28D9' },
};

const fmt$ = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return sign + '$' + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

function severity(unexplainedAbs) {
  if (unexplainedAbs >= 250000) return { key: 'huge',  label: '🚨 Huge',  bg: '#7F1D1D', fg: '#FFF' };
  if (unexplainedAbs >= 50000)  return { key: 'big',   label: '🔴 Big',   bg: '#991B1B', fg: '#FFF' };
  if (unexplainedAbs >= 10000)  return { key: 'real',  label: '🟠 Real',  bg: '#B45309', fg: '#FFF' };
  if (unexplainedAbs >= 1000)   return { key: 'minor', label: '🟡 Minor', bg: '#854F0B', fg: '#FEF3C7' };
  return                            { key: 'clean', label: '✓ Clean', bg: '#065F46', fg: '#FFF' };
}

function MarketBadge({ market }) {
  const c = MARKET_COLORS[market] || { bg: '#F4F4F2', fg: '#625650' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg }}>
      {market || '—'}
    </span>
  );
}

function SeverityBadge({ unexplained }) {
  const s = severity(Math.abs(unexplained));
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function ReconRow({ row, onOpenProject, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [ackPanelOpen, setAckPanelOpen] = useState(false);
  const [ackNotes, setAckNotes] = useState('');
  const [ackedBy, setAckedBy] = useState('');
  const [err, setErr] = useState(null);

  const acknowledge = async () => {
    if (!ackedBy.trim()) { setErr('Please put your name in the "Acknowledged by" field.'); return; }
    setBusy(true); setErr(null);
    try {
      await sbPatch('jobs', row.id, {
        cv_reconciliation_acked_at: new Date().toISOString(),
        cv_reconciliation_acked_gap: row.unexplained,
        cv_reconciliation_acked_by: ackedBy.trim(),
        cv_reconciliation_notes: ackNotes.trim() || null,
      });
      setAckPanelOpen(false);
      onChanged && onChanged();
    } catch (e) {
      setErr(e.message || 'Acknowledge failed');
    } finally {
      setBusy(false);
    }
  };

  const isStaleAck = row.cv_reconciliation_acked_at &&
    Math.abs(row.unexplained - (Number(row.cv_reconciliation_acked_gap) || 0)) > ACK_DRIFT_THRESHOLD;

  return (
    <div style={{
      padding: '14px 16px',
      borderBottom: '1px solid #F4F4F2',
      background: isStaleAck ? '#FFFBEB' : '#FFF',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <SeverityBadge unexplained={row.unexplained} />
            <MarketBadge market={row.market} />
            <span style={{ fontWeight: 700, fontSize: 14, color: '#1A1A1A' }}>{row.job_name || `Job ${row.id?.slice(0, 8)}`}</span>
            {row.job_number && <span style={{ fontSize: 11, color: '#9E9B96' }}>#{row.job_number}</span>}
            {row.pm && <span style={{ fontSize: 11, color: '#625650', background: '#F4F4F2', padding: '1px 6px', borderRadius: 4 }}>{row.pm}</span>}
            {row.status && <span style={{ fontSize: 11, color: '#1D4ED8', background: '#DBEAFE', padding: '1px 6px', borderRadius: 4 }}>{row.status}</span>}
            {isStaleAck && (
              <span style={{ fontSize: 11, color: '#B45309', background: '#FEF3C7', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                ⚠ Ack stale — gap moved
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontSize: 12, marginBottom: 8 }}>
            <div>
              <div style={{ color: '#9E9B96', textTransform: 'uppercase', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Adj Contract</div>
              <div style={{ fontWeight: 700, color: '#1A1A1A', fontFamily: 'Inter' }}>{fmt$(row.adj_cv)}</div>
            </div>
            <div>
              <div style={{ color: '#9E9B96', textTransform: 'uppercase', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Line Items Sum</div>
              <div style={{ fontWeight: 700, color: '#1A1A1A', fontFamily: 'Inter' }}>
                {fmt$(row.line_total)}
                <span style={{ color: '#9E9B96', fontSize: 10, fontWeight: 500, marginLeft: 4 }}>({row.line_count || 0} lines)</span>
              </div>
            </div>
            <div>
              <div style={{ color: '#9E9B96', textTransform: 'uppercase', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Tax + Bonds + Permits</div>
              <div style={{ fontWeight: 600, color: '#625650', fontFamily: 'Inter' }}>{fmt$(row.expected_gap)}</div>
            </div>
            <div>
              <div style={{ color: '#9E9B96', textTransform: 'uppercase', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Unexplained</div>
              <div style={{ fontWeight: 800, color: row.unexplained > 0 ? '#991B1B' : '#1D4ED8', fontFamily: 'Inter', fontSize: 14 }}>
                {fmt$(row.unexplained)}
              </div>
            </div>
          </div>

          {row.unexplained > 0 && (
            <div style={{ fontSize: 11, color: '#625650', fontStyle: 'italic' }}>
              Adj contract is HIGHER than line items + tax/bonds. Either line items are incomplete, or contract value is inflated.
            </div>
          )}
          {row.unexplained < 0 && (
            <div style={{ fontSize: 11, color: '#625650', fontStyle: 'italic' }}>
              Line items add to MORE than adj contract. Either line items have duplicates, or contract value is too low.
            </div>
          )}

          {row.cv_reconciliation_acked_at && !isStaleAck && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#D1FAE5', borderRadius: 6, fontSize: 11, color: '#065F46' }}>
              ✓ Acknowledged {new Date(row.cv_reconciliation_acked_at).toLocaleDateString()} by {row.cv_reconciliation_acked_by}
              {row.cv_reconciliation_notes && <> — <i>"{row.cv_reconciliation_notes}"</i></>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onOpenProject(row)} style={btnP} disabled={busy}>
            Open in Projects →
          </button>
          {!ackPanelOpen ? (
            <button onClick={() => setAckPanelOpen(true)} style={btnS} disabled={busy}>
              Acknowledge gap
            </button>
          ) : (
            <button onClick={() => setAckPanelOpen(false)} style={btnS} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {ackPanelOpen && (
        <div style={{ marginTop: 12, padding: 12, background: '#F9F8F6', border: '1px solid #E5E3E0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#625650', marginBottom: 8 }}>
            Mark this gap as <b>intentional / verified correct</b>. The job will be hidden from this worklist unless the gap moves by more than {fmt$(ACK_DRIFT_THRESHOLD)}.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10, color: '#625650', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>
                Acknowledged by
              </label>
              <input value={ackedBy} onChange={e => setAckedBy(e.target.value)} placeholder="your name" style={inputS} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10, color: '#625650', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>
                Notes <span style={{ color: '#9E9B96', fontWeight: 400 }}>(why is this gap correct?)</span>
              </label>
              <input value={ackNotes} onChange={e => setAckNotes(e.target.value)} placeholder='e.g. "lump sum job, line items intentionally empty"' style={inputS} />
            </div>
          </div>
          {err && <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setAckPanelOpen(false)} style={btnS} disabled={busy}>Cancel</button>
            <button onClick={acknowledge} style={{ ...btnP, opacity: busy ? 0.6 : 1 }} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm acknowledgement'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, color, defaultOpen, totalDollars, children }) {
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
          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, background: color + '20', color, fontSize: 12, fontWeight: 700 }}>{count}</span>
          {totalDollars !== undefined && totalDollars > 0 && (
            <span style={{ fontSize: 11, color: '#625650' }}>· {fmt$(totalDollars)} total exposure</span>
          )}
        </div>
        <span style={{ fontSize: 14, color: '#9E9B96' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </div>
  );
}

export default function CVReconciliationPage({ jobs, onOpenJob }) {
  const [lineItems, setLineItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState({ market: 'all', severity: 'all', showAcked: false });

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      // Fetch all line items once. Cheaper than 200 per-job queries; the table is small enough.
      const li = await sbGet('job_line_items', 'select=job_id,line_value&limit=10000');
      setLineItems(Array.isArray(li) ? li : []);
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Aggregate line items by job_id, then compute the gap analysis
  const rows = useMemo(() => {
    const sumsByJob = {};
    const countsByJob = {};
    lineItems.forEach(li => {
      sumsByJob[li.job_id] = (sumsByJob[li.job_id] || 0) + (Number(li.line_value) || 0);
      countsByJob[li.job_id] = (countsByJob[li.job_id] || 0) + 1;
    });

    const out = [];
    (jobs || []).forEach(j => {
      // Skip lost / canceled — not worth chasing
      if (['lost', 'canceled', 'cancelled'].includes(j.status)) return;

      const adj = Number(j.adj_contract_value) || 0;
      const lineTotal = sumsByJob[j.id] || 0;
      const lineCount = countsByJob[j.id] || 0;

      // If no line items at all and no adj_cv, skip (empty job)
      if (adj <= 0 && lineTotal <= 0) return;

      // If no line items, we can't compute a gap meaningfully — skip
      // (these will be caught by a different audit if needed)
      if (lineCount === 0) return;

      const expected = (Number(j.bonds_amount) || 0)
                     + (Number(j.permits_amount) || 0)
                     + (Number(j.pp_bond_amount) || 0)
                     + (Number(j.maint_bond_amount) || 0)
                     + (Number(j.sales_tax_amount) || 0);
      const actual = adj - lineTotal;
      const unexplained = actual - expected;
      const unexplainedAbs = Math.abs(unexplained);

      // Floor: ignore tiny gaps and gaps that are <10% of the smaller side
      if (unexplainedAbs < SEVERITY_FLOOR) return;
      const denom = Math.max(adj, lineTotal, 1);
      if (unexplainedAbs / denom < PCT_FLOOR) return;

      out.push({
        id: j.id,
        job_number: j.job_number,
        job_name: j.job_name,
        market: j.market,
        pm: j.pm,
        status: j.status,
        adj_cv: adj,
        line_total: lineTotal,
        line_count: lineCount,
        expected_gap: expected,
        actual_gap: actual,
        unexplained,
        cv_reconciliation_acked_at: j.cv_reconciliation_acked_at,
        cv_reconciliation_acked_gap: j.cv_reconciliation_acked_gap,
        cv_reconciliation_acked_by: j.cv_reconciliation_acked_by,
        cv_reconciliation_notes: j.cv_reconciliation_notes,
      });
    });

    // Sort by absolute unexplained desc — biggest first
    out.sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained));
    return out;
  }, [jobs, lineItems]);

  // Apply filters
  const filtered = useMemo(() => {
    return rows.filter(r => {
      // Hide acknowledged unless showAcked is on
      const isAcked = r.cv_reconciliation_acked_at;
      const isStaleAck = isAcked && Math.abs(r.unexplained - (Number(r.cv_reconciliation_acked_gap) || 0)) > ACK_DRIFT_THRESHOLD;
      if (isAcked && !isStaleAck && !filter.showAcked) return false;

      if (filter.market !== 'all' && r.market !== filter.market) return false;
      if (filter.severity !== 'all') {
        const sev = severity(Math.abs(r.unexplained)).key;
        if (sev !== filter.severity) return false;
      }
      return true;
    });
  }, [rows, filter]);

  // Bucket
  const huge  = filtered.filter(r => Math.abs(r.unexplained) >= 250000);
  const big   = filtered.filter(r => Math.abs(r.unexplained) >= 50000  && Math.abs(r.unexplained) < 250000);
  const real  = filtered.filter(r => Math.abs(r.unexplained) >= 10000  && Math.abs(r.unexplained) < 50000);
  const minor = filtered.filter(r => Math.abs(r.unexplained) >= 1000   && Math.abs(r.unexplained) < 10000);

  const totalUnexplained = filtered.reduce((s, r) => s + Math.abs(r.unexplained), 0);
  const sumDollars = (arr) => arr.reduce((s, r) => s + Math.abs(r.unexplained), 0);

  const openInProjects = (row) => {
    const job = (jobs || []).find(j => j.id === row.id);
    if (job && onOpenJob) {
      onOpenJob(job);
    } else {
      alert('Could not locate job in current jobs list. Try refreshing.');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 28, color: '#1A1A1A', margin: 0, marginBottom: 4 }}>
          Contract Reconciliation
        </h1>
        <div style={{ fontSize: 13, color: '#625650' }}>
          Jobs where adj contract value disagrees with line items by more than tax/bonds can explain. Fix or acknowledge each one.
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #7F1D1D' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#7F1D1D' }}>{huge.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>🚨 Huge (&gt;$250K)</div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #991B1B' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#991B1B' }}>{big.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>🔴 Big ($50K–$250K)</div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #B45309' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#B45309' }}>{real.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>🟠 Real ($10K–$50K)</div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #854F0B' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#854F0B' }}>{minor.length}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>🟡 Minor ($1K–$10K)</div>
        </div>
        <div style={{ ...card, padding: '12px 14px', borderLeft: '4px solid #1A1A1A' }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#1A1A1A' }}>{fmt$(totalUnexplained)}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>Total exposure</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: '12px 18px', marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9E9B96', textTransform: 'uppercase', fontWeight: 700 }}>Severity:</span>
          {['all', 'huge', 'big', 'real', 'minor'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(f => ({ ...f, severity: s }))}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: filter.severity === s ? '1px solid #8A261D' : '1px solid #E5E3E0',
                background: filter.severity === s ? '#FDF4F4' : '#FFF',
                color: filter.severity === s ? '#8A261D' : '#625650',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
              }}
            >{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9E9B96', textTransform: 'uppercase', fontWeight: 700 }}>Market:</span>
          {['all', 'HOU', 'SA', 'AUS', 'DFW', 'CS'].map(m => (
            <button
              key={m}
              onClick={() => setFilter(f => ({ ...f, market: m }))}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: filter.market === m ? '1px solid #8A261D' : '1px solid #E5E3E0',
                background: filter.market === m ? '#FDF4F4' : '#FFF',
                color: filter.market === m ? '#8A261D' : '#625650',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >{m}</button>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#625650', cursor: 'pointer' }}>
          <input type="checkbox" checked={filter.showAcked} onChange={e => setFilter(f => ({ ...f, showAcked: e.target.checked }))} />
          Show acknowledged
        </label>
        <button onClick={load} style={{ ...btnS, marginLeft: 'auto' }} disabled={loading}>
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {err && (
        <div style={{ ...card, background: '#FEE2E2', borderColor: '#991B1B', color: '#991B1B', marginBottom: 16 }}>
          ⚠ {err}
        </div>
      )}

      {!loading && filtered.length === 0 && !err && (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: '#625650' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>All clean</div>
          <div style={{ fontSize: 13, color: '#9E9B96', maxWidth: 480, margin: '0 auto' }}>
            No jobs in the worklist match the current filters. Either the data is reconciled or the filter excluded everything.
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          {huge.length > 0 && (
            <Section title="🚨 Huge — gaps over $250K" count={huge.length} color="#7F1D1D" defaultOpen={true} totalDollars={sumDollars(huge)}>
              {huge.map(r => <ReconRow key={r.id} row={r} onOpenProject={openInProjects} onChanged={load} />)}
            </Section>
          )}
          {big.length > 0 && (
            <Section title="🔴 Big — $50K–$250K gaps" count={big.length} color="#991B1B" defaultOpen={true} totalDollars={sumDollars(big)}>
              {big.map(r => <ReconRow key={r.id} row={r} onOpenProject={openInProjects} onChanged={load} />)}
            </Section>
          )}
          {real.length > 0 && (
            <Section title="🟠 Real — $10K–$50K gaps" count={real.length} color="#B45309" defaultOpen={false} totalDollars={sumDollars(real)}>
              {real.map(r => <ReconRow key={r.id} row={r} onOpenProject={openInProjects} onChanged={load} />)}
            </Section>
          )}
          {minor.length > 0 && (
            <Section title="🟡 Minor — $1K–$10K gaps" count={minor.length} color="#854F0B" defaultOpen={false} totalDollars={sumDollars(minor)}>
              {minor.map(r => <ReconRow key={r.id} row={r} onOpenProject={openInProjects} onChanged={load} />)}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
