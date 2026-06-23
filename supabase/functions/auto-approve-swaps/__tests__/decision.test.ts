// =============================================================================
// auto-approve-swaps — pure-module unit tests
//
// Covers (per the task / 02 §2–§3):
//   - every decision-matrix branch (guard fail, reject-vote, solver blocking,
//     laundering cycle, route-to-review, solver WARNING ±opt-in, confidence,
//     rate-limit, clean approve)
//   - every eligibility RuleMode (REQUIRE_EQUAL / AUTO_REJECT_IF_FAIL /
//     ROUTE_TO_REVIEW_IF_FAIL / IGNORE)
//   - always-on rules cannot be disabled (certification / fatigue / overlap)
//   - payroll-delta computation
//   - fail-closed semantics (unknown availability ⇒ unavailable; matrix never
//     emits AUTO_APPROVE under any reject/blocking signal)
//
// Run: npx vitest run --config supabase/functions/auto-approve-swaps/vitest.config.ts
// =============================================================================

import { describe, it, expect } from 'vitest';

import { decide } from '../decision-matrix.ts';
import {
  evaluateEligibility,
  effectiveMode,
  computePayrollDelta,
} from '../eligibility.ts';
import type {
  DecisionInput,
  EligibilityInput,
  EligibilityResult,
  EligParty,
  EligShift,
  RulePolicy,
} from '../types.ts';

// ── builders ─────────────────────────────────────────────────────────────────

function shift(over: Partial<EligShift> = {}): EligShift {
  return {
    id: over.id ?? 'rs',
    role_id: over.role_id ?? 'role-1',
    department_id: over.department_id ?? 'dep-1',
    sub_department_id: over.sub_department_id ?? 'sub-1',
    required_certs: over.required_certs ?? [],
    paid_minutes: over.paid_minutes ?? 480,
    hourly_rate: over.hourly_rate ?? 30,
    start_at: over.start_at ?? '2026-07-01T09:00:00Z',
    end_at: over.end_at ?? '2026-07-01T17:00:00Z',
    shift_date: over.shift_date ?? '2026-07-01',
  };
}

function party(over: Partial<EligParty> = {}): EligParty {
  return {
    employee_id: over.employee_id ?? 'emp',
    is_active: over.is_active ?? true,
    held_certs: over.held_certs ?? [],
    roster: over.roster ?? [],
    available_for_received: over.available_for_received ?? true,
  };
}

/** A clean two-party swap: identical role/location/duration/pay, certs held,
 *  available, no overlap, no solver issues. */
function cleanInput(): EligibilityInput {
  const rs = shift({ id: 'rs', start_at: '2026-07-01T09:00:00Z', end_at: '2026-07-01T17:00:00Z' });
  const os = shift({ id: 'os', start_at: '2026-07-02T09:00:00Z', end_at: '2026-07-02T17:00:00Z', shift_date: '2026-07-02' });
  return {
    requesterShift: rs,
    offeredShift: os,
    requester: party({ employee_id: 'A' }),
    offerer: party({ employee_id: 'B' }),
    solver: {
      fatigue_blocking: false,
      fatigue_hits: [],
      overtime_warning: false,
      overtime_hits: [],
      warning_count: 0,
    },
    coverageFloor: null,
    coverageBefore: null,
  };
}

function decisionInput(over: Partial<DecisionInput> = {}): DecisionInput {
  const elig: EligibilityResult = over.eligibility ?? {
    outcomes: [],
    rejectVotes: [],
    reviewVotes: [],
    payrollDelta: { requesterDeltaPerHour: 0, offererDeltaPerHour: 0, estCostDelta: 0 },
    confidence: 1,
    any_reject: false,
    any_review: false,
  };
  return {
    guards: over.guards ?? { passed: true, codes: [] },
    solver: over.solver ?? { feasible: true, verdict: 'PASS', blocking: [] },
    eligibility: elig,
    policy: over.policy ?? { auto_approve_warnings: false, confidence_min: 0.7 },
    confidence: over.confidence ?? 1,
    rateLimited: over.rateLimited ?? false,
    launderingCycle: over.launderingCycle,
  };
}

// =============================================================================
// DECISION MATRIX — every branch
// =============================================================================

describe('decision-matrix: core matrix', () => {
  it('clean PASS + all gates clear ⇒ AUTO_APPROVE', () => {
    expect(decide(decisionInput()).decision).toBe('AUTO_APPROVE');
  });

  it('guards fail ⇒ AUTO_REJECT (and never approve)', () => {
    const r = decide(decisionInput({ guards: { passed: false, codes: ['SCHEDULE_DRIFTED'] } }));
    expect(r.decision).toBe('AUTO_REJECT');
    expect(r.reason).toContain('SCHEDULE_DRIFTED');
  });

  it('any reject-vote ⇒ AUTO_REJECT', () => {
    const elig = decisionInput().eligibility;
    elig.rejectVotes = [{ ruleId: 'certification', status: 'fail', mode: 'AUTO_REJECT_IF_FAIL', detail: {} }];
    const r = decide(decisionInput({ eligibility: elig }));
    expect(r.decision).toBe('AUTO_REJECT');
    expect(r.reason).toContain('certification');
  });

  it('solver BLOCKING ⇒ AUTO_REJECT', () => {
    const r = decide(
      decisionInput({
        solver: { feasible: false, verdict: 'BLOCKING', blocking: [{ employee_name: 'A', summary: 'rest gap' }] },
      }),
    );
    expect(r.decision).toBe('AUTO_REJECT');
    expect(r.reason).toContain('rest gap');
  });

  it('solver infeasible (feasible=false) even if verdict not BLOCKING ⇒ AUTO_REJECT', () => {
    const r = decide(decisionInput({ solver: { feasible: false, verdict: 'PASS', blocking: [] } }));
    expect(r.decision).toBe('AUTO_REJECT');
  });

  it('laundering cycle (≥3) ⇒ AUTO_REJECT with CIRCULAR_SWAP', () => {
    const r = decide(decisionInput({ launderingCycle: true }));
    expect(r.decision).toBe('AUTO_REJECT');
    expect(r.reason).toContain('CIRCULAR_SWAP');
  });
});

describe('decision-matrix: review branches', () => {
  it('ROUTE_TO_REVIEW flagged ⇒ MANUAL_REVIEW', () => {
    const elig = decisionInput().eligibility;
    elig.reviewVotes = [{ ruleId: 'same_pay_rate', status: 'fail', mode: 'ROUTE_TO_REVIEW_IF_FAIL', detail: {} }];
    expect(decide(decisionInput({ eligibility: elig })).decision).toBe('MANUAL_REVIEW');
  });

  it('solver WARNING + auto_approve_warnings=false ⇒ MANUAL_REVIEW', () => {
    const r = decide(
      decisionInput({
        solver: { feasible: true, verdict: 'WARNING', blocking: [] },
        policy: { auto_approve_warnings: false, confidence_min: 0.7 },
      }),
    );
    expect(r.decision).toBe('MANUAL_REVIEW');
  });

  it('solver WARNING + auto_approve_warnings=true ⇒ AUTO_APPROVE', () => {
    const r = decide(
      decisionInput({
        solver: { feasible: true, verdict: 'WARNING', blocking: [] },
        policy: { auto_approve_warnings: true, confidence_min: 0.0 },
        confidence: 1,
      }),
    );
    expect(r.decision).toBe('AUTO_APPROVE');
  });

  it('confidence < min ⇒ MANUAL_REVIEW (post-gate G1)', () => {
    const r = decide(decisionInput({ confidence: 0.5, policy: { auto_approve_warnings: false, confidence_min: 0.7 } }));
    expect(r.decision).toBe('MANUAL_REVIEW');
    expect(r.reason).toContain('Confidence');
  });

  it('rateLimited ⇒ MANUAL_REVIEW (post-gate G2/G3)', () => {
    const r = decide(decisionInput({ rateLimited: true }));
    expect(r.decision).toBe('MANUAL_REVIEW');
    expect(r.reason).toContain('Abuse brake');
  });
});

describe('decision-matrix: precedence (REJECT > REVIEW > APPROVE)', () => {
  it('reject-vote beats a simultaneous review-vote', () => {
    const elig = decisionInput().eligibility;
    elig.rejectVotes = [{ ruleId: 'availability', status: 'fail', mode: 'AUTO_REJECT_IF_FAIL', detail: {} }];
    elig.reviewVotes = [{ ruleId: 'same_duration', status: 'fail', mode: 'ROUTE_TO_REVIEW_IF_FAIL', detail: {} }];
    expect(decide(decisionInput({ eligibility: elig, rateLimited: true })).decision).toBe('AUTO_REJECT');
  });

  it('never emits AUTO_APPROVE while rateLimited or low-confidence', () => {
    const r1 = decide(decisionInput({ rateLimited: true }));
    const r2 = decide(decisionInput({ confidence: 0.1 }));
    expect(r1.decision).not.toBe('AUTO_APPROVE');
    expect(r2.decision).not.toBe('AUTO_APPROVE');
  });
});

// =============================================================================
// ELIGIBILITY — modes
// =============================================================================

describe('eligibility: effectiveMode resolution', () => {
  it('REQUIRE_EQUAL default for same_role', () => {
    expect(effectiveMode('same_role', {})).toBe('REQUIRE_EQUAL');
  });
  it('ROUTE_TO_REVIEW_IF_FAIL default for same_pay_rate', () => {
    expect(effectiveMode('same_pay_rate', {})).toBe('ROUTE_TO_REVIEW_IF_FAIL');
  });
  it('AUTO_REJECT_IF_FAIL default for availability', () => {
    expect(effectiveMode('availability', {})).toBe('AUTO_REJECT_IF_FAIL');
  });
  it('policy mode override is honored for a configurable rule', () => {
    const rules: Record<string, RulePolicy> = { same_role: { mode: 'ROUTE_TO_REVIEW_IF_FAIL' } };
    expect(effectiveMode('same_role', rules)).toBe('ROUTE_TO_REVIEW_IF_FAIL');
  });
  it('disabled configurable rule ⇒ IGNORE', () => {
    const rules: Record<string, RulePolicy> = { same_role: { enabled: false } };
    expect(effectiveMode('same_role', rules)).toBe('IGNORE');
  });
});

describe('eligibility: each mode produces the right vote bucket', () => {
  it('REQUIRE_EQUAL failure (role mismatch) ⇒ rejectVote', () => {
    const input = cleanInput();
    input.offeredShift!.role_id = 'role-2';
    const r = evaluateEligibility(input, {});
    expect(r.rejectVotes.some((v) => v.ruleId === 'same_role')).toBe(true);
    expect(r.any_reject).toBe(true);
  });

  it('AUTO_REJECT_IF_FAIL failure (availability) ⇒ rejectVote', () => {
    const input = cleanInput();
    input.requester.available_for_received = false;
    const r = evaluateEligibility(input, {});
    expect(r.rejectVotes.some((v) => v.ruleId === 'availability')).toBe(true);
  });

  it('ROUTE_TO_REVIEW_IF_FAIL failure (duration > tol) ⇒ reviewVote', () => {
    const input = cleanInput();
    input.offeredShift!.paid_minutes = 480 + 120; // +2h, default tol 30m
    const r = evaluateEligibility(input, {});
    expect(r.reviewVotes.some((v) => v.ruleId === 'same_duration')).toBe(true);
    expect(r.any_review).toBe(true);
  });

  it('IGNORE mode failure contributes NO vote', () => {
    const input = cleanInput();
    input.offeredShift!.paid_minutes = 999;
    const rules: Record<string, RulePolicy> = { same_duration: { mode: 'IGNORE' } };
    const r = evaluateEligibility(input, rules);
    expect(r.reviewVotes.some((v) => v.ruleId === 'same_duration')).toBe(false);
    expect(r.rejectVotes.some((v) => v.ruleId === 'same_duration')).toBe(false);
  });

  it('clean swap ⇒ no votes, confidence 1.0', () => {
    const r = evaluateEligibility(cleanInput(), {});
    expect(r.any_reject).toBe(false);
    expect(r.any_review).toBe(false);
    expect(r.confidence).toBe(1);
  });
});

// =============================================================================
// ELIGIBILITY — ALWAYS-ON rules cannot be disabled
// =============================================================================

describe('eligibility: always-on rules cannot be configured away', () => {
  it('certification stays AUTO_REJECT_IF_FAIL even with enabled:false + IGNORE', () => {
    const input = cleanInput();
    input.offeredShift!.required_certs = ['FORKLIFT']; // requester does NOT hold it
    const rules: Record<string, RulePolicy> = {
      certification: { enabled: false, mode: 'IGNORE' },
    };
    const r = evaluateEligibility(input, rules);
    const cert = r.outcomes.find((o) => o.ruleId === 'certification')!;
    expect(cert.mode).toBe('AUTO_REJECT_IF_FAIL');
    expect(cert.status).toBe('fail');
    expect(r.rejectVotes.some((v) => v.ruleId === 'certification')).toBe(true);
  });

  it('fatigue stays AUTO_REJECT_IF_FAIL even when policy tries IGNORE', () => {
    const input = cleanInput();
    input.solver.fatigue_blocking = true;
    input.solver.fatigue_hits = ['V8_MIN_REST_GAP'];
    const r = evaluateEligibility(input, { fatigue: { mode: 'IGNORE', enabled: false } });
    expect(r.rejectVotes.some((v) => v.ruleId === 'fatigue')).toBe(true);
  });

  it('overlap stays AUTO_REJECT_IF_FAIL even when policy tries to relax it', () => {
    const input = cleanInput();
    // Give the requester an existing shift that overlaps the offered shift window.
    input.requester.roster = [
      { id: 'x', start_at: '2026-07-02T10:00:00Z', end_at: '2026-07-02T18:00:00Z' },
    ];
    const r = evaluateEligibility(input, { overlap: { mode: 'ROUTE_TO_REVIEW_IF_FAIL' } });
    const overlap = r.outcomes.find((o) => o.ruleId === 'overlap')!;
    expect(overlap.mode).toBe('AUTO_REJECT_IF_FAIL');
    expect(overlap.status).toBe('fail');
    expect(r.rejectVotes.some((v) => v.ruleId === 'overlap')).toBe(true);
  });
});

// =============================================================================
// ELIGIBILITY — fail-closed (unknown availability ⇒ unavailable)
// =============================================================================

describe('eligibility: fail-closed', () => {
  it('null availability is treated as UNAVAILABLE (reject)', () => {
    const input = cleanInput();
    input.requester.available_for_received = null;
    const r = evaluateEligibility(input, {});
    expect(r.rejectVotes.some((v) => v.ruleId === 'availability')).toBe(true);
  });

  it('inactive incoming worker fails availability', () => {
    const input = cleanInput();
    input.offerer!.is_active = false;
    const r = evaluateEligibility(input, {});
    expect(r.rejectVotes.some((v) => v.ruleId === 'availability')).toBe(true);
  });
});

// =============================================================================
// ELIGIBILITY — confidence
// =============================================================================

describe('eligibility: confidence (§3.11)', () => {
  it('−0.15 per route flag, −0.25 per solver warning, floored at 0', () => {
    const input = cleanInput();
    input.offeredShift!.paid_minutes = 999; // 1 route flag (duration)
    input.solver.warning_count = 1; // 1 solver warning
    const r = evaluateEligibility(input, {});
    expect(r.confidence).toBeCloseTo(1 - 0.15 - 0.25, 5);
  });

  it('confidence never goes below 0', () => {
    const input = cleanInput();
    input.solver.warning_count = 10;
    const r = evaluateEligibility(input, {});
    expect(r.confidence).toBe(0);
  });
});

// =============================================================================
// PAYROLL DELTA (§3.4)
// =============================================================================

describe('payroll delta', () => {
  it('per-hour deltas are equal/opposite; org cost neutral on same-duration swap', () => {
    const rs = shift({ hourly_rate: 30, paid_minutes: 480 });
    const os = shift({ hourly_rate: 40, paid_minutes: 480 });
    const d = computePayrollDelta(rs, os);
    expect(d.requesterDeltaPerHour).toBe(10); // earns Os(40) instead of Rs(30)
    expect(d.offererDeltaPerHour).toBe(-10);
    expect(d.estCostDelta).toBe(0);
  });

  it('always computed (and surfaced) even when pay-rate rule passes', () => {
    const input = cleanInput();
    input.requesterShift.hourly_rate = 25;
    input.offeredShift!.hourly_rate = 25; // equal ⇒ same_pay_rate passes
    const r = evaluateEligibility(input, {});
    expect(r.outcomes.find((o) => o.ruleId === 'same_pay_rate')!.status).toBe('pass');
    expect(r.payrollDelta).toBeDefined();
    expect(r.payrollDelta.requesterDeltaPerHour).toBe(0);
  });

  it('giveaway (no offered shift): requester picks up nothing, offerer gains Rs rate', () => {
    const rs = shift({ hourly_rate: 30, paid_minutes: 480 });
    const d = computePayrollDelta(rs, null);
    expect(d.requesterDeltaPerHour).toBe(-30); // gives up Rs rate, receives 0
    expect(d.offererDeltaPerHour).toBe(30);
  });
});

// =============================================================================
// END-TO-END: eligibility → matrix
// =============================================================================

describe('end-to-end: eligibility feeds the matrix', () => {
  it('clean swap flows to AUTO_APPROVE', () => {
    const elig = evaluateEligibility(cleanInput(), {});
    const r = decide(
      decisionInput({
        eligibility: elig,
        confidence: elig.confidence,
        policy: { auto_approve_warnings: false, confidence_min: 0.7 },
      }),
    );
    expect(r.decision).toBe('AUTO_APPROVE');
  });

  it('uncertified pickup flows to AUTO_REJECT (closes audit gap F-5)', () => {
    const input = cleanInput();
    input.offeredShift!.required_certs = ['RSA'];
    const elig = evaluateEligibility(input, { certification: { enabled: false, mode: 'IGNORE' } });
    const r = decide(decisionInput({ eligibility: elig, confidence: elig.confidence }));
    expect(r.decision).toBe('AUTO_REJECT');
  });
});
