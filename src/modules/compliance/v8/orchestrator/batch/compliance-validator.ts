/**
 * Batch Executor — Compliance Validator
 *
 * Runs the v2 compliance engine for every employee whose schedule
 * changed as a result of the batch operation set.
 *
 * Strategy:
 *   1. Determine the affected employees from the applied operation set.
 *   2. For each affected employee, compute the delta (added/removed shifts)
 *      and call runV8Orchestrator() in SIMULATED mode.
 *   3. Aggregate per-employee results.
 *
 * The compliance engine is stateless and cache-aware — repeated calls
 * for the same (employee, shifts, config) triple are cheap.
 *
 * Returns:
 *   - per-employee V8OrchestratorResult
 *   - a set of operation IDs that triggered BLOCKING hits
 */

import type {
    BatchOperation,
    BatchBaseState,
    SimulatedState,
    EmployeeComplianceResult,
    BatchConfig,
    AtomicOperation,
} from './types';
import type { V8EmpId, V8OrchestratorInput, V8OperationType } from '../types';
import { runV8Orchestrator }  from '../index';
import { getEmployeeDelta }    from './simulator';

// =============================================================================
// AFFECTED EMPLOYEE RESOLVER
// =============================================================================

/**
 * Returns the set of employee IDs touched by the given operations,
 * based on their atomics.
 */
function affectedEmployees(
    ops:     BatchOperation[],
    atomics: Map<string, AtomicOperation[]>,
): Set<V8EmpId> {
    const affected = new Set<V8EmpId>();
    for (const op of ops) {
        for (const atomic of atomics.get(op.operation_id) ?? []) {
            affected.add(atomic.employee_id);
        }
    }
    return affected;
}

/**
 * For a given employee, determine which parent operation IDs
 * touch their schedule.
 */
function operationsTouchingEmployee(
    employee_id: V8EmpId,
    ops:         BatchOperation[],
    atomics:     Map<string, AtomicOperation[]>,
): string[] {
    const result: string[] = [];
    for (const op of ops) {
        const opAtomics = atomics.get(op.operation_id) ?? [];
        if (opAtomics.some(a => a.employee_id === employee_id)) {
            result.push(op.operation_id);
        }
    }
    return result;
}

/** Map BatchV8OperationType → V8OperationType expected by compliance engine */
function deriveV8OperationType(
    employee_id: V8EmpId,
    ops:         BatchOperation[],
    atomics:     Map<string, AtomicOperation[]>,
): V8OperationType {
    // Determine dominant operation type for this employee.
    // Precedence: SWAP > BID_ACCEPT (= BID) > ASSIGN > UNASSIGN
    const opTypeOrder: Record<string, number> = {
        SWAP_APPROVE: 3,
        BID_ACCEPT:   2,
        ASSIGN:       1,
        UNASSIGN:     0,
    };

    let best = -1;
    let bestType: V8OperationType = 'ASSIGN';

    for (const op of ops) {
        const opAtomics = atomics.get(op.operation_id) ?? [];
        if (!opAtomics.some(a => a.employee_id === employee_id)) continue;

        const rank = opTypeOrder[op.type] ?? 0;
        if (rank > best) {
            best     = rank;
            bestType = op.type === 'SWAP_APPROVE' ? 'SWAP'
                     : op.type === 'BID_ACCEPT'   ? 'BID'
                     : op.type === 'ASSIGN'        ? 'ASSIGN'
                     : 'ASSIGN';
        }
    }

    return bestType;
}

// =============================================================================
// MAIN VALIDATOR
// =============================================================================

export interface ComplianceValidationResult {
    employee_results:    EmployeeComplianceResult[];
    /** Operations that caused BLOCKING compliance hits for at least one employee */
    blocking_operations: Set<string>;
}

export function validateCompliance(
    applied_ops:  BatchOperation[],
    atomics:      Map<string, AtomicOperation[]>,
    base_state:   BatchBaseState,
    sim_state:    SimulatedState,
    config:       BatchConfig,
): ComplianceValidationResult {
    const employee_results:    EmployeeComplianceResult[] = [];
    const blocking_operations: Set<string>                = new Set();

    if (applied_ops.length === 0) {
        return { employee_results, blocking_operations };
    }

    const affected = affectedEmployees(applied_ops, atomics);

    for (const empId of affected) {
        const employeeCtx = base_state.employees.find(e => e.employee_id === empId);
        if (!employeeCtx) continue;

        // Original shifts for this employee
        const originalHistory = base_state.employee_existing_shifts.find(
            h => h.employee_id === empId,
        );
        const originalShifts = originalHistory?.existing_shifts ?? [];

        // Delta: what changed
        const delta = getEmployeeDelta(empId, originalShifts, sim_state);

        // Build any
        const candidateChanges: any = {
            add_shifts:    delta.added,
            remove_shifts: delta.removed.map(s => s.id),
        };

        const opType = deriveV8OperationType(empId, applied_ops, atomics);

        const input: V8OrchestratorInput = {
            employee_id:       empId,
            mode:             'SIMULATED',
            employee_context: employeeCtx,
            existing_shifts:  originalShifts,
            candidate_changes: candidateChanges,
            operation_type:   opType,
            stage:            config.compliance_stage,
            config:           config.compliance_config,
        };

        const result = runV8Orchestrator(input, {
            stage: config.compliance_stage,
        });

        const changedByOps = operationsTouchingEmployee(empId, applied_ops, atomics);

        employee_results.push({
            employee_id:           empId,
            result,
            changed_by_operations: changedByOps,
        });

        // Mark operations as blocking if this employee has BLOCKING hits
        if (result.overall_status === 'BLOCKING') {
            for (const opId of changedByOps) {
                blocking_operations.add(opId);
            }
        }
    }

    return { employee_results, blocking_operations };
}
