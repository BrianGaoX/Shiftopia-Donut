import { V8Employee, V8Shift, V8Config, V8Hit } from '../types';
import { V8OrchestratorInput, V8OrchestratorShift } from '../orchestrator/types';
import { v8Engine } from '../engine';
import { isPublicHoliday } from '@/modules/core/lib/date.utils';

const parseLocalDateStr = (dateStr: string) => {
    if (!dateStr) return new Date();
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
};

const isSunday = (dateStr: string) => {
    if (!dateStr) return false;
    const localDate = parseLocalDateStr(dateStr);
    return localDate.getDay() === 0;
};

/**
 * Adapter: Orchestrator Input -> V8 Core Engine
 */
export function runV8ComplexBridge(
    input: V8OrchestratorInput, 
    simulatedShifts: V8OrchestratorShift[]
): V8Hit[] {
    const employee: V8Employee = {
        id: input.employee_id,
        name: 'Employee',
        contract_type: input.employee_context.contract_type,
        contracted_weekly_hours: input.employee_context.contracted_weekly_hours,
        skill_ids: input.employee_context.skill_ids,
        license_ids: input.employee_context.license_ids,
        // Preserve the richer qualifications array (with expiry dates) so the
        // qualification rule can reject expired credentials per-shift.
        qualifications: input.employee_context.qualifications,
    };

    const v8Shifts: V8Shift[] = simulatedShifts.map(s => {
        const dateStr = s.date || s.shift_date || '';
        return {
            id: s.id,
            date: dateStr,
            start_time: s.start_time,
            end_time: s.end_time,
            is_ordinary_hours: s.is_ordinary_hours,
            unpaid_break_minutes: s.unpaid_break_minutes || 0,
            is_training: s.is_training ?? false,
            is_sunday: s.is_sunday ?? isSunday(dateStr),
            is_public_holiday: s.is_public_holiday ?? isPublicHoliday(parseLocalDateStr(dateStr))
        };
    });

    const v8Config: Partial<V8Config> = {
        max_daily_hours: input.config?.max_daily_hours,
        min_rest_gap_minutes: (input.config as any)?.rest_gap_hours ? (input.config as any).rest_gap_hours * 60 : 600,
        max_consecutive_days: input.config?.max_consecutive_days,
        ord_avg_weekly_limit: input.employee_context.contracted_weekly_hours || 38
    };

    const v8Result = v8Engine.evaluate(employee, v8Shifts, input.evaluation_reference_date);
    return v8Result.hits;
}
