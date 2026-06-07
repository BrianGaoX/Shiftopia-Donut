/**
 * Stale Compliance — Edge Case Tests
 *
 * When the compliance snapshot is older than 15 minutes, approveRequest
 * must re-run the compliance engine before calling the RPC.
 *
 * Verifies (Bug #5 fix):
 *   • runV8Orchestrator is called during approval for stale snapshots
 *   • DB snapshot write errors are caught and thrown (not silently ignored)
 *   • COMPLIANCE_NOW_BLOCKING is thrown if re-eval is BLOCKING
 *   • Non-stale snapshots skip re-evaluation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabase-mock';
import {
  MGR_ID, EMP_A_ID, EMP_B_ID,
  REQUEST_ID,
  SHIFT_UPDATED_AT,
  selectedBidOfferRow, managerPendingBidRequestRow,
  passComplianceResult, blockingComplianceResult,
  empContextA, empContextB,
  openShiftRow,
} from '../helpers/fixtures';

const { ctx, supabaseProxy, mockEvaluate } = vi.hoisted(() => {
  const ctx = { mock: null as any };
  return {
    ctx,
    supabaseProxy: new Proxy({} as any, {
      get(_: any, p: string) { return ctx.mock.client[p]; },
    }),
    mockEvaluate: vi.fn(),
  };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: supabaseProxy }));

vi.mock('@/modules/compliance/v8', () => ({
  runV8Orchestrator: mockEvaluate,
}));

vi.mock('@/modules/compliance/employee-context', () => ({
  fetchV8EmployeeContext: vi.fn().mockImplementation((id: string) =>
    Promise.resolve(id === EMP_A_ID ? empContextA : empContextB),
  ),
  fetchEmployeeShiftsV2: vi.fn().mockResolvedValue([]),
}));

import { planningRequestService } from '../../service/planning-request.service';

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  mockEvaluate.mockReset().mockReturnValue(passComplianceResult);
});

// =============================================================================

describe('approveRequest — fresh snapshot (< 15 min)', () => {
  it('does NOT re-evaluate compliance when snapshot is fresh', async () => {
    const freshAt = minutesAgo(5);

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: freshAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: null, error: null },
      { data: { ...managerPendingBidRequestRow, status: 'APPROVED' }, error: null },
    );

    await planningRequestService.approveRequest({ request_id: REQUEST_ID, manager_id: MGR_ID });

    expect(mockEvaluate).not.toHaveBeenCalled();
  });
});

describe('approveRequest — stale snapshot (> 15 min)', () => {
  it('re-evaluates compliance before calling the RPC', async () => {
    const staleAt = minutesAgo(20);

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: staleAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: openShiftRow, error: null },   // fetch shift for BID re-eval
      { error: null },                        // update snapshot in DB (PASS path)
      { data: null, error: null },            // RPC
      { data: { ...managerPendingBidRequestRow, status: 'APPROVED' }, error: null },
    );

    await planningRequestService.approveRequest({ request_id: REQUEST_ID, manager_id: MGR_ID });

    expect(mockEvaluate).toHaveBeenCalledTimes(1);
  });

  it('throws COMPLIANCE_NOW_BLOCKING when re-eval finds a new blocking violation', async () => {
    const staleAt = minutesAgo(20);
    mockEvaluate.mockReturnValue(blockingComplianceResult);

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: staleAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: openShiftRow, error: null },
      { error: null }, // update request → BLOCKED
    );

    await expect(
      planningRequestService.approveRequest({ request_id: REQUEST_ID, manager_id: MGR_ID }),
    ).rejects.toMatchObject({ code: 'COMPLIANCE_NOW_BLOCKING' });
  });

  it('throws SNAPSHOT_UPDATE_FAILED when the DB write for fresh snapshot fails (Bug #5 fix)', async () => {
    const staleAt = minutesAgo(20);

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: staleAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: openShiftRow, error: null },
      // Simulate DB write failure on snapshot update
      { data: null, error: { message: 'Connection timeout' } },
    );

    await expect(
      planningRequestService.approveRequest({ request_id: REQUEST_ID, manager_id: MGR_ID }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_UPDATE_FAILED' });
  });
});
