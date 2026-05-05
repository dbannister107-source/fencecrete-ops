// Tax-basis lookups for the Acct Sheet / Billing Engine.
//
// Single source of truth — extracted from inline App.jsx literals on
// 2026-05-05 (Phase B of the billing-engine build) so the Pricing
// editor, the EditPanel sales-tax memo, and the Phase C calc engine
// all agree.
//
// The Excel "Original Contract Amounts" section encodes a price split
// for every taxable line: total $/LF = labor + tax_basis. Sales tax
// is computed on the tax_basis portion only (8.25% in Texas). The
// HEIGHT_BASIS / STYLE_BASIS dicts capture that decomposition.
//
// 8' pc is the historical tax-exempt height (R15 in the Excel) — its
// labor exceeds the standard tax basis. The basis lookup still returns
// the value (29.25); per-line `tax_exempt=true` on the pricing row is
// what zeroes the tax for that line.
//
// Numbers below are mirror-for-mirror with the legacy Excel and were
// verified against the HEB Madera Run sample on 2026-05-05.

// $/LF tax-basis by precast height (text key — '4' through '10').
export const HEIGHT_BASIS = {
  '4':  23.00,
  '5':  24.75,
  '6':  26.00,
  '7':  27.50,
  '8':  29.25,
  '9':  30.50,
  '10': 31.75,
};

// Style-specific tax-basis for non-height-driven precast variants
// (Ranch Rail). Wins over HEIGHT_BASIS when the style matches.
export const STYLE_BASIS = {
  'Ranch - 2 Rail': 13.50,
  'Ranch - 3 Rail': 15.75,
  'Ranch - 4 Rail': 16.50,
};

// Texas state sales tax. Hard-coded — when this changes, change here only.
export const TAX_RATE = 0.0825;

// Wrought-iron gate labor fraction. Excel R21 / R23 derive labor as
// `ROUND(price × 0.66, 2)` and tax_basis as `price - labor`. Used by the
// Pricing editor's auto-seed for wi_gate rows.
export const WI_LABOR_FRAC = 0.66;

// Returns the right tax-basis $/LF for a (category, height, style),
// or null when none is derivable. Style wins over height (Ranch Rail
// has its own basis regardless of height).
//
// Inputs:
//   category — 'precast', 'sw', 'wi_gate', 'option', 'permit', 'bond', 'other'
//   height   — '4'..'10' (text or number, normalized internally)
//   style    — canonical style string (optional)
export function deriveTaxBasis({ category, height, style } = {}) {
  if (category !== 'precast') return null;
  const styleKey = (style || '').trim();
  if (styleKey && STYLE_BASIS[styleKey] != null) return STYLE_BASIS[styleKey];
  const heightKey = String(height ?? '').replace(/['"]/g, '').trim();
  if (heightKey && HEIGHT_BASIS[heightKey] != null) return HEIGHT_BASIS[heightKey];
  return null;
}

// Splits a total price into (labor, tax_basis) for a (category, height,
// style). Returns { labor_per_unit, tax_basis_per_unit, derived } where
// `derived` is true iff we had enough info to compute the split, false
// when the user must enter labor + tax_basis manually.
//
// Categories handled:
//   precast       → tax_basis from HEIGHT_BASIS/STYLE_BASIS, labor = price - tax_basis
//   wi_gate       → labor = price × 0.66 (rounded), tax_basis = price - labor
//   permit/bond   → labor = price, tax_basis = 0 (non-taxable)
//   option/other  → no derivation; manual entry
//   sw            → no derivation; SW pricing varies too much to preset
export function derivePriceSplit({ price, category, height, style } = {}) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) {
    return { labor_per_unit: null, tax_basis_per_unit: null, derived: false };
  }
  if (category === 'precast') {
    const basis = deriveTaxBasis({ category, height, style });
    if (basis == null) return { labor_per_unit: null, tax_basis_per_unit: null, derived: false };
    const labor = Math.round((p - basis) * 100) / 100;
    return { labor_per_unit: labor, tax_basis_per_unit: basis, derived: true };
  }
  if (category === 'wi_gate') {
    const labor = Math.round(p * WI_LABOR_FRAC * 100) / 100;
    return { labor_per_unit: labor, tax_basis_per_unit: Math.round((p - labor) * 100) / 100, derived: true };
  }
  if (category === 'permit' || category === 'bond') {
    return { labor_per_unit: p, tax_basis_per_unit: 0, derived: true };
  }
  // option / other / sw — manual entry
  return { labor_per_unit: null, tax_basis_per_unit: null, derived: false };
}
