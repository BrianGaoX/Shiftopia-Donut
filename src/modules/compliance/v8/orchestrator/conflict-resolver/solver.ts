/**
 * Conflict Resolver — 1-opt Local Search Optimizer
 *
 * NOTE: Despite the filename, this is NOT a MILP or linear-programming solver.
 * It is a 1-opt local search heuristic for the Maximum Weight Independent Set
 * (MWIS) problem. "Solver" here means "finds a good solution", not "solves
 * exactly via mathematical programming". For constraint descriptor generation
 * (the LP/CP interface), see constraints.ts.
 *
 * Improves on the greedy solution using a 1-opt local search for the
 * Maximum Weight Independent Set (MWIS) problem.
 *
 * Why MWIS?
 *   The conflict graph is an undirected graph where edges represent
 *   incompatible operations. Finding the maximum-score subset of
 *   non-conflicting operations IS the MWIS problem — NP-hard in general,
 *   but efficiently approximated in practice for roster-scale graphs.
 *
 * Algorithm: Greedy + 1-opt Augmentation
 * ─────────────────────────────────────
 *   Phase 1: Run the greedy resolver to get an initial solution S.
 *
 *   Phase 2: 1-opt improvement loop (until stable or time limit):
 *     For each rejected op R (in score-desc order):
 *       blockers = {ops in S that conflict with R}
 *
 *       Case A — Zero blockers (structural):
 *         R was rejected only due to compliance. Re-try it against the
 *         current selection. If it now passes: add it.
 *
 *       Case B — One or more blockers with lower combined score:
 *         gain = score(R) - Σ score(blockers)
 *         If gain > 0:
 *           Tentatively remove all blockers from S, add R.
 *           Run compliance for affected employees.
 *           If valid: commit the swap (mark as improvement).
 *
 *   Phase 3: Repeat Phase 2 until no improvement found in a full sweep
 *            or total elapsed time > time_limit_ms.
 *
 * Quality vs. performance:
 *   - A single 1-opt sweep is O(|rejected| × max_blockers × compliance_calls).
 *   - For dense graphs: max_blockers is bounded by op degree (typically ≤ 20).
 *   - Hard time limit ensures we never exceed the budget.
 *   - Returns the best solution found when time expires.
 *
 * Determinism:
 *   Phase 2 is fully deterministic when time limit is not hit
 *   (processing order is score-desc, then operation_id tie-break).
 */

import type {
    ScoredOperation,
    ConflictGraph,
    ConflictResolverConfig,
    RejectedConflictOperation,
} from './types';
import type {
    V8OrchestratorShift, V8ShiftId, V8EmpId, V8EmployeeContext, V8OrchestratorInput, V8Status,
    V8Hit,
} from '../types';
import type { GreedyResult } from './greedy-resolver';
import { runV8Orchestrator } from '../index';

// =============================================================================
// COMPLIANCE CHECK FOR A CANDIDATE SELECTION
// =============================================================================

/**
 * Check whether the given ops_to_add are valid when added to base_schedule
 * (which already excludes ops_to_remove).
 */
function checkCandidateCompliance(
    ops_to_add:        ScoredOperation[],
    base_tentative:    Map<V8EmpId, V8OrchestratorShift[]>,
    shift_catalog:     Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:  Map<V8EmpId, V8EmployeeContext>,
    config:            ConflictResolverConfig,
): { ok: boolean; rule_hits: V8Hit[] } {
    // Build a merged tentative schedule that includes all ops_to_add
    const tentative = new Map<V8EmpId, V8OrchestratorShift[]>(
        [...base_tentative].map(([k, v]) => [k, [...v]]),
    );

    const all_hits: V8Hit[] = [];
    const rank = (s: V8Status) => s === 'BLOCKING' ? 2 : s === 'WARNING' ? 1 : 0;

    for (const s of ops_to_add) {
        for (const change of s.op.schedule_changes) {
            const employee_context = employee_catalog.get(change.employee_id);
            if (!employee_context) continue;

            const existing = tentative.get(change.employee_id) ?? [];
            const add_shifts = change.add_shift_ids
                .map(id => shift_catalog.get(id))
                .filter((sh): sh is V8OrchestratorShift => sh !== undefined);

            if (add_shifts.length === 0 && change.remove_shift_ids.length === 0) continue;

            const input: V8OrchestratorInput = {
                employee_id:       change.employee_id,
                employee_context,
                existing_shifts:   existing,
                candidate_changes: {
                    add_shifts,
                    remove_shifts: change.remove_shift_ids,
                },
                mode:              'SIMULATED',
                operation_type:    s.op.type === 'SWAP_APPROVE' ? 'SWAP'
                                   : s.op.type === 'BID_ACCEPT'  ? 'BID'
                                   : 'ASSIGN',
                stage:             config.compliance_stage,
                config:            config.compliance_config,
            };

            const result = runV8Orchestrator(input, { stage: config.compliance_stage });
            all_hits.push(...result.hits);

            const blocked =
                rank(result.overall_status) === 2 ||
                (rank(result.overall_status) === 1 && !config.accept_warnings);

            if (blocked) return { ok: false, rule_hits: all_hits };

            // Update tentative for subsequent ops in this loop
            const after_removes = existing.filter(sh => !change.remove_shift_ids.includes(sh.id));
            tentative.set(change.employee_id, [...after_removes, ...add_shifts]);
        }
    }

    return { ok: true, rule_hits: all_hits };
}

// =============================================================================
// BUILD TENTATIVE SCHEDULE FROM A SELECTION SET
// =============================================================================

function buildTentativeFromSelection(
    selected:            ScoredOperation[],
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>,
    shift_catalog:       Map<V8ShiftId, V8OrchestratorShift>,
): Map<V8EmpId, V8OrchestratorShift[]> {
    const tentative = new Map<V8EmpId, V8OrchestratorShift[]>(
        [...existing_shifts_map].map(([k, v]) => [k, [...v]]),
    );

    for (const s of selected) {
        for (const change of s.op.schedule_changes) {
            const current = tentative.get(change.employee_id) ?? [];
            const after_removes = current.filter(sh => !change.remove_shift_ids.includes(sh.id));
            const added = change.add_shift_ids
                .map(id => shift_catalog.get(id))
                .filter((sh): sh is V8OrchestratorShift => sh !== undefined);
            tentative.set(change.employee_id, [...after_removes, ...added]);
        }
    }

    return tentative;
}

// =============================================================================
// SOLVER RESULT
// =============================================================================

export interface SolverResult extends GreedyResult {
    improvement:    number;    // total score gained by local search (0 = greedy only)
    sweeps:         number;    // number of 1-opt sweeps completed
    time_elapsed_ms: number;
}

// =============================================================================
// 1-OPT LOCAL SEARCH
// =============================================================================

export function solverResolve(
    greedy_result:        GreedyResult,
    scored_all:           ScoredOperation[],
    graph:                ConflictGraph,
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
): SolverResult {
    const t0       = performance.now();
    const deadline = t0 + config.time_limit_ms;

    // Working copies — mutated during local search
    let selected = [...greedy_result.selected];
    let rejected  = new Map(greedy_result.rejected);
    let total_score = greedy_result.total_score;

    const selected_set = new Set<string>(selected.map(s => s.op.operation_id));

    // Rejected ops sorted by score desc (process highest-value first)
    const rejected_by_score = scored_all
        .filter(s => !selected_set.has(s.op.operation_id))
        .sort((a, b) => {
            if (b.composite_score !== a.composite_score) return b.composite_score - a.composite_score;
            return a.op.operation_id < b.op.operation_id ? -1 : 1;
        });

    let improvement  = 0;
    let sweeps       = 0;

    // ── Sweep-atomic 1-opt loop ────────────────────────────────────────────────
    // Each sweep is committed ONLY if it finishes before the deadline.
    // If the deadline fires mid-sweep we RESTORE the pre-sweep snapshot.
    // Guarantee: same input → same output regardless of CPU load / timing.
    // ──────────────────────────────────────────────────────────────────────────

    while (performance.now() < deadline) {
        // Snapshot state at the start of this sweep
        const snap_selected     = [...selected];
        const snap_selected_set = new Set(selected_set);
        const snap_rejected     = new Map(rejected);
        const snap_total_score  = total_score;

        let sweep_improved = false;
        let timed_out      = false;
        sweeps++;

        for (const candidate of rejected_by_score) {
            if (performance.now() >= deadline) {
                // Restore snapshot — this sweep did not complete
                selected = snap_selected;
                selected_set.clear();
                for (const s of snap_selected) selected_set.add(s.op.operation_id);
                rejected    = snap_rejected;
                total_score = snap_total_score;
                timed_out   = true;
                break;
            }

            const cid = candidate.op.operation_id;

            // Already accepted in a previous sweep?
            if (selected_set.has(cid)) continue;

            // Find structural blockers in current selection
            const structural_conflicts = graph.adjacency.get(cid) ?? new Set<string>();
            const blockers = [...structural_conflicts]
                .filter(bid => selected_set.has(bid))
                .map(bid => selected.find(s => s.op.operation_id === bid)!)
                .filter(Boolean);

            // ── Case A: zero structural blockers → compliance-only rejection ───
            if (blockers.length === 0) {
                // Re-check compliance against current selection's tentative schedule
                const tentative = buildTentativeFromSelection(selected, existing_shifts_map, shift_catalog);
                const { ok } = checkCandidateCompliance(
                    [candidate], tentative, shift_catalog, employee_catalog, config,
                );

                if (ok) {
                    selected.push(candidate);
                    selected_set.add(cid);
                    total_score += candidate.composite_score;
                    rejected.delete(cid);
                    improvement += candidate.composite_score;
                    sweep_improved = true;

                    // Update tentative by applying candidate
                    for (const change of candidate.op.schedule_changes) {
                        const current = tentative.get(change.employee_id) ?? [];
                        const after_removes = current.filter(s => !change.remove_shift_ids.includes(s.id));
                        const added = change.add_shift_ids.map(id => shift_catalog.get(id)).filter(Boolean) as V8OrchestratorShift[];
                        tentative.set(change.employee_id, [...after_removes, ...added]);
                    }
                }
                continue;
            }

            // ── Case B: blockers present — check if swap improves score ────────
            const blocker_score_sum = blockers.reduce((sum, b) => sum + b.composite_score, 0);
            const gain = candidate.composite_score - blocker_score_sum;

            if (gain <= 0) continue;    // not worth swapping

            // Build tentative without the blockers, check if candidate is valid
            const selection_without_blockers = selected.filter(
                s => !blockers.some(b => b.op.operation_id === s.op.operation_id),
            );

            // Check structural: does candidate conflict with anything else in the pruned set?
            const still_conflicts = [...(graph.adjacency.get(cid) ?? [])]
                .some(nid => selection_without_blockers.some(s => s.op.operation_id === nid));

            if (still_conflicts) continue;

            const tentative_no_blockers = buildTentativeFromSelection(
                selection_without_blockers, existing_shifts_map, shift_catalog,
            );
            const { ok } = checkCandidateCompliance(
                [candidate], tentative_no_blockers, shift_catalog, employee_catalog, config,
            );

            if (!ok) continue;

            // Commit: remove blockers, add candidate
            selected = selection_without_blockers;
            selected_set.clear();
            for (const s of selected) selected_set.add(s.op.operation_id);

            // Re-add blockers to rejected
            for (const b of blockers) {
                rejected.set(b.op.operation_id, {
                    operation_id:              b.op.operation_id,
                    reason:                    `Displaced by higher-value operation ${cid} during local search (net gain: ${gain.toFixed(1)}).`,
                    rule_hits:                 [],
                    conflicting_operation_ids: [cid],
                });
            }

            selected.push(candidate);
            selected_set.add(cid);
            total_score = total_score - blocker_score_sum + candidate.composite_score;
            rejected.delete(cid);
            improvement += gain;
            sweep_improved = true;
        }

        if (timed_out || !sweep_improved) break;    // time expired or stable

        // Refresh rejected_by_score list (some may have been accepted in this sweep)
        rejected_by_score.splice(0);
        rejected_by_score.push(
            ...scored_all
                .filter(s => !selected_set.has(s.op.operation_id))
                .sort((a, b) => {
                    if (b.composite_score !== a.composite_score) return b.composite_score - a.composite_score;
                    return a.op.operation_id < b.op.operation_id ? -1 : 1;
                }),
        );
    }

    return {
        selected,
        rejected,
        total_score,
        improvement,
        sweeps,
        time_elapsed_ms: Math.round(performance.now() - t0),
    };
}
