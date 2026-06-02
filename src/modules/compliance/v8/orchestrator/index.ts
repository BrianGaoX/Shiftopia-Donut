/**
 * V8 Compliance Engine — Unified Orchestrator
 *
 * Orchestrates simulation, V8 core evaluation, and hit aggregation.
 *
 * Production-safety layers (all at this chokepoint):
 *   1. Sentry error wrap        — captures unexpected exceptions with context tags;
 *                                  re-throws so callers fail-closed.
 *   2. Audit hook               — structured log + Sentry breadcrumb for every
 *                                  BLOCKING result before the result leaves the engine.
 *   3. Feature flag             — VITE_COMPLIANCE_BLOCKING_ENABLED (default true).
 *                                  When false the engine evaluates normally but downgrades
 *                                  all BLOCKING hits to WARNING so no mutation is gated.
 */

import * as Sentry from '@sentry/react';

import {
    V8OrchestratorInput,
    V8OrchestratorResult,
} from './types';

import { applyV8Simulation }      from './simulation';
import { runV8ComplexBridge }     from '../index';
import { deduplicateV8Hits, consolidateV8Hits, deriveV8Status } from './aggregator';
import { logComplianceRejection } from './audit';

// ---------------------------------------------------------------------------
// Feature flag — safe-by-default (treat missing/non-'false' as enabled).
// ---------------------------------------------------------------------------
const COMPLIANCE_BLOCKING_ENABLED: boolean =
    (import.meta.env.VITE_COMPLIANCE_BLOCKING_ENABLED as string | undefined) !== 'false';

export function runV8Orchestrator(
    input:    V8OrchestratorInput,
    _options: any = {},
): V8OrchestratorResult {
    // Safety layer 1: Sentry error wrap — re-throws so callers fail-closed.
    try {
        return _evaluate(input);
    } catch (err) {
        if (Sentry.getClient()) {
            Sentry.captureException(err, {
                tags: {
                    component:      'v8-orchestrator',
                    operation_type: input.operation_type,
                    mode:           input.mode,
                    employee_id:    input.employee_id,
                },
            });
        }
        throw err;
    }
}

function _evaluate(input: V8OrchestratorInput): V8OrchestratorResult {
    const t0 = performance.now();

    // 1. Simulation (high-performance candidate application)
    const simulated = input.mode === 'SIMULATED'
        ? applyV8Simulation(input.existing_shifts, input.candidate_changes)
        : input.existing_shifts;

    // 2. V8 CORE — unified evaluation
    const v8Hits = runV8ComplexBridge(input, simulated);

    // 3. Normalisation & aggregation
    let dedupedHits        = deduplicateV8Hits(v8Hits as any);
    const consolidatedGroups = consolidateV8Hits(dedupedHits);
    let status             = deriveV8Status(dedupedHits);

    // Safety layer 2: audit hook — fires before any flag rewrite so the raw
    // BLOCKING result is always logged regardless of flag state.
    if (status === 'BLOCKING') {
        logComplianceRejection(input, dedupedHits);
    }

    // Safety layer 3: feature flag kill-switch.
    // When disabled, hits are still returned (UI can show them) but every
    // BLOCKING hit is downgraded to WARNING so no downstream code gates the
    // mutation. overall_status is recomputed from the rewritten hits to keep
    // the result internally consistent.
    if (!COMPLIANCE_BLOCKING_ENABLED && status === 'BLOCKING') {
        if (Sentry.getClient()) {
            Sentry.addBreadcrumb({
                category: 'compliance.blocking.bypassed',
                message:  'COMPLIANCE_BLOCKING_ENABLED=false — BLOCKING downgraded to WARNING',
                level:    'warning',
                data: {
                    employee_id:    input.employee_id,
                    operation_type: input.operation_type,
                    mode:           input.mode,
                    blocking_count: dedupedHits.filter(h => h.status === 'BLOCKING').length,
                },
            });
        }

        dedupedHits = dedupedHits.map(h =>
            h.status === 'BLOCKING'
                ? { ...h, status: 'WARNING' as const, blocking: false }
                : h,
        );

        // Recompute so overall_status stays consistent with rewritten hits.
        status = deriveV8Status(dedupedHits);
    }

    return {
        passed:                status === 'PASS' || status === 'WARNING',
        overall_status:        status,
        hits:                  dedupedHits,
        consolidated_groups:   consolidatedGroups,
        conflict_pairs:        [],
        delta_explanation:     null,
        evaluated_shift_count: simulated.length,
        evaluation_time_ms:    Math.round((performance.now() - t0) * 100) / 100,
    };
}

// Re-exports
export * from './types';
export { validateV8State }   from './validate-combined-state';
export { isV8Eligible }      from './eligibility';
