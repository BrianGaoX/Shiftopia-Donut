/**
 * Projection Pipeline Orchestrator
 *
 * THE single entry point for all projection logic. Worker-agnostic, testable,
 * backend-portable. The worker calls this — it never calls projectors directly.
 *
 * Responsibilities:
 *   1. Filter shifts (via WorkerFilterDTO)
 *   2. Select the correct projector based on mode
 *   3. Route through the cache layer for cost lookups
 *   4. Compute top-level stats
 *   5. Return a fully-typed ProjectionResult
 *
 * This file must NEVER import React, Zustand, Supabase, or DOM APIs.
 */

import type {
  ProjectionRequest,
  ProjectionResult,
  ProjectionStatsResult,
  WorkerShiftDTO,
  WorkerFilterDTO,
} from '../worker/protocol';
import {
  makeCacheKey,
  getCachedCost,
  setCachedCost,
} from '../cache/projection.cache';
import type { ShiftCostBreakdown } from '../utils/cost/types';
import type { CostCalculatorOptions } from '../utils/cost/types';
import { estimateDetailedShiftCost, extractLevel } from '../utils/cost/index';
import type { AwardContext } from '../utils/cost/award-context';
import { buildAwardContext } from '../utils/cost/award-context';
import { projectPeople } from '../projectors/people.projector';
import { projectGroup } from '../projectors/group.projector';
import { projectEvents } from '../projectors/events.projector';
import { projectRoles } from '../projectors/roles.projector';

// ── Filter Logic (mirrors utils/filters.ts but operates on DTOs) ─────────────

function applyFilters(shifts: WorkerShiftDTO[], filters: WorkerFilterDTO): WorkerShiftDTO[] {
  const {
    roleId, skillIds, lifecycleStatus, assignmentStatus,
    assignmentOutcome, biddingStatus, tradingStatus, stateId, searchQuery,
  } = filters;

  const noop =
    !roleId &&
    skillIds.length === 0 &&
    lifecycleStatus === 'all' &&
    assignmentStatus === 'all' &&
    assignmentOutcome === 'all' &&
    biddingStatus === 'all' &&
    tradingStatus === 'all' &&
    (!stateId || stateId === 'all') &&
    !searchQuery.trim();

  if (noop) return shifts;

  return shifts.filter(s => {
    if (roleId && s.roleId !== roleId) return false;
    if (skillIds.length > 0 && !skillIds.every(id => s.requiredSkills.includes(id))) return false;
    if (lifecycleStatus !== 'all' && s.lifecycleStatus.toLowerCase() !== lifecycleStatus) return false;
    if (assignmentStatus !== 'all') {
      const isAssigned = !!s.assignedEmployeeId;
      if (assignmentStatus === 'assigned' && !isAssigned) return false;
      if (assignmentStatus === 'unassigned' && isAssigned) return false;
      if (assignmentStatus === 'on_bidding' && s.biddingStatus === 'not_on_bidding') return false;
    }
    if (assignmentOutcome !== 'all') {
      if (assignmentOutcome === 'none' ? s.assignmentOutcome : s.assignmentOutcome !== assignmentOutcome) return false;
    }
    if (biddingStatus !== 'all' && s.biddingStatus !== biddingStatus) return false;
    if (tradingStatus !== 'all') {
      const isTrade = !!s.tradeRequestedAt;
      if (tradingStatus === 'requested' && !isTrade) return false;
      if (tradingStatus === 'none' && isTrade) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const role = (s.roleName ?? '').toLowerCase();
      const emp = `${s.employeeFirstName ?? ''} ${s.employeeLastName ?? ''}`.toLowerCase();
      const sub = (s.subGroupName ?? '').toLowerCase();
      const notes = (s.notes ?? '').toLowerCase();
      if (!role.includes(q) && !emp.includes(q) && !sub.includes(q) && !notes.includes(q)) return false;
    }
    return true;
  });
}

// ── Cost calculation with cache ──────────────────────────────────────────────


export function computeCostForShift(
  shift: WorkerShiftDTO,
  netMinutes: number,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  const key = makeCacheKey(shift.id, shift.updatedAtMs);
  const cached = getCachedCost(key);
  if (cached) return cached;

  const empType = shift.targetEmploymentType;
  const result = estimateDetailedShiftCost({
    netMinutes,
    start_time: shift.startTime,
    end_time: shift.endTime,
    rate: shift.actualHourlyRate || shift.remunerationRate,
    scheduled_length_minutes: shift.scheduledLengthMinutes,
    is_overnight: shift.isOvernight,
    is_cancelled: shift.isCancelled,
    shift_date: shift.shiftDate,
    allowances: shift.allowances ?? undefined,
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,
    employmentType: (empType === 'FT' || /full/i.test(empType as string)) ? 'Full-Time' : (empType === 'PT' || /part/i.test(empType as string)) ? 'Part-Time' : (empType as any || 'Casual'),
    isSecurityRole: shift.roleName?.toLowerCase().includes('security'),
    classificationLevel: extractLevel(shift.roleName),
  } as CostCalculatorOptions, ctx);

  setCachedCost(key, result);
  return result;
}

// ── Net minutes from DTO ─────────────────────────────────────────────────────

function netMinutesFromDTO(shift: WorkerShiftDTO): number {
  if (shift.netLengthMinutes != null && shift.netLengthMinutes > 0) return shift.netLengthMinutes;
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  return Math.max(0, (end - start) - shift.unpaidBreakMinutes);
}

// ── Stats builder ────────────────────────────────────────────────────────────

function buildStats(shifts: WorkerShiftDTO[]): ProjectionStatsResult {
  const nonCancelled = shifts.filter(s => !s.isCancelled);
  let totalNetMinutes = 0, estimatedCost = 0;
  const cb = { base: 0, penalty: 0, overtime: 0, allowance: 0, leave: 0 };

  // ── Phase 3: Pre-compute date context for O(1) lookups ──────────────
  const assignedDates = nonCancelled
    .filter(s => !!s.assignedEmployeeId)
    .map(s => s.shiftDate)
    .filter(Boolean);
  const ctx = buildAwardContext(assignedDates);

  for (const s of nonCancelled) {
    const mins = netMinutesFromDTO(s);
    totalNetMinutes += mins;

    // Cost is employee-dependent — only compute for assigned shifts
    if (s.assignedEmployeeId) {
      const detail = computeCostForShift(s, mins, ctx);
      estimatedCost += detail.totalCost;
      cb.base += detail.ordinaryCost;
      cb.penalty += detail.penaltyCost;
      cb.overtime += detail.overtimeCost;
      cb.allowance += detail.allowanceCost ?? 0;
    }
  }

  return {
    totalShifts: nonCancelled.length,
    assignedShifts: nonCancelled.filter(s => !!s.assignedEmployeeId).length,
    openShifts: nonCancelled.filter(s => !s.assignedEmployeeId).length,
    publishedShifts: nonCancelled.filter(s => ['Published', 'InProgress', 'Completed'].includes(s.lifecycleStatus)).length,
    totalNetMinutes,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    costBreakdown: cb,
  };
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full projection pipeline. This is the ONLY function the worker calls.
 *
 * @param request  - The projection request with DTOs, mode, and filters
 * @param activeRequestId - Ref to the current active request ID for cancellation
 * @returns ProjectionResult or null if cancelled
 */
export function runProjectionPipeline(
  request: ProjectionRequest,
  activeRequestId?: { current: number },
): ProjectionResult | null {
  const t0 = performance.now();

  // ── Cancellation check helper ──
  const isCancelled = () =>
    activeRequestId != null && activeRequestId.current !== request.requestId;

  // ── 1. Filter ──
  const filtered = applyFilters(request.shifts, request.filters);
  if (isCancelled()) return null;

  // ── 2. Stats (always computed) ──
  const stats = buildStats(filtered);
  if (isCancelled()) return null;

  // ── 3. Mode-specific projection ──
  // Placeholder: returns the stats and filtered count.
  // Phase 2 will wire in the actual projector logic for each mode,
  // converting WorkerShiftDTOs into ProjectedShiftResults.
  const result: ProjectionResult = {
    requestId: request.requestId,
    durationMs: 0,
    mode: request.mode,
    stats,
    group: null,
    people: null,
    events: null,
    roles: null,
  };

  if (request.mode === 'people') {
    result.people = projectPeople(filtered, { employees: request.employees, nowIso: request.nowIso, rangeDays: request.rangeDays });
  } else if (request.mode === 'group') {
    result.group = projectGroup(filtered, { rosterStructures: request.rosterStructures });
  } else if (request.mode === 'events') {
    result.events = projectEvents(filtered, { events: request.events });
  } else if (request.mode === 'roles') {
    result.roles = projectRoles(filtered, { roles: request.roles, levels: request.levels });
  }

  result.durationMs = Math.round(performance.now() - t0);
  return result;
}
