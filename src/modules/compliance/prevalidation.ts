/**
 * Pre-Validation Engine (Hard Validation - Layer 1)
 * 
 * Purpose: Block logically impossible shifts BEFORE compliance runs.
 * These are hard constraints, not policy rules.
 * 
 * Rules:
 * - FUTURE_TIME: Same-day shifts must start >= now
 * - NO_OVERLAP: No overlapping shifts for same employee
 * - VALID_RANGE: End time must be after start time (or overnight)
 */

import { ShiftTimeRange } from './types';
import { parseTimeToMinutes, doShiftsOverlap } from './utils';
import { getSydneyNow } from '@/modules/core/lib/date.utils';

// =============================================================================
// TYPES
// =============================================================================

export interface HardValidationError {
    field: string;      // Which field has the error
    rule: string;       // Rule ID
    message: string;    // Human-readable error message
}

export interface HardValidationResult {
    passed: boolean;
    errors: HardValidationError[];
}

export interface HardValidationInput {
    shift_date: string;           // YYYY-MM-DD
    start_time: string;           // HH:mm
    end_time: string;             // HH:mm
    employee_id?: string | null;  // For overlap check
    existing_shifts?: ShiftTimeRange[];  // Employee's existing shifts
    current_time?: Date;          // For testing (defaults to now)
    is_template?: boolean;        // Skip date/time validation for templates
    shift_id?: string;            // For edit mode - exclude self
}

// =============================================================================
// VALIDATION RULES
// =============================================================================

/**
 * Check if start time is in the past for same-day shifts
 */
function validateFutureTime(input: HardValidationInput): HardValidationError | null {
    const now = input.current_time || getSydneyNow();
    const today = now.toISOString().split('T')[0];  // YYYY-MM-DD

    // Only validate same-day shifts
    if (input.shift_date !== today || input.is_template) {
        // Past dates are blocked elsewhere
        // Future dates are always valid for time
        return null;
    }

    // Parse current time to minutes
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = parseTimeToMinutes(input.start_time);

    if (startMinutes < currentMinutes) {
        const formattedNow = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        return {
            field: 'start_time',
            rule: 'FUTURE_TIME',
            message: `Shift cannot start in the past. Current time is ${formattedNow}.`
        };
    }

    return null;
}

/**
 * Check for overlapping shifts for the same employee
 */
function validateNoOverlap(input: HardValidationInput): HardValidationError | null {
    // Skip if no employee assigned or no existing shifts
    if (!input.employee_id || !input.existing_shifts || input.existing_shifts.length === 0) {
        return null;
    }

    const candidateShift: ShiftTimeRange = {
        start_time: input.start_time,
        end_time: input.end_time,
        shift_date: input.shift_date
    };

    const excludeId = input.shift_id;

    for (const existing of input.existing_shifts) {
        // Skip self in edit mode
        if (excludeId && (existing.shift_id === excludeId || (existing as any).id === excludeId)) {
            continue;
        }

        if (doShiftsOverlap(candidateShift, existing)) {
            return {
                field: 'start_time',
                rule: 'NO_OVERLAP',
                message: `Overlaps with existing shift (${existing.start_time} - ${existing.end_time})`
            };
        }
    }

    return null;
}

/**
 * Check if time range is valid (end > start, or overnight)
 */
function validateTimeRange(input: HardValidationInput): HardValidationError | null {
    if (!input.start_time || !input.end_time) {
        return null;  // Let form validation handle required fields
    }

    const start = parseTimeToMinutes(input.start_time);
    const end = parseTimeToMinutes(input.end_time);

    // Same time is invalid
    if (start === end) {
        return {
            field: 'end_time',
            rule: 'VALID_RANGE',
            message: 'End time cannot be the same as start time'
        };
    }

    // Note: end < start is valid (overnight shift), so we don't block that
    return null;
}

/**
 * Check if shift date is in the past
 */
function validateNotPastDate(input: HardValidationInput): HardValidationError | null {
    const now = input.current_time || getSydneyNow();
    const today = now.toISOString().split('T')[0];

    if (input.shift_date < today && !input.is_template) {
        return {
            field: 'shift_date',
            rule: 'PAST_DATE',
            message: 'Cannot create shifts on past dates'
        };
    }

    return null;
}

// =============================================================================
// MAIN VALIDATION FUNCTION
// =============================================================================

/**
 * Run all hard validation rules.
 * Returns immediately usable result for UI blocking.
 */
export function runHardValidation(input: HardValidationInput): HardValidationResult {
    const errors: HardValidationError[] = [];

    // Run all rules and collect errors
    // Past date and future time errors are skipped for existing shifts (edit mode)
    if (!input.shift_id) {
        const pastDateError = validateNotPastDate(input);
        if (pastDateError) errors.push(pastDateError);

        const futureTimeError = validateFutureTime(input);
        if (futureTimeError) errors.push(futureTimeError);
    }

    const rangeError = validateTimeRange(input);
    if (rangeError) errors.push(rangeError);

    // Overlap handled by compliance engine (NoOverlapRule) but also here for immediate Level 1 blocking
    const overlapError = validateNoOverlap(input);
    if (overlapError) errors.push(overlapError);

    return {
        passed: errors.length === 0,
        errors
    };
}

/**
 * Get error message for a specific field
 */
export function getFieldError(result: HardValidationResult, field: string): string | null {
    const error = result.errors.find(e => e.field === field);
    return error?.message || null;
}

/**
 * Check if a specific rule failed
 */
export function hasRuleError(result: HardValidationResult, rule: string): boolean {
    return result.errors.some(e => e.rule === rule);
}
