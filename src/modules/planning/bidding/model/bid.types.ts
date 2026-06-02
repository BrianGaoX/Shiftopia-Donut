
import { Shift } from '@/modules/rosters';

// --- Types ---
export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'selected';

/**
 * Per-shift participation status.
 * Used by the unified "Open Shifts" view to drive per-card state machine.
 */
export type ParticipationStatus =
    | 'not_eligible'      // user is last_dropped_by / last_rejected_by — cannot re-bid
    | 'dropped'           // user dropped the shift
    | 'rejected_offer'    // user rejected the shift offer
    | 'not_participated'  // no bid placed
    | 'pending'           // active bid awaiting manager review
    | 'selected'          // bid accepted / selected
    | 'rejected'          // bid rejected
    | 'auto_rejected'     // bid auto-rejected because shift start_time has passed without selection
    | 'expired';          // bidding window closed before user bid

export interface Bid {
    id: string;
    shift_id: string;
    employee_id: string;
    status: BidStatus;
    created_at: string;
    updated_at?: string;
    notes?: string;
    manager_notes?: string;
    shift?: Shift;
    employee?: {
        id: string;
        first_name: string;
        last_name: string;
        email: string;
    };
    employee_name?: string; // Virtual field for UI
}

export interface ShiftBid extends Bid { } // Alias for backward compatibility if needed
