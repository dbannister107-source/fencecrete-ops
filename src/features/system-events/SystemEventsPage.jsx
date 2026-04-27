// SystemEventsPage
//
// Live operational view over the system_events table — the "spine" of the
// agentic workflow stack. Every business-meaningful action in the app emits
// a row here; the dispatch_system_event edge function processes them and
// writes back what it did. This page is the debugging window for every
// agent that ever ships.
//
// Auto-refreshes every 5s. Click a row for the detail drawer + replay.
// Send Test Ping is the canonical health check — see test.ping rule in
// supabase/functions/dispatch_system_event/index.ts.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet, sbFunctionUrl, sbAuthHeader } from '../../shared/sb';
import { logEvent } from '../../shared/systemEvents';

const REFRESH_MS = 5000;
const ROW_LIMIT = 500;

const STATUS_STYLES = {
  pending:    { bg: '#F1F0EE', fg: '#625650', label: 'pending' },
  processing: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'processing' },
  succeeded:  { bg: '#D1FAE5', fg: '#065F46', label: 'succeeded' },
  failed:     { bg: '#FEE2E2', fg: '#991B1B', label: 'failed' },
  skipped:    { bg: '#FEF3C7', fg: '#854F0B', label: 'skipped' },
};

const CATEGORY_COLORS = {
  admin:      '#7C3AED',
  general:    '#625650',
  billing:    '#065F46',
  production: '#0F6E56',
  sales:      '#1D4ED8',
  contracts:  '#854F0B',
  fleet:      '#B45309',
  test:       '#9333EA',
};

const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const btnP = { padding: '10px 18px', background: '#8A261D', border: 'none', borderRadius: 8, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnS = { padding: '8px 14px', background: '#F4F4F2', color: '#625650', border: '1px solid #E5E3E0', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12 };

function relTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const ms = Date.now() - t;
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtAbs(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

function fmtLatency(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function latencyColor(ms) {
  if (ms == null || !Number.isFinite(ms)) return '#9E9B96';
  if (ms < 2000) return '#065F46';
  if (ms < 10000) return '#854F0B';
  return '#991B1B';
}

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || CATEGORY_COLORS.general;
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || { bg: '#F1F0EE', fg: '#625650', label: status || '—' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      background: s.bg,
      color: s.fg,
    }}>{s.label}</span>
  );
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function jsonPreview(obj, n = 60) {
  try {
    const s = JSON.stringify(obj);
    return truncate(s, n);
  } catch { return ''; }
}

function actionsSummary(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '—';
  const first = arr[0];
  const tag = first?.ok === false
    ? `ERR ${first?.rule || ''}`
    : (first?.result?.type || first?.rule || 'action');
  return arr.length === 1 ? String(tag) : `${arr.length} · ${tag}`;
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ ...card, padding: 16, flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || '#1A1A1A', marginTop: 4, fontFamily: 'Syne, Inter, sans-serif' }}>{value}</div>
    </div>
  );
}

function DetailDrawer({ event, onClose, onReplay, replaying }) {
  if (!event) return null;
  const sectionLabel = { fontSize: 11, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 };
  const valueText = { fontSize: 13, color: '#1A1A1A', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' };
  const block = { marginBottom: 16 };
  const pre = { background: '#0F0F0F', color: '#E5E3E0', padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320 };

  const latencyMs = event.processed_at && event.created_at
    ? new Date(event.processed_at).getTime() - new Date(event.created_at).getTime()
    : null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 800, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#FFF', height: '100%', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: 20, borderBottom: '1px solid #E5E3E0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'Syne, Inter, sans-serif', fontSize: 18, fontWeight: 800, color: '#1A1A1A', marginBottom: 4 }}>Event Detail</div>
            <div style={{ ...valueText, color: '#625650' }}>{event.id}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: 8, color: '#625650', fontSize: 18, width: 32, height: 32, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div><div style={sectionLabel}>Event Type</div><div style={valueText}>{event.event_type}</div></div>
            <div><div style={sectionLabel}>Category</div><div style={{ ...valueText, color: categoryColor(event.event_category) }}>{event.event_category}</div></div>
            <div><div style={sectionLabel}>Status</div><StatusPill status={event.status} /></div>
            <div><div style={sectionLabel}>Attempts</div><div style={valueText}>{event.processing_attempts ?? 0}</div></div>
            <div><div style={sectionLabel}>Actor</div><div style={valueText}>{event.actor_label || '—'} <span style={{ color: '#9E9B96' }}>({event.actor_type})</span></div></div>
            <div><div style={sectionLabel}>Entity</div><div style={valueText}>{event.entity_type ? `${event.entity_type}: ${event.entity_id}` : '—'}</div></div>
            <div><div style={sectionLabel}>Created</div><div style={valueText}>{fmtAbs(event.created_at)}</div></div>
            <div><div style={sectionLabel}>Processed</div><div style={valueText}>{fmtAbs(event.processed_at)}</div></div>
            <div><div style={sectionLabel}>Latency</div><div style={{ ...valueText, color: latencyColor(latencyMs) }}>{fmtLatency(latencyMs)}</div></div>
            <div><div style={sectionLabel}>Failed Reason</div><div style={valueText}>{event.failed_reason || '—'}</div></div>
          </div>

          <div style={block}>
            <div style={sectionLabel}>Payload</div>
            <pre style={pre}>{JSON.stringify(event.payload || {}, null, 2)}</pre>
          </div>

          <div style={block}>
            <div style={sectionLabel}>Metadata</div>
            <pre style={pre}>{JSON.stringify(event.metadata || {}, null, 2)}</pre>
          </div>

          <div style={block}>
            <div style={sectionLabel}>Actions Taken</div>
            <pre style={pre}>{JSON.stringify(event.actions_taken || [], null, 2)}</pre>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E3E0' }}>
            <button onClick={() => onReplay(event)} disabled={replaying} style={{ ...btnP, opacity: replaying ? 0.6 : 1, cursor: replaying ? 'wait' : 'pointer' }}>{replaying ? 'Replaying…' : '↻ Replay this event'}</button>
            <button onClick={onClose} style={btnS}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SystemEventsPage({ currentUserEmail }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [sending, setSending] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [toast, setToast] = useState(null);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterText, setFilterText] = useState('');

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchRows = useCallback(async () => {
    try {
      const data = await sbGet(
        'system_events',
        `select=*&order=created_at.desc&limit=${ROW_LIMIT}`
      );
      if (Array.isArray(data)) {
        setRows(data);
        setError(null);
      } else if (data && data.code) {
        setError(data.message || 'Fetch failed');
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
    const t = setInterval(fetchRows, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchRows]);

  // Keep the open drawer in sync with the latest fetched copy of that row
  // (so its status/actions update live while the drawer is open).
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find(r => r.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [rows, selected]);

  // Apply status / category / free-text filters client-side. Free-text matches
  // event_type, actor_label, entity_id, OR stringified payload — that covers
  // most of what someone would type into a search box ("find events for job
  // 26H015", "find Amiee's actions", "find anything with bond_number").
  // Filter is computed from `rows`, not refetched, so it's instant.
  const filteredRows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return rows.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterCategory !== 'all' && r.event_category !== filterCategory) return false;
      if (!needle) return true;
      const haystack = [
        r.event_type,
        r.actor_label,
        r.entity_id,
        r.entity_type,
        r.failed_reason,
        // Stringify payload + actions_taken so users can search inside JSON
        // (e.g. find every event mentioning a specific job_number).
        (() => { try { return JSON.stringify(r.payload || {}); } catch { return ''; } })(),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, filterStatus, filterCategory, filterText]);

  // Counts grouped by event_type, restricted to whatever the current filters
  // are showing. Lets you see at a glance "10 contract.executed today, 4
  // pis.submitted, 2 test.ping" without scrolling through the table.
  const typeBreakdown = useMemo(() => {
    const counts = new Map();
    for (const r of filteredRows) {
      counts.set(r.event_type, (counts.get(r.event_type) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // top 10 types is plenty for an overview strip
  }, [filteredRows]);

  // Distinct categories observed in the current row set, for the filter
  // dropdown. Always includes the standard ones from CATEGORY_COLORS so
  // they're available even before any matching events have been seen.
  const availableCategories = useMemo(() => {
    const seen = new Set(Object.keys(CATEGORY_COLORS));
    for (const r of rows) if (r.event_category) seen.add(r.event_category);
    return Array.from(seen).sort();
  }, [rows]);

  const filtersActive = filterStatus !== 'all' || filterCategory !== 'all' || filterText.trim() !== '';
  const clearFilters = () => { setFilterStatus('all'); setFilterCategory('all'); setFilterText(''); };

  const kpis = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const ts = todayStart.getTime();
    let pending = 0, processedToday = 0, failedToday = 0;
    for (const r of rows) {
      if (r.status === 'pending' || r.status === 'processing') pending++;
      const procT = r.processed_at ? new Date(r.processed_at).getTime() : 0;
      if (procT >= ts) {
        if (r.status === 'failed') failedToday++;
        else if (r.status === 'succeeded' || r.status === 'skipped') processedToday++;
      }
    }
    return { pending, processedToday, failedToday, total: rows.length };
  }, [rows]);

  const sendPing = useCallback(async () => {
    if (sending) return;
    setSending(true);
    try {
      await logEvent({
        event_type: 'test.ping',
        event_category: 'admin',
        actor_label: currentUserEmail || 'David',
        actor_type: 'user',
        payload: {
          message: 'Manual ping from System Events admin page',
          sent_at: new Date().toISOString(),
        },
      });
      showToast('Test ping sent. Watch for it in the table.', 'success');
      fetchRows();
    } catch (e) {
      showToast(`Send failed: ${e.message || e}`, 'error');
    } finally {
      setSending(false);
    }
  }, [sending, currentUserEmail, showToast, fetchRows]);

  const replayEvent = useCallback(async (ev) => {
    if (!ev || replaying) return;
    setReplaying(true);
    try {
      // Replay runs server-side now — RLS blocks authenticated UPDATE on
      // system_events (audit trail tamper-proofing), so the dispatcher is
      // the only thing privileged enough to reset a row to pending. Send
      // just the id; the dispatcher does reset + reprocess in one round-trip.
      const res = await fetch(sbFunctionUrl('dispatch_system_event'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: sbAuthHeader(),
          apikey: sbAuthHeader().replace(/^Bearer\s+/, ''),
        },
        body: JSON.stringify({ replay_id: ev.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `dispatcher returned ${res.status}`);
      showToast(`Replayed — ${body?.status || 'queued'}`, 'success');
      fetchRows();
    } catch (e) {
      showToast(`Replay failed: ${e.message || e}`, 'error');
    } finally {
      setReplaying(false);
    }
  }, [replaying, showToast, fetchRows]);

  const cell = { padding: '10px 12px', fontSize: 12, color: '#1A1A1A', borderBottom: '1px solid #F1F0EE', verticalAlign: 'top' };
  const headCell = { ...cell, fontSize: 10, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, background: '#FAFAF8', borderBottom: '1px solid #E5E3E0' };
  const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 280, flex: 1 }}>
          <div style={{ fontFamily: 'Syne, Inter, sans-serif', fontSize: 28, fontWeight: 900, color: '#1A1A1A' }}>System Events</div>
          <div style={{ fontSize: 13, color: '#625650', maxWidth: 720, marginTop: 6, lineHeight: 1.45 }}>
            Live event log for the agentic spine. Every business action emits an event here. The dispatcher processes them and records what it did. This is your debugging window for every future agent.
          </div>
        </div>
        <button onClick={sendPing} disabled={sending} style={{ ...btnP, opacity: sending ? 0.6 : 1, cursor: sending ? 'wait' : 'pointer' }}>
          {sending ? 'Sending…' : '⚡ Send Test Ping'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <Kpi label="Pending Now" value={kpis.pending} color={kpis.pending > 0 ? '#1D4ED8' : '#1A1A1A'} />
        <Kpi label="Processed Today" value={kpis.processedToday} color="#065F46" />
        <Kpi label="Failed Today" value={kpis.failedToday} color={kpis.failedToday > 0 ? '#991B1B' : '#1A1A1A'} />
        <Kpi label={`Total Events (last ${ROW_LIMIT})`} value={kpis.total} />
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FEE2E2', color: '#991B1B', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* Filter bar — status + category dropdowns + free-text search.
          Filters are applied client-side over the already-fetched rows.
          'Clear filters' is only shown when at least one filter is active. */}
      <div style={{ ...card, padding: 14, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</span>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, background: '#FFF', color: '#1A1A1A', cursor: 'pointer' }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#9E9B96', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Category</span>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, background: '#FFF', color: '#1A1A1A', cursor: 'pointer' }}>
            <option value="all">All</option>
            {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <input
          type="text"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Search event type, actor, entity, payload…"
          style={{ flex: '1 1 280px', minWidth: 200, fontSize: 12, padding: '7px 12px', border: '1px solid #E5E3E0', borderRadius: 6, background: '#FFF', color: '#1A1A1A' }}
        />
        {filtersActive && (
          <button onClick={clearFilters} style={{ ...btnS, padding: '7px 12px' }}>Clear filters</button>
        )}
        <div style={{ fontSize: 11, color: '#9E9B96', marginLeft: 'auto' }}>
          {filtersActive
            ? `Showing ${filteredRows.length} of ${rows.length}`
            : `${rows.length} events`}
        </div>
      </div>

      {/* Event-type breakdown strip — top 10 most frequent types in the
          current filter view. Click a chip to drill into just that type. */}
      {typeBreakdown.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {typeBreakdown.map(([type, count]) => (
            <button
              key={type}
              onClick={() => setFilterText(type)}
              title={`Filter to ${type} events`}
              style={{
                padding: '4px 10px',
                background: '#F4F4F2',
                border: '1px solid #E5E3E0',
                borderRadius: 99,
                fontSize: 11,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#1A1A1A',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {type} <span style={{ color: '#9E9B96', marginLeft: 4 }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={headCell}>Created</th>
                <th style={headCell}>Event Type</th>
                <th style={headCell}>Status</th>
                <th style={headCell}>Actor</th>
                <th style={headCell}>Entity</th>
                <th style={headCell}>Payload</th>
                <th style={headCell}>Actions Taken</th>
                <th style={headCell}>Processed</th>
                <th style={headCell}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ ...cell, padding: 32, textAlign: 'center', color: '#9E9B96' }}>Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ ...cell, padding: 32, textAlign: 'center', color: '#9E9B96' }}>
                  No events yet. Click <strong>Send Test Ping</strong> to verify the spine.
                </td></tr>
              )}
              {!loading && rows.length > 0 && filteredRows.length === 0 && (
                <tr><td colSpan={9} style={{ ...cell, padding: 32, textAlign: 'center', color: '#9E9B96' }}>
                  No events match the current filters. <button onClick={clearFilters} style={{ ...btnS, marginLeft: 8, padding: '4px 10px' }}>Clear filters</button>
                </td></tr>
              )}
              {filteredRows.map(r => {
                const latencyMs = r.processed_at && r.created_at
                  ? new Date(r.processed_at).getTime() - new Date(r.created_at).getTime()
                  : null;
                return (
                  <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#FAFAF8'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={cell} title={fmtAbs(r.created_at)}>{relTime(r.created_at)}</td>
                    <td style={{ ...cell, ...mono, color: categoryColor(r.event_category), fontWeight: 600 }}>{r.event_type}</td>
                    <td style={cell}><StatusPill status={r.status} /></td>
                    <td style={cell}>
                      <div>{r.actor_label || '—'}</div>
                      <div style={{ fontSize: 10, color: '#9E9B96' }}>({r.actor_type})</div>
                    </td>
                    <td style={cell} title={r.entity_id || ''}>
                      {r.entity_type ? <>
                        <div style={{ fontSize: 11, color: '#625650' }}>{r.entity_type}</div>
                        <div style={{ ...mono, fontSize: 10, color: '#9E9B96' }}>{truncate(r.entity_id || '', 12)}</div>
                      </> : <span style={{ color: '#9E9B96' }}>—</span>}
                    </td>
                    <td style={{ ...cell, ...mono, color: '#625650', maxWidth: 240 }}>{jsonPreview(r.payload)}</td>
                    <td style={{ ...cell, ...mono, color: '#625650' }}>{actionsSummary(r.actions_taken)}</td>
                    <td style={cell} title={fmtAbs(r.processed_at)}>{r.processed_at ? relTime(r.processed_at) : <span style={{ color: '#9E9B96' }}>—</span>}</td>
                    <td style={{ ...cell, color: latencyColor(latencyMs), fontWeight: 600 }}>{fmtLatency(latencyMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#9E9B96', marginTop: 10, display: 'flex', gap: 12 }}>
        <span>Auto-refreshes every {Math.round(REFRESH_MS / 1000)}s · last {ROW_LIMIT} rows{filtersActive ? ` · ${filteredRows.length} match filters` : ''}</span>
      </div>

      <DetailDrawer event={selected} onClose={() => setSelected(null)} onReplay={replayEvent} replaying={replaying} />

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 900, background: toast.kind === 'error' ? '#991B1B' : toast.kind === 'success' ? '#065F46' : '#1A1A1A', color: '#FFF', padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 6px 24px rgba(0,0,0,0.25)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
