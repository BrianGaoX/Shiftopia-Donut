/**
 * Assignment Evaluator — Single-Party Constraint Solver (Layer 4)
 *
 * Extends the constraint solver pattern to single-party actions:
 *   - add    (manager adds a new shift)
 *   - assign (manager assigns a shift to an employee)
 *   - bid    (employee bids on an open shift)
 *
 * Uses the SAME V8SwapEngine and constraints as SwapEvaluator.
 * This is the Google OR-Tools CP-SAT analog for single-party feasibility:
 *   "Does a compliant schedule exist if the employee takes on this shift?"
 *
 * Architecture (same 4 layers as SwapEvaluator):
 *   1. Build hypothetical schedule: current_shifts + candidate_shift
 *   2. Create single-party SwapScenario (partyB is a dummy that always passes)
 *   3. V8SwapEngine evaluates ALL constraints simultaneously
 *   4. Filter result to only the employee's violations
 *
 * Replaces the old sequential runRule() loop in:
 *   - useComplianceRunner.ts  (assignment / add flows)
 *   - BidComplianceModal.tsx  (bidding flow)
 */

import { V8SwapEngine } from './constraint-engine';
import type {
    SwapScenario,
    SwapParty,
    RosterShift,
    SolverConfig,
    SolverResult,
} from './types';
import type { ComplianceResult, ComplianceCalculation } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface AssignmentEvaluationInput {
    employee_id: string;
    name: string;
    /** Full roster for ±30 days around the candidate shift date. */
    current_shifts: RosterShift[];
    /** The shift being added / assigned / bid on. */
    candidate_shift: RosterShift;
    /**
     * Workflow context — passed to SolverConfig so constraints self-select.
     *   'bid'    → WORKING_DAYS_CAP self-excludes (expressions of interest,
     *              not confirmed assignments — no day counts against the cap yet)
     *   'add'    → all constraints apply
     *   'assign' → all constraints apply
     */
    action_type: 'add' | 'assign' | 'bid';
    /** Optional solver overrides (rest gap, student visa enforcement, etc.). */
    config?: SolverConfig;
}

// =============================================================================
// DUMMY PARTY (always passes every constraint — empty schedule)
// =============================================================================

const DUMMY_SHIFT: RosterShift = {
    id: '__dummy__',
    date: '1970-01-01',
    shift_date: '1970-01-01',
    start_time: '00:00',
    end_time: '00:00',
    is_ordinary_hours: false,
    unpaid_break_minutes: 0,
};

const DUMMY_PARTY_B: SwapParty = {
    employee_id: '__assignment_dummy__',
    name: '__dummy__',
    hypothetical_schedule: [],
    received_shift: DUMMY_SHIFT,
    given_shift: DUMMY_SHIFT,
};

// =============================================================================
// ADAPTER: SolverResult (single-party) → Record<string, ComplianceResult>
// =============================================================================

/**
 * Converts a single-party SolverResult to the ComplianceResult map expected
 * by ComplianceTabContent and other UI components.
 *
 * Only includes results for the specified employee — dummy partyB is excluded.
 */
export function assignmentResultToComplianceResults(
    result: SolverResult,
    employeeId: string,
): Record<string, ComplianceResult> {
    const map: Record<string, ComplianceResult> = {};

    for (const r of result.all_results) {
        if (r.employee_id !== employeeId) continue;

        map[r.constraint_id] = {
            rule_id:   r.constraint_id,
            rule_name: r.constraint_name,
            status:    r.status,
            summary:   r.summary,
            details:   r.details,
            blocking:  r.blocking,
            calculation: {
                existing_hours:   0,
                candidate_hours:  0,
                total_hours:      0,
                limit:            0,
                ...(r.calculation as Record<string, unknown>),
            } as ComplianceCalculation,
        };
    }

    return map;
}

// =============================================================================
// EVALUATOR
// =============================================================================

const engine = new V8SwapEngine();

export class AssignmentEvaluator {
    /**
     * Evaluate whether the assignment / bid is compliant for the employee.
     *
     * Steps:
     *   1. Build partyA's hypothetical schedule: current_shifts + candidate_shift
     *   2. Create SwapScenario with a dummy partyB (empty schedule → always passes)
     *   3. Run ALL constraints simultaneously against the scenario
     *   4. Filter result to only the employee's violations
     *
     * Average solve time: < 5ms (pure in-memory calculation).
     */
    evaluate(input: AssignmentEvaluationInput): SolverResult {
        // ── Layer 1: Build hypothetical schedule ────────────────────────────
        const hypotheticalSchedule: RosterShift[] = [
            ...input.current_shifts,
            input.candidate_shift,
        ];

        const partyA: SwapParty = {
            employee_id: input.employee_id,
            name: input.name,
            hypothetical_schedule: hypotheticalSchedule,
            received_shift: input.candidate_shift,  // The new shift being added
            given_shift: DUMMY_SHIFT,               // Nothing is given up
        };

        const scenario: SwapScenario = {
            partyA,
            partyB: DUMMY_PARTY_B,
        };

        // ── Layer 2: Config — pass action_type so constraints self-select ────
        //
        // WorkingDaysCapConstraint checks config.action_type and returns a
        // passing result for 'bid' (bids are expressions of interest, not
        // confirmed assignments — no day counts against the rolling 28-day cap).
        // All other constraints still apply (rest gaps, hours, visa, overlap).
        const config: SolverConfig = {
            ...input.config,
            action_type: input.action_type,
        };

        // ── Layer 3: Evaluate ALL constraints simultaneously ─────────────────
        const fullResult = engine.evaluate(scenario, config);

        // ── Layer 4: Filter to only this employee's violations ────────────────
        return this._filterToEmployee(fullResult, input.employee_id);
    }

    /**
     * Returns a SolverResult containing ONLY violations for the specified
     * employee. The dummy partyB results are stripped out.
     */
    private _filterToEmployee(result: SolverResult, employeeId: string): SolverResult {
        const employeeResults = result.all_results.filter(
            r => r.employee_id === employeeId,
        );
        const violations       = employeeResults.filter(r => r.status === 'fail');
        const warnings         = employeeResults.filter(r => r.status === 'warning');
        const blockingViolations = violations.filter(r => r.blocking);

        return {
            feasible:      blockingViolations.length === 0,
            violations,
            warnings,
            all_results:   employeeResults,
            solve_time_ms: result.solve_time_ms ?? 0,
            scenario:      result.scenario,
        };
    }
}

/** Singleton evaluator — use this directly in components and hooks. */
export const assignmentEvaluator = new AssignmentEvaluator();
