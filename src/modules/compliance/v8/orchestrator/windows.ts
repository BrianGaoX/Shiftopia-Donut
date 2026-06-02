/**
 * Compliance Engine v2 — Window & Time Utilities
 *
 * All date/time operations are date-string-based (YYYY-MM-DD + HH:mm).
 * No Date objects in the public API — predictable, timezone-safe.
 *
 * Key improvements over v1 utils:
 *   - segmentShiftByDay: cross-midnight segments with correct break attribution
 *   - deriveImpactWindow: scopes rule evaluation to relevant window + buffer
 *   - toAbsoluteMinutes: enables shift ordering and gap calculation across dates
 *   - computeMaxConsecutiveStreak: O(n) consecutive-day detection
 */

import { V8OrchestratorShift, V8ShiftId } from './types';

// =============================================================================
// LOCAL TYPE DEFINITIONS
// (DaySegmentV2 and ImpactWindow were removed from ./types — defined here)
// =============================================================================

export interface DaySegmentV2 {
    date:            string;       // YYYY-MM-DD
    hours:           number;
    source_shift_id: V8ShiftId;
}

export interface ImpactWindow {
    from_date: string;    // YYYY-MM-DD
    to_date:   string;    // YYYY-MM-DD
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY      = 86_400_000;

// =============================================================================
// DATE HELPERS
// =============================================================================

/** Parse YYYY-MM-DD to epoch ms (midnight UTC) */
export function dateToMs(dateStr: string): number {
    return new Date(dateStr + 'T00:00:00Z').getTime();
}

/** epoch ms → YYYY-MM-DD (UTC) */
export function msToDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Add N calendar days to a YYYY-MM-DD string */
export function addDays(dateStr: string, days: number): string {
    return msToDate(dateToMs(dateStr) + days * MS_PER_DAY);
}

/** Lexicographic compare of two YYYY-MM-DD strings (-1 | 0 | 1) */
export function compareDates(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Today's date as YYYY-MM-DD (UTC) */
export function todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
}

// =============================================================================
// TIME HELPERS
// =============================================================================

/** Parse HH:mm → minutes since midnight */
export function parseTimeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + (m || 0);
}

/**
 * Convert (YYYY-MM-DD, HH:mm) to absolute minutes since the UNIX epoch midnight.
 * Enables sorting and gap calculation across shifts on different dates.
 */
export function toAbsoluteMinutes(date: string, time: string): number {
    const days = Math.round(dateToMs(date) / MS_PER_DAY);
    return days * MINUTES_PER_DAY + parseTimeToMinutes(time);
}

/**
 * Gross duration of a shift in minutes (handles cross-midnight).
 * Does NOT subtract breaks — use shiftDurationHours for net hours.
 */
export function shiftGrossMinutes(shift: V8OrchestratorShift): number {
    const start = parseTimeToMinutes(shift.start_time);
    let   end   = parseTimeToMinutes(shift.end_time);
    if (end <= start) end += MINUTES_PER_DAY;
    return end - start;
}

/**
 * Net duration of a shift in hours (subtracts unpaid_break_minutes).
 * Used for hour-accumulation rules (R03, R04, R05, R06).
 */
export function shiftDurationHours(shift: V8OrchestratorShift): number {
    const grossMins = shiftGrossMinutes(shift);
    const netMins   = Math.max(0, grossMins - (shift.unpaid_break_minutes || 0));
    return netMins / 60;
}

// =============================================================================
// CROSS-MIDNIGHT SEGMENT SPLITTING
// =============================================================================

/**
 * Splits a shift into per-calendar-day segments.
 *
 * Example: shift_date=2026-03-18, 22:00→06:00
 * → [{ date: '2026-03-18', hours: 2.0 },
 *    { date: '2026-03-19', hours: 6.0 }]
 *
 * Unpaid break is attributed fully to the primary (start) date segment.
 */
export function segmentShiftByDay(shift: V8OrchestratorShift): DaySegmentV2[] {
    const startMin  = parseTimeToMinutes(shift.start_time);
    const endMin    = parseTimeToMinutes(shift.end_time);
    const breakMins = shift.unpaid_break_minutes || 0;
    const isCross   = endMin <= startMin;

    if (!isCross) {
        const netHours = Math.max(0, (endMin - startMin - breakMins)) / 60;
        return [{ date: shift.date, hours: netHours, source_shift_id: shift.id }];
    }

    // Cross-midnight: split at 00:00
    const primaryGross    = MINUTES_PER_DAY - startMin;
    const secondaryGross  = endMin;
    const primaryNet      = Math.max(0, primaryGross - breakMins) / 60;
    const secondaryNet    = secondaryGross / 60;

    return [
        { date: shift.date,             hours: primaryNet,   source_shift_id: shift.id },
        { date: addDays(shift.date, 1), hours: secondaryNet, source_shift_id: shift.id },
    ];
}

// =============================================================================
// GROUPING & INDEXING
// =============================================================================

/**
 * Groups shifts by calendar day using DaySegments.
 * Cross-midnight shifts appear in BOTH days.
 * Correct for daily-hours (R03) and consecutive-days (R09) checks.
 */
export function groupByCalendarDay(shifts: V8OrchestratorShift[]): Map<string, DaySegmentV2[]> {
    const map = new Map<string, DaySegmentV2[]>();
    for (const shift of shifts) {
        for (const seg of segmentShiftByDay(shift)) {
            if (!map.has(seg.date)) map.set(seg.date, []);
            map.get(seg.date)!.push(seg);
        }
    }
    return map;
}

/**
 * Sorts shifts chronologically by (shift_date, start_time).
 * Used by R01 (overlap) and R07 (rest gap).
 */
export function sortShiftsByStart(shifts: V8OrchestratorShift[]): V8OrchestratorShift[] {
    return [...shifts].sort((a, b) => {
        const dc = compareDates(a.date, b.date);
        if (dc !== 0) return dc;
        return parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time);
    });
}

// =============================================================================
// WINDOW FILTERING
// =============================================================================

/**
 * Shifts whose shift_date is within [reference_date - days, reference_date].
 * Inclusive on both ends.
 */
export function shiftsInRollingWindow(
    shifts:         V8OrchestratorShift[],
    reference_date: string,
    days:           number,
): V8OrchestratorShift[] {
    const from_date = addDays(reference_date, -days);
    return shifts.filter(s => s.date >= from_date && s.date <= reference_date);
}

/**
 * Shifts that touch [from_date, to_date].
 * A cross-midnight shift also touches the next calendar day.
 */
export function shiftsInWindow(
    shifts:    V8OrchestratorShift[],
    from_date: string,
    to_date:   string,
): V8OrchestratorShift[] {
    return shifts.filter(shift => {
        const isCross = parseTimeToMinutes(shift.end_time) <= parseTimeToMinutes(shift.start_time);
        const end_date = isCross ? addDays(shift.date, 1) : shift.date;
        return (shift.date >= from_date && shift.date <= to_date)
            || (end_date >= from_date && end_date <= to_date);
    });
}

/** Sum net hours across a set of shifts */
export function totalHoursInWindow(shifts: V8OrchestratorShift[]): number {
    return shifts.reduce((sum, s) => sum + shiftDurationHours(s), 0);
}

// =============================================================================
// WORKING DAY UTILITIES
// =============================================================================

/**
 * Returns sorted list of YYYY-MM-DD strings where ≥1 shift segment exists,
 * filtered to the rolling [reference_date - days, reference_date] window.
 */
export function workingDaysInWindow(
    shifts_by_day:  Map<string, DaySegmentV2[]>,
    reference_date: string,
    days:           number,
): string[] {
    const from_date = addDays(reference_date, -days);
    return Array.from(shifts_by_day.keys())
        .filter(d => d >= from_date && d <= reference_date)
        .sort();
}

/**
 * Computes the maximum consecutive calendar-day working streak
 * from a sorted array of working day strings (YYYY-MM-DD).
 */
export function computeMaxConsecutiveStreak(working_days: string[]): number {
    if (working_days.length === 0) return 0;

    let max_streak = 1;
    let streak     = 1;

    for (let i = 1; i < working_days.length; i++) {
        const diff_ms = dateToMs(working_days[i]) - dateToMs(working_days[i - 1]);
        if (diff_ms === MS_PER_DAY) {
            max_streak = Math.max(max_streak, ++streak);
        } else {
            streak = 1;
        }
    }

    return max_streak;
}

// =============================================================================
// IMPACT WINDOW DERIVATION
// =============================================================================

/**
 * Derives the minimum date window that covers all candidate_shifts,
 * extended by buffer_days on each side.
 *
 * buffer_days = 2 covers rest-gap and consecutive-day checks for all adjacent shifts.
 */
export function deriveImpactWindow(
    candidate_shifts: V8OrchestratorShift[],
    buffer_days:      number = 2,
): ImpactWindow {
    if (candidate_shifts.length === 0) {
        const today = todayUTC();
        return { from_date: today, to_date: today };
    }

    const dates     = candidate_shifts.map(s => s.date).sort();
    const first     = dates[0];
    const last      = dates[dates.length - 1];

    // If the last candidate shift is cross-midnight, it extends into the next day
    const lastShift = candidate_shifts.find(s => s.date === last)!;
    const isCross   = parseTimeToMinutes(lastShift.end_time) <= parseTimeToMinutes(lastShift.start_time);
    const effectiveLast = isCross ? addDays(last, 1) : last;

    return {
        from_date: addDays(first,         -buffer_days),
        to_date:   addDays(effectiveLast, +buffer_days),
    };
}

// =============================================================================
// UNIQUE SHIFT DEDUPLICATION  (for constraint generation)
// =============================================================================

/** Returns shift IDs from a DaySegment array, deduplicated */
export function uniqueV8ShiftIdsFromSegments(
    segments: DaySegmentV2[],
): V8ShiftId[] {
    return [...new Set(segments.map(seg => seg.source_shift_id))];
}
