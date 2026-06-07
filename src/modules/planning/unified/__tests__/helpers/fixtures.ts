/**
 * Deterministic test fixtures for the Unified Planning Request system.
 *
 * All IDs are valid UUIDs so Supabase / Postgres FK checks pass in real
 * integration runs. Dates are set far in the future so time-lock guards
 * (shift must be > 4 hours away) never fire in happy-path tests.
 */

import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';
import type { V8Hit, V8Status } from '@/modules/compliance/v8/types';

// =============================================================================
// ACTOR IDs
// =============================================================================

export const MGR_ID    = 'aaaaaaaa-0000-0000-0000-000000000001';
export const EMP_A_ID  = 'aaaaaaaa-0000-0000-0000-000000000002';
export const EMP_B_ID  = 'aaaaaaaa-0000-0000-0000-000000000003';
export const EMP_C_ID  = 'aaaaaaaa-0000-0000-0000-000000000004';

// =============================================================================
// SHIFT IDs
// =============================================================================

/** Open shift — no assigned_employee_id, workflow_status = IDLE */
export const SHIFT_OPEN_ID   = 'bbbbbbbb-0000-0000-0000-000000000001';
/** EMP_B's shift — assigned to EMP_B, workflow_status = IDLE */
export const SHIFT_EMP_B_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
/** EMP_A's shift — assigned to EMP_A, workflow_status = IDLE */
export const SHIFT_EMP_A_ID  = 'bbbbbbbb-0000-0000-0000-000000000003';

// =============================================================================
// REQUEST / OFFER IDs (deterministic for snapshot-style assertions)
// =============================================================================

export const REQUEST_ID  = 'cccccccc-0000-0000-0000-000000000001';
export const OFFER_ID    = 'cccccccc-0000-0000-0000-000000000002';
export const OFFER_ID_2  = 'cccccccc-0000-0000-0000-000000000003';

// =============================================================================
// SHIFT ROW FIXTURES
// =============================================================================

/** Future date — avoids the 4h time-lock guard in all happy-path tests */
const FUTURE_DATE  = '2099-12-31';
const FUTURE_START = '09:00:00';

/** Shared updated_at timestamp used in snapshot assertions */
export const SHIFT_UPDATED_AT = '2099-01-01T00:00:00.000Z';

export const openShiftRow = {
  id:                   SHIFT_OPEN_ID,
  assigned_employee_id: null,
  workflow_status:      'IDLE',
  shift_date:           FUTURE_DATE,
  start_time:           FUTURE_START,
  end_time:             '17:00:00',
  lifecycle_status:     'scheduled',
  is_published:         true,
  updated_at:           SHIFT_UPDATED_AT,
  organization_id:      'org-0001',
  department_id:        'dept-0001',
  role_id:              'role-0001',
  length:               8,
  net_length:           7.5,
};

export const empBShiftRow = {
  ...openShiftRow,
  id:                   SHIFT_EMP_B_ID,
  assigned_employee_id: EMP_B_ID,
};

export const empAShiftRow = {
  ...openShiftRow,
  id:                   SHIFT_EMP_A_ID,
  assigned_employee_id: EMP_A_ID,
};

// =============================================================================
// REQUEST ROW FIXTURES
// =============================================================================

export const openBidRequestRow = {
  id:                    REQUEST_ID,
  type:                  'BID',
  status:                'OPEN',
  shift_id:              SHIFT_OPEN_ID,
  initiated_by:          MGR_ID,
  target_employee_id:    null,
  reason:                null,
  compliance_snapshot:   null,
  compliance_evaluated_at: null,
  manager_id:            null,
  manager_notes:         null,
  decided_at:            null,
  created_at:            '2099-01-01T00:00:00.000Z',
  updated_at:            '2099-01-01T00:00:00.000Z',
};

export const openSwapRequestRow = {
  ...openBidRequestRow,
  type:        'SWAP',
  shift_id:    SHIFT_EMP_A_ID,
  initiated_by: EMP_A_ID,
};

export const managerPendingBidRequestRow = {
  ...openBidRequestRow,
  status:              'MANAGER_PENDING',
  target_employee_id:  EMP_A_ID,
  compliance_snapshot: {
    status:           'PASS',
    rule_hits:        [],
    shift_updated_at: SHIFT_UPDATED_AT,
    evaluated_at:     new Date().toISOString(),
  },
  compliance_evaluated_at: new Date().toISOString(),
};

export const managerPendingSwapRequestRow = {
  ...openSwapRequestRow,
  status:              'MANAGER_PENDING',
  target_employee_id:  EMP_B_ID,
  compliance_snapshot: {
    combined_status: 'PASS',
    party_a: { status: 'PASS', rule_hits: [] },
    party_b: { status: 'PASS', rule_hits: [] },
    shift_updated_at:        SHIFT_UPDATED_AT,
    target_shift_updated_at: SHIFT_UPDATED_AT,
    evaluated_at:            new Date().toISOString(),
  },
  compliance_evaluated_at: new Date().toISOString(),
};

// =============================================================================
// OFFER ROW FIXTURES
// =============================================================================

export const submittedBidOfferRow = {
  id:               OFFER_ID,
  request_id:       REQUEST_ID,
  offered_by:       EMP_A_ID,
  offered_shift_id: null,
  status:           'SUBMITTED',
  created_at:       '2099-01-01T00:00:00.000Z',
  updated_at:       '2099-01-01T00:00:00.000Z',
};

export const selectedBidOfferRow = {
  ...submittedBidOfferRow,
  status: 'SELECTED',
};

export const submittedSwapOfferRow = {
  ...submittedBidOfferRow,
  id:               OFFER_ID,
  offered_by:       EMP_B_ID,
  offered_shift_id: SHIFT_EMP_B_ID,
};

export const selectedSwapOfferRow = {
  ...submittedSwapOfferRow,
  status: 'SELECTED',
};

// =============================================================================
// COMPLIANCE RESULTS
// =============================================================================

/**
 * Build a V8Hit. Only the fields the planning snapshot/extraction logic reads
 * (rule_id, status, summary) need to vary per test; the rest get sane defaults.
 */
export function makeV8Hit(
  rule_id: string,
  status: V8Status,
  summary: string,
): V8Hit {
  return {
    rule_id,
    rule_name:       rule_id,
    status,
    summary,
    details:         summary,
    affected_shifts: [],
    blocking:        status === 'BLOCKING',
  };
}

/** Build a V8OrchestratorResult with the given overall status and hits. */
export function makeV8Result(
  overall_status: V8Status,
  hits: V8Hit[] = [],
): V8OrchestratorResult {
  return {
    passed:                overall_status !== 'BLOCKING',
    overall_status,
    hits,
    consolidated_groups:   [],
    conflict_pairs:        [],
    delta_explanation:     null,
    evaluated_shift_count: 1,
    evaluation_time_ms:    0,
  };
}

export const passComplianceResult: V8OrchestratorResult = makeV8Result('PASS');

export const blockingComplianceResult: V8OrchestratorResult = makeV8Result('BLOCKING', [
  makeV8Hit('R01_no_overlap', 'BLOCKING', 'Shift overlaps with existing assignment'),
]);

export const warningComplianceResult: V8OrchestratorResult = makeV8Result('WARNING', [
  makeV8Hit('R03_avg_four_week', 'WARNING', 'Average weekly hours approaching limit'),
]);

// =============================================================================
// EMPLOYEE CONTEXT (minimal, passes all field checks)
// =============================================================================

export const empContextA = {
  employee_id:             EMP_A_ID,
  employment_type:         'full_time',
  weekly_hour_limit:       40,
  student_visa_active:     false,
  qualifications:          [],
  role_id:                 'role-0001',
};

export const empContextB = {
  ...empContextA,
  employee_id: EMP_B_ID,
};
