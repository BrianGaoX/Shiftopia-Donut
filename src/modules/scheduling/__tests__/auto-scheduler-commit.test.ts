/**
 * AutoSchedulerController.commit() — atomic path tests.
 *
 * Verifies that commit():
 *  1. Re-runs simulate() per employee (TOCTOU recheck).
 *  2. Collects ALL freshly-passing pairs and sends them as ONE atomic RPC call.
 *  3. Maps concurrencyConflicts from both recheck failures and RPC conflicts.
 *  4. Returns no-op success when no proposals are passing.
 *  5. Correctly identifies employees whose recheck entirely failed.
 *  6. Generates and forwards an idempotency key to commitAtomic.
 *
 * Mocking strategy (mirrors roster-fetcher.test.ts / auditor.test.ts style):
 *  - Mock @/modules/rosters/bulk-assignment for simulate()
 *  - Mock @/modules/rosters/bulk-assignment/engine/assignment-committer for commitAtomic()
 *  - DO NOT mock crypto (vitest runs in a Node-like environment where
 *    globalThis.crypto.randomUUID is available via the happy-dom environment).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AutoSchedulerController } from '../auto-scheduler.controller';
import type { AutoSchedulerResult, ValidatedProposal } from '../types';
import type { BulkAssignmentResult } from '@/modules/rosters/bulk-assignment';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/modules/rosters/bulk-assignment', async (importOriginal) => {
    const original = await importOriginal() as any;
    return {
        ...original,
        bulkAssignmentController: {
            simulate: vi.fn(),
        },
    };
});

vi.mock('@/modules/rosters/bulk-assignment/engine/assignment-committer', async (importOriginal) => {
    const original = await importOriginal() as any;
    return {
        ...original,
        assignmentCommitter: {
            commitAtomic: vi.fn(),
            commit: vi.fn(), // keep for other callers
        },
    };
});

// These modules drag in Supabase internals; stub them out.
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', () => ({
    rosterFetcher: { fetchExistingRoster: vi.fn(), fetchAvailability: vi.fn() },
    durationMinutes: vi.fn().mockReturnValue(480),
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({
    auditor: { audit: vi.fn() },
}));

import { bulkAssignmentController } from '@/modules/rosters/bulk-assignment';
import { assignmentCommitter } from '@/modules/rosters/bulk-assignment/engine/assignment-committer';

const mockSimulate       = bulkAssignmentController.simulate   as ReturnType<typeof vi.fn>;
const mockCommitAtomic   = assignmentCommitter.commitAtomic     as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function proposal(
    shiftId: string,
    employeeId: string,
    passing: boolean,
): ValidatedProposal {
    return {
        shiftId,
        employeeId,
        employeeName: `Emp-${employeeId}`,
        shiftDate: '2026-06-15',
        startTime: '09:00',
        endTime: '17:00',
        optimizerCost: 0,
        employmentType: 'Full-Time',
        complianceStatus: passing ? 'PASS' : 'FAIL',
        violations: [],
        passing,
    };
}

function makeResult(proposals: ValidatedProposal[]): AutoSchedulerResult {
    const pass = proposals.filter(p => p.passing).length;
    return {
        optimizerStatus: 'OPTIMAL',
        solveTimeMs: 10,
        validationTimeMs: 5,
        totalProposals: proposals.length,
        passing: pass,
        failing: proposals.length - pass,
        uncoveredV8ShiftIds: [],
        proposals,
        canCommit: pass > 0,
        usedFallback: false,
        capacityCheck: {
            sufficient: true,
            totalDemandMinutes: 0,
            totalSupplyMinutes: 0,
            deficitDays: [],
            perDay: [],
        },
    };
}

function simulateSuccess(
    passedIds: string[],
    failedIds: string[] = [],
): BulkAssignmentResult {
    return {
        mode: 'PARTIAL_APPLY',
        total: passedIds.length + failedIds.length,
        passing: passedIds.length,
        failing: failedIds.length,
        results: [],
        passedV8ShiftIds: passedIds,
        failedV8ShiftIds: failedIds,
        canCommit: passedIds.length > 0,
        validationMs: 1,
    };
}

function atomicSuccess(
    successCount: number,
    perEmployee: Array<{ employee_id: string; committed: number; conflicts: string[] }>,
    conflicts: string[] = [],
) {
    return {
        success: true,
        totalCommitted: successCount,
        concurrencyConflicts: conflicts,
        failedEmployees: perEmployee.filter(p => p.committed === 0).map(p => p.employee_id),
        perEmployee: perEmployee.map(p => ({
            employeeId: p.employee_id,
            committed: p.committed,
            conflicts: p.conflicts,
        })),
        message: 'ok',
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoSchedulerController.commit()', () => {
    let controller: AutoSchedulerController;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new AutoSchedulerController();
    });

    it('returns no-op success when there are no passing proposals', async () => {
        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', false),
        ]));

        expect(result.success).toBe(true);
        expect(result.totalCommitted).toBe(0);
        expect(result.failedEmployees).toEqual([]);
        expect(mockSimulate).not.toHaveBeenCalled();
        expect(mockCommitAtomic).not.toHaveBeenCalled();
    });

    it('calls simulate() once per employee and sends ONE atomic commit', async () => {
        // Two employees, both pass recheck.
        mockSimulate
            .mockResolvedValueOnce(simulateSuccess(['s1', 's2'])) // e1
            .mockResolvedValueOnce(simulateSuccess(['s3']));      // e2

        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(3, [
            { employee_id: 'e1', committed: 2, conflicts: [] },
            { employee_id: 'e2', committed: 1, conflicts: [] },
        ]));

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
            proposal('s2', 'e1', true),
            proposal('s3', 'e2', true),
        ]));

        expect(mockSimulate).toHaveBeenCalledTimes(2);

        // commitAtomic must be called EXACTLY ONCE with both employees.
        expect(mockCommitAtomic).toHaveBeenCalledTimes(1);
        const [assignments] = mockCommitAtomic.mock.calls[0] as [
            { employeeId: string; shiftIds: string[] }[],
            string | undefined,
        ];
        expect(assignments).toHaveLength(2);
        expect(assignments.find(a => a.employeeId === 'e1')?.shiftIds).toEqual(['s1', 's2']);
        expect(assignments.find(a => a.employeeId === 'e2')?.shiftIds).toEqual(['s3']);

        expect(result.success).toBe(true);
        expect(result.totalCommitted).toBe(3);
        expect(result.failedEmployees).toEqual([]);
        expect(result.concurrencyConflicts).toEqual([]);
    });

    it('forwards a non-null idempotency key to commitAtomic', async () => {
        mockSimulate.mockResolvedValueOnce(simulateSuccess(['s1']));
        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(1, [
            { employee_id: 'e1', committed: 1, conflicts: [] },
        ]));

        await controller.commit(makeResult([proposal('s1', 'e1', true)]));

        const [, key] = mockCommitAtomic.mock.calls[0] as [unknown, string | undefined];
        // The key must be a valid UUID (generated by crypto.randomUUID).
        expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('marks employee as recheckFailed and excludes them from atomic commit', async () => {
        // e1 recheck throws; e2 passes.
        mockSimulate
            .mockRejectedValueOnce(new Error('simulate error'))     // e1 fails
            .mockResolvedValueOnce(simulateSuccess(['s2']));         // e2 passes

        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(1, [
            { employee_id: 'e2', committed: 1, conflicts: [] },
        ]));

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
            proposal('s2', 'e2', true),
        ]));

        // Atomic commit still called for e2 only.
        const [assignments] = mockCommitAtomic.mock.calls[0] as [
            { employeeId: string; shiftIds: string[] }[],
            string | undefined,
        ];
        expect(assignments).toHaveLength(1);
        expect(assignments[0].employeeId).toBe('e2');

        expect(result.failedEmployees).toContain('e1');
        expect(result.totalCommitted).toBe(1);
        errorSpy.mockRestore();
    });

    it('merges recheck conflicts and RPC concurrency conflicts', async () => {
        // e1 recheck: s1 passes, s2 newly fails (concurrency conflict).
        // RPC also surfaces s1 as a concurrency conflict (held by someone
        // else between recheck and write).
        mockSimulate.mockResolvedValueOnce(simulateSuccess(['s1'], ['s2']));

        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(0, [
            { employee_id: 'e1', committed: 0, conflicts: ['s1'] },
        ], ['s1']));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
            proposal('s2', 'e1', true),
        ]));

        expect(result.concurrencyConflicts).toEqual(expect.arrayContaining(['s1', 's2']));
        expect(result.failedEmployees).toContain('e1');
        warnSpy.mockRestore();
    });

    it('returns failure when all employees fail recheck (no atomic call made)', async () => {
        mockSimulate.mockResolvedValueOnce(simulateSuccess([], ['s1']));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await controller.commit(makeResult([proposal('s1', 'e1', true)]));

        expect(mockCommitAtomic).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.failedEmployees).toContain('e1');
        warnSpy.mockRestore();
    });

    it('excludes non-passing proposals from byEmployee map', async () => {
        // Mix of passing and non-passing proposals for same employee.
        mockSimulate.mockResolvedValueOnce(simulateSuccess(['s1']));
        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(1, [
            { employee_id: 'e1', committed: 1, conflicts: [] },
        ]));

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
            proposal('s2', 'e1', false),  // non-passing — must be excluded
        ]));

        const [assignments] = mockCommitAtomic.mock.calls[0] as [
            { employeeId: string; shiftIds: string[] }[],
            string | undefined,
        ];
        // Only s1 should be sent to simulate and then commit.
        expect(assignments[0].shiftIds).toEqual(['s1']);
        expect(result.totalCommitted).toBe(1);
    });
});
