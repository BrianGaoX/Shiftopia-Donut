-- Repair public.is_manager_or_above() — it has been silently broken in prod.
--
-- BUG: the function read `profiles.system_role`, a column that does not exist in
-- this database (the real column is `profiles.legacy_system_role`, enum
-- `system_role`). Because the body is wrapped in `EXCEPTION WHEN OTHERS THEN
-- RETURN FALSE`, every call swallowed the "column does not exist" error and
-- returned FALSE. The function was therefore a constant FALSE for all users.
--
-- AUDIT (project srfozdlphoempdattvtx, 2026-06-16): the only LIVE consumer was
-- the `remuneration_levels_select` RLS policy (standalone USING), which is masked
-- by four other permissive SELECT policies on that table — so the bug caused no
-- lockout. No function/RPC in prod references it. Net current impact ≈ nil; this
-- repair is future-proofing so any NEW standalone/AND usage or RPC gate works.
--
-- FIX: mirror the working public.is_admin() pattern but use the manager-level
-- certificate set. "Manager or above" is TRUE when the caller is either:
--   • a legacy admin/manager (profiles.legacy_system_role IN ('admin','manager')), or
--   • the holder of an active manager-level access certificate
--     (access_level IN ('gamma','delta','epsilon','zeta')).
--
-- Keep SECURITY DEFINER + pinned search_path + the EXCEPTION guard (defensive),
-- exactly as the original. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.is_manager_or_above()
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.legacy_system_role IN ('admin', 'manager')
    ) OR EXISTS (
        SELECT 1
        FROM public.app_access_certificates c
        WHERE c.user_id = auth.uid()
          AND c.is_active = true
          AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
    );
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$function$;
