// CustomerMasterPage
//
// Phase 1 diagnostic for the customers→jobs link state. Shipped 2026-04-30
// as part of the customer master rollout.
//
// CONTEXT:
//   The OPS app stores customer info in two places:
//     - jobs.customer_name (free-text, every job has one)
//     - companies (master table, 145 rows pre-shipped from CRM era)
//   For years these were unconnected. Phase 1 added jobs.company_id and
//   auto-linked 141 of 296 jobs by exact-string-match-after-normalization.
//
//   This page is a READ-ONLY DIAGNOSTIC for now: it shows where things
//   stand. Full reconciliation UI (drag-drop, fuzzy match, merge dupes,
//   create new company inline) is its own future build.
//
// WHAT YOU SEE:
//   1. Headline counters: total / linked / unlinked / pct linked
//   2. Companies with duplicate names (cleanup target)
//   3. Top unmatched customer_name values (with job count + total NCV)
//   4. Per-market breakdown
//
// WHAT YOU CAN DO HERE:
//   Nothing yet. Read-only. Future: drag unmatched into companies, merge
//   duplicates, create new companies inline.

import React, { useEffect, useMemo, useState } from 'react';
import { sbGet } from '../../shared/sb';

const card = { background: '#FFF', border: '1px solid #E5E3E0', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const stat = { padding: 16, background: '#F9F8F6', border: '1px solid #E5E3E0', borderRadius: 10 };
const statLabel = { fontSize: 10, fontWeight: 700, color: '#625650', textTransform: 'uppercase', letterSpacing: 0.5 };
const statValue = { fontSize: 24, fontWeight: 900, color: '#1A1A1A', fontFamily: 'Inter', marginTop: 4 };

const fmtMoney = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toFixed(0)}`;
};

export default function CustomerMasterPage() {
  const [jobs, setJobs] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        // Pull jobs and companies in parallel. Both small enough to fit in one shot.
        const [jobsData, companiesData] = await Promise.all([
          sbGet('jobs', 'select=id,job_number,job_name,customer_name,market,status,company_id,net_contract_value&order=customer_name.asc'),
          sbGet('companies', 'select=id,name,company_type,market,active&order=name.asc'),
        ]);
        if (cancel) return;
        setJobs(Array.isArray(jobsData) ? jobsData : []);
        setCompanies(Array.isArray(companiesData) ? companiesData : []);
      } catch (e) {
        console.error('[CustomerMaster] fetch failed:', e);
        if (!cancel) setError(e.message || 'Failed to load');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Compute headline stats
  const stats = useMemo(() => {
    const total = jobs.length;
    const linked = jobs.filter((j) => j.company_id).length;
    const unlinked = total - linked;
    const pct = total > 0 ? Math.round((linked / total) * 100) : 0;
    return { total, linked, unlinked, pct };
  }, [jobs]);

  // Find duplicate company names (case-insensitive)
  const duplicateCompanies = useMemo(() => {
    const groups = {};
    companies.forEach((c) => {
      const k = (c.name || '').toLowerCase().trim();
      if (!groups[k]) groups[k] = [];
      groups[k].push(c);
    });
    return Object.entries(groups)
      .filter(([, arr]) => arr.length > 1)
      .map(([k, arr]) => ({ name: arr[0].name, count: arr.length, ids: arr.map((c) => c.id) }))
      .sort((a, b) => b.count - a.count);
  }, [companies]);

  // Top unmatched customer names by job count
  const unmatchedTop = useMemo(() => {
    const groups = {};
    jobs
      .filter((j) => !j.company_id)
      .forEach((j) => {
        const k = j.customer_name || '(blank)';
        if (!groups[k]) groups[k] = { name: k, count: 0, ncv: 0, markets: new Set() };
        groups[k].count++;
        groups[k].ncv += Number(j.net_contract_value) || 0;
        if (j.market) groups[k].markets.add(j.market);
      });
    return Object.values(groups)
      .map((x) => ({ ...x, markets: Array.from(x.markets).sort().join(', ') }))
      .sort((a, b) => b.count - a.count || b.ncv - a.ncv)
      .slice(0, 25);
  }, [jobs]);

  // Per-market link state
  const marketState = useMemo(() => {
    const groups = {};
    jobs.forEach((j) => {
      const m = j.market || '(none)';
      if (!groups[m]) groups[m] = { market: m, total: 0, linked: 0, unlinked: 0, ncvUnlinked: 0 };
      groups[m].total++;
      if (j.company_id) groups[m].linked++;
      else {
        groups[m].unlinked++;
        groups[m].ncvUnlinked += Number(j.net_contract_value) || 0;
      }
    });
    return Object.values(groups).sort((a, b) => b.unlinked - a.unlinked);
  }, [jobs]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9E9B96' }}>
        Loading customer master state…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card, color: '#991B1B' }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Error loading data</div>
        <div style={{ fontSize: 12 }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🏢 Customer Master</h1>
        <div style={{ fontSize: 13, color: '#625650' }}>
          Phase 1 diagnostic. Read-only — full reconciliation tool ships in Phase 2.
        </div>
      </div>

      {/* Headline counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div style={stat}>
          <div style={statLabel}>Total Jobs</div>
          <div style={statValue}>{stats.total}</div>
        </div>
        <div style={{ ...stat, background: '#ECFDF5', borderColor: '#86EFAC' }}>
          <div style={{ ...statLabel, color: '#065F46' }}>Linked to Company</div>
          <div style={{ ...statValue, color: '#065F46' }}>{stats.linked}</div>
        </div>
        <div style={{ ...stat, background: '#FEF3C7', borderColor: '#FCD34D' }}>
          <div style={{ ...statLabel, color: '#92400E' }}>Unlinked</div>
          <div style={{ ...statValue, color: '#92400E' }}>{stats.unlinked}</div>
        </div>
        <div style={stat}>
          <div style={statLabel}>% Linked</div>
          <div style={statValue}>{stats.pct}%</div>
        </div>
      </div>

      {/* Duplicate companies in the master itself */}
      {duplicateCompanies.length > 0 && (
        <div style={card}>
          <div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800, marginBottom: 4, color: '#8A261D' }}>
            ⚠️ Duplicate Companies ({duplicateCompanies.length})
          </div>
          <div style={{ fontSize: 12, color: '#625650', marginBottom: 12 }}>
            These names appear more than once in the companies table. Manual cleanup needed before customer documents can attach reliably.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {duplicateCompanies.map((d) => (
              <div key={d.name} style={{ padding: '8px 12px', background: '#FDF4F4', border: '1px solid #FECACA', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{d.name}</span>
                <span style={{ fontSize: 11, color: '#991B1B', fontWeight: 700 }}>{d.count} duplicate rows</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-market breakdown */}
      <div style={card}>
        <div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
          By Market
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E3E0' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Market</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Total</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Linked</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Unlinked</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>NCV @ Risk</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>% Linked</th>
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
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: m.unlinked > 0 ? '#92400E' : '#9E9B96', fontWeight: 700 }}>{m.unlinked}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: '#625650' }}>{fmtMoney(m.ncvUnlinked)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 700, color: pct >= 80 ? '#065F46' : pct >= 50 ? '#92400E' : '#991B1B' }}>{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Unmatched customer names — top 25 by job count */}
      <div style={card}>
        <div style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
          Top Unmatched Customer Names ({unmatchedTop.length} of {stats.unlinked})
        </div>
        <div style={{ fontSize: 12, color: '#625650', marginBottom: 12 }}>
          These customer_name values on jobs don't exist in the companies table. Highest impact at top. Phase 2 will let you fuzzy-match or create new companies inline.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E3E0' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Customer Name (on jobs)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Jobs</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>NCV</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#625650', fontWeight: 700, textTransform: 'uppercase' }}>Markets</th>
            </tr>
          </thead>
          <tbody>
            {unmatchedTop.map((u, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F4F4F2' }}>
                <td style={{ padding: '8px 10px' }}>
                  {u.name === 'Home Owner' && <span style={{ display: 'inline-block', padding: '2px 6px', background: '#DBEAFE', color: '#1D4ED8', fontSize: 10, fontWeight: 700, borderRadius: 4, marginRight: 6 }}>RESIDENTIAL</span>}
                  <span style={{ fontWeight: 600 }}>{u.name}</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 700 }}>{u.count}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'Inter', color: '#625650' }}>{fmtMoney(u.ncv)}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: '#625650' }}>{u.markets || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: '#9E9B96', textAlign: 'center', padding: 8 }}>
        Phase 1 of customer master rollout · {companies.length} companies in master · {jobs.length} total jobs
      </div>
    </div>
  );
}
