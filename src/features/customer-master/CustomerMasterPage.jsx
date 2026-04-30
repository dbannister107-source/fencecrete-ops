// CustomerMasterPage
//
// Phase 2.1 (2026-04-30): added Undo button on the success toast. Reverses
// link / mark-residential / create-and-link actions. In-memory only (refresh
// or navigate away wipes it). create-and-link undo deletes the new company
// only if no other jobs reference it.
//
// Phase 2 (2026-04-30): added Reconcile tab — match unmatched jobs to
// existing companies via fuzzy suggestions, create new companies inline,
// or mark as residential.
//
// Phase 1 (2026-04-30): Diagnostic tab. Read-only counters + duplicate
// finder + per-market breakdown + top unmatched list.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sbGet } from '../../shared/sb';

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

export default function CustomerMasterPage() {
  const [tab, setTab] = useState('diagnostic'); // 'diagnostic' | 'reconcile'
  const [jobs, setJobs] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [jobsData, companiesData] = await Promise.all([
        sbGet('jobs', 'select=id,job_number,job_name,customer_name,market,status,company_id,is_residential,net_contract_value&order=customer_name.asc'),
        sbGet('companies', 'select=id,name,company_type,market,active,address,city,state&order=name.asc'),
      ]);
      setJobs(Array.isArray(jobsData) ? jobsData : []);
      setCompanies(Array.isArray(companiesData) ? companiesData : []);
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
              : `Reconcile ${unmatchedGroups.length} unmatched customer name${unmatchedGroups.length === 1 ? '' : 's'} (${stats.unmatched} job${stats.unmatched === 1 ? '' : 's'}).`}
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

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
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
        </div>

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
              busy={busy === g.name}
              onLinkExisting={(c) => linkToCompany(g, c)}
              onMarkResidential={() => markResidential(g)}
              onCreateNew={(draft) => createAndLink(g, draft)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ReconcileRow({ group, companies, busy, onLinkExisting, onMarkResidential, onCreateNew }) {
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
    <div style={{ border: '1px solid #E5E3E0', borderRadius: 10, padding: 14, background: '#FAFAFA', opacity: busy ? 0.6 : 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{group.name}</div>
          <div style={{ fontSize: 11, color: '#625650' }}>
            {group.count} job{group.count === 1 ? '' : 's'} · {fmtMoney(group.ncv)} NCV · {group.markets || 'no market'}
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
