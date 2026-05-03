-- Tech debt #9 — Hardcoded permissions → JSONB column on user_profiles.
--
-- Replaces 8 hardcoded email Sets that previously sat at the top of
-- src/App.jsx (EDIT_EMAILS, STATUS_EDIT_EMAILS, REOPEN_EMAILS,
-- INSTALL_DATE_EDIT_EMAILS, WORKBENCH_VIEW_EMAILS, AMIEE_EMAILS,
-- SYSTEM_ADMIN_EMAILS, PLANT_EDIT_EMAILS) with a single JSONB column.
--
-- Adding/removing a permission for a user is now a SQL UPDATE — no app
-- deploy required. App reads via src/shared/permissions.js helpers.
--
-- Backfill mirrors the email Sets exactly. `contracts@fencecrete.com` was
-- in several Sets but is a routing alias (Amiee logs in as amiee@; contracts@
-- forwards) — there's no row for it in user_profiles and never was, so the
-- UPDATEs no-op those entries. Amiee's row carries the equivalent perms.

-- 1. Add column
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Backfill — one UPDATE per permission key. jsonb || merges the new pair.

-- edit_projects (4 rows, was 5 emails: David, Amiee, contracts@*, Alex, Carlos)
UPDATE public.user_profiles SET permissions = permissions || '{"edit_projects": true}'::jsonb
 WHERE lower(email) IN ('david@fencecrete.com','amiee@fencecrete.com','contracts@fencecrete.com','alex@fencecrete.com','ccontreras@fencecrete.com');

-- edit_status (7 rows: above + Max, Mike Martin, Luis)
UPDATE public.user_profiles SET permissions = permissions || '{"edit_status": true}'::jsonb
 WHERE lower(email) IN ('david@fencecrete.com','amiee@fencecrete.com','contracts@fencecrete.com','alex@fencecrete.com','max@fencecrete.com','ccontreras@fencecrete.com','mmartin@fencecrete.com','luis@fencecrete.com');

-- reopen_jobs (6 rows: David, Amiee, Alex, Carlos, Mike Martin, Virginia)
UPDATE public.user_profiles SET permissions = permissions || '{"reopen_jobs": true}'::jsonb
 WHERE lower(email) IN ('david@fencecrete.com','amiee@fencecrete.com','alex@fencecrete.com','ccontreras@fencecrete.com','mmartin@fencecrete.com','virginiag@fencecrete.com');

-- edit_install_date (18 rows: union of edit_projects ∪ edit_status ∪ reopen_jobs ∪ INSTALL_DATE_EDIT_EMAILS)
UPDATE public.user_profiles SET permissions = permissions || '{"edit_install_date": true}'::jsonb
 WHERE lower(email) IN (
   'david@fencecrete.com','amiee@fencecrete.com','contracts@fencecrete.com','alex@fencecrete.com','ccontreras@fencecrete.com',
   'max@fencecrete.com','mmartin@fencecrete.com','luis@fencecrete.com','virginiag@fencecrete.com',
   'matt@fencecrete.com','laura@fencecrete.com','yuda@fencecrete.com','nathan@fencecrete.com','ryne@fencecrete.com','mdean@fencecrete.com',
   'ray@fencecrete.com','manuel@fencecrete.com','jr@fencecrete.com','doug@fencecrete.com'
 );

-- view_workbench (10 rows: edit_projects ∪ WORKBENCH_VIEW_EMAILS — sales reps get view-only)
UPDATE public.user_profiles SET permissions = permissions || '{"view_workbench": true}'::jsonb
 WHERE lower(email) IN (
   'david@fencecrete.com','amiee@fencecrete.com','contracts@fencecrete.com','alex@fencecrete.com','ccontreras@fencecrete.com',
   'matt@fencecrete.com','laura@fencecrete.com','yuda@fencecrete.com','nathan@fencecrete.com','ryne@fencecrete.com','mdean@fencecrete.com'
 );

-- approve_co (1 row: Amiee. Was 2 emails — contracts@ alias also listed but no profile row)
UPDATE public.user_profiles SET permissions = permissions || '{"approve_co": true}'::jsonb
 WHERE lower(email) IN ('amiee@fencecrete.com','contracts@fencecrete.com');

-- view_system_events (2 rows: David, Carlos)
UPDATE public.user_profiles SET permissions = permissions || '{"view_system_events": true}'::jsonb
 WHERE lower(email) IN ('david@fencecrete.com','ccontreras@fencecrete.com');

-- edit_plant_wo (7 rows: admins + Max, Luis, Mike Martin)
UPDATE public.user_profiles SET permissions = permissions || '{"edit_plant_wo": true}'::jsonb
 WHERE lower(email) IN ('david@fencecrete.com','amiee@fencecrete.com','alex@fencecrete.com','contracts@fencecrete.com','ccontreras@fencecrete.com','mmartin@fencecrete.com','max@fencecrete.com','luis@fencecrete.com');

-- 3. Pre-create rows for active staff who don't have a user_profiles row yet,
-- so their permissions are ready when they first sign in via SSO.
--   - Mike Martin: fleet + supply chain (production role, no isAdmin gates)
--   - Mike Dean: Dallas sales rep (pending first SSO login)
INSERT INTO public.user_profiles (email, full_name, role, active, permissions)
VALUES
  ('mmartin@fencecrete.com', 'Mike Martin', 'production', true,
    '{"edit_status": true, "reopen_jobs": true, "edit_install_date": true, "edit_plant_wo": true}'::jsonb),
  ('mdean@fencecrete.com',   'Mike Dean',   'sales_rep',  true,
    '{"edit_install_date": true, "view_workbench": true}'::jsonb)
ON CONFLICT (email) DO UPDATE SET
  permissions = EXCLUDED.permissions,
  active = true;

COMMENT ON COLUMN public.user_profiles.permissions IS
  'Per-user permission booleans. Keys: edit_projects, edit_status, reopen_jobs, edit_install_date, view_workbench, approve_co, view_system_events, edit_plant_wo. Read by src/shared/permissions.js — adding/removing a permission is a SQL UPDATE; no app deploy needed.';
