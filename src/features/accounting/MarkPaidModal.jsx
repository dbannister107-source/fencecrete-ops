// MarkPaidModal — small confirm dialog for recording an invoice payment.
//
// Inserts a row into invoice_payments. The trg_apply_payment_to_application
// trigger (Phase E #7) auto-maintains invoice_applications.paid_amount,
// paid_at, and status — so this component does NOT need to PATCH the App
// header itself.
//
// Pre-populates the amount with the App's net_due (the typical "customer
// paid in full" case). User can override for partial payments — status
// will stay 'filed' until SUM(payments) >= net_due.

import React, { useState } from 'react';
import { sbPost } from '../../shared/sb';
import { COLOR, RADIUS, btnP, btnS, inputS, FONT } from '../../shared/ui';
import { $, fD } from '../../shared/fmt';

const todayISO = () => new Date().toISOString().slice(0, 10);

const PAYMENT_METHODS = [
  { v: 'check',  l: 'Check' },
  { v: 'wire',   l: 'Wire' },
  { v: 'ach',    l: 'ACH' },
  { v: 'cash',   l: 'Cash' },
  { v: 'credit', l: 'Credit Card' },
  { v: 'other',  l: 'Other' },
];

export default function MarkPaidModal({ app, currentUserEmail, onSuccess, onClose }) {
  const netDue = Number(app.net_due) || 0;
  const alreadyPaid = Number(app.paid_amount) || 0;
  const remaining = Math.max(0, netDue - alreadyPaid);

  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [amount, setAmount]           = useState(remaining > 0 ? String(remaining) : String(netDue));
  const [method, setMethod]           = useState('check');
  const [reference, setReference]     = useState('');
  const [notes, setNotes]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState(null);

  const amt = Number(amount) || 0;
  const willClose = (alreadyPaid + amt) >= netDue && netDue > 0;
  const overpay = amt > remaining + 0.005;

  async function submit() {
    if (saving) return;
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr('Amount must be greater than $0.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await sbPost('invoice_payments', {
        invoice_application_id: app.id,
        payment_date: paymentDate || todayISO(),
        amount: amt,
        method,
        reference: reference || null,
        notes: notes || null,
        recorded_by: currentUserEmail || 'unknown',
      }, { throwOnError: true });
      onSuccess(`Payment recorded: ${$(amt)} for App #${app.app_number}${willClose ? ' (closed)' : ' (partial)'}`);
    } catch (e) {
      setErr('Save failed: ' + (e.message || String(e)));
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: COLOR.white,
        borderRadius: RADIUS.xl,
        padding: 24,
        width: '92%', maxWidth: 480,
        boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COLOR.text }}>Record Payment</div>
          <div style={{ fontSize: 12, color: COLOR.text2, marginTop: 4 }}>
            App #{app.app_number} · {app.invoice_number || '—'} · Net Due {$(netDue)}
            {alreadyPaid > 0 && <> · Already paid {$(alreadyPaid)}</>}
          </div>
        </div>

        {err && <div style={{
          padding: '8px 12px', marginBottom: 12,
          background: COLOR.dangerBg, color: COLOR.danger,
          borderRadius: RADIUS.md, fontSize: 12, fontWeight: 600,
        }}>⚠ {err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={lblStyle}>Payment Date</label>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                   style={{ ...inputS, width: '100%' }} />
          </div>
          <div>
            <label style={lblStyle}>Amount Received</label>
            <input type="number" min="0" step="0.01" value={amount}
                   onChange={(e) => setAmount(e.target.value)}
                   style={{ ...inputS, width: '100%', fontFamily: FONT.data, fontWeight: 700 }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={lblStyle}>Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
                    style={{ ...inputS, width: '100%' }}>
              {PAYMENT_METHODS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div>
            <label style={lblStyle}>Reference (check #, wire conf, etc.)</label>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                   placeholder="optional" style={{ ...inputS, width: '100%' }} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lblStyle}>Notes</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                 placeholder="optional" style={{ ...inputS, width: '100%' }} />
        </div>

        {/* Status preview */}
        <div style={{
          padding: '8px 12px', marginBottom: 14,
          background: willClose ? COLOR.successBg : COLOR.warnBg,
          color: willClose ? COLOR.success : '#92400E',
          borderRadius: RADIUS.md, fontSize: 11, fontWeight: 600, lineHeight: 1.5,
        }}>
          {willClose
            ? `✓ This payment closes the invoice. Status will flip to PAID on ${fD(paymentDate)}.`
            : `Partial payment: ${$(amt)} of ${$(netDue)}. Remaining: ${$(remaining - amt)}. Status stays FILED until paid in full.`}
          {overpay && <div style={{ marginTop: 4, fontStyle: 'italic' }}>⚠ Amount exceeds remaining net due — recording as overpayment.</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={btnS}>Cancel</button>
          <button onClick={submit} disabled={saving || amt <= 0}
                  style={{ ...btnP, opacity: saving || amt <= 0 ? 0.5 : 1, background: willClose ? COLOR.success : COLOR.brand }}>
            {saving ? 'Recording…' : willClose ? '✓ Mark Paid' : 'Record Partial Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

const lblStyle = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  color: COLOR.text2,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  marginBottom: 4,
};
