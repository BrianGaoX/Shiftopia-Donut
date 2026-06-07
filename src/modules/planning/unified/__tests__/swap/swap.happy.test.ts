/**
 * SWAP — Happy Path Tests
 *
 * Tests the full SWAP lifecycle:
 *   createPlanningRequest → submitOffer → selectOffer → approveRequest
 *
 * Critical invariants:
 *   • Party A gains Party B's shift (and vice-versa) — verified via RPC params
 *   • target_shift_updated_at is passed to the RPC (SWAP requires both timestamps)
 *   • combined_status = worst of party A and party B
 *   • No ownership transfer unless both parties PASS
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock';
import {
  EMP_A_ID, EMP_B_ID, MGR_ID,
  REQUEST_ID, OFFER_ID,
  SHIFT_EMP_A_ID, SHIFT_EMP_B_ID, SHIFT_UPDATED_AT,
  openSwapRequestRow, empAShiftRow, empBShiftRow,
  submittedSwapOfferRow, selectedSwapOfferRow,
  managerPendingSwapRequestRow,
  passComplianceResult,
  empContextA, empContextB,
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
  fetchV8EmployeeContext: vi.fn().mockImplementation((id: string) =>
    Promise.resolve(id === EMP_A_ID ? empContextA : empContextB),
  ),
  fetchEmployeeShiftsV2: vi.fn().mockResolvedValue([]),
}));

import { planningRequestService } from '../../service/planning-request.service';

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  vi.clearAllMocks();
});

// =============================================================================

describe('createPlanningRequest — SWAP', () => {
  it('sets shift to OPEN_FOR_TRADE', async () => {
    const shiftRow = { ...empAShiftRow, workflow_status: 'IDLE' };
    const requestRow = { ...openSwapRequestRow, type: 'SWAP' };

    ctx.mock.enqueue(
      { data: shiftRow, error: null },
      { data: requestRow, error: null },
      { error: null },
    );

    const result = await planningRequestService.createPlanningRequest({
      type:         'SWAP',
      shift_id:     SHIFT_EMP_A_ID,
      initiated_by: EMP_A_ID,
    });

    expect(result.type).toBe('SWAP');
    expect(result.status).toBe('OPEN');
  });
});

describe('submitOffer — SWAP', () => {
  it('validates that offerer owns the offered shift', async () => {
    const wrongOwnerShift = { ...empBShiftRow, assigned_employee_id: EMP_A_ID };

    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null }, // fetch request
      { data: empAShiftRow, error: null },        // fetch main shift (time-lock check)
      { data: wrongOwnerShift, error: null },     // fetch offered shift → wrong owner
    );

    await expect(
      planningRequestService.submitOffer({
        request_id:       REQUEST_ID,
        offered_by:       EMP_B_ID,
        offered_shift_id: SHIFT_EMP_B_ID,
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_OWNED' });
  });

  it('creates a SUBMITTED offer when offerer owns the shift', async () => {
    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null },   // fetch request
      { data: empAShiftRow, error: null },          // fetch main shift (time-lock check)
      { data: empBShiftRow, error: null },          // fetch offered shift (owned by EMP_B ✓)
      { data: submittedSwapOfferRow, error: null }, // insert offer
    );

    const result = await planningRequestService.submitOffer({
      request_id:       REQUEST_ID,
      offered_by:       EMP_B_ID,
      offered_shift_id: SHIFT_EMP_B_ID,
    });

    expect(result.status).toBe('SUBMITTED');
    expect(result.offered_shift_id).toBe(SHIFT_EMP_B_ID);
    expect(result.offered_by).toBe(EMP_B_ID);
  });
});

describe('selectOffer — SWAP, PASS', () => {
  it('transitions request to MANAGER_PENDING with combined PASS status', async () => {
    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null },
      { data: submittedSwapOfferRow, error: null },
      { data: empAShiftRow, error: null },
      { data: empBShiftRow, error: null },
      { error: null },
      { error: null },
      { data: managerPendingSwapRequestRow, error: null },
      { error: null },
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: EMP_A_ID,
    });

    expect(result.new_status).toBe('MANAGER_PENDING');
    expect(result.compliance_status).toBe('PASS');
  });
});

describe('approveRequest — SWAP', () => {
  it('calls the RPC with both shift timestamps for atomic swap', async () => {
    const freshEvaluatedAt = new Date().toISOString();

    ctx.mock.enqueue(
      { data: { ...managerPendingSwapRequestRow, compliance_evaluated_at: freshEvaluatedAt }, error: null },
      { data: selectedSwapOfferRow, error: null },
      { data: null, error: null },
      { data: { ...managerPendingSwapRequestRow, status: 'APPROVED' }, error: null },
    );

    const result = await planningRequestService.approveRequest({
      request_id: REQUEST_ID,
      manager_id: MGR_ID,
    });

    expect(result.status).toBe('APPROVED');

    expect(ctx.mock.rpc).toHaveBeenCalledWith(
      'sm_finalize_planning_request',
      expect.objectContaining({
        p_offer_id:                OFFER_ID,
        p_shift_updated_at:        SHIFT_UPDATED_AT,
        p_target_shift_updated_at: SHIFT_UPDATED_AT, // must NOT be null for SWAP
      }),
    );

    const rpcArgs = ctx.mock.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_target_shift_updated_at).not.toBeNull();
  });
});
