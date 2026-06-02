/**
 * Conflict Resolver — Final Validation Pass
 *
 * Runs AFTER the greedy/solver selection produces a candidate set.
 *
 * Purpose:
 *   The per-step compliance checks during greedy resolution evaluate each
 *   operation incrementally against the tentative schedule. Because the
 *   compliance engine's simulation is per-employee, some multi-employee
 *   or multi-shift aggregate effects may only manifest once ALL selected
 *   operations are applied simultaneously.
 *
 *   This pass builds each affected employee's COMPLETE final schedule and
 *   runs a single full-schedule compliance check per employee.
 *
 * Recovery:
 *   If BLOCKING violations are found:
 *     - Identify which selected operations contributed to the violation
 *       (operations that include this employee in their schedule_changes).
 *     - Demote the lowest-scoring contributing operation.
 *     - Re-run compliance.
 *     - Repeat until clean or no contributing operations remain.
 *
 * Returns:
 *   - validated_selected: the clean final set
 *   - demoted:            operations removed in this pass (with reasons)
 */

import type {
    ScoredOperation,
    ConflictResolverConfig,
    RejectedConflictOperation,
} from './types';
import type {
    V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext,
} from '../types';
import { validateV8State } from '../validate-combined-state';

// =============================================================================
// RESULT
// =============================================================================

export interface FinalValidationResult {
    validated_selected: ScoredOperation[];
    demoted:            RejectedConflictOperation[];
    all_clean:          boolean;
}

// =============================================================================
// FINAL VALIDATOR
// =============================================================================

export function finalValidate(
    selected:             ScoredOperation[],
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
): FinalValidationResult {
    let working = [...selected];
    const demoted: RejectedConflictOperation[] = [];

    // Collect all affected employees across selected ops
    const affected_employees = new Set<V8EmpId>(
        selected.flatMap(s => s.op.schedule_changes.map(c => c.employee_id)),
    );

    let changed  = true;
    let safety   = 0;

    while (changed && safety++ <= selected.length) {
        changed = false;

        for (const emp_id of affected_employees) {
            const employee_context = employee_catalog.get(emp_id);
            if (!employee_context) continue;

            const original = existing_shifts_map.get(emp_id) ?? [];

            // All working ops that affect this employee
            const emp_ops = working.filter(s =>
                s.op.schedule_changes.some(c => c.employee_id === emp_id),
            );

            if (emp_ops.length === 0) continue;

            // Aggregate all changes for this employee across all their ops
            const all_adds    = new Set<V8ShiftId>();
            const all_removes = new Set<V8ShiftId>();

            for (const s of emp_ops) {
                for (const change of s.op.schedule_changes) {
                    if (change.employee_id !== emp_id) continue;
                    for (const sid of change.add_shift_ids)    all_adds.add(sid);
                    for (const sid of change.remove_shift_ids) all_removes.add(sid);
                }
            }

            const add_shifts = [...all_adds]
                .map(id => shift_catalog.get(id))
                .filter((s): s is V8OrchestratorShift => s !== undefined);

            const result = validateV8State({
                employee_id:      emp_id,
                employee_context,
                original_shifts:  original,
                add_shifts,
                remove_shift_ids: [...all_removes],
                operation_type:   'ASSIGN',    // most conservative for final validation
                stage:            config.compliance_stage,
                config:           config.compliance_config,
            });

            if (result.overall_status !== 'BLOCKING') continue;

            // Demote the lowest-scoring op that affects this employee
            const candidates = emp_ops.sort((a, b) => a.composite_score - b.composite_score);
            const to_demote  = candidates[0];
            if (!to_demote) break;

            const blocking_rules = result.hits
                .filter(h => h.status === 'BLOCKING')
                .map(h => h.rule_id);

            demoted.push({
                operation_id:              to_demote.op.operation_id,
                reason:
                    `Final validation: employee ${emp_id} has BLOCKING violations when all `
                    + `selected operations are combined. Lowest-scoring op demoted. `
                    + `Rules: ${blocking_rules.join(', ')}.`,
                rule_hits:                 (result as any).rule_hits,
                conflicting_operation_ids: emp_ops
                    .filter(s => s.op.operation_id !== to_demote.op.operation_id)
                    .map(s => s.op.operation_id),
            });

            working = working.filter(s => s.op.operation_id !== to_demote.op.operation_id);
            changed = true;
            break;    // restart the employee loop after each demotion
        }
    }

    return {
        validated_selected: working,
        demoted,
        all_clean: demoted.length === 0,
    };
}
