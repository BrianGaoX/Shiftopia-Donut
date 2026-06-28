-- R3: Harden system_config RLS policies that previously used USING (true)
-- or WITH CHECK (true).
--
-- system_config is a global configuration table without organization_id,
-- department_id, or sub_department_id columns. Management is admin-only;
-- reads are limited to authenticated users with active system access.

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage system config" ON public.system_config;
DROP POLICY IF EXISTS "Admins can update system config" ON public.system_config;
DROP POLICY IF EXISTS "Everyone can view system config" ON public.system_config;

CREATE POLICY "Admins can manage system config"
ON public.system_config
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update system config"
ON public.system_config
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Everyone can view system config"
ON public.system_config
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.user_has_any_contract((SELECT auth.uid()))
);

COMMENT ON POLICY "Admins can manage system config" ON public.system_config
  IS 'R3: replaces WITH CHECK (true) with admin-only system config creation.';

COMMENT ON POLICY "Admins can update system config" ON public.system_config
  IS 'R3: replaces USING/WITH CHECK (true) with admin-only system config updates.';

COMMENT ON POLICY "Everyone can view system config" ON public.system_config
  IS 'R3: replaces USING (true) with authenticated system-user visibility.';
