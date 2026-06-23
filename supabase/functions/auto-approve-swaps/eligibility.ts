// =============================================================================
// auto-approve-swaps — Eligibility Engine (PURE)
//
// Deterministic pure function implementing docs/implementation/02-auto-approve
// -swaps.md §3 (role / cert / location / pay+payroll-delta / duration / fatigue
// / overtime / overlap / coverage / availability) + §3.11 confidence.
//
// It does NOT re-implement compliance/fatigue — those come from `swapEvaluator`
// (passed in via SolverSignals). It encodes only the operational/policy
// predicates and the payroll delta.
//
// ALWAYS-ON rules (02 §3.12) cannot be configured away: the engine FORCES their
// mode to AUTO_REJECT_IF_FAIL regardless of what the policy says. These are:
// certification, fatigue, schedule-overlap. (Solver-blocking compliance and the
// 4h time-lock are enforced by the matrix/guards/gateway, not re-voted here.)
//
// NO Deno / DB / browser imports — so the project vitest loads it directly.
// =============================================================================

import type {
  EligibilityInput,
  EligibilityResult,
  EligParty,
  EligShift,
  PayrollDelta,
  RuleMode,
  RuleOutcome,
  RulePolicy,
  RuleStatus,
} from './types.ts';

// Rules whose mode the operator may NOT relax. The engine pins them to reject.
const ALWAYS_ON: Record<string, true> = {
  certification: true,
  fatigue: true,
  overlap: true,
};

// Default modes when a rule has no policy entry (02 §3.12 summary table).
const DEFAULT_MODE: Record<string, RuleMode> = {
  same_role: 'REQUIRE_EQUAL',
  certification: 'AUTO_REJECT_IF_FAIL',
  same_location: 'REQUIRE_EQUAL',
  same_pay_rate: 'ROUTE_TO_REVIEW_IF_FAIL',
  same_duration: 'ROUTE_TO_REVIEW_IF_FAIL',
  fatigue: 'AUTO_REJECT_IF_FAIL',
  overtime: 'ROUTE_TO_REVIEW_IF_FAIL',
  overlap: 'AUTO_REJECT_IF_FAIL',
  team_coverage: 'ROUTE_TO_REVIEW_IF_FAIL',
  availability: 'AUTO_REJECT_IF_FAIL',
};

// Confidence penalties (02 §3.11).
const REVIEW_PENALTY = 0.15;
const WARNING_PENALTY = 0.25;

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Evaluate the operational eligibility predicates for a swap.
 *
 * @param input  shifts, parties, solver-derived signals, optional coverage facts
 * @param rules  policy.rules — per-rule `{enabled, mode, params}` map
 */
export function evaluateEligibility(
  input: EligibilityInput,
  rules: Record<string, RulePolicy>,
): EligibilityResult {
  const Rs = input.requesterShift;
  const Os = input.offeredShift; // null = giveaway
  const Ra = input.requester;
  const Ob = input.offerer; // null = giveaway
  const giveaway = Os === null || Ob === null;

  const outcomes: RuleOutcome[] = [];

  const emit = (
    ruleId: string,
    status: RuleStatus,
    detail: Record<string, unknown>,
  ): void => {
    outcomes.push({ ruleId, status, mode: effectiveMode(ruleId, rules), detail });
  };

  // ── 3.1 Role matching (REQUIRE_EQUAL) ──────────────────────────────────────
  // On a giveaway there is no offered shift; the incoming role is moot for the
  // requester (they give a shift, receive nothing). Treat as pass.
  if (!giveaway && Os) {
    const sameRole = Rs.role_id === Os.role_id;
    emit('same_role', sameRole ? 'pass' : 'fail', { rs: Rs.role_id, os: Os.role_id });
  } else {
    emit('same_role', 'pass', { giveaway: true });
  }

  // ── 3.2 Certification (ALWAYS-ON, AUTO_REJECT_IF_FAIL) ──────────────────────
  // After the swap: Ra works Os, Ob works Rs. Each incoming worker must hold
  // every required cert of the shift they pick up.
  {
    const reqMissing = giveaway || !Os ? [] : diff(Os.required_certs, setOf(Ra.held_certs));
    const offMissing = giveaway || !Ob ? diff(Rs.required_certs, setOf(Ob?.held_certs ?? [])) : diff(Rs.required_certs, setOf(Ob.held_certs));
    // On a giveaway, only the offerer (Ob) picks up Rs; if there is no offerer
    // at all (open giveaway not yet matched) there is nothing to certify here.
    const offMissingEff = Ob ? offMissing : [];
    const ok = reqMissing.length === 0 && offMissingEff.length === 0;
    emit('certification', ok ? 'pass' : 'fail', {
      missing_requester: reqMissing,
      missing_offerer: offMissingEff,
    });
  }

  // ── 3.3 Location / site (REQUIRE_EQUAL) ─────────────────────────────────────
  if (!giveaway && Os) {
    const grain = strParam(rules.same_location, 'grain', 'sub_department');
    const sameLoc =
      grain === 'department'
        ? Rs.department_id === Os.department_id
        : Rs.sub_department_id === Os.sub_department_id;
    emit('same_location', sameLoc ? 'pass' : 'fail', { grain });
  } else {
    emit('same_location', 'pass', { giveaway: true });
  }

  // ── 3.4 Pay-rate + payroll delta (ROUTE_TO_REVIEW_IF_FAIL) ──────────────────
  const payrollDelta = computePayrollDelta(Rs, Os);
  {
    if (!giveaway && Os) {
      const tol = numParam(rules.same_pay_rate, 'tolerance', 0);
      const pass = Math.abs(Rs.hourly_rate - Os.hourly_rate) <= tol;
      emit('same_pay_rate', pass ? 'pass' : 'fail', {
        rRs: Rs.hourly_rate,
        rOs: Os.hourly_rate,
        tol,
        ...payrollDelta,
      });
    } else {
      emit('same_pay_rate', 'pass', { giveaway: true, ...payrollDelta });
    }
  }

  // ── 3.5 Duration tolerance (ROUTE_TO_REVIEW_IF_FAIL, ±X min) ─────────────────
  if (!giveaway && Os) {
    const tol = numParam(rules.same_duration, 'tolerance_min', 30);
    const pass = Math.abs(Rs.paid_minutes - Os.paid_minutes) <= tol;
    emit('same_duration', pass ? 'pass' : 'fail', {
      rs: Rs.paid_minutes,
      os: Os.paid_minutes,
      tol,
    });
  } else {
    emit('same_duration', 'pass', { giveaway: true });
  }

  // ── 3.6 Fatigue (ALWAYS-ON, delegated to solver) ────────────────────────────
  emit('fatigue', input.solver.fatigue_blocking ? 'fail' : 'pass', {
    hits: input.solver.fatigue_hits,
  });

  // ── 3.7 Overtime (ROUTE_TO_REVIEW_IF_FAIL, delegated to solver warnings) ────
  emit('overtime', input.solver.overtime_warning ? 'fail' : 'pass', {
    ot: input.solver.overtime_warning,
    hits: input.solver.overtime_hits,
  });

  // ── 3.8 Schedule overlap (ALWAYS-ON, AUTO_REJECT_IF_FAIL) ───────────────────
  // Belt-and-braces vs the solver. Each party's POST-swap schedule must not
  // self-overlap with the shift they pick up.
  {
    const reqClash = !giveaway && Os ? rosterMinus(Ra.roster, Rs.id).some((s) => overlaps(s, Os)) : false;
    const offClash = Ob ? rosterMinus(Ob.roster, Os ? Os.id : '__none__').some((s) => overlaps(s, Rs)) : false;
    emit('overlap', reqClash || offClash ? 'fail' : 'pass', { reqClash, offClash });
  }

  // ── 3.9 Team coverage (ROUTE_TO_REVIEW_IF_FAIL) ─────────────────────────────
  // Only evaluable when the worker supplied a floor + current count. A pure 1:1
  // same-role swap is coverage-neutral; a giveaway or role-change can drop a slot.
  {
    const floor = input.coverageFloor;
    const before = input.coverageBefore;
    if (floor != null && before != null) {
      const dropsSlot = giveaway || !Os || Rs.role_id !== Os.role_id;
      const after = before - (dropsSlot ? 1 : 0);
      emit('team_coverage', after >= floor ? 'pass' : 'fail', { floor, before, after });
    } else {
      // No coverage data → cannot assert a breach; pass (the solver still gates
      // hard compliance and a manager sees the swap if anything else flags).
      emit('team_coverage', 'pass', { evaluated: false });
    }
  }

  // ── 3.10 Availability (AUTO_REJECT_IF_FAIL) ─────────────────────────────────
  // Fail CLOSED: unknown availability (null) is treated as unavailable.
  {
    const reqAvail = giveaway || !Os ? true : Ra.available_for_received === true && Ra.is_active;
    const offAvail = Ob ? Ob.available_for_received === true && Ob.is_active : true;
    emit('availability', reqAvail && offAvail ? 'pass' : 'fail', {
      reqAvail,
      offAvail,
      requester_active: Ra.is_active,
      offerer_active: Ob?.is_active ?? null,
    });
  }

  // ── Aggregate votes by EFFECTIVE mode ───────────────────────────────────────
  const rejectVotes: RuleOutcome[] = [];
  const reviewVotes: RuleOutcome[] = [];
  for (const o of outcomes) {
    if (o.status !== 'fail') continue;
    if (o.mode === 'IGNORE') continue;
    if (o.mode === 'REQUIRE_EQUAL' || o.mode === 'AUTO_REJECT_IF_FAIL') {
      rejectVotes.push(o);
    } else if (o.mode === 'ROUTE_TO_REVIEW_IF_FAIL') {
      reviewVotes.push(o);
    }
  }

  // ── Confidence (02 §3.11): 1.0 − 0.15·route_flags − 0.25·solver_warnings ────
  const routeFlags = reviewVotes.length;
  const confidence = clamp01(
    1.0 - REVIEW_PENALTY * routeFlags - WARNING_PENALTY * input.solver.warning_count,
  );

  return {
    outcomes,
    rejectVotes,
    reviewVotes,
    payrollDelta,
    confidence,
    any_reject: rejectVotes.length > 0,
    any_review: reviewVotes.length > 0,
  };
}

// =============================================================================
// PAYROLL DELTA (02 §3.4) — always computed, even on a pay-rate pass.
// =============================================================================

/**
 * After the swap, the requester earns the offered shift's rate on the offered
 * hours, and the offerer earns the requester shift's rate on the requester
 * hours. Org cost is neutral on a pure 1:1 swap and nonzero when the durations
 * differ. On a giveaway (no offered shift) the requester picks up nothing.
 */
export function computePayrollDelta(Rs: EligShift, Os: EligShift | null): PayrollDelta {
  const rRs = Rs.hourly_rate;
  const rOs = Os ? Os.hourly_rate : 0;
  const hRs = Rs.paid_minutes / 60;
  const hOs = Os ? Os.paid_minutes / 60 : 0;

  // Per-hour change each party sees on the shift they pick up.
  const requesterDeltaPerHour = rOs - rRs;
  const offererDeltaPerHour = rRs - rOs;

  // Org-cost change: (after) − (before). Before, Rs is paid at rRs over hRs and
  // Os at rOs over hOs. After, the SAME shifts are paid at the SAME rates (the
  // shift's rate follows the shift, not the worker) — so on a same-duration swap
  // this is exactly 0. It is nonzero only if a leg's paid hours change, which
  // does not happen on a pure reassignment; we keep the formula explicit so a
  // future "rate follows worker" policy can flip the sign without a rewrite.
  const before = rRs * hRs + rOs * hOs;
  const after = rRs * hRs + rOs * hOs;
  const estCostDelta = round2(after - before);

  return {
    requesterDeltaPerHour: round2(requesterDeltaPerHour),
    offererDeltaPerHour: round2(offererDeltaPerHour),
    estCostDelta,
  };
}

// =============================================================================
// MODE RESOLUTION — always-on rules cannot be configured away.
// =============================================================================

export function effectiveMode(
  ruleId: string,
  rules: Record<string, RulePolicy>,
): RuleMode {
  // Always-on rules are FORCED to AUTO_REJECT_IF_FAIL regardless of policy.
  if (ALWAYS_ON[ruleId]) return 'AUTO_REJECT_IF_FAIL';

  const entry = rules?.[ruleId];
  // A disabled configurable rule contributes nothing (IGNORE).
  if (entry && entry.enabled === false) return 'IGNORE';
  if (entry?.mode) return entry.mode;
  return DEFAULT_MODE[ruleId] ?? 'IGNORE';
}

// =============================================================================
// SMALL PURE HELPERS
// =============================================================================

function overlaps(a: { start_at: string; end_at: string }, b: { start_at: string; end_at: string }): boolean {
  return a.start_at < b.end_at && b.start_at < a.end_at;
}

/** Roster excluding the shift being given away (matched by id). */
function rosterMinus<T extends { id: string }>(roster: T[], giveId: string): T[] {
  return roster.filter((s) => s.id !== giveId);
}

function diff(required: string[], held: Set<string>): string[] {
  return required.filter((c) => !held.has(c));
}

function setOf(xs: string[]): Set<string> {
  return new Set(xs);
}

function numParam(p: RulePolicy | undefined, key: string, dflt: number): number {
  const v = p?.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function strParam(p: RulePolicy | undefined, key: string, dflt: string): string {
  const v = p?.params?.[key];
  return typeof v === 'string' && v.length > 0 ? v : dflt;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
