/**
 * DST / timezone test suite for V8 time helpers and rules.
 *
 * Australian DST in 2026:
 *   Spring forward: 2026-10-04 (2 AM → 3 AM)
 *   Fall back:      2026-04-05 (3 AM → 2 AM)
 *
 * The V8 engine works in YYYY-MM-DD strings and HH:mm strings. Internal time
 * math in windows.ts uses `new Date(dateStr + 'T00:00:00Z')` (epoch ms, UTC).
 * This suite documents the engine's current behaviour around DST boundaries
 * and pins assumptions that future refactors must preserve.
 */

import { describe, it, expect } from 'vitest';
import { dateToMs, addDays } from '../orchestrator/windows';
import { minRestGapRule } from '../rules/rest-requirements';
import { maxDailyHoursRule } from '../rules/daily-limits';
import { buildContext, buildShift } from '../rules/__tests__/_helpers';

describe('DST — date helpers', () => {
  it('addDays produces correct calendar dates across the spring-forward boundary', () => {
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDays('2026-10-03', 2)).toBe('2026-10-05');
  });

  it('addDays produces correct calendar dates across the fall-back boundary', () => {
    expect(addDays('2026-04-04', 1)).toBe('2026-04-05');
    expect(addDays('2026-04-04', 2)).toBe('2026-04-06');
  });

  it('dateToMs is exactly 24 hours apart for consecutive UTC-midnight days', () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(dateToMs('2026-10-04') - dateToMs('2026-10-03')).toBe(oneDayMs);
    expect(dateToMs('2026-04-05') - dateToMs('2026-04-04')).toBe(oneDayMs);
  });
});

describe('DST — rest gap rule', () => {
  it('reports the calendar-day rest gap unchanged across spring forward', () => {
    // Shift ends 2026-10-03 22:00. Next shift starts 2026-10-04 08:00.
    // Calendar gap is 10 hours regardless of DST.
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-10-03', start_time: '14:00', end_time: '22:00' }),
        buildShift({ date: '2026-10-04', start_time: '08:00', end_time: '16:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('reports the calendar-day rest gap unchanged across fall back', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-04-04', start_time: '14:00', end_time: '22:00' }),
        buildShift({ date: '2026-04-05', start_time: '08:00', end_time: '16:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });
});

describe('DST — daily hours rule', () => {
  it('totals scheduled minutes correctly on the spring-forward day', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-10-04', start_time: '00:00', end_time: '12:00' }),
      ],
    });
    expect(maxDailyHoursRule(ctx)).toEqual([]);
  });

  it('blocks a 13-hour scheduled shift on the fall-back day', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-04-05', start_time: '08:00', end_time: '21:00' }),
      ],
    });
    const hits = maxDailyHoursRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe('BLOCKING');
  });
});
