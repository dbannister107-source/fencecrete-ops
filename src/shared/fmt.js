// Formatting + display helpers. Extracted from App.jsx 2026-05-04 as Phase 2
// of the App.jsx-decomposition rolling extraction.
//
// These are the most-used helpers in the entire app:
//   n   — 751 call sites (Number coerce, NaN-safe)
//   $   — 142 call sites (money, no decimals)
//   $k  —  93 call sites (money, abbreviated K/M)
//   fD  —  55 call sites (date formatter, DST-safe for DATE columns)
//   fmtPct / relT / downloadCSV / formatDateOnly — 27 combined
//
// Pure functions, no React, no DOM dependencies (except downloadCSV which
// builds a Blob and triggers a browser download — wrapped in feature checks
// so it no-ops gracefully in non-browser contexts like SSR or tests).

// Money, no decimals: $51,250
export const $ = (v) =>
  '$' + (Number(v) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

// Money abbreviated: $1.2M / $51K / $250
export const $k = (v) => {
  const x = Number(v) || 0;
  return x >= 1e6
    ? '$' + (x / 1e6).toFixed(1) + 'M'
    : x >= 1e3
    ? '$' + (x / 1e3).toFixed(0) + 'K'
    : '$' + x;
};

// NaN-safe Number coerce. n(undefined) = 0, n('abc') = 0, n('5.2') = 5.2.
export const n = (v) => Number(v) || 0;

// Percent formatter. fmtPct(0.123) = '12.3%'. Returns '—' for null/undefined
// (but NOT for 0 — explicit zero is rendered as '0.0%').
export const fmtPct = (v) => (!v && v !== 0 ? '—' : `${(parseFloat(v) * 100).toFixed(1)}%`);

// DATE-column–aware date formatter.
//
// Bare 'YYYY-MM-DD' (Postgres DATE column) is interpreted as midnight UTC by
// JavaScript, which renders one day earlier in negative-UTC-offset timezones
// (e.g. Central). This forces noon-local for date-only strings; anything else
// (Date object, ISO with time, timestamptz string) passes through unchanged.
//
// Use this for any DATE column display. Use the underlying
// `dt.toLocaleDateString` directly only when you control the input timezone.
export const formatDateOnly = (
  d,
  opts = { month: 'short', day: 'numeric', year: '2-digit' },
) => {
  if (d == null || d === '') return '—';
  const s = typeof d === 'string' ? d : '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', opts);
};

// Short alias — `fD(d)` is shorter at 55 call sites than `formatDateOnly(d)`.
export const fD = (d) => formatDateOnly(d);

// Relative time: "5m ago", "3h ago", "Yesterday", "4d ago", or fD(d) past 7 days.
// Used for last-modified timestamps, recent-activity feeds, etc.
export const relT = (d) => {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const m = ms / 60000;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const dy = h / 24;
  if (dy < 2) return 'Yesterday';
  if (dy < 7) return `${Math.floor(dy)}d ago`;
  return fD(d);
};

// Trigger a CSV download from an array of plain objects. Column order is
// taken from the first row's keys. Values are CSV-escaped (quotes, commas,
// newlines all handled).
//
// Browser-only — in SSR/test contexts, returns silently without doing
// anything (URL.createObjectURL would throw).
export const downloadCSV = (filename, rows) => {
  if (!rows || rows.length === 0) return;
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
