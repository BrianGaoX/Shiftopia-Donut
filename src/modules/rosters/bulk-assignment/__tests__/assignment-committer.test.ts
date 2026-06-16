/**
 * AssignmentCommitter.commitAtomic — unit tests.
 *
 * Verifies:
 *  - Empty assignments → immediate no-op success.
 *  - Happy path: RPC success → correct totalCommitted / perEmployee mapping.
 *  - RPC hard error → failedEmployees set to all input employees.
 *  - RPC returns success:false → failedEmployees set; conflicts propagated.
 *  - Employees with committed=0 in per_employee → flagged as failedEmployees.
 *  - Idempotency key is forwarded to the RPC call.
 *  - Single-employee commit() path still works (regression guard).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AssignmentCommitter } from '../engine/assignment-committer';

// ---------------------------------------------------------------------------
// Mock shiftsCommands module
// ---------------------------------------------------------------------------

vi.mock('@/modules/rosters/api/shifts.commands', () => ({
    shiftsCommands: {
        bulkAssignShifts: vi.fn(),
        bulkAssignShiftsAtomic: vi.fn(),
    },
}));

import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';

const mockBulkAssign         = shiftsCommands.bulkAssignShifts as ReturnType<typeof vi.fn>;
const mockBulkAssignAtomic   = shiftsCommands.bulkAssignShiftsAtomic as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pair(employeeId: string, ...shiftIds: string[]) {
    return { employeeId, shiftIds };
}

function atomicOk(
    successCount: number,
    perEmployee: Array<{ employee_id: string; committed: number; conflicts: string[] }>,
    conflicts: string[] = [],
) {
    return {
        success: true,
        total_requested: perEmployee.reduce((a, p) => a + p.committed + p.conflicts.length, 0),
        success_count: successCount,
        conflict_count: conflicts.length,
        conflicts,
        per_employee: perEmployee,
    };
}

// ---------------------------------------------------------------------------
// Tests: commitAtomic
// ---------------------------------------------------------------------------

describe('AssignmentCommitter.commitAtomic', () => {
    let committer: AssignmentCommitter;

    beforeEach(() => {
        vi.clearAllMocks();
        committer = new AssignmentCommitter();
    });

    it('returns no-op success when assignments list is empty', async () => {
        const result = await committer.commitAtomic([]);
        expect(result.success).toBe(true);
        expect(result.totalCommitted).toBe(0);
        expect(result.failedEmployees).toEqual([]);
        expect(result.concurrencyConflicts).toEqual([]);
        expect(mockBulkAssignAtomic).not.toHaveBeenCalled();
    });

    it('maps RPC success to correct totals and per-employee breakdown', async () => {
        mockBulkAssignAtomic.mockResolvedValueOnce(atomicOk(3, [
            { employee_id: 'e1', committed: 2, conflicts: [] },
            { employee_id: 'e2', committed: 1, conflicts: [] },
        ]));

        const result = await committer.commitAtomic([
            pair('e1', 's1', 's2'),
            pair('e2', 's3'),
        ]);

        expect(result.success).toBe(true);
        expect(result.totalCommitted).toBe(3);
        expect(result.failedEmployees).toEqual([]);
        expect(result.concurrencyConflicts).toEqual([]);
        expect(result.perEmployee).toEqual([
            { employeeId: 'e1', committed: 2, conflicts: [] },
            { employeeId: 'e2', committed: 1, conflicts: [] },
        ]);
    });

    it('propagates concurrency conflicts from the RPC', async () => {
        mockBulkAssignAtomic.mockResolvedValueOnce(atomicOk(1, [
            { employee_id: 'e1', committed: 1, conflicts: ['s2'] },
        ], ['s2']));

        const result = await committer.commitAtomic([pair('e1', 's1', 's2')]);

        expect(result.success).toBe(true);
        expect(result.totalCommitted).toBe(1);
        expect(result.concurrencyConflicts).toEqual(['s2']);
        // e1 still committed 1 shift → not in failedEmployees
        expect(result.failedEmployees).toEqual([]);
    });

    it('marks employee as failed when committed=0 in per_employee', async () => {
        mockBulkAssignAtomic.mockResolvedValueOnce(atomicOk(0, [
            { employee_id: 'e1', committed: 0, conflicts: ['s1'] },
        ], ['s1']));

        const result = await committer.commitAtomic([pair('e1', 's1')]);

        expect(result.failedEmployees).toContain('e1');
    });

    it('sets all employees as failed when RPC throws', async () => {
        mockBulkAssignAtomic.mockRejectedValueOnce(new Error('network error'));

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await committer.commitAtomic([pair('e1', 's1'), pair('e2', 's2')]);

        expect(result.success).toBe(false);
        expect(result.failedEmployees).toEqual(expect.arrayContaining(['e1', 'e2']));
        expect(result.message).toContain('network error');
        errorSpy.mockRestore();
    });

    it('sets all employees as failed when RPC returns success:false', async () => {
        mockBulkAssignAtomic.mockResolvedValueOnce({
            success: false,
            error: 'Not authorized to assign shifts',
        });

        const result = await committer.commitAtomic([pair('e1', 's1')]);

        expect(result.success).toBe(false);
        expect(result.failedEmployees).toContain('e1');
        expect(result.message).toContain('Not authorized');
    });

    it('forwards the idempotency key to the RPC call', async () => {
        mockBulkAssignAtomic.mockResolvedValueOnce(atomicOk(1, [
            { employee_id: 'e1', committed: 1, conflicts: [] },
        ]));

        const key = 'aaaaaaaa-0000-4000-8000-bbbbbbbbbbbb';
        await committer.commitAtomic([pair('e1', 's1')], key);

        expect(mockBulkAssignAtomic).toHaveBeenCalledWith(
            [{ employeeId: 'e1', shiftIds: ['s1'] }],
            key,
        );
    });
});

// ---------------------------------------------------------------------------
// Tests: commit (single-employee path — regression guard)
// ---------------------------------------------------------------------------

describe('AssignmentCommitter.commit (single-employee regression)', () => {
    let committer: AssignmentCommitter;

    beforeEach(() => {
        vi.clearAllMocks();
        committer = new AssignmentCommitter();
    });

    it('returns no-op when shiftIds is empty', async () => {
        const result = await committer.commit([], 'e1');
        expect(result.success).toBe(true);
        expect(result.committed).toEqual([]);
        expect(mockBulkAssign).not.toHaveBeenCalled();
    });

    it('marks all shifts committed on RPC success', async () => {
        mockBulkAssign.mockResolvedValueOnce({
            success: true,
            total_requested: 2,
            success_count: 2,
            failure_count: 0,
            message: 'ok',
        });

        const result = await committer.commit(['s1', 's2'], 'e1');

        expect(result.success).toBe(true);
        expect(result.committed).toEqual(['s1', 's2']);
        expect(result.failed).toEqual([]);
    });

    it('marks all shifts failed when RPC returns success:false', async () => {
        mockBulkAssign.mockResolvedValueOnce({ success: false, message: 'rpc fail' });

        const result = await committer.commit(['s1'], 'e1');

        expect(result.success).toBe(false);
        expect(result.failed).toEqual(['s1']);
    });

    it('marks all shifts failed when RPC throws', async () => {
        mockBulkAssign.mockRejectedValueOnce(new Error('db down'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await committer.commit(['s1'], 'e1');

        expect(result.success).toBe(false);
        expect(result.failed).toEqual(['s1']);
        errorSpy.mockRestore();
    });
});
