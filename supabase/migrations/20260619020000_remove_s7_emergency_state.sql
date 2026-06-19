-- ============================================================================
-- REMOVE S7 (Published + Assigned + assignment_outcome = 'emergency_assigned')
-- ============================================================================
-- PHASE 1 of 2.  Emergency assignment is not a distinct state — it is a normal
-- direct manager assignment that happens under the 4h lock. The capability it
-- provides (assign straight to confirmed, skip the offer/accept round-trip)
-- already exists in select_bid_winner and sm_bulk_assign. The "this was filled
-- under the gun" signal is a TIME fact:
--   * the emergency notification (trg_emergency_assignment_notification_fn) fires
--     on assigned_employee_id NULL->non-null AND TTS<4h — TIME-gated, not
--     outcome-gated. It KEEPS WORKING after this change.
--   * urgency/emergency display is derived from TTS at read time (computeShiftUrgency
--     / getTimeRule), not from a stored flag.
--
-- Decision (user): pure time-derived — emergency stops being a persisted state.
-- This phase makes emergency-assign land in S4 (confirmed); the client stops
-- reading emergency_source / emergency_assigned for display.
--
-- Only TWO functions actually WRITE the `emergency_assigned` outcome:
--   * emergency_assign_shift/4
--   * sm_emergency_assign(uuid,uuid,uuid,text)   [the "/a" overload]
-- (sm_emergency_assign(uuid,uuid,text,uuid) "/b" already writes 'confirmed';
--  sm_bulk_emergency_assign delegates to it. Left untouched here.)
--
-- The `emergency_assigned` enum value (shift_assignment_outcome) is LEFT as an
-- inert tombstone. Auto-start's IN-list still lists it (tombstone-compatible),
-- and the slim client FSM now correctly maps these shifts to S4 (Confirmed)
-- instead of the previous S3 mislabel.
--
-- PHASE 2 (separate migration) will: strip the residual is_urgent / emergency_source
-- WRITES from publish_shift / process_shift_timers / sm_close_bidding /
-- push_shift_to_bidding_on_cancel / recalculate_shift_urgency / sm_bulk_assign /
-- sm_bulk_assign_atomic / sm_select_bid_winner / sm_unassign_shift, then DROP the
-- dead columns (is_urgent, emergency_source, emergency_assigned_at, emergency_assigned_by)
-- — which also needs v_shifts_grouped recreated (uses is_urgent) and
-- idx_shifts_emergency_assigned_by dropped, plus a types regen.
-- ============================================================================

-- 1. emergency_assign_shift: write 'confirmed' (S4), stop writing the S7 markers.
CREATE OR REPLACE FUNCTION public.emergency_assign_shift(p_shift_id uuid, p_employee_id uuid, p_assigned_by uuid, p_reason text DEFAULT 'Emergency assignment'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_compliance RECORD;
BEGIN
    SELECT * INTO v_shift
    FROM shifts WHERE id = p_shift_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    IF v_shift.lifecycle_status != 'Published'
       OR v_shift.assigned_employee_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift cannot be emergency assigned');
    END IF;

    SELECT * INTO v_compliance
    FROM check_shift_compliance(v_shift.roster_shift_id, p_employee_id);

    IF v_compliance.compliance_status = 'blocked' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Compliance check failed', 'violations', v_compliance.violations);
    END IF;

    -- Direct manager fill under the 4h lock -> S4 (confirmed). Urgency/emergency is
    -- derived from TTS at read time; the TTS-gated emergency notification still fires.
    UPDATE shifts SET
        assigned_employee_id = p_employee_id,
        assigned_at = NOW(),
        assignment_status = 'assigned'::shift_assignment_status,
        assignment_outcome = 'confirmed'::shift_assignment_outcome,
        fulfillment_status = 'fulfilled'::shift_fulfillment_status,
        confirmed_at = NOW(),
        is_on_bidding = FALSE,
        bidding_status = 'not_on_bidding'::shift_bidding_status,
        locked_at = COALESCE(locked_at, NOW()),
        offer_expires_at = NULL,
        offer_sent_at = NULL,
        eligibility_snapshot = v_compliance.eligibility_snapshot,
        compliance_checked_at = NOW(),
        updated_at = NOW(),
        last_modified_by = p_assigned_by,
        last_modified_reason = p_reason
    WHERE id = p_shift_id;

    -- Expire any pending offers
    UPDATE public.shift_offers
    SET status = 'Expired', responded_at = NOW(), response_notes = 'Superseded by direct assignment'
    WHERE shift_id = p_shift_id AND status = 'Pending';

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'employee_id', p_employee_id,
        'transition', 'S5 -> S4',
        'new_state', 'confirmed'
    );
END;
$function$;

-- 2. sm_emergency_assign/a (uuid,uuid,uuid,text): write 'confirmed' (S4), not S7.
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(p_shift_id uuid, p_employee_id uuid, p_user_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_state TEXT;
    v_compliance RECORD;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id=p_shift_id AND deleted_at IS NULL FOR UPDATE;
    v_state := get_shift_state_id(p_shift_id);

    IF v_state NOT IN ('S5', 'S6', 'S8', 'S15') THEN
        RETURN jsonb_build_object('success', false, 'error', format('Cannot from %s', v_state));
    END IF;

    SELECT * INTO v_compliance FROM check_shift_compliance(v_shift.roster_shift_id, p_employee_id);

    IF v_compliance.compliance_status = 'blocked' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Compliance blocked');
    END IF;

    -- Direct fill -> S4 (confirmed). No emergency_assigned outcome.
    UPDATE shifts
    SET lifecycle_status='Published',
        is_published=TRUE,
        is_cancelled=FALSE,
        assigned_employee_id=p_employee_id,
        assigned_at=NOW(),
        assignment_status='assigned',
        assignment_outcome='confirmed',
        assignment_source='direct',
        fulfillment_status='fulfilled',
        confirmed_at=NOW(),
        is_on_bidding=FALSE,
        bidding_status='not_on_bidding',
        eligibility_snapshot=v_compliance.eligibility_snapshot,
        compliance_checked_at=NOW(),
        updated_at=NOW(),
        last_modified_by=p_user_id
    WHERE id=p_shift_id;

    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4');
END;
$function$;
