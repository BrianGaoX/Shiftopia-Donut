-- ============================================================================
-- COLLAPSE S6 (Published + Unassigned + bidding_status = 'on_bidding_urgent')
-- ============================================================================
-- S6 is a redundant cache of a time-to-start (TTS) fact, not an independent
-- state. Urgency is FULLY derivable from TTS at read time:
--     urgent   = 4h  < TTS <= 24h
--     emergent = TTS <= 4h
-- The persisted 'on_bidding_urgent' value has NO side effect at escalation time:
-- nothing emits a notification or audit event when a shift escalates
-- 'on_bidding_normal' -> 'on_bidding_urgent'. (Verified: the only trigger that
-- references the value, trg_bidding_expired_notification_fn, fires on the
-- bidding -> Draft "no winner" transition, NOT on the normal->urgent hop.)
--
-- Going forward we PRODUCE a single unified 'on_bidding' for every
-- published-unassigned-bidding shift. The split values 'on_bidding_normal' and
-- 'on_bidding_urgent' become inert tombstones (Postgres cannot cleanly drop an
-- enum value without recreating the type). Reader / deriver functions are left
-- untouched: they already fall through to the correct state for the unified
-- value (get_shift_fsm_state returns S5 for on_bidding / on_bidding_normal /
-- not_on_bidding / NULL, and S6 only for the now-unwritten on_bidding_urgent).
--
-- Verified before writing (READ-ONLY against prod):
--   * WRITERS of the split enum (rewritten below to write 'on_bidding'):
--       get_publish_target_state/3, publish_shift/2, employee_cancel_shift/3,
--       sm_decline_offer/2, sm_employee_cancel/2, sm_employee_cancel/3,
--       reject_shift_offer/3.   (sm_employee_cancel has TWO overloads — both done.)
--   * sm_run_state_processor() Pass 1 (escalation UPDATE ... SET
--       bidding_status='on_bidding_urgent' WHERE bidding_status='on_bidding_normal'
--       AND TTS<=24h) is REMOVED — it only re-caches a TTS fact, no side effect.
--   * READERS left intact (read all three values, tombstone-compatible):
--       get_shift_fsm_state, get_shift_state_id (both overloads),
--       process_shift_timers (timeout IN-list already lists all three),
--       check_state_invariants, check_state_machine_invariants_v3,
--       unpublish_roster_shift, select_bid_winner.
--   * is_urgent BOOLEAN writers are TTS snapshots and are KEPT AS-IS — they do
--       NOT decide the enum split:
--         publish_shift              — is_urgent = (close_at-now < 24h)  [kept]
--         recalculate_shift_urgency  — is_urgent recomputed from close_at  [kept]
--         push_shift_to_bidding_on_cancel — is_urgent = TTS<24h, never sets
--                                            bidding_status [kept, untouched]
--       employee_cancel_shift / sm_employee_cancel set is_urgent=TRUE on the
--       urgent branch; after collapse the urgent branch is gone, so is_urgent is
--       no longer toggled there (left FALSE/default). The is_urgent column is a
--       harmless TTS cache; recalculate_shift_urgency keeps it fresh.
--   * NO escalation side-effect: no notify_user / notifications INSERT is gated
--       on the normal->urgent transition (only trg_bidding_expired_notification_fn
--       references the value, and only for the bidding->Draft no-winner path).
--
-- A second definitive writer scan (lead review) found two writers the first pass
-- missed; both are now included below:
--   * reject_shift_offer/3 — S3 -> S5/S6 via a TTS branch (the employee-reject
--     path; sibling of sm_decline_offer). Collapsed to a single S3 -> S5 on_bidding.
--   * sm_employee_cancel/3 — the THREE-arg overload (the first pass only did /2).
-- A one-time BACKFILL at the end unifies any live rows still on the split values
-- (0 at authoring time). Unlike S8 (transient), S6 rows can be live, so we
-- normalize them rather than leaving live rows on tombstone values.
-- ============================================================================

-- ── 1. get_publish_target_state: unified on_bidding (drop S5/S6 TTS branch) ──
--    Was: TTS < 24h -> S6 'on_bidding_urgent', else S5 'on_bidding_normal'.
--    Now: single S5 'on_bidding' for the unassigned -> bidding case.
CREATE OR REPLACE FUNCTION public.get_publish_target_state(p_has_assignment boolean, p_is_confirmed boolean, p_hours_until_start numeric)
 RETURNS TABLE(state_id text, lifecycle_status shift_lifecycle, assignment_status shift_assignment_status, assignment_outcome shift_assignment_outcome, bidding_status shift_bidding_status, fulfillment_status shift_fulfillment_status)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF p_has_assignment THEN
        IF p_is_confirmed THEN
            -- S4: Published + Assigned + Confirmed
            RETURN QUERY SELECT
                'S4'::TEXT,
                'Published'::shift_lifecycle,
                'assigned'::shift_assignment_status,
                'confirmed'::shift_assignment_outcome,
                'not_on_bidding'::shift_bidding_status,
                'fulfilled'::shift_fulfillment_status;
        ELSE
            -- S3: Published + Assigned + Offered
            RETURN QUERY SELECT
                'S3'::TEXT,
                'Published'::shift_lifecycle,
                'assigned'::shift_assignment_status,
                'offered'::shift_assignment_outcome,
                'not_on_bidding'::shift_bidding_status,
                'pending'::shift_fulfillment_status;
        END IF;
    ELSE
        -- Unassigned → Bidding (unified on_bidding; urgency derived from TTS at read time)
        RETURN QUERY SELECT
            'S5'::TEXT,
            'Published'::shift_lifecycle,
            'unassigned'::shift_assignment_status,
            NULL::shift_assignment_outcome,
            'on_bidding'::shift_bidding_status,
            'none'::shift_fulfillment_status;
    END IF;
END;
$function$;

-- ── 2. publish_shift: unified on_bidding (drop normal/urgent TTS branch) ──────
--    is_urgent is KEPT as a TTS snapshot (harmless); only the enum decision is
--    collapsed to a single 'on_bidding'.
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
    v_is_urgent BOOLEAN;
    v_bidding_status shift_bidding_status;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;

    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Validate Current State
    IF v_shift.lifecycle_status::text != 'Draft' AND v_shift.lifecycle_status::text != 'Published' THEN
         RAISE EXCEPTION 'Shift must be in Draft state to publish (current: %)', v_shift.lifecycle_status;
    END IF;

    -- 3. Compliance Check (Only for Assigned shifts)
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
        -- Draft + Unassigned -> Bidding
        v_new_fulfillment_status := 'bidding';

        v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Australia/Sydney';
        v_bidding_close_at := v_shift_start - INTERVAL '4 hours';

        -- Improved Error Message
        IF v_bidding_close_at <= NOW() THEN
            RAISE EXCEPTION 'Cannot publish unassigned shift less than 4 hours before start. Please assign an employee manually.';
        END IF;

        -- is_urgent is a TTS snapshot only; bidding_status is unified.
        v_is_urgent := (v_bidding_close_at - NOW()) < INTERVAL '24 hours';

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
            bidding_close_at = v_bidding_close_at,
            is_urgent = v_is_urgent
        WHERE id = p_shift_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'new_status', 'Published'
    );
END;
$function$;

-- ── 3. employee_cancel_shift: unified on_bidding (drop S5/S6 TTS branch) ──────
--    The < 4h emergency-block branch is preserved verbatim. The urgent-vs-normal
--    decision is collapsed: any cancel with TTS >= 4h reopens bidding as a single
--    'on_bidding' (urgency derived from TTS at read time). is_urgent is no longer
--    toggled here (kept fresh by recalculate_shift_urgency).
CREATE OR REPLACE FUNCTION public.employee_cancel_shift(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_hours_until_start NUMERIC;
    v_new_state TEXT;
BEGIN
    -- Get current shift state
    SELECT * INTO v_shift
    FROM shifts
    WHERE id = p_shift_id
    AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    -- Validate: Must be in S4 (Confirmed) and assigned to this employee
    IF v_shift.lifecycle_status != 'Published'
       OR v_shift.assignment_outcome != 'confirmed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift is not confirmed');
    END IF;

    IF v_shift.assigned_employee_id != p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not assigned to this employee');
    END IF;

    -- Calculate hours until start
    v_hours_until_start := EXTRACT(EPOCH FROM (v_shift.scheduled_start - NOW())) / 3600;

    -- Per state machine Section 3.4:
    -- > 4h → S5 (bidding; urgency derived from TTS at read time)
    -- < 4h → Need emergency assign (cannot auto-transition)

    IF v_hours_until_start < 4 THEN
        -- Too late to cancel, needs manager intervention
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Too late to cancel. Contact manager for emergency replacement.',
            'hours_until_start', v_hours_until_start
        );
    END IF;

    v_new_state := 'S5';
    -- S4 → S5: reopen bidding (unified on_bidding)
    UPDATE shifts
    SET
        assigned_employee_id = NULL,
        assigned_at = NULL,
        assignment_status = 'unassigned'::shift_assignment_status,
        assignment_outcome = NULL,
        fulfillment_status = 'none'::shift_fulfillment_status,
        confirmed_at = NULL,
        is_on_bidding = TRUE,
        bidding_status = 'on_bidding'::shift_bidding_status,
        bidding_open_at = NOW(),
        updated_at = NOW(),
        last_modified_by = p_employee_id,
        last_modified_reason = COALESCE(p_reason, 'Employee cancelled')
    WHERE id = p_shift_id;

    -- Trigger will sync to roster_shifts automatically

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'transition', format('S4 → %s', v_new_state),
        'hours_until_start', v_hours_until_start
    );
END;
$function$;

-- ── 4. sm_decline_offer: unified on_bidding (was on_bidding_normal) ───────────
--    Single enum write change; everything else byte-identical.
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

    INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
    VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_decline_offer'));

    RETURN jsonb_build_object('success', true, 'from_state', 'S3', 'to_state', 'S5');
END;
$function$;

-- ── 5. sm_employee_cancel: unified on_bidding (collapse URGENT/NORMAL → S5) ────
--    The PAST guard and the EMERGENCY (< T-4h) → S15 Cancelled branch are
--    preserved verbatim. The URGENT and NORMAL branches (both reopened bidding,
--    differing only in the enum split + is_urgent flag) collapse into a single
--    'on_bidding' reopen for any non-PAST, non-EMERGENCY cancel.
CREATE OR REPLACE FUNCTION public.sm_employee_cancel(p_shift_id uuid, p_employee_id uuid)
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
    v_new_iter INT;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
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

    v_new_iter := COALESCE(v_shift.bidding_iteration, 1) + 1;

    IF v_time = 'EMERGENCY' THEN
        v_new := 'S15';
        UPDATE shifts
        SET lifecycle_status = 'Cancelled',
            is_cancelled = TRUE,
            cancelled_at = NOW(),
            assigned_employee_id = NULL,
            assignment_status = 'unassigned',
            assignment_outcome = NULL,
            last_dropped_by = p_employee_id,
            last_rejected_by = NULL,
            bidding_iteration = v_new_iter,
            updated_at = NOW(),
            last_modified_by = p_employee_id
        WHERE id = p_shift_id;
    ELSE
        v_new := 'S5';
        -- Reopen bidding (unified on_bidding); urgency derived from TTS at read time.
        UPDATE shifts
        SET assigned_employee_id = NULL,
            assignment_status = 'unassigned',
            assignment_outcome = NULL,
            is_on_bidding = TRUE,
            bidding_status = 'on_bidding',
            bidding_open_at = NOW(),
            fulfillment_status = 'bidding',
            bidding_iteration = v_new_iter,
            last_dropped_by = p_employee_id,
            last_rejected_by = NULL,
            updated_at = NOW(),
            last_modified_by = p_employee_id
        WHERE id = p_shift_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'from_state', 'S4', 'to_state', v_new, 'time_category', v_time);
END;
$function$;

-- ── 6. sm_run_state_processor: REMOVE Pass 1 (urgency escalation) ─────────────
--    Pass 1 only re-cached a TTS fact (on_bidding_normal -> on_bidding_urgent at
--    TTS <= 24h) with NO side effect. Removed. Every other pass reproduced
--    verbatim. Pass 3's bidding-expiry IN-list already lists all three values,
--    so it remains tombstone-compatible. Pass comments left as-is (NOT renumbered).
CREATE OR REPLACE PROCEDURE public.sm_run_state_processor()
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $procedure$
BEGIN

  -- ── Pass 0a: Published + assigned → InProgress when shift starts ───────────
  BEGIN
    UPDATE shifts SET lifecycle_status = 'InProgress', updated_at = now()
    WHERE lifecycle_status = 'Published'
      AND assignment_status = 'assigned'
      AND (
        (start_at IS NOT NULL
          AND start_at <= now()
          AND start_at > now() - INTERVAL '12 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now()
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ > now() - INTERVAL '12 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 0a failed: %', SQLERRM;
  END;

  -- ── Pass 0b: InProgress → Completed when shift ends (scheduled end) ────────
  BEGIN
    UPDATE shifts SET lifecycle_status = 'Completed', updated_at = now()
    WHERE lifecycle_status = 'InProgress'
      AND (
        (end_at IS NOT NULL AND end_at <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 0b failed: %', SQLERRM;
  END;

  -- ── Pass 1 (REMOVED): urgency escalation at TTS ≤ 24h ─────────────────────
  --    Previously: UPDATE shifts SET bidding_status='on_bidding_urgent'
  --    WHERE bidding_status='on_bidding_normal' AND TTS<=24h.
  --    S6/urgency is now derived from TTS at read time, so this pass is dead.

  -- ── Pass 2: Offer expiry S3 → S1 at TTS ≤ 4h ──────────────────────────────
  BEGIN
    UPDATE shifts SET
      lifecycle_status      = 'Draft',
      assignment_outcome    = NULL,
      assignment_status     = 'unassigned',
      assigned_employee_id  = NULL,
      assigned_at           = NULL,
      bidding_status        = 'not_on_bidding',
      updated_at            = now()
    WHERE lifecycle_status = 'Published'
      AND assignment_outcome = 'offered'
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '4 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '4 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 2 failed: %', SQLERRM;
  END;

  -- ── Pass 3: Bidding expiry S5/S6 → S1 at TTS ≤ 4h ─────────────────────────
  -- (FIXED) include the unified 'on_bidding' value, plus the start_at NULL fallback.
  BEGIN
    UPDATE shifts SET
      lifecycle_status  = 'Draft',
      bidding_status    = 'not_on_bidding',
      is_on_bidding     = false,
      assignment_status = 'unassigned',
      updated_at        = now()
    WHERE lifecycle_status = 'Published'
      AND bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent')
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '4 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '4 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 3 failed: %', SQLERRM;
  END;

  -- ── Pass 4: Auto no-show — shift has ENDED with no clock-in ────────────────
  BEGIN
    UPDATE shifts SET attendance_status = 'no_show', updated_at = now()
    WHERE lifecycle_status IN ('InProgress', 'Completed')
      AND attendance_status = 'unknown'
      AND (
        (end_at IS NOT NULL AND end_at <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 4 failed: %', SQLERRM;
  END;

  -- ── Pass 5: Auto clock-out — clocked-in shift past scheduled end ───────────
  BEGIN
    UPDATE shifts SET
      actual_end         = COALESCE(
        end_at,
        (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ
      ),
      actual_net_minutes = GREATEST(0,
        EXTRACT(EPOCH FROM (
          COALESCE(
            end_at,
            (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          ) - COALESCE(actual_start, start_at,
            (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          )
        )) / 60
      )::INTEGER,
      attendance_note    = 'auto_clocked_out',
      updated_at         = now()
    WHERE attendance_status IN ('checked_in', 'late')
      AND actual_end IS NULL
      AND (
        (end_at IS NOT NULL
          AND end_at + MAKE_INTERVAL(mins => COALESCE(unpaid_break_minutes, 30)) <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ
              + MAKE_INTERVAL(mins => COALESCE(unpaid_break_minutes, 30)) <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 5 failed: %', SQLERRM;
  END;

  -- ── Pass 6: 12.5h fallback safety net ───────────────────────────────────────
  BEGIN
    UPDATE shifts SET
      lifecycle_status   = 'Completed',
      attendance_status  = 'auto_clock_out',
      actual_end         = COALESCE(actual_end, now()),
      actual_net_minutes = GREATEST(0,
        EXTRACT(EPOCH FROM (
          COALESCE(actual_end, now()) -
          COALESCE(actual_start, start_at,
            (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          )
        )) / 60
      )::INTEGER,
      attendance_note    = 'Auto-completed by system (12.5hr limit)',
      updated_at         = now()
    WHERE lifecycle_status = 'InProgress'
      AND COALESCE(actual_start, start_at,
            (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          ) + INTERVAL '12.5 hours' <= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 6 failed: %', SQLERRM;
  END;

END;
$procedure$;

-- ── 7. reject_shift_offer: unified on_bidding (drop S5/S6 TTS branch) ─────────
--    Employee-reject path (sibling of sm_decline_offer). Was: TTS<24h -> S6
--    'on_bidding_urgent', else S5 'on_bidding_normal'. Now: single S3 -> S5
--    'on_bidding'. All validation branches preserved verbatim.
CREATE OR REPLACE FUNCTION public.reject_shift_offer(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
BEGIN
    -- Get current shift state
    SELECT * INTO v_shift
    FROM shifts
    WHERE id = p_shift_id
    AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    -- Validate: Must be in S3 (Published + Offered)
    IF v_shift.lifecycle_status != 'Published'
       OR v_shift.assignment_outcome != 'offered' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift is not in Offered state');
    END IF;

    -- Validate: Must be assigned to this employee
    IF v_shift.assigned_employee_id != p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Offer not for this employee');
    END IF;

    -- Transition S3 → S5: clear assignment, reopen bidding (unified on_bidding;
    -- urgency derived from TTS at read time).
    UPDATE shifts
    SET
        assigned_employee_id = NULL,
        assigned_at = NULL,
        assignment_status = 'unassigned'::shift_assignment_status,
        assignment_outcome = NULL,
        fulfillment_status = 'none'::shift_fulfillment_status,
        is_on_bidding = TRUE,
        bidding_status = 'on_bidding'::shift_bidding_status,
        bidding_open_at = NOW(),
        updated_at = NOW(),
        last_modified_by = p_employee_id,
        last_modified_reason = COALESCE(p_reason, 'Employee rejected offer')
    WHERE id = p_shift_id;

    -- Trigger will sync to roster_shifts automatically

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'transition', 'S3 → S5',
        'new_state', 'on_bidding'
    );
END;
$function$;

-- ── 8. sm_employee_cancel/3 (the 3-arg overload): collapse URGENT/NORMAL → S5 ──
--    Mirrors the /2 collapse. PAST guard + EMERGENCY (→ S15 Cancelled) preserved
--    verbatim; URGENT and NORMAL branches collapse to a single 'on_bidding' reopen
--    (no is_urgent toggle). NOTE: this overload uses column `bidding_opened_at`.
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
            bidding_opened_at=NOW(),
            updated_at=NOW(),
            last_modified_by=p_employee_id
        WHERE id=p_shift_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'from_state', 'S4', 'to_state', v_new, 'time_category', v_time);
END;
$function$;

-- ── 9. Backfill: unify any live rows still on the split values ────────────────
--    Safe: trg_shift_notifications ignores bidding_status; the bidding-expired
--    notification only fires on -> not_on_bidding; validate_shift_state_invariants
--    accepts Published+unassigned+on_bidding. 0 rows at authoring time.
UPDATE public.shifts
SET bidding_status = 'on_bidding'::shift_bidding_status
WHERE bidding_status IN ('on_bidding_normal', 'on_bidding_urgent')
  AND lifecycle_status = 'Published'
  AND assignment_status = 'unassigned'
  AND deleted_at IS NULL;
