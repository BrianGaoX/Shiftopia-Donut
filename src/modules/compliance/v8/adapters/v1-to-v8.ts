import { v8Engine } from '../engine';
import { V8Employee, V8Shift } from '../types';
import { ComplianceCheckInput, ComplianceCheckResult, ComplianceStatus, ComplianceResult } from '../../types';
import { fetchV8EmployeeContext } from '../../employee-context';

/**
 * Adapter: V1 Input -> V8 Engine (Full Mapping)
 * 
 * Maps the legacy ComplianceCheckInput to the V8 Engine format.
 * Returns a unified ComplianceCheckResult containing all V8 hits.
 */
export async function runV8Compliance(
    input: ComplianceCheckInput, 
    employeeOverride?: V8Employee
): Promise<ComplianceCheckResult> {
    // 1. Map Employee (Fetch from DB if not provided)
    let employee: V8Employee;
    
    if (employeeOverride) {
        employee = employeeOverride;
    } else {
        const ctx = await fetchV8EmployeeContext(input.employee_id);
        employee = {
            id: ctx.employee_id,
            name: 'Employee',
            contract_type: ctx.contract_type,
            contracted_weekly_hours: ctx.contracted_weekly_hours,
            skill_ids: (ctx.qualifications ?? []).map(q => q.qualification_id)
        };
    }

    // 2. Map Shifts
    const isSunday = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.getUTCDay() === 0;
    };

    const isHoliday = (dateStr: string) => {
        return (input.public_holiday_dates || []).includes(dateStr);
    };

    const v8Shifts: V8Shift[] = [
        ...input.existing_shifts.map(s => ({
            id: (s as any).id || `existing-${Math.random()}`,
            date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            is_ordinary_hours: true,
            unpaid_break_minutes: s.unpaid_break_minutes || 0,
            is_sunday: isSunday(s.shift_date),
            is_public_holiday: isHoliday(s.shift_date)
        }))
    ];

    if (input.candidate_shift) {
        v8Shifts.push({
            id: 'candidate',
            date: input.candidate_shift.shift_date,
            start_time: input.candidate_shift.start_time,
            end_time: input.candidate_shift.end_time,
            is_ordinary_hours: true,
            unpaid_break_minutes: input.candidate_shift.unpaid_break_minutes || 0,
            is_sunday: isSunday(input.candidate_shift.shift_date),
            is_public_holiday: isHoliday(input.candidate_shift.shift_date),
            is_training: input.candidate_is_training
        });
    }

    // 3. Run V8
    const v8Result = v8Engine.evaluate(employee, v8Shifts);

    // 4. Map Hits to V1 ComplianceResult format
    const results: ComplianceResult[] = v8Result.hits.map(hit => ({
        rule_id: hit.rule_id,
        rule_name: hit.rule_name,
        status: hit.status === 'BLOCKING' ? 'fail' : hit.status === 'WARNING' ? 'warning' : 'pass' as ComplianceStatus,
        summary: hit.summary,
        details: hit.details,
        blocking: hit.blocking,
        calculation: {
            existing_hours: hit.calculation?.existing_hours || 0,
            candidate_hours: hit.calculation?.candidate_hours || 0,
            total_hours: hit.calculation?.total_hours || 0,
            limit: hit.calculation?.limit || 0,
            ...hit.calculation
        }
    }));

    const blockers = results.filter(r => r.status === 'fail' && r.blocking);
    const hasBlockingFailure = blockers.length > 0;
    const hasWarnings = results.some(r => r.status === 'warning');

    return {
        passed: !hasBlockingFailure,
        hasWarnings,
        hasBlockingFailure,
        overallStatus: hasBlockingFailure ? 'fail' : hasWarnings ? 'warning' : 'pass',
        results,
        blockers
    };
}
