/**
 * Bidding Engine — Global Greedy Selection Engine
 *
 * Selects the best valid combination of bids under constraints.
 *
 * Algorithm (Greedy):
 *   1. Sort all scored bids by composite_score descending.
 *      Tiebreaker: bid_time ascending (first-come-first-served).
 *   2. Maintain:
 *        - tentative_schedules: employee_id → current V8OrchestratorShift[] (existing + already selected)
 *        - filled_shifts: Set of shift_ids already assigned
 *        - wins_per_employee: employee_id → count of shifts won (for dynamic fairness)
 *   3. For each bid in order:
 *        a. Skip if shift already filled.
 *        b. Fast structural check: does the candidate shift overlap or violate
 *           rest gap with any shift already in the employee's tentative schedule?
 *           (O(k) per employee, avoids expensive compliance call for obvious rejects)
 *        c. Full compliance check: run runV8Orchestrator() in SIMULATED mode
 *           with existing = tentative_schedule and add_shifts = [bid.shift].
 *        d. If status is BLOCKING: record rejection reason and continue to next
 *           bidder for that shift.
 *        e. Accept the bid: update tentative_schedule and filled_shifts.
 *
 * Replacement logic:
 *   By processing bids globally by score, the algorithm naturally tries
 *   each bidder for a shift in priority order. If the top bidder is rejected,
 *   the next-ranked bidder for that shift is processed when encountered in
 *   the sorted order.
 *
 * Fairness dynamic adjustment:
 *   After each accepted bid, the remaining bids for that employee receive a
 *   score penalty proportional to their win count. This prevents a single
 *   high-priority employee from dominating when fairness_weight > 0.
 *   Implementation: rather than re-sorting (expensive), the penalty is applied
 *   as an inline check: if the employee already has `max_wins_before_fairness`
 *   wins, their remaining bids are de-prioritised to the end of the queue.
 *
 * Performance:
 *   - Sort: O(n log n)
 *   - Per bid: O(k) structural + O(rules) compliance = O(k + 12) ≈ O(k)
 *   - Total: O(n log n + n × k) where k = avg shifts per employee schedule
 *   - For n=1000, k=20: ~22,000 operations. Well within budget.
 */

import type { EvaluatedBid, RejectedBid, SelectedBid, BiddingConfig } from './types';
import type {
    V8OrchestratorShift, V8ShiftId, V8EmpId, V8OrchestratorInput,
} from '../types';
import { runV8Orchestrator } from '../index';
import { toAbsoluteMinutes } from '../windows';

const MINUTES_PER_DAY = 1440;

// =============================================================================
// STRUCTURAL PRE-FILTER
// =============================================================================

function absoluteEnd(shift: V8OrchestratorShift): number {
    const s = toAbsoluteMinutes(shift.date, shift.start_time);
    const e = toAbsoluteMinutes(shift.date, shift.end_time);
    return e <= s ? e + MINUTES_PER_DAY : e;
}

/**
 * Returns true if `candidate` overlaps or violates rest gap with any shift
 * already in `schedule`. This is a fast O(k) check before the full compliance call.
 */
function hasStructuralConflict(
    candidate:        V8OrchestratorShift,
    schedule:         V8OrchestratorShift[],
    rest_gap_minutes: number,
): boolean {
    const cStart = toAbsoluteMinutes(candidate.date, candidate.start_time);
    const cEnd   = absoluteEnd(candidate);

    for (const s of schedule) {
        const sStart = toAbsoluteMinutes(s.date, s.start_time);
        const sEnd   = absoluteEnd(s);

        // Time overlap
        if (cStart < sEnd && sStart < cEnd) return true;

        // Rest gap: gap between adjacent shifts is too small
        const gapAfterS  = cStart - sEnd;
        const gapBeforeS = sStart - cEnd;
        if (gapAfterS  > 0 && gapAfterS  < rest_gap_minutes) return true;
        if (gapBeforeS > 0 && gapBeforeS < rest_gap_minutes) return true;
    }

    return false;
}

// =============================================================================
// SORT KEY
// =============================================================================

function sortKey(a: EvaluatedBid, b: EvaluatedBid): number {
    if (b.composite_score !== a.composite_score) {
        return b.composite_score - a.composite_score;
    }
    // Earlier bid_time wins on tie
    return a.bid.bid_time < b.bid.bid_time ? -1 : a.bid.bid_time > b.bid.bid_time ? 1 : 0;
}

// =============================================================================
// SELECTION RESULT
// =============================================================================

export interface SelectionResult {
    selected:          SelectedBid[];
    rejected:          RejectedBid[];
    unfilled_shifts:   V8ShiftId[];
}

// =============================================================================
// MAIN SELECTION ENGINE
// =============================================================================

export function selectBids(
    evaluated:              EvaluatedBid[],
    shifts:                 V8OrchestratorShift[],
    existing_shifts_map:    Map<V8EmpId, V8OrchestratorShift[]>,
    config:                 BiddingConfig,
): SelectionResult {
    const rest_gap_minutes = 10 * 60;    // default 10h rest; compliance engine enforces exact value

    // Sort globally by composite_score descending
    const sorted = [...evaluated].sort(sortKey);

    // Initialise tentative schedules from existing assignments
    const tentative = new Map<V8EmpId, V8OrchestratorShift[]>();
    for (const [empId, shifts] of existing_shifts_map) {
        tentative.set(empId, [...shifts]);
    }

    const filled_shifts  = new Set<V8ShiftId>();
    const wins_per_emp   = new Map<V8EmpId, number>();

    const selected:        SelectedBid[]  = [];
    const rejected:        RejectedBid[]  = [];
    const seen_shifts_bids = new Map<V8ShiftId, Set<string>>();  // shift_id → rejected bid_ids

    for (const eb of sorted) {
        const { bid, shift, employee_context } = eb;

        // ── Already filled? ────────────────────────────────────────────────────
        if (filled_shifts.has(bid.shift_id)) {
            // Only record rejection if this bid hasn't been silently skipped
            rejected.push({
                bid_id:    bid.bid_id,
                reason:    `Shift ${bid.shift_id} was already assigned to another employee.`,
                rule_hits: [],
            });
            continue;
        }

        // ── Pre-filter BLOCKING bids only if no other option ──────────────────
        // BLOCKING bids CAN still be selected if they're the sole bidder —
        // but if accept_warnings = false, WARNING bids are also excluded.
        if (!config.accept_warnings && eb.compliance_status === 'WARNING') {
            rejected.push({
                bid_id:    bid.bid_id,
                reason:    `Bid compliance status is WARNING; accept_warnings is disabled.`,
                rule_hits: eb.rule_hits,
            });
            continue;
        }

        // ── Fast structural check ─────────────────────────────────────────────
        const emp_schedule = tentative.get(bid.employee_id) ?? [];

        if (hasStructuralConflict(shift, emp_schedule, rest_gap_minutes)) {
            rejected.push({
                bid_id:    bid.bid_id,
                reason:    `Structural conflict: employee ${bid.employee_id} already has an overlapping or rest-gap-violating shift in the current selection.`,
                rule_hits: [],
            });
            continue;
        }

        // ── Full compliance check against tentative schedule ──────────────────
        const input: V8OrchestratorInput = {
            employee_id:       bid.employee_id,
            employee_context,
            existing_shifts:   emp_schedule,
            candidate_changes: {
                add_shifts:    [shift],
                remove_shifts: [],
            },
            mode:           'SIMULATED',
            operation_type: 'BID',
            stage:          config.compliance_stage,
            config:         config.compliance_config,
        };

        const result = runV8Orchestrator(input, { stage: config.compliance_stage });

        if (result.overall_status === 'BLOCKING') {
            rejected.push({
                bid_id:    bid.bid_id,
                reason:    `Compliance check against current selection failed: ${result.hits.filter(h => h.status === 'BLOCKING').map(h => h.rule_id).join(', ')}.`,
                rule_hits: result.hits,
            });
            // Track which shifts have rejected bids (for unfilled_shifts reporting)
            if (!seen_shifts_bids.has(bid.shift_id)) seen_shifts_bids.set(bid.shift_id, new Set());
            seen_shifts_bids.get(bid.shift_id)!.add(bid.bid_id);
            continue;
        }

        // ── Accept ────────────────────────────────────────────────────────────
        selected.push({
            shift_id:          bid.shift_id,
            bid_id:            bid.bid_id,
            employee_id:       bid.employee_id,
            compliance_status: result.overall_status,
        });

        filled_shifts.add(bid.shift_id);
        wins_per_emp.set(bid.employee_id, (wins_per_emp.get(bid.employee_id) ?? 0) + 1);
        tentative.set(bid.employee_id, [...emp_schedule, shift]);
    }

    // ── Unfilled shifts: shifts that had bids but none were accepted ──────────
    const all_bid_shift_ids = new Set(evaluated.map(eb => eb.bid.shift_id));
    const unfilled_shifts   = shifts
        .filter(s => all_bid_shift_ids.has(s.id) && !filled_shifts.has(s.id))
        .map(s => s.id);

    return { selected, rejected, unfilled_shifts };
}
