/**
 * Bulk-Optimized Rest Gap Calculation
 * 
 * Performance: O(n log n) per employee
 * - Sort once
 * - Scan once
 * - No nested loops
 * 
 * Algorithm:
 * 1. Build combined timeline (existing + candidates)
 * 2. Convert to absolute datetimes
 * 3. Sort by start time
 * 4. Single-pass scan to find violations
 * 5. Attribute violations to both adjacent shifts
 */

import { parseISO, differenceInMinutes, addDays, format } from 'date-fns';
import { parseTimeToMinutes, minutesToHours } from './utils';

// =============================================================================
// CONSTANTS
// =============================================================================

// F2: Default matches the single-shift MIN_REST_GAP rule (10h).
// Callers can pass a lower value for relaxed mode (min 8h).
export const DEFAULT_BULK_REST_HOURS = 10;

// =============================================================================
// TYPES
// =============================================================================

export interface ShiftForRestGap {
    id: string;
    shift_date: string;     // YYYY-MM-DD
    start_time: string;     // HH:mm
    end_time: string;       // HH:mm
    isCandidate?: boolean;
}

interface ShiftSegment {
    shiftId: string;
    startDateTime: Date;
    endDateTime: Date;
    isCandidate: boolean;
    originalDate: string;
    originalStart: string;
    originalEnd: string;
}

export interface RestGapViolation {
    shiftId: string;
    otherV8ShiftId: string;
    gapHours: number;
    requiredHours: number;
    violationType: 'before' | 'after';
    shiftDate: string;
    shiftTime: string;
}

export interface BulkRestGapResult {
    violations: RestGapViolation[];
    perShiftViolations: Map<string, RestGapViolation[]>;
    // For visualization: rest gaps for each candidate shift
    restImpacts: Map<string, {
        date: string;
        shift_time: string;
        rest_before_hours: number | null;
        rest_after_hours: number | null;
        before_violation: boolean;
        after_violation: boolean;
    }>;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Compute rest gap violations for all shifts in O(n log n) time.
 *
 * @param existingShifts   - Employee's currently assigned shifts
 * @param candidateShifts  - New shifts to be assigned
 * @param minRestHours     - Minimum rest required in hours (default 10 — matches
 *                           the single-shift MIN_REST_GAP rule). Pass 8 for
 *                           relaxed mode. (F2: was hardcoded to 8; now unified.)
 * @returns Violations and per-shift impact data
 */
export function checkBulkRestGaps(
    existingShifts: ShiftForRestGap[],
    candidateShifts: ShiftForRestGap[],
    minRestHours: number = DEFAULT_BULK_REST_HOURS
): BulkRestGapResult {
    const MIN_REST_MINUTES = minRestHours * 60;
    const violations: RestGapViolation[] = [];
    const perShiftViolations = new Map<string, RestGapViolation[]>();
    const restImpacts = new Map<string, {
        date: string;
        shift_time: string;
        rest_before_hours: number | null;
        rest_after_hours: number | null;
        before_violation: boolean;
        after_violation: boolean;
    }>();

    // Phase 1: Convert all shifts to segments with absolute datetimes
    const segments: ShiftSegment[] = [];

    for (const shift of existingShifts) {
        const seg = shiftToSegments(shift, false);
        segments.push(...seg);
    }

    for (const shift of candidateShifts) {
        const seg = shiftToSegments(shift, true);
        segments.push(...seg);
    }

    if (segments.length === 0) {
        return { violations, perShiftViolations, restImpacts };
    }

    // Phase 2: Sort by start time (O(n log n))
    segments.sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime());

    // Phase 3: Single-pass scan (O(n))
    // Track rest gaps for candidate shifts
    const candidateIds = new Set(candidateShifts.map(s => s.id));

    // Initialize rest impact tracking for candidates
    for (const shift of candidateShifts) {
        restImpacts.set(shift.id, {
            date: shift.shift_date,
            shift_time: `${shift.start_time} - ${shift.end_time}`,
            rest_before_hours: null,
            rest_after_hours: null,
            before_violation: false,
            after_violation: false
        });
    }

    let prevSegment: ShiftSegment | null = null;

    for (const segment of segments) {
        if (prevSegment !== null) {
            // F3: Same-calendar-day gaps are now evaluated (removed the earlier
            // same-day skip). A 2h break between two intraday shifts is a
            // rest-gap violation just like a cross-day gap.

            // Calculate gap between prevSegment.end and segment.start
            const gapMinutes = differenceInMinutes(segment.startDateTime, prevSegment.endDateTime);
            const gapHours = gapMinutes / 60;

            // Overlapping segments produce a negative or zero gap — handled by
            // NO_OVERLAP; for rest-gap purposes we treat them as 0.
            const effectiveGap = Math.max(0, gapHours);
            const isViolation = effectiveGap < minRestHours;

            // Update rest impacts for candidates
            // Previous shift's "after" gap
            if (candidateIds.has(prevSegment.shiftId)) {
                const impact = restImpacts.get(prevSegment.shiftId)!;
                // Only update if this is the first "after" gap we encounter for this shift
                if (impact.rest_after_hours === null) {
                    impact.rest_after_hours = effectiveGap;
                    impact.after_violation = isViolation;
                }
            }

            // Current shift's "before" gap
            if (candidateIds.has(segment.shiftId)) {
                const impact = restImpacts.get(segment.shiftId)!;
                // Only update if this is the first "before" gap we encounter for this shift
                if (impact.rest_before_hours === null) {
                    impact.rest_before_hours = effectiveGap;
                    impact.before_violation = isViolation;
                }
            }

            // Record violation if applicable
            if (isViolation) {
                // Create violation for the "after" side (previous shift)
                const afterViolation: RestGapViolation = {
                    shiftId: prevSegment.shiftId,
                    otherV8ShiftId: segment.shiftId,
                    gapHours: effectiveGap,
                    requiredHours: minRestHours,
                    violationType: 'after',
                    shiftDate: prevSegment.originalDate,
                    shiftTime: `${prevSegment.originalStart} - ${prevSegment.originalEnd}`
                };

                // Create violation for the "before" side (current shift)
                const beforeViolation: RestGapViolation = {
                    shiftId: segment.shiftId,
                    otherV8ShiftId: prevSegment.shiftId,
                    gapHours: effectiveGap,
                    requiredHours: minRestHours,
                    violationType: 'before',
                    shiftDate: segment.originalDate,
                    shiftTime: `${segment.originalStart} - ${segment.originalEnd}`
                };

                violations.push(afterViolation, beforeViolation);

                // Add to per-shift map
                addToMap(perShiftViolations, prevSegment.shiftId, afterViolation);
                addToMap(perShiftViolations, segment.shiftId, beforeViolation);
            }
        }

        prevSegment = segment;
    }

    return { violations, perShiftViolations, restImpacts };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert a shift to one or more segments (handles cross-midnight).
 * Each segment has absolute start and end datetimes.
 */
function shiftToSegments(shift: ShiftForRestGap, isCandidate: boolean): ShiftSegment[] {
    const date = parseISO(shift.shift_date);
    const startMinutes = parseTimeToMinutes(shift.start_time);
    const endMinutes = parseTimeToMinutes(shift.end_time);

    // Create absolute datetimes
    const startDateTime = new Date(date);
    startDateTime.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

    let endDateTime = new Date(date);

    // Handle cross-midnight
    if (endMinutes <= startMinutes) {
        // Shift ends on the next day
        endDateTime = addDays(date, 1);
        endDateTime.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    } else {
        endDateTime.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    }

    // For rest gap calculation, we don't need to split by day -
    // we just need the absolute start and end times.
    // This is simpler and more accurate than splitting.
    return [{
        shiftId: shift.id,
        startDateTime,
        endDateTime,
        isCandidate,
        originalDate: shift.shift_date,
        originalStart: shift.start_time,
        originalEnd: shift.end_time
    }];
}

/**
 * Add a violation to the per-shift map.
 */
function addToMap(
    map: Map<string, RestGapViolation[]>,
    shiftId: string,
    violation: RestGapViolation
): void {
    const existing = map.get(shiftId) || [];
    existing.push(violation);
    map.set(shiftId, existing);
}

// =============================================================================
// EXPORTS FOR TESTING
// =============================================================================

export { DEFAULT_BULK_REST_HOURS as MIN_REST_HOURS };
