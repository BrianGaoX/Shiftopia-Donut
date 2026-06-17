/**
 * Workload utilities — the SINGLE source of truth for utilization and fatigue
 * scoring across People Mode.
 *
 * Two code paths render the same `ProjectedEmployee.utilization` / `fatigueScore`:
 *   1. people.projector.ts        — runs inside the worker, per shift chunk
 *   2. projection.worker.pool.ts  — merges chunk partials on the main thread
 *
 * Historically each computed utilization with its own formula (one divided
 * hours by minutes — a 60× unit bug). Both now call the helpers below so the
 * number is identical regardless of how the pool split the work.
 */

import { calculateFatigueWithRecovery } from './fatigue';

const DAYS_PER_WEEK = 7;

/**
 * Contracted hours scaled to the visible period.
 *
 * `contracted_weekly_hours` is a WEEKLY figure (e.g. 38), but `currentHours`
 * sums every shift in the visible range — a week, a month, etc. To compare
 * like-for-like we scale the weekly contract by the number of days on screen.
 *
 * Falls back to a 7-day window when `rangeDays` is missing so a stray caller
 * never divides by zero.
 */
export function periodContractedHours(
  contractedWeeklyHours: number | undefined | null,
  rangeDays: number | undefined,
): number {
  if (!contractedWeeklyHours || contractedWeeklyHours <= 0) return 0;
  const days = rangeDays && rangeDays > 0 ? rangeDays : DAYS_PER_WEEK;
  return contractedWeeklyHours * (days / DAYS_PER_WEEK);
}

/**
 * Period-aware utilization %. Returns 0 when there is no contract to measure
 * against (e.g. the unassigned "Open Shifts" bucket).
 */
export function computeUtilizationPct(
  currentHours: number,
  contractedWeeklyHours: number | undefined | null,
  rangeDays: number | undefined,
): number {
  const periodContract = periodContractedHours(contractedWeeklyHours, rangeDays);
  if (periodContract <= 0) return 0;
  return (currentHours / periodContract) * 100;
}

/** True when scheduled hours exceed the period-scaled contract. */
export function isOverContractedHours(
  currentHours: number,
  contractedWeeklyHours: number | undefined | null,
  rangeDays: number | undefined,
): boolean {
  const periodContract = periodContractedHours(contractedWeeklyHours, rangeDays);
  return periodContract > 0 && currentHours > periodContract;
}

type FatigueShift = {
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes?: number | null;
};

/**
 * Peak projected fatigue across the employee's roster.
 *
 * `calculateFatigueWithRecovery` measures fatigue in a trailing 7-day window
 * ending at its `referenceDate`. Anchoring that to "today" (as the projector
 * used to) reads 0 for any roster planned in the future. Instead we anchor the
 * window to each shift's own date — matching the auto-scheduler's convention
 * (AutoSchedulerPanel uses `proposal.shiftDate`) — and take the worst point.
 */
export function computePeakFatigue(shifts: FatigueShift[]): number {
  if (shifts.length === 0) return 0;
  const referenceDates = Array.from(new Set(shifts.map((s) => s.shift_date)));
  let peak = 0;
  for (const referenceDate of referenceDates) {
    const { current } = calculateFatigueWithRecovery(shifts, referenceDate);
    if (current > peak) peak = current;
  }
  return peak;
}
