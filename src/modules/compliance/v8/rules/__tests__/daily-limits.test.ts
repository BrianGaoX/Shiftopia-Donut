import { describe, it, expect } from 'vitest';
import { maxDailyHoursRule } from '../daily-limits';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

describe('maxDailyHoursRule', () => {
  it('passes when daily hours are below 12h limit', () => {
    const ctx = buildContext({
      shifts: [buildShift({ date: '2026-06-01', start_time: '09:00', end_time: '17:00' })],
    });
    expect(maxDailyHoursRule(ctx)).toEqual([]);
  });

  it('passes at exactly 12h', () => {
    const ctx = buildContext({
      shifts: [buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:00' })],
    });
    expect(maxDailyHoursRule(ctx)).toEqual([]);
  });

  it('blocks at 12h01m on a single shift', () => {
    const ctx = buildContext({
      shifts: [buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:01' })],
    });
    const hits = maxDailyHoursRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_MAX_DAILY_HOURS');
    expect(hits[0].status).toBe('BLOCKING');
  });

  it('aggregates across multiple shifts on the same day', () => {
    resetIdCounter();
    // 6h + 6h = 12h total — at the limit but not over
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '12:00' }),
        buildShift({ date: '2026-06-01', start_time: '14:00', end_time: '20:00' }),
      ],
    });
    expect(maxDailyHoursRule(ctx)).toEqual([]);

    const overCtx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '06:00', end_time: '13:00' }),
        buildShift({ date: '2026-06-01', start_time: '14:00', end_time: '20:00' }),
      ],
    });
    const hits = maxDailyHoursRule(overCtx);
    expect(hits).toHaveLength(1);
    expect(hits[0].calculation?.date).toBe('2026-06-01');
  });

  it('respects a custom config.max_daily_hours', () => {
    const ctx = buildContext({
      config: { max_daily_hours: 8 },
      shifts: [buildShift({ date: '2026-06-01', start_time: '09:00', end_time: '18:00' })],
    });
    const hits = maxDailyHoursRule(ctx);
    expect(hits).toHaveLength(1);
  });
});
