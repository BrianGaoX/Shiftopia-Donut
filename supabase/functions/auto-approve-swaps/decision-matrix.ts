// =============================================================================
// auto-approve-swaps — Decision Matrix (PURE)
//
// Resolves the §2 core matrix + post-gates of
// docs/implementation/02-auto-approve-swaps.md into a single
// AUTO_APPROVE | MANUAL_REVIEW | AUTO_REJECT verdict.
//
// Aggregate resolution order is REJECT > REVIEW > APPROVE (02 §2.2).
//
// Pre-gates P1–P3 (kill-switch / shadow / not-pending) are owned by
// sm_swap_auto_decide and the worker's short-circuit — they are NOT re-decided
// here. This function assumes the swap IS pending and the policy IS enabled; it
// produces the would-be decision (which the RPC then commits or suppresses).
//
// FAIL CLOSED: any thrown/unexpected condition the caller catches must map to
// MANUAL_REVIEW, never AUTO_APPROVE. This module itself never throws on valid
// input and defaults ambiguity toward review.
//
// NO Deno / DB / browser imports — the project vitest loads it directly.
// =============================================================================

import type { DecisionInput, DecisionResult } from './types.ts';

export function decide(input: DecisionInput): DecisionResult {
  const { guards, solver, eligibility, policy, confidence, rateLimited } = input;

  // ── Core matrix, REJECT > REVIEW > APPROVE ─────────────────────────────────

  // 1. Guards fail (any GuardViolation) ⇒ AUTO_REJECT.
  //    Stale / drifted / locked / cancelled / concurrent (02 §2.2 row 1).
  if (!guards.passed) {
    return {
      decision: 'AUTO_REJECT',
      reason: `Pre-flight guard failure: ${guards.codes.join(', ') || 'GUARD_FAILED'}.`,
      confidence,
    };
  }

  // 2. Any reject-vote (always-on rule, REQUIRE_EQUAL, or AUTO_REJECT_IF_FAIL
  //    failure) ⇒ AUTO_REJECT (02 §2.2 rows 2–4).
  if (eligibility.rejectVotes.length > 0) {
    const ids = eligibility.rejectVotes.map((v) => v.ruleId).join(', ');
    return {
      decision: 'AUTO_REJECT',
      reason: `Eligibility hard-fail: ${ids}.`,
      confidence,
    };
  }

  // 3. Solver BLOCKING ⇒ AUTO_REJECT (labor-law breach, 02 §2.2 row 6).
  if (solver.verdict === 'BLOCKING' || !solver.feasible) {
    const blockers = solver.blocking
      .map((b) => `[${b.employee_name ?? '?'}] ${b.summary}`)
      .join('; ');
    return {
      decision: 'AUTO_REJECT',
      reason: `Solver blocking violation: ${blockers || 'compliance breach'}.`,
      confidence,
    };
  }

  // 4. A confirmed laundering cycle (≥3) is a hard reject post-gate (02 §4.5).
  //    (A 2-cycle "swap back" is only a downgrade → handled via rateLimited.)
  if (input.launderingCycle) {
    return {
      decision: 'AUTO_REJECT',
      reason: 'CIRCULAR_SWAP: laundering cycle detected.',
      confidence,
    };
  }

  // ── No reject-vote past this point. Now resolve REVIEW vs APPROVE. ──────────

  const reviewReasons: string[] = [];

  // 5. Any ROUTE_TO_REVIEW_IF_FAIL flagged ⇒ MANUAL_REVIEW (02 §2.2 row 5).
  if (eligibility.reviewVotes.length > 0) {
    reviewReasons.push(
      `Routed by rule(s): ${eligibility.reviewVotes.map((v) => v.ruleId).join(', ')}.`,
    );
  }

  // 6. Solver WARNING with auto_approve_warnings=false ⇒ MANUAL_REVIEW
  //    (02 §2.2 row 7, default-safe).
  if (solver.verdict === 'WARNING' && !policy.auto_approve_warnings) {
    reviewReasons.push('Solver WARNING and org has not opted into auto-approving warnings.');
  }

  // 7. Post-gate G1 (confidence): below the floor ⇒ MANUAL_REVIEW (02 §2.3).
  if (confidence < policy.confidence_min) {
    reviewReasons.push(
      `Confidence ${confidence.toFixed(2)} < min ${policy.confidence_min.toFixed(2)}.`,
    );
  }

  // 8. Post-gate G2/G3 (rate-limit / pairwise / 2-cycle abuse) ⇒ MANUAL_REVIEW.
  if (rateLimited) {
    reviewReasons.push('Abuse brake: rate-limit / pairwise / cycle downgrade.');
  }

  if (reviewReasons.length > 0) {
    return {
      decision: 'MANUAL_REVIEW',
      reason: reviewReasons.join(' '),
      confidence,
    };
  }

  // 9. Clean PASS (or opted-in WARNING) and all gates clear ⇒ AUTO_APPROVE.
  return {
    decision: 'AUTO_APPROVE',
    reason:
      solver.verdict === 'WARNING'
        ? 'Clean eligibility; solver WARNING accepted per policy; gates clear.'
        : 'Clean eligibility; solver PASS; all post-gates clear.',
    confidence,
  };
}
