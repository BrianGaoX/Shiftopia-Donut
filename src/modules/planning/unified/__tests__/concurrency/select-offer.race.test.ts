/**
 * Race Condition — Concurrent selectOffer Tests
 *
 * Bug #3 (fixed): two concurrent selectOffer calls both pass the OPEN status
 * read. The second caller's optimistic update matches 0 rows and used to
 * silently return { request: null }. The fix throws CONCURRENT_MODIFICATION.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabase-mock';
import {
  MGR_ID, EMP_B_ID,
  REQUEST_ID, OFFER_ID, OFFER_ID_2,
  openBidRequestRow, openShiftRow,
  submittedBidOfferRow,
  managerPendingBidRequestRow,
  passComplianceResult, empContextA,
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

vi.mock('@/modules/compliance/v8', () => ({
  runV8Orchestrator: vi.fn().mockReturnValue(passComplianceResult),
}));

vi.mock('@/modules/compliance/employee-context', () => ({
  fetchV8EmployeeContext: vi.fn().mockResolvedValue(empContextA),
  fetchEmployeeShiftsV2:  vi.fn().mockResolvedValue([]),
}));

import { planningRequestService } from '../../service/planning-request.service';

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  vi.clearAllMocks();
});

// =============================================================================

describe('selectOffer — concurrent calls (Bug #3 fix)', () => {
  it('throws CONCURRENT_MODIFICATION when the optimistic advance matches 0 rows', async () => {
    /**
     * Simulates the losing side of a concurrent selectOffer race:
     *   - Both callers read OPEN status
     *   - One caller wins (advances the request)
     *   - The other caller's optimistic update matches 0 rows (null returned)
     *   → Fix: throw CONCURRENT_MODIFICATION instead of silently returning null
     *
     * NOTE: True concurrent interleaving cannot be reliably modelled with a single
     * FIFO queue. We test the invariant by directly simulating the losing-side
     * DB response sequence (advance returns null = 0 rows updated).
     */
    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },          // fetch request (OPEN)
      { data: submittedBidOfferRow, error: null },       // fetch offer
      { data: openShiftRow, error: null },               // fetch main shift
      { error: null },                                   // reject other offers
      { error: null },                                   // mark offer SELECTED
      { data: null, error: null },                       // advance → 0 rows → concurrent race
    );

    await expect(
      planningRequestService.selectOffer({
        request_id:  REQUEST_ID,
        offer_id:    OFFER_ID,
        selected_by: MGR_ID,
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });

  it('the losing caller throws CONCURRENT_MODIFICATION (not a silent null return)', async () => {
    /**
     * The fix for Bug #3:
     *   if (!updatedRequest) {
     *     throw createError('CONCURRENT_MODIFICATION', ...);
     *   }
     */
    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },
      { data: submittedBidOfferRow, error: null },
      { data: openShiftRow, error: null },
      { error: null },
      { error: null },
      { data: null, error: null }, // 0 rows → null
    );

    await expect(
      planningRequestService.selectOffer({
        request_id:  REQUEST_ID,
        offer_id:    OFFER_ID,
        selected_by: MGR_ID,
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });

  it('a clean (non-concurrent) selectOffer does NOT throw CONCURRENT_MODIFICATION', async () => {
    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },
      { data: submittedBidOfferRow, error: null },
      { data: openShiftRow, error: null },
      { error: null },
      { error: null },
      { data: managerPendingBidRequestRow, error: null }, // real data returned
      { error: null },
    );

    await expect(
      planningRequestService.selectOffer({
        request_id:  REQUEST_ID,
        offer_id:    OFFER_ID,
        selected_by: MGR_ID,
      }),
    ).resolves.toMatchObject({ new_status: 'MANAGER_PENDING' });
  });
});
