/**
 * Auditor — produces the per-shift "why is this uncovered?" report.
 *
 * Extracted from `auto-scheduler.controller.ts` in Phase 2 (H5). The
 * controller used to be 1430 lines doing eight responsibilities; this
 * module owns one of them — explaining uncovered/failing shifts in
 * UI-friendly form.
 *
 * Data flow:
 *
 *   1. Take target shift IDs (uncovered + failing-after-validation).
 *   2. Call `optimizerClient.audit()` once — server-side eligibility
 *      check returns reason codes per (shift, employee). This is the
 *      C3 fix: replaces ~5 000 RPC round-trips with one call.
 *   3. Augment the server result with browser-only signals:
 *        - CAPACITY_CONFLICT: employee already placed on overlapping shift
 *        - OUTSIDE_DECLARED_AVAILABILITY: mirror of the solver check, kept
 *          here so the UI surfaces a specific reason even when the audit
 *          endpoint is unreachable
 *        - INSUFFICIENT_CAPACITY / OPTIMIZER_TRADEOFF: catch-all for shifts
 *          where every employee passes individual checks but the solver
 *          chose otherwise
 *   4. Cap at MAX_AUDITED_SHIFTS so the UI/CSV stays bounded.
 *
 * The Auditor is intentionally a class so callers can inject a fake
 * optimizer client in tests. The exported singleton uses the real one.
 */
import type {
    AvailabilitySlotRef,
    OptimizerConstraints,
    OptimizerEmployee,
    OptimizerShift,
    UncoveredAudit,
    ValidatedProposal,
    CapacityCheck,
} from '../types';
import type { EmployeeMeta, ShiftMeta } from '../optimizer/solution-parser';
import { optimizerClient as defaultOptimizerClient } from '../optimizer/optimizer.client';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Hard cap on per-shift audit detail. Each audited shift gets per-employee
 *  rejection rows; capping keeps the UI/CSV manageable when the deficit
 *  is huge. */
export const MAX_AUDITED_SHIFTS = 50;

/** Reason-code → human-readable description for the violation panel. */
const REASON_DESCRIPTIONS: Record<string, string> = {
    UNAVAILABLE_DATE: 'Employee marked the date unavailable.',
    ROLE_MISMATCH: 'Employee role does not match the shift role.',
    QUALIFICATION_MISSING: 'Employee is missing required qualifications.',
    REST_GAP: 'Insufficient rest gap before/after another scheduled shift.',
    SHIFT_TOO_SHORT: 'Shift duration is below the minimum-engagement floor.',
    HARD_AVAILABILITY_BLOCK: 'Shift falls inside a hard availability block.',
    OUTSIDE_DECLARED_AVAILABILITY: "Shift falls outside the employee's declared availability.",
};

// =============================================================================
// AUDITOR
// =============================================================================

export interface AvailabilityData {
    slots: AvailabilitySlotRef[];
    hasAnyData: boolean;
}

export interface AuditOptions {
    targetShiftIds: string[];
    allShifts: ShiftMeta[];
    allEmployees: EmployeeMeta[];
    proposals: ValidatedProposal[];
    optimizerShifts: OptimizerShift[];
    optimizerEmployees: OptimizerEmployee[];
    constraints: OptimizerConstraints;
    capacityCheck?: CapacityCheck;
    availabilityData?: Map<string, AvailabilityData>;
}

interface ShiftSimRow {
    status: 'PASS' | 'WARN' | 'FAIL';
    violations: Array<{ violation_type: string; description: string; blocking?: boolean }>;
    passing: boolean;
}

interface EmpSim {
    emp: EmployeeMeta;
    resultByShift: Map<string, ShiftSimRow>;
}

export class Auditor {
    constructor(
        private readonly optimizerClient: typeof defaultOptimizerClient = defaultOptimizerClient,
    ) {}

    /**
     * Produce per-shift audit rows for the supplied uncovered/failing
     * shift IDs. Capped at MAX_AUDITED_SHIFTS for UI/CSV bounds.
     */
    async audit(opts: AuditOptions): Promise<UncoveredAudit[]> {
        const shiftMap = new Map(opts.allShifts.map(s => [s.id, s]));
        const targetIds = opts.targetShiftIds.slice(0, MAX_AUDITED_SHIFTS);
        const deficitDays = new Set(opts.capacityCheck?.deficitDays.map(d => d.date) ?? []);

        const empSims = await this._fetchEmpSims(targetIds, opts);

        return this._buildAudits({
            targetIds,
            shiftMap,
            allEmployees: opts.allEmployees,
            empSims,
            proposals: opts.proposals,
            availabilityData: opts.availabilityData,
            deficitDays,
        });
    }

    /** Single server-side audit call. Falls back to empty results on
     *  transport failure — downstream rendering treats missing entries
     *  as no-data rather than blocking the entire run. */
    private async _fetchEmpSims(
        targetIds: string[],
        opts: AuditOptions,
    ): Promise<EmpSim[]> {
        const empSims: EmpSim[] = [];
        if (!opts.optimizerShifts.length || !opts.optimizerEmployees.length || !targetIds.length) {
            return empSims;
        }

        try {
            const auditRes = await this.optimizerClient.audit({
                shifts: opts.optimizerShifts,
                employees: opts.optimizerEmployees,
                constraints: opts.constraints,
                target_shift_ids: targetIds,
            });

            const empMaps = new Map<string, Map<string, ShiftSimRow>>();
            for (const emp of opts.allEmployees) {
                empMaps.set(emp.id, new Map());
            }

            for (const row of auditRes.rows) {
                for (const empRow of row.employees) {
                    const inner = empMaps.get(empRow.employee_id);
                    if (!inner) continue;
                    inner.set(row.shift_id, {
                        status: empRow.status === 'PASS' ? 'PASS' : 'FAIL',
                        passing: empRow.status === 'PASS',
                        violations: empRow.rejection_reasons.map(reason => ({
                            violation_type: reason,
                            description: REASON_DESCRIPTIONS[reason] ?? reason,
                            blocking: true,
                        })),
                    });
                }
            }

            for (const emp of opts.allEmployees) {
                empSims.push({
                    emp,
                    resultByShift: empMaps.get(emp.id) ?? new Map(),
                });
            }
        } catch (err) {
            console.warn(
                '[Auditor] Server-side audit failed; rejection reasons will be unavailable',
                err,
            );
        }

        return empSims;
    }

    /** Walk the targetIds × allEmployees matrix and produce one
     *  UncoveredAudit per shift with rejection summary + per-employee
     *  detail rows.
     *
     *  We iterate `allEmployees` (not just `empSims`) so that browser-
     *  side mirrors (CAPACITY_CONFLICT, OUTSIDE_DECLARED_AVAILABILITY)
     *  still fire when the server-side audit returned no data for that
     *  pair (network failure, audit endpoint down, optimizer payload
     *  not provided, etc.). The server result, if present, augments the
     *  per-employee row with a richer reason code list. */
    private _buildAudits(args: {
        targetIds: string[];
        shiftMap: Map<string, ShiftMeta>;
        allEmployees: EmployeeMeta[];
        empSims: EmpSim[];
        proposals: ValidatedProposal[];
        availabilityData?: Map<string, AvailabilityData>;
        deficitDays: Set<string>;
    }): UncoveredAudit[] {
        const { targetIds, shiftMap, allEmployees, empSims, proposals, availabilityData, deficitDays } = args;
        const audits: UncoveredAudit[] = [];

        // Index empSims by employee id for O(1) lookup per pair.
        const simByEmpId = new Map<string, EmpSim>();
        for (const sim of empSims) simByEmpId.set(sim.emp.id, sim);

        for (const shiftId of targetIds) {
            const s = shiftMap.get(shiftId);
            if (!s) continue;

            const summary: Record<string, number> = {};
            const details: UncoveredAudit['employeeDetails'] = [];
            let allEmployeesPass = true;

            for (const emp of allEmployees) {
                // Server-side audit row, if available. May be undefined
                // when the audit endpoint failed or wasn't called.
                const res = simByEmpId.get(emp.id)?.resultByShift.get(shiftId);

                const overlapProposal = this._findOverlapProposal(proposals, emp.id, s);
                const outsideAvailability = this._isOutsideAvailability(emp.id, s, availabilityData);

                let status: 'PASS' | 'WARN' | 'FAIL' = res?.status ?? 'PASS';
                const violations: Array<{ type: string; description: string }> = res
                    ? res.violations.map(v => ({ type: v.violation_type, description: v.description }))
                    : [];

                if (overlapProposal) {
                    status = 'FAIL';
                    violations.push({
                        type: 'CAPACITY_CONFLICT',
                        description: `Employee assigned to another shift at this time (${overlapProposal.startTime}–${overlapProposal.endTime}).`,
                    });
                    summary['CAPACITY_CONFLICT'] = (summary['CAPACITY_CONFLICT'] ?? 0) + 1;
                    allEmployeesPass = false;
                } else if (outsideAvailability) {
                    status = 'FAIL';
                    violations.push({
                        type: 'OUTSIDE_DECLARED_AVAILABILITY',
                        description: `Shift falls outside the employee's declared availability for ${s.shift_date}.`,
                    });
                    summary['OUTSIDE_DECLARED_AVAILABILITY'] = (summary['OUTSIDE_DECLARED_AVAILABILITY'] ?? 0) + 1;
                    allEmployeesPass = false;
                } else if (res && !res.passing) {
                    for (const v of res.violations) {
                        summary[v.violation_type] = (summary[v.violation_type] ?? 0) + 1;
                    }
                    allEmployeesPass = false;
                }

                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    status: status as any,
                    violations,
                });
            }

            // Capacity-bound case: every employee individually passes
            // compliance, yet the shift is still uncovered. The cause is
            // not eligibility — it's that there are not enough people-
            // hours available on this day to cover every shift.
            if (allEmployeesPass && details.length > 0) {
                const reason = deficitDays.has(s.shift_date)
                    ? 'INSUFFICIENT_CAPACITY'
                    : 'OPTIMIZER_TRADEOFF';
                summary[reason] = (summary[reason] ?? 0) + 1;
            }

            audits.push({
                shiftId,
                shiftDate: s.shift_date,
                startTime: s.start_time,
                endTime: s.end_time,
                rejectionSummary: summary,
                roleName: s.roleName,
                employeeDetails: details,
            });
        }

        return audits;
    }

    private _findOverlapProposal(
        proposals: ValidatedProposal[],
        empId: string,
        shift: ShiftMeta,
    ): ValidatedProposal | undefined {
        return proposals.find(p =>
            p.employeeId === empId &&
            p.shiftDate === shift.shift_date &&
            this._shiftsOverlap(
                { startTime: shift.start_time, endTime: shift.end_time },
                p,
            ),
        );
    }

    /** Mirror the optimizer's HC-5d availability check so the audit
     *  surfaces the specific reason instead of falling through to
     *  OPTIMIZER_TRADEOFF. */
    private _isOutsideAvailability(
        empId: string,
        shift: ShiftMeta,
        availabilityData: Map<string, AvailabilityData> | undefined,
    ): boolean {
        const empAvailability = availabilityData?.get(empId);
        if (!empAvailability?.hasAnyData) return false;

        const sStart = this._timeToMins(shift.start_time);
        const sEnd = this._timeToMins(shift.end_time);
        const sEndAdj = sEnd <= sStart ? sEnd + 1440 : sEnd;
        return !empAvailability.slots.some(slot => {
            if (slot.slot_date !== shift.shift_date) return false;
            const aStart = this._timeToMins(slot.start_time);
            const aEnd = this._timeToMins(slot.end_time);
            const aEndAdj = aEnd <= aStart ? aEnd + 1440 : aEnd;
            return aStart <= sStart && aEndAdj >= sEndAdj;
        });
    }

    private _shiftsOverlap(
        a: { startTime: string; endTime: string },
        b: { startTime: string; endTime: string },
    ): boolean {
        const aStart = this._timeToMins(a.startTime);
        const aEnd = this._timeToMins(a.endTime);
        const bStart = this._timeToMins(b.startTime);
        const bEnd = this._timeToMins(b.endTime);
        return aStart < bEnd && bStart < aEnd;
    }

    private _timeToMins(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }
}

/** Singleton wired against the real optimizer client. Tests construct
 *  `new Auditor(mockClient)` to inject a fake. */
export const auditor = new Auditor();
