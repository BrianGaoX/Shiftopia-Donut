/**
 * AutoSchedulerController.commit() — atomic path tests.
 *
 * Verifies that commit():
 *  1. Groups the COMPLIANT (passing) proposals by employee and sends them as ONE
 *     atomic RPC call — NO per-employee compliance re-simulation (preview ==
 *     commit; the preview already validated and the hard gate guarantees 100%
 *     compliance, so re-validating with a different DB-fetch context only
 *     produced false drops).
 *  2. Surfaces failedEmployees / concurrencyConflicts straight from the atomic
 *     RPC result (the RPC's lost-update guard is the only apply-time concurrency
 *     check).
 *  3. Returns no-op success when no proposals are passing.
 *  4. Generates and forwards an idempotency key to commitAtomic.
 *
 * Mocking strategy (mirrors roster-fetcher.test.ts / auditor.test.ts style):
 *  - Mock @/modules/rosters/bulk-assignment (simulate must NOT be called now)
 *  - Mock the assignment-committer for commitAtomic()
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AutoSchedulerController } from '../auto-scheduler.controller';
import type { AutoSchedulerResult, ValidatedProposal } from '../types';

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

    it('sends ONE atomic commit with all passing employees and never re-simulates', async () => {
        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(3, [
            { employee_id: 'e1', committed: 2, conflicts: [] },
            { employee_id: 'e2', committed: 1, conflicts: [] },
        ]));

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
            proposal('s2', 'e1', true),
            proposal('s3', 'e2', true),
        ]));

        // No per-employee compliance re-simulation — preview == commit.
        expect(mockSimulate).not.toHaveBeenCalled();

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
        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(1, [
            { employee_id: 'e1', committed: 1, conflicts: [] },
        ]));

        await controller.commit(makeResult([proposal('s1', 'e1', true)]));

        const [, key] = mockCommitAtomic.mock.calls[0] as [unknown, string | undefined];
        // The key must be a valid UUID (generated by crypto.randomUUID).
        expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('sends every passing employee to the RPC (no client-side drops) and surfaces DB-level failures', async () => {
        // Both employees are sent; the RPC reports e2 committed 0 → failedEmployee.
        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(1, [
            { employee_id: 'e1', committed: 1, conflicts: [] },
            { employee_id: 'e2', committed: 0, conflicts: [] },
        ]));

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
            proposal('s2', 'e2', true),
        ]));

        const [assignments] = mockCommitAtomic.mock.calls[0] as [
            { employeeId: string; shiftIds: string[] }[],
            string | undefined,
        ];
        expect(assignments).toHaveLength(2); // nothing dropped client-side
        expect(result.failedEmployees).toContain('e2');
        expect(result.totalCommitted).toBe(1);
    });

    it('surfaces concurrency conflicts reported by the atomic RPC lost-update guard', async () => {
        // s1 was grabbed by another employee since preview → RPC returns it as a
        // conflict and e1 committed 0.
        mockCommitAtomic.mockResolvedValueOnce(atomicSuccess(0, [
            { employee_id: 'e1', committed: 0, conflicts: ['s1'] },
        ], ['s1']));

        const result = await controller.commit(makeResult([
            proposal('s1', 'e1', true),
        ]));

        expect(result.concurrencyConflicts).toContain('s1');
        expect(result.failedEmployees).toContain('e1');
    });

    it('excludes non-passing proposals from the commit', async () => {
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
        // Only the passing shift is committed.
        expect(assignments[0].shiftIds).toEqual(['s1']);
        expect(result.totalCommitted).toBe(1);
    });
});
