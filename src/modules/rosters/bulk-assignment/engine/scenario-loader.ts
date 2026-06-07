/**
 * ScenarioLoader — Fetches the employee's ±28-day roster from Supabase.
 *
 * Returns:
 *   - candidateShifts:  The specific shifts being bulk-assigned (from shiftIds)
 *   - existingShifts:   All shifts assigned to the employee in the scenario window
 *   - employee:         Profile including role and qualifications
 *
 * IMPORTANT: existingShifts are fetched via the SECURITY DEFINER RPC
 * `get_employee_shift_window`, NOT a direct table query.  This ensures that
 * cross-department shifts are always visible regardless of the calling
 * manager's RLS scope, preventing false-pass compliance results.
 */

import { supabase } from '@/platform/supabase/client';
import { getScenarioWindow } from '@/modules/compliance';
import { fetchV8EmployeeContext } from '@/modules/compliance/employee-context';
import type { CandidateShift, EmployeeInfo, InjectedSimulationData } from '../types';

export interface LoadedScenario {
    candidateShifts: CandidateShift[];
    existingShifts: CandidateShift[];
    employee: EmployeeInfo;
}

export class ScenarioLoader {
    /**
     * Load all data needed to validate bulk assignment for a single employee.
     *
     * @param shiftIds     - The candidate shift IDs selected in the planner
     * @param employeeId   - The target employee
     * @param injectedData - (Optional) Pre-fetched data to skip network calls
     */
    async load(
        shiftIds: string[], 
        employeeId: string, 
        injectedData?: InjectedSimulationData
    ): Promise<LoadedScenario> {
        // If data is injected (e.g. by AutoScheduler), use it directly
        // to avoid thousands of redundant network calls and Navigator Locks.
        if (injectedData) {
            return injectedData;
        }

        const [candidateShifts, employee] = await Promise.all([
            this._fetchCandidateShifts(shiftIds),
            this._fetchEmployee(employeeId),
        ]);

        // Build date window from the candidate shifts (±28 days around extremes)
        const existingShifts = await this._fetchExistingShifts(
            employeeId,
            candidateShifts,
        );

        return { candidateShifts, existingShifts, employee };
    }

    // ---------------------------------------------------------------------------

    private async _fetchCandidateShifts(shiftIds: string[]): Promise<CandidateShift[]> {
        if (shiftIds.length === 0) return [];

        const { data, error } = await (supabase as any)
            .from('shifts')
            .select('id, shift_date, start_time, end_time, assigned_employee_id, lifecycle_status, role_id, organization_id, department_id, sub_department_id, unpaid_break_minutes, required_skills, required_licenses, start_at, end_at')
            .in('id', shiftIds)
            .is('deleted_at', null);

        if (error) {
            console.error('[ScenarioLoader] Error fetching candidate shifts:', error);
            return [];
        }
        return (data ?? []) as CandidateShift[];
    }

    private async _fetchExistingShifts(
        employeeId: string,
        candidateShifts: CandidateShift[],
    ): Promise<CandidateShift[]> {
        if (candidateShifts.length === 0) return [];

        // Compute the widest window covering all candidate shift dates
        const dates = candidateShifts.map(s => s.shift_date).sort();
        const earliestWindow = getScenarioWindow(dates[0]);
        const latestWindow   = getScenarioWindow(dates[dates.length - 1]);

        // Union of both windows → start of earliest, end of latest
        const windowStart = earliestWindow.start < latestWindow.start
            ? earliestWindow.start
            : latestWindow.start;
        const windowEnd = earliestWindow.end > latestWindow.end
            ? earliestWindow.end
            : latestWindow.end;

        // Use SECURITY DEFINER RPC so cross-department shifts are visible
        // regardless of the calling manager's RLS scope.  A direct table query
        // (.from('shifts').eq('assigned_employee_id', ...)) is RLS-scoped and
        // silently omits shifts from other departments, producing false-pass
        // compliance results (e.g. rest-gap violations not detected).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('get_employee_shift_window', {
            p_employee_id: employeeId,
            p_start_date:  windowStart,
            p_end_date:    windowEnd,
            p_exclude_id:  null,
        });

        if (error) {
            console.error('[ScenarioLoader] Error fetching existing shifts via RPC:', error);
            return [];
        }

        // Map RPC result to CandidateShift shape
        return ((data ?? []) as Array<{
            id:                   string;
            shift_date:           string;
            start_time:           string;
            end_time:             string;
            unpaid_break_minutes: number | null;
        }>).map(s => ({
            id:                   s.id,
            shift_date:           s.shift_date,
            start_time:           s.start_time,
            end_time:             s.end_time,
            assigned_employee_id: employeeId,
            lifecycle_status:     null,
            role_id:              null,
            unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
        }));
    }

    private async _fetchEmployee(employeeId: string): Promise<EmployeeInfo> {
        // Fetch profile (name + employment end date) in parallel with v2 context
        // (contracts, qualifications, visa status via fetchV8EmployeeContext).
        const [profileRes, ctx] = await Promise.all([
            (supabase as any)
                .from('profiles')
                .select('id, full_name, termination_date')
                .eq('id', employeeId)
                .single(),
            fetchV8EmployeeContext(employeeId),
        ]);

        if (profileRes.error) {
            console.error('[ScenarioLoader] Error fetching employee profile:', profileRes.error);
        }

        const profile = profileRes.data;

        return {
            id:                  employeeId,
            name:                profile?.full_name ?? employeeId,
            employment_end_date: profile?.termination_date ?? null,
            // contracts → source of truth for R10 role/hierarchy match
            contracts:           ctx.contracts,
            qualifications:      (ctx.qualifications ?? []).map(q => ({
                qualification_id: q.qualification_id,
                expires_at:       q.expires_at,
            })),
        };
    }
}

export const scenarioLoader = new ScenarioLoader();
