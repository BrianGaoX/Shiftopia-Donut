/**
 * useRosterViewPrefetch — BFF-backed cache warm-up for the Rosters Planner
 *
 * Fires a single HTTP request to the `get-roster-view` Edge Function which
 * runs all 5 roster-page queries in parallel server-side (datacenter latency,
 * ~5 ms each). The bundled response is used to pre-populate TanStack Query
 * cache entries for:
 *
 *   shiftKeys.byDateRange   — main shift list
 *   shiftKeys.lookups.employees  — eligible employee list
 *   shiftKeys.lookups.roles      — scoped roles
 *   shiftKeys.lookups.remunerationLevels
 *   shiftKeys.lookups.events
 *
 * After seeding, the individual hooks (useShiftsByDateRange, useEmployees,
 * useRoles, …) in RostersPlannerPage will find their data already in cache
 * and skip redundant network requests.
 *
 * The BFF query itself is keyed under ['roster-view-bff', ...params] so
 * TanStack Query can deduplicate and manage its own stale/refetch lifecycle.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { shiftKeys, type ShiftFilters } from '@/modules/rosters/api/queryKeys';
import { normalizeShiftRow } from '@/modules/rosters/api/shifts.queries';
import type { Shift } from '@/modules/rosters/api/shifts.api';
import type {
    ProfileSummary,
    RoleSummary,
    RemunerationLevel,
} from '@/modules/rosters/api/shifts.queries';

// ── BFF response shape ────────────────────────────────────────────────────────

interface RosterViewPayload {
    shifts: Shift[];
    employees: ProfileSummary[];
    roles: RoleSummary[];
    remuneration_levels: RemunerationLevel[];
    events: {
        id: string; name: string; description: string | null;
        event_type: string; venue: string | null;
        start_date: string; end_date: string; status: string;
    }[];
}

// ── BFF query key factory ─────────────────────────────────────────────────────

export const rosterViewBffKey = (
    orgId: string | null,
    startDate: string | null,
    endDate: string | null,
    deptIds: string[],
    subDeptIds: string[],
    employeePageSize?: number,
) => ['roster-view-bff', orgId ?? null, startDate ?? null, endDate ?? null, deptIds, subDeptIds, employeePageSize ?? null] as const;

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseRosterViewPrefetchParams {
    orgId: string | null;
    startDate: string | null;
    endDate: string | null;
    /** Matches selectedDepartmentIds in RostersPlannerPage */
    deptIds: string[];
    /** Matches selectedSubDepartmentIds in RostersPlannerPage */
    subDeptIds: string[];
    /** Must be the same filters object passed to useShiftsByDateRange */
    shiftFilters?: ShiftFilters;
    /** Limit passed to useEmployees on the page; required so the seeded cache key matches the consumer's read key. */
    employeePageSize?: number;
}

export function useRosterViewPrefetch({
    orgId,
    startDate,
    endDate,
    deptIds,
    subDeptIds,
    shiftFilters,
    employeePageSize,
}: UseRosterViewPrefetchParams) {
    const queryClient = useQueryClient();

    const { data } = useQuery({
        queryKey: rosterViewBffKey(orgId, startDate, endDate, deptIds, subDeptIds, employeePageSize),
        queryFn: async (): Promise<RosterViewPayload> => {
            const { data: payload, error } = await supabase.functions.invoke<RosterViewPayload>(
                'get-roster-view',
                {
                    body: {
                        organization_id:  orgId,
                        department_ids:   deptIds,
                        sub_department_ids: subDeptIds,
                        start_date:       startDate,
                        end_date:         endDate,
                    },
                },
            );

            if (error || !payload) {
                throw error ?? new Error('get-roster-view returned empty payload');
            }

            // Normalize shift rows on the way in so they match the Shift type
            // (adds is_trade_requested flag identical to shiftsQueries logic)
            return {
                ...payload,
                shifts: payload.shifts.map(s => normalizeShiftRow(s as unknown as Record<string, unknown>)),
            };
        },
        enabled: !!orgId && !!startDate && !!endDate,
        // Match the shortest stale time of the individual queries (shifts = 30 s)
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    });

    // ── Cache seeding ─────────────────────────────────────────────────────────
    // When the BFF response arrives, write each slice into the exact TQ cache
    // entry that the individual hooks would populate. Those hooks then read
    // from cache instead of firing extra network requests.
    useEffect(() => {
        if (!data || !orgId || !startDate || !endDate) return;

        // Shift list — same key as useShiftsByDateRange
        queryClient.setQueryData<Shift[]>(
            shiftKeys.byDateRange(orgId, startDate, endDate, shiftFilters),
            data.shifts,
        );

        // Reference data — same keys as useEmployees / useRoles / etc.
        const primaryDeptId   = deptIds[0];
        const primarySubDeptId = subDeptIds[0];

        queryClient.setQueryData(
            shiftKeys.lookups.employees(orgId, primaryDeptId, primarySubDeptId, undefined, undefined, employeePageSize),
            data.employees,
        );

        queryClient.setQueryData(
            shiftKeys.lookups.roles(orgId, primaryDeptId, primarySubDeptId),
            data.roles,
        );

        queryClient.setQueryData(
            shiftKeys.lookups.remunerationLevels(),
            data.remuneration_levels,
        );

        queryClient.setQueryData(
            shiftKeys.lookups.events(orgId),
            data.events,
        );
    }, [data, orgId, startDate, endDate, deptIds, subDeptIds, shiftFilters, employeePageSize, queryClient]);
}
