// Market data: codes, labels, palette, and the SharePoint URL parser.
// Extracted from App.jsx 2026-05-04 as Phase 2b of the App.jsx-decomposition
// rolling extraction. Same pattern as fmt.js — pure data + one pure function.
//
// We operate in 6 markets: 4 Texas metros (SA / HOU / AUS / DFW), College
// Station (CS, hybrid Houston/Austin coverage), and Out-of-State (OOS) for
// jobs outside the Texas footprint. Every market-aware surface in the app
// reads from these dicts: project list filter pills, EditPanel market
// dropdown, Project Map color modes, BY MARKET rollups, etc.
//
// MKT_PIN (the map-specific pastel pin palette) lives next to the Map page
// setup, not here — it's a separate visual treatment from the brand-aligned
// MC palette and only one surface uses it.

// Market codes — short, sort-stable order. Drives dropdowns + filter pills.
export const MKTS = ['SA', 'HOU', 'AUS', 'DFW', 'CS', 'OOS'];

// Code → full city name. Used in tooltips, EditPanel display, exports.
export const MARKET_FULL = {
  SA:  'San Antonio',
  HOU: 'Houston',
  AUS: 'Austin',
  DFW: 'Dallas-Fort Worth',
  CS:  'College Station',
  OOS: 'Out-of-State',
};

// Brand-aligned market palette (text/accent color). Each market gets a
// distinct hue so chips/pills are scannable. SA wears the brand red because
// it's HQ; the rest follow the broader brand secondary palette.
export const MC = {
  SA:  '#8A261D',
  HOU: '#0F6E56',
  AUS: '#854F0B',
  DFW: '#185FA5',
  CS:  '#7C3AED',
  OOS: '#6B7280',
};

// Market palette — fill/background variant (paired with MC for text).
export const MB = {
  SA:  '#FDF4F4',
  HOU: '#E1F5EE',
  AUS: '#FAEEDA',
  DFW: '#E6F1FB',
  CS:  '#EDE9FE',
  OOS: '#F3F4F6',
};

// Code → short label. Identical to the keys today, but kept as a separate
// dict so labels can diverge from codes if a market gets a new short alias
// (e.g. "DFW" → "DAL") without a global find/replace.
export const MS = {
  SA:  'SA',
  HOU: 'HOU',
  AUS: 'AUS',
  DFW: 'DFW',
  CS:  'CS',
  OOS: 'OOS',
};

// Long → short. The reverse of MARKET_FULL — used when joining tables that
// store the long-form market name (notably crew_leaders.market) against
// jobs.market which uses short codes. Derived from MARKET_FULL so the two
// stay in lockstep automatically.
//
// Includes 'Out-of-State' → 'OOS' for completeness. Earlier inline copies
// of this dict in App.jsx omitted OOS, which silently dropped any OOS
// crew leader from market rollups. Today there are no such leaders, but
// if one is ever added they'll now be counted (correct behavior).
export const MKT_LONG_TO_SHORT = Object.fromEntries(
  Object.entries(MARKET_FULL).map(([short, long]) => [long, short]),
);

// Short → long. Alias of MARKET_FULL exported under the legacy name used
// at App.jsx call sites (saves us from renaming ~5 references). Same data,
// same shape — pick whichever name reads better at the call site.
export const SHORT_TO_LONG = MARKET_FULL;

// Markets where Fencecrete uses subcontractor crews instead of in-house
// crew leaders. DFW + AUS + CS all default to the San Antonio crew pool
// when subs aren't available; PMs are warned via banner. Used in:
//   - CrewLeaderAssignmentPage (drives the "subs+SA pool" badge)
//   - CoPilotHome plant-load (uses_subs flag on crewLoadByMarket rows)
export const SUB_MARKETS = new Set(['DFW', 'AUS', 'CS']);

// Single-character market code used in job_number generation:
// "26S001" = 2026, San Antonio, sequence 001. CS uses 2 chars because no
// single letter was available without colliding with other markets.
export const MKT_CODE = {
  SA:  'S',
  HOU: 'H',
  AUS: 'A',
  DFW: 'D',
  CS:  'CS',
  OOS: 'O',
};

// Parses a SharePoint Active Jobs URL into a "Open: <Market> / <Folder>"
// label for the Open-in-SharePoint button tooltip. Falls back to a generic
// "Open in SharePoint" label if the URL doesn't match the expected
// /Active%20Jobs/<market>/<folder> shape.
export const getSharePointTooltip = (url) => {
  if (!url) return 'Open in SharePoint';
  try {
    const m = url.match(/Active%20Jobs\/([^/]+)\/(.+?)(?:\?|$)/);
    if (!m) return 'Open in SharePoint';
    return `Open: ${decodeURIComponent(m[1])} / ${decodeURIComponent(m[2])}`;
  } catch {
    return 'Open in SharePoint';
  }
};
