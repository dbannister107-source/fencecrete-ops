-- Remove the active_install crew_leader_id forcing function.
--
-- The trigger (built 2026-05-04 as P0 #1's forcing function) blocked any
-- save that would leave a row in status='active_install' with
-- crew_leader_id IS NULL. It successfully drove the initial backfill of
-- 55 unassigned jobs, but at this point the data is healthy and the
-- rigidity is creating user friction:
--   • Admins can't temporarily unassign a leader on an active job
--     (e.g., leader leaves, project paused, mid-flight reassignment with
--     a coverage gap) without artificially rolling status back.
--   • The 2026-05-04 demote-and-unassign workaround (commit 7200386)
--     auto-changed status to material_ready on unassign, which David
--     explicitly asked to remove ("Remove the rule that changes the
--     project status if a crew leader is unassigned").
--
-- Net: the gate has served its purpose. Carlos's bulk-assign UI is the
-- ongoing path to keep active_install coverage healthy. The Co-Pilot
-- home insight ("X of Y active_install jobs missing crew_leader_id")
-- continues to surface coverage gaps without forcing them.
--
-- BOTH triggers (BEFORE INSERT and BEFORE UPDATE) and the function
-- itself are dropped. The 'TBD' and 'Subcontractor' placeholder rows
-- in crew_leaders (added same day) remain — they're now optional
-- conveniences rather than gate-satisfiers.

DROP TRIGGER IF EXISTS trg_enforce_crew_leader_for_active_install_bi ON public.jobs;
DROP TRIGGER IF EXISTS trg_enforce_crew_leader_for_active_install_bu ON public.jobs;
DROP FUNCTION IF EXISTS public.enforce_crew_leader_for_active_install();
