/**
 * AssignmentCommitter — Atomically assigns passing shifts via Supabase RPC.
 *
 * Two commit paths are available:
 *
 *   commit(shiftIds, employeeId)
 *     Single-employee path. Calls sm_bulk_assign for one (employee → shifts[])
 *     pair. Used by BulkAssignmentController (BulkAssignmentPanel flow).
 *
 *   commitAtomic(assignments, idempotencyKey?)
 *     Multi-employee atomic path. Calls sm_bulk_assign_atomic for N pairs in a
 *     single DB transaction. Used by AutoSchedulerController.commit() to ensure
 *     all employees are written atomically or rolled back together.
 *
 * The committer receives only the shift IDs that passed all validation —
 * the controller decides which IDs to pass based on the selected mode.
 */

import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import type { BulkAssignResponse, BulkAssignAtomicResponse } from '@/modules/rosters/api/contracts';

export interface CommitResult {
    success: boolean;
    committed: string[];
    failed: string[];
    message?: string;
}

export interface AtomicCommitResult {
    success: boolean;
    totalCommitted: number;
    /** Shift IDs that were not applied because another employee now holds them. */
    concurrencyConflicts: string[];
    /** Employee IDs whose entire commit set produced zero committed shifts. */
    failedEmployees: string[];
    perEmployee: Array<{ employeeId: string; committed: number; conflicts: string[] }>;
    message?: string;
}

export class AssignmentCommitter {
    /**
     * Single-employee atomic assign (per-employee BulkAssignmentPanel path).
     *
     * @param shiftIds   - IDs of shifts that passed validation
     * @param employeeId - Target employee
     */
    async commit(shiftIds: string[], employeeId: string): Promise<CommitResult> {
        if (shiftIds.length === 0) {
            return { success: true, committed: [], failed: [], message: 'No shifts to commit' };
        }

        console.debug('[BulkAssignmentCommitter] Committing', shiftIds.length, 'shifts to', employeeId);

        try {
            const response: BulkAssignResponse = await shiftsCommands.bulkAssignShifts(
                employeeId,
                shiftIds,
            );

            console.debug('[BulkAssignmentCommitter] RPC result:', response);

            if (response.success) {
                // NOTE: fairness-ledger write-back is NOT done here. The committer
                // only has shiftIds — not the org ID, shift dates, or times the
                // ledger needs. The ledger is updated by the caller that owns that
                // data (AutoSchedulerController.commit / the bid-winner path).
                return {
                    success: true,
                    committed: shiftIds,
                    failed: [],
                    message: response.message,
                };
            } else {
                return {
                    success: false,
                    committed: [],
                    failed: shiftIds,
                    message: response.message ?? 'Bulk assign RPC returned failure',
                };
            }
        } catch (err: any) {
            console.error('[BulkAssignmentCommitter] RPC error:', err);
            return {
                success: false,
                committed: [],
                failed: shiftIds,
                message: err?.message ?? 'Unknown error during bulk assign',
            };
        }
    }

    /**
     * Multi-employee atomic assign (AutoScheduler path).
     *
     * Sends all (employee → shifts[]) pairs to sm_bulk_assign_atomic in a single
     * RPC call which runs inside one implicit plpgsql transaction. Either ALL
     * qualifying rows are written (shifts that pass the lost-update guard) or on
     * a hard DB error NONE are. Shifts held by a different employee are returned
     * as concurrency conflicts, not errors.
     *
     * @param assignments     Pairs to commit.
     * @param idempotencyKey  If supplied and already stored, the cached result is
     *                        returned without re-executing any UPDATEs.
     */
    async commitAtomic(
        assignments: { employeeId: string; shiftIds: string[] }[],
        idempotencyKey?: string,
    ): Promise<AtomicCommitResult> {
        if (assignments.length === 0) {
            return {
                success: true,
                totalCommitted: 0,
                concurrencyConflicts: [],
                failedEmployees: [],
                perEmployee: [],
                message: 'No assignments to commit',
            };
        }

        console.debug(
            '[BulkAssignmentCommitter] Atomic commit: %d employees, key=%s',
            assignments.length,
            idempotencyKey ?? 'none',
        );

        let response: BulkAssignAtomicResponse;
        try {
            response = await shiftsCommands.bulkAssignShiftsAtomic(assignments, idempotencyKey);
        } catch (err: any) {
            console.error('[BulkAssignmentCommitter] Atomic RPC error:', err);
            return {
                success: false,
                totalCommitted: 0,
                concurrencyConflicts: [],
                failedEmployees: assignments.map(a => a.employeeId),
                perEmployee: [],
                message: err?.message ?? 'Unknown error during atomic bulk assign',
            };
        }

        if (!response.success) {
            return {
                success: false,
                totalCommitted: 0,
                concurrencyConflicts: response.conflicts ?? [],
                failedEmployees: assignments.map(a => a.employeeId),
                perEmployee: [],
                message: response.error ?? 'Atomic bulk assign RPC returned failure',
            };
        }

        const perEmployee = (response.per_employee ?? []).map(pe => ({
            employeeId: pe.employee_id,
            committed: pe.committed,
            conflicts: pe.conflicts,
        }));

        // An employee "failed" if they had shifts in the request but zero were committed.
        const failedEmployees = perEmployee
            .filter(pe => pe.committed === 0)
            .map(pe => pe.employeeId);

        const concurrencyConflicts = response.conflicts ?? [];

        console.debug('[BulkAssignmentCommitter] Atomic commit result:', {
            success_count: response.success_count,
            conflict_count: response.conflict_count,
            failedEmployees,
        });

        // NOTE: fairness-ledger write-back is done by the caller
        // (AutoSchedulerController.commit), which owns the org ID + shift dates.
        return {
            success: true,
            totalCommitted: response.success_count ?? 0,
            concurrencyConflicts,
            failedEmployees,
            perEmployee,
            message: `Committed ${response.success_count ?? 0} shifts`,
        };
    }
}

export const assignmentCommitter = new AssignmentCommitter();
