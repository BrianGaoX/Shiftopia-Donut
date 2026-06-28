-- R3: Harden work_rules RLS policies that previously used USING (true)
-- or WITH CHECK (true).
--
-- work_rules is a global configuration table without organization_id,
-- department_id, or sub_department_id columns. Management is admin-only;
-- reads are limited to authenticated users with active system access.

ALTER TABLE public.work_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage work rules" ON public.work_rules;
DROP POLICY IF EXISTS "Admins can update work rules" ON public.work_rules;
DROP POLICY IF EXISTS "Everyone can view work rules" ON public.work_rules;

CREATE POLICY "Admins can manage work rules"
ON public.work_rules
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update work rules"
ON public.work_rules
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Everyone can view work rules"
ON public.work_rules
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.user_has_any_contract((SELECT auth.uid()))
);

COMMENT ON POLICY "Admins can manage work rules" ON public.work_rules
  IS 'R3: replaces WITH CHECK (true) with admin-only work rule creation.';

COMMENT ON POLICY "Admins can update work rules" ON public.work_rules
  IS 'R3: replaces USING/WITH CHECK (true) with admin-only work rule updates.';

COMMENT ON POLICY "Everyone can view work rules" ON public.work_rules
  IS 'R3: replaces USING (true) with authenticated system-user visibility.';
