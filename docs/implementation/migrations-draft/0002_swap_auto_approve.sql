-- =============================================================================
-- 0002_swap_auto_approve.sql  —  DRAFT (expand/contract-safe)
-- =============================================================================
-- Owner: doc 02 (Auto-Approve Swaps). Companion to:
--   docs/implementation/02-auto-approve-swaps.md
--   docs/implementation/00-contracts-and-conventions.md  (binding names)
--
-- DO NOT place this file in supabase/migrations/. Prod is live — a human
-- promotes drafts. This script is additive-only (expand phase): four new
-- tables, one trigger on shift_swaps, three RPCs, RLS. It NEVER alters or drops
-- an existing object in the same deploy. A commented -- ROLLBACK section at the
-- bottom inverts everything this file creates.
--
-- Conventions honoured (00-contracts §8):
--   * All RPCs SECURITY DEFINER, SET search_path = public, pg_catalog.
--   * Cert-based authz (is_manager_or_above() is BROKEN in prod). Manager column
--     is app_access_certificates.user_id; filter is_active = true.
--   * Single source of truth for swap state writes = sm_apply_shift_op gateway
--     (ops approve_trade / reject_trade). This file NEVER writes
--     shifts.assigned_employee_id directly.
--   * Idempotency key (00-contracts §5, D4):
--       sha256(swap_id || ':' || requester_shift_version || ':' ||
--              offered_shift_version || ':' || policy_version)
--     computed by the Edge worker and passed in as p_idempotency_key text.
--   * Fail closed (D5): any exception ⇒ MANUAL_REVIEW, never AUTO_APPROVE.
--   * Decision enum (00-contracts §6): AUTO_APPROVE | MANUAL_REVIEW | AUTO_REJECT.
-- =============================================================================

BEGIN;

-- Required extensions (no-ops if already present in prod baseline).
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()

-- -----------------------------------------------------------------------------
-- 0. ENUM — swap auto-decision
-- -----------------------------------------------------------------------------
-- ALTER TYPE ... ADD VALUE cannot run in the same txn as DML that uses it, so we
-- mint a fresh enum (no ADD VALUE on an existing type) — safe inside this txn.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'swap_auto_decision_kind') THEN
    CREATE TYPE public.swap_auto_decision_kind AS ENUM (
      'AUTO_APPROVE', 'MANUAL_REVIEW', 'AUTO_REJECT'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'swap_queue_status') THEN
    CREATE TYPE public.swap_queue_status AS ENUM (
      'PENDING', 'CLAIMED', 'DONE', 'DLQ'
    );
  END IF;
END $$;

-- =============================================================================
-- 1. swap_approval_rules  — org + nullable dept policy
-- =============================================================================
-- One row per (organization_id, department_id). department_id IS NULL = org
-- default. A dept row overrides the org row for that dept. `rules` is the
-- per-rule config map keyed by rule id (see 02-auto-approve-swaps.md §3):
--   { "same_role": {"enabled":true,"mode":"REQUIRE_EQUAL"}, ... }
-- Always-on rules (compliance, fatigue, overlap, time-lock, cert) are NOT
-- configurable here — the engine enforces them regardless of this jsonb.
CREATE TABLE IF NOT EXISTS public.swap_approval_rules (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id                   uuid     NULL REFERENCES public.departments(id)   ON DELETE CASCADE,
  enabled                         boolean NOT NULL DEFAULT false,   -- master on/off (kill-switch when false)
  shadow_mode                     boolean NOT NULL DEFAULT true,    -- decide + log, never act
  auto_approve_warnings           boolean NOT NULL DEFAULT false,   -- solver WARNING ⇒ approve when true
  confidence_min                  numeric NOT NULL DEFAULT 1.0 CHECK (confidence_min >= 0 AND confidence_min <= 1),
  max_auto_per_employee_per_week  int     NOT NULL DEFAULT 3 CHECK (max_auto_per_employee_per_week >= 0),
  rules                           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  version                         int     NOT NULL DEFAULT 1,       -- policy_version stamped on every decision
  updated_by                      uuid        NULL REFERENCES public.profiles(id),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  -- One policy per scope. NULLs are distinct in a normal UNIQUE, so a partial
  -- unique index pins the single org-default row, plus a unique for dept rows.
  CONSTRAINT swap_approval_rules_rules_is_object CHECK (jsonb_typeof(rules) = 'object')
);

-- Exactly one org-default (department_id IS NULL) per org.
CREATE UNIQUE INDEX IF NOT EXISTS swap_approval_rules_org_default_uniq
  ON public.swap_approval_rules (organization_id)
  WHERE department_id IS NULL;

-- Exactly one row per (org, dept) for dept overrides.
CREATE UNIQUE INDEX IF NOT EXISTS swap_approval_rules_org_dept_uniq
  ON public.swap_approval_rules (organization_id, department_id)
  WHERE department_id IS NOT NULL;

-- Auto-bump version + updated_at on any policy change so in-flight decisions can
-- pin the snapshot they were evaluated under (idempotency key includes it).
CREATE OR REPLACE FUNCTION public.fn_bump_swap_policy_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
AS $fn$
BEGIN
  IF NEW.* IS DISTINCT FROM OLD.* THEN
    NEW.version    := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_bump_swap_policy_version ON public.swap_approval_rules;
CREATE TRIGGER trg_bump_swap_policy_version
  BEFORE UPDATE ON public.swap_approval_rules
  FOR EACH ROW EXECUTE FUNCTION public.fn_bump_swap_policy_version();

-- =============================================================================
-- 2. swap_decisions  — immutable-ish decision record (one per idempotency_key)
-- =============================================================================
-- The worker UPSERTs on idempotency_key. Duplicate delivery with the same key =
-- no-op. A version drift on either shift ⇒ new key ⇒ a fresh row (legit
-- re-evaluation). `committed` flips true only when a terminal gateway op
-- actually ran (false in shadow_mode or for MANUAL_REVIEW).
CREATE TABLE IF NOT EXISTS public.swap_decisions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id                  uuid NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
  idempotency_key          text NOT NULL UNIQUE,
  decision                 public.swap_auto_decision_kind NOT NULL,
  guard_result             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- runSwapGuards GuardResult
  eligibility_result       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per-rule pass/fail + modes + payroll_delta
  solver_result            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- swapEvaluator SolverResult slice
  reason                   text,                                 -- machine + human readable
  policy_version           int  NOT NULL,
  engine_version           text NOT NULL,                        -- git short sha / semver const
  requester_shift_version  int,                                  -- CAS token captured at eval
  offered_shift_version    int,
  shadow                   boolean NOT NULL DEFAULT false,       -- decision taken under shadow_mode
  committed                boolean NOT NULL DEFAULT false,       -- terminal gateway op actually ran
  reverted_at              timestamptz,                          -- set by sm_swap_auto_revert
  reverted_by              uuid REFERENCES public.profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swap_decisions_swap_id_idx     ON public.swap_decisions (swap_id);
CREATE INDEX IF NOT EXISTS swap_decisions_decision_idx    ON public.swap_decisions (decision);
CREATE INDEX IF NOT EXISTS swap_decisions_created_at_idx  ON public.swap_decisions (created_at DESC);
-- Abuse detection: AUTO_APPROVE volume per employee per rolling window. The
-- worker resolves swap → (requester_id, target_id); we index by created_at +
-- decision so the rate-limit and pairwise-frequency queries are cheap.

-- back-reference + manager review flag on the swap row (additive).
ALTER TABLE public.shift_swaps
  ADD COLUMN IF NOT EXISTS review_flag      boolean DEFAULT false;
ALTER TABLE public.shift_swaps
  ADD COLUMN IF NOT EXISTS auto_decision_id uuid REFERENCES public.swap_decisions(id);

-- =============================================================================
-- 3. swap_audit_log  — append-only, immutable
-- =============================================================================
-- Every state transition of the auto-approve pipeline lands here: ENQUEUED,
-- CLAIMED, GUARDS_FAILED, ELIGIBILITY_*, SOLVER_*, DECIDED_*, COMMITTED,
-- SHADOW_SUPPRESSED, DLQ, REVERTED, ERROR. Updates/deletes are blocked by a
-- trigger — this table is the dispute / forensics record.
CREATE TABLE IF NOT EXISTS public.swap_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id      uuid NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
  decision_id  uuid REFERENCES public.swap_decisions(id) ON DELETE SET NULL,
  event_type   text NOT NULL,            -- e.g. 'DECIDED_AUTO_APPROVE', 'GUARDS_FAILED'
  actor        text NOT NULL DEFAULT 'system',  -- 'system' | uuid::text for admin overrides
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swap_audit_log_swap_id_idx    ON public.swap_audit_log (swap_id, created_at);
CREATE INDEX IF NOT EXISTS swap_audit_log_decision_idx   ON public.swap_audit_log (decision_id);

-- Immutability: forbid UPDATE/DELETE on swap_audit_log.
CREATE OR REPLACE FUNCTION public.fn_swap_audit_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'swap_audit_log is append-only (% blocked)', TG_OP;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_swap_audit_no_update ON public.swap_audit_log;
CREATE TRIGGER trg_swap_audit_no_update
  BEFORE UPDATE OR DELETE ON public.swap_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_swap_audit_immutable();

-- =============================================================================
-- 4. swap_review_queue  — durable, at-least-once work queue
-- =============================================================================
-- One row per (swap_id, idempotency_key). The enqueue trigger inserts on
-- MANAGER_PENDING; the Edge worker claims with SKIP LOCKED, processes, and marks
-- DONE/DLQ. attempts + next_attempt_at drive exponential backoff; locked_by /
-- locked_at make a stale claim reclaimable.
CREATE TABLE IF NOT EXISTS public.swap_review_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id          uuid NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL,
  status           public.swap_queue_status NOT NULL DEFAULT 'PENDING',
  attempts         int  NOT NULL DEFAULT 0,
  max_attempts     int  NOT NULL DEFAULT 5,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_by        text,            -- worker instance id
  locked_at        timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- De-dupe re-enqueues for the same swap version-tuple.
  CONSTRAINT swap_review_queue_swap_key_uniq UNIQUE (swap_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS swap_review_queue_claimable_idx
  ON public.swap_review_queue (status, next_attempt_at)
  WHERE status = 'PENDING';

-- =============================================================================
-- 5. ENQUEUE TRIGGER  — shift_swaps → MANAGER_PENDING enqueues the queue
-- =============================================================================
-- Fires when a swap transitions INTO MANAGER_PENDING. Builds a PROVISIONAL
-- idempotency key from the two shift versions + the resolved policy_version, so
-- the worker's recomputed key matches (it recomputes after re-reading versions
-- under lock; drift between enqueue and claim just yields a new key and a fresh
-- evaluation — never a missed one). enqueue_swap_auto_decision is the trigger fn
-- named in 00-contracts §4.
CREATE OR REPLACE FUNCTION public.enqueue_swap_auto_decision()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_req_ver   int;
  v_off_ver   int;
  v_org       uuid;
  v_dept      uuid;
  v_pol_ver   int;
  v_idem      text;
BEGIN
  -- Only act on the OPEN/OFFER_SELECTED → MANAGER_PENDING edge.
  IF NEW.status <> 'MANAGER_PENDING'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'MANAGER_PENDING') THEN
    RETURN NEW;
  END IF;

  -- Capture both shift versions (CAS tokens) for the key.
  SELECT version, organization_id, department_id
    INTO v_req_ver, v_org, v_dept
  FROM public.shifts WHERE id = NEW.requester_shift_id;

  IF NEW.target_shift_id IS NOT NULL THEN
    SELECT version INTO v_off_ver FROM public.shifts WHERE id = NEW.target_shift_id;
  ELSE
    v_off_ver := 0;  -- giveaway: no offered shift
  END IF;

  -- Resolve the effective policy_version (dept override beats org default).
  SELECT version INTO v_pol_ver
  FROM public.swap_approval_rules
  WHERE organization_id = v_org
    AND (department_id = v_dept OR department_id IS NULL)
  ORDER BY department_id NULLS LAST   -- dept-specific row first
  LIMIT 1;
  v_pol_ver := COALESCE(v_pol_ver, 0);  -- no policy row ⇒ treated as disabled (fail-closed)

  -- idempotency_key = sha256(swap_id:req_ver:off_ver:policy_version)  (00 §5)
  v_idem := encode(
    digest(NEW.id::text || ':' || COALESCE(v_req_ver,0)::text || ':' ||
           COALESCE(v_off_ver,0)::text || ':' || v_pol_ver::text, 'sha256'),
    'hex');

  INSERT INTO public.swap_review_queue (swap_id, idempotency_key)
  VALUES (NEW.id, v_idem)
  ON CONFLICT (swap_id, idempotency_key) DO NOTHING;

  INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
  VALUES (NEW.id, 'ENQUEUED', 'system',
          jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver));

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enqueue_swap_auto_decision ON public.shift_swaps;
CREATE TRIGGER trg_enqueue_swap_auto_decision
  AFTER INSERT OR UPDATE OF status ON public.shift_swaps
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_swap_auto_decision();

-- =============================================================================
-- 6. sm_swap_auto_decide(p_swap_id, p_idempotency_key)  — terminal commit RPC
-- =============================================================================
-- Called by the Edge worker AFTER it has run runSwapGuards + swapEvaluator +
-- the eligibility engine (those are TypeScript; they cannot run in PG). The
-- worker passes the materialized verdict in p_payload. This RPC owns the
-- TRANSACTIONAL part only:
--   * cert-based authz (NULL caller = service role = allowed),
--   * upsert swap_decisions on idempotency_key (idempotent replay = no-op),
--   * respect shadow_mode / enabled (kill-switch) — never act, only log,
--   * dispatch the terminal op via the gateway (approve_trade / reject_trade),
--   * write swap_decisions + swap_audit_log in ONE txn (audit ↔ op atomic),
--   * fail closed: any exception ⇒ record MANUAL_REVIEW, never approve.
--
-- p_payload shape (built by the worker):
--   { "decision": "AUTO_APPROVE|MANUAL_REVIEW|AUTO_REJECT",
--     "guard_result": {...}, "eligibility_result": {...}, "solver_result": {...},
--     "reason": "...", "policy_version": int, "engine_version": "...",
--     "requester_shift_version": int, "offered_shift_version": int,
--     "confidence": numeric }
CREATE OR REPLACE FUNCTION public.sm_swap_auto_decide(
  p_swap_id          uuid,
  p_idempotency_key  text,
  p_payload          jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_caller    uuid := auth.uid();
  v_swap      public.shift_swaps%ROWTYPE;
  v_org       uuid;
  v_dept      uuid;
  v_policy    public.swap_approval_rules%ROWTYPE;
  v_decision  public.swap_auto_decision_kind;
  v_req_ver   int;
  v_shadow    boolean := false;
  v_committed boolean := false;
  v_gateway   jsonb;
  v_decision_id uuid;
  v_existing  uuid;
BEGIN
  -- (a) Authz. NULL caller = service-role/system (the Edge worker) ⇒ allowed.
  -- A human caller must hold an active gamma+ cert (manager column = user_id).
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (
            SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = v_caller AND c.is_active = true
              AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  -- (b) Idempotent replay: this key already decided ⇒ no-op.
  SELECT id INTO v_existing FROM public.swap_decisions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'IDEMPOTENT_REPLAY', 'decision_id', v_existing);
  END IF;

  -- (c) Load swap. If gone or no longer MANAGER_PENDING (withdrawn/expired/
  -- already decided) ⇒ no-op (00-audit §6.8 withdrawn-mid-eval).
  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'GONE');
  END IF;
  IF v_swap.status <> 'MANAGER_PENDING' THEN
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    VALUES (p_swap_id, 'SKIPPED_NOT_PENDING', 'system',
            jsonb_build_object('status', v_swap.status));
    RETURN jsonb_build_object('ok', true, 'code', 'NOT_PENDING', 'status', v_swap.status);
  END IF;

  -- (d) Resolve effective policy (dept override beats org default).
  SELECT organization_id, department_id INTO v_org, v_dept
  FROM public.shifts WHERE id = v_swap.requester_shift_id;

  SELECT * INTO v_policy
  FROM public.swap_approval_rules
  WHERE organization_id = v_org
    AND (department_id = v_dept OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  -- Kill-switch / missing policy ⇒ fail-closed: no auto action.
  IF NOT FOUND OR v_policy.enabled IS NOT TRUE THEN
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    VALUES (p_swap_id, 'KILLSWITCH_OFF', 'system',
            jsonb_build_object('policy_found', FOUND));
    RETURN jsonb_build_object('ok', true, 'code', 'DISABLED');
  END IF;

  v_shadow   := COALESCE(v_policy.shadow_mode, true);
  v_decision := (p_payload->>'decision')::public.swap_auto_decision_kind;

  -- (e) Persist the decision row FIRST (audit ↔ op atomic in this txn).
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

  -- (f) Shadow mode: decide + log, NEVER act.
  IF v_shadow THEN
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'SHADOW_SUPPRESSED', 'system',
            jsonb_build_object('would_be', v_decision));
    RETURN jsonb_build_object('ok', true, 'code', 'SHADOW', 'decision', v_decision, 'decision_id', v_decision_id);
  END IF;

  -- (g) Live dispatch via the gateway. requester_shift_version is the CAS token;
  -- a drift since eval ⇒ VERSION_CONFLICT ⇒ caller re-queues with a new key.
  v_req_ver := (p_payload->>'requester_shift_version')::int;

  IF v_decision = 'AUTO_APPROVE' THEN
    v_gateway := public.sm_apply_shift_op(
      v_swap.requester_shift_id, v_req_ver, 'approve_trade',
      jsonb_build_object('compliance_ok', true), NULL);

  ELSIF v_decision = 'AUTO_REJECT' THEN
    v_gateway := public.sm_apply_shift_op(
      v_swap.requester_shift_id, v_req_ver, 'reject_trade',
      jsonb_build_object('reason', COALESCE(p_payload->>'reason','Auto-rejected')), NULL);

  ELSE  -- MANUAL_REVIEW: leave MANAGER_PENDING, raise the review flag.
    UPDATE public.shift_swaps
      SET review_flag = true, auto_decision_id = v_decision_id, updated_at = now()
      WHERE id = p_swap_id;
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'DECIDED_MANUAL_REVIEW', 'system',
            jsonb_build_object('reason', p_payload->>'reason'));
    RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision_id', v_decision_id);
  END IF;

  -- (h) Interpret the gateway envelope.
  IF COALESCE((v_gateway->>'ok')::boolean, false) THEN
    v_committed := true;
    UPDATE public.swap_decisions SET committed = true WHERE id = v_decision_id;
    UPDATE public.shift_swaps SET auto_decision_id = v_decision_id, updated_at = now()
      WHERE id = p_swap_id;
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'COMMITTED', 'system',
            jsonb_build_object('decision', v_decision, 'gateway', v_gateway));
    RETURN jsonb_build_object('ok', true, 'code', 'COMMITTED',
                              'decision', v_decision, 'decision_id', v_decision_id);
  ELSE
    -- Gateway refused (VERSION_CONFLICT / ILLEGAL_TRANSITION / WRITE_REJECTED).
    -- Fail closed: do NOT mark committed; log so the worker re-queues / DLQs.
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'GATEWAY_REFUSED', 'system',
            jsonb_build_object('gateway', v_gateway));
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_gateway->>'code','GATEWAY_REFUSED'),
                              'decision_id', v_decision_id, 'gateway', v_gateway);
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- (i) Fail closed (D5). Roll the txn forward only as a MANUAL_REVIEW audit
  -- breadcrumb — but since we're inside the same txn that may have inserted a
  -- decision row, we cannot partially commit. We re-raise a structured note;
  -- the worker treats a thrown sm_swap_auto_decide as fail-closed → MANUAL_REVIEW
  -- (it will requeue and, after max_attempts, route to manual via DLQ).
  RAISE WARNING 'sm_swap_auto_decide failed (swap=%, key=%): %', p_swap_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sm_swap_auto_decide(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.sm_swap_auto_decide(uuid, text, jsonb) TO authenticated, service_role;

-- =============================================================================
-- 7. sm_swap_auto_revert(p_decision_id, p_actor)  — admin rollback
-- =============================================================================
-- Inverse of an AUTO_APPROVE. Re-runs the swap in the opposite direction via the
-- gateway (approve_trade is reversible: the inverse swap reassigns each shift
-- back). Guarded by current state + the 4h time-lock (re-checked in the
-- gateway's publish/approve arms). Only an admin / org-manager cert may call it.
CREATE OR REPLACE FUNCTION public.sm_swap_auto_revert(
  p_decision_id uuid,
  p_actor       uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_dec     public.swap_decisions%ROWTYPE;
  v_swap    public.shift_swaps%ROWTYPE;
  v_req_ver int;
  v_gateway jsonb;
BEGIN
  -- Authz: admin or gamma+ cert.
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id = v_caller AND c.is_active = true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_dec FROM public.swap_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_dec.decision <> 'AUTO_APPROVE' OR v_dec.committed IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_REVERTABLE',
                              'note', 'Only a committed AUTO_APPROVE can be reverted');
  END IF;
  IF v_dec.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_REVERTED');
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = v_dec.swap_id;
  SELECT version INTO v_req_ver FROM public.shifts WHERE id = v_swap.requester_shift_id;

  -- Inverse reassignment: swap the parties back. sm_approve_peer_swap is
  -- symmetric; calling it with (target_shift, requester_shift, target, requester)
  -- restores the original ownership. Guarded by current state in the RPC.
  PERFORM public.sm_approve_peer_swap(
    v_swap.target_shift_id, v_swap.requester_shift_id,
    v_swap.target_id, v_swap.requester_id);

  UPDATE public.swap_decisions
    SET reverted_at = now(), reverted_by = p_actor WHERE id = p_decision_id;

  INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
  VALUES (v_swap.id, p_decision_id, 'REVERTED', p_actor::text,
          jsonb_build_object('by', p_actor));

  RETURN jsonb_build_object('ok', true, 'code', 'REVERTED', 'decision_id', p_decision_id);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_swap_auto_revert failed (decision=%): %', p_decision_id, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sm_swap_auto_revert(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.sm_swap_auto_revert(uuid, uuid) TO authenticated, service_role;

-- =============================================================================
-- 8. RLS  — swap_approval_rules is org-admin only
-- =============================================================================
ALTER TABLE public.swap_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_review_queue   ENABLE ROW LEVEL SECURITY;

-- Policy admin: only an org-scoped admin/manager cert may read/write rules.
DROP POLICY IF EXISTS swap_rules_admin_all ON public.swap_approval_rules;
CREATE POLICY swap_rules_admin_all ON public.swap_approval_rules
  FOR ALL
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_access_certificates c
      WHERE c.user_id = auth.uid() AND c.is_active = true
        AND c.access_level IN ('gamma','delta','epsilon','zeta')
        AND c.organization_id = swap_approval_rules.organization_id
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_access_certificates c
      WHERE c.user_id = auth.uid() AND c.is_active = true
        AND c.access_level IN ('gamma','delta','epsilon','zeta')
        AND c.organization_id = swap_approval_rules.organization_id
    )
  );

-- Decisions + audit: managers READ (transparency UI); no client writes (all
-- writes happen under SECURITY DEFINER as service role / the RPCs above).
DROP POLICY IF EXISTS swap_decisions_read ON public.swap_decisions;
CREATE POLICY swap_decisions_read ON public.swap_decisions
  FOR SELECT USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.app_access_certificates c
               WHERE c.user_id = auth.uid() AND c.is_active = true
                 AND c.access_level IN ('gamma','delta','epsilon','zeta'))
  );

DROP POLICY IF EXISTS swap_audit_read ON public.swap_audit_log;
CREATE POLICY swap_audit_read ON public.swap_audit_log
  FOR SELECT USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.app_access_certificates c
               WHERE c.user_id = auth.uid() AND c.is_active = true
                 AND c.access_level IN ('gamma','delta','epsilon','zeta'))
  );

-- Queue is service-role only (no client policy ⇒ RLS denies all authenticated
-- reads/writes; the worker uses the service role which bypasses RLS).

COMMIT;

-- =============================================================================
-- -- ROLLBACK  (contract phase — run manually to undo this draft)
-- =============================================================================
-- BEGIN;
--   DROP TRIGGER  IF EXISTS trg_enqueue_swap_auto_decision ON public.shift_swaps;
--   DROP TRIGGER  IF EXISTS trg_bump_swap_policy_version   ON public.swap_approval_rules;
--   DROP TRIGGER  IF EXISTS trg_swap_audit_no_update       ON public.swap_audit_log;
--
--   DROP FUNCTION IF EXISTS public.sm_swap_auto_revert(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.sm_swap_auto_decide(uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.enqueue_swap_auto_decision();
--   DROP FUNCTION IF EXISTS public.fn_bump_swap_policy_version();
--   DROP FUNCTION IF EXISTS public.fn_swap_audit_immutable();
--
--   DROP POLICY   IF EXISTS swap_rules_admin_all  ON public.swap_approval_rules;
--   DROP POLICY   IF EXISTS swap_decisions_read   ON public.swap_decisions;
--   DROP POLICY   IF EXISTS swap_audit_read       ON public.swap_audit_log;
--
--   ALTER TABLE   public.shift_swaps DROP COLUMN IF EXISTS auto_decision_id;
--   ALTER TABLE   public.shift_swaps DROP COLUMN IF EXISTS review_flag;
--
--   DROP TABLE    IF EXISTS public.swap_review_queue;
--   DROP TABLE    IF EXISTS public.swap_audit_log;
--   DROP TABLE    IF EXISTS public.swap_decisions;
--   DROP TABLE    IF EXISTS public.swap_approval_rules;
--
--   DROP TYPE     IF EXISTS public.swap_queue_status;
--   DROP TYPE     IF EXISTS public.swap_auto_decision_kind;
-- COMMIT;
-- =============================================================================
