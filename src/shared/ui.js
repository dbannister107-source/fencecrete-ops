// Design tokens + composed style objects for the OPS app.
//
// Two layers:
//   1. TOKENS (COLOR, FONT, RADIUS, SHADOW) -- primitive design values.
//      Reference these from any file when you need a color, radius, or
//      shadow -- avoids drift on hex codes and pixel values.
//   2. STYLE OBJECTS (card, btnP, btnS, btnG, btnB, inputS, stat,
//      statLabel, statValue) -- the canonical inline-style shapes that
//      had organically settled in newer feature files.
//
// The style objects use the "feature default" sizing (8px/14px padding,
// fontSize 12, fontWeight 700) -- matches the newer design direction.
// Files using older / variant sizes (App.jsx module scope, SystemEvents,
// SharePointLinks, MyPlate, etc.) keep their local definitions for now;
// migrating them is a separate visual-design decision.

// ─── Color tokens ───
// Brand palette per CLAUDE.md (Pantone 7620C / 7531C primaries).
export const COLOR = {
  // Brand
  brand:     '#8A261D',  // primary red, Pantone 7620C
  brandBg:   '#FDF4F4',  // pale red wash for tags / hover

  // Text
  text:      '#1A1A1A',
  text2:     '#625650',  // secondary, Pantone 7531C
  text3:     '#9E9B96',  // muted / metadata

  // Surface
  white:     '#FFFFFF',
  page:      '#F9F8F6',  // page background
  bgSoft:    '#F4F4F2',  // panel / button-secondary background
  border:    '#E5E3E0',
  borderDk:  '#C8C4BD',  // emphasized divider

  // Semantic
  success:   '#065F46',  // green
  successBg: '#D1FAE5',
  info:      '#1D4ED8',  // blue
  infoBg:    '#DBEAFE',
  warn:      '#B45309',  // amber
  warnBg:    '#FEF3C7',
  danger:    '#DC2626',  // red
  dangerBg:  '#FEE2E2',
};

// ─── Typography tokens ───
export const FONT = {
  display: 'Syne, sans-serif',                            // headings, 800 weight
  body:    "Inter, 'Helvetica Neue', Arial, sans-serif",  // body text
  data:    "Inter, 'Helvetica Neue', Arial, sans-serif",  // numbers / data
};

// ─── Radius tokens ───
export const RADIUS = {
  sm:    4,
  md:    6,
  lg:    8,
  xl:    10,
  '2xl': 12,
  pill:  999,
};

// ─── Shadow tokens ───
export const SHADOW = {
  card:  '0 1px 3px rgba(0,0,0,0.08)',
  hover: '0 4px 12px rgba(0,0,0,0.10)',
  modal: '0 20px 50px rgba(0,0,0,0.25)',
};

// ─── Composed style objects ───
// The "feature default" sizing pattern.

export const card = {
  background: COLOR.white,
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS['2xl'],
  padding: 20,
  boxShadow: SHADOW.card,
};

// Primary action button (red)
export const btnP = {
  padding: '8px 14px',
  background: COLOR.brand,
  border: 'none',
  borderRadius: RADIUS.lg,
  color: COLOR.white,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 12,
};

// Secondary action button (gray)
export const btnS = {
  padding: '8px 14px',
  background: COLOR.bgSoft,
  color: COLOR.text2,
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS.lg,
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
};

// Small green ("approve / confirm") button
export const btnG = {
  padding: '6px 10px',
  background: COLOR.success,
  border: 'none',
  borderRadius: RADIUS.md,
  color: COLOR.white,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 11,
};

// Small blue ("informational") button
export const btnB = {
  padding: '6px 10px',
  background: COLOR.info,
  border: 'none',
  borderRadius: RADIUS.md,
  color: COLOR.white,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 11,
};

// Small input
export const inputS = {
  padding: '6px 10px',
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS.md,
  fontSize: 12,
  fontFamily: 'inherit',
  background: COLOR.white,
};

// Stat card surface (used in dashboards / customer master)
export const stat = {
  padding: 16,
  background: COLOR.page,
  border: `1px solid ${COLOR.border}`,
  borderRadius: RADIUS.xl,
};

export const statLabel = {
  fontSize: 10,
  fontWeight: 700,
  color: COLOR.text2,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

export const statValue = {
  fontSize: 24,
  fontWeight: 900,
  color: COLOR.text,
  fontFamily: FONT.data,
  marginTop: 4,
};
