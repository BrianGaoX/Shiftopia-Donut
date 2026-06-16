/**
 * F1 — Longitudinal Fairness Ledger: Domain Logic.
 *
 * Pure, deterministic, dependency-free functions for:
 *   1. Classifying shifts by fairness-relevant dimensions (weekend, night, PH).
 *   2. Computing per-employee fairness debts from raw metric counts.
 *   3. Converting debts into objective coefficients for the solver.
 *
 * Matches the optimizer's shift classification (model_builder.py SC-10):
 *   - Weekend: Saturday (day 6) or Sunday (day 0).
 *   - Night:   shift window overlaps 00:00–06:00 (360 minutes into the day).
 *   - PH:      shift date is in the public holiday set.
 *
 * Backward-compatibility: when no ledger data exists, all debts are zero
 * and the solver's existing per-run balance (SC-10) continues to operate
 * unchanged — the feature is purely additive.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

/** The fairness dimensions tracked by the ledger. */
export type FairnessMetric =
    | 'weekend_shifts'
    | 'night_shifts'
    | 'public_holiday_shifts'
    | 'overtime_minutes'
    | 'total_hours'
    | 'denied_preferences';

export const ALL_FAIRNESS_METRICS: readonly FairnessMetric[] = [
    'weekend_shifts',
    'night_shifts',
    'public_holiday_shifts',
    'overtime_minutes',
    'total_hours',
    'denied_preferences',
] as const;

/** Classification result for a single shift. */
export interface ShiftFairnessFlags {
    isWeekend: boolean;
    isNight: boolean;
    isPublicHoliday: boolean;
    durationMinutes: number;
}

/** A single employee's metric values for one ledger snapshot. */
export interface EmployeeLedgerEntry {
    employeeId: string;
    values: Record<FairnessMetric, number>;
}

/** Per-employee, per-metric debt (value − team average). */
export interface FairnessDebt {
    employeeId: string;
    metric: FairnessMetric;
    rollingValue: number;
    teamAverage: number;
    /** Positive = has done MORE than average (owed rest).
     *  Negative = has done LESS than average (owes work). */
    debt: number;
}

/** Minimal shift representation for classification. */
export interface ShiftForFairness {
    shiftDate: string;     // YYYY-MM-DD
    startTime: string;     // HH:MM
    endTime: string;       // HH:MM
    employeeId: string;
    id?: string;
    durationMinutes?: number;
    unpaidBreakMinutes?: number;
}

// ─── Default rolling window ─────────────────────────────────────────────────────

/** Default rolling window in days (13 weeks ≈ 1 quarter). */
export const DEFAULT_WINDOW_DAYS = 91;

// ─── Australian public holidays (NSW, hardcoded baseline) ───────────────────────
// In production this would come from a Supabase lookup. For now, a small static
// set covers the common ones. The classifier accepts an injected set to override.

const AU_PUBLIC_HOLIDAYS_2026: ReadonlySet<string> = new Set([
    '2026-01-01', // New Year's Day
    '2026-01-26', // Australia Day
    '2026-04-03', // Good Friday
    '2026-04-04', // Easter Saturday
    '2026-04-06', // Easter Monday
    '2026-04-25', // ANZAC Day
    '2026-06-08', // Queen's Birthday (NSW)
    '2026-08-03', // Bank Holiday (NSW)
    '2026-10-05', // Labour Day (NSW)
    '2026-12-25', // Christmas Day
    '2026-12-26', // Boxing Day
]);

// ─── Time helpers ───────────────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + (m || 0);
}

function shiftDurationMinutes(startTime: string, endTime: string): number {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (end <= start) end += 1440; // cross-midnight
    return end - start;
}

// ─── Shift Classification ───────────────────────────────────────────────────────

/**
 * Classify a shift by fairness-relevant dimensions.
 *
 * @param shiftDate     YYYY-MM-DD
 * @param startTime     HH:MM
 * @param endTime       HH:MM
 * @param publicHolidays  Optional set of YYYY-MM-DD strings. Defaults to AU 2026.
 */
export function classifyShift(
    shiftDate: string,
    startTime: string,
    endTime: string,
    publicHolidays: ReadonlySet<string> = AU_PUBLIC_HOLIDAYS_2026,
): ShiftFairnessFlags {
    return {
        isWeekend: isWeekendShift(shiftDate),
        isNight: isNightShift(startTime, endTime),
        isPublicHoliday: publicHolidays.has(shiftDate),
        durationMinutes: shiftDurationMinutes(startTime, endTime),
    };
}

/**
 * True if the shift falls on a Saturday or Sunday.
 * The optimizer (SC-10) currently only flags Sunday via `is_sunday` — we extend
 * to Saturday too for true weekend fairness across the ledger.
 */
export function isWeekendShift(shiftDate: string): boolean {
    const day = new Date(shiftDate + 'T12:00:00').getDay(); // noon to avoid TZ edge
    return day === 0 || day === 6; // Sunday=0, Saturday=6
}

/**
 * True if the shift window overlaps the night zone 00:00–06:00.
 * Matches `_is_night` in model_builder.py (lines 1414–1425).
 */
export function isNightShift(startTime: string, endTime: string): boolean {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (end <= start) end += 1440; // cross-midnight

    // Night zone: 00:00–06:00 (minutes 0–360).
    // For cross-midnight shifts, also check 1440–1800 (next day's 00:00–06:00).
    const nightEnd = 360;
    const nextNightStart = 1440;
    const nextNightEnd = 1800;

    return (
        (start < nightEnd && end > 0) ||
        (start < nextNightEnd && end > nextNightStart)
    );
}

// ─── Debt Computation ───────────────────────────────────────────────────────────

/**
 * Compute per-employee, per-metric fairness debts from raw ledger entries.
 *
 * For each metric, computes the team average and each employee's deviation.
 *   debt = rolling_value − team_average
 *   - Positive debt → employee has done MORE than average (owed a break).
 *   - Negative debt → employee has done LESS than average (owes work).
 *
 * Pure, deterministic. Returns one `FairnessDebt` per (employee, metric) pair.
 */
export function computeDebts(entries: EmployeeLedgerEntry[]): FairnessDebt[] {
    if (entries.length === 0) return [];

    const debts: FairnessDebt[] = [];

    for (const metric of ALL_FAIRNESS_METRICS) {
        const values = entries.map(e => e.values[metric] ?? 0);
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;

        for (let i = 0; i < entries.length; i++) {
            const value = values[i];
            debts.push({
                employeeId: entries[i].employeeId,
                metric,
                rollingValue: value,
                teamAverage: round2(avg),
                debt: round2(value - avg),
            });
        }
    }

    return debts;
}

/**
 * Aggregate a list of classified shifts into per-employee metric counts.
 *
 * @param shifts   Classified shift data.
 * @param contractedHoursPerWeek  Map of employeeId → contracted weekly hours.
 *                                Used to compute overtime. Defaults to 38h if absent.
 * @param windowWeeks  Number of weeks in the rolling window (for OT calculation).
 */
export function aggregateShiftsToEntries(
    shifts: Array<ShiftForFairness & { flags: ShiftFairnessFlags }>,
    contractedHoursPerWeek?: Map<string, number>,
    windowWeeks = DEFAULT_WINDOW_DAYS / 7,
    deniedPreferencesCount?: Map<string, number>,
): EmployeeLedgerEntry[] {
    const byEmployee = new Map<string, {
        weekend: number;
        night: number;
        ph: number;
        totalMinutes: number;
    }>();

    for (const s of shifts) {
        const cur = byEmployee.get(s.employeeId) ?? { weekend: 0, night: 0, ph: 0, totalMinutes: 0 };
        const netMinutes = s.flags.durationMinutes - (s.unpaidBreakMinutes ?? 0);
        cur.totalMinutes += Math.max(0, netMinutes);
        if (s.flags.isWeekend) cur.weekend++;
        if (s.flags.isNight) cur.night++;
        if (s.flags.isPublicHoliday) cur.ph++;
        byEmployee.set(s.employeeId, cur);
    }

    const entries: EmployeeLedgerEntry[] = [];
    for (const [employeeId, agg] of byEmployee) {
        const contractedWeekly = contractedHoursPerWeek?.get(employeeId) ?? 38;
        const contractedTotalMinutes = contractedWeekly * 60 * windowWeeks;
        const overtimeMinutes = Math.max(0, agg.totalMinutes - contractedTotalMinutes);

        entries.push({
            employeeId,
            values: {
                weekend_shifts: agg.weekend,
                night_shifts: agg.night,
                public_holiday_shifts: agg.ph,
                overtime_minutes: overtimeMinutes,
                total_hours: round2(agg.totalMinutes / 60),
                denied_preferences: deniedPreferencesCount?.get(employeeId) ?? 0,
            },
        });
    }

    // Add entries for employees who only have denied preferences but worked 0 shifts
    if (deniedPreferencesCount) {
        for (const [employeeId, count] of deniedPreferencesCount) {
            if (!byEmployee.has(employeeId)) {
                entries.push({
                    employeeId,
                    values: {
                        weekend_shifts: 0,
                        night_shifts: 0,
                        public_holiday_shifts: 0,
                        overtime_minutes: 0,
                        total_hours: 0,
                        denied_preferences: count,
                    },
                });
            }
        }
    }

    return entries;
}

// ─── Objective Coefficient Conversion ───────────────────────────────────────────

/**
 * Default coefficient scales per metric (in solver-penalty-cents per unit of debt).
 *
 * Sized to sit between SC-10 (intra-run balance, ~50¢/shift) and SC-1
 * (labour cost, ~$25/shift) — roughly $2–5 per unit of debt — so the ledger
 * is meaningful but doesn't override coverage or hard constraints.
 */
const DEFAULT_COEFFICIENTS: Record<FairnessMetric, number> = {
    weekend_shifts: 300,            // 300¢ ($3.00) per weekend-shift debt unit
    night_shifts: 300,              // 300¢ ($3.00) per night-shift debt unit
    public_holiday_shifts: 500,     // 500¢ ($5.00) per PH-shift debt unit (scarcer)
    overtime_minutes: 2,            // 2¢ per OT-minute debt unit (~$1.20/hr)
    total_hours: 10,                // 10¢ per total-hour debt unit
    denied_preferences: 200,        // 200¢ ($2.00) bonus per denied preference
};

/**
 * Convert a fairness debt into an objective coefficient for the solver.
 *
 * @param debt     The employee's debt for this metric.
 * @param metric   Which metric.
 * @param weight   Fairness weight from the strategy (0–100). Default 50.
 *                 Symmetric exponential: 0→0.5×, 50→1.0×, 100→2.0×.
 * @returns        Penalty in solver cents. Positive = penalise assigning more.
 *                 Negative = bonus for assigning more (employee is owed).
 */
export function debtToObjectiveCoeff(
    debt: number,
    metric: FairnessMetric,
    weight = 50,
): number {
    if (debt === 0) return 0;
    const mult = Math.pow(2, (weight - 50) / 50); // _strategy_mult mirror
    const baseCoeff = DEFAULT_COEFFICIENTS[metric] ?? 100;
    return Math.round(debt * baseCoeff * mult);
}

/**
 * Build a map of employeeId → per-metric debt values from a flat debt array.
 * Convenience for the auto-scheduler to attach to OptimizerEmployee.
 */
export function debtsToMap(debts: FairnessDebt[]): Map<string, Record<string, number>> {
    const map = new Map<string, Record<string, number>>();
    for (const d of debts) {
        const existing = map.get(d.employeeId) ?? {};
        existing[d.metric] = d.debt;
        map.set(d.employeeId, existing);
    }
    return map;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
