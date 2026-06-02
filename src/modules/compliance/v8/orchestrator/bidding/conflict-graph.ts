/**
 * Bidding Engine — Per-Employee Structural Conflict Graph
 *
 * Detects STRUCTURAL conflicts between an employee's bids BEFORE running
 * full compliance. Two types are detected:
 *
 *   TIME_OVERLAP  — two bids produce temporally overlapping shifts
 *   REST_GAP      — two bids would violate the minimum rest gap
 *                   (end of one shift to start of the next < rest_gap_hours)
 *
 * Outputs EmployeeBidConflictGroup[] — connected components via union-find.
 * Each group contains bid IDs that are mutually exclusive: at most ONE bid
 * from each group can be selected without structural conflict.
 *
 * Usage:
 *   The conflict graph is informational and used by the selection engine
 *   as a FAST pre-filter. Full compliance validation still runs during
 *   selection to catch multi-shift hour limits and other aggregate rules.
 *
 * Performance: O(k²) per employee where k = bids per employee.
 * For practical batch sizes (≤ 20 bids/employee) this is negligible.
 */

import type { EvaluatedBid, BidConflictEdge, EmployeeBidConflictGroup } from './types';
import type { V8EmpId } from '../types';
import { toAbsoluteMinutes } from '../windows';

const MINUTES_PER_DAY = 1440;

// =============================================================================
// INTERVAL OVERLAP / REST GAP HELPERS
// =============================================================================

function absoluteInterval(eb: EvaluatedBid): [number, number] {
    const start = toAbsoluteMinutes(eb.shift.date, eb.shift.start_time);
    const end   = toAbsoluteMinutes(eb.shift.date, eb.shift.end_time);
    // Cross-midnight: end on same date but before start
    return [start, end <= start ? end + MINUTES_PER_DAY : end];
}

function shiftsOverlap(a: EvaluatedBid, b: EvaluatedBid): boolean {
    const [aS, aE] = absoluteInterval(a);
    const [bS, bE] = absoluteInterval(b);
    // [aS, aE) and [bS, bE) overlap iff aS < bE && bS < aE
    return aS < bE && bS < aE;
}

function violatesRestGap(a: EvaluatedBid, b: EvaluatedBid, rest_gap_minutes: number): boolean {
    // Same-day split shifts have no rest gap requirement — only cross-day pairs.
    if (a.shift.date === b.shift.date) return false;

    const [aS, aE] = absoluteInterval(a);
    const [bS, bE] = absoluteInterval(b);

    // Gap from a.end to b.start
    const gap1 = bS - aE;
    // Gap from b.end to a.start
    const gap2 = aS - bE;

    // One of the gaps must be positive (they don't overlap) for a rest gap to apply
    if (gap1 > 0 && gap1 < rest_gap_minutes) return true;
    if (gap2 > 0 && gap2 < rest_gap_minutes) return true;
    return false;
}

// =============================================================================
// UNION-FIND  (for grouping connected components)
// =============================================================================

class UnionFind {
    private parent = new Map<string, string>();

    find(x: string): string {
        if (!this.parent.has(x)) this.parent.set(x, x);
        let root = x;
        while (this.parent.get(root) !== root) root = this.parent.get(root)!;
        // Path compression
        let cur = x;
        while (cur !== root) {
            const next = this.parent.get(cur)!;
            this.parent.set(cur, root);
            cur = next;
        }
        return root;
    }

    union(x: string, y: string): void {
        const rx = this.find(x);
        const ry = this.find(y);
        if (rx !== ry) this.parent.set(rx, ry);
    }
}

// =============================================================================
// MAIN BUILDER
// =============================================================================

export function buildBidConflictGraph(
    evaluated:       EvaluatedBid[],
    rest_gap_hours:  number,
): EmployeeBidConflictGroup[] {
    const rest_gap_minutes = rest_gap_hours * 60;

    // Group evaluated bids by employee
    const by_employee = new Map<V8EmpId, EvaluatedBid[]>();
    for (const eb of evaluated) {
        const eid = eb.bid.employee_id;
        if (!by_employee.has(eid)) by_employee.set(eid, []);
        by_employee.get(eid)!.push(eb);
    }

    const groups: EmployeeBidConflictGroup[] = [];
    let groupSeq = 0;

    for (const [employee_id, emp_bids] of by_employee) {
        if (emp_bids.length < 2) continue;    // no conflicts possible with single bid

        const edges:  BidConflictEdge[] = [];
        const uf      = new UnionFind();
        const allIds  = emp_bids.map(eb => eb.bid.bid_id);

        // Seed union-find with all bid IDs
        for (const id of allIds) uf.find(id);

        for (let i = 0; i < emp_bids.length; i++) {
            for (let j = i + 1; j < emp_bids.length; j++) {
                const a = emp_bids[i];
                const b = emp_bids[j];

                if (shiftsOverlap(a, b)) {
                    edges.push({
                        bid_id_a: a.bid.bid_id,
                        bid_id_b: b.bid.bid_id,
                        kind:     'TIME_OVERLAP',
                        reason:
                            `Shift ${a.shift.id} (${a.shift.date} ${a.shift.start_time}–${a.shift.end_time}) `
                            + `overlaps with shift ${b.shift.id} (${b.shift.date} ${b.shift.start_time}–${b.shift.end_time})`,
                    });
                    uf.union(a.bid.bid_id, b.bid.bid_id);
                } else if (violatesRestGap(a, b, rest_gap_minutes)) {
                    edges.push({
                        bid_id_a: a.bid.bid_id,
                        bid_id_b: b.bid.bid_id,
                        kind:     'REST_GAP',
                        reason:
                            `Gap between shift ${a.shift.id} and shift ${b.shift.id} `
                            + `is less than ${rest_gap_hours}h rest requirement.`,
                    });
                    uf.union(a.bid.bid_id, b.bid.bid_id);
                }
            }
        }

        if (edges.length === 0) continue;    // no structural conflicts for this employee

        // Build connected components
        const component_map = new Map<string, string[]>();
        for (const id of allIds) {
            const root = uf.find(id);
            if (!component_map.has(root)) component_map.set(root, []);
            component_map.get(root)!.push(id);
        }

        for (const [, bid_ids] of component_map) {
            if (bid_ids.length < 2) continue;    // singletons are not conflicts

            const component_edges = edges.filter(
                e => bid_ids.includes(e.bid_id_a) && bid_ids.includes(e.bid_id_b),
            );

            groups.push({
                employee_id,
                group_id: `cg:${employee_id}:${groupSeq++}`,
                bid_ids,
                edges: component_edges,
            });
        }
    }

    return groups;
}
