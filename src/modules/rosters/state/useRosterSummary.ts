import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shiftKeys, ShiftFilters } from '../api/queryKeys';
import { rosterSummaryQueries, RosterSummaryCellDTO } from '../api/rosterSummary.queries';
import { useMemo } from 'react';

/**
 * useRosterSummary
 *
 * Fetches server-side shift summaries for the given date range.
 * This hook powers the Month view "millions of shifts" endgame by allowing the UI
 * to render aggregate cells without fetching 100,000+ individual shift rows.
 *
 * @param orgId The organization ID
 * @param startDate The start date of the view
 * @param endDate The end date of the view
 * @param filters Department/SubDepartment filters
 * @param enabled Whether to actually fire the query (typically viewType === 'month')
 */
export function useRosterSummary(
    orgId: string | null | undefined,
    startDate: string | null | undefined,
    endDate: string | null | undefined,
    filters?: ShiftFilters | null,
    enabled = true
) {
    const queryKey = shiftKeys.summary(orgId!, startDate!, endDate!, filters);
    
    const {
        data: rawData = [],
        isLoading,
        isError,
        error,
        refetch
    } = useQuery({
        queryKey,
        queryFn: async () => {
            if (!orgId || !startDate || !endDate) return [];
            return rosterSummaryQueries.getRosterSummary(orgId, startDate, endDate, filters);
        },
        enabled: enabled && !!orgId && !!startDate && !!endDate,
        staleTime: 30_000, // Matches shift list stale time
    });

    // Transform the raw array into a fast lookup Map keyed by
    // `${shift_date}::${group_type}::${sub_group_name}` so each per-subgroup grid
    // cell (3-Day / Week / Month Bucket View) resolves its own totals.
    const summaryMap = useMemo(() => {
        const map = new Map<string, RosterSummaryCellDTO>();
        for (const cell of rawData) {
            // Treat null group_type as a default/empty bucket if necessary
            const key = `${cell.shift_date}::${cell.group_type || 'unassigned'}::${cell.sub_group_name || ''}`;
            map.set(key, cell);
        }
        return map;
    }, [rawData]);

    return {
        summaryMap,
        rawData,
        isLoading,
        isError,
        error,
        refetch
    };
}
