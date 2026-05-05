// ContractSummaryCard — top of the Accounting tab. Five money tiles +
// a progress bar showing where the contract stands. Read-only.
//
// Reads the `contract` slice of computeAcctSheet's output. The `pending`
// tile reflects the in-flight draft (if any); when no draft is open, it
// shows $0 and the progress bar visualizes only billed-to-date.

import React from 'react';
import { COLOR, RADIUS, card, FONT } from '../../shared/ui';
import { $ } from '../../shared/fmt';

function Tile({ label, value, accent = 'text', sub }) {
  // Accent color picks the value text shade.
  const accentColor = {
    text:    COLOR.text,
    info:    COLOR.info,
    warn:    COLOR.warn,
    success: COLOR.success,
    danger:  COLOR.danger,
  }[accent] || COLOR.text;

  return (
    <div style={{
      padding: 14,
      background: COLOR.page,
      border: `1px solid ${COLOR.border}`,
      borderRadius: RADIUS.lg,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 800,
        color: COLOR.text2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: 18,
        fontWeight: 900,
        fontFamily: FONT.data,
        color: accentColor,
        lineHeight: 1.2,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: COLOR.text3, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct }) {
  // Clamp display to [0, 100] for the visual; surface the real value as text.
  const display = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 6,
        fontSize: 10,
        fontWeight: 800,
        color: COLOR.text2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        <span>Progress</span>
        <span>{(Number(pct) || 0).toFixed(1)}%</span>
      </div>
      <div style={{
        height: 8,
        background: COLOR.bgSoft,
        borderRadius: RADIUS.pill,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${display}%`,
          height: '100%',
          background: display >= 95 ? COLOR.success : COLOR.brand,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  );
}

export default function ContractSummaryCard({ contract, retainagePct }) {
  if (!contract) return null;
  const retainageLabel = `Retainage @ ${Number(retainagePct) || 0}%`;
  return (
    <div style={{ ...card, padding: 16, marginBottom: 16 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        color: COLOR.text2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
      }}>
        Contract Summary
      </div>
      {/* 2026-05-05 (mobile pass): auto-fit grid replaces the fixed 5-column
          layout. Tiles auto-stack to 1-3 columns on phones / tablets and
          fan out to 5 across on wide screens. Was L1 in the post-Phase-D
          mobile audit (5-tile grid squished to ~70px wide on iPhone). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Tile label="Contract"       value={$(contract.contract_value)}  accent="text" />
        <Tile label="Billed To Date" value={$(contract.billed_to_date)}  accent="text" />
        <Tile label="Pending"        value={$(contract.pending_amount)}  accent="info"
              sub={contract.pending_amount > 0 ? 'this draft' : null} />
        <Tile label="Balance"        value={$(contract.balance_to_bill)} accent="text" />
        <Tile label={retainageLabel} value={$(contract.retainage_held)}  accent="warn"
              sub={contract.retainage_held > 0 ? 'currently held' : null} />
      </div>
      <ProgressBar pct={contract.pct_complete} />
    </div>
  );
}
