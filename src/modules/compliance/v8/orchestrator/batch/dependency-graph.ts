/**
 * Batch Executor — Dependency Graph Builder
 *
 * Builds a directed graph of operations where:
 *
 *   DEPENDENCY edges (A → B means A must complete before B):
 *     - A REMOVE on a shift must precede any ADD on the same shift
 *       (ensures a clean intermediate state — no double-assignment)
 *
 *   CONFLICT edges (undirected / bi-directional):
 *     - RESOURCE_CONTENTION: two ADD atomics claim the same shift_id
 *       (only one employee can hold a shift at a time)
 *     - TIME_OVERLAP: two ADD atomics assign overlapping shifts to
 *       the same employee (compliance would catch it, but we flag it
 *       structurally here for fast rejection without running the engine)
 *
 * Nodes are the parent BatchOperations (not individual atomics).
 * Edges reference parent operation IDs.
 *
 * After building, the ordering engine runs Kahn's algorithm on the DEPENDENCY
 * sub-graph; conflict edges are consumed by the conflict-resolver.
 */

import type {
    BatchOperation,
    AtomicOperation,
    OperationGraph,
    GraphEdge,
    NormalizationResult,
} from './types';
import type { V8ShiftId, V8EmpId } from '../types';
import { toAbsoluteMinutes } from '../windows';

// =============================================================================
// HELPERS
// =============================================================================

/** True if the two [start, end) minute intervals overlap (shared endpoint = no overlap) */
function intervalsOverlap(
    aStart: number, aEnd: number,
    bStart: number, bEnd: number,
): boolean {
    // Cross-midnight: end < start means the shift wraps past midnight.
    // We normalise by extending end by MINUTES_PER_DAY when it wraps.
    const MPDAY = 1440;
    const aE = aEnd <= aStart ? aEnd + MPDAY : aEnd;
    const bE = bEnd <= bStart ? bEnd + MPDAY : bEnd;
    return aStart < bE && bStart < aE;
}

function shiftAbsStart(a: AtomicOperation): number {
    return toAbsoluteMinutes(a.shift.date, a.shift.start_time);
}

function shiftAbsEnd(a: AtomicOperation): number {
    return toAbsoluteMinutes(a.shift.date, a.shift.end_time);
}

// =============================================================================
// GRAPH BUILDER
// =============================================================================

export function buildDependencyGraph(
    norm: NormalizationResult,
): OperationGraph {
    const { valid_operations, atomics } = norm;

    // Initialise graph containers
    const nodes       = new Map<string, BatchOperation>(
        valid_operations.map(op => [op.operation_id, op]),
    );
    const edges:       GraphEdge[]              = [];
    const dependents   = new Map<string, Set<string>>();
    const dependencies = new Map<string, Set<string>>();
    const conflicts    = new Map<string, Set<string>>();

    for (const op of valid_operations) {
        dependents.set(op.operation_id,   new Set());
        dependencies.set(op.operation_id, new Set());
        conflicts.set(op.operation_id,    new Set());
    }

    // Flatten all atomics so we can index them
    const allAtomics: AtomicOperation[] = [];
    for (const [, ops] of atomics) {
        allAtomics.push(...ops);
    }

    // ── Index: shift_id → ADD atomics (parent_op_id) ──────────────────────────
    // ADD atomics that claim a given shift
    const addsByShift   = new Map<V8ShiftId, AtomicOperation[]>();
    // REMOVE atomics that release a given shift
    const removesByShift = new Map<V8ShiftId, AtomicOperation[]>();

    // Index: employee_id → ADD atomics (for TIME_OVERLAP detection)
    const addsByEmployee = new Map<V8EmpId, AtomicOperation[]>();

    for (const atomic of allAtomics) {
        const sid = atomic.shift.id;
        if (atomic.type === 'ADD_EMPLOYEE_SHIFT') {
            if (!addsByShift.has(sid)) addsByShift.set(sid, []);
            addsByShift.get(sid)!.push(atomic);

            const eid = atomic.employee_id;
            if (!addsByEmployee.has(eid)) addsByEmployee.set(eid, []);
            addsByEmployee.get(eid)!.push(atomic);
        } else {
            if (!removesByShift.has(sid)) removesByShift.set(sid, []);
            removesByShift.get(sid)!.push(atomic);
        }
    }

    // ── DEPENDENCY edges: REMOVE(shift_X) must precede ADD(shift_X) ───────────
    for (const [shiftId, removeAtomics] of removesByShift) {
        const addAtomics = addsByShift.get(shiftId) ?? [];
        for (const rem of removeAtomics) {
            for (const add of addAtomics) {
                const fromOp = rem.parent_operation_id;
                const toOp   = add.parent_operation_id;
                if (fromOp === toOp) continue;         // same parent — already sequenced internally
                if (dependencies.get(toOp)!.has(fromOp)) continue; // already recorded

                edges.push({
                    from_op_id: fromOp,
                    to_op_id:   toOp,
                    type:       'DEPENDENCY',
                    reason:     `REMOVE on shift ${shiftId} (op ${fromOp}) must precede ADD on same shift (op ${toOp})`,
                });
                dependents.get(fromOp)!.add(toOp);
                dependencies.get(toOp)!.add(fromOp);
            }
        }
    }

    // ── CONFLICT: RESOURCE_CONTENTION — multiple ADDs for same shift ───────────
    for (const [shiftId, adds] of addsByShift) {
        // Group by parent op — one parent may have multiple atomics (SWAP)
        // but each parent can only ADD a given shift once
        const parentsSeen = new Set<string>();
        const distinctAdds: AtomicOperation[] = [];
        for (const a of adds) {
            if (!parentsSeen.has(a.parent_operation_id)) {
                parentsSeen.add(a.parent_operation_id);
                distinctAdds.push(a);
            }
        }

        if (distinctAdds.length < 2) continue;

        // Every pair is a conflict if they're assigning to DIFFERENT employees
        for (let i = 0; i < distinctAdds.length; i++) {
            for (let j = i + 1; j < distinctAdds.length; j++) {
                const aOp = distinctAdds[i].parent_operation_id;
                const bOp = distinctAdds[j].parent_operation_id;
                if (distinctAdds[i].employee_id === distinctAdds[j].employee_id) continue;

                edges.push({
                    from_op_id: aOp,
                    to_op_id:   bOp,
                    type:       'CONFLICT',
                    reason:     `Both ops assign shift ${shiftId} to different employees (RESOURCE_CONTENTION)`,
                });
                conflicts.get(aOp)!.add(bOp);
                conflicts.get(bOp)!.add(aOp);
            }
        }
    }

    // ── CONFLICT: TIME_OVERLAP — same employee, overlapping ADD shifts ─────────
    for (const [empId, adds] of addsByEmployee) {
        if (adds.length < 2) continue;

        for (let i = 0; i < adds.length; i++) {
            for (let j = i + 1; j < adds.length; j++) {
                const aOp = adds[i].parent_operation_id;
                const bOp = adds[j].parent_operation_id;
                if (aOp === bOp) continue;    // same parent (SWAP — internal sequencing handles it)

                // Skip if conflict already recorded
                if (conflicts.get(aOp)!.has(bOp)) continue;

                const aStart = shiftAbsStart(adds[i]);
                const aEnd   = shiftAbsEnd(adds[i]);
                const bStart = shiftAbsStart(adds[j]);
                const bEnd   = shiftAbsEnd(adds[j]);

                if (intervalsOverlap(aStart, aEnd, bStart, bEnd)) {
                    edges.push({
                        from_op_id: aOp,
                        to_op_id:   bOp,
                        type:       'CONFLICT',
                        reason:
                            `Both ops add overlapping shifts for employee ${empId} `
                            + `(${adds[i].shift.id} ↔ ${adds[j].shift.id}) (TIME_OVERLAP)`,
                    });
                    conflicts.get(aOp)!.add(bOp);
                    conflicts.get(bOp)!.add(aOp);
                }
            }
        }
    }

    return { nodes, edges, dependents, dependencies, conflicts };
}
