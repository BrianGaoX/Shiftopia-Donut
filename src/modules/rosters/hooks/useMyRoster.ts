
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { useAuth } from '@/modules/auth/hooks/useAuth';
import { CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { Shift, doesShiftTrulyCrossMidnight } from '@/modules/rosters/domain/shift.entity';
import { getDepartmentColor } from '@/modules/core/lib/utils';

interface ShiftWithDetails {
    shift: Shift;
    groupName: string;
    groupColor: string;
    subGroupName: string;
}

import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

import { ScopeSelection } from '@/platform/auth/types';

export const useMyRoster = (view: CalendarView, selectedDate: Date, scope?: ScopeSelection | null) => {
    const { user } = useAuth();
    // We still use orgSelection for legacy/fallback context if needed, but scope takes precedence for filtering
    const { organizationId, departmentId, subDepartmentId } = useOrgSelection();

    // Calculate date range based on the view
    const calculateDateRange = () => {
        let start: Date;
        let end: Date;

        if (view === 'day') {
            start = selectedDate;
            end = selectedDate;
        } else if (view === '3day') {
            start = selectedDate;
            end = addDays(selectedDate, 2);
        } else if (view === 'week') {
            start = startOfWeek(selectedDate, { weekStartsOn: 1 });
            end = endOfWeek(selectedDate, { weekStartsOn: 1 });
        } else if (view === 'month') {
            start = startOfMonth(selectedDate);
            end = endOfMonth(selectedDate);
        } else {
            start = selectedDate;
            end = selectedDate;
        }

        return { start, end };
    };

    // Update date range when view or selectedDate changes
    const { start: rawStart, end } = calculateDateRange();
    
    // Buffer for overnight shifts (catch shifts starting day before but ending today)
    const start = subDays(rawStart, 1);
    
    const startDateStr = format(start, 'yyyy-MM-dd');
    const endDateStr = format(end, 'yyyy-MM-dd');

    // Fetch shifts for the date range using unified keys
    const { data: shifts = [], isLoading, error } = useQuery({
        // Use the centralized query key factory
        queryKey: shiftKeys.byEmployee(user?.id || '', startDateStr, endDateStr),
        queryFn: async () => {
            if (!user?.id) return [];
            return shiftsQueries.getEmployeeShifts(user.id, startDateStr, endDateStr);
        },
        enabled: !!user?.id,
        staleTime: 30000, // Consistent with useRosterShifts
    });

    const resolvedDateRange = eachDayOfInterval({ start, end });

    // Get shifts for a specific date
    const getShiftsForDate = (date: Date, options?: { includeContinuations?: boolean }): ShiftWithDetails[] => {
        const includeContinuations = options?.includeContinuations ?? true;
        const dateStr = format(date, 'yyyy-MM-dd');
        const prevDateStr = format(subDays(date, 1), 'yyyy-MM-dd');

        // Filter from the cached array
        let daysShifts = shifts.filter(s => {
            // Exclude S3 (Published+Offered, awaiting acceptance) — they appear in MyOffers modal only.
            // S3 encoding: lifecycle=Published, assignment_status=assigned, assignment_outcome=NULL
            if (s.lifecycle_status === 'Published' && s.assignment_status === 'assigned' && !s.assignment_outcome) return false;

            // Include shifts starting today
            if (s.shift_date === dateStr) return true;

            // Include shifts starting yesterday that span into today
            if (includeContinuations) {
                const crossesMidnight = doesShiftTrulyCrossMidnight(s);
                if (s.shift_date === prevDateStr && crossesMidnight) return true;
            }

            return false;
        });

        // Apply Scope Filters
        if (daysShifts.length > 0) {

            // 1. Priority: Multi-select Scope (from MyRosterPage ScopeFilterBanner)
            if (scope) {
                // Filter by Organization (if specific ones selected)
                if (scope.org_ids && scope.org_ids.length > 0) {
                    daysShifts = daysShifts.filter(s => s.organization_id && scope.org_ids.includes(s.organization_id));
                }

                // Filter by Department (if specific ones selected)
                if (scope.dept_ids && scope.dept_ids.length > 0) {
                    daysShifts = daysShifts.filter(s => scope.dept_ids.includes(s.department_id));
                }

                // Filter by Sub-Department (if specific ones selected)
                if (scope.subdept_ids && scope.subdept_ids.length > 0) {
                    // Inclusion Fix: Include shifts that match selected sub-depts, 
                    // OR are at the Department level (null sub_dept) if their parent department is match.
                    daysShifts = daysShifts.filter(s => {
                        const subDeptMatch = s.sub_department_id && scope.subdept_ids.includes(s.sub_department_id);
                        const isDeptLevel = !s.sub_department_id;
                        // If it's a department-level shift, we allow it if the department itself is in the scope.
                        // Since scope.dept_ids usually contains the parents of subdept_ids, this is safe.
                        return subDeptMatch || isDeptLevel;
                    });
                }
            }
            // 2. Fallback: Global Context (Single Select) - only if no explicit scope passed
            else {
                if (organizationId) {
                    daysShifts = daysShifts.filter(s => s.organization_id === organizationId);
                }
                // We previously relaxed this, but if no scope is passed, maybe we should respect it? 
                // However, the user complained it hid things.
                // For now, let's keep the "Relaxed" behavior for the fallback case to be safe, 
                // relying on the orgId.
            }
        }

        return daysShifts.map(shift => ({
            shift,
            groupName: shift.group_type === 'convention_centre' ? 'Convention' :
                shift.group_type === 'exhibition_centre' ? 'Exhibition' :
                    shift.group_type === 'theatre' ? 'Theatre' : 'General',
            groupColor: (shift.group_type === 'convention_centre' ? 'convention' :
                shift.group_type === 'exhibition_centre' ? 'exhibition' :
                    shift.group_type === 'theatre' ? 'theatre' : 'default') as string,
            subGroupName: shift.sub_group_name || ''
        }));
    };

    // Navigation functions
    const goToPrevious = () => {
        if (view === 'day') {
            return subDays(selectedDate, 1);
        } else if (view === '3day') {
            return subDays(selectedDate, 3);
        } else if (view === 'week') {
            return subDays(selectedDate, 7);
        } else if (view === 'month') {
            const newDate = new Date(selectedDate);
            newDate.setMonth(newDate.getMonth() - 1);
            return newDate;
        }
        return selectedDate;
    };

    const goToNext = () => {
        if (view === 'day') {
            return addDays(selectedDate, 1);
        } else if (view === '3day') {
            return addDays(selectedDate, 3);
        } else if (view === 'week') {
            return addDays(selectedDate, 7);
        } else if (view === 'month') {
            const newDate = new Date(selectedDate);
            newDate.setMonth(newDate.getMonth() + 1);
            return newDate;
        }
        return selectedDate;
    };

    return {
        dateRange: resolvedDateRange,
        shifts,
        isLoading,
        error,
        getShiftsForDate,
        goToPrevious,
        goToNext
    };
};
