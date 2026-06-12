/**
 * Get Groups Mode Grid Query
 * Domain layer - builds the visual grid structure from shifts
 * 
 * This moves business logic (grouping, status derivation) out of UI
 */

import { Shift, TemplateGroupType, shiftsApi } from '@/modules/rosters/api/shifts.api';
import { format } from 'date-fns';

/* ============================================================
   TYPES
   ============================================================ */

export interface VisualGroup {
    id: string;
    name: string;
    type: TemplateGroupType;
    color: string;
    subGroups: VisualSubGroup[];
}

export interface VisualSubGroup {
    id: string;
    name: string;
    shifts: Record<string, ShiftDisplay[]>;
}

export interface ShiftDisplay {
    id: string;
    role: string;
    startTime: string;
    endTime: string;
    employeeName?: string;
    status: 'Open' | 'Assigned' | 'Completed' | 'Draft' | 'Published';
    isPublished: boolean;
    isDraft: boolean;
    isOnBidding: boolean;
    isCancelled: boolean;
    rawShift: Shift;
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const DEFAULT_SUB_GROUPS = ['AM Base', 'PM Base', 'Evening'];

const GROUP_COLORS: Record<TemplateGroupType, string> = {
    convention_centre: 'blue',
    exhibition_centre: 'emerald',
    theatre: 'red',
    the_cutaway: 'amber',
};

/* ============================================================
   BUSINESS LOGIC
   ============================================================ */

/**
 * Derive shift display status from raw shift data
 */
function getShiftStatus(shift: Shift): ShiftDisplay['status'] {
    if (shift.is_published) return 'Published';
    if (shift.is_draft) return 'Draft';
    if (shift.assigned_employee_id) return 'Assigned';
    return 'Open';
}

/**
 * Build visual groups from raw shifts
 * This is the core grouping logic, moved from UI
 */
export function buildGroupsModeGrid(
    shifts: Shift[],
    subDepartmentId?: string
): VisualGroup[] {
    const groupMap = new Map<TemplateGroupType, Map<string, Shift[]>>();

    // Initialize all group types
    (['convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway'] as TemplateGroupType[]).forEach(
        (type) => {
            groupMap.set(type, new Map());
        }
    );

    // Group shifts by type and sub-group
    shifts.forEach((shift) => {
        // Filter by sub-department if specified
        if (subDepartmentId && shift.sub_department_id !== subDepartmentId) {
            return;
        }

        const groupType = shift.group_type || 'convention_centre';
        const subGroupName = shift.sub_group_name || 'General';

        if (!groupMap.has(groupType)) {
            groupMap.set(groupType, new Map());
        }

        const subGroupMap = groupMap.get(groupType)!;
        if (!subGroupMap.has(subGroupName)) {
            subGroupMap.set(subGroupName, []);
        }
        subGroupMap.get(subGroupName)!.push(shift);
    });

    // Build visual structure
    const visualGroups: VisualGroup[] = [];

    groupMap.forEach((subGroupMap, groupType) => {
        const subGroups: VisualSubGroup[] = [];

        subGroupMap.forEach((groupShifts, subGroupName) => {
            const shiftsByDate: Record<string, ShiftDisplay[]> = {};

            groupShifts.forEach((shift) => {
                const dateKey = shift.shift_date;
                if (!shiftsByDate[dateKey]) {
                    shiftsByDate[dateKey] = [];
                }

                shiftsByDate[dateKey].push({
                    id: shift.id,
                    role: (shift as any).roles?.name || 'Shift',
                    startTime: shift.start_time,
                    endTime: shift.end_time,
                    employeeName: shift.assigned_employee_id ? 'Assigned' : undefined,
                    status: getShiftStatus(shift),
                    isPublished: shift.is_published,
                    isDraft: shift.is_draft,
                    isOnBidding: shift.is_on_bidding,
                    isCancelled: shift.is_cancelled,
                    rawShift: shift,
                });
            });

            subGroups.push({
                id: `${groupType}-${subGroupName}`,
                name: subGroupName,
                shifts: shiftsByDate,
            });
        });

        // Add default sub-groups if none exist
        if (subGroups.length === 0) {
            DEFAULT_SUB_GROUPS.forEach((name) => {
                subGroups.push({
                    id: `${groupType}-${name}`,
                    name,
                    shifts: {},
                });
            });
        }

        visualGroups.push({
            id: groupType,
            name: groupType === 'convention_centre' ? 'Convention Centre' :
                groupType === 'exhibition_centre' ? 'Exhibition Centre' :
                    groupType === 'the_cutaway' ? 'The Cutaway' : 'Theatre',
            type: groupType,
            color: GROUP_COLORS[groupType],
            subGroups,
        });
    });

    return visualGroups;
}

/**
 * Get default empty groups structure
 */
export function getDefaultGroups(): VisualGroup[] {
    return (['convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway'] as TemplateGroupType[]).map(
        (type) => ({
            id: type,
            name: type === 'convention_centre' ? 'Convention Centre' :
                type === 'exhibition_centre' ? 'Exhibition Centre' :
                    type === 'the_cutaway' ? 'The Cutaway' : 'Theatre',
            type,
            color: GROUP_COLORS[type],
            subGroups: DEFAULT_SUB_GROUPS.map((name) => ({
                id: `${type}-${name}`,
                name,
                shifts: {},
            })),
        })
    );
}

/**
 * Fetch shifts for multiple dates and build the grid
 * This encapsulates the data fetching loop + transformer
 */
export async function fetchGroupsModeGrid(
    organizationId: string,
    dates: Date[],
    departmentId?: string,
    subDepartmentId?: string
): Promise<{ visualGroups: VisualGroup[]; allShifts: Shift[] }> {
    const allShifts: Shift[] = [];

    // Fetch shifts for each date in parallel
    const promises = dates.map(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return shiftsApi.getShiftsForDate(
            organizationId,
            dateStr,
            {
                departmentId: departmentId || undefined,
                subDepartmentId: subDepartmentId || undefined
            }
        );
    });

    const results = await Promise.all(promises);
    results.forEach(dayShifts => allShifts.push(...dayShifts));

    // Build the visual grid
    const visualGroups = buildGroupsModeGrid(allShifts, subDepartmentId);

    return { visualGroups, allShifts };
}
