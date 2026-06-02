import { describe, it, expect } from 'vitest';
import { minRestGapRule } from '../rest-requirements';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

describe('minRestGapRule', () => {
  it('passes when only one shift is present', () => {
    const ctx = buildContext({ shifts: [buildShift()] });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('passes when the gap between shifts is exactly 10 hours', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '14:00' }),
        buildShift({ date: '2026-06-02', start_time: '00:00', end_time: '08:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('blocks when the gap is 9h 59m', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '14:00' }),
        buildShift({ date: '2026-06-01', start_time: '23:59', end_time: '04:00' }),
      ],
    });
    const hits = minRestGapRule(ctx);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].rule_id).toBe('V8_MIN_REST_GAP');
    expect(hits[0].status).toBe('BLOCKING');
  });

  it('does not block when shifts are more than 1 calendar day apart', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '16:00' }),
        buildShift({ date: '2026-06-05', start_time: '06:00', end_time: '14:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });
});
