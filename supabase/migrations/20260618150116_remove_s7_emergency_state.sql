-- Remove S7: emergency-assign lands in S4 (confirmed), not emergency_assigned.
-- Only emergency_assign_shift/4 and sm_emergency_assign(uuid,uuid,uuid,text) write
-- the emergency_assigned outcome; flip both to 'confirmed'. The emergency_assigned
-- enum value is left as an inert tombstone. Emergency notification stays (TTS-gated).

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
