/**
 * Batch Executor — In-Memory State Simulator
 *
 * Applies AtomicOperations to a SimulatedState in sequence.
 * Provides:
 *   1. buildInitialState()   — snapshot of base_state as a mutable SimulatedState
 *   2. applyAtomics()        — attempt each atomic in sequence_index order;
 *                              record failures (precondition violations) without throwing
 *   3. getEmployeeDelta()    — derive add/remove sets for one employee (feeds compliance engine)
 *
 * Precondition checks (logical consistency):
 *   ADD_EMPLOYEE_SHIFT   — shift must not already be assigned to another employee
 *   REMOVE_EMPLOYEE_SHIFT — shift must currently be held by the specified employee
 *
 * The simulator does NOT enforce compliance rules — that is the compliance-validator's job.
 */

import type {
    BatchBaseState,
    AtomicOperation,
    SimulatedState,
    SimulationResult,
} from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId } from '../types';

// =============================================================================
// INITIAL STATE
// =============================================================================

export function buildInitialState(base: BatchBaseState): SimulatedState {
    const employee_shifts   = new Map<V8EmpId, V8OrchestratorShift[]>();
    const shift_assignments = new Map<V8ShiftId, V8EmpId | null>();

    // Seed employee shift lists from history
    for (const hist of base.employee_existing_shifts) {
        employee_shifts.set(hist.employee_id, [...hist.existing_shifts]);
    }

    // Ensure all employees exist in the map (even with empty schedule)
    for (const emp of base.employees) {
        if (!employee_shifts.has(emp.employee_id)) {
            employee_shifts.set(emp.employee_id, []);
        }
    }

    // Seed shift assignments from current_assignments
    for (const shift of base.shifts) {
        shift_assignments.set(shift.id, null);    // default unassigned
    }
    for (const assignment of base.current_assignments) {
        shift_assignments.set(assignment.shift_id, assignment.employee_id);
    }

    return { employee_shifts, shift_assignments };
}

// =============================================================================
// APPLY ATOMICS
// =============================================================================

/**
 * Apply a list of AtomicOperations to the mutable SimulatedState.
 *
 * Atomics for a single parent op should be sorted by sequence_index before
 * calling (the normalizer guarantees this ordering). This function processes
 * them in the order given.
 *
 * Returns which parent operations fully applied vs partially/fully failed.
 */
export function applyAtomics(
    atomics:  AtomicOperation[],
    state:    SimulatedState,
): SimulationResult {
    const applied:  string[] = [];    // parent op IDs that completed cleanly
    const failed:   Array<{ op_id: string; reason: string }> = [];

    // Group by parent so we can track partial failures per parent
    const byParent = new Map<string, AtomicOperation[]>();
    for (const a of atomics) {
        if (!byParent.has(a.parent_operation_id)) byParent.set(a.parent_operation_id, []);
        byParent.get(a.parent_operation_id)!.push(a);
    }

    for (const [parentId, parentAtomics] of byParent) {
        // Sort by sequence_index (removes < adds)
        const sorted = [...parentAtomics].sort((a, b) => a.sequence_index - b.sequence_index);

        let parentFailed = false;
        let failReason   = '';

        // Snapshot state in case we need to rollback partial application
        const snapEmpShifts    = new Map<V8EmpId, V8OrchestratorShift[]>();
        const snapAssignments  = new Map<V8ShiftId, V8EmpId | null>();
        for (const a of sorted) {
            const eid = a.employee_id;
            const sid = a.shift.id;
            if (!snapEmpShifts.has(eid)) {
                snapEmpShifts.set(eid, [...(state.employee_shifts.get(eid) ?? [])]);
            }
            if (!snapAssignments.has(sid)) {
                snapAssignments.set(sid, state.shift_assignments.get(sid) ?? null);
            }
        }

        for (const atomic of sorted) {
            const eid = atomic.employee_id;
            const sid = atomic.shift.id;

            if (atomic.type === 'ADD_EMPLOYEE_SHIFT') {
                const currentHolder = state.shift_assignments.get(sid);
                if (currentHolder !== null && currentHolder !== undefined && currentHolder !== eid) {
                    parentFailed = true;
                    failReason   = `Shift ${sid} is already assigned to employee ${currentHolder}`;
                    break;
                }

                // Apply
                const empShifts = state.employee_shifts.get(eid) ?? [];
                if (!empShifts.find(s => s.id === sid)) {
                    empShifts.push(atomic.shift);
                    state.employee_shifts.set(eid, empShifts);
                }
                state.shift_assignments.set(sid, eid);

            } else {
                // REMOVE_EMPLOYEE_SHIFT
                const currentHolder = state.shift_assignments.get(sid);
                if (currentHolder !== eid) {
                    parentFailed = true;
                    failReason   = `Shift ${sid} is not currently held by employee ${eid} `
                                 + `(held by: ${currentHolder ?? 'nobody'})`;
                    break;
                }

                // Apply
                const empShifts = state.employee_shifts.get(eid) ?? [];
                state.employee_shifts.set(eid, empShifts.filter(s => s.id !== sid));
                state.shift_assignments.set(sid, null);
            }
        }

        if (parentFailed) {
            // Rollback partial changes for this parent
            for (const [eid, shifts] of snapEmpShifts) {
                state.employee_shifts.set(eid, shifts);
            }
            for (const [sid, assignee] of snapAssignments) {
                state.shift_assignments.set(sid, assignee);
            }
            failed.push({ op_id: parentId, reason: failReason });
        } else {
            applied.push(parentId);
        }
    }

    return { final_state: state, applied, failed };
}

// =============================================================================
// EMPLOYEE DELTA
// =============================================================================

/**
 * Compute the set of shifts added / removed for an employee
 * by comparing the original history to the current simulated state.
 *
 * Used to build any for the compliance engine.
 */
export function getEmployeeDelta(
    employee_id:     V8EmpId,
    original_shifts: V8OrchestratorShift[],
    state:           SimulatedState,
): { added: V8OrchestratorShift[]; removed: V8OrchestratorShift[] } {
    const current  = state.employee_shifts.get(employee_id) ?? [];
    const origIds  = new Set(original_shifts.map(s => s.id));
    const currIds  = new Set(current.map(s => s.id));

    const added   = current.filter(s => !origIds.has(s.id));
    const removed = original_shifts.filter(s => !currIds.has(s.id));

    return { added, removed };
}
