-- ============================================================================
-- DROP the behavioural flag columns: is_urgent + emergency_source  (S6/S7 Phase 2)
-- ============================================================================
-- After S6 (on_bidding unification) and S7 (emergency-assign -> S4 confirmed),
-- urgency and emergency are derived from time-to-start at read time. The columns
--   is_urgent       (bool)  — TTS snapshot, read by NOTHING for logic
--   emergency_source(text)  — fill-method cache, read by NOTHING after S7 Phase 1
-- are dead. This migration stops writing them, drops the two now-dead helper
-- functions, and DROPS both columns.
--
-- KEPT (NOT dropped): emergency_assigned_at / emergency_assigned_by — these are
-- historical audit timestamps of past emergency fills, still read by the insights
-- analytics (get_insights_summary / get_dept_insights_breakdown /
-- get_quarterly_performance_report). They record history, not behaviour, so they
-- stay (dropping them would erase history + force rewriting 3 analytics fns).
--
-- v_shifts_grouped is a pass-through view that lists is_urgent explicitly; since
-- CREATE OR REPLACE VIEW cannot drop a mid-list column, the view is recreated.
-- Verified: the view has no dependents and no client/edge references.
-- ============================================================================

-- ── 1a. Strip is_urgent writes ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.publish_shift(p_shift_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_new_fulfillment_status shift_fulfillment_status;
    v_overlap_exists BOOLEAN;
    v_rest_period_ok BOOLEAN;
    v_shift_start TIMESTAMPTZ;
    v_bidding_close_at TIMESTAMPTZ;
    v_bidding_status shift_bidding_status;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;

    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    IF v_shift.lifecycle_status::text != 'Draft' AND v_shift.lifecycle_status::text != 'Published' THEN
         RAISE EXCEPTION 'Shift must be in Draft state to publish (current: %)', v_shift.lifecycle_status;
    END IF;

    IF v_shift.assigned_employee_id IS NOT NULL THEN
        v_new_fulfillment_status := 'scheduled';

        INSERT INTO shift_offers (shift_id, employee_id, status)
        VALUES (p_shift_id, v_shift.assigned_employee_id, 'Pending')
        ON CONFLICT (shift_id, employee_id) DO NOTHING;

        UPDATE shifts SET
            lifecycle_status = 'Published',
            fulfillment_status = v_new_fulfillment_status,
            assignment_outcome = 'offered',
            published_at = NOW(),
            published_by_user_id = p_actor_id
        WHERE id = p_shift_id;

    ELSE
        v_new_fulfillment_status := 'bidding';

        v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Australia/Sydney';
        v_bidding_close_at := v_shift_start - INTERVAL '4 hours';

        IF v_bidding_close_at <= NOW() THEN
            RAISE EXCEPTION 'Cannot publish unassigned shift less than 4 hours before start. Please assign an employee manually.';
        END IF;

        v_bidding_status := 'on_bidding';

        UPDATE shifts SET
            lifecycle_status = 'Published',
            fulfillment_status = v_new_fulfillment_status,
            bidding_status = v_bidding_status,
            published_at = NOW(),
            published_by_user_id = p_actor_id,
            is_on_bidding = TRUE,
            bidding_enabled = TRUE,
            bidding_open_at = NOW(),
            bidding_close_at = v_bidding_close_at
        WHERE id = p_shift_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'shift_id', p_shift_id, 'new_status', 'Published');
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_shift_timers()
 RETURNS TABLE(operation text, affected integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count INT := 0;
    v_rec   RECORD;
BEGIN
    -- 1. Expire pending offers S3 -> S2
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation:='OFFER_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2. Bidding timeout S5/S6 -> S1 (direct; no S8 hop). Single UPDATE so
    --    trg_bidding_expired_notification_fn fires the manager notification.
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Draft',
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            is_on_bidding        = FALSE,
            locked_at            = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Bidding timeout: T-4h passed, no winner — reverted to draft'
        WHERE lifecycle_status = 'Published'
          AND bidding_status IN (
              'on_bidding'::shift_bidding_status,
              'on_bidding_normal'::shift_bidding_status,
              'on_bidding_urgent'::shift_bidding_status
          )
          AND assignment_status = 'unassigned'
          AND (
              (start_at IS NOT NULL AND start_at < NOW() + INTERVAL '4 hours')
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'UTC')
               < NOW() + INTERVAL '4 hours')
          )
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM timed_out;
    IF v_count > 0 THEN operation:='BIDDING_TIMEOUT'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3. Auto-start S4/S7 -> S11/S12
    WITH started AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'InProgress',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-started: scheduled start time reached'
        WHERE lifecycle_status = 'Published'
          AND assignment_outcome IN ('confirmed', 'emergency_assigned')
          AND (
              (start_at IS NOT NULL AND start_at <= NOW())
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'UTC')
               <= NOW())
          )
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM started;
    IF v_count > 0 THEN operation:='AUTO_START'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 4. Auto-complete S11/S12 -> S13/S14
    WITH completed AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Completed',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-completed: scheduled end time reached'
        WHERE lifecycle_status = 'InProgress'
          AND (
              (end_at IS NOT NULL AND end_at <= NOW())
              OR
              (end_at IS NULL AND
               (shift_date::TEXT || ' ' || end_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'UTC')
               <= NOW())
          )
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation:='AUTO_COMPLETE'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire open swap requests S9 -> S4
    WITH expired_swaps AS (
        UPDATE public.shift_swaps SET status='EXPIRED', updated_at=NOW()
        WHERE status='OPEN' AND expires_at IS NOT NULL AND expires_at < NOW()
        RETURNING id, requester_shift_id
    ),
    reverted AS (
        UPDATE public.shifts s SET
            trading_status       = 'NoTrade',
            trade_requested_at   = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Swap request expired: no peer accepted in time'
        FROM expired_swaps e
        WHERE s.id = e.requester_shift_id
          AND s.trading_status = 'TradeRequested'
        RETURNING s.id
    )
    SELECT COUNT(*) INTO v_count FROM expired_swaps;
    IF v_count > 0 THEN operation:='SWAP_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_close_bidding(p_shift_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_state TEXT;
BEGIN
    v_state := get_shift_state_id(p_shift_id);

    IF v_state NOT IN ('S5', 'S6') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   format('Cannot close bidding from state %s (must be S5 or S6)', v_state)
        );
    END IF;

    UPDATE public.shifts
    SET
        lifecycle_status     = 'Draft',
        bidding_status       = 'not_on_bidding',
        is_on_bidding        = FALSE,
        locked_at            = NULL,
        updated_at           = NOW(),
        last_modified_by     = p_user_id,
        last_modified_reason = COALESCE(p_reason, 'Bidding closed manually — reverted to draft')
    WHERE id = p_shift_id
      AND deleted_at IS NULL;

    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S1');

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_shift_to_bidding_on_cancel(p_shift_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_shift_start TIMESTAMPTZ;
    v_bidding_close_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    IF v_shift IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found'); END IF;
    v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Australia/Sydney';
    IF v_shift_start < NOW() THEN RETURN jsonb_build_object('success', false, 'error', 'Shift is in the past'); END IF;
    v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
    IF v_bidding_close_at <= NOW() THEN RETURN jsonb_build_object('success', false, 'error', 'WINDOW_EXPIRED', 'message', 'Too late to open bidding (less than 4h). Emergency cover required.'); END IF;

    UPDATE shifts SET
        lifecycle_status = 'Published',
        assigned_employee_id = NULL,
        assignment_status = 'unassigned',
        fulfillment_status = 'bidding',
        is_on_bidding = TRUE,
        bidding_enabled = TRUE,
        bidding_open_at = NOW(),
        bidding_close_at = v_bidding_close_at,
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_shift_id;

    RETURN jsonb_build_object('success', true, 'shift_id', p_shift_id, 'bidding_close_at', v_bidding_close_at);
END;
$function$;

-- create_test_shift: drop is_urgent from the S6 test-fixture INSERT.
CREATE OR REPLACE FUNCTION public.create_test_shift(p_state text, p_days_ahead integer, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift_id UUID := gen_random_uuid();
    v_org_id UUID;
    v_dept_id UUID;
    v_roster_id UUID;
    v_scheduled_start TIMESTAMPTZ;
    v_scheduled_end TIMESTAMPTZ;
    v_emp_id UUID;
BEGIN
    SELECT id INTO v_roster_id FROM rosters WHERE name = '__TEST_STATE_MACHINE__' LIMIT 1;
    SELECT organization_id, department_id INTO v_org_id, v_dept_id FROM rosters WHERE id = v_roster_id;
    IF p_employee_id IS NULL THEN SELECT id INTO v_emp_id FROM profiles LIMIT 1; ELSE v_emp_id := p_employee_id; END IF;
    v_scheduled_start := (CURRENT_DATE + p_days_ahead + TIME '09:00')::TIMESTAMPTZ;
    v_scheduled_end := (CURRENT_DATE + p_days_ahead + TIME '17:00')::TIMESTAMPTZ;

    CASE p_state
        WHEN 'S1' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Draft', 'unassigned', 'not_on_bidding', 'NoTrade', NOW(), NOW());
        WHEN 'S2' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Draft', 'assigned', 'pending', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW());
        WHEN 'S3' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'offered', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW(), NOW());
        WHEN 'S4' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'confirmed', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S5' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, is_on_bidding, bidding_open_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'unassigned', 'on_bidding_normal', 'NoTrade', TRUE, NOW(), NOW(), NOW(), NOW());
        WHEN 'S6' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, is_on_bidding, bidding_open_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'unassigned', 'on_bidding_urgent', 'NoTrade', TRUE, NOW(), NOW(), NOW(), NOW());
        WHEN 'S7' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'emergency_assigned', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S8' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'unassigned', 'bidding_closed_no_winner', 'NoTrade', NOW(), NOW(), NOW());
        WHEN 'S9' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, trade_requested_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'confirmed', 'not_on_bidding', 'TradeRequested', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S10' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, trade_requested_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'confirmed', 'not_on_bidding', 'TradeAccepted', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S15' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, is_cancelled, cancelled_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Cancelled', 'unassigned', 'not_on_bidding', 'NoTrade', TRUE, NOW(), NOW(), NOW());
        ELSE RAISE EXCEPTION 'Unknown state: %', p_state;
    END CASE;
    RETURN v_shift_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.recalculate_shift_urgency(uuid);

-- ── 1b. Strip emergency_source writes ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_bulk_assign(p_shift_ids uuid[], p_employee_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_count   int;
  v_success_count int;
  v_user_name     text;
  v_user_role     text;
  v_audit_role    text;
BEGIN
  v_total_count := array_length(p_shift_ids, 1);

  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
           left(lower(legacy_system_role::text), 50)
    INTO v_user_name, v_user_role FROM public.profiles WHERE id = p_user_id;
  ELSE
    v_user_name := 'System'; v_user_role := 'system_automation';
  END IF;

  WITH updated_rows AS (
    UPDATE public.shifts s SET
      assigned_employee_id = p_employee_id,
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN s.lifecycle_status = 'Published'
                                THEN 'confirmed'::public.shift_assignment_outcome
                                ELSE s.assignment_outcome END,
      confirmed_at         = CASE WHEN s.lifecycle_status = 'Published' THEN NOW() ELSE s.confirmed_at END,
      updated_at           = NOW(),
      last_modified_by     = p_user_id
    WHERE s.id = ANY(p_shift_ids) AND s.deleted_at IS NULL
    RETURNING s.id, s.lifecycle_status
  )
  SELECT count(*) INTO v_success_count FROM updated_rows;

  RETURN jsonb_build_object('success', true, 'total_requested', v_total_count,
    'success_count', v_success_count, 'failure_count', v_total_count - v_success_count,
    'message', format('Successfully assigned %s of %s shifts', v_success_count, v_total_count));

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_bulk_assign: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_bulk_assign_atomic(p_assignments jsonb, p_user_id uuid DEFAULT auth.uid(), p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_caller        uuid := auth.uid();
    v_user_name     text;
    v_user_role     text;
    v_pair          jsonb;
    v_employee_id   uuid;
    v_shift_ids     uuid[];
    v_pair_total    int;
    v_pair_success  int;
    v_pair_conflicts jsonb;
    v_total_requested   int := 0;
    v_total_success     int := 0;
    v_total_conflict    int := 0;
    v_per_employee      jsonb := '[]'::jsonb;
    v_all_conflicts     jsonb := '[]'::jsonb;
    v_updated_ids       uuid[];
    v_shift_id          uuid;
    v_final_result      jsonb;
    v_stored_result     jsonb;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT result INTO v_stored_result
        FROM public.bulk_assign_idempotency
        WHERE key = p_idempotency_key;
        IF FOUND THEN
            RETURN v_stored_result;
        END IF;
    END IF;

    IF v_caller IS NOT NULL AND NOT (
           public.is_manager_or_above()
           OR public.is_admin()
           OR EXISTS (
                SELECT 1 FROM public.app_access_certificates c
                WHERE c.user_id = v_caller
                  AND c.is_active = true
                  AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
              )
         ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Not authorized to assign shifts',
            'total_requested', 0,
            'success_count', 0,
            'conflict_count', 0,
            'conflicts', '[]'::jsonb,
            'per_employee', '[]'::jsonb
        );
    END IF;

    IF p_user_id IS NOT NULL THEN
        SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
               left(lower(legacy_system_role::text), 50)
        INTO v_user_name, v_user_role
        FROM public.profiles
        WHERE id = p_user_id;
    ELSE
        v_user_name := 'System';
        v_user_role := 'system_automation';
    END IF;

    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_assignments)
    LOOP
        v_employee_id := (v_pair->>'employee_id')::uuid;
        v_shift_ids   := ARRAY(
            SELECT (elem::text)::uuid
            FROM jsonb_array_elements_text(v_pair->'shift_ids') AS elem
        );
        v_pair_total    := array_length(v_shift_ids, 1);
        v_pair_success  := 0;
        v_pair_conflicts := '[]'::jsonb;
        v_updated_ids   := '{}';

        IF v_pair_total IS NULL OR v_pair_total = 0 THEN
            CONTINUE;
        END IF;

        v_total_requested := v_total_requested + v_pair_total;

        WITH updated_rows AS (
            UPDATE public.shifts s SET
                assigned_employee_id = v_employee_id,
                assignment_status    = 'assigned'::public.shift_assignment_status,
                assignment_outcome   = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN 'confirmed'::public.shift_assignment_outcome
                                         ELSE s.assignment_outcome
                                       END,
                confirmed_at         = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN NOW()
                                         ELSE s.confirmed_at
                                       END,
                updated_at           = NOW(),
                last_modified_by     = p_user_id
            WHERE s.id = ANY(v_shift_ids)
              AND s.deleted_at IS NULL
              AND (s.assigned_employee_id IS NULL OR s.assigned_employee_id = v_employee_id)
            RETURNING s.id
        )
        SELECT array_agg(id) INTO v_updated_ids FROM updated_rows;

        IF v_updated_ids IS NULL THEN
            v_updated_ids := '{}';
        END IF;

        v_pair_success := array_length(v_updated_ids, 1);
        IF v_pair_success IS NULL THEN v_pair_success := 0; END IF;

        FOREACH v_shift_id IN ARRAY v_shift_ids LOOP
            IF NOT (v_shift_id = ANY(v_updated_ids)) THEN
                v_pair_conflicts := v_pair_conflicts || to_jsonb(v_shift_id::text);
                v_all_conflicts  := v_all_conflicts  || to_jsonb(v_shift_id::text);
            END IF;
        END LOOP;

        v_total_success  := v_total_success  + v_pair_success;
        v_total_conflict := v_total_conflict + (v_pair_total - v_pair_success);

        v_per_employee := v_per_employee || jsonb_build_object(
            'employee_id', v_employee_id,
            'committed',   v_pair_success,
            'conflicts',   v_pair_conflicts
        );
    END LOOP;

    v_final_result := jsonb_build_object(
        'success',         true,
        'total_requested', v_total_requested,
        'success_count',   v_total_success,
        'conflict_count',  v_total_conflict,
        'conflicts',       v_all_conflicts,
        'per_employee',    v_per_employee
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.bulk_assign_idempotency (key, result)
        VALUES (p_idempotency_key, v_final_result)
        ON CONFLICT (key) DO NOTHING;
    END IF;

    RETURN v_final_result;

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_assign_atomic: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'total_requested', v_total_requested,
        'success_count', 0,
        'conflict_count', 0,
        'conflicts', '[]'::jsonb,
        'per_employee', '[]'::jsonb
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_emergency_assign(p_shift_id uuid, p_employee_id uuid, p_reason text DEFAULT 'Emergency assignment'::text, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'manager')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'system');

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state NOT IN ('S4', 'S5') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_emergency_assign requires state S4 or S5, current state is %s', v_state));
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = p_employee_id,
    assigned_at = NOW(),
    assignment_status = 'assigned'::public.shift_assignment_status,
    assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
    assignment_source = 'direct',
    bidding_status = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding = FALSE,
    fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
    confirmed_at = NOW(),
    compliance_checked_at = NOW(),
    last_modified_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4', 'assigned_to', p_employee_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(p_shift_id uuid, p_winner_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift     RECORD;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

  UPDATE public.shift_bids SET status = 'accepted', updated_at = now()
  WHERE shift_id = p_shift_id AND employee_id = p_winner_id;

  UPDATE public.shift_bids SET status = 'rejected', updated_at = now()
  WHERE shift_id = p_shift_id AND employee_id != p_winner_id
    AND status = 'pending';

  UPDATE public.shifts SET
    assigned_employee_id = p_winner_id,
    assignment_status    = 'assigned'::public.shift_assignment_status,
    assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding        = FALSE,
    fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
    updated_at           = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true);
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_unassign_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shift RECORD; v_state text; v_to_state text;
  v_user_name text; v_user_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S2', 'S3', 'S4') THEN
    RETURN jsonb_build_object('success', false, 'error', format('Cannot unassign from state %s (requires S2, S3, or S4)', v_state));
  END IF;

  v_to_state := CASE WHEN v_shift.lifecycle_status = 'Published' THEN 'S5' ELSE 'S1' END;
  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = CASE WHEN v_shift.lifecycle_status = 'Published'
                                THEN 'on_bidding'::public.shift_bidding_status
                                ELSE 'not_on_bidding'::public.shift_bidding_status END,
    is_on_bidding        = (v_shift.lifecycle_status = 'Published'),
    fulfillment_status   = CASE WHEN v_shift.lifecycle_status = 'Published'
                                THEN 'bidding'::public.shift_fulfillment_status
                                ELSE 'none'::public.shift_fulfillment_status END,
    confirmed_at         = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END; $function$;

DROP FUNCTION IF EXISTS public.set_emergency_source(text, integer, text);

-- ── 2. Recreate v_shifts_grouped without is_urgent ───────────────────────────
DROP VIEW IF EXISTS public.v_shifts_grouped;
CREATE VIEW public.v_shifts_grouped AS
 SELECT id, roster_id, department_id, sub_department_id, role_id, shift_date,
    start_time, end_time, break_minutes, notes, is_recurring, recurrence_rule,
    confirmed_at, created_at, updated_at, assignment_id, organization_id,
    remuneration_level_id, actual_hourly_rate, bidding_close_at, bidding_enabled,
    bidding_open_at, shift_group_id, version, created_by_user_id, last_modified_by,
    last_modified_reason, deleted_at, deleted_by, roster_date, template_id,
    template_group, template_sub_group, is_from_template, template_instance_id,
    group_type, sub_group_name, display_order, role_level, remuneration_rate,
    currency, cost_center_id, scheduled_start, scheduled_end, is_overnight,
    scheduled_length_minutes, net_length_minutes, paid_break_minutes,
    unpaid_break_minutes, timezone, assigned_employee_id, assigned_at, is_cancelled,
    cancelled_at, cancelled_by_user_id, cancellation_reason, is_on_bidding,
    bidding_priority_text, trade_requested_at, required_skills, required_licenses,
    eligibility_snapshot, event_ids, tags, compliance_snapshot, compliance_checked_at,
    compliance_override, compliance_override_reason, published_at, published_by_user_id,
    is_locked, lock_reason_text, timesheet_id, actual_start, actual_end,
    actual_net_minutes, payroll_exported, cancelled_by, required_certifications,
    event_tags, user_contract_id, assignment_status, fulfillment_status,
    offer_expires_at, attendance_status, assignment_outcome, bidding_status,
    trading_status, lifecycle_status, roster_shift_id, bidding_opened_at,
    roster_template_id, roster_subgroup_id, total_hours, is_draft, is_published,
    template_sub_group AS template_subgroup_text
   FROM shifts s;

-- ── 3. Drop the dead behavioural-flag columns ────────────────────────────────
ALTER TABLE public.shifts DROP COLUMN IF EXISTS is_urgent;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS emergency_source;
