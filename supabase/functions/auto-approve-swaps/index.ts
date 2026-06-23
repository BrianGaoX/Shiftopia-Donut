// =============================================================================
// auto-approve-swaps — Supabase Edge Function (Deno, service role)
//
// The WORKER that drains the swap auto-approve queue. For each due swap it
// PRODUCES a decision + evidence payload (guards → solver → eligibility →
// decision matrix) and hands it to the deployed RPC `sm_swap_auto_decide`,
// which OWNS the commit (idempotency dedup, shadow suppression, kill-switch,
// gateway approve_trade/reject_trade, and all swap_decisions/swap_audit_log
// writes). The worker never writes shifts directly.
//
// Implements docs/implementation/02-auto-approve-swaps.md (§1 queue, §2 matrix,
// §3 eligibility, §4 abuse) bound by 00-contracts-and-conventions.md
// (D3/D4/D5, idempotency §5, enums §6, RPC contracts).
//
// -----------------------------------------------------------------------------
// BUNDLING / IMPORT STRATEGY (full rationale in ./README.md)
// -----------------------------------------------------------------------------
// We VENDOR the v8 compliance engine into ./_vendor/compliance/ and rewire its
// browser-only leaves via ./import_map.json — identical to auto-assign-bids:
//   "@/platform/supabase/client" → ./_vendor/_shims/supabase-client.ts
//   "@sentry/react"              → ./_vendor/_shims/sentry.ts
// DIFFERENCE FROM auto-assign-bids: the swap pipeline reuses `runSwapGuards`,
// which does REAL DB reads through the supabase-client binding. So that shim is
// INJECTABLE (not a no-op): the worker pushes a service-role client into it
// before calling runSwapGuards, so the guards run RLS-blind under service role.
// `swapEvaluator.evaluate` is pure and imported unchanged.
//
// The aliases below resolve through import_map.json → "@compliance/".
import { runSwapGuards } from '@compliance/v8/swap-engine/guards.ts';
import { swapEvaluator } from '@compliance/v8/swap-engine/swap-evaluator.ts';
import type {
  GuardResult,
  SolverResult,
  ConstraintViolation,
} from '@compliance/v8/swap-engine/types.ts';
import { setComplianceSupabaseClient } from './_vendor/_shims/supabase-client.ts';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { evaluateEligibility } from './eligibility.ts';
import { decide } from './decision-matrix.ts';
import type {
  AutoDecideResult,
  AutoDecidePayload,
  EligParty,
  EligShift,
  EligibilityInput,
  ErrorResponse,
  GuardSummary,
  QueueComplete,
  QueueRow,
  RosterEntry,
  SolverSignals,
  SolverSummary,
  SwapPolicy,
  WorkerSummary,
} from './types.ts';

// =============================================================================
// CONSTANTS
// =============================================================================

const ENGINE_VERSION = 'auto-approve-swaps@1.0.0'; // stamped on every decision (00 §8)
const POLICY_VERSION_FALLBACK = 1; // only used if a policy row has no version

const ROSTER_WINDOW_DAYS = 30; // ±30d, mirrors validateSwapCompliance (swaps.api.ts:52)

// Fatigue / overtime constraint ids the solver emits (verified in
// src/modules/compliance/v8/rules/*). Used to classify SolverSignals (§3.6/§3.7).
const FATIGUE_RULE_IDS = new Set(['V8_MIN_REST_GAP', 'V8_20_IN_28', 'V8_STREAK_LIMIT']);
const OVERTIME_RULE_IDS = new Set([
  'V8_MAX_DAILY_HOURS',
  'V8_ORD_HOURS_AVG',
  'V8_SPREAD_OF_HOURS',
]);

// Abuse thresholds (02 §4 — defaults; overridable via policy.rules params).
const RATE_LIMIT_WINDOW_DAYS = 7;
const PAIRWISE_WINDOW_DAYS = 30;
const PAIRWISE_MAX_DEFAULT = 3;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WORKER_SECRET = Deno.env.get('WORKER_SECRET');
const BATCH_SIZE = Number(Deno.env.get('SWAP_WORKER_BATCH_SIZE') ?? '10') || 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Client-Info, Apikey, X-Worker-Secret',
};

// =============================================================================
// HTTP
// =============================================================================

function json(status: number, body: WorkerSummary | ErrorResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// =============================================================================
// MAIN HANDLER — Deno.serve
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, {
      error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
      code: 'CONFIG',
    });
  }

  // ── Authorize the invocation (00 §7): shared worker secret OR service role. ──
  if (!isAuthorizedInvocation(req)) {
    return json(401, { error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' });
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  // Inject the service-role client into the vendored compliance supabase binding
  // so `runSwapGuards` reads under the service role (RLS-blind, 00 D3).
  setComplianceSupabaseClient(service);

  const workerId = `swap-worker:${crypto.randomUUID()}`;
  const summary: WorkerSummary = {
    claimed: 0,
    committed: 0,
    shadow: 0,
    manual_review: 0,
    rejected: 0,
    retried: 0,
    done: 0,
    errors: 0,
  };

  try {
    // ── 2. Claim a batch (atomic, SKIP LOCKED, bumps attempts). ──────────────
    const { data: claimedData, error: claimErr } = await service.rpc('sm_swap_queue_claim', {
      p_worker: workerId,
      p_limit: BATCH_SIZE,
    });
    if (claimErr) {
      return json(500, { error: `claim failed: ${claimErr.message}`, code: 'CLAIM_FAILED' });
    }
    const claimed = (claimedData ?? []) as QueueRow[];
    summary.claimed = claimed.length;

    // ── 3. Process each claimed row, fail-closed per row. ────────────────────
    for (const row of claimed) {
      await processRow(service, row, summary);
    }

    return json(200, summary);
  } catch (e) {
    // Top-level guard — the handler never throws past here (D5).
    console.error('[auto-approve-swaps] unhandled', e);
    return json(500, { error: String(e), code: 'INTERNAL' });
  }
});

// =============================================================================
// PER-ROW PIPELINE (fail-closed: any throw ⇒ RETRY)
// =============================================================================

async function processRow(
  service: SupabaseClient,
  row: QueueRow,
  summary: WorkerSummary,
): Promise<void> {
  try {
    // ── (a) Load swap; stale (not MANAGER_PENDING) ⇒ DONE. ───────────────────
    const swap = await loadSwap(service, row.swap_id);
    if (!swap) {
      await complete(service, row.id, 'DONE', 'swap row gone');
      summary.done++;
      return;
    }
    if (swap.status !== 'MANAGER_PENDING') {
      await complete(service, row.id, 'DONE', `stale: status=${swap.status}`);
      summary.done++;
      return;
    }

    // ── (b) Resolve policy; none/disabled ⇒ DONE (RPC also guards). ──────────
    const requesterShift = await loadShift(service, swap.requester_shift_id);
    if (!requesterShift) {
      await complete(service, row.id, 'DONE', 'requester shift gone');
      summary.done++;
      return;
    }
    const offeredShift = swap.target_shift_id
      ? await loadShift(service, swap.target_shift_id)
      : null;
    const giveaway = !swap.target_shift_id;

    const policy = await resolvePolicy(
      service,
      requesterShift.organization_id,
      requesterShift.department_id,
    );
    if (!policy || !policy.enabled) {
      await complete(service, row.id, 'DONE', 'no enabled policy (short-circuit)');
      summary.done++;
      return;
    }

    // ── (c) Recompute idempotency key under the worker's fresh read. ─────────
    // sha256(swap_id : req_ver : off_ver : policy_version), off_ver=0 giveaway.
    const reqVer = requesterShift.version ?? 0;
    const offVer = giveaway ? 0 : offeredShift?.version ?? 0;
    const idemKey = await idempotencyKey(swap.id, reqVer, offVer, policy.version);

    // ── Load both parties' rosters (±30d), like validateSwapCompliance. ──────
    const refDate = requesterShift.shift_date;
    const lo = addDays(refDate, -ROSTER_WINDOW_DAYS);
    const hi = addDays(refDate, ROSTER_WINDOW_DAYS);
    const [requesterRoster, offererRoster] = await Promise.all([
      loadRoster(service, swap.requester_id, lo, hi),
      swap.target_id ? loadRoster(service, swap.target_id, lo, hi) : Promise.resolve([]),
    ]);

    // ── (d) Guards (runSwapGuards reuses the injected service client). ───────
    const guardResult: GuardResult = await runSwapGuards({
      shiftIds: [swap.requester_shift_id, swap.target_shift_id].filter(Boolean) as string[],
      employeeIds: [swap.requester_id, swap.target_id].filter(Boolean) as string[],
      currentSwapId: swap.id,
      // No snapshot here: the queue key already encodes the live versions, so a
      // drift since enqueue produced a NEW key ⇒ a fresh row; the version-CAS in
      // the gateway is the final drift guard at commit.
    });
    const guards: GuardSummary = {
      passed: guardResult.passed,
      codes: guardResult.violations.map((v) => v.code),
    };

    // ── (d) Solver (swapEvaluator.evaluate — pure, partyA/partyB shape). ─────
    const solverRaw: SolverResult = swapEvaluator.evaluate({
      partyA: {
        employee_id: swap.requester_id,
        name: 'Requester',
        current_shifts: requesterRoster.map(toRosterShift),
        shift_to_give: shiftToRosterShift(requesterShift),
      },
      partyB: {
        employee_id: swap.target_id ?? '__giveaway__',
        name: 'Offerer',
        current_shifts: offererRoster.map(toRosterShift),
        shift_to_give: offeredShift
          ? shiftToRosterShift(offeredShift)
          : shiftToRosterShift(requesterShift), // giveaway: B receives Rs, gives nothing meaningful
      },
    });
    const solver = toSolverSummary(solverRaw);
    const solverSignals = toSolverSignals(solverRaw);

    // ── (e) Eligibility engine over policy.rules. ────────────────────────────
    const eligInput = buildEligibilityInput(
      requesterShift,
      offeredShift,
      swap.requester_id,
      swap.target_id,
      requesterRoster,
      offererRoster,
      solverSignals,
    );
    const eligibility = evaluateEligibility(eligInput, policy.rules);

    // ── Abuse post-gates (§4): rate-limit + pairwise frequency. ──────────────
    const { rateLimited, launderingCycle } = await checkAbuse(
      service,
      swap,
      policy,
    );

    // ── (f) Decision via the matrix. ─────────────────────────────────────────
    const decision = decide({
      guards,
      solver,
      eligibility,
      policy: {
        auto_approve_warnings: policy.auto_approve_warnings,
        confidence_min: policy.confidence_min,
      },
      confidence: eligibility.confidence,
      rateLimited,
      launderingCycle,
    });

    // ── (g) Build payload + call sm_swap_auto_decide (RPC owns the commit). ──
    const payload: AutoDecidePayload = {
      decision: decision.decision,
      guard_result: guardResult,
      eligibility_result: eligibility,
      solver_result: redactSolver(solverRaw),
      reason: decision.reason,
      policy_version: policy.version,
      engine_version: ENGINE_VERSION,
      requester_shift_version: reqVer,
      offered_shift_version: offVer,
      confidence: decision.confidence,
    };

    const { data: decideData, error: decideErr } = await service.rpc('sm_swap_auto_decide', {
      p_swap_id: swap.id,
      p_idempotency_key: idemKey,
      p_payload: payload,
    });
    if (decideErr) {
      // RPC transport/SQL error ⇒ fail-closed RETRY (re-eval next tick).
      await complete(service, row.id, 'RETRY', `sm_swap_auto_decide error: ${decideErr.message}`);
      summary.retried++;
      return;
    }

    const result = (decideData ?? {}) as AutoDecideResult;

    // ── (h) Interpret the RPC code → queue completion + summary. ─────────────
    interpretAndComplete(service, row.id, result, decision.decision, summary);
    await pendingComplete; // flush the queued completion write
  } catch (e) {
    // D5 fail-closed: any throw (data load, guard, solver, eligibility) ⇒ RETRY
    // with the error recorded. After max_attempts the queue auto-promotes to DLQ
    // (which the RPC/queue treats as a manual-review landing — 02 §1.2).
    console.error('[auto-approve-swaps] row failed', row.swap_id, e);
    await complete(service, row.id, 'RETRY', truncate(String(e), 500));
    summary.retried++;
  }
}

// `interpretAndComplete` kicks off the completion write; we await it via this.
let pendingComplete: Promise<unknown> = Promise.resolve();

function interpretAndComplete(
  service: SupabaseClient,
  queueId: string,
  result: AutoDecideResult,
  decisionKind: string,
  summary: WorkerSummary,
): void {
  const ok = result.ok === true;
  const code = result.code;

  // Terminal-success codes → DONE (the swap was handled — committed, shadowed,
  // routed to review, disabled, no-longer-pending, replayed, or gone).
  const DONE_CODES = new Set([
    'COMMITTED',
    'SHADOW',
    'MANUAL_REVIEW',
    'DISABLED',
    'NOT_PENDING',
    'IDEMPOTENT_REPLAY',
    'GONE',
  ]);
  // Transient codes → RETRY (drift / gateway refusal / unexpected error). The
  // next claim recomputes versions ⇒ possibly a new key ⇒ a clean re-eval.
  const RETRY_CODES = new Set(['GATEWAY_REFUSED', 'VERSION_CONFLICT', 'ERROR']);

  if (ok && DONE_CODES.has(code)) {
    pendingComplete = complete(service, queueId, 'DONE', `rpc:${code}`);
    summary.done++;
    bumpDecisionCounters(code, decisionKind, summary);
    return;
  }
  if (RETRY_CODES.has(code)) {
    pendingComplete = complete(service, queueId, 'RETRY', `rpc:${code}`);
    summary.retried++;
    return;
  }
  // Unknown / not-ok code ⇒ fail-closed RETRY.
  pendingComplete = complete(service, queueId, 'RETRY', `rpc:unexpected:${code}:ok=${ok}`);
  summary.retried++;
}

function bumpDecisionCounters(
  code: string,
  decisionKind: string,
  summary: WorkerSummary,
): void {
  if (code === 'SHADOW') {
    summary.shadow++;
    return;
  }
  if (code === 'MANUAL_REVIEW') {
    summary.manual_review++;
    return;
  }
  if (code === 'COMMITTED') {
    // A committed decision is either an approve or a reject (review never commits
    // a shift change). Use the worker's own decision kind to split the counter.
    if (decisionKind === 'AUTO_REJECT') summary.rejected++;
    else summary.committed++;
  }
}

// =============================================================================
// QUEUE COMPLETE
// =============================================================================

async function complete(
  service: SupabaseClient,
  queueId: string,
  status: QueueComplete,
  error: string | null,
): Promise<void> {
  const { error: e } = await service.rpc('sm_swap_queue_complete', {
    p_id: queueId,
    p_status: status,
    p_error: error,
  });
  if (e) {
    // A failed completion is logged but not thrown: the lease will expire and the
    // row becomes reclaimable; idempotency makes a re-process safe.
    console.error('[auto-approve-swaps] queue complete failed', queueId, status, e.message);
  }
}

// =============================================================================
// DATA LOADERS (service role)
// =============================================================================

interface SwapRow {
  id: string;
  status: string;
  requester_shift_id: string;
  target_shift_id: string | null;
  requester_id: string;
  target_id: string | null;
}

interface ShiftRow {
  id: string;
  version: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number | null;
  role_id: string | null;
  organization_id: string;
  department_id: string | null;
  sub_department_id: string | null;
  required_skills: string[] | null;
  required_licenses: string[] | null;
  hourly_rate_min: number | null;
}

async function loadSwap(service: SupabaseClient, swapId: string): Promise<SwapRow | null> {
  const { data, error } = await service
    .from('shift_swaps')
    .select('id, status, requester_shift_id, target_shift_id, requester_id, target_id')
    .eq('id', swapId)
    .maybeSingle();
  if (error) throw new Error(`loadSwap: ${error.message}`);
  return (data as SwapRow) ?? null;
}

async function loadShift(service: SupabaseClient, shiftId: string): Promise<ShiftRow | null> {
  const { data, error } = await service
    .from('shifts')
    .select(
      'id, version, shift_date, start_time, end_time, unpaid_break_minutes, role_id, ' +
        'organization_id, department_id, sub_department_id, required_skills, required_licenses, ' +
        'remuneration_levels(hourly_rate_min)',
    )
    .eq('id', shiftId)
    .maybeSingle();
  if (error) throw new Error(`loadShift: ${error.message}`);
  if (!data) return null;
  // Flatten the nested remuneration relation.
  // deno-lint-ignore no-explicit-any
  const rem = (data as any).remuneration_levels;
  const hourly_rate_min = Array.isArray(rem)
    ? (rem[0]?.hourly_rate_min ?? null)
    : (rem?.hourly_rate_min ?? null);
  return { ...(data as unknown as ShiftRow), hourly_rate_min };
}

interface RosterRow {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number | null;
}

async function loadRoster(
  service: SupabaseClient,
  employeeId: string,
  lo: string,
  hi: string,
): Promise<RosterRow[]> {
  const { data, error } = await service
    .from('shifts')
    .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
    .eq('assigned_employee_id', employeeId)
    .gte('shift_date', lo)
    .lte('shift_date', hi)
    .is('deleted_at', null)
    .eq('is_cancelled', false);
  if (error) throw new Error(`loadRoster(${employeeId}): ${error.message}`);
  return (data ?? []) as RosterRow[];
}

// =============================================================================
// POLICY RESOLUTION — dept override beats org default (00/02 §5)
// =============================================================================

async function resolvePolicy(
  service: SupabaseClient,
  orgId: string,
  deptId: string | null,
): Promise<SwapPolicy | null> {
  // Fetch the org-default row AND the dept-override row (if any); pick the dept
  // override first. ORDER BY department_id NULLS LAST means a non-null (dept)
  // row sorts before the null (org-default) row.
  const { data, error } = await service
    .from('swap_approval_rules')
    .select(
      'enabled, shadow_mode, auto_approve_warnings, confidence_min, ' +
        'max_auto_per_employee_per_week, rules, version, organization_id, department_id',
    )
    .eq('organization_id', orgId)
    .or(`department_id.eq.${deptId ?? '00000000-0000-0000-0000-000000000000'},department_id.is.null`)
    .order('department_id', { ascending: true, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`resolvePolicy: ${error.message}`);
  const row = (data ?? [])[0];
  if (!row) return null;
  // deno-lint-ignore no-explicit-any
  const r = row as any;
  return {
    enabled: r.enabled ?? false,
    shadow_mode: r.shadow_mode ?? true,
    auto_approve_warnings: r.auto_approve_warnings ?? false,
    confidence_min: typeof r.confidence_min === 'number' ? r.confidence_min : 1,
    max_auto_per_employee_per_week:
      typeof r.max_auto_per_employee_per_week === 'number'
        ? r.max_auto_per_employee_per_week
        : 3,
    rules: (r.rules ?? {}) as SwapPolicy['rules'],
    version: typeof r.version === 'number' ? r.version : POLICY_VERSION_FALLBACK,
    organization_id: r.organization_id,
    department_id: r.department_id ?? null,
  };
}

// =============================================================================
// ABUSE POST-GATES (02 §4) — rate-limit + pairwise frequency. Cycle detection
// is left to the RPC/DB (WITH RECURSIVE, 02 §4.5) which has the committed graph;
// the worker contributes the rate/pairwise signals + the laundering flag if the
// RPC ever surfaces one. Here we conservatively only DOWNGRADE (never hard-
// reject) from the worker side — a hard CIRCULAR_SWAP reject is the RPC's call.
// =============================================================================

async function checkAbuse(
  service: SupabaseClient,
  swap: SwapRow,
  policy: SwapPolicy,
): Promise<{ rateLimited: boolean; launderingCycle: boolean }> {
  const parties = [swap.requester_id, swap.target_id].filter(Boolean) as string[];
  let rateLimited = false;

  // 4.1 Swap farming: committed AUTO_APPROVE count for either party in 7 days.
  try {
    const since = isoDaysAgo(RATE_LIMIT_WINDOW_DAYS);
    const { data, error } = await service
      .from('swap_decisions')
      .select('id, swap_id, decision, committed, created_at, shift_swaps!inner(requester_id, target_id)')
      .eq('decision', 'AUTO_APPROVE')
      .eq('committed', true)
      .gte('created_at', since);
    if (!error && Array.isArray(data)) {
      const counts = new Map<string, number>();
      for (const d of data) {
        // deno-lint-ignore no-explicit-any
        const ss = (d as any).shift_swaps;
        const ids = [ss?.requester_id, ss?.target_id].filter(Boolean) as string[];
        for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (const p of parties) {
        if ((counts.get(p) ?? 0) >= policy.max_auto_per_employee_per_week) {
          rateLimited = true;
          break;
        }
      }
    }
  } catch (e) {
    // Fail-closed for the brake: if we cannot verify the rate, downgrade.
    console.warn('[auto-approve-swaps] rate-limit check failed → downgrade', e);
    rateLimited = true;
  }

  // 4.2 Mutual favoritism: same unordered pair count in 30 days.
  if (!rateLimited && swap.target_id) {
    try {
      const pairwiseMax = numFromRules(policy, 'pairwise_max', PAIRWISE_MAX_DEFAULT);
      const since = isoDaysAgo(PAIRWISE_WINDOW_DAYS);
      const { data, error } = await service
        .from('swap_decisions')
        .select('id, committed, created_at, shift_swaps!inner(requester_id, target_id, created_at)')
        .eq('committed', true)
        .gte('created_at', since);
      if (!error && Array.isArray(data)) {
        const a = least(swap.requester_id, swap.target_id);
        const b = greatest(swap.requester_id, swap.target_id);
        let pairCount = 0;
        for (const d of data) {
          // deno-lint-ignore no-explicit-any
          const ss = (d as any).shift_swaps;
          if (!ss?.requester_id || !ss?.target_id) continue;
          if (least(ss.requester_id, ss.target_id) === a && greatest(ss.requester_id, ss.target_id) === b) {
            pairCount++;
          }
        }
        if (pairCount >= pairwiseMax) rateLimited = true;
      }
    } catch (e) {
      console.warn('[auto-approve-swaps] pairwise check failed → downgrade', e);
      rateLimited = true;
    }
  }

  // Cycle detection (≥3 laundering) is owned by the RPC's recursive graph query
  // (02 §4.5). The worker does not assert it here; it stays false unless a future
  // iteration surfaces it from a dedicated detector.
  return { rateLimited, launderingCycle: false };
}

// =============================================================================
// MAPPERS: DB rows → engine inputs
// =============================================================================

function paidMinutes(s: ShiftRow): number {
  const gross = minutesBetween(s.start_time, s.end_time);
  return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

function buildEligibilityInput(
  requesterShift: ShiftRow,
  offeredShift: ShiftRow | null,
  requesterId: string,
  offererId: string | null,
  requesterRoster: RosterRow[],
  offererRoster: RosterRow[],
  solver: SolverSignals,
): EligibilityInput {
  const rs: EligShift = toEligShift(requesterShift);
  const os: EligShift | null = offeredShift ? toEligShift(offeredShift) : null;

  const requester: EligParty = {
    employee_id: requesterId,
    is_active: true, // entity-active is gated by runSwapGuards; default true here
    held_certs: [], // cert sources are not loaded in this scaffold (see risks)
    roster: requesterRoster.map(toRosterEntry),
    available_for_received: null, // unknown → fail-closed in the engine
  };
  const offerer: EligParty | null = offererId
    ? {
        employee_id: offererId,
        is_active: true,
        held_certs: [],
        roster: offererRoster.map(toRosterEntry),
        available_for_received: null,
      }
    : null;

  return {
    requesterShift: rs,
    offeredShift: os,
    requester,
    offerer,
    solver,
    coverageFloor: null,
    coverageBefore: null,
  };
}

function toEligShift(s: ShiftRow): EligShift {
  return {
    id: s.id,
    role_id: s.role_id,
    department_id: s.department_id,
    sub_department_id: s.sub_department_id,
    required_certs: [...(s.required_licenses ?? []), ...(s.required_skills ?? [])],
    paid_minutes: paidMinutes(s),
    hourly_rate: s.hourly_rate_min ?? 0,
    start_at: toIso(s.shift_date, s.start_time),
    end_at: toIso(s.shift_date, s.end_time),
    shift_date: s.shift_date,
  };
}

function toRosterEntry(r: RosterRow): RosterEntry {
  return {
    id: r.id,
    start_at: toIso(r.shift_date, r.start_time),
    end_at: toIso(r.shift_date, r.end_time),
  };
}

// swapEvaluator expects RosterShift = V8Shift ({id, date, start_time(HH:mm), end_time, is_ordinary_hours, ...}).
// deno-lint-ignore no-explicit-any
function shiftToRosterShift(s: ShiftRow): any {
  return {
    id: s.id,
    date: s.shift_date,
    shift_date: s.shift_date,
    start_time: hhmm(s.start_time),
    end_time: hhmm(s.end_time),
    is_ordinary_hours: true,
    unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
    role_id: s.role_id ?? undefined,
  };
}

// deno-lint-ignore no-explicit-any
function toRosterShift(r: RosterRow): any {
  return {
    id: r.id,
    date: r.shift_date,
    shift_date: r.shift_date,
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    is_ordinary_hours: true,
    unpaid_break_minutes: r.unpaid_break_minutes ?? 0,
  };
}

function toSolverSummary(r: SolverResult): SolverSummary {
  const hasBlocking = r.violations.some((v) => v.blocking);
  const hasWarning = r.warnings.length > 0;
  const verdict: SolverSummary['verdict'] = hasBlocking
    ? 'BLOCKING'
    : hasWarning
      ? 'WARNING'
      : 'PASS';
  return {
    feasible: r.feasible,
    verdict,
    blocking: r.violations
      .filter((v) => v.blocking)
      .map((v: ConstraintViolation) => ({ employee_name: v.employee_name, summary: v.summary })),
  };
}

function toSolverSignals(r: SolverResult): SolverSignals {
  const fatigueHits = r.all_results
    .filter((v) => FATIGUE_RULE_IDS.has(v.constraint_id) && v.blocking)
    .map((v) => v.constraint_id);
  const otHits = r.warnings
    .filter((v) => OVERTIME_RULE_IDS.has(v.constraint_id))
    .map((v) => v.constraint_id);
  return {
    fatigue_blocking: fatigueHits.length > 0,
    fatigue_hits: fatigueHits,
    overtime_warning: otHits.length > 0,
    overtime_hits: otHits,
    warning_count: r.warnings.length,
  };
}

/** Keep the audit payload bounded: drop the (large) scenario echo. */
function redactSolver(r: SolverResult): Record<string, unknown> {
  return {
    feasible: r.feasible,
    violations: r.violations,
    warnings: r.warnings,
    solve_time_ms: r.solve_time_ms,
  };
}

// =============================================================================
// IDEMPOTENCY KEY — sha256_hex(`${swap}:${reqVer}:${offVer}:${polVer}`) (00 §5)
//
// MUST match the DB enqueue trigger byte-for-byte. off_ver=0 for a giveaway.
// crypto.subtle SHA-256 → lowercase hex.
// =============================================================================

async function idempotencyKey(
  swapId: string,
  reqVer: number,
  offVer: number,
  polVer: number,
): Promise<string> {
  const input = `${swapId}:${reqVer}:${offVer}:${polVer}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// AUTHZ
// =============================================================================

function isAuthorizedInvocation(req: Request): boolean {
  // (1) Shared worker secret (cron / manual kick).
  if (WORKER_SECRET) {
    const provided = req.headers.get('X-Worker-Secret');
    if (provided && timingSafeEqual(provided, WORKER_SECRET)) return true;
  }
  // (2) Service-role bearer (platform-internal invocation).
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (SERVICE_ROLE_KEY && token && timingSafeEqual(token, SERVICE_ROLE_KEY)) return true;
  return false;
}

/** Constant-time-ish string compare (avoids early-exit timing leaks). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// =============================================================================
// SMALL UTILITIES
// =============================================================================

function hhmm(t: string): string {
  if (/^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
  const d = new Date(t);
  if (!isNaN(d.getTime())) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return t;
}

function minutesBetween(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  // Overnight shift: end < start ⇒ wraps midnight.
  return e >= s ? e - s : 24 * 60 - s + e;
}

function toMinutes(t: string): number {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toIso(date: string, time: string): string {
  // UTC-anchored ISO; used only for relative overlap math (both legs same basis).
  return `${date}T${hhmm(time)}:00Z`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function least(a: string, b: string): string {
  return a <= b ? a : b;
}
function greatest(a: string, b: string): string {
  return a >= b ? a : b;
}

function numFromRules(policy: SwapPolicy, key: string, dflt: number): number {
  // deno-lint-ignore no-explicit-any
  const v = (policy.rules?.abuse?.params as any)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}
