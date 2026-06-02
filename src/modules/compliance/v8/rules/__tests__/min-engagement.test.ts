import { describe, it, expect } from 'vitest';
import { minEngagementRule } from '../min-engagement';
import { buildContext, buildShift } from './_helpers';

describe('minEngagementRule', () => {
  it('passes a 3-hour standard shift', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '09:00', end_time: '12:00' })],
    });
    expect(minEngagementRule(ctx)).toEqual([]);
  });

  it('blocks a 2-hour standard shift', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '09:00', end_time: '11:00' })],
    });
    const hits = minEngagementRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_MIN_ENGAGEMENT');
    expect(hits[0].status).toBe('BLOCKING');
  });

  it('requires 4 hours on Sundays', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ start_time: '09:00', end_time: '12:30', is_sunday: true }),
      ],
    });
    const hits = minEngagementRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].calculation?.is_holiday).toBe(true);
  });

  it('passes 4 hours on Sundays', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ start_time: '09:00', end_time: '13:00', is_sunday: true }),
      ],
    });
    expect(minEngagementRule(ctx)).toEqual([]);
  });

  it('allows 2-hour training shifts', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ start_time: '09:00', end_time: '11:00', is_training: true }),
      ],
    });
    expect(minEngagementRule(ctx)).toEqual([]);
  });
});
