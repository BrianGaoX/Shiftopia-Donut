-- ============================================================================
-- REMOVE S8 (Published + Unassigned + bidding_closed_no_winner)
-- ============================================================================
-- S8 was never a resting state — every path that wrote `bidding_closed_no_winner`
-- immediately reverted the row to S1 (Draft + Unassigned) inside the SAME
-- transaction. The only purpose of the S8 hop was to make the (now-deleted)
-- `fn_audit_shift_update` trigger emit a BIDDING_TIMEOUT event before UNPUBLISH.
-- That audit function no longer exists, so the intermediate state is pure dead
-- weight. Worse, it actively SUPPRESSES the manager "no winner" notification:
--
--   trg_bidding_expired_notification_fn fires only on a DIRECT transition
--     OLD.bidding_status IN (active bidding) -> NEW.bidding_status = not_on_bidding
--   The two-step hop breaks that:
--     2a) OLD=on_bidding      NEW=bidding_closed_no_winner  (NEW != not_on_bidding -> skip)
--     2b) OLD=bidding_closed_no_winner NEW=not_on_bidding   (OLD not active     -> skip)
--   => the notification never fires for the every-minute timer path.
--
-- Collapsing S5/S6 -> S1 into a single UPDATE removes the dead state AND repairs
-- the manager notification (it now fires correctly on timeout / manual close).
--
-- Verified before writing:
--   * 0 rows currently at bidding_closed_no_winner.
--   * Scheduled producers: process_shift_timers (every min), sm_close_bidding (app).
--     sm_run_state_processor (15-min) ALREADY does a direct S5/S6 -> S1.
--   * Dormant duplicate producers (not scheduled, not called by app, not called by
--     any other DB function): sm_process_time_transitions(), close_bidding_no_winner/1,
--     close_bidding_no_winner/3 -> dropped here.
--   * validate_shift_state_invariants accepts (Draft, unassigned, not_on_bidding).
--   * fn_capture_shift_event ignores bidding_status changes (event stream unchanged).
--
-- The `bidding_closed_no_winner` ENUM value is intentionally LEFT in place as a
-- tombstone: Postgres cannot drop an enum value without recreating the type, and
-- the FSM derivers (get_shift_fsm_state / get_shift_state_id) keep their inert S8
-- branch as defensive dead code. Nothing writes the value any more.
-- ============================================================================

-- ── 1. process_shift_timers: collapse 2a+2b into a single direct S5/S6 -> S1 ──
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

    -- 2. Bidding timeout S5/S6 → S1 (direct; no S8 hop).
    --    A single UPDATE so trg_bidding_expired_notification_fn fires the manager
    --    "Bidding Closed — No Winner" notification.
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Draft',
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            is_on_bidding        = FALSE,
            is_urgent            = FALSE,
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

-- ── 2. sm_close_bidding (manual "withdraw from bidding"): direct S5/S6 -> S1 ──
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

    -- Single direct transition S5/S6 -> S1 (no S8 hop). This fires
    -- trg_bidding_expired_notification_fn (manager "no winner" notice).
    UPDATE public.shifts
    SET
        lifecycle_status     = 'Draft',
        bidding_status       = 'not_on_bidding',
        is_on_bidding        = FALSE,
        is_urgent            = FALSE,
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

-- ── 3. Drop dormant duplicate producers that PERSIST S8 (footguns) ──
--    None are scheduled, called by the app, or called by any other DB function.
DROP FUNCTION IF EXISTS public.sm_process_time_transitions();
DROP FUNCTION IF EXISTS public.close_bidding_no_winner(uuid);
DROP FUNCTION IF EXISTS public.close_bidding_no_winner(uuid, uuid, text);
