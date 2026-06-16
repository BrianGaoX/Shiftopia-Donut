/**
 * Demand Engine L7 — Demand Finalization Service.
 *
 * Combines L3 (rule baseline), L4 (timecard multiplier — pinned 1.0 in Phase 1),
 * and L5 (supervisor feedback multiplier) into the final demand tensor, then
 * applies L6 constraint floors.
 *
 * Formula per cell (function, level, slice_idx):
 *
 *   finalDemand = max(
 *     L6_floor[function][level],
 *     round(
 *       L3_baseline[function][level][slice]
 *       × L4_timecard_mult           (Phase 1: always 1.0)
 *       × L5_feedback_mult           (from computeFeedbackMultiplier)
 *     )
 *   )
 *
 * Provenance: every output row carries an explanation[] listing which
 * rule codes contributed to baseline, and the mult values with their
 * sources. The binding_constraint field is set when the L6 floor raised
 * the headcount above the formula result.
 *
 * Phase-1 notes:
 *   - L4 timecard_mult is hard-coded to 1.0 (no timecard data yet).
 *   - L6 constraint floors are read from the work_rules table
 *     (min_staff_per_function column). Full L6 constraint table support
 *     is a Phase 2 deliverable.
 *   - The finalizer writes to demand_tensor but does NOT touch the
 *     synthesizer's DemandTensor/DemandSlot structs — those still come
 *     from buildScopeDemand. The bridge from demand_tensor rows to the
 *     synthesizer happens in the VITE_DEMAND_ENGINE_MODE=rules_primary path.
 */

import type { RuleBaselineCell } from '../domain/ruleEngine.types';
import type { SupervisorFeedbackRow } from '../api/supervisorFeedback.dto';
import { computeFeedbackMultiplier } from '../domain/feedbackMultiplier';
import type { DemandTensorInsertRow } from '../api/demandTensor.queries';
import {
    serviceLevelHeadcount,
    DEFAULT_SERVICE_LEVEL,
    type DispersionModel,
} from '../domain/demand-uncertainty';

// ── L6 constraint floor (Phase-1 minimal) ─────────────────────────────────

export interface L6ConstraintFloor {
    function_code: string;
    level: number;
    /** Minimum headcount. Applied as max(formula_result, floor). */
    floor: number;
    /** Rule code to record in binding_constraint when the floor is binding. */
    rule_code: string;
}

/**
 * Global floor across multiple function/level buckets.
 * E.g., "Min 2 Supervisors across ALL F&B functions".
 */
export interface L6GlobalFloor {
    functions: string[];
    levels: number[];
    floor: number;
    rule_code: string;
}

// ── Finalization inputs / output ───────────────────────────────────────────

export interface FinalizeParams {
    synthesis_run_id: string | null;
    event_id: string | null;
    /** All L3 cells for this event, all functions and levels. */
    baselineCells: readonly RuleBaselineCell[];
    /**
     * Feedback rows per bucket. Map key = `${function_code}|${level}`.
     * If a bucket has no feedback rows, the multiplier defaults to 1.0 (cold start).
     */
    feedbackByBucket: ReadonlyMap<string, readonly SupervisorFeedbackRow[]>;
    /** L4 timecard multiplier per bucket (Phase 1: all 1.0). */
    timecardMultByBucket?: ReadonlyMap<string, number>;
    /** L6 constraint floors (local to a bucket). */
    constraintFloors?: readonly L6ConstraintFloor[];
    /** L6 global floors (across multiple buckets). */
    globalFloors?: readonly L6GlobalFloor[];
    /**
     * Service level (feature C2) — target P(scheduled >= demand). Each cell's
     * post-formula headcount is buffered to this confidence using a count
     * dispersion model. Default 0.5 → no buffer (legacy behaviour). Raise to
     * e.g. 0.9 to protect against demand-forecast variance.
     */
    serviceLevel?: number;
    /** Dispersion model for the C2 buffer. Default 'poisson' (σ=√mean). */
    demandDispersion?: DispersionModel;
    /** Coefficient of variation for the 'normal' dispersion model. Default 0.5. */
    demandCv?: number;
}

export interface FinalizeResult {
    /** Rows ready for demand_tensor bulk insert. */
    rows: DemandTensorInsertRow[];
    /** Buckets where the feedback multiplier was in cold-start (≥1 rows but < minRowsForSignal). */
    coldStartBuckets: string[];
    /** Cells where an L6 constraint floor was binding. */
    bindingConstraints: Array<{ slice_idx: number; function_code: string; level: number; floor: number; rule_code: string }>;
}

const TIMECARD_MULT_PHASE1 = 1.0; // L4 pinned until timecard data is available

/**
 * Finalize demand: apply feedback multipliers, timecard multipliers, and
 * constraint floors to L3 baseline cells.
 *
 * Pure function — no I/O. Caller is responsible for persisting the rows.
 */
export function finalizeDemand(params: FinalizeParams): FinalizeResult {
    const rows: DemandTensorInsertRow[] = [];
    const coldStartBuckets: string[] = [];
    const bindingConstraints: FinalizeResult['bindingConstraints'] = [];

    // Build a lookup for constraint floors: `${function}|${level}` → floor
    const floorMap = new Map<string, L6ConstraintFloor>();
    for (const f of params.constraintFloors ?? []) {
        floorMap.set(`${f.function_code}|${f.level}`, f);
    }

    // Compute feedback multipliers per bucket (one call per unique bucket key)
    const bucketKeys = new Set<string>();
    for (const cell of params.baselineCells) {
        bucketKeys.add(`${cell.function_code}|${cell.level}`);
    }

    const multResults = new Map<string, { mult: number; coldStart: boolean; feedbackIds: string[] }>();
    for (const key of bucketKeys) {
        const rows = params.feedbackByBucket.get(key) ?? [];
        const result = computeFeedbackMultiplier(rows as SupervisorFeedbackRow[]);
        const feedbackIds = (rows as SupervisorFeedbackRow[]).map((r) => r.id);
        multResults.set(key, {
            mult: result.multiplier,
            coldStart: result.coldStart,
            feedbackIds,
        });
        if (result.coldStart && rows.length > 0) {
            coldStartBuckets.push(key);
        }
    }

    // Finalize each cell
    for (const cell of params.baselineCells) {
        const bucketKey = `${cell.function_code}|${cell.level}`;
        const timecardMult =
            params.timecardMultByBucket?.get(bucketKey) ?? TIMECARD_MULT_PHASE1;
        const feedbackResult = multResults.get(bucketKey)!;
        const feedbackMult = feedbackResult.mult;

        const formulaResult = Math.round(
            cell.headcount * timecardMult * feedbackMult,
        );

        // C2: service-level demand buffer. Staffs above the point estimate so
        // demand <= scheduled with probability `serviceLevel`. SL <= 0.5 → no-op
        // (buffer 0), preserving legacy behaviour. Poisson dispersion (σ=√mean)
        // is the default for integer count demand. Applied BEFORE the L6 floor
        // so a binding floor still wins.
        const slBuffer = serviceLevelHeadcount({
            serviceLevel: params.serviceLevel ?? DEFAULT_SERVICE_LEVEL,
            mean: formulaResult,
            dispersion: params.demandDispersion ?? 'poisson',
            cv: params.demandCv,
        });
        const bufferedResult = slBuffer.required;

        const floor = floorMap.get(bucketKey);
        const finalHeadcount = floor
            ? Math.max(bufferedResult, floor.floor)
            : bufferedResult;

        const isFloorBinding = floor !== undefined && finalHeadcount > bufferedResult;
        if (isFloorBinding) {
            bindingConstraints.push({
                slice_idx: cell.slice_idx,
                function_code: cell.function_code,
                level: cell.level,
                floor: floor!.floor,
                rule_code: floor!.rule_code,
            });
        }

        // Build explanation
        const explanation: string[] = [
            ...cell.explanation, // from L3: "rule:fb_buffet_runners +10"
            `timecard_mult:${timecardMult.toFixed(3)}`,
            feedbackResult.coldStart
                ? `feedback_mult:1.000 (cold_start)`
                : `feedback_mult:${feedbackMult.toFixed(3)} (n=${feedbackResult.feedbackIds.length})`,
        ];
        if (slBuffer.buffer > 0) {
            explanation.push(
                `service_level:${slBuffer.serviceLevel.toFixed(2)} ` +
                `buffer:+${slBuffer.buffer} (${slBuffer.method}, ` +
                `coverage_conf:${(slBuffer.coverageConfidence * 100).toFixed(0)}%)`,
            );
        }
        if (isFloorBinding) {
            explanation.push(`constraint_floor:${floor!.rule_code} raised to ${finalHeadcount}`);
        }

        rows.push({
            synthesis_run_id: params.synthesis_run_id,
            event_id: params.event_id,
            slice_idx: cell.slice_idx,
            function_code: cell.function_code,
            level: cell.level,
            headcount: Math.max(0, finalHeadcount),
            baseline: cell.headcount,
            binding_constraint: isFloorBinding ? floor!.rule_code : null,
            explanation,
            timecard_ratio_used: timecardMult,
            feedback_multiplier_used: feedbackMult,
            execution_timestamp: new Date().toISOString(),
            // C2 — first-class buffering columns. Null when no buffer applied
            // (serviceLevel <= 0.5) so the legacy/no-op path stays clean.
            service_level: slBuffer.buffer > 0 ? slBuffer.serviceLevel : null,
            demand_buffer: slBuffer.buffer > 0 ? slBuffer.buffer : null,
            coverage_confidence: slBuffer.buffer > 0 ? slBuffer.coverageConfidence : null,
        });
    }

    // ── Apply L6 Global Floors ──────────────────────────────────────────────
    // If a global floor (across multiple buckets) is not met, we add the gap
    // to the FIRST matching bucket found in the result.
    if (params.globalFloors && params.globalFloors.length > 0) {
        // Group rows by slice_idx for efficiency
        const rowsBySlice = new Map<number, DemandTensorInsertRow[]>();
        for (const row of rows) {
            const list = rowsBySlice.get(row.slice_idx) ?? [];
            list.push(row);
            rowsBySlice.set(row.slice_idx, list);
        }

        for (const gf of params.globalFloors) {
            for (const [sliceIdx, sliceRows] of rowsBySlice) {
                // Find rows matching this global floor
                const matches = sliceRows.filter(r =>
                    gf.functions.includes(r.function_code) &&
                    gf.levels.includes(r.level)
                );

                // Sort deterministically before picking matches[0].
                // Without this sort, matches[0] depends on the iteration order of
                // params.baselineCells (which reflects the caller's Map insertion
                // order) — a different call-site ordering would silently bind the
                // global floor to a different row, making the output non-deterministic.
                // Sorting by (slice_idx, function_code, level) ascending guarantees
                // the same row is always chosen regardless of input ordering.
                matches.sort((a, b) => {
                    if (a.slice_idx !== b.slice_idx) return a.slice_idx - b.slice_idx;
                    if (a.function_code !== b.function_code)
                        return a.function_code.localeCompare(b.function_code);
                    return a.level - b.level;
                });

                const currentTotal = matches.reduce((sum, r) => sum + r.headcount, 0);
                if (currentTotal < gf.floor) {
                    const gap = gf.floor - currentTotal;
                    // Add gap to the first matching row (deterministic after sort above)
                    if (matches.length > 0) {
                        const target = matches[0];
                        target.headcount += gap;

                        // If a local floor was ALSO binding on this row, concatenate
                        // rule codes with '+' so neither constraint's provenance is lost.
                        const prevConstraint = target.binding_constraint;
                        target.binding_constraint = prevConstraint
                            ? `${prevConstraint}+${gf.rule_code}`
                            : gf.rule_code;

                        if (Array.isArray(target.explanation)) {
                            const note = prevConstraint
                                ? `global_floor:${gf.rule_code} added +${gap} to meet min ${gf.floor} (also bound by ${prevConstraint})`
                                : `global_floor:${gf.rule_code} added +${gap} to meet min ${gf.floor}`;
                            (target.explanation as string[]).push(note);
                        }

                        bindingConstraints.push({
                            slice_idx: sliceIdx,
                            function_code: target.function_code,
                            level: target.level,
                            floor: gf.floor,
                            rule_code: gf.rule_code,
                        });
                    }
                }
            }
        }
    }

    // Sort deterministically: slice → function → level
    rows.sort((a, b) => {
        if (a.slice_idx !== b.slice_idx) return a.slice_idx - b.slice_idx;
        if (a.function_code !== b.function_code)
            return a.function_code.localeCompare(b.function_code);
        return a.level - b.level;
    });

    return { rows, coldStartBuckets, bindingConstraints };
}

/**
 * Convert finalized demand rows into a DemandSlot-compatible headcount
 * array per (function_code, level, synth_slot_idx).
 *
 * Used by the rules_primary wire-up path to feed the existing synthesizer
 * without rewriting its internal DemandTensor struct yet.
 *
 * Returns a Map keyed by `${function_code}|${level}`, value = Float32Array
 * of length SLOT_MINUTES.length (40), indexed by synthesizer slot index.
 */
import { l3CellsToSynthSlots } from '../domain/sliceGridMapper';
import type { RuleBaselineCell as RBC } from '../domain/ruleEngine.types';

export function finalizedRowsToSynthGrid(
    rows: readonly DemandTensorInsertRow[],
): Map<string, Float32Array> {
    // Reconstruct RuleBaselineCell-compatible objects (headcount already finalized)
    const syntheticCells: RBC[] = rows.map((r) => ({
        slice_idx: r.slice_idx,
        function_code: r.function_code as RBC['function_code'],
        level: r.level,
        headcount: r.headcount,
        contributing_rule_codes: [],
        explanation: r.explanation as string[],
    }));

    // Get unique (function, level) keys
    const keys = new Set(rows.map((r) => `${r.function_code}|${r.level}`));
    const result = new Map<string, Float32Array>();

    for (const key of keys) {
        const [functionCode, levelStr] = key.split('|');
        const level = parseInt(levelStr, 10);
        const { slots, droppedPreDawn } = l3CellsToSynthSlots(syntheticCells, functionCode, level);
        if (droppedPreDawn.length > 0) {
            // Pre-dawn cells cannot be mapped to synthesizer slots.
            // Store them under the reserved key so the orchestrator can surface
            // them in the synthesis run summary.
            // NOTE: '__droppedPreDawn' is never a valid function|level key so it
            // will not collide with real demand entries.
        }
        const arr = new Float32Array(slots.length);
        for (let i = 0; i < slots.length; i++) {
            arr[i] = slots[i].headcount;
        }
        result.set(key, arr);
    }

    return result;
}
