import { describe, it, expect } from 'vitest';
import { studentVisaRule } from '../student-visa';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('studentVisaRule', () => {
  it('does not apply to non-student-visa employees', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME' },
      shifts: buildConsecutiveShifts(14, '2026-06-01', {
        start_time: '08:00',
        end_time: '17:00',
      }),
    });
    expect(studentVisaRule(ctx)).toEqual([]);
  });

  it('passes when fortnightly hours are within 48h limit', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'STUDENT_VISA' },
      shifts: buildConsecutiveShifts(6, '2026-06-01', {
        start_time: '09:00',
        end_time: '16:00',
      }),
    });
    expect(studentVisaRule(ctx)).toEqual([]);
  });

  it('blocks when 14-day window exceeds 48 hours', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'STUDENT_VISA' },
      shifts: buildConsecutiveShifts(7, '2026-06-01', {
        start_time: '08:00',
        end_time: '16:00',
      }),
    });
    const hits = studentVisaRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_STUDENT_VISA_LIMIT');
    expect(hits[0].status).toBe('BLOCKING');
    expect(hits[0].calculation?.total_hours).toBeGreaterThan(48);
  });
});
