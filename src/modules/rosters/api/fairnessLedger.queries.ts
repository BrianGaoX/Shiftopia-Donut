/**
 * F1 — Fairness Ledger: Supabase Query Layer.
 *
 * CRUD operations for the `fairness_ledger` table. Thin wrapper — all
 * business logic lives in fairnessLedger.service.ts and the domain module.
 */

import { supabase } from '@/platform/supabase/client';
import type { FairnessMetric } from '@/modules/rosters/domain/fairness-ledger';

// ─── Row types ──────────────────────────────────────────────────────────────────

export interface FairnessLedgerRow {
    id: string;
    organization_id: string;
    employee_id: string;
    metric: FairnessMetric;
    window_start: string;   // date
    window_end: string;     // date
    rolling_value: number;
    team_average: number;
    debt: number;
    last_updated_at: string;
    updated_by_run: string | null;
}

export interface FairnessLedgerUpsertRow {
    organization_id: string;
    employee_id: string;
    metric: string;
    window_start: string;
    window_end: string;
    rolling_value: number;
    team_average: number;
    debt: number;
    updated_by_run?: string | null;
}

// ─── Queries ────────────────────────────────────────────────────────────────────

export const fairnessLedgerQueries = {
    /**
     * Fetch current debts for a set of employees in an organization.
     * Returns the most recent window_end rows per (employee, metric).
     */
    async getDebts(
        organizationId: string,
        employeeIds: string[],
        windowEnd: string,
    ): Promise<FairnessLedgerRow[]> {
        if (employeeIds.length === 0) return [];

        const { data, error } = await (supabase as any)
            .from('fairness_ledger')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('window_end', windowEnd)
            .in('employee_id', employeeIds);

        if (error) {
            console.error('[FairnessLedger] getDebts failed:', error.message);
            return [];
        }

        return (data ?? []) as FairnessLedgerRow[];
    },

    /**
     * Fetch all ledger rows for an organization at a given window end.
     * Used by recompute to check existing state.
     */
    async getAllForWindow(
        organizationId: string,
        windowEnd: string,
    ): Promise<FairnessLedgerRow[]> {
        const { data, error } = await (supabase as any)
            .from('fairness_ledger')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('window_end', windowEnd);

        if (error) {
            console.error('[FairnessLedger] getAllForWindow failed:', error.message);
            return [];
        }

        return (data ?? []) as FairnessLedgerRow[];
    },

    /**
     * Bulk upsert ledger rows. Uses the composite unique index
     * (organization_id, employee_id, metric, window_end) for conflict resolution.
     */
    async upsertBatch(rows: FairnessLedgerUpsertRow[]): Promise<void> {
        if (rows.length === 0) return;

        // Supabase upsert needs the conflict columns specified
        const { error } = await (supabase as any)
            .from('fairness_ledger')
            .upsert(rows, {
                onConflict: 'organization_id,employee_id,metric,window_end',
                ignoreDuplicates: false,
            });

        if (error) {
            console.error('[FairnessLedger] upsertBatch failed:', error.message);
            throw new Error(`fairnessLedger.upsertBatch failed: ${error.message}`);
        }
    },

    /**
     * Delete all ledger rows for an organization at a given window end.
     * Used before a full rebuild.
     */
    async deleteForWindow(
        organizationId: string,
        windowEnd: string,
    ): Promise<void> {
        const { error } = await (supabase as any)
            .from('fairness_ledger')
            .delete()
            .eq('organization_id', organizationId)
            .eq('window_end', windowEnd);

        if (error) {
            console.error('[FairnessLedger] deleteForWindow failed:', error.message);
        }
    },

    /**
     * Fetch assigned shifts for a set of employees in a date range.
     * Used by the full-rebuild path to recompute the ledger from source.
     */
    async fetchAssignedShifts(
        organizationId: string,
        startDate: string,
        endDate: string,
        departmentId?: string,
    ): Promise<Array<{
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
        assigned_employee_id: string;
        unpaid_break_minutes: number;
    }>> {
        let query = supabase
            .from('shifts')
            .select('id, shift_date, start_time, end_time, assigned_employee_id, unpaid_break_minutes')
            .eq('organization_id', organizationId)
            .not('assigned_employee_id', 'is', null)
            .neq('lifecycle_status', 'Cancelled')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate);

        if (departmentId) {
            query = query.eq('department_id', departmentId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[FairnessLedger] fetchAssignedShifts failed:', error.message);
            return [];
        }

        return (data ?? []).map((row: any) => ({
            id: row.id,
            shift_date: row.shift_date,
            start_time: row.start_time,
            end_time: row.end_time,
            assigned_employee_id: row.assigned_employee_id,
            unpaid_break_minutes: row.unpaid_break_minutes ?? 0,
        }));
    },

    /**
     * Fetch all denied preferences (rejected bids) for an organization in a date range.
     * Used by the full-rebuild path to compute the `denied_preferences` metric.
     */
    async fetchDeniedPreferences(
        organizationId: string,
        startDate: string,
        endDate: string,
    ): Promise<Array<{
        employee_id: string;
        shift_id: string;
    }>> {
        // Inner join with shifts to filter by date range and org
        const { data, error } = await (supabase as any)
            .from('shift_bids')
            .select(`
                employee_id,
                shift_id,
                shift:shifts!inner(organization_id, shift_date)
            `)
            .eq('status', 'rejected')
            .eq('shift.organization_id', organizationId)
            .gte('shift.shift_date', startDate)
            .lte('shift.shift_date', endDate);

        if (error) {
            console.error('[FairnessLedger] fetchDeniedPreferences failed:', error.message);
            return [];
        }

        return (data ?? []).map((row: any) => ({
            employee_id: row.employee_id,
            shift_id: row.shift_id,
        }));
    },
};
