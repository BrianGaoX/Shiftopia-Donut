import { describe, it, expect } from 'vitest';
import { mealBreakRule } from '../meal-break';
import { buildContext, buildShift } from './_helpers';

describe('mealBreakRule', () => {
  it('does not warn for shifts <= 5 hours', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '09:00', end_time: '14:00' })],
    });
    expect(mealBreakRule(ctx)).toEqual([]);
  });

  it('warns when a >5h shift has no break recorded', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ start_time: '09:00', end_time: '15:00', unpaid_break_minutes: 0 }),
      ],
    });
    const hits = mealBreakRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_MEAL_BREAK');
    expect(hits[0].status).toBe('WARNING');
    expect(hits[0].blocking).toBe(false);
  });

  it('does not warn when a >5h shift has a 30m break', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ start_time: '09:00', end_time: '15:00', unpaid_break_minutes: 30 }),
      ],
    });
    expect(mealBreakRule(ctx)).toEqual([]);
  });

  it('warns when break is less than 30 minutes on a >5h shift', () => {
    const ctx = buildContext({
      shifts: [
        buildShift({ start_time: '09:00', end_time: '15:00', unpaid_break_minutes: 15 }),
      ],
    });
    expect(mealBreakRule(ctx)).toHaveLength(1);
  });
});
