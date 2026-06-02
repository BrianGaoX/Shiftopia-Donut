import { describe, it, expect } from 'vitest';
import { qualificationRule } from '../employment-rules';
import { buildContext, buildShift } from './_helpers';

describe('qualificationRule', () => {
  describe('rich qualifications path (with expiry)', () => {
    it('passes when qualification is valid and not expired', () => {
      const ctx = buildContext({
        employee: {
          qualifications: [
            { qualification_id: 'rsa-cert', issued_at: '2024-01-01', expires_at: '2027-01-01' },
          ],
        },
        shifts: [
          {
            ...buildShift({ date: '2026-06-01' }),
            required_qualifications: ['rsa-cert'],
          } as any,
        ],
      });
      expect(qualificationRule(ctx)).toEqual([]);
    });

    it('passes when qualification has no expiry (null = never)', () => {
      const ctx = buildContext({
        employee: {
          qualifications: [
            { qualification_id: 'forklift', issued_at: '2020-01-01', expires_at: null },
          ],
        },
        shifts: [
          {
            ...buildShift({ date: '2030-01-01' }),
            required_qualifications: ['forklift'],
          } as any,
        ],
      });
      expect(qualificationRule(ctx)).toEqual([]);
    });

    it('blocks with V8_QUALIFICATION_EXPIRED when credential expires BEFORE the shift', () => {
      const ctx = buildContext({
        employee: {
          qualifications: [
            { qualification_id: 'rsa-cert', issued_at: '2024-01-01', expires_at: '2026-05-15' },
          ],
        },
        shifts: [
          {
            ...buildShift({ date: '2026-06-01' }),
            required_qualifications: ['rsa-cert'],
          } as any,
        ],
      });
      const hits = qualificationRule(ctx);
      expect(hits).toHaveLength(1);
      expect(hits[0].rule_id).toBe('V8_QUALIFICATION_EXPIRED');
      expect(hits[0].status).toBe('BLOCKING');
      expect(hits[0].calculation?.expired).toEqual(['rsa-cert']);
    });

    it('blocks with V8_QUALIFICATIONS when employee never had the credential', () => {
      const ctx = buildContext({
        employee: { qualifications: [] },
        shifts: [
          {
            ...buildShift({ date: '2026-06-01' }),
            required_qualifications: ['rsa-cert', 'forklift'],
          } as any,
        ],
      });
      const hits = qualificationRule(ctx);
      expect(hits).toHaveLength(1);
      expect(hits[0].rule_id).toBe('V8_QUALIFICATIONS');
      expect(hits[0].calculation?.missing).toEqual(['rsa-cert', 'forklift']);
    });

    it('reports expired and missing separately', () => {
      const ctx = buildContext({
        employee: {
          qualifications: [
            { qualification_id: 'rsa-cert', issued_at: '2024-01-01', expires_at: '2026-05-15' },
          ],
        },
        shifts: [
          {
            ...buildShift({ date: '2026-06-01' }),
            required_qualifications: ['rsa-cert', 'forklift'],
          } as any,
        ],
      });
      const hits = qualificationRule(ctx);
      expect(hits).toHaveLength(2);
      expect(hits.find(h => h.rule_id === 'V8_QUALIFICATION_EXPIRED')).toBeTruthy();
      expect(hits.find(h => h.rule_id === 'V8_QUALIFICATIONS')).toBeTruthy();
    });
  });

  describe('fallback path (skill_ids / license_ids)', () => {
    it('passes when employee holds all required IDs', () => {
      const ctx = buildContext({
        employee: { skill_ids: ['rsa-cert'], license_ids: [] },
        shifts: [
          {
            ...buildShift({ date: '2026-06-01' }),
            required_qualifications: ['rsa-cert'],
          } as any,
        ],
      });
      expect(qualificationRule(ctx)).toEqual([]);
    });

    it('blocks when employee is missing a required ID', () => {
      const ctx = buildContext({
        employee: { skill_ids: [], license_ids: [] },
        shifts: [
          {
            ...buildShift({ date: '2026-06-01' }),
            required_qualifications: ['rsa-cert'],
          } as any,
        ],
      });
      const hits = qualificationRule(ctx);
      expect(hits).toHaveLength(1);
      expect(hits[0].status).toBe('BLOCKING');
    });
  });

  it('ignores shifts with no required_qualifications', () => {
    const ctx = buildContext({
      employee: { qualifications: [] },
      shifts: [buildShift()],
    });
    expect(qualificationRule(ctx)).toEqual([]);
  });
});
