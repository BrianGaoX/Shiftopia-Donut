import { describe, it, expect } from 'vitest';
import { ordinaryHoursAvgRule } from '../ordinary-hours-avg';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('ordinaryHoursAvgRule', () => {
  it('returns no hits when there are no shifts', () => {
    expect(ordinaryHoursAvgRule(buildContext())).toEqual([]);
  });

  it('does not apply to CASUAL employees', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: buildConsecutiveShifts(28, '2026-06-01', {
        start_time: '08:00',
        end_time: '20:00',
      }),
    });
    expect(ordinaryHoursAvgRule(ctx)).toEqual([]);
  });

  it('passes a modest 5-day fortnight at 38h total', () => {
    // 5 days × 7h36m = 38 hours total — well under any rolling-window limit
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(5, '2026-06-01', {
        start_time: '09:00',
        end_time: '16:36',
      }),
    });
    expect(ordinaryHoursAvgRule(ctx)).toEqual([]);
  });

  it('flags an extreme over-average across consecutive weeks', () => {
    // 28 consecutive 10h days = 280h far above the 152h 4-week cycle limit
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(28, '2026-06-01', {
        start_time: '08:00',
        end_time: '18:00',
      }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].rule_id).toContain('ORD');
  });
});
