/**
 * ScheduleAggregator
 *
 * Fetches and normalises an employee's complete effective schedule for a given
 * date window.  "Effective schedule" means ALL schedule states that represent
 * an active commitment — not only published assignments.
 *
 * States included:
 *
 *   published         Assigned Published shifts (the primary state).
 *   draft             Assigned Draft shifts (saved but not yet published to the
 *                     employee — still represents a planner commitment).
 *   pending_swap      Shifts that would be RECEIVED by this employee from a
 *                     MANAGER_PENDING swap.  Added alongside existing shifts
 *                     (not replacing them) because the swap may still be
 *                     rejected.  This gives the "worst-case" effective load.
 *   pending_assignment (future) — shifts assigned but awaiting sign-off.
 *
 * Why this matters for compliance:
 *   Evaluating only Published shifts can produce false passes when:
 *   - A draft shift and a new candidate shift violate the rest-gap rule.
 *   - Two concurrent pending swaps together exceed the daily-hours cap.
 *
 * The solver ignores the `state` field — it only cares about the time values.
 * `state` is included for observability and debugging.
 */

import { supabase } from '@/platform/realtime/client';
import type { ScenarioWindow } from './scenario-window';

// =============================================================================
// TYPES
// =============================================================================

export type ShiftState = 'published' | 'draft' | 'pending_swap' | 'pending_assignment';

/** A normalised shift from any schedule state. */
export interface UnifiedShift {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes: number;
    state: ShiftState;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

const db = supabase as any;

/** Map a raw shifts row to UnifiedShift. */
function toUnified(row: any, state: ShiftState): UnifiedShift {
    return {
        id:                    row.id,
        shift_date:            row.shift_date,
        start_time:            row.start_time,
        end_time:              row.end_time,
        unpaid_break_minutes:  row.unpaid_break_minutes ?? 0,
        state,
    };
}

// =============================================================================
// AGGREGATOR
// =============================================================================

/**
 * Fetch all active schedule commitments for one employee within the window.
 *
 * @param employeeId  UUID of the employee.
 * @param window      Date range (start / end as YYYY-MM-DD).
 * @returns           Array of UnifiedShift — deduplicated by shift ID.
 */
export async function aggregateSchedule(
    employeeId: string,
    window: ScenarioWindow,
): Promise<UnifiedShift[]> {
    const seen = new Set<string>();
    const shifts: UnifiedShift[] = [];

    const add = (s: UnifiedShift) => {
        if (!seen.has(s.id)) {
            seen.add(s.id);
            shifts.push(s);
        }
    };

    // ── 1. Published + Draft assigned shifts ────────────────────────────────
    //
    // These are the primary schedule state: shifts currently assigned to the
    // employee and within the scenario window.
    const { data: assignedRows, error: assignedErr } = await db
        .from('shifts')
        .select('id, shift_date, start_time, end_time, unpaid_break_minutes, lifecycle_status')
        .eq('assigned_employee_id', employeeId)
        .in('lifecycle_status', ['Published', 'Draft'])
        .gte('shift_date', window.start)
        .lte('shift_date', window.end)
        .is('deleted_at', null)
        .eq('is_cancelled', false);

    if (!assignedErr && assignedRows) {
        for (const row of assignedRows) {
            const state: ShiftState = row.lifecycle_status === 'Draft' ? 'draft' : 'published';
            add(toUnified(row, state));
        }
    }

    // ── 2. Pending swap incoming shifts ────────────────────────────────────
    //
    // When a swap is in MANAGER_PENDING state, both parties have an outstanding
    // commitment to receive a new shift.  Include the "incoming" shift for each
    // pending swap this employee is part of.
    //
    // The employee can be:
    //   a) The requester  → will receive `target_shift` (shifts!target_shift_id)
    //   b) The target     → will receive `requester_shift` (shifts!requester_shift_id)

    const [requesterResult, targetResult] = await Promise.all([
        // a) Employee is the requester — fetch the target shift they'd receive
        db
            .from('shift_swaps')
            .select(`
                target_shift:shifts!target_shift_id(
                    id, shift_date, start_time, end_time, unpaid_break_minutes
                )
            `)
            .eq('requester_id', employeeId)
            .eq('status', 'MANAGER_PENDING')
            .not('target_shift_id', 'is', null),

        // b) Employee is the target — fetch the requester shift they'd receive
        db
            .from('shift_swaps')
            .select(`
                requester_shift:shifts!requester_shift_id(
                    id, shift_date, start_time, end_time, unpaid_break_minutes
                )
            `)
            .eq('target_id', employeeId)
            .eq('status', 'MANAGER_PENDING'),
    ]);

    if (!requesterResult.error && requesterResult.data) {
        for (const row of requesterResult.data) {
            const s = row.target_shift;
            if (s && s.shift_date >= window.start && s.shift_date <= window.end) {
                add(toUnified(s, 'pending_swap'));
            }
        }
    }

    if (!targetResult.error && targetResult.data) {
        for (const row of targetResult.data) {
            const s = row.requester_shift;
            if (s && s.shift_date >= window.start && s.shift_date <= window.end) {
                add(toUnified(s, 'pending_swap'));
            }
        }
    }

    return shifts;
}

/**
 * Aggregate schedules for multiple employees simultaneously.
 *
 * @param employeeIds  Array of employee UUIDs.
 * @param window       Shared date window.
 * @returns            Map of employeeId → UnifiedShift[]
 */
export async function aggregateSchedules(
    employeeIds: string[],
    window: ScenarioWindow,
): Promise<Map<string, UnifiedShift[]>> {
    const results = await Promise.all(
        employeeIds.map(id => aggregateSchedule(id, window).then(shifts => [id, shifts] as const)),
    );
    return new Map(results);
}
