// SharePointLinksPage
//
// Admin tool for linking job records to existing SharePoint folders.
//
// CONTEXT:
//   The OPS app stores a sharepoint_folder_url per job. Most jobs got
//   linked automatically by the backfill-sharepoint-folders edge function,
//   which scans the Active Jobs/{Market} folder structure and matches
//   folders to jobs by job number (e.g. "25H046" in the folder name).
//
//   But some jobs aren't linked because:
//     - Their folder lives outside Active Jobs (e.g. archive)
//     - The folder name doesn't contain a recognizable job number
//     - The job was created after the last backfill run
//     - OOS jobs (no entry in MARKET_FOLDERS map yet)
//
//   This page is the human-in-the-loop tool for fixing those cases.
//
// FEATURES:
//   - Per-job paste-URL field (paste from SharePoint, click Save)
//   - Filter by market / link state / status
//   - Run Backfill (Preview) — shows what would change without writing
//   - Run Backfill (Apply) — actually writes the matched URLs
//   - Open existing link / Clear link
//
// IMPORTANT: NO folders are CREATED here. This is link-only. If a job
// has no SharePoint folder yet, the user needs to create one in
// SharePoint first, then come here and paste the URL.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet, sbPatch, sbFunctionUrl, sbAuthHeader } from '../../shared/sb';
import { card, btnS } from '../../shared/ui';

// btnG here is the larger 8px/14px green variant (shape matches btnS, color
// matches success). Different from canonical btnG (6px/10px small). Kept
// local until a btnGL ladder rung is justified by a second caller.
const btnG = { padding: '8px 14px', background: '#065F46', border: 'none', borderRadius: 8, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 12 };
const btnDanger = { padding: '6px 10px', background: '#FFF', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 11 };

// Closed/dead statuses we hide by default — they're noise for this workflow.
const CLOSED_STATUSES = new Set(['canceled', 'cancelled', 'lost', 'dead', 'closed', 'fully_complete']);

// Quick recognition that pasted URL is a SharePoint URL. We don't reject
// non-SharePoint URLs (the user might be migrating from something else),
// but we surface a hint when the URL looks wrong.
const looksLikeSharePoint = (url) => {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('sharepoint.com') || u.includes('onedrive.live.com') || u.includes('1drv.ms');
};

const MARKET_LABELS = { AUS: 'Austin', DFW: 'Dallas', HOU: 'Houston', SA: 'San Antonio', CS: 'College Station', OOS: 'Out of State' };

export default function SharePointLinksPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterMarket, setFilterMarket] = useState('all');
  const [filterLink, setFilterLink] = useState('missing'); // missing | linked | all
  const [filterClosed, setFilterClosed] = useState(false); // include closed jobs?
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({}); // job_id -> pasted URL not yet saved
  const [saving, setSaving] = useState({}); // job_id -> bool
  const [savedAt, setSavedAt] = useState({}); // job_id -> timestamp for "saved!" flash
  const [error, setError] = useState({}); // job_id -> error msg

  // Backfill state
  const [bfLoading, setBfLoading] = useState(false);
  const [bfError, setBfError] = useState(null);
  const [bfResult, setBfResult] = useState(null); // last preview/apply response
  const [bfMode, setBfMode] = useState(null); // 'preview' or 'apply' for last run

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sbGet(
        'jobs',
        'select=id,job_number,job_name,customer_name,market,status,contract_date,sharepoint_folder_url&order=contract_date.desc.nullslast'
      );
      setJobs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ─── Stats ───
  const stats = useMemo(() => {
    const active = jobs.filter(j => !CLOSED_STATUSES.has(j.status));
    const linked = active.filter(j => j.sharepoint_folder_url);
    const missing = active.filter(j => !j.sharepoint_folder_url);
    // Detect duplicate URLs across the whole job set
    const urlMap = {};
    jobs.forEach(j => {
      if (j.sharepoint_folder_url) {
        const key = j.sharepoint_folder_url.toLowerCase();
        urlMap[key] = (urlMap[key] || []).concat(j);
      }
    });
    const dupes = Object.values(urlMap).filter(arr => arr.length > 1);
    return {
      total: jobs.length,
      active: active.length,
      linked: linked.length,
      missing: missing.length,
      dupes: dupes.length,
      dupeJobs: dupes.flat(),
    };
  }, [jobs]);

  // ─── Filtered list ───
  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter(j => {
      if (!filterClosed && CLOSED_STATUSES.has(j.status)) return false;
      if (filterMarket !== 'all' && j.market !== filterMarket) return false;
      if (filterLink === 'missing' && j.sharepoint_folder_url) return false;
      if (filterLink === 'linked' && !j.sharepoint_folder_url) return false;
      if (q) {
        const hay = [j.job_number, j.job_name, j.customer_name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, filterMarket, filterLink, filterClosed, search]);

  // ─── Save a single job's link ───
  const saveLink = async (job, url) => {
    const trimmed = (url || '').trim();
    if (!trimmed) {
      // Empty paste = clear the link (with confirm to avoid accidents)
      if (job.sharepoint_folder_url) {
        if (!window.confirm(`Clear the SharePoint link from ${job.job_number}?`)) return;
      }
    }
    setSaving(s => ({ ...s, [job.id]: true }));
    setError(e => ({ ...e, [job.id]: null }));
    try {
      await sbPatch('jobs', job.id, { sharepoint_folder_url: trimmed || null });
      // Optimistically update local state (avoids a full re-fetch)
      setJobs(js => js.map(j => j.id === job.id ? { ...j, sharepoint_folder_url: trimmed || null } : j));
      setDrafts(d => { const next = { ...d }; delete next[job.id]; return next; });
      setSavedAt(s => ({ ...s, [job.id]: Date.now() }));
      setTimeout(() => setSavedAt(s => { const next = { ...s }; delete next[job.id]; return next; }), 2500);
    } catch (e) {
      console.error('Save failed:', e);
      setError(err => ({ ...err, [job.id]: e.message || 'Save failed' }));
    }
    setSaving(s => ({ ...s, [job.id]: false }));
  };

  // ─── Run the backfill edge function ───
  const runBackfill = async (mode) => {
    if (mode === 'apply') {
      const ok = window.confirm(
        `Apply backfill?\n\nThis will write SharePoint URLs to jobs the function can match by job number in the folder name. Jobs that already have a URL are NOT overwritten.\n\nProceed?`
      );
      if (!ok) return;
    }
    setBfLoading(true);
    setBfError(null);
    setBfResult(null);
    setBfMode(mode);
    try {
      const resp = await fetch(sbFunctionUrl('backfill-sharepoint-folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: sbAuthHeader() },
        body: JSON.stringify({ mode }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setBfError(data.error || `HTTP ${resp.status}`);
      } else {
        setBfResult(data);
        if (mode === 'apply') {
          // Reload jobs so the table reflects new links
          await fetchJobs();
        }
      }
    } catch (e) {
      setBfError(e.message || 'Network error');
    }
    setBfLoading(false);
  };

  if (loading) {
    return <div style={{ padding: 40, color: '#625650', fontSize: 14 }}>Loading jobs…</div>;
  }

  return (
    <div style={{ padding: '20px 0' }}>
      {/* HEADER */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 900, color: '#8A261D' }}>🔗 SharePoint Links</div>
            <div style={{ fontSize: 12, color: '#625650', marginTop: 4, maxWidth: 640 }}>
              Link job records to their existing SharePoint folders. The app does <b>not</b> create folders — paste the URL of a folder that already exists in SharePoint, or run the auto-backfill which scans <code>Active Jobs/{'{Market}'}/</code> and matches folders by job number.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => runBackfill('preview')} disabled={bfLoading} style={{ ...btnS, opacity: bfLoading ? 0.5 : 1 }}>
              {bfLoading && bfMode === 'preview' ? 'Scanning…' : 'Run Backfill (Preview)'}
            </button>
            <button onClick={() => runBackfill('apply')} disabled={bfLoading} style={{ ...btnG, opacity: bfLoading ? 0.5 : 1 }}>
              {bfLoading && bfMode === 'apply' ? 'Applying…' : 'Run Backfill (Apply)'}
            </button>
          </div>
        </div>

        {/* STATS */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
          <Stat label="Active jobs" value={stats.active} />
          <Stat label="Linked" value={stats.linked} color="#065F46" />
          <Stat label="Missing link" value={stats.missing} color="#991B1B" />
          {stats.dupes > 0 && <Stat label="Duplicate URLs" value={stats.dupes} color="#854F0B" />}
        </div>

        {stats.dupes > 0 && <div style={{ marginTop: 12, padding: 10, background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, fontSize: 12, color: '#854F0B' }}>
          ⚠️ {stats.dupes} URL{stats.dupes === 1 ? ' is' : 's are'} linked to multiple jobs. Filter by "Linked" and search to find them.
        </div>}
      </div>

      {/* BACKFILL RESULT PANEL */}
      {bfError && <div style={{ ...card, marginBottom: 16, background: '#FEE2E2', border: '1px solid #FECACA' }}>
        <div style={{ fontWeight: 700, color: '#991B1B' }}>Backfill error</div>
        <div style={{ fontSize: 12, color: '#991B1B', fontFamily: 'monospace', marginTop: 4 }}>{bfError}</div>
      </div>}

      {bfResult && <BackfillResults result={bfResult} mode={bfMode} />}

      {/* FILTERS */}
      <div style={{ ...card, marginBottom: 12, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#625650', fontWeight: 700 }}>FILTER:</span>

          <select value={filterLink} onChange={e => setFilterLink(e.target.value)} style={selStyle}>
            <option value="missing">Missing link only</option>
            <option value="linked">Linked only</option>
            <option value="all">All</option>
          </select>

          <select value={filterMarket} onChange={e => setFilterMarket(e.target.value)} style={selStyle}>
            <option value="all">All markets</option>
            <option value="AUS">AUS — Austin</option>
            <option value="DFW">DFW — Dallas</option>
            <option value="HOU">HOU — Houston</option>
            <option value="SA">SA — San Antonio</option>
            <option value="CS">CS — College Station</option>
            <option value="OOS">OOS — Out of State</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={filterClosed} onChange={e => setFilterClosed(e.target.checked)} />
            Include closed/dead
          </label>

          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search job # / name / customer…"
            style={{ ...selStyle, minWidth: 240, flex: 1, maxWidth: 360 }}
          />

          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#625650', fontWeight: 600 }}>
            {filteredJobs.length} of {jobs.length} jobs
          </span>
        </div>
      </div>

      {/* TABLE */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {filteredJobs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9E9B96', fontSize: 13 }}>
            No jobs match the current filters.
          </div>
        ) : (
          <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#F4F4F2', zIndex: 1 }}>
                <tr>
                  <th style={th}>Job #</th>
                  <th style={th}>Job Name</th>
                  <th style={th}>Customer</th>
                  <th style={{ ...th, width: 60 }}>Mkt</th>
                  <th style={{ ...th, width: 110 }}>Status</th>
                  <th style={{ ...th, width: 380 }}>SharePoint URL</th>
                  <th style={{ ...th, width: 130 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((j, i) => {
                  const draft = drafts[j.id];
                  const hasDraft = draft !== undefined;
                  const value = hasDraft ? draft : (j.sharepoint_folder_url || '');
                  const isLinked = !!j.sharepoint_folder_url;
                  const isSaving = !!saving[j.id];
                  const justSaved = !!savedAt[j.id];
                  const err = error[j.id];
                  const valueLooksGood = !value || looksLikeSharePoint(value);
                  return (
                    <tr key={j.id} style={{ background: i % 2 === 0 ? '#FFF' : '#FAF9F7', borderTop: '1px solid #E5E3E0' }}>
                      <td style={{ ...td, fontWeight: 700, color: '#8A261D' }}>{j.job_number}</td>
                      <td style={td}>{j.job_name || '—'}</td>
                      <td style={{ ...td, color: '#625650' }}>{j.customer_name || '—'}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{j.market || '—'}</td>
                      <td style={{ ...td, fontSize: 11, color: '#625650' }}>{(j.status || '').replace(/_/g, ' ')}</td>
                      <td style={td}>
                        <input
                          type="text"
                          value={value}
                          onChange={e => setDrafts(d => ({ ...d, [j.id]: e.target.value }))}
                          placeholder="Paste SharePoint folder URL…"
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            border: '1px solid ' + (err ? '#FCA5A5' : valueLooksGood ? '#E5E3E0' : '#FCD34D'),
                            borderRadius: 6,
                            fontSize: 11,
                            fontFamily: 'monospace',
                            background: hasDraft ? '#FFFBEB' : (isLinked ? '#F0FDF4' : '#FFF'),
                          }}
                        />
                        {value && !valueLooksGood && <div style={{ fontSize: 10, color: '#854F0B', marginTop: 2 }}>
                          ⚠️ Doesn't look like a SharePoint URL — save anyway?
                        </div>}
                        {err && <div style={{ fontSize: 10, color: '#991B1B', marginTop: 2 }}>❌ {err}</div>}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {hasDraft ? (
                            <>
                              <button onClick={() => saveLink(j, draft)} disabled={isSaving} style={{ ...btnG, padding: '6px 10px', fontSize: 11 }}>
                                {isSaving ? '…' : 'Save'}
                              </button>
                              <button onClick={() => setDrafts(d => { const n = { ...d }; delete n[j.id]; return n; })} style={{ ...btnDanger, color: '#625650', borderColor: '#E5E3E0' }}>
                                Cancel
                              </button>
                            </>
                          ) : isLinked ? (
                            <>
                              <a href={j.sharepoint_folder_url} target="_blank" rel="noopener noreferrer" style={{ ...btnS, padding: '6px 10px', fontSize: 11, textDecoration: 'none' }}>
                                Open
                              </a>
                              <button onClick={() => saveLink(j, '')} style={btnDanger}>
                                Clear
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: '#9E9B96', fontStyle: 'italic' }}>No link</span>
                          )}
                          {justSaved && <span style={{ fontSize: 10, color: '#065F46', fontWeight: 700, marginLeft: 4 }}>✓ Saved</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HOW-TO */}
      <div style={{ ...card, marginTop: 16, padding: 16, background: '#F9F8F6' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', marginBottom: 8 }}>HOW TO LINK A JOB MANUALLY</div>
        <ol style={{ fontSize: 12, color: '#625650', margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Open SharePoint and navigate to the existing folder for the job</li>
          <li>Click <b>Copy link</b> in the top toolbar (or right-click the folder name → Copy link)</li>
          <li>If a permission dialog appears, copy the link as-is — anyone with company access already has the same permissions you do</li>
          <li>Paste the URL into the SharePoint URL column for that job above</li>
          <li>Click <b>Save</b>. The link will open in a new tab on the project record going forward.</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function Stat({ label, value, color }) {
  return (
    <div style={{ minWidth: 100 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || '#1A1A1A', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#625650', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function BackfillResults({ result, mode }) {
  const s = result.summary || {};
  return (
    <div style={{ ...card, marginBottom: 16, background: mode === 'apply' ? '#F0FDF4' : '#EFF6FF', border: '1px solid ' + (mode === 'apply' ? '#A7F3D0' : '#BFDBFE') }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, color: mode === 'apply' ? '#065F46' : '#1D4ED8', fontSize: 14 }}>
          {mode === 'apply' ? '✅ Backfill applied' : '🔍 Backfill preview'}
        </div>
        <div style={{ fontSize: 11, color: '#625650' }}>
          {s.folders_scanned} folders scanned · {s.jobs_in_database} DB jobs
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', fontSize: 12 }}>
        <Pill label="Matched (clean)" value={s.matched_clean} fg="#065F46" bg="#D1FAE5" />
        <Pill label="Already linked" value={s.matched_already_had_url} fg="#625650" bg="#F4F4F2" />
        <Pill label="Market mismatch" value={s.matched_market_mismatch} fg="#854F0B" bg="#FEF3C7" />
        <Pill label="Ambiguous" value={s.ambiguous_multiple_matches} fg="#854F0B" bg="#FEF3C7" />
        <Pill label="Unmatched folders" value={s.unmatched_no_job_found} fg="#625650" bg="#F4F4F2" />
        {mode === 'apply' && <Pill label="✓ Updated" value={s.updated} fg="#FFF" bg="#065F46" />}
      </div>

      {/* Show matched-clean preview list (only for preview mode, top 20) */}
      {mode === 'preview' && Array.isArray(result.matched) && result.matched.filter(m => !m.market_mismatch && !m.already_had_url).length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, fontWeight: 700, color: '#1D4ED8', cursor: 'pointer' }}>
            Will update {s.matched_clean} job{s.matched_clean === 1 ? '' : 's'} ▾
          </summary>
          <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto' }}>
            {result.matched.filter(m => !m.market_mismatch && !m.already_had_url).slice(0, 50).map((m, i) => (
              <div key={i} style={{ padding: '2px 0', color: '#625650' }}>
                <b style={{ color: '#1A1A1A' }}>{m.job_number}</b> ({m.job_market}) → {m.folder_name}
              </div>
            ))}
            {result.matched.filter(m => !m.market_mismatch && !m.already_had_url).length > 50 && (
              <div style={{ color: '#9E9B96', fontStyle: 'italic', marginTop: 4 }}>+ more not shown…</div>
            )}
          </div>
        </details>
      )}

      {/* Ambiguous warning detail */}
      {Array.isArray(result.ambiguous) && result.ambiguous.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, fontWeight: 700, color: '#854F0B', cursor: 'pointer' }}>
            ⚠️ {result.ambiguous.length} folder{result.ambiguous.length === 1 ? '' : 's'} matched multiple jobs (not auto-linked) ▾
          </summary>
          <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto' }}>
            {result.ambiguous.map((a, i) => (
              <div key={i} style={{ padding: '4px 0', color: '#854F0B' }}>
                <b>{a.folder_name}</b><br/>
                <span style={{ color: '#625650' }}>matched: {a.matched_jobs.map(j => j.job_number).join(', ')}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Pill({ label, value, fg, bg }) {
  return (
    <div style={{ padding: '6px 10px', borderRadius: 8, background: bg, color: fg, display: 'flex', flexDirection: 'column', minWidth: 90 }}>
      <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{value ?? 0}</span>
      <span style={{ fontSize: 10, fontWeight: 700, marginTop: 2 }}>{label}</span>
    </div>
  );
}

const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #E5E3E0' };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
const selStyle = { padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 12, background: '#FFF', cursor: 'pointer' };
