import React from 'react';
import { Flame, Zap, Signal } from 'lucide-react';
import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';

export type BidPriority = 'normal' | 'urgent' | 'emergent';

export const PRIORITY_CONFIG: Record<BidPriority, {
    label: string;
    badgeCls: string;
    icon: React.ElementType;
    chipActiveCls: string;
    color: string;
}> = {
    emergent: {
        label: 'Emergent',
        badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
        icon: Flame,
        chipActiveCls: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
        color: 'text-rose-500',
    },
    urgent: {
        label: 'Urgent',
        badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        icon: Zap,
        chipActiveCls: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
        color: 'text-amber-500',
    },
    normal: {
        label: 'Normal',
        badgeCls: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
        icon: Signal,
        chipActiveCls: 'bg-muted/40 border-border text-foreground',
        color: 'text-slate-400',
    },
};

type ShiftLike = {
    date: string;
    startTime: string;
    startAt?: string | null;
};

export const getBidPriority = (
    shift: ShiftLike,
    now: Date = new Date()
): BidPriority => {
    const shiftStart = shift.startAt
        ? new Date(shift.startAt)
        : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);

    if (isNaN(shiftStart.getTime())) return 'normal';
    const hoursUntil = (shiftStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil <= 24) return 'urgent';
    return 'normal';
};
