/**
 * Two-Way Swap Engine — Main Orchestrator
 *
 * Single entry point: runSwapApproval()
 *
 * Full pipeline:
 *   1.  Merge config with defaults
 *   2.  Build catalogs and ownership index
 *   3.  Structural validation (fail fast: ownership, existence, self-swap, etc.)
 *   4.  Inter-swap conflict resolution (same shift in multiple swaps → highest priority wins)
 *   5.  Simulate each valid swap: A_new = A−X+Y, B_new = B−Y+X
 *   6.  Compliance check per swap: evaluate(A_new) + evaluate(B_new) → combined status
 *   7.  Decision logic:
 *         - BLOCKING → reject
 *         - WARNING  → reject if !accept_warnings, approve otherwise
 *         - PASS     → approve
 *   8.  Final validation (safety net for multi-swap employees)
 *   9.  Assemble SwapResult
 *  10.  [Optional] Auto-apply via Batch Executor (SWAP_APPROVE operations)
 *
 * Design guarantees:
 *   - Stateless and deterministic — same input → same output
 *   - No database assumptions, no side effects
 *   - Reuses v2 compliance engine + batch executor unchanged
 *   - Two-way (A ↔ B) only — no chains, no one-way transfers
 */

import type {
    SwapInput,
    SwapResult,
    SwapConfig,
    SwapRequest,
    ApprovedSwap,
    RejectedSwap,
    SwapFinalStateSummary,
} from './types';
import { DEFAULT_SWAP_CONFIG } from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext } from '../types';

import {
    validateStructure,
    buildShiftCatalog,
    buildEmployeeCatalog,
    buildOwnershipIndex,
}                              from './validator';
import { resolveInterSwapConflicts } from './conflict-resolver';
import { simulateAllSwaps }    from './simulator';
import { checkAllSwaps }       from './compliance-checker';
import { finalValidateSwaps }  from './final-validator';

// Batch executor integration
import type { BatchInput, BatchOperation, BatchBaseState } from '../batch/types';
import { executeBatch }        from '../batch/index';

// =============================================================================
// CONFIG MERGE
// =============================================================================

function mergeConfig(partial?: Partial<SwapConfig>): SwapConfig {
    return { ...DEFAULT_SWAP_CONFIG, ...partial };
}

// =============================================================================
// EXISTING SHIFTS MAP
// =============================================================================

function buildExistingShiftsMap(
    assignments: SwapInput['existing_assignments'],
): Map<V8EmpId, V8OrchestratorShift[]> {
    return new Map(assignments.map(a => [a.employee_id, a.shifts]));
}

/** Collect ALL shifts referenced across all assignments into a flat catalog */
function buildAllShiftsCatalog(
    input: SwapInput,
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>,
): Map<V8ShiftId, V8OrchestratorShift> {
    const catalog = new Map<V8ShiftId, V8OrchestratorShift>();
    for (const [, shifts] of existing_shifts_map) {
        for (const s of shifts) catalog.set(s.id, s);
    }
    return catalog;
}

// =============================================================================
// BATCH CONVERSION  (for auto-apply)
// =============================================================================

function buildBatchInput(
    approved: ApprovedSwap[],
    input:    SwapInput,
    config:   SwapConfig,
): BatchInput {
    const operations: BatchOperation[] = approved.map((swap, idx) => ({
        operation_id: `swap_approve:${swap.swap_id}`,
        type:         'SWAP_APPROVE' as const,
        payload: {
            type:    'SWAP_APPROVE' as const,
            party_a: { employee_id: swap.employee_a_id, gives_shift_id: swap.shift_x_id },
            party_b: { employee_id: swap.employee_b_id, gives_shift_id: swap.shift_y_id },
        },
        priority:  idx + 1,    // preserve order; original priority not in ApprovedSwap
        timestamp: new Date().toISOString(),
    }));

    const base_state: BatchBaseState = {
        shifts:                  [...buildAllShiftsCatalog(input, buildExistingShiftsMap(input.existing_assignments)).values()],
        current_assignments:     input.existing_assignments.flatMap(a =>
            a.shifts.map(s => ({ shift_id: s.id, employee_id: a.employee_id })),
        ),
        employees:               input.employees,
        employee_existing_shifts: input.existing_assignments.map(a => ({
            employee_id:     a.employee_id,
            existing_shifts: a.shifts,
        })),
    };

    return {
        base_state,
        operations,
        config: {
            resolution_strategy:  'ISOLATION',    // swaps must be atomic
            compliance_stage:     config.compliance_stage,
            compliance_config:    config.compliance_config,
        },
    };
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export function runSwapApproval(input: SwapInput): SwapResult {
    const t0     = performance.now();
    const config = mergeConfig(input.config);

    // ── 1. Build catalogs ─────────────────────────────────────────────────────
    const existing_shifts_map = buildExistingShiftsMap(input.existing_assignments);
    const employee_catalog    = buildEmployeeCatalog(input.employees);
    const shift_catalog       = buildAllShiftsCatalog(input, existing_shifts_map);
    const ownership_index     = buildOwnershipIndex(input.existing_assignments);

    const all_rejected: RejectedSwap[] = [];

    // ── 2. Structural validation ──────────────────────────────────────────────
    const structural = validateStructure(
        input.swaps,
        shift_catalog,
        employee_catalog,
        ownership_index,
    );

    for (const err of structural.invalid) {
        all_rejected.push({ swap_id: err.swap_id, reason: err.reason, rule_hits_a: [], rule_hits_b: [] });
    }

    if (structural.valid.length === 0) {
        return assembleResult([], all_rejected, input, config, t0);
    }

    // ── 3. Inter-swap conflict resolution ─────────────────────────────────────
    const conflict_resolution = resolveInterSwapConflicts(structural.valid);

    for (const c of conflict_resolution.conflicted) {
        all_rejected.push({
            swap_id:     c.rejected_swap_id,
            reason:      c.reason,
            rule_hits_a: [],
            rule_hits_b: [],
        });
    }

    const resolvable = conflict_resolution.clean;

    if (resolvable.length === 0) {
        return assembleResult([], all_rejected, input, config, t0);
    }

    // ── 4. Simulate all valid swaps ───────────────────────────────────────────
    const simulations = simulateAllSwaps(resolvable, shift_catalog, existing_shifts_map);

    // ── 5. Compliance check per swap ──────────────────────────────────────────
    const compliance_results = checkAllSwaps(simulations, employee_catalog, config);

    // ── 6. Decision logic ─────────────────────────────────────────────────────
    const tentatively_approved: ApprovedSwap[] = [];

    for (const swap of resolvable) {
        const comp = compliance_results.get(swap.swap_id);
        if (!comp) continue;    // simulation skipped (shouldn't happen after validation)

        const status = comp.combined_status;

        const should_reject =
            status === 'BLOCKING' ||
            (status === 'WARNING' && !config.accept_warnings);

        if (should_reject) {
            const blocking_hits_a = comp.result_a.hits.filter(h => h.status === 'BLOCKING');
            const blocking_hits_b = comp.result_b.hits.filter(h => h.status === 'BLOCKING');
            const reason = status === 'BLOCKING'
                ? `Swap rejected: BLOCKING compliance violation(s) — `
                  + [...new Set([...blocking_hits_a, ...blocking_hits_b].map(h => h.rule_id))].join(', ')
                : `Swap rejected: WARNING compliance status is not accepted at stage ${config.compliance_stage}.`;

            all_rejected.push({
                swap_id:     swap.swap_id,
                reason,
                rule_hits_a: comp.result_a.hits,
                rule_hits_b: comp.result_b.hits,
            });
        } else {
            tentatively_approved.push({
                swap_id:             swap.swap_id,
                employee_a_id:       swap.employee_a_id,
                employee_b_id:       swap.employee_b_id,
                shift_x_id:          swap.shift_x_id,
                shift_y_id:          swap.shift_y_id,
                compliance_status_a: comp.result_a.overall_status,
                compliance_status_b: comp.result_b.overall_status,
                compliance_status:   comp.combined_status,
                original_priority:   swap.priority,
            });
        }
    }

    // ── 7. Final validation (combined-state safety net) ───────────────────────
    const { final_approved, demoted } = finalValidateSwaps(
        tentatively_approved,
        existing_shifts_map,
        employee_catalog,
        shift_catalog,
        config,
    );

    all_rejected.push(...demoted);

    // ── 8. Assemble result ────────────────────────────────────────────────────
    return assembleResult(final_approved, all_rejected, input, config, t0);
}

// =============================================================================
// RESULT ASSEMBLER
// =============================================================================

function assembleResult(
    approved:   ApprovedSwap[],
    rejected:   RejectedSwap[],
    input:      SwapInput,
    config:     SwapConfig,
    t0:         number,
): SwapResult {
    const affected_employees = [
        ...new Set(approved.flatMap(s => [s.employee_a_id, s.employee_b_id])),
    ];
    const affected_shifts = [
        ...new Set(approved.flatMap(s => [s.shift_x_id, s.shift_y_id])),
    ];

    const summary: SwapFinalStateSummary = {
        total_swaps:        input.swaps.length,
        approved_count:     approved.length,
        rejected_count:     rejected.length,
        affected_employees,
        affected_shifts,
        compliance_clean:   approved.every(s => s.compliance_status !== 'BLOCKING'),
    };

    const result: SwapResult = {
        approved_swaps:     approved,
        rejected_swaps:     rejected,
        final_state_summary: summary,
        evaluation_time_ms: Math.round((performance.now() - t0) * 100) / 100,
    };

    // ── Optional: auto-apply via batch executor ───────────────────────────────
    if (config.auto_apply && approved.length > 0) {
        const batch_input = buildBatchInput(approved, input, config);
        result.batch_result = executeBatch(batch_input);
    }

    return result;
}

// =============================================================================
// PUBLIC RE-EXPORTS
// =============================================================================

export type {
    SwapInput,
    SwapResult,
    SwapConfig,
    SwapRequest,
    ApprovedSwap,
    RejectedSwap,
    SwapFinalStateSummary,
    SwapStatus,
    SwapSimulation,
    SwapComplianceResult,
    StructuralValidationResult,
    ConflictResolutionResult,
    InterSwapConflict,
} from './types';

export { DEFAULT_SWAP_CONFIG } from './types';
