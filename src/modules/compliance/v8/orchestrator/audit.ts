/**
 * V8 Compliance Engine — Audit Hook
 *
 * Writes a structured log entry for every BLOCKING hit and adds a Sentry
 * breadcrumb so the rejection is traceable without throwing.
 *
 * Contract: this function MUST NOT throw — it is called inside the main
 * orchestrator result path and any exception here would mask the real result.
 */

import * as Sentry from '@sentry/react';
import { supabase } from '@/platform/realtime/client';
import { V8OrchestratorInput, V8Hit } from './types';

// Opt-out via env: when not exactly 'false' the DB persist runs (default on).
const PERSIST_ENABLED: boolean =
    (import.meta.env.VITE_COMPLIANCE_REJECTION_PERSIST as string | undefined) !== 'false';

export function logComplianceRejection(
    input:        V8OrchestratorInput,
    blockingHits: V8Hit[],
): void {
    try {
        const timestamp     = new Date().toISOString();
        const employee_id   = input.employee_id;
        const operation_type = input.operation_type;
        const mode          = input.mode;

        for (const hit of blockingHits) {
            if (hit.status !== 'BLOCKING') continue;

            const entry = {
                event:           'compliance_rejection',
                timestamp,
                employee_id,
                operation_type,
                mode,
                stage:           input.stage ?? null,
                rule_id:         hit.rule_id,
                summary:         hit.summary,
                affected_shifts: hit.affected_shifts,
                details:         hit.details,
                calculation:     hit.calculation ?? null,
            };

            console.warn('[compliance/v8] BLOCKING rejection', entry);

            if (Sentry.getClient()) {
                Sentry.addBreadcrumb({
                    category: 'compliance.rejection',
                    message:  `[${hit.rule_id}] ${hit.summary}`,
                    level:    'warning',
                    data: {
                        employee_id,
                        operation_type,
                        mode,
                        stage:           input.stage ?? null,
                        rule_id:         hit.rule_id,
                        affected_shifts: hit.affected_shifts,
                    },
                });
            }
        }

        // Fire-and-forget DB persist. Awaiting would couple the engine to
        // Supabase latency / availability — both unacceptable for a hot path.
        if (PERSIST_ENABLED && blockingHits.some(h => h.status === 'BLOCKING')) {
            persistComplianceRejection(input, blockingHits).catch(() => {
                // Already swallowed inside; this is belt-and-braces.
            });
        }
    } catch {
        // Intentionally swallowed — audit must never break the engine.
    }
}

/**
 * Persist one row per BLOCKING hit to `public.compliance_rejections`.
 *
 * Defensive: every step is wrapped, errors are logged-and-dropped. Never throws.
 */
async function persistComplianceRejection(
    input:        V8OrchestratorInput,
    blockingHits: V8Hit[],
): Promise<void> {
    try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id ?? null;

        const rows = blockingHits
            .filter(h => h.status === 'BLOCKING')
            .map(h => ({
                user_id:         userId,
                employee_id:     input.employee_id,
                operation_type:  input.operation_type,
                mode:            input.mode,
                stage:           input.stage ?? null,
                rule_id:         h.rule_id,
                rule_status:     h.status,
                summary:         h.summary,
                details:         h.details ?? null,
                affected_shifts: h.affected_shifts ?? [],
                calculation:     h.calculation ?? null,
                bypassed:        false,
            }));

        if (rows.length === 0) return;

        const { error } = await (supabase as any)
            .from('compliance_rejections')
            .insert(rows);

        if (error) {
            console.error('[compliance/v8] persist failed', error);
        }
    } catch (err) {
        console.error('[compliance/v8] persist threw', err);
    }
}
