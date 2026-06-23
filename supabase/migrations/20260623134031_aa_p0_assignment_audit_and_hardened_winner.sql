-- Auto-Assign Bids P0: audit tables + run RPCs + hardened transitional sm_select_bid_winner.
-- Validated against live schema 2026-06-23 and APPLIED to prod via apply_migration.
-- Additive; hardens 1 function in place. Mirrors prod migration version 20260623134031.
-- Design + rationale: docs/implementation/01-auto-assign-bids-refactor.md,
-- docs/implementation/migrations-draft/0001_assignment_audit_and_engine.sql.

-- 0. Cert-based authz helper.
CREATE OR REPLACE FUNCTION public.aa_user_manages_org(p_user uuid, p_org uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.app_access_certificates c
        WHERE c.user_id = p_user AND c.is_active = true
          AND c.access_level IN ('gamma','delta','epsilon','zeta')
          AND (c.organization_id = p_org OR c.organization_id IS NULL)
      );
$$;
REVOKE ALL ON FUNCTION public.aa_user_manages_org(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.aa_user_manages_org(uuid, uuid) TO authenticated, service_role;

-- 1. assignment_runs
CREATE TABLE IF NOT EXISTS public.assignment_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id),
  department_id     uuid NULL REFERENCES public.departments(id),
  sub_department_id uuid NULL REFERENCES public.sub_departments(id),
  actor_id          uuid NOT NULL,
  scope             jsonb NOT NULL DEFAULT '{}'::jsonb,
  dry_run           boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','RUNNING','COMPLETED','PARTIALLY_FAILED','ROLLED_BACK','ABORTED')),
  engine_version    text NOT NULL,
  policy_version    int NOT NULL DEFAULT 1,
  options           jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor            jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary           jsonb NULL,
  error             text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz NULL,
  finished_at       timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_runs_org_created ON public.assignment_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_runs_status ON public.assignment_runs (status) WHERE status IN ('PENDING','RUNNING');

-- 2. assignment_decisions
CREATE TABLE IF NOT EXISTS public.assignment_decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES public.assignment_runs(id) ON DELETE CASCADE,
  shift_id            uuid NOT NULL REFERENCES public.shifts(id),
  winner_employee_id  uuid NULL,
  runners_up          jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason              text NOT NULL,
  rule_hits           jsonb NOT NULL DEFAULT '[]'::jsonb,
  composite_score     numeric NULL CHECK (composite_score IS NULL OR composite_score BETWEEN 0 AND 100),
  outcome             text NOT NULL
                        CHECK (outcome IN ('ASSIGNED','SKIPPED_NO_ELIGIBLE','SKIPPED_BLOCKED','SKIPPED_LOCKED','CONFLICT_RETRY','ERROR')),
  engine_version      text NOT NULL,
  policy_version      int NOT NULL DEFAULT 1,
  version_before      int NULL,
  version_after       int NULL,
  committed           boolean NOT NULL DEFAULT true,
  idempotency_key     text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_assignment_decision_run_shift UNIQUE (run_id, shift_id),
  CONSTRAINT ck_assignment_decision_version_monotone
    CHECK (version_before IS NULL OR version_after IS NULL OR version_before <= version_after)
);
CREATE INDEX IF NOT EXISTS idx_assignment_decisions_run ON public.assignment_decisions (run_id);
CREATE INDEX IF NOT EXISTS idx_assignment_decisions_shift ON public.assignment_decisions (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_decisions_idem ON public.assignment_decisions (idempotency_key);

-- 3. assignment_events
CREATE TABLE IF NOT EXISTS public.assignment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES public.assignment_runs(id) ON DELETE CASCADE,
  shift_id    uuid NULL REFERENCES public.shifts(id),
  event_type  text NOT NULL
                CHECK (event_type IN ('RUN_STARTED','RUN_FINISHED','RUN_ROLLED_BACK','SHIFT_ASSIGNED','SHIFT_SKIPPED','SHIFT_CONFLICT','SHIFT_ROLLBACK')),
  actor_id    uuid NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignment_events_run ON public.assignment_events (run_id, created_at);

-- 4. RLS
ALTER TABLE public.assignment_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_assignment_runs_read ON public.assignment_runs;
CREATE POLICY p_assignment_runs_read ON public.assignment_runs
  FOR SELECT TO authenticated USING (public.aa_user_manages_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS p_assignment_decisions_read ON public.assignment_decisions;
CREATE POLICY p_assignment_decisions_read ON public.assignment_decisions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.assignment_runs r WHERE r.id = assignment_decisions.run_id
      AND public.aa_user_manages_org(auth.uid(), r.organization_id)));

DROP POLICY IF EXISTS p_assignment_events_read ON public.assignment_events;
CREATE POLICY p_assignment_events_read ON public.assignment_events
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.assignment_runs r WHERE r.id = assignment_events.run_id
      AND public.aa_user_manages_org(auth.uid(), r.organization_id)));

-- 5. sm_assignment_run_start
CREATE OR REPLACE FUNCTION public.sm_assignment_run_start(
  p_scope jsonb, p_engine_version text, p_policy_version int DEFAULT 1,
  p_options jsonb DEFAULT '{}'::jsonb, p_dry_run boolean DEFAULT false)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org    uuid := NULLIF(p_scope->>'organization_id','')::uuid;
  v_run    public.assignment_runs%ROWTYPE;
BEGIN
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'MISSING_ORG'); END IF;
  IF v_caller IS NOT NULL AND NOT public.aa_user_manages_org(v_caller, v_org) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  INSERT INTO public.assignment_runs (
    organization_id, department_id, sub_department_id, actor_id, scope,
    dry_run, status, engine_version, policy_version, options, started_at
  ) VALUES (
    v_org, NULLIF(p_scope->>'department_id','')::uuid, NULLIF(p_scope->>'sub_department_id','')::uuid,
    COALESCE(v_caller, '00000000-0000-0000-0000-000000000000'::uuid),
    p_scope, p_dry_run, 'RUNNING', p_engine_version, p_policy_version, p_options, now()
  ) RETURNING * INTO v_run;
  INSERT INTO public.assignment_events (run_id, event_type, actor_id, metadata)
  VALUES (v_run.id, 'RUN_STARTED', v_caller,
          jsonb_build_object('scope', p_scope, 'dry_run', p_dry_run, 'options', p_options));
  RETURN jsonb_build_object('ok', true, 'run_id', v_run.id, 'status', 'RUNNING');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_assignment_run_start error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.sm_assignment_run_start(jsonb, text, int, jsonb, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.sm_assignment_run_start(jsonb, text, int, jsonb, boolean) TO authenticated, service_role;

-- 6. sm_assignment_run_finish
CREATE OR REPLACE FUNCTION public.sm_assignment_run_finish(
  p_run_id uuid, p_status text, p_summary jsonb DEFAULT NULL, p_error text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_run    public.assignment_runs%ROWTYPE;
BEGIN
  IF p_status NOT IN ('COMPLETED','PARTIALLY_FAILED','ABORTED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
  END IF;
  SELECT * INTO v_run FROM public.assignment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_RUN'); END IF;
  IF v_caller IS NOT NULL AND NOT public.aa_user_manages_org(v_caller, v_run.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  UPDATE public.assignment_runs
     SET status = p_status, summary = COALESCE(p_summary, summary), error = p_error, finished_at = now()
   WHERE id = p_run_id;
  INSERT INTO public.assignment_events (run_id, event_type, actor_id, metadata)
  VALUES (p_run_id, 'RUN_FINISHED', v_caller,
          jsonb_build_object('status', p_status, 'summary', p_summary, 'error', p_error));
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'status', p_status);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_assignment_run_finish error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.sm_assignment_run_finish(uuid, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.sm_assignment_run_finish(uuid, text, jsonb, text) TO authenticated, service_role;

-- 7. sm_assignment_run_rollback  (single-arg; actor = auth.uid())
CREATE OR REPLACE FUNCTION public.sm_assignment_run_rollback(p_run_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_run    public.assignment_runs%ROWTYPE;
  v_dec    RECORD;
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_reverted jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
  v_skip   text;
BEGIN
  SELECT * INTO v_run FROM public.assignment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_RUN'); END IF;
  IF v_caller IS NOT NULL AND NOT public.aa_user_manages_org(v_caller, v_run.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF v_run.status NOT IN ('COMPLETED','PARTIALLY_FAILED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_ROLLBACKABLE', 'status', v_run.status);
  END IF;
  IF v_run.dry_run THEN RETURN jsonb_build_object('ok', false, 'code', 'DRY_RUN_HAS_NO_EFFECT'); END IF;

  FOR v_dec IN
    SELECT * FROM public.assignment_decisions
    WHERE run_id = p_run_id AND outcome = 'ASSIGNED' AND committed = true AND version_after IS NOT NULL
    ORDER BY shift_id ASC
  LOOP
    v_skip := NULL;
    SELECT * INTO v_shift FROM public.shifts WHERE id = v_dec.shift_id FOR UPDATE;
    IF NOT FOUND OR v_shift.deleted_at IS NOT NULL OR v_shift.is_cancelled THEN v_skip := 'GONE';
    ELSIF v_shift.version <> v_dec.version_after THEN v_skip := 'EDITED_SINCE';
    ELSIF v_shift.trading_status <> 'NoTrade' THEN v_skip := 'TRADED_SINCE';
    ELSIF EXTRACT(EPOCH FROM (v_shift.scheduled_start - now())) < 4 * 3600 THEN v_skip := 'TTS_LOCKED';
    END IF;
    IF v_skip IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('shift_id', v_dec.shift_id, 'reason', v_skip);
      CONTINUE;
    END IF;
    v_state := public.get_shift_fsm_state(
      v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome,
      v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
    IF v_state <> 'S4' THEN
      v_skipped := v_skipped || jsonb_build_object('shift_id', v_dec.shift_id, 'reason', 'STATE_' || v_state);
      CONTINUE;
    END IF;
    UPDATE public.shift_bids SET status = 'pending', updated_at = now()
     WHERE shift_id = v_dec.shift_id AND employee_id = v_dec.winner_employee_id AND status = 'accepted';
    UPDATE public.shifts SET
      assigned_employee_id = NULL, assigned_at = NULL,
      assignment_status = 'unassigned'::public.shift_assignment_status,
      assignment_outcome = NULL, confirmed_at = NULL,
      bidding_status = 'on_bidding'::public.shift_bidding_status,
      is_on_bidding = TRUE, bidding_enabled = TRUE,
      fulfillment_status = 'bidding'::public.shift_fulfillment_status,
      last_modified_by = v_caller,
      last_modified_reason = 'Auto-assign run rollback ' || p_run_id::text,
      updated_at = now()
    WHERE id = v_dec.shift_id;
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata)
    VALUES (v_dec.shift_id, v_dec.winner_employee_id, v_caller, 'UNASSIGNED',
      jsonb_build_object('op', 'run_rollback', 'run_id', p_run_id, 'from_version', v_dec.version_after,
        'idem', extensions.uuid_generate_v5('00000000-0000-0000-0000-0000000000aa'::uuid,
                  p_run_id::text || ':rb:' || v_dec.shift_id::text)));
    INSERT INTO public.assignment_events (run_id, shift_id, event_type, actor_id, metadata)
    VALUES (p_run_id, v_dec.shift_id, 'SHIFT_ROLLBACK', v_caller,
            jsonb_build_object('version_before', v_dec.version_after));
    v_reverted := v_reverted || jsonb_build_object('shift_id', v_dec.shift_id);
  END LOOP;

  UPDATE public.assignment_runs SET status = 'ROLLED_BACK', finished_at = now() WHERE id = p_run_id;
  INSERT INTO public.assignment_events (run_id, event_type, actor_id, metadata)
  VALUES (p_run_id, 'RUN_ROLLED_BACK', v_caller,
          jsonb_build_object('reverted', v_reverted, 'skipped', v_skipped));
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'status', 'ROLLED_BACK',
                            'reverted', v_reverted, 'skipped', v_skipped);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_assignment_run_rollback error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.sm_assignment_run_rollback(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.sm_assignment_run_rollback(uuid) TO authenticated, service_role;

-- 8. HARDENED transitional sm_select_bid_winner (FOUND/FSM/winner-pending/TTS, then delegate to gateway)
CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(
  p_shift_id uuid, p_winner_id uuid, p_user_id uuid DEFAULT auth.uid())
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_tts    int;
  v_ver    int;
  v_idem   uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_shift.is_cancelled THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_GONE');
  END IF;
  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome,
    v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
  IF NOT public.fsm_op_is_legal(v_state, 'select_winner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ILLEGAL_STATE', 'state', v_state);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shift_bids
    WHERE shift_id = p_shift_id AND employee_id = p_winner_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WINNER_NOT_PENDING');
  END IF;
  v_tts := EXTRACT(EPOCH FROM (v_shift.scheduled_start - now()))::int;
  IF v_tts < 4 * 3600 THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_TIME_LOCKED', 'tts_seconds', v_tts);
  END IF;
  v_ver  := v_shift.version;
  v_idem := extensions.uuid_generate_v5('00000000-0000-0000-0000-0000000000bb'::uuid,
              p_shift_id::text || ':' || v_ver::text || ':' || p_winner_id::text);
  v_result := public.sm_apply_shift_op(p_shift_id, v_ver, 'select_winner',
                jsonb_build_object('winner_id', p_winner_id), v_idem);
  IF COALESCE((v_result->>'ok')::boolean, false)
     AND v_result->>'code' IN ('APPLIED', 'IDEMPOTENT_REPLAY') THEN
    RETURN jsonb_build_object('success', true, 'version', v_result->>'version');
  END IF;
  RETURN jsonb_build_object('success', false,
                            'error', COALESCE(v_result->>'code', 'GATEWAY_FAILURE'), 'detail', v_result);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_select_bid_winner error (shift=%): %', p_shift_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sm_select_bid_winner(uuid, uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.sm_select_bid_winner(uuid, uuid, uuid) IS
  'DEPRECATED transitional wrapper. Hardened: FOUND/FSM/winner-pending/TTS guards, then DELEGATES to sm_apply_shift_op(select_winner) for the CAS+FSM+audit write. To be DROPPED once all call sites use sm_apply_shift_op directly.';
