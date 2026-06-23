// =============================================================================
// auto-approve-swaps — shared types (payload / response / queue / engine)
//
// Mirrors docs/implementation/02-auto-approve-swaps.md (§2 decision matrix,
// §3 eligibility) and 00-contracts-and-conventions.md (§5 idempotency,
// §6 decision enum). These shapes are shared by:
//   - index.ts        (Deno worker — DB + crypto)
//   - eligibility.ts  (pure)
//   - decision-matrix.ts (pure)
//
// IMPORTANT: this module is import-clean (no Deno, no DB, no browser globals)
// so the project's vitest can load it directly. Keep it that way.
//
// NOTE: like the sibling auto-assign-bids function, this directory is Deno-only
// TS and is intentionally OUTSIDE the root tsconfig. Do not add it.
// =============================================================================

// ── Decision enum (00 §6 — BINDING) ──────────────────────────────────────────

export type SwapDecision = 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'AUTO_REJECT';

// ── Eligibility rule modes (02 §3) ───────────────────────────────────────────

export type RuleMode =
  | 'REQUIRE_EQUAL'
  | 'AUTO_REJECT_IF_FAIL'
  | 'ROUTE_TO_REVIEW_IF_FAIL'
  | 'IGNORE';

export type RuleStatus = 'pass' | 'fail';

/** One configurable/always-on predicate result. */
export interface RuleOutcome {
  ruleId: string;
  status: RuleStatus;
  /** The EFFECTIVE mode actually applied (always-on rules are forced). */
  mode: RuleMode;
  detail: Record<string, unknown>;
}

/** Per-rule policy entry (swap_approval_rules.rules jsonb). */
export interface RulePolicy {
  enabled?: boolean;
  mode?: RuleMode;
  params?: Record<string, unknown>;
}

/** The merged, resolved policy row the worker hands to the pure modules. */
export interface SwapPolicy {
  enabled: boolean;
  shadow_mode: boolean;
  auto_approve_warnings: boolean;
  confidence_min: number;
  max_auto_per_employee_per_week: number;
  rules: Record<string, RulePolicy>;
  version: number;
  organization_id: string;
  department_id: string | null;
}

// ── Eligibility I/O (02 §3) ──────────────────────────────────────────────────

/** Minimal shift facts the eligibility engine reads. Worker projects these
 *  from the `shifts` row (service-role read). Times are post-break "paid"
 *  minutes; `start_at`/`end_at` are absolute ISO for overlap math. */
export interface EligShift {
  id: string;
  role_id: string | null;
  department_id: string | null;
  sub_department_id: string | null;
  /** Required certs the INCOMING worker must hold (skills ∪ licenses). */
  required_certs: string[];
  /** Paid (worked) minutes = gross − unpaid break. */
  paid_minutes: number;
  /** Hourly rate (remuneration_levels.hourly_rate_min). 0 when unknown. */
  hourly_rate: number;
  start_at: string; // ISO
  end_at: string; // ISO
  shift_date: string; // YYYY-MM-DD
}

/** A roster entry used for overlap detection (absolute intervals). */
export interface RosterEntry {
  id: string;
  start_at: string; // ISO
  end_at: string; // ISO
}

/** A party's eligibility-relevant facts. */
export interface EligParty {
  employee_id: string;
  is_active: boolean;
  /** Certs the worker holds. */
  held_certs: string[];
  /** Whole roster window (±30d) — overlap is computed post-swap. */
  roster: RosterEntry[];
  /** Availability windows for the picked-up shift, or `null` when availability
   *  data is unknown (engine fails CLOSED → unavailable). */
  available_for_received: boolean | null;
}

/** Solver-derived signals the eligibility engine delegates to (02 §3.6/§3.7). */
export interface SolverSignals {
  /** A blocking fatigue (rest-gap / consecutive-days) hit fired. */
  fatigue_blocking: boolean;
  /** Fatigue constraint ids that hit (for the audit detail). */
  fatigue_hits: string[];
  /** A non-blocking overtime / hours WARNING fired. */
  overtime_warning: boolean;
  overtime_hits: string[];
  /** Solver WARNING count (drives confidence in §3.11). */
  warning_count: number;
}

export interface EligibilityInput {
  requesterShift: EligShift; // Rs — given by requester
  offeredShift: EligShift | null; // Os — given by offerer (null = giveaway)
  requester: EligParty; // Ra — picks up Os
  offerer: EligParty | null; // Ob — picks up Rs (null = giveaway)
  solver: SolverSignals;
  /** Min-staffing floor for the donor slot, when known (team coverage §3.9). */
  coverageFloor?: number | null;
  /** Current assigned count in the donor slot, when known. */
  coverageBefore?: number | null;
}

export interface PayrollDelta {
  /** Requester's per-hour change (earns Os rate vs Rs rate). */
  requesterDeltaPerHour: number;
  /** Offerer's per-hour change (earns Rs rate vs Os rate). */
  offererDeltaPerHour: number;
  /** Org-cost change across both legs (0 on a pure swap, nonzero on duration diff). */
  estCostDelta: number;
}

export interface EligibilityResult {
  outcomes: RuleOutcome[];
  /** REQUIRE_EQUAL / AUTO_REJECT_IF_FAIL failures. */
  rejectVotes: RuleOutcome[];
  /** ROUTE_TO_REVIEW_IF_FAIL failures. */
  reviewVotes: RuleOutcome[];
  payrollDelta: PayrollDelta;
  /** 1.0 → 0.0 (02 §3.11). */
  confidence: number;
  // Convenience aggregate flags (mirror the doc's evaluateEligibility contract).
  any_reject: boolean;
  any_review: boolean;
}

// ── Decision-matrix I/O (02 §2) ──────────────────────────────────────────────

/** runSwapGuards-shaped result, narrowed to what the matrix reads. */
export interface GuardSummary {
  passed: boolean;
  codes: string[];
}

/** swapEvaluator-shaped verdict, narrowed to what the matrix reads. */
export interface SolverSummary {
  feasible: boolean;
  verdict: 'PASS' | 'WARNING' | 'BLOCKING';
  /** Blocking violations (for the reason string). */
  blocking: { employee_name?: string; summary: string }[];
}

export interface DecisionInput {
  guards: GuardSummary;
  solver: SolverSummary;
  eligibility: EligibilityResult;
  policy: Pick<SwapPolicy, 'auto_approve_warnings' | 'confidence_min'>;
  confidence: number;
  /** True when an abuse post-gate (rate-limit / pairwise / cycle≥2) fired. */
  rateLimited: boolean;
  /** True only for a confirmed laundering cycle (≥3) → hard reject (02 §4.5). */
  launderingCycle?: boolean;
}

export interface DecisionResult {
  decision: SwapDecision;
  reason: string;
  confidence: number;
}

// ── sm_swap_auto_decide payload (02 spec / RPC contract) ─────────────────────

export interface AutoDecidePayload {
  decision: SwapDecision;
  guard_result: unknown;
  eligibility_result: unknown;
  solver_result: unknown;
  reason: string;
  policy_version: number;
  engine_version: string;
  requester_shift_version: number;
  offered_shift_version: number; // 0 for a giveaway
  confidence: number;
}

/** Return shape of sm_swap_auto_decide. */
export interface AutoDecideResult {
  ok: boolean;
  code: AutoDecideCode;
  decision?: SwapDecision;
  decision_id?: string;
  gateway?: unknown;
}

export type AutoDecideCode =
  | 'IDEMPOTENT_REPLAY'
  | 'GONE'
  | 'NOT_PENDING'
  | 'DISABLED'
  | 'SHADOW'
  | 'MANUAL_REVIEW'
  | 'COMMITTED'
  | 'GATEWAY_REFUSED'
  | 'VERSION_CONFLICT'
  | 'ERROR';

// ── Queue row (sm_swap_queue_claim returns SETOF swap_review_queue) ───────────

export type QueueStatus = 'PENDING' | 'CLAIMED' | 'DONE' | 'DLQ';
export type QueueComplete = 'DONE' | 'RETRY' | 'DLQ';

export interface QueueRow {
  id: string;
  swap_id: string;
  idempotency_key: string;
  status: QueueStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
}

// ── Worker HTTP response (POST /functions/v1/auto-approve-swaps) ─────────────

export interface WorkerSummary {
  claimed: number;
  committed: number;
  shadow: number;
  manual_review: number;
  rejected: number;
  retried: number;
  done: number;
  errors: number;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}
