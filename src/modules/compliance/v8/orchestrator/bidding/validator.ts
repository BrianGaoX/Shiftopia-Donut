/**
 * Bidding Engine — Final Validation Pass
 *
 * Runs AFTER the selection engine has produced its candidate set.
 *
 * Purpose:
 *   The selection engine checks each bid independently against the tentative
 *   schedule at selection time. However, because the tentative schedule is
 *   built incrementally, subtle aggregate violations (e.g. daily hours sum
 *   across multiple selected bids) may not surface until the FULL final
 *   schedule is assembled.
 *
 * Approach:
 *   For each affected employee, build their COMPLETE final schedule
 *   (existing_shifts + all their selected bids) and run a full compliance
 *   evaluation in SIMULATED mode.
 *
 *   If BLOCKING violations remain:
 *     - Remove the lowest-scoring selected bid for that employee until clean
 *       or until the employee has no more selected bids.
 *     - Demoted bids are added to the rejected list.
 *
 *   This is a safety net; in practice, well-implemented rule evaluation
 *   during selection should prevent these cases.
 *
 * Returns:
 *   - validated_selected: final clean SelectedBid[]
 *   - demoted_bids:       RejectedBid[] for bids removed in this pass
 */

import type { SelectedBid, RejectedBid, EvaluatedBid, BiddingConfig } from './types';
import type {
    V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext,
} from '../types';
import { validateV8State } from '../validate-combined-state';

// =============================================================================
// VALIDATION RESULT
// =============================================================================

export interface ValidationResult {
    validated_selected: SelectedBid[];
    demoted_bids:       RejectedBid[];
}

// =============================================================================
// MAIN VALIDATOR
// =============================================================================

export function finalValidate(
    selected:             SelectedBid[],
    evaluated_map:        Map<string, EvaluatedBid>,    // bid_id → EvaluatedBid
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    config:               BiddingConfig,
): ValidationResult {
    // Group selected bids by employee
    const by_employee = new Map<V8EmpId, SelectedBid[]>();
    for (const sel of selected) {
        if (!by_employee.has(sel.employee_id)) by_employee.set(sel.employee_id, []);
        by_employee.get(sel.employee_id)!.push(sel);
    }

    const clean_selected = new Set<string>(selected.map(s => s.bid_id));
    const demoted: RejectedBid[] = [];

    for (const [empId, emp_selected] of by_employee) {
        const employee_context = employee_catalog.get(empId);
        if (!employee_context) continue;

        const existing_shifts = existing_shifts_map.get(empId) ?? [];

        // Build the full candidate set for this employee from their selected bids
        let candidate_shifts = emp_selected
            .map(sel => evaluated_map.get(sel.bid_id)?.shift)
            .filter((s): s is V8OrchestratorShift => s !== undefined);

        // Check full schedule compliance
        let passes = false;
        let attempts = 0;

        while (!passes && candidate_shifts.length > 0 && attempts < emp_selected.length) {
            attempts++;

            const result = validateV8State({
                employee_id:      empId,
                employee_context,
                original_shifts:  existing_shifts,
                add_shifts:       candidate_shifts,
                remove_shift_ids: [],
                operation_type:   'BID',
                stage:            config.compliance_stage,
                config:           config.compliance_config,
            });

            if (result.overall_status !== 'BLOCKING') {
                passes = true;
                break;
            }

            // Find the lowest-scoring selected bid for this employee and demote it
            const candidate_shift_ids = new Set(candidate_shifts.map(s => s.id));

            // Sort emp_selected by composite_score ascending (lowest first = first to demote)
            const sortable = emp_selected
                .filter(sel => {
                    const eb = evaluated_map.get(sel.bid_id);
                    return eb && candidate_shift_ids.has(eb.shift.id) && clean_selected.has(sel.bid_id);
                })
                .sort((a, b) => {
                    const sa = evaluated_map.get(a.bid_id)?.composite_score ?? 0;
                    const sb = evaluated_map.get(b.bid_id)?.composite_score ?? 0;
                    return sa - sb;    // ascending: lowest score first
                });

            if (sortable.length === 0) break;

            const to_demote = sortable[0];
            clean_selected.delete(to_demote.bid_id);

            demoted.push({
                bid_id:    to_demote.bid_id,
                reason:    `Final validation: employee ${empId} has BLOCKING compliance violations when all selected bids are combined. Lowest-scoring bid demoted. Rule hits: ${result.hits.filter(h => h.status === 'BLOCKING').map(h => h.rule_id).join(', ')}.`,
                rule_hits: result.hits,
            });

            // Rebuild candidate shifts without the demoted bid
            candidate_shifts = candidate_shifts.filter(
                s => s.id !== evaluated_map.get(to_demote.bid_id)?.shift.id,
            );
        }
    }

    const validated_selected = selected.filter(sel => clean_selected.has(sel.bid_id));

    return { validated_selected, demoted_bids: demoted };
}
