-- =====================================================================
-- Performance metrics fix — Part 1 of 4: complete write-side event capture
-- =====================================================================
-- Problem: ignored/expired direct offers never reached the Performance page.
-- Root cause (confirmed against prod srfozdlphoempdattvtx):
--   * shift_events is the event-sourced ledger behind metrics. The shifts-table
--     trigger fn_capture_shift_event already emits OFFERED/ASSIGNED/ACCEPTED/etc,
--     BUT it has NO branch for the offer-expiry transition. fn_process_offer_expirations
--     reverts an offered shift to Draft (fulfillment_status 'offered'->'none',
--     assigned_employee_id KEPT, lifecycle 'Published'->'Draft') — which fires none
--     of the trigger's branches, so the IGNORED fact was lost entirely (0 IGNORED
--     events in prod despite 805 reverted-to-Draft shifts).
--   * fn_capture_offer_event (on the vestigial, currently-empty shift_offers table)
--     compares lowercase 'accepted'/'rejected'/'expired' against the CHECK-constrained
--     capitalized 'Accepted'/'Declined'/'Expired' — a dead trigger.
--   * sm_decline_offer and sm_reject_offer(uuid,uuid,text) never emit REJECTED.
--
-- This migration makes the offer-behaviour domain (OFFERED/ACCEPTED/REJECTED/IGNORED)
-- captured going forward. It changes NO read path (see Part 3) and is purely additive.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Emit IGNORED when an offer auto-expires / is auto-retracted.
--    (Re-creates the prod body verbatim, adding only the shift_events INSERT.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_offer_expirations()
 RETURNS TABLE(res_shift_id uuid, from_state text, to_state text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift       RECORD;
    v_new_state   TEXT := 'S2';
    v_shift_start TIMESTAMPTZ;
BEGIN
    FOR v_shift IN
        SELECT s.*
        FROM public.shifts s
        WHERE s.lifecycle_status   = 'Published'
          AND s.assignment_status  = 'assigned'
          AND s.assignment_outcome IS NULL
          AND s.deleted_at         IS NULL
          AND (
              (s.offer_expires_at IS NOT NULL AND s.offer_expires_at < NOW())
              OR
              (
                COALESCE(
                    s.start_at,
                    (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                        AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                ) < (NOW() + INTERVAL '4 hours')
              )
          )
        FOR UPDATE SKIP LOCKED
    LOOP
        v_shift_start := COALESCE(
            v_shift.start_at,
            (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP
                AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
        );

        UPDATE public.shift_offers
        SET
            status         = 'Expired',
            responded_at   = NOW(),
            response_notes = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Auto-expired: deadline passed'
                ELSE 'Auto-retracted: 4h pre-shift lockout reached'
            END
        WHERE shift_id = v_shift.id
          AND status   = 'Pending';

        UPDATE public.shifts
        SET
            lifecycle_status     = 'Draft',
            assignment_status    = 'assigned',
            assignment_outcome   = NULL,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            is_on_bidding        = FALSE,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            updated_at           = NOW(),
            last_modified_reason = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Offer expired - Reverted to Draft Assigned'
                ELSE '4h Lockout - Auto-retracted to Draft Assigned'
            END
        WHERE id = v_shift.id;

        -- NEW: record the IGNORED fact on the immutable ledger so it survives the
        -- Draft reversion (the whole reason ignored offers were invisible on the
        -- Performance page). Attributed to the employee the offer was sitting with.
        IF v_shift.assigned_employee_id IS NOT NULL THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (
                v_shift.id,
                v_shift.assigned_employee_id,
                'IGNORED',
                COALESCE(v_shift.offer_expires_at, NOW()),
                jsonb_build_object(
                    'source', 'fn_process_offer_expirations',
                    'reason', CASE
                        WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                            THEN 'offer_expired'
                        ELSE 'pre_shift_lockout'
                    END
                )
            );
        END IF;

        res_shift_id := v_shift.id;
        from_state   := 'S3';
        to_state     := v_new_state;
        RETURN NEXT;
    END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. Un-break the shift_offers trigger (case + vocabulary).
--    shift_offers is currently unused (0 rows) — the canonical capture point is
--    the shifts-table trigger fn_capture_shift_event. This fix makes the trigger
--    correct IF that table is ever adopted; it cannot fire today.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_capture_offer_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF (NEW.status = 'Accepted' AND OLD.status IS DISTINCT FROM 'Accepted') THEN
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
        VALUES (NEW.shift_id, NEW.employee_id, 'ACCEPTED', COALESCE(NEW.responded_at, now()));
    ELSIF (NEW.status = 'Declined' AND OLD.status IS DISTINCT FROM 'Declined') THEN
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
        VALUES (NEW.shift_id, NEW.employee_id, 'REJECTED', COALESCE(NEW.responded_at, now()));
    ELSIF (NEW.status = 'Expired' AND OLD.status IS DISTINCT FROM 'Expired') THEN
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
        VALUES (NEW.shift_id, NEW.employee_id, 'IGNORED', COALESCE(NEW.responded_at, now()));
    END IF;
    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Emit REJECTED on decline (sm_decline_offer). Body verbatim + ledger INSERT.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sm_decline_offer(p_shift_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_state_id TEXT;
    v_performer_name TEXT;
    v_new_iter INT;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    v_state_id := get_shift_state_id(p_shift_id);

    IF v_state_id != 'S3' THEN
        RETURN jsonb_build_object('success', false, 'error', format('Cannot decline from state %s. Expected S3.', v_state_id));
    END IF;

    SELECT COALESCE(p.full_name, p.first_name || ' ' || p.last_name, au.email, 'System')
    INTO v_performer_name
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE au.id = p_user_id;

    IF v_performer_name IS NULL THEN
        v_performer_name := 'Unknown User';
    END IF;

    v_new_iter := COALESCE(v_shift.bidding_iteration, 1) + 1;

    UPDATE shifts
    SET
        assigned_employee_id = NULL,
        assignment_status = 'unassigned',
        assignment_outcome = NULL,
        bidding_status = 'on_bidding_normal',
        is_on_bidding = true,
        bidding_opened_at = NOW(),
        fulfillment_status = 'bidding',
        trading_status = 'NoTrade',
        bidding_iteration = v_new_iter,
        last_rejected_by = p_user_id,
        last_dropped_by = NULL,
        updated_at = NOW(),
        last_modified_by = p_user_id,
        last_modified_reason = 'Offer declined'
    WHERE id = p_shift_id;

    -- NEW: record the REJECTED fact for performance metrics.
    INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
    VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_decline_offer'));

    RETURN jsonb_build_object('success', true, 'from_state', 'S3', 'to_state', 'S5');
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. Emit REJECTED on the 3-arg sm_reject_offer (the 2-arg overload already does).
--    Body verbatim + ledger INSERT.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sm_reject_offer(p_shift_id uuid, p_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text;
BEGIN
  -- 1. Get shift and lock it
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  -- 2. Authorization check: Only the assigned employee can reject their own offer
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You can only reject shifts offered to you');
  END IF;

  -- 3. State check: Must be in S3 (Published + Offered)
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_reject_offer requires state S3, current state is %s', v_state));
  END IF;

  -- 4. Transition S3 -> S5 (Bidding)
  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    is_on_bidding        = TRUE,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_rejected_by     = p_user_id,
    last_dropped_by      = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  -- 5. Log the event for permanent history (parity with the 2-arg overload).
  INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
  VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_reject_offer', 'reason', p_reason));

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S5');
END;
$function$;
