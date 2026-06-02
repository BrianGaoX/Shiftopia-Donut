/**
 * Conflict Resolver — Structural Conflict Graph Builder
 *
 * Builds the undirected conflict graph in two passes:
 *
 *   Pass 1 — RESOURCE_CONTENTION:
 *     Two operations that both assign (add) the SAME shift_id to any employee
 *     conflict: only one can be committed (shift can only have one owner).
 *     Index: shift_id → ops that include it in any add_shift_ids.
 *
 *   Pass 2 — TIME_OVERLAP:
 *     Two operations that add shifts to the SAME employee, where those
 *     shifts overlap temporally (or violate rest gap).
 *     Index: employee_id → ops that add shifts for that employee.
 *
 * Complexity: O(k² × s) per employee, where k = ops per employee and
 * s = shifts per op (bounded by 2 for SWAP). For 1000 ops spread across
 * 200 employees that is ≈ (5² × 2) × 200 = 10,000 comparisons — trivial.
 *
 * Note: this graph captures STRUCTURAL conflicts only.
 * Aggregate compliance violations (daily hours, consecutive days, etc.)
 * are discovered per-step during greedy selection via the compliance engine.
 * Adding them as graph edges would require O(n²) compliance calls.
 */

import type {
    ConflictOperation,
    ConflictGraph,
    ConflictEdge,
    ScoredOperation,
} from './types';
import type { V8ShiftId, V8EmpId, V8OrchestratorShift } from '../types';
import { toAbsoluteMinutes } from '../windows';

const MINUTES_PER_DAY  = 1440;
const REST_GAP_MINUTES = 10 * 60;    // 10h default; structural pre-filter only

// =============================================================================
// INTERVAL HELPERS
// =============================================================================

function absInterval(shift: V8OrchestratorShift): [number, number] {
    const s = toAbsoluteMinutes(shift.date, shift.start_time);
    const e = toAbsoluteMinutes(shift.date, shift.end_time);
    return [s, e <= s ? e + MINUTES_PER_DAY : e];
}

function intervalsOverlapOrRestGap(
    aShift: V8OrchestratorShift,
    bShift: V8OrchestratorShift,
): { overlaps: boolean; rest_gap_violation: boolean } {
    const [aS, aE] = absInterval(aShift);
    const [bS, bE] = absInterval(bShift);

    const overlaps = aS < bE && bS < aE;

    const gap1 = bS - aE;
    const gap2 = aS - bE;
    const rest_gap_violation =
        !overlaps && (
            (gap1 > 0 && gap1 < REST_GAP_MINUTES) ||
            (gap2 > 0 && gap2 < REST_GAP_MINUTES)
        );

    return { overlaps, rest_gap_violation };
}

// =============================================================================
// CONFLICT GRAPH BUILDER
// =============================================================================

export function buildConflictGraph(
    scored:         ScoredOperation[],
    shift_catalog:  Map<V8ShiftId, V8OrchestratorShift>,
): ConflictGraph {
    const nodes     = new Map<string, ConflictOperation>(
        scored.map(s => [s.op.operation_id, s.op]),
    );
    const edges:    ConflictEdge[]              = [];
    const adjacency = new Map<string, Set<string>>();

    for (const { op } of scored) adjacency.set(op.operation_id, new Set());

    function addConflict(a_id: string, b_id: string, edge: ConflictEdge): void {
        // Avoid duplicate edges (undirected)
        if (!adjacency.get(a_id)!.has(b_id)) {
            edges.push(edge);
            adjacency.get(a_id)!.add(b_id);
            adjacency.get(b_id)!.add(a_id);
        }
    }

    // ── Pass 1: RESOURCE_CONTENTION ───────────────────────────────────────────
    // shift_id → ops that ADD this shift (claim ownership)
    const shift_claimants = new Map<V8ShiftId, string[]>();

    for (const { op } of scored) {
        for (const change of op.schedule_changes) {
            for (const sid of change.add_shift_ids) {
                if (!shift_claimants.has(sid)) shift_claimants.set(sid, []);
                shift_claimants.get(sid)!.push(op.operation_id);
            }
        }
    }

    for (const [shift_id, op_ids] of shift_claimants) {
        if (op_ids.length < 2) continue;
        for (let i = 0; i < op_ids.length; i++) {
            for (let j = i + 1; j < op_ids.length; j++) {
                addConflict(op_ids[i], op_ids[j], {
                    op_id_a: op_ids[i],
                    op_id_b: op_ids[j],
                    kind:    'RESOURCE_CONTENTION',
                    reason:  `Both operations assign shift ${shift_id} — only one employee can hold a shift.`,
                });
            }
        }
    }

    // ── Pass 2: TIME_OVERLAP / REST_GAP ───────────────────────────────────────
    // employee_id → list of (op_id, V8OrchestratorShift[]) for shifts being ADDED to that employee
    const emp_adds = new Map<V8EmpId, Array<{ op_id: string; shift: V8OrchestratorShift }>>();

    for (const { op } of scored) {
        for (const change of op.schedule_changes) {
            if (change.add_shift_ids.length === 0) continue;
            if (!emp_adds.has(change.employee_id)) emp_adds.set(change.employee_id, []);
            for (const sid of change.add_shift_ids) {
                const shift = shift_catalog.get(sid);
                if (!shift) continue;
                emp_adds.get(change.employee_id)!.push({ op_id: op.operation_id, shift });
            }
        }
    }

    for (const [emp_id, entries] of emp_adds) {
        if (entries.length < 2) continue;

        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const a = entries[i];
                const b = entries[j];
                if (a.op_id === b.op_id) continue;    // same op (SWAP) — handled internally

                const { overlaps, rest_gap_violation } = intervalsOverlapOrRestGap(a.shift, b.shift);

                if (overlaps) {
                    addConflict(a.op_id, b.op_id, {
                        op_id_a: a.op_id,
                        op_id_b: b.op_id,
                        kind:    'TIME_OVERLAP',
                        reason:
                            `Both operations schedule overlapping shifts for employee ${emp_id}: `
                            + `${a.shift.id} (${a.shift.date} ${a.shift.start_time}–${a.shift.end_time}) `
                            + `↔ ${b.shift.id} (${b.shift.date} ${b.shift.start_time}–${b.shift.end_time}).`,
                    });
                } else if (rest_gap_violation) {
                    addConflict(a.op_id, b.op_id, {
                        op_id_a: a.op_id,
                        op_id_b: b.op_id,
                        kind:    'TIME_OVERLAP',
                        reason:
                            `Operations schedule back-to-back shifts for employee ${emp_id} `
                            + `with < 10h rest gap: ${a.shift.id} and ${b.shift.id}.`,
                    });
                }
            }
        }
    }

    // Density = actual edges / max possible edges
    const n       = scored.length;
    const max_e   = n > 1 ? (n * (n - 1)) / 2 : 1;
    const density = edges.length / max_e;

    return { nodes, edges, adjacency, density };
}
