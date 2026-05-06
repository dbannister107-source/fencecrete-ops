// LumpSumDraft — Bill Full Lump Sum panel for billing_method='Lump Sum' contracts.
//
// Replaces the per-stage DraftTable when the contract is on Lump Sum.
// One-click action that creates a single invoice_application for the
// FULL contract value, with retainage withheld at jobs.retainage_pct.
//
// Behavior:
//   - "Bill Full Lump Sum" button is disabled when no contract value
//     is set or when an existing filed/paid App on this job already
//     accounts for the full contract amount (prevents double-billing).
//   - The App is header-only (no invoice_application_lines, like a
//     retainage release). current_amount, current_retainage, net_due
//     are set explicitly via PATCH after the initial INSERT — same
//     pattern as Release Retainage.
//   - Status flow: insert as 'draft', then PATCH to 'filed' so the
//     existing trg_post_to_invoice_entries_on_file trigger fires
//     and posts to invoice_entries (which cascades to ytd_invoiced).

import React, { useState, useEffect } from 'react';
import { sbPost, sbPatch } from '../../shared/sb';
import { COLOR, RADIUS, card, btnP, btnS, FONT, inputS } from '../../shared/ui';
import { $, fD } from '../../shared/fmt';

const todayISO = () => new Date().toISOString().slice(0, 10);
const NUM = (x) => Number(x) || 0;

// 2026-05-05 (mobile pass 2): inline mobile detection. Same 768px breakpoint
// as the other accounting feature files; keeps the component self-contained
// without an import dance.
function useIsMobile(bp = 768) {
  const [m, setM] = useState(typeof window !== 'undefined' ? window.innerWidth < bp : false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const fn = () => setM(window.innerWidth < bp);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, [bp]);
  return m;
}

export default function LumpSumDraft({
  job,
  contract,           // result.contract from computeAcctSheet
  ledger,             // result.ledger
  canEdit,
  currentUserEmail,
  onSuccess,          // (msg) => void — parent runs loadAll() + setToast
}) {
  const isMobile = useIsMobile();
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [notes, setNotes]             = useState('');
  const [filing, setFiling]           = useState(false);
  const [err, setErr]                 = useState(null);

  const contractValue = NUM(contract.contract_value);
  const billedToDate  = NUM(contract.billed_to_date);
  const retainagePct  = NUM(job?.retainage_pct);
  const remaining     = Math.max(0, contractValue - billedToDate);

  // Block when contract is fully billed already (sum of filed/paid >= contract).
  // Allow billing the remainder if some has been billed (e.g. partial Lump Sum
  // schedules where Virginia bills in two halves).
  const fullyBilled = contractValue > 0 && billedToDate >= contractValue * 0.999;

  const billAmount        = remaining;
  const retainageWithheld = Math.round(billAmount * retainagePct) / 100;
  const netDue            = billAmount - retainageWithheld;

  // Existing apps lookup — show the user what's already on file.
  const filedApps = (ledger || []).filter(a => a.status === 'filed' || a.status === 'paid');

  async function billLumpSum() {
    if (filing) return;
    setErr(null);

    if (contractValue <= 0) {
      setErr('Contract value is $0 — set up Pricing Book + Line Items on the Contract / Scope tabs first.');
      return;
    }
    if (billAmount <= 0) {
      setErr('Nothing to bill — contract is already fully billed.');
      return;
    }
    if (!window.confirm(
      `Bill the full lump-sum amount?\n\n` +
      `Amount:    ${$(billAmount)}\n` +
      `Retainage: ${$(retainageWithheld)} (${retainagePct}%)\n` +
      `Net Due:   ${$(netDue)}\n\n` +
      `This creates a single Application for the full contract value (header-only, no per-stage breakdown).`
    )) return;

    setFiling(true);
    try {
      // 1. Insert header at status='draft' so post-on-file trigger doesn't fire yet.
      const created = await sbPost('invoice_applications', {
        job_id: job.id,
        invoice_date: invoiceDate || todayISO(),
        billing_period: invoiceDate || todayISO(),
        notes: notes || 'Lump Sum billing',
      }, { throwOnError: true });
      const app = Array.isArray(created) ? created[0] : created;
      if (!app?.id) throw new Error('No app row returned from insert');

      // 2. Set the totals manually (no app_lines for Lump Sum — same pattern
      //    as Release Retainage). The compute-totals trigger fires only on
      //    app_lines writes; without lines, the values we PATCH stay.
      // 3. Flip status='filed' in the SAME PATCH so the post-on-file trigger
      //    sees the new totals when it inserts into invoice_entries.
      await sbPatch('invoice_applications', app.id, {
        current_amount:    billAmount,
        current_retainage: retainageWithheld,
        net_due:           netDue,
        billed_to_date:    billedToDate,
        retainage_to_date: NUM(contract.retainage_held) + retainageWithheld,
        status:            'filed',
        filed_by:          currentUserEmail || 'unknown',
      });

      onSuccess(`Lump Sum filed: ${$(billAmount)} (App #${app.app_number})`);
    } catch (e) {
      setErr('Lump Sum billing failed: ' + (e.message || String(e)));
      setFiling(false);
    }
  }

  return (
    <div style={{ ...card, padding: 16, marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: COLOR.text2,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12,
      }}>
        Current Bill Draft — Lump Sum
      </div>

      {err && (
        <div style={{
          padding: '8px 12px', marginBottom: 12,
          background: COLOR.dangerBg, color: COLOR.danger,
          border: `1px solid ${COLOR.danger}`,
          borderRadius: RADIUS.md, fontSize: 12, fontWeight: 600,
        }}>⚠ {err}</div>
      )}

      {fullyBilled ? (
        <div style={{
          padding: '14px 16px',
          background: COLOR.successBg,
          border: `1px solid ${COLOR.success}`,
          borderRadius: RADIUS.lg,
          color: COLOR.success,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.5,
        }}>
          ✓ Fully billed. The contract value of {$(contractValue)} has been invoiced across {filedApps.length} App{filedApps.length === 1 ? '' : 's'}.
          {retainagePct > 0 && Number(contract.retainage_held) > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: COLOR.text2, fontWeight: 500 }}>
              Retainage held: {$(contract.retainage_held)}. Use the App Ledger's <b>↳ Release Retainage</b> button when the contract closes.
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Money preview */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
            marginBottom: 14,
          }}>
            <Stat label="Contract Value"    value={$(contractValue)} />
            <Stat label="Already Billed"    value={$(billedToDate)} muted={billedToDate === 0} />
            <Stat label={`Bill This Lump Sum`} value={$(billAmount)} accent="brand" />
            <Stat label={`Retainage @ ${retainagePct}%`} value={$(retainageWithheld)} accent="warn" />
            <Stat label="Net Due" value={$(netDue)} accent="success" />
          </div>

          {/* Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lblStyle}>Invoice Date</label>
              <input type="date" value={invoiceDate} disabled={!canEdit}
                     onChange={(e) => setInvoiceDate(e.target.value)}
                     style={{ ...inputS, width: '100%' }} />
            </div>
            <div>
              <label style={lblStyle}>Notes (optional)</label>
              <input type="text" value={notes} disabled={!canEdit}
                     onChange={(e) => setNotes(e.target.value)}
                     placeholder="e.g. AIA G702 / customer PO ref"
                     style={{ ...inputS, width: '100%' }} />
            </div>
          </div>

          {/* Bill button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            {!canEdit && (
              <span style={{ fontSize: 11, color: COLOR.text3, fontStyle: 'italic' }}>
                Read-only — needs edit permission
              </span>
            )}
            {canEdit && billedToDate > 0 && (
              <span style={{ fontSize: 11, color: COLOR.warn, fontStyle: 'italic' }}>
                ⚠ Partial Lump Sum — {$(billedToDate)} previously billed; this fills the remainder.
              </span>
            )}
            <button
              onClick={billLumpSum}
              disabled={!canEdit || filing || billAmount <= 0}
              title={
                !canEdit ? 'Read-only' :
                billAmount <= 0 ? 'Nothing to bill' :
                'Create a single App for the full contract value'
              }
              style={{
                ...btnP,
                // 2026-05-05 (mobile pass 2): meet iOS HIG 44px touch target.
                // Desktop keeps the original padding + font size.
                padding: isMobile ? '14px 22px' : '12px 24px',
                fontSize: isMobile ? 14 : 13,
                minHeight: isMobile ? 44 : undefined,
                opacity: (!canEdit || filing || billAmount <= 0) ? 0.5 : 1,
                cursor: (!canEdit || filing || billAmount <= 0) ? 'not-allowed' : 'pointer',
              }}>
              {filing ? 'Filing…' : `📋 Bill Full Lump Sum (${$(billAmount)})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Small stat tile — mirrors the look of the ContractSummaryCard tiles.
function Stat({ label, value, accent = 'text', muted }) {
  const colors = {
    text:    COLOR.text,
    brand:   COLOR.brand,
    success: COLOR.success,
    warn:    COLOR.warn,
  };
  return (
    <div style={{
      padding: 10,
      background: COLOR.page,
      border: `1px solid ${COLOR.border}`,
      borderRadius: RADIUS.lg,
      opacity: muted ? 0.5 : 1,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 800, color: COLOR.text2,
        textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 14, fontWeight: 900, fontFamily: FONT.data,
        color: colors[accent] || COLOR.text,
      }}>{value}</div>
    </div>
  );
}

const lblStyle = {
  display: 'block',
  fontSize: 10, fontWeight: 700, color: COLOR.text2,
  textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4,
};
