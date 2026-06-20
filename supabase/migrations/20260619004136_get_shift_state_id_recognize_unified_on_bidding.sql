-- ============================================================================
-- FIX: get_shift_state_id must recognize the unified 'on_bidding' value
-- ============================================================================
-- The S6 collapse (20260619000000) made the PRODUCER path emit a single unified
-- 'on_bidding' for every published-unassigned-bidding shift (get_publish_target_state
-- + publish_shift). But the DB state DERIVER get_shift_state_id (BOTH overloads)
-- was left with only the split tombstone branches:
--     on_bidding_normal -> S5
--     on_bidding_urgent -> S6
-- and NO branch for 'on_bidding'. So a freshly-published bidding shift derives to
-- 'INVALID', which breaks every S5/S6-gated path that routes through this deriver:
--     * sm_close_bidding        gate: state IN ('S5','S6')           -> manual "withdraw from bidding" blocked
--     * sm_emergency_assign /a   gate: state IN ('S5','S6','S8','S15') -> EMERGENCY COVER onto a bidding shift blocked
-- Latent only because there are 0 live bidding rows right now; it bites the next
-- published-unassigned shift.
--
-- Fix: widen the S5 branch to 'on_bidding' AS WELL AS the legacy 'on_bidding_normal'
-- tombstone. S6 keeps the 'on_bidding_urgent' tombstone branch (now never produced)
-- so historical/edge rows still derive correctly. Strictly additive: 'on_bidding'
-- went from INVALID -> S5; the split values are unchanged.
--
-- NOTE: the slim deriver get_shift_fsm_state does NOT read bidding_status (maps
-- Published+unassigned -> S5 regardless), so it already handles 'on_bidding' and is
-- intentionally left untouched. Only the bidding-aware get_shift_state_id needs this.
-- ============================================================================

-- ── Overload 1: get_shift_state_id(p_shift_id uuid) — reads the row ───────────
CREATE OR REPLACE FUNCTION public.get_shift_state_id(p_shift_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
BEGIN
    SELECT
        lifecycle_status::TEXT  as lifecycle,
        assignment_status::TEXT as assignment,
        assignment_outcome::TEXT as outcome,
        bidding_status::TEXT    as bidding,
        trading_status::TEXT    as trading
    INTO v_shift
    FROM shifts
    WHERE id = p_shift_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN CASE
        -- S1: Draft + Unassigned
        WHEN v_shift.lifecycle = 'Draft' AND v_shift.assignment = 'unassigned' THEN 'S1'
        -- S2: Draft + Assigned
        WHEN v_shift.lifecycle = 'Draft' AND v_shift.assignment = 'assigned' THEN 'S2'
        -- S3: Published + Offered (awaiting decision)
        WHEN v_shift.lifecycle = 'Published' AND v_shift.assignment = 'assigned' AND (v_shift.outcome IS NULL OR v_shift.outcome = 'offered') THEN 'S3'
        -- S4: Published + Confirmed + NoTrade
        WHEN v_shift.lifecycle = 'Published' AND v_shift.outcome = 'confirmed' AND v_shift.trading = 'NoTrade' THEN 'S4'
        -- S5: Published + OnBidding (unified) | legacy OnBiddingNormal tombstone
        WHEN v_shift.lifecycle = 'Published' AND v_shift.bidding IN ('on_bidding', 'on_bidding_normal') THEN 'S5'
        -- S6: Published + OnBiddingUrgent (legacy tombstone — no longer produced)
        WHEN v_shift.lifecycle = 'Published' AND v_shift.bidding = 'on_bidding_urgent' THEN 'S6'
        -- S7: Published + EmergencyAssigned (tombstone)
        WHEN v_shift.lifecycle = 'Published' AND v_shift.outcome = 'emergency_assigned' THEN 'S7'
        -- S8: Published + BiddingClosedNoWinner (tombstone)
        WHEN v_shift.lifecycle = 'Published' AND v_shift.bidding = 'bidding_closed_no_winner' THEN 'S8'
        -- S9: Published + Confirmed + TradeRequested
        WHEN v_shift.lifecycle = 'Published' AND v_shift.outcome = 'confirmed' AND v_shift.trading = 'TradeRequested' THEN 'S9'
        -- S10: Published + Confirmed + TradeAccepted
        WHEN v_shift.lifecycle = 'Published' AND v_shift.outcome = 'confirmed' AND v_shift.trading = 'TradeAccepted' THEN 'S10'
        -- S11: InProgress + Confirmed
        WHEN v_shift.lifecycle = 'InProgress' AND v_shift.outcome = 'confirmed' THEN 'S11'
        -- S12: InProgress + EmergencyAssigned (tombstone)
        WHEN v_shift.lifecycle = 'InProgress' AND v_shift.outcome = 'emergency_assigned' THEN 'S12'
        -- S13: Completed + Confirmed
        WHEN v_shift.lifecycle = 'Completed' AND v_shift.outcome = 'confirmed' THEN 'S13'
        -- S14: Completed + EmergencyAssigned (tombstone)
        WHEN v_shift.lifecycle = 'Completed' AND v_shift.outcome = 'emergency_assigned' THEN 'S14'
        -- S15: Cancelled
        WHEN v_shift.lifecycle = 'Cancelled' THEN 'S15'
        ELSE 'INVALID'
    END;
END;
$function$;

-- ── Overload 2: get_shift_state_id(lifecycle, assignment, outcome, bidding, trading) ──
CREATE OR REPLACE FUNCTION public.get_shift_state_id(p_lifecycle shift_lifecycle, p_assignment shift_assignment_status, p_outcome shift_assignment_outcome, p_bidding shift_bidding_status, p_trading shift_trading)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN CASE
    -- S1: Draft + Unassigned
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'unassigned'
         AND p_outcome IS NULL AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S1'
    -- S2: Draft + Assigned + Pending
    WHEN p_lifecycle = 'Draft' AND p_assignment = 'assigned'
         AND (p_outcome IS NULL OR p_outcome = 'pending') AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S2'
    -- S3: Published + Assigned + Offered
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned'
         AND (p_outcome IS NULL OR p_outcome = 'offered') AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S3'
    -- S4: Published + Assigned + Confirmed
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned'
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S4'
    -- S5: Published + Unassigned + OnBidding (unified) | legacy OnBiddingNormal tombstone
    WHEN p_lifecycle = 'Published' AND p_assignment = 'unassigned'
         AND p_outcome IS NULL AND p_bidding IN ('on_bidding', 'on_bidding_normal') AND p_trading = 'NoTrade'
         THEN 'S5'
    -- S6: Published + Unassigned + OnBiddingUrgent (legacy tombstone — no longer produced)
    WHEN p_lifecycle = 'Published' AND p_assignment = 'unassigned'
         AND p_outcome IS NULL AND p_bidding = 'on_bidding_urgent' AND p_trading = 'NoTrade'
         THEN 'S6'
    -- S7: Published + Assigned + EmergencyAssigned (tombstone)
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned'
         AND p_outcome = 'emergency_assigned' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S7'
    -- S8: Published + Unassigned + BiddingClosedNoWinner (tombstone)
    WHEN p_lifecycle = 'Published' AND p_assignment = 'unassigned'
         AND p_outcome IS NULL AND p_bidding = 'bidding_closed_no_winner' AND p_trading = 'NoTrade'
         THEN 'S8'
    -- S9: Published + Confirmed + TradeRequested
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned'
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'TradeRequested'
         THEN 'S9'
    -- S10: Published + Confirmed + TradeAccepted
    WHEN p_lifecycle = 'Published' AND p_assignment = 'assigned'
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'TradeAccepted'
         THEN 'S10'
    -- S11: InProgress + Assigned + Confirmed
    WHEN p_lifecycle = 'InProgress' AND p_assignment = 'assigned'
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S11'
    -- S12: InProgress + Assigned + EmergencyAssigned (tombstone)
    WHEN p_lifecycle = 'InProgress' AND p_assignment = 'assigned'
         AND p_outcome = 'emergency_assigned' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S12'
    -- S13: Completed + Assigned + Confirmed
    WHEN p_lifecycle = 'Completed' AND p_assignment = 'assigned'
         AND p_outcome = 'confirmed' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S13'
    -- S14: Completed + Assigned + EmergencyAssigned (tombstone)
    WHEN p_lifecycle = 'Completed' AND p_assignment = 'assigned'
         AND p_outcome = 'emergency_assigned' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         THEN 'S14'
    -- S15: Cancelled
    WHEN p_lifecycle = 'Cancelled' AND p_bidding = 'not_on_bidding' AND p_trading = 'NoTrade'
         AND p_outcome IS NULL
         THEN 'S15'
    ELSE 'INVALID'
  END;
END;
$function$;
