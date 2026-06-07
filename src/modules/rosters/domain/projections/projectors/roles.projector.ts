/**
 * Roles Mode Projector (Worker-Safe)
 *
 * Transforms a flat WorkerShiftDTO[] + optional WorkerRoleDTO[] / WorkerLevelDTO[] into a
 * RolesProjection.
 * NO React, NO DOM, NO raw Shift entities. Runs natively inside Web Worker.
 */

import type {
  RolesProjection,
  ProjectedLevel,
  ProjectedRole,
} from '../types';
import type { WorkerShiftDTO, WorkerRoleDTO, WorkerLevelDTO, ProjectedShiftResult } from '../worker/protocol';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { GROUP_COLORS, UNASSIGNED_COLORS, ALL_GROUP_TYPES, levelColorClass } from '../constants';
import { minutesToHours } from '../utils/duration';
import { getCachedCost, makeCacheKey } from '../cache/projection.cache';
import { ZERO_COST_BREAKDOWN } from '../utils/cost/constants';
import { determineShiftState } from '../../shift-state.utils';
import { statsFromProjectedShifts } from './stats.util';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveEmployeeName(shift: WorkerShiftDTO): string | null {
  if (shift.employeeFirstName || shift.employeeLastName) {
    return `${shift.employeeFirstName ?? ''} ${shift.employeeLastName ?? ''}`.trim() || null;
  }
  if (shift.assignedEmployeeId) return 'Assigned';
  return null;
}

function toProjectedShift(shift: WorkerShiftDTO): ProjectedShiftResult {
  const isAssigned = !!shift.assignedEmployeeId;
  const netMinutes = shift.netLengthMinutes ?? shift.scheduledLengthMinutes;
  
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

// Immutable role accumulator — mutated only during projection build
type RoleAccum = {
  id: string;
  name: string;
  code: string;
  /** roleId → date → ProjectedShiftResult[] */
  shiftsByDate: Map<string, ProjectedShiftResult[]>;
};

function emptyRoleAccum(id: string, name: string, code: string): RoleAccum {
  return { id, name, code, shiftsByDate: new Map() };
}

function finaliseRole(r: RoleAccum): ProjectedRole {
  const shiftsByDate: Record<string, ProjectedShiftResult[]> = {};
  let totalMins = 0;
  let totalCost = 0;

  r.shiftsByDate.forEach((dayShifts, date) => {
    shiftsByDate[date] = dayShifts;
    dayShifts.forEach(s => {
      totalMins += s.netMinutes;
      totalCost += s.estimatedCost;
    });
  });

  return {
    id: r.id,
    name: r.name,
    code: r.code,
    // Cast to any for the pipeline (hook maps it back)
    shiftsByDate: shiftsByDate as any,
    totalHours: minutesToHours(totalMins),
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

function addShiftToRole(accum: RoleAccum, shift: WorkerShiftDTO, ps: ProjectedShiftResult): void {
  const date = shift.shiftDate;
  if (!accum.shiftsByDate.has(date)) accum.shiftsByDate.set(date, []);
  accum.shiftsByDate.get(date)!.push(ps);
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface RolesProjectorContext {
  roles?: WorkerRoleDTO[];
  levels?: WorkerLevelDTO[];
}

export function projectRoles(
  shifts: WorkerShiftDTO[],
  ctx: RolesProjectorContext = {},
): RolesProjection {
  const { roles = [], levels = [] } = ctx;

  const levelById = new Map<string, WorkerLevelDTO>(levels.map(l => [l.id, l]));
  const roleById = new Map<string, WorkerRoleDTO>(roles.map(r => [r.id, r]));

  const levelRoleMap = new Map<string, Map<string, RoleAccum>>();
  const unassignedRoleMap = new Map<string, RoleAccum>();

  // Every projected shift (incl. cancelled) for top-level stats aggregation.
  const allProjected: ProjectedShiftResult[] = [];

  roles.forEach(role => {
    const roleAccum = emptyRoleAccum(role.id, role.name, role.code ?? '');
    if (role.remunerationLevelId) {
      const lid = role.remunerationLevelId;
      if (!levelRoleMap.has(lid)) levelRoleMap.set(lid, new Map());
      levelRoleMap.get(lid)!.set(role.id, roleAccum);
    } else {
      unassignedRoleMap.set(role.id, roleAccum);
    }
  });

  shifts.forEach(shift => {
    const ps = toProjectedShift(shift);
    allProjected.push(ps);
    const roleId = shift.roleId ?? 'unknown';
    const roleName = shift.roleName ?? 'Unnamed Role';
    const levelId = shift.remunerationLevelId
      ?? roleById.get(roleId)?.remunerationLevelId
      ?? null;

    if (levelId) {
      if (!levelRoleMap.has(levelId)) levelRoleMap.set(levelId, new Map());
      const roleMap = levelRoleMap.get(levelId)!;
      if (!roleMap.has(roleId)) {
        const knownRole = roleById.get(roleId);
        roleMap.set(
          roleId,
          emptyRoleAccum(roleId, knownRole?.name ?? roleName, knownRole?.code ?? ''),
        );
      }
      addShiftToRole(roleMap.get(roleId)!, shift, ps);
    } else {
      if (!unassignedRoleMap.has(roleId)) {
        const knownRole = roleById.get(roleId);
        unassignedRoleMap.set(
          roleId,
          emptyRoleAccum(roleId, knownRole?.name ?? roleName, knownRole?.code ?? ''),
        );
      }
      addShiftToRole(unassignedRoleMap.get(roleId)!, shift, ps);
    }
  });

  const allLevelIds = new Set<string>([
    ...levels.map(l => l.id),
    ...Array.from(levelRoleMap.keys()),
  ]);

  const projectedLevels: ProjectedLevel[] = [];

  allLevelIds.forEach(levelId => {
    const roleMap = levelRoleMap.get(levelId);
    if (!roleMap || roleMap.size === 0) return;
    const hasAnyShifts = Array.from(roleMap.values()).some(r => r.shiftsByDate.size > 0);
    if (!hasAnyShifts) return;

    const levelMeta = levelById.get(levelId);
    const levelNumber = levelMeta?.levelNumber ?? 0;

    const projectedRoles: ProjectedRole[] = Array.from(roleMap.values())
      .map(finaliseRole)
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalHours = projectedRoles.reduce((acc, r) => acc + r.totalHours, 0);
    const totalCost = projectedRoles.reduce((acc, r) => acc + r.totalCost, 0);

    projectedLevels.push({
      id: levelId,
      name: levelMeta?.levelName ?? `Level ${levelNumber}`,
      levelNumber,
      colorClass: levelColorClass(levelNumber),
      roles: projectedRoles,
      totalHours: Math.round(totalHours * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    });
  });

  projectedLevels.sort((a, b) => a.levelNumber - b.levelNumber);

  const unassignedRoles: ProjectedRole[] = Array.from(unassignedRoleMap.values())
    .map(finaliseRole)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    levels: projectedLevels,
    unassignedRoles,
    stats: statsFromProjectedShifts(allProjected),
  };
}
