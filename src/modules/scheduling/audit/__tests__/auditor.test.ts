/**
 * Auditor tests.
 *
 * The Auditor was extracted in Phase 2 with a mockable `optimizerClient`
 * dependency, so we can finally test the audit assembly logic in
 * isolation. These tests lock in the behaviours that turn raw
 * eligibility-failure reason codes into UI-friendly audit rows:
 *
 *   - CAPACITY_CONFLICT augmentation (employee already placed on
 *     overlapping shift in this run)
 *   - OUTSIDE_DECLARED_AVAILABILITY browser-side check (fail-loud even
 *     when the audit endpoint mismatched)
 *   - INSUFFICIENT_CAPACITY vs OPTIMIZER_TRADEOFF discrimination on
 *     pass-everywhere shifts
 *   - MAX_AUDITED_SHIFTS cap
 *   - Graceful degradation when /audit throws
 */
import { describe, expect, it, vi } from 'vitest';
import { Auditor, MAX_AUDITED_SHIFTS } from '../auditor';
import type { AvailabilityData } from '../auditor';
import type { AuditResponse } from '../../types';
import type { ShiftMeta, EmployeeMeta } from '../../optimizer/solution-parser';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function shift(id: string, date = '2026-05-15', start = '09:00', end = '17:00'): ShiftMeta {
    return {
        id, shift_date: date, start_time: start, end_time: end,
        role_id: 'role-A', roleName: 'Test Role',
    };
}

function employee(id: string): EmployeeMeta {
    return {
        id, name: `Emp-${id}`,
        contract_type: 'FT',
        contracted_weekly_hours: 38,
        remuneration_rate: 25,
    };
}

function makeMockClient(auditResponse: AuditResponse | Error) {
    return {
        audit: vi.fn().mockImplementation(async () => {
            if (auditResponse instanceof Error) throw auditResponse;
            return auditResponse;
        }),
    } as any;
}

const baseConstraints = { min_rest_minutes: 600, relax_constraints: false };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auditor', () => {
    it('translates server-side reason codes into UI-friendly rejection summaries', async () => {
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 1,
            elapsed_ms: 1.2,
            rows: [{
                shift_id: 's1',
                // ROLE_MISMATCH is the live reason code (LEVEL_TOO_LOW was retired server-side)
                rejection_summary: { ROLE_MISMATCH: 1 },
                employees: [{
                    employee_id: 'e1', status: 'FAIL',
                    rejection_reasons: ['ROLE_MISMATCH'],
                }],
            }],
        }));

        const result = await auditor.audit({
            targetShiftIds: ['s1'],
            allShifts: [shift('s1')],
            allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [{ id: 's1', shift_date: '2026-05-15', start_time: '09:00', end_time: '17:00', duration_minutes: 480 }],
            optimizerEmployees: [{ id: 'e1', name: 'Emp-e1' }],
            constraints: baseConstraints,
        });

        expect(result).toHaveLength(1);
        expect(result[0].rejectionSummary).toEqual({ ROLE_MISMATCH: 1 });
        expect(result[0].employeeDetails[0].status).toBe('FAIL');
        // Reason code → human-readable description mapping
        expect(result[0].employeeDetails[0].violations[0].description).toContain('role does not match');
    });

    it('flags CAPACITY_CONFLICT when employee is on an overlapping passing proposal', async () => {
        // Server-side audit says e1 PASSes for s2; but the solver already
        // placed e1 on s1 (which overlaps s2). Auditor must surface
        // CAPACITY_CONFLICT, not just defer to the server's PASS.
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 1,
            elapsed_ms: 0.5,
            rows: [{
                shift_id: 's2',
                rejection_summary: {},
                employees: [{ employee_id: 'e1', status: 'PASS', rejection_reasons: [] }],
            }],
        }));

        const result = await auditor.audit({
            targetShiftIds: ['s2'],
            allShifts: [shift('s1', '2026-05-15', '09:00', '17:00'), shift('s2', '2026-05-15', '12:00', '20:00')],
            allEmployees: [employee('e1')],
            proposals: [{
                shiftId: 's1', employeeId: 'e1', employeeName: 'Emp-e1',
                shiftDate: '2026-05-15', startTime: '09:00', endTime: '17:00',
                optimizerCost: 0, employmentType: 'FT', complianceStatus: 'PASS',
                violations: [], passing: true,
            }],
            optimizerShifts: [],
            optimizerEmployees: [],
            constraints: baseConstraints,
        });

        expect(result[0].rejectionSummary).toHaveProperty('CAPACITY_CONFLICT', 1);
        expect(result[0].employeeDetails[0].status).toBe('FAIL');
        expect(result[0].employeeDetails[0].violations.map(v => v.type)).toContain('CAPACITY_CONFLICT');
    });

    it('flags OUTSIDE_DECLARED_AVAILABILITY when slots do not cover the shift', async () => {
        // Even if the server says PASS (e.g. availability check hadn't
        // been wired in), the browser-side mirror must catch it. This is
        // belt-and-braces — the server normally handles it but we keep
        // the check here so a server bug doesn't silently let through.
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 1,
            elapsed_ms: 0.5,
            rows: [{
                shift_id: 's1',
                rejection_summary: {},
                employees: [{ employee_id: 'e1', status: 'PASS', rejection_reasons: [] }],
            }],
        }));

        const availability = new Map<string, AvailabilityData>([
            ['e1', {
                hasAnyData: true,
                slots: [{ slot_date: '2026-05-15', start_time: '20:00', end_time: '23:00' }],
            }],
        ]);

        const result = await auditor.audit({
            targetShiftIds: ['s1'],
            allShifts: [shift('s1', '2026-05-15', '09:00', '17:00')],
            allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [],
            optimizerEmployees: [],
            constraints: baseConstraints,
            availabilityData: availability,
        });

        expect(result[0].rejectionSummary).toHaveProperty('OUTSIDE_DECLARED_AVAILABILITY', 1);
    });

    it('does NOT enforce availability when employee has no records on file (universally available)', async () => {
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 1,
            elapsed_ms: 0.5,
            rows: [{
                shift_id: 's1', rejection_summary: {},
                employees: [{ employee_id: 'e1', status: 'PASS', rejection_reasons: [] }],
            }],
        }));

        const availability = new Map<string, AvailabilityData>([
            ['e1', { hasAnyData: false, slots: [] }],  // not yet onboarded
        ]);

        const result = await auditor.audit({
            targetShiftIds: ['s1'],
            allShifts: [shift('s1')],
            allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [],
            optimizerEmployees: [],
            constraints: baseConstraints,
            availabilityData: availability,
        });

        // The shift was server-PASS and availability is universally-OK;
        // result must NOT carry an OUTSIDE_DECLARED_AVAILABILITY entry.
        expect(result[0].rejectionSummary).not.toHaveProperty('OUTSIDE_DECLARED_AVAILABILITY');
    });

    it('flags OPTIMIZER_TRADEOFF when every employee individually passes', async () => {
        // Every employee can do the shift, but the solver still left it
        // uncovered (presumably to satisfy a higher-priority constraint).
        // The non-deficit case is OPTIMIZER_TRADEOFF.
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 1,
            elapsed_ms: 0.3,
            rows: [{
                shift_id: 's1', rejection_summary: {},
                employees: [
                    { employee_id: 'e1', status: 'PASS', rejection_reasons: [] },
                    { employee_id: 'e2', status: 'PASS', rejection_reasons: [] },
                ],
            }],
        }));

        const result = await auditor.audit({
            targetShiftIds: ['s1'],
            allShifts: [shift('s1')],
            allEmployees: [employee('e1'), employee('e2')],
            proposals: [],
            optimizerShifts: [],
            optimizerEmployees: [],
            constraints: baseConstraints,
        });

        expect(result[0].rejectionSummary).toHaveProperty('OPTIMIZER_TRADEOFF', 1);
    });

    it('flags INSUFFICIENT_CAPACITY when the day was pre-flagged as deficit', async () => {
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 1,
            elapsed_ms: 0.3,
            rows: [{
                shift_id: 's1', rejection_summary: {},
                employees: [{ employee_id: 'e1', status: 'PASS', rejection_reasons: [] }],
            }],
        }));

        const result = await auditor.audit({
            targetShiftIds: ['s1'],
            allShifts: [shift('s1', '2026-05-15')],
            allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [],
            optimizerEmployees: [],
            constraints: baseConstraints,
            capacityCheck: {
                sufficient: false,
                totalDemandMinutes: 1000,
                totalSupplyMinutes: 500,
                deficitDays: [{ date: '2026-05-15', shiftCount: 5, demandMinutes: 1000, supplyMinutes: 500, employeeCount: 10, deficitMinutes: 500, sufficient: false }],
                perDay: [],
            },
        });

        expect(result[0].rejectionSummary).toHaveProperty('INSUFFICIENT_CAPACITY', 1);
        expect(result[0].rejectionSummary).not.toHaveProperty('OPTIMIZER_TRADEOFF');
    });

    it('caps audited shifts at MAX_AUDITED_SHIFTS', async () => {
        // Provide 80 target IDs; only the first 50 should be audited.
        const allShifts = Array.from({ length: 80 }, (_, i) => shift(`s${i}`));
        const auditor = new Auditor(makeMockClient({
            audited_shift_count: 50,
            elapsed_ms: 5,
            rows: allShifts.slice(0, 50).map(s => ({
                shift_id: s.id, rejection_summary: {},
                employees: [{ employee_id: 'e1', status: 'PASS', rejection_reasons: [] }],
            })),
        }));

        const result = await auditor.audit({
            targetShiftIds: allShifts.map(s => s.id),
            allShifts, allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [], optimizerEmployees: [],
            constraints: baseConstraints,
        });

        expect(result).toHaveLength(MAX_AUDITED_SHIFTS);
    });

    it('degrades gracefully when /audit throws — produces rows with OPTIMIZER_TRADEOFF, not a crash', async () => {
        // Network failure or 500 from the optimizer must not blow up the
        // overall run. The browser-side mirrors still run against
        // allEmployees, so each shift gets at least one row. Without
        // server-side data, every employee shows status=PASS (no
        // rejection reasons known) and the per-shift summary falls
        // through to OPTIMIZER_TRADEOFF — the user sees "we don't know
        // exactly why this shift was uncovered."
        const auditor = new Auditor(makeMockClient(new Error('Optimizer unreachable')));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await auditor.audit({
            targetShiftIds: ['s1'],
            allShifts: [shift('s1')],
            allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [{ id: 's1', shift_date: '2026-05-15', start_time: '09:00', end_time: '17:00', duration_minutes: 480 }],
            optimizerEmployees: [{ id: 'e1', name: 'Emp-e1' }],
            constraints: baseConstraints,
        });

        expect(result).toHaveLength(1);
        expect(result[0].rejectionSummary).toHaveProperty('OPTIMIZER_TRADEOFF', 1);
        expect(result[0].employeeDetails[0].status).toBe('PASS');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('skips audit when targetShiftIds is empty', async () => {
        const mockClient = makeMockClient({ audited_shift_count: 0, elapsed_ms: 0, rows: [] });
        const auditor = new Auditor(mockClient);

        const result = await auditor.audit({
            targetShiftIds: [],
            allShifts: [shift('s1')],
            allEmployees: [employee('e1')],
            proposals: [],
            optimizerShifts: [], optimizerEmployees: [],
            constraints: baseConstraints,
        });

        expect(result).toEqual([]);
        // No /audit call at all when there's nothing to audit.
        expect(mockClient.audit).not.toHaveBeenCalled();
    });
});
