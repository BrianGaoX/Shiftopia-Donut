/**
 * Two-Way Swap Engine — Structural Validator
 *
 * Performs all structural checks BEFORE any compliance evaluation.
 * Fails fast — invalid swaps never enter the simulation pipeline.
 *
 * Checks (per swap):
 *   1. Both employees exist in the employee catalog
 *   2. Both shifts exist in the shift catalog
 *   3. employee_a_id ≠ employee_b_id (can't swap with yourself)
 *   4. shift_x_id ≠ shift_y_id (can't swap a shift with itself)
 *   5. shift_X is currently assigned to employee_A
 *   6. shift_Y is currently assigned to employee_B
 *   7. shift_X is not already committed in a previously seen swap
 *      (duplicate detection within this batch — handled by conflict-resolver,
 *       not here; here we only reject structurally impossible swaps)
 *
 * Note on duplicate detection:
 *   Two different swaps that reference the same shift (e.g. A gives X in swap_1
 *   and A gives X in swap_2) are structurally valid individually but logically
 *   conflicting. That case is handled by the InterSwapConflict resolver.
 */

import type {
    SwapRequest,
    StructuralError,
    StructuralValidationResult,
} from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext } from '../types';

// =============================================================================
// MAIN VALIDATOR
// =============================================================================

export function validateStructure(
    swaps:             SwapRequest[],
    shift_catalog:     Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:  Map<V8EmpId, V8EmployeeContext>,
    /** employee_id → set of shift_ids they currently own */
    ownership_index:   Map<V8EmpId, Set<V8ShiftId>>,
): StructuralValidationResult {
    const valid:   SwapRequest[]     = [];
    const invalid: StructuralError[] = [];

    for (const swap of swaps) {
        const error = checkSwap(swap, shift_catalog, employee_catalog, ownership_index);
        if (error) {
            invalid.push({ swap_id: swap.swap_id, reason: error });
        } else {
            valid.push(swap);
        }
    }

    return { valid, invalid };
}

// =============================================================================
// PER-SWAP CHECKS
// =============================================================================

function checkSwap(
    swap:             SwapRequest,
    shift_catalog:    Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog: Map<V8EmpId, V8EmployeeContext>,
    ownership_index:  Map<V8EmpId, Set<V8ShiftId>>,
): string | null {
    const { employee_a_id, employee_b_id, shift_x_id, shift_y_id } = swap;

    // 1. Self-swap guard
    if (employee_a_id === employee_b_id) {
        return `employee_a_id and employee_b_id are the same (${employee_a_id}). Self-swaps are not allowed.`;
    }

    // 2. Same-shift guard
    if (shift_x_id === shift_y_id) {
        return `shift_x_id and shift_y_id are the same (${shift_x_id}). A shift cannot be swapped with itself.`;
    }

    // 3. Employee existence
    if (!employee_catalog.has(employee_a_id)) {
        return `Employee A (${employee_a_id}) not found in the employee catalog.`;
    }
    if (!employee_catalog.has(employee_b_id)) {
        return `Employee B (${employee_b_id}) not found in the employee catalog.`;
    }

    // 4. Shift existence
    if (!shift_catalog.has(shift_x_id)) {
        return `Shift X (${shift_x_id}) not found in the shift catalog.`;
    }
    if (!shift_catalog.has(shift_y_id)) {
        return `Shift Y (${shift_y_id}) not found in the shift catalog.`;
    }

    // 5. Ownership: shift_X must belong to employee_A
    const a_shifts = ownership_index.get(employee_a_id);
    if (!a_shifts?.has(shift_x_id)) {
        return `Shift X (${shift_x_id}) is not currently assigned to employee A (${employee_a_id}). Cannot swap a shift you don't own.`;
    }

    // 6. Ownership: shift_Y must belong to employee_B
    const b_shifts = ownership_index.get(employee_b_id);
    if (!b_shifts?.has(shift_y_id)) {
        return `Shift Y (${shift_y_id}) is not currently assigned to employee B (${employee_b_id}). Cannot swap a shift you don't own.`;
    }

    return null;    // all checks passed
}

// =============================================================================
// CATALOG / INDEX BUILDERS  (helpers for the orchestrator)
// =============================================================================

export function buildShiftCatalog(
    all_shifts: V8OrchestratorShift[],
): Map<V8ShiftId, V8OrchestratorShift> {
    return new Map(all_shifts.map(s => [s.id, s]));
}

export function buildEmployeeCatalog(
    employees: V8EmployeeContext[],
): Map<V8EmpId, V8EmployeeContext> {
    return new Map(employees.map(e => [e.employee_id, e]));
}

/**
 * Builds an ownership index: employee_id → Set<shift_id>.
 * Used for O(1) shift-ownership checks.
 */
export function buildOwnershipIndex(
    assignments: { employee_id: V8EmpId; shifts: V8OrchestratorShift[] }[],
): Map<V8EmpId, Set<V8ShiftId>> {
    const index = new Map<V8EmpId, Set<V8ShiftId>>();
    for (const { employee_id, shifts } of assignments) {
        index.set(employee_id, new Set(shifts.map(s => s.id)));
    }
    return index;
}
