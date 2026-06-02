import { supabase } from '@/platform/realtime/client';
import { requireUser } from '@/platform/supabase/rpc/client';

export interface SynthesisRunRow {
    id: string;
    organization_id: string;
    department_id: string;
    sub_department_id: string | null;
    roster_id: string;
    shift_date: string;
    created_by: string;
    created_at: string;
    attempted_count: number;
    created_count: number;
    deleted_count: number;
    options: Record<string, unknown>;
    rolled_back_at: string | null;
    rolled_back_by: string | null;
    rolled_back_count: number | null;
}

export interface CreateRunInput {
    organization_id: string;
    department_id: string;
    sub_department_id: string | null;
    roster_id: string;
    shift_date: string;
    options: Record<string, unknown>;
}

export const synthesisRunsQueries = {
    /** Insert a row; returns the new run id + full row. Caller is stamped as created_by. */
    async createRun(input: CreateRunInput): Promise<SynthesisRunRow> {
        const user = await requireUser();
        const { data, error } = await (supabase as any)
            .from('synthesis_runs')
            .insert({ ...input, created_by: user.id })
            .select('*')
            .single();
        if (error) throw new Error(`createRun failed: ${error.message}`);
        return data as SynthesisRunRow;
    },

    /** Update counts on a run after the orchestrator finishes. */
    async finalizeRun(runId: string, attempted: number, created: number, deleted: number = 0): Promise<void> {
        const { error } = await supabase
            .from('synthesis_runs')
            .update({ attempted_count: attempted, created_count: created, deleted_count: deleted })
            .eq('id', runId);
        if (error) throw new Error(`finalizeRun failed: ${error.message}`);
    },

    /** Find non-rolled-back runs for a scope+date, newest first. */
    async listRecent(params: {
        organizationId: string;
        departmentId?: string;
        subDepartmentId?: string | null;
        shiftDate?: string;
        limit?: number;
    }): Promise<SynthesisRunRow[]> {
        let q = supabase
            .from('synthesis_runs')
            .select('*')
            .eq('organization_id', params.organizationId)
            .is('rolled_back_at', null)
            .order('created_at', { ascending: false })
            .limit(params.limit ?? 5);
        if (params.departmentId) q = q.eq('department_id', params.departmentId);
        if (params.subDepartmentId !== undefined) {
            q = params.subDepartmentId === null
                ? q.is('sub_department_id', null)
                : q.eq('sub_department_id', params.subDepartmentId);
        }
        if (params.shiftDate) q = q.eq('shift_date', params.shiftDate);

        const { data, error } = await q;
        if (error) throw new Error(`listRecent failed: ${error.message}`);
        return (data ?? []) as SynthesisRunRow[];
    },

    /**
     * Rollback deletes unassigned shifts from the run, then stamps rolled_back_at.
     * Also hard-deletes demand_forecasts rows tagged with the run id so the next
     * synthesis for the same events gets fresh predictions rather than stale cache.
     * Assigned shifts are preserved. Returns counters plus an `orphaned` flag.
     */
    async rollbackRun(runId: string): Promise<{
        deletedCount: number;
        skippedAssigned: number;
        failedDeletes: Array<{ id: string; reason: string }>;
        orphaned: boolean;
        forecastsDeleted: number;
    }> {
        const user = await requireUser();

        // 1. Find shifts for this run.
        const { data: shiftsForRun, error: fetchErr } = await supabase
            .from('shifts')
            .select('id, assigned_employee_id')
            .eq('synthesis_run_id', runId)
            .is('deleted_at', null);
        if (fetchErr) throw new Error(`rollbackRun (fetch) failed: ${fetchErr.message}`);

        const matched = shiftsForRun ?? [];
        const toDelete = matched.filter(s => !s.assigned_employee_id).map(s => s.id);
        const skippedAssigned = matched.length - toDelete.length;

        // Orphan case — bail before stamping rolled_back_at.
        if (matched.length === 0) {
            return { deletedCount: 0, skippedAssigned: 0, failedDeletes: [], orphaned: true, forecastsDeleted: 0 };
        }

        // 2. Soft-delete via a direct UPDATE.
        let deletedCount = 0;
        const failedDeletes: Array<{ id: string; reason: string }> = [];
        if (toDelete.length > 0) {
            const { error: delErr, count } = await supabase
                .from('shifts')
                .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
                .in('id', toDelete)
                .is('deleted_at', null);
            if (delErr) {
                for (const id of toDelete) failedDeletes.push({ id, reason: delErr.message });
            } else {
                deletedCount = count ?? toDelete.length;
            }
        }

        // 3. Hard-delete demand_forecasts rows for this run so stale predictions
        //    don't serve on the next synthesis run for the same events.
        let forecastsDeleted = 0;
        try {
            const { error: fcErr, count: fcCount } = await supabase
                .from('demand_forecasts')
                .delete({ count: 'exact' })
                .eq('synthesis_run_id', runId);
            if (fcErr) {
                // Non-fatal: log but don't abort the rollback.
                console.warn(`rollbackRun: failed to delete demand_forecasts for run ${runId}: ${fcErr.message}`);
            } else {
                forecastsDeleted = fcCount ?? 0;
            }
        } catch (fcException) {
            console.warn(`rollbackRun: unexpected error deleting demand_forecasts for run ${runId}`, fcException);
        }

        // 4. Stamp the run as rolled back.
        await supabase
            .from('synthesis_runs')
            .update({
                rolled_back_at: new Date().toISOString(),
                rolled_back_by: user.id,
                rolled_back_count: deletedCount,
            })
            .eq('id', runId);

        return { deletedCount, skippedAssigned, failedDeletes, orphaned: false, forecastsDeleted };
    },
};
