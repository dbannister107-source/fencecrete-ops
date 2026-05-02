-- 20260502_fix_auth_rls_initplan.sql
--
-- Eliminates the last 2 auth_rls_initplan advisor warnings by wrapping
-- auth.* calls in (SELECT ...) so they evaluate once per query rather
-- than once per row.
--
-- Both policies preserve their original behavior:
--   - digest_log."auth write": authenticated users only can INSERT
--   - user_profiles."update own": users can UPDATE only their own row
--
-- Postgres has no CREATE OR REPLACE POLICY, so each policy is dropped
-- and recreated atomically within this migration.

DROP POLICY IF EXISTS "auth write" ON public.digest_log;
CREATE POLICY "auth write" ON public.digest_log
  FOR INSERT TO public
  WITH CHECK ((SELECT auth.role()) = 'authenticated'::text);

DROP POLICY IF EXISTS "update own" ON public.user_profiles;
CREATE POLICY "update own" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING      (auth_user_id = (SELECT auth.uid()))
  WITH CHECK (auth_user_id = (SELECT auth.uid()));
