-- ============================================================================
-- Server-side enforcement of the timesheet review terminal-attendance gate.
--
-- Mirrors the client gate isTimesheetReviewable() in
--   src/modules/rosters/domain/shift-ui.ts
-- (and its UI wiring in TimesheetRow / TimesheetMobileCard / TimesheetTable).
--
-- A manager may APPROVE / REJECT a timesheet, or EDIT its billable times
-- (timesheets.start_time / end_time), ONLY once the related shift has reached a
-- terminal attendance state:
--
--   • No-Show          — shift ended and the employee never clocked in
--                        (actual_start IS NULL AND now() past effective end),
--                        or an explicit attendance_status = 'no_show'
--   • Clock-Out exists — shifts.actual_end recorded (or this timesheet row's
--                        own clock_out is set)
--   • Auto Clock-Out   — attendance_status = 'auto_clock_out'
--
-- Non-terminal states (Scheduled / Awaiting Check-In / Missing / still clocked
-- in mid-shift / Working Overtime) are rejected at the database, so direct API
-- calls cannot bypass the client gate.
-- ============================================================================

-- ── Reusable predicate (shift-centric, mirrors the client) ──────────────────
CREATE OR REPLACE FUNCTION public.is_shift_timesheet_reviewable(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id = p_shift_id
      AND (
        -- explicit terminal attendance outcomes
        s.attendance_status IN ('no_show', 'auto_clock_out')
        -- a recorded clock-out
        OR s.actual_end IS NOT NULL
        -- No-Show stand-in: ended, never clocked in. effective end falls back to
        -- the 12.5h auto clock-out horizon when end_at is absent (matches client).
        OR (
              s.actual_start IS NULL
              AND now() > COALESCE(s.end_at, s.start_at + interval '12.5 hours')
           )
      )
  );
$$;

COMMENT ON FUNCTION public.is_shift_timesheet_reviewable(uuid) IS
  'Terminal-attendance gate for manager timesheet review (approve/reject/edit). Mirrors client isTimesheetReviewable() in shift-ui.ts.';

-- ── BEFORE INSERT/UPDATE trigger on timesheets ──────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_timesheet_review_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_is_decision      boolean;
  v_is_billable_edit boolean;
  v_reviewable       boolean;
BEGIN
  -- (a) approve / reject decision being applied (on insert, or status change)
  v_is_decision := NEW.status IN ('approved', 'rejected')
                   AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status);

  -- (b) manager edit of billable times — only meaningful on UPDATE. Fresh rows
  -- (auto-create / snapping) are INSERTs and intentionally not gated here.
  v_is_billable_edit := TG_OP = 'UPDATE'
                        AND (NEW.start_time IS DISTINCT FROM OLD.start_time
                             OR NEW.end_time IS DISTINCT FROM OLD.end_time);

  -- Not a gated manager action (clock sync, submit, auto-create, no-show metrics
  -- write, etc.) → allow through untouched.
  IF NOT (v_is_decision OR v_is_billable_edit) THEN
    RETURN NEW;
  END IF;

  -- This timesheet's own recorded clock-out is itself a terminal signal, even if
  -- the shift row hasn't been synced yet.
  v_reviewable := (NEW.clock_out IS NOT NULL)
                  OR public.is_shift_timesheet_reviewable(NEW.shift_id);

  IF NOT v_reviewable THEN
    RAISE EXCEPTION
      'Timesheet review blocked: shift % has not reached a final attendance state.', NEW.shift_id
      USING ERRCODE = 'check_violation',
            HINT = 'Approve, reject, or edit billable times only after the employee clocks out, is auto-clocked-out, or is a no-show.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_timesheet_review_gate ON public.timesheets;
CREATE TRIGGER trg_enforce_timesheet_review_gate
  BEFORE INSERT OR UPDATE ON public.timesheets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_timesheet_review_gate();
