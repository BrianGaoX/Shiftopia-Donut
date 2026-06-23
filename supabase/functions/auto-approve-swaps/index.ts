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
// COMPLIANCE STRATEGY — APPROACH A (HTTP delegation, NOT vendored TS)
// -----------------------------------------------------------------------------
// We do NOT vendor the v8 TS compliance engine. Instead we reuse the already-
// deployed `evaluate-compliance` Edge Function over HTTP — the same engine the
// app uses (overlap + weekly-hours(48h) + rest(11h) + qualification via DB RPCs,
// run RLS-blind under the service role). This keeps the worker SELF-CONTAINED
// (supabase-js + fetch + pure local TS) so it bundles under Deno like the other
// deployed functions (get-roster-view, shift-state-processor).
//
// KEY DECOMPOSITION — for a 2-WAY swap the constraints are PER-EMPLOYEE (no
// shared schedule), so the v8 `swapEvaluator` decomposes cleanly into two
// independent evaluate-compliance calls:
//   - Party A (requester) RECEIVES the offered/target shift, GIVES UP their own:
//       evaluate-compliance { employee_id: requester_id, <target shift facts>,
//         shift_id: target_shift_id, exclude_shift_id: requester_shift_id }
//   - Party B (offerer/target) RECEIVES the requester shift, GIVES UP theirs:
//       evaluate-compliance { employee_id: target_id, <requester shift facts>,
//         shift_id: requester_shift_id, exclude_shift_id: target_shift_id }
//   `exclude_shift_id` removes the shift each party gives up from the overlap /
//   weekly-hours math. For a GIVEAWAY (no target shift) only Party B is
//   evaluated (receiving the requester shift). 'violated' on either party =>
//   solver BLOCKING; 'warned' => WARNING; both 'passed' => PASS.
//
// The old runSwapGuards entity/lock/drift checks are covered downstream: the
// gateway `approve_trade` re-checks the 4h time-lock + version-CAS at commit,
// and loading the rows covers existence. We keep a small inline not-found /
// time-lock guard and DELEGATE the rest to the gateway.
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

// §9 time-lock: swaps are forbidden if a shift starts within 4 hours. The
// gateway re-checks this at commit; we also reject inline so the worker never
// produces an approve for an already-locked shift.
const TIME_LOCK_HOURS = 4;

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

    // A 2-way swap whose target shift vanished is no longer evaluable — defer to
    // the gateway/manager (DONE here, the swap stays MANAGER_PENDING for a human).
    if (!giveaway && !offeredShift) {
      await complete(service, row.id, 'DONE', 'target shift gone');
      summary.done++;
      return;
    }

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

    // ── (d) Inline guard: existence (above) + 4h time-lock. The remaining
    // entity/lock/drift checks are DELEGATED to the gateway approve_trade
    // (version-CAS + time-lock) at commit time. The version-CAS is also the
    // final drift guard: the queue key already encodes the live versions, so a
    // drift since enqueue produced a NEW key ⇒ a fresh row.
    const guardResult = computeInlineGuards(requesterShift, offeredShift);
    const guards: GuardSummary = {
      passed: guardResult.passed,
      codes: guardResult.violations.map((v) => v.code),
    };

    // ── (d) Solver via evaluate-compliance, decomposed PER PARTY. ────────────
    // Party A (requester) receives the offered shift (skip on a giveaway — they
    // receive nothing). Party B (offerer/target) receives the requester shift.
    const partyA = !giveaway && offeredShift && swap.target_id
      ? await evaluateParty(service, {
          employeeId: swap.requester_id,
          receivesShift: offeredShift, // RECEIVES the target shift
          excludeShiftId: swap.requester_shift_id, // GIVES UP their own
        })
      : null;
    const partyB = swap.target_id
      ? await evaluateParty(service, {
          employeeId: swap.target_id,
          receivesShift: requesterShift, // RECEIVES the requester shift
          excludeShiftId: giveaway ? undefined : swap.target_shift_id ?? undefined,
        })
      : null;

    const solverRaw = buildSolverResult(partyA, partyB);
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
      solver_result: solverRaw,
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
// COMPLIANCE — evaluate-compliance HTTP delegation (APPROACH A)
//
// One call PER PARTY for the shift that party RECEIVES post-swap, excluding the
// shift they give up. Mirrors the deployed contract (compliance.service.ts):
//   POST ${SUPABASE_URL}/functions/v1/evaluate-compliance
//   headers: Authorization+apikey = SERVICE_ROLE_KEY
//   body: { employee_id, shift_date, start_time, end_time, net_length_minutes,
//           exclude_shift_id?, shift_id?, override_role_id?, override_skill_ids?,
//           override_license_ids? }
//   → { status: 'passed'|'violated'|'warned'|'unavailable',
//       violations: string[], warnings: string[], ... }
// =============================================================================

type ComplianceStatus = 'passed' | 'violated' | 'warned' | 'unavailable';

interface ComplianceResult {
  status: ComplianceStatus;
  violations: string[];
  warnings: string[];
  // ...other fields (weeklyHours, qualificationViolations, …) are passed through
  // opaquely; the worker only needs status/violations/warnings.
}

/** Per-party post-swap compliance verdict, kept in the audited solver_result. */
interface PartyResult {
  employee_id: string;
  received_shift_id: string;
  excluded_shift_id: string | null;
  status: ComplianceStatus;
  violations: string[];
  warnings: string[];
}

async function evaluateParty(
  service: SupabaseClient,
  args: {
    employeeId: string;
    receivesShift: ShiftRow;
    excludeShiftId?: string;
  },
): Promise<PartyResult> {
  const s = args.receivesShift;
  const body = {
    employee_id: args.employeeId,
    shift_date: s.shift_date,
    start_time: s.start_time,
    end_time: s.end_time,
    net_length_minutes: paidMinutes(s),
    exclude_shift_id: args.excludeShiftId ?? null,
    shift_id: s.id, // drives the qualification check for the received shift
    override_role_id: null,
    override_skill_ids: null,
    override_license_ids: null,
  };

  const res = await callEvaluateCompliance(service, body);

  return {
    employee_id: args.employeeId,
    received_shift_id: s.id,
    excluded_shift_id: args.excludeShiftId ?? null,
    status: res.status,
    violations: res.violations ?? [],
    warnings: res.warnings ?? [],
  };
}

/**
 * Invoke the deployed evaluate-compliance function. Prefers the supabase-js
 * functions.invoke transport (handles base URL + auth headers) and falls back
 * to a raw fetch. A transport failure or an 'unavailable' verdict is treated as
 * fail-closed by the caller (buildSolverResult marks unavailable → BLOCKING).
 */
async function callEvaluateCompliance(
  service: SupabaseClient,
  body: Record<string, unknown>,
): Promise<ComplianceResult> {
  // Primary path: supabase-js functions.invoke (resolves URL + service-role auth).
  // deno-lint-ignore no-explicit-any
  const fns = (service as any)?.functions;
  if (fns && typeof fns.invoke === 'function') {
    const { data, error } = await fns.invoke('evaluate-compliance', { body });
    if (!error && data) return normalizeCompliance(data);
    // fall through to fetch on transport error
    console.warn('[auto-approve-swaps] functions.invoke failed, falling back to fetch', error);
  }

  // Fallback path: raw fetch with explicit service-role headers.
  const url = `${SUPABASE_URL}/functions/v1/evaluate-compliance`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    return { status: 'unavailable', violations: [], warnings: [`http ${resp.status}`] };
  }
  return normalizeCompliance(await resp.json());
}

// deno-lint-ignore no-explicit-any
function normalizeCompliance(raw: any): ComplianceResult {
  const status: ComplianceStatus = ['passed', 'violated', 'warned', 'unavailable'].includes(
    raw?.status,
  )
    ? raw.status
    : 'unavailable';
  return {
    status,
    violations: Array.isArray(raw?.violations) ? raw.violations : [],
    warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
  };
}

/**
 * Fold the per-party compliance verdicts into the SolverResult shape the
 * decision matrix + audit payload consume.
 *
 * - any party 'violated' OR 'unavailable' (fail-closed) ⇒ feasible=false,
 *   verdict BLOCKING.
 * - any party 'warned' (and none violated) ⇒ feasible=true, verdict WARNING.
 * - both 'passed' ⇒ feasible=true, verdict PASS.
 */
function buildSolverResult(
  partyA: PartyResult | null,
  partyB: PartyResult | null,
): SolverResultLite {
  const parties = [partyA, partyB].filter(Boolean) as PartyResult[];

  const anyViolated = parties.some(
    (p) => p.status === 'violated' || p.status === 'unavailable',
  );
  const anyWarned = parties.some((p) => p.status === 'warned');

  const violations = parties
    .filter((p) => p.status === 'violated' || p.status === 'unavailable')
    .map((p) => ({
      employee_id: p.employee_id,
      status: p.status,
      messages: p.status === 'unavailable'
        ? ['compliance engine unavailable (fail-closed)']
        : p.violations,
    }));

  const warnings = parties
    .filter((p) => p.status === 'warned')
    .map((p) => ({ employee_id: p.employee_id, messages: p.warnings }));

  return {
    feasible: !anyViolated,
    verdict: anyViolated ? 'BLOCKING' : anyWarned ? 'WARNING' : 'PASS',
    partyA,
    partyB,
    violations,
    warnings,
  };
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

// Abuse thresholds (02 §4 — defaults; overridable via policy.rules params).
const RATE_LIMIT_WINDOW_DAYS = 7;
const PAIRWISE_WINDOW_DAYS = 30;
const PAIRWISE_MAX_DEFAULT = 3;

// =============================================================================
// INLINE GUARDS — existence (loaders) + 4h time-lock. The rest of the v8
// runSwapGuards surface (entity validity, concurrency, drift) is DELEGATED to
// the gateway approve_trade (version-CAS + time-lock) at commit time.
// =============================================================================

interface InlineGuardResult {
  passed: boolean;
  violations: { code: string; message: string }[];
  delegated_to_gateway: string[];
}

function computeInlineGuards(
  requesterShift: ShiftRow,
  offeredShift: ShiftRow | null,
): InlineGuardResult {
  const violations: { code: string; message: string }[] = [];

  // 4h time-lock on either leg (the gateway re-checks; we reject early so the
  // worker never proposes an approve for a locked shift).
  for (const s of [requesterShift, offeredShift].filter(Boolean) as ShiftRow[]) {
    if (isTimeLocked(s.shift_date, s.start_time)) {
      violations.push({
        code: 'TIME_LOCKED',
        message: `shift ${s.id} starts within ${TIME_LOCK_HOURS}h (or has started)`,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    delegated_to_gateway: ['entity_validity', 'version_cas_drift', 'lock_recheck'],
  };
}

/** True when the shift starts within the 4h lock window or has already started. */
function isTimeLocked(shiftDate: string, startTime: string): boolean {
  const startMs = Date.parse(`${shiftDate}T${hhmm(startTime)}:00Z`);
  if (Number.isNaN(startMs)) return false; // unparseable ⇒ don't block on the lock here
  const hoursUntil = (startMs - Date.now()) / 3_600_000;
  return hoursUntil < TIME_LOCK_HOURS;
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
    is_active: true, // entity-active is gated by the gateway; default true here
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

// =============================================================================
// SOLVER RESULT SHAPE (local — no vendored v8 types)
// =============================================================================

interface SolverResultLite {
  feasible: boolean;
  verdict: 'PASS' | 'WARNING' | 'BLOCKING';
  partyA: PartyResult | null;
  partyB: PartyResult | null;
  violations: { employee_id: string; status: ComplianceStatus; messages: string[] }[];
  warnings: { employee_id: string; messages: string[] }[];
}

function toSolverSummary(r: SolverResultLite): SolverSummary {
  return {
    feasible: r.feasible,
    verdict: r.verdict,
    blocking: r.violations.map((v) => ({
      employee_name: v.employee_id,
      summary: v.messages.join('; ') || v.status,
    })),
  };
}

function toSolverSignals(r: SolverResultLite): SolverSignals {
  // evaluate-compliance does not split fatigue vs overtime by constraint id; it
  // returns coarse violations/warnings. Map: a per-party BLOCKING verdict feeds
  // the always-on fatigue gate as a blocking signal (belt-and-braces — overlap
  // is also re-checked in the eligibility engine), and any warning feeds the
  // overtime/warning signals + the confidence penalty.
  const fatigueBlocking = r.verdict === 'BLOCKING';
  const warningCount = r.warnings.reduce((n, w) => n + (w.messages.length || 1), 0);
  const overtimeWarning = warningCount > 0;
  return {
    fatigue_blocking: fatigueBlocking,
    fatigue_hits: fatigueBlocking
      ? r.violations.flatMap((v) => v.messages.length ? v.messages : [v.status])
      : [],
    overtime_warning: overtimeWarning,
    overtime_hits: r.warnings.flatMap((w) => w.messages),
    warning_count: warningCount,
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
