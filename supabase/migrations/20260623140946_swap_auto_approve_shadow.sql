-- Auto-Approve Swaps (SHADOW-FIRST). Additive: 4 tables, 2 enums, RPCs, RLS, and a
-- DEFENSIVE, OPT-IN enqueue trigger on shift_swaps. APPLIED to prod (version 20260623140946).
-- Hardened vs draft docs/implementation/migrations-draft/0002_swap_auto_approve.sql:
--   (1) enqueue trigger wrapped in EXCEPTION->RETURN NEW (never blocks a live swap),
--   (2) enqueues ONLY when an ENABLED policy exists (inert until an admin opts in),
--   (3) extensions.digest() qualified (pgcrypto lives in the extensions schema).
-- Shadow defaults: enabled=false, shadow_mode=true. No worker consumes the queue yet.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='swap_auto_decision_kind') THEN
    CREATE TYPE public.swap_auto_decision_kind AS ENUM ('AUTO_APPROVE','MANUAL_REVIEW','AUTO_REJECT');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='swap_queue_status') THEN
    CREATE TYPE public.swap_queue_status AS ENUM ('PENDING','CLAIMED','DONE','DLQ');
  END IF;
END $$;

-- 1. swap_approval_rules
CREATE TABLE IF NOT EXISTS public.swap_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  shadow_mode boolean NOT NULL DEFAULT true,
  auto_approve_warnings boolean NOT NULL DEFAULT false,
  confidence_min numeric NOT NULL DEFAULT 1.0 CHECK (confidence_min >= 0 AND confidence_min <= 1),
  max_auto_per_employee_per_week int NOT NULL DEFAULT 3 CHECK (max_auto_per_employee_per_week >= 0),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  version int NOT NULL DEFAULT 1,
  updated_by uuid NULL REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swap_approval_rules_rules_is_object CHECK (jsonb_typeof(rules)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS swap_approval_rules_org_default_uniq
  ON public.swap_approval_rules (organization_id) WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS swap_approval_rules_org_dept_uniq
  ON public.swap_approval_rules (organization_id, department_id) WHERE department_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_bump_swap_policy_version()
  RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog
AS $fn$
BEGIN
  IF NEW.* IS DISTINCT FROM OLD.* THEN
    NEW.version := OLD.version + 1; NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $fn$;
DROP TRIGGER IF EXISTS trg_bump_swap_policy_version ON public.swap_approval_rules;
CREATE TRIGGER trg_bump_swap_policy_version BEFORE UPDATE ON public.swap_approval_rules
  FOR EACH ROW EXECUTE FUNCTION public.fn_bump_swap_policy_version();

-- 2. swap_decisions
CREATE TABLE IF NOT EXISTS public.swap_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id uuid NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  decision public.swap_auto_decision_kind NOT NULL,
  guard_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  solver_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  policy_version int NOT NULL,
  engine_version text NOT NULL,
  requester_shift_version int,
  offered_shift_version int,
  shadow boolean NOT NULL DEFAULT false,
  committed boolean NOT NULL DEFAULT false,
  reverted_at timestamptz,
  reverted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS swap_decisions_swap_id_idx ON public.swap_decisions (swap_id);
CREATE INDEX IF NOT EXISTS swap_decisions_decision_idx ON public.swap_decisions (decision);
CREATE INDEX IF NOT EXISTS swap_decisions_created_at_idx ON public.swap_decisions (created_at DESC);

ALTER TABLE public.shift_swaps ADD COLUMN IF NOT EXISTS review_flag boolean DEFAULT false;
ALTER TABLE public.shift_swaps ADD COLUMN IF NOT EXISTS auto_decision_id uuid REFERENCES public.swap_decisions(id);

-- 3. swap_audit_log (append-only)
CREATE TABLE IF NOT EXISTS public.swap_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id uuid NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.swap_decisions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS swap_audit_log_swap_id_idx ON public.swap_audit_log (swap_id, created_at);
CREATE INDEX IF NOT EXISTS swap_audit_log_decision_idx ON public.swap_audit_log (decision_id);

CREATE OR REPLACE FUNCTION public.fn_swap_audit_immutable()
  RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'swap_audit_log is append-only (% blocked)', TG_OP;
END; $fn$;
DROP TRIGGER IF EXISTS trg_swap_audit_no_update ON public.swap_audit_log;
CREATE TRIGGER trg_swap_audit_no_update BEFORE UPDATE OR DELETE ON public.swap_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_swap_audit_immutable();

-- 4. swap_review_queue
CREATE TABLE IF NOT EXISTS public.swap_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id uuid NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status public.swap_queue_status NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swap_review_queue_swap_key_uniq UNIQUE (swap_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS swap_review_queue_claimable_idx
  ON public.swap_review_queue (status, next_attempt_at) WHERE status='PENDING';

-- 5. ENQUEUE TRIGGER — DEFENSIVE + OPT-IN. Never blocks the parent swap txn.
CREATE OR REPLACE FUNCTION public.enqueue_swap_auto_decision()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_req_ver int; v_off_ver int; v_org uuid; v_dept uuid;
  v_pol_ver int; v_enabled boolean; v_idem text;
BEGIN
  IF NEW.status <> 'MANAGER_PENDING'
     OR (TG_OP='UPDATE' AND OLD.status='MANAGER_PENDING') THEN
    RETURN NEW;
  END IF;

  SELECT version, organization_id, department_id
    INTO v_req_ver, v_org, v_dept
  FROM public.shifts WHERE id = NEW.requester_shift_id;

  -- GATE: only enqueue if an ENABLED policy exists for this scope (dept beats org).
  SELECT version, enabled INTO v_pol_ver, v_enabled
  FROM public.swap_approval_rules
  WHERE organization_id = v_org
    AND (department_id = v_dept OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  IF v_pol_ver IS NULL OR v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.target_shift_id IS NOT NULL THEN
    SELECT version INTO v_off_ver FROM public.shifts WHERE id = NEW.target_shift_id;
  ELSE
    v_off_ver := 0;
  END IF;

  v_idem := encode(
    extensions.digest(NEW.id::text || ':' || COALESCE(v_req_ver,0)::text || ':' ||
           COALESCE(v_off_ver,0)::text || ':' || v_pol_ver::text, 'sha256'), 'hex');

  INSERT INTO public.swap_review_queue (swap_id, idempotency_key)
  VALUES (NEW.id, v_idem) ON CONFLICT (swap_id, idempotency_key) DO NOTHING;

  INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
  VALUES (NEW.id, 'ENQUEUED', 'system',
          jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Enqueue is a best-effort side effect: NEVER block the parent swap transaction.
  RAISE WARNING 'enqueue_swap_auto_decision swallowed error (swap=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_enqueue_swap_auto_decision ON public.shift_swaps;
CREATE TRIGGER trg_enqueue_swap_auto_decision
  AFTER INSERT OR UPDATE OF status ON public.shift_swaps
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_swap_auto_decision();

-- 6. sm_swap_auto_decide
CREATE OR REPLACE FUNCTION public.sm_swap_auto_decide(
  p_swap_id uuid, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_swap public.shift_swaps%ROWTYPE;
  v_org uuid; v_dept uuid;
  v_policy public.swap_approval_rules%ROWTYPE;
  v_decision public.swap_auto_decision_kind;
  v_req_ver int; v_shadow boolean := false;
  v_gateway jsonb; v_decision_id uuid; v_existing uuid;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id=v_caller AND c.is_active=true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT id INTO v_existing FROM public.swap_decisions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'IDEMPOTENT_REPLAY', 'decision_id', v_existing);
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'GONE'); END IF;
  IF v_swap.status <> 'MANAGER_PENDING' THEN
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    VALUES (p_swap_id, 'SKIPPED_NOT_PENDING', 'system', jsonb_build_object('status', v_swap.status));
    RETURN jsonb_build_object('ok', true, 'code', 'NOT_PENDING', 'status', v_swap.status);
  END IF;

  SELECT organization_id, department_id INTO v_org, v_dept
  FROM public.shifts WHERE id = v_swap.requester_shift_id;
  SELECT * INTO v_policy FROM public.swap_approval_rules
  WHERE organization_id = v_org AND (department_id = v_dept OR department_id IS NULL)
  ORDER BY department_id NULLS LAST LIMIT 1;

  IF NOT FOUND OR v_policy.enabled IS NOT TRUE THEN
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    VALUES (p_swap_id, 'KILLSWITCH_OFF', 'system', jsonb_build_object('policy_found', FOUND));
    RETURN jsonb_build_object('ok', true, 'code', 'DISABLED');
  END IF;

  v_shadow := COALESCE(v_policy.shadow_mode, true);
  v_decision := (p_payload->>'decision')::public.swap_auto_decision_kind;

  INSERT INTO public.swap_decisions(
    swap_id, idempotency_key, decision, guard_result, eligibility_result,
    solver_result, reason, policy_version, engine_version,
    requester_shift_version, offered_shift_version, shadow, committed)
  VALUES (
    p_swap_id, p_idempotency_key, v_decision,
    COALESCE(p_payload->'guard_result','{}'::jsonb),
    COALESCE(p_payload->'eligibility_result','{}'::jsonb),
    COALESCE(p_payload->'solver_result','{}'::jsonb),
    p_payload->>'reason',
    COALESCE((p_payload->>'policy_version')::int, v_policy.version),
    COALESCE(p_payload->>'engine_version','unknown'),
    (p_payload->>'requester_shift_version')::int,
    (p_payload->>'offered_shift_version')::int,
    v_shadow, false)
  RETURNING id INTO v_decision_id;

  IF v_shadow THEN
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'SHADOW_SUPPRESSED', 'system', jsonb_build_object('would_be', v_decision));
    RETURN jsonb_build_object('ok', true, 'code', 'SHADOW', 'decision', v_decision, 'decision_id', v_decision_id);
  END IF;

  v_req_ver := (p_payload->>'requester_shift_version')::int;

  IF v_decision = 'AUTO_APPROVE' THEN
    v_gateway := public.sm_apply_shift_op(v_swap.requester_shift_id, v_req_ver, 'approve_trade',
                   jsonb_build_object('compliance_ok', true), NULL);
  ELSIF v_decision = 'AUTO_REJECT' THEN
    v_gateway := public.sm_apply_shift_op(v_swap.requester_shift_id, v_req_ver, 'reject_trade',
                   jsonb_build_object('reason', COALESCE(p_payload->>'reason','Auto-rejected')), NULL);
  ELSE
    UPDATE public.shift_swaps SET review_flag = true, auto_decision_id = v_decision_id, updated_at = now()
      WHERE id = p_swap_id;
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'DECIDED_MANUAL_REVIEW', 'system', jsonb_build_object('reason', p_payload->>'reason'));
    RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision_id', v_decision_id);
  END IF;

  IF COALESCE((v_gateway->>'ok')::boolean, false) THEN
    UPDATE public.swap_decisions SET committed = true WHERE id = v_decision_id;
    UPDATE public.shift_swaps SET auto_decision_id = v_decision_id, updated_at = now() WHERE id = p_swap_id;
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'COMMITTED', 'system', jsonb_build_object('decision', v_decision, 'gateway', v_gateway));
    RETURN jsonb_build_object('ok', true, 'code', 'COMMITTED', 'decision', v_decision, 'decision_id', v_decision_id);
  ELSE
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'GATEWAY_REFUSED', 'system', jsonb_build_object('gateway', v_gateway));
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_gateway->>'code','GATEWAY_REFUSED'),
                              'decision_id', v_decision_id, 'gateway', v_gateway);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_swap_auto_decide failed (swap=%, key=%): %', p_swap_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $fn$;
REVOKE ALL ON FUNCTION public.sm_swap_auto_decide(uuid, text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_swap_auto_decide(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_swap_auto_decide(uuid, text, jsonb) TO authenticated, service_role;

-- 7. sm_swap_auto_revert
CREATE OR REPLACE FUNCTION public.sm_swap_auto_revert(p_decision_id uuid, p_actor uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_dec public.swap_decisions%ROWTYPE;
  v_swap public.shift_swaps%ROWTYPE;
  v_req_ver int;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id=v_caller AND c.is_active=true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_dec FROM public.swap_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_dec.decision <> 'AUTO_APPROVE' OR v_dec.committed IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_REVERTABLE', 'note', 'Only a committed AUTO_APPROVE can be reverted');
  END IF;
  IF v_dec.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_REVERTED');
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = v_dec.swap_id;
  SELECT version INTO v_req_ver FROM public.shifts WHERE id = v_swap.requester_shift_id;

  PERFORM public.sm_approve_peer_swap(
    v_swap.target_shift_id, v_swap.requester_shift_id, v_swap.target_id, v_swap.requester_id);

  UPDATE public.swap_decisions SET reverted_at = now(), reverted_by = p_actor WHERE id = p_decision_id;
  INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
  VALUES (v_swap.id, p_decision_id, 'REVERTED', p_actor::text, jsonb_build_object('by', p_actor));
  RETURN jsonb_build_object('ok', true, 'code', 'REVERTED', 'decision_id', p_decision_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_swap_auto_revert failed (decision=%): %', p_decision_id, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $fn$;
REVOKE ALL ON FUNCTION public.sm_swap_auto_revert(uuid, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.sm_swap_auto_revert(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_swap_auto_revert(uuid, uuid) TO authenticated, service_role;

-- 8. RLS
ALTER TABLE public.swap_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swap_rules_admin_all ON public.swap_approval_rules;
CREATE POLICY swap_rules_admin_all ON public.swap_approval_rules FOR ALL
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
    WHERE c.user_id=auth.uid() AND c.is_active=true
      AND c.access_level IN ('gamma','delta','epsilon','zeta')
      AND c.organization_id = swap_approval_rules.organization_id))
  WITH CHECK (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
    WHERE c.user_id=auth.uid() AND c.is_active=true
      AND c.access_level IN ('gamma','delta','epsilon','zeta')
      AND c.organization_id = swap_approval_rules.organization_id));

DROP POLICY IF EXISTS swap_decisions_read ON public.swap_decisions;
CREATE POLICY swap_decisions_read ON public.swap_decisions FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
    WHERE c.user_id=auth.uid() AND c.is_active=true
      AND c.access_level IN ('gamma','delta','epsilon','zeta')));

DROP POLICY IF EXISTS swap_audit_read ON public.swap_audit_log;
CREATE POLICY swap_audit_read ON public.swap_audit_log FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
    WHERE c.user_id=auth.uid() AND c.is_active=true
      AND c.access_level IN ('gamma','delta','epsilon','zeta')));
-- swap_review_queue: no policy => RLS denies authenticated; the service-role worker bypasses RLS.
