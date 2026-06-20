-- Consolidate the DB shift-state derivation onto ONE canonical function that
-- mirrors the client `determineShiftState` (shift-fsm.ts) exactly: lenient
-- (returns 'UNKNOWN' for unrecognized combos), reads bidding_status, and emits
-- the full S1–S15 set incl S6/S7/S8/S12/S14.
--
-- get_shift_fsm_state was the only slim derivation (no bidding_status, no
-- S6/S7/S8) and is called positionally with 5 args by ~15 sm_* handlers +
-- validate_shift_state_invariants. We DROP it and recreate with bidding_status
-- as a trailing DEFAULT NULL param, so those 5-arg calls still resolve here
-- (bidding NULL ⇒ Published+unassigned ⇒ S5, exactly as before). The only
-- derivation delta is emergency_assigned ⇒ S7/S12/S14 (0 such rows today).

DROP FUNCTION IF EXISTS public.get_shift_fsm_state(
  shift_lifecycle, shift_assignment_status, shift_assignment_outcome, shift_trading, boolean);

CREATE FUNCTION public.get_shift_fsm_state(
  p_lifecycle_status  shift_lifecycle,
  p_assignment_status shift_assignment_status,
  p_assignment_outcome shift_assignment_outcome,
  p_trading_status    shift_trading,
  p_is_cancelled      boolean,
  p_bidding_status    shift_bidding_status DEFAULT NULL
) RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF COALESCE(p_is_cancelled, FALSE) OR p_lifecycle_status = 'Cancelled' THEN RETURN 'S15'; END IF;

  IF p_lifecycle_status = 'Completed' THEN
    RETURN CASE WHEN p_assignment_outcome = 'emergency_assigned' THEN 'S14' ELSE 'S13' END;
  END IF;

  IF p_lifecycle_status = 'InProgress' THEN
    RETURN CASE WHEN p_assignment_outcome = 'emergency_assigned' THEN 'S12' ELSE 'S11' END;
  END IF;

  IF p_lifecycle_status = 'Published' THEN
    IF p_trading_status = 'TradeRequested' THEN RETURN 'S9';  END IF;
    IF p_trading_status = 'TradeAccepted'  THEN RETURN 'S10'; END IF;
    IF p_assignment_outcome = 'emergency_assigned' THEN RETURN 'S7'; END IF;

    IF p_assignment_status = 'assigned' THEN
      IF p_assignment_outcome = 'confirmed' THEN RETURN 'S4'; END IF;
      RETURN 'S3';   -- NULL / pending / offered → awaiting decision
    END IF;

    -- Unassigned + published = bidding lifecycle
    IF p_bidding_status = 'bidding_closed_no_winner' THEN RETURN 'S8'; END IF;
    IF p_bidding_status = 'on_bidding_urgent'        THEN RETURN 'S6'; END IF;
    RETURN 'S5';   -- on_bidding / on_bidding_normal / not_on_bidding / NULL
  END IF;

  IF p_lifecycle_status = 'Draft' THEN
    RETURN CASE WHEN p_assignment_status = 'assigned' THEN 'S2' ELSE 'S1' END;
  END IF;

  RETURN 'UNKNOWN';
END;
$function$;

-- fn_shift_state: collapse onto the canonical (was a near-duplicate text-arg
-- variant that returned UNKNOWN for the unified 'on_bidding' value).
CREATE OR REPLACE FUNCTION public.fn_shift_state(
  p_lifecycle_status text, p_assignment_status text, p_assignment_outcome text,
  p_bidding_status text, p_trading_status text, p_is_cancelled boolean
) RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.get_shift_fsm_state(
    p_lifecycle_status::shift_lifecycle,
    p_assignment_status::shift_assignment_status,
    NULLIF(p_assignment_outcome, '')::shift_assignment_outcome,
    NULLIF(p_trading_status, '')::shift_trading,
    COALESCE(p_is_cancelled, FALSE),
    NULLIF(p_bidding_status, '')::shift_bidding_status
  );
END;
$function$;

-- resolve_shift_state: dead (0 callers) — remove the duplicate.
DROP FUNCTION IF EXISTS public.resolve_shift_state(
  shift_lifecycle, shift_assignment_status, shift_assignment_outcome, shift_bidding_status, shift_trading);
