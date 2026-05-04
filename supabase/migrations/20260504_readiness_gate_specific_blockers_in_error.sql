-- Enrich the readiness gate's error message with the SPECIFIC failing items.
--
-- Background: Amiee tried to move 24H007 (Peacan Ranch BC MUD) from
-- contract_review → production_queue and got "checklist incomplete" — but the
-- generic message didn't say WHICH item was failing. Investigation showed it
-- was customer_linked=false (one auto-check), but she had no way to know
-- without asking. This update reads v_contract_readiness's auto_checks +
-- manual_items JSONBs and lists every failing item by name in the raised
-- message. Saves a round-trip + a support question every time the gate fires.
--
-- Friendly labels match the AUTO_LABELS / MANUAL_LABELS constants in
-- src/shared/readiness.js so the wording in the toast matches the wording in
-- the EditPanel's Contract Readiness card.
--
-- The "internal error" path is unchanged — still raises 'internal_error'
-- ERRCODE, still logs to system_events.

CREATE OR REPLACE FUNCTION public.enforce_contract_readiness()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ready          boolean;
  v_view_failed    boolean := false;
  v_auto_checks    jsonb;
  v_manual_items   jsonb;
  v_blockers       text[] := ARRAY[]::text[];
  v_blocker_msg    text;
  v_auto_label_map jsonb := jsonb_build_object(
    'customer_linked',           'Customer linked to company master',
    'style_set',                 'Style set',
    'color_set',                 'Color set',
    'height_set',                'Height set',
    'total_lf_set',              'Total LF set',
    'contract_value_set',        'Contract value set',
    'line_items_entered',        'Line items entered',
    'line_items_match_contract', 'Line items match contract value'
  );
  v_manual_label_map jsonb := jsonb_build_object(
    'tax_cert',         'Tax exemption certificate (or marked N/A)',
    'payment_terms',    'Payment terms confirmed',
    'wet_signatures',   'Wet signatures on file',
    'deposit_received', 'Deposit received (or marked N/A)'
  );
BEGIN
  IF OLD.status = 'contract_review'
     AND NEW.status IN ('production_queue', 'in_production', 'material_ready',
                        'active_install', 'fence_complete', 'fully_complete')
  THEN
    BEGIN
      SELECT is_ready, auto_checks, manual_items
        INTO v_ready, v_auto_checks, v_manual_items
        FROM v_contract_readiness WHERE job_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      v_view_failed := true;
      BEGIN
        INSERT INTO system_events (
          event_type, event_category, actor_type,
          entity_type, entity_id, payload
        ) VALUES (
          'readiness_gate_internal_error', 'system', 'system',
          'job', NEW.id,
          jsonb_build_object(
            'job_id',           NEW.id,
            'job_number',       NEW.job_number,
            'attempted_status', NEW.status,
            'sqlstate',         SQLSTATE,
            'sqlerrm',          SQLERRM
          )
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;

    IF v_view_failed THEN
      RAISE EXCEPTION 'Cannot move job % out of contract_review: readiness check failed with an internal database error. Logged to system_events for admin review — please retry, or contact David if it persists.', NEW.job_number
        USING ERRCODE = 'internal_error';
    ELSIF v_ready IS NOT TRUE THEN
      -- Build a list of specific blockers from auto_checks + manual_items.
      --
      -- auto_checks: { "customer_linked": true/false, ... } — pick keys with value false.
      -- manual_items: { "tax_cert": { "checked_at": ts|null, "not_applicable": bool }, ... }
      --   — failing if checked_at IS NULL AND not_applicable is not true.

      IF v_auto_checks IS NOT NULL THEN
        SELECT array_agg(COALESCE(v_auto_label_map ->> key, key) ORDER BY key)
          INTO v_blockers
          FROM jsonb_each(v_auto_checks)
          WHERE value::text = 'false';
      END IF;

      IF v_manual_items IS NOT NULL THEN
        v_blockers := v_blockers || COALESCE((
          SELECT array_agg(COALESCE(v_manual_label_map ->> key, key) ORDER BY key)
            FROM jsonb_each(v_manual_items)
            WHERE (value -> 'checked_at') IS NULL OR (value ->> 'checked_at') IS NULL
              AND COALESCE((value ->> 'not_applicable')::boolean, false) IS NOT TRUE
        ), ARRAY[]::text[]);
      END IF;

      IF v_blockers IS NULL OR array_length(v_blockers, 1) IS NULL THEN
        v_blocker_msg := 'contract readiness checklist incomplete';
      ELSE
        v_blocker_msg := 'missing — ' || array_to_string(v_blockers, '; ');
      END IF;

      RAISE EXCEPTION 'Cannot move job % out of contract_review: %. Open the job in OPS → Money tab → Contract & Billing → Contract Readiness card to resolve, then retry.', NEW.job_number, v_blocker_msg
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
