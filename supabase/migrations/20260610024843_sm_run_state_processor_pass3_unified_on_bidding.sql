-- Consistency: sm_run_state_processor Pass 3 (parallel 15-min bidding expiry)
-- must also match the unified 'on_bidding' value. Only Pass 3's IN list changes
-- vs 20260610010000. (process_shift_timers every-minute is the authoritative
-- path; this keeps the 15-min processor from carrying a known-dead filter.)
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

  -- ── Pass 1: Urgency escalation at TTS ≤ 24h ────────────────────────────────
  BEGIN
    UPDATE shifts SET bidding_status = 'on_bidding_urgent', updated_at = now()
    WHERE lifecycle_status = 'Published'
      AND bidding_status = 'on_bidding_normal'
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '24 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '24 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 1 failed: %', SQLERRM;
  END;

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
