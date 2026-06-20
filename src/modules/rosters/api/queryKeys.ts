/**
 * Query Key Registry
 *
 * Three-level hierarchy for surgical TanStack Query cache invalidation:
 *
 *   shiftKeys.all                → nuclear option (everything shifts-related)
 *   shiftKeys.lists              → all shift list queries (byDate / byRange / byEmployee)
 *   shiftKeys.byDate(...)        → single date view for one org
 *   shiftKeys.details            → all shift detail queries
 *   shiftKeys.detail(id)         → one shift's detail
 *   shiftKeys.lookups._root      → all lookup / reference data
 *   shiftKeys.lookups.roles(...) → roles for a specific dept/sub-dept
 *
 * Invalidation strategy guide:
 *
 *   After CREATE / DELETE of a shift:
 *     → invalidate shiftKeys.lists  (never invalidate shiftKeys.all)
 *
 *   After UPDATE of a single shift:
 *     → setQueriesData(shiftKeys.lists, updater)  — no network round-trip
 *     → invalidate shiftKeys.detail(id)           — ensure detail is fresh
 *
 *   After BULK publish / assign / unassign:
 *     → setQueriesData(shiftKeys.lists, updater)  — instant optimistic apply
 *     → invalidate shiftKeys.lists on settled     — confirm from server
 *
 *   After template apply / roster activate (structural changes):
 *     → invalidate shiftKeys.lists + rosterKeys.structure
 *
 *   Reference data changes (roles / employees):
 *     → invalidate shiftKeys.lookups._root (never touches shift lists)
 */

import type { TemplateGroupType, ShiftStatus } from '../domain/shift.entity';

// ── Filter shape ──────────────────────────────────────────────────────────────

export interface ShiftFilters {
  departmentId?: string;
  subDepartmentId?: string;
  departmentIds?: string[];
  subDepartmentIds?: string[];
  groupType?: TemplateGroupType;
  status?: ShiftStatus;
  roleId?: string;
  skillIds?: string[];
  complianceStatus?: 'compliant' | 'warning' | 'violation';
}

// ── Template query keys ───────────────────────────────────────────────────────

export const templateKeys = {
  all: ['templates'] as const,
  history: () => ['templates', 'history'] as const,
  detail: (id: string) => ['templates', 'detail', id] as const,
};

// ── Roster-level query keys ───────────────────────────────────────────────────

export const rosterKeys = {
  all: ['rosters'] as const,
  structure: (rosterId?: string) => ['rosters', 'structure', rosterId ?? null] as const,
  lookup: (orgId?: string, filters?: object) =>
    ['rosters', 'lookup', orgId ?? null, filters ?? null] as const,
};

/** @deprecated Use rosterKeys.all. Kept for mutation file compat. */
export const ROSTER_STRUCTURE_KEY = rosterKeys.all;

// ── Shift query keys ──────────────────────────────────────────────────────────

export const shiftKeys = {
  // ── Level 0: root — invalidate EVERYTHING shifts-related (nuclear) ─────────
  all: ['shifts'] as const,

  // ── Level 1: lists — all paginated / date-filtered shift arrays ───────────
  // Invalidate this to refetch any view that shows a list of shifts.
  // Does NOT touch lookups, detail views, or other query families.
  lists: ['shifts', 'list'] as const,

  // ── Level 2: named lists — narrow to a single query shape ────────────────
  byDate: (orgId: string, date: string, filters?: ShiftFilters | null) =>
    ['shifts', 'list', 'byDate', orgId, date, filters ?? null] as const,

  byDateRange: (
    orgId: string,
    startDate: string,
    endDate: string,
    filters?: ShiftFilters | null,
  ) => ['shifts', 'list', 'byRange', orgId, startDate, endDate, filters ?? null] as const,

  summary: (
    orgId: string,
    startDate: string,
    endDate: string,
    filters?: ShiftFilters | null,
  ) => ['shifts', 'summary', orgId, startDate, endDate, filters ?? null] as const,

  byEmployee: (empId: string, startDate: string, endDate: string) =>
    ['shifts', 'list', 'byEmployee', empId, startDate, endDate] as const,

  // Includes Published + InProgress + Completed — used by AttendancePage
  attendance: (empId: string, startDate: string, endDate: string) =>
    ['shifts', 'list', 'attendance', empId, startDate, endDate] as const,

  // ── Level 1: detail — single shift detail views ───────────────────────────
  details: ['shifts', 'detail'] as const,
  detail: (shiftId: string) => ['shifts', 'detail', shiftId] as const,

  // ── Level 1: offers — employee offer inbox / history ─────────────────────
  offers: (empId: string) => ['shifts', 'offers', empId] as const,
  offerCount: (empId: string) => ['shifts', 'offerCount', empId] as const,

  // ── Level 1: open / bidding ───────────────────────────────────────────────
  openShifts: (orgId?: string, filters?: { departmentId?: string | null; subDepartmentId?: string | null }) =>
    ['shifts', 'open', orgId ?? null, filters?.departmentId ?? null, filters?.subDepartmentId ?? null] as const,
  // Prefix that matches every managerBidShifts variant (any org/dept/date scope).
  // Use this for invalidation — passing the full factory key with trailing nulls
  // would over-specify and fail React Query's partial match against dated keys.
  managerBidShiftsRoot: ['shifts', 'managerBids'] as const,
  managerBidShifts: (
    orgId?: string,
    filters?: { departmentId?: string | null; subDepartmentId?: string | null; startDate?: string | null; endDate?: string | null },
  ) =>
    [
      'shifts',
      'managerBids',
      orgId ?? null,
      filters?.departmentId ?? null,
      filters?.subDepartmentId ?? null,
      filters?.startDate ?? null,
      filters?.endDate ?? null,
    ] as const,
  bids: (shiftId: string) => ['shifts', 'bids', shiftId] as const,

  // ── Level 1: lookups — reference / master data ───────────────────────────
  // Lookup data changes rarely; invalidate this family independently.
  lookups: {
    _root: ['shifts', 'lookup'] as const,
    organizations: () => ['shifts', 'lookup', 'organizations'] as const,
    departments: (orgId?: string) =>
      ['shifts', 'lookup', 'departments', orgId ?? null] as const,
    subDepartments: (deptId?: string) =>
      ['shifts', 'lookup', 'subDepartments', deptId ?? null] as const,
    roles: (orgId?: string, deptId?: string, subDeptId?: string) =>
      ['shifts', 'lookup', 'roles', orgId ?? null, deptId ?? null, subDeptId ?? null] as const,
    employees: (
      orgId?: string,
      deptId?: string,
      subDeptId?: string,
      roleId?: string,
      searchTerm?: string,
      limit?: number,
      skills?: string[],
      licenses?: string[],
    ) =>
      [
        'shifts',
        'lookup',
        'employees',
        orgId ?? null,
        deptId ?? null,
        subDeptId ?? null,
        roleId ?? null,
        searchTerm?.trim() || null,
        limit ?? null,
        skills ?? null,
        licenses ?? null,
      ] as const,
    templates: (subDeptId?: string, deptId?: string) =>
      ['shifts', 'lookup', 'templates', subDeptId ?? null, deptId ?? null] as const,
    remunerationLevels: () => ['shifts', 'lookup', 'remunerationLevels'] as const,
    skills: () => ['shifts', 'lookup', 'skills'] as const,
    licenses: () => ['shifts', 'lookup', 'licenses'] as const,
    events: (orgId?: string) =>
      ['shifts', 'lookup', 'events', orgId ?? null] as const,
    rosters: (orgId?: string, filters?: object) =>
      ['shifts', 'lookup', 'rosters', orgId ?? null, filters ?? null] as const,
    rosterStructure: (rosterId?: string) =>
      ['shifts', 'lookup', 'rosterStructure', rosterId ?? null] as const,
  },
} as const;
