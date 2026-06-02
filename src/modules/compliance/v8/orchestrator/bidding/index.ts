/**
 * Bidding Engine — Main Orchestrator
 *
 * Single entry point: runBidSelection()
 *
 * Full pipeline:
 *   1.  Merge config with defaults
 *   2.  Build catalogs (shift_catalog, employee_catalog, existing_shifts_map)
 *   3.  Evaluate all bids (per-bid compliance simulation, no rejection)
 *   4.  Score all bids (composite: compliance + priority + fairness + recency)
 *   5.  Build per-employee structural conflict graph (for reporting)
 *   6.  Run greedy global selection
 *   7.  Final validation pass (full-schedule compliance for each employee)
 *   8.  Assemble BiddingResult
 *   9.  [Optional] Convert to BatchInput and call executeBatch() for auto-assign
 *
 * Design guarantees:
 *   - Deterministic: same input → same output
 *   - Stateless: no DB calls, no side effects
 *   - Reuses v2 compliance engine + batch executor unchanged
 */

import type {
    BiddingInput,
    BiddingResult,
    BiddingConfig,
    Bid,
    EvaluatedBid,
    SelectedBid,
    RejectedBid,
} from './types';
import { DEFAULT_BIDDING_CONFIG } from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext } from '../types';

import { evaluateAllBids }      from './evaluator';
import { scoreAllBids }         from './scorer';
import { buildBidConflictGraph } from './conflict-graph';
import { selectBids }           from './selection-engine';
import { finalValidate }        from './validator';

// Batch executor for auto-assign
import type { BatchInput, BatchOperation, BatchBaseState } from '../batch/types';
import { executeBatch }         from '../batch/index';

// =============================================================================
// CONFIG MERGE
// =============================================================================

function mergeConfig(partial?: Partial<BiddingConfig>): BiddingConfig {
    return { ...DEFAULT_BIDDING_CONFIG, ...partial };
}

// =============================================================================
// CATALOG BUILDERS
// =============================================================================

function buildCatalogs(input: BiddingInput): {
    shift_catalog:       Map<V8ShiftId, V8OrchestratorShift>;
    employee_catalog:    Map<V8EmpId, V8EmployeeContext>;
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>;
} {
    const shift_catalog = new Map<V8ShiftId, V8OrchestratorShift>(
        input.shifts.map(s => [s.id, s]),
    );
    const employee_catalog = new Map<V8EmpId, V8EmployeeContext>(
        input.employee_contexts.map(e => [e.employee_id, e]),
    );
    const existing_shifts_map = new Map<V8EmpId, V8OrchestratorShift[]>(
        input.employee_existing_shifts.map(h => [h.employee_id, h.shifts]),
    );
    // Ensure all employees exist in the map even with empty history
    for (const emp of input.employee_contexts) {
        if (!existing_shifts_map.has(emp.employee_id)) {
            existing_shifts_map.set(emp.employee_id, []);
        }
    }
    return { shift_catalog, employee_catalog, existing_shifts_map };
}

// =============================================================================
// BATCH CONVERSION  (for auto-assign)
// =============================================================================

/**
 * Convert selected bids to a BatchInput for the Batch Executor.
 *
 * Each selected bid becomes a BID_ACCEPT operation.
 * The next-ranked bidder for each shift (from rejected bids list) is
 * attached as fallback_employee_ids for the REPLACEMENT strategy.
 */
function buildBatchInput(
    selected:    SelectedBid[],
    rejected:    RejectedBid[],
    evaluated:   EvaluatedBid[],
    input:       BiddingInput,
    config:      BiddingConfig,
): BatchInput {
    // Index evaluated bids by bid_id
    const eval_by_id = new Map<string, EvaluatedBid>(
        evaluated.map(eb => [eb.bid.bid_id, eb]),
    );

    // For each shift, collect rejected bids in score order (for fallback list)
    const fallbacks_by_shift = new Map<V8ShiftId, V8EmpId[]>();
    for (const rej of rejected) {
        const eb = eval_by_id.get(rej.bid_id);
        if (!eb) continue;
        const sid = eb.bid.shift_id;
        if (!fallbacks_by_shift.has(sid)) fallbacks_by_shift.set(sid, []);
        fallbacks_by_shift.get(sid)!.push(eb.bid.employee_id);
    }

    const operations: BatchOperation[] = selected.map((sel, idx) => ({
        operation_id: `bid_accept:${sel.bid_id}`,
        type:         'BID_ACCEPT' as const,
        payload: {
            type:                   'BID_ACCEPT' as const,
            shift_id:               sel.shift_id,
            winning_employee_id:    sel.employee_id,
            fallback_employee_ids:  fallbacks_by_shift.get(sel.shift_id) ?? [],
        },
        priority:  eval_by_id.get(sel.bid_id)?.composite_score ?? 50,
        timestamp: eval_by_id.get(sel.bid_id)?.bid.bid_time ?? new Date().toISOString(),
    }));

    const base_state: BatchBaseState = {
        shifts:                  input.shifts,
        current_assignments:     [],    // bidding applies to unassigned shifts
        employees:               input.employee_contexts,
        employee_existing_shifts: input.employee_existing_shifts.map(h => ({
            employee_id:     h.employee_id,
            existing_shifts: h.shifts,
        })),
    };

    return {
        base_state,
        operations,
        config: { compliance_stage: config.compliance_stage, compliance_config: config.compliance_config },
    };
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export function runBidSelection(input: BiddingInput): BiddingResult {
    const t0     = performance.now();
    const config = mergeConfig(input.config);

    // ── 1. Build catalogs ─────────────────────────────────────────────────────
    const { shift_catalog, employee_catalog, existing_shifts_map } = buildCatalogs(input);

    // ── 2. Evaluate all bids individually (no rejection) ─────────────────────
    const evaluated = evaluateAllBids(
        input.bids,
        shift_catalog,
        employee_catalog,
        existing_shifts_map,
        config,
    );

    // Track bids that couldn't be evaluated (missing shift/employee refs)
    const evaluated_ids = new Set(evaluated.map(eb => eb.bid.bid_id));
    const pre_rejected: RejectedBid[] = input.bids
        .filter(b => !evaluated_ids.has(b.bid_id))
        .map(b => ({
            bid_id:    b.bid_id,
            reason:    `Bid references unknown shift (${b.shift_id}) or employee (${b.employee_id}).`,
            rule_hits: [],
        }));

    // ── 3. Score ──────────────────────────────────────────────────────────────
    scoreAllBids(evaluated, config);

    // ── 4. Conflict graph (informational — not used for gating selection) ─────
    // Access compliance config for rest_gap_hours; default to 10h
    const rest_gap_hours = (config.compliance_config as any)?.rest_gap_hours ?? 10;
    buildBidConflictGraph(evaluated, rest_gap_hours);
    // (result available for callers via extension; not surfaced in BiddingResult
    //  for now to keep the output focused — add as opt-in via config if needed)

    // ── 5. Selection ──────────────────────────────────────────────────────────
    const { selected, rejected: sel_rejected, unfilled_shifts } = selectBids(
        evaluated,
        input.shifts,
        existing_shifts_map,
        config,
    );

    // ── 6. Final validation pass ──────────────────────────────────────────────
    const eval_by_id = new Map<string, EvaluatedBid>(
        evaluated.map(eb => [eb.bid.bid_id, eb]),
    );

    const { validated_selected, demoted_bids } = finalValidate(
        selected,
        eval_by_id,
        existing_shifts_map,
        employee_catalog,
        config,
    );

    // Shifts demoted in final validation become unfilled if no fallback
    const demoted_shift_ids = new Set(
        demoted_bids.map(d => eval_by_id.get(d.bid_id)?.shift.id).filter(Boolean) as V8ShiftId[],
    );
    const additional_unfilled = [...demoted_shift_ids].filter(
        sid => !validated_selected.some(s => s.shift_id === sid),
    );

    // ── 7. Assemble rejected list ─────────────────────────────────────────────
    const all_rejected: RejectedBid[] = [
        ...pre_rejected,
        ...sel_rejected,
        ...demoted_bids,
    ];

    // Pre-eval summary counts
    const pass_count     = evaluated.filter(eb => eb.compliance_status === 'PASS').length;
    const warning_count  = evaluated.filter(eb => eb.compliance_status === 'WARNING').length;
    const blocking_count = evaluated.filter(eb => eb.compliance_status === 'BLOCKING').length;

    const result: BiddingResult = {
        selected_bids:   validated_selected,
        rejected_bids:   all_rejected,
        unfilled_shifts: [...new Set([...unfilled_shifts, ...additional_unfilled])],
        summary: {
            total_bids:              input.bids.length,
            evaluated_bids:          evaluated.length,
            selected_count:          validated_selected.length,
            rejected_count:          all_rejected.length,
            unfilled_shift_count:    unfilled_shifts.length + additional_unfilled.length,
            pre_eval_pass_count:     pass_count,
            pre_eval_warning_count:  warning_count,
            pre_eval_blocking_count: blocking_count,
        },
        evaluation_time_ms: Math.round((performance.now() - t0) * 100) / 100,
    };

    // ── 8. [Optional] Auto-assign via Batch Executor ──────────────────────────
    if (config.auto_assign && validated_selected.length > 0) {
        const batch_input = buildBatchInput(
            validated_selected,
            all_rejected,
            evaluated,
            input,
            config,
        );
        result.batch_result = executeBatch(batch_input);
    }

    return result;
}

// =============================================================================
// PUBLIC RE-EXPORTS
// =============================================================================

export type {
    BiddingInput,
    BiddingResult,
    BiddingConfig,
    Bid,
    EvaluatedBid,
    SelectedBid,
    RejectedBid,
    EmployeeBidConflictGroup,
    BidConflictEdge,
    BidConflictKind,
} from './types';

export { DEFAULT_BIDDING_CONFIG } from './types';
export { buildBidConflictGraph } from './conflict-graph';
