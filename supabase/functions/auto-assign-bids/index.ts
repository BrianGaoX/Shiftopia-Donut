// =============================================================================
// auto-assign-bids — Supabase Edge Function (Deno, service role)  [APPROACH A]
//
// Drains open-for-bidding shifts in a manager-supplied scope and commits a winner
// for each through the existing sm_select_bid_winner / sm_apply_shift_op gateway
// with version-CAS. Implements docs/implementation/01-auto-assign-bids-refactor.md
// §2 (orchestration) + §8 (API), bound by 00-contracts-and-conventions.md
// (D1–D5, §5–§7).
//
// -----------------------------------------------------------------------------
// DECISION MODEL — APPROACH A (per-shift first-clear-bidder)
// -----------------------------------------------------------------------------
// This worker does NOT host the vendored v8 compliance engine. Instead it calls
// the already-deployed `evaluate-compliance` Edge Function over HTTP, once per
// (shift, bidder), mirroring the hardened CLIENT path (OpenBidsView handleAutoAssign):
//
//   for each open shift in scope (chronological):
//     fetch its pending bids (FIFO; F3 fairness-debt owed bidders first)
//     for each bidder (in that order):
//       POST evaluate-compliance { employee_id=bidder, + the SHIFT's date/start/
//         end/net_length_minutes + shift_id (for the qualification check) }
//       first bidder whose status !== 'violated' WINS
//       ('warned' counts as eligible unless options.reject_warnings)
//     commit that winner via the gateway (version-CAS, bounded retry)
//
// TRADEOFF (documented approach-A cost): the result is necessarily per-shift,
// first-clear-bidder. We do NOT do the v8 engine's GLOBAL optimization (scoring
// across all shifts/bidders to maximise total coverage). That is the accepted
// v1 cost of making this worker self-contained — see ./README.md.
//
// -----------------------------------------------------------------------------
// SELF-CONTAINMENT / IMPORTS
// -----------------------------------------------------------------------------
// This function imports ONLY: jsr:@supabase/supabase-js, Deno built-ins, and
// ./types.ts. No @compliance, no _vendor engine, no import-map aliasing beyond
// the supabase-js pin. It bundles under Deno like evaluate-compliance /
// autoschedule-* (supabase-js + fetch + pure local TS).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  AssignmentOptions,
  AssignmentOutcome,
  AssignmentScope,
  DryRunResponse,
  ErrorResponse,
  GetRunResponse,
  PreviewDecision,
  RollbackResponse,
  RunStatus,
  RunSummary,
  StartRunRequest,
  StartRunResponse,
} from './types.ts';

// =============================================================================
// CONSTANTS
// =============================================================================

const ENGINE_VERSION = 'auto-assign@1.0.0'; // stamped on every decision (00 §8)
const POLICY_VERSION = 1;

const MAX_CAS_ATTEMPTS = 3; // 01 §5.3
const CAS_BASE_BACKOFF_MS = 50; // 50 / 100 / 200 ms + jitter

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

// Deterministic namespace for the gateway's UUIDv5 idempotency key (00 §5).
// Fixed constant so the same (run_id, shift_id) always derives the same UUID
// across re-invocations of a resumed run.
const ASSIGN_IDEM_NS = '6b2f0e2a-3d4c-5a6b-8c9d-0e1f2a3b4c5d';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

// The deployed compliance engine we delegate to (per-bidder, over HTTP).
const COMPLIANCE_FN_URL = `${SUPABASE_URL ?? ''}/functions/v1/evaluate-compliance`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Client-Info, Apikey',
};

// Manager cert levels that authorize an org/dept-scoped run (00 §8, project memory).
const MANAGER_CERT_LEVELS = ['gamma', 'delta', 'epsilon', 'zeta'];

// =============================================================================
// HTTP HELPERS
// =============================================================================

function json(
  status: number,
  body:
    | StartRunResponse
    | DryRunResponse
    | GetRunResponse
    | RollbackResponse
    | ErrorResponse,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// =============================================================================
// SNAPSHOT TYPES (internal — never crosses the wire)
// =============================================================================

interface ShiftRow {
  id: string;
  version: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  scheduled_start: string | null;
  role_id: string | null;
  required_skills: string[] | null;
  required_licenses: string[] | null;
  unpaid_break_minutes: number | null;
  organization_id: string;
  department_id: string | null;
  sub_department_id: string | null;
}

interface BidRow {
  id: string;
  shift_id: string;
  employee_id: string;
  created_at: string;
  priority_score: number | null;
}

interface Snapshot {
  shifts: ShiftRow[];
  shiftById: Map<string, ShiftRow>;
  /** Pending bids per shift_id, already ordered (F3 debt desc, then FIFO). */
  bidsByShift: Map<string, BidRow[]>;
  names: Map<string, string>;
  debts: Map<string, number>; // employee_id → denied_preferences debt
  f3Degraded: boolean;
}

// =============================================================================
// COMPLIANCE (deployed evaluate-compliance) — wire shapes
// =============================================================================

/** Request body for the deployed evaluate-compliance function. */
interface ComplianceRequest {
  employee_id: string;
  shift_date: string;
  start_time: string; // 'HH:mm:ss'
  end_time: string; // 'HH:mm:ss'
  net_length_minutes: number; // gross − unpaid break (paid minutes)
  shift_id?: string | null; // enables the qualification check
  exclude_shift_id?: string | null; // unused here (bidder not yet on this shift)
  override_role_id?: string | null;
  override_skill_ids?: string[] | null;
  override_license_ids?: string[] | null;
}

/** Response from the deployed evaluate-compliance function. */
interface ComplianceResult {
  status: 'passed' | 'violated' | 'warned' | 'unavailable';
  violations: string[];
  warnings: string[];
  weeklyHours: number;
  maxWeeklyHours: number;
  checksPerformed: string[];
  checksSkipped: string[];
  qualificationViolations: unknown[];
}

// =============================================================================
// MAIN HANDLER — routing (00 §7)
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, {
      error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
      code: 'CONFIG',
    });
  }

  // Path within the function: supabase strips the `/functions/v1/auto-assign-bids`
  // mount, so we route on the remaining suffix.
  const url = new URL(req.url);
  const path = stripFunctionPrefix(url.pathname); // '' | '/run/:id' | '/run/:id/rollback'

  try {
    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── Authn: resolve the caller from their JWT (forwarded Authorization). ──
    const authedUser = await resolveCaller(req);
    if (!authedUser) {
      return json(401, { error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED' });
    }

    // GET /run/:id
    const getMatch = path.match(/^\/run\/([0-9a-fA-F-]{36})$/);
    if (req.method === 'GET' && getMatch) {
      return await handleGetRun(service, authedUser.id, getMatch[1]);
    }

    // POST /run/:id/rollback
    const rbMatch = path.match(/^\/run\/([0-9a-fA-F-]{36})\/rollback$/);
    if (req.method === 'POST' && rbMatch) {
      return await handleRollback(service, authedUser.id, rbMatch[1]);
    }

    // POST /  (start a run)
    if (req.method === 'POST' && (path === '' || path === '/')) {
      const body = (await req.json().catch(() => null)) as StartRunRequest | null;
      if (!body?.scope?.organization_id) {
        return json(400, {
          error: 'scope.organization_id is required',
          code: 'BAD_REQUEST',
        });
      }
      return await handleStartRun(service, authedUser.id, body);
    }

    return json(404, { error: `No route for ${req.method} ${path}`, code: 'NOT_FOUND' });
  } catch (e) {
    // Top-level guard: the handler NEVER throws past here (D5 fail-closed).
    console.error('[auto-assign-bids] unhandled', e);
    return json(500, { error: String(e), code: 'INTERNAL' });
  }
});

// =============================================================================
// ROUTE: POST /  — start (or dry-run) a run
// =============================================================================

async function handleStartRun(
  service: SupabaseClient,
  actorId: string,
  body: StartRunRequest,
): Promise<Response> {
  const scope = body.scope;
  const dryRun = body.dry_run ?? false;
  const options: AssignmentOptions = body.options ?? {};

  // ── Authz: caller must hold an active manager cert for the requested scope. ──
  const authorized = await isManagerForScope(service, actorId, scope);
  if (!authorized) {
    return json(403, { error: 'FORBIDDEN', code: 'FORBIDDEN' });
  }

  // ── Open the run (PENDING → RUNNING). Failure here is terminal (no run row). ──
  const { data: run, error: startErr } = await service.rpc('sm_assignment_run_start', {
    p_scope: scope,
    p_engine_version: ENGINE_VERSION,
    p_policy_version: POLICY_VERSION,
    p_options: options,
    p_dry_run: dryRun,
  });
  if (startErr || !run) {
    return json(500, {
      error: `run_start failed: ${startErr?.message ?? 'no run id'}`,
      code: 'RUN_START_FAILED',
    });
  }
  const runId: string = (run as { run_id?: string }).run_id ?? (run as string);

  try {
    // ── (C) ONE consistent snapshot under service role (RLS-blind). 01 §2.3. ──
    const snap = await loadSnapshot(service, scope);

    // ── Process shifts chronologically (resumable cursor advances per shift). ──
    // Sorting by date keeps streak/window-style rules accumulating in order, and
    // committing in shift_id order would re-shuffle that; we commit per shift as
    // we decide it, in date order. (Single-writer per run ⇒ no cross-shift lock
    // ordering concern within this loop.)
    const orderedShifts = [...snap.shifts].sort((a, b) => {
      const d = a.shift_date.localeCompare(b.shift_date);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

    // ── (F) DRY RUN: per-shift first-clear-bidder, persist preview, no gateway. ──
    if (dryRun) {
      const preview: PreviewDecision[] = [];
      for (const shift of orderedShifts) {
        preview.push(await decideShift(shift, snap, options));
      }
      const summary = summarizePreview(preview);
      await persistDryRunDecisions(service, runId, preview);
      await finishRun(service, runId, 'COMPLETED', summary);
      const resp: DryRunResponse = {
        run_id: runId,
        status: 'COMPLETED',
        dry_run: true,
        preview,
        summary,
      };
      return json(200, resp);
    }

    // ── (G) COMMIT path: decide each shift, then commit its winner (if any). ──
    const summary = emptySummary();
    for (const shift of orderedShifts) {
      const decision = await decideShift(shift, snap, options);

      if (decision.outcome !== 'ASSIGNED' || !decision.winner) {
        // No clear bidder — record SKIPPED_* (engine-side; no gateway call).
        await recordDecision(service, runId, shift.id, decision.outcome, {
          reason: decision.reason,
          runnersUp: decision.runners_up ?? [],
          versionBefore: shift.version,
        });
        bumpSummary(summary, decision.outcome);
        await advanceCursor(service, runId, shift.id);
        continue;
      }

      const outcome = await commitWinnerWithRetry(service, {
        runId,
        shift,
        winnerId: decision.winner.employee_id,
        reason: decision.reason,
        runnersUp: decision.runners_up ?? [],
      });
      bumpSummary(summary, outcome);
      // Advance the resumable cursor (01 §2.5) after each committed decision.
      await advanceCursor(service, runId, shift.id);
    }

    const status: RunStatus =
      summary.error || summary.conflict ? 'PARTIALLY_FAILED' : 'COMPLETED';
    await finishRun(service, runId, status, summary);

    const resp: StartRunResponse = { run_id: runId, status, summary };
    return json(202, resp);
  } catch (e) {
    // D5 fail-closed: record + abort; never leave a run RUNNING.
    console.error('[auto-assign-bids] run aborted', runId, e);
    await abortRun(service, runId, String(e));
    return json(500, {
      run_id: runId,
      status: 'ABORTED',
      error: String(e),
      code: 'ABORTED',
    });
  }
}

// =============================================================================
// DECIDE — per-shift first-clear-bidder via evaluate-compliance (APPROACH A)
// =============================================================================

async function decideShift(
  shift: ShiftRow,
  snap: Snapshot,
  options: AssignmentOptions,
): Promise<PreviewDecision> {
  const bids = snap.bidsByShift.get(shift.id) ?? [];
  if (bids.length === 0) {
    return {
      shift_id: shift.id,
      outcome: 'SKIPPED_NO_ELIGIBLE',
      winner: null,
      reason: 'No pending bids for this shift.',
    };
  }

  // Per-bid compliance payload constants for this shift (identical per bidder).
  const startHHmmss = hhmmss(shift.start_time);
  const endHHmmss = hhmmss(shift.end_time);
  const netMinutes = paidMinutes(shift);

  const runnersUp: PreviewDecision['runners_up'] = [];
  const rejectWarnings = options.reject_warnings ?? false;

  for (const bid of bids) {
    const compliance = await evaluateCompliance({
      employee_id: bid.employee_id,
      shift_date: shift.shift_date,
      start_time: startHHmmss,
      end_time: endHHmmss,
      net_length_minutes: netMinutes,
      shift_id: shift.id, // R4/R5: enables the qualification check
      override_role_id: shift.role_id,
      override_skill_ids: shift.required_skills,
      override_license_ids: shift.required_licenses,
    });

    // 'violated' = blocking ⇒ this bidder is out. 'warned' is eligible unless the
    // run explicitly rejects warnings. 'passed' is clear. 'unavailable' means the
    // checks could not run ⇒ fail-closed (treat as not eligible).
    const blocked =
      compliance.status === 'violated' ||
      compliance.status === 'unavailable' ||
      (compliance.status === 'warned' && rejectWarnings);

    if (!blocked) {
      return {
        shift_id: shift.id,
        outcome: 'ASSIGNED',
        winner: {
          employee_id: bid.employee_id,
          name: snap.names.get(bid.employee_id) ?? null,
          composite_score: complianceScore(compliance.status),
        },
        runners_up: runnersUp,
        reason:
          compliance.status === 'warned'
            ? 'First compliance-eligible bidder (with warnings) in FIFO/F3 order.'
            : 'First compliance-clear bidder in FIFO/F3 order.',
        f3_debt: snap.debts.get(bid.employee_id) ?? 0,
      };
    }

    // Record the rejected bidder as a runner-up (audit surface).
    runnersUp.push({
      employee_id: bid.employee_id,
      composite_score: complianceScore(compliance.status),
      compliance_status: compliance.status === 'warned' ? 'WARNING' : 'BLOCKING',
    });
  }

  // Every bidder was blocked by compliance.
  return {
    shift_id: shift.id,
    outcome: 'SKIPPED_BLOCKED',
    winner: null,
    runners_up: runnersUp,
    reason: 'All bids blocked by compliance (evaluate-compliance).',
  };
}

/**
 * Call the deployed evaluate-compliance Edge Function over HTTP under the service
 * role. A transport/HTTP failure is mapped to 'unavailable' (fail-closed: the
 * bidder is treated as not eligible rather than silently passed).
 */
async function evaluateCompliance(body: ComplianceRequest): Promise<ComplianceResult> {
  try {
    const res = await fetch(COMPLIANCE_FN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return unavailableResult(`evaluate-compliance HTTP ${res.status}`);
    }
    return (await res.json()) as ComplianceResult;
  } catch (e) {
    return unavailableResult(`evaluate-compliance fetch failed: ${String(e)}`);
  }
}

function unavailableResult(reason: string): ComplianceResult {
  return {
    status: 'unavailable',
    violations: [],
    warnings: [reason],
    weeklyHours: 0,
    maxWeeklyHours: 48,
    checksPerformed: [],
    checksSkipped: ['overlap', 'weekly_hours', 'rest_period', 'qualification'],
    qualificationViolations: [],
  };
}

/** Map a compliance status to a bounded 0..100 band for the preview/audit surface. */
function complianceScore(status: ComplianceResult['status']): number {
  switch (status) {
    case 'passed':
      return 100;
    case 'warned':
      return 50;
    default:
      return 0; // violated / unavailable
  }
}

// =============================================================================
// COMMIT — per-shift gateway call with bounded version-CAS retry (01 §2.4, §5.3)
// =============================================================================

interface GatewayResult {
  ok: boolean;
  code?: string;
  note?: string;
  version?: number;
  state?: string;
  current_version?: number;
  current_state?: string;
}

async function commitWinnerWithRetry(
  service: SupabaseClient,
  args: {
    runId: string;
    shift: ShiftRow;
    winnerId: string;
    reason: string;
    runnersUp: NonNullable<PreviewDecision['runners_up']>;
  },
): Promise<AssignmentOutcome> {
  const { runId, shift, winnerId, runnersUp } = args;
  let expectedVersion = shift.version;

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const idemUuid = await uuidV5(`${runId}:${shift.id}`, ASSIGN_IDEM_NS);

    const { data, error } = await service.rpc('sm_apply_shift_op', {
      p_shift_id: shift.id,
      p_expected_version: expectedVersion,
      p_op: 'select_winner',
      p_payload: { winner_id: winnerId },
      p_idempotency_key: idemUuid,
    });

    if (error) {
      // Transport/SQL error from the RPC itself — fail closed for this shift.
      return await recordDecision(service, runId, shift.id, 'ERROR', {
        winnerId,
        runnersUp,
        reason: `Gateway RPC error: ${error.message}`,
        versionBefore: expectedVersion,
      });
    }

    const r = (data ?? {}) as GatewayResult;

    // Applied or idempotent replay ⇒ ASSIGNED.
    if (r.ok && (r.code === 'APPLIED' || r.code === 'IDEMPOTENT_REPLAY')) {
      return await recordDecision(service, runId, shift.id, 'ASSIGNED', {
        winnerId,
        runnersUp,
        reason: args.reason,
        versionBefore: expectedVersion,
        versionAfter: r.version ?? null,
        idem: idemUuid,
      });
    }

    // Server-side P0 guards (01 §3.2/§3.3) surface as WRITE_REJECTED notes.
    if (r.code === 'WRITE_REJECTED' && r.note === 'WINNER_NOT_PENDING') {
      return await recordDecision(service, runId, shift.id, 'SKIPPED_NO_ELIGIBLE', {
        winnerId,
        runnersUp,
        reason: 'Winning bid is no longer pending (withdrawn/rejected since snapshot).',
        versionBefore: expectedVersion,
      });
    }
    if (r.code === 'WRITE_REJECTED' && r.note === 'SHIFT_TIME_LOCKED') {
      return await recordDecision(service, runId, shift.id, 'SKIPPED_LOCKED', {
        winnerId,
        runnersUp,
        reason: 'Shift is inside the 4h time-lock; use emergency assignment.',
        versionBefore: expectedVersion,
      });
    }
    if (r.code === 'ILLEGAL_TRANSITION' || r.code === 'GONE') {
      return await recordDecision(service, runId, shift.id, 'SKIPPED_BLOCKED', {
        winnerId,
        runnersUp,
        reason: `Shift no longer assignable (${r.code}).`,
        versionBefore: expectedVersion,
      });
    }

    // CAS conflict ⇒ re-read from the envelope, re-decide, bounded retry.
    if (r.code === 'VERSION_CONFLICT') {
      const currentState = r.current_state ?? '';
      if (!isStillOpenForBidding(currentState)) {
        // Filled / cancelled / edited by another writer → do not retry.
        return await recordDecision(service, runId, shift.id, 'SKIPPED_BLOCKED', {
          winnerId,
          runnersUp,
          reason: `Filled by another writer (state ${currentState}).`,
          versionBefore: expectedVersion,
        });
      }
      expectedVersion = r.current_version ?? expectedVersion;
      await sleep(backoff(attempt));
      continue;
    }

    // Anything else ⇒ fail closed, record, do not throw.
    return await recordDecision(service, runId, shift.id, 'ERROR', {
      winnerId,
      runnersUp,
      reason: `Unexpected gateway code: ${r.code ?? 'UNKNOWN'}.`,
      versionBefore: expectedVersion,
    });
  }

  // Retries exhausted.
  return await recordDecision(service, runId, args.shift.id, 'CONFLICT_RETRY', {
    winnerId,
    runnersUp,
    reason: `Version conflict unresolved after ${MAX_CAS_ATTEMPTS} attempts.`,
  });
}

/** select_winner is legal only at S5/S6 (open-for-bidding, unassigned). */
function isStillOpenForBidding(state: string): boolean {
  return state === 'S5' || state === 'S6';
}

// =============================================================================
// ROUTE: GET /run/:id  (01 §8.2)
// =============================================================================

async function handleGetRun(
  service: SupabaseClient,
  actorId: string,
  runId: string,
): Promise<Response> {
  const { data: run, error: runErr } = await service
    .from('assignment_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (runErr) return json(500, { error: runErr.message, code: 'INTERNAL' });
  if (!run) return json(404, { error: 'run not found', code: 'NOT_FOUND' });

  if (!(await isManagerForScope(service, actorId, run.scope as AssignmentScope))) {
    return json(403, { error: 'FORBIDDEN', code: 'FORBIDDEN' });
  }

  const { data: decisions, error: decErr } = await service
    .from('assignment_decisions')
    .select(
      'shift_id, outcome, winner_employee_id, composite_score, runners_up, reason, rule_hits, version_before, version_after',
    )
    .eq('run_id', runId)
    .order('shift_id', { ascending: true });

  if (decErr) return json(500, { error: decErr.message, code: 'INTERNAL' });

  const resp: GetRunResponse = {
    run: run as GetRunResponse['run'],
    decisions: (decisions ?? []) as GetRunResponse['decisions'],
  };
  return json(200, resp);
}

// =============================================================================
// ROUTE: POST /run/:id/rollback  (01 §8.3, §9)
// =============================================================================

async function handleRollback(
  service: SupabaseClient,
  actorId: string,
  runId: string,
): Promise<Response> {
  const { data: run, error: runErr } = await service
    .from('assignment_runs')
    .select('id, scope, status')
    .eq('id', runId)
    .maybeSingle();

  if (runErr) return json(500, { error: runErr.message, code: 'INTERNAL' });
  if (!run) return json(404, { error: 'run not found', code: 'NOT_FOUND' });

  if (!(await isManagerForScope(service, actorId, run.scope as AssignmentScope))) {
    return json(403, { error: 'FORBIDDEN', code: 'FORBIDDEN' });
  }

  // NOTE: the DEPLOYED sm_assignment_run_rollback is single-arg (p_run_id only);
  // it derives the actor from auth.uid() internally. Called here via the service
  // client, auth.uid() is NULL so the RPC treats it as a system rollback and skips
  // its own cert check — which is fine because isManagerForScope() above already
  // authorized this manager. Rollback audit events are therefore actor=system; a
  // future iteration can add an explicit p_actor param to the RPC to attribute them.
  const { data, error } = await service.rpc('sm_assignment_run_rollback', {
    p_run_id: runId,
  });
  if (error) {
    return json(500, {
      run_id: runId,
      error: `rollback failed: ${error.message}`,
      code: 'ROLLBACK_FAILED',
    });
  }

  const result = (data ?? {}) as {
    reverted?: RollbackResponse['reverted'];
    skipped?: RollbackResponse['skipped'];
  };
  const resp: RollbackResponse = {
    run_id: runId,
    status: 'ROLLED_BACK',
    reverted: result.reverted ?? [],
    skipped: result.skipped ?? [],
  };
  return json(200, resp);
}

// =============================================================================
// SNAPSHOT — 01 §2.3  (service role: full schedules, RLS-blind)
//
// APPROACH A: the snapshot now only needs the open shifts, their pending bids
// (ordered FIFO with the F3 fairness-debt boost), and the bidders' display
// names. Per-bidder compliance is delegated to evaluate-compliance at decision
// time (it reads the bidder's full schedule itself, under its own service role),
// so we no longer hydrate V8 employee contexts or existing-shift windows here.
// =============================================================================

const ACTIVE_BIDDING = ['on_bidding', 'on_bidding_normal', 'on_bidding_urgent'];

async function loadSnapshot(
  service: SupabaseClient,
  scope: AssignmentScope,
): Promise<Snapshot> {
  // (1) Open-for-bidding shifts in scope.
  let q = service
    .from('shifts')
    .select(
      'id, version, shift_date, start_time, end_time, scheduled_start, role_id, required_skills, required_licenses, unpaid_break_minutes, organization_id, department_id, sub_department_id',
    )
    .eq('organization_id', scope.organization_id)
    .eq('assignment_status', 'unassigned')
    .eq('is_cancelled', false)
    .is('deleted_at', null)
    .in('bidding_status', ACTIVE_BIDDING);

  if (scope.department_id) q = q.eq('department_id', scope.department_id);
  if (scope.sub_department_id) q = q.eq('sub_department_id', scope.sub_department_id);
  if (scope.start_date) q = q.gte('shift_date', scope.start_date);
  if (scope.end_date) q = q.lte('shift_date', scope.end_date);

  const { data: shiftData, error: shiftErr } = await q;
  if (shiftErr) throw new Error(`snapshot.shifts: ${shiftErr.message}`);
  const shifts = (shiftData ?? []) as ShiftRow[];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  if (shifts.length === 0) {
    return {
      shifts,
      shiftById,
      bidsByShift: new Map(),
      names: new Map(),
      debts: new Map(),
      f3Degraded: false,
    };
  }

  const shiftIds = shifts.map((s) => s.id);

  // (2) Pending bids on those shifts (FCFS recency baseline).
  const { data: bidData, error: bidErr } = await service
    .from('shift_bids')
    .select('id, shift_id, employee_id, created_at, priority_score')
    .in('shift_id', shiftIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (bidErr) throw new Error(`snapshot.bids: ${bidErr.message}`);
  const bids = (bidData ?? []) as BidRow[];

  const bidderIds = [...new Set(bids.map((b) => b.employee_id))];
  if (bidderIds.length === 0) {
    return {
      shifts,
      shiftById,
      bidsByShift: new Map(),
      names: new Map(),
      debts: new Map(),
      f3Degraded: false,
    };
  }

  // (3) Display names for the bidders (preview/audit surface only).
  const names = new Map<string, string>();
  const { data: profiles } = await service
    .from('profiles')
    .select('id, full_name')
    .in('id', bidderIds);
  for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (p.full_name) names.set(p.id, p.full_name);
  }

  // (4) Fairness debts (F3 — denied_preferences). Explicit degradation on error.
  const { debts, f3Degraded } = await loadFairnessDebts(
    service,
    scope.organization_id,
    bidderIds,
  );

  // (5) Bucket bids per shift, then order each bucket: highest denied-preference
  //     debt first (F3), stable within equal debt so plain FIFO (created_at ASC)
  //     is preserved. Mirrors the client handleAutoAssign ordering.
  const bidsByShift = new Map<string, BidRow[]>();
  for (const b of bids) {
    const arr = bidsByShift.get(b.shift_id) ?? [];
    arr.push(b);
    bidsByShift.set(b.shift_id, arr);
  }
  if (debts.size > 0) {
    for (const [shiftId, arr] of bidsByShift) {
      // Stable sort: bids already arrive in created_at ASC (FIFO); a stable sort
      // by debt desc keeps FIFO as the tiebreak within equal debt.
      const ordered = stableSort(
        arr,
        (a, b) => (debts.get(b.employee_id) ?? 0) - (debts.get(a.employee_id) ?? 0),
      );
      bidsByShift.set(shiftId, ordered);
    }
  }

  return { shifts, shiftById, bidsByShift, names, debts, f3Degraded };
}

/** F3 debts. Returns {} + f3Degraded=true on any error (explicit, not silent). */
async function loadFairnessDebts(
  service: SupabaseClient,
  orgId: string,
  empIds: string[],
): Promise<{ debts: Map<string, number>; f3Degraded: boolean }> {
  try {
    const { data, error } = await service
      .from('fairness_ledger')
      .select('employee_id, debt')
      .eq('organization_id', orgId)
      .eq('metric', 'denied_preferences')
      .in('employee_id', empIds);
    if (error) return { debts: new Map(), f3Degraded: true };
    const debts = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ employee_id: string; debt: number }>) {
      debts.set(r.employee_id, Number(r.debt) || 0);
    }
    return { debts, f3Degraded: false };
  } catch {
    return { debts: new Map(), f3Degraded: true };
  }
}

// =============================================================================
// DECISIONS / EVENTS / RUN LIFECYCLE writes
// =============================================================================

interface DecisionMeta {
  winnerId?: string;
  runnersUp?: NonNullable<PreviewDecision['runners_up']>;
  reason: string;
  versionBefore?: number | null;
  versionAfter?: number | null;
  idem?: string;
}

async function recordDecision(
  service: SupabaseClient,
  runId: string,
  shiftId: string,
  outcome: AssignmentOutcome,
  meta: DecisionMeta,
): Promise<AssignmentOutcome> {
  const winner = outcome === 'ASSIGNED' ? meta.winnerId ?? null : null;
  const score = outcome === 'ASSIGNED' ? 100 : null;

  await service.from('assignment_decisions').upsert(
    {
      run_id: runId,
      shift_id: shiftId,
      winner_employee_id: winner,
      runners_up: meta.runnersUp ?? [],
      reason: meta.reason,
      rule_hits: [],
      composite_score: score,
      outcome,
      engine_version: ENGINE_VERSION,
      policy_version: POLICY_VERSION,
      version_before: meta.versionBefore ?? null,
      version_after: meta.versionAfter ?? null,
      idempotency_key: `${runId}:${shiftId}`,
    },
    { onConflict: 'run_id,shift_id', ignoreDuplicates: true },
  );

  await service.from('assignment_events').insert({
    run_id: runId,
    shift_id: shiftId,
    event_type:
      outcome === 'ASSIGNED'
        ? 'SHIFT_ASSIGNED'
        : outcome === 'CONFLICT_RETRY'
          ? 'SHIFT_CONFLICT'
          : 'SHIFT_SKIPPED',
    metadata: { outcome, idem: meta.idem ?? null, reason: meta.reason },
  });

  return outcome;
}

async function persistDryRunDecisions(
  service: SupabaseClient,
  runId: string,
  preview: PreviewDecision[],
): Promise<void> {
  const rows = preview.map((p) => ({
    run_id: runId,
    shift_id: p.shift_id,
    winner_employee_id: p.winner?.employee_id ?? null,
    runners_up: p.runners_up ?? [],
    reason: p.reason,
    rule_hits: p.rule_hits ?? [],
    composite_score: p.winner?.composite_score ?? null,
    outcome: p.outcome,
    engine_version: ENGINE_VERSION,
    policy_version: POLICY_VERSION,
    version_before: null,
    version_after: null, // dry run never touches shifts
    idempotency_key: `${runId}:${p.shift_id}`,
  }));
  if (rows.length === 0) return;
  await service
    .from('assignment_decisions')
    .upsert(rows, { onConflict: 'run_id,shift_id', ignoreDuplicates: true });
}

async function finishRun(
  service: SupabaseClient,
  runId: string,
  status: RunStatus,
  summary: RunSummary,
): Promise<void> {
  await service.rpc('sm_assignment_run_finish', {
    p_run_id: runId,
    p_status: status,
    p_summary: summary,
    p_error: null,
  });
}

async function abortRun(
  service: SupabaseClient,
  runId: string,
  error: string,
): Promise<void> {
  try {
    await service.rpc('sm_assignment_run_finish', {
      p_run_id: runId,
      p_status: 'ABORTED',
      p_summary: null,
      p_error: error,
    });
  } catch (e) {
    console.error('[auto-assign-bids] abortRun failed', runId, e);
  }
}

async function advanceCursor(
  service: SupabaseClient,
  runId: string,
  lastShiftId: string,
): Promise<void> {
  // Best-effort cursor advance for resumability (01 §2.5). A failure here does
  // NOT abort the run — the (run_id, shift_id) UNIQUE + gateway idem make a
  // resumed run safe even with a stale cursor.
  await service
    .from('assignment_runs')
    .update({ cursor: { last_shift_id: lastShiftId } })
    .eq('id', runId);
}

// =============================================================================
// AUTHN / AUTHZ
// =============================================================================

/** Resolve the caller from the forwarded JWT via a user-scoped client. */
async function resolveCaller(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !ANON_KEY || !SUPABASE_URL) return null;
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id };
}

/**
 * Cert-based authorization (00 §8): the caller must hold an ACTIVE manager cert
 * (gamma/delta/epsilon/zeta) for the requested org (and dept/sub-dept when given).
 * `is_manager_or_above()` is broken in prod, so we read the cert table directly.
 */
async function isManagerForScope(
  service: SupabaseClient,
  userId: string,
  scope: AssignmentScope,
): Promise<boolean> {
  const { data, error } = await service
    .from('app_access_certificates')
    .select('id, access_level, department_id, sub_department_id')
    .eq('user_id', userId)
    .eq('organization_id', scope.organization_id)
    .eq('is_active', true)
    .in('access_level', MANAGER_CERT_LEVELS);
  if (error || !data || data.length === 0) return false;

  // A cert grants the requested scope if it is at/above it: org-only cert
  // covers any dept; a dept cert must match the requested dept; etc.
  return data.some((c: Record<string, unknown>) => {
    if (scope.department_id && c.department_id && c.department_id !== scope.department_id) {
      return false;
    }
    if (
      scope.sub_department_id &&
      c.sub_department_id &&
      c.sub_department_id !== scope.sub_department_id
    ) {
      return false;
    }
    return true;
  });
}

// =============================================================================
// SMALL UTILITIES
// =============================================================================

function stripFunctionPrefix(pathname: string): string {
  // Supabase routes mount at /functions/v1/<name>; depending on invocation the
  // pathname may or may not include that prefix. Normalize to the suffix.
  const marker = '/auto-assign-bids';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return pathname;
  return pathname.slice(idx + marker.length) || '';
}

function emptySummary(): RunSummary {
  return { assigned: 0, skipped: 0, blocked: 0, locked: 0, conflict: 0, error: 0 };
}

function bumpSummary(s: RunSummary, outcome: AssignmentOutcome): void {
  switch (outcome) {
    case 'ASSIGNED':
      s.assigned++;
      break;
    case 'SKIPPED_NO_ELIGIBLE':
      s.skipped++;
      break;
    case 'SKIPPED_BLOCKED':
      s.skipped++;
      s.blocked++;
      break;
    case 'SKIPPED_LOCKED':
      s.locked++;
      break;
    case 'CONFLICT_RETRY':
      s.conflict++;
      break;
    case 'ERROR':
      s.error++;
      break;
  }
}

function summarizePreview(preview: PreviewDecision[]): RunSummary {
  const s = emptySummary();
  for (const p of preview) bumpSummary(s, p.outcome);
  return s;
}

/** gross − unpaid break (paid minutes), for evaluate-compliance weekly projection. */
function paidMinutes(s: ShiftRow): number {
  const gross = minutesBetween(s.start_time, s.end_time);
  return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

function minutesBetween(start: string, end: string): number {
  const sm = toMinutes(start);
  const em = toMinutes(end);
  // Overnight shift: end < start ⇒ wraps midnight.
  return em >= sm ? em - sm : 24 * 60 - sm + em;
}

function toMinutes(t: string): number {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function hhmm(t: string): string {
  // Accepts 'HH:mm', 'HH:mm:ss', or a full ISO timestamp; returns 'HH:mm'.
  if (/^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
  const d = new Date(t);
  if (!isNaN(d.getTime())) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return t;
}

/** 'HH:mm:ss' — the shape the overlap/rest RPCs (via evaluate-compliance) expect. */
function hhmmss(t: string): string {
  if (/^\d{2}:\d{2}:\d{2}/.test(t)) return t.slice(0, 8);
  return `${hhmm(t)}:00`;
}

/** Stable sort (Array.prototype.sort is spec-stable in V8/Deno, but be explicit). */
function stableSort<T>(arr: T[], cmp: (a: T, b: T) => number): T[] {
  return arr
    .map((value, index) => ({ value, index }))
    .sort((a, b) => cmp(a.value, b.value) || a.index - b.index)
    .map((x) => x.value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function backoff(attempt: number): number {
  const base = CAS_BASE_BACKOFF_MS * Math.pow(2, attempt); // 50/100/200
  const jitter = Math.floor(Math.random() * (base / 2));
  return base + jitter;
}

/**
 * Deterministic UUIDv5 (SHA-1, RFC 4122) for the gateway idempotency key.
 * The PG side derives the *same* value via extensions.uuid_generate_v5(ns, name)
 * (00 §5), so a replay maps to the same shift_events.metadata->>'idem' and is a
 * no-op. We implement it inline to avoid an extra Deno dependency.
 */
async function uuidV5(name: string, namespace: string): Promise<string> {
  const nsBytes = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(nsBytes.length + nameBytes.length);
  input.set(nsBytes, 0);
  input.set(nameBytes, nsBytes.length);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToUuid(b: Uint8Array): string {
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

// Silence unused-import lint for the 4h constant in environments that tree-shake;
// it documents the TTS boundary the gateway enforces server-side (01 §3.2).
void FOUR_HOURS_MS;
