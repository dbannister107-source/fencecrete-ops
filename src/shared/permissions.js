// Single source of truth for permission keys + helpers.
//
// Permission data lives on user_profiles.permissions (JSONB column added by
// migration 20260503_user_permissions_jsonb.sql). The JSONB shape is a flat
// map of permission key → boolean, e.g.:
//
//   { "edit_projects": true, "edit_status": true, "approve_co": false }
//
// Adding/removing a permission for a user is a SQL UPDATE — no app deploy
// required. Replaces the hardcoded EDIT_EMAILS / STATUS_EDIT_EMAILS / etc.
// Sets that previously sat at the top of src/App.jsx.
//
// Helpers take the user's `profile` object (auth.profile from the auth
// context) — NOT an email string. Missing key, missing profile, or null
// profile all return false (no permission).

export const PERMS = {
  EDIT_PROJECTS:      'edit_projects',
  EDIT_STATUS:        'edit_status',
  REOPEN_JOBS:        'reopen_jobs',
  EDIT_INSTALL_DATE:  'edit_install_date',
  VIEW_WORKBENCH:     'view_workbench',
  APPROVE_CO:         'approve_co',
  VIEW_SYSTEM_EVENTS: 'view_system_events',
  EDIT_PLANT_WO:      'edit_plant_wo',
  // Payroll-sensitive fields on the Crew Leaders Admin page (department code +
  // hourly pay rate). Held by David, Alex, Carlos, and Violet so a stray edit
  // by a different admin can't change comp data. Granted via DB UPDATE on
  // user_profiles.permissions (no app deploy needed). Added 2026-05-04.
  EDIT_CREW_PAYROLL:  'edit_crew_payroll',
};

// Generic check — fails closed. profile may be null/undefined during the
// post-login window before user_profiles fetch completes.
export const hasPerm = (profile, key) =>
  !!(profile && profile.permissions && profile.permissions[key] === true);

// Named helpers — same names as the previous email-based functions in
// App.jsx so the callsite diff is just an argument swap. New callers should
// prefer `hasPerm(profile, PERMS.X)` for grep-ability.
export const canEditProjects     = (p) => hasPerm(p, PERMS.EDIT_PROJECTS);
export const canEditStatus       = (p) => hasPerm(p, PERMS.EDIT_STATUS);
export const canReopen           = (p) => hasPerm(p, PERMS.REOPEN_JOBS);
export const canEditInstallDate  = (p) => hasPerm(p, PERMS.EDIT_INSTALL_DATE);
export const canViewWorkbench    = (p) => hasPerm(p, PERMS.VIEW_WORKBENCH);
export const canApproveCO        = (p) => hasPerm(p, PERMS.APPROVE_CO);
export const canViewSystemEvents = (p) => hasPerm(p, PERMS.VIEW_SYSTEM_EVENTS);
export const canEditPlantWO      = (p) => hasPerm(p, PERMS.EDIT_PLANT_WO);
export const canEditCrewPayroll  = (p) => hasPerm(p, PERMS.EDIT_CREW_PAYROLL);
