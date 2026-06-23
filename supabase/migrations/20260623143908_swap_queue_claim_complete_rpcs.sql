-- Race-safe queue claim/complete for the auto-approve-swaps worker. SKIP LOCKED
-- claiming + exponential backoff + DLQ. Service-role only (the worker). Additive;
-- touches only the dormant swap_review_queue. APPLIED to prod (version 20260623143908).

-- Claim up to p_limit due rows (PENDING due, or CLAIMED-but-stale >5min = crashed worker).
CREATE OR REPLACE FUNCTION public.sm_swap_queue_claim(p_worker text, p_limit int DEFAULT 10)
  RETURNS SETOF public.swap_review_queue
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.swap_review_queue q
     SET status = 'CLAIMED', locked_by = p_worker, locked_at = now(),
         attempts = q.attempts + 1, updated_at = now()
   WHERE q.id IN (
     SELECT id FROM public.swap_review_queue
      WHERE (status = 'PENDING' AND next_attempt_at <= now())
         OR (status = 'CLAIMED' AND locked_at < now() - interval '5 minutes')
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING q.*;
END;
$$;
REVOKE ALL ON FUNCTION public.sm_swap_queue_claim(text, int) FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_swap_queue_claim(text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_swap_queue_claim(text, int) TO service_role;

-- Settle a claimed row: DONE | RETRY (backoff, -> DLQ at max_attempts) | DLQ.
CREATE OR REPLACE FUNCTION public.sm_swap_queue_complete(p_id uuid, p_status text, p_error text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.swap_review_queue%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.swap_review_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF p_status = 'DONE' THEN
    UPDATE public.swap_review_queue
       SET status='DONE', last_error=p_error, locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'code', 'DONE');

  ELSIF p_status = 'RETRY' THEN
    IF v_row.attempts >= v_row.max_attempts THEN
      UPDATE public.swap_review_queue
         SET status='DLQ', last_error=p_error, locked_by=NULL, locked_at=NULL, updated_at=now()
       WHERE id = p_id;
      RETURN jsonb_build_object('ok', true, 'code', 'DLQ');
    END IF;
    UPDATE public.swap_review_queue
       SET status='PENDING', last_error=p_error, locked_by=NULL, locked_at=NULL,
           next_attempt_at = now() + make_interval(mins => LEAST(POWER(2, v_row.attempts)::int, 60)),
           updated_at=now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'code', 'RETRY_SCHEDULED');

  ELSIF p_status = 'DLQ' THEN
    UPDATE public.swap_review_queue
       SET status='DLQ', last_error=p_error, locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'code', 'DLQ');
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
END;
$$;
REVOKE ALL ON FUNCTION public.sm_swap_queue_complete(uuid, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_swap_queue_complete(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_swap_queue_complete(uuid, text, text) TO service_role;
