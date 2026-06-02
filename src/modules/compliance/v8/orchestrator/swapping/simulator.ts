/**
 * Two-Way Swap Engine — Swap Simulator
 *
 * Computes the FINAL SCHEDULE for both employees after a two-way swap
 * WITHOUT any side effects or DB calls.
 *
 * For a swap (A gives X to B, B gives Y to A):
 *
 *   A_new = A_current_shifts − {shift_X} + {shift_Y}
 *   B_new = B_current_shifts − {shift_Y} + {shift_X}
 *
 * The resulting schedules are passed to the compliance checker.
 *
 * Design note:
 *   The compliance engine's SIMULATED mode accepts candidate_changes =
 *   { add_shifts, remove_shifts } and applies them over existing_shifts.
 *   We use that form so the delta explanation and impact window scoping
 *   work correctly (impact window is derived from add_shifts).
 *
 *   For party A:
 *     existing_shifts   = A_current_shifts (unchanged)
 *     candidate_changes = { add_shifts: [shift_Y], remove_shifts: [shift_X_id] }
 *
 *   For party B:
 *     existing_shifts   = B_current_shifts (unchanged)
 *     candidate_changes = { add_shifts: [shift_X], remove_shifts: [shift_Y_id] }
 *
 *   This gives the engine the full picture:
 *     - adds trigger impact scoping around the incoming shift
 *     - removes ensure the outgoing shift doesn't count in rolling windows
 */

import type { SwapRequest, SwapSimulation } from './types';
import type { V8OrchestratorShift, V8ShiftId, V8EmpId } from '../types';

// =============================================================================
// SINGLE SWAP SIMULATION
// =============================================================================

export function simulateSwap(
    request:             SwapRequest,
    shift_x:             V8OrchestratorShift,
    shift_y:             V8OrchestratorShift,
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>,
): SwapSimulation {
    const a_current = existing_shifts_map.get(request.employee_a_id) ?? [];
    const b_current = existing_shifts_map.get(request.employee_b_id) ?? [];

    // A loses shift_X, gains shift_Y
    const a_new_shifts = [
        ...a_current.filter(s => s.id !== shift_x.id),
        shift_y,
    ];

    // B loses shift_Y, gains shift_X
    const b_new_shifts = [
        ...b_current.filter(s => s.id !== shift_y.id),
        shift_x,
    ];

    return {
        swap_id:      request.swap_id,
        request,
        shift_x,
        shift_y,
        a_new_shifts,
        b_new_shifts,
    };
}

// =============================================================================
// BATCH SIMULATION
// =============================================================================

export function simulateAllSwaps(
    swaps:               SwapRequest[],
    shift_catalog:       Map<V8ShiftId, V8OrchestratorShift>,
    existing_shifts_map: Map<V8EmpId, V8OrchestratorShift[]>,
): Map<string, SwapSimulation> {
    const results = new Map<string, SwapSimulation>();

    for (const swap of swaps) {
        const shift_x = shift_catalog.get(swap.shift_x_id);
        const shift_y = shift_catalog.get(swap.shift_y_id);

        // Both shifts must exist (guaranteed by structural validator, but guard anyway)
        if (!shift_x || !shift_y) continue;

        results.set(swap.swap_id, simulateSwap(swap, shift_x, shift_y, existing_shifts_map));
    }

    return results;
}
