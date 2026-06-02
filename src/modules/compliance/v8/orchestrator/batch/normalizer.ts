/**
 * Batch Executor — Operation Normalizer
 *
 * Responsibilities:
 *   1. Structural validation — all referenced IDs exist in base_state
 *   2. Expansion — composite ops (SWAP, BID_ACCEPT) → AtomicOperation[]
 *   3. Deduplication — identical (type × shift × employee) ops keep only highest priority
 *   4. Idempotency key — each op gets a stable canonical key for dedup
 *
 * Outputs invalid_operations separately — they never enter the pipeline.
 * Everything else is valid structure; logical conflicts are handled downstream.
 */

import {
    BatchOperation,
    BatchBaseState,
    AtomicOperation,
    NormalizationResult,
    BatchV8OperationType,
    AssignPayload,
    UnassignPayload,
    BidAcceptPayload,
    SwapApprovePayload,
} from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId } from '../types';

// =============================================================================
// HELPERS
// =============================================================================

function atomicId(parent_id: string, seq: number): string {
    return `${parent_id}:atom:${seq}`;
}

/** Find a shift by ID in the catalog */
function findShift(shift_id: V8ShiftId, catalog: Map<V8ShiftId, V8OrchestratorShift>): V8OrchestratorShift | undefined {
    return catalog.get(shift_id);
}

/** Idempotency key: stable string uniquely representing the semantic intent */
function idempotencyKey(op: BatchOperation): string {
    const p = op.payload;
    switch (p.type) {
        case 'ASSIGN':      return `ASSIGN:${p.shift_id}:${p.employee_id}`;
        case 'UNASSIGN':    return `UNASSIGN:${p.shift_id}:${p.employee_id}`;
        case 'BID_ACCEPT':  return `BID_ACCEPT:${p.shift_id}`;
        case 'SWAP_APPROVE':
            // Canonical: sort party IDs to make A↔B == B↔A
            const parties = [
                `${p.party_a.employee_id}:${p.party_a.gives_shift_id}`,
                `${p.party_b.employee_id}:${p.party_b.gives_shift_id}`,
            ].sort().join('|');
            return `SWAP_APPROVE:${parties}`;
    }
}

// =============================================================================
// EXPANSION LOGIC
// =============================================================================

/**
 * Expand an ASSIGN operation.
 * ADD the shift to the employee's schedule.
 * sequence_index 0 (only one atomic).
 */
function expandAssign(op: BatchOperation, catalog: Map<V8ShiftId, V8OrchestratorShift>): AtomicOperation[] {
    const p = op.payload as AssignPayload;
    const shift = findShift(p.shift_id, catalog);
    if (!shift) return [];    // invalid — caught in validate phase
    return [{
        atomic_id:           atomicId(op.operation_id, 0),
        parent_operation_id: op.operation_id,
        type:                'ADD_EMPLOYEE_SHIFT',
        employee_id:         p.employee_id,
        shift,
        sequence_index:      0,
    }];
}

/**
 * Expand an UNASSIGN operation.
 * REMOVE the shift from the employee's schedule.
 */
function expandUnassign(op: BatchOperation, catalog: Map<V8ShiftId, V8OrchestratorShift>): AtomicOperation[] {
    const p = op.payload as UnassignPayload;
    const shift = findShift(p.shift_id, catalog);
    if (!shift) return [];
    return [{
        atomic_id:           atomicId(op.operation_id, 0),
        parent_operation_id: op.operation_id,
        type:                'REMOVE_EMPLOYEE_SHIFT',
        employee_id:         p.employee_id,
        shift,
        sequence_index:      0,
    }];
}

/**
 * Expand a BID_ACCEPT operation.
 * ADD the shift to the winner's schedule.
 * (Any existing assignment is handled as an implicit dependency / conflict downstream.)
 */
function expandBidAccept(op: BatchOperation, catalog: Map<V8ShiftId, V8OrchestratorShift>): AtomicOperation[] {
    const p = op.payload as BidAcceptPayload;
    const shift = findShift(p.shift_id, catalog);
    if (!shift) return [];
    return [{
        atomic_id:           atomicId(op.operation_id, 0),
        parent_operation_id: op.operation_id,
        type:                'ADD_EMPLOYEE_SHIFT',
        employee_id:         p.winning_employee_id,
        shift,
        sequence_index:      0,
    }];
}

/**
 * Expand a SWAP_APPROVE operation into 4 atomics.
 *
 * Ordering (sequence_index):
 *   0: REMOVE shift_a from party_a  (releases resource)
 *   1: REMOVE shift_b from party_b  (releases resource)
 *   2: ADD    shift_a to  party_b   (claims resource)
 *   3: ADD    shift_b to  party_a   (claims resource)
 *
 * Removes must precede adds to ensure a clean intermediate state.
 */
function expandSwapApprove(op: BatchOperation, catalog: Map<V8ShiftId, V8OrchestratorShift>): AtomicOperation[] {
    const p = op.payload as SwapApprovePayload;
    const shift_a = findShift(p.party_a.gives_shift_id, catalog);
    const shift_b = findShift(p.party_b.gives_shift_id, catalog);
    if (!shift_a || !shift_b) return [];

    return [
        {
            atomic_id:           atomicId(op.operation_id, 0),
            parent_operation_id: op.operation_id,
            type:                'REMOVE_EMPLOYEE_SHIFT',
            employee_id:         p.party_a.employee_id,
            shift:               shift_a,
            sequence_index:      0,
        },
        {
            atomic_id:           atomicId(op.operation_id, 1),
            parent_operation_id: op.operation_id,
            type:                'REMOVE_EMPLOYEE_SHIFT',
            employee_id:         p.party_b.employee_id,
            shift:               shift_b,
            sequence_index:      1,
        },
        {
            atomic_id:           atomicId(op.operation_id, 2),
            parent_operation_id: op.operation_id,
            type:                'ADD_EMPLOYEE_SHIFT',
            employee_id:         p.party_b.employee_id,
            shift:               shift_a,
            sequence_index:      2,
        },
        {
            atomic_id:           atomicId(op.operation_id, 3),
            parent_operation_id: op.operation_id,
            type:                'ADD_EMPLOYEE_SHIFT',
            employee_id:         p.party_a.employee_id,
            shift:               shift_b,
            sequence_index:      3,
        },
    ];
}

// =============================================================================
// VALIDATION
// =============================================================================

interface ValidationError {
    operation_id: string;
    reason:       string;
}

function validateOperation(
    op:          BatchOperation,
    catalog:     Map<V8ShiftId, V8OrchestratorShift>,
    employeeSet: Set<V8EmpId>,
): string | null {
    const p = op.payload;

    switch (p.type) {
        case 'ASSIGN':
            if (!catalog.has(p.shift_id))     return `Shift ${p.shift_id} not found in base_state.shifts`;
            if (!employeeSet.has(p.employee_id)) return `Employee ${p.employee_id} not found in base_state.employees`;
            return null;

        case 'UNASSIGN':
            if (!catalog.has(p.shift_id))     return `Shift ${p.shift_id} not found`;
            if (!employeeSet.has(p.employee_id)) return `Employee ${p.employee_id} not found`;
            return null;

        case 'BID_ACCEPT':
            if (!catalog.has(p.shift_id))                  return `Shift ${p.shift_id} not found`;
            if (!employeeSet.has(p.winning_employee_id))   return `Winning employee ${p.winning_employee_id} not found`;
            for (const fb of p.fallback_employee_ids ?? []) {
                if (!employeeSet.has(fb)) return `Fallback employee ${fb} not found`;
            }
            return null;

        case 'SWAP_APPROVE':
            if (!employeeSet.has(p.party_a.employee_id)) return `Employee ${p.party_a.employee_id} not found`;
            if (!employeeSet.has(p.party_b.employee_id)) return `Employee ${p.party_b.employee_id} not found`;
            if (!catalog.has(p.party_a.gives_shift_id))  return `Shift ${p.party_a.gives_shift_id} not found`;
            if (!catalog.has(p.party_b.gives_shift_id))  return `Shift ${p.party_b.gives_shift_id} not found`;
            if (p.party_a.employee_id === p.party_b.employee_id) return 'Swap parties must be different employees';
            if (p.party_a.gives_shift_id === p.party_b.gives_shift_id) return 'Swap parties must give different shifts';
            return null;
    }
}

// =============================================================================
// DEDUPLICATION
// =============================================================================

/**
 * For each idempotency key, keep only the highest-priority operation.
 * Ties resolved by earlier timestamp.
 */
function deduplicateOperations(ops: BatchOperation[]): BatchOperation[] {
    const best = new Map<string, BatchOperation>();

    for (const op of ops) {
        const key = idempotencyKey(op);
        const existing = best.get(key);
        if (!existing) {
            best.set(key, op);
        } else if (
            op.priority > existing.priority ||
            (op.priority === existing.priority && op.timestamp < existing.timestamp)
        ) {
            best.set(key, op);
        }
    }

    return [...best.values()];
}

// =============================================================================
// MAIN NORMALIZER
// =============================================================================

export function normalizeOperations(
    operations: BatchOperation[],
    base_state:  BatchBaseState,
): NormalizationResult {
    const catalog     = new Map<V8ShiftId, V8OrchestratorShift>(base_state.shifts.map(s => [s.id, s]));
    const employeeSet = new Set<V8EmpId>(base_state.employees.map(e => e.employee_id));

    // 1. Structural validation
    const valid_ops: BatchOperation[]  = [];
    const invalid_ops: ValidationError[] = [];

    for (const op of operations) {
        const error = validateOperation(op, catalog, employeeSet);
        if (error) {
            invalid_ops.push({ operation_id: op.operation_id, reason: error });
        } else {
            valid_ops.push(op);
        }
    }

    // 2. Deduplication
    const deduped = deduplicateOperations(valid_ops);

    // 3. Expansion to atomics
    const atomics = new Map<string, AtomicOperation[]>();

    for (const op of deduped) {
        let expanded: AtomicOperation[];

        switch (op.type) {
            case 'ASSIGN':       expanded = expandAssign(op, catalog);      break;
            case 'UNASSIGN':     expanded = expandUnassign(op, catalog);    break;
            case 'BID_ACCEPT':   expanded = expandBidAccept(op, catalog);   break;
            case 'SWAP_APPROVE': expanded = expandSwapApprove(op, catalog); break;
        }

        if (expanded.length === 0) {
            // Expansion failed (missing shift ref) — treat as invalid
            invalid_ops.push({
                operation_id: op.operation_id,
                reason:       'Failed to expand operation: shift reference missing in catalog',
            });
        } else {
            atomics.set(op.operation_id, expanded);
        }
    }

    // Only keep ops that expanded successfully
    const final_valid = deduped.filter(op => atomics.has(op.operation_id));

    return {
        valid_operations:   final_valid,
        invalid_operations: invalid_ops,
        atomics,
    };
}
