// JobPricingEditor — the per-job pricing book editor.
//
// Mirrors the Excel "Original Contract Amounts" section. One row per
// pricing scope (each precast height, SW, each gate type, each option,
// each permit/bond, etc.). Each row carries the price decomposition
// (price = labor + tax_basis) that the calc engine in Phase C uses to
// compute per-stage billing + sales tax.
//
// Auto-seed on first open: when the table is empty for this (job_id, coId),
// we generate candidate rows from job_line_items + HEIGHT_BASIS, mark them
// _new=true, and render them with a yellow "Generated from line items —
// review and Save" banner. No DB writes until the user clicks Save.
// (Decision C from the planning round on 2026-05-05.)
//
// Save flow: split lines into INSERT/UPDATE/DELETE batches, run sequentially.
// Same registerSave-ref pattern as LineItemsEditor so the parent EditPanel's
// top "Save" button can commit pricing edits in one click.

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { sbGet, sbPost, sbPatch, sbDel } from '../../shared/sb';
import { COLOR, RADIUS, btnP, btnS, inputS, MoneyInput } from '../../shared/ui';
import { HEIGHT_BASIS, derivePriceSplit, deriveTaxBasis } from '../../shared/billing/heightBasis';
import StageWeightsPanel from './StageWeightsPanel';

// ─── Category catalog ─────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'precast', label: 'Precast',       defaultUnit: 'LF' },
  { key: 'sw',      label: 'Single Wythe',  defaultUnit: 'LF' },
  { key: 'wi_gate', label: 'WI Gate',       defaultUnit: 'EA' },
  { key: 'option',  label: 'Option',        defaultUnit: 'LS' },
  { key: 'permit',  label: 'Permit',        defaultUnit: 'LS' },
  { key: 'bond',    label: 'Bond',          defaultUnit: 'LS' },
  { key: 'other',   label: 'Other',         defaultUnit: 'LS' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));
const UNITS = ['LF', 'EA', 'LS'];

// ─── Auto-seed ────────────────────────────────────────────────────────
//
// Maps job_line_items rows to candidate job_pricing_lines rows.
// fence_type abbreviations on line items: 'PC' = Precast, 'SW' = Single
// Wythe, 'WI' = Wrought Iron. Plus the special-purpose types stored as
// fence_type strings: 'Gate', 'Permit', 'P&P Bond', 'Maint Bond',
// 'Insurance', 'Lump Sum', 'Columns', 'Gate Controls', 'Other', 'Wood'.
//
// We dedupe by (fence_type, height, style) — e.g. five 6'pc line items
// collapse into one "6' pc" pricing row. The qty seeds from the SUM of
// LF in that group. price_per_unit takes the most common contract_rate.

function classifyForPricing(li) {
  const ft = li.fence_type || '';
  if (ft === 'PC')          return { category: 'precast', unit: 'LF' };
  if (ft === 'SW')          return { category: 'sw',      unit: 'LF' };
  if (ft === 'WI')          return { category: 'sw',      unit: 'LF' }; // legacy WI fence (not gates) — bills like SW
  if (ft === 'Gate')        return { category: 'wi_gate', unit: 'EA' };
  if (ft === 'Permit')      return { category: 'permit',  unit: 'LS' };
  if (ft === 'P&P Bond' || ft === 'Maint Bond') return { category: 'bond', unit: 'LS' };
  if (ft === 'Insurance')   return { category: 'bond',    unit: 'LS' };
  if (ft === 'Lump Sum')    return { category: 'option',  unit: 'LS' };
  if (ft === 'Columns')     return { category: 'option',  unit: 'EA' };
  if (ft === 'Gate Controls')return{ category: 'option',  unit: 'EA' };
  return { category: 'other', unit: 'LS' };
}

function buildLabel({ category, height, style, fallback }) {
  if (category === 'precast' && height) return `${String(height).replace(/['"]/g, '')}' pc`;
  if (category === 'sw' && height)      return `${String(height).replace(/['"]/g, '')}' sw`;
  if (category === 'wi_gate')           return fallback || 'WI Gate';
  return fallback || (CATEGORY_LABEL[category] || category);
}

function seedFromLineItems(lineItems) {
  // Group by (category, height, style) for fence rows; each gate / option /
  // permit / bond row stays as its own pricing row (don't collapse those).
  const groups = new Map();
  const standalone = [];

  lineItems.forEach(li => {
    const { category, unit } = classifyForPricing(li);
    const heightKey = String(li.height || '').replace(/['"]/g, '').trim();
    const styleKey = (li.style || '').trim();
    const isFence = category === 'precast' || category === 'sw';

    if (isFence) {
      const key = `${category}|${heightKey}|${styleKey}`;
      if (!groups.has(key)) {
        groups.set(key, {
          category,
          height: heightKey || null,
          style:  styleKey || null,
          unit,
          qty: 0,
          rateSamples: [],
          source_line_ids: [],
        });
      }
      const g = groups.get(key);
      g.qty += Number(li.lf) || 0;
      if (Number(li.contract_rate) > 0) g.rateSamples.push(Number(li.contract_rate));
      g.source_line_ids.push(li.id);
    } else {
      standalone.push({ category, unit, li });
    }
  });

  // Promote groups → candidate pricing rows
  const out = [];
  let lineNumber = 1;
  for (const g of groups.values()) {
    const price = g.rateSamples.length
      ? Math.round((g.rateSamples.reduce((s, x) => s + x, 0) / g.rateSamples.length) * 100) / 100
      : null;
    const split = derivePriceSplit({ price, category: g.category, height: g.height, style: g.style });
    out.push({
      _new: true,
      _touched: true,
      line_number: lineNumber++,
      category: g.category,
      label: buildLabel({ category: g.category, height: g.height, style: g.style }),
      fence_type: g.category === 'precast' ? 'PC' : g.category === 'sw' ? 'SW' : null,
      height: g.height,
      style: g.style,
      qty: g.qty,
      unit: g.unit,
      price_per_unit: price,
      labor_per_unit: split.labor_per_unit,
      tax_basis_per_unit: split.tax_basis_per_unit,
      tax_exempt: false,
      _taxBasisManual: false,  // local UI flag — track whether user has typed in tax_basis
      _seeded: true,
      _seed_source: `${g.source_line_ids.length} line item${g.source_line_ids.length === 1 ? '' : 's'}`,
    });
  }

  // Standalone rows (gates, permits, bonds, options) — one per source line
  for (const s of standalone) {
    const li = s.li;
    const price = Number(li.contract_rate) || Number(li.unit_price) || 0;
    const split = derivePriceSplit({ price, category: s.category });
    out.push({
      _new: true,
      _touched: true,
      line_number: lineNumber++,
      category: s.category,
      label: buildLabel({ category: s.category, fallback: li.description || li.fence_type }),
      fence_type: li.fence_type,
      height: li.height || null,
      style: null,
      qty: Number(li.lf) || 1,
      unit: s.unit,
      price_per_unit: price,
      labor_per_unit: split.derived ? split.labor_per_unit : price,
      tax_basis_per_unit: split.derived ? split.tax_basis_per_unit : 0,
      tax_exempt: s.category === 'permit' || s.category === 'bond',
      _taxBasisManual: false,
      _seeded: true,
      _seed_source: '1 line item',
    });
  }

  return out;
}

// ─── Component ────────────────────────────────────────────────────────
export default function JobPricingEditor({ job, coId = null, canEdit, onChange, registerSave }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);  // true ⇒ banner showing
  const [dirty, setDirty]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);
  const [toast, setToast]     = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  // ─── Load + seed ────────────────────────────────────────────────────
  const loadLines = useCallback(async () => {
    if (!job?.id) { setLines([]); setLoading(false); return; }
    setLoading(true);
    try {
      const filter = coId
        ? `co_id=eq.${coId}&order=line_number.asc`
        : `job_id=eq.${job.id}&co_id=is.null&order=line_number.asc`;
      const existing = await sbGet('job_pricing_lines', filter);
      if (Array.isArray(existing) && existing.length > 0) {
        // M4 fix (2026-05-05): always start with _taxBasisManual=false on load.
        // Previously set true whenever tax_basis_per_unit was present (which is
        // every saved row), which silently disabled the auto-recompute path
        // when the user changed height. Now: editing height re-derives
        // tax_basis from HEIGHT_BASIS until the user types into the cell —
        // matches the create-time UX. If a user has a custom tax_basis they
        // want to preserve, they can re-type it after the height change.
        setLines(existing.map(l => ({ ...l, _existing: true, _taxBasisManual: false })));
        setSeeding(false);
        setDirty(false);
      } else {
        // Seed from line items.
        const liFilter = coId
          ? `co_id=eq.${coId}&order=line_number.asc`
          : `job_number=eq.${encodeURIComponent(job.job_number)}&co_id=is.null&order=line_number.asc`;
        const li = await sbGet('job_line_items', liFilter);
        const seeded = seedFromLineItems(Array.isArray(li) ? li : []);
        setLines(seeded);
        setSeeding(seeded.length > 0);
        setDirty(seeded.length > 0);
      }
    } catch (e) {
      setErr('Load failed: ' + e.message);
    }
    setLoading(false);
  }, [job?.id, job?.job_number, coId]);

  useEffect(() => { loadLines(); }, [loadLines]);

  // Push a totals summary up to parent on any change (parent stashes for
  // Phase C calc engine consumption).
  const summary = useMemo(() => {
    const visible = lines.filter(l => !l._deleted);
    const totalExtended = visible.reduce(
      (s, l) => s + (Number(l.qty) || 0) * (Number(l.price_per_unit) || 0),
      0
    );
    const categoriesPresent = Array.from(new Set(visible.map(l => l.category)));
    return { count: visible.length, totalExtended, categoriesPresent };
  }, [lines]);

  useEffect(() => { if (typeof onChange === 'function') onChange(summary); }, [summary, onChange]);

  // ─── Per-row mutation ───────────────────────────────────────────────
  const updateLine = (idx, key, val) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, [key]: val, _touched: true };
      // Clear seeded banner once the user touches anything — they've reviewed it.
      if (l._seeded) next._seeded_acknowledged = true;

      // Snap defaults when category changes
      if (key === 'category') {
        const cat = CATEGORIES.find(c => c.key === val);
        if (cat) next.unit = cat.defaultUnit;
        if (val !== 'precast' && val !== 'sw') {
          next.height = null;
          next.style = null;
        }
        // Recompute split for new category if price is present
        const split = derivePriceSplit({ price: next.price_per_unit, category: val, height: next.height, style: next.style });
        if (split.derived) {
          next.labor_per_unit = split.labor_per_unit;
          next.tax_basis_per_unit = split.tax_basis_per_unit;
          next._taxBasisManual = false;
        }
      }

      // When height or style changes for precast, re-derive tax basis
      // unless the user has manually overridden it.
      if ((key === 'height' || key === 'style') && next.category === 'precast' && !next._taxBasisManual) {
        const basis = deriveTaxBasis({ category: 'precast', height: next.height, style: next.style });
        if (basis != null) {
          next.tax_basis_per_unit = basis;
          if (Number(next.price_per_unit) > 0) {
            next.labor_per_unit = Math.round((Number(next.price_per_unit) - basis) * 100) / 100;
          }
        }
      }

      // When price changes and tax_basis is auto-derived, recompute labor.
      if (key === 'price_per_unit' && !next._taxBasisManual && next.tax_basis_per_unit != null) {
        if (Number(val) > 0) {
          next.labor_per_unit = Math.round((Number(val) - Number(next.tax_basis_per_unit)) * 100) / 100;
        }
      }

      // User typed into tax_basis directly → flag as manual override.
      if (key === 'tax_basis_per_unit') {
        next._taxBasisManual = true;
      }

      return next;
    }));
    setDirty(true);
  };

  const addLine = (category) => {
    const cat = CATEGORIES.find(c => c.key === category) || CATEGORIES[0];
    setLines(prev => {
      const nextNum = (prev.filter(l => !l._deleted).reduce((m, l) => Math.max(m, l.line_number || 0), 0)) + 1;
      return [...prev, {
        _new: true,
        _touched: true,
        line_number: nextNum,
        category: cat.key,
        label: '',
        fence_type: null,
        height: null,
        style: null,
        qty: 0,
        unit: cat.defaultUnit,
        price_per_unit: null,
        labor_per_unit: null,
        tax_basis_per_unit: null,
        tax_exempt: cat.key === 'permit' || cat.key === 'bond',
        _taxBasisManual: false,
      }];
    });
    setDirty(true);
  };

  const removeLine = (idx) => {
    const l = lines[idx];
    if (l._new) {
      // never persisted — drop locally
      setLines(prev => prev.filter((_, i) => i !== idx));
    } else {
      setLines(prev => prev.map((x, i) => i === idx ? { ...x, _deleted: true } : x));
    }
    setDirty(true);
    setConfirmDel(null);
  };

  // ─── Save ───────────────────────────────────────────────────────────
  const validate = () => {
    const visible = lines.filter(l => !l._deleted);
    for (const l of visible) {
      if (!l.category) return `Line ${l.line_number}: Category is required`;
      if (!l.label || !String(l.label).trim()) return `Line ${l.line_number}: Label is required`;
      if (Number(l.qty) < 0) return `Line ${l.line_number}: Quantity cannot be negative`;
      if (l.price_per_unit != null && Number(l.price_per_unit) < 0) {
        return `Line ${l.line_number}: Price cannot be negative`;
      }
    }
    return null;
  };

  const stripUiFields = (l) => {
    const {
      _new, _existing, _touched, _deleted, _seeded, _seeded_acknowledged,
      _seed_source, _taxBasisManual, ...clean
    } = l;
    // Coerce numeric strings → numbers for PG
    const toNum = (v) => v === '' || v == null ? null : Number(v);
    return {
      ...clean,
      qty: toNum(clean.qty) ?? 0,
      price_per_unit: toNum(clean.price_per_unit),
      labor_per_unit: toNum(clean.labor_per_unit),
      tax_basis_per_unit: toNum(clean.tax_basis_per_unit),
    };
  };

  const saveAll = useCallback(async () => {
    const validationErr = validate();
    if (validationErr) { setErr(validationErr); throw new Error(validationErr); }
    setSaving(true); setErr(null);
    try {
      // DELETEs first (so line_number conflicts don't hit a UNIQUE).
      const toDelete = lines.filter(l => l._deleted && l._existing && l.id);
      for (const l of toDelete) {
        await sbDel('job_pricing_lines', l.id);
      }

      // INSERTs
      const toInsert = lines.filter(l => l._new && !l._deleted).map(l => {
        const clean = stripUiFields(l);
        return {
          ...clean,
          job_id: job.id,
          co_id: coId || null,
        };
      });
      if (toInsert.length > 0) {
        await sbPost('job_pricing_lines', toInsert, { throwOnError: true });
      }

      // UPDATEs
      const toUpdate = lines.filter(l => l._existing && l._touched && !l._deleted && !l._new && l.id);
      for (const l of toUpdate) {
        const clean = stripUiFields(l);
        // Don't PATCH FK / immutable fields
        delete clean.id;
        delete clean.job_id;
        delete clean.co_id;
        delete clean.created_at;
        delete clean.extended_total;  // trigger-maintained
        await sbPatch('job_pricing_lines', l.id, clean);
      }

      await loadLines();
      setToast('Pricing saved.');
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setErr('Save failed: ' + (e.message || String(e)));
      setSaving(false);
      throw e;
    }
    setSaving(false);
  }, [lines, job?.id, coId, loadLines]);

  // ─── registerSave hook for parent EditPanel handleSave ───────────────
  const saveAllRef = useRef(null);
  saveAllRef.current = saveAll;
  useEffect(() => {
    if (typeof registerSave !== 'function') return undefined;
    registerSave(async () => {
      if (dirty && saveAllRef.current) await saveAllRef.current();
    });
    return () => { registerSave(null); };
  }, [dirty, registerSave]);

  // ─── Render ─────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 24, color: COLOR.text3, fontSize: 12 }}>Loading pricing…</div>;
  }

  const visibleLines = lines.filter(l => !l._deleted);
  const seedingActive = seeding && visibleLines.some(l => l._seeded && !l._seeded_acknowledged);

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: COLOR.text }}>Pricing Book</div>
          <div style={{ fontSize: 11, color: COLOR.text2, marginTop: 2, maxWidth: 560, lineHeight: 1.5 }}>
            Per-unit prices for everything billable on this job — each row decomposes into labor + tax basis so the Acct Sheet can apply per-stage weights and sales tax correctly. Decoupled from Line Items by design.
          </div>
        </div>
        <button
          onClick={() => saveAll().catch(() => { /* error already surfaced */ })}
          disabled={!dirty || saving || !canEdit}
          style={{
            ...btnP,
            padding: '6px 14px',
            fontSize: 12,
            opacity: (!dirty || saving || !canEdit) ? 0.5 : 1,
            cursor: (!dirty || saving || !canEdit) ? 'not-allowed' : 'pointer',
          }}>
          {saving ? 'Saving…' : dirty ? '💾 Save Pricing' : 'Save Pricing'}
        </button>
      </div>

      {/* Seed banner */}
      {seedingActive && <div style={{
        marginBottom: 12,
        padding: '10px 14px',
        background: COLOR.warnBg,
        border: `1px solid ${COLOR.warn}`,
        borderRadius: RADIUS.lg,
        fontSize: 12,
        color: '#92400E',
        lineHeight: 1.5,
      }}>
        🌱 <b>Generated {visibleLines.filter(l => l._seeded).length} pricing row{visibleLines.filter(l => l._seeded).length === 1 ? '' : 's'} from line items.</b> Tax basis values for precast heights auto-filled from the standard lookup. Review the rates and tax_basis splits, then click <b>Save Pricing</b> to commit.
      </div>}

      {/* Error / toast */}
      {err && <div style={{ marginBottom: 10, padding: '8px 12px', background: COLOR.dangerBg, color: COLOR.danger, borderRadius: RADIUS.md, fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>⚠ {err}</span>
        <button onClick={() => setErr(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>×</button>
      </div>}
      {toast && <div style={{ marginBottom: 10, padding: '8px 12px', background: COLOR.successBg, color: COLOR.success, borderRadius: RADIUS.md, fontSize: 12, fontWeight: 600 }}>
        {toast}
      </div>}

      {/* Pricing table */}
      <div style={{
        background: COLOR.white,
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS.lg,
        overflow: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: COLOR.page, borderBottom: `1px solid ${COLOR.border}` }}>
              {['#', 'Category', 'Label', 'Height', 'Style', 'Qty', 'Unit', 'Price/Unit', 'Labor/Unit', 'Tax Basis/Unit', 'Exempt', 'Extended', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 10px', textAlign: i === 11 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: COLOR.text2, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleLines.length === 0 && <tr>
              <td colSpan={13} style={{ padding: 20, textAlign: 'center', color: COLOR.text3, fontSize: 12, fontStyle: 'italic' }}>
                No pricing rows yet. Use the buttons below to add one.
              </td>
            </tr>}
            {visibleLines.map((l, idx) => {
              const isFenceCat = l.category === 'precast' || l.category === 'sw';
              const taxBasisAuto = l.category === 'precast' && !l._taxBasisManual && l.tax_basis_per_unit != null && HEIGHT_BASIS[String(l.height || '').replace(/['"]/g, '')] === Number(l.tax_basis_per_unit);
              const extended = (Number(l.qty) || 0) * (Number(l.price_per_unit) || 0);
              return (
                <tr key={l.id || `new-${idx}`} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                  <td style={{ padding: '6px 10px', color: COLOR.text3, fontFamily: 'Inter', fontSize: 11 }}>{l.line_number}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <select
                      value={l.category}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(idx, 'category', e.target.value)}
                      style={{ ...inputS, padding: '4px 8px', fontSize: 11, minWidth: 100 }}>
                      {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      value={l.label || ''}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(idx, 'label', e.target.value)}
                      placeholder="e.g. 6' pc"
                      style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 110 }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {isFenceCat ? (
                      <input
                        value={l.height || ''}
                        disabled={!canEdit}
                        onChange={(e) => updateLine(idx, 'height', e.target.value)}
                        placeholder="6"
                        style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 50 }}
                      />
                    ) : <span style={{ color: COLOR.text3, fontSize: 11 }}>—</span>}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {isFenceCat ? (
                      <input
                        value={l.style || ''}
                        disabled={!canEdit}
                        onChange={(e) => updateLine(idx, 'style', e.target.value)}
                        placeholder="Style"
                        style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 110 }}
                      />
                    ) : <span style={{ color: COLOR.text3, fontSize: 11 }}>—</span>}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="number"
                      value={l.qty ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                      style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 70, fontFamily: 'Inter', fontWeight: 600 }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <select
                      value={l.unit || 'LF'}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                      style={{ ...inputS, padding: '4px 8px', fontSize: 11 }}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 10px', minWidth: 100 }}>
                    <MoneyInput
                      value={l.price_per_unit ?? ''}
                      disabled={!canEdit}
                      onChange={(v) => updateLine(idx, 'price_per_unit', v)}
                      style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 90, fontFamily: 'Inter', fontWeight: 600 }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', minWidth: 100 }}>
                    <MoneyInput
                      value={l.labor_per_unit ?? ''}
                      disabled={!canEdit}
                      onChange={(v) => updateLine(idx, 'labor_per_unit', v)}
                      style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 90, fontFamily: 'Inter' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', minWidth: 110 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MoneyInput
                        value={l.tax_basis_per_unit ?? ''}
                        disabled={!canEdit}
                        onChange={(v) => updateLine(idx, 'tax_basis_per_unit', v)}
                        style={{ ...inputS, padding: '4px 8px', fontSize: 11, width: 80, fontFamily: 'Inter' }}
                      />
                      {taxBasisAuto && <span title="Auto-filled from HEIGHT_BASIS lookup. Type to override." style={{ padding: '1px 5px', borderRadius: RADIUS.pill, fontSize: 9, fontWeight: 700, background: COLOR.infoBg, color: COLOR.info }}>Auto</span>}
                    </div>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!!l.tax_exempt}
                      disabled={!canEdit}
                      onChange={(e) => updateLine(idx, 'tax_exempt', e.target.checked)}
                      style={{ width: 14, height: 14, accentColor: COLOR.brand }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 700, color: COLOR.text }}>
                    {extended > 0 ? '$' + extended.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                    {canEdit && (confirmDel === idx ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => removeLine(idx)} style={{ padding: '2px 8px', background: COLOR.danger, border: 'none', color: COLOR.white, borderRadius: RADIUS.sm, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                        <button onClick={() => setConfirmDel(null)} style={{ padding: '2px 8px', ...btnS, fontSize: 10 }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDel(idx)} style={{ background: 'none', border: `1px solid ${COLOR.border}`, color: COLOR.danger, borderRadius: RADIUS.sm, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>×</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: COLOR.page, borderTop: `2px solid ${COLOR.brand}` }}>
              <td colSpan={11} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, color: COLOR.text2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Total ({visibleLines.length} line{visibleLines.length === 1 ? '' : 's'})
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 900, fontSize: 14, color: COLOR.brand }}>
                ${summary.totalExtended.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add buttons */}
      {canEdit && <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => addLine(c.key)}
            style={{ ...btnS, padding: '6px 12px', fontSize: 11 }}>
            + {c.label}
          </button>
        ))}
      </div>}

      {/* Stage weights — collapsible per-job override panel */}
      <StageWeightsPanel
        jobId={job?.id}
        canEdit={canEdit}
        categoriesPresent={summary.categoriesPresent}
      />
    </div>
  );
}
