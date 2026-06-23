-- =============================================================================
-- ROLLBACK ARTIFACT — original prod definition of sm_select_bid_winner
-- Captured from prod (project srfozdlphoempdattvtx) on 2026-06-23, BEFORE applying
-- migration 0001 (hardened wrapper). To revert the hardening, run this verbatim.
--
-- ⚠️ This is the UNSAFE original (no FOUND / FSM / winner-pending / TTS guards) — it
-- is the source of the audited P0 double-assign / ghost-assign / withdrawn-revival /
-- window-lock-bypass defects. Only restore it if the hardened version causes a
-- regression that must be unblocked immediately; then re-fix forward.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(p_shift_id uuid, p_winner_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift     RECORD;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

  UPDATE public.shift_bids SET status = 'accepted', updated_at = now()
  WHERE shift_id = p_shift_id AND employee_id = p_winner_id;

  UPDATE public.shift_bids SET status = 'rejected', updated_at = now()
  WHERE shift_id = p_shift_id AND employee_id != p_winner_id
    AND status = 'pending';

  UPDATE public.shifts SET
    assigned_employee_id = p_winner_id,
    assignment_status    = 'assigned'::public.shift_assignment_status,
    assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding        = FALSE,
    fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
    updated_at           = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true);
END; $function$;
