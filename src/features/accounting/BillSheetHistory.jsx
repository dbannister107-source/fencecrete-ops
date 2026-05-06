// BillSheetHistory — per-job timeline of every PM Bill Sheet ever submitted.
//
// Each row shows: month · status · invoice # · amount · LF · who reviewed
// · "View snapshot" button which opens the frozen `snapshot_at_review` JSONB
// captured at the moment AR flipped ar_reviewed=true (T1.1, 2026-05-06).
//
// Read-only. Designed to be folded into the Accounting tab as a collapsible
// section so AR/Amiee can audit a job's full billing rhythm without leaving
// the EditPanel.
//
// Renders no data when the job has no submissions yet — the parent decides
// whether to show the section at all.

import React, { useEffect, useMemo, useState } from 'react';
import { sbGet } from '../../shared/sb';
import { card, btnS, COLOR } from '../../shared/ui';

const $ = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const monthLabel = (ym) => {
  if (!ym || typeof ym !== 'string') return ym || '—';
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const fmtDate = (ts) => {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return null; }
};

// Status pill — pulls vocabulary from the submissions tab so the same row
// reads consistently across surfaces.
function StatusPill({ sub }) {
  if (sub.no_bill_required) {
    return <span title={sub.no_bill_notes || ''} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
      background: '#E5E3E0', color: '#625650', fontStyle: 'italic',
    }}>🚫 No bill</span>;
  }
  if (sub.ar_reviewed) {
    return <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
      background: '#DBEAFE', color: '#1D4ED8',
    }}>✓ Reviewed</span>;
  }
  return <span style={{
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
    background: '#FEF3C7', color: '#B45309',
  }}>⚠ Pending</span>;
}

// Snapshot modal — renders the frozen JSONB captured at AR review.
// Read-only, collapsed-by-default groups for readability.
function SnapshotModal({ sub, onClose }) {
  const snap = sub?.snapshot_at_review;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#FFF', borderRadius: 14, padding: 20,
        width: 'min(720px, 96vw)', maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 800 }}>
              Frozen Snapshot — {monthLabel(sub.billing_month)}
            </div>
            <div style={{ fontSize: 11, color: COLOR.text2, marginTop: 2 }}>
              Captured at AR review · immutable · job {sub.job_number}
            </div>
          </div>
          <button onClick={onClose} style={btnS}>Close</button>
        </div>

        {!snap ? (
          <div style={{ padding: 20, background: '#F9F8F6', borderRadius: 8, fontSize: 13, color: COLOR.text2 }}>
            No snapshot captured for this submission.
            {sub.ar_reviewed
              ? ' (This is a legacy row reviewed before snapshot capture was wired up — the live data shown elsewhere is the best record available.)'
              : ' Snapshots are created when AR marks the bill sheet reviewed.'}
          </div>
        ) : (
          <SnapshotBody snap={snap} sub={sub} />
        )}
      </div>
    </div>
  );
}

function SnapshotBody({ snap, sub }) {
  // Group fields into readable sections. Hide null/zero noise.
  const groups = [
    {
      title: 'Submission Identity',
      rows: [
        ['Billing Month', monthLabel(snap.billing_month)],
        ['Submitted By', snap.submitted_by],
        ['Submitted At', fmtDate(snap.submitted_at)],
        ['PM (display)', snap.pm],
        ['Market', snap.market],
      ],
    },
    {
      title: 'AR Review',
      rows: [
        ['Reviewed By', snap.ar_reviewed_by],
        ['Reviewed At', fmtDate(snap.ar_reviewed_at)],
        ['Invoice #', snap.invoice_number],
        ['Invoice Amount', snap.invoiced_amount != null ? $(snap.invoiced_amount) : null],
        ['Invoice Date', snap.invoice_date],
        ['AR Notes', snap.ar_notes],
      ],
    },
    {
      title: 'Linear Feet (cycle)',
      rows: [
        ['Total LF', snap.total_lf],
        ['Labor Post Only', snap.labor_post_only],
        ['Labor Post & Panels', snap.labor_post_panels],
        ['Labor Complete', snap.labor_complete],
        ['SW Foundation', snap.sw_foundation],
        ['SW Columns', snap.sw_columns],
        ['SW Panels', snap.sw_panels],
        ['SW Complete', snap.sw_complete],
        ['WI Fencing', snap.wi_fencing],
        ['WI Columns', snap.wi_columns],
        ['Wood Fencing', snap.wood_fencing],
      ],
    },
    {
      title: 'Counts / Other',
      rows: [
        ['WI Gates (pcs)', snap.wi_gates],
        ['Gate Controls (pcs)', snap.gate_controls],
        ['Bonds ($)', snap.line_bonds != null ? $(snap.line_bonds) : null],
        ['Permits ($)', snap.line_permits != null ? $(snap.line_permits) : null],
        ['Demo / Remove', snap.remove_existing || snap.demo],
        ['Mow Strip', snap.mow_strip],
      ],
    },
    {
      title: 'PM Notes',
      rows: [
        ['Notes', snap.notes],
      ],
    },
  ];

  return (
    <div>
      {groups.map((g) => {
        const visibleRows = g.rows.filter(([_, v]) => v != null && v !== '' && v !== 0 && v !== '0');
        if (visibleRows.length === 0) return null;
        return (
          <div key={g.title} style={{
            background: '#F9F8F6', border: `1px solid ${COLOR.border}`, borderRadius: 8,
            padding: '10px 14px', marginBottom: 10,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, color: COLOR.text2,
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
            }}>{g.title}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
              {visibleRows.map(([label, value]) => (
                <React.Fragment key={label}>
                  <div style={{ color: COLOR.text2, fontWeight: 600 }}>{label}</div>
                  <div style={{ color: COLOR.text }}>{String(value)}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      })}
      {/* Edit-history footer — surfaces the audit trio if present */}
      {(sub.edit_count > 0 || sub.last_edited_at) && (
        <div style={{
          padding: '8px 12px', background: '#FEF3C7', border: '1px solid #FDE68A',
          borderRadius: 8, fontSize: 11, color: '#92400E', fontWeight: 600,
        }}>
          ✎ Edited {sub.edit_count} time{sub.edit_count === 1 ? '' : 's'}
          {sub.last_edited_at ? ` · last ${fmtDate(sub.last_edited_at)}` : ''}
          <span style={{ marginLeft: 6, fontWeight: 500 }}>
            (Snapshot above reflects the row at the moment of AR review;
            edits after that point did not modify the snapshot.)
          </span>
        </div>
      )}
    </div>
  );
}

// Main timeline component. Mounted inside AccountingTab.
export default function BillSheetHistory({ jobId, jobNumber }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false); // collapsed by default
  const [snapshotSub, setSnapshotSub] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    sbGet(
      'pm_bill_submissions',
      `job_id=eq.${jobId}&order=billing_month.desc,submitted_at.desc&select=*`
    )
      .then((rows) => { setSubs(Array.isArray(rows) ? rows : []); setError(null); })
      .catch((e) => setError(e.message || 'Failed to load history'))
      .finally(() => setLoading(false));
  }, [jobId]);

  const summary = useMemo(() => {
    const total = subs.length;
    const reviewed = subs.filter((s) => s.ar_reviewed && !s.no_bill_required).length;
    const pending  = subs.filter((s) => !s.ar_reviewed && !s.no_bill_required).length;
    const noBill   = subs.filter((s) => s.no_bill_required).length;
    const totalInvoiced = subs.filter((s) => s.ar_reviewed)
      .reduce((sum, s) => sum + Number(s.invoiced_amount || 0), 0);
    return { total, reviewed, pending, noBill, totalInvoiced };
  }, [subs]);

  if (!jobId) return null;

  return (
    <div style={{ ...card, padding: 0, marginTop: 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '14px 18px', border: 'none', background: 'transparent',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 14, fontWeight: 800, color: COLOR.text }}>
            📋 Bill Sheet History
          </div>
          <div style={{ fontSize: 11, color: COLOR.text2, marginTop: 2 }}>
            {loading ? 'Loading…' :
              summary.total === 0 ? 'No bill sheets submitted yet' :
              `${summary.total} submission${summary.total === 1 ? '' : 's'} · ${summary.reviewed} reviewed · $${summary.totalInvoiced.toLocaleString(undefined, { maximumFractionDigits: 0 })} invoiced`}
          </div>
        </div>
        <span style={{ fontSize: 14, color: COLOR.text2 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && !loading && (
        <div style={{ padding: '0 18px 18px' }}>
          {error && (
            <div style={{
              padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA',
              borderRadius: 8, fontSize: 12, color: '#991B1B', marginBottom: 10,
            }}>{error}</div>
          )}
          {summary.total === 0 ? (
            <div style={{ fontSize: 12, color: COLOR.text2, fontStyle: 'italic', padding: '8px 0' }}>
              No bill sheets have been submitted for this job yet. As PMs file monthly bill sheets, they'll appear here.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                    {['Month', 'Status', 'Invoice #', 'Amount', 'LF', 'Submitted By', 'Reviewed By', ''].map((h) => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700,
                        color: COLOR.text2, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => {
                    const editedBadge = s.edit_count > 0
                      ? <span title={`${s.edit_count} edit${s.edit_count === 1 ? '' : 's'}; last ${fmtDate(s.last_edited_at)}`}
                              style={{ marginLeft: 6, fontSize: 9, color: '#92400E', fontWeight: 700 }}>✎</span>
                      : null;
                    return (
                      <tr key={s.id} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                        <td style={{ padding: '10px', fontWeight: 700 }}>{monthLabel(s.billing_month)}</td>
                        <td style={{ padding: '10px' }}><StatusPill sub={s} />{editedBadge}</td>
                        <td style={{ padding: '10px', color: COLOR.text2 }}>{s.invoice_number || '—'}</td>
                        <td style={{ padding: '10px', fontFamily: 'Inter', fontWeight: 700 }}>
                          {s.invoiced_amount > 0 ? $(s.invoiced_amount) : '—'}
                        </td>
                        <td style={{ padding: '10px', color: COLOR.text2 }}>
                          {s.total_lf > 0 ? Number(s.total_lf).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '10px', color: COLOR.text2, fontSize: 11 }}>
                          {s.submitted_by || '—'}
                          {s.submitted_at ? <div style={{ fontSize: 10, color: COLOR.text3 }}>{fmtDate(s.submitted_at)}</div> : null}
                        </td>
                        <td style={{ padding: '10px', color: COLOR.text2, fontSize: 11 }}>
                          {s.ar_reviewed_by || (s.ar_reviewed ? 'AR' : '—')}
                          {s.ar_reviewed_at ? <div style={{ fontSize: 10, color: COLOR.text3 }}>{fmtDate(s.ar_reviewed_at)}</div> : null}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <button
                            onClick={() => setSnapshotSub(s)}
                            disabled={!s.snapshot_at_review && !s.ar_reviewed}
                            title={s.snapshot_at_review ? 'View frozen snapshot captured at AR review'
                              : s.ar_reviewed ? 'Pre-snapshot legacy row — best-effort view' : 'No snapshot until AR reviews'}
                            style={{
                              ...btnS, fontSize: 11, padding: '4px 10px',
                              opacity: (!s.snapshot_at_review && !s.ar_reviewed) ? 0.4 : 1,
                              cursor: (!s.snapshot_at_review && !s.ar_reviewed) ? 'not-allowed' : 'pointer',
                            }}
                          >View</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {snapshotSub && <SnapshotModal sub={snapshotSub} onClose={() => setSnapshotSub(null)} />}
    </div>
  );
}
