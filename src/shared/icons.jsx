// Sidebar / nav icon dictionary + <Icon /> component. Extracted from App.jsx
// 2026-05-04 as the third chip in the App.jsx-decomposition rolling extraction
// (Phase 1 commit 3 of 3).
//
// All SVGs are 16×16, stroke-currentColor, stroke-width 1.5, line-cap round.
// `currentColor` makes them inherit the surrounding text color, so the same
// SVG renders white when the row is active and muted-cream when it's not —
// the parent <span style={{color}}> handles the swap.
//
// Why dangerouslySetInnerHTML over JSX-expressed SVG?
//   The dict was originally inline in App.jsx as a single 26k-character object
//   literal. JSX would have ballooned the line count by ~10×. Strings are
//   concise and the source is fully under our control (no untrusted input).
//
// Adding a new icon: paste the full <svg>...</svg> string into ICONS keyed
// by the nav-item key. NAV_GROUPS items in src/shared/nav.js use these keys
// in their `key` property; missing-key items render a 16x16 transparent
// spacer (so the row layout stays aligned).

import React from 'react';

export const ICONS = {
  dashboard: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>',
  projects: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="3" width="14" height="11" rx="1.5"/><path d="M5 3V1.5M11 3V1.5M1 7h14"/></svg>',
  production: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="4" width="4" height="9" rx="1"/><rect x="6" y="2" width="4" height="11" rx="1"/><rect x="11" y="6" width="4" height="7" rx="1"/></svg>',
  production_planning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>',
  material_calc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 5h6M5 8h6M5 11h4"/></svg>',
  daily_report: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 2h12v12H2zM2 6h12M6 2v12"/></svg>',
  billing: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M1 7h14"/></svg>',
  pm_billing: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1v14M4 5h6a2 2 0 010 4H6a2 2 0 000 4h6"/></svg>',
  reports: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12l3-4 3 2 3-5 3 3"/><rect x="1" y="1" width="14" height="14" rx="1.5"/></svg>',
  schedule: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="3" width="14" height="11" rx="1.5"/><path d="M5 3V1.5M11 3V1.5M1 7h14M5 10h2M9 10h2"/></svg>',
  weather_days: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="7" r="3"/><path d="M8 1v1.5M8 11.5V13M2.5 7H1M15 7h-1.5M4.4 4.4l-1-1M12.6 4.4l1-1M4 12a4 4 0 018 0"/></svg>',
  change_orders: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h8M2 12h5"/><path d="M11 10l2 2 2-2M13 12V8"/></svg>',
  pm_daily_report: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M5 6h6M5 9h6M5 12h3"/></svg>',
  install_schedule: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="3" width="14" height="11" rx="1.5"/><path d="M5 3V1.5M11 3V1.5M1 7h14M4 10l2 2 4-4"/></svg>',
  sales_dashboard: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 11l4-5 3 3 3-5 4 4"/></svg>',
  prospecting: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4"/></svg>',
  pipeline: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5l7 4 7-4"/><path d="M1 9l7 4 7-4"/></svg>',
  proposals: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M5 5h6M5 8h6M5 11h4"/></svg>',
  contacts: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/></svg>',
  tasks: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 7l2 2 4-4"/><path d="M5 11h6"/></svg>',
  estimating: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M6 8h4M8 6v4"/></svg>',
  map: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 2L1 4v10l5-2 4 2 5-2V2l-5 2-4-2zM6 2v10M10 4v10"/></svg>',
  import_projects: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1v9M4 6l4 4 4-4M2 13h12"/></svg>',
  bid_advisor: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5"/><rect x="4.5" y="3.5" width="7" height="2.5" rx="0.5"/><circle cx="5.3" cy="9" r="0.5"/><circle cx="8" cy="9" r="0.5"/><circle cx="10.7" cy="9" r="0.5"/><circle cx="5.3" cy="11.5" r="0.5"/><circle cx="8" cy="11.5" r="0.5"/><circle cx="10.7" cy="11.5" r="0.5"/></svg>',
  mold_inventory: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="14" height="3" rx="0.5"/><rect x="1" y="7" width="14" height="3" rx="0.5"/><rect x="1" y="11" width="14" height="3" rx="0.5"/><path d="M5 3v3M11 3v3M3 7v3M9 7v3M13 7v3M5 11v3M11 11v3"/></svg>',
  plant_maintenance: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 14h14"/><path d="M2 14V8l4 2V6l4 2V5l4 2v7"/><path d="M5 14v-2M9 14v-2M13 14v-2"/><path d="M11 2.5l1 1.5h-2z"/></svg>',
  fleet: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 11V5h7v6"/><path d="M8 7h4l2 2v2H8"/><circle cx="4" cy="12" r="1"/><circle cx="11.5" cy="12" r="1"/></svg>',
  fleet_wo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2a3 3 0 0 0-2.6 4.4L2 13.3 2.7 14l6.9-6.9A3 3 0 1 0 11.5 2z"/><circle cx="11.5" cy="5" r="1"/></svg>',
  my_plate: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3"/></svg>',
  proposal_validator: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5 8.5l2 2 4-4"/></svg>',
  proposal_triage: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1H2v6l7 7 6-6z"/><circle cx="5" cy="5" r="0.8"/></svg>',
  contracts_workbench: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2.5" width="10" height="12" rx="1.5"/><rect x="5.5" y="1" width="5" height="2.5" rx="0.5"/><path d="M5.5 9l1.7 1.7L11 7"/></svg>',
  specialty_visits: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1l-3 3 1.5 1.5L7 8l-1.5-1.5L1 11l2.5 2.5L8 9l1.5 1.5L12 8l1.5 1.5L15 8z"/></svg>',
  demand_planning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13l4-5 3 3 5-7"/><path d="M10 4h4v4"/></svg>',
  crew_assignment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5.5" r="2"/><circle cx="11.5" cy="6.5" r="1.5"/><path d="M2 13.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5"/><path d="M10 13.5c0-1.5 1-2.5 2.2-2.5s2.3 1 2.3 2.5"/></svg>',
  cv_reconciliation: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M3 5h10"/><path d="M5.5 5L3 10h5zM10.5 5L8 10h5z"/></svg>',
  admin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7.5" rx="1"/><path d="M5 7V4.5a3 3 0 016 0V7"/><circle cx="8" cy="10.5" r="0.7" fill="currentColor"/></svg>',
  sharepoint_links: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3"/><path d="M9 4l1.3-1.3a2.5 2.5 0 113.5 3.5L12.5 7.5"/><path d="M7 8.5L5.5 10a2.5 2.5 0 11-3.5-3.5L3.5 5"/></svg>',
  customer_master: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="0.5"/><path d="M5 5h2M9 5h2M5 8h2M9 8h2M5 11h2M9 11h2"/></svg>',
  crew_leaders_admin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="6" r="2.3"/><path d="M3 14c0-2.4 2.2-4.3 5-4.3s5 1.9 5 4.3"/><path d="M11.5 1.5l.4 1 1.1.2-.8.7.2 1.1-1-.5-1 .5.2-1.1-.7-.7 1-.2z"/></svg>',
  system_events: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1L3 9h4l-1 6 6.5-8H8.5l1-6z"/></svg>',
};

// Sidebar / nav item icon. Renders the SVG keyed by `name` from ICONS, or a
// 16x16 transparent spacer if the name isn't in the dict (so the row layout
// stays aligned even before a new nav item gets its icon registered).
//
// `color` is the CSS color string the SVG strokes should inherit. Caller
// computes it (typically `active ? '#FFF' : g.iconColor || g.color || muted`)
// and passes it in — keeping color logic at the call site makes it easy to
// reuse <Icon /> outside the sidebar later.
export function Icon({ name, color }) {
  const svg = ICONS[name];
  if (!svg) {
    return <span style={{ display: 'inline-block', width: 16, height: 16, flexShrink: 0 }} />;
  }
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, color }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
