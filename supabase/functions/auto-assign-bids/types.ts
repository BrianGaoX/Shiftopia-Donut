// =============================================================================
// auto-assign-bids — Request / Response wire types
//
// Mirrors docs/implementation/01-auto-assign-bids-refactor.md §8 (API design)
// and docs/implementation/00-contracts-and-conventions.md §6 (decision enums),
// §7 (routes). These are the ONLY shapes that cross the HTTP boundary; the
// internal snapshot/decision types live inline in index.ts.
//
// NOTE: this file is Deno-only TS. It is intentionally outside the project's
// tsconfig (supabase/functions is not type-checked by `npx tsc`). Do not add it.
// =============================================================================

// ── Decision enums (00 §6 — BINDING; kept as string unions, mirror DB CHECKs) ──

/** Per-shift outcome (assignment_decisions.outcome). */
export type AssignmentOutcome =
  | 'ASSIGNED'
  | 'SKIPPED_NO_ELIGIBLE'
  | 'SKIPPED_BLOCKED'
  | 'SKIPPED_LOCKED'
  | 'CONFLICT_RETRY'
  | 'ERROR';

/** Run lifecycle status (assignment_runs.status). */
export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'ROLLED_BACK'
  | 'ABORTED';

// ── Request ──────────────────────────────────────────────────────────────────

/**
 * Scope of an auto-assign run. `organization_id` is mandatory; the rest narrow
 * the snapshot. Dates are inclusive `YYYY-MM-DD` (shift_date), null = unbounded.
 */
export interface AssignmentScope {
  organization_id: string;
  department_id?: string | null;
  sub_department_id?: string | null;
  start_date?: string | null; // YYYY-MM-DD inclusive
  end_date?: string | null; // YYYY-MM-DD inclusive
}

/**
 * Run-level options. Recorded verbatim on the run for replay.
 *
 * APPROACH A note: the decision is per-shift first-clear-bidder via the deployed
 * evaluate-compliance function, so the v8 engine's scoring-weight knobs no longer
 * drive selection. The single behavioural toggle is `reject_warnings`. The legacy
 * weight/cap fields are kept (optional, recorded but unused) so older callers and
 * stored run.options rows stay shape-compatible.
 */
export interface AssignmentOptions {
  /**
   * Treat a 'warned' compliance result as INELIGIBLE (skip that bidder). Default
   * false ⇒ a 'warned' bidder is eligible. Only 'violated'/'unavailable' block by
   * default. (Was `accept_warnings` in the v8 engine — inverted polarity here.)
   */
  reject_warnings?: boolean;

  /** @deprecated v8 engine option — accepted for back-compat, no longer consumed. */
  accept_warnings?: boolean;
  /** @deprecated v8 engine option — accepted for back-compat, no longer consumed. */
  max_wins_per_employee?: number;
  /** @deprecated v8 scoring weight — accepted for back-compat, no longer consumed. */
  compliance_weight?: number;
  /** @deprecated v8 scoring weight — accepted for back-compat, no longer consumed. */
  priority_weight?: number;
  /** @deprecated v8 scoring weight — accepted for back-compat, no longer consumed. */
  fairness_weight?: number;
  /** @deprecated v8 scoring weight — accepted for back-compat, no longer consumed. */
  recency_weight?: number;
}

/** POST /functions/v1/auto-assign-bids body. */
export interface StartRunRequest {
  scope: AssignmentScope;
  dry_run?: boolean;
  options?: AssignmentOptions;
}

// ── Response: committed run (01 §8.1, 202) ───────────────────────────────────

/** Per-outcome counts. Keys map 1:1 to the §6 outcome enum buckets. */
export interface RunSummary {
  assigned: number;
  skipped: number; // SKIPPED_NO_ELIGIBLE + SKIPPED_BLOCKED
  blocked: number; // (kept distinct for callers that want the split; ⊆ skipped semantics)
  locked: number; // SKIPPED_LOCKED
  conflict: number; // CONFLICT_RETRY
  error: number; // ERROR
}

export interface StartRunResponse {
  run_id: string;
  status: RunStatus;
  summary: RunSummary;
}

// ── Response: dry-run preview (01 §8.1, 200) ─────────────────────────────────

export interface PreviewWinner {
  employee_id: string;
  /** Resolved display name when available; null if the snapshot lacked it. */
  name?: string | null;
  composite_score: number;
}

export interface PreviewRunnerUp {
  employee_id: string;
  composite_score: number;
  compliance_status: 'PASS' | 'WARNING' | 'BLOCKING';
}

export interface PreviewDecision {
  shift_id: string;
  outcome: AssignmentOutcome;
  winner: PreviewWinner | null;
  runners_up?: PreviewRunnerUp[];
  reason: string;
  rule_hits?: unknown[]; // V8Hit[] — opaque at the wire boundary
  f3_debt?: number;
}

export interface DryRunResponse {
  run_id: string;
  status: RunStatus;
  dry_run: true;
  preview: PreviewDecision[];
  summary: RunSummary;
}

// ── Response: GET /run/:id (01 §8.2) ─────────────────────────────────────────

export interface RunRow {
  id: string;
  organization_id: string;
  status: RunStatus;
  actor_id: string;
  dry_run: boolean;
  engine_version: string;
  policy_version: number;
  scope: AssignmentScope;
  options: AssignmentOptions;
  summary: RunSummary | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface DecisionRow {
  shift_id: string;
  outcome: AssignmentOutcome;
  winner_employee_id: string | null;
  composite_score: number | null;
  runners_up: PreviewRunnerUp[];
  reason: string;
  rule_hits: unknown[];
  version_before: number | null;
  version_after: number | null;
}

export interface GetRunResponse {
  run: RunRow;
  decisions: DecisionRow[];
}

// ── Response: POST /run/:id/rollback (01 §8.3) ───────────────────────────────

export interface RollbackResponse {
  run_id: string;
  status: 'ROLLED_BACK';
  reverted: { shift_id: string; version_after_rollback: number }[];
  skipped: { shift_id: string; reason: string }[];
}

// ── Error envelope (always JSON; the handler never throws past itself) ────────

export interface ErrorResponse {
  error: string;
  /** Stable machine code, e.g. FORBIDDEN, BAD_REQUEST, NOT_FOUND, INTERNAL. */
  code?: string;
  run_id?: string;
  status?: RunStatus;
}
