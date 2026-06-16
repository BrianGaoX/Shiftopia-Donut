/**
 * F1 — Fairness Ledger Domain Logic Tests.
 *
 * Covers:
 *   - Shift classification (weekend, night, PH)
 *   - Debt computation from raw entries
 *   - Metric aggregation from shifts
 *   - Objective coefficient conversion
 */
import { describe, it, expect } from 'vitest';
import {
    isWeekendShift,
    isNightShift,
    classifyShift,
    computeDebts,
    aggregateShiftsToEntries,
    debtToObjectiveCoeff,
    debtsToMap,
    type EmployeeLedgerEntry,
    type FairnessDebt,
    type ShiftFairnessFlags,
    type ShiftForFairness,
} from '../fairness-ledger';

// ─── isWeekendShift ─────────────────────────────────────────────────────────────

describe('isWeekendShift', () => {
    it('returns true for Saturday', () => {
        // 2026-06-13 is a Saturday
        expect(isWeekendShift('2026-06-13')).toBe(true);
    });

    it('returns true for Sunday', () => {
        // 2026-06-14 is a Sunday
        expect(isWeekendShift('2026-06-14')).toBe(true);
    });

    it('returns false for Monday–Friday', () => {
        // 2026-06-15 is Monday
        expect(isWeekendShift('2026-06-15')).toBe(false);
        // 2026-06-16 is Tuesday
        expect(isWeekendShift('2026-06-16')).toBe(false);
        // 2026-06-17 is Wednesday
        expect(isWeekendShift('2026-06-17')).toBe(false);
        // 2026-06-18 is Thursday
        expect(isWeekendShift('2026-06-18')).toBe(false);
        // 2026-06-19 is Friday
        expect(isWeekendShift('2026-06-19')).toBe(false);
    });
});

// ─── isNightShift ───────────────────────────────────────────────────────────────

describe('isNightShift', () => {
    it('returns true for shift entirely in night zone (00:00–06:00)', () => {
        expect(isNightShift('01:00', '05:00')).toBe(true);
    });

    it('returns true for shift starting before and ending in night zone', () => {
        expect(isNightShift('00:00', '03:00')).toBe(true);
    });

    it('returns true for cross-midnight shift that enters night zone', () => {
        // 22:00 → 04:00 (next day) — overlaps 00:00–06:00
        expect(isNightShift('22:00', '04:00')).toBe(true);
    });

    it('returns true for shift overlapping tail of night zone', () => {
        // 05:00 → 07:00 — overlaps 05:00–06:00
        expect(isNightShift('05:00', '07:00')).toBe(true);
    });

    it('returns false for daytime shift', () => {
        expect(isNightShift('09:00', '17:00')).toBe(false);
    });

    it('returns false for evening shift ending before midnight', () => {
        expect(isNightShift('18:00', '23:00')).toBe(false);
    });

    it('returns true for shift starting at 23:00 ending at 02:00', () => {
        expect(isNightShift('23:00', '02:00')).toBe(true);
    });

    it('returns false for shift exactly at 06:00–12:00', () => {
        expect(isNightShift('06:00', '12:00')).toBe(false);
    });
});

// ─── classifyShift ──────────────────────────────────────────────────────────────

describe('classifyShift', () => {
    it('classifies a Saturday night shift on a public holiday', () => {
        // 2026-12-26 is Saturday + Boxing Day
        const result = classifyShift('2026-12-26', '23:00', '05:00');
        expect(result.isWeekend).toBe(true);
        expect(result.isNight).toBe(true);
        expect(result.isPublicHoliday).toBe(true);
        expect(result.durationMinutes).toBe(360); // 6h
    });

    it('classifies a regular Monday daytime shift', () => {
        const result = classifyShift('2026-06-15', '09:00', '17:00');
        expect(result.isWeekend).toBe(false);
        expect(result.isNight).toBe(false);
        expect(result.isPublicHoliday).toBe(false);
        expect(result.durationMinutes).toBe(480); // 8h
    });

    it('uses custom PH set when provided', () => {
        const customPH = new Set(['2026-06-15']);
        const result = classifyShift('2026-06-15', '09:00', '17:00', customPH);
        expect(result.isPublicHoliday).toBe(true);
    });
});

// ─── computeDebts ───────────────────────────────────────────────────────────────

describe('computeDebts', () => {
    it('computes correct debts for 3 employees', () => {
        const entries: EmployeeLedgerEntry[] = [
            { employeeId: 'A', values: { weekend_shifts: 5, night_shifts: 2, public_holiday_shifts: 1, overtime_minutes: 60, total_hours: 120, denied_preferences: 4 } },
            { employeeId: 'B', values: { weekend_shifts: 2, night_shifts: 2, public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 100, denied_preferences: 2 } },
            { employeeId: 'C', values: { weekend_shifts: 0, night_shifts: 4, public_holiday_shifts: 2, overtime_minutes: 30, total_hours: 110, denied_preferences: 0 } },
        ];

        const debts = computeDebts(entries);

        // Weekend: avg = (5+2+0)/3 = 2.33
        const weekendDebts = debts.filter(d => d.metric === 'weekend_shifts');
        expect(weekendDebts).toHaveLength(3);

        const aWeekend = weekendDebts.find(d => d.employeeId === 'A')!;
        expect(aWeekend.rollingValue).toBe(5);
        expect(aWeekend.teamAverage).toBeCloseTo(2.33, 1);
        expect(aWeekend.debt).toBeCloseTo(2.67, 1); // 5 - 2.33

        const cWeekend = weekendDebts.find(d => d.employeeId === 'C')!;
        expect(cWeekend.debt).toBeCloseTo(-2.33, 1); // 0 - 2.33

        // Preferences: avg = (4+2+0)/3 = 2.0
        const prefDebts = debts.filter(d => d.metric === 'denied_preferences');
        expect(prefDebts).toHaveLength(3);
        const aPref = prefDebts.find(d => d.employeeId === 'A')!;
        expect(aPref.debt).toBe(2); // 4 - 2
    });

    it('returns zero debts when all employees are equal', () => {
        const entries: EmployeeLedgerEntry[] = [
            { employeeId: 'A', values: { weekend_shifts: 3, night_shifts: 3, public_holiday_shifts: 1, overtime_minutes: 0, total_hours: 100, denied_preferences: 2 } },
            { employeeId: 'B', values: { weekend_shifts: 3, night_shifts: 3, public_holiday_shifts: 1, overtime_minutes: 0, total_hours: 100, denied_preferences: 2 } },
        ];

        const debts = computeDebts(entries);
        for (const d of debts) {
            expect(d.debt).toBe(0);
        }
    });

    it('returns empty array for empty input', () => {
        expect(computeDebts([])).toEqual([]);
    });

    it('handles single employee (debt = 0)', () => {
        const entries: EmployeeLedgerEntry[] = [
            { employeeId: 'A', values: { weekend_shifts: 5, night_shifts: 0, public_holiday_shifts: 0, overtime_minutes: 0, total_hours: 40, denied_preferences: 1 } },
        ];
        const debts = computeDebts(entries);
        for (const d of debts) {
            expect(d.debt).toBe(0);
            expect(d.rollingValue).toBe(d.teamAverage);
        }
    });
});

// ─── aggregateShiftsToEntries ───────────────────────────────────────────────────

describe('aggregateShiftsToEntries', () => {
    it('aggregates shifts by employee correctly', () => {
        const shifts: Array<ShiftForFairness & { flags: ShiftFairnessFlags }> = [
            { shiftDate: '2026-06-13', startTime: '09:00', endTime: '17:00', employeeId: 'A', flags: { isWeekend: true, isNight: false, isPublicHoliday: false, durationMinutes: 480 } },
            { shiftDate: '2026-06-14', startTime: '22:00', endTime: '06:00', employeeId: 'A', flags: { isWeekend: true, isNight: true, isPublicHoliday: false, durationMinutes: 480 } },
            { shiftDate: '2026-06-15', startTime: '09:00', endTime: '17:00', employeeId: 'B', flags: { isWeekend: false, isNight: false, isPublicHoliday: false, durationMinutes: 480 } },
        ];

        const deniedPrefs = new Map([['A', 3], ['C', 1]]);
        const entries = aggregateShiftsToEntries(shifts, undefined, undefined, deniedPrefs);

        const entryA = entries.find(e => e.employeeId === 'A')!;
        expect(entryA.values.weekend_shifts).toBe(2);
        expect(entryA.values.night_shifts).toBe(1);
        expect(entryA.values.total_hours).toBe(16); // 960 min / 60
        expect(entryA.values.denied_preferences).toBe(3);

        const entryB = entries.find(e => e.employeeId === 'B')!;
        expect(entryB.values.weekend_shifts).toBe(0);
        expect(entryB.values.night_shifts).toBe(0);
        expect(entryB.values.total_hours).toBe(8);
        expect(entryB.values.denied_preferences).toBe(0);

        const entryC = entries.find(e => e.employeeId === 'C')!;
        expect(entryC.values.denied_preferences).toBe(1);
        expect(entryC.values.total_hours).toBe(0);
    });

    it('deducts unpaid breaks from total hours', () => {
        const shifts: Array<ShiftForFairness & { flags: ShiftFairnessFlags }> = [
            { shiftDate: '2026-06-15', startTime: '09:00', endTime: '17:00', employeeId: 'A', unpaidBreakMinutes: 30, flags: { isWeekend: false, isNight: false, isPublicHoliday: false, durationMinutes: 480 } },
        ];

        const entries = aggregateShiftsToEntries(shifts);
        expect(entries[0].values.total_hours).toBe(7.5); // (480-30)/60
    });
});

// ─── debtToObjectiveCoeff ───────────────────────────────────────────────────────

describe('debtToObjectiveCoeff', () => {
    it('returns 0 for zero debt', () => {
        expect(debtToObjectiveCoeff(0, 'weekend_shifts')).toBe(0);
    });

    it('returns positive coefficient for positive debt (penalty)', () => {
        // Employee has done 2 more weekend shifts than average
        const coeff = debtToObjectiveCoeff(2, 'weekend_shifts', 50);
        expect(coeff).toBe(600); // 2 × 300 × 1.0
        expect(coeff).toBeGreaterThan(0);
    });

    it('returns negative coefficient for negative debt (bonus)', () => {
        // Employee has done 2 fewer weekend shifts than average
        const coeff = debtToObjectiveCoeff(-2, 'weekend_shifts', 50);
        expect(coeff).toBe(-600);
        expect(coeff).toBeLessThan(0);
    });

    it('scales with fairness weight', () => {
        const coeff50 = debtToObjectiveCoeff(1, 'weekend_shifts', 50); // weight=50 → mult=1.0
        const coeff100 = debtToObjectiveCoeff(1, 'weekend_shifts', 100); // weight=100 → mult=2.0
        const coeff0 = debtToObjectiveCoeff(1, 'weekend_shifts', 0); // weight=0 → mult=0.5

        expect(coeff100).toBe(coeff50 * 2);
        expect(coeff0).toBe(Math.round(coeff50 * 0.5));
    });

    it('uses higher coefficient for PH than weekends', () => {
        const weekendCoeff = debtToObjectiveCoeff(1, 'weekend_shifts');
        const phCoeff = debtToObjectiveCoeff(1, 'public_holiday_shifts');
        expect(phCoeff).toBeGreaterThan(weekendCoeff);
    });
});

// ─── debtsToMap ─────────────────────────────────────────────────────────────────

describe('debtsToMap', () => {
    it('groups debts by employee', () => {
        const debts: FairnessDebt[] = [
            { employeeId: 'A', metric: 'weekend_shifts', rollingValue: 5, teamAverage: 3, debt: 2 },
            { employeeId: 'A', metric: 'night_shifts', rollingValue: 1, teamAverage: 2, debt: -1 },
            { employeeId: 'B', metric: 'weekend_shifts', rollingValue: 1, teamAverage: 3, debt: -2 },
        ];

        const map = debtsToMap(debts);

        expect(map.get('A')).toEqual({ weekend_shifts: 2, night_shifts: -1 });
        expect(map.get('B')).toEqual({ weekend_shifts: -2 });
        expect(map.has('C')).toBe(false);
    });
});
