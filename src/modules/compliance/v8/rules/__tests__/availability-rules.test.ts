import { describe, it, expect } from 'vitest';
import { availabilityMatchRule } from '../availability-rules';
import { buildContext, buildShift } from './_helpers';

describe('availabilityMatchRule', () => {
  it('returns no hits when no candidate_shift is provided', () => {
    const ctx = buildContext({ shifts: [buildShift()] });
    expect(availabilityMatchRule(ctx)).toEqual([]);
  });

  it('passes when candidate does not overlap any existing shift', () => {
    const candidate = buildShift({
      id: 'candidate',
      date: '2026-06-01',
      start_time: '14:00',
      end_time: '20:00',
    });
    const ctx = buildContext({
      candidate_shift: candidate,
      shifts: [
        candidate,
        buildShift({ id: 'other', date: '2026-06-01', start_time: '07:00', end_time: '13:00' }),
      ],
    });
    expect(availabilityMatchRule(ctx)).toEqual([]);
  });

  it('warns when candidate overlaps an existing assignment', () => {
    const candidate = buildShift({
      id: 'candidate',
      date: '2026-06-01',
      start_time: '10:00',
      end_time: '16:00',
    });
    const ctx = buildContext({
      candidate_shift: candidate,
      shifts: [
        candidate,
        buildShift({ id: 'other', date: '2026-06-01', start_time: '13:00', end_time: '17:00' }),
      ],
    });
    const hits = availabilityMatchRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_AVAILABILITY_CONFLICT');
    expect(hits[0].status).toBe('WARNING');
    expect(hits[0].blocking).toBe(false);
  });

  it('ignores shifts on other days', () => {
    const candidate = buildShift({
      id: 'candidate',
      date: '2026-06-01',
      start_time: '09:00',
      end_time: '17:00',
    });
    const ctx = buildContext({
      candidate_shift: candidate,
      shifts: [
        candidate,
        buildShift({ id: 'other', date: '2026-06-02', start_time: '09:00', end_time: '17:00' }),
      ],
    });
    expect(availabilityMatchRule(ctx)).toEqual([]);
  });
});
