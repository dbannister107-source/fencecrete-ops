// ContractsWorkbenchPage
//
// 2026-05-02: built to remove Amiee's bottleneck on contract execution.
// 66 single-job edits across 20 jobs and 12 fields per month — most of
// that is contract-readiness work that requires opening EditPanel for
// each job individually. This page collapses it into a single surface.
//
// What it does:
// - Lists every contract_review job with its v_contract_readiness state
// - Inline expand to see all 14 readiness checks per job
// - Tick the manual items (PIS, deposit, payment terms, etc.) without
//   navigating away
// - Filter by readiness state (ready / blocked-by-data / blocked-by-manual)
// - Sticky toolbar with bulk actions (mark all as PIS submitted, etc.)
//
// What it does NOT do:
// - Edit job fields (style, color, height, etc.) — those still live on
//   EditPanel because they affect downstream pricing/material calcs and
//   need the full validation context
// - Move statuses — the database trigger already enforces readiness
//   before a status move; users still drive the move from EditPanel
//
// Permission: anyone with canEditProjects (David, Amiee, contracts@, alex@).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet, H } from '../../shared/sb';

const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';

const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const btnP = { padding: '8px 14px', background: '#8A261D', border: 'none', borderRadius: 8, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 12 };
const btnS = { padding: '6px 12px', background: '#F4F4F2', color: '#625650', border: '1px solid #E5E3E0', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 11 };
const inputS = { padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' };

const fmtMoney = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toFixed(0)}`;
};

const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};

// Auto-check field labels (must match keys in v_contract_readiness.auto_checks)
const AUTO_LABELS = {
  customer_linked: 'Linked to company',
  style_set: 'Style selected',
  color_set: 'Color selected',
  height_set: 'Height set',
  total_lf_set: 'LF entered',
  contract_value_set: 'Contract value',
  line_items_entered: 'Line items entered',
  line_items_match_contract: 'Line items reconcile to contract',
};

// Manual checklist items. PIS and Payment terms are universally required
// (block advancement). The other 4 are optional documentation — Amiee ticks
// them when they happen but they don't block the contract from advancing.
// Required items render first.
const MANUAL_ITEMS = [
  { key: 'pis_submitted',        label: 'PIS submitted',        required: true },
  { key: 'payment_terms',        label: 'Payment terms',        required: true },
  { key: 'deposit_received',     label: 'Deposit received',     required: false },
  { key: 'tax_cert',             label: 'Tax cert',             required: false },
  { key: 'engineering_drawings', label: 'Engineering drawings', required: false },
  { key: 'wet_signatures',       label: 'Wet signatures',       required: false },
];
const REQUIRED_MANUAL = MANUAL_ITEMS.filter((it) => it.required);

export default function ContractsWorkbenchPage({ currentUserEmail, onNav, readOnly = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all'); // all | ready | blocked_data | blocked_manual
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [savingItems, setSavingItems] = useState(new Set()); // "jobId:itemKey"
  const [toast, setToast] = useState(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await sbGet(
        'v_contract_readiness',
        'select=job_id,job_number,job_name,status,is_ready,auto_checks,manual_items,contract_executed&status=in.(contract_review)&order=job_number.asc',
      );
      // Also fetch the underlying jobs for fields the view doesn't expose
      const jobIds = (Array.isArray(data) ? data : []).map((r) => r.job_id);
      let jobMeta = {};
      if (jobIds.length > 0) {
        const jobs = await sbGet(
          'jobs',
          `id=in.(${jobIds.join(',')})&select=id,customer_name,adj_contract_value,contract_date,total_lf,market,pm,sales_rep`,
        );
        if (Array.isArray(jobs)) {
          jobs.forEach((j) => { jobMeta[j.id] = j; });
        }
      }
      setRows((Array.isArray(data) ? data : []).map((r) => ({ ...r, ...(jobMeta[r.job_id] || {}) })));
    } catch (e) {
      setErr(e.message || 'Failed to load contract readiness data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const toggleItem = async (jobId, itemKey, action) => {
    if (readOnly) return;  // view-only users cannot mutate readiness items
    const k = `${jobId}:${itemKey}`;
    setSavingItems((p) => new Set(p).add(k));
    try {
      const now = new Date().toISOString();
      const body = {
        job_id: jobId,
        item_key: itemKey,
        checked_at: action === 'check' ? now : null,
        checked_by: action === 'check' ? currentUserEmail : null,
        not_applicable: action === 'not_applicable',
        updated_at: now,
      };
      const res = await fetch(`${SB}/rest/v1/contract_readiness_items?on_conflict=job_id,item_key`, {
        method: 'POST',
        headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      // Optimistically update the local row instead of re-fetching the whole table
      setRows((prev) => prev.map((r) => {
        if (r.job_id !== jobId) return r;
        const mi = { ...(r.manual_items || {}) };
        mi[itemKey] = {
          checked_at: action === 'check' ? now : null,
          checked_by: action === 'check' ? currentUserEmail : null,
          not_applicable: action === 'not_applicable',
          notes: null,
        };
        // Recompute is_ready locally — auto_checks unchanged, just re-check
        // REQUIRED manual coverage. Optional items don't gate is_ready.
        const ac = r.auto_checks || {};
        const allAuto = Object.values(ac).every((v) => v === true);
        const requiredManualOk = REQUIRED_MANUAL.every((it) => {
          const m = mi[it.key];
          return m && (m.checked_at || m.not_applicable);
        });
        return { ...r, manual_items: mi, is_ready: allAuto && requiredManualOk };
      }));
    } catch (e) {
      setToast({ type: 'error', msg: `Save failed: ${e.message}` });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSavingItems((p) => {
        const n = new Set(p);
        n.delete(k);
        return n;
      });
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search) {
        const s = search.toLowerCase();
        if (!(r.job_number || '').toLowerCase().includes(s)
            && !(r.job_name || '').toLowerCase().includes(s)
            && !(r.customer_name || '').toLowerCase().includes(s)) {
          return false;
        }
      }
      if (filter === 'ready') return r.is_ready;
      if (filter === 'blocked_data') {
        const ac = r.auto_checks || {};
        return !r.is_ready && Object.values(ac).some((v) => v === false);
      }
      if (filter === 'blocked_manual') {
        const ac = r.auto_checks || {};
        return !r.is_ready && Object.values(ac).every((v) => v === true);
      }
      return true;
    });
  }, [rows, filter, search]);

  const counts = useMemo(() => {
    const ready = rows.filter((r) => r.is_ready).length;
    const blocked_data = rows.filter((r) => {
      const ac = r.auto_checks || {};
      return !r.is_ready && Object.values(ac).some((v) => v === false);
    }).length;
    const blocked_manual = rows.filter((r) => {
      const ac = r.auto_checks || {};
      return !r.is_ready && Object.values(ac).every((v) => v === true);
    }).length;
    return { total: rows.length, ready, blocked_data, blocked_manual };
  }, [rows]);

  const toggleExpand = (jobId) => {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(jobId)) n.delete(jobId);
      else n.add(jobId);
      return n;
    });
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9E9B96' }}>Loading contracts…</div>;
  if (err) return <div style={{ padding: 24, color: '#991B1B', background: '#FEE2E2', borderRadius: 8 }}>Error: {err}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 800, margin: 0, color: '#1A1A1A' }}>Contracts Workbench</h1>
          <div style={{ fontSize: 12, color: '#625650', marginTop: 4 }}>
            {readOnly
              ? <>All jobs in <code style={{ background: '#F4F4F2', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>contract_review</code>. <span style={{ color: '#7C3AED', fontWeight: 700 }}>View-only</span> — Amiee or contracts@ can tick manual items.</>
              : <>All jobs in <code style={{ background: '#F4F4F2', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>contract_review</code>. Tick manual items inline; auto-checks update from job data.</>
            }
          </div>
        </div>
        <button onClick={fetchRows} style={btnS}>↻ Refresh</button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div style={{ ...card, padding: 14, borderLeft: '4px solid #185FA5' }}>
          <div style={{ fontSize: 10, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase' }}>In Contract Review</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{counts.total}</div>
        </div>
        <div style={{ ...card, padding: 14, borderLeft: '4px solid #065F46', cursor: 'pointer' }} onClick={() => setFilter('ready')}>
          <div style={{ fontSize: 10, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase' }}>Ready to Advance</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#065F46' }}>{counts.ready}</div>
        </div>
        <div style={{ ...card, padding: 14, borderLeft: '4px solid #B45309', cursor: 'pointer' }} onClick={() => setFilter('blocked_data')}>
          <div style={{ fontSize: 10, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase' }}>Blocked: Missing Job Data</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#B45309' }}>{counts.blocked_data}</div>
        </div>
        <div style={{ ...card, padding: 14, borderLeft: '4px solid #7C3AED', cursor: 'pointer' }} onClick={() => setFilter('blocked_manual')}>
          <div style={{ fontSize: 10, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase' }}>Blocked: Unchecked Manual Items</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#7C3AED' }}>{counts.blocked_manual}</div>
        </div>
      </div>

      {/* Filter strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', 'ready', 'blocked_data', 'blocked_manual'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...btnS,
              background: filter === f ? '#1A1A1A' : '#F4F4F2',
              color: filter === f ? '#FFF' : '#625650',
              borderColor: filter === f ? '#1A1A1A' : '#E5E3E0',
            }}
          >
            {f === 'all' ? 'All' : f === 'ready' ? '✓ Ready' : f === 'blocked_data' ? 'Blocked: data' : 'Blocked: manual'}
          </button>
        ))}
        <input
          type="text"
          placeholder="Search job number, name, or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputS, flex: 1, minWidth: 220 }}
        />
      </div>

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F9F8F6', borderBottom: '2px solid #E5E3E0' }}>
                <th style={{ width: 32 }}></th>
                {['Job #', 'Name', 'Customer', 'Value', 'Contract Date', 'Auto', 'Manual', 'Status'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#9E9B96', fontSize: 13 }}>
                    No jobs match the current filter.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const ac = r.auto_checks || {};
                const mi = r.manual_items || {};
                const autoCount = Object.values(ac).filter((v) => v === true).length;
                const autoTotal = Object.keys(AUTO_LABELS).length;
                // The row's "Manual N/N" column reflects REQUIRED items
                // (the ones that gate advancement). Optional items still
                // render in the expanded view but don't count toward this.
                const manualCount = REQUIRED_MANUAL.filter((it) => {
                  const m = mi[it.key];
                  return m && (m.checked_at || m.not_applicable);
                }).length;
                const manualTotal = REQUIRED_MANUAL.length;
                const isExpanded = expanded.has(r.job_id);
                return (
                  <React.Fragment key={r.job_id}>
                    <tr style={{ borderBottom: '1px solid #F4F4F2', background: r.is_ready ? '#F0FDF4' : '#FFF' }}>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        <button
                          onClick={() => toggleExpand(r.job_id)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, color: '#625650', padding: 4 }}
                        >{isExpanded ? '▼' : '▶'}</button>
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'Inter' }}>{r.job_number}</td>
                      <td style={{ padding: '8px 12px' }}>{r.job_name}</td>
                      <td style={{ padding: '8px 12px', color: '#625650' }}>{r.customer_name || '—'}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{fmtMoney(r.adj_contract_value)}</td>
                      <td style={{ padding: '8px 12px', color: '#625650' }}>{fmtDate(r.contract_date)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontWeight: 700, color: autoCount === autoTotal ? '#065F46' : '#B45309' }}>{autoCount}/{autoTotal}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontWeight: 700, color: manualCount === manualTotal ? '#065F46' : '#7C3AED' }}>{manualCount}/{manualTotal}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {r.is_ready ? (
                          <span style={{ background: '#D1FAE5', color: '#065F46', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>✓ READY</span>
                        ) : (
                          <span style={{ background: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>BLOCKED</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: '#F9F8F6' }}>
                        <td colSpan={9} style={{ padding: '14px 18px', borderBottom: '2px solid #E5E3E0' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 18 }}>
                            {/* Auto checks */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 800, color: '#625650', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                                Auto-checked (from job data)
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {Object.entries(AUTO_LABELS).map(([k, label]) => {
                                  const ok = !!ac[k];
                                  return (
                                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: ok ? '#F0FDF4' : '#FEF2F2', borderRadius: 4, fontSize: 12 }}>
                                      <span style={{ fontSize: 14, fontWeight: 800, color: ok ? '#065F46' : '#991B1B', width: 14 }}>{ok ? '✓' : '✗'}</span>
                                      <span style={{ color: ok ? '#065F46' : '#991B1B', fontWeight: 600 }}>{label}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              {!Object.values(ac).every((v) => v) && (
                                <button
                                  onClick={() => onNav && onNav('projects', r.job_id)}
                                  style={{ ...btnS, marginTop: 8, fontSize: 11 }}
                                >Open in Projects to fix →</button>
                              )}
                            </div>
                            {/* Manual checklist — required items first, then optional documentation */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 800, color: '#625650', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                                Manual checklist <span style={{ color: '#9E9B96', fontWeight: 600 }}>(★ blocks advancement)</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {MANUAL_ITEMS.map((it) => {
                                  const m = mi[it.key] || {};
                                  const checked = !!m.checked_at;
                                  const na = !!m.not_applicable;
                                  const ok = checked || na;
                                  const k = `${r.job_id}:${it.key}`;
                                  const isSaving = savingItems.has(k);
                                  return (
                                    <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: ok ? '#F0FDF4' : '#FFF', border: `1px solid ${ok ? '#A7F3D0' : '#E5E3E0'}`, borderRadius: 4, fontSize: 12 }}>
                                      <input
                                        type="checkbox"
                                        checked={ok}
                                        disabled={isSaving || readOnly}
                                        onChange={(e) => toggleItem(r.job_id, it.key, e.target.checked ? 'check' : 'uncheck')}
                                        style={{ width: 16, height: 16, accentColor: '#065F46', cursor: readOnly ? 'not-allowed' : (isSaving ? 'wait' : 'pointer'), opacity: readOnly ? 0.6 : 1 }}
                                      />
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: ok ? '#065F46' : '#1A1A1A' }}>
                                          {it.required && <span style={{ color: '#8A261D', marginRight: 4 }} title="Required to advance">★</span>}
                                          {it.label}
                                          {!it.required && <span style={{ color: '#9E9B96', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>(optional)</span>}
                                        </div>
                                        {checked && m.checked_by && (
                                          <div style={{ fontSize: 10, color: '#625650', marginTop: 2 }}>
                                            by {m.checked_by} on {new Date(m.checked_at).toLocaleDateString()}
                                          </div>
                                        )}
                                        {na && <div style={{ fontSize: 10, color: '#625650', marginTop: 2 }}>marked N/A</div>}
                                      </div>
                                      {!checked && !readOnly && (
                                        <button
                                          onClick={() => toggleItem(r.job_id, it.key, na ? 'uncheck' : 'not_applicable')}
                                          disabled={isSaving}
                                          style={{ ...btnS, padding: '2px 8px', fontSize: 10 }}
                                        >{na ? 'Un-N/A' : 'N/A'}</button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 16px', background: toast.type === 'error' ? '#FEE2E2' : '#D1FAE5', color: toast.type === 'error' ? '#991B1B' : '#065F46', borderRadius: 8, fontWeight: 600, fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
