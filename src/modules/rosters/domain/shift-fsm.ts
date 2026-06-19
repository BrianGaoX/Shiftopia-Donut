/**
 * Shift FSM — State Derivation Utility
 *
 * Single source of truth for deriving the logical FSM state of a shift from
 * its 5 DB columns. This mirrors the PL/pgSQL `get_shift_fsm_state()` function
 * exactly — any change here must be reflected there, and vice versa.
 *
 * Inputs:  lifecycle_status, assignment_status, assignment_outcome,
 *          trading_status, is_cancelled
 * Output:  ShiftStateID  ('S1' … 'S15')
 *
 * Priority order (hard-coded, must not change):
 *   Cancelled > Completed > InProgress > Published > Draft
 */

// ─── State ID ────────────────────────────────────────────────────────────────

export type ShiftStateID =
    | 'S1'      // Draft – Unassigned
    | 'S2'      // Draft – Assigned
    | 'S3'      // Published – Offered   (assigned + outcome = null)
    | 'S4'      // Published – Confirmed
    | 'S5'      // Published – Bidding   (unassigned)
    | 'S9'      // Published – Trade Requested
    | 'S10'     // Published – Trade Accepted
    | 'S11'     // In Progress
    | 'S13'     // Completed
    | 'S15'     // Cancelled
    | 'UNKNOWN'; // Stale/unrecognized DB combination — renders as neutral fallback

// ─── Input shape ─────────────────────────────────────────────────────────────

export interface ShiftFSMInput {
    lifecycle_status: string;
    assignment_status: string;
    assignment_outcome: string | null | undefined;
    trading_status: string | null | undefined;
    is_cancelled: boolean;
}

// ─── State metadata ───────────────────────────────────────────────────────────

export interface ShiftFSMStateInfo {
    id: ShiftStateID;
    label: string;
    description: string;
    /** Tailwind colour token — use with bg-/text-/border- prefixes */
    color: 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'orange' | 'red' | 'gray';
}

export const FSM_STATE_META: Record<ShiftStateID, ShiftFSMStateInfo> = {
    S1:  { id: 'S1',  label: 'Draft',             description: 'Created, not yet assigned or published',    color: 'slate'   },
    S2:  { id: 'S2',  label: 'Draft (Assigned)',   description: 'Assigned in draft — not yet published',     color: 'slate'   },
    S3:  { id: 'S3',  label: 'Offered',            description: 'Published and offered to an employee',      color: 'blue'    },
    S4:  { id: 'S4',  label: 'Confirmed',          description: 'Assignment accepted and confirmed',         color: 'emerald' },
    S5:  { id: 'S5',  label: 'Bidding',            description: 'Open for employee bids',                    color: 'violet'  },
    S9:  { id: 'S9',  label: 'Trade Requested',    description: 'Employee has requested a trade',            color: 'amber'   },
    S10: { id: 'S10', label: 'Trade Accepted',     description: 'Trade accepted — awaiting manager approval',color: 'orange'  },
    S11: { id: 'S11', label: 'In Progress',        description: 'Shift has started',                         color: 'blue'    },
    S13:     { id: 'S13',     label: 'Completed',          description: 'Shift has ended',                           color: 'gray'    },
    S15:     { id: 'S15',     label: 'Cancelled',          description: 'Shift has been cancelled',                  color: 'red'     },
    UNKNOWN: { id: 'UNKNOWN', label: 'Unknown',            description: 'Unrecognized shift state — stale DB data',  color: 'gray'    },
};

// ─── Core derivation function ─────────────────────────────────────────────────

/**
 * Derives the FSM state from a shift's 5 lifecycle columns.
 *
 * Throws if the combination is invalid (should never happen on well-formed DB
 * data; the `validate_shift_state_invariants` trigger enforces this server-side).
 */
export function getShiftFSMState(shift: ShiftFSMInput): ShiftStateID {
    // 1. Cancelled — highest priority, short-circuits everything
    if (shift.is_cancelled) return 'S15';

    // 2. Completed
    if (shift.lifecycle_status === 'Completed') return 'S13';

    // 3. In Progress
    if (shift.lifecycle_status === 'InProgress') return 'S11';

    // 4. Published — sub-states resolved by assignment + trade fields
    if (shift.lifecycle_status === 'Published') {
        // Trade overrides assignment outcome
        if (shift.trading_status === 'TradeRequested') return 'S9';
        if (shift.trading_status === 'TradeAccepted')  return 'S10';

        if (shift.assignment_status === 'assigned') {
            // Confirmed → S4
            if (shift.assignment_outcome === 'confirmed') return 'S4';
            // NULL or any legacy value ('pending', 'offered', etc.) → S3 (Offered, awaiting decision).
            // assignment_outcome is now constrained to NULL | 'confirmed' | 'no_show', but
            // older rows may carry stale values — treat them all as "no outcome yet".
            return 'S3';
        }

        // Unassigned while published = bidding (or waiting for assignment)
        if (shift.assignment_status === 'unassigned') return 'S5';
    }

    // 5. Draft
    if (shift.lifecycle_status === 'Draft') {
        if (shift.assignment_status === 'assigned') return 'S2';
        return 'S1';
    }

    // 6. Unrecognized combination — stale DB data or schema drift.
    // Log a warning but never crash the UI; render as UNKNOWN so the card
    // shows a neutral fallback state instead of an ErrorBoundary.
    console.warn(
        `[FSM] Unrecognized shift state combination: lifecycle=${shift.lifecycle_status} ` +
        `assignment=${shift.assignment_status} outcome=${shift.assignment_outcome} ` +
        `trading=${shift.trading_status} cancelled=${shift.is_cancelled}`
    );
    return 'UNKNOWN';
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Returns state metadata alongside the derived state ID. */
export function getShiftFSMStateInfo(shift: ShiftFSMInput): ShiftFSMStateInfo {
    return FSM_STATE_META[getShiftFSMState(shift)];
}

/** True if the shift is in any terminal state (no further transitions possible). */
export function isShiftTerminal(shift: ShiftFSMInput): boolean {
    const state = getShiftFSMState(shift);
    return state === 'S13' || state === 'S15';
}

/** True if the shift currently has an open bidding window. */
export function isShiftOnBidding(shift: ShiftFSMInput): boolean {
    return getShiftFSMState(shift) === 'S5';
}

/** True if the shift is waiting for an offer response. */
export function isShiftOffered(shift: ShiftFSMInput): boolean {
    return getShiftFSMState(shift) === 'S3';
}
