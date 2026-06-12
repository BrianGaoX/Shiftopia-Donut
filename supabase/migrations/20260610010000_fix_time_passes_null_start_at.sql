-- Passes 1-3 of sm_run_state_processor only fired for shifts with a non-null
-- start_at, so shifts carrying only (shift_date, start_time) — start_at NULL —
-- never escalated urgency (P1), expired offers (P2), or expired bidding (P3).
-- That left bidding open indefinitely past the 4h lock (the stuck "S5*").
-- Fix: OR in the Sydney-tz fallback timestamp, exactly like Pass 0a/0b/4.
-- Only Passes 1-3 change vs 20260610000000; all other passes are verbatim.
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
  -- (FIXED) handle start_at NULL via the Sydney-tz fallback timestamp.
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
  -- (FIXED) handle start_at NULL via the Sydney-tz fallback timestamp.
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
  -- (FIXED) handle start_at NULL via the Sydney-tz fallback timestamp — this is
  -- the root cause of the stuck "S5*" (emergent bidding) badge.
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
