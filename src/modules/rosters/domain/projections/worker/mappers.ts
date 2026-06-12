/**
 * DTO ↔ Entity Mappers
 *
 * Converts between raw Supabase `Shift` entities (main thread) and the
 * lightweight `WorkerShiftDTO`s that cross the worker boundary.
 *
 * These mappers are the ONLY place where the full Shift entity is touched.
 * Everything inside the worker operates exclusively on DTOs.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * This file runs on the MAIN THREAD only.
 * It may import from Shift entity types and Supabase-backed models.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { Shift } from '../../shift.entity';
import type {
  WorkerShiftDTO,
  WorkerEmployeeDTO,
  WorkerRoleDTO,
  WorkerLevelDTO,
  WorkerEventDTO,
  WorkerFilterDTO,
  WorkerRosterStructureDTO,
} from './protocol';
import type { EmployeeRecord, RoleRecord, LevelRecord, EventRecord } from '../types';
import type { RosterStructure } from '../../../model/roster.types';
import type { AdvancedFilters } from '../../../state/useRosterStore';

// ── Shift → WorkerShiftDTO ────────────────────────────────────────────────────

export function shiftToDTO(shift: Shift): WorkerShiftDTO {
  const profile = (shift as any).assigned_profiles ?? (shift as any).profiles;

  return {
    id: shift.id,
    updatedAtMs: new Date(shift.updated_at).getTime(),

    // Temporal
    shiftDate: shift.shift_date,
    startTime: shift.start_time,
    endTime: shift.end_time,
    isOvernight: shift.is_overnight,
    scheduledLengthMinutes: shift.scheduled_length_minutes ?? 0,
    netLengthMinutes: shift.net_length_minutes,
    unpaidBreakMinutes: shift.unpaid_break_minutes,
    paidBreakMinutes: shift.paid_break_minutes,

    // Assignment
    assignedEmployeeId: shift.assigned_employee_id,
    assignmentStatus: shift.assignment_status ?? null,
    assignmentOutcome: shift.assignment_outcome ?? null,

    // Lifecycle
    lifecycleStatus: shift.lifecycle_status,
    isCancelled: shift.is_cancelled,
    isLocked: shift.is_locked,
    isPublished: shift.is_published || ['Published', 'InProgress', 'Completed'].includes(shift.lifecycle_status),
    isDraft: shift.is_draft,

    // Bidding / Trading
    biddingStatus: shift.bidding_status,
    tradeRequestedAt: shift.trade_requested_at,
    tradingStatus: shift.trading_status ?? null,

    // Organisational
    organizationId: shift.organization_id,
    departmentId: shift.department_id,
    subDepartmentId: shift.sub_department_id,
    roleId: shift.role_id,
    roleName: shift.roles?.name ?? null,
    remunerationLevelId: shift.remuneration_level_id,
    remunerationRate: shift.remuneration_rate,
    actualHourlyRate: shift.actual_hourly_rate,

    // Level info
    levelName: shift.remuneration_levels?.level_name ?? null,
    levelNumber: shift.remuneration_levels?.level_number ?? null,

    // Group / Subgroup
    groupType: shift.group_type ?? null,
    subGroupName: shift.sub_group_name ?? null,

    // Employee profile
    employeeFirstName: profile?.first_name ?? null,
    employeeLastName: profile?.last_name ?? null,

    // Events
    eventIds: shift.event_ids ?? [],

    // Cost engine inputs
    targetEmploymentType: shift.target_employment_type ?? null,
    allowances: shift.allowances ?? null,
    isAnnualLeave: shift.isAnnualLeave,
    isPersonalLeave: shift.isPersonalLeave,
    isCarerLeave: shift.isCarerLeave,
    previousWage: shift.previousWage,

    // Roster structure
    rosterSubgroupId: shift.roster_subgroup?.name ? (shift as any).roster_subgroup_id ?? null : null,
    rosterSubgroupName: shift.roster_subgroup?.name ?? null,
    rosterGroupName: shift.roster_subgroup?.roster_group?.name ?? null,
    rosterGroupExternalId: shift.roster_subgroup?.roster_group?.external_id ?? null,

    // Display
    displayOrder: shift.display_order,
    notes: shift.notes,

    // UTC-at-rest
    startAt: shift.start_at ?? null,
    endAt: shift.end_at ?? null,

    // Fulfillment
    fulfillmentStatus: shift.fulfillment_status ?? 'none',

    // Required skills
    requiredSkills: shift.required_skills ?? [],
  };
}

/**
 * Batch convert an array of Shifts to DTOs.
 * This is the hot path — called once per projection cycle.
 */
export function shiftsToDTO(shifts: Shift[]): WorkerShiftDTO[] {
  return shifts.map(shiftToDTO);
}

// ── Employee → WorkerEmployeeDTO ──────────────────────────────────────────────

export function employeeToDTO(emp: EmployeeRecord, contractedHours?: number): WorkerEmployeeDTO {
  return {
    id: emp.id,
    firstName: emp.first_name ?? null,
    lastName: emp.last_name ?? null,
    contractedHours,
  };
}

export function employeesToDTO(
  employees: EmployeeRecord[],
  contractedHoursMap?: Record<string, number>,
): WorkerEmployeeDTO[] {
  return employees.map(e => employeeToDTO(e, contractedHoursMap?.[e.id]));
}

// ── Role → WorkerRoleDTO ──────────────────────────────────────────────────────

export function roleToDTO(role: RoleRecord): WorkerRoleDTO {
  return {
    id: role.id,
    name: role.name,
    code: role.code ?? null,
    remunerationLevelId: role.remuneration_level_id ?? null,
  };
}

export function rolesToDTO(roles: RoleRecord[]): WorkerRoleDTO[] {
  return roles.map(roleToDTO);
}

// ── Level → WorkerLevelDTO ────────────────────────────────────────────────────

export function levelToDTO(level: LevelRecord): WorkerLevelDTO {
  return {
    id: level.id,
    levelName: level.level_name,
    levelNumber: level.level_number,
  };
}

export function levelsToDTO(levels: LevelRecord[]): WorkerLevelDTO[] {
  return levels.map(levelToDTO);
}

// ── Event → WorkerEventDTO ────────────────────────────────────────────────────

export function eventToDTO(event: EventRecord): WorkerEventDTO {
  return {
    id: event.id,
    name: event.name,
    eventDate: event.event_date ?? null,
    startTime: event.start_time ?? null,
    endTime: event.end_time ?? null,
    location: event.location ?? null,
  };
}

export function eventsToDTO(events: EventRecord[]): WorkerEventDTO[] {
  return events.map(eventToDTO);
}

// ── RosterStructure → WorkerRosterStructureDTO ────────────────────────────────

export function rosterStructureToDTO(structure: RosterStructure): WorkerRosterStructureDTO {
  return {
    groups: structure.groups.map(g => ({
      externalId: g.externalId ?? '',
      name: g.name,
      subGroups: g.subGroups.map(sg => ({
        id: sg.id,
        name: sg.name,
        sortOrder: sg.sortOrder,
      })),
    })),
  };
}

export function rosterStructuresToDTO(structures: RosterStructure[]): WorkerRosterStructureDTO[] {
  return structures.map(rosterStructureToDTO);
}

// ── AdvancedFilters → WorkerFilterDTO ─────────────────────────────────────────

export function filtersToDTO(filters: AdvancedFilters): WorkerFilterDTO {
  return {
    roleId: filters.roleId || null,
    skillIds: [...filters.skillIds],
    lifecycleStatus: filters.lifecycleStatus,
    assignmentStatus: filters.assignmentStatus,
    assignmentOutcome: filters.assignmentOutcome,
    biddingStatus: filters.biddingStatus,
    tradingStatus: filters.tradingStatus,
    stateId: filters.stateId ?? null,
    searchQuery: filters.searchQuery,
  };
}
