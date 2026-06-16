/**
 * Conflict Resolver — Operation Scorer
 *
 * Assigns a composite_score to each operation and runs a standalone
 * (per-operation, no other ops) compliance evaluation to produce a
 * pre_compliance_status.
 *
 * Composite score formula:
 *
 *   base =
 *       (op.score ?? priority / 100) * priority_weight    ← caller's score or priority
 *     + compliance_component           * compliance_weight  ← PASS=1, WARNING=0.5, BLOCKING=0
 *     + (business_weight / 100)        * biz_weight         ← optional caller weight
 *
 *   composite_score = base * 100   (range: 0–100)
 *
 * Pre-compliance status:
 *   For each operation, we simulate ONLY its own schedule_changes against
 *   the employee's existing schedule (ignoring all other operations).
 *   This tells us the "standalone compliance quality" of the operation
 *   and contributes to the compliance component of the score.
 *
 *   BLOCKING standalone compliance → compliance_component = 0
 *   Operations that are BLOCKING standalone still participate — they may
 *   be the only option for a shift. Their low score naturally de-prioritises
 *   them in the greedy ordering.
 *
 * Performance:
 *   O(ops × employees_per_op × rules).
 *   For 1000 ops with 1-2 employees each: ~2000 compliance evaluations.
 *   The engine's LRU cache absorbs repeated (employee, shifts) pairs.
 */

import type {
    ConflictOperation,
    ScoredOperation,
    ConflictResolverConfig,
} from './types';
import type {
    V8EmpId, V8ShiftId, V8OrchestratorShift, V8EmployeeContext, V8OrchestratorInput, V8Status,
} from '../types';
import { runV8Orchestrator } from '../index';

// =============================================================================
// STANDALONE COMPLIANCE CHECK
// =============================================================================

/**
 * Runs compliance for each employee affected by the operation
 * INDEPENDENTLY of all other operations. Returns the worst-case status.
 */
function standaloneComplianceStatus(
    op:                   ConflictOperation,
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
): V8Status {
    const rank = (s: V8Status) => s === 'BLOCKING' ? 2 : s === 'WARNING' ? 1 : 0;
    let worst: V8Status = 'PASS';

    for (const change of op.schedule_changes) {
        const employee_context = employee_catalog.get(change.employee_id);
        if (!employee_context) continue;

        const existing_shifts = existing_shifts_map.get(change.employee_id) ?? [];

        const add_shifts    = change.add_shift_ids
            .map(id => shift_catalog.get(id))
            .filter((s): s is V8OrchestratorShift => s !== undefined);
        const remove_shifts = change.remove_shift_ids;

        if (add_shifts.length === 0 && remove_shifts.length === 0) continue;

        const input: V8OrchestratorInput = {
            employee_id:       change.employee_id,
            employee_context,
            existing_shifts,
            candidate_changes: { add_shifts, remove_shifts },
            mode:              'SIMULATED',
            operation_type:    op.type === 'SWAP_APPROVE' ? 'SWAP'
                               : op.type === 'BID_ACCEPT'  ? 'BID'
                               : 'ASSIGN',
            stage:             config.compliance_stage,
            config:            config.compliance_config,
        };

        const result = runV8Orchestrator(input, { stage: config.compliance_stage });
        if (rank(result.overall_status) > rank(worst)) worst = result.overall_status;
    }

    return worst;
}

// =============================================================================
// SCORE COMPUTATION
// =============================================================================

function complianceComponent(status: V8Status): number {
    switch (status) {
        case 'PASS':     return 1.0;
        case 'WARNING':  return 0.5;
        case 'BLOCKING': return 0.0;
    }
}

// =============================================================================
// MAIN SCORER
// =============================================================================

export function scoreOperations(
    operations:           ConflictOperation[],
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
    employee_hours_28d?:  Map<V8EmpId, number>,
    fairness_debts?:      Map<V8EmpId, Record<string, number>>,
): ScoredOperation[] {
    return operations.map(op => {
        const pre_compliance_status = standaloneComplianceStatus(
            op, shift_catalog, employee_catalog, existing_shifts_map, config,
        );

        // Normalise the caller's score or priority into [0, 1]
        const priority_component = op.score !== undefined
            ? Math.min(1, op.score / 100)
            : op.priority / 100;

        const comp_component = complianceComponent(pre_compliance_status);
        const biz_component  = (op.business_weight ?? 0) / 100;

        let composite_score = Math.round((
            priority_component * config.priority_weight  +
            comp_component     * config.compliance_weight +
            biz_component      * config.business_weight
        ) * 10_000) / 100;    // two decimal places, range [0, 100]

        // ── System-level fairness penalty ────────────────────────────────────
        // Penalise operations that assign additional work to employees who
        // are already at or above their 28-day contracted hours ceiling.
        // Only applied when both fairness_weight > 0 and hours data is supplied.
        if (config.fairness_weight > 0 && employee_hours_28d) {
            let max_load_ratio = 0;

            for (const change of op.schedule_changes) {
                // Only penalise when we're adding shifts (not removals-only ops)
                if (change.add_shift_ids.length === 0) continue;

                const ctx = employee_catalog.get(change.employee_id);
                if (!ctx) continue;

                // Contracted 28-day hours (casual has 0 — skip to avoid ÷0)
                const ceiling_28d = ctx.contracted_weekly_hours * 4;
                if (ceiling_28d <= 0) continue;

                const current_hours = employee_hours_28d.get(change.employee_id) ?? 0;
                const ratio = current_hours / ceiling_28d;
                max_load_ratio = Math.max(max_load_ratio, ratio);
            }

            // Penalty is proportional to how over-ceiling the most-loaded
            // affected employee is.  Clamped to [0, 1] so it never exceeds
            // fairness_weight × 100 points of reduction.
            const penalty = Math.min(1, max_load_ratio) * config.fairness_weight * 100;
            composite_score = Math.max(0, composite_score - penalty);

            // F1: Longitudinal Fairness Ledger
            if (fairness_debts) {
                for (const change of op.schedule_changes) {
                    if (change.add_shift_ids.length === 0) continue;
                    const debts = fairness_debts.get(change.employee_id);
                    if (!debts) continue;

                    // Sum all POSITIVE debts (meaning they've done more than average)
                    // We don't bonus negative debt here, we only penalise greedy assignments
                    // to over-worked people.
                    const totalDebt = Object.entries(debts)
                        .filter(([k]) => k !== 'denied_preferences')
                        .reduce((a, [_, b]) => a + Math.max(0, b as number), 0);
                    // 5 units of debt = max penalty (100% of fairness weight)
                    const ledgerPenalty = Math.min(1, totalDebt / 5) * config.fairness_weight * 50;
                    composite_score = Math.max(0, composite_score - ledgerPenalty);
                }
            }
        }

        // F3: Preference Equity Bonus
        if (fairness_debts && op.type === 'BID_ACCEPT') {
            for (const change of op.schedule_changes) {
                if (change.add_shift_ids.length === 0) continue;
                const debts = fairness_debts.get(change.employee_id);
                if (!debts || !debts.denied_preferences) continue;

                if (debts.denied_preferences > 0) {
                    // Add up to 50 points of bonus for satisfying a preference for an employee
                    // who has been denied frequently.
                    const prefBonus = Math.min(1, debts.denied_preferences / 5) * config.fairness_weight * 50;
                    composite_score = Math.min(100, composite_score + prefBonus);
                }
            }
        }

        return { op, composite_score, pre_compliance_status };
    });
}
