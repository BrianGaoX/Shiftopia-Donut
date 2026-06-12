import { z } from 'zod';
import { callAuthenticatedRpc } from '@/platform/supabase/rpc/client';
import { ShiftFilters } from './queryKeys';
import { isValidUuid } from '../domain/shift.entity';

// ── DTOs & Schemas ────────────────────────────────────────────────────────────

export const RosterSummaryCellSchema = z.object({
    shift_date: z.string(),
    group_type: z.string().nullable(),
    sub_group_name: z.string().nullable(),
    total_shifts: z.number(),
    assigned_shifts: z.number(),
    open_shifts: z.number(),
    published_shifts: z.number(),
    draft_shifts: z.number(),
    cancelled_shifts: z.number(),
    total_net_minutes: z.number(),
    unique_employees: z.number(),
});

export type RosterSummaryCellDTO = z.infer<typeof RosterSummaryCellSchema>;

// Array schema for the RPC response
const RosterSummaryResponseSchema = z.array(RosterSummaryCellSchema);

// ── Queries ───────────────────────────────────────────────────────────────────

export const rosterSummaryQueries = {
    /**
     * Fetches aggregated shift summaries per (date, group) for a given date range.
     * Powered by a server-side Postgres function for millions-of-shifts scale.
     */
    async getRosterSummary(
        organizationId: string,
        startDate: string,
        endDate: string,
        filters?: ShiftFilters | null
    ): Promise<RosterSummaryCellDTO[]> {
        if (!isValidUuid(organizationId)) {
            console.warn('Invalid organization ID for getRosterSummary:', organizationId);
            return [];
        }

        return callAuthenticatedRpc(
            'get_roster_summary',
            () => ({
                p_organization_id: organizationId,
                p_start_date: startDate,
                p_end_date: endDate,
                p_department_ids: filters?.departmentIds?.filter(isValidUuid) || null,
                p_sub_department_ids: filters?.subDepartmentIds?.filter(isValidUuid) || null,
            }),
            RosterSummaryResponseSchema
        );
    }
};
