-- R3: Harden departments RLS policies that previously used USING (true)
-- or WITH CHECK (true).
--
-- Scope is intentionally limited to broad true policies. Existing admin-only
-- policies are left unchanged: departments_delete, departments_insert,
-- departments_update.

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage departments" ON public.departments;
DROP POLICY IF EXISTS "Authenticated users can update departments" ON public.departments;
DROP POLICY IF EXISTS "Authenticated users can view all departments" ON public.departments;
DROP POLICY IF EXISTS departments_select ON public.departments;
DROP POLICY IF EXISTS public_read ON public.departments;

CREATE POLICY "Authenticated users can manage departments"
ON public.departments
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users can update departments"
ON public.departments
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users can view all departments"
ON public.departments
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.user_has_action_in_scope(
    'roster.view',
    departments.organization_id,
    departments.id,
    NULL::uuid
  )
);

CREATE POLICY departments_select
ON public.departments
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.user_has_action_in_scope(
    'roster.view',
    departments.organization_id,
    departments.id,
    NULL::uuid
  )
);

CREATE POLICY public_read
ON public.departments
FOR SELECT
TO public
USING (false);

COMMENT ON POLICY "Authenticated users can manage departments" ON public.departments
  IS 'R3: replaces WITH CHECK (true) with admin-only department creation.';

COMMENT ON POLICY "Authenticated users can update departments" ON public.departments
  IS 'R3: replaces USING/WITH CHECK (true) with admin-only department updates.';

COMMENT ON POLICY "Authenticated users can view all departments" ON public.departments
  IS 'R3: replaces USING (true) with RBAC department-scoped visibility.';

COMMENT ON POLICY departments_select ON public.departments
  IS 'R3: replaces USING (true) with RBAC department-scoped visibility.';

COMMENT ON POLICY public_read ON public.departments
  IS 'R3: replaces public USING (true) with deny-by-default public access.';
