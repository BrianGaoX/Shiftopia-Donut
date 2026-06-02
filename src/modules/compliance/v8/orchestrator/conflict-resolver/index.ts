/**
 * Conflict Resolver — Main Orchestrator
 *
 * Single entry point: resolveConflicts()
 *
 * Full pipeline:
 *   1.  Merge config with defaults
 *   2.  Build catalogs (shift, employee, existing schedules)
 *   3.  Score all operations (standalone compliance + priority + business_weight)
 *   4.  Build structural conflict graph (RESOURCE_CONTENTION + TIME_OVERLAP)
 *   5.  Select resolution strategy:
 *         GREEDY  → run greedy MWIS
 *         SOLVER  → run greedy then 1-opt local search
 *         HYBRID  → choose based on n and conflict density
 *   6.  Final validation (full-schedule compliance per affected employee)
 *   7.  Assemble ConflictResolverResult
 *
 * HYBRID strategy thresholds (configurable):
 *   If n ≤ greedy_threshold_ops  OR density ≤ greedy_threshold_density:
 *     → GREEDY  (fast, deterministic)
 *   Else:
 *     → GREEDY first, then solver improvement with time_limit_ms budget
 *
 * This means GREEDY always runs; SOLVER is additive on top when warranted.
 */

import type {
    ConflictResolverInput,
    ConflictResolverResult,
    ConflictResolverConfig,
    ResolverStrategy,
    RejectedConflictOperation,
    ConflictResolverStateSummary,
    ScoredOperation,
} from './types';
import { DEFAULT_RESOLVER_CONFIG } from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext } from '../types';

import { scoreOperations }      from './scorer';
import { buildConflictGraph }   from './conflict-graph';
import { greedyResolve }        from './greedy-resolver';
import { solverResolve }        from './solver';
import { finalValidate }        from './validator';

// =============================================================================
// CONFIG MERGE
// =============================================================================

function mergeConfig(partial?: Partial<ConflictResolverConfig>): ConflictResolverConfig {
    return { ...DEFAULT_RESOLVER_CONFIG, ...partial };
}

// =============================================================================
// CATALOG BUILDERS
// =============================================================================

function buildCatalogs(input: ConflictResolverInput): {
    shift_catalog:       Map<V8ShiftId, V8OrchestratorShift>;
    employee_catalog:    Map<V8EmpId, V8EmployeeContext>;
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>;
} {
    const shift_catalog = new Map<V8ShiftId, V8OrchestratorShift>(
        input.base_state.shifts.map(s => [s.id, s]),
    );
    const employee_catalog = new Map<V8EmpId, V8EmployeeContext>(
        input.base_state.employees.map(e => [e.employee_id, e]),
    );
    const existing_shifts_map = new Map<V8EmpId, V8OrchestratorShift[]>(
        input.base_state.employee_existing_shifts.map(h => [h.employee_id, h.shifts]),
    );
    for (const emp of input.base_state.employees) {
        if (!existing_shifts_map.has(emp.employee_id)) {
            existing_shifts_map.set(emp.employee_id, []);
        }
    }
    return { shift_catalog, employee_catalog, existing_shifts_map };
}

// =============================================================================
// STRATEGY SELECTOR
// =============================================================================

function selectStrategy(
    n:       number,
    density: number,
    config:  ConflictResolverConfig,
): ResolverStrategy {
    if (config.strategy !== 'HYBRID') return config.strategy;
    if (n <= config.greedy_threshold_ops || density <= config.greedy_threshold_density) {
        return 'GREEDY';
    }
    return 'SOLVER';
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export function resolveConflicts(input: ConflictResolverInput): ConflictResolverResult {
    const t0     = performance.now();
    const config = mergeConfig(input.config);

    if (input.operations.length === 0) {
        return {
            selected_operations: [],
            rejected_operations: [],
            summary: {
                total_operations:   0,
                selected_count:     0,
                rejected_count:     0,
                affected_employees: [],
                affected_shifts:    [],
                strategy_used:      config.strategy,
                conflict_density:   0,
                evaluation_time_ms: 0,
                solver_improvement: 0,
            },
        };
    }

    // ── 1. Build catalogs ─────────────────────────────────────────────────────
    const { shift_catalog, employee_catalog, existing_shifts_map } = buildCatalogs(input);

    // ── 2. Score all operations ───────────────────────────────────────────────
    const scored = scoreOperations(
        input.operations,
        shift_catalog,
        employee_catalog,
        existing_shifts_map,
        config,
        input.base_state.employee_hours_28d,    // optional fairness data
    );

    // ── 3. Build conflict graph ───────────────────────────────────────────────
    const graph = buildConflictGraph(scored, shift_catalog);

    // ── 4. Select strategy ────────────────────────────────────────────────────
    const strategy = selectStrategy(input.operations.length, graph.density, config);

    // ── 5. Greedy resolution ──────────────────────────────────────────────────
    const greedy_result = greedyResolve(
        scored,
        graph,
        shift_catalog,
        employee_catalog,
        existing_shifts_map,
        config,
    );

    let final_selected:  ScoredOperation[]                 = greedy_result.selected;
    let all_rejected     = new Map(greedy_result.rejected);
    let solver_improvement = 0;

    // ── 6. Solver improvement (if SOLVER or HYBRID chose SOLVER) ──────────────
    if (strategy === 'SOLVER') {
        const solver_result = solverResolve(
            greedy_result,
            scored,
            graph,
            shift_catalog,
            employee_catalog,
            existing_shifts_map,
            config,
        );
        final_selected     = solver_result.selected;
        all_rejected       = solver_result.rejected;
        solver_improvement = solver_result.improvement;
    }

    // ── 7. Final validation ───────────────────────────────────────────────────
    const { validated_selected, demoted } = finalValidate(
        final_selected,
        shift_catalog,
        employee_catalog,
        existing_shifts_map,
        config,
    );

    for (const d of demoted) {
        all_rejected.set(d.operation_id, d);
    }

    // ── 8. Assemble result ────────────────────────────────────────────────────
    const selected_ops = validated_selected.map(s => s.op);

    const affected_employees = [
        ...new Set(selected_ops.flatMap(op => op.employee_ids)),
    ];
    const affected_shifts = [
        ...new Set(selected_ops.flatMap(op => op.shift_ids)),
    ];

    const summary: ConflictResolverStateSummary = {
        total_operations:   input.operations.length,
        selected_count:     selected_ops.length,
        rejected_count:     all_rejected.size,
        affected_employees,
        affected_shifts,
        strategy_used:      strategy,
        conflict_density:   Math.round(graph.density * 1000) / 1000,
        evaluation_time_ms: Math.round((performance.now() - t0) * 100) / 100,
        solver_improvement: Math.round(solver_improvement * 100) / 100,
    };

    return {
        selected_operations: selected_ops,
        rejected_operations: [...all_rejected.values()],
        summary,
    };
}

// =============================================================================
// PUBLIC RE-EXPORTS
// =============================================================================

export type {
    ConflictResolverInput,
    ConflictResolverResult,
    ConflictResolverConfig,
    ConflictOperation,
    ScheduleChange,
    ConflictGraph,
    ConflictEdge,
    ScoredOperation,
    RejectedConflictOperation,
    ConflictResolverStateSummary,
    ResolverStrategy,
    ConflictV8OperationType,
} from './types';

export { DEFAULT_RESOLVER_CONFIG } from './types';
