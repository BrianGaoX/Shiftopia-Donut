import { supabase } from '@/platform/supabase/client';
import { requireUser } from '@/platform/supabase/rpc/client';
import type {
    CreateFeedbackInput,
    FeedbackWindowParams,
    SupervisorFeedbackRow,
} from './supervisorFeedback.dto';

/**
 * Demand Engine L5 — Supervisor Feedback queries.
 *
 * Tables: public.supervisor_feedback (migration 20260502000013).
 * RLS: authenticated read all; insert restricted to supervisor_id = auth.uid().
 */
export const supervisorFeedbackQueries = {
    /** Insert a feedback row. supervisor_id is stamped from the current user. */
    async create(input: CreateFeedbackInput): Promise<SupervisorFeedbackRow> {
        const user = await requireUser();
        const { data, error } = await supabase
            .from('supervisor_feedback')
            .insert({
                event_id: input.event_id,
                function_code: input.function_code,
                level: input.level,
                slice_start: input.slice_start,
                slice_end: input.slice_end,
                verdict: input.verdict,
                severity: input.severity,
                reason_code: input.reason_code,
                reason_note: input.reason_note ?? null,
                rule_version_at_event: input.rule_version_at_event ?? null,
                supervisor_id: user.id,
            })
            .select('*')
            .single();
        if (error) throw new Error(`supervisorFeedback.create failed: ${error.message}`);
        return data as SupervisorFeedbackRow;
    },

    /** All feedback rows for a single event, newest first. */
    async listForEvent(eventId: string): Promise<SupervisorFeedbackRow[]> {
        const { data, error } = await supabase
            .from('supervisor_feedback')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });
        if (error) throw new Error(`supervisorFeedback.listForEvent failed: ${error.message}`);
        return (data ?? []) as SupervisorFeedbackRow[];
    },

    async listForBucket(params: FeedbackWindowParams): Promise<SupervisorFeedbackRow[]> {
        let q = supabase
            .from('supervisor_feedback')
            .select('*')
            .eq('function_code', params.function_code)
            .eq('level', params.level)
            .order('created_at', { ascending: false })
            .limit(params.limit ?? 10);
        if (params.sinceIso) q = q.gte('created_at', params.sinceIso);
        if (params.ruleVersion !== undefined) q = q.eq('rule_version_at_event', params.ruleVersion);

        const { data, error } = await q;
        if (error) throw new Error(`supervisorFeedback.listForBucket failed: ${error.message}`);
        return (data ?? []) as SupervisorFeedbackRow[];
    },

    /**
     * Trailing window of feedback for MULTIPLE (function, level) buckets.
     *
     * Runs N parallel queries — one per bucket — each capped at `limitPerBucket`
     * rows ordered newest-first. This guarantees per-bucket fairness: a high-volume
     * bucket (e.g. F&B/L1) cannot starve cold buckets whose rows would have been
     * pushed past a shared global LIMIT. For the demand engine N ≈ 40 (5 functions
     * × 8 levels), well within Supabase's parallelism budget.
     */
    async listBatchForBuckets(
        buckets: Array<{ function_code: string; level: number }>,
        limitPerBucket = 10,
    ): Promise<SupervisorFeedbackRow[]> {
        if (buckets.length === 0) return [];

        const perBucketResults = await Promise.all(
            buckets.map(async (b) => {
                const { data, error } = await supabase
                    .from('supervisor_feedback')
                    .select('*')
                    .eq('function_code', b.function_code)
                    .eq('level', b.level)
                    .order('created_at', { ascending: false })
                    .limit(limitPerBucket);
                if (error) throw new Error(`supervisorFeedback.listBatchForBuckets failed for bucket ${b.function_code}/${b.level}: ${error.message}`);
                return (data ?? []) as SupervisorFeedbackRow[];
            }),
        );

        return perBucketResults.flat();
    },
};
