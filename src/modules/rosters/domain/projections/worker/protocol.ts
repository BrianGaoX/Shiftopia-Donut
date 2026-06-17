/**
 * Projection Worker Protocol — DTOs & Message Types
 *
 * This file defines the ENTIRE communication boundary between the main thread
 * and the projection worker. It is the single source of truth for:
 *
 *   1. Worker Shift / Employee / Filter DTOs (minimal, serialisation-safe)
 *   2. Request and Result message envelopes (with requestId for versioning)
 *   3. Projection modes
 *
 * Design principles:
 *   - NO raw Shift entities cross the worker boundary — only DTOs.
 *   - Every request carries a monotonic `requestId` so stale results are
 *     discarded without ambiguity.
 *   - DTOs use numeric timestamps (epoch ms) instead of ISO strings to avoid
 *     Date parsing overhead inside the worker.
 *   - The protocol is worker-agnostic: the same types are consumed by
 *     `runProjectionPipeline()` whether it runs in a worker, on the server,
 *     or in a test harness.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * IMPORTANT: This file must NEVER import from React, Zustand, Supabase,
 * or any module that touches the DOM / window / localStorage.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { TemplateGroupType } from '../../shift.entity';
import type { ShiftCostBreakdown } from '../utils/cost/types';

// ── Projection Modes ──────────────────────────────────────────────────────────

export type ProjectionMode = 'group' | 'people' | 'events' | 'roles';

// ── Worker DTOs (Main Thread → Worker) ────────────────────────────────────────

/**
 * Minimal shift representation sent to the worker.
 * Contains ONLY the fields consumed by projectors + the cost engine.
 * ~40 fields vs ~120+ on the raw Shift entity = ~65% payload reduction.
 */
export interface WorkerShiftDTO {
  id: string;
  /** epoch ms of shift.updated_at — used as cache key component */
  updatedAtMs: number;

  // ── Temporal ──
  shiftDate: string;        // YYYY-MM-DD
  startTime: string;        // HH:MM or HH:MM:SS
  endTime: string;          // HH:MM or HH:MM:SS
  isOvernight: boolean;
  scheduledLengthMinutes: number;
  netLengthMinutes: number | null;
  unpaidBreakMinutes: number;
  paidBreakMinutes: number;

  // ── Assignment ──
  assignedEmployeeId: string | null;
  assignmentStatus: string | null;
  assignmentOutcome: string | null;

  // ── Lifecycle ──
  lifecycleStatus: string;
  isCancelled: boolean;
  isLocked: boolean;
  isPublished: boolean;
  isDraft: boolean;

  // ── Bidding / Trading ──
  biddingStatus: string;
  tradeRequestedAt: string | null;
  tradingStatus: string | null;

  // ── Organisational ──
  organizationId: string | null;
  departmentId: string;
  subDepartmentId: string | null;
  roleId: string | null;
  roleName: string | null;
  remunerationLevelId: string | null;
  remunerationRate: number | null;
  actualHourlyRate: number | null;

  // ── Level info (denormalised from join) ──
  levelName: string | null;
  levelNumber: number | null;

  // ── Group / Subgroup ──
  groupType: TemplateGroupType | null;
  subGroupName: string | null;

  // ── Employee profile (denormalised from join) ──
  employeeFirstName: string | null;
  employeeLastName: string | null;

  // ── Events ──
  eventIds: string[];

  // ── Cost engine inputs ──
  targetEmploymentType: string | null;
  allowances: {
    meal?: boolean;
    firstAid?: boolean;
    proteinSpill?: boolean;
    splitShift?: boolean;
  } | null;
  isAnnualLeave?: boolean;
  isPersonalLeave?: boolean;
  isCarerLeave?: boolean;
  previousWage?: number;

  // ── Roster structure ──
  rosterSubgroupId: string | null;
  rosterSubgroupName: string | null;
  rosterGroupName: string | null;
  rosterGroupExternalId: string | null;

  // ── Display ──
  displayOrder: number;
  notes: string | null;

  // ── UTC-at-rest ──
  startAt: string | null;
  endAt: string | null;

  // ── Fulfillment ──
  fulfillmentStatus: string;

  // ── Required skills (for filtering) ──
  requiredSkills: string[];
}

/**
 * Minimal employee representation sent to the worker.
 */
export interface WorkerEmployeeDTO {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Weekly contracted hours (e.g. 38). Scaled to the visible period downstream. */
  contractedHours?: number;
}

/**
 * Role record DTO — mirrors RoleRecord but camelCased.
 */
export interface WorkerRoleDTO {
  id: string;
  name: string;
  code: string | null;
  remunerationLevelId: string | null;
}

/**
 * Level record DTO — mirrors LevelRecord but camelCased.
 */
export interface WorkerLevelDTO {
  id: string;
  levelName: string;
  levelNumber: number;
}

/**
 * Event record DTO — mirrors EventRecord but camelCased.
 */
export interface WorkerEventDTO {
  id: string;
  name: string;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
}

/**
 * Roster structure DTO — minimal group/subgroup skeleton for GroupMode.
 */
export interface WorkerRosterStructureDTO {
  groups: {
    externalId: string;
    name: string;
    subGroups: {
      id: string;
      name: string;
      sortOrder: number;
    }[];
  }[];
}

/**
 * Advanced filter state — mirrors AdvancedFilters from useRosterStore
 * but is fully serialisation-safe (no Set, no Function).
 */
export interface WorkerFilterDTO {
  roleId: string | null;
  skillIds: string[];
  lifecycleStatus: string;
  assignmentStatus: string;
  assignmentOutcome: string;
  biddingStatus: string;
  tradingStatus: string;
  stateId: string | null;
  searchQuery: string;
}

// ── Request Envelope (Main Thread → Worker) ───────────────────────────────────

export interface ProjectionRequest {
  /** Monotonic sequence number. Worker discards results for stale requestIds. */
  requestId: number;

  /** Which projector to run. */
  mode: ProjectionMode;

  /** The shift data to project. */
  shifts: WorkerShiftDTO[];

  /** Employee records (required for 'people' mode, optional for others). */
  employees: WorkerEmployeeDTO[];

  /** Role records (required for 'roles' mode). */
  roles: WorkerRoleDTO[];

  /** Remuneration level records (required for 'roles' mode). */
  levels: WorkerLevelDTO[];

  /** Event records (required for 'events' mode). */
  events: WorkerEventDTO[];

  /** Roster structure skeleton (required for 'group' mode). */
  rosterStructures: WorkerRosterStructureDTO[];

  /** Filters to apply before projection. */
  filters: WorkerFilterDTO;

  /** Current date ISO string for fatigue windows etc. */
  nowIso: string;

  /**
   * Number of calendar days in the visible range (Day=1, Week=7, Month=28-31).
   * Used to scale weekly contracted hours to the period for utilization.
   * Optional — helpers default to a 7-day window when absent.
   */
  rangeDays?: number;
}

// ── Result Envelope (Worker → Main Thread) ─────────────────────────────────────

/**
 * Projected shift result — fully computed, ready for React rendering.
 * Includes the shift ID so the main thread can map it back to the raw Shift
 * for DnD / mutation operations.
 */
export interface ProjectedShiftResult {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  netMinutes: number;
  /** Unpaid break minutes — retained so fatigue can be recomputed post-merge.
   *  Only the people projector populates it; optional for other modes. */
  unpaidBreakMinutes?: number;
  estimatedCost: number;
  costBreakdown: {
    base: number;
    penalty: number;
    overtime: number;
    allowance: number;
    leave: number;
  };
  detailedCost: ShiftCostBreakdown;
  stateId: string;
  roleName: string;
  roleId: string | null;
  levelName: string;
  levelNumber: number;
  levelId: string | null;
  groupType: TemplateGroupType | null;
  subGroupName: string | null;
  groupColorKey: string; // 'convention_centre' | 'exhibition_centre' | 'theatre' | 'unassigned'
  employeeName: string | null;
  employeeId: string | null;
  isLocked: boolean;
  isUrgent: boolean;
  isOnBidding: boolean;
  isTrading: boolean;
  isCancelled: boolean;
  isPublished: boolean;
  isDraft: boolean;
  // Legacy compat
  role: string;
  hours: number;
  pay: number;
  status: 'Open' | 'Assigned' | 'Completed' | 'Draft';
  lifecycleStatus: 'draft' | 'published';
  assignmentStatus: 'assigned' | 'unassigned';
  fulfillmentStatus: string;
}

/**
 * Stats bag — identical to ProjectionStats but lives in the protocol.
 */
export interface ProjectionStatsResult {
  totalShifts: number;
  assignedShifts: number;
  openShifts: number;
  publishedShifts: number;
  totalNetMinutes: number;
  estimatedCost: number;
  costBreakdown: {
    base: number;
    penalty: number;
    overtime: number;
    allowance: number;
    leave: number;
  };
}

/**
 * The result envelope. The `data` field is mode-specific.
 * The main thread uses `requestId` to discard stale results.
 */
export interface ProjectionResult {
  /** Must match the requestId from the corresponding ProjectionRequest. */
  requestId: number;

  /** Wall-clock ms the projection took inside the worker. */
  durationMs: number;

  /** The mode that was projected. */
  mode: ProjectionMode;

  /** Top-level stats (always present regardless of mode). */
  stats: ProjectionStatsResult;

  /** Mode-specific projection output. Exactly one of these is non-null. */
  group: any | null;   // GroupProjection shape
  people: any | null;  // PeopleProjection shape
  events: any | null;  // EventsProjection shape
  roles: any | null;   // RolesProjection shape
}

// ── Worker Message Types ──────────────────────────────────────────────────────

export type WorkerInboundMessage =
  | { type: 'project'; payload: ProjectionRequest }
  | { type: 'cancel';  payload: { requestId: number } };

export type WorkerOutboundMessage =
  | { type: 'result'; payload: ProjectionResult }
  | { type: 'error';  payload: { requestId: number; message: string } };
