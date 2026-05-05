// AccountingTab — the user-facing surface that replaces Virginia's
// Excel "Acct Sheet". Phase D of the Billing Engine build (2026-05-05).
//
// Layout (top to bottom):
//   1. Contract Summary card (5 money tiles + progress bar)
//   2. Warnings list (when computeAcctSheet emits any)
//   3. Current Bill Draft section
//        — PM submission selector (with "Already billed" badges)
//        — Invoice date + notes inputs
//        — DraftTable (per-line × per-stage breakdown)
//        — File Invoice button
//   4. AppLedger (reverse-chron history + Release Retainage button)
//
// Data flow:
//   - loadAll() fetches everything in parallel on mount + after each
//     successful File / Release.
//   - The compute engine (src/shared/billing/acctSheet.js) is the single
//     source of truth for the draft view; this component wires it up
//     to the DB on the input side and the UI on the output side.
//   - cycleOverrides is local state for non-fence categories' "Bill
//     this cycle" toggles. Cleared on successful File so the next
//     cycle starts fresh.
//
// File flow safety:
//   - Insert header status='draft' → insert lines → flip status='filed'.
//   - The draft→filed trigger posts the row into invoice_entries
//     (Phase A). Lines failure between header insert and status flip
//     leaves an orphan draft App with no invoice_entries side effect.
//   - Phase E will add a "draft Apps" surface for cleanup.

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { sbGet, sbPost, sbPatch } from '../../shared/sb';
import { COLOR, RADIUS, card, btnP, btnS, inputS, FONT } from '../../shared/ui';
import { $, fD } from '../../shared/fmt';
import { computeAcctSheet } from '../../shared/billing/acctSheet';
import ContractSummaryCard from './ContractSummaryCard';
import DraftTable from './DraftTable';
import AppLedger from './AppLedger';
import MarkPaidModal from './MarkPaidModal';
import DrillDownModal from './DrillDownModal';
import LumpSumDraft from './LumpSumDraft';
import UnsupportedMethodNotice from './UnsupportedMethodNotice';

const todayISO = () => new Date().toISOString().slice(0, 10);
const NUM = (x) => Number(x) || 0;

// ─── Banner sub-components (small, kept inline) ─────────────────────
function Banner({ children, tone = 'danger', onClose }) {
  const colors = {
    danger:  { bg: COLOR.dangerBg,  border: COLOR.danger,  color: COLOR.danger },
    warn:    { bg: COLOR.warnBg,    border: COLOR.warn,    color: '#92400E' },
    success: { bg: COLOR.successBg, border: COLOR.success, color: COLOR.success },
  }[tone] || { bg: COLOR.bgSoft, border: COLOR.border, color: COLOR.text2 };
  return (
    <div style={{
      marginBottom: 12,
      padding: '10px 14px',
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: RADIUS.lg,
      color: colors.color,
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1.5,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    }}>
      <div style={{ flex: 1 }}>{children}</div>
      {onClose && (
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'inherit', fontSize: 16, padding: 0, lineHeight: 1,
        }}>×</button>
      )}
    </div>
  );
}

function WarningsList({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <Banner tone="warn">
      <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠ {warnings.length} warning{warnings.length === 1 ? '' : 's'}</div>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {warnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </Banner>
  );
}

// 2026-05-05 (Phase G1): method-aware banner. One row showing which billing
// flow is active for this contract + a brief plain-language description so
// users understand what they're about to do. AIA gets a special note since
// it bills as Progress until Phase G4 adds the G702/G703 PDF format.
const METHOD_META = {
  Progress:    { icon: '📊', name: 'Progress Billing',  desc: 'Bills incrementally per cycle based on PM bill sheet LF × stage weights. Retainage withheld each cycle.' },
  'Lump Sum':  { icon: '💰', name: 'Lump Sum',          desc: 'Bills the full contract value in a single invoice. Retainage applies if set.' },
  Milestone:   { icon: '🎯', name: 'Milestone Billing', desc: 'Bills predefined contract milestones — coming in Phase G2.' },
  'T&M':       { icon: '⏱',  name: 'Time & Material',   desc: 'Bills actual labor + materials per cycle — coming in Phase G3.' },
  AIA:         { icon: '📋', name: 'AIA',               desc: 'Functionally bills as Progress today; G702/G703 PDF format coming in Phase G4.' },
};

function BillingMethodBanner({ method, legacy, legacyValue }) {
  const meta = METHOD_META[method] || METHOD_META.Progress;
  return (
    <div style={{
      marginBottom: 14,
      padding: '10px 14px',
      background: COLOR.page,
      border: `1px solid ${COLOR.border}`,
      borderLeft: `4px solid ${COLOR.brand}`,
      borderRadius: RADIUS.md,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: COLOR.text2,
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>
          Billing Method
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: COLOR.text, marginTop: 2 }}>
          {meta.name}
          {legacy && (
            <span title={`Legacy value "${legacyValue}" treated as Progress until cleaned up`}
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: RADIUS.pill,
                    background: COLOR.warnBg,
                    color: '#92400E',
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}>
              Legacy: {legacyValue}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: COLOR.text2, marginTop: 3, lineHeight: 1.5 }}>
          {meta.desc}
        </div>
      </div>
    </div>
  );
}

// ─── Submission selector ────────────────────────────────────────────
function SubmissionSelector({ pmSubmissions, billedSubmissionIds, value, onChange, disabled }) {
  // Render dropdown + a paragraph showing what's selected. The "Already
  // billed" amber pill appears next to the option label so Virginia
  // sees it before clicking File.
  const selected = pmSubmissions.find(s => s.id === value) || null;
  const alreadyBilled = selected && billedSubmissionIds.has(selected.id);

  return (
    <div>
      <label style={{
        display: 'block', fontSize: 10, color: COLOR.text2,
        fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4,
      }}>Cycle Source</label>
      <select
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...inputS, width: '100%' }}>
        <option value="">— Manual cycle (no PM submission) —</option>
        {pmSubmissions.map(s => {
          const billed = billedSubmissionIds.has(s.id);
          const month = s.billing_month || '—';
          const pm = s.pm || s.submitted_by || '';
          const amt = Number(s.invoiced_amount) > 0 ? `$${Number(s.invoiced_amount).toLocaleString()}` : '';
          return (
            <option key={s.id} value={s.id}>
              {month}{pm ? ` · ${pm}` : ''}{amt ? ` · ${amt}` : ''}{billed ? ' · ⚠ Already billed via Acct Sheet' : ''}
            </option>
          );
        })}
      </select>
      {alreadyBilled && (
        <div style={{
          marginTop: 6,
          padding: '6px 10px',
          background: COLOR.warnBg,
          border: `1px solid ${COLOR.warn}`,
          borderRadius: RADIUS.md,
          fontSize: 11,
          color: '#92400E',
          fontWeight: 600,
        }}>
          ⚠ This PM submission is already linked to a previous Application. Filing again will create a duplicate invoice.
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────
export default function AccountingTab({ job, canEdit, currentUserEmail }) {
  const [loading, setLoading] = useState(true);
  const [pricingLines, setPricingLines] = useState([]);
  const [effectiveWeights, setEffectiveWeights] = useState([]);
  const [priorApps, setPriorApps] = useState([]);
  const [priorAppLines, setPriorAppLines] = useState([]);
  const [pmSubmissions, setPmSubmissions] = useState([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [cycleOverrides, setCycleOverrides] = useState({});
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [appNotes, setAppNotes] = useState('');
  const [filing, setFiling] = useState(false);
  const [releasing, setReleasing] = useState(false);
  // Mark Paid modal — when set, MarkPaidModal renders for that App.
  const [markPaidApp, setMarkPaidApp] = useState(null);
  // Drill-down modal — when set, DrillDownModal renders for that App.
  const [drillApp, setDrillApp] = useState(null);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);

  // ─── Initial load + post-action refresh ──────────────────────────
  const loadAll = useCallback(async () => {
    if (!job?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const [pl, ew, apps, subs] = await Promise.all([
        sbGet('job_pricing_lines',         `job_id=eq.${job.id}&order=line_number.asc`),
        sbGet('v_effective_stage_weights', `job_id=eq.${job.id}&order=category.asc,display_order.asc`),
        sbGet('invoice_applications',      `job_id=eq.${job.id}&order=app_number.desc`),
        sbGet('pm_bill_submissions',       `job_id=eq.${job.id}&order=billing_month.desc&limit=24`),
      ]);
      const appsArr = apps || [];
      setPricingLines(pl || []);
      setEffectiveWeights(ew || []);
      setPriorApps(appsArr);
      setPmSubmissions(subs || []);

      // Pull lines only for filed/paid apps (drafts have nothing relevant yet,
      // and synthetic legacy-import apps have no lines at all).
      const filedIds = appsArr
        .filter(a => a.status === 'filed' || a.status === 'paid')
        .map(a => a.id);
      if (filedIds.length > 0) {
        const lines = await sbGet(
          'invoice_application_lines',
          `invoice_application_id=in.(${filedIds.join(',')})`
        );
        setPriorAppLines(lines || []);
      } else {
        setPriorAppLines([]);
      }
    } catch (e) {
      setErr('Load failed: ' + (e.message || String(e)));
    }
    setLoading(false);
  }, [job?.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── Computed result (memoized) ──────────────────────────────────
  const selectedSubmission = useMemo(
    () => pmSubmissions.find(s => s.id === selectedSubmissionId) || null,
    [pmSubmissions, selectedSubmissionId]
  );

  // Pass the latest retainage_held from the most recent filed/paid app
  // (DB also maintains jobs.retainage_held but the in-tab job prop may
  // be stale; derive locally for accuracy).
  const liveRetainageHeld = useMemo(() => {
    const filed = priorApps.filter(a => a.status === 'filed' || a.status === 'paid');
    if (filed.length === 0) return Number(job?.retainage_held) || 0;
    const latest = filed.reduce((m, a) => (Number(a.app_number) > Number(m.app_number) ? a : m), filed[0]);
    return latest.is_retainage_release ? 0 : Number(latest.retainage_to_date) || 0;
  }, [priorApps, job?.retainage_held]);

  const result = useMemo(() => computeAcctSheet({
    job: { ...job, retainage_held: liveRetainageHeld },
    pricingLines,
    effectiveWeights,
    pmSubmission: selectedSubmission,
    priorAppLines,
    priorApps,
    cycleOverrides,
  }), [job, liveRetainageHeld, pricingLines, effectiveWeights, selectedSubmission, priorAppLines, priorApps, cycleOverrides]);

  // ─── "Already billed" badge data ─────────────────────────────────
  const billedSubmissionIds = useMemo(
    () => new Set(priorApps.filter(a => a.pm_bill_submission_id).map(a => a.pm_bill_submission_id)),
    [priorApps]
  );

  // ─── File Invoice ────────────────────────────────────────────────
  const fileInvoice = async () => {
    if (filing) return;
    setErr(null);

    // Validate
    const overBilling = result.draft.lines.some(c => c.warning === 'over_billing');
    if (overBilling) { setErr('Resolve over-billing warnings before filing.'); return; }
    if (result.draft.totals.current_amount <= 0) { setErr('Draft has $0 to bill — pick a PM submission or toggle a single-stage line.'); return; }

    setFiling(true);
    try {
      // Normalize billing_period from the PM submission's text 'YYYY-MM' (or null for manual).
      let billing_period = null;
      const bm = selectedSubmission?.billing_month;
      if (bm) {
        if (typeof bm === 'string' && /^\d{4}-\d{2}$/.test(bm)) {
          billing_period = bm + '-01';
        } else if (typeof bm === 'string' && /^\d{4}-\d{2}-\d{2}/.test(bm)) {
          billing_period = bm.slice(0, 10);
        }
      }
      // 1. Insert header (status='draft' so post trigger doesn't fire yet)
      const created = await sbPost('invoice_applications', {
        job_id: job.id,
        invoice_date: invoiceDate || todayISO(),
        billing_period,
        pm_bill_submission_id: selectedSubmissionId || null,
        notes: appNotes || null,
      }, { throwOnError: true });
      const app = Array.isArray(created) ? created[0] : created;
      if (!app?.id) throw new Error('No app row returned from insert');

      // 2. Insert lines (filter to non-zero current_qty AND non-zero total).
      //    H2 fix (2026-05-05): without the total !== 0 guard, cells with
      //    missing labor/tax_basis splits would post with cumulative_qty=N
      //    but total=0, then permanently lock that stage out of future
      //    billing. Skipping zero-total cells means the stage stays
      //    available to bill once the pricing row gets fixed.
      const lines = result.draft.lines
        .filter(c => Number(c.current_qty) !== 0 && Number(c.current_total) !== 0)
        .map(c => ({
          invoice_application_id:   app.id,
          job_pricing_line_id:      c.pricing_line_id,
          stage_key:                c.stage_key,
          cumulative_qty:           c.cumulative_qty,
          prior_qty:                c.prior_qty,
          current_qty:              c.current_qty,
          rate_per_unit:            c.rate_per_unit,
          current_labor_amount:     c.current_labor_amount,
          current_tax_basis_amount: c.current_tax_basis_amount,
          current_tax_amount:       c.current_tax_amount,
          current_total:            c.current_total,
        }));
      if (lines.length > 0) {
        await sbPost('invoice_application_lines', lines, { throwOnError: true });
      }

      // 3. Flip draft → filed (triggers Phase A post-to-invoice_entries)
      await sbPatch('invoice_applications', app.id, {
        status: 'filed',
        filed_by: currentUserEmail || 'unknown',
      });

      // 4. Refresh + reset cycle inputs
      await loadAll();
      setSelectedSubmissionId(null);
      setCycleOverrides({});
      setAppNotes('');
      setToast(`App #${app.app_number} filed: ${app.invoice_number || app.id.slice(0, 8)}`);
    } catch (e) {
      setErr('File failed: ' + (e.message || String(e)));
    }
    setFiling(false);
  };

  // ─── Release Retainage ───────────────────────────────────────────
  const releaseRetainage = async () => {
    const held = Number(liveRetainageHeld) || 0;
    if (held <= 0 || releasing) return;
    if (!window.confirm(`Release $${held.toLocaleString()} held retainage as a final invoice?`)) return;

    setReleasing(true);
    setErr(null);
    try {
      const created = await sbPost('invoice_applications', {
        job_id: job.id,
        invoice_date: invoiceDate || todayISO(),
        is_retainage_release: true,
        notes: 'Retainage release',
      }, { throwOnError: true });
      const app = Array.isArray(created) ? created[0] : created;
      if (!app?.id) throw new Error('No app row returned from insert');

      // Header-only — set the totals manually since there are no application
      // lines to drive the compute trigger. The on-file trigger picks up
      // current_amount and posts it to invoice_entries; trg_set_retainage_held
      // zeros jobs.retainage_held because is_retainage_release=true.
      await sbPatch('invoice_applications', app.id, {
        current_amount:    held,
        current_retainage: 0,
        net_due:           held,
        retainage_to_date: 0,
        status:            'filed',
        filed_by:          currentUserEmail || 'unknown',
      });

      await loadAll();
      setToast(`Retainage release filed: $${held.toLocaleString()} (App #${app.app_number})`);
    } catch (e) {
      setErr('Retainage release failed: ' + (e.message || String(e)));
    }
    setReleasing(false);
  };

  // ─── Render ──────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 24, color: COLOR.text3, fontSize: 12 }}>Loading Acct Sheet…</div>;
  }

  // Gate the File Invoice button.
  const overBilling = result.draft.lines.some(c => c.warning === 'over_billing');
  // H3 fix (2026-05-05): also block when pending + billed exceeds contract.
  // The engine surfaces this as a warning too, but we block the button so
  // Virginia can't accidentally over-bill a job (especially the 138 jobs
  // with synthetic legacy-import history where per-stage prior tracking
  // restarts at 0). She can still proceed by lowering the cycle qty or
  // manually adjusting cycleOverrides until the math closes.
  const wouldOverBillContract =
    NUM(result.contract.contract_value) > 0 &&
    (NUM(result.contract.billed_to_date) + NUM(result.draft.totals.current_amount)) >
      NUM(result.contract.contract_value) * 1.001;
  const fileBlocked = !canEdit || overBilling || wouldOverBillContract || result.draft.totals.current_amount <= 0;
  const fileBlockedReason = !canEdit
    ? 'Read-only'
    : overBilling
      ? 'Resolve over-billing warnings first'
      : wouldOverBillContract
        ? 'Pending + Billed exceeds contract value — verify draft first'
        : result.draft.totals.current_amount <= 0
          ? 'No billable activity in this draft'
          : null;

  // 2026-05-05 (Phase G1): method-aware branching. The 5 canonical methods
  // are Progress, Lump Sum, Milestone, T&M, AIA. Anything else (legacy
  // values like 'COMPLETE', 'Procore', 'DUC', or NULL) falls through to
  // Progress — the existing Acct Sheet flow IS the Progress flow.
  const methodRaw = job?.billing_method || null;
  const billingMethod = ['Progress','Lump Sum','Milestone','T&M','AIA'].includes(methodRaw)
    ? methodRaw
    : 'Progress';  // legacy / NULL → Progress (current behavior)
  const methodIsLegacy = methodRaw && billingMethod === 'Progress' && methodRaw !== 'Progress';

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Page title */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: COLOR.text }}>Accounting</div>
        <div style={{ fontSize: 11, color: COLOR.text2, marginTop: 2, lineHeight: 1.5 }}>
          Native Acct Sheet — replaces Virginia's Excel template. Pick a PM submission or set up a manual cycle, review the draft, then File Invoice.
        </div>
      </div>

      {/* 2026-05-05 (Phase G1): method-aware banner. Tells the user which
          billing flow this contract uses; AIA gets a special note since it
          functionally bills as Progress until G4 adds the G702/G703 PDF. */}
      <BillingMethodBanner method={billingMethod} legacy={methodIsLegacy} legacyValue={methodRaw} />

      {err && <Banner tone="danger" onClose={() => setErr(null)}>⚠ {err}</Banner>}
      {toast && <Banner tone="success" onClose={() => setToast(null)}>✓ {toast}</Banner>}

      {/* 1. Contract Summary — always visible regardless of method */}
      <ContractSummaryCard contract={result.contract} retainagePct={job?.retainage_pct} />

      {/* 2. Current Bill Draft — branches by method.
            Progress / AIA / null → existing per-stage Acct Sheet flow
            Lump Sum              → LumpSumDraft (one-click full bill)
            Milestone / T&M       → UnsupportedMethodNotice (Phase G2/G3)
            Engine warnings only render for Progress-style flows. */}
      {(billingMethod === 'Progress' || billingMethod === 'AIA') && (
        <>
          {result.warnings.length > 0 && <WarningsList warnings={result.warnings} />}
          <div style={{ ...card, padding: 16, marginBottom: 16 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 800,
              color: COLOR.text2,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 12,
            }}>
              Current Bill Draft
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 2fr',
              gap: 12,
              marginBottom: 14,
            }}>
              <SubmissionSelector
                pmSubmissions={pmSubmissions}
                billedSubmissionIds={billedSubmissionIds}
                value={selectedSubmissionId}
                onChange={setSelectedSubmissionId}
                disabled={!canEdit}
              />
              <div>
                <label style={{
                  display: 'block', fontSize: 10, color: COLOR.text2,
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4,
                }}>Invoice Date</label>
                <input
                  type="date"
                  value={invoiceDate}
                  disabled={!canEdit}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  style={{ ...inputS, width: '100%' }}
                />
              </div>
              <div>
                <label style={{
                  display: 'block', fontSize: 10, color: COLOR.text2,
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4,
                }}>Notes (optional)</label>
                <input
                  type="text"
                  value={appNotes}
                  disabled={!canEdit}
                  onChange={(e) => setAppNotes(e.target.value)}
                  placeholder="e.g. AIA G702 / customer PO ref"
                  style={{ ...inputS, width: '100%' }}
                />
              </div>
            </div>

            <DraftTable
              draftLines={result.draft.lines}
              draftTotals={result.draft.totals}
              pricingLines={pricingLines}
              cycleOverrides={cycleOverrides}
              setCycleOverrides={setCycleOverrides}
              canEdit={canEdit}
            />

            {/* Action row */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 12,
              marginTop: 12,
              flexWrap: 'wrap',
            }}>
              {fileBlockedReason && (
                <span style={{ fontSize: 11, color: COLOR.text3, fontStyle: 'italic' }}>
                  {fileBlockedReason}
                </span>
              )}
              <button
                onClick={fileInvoice}
                disabled={fileBlocked || filing}
                title={fileBlockedReason || 'File this draft as an invoice'}
                style={{
                  ...btnP,
                  padding: '10px 18px',
                  fontSize: 13,
                  opacity: fileBlocked || filing ? 0.5 : 1,
                  cursor: fileBlocked || filing ? 'not-allowed' : 'pointer',
                }}>
                {filing ? 'Filing…' : `📋 File Invoice (${$(result.draft.totals.current_amount)})`}
              </button>
            </div>
          </div>
        </>
      )}

      {billingMethod === 'Lump Sum' && (
        <LumpSumDraft
          job={job}
          contract={result.contract}
          ledger={result.ledger}
          canEdit={canEdit}
          currentUserEmail={currentUserEmail}
          onSuccess={async (msg) => {
            await loadAll();
            setToast(msg);
          }}
        />
      )}

      {(billingMethod === 'Milestone' || billingMethod === 'T&M') && (
        <UnsupportedMethodNotice method={billingMethod} />
      )}

      {/* 3. App Ledger + Retainage Release */}
      <AppLedger
        ledger={result.ledger}
        retainageHeld={liveRetainageHeld}
        releasing={releasing}
        onReleaseRetainage={releaseRetainage}
        onMarkPaid={(app) => setMarkPaidApp(app)}
        onRowClick={(app) => setDrillApp(app)}
        canEdit={canEdit}
      />

      {/* Mark Paid modal — only mounts when an App row is selected via the
          AppLedger's "Mark Paid" button. On success the trg_apply_payment_to_application
          trigger flips status='paid' (or keeps 'filed' for partial), and we
          refresh the whole tab so summary tiles + ledger update. */}
      {markPaidApp && (
        <MarkPaidModal
          app={markPaidApp}
          currentUserEmail={currentUserEmail}
          onClose={() => setMarkPaidApp(null)}
          onSuccess={async (msg) => {
            setMarkPaidApp(null);
            await loadAll();
            setToast(msg);
          }}
        />
      )}

      {/* Drill-down modal — opens on App ledger row click. Quick actions
          inside (Mark Paid) emit via onAction; we route to the existing
          MarkPaidModal so flows stay consolidated. Drill-down doesn't
          self-mutate — refresh happens through the action handler. */}
      {drillApp && (
        <DrillDownModal
          title={`App #${drillApp.app_number} — ${drillApp.invoice_number || drillApp.id.slice(0, 8)}`}
          subtitle={drillApp.billing_period
            ? `Cycle ${new Date(drillApp.billing_period + 'T12:00:00').toLocaleDateString('en-US', {month: 'short', year: 'numeric'})}`
            : null}
          entityType="invoice"
          entityId={drillApp.id}
          onClose={() => setDrillApp(null)}
          onAction={(action) => {
            if (action === 'mark_paid') {
              // Hand off to the existing Mark Paid flow; close the drill-down.
              const app = drillApp;
              setDrillApp(null);
              setMarkPaidApp(app);
            }
          }}
        />
      )}
    </div>
  );
}
