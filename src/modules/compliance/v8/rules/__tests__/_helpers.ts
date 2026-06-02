/**
 * Shared test helpers for V8 compliance rule tests.
 * Provides deterministic factory functions for V8RuleContext and V8Shift.
 */

import type {
    V8RuleContext,
    V8Shift,
    V8Employee,
    V8Config,
} from '../../types';
import { DEFAULT_V8_CONFIG } from '../../types';

let shiftCounter = 0;

/** Generate a stable unique shift ID for each test invocation */
export function nextId(prefix = 'shift'): string {
    return `${prefix}-${++shiftCounter}`;
}

/** Reset the counter — call in beforeEach if you need predictable IDs */
export function resetIdCounter(): void {
    shiftCounter = 0;
}

/**
 * Minimal V8Shift factory.
 * Defaults: ordinary hours, no break, no training, no holiday.
 */
export function buildShift(overrides: Partial<V8Shift> & { id?: string } = {}): V8Shift {
    const id = overrides.id ?? nextId();
    const date = overrides.date ?? '2026-06-01';
    return {
        id,
        date,
        start_time: '09:00',
        end_time: '17:00',
        is_ordinary_hours: true,
        unpaid_break_minutes: 0,
        is_training: false,
        is_sunday: false,
        is_public_holiday: false,
        ...overrides,
    };
}

/** Minimal V8Employee factory */
export function buildEmployee(
    overrides: Partial<V8Employee> = {},
): V8Employee {
    return {
        id: 'emp-1',
        name: 'Test Employee',
        contract_type: 'FULL_TIME',
        contracted_weekly_hours: 38,
        skill_ids: [],
        license_ids: [],
        ...overrides,
    };
}

/**
 * Full V8RuleContext factory.
 * `shifts` defaults to an empty array — supply your own per-test.
 */
export function buildContext(
    overrides: {
        shifts?: V8Shift[];
        employee?: Partial<V8Employee>;
        config?: Partial<V8Config>;
        candidate_shift?: V8Shift;
        reference_date?: string;
    } = {},
): V8RuleContext {
    const {
        employee: empOverrides,
        config: configOverrides,
        shifts = [],
        candidate_shift,
        reference_date = '2026-06-01',
    } = overrides;
    return {
        employee: buildEmployee(empOverrides),
        shifts,
        config: { ...DEFAULT_V8_CONFIG, ...configOverrides },
        reference_date,
        candidate_shift,
    };
}

/**
 * Build a sequence of N consecutive day shifts starting from startDate.
 * Each shift is 8 hours (09:00-17:00) on consecutive days.
 */
export function buildConsecutiveShifts(
    count: number,
    startDate: string,
    overrides: Partial<V8Shift> = {},
): V8Shift[] {
    const shifts: V8Shift[] = [];
    const base = new Date(startDate + 'T00:00:00Z');
    for (let i = 0; i < count; i++) {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        shifts.push(
            buildShift({ date: dateStr, start_time: '09:00', end_time: '17:00', ...overrides }),
        );
    }
    return shifts;
}
