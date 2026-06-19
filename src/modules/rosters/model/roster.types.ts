// src/modules/rosters/model/roster.types.ts
import { Employee, Shift } from '@/modules/core/types';
import { computeShiftUrgency, isOnBidding } from '@/modules/rosters/domain/bidding-urgency';

// ============================================================
// ENUMS
// ============================================================

export type RosterDayStatus = 'draft' | 'published' | 'locked';
export type AssignmentStatus =
    | 'assigned'
    | 'confirmed'
    | 'swapped'
    | 'dropped'
    | 'no_show';
export type ApplyMode = 'merge' | 'replace' | 'skip_existing';

// ============================================================
// FILTER TYPES (from roster.d.ts)
// ============================================================

export type FilterCategory =
    | 'employee'
    | 'region'
    | 'location'
    | 'department'
    | 'role'
    | 'area'
    | 'assignment'
    | 'status'
    | 'shiftDefinition'
    | 'employmentType'
    | 'event'
    | 'function'
    | 'shiftType'
    | 'eventType';

export interface FilterOption {
    id: string;
    label: string;
    category: FilterCategory;
}

export interface ShiftWithDetails {
    shift: Shift;
    groupName: string;
    groupColor: string;
    subGroupName: string;
}

export interface ShiftAssignment {
    shiftId: string;
    employeeId: string;
}

// ============================================================
// DATABASE TYPES (snake_case)
// ============================================================

export interface DbRosterDay {
    id: string;
    organization_id: string;
    start_date: string;
    end_date: string;
    status: RosterDayStatus;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    locked_at: string | null;
    locked_by: string | null;
}

export interface DbRosterGroup {
    id: string;
    roster_id: string; // Changed from roster_day_id to match schema
    name: string;
    sort_order: number;
    external_id: string | null; // Added
    created_at: string;
    updated_at: string;
}

export interface DbRosterSubgroup {
    id: string;
    roster_group_id: string;
    name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

// Hierarchy Data Structure (for useRosterStructure)
export interface RosterSubGroupStructure {
    id: string;
    name: string;
    sortOrder: number;
}

export interface RosterGroupStructure {
    id: string;
    name: string;
    externalId: string | null;
    sortOrder: number;
    subGroups: RosterSubGroupStructure[];
}

export interface RosterStructure {
    rosterId: string;
    startDate: string;
    endDate: string;
    groups: RosterGroupStructure[];
    appliedTemplateIds: string[];
}

export interface DbRosterShift {
    id: string;
    roster_subgroup_id: string;
    template_shift_id: string | null;
    name: string | null;
    role_id: string | null;
    role_name: string | null;
    remuneration_level_id: string | null;
    remuneration_level: string | null;
    start_time: string;
    end_time: string;
    paid_break_minutes: number;
    unpaid_break_minutes: number;
    net_hours: number | null;
    required_skills: string[];
    required_licenses: string[];
    site_tags: string[];
    event_tags: string[];
    notes: string | null;
    sort_order: number;
    is_manual: boolean;
    created_at: string;
    updated_at: string;
    assignment_outcome?: 'confirmed' | 'no_show' | null;
}

export interface DbRosterAssignment {
    id: string;

    roster_shift_id: string;
    employee_id: string;
    status: AssignmentStatus;
    assigned_by: string | null;
    assigned_at: string;
    confirmed_at: string | null;
    notes: string | null;
}

export interface DbRosterTemplateApplication {
    id: string;
    template_id: string;
    template_snapshot_id: string | null;
    roster_day_id: string;
    applied_by: string | null;
    applied_at: string;
    mode: ApplyMode;
    shifts_created: number;
    shifts_skipped: number;
}

export interface RosterShiftWithLiveState {
    // Core Roster Data
    id: string;
    roster_subgroup_id: string;
    template_shift_id: string | null;
    name: string | null;
    role_id: string | null;
    role_name: string | null;
    remuneration_level_id: string | null;
    remuneration_level: string | null;
    start_time: string;
    end_time: string;
    paid_break_minutes: number;
    unpaid_break_minutes: number;
    net_hours: number | null;
    required_skills: string[];
    required_licenses: string[];
    site_tags: string[];
    event_tags: string[];
    notes: string | null;
    sort_order: number;
    is_manual: boolean;
    created_at: string;
    updated_at: string;

    // Hierarchy Data
    subgroup_id: string;
    subgroup_name: string;
    group_id: string;
    group_name: string;
    roster_day_id: string;
    shift_start_date: string;
    organization_id: string;
    department_id: string | null;

    // Live State Data (Consolidated)
    lifecycle_status: string;
    bidding_status: string;
    trading_status: string;
    attendance_status: string;
    assignment_outcome: 'confirmed' | 'no_show' | null;
    assigned_employee_id: string | null;
    assignment_status: string;

    // Live Enrichments
    employee_name: string | null;
    employee_avatar: string | null;
    published_to_shift_id: string | null;
    published_at: string | null;
    published_by: string | null;

    // Flags & Metadata
    is_live: boolean;
    is_on_bidding: boolean;
    bidding_open_at: string | null;
    confirmed_at: string | null;
    trade_requested_at: string | null;
    state_id: string | null; // S1-S15
}

// ============================================================
// FRONTEND TYPES (camelCase)
// ============================================================

export interface RosterAssignment {
    id: string;
    employeeId: string;
    employeeName?: string;
    status: AssignmentStatus;
    assignedAt: string;
}

export interface RosterShift {
    id: string;
    templateV8ShiftId: string | null;
    name: string | null;
    roleId: string | null;
    roleName: string | null;
    remunerationLevelId: string | null;
    remunerationLevel: string | null;
    startTime: string;
    endTime: string;
    paidBreakMinutes: number;
    unpaidBreakMinutes: number;
    netHours: number | null;
    skills: string[];
    licenses: string[];
    siteTags: string[];
    eventTags: string[];
    notes: string | null;
    sortOrder: number;
    isManual: boolean;
    isUrgent?: boolean;
    assignment: RosterAssignment | null;
    assignmentOutcome?: 'confirmed' | 'no_show' | null;
}

export interface RosterSubgroup {
    id: string;
    templateSubgroupId: string | null;
    name: string;
    description: string | null;
    sortOrder: number;
    shifts: RosterShift[];
}

export interface RosterGroup {
    id: string;
    name: string;
    color: string;
    icon: string | null;
    sortOrder: number;
    subgroups: RosterSubgroup[];
}

export interface AppliedTemplate {
    templateId: string;
    templateName: string;
    appliedAt: string;
    appliedBy: string | null;
    mode: ApplyMode;
    shiftsCreated: number;
    shiftsSkipped: number;
}

export interface RosterDay {
    id: string;
    organizationId: string;
    startDate: string;
    endDate: string;
    status: RosterDayStatus;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    lockedAt: string | null;
    lockedBy: string | null;
    groups: RosterGroup[];
    appliedTemplates: AppliedTemplate[];
    groupCount: number;
    subgroupCount: number;
    shiftCount: number;
    assignedCount: number;
}

export interface RosterDaySummary {
    startDate: string;
    endDate: string;
    rosterDayId: string | null;
    status: RosterDayStatus;
    shiftCount: number;
    assignedCount: number;
    hasTemplate: boolean;
}

// ============================================================
// RPC RESULT TYPES
// ============================================================

export interface ApplyTemplateResult {
    success: boolean;
    days_processed: number;
    shifts_created: number;
    shifts_skipped: number;
    error_message: string | null;
}

export interface AddShiftResult {
    success: boolean;
    shift_id: string | null;
    error_message: string | null;
}

export interface AssignEmployeeResult {
    success: boolean;
    assignment_id: string | null;
    error_message: string | null;
}

export interface SetStatusResult {
    success: boolean;
    error_message: string | null;
}

// ============================================================
// INPUT TYPES
// ============================================================

export interface NewRosterShift {
    name?: string;
    roleId?: string;
    roleName?: string;
    remunerationLevelId?: string;
    remunerationLevel?: string;
    startTime: string;
    endTime: string;
    paidBreakMinutes?: number;
    unpaidBreakMinutes?: number;
    skills?: string[];
    licenses?: string[];
    siteTags?: string[];
    eventTags?: string[];
    notes?: string;
}

// ============================================================
// GROUPED DATA STRUCTURE (for GroupModeView)
// ============================================================

/** Shift data structured for the GroupModeView grid */
export interface GroupModeShift {
    id: string;
    role: string;
    startTime: string;
    endTime: string;
    employeeName?: string;
    status: 'Open' | 'Assigned' | 'Completed' | 'Draft';
    eventTags?: Array<{ name: string; color: string }>;
    requiredSkills?: string[];
    requiredCertifications?: string[];
    // Link back to roster data
    rosterV8ShiftId?: string;
    isManual?: boolean;
    isUrgent?: boolean;
    assignmentOutcome?: 'confirmed' | 'no_show' | null;
}

/** SubGroup with shifts organized by date */
export interface GroupModeSubGroup {
    id: string;
    name: string;
    shifts: Record<string, GroupModeShift[]>; // key = 'YYYY-MM-DD'
}

/** Department/Group for GroupModeView */
export interface GroupModeDepartment {
    id: string;
    name: string;
    color: string;
    subGroups: GroupModeSubGroup[];
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Convert hex color to color name for GroupModeView
 */
function getGroupColorName(hex: string): string {
    const colorMap: Record<string, string> = {
        '#3b82f6': 'blue',
        '#10b981': 'green',
        '#22c55e': 'green',
        '#ef4444': 'red',
        '#f59e0b': 'orange',
        '#8b5cf6': 'purple',
    };
    return colorMap[hex.toLowerCase()] || 'blue';
}

/**
 * Get group color by name
 */
export function getGroupColor(name: string | null | undefined): string {
    const n = (name || '').toLowerCase();
    if (n.includes('convention')) return 'convention_centre';
    if (n.includes('exhibition')) return 'exhibition_centre';
    if (n.includes('theatre')) return 'theatre';
    return 'default_yellow';
}

/**
 * Convert DB roster day view to frontend format
 */
export function dbRosterDayToFrontend(db: any): RosterDay {
    return {
        id: db.id,
        organizationId: db.organization_id,
        startDate: db.start_date,
        endDate: db.end_date,
        status: db.status,
        notes: db.notes,
        createdAt: db.created_at,
        updatedAt: db.updated_at,
        lockedAt: db.locked_at,
        lockedBy: db.locked_by,
        groups: (db.groups || []).map((g: any) => ({
            id: g.id,
            name: g.name,
            color: g.color,
            icon: g.icon,
            sortOrder: g.sortOrder,
            subgroups: (g.subgroups || []).map((sg: any) => ({
                id: sg.id,
                templateSubgroupId: sg.templateSubgroupId,
                name: sg.name,
                description: sg.description,
                sortOrder: sg.sortOrder,
                shifts: (sg.shifts || []).map((sh: any) => ({
                    id: sh.id,
                    templateV8ShiftId: sh.templateV8ShiftId,
                    name: sh.name,
                    roleId: sh.roleId,
                    roleName: sh.roleName,
                    remunerationLevelId: sh.remunerationLevelId,
                    remunerationLevel: sh.remunerationLevel,
                    startTime: sh.startTime,
                    endTime: sh.endTime,
                    paidBreakMinutes: sh.paidBreakMinutes || 0,
                    unpaidBreakMinutes: sh.unpaidBreakMinutes || 0,
                    netHours: sh.netHours,
                    skills: sh.skills || [],
                    licenses: sh.licenses || [],
                    siteTags: sh.siteTags || [],
                    eventTags: sh.eventTags || [],
                    notes: sh.notes,
                    sortOrder: sh.sortOrder,
                    isManual: sh.isManual || false,
                    isUrgent: sh.isUrgent || false,
                    assignmentOutcome: sh.assignment_outcome || sh.assignmentOutcome,
                    assignment: sh.assignment
                        ? {
                            id: sh.assignment.id,
                            employeeId: sh.assignment.employeeId || sh.assignment.employee_id || sh.assignment.assigned_employee_id,
                            employeeName: sh.assignment.employeeName,
                            status: sh.assignment.status,
                            assignedAt: sh.assignment.assignedAt,
                        }
                        : null,
                })),
            })),
        })),
        appliedTemplates: (db.applied_templates || []).map((at: any) => ({
            templateId: at.templateId,
            templateName: at.templateName,
            appliedAt: at.appliedAt,
            appliedBy: at.appliedBy,
            mode: at.mode,
            shiftsCreated: at.shiftsCreated,
            shiftsSkipped: at.shiftsSkipped,
        })),
        groupCount: db.group_count || 0,
        subgroupCount: db.subgroup_count || 0,
        shiftCount: db.shift_count || 0,
        assignedCount: db.assigned_count || 0,
    };
}

/**
 * Convert roster day summary from RPC
 */
export function dbRosterDaySummaryToFrontend(db: any): RosterDaySummary {
    return {
        startDate: db.start_date,
        endDate: db.end_date,
        rosterDayId: db.roster_day_id,
        status: db.status || 'draft',
        shiftCount: Number(db.shift_count) || 0,
        assignedCount: Number(db.assigned_count) || 0,
        hasTemplate: db.has_template || false,
    };
}

/**
 * Convert RosterDay to GroupModeDepartment[] for GroupModeView
 */
export function rosterDayToGroupMode(
    rosterDay: RosterDay,
    dateKey: string
): GroupModeDepartment[] {
    return rosterDay.groups.map((group) => ({
        id: group.id,
        name: group.name,
        color: getGroupColorName(group.color),
        subGroups: group.subgroups.map((sg) => ({
            id: sg.id,
            name: sg.name,
            shifts: {
                [dateKey]: sg.shifts.map((shift) => ({
                    id: shift.id,
                    role: shift.roleName || shift.name || 'Shift',
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    employeeName: shift.assignment?.employeeName,
                    status: shift.assignment ? 'Assigned' : ('Open' as const),
                    assignmentOutcome: shift.assignmentOutcome,
                    eventTags:
                        shift.eventTags?.map((tag) => ({ name: tag, color: '#3B82F6' })) ||
                        [],
                    requiredSkills: shift.skills || [],
                    requiredCertifications: shift.licenses || [],
                    rosterV8ShiftId: shift.id,
                    isManual: shift.isManual,
                    isUrgent: shift.isUrgent,
                })),
            },
        })),
    }));
}

/**
 * Merge multiple RosterDays into GroupModeDepartment[] for multi-day view
 */
export function mergeRosterDaysToGroupMode(
    rosterDays: RosterDay[]
): GroupModeDepartment[] {
    if (rosterDays.length === 0) return [];

    // Use first day as template for structure
    const firstDay = rosterDays[0];

    return firstDay.groups.map((group) => {
        const subGroups: GroupModeSubGroup[] = group.subgroups.map((sg) => {
            const shifts: Record<string, GroupModeShift[]> = {};

            for (const day of rosterDays) {
                const dateKey = day.startDate;
                const matchingGroup = day.groups.find((g) => g.name === group.name);
                const matchingSubgroup = matchingGroup?.subgroups.find(
                    (s) => s.name === sg.name
                );

                if (matchingSubgroup) {
                    shifts[dateKey] = matchingSubgroup.shifts.map((shift) => ({
                        id: shift.id,
                        role: shift.roleName || shift.name || 'Shift',
                        startTime: shift.startTime,
                        endTime: shift.endTime,
                        employeeName: shift.assignment?.employeeName,
                        status: shift.assignment ? 'Assigned' : ('Open' as const),
                        assignmentOutcome: shift.assignmentOutcome,
                        eventTags:
                            shift.eventTags?.map((tag) => ({
                                name: tag,
                                color: '#3B82F6',
                            })) || [],
                        requiredSkills: shift.skills || [],
                        requiredCertifications: shift.licenses || [],
                        rosterV8ShiftId: shift.id,
                        isManual: shift.isManual,
                    }));
                } else {
                    shifts[dateKey] = [];
                }
            }

            return {
                id: sg.id,
                name: sg.name,
                shifts,
            };
        });

        return {
            id: group.id,
            name: group.name,
            color: getGroupColorName(group.color),
            subGroups,
        };
    });
}

/**
 * Convert flattened view data (v_roster_shifts_with_live_state) to Frontend RosterDay
 * grouping it by Day -> Group -> SubGroup
 */
export function flatRosterShiftsToRosterDay(
    flatShifts: RosterShiftWithLiveState[],
    dateStr: string,
    organizationId: string
): RosterDay {
    if (!flatShifts.length) {
        return {
            id: 'virtual-' + dateStr,
            organizationId,
            startDate: dateStr,
            endDate: dateStr,
            status: 'draft', // default
            notes: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lockedAt: null,
            lockedBy: null,
            groups: [],
            appliedTemplates: [],
            groupCount: 0,
            subgroupCount: 0,
            shiftCount: 0,
            assignedCount: 0,
        };
    }

    const first = flatShifts[0];

    // 1. Group by Roster Group ID
    const groupsMap = new Map<string, any>();

    flatShifts.forEach(item => {
        if (!groupsMap.has(item.group_id)) {
            groupsMap.set(item.group_id, {
                id: item.group_id,
                name: item.group_name,
                color: 'blue', // default if not in view (view needs color column upgrade if missing)
                icon: null,
                sortOrder: 0, // default
                subgroupsMap: new Map<string, any>()
            });
        }

        const group = groupsMap.get(item.group_id);

        if (!group.subgroupsMap.has(item.subgroup_id)) {
            group.subgroupsMap.set(item.subgroup_id, {
                id: item.subgroup_id,
                templateSubgroupId: null,
                name: item.subgroup_name,
                description: null,
                sortOrder: 0,
                shifts: []
            });
        }

        const subgroup = group.subgroupsMap.get(item.subgroup_id);

        // Map Shift to Frontend Format
        subgroup.shifts.push({
            id: item.id,
            templateV8ShiftId: item.template_shift_id,
            name: item.name,
            roleId: item.role_id,
            roleName: item.role_name,
            remunerationLevelId: item.remuneration_level_id,
            remunerationLevel: item.remuneration_level,
            startTime: item.start_time,
            endTime: item.end_time,
            paidBreakMinutes: item.paid_break_minutes,
            unpaidBreakMinutes: item.unpaid_break_minutes,
            netHours: item.net_hours,
            skills: item.required_skills || [],
            licenses: item.required_licenses || [],
            siteTags: item.site_tags || [],
            eventTags: item.event_tags || [],
            notes: item.notes,
            sortOrder: item.sort_order,
            isManual: item.is_manual,

            // Live State Mappings
            assignmentOutcome: item.assignment_outcome,
            lifecycleStatus: item.lifecycle_status,
            biddingStatus: item.bidding_status,
            isLive: item.is_live,
            isOnBidding: item.is_on_bidding,
            // Urgency is derived from time-to-start at read time (no persisted is_urgent column)
            isUrgent: isOnBidding(item.bidding_status) && computeShiftUrgency(item.shift_start_date, item.start_time) === 'urgent',
            stateId: item.state_id,

            assignment: item.assigned_employee_id
                ? {
                    id: 'live-' + item.id, // virtual ID from shift
                    employeeId: item.assigned_employee_id,
                    employeeName: item.employee_name,
                    status: item.assignment_status,
                    assignedAt: item.confirmed_at || item.published_at, // best guess
                }
                : null,
        });
    });

    // 2. Convert Maps to Arrays
    const groups = Array.from(groupsMap.values()).map(g => ({
        ...g,
        subgroups: Array.from(g.subgroupsMap.values())
    }));

    return {
        id: first.roster_day_id,
        organizationId: first.organization_id,
        startDate: first.shift_start_date,
        endDate: first.shift_start_date,
        status: 'published', // effectively published if pulling from live view
        notes: null,
        createdAt: first.created_at,
        updatedAt: first.updated_at,
        lockedAt: null,
        lockedBy: null,
        groups: groups,
        appliedTemplates: [],
        groupCount: groups.length,
        subgroupCount: 0,
        shiftCount: flatShifts.length,
        assignedCount: flatShifts.filter(s => s.assigned_employee_id).length,
    };
}

/**
 * Convert Date object to YYYY-MM-DD string
 */
export function toDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
