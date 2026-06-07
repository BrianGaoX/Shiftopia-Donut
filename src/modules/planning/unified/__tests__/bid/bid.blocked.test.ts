/**
 * BID — Blocked Compliance Tests
 *
 * When runV8Orchestrator returns BLOCKING:
 *   • Request transitions to BLOCKED
 *   • The offer's status must remain SUBMITTED (never changed)
 *   • blocking_hits array is populated
 *   • No SELECTED offer is created
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock';
import {
  MGR_ID, EMP_A_ID,
  REQUEST_ID, OFFER_ID,
  openShiftRow, openBidRequestRow, submittedBidOfferRow,
  blockingComplianceResult, empContextA,
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
  runV8Orchestrator: vi.fn().mockReturnValue(blockingComplianceResult),
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

describe('selectOffer — BID, BLOCKING compliance', () => {
  it('returns BLOCKED status when compliance is BLOCKING', async () => {
    const blockedRequestRow = {
      ...openBidRequestRow,
      status: 'BLOCKED',
      compliance_snapshot: {
        overall_status:   'BLOCKING',
        hits:             blockingComplianceResult.hits,
        shift_updated_at: openShiftRow.updated_at,
        evaluated_at:     new Date().toISOString(),
      },
    };

    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },      // fetch request
      { data: submittedBidOfferRow, error: null },   // fetch offer
      { data: openShiftRow, error: null },            // fetch main shift
      { data: blockedRequestRow, error: null },       // update request → BLOCKED
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: MGR_ID,
    });

    expect(result.new_status).toBe('BLOCKED');
    expect(result.compliance_status).toBe('BLOCKING');
  });

  it('populates blocking_hits with details of the rule violation', async () => {
    const blockedRequestRow = { ...openBidRequestRow, status: 'BLOCKED' };

    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },
      { data: submittedBidOfferRow, error: null },
      { data: openShiftRow, error: null },
      { data: blockedRequestRow, error: null },
    );

    const result = await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: MGR_ID,
    });

    expect(result.blocking_hits).toBeDefined();
    expect(result.blocking_hits!.length).toBeGreaterThan(0);
    expect(result.blocking_hits![0]).toMatchObject({
      rule_id:  'R01_no_overlap',
      severity: 'BLOCKING',
      party:    'A',
    });
  });

  it('does NOT update offer status when compliance is BLOCKING', async () => {
    const blockedRequestRow = { ...openBidRequestRow, status: 'BLOCKED' };

    ctx.mock.enqueue(
      { data: openBidRequestRow, error: null },
      { data: submittedBidOfferRow, error: null },
      { data: openShiftRow, error: null },
      { data: blockedRequestRow, error: null },
    );

    await planningRequestService.selectOffer({
      request_id:  REQUEST_ID,
      offer_id:    OFFER_ID,
      selected_by: MGR_ID,
    });

    // Only one planning_offers call (the initial fetch) — no updates
    expect(ctx.mock.calls.filter(c => c.startsWith('from:planning_offers'))).toHaveLength(1);
  });
});
