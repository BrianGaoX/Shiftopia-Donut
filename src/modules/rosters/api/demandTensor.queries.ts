import { supabase } from '@/platform/supabase/client';
import type { Json } from '@/platform/supabase/types';

/**
 * Demand Engine L7 — demand_tensor write queries.
 *
 * Table: public.demand_tensor (migration 20260502000014).
 * This table is the canonical L7 output — one row per
 * (synthesis_run_id, event_id, slice_idx, function_code, level).
 */

export interface DemandTensorInsertRow {
    synthesis_run_id: string | null;
    event_id: string | null;
    slice_idx: number;
    function_code: string;
    level: number;
    headcount: number;
    baseline: number;
    binding_constraint: string | null;
    explanation: Json; // jsonb — array of explanation strings/objects

    // Canonical snapshot fields (timecard_mult / feedback_mult columns dropped
    // in migration 20260503000001 — these are the authoritative replacements).
    timecard_ratio_used: number;
    feedback_multiplier_used: number;
    rule_version_id?: string | null;
    execution_timestamp?: string;

    // C2 — service-level buffering (nullable; NULL = no buffer / median staffing).
    /** Target P(scheduled >= demand) used to buffer this cell (0..1). */
    service_level?: number | null;
    /** Extra headcount added above the point estimate to hit service_level (>= 0). */
    demand_buffer?: number | null;
    /** Modelled P(demand <= headcount) for this cell (0..1). */
    coverage_confidence?: number | null;
}

export const demandTensorDbQueries = {
    /**
     * Bulk-insert finalized tensor rows.
     * Caller is responsible for deduplication (by synthesis_run_id + event_id +
     * slice_idx + function_code + level) before calling this.
     */
    async insertBatch(rows: DemandTensorInsertRow[]): Promise<void> {
        if (rows.length === 0) return;
        const { error } = await supabase
            .from('demand_tensor')
            .insert(rows);
        if (error) throw new Error(`demandTensor.insertBatch failed: ${error.message}`);
    },

    /**
     * Delete all demand_tensor rows for a given synthesis run.
     * Called before a re-run to avoid stale rows from a previous attempt.
     */
    async deleteForRun(synthesisRunId: string): Promise<void> {
        const { error } = await supabase
            .from('demand_tensor')
            .delete()
            .eq('synthesis_run_id', synthesisRunId);
        if (error) throw new Error(`demandTensor.deleteForRun failed: ${error.message}`);
    },

    /**
     * Fetch all demand_tensor rows for a given event, keyed by
     * (slice_idx, function_code, level). Used by the shadow-compare UI.
     */
    async listForEvent(eventId: string): Promise<DemandTensorInsertRow[]> {
        const { data, error } = await supabase
            .from('demand_tensor')
            .select('*')
            .eq('event_id', eventId)
            .order('slice_idx', { ascending: true })
            .order('function_code', { ascending: true })
            .order('level', { ascending: true });
        if (error) throw new Error(`demandTensor.listForEvent failed: ${error.message}`);
        return (data ?? []) as DemandTensorInsertRow[];
    },
};
