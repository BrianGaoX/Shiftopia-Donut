-- Lock anon out of the assignment functions. Supabase default privileges grant
-- EXECUTE to anon on public functions, so REVOKE FROM public is insufficient —
-- revoke anon explicitly. anon is never a legitimate caller (these read auth.uid()
-- and delegate to the authz-checking gateway). Mutating fns must not be anon-callable.
-- APPLIED to prod as migration version 20260623134311.
REVOKE EXECUTE ON FUNCTION public.sm_select_bid_winner(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_assignment_run_start(jsonb, text, int, jsonb, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_assignment_run_finish(uuid, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sm_assignment_run_rollback(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.aa_user_manages_org(uuid, uuid) FROM anon;
