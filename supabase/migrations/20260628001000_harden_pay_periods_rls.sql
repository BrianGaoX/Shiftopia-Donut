-- R3: Harden pay_periods RLS policies that previously used USING (true)
-- or WITH CHECK (true).

ALTER TABLE public.pay_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage pay periods" ON public.pay_periods;
DROP POLICY IF EXISTS "Admins can update pay periods" ON public.pay_periods;
DROP POLICY IF EXISTS "Everyone can view pay periods" ON public.pay_periods;

CREATE POLICY "Admins can manage pay periods"
ON public.pay_periods
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update pay periods"
ON public.pay_periods
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Everyone can view pay periods"
ON public.pay_periods
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.user_has_any_contract((SELECT auth.uid()))
  OR EXISTS (
    SELECT 1
    FROM public.app_access_certificates ac
    WHERE ac.user_id = (SELECT auth.uid())
      AND ac.is_active = true
  )
);

COMMENT ON POLICY "Admins can manage pay periods" ON public.pay_periods
  IS 'R3: replaces WITH CHECK (true) with admin-only pay period creation.';

COMMENT ON POLICY "Admins can update pay periods" ON public.pay_periods
  IS 'R3: replaces USING/WITH CHECK (true) with admin-only pay period updates.';

COMMENT ON POLICY "Everyone can view pay periods" ON public.pay_periods
  IS 'R3: replaces USING (true) with authenticated system-user visibility.';
