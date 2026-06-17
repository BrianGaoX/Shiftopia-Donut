/**
 * Roster Projection Engine — Canonical Output Types
 *
 * ALL roster view types live here. No mode-specific file may redeclare
 * interfaces for shifts, groups, roles, or employees — import from here.
 *
 * Design contract:
 *  - ProjectedShift is the atomic unit consumed by every SmartShiftCard /
 *    ShiftCardCompact render. It carries everything needed for display plus
 *    a `raw` escape-hatch for DnD drag items and legacy mutation calls.
 *  - Projector output types (GroupProjection etc.) are immutable snapshots.
 *    Mutating them in UI is a bug — fire a Zustand action or TanStack mutation
 *    instead.
 */

import type { Shift, TemplateGroupType } from '../shift.entity';
import type { ShiftStateID } from '../shift-state.utils';
import type { CoverageHealth } from './utils/coverage';
import type { ShiftCostBreakdown } from './utils/cost/types';

// ── Styling token set (lives in constants.ts, typed here) ─────────────────────

export interface GroupColorSet {
  /** Tailwind classes for the shift card background + hover */
  card:          string;
  /** Left border colour class for shift cards */
  cardBorder:    string;
  /** Badge classes (light bg, coloured text) */
  badge:         string;
  /** Plain colour name — used for icon fills and inline style props */
  accent:        string;
  /** Ring class shown on valid DnD drop target */
  dndHighlight:  string;
  /** Glassmorphism container for the group section */
  glassContainer: string;
  /** Glassmorphism header gradient for the group section */
  glassHeader:    string;
}

// ── Atomic projected shift ────────────────────────────────────────────────────

export interface ProjectedShift {
  /** Shift row PK */
  id:              string;
  /** Stable React key — safe to use directly as `key` prop */
  reactKey:        string;
  /** ISO date string YYYY-MM-DD */
  date:            string;
  startTime:       string;
  endTime:         string;

  // Timing & cost (derived from net_length_minutes / remuneration_rate)
  netMinutes:      number;
  estimatedCost:   number;
  costBreakdown: {
    base: number;
    penalty: number;
    overtime: number;
    allowance: number;
    leave: number;
  };
  /**
   * Full ICC EA cost breakdown — pre-computed once at projection time so the
   * UI doesn't re-run the payroll engine for every card on every render.
   */
  detailedCost:    ShiftCostBreakdown;

  // Domain classification
  stateId:         ShiftStateID;
  roleName:        string;
  roleId:          string | null;
  levelName:       string;
  levelNumber:     number;
  levelId:         string | null;

  // Grouping context
  groupType:       TemplateGroupType | null;
  subGroupName:    string | null;
  groupColors:     GroupColorSet;

  // Assignment
  employeeName:    string | null;
  employeeId:      string | null;

  // Status flags — derived so consumers never re-derive
  isLocked:        boolean;
  isUrgent:        boolean;
  isOnBidding:     boolean;
  isTrading:       boolean;
  isCancelled:     boolean;
  isPublished:     boolean;
  isDraft:         boolean;

  // Legacy UI compatibility fields (computed once in projector)
  role:            string;
  hours:           number;
  pay:             number;
  status:          'Open' | 'Assigned' | 'Completed' | 'Draft';
  lifecycleStatus: 'draft' | 'published';
  assignmentStatus: 'assigned' | 'unassigned';
  fulfillmentStatus: 'scheduled' | 'bidding' | 'offered' | 'none';

  /**
   * Escape hatch: the raw Supabase `Shift` row.
   * Use only for:
   *   - SmartShiftCard / ShiftCardCompact (which accept the full Shift)
   *   - DnD drag-item construction
   *   - Mutation call arguments (useDeleteShift, useUpdateShift, …)
   * Do NOT read `raw.*` fields for display logic — use the typed fields above.
   */
  raw:             Shift;
}

// ── Shared statistics bag ─────────────────────────────────────────────────────

export interface ProjectionStats {
  totalShifts:      number;
  assignedShifts:   number;
  openShifts:       number;
  publishedShifts:  number;
  /** Sum of net_length_minutes across all non-cancelled shifts */
  totalNetMinutes:  number;
  /** Estimated labour cost at remuneration_rate */
  estimatedCost:    number;
  costBreakdown: {
    base: number;
    penalty: number;
    overtime: number;
    allowance: number;
    leave: number;
  };
}

// ── Group mode ─────────────────────────────────────────────────────────────────

export interface SubGroupStats {
  totalShifts:    number;
  assignedShifts: number;
  totalHours:     number;
  estimatedCost:  number;
  costBreakdown: {
    base: number;
    penalty: number;
    overtime: number;
    allowance: number;
    leave: number;
  };
}

export interface GroupStats extends SubGroupStats {
  subGroupCount: number;
}

export interface ProjectedSubGroup {
  id:           string;
  name:         string;
  /** Keyed by ISO date string YYYY-MM-DD */
  shiftsByDate: Record<string, ProjectedShift[]>;
  coverage:     CoverageHealth;
  stats:        SubGroupStats;
}

export interface ProjectedGroup {
  id:         string;
  name:       string;
  type:       TemplateGroupType | 'unassigned';
  colors:     GroupColorSet;
  subGroups:  ProjectedSubGroup[];
  stats:      GroupStats;
}

export interface GroupProjection {
  groups: ProjectedGroup[];
  stats:  ProjectionStats;
}

// ── Roles mode ────────────────────────────────────────────────────────────────

export interface ProjectedRole {
  id:           string;
  name:         string;
  code:         string;
  /** Keyed by ISO date string YYYY-MM-DD */
  shiftsByDate: Record<string, ProjectedShift[]>;
  totalHours:   number;
  totalCost:    number;
}

export interface ProjectedLevel {
  id:           string;
  name:         string;
  levelNumber:  number;
  /** Tailwind classes — from levelColorClass() in constants.ts */
  colorClass:   string;
  roles:        ProjectedRole[];
  totalHours:   number;
  totalCost:    number;
}

export interface RolesProjection {
  levels:         ProjectedLevel[];
  /** Roles with no remuneration_level_id */
  unassignedRoles: ProjectedRole[];
  stats:          ProjectionStats;
}

// ── People mode ───────────────────────────────────────────────────────────────

export interface ProjectedEmployee {
  id:               string;
  name:             string;
  avatar:           string;
  /** Weekly contracted hours (e.g. 38) — the raw contract rate. */
  contractedHours:  number;
  /** Contracted hours scaled to the visible period (week, month, …). The
   *  denominator behind `utilization`, so the displayed "Xh / Yh" fraction and
   *  the UTL % always agree. */
  periodContractedHours: number;
  /** Hours scheduled in the current view window */
  currentHours:     number;
  /** true when scheduledHours > contractedHours */
  overHoursWarning: boolean;
  /** Keyed by ISO date string YYYY-MM-DD */
  shifts:           Record<string, ProjectedShift[]>;
  /** Derived statistics for the employee window */
  estimatedPay:     number;
  fatigueScore:     number;
  utilization:      number;
  payBreakdown: {
    base:      number;
    penalty:   number;
    overtime:  number;
    allowance: number;
    leave:     number;
  };
}

export interface PeopleProjection {
  /** Employees with at least one shift in the window, plus the unassigned bucket */
  employees: ProjectedEmployee[];
  stats:     ProjectionStats;
}

// ── Events mode ───────────────────────────────────────────────────────────────

export interface ProjectedEvent {
  eventId:       string;
  eventName:     string;
  /** ISO date string YYYY-MM-DD, null for the catch-all "no event" bucket */
  eventDate:     string | null;
  startTime:     string;
  endTime:       string;
  location:      string;
  shifts:        ProjectedShift[];
  totalHours:    number;
  assignedCount: number;
  totalCount:    number;
  coverage:      CoverageHealth;
}

export interface EventsProjection {
  events: ProjectedEvent[];
  stats:  ProjectionStats;
}

// ── External entity records passed into projectors ────────────────────────────
// Minimal shapes: compatible with what useRoles / useRemunerationLevels /
// useEmployees / useEvents return.

export interface RoleRecord {
  id:                     string;
  name:                   string;
  code?:                  string | null;
  remuneration_level_id?: string | null;
  forecasting_bucket?:    'static' | 'semi_dynamic' | 'dynamic' | null;
  supervision_ratio_min?: number | null;
  supervision_ratio_max?: number | null;
  is_baseline_eligible?:  boolean;
}

export interface LevelRecord {
  id:           string;
  level_name:   string;
  level_number: number;
}

export interface EmployeeRecord {
  id:           string;
  first_name?:  string | null;
  last_name?:   string | null;
  /** Weekly contracted hours (e.g. 38). Sourced from the active user contract. */
  contracted_weekly_hours?: number | null;
}

export interface EventRecord {
  id:          string;
  name:        string;
  event_date?: string | null;
  start_time?: string | null;
  end_time?:   string | null;
  location?:   string | null;
}

// ── Unified hook input / output ───────────────────────────────────────────────

export interface ProjectionInput {
  shifts:            Shift[];
  employees?:        EmployeeRecord[];
  roles?:            RoleRecord[];
  levels?:           LevelRecord[];
  events?:           EventRecord[];
  /** Passed from useRosterStructure — gives group/subgroup skeleton for GroupMode */
  rosterStructures?: import('../../model/roster.types').RosterStructure[];
}

export interface ProjectionResult {
  activeMode: import('../../state/useRosterStore').RosterMode;
  group:      GroupProjection  | null;
  roles:      RolesProjection  | null;
  people:     PeopleProjection | null;
  events:     EventsProjection | null;
  /** Always computed regardless of active mode */
  stats:      ProjectionStats;
}
