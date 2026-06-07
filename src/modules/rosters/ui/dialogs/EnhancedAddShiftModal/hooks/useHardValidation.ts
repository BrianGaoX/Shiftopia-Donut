/**
 * useHardValidation — Fetches the employee's existing shifts via React Query
 * and runs synchronous hard-validation checks whenever the form changes.
 *
 * Previously used raw supabase calls inside useEffect, which bypassed the
 * React Query cache entirely. Now uses useQuery so results are shared,
 * deduplicated, and respect optimistic updates written during the same session.
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { runHardValidation, HardValidationResult, ShiftTimeRange } from '@/modules/compliance';
import { format, addDays, subDays } from 'date-fns';
import { getNowInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { isEqual } from 'lodash';

const EMPTY_ARRAY: any[] = [];

interface UseHardValidationProps {
    watchStart: string;
    watchEnd: string;
    watchShiftDate: Date | undefined;
    watchEmployeeId: string | null | undefined;
    isTemplateMode: boolean;
    existingV8ShiftId?: string;
    timezone?: string;
}

interface UseHardValidationReturn {
    hardValidation: HardValidationResult;
    employeeExistingShifts: ShiftTimeRange[];
    studentVisaEnforcement: boolean;
    isLoadingShifts: boolean;
}

export function useHardValidation({
    watchStart,
    watchEnd,
    watchShiftDate,
    watchEmployeeId,
    isTemplateMode,
    existingV8ShiftId,
    timezone = SYDNEY_TZ,
}: UseHardValidationProps): UseHardValidationReturn {
    const [hardValidation, setHardValidation] = useState<HardValidationResult>({ passed: true, errors: [] });

    // Stable date range strings (memoised so React Query key stays stable)
    const startDate = useMemo(
        () => watchShiftDate ? format(subDays(watchShiftDate, 35), 'yyyy-MM-dd') : '',
        [watchShiftDate],
    );
    const endDate = useMemo(
        () => watchShiftDate ? format(addDays(watchShiftDate, 35), 'yyyy-MM-dd') : '',
        [watchShiftDate],
    );

    const queryEnabled = !!watchEmployeeId && !!watchShiftDate && !isTemplateMode;

    // ── Existing shifts ───────────────────────────────────────────────────────
    // Uses get_employee_shift_window (SECURITY DEFINER) so all shifts for the
    // employee are visible regardless of the calling manager's RLS scope.
    // This prevents false-pass on rest-gap / avg-4-week checks when the
    // employee works across multiple departments.
    // p_exclude_id filters out the shift being edited server-side.
    const { data: rawShifts = EMPTY_ARRAY, isLoading: isLoadingShifts } = useQuery({
        queryKey: shiftKeys.byEmployee(watchEmployeeId ?? '', startDate, endDate),
        queryFn: async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.rpc as any)('get_employee_shift_window', {
                p_employee_id: watchEmployeeId!,
                p_start_date: startDate,
                p_end_date: endDate,
                p_exclude_id: existingV8ShiftId ?? null,
            });
            if (error) throw error;
            return (data ?? []) as Array<{
                id: string;
                shift_date: string;
                start_time: string;
                end_time: string;
                unpaid_break_minutes: number;
            }>;
        },
        enabled: queryEnabled,
        staleTime: 30_000,
    });

    // ── Student visa flag ─────────────────────────────────────────────────────
    const { data: visaData } = useQuery({
        queryKey: ['employee_licenses', watchEmployeeId, 'work_rights'],
        queryFn: async () => {
            const { data } = await supabase
                .from('employee_licenses')
                .select('has_restricted_work_limit')
                .eq('employee_id', watchEmployeeId!)
                .eq('license_type', 'WorkRights')
                .maybeSingle();
            return data;
        },
        enabled: queryEnabled,
        staleTime: 5 * 60 * 1000,
    });

    const studentVisaEnforcement = visaData?.has_restricted_work_limit ?? false;

    // Shape RPC results into ShiftTimeRange[] — exclusion already handled server-side
    const employeeExistingShifts = useMemo<ShiftTimeRange[]>(() => {
        return rawShifts.map(s => ({
            shift_id: s.id,
            start_time: s.start_time,
            end_time: s.end_time,
            shift_date: s.shift_date,
            unpaid_break_minutes: s.unpaid_break_minutes || 0,
        }));
    }, [rawShifts, watchEmployeeId]);

    // Run synchronous hard-validation whenever any input changes
    useEffect(() => {
        if (!watchStart || !watchEnd) {
            setHardValidation({ passed: true, errors: [] });
            return;
        }

        const shiftDateStr = isTemplateMode
            ? format(new Date(), 'yyyy-MM-dd')
            : watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : '';

        if (!shiftDateStr && !isTemplateMode) {
            setHardValidation({ passed: true, errors: [] });
            return;
        }

        const result = runHardValidation({
            shift_date: shiftDateStr,
            start_time: watchStart,
            end_time: watchEnd,
            employee_id: watchEmployeeId,
            existing_shifts: employeeExistingShifts,
            current_time: getNowInTimezone(timezone),
            is_template: isTemplateMode,
            shift_id: existingV8ShiftId,
        });

        // Only update if result actually changed to prevent render loops
        setHardValidation(prev => {
            if (isEqual(prev, result)) return prev;
            return result;
        });
    }, [watchStart, watchEnd, watchShiftDate, watchEmployeeId, employeeExistingShifts, isTemplateMode, timezone]);

    return { hardValidation, employeeExistingShifts, studentVisaEnforcement, isLoadingShifts };
}
