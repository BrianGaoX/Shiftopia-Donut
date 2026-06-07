/**
 * useBulkBidCompliance Hook
 * 
 * Runs compliance checks for multiple candidate shifts against the user's existing roster.
 * Optimized for the MyBids page where we need to check many shifts at once.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/supabase/client';
import { format, parseISO, subDays, addDays, min, max } from 'date-fns';
import {
    runV8LegacyBridge,
    ComplianceCheckInput,
    ComplianceCheckResult,
    ShiftTimeRange,
} from '@/modules/compliance';

// =============================================================================
// TYPES
// =============================================================================

export interface BulkComplianceShift {
    id: string;
    date: string;           // YYYY-MM-DD
    startTime: string;      // HH:mm
    endTime: string;        // HH:mm
    unpaidBreak?: number;   // minutes
}

export interface BulkComplianceResult {
    shiftId: string;
    result: ComplianceCheckResult;
    passedCount: number;
    totalCount: number;
    status: 'pass' | 'warning' | 'fail';
}

export interface UseBulkBidComplianceReturn {
    results: Record<string, BulkComplianceResult>;
    isLoading: boolean;
    error: Error | null;
    getResultForShift: (shiftId: string) => BulkComplianceResult | null;
}

// =============================================================================
// HOOK
// =============================================================================

export function useBulkBidCompliance(
    candidateShifts: BulkComplianceShift[]
): UseBulkBidComplianceReturn {
    const { user } = useAuth();

    // 1. Calculate date range from all candidate shifts
    const dateRange = useMemo(() => {
        if (candidateShifts.length === 0) return null;

        const dates = candidateShifts.map(s => parseISO(s.date));
        const minDate = min(dates);
        const maxDate = max(dates);

        // Expand by 30 days on each side for rules like max-consecutive-days
        return {
            start: format(subDays(minDate, 30), 'yyyy-MM-dd'),
            end: format(addDays(maxDate, 30), 'yyyy-MM-dd'),
        };
    }, [candidateShifts]);

    // 2. Fetch user's existing roster for the entire date range
    const { data: userRoster = [], isLoading: isLoadingRoster, error: rosterError } = useQuery({
        queryKey: ['userRosterForBulkCompliance', user?.id, dateRange?.start, dateRange?.end],
        queryFn: async () => {
            if (!user?.id || !dateRange) return [];

            console.log('[useBulkBidCompliance] Fetching roster for:', user.id, dateRange);

            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', user.id)
                .gte('shift_date', dateRange.start)
                .lte('shift_date', dateRange.end)
                .is('deleted_at', null)
                .eq('is_cancelled', false);

            if (error) {
                console.error('[useBulkBidCompliance] Error fetching roster:', error);
                throw error;
            }

            console.log('[useBulkBidCompliance] Found user roster shifts:', data?.length);
            return data || [];
        },
        enabled: !!user?.id && !!dateRange && candidateShifts.length > 0,
        staleTime: 60 * 1000, // Cache for 1 minute
    });

    // 3. Run compliance checks for all candidate shifts
    const results = useMemo(() => {
        if (isLoadingRoster || candidateShifts.length === 0) return {};

        console.log('[useBulkBidCompliance] Running bulk checks for', candidateShifts.length, 'shifts');

        const resultsMap: Record<string, BulkComplianceResult> = {};

        // Convert user roster to ShiftTimeRange format
        const existingShifts: ShiftTimeRange[] = userRoster.map(s => ({
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            unpaid_break_minutes: s.unpaid_break_minutes || 0,
        }));

        // Run checks for each candidate
        for (const candidate of candidateShifts) {
            const input: ComplianceCheckInput = {
                employee_id: user?.id || '',
                action_type: 'bid',
                candidate_shift: {
                    shift_date: candidate.date,
                    start_time: candidate.startTime + ':00',
                    end_time: candidate.endTime + ':00',
                    unpaid_break_minutes: candidate.unpaidBreak || 0,
                },
                existing_shifts: existingShifts,
            };

            const checkResult = runV8LegacyBridge(input) as any;

            // Count passed rules
            const passedCount = (checkResult.results || []).filter((r: any) => r.status === 'pass').length;
            const totalCount = (checkResult.results || []).length;

            // Determine overall status
            let status: 'pass' | 'warning' | 'fail' = 'pass';
            if (checkResult.hasBlockingFailure) {
                status = 'fail';
            } else if (checkResult.hasWarnings) {
                status = 'warning';
            }

            resultsMap[candidate.id] = {
                shiftId: candidate.id,
                result: checkResult as ComplianceCheckResult,
                passedCount,
                totalCount,
                status,
            };
        }

        console.log('[useBulkBidCompliance] Completed bulk checks:', Object.keys(resultsMap).length);
        return resultsMap;
    }, [candidateShifts, userRoster, user?.id, isLoadingRoster]);

    // 4. Helper to get result for a specific shift
    const getResultForShift = (shiftId: string): BulkComplianceResult | null => {
        return results[shiftId] || null;
    };

    return {
        results,
        isLoading: isLoadingRoster,
        error: rosterError as Error | null,
        getResultForShift,
    };
}

export default useBulkBidCompliance;
