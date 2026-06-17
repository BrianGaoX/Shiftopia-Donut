/**
 * People Mode Projector (Worker-Safe)
 *
 * Transforms a flat WorkerShiftDTO[] + WorkerEmployeeDTO[] into a PeopleProjection.
 * NO React, NO DOM, NO raw Shift entities. Runs natively inside Web Worker.
 */

import type { 
  ProjectedEmployee, 
  PeopleProjection 
} from '../types';
import type { 
  WorkerShiftDTO, 
  WorkerEmployeeDTO, 
  ProjectedShiftResult 
} from '../worker/protocol';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { UNASSIGNED_BUCKET_ID, dicebearUrl } from '../constants';
import { minutesToHours } from '../utils/duration';
import { getCachedCost, makeCacheKey } from '../cache/projection.cache';
import { ZERO_COST_BREAKDOWN } from '../utils/cost/constants';
import { determineShiftState } from '../../shift-state.utils';
import { GROUP_COLORS, UNASSIGNED_COLORS, ALL_GROUP_TYPES } from '../constants';
import { computeUtilizationPct, isOverContractedHours, periodContractedHours, computePeakFatigue } from '../utils/workload';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveEmployeeName(shift: WorkerShiftDTO): string | null {
  if (shift.employeeFirstName || shift.employeeLastName) {
    return `${shift.employeeFirstName ?? ''} ${shift.employeeLastName ?? ''}`.trim() || null;
  }
  if (shift.assignedEmployeeId) return 'Assigned';
  return null;
}

function makeEmployee(
  id: string,
  name: string,
  contractedHours: number,
  avatar: string,
): ProjectedEmployee {
  return { 
    id, 
    name, 
    avatar, 
    contractedHours,
    periodContractedHours: 0,
    currentHours: 0,
    overHoursWarning: false,
    shifts: {},
    estimatedPay: 0,
    fatigueScore: 0,
    utilization: 0,
    payBreakdown: {
      base: 0,
      penalty: 0,
      overtime: 0,
      allowance: 0,
      leave: 0,
    }
  };
}

function toProjectedShift(shift: WorkerShiftDTO): ProjectedShiftResult {
  const isAssigned = !!shift.assignedEmployeeId;
  const netMinutes = shift.netLengthMinutes ?? shift.scheduledLengthMinutes;
  
  // Try to get cost from cache, default to zero if not computed (pipeline should compute it)
  const key = makeCacheKey(shift.id, shift.updatedAtMs);
  const detail = isAssigned ? (getCachedCost(key) ?? ZERO_COST_BREAKDOWN) : ZERO_COST_BREAKDOWN;
  const estimatedCost = detail.totalCost;

  const groupType = shift.groupType ?? null;
  const colors = groupType && ALL_GROUP_TYPES.includes(groupType)
    ? GROUP_COLORS[groupType] 
    : UNASSIGNED_COLORS;

  const stateId = determineShiftState({
    lifecycle_status: shift.lifecycleStatus as any,
    assignment_status: (shift.assignmentStatus ?? 'unassigned') as any,
    assignment_outcome: shift.assignmentOutcome as any,
    trading_status: shift.tradingStatus as any,
    is_cancelled: shift.isCancelled,
  });

  return {
    id: shift.id,
    date: shift.shiftDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    netMinutes,
    unpaidBreakMinutes: shift.unpaidBreakMinutes ?? 0,
    estimatedCost,
    costBreakdown: {
      base: detail.ordinaryCost,
      penalty: detail.penaltyCost,
      overtime: detail.overtimeCost,
      allowance: detail.allowanceCost ?? 0,
      leave: 0,
    },
    detailedCost: detail,
    stateId,
    roleName: shift.roleName ?? 'Shift',
    roleId: shift.roleId,
    levelName: shift.levelName ?? '',
    levelNumber: shift.levelNumber ?? 0,
    levelId: shift.remunerationLevelId,
    groupType,
    subGroupName: shift.subGroupName ?? shift.rosterSubgroupName ?? null,
    groupColorKey: groupType ?? 'unassigned',
    employeeName: resolveEmployeeName(shift),
    employeeId: shift.assignedEmployeeId,
    isLocked: shift.isLocked,
    isUrgent: isOnBidding(shift.biddingStatus) && computeBiddingUrgency(shift.shiftDate, shift.startTime) === 'urgent',
    isOnBidding: isOnBidding(shift.biddingStatus),
    isTrading: !!shift.tradeRequestedAt,
    isCancelled: shift.isCancelled,
    isPublished: shift.isPublished,
    isDraft: shift.isDraft,
    
    role: shift.roleName ?? 'Shift',
    hours: minutesToHours(netMinutes),
    pay: estimatedCost,
    status: shift.isCancelled ? 'Draft' : (shift.assignedEmployeeId ? (shift.isDraft ? 'Draft' : 'Assigned') : 'Open'),
    lifecycleStatus: shift.isPublished ? 'published' : 'draft',
    assignmentStatus: shift.assignedEmployeeId ? 'assigned' : 'unassigned',
    fulfillmentStatus: shift.fulfillmentStatus,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PeopleProjectorContext {
  employees?: WorkerEmployeeDTO[];
  contractedHoursMap?: Record<string, number>;
  nowIso?: string;
  /** Calendar days in the visible range — scales weekly contract for utilization. */
  rangeDays?: number;
}

export function projectPeople(
  shifts: WorkerShiftDTO[],
  ctx: PeopleProjectorContext = {},
): PeopleProjection {
  const { employees = [], contractedHoursMap = {} } = ctx;

  const empMap = new Map<string, ProjectedEmployee>();

  employees.forEach(emp => {
    const name = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() || 'Unknown';
    empMap.set(emp.id, makeEmployee(
      emp.id,
      name,
      emp.contractedHours ?? contractedHoursMap[emp.id] ?? 0,
      dicebearUrl(emp.firstName ?? emp.id),
    ));
  });

  shifts.forEach(shift => {
    const targetId = shift.assignedEmployeeId ?? UNASSIGNED_BUCKET_ID;

    if (!empMap.has(targetId)) {
      if (targetId === UNASSIGNED_BUCKET_ID) {
        empMap.set(UNASSIGNED_BUCKET_ID, makeEmployee(
          UNASSIGNED_BUCKET_ID,
          'Open Shifts',
          0,
          dicebearUrl('unassigned', 'shapes'),
        ));
      } else {
        const firstName = shift.employeeFirstName ?? 'Assigned';
        const lastName  = shift.employeeLastName  ?? '';
        empMap.set(targetId, makeEmployee(
          targetId,
          `${firstName} ${lastName}`.trim(),
          contractedHoursMap[targetId] ?? 0,
          dicebearUrl(targetId),
        ));
      }
    }

    const emp = empMap.get(targetId)!;
    const ps = toProjectedShift(shift);

    if (!emp.shifts[shift.shiftDate]) {
      emp.shifts[shift.shiftDate] = [];
    }
    // We forcefully cast to any for UI compatibility in the pipeline
    emp.shifts[shift.shiftDate].push(ps as any);

    if (!shift.isCancelled && shift.assignedEmployeeId) {
      emp.currentHours = Math.round((emp.currentHours + ps.hours) * 100) / 100;
      emp.estimatedPay += ps.pay;
      
      emp.payBreakdown.base += ps.costBreakdown.base;
      emp.payBreakdown.penalty += ps.costBreakdown.penalty;
      emp.payBreakdown.overtime += ps.costBreakdown.overtime;
      emp.payBreakdown.allowance += ps.costBreakdown.allowance;
      emp.payBreakdown.leave += ps.costBreakdown.leave;
    }
  });

  const empArray = Array.from(empMap.values());
  const { rangeDays } = ctx;

  // O(1) lookup so fatigue mapping doesn't scan the full shift list per shift.
  const shiftById = new Map(shifts.map(s => [s.id, s]));

  empArray.forEach(emp => {
    // Utilization scales the WEEKLY contract to the visible period so the % is
    // correct in every view (Day/Week/Month), not just Week. Shared with the
    // worker-pool merge path via these helpers — one formula, one answer.
    emp.periodContractedHours = periodContractedHours(emp.contractedHours, rangeDays);
    emp.overHoursWarning = isOverContractedHours(emp.currentHours, emp.contractedHours, rangeDays);
    emp.utilization = computeUtilizationPct(emp.currentHours, emp.contractedHours, rangeDays);

    const empShifts = Object.values(emp.shifts).flat() as unknown as ProjectedShiftResult[];
    if (empShifts.length > 0 && emp.id !== UNASSIGNED_BUCKET_ID) {
      // Map DTO back to the specific keys fatigue.ts expects
      const fatigueInput = empShifts.map(ps => {
        const originalDto = shiftById.get(ps.id)!;
        return {
          shift_date: originalDto.shiftDate,
          start_time: originalDto.startTime,
          end_time: originalDto.endTime,
          unpaid_break_minutes: originalDto.unpaidBreakMinutes,
        };
      });
      // Peak fatigue across the roster (per-shift window), not "as of today" —
      // the latter reads 0 for any future roster.
      emp.fatigueScore = computePeakFatigue(fatigueInput);
    }
  });

  empArray.sort((a, b) => {
    if (a.id === UNASSIGNED_BUCKET_ID) return 1;
    if (b.id === UNASSIGNED_BUCKET_ID) return -1;
    return a.name.localeCompare(b.name);
  });

  return {
    employees: empArray,
    // Note: Stats are built separately in the pipeline, this returns a dummy
    stats: {
        totalShifts: 0,
        assignedShifts: 0,
        openShifts: 0,
        publishedShifts: 0,
        totalNetMinutes: 0,
        estimatedCost: 0,
        costBreakdown: { base: 0, penalty: 0, overtime: 0, allowance: 0, leave: 0 },
    },
  };
}
