/**
 * Batch Executor — Conflict Detector
 *
 * Three-pass detection:
 *
 *   Pass 1 — Pre-simulation structural conflicts (from OperationGraph):
 *     - RESOURCE_CONTENTION: graph conflict edges of that type
 *     - TIME_OVERLAP: graph conflict edges of that type
 *     - DEPENDENCY_CYCLE: cyclic_operations returned by the ordering engine
 *
 *   Pass 2 — Simulation failures:
 *     - LOGICAL_INCONSISTENCY: atomics that failed precondition checks
 *       (shift not held by employee, shift already claimed by another, etc.)
 *
 *   Pass 3 — Compliance failures:
 *     - COMPLIANCE_VIOLATION: operations that triggered BLOCKING compliance hits
 *
 * The result contains:
 *   - `conflicts[]`          — all detected BatchConflict objects
 *   - `conflict_map`         — op_id → conflicts affecting it
 *   - `blocked_operations`   — op IDs that should not be committed
 */

import type {
    BatchOperation,
    OperationGraph,
    BatchConflict,
    BatchConflictType,
    ConflictDetectionResult,
    AtomicOperation,
} from './types';
import type { ComplianceValidationResult } from './compliance-validator';
import type { V8Hit } from '../types';

let conflictSeq = 0;
function nextConflictId(): string {
    return `conflict:${++conflictSeq}`;
}

// =============================================================================
// HELPERS
// =============================================================================

function addConflict(
    acc:           BatchConflict[],
    conflict_map:  Map<string, BatchConflict[]>,
    blocked_ops:   Set<string>,
    conflict:      BatchConflict,
): void {
    acc.push(conflict);
    for (const opId of conflict.operation_ids) {
        if (!conflict_map.has(opId)) conflict_map.set(opId, []);
        conflict_map.get(opId)!.push(conflict);
        if (conflict.severity === 'BLOCKING') {
            blocked_ops.add(opId);
        }
    }
}

// =============================================================================
// PASS 1 — PRE-SIMULATION (graph-derived)
// =============================================================================

function detectGraphConflicts(
    graph:           OperationGraph,
    cyclic_op_ids:   string[],
    conflicts:       BatchConflict[],
    conflict_map:    Map<string, BatchConflict[]>,
    blocked_ops:     Set<string>,
): void {
    // Collect all CONFLICT edges (undirected — each pair stored once)
    const seen = new Set<string>();

    for (const edge of graph.edges) {
        if (edge.type !== 'CONFLICT') continue;

        // Canonical key to avoid duplicate conflict objects per pair
        const key = [edge.from_op_id, edge.to_op_id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        // Determine conflict type from edge reason
        const ctype: BatchConflictType = edge.reason.includes('RESOURCE_CONTENTION')
            ? 'RESOURCE_CONTENTION'
            : 'TIME_OVERLAP';

        addConflict(conflicts, conflict_map, blocked_ops, {
            conflict_id:     nextConflictId(),
            type:            ctype,
            operation_ids:   [edge.from_op_id, edge.to_op_id],
            description:     edge.reason,
            resolution_hint: ctype === 'RESOURCE_CONTENTION'
                ? 'Only one employee can be assigned to a shift. Keep the higher-priority operation.'
                : 'Two operations produce overlapping shifts for the same employee. Remove one.',
            rule_hits:       [],
            severity:        'BLOCKING',
        });
    }

    // Dependency cycle conflicts
    for (const opId of cyclic_op_ids) {
        addConflict(conflicts, conflict_map, blocked_ops, {
            conflict_id:     nextConflictId(),
            type:            'DEPENDENCY_CYCLE',
            operation_ids:   [opId],
            description:     `Operation ${opId} is part of a dependency cycle and cannot be safely ordered.`,
            resolution_hint: 'Review the operation set for circular REMOVE/ADD dependencies.',
            rule_hits:       [],
            severity:        'BLOCKING',
        });
    }
}

// =============================================================================
// PASS 2 — SIMULATION FAILURES
// =============================================================================

function detectSimulationFailures(
    sim_failures: Array<{ op_id: string; reason: string }>,
    conflicts:    BatchConflict[],
    conflict_map: Map<string, BatchConflict[]>,
    blocked_ops:  Set<string>,
): void {
    for (const failure of sim_failures) {
        addConflict(conflicts, conflict_map, blocked_ops, {
            conflict_id:     nextConflictId(),
            type:            'LOGICAL_INCONSISTENCY',
            operation_ids:   [failure.op_id],
            description:     failure.reason,
            resolution_hint:
                'Verify that preconditions are met: the shift exists and is in the expected assignment state.',
            rule_hits:       [],
            severity:        'BLOCKING',
        });
    }
}

// =============================================================================
// PASS 3 — COMPLIANCE VIOLATIONS
// =============================================================================

function detectComplianceViolations(
    compliance:   ComplianceValidationResult,
    ops:          BatchOperation[],
    atomics:      Map<string, AtomicOperation[]>,
    conflicts:    BatchConflict[],
    conflict_map: Map<string, BatchConflict[]>,
    blocked_ops:  Set<string>,
): void {
    for (const empResult of compliance.employee_results) {
        if (empResult.result.overall_status !== 'BLOCKING') continue;

        const blockingHits: V8Hit[] = empResult.result.hits
            .filter(h => h.status === 'BLOCKING');

        if (blockingHits.length === 0) continue;

        addConflict(conflicts, conflict_map, blocked_ops, {
            conflict_id:     nextConflictId(),
            type:            'COMPLIANCE_VIOLATION',
            operation_ids:   empResult.changed_by_operations,
            description:
                `Employee ${empResult.employee_id} has ${blockingHits.length} blocking compliance `
                + `violation(s): ${blockingHits.map(h => h.rule_id).join(', ')}.`,
            resolution_hint:
                'Resolve the underlying compliance rule violations before committing these operations.',
            rule_hits:       blockingHits,
            severity:        'BLOCKING',
        });
    }
}

// =============================================================================
// MAIN DETECTOR
// =============================================================================

export function detectConflicts(
    graph:           OperationGraph,
    cyclic_op_ids:   string[],
    sim_failures:    Array<{ op_id: string; reason: string }>,
    compliance:      ComplianceValidationResult,
    applied_ops:     BatchOperation[],
    atomics:         Map<string, AtomicOperation[]>,
): ConflictDetectionResult {
    // Reset counter per call for determinism in tests
    conflictSeq = 0;

    const conflicts:    BatchConflict[]             = [];
    const conflict_map: Map<string, BatchConflict[]> = new Map();
    const blocked_ops:  Set<string>                  = new Set();

    detectGraphConflicts(graph, cyclic_op_ids, conflicts, conflict_map, blocked_ops);
    detectSimulationFailures(sim_failures, conflicts, conflict_map, blocked_ops);
    detectComplianceViolations(compliance, applied_ops, atomics, conflicts, conflict_map, blocked_ops);

    return { conflicts, conflict_map, blocked_operations: blocked_ops };
}
