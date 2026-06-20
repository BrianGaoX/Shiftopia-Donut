import { type ShiftDotInput, isTimesheetReviewable } from '@/modules/rosters/domain/shift-ui';
import { type TimesheetRow } from '../../model/timesheet.types';

/**
 * Maps a UI {@link TimesheetRow} entry to the {@link ShiftDotInput} shape the
 * Live Rules engine consumes. Single source of truth for this projection so the
 * row, mobile card, and bulk-select all derive identical attendance state.
 */
export const timesheetEntryToShiftInput = (entry: TimesheetRow): ShiftDotInput => ({
    lifecycle_status: entry.liveStatus,
    attendance_status: entry.attendanceStatus,
    attendance_note: entry.attendanceNote,
    actual_start: entry.rawActualStart ?? entry.clockIn,
    actual_end: entry.rawActualEnd ?? entry.clockOut,
    adjusted_start: entry.adjustedStart,
    adjusted_end: entry.adjustedEnd,
    adjusted_is_manual: entry.isAdjustedManual,
    start_at: entry.rawStartAt,
    end_at: entry.rawEndAt,
    shift_date: typeof entry.date === 'string' ? entry.date : undefined,
    start_time: entry.scheduledStart,
    end_time: entry.scheduledEnd,
});

/**
 * Manager review gate (approve / reject / edit) for a timesheet entry — true
 * only once the shift reaches a terminal attendance state (No-Show, clock-out,
 * or auto clock-out). Thin wrapper over the domain {@link isTimesheetReviewable}.
 */
export const isEntryReviewable = (entry: TimesheetRow): boolean =>
    isTimesheetReviewable(timesheetEntryToShiftInput(entry));

/**
 * Formats decimal hours as H:MM or H.hh
 */
export const formatHours = (hours: number): string => {
    if (isNaN(hours)) return '0.00';
    return hours.toFixed(2);
};

/**
 * Formats differential with +/- prefix
 */
export const formatDifferential = (hours: number): string => {
    if (isNaN(hours) || hours === 0) return '0.00';
    const prefix = hours > 0 ? '+' : '';
    return `${prefix}${hours.toFixed(2)}`;
};

/**
 * Calculates hours between two HH:mm strings, handling overnight shifts
 */
export const calculateHoursBetween = (startStr?: string, endStr?: string): number => {
    if (!startStr || !endStr) return 0;

    try {
        const [startH, startM] = startStr.split(':').map(Number);
        const [endH, endM] = endStr.split(':').map(Number);

        let startMinutes = startH * 60 + startM;
        let endMinutes = endH * 60 + endM;

        // Handle overnight shift (end time before start time)
        if (endMinutes < startMinutes) {
            endMinutes += 24 * 60;
        }

        return (endMinutes - startMinutes) / 60;
    } catch (e) {
        return 0;
    }
};

/**
 * Robust check to determine if a shift is physically over.
 * Accounts for date, time, and overnight status.
 */
export const isShiftFinished = (
    date: string | Date, 
    scheduledStart: string, 
    scheduledEnd: string,
    actualEnd?: string | null
): boolean => {
    // If they have physically clocked out, the shift is "finished" for processing
    // whichever is earlier rule.
    if (actualEnd && actualEnd !== '-' && actualEnd !== '—') return true;

    if (!scheduledEnd || scheduledEnd === '-') return false;
    
    try {
        const baseDate = new Date(date);
        const [hours, minutes] = scheduledEnd.split(':').map(Number);
        const [startH] = scheduledStart.split(':').map(Number);
        
        const endTime = new Date(baseDate);
        endTime.setHours(hours, minutes, 0, 0);

        // Handle overnight shifts
        if (hours < startH) {
            endTime.setDate(endTime.getDate() + 1);
        }

        return new Date() >= endTime;
    } catch (e) {
        console.error("Error parsing shift end time for finished check", e);
        return true; 
    }
};
