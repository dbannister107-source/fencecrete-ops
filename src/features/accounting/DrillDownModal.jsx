// DrillDownModal — reusable, large, scrollable detail view for any entity.
//
// Generic shell + entity-specific bodies. The 'invoice' view is the
// fully-implemented case (App header + per-stage line breakdown + payment
// history + legacy-import note + Mark Paid quick action). Other entity
// types render placeholder stubs that point users at the editor where
// the detail actually lives — until each gets a concrete need + UI.
//
// Usage:
//   <DrillDownModal
//     title="App #3 — INV-26H017-03"
//     subtitle="Apr 2026 cycle"
//     entityType="invoice"
//     entityId={app.id}
//     onClose={() => setOpenApp(null)}
//     onAction={(action) => action === 'mark_paid' && setMarkPaidApp(app)}
//   />
//
// Design conforms to the rest of the Accounting tab: same money tiles,
// same status-pill styling, same section-header treatment, same money
// formatter ($), same date formatter (fD).

import React, { useEffect, useState } from 'react';
import { sbGet } from '../../shared/sb';
import { COLOR, RADIUS, btnP, btnS, FONT } from '../../shared/ui';
import { $, fD } from '../../shared/fmt';

// 2026-05-05 (mobile pass): inline mobile detection. Mirrors the shared
// useViewport / useIsMobile pattern at the 768px breakpoint without
// taking on a cross-feature import.
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

// ─── Stage display order (used to sort line breakdown rows) ──────────
// stage_keys are plain text in the DB; alphabetical sort would reorder
// 'posts_only' / 'posts_panels' / 'complete' wrong. Use the canonical
// display order from stage_weights.display_order, mirrored here so we
// don't need a join just to sort 3 rows per pricing line.
const STAGE_ORDER = {
  // precast
  posts_only: 1, posts_panels: 2, complete: 3,
  // sw
  foundation: 1, columns: 2, panels: 3, cleanup: 4,
};

// ─── Status pill ─────────────────────────────────────────────────────
const STATUS_STYLES = {
  draft: { bg: COLOR.bgSoft,    color: COLOR.text2,   label: 'Draft' },
  filed: { bg: COLOR.infoBg,    color: COLOR.info,    label: 'Filed' },
  paid:  { bg: COLOR.successBg, color: COLOR.success, label: 'Paid' },
  void:  { bg: COLOR.dangerBg,  color: COLOR.danger,  label: 'Void' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || { bg: COLOR.bgSoft, color: COLOR.text2, label: status || '—' };
  return (
    <span style={{
      padding: '4px 12px',
      borderRadius: RADIUS.pill,
      fontSize: 11,
      fontWeight: 700,
      background: s.bg,
      color: s.color,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

// ─── Section header (matches Contract Readiness card style) ──────────
function SectionHeader({ children, count }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingBottom: 6,
      marginBottom: 10,
      marginTop: 18,
      borderBottom: `2px solid ${COLOR.brand}`,
      fontSize: 11,
      fontWeight: 800,
      color: COLOR.text2,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      <span>{children}</span>
      {count != null && (
        <span style={{ fontSize: 10, color: COLOR.text3, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Tile({ label, value, accent = 'text', sub }) {
  const colorMap = {
    text:    COLOR.text,
    success: COLOR.success,
    warn:    COLOR.warn,
    info:    COLOR.info,
    danger:  COLOR.danger,
  };
  return (
    <div style={{
      padding: 12,
      background: COLOR.page,
      border: `1px solid ${COLOR.border}`,
      borderRadius: RADIUS.lg,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 800, color: COLOR.text2,
        textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 900, fontFamily: FONT.data, color: colorMap[accent] || COLOR.text }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: COLOR.text3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{
      padding: 16,
      textAlign: 'center',
      background: COLOR.page,
      border: `1px dashed ${COLOR.border}`,
      borderRadius: RADIUS.lg,
      color: COLOR.text3,
      fontSize: 12,
      fontStyle: 'italic',
      marginBottom: 12,
    }}>{text}</div>
  );
}

function Loading() {
  return <div style={{ padding: 40, textAlign: 'center', color: COLOR.text3, fontSize: 12 }}>Loading…</div>;
}

function ErrorBanner({ msg }) {
  return (
    <div style={{
      padding: '12px 16px', marginBottom: 16,
      background: COLOR.dangerBg, color: COLOR.danger,
      border: `1px solid ${COLOR.danger}`,
      borderRadius: RADIUS.lg, fontSize: 12, fontWeight: 600,
    }}>⚠ {msg}</div>
  );
}

// ─── Invoice (entity_type='invoice') view ────────────────────────────
function InvoiceView({ data }) {
  const { app, lines, payments, pricingByLineId } = data;
  const isLegacy = !!app.source_invoice_entry_id;
  const isReleaseApp = !!app.is_retainage_release;
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  // Group cells by pricing_line_id; sort each group by stage display order.
  const linesByPricing = {};
  lines.forEach(l => {
    const k = l.job_pricing_line_id || '_unlinked';
    (linesByPricing[k] = linesByPricing[k] || []).push(l);
  });
  Object.values(linesByPricing).forEach(g =>
    g.sort((a, b) => (STAGE_ORDER[a.stage_key] || 99) - (STAGE_ORDER[b.stage_key] || 99))
  );

  return (
    <div>
      {/* Money tiles */}
      <SectionHeader>Summary</SectionHeader>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Tile label="Current Amount"     value={$(app.current_amount)} />
        <Tile label="Retainage Withheld" value={$(app.current_retainage)} accent="warn" />
        <Tile label="Net Due"            value={$(app.net_due)} accent="success" />
        <Tile label="Paid To Date"       value={$(totalPaid)}
              accent={totalPaid > 0 && totalPaid >= Number(app.net_due || 0) ? 'success' : 'text'}
              sub={totalPaid > 0 && totalPaid < Number(app.net_due || 0) ? 'partial' : null} />
        <Tile label="Billed Before"      value={$(app.billed_to_date)} />
        <Tile label="Retainage To Date"  value={$(app.retainage_to_date)} accent="warn" />
      </div>

      {/* Date / metadata strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10,
        marginTop: 14, padding: '10px 14px',
        background: COLOR.page, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.lg,
        fontSize: 11, color: COLOR.text2,
      }}>
        <div><span style={{ color: COLOR.text3, fontWeight: 700 }}>Invoice Date:</span> <b style={{ color: COLOR.text }}>{fD(app.invoice_date)}</b></div>
        <div><span style={{ color: COLOR.text3, fontWeight: 700 }}>Period:</span> <b style={{ color: COLOR.text }}>{fD(app.billing_period)}</b></div>
        {app.filed_at && (
          <div>
            <span style={{ color: COLOR.text3, fontWeight: 700 }}>Filed:</span>{' '}
            <b style={{ color: COLOR.text }}>{fD(app.filed_at)}</b>
            {app.filed_by ? <span style={{ color: COLOR.text3 }}> by {app.filed_by}</span> : null}
          </div>
        )}
        {app.paid_at && (
          <div>
            <span style={{ color: COLOR.text3, fontWeight: 700 }}>Paid:</span>{' '}
            <b style={{ color: COLOR.success }}>✓ {fD(app.paid_at)}</b>
          </div>
        )}
      </div>

      {/* Legacy-import note */}
      {isLegacy && (
        <div style={{
          padding: '10px 14px', marginTop: 14,
          background: COLOR.infoBg, border: `1px solid ${COLOR.info}`,
          borderRadius: RADIUS.lg, color: COLOR.info,
          fontSize: 12, lineHeight: 1.5,
        }}>
          📋 <b>Legacy import.</b> This App was generated by the Phase A synthetic backfill from a pre-cutover <code>invoice_entries</code> row. Header amounts are accurate; per-stage breakdown is not available (the original Excel didn't capture it).
        </div>
      )}

      {/* Retainage release note */}
      {isReleaseApp && (
        <div style={{
          padding: '10px 14px', marginTop: 14,
          background: COLOR.warnBg, border: `1px solid ${COLOR.warn}`,
          borderRadius: RADIUS.lg, color: '#92400E',
          fontSize: 12, lineHeight: 1.5,
        }}>
          ↳ <b>Retainage Release.</b> This App bills the cumulative held retainage and zeroes the balance. Header-only — no per-stage breakdown.
        </div>
      )}

      {/* Per-stage line breakdown (skip for legacy + release Apps) */}
      {!isLegacy && !isReleaseApp && (
        <>
          <SectionHeader count={`${lines.length} cell${lines.length === 1 ? '' : 's'}`}>
            Line Breakdown
          </SectionHeader>
          {lines.length === 0 ? (
            <EmptyState text="No line breakdown — this App was filed without per-stage detail." />
          ) : (
            <div style={{
              border: `1px solid ${COLOR.border}`,
              borderRadius: RADIUS.lg,
              overflow: 'auto',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: COLOR.page, borderBottom: `1px solid ${COLOR.border}` }}>
                    {['Pricing Line', 'Stage', 'Cum', 'Prior', 'Curr', 'Rate', 'Labor', 'Tax Basis', 'Tax', 'Total'].map((h, i) => (
                      <th key={i} style={{
                        padding: '7px 10px',
                        textAlign: i >= 2 ? 'right' : 'left',
                        fontSize: 10, fontWeight: 700, color: COLOR.text2,
                        textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(linesByPricing).map(([pricingId, group]) => {
                    const meta = pricingByLineId[pricingId];
                    const label = meta?.label || (pricingId === '_unlinked' ? '— Unlinked —' : 'Pricing Line');
                    const subtotal = group.reduce((s, c) => s + Number(c.current_total || 0), 0);
                    return (
                      <React.Fragment key={pricingId}>
                        <tr style={{ background: '#FAFAF8', borderBottom: `1px solid ${COLOR.border}` }}>
                          <td colSpan={9} style={{ padding: '7px 10px', fontWeight: 800, color: COLOR.text }}>
                            {label}
                            {meta?.height && (
                              <span style={{ marginLeft: 8, color: COLOR.text3, fontWeight: 600, fontSize: 10 }}>
                                {meta.height}{meta.unit ? ` ${meta.unit}` : ''}
                              </span>
                            )}
                            {meta?.style && (
                              <span style={{ marginLeft: 8, color: COLOR.text3, fontWeight: 500, fontSize: 10 }}>
                                {meta.style}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 800, color: COLOR.text }}>
                            {$(subtotal)}
                          </td>
                        </tr>
                        {group.map(c => (
                          <tr key={c.id} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                            <td style={{ padding: '6px 10px 6px 24px', color: COLOR.text3, fontSize: 11 }}>↳</td>
                            <td style={{ padding: '6px 10px', fontWeight: 600, color: COLOR.text2 }}>{c.stage_key}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data }}>
                              {Number(c.cumulative_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, color: COLOR.text3 }}>
                              {Number(c.prior_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700 }}>
                              {Number(c.current_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, color: COLOR.text3 }}>
                              {$(c.rate_per_unit)}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data }}>
                              {Number(c.current_labor_amount) > 0 ? $(c.current_labor_amount) : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data }}>
                              {Number(c.current_tax_basis_amount) > 0 ? $(c.current_tax_basis_amount) : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data }}>
                              {Number(c.current_tax_amount) > 0 ? $(c.current_tax_amount) : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700 }}>
                              {$(c.current_total)}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Payment history */}
      <SectionHeader count={payments.length === 0 ? 'no payments' : `${payments.length} payment${payments.length === 1 ? '' : 's'}`}>
        Payment History
      </SectionHeader>
      {payments.length === 0 ? (
        <EmptyState text={app.status === 'paid' ? 'Marked paid without recording individual payments.' : 'No payments recorded yet.'} />
      ) : (
        <div style={{
          border: `1px solid ${COLOR.border}`,
          borderRadius: RADIUS.lg,
          overflow: 'auto',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: COLOR.page, borderBottom: `1px solid ${COLOR.border}` }}>
                {['Date', 'Method', 'Reference', 'Notes', 'Recorded By', 'Amount'].map((h, i) => (
                  <th key={i} style={{
                    padding: '7px 10px',
                    textAlign: i === 5 ? 'right' : 'left',
                    fontSize: 10, fontWeight: 700, color: COLOR.text2,
                    textTransform: 'uppercase', letterSpacing: 0.3,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                  <td style={{ padding: '7px 10px' }}>{fD(p.payment_date)}</td>
                  <td style={{ padding: '7px 10px', textTransform: 'capitalize' }}>{p.method || '—'}</td>
                  <td style={{ padding: '7px 10px', fontFamily: FONT.data }}>{p.reference || '—'}</td>
                  <td style={{ padding: '7px 10px', color: COLOR.text2 }}>{p.notes || ''}</td>
                  <td style={{ padding: '7px 10px', fontSize: 10, color: COLOR.text3 }}>{p.recorded_by || '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: FONT.data, fontWeight: 700, color: COLOR.success }}>
                    {$(p.amount)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: COLOR.page, borderTop: `2px solid ${COLOR.brand}` }}>
                <td colSpan={5} style={{
                  padding: '8px 10px', fontWeight: 800, color: COLOR.text2,
                  textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10,
                }}>Total Paid</td>
                <td style={{
                  padding: '8px 10px', textAlign: 'right',
                  fontFamily: FONT.data, fontWeight: 900, fontSize: 13,
                  color: COLOR.success,
                }}>{$(totalPaid)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      {app.notes && (
        <>
          <SectionHeader>Notes</SectionHeader>
          <div style={{
            padding: 12, background: COLOR.page,
            border: `1px solid ${COLOR.border}`,
            borderRadius: RADIUS.lg,
            fontSize: 12, color: COLOR.text2, lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}>{app.notes}</div>
        </>
      )}
    </div>
  );
}

// ─── Stub view for entity types not yet wired ────────────────────────
function StubView({ entityType }) {
  const recommendations = {
    changeorder: 'Use the Scope tab — each Change Order has its own card with line items and sub-pricing inline.',
    lineitem:    'Use the Scope tab — Line Items editor handles edits inline.',
    pricingline: 'Use the Contract tab — the Pricing Book editor handles edits inline.',
  };
  const recommend = recommendations[entityType] || 'Drill-down view not yet wired for this entity type.';
  return (
    <div style={{
      padding: 32, textAlign: 'center',
      background: COLOR.page,
      border: `1px dashed ${COLOR.border}`,
      borderRadius: RADIUS.lg,
      color: COLOR.text2, fontSize: 13, lineHeight: 1.6,
    }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🚧</div>
      <div style={{ fontWeight: 700, marginBottom: 8, color: COLOR.text, fontSize: 14 }}>
        Drill-down for <code style={{ background: COLOR.bgSoft, padding: '2px 6px', borderRadius: 4 }}>{entityType}</code> not yet wired
      </div>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>{recommend}</div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────
export default function DrillDownModal({
  title,
  subtitle,
  entityType,
  entityId,
  onClose,
  onAction,
}) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [data, setData]       = useState(null);

  // Fetch on mount + entity change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setErr(null); setData(null);
      try {
        if (entityType === 'invoice') {
          const [appRows, lines, payments] = await Promise.all([
            sbGet('invoice_applications',      `id=eq.${entityId}&limit=1`),
            sbGet('invoice_application_lines', `invoice_application_id=eq.${entityId}`),
            sbGet('invoice_payments',          `invoice_application_id=eq.${entityId}&order=payment_date.desc`),
          ]);
          if (cancelled) return;
          const app = Array.isArray(appRows) && appRows.length > 0 ? appRows[0] : null;
          if (!app) {
            setErr('Invoice not found.');
            setLoading(false);
            return;
          }
          // Resolve pricing-line labels for the breakdown headers (cheap follow-up
          // fetch only for the linked IDs; skipped if there are none).
          const pricingIds = Array.from(
            new Set((lines || []).map(l => l.job_pricing_line_id))
          ).filter(Boolean);
          let pricingByLineId = {};
          if (pricingIds.length > 0) {
            try {
              const pricing = await sbGet(
                'job_pricing_lines',
                `id=in.(${pricingIds.join(',')})&select=id,label,category,height,style,unit`
              );
              if (!cancelled && Array.isArray(pricing)) {
                pricingByLineId = Object.fromEntries(pricing.map(p => [p.id, p]));
              }
            } catch (e) {
              // Non-fatal — labels just won't resolve, headers fall back to 'Pricing Line'.
            }
          }
          if (cancelled) return;
          setData({ app, lines: lines || [], payments: payments || [], pricingByLineId });
        } else {
          // Stubs — no fetch
          setData({ stub: true });
        }
      } catch (e) {
        if (!cancelled) setErr('Load failed: ' + (e.message || String(e)));
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && typeof onClose === 'function') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Status badge from invoice data (other entity types don't surface one yet)
  const status = (entityType === 'invoice' && data?.app?.status) || null;

  // Quick-action availability
  const canMarkPaid =
    entityType === 'invoice'
    && data?.app
    && data.app.status === 'filed'
    && !data.app.source_invoice_entry_id;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: isMobile ? 'stretch' : 'center',
      justifyContent: 'center',
      zIndex: 1000,
      // 2026-05-05 (mobile pass): drop backdrop padding to 0 on phones so
      // the modal claims the full viewport. Desktop keeps the 20px gutter.
      padding: isMobile ? 0 : 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: COLOR.white,
        // Full-screen on mobile (no rounded corners, claims full viewport);
        // centered card on desktop.
        borderRadius: isMobile ? 0 : RADIUS.xl,
        width: '100%',
        maxWidth: isMobile ? 'none' : 1100,
        height: isMobile ? '100%' : 'auto',
        maxHeight: isMobile ? '100vh' : 'calc(100vh - 40px)',
        display: 'flex', flexDirection: 'column',
        boxShadow: isMobile ? 'none' : '0 20px 50px rgba(0,0,0,0.3)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${COLOR.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0,
          background: COLOR.page,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: COLOR.text, lineHeight: 1.2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: COLOR.text2, marginTop: 3 }}>{subtitle}</div>}
          </div>
          {status && <StatusBadge status={status} />}
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            style={{
              width: 32, height: 32,
              border: `1px solid ${COLOR.border}`,
              background: COLOR.white,
              borderRadius: RADIUS.md,
              cursor: 'pointer',
              fontSize: 18, fontWeight: 700,
              color: COLOR.text2, lineHeight: 1, padding: 0,
            }}>×</button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {loading && <Loading />}
          {err && <ErrorBanner msg={err} />}
          {!loading && !err && data && entityType === 'invoice' && <InvoiceView data={data} />}
          {!loading && !err && data && entityType !== 'invoice' && <StubView entityType={entityType} />}
        </div>

        {/* Footer — quick actions */}
        <div style={{
          padding: '12px 20px',
          borderTop: `1px solid ${COLOR.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
          background: COLOR.page,
          gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {canMarkPaid && (
              <button
                onClick={() => onAction && onAction('mark_paid')}
                style={{
                  ...btnP,
                  background: COLOR.success,
                  fontSize: 12,
                }}>✓ Mark Paid</button>
            )}
            <button
              disabled
              title="PDF export coming in a future release"
              style={{
                ...btnS,
                fontSize: 12,
                opacity: 0.5,
                cursor: 'not-allowed',
              }}>📄 Export PDF</button>
          </div>
          <button onClick={onClose} style={{ ...btnS, fontSize: 12 }}>Close</button>
        </div>
      </div>
    </div>
  );
}
