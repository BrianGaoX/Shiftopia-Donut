/**
 * BID — Happy Path Tests
 *
 * Tests the full BID lifecycle:
 *   createPlanningRequest → submitOffer → selectOffer → approveRequest
 *
 * Critical invariant: the shift must be assigned to the OFFERER (EMP_A),
 * not the request initiator (MGR). This was Bug #1 (CRITICAL) in the system assessment.
 *
 * Mock strategy:
 *   - Supabase client is mocked via createSupabaseMock()
 *   - runV8Orchestrator mocked to return PASS
 *   - fetchV8EmployeeContext / fetchEmployeeShiftsV2 mocked to return minimal stubs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock';
import {
  MGR_ID, EMP_A_ID,
  REQUEST_ID, OFFER_ID,
  SHIFT_OPEN_ID, SHIFT_UPDATED_AT,
  openShiftRow, openBidRequestRow,
  submittedBidOfferRow, selectedBidOfferRow,
  managerPendingBidRequestRow,
  passComplianceResult,
  empContextA,
} from '../helpers/fixtures';

// ── Module mocks (hoisted before imports of the module under test) ────────────

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

// Import after mocks are declared
import { planningRequestService } from '../../service/planning-request.service';

// =============================================================================

beforeEach(() => {
  ctx.mock = createSupabaseMock();
  vi.clearAllMocks();
});

// =============================================================================
// createPlanningRequest
// =============================================================================

describe('createPlanningRequest — BID', () => {
  it('creates a BID request and sets shift to OPEN_FOR_BIDS', async () => {
    ctx.mock.enqueue(
      { data: openShiftRow, error: null },      // fetch shift (workflow check)
      { data: openBidRequestRow, error: null }, // insert planning_request
      { error: null },                           // update shift → OPEN_FOR_BIDS
    );

    const result = await planningRequestService.createPlanningRequest({
      type:         'BID',
      shift_id:     SHIFT_OPEN_ID,
      initiated_by: MGR_ID,
    });

    expect(result.type).toBe('BID');
    expect(result.status).toBe('OPEN');
    expect(result.shift_id).toBe(SHIFT_OPEN_ID);
  });

  it('throws SHIFT_NOT_IDLE when the shift workflow_status is not IDLE', async () => {
    ctx.mock.enqueue({
      data: { ...openShiftRow, workflow_status: 'OPEN_FOR_BIDS' },
      error: null,
    });

    await expect(
      planningRequestService.createPlanningRequest({
        type:         'BID',
        shift_id:     SHIFT_OPEN_ID,
        initiated_by: MGR_ID,
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_IDLE' });
  });
});

// =============================================================================
// submitOffer — BID
// =============================================================================

describe('submitOffer — BID', () => {
  it('creates a SUBMITTED offer with null offered_shift_id for BID', async () => {
    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },    // fetch request
      { data: openShiftRow, error: null },         // fetch main shift (time-lock check)
      { data: submittedBidOfferRow, error: null }, // insert offer
    );

    const result = await planningRequestService.submitOffer({
      request_id: REQUEST_ID,
      offered_by: EMP_A_ID,
    });

    expect(result.status).toBe('SUBMITTED');
    expect(result.offered_shift_id).toBeNull();
    expect(result.offered_by).toBe(EMP_A_ID);
  });

  it('throws REQUEST_NOT_OPEN when request is MANAGER_PENDING', async () => {
    ctx.mock.enqueue({ data: managerPendingBidRequestRow, error: null });

    await expect(
      planningRequestService.submitOffer({
        request_id: REQUEST_ID,
        offered_by: EMP_A_ID,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_OPEN' });
  });
});

// =============================================================================
// selectOffer — BID, PASS compliance
// =============================================================================

describe('selectOffer — BID, PASS', () => {
  it('transitions request to MANAGER_PENDING and marks offer SELECTED', async () => {
    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },                   // fetch request
      { data: submittedBidOfferRow, error: null },                // fetch offer
      { data: openShiftRow, error: null },                        // fetch main shift
      { error: null },                                            // reject other offers
      { error: null },                                            // mark offer SELECTED
      { data: managerPendingBidRequestRow, error: null },         // advance to MANAGER_PENDING
      { error: null },                                            // update shift → PENDING_APPROVAL
    );

    const result = await planningRequestService.selectOffer({
      request_id: REQUEST_ID,
      offer_id:   OFFER_ID,
      selected_by: MGR_ID,
    });

    expect(result.new_status).toBe('MANAGER_PENDING');
    expect(result.compliance_status).toBe('PASS');
  });

  it('throws NOT_INITIATOR when selected_by is not the request initiator', async () => {
    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null }, // fetch request (initiated_by = MGR_ID)
    );

    await expect(
      planningRequestService.selectOffer({
        request_id:  REQUEST_ID,
        offer_id:    OFFER_ID,
        selected_by: EMP_A_ID, // EMP_A is NOT the initiator (MGR is)
      }),
    ).rejects.toMatchObject({ code: 'NOT_INITIATOR' });
  });
});

// =============================================================================
// approveRequest — BID
// CRITICAL INVARIANT: the RPC must be called with the offer's ID (not initiator)
// =============================================================================

describe('approveRequest — BID', () => {
  it('calls sm_finalize_planning_request with the correct offer ID', async () => {
    const freshEvaluatedAt = new Date().toISOString(); // just now → not stale

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: freshEvaluatedAt }, error: null }, // fetch request
      { data: selectedBidOfferRow, error: null },                                                           // fetch selected offer
      { data: null, error: null },                                                                          // RPC
      { data: { ...managerPendingBidRequestRow, status: 'APPROVED' }, error: null },                        // fetch final request
    );

    const result = await planningRequestService.approveRequest({
      request_id: REQUEST_ID,
      manager_id: MGR_ID,
    });

    expect(result.status).toBe('APPROVED');

    // The RPC must be called with p_offer_id = OFFER_ID (the offerer's ID is inside
    // the RPC — this verifies the service passes the correct offer to the SQL function
    // that then reads v_offer.offered_by for the shift assignment).
    expect(ctx.mock.rpc).toHaveBeenCalledWith(
      'sm_finalize_planning_request',
      expect.objectContaining({
        p_offer_id:              OFFER_ID,
        p_request_id:            REQUEST_ID,
        p_manager_id:            MGR_ID,
        p_shift_updated_at:      SHIFT_UPDATED_AT,
        p_target_shift_updated_at: null, // BID has no target shift
      }),
    );
  });

  it('throws SHIFT_MUTATED when the RPC raises a SHIFT_MUTATED error', async () => {
    const freshEvaluatedAt = new Date().toISOString();

    ctx.mock.enqueue(
      { data: { ...managerPendingBidRequestRow, compliance_evaluated_at: freshEvaluatedAt }, error: null },
      { data: selectedBidOfferRow, error: null },
      { data: null, error: { message: 'SHIFT_MUTATED: shift_id=some-id' } }, // RPC error
    );

    await expect(
      planningRequestService.approveRequest({
        request_id: REQUEST_ID,
        manager_id: MGR_ID,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('SHIFT_MUTATED') });
  });
});
