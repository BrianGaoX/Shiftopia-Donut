import { V8RuleContext, V8Hit, V8RuleEvaluator, QualificationV2 } from '../types';

/**
 * V8 Rule: Qualifications & Skills
 *
 * Ensures the employee holds all skills and licenses required for the shift.
 *
 * Expiry check (per-shift):
 *   A qualification is valid for a given shift only when:
 *     expires_at == null  (never expires)
 *     OR expires_at >= shift.date  (still in-date on the day of the shift)
 *
 *   This is evaluated per-shift because a qualification may be valid today but
 *   expired by the time a future shift occurs.
 *
 * Source priority:
 *   1. employee.qualifications (QualificationV2[] — includes expiry dates) — used
 *      when available (populated via fetchV8EmployeeContext → adapter).
 *   2. employee.skill_ids / employee.license_ids — plain ID sets with no expiry
 *      info, used as a fallback only when qualifications is absent.
 */
export const qualificationRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts } = ctx;
    const violations: V8Hit[] = [];

    const richQuals: QualificationV2[] | undefined = employee.qualifications;

    for (const s of shifts) {
        const required: string[] = (s as any).required_qualifications || [];
        if (required.length === 0) continue;

        const shiftDate = s.date || (s as any).shift_date || '';

        if (richQuals) {
            // --- Path A: rich qualifications with expiry ---
            // Build a set of IDs that are valid on the day of this specific shift.
            // Per-shift expiry check: expires_at == null means the credential never
            // expires; otherwise the credential must still be in-date on shiftDate.
            const validOnShiftDay = new Set<string>(
                richQuals
                    .filter(q =>
                        q.expires_at === null ||
                        q.expires_at >= shiftDate
                    )
                    .map(q => q.qualification_id)
            );

            const missing  = required.filter(q => !validOnShiftDay.has(q));

            // Qualifications the employee holds but that will be expired by shiftDate.
            const expired  = required.filter(q =>
                !validOnShiftDay.has(q) &&
                richQuals.some(rq =>
                    rq.qualification_id === q &&
                    rq.expires_at !== null &&
                    rq.expires_at < shiftDate
                )
            );

            const trulyMissing = missing.filter(q => !expired.includes(q));

            if (expired.length > 0) {
                violations.push({
                    rule_id:         'V8_QUALIFICATION_EXPIRED',
                    rule_name:       'Expired Qualification',
                    status:          'BLOCKING',
                    summary:         'Required qualification(s) have expired before the shift date',
                    details:         `${expired.length} qualification(s) required for this shift are held by the employee but expired before ${shiftDate}.`,
                    affected_shifts: [s.id],
                    blocking:        true,
                    calculation:     { expired, shift_date: shiftDate },
                });
            }

            if (trulyMissing.length > 0) {
                violations.push({
                    rule_id:         'V8_QUALIFICATIONS',
                    rule_name:       'Qualifications',
                    status:          'BLOCKING',
                    summary:         'Missing required qualifications',
                    details:         `Employee is missing ${trulyMissing.length} required qualification(s) for this shift.`,
                    affected_shifts: [s.id],
                    blocking:        true,
                    calculation:     { missing: trulyMissing },
                });
            }
        } else {
            // --- Path B: fallback — plain ID sets, no expiry information ---
            // In V8, we expect the caller to have already resolved the employee's skills/licenses.
            const employeeQuals = new Set([
                ...(employee.skill_ids || []),
                ...(employee.license_ids || [])
            ]);

            const missing = required.filter(q => !employeeQuals.has(q));

            if (missing.length > 0) {
                violations.push({
                    rule_id:         'V8_QUALIFICATIONS',
                    rule_name:       'Qualifications',
                    status:          'BLOCKING',
                    summary:         'Missing required qualifications',
                    details:         `Employee is missing ${missing.length} required qualification(s) for this shift.`,
                    affected_shifts: [s.id],
                    blocking:        true,
                    calculation:     { missing },
                });
            }
        }
    }

    return violations;
};
