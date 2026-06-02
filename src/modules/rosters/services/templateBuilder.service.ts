import { supabase } from '@/platform/realtime/client';
import {
    demandTemplatesQueries,
    type ClusterKey,
    type DemandTemplateRow,
    type TemplateShiftCell,
} from '@/modules/rosters/api/demandTemplates.queries';

/**
 * Demand Engine L9 — Template Builder
 *
 * Clusters past synthesis runs by (event_type, pax_band, service_type, alcohol,
 * room_count_band) and auto-emits a reusable demand template once a cluster
 * accumulates K=10 events.  The template shifts are the per-cell **median**
 * headcount so a single outlier event cannot distort the template.
 */

// ─── Band helpers ─────────────────────────────────────────────────────────────

export type PaxBand = '<100' | '100-300' | '300-600' | '600-1500' | '1500+';
export type RoomBand = '1' | '2-3' | '4+';

/** Pure, deterministic pax-band classifier. */
export function classifyPaxBand(pax: number): PaxBand {
    if (pax < 100)   return '<100';
    if (pax < 300)   return '100-300';
    if (pax < 600)   return '300-600';
    if (pax < 1500)  return '600-1500';
    return '1500+';
}

/** Pure, deterministic room-count-band classifier. */
export function classifyRoomBand(roomCount: number): RoomBand {
    if (roomCount <= 1) return '1';
    if (roomCount <= 3) return '2-3';
    return '4+';
}

// ─── Median helper ────────────────────────────────────────────────────────────

/**
 * Compute the median of a non-empty number array.
 * Input array is copied before sorting — caller's order is not mutated.
 * Exported for unit testing.
 */
export function computeMedian(values: number[]): number {
    if (values.length === 0) throw new Error('computeMedian: empty input');
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Cluster key builder ──────────────────────────────────────────────────────

export interface EventClusterInput {
    event_type: string | null;
    pax: number;
    service_type: string | null;
    alcohol: boolean | null;
    room_count: number;
}

/**
 * Build a deterministic ClusterKey from raw event fields.
 * Pure — no I/O, no randomness.
 */
export function buildClusterKey(event: EventClusterInput): ClusterKey {
    return {
        event_type:      event.event_type ?? null,
        pax_band:        classifyPaxBand(event.pax),
        service_type:    event.service_type ?? null,
        alcohol:         event.alcohol ?? null,
        room_count_band: classifyRoomBand(event.room_count),
    };
}

/**
 * Derive a stable, human-readable template code from a ClusterKey.
 * Uses underscores throughout; alcohol rendered as 'y' or 'n' (null → 'x').
 */
function deriveTemplateCode(key: ClusterKey): string {
    const et  = (key.event_type  ?? 'any').replace(/\s+/g, '_').toLowerCase();
    const st  = (key.service_type ?? 'any').replace(/\s+/g, '_').toLowerCase();
    const alc = key.alcohol === true ? 'y' : key.alcohol === false ? 'n' : 'x';
    const pb  = key.pax_band.replace(/[<+]/g, '').replace(/-/g, '_');
    return `tmpl_${et}_${pb}_${st}_${alc}_${key.room_count_band.replace(/-/g, '_')}`;
}

// ─── Row types for the internal query ────────────────────────────────────────

interface TensorRow {
    event_id: string;
    slice_idx: number;
    function_code: string;
    level: number;
    headcount: number;
}

interface EventRow {
    event_id: string;
    event_type_name: string | null;
    estimated_total_attendance: number | null;
    service_type: string | null;
    alcohol: boolean | null;
    room_count: number | null;
}

// ─── Auto-build logic ─────────────────────────────────────────────────────────

export interface TryAutoBuildOptions {
    /** Minimum number of distinct events required before a template is emitted. Default 10. */
    minSampleSize?: number;
}

/**
 * Attempt to auto-generate (or refresh) a demand template for the given
 * cluster key.
 *
 * Steps:
 *   1. Fetch venueops_events that match the cluster key.
 *   2. Evaluate band membership in JS (simple, avoids complex SQL CASE).
 *   3. If fewer than minSampleSize distinct events → return null.
 *   4. Fetch demand_tensor rows for those event ids.
 *   5. Group by (slice_idx, function_code, level), compute median headcount.
 *   6. Upsert the template via demandTemplatesQueries.upsert.
 */
export async function tryAutoBuildTemplate(
    clusterKey: ClusterKey,
    options?: TryAutoBuildOptions,
): Promise<DemandTemplateRow | null> {
    const minSampleSize = options?.minSampleSize ?? 10;

    // 1. Fetch candidate events (filter on columns that exist as DB columns).
    let eventQuery = supabase
        .from('venueops_events')
        .select('event_id, event_type_name, estimated_total_attendance, service_type, alcohol, room_count')
        .eq('is_canceled', false);

    if (clusterKey.event_type !== null) {
        eventQuery = eventQuery.eq('event_type_name', clusterKey.event_type);
    }
    if (clusterKey.service_type !== null) {
        eventQuery = eventQuery.eq('service_type', clusterKey.service_type);
    }
    if (clusterKey.alcohol !== null) {
        eventQuery = eventQuery.eq('alcohol', clusterKey.alcohol);
    }

    const { data: rawEvents, error: evErr } = await eventQuery;
    if (evErr) throw new Error(`tryAutoBuildTemplate (events) failed: ${evErr.message}`);

    const events = (rawEvents ?? []) as unknown as EventRow[];

    // 2. Evaluate band membership in JS.
    const matchingEvents = events.filter(ev => {
        const paxBand  = classifyPaxBand(ev.estimated_total_attendance ?? 0);
        const roomBand = classifyRoomBand(ev.room_count ?? 1);
        return paxBand === clusterKey.pax_band && roomBand === clusterKey.room_count_band;
    });

    // 3. Not enough data.
    if (matchingEvents.length < minSampleSize) return null;

    const eventIds = matchingEvents.map(e => e.event_id);

    // 4. Fetch demand_tensor rows for those events.
    const { data: rawTensor, error: tensorErr } = await supabase
        .from('demand_tensor')
        .select('event_id, slice_idx, function_code, level, headcount')
        .in('event_id', eventIds);
    if (tensorErr) throw new Error(`tryAutoBuildTemplate (tensor) failed: ${tensorErr.message}`);

    const tensorRows = (rawTensor ?? []) as TensorRow[];
    if (tensorRows.length === 0) return null;

    // 5. Group by cell key, collect headcounts, then compute median.
    const cellMap = new Map<string, number[]>();
    for (const row of tensorRows) {
        const key = `${row.slice_idx}|${row.function_code}|${row.level}`;
        const bucket = cellMap.get(key);
        if (bucket) {
            bucket.push(row.headcount);
        } else {
            cellMap.set(key, [row.headcount]);
        }
    }

    const shifts: TemplateShiftCell[] = [];
    for (const [key, headcounts] of cellMap.entries()) {
        const [sliceStr, functionCode, levelStr] = key.split('|');
        shifts.push({
            slice_idx:     Number(sliceStr),
            function_code: functionCode,
            level:         Number(levelStr),
            headcount:     Math.round(computeMedian(headcounts)),
            sample_size:   headcounts.length,
        });
    }

    // Sort for deterministic output: slice → function → level.
    shifts.sort((a, b) => {
        if (a.slice_idx !== b.slice_idx)       return a.slice_idx - b.slice_idx;
        if (a.function_code !== b.function_code) return a.function_code.localeCompare(b.function_code);
        return a.level - b.level;
    });

    // 6. Upsert.
    const templateCode = deriveTemplateCode(clusterKey);
    return demandTemplatesQueries.upsert({
        template_code:    templateCode,
        cluster_key:      clusterKey,
        shifts,
        source_event_ids: eventIds,
        is_seeded:        false,
    });
}
