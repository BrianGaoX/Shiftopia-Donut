/**
 * useBulkPlanningCompliance
 *
 * Advisory compliance hook for the planning request UI. Runs the V2 compliance
 * engine in SIMULATED mode and returns a summarised advisory result without
 * performing any state mutation.
 *
 * BID scenario:
 *   Evaluates whether `requesterId` can safely take on `candidateV8ShiftId`.
 *   Only partyA result is populated; partyB is null.
 *
 * SWAP scenario:
 *   Evaluates both swap parties simultaneously:
 *     - partyA = requester: gives up `myV8ShiftId`, gains `targetV8ShiftId`
 *     - partyB = target:    gives up `targetV8ShiftId`, gains `myV8ShiftId`
 *   Both partyA and partyB results are populated.
 *
 * Debounce:
 *   The compliance run is debounced by 300 ms to prevent thrashing when params
 *   arrive in rapid succession (e.g. as modal form state settles).
 *
 * Caching:
 *   The compliance engine maintains an internal LRU cache keyed on the full
 *   V8OrchestratorInput payload. Identical inputs return cached results with
 *   near-zero overhead.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/platform/realtime/client';
import { runV8Orchestrator } from '@/modules/compliance/v8';
import {
  fetchV8EmployeeContext,
  fetchEmployeeShiftsV2,
} from '@/modules/compliance/employee-context';
import { buildBidInput, buildSwapInputs, deriveV8Stage } from '../compliance/input-builder';
import { combinedStatus } from '../compliance/snapshot-builder';
import type { V8Status } from '@/modules/compliance/v8/types';
import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';

// =============================================================================
// TYPES
// =============================================================================

export interface PlanningComplianceAdvisory {
  /** The worst of both parties' statuses (or partyA-only for BID) */
  combinedStatus: 'PASS' | 'WARNING' | 'BLOCKING' | null;
  /** Compliance result for the requester / party A */
  partyA: V8OrchestratorResult | null;
  /** Compliance result for the swap target / party B — null for BID */
  partyB: V8OrchestratorResult | null;
  /** True when the student visa 48-hour rule (R05) produced any hit */
  isStudentVisaHit: boolean;
}

export interface UseBulkPlanningComplianceParams {
  requestType: 'BID' | 'SWAP';
  /** The employee requesting the compliance advisory */
  requesterId: string;
  /** The shift being added to the requester's schedule */
  candidateV8ShiftId: string;
  /** SWAP only: the shift the requester is giving up */
  myV8ShiftId?: string;
  /** SWAP only: the other party */
  targetEmployeeId?: string;
  /** SWAP only: the shift the target is giving up */
  targetV8ShiftId?: string;
  /** Set to false to suspend evaluation without resetting results */
  enabled?: boolean;
}

export interface UseBulkPlanningComplianceResult {
  advisory: PlanningComplianceAdvisory | null;
  isLoading: boolean;
  error: Error | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEBOUNCE_MS = 300;
const SHIFT_WINDOW_DAYS = 35;

// =============================================================================
// HELPERS
// =============================================================================

/** Map a raw Supabase shift row to V8OrchestratorShift — mirrors the service's mapShiftToV2 */
function mapShiftRowToV2(row: Record<string, unknown>) {
  return {
    id:                      row.id as string,
    date:                    row.shift_date as string,
    start_time:              row.start_time as string,
    end_time:                row.end_time as string,
    role_id:                 (row.role_id as string | null) ?? '',
    required_qualifications: (row.required_qualifications as string[] | null) ?? [],
    is_ordinary_hours:       (row.is_ordinary_hours as boolean | null) ?? true,
    break_minutes:           (row.break_minutes as number | null) ?? 0,
    unpaid_break_minutes:    (row.unpaid_break_minutes as number | null) ?? 0,
  };
}

function hasVisaHit(result: V8OrchestratorResult | null): boolean {
  if (!result) return false;
  return result.hits.some(h => h.rule_id === 'R05');
}

// =============================================================================
// CORE EVALUATION LOGIC  (async — called inside a debounced useEffect)
// =============================================================================

async function runEvaluation(
  params: UseBulkPlanningComplianceParams,
): Promise<PlanningComplianceAdvisory> {
  const {
    requestType,
    requesterId,
    candidateV8ShiftId,
    myV8ShiftId,
    targetEmployeeId,
    targetV8ShiftId,
  } = params;

  const db = supabase as any;

  // Fetch the candidate shift first — needed by both BID and SWAP paths
  const { data: candidateRow, error: candidateErr } = await db
    .from('shifts')
    .select('*')
    .eq('id', candidateV8ShiftId)
    .single();

  if (candidateErr || !candidateRow) {
    throw new Error(`Candidate shift ${candidateV8ShiftId} not found`);
  }

  const candidateV8OrchestratorShift = mapShiftRowToV2(candidateRow as Record<string, unknown>);
  const stage = deriveV8Stage({
    lifecycle_status: (candidateRow as any).lifecycle_status as string | null,
    is_published:     (candidateRow as any).is_published     as boolean | null,
  });

  // ── BID ─────────────────────────────────────────────────────────────────────
  if (requestType === 'BID') {
    const [requesterContext, requesterShifts] = await Promise.all([
      fetchV8EmployeeContext(requesterId),
      fetchEmployeeShiftsV2(
        requesterId,
        candidateV8OrchestratorShift.date,
        SHIFT_WINDOW_DAYS,
        null,
      ),
    ]);

    const bidInput = buildBidInput({
      employeeId:      requesterId,
      employeeContext: requesterContext,
      existingShifts:  requesterShifts,
      candidateShift:  candidateV8OrchestratorShift,
      stage,
    });

    const resultA = runV8Orchestrator(bidInput) as V8OrchestratorResult;

    return {
      combinedStatus: resultA.overall_status as 'PASS' | 'WARNING' | 'BLOCKING',
      partyA:         resultA,
      partyB:         null,
      isStudentVisaHit: hasVisaHit(resultA),
    };
  }

  // ── SWAP ─────────────────────────────────────────────────────────────────────
  if (!myV8ShiftId || !targetEmployeeId || !targetV8ShiftId) {
    throw new Error(
      'SWAP compliance requires myV8ShiftId, targetEmployeeId, and targetV8ShiftId',
    );
  }

  // Fetch the requester's shift (the one they are giving up)
  const { data: myShiftRow, error: myShiftErr } = await db
    .from('shifts')
    .select('*')
    .eq('id', myV8ShiftId)
    .single();

  if (myShiftErr || !myShiftRow) {
    throw new Error(`Requester shift ${myV8ShiftId} not found`);
  }

  const myV8OrchestratorShift = mapShiftRowToV2(myShiftRow as Record<string, unknown>);

  // Fetch all parallel data
  const [
    requesterContext,
    targetContext,
    requesterShifts,
    targetShifts,
  ] = await Promise.all([
    fetchV8EmployeeContext(requesterId),
    fetchV8EmployeeContext(targetEmployeeId),
    fetchEmployeeShiftsV2(
      requesterId,
      candidateV8OrchestratorShift.date,
      SHIFT_WINDOW_DAYS,
      myV8ShiftId,           // exclude the shift being given away
    ),
    fetchEmployeeShiftsV2(
      targetEmployeeId,
      myV8OrchestratorShift.date,
      SHIFT_WINDOW_DAYS,
      targetV8ShiftId,       // exclude the shift being given away
    ),
  ]);

  // In the swap input builder convention:
  //   partyA (requester) gives up myV8OrchestratorShift, gains candidateV8OrchestratorShift (target's shift)
  //   partyB (target)    gives up candidateV8OrchestratorShift, gains myV8OrchestratorShift
  const { inputA, inputB } = buildSwapInputs({
    partyAEmployeeId:      requesterId,
    partyAContext:         requesterContext,
    partyAExistingShifts:  requesterShifts,
    partyAShift:           myV8OrchestratorShift,            // shift requester is giving up
    partyBEmployeeId:      targetEmployeeId,
    partyBContext:         targetContext,
    partyBExistingShifts:  targetShifts,
    partyBShift:           candidateV8OrchestratorShift,      // shift target is giving up
    stage,
  });

  const resultA = runV8Orchestrator(inputA) as V8OrchestratorResult;
  const resultB = runV8Orchestrator(inputB) as V8OrchestratorResult;

  const combined = combinedStatus(resultA.overall_status, resultB.overall_status) as V8Status;

  return {
    combinedStatus: combined as 'PASS' | 'WARNING' | 'BLOCKING',
    partyA:         resultA,
    partyB:         resultB,
    isStudentVisaHit: hasVisaHit(resultA) || hasVisaHit(resultB),
  };
}

// =============================================================================
// HOOK
// =============================================================================

export function useBulkPlanningCompliance(
  params: UseBulkPlanningComplianceParams,
): UseBulkPlanningComplianceResult {
  const {
    requestType,
    requesterId,
    candidateV8ShiftId,
    myV8ShiftId,
    targetEmployeeId,
    targetV8ShiftId,
    enabled = true,
  } = params;

  const [advisory, setAdvisory] = useState<PlanningComplianceAdvisory | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Use a ref for the debounce timer and an abort signal per evaluation
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const mountedRef = useRef<boolean>(true);

  // Stable cancel helper
  const cancelPending = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abortRef.current.cancelled = true;
    abortRef.current = { cancelled: false };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPending();
    };
  }, [cancelPending]);

  useEffect(() => {
    // Guard: skip when disabled or missing required params
    const isSwap = requestType === 'SWAP';
    const hasSwapParams = !isSwap || (!!myV8ShiftId && !!targetEmployeeId && !!targetV8ShiftId);

    if (!enabled || !requesterId || !candidateV8ShiftId || !hasSwapParams) {
      cancelPending();
      return;
    }

    // Cancel any in-flight evaluation
    cancelPending();

    // Create a fresh abort token for this evaluation
    const thisAbort = { cancelled: false };
    abortRef.current = thisAbort;

    setIsLoading(true);
    setError(null);

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const result = await runEvaluation({
          requestType,
          requesterId,
          candidateV8ShiftId,
          myV8ShiftId,
          targetEmployeeId,
          targetV8ShiftId,
          enabled,
        });

        if (!thisAbort.cancelled && mountedRef.current) {
          setAdvisory(result);
          setError(null);
        }
      } catch (err) {
        if (!thisAbort.cancelled && mountedRef.current) {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          setAdvisory(null);
        }
      } finally {
        if (!thisAbort.cancelled && mountedRef.current) {
          setIsLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      thisAbort.cancelled = true;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    enabled,
    requestType,
    requesterId,
    candidateV8ShiftId,
    myV8ShiftId,
    targetEmployeeId,
    targetV8ShiftId,
    cancelPending,
  ]);

  return { advisory, isLoading, error };
}
