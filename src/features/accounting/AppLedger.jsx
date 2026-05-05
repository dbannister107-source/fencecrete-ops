// AppLedger — reverse-chron table of every Application on this job
// (synthetic legacy imports + post-cutover real Apps). Display-only in
// Phase D; clicking a row to expand stage detail is deferred to Phase E.
//
// Houses the "Release Retainage" button — only visible when
// jobs.retainage_held > 0 AND the user has edit permission. One-click
// + native confirm dialog (decision #3 from the Phase D planning round
// on 2026-05-05). Mechanical and fast is what Virginia wants.

import React from 'react';
import { COLOR, RADIUS, card, btnP, FONT } from '../../shared/ui';
import { $, fD } from '../../shared/fmt';

const STATUS_COLORS = {
  draft:  { bg: COLOR.bgSoft,    color: COLOR.text2,   label: 'Draft' },
  filed:  { bg: COLOR.infoBg,    color: COLOR.info,    label: 'Filed' },
  paid:   { bg: COLOR.successBg, color: COLOR.success, label: 'Paid' },
  void:   { bg: COLOR.dangerBg,  color: COLOR.danger,  label: 'Void' },
};

function StatusPill({ status }) {
  const s = STATUS_COLORS[status] || { bg: COLOR.bgSoft, color: COLOR.text2, label: status || '—' };
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: RADIUS.pill,
      fontSize: 10,
      fontWeight: 700,
      background: s.bg,
      color: s.color,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    }}>{s.label}</span>
  );
}

function Pill({ text, tone = 'warn' }) {
  const colors = {
    warn:    { bg: COLOR.warnBg,    color: COLOR.warn },
    info:    { bg: COLOR.infoBg,    color: COLOR.info },
    success: { bg: COLOR.successBg, color: COLOR.success },
  }[tone] || { bg: COLOR.bgSoft, color: COLOR.text2 };

  return (
    <span style={{
      marginLeft: 6,
      padding: '1px 6px',
      borderRadius: RADIUS.pill,
      fontSize: 9,
      fontWeight: 700,
      background: colors.bg,
      color: colors.color,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    }}>{text}</span>
  );
}

export default function AppLedger({
  ledger = [],
  retainageHeld = 0,
  releasing = false,
  onReleaseRetainage,
  canEdit = false,
}) {
  const showReleaseBtn = canEdit && Number(retainageHeld) > 0;

  return (
    <div style={{ ...card, padding: 16, marginTop: 16 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 800,
            color: COLOR.text2,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            Application Ledger
          </div>
          <div style={{ fontSize: 11, color: COLOR.text3, marginTop: 2 }}>
            {ledger.length === 0
              ? 'No applications filed yet.'
              : `${ledger.length} application${ledger.length === 1 ? '' : 's'} on file.`}
          </div>
        </div>
        {showReleaseBtn && (
          <button
            onClick={onReleaseRetainage}
            disabled={releasing}
            title="Files a final invoice for the held retainage and zeroes the balance"
            style={{
              ...btnP,
              padding: '8px 14px',
              fontSize: 12,
              opacity: releasing ? 0.5 : 1,
              cursor: releasing ? 'wait' : 'pointer',
            }}>
            {releasing ? 'Releasing…' : `↳ Release Retainage (${$(retainageHeld)})`}
          </button>
        )}
      </div>

      {ledger.length === 0 ? (
        <div style={{
          padding: 24,
          textAlign: 'center',
          color: COLOR.text3,
          fontSize: 12,
          fontStyle: 'italic',
          background: COLOR.page,
          borderRadius: RADIUS.lg,
          border: `1px dashed ${COLOR.border}`,
        }}>
          File the first invoice using the Current Bill Draft above.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: COLOR.page, borderBottom: `1px solid ${COLOR.border}` }}>
                {['App #', 'Invoice #', 'Date', 'Period', 'Amount', 'Retainage', 'Net Due', 'Status'].map((h, i) => (
                  <th key={i} style={{
                    padding: '8px 10px',
                    textAlign: i >= 4 && i <= 6 ? 'right' : 'left',
                    fontSize: 10,
                    fontWeight: 700,
                    color: COLOR.text2,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledger.map(a => (
                <tr key={a.id} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                  <td style={{ padding: '8px 10px', fontFamily: FONT.data, fontWeight: 700 }}>
                    #{a.app_number}
                    {a.is_retainage_release && <Pill text="Retainage Release" tone="warn" />}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: FONT.data, fontSize: 11 }}>
                    {a.invoice_number || '—'}
                    {a.is_legacy_import && <Pill text="Legacy Import" tone="info" />}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 11 }}>{fD(a.invoice_date)}</td>
                  <td style={{ padding: '8px 10px', fontSize: 11 }}>{fD(a.billing_period)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700 }}>
                    {$(a.current_amount)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: FONT.data, color: COLOR.warn }}>
                    {a.current_retainage > 0 ? $(a.current_retainage) : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700, color: COLOR.success }}>
                    {$(a.net_due)}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <StatusPill status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
