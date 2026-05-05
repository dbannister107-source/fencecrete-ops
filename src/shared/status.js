// Status configuration. Extracted from App.jsx 2026-05-04 as the second chip
// in the App.jsx-decomposition rolling extraction (Phase 1, commit 2 of 3).
//
// The shape powers every status-aware surface in the app:
//   - Project list / Production Board status pills
//   - EditPanel status dropdown
//   - Kanban column headers (color from SC, bg from SB_)
//   - StageBadge (uses STAGE_THRESHOLDS for warn/critical age coloring)
//   - Status-promotion buttons (NEXT_STATUS drives the "Move to →" button)
//   - Closed-job filtering (CLOSED_SET excludes them from active counts)
//
// Pure data, no behavior change. Call sites in App.jsx still reference the
// short upper-case names (STS, SS, SL, SC, SB_, SR, etc.) — same names,
// just imported instead of declared at module scope.

// Canonical 9-status sequence. Index order = pipeline order.
export const STS = [
  'contract_review',
  'production_queue',
  'in_production',
  'material_ready',
  'active_install',
  'fence_complete',
  'fully_complete',
  'closed',
  'canceled',
];

// Status → human label. SL and SS are byte-for-byte identical (historical
// duplication — SL is the older name, SS the newer). Both exported so call
// sites don't have to change.
export const SS = {
  contract_review:  'Contract Review',
  production_queue: 'Production Queue',
  in_production:    'In Production',
  material_ready:   'Material Ready',
  active_install:   'Active Install',
  fence_complete:   'Fence Complete',
  fully_complete:   'Fully Complete',
  closed:           'Closed',
  canceled:         'Canceled',
};
export const SL = SS;

// Status palette (Phase 2: matches design-system brand spec).
// SC = text/accent color, SB_ = fill color, SR = ring/border color.
// These map 1:1 with StatusBadge in src/components/ui/status-badge.jsx so a
// status pill rendered via the inline `pill()` helper looks identical to one
// rendered via <StatusBadge>.
export const SC = {
  contract_review:  '#625650',
  production_queue: '#854F0B',
  in_production:    '#185FA5',
  material_ready:   '#0F6E56',
  active_install:   '#065F46',
  fence_complete:   '#085041',
  fully_complete:   '#04342C',
  closed:           '#625650',
  canceled:         '#991B1B',
};

// Background colors — each post-production stage gets a distinct shade so the
// project-list status pills are visually distinguishable at a glance. Before
// 2026-05-04, material_ready / active_install / fence_complete / fully_complete
// all shared #E1F5EE which made them indistinguishable. Now they progress
// from soft teal (production-side) through emerald (active install) to
// rich green (fence complete) to deep forest (fully complete).
export const SB_ = {
  contract_review:  '#F4F4F2',
  production_queue: '#FAEEDA',
  in_production:    '#E6F1FB',
  material_ready:   '#E1F5EE',
  active_install:   '#C7EBD9',
  fence_complete:   '#A7E6CD',
  fully_complete:   '#7DD9B5',
  closed:           '#F4F4F2',
  canceled:         '#FEF2F2',
};

export const SR = {
  contract_review:  '#9CA3AF',
  production_queue: '#D97706',
  in_production:    '#854F0B',
  material_ready:   '#2563EB',
  active_install:   '#059669',
  fence_complete:   '#0D9488',
  fully_complete:   '#10B981',
  closed:           '#9CA3AF',
  canceled:         '#DC2626',
};

// "Done" set: jobs in these statuses are excluded from active counts on the
// Dashboard, sidebar count, Production Board capacity math, etc. Note that
// 'cancelled' (British spelling) is a legacy data-quality artifact — a few
// rows still carry it. Keep both spellings in the set until backfilled.
export const CLOSED_SET = new Set(['fully_complete', 'closed', 'canceled', 'cancelled']);

// Status-promotion graph. Drives the "Move to →" button on each project's
// EditPanel. fully_complete → closed is the only manual close (closed jobs
// don't auto-progress — they sit there until reopened or archived).
export const NEXT_STATUS = {
  contract_review:  'production_queue',
  production_queue: 'in_production',
  in_production:    'material_ready',
  material_ready:   'active_install',
  active_install:   'fence_complete',
  fence_complete:   'fully_complete',
  fully_complete:   'closed',
};

// Production Board kanban columns — STS minus 'closed' and 'canceled'. Keeps
// terminal states out of the visual queue (they have their own filtered view).
export const KANBAN_STS = [
  'contract_review',
  'production_queue',
  'in_production',
  'material_ready',
  'active_install',
  'fence_complete',
  'fully_complete',
];

// Per-stage age thresholds [warn_days, critical_days]. StageBadge reads these
// to color the date pill: under warn → neutral, ≥warn → amber, ≥critical →
// red. Tuned per-stage because "30 days in contract_review" is a different
// signal than "30 days in fence_complete".
export const STAGE_THRESHOLDS = {
  contract_review:  [30, 60],
  production_queue: [21, 45],
  in_production:    [30, 60],
  material_ready:   [14, 30],
  active_install:   [30, 60],
  fence_complete:   [7, 14],
  fully_complete:   [7, 14],
};

// Per-stage "what date matters for age math" map. Each post-production stage
// has its own date column; pre-production stages fall back to est_start_date.
export const STAGE_DATE_KEY = {
  material_ready:  'inventory_ready_date',
  active_install:  'active_install_date',
  fence_complete:  'fence_complete_date',
  fully_complete:  'fully_complete_date',
  in_production:   'production_start_date',
};
