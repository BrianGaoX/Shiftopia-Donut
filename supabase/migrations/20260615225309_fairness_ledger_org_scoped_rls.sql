-- F1 — Fairness Ledger: org-scoped RLS (multi-tenant isolation).
--
-- The original policy (20260615000000_fairness_ledger.sql) gated the ledger with
-- `(is_manager_or_above() OR is_admin())`. Two problems with that for true
-- multi-tenant isolation:
--
--   1. It is NOT org-scoped — any privileged user could read/write *every*
--      organization's fairness rows.
--   2. public.is_manager_or_above() reads profiles.system_role, a column that
--      does not exist in this database, so its EXCEPTION handler makes it always
--      return FALSE. The clause was therefore dead, and access actually reduced
--      to is_admin() (legacy_system_role IN ('admin','manager') OR a global
--      zeta/epsilon certificate) — still cross-org.
--
-- This migration replaces it with a cert-based, org-scoped policy:
--
--   • platform super-admins (profiles.legacy_system_role = 'admin')
--         → cross-org oversight (global), and
--   • managers holding an ACTIVE manager-level access certificate
--     (gamma/delta/epsilon/zeta) in the ROW's organization
--         → that organization only (true tenant isolation),
--   • service_role
--         → bypasses RLS entirely (server-side recompute jobs).
--
-- Org membership / manager level is read from public.app_access_certificates —
-- the same working source the bulk-assign authz path uses
-- (see 20260613010000_atomic_bulk_assign.sql). We intentionally do NOT depend on
-- is_manager_or_above() here so the policy is correct regardless of that bug.
--
-- Lockout analysis (project srfozdlphoempdattvtx, at time of writing): the only
-- users with current access are 1 legacy admin (retained via the admin branch)
-- and the epsilon certificate holders (retained, now scoped to their org). No
-- current user loses access; the ledger table is empty so there is no data-
-- exposure transition risk.
--
-- Idempotent: drops both the old and new policy names before recreating.

ALTER TABLE public.fairness_ledger ENABLE ROW LEVEL SECURITY;

-- Policies can't be CREATE OR REPLACE'd — drop-then-create. Safe to re-run, and
-- safe whether or not the prior migration's policy is present.
DROP POLICY IF EXISTS fairness_ledger_manager_all ON public.fairness_ledger;
DROP POLICY IF EXISTS fairness_ledger_org_scoped  ON public.fairness_ledger;

CREATE POLICY fairness_ledger_org_scoped ON public.fairness_ledger
    FOR ALL TO authenticated
    USING (
        -- Platform super-admin: cross-org oversight.
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.legacy_system_role = 'admin'
        )
        -- Manager with an active manager-level cert IN THIS ROW's org.
        OR EXISTS (
            SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = auth.uid()
              AND c.is_active = true
              AND c.organization_id = fairness_ledger.organization_id
              AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.legacy_system_role = 'admin'
        )
        OR EXISTS (
            SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = auth.uid()
              AND c.is_active = true
              AND c.organization_id = fairness_ledger.organization_id
              AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        )
    );

COMMENT ON POLICY fairness_ledger_org_scoped ON public.fairness_ledger IS
    'F1: legacy admins have cross-org oversight; managers are restricted to '
    'organizations where they hold an active manager-level (gamma+) '
    'app_access_certificate. service_role bypasses RLS.';
