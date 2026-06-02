/**
 * Two-Way Swap Engine — Compliance Checker
 *
 * Runs the v2 compliance engine for BOTH parties in each swap and
 * combines the results into a single per-swap compliance verdict.
 *
 * Core principle:
 *   Validate the FINAL STATE after BOTH shifts are transferred, not each
 *   side independently. Both A's new schedule and B's new schedule must
 *   be compliance-clean for a swap to be approved.
 *
 * Uses:
 *   - runV8Orchestrator() in SIMULATED mode (operation_type: 'SWAP')
 *     with candidate_changes = { add_shifts, remove_shifts } so that:
 *       • The outgoing shift is subtracted from rolling-window accumulators
 *       • The incoming shift triggers impact scoping and rule evaluation
 *       • Delta explanation captures the semantic "gave X, received Y"
 *
 *   - combineSwapResults() from the aggregator to derive the worst-case
 *     combined status (BLOCKING if either party is BLOCKING).
 *
 * Performance:
 *   Two compliance calls per swap. The engine's LRU cache means swaps
 *   involving the same employee+schedule pair are effectively free on
 *   the second call. For 100 swaps this is at most 200 engine evaluations.
 */

import type { SwapSimulation, SwapComplianceResult, SwapConfig } from './types';
import type { V8EmpId, V8EmployeeContext, V8OrchestratorInput } from '../types';
import { runV8Orchestrator }  from '../index';
import { combineV8SwapResults }  from '../aggregator';

// =============================================================================
// PER-SWAP CHECKER
// =============================================================================

function checkSwapCompliance(
    sim:              SwapSimulation,
    employee_catalog: Map<V8EmpId, V8EmployeeContext>,
    config:           SwapConfig,
): SwapComplianceResult {
    const emp_a = employee_catalog.get(sim.request.employee_a_id)!;
    const emp_b = employee_catalog.get(sim.request.employee_b_id)!;

    // ── Employee A ─────────────────────────────────────────────────────────────
    // A gives shift_X (remove), receives shift_Y (add)
    const input_a: V8OrchestratorInput = {
        employee_id:       sim.request.employee_a_id,
        employee_context:  emp_a,
        // Existing shifts = A's ORIGINAL schedule (before swap).
        // The candidate_changes delta captures exactly what changes.
        existing_shifts:   sim.a_new_shifts.filter(s => s.id !== sim.shift_y.id)
                            .concat([sim.shift_x]),    // reconstruct original A
        candidate_changes: {
            add_shifts:    [sim.shift_y],              // A receives shift_Y
            remove_shifts: [sim.shift_x.id],           // A gives shift_X
        },
        mode:           'SIMULATED',
        operation_type: 'SWAP',
        stage:          config.compliance_stage,
        config:         config.compliance_config,
    };

    // ── Employee B ─────────────────────────────────────────────────────────────
    // B gives shift_Y (remove), receives shift_X (add)
    const input_b: V8OrchestratorInput = {
        employee_id:       sim.request.employee_b_id,
        employee_context:  emp_b,
        existing_shifts:   sim.b_new_shifts.filter(s => s.id !== sim.shift_x.id)
                            .concat([sim.shift_y]),    // reconstruct original B
        candidate_changes: {
            add_shifts:    [sim.shift_x],              // B receives shift_X
            remove_shifts: [sim.shift_y.id],           // B gives shift_Y
        },
        mode:           'SIMULATED',
        operation_type: 'SWAP',
        stage:          config.compliance_stage,
        config:         config.compliance_config,
    };

    const result_a = runV8Orchestrator(input_a, { stage: config.compliance_stage });
    const result_b = runV8Orchestrator(input_b, { stage: config.compliance_stage });

    const { status } = combineV8SwapResults(result_a, result_b);

    return {
        swap_id:         sim.swap_id,
        result_a,
        result_b,
        combined_status: status,
    };
}

// =============================================================================
// BATCH CHECKER
// =============================================================================

export function checkAllSwaps(
    simulations:      Map<string, SwapSimulation>,
    employee_catalog: Map<V8EmpId, V8EmployeeContext>,
    config:           SwapConfig,
): Map<string, SwapComplianceResult> {
    const results = new Map<string, SwapComplianceResult>();

    for (const [swap_id, sim] of simulations) {
        results.set(swap_id, checkSwapCompliance(sim, employee_catalog, config));
    }

    return results;
}
