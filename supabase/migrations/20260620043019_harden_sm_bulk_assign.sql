-- Harden sm_bulk_assign: authorization (IDOR fix) + lost-update guard.
-- Hardens the CURRENT prod body (the original 2026-06-13 migration referenced
-- emergency_source / set_emergency_source which were since dropped). Adds two
-- guards only:
--   1. Authorization — gate on the REAL caller auth.uid() (never the spoofable
--      p_user_id). Manager = manager/admin role OR an active gamma+ access cert.
--      NULL caller = service-role/system automation (cron) → allowed.
--   2. Lost-update guard — only claim shifts that are unassigned or already held
--      by the same target employee; shifts held by a DIFFERENT employee fall
--      through to failure_count as concurrency conflicts.
CREATE OR REPLACE FUNCTION public.sm_bulk_assign(p_shift_ids uuid[], p_employee_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_count   int;
  v_success_count int;
  v_user_name     text;
  v_user_role     text;
  v_caller        uuid := auth.uid();
BEGIN
  v_total_count := array_length(p_shift_ids, 1);

  -- ── Authorization (audit fix C1) ─────────────────────────────────────────
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
      confirmed_at         = CASE WHEN s.lifecycle_status = 'Published' THEN NOW() ELSE s.confirmed_at END,
      updated_at           = NOW(),
      last_modified_by     = p_user_id
    WHERE s.id = ANY(p_shift_ids)
      AND s.deleted_at IS NULL
      -- Lost-update guard: never overwrite a shift already held by a different
      -- employee. Re-checked after row-lock under READ COMMITTED, so two
      -- concurrent callers cannot both claim the same open shift.
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
END; $function$;
