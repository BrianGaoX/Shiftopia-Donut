import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import type { ParticipationStatus } from '../../model/bid.types';

type ShiftLike = {
    id: unknown;
    date: string;
    startTime: string;
    startAt?: string | null;
    last_rejected_by?: string | null;
    last_dropped_by?: string | null;
    droppedById?: string | null;
};

type BidLike = {
    shiftId: unknown;
    status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'selected';
};

export function getParticipationStatus(
    shift: ShiftLike,
    allMyBids: BidLike[],
    userId: string
): ParticipationStatus {
    // Permanent lockout if user dropped or rejected
    if (shift.last_rejected_by === userId) return 'rejected_offer';
    if (shift.last_dropped_by === userId || shift.droppedById === userId) return 'dropped';

    // Find user's bid (only one active bid per shift now)
    const currentBid = allMyBids.find(b =>
        String(b.shiftId) === String(shift.id) &&
        b.status !== 'withdrawn'
    );

    const shiftStart = shift.startAt
        ? new Date(shift.startAt)
        : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);

    if (!currentBid) {
        // Check if bidding window has closed
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        if (new Date() >= biddingCloses) return 'expired';
        return 'not_participated';
    }

    if (currentBid.status === 'pending') {
        if (new Date() >= shiftStart) return 'auto_rejected';
        return 'pending';
    }
    if (currentBid.status === 'accepted' || currentBid.status === 'selected') return 'selected';
    if (currentBid.status === 'rejected') return 'rejected';
    return 'not_participated';
}
