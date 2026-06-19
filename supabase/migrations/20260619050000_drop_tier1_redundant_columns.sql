-- ============================================================================
-- DROP Tier-1 redundant / dead / duplicate columns from public.shifts
-- ============================================================================
-- Six columns, verified redundant against all 806 live rows + every DB
-- function/view + the client:
--   * final_call_sent_at    — 0 references anywhere, all NULL (dead).
--   * role_level            — all NULL, 0 fns; numeric level hierarchy retired
--                             (LEVEL_TOO_LOW -> ROLE_MISMATCH). Only a SELECT + DTO.
--   * assignment_id         — all NULL, legacy link to a removed assignments table.
--   * bidding_opened_at     — DUPLICATE of bidding_open_at (split-brain: some fns
--                             wrote one, some the other; both NULL). Consolidated
--                             onto bidding_open_at below.
--   * cancelled_by          — DUPLICATE of cancelled_by_user_id (both NULL); only
--                             the broken legacy cancel_shift(uuid,text) wrote it.
--   * bidding_priority_text — single-valued ('normal'); vestigial now that urgency
--                             is derived from time-to-start at read time.
--
-- Pre-drop rewrites (so nothing breaks at runtime):
--   1. bidding_opened_at writers redirected to bidding_open_at:
--        sm_decline_offer, sm_employee_cancel(/3), sm_bulk_publish_shifts.
--   2. sm_bulk_publish_shifts ALSO aligned to the unified model it was missed by
--      (S6/S7 collapse): it still produced split on_bidding_normal/on_bidding_urgent
--      + emergency_assigned. Now: S1->S5 'on_bidding'; S2+EMERGENCY->S4 'confirmed'
--      (was S7); S2->S3 offered. (Faithful: emergency-assign == direct confirm == S4.)
--   3. DROP the legacy cancel_shift(uuid,text) overload — it referenced
--      cancelled_by + bidding_priority_text AND several columns that no longer
--      exist (status, assignment_status_text, cancellation_reason_text, ...), so it
--      was already broken. Called by nothing (client uses sm_manager_cancel; the
--      live cancel_shift(uuid,uuid,text) overload uses cancelled_by_user_id).
--   4. v_shifts_grouped recreated without the 5 of these it passed through.
--
-- assign_employee_to_shift was a FALSE POSITIVE — its RETURNS TABLE column is named
-- assignment_id; it never touches shifts.assignment_id. Left untouched.
-- DROP COLUMN auto-drops idx_shifts_assignment, idx_shifts_cancelled_by, and FK
-- shifts_cancelled_by_fkey (all single-column on dropped columns).
-- ============================================================================

-- ── 1. sm_decline_offer: bidding_opened_at -> bidding_open_at ─────────────────
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
        bidding_status = 'on_bidding',
        is_on_bidding = true,
        bidding_open_at = NOW(),
        fulfillment_status = 'bidding',
        trading_status = 'NoTrade',
        bidding_iteration = v_new_iter,
        last_rejected_by = p_user_id,
        last_dropped_by = NULL,
        updated_at = NOW(),
        last_modified_by = p_user_id,
        last_modified_reason = 'Offer declined'
    WHERE id = p_shift_id;

    INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
    VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_decline_offer'));

    RETURN jsonb_build_object('success', true, 'from_state', 'S3', 'to_state', 'S5');
END;
$function$;

-- ── 2. sm_employee_cancel(/3): bidding_opened_at -> bidding_open_at ───────────
CREATE OR REPLACE FUNCTION public.sm_employee_cancel(p_shift_id uuid, p_employee_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_state TEXT;
    v_time TEXT;
    v_new TEXT;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id=p_shift_id AND deleted_at IS NULL FOR UPDATE;
    v_state := get_shift_state_id(p_shift_id);
    v_time := get_time_category(v_shift.scheduled_start);

    IF v_state != 'S4' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not S4');
    END IF;

    IF v_shift.assigned_employee_id != p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not your shift');
    END IF;

    IF v_time = 'PAST' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already started');
    END IF;

    IF v_time = 'EMERGENCY' THEN
        v_new := 'S15';
        UPDATE shifts
        SET lifecycle_status='Cancelled',
            is_cancelled=TRUE,
            cancelled_at=NOW(),
            assigned_employee_id=NULL,
            assignment_status='unassigned',
            assignment_outcome=NULL,
            updated_at=NOW(),
            last_modified_by=p_employee_id
        WHERE id=p_shift_id;
    ELSE
        v_new := 'S5';
        -- Reopen bidding (unified on_bidding); urgency derived from TTS at read time.
        UPDATE shifts
        SET assigned_employee_id=NULL,
            assignment_status='unassigned',
            assignment_outcome=NULL,
            is_on_bidding=TRUE,
            bidding_status='on_bidding',
            bidding_open_at=NOW(),
            updated_at=NOW(),
            last_modified_by=p_employee_id
        WHERE id=p_shift_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'from_state', 'S4', 'to_state', v_new, 'time_category', v_time);
END;
$function$;

-- ── 3. sm_bulk_publish_shifts: redirect bidding_open_at + align to unified model ─
CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_count int;
    v_success_count int;
    v_actor_name text;
    v_actor_role text;
BEGIN
    v_total_count := array_length(p_shift_ids, 1);

    IF p_actor_id IS NOT NULL THEN
        SELECT
            COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
            left(lower(legacy_system_role::text), 50)
        INTO v_actor_name, v_actor_role
        FROM profiles
        WHERE id = p_actor_id;
    ELSE
        v_actor_name := 'System';
        v_actor_role := 'system_automation';
    END IF;

    WITH shift_calculations AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            get_shift_state_id(s.id) as current_state,
            COALESCE(s.scheduled_start, s.start_at) as shift_start_tz,
            get_time_category(COALESCE(s.scheduled_start, s.start_at)) as time_cat
        FROM shifts s
        WHERE s.id = ANY(p_shift_ids)
          AND s.deleted_at IS NULL
    ),
    valid_transitions AS (
        SELECT
            id,
            current_state,
            time_cat,
            CASE
                -- Unified: any non-emergency unassigned publish -> S5 'on_bidding'
                WHEN current_state = 'S1' AND time_cat IN ('URGENT','NORMAL') THEN 'S5'
                -- Emergency direct fill of an assigned draft -> S4 confirmed (was S7)
                WHEN current_state = 'S2' AND time_cat = 'EMERGENCY' THEN 'S4'
                WHEN current_state = 'S2' THEN 'S3'
                ELSE NULL
            END as new_state_id,
            CASE
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 4 THEN NOW()
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 24 THEN LEAST(NOW() + INTERVAL '4 hours', shift_start_tz - INTERVAL '4 hours')
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 48 THEN NOW() + INTERVAL '8 hours'
                ELSE NOW() + INTERVAL '12 hours'
            END as offer_deadline
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2')
          AND time_cat != 'PAST'
          AND NOT (current_state = 'S1' AND time_cat = 'EMERGENCY')
    ),
    updated_rows AS (
        UPDATE shifts s
        SET
            lifecycle_status = 'Published',
            published_at = NOW(),
            last_modified_by = p_actor_id,
            updated_at = NOW(),

            bidding_status = CASE
                WHEN vt.new_state_id = 'S5' THEN 'on_bidding'
                ELSE s.bidding_status
            END,

            is_on_bidding = CASE
                WHEN vt.new_state_id = 'S5' THEN TRUE
                ELSE s.is_on_bidding
            END,

            bidding_open_at = CASE
                WHEN vt.new_state_id = 'S5' THEN NOW()
                ELSE s.bidding_open_at
            END,

            fulfillment_status = CASE
                WHEN vt.new_state_id = 'S5' THEN 'bidding'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S4' THEN 'scheduled'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S3' THEN 'offered'::shift_fulfillment_status
                ELSE s.fulfillment_status
            END,

            assignment_outcome = CASE
                WHEN vt.new_state_id = 'S4' THEN 'confirmed'
                WHEN vt.new_state_id = 'S3' THEN NULL
                ELSE s.assignment_outcome
            END,

            confirmed_at = CASE
                WHEN vt.new_state_id = 'S4' THEN NOW()
                ELSE s.confirmed_at
            END,

            offer_sent_at = CASE
                WHEN vt.new_state_id = 'S3' THEN NOW()
                ELSE s.offer_sent_at
            END,

            offer_expires_at = CASE
                WHEN vt.new_state_id = 'S3' THEN vt.offer_deadline
                ELSE s.offer_expires_at
            END

        FROM valid_transitions vt
        WHERE s.id = vt.id AND vt.new_state_id IS NOT NULL
        RETURNING s.id, vt.current_state, vt.new_state_id, vt.offer_deadline
    ),
    offers_update AS (
        UPDATE public.shift_offers so
        SET offer_expires_at = ur.offer_deadline
        FROM updated_rows ur
        WHERE so.shift_id = ur.id
          AND ur.new_state_id = 'S3'
          AND so.status = 'Pending'
        RETURNING so.id
    )
    SELECT count(*) INTO v_success_count FROM updated_rows;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'message', format('Successfully published %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_publish_shifts: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$;

-- ── 4. Drop the broken legacy cancel_shift(uuid,text) overload ───────────────
DROP FUNCTION IF EXISTS public.cancel_shift(uuid, text);

-- ── 5. Recreate v_shifts_grouped without the 5 dropped passthrough columns ────
DROP VIEW IF EXISTS public.v_shifts_grouped;
CREATE VIEW public.v_shifts_grouped AS
 SELECT id, roster_id, department_id, sub_department_id, role_id, shift_date,
    start_time, end_time, break_minutes, notes, is_recurring, recurrence_rule,
    confirmed_at, created_at, updated_at, organization_id,
    remuneration_level_id, actual_hourly_rate, bidding_close_at, bidding_enabled,
    bidding_open_at, shift_group_id, version, created_by_user_id, last_modified_by,
    last_modified_reason, deleted_at, deleted_by, roster_date, template_id,
    template_group, template_sub_group, is_from_template, template_instance_id,
    group_type, sub_group_name, display_order,
    remuneration_rate, currency, cost_center_id, scheduled_start, scheduled_end,
    is_overnight, scheduled_length_minutes, net_length_minutes, paid_break_minutes,
    unpaid_break_minutes, timezone, assigned_employee_id, assigned_at, is_cancelled,
    cancelled_at, cancelled_by_user_id, cancellation_reason, is_on_bidding,
    trade_requested_at, required_skills, required_licenses,
    eligibility_snapshot, event_ids, tags, compliance_snapshot, compliance_checked_at,
    compliance_override, compliance_override_reason, published_at, published_by_user_id,
    is_locked, lock_reason_text, timesheet_id, actual_start, actual_end,
    actual_net_minutes, payroll_exported, required_certifications,
    event_tags, user_contract_id, assignment_status, fulfillment_status,
    offer_expires_at, attendance_status, assignment_outcome, bidding_status,
    trading_status, lifecycle_status, roster_shift_id,
    roster_template_id, roster_subgroup_id, total_hours, is_draft, is_published,
    template_sub_group AS template_subgroup_text
   FROM shifts s;

-- ── 6. Drop the columns (indexes + FK on them auto-drop) ─────────────────────
ALTER TABLE public.shifts DROP COLUMN IF EXISTS final_call_sent_at;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS role_level;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS assignment_id;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS bidding_opened_at;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS cancelled_by;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS bidding_priority_text;
