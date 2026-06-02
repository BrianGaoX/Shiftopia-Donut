import { addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { useRosterUIOptional, CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import { useState, useCallback, useMemo } from 'react';

/**
 * Hook for roster view state and navigation.
 * 
 * Priority:
 * - Uses context state if RosterUIProvider exists
 * - Falls back to local state if context unavailable
 * - Never mixes both at the same time
 */
export const useRosterView = () => {
    // Try to get context - will be null if provider is missing
    const contextState = useRosterUIOptional();

    // Local fallback state - only used if context is not available
    const [localView, setLocalView] = useState<CalendarView>('day');
    const [localSelectedDate, setLocalSelectedDate] = useState<Date>(new Date());

    // Determine which state to use (context takes priority)
    const isUsingContext = contextState !== null;

    const view = isUsingContext ? contextState.viewType : localView;
    const setView = isUsingContext ? contextState.setViewType : setLocalView;
    const selectedDate = isUsingContext ? contextState.selectedDate : localSelectedDate;
    const setSelectedDate = isUsingContext ? contextState.setSelectedDate : setLocalSelectedDate;

    const viewOptions = useMemo(() => [
        { label: 'Day', value: 'day' },
        { label: '3-Day', value: '3day' },
        { label: 'Week', value: 'week' },
        { label: 'Month', value: 'month' },
    ] as const, []);

    // Get date range based on view and selected date
    const getDateRange = useCallback(() => {
        switch (view) {
            case 'day':
                return { from: selectedDate, to: selectedDate };
            case '3day':
                return { from: selectedDate, to: addDays(selectedDate, 2) };
            case 'week':
                const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 }); // Start from Monday
                const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 }); // End on Sunday
                return { from: weekStart, to: weekEnd };
            case 'month':
                return { from: startOfMonth(selectedDate), to: endOfMonth(selectedDate) };
            default:
                return { from: selectedDate, to: selectedDate };
        }
    }, [view, selectedDate]);

    // Navigate based on view - pure functions that depend only on state
    const navigatePrevious = useCallback(() => {
        (setSelectedDate as any)((prev: Date) => {
            switch (view) {
                case 'day':
                    return subDays(prev, 1);
                case '3day':
                    return subDays(prev, 3);
                case 'week':
                    return subDays(prev, 7);
                case 'month':
                    const prevMonth = new Date(prev);
                    prevMonth.setMonth(prevMonth.getMonth() - 1);
                    return prevMonth;
                default:
                    return prev;
            }
        });
    }, [view, setSelectedDate]);

    const navigateNext = useCallback(() => {
        (setSelectedDate as any)((prev: Date) => {
            switch (view) {
                case 'day':
                    return addDays(prev, 1);
                case '3day':
                    return addDays(prev, 3);
                case 'week':
                    return addDays(prev, 7);
                case 'month':
                    const nextMonth = new Date(prev);
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    return nextMonth;
                default:
                    return prev;
            }
        });
    }, [view, setSelectedDate]);

    // Get all days in the current range
    const getDaysInRange = useCallback(() => {
        const { from, to } = getDateRange();
        return eachDayOfInterval({ start: from, end: to });
    }, [getDateRange]);

    return {
        view,
        setView,
        selectedDate,
        setSelectedDate,
        viewOptions,
        getDateRange,
        navigatePrevious,
        navigateNext,
        getDaysInRange,
        isUsingContext, // Expose for debugging
    };
};

// Re-export the type for convenience
export type { CalendarView };
