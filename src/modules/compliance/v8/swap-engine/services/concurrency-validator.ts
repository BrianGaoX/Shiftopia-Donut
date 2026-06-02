/**
 * ConcurrencyValidator — Last-Mile Revalidation Before Commit
 *
 * Prevents race conditions where two concurrent approvals each pass their
 * individual compliance checks but violate constraints together.
 *
 * Example race:
 *   Manager A approves Swap X for Employee E at t=0  (compliant in isolation)
 *   Manager B approves Swap Y for Employee E at t=0  (compliant in isolation)
 *   Together: E's daily hours exceed 12h — both approvals passed, but the
 *   combined schedule is non-compliant.
 *
 * Solution (per PRD Feature 3):
 *   Immediately before committing a swap approval, rebuild the full scenario
 *   from the LATEST DB state (including all just-approved concurrent changes)
 *   and run the solver again.  Only commit if still feasible.
 *
 * Updated approval flow:
 *   1. Manager opens swap approval → compliance modal runs solver (UI check)
 *   2. Manager clicks approve
 *   3. validateBeforeCommit() → fresh DB fetch → solver rerun
 *   4. If still feasible → call sm_approve_peer_swap RPC
 *   5. If infeasible → surface error, manager must re-review
 *
 * Failure handling:
 *   If the validator rejects, throw a ConcurrencyValidationError.
 *   The API layer catches it and returns a structured error to the UI.
 */

import { swapEvaluator } from '../swap-evaluator';
import { getScenarioWindow }  from '../utils/scenario-window';
import { aggregateSchedules } from '../utils/schedule-aggregator';
import type { SolverResult } from '../types';
import { supabase } from '@/platform/realtime/client';

const db = supabase as any;

// =============================================================================
// TYPES
// =============================================================================

export interface ConcurrencyCheckInput {
    /** UUID of the requester employee. */
    requesterId:       string;
    /** UUID of the requester's shift (the one they are giving away). */
    requesterV8ShiftId:  string;
    /** UUID of the offerer employee. */
    offererId:         string;
    /** UUID of the offerer's shift (the one they are giving away). */
    offererV8ShiftId:    string;
    /**
     * Current swap request ID — used to exclude this swap from the concurrent-
     * swap guard so it doesn't block itself.
     */
    swapId?: string;
}

export interface ConcurrencyCheckResult {
    /** True when no blocking violations are found in the fresh scenario. */
    feasible:     boolean;
    /** Human-readable blocking violation summaries (for error messages). */
    violations:   string[];
    /** Full solver result for history record. */
    solverResult: SolverResult;
    /** ISO timestamp of the revalidation. */
    revalidatedAt: string;
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class ConcurrencyValidationError extends Error {
    constructor(
        public readonly result: ConcurrencyCheckResult,
    ) {
        const blockers = result.violations.join('; ');
        super(`Schedule changed since compliance check. Cannot approve: ${blockers}`);
        this.name = 'ConcurrencyValidationError';
    }
}

// =============================================================================
// VALIDATOR
// =============================================================================

/**
 * Re-fetch the latest schedule state for both swap parties and re-run the
 * constraint solver.  Should be called immediately before committing a swap.
 *
 * @param input  The two employees and their respective shifts.
 * @returns      ConcurrencyCheckResult — check `feasible` before proceeding.
 * @throws       ConcurrencyValidationError if infeasible (caller may re-throw).
 */
export async function validateBeforeCommit(
    input: ConcurrencyCheckInput,
): Promise<ConcurrencyCheckResult> {
    const t0 = performance.now();

    // ── 1. Fetch both shifts to get their dates / times ─────────────────────
    const { data: shiftRows, error: shiftErr } = await db
        .from('shifts')
        .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
        .in('id', [input.requesterV8ShiftId, input.offererV8ShiftId]);

    if (shiftErr || !shiftRows || shiftRows.length < 2) {
        throw new ConcurrencyValidationError({
            feasible: false,
            violations: ['One or both shifts could not be found in the database.'],
            solverResult: { feasible: false, violations: [], warnings: [], all_results: [], solve_time_ms: 0, scenario: null as any },
            revalidatedAt: new Date().toISOString(),
        });
    }

    const requesterShift = shiftRows.find((s: any) => s.id === input.requesterV8ShiftId);
    const offererShift   = shiftRows.find((s: any) => s.id === input.offererV8ShiftId);

    if (!requesterShift || !offererShift) {
        throw new ConcurrencyValidationError({
            feasible: false,
            violations: ['Could not resolve shift data for one or both parties.'],
            solverResult: { feasible: false, violations: [], warnings: [], all_results: [], solve_time_ms: 0, scenario: null as any },
            revalidatedAt: new Date().toISOString(),
        });
    }

    // ── 2. Calculate scenario window (±28 days from requester's shift date) ─
    const window = getScenarioWindow(requesterShift.shift_date);

    // ── 3. Aggregate FRESH schedules for both parties ───────────────────────
    //
    // aggregateSchedules fetches: Published + Draft + pending swap incoming shifts.
    // This is the latest DB state — any concurrent approvals are included.
    const scheduleMap = await aggregateSchedules(
        [input.requesterId, input.offererId],
        window,
    );

    const requesterSchedule = scheduleMap.get(input.requesterId) ?? [];
    const offererSchedule   = scheduleMap.get(input.offererId)   ?? [];

    // ── 4. Re-run the constraint solver ─────────────────────────────────────
    const toRosterShift = (s: any) => ({
        id:                   s.id ?? '__unknown__',
        date:                 s.shift_date ?? s.date ?? '',
        shift_date:           s.shift_date ?? s.date ?? '',
        start_time:           s.start_time,
        end_time:             s.end_time,
        is_ordinary_hours:    s.is_ordinary_hours ?? true,
        unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
    });

    const solverResult = swapEvaluator.evaluate({
        partyA: {
            employee_id:    input.requesterId,
            name:           'Requester',
            current_shifts: requesterSchedule.map(toRosterShift),
            shift_to_give:  toRosterShift(requesterShift),
        },
        partyB: {
            employee_id:    input.offererId,
            name:           'Offerer',
            current_shifts: offererSchedule.map(toRosterShift),
            shift_to_give:  toRosterShift(offererShift),
        },
    });

    const solveMs = Math.round(performance.now() - t0);

    // ── 5. Observability log ─────────────────────────────────────────────────
    console.info('[ConcurrencyValidator]', {
        action:           'swap',
        employees:        [input.requesterId, input.offererId],
        window_start:     window.start,
        window_end:       window.end,
        shifts_evaluated: requesterSchedule.length + offererSchedule.length,
        solve_time_ms:    solveMs,
        violations_count: solverResult.violations.length,
        feasible:         solverResult.feasible,
    });

    const violations = solverResult.violations
        .filter(v => v.blocking)
        .map(v => `[${v.employee_name}] ${v.summary}`);

    const checkResult: ConcurrencyCheckResult = {
        feasible:      solverResult.feasible,
        violations,
        solverResult,
        revalidatedAt: new Date().toISOString(),
    };

    if (!solverResult.feasible) {
        throw new ConcurrencyValidationError(checkResult);
    }

    return checkResult;
}
