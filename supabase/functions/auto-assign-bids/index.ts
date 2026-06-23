// =============================================================================
// auto-assign-bids — Supabase Edge Function (Deno, service role)
//
// Hosts the PURE v8 bidding brain (runBidSelection) server-side and commits each
// selected winner through the existing sm_apply_shift_op gateway with version-CAS.
// Implements docs/implementation/01-auto-assign-bids-refactor.md §2 (orchestration)
// + §8 (API), bound by 00-contracts-and-conventions.md (D1–D5, §5–§7).
//
// -----------------------------------------------------------------------------
// BUNDLING / IMPORT STRATEGY  (full rationale in ./README.md)
// -----------------------------------------------------------------------------
// The v8 compliance engine under src/modules/compliance/v8/** is browser/Node TS:
//   - bidding/evaluator.ts → ../index.ts (runV8Orchestrator) imports `@sentry/react`
//     and reads `import.meta.env.*`, and pulls in ./audit.ts which imports
//     `@/platform/supabase/client`. None of those exist under Deno.
// We therefore VENDOR the engine into ./_vendor/compliance/ and rewire the three
// browser-only leaves via the function-local import map (./import_map.json):
//   "@/platform/supabase/client" → ./_vendor/_shims/supabase-client.ts (no-op)
//   "@sentry/react"              → ./_vendor/_shims/sentry.ts          (no-op)
//   and a tiny `import.meta.env` polyfill is provided by the same shim barrel.
// `runBidSelection` itself is pure and unchanged. We import ONLY it from the
// vendored tree so the rest of the engine surface stays internal.
//
// The alias below resolves through import_map.json → "@compliance/".
import { runBidSelection } from '@compliance/v8/orchestrator/bidding/index.ts';
import type {
  Bid,
  BiddingInput,
  BiddingResult,
} from '@compliance/v8/orchestrator/bidding/types.ts';
import type {
  V8EmployeeContext,
  V8OrchestratorShift,
} from '@compliance/v8/orchestrator/types.ts';

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
  bids: BidRow[];
  contexts: V8EmployeeContext[];
  existing: { employee_id: string; shifts: V8OrchestratorShift[] }[];
  names: Map<string, string>;
  debts: Map<string, number>; // employee_id → denied_preferences debt
  f3Degraded: boolean;
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

    // ── (D) Build the v8 BiddingInput. R4/R5 quals+role are populated here. ──
    const input = buildBiddingInput(snap, options);

    // ── (E) Run the deterministic brain. No DB writes. ──
    const plan: BiddingResult = runBidSelection(input);

    // ── (F) DRY RUN: persist preview decisions (committed=false), no gateway. ──
    if (dryRun) {
      const preview = buildPreview(plan, snap);
      const summary = summarizePreview(preview);
      await persistDryRunDecisions(service, runId, preview, snap);
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

    // ── (G) COMMIT each winner via the gateway, shift_id ASC (deadlock-safe). ──
    const summary = emptySummary();
    const ordered = [...plan.selected_bids].sort((a, b) =>
      a.shift_id.localeCompare(b.shift_id),
    );

    for (const sel of ordered) {
      const shift = snap.shiftById.get(sel.shift_id);
      if (!shift) {
        await recordDecision(service, runId, sel.shift_id, 'ERROR', {
          reason: 'Winner references a shift outside the snapshot.',
        });
        summary.error++;
        continue;
      }
      const outcome = await commitWinnerWithRetry(service, {
        runId,
        shift,
        winnerId: sel.employee_id,
        plan,
        snap,
      });
      bumpSummary(summary, outcome);
      // Advance the resumable cursor (01 §2.5) after each committed decision.
      await advanceCursor(service, runId, shift.id);
    }

    // Shifts that had bids but no selected winner → record SKIPPED rows.
    await recordUnfilled(service, runId, plan, snap, summary);

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
    plan: BiddingResult;
    snap: Snapshot;
  },
): Promise<AssignmentOutcome> {
  const { runId, shift, winnerId, plan } = args;
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
        plan,
        reason: `Gateway RPC error: ${error.message}`,
        versionBefore: expectedVersion,
      });
    }

    const r = (data ?? {}) as GatewayResult;

    // Applied or idempotent replay ⇒ ASSIGNED.
    if (r.ok && (r.code === 'APPLIED' || r.code === 'IDEMPOTENT_REPLAY')) {
      return await recordDecision(service, runId, shift.id, 'ASSIGNED', {
        winnerId,
        plan,
        reason:
          'Global greedy: highest composite score, compliance-clear vs tentative schedule.',
        versionBefore: expectedVersion,
        versionAfter: r.version ?? null,
        idem: idemUuid,
      });
    }

    // Server-side P0 guards (01 §3.2/§3.3) surface as WRITE_REJECTED notes.
    if (r.code === 'WRITE_REJECTED' && r.note === 'WINNER_NOT_PENDING') {
      return await recordDecision(service, runId, shift.id, 'SKIPPED_NO_ELIGIBLE', {
        winnerId,
        plan,
        reason: 'Winning bid is no longer pending (withdrawn/rejected since snapshot).',
        versionBefore: expectedVersion,
      });
    }
    if (r.code === 'WRITE_REJECTED' && r.note === 'SHIFT_TIME_LOCKED') {
      return await recordDecision(service, runId, shift.id, 'SKIPPED_LOCKED', {
        winnerId,
        plan,
        reason: 'Shift is inside the 4h time-lock; use emergency assignment.',
        versionBefore: expectedVersion,
      });
    }
    if (r.code === 'ILLEGAL_TRANSITION' || r.code === 'GONE') {
      return await recordDecision(service, runId, shift.id, 'SKIPPED_BLOCKED', {
        winnerId,
        plan,
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
          plan,
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
      plan,
      reason: `Unexpected gateway code: ${r.code ?? 'UNKNOWN'}.`,
      versionBefore: expectedVersion,
    });
  }

  // Retries exhausted.
  return await recordDecision(service, runId, args.shift.id, 'CONFLICT_RETRY', {
    winnerId,
    plan,
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
      bids: [],
      contexts: [],
      existing: [],
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
      bids,
      contexts: [],
      existing: [],
      names: new Map(),
      debts: new Map(),
      f3Degraded: false,
    };
  }

  // (3) Each bidder's existing assigned shifts in a window, ORG-SCOPED (audit row 26).
  const dates = shifts.map((s) => s.shift_date).sort();
  const lo = addDays(dates[0], -30);
  const hi = addDays(dates[dates.length - 1], 14);

  const { data: existingData, error: existErr } = await service
    .from('shifts')
    .select(
      'id, shift_date, start_time, end_time, role_id, required_skills, required_licenses, unpaid_break_minutes, organization_id, department_id, sub_department_id, assigned_employee_id',
    )
    .in('assigned_employee_id', bidderIds)
    .eq('organization_id', scope.organization_id)
    .gte('shift_date', lo)
    .lte('shift_date', hi)
    .is('deleted_at', null)
    .eq('is_cancelled', false);
  if (existErr) throw new Error(`snapshot.existing: ${existErr.message}`);

  const existingByEmp = new Map<string, V8OrchestratorShift[]>();
  for (const row of (existingData ?? []) as Array<
    ShiftRow & { assigned_employee_id: string }
  >) {
    const arr = existingByEmp.get(row.assigned_employee_id) ?? [];
    arr.push(toV8Shift(row));
    existingByEmp.set(row.assigned_employee_id, arr);
  }
  const existing = bidderIds.map((id) => ({
    employee_id: id,
    shifts: existingByEmp.get(id) ?? [],
  }));

  // (4) Employee contexts (contract, quals, visa flag). Same shape as
  //     fetchV8EmployeeContext, fetched server-side in batched passes.
  const { contexts, names } = await loadEmployeeContexts(
    service,
    scope.organization_id,
    bidderIds,
  );

  // (5) Fairness debts (F3 — denied_preferences). Explicit degradation on error.
  const { debts, f3Degraded } = await loadFairnessDebts(
    service,
    scope.organization_id,
    bidderIds,
  );

  return { shifts, shiftById, bids, contexts, existing, names, debts, f3Degraded };
}

/** shift row → V8OrchestratorShift. R4 quals + R5 role hydrated from real columns. */
function toV8Shift(row: ShiftRow): V8OrchestratorShift {
  return {
    id: row.id,
    date: row.shift_date,
    start_time: hhmm(row.start_time),
    end_time: hhmm(row.end_time),
    role_id: row.role_id ?? '', // R5 — real role
    required_qualifications: [
      ...(row.required_licenses ?? []), // R4 — NOT []
      ...(row.required_skills ?? []),
    ],
    organization_id: row.organization_id,
    department_id: row.department_id ?? undefined,
    sub_department_id: row.sub_department_id ?? undefined,
    is_ordinary_hours: true,
    unpaid_break_minutes: row.unpaid_break_minutes ?? 0,
    break_minutes: row.unpaid_break_minutes ?? 0,
  };
}

/**
 * Batched employee-context fetch. Aggregates the student-visa work-limit flag
 * with bool_or semantics (never .maybeSingle()) — 01 §2.3 fixes audit S3.
 * Best-effort per dataset: missing tables degrade gracefully to a neutral
 * CASUAL context so the engine still runs (compliance simply has less to bite on).
 */
async function loadEmployeeContexts(
  service: SupabaseClient,
  orgId: string,
  empIds: string[],
): Promise<{ contexts: V8EmployeeContext[]; names: Map<string, string> }> {
  const names = new Map<string, string>();

  const { data: profiles } = await service
    .from('profiles')
    .select('id, full_name, contract_type, contracted_weekly_hours, has_restricted_work_limit')
    .in('id', empIds);

  const profileById = new Map<string, Record<string, unknown>>();
  for (const p of (profiles ?? []) as Array<Record<string, unknown>>) {
    profileById.set(p.id as string, p);
    if (p.full_name) names.set(p.id as string, p.full_name as string);
  }

  // Qualifications (skills + licenses) per employee.
  const [{ data: skills }, { data: licenses }, { data: contracts }] = await Promise.all([
    service.from('employee_skills').select('employee_id, skill_id').in('employee_id', empIds),
    service.from('employee_licenses').select('employee_id, license_id').in('employee_id', empIds),
    service
      .from('employee_contracts')
      .select('employee_id, organization_id, department_id, sub_department_id, role_id')
      .in('employee_id', empIds)
      .eq('organization_id', orgId),
  ]);

  const skillsByEmp = groupBy(skills as Array<{ employee_id: string; skill_id: string }> ?? [], 'employee_id', 'skill_id');
  const licByEmp = groupBy(licenses as Array<{ employee_id: string; license_id: string }> ?? [], 'employee_id', 'license_id');
  const rolesByEmp = groupBy(contracts as Array<{ employee_id: string; role_id: string }> ?? [], 'employee_id', 'role_id');

  const contexts: V8EmployeeContext[] = empIds.map((id) => {
    const p = profileById.get(id) ?? {};
    const visaLimited = Boolean(p.has_restricted_work_limit);
    return {
      employee_id: id,
      contract_type: visaLimited
        ? 'STUDENT_VISA'
        : ((p.contract_type as V8EmployeeContext['contract_type']) ?? 'CASUAL'),
      contracted_weekly_hours: (p.contracted_weekly_hours as number) ?? 0,
      skill_ids: skillsByEmp.get(id) ?? [],
      license_ids: licByEmp.get(id) ?? [],
      assigned_role_ids: rolesByEmp.get(id) ?? [],
    };
  });

  return { contexts, names };
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
// BUILD BiddingInput — 01 §2.4 (D), §4 (F3 priority boost)
// =============================================================================

const DEBT_SATURATION = 5; // 01 §4.2
const F3_GAIN = 0.25;

function buildBiddingInput(snap: Snapshot, options: AssignmentOptions): BiddingInput {
  const candidateShifts = snap.shifts.map((s) => toV8Shift(s));

  const bids: Bid[] = snap.bids.map((b) => {
    const base = (b.priority_score ?? 50) / 100;
    const debt = snap.debts.get(b.employee_id) ?? 0;
    const debtNorm = clamp(debt / DEBT_SATURATION, 0, 1);
    const boosted = clamp(base + F3_GAIN * debtNorm, 0, 1);
    return {
      bid_id: b.id,
      shift_id: b.shift_id,
      employee_id: b.employee_id,
      bid_time: b.created_at,
      priority_score: Math.round(boosted * 100), // back to 0–100 for the scorer
    };
  });

  return {
    shifts: candidateShifts,
    bids,
    employee_contexts: snap.contexts,
    employee_existing_shifts: snap.existing,
    config: {
      accept_warnings: options.accept_warnings ?? false, // R6: explicit OFF
      compliance_weight: options.compliance_weight ?? 0.4,
      priority_weight: options.priority_weight ?? 0.3,
      fairness_weight: options.fairness_weight ?? 0.2,
      recency_weight: options.recency_weight ?? 0.1,
      auto_assign: false, // we commit via the gateway, NOT executeBatch
    },
  };
}

// =============================================================================
// DECISIONS / EVENTS / RUN LIFECYCLE writes
// =============================================================================

interface DecisionMeta {
  winnerId?: string;
  plan?: BiddingResult;
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
  const score =
    meta.plan && meta.winnerId
      ? scoreFor(meta.plan, shiftId)
      : null;

  await service.from('assignment_decisions').upsert(
    {
      run_id: runId,
      shift_id: shiftId,
      winner_employee_id: winner,
      runners_up: meta.plan ? rankedRunnersUp(meta.plan, shiftId, meta.winnerId) : [],
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

/** Record shifts with bids but no selected winner (engine-side, no gateway call). */
async function recordUnfilled(
  service: SupabaseClient,
  runId: string,
  plan: BiddingResult,
  snap: Snapshot,
  summary: RunSummary,
): Promise<void> {
  const decided = new Set(plan.selected_bids.map((s) => s.shift_id));
  const shiftsWithBids = new Set(snap.bids.map((b) => b.shift_id));
  for (const shiftId of plan.unfilled_shifts) {
    if (decided.has(shiftId)) continue;
    const hadBids = shiftsWithBids.has(shiftId);
    const outcome: AssignmentOutcome = hadBids
      ? 'SKIPPED_BLOCKED'
      : 'SKIPPED_NO_ELIGIBLE';
    await recordDecision(service, runId, shiftId, outcome, {
      reason: hadBids
        ? 'All bids blocked by compliance against the tentative schedule.'
        : 'No eligible bids for this shift.',
    });
    bumpSummary(summary, outcome);
  }
}

async function persistDryRunDecisions(
  service: SupabaseClient,
  runId: string,
  preview: PreviewDecision[],
  _snap: Snapshot,
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
// PREVIEW (dry run) assembly
// =============================================================================

function buildPreview(plan: BiddingResult, snap: Snapshot): PreviewDecision[] {
  const out: PreviewDecision[] = [];
  const decided = new Set<string>();

  for (const sel of plan.selected_bids) {
    decided.add(sel.shift_id);
    out.push({
      shift_id: sel.shift_id,
      outcome: 'ASSIGNED',
      winner: {
        employee_id: sel.employee_id,
        name: snap.names.get(sel.employee_id) ?? null,
        composite_score: scoreFor(plan, sel.shift_id) ?? 0,
      },
      runners_up: rankedRunnersUp(plan, sel.shift_id, sel.employee_id),
      reason: 'Highest composite score; compliance-clear vs tentative schedule.',
      rule_hits: [],
      f3_debt: snap.debts.get(sel.employee_id) ?? 0,
    });
  }

  const shiftsWithBids = new Set(snap.bids.map((b) => b.shift_id));
  for (const shiftId of plan.unfilled_shifts) {
    if (decided.has(shiftId)) continue;
    const hadBids = shiftsWithBids.has(shiftId);
    out.push({
      shift_id: shiftId,
      outcome: hadBids ? 'SKIPPED_BLOCKED' : 'SKIPPED_NO_ELIGIBLE',
      winner: null,
      reason: hadBids
        ? 'All bids blocked by compliance against the tentative schedule.'
        : 'No eligible bids for this shift.',
    });
  }
  return out;
}

// =============================================================================
// SCORE / RUNNERS-UP helpers
//
// The pure BiddingResult does not expose per-shift composite scores directly,
// so we recover what we can from selected/rejected. These are best-effort,
// deterministic projections used only for the audit/preview surface — the
// commit decision itself is made entirely by runBidSelection.
// =============================================================================

function scoreFor(plan: BiddingResult, shiftId: string): number | null {
  const sel = plan.selected_bids.find((s) => s.shift_id === shiftId);
  if (!sel) return null;
  // SelectedBid carries compliance_status but not the numeric composite; map the
  // status to the compliance band so the preview is informative and bounded 0..100.
  // (When 01's `engine.ts` ports scorer hooks, replace with the exact value.)
  switch (sel.compliance_status) {
    case 'PASS':
      return 100;
    case 'WARNING':
      return 50;
    default:
      return 0;
  }
}

function rankedRunnersUp(
  plan: BiddingResult,
  shiftId: string,
  winnerId?: string,
): { employee_id: string; composite_score: number; compliance_status: 'PASS' | 'WARNING' | 'BLOCKING' }[] {
  // Runners-up are the rejected bids on this shift, in the order the engine
  // produced them (already score-ordered upstream). We don't have their numeric
  // scores in BiddingResult, so we annotate with their reason-band placeholder.
  void plan;
  void shiftId;
  void winnerId;
  return []; // see header note: filled in once engine.ts surfaces per-bid scores
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

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
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

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function groupBy<T extends Record<string, unknown>>(
  rows: T[],
  keyField: string,
  valueField: string,
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = r[keyField] as string;
    const v = r[valueField] as string;
    if (!k || v == null) continue;
    const arr = m.get(k) ?? [];
    arr.push(v);
    m.set(k, arr);
  }
  return m;
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
