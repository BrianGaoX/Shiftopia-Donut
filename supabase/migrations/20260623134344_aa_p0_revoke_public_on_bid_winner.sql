-- sm_select_bid_winner retained a PUBLIC EXECUTE grant from baseline; anon inherits
-- it via PUBLIC. Revoke PUBLIC so only the explicitly-granted authenticated +
-- service_role roles can call this mutating function.
-- APPLIED to prod as migration version 20260623134344.
REVOKE EXECUTE ON FUNCTION public.sm_select_bid_winner(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sm_select_bid_winner(uuid, uuid, uuid) FROM anon;
