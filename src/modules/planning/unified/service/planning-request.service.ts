/**
 * Unified Planning Request Service
 *
 * Single service for all BID and SWAP planning request operations.
 * All compliance evaluation flows through the ONE shared engine (runV8Orchestrator).
 * No rule logic is duplicated here — this layer only orchestrates data fetching,
 * input construction, and state transitions.
 *
 * Architecture:
 *   createPlanningRequest  — open a new BID or SWAP request
 *   submitOffer            — employee responds to an open request
 *   withdrawOffer          — offerer retracts their pending offer
 *   selectOffer            — initiator picks a winner; compliance runs here
 *   cancelRequest          — initiator cancels before manager decision
 *   reopenRequest          — initiator reopens a blocked/rejected request
 *   approveRequest         — manager approves; triggers atomic RPC
 *   rejectRequest          — manager rejects; shift reverts to IDLE
 */

import { supabase } from '@/platform/realtime/client';
import {
  fetchV8EmployeeContext,
  fetchEmployeeShiftsV2,
} from '@/modules/compliance/employee-context';
import { runV8Orchestrator } from '@/modules/compliance/v8';
import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';

import {
  buildBidInput,
  buildSwapInputs,
  deriveV8Stage,
} from '../compliance/input-builder';
import {
  buildBidSnapshot,
  buildSwapSnapshot,
  extractBlockingHits,
  combinedStatus,
} from '../compliance/snapshot-builder';

import type {
  PlanningRequest,
  PlanningOffer,
  PlanningRequestStatus,
  BidComplianceSnapshot,
  SwapComplianceSnapshot,
  PlanningComplianceSnapshot,
  SelectOfferResult,
  BlockingHit,
  CreateRequestParams,
  SubmitOfferParams,
  SelectOfferParams,
  CancelRequestParams,
  ReopenRequestParams,
  ApproveRequestParams,
  RejectRequestParams,
} from '../types';

import type { V8OrchestratorShift } from '@/modules/compliance/v8/orchestrator/types';

// Use "any" cast for tables not in the generated Supabase type definitions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Shifts starting sooner than this are time-locked */
const TIME_LOCK_HOURS = 4;

/** Compliance snapshots older than this must be refreshed before approval */
const COMPLIANCE_STALE_MS = 15 * 60 * 1000; // 15 minutes

/** Window (days either side of shift date) for fetching existing shifts */
const SHIFT_WINDOW_DAYS = 35;

/** Terminal request statuses — no further actions allowed */
const TERMINAL_STATUSES: PlanningRequestStatus[] = [
  'APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED', 'EXPIRED',
];

// =============================================================================
// SHARED UTILITIES
// =============================================================================

/**
 * Throw a coded error when a shift's start time is within TIME_LOCK_HOURS
 * of the current moment. All mutating operations call this guard.
 */
function assertNotTimeLocked(shiftDate: string, startTime: string): void {
  const shiftStart = new Date(`${shiftDate}T${startTime}`);
  const lockBoundary = new Date(Date.now() + TIME_LOCK_HOURS * 60 * 60 * 1000);
  if (shiftStart <= lockBoundary) {
    throw createError(
      'TIME_LOCKED',
      `Shift starts within ${TIME_LOCK_HOURS} hours. Action is time-locked.`,
    );
  }
}

/**
 * Create a typed coded Error. Every thrown error in this service carries
 * a machine-readable `.code` property for client-side branching.
 */
function createError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Map a raw DB shift row to the V8OrchestratorShift shape the compliance engine expects.
 * Only the fields the engine needs are mapped — extended UI fields are ignored.
 */
function mapShiftToV2(row: Record<string, unknown>): V8OrchestratorShift {
  return {
    id: row.id as string,
    date: row.shift_date as string,
    start_time: row.start_time as string,
    end_time: row.end_time as string,
    role_id: (row.role_id as string | null) ?? '',
    required_qualifications: (row.required_qualifications as string[] | null) ?? [],
    is_ordinary_hours: (row.is_ordinary_hours as boolean | null) ?? true,
    break_minutes: (row.break_minutes as number | null) ?? 0,
    unpaid_break_minutes: (row.unpaid_break_minutes as number | null) ?? 0,
  };
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Open a new planning request (BID or SWAP).
 *
 * Validates:
 *   - Shift exists and is in IDLE workflow state
 *   - Shift starts more than 4 hours from now
 *
 * Side effects:
 *   - Inserts a row into planning_requests
 *   - Updates shifts.workflow_status to OPEN_FOR_BIDS or OPEN_FOR_TRADE
 */
async function createPlanningRequest(
  params: CreateRequestParams,
): Promise<PlanningRequest> {
  const { type, shift_id, initiated_by, reason, target_employee_id } = params;

  // Fetch shift and validate pre-conditions
  const { data: shift, error: shiftError } = await supabase
    .from('shifts')
    .select('id, shift_date, start_time, workflow_status')
    .eq('id', shift_id)
    .single();

  if (shiftError || !shift) {
    throw createError('SHIFT_NOT_FOUND', `Shift ${shift_id} not found.`);
  }

  if ((shift as any).workflow_status !== 'IDLE') {
    throw createError(
      'SHIFT_NOT_IDLE',
      `Shift ${shift_id} has workflow_status '${(shift as any).workflow_status}'. ` +
      'Only IDLE shifts can be opened for planning requests.',
    );
  }

  assertNotTimeLocked((shift as any).shift_date, (shift as any).start_time);

  // Insert the planning request
  const { data: request, error: insertError } = await db
    .from('planning_requests')
    .insert({
      type,
      status: 'OPEN',
      shift_id,
      initiated_by,
      reason: reason ?? null,
      target_employee_id: target_employee_id ?? null,
    })
    .select()
    .single();

  if (insertError) {
    throw createError(
      'REQUEST_INSERT_FAILED',
      `Failed to create planning request: ${insertError.message}`,
    );
  }

  // Update shift workflow status
  // TODO: workflow_status is not yet in the generated Supabase types (schema drift) — cast as any.
  const newWorkflowStatus = type === 'BID' ? 'OPEN_FOR_BIDS' : 'OPEN_FOR_TRADE';
  const { error: shiftUpdateError } = await supabase
    .from('shifts')
    .update({ workflow_status: newWorkflowStatus } as any)
    .eq('id', shift_id);

  if (shiftUpdateError) {
    throw createError(
      'SHIFT_STATUS_UPDATE_FAILED',
      `Failed to update shift workflow status: ${shiftUpdateError.message}`,
    );
  }

  return request as PlanningRequest;
}

/**
 * Submit an offer in response to an OPEN planning request.
 *
 * Validates:
 *   - Request exists and is OPEN
 *   - Offerer is not the request initiator
 *   - Shift is not time-locked
 *   - For SWAP: offered_shift_id is provided and owned by the offerer
 */
async function submitOffer(params: SubmitOfferParams): Promise<PlanningOffer> {
  const { request_id, offered_by, offered_shift_id } = params;

  // Fetch and validate the request
  const { data: request, error: requestError } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (requestError || !request) {
    throw createError('REQUEST_NOT_FOUND', `Planning request ${request_id} not found.`);
  }

  if ((request as PlanningRequest).status !== 'OPEN') {
    throw createError(
      'REQUEST_NOT_OPEN',
      `Request ${request_id} is not OPEN (status: ${(request as PlanningRequest).status}).`,
    );
  }

  if ((request as PlanningRequest).initiated_by === offered_by) {
    throw createError(
      'SELF_OFFER_NOT_ALLOWED',
      'The request initiator cannot submit an offer on their own request.',
    );
  }

  // Time-lock check on the main request shift
  const { data: requestShift, error: shiftError } = await supabase
    .from('shifts')
    .select('shift_date, start_time')
    .eq('id', (request as PlanningRequest).shift_id)
    .single();

  if (shiftError || !requestShift) {
    throw createError('SHIFT_NOT_FOUND', 'Request shift could not be fetched.');
  }

  assertNotTimeLocked((requestShift as any).shift_date, (requestShift as any).start_time);

  // For SWAP: validate the offered shift exists and is owned by the offerer
  if ((request as PlanningRequest).type === 'SWAP') {
    if (!offered_shift_id) {
      throw createError(
        'SWAP_SHIFT_REQUIRED',
        'SWAP offers must include an offered_shift_id.',
      );
    }

    const { data: offeredShift, error: offeredShiftError } = await supabase
      .from('shifts')
      .select('id, assigned_employee_id, shift_date, start_time')
      .eq('id', offered_shift_id)
      .single();

    if (offeredShiftError || !offeredShift) {
      throw createError(
        'OFFERED_SHIFT_NOT_FOUND',
        `Offered shift ${offered_shift_id} not found.`,
      );
    }

    if ((offeredShift as any).assigned_employee_id !== offered_by) {
      throw createError(
        'SHIFT_NOT_OWNED',
        `Shift ${offered_shift_id} is not assigned to employee ${offered_by}.`,
      );
    }

    assertNotTimeLocked(
      (offeredShift as any).shift_date,
      (offeredShift as any).start_time,
    );
  }

  // Insert the offer
  const { data: offer, error: offerError } = await db
    .from('planning_offers')
    .insert({
      request_id,
      offered_by,
      offered_shift_id: offered_shift_id ?? null,
      status: 'SUBMITTED',
    })
    .select()
    .single();

  if (offerError) {
    throw createError(
      'OFFER_INSERT_FAILED',
      `Failed to submit offer: ${offerError.message}`,
    );
  }

  return offer as PlanningOffer;
}

/**
 * Withdraw a SUBMITTED offer.
 *
 * Validates:
 *   - Offer exists and belongs to the specified employee
 *   - Offer status is SUBMITTED (cannot withdraw a SELECTED or REJECTED offer)
 */
async function withdrawOffer(params: {
  offerId: string;
  employeeId: string;
}): Promise<void> {
  const { offerId, employeeId } = params;

  const { data: offer, error: fetchError } = await db
    .from('planning_offers')
    .select('id, offered_by, status')
    .eq('id', offerId)
    .single();

  if (fetchError || !offer) {
    throw createError('OFFER_NOT_FOUND', `Offer ${offerId} not found.`);
  }

  if ((offer as PlanningOffer).offered_by !== employeeId) {
    throw createError(
      'OFFER_NOT_OWNED',
      `Offer ${offerId} does not belong to employee ${employeeId}.`,
    );
  }

  if ((offer as PlanningOffer).status !== 'SUBMITTED') {
    throw createError(
      'OFFER_NOT_WITHDRAWABLE',
      `Cannot withdraw offer in status '${(offer as PlanningOffer).status}'. ` +
      'Only SUBMITTED offers can be withdrawn.',
    );
  }

  const { error: updateError } = await db
    .from('planning_offers')
    .update({ status: 'WITHDRAWN' })
    .eq('id', offerId);

  if (updateError) {
    throw createError(
      'OFFER_WITHDRAW_FAILED',
      `Failed to withdraw offer: ${updateError.message}`,
    );
  }
}

/**
 * Select an offer as the winner and run compliance evaluation.
 *
 * This is the most complex operation in the service:
 *   1. Validate request is OPEN and offer is SUBMITTED
 *   2. Capture shift updated_at timestamps (optimistic lock seeds)
 *   3. Fetch full shift data and employee contexts
 *   4. Build compliance inputs and run the engine
 *   5. Build typed snapshot
 *   6. If BLOCKING → mark request BLOCKED and return
 *   7. If PASS/WARNING → mark offer SELECTED, reject others, advance to MANAGER_PENDING
 *
 * Concurrency: The Supabase JS client does not expose SELECT FOR UPDATE.
 * We use an optimistic update pattern — the status transition from OPEN
 * acts as the lock. Only one concurrent call can move a request from OPEN
 * to BLOCKED or MANAGER_PENDING; a second concurrent call will fail when it
 * fetches and sees non-OPEN status.
 */
async function selectOffer(params: SelectOfferParams): Promise<SelectOfferResult> {
  const { request_id, offer_id, selected_by } = params;

  // ── Fetch and validate request ──────────────────────────────────────────────
  const { data: requestRow, error: requestError } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (requestError || !requestRow) {
    throw createError('REQUEST_NOT_FOUND', `Planning request ${request_id} not found.`);
  }

  const request = requestRow as PlanningRequest;

  // Only the initiator may select an offer
  if (selected_by && request.initiated_by !== selected_by) {
    throw createError(
      'NOT_INITIATOR',
      `Only the request initiator can select an offer. ` +
      `Caller: ${selected_by}, Initiator: ${request.initiated_by}`,
    );
  }

  if (request.status !== 'OPEN') {
    throw createError(
      'REQUEST_NOT_OPEN',
      `Request ${request_id} is not OPEN (status: ${request.status}). ` +
      'Another offer may already be selected.',
    );
  }

  // ── Fetch and validate offer ────────────────────────────────────────────────
  const { data: offerRow, error: offerError } = await db
    .from('planning_offers')
    .select('*')
    .eq('id', offer_id)
    .eq('request_id', request_id)
    .single();

  if (offerError || !offerRow) {
    throw createError(
      'OFFER_NOT_FOUND',
      `Offer ${offer_id} not found for request ${request_id}.`,
    );
  }

  const offer = offerRow as PlanningOffer;

  if (offer.status !== 'SUBMITTED') {
    throw createError(
      'OFFER_NOT_SUBMITTED',
      `Offer ${offer_id} has status '${offer.status}'. Only SUBMITTED offers can be selected.`,
    );
  }

  // ── Fetch main shift ────────────────────────────────────────────────────────
  const { data: mainShiftRow, error: mainShiftError } = await supabase
    .from('shifts')
    .select('*')
    .eq('id', request.shift_id)
    .single();

  if (mainShiftError || !mainShiftRow) {
    throw createError('SHIFT_NOT_FOUND', `Request shift ${request.shift_id} not found.`);
  }

  const mainShift = mainShiftRow as Record<string, unknown>;

  // Time-lock check
  assertNotTimeLocked(mainShift.shift_date as string, mainShift.start_time as string);

  // Capture updated_at for optimistic locking
  const shiftUpdatedAt = mainShift.updated_at as string;

  // ── Compliance evaluation ───────────────────────────────────────────────────
  const mainV8OrchestratorShift = mapShiftToV2(mainShift);
  const stage = deriveV8Stage({
    lifecycle_status: mainShift.lifecycle_status as string | null,
    is_published: mainShift.is_published as boolean | null,
  });

  let complianceSnapshot: PlanningComplianceSnapshot;
  let finalStatus: ReturnType<typeof combinedStatus>;

  if (request.type === 'BID') {
    // BID: evaluate compliance for the bidder gaining the open shift
    const bidderId = offer.offered_by;

    const [bidderContext, bidderShifts] = await Promise.all([
      fetchV8EmployeeContext(bidderId),
      fetchEmployeeShiftsV2(
        bidderId,
        mainShift.shift_date as string,
        SHIFT_WINDOW_DAYS,
        null,
      ),
    ]);

    const bidInput = buildBidInput({
      employeeId: bidderId,
      employeeContext: bidderContext,
      existingShifts: bidderShifts,
      candidateShift: mainV8OrchestratorShift,
      stage,
    });

    const bidResult = runV8Orchestrator(bidInput) as V8OrchestratorResult;

    complianceSnapshot = buildBidSnapshot({
      result: bidResult,
      shiftUpdatedAt,
    });

    finalStatus = bidResult.overall_status;

  } else {
    // SWAP: evaluate compliance for both parties simultaneously
    if (!offer.offered_shift_id) {
      throw createError(
        'SWAP_OFFER_NO_SHIFT',
        `SWAP offer ${offer_id} is missing offered_shift_id.`,
      );
    }

    const { data: offeredShiftRow, error: offeredShiftError } = await supabase
      .from('shifts')
      .select('*')
      .eq('id', offer.offered_shift_id)
      .single();

    if (offeredShiftError || !offeredShiftRow) {
      throw createError(
        'OFFERED_SHIFT_NOT_FOUND',
        `Offered shift ${offer.offered_shift_id} not found.`,
      );
    }

    const offeredShift = offeredShiftRow as Record<string, unknown>;
    const targetShiftUpdatedAt = offeredShift.updated_at as string;
    const offeredV8OrchestratorShift = mapShiftToV2(offeredShift);

    // Party A = the request initiator (gives up request.shift_id, gains offered shift)
    // Party B = the offer submitter (gives up their shift, gains request.shift_id)
    const partyAId = request.initiated_by;
    const partyBId = offer.offered_by;

    const [partyAContext, partyBContext, partyAShifts, partyBShifts] = await Promise.all([
      fetchV8EmployeeContext(partyAId),
      fetchV8EmployeeContext(partyBId),
      fetchEmployeeShiftsV2(
        partyAId,
        mainShift.shift_date as string,
        SHIFT_WINDOW_DAYS,
        request.shift_id,
      ),
      fetchEmployeeShiftsV2(
        partyBId,
        offeredShift.shift_date as string,
        SHIFT_WINDOW_DAYS,
        offer.offered_shift_id,
      ),
    ]);

    const { inputA, inputB } = buildSwapInputs({
      partyAEmployeeId: partyAId,
      partyAContext,
      partyAExistingShifts: partyAShifts,
      partyAShift: mainV8OrchestratorShift,
      partyBEmployeeId: partyBId,
      partyBContext,
      partyBExistingShifts: partyBShifts,
      partyBShift: offeredV8OrchestratorShift,
      stage,
    });

    const [resultA, resultB] = [
      runV8Orchestrator(inputA) as V8OrchestratorResult,
      runV8Orchestrator(inputB) as V8OrchestratorResult,
    ];

    complianceSnapshot = buildSwapSnapshot({
      resultA,
      resultB,
      shiftUpdatedAt,
      targetShiftUpdatedAt,
    });

    finalStatus = combinedStatus(resultA.overall_status, resultB.overall_status);
  }

  const now = new Date().toISOString();

  // ── BLOCKING: mark request BLOCKED and return ───────────────────────────────
  if (finalStatus === 'BLOCKING') {
    const blockingHits = extractBlockingHits(complianceSnapshot);

    const { data: blockedRequest, error: blockError } = await db
      .from('planning_requests')
      .update({
        status: 'BLOCKED',
        compliance_snapshot: complianceSnapshot,
        compliance_evaluated_at: now,
        updated_at: now,
      })
      .eq('id', request_id)
      .eq('status', 'OPEN')  // Guard: only apply if still OPEN
      .select()
      .single();

    if (blockError) {
      throw createError(
        'REQUEST_UPDATE_FAILED',
        `Failed to mark request as BLOCKED: ${blockError.message}`,
      );
    }

    return {
      request: blockedRequest as PlanningRequest,
      new_status: 'BLOCKED',
      compliance_status: finalStatus,
      blocking_hits: blockingHits,
    };
  }

  // ── PASS / WARNING: advance to MANAGER_PENDING ──────────────────────────────

  // Reject all other SUBMITTED offers for this request
  const { error: rejectOthersError } = await db
    .from('planning_offers')
    .update({ status: 'REJECTED', updated_at: now })
    .eq('request_id', request_id)
    .neq('id', offer_id)
    .eq('status', 'SUBMITTED');

  if (rejectOthersError) {
    throw createError(
      'OFFER_BULK_REJECT_FAILED',
      `Failed to reject competing offers: ${rejectOthersError.message}`,
    );
  }

  // Mark the selected offer as SELECTED
  const { error: selectError } = await db
    .from('planning_offers')
    .update({ status: 'SELECTED', updated_at: now })
    .eq('id', offer_id);

  if (selectError) {
    throw createError(
      'OFFER_SELECT_FAILED',
      `Failed to mark offer as SELECTED: ${selectError.message}`,
    );
  }

  // Advance request to MANAGER_PENDING
  const { data: updatedRequest, error: advanceError } = await db
    .from('planning_requests')
    .update({
      status: 'MANAGER_PENDING',
      target_employee_id: offer.offered_by,
      compliance_snapshot: complianceSnapshot,
      compliance_evaluated_at: now,
      updated_at: now,
    })
    .eq('id', request_id)
    .eq('status', 'OPEN')  // Guard: only apply if still OPEN
    .select()
    .single();

  if (advanceError) {
    throw createError(
      'REQUEST_UPDATE_FAILED',
      `Failed to advance request to MANAGER_PENDING: ${advanceError.message}`,
    );
  }

  // Guard against concurrent selectOffer: if the optimistic .eq('status','OPEN')
  // guard matched 0 rows, another concurrent call already advanced this request.
  if (!updatedRequest) {
    throw createError(
      'CONCURRENT_MODIFICATION',
      `Request ${request_id} was modified concurrently during offer selection. Retry the selection.`,
    );
  }

  // Update shift workflow status
  // TODO: workflow_status is not yet in the generated Supabase types (schema drift) — cast as any.
  await supabase
    .from('shifts')
    .update({ workflow_status: 'PENDING_APPROVAL' } as any)
    .eq('id', request.shift_id);

  return {
    request: updatedRequest as PlanningRequest,
    new_status: 'MANAGER_PENDING',
    compliance_status: finalStatus,
  };
}

/**
 * Cancel a planning request.
 *
 * Allowed from: OPEN or MANAGER_PENDING
 * Caller must be the request initiator.
 *
 * If cancelling from MANAGER_PENDING, the selected offer is marked WITHDRAWN
 * so the offerer's shift is freed from any implied reservation.
 */
async function cancelRequest(
  params: CancelRequestParams,
): Promise<{ cancelled_from: 'OPEN' | 'MANAGER_PENDING' }> {
  const { request_id, caller_id } = params;

  const { data: requestRow, error } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (error || !requestRow) {
    throw createError('REQUEST_NOT_FOUND', `Planning request ${request_id} not found.`);
  }

  const request = requestRow as PlanningRequest;

  if (request.initiated_by !== caller_id) {
    throw createError(
      'NOT_INITIATOR',
      'Only the request initiator can cancel a planning request.',
    );
  }

  const cancellableStatuses: PlanningRequestStatus[] = ['OPEN', 'MANAGER_PENDING'];
  if (!cancellableStatuses.includes(request.status)) {
    throw createError(
      'CANNOT_CANCEL',
      `Request ${request_id} cannot be cancelled from status '${request.status}'.`,
    );
  }

  const cancelledFrom = request.status as 'OPEN' | 'MANAGER_PENDING';
  const now = new Date().toISOString();

  // If cancelling from MANAGER_PENDING, withdraw the selected offer
  if (cancelledFrom === 'MANAGER_PENDING') {
    const { error: withdrawError } = await db
      .from('planning_offers')
      .update({ status: 'WITHDRAWN', updated_at: now })
      .eq('request_id', request_id)
      .eq('status', 'SELECTED');

    if (withdrawError) {
      throw createError(
        'OFFER_WITHDRAW_FAILED',
        `Failed to withdraw selected offer: ${withdrawError.message}`,
      );
    }
  }

  // Reset shift to IDLE
  // TODO: workflow_status is not yet in the generated Supabase types (schema drift) — cast as any.
  const { error: shiftError } = await supabase
    .from('shifts')
    .update({ workflow_status: 'IDLE' } as any)
    .eq('id', request.shift_id);

  if (shiftError) {
    throw createError(
      'SHIFT_STATUS_UPDATE_FAILED',
      `Failed to reset shift workflow status: ${shiftError.message}`,
    );
  }

  // Cancel the request
  const { error: cancelError } = await db
    .from('planning_requests')
    .update({ status: 'CANCELLED', updated_at: now })
    .eq('id', request_id);

  if (cancelError) {
    throw createError(
      'REQUEST_UPDATE_FAILED',
      `Failed to cancel request: ${cancelError.message}`,
    );
  }

  return { cancelled_from: cancelledFrom };
}

/**
 * Reopen a planning request after BLOCKED, REJECTED, or EXPIRED.
 *
 * Caller must be the request initiator.
 * Shift must still be more than 4 hours in the future.
 *
 * All previous offers are restored to SUBMITTED status so the initiator
 * can re-evaluate the pool (or wait for new offers).
 * Compliance snapshot is cleared — it will be re-computed on next selectOffer.
 */
async function reopenRequest(params: ReopenRequestParams): Promise<PlanningRequest> {
  const { request_id, caller_id } = params;

  const { data: requestRow, error } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (error || !requestRow) {
    throw createError('REQUEST_NOT_FOUND', `Planning request ${request_id} not found.`);
  }

  const request = requestRow as PlanningRequest;

  if (request.initiated_by !== caller_id) {
    throw createError(
      'NOT_INITIATOR',
      'Only the request initiator can reopen a planning request.',
    );
  }

  const reopenableStatuses: PlanningRequestStatus[] = ['BLOCKED', 'REJECTED', 'EXPIRED'];
  if (!reopenableStatuses.includes(request.status)) {
    throw createError(
      'CANNOT_REOPEN',
      `Request ${request_id} cannot be reopened from status '${request.status}'.`,
    );
  }

  // Fetch shift to check time-lock
  const { data: shift, error: shiftError } = await supabase
    .from('shifts')
    .select('shift_date, start_time')
    .eq('id', request.shift_id)
    .single();

  if (shiftError || !shift) {
    throw createError('SHIFT_NOT_FOUND', `Shift ${request.shift_id} not found.`);
  }

  assertNotTimeLocked((shift as any).shift_date, (shift as any).start_time);

  const now = new Date().toISOString();

  // Restore all offers for this request to SUBMITTED
  const { error: offersError } = await db
    .from('planning_offers')
    .update({ status: 'SUBMITTED', updated_at: now })
    .eq('request_id', request_id)
    .in('status', ['SELECTED', 'REJECTED']);
  // NOTE: WITHDRAWN offers are intentionally excluded — an offerer's explicit
  // opt-out must remain permanent even after the request is reopened.

  if (offersError) {
    throw createError(
      'OFFER_RESTORE_FAILED',
      `Failed to restore offers to SUBMITTED: ${offersError.message}`,
    );
  }

  // Clear compliance snapshot and reset request to OPEN
  const { data: updatedRequest, error: updateError } = await db
    .from('planning_requests')
    .update({
      status: 'OPEN',
      target_employee_id: null,
      compliance_snapshot: null,
      compliance_evaluated_at: null,
      updated_at: now,
    })
    .eq('id', request_id)
    .select()
    .single();

  if (updateError) {
    throw createError(
      'REQUEST_UPDATE_FAILED',
      `Failed to reopen request: ${updateError.message}`,
    );
  }

  // Restore shift to the appropriate open status
  // TODO: workflow_status is not yet in the generated Supabase types (schema drift) — cast as any.
  const newWorkflowStatus = request.type === 'BID' ? 'OPEN_FOR_BIDS' : 'OPEN_FOR_TRADE';
  await supabase
    .from('shifts')
    .update({ workflow_status: newWorkflowStatus } as any)
    .eq('id', request.shift_id);

  return updatedRequest as PlanningRequest;
}

/**
 * Manager approves a MANAGER_PENDING request.
 *
 * Stale check: if the compliance snapshot is older than 15 minutes,
 * re-run the compliance engine. If the re-run yields BLOCKING, the
 * request is updated to BLOCKED and an error with code 'COMPLIANCE_NOW_BLOCKING'
 * is thrown.
 *
 * On success, calls the sm_finalize_planning_request RPC which:
 *   - Performs optimistic lock check on both shift timestamps
 *   - Atomically transfers shift ownership (BID) or swaps ownership (SWAP)
 *   - Marks request as APPROVED
 */
async function approveRequest(params: ApproveRequestParams): Promise<PlanningRequest> {
  const { request_id, manager_id, manager_notes } = params;

  // ── Fetch and validate ──────────────────────────────────────────────────────
  const { data: requestRow, error: requestError } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (requestError || !requestRow) {
    throw createError('REQUEST_NOT_FOUND', `Planning request ${request_id} not found.`);
  }

  const request = requestRow as PlanningRequest;

  if (request.status !== 'MANAGER_PENDING') {
    throw createError(
      'WRONG_STATE',
      `Request ${request_id} has status '${request.status}'. Only MANAGER_PENDING requests can be approved.`,
    );
  }

  if (!request.compliance_snapshot || !request.compliance_evaluated_at) {
    throw createError(
      'NO_COMPLIANCE_SNAPSHOT',
      `Request ${request_id} has no compliance snapshot. Run selectOffer first.`,
    );
  }

  // ── Fetch selected offer ────────────────────────────────────────────────────
  const { data: offerRow, error: offerError } = await db
    .from('planning_offers')
    .select('*')
    .eq('request_id', request_id)
    .eq('status', 'SELECTED')
    .single();

  if (offerError || !offerRow) {
    throw createError(
      'NO_SELECTED_OFFER',
      `No SELECTED offer found for request ${request_id}.`,
    );
  }

  const offer = offerRow as PlanningOffer;
  const now = Date.now();
  const evaluatedAt = new Date(request.compliance_evaluated_at).getTime();
  const isStale = now - evaluatedAt > COMPLIANCE_STALE_MS;

  let currentSnapshot = request.compliance_snapshot as PlanningComplianceSnapshot;

  // ── Stale compliance re-check ───────────────────────────────────────────────
  if (isStale) {
    // Re-run the same compliance logic as selectOffer
    const { data: mainShiftRow, error: mainShiftError } = await supabase
      .from('shifts')
      .select('*')
      .eq('id', request.shift_id)
      .single();

    if (mainShiftError || !mainShiftRow) {
      throw createError('SHIFT_NOT_FOUND', `Request shift ${request.shift_id} not found.`);
    }

    const mainShift = mainShiftRow as Record<string, unknown>;
    const mainV8OrchestratorShift = mapShiftToV2(mainShift);
    const stage = deriveV8Stage({
      lifecycle_status: mainShift.lifecycle_status as string | null,
      is_published: mainShift.is_published as boolean | null,
    });

    let freshSnapshot: PlanningComplianceSnapshot;
    let freshStatus: ReturnType<typeof combinedStatus>;

    if (request.type === 'BID') {
      const bidderId = offer.offered_by;

      const [bidderContext, bidderShifts] = await Promise.all([
        fetchV8EmployeeContext(bidderId),
        fetchEmployeeShiftsV2(
          bidderId,
          mainShift.shift_date as string,
          SHIFT_WINDOW_DAYS,
          null,
        ),
      ]);

      const bidInput = buildBidInput({
        employeeId: bidderId,
        employeeContext: bidderContext,
        existingShifts: bidderShifts,
        candidateShift: mainV8OrchestratorShift,
        stage,
      });

      const bidResult = runV8Orchestrator(bidInput) as V8OrchestratorResult;

      freshSnapshot = buildBidSnapshot({
        result: bidResult,
        shiftUpdatedAt: mainShift.updated_at as string,
      });
      freshStatus = bidResult.overall_status;

    } else {
      if (!offer.offered_shift_id) {
        throw createError('SWAP_OFFER_NO_SHIFT', `SWAP offer ${offer.id} is missing offered_shift_id.`);
      }

      const { data: offeredShiftRow, error: offeredShiftError } = await supabase
        .from('shifts')
        .select('*')
        .eq('id', offer.offered_shift_id)
        .single();

      if (offeredShiftError || !offeredShiftRow) {
        throw createError('OFFERED_SHIFT_NOT_FOUND', `Offered shift ${offer.offered_shift_id} not found.`);
      }

      const offeredShift = offeredShiftRow as Record<string, unknown>;
      const offeredV8OrchestratorShift = mapShiftToV2(offeredShift);

      const partyAId = request.initiated_by;
      const partyBId = offer.offered_by;

      const [partyAContext, partyBContext, partyAShifts, partyBShifts] = await Promise.all([
        fetchV8EmployeeContext(partyAId),
        fetchV8EmployeeContext(partyBId),
        fetchEmployeeShiftsV2(partyAId, mainShift.shift_date as string, SHIFT_WINDOW_DAYS, request.shift_id),
        fetchEmployeeShiftsV2(partyBId, offeredShift.shift_date as string, SHIFT_WINDOW_DAYS, offer.offered_shift_id),
      ]);

      const { inputA, inputB } = buildSwapInputs({
        partyAEmployeeId: partyAId,
        partyAContext,
        partyAExistingShifts: partyAShifts,
        partyAShift: mainV8OrchestratorShift,
        partyBEmployeeId: partyBId,
        partyBContext,
        partyBExistingShifts: partyBShifts,
        partyBShift: offeredV8OrchestratorShift,
        stage,
      });

      const [resultA, resultB] = [
        runV8Orchestrator(inputA) as V8OrchestratorResult,
        runV8Orchestrator(inputB) as V8OrchestratorResult,
      ];

      freshSnapshot = buildSwapSnapshot({
        resultA,
        resultB,
        shiftUpdatedAt: mainShift.updated_at as string,
        targetShiftUpdatedAt: offeredShift.updated_at as string,
      });
      freshStatus = combinedStatus(resultA.overall_status, resultB.overall_status);
    }

    // If freshly evaluated compliance is BLOCKING, block the request
    if (freshStatus === 'BLOCKING') {
      const { error: blockUpdateError } = await db
        .from('planning_requests')
        .update({
          status: 'BLOCKED',
          compliance_snapshot: freshSnapshot,
          compliance_evaluated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request_id);

      if (blockUpdateError) {
        throw createError(
          'SNAPSHOT_UPDATE_FAILED',
          `Failed to persist BLOCKING snapshot after re-evaluation: ${blockUpdateError.message}`,
        );
      }

      throw createError(
        'COMPLIANCE_NOW_BLOCKING',
        'Compliance re-evaluation found blocking violations. Request moved to BLOCKED.',
      );
    }

    // Update snapshot to the fresh result
    currentSnapshot = freshSnapshot;
    const { error: snapshotUpdateError } = await db
      .from('planning_requests')
      .update({
        compliance_snapshot: freshSnapshot,
        compliance_evaluated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', request_id);

    if (snapshotUpdateError) {
      throw createError(
        'SNAPSHOT_UPDATE_FAILED',
        `Failed to persist refreshed compliance snapshot: ${snapshotUpdateError.message}`,
      );
    }
  }

  // ── Extract timestamps for RPC ──────────────────────────────────────────────
  const shiftUpdatedAt = currentSnapshot.shift_updated_at;
  let targetShiftUpdatedAt: string | null = null;

  if ('target_shift_updated_at' in currentSnapshot) {
    targetShiftUpdatedAt = (currentSnapshot as SwapComplianceSnapshot).target_shift_updated_at;
  }

  // ── Call the atomic RPC ────────────────────────────────────────────────────
  const { error: rpcError } = await db.rpc('sm_finalize_planning_request', {
    p_request_id:              request_id,
    p_offer_id:                offer.id,
    p_manager_id:              manager_id,
    p_manager_notes:           manager_notes ?? null,
    p_shift_updated_at:        shiftUpdatedAt,
    p_target_shift_updated_at: targetShiftUpdatedAt,
  });

  if (rpcError) {
    const msg: string = rpcError.message ?? '';

    if (msg.includes('SHIFT_MUTATED')) {
      throw createError(
        'SHIFT_MUTATED',
        `Shift was modified since compliance was evaluated. ${msg}`,
      );
    }

    if (msg.includes('WRONG_STATE')) {
      throw createError('WRONG_STATE', `Request is not in MANAGER_PENDING state. ${msg}`);
    }

    if (msg.includes('NO_SELECTED_OFFER')) {
      throw createError('NO_SELECTED_OFFER', `No selected offer found. ${msg}`);
    }

    throw createError('RPC_FAILED', `sm_finalize_planning_request failed: ${msg}`);
  }

  // ── Fetch and return the updated request ────────────────────────────────────
  const { data: finalRequest, error: finalFetchError } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (finalFetchError || !finalRequest) {
    throw createError(
      'REQUEST_FETCH_FAILED',
      `Failed to fetch updated request after approval: ${finalFetchError?.message}`,
    );
  }

  return finalRequest as PlanningRequest;
}

/**
 * Manager rejects a MANAGER_PENDING request.
 *
 * Marks the selected offer as REJECTED, resets the shift to IDLE,
 * and records the manager's decision on the request row.
 */
async function rejectRequest(params: RejectRequestParams): Promise<PlanningRequest> {
  const { request_id, manager_id, manager_notes } = params;

  const { data: requestRow, error: requestError } = await db
    .from('planning_requests')
    .select('*')
    .eq('id', request_id)
    .single();

  if (requestError || !requestRow) {
    throw createError('REQUEST_NOT_FOUND', `Planning request ${request_id} not found.`);
  }

  const request = requestRow as PlanningRequest;

  if (request.status !== 'MANAGER_PENDING') {
    throw createError(
      'WRONG_STATE',
      `Request ${request_id} has status '${request.status}'. Only MANAGER_PENDING requests can be rejected.`,
    );
  }

  const now = new Date().toISOString();

  // Mark the selected offer as REJECTED
  const { error: offerError } = await db
    .from('planning_offers')
    .update({ status: 'REJECTED', updated_at: now })
    .eq('request_id', request_id)
    .eq('status', 'SELECTED');

  if (offerError) {
    throw createError(
      'OFFER_REJECT_FAILED',
      `Failed to reject selected offer: ${offerError.message}`,
    );
  }

  // Reset shift to IDLE
  // TODO: workflow_status is not yet in the generated Supabase types (schema drift) — cast as any.
  const { error: shiftError } = await supabase
    .from('shifts')
    .update({ workflow_status: 'IDLE' } as any)
    .eq('id', request.shift_id);

  if (shiftError) {
    throw createError(
      'SHIFT_STATUS_UPDATE_FAILED',
      `Failed to reset shift workflow status: ${shiftError.message}`,
    );
  }

  // Mark request as REJECTED with manager details
  const { data: updatedRequest, error: updateError } = await db
    .from('planning_requests')
    .update({
      status: 'REJECTED',
      manager_id,
      manager_notes: manager_notes ?? null,
      decided_at: now,
      updated_at: now,
    })
    .eq('id', request_id)
    .select()
    .single();

  if (updateError) {
    throw createError(
      'REQUEST_UPDATE_FAILED',
      `Failed to reject request: ${updateError.message}`,
    );
  }

  return updatedRequest as PlanningRequest;
}

// =============================================================================
// SERVICE OBJECT EXPORT
// =============================================================================

export const planningRequestService = {
  createPlanningRequest,
  submitOffer,
  withdrawOffer,
  selectOffer,
  cancelRequest,
  reopenRequest,
  approveRequest,
  rejectRequest,
};
