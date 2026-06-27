-- R3: Harden organizations RLS policies that used USING (true) / WITH CHECK (true).
--
-- Scope of this PR is intentionally limited to policies that were permissive
-- true. Existing policies that already use public.is_admin() are left unchanged:
--   - organizations_delete
--   - organizations_insert
--   - organizations_update
--
-- Effective rules after this migration:
--   - organization SELECT is scoped to organizations attached to the caller's
--     active contract/certificate, plus platform admins;
--   - public/anon organization enumeration is denied;
--   - the legacy broad INSERT/UPDATE policies are reduced to public.is_admin(),
--     matching the existing non-true companion policies.

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can update organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON public.organizations;
DROP POLICY IF EXISTS organizations_select ON public.organizations;
DROP POLICY IF EXISTS public_read ON public.organizations;

CREATE POLICY "Authenticated users can create organizations"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users can update organizations"
ON public.organizations
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users can view organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.legacy_system_role = 'admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active = true
      AND p.legacy_organization_id = organizations.id
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_contracts uc
    WHERE uc.user_id = (SELECT auth.uid())
      AND uc.status = 'Active'
      AND uc.organization_id = organizations.id
  )
  OR EXISTS (
    SELECT 1
    FROM public.app_access_certificates ac
    WHERE ac.user_id = (SELECT auth.uid())
      AND ac.is_active = true
      AND (
        ac.access_level = 'zeta'
        OR ac.organization_id = organizations.id
      )
  )
);

CREATE POLICY organizations_select
ON public.organizations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.legacy_system_role = 'admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active = true
      AND p.legacy_organization_id = organizations.id
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_contracts uc
    WHERE uc.user_id = (SELECT auth.uid())
      AND uc.status = 'Active'
      AND uc.organization_id = organizations.id
  )
  OR EXISTS (
    SELECT 1
    FROM public.app_access_certificates ac
    WHERE ac.user_id = (SELECT auth.uid())
      AND ac.is_active = true
      AND (
        ac.access_level = 'zeta'
        OR ac.organization_id = organizations.id
      )
  )
);

CREATE POLICY public_read
ON public.organizations
FOR SELECT
TO public
USING (false);

COMMENT ON POLICY "Authenticated users can create organizations" ON public.organizations IS
  'R3: replaces WITH CHECK true; matches existing organizations_insert public.is_admin() policy.';

COMMENT ON POLICY "Authenticated users can update organizations" ON public.organizations IS
  'R3: replaces USING/WITH CHECK true; matches existing organizations_update public.is_admin() policy.';

COMMENT ON POLICY "Authenticated users can view organizations" ON public.organizations IS
  'R3: replaces USING true; users can read only organizations attached to their active contract/certificate, plus platform admins.';

COMMENT ON POLICY organizations_select ON public.organizations IS
  'R3: replaces USING true; same scoped read rule as Authenticated users can view organizations.';

COMMENT ON POLICY public_read ON public.organizations IS
  'R3: replaces public USING true; public/anon organization enumeration is intentionally denied.';
