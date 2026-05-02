-- 20260502_fix_readiness_trigger_fail_open.sql
--
-- Close the silent fail-open path in enforce_contract_readiness().
--
-- The previous version did:
--
--   BEGIN
--     SELECT is_ready INTO v_ready FROM v_contract_readiness WHERE job_id = NEW.id;
--   EXCEPTION WHEN OTHERS THEN
--     v_ready := true;  -- fail open
--   END;
--
-- Any view-level error (column rename, dropped column, search_path issue,
-- transient error during a deploy, etc.) silently let the status move
-- through with no audit trail. The forcing function — the entire point of
-- the trigger — silently disabled itself.
--
-- After this migration:
--   1. Internal errors fail CLOSED (status move blocked) instead of open.
--   2. The internal error is captured to system_events with full context
--      (sqlstate, sqlerrm, job_id, attempted status) so admin can debug.
--   3. The user sees a distinct error message that signals "internal" so
--      they don't loop trying to "fix" a checklist that's already complete.
--
-- The user-facing message for genuine readiness failures is unchanged —
-- only the internal-error path is altered.

CREATE OR REPLACE FUNCTION public.enforce_contract_readiness()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ready       boolean;
  v_view_failed boolean := false;
BEGIN
  -- Only check transitions OUT of contract_review to a downstream status
  IF OLD.status = 'contract_review'
     AND NEW.status IN ('production_queue', 'in_production', 'material_ready',
                        'active_install', 'fence_complete', 'fully_complete')
  THEN
    BEGIN
      SELECT is_ready INTO v_ready FROM v_contract_readiness WHERE job_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      -- View read failed for some non-readiness reason. Log it (best-effort,
      -- swallow logging failures) and remember so we can fail closed below
      -- with a distinct error.
      v_view_failed := true;
      BEGIN
        INSERT INTO system_events (
          event_type, event_category, actor_type,
          entity_type, entity_id, payload
        ) VALUES (
          'readiness_gate_internal_error',
          'system',
          'system',
          'job',
          NEW.id,
          jsonb_build_object(
            'job_id',           NEW.id,
            'job_number',       NEW.job_number,
            'attempted_status', NEW.status,
            'sqlstate',         SQLSTATE,
            'sqlerrm',          SQLERRM
          )
        );
      EXCEPTION WHEN OTHERS THEN
        -- If even logging fails, do not let it break the trigger; the
        -- user will still get the internal-error RAISE below.
        NULL;
      END;
    END;

    IF v_view_failed THEN
      RAISE EXCEPTION 'Cannot move job % out of contract_review: readiness check failed with an internal database error. Logged to system_events for admin review — please retry, or contact David if it persists.', NEW.job_number
        USING ERRCODE = 'internal_error';
    ELSIF v_ready IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot move job % out of contract_review: contract readiness checklist incomplete. Open the job in OPS, complete the Contract Readiness card, then retry.', NEW.job_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
