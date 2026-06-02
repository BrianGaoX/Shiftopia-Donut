import { describe, it, expect } from 'vitest';
import { maxWorkdayLimitsRule } from '../consecutive-days';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('maxWorkdayLimitsRule', () => {
  it('passes when no shifts are present', () => {
    expect(maxWorkdayLimitsRule(buildContext())).toEqual([]);
  });

  it('passes for 6 consecutive days (standard cap)', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: buildConsecutiveShifts(6, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.find(h => h.rule_id?.includes('STREAK') || h.rule_id?.includes('CONSECUTIVE'))).toBeUndefined();
  });

  it('blocks at 7 consecutive days for a standard contract', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: buildConsecutiveShifts(7, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => h.blocking)).toBe(true);
  });

  it('allows up to 10 consecutive days for FLEXI_PART_TIME', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FLEXI_PART_TIME' },
      shifts: buildConsecutiveShifts(10, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    const streakHits = hits.filter(h => h.rule_id?.includes('STREAK') || h.rule_id?.includes('CONSECUTIVE'));
    expect(streakHits).toEqual([]);
  });

  it('blocks 21 days inside a 28-day window', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: buildConsecutiveShifts(21, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.some(h => h.blocking)).toBe(true);
  });
});
