// StageWeightsPanel — collapsible per-job override editor for billing
// stage weights. Reads `v_effective_stage_weights` (resolved view that
// returns override-then-default for every job × category × stage_key);
// writes `job_stage_weights` (sparse override table).
//
// Lives inside JobPricingEditor below the pricing table. Renders one card
// per category present in the job's pricing rows. Most jobs use the
// universal defaults (precast 65/20/15, SW 25/30/42/3, gates 100%) and
// will see "Default" badges everywhere; the panel exists for the rare
// job whose contract recognizes milestones differently.
//
// Server-side validation: the AFTER STATEMENT trigger trg_jsw_validate_sum
// rejects override sets summing outside [0.99, 1.01]. We mirror that
// client-side so the user sees a red sum indicator before they hit Save.
//
// Save flow per category: DELETE existing override rows, then bulk INSERT
// new ones in a single VALUES tuple — STATEMENT-level trigger fires once
// after both statements. "Reset to defaults" is just the DELETE.

import React, { useEffect, useState, useCallback } from 'react';
import { sbGet, sbDelWhere, sbPost } from '../../shared/sb';
import { COLOR, RADIUS, btnP, btnS, inputS } from '../../shared/ui';

const CATEGORY_LABELS = {
  precast: 'Precast',
  sw:      'Single Wythe',
  wi_gate: 'WI Gates',
  option:  'Options',
  permit:  'Permits',
  bond:    'Bonds',
  other:   'Other',
};

// Tolerance band for client-side sum check (mirrors the server trigger).
const TOL_LO = 0.99;
const TOL_HI = 1.01;

export default function StageWeightsPanel({ jobId, canEdit, categoriesPresent }) {
  const [rows, setRows] = useState([]);          // v_effective_stage_weights rows for this job
  const [loading, setLoading] = useState(true);
  const [editingCat, setEditingCat] = useState(null);   // category being edited (null = none)
  const [draft, setDraft] = useState({});               // {stage_key: weight} during edit
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [collapsed, setCollapsed] = useState(true);     // default closed

  // Refresh the resolved view from the server.
  const load = useCallback(async () => {
    if (!jobId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await sbGet(
        'v_effective_stage_weights',
        `job_id=eq.${jobId}&order=category.asc,display_order.asc`
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr('Load failed: ' + e.message);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  // If no overrides exist anywhere, default to collapsed; otherwise auto-expand
  // so the user notices the non-default state on open.
  useEffect(() => {
    if (rows.some(r => r.is_overridden)) setCollapsed(false);
  }, [rows]);

  // Filter to categories that have at least one pricing row in the parent.
  // If categoriesPresent is undefined/empty, show everything (defensive default).
  const visibleCategories = (categoriesPresent && categoriesPresent.length > 0)
    ? Array.from(new Set(categoriesPresent))
    : Array.from(new Set(rows.map(r => r.category)));

  const startEdit = (category) => {
    const seed = {};
    rows.filter(r => r.category === category).forEach(r => {
      seed[r.stage_key] = String(r.weight ?? '');
    });
    setDraft(seed);
    setEditingCat(category);
    setErr(null);
  };

  const cancelEdit = () => {
    setEditingCat(null);
    setDraft({});
    setErr(null);
  };

  const draftSum = (d) => Object.values(d).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  const saveCategory = async (category) => {
    const sum = draftSum(draft);
    if (sum < TOL_LO || sum > TOL_HI) {
      setErr(`Weights must sum to 1.00 (±0.01). Current sum: ${sum.toFixed(4)}`);
      return;
    }
    setSaving(true); setErr(null);
    try {
      // Delete existing overrides for (job_id, category) — clears the slate
      // so the bulk INSERT below is the canonical override set.
      await sbDelWhere('job_stage_weights', `job_id=eq.${jobId}&category=eq.${category}`);

      // Bulk insert all stages in one POST so the AFTER STATEMENT trigger
      // fires once after all rows are present (vs. per-row firing where
      // intermediate sums would fail validation).
      const newRows = Object.entries(draft)
        .filter(([, v]) => v !== '' && v != null)
        .map(([stage_key, weight]) => ({
          job_id: jobId,
          category,
          stage_key,
          weight: parseFloat(weight),
        }));
      if (newRows.length > 0) {
        await sbPost('job_stage_weights', newRows, { throwOnError: true });
      }

      await load();
      setEditingCat(null);
      setDraft({});
    } catch (e) {
      setErr('Save failed: ' + (e.message || String(e)));
    }
    setSaving(false);
  };

  const resetCategory = async (category) => {
    if (!window.confirm(`Reset stage weights for ${CATEGORY_LABELS[category] || category} to defaults?`)) return;
    setSaving(true); setErr(null);
    try {
      await sbDelWhere('job_stage_weights', `job_id=eq.${jobId}&category=eq.${category}`);
      await load();
    } catch (e) {
      setErr('Reset failed: ' + (e.message || String(e)));
    }
    setSaving(false);
  };

  if (loading) {
    return <div style={{ padding: 12, fontSize: 11, color: COLOR.text3 }}>Loading stage weights…</div>;
  }

  // Header bar with collapse toggle + summary count.
  const overrideCount = visibleCategories.filter(cat =>
    rows.some(r => r.category === cat && r.is_overridden)
  ).length;

  return (
    <div style={{
      marginTop: 16,
      border: `1px solid ${COLOR.border}`,
      borderRadius: RADIUS.lg,
      background: COLOR.page,
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          fontWeight: 700,
          color: COLOR.text2,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
        <span>{collapsed ? '▸' : '▾'} Stage Weights</span>
        <span style={{ fontSize: 10, color: COLOR.text3, fontWeight: 600, textTransform: 'none' }}>
          {overrideCount > 0 ? `${overrideCount} category override${overrideCount === 1 ? '' : 's'}` : 'all using defaults'}
        </span>
      </button>

      {!collapsed && <div style={{ padding: '0 14px 14px' }}>
        <div style={{ fontSize: 11, color: COLOR.text2, marginBottom: 12, lineHeight: 1.5 }}>
          Each category bills its scope across these stages. Defaults are universal across all jobs;
          override only when this contract recognizes milestones differently. Weights for a category
          must sum to 1.00.
        </div>

        {err && <div style={{ marginBottom: 10, padding: '6px 10px', background: COLOR.dangerBg, color: COLOR.danger, borderRadius: RADIUS.md, fontSize: 11, fontWeight: 600 }}>
          {err}
        </div>}

        {visibleCategories.length === 0 && <div style={{ fontSize: 11, color: COLOR.text3, fontStyle: 'italic' }}>
          No pricing categories on this job yet. Add a pricing line above to see its stage weights.
        </div>}

        {visibleCategories.map(cat => {
          const catRows = rows.filter(r => r.category === cat);
          if (catRows.length === 0) return null;
          const isEditing = editingCat === cat;
          const isOverridden = catRows.some(r => r.is_overridden);
          const sum = isEditing ? draftSum(draft) : catRows.reduce((s, r) => s + Number(r.weight || 0), 0);
          const sumOk = sum >= TOL_LO && sum <= TOL_HI;

          return (
            <div key={cat} style={{
              marginBottom: 10,
              padding: 12,
              background: COLOR.white,
              border: `1px solid ${isOverridden ? COLOR.warn : COLOR.border}`,
              borderRadius: RADIUS.lg,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: COLOR.text }}>
                    {CATEGORY_LABELS[cat] || cat}
                  </span>
                  {isOverridden && <span style={{
                    padding: '2px 8px',
                    borderRadius: RADIUS.pill,
                    fontSize: 9,
                    fontWeight: 700,
                    background: COLOR.warnBg,
                    color: COLOR.warn,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}>Custom</span>}
                </div>
                {!isEditing && canEdit && <div style={{ display: 'flex', gap: 6 }}>
                  {isOverridden && <button
                    onClick={() => resetCategory(cat)}
                    disabled={saving}
                    style={{ ...btnS, padding: '4px 10px', fontSize: 10 }}>
                    Reset to defaults
                  </button>}
                  <button
                    onClick={() => startEdit(cat)}
                    disabled={saving}
                    style={{ ...btnS, padding: '4px 10px', fontSize: 10 }}>
                    {isOverridden ? 'Edit' : 'Override'}
                  </button>
                </div>}
                {isEditing && <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={cancelEdit} disabled={saving} style={{ ...btnS, padding: '4px 10px', fontSize: 10 }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => saveCategory(cat)}
                    disabled={saving || !sumOk}
                    style={{ ...btnP, padding: '4px 10px', fontSize: 10, opacity: saving || !sumOk ? 0.5 : 1 }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                {catRows.map(r => (
                  <div key={r.stage_key} style={{
                    padding: 8,
                    background: COLOR.page,
                    borderRadius: RADIUS.md,
                    border: `1px solid ${COLOR.border}`,
                  }}>
                    <div style={{ fontSize: 10, color: COLOR.text2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                      {r.stage_label}
                    </div>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={draft[r.stage_key] ?? ''}
                        onChange={(e) => setDraft(d => ({ ...d, [r.stage_key]: e.target.value }))}
                        style={{ ...inputS, width: '100%', fontWeight: 700, fontSize: 13 }}
                      />
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 800, color: COLOR.text, fontFamily: 'Inter' }}>
                        {(Number(r.weight) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{
                marginTop: 8,
                fontSize: 11,
                fontWeight: 700,
                color: sumOk ? COLOR.success : COLOR.danger,
                textAlign: 'right',
              }}>
                Sum: {(sum * 100).toFixed(1)}% {!sumOk && '(must equal 100%)'}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}
