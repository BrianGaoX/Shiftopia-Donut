-- ENUM-VALUE DRIFT FIX (root cause of stuck "S5*" bidding and latent "S3*" offers)
--
-- The app writes the UNIFIED bidding value `on_bidding` and encodes an offered
-- shift (S3) as `assigned + assignment_outcome NULL`. But the timer processors
-- still filtered on the LEGACY values (`on_bidding_normal`/`on_bidding_urgent`)
-- and `assignment_outcome = 'offered'` — neither of which the app produces — so
-- bidding never timed out and offers never expired. Align the filters.
--
-- process_shift_timers() (every minute) is the authoritative processor.

-- 1. Bidding timeout: include the unified 'on_bidding'.
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
    -- 1. Expire pending offers S3 → S2
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation:='OFFER_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2a. Bidding timeout S5/S6 → S8
    WITH timed_out AS (
        UPDATE public.shifts SET
            bidding_status       = 'bidding_closed_no_winner'::shift_bidding_status,
            is_on_bidding        = FALSE,
            is_urgent            = FALSE,
            locked_at            = NOW(),
            updated_at           = NOW(),
            last_modified_reason = 'Bidding timeout: T-4h passed, no winner selected'
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

    -- 2b. S8 → S1: revert ALL bidding_closed_no_winner shifts to Draft+Unassigned.
    UPDATE public.shifts SET
        lifecycle_status     = 'Draft',
        bidding_status       = 'not_on_bidding'::shift_bidding_status,
        is_on_bidding        = FALSE,
        is_urgent            = FALSE,
        locked_at            = NULL,
        updated_at           = NOW(),
        last_modified_reason = 'Auto-reverted to draft after bidding closed with no winner'
    WHERE lifecycle_status  = 'Published'
      AND bidding_status    = 'bidding_closed_no_winner'::shift_bidding_status
      AND assignment_status = 'unassigned'
      AND deleted_at IS NULL;

    IF v_count > 0 THEN operation:='BIDDING_TIMEOUT'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3. Auto-start S4/S7 → S11/S12
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

    -- 4. Auto-complete S11/S12 → S13/S14
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

    -- 5. Expire open swap requests S9 → S4
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

-- 2. Offer expiry: match the real S3 encoding (assigned + outcome NULL),
--    not the never-written 'offered'.
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

        res_shift_id := v_shift.id;
        from_state   := 'S3';
        to_state     := v_new_state;
        RETURN NEXT;
    END LOOP;
END;
$function$;

-- 3. sm_run_state_processor (parallel 15-min processor) Pass 3 also matches the
--    unified 'on_bidding' — applied directly in 20260610010000 (Pass 3 IN-list),
--    which holds that procedure's full body. process_shift_timers above is the
--    authoritative every-minute path; sm_run_state_processor is the 15-min backup.
