-- Tighten RLS on public.remuneration_levels (pay-band reference data).
--
-- AUDIT FINDING (2026-06-16): the table carried over-permissive policies —
--   • "public_read"                                  → SELECT to anon/public (true)
--   • "Authenticated users can manage ..."           → INSERT for ANY authenticated (true)
--   • "Authenticated users can update ..."           → UPDATE for ANY authenticated (true)
-- i.e. pay bands (incl. hourly_rate_min/max) were readable unauthenticated and
-- writable by every signed-in user (employees included).
--
-- App usage (verified): remuneration_levels is read in authenticated surfaces
-- only — roster/timesheet/offers/attendance joins + a direct authenticated fetch
-- (src/modules/rosters/api/shifts.queries.ts). There is a single authenticated
-- Supabase client; no anonymous read path. So:
--   • KEEP authenticated SELECT (employees need level_name/rate via joins),
--   • DROP anonymous SELECT,
--   • RESTRICT writes (INSERT/UPDATE/DELETE) to managers/admins.
--
-- Manager/admin = public.is_manager_or_above() OR public.is_admin()
-- (is_manager_or_above was repaired in 20260616000000 — it now actually works).
--
-- Idempotent: drop-then-create.

ALTER TABLE public.remuneration_levels ENABLE ROW LEVEL SECURITY;

-- 1. Remove over-permissive + redundant policies.
DROP POLICY IF EXISTS "public_read"                                  ON public.remuneration_levels;  -- anon read
DROP POLICY IF EXISTS "Authenticated users can manage remuneration_levels" ON public.remuneration_levels;  -- INSERT true
DROP POLICY IF EXISTS "Authenticated users can update remuneration_levels" ON public.remuneration_levels;  -- UPDATE true
DROP POLICY IF EXISTS "remuneration_levels_select"                   ON public.remuneration_levels;  -- redundant (was the broken is_manager_or_above SELECT)

-- Kept as-is:
--   "Authenticated users can view remuneration_levels" (SELECT, authenticated, true) — employee read path.
--   "remuneration_levels_admin" (ALL, is_admin()) — admin full access.

-- 2. Manager/admin write policies (SELECT stays open to authenticated above).
DROP POLICY IF EXISTS remuneration_levels_mgr_insert ON public.remuneration_levels;
DROP POLICY IF EXISTS remuneration_levels_mgr_update ON public.remuneration_levels;
DROP POLICY IF EXISTS remuneration_levels_mgr_delete ON public.remuneration_levels;

CREATE POLICY remuneration_levels_mgr_insert ON public.remuneration_levels
    FOR INSERT TO authenticated
    WITH CHECK (public.is_manager_or_above() OR public.is_admin());

CREATE POLICY remuneration_levels_mgr_update ON public.remuneration_levels
    FOR UPDATE TO authenticated
    USING (public.is_manager_or_above() OR public.is_admin())
    WITH CHECK (public.is_manager_or_above() OR public.is_admin());

CREATE POLICY remuneration_levels_mgr_delete ON public.remuneration_levels
    FOR DELETE TO authenticated
    USING (public.is_manager_or_above() OR public.is_admin());
