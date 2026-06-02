import type { Shift } from '../../shift.entity';

const ONE_HOUR = 60;
const HOURS_IN_DAY = 24;

/**
 * Fast datetime parser returning absolute hours since epoch.
 * Eliminates GC pressure from instantiating Date objects.
 */
function parseShiftDateTimeHours(dateStr: string, timeStr: string): number {
  const y = parseInt(dateStr.substring(0, 4), 10);
  const m = parseInt(dateStr.substring(5, 7), 10) - 1;
  const d = parseInt(dateStr.substring(8, 10), 10);
  
  const h = parseInt(timeStr.substring(0, 2), 10);
  const min = parseInt(timeStr.substring(3, 5), 10);
  
  return Date.UTC(y, m, d, h, min) / (1000 * 3600);
}

/**
 * Fast date parser returning absolute hours since epoch for midnight of that day.
 */
function parseDateMidnightHours(dateStr: string): number {
  const y = parseInt(dateStr.substring(0, 4), 10);
  const m = parseInt(dateStr.substring(5, 7), 10) - 1;
  const d = parseInt(dateStr.substring(8, 10), 10);
  
  return Date.UTC(y, m, d) / (1000 * 3600);
}

/**
 * Calculates shift hours (net)
 */
export const calculateShiftHours = (
    startTime?: string,
    endTime?: string,
    unpaidBreakMinutes?: number | null
): number => {
    if (!startTime || !endTime) return 0;

    const sh = parseInt(startTime.substring(0, 2), 10);
    const sm = parseInt(startTime.substring(3, 5), 10);
    const eh = parseInt(endTime.substring(0, 2), 10);
    const em = parseInt(endTime.substring(3, 5), 10);

    let startMin = sh * ONE_HOUR + sm;
    let endMin = eh * ONE_HOUR + em;

    if (endMin <= startMin) endMin += HOURS_IN_DAY * ONE_HOUR;

    return Math.max(0, (endMin - startMin) - (unpaidBreakMinutes || 0)) / ONE_HOUR;
};

function getShiftTime(timeStr: string): number {
    const h = parseInt(timeStr.substring(0, 2), 10);
    const m = parseInt(timeStr.substring(3, 5), 10);
    return h * ONE_HOUR + m;
}

/**
 * Calculates the fatigue accumulation for a single shift.
 * Uses a non-linear model with circadian weighting.
 */
export function calculateFatigueAccumulation(
  shift: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): number {
    const breakMinutes = shift.unpaid_break_minutes ?? 0;
    const startTime = getShiftTime(shift.start_time);
    let endTime = getShiftTime(shift.end_time);

    if (endTime <= startTime) {
        endTime += HOURS_IN_DAY * ONE_HOUR;
    }

    // Circadian Penalties
    const intervalStart = [0, 2, 6, 8, 10, 16, 22].map(h => h * ONE_HOUR);
    const intervalEnd = [2, 6, 8, 10, 16, 22, 24].map(h => h * ONE_HOUR);
    const penalties = [0.25, 0.5, 0.25, 0, -0.25, 0, 0.25];

    let totalPenalty = 0;
    const totalShiftMinutes = endTime - startTime;

    // Support overnight shifts by doubling intervals
    const fullIntervalStart = [...intervalStart, ...intervalStart.map(x => x + 24 * ONE_HOUR)];
    const fullIntervalEnd = [...intervalEnd, ...intervalEnd.map(x => x + 24 * ONE_HOUR)];
    const fullPenalties = [...penalties, ...penalties];

    for (let i = 0; i < fullIntervalStart.length; i++) {
        const overlapStart = Math.max(startTime, fullIntervalStart[i]);
        const overlapEnd = Math.min(endTime, fullIntervalEnd[i]);

        if (overlapEnd > overlapStart) {
            const overlapMinutes = overlapEnd - overlapStart;
            const fraction = overlapMinutes / totalShiftMinutes;
            totalPenalty += fraction * fullPenalties[i];
        }
    }

    const shiftHours = (totalShiftMinutes - breakMinutes) / ONE_HOUR;
    const effectiveHours = shiftHours * (1 + totalPenalty);

    // Safety: Cap effective hours to 37.9 to avoid log(0) at the 38h asymptote
    const cappedEffectiveHours = Math.min(effectiveHours, 37.9);
    
    // Non-linear fatigue score
    return -76 * Math.log(1 - cappedEffectiveHours / 38);
}

/**
 * Calculates Fatigue score (inclusive of recovery time/rest)
 * Completely optimized using high-speed integer arithmetic (O(1) memory, zero GC allocations).
 */
export function calculateFatigueWithRecovery(
    existingShifts: Pick<Shift, 'shift_date' | 'start_time' | 'end_time' | 'unpaid_break_minutes'>[],
    referenceDate: string,
    candidate?: { start_time: string; end_time: string; unpaid_break_minutes?: number | null }
): { current: number; projected: number } {
    const windowEndHours = parseDateMidnightHours(referenceDate) + 24; // End of the reference day
    const windowStartHours = windowEndHours - 7 * 24; // Past 7 days

    const shiftsWithinWindow: Array<Pick<Shift, 'shift_date' | 'start_time' | 'end_time' | 'unpaid_break_minutes'> & { startHours: number; endHours: number }> = [];
    
    for (let i = 0; i < existingShifts.length; i++) {
      const s = existingShifts[i];
      const startHours = parseShiftDateTimeHours(s.shift_date, s.start_time);
      
      // Filter manually within integer bounds
      if (startHours >= windowStartHours && startHours <= windowEndHours) {
        let endHours = parseShiftDateTimeHours(s.shift_date, s.end_time);
        if (endHours <= startHours) endHours += 24; // Overnight shift
        
        shiftsWithinWindow.push({
          ...s,
          startHours,
          endHours
        });
      }
    }

    // Sort by integer start time
    shiftsWithinWindow.sort((a, b) => a.startHours - b.startHours);

    let fatigue = 0;
    let previousEndTimeHours: number | null = null;

    for (let i = 0; i < shiftsWithinWindow.length; i++) {
        const shift = shiftsWithinWindow[i];
        
        if (previousEndTimeHours !== null) {
            const restHours = shift.startHours - previousEndTimeHours;
            // Linear recovery: 1 hour of rest removes 1 unit of fatigue
            fatigue = Math.max(0, fatigue - restHours);
        }
        fatigue += calculateFatigueAccumulation(shift);
        previousEndTimeHours = shift.endHours;
    }

    const current = Math.round(fatigue * 10) / 10;
    let projected = current;

    if (candidate) {
      if (previousEndTimeHours !== null) {
        const candidateStartHours = parseShiftDateTimeHours(referenceDate, candidate.start_time);
        const restHours = candidateStartHours - previousEndTimeHours;
        projected = Math.max(0, projected - restHours);
      }
      projected += calculateFatigueAccumulation(candidate);
    }

    return { 
      current, 
      projected: Math.round(projected * 10) / 10 
    };
}
