-- process_shift_timers step 2a only matched the LEGACY split bidding values
-- ('on_bidding_normal'/'on_bidding_urgent'); the app now writes the unified
-- 'on_bidding', so bidding never timed out (stuck "S5*"). Add 'on_bidding'.
-- All other steps are verbatim.
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

    -- 2a. Bidding timeout S5/S6 → S8  (triggers BIDDING_TIMEOUT in fn_audit_shift_update)
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
