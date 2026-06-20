-- Harden sm_bulk_assign: authorization + lost-update / concurrency guard.
--
-- Two defects fixed (see autoscheduler audit, findings C1 + data-integrity):
--
--   1. BROKEN ACCESS CONTROL — the function is SECURITY DEFINER and granted to
--      `authenticated`, but performed NO authorization check. Any logged-in
--      user could reassign ANY shift to ANY employee across departments /
--      tenants by calling the RPC with arbitrary UUIDs (IDOR).
--
--   2. LOST UPDATE — the UPDATE blind-overwrote `assigned_employee_id` with no
--      guard, so concurrent assignment flows silently clobbered each other
--      (last writer wins). The TypeScript "TOCTOU re-simulate" reads in one
--      transaction and writes in another, so it cannot prevent this race.
--
-- Fix:
--   * Reject callers who are not a manager/admin. The check is keyed on the
--     REAL caller — auth.uid() (directly, and via is_manager_or_above() /
--     is_admin()) — never the caller-supplied p_user_id, so audit attribution
--     cannot be spoofed into an authorization grant. A NULL caller (service
--     role / server-side automation, e.g. cron) bypasses the gate, matching
--     the existing 'System' audit branch.
--   * Only claim shifts that are currently unassigned OR already assigned to
--     the same target employee (idempotent re-apply). Shifts held by a
--     DIFFERENT employee are left untouched and counted in failure_count, so
--     the caller surfaces them as concurrency conflicts instead of stealing
--     them. Under READ COMMITTED, Postgres re-evaluates this WHERE clause after
--     acquiring the row lock, so two concurrent callers targeting the same open
--     shift cannot both succeed.

CREATE OR REPLACE FUNCTION "public"."sm_bulk_assign"("p_shift_ids" "uuid"[], "p_employee_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_total_count   int;
  v_success_count int;
  v_user_name     text;
  v_user_role     text;
  v_caller        uuid := auth.uid();
BEGIN
  v_total_count := array_length(p_shift_ids, 1);

  -- ── Authorization (audit fix C1) ─────────────────────────────────────────
  -- Gate on the real caller, never the spoofable p_user_id. Manager = a
  -- manager/admin by either role column, or an active gamma+ access cert.
  -- NULL caller = service-role/system context → allowed (see header note).
  IF v_caller IS NOT NULL AND NOT (
       public.is_manager_or_above()
       OR public.is_admin()
       OR EXISTS (
            SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = v_caller
              AND c.is_active = true
              AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
          )
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not authorized to assign shifts',
      'total_requested', COALESCE(v_total_count, 0),
      'success_count', 0,
      'failure_count', COALESCE(v_total_count, 0)
    );
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
           left(lower(legacy_system_role::text), 50)
    INTO v_user_name, v_user_role FROM public.profiles WHERE id = p_user_id;
  ELSE
    v_user_name := 'System'; v_user_role := 'system_automation';
  END IF;

  WITH updated_rows AS (
    UPDATE public.shifts s SET
      assigned_employee_id = p_employee_id,
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN s.lifecycle_status = 'Published'
                                THEN 'confirmed'::public.shift_assignment_outcome
                                ELSE s.assignment_outcome END,
      emergency_source     = CASE WHEN s.lifecycle_status = 'Published'
                                THEN public.set_emergency_source('NORMAL_ASSIGN',
                                       EXTRACT(EPOCH FROM (s.scheduled_start - NOW()))::int,
                                       s.emergency_source)
                                ELSE s.emergency_source END,
      confirmed_at         = CASE WHEN s.lifecycle_status = 'Published' THEN NOW() ELSE s.confirmed_at END,
      updated_at           = NOW(),
      last_modified_by     = p_user_id
    WHERE s.id = ANY(p_shift_ids)
      AND s.deleted_at IS NULL
      -- Lost-update guard: never overwrite a shift already held by a
      -- different employee. Such shifts fall through to failure_count and
      -- are surfaced upstream as concurrency conflicts.
      AND (s.assigned_employee_id IS NULL OR s.assigned_employee_id = p_employee_id)
    RETURNING s.id, s.lifecycle_status
  )
  SELECT count(*) INTO v_success_count FROM updated_rows;

  RETURN jsonb_build_object('success', true, 'total_requested', v_total_count,
    'success_count', v_success_count, 'failure_count', v_total_count - v_success_count,
    'message', format('Successfully assigned %s of %s shifts', v_success_count, v_total_count));

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_bulk_assign: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $$;
