import { useState, useCallback, useRef } from 'react';
import {
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult,
    assignmentEvaluator,
    assignmentResultToComplianceResults,
} from '@/modules/compliance';
import { validateCompliance, type QualificationViolation } from '@/modules/rosters/services/compliance.service';

interface UseComplianceRunnerProps {
    buildComplianceInput: () => ComplianceCheckInput;
    hardValidation: HardValidationResult;
    setComplianceResults: (results: Record<string, ComplianceResult | null>) => void;
    needsRerun: boolean;
    setNeedsRerun: (needs: boolean) => void;
    setHasRun: (hasRun: boolean) => void;
    /** The shift ID (UUID) — required for qualification compliance check */
    shiftId?: string;
}

/** Net minutes between two HH:MM times (handles overnight). */
function calcNetMinutes(s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

/** Build a human-readable summary from qualification violations */
function buildQualificationSummary(violations: QualificationViolation[]): string {
    if (violations.length === 0) return 'Employee meets all qualification requirements';
    const types = new Set(violations.map(v => v.type));
    const parts: string[] = [];
    if (types.has('ROLE_MISMATCH')) parts.push('role mismatch');
    if (types.has('LICENSE_MISSING') || types.has('LICENSE_EXPIRED')) parts.push('license issue');
    if (types.has('SKILL_MISSING') || types.has('SKILL_EXPIRED')) parts.push('skill issue');
    return `Qualification violations: ${parts.join(', ')}`;
}

export function useComplianceRunner({
    buildComplianceInput,
    hardValidation,
    setComplianceResults,
    needsRerun,
    setNeedsRerun,
    setHasRun,
    shiftId
}: UseComplianceRunnerProps) {
    const [isRunning, setIsRunning] = useState(false);
    // Monotonically-increasing counter. Each call to runChecks captures its
    // own runId. After any async work, we check whether this is still the
    // most-recent invocation before committing state — cancelling stale runs.
    const runIdRef = useRef(0);

    const runChecks = useCallback(async (overrideEmployeeId?: string) => {
        const runId = ++runIdRef.current;
        setIsRunning(true);
        await new Promise(resolve => setTimeout(resolve, 10));

        try {
            const input = buildComplianceInput();
            if (overrideEmployeeId) {
                input.employee_id = overrideEmployeeId;
            }

            // ── 1. Constraint Solver — all constraints simultaneously ──────────
            //
            // Replaces the old sequential runRule() loop with the constraint
            // solver (Google OR-Tools CP-SAT pattern). All 8 constraints are
            // evaluated simultaneously against the hypothetical schedule.
            const solverResult = assignmentEvaluator.evaluate({
                employee_id:    input.employee_id,
                name:           input.employee_id,   // name shown in violation details
                current_shifts: input.existing_shifts.map(s => ({ ...s })) as any,
                candidate_shift: { ...input.candidate_shift } as any,
                action_type:    (input.action_type as 'add' | 'assign' | 'bid') ?? 'assign',
                config: {
                    rest_gap_hours:           input.rest_gap_hours,
                    averaging_cycle_weeks:    input.averaging_cycle_weeks,
                    student_visa_enforcement: input.student_visa_enforcement,
                    public_holiday_dates:     input.public_holiday_dates,
                    candidate_is_training:    input.candidate_is_training,
                },
            });

            const newResults: Record<string, ComplianceResult | null> = {
                ...assignmentResultToComplianceResults(solverResult, input.employee_id),
            };

            // ── 2. Server-side authoritative checks (when employee assigned) ──
            // The client-side NO_OVERLAP rule relies on employeeExistingShifts
            // from a direct table query that is subject to RLS. The server-side
            // check_shift_overlap RPC is SECURITY DEFINER and sees ALL shifts for
            // the employee regardless of department scope. Always prefer the
            // server result to prevent a false PASS on the overlap check.
            if (input.employee_id && input.employee_id !== 'preview') {
                try {
                    const serverResult = await validateCompliance({
                        employeeId: input.employee_id,
                        shiftDate: input.candidate_shift.shift_date,
                        startTime: input.candidate_shift.start_time,
                        endTime: input.candidate_shift.end_time,
                        netLengthMinutes: calcNetMinutes(input.candidate_shift),
                        excludeV8ShiftId: input.exclude_shift_id,
                        shiftId: shiftId,
                        overrideV8RoleId: input.overrideV8RoleId,
                        overrideSkillIds: input.overrideSkillIds,
                        overrideLicenseIds: input.overrideLicenseIds,
                    });

                    if (serverResult.checksPerformed.includes('overlap')) {
                        const hasOverlap = serverResult.violations.some(v =>
                            v.toLowerCase().includes('overlap')
                        );
                        // Preserve client-side calculation (which has existing/candidate time fields
                        // for visualization). Server is authoritative for pass/fail only.
                        const clientCalc = newResults['NO_OVERLAP']?.calculation;
                        newResults['NO_OVERLAP'] = {
                            rule_id: 'NO_OVERLAP',
                            rule_name: 'No Overlapping Shifts',
                            status: hasOverlap ? 'fail' : 'pass',
                            summary: hasOverlap
                                ? 'Employee already has a shift at this time'
                                : 'No overlapping shifts found',
                            details: hasOverlap
                                ? (serverResult.violations.find(v => v.toLowerCase().includes('overlap'))
                                    ?? 'Shift overlap detected in database')
                                : 'No overlapping shifts found.',
                            calculation: hasOverlap
                                ? (clientCalc ?? {
                                    existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0,
                                    existing_start_time: '',
                                    existing_end_time: '',
                                    candidate_start_time: input.candidate_shift.start_time,
                                    candidate_end_time: input.candidate_shift.end_time,
                                })
                                : { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                            blocking: true,
                        };
                    }

                    // ── 3. Qualification compliance (role/license/skill) ──────────
                    if (serverResult.checksPerformed.includes('qualification')) {
                        const qualViolations = serverResult.qualificationViolations || [];
                        
                        // Rule 1: Role Contract Match
                        const roleViolations = qualViolations.filter(v => v.type === 'ROLE_MISMATCH');
                        newResults['ROLE_CONTRACT_MATCH'] = {
                            rule_id: 'ROLE_CONTRACT_MATCH',
                            rule_name: 'Role Contract Match',
                            status: roleViolations.length > 0 ? 'fail' : 'pass',
                            summary: roleViolations.length > 0 ? 'Contract mismatch detected' : 'Active contract found',
                            details: roleViolations.length > 0 ? roleViolations.map(v => v.message).join('\n') : 'Employee holds an active contract for this role.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0, violations: roleViolations },
                            blocking: true,
                        };

                        // Rule 2: Qualification Match (Missing skills/licenses)
                        const missingViolations = qualViolations.filter(v => v.type === 'SKILL_MISSING' || v.type === 'LICENSE_MISSING');
                        newResults['QUALIFICATION_MATCH'] = {
                            rule_id: 'QUALIFICATION_MATCH',
                            rule_name: 'Qualification & Certification',
                            status: missingViolations.length > 0 ? 'fail' : 'pass',
                            summary: missingViolations.length > 0 ? 'Missing requirements' : 'All qualifications held',
                            details: missingViolations.length > 0 ? missingViolations.map(v => v.message).join('\n') : 'Employee holds all required skills and licenses.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0, violations: missingViolations },
                            blocking: true,
                        };

                        // Rule 3: Qualification Expiry (Expired skills/licenses)
                        const expiryViolations = qualViolations.filter(v => v.type === 'SKILL_EXPIRED' || v.type === 'LICENSE_EXPIRED');
                        newResults['QUALIFICATION_EXPIRY'] = {
                            rule_id: 'QUALIFICATION_EXPIRY',
                            rule_name: 'Qualification Expiry',
                            status: expiryViolations.length > 0 ? 'fail' : 'pass',
                            summary: expiryViolations.length > 0 ? 'Expired requirements' : 'All qualifications valid',
                            details: expiryViolations.length > 0 ? expiryViolations.map(v => v.message).join('\n') : 'All required qualifications are valid and not expired.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0, violations: expiryViolations },
                            blocking: true,
                        };
                    }
                } catch (err) {
                    // Server unavailable — keep client-side result as best-effort
                }
            }

            // Discard results if a newer runChecks call has already fired
            if (runId !== runIdRef.current) return;

            setComplianceResults(newResults);
            setHasRun(true);
            setNeedsRerun(false);
        } catch (error) {
            console.error('[useComplianceRunner] Error running checks:', error);
        } finally {
            if (runId === runIdRef.current) setIsRunning(false);
        }
    }, [buildComplianceInput, setComplianceResults, setHasRun, setNeedsRerun, shiftId]);

    const clearResults = useCallback(() => {
        setComplianceResults({});
        setHasRun(false);
        setNeedsRerun(false);
    }, [setComplianceResults, setHasRun, setNeedsRerun]);

    return {
        runChecks,
        clearResults,
        isRunning
    };
}
