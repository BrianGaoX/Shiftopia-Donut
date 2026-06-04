-- Migration: Optimize Shifts RLS Policies
-- Removes PL/pgSQL function calls (N+1 query problem) from shifts SELECT policies
-- and replaces them with pure SQL EXISTS subqueries to allow Postgres to hash-join.

BEGIN;

-- Drop the poorly performing policies
DROP POLICY IF EXISTS "shifts_select_rbac" ON public.shifts;
DROP POLICY IF EXISTS "shifts_select_managers" ON public.shifts;

-- 1. Recreate shifts_select_rbac using pure SQL EXISTS
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

-- 2. Recreate shifts_select_managers using pure SQL EXISTS
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
          OR (uc.sub_department_id = shifts.sub_department_id)
          OR (uc.department_id = shifts.department_id AND uc.sub_department_id IS NULL)
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
           OR (ac.sub_department_id = shifts.sub_department_id)
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
