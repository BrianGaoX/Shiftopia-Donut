/**
 * V8 Compliance Engine — Aggregator
 * 
 * Responsibilities:
 *   1. deduplicateV8Hits
 *   2. consolidateV8Hits
 *   3. deriveV8Status
 *   4. combineV8SwapResults
 */

import {
    V8Hit,
    V8ConsolidatedGroup,
    V8Status,
    V8OrchestratorResult,
} from './types';
import { V8ShiftId } from '../types';
import { V8_RULE_METADATA } from '../metadata';

export function deduplicateV8Hits(hits: V8Hit[]): V8Hit[] {
    const seen = new Set<string>();
    return hits.filter(hit => {
        const key = `${hit.rule_id}:${[...hit.affected_shifts].sort().join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function consolidateV8Hits(hits: V8Hit[]): V8ConsolidatedGroup[] {
    if (hits.length === 0) return [];

    const parent = hits.map((_, i) => i);

    function find(i: number): number {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
    }
    function union(i: number, j: number): void {
        parent[find(i)] = find(j);
    }

    const shiftToIndices = new Map<V8ShiftId, number[]>();
    hits.forEach((hit, i) => {
        for (const s of hit.affected_shifts) {
            if (!shiftToIndices.has(s)) shiftToIndices.set(s, []);
            shiftToIndices.get(s)!.push(i);
        }
    });

    for (const indices of shiftToIndices.values()) {
        for (let k = 1; k < indices.length; k++) {
            union(indices[0], indices[k]);
        }
    }

    const groupMap = new Map<number, V8Hit[]>();
    hits.forEach((hit, i) => {
        const root = find(i);
        if (!groupMap.has(root)) groupMap.set(root, []);
        groupMap.get(root)!.push(hit);
    });

    return Array.from(groupMap.values()).map((groupHits, idx) => {
        const allShifts  = [...new Set(groupHits.flatMap(h => h.affected_shifts))];
        const worst: V8Status = groupHits.some(h => h.status === 'BLOCKING') ? 'BLOCKING' : 'WARNING';
        const categories = [...new Set(
            groupHits.map(h => V8_RULE_METADATA[h.rule_id]?.category ?? h.rule_id)
        )];

        const summary = groupHits.length === 1
            ? groupHits[0].summary
            : `${groupHits.length} violations on ${allShifts.length} shift(s) — ${categories.join(' + ')} constraints exceeded`;

        return {
            group_id:        `GROUP-${String(idx + 1).padStart(2, '0')}`,
            summary,
            status:          worst,
            hits:            groupHits,
            affected_shifts: allShifts,
        };
    });
}

export function deriveV8Status(hits: V8Hit[]): V8Status {
    if (hits.some(h => h.status === 'BLOCKING')) return 'BLOCKING';
    if (hits.some(h => h.status === 'WARNING'))  return 'WARNING';
    return 'PASS';
}

export function combineV8SwapResults(
    result_a: V8OrchestratorResult,
    result_b: V8OrchestratorResult,
): { status: V8Status; per_employee: [V8OrchestratorResult, V8OrchestratorResult] } {
    const rank = (s: V8Status) => s === 'BLOCKING' ? 2 : s === 'WARNING' ? 1 : 0;

    const status: V8Status =
        rank(result_a.overall_status) >= rank(result_b.overall_status)
            ? result_a.overall_status
            : result_b.overall_status;

    return { status, per_employee: [result_a, result_b] };
}
