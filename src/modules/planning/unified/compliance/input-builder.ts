/**
 * Unified Planning — Compliance Input Builder
 *
 * Constructs V8OrchestratorInput objects for the compliance engine.
 * This module contains ONLY input construction — no rule evaluation,
 * no DB calls, no side effects. It is a pure data-transformation layer.
 *
 * Architecture:
 *   buildBidInput()   — builds input for a single employee bidding on a shift
 *   buildSwapInputs() — builds inputs for BOTH swap parties simultaneously
 *   deriveV8Stage()     — maps shift lifecycle state to the engine's V8Stage type
 *   resolveCandidateV8ShiftId() — extracts the correct shift ID per request type
 */

import type {
  V8OrchestratorInput,
  V8OrchestratorShift,
  V8OperationType,
  V8Stage,
  V8EmployeeContext,
  V8AvailabilityData,
} from '@/modules/compliance/v8/orchestrator/types';

import type { PlanningRequest, PlanningOffer } from '../types';

// =============================================================================
// STAGE DERIVATION
// =============================================================================

/**
 * Maps a shift's lifecycle/published state to the compliance engine's V8Stage type.
 *
 * V8Stage semantics:
 *   DRAFT   — shift is unpublished; softer severity thresholds apply
 *   LIVE    — shift is assigned and published; strictest enforcement
 *   PUBLISH — shift is published but not yet assigned (intermediate state)
 *
 * This controls the severity normalization matrix inside the engine.
 */
export function deriveV8Stage(shift: {
  lifecycle_status?: string | null;
  is_published?: boolean | null;
}): V8Stage {
  const lifecycle = shift.lifecycle_status?.toLowerCase() ?? '';

  // Explicitly unpublished drafts get DRAFT stage
  if (lifecycle === 'draft' || lifecycle === 'unpublished' || shift.is_published === false) {
    return 'DRAFT';
  }

  // Assigned and published shifts are LIVE — highest enforcement
  if (lifecycle === 'assigned' || lifecycle === 'live' || lifecycle === 'confirmed') {
    return 'LIVE';
  }

  // Published but not yet assigned (open shifts for bidding)
  return 'PUBLISH';
}

// =============================================================================
// BID INPUT BUILDER
// =============================================================================

/**
 * Build the V8OrchestratorInput for a single employee bidding on an open shift.
 *
 * The candidate shift is the open shift being bid on (request.shift_id).
 * The bidder's existing shifts are passed as-is — no shifts are removed
 * for BID operations (the employee is gaining a shift, not swapping one).
 *
 * operation_type: 'BID'
 * mode:           'SIMULATED' (we test the hypothetical post-bid schedule)
 */
export function buildBidInput(params: {
  employeeId: string;
  employeeContext: V8EmployeeContext;
  existingShifts: V8OrchestratorShift[];
  candidateShift: V8OrchestratorShift;
  stage: V8Stage;
}): V8OrchestratorInput {
  const { employeeId, employeeContext, existingShifts, candidateShift, stage } = params;

  return {
    employee_id: employeeId,
    employee_context: employeeContext,
    existing_shifts: existingShifts,
    candidate_changes: {
      add_shifts: [candidateShift],
      remove_shifts: [],
    },
    mode: 'SIMULATED',
    operation_type: 'BID',
    stage,
    evaluation_reference_date: candidateShift.date,
  };
}

// =============================================================================
// SWAP INPUT BUILDER
// =============================================================================

/**
 * Build V8OrchestratorInput objects for BOTH parties in a swap.
 *
 * Party A (initiator / requester):
 *   - Gains partyBShift (the shift being offered by the other party)
 *   - Loses partyAShift (their own shift that goes to party B)
 *
 * Party B (the offerer / respondent):
 *   - Gains partyAShift (what party A is trading away)
 *   - Loses partyBShift (their own shift that goes to party A)
 *
 * Both inputs are evaluated independently in the engine. The results are
 * then combined with combineSwapResults() to derive the joint status.
 *
 * operation_type: 'SWAP' for both parties
 * mode:           'SIMULATED'
 */
export function buildSwapInputs(params: {
  partyAEmployeeId: string;
  partyAContext: V8EmployeeContext;
  partyAExistingShifts: V8OrchestratorShift[];
  partyAShift: V8OrchestratorShift;       // The shift party A is giving up
  partyBEmployeeId: string;
  partyBContext: V8EmployeeContext;
  partyBExistingShifts: V8OrchestratorShift[];
  partyBShift: V8OrchestratorShift;       // The shift party B is giving up
  stage: V8Stage;
}): { inputA: V8OrchestratorInput; inputB: V8OrchestratorInput } {
  const {
    partyAEmployeeId, partyAContext, partyAExistingShifts, partyAShift,
    partyBEmployeeId, partyBContext, partyBExistingShifts, partyBShift,
    stage,
  } = params;

  // Party A: removes their own shift, gains party B's shift
  const inputA: V8OrchestratorInput = {
    employee_id: partyAEmployeeId,
    employee_context: partyAContext,
    existing_shifts: partyAExistingShifts,
    candidate_changes: {
      add_shifts: [partyBShift],
      remove_shifts: [partyAShift.id],
    },
    mode: 'SIMULATED',
    operation_type: 'SWAP',
    stage,
    evaluation_reference_date: partyBShift.date,
  };

  // Party B: removes their own shift, gains party A's shift
  const inputB: V8OrchestratorInput = {
    employee_id: partyBEmployeeId,
    employee_context: partyBContext,
    existing_shifts: partyBExistingShifts,
    candidate_changes: {
      add_shifts: [partyAShift],
      remove_shifts: [partyBShift.id],
    },
    mode: 'SIMULATED',
    operation_type: 'SWAP',
    stage,
    evaluation_reference_date: partyAShift.date,
  };

  return { inputA, inputB };
}

// =============================================================================
// CANDIDATE SHIFT ID RESOLUTION
// =============================================================================

/**
 * Determine which shift ID is the "candidate" (the shift being added to
 * the evaluating employee's schedule) based on request type.
 *
 * BID:  candidateV8ShiftId = request.shift_id
 *       (the open shift the bidder wants to acquire)
 *
 * SWAP: candidateV8ShiftId = offer.offered_shift_id
 *       (the shift the offerer is proposing to trade away — which the
 *        initiator will gain — or the initiator's shift for party B's check)
 *
 * The service layer calls this to decide which shift to fetch and pass
 * to the input builders.
 */
export function resolveCandidateV8ShiftId(
  request: PlanningRequest,
  offer: PlanningOffer,
): string {
  if (request.type === 'BID') {
    return request.shift_id;
  }

  // SWAP: the candidate for the initiator is what the offerer proposes
  if (!offer.offered_shift_id) {
    throw new Error(
      `SWAP offer ${offer.id} is missing offered_shift_id. ` +
      'All SWAP offers must reference a shift to trade.',
    );
  }

  return offer.offered_shift_id;
}

// =============================================================================
// ASSIGN / DRAFT / SKELETON INPUT BUILDERS
// =============================================================================

/**
 * Build the V8OrchestratorInput for direct shift assignment.
 *
 * Used by the assignShift command, the drag-and-drop assign modal, and the
 * EnhancedAddShiftModal when an employee is being assigned at publish time.
 *
 * operation_type:    callers pass 'ASSIGN' for manual, 'BID' for bid acceptance,
 *                    or 'SWAP' for trade acceptance — preserve their context.
 * mode:              'SIMULATED'
 */
export function buildAssignInput(params: {
  employeeId: string;
  employeeContext: V8EmployeeContext;
  existingShifts: V8OrchestratorShift[];
  candidateShift: V8OrchestratorShift;
  stage: V8Stage;
  operationType?: V8OperationType;
  availabilityData?: V8AvailabilityData;
  /** IDs to remove from existingShifts in the simulated state.
   *  Used by edit-mode forms when the candidate shift replaces an existing one. */
  removeShiftIds?: string[];
}): V8OrchestratorInput {
  const {
    employeeId, employeeContext, existingShifts, candidateShift, stage,
    operationType = 'ASSIGN', availabilityData, removeShiftIds = [],
  } = params;

  const input: V8OrchestratorInput = {
    employee_id: employeeId,
    employee_context: employeeContext,
    existing_shifts: existingShifts,
    candidate_changes: {
      add_shifts: [candidateShift],
      remove_shifts: removeShiftIds,
    },
    mode: 'SIMULATED',
    operation_type: operationType,
    stage,
    evaluation_reference_date: candidateShift.date,
  };

  if (availabilityData) input.availability_data = availabilityData;
  return input;
}

/**
 * Build the V8OrchestratorInput for the DRAFT-stage form preview in the
 * EnhancedAddShiftModal (no commit yet, softer severity thresholds).
 *
 * operation_type: 'ASSIGN'
 * mode:           'SIMULATED'
 * stage:          'DRAFT' (always)
 */
export function buildDraftInput(params: {
  employeeId: string;
  employeeContext: V8EmployeeContext;
  existingShifts: V8OrchestratorShift[];
  candidateShift: V8OrchestratorShift;
  availabilityData?: V8AvailabilityData;
}): V8OrchestratorInput {
  return buildAssignInput({ ...params, stage: 'DRAFT' });
}

/**
 * Build a structural-only V8OrchestratorInput for an unassigned shift
 * (employee_id 'skeleton'). Used by the shift synthesiser to validate
 * shape (overlap / duration / meal break) without a real employee.
 *
 * The employee_context fields are minimum-valid placeholders — only
 * shift-level rules will produce hits.
 */
export function buildSkeletonInput(params: {
  candidateShift: V8OrchestratorShift;
  stage?: V8Stage;
}): V8OrchestratorInput {
  const { candidateShift, stage = 'DRAFT' } = params;
  return {
    employee_id: 'skeleton',
    employee_context: {
      employee_id: 'skeleton',
      contract_type: 'CASUAL',
      contracted_weekly_hours: 0,
      assigned_role_ids: [],
      contracts: [],
      qualifications: [],
    },
    existing_shifts: [],
    candidate_changes: {
      add_shifts: [candidateShift],
      remove_shifts: [],
    },
    mode: 'SIMULATED',
    operation_type: 'ASSIGN',
    stage,
    evaluation_reference_date: candidateShift.date,
  };
}
