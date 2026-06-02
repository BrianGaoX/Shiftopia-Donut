/**
 * Hard Validation Module - Improved Version
 * 
 * Runs immediate, blocking validations before compliance engine.
 * Returns detailed context for UI visualizations.
 */

import { ShiftTimeRange } from './types';
import { parseTimeToMinutes, doShiftsOverlap } from './utils';

// =============================================================================
// TYPES
// =============================================================================

export interface HardValidationError {
    code: 'PAST_SHIFT' | 'OVERLAP' | 'INVALID_TIME' | 'DUPLICATE';
    message: string;
    context?: {
        // For overlap errors
        existing_start?: string;
        existing_end?: string;
        existing_date?: string;
        new_start?: string;
        new_end?: string;
        new_date?: string;
        overlap_minutes?: number;
        // For past shift errors
        shift_date?: string;
        current_time?: string;
    };
}

export interface HardValidationResult {
    passed: boolean;
    errors: HardValidationError[];
}

export interface HardValidationInput {
    shift_date: string;
    start_time: string;
    end_time: string;
    employee_id?: string | null;
    existing_shifts: ShiftTimeRange[];
    current_time: Date;
    shift_id?: string; // For edit mode - exclude self
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Run all hard validations.
 * These are blocking issues that prevent shift creation.
 */
export function runHardValidation(input: HardValidationInput): HardValidationResult {
    const errors: HardValidationError[] = [];

    // 1. Check for invalid times
    const timeError = validateTimes(input);
    if (timeError) errors.push(timeError);

    // 2. Check for past shifts (only for new shifts, not edits)
    if (!input.shift_id) {
        const pastError = validateNotInPast(input);
        if (pastError) errors.push(pastError);
    }

    // 3. Check for overlapping shifts
    const overlapErrors = validateNoOverlaps(input);
    errors.push(...overlapErrors);

    return {
        passed: errors.length === 0,
        errors
    };
}

/**
 * Validate time format and logic
 */
function validateTimes(input: HardValidationInput): HardValidationError | null {
    const { start_time, end_time } = input;

    // Check format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
        return {
            code: 'INVALID_TIME',
            message: 'Invalid time format. Use HH:MM (24-hour).',
            context: {
                new_start: start_time,
                new_end: end_time
            }
        };
    }

    // Same start and end is invalid
    if (start_time === end_time) {
        return {
            code: 'INVALID_TIME',
            message: 'Start and end time cannot be the same.',
            context: {
                new_start: start_time,
                new_end: end_time
            }
        };
    }

    return null;
}

/**
 * Validate shift is not in the past
 */
function validateNotInPast(input: HardValidationInput): HardValidationError | null {
    const { shift_date, start_time, current_time } = input;

    // Allow shifts starting today
    const today = new Date(current_time);
    today.setHours(0, 0, 0, 0);

    const shiftDay = new Date(shift_date);
    shiftDay.setHours(0, 0, 0, 0);

    if (shiftDay < today) {
        return {
            code: 'PAST_SHIFT',
            message: 'Cannot create shifts in the past.',
            context: {
                shift_date,
                current_time: current_time.toISOString()
            }
        };
    }

    return null;
}

/**
 * Validate no overlapping shifts for same employee
 */
function validateNoOverlaps(input: HardValidationInput): HardValidationError[] {
    const { shift_date, start_time, end_time, existing_shifts, employee_id, shift_id } = input;
    const errors: HardValidationError[] = [];

    // Skip if no employee assigned
    if (!employee_id) return errors;

    const candidateShift: ShiftTimeRange = {
        shift_date,
        start_time,
        end_time
    };

    for (const existing of existing_shifts) {
        // Skip self in edit mode
        if (shift_id && ((existing as any).id === shift_id || existing.shift_id === shift_id)) continue;

        // Check for overlap
        if (doShiftsOverlap(candidateShift, existing)) {
            const overlapInfo = calculateOverlapDetails(candidateShift, existing);

            errors.push({
                code: 'OVERLAP',
                message: `Shift overlaps with existing shift (${existing.start_time} - ${existing.end_time}). New shift: ${start_time} - ${end_time}`,
                context: {
                    existing_start: existing.start_time,
                    existing_end: existing.end_time,
                    existing_date: existing.shift_date,
                    new_start: start_time,
                    new_end: end_time,
                    new_date: shift_date,
                    overlap_minutes: overlapInfo.overlapMinutes
                }
            });
        }
    }

    return errors;
}

/**
 * Calculate detailed overlap information for visualization
 */
function calculateOverlapDetails(
    shift1: ShiftTimeRange,
    shift2: ShiftTimeRange
): { overlapStart: number; overlapEnd: number; overlapMinutes: number } {
    const start1 = parseTimeToMinutes(shift1.start_time);
    let end1 = parseTimeToMinutes(shift1.end_time);
    if (end1 <= start1) end1 += 24 * 60; // Cross-midnight

    const start2 = parseTimeToMinutes(shift2.start_time);
    let end2 = parseTimeToMinutes(shift2.end_time);
    if (end2 <= start2) end2 += 24 * 60; // Cross-midnight

    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    const overlapMinutes = Math.max(0, overlapEnd - overlapStart);

    return { overlapStart, overlapEnd, overlapMinutes };
}

export default runHardValidation;
