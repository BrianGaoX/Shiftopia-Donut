# R07 Compliance Context: Minimum Rest Gap Between Shifts

This document contains the core implementation of the **R07 Minimum Rest Gap** rule within the Compliance Engine v2. It includes the rule logic, supporting time utilities, core types, and the main orchestrator.

---

## 1. Rule Logic: R07_rest_gap.ts
**Path:** `src/modules/compliance/v2/rules/R07_rest_gap.ts`
```typescript
/**
 * R07 — Minimum Rest Gap Between Shifts
 *
 * Checks each adjacent pair in the sorted relevant_shifts for a sufficient
 * rest gap between the end of shift A and the start of shift B.
 *
 * Uses absolute minutes (toAbsoluteMinutes) for cross-date comparison.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { toAbsoluteMinutes, shiftGrossMinutes } from '../windows';

export const R07_rest_gap: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];
    const minGapMinutes = ctx.config.rest_gap_hours * 60;

    // Sort relevant_shifts by absolute start
    const sorted = [...ctx.relevant_shifts].sort((a, b) =>
        toAbsoluteMinutes(a.shift_date, a.start_time)
        - toAbsoluteMinutes(b.shift_date, b.start_time)
    );

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];

        // Same-day split shifts have no rest gap requirement — only cross-day
        // pairs (different shift_date) must satisfy the minimum rest gap.
        if (a.shift_date === b.shift_date) continue;

        const aStartAbs = toAbsoluteMinutes(a.shift_date, a.start_time);
        const aEndAbs   = aStartAbs + shiftGrossMinutes(a);
        const bStartAbs = toAbsoluteMinutes(b.shift_date, b.start_time);

        // Gap is only meaningful if b starts after a ends (no overlap)
        if (bStartAbs < aEndAbs) continue;    // R01 handles overlap

        const gapMinutes = bStartAbs - aEndAbs;

        if (gapMinutes < minGapMinutes) {
            const gapHours = (gapMinutes / 60).toFixed(2);
            hits.push({
                rule_id:  'R07_REST_GAP',
                severity: 'BLOCKING',
                message:
                    `Only ${gapHours}h rest between ${a.shift_date} ${a.start_time}–${a.end_time} `
                    + `and ${b.shift_date} ${b.start_time}–${b.end_time} `
                    + `— minimum is ${ctx.config.rest_gap_hours}h.`,
                resolution_hint:
                    `Ensure at least ${ctx.config.rest_gap_hours}h gap between these consecutive shifts.`,
                affected_shifts: [a.shift_id, b.shift_id],
            });

            ctx.conflict_pairs.push({
                shift_a:       a.shift_id,
                shift_b:       b.shift_id,
                rule_id:       'R07_REST_GAP',
                conflict_type: 'REST_GAP',
            });
        }
    }

    return hits;
};
```

---

## 2. Window & Time Utilities: windows.ts
**Path:** `src/modules/compliance/v2/windows.ts`
```typescript
/**
 * Compliance Engine v2 — Window & Time Utilities
 * Key improvements: toAbsoluteMinutes for cross-date calculation.
 */

import { ShiftV2, DaySegmentV2, ImpactWindow, ShiftId } from './types';

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY      = 86_400_000;

export function dateToMs(dateStr: string): number {
    return new Date(dateStr + 'T00:00:00Z').getTime();
}

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

export function shiftGrossMinutes(shift: ShiftV2): number {
    const start = parseTimeToMinutes(shift.start_time);
    let   end   = parseTimeToMinutes(shift.end_time);
    if (end <= start) end += MINUTES_PER_DAY;
    return end - start;
}
```

---

## 3. Core Types: types.ts
**Path:** `src/modules/compliance/v2/types.ts`
*(Partial view of relevant types)*
```typescript
export interface ComplianceConfigV2 {
    rest_gap_hours:              number;   // default 10
}

export interface ShiftV2 {
    shift_id:                ShiftId;
    shift_date:              string;    // YYYY-MM-DD
    start_time:              string;    // HH:mm
    end_time:                string;    // HH:mm
    role_id:                 RoleId;
    is_ordinary_hours:       boolean;
    unpaid_break_minutes?:   number;
}

export interface RuleContextV2 {
    relevant_shifts:   ShiftV2[];               
    config:            ComplianceConfigV2;
    conflict_pairs:    ConflictPairV2[];
}

export type RuleEvaluatorV2 = (ctx: RuleContextV2) => RuleHitV2[];
```

---

## 4. Orchestrator: index.ts
**Path:** `src/modules/compliance/v2/index.ts`
```typescript
import { R07_rest_gap } from './rules/R07_rest_gap';

const RULES = [
    // ... other rules
    R07_rest_gap,             // minimum rest between consecutive shifts
];

export function evaluateCompliance(input: ComplianceInputV2, options: EvaluateOptionsV2 = {}) {
    // ... simulation and window scoping ...
    const ctx: RuleContextV2 = {
        // ...
        relevant_shifts:  relevantShifts,
        config:           config,
        conflict_pairs:   conflictPairs,
    };

    const rawHits = rulesToRun.flatMap(rule => rule(ctx));
    // ... aggregation and status derivation ...
}
```
