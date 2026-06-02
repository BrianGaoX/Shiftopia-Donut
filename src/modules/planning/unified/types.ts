/**
 * Unified Planning Request System — Core Types
 *
 * Single source of truth for all types used across the unified planning
 * request system. Covers bids, swaps, compliance snapshots, and every
 * service function's parameter and return shapes.
 */

import type { V8Status } from '@/modules/compliance/v8/types';
import type { V8OrchestratorResult, V8OrchestratorShift } from '@/modules/compliance/v8/orchestrator/types';

// Re-export for consumers who import from this module
export type { V8OrchestratorResult, V8Status, V8OrchestratorShift };

// =============================================================================
// ENUMERATIONS
// =============================================================================

/**
 * Lifecycle states for a PlanningRequest.
 * There is no EVALUATING state — compliance is always run synchronously
 * within selectOffer() and the result stored atomically.
 */
export type PlanningRequestStatus =
  | 'OPEN'            // Accepting offers
  | 'MANAGER_PENDING' // Offer selected, awaiting manager decision
  | 'APPROVED'        // Manager approved; shift ownership transferred
  | 'REJECTED'        // Manager rejected
  | 'BLOCKED'         // Compliance blocked; no viable offer
  | 'CANCELLED'       // Initiator cancelled before decision
  | 'EXPIRED';        // System-expired after shift start time passed

export type PlanningRequestType = 'BID' | 'SWAP';

export type OfferStatus =
  | 'SUBMITTED'  // Waiting for selection
  | 'SELECTED'   // Chosen by initiator; awaiting manager
  | 'REJECTED'   // Either compliance-blocked or manager-rejected
  | 'WITHDRAWN'; // Withdrawn by the offerer

/**
 * Workflow states on the shifts table.
 * IDLE is the normal/default state.
 */
export type ShiftWorkflowStatus =
  | 'IDLE'
  | 'OPEN_FOR_BIDS'
  | 'OPEN_FOR_TRADE'
  | 'PENDING_APPROVAL'
  | 'LOCKED';

// =============================================================================
// DATABASE ROW TYPES  (snake_case, mirrors table columns exactly)
// =============================================================================

export interface PlanningRequest {
  id: string;
  type: PlanningRequestType;
  status: PlanningRequestStatus;
  shift_id: string;
  initiated_by: string;
  target_employee_id: string | null;
  reason: string | null;
  compliance_snapshot: PlanningComplianceSnapshot | null;
  compliance_evaluated_at: string | null;
  manager_id: string | null;
  manager_notes: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningOffer {
  id: string;
  request_id: string;
  offered_by: string;
  offered_shift_id: string | null;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// COMPLIANCE SNAPSHOTS
// =============================================================================

/**
 * Compliance snapshot stored when a BID offer is selected.
 * Extends V8OrchestratorResult with two timestamp fields used for
 * optimistic locking during approval.
 */
export interface BidComplianceSnapshot extends V8OrchestratorResult {
  /** ISO timestamp of shifts.updated_at captured just before compliance run */
  shift_updated_at: string;
  /** ISO timestamp of when runV8Orchestrator() was called */
  evaluated_at: string;
}

/**
 * Compliance snapshot stored when a SWAP offer is selected.
 * Holds per-party results and both shift timestamps for optimistic
 * locking during manager approval.
 */
export interface SwapComplianceSnapshot {
  combined_status: V8Status;
  party_a: V8OrchestratorResult;
  party_b: V8OrchestratorResult;
  /** shifts.updated_at for the requester's shift (shift_id on the request) */
  shift_updated_at: string;
  /** shifts.updated_at for the offerer's shift (offered_shift_id on the offer) */
  target_shift_updated_at: string;
  /** ISO timestamp of when runV8Orchestrator() was called for both parties */
  evaluated_at: string;
}

export type PlanningComplianceSnapshot = BidComplianceSnapshot | SwapComplianceSnapshot;

// =============================================================================
// RESPONSE SHAPES
// =============================================================================

export interface BlockingHit {
  rule_id: string;
  summary: string;
  party: 'A' | 'B' | 'BOTH';
  severity: 'BLOCKING';
}

export interface SelectOfferResult {
  request: PlanningRequest;
  new_status: 'MANAGER_PENDING' | 'BLOCKED';
  compliance_status: V8Status;
  blocking_hits?: BlockingHit[];
}

// =============================================================================
// SERVICE FUNCTION PARAMETER SHAPES
// =============================================================================

export interface CreateRequestParams {
  type: PlanningRequestType;
  shift_id: string;
  initiated_by: string;
  reason?: string | null;
  /** For a targeted SWAP (specific employee); null for open marketplace */
  target_employee_id?: string | null;
}

export interface SubmitOfferParams {
  request_id: string;
  offered_by: string;
  /** Required for SWAP; must be a shift owned by offered_by */
  offered_shift_id?: string | null;
}

export interface SelectOfferParams {
  request_id: string;
  offer_id: string;
  /** The employee performing selection (must be the initiator) */
  selected_by: string;
}

export interface CancelRequestParams {
  request_id: string;
  /** Must match initiated_by on the request */
  caller_id: string;
}

export interface ReopenRequestParams {
  request_id: string;
  /** Must match initiated_by on the request */
  caller_id: string;
}

export interface ApproveRequestParams {
  request_id: string;
  manager_id: string;
  manager_notes?: string | null;
}

export interface RejectRequestParams {
  request_id: string;
  manager_id: string;
  manager_notes?: string | null;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isSwapSnapshot(s: PlanningComplianceSnapshot): s is SwapComplianceSnapshot {
  return 'combined_status' in s && 'party_a' in s && 'party_b' in s;
}

export function isBidSnapshot(s: PlanningComplianceSnapshot): s is BidComplianceSnapshot {
  return !isSwapSnapshot(s) && 'status' in s && 'rule_hits' in s;
}

/**
 * Returns true when student visa enforcement is active for either swap party.
 * Reads from calc.enforcement_enabled if present in the consolidated groups;
 * falls back to checking whether R05_student_visa produced any hits.
 */
export function isStudentVisaEnforced(
  partyA?: V8OrchestratorResult,
  partyB?: V8OrchestratorResult,
): boolean {
  const hasVisaHit = (result?: V8OrchestratorResult): boolean => {
    if (!result) return false;
    return result.hits.some(h => h.rule_id === 'R05');
  };
  return hasVisaHit(partyA) || hasVisaHit(partyB);
}
