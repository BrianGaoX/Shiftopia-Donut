/**
 * Unified Planning — Compliance Snapshot Builder
 *
 * Constructs typed compliance snapshots from raw engine results.
 * Snapshots are persisted to the DB at offer-selection time and
 * used during manager approval to:
 *   1. Detect whether the compliance window has gone stale (> 15 min)
 *   2. Provide optimistic lock timestamps for the approval RPC
 *   3. Display human-readable rule hit details in the manager UI
 *
 * All functions are pure — no DB calls, no side effects.
 */

import type { V8Status, V8Hit } from '@/modules/compliance/v8/types';
import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';
import type { BidComplianceSnapshot, SwapComplianceSnapshot, BlockingHit } from '../types';

// =============================================================================
// STATUS SEVERITY RANKING
// =============================================================================

/**
 * Derives the combined V8Status from two individual V8Status values.
 * Precedence: BLOCKING > WARNING > PASS
 * The stricter of the two always wins.
 */
export function combinedStatus(a: V8Status, b: V8Status): V8Status {
  const rank = (s: V8Status): number => {
    if (s === 'BLOCKING') return 2;
    if (s === 'WARNING')  return 1;
    return 0;
  };

  return rank(a) >= rank(b) ? a : b;
}

// =============================================================================
// BID SNAPSHOT BUILDER
// =============================================================================

/**
 * Build a BidComplianceSnapshot from a single compliance result.
 *
 * The snapshot extends V8OrchestratorResult with two extra fields:
 *   shift_updated_at — the shifts.updated_at value captured just before
 *                      the compliance run (used for optimistic locking on approve)
 *   evaluated_at     — ISO timestamp of when the compliance engine was called
 *
 * These two timestamps together allow the approval layer to detect:
 *   a) Whether the shift has been mutated since compliance ran (shift_updated_at mismatch)
 *   b) Whether the compliance result is stale (> 15 min since evaluated_at)
 */
export function buildBidSnapshot(params: {
  result: V8OrchestratorResult;
  shiftUpdatedAt: string;
}): BidComplianceSnapshot {
  const { result, shiftUpdatedAt } = params;

  return {
    ...result,
    shift_updated_at: shiftUpdatedAt,
    evaluated_at: new Date().toISOString(),
  };
}

// =============================================================================
// SWAP SNAPSHOT BUILDER
// =============================================================================

/**
 * Build a SwapComplianceSnapshot from two per-party compliance results.
 *
 * The combined_status is the worst of the two parties' statuses —
 * if either party has a BLOCKING violation, the whole swap is blocked.
 *
 * Both shift timestamps are stored for the approval RPC's optimistic lock:
 *   shift_updated_at        — initiator's shift (request.shift_id)
 *   target_shift_updated_at — offerer's shift (offer.offered_shift_id)
 */
export function buildSwapSnapshot(params: {
  resultA: V8OrchestratorResult;
  resultB: V8OrchestratorResult;
  shiftUpdatedAt: string;
  targetShiftUpdatedAt: string;
}): SwapComplianceSnapshot {
  const { resultA, resultB, shiftUpdatedAt, targetShiftUpdatedAt } = params;

  return {
    combined_status: combinedStatus(resultA.overall_status, resultB.overall_status),
    party_a: resultA,
    party_b: resultB,
    shift_updated_at: shiftUpdatedAt,
    target_shift_updated_at: targetShiftUpdatedAt,
    evaluated_at: new Date().toISOString(),
  };
}

// =============================================================================
// BLOCKING HIT EXTRACTION
// =============================================================================

/**
 * Extract structured BlockingHit objects from a compliance snapshot.
 *
 * For BID snapshots:
 *   All BLOCKING rule hits are returned with party='A' (only one party).
 *
 * For SWAP snapshots:
 *   - Hits that appear only in party_a → labeled 'A'
 *   - Hits that appear only in party_b → labeled 'B'
 *   - Hits with the same rule_id in BOTH parties → labeled 'BOTH'
 *
 * Only BLOCKING severity hits are returned — warnings are not included
 * in the blocking hits list (they appear in the full snapshot instead).
 */
export function extractBlockingHits(
  snapshot: BidComplianceSnapshot | SwapComplianceSnapshot,
): BlockingHit[] {
  const isSwap = 'combined_status' in snapshot && 'party_a' in snapshot;

  if (!isSwap) {
    // BID snapshot — single result
    const bidSnap = snapshot as BidComplianceSnapshot;
    return bidSnap.hits
      .filter(h => h.status === 'BLOCKING')
      .map(h => ({
        rule_id: h.rule_id,
        summary: h.summary,
        party: 'A' as const,
        severity: 'BLOCKING' as const,
      }));
  }

  // SWAP snapshot — two results; detect overlap by rule_id
  const swapSnap = snapshot as SwapComplianceSnapshot;
  const hitsA = swapSnap.party_a.hits.filter(h => h.status === 'BLOCKING');
  const hitsB = swapSnap.party_b.hits.filter(h => h.status === 'BLOCKING');

  const ruleIdsA = new Set(hitsA.map(h => h.rule_id));
  const ruleIdsB = new Set(hitsB.map(h => h.rule_id));

  const result: BlockingHit[] = [];

  for (const hit of hitsA) {
    const party: 'A' | 'B' | 'BOTH' = ruleIdsB.has(hit.rule_id) ? 'BOTH' : 'A';
    result.push({
      rule_id: hit.rule_id,
      summary: buildSwapHitSummary(hit, party),
      party,
      severity: 'BLOCKING',
    });
  }

  for (const hit of hitsB) {
    // Skip rules already added from party_a (they were labeled BOTH there)
    if (ruleIdsA.has(hit.rule_id)) continue;
    result.push({
      rule_id: hit.rule_id,
      summary: hit.summary,
      party: 'B',
      severity: 'BLOCKING',
    });
  }

  return result;
}

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

function buildSwapHitSummary(hit: V8Hit, party: 'A' | 'B' | 'BOTH'): string {
  if (party === 'BOTH') {
    return `[Both parties] ${hit.summary}`;
  }
  return hit.summary;
}
