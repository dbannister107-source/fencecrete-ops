// Navigation + role configuration. Extracted from App.jsx 2026-05-04 as the
// first chip in the App.jsx-decomposition rolling extraction (Phase 1).
//
// Three concerns live here:
//   1. NAV_GROUPS         — desktop sidebar structure (groups + items)
//   2. MOBILE_NAV_*       — mobile bottom-tab structure, role-aware
//   3. ROLE_META + ROLE_NAV_GROUPS + helpers — which role sees what
//
// All consts and helpers were previously inlined in App.jsx at lines
// 25957-25966, 25979-26025, 26183-26229. No behavior change — pure
// extraction. Imported by App.jsx, Sidebar, MobileBottomNav, MoreMenuSheet,
// and ProfilePanel.

// ─── Desktop sidebar structure ───────────────────────────────────────
//
// 8 groups, ~34 items, ~34 unique icons. Each group has a primary brand color
// (used for active-row highlights) and an icon color (for the group header).
// Items reference page keys that the App-shell router knows about.
export const NAV_GROUPS = [
  {label:'HOME',color:'#8A261D',iconColor:'#E07060',items:[{key:'dashboard',label:'Dashboard',icon:'🏠'},{key:'my_plate',label:'My Plate',icon:'🍽️'}]},
  {label:'SALES',color:'#1D4ED8',iconColor:'#93C5FD',items:[{key:'sales_dashboard',label:'Sales Dashboard',icon:'📊'},{key:'prospecting',label:'Prospecting',icon:'🎯'},{key:'pipeline',label:'Pipeline',icon:'🔁'},{key:'proposals',label:'Proposals',icon:'📄'},{key:'bid_advisor',label:'Bid Advisor',icon:'💡'},{key:'proposal_validator',label:'Proposal Validator',icon:'✅'},{key:'proposal_triage',label:'Proposal Triage',icon:'🏷️'},{key:'tasks',label:'Tasks',icon:'☑️'},{key:'contacts',label:'Contacts',icon:'👤'}]},
  {label:'CONTRACTS & PROJECTS',color:'#D97706',iconColor:'#FBBF24',items:[{key:'projects',label:'Projects',icon:'🏗'},{key:'contracts_workbench',label:'Contracts Workbench',icon:'📋'},{key:'map',label:'Project Map',icon:'🗺'}]},
  {label:'PROJECT MANAGEMENT',color:'#854F0B',iconColor:'#FCD34D',items:[{key:'pm_billing',label:'PM Bill Sheet',icon:'🧾'},{key:'pm_daily_report',label:'PM Daily Report',icon:'📝'},{key:'schedule',label:'Install Schedule',icon:'📅'},{key:'specialty_visits',label:'Specialty Install',icon:'🔨'}]},
  {label:'PRODUCTION',color:'#0F6E56',iconColor:'#34D399',items:[{key:'demand_planning',label:'Demand Planning',icon:'📈'},{key:'production_planning',label:'Production Planning',icon:'⚙'},{key:'production',label:'Production Board',icon:'🗂'},{key:'daily_report',label:'Daily Production Report',icon:'🏭'},{key:'crew_assignment',label:'Crew Assignment',icon:'👷'},{key:'material_calc',label:'Material Calculator',icon:'🧮'},{key:'mold_inventory',label:'Mold Inventory',icon:'🧱'}]},
  {label:'FINANCE',color:'#065F46',iconColor:'#6EE7B7',items:[{key:'billing',label:'Billing',icon:'💰'},{key:'change_orders',label:'Change Order Log',icon:'🪙'},{key:'cv_reconciliation',label:'Contract Reconciliation',icon:'⚖️'},{key:'weather_days',label:'Weather Days',icon:'🌧'},{key:'reports',label:'Reports',icon:'📑'}]},
  {label:'FLEET & EQUIPMENT',color:'#0F6E56',iconColor:'#34D399',items:[{key:'fleet',label:'Fleet Assets',icon:'🚛'},{key:'fleet_wo',label:'Fleet Work Orders',icon:'🔧'},{key:'plant_maintenance',label:'Plant Work Orders',icon:'🛠️'}]},
  {label:'ADMIN',color:'#625650',iconColor:'#9E9B96',items:[{key:'import_projects',label:'Import Projects',icon:'📤'}]},
];

// ─── Mobile bottom-tab nav (role-aware) ──────────────────────────────
//
// Each role gets a 5-item bar with the actions they actually do most. Items
// not in the preset are reachable via the "More" bottom-sheet (which inherits
// the same role filter via ROLE_NAV_GROUPS).
//
// Why this matters: PMs in the field were tapping More → PM Bill Sheet every
// time — one extra tap on every cycle. Sales reps similarly tapped More to
// reach Pipeline. The bottom nav is prime real estate; surface what each
// role does daily.
//
// Built 2026-05-04 (Tier 1 mobile-PM improvement). Falls back to the legacy
// generic 5-item bar when role is missing or unrecognized.
export const MOBILE_NAV_DEFAULT = [
  {key:'dashboard',label:'Dashboard',icon:'🏠'},
  {key:'projects',label:'Projects',icon:'🏗'},
  {key:'production',label:'Production',icon:'🗂'},
  {key:'billing',label:'Billing',icon:'💰'},
  {key:'__more',label:'More',icon:'☰'},
];

export const MOBILE_NAV_BY_ROLE = {
  pm: [
    {key:'dashboard',     label:'Dashboard', icon:'🏠'},
    {key:'my_plate',      label:'My Plate',  icon:'🍽️'},
    {key:'pm_billing',    label:'Bill Sheet',icon:'🧾'},
    {key:'pm_daily_report',label:'Daily',    icon:'📝'},
    {key:'__more',        label:'More',      icon:'☰'},
  ],
  production: [
    {key:'dashboard',         label:'Dashboard', icon:'🏠'},
    {key:'production',        label:'Production',icon:'🗂'},
    {key:'demand_planning',   label:'Demand',    icon:'📈'},
    {key:'crew_assignment',   label:'Crews',     icon:'👷'},
    {key:'__more',            label:'More',      icon:'☰'},
  ],
  sales_rep: [
    {key:'dashboard', label:'Dashboard',icon:'🏠'},
    {key:'pipeline',  label:'Pipeline', icon:'🔁'},
    {key:'proposals', label:'Proposals',icon:'📄'},
    {key:'tasks',     label:'Tasks',    icon:'☑️'},
    {key:'__more',    label:'More',     icon:'☰'},
  ],
  sales_director: [
    {key:'dashboard',       label:'Dashboard',icon:'🏠'},
    {key:'pipeline',        label:'Pipeline', icon:'🔁'},
    {key:'sales_dashboard', label:'Sales',    icon:'📊'},
    {key:'proposals',       label:'Proposals',icon:'📄'},
    {key:'__more',          label:'More',     icon:'☰'},
  ],
  billing: [
    {key:'dashboard',label:'Dashboard',icon:'🏠'},
    {key:'billing',  label:'Billing',  icon:'💰'},
    {key:'projects', label:'Projects', icon:'🏗'},
    {key:'reports',  label:'Reports',  icon:'📑'},
    {key:'__more',   label:'More',     icon:'☰'},
  ],
};

// Resolve the bottom-nav config for a given role. Used by both MobileBottomNav
// and the App shell to keep them aligned.
export const mobileNavForRole = (role) => MOBILE_NAV_BY_ROLE[role] || MOBILE_NAV_DEFAULT;

// ─── Role metadata + per-role group filter ──────────────────────────
//
// ROLE_META: visual treatment for the role pill in the header / profile.
// ROLE_NAV_GROUPS: which sidebar group labels each role can see.
//
// 'billing' covers BOTH the AR / billing-review function (Virginia) AND the
// contracts function (Amiee). Both need Production Board for visibility into
// queued work, and ADMIN for SharePoint folder management. ADMIN sub-items
// are individually gated (canFolderAdmin requires admin OR billing role,
// crew leaders + system events require explicit perms), so granting the
// group only surfaces what each user is already permissioned for.
//
// 'production' was too narrow (HOME + PRODUCTION only); production team
// (Max, Carlos) needs CONTRACTS & PROJECTS to look up jobs waiting in the
// queue, plus FLEET & EQUIPMENT for plant maintenance.
//
// 'pm' coverage of FLEET (PMs report defects on field equipment).
//
// Unknown / missing role => no filter applied (admin-equivalent fallback)
// so a profile-fetch failure can't lock anyone out.
export const ROLE_META = {
  admin:           { label:'Admin',           c:'#8A261D', bg:'#FDF4F4' },
  sales_director:  { label:'Sales Director',  c:'#1D4ED8', bg:'#DBEAFE' },
  sales_rep:       { label:'Sales Rep',       c:'#1D4ED8', bg:'#DBEAFE' },
  pm:              { label:'PM',              c:'#854F0B', bg:'#FAEEDA' },
  production:      { label:'Production',      c:'#B45309', bg:'#FEF3C7' },
  billing:         { label:'Billing',         c:'#065F46', bg:'#D1FAE5' },
  admin_assistant: { label:'Admin Assistant', c:'#5B21B6', bg:'#EDE9FE' },
  viewer:          { label:'Viewer',          c:'#625650', bg:'#F4F4F2' },
};

export const ROLE_NAV_GROUPS = {
  admin:           new Set(['HOME','SALES','CONTRACTS & PROJECTS','PROJECT MANAGEMENT','PRODUCTION','FINANCE','FLEET & EQUIPMENT','ADMIN','HELP']),
  sales_director:  new Set(['HOME','SALES','CONTRACTS & PROJECTS','PROJECT MANAGEMENT','PRODUCTION','FINANCE','HELP']),
  sales_rep:       new Set(['HOME','SALES','CONTRACTS & PROJECTS','HELP']),
  pm:              new Set(['HOME','CONTRACTS & PROJECTS','PROJECT MANAGEMENT','PRODUCTION','FLEET & EQUIPMENT','HELP']),
  production:      new Set(['HOME','CONTRACTS & PROJECTS','PRODUCTION','FLEET & EQUIPMENT','HELP']),
  billing:         new Set(['HOME','CONTRACTS & PROJECTS','PROJECT MANAGEMENT','PRODUCTION','FINANCE','ADMIN','HELP']),
  admin_assistant: new Set(['HOME','CONTRACTS & PROJECTS','PROJECT MANAGEMENT','PRODUCTION','HELP']),
  viewer:          new Set(['HOME','CONTRACTS & PROJECTS','HELP']),
};

// Helpers
export const initialsOf = (name, email) => {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
      || (name[0] || '?').toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
};

export const roleColorFor = (role) =>
  ROLE_META[role] || { label: role || 'User', c: '#625650', bg: '#F4F4F2' };
