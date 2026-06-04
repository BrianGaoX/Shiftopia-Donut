-- Close cross-organisation RLS hole on the shifts table.
--
-- The previous shifts_select_rbac and shifts_select_managers policies contained
-- branches that matched `sub_department_id = shifts.sub_department_id` (and the
-- gamma `department_id` fallback) WITHOUT an `organization_id` equality guard.
--
-- sub_departments has no cross-org uniqueness constraint — only
-- UNIQUE(department_id, name). If a sub_department UUID ever collides across
-- organisations (via misconfiguration, restore, or a future bug), a user from
-- org A could see shifts belonging to org B. This migration adds the missing
-- `organization_id = shifts.organization_id` predicate to every sub_department
-- and orphan-department branch that previously omitted it.
--
-- Structure is preserved exactly: the OR cascade inside each policy still maps
-- one-for-one to the original branches. Only the org guard is added.

BEGIN;

DROP POLICY IF EXISTS "shifts_select_rbac" ON public.shifts;
DROP POLICY IF EXISTS "shifts_select_managers" ON public.shifts;

-- 1. shifts_select_rbac (already org-guarded in the original; kept identical
--    to maintain a single source of truth alongside shifts_select_managers).
CREATE POLICY "shifts_select_rbac" ON public.shifts
FOR SELECT
USING (
  -- Check Certs
  EXISTS (
      SELECT 1 FROM app_access_certificates ac
      JOIN rbac_permissions rp ON rp.access_level = ac.access_level
      WHERE ac.user_id = auth.uid()
        AND ac.is_active = true
        AND rp.action_code = 'shift.view'
        AND (
            ac.access_level = 'zeta'
            OR (ac.organization_id = shifts.organization_id AND (
                rp.scope = 'ORG'
                OR (rp.scope = 'DEPT' AND ac.department_id = shifts.department_id)
                OR (rp.scope = 'SUB_DEPT' AND ac.sub_department_id = shifts.sub_department_id)
            ))
        )
  )
  OR
  -- Check Contracts
  EXISTS (
      SELECT 1 FROM user_contracts uc
      JOIN rbac_permissions rp ON rp.access_level = uc.access_level
      WHERE uc.user_id = auth.uid()
        AND uc.status = 'Active'
        AND rp.action_code = 'shift.view'
        AND uc.organization_id = shifts.organization_id
        AND (
            rp.scope = 'ORG'
            OR (rp.scope = 'DEPT' AND uc.department_id = shifts.department_id)
            OR (rp.scope = 'SUB_DEPT' AND uc.sub_department_id = shifts.sub_department_id)
        )
  )
  OR
  -- Check Ownership
  (
    (assigned_employee_id = auth.uid() OR last_rejected_by = auth.uid())
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND status = 'Active')
  )
);

-- 2. shifts_select_managers — add org guard to the previously unqualified
--    sub_department_id / department-fallback branches.
CREATE POLICY "shifts_select_managers" ON public.shifts
FOR SELECT
USING (
  -- Check Contracts (Gamma or higher)
  EXISTS (
      SELECT 1 FROM user_contracts uc
      WHERE uc.user_id = auth.uid()
        AND uc.status = 'Active'
        AND uc.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        AND (
          (uc.access_level = 'epsilon' AND uc.organization_id = shifts.organization_id)
          OR (uc.access_level = 'delta' AND uc.organization_id = shifts.organization_id AND uc.department_id = shifts.department_id)
          OR (uc.organization_id = shifts.organization_id AND uc.sub_department_id = shifts.sub_department_id)
          OR (uc.organization_id = shifts.organization_id AND uc.department_id = shifts.department_id AND uc.sub_department_id IS NULL)
          OR (uc.organization_id = shifts.organization_id AND uc.department_id IS NULL AND uc.sub_department_id IS NULL)
        )
  )
  OR
  -- Check Certs (Gamma or higher)
  EXISTS (
      SELECT 1 FROM app_access_certificates ac
      WHERE ac.user_id = auth.uid()
        AND ac.is_active = true
        AND ac.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        AND (
           ac.access_level = 'zeta'
           OR (ac.access_level = 'epsilon' AND ac.organization_id = shifts.organization_id)
           OR (ac.access_level = 'delta' AND ac.organization_id = shifts.organization_id AND ac.department_id = shifts.department_id)
           OR (ac.organization_id = shifts.organization_id AND ac.sub_department_id = shifts.sub_department_id)
        )
  )
  OR
  -- Check Legacy Profile Roles (Admin/Manager bypass)
  EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND legacy_system_role IN ('admin', 'manager')
  )
);

COMMIT;
