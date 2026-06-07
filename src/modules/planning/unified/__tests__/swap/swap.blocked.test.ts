/**
 * SWAP — Blocked Compliance Tests
 *
 * Covers:
 *   • Either party BLOCKING → combined = BLOCKING → request = BLOCKED
 *   • Both parties PASS but one WARNING → combined = WARNING → MANAGER_PENDING
 *   • blocking_hits correctly attribute party A, party B, or BOTH
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabase-mock';
import {
  EMP_A_ID,
  REQUEST_ID, OFFER_ID,
  openSwapRequestRow, empAShiftRow, empBShiftRow,
  submittedSwapOfferRow, managerPendingSwapRequestRow,
  passComplianceResult, blockingComplianceResult, warningComplianceResult,
  makeV8Hit, empContextA, empContextB,
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

vi.mock('@/platform/realtime/client', () => ({ supabase: supabaseProxy }));

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

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  mockEvaluate.mockReset();
});

// =============================================================================

describe('selectOffer — SWAP, one party BLOCKING', () => {
  it('returns BLOCKED when party A fails compliance', async () => {
    mockEvaluate
      .mockReturnValueOnce(blockingComplianceResult)
      .mockReturnValueOnce(passComplianceResult);

    const blockedRow = { ...openSwapRequestRow, status: 'BLOCKED' };

    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null },
      { data: submittedSwapOfferRow, error: null },
      { data: empAShiftRow, error: null },
      { data: empBShiftRow, error: null },
      { data: blockedRow, error: null },
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: EMP_A_ID,
    });

    expect(result.new_status).toBe('BLOCKED');
    expect(result.compliance_status).toBe('BLOCKING');
  });

  it('returns BLOCKED when party B fails compliance', async () => {
    mockEvaluate
      .mockReturnValueOnce(passComplianceResult)
      .mockReturnValueOnce(blockingComplianceResult);

    const blockedRow = { ...openSwapRequestRow, status: 'BLOCKED' };

    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null },
      { data: submittedSwapOfferRow, error: null },
      { data: empAShiftRow, error: null },
      { data: empBShiftRow, error: null },
      { data: blockedRow, error: null },
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: EMP_A_ID,
    });

    expect(result.new_status).toBe('BLOCKED');
    expect(result.compliance_status).toBe('BLOCKING');
  });
});

describe('selectOffer — SWAP, WARNING passes through to MANAGER_PENDING', () => {
  it('advances to MANAGER_PENDING when one party has WARNING (not BLOCKING)', async () => {
    mockEvaluate
      .mockReturnValueOnce(warningComplianceResult)
      .mockReturnValueOnce(passComplianceResult);

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
    expect(result.compliance_status).toBe('WARNING');
  });
});

describe('blocking_hits attribution — SWAP', () => {
  it("labels party A's exclusive hits as party: 'A'", async () => {
    const partyAResult = {
      ...blockingComplianceResult,
      hits: [makeV8Hit('R01', 'BLOCKING', 'A blocked')],
    };

    mockEvaluate
      .mockReturnValueOnce(partyAResult)
      .mockReturnValueOnce(passComplianceResult);

    const blockedRow = { ...openSwapRequestRow, status: 'BLOCKED' };

    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null },
      { data: submittedSwapOfferRow, error: null },
      { data: empAShiftRow, error: null },
      { data: empBShiftRow, error: null },
      { data: blockedRow, error: null },
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: EMP_A_ID,
    });

    expect(result.blocking_hits).toBeDefined();
    expect(result.blocking_hits!.find(h => h.rule_id === 'R01')?.party).toBe('A');
  });

  it("labels shared hits as party: 'BOTH'", async () => {
    const sharedHit = makeV8Hit('R02', 'BLOCKING', 'Shared block');
    mockEvaluate
      .mockReturnValueOnce({ ...blockingComplianceResult, hits: [sharedHit] })
      .mockReturnValueOnce({ ...blockingComplianceResult, hits: [sharedHit] });

    const blockedRow = { ...openSwapRequestRow, status: 'BLOCKED' };

    ctx.mock.enqueue(
      { data: openSwapRequestRow, error: null },
      { data: submittedSwapOfferRow, error: null },
      { data: empAShiftRow, error: null },
      { data: empBShiftRow, error: null },
      { data: blockedRow, error: null },
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: EMP_A_ID,
    });

    expect(result.blocking_hits?.find(h => h.rule_id === 'R02')?.party).toBe('BOTH');
  });
});
