/**
 * Two-Way Swap Engine — Final Validation Pass
 *
 * Runs AFTER the per-swap decision logic has produced an initial
 * approved set. This is the safety net.
 *
 * Why a second pass is needed:
 *   The per-swap compliance checker evaluates each swap independently
 *   against the employee's ORIGINAL schedule. When an employee participates
 *   in multiple approved swaps (rare but possible), the COMBINED effect of
 *   all swaps may produce violations that weren't visible individually:
 *
 *     Swap_1: A gives shift_X, receives shift_Y  → PASS individually
 *     Swap_2: A gives shift_Z, receives shift_W  → PASS individually
 *     Combined: A's total hours exceed the daily/weekly limit → BLOCKING
 *
 * Algorithm:
 *   1. For each affected employee, collect ALL approved swaps they participate in.
 *   2. Build their complete FINAL schedule by applying all approved swaps:
 *        final = original − {all shifts given} + {all shifts received}
 *   3. Run compliance on the complete final schedule.
 *   4. If BLOCKING: iteratively demote the LOWEST-priority approved swap for
 *      that employee until the compliance check clears or no swaps remain.
 *   5. Demoted swaps are added to the rejected list.
 *
 * Performance:
 *   O(employees × swaps_per_employee) for state construction, then one
 *   compliance call per employee per demotion step. Bounded by swap count.
 */

import type {
    ApprovedSwap,
    RejectedSwap,
    SwapConfig,
} from './types';
import type {
    V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext,
} from '../types';
import { validateV8State } from '../validate-combined-state';

// =============================================================================
// RESULT
// =============================================================================

export interface FinalValidationResult {
    final_approved: ApprovedSwap[];
    demoted:        RejectedSwap[];
    /** true when all approved swaps are compliance-clean in their final combined state */
    all_clean:      boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build the final schedule for an employee after all their approved swaps
 * are applied simultaneously.
 */
function buildFinalSchedule(
    employee_id:       V8EmpId,
    original_shifts:   V8OrchestratorShift[],
    approved_swaps:    ApprovedSwap[],
    shift_catalog:     Map<V8ShiftId, V8OrchestratorShift>,
): { final_shifts: V8OrchestratorShift[]; added: V8OrchestratorShift[]; removed: V8ShiftId[] } {
    const removed = new Set<V8ShiftId>();
    const added: V8OrchestratorShift[] = [];

    for (const swap of approved_swaps) {
        if (swap.employee_a_id === employee_id) {
            removed.add(swap.shift_x_id);    // A gives shift_X
            const received = shift_catalog.get(swap.shift_y_id);
            if (received) added.push(received);
        }
        if (swap.employee_b_id === employee_id) {
            removed.add(swap.shift_y_id);    // B gives shift_Y
            const received = shift_catalog.get(swap.shift_x_id);
            if (received) added.push(received);
        }
    }

    const final_shifts = [
        ...original_shifts.filter(s => !removed.has(s.id)),
        ...added,
    ];

    return { final_shifts, added, removed: [...removed] };
}

// =============================================================================
// MAIN FINAL VALIDATOR
// =============================================================================

export function finalValidateSwaps(
    approved:            ApprovedSwap[],
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>,
    employee_catalog:    Map<V8EmpId, V8EmployeeContext>,
    shift_catalog:       Map<V8ShiftId, V8OrchestratorShift>,
    config:              SwapConfig,
): FinalValidationResult {
    // Mutable working set — we may demote swaps during this pass
    let working_approved = [...approved];
    const demoted: RejectedSwap[] = [];

    // Collect all affected employees
    const affected_employees = new Set<V8EmpId>(
        approved.flatMap(s => [s.employee_a_id, s.employee_b_id]),
    );

    // Repeat until stable (or until we've tried n times where n = approved.length)
    let changed = true;
    let safety  = 0;

    while (changed && safety++ < approved.length + 1) {
        changed = false;

        for (const emp_id of affected_employees) {
            const employee_context = employee_catalog.get(emp_id);
            if (!employee_context) continue;

            const original_shifts = existing_shifts_map.get(emp_id) ?? [];

            // Swaps involving this employee that are still in working_approved
            const emp_swaps = working_approved.filter(
                s => s.employee_a_id === emp_id || s.employee_b_id === emp_id,
            );

            if (emp_swaps.length === 0) continue;

            // Build the complete final schedule for this employee
            const { added, removed } = buildFinalSchedule(
                emp_id, original_shifts, emp_swaps, shift_catalog,
            );

            const result = validateV8State({
                employee_id:      emp_id,
                employee_context,
                original_shifts,
                add_shifts:       added,
                remove_shift_ids: removed,
                operation_type:   'SWAP',
                stage:            config.compliance_stage,
                config:           config.compliance_config,
            });

            if (result.overall_status !== 'BLOCKING') continue;    // clean — no action needed

            // BLOCKING: demote the lowest-priority swap for this employee.
            // Sort order (ascending = demoted first):
            //   1. compliance_status rank: BLOCKING/WARNING (0) before PASS (1) — weakest first
            //   2. original_priority ascending: lower priority swaps go first
            //   3. swap_id lexicographic: stable deterministic tie-break
            const statusRank = (s: ApprovedSwap) =>
                s.compliance_status === 'PASS' ? 1 : 0;

            const to_demote = [...emp_swaps].sort((a, b) => {
                const sr = statusRank(a) - statusRank(b);
                if (sr !== 0) return sr;
                const pr = a.original_priority - b.original_priority;
                if (pr !== 0) return pr;
                return a.swap_id < b.swap_id ? -1 : 1;
            })[0];

            if (!to_demote) break;

            demoted.push({
                swap_id:     to_demote.swap_id,
                reason:
                    `Final validation: employee ${emp_id} has BLOCKING compliance violations when `
                    + `all approved swaps are combined. Swap demoted. Violations: `
                    + result.hits.filter(h => h.status === 'BLOCKING').map(h => h.rule_id).join(', '),
                rule_hits_a: result.hits,
                rule_hits_b: [],
            });

            working_approved = working_approved.filter(s => s.swap_id !== to_demote.swap_id);
            changed = true;
            break;    // restart the employee loop after each demotion
        }
    }

    return {
        final_approved: working_approved,
        demoted,
        all_clean: demoted.length === 0,
    };
}
