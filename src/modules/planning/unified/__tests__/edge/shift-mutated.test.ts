/**
 * Shift Mutated — Edge Case Tests
 *
 * Verifies that approveRequest correctly handles a SHIFT_MUTATED error
 * from the sm_finalize_planning_request RPC.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabase-mock';
import {
  MGR_ID,
  REQUEST_ID,
  selectedBidOfferRow, managerPendingBidRequestRow,
} from '../helpers/fixtures';

const { ctx, supabaseProxy } = vi.hoisted(() => {
  const ctx = { mock: null as any };
  return {
    ctx,
    supabaseProxy: new Proxy({} as any, {
      get(_: any, p: string) { return ctx.mock.client[p]; },
    }),
  };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: supabaseProxy }));

vi.mock('@/modules/compliance/v8', () => ({ runV8Orchestrator: vi.fn() }));
vi.mock('@/modules/compliance/employee-context', () => ({
  fetchV8EmployeeContext: vi.fn(),
  fetchEmployeeShiftsV2:  vi.fn(),
}));

import { planningRequestService } from '../../service/planning-request.service';

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  vi.clearAllMocks();
});

// =============================================================================

describe('approveRequest — SHIFT_MUTATED from RPC', () => {
  it('throws SHIFT_MUTATED when the RPC detects a stale shift timestamp', async () => {
    const freshAt = new Date().toISOString();

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: freshAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: null, error: { message: 'SHIFT_MUTATED: shift_id=some-uuid' } },
    );

    await expect(
      planningRequestService.approveRequest({
        request_id: REQUEST_ID,
        manager_id: MGR_ID,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('SHIFT_MUTATED') });
  });

  it('does NOT make additional DB calls after SHIFT_MUTATED is thrown', async () => {
    const freshAt = new Date().toISOString();

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: freshAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: null, error: { message: 'SHIFT_MUTATED: shift_id=some-uuid' } },
    );

    try {
      await planningRequestService.approveRequest({ request_id: REQUEST_ID, manager_id: MGR_ID });
    } catch { /* expected */ }

    expect(ctx.mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('includes the original RPC error detail in the thrown error message', async () => {
    const freshAt = new Date().toISOString();
    const rpcMessage = 'SHIFT_MUTATED: shift_id=bbbbbbbb-0000-0000-0000-000000000001';

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: freshAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: null, error: { message: rpcMessage } },
    );

    let caught: Error | null = null;
    try {
      await planningRequestService.approveRequest({ request_id: REQUEST_ID, manager_id: MGR_ID });
    } catch (e) { caught = e as Error; }

    expect(caught!.message).toContain('SHIFT_MUTATED');
    expect(caught!.message).toContain(rpcMessage);
  });
});
