// UnsupportedMethodNotice — clear placeholder for billing methods whose
// dedicated UI hasn't shipped yet (Phase G2 = Milestone, G3 = T&M).
//
// AIA does NOT use this — it functionally bills as Progress; Phase G4
// just adds the AIA G702/G703 PDF format. AIA gets an inline info banner
// in AccountingTab instead, so the user still sees the full Progress flow.
//
// What this component shows:
//   - Method name + brief explainer
//   - "Coming in Phase Gx" badge
//   - Concrete workaround: switch to Progress on Contract tab if billing now
//   - The App Ledger continues to render below this notice so users can
//     still see history.

import React from 'react';
import { COLOR, RADIUS, card } from '../../shared/ui';

const METHOD_INFO = {
  Milestone: {
    phase: 'G2',
    icon: '🎯',
    headline: 'Milestone Billing',
    coming: 'Coming in Phase G2',
    explainer: 'Bill predefined contract milestones (e.g. 10% deposit / 30% material delivery / 40% installation start / 20% completion). Each milestone has a fixed % or amount and gets invoiced when its trigger condition is met.',
    needs: [
      'Milestone schedule definition on the Contract tab',
      'Per-milestone status: pending → billed → paid',
      'Milestone-billing draft view (pick a milestone, bill it)',
    ],
    workaround: 'To bill this contract now, switch its Billing Method to Progress on the Contract tab. The full per-stage Acct Sheet flow will become available.',
  },
  'T&M': {
    phase: 'G3',
    icon: '⏱',
    headline: 'Time & Material Billing',
    coming: 'Coming in Phase G3',
    explainer: 'Bill actual labor hours × rate plus actual materials × markup. Each cycle aggregates the labor + material entries logged for the job during the billing period.',
    needs: [
      'Labor entry surface (date, employee, hours, rate)',
      'Material entry surface (date, vendor, item, qty, cost, markup)',
      'T&M-aware draft view that aggregates by cycle',
    ],
    workaround: 'For T&M-style projects today, switch the method to Progress on the Contract tab and bill via the standard Acct Sheet flow with manual line items reflecting the labor/materials.',
  },
};

export default function UnsupportedMethodNotice({ method }) {
  const info = METHOD_INFO[method];
  if (!info) {
    return (
      <div style={{ ...card, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: COLOR.text2 }}>
          Billing method <code>{method}</code> not yet supported. Switch to Progress on the Contract tab to bill this job.
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      {/* Header banner */}
      <div style={{
        padding: '14px 18px',
        background: COLOR.warnBg,
        borderBottom: `1px solid ${COLOR.warn}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{ fontSize: 28, flexShrink: 0 }}>🚧</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: '#92400E',
            display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          }}>
            <span>{info.icon} {info.headline}</span>
            <span style={{
              padding: '2px 8px',
              background: '#FFF',
              border: `1px solid ${COLOR.warn}`,
              borderRadius: RADIUS.pill,
              fontSize: 10,
              fontWeight: 700,
              color: '#92400E',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              whiteSpace: 'nowrap',
            }}>{info.coming}</span>
          </div>
          <div style={{ fontSize: 12, color: '#92400E', marginTop: 4, lineHeight: 1.5 }}>
            {info.explainer}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 18 }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: COLOR.text2,
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
        }}>What's coming</div>
        <ul style={{
          margin: 0, paddingLeft: 20, fontSize: 12, color: COLOR.text, lineHeight: 1.7,
        }}>
          {info.needs.map((n, i) => <li key={i}>{n}</li>)}
        </ul>

        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          background: COLOR.page,
          border: `1px solid ${COLOR.border}`,
          borderRadius: RADIUS.md,
          fontSize: 12,
          color: COLOR.text2,
          lineHeight: 1.5,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: COLOR.info,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
          }}>Workaround</div>
          {info.workaround}
        </div>
      </div>
    </div>
  );
}
