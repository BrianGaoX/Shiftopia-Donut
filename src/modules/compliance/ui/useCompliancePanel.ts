/**
 * useCompliancePanel — Shared hook for V8 compliance evaluation.
 */

import { useState, useCallback, useRef } from 'react';
import { runV8Orchestrator, V8Hit } from '@/modules/compliance/v8';
import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';
import { classifyBuckets, getV8BucketSummary } from './bucket-map';
import type { BucketMap, BucketSummary } from './bucket-map';

export type PanelStatus = 'idle' | 'running' | 'results' | 'error' | 'stale';

export interface PanelResult {
    buckets:      BucketMap;
    summary:      BucketSummary;
    evaluatedAt:  Date;
    rawResult:    V8OrchestratorResult;
    partyB?: {
        buckets: BucketMap;
        summary: BucketSummary;
        rawResult: V8OrchestratorResult;
    };
}

export interface UseCompliancePanelOptions {
    /**
     * Async function that returns the V8 compliance input(s).
     */
    buildInputs: () => Promise<[any] | [any, any]>;
    stage?: 'DRAFT' | 'PUBLISH';
}

export interface UseCompliancePanelReturn {
    status:               PanelStatus;
    result:               PanelResult | null;
    error:                string | null;
    warningsAcknowledged: boolean;
    canProceed:           boolean;
    run:                  () => Promise<void>;
    acknowledgeWarnings:  (ack: boolean) => void;
    markStale:            () => void;
    reset:                () => void;
}

export function useCompliancePanel(opts: UseCompliancePanelOptions): UseCompliancePanelReturn {
    const [status,               setStatus]               = useState<PanelStatus>('idle');
    const [result,               setResult]               = useState<PanelResult | null>(null);
    const [error,                setError]                = useState<string | null>(null);
    const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
    const runningRef = useRef(false);
    const stage = opts.stage ?? 'PUBLISH';

    const run = useCallback(async () => {
        if (runningRef.current) return;
        runningRef.current = true;
        setStatus('running');
        setError(null);
        setWarningsAcknowledged(false);

        try {
            const inputs = await opts.buildInputs();

            if (inputs.length === 2) {
                const rawResult  = runV8Orchestrator(inputs[0], { stage });
                const rawResultB = runV8Orchestrator(inputs[1], { stage });
                
                const bucketsA = classifyBuckets(rawResult.hits);
                const summaryA = getV8BucketSummary(bucketsA);
                const bucketsB = classifyBuckets(rawResultB.hits);
                const summaryB = getV8BucketSummary(bucketsB);

                const combinedSummary: BucketSummary = {
                    blockers:    summaryA.blockers + summaryB.blockers,
                    warnings:    summaryA.warnings + summaryB.warnings,
                    passed:      0,
                    systemFails: summaryA.systemFails + summaryB.systemFails,
                };

                const mergedBuckets = classifyBuckets([...rawResult.hits, ...rawResultB.hits]);
                combinedSummary.passed = mergedBuckets.C.length;

                setResult({ 
                    buckets: mergedBuckets, 
                    summary: combinedSummary, 
                    evaluatedAt: new Date(), 
                    rawResult,
                    partyB: {
                        buckets: bucketsB,
                        summary: summaryB,
                        rawResult: rawResultB
                    }
                });
            } else {
                const rawResult = runV8Orchestrator(inputs[0], { stage });
                const buckets = classifyBuckets(rawResult.hits);
                const summary = getV8BucketSummary(buckets);

                setResult({ buckets, summary, evaluatedAt: new Date(), rawResult });
            }
            setStatus('results');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'V8 compliance check failed';
            setError(msg);
            setStatus('error');
        } finally {
            runningRef.current = false;
        }
    }, [opts, stage]);

    const markStale = useCallback(() => {
        setStatus(prev => prev === 'results' ? 'stale' : prev);
    }, []);

    const reset = useCallback(() => {
        setStatus('idle');
        setResult(null);
        setError(null);
        setWarningsAcknowledged(false);
    }, []);

    const canProceed =
        status === 'results' &&
        result !== null &&
        result.buckets.A.length   === 0 &&
        result.summary.systemFails === 0 &&
        (result.buckets.B.length  === 0 || warningsAcknowledged);

    return {
        status,
        result,
        error,
        warningsAcknowledged,
        canProceed,
        run,
        acknowledgeWarnings: setWarningsAcknowledged,
        markStale,
        reset,
    };
}
