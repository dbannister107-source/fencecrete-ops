// CustomerMasterPage
//
// Phase 2.2 (2026-04-30): bulk actions on the Reconcile tab.
// - Checkbox per row to multi-select customer-name groups
// - Sticky bulk action bar (gray) when any are selected:
//     · Mark all residential
//     · Link all to… (company picker dropdown)
//     · Select all visible / Clear
// - "Auto-accept N high-confidence matches" button in the toolbar.
//   Scans every unmatched group, finds the top company match ≥80%
//   similarity, opens a preview modal where each suggestion can be
//   unchecked. One click commits all accepted matches in batched
//   PATCHes (one per target company), single undo entry covers
//   the whole batch.
//
// Phase 2.1 (2026-04-30): added Undo button on the success toast.
// Reverses link / mark-residential / create-and-link actions.
// In-memory only (refresh wipes it).
//
// Phase 2 (2026-04-30): added Reconcile tab — match unmatched jobs
// to existing companies via fuzzy suggestions, create new companies
// inline, or mark as residential.
//
// Phase 1 (2026-04-30): Diagnostic tab. Read-only counters + duplicate
// finder + per-market breakdown + top unmatched list.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet, H } from '../../shared/sb';

const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';

const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const stat = { padding: 16, background: '#F9F8F6', border: '1px solid #E5E3E0', borderRadius: 10 };
const statLabel = { fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', letterSpacing: 0.5 };
const statValue = { fontSize: 24, fontWeight: 900, color: '#1A1A1A', fontFamily: 'Inter', marginTop: 4 };
const btnP = { padding: '8px 14px', background: '#8A261D', border: 'none', borderRadius: 8, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 12 };
const btnS = { padding: '8px 14px', background: '#F4F4F2', color: '#625650', border: '1px solid #E5E3E0', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12 };
const btnG = { padding: '6px 10px', background: '#065F46', border: 'none', borderRadius: 6, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 11 };
const btnB = { padding: '6px 10px', background: '#1D4ED8', border: 'none', borderRadius: 6, color: '#FFF', fontWeight: 700, cursor: 'pointer', fontSize: 11 };
const inputS = { padding: '6px 10px', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#FFF' };

const fmtMoney = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toFixed(0)}`;
};

// Stop-words to strip when comparing names. These show up everywhere
// and dilute fuzzy match scores. "Acme Construction LLC" should match
// "Acme Construction L.L.C." even though the suffixes differ.
const STOP_WORDS = new Set([
  'inc', 'llc', 'lp', 'ltd', 'corp', 'co', 'company', 'group', 'holdings',
  'the', 'and', '&', 'of', 'for', 'with', 'a', 'an',
  'l.p.', 'l.l.c.', 'l.l.p.',
]);

const normalizeForMatch = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/[-_/]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t))
    .join(' ');

const tokensFor = (s) => new Set(normalizeForMatch(s).split(/\s+/).filter(Boolean));

// Fuzzy similarity: Jaccard on stripped tokens + bonus for shared first token.
// Scores 0..1. Threshold ~0.4 for "worth showing as a suggestion".
const similarity = (a, b) => {
  const ta = tokensFor(a);
  const tb = tokensFor(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach((t) => { if (tb.has(t)) shared++; });
  const jaccard = shared / (ta.size + tb.size - shared);
  // Boost if first significant token matches (e.g. 'lennar' on both)
  const aFirst = [...ta][0];
  const bFirst = [...tb][0];
  const firstBonus = aFirst && aFirst === bFirst ? 0.15 : 0;
  return Math.min(1, jaccard + firstBonus);
};

export default function CustomerMasterPage({ currentUserEmail = '', currentUserName = null } = {}) {
  const [tab, setTab] = useState('diagnostic'); // 'diagnostic' | 'reconcile' | 'companies'
  const [jobs, setJobs] = useState([]);
  const [companies, setCompanies] = useState([]);
  // Live (non-deleted) company_attachment rows: just id + company_id, used to
  // compute per-company doc counts on the Companies & Docs tab. Full doc rows
  // (with category, filename, etc) are fetched lazily when a card expands.
  const [allCompanyDocs, setAllCompanyDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [jobsData, companiesData, docsData] = await Promise.all([
        sbGet('jobs', 'select=id,job_number,job_name,customer_name,market,status,company_id,is_residential,net_contract_value&order=customer_name.asc'),
        sbGet('companies', 'select=id,name,company_type,market,active,address,city,state&order=name.asc'),
        sbGet('company_attachments', 'select=id,company_id&deleted_at=is.null'),
      ]);
      setJobs(Array.isArray(jobsData) ? jobsData : []);
      setCompanies(Array.isArray(companiesData) ? companiesData : []);
      setAllCompanyDocs(Array.isArray(docsData) ? docsData : []);
    } catch (e) {
      console.error('[CustomerMaster] fetch failed:', e);
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, refreshKey]);

  // ---- DIAGNOSTIC VIEW DATA ----
  const stats = useMemo(() => {
    const total = jobs.length;
    const linked = jobs.filter((j) => j.company_id).length;
    const residential = jobs.filter((j) => j.is_residential).length;
    const unmatched = total - linked - residential;
    const pct = total > 0 ? Math.round((linked / total) * 100) : 0;
    return { total, linked, residential, unmatched, pct };
  }, [jobs]);

  const marketState = useMemo(() => {
    const groups = {};
    jobs.forEach((j) => {
      const m = j.market || '(none)';
      if (!groups[m]) groups[m] = { market: m, total: 0, linked: 0, residential: 0, unmatched: 0, ncvUnmatched: 0 };
      groups[m].total++;
      if (j.company_id) groups[m].linked++;
      else if (j.is_residential) groups[m].residential++;
      else {
        groups[m].unmatched++;
        groups[m].ncvUnmatched += Number(j.net_contract_value) || 0;
      }
    });
    return Object.values(groups).sort((a, b) => b.unmatched - a.unmatched);
  }, [jobs]);

  // ---- RECONCILE VIEW DATA ----
  // Group unmatched jobs by customer_name. Each group is a reconciliation unit
  // — Amiee resolves the name once and all jobs with that customer_name move.
  const unmatchedGroups = useMemo(() => {
    const groups = {};
    jobs.forEach((j) => {
      if (j.company_id || j.is_residential) return;
      const k = j.customer_name || '(blank)';
      if (!groups[k]) groups[k] = { name: k, jobs: [], ncv: 0, markets: new Set() };
      groups[k].jobs.push(j);
      groups[k].ncv += Number(j.net_contract_value) || 0;
      if (j.market) groups[k].markets.add(j.market);
    });
    return Object.values(groups)
      .map((g) => ({ ...g, count: g.jobs.length, markets: Array.from(g.markets).sort().join(', ') }))
      .sort((a, b) => b.count - a.count || b.ncv - a.ncv);
  }, [jobs]);

  // Drive-by hints from elsewhere in the app (Reports → Customer Concentration
  // row clicks, banner clicks) drop a localStorage breadcrumb before
  // navigating here. Read once on mount and clear so refreshing the page
  // doesn't re-jump the user.
  //   fc_customer_master_focus_tab     → 'diagnostic' | 'reconcile' | 'companies'
  //   fc_customer_master_focus_company → uuid; also auto-pre-expands that card
  //                                       on the Companies & Docs tab
  const [initialFocusCompanyId, setInitialFocusCompanyId] = useState(null);
  useEffect(() => {
    try {
      const tabHint = localStorage.getItem('fc_customer_master_focus_tab');
      const coHint = localStorage.getItem('fc_customer_master_focus_company');
      if (tabHint) {
        localStorage.removeItem('fc_customer_master_focus_tab');
        if (tabHint === 'diagnostic' || tabHint === 'reconcile' || tabHint === 'companies') {
          setTab(tabHint);
        }
      } else if (coHint) {
        // Company hint without an explicit tab → land on Companies & Docs.
        setTab('companies');
      }
      if (coHint) {
        localStorage.removeItem('fc_customer_master_focus_company');
        setInitialFocusCompanyId(coHint);
      }
    } catch (e) { /* localStorage blocked, ignore */ }
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9E9B96' }}>Loading customer master state…</div>;
  if (error) return <div style={{ ...card, color: '#991B1B' }}><div style={{ fontWeight: 800 }}>Error loading data</div><div style={{ fontSize: 12 }}>{error}</div></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🏢 Customer Master</h1>
          <div style={{ fontSize: 13, color: '#625650' }}>
            {tab === 'diagnostic'
              ? 'Read-only diagnostic of customer↔company link state.'
              : tab === 'reconcile'
                ? `Reconcile ${unmatchedGroups.length} unmatched customer name${unmatchedGroups.length === 1 ? '' : 's'} (${stats.unmatched} job${stats.unmatched === 1 ? '' : 's'}).`
                : 'Per-company document library. One upload fans out to every linked job (now and future) when auto-attach is on.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTab('diagnostic')} style={{
            ...btnS,
            background: tab === 'diagnostic' ? '#8A261D' : '#FFF',
            color: tab === 'diagnostic' ? '#FFF' : '#625650',
            borderColor: tab === 'diagnostic' ? '#8A261D' : '#E5E3E0',
          }}>📊 Diagnostic</button>
          <button onClick={() => setTab('reconcile')} style={{
            ...btnS,
            background: tab === 'reconcile' ? '#8A261D' : '#FFF',
            color: tab === 'reconcile' ? '#FFF' : '#625650',
            borderColor: tab === 'reconcile' ? '#8A261D' : '#E5E3E0',
          }}>🔧 Reconcile {stats.unmatched > 0 && `(${stats.unmatched})`}</button>
          <button onClick={() => setTab('companies')} style={{
            ...btnS,
            background: tab === 'companies' ? '#8A261D' : '#FFF',
            color: tab === 'companies' ? '#FFF' : '#625650',
            borderColor: tab === 'companies' ? '#8A261D' : '#E5E3E0',
          }}>📎 Companies &amp; Docs</button>
        </div>
      </div>

      {tab === 'diagnostic' && (
        <DiagnosticView stats={stats} marketState={marketState} unmatchedGroups={unmatchedGroups} companies={companies} />
      )}

      {tab === 'reconcile' && (
        <ReconcileView
          unmatchedGroups={unmatchedGroups}
          companies={companies}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {tab === 'companies' && (
        <CompaniesAndDocsView
          companies={companies}
          jobs={jobs}
          allCompanyDocs={allCompanyDocs}
          currentUserEmail={currentUserEmail}
          currentUserName={currentUserName}
          initialFocusCompanyId={initialFocusCompanyId}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <div style={{ fontSize: 11, color: '#9E9B96', textAlign: 'center', padding: 8 }}>
        Phase 2 of customer master rollout · {companies.length} companies · {jobs.length} jobs · {stats.linked} linked, {stats.residential} residential, {stats.unmatched} to reconcile
      </div>
    </div>
  );
}

// ============================================================
// DIAGNOSTIC VIEW
// ============================================================
function DiagnosticView({ stats, marketState, unmatchedGroups, companies }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <div style={stat}><div style={statLabel}>Total Jobs</div><div style={statValue}>{stats.total}</div></div>
        <div style={{ ...stat, background: '#ECFDF5', borderColor: '#86EFAC' }}>
          <div style={{ ...statLabel, color: '#065F46' }}>Linked</div>
          <div style={{ ...statValue, color: '#065F46' }}>{stats.linked}</div>
        </div>
        <div style={{ ...stat, background: '#DBEAFE', borderColor: '#93C5FD' }}>
          <div style={{ ...statLabel, color: '#1D4ED8' }}>Residential</div>
          <div style={{ ...statValue, color: '#1D4ED8' }}>{stats.residential}</div>
        </div>
        <div style={{ ...stat, background: '#FEF3C7', borderColor: '#FCD34D' }}>
          <div style={{ ...statLabel, color: '#92400E' }}>To Reconcile</div>
          <div style={{ ...statValue, color: '#92400E' }}>{stats.unmatched}</div>
        </div>
        <div style={stat}>
          <div style={statLabel}>% Linked</div>
          <div style={statValue}>{stats.pct}%</div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800, marginBottom: 12 }}>By Market</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E3E0' }}>
              {['Market', 'Total', 'Linked', 'Residential', 'To Reconcile', 'NCV @ Risk', '% Linked'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {marketState.map((m) => {
              const pct = m.total > 0 ? Math.round((m.linked / m.total) * 100) : 0;
              return (
                <tr key={m.market} style={{ borderBottom: '1px solid #F4F4F2' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{m.market}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter' }}>{m.total}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: '#065F46', fontWeight: 700 }}>{m.linked}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: '#1D4ED8', fontWeight: 700 }}>{m.residential}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: m.unmatched > 0 ? '#92400E' : '#9E9B96', fontWeight: 700 }}>{m.unmatched}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: '#625650' }}>{fmtMoney(m.ncvUnmatched)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 700, color: pct >= 80 ? '#065F46' : pct >= 50 ? '#92400E' : '#991B1B' }}>{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Top Unmatched ({unmatchedGroups.length})</div>
        <div style={{ fontSize: 12, color: '#625650', marginBottom: 12 }}>Switch to the Reconcile tab to fix these one-by-one.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E3E0' }}>
              {['Customer Name', 'Jobs', 'NCV', 'Markets'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: i === 0 || i === 3 ? 'left' : 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unmatchedGroups.slice(0, 25).map((u, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F4F4F2' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{u.name}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 700 }}>{u.count}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: '#625650' }}>{fmtMoney(u.ncv)}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: '#625650' }}>{u.markets || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// RECONCILE VIEW
// ============================================================
function ReconcileView({ unmatchedGroups, companies, onRefresh }) {
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState('all');
  const [busy, setBusy] = useState(null); // customer_name being saved
  // Toast state. When an action succeeds, `lastAction` is also set with the
  // payload needed to reverse it. Click Undo → reverse → clear → refresh.
  // Errors set toast WITHOUT lastAction (nothing to undo).
  // Undo is in-memory only — refresh / navigate-away wipes it. That's fine,
  // undo is "I just clicked the wrong thing", not "yesterday I made a mistake".
  const [toast, setToast] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [undoing, setUndoing] = useState(false);

  // Bulk selection — set of customer_name strings (each is one ReconcileRow).
  // When >0, a sticky action bar appears at the top with bulk actions.
  // Cleared on every successful action (so user starts fresh after each batch).
  const [selectedNames, setSelectedNames] = useState(() => new Set());
  const [bulkLinkOpen, setBulkLinkOpen] = useState(false); // dropdown for "Link selected to..."
  const [bulkLinkSearch, setBulkLinkSearch] = useState('');
  // Auto-accept preview modal — populated when user clicks "Auto-accept high-confidence"
  const [autoPreview, setAutoPreview] = useState(null); // {matches: [{group, company, score}], total}

  // Show only unmatched groups matching search + market
  const filtered = useMemo(() => {
    let f = unmatchedGroups;
    if (marketFilter !== 'all') {
      f = f.filter((g) => g.markets.includes(marketFilter));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((g) => g.name.toLowerCase().includes(q));
    }
    return f;
  }, [unmatchedGroups, marketFilter, search]);

  const allMarkets = useMemo(() => {
    const s = new Set();
    unmatchedGroups.forEach((g) => g.markets.split(',').map((m) => m.trim()).filter(Boolean).forEach((m) => s.add(m)));
    return [...s].sort();
  }, [unmatchedGroups]);

  // Action: link all jobs in a group to an existing company
  const linkToCompany = useCallback(async (group, company) => {
    setBusy(group.name);
    try {
      const jobIds = group.jobs.map((j) => j.id);
      const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
        method: 'PATCH',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ company_id: company.id }),
      });
      if (!res.ok && res.status !== 204) {
        const txt = await res.text();
        throw new Error(`Link failed (${res.status}): ${txt.slice(0, 120)}`);
      }
      setToast({ msg: `Linked ${group.count} job${group.count === 1 ? '' : 's'} to ${company.name}`, kind: 'success' });
      // Record undo payload: jobs were unlinked before, now linked. Reverse = unlink.
      setLastAction({
        kind: 'link',
        jobIds,
        groupName: group.name,
        companyName: company.name,
      });
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Link failed: ' + e.message, kind: 'error' });
      setLastAction(null);
    } finally {
      setBusy(null);
    }
  }, [onRefresh]);

  // Action: mark all jobs in a group as residential
  const markResidential = useCallback(async (group) => {
    setBusy(group.name);
    try {
      const jobIds = group.jobs.map((j) => j.id);
      const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
        method: 'PATCH',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ is_residential: true }),
      });
      if (!res.ok && res.status !== 204) {
        const txt = await res.text();
        throw new Error(`Mark residential failed (${res.status}): ${txt.slice(0, 120)}`);
      }
      setToast({ msg: `Marked ${group.count} job${group.count === 1 ? '' : 's'} as residential`, kind: 'success' });
      // Record undo payload: was is_residential=false, now true. Reverse = false.
      setLastAction({
        kind: 'residential',
        jobIds,
        groupName: group.name,
      });
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Mark failed: ' + e.message, kind: 'error' });
      setLastAction(null);
    } finally {
      setBusy(null);
    }
  }, [onRefresh]);

  // Action: create a new company and link jobs to it
  const createAndLink = useCallback(async (group, draft) => {
    setBusy(group.name);
    try {
      // Create the company
      const createRes = await fetch(`${SB}/rest/v1/companies`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          name: draft.name.trim(),
          company_type: 'customer',
          market: draft.market || group.markets.split(',')[0]?.trim() || null,
          active: true,
        }),
      });
      if (!createRes.ok) {
        const txt = await createRes.text();
        throw new Error(`Create company failed (${createRes.status}): ${txt.slice(0, 200)}`);
      }
      const created = JSON.parse(await createRes.text());
      const newCompanyId = created[0]?.id;
      if (!newCompanyId) throw new Error('No company ID returned from insert');

      // Link the jobs
      const jobIds = group.jobs.map((j) => j.id);
      const linkRes = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
        method: 'PATCH',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ company_id: newCompanyId }),
      });
      if (!linkRes.ok && linkRes.status !== 204) {
        const txt = await linkRes.text();
        throw new Error(`Link failed (${linkRes.status}): ${txt.slice(0, 120)}`);
      }
      setToast({ msg: `Created "${draft.name}" and linked ${group.count} job${group.count === 1 ? '' : 's'}`, kind: 'success' });
      // Record undo payload: created company AND linked jobs. Reverse = unlink jobs,
      // then delete company IF nothing else references it (defensive).
      setLastAction({
        kind: 'create_and_link',
        jobIds,
        groupName: group.name,
        createdCompanyId: newCompanyId,
        createdCompanyName: draft.name.trim(),
      });
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Create+link failed: ' + e.message, kind: 'error' });
      setLastAction(null);
    } finally {
      setBusy(null);
    }
  }, [onRefresh]);

  // Reverse the last action. Per-kind logic:
  //   - link: PATCH jobs back to company_id=null
  //   - residential: PATCH jobs back to is_residential=false
  //   - create_and_link: PATCH jobs to company_id=null, THEN attempt to delete
  //     the company we just created. Skip the delete if other jobs got linked
  //     to that company in the meantime (rare, but defensive).
  const performUndo = useCallback(async () => {
    if (!lastAction) return;
    setUndoing(true);
    try {
      const { kind, jobIds, createdCompanyId, createdCompanyName, companyName, groupName } = lastAction;

      if (kind === 'link') {
        const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ company_id: null }),
        });
        if (!res.ok && res.status !== 204) {
          const txt = await res.text();
          throw new Error(`Undo link failed (${res.status}): ${txt.slice(0, 120)}`);
        }
        setToast({ msg: `Undone — unlinked ${jobIds.length} job${jobIds.length === 1 ? '' : 's'} from ${companyName}`, kind: 'gray' });
      } else if (kind === 'residential') {
        const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ is_residential: false }),
        });
        if (!res.ok && res.status !== 204) {
          const txt = await res.text();
          throw new Error(`Undo residential failed (${res.status}): ${txt.slice(0, 120)}`);
        }
        setToast({ msg: `Undone — ${jobIds.length} job${jobIds.length === 1 ? '' : 's'} no longer marked residential`, kind: 'gray' });
      } else if (kind === 'create_and_link') {
        // Step 1: unlink the jobs we linked
        const unlinkRes = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ company_id: null }),
        });
        if (!unlinkRes.ok && unlinkRes.status !== 204) {
          const txt = await unlinkRes.text();
          throw new Error(`Undo unlink failed (${unlinkRes.status}): ${txt.slice(0, 120)}`);
        }
        // Step 2: defensive — only delete the company if no OTHER jobs reference
        // it. If someone linked another group to this company in the meantime,
        // leave it alone (just unlink ours).
        const refCheck = await fetch(`${SB}/rest/v1/jobs?company_id=eq.${createdCompanyId}&select=id&limit=1`, {
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
        });
        const stillReferenced = refCheck.ok ? (await refCheck.json()).length > 0 : true; // be safe on error
        if (!stillReferenced) {
          const deleteRes = await fetch(`${SB}/rest/v1/companies?id=eq.${createdCompanyId}`, {
            method: 'DELETE',
            headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
          });
          if (!deleteRes.ok && deleteRes.status !== 204) {
            // Non-fatal — jobs are already unlinked, just leave the orphan company.
            console.warn('Undo: failed to delete created company', createdCompanyId, await deleteRes.text());
            setToast({ msg: `Undone — unlinked ${jobIds.length} job${jobIds.length === 1 ? '' : 's'} but couldn't delete "${createdCompanyName}" (kept as orphan)`, kind: 'gray' });
          } else {
            setToast({ msg: `Undone — unlinked jobs and deleted "${createdCompanyName}"`, kind: 'gray' });
          }
        } else {
          setToast({ msg: `Undone — unlinked ${jobIds.length} job${jobIds.length === 1 ? '' : 's'}. Kept "${createdCompanyName}" (other jobs are linked to it now)`, kind: 'gray' });
        }
      }

      setLastAction(null);
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Undo failed: ' + e.message, kind: 'error' });
    } finally {
      setUndoing(false);
    }
  }, [lastAction, onRefresh]);

  // ============================================================
  // BULK ACTIONS
  // ============================================================
  // Selection helpers — the checkbox in each ReconcileRow toggles via this.
  const toggleSelected = useCallback((name) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedNames(new Set()), []);
  const selectAllVisible = useCallback((visibleGroups) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      visibleGroups.forEach((g) => next.add(g.name));
      return next;
    });
  }, []);

  // Resolve selected names → list of group objects (for job ID extraction).
  const selectedGroups = useMemo(
    () => unmatchedGroups.filter((g) => selectedNames.has(g.name)),
    [unmatchedGroups, selectedNames]
  );
  const selectedJobCount = useMemo(
    () => selectedGroups.reduce((s, g) => s + g.count, 0),
    [selectedGroups]
  );

  // Bulk: mark all selected as residential. One PATCH covers all jobs across
  // all selected groups. One undo entry reverses the whole batch.
  const bulkMarkResidential = useCallback(async () => {
    if (selectedGroups.length === 0) return;
    setBusy('__bulk__');
    try {
      const jobIds = selectedGroups.flatMap((g) => g.jobs.map((j) => j.id));
      const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
        method: 'PATCH',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ is_residential: true }),
      });
      if (!res.ok && res.status !== 204) {
        const txt = await res.text();
        throw new Error(`Bulk mark failed (${res.status}): ${txt.slice(0, 120)}`);
      }
      setToast({
        msg: `Marked ${jobIds.length} job${jobIds.length === 1 ? '' : 's'} across ${selectedGroups.length} customer name${selectedGroups.length === 1 ? '' : 's'} as residential`,
        kind: 'success',
      });
      setLastAction({ kind: 'residential', jobIds, groupName: `${selectedGroups.length} customers` });
      clearSelection();
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Bulk mark failed: ' + e.message, kind: 'error' });
      setLastAction(null);
    } finally {
      setBusy(null);
    }
  }, [selectedGroups, clearSelection, onRefresh]);

  // Bulk: link all selected groups to ONE chosen company. Single PATCH.
  const bulkLinkToCompany = useCallback(async (company) => {
    if (selectedGroups.length === 0) return;
    setBusy('__bulk__');
    try {
      const jobIds = selectedGroups.flatMap((g) => g.jobs.map((j) => j.id));
      const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
        method: 'PATCH',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ company_id: company.id }),
      });
      if (!res.ok && res.status !== 204) {
        const txt = await res.text();
        throw new Error(`Bulk link failed (${res.status}): ${txt.slice(0, 120)}`);
      }
      setToast({
        msg: `Linked ${jobIds.length} job${jobIds.length === 1 ? '' : 's'} across ${selectedGroups.length} customer name${selectedGroups.length === 1 ? '' : 's'} to ${company.name}`,
        kind: 'success',
      });
      setLastAction({ kind: 'link', jobIds, groupName: `${selectedGroups.length} customers`, companyName: company.name });
      setBulkLinkOpen(false);
      setBulkLinkSearch('');
      clearSelection();
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Bulk link failed: ' + e.message, kind: 'error' });
      setLastAction(null);
    } finally {
      setBusy(null);
    }
  }, [selectedGroups, clearSelection, onRefresh]);

  // ============================================================
  // AUTO-ACCEPT HIGH-CONFIDENCE FUZZY MATCHES
  // ============================================================
  // Scan all unmatched groups, find the top fuzzy candidate per group,
  // collect everything ≥ 0.80 similarity. Show preview modal — user can
  // uncheck any false positives, then commit all in one PATCH.
  // Threshold of 0.80 is conservative — rare to be wrong at that level
  // because the Jaccard+first-token-bonus formula already excludes most noise.
  const HIGH_CONFIDENCE_THRESHOLD = 0.80;
  const highConfidenceMatches = useMemo(() => {
    const matches = [];
    for (const g of unmatchedGroups) {
      let best = null;
      for (const c of companies) {
        const score = similarity(g.name, c.name);
        if (score >= HIGH_CONFIDENCE_THRESHOLD && (!best || score > best.score)) {
          best = { group: g, company: c, score };
        }
      }
      if (best) matches.push(best);
    }
    return matches.sort((a, b) => b.score - a.score);
  }, [unmatchedGroups, companies]);

  const openAutoPreview = useCallback(() => {
    // Default: all matches checked. User can uncheck false positives in modal.
    setAutoPreview({
      matches: highConfidenceMatches.map((m) => ({ ...m, accepted: true })),
    });
  }, [highConfidenceMatches]);

  const toggleAutoMatch = useCallback((idx) => {
    setAutoPreview((prev) => {
      if (!prev) return prev;
      const next = [...prev.matches];
      next[idx] = { ...next[idx], accepted: !next[idx].accepted };
      return { matches: next };
    });
  }, []);

  // Commit auto-accept: group jobs by target company, then issue ONE PATCH
  // per company. Single undo entry covers the whole batch (reverses all
  // job_id updates across all companies in one PATCH).
  const commitAutoAccept = useCallback(async () => {
    if (!autoPreview) return;
    const accepted = autoPreview.matches.filter((m) => m.accepted);
    if (accepted.length === 0) {
      setAutoPreview(null);
      return;
    }
    setBusy('__bulk__');
    try {
      // Group by company so we can do one PATCH per target.
      const byCompany = new Map();
      accepted.forEach(({ group, company }) => {
        if (!byCompany.has(company.id)) byCompany.set(company.id, { company, jobIds: [] });
        group.jobs.forEach((j) => byCompany.get(company.id).jobIds.push(j.id));
      });
      // Execute sequentially. PATCHes are idempotent so partial failure is recoverable.
      const allJobIds = [];
      for (const [companyId, { jobIds }] of byCompany.entries()) {
        const res = await fetch(`${SB}/rest/v1/jobs?id=in.(${jobIds.join(',')})`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ company_id: companyId }),
        });
        if (!res.ok && res.status !== 204) {
          const txt = await res.text();
          throw new Error(`Auto-accept failed mid-batch (${res.status}): ${txt.slice(0, 120)}`);
        }
        allJobIds.push(...jobIds);
      }
      setToast({
        msg: `Auto-accepted ${accepted.length} match${accepted.length === 1 ? '' : 'es'} (${allJobIds.length} job${allJobIds.length === 1 ? '' : 's'} linked)`,
        kind: 'success',
      });
      // Single undo entry covers all linked jobs across all companies.
      setLastAction({ kind: 'link', jobIds: allJobIds, groupName: `${accepted.length} auto-matched`, companyName: 'multiple companies' });
      setAutoPreview(null);
      clearSelection();
      onRefresh();
    } catch (e) {
      setToast({ msg: 'Auto-accept failed: ' + e.message, kind: 'error' });
      setLastAction(null);
    } finally {
      setBusy(null);
    }
  }, [autoPreview, clearSelection, onRefresh]);

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Search customer names…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputS, flex: '1 1 200px', minWidth: 200 }}
          />
          <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)} style={inputS}>
            <option value="all">All markets</option>
            {allMarkets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {/* Auto-accept lives in the toolbar — it scans all groups, not just selected,
              and pre-fills the preview modal. Hidden when 0 matches at the threshold. */}
          {highConfidenceMatches.length > 0 && (
            <button onClick={openAutoPreview} style={{ ...btnS, background: '#FEF3C7', borderColor: '#FCD34D', color: '#92400E' }}>
              ⚡ Auto-accept {highConfidenceMatches.length} high-confidence match{highConfidenceMatches.length === 1 ? '' : 'es'}
            </button>
          )}
        </div>

        {/* Bulk action bar — sticky-feeling, only visible when something is selected */}
        {selectedNames.size > 0 && (
          <div style={{
            marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: '#1F2937', color: '#FFF',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {selectedNames.size} customer name{selectedNames.size === 1 ? '' : 's'} selected · {selectedJobCount} job{selectedJobCount === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'relative' }}>
              <button
                onClick={bulkMarkResidential}
                disabled={busy === '__bulk__'}
                style={{ ...btnS, background: '#DBEAFE', color: '#1D4ED8', borderColor: '#93C5FD' }}
              >
                🏠 Mark all residential
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setBulkLinkOpen((s) => !s)}
                  disabled={busy === '__bulk__'}
                  style={{ ...btnS, background: '#FFF', color: '#1A1A1A' }}
                >
                  🔗 Link all to… {bulkLinkOpen ? '▲' : '▼'}
                </button>
                {bulkLinkOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 280, maxHeight: 320, overflowY: 'auto',
                    background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    padding: 8, zIndex: 100,
                  }}>
                    <input
                      placeholder="Search companies…"
                      value={bulkLinkSearch}
                      onChange={(e) => setBulkLinkSearch(e.target.value)}
                      style={{ ...inputS, width: '100%', marginBottom: 6 }}
                      autoFocus
                    />
                    {companies
                      .filter((c) => !bulkLinkSearch.trim() || (c.name || '').toLowerCase().includes(bulkLinkSearch.toLowerCase()))
                      .slice(0, 25)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => bulkLinkToCompany(c)}
                          disabled={busy === '__bulk__'}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 12,
                            background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#1A1A1A',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#F4F4F2')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          {c.market && <div style={{ fontSize: 10, color: '#9E9B96' }}>{c.market}</div>}
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => selectAllVisible(filtered)}
                disabled={busy === '__bulk__'}
                style={{ ...btnS, background: '#374151', color: '#FFF', borderColor: '#4B5563' }}
              >
                + Select all visible
              </button>
              <button
                onClick={clearSelection}
                disabled={busy === '__bulk__'}
                style={{ ...btnS, background: 'transparent', color: '#FFF', borderColor: '#4B5563' }}
              >
                × Clear
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: toast.kind === 'success' ? '#D1FAE5' : toast.kind === 'gray' ? '#F4F4F2' : '#FEE2E2',
            color: toast.kind === 'success' ? '#065F46' : toast.kind === 'gray' ? '#625650' : '#991B1B',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1 }}>{toast.msg}</span>
            {/* Undo only shows when there's a reversible action attached AND
                the toast is the success message (not the post-undo confirmation
                which sets kind='gray' and clears lastAction). */}
            {lastAction && toast.kind === 'success' && (
              <button
                onClick={performUndo}
                disabled={undoing}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: '#065F46', color: '#FFF', border: 'none', cursor: undoing ? 'wait' : 'pointer',
                  opacity: undoing ? 0.6 : 1,
                }}
              >
                {undoing ? 'Undoing…' : '↶ Undo'}
              </button>
            )}
            <button onClick={() => { setToast(null); setLastAction(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, padding: 0 }}>×</button>
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#9E9B96', fontSize: 14 }}>
            {unmatchedGroups.length === 0 ? '🎉 Nothing to reconcile — every job is linked or residential.' : 'No matches for this filter.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((g) => (
            <ReconcileRow
              key={g.name}
              group={g}
              companies={companies}
              busy={busy === g.name || busy === '__bulk__'}
              selected={selectedNames.has(g.name)}
              onToggleSelected={() => toggleSelected(g.name)}
              onLinkExisting={(c) => linkToCompany(g, c)}
              onMarkResidential={() => markResidential(g)}
              onCreateNew={(draft) => createAndLink(g, draft)}
            />
          ))}
        </div>
      </div>

      {/* Auto-accept preview modal */}
      {autoPreview && (
        <div
          onClick={() => setAutoPreview(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFF', borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '85vh',
              display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E3E0' }}>
              <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 800 }}>
                ⚡ Auto-accept high-confidence matches
              </div>
              <div style={{ fontSize: 12, color: '#625650', marginTop: 4 }}>
                Review {autoPreview.matches.length} suggested link{autoPreview.matches.length === 1 ? '' : 's'} at ≥80% similarity. Uncheck any false positives, then commit.
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: 12, flex: 1 }}>
              {autoPreview.matches.map((m, idx) => (
                <label
                  key={`${m.group.name}-${m.company.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 4,
                    background: m.accepted ? '#ECFDF5' : '#F9F8F6',
                    border: `1px solid ${m.accepted ? '#86EFAC' : '#E5E3E0'}`,
                    borderRadius: 8, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={m.accepted}
                    onChange={() => toggleAutoMatch(idx)}
                    style={{ cursor: 'pointer', width: 14, height: 14, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{m.group.name}</div>
                    <div style={{ fontSize: 11, color: '#625650', marginTop: 2 }}>
                      → <span style={{ fontWeight: 600 }}>{m.company.name}</span>
                      {m.company.market && <span style={{ marginLeft: 6, color: '#9E9B96' }}>· {m.company.market}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: m.score > 0.9 ? '#065F46' : '#92400E' }}>
                      {Math.round(m.score * 100)}%
                    </div>
                    <div style={{ fontSize: 10, color: '#9E9B96' }}>{m.group.count} job{m.group.count === 1 ? '' : 's'}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E3E0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#625650' }}>
                {autoPreview.matches.filter((m) => m.accepted).length} of {autoPreview.matches.length} will be linked
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setAutoPreview(null)} style={btnS}>Cancel</button>
                <button
                  onClick={commitAutoAccept}
                  disabled={busy === '__bulk__' || autoPreview.matches.filter((m) => m.accepted).length === 0}
                  style={{ ...btnP, opacity: busy === '__bulk__' ? 0.6 : 1 }}
                >
                  {busy === '__bulk__' ? 'Linking…' : `✓ Commit ${autoPreview.matches.filter((m) => m.accepted).length} match${autoPreview.matches.filter((m) => m.accepted).length === 1 ? '' : 'es'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReconcileRow({ group, companies, busy, selected, onToggleSelected, onLinkExisting, onMarkResidential, onCreateNew }) {
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: group.name, market: group.markets.split(',')[0]?.trim() || '' });
  const [showAllCompanies, setShowAllCompanies] = useState(false);

  // Compute fuzzy candidates: top 5 by similarity, threshold 0.3
  const candidates = useMemo(() => {
    return companies
      .map((c) => ({ c, score: similarity(group.name, c.name) }))
      .filter((x) => x.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [companies, group.name]);

  // For "show all" mode, just sort companies alphabetically with a search box
  const [allSearch, setAllSearch] = useState('');
  const filteredAll = useMemo(() => {
    if (!showAllCompanies) return [];
    const q = allSearch.toLowerCase().trim();
    let f = companies;
    if (q) f = f.filter((c) => (c.name || '').toLowerCase().includes(q));
    return f.slice(0, 30);
  }, [companies, allSearch, showAllCompanies]);

  return (
    <div style={{
      border: `1px solid ${selected ? '#8A261D' : '#E5E3E0'}`,
      borderRadius: 10, padding: 14,
      background: selected ? '#FDF4F4' : '#FAFAFA',
      opacity: busy ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: '1 1 300px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelected}
            disabled={busy}
            title="Select for bulk action"
            style={{ marginTop: 3, cursor: busy ? 'wait' : 'pointer', width: 16, height: 16, flexShrink: 0, accentColor: '#8A261D' }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{group.name}</div>
            <div style={{ fontSize: 11, color: '#625650' }}>
              {group.count} job{group.count === 1 ? '' : 's'} · {fmtMoney(group.ncv)} NCV · {group.markets || 'no market'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={onMarkResidential} disabled={busy} style={{ ...btnS, background: '#DBEAFE', color: '#1D4ED8', borderColor: '#93C5FD' }}>
            🏠 Mark Residential
          </button>
          <button onClick={() => setShowCreate((s) => !s)} disabled={busy} style={btnS}>
            {showCreate ? '× Cancel' : '+ Create New'}
          </button>
        </div>
      </div>

      {/* Job list (collapsed if many) */}
      <details style={{ marginBottom: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#625650', fontWeight: 600 }}>
          View {group.count} job{group.count === 1 ? '' : 's'}
        </summary>
        <div style={{ marginTop: 6, padding: 8, background: '#FFF', borderRadius: 6, fontSize: 11 }}>
          {group.jobs.map((j) => (
            <div key={j.id} style={{ padding: '3px 0', color: '#625650' }}>
              <span style={{ fontFamily: 'Inter', fontWeight: 700, color: '#1A1A1A' }}>{j.job_number}</span> · {j.job_name} · {j.market || '—'} · {j.status}
            </div>
          ))}
        </div>
      </details>

      {/* Suggested matches */}
      {candidates.length > 0 && !showCreate && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', marginBottom: 6 }}>
            Suggested matches:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {candidates.map(({ c, score }) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.market && <span style={{ marginLeft: 8, fontSize: 10, color: '#9E9B96' }}>{c.market}</span>}
                  <span style={{ marginLeft: 8, fontSize: 10, color: score > 0.6 ? '#065F46' : '#92400E', fontWeight: 700 }}>{Math.round(score * 100)}%</span>
                </div>
                <button onClick={() => onLinkExisting(c)} disabled={busy} style={btnG}>✓ Link</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show-all-companies fallback */}
      {!showCreate && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowAllCompanies((s) => !s)} disabled={busy} style={{ ...btnS, fontSize: 11 }}>
            {showAllCompanies ? '× Close' : `🔍 Browse all ${companies.length} companies`}
          </button>
          {showAllCompanies && (
            <div style={{ marginTop: 8, padding: 10, background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 6 }}>
              <input
                placeholder="Search…"
                value={allSearch}
                onChange={(e) => setAllSearch(e.target.value)}
                style={{ ...inputS, width: '100%', marginBottom: 6 }}
                autoFocus
              />
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {filteredAll.map((c) => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid #F4F4F2' }}>
                    <span>{c.name} {c.market && <span style={{ fontSize: 10, color: '#9E9B96' }}>· {c.market}</span>}</span>
                    <button onClick={() => onLinkExisting(c)} disabled={busy} style={btnB}>Link</button>
                  </div>
                ))}
                {filteredAll.length === 0 && <div style={{ padding: 8, textAlign: 'center', color: '#9E9B96', fontSize: 11 }}>No matches</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create new company inline form */}
      {showCreate && (
        <div style={{ marginTop: 10, padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 8, textTransform: 'uppercase' }}>+ Create new company</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10, color: '#92400E', marginBottom: 2, fontWeight: 600 }}>Name *</label>
              <input value={createDraft.name} onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))} style={{ ...inputS, width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10, color: '#92400E', marginBottom: 2, fontWeight: 600 }}>Market</label>
              <select value={createDraft.market} onChange={(e) => setCreateDraft((d) => ({ ...d, market: e.target.value }))} style={{ ...inputS, width: '100%' }}>
                <option value="">—</option>
                {['AUS', 'DFW', 'HOU', 'SA', 'CS', 'OOS'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={() => onCreateNew(createDraft)} disabled={busy || !createDraft.name.trim()} style={btnP}>
                Create + Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// COMPANIES & DOCS VIEW (Phase 3a — 2026-04-30)
// ============================================================
// Per-company document library. The DB backend (table, fan-out triggers,
// private Storage bucket) shipped earlier today; this is the UI layer.
// Each card lists the company's linked jobs and uploaded documents, with
// an upload form whose default `auto_attach_to_new_jobs` flag depends on
// document category (legal docs default ON; other / credit_application
// default OFF). The fan-out trigger handles existing-job back-fill.
//
// One-card-open-at-a-time. Multiple-open felt noisy in the prototype and
// blew up scroll position on long lists. Single-open with a quick toggle
// turned out to match how Amiee/Virginia actually work the queue.

const DOC_CATEGORIES = [
  { value: 'tax_exemption_cert', label: 'Tax Exemption Certificate', autoAttachDefault: true },
  { value: 'w9', label: 'W-9', autoAttachDefault: true },
  { value: 'insurance_cert', label: 'Insurance Certificate', autoAttachDefault: true },
  { value: 'master_service_agreement', label: 'Master Service Agreement', autoAttachDefault: true },
  { value: 'nda', label: 'NDA', autoAttachDefault: true },
  { value: 'credit_application', label: 'Credit Application', autoAttachDefault: false },
  { value: 'other', label: 'Other', autoAttachDefault: false },
];
const CATEGORY_LABELS = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.value, c.label]));
const CATEGORY_AUTO_ATTACH = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.value, c.autoAttachDefault]));
const COMPANIES_VIEW_MARKETS = ['SA', 'HOU', 'AUS', 'DFW'];

const SB_URL = 'https://bdnwjokehfxudheshmmj.supabase.co';
const COMPANY_BUCKET = 'company-attachments';

// Encode storage path segment-by-segment so '/' separators stay literal in the
// URL. Same fix as the Documents-tab signing endpoint earlier today — collapsing
// slashes via encodeURIComponent breaks the Storage signing endpoint's lookup.
const encodeStoragePath = (p) => (p || '').split('/').map(encodeURIComponent).join('/');

// Strip characters that have caused Storage upload failures (% mostly, plus the
// usual URL specials). Same character set as App.jsx sanitizeForStorage to keep
// behavior consistent across the codebase.
const sanitizeFilename = (name) => {
  if (!name) return 'file';
  const dotIdx = name.lastIndexOf('.');
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1) : '';
  const cleanStem = stem.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 16);
  return cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return iso; }
};

const fmtBytes = (b) => {
  if (!b || b < 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
};

function CompaniesAndDocsView({ companies, jobs, allCompanyDocs, currentUserEmail, currentUserName, initialFocusCompanyId, onRefresh }) {
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState('all');
  const [showAll, setShowAll] = useState(false); // default: only with linked jobs
  // If we landed via a focus hint (e.g. Customer Concentration row click), the
  // target may live outside the default "with jobs" filter — flip showAll so
  // the card is actually rendered/visible.
  const [expandedId, setExpandedId] = useState(initialFocusCompanyId || null);
  useEffect(() => {
    if (!initialFocusCompanyId) return;
    const target = companies.find((c) => c.id === initialFocusCompanyId);
    if (target && (jobs.filter((j) => j.company_id === target.id).length === 0)) {
      setShowAll(true);
    }
  }, [initialFocusCompanyId, companies, jobs]);

  // Counts derived from already-loaded jobs + allCompanyDocs (one extra round-
  // trip on tab open paid in the parent loadData; expanded cards lazily fetch
  // the full job/doc rows for that one company).
  const jobCountsByCompany = useMemo(() => {
    const m = new Map();
    jobs.forEach((j) => { if (j.company_id) m.set(j.company_id, (m.get(j.company_id) || 0) + 1); });
    return m;
  }, [jobs]);
  const docCountsByCompany = useMemo(() => {
    const m = new Map();
    allCompanyDocs.forEach((d) => { if (d.company_id) m.set(d.company_id, (m.get(d.company_id) || 0) + 1); });
    return m;
  }, [allCompanyDocs]);

  const totalCompanies = companies.length;
  const companiesWithJobs = useMemo(() => companies.filter((c) => (jobCountsByCompany.get(c.id) || 0) > 0).length, [companies, jobCountsByCompany]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let f = companies;
    if (!showAll) f = f.filter((c) => (jobCountsByCompany.get(c.id) || 0) > 0);
    if (marketFilter !== 'all') f = f.filter((c) => c.market === marketFilter);
    if (q) f = f.filter((c) => (c.name || '').toLowerCase().includes(q));
    return f;
  }, [companies, jobCountsByCompany, search, marketFilter, showAll]);

  return (
    <div style={card}>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search companies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputS, flex: '1 1 220px', minWidth: 200 }}
        />
        <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)} style={inputS}>
          <option value="all">All markets</option>
          {COMPANIES_VIEW_MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ display: 'inline-flex', border: '1px solid #E5E3E0', borderRadius: 8, overflow: 'hidden' }}>
          <button
            onClick={() => setShowAll(false)}
            style={{ padding: '7px 12px', border: 'none', background: !showAll ? '#1A1A1A' : '#FFF', color: !showAll ? '#FFF' : '#625650', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
            Only with linked jobs ({companiesWithJobs})
          </button>
          <button
            onClick={() => setShowAll(true)}
            style={{ padding: '7px 12px', border: 'none', borderLeft: '1px solid #E5E3E0', background: showAll ? '#1A1A1A' : '#FFF', color: showAll ? '#FFF' : '#625650', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
            Show all {totalCompanies}
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9E9B96', fontSize: 13 }}>
          {totalCompanies === 0 ? 'No companies in master yet.' : 'No companies match this filter.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((c) => (
          <CompanyCard
            key={c.id}
            company={c}
            jobCount={jobCountsByCompany.get(c.id) || 0}
            docCount={docCountsByCompany.get(c.id) || 0}
            isExpanded={expandedId === c.id}
            onToggle={() => setExpandedId((prev) => (prev === c.id ? null : c.id))}
            currentUserEmail={currentUserEmail}
            currentUserName={currentUserName}
            onCountsChanged={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

function CompanyCard({ company, jobCount, docCount, isExpanded, onToggle, currentUserEmail, currentUserName, onCountsChanged }) {
  const [companyJobs, setCompanyJobs] = useState(null); // null = not loaded
  const [companyDocs, setCompanyDocs] = useState(null);
  const [loadingExpand, setLoadingExpand] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [showAllJobs, setShowAllJobs] = useState(false);

  // Upload form
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadAutoAttachOverride, setUploadAutoAttachOverride] = useState(null); // null = use category default
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const [uploadToast, setUploadToast] = useState(null);
  const fileInputRef = React.useRef(null);

  // Soft-delete confirmation modal
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const effectiveAutoAttach = uploadAutoAttachOverride !== null
    ? uploadAutoAttachOverride
    : (uploadCategory ? CATEGORY_AUTO_ATTACH[uploadCategory] : false);

  const loadDetail = useCallback(async () => {
    setLoadingExpand(true);
    setLoadErr(null);
    try {
      const [jRows, dRows] = await Promise.all([
        sbGet('jobs', `company_id=eq.${company.id}&select=id,job_number,job_name,status&order=job_number.desc`),
        sbGet('company_attachments', `company_id=eq.${company.id}&deleted_at=is.null&select=*&order=uploaded_at.desc`),
      ]);
      setCompanyJobs(Array.isArray(jRows) ? jRows : []);
      setCompanyDocs(Array.isArray(dRows) ? dRows : []);
    } catch (e) {
      console.error('[CompanyCard] expand fetch failed:', e);
      setLoadErr(e.message || 'Failed to load');
    } finally {
      setLoadingExpand(false);
    }
  }, [company.id]);

  useEffect(() => {
    if (isExpanded && companyJobs === null) loadDetail();
  }, [isExpanded, companyJobs, loadDetail]);

  const openSignedUrl = async (doc) => {
    try {
      const encoded = encodeStoragePath(doc.storage_path);
      const res = await fetch(`${SB_URL}/storage/v1/object/sign/${COMPANY_BUCKET}/${encoded}`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ expiresIn: 300 }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sign failed (${res.status}): ${txt.slice(0, 160)}`);
      }
      const data = await res.json();
      const url = `${SB_URL}/storage/v1${data.signedURL || data.signedUrl}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error('[CompanyCard] sign URL failed:', e);
      alert('Could not open file: ' + e.message);
    }
  };

  const onCategoryChange = (val) => {
    setUploadCategory(val);
    // Reset override so the new category's default applies. User can still
    // manually flip the toggle afterwards.
    setUploadAutoAttachOverride(null);
  };

  const doUpload = async () => {
    if (!uploadFile || !uploadCategory) return;
    setUploading(true);
    setUploadErr(null);
    setUploadToast(null);
    try {
      // Storage upload: company_id/category/{timestamp}_{sanitized_filename}
      const cleanName = sanitizeFilename(uploadFile.name);
      const stamp = Date.now();
      const path = `${company.id}/${uploadCategory}/${stamp}_${cleanName}`;
      const putRes = await fetch(`${SB_URL}/storage/v1/object/${COMPANY_BUCKET}/${encodeStoragePath(path)}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': uploadFile.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: uploadFile,
      });
      if (!putRes.ok) {
        const txt = await putRes.text();
        throw new Error(`Storage upload failed (${putRes.status}): ${txt.slice(0, 200)}`);
      }
      const meta = {
        company_id: company.id,
        filename: uploadFile.name,
        storage_path: path,
        mime_type: uploadFile.type || null,
        file_size_bytes: uploadFile.size,
        category: uploadCategory,
        description: uploadDescription ? uploadDescription.slice(0, 500) : null,
        auto_attach_to_new_jobs: !!effectiveAutoAttach,
        uploaded_by_email: currentUserEmail || null,
        uploaded_by_name: currentUserName || null,
      };
      const insRes = await fetch(`${SB_URL}/rest/v1/company_attachments`, {
        method: 'POST',
        headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify(meta),
      });
      if (!insRes.ok) {
        const txt = await insRes.text();
        // Best-effort cleanup of the orphaned Storage object
        try { await fetch(`${SB_URL}/storage/v1/object/${COMPANY_BUCKET}/${encodeStoragePath(path)}`, { method: 'DELETE', headers: H }); } catch (_) {}
        throw new Error(`Database insert failed (${insRes.status}): ${txt.slice(0, 200)}`);
      }
      const inserted = JSON.parse(await insRes.text());
      const newRow = Array.isArray(inserted) ? inserted[0] : inserted;

      // Wait briefly for the AFTER-INSERT fan-out trigger to populate
      // project_attachments (trg_company_attachment_fan_out_ai), then count
      // them so the success toast can tell the user the leverage they got.
      // 500ms is comfortably more than typical Postgres trigger latency. Fan-out
      // count is a nice-to-have; if the query fails we still report success.
      let fanOutCount = null;
      if (newRow && newRow.id && effectiveAutoAttach) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const fanRows = await sbGet('project_attachments', `source_table=eq.company_attachments&source_id=eq.${newRow.id}&select=id`);
          fanOutCount = Array.isArray(fanRows) ? fanRows.length : null;
        } catch (e) { /* best effort */ }
      }

      // Refresh local doc list and parent counts
      await loadDetail();
      onCountsChanged && onCountsChanged();

      // Reset form
      setUploadFile(null);
      setUploadCategory('');
      setUploadDescription('');
      setUploadAutoAttachOverride(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      const msg = fanOutCount !== null
        ? `Uploaded. Auto-attached to ${fanOutCount} existing job${fanOutCount === 1 ? '' : 's'}.`
        : 'Uploaded.';
      setUploadToast({ kind: 'success', msg });
    } catch (e) {
      console.error('[CompanyCard] upload failed:', e);
      setUploadErr(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      const nowIso = new Date().toISOString();
      // 1) Soft-delete the company_attachment row.
      const r1 = await fetch(`${SB_URL}/rest/v1/company_attachments?id=eq.${deleteCandidate.id}`, {
        method: 'PATCH',
        headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ deleted_at: nowIso, deleted_by_email: currentUserEmail || null, deleted_reason: 'user' }),
      });
      if (!r1.ok && r1.status !== 204) {
        const txt = await r1.text();
        throw new Error(`Delete failed (${r1.status}): ${txt.slice(0, 200)}`);
      }
      // 2) Cascade to project_attachments. The DB does not currently ship a
      //    delete-cascade trigger (only the after-insert fan-out exists), so
      //    we explicitly tombstone every project_attachments row that was
      //    created from this company doc. Idempotent: if a future trigger
      //    handles this, the WHERE deleted_at IS NULL clause prevents double-
      //    stamping deleted_at.
      try {
        await fetch(`${SB_URL}/rest/v1/project_attachments?source_table=eq.company_attachments&source_id=eq.${deleteCandidate.id}&deleted_at=is.null`, {
          method: 'PATCH',
          headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ deleted_at: nowIso, deleted_by_email: currentUserEmail || null, deleted_reason: 'cascade_company_attachment' }),
        });
      } catch (e) { console.warn('[CompanyCard] cascade delete soft-failed:', e); }

      await loadDetail();
      onCountsChanged && onCountsChanged();
      setDeleteCandidate(null);
    } catch (e) {
      console.error('[CompanyCard] delete failed:', e);
      alert('Delete failed: ' + (e.message || 'unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ border: '1px solid #E5E3E0', borderRadius: 10, background: isExpanded ? '#FFF' : '#FAFAFA', overflow: 'hidden' }}>
      {/* Collapsed header (always visible) */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A' }}>🏢 {company.name}</span>
            {company.market && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#F4F4F2', color: '#625650' }}>{company.market}</span>
            )}
            {!company.active && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#FEE2E2', color: '#991B1B' }}>INACTIVE</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#625650', marginTop: 3 }}>
            {jobCount} linked job{jobCount === 1 ? '' : 's'} · {docCount} doc{docCount === 1 ? '' : 's'}
          </div>
        </div>
        <span style={{ fontSize: 14, color: '#9E9B96', flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid #F4F4F2' }}>
          {loadingExpand && <div style={{ padding: 16, color: '#9E9B96', fontSize: 12 }}>Loading…</div>}
          {loadErr && <div style={{ padding: 12, color: '#991B1B', fontSize: 12 }}>Error: {loadErr}</div>}

          {!loadingExpand && !loadErr && (
            <>
              {/* Linked jobs section */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', marginBottom: 6 }}>
                  Linked jobs ({companyJobs?.length || 0})
                </div>
                {(!companyJobs || companyJobs.length === 0) ? (
                  <div style={{ fontSize: 12, color: '#9E9B96', fontStyle: 'italic', padding: 6 }}>No linked jobs yet.</div>
                ) : (
                  <div style={{ background: '#F9F8F6', border: '1px solid #E5E3E0', borderRadius: 6, padding: 6 }}>
                    {(showAllJobs ? companyJobs : companyJobs.slice(0, 10)).map((j) => (
                      <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 12, borderBottom: '1px solid #F0EFEB' }}>
                        <span style={{ fontFamily: 'Inter', fontWeight: 700, color: '#1A1A1A', minWidth: 70 }}>{j.job_number || '—'}</span>
                        <span style={{ flex: 1, color: '#625650', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.job_name || '—'}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#9E9B96', textTransform: 'uppercase' }}>{j.status || '—'}</span>
                      </div>
                    ))}
                    {companyJobs.length > 10 && !showAllJobs && (
                      <button onClick={() => setShowAllJobs(true)} style={{ ...btnS, marginTop: 6, fontSize: 11, width: '100%' }}>
                        View all {companyJobs.length}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Documents section */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', marginBottom: 6 }}>
                  Documents ({companyDocs?.length || 0})
                </div>
                {(!companyDocs || companyDocs.length === 0) ? (
                  <div style={{ fontSize: 12, color: '#9E9B96', fontStyle: 'italic', padding: 6 }}>No documents uploaded yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {companyDocs.map((d) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 6, fontSize: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#EDE9FE', color: '#6D28D9', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                          {CATEGORY_LABELS[d.category] || d.category}
                        </span>
                        <span style={{ flex: 1, fontWeight: 600, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.filename}>{d.filename}</span>
                        <span style={{ fontSize: 10, color: '#9E9B96', whiteSpace: 'nowrap' }}>{fmtDate(d.uploaded_at)}</span>
                        <span style={{ fontSize: 10, color: '#9E9B96', whiteSpace: 'nowrap' }} title={d.uploaded_by_email || ''}>{d.uploaded_by_name || d.uploaded_by_email || '—'}</span>
                        {d.auto_attach_to_new_jobs && (
                          <span title="Auto-attaches to all new jobs for this company" style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#D1FAE5', color: '#065F46' }}>✓ AUTO</span>
                        )}
                        <button onClick={() => openSignedUrl(d)} title="View file" style={{ background: 'none', border: '1px solid #E5E3E0', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>🔗 View</button>
                        <button onClick={() => setDeleteCandidate(d)} title="Delete" style={{ background: 'none', border: '1px solid #FCA5A5', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: '#991B1B' }}>🗑</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upload form */}
              <div style={{ marginTop: 16, padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 8, textTransform: 'uppercase' }}>+ Upload company document</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: '#92400E', marginBottom: 2, fontWeight: 600 }}>File (PDF) *</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      style={{ ...inputS, width: '100%', padding: 4 }}
                    />
                    {uploadFile && <div style={{ fontSize: 10, color: '#625650', marginTop: 2 }}>{fmtBytes(uploadFile.size)}</div>}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: '#92400E', marginBottom: 2, fontWeight: 600 }}>Category *</label>
                    <select value={uploadCategory} onChange={(e) => onCategoryChange(e.target.value)} style={{ ...inputS, width: '100%' }}>
                      <option value="">— Pick category —</option>
                      {DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 10, color: '#92400E', marginBottom: 2, fontWeight: 600 }}>Description (optional)</label>
                  <input
                    value={uploadDescription}
                    onChange={(e) => setUploadDescription(e.target.value)}
                    placeholder="e.g. expires 2027-01-01"
                    style={{ ...inputS, width: '100%' }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#92400E', cursor: uploadCategory ? 'pointer' : 'not-allowed', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!effectiveAutoAttach}
                    disabled={!uploadCategory}
                    onChange={(e) => setUploadAutoAttachOverride(e.target.checked)}
                  />
                  <span><b>Auto-attach to new jobs</b> for this company {uploadCategory && <span style={{ color: '#9E9B96' }}>(default {CATEGORY_AUTO_ATTACH[uploadCategory] ? 'on' : 'off'} for {CATEGORY_LABELS[uploadCategory]})</span>}</span>
                </label>
                {uploadErr && (
                  <div style={{ marginBottom: 8, padding: '6px 10px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: 11, color: '#991B1B' }}>{uploadErr}</div>
                )}
                {uploadToast && (
                  <div style={{ marginBottom: 8, padding: '6px 10px', background: '#D1FAE5', border: '1px solid #86EFAC', borderRadius: 6, fontSize: 11, color: '#065F46', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{uploadToast.msg}</span>
                    <button onClick={() => setUploadToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0 }}>×</button>
                  </div>
                )}
                <button
                  onClick={doUpload}
                  disabled={!uploadFile || !uploadCategory || uploading}
                  style={{ ...btnP, opacity: (!uploadFile || !uploadCategory || uploading) ? 0.5 : 1 }}
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteCandidate && (
        <div
          onClick={() => !deleting && setDeleteCandidate(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 12, maxWidth: 480, width: '100%', padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
            <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Delete document?</div>
            <div style={{ fontSize: 13, color: '#625650', lineHeight: 1.5, marginBottom: 14 }}>
              Delete <b>{deleteCandidate.filename}</b>? It will be removed from the company AND from all jobs it was auto-attached to. The file stays recoverable for 30 days.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setDeleteCandidate(null)} disabled={deleting} style={btnS}>Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} style={{ ...btnP, background: '#991B1B', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : '🗑 Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
