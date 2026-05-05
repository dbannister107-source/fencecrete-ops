// DraftTable — the per-pricing-line × per-stage breakdown for the
// current bill draft. Mirrors the Excel "Current Billing" columns but
// flatter — we don't render the Previous|Current side-by-side because
// our data model already separates prior_qty from current_qty.
//
// Multi-stage categories (precast, sw):
//   Read-only display of cumulative/prior/current quantities. The PM bill
//   sheet drives these via apportionment in the calc engine. Adjusting
//   means going to the PM bill sheet, not here.
//
// Single-stage categories (wi_gate, option, permit, bond, other):
//   Editable. Default UX = a "Bill this cycle" checkbox that toggles
//   cumulative_qty between 0 and the line's full contract qty. Power
//   users can click the qty field and type a partial number.
//   Mutations write to cycleOverrides[pricing_line_id][stage_key].
//
// Over-billing warnings: red border on the cell + a ⚠ marker. The File
// Invoice button is disabled by AccountingTab when any cell has the
// 'over_billing' warning.

import React, { useState } from 'react';
import { COLOR, RADIUS, FONT, inputS } from '../../shared/ui';
import { $ } from '../../shared/fmt';

const MULTI_STAGE_CATEGORIES = new Set(['precast', 'sw']);

const CATEGORY_LABELS = {
  precast: 'Precast',
  sw:      'Single Wythe',
  wi_gate: 'WI Gate',
  option:  'Option',
  permit:  'Permit',
  bond:    'Bond',
  other:   'Other',
};

// ─── Inline qty editor for single-stage cells ─────────────────────────
function QtyCell({ value, max, onChange, disabled, warning }) {
  const [editing, setEditing] = useState(false);
  const num = Number(value) || 0;
  const cap = Number(max) || 0;
  const isFull = cap > 0 && num >= cap * 0.999;
  const isZero = num <= 0.001;

  if (editing && !disabled) {
    return (
      <input
        type="number"
        autoFocus
        min="0"
        step="0.01"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
        }}
        style={{
          ...inputS,
          width: 80,
          padding: '4px 6px',
          fontSize: 11,
          fontFamily: FONT.data,
          fontWeight: 700,
          border: warning ? `1px solid ${COLOR.danger}` : `1px solid ${COLOR.border}`,
        }}
      />
    );
  }
  return (
    <div
      onClick={() => !disabled && setEditing(true)}
      title={disabled ? 'Read-only' : 'Click to edit'}
      style={{
        cursor: disabled ? 'default' : 'text',
        padding: '4px 8px',
        minWidth: 60,
        textAlign: 'right',
        fontFamily: FONT.data,
        fontWeight: 700,
        color: warning ? COLOR.danger : isZero ? COLOR.text3 : COLOR.text,
        background: warning ? COLOR.dangerBg : 'transparent',
        border: warning ? `1px solid ${COLOR.danger}` : '1px solid transparent',
        borderRadius: RADIUS.sm,
      }}>
      {warning && <span style={{ marginRight: 4, fontSize: 10 }}>⚠</span>}
      {num.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      {isFull && !warning && <span style={{ marginLeft: 4, fontSize: 9, color: COLOR.success, fontWeight: 700 }}>FULL</span>}
    </div>
  );
}

// ─── Single component ────────────────────────────────────────────────
export default function DraftTable({
  draftLines = [],
  draftTotals,
  pricingLines = [],
  cycleOverrides = {},
  setCycleOverrides,
  canEdit = false,
}) {
  // Group draft cells by pricing line for sectioned rendering.
  const cellsByLine = {};
  draftLines.forEach((c) => {
    if (!cellsByLine[c.pricing_line_id]) cellsByLine[c.pricing_line_id] = [];
    cellsByLine[c.pricing_line_id].push(c);
  });
  // Sort cells inside each group by stage_display_order.
  Object.values(cellsByLine).forEach((arr) =>
    arr.sort((a, b) => (a.stage_display_order || 0) - (b.stage_display_order || 0))
  );

  // Sort pricing lines by line_number for stable display.
  const orderedLines = pricingLines.slice().sort((a, b) => (a.line_number || 0) - (b.line_number || 0));

  // ─── Mutation helpers ───────────────────────────────────────────
  function setCellQty(pricing_line_id, stage_key, qty) {
    setCycleOverrides((prev) => ({
      ...prev,
      [pricing_line_id]: { ...(prev[pricing_line_id] || {}), [stage_key]: qty },
    }));
  }
  function toggleBillFull(line, stage_key, currentQty) {
    setCellQty(line.id, stage_key, currentQty > 0 ? 0 : Number(line.qty) || 0);
  }

  if (orderedLines.length === 0) {
    return (
      <div style={{
        padding: 24,
        textAlign: 'center',
        color: COLOR.text3,
        fontSize: 12,
        fontStyle: 'italic',
        background: COLOR.page,
        borderRadius: RADIUS.lg,
        border: `1px dashed ${COLOR.border}`,
        marginBottom: 12,
      }}>
        No pricing rows yet — set them up on the <b>Pricing</b> tab first.
      </div>
    );
  }

  return (
    <div style={{
      background: COLOR.white,
      border: `1px solid ${COLOR.border}`,
      borderRadius: RADIUS.lg,
      overflow: 'auto',
      marginBottom: 12,
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: COLOR.page, borderBottom: `1px solid ${COLOR.border}` }}>
            {['Pricing Line', 'Stage', 'Cum Qty', 'Prior', 'Current', 'Rate', 'Labor', 'Tax Basis', 'Tax', 'Total'].map((h, i) => (
              <th key={i} style={{
                padding: '8px 10px',
                textAlign: i >= 2 ? 'right' : 'left',
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
          {orderedLines.map((line) => {
            const cells = cellsByLine[line.id] || [];
            const isMulti = MULTI_STAGE_CATEGORIES.has(line.category);
            const lineSubtotal = cells.reduce((s, c) => s + Number(c.current_total || 0), 0);

            return (
              <React.Fragment key={line.id}>
                {/* Pricing line header — spans the whole row */}
                <tr style={{ background: '#FAFAF8', borderBottom: `1px solid ${COLOR.border}` }}>
                  <td colSpan={9} style={{ padding: '8px 10px' }}>
                    <span style={{ fontWeight: 800, color: COLOR.text }}>{line.label}</span>
                    <span style={{ marginLeft: 8, fontSize: 10, color: COLOR.text3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      {CATEGORY_LABELS[line.category] || line.category}
                    </span>
                    <span style={{ marginLeft: 8, fontSize: 10, color: COLOR.text3 }}>
                      Contract: {Number(line.qty).toLocaleString()} {line.unit} × {$(line.price_per_unit)} = {$(line.extended_total)}
                    </span>
                    {!isMulti && (
                      <span style={{
                        marginLeft: 8,
                        fontSize: 9,
                        padding: '1px 6px',
                        background: COLOR.warnBg,
                        color: COLOR.warn,
                        borderRadius: RADIUS.pill,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                      }}>Manual</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700 }}>
                    {lineSubtotal > 0 ? $(lineSubtotal) : '—'}
                  </td>
                </tr>

                {/* Stage rows */}
                {cells.map((c) => {
                  const overBilling = c.warning === 'over_billing';
                  const currentOverride = cycleOverrides[line.id]?.[c.stage_key];
                  const billed = Number(currentOverride ?? c.cumulative_qty) > 0;
                  return (
                    <tr key={`${line.id}-${c.stage_key}`} style={{
                      borderBottom: `1px solid ${COLOR.border}`,
                      opacity: c.current_qty === 0 && c.prior_qty === 0 ? 0.55 : 1,
                    }}>
                      {/* Indent under header */}
                      <td style={{ padding: '6px 10px 6px 24px', fontSize: 11, color: COLOR.text3 }}>
                        {!isMulti && canEdit && (
                          <input
                            type="checkbox"
                            checked={billed}
                            onChange={() => toggleBillFull(line, c.stage_key, currentOverride ?? c.cumulative_qty)}
                            style={{ width: 14, height: 14, accentColor: COLOR.brand, marginRight: 8 }}
                            title="Bill this line at full contract qty"
                          />
                        )}
                        <span style={{ fontStyle: 'italic' }}>↳</span>
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: COLOR.text2, fontWeight: 600 }}>
                        {c.stage_label}
                      </td>
                      {/* Cum Qty: editable for non-fence categories, read-only for precast/sw */}
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        {isMulti ? (
                          <span style={{
                            fontFamily: FONT.data,
                            fontWeight: 700,
                            color: overBilling ? COLOR.danger : COLOR.text,
                          }}>
                            {overBilling && <span style={{ marginRight: 4, fontSize: 10 }}>⚠</span>}
                            {Number(c.cumulative_qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <QtyCell
                            value={c.cumulative_qty}
                            max={line.qty}
                            disabled={!canEdit}
                            warning={overBilling}
                            onChange={(v) => setCellQty(line.id, c.stage_key, v)}
                          />
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontSize: 11, color: COLOR.text3 }}>
                        {Number(c.prior_qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700, color: c.current_qty > 0 ? COLOR.text : COLOR.text3 }}>
                        {Number(c.current_qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontSize: 11, color: COLOR.text3 }}>
                        {$(c.rate_per_unit)}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontSize: 11 }}>
                        {c.current_labor_amount > 0 ? $(c.current_labor_amount) : '—'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontSize: 11 }}>
                        {c.current_tax_basis_amount > 0 ? $(c.current_tax_basis_amount) : '—'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontSize: 11 }}>
                        {c.current_tax_amount > 0 ? $(c.current_tax_amount) : '—'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700, color: c.current_total > 0 ? COLOR.text : COLOR.text3 }}>
                        {c.current_total > 0 ? $(c.current_total) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: COLOR.page, borderTop: `2px solid ${COLOR.brand}` }}>
            <td colSpan={6} style={{
              padding: '10px 12px',
              fontSize: 11,
              fontWeight: 800,
              color: COLOR.text2,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}>
              Cycle Totals
            </td>
            <td colSpan={3} style={{
              padding: '10px 12px',
              textAlign: 'right',
              fontSize: 11,
              color: COLOR.text2,
            }}>
              <span style={{ marginRight: 14 }}>Retainage: <b style={{ color: COLOR.warn, fontFamily: FONT.data }}>{$(draftTotals?.current_retainage)}</b></span>
              <span>Net Due: <b style={{ color: COLOR.success, fontFamily: FONT.data }}>{$(draftTotals?.net_due)}</b></span>
            </td>
            <td style={{
              padding: '10px 12px',
              textAlign: 'right',
              fontFamily: FONT.data,
              fontWeight: 900,
              fontSize: 14,
              color: COLOR.brand,
            }}>
              {$(draftTotals?.current_amount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
