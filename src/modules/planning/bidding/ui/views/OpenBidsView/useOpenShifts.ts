// src/modules/planning/bidding/ui/views/OpenBidsView/useOpenShifts.ts

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { computeBiddingUrgency, isOnBidding } from '@/modules/rosters/domain/bidding-urgency';
import type { ManagerBidShift, BidToggle } from './types';

interface UseManagerBidShiftsReturn {
  shifts: ManagerBidShift[];
  isLoading: boolean;
  refetch: () => void;
}

interface ManagerBidFilters {
  organizationId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
  startDate?: string;
  endDate?: string;
}

export function useManagerBidShifts(filters: ManagerBidFilters): UseManagerBidShiftsReturn {
  const { activeContract } = useAuth();

  const queryFilters = {
    organizationId: filters.organizationId || activeContract?.organizationId || '',
    departmentId: filters.departmentId || undefined,
    subDepartmentId: filters.subDepartmentId || undefined,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
  };

  console.log('[useManagerBidShifts] Hook triggered with queryFilters:', queryFilters);

  const {
    data: shifts = [],
    isLoading,
    refetch,
    isError,
  } = useQuery({
    queryKey: shiftKeys.managerBidShifts(queryFilters.organizationId, queryFilters),
    queryFn: async () => {
      if (!queryFilters.organizationId) return [];
      const data = await shiftsQueries.getManagerBidShifts(queryFilters as any);

      const mapped: ManagerBidShift[] = data.map((s: any) => {
        const [sh, sm] = (s.start_time || '00:00').split(':').map(Number);
        const [eh, em] = (s.end_time || '00:00').split(':').map(Number);
        let durationMins = (eh * 60 + em) - (sh * 60 + sm);
        if (durationMins < 0) durationMins += 24 * 60;
        const unpaidBreak = s.unpaid_break_minutes || 0;
        const paidBreak = s.paid_break_minutes || 0;
        const netHours = ((durationMins - unpaidBreak) / 60).toFixed(1);

        const shiftStart = s.start_at
          ? new Date(s.start_at)
          : parseZonedDateTime(s.shift_date, s.start_time || '00:00', s.tz_identifier || SYDNEY_TZ);
        const biddingDeadline = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000).toISOString();

        const stateId = determineShiftState(s);

        // Determine toggle category
        let toggle: BidToggle = 'normal';
        if (s.assigned_employee_id) {
          toggle = 'resolved';
        } else if (isOnBidding(s.bidding_status) && computeBiddingUrgency(s.shift_date, s.start_time) === 'urgent') {
          toggle = 'urgent';
        } else {
          toggle = 'normal';
        }

        // Bid count from the fetched array of IDs
        const bidCount = Array.isArray(s.shift_bids) ? s.shift_bids.length : 0;

        const assignedProfile = s.assigned_profiles;
        const assignedName = assignedProfile
          ? `${assignedProfile.first_name || ''} ${assignedProfile.last_name || ''}`.trim()
          : undefined;

        return {
          id: s.id,
          role: s.roles?.name || 'Shift',
          roleId: s.role_id || undefined,
          date: s.shift_date,
          dayLabel: new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-AU', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
          startTime: (s.start_time || '00:00').slice(0, 5),
          endTime: (s.end_time || '00:00').slice(0, 5),
          netHours,
          paidBreak,
          unpaidBreak,
          department: s.departments?.name || 'Department',
          subDepartment: s.sub_departments?.name || '',
          organization: s.organizations?.name || '',
          remunerationLevel: s.remuneration_levels?.level_name,
          bidCount,
          biddingDeadline,
          stateId,
          toggle,
          isUrgent: toggle === 'urgent',
          assignedEmployeeName: assignedName,
          assignedEmployeeId: s.assigned_employee_id || undefined,
          organizationId: s.organization_id,
          departmentId: s.department_id,
          subDepartmentId: s.sub_department_id,
          groupType: s.group_type,
          lifecycleStatus: s.lifecycle_status,
        };
      });

      return mapped;
    },
    enabled: !!queryFilters.organizationId,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  return { shifts, isLoading, refetch };
}

// Re-export for backward compat
export { useManagerBidShifts as useOpenShifts };
