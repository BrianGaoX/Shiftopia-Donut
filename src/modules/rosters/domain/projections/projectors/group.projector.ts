/**
 * Group Mode Projector (Worker-Safe)
 *
 * Transforms a flat WorkerShiftDTO[] + optional WorkerRosterStructureDTO[] into a GroupProjection.
 * NO React, NO DOM, NO raw Shift entities. Runs natively inside Web Worker.
 */

import type { TemplateGroupType } from '../../shift.entity';
import type {
  ProjectedSubGroup,
  ProjectedGroup,
  GroupProjection,
  GroupStats,
  SubGroupStats,
} from '../types';
import type {
  WorkerShiftDTO,
  WorkerRosterStructureDTO,
  ProjectedShiftResult,
} from '../worker/protocol';
import { computeBiddingUrgency, isOnBidding } from '../../bidding-urgency';
import { GROUP_COLORS, UNASSIGNED_COLORS, GROUP_DISPLAY_NAMES, ALL_GROUP_TYPES } from '../constants';
import { minutesToHours } from '../utils/duration';
import { getCachedCost, makeCacheKey } from '../cache/projection.cache';
import { ZERO_COST_BREAKDOWN } from '../utils/cost/constants';
import { coverageHealth } from '../utils/coverage';
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

function subGroupStats(shifts: ProjectedShiftResult[]): SubGroupStats {
  const assigned  = shifts.filter(s => !!s.employeeId).length;
  const netMins   = shifts.reduce((acc, s) => acc + s.netMinutes, 0);
  const cost      = shifts.reduce((acc, s) => acc + s.estimatedCost, 0);

  const breakdown = {
    base: 0,
    penalty: 0,
    overtime: 0,
    allowance: 0,
    leave: 0,
  };

  shifts.forEach(s => {
    breakdown.base += s.costBreakdown.base;
    breakdown.penalty += s.costBreakdown.penalty;
    breakdown.overtime += s.costBreakdown.overtime;
    breakdown.allowance += s.costBreakdown.allowance;
    breakdown.leave += s.costBreakdown.leave;
  });

  return {
    totalShifts:    shifts.length,
    assignedShifts: assigned,
    totalHours:     minutesToHours(netMins),
    estimatedCost:  Math.round(cost * 100) / 100,
    costBreakdown: breakdown,
  };
}

function groupStatsFrom(subGroups: ProjectedSubGroup[]): GroupStats {
  const allShifts = subGroups.flatMap(sg =>
    Object.values(sg.shiftsByDate).flat()
  ) as unknown as ProjectedShiftResult[];
  
  const assigned  = allShifts.filter(s => !!s.employeeId).length;
  const netMins   = allShifts.reduce((acc, s) => acc + s.netMinutes, 0);
  const cost      = allShifts.reduce((acc, s) => acc + s.estimatedCost, 0);

  const breakdown = {
    base: 0,
    penalty: 0,
    overtime: 0,
    allowance: 0,
    leave: 0,
  };

  allShifts.forEach(s => {
    breakdown.base += s.costBreakdown.base;
    breakdown.penalty += s.costBreakdown.penalty;
    breakdown.overtime += s.costBreakdown.overtime;
    breakdown.allowance += s.costBreakdown.allowance;
    breakdown.leave += s.costBreakdown.leave;
  });

  return {
    totalShifts:    allShifts.length,
    assignedShifts: assigned,
    subGroupCount:  subGroups.length,
    totalHours:     minutesToHours(netMins),
    estimatedCost:  Math.round(cost * 100) / 100,
    costBreakdown: breakdown,
  };
}

// ── Canonical group key from TemplateGroupType ────────────────────────────────

function toGroupKey(externalId: string | null, name: string): TemplateGroupType | null {
  if (externalId && ALL_GROUP_TYPES.includes(externalId as TemplateGroupType)) {
    return externalId as TemplateGroupType;
  }
  const normalised = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (ALL_GROUP_TYPES.includes(normalised as TemplateGroupType)) {
    return normalised as TemplateGroupType;
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface GroupProjectorContext {
  rosterStructures?: WorkerRosterStructureDTO[];
}

export function projectGroup(
  shifts:  WorkerShiftDTO[],
  ctx:     GroupProjectorContext = {},
): GroupProjection {

  type SubGroupEntry = { id: string; name: string; sortOrder: number };
  const skeleton = new Map<TemplateGroupType | 'unassigned', Map<string, SubGroupEntry>>();

  ALL_GROUP_TYPES.forEach(type => skeleton.set(type, new Map()));
  skeleton.set('unassigned', new Map());

  (ctx.rosterStructures ?? []).forEach(roster => {
    roster.groups.forEach(group => {
      const type = toGroupKey(group.externalId, group.name);
      const key  = type ?? 'unassigned';
      if (!skeleton.has(key)) skeleton.set(key, new Map());
      const subMap = skeleton.get(key)!;
      group.subGroups.forEach(sg => {
        if (!subMap.has(sg.name)) {
          subMap.set(sg.name, { id: sg.id, name: sg.name, sortOrder: sg.sortOrder });
        }
      });
    });
  });

  const projectedByGroupAndSubGroup = new Map<
    TemplateGroupType | 'unassigned',
    Map<string, Map<string, ProjectedShiftResult[]>>
  >();

  skeleton.forEach((_, gk) => projectedByGroupAndSubGroup.set(gk, new Map()));

  const subGroupToCanonical = new Map<string, TemplateGroupType | 'unassigned'>();
  skeleton.forEach((subMap, gk) => {
    subMap.forEach((_, sgName) => {
      if (!subGroupToCanonical.has(sgName)) {
        subGroupToCanonical.set(sgName, gk);
      }
    });
  });

  // Every projected shift (incl. cancelled) for top-level stats aggregation.
  const allProjected: ProjectedShiftResult[] = [];

  shifts.forEach(shift => {
    const rawGroupKey: TemplateGroupType | 'unassigned' =
      (shift.groupType && ALL_GROUP_TYPES.includes(shift.groupType as TemplateGroupType))
        ? shift.groupType as TemplateGroupType
        : 'unassigned';

    const subGroupName = shift.subGroupName?.trim() ?? shift.rosterSubgroupName?.trim() ?? 'General';

    const canonicalKey = subGroupToCanonical.get(subGroupName);
    const groupKey: TemplateGroupType | 'unassigned' =
      canonicalKey !== undefined ? canonicalKey : rawGroupKey;

    const date     = shift.shiftDate;
    const groupMap = projectedByGroupAndSubGroup.get(groupKey)!;
    if (!groupMap.has(subGroupName)) groupMap.set(subGroupName, new Map());
    const dateMap  = groupMap.get(subGroupName)!;
    if (!dateMap.has(date)) dateMap.set(date, []);
    const ps = toProjectedShift(shift);
    dateMap.get(date)!.push(ps);
    allProjected.push(ps);
  });

  const groupOrder: (TemplateGroupType | 'unassigned')[] = [
    ...ALL_GROUP_TYPES,
    'unassigned',
  ];

  const groups: ProjectedGroup[] = groupOrder.map(groupKey => {
    const colors  = groupKey === 'unassigned'
      ? UNASSIGNED_COLORS
      : GROUP_COLORS[groupKey as TemplateGroupType];
    const name    = GROUP_DISPLAY_NAMES[groupKey as keyof typeof GROUP_DISPLAY_NAMES];

    const skeletonSubGroups = skeleton.get(groupKey) ?? new Map<string, SubGroupEntry>();
    const shiftSubGroups    = projectedByGroupAndSubGroup.get(groupKey) ?? new Map();

    const allSubGroupNames = new Set([
      ...Array.from(skeletonSubGroups.values())
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(sg => sg.name),
      ...Array.from(shiftSubGroups.keys()),
    ]);

    const subGroups: ProjectedSubGroup[] = Array.from(allSubGroupNames).map(sgName => {
      const dateMap  = shiftSubGroups.get(sgName) ?? new Map<string, ProjectedShiftResult[]>();
      const shiftsByDate: Record<string, ProjectedShiftResult[]> = {};
      dateMap.forEach((dayShifts, date) => { shiftsByDate[date] = dayShifts; });

      const allShifts  = Object.values(shiftsByDate).flat();
      const assigned   = allShifts.filter(s => !!s.employeeId).length;
      const sgId       = skeletonSubGroups.get(sgName)?.id ?? `adhoc-${groupKey}-${sgName}`;

      return {
        id:           sgId,
        name:         sgName,
        shiftsByDate: shiftsByDate as any,
        coverage:     coverageHealth(assigned, allShifts.length),
        stats:        subGroupStats(allShifts),
      };
    });

    return {
      id:        groupKey,
      name,
      type:      groupKey,
      colors,
      subGroups,
      stats:     groupStatsFrom(subGroups),
    };
  });

  const finalGroups = groups.filter(g =>
    g.type !== 'unassigned' ||
    g.subGroups.some(sg => Object.keys(sg.shiftsByDate).length > 0)
  );

  return {
    groups: finalGroups,
    stats:  statsFromProjectedShifts(allProjected),
  };
}
