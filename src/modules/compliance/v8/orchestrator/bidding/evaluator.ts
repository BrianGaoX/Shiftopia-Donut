/**
 * Bidding Engine — Per-Bid Compliance Evaluator
 *
 * Evaluates every bid INDEPENDENTLY using the v2 compliance engine in
 * SIMULATED mode. The baseline for each evaluation is:
 *
 *   existing_shifts = employee's already-assigned schedule
 *   add_shifts      = [bid.shift]
 *
 * Key contract:
 *   - Do NOT reject bids here, even if compliance_status is BLOCKING.
 *   - BLOCKING bids are preserved as fallbacks (used by REPLACEMENT strategy).
 *   - The per-bid compliance_status contributes to the composite score
 *     (PASS > WARNING > BLOCKING) but does not gate selection.
 *
 * Performance:
 *   - The compliance engine's LRU cache (EvaluationCache) means repeated
 *     calls with the same (employee, shifts) pair are O(1).
 *   - For 1000 bids across 200 employees this is ~5–20 cache-warmed calls
 *     per employee on average.
 */

import type { Bid, EvaluatedBid, BiddingConfig } from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext, V8OrchestratorInput } from '../types';
import { runV8Orchestrator } from '../index';

// =============================================================================
// MAIN EVALUATOR
// =============================================================================

export function evaluateAllBids(
    bids:                  Bid[],
    shift_catalog:         Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:      Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:   Map<V8EmpId, V8OrchestratorShift[]>,
    config:                BiddingConfig,
): EvaluatedBid[] {
    const evaluated: EvaluatedBid[] = [];

    for (const bid of bids) {
        const shift = shift_catalog.get(bid.shift_id);
        if (!shift) continue;    // malformed bid — shift not in catalog; silently skip

        const employee_context = employee_catalog.get(bid.employee_id);
        if (!employee_context) continue;    // malformed bid — employee not in catalog

        const existing_shifts = existing_shifts_map.get(bid.employee_id) ?? [];

        const input: V8OrchestratorInput = {
            employee_id:       bid.employee_id,
            employee_context,
            existing_shifts,
            candidate_changes: {
                add_shifts:    [shift],
                remove_shifts: [],
            },
            mode:              'SIMULATED',
            operation_type:    'BID',
            stage:             config.compliance_stage,
            config:            config.compliance_config,
        };

        const result = runV8Orchestrator(input, { stage: config.compliance_stage });

        evaluated.push({
            bid,
            shift,
            employee_context,
            compliance_status: result.overall_status,
            rule_hits:         result.hits,
            composite_score:   0,    // filled by scorer
        });
    }

    return evaluated;
}
