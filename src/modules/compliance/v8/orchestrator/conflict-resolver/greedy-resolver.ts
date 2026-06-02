/**
 * Conflict Resolver — Greedy Maximum-Weight Independent Set
 *
 * Algorithm:
 *   1. Sort scored operations by composite_score descending.
 *      Tiebreaker: fewer conflicts (lower degree) first, then operation_id.
 *   2. Maintain a tentative schedule per employee
 *      (existing_shifts_map + shifts from already-selected ops).
 *   3. For each operation in sorted order:
 *        a. STRUCTURAL check: if any already-selected op is in this op's
 *           conflict adjacency → skip (O(1) set lookup).
 *        b. COMPLIANCE check: for each employee in op.schedule_changes,
 *           run runV8Orchestrator against their tentative schedule.
 *           If any employee is BLOCKING (or WARNING when !accept_warnings) → skip.
 *        c. ACCEPT: update tentative schedules, mark op as selected.
 *   4. Return selected set + per-op rejection reasons.
 *
 * Why compliance per-step matters:
 *   Structural conflicts catch time overlaps between two operations.
 *   Compliance catches AGGREGATE violations (daily hours, 28-day working
 *   days, consecutive streaks) that only emerge when an employee already
 *   has other ops selected.
 *
 * Performance:
 *   O(n log n) sort + O(n × k × rules) compliance where k = avg employees/op.
 *   For n=1000, k=1.5, rules=12: ~18,000 rule invocations. Fast.
 *   The compliance engine's LRU cache absorbs repeated calls.
 */

import type {
    ScoredOperation,
    ConflictGraph,
    ConflictResolverConfig,
    RejectedConflictOperation,
} from './types';
import type {
    V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext, V8OrchestratorInput, V8Status,
} from '../types';
import { runV8Orchestrator } from '../index';

// =============================================================================
// TENTATIVE SCHEDULE MANAGEMENT
// =============================================================================

function applyOp(
    op_schedule_changes: ScoredOperation['op']['schedule_changes'],
    tentative:           Map<V8EmpId, V8OrchestratorShift[]>,
    shift_catalog:       Map<V8ShiftId, V8OrchestratorShift>,
): void {
    for (const change of op_schedule_changes) {
        const current = tentative.get(change.employee_id) ?? [];
        const after_removes = current.filter(s => !change.remove_shift_ids.includes(s.id));
        const added_shifts   = change.add_shift_ids
            .map(id => shift_catalog.get(id))
            .filter((s): s is V8OrchestratorShift => s !== undefined);
        tentative.set(change.employee_id, [...after_removes, ...added_shifts]);
    }
}

// =============================================================================
// PER-OP COMPLIANCE CHECK AGAINST TENTATIVE SCHEDULE
// =============================================================================

function checkOpCompliance(
    scored:          ScoredOperation,
    tentative:       Map<V8EmpId, V8OrchestratorShift[]>,
    shift_catalog:   Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog: Map<V8EmpId, V8EmployeeContext>,
    config:          ConflictResolverConfig,
): { status: V8Status; rule_hits: import('../types').V8Hit[] } {
    const rank = (s: V8Status) => s === 'BLOCKING' ? 2 : s === 'WARNING' ? 1 : 0;
    let worst_status: V8Status = 'PASS';
    const all_hits: import('../types').V8Hit[] = [];

    for (const change of scored.op.schedule_changes) {
        const employee_context = employee_catalog.get(change.employee_id);
        if (!employee_context) continue;

        // Existing = CURRENT tentative schedule (includes ops already selected)
        const existing_shifts = tentative.get(change.employee_id) ?? [];

        const add_shifts = change.add_shift_ids
            .map(id => shift_catalog.get(id))
            .filter((s): s is V8OrchestratorShift => s !== undefined);

        if (add_shifts.length === 0 && change.remove_shift_ids.length === 0) continue;

        const input: V8OrchestratorInput = {
            employee_id:       change.employee_id,
            employee_context,
            existing_shifts,
            candidate_changes: {
                add_shifts,
                remove_shifts: change.remove_shift_ids,
            },
            mode:              'SIMULATED',
            operation_type:    scored.op.type === 'SWAP_APPROVE' ? 'SWAP'
                               : scored.op.type === 'BID_ACCEPT'  ? 'BID'
                               : 'ASSIGN',
            stage:             config.compliance_stage,
            config:            config.compliance_config,
        };

        const result = runV8Orchestrator(input, { stage: config.compliance_stage });
        if (rank(result.overall_status) > rank(worst_status)) worst_status = result.overall_status;
        all_hits.push(...result.hits);
    }

    return { status: worst_status, rule_hits: all_hits };
}

// =============================================================================
// GREEDY SELECTION RESULT
// =============================================================================

export interface GreedyResult {
    selected:  ScoredOperation[];
    rejected:  Map<string, RejectedConflictOperation>;
    total_score: number;
}

// =============================================================================
// MAIN GREEDY RESOLVER
// =============================================================================

export function greedyResolve(
    scored:               ScoredOperation[],
    graph:                ConflictGraph,
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
): GreedyResult {
    // Sort: higher score first; ties broken by lower conflict degree (less contentious op first),
    // then by operation_id for full determinism.
    const sorted = [...scored].sort((a, b) => {
        if (b.composite_score !== a.composite_score) return b.composite_score - a.composite_score;
        const deg_a = graph.adjacency.get(a.op.operation_id)?.size ?? 0;
        const deg_b = graph.adjacency.get(b.op.operation_id)?.size ?? 0;
        if (deg_a !== deg_b) return deg_a - deg_b;    // fewer conflicts first
        return a.op.operation_id < b.op.operation_id ? -1 : 1;
    });

    const selected    = new Set<string>();
    const selected_ops: ScoredOperation[] = [];
    const rejected    = new Map<string, RejectedConflictOperation>();

    // Clone existing schedules for mutation
    const tentative = new Map<V8EmpId, V8OrchestratorShift[]>();
    for (const [eid, shifts] of existing_shifts_map) {
        tentative.set(eid, [...shifts]);
    }

    let total_score = 0;

    for (const s of sorted) {
        const op_id = s.op.operation_id;

        // ── a. Structural conflict check ──────────────────────────────────────
        const conflicts = graph.adjacency.get(op_id) ?? new Set<string>();
        const blocker   = [...conflicts].find(cid => selected.has(cid));

        if (blocker) {
            const blocker_edge = graph.edges.find(
                e => (e.op_id_a === op_id && e.op_id_b === blocker) ||
                     (e.op_id_b === op_id && e.op_id_a === blocker),
            );
            rejected.set(op_id, {
                operation_id:              op_id,
                reason:                    blocker_edge
                    ? `Structural conflict with accepted operation ${blocker}: ${blocker_edge.reason}`
                    : `Structural conflict with accepted operation ${blocker}.`,
                rule_hits:                 [],
                conflicting_operation_ids: [blocker],
            });
            continue;
        }

        // ── b. Compliance check against tentative schedule ────────────────────
        const { status, rule_hits } = checkOpCompliance(
            s, tentative, shift_catalog, employee_catalog, config,
        );

        const is_blocked =
            status === 'BLOCKING' ||
            (status === 'WARNING' && !config.accept_warnings);

        if (is_blocked) {
            const blocking_ids = rule_hits.filter(h => h.status === 'BLOCKING').map(h => h.rule_id);
            rejected.set(op_id, {
                operation_id:              op_id,
                reason:                    `Compliance check against current selection failed: ${blocking_ids.join(', ') || status}.`,
                rule_hits,
                conflicting_operation_ids: [],
            });
            continue;
        }

        // ── c. Accept ─────────────────────────────────────────────────────────
        selected.add(op_id);
        selected_ops.push(s);
        total_score += s.composite_score;
        applyOp(s.op.schedule_changes, tentative, shift_catalog);
    }

    return { selected: selected_ops, rejected, total_score };
}
