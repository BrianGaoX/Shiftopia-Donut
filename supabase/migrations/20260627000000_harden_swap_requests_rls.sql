-- R3: Harden legacy swap_requests RLS policies.
--
-- The previous policies used USING (true) / WITH CHECK (true), which allowed
-- any authenticated user to read, insert, or update every row.  This table is
-- legacy-adjacent now, but it still exists with grants, triggers, and dependent
-- tables, so it should not remain tenant-wide.
--
-- Rules:
--   - employees can see rows they participate in;
--   - employees can create requests only for their own assigned original shift;
--   - employees can update only pending rows they participate in;
--   - managers can see/update rows attached to shifts inside their RBAC scope.
--
-- Note: swap_requests has organization_id and department_id but no
-- sub_department_id.  For manager scope, use the related shifts rows because
-- shifts carry the full org/dept/sub-dept hierarchy.

ALTER TABLE public.swap_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can create swap requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Authenticated users can update swap requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Authenticated users can view swaps" ON public.swap_requests;

CREATE POLICY "Authenticated users can create swap requests"
ON public.swap_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by_employee_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id = swap_requests.original_shift_id
      AND s.assigned_employee_id = (SELECT auth.uid())
      AND (
        swap_requests.organization_id IS NULL
        OR swap_requests.organization_id = s.organization_id
      )
      AND (
        swap_requests.department_id IS NULL
        OR swap_requests.department_id = s.department_id
      )
  )
);

CREATE POLICY "Authenticated users can view swaps"
ON public.swap_requests
FOR SELECT
TO authenticated
USING (
  requested_by_employee_id = (SELECT auth.uid())
  OR swap_with_employee_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id IN (swap_requests.original_shift_id, swap_requests.offered_shift_id)
      AND s.assigned_employee_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id IN (swap_requests.original_shift_id, swap_requests.offered_shift_id)
      AND public.user_has_action_in_scope(
        'shift.view',
        s.organization_id,
        s.department_id,
        s.sub_department_id
      )
  )
);

CREATE POLICY "Authenticated users can update swap requests"
ON public.swap_requests
FOR UPDATE
TO authenticated
USING (
  (
    (
      requested_by_employee_id = (SELECT auth.uid())
      OR swap_with_employee_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.shifts s
        WHERE s.id IN (swap_requests.original_shift_id, swap_requests.offered_shift_id)
          AND s.assigned_employee_id = (SELECT auth.uid())
      )
    )
    AND status IN ('pending_employee', 'pending_manager')
  )
  OR EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id IN (swap_requests.original_shift_id, swap_requests.offered_shift_id)
      AND (
        public.user_has_action_in_scope(
          'shift.edit',
          s.organization_id,
          s.department_id,
          s.sub_department_id
        )
        OR public.user_has_action_in_scope(
          'shift.assign',
          s.organization_id,
          s.department_id,
          s.sub_department_id
        )
      )
  )
)
WITH CHECK (
  (
    (
      requested_by_employee_id = (SELECT auth.uid())
      OR swap_with_employee_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.shifts s
        WHERE s.id IN (swap_requests.original_shift_id, swap_requests.offered_shift_id)
          AND s.assigned_employee_id = (SELECT auth.uid())
      )
    )
    AND status IN ('pending_employee', 'pending_manager', 'cancelled', 'rejected')
  )
  OR EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id IN (swap_requests.original_shift_id, swap_requests.offered_shift_id)
      AND (
        public.user_has_action_in_scope(
          'shift.edit',
          s.organization_id,
          s.department_id,
          s.sub_department_id
        )
        OR public.user_has_action_in_scope(
          'shift.assign',
          s.organization_id,
          s.department_id,
          s.sub_department_id
        )
      )
  )
);

COMMENT ON POLICY "Authenticated users can create swap requests" ON public.swap_requests IS
  'R3: employees may create legacy swap_requests only for their own assigned original shift.';

COMMENT ON POLICY "Authenticated users can view swaps" ON public.swap_requests IS
  'R3: participants can view their own swap_requests; managers can view rows attached to shifts in their RBAC scope.';

COMMENT ON POLICY "Authenticated users can update swap requests" ON public.swap_requests IS
  'R3: participants can update pending swap_requests; managers can update rows attached to shifts in their RBAC scope.';
