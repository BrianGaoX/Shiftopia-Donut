import React, { useMemo } from 'react';
import { cn } from '@/modules/core/lib/utils';
import {
    getTimeRule,
    getLiveRuleBadges,
    type ShiftDotInput,
    type ShiftRuleBadge,
} from '../../domain/shift-ui';

export interface ShiftRuleHeaderProps {
    /** Minimal schedule + attendance fields needed to derive both rules. */
    shift: ShiftDotInput;
    /** `compact` (dense grids) tightens type/padding; `detailed` is roomier. */
    variant?: 'compact' | 'detailed';
    className?: string;
}

/** Render the arrival + departure halves of the Live Rules model side by side. */
const LiveBadges: React.FC<{ badges: { arrival: ShiftRuleBadge | null; departure: ShiftRuleBadge | null }; size: 'compact' | 'detailed' }> = ({ badges, size }) => {
    const { arrival, departure } = badges;
    if (!arrival && !departure) return null;
    const textCls = size === 'detailed'
        ? 'tabular-nums tracking-tight font-black font-mono text-[12px] uppercase'
        : 'font-black font-mono tracking-tight text-[10px] uppercase leading-none';
    return (
        <div className="flex items-center gap-1.5 justify-end flex-wrap">
            {arrival && <span className={textCls} style={{ color: arrival.color }}>{arrival.label}</span>}
            {arrival && departure && <span className="text-muted-foreground/30">·</span>}
            {departure && <span className={textCls} style={{ color: departure.color }}>{departure.label}</span>}
        </div>
    );
};

const ShiftRuleHeaderImpl: React.FC<ShiftRuleHeaderProps> = ({ shift, variant = 'compact', className }) => {
    const time = useMemo(() => getTimeRule(shift), [
        shift.start_at, shift.end_at, shift.start_time, shift.end_time, shift.shift_date,
    ]);
    const live = useMemo(() => getLiveRuleBadges(shift), [
        shift.start_at, shift.end_at, shift.start_time, shift.end_time, shift.shift_date,
        shift.actual_start, shift.actual_end, shift.attendance_status, shift.attendance_note,
        shift.adjusted_start, shift.adjusted_end,
    ]);

    const hasLive = !!(live.arrival || live.departure);
    if (!time && !hasLive) return null;

    const isDetailed = variant === 'detailed';

    if (isDetailed) {
        return (
            <div className={cn('flex flex-col w-full', className)}>
                <div className="flex items-center justify-between py-1.5 border-b border-foreground/[0.04] last:border-0">
                    <span className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
                        Time Rules
                    </span>
                    {time && (
                        <div
                            className="tabular-nums tracking-tight font-black font-mono text-[12px] text-right justify-end uppercase"
                            style={{ color: time.color }}
                        >
                            {time.label}
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-foreground/[0.04] last:border-0">
                    <span className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
                        Live Rules
                    </span>
                    <LiveBadges badges={live} size="detailed" />
                </div>
            </div>
        );
    }

    return (
        <div className={cn('flex flex-col gap-1.5 w-full', className)}>
            <div className="flex items-center justify-between gap-2 text-[9px] leading-none">
                <span className="font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
                    Time Rules
                </span>
                {time && (
                    <span
                        className="font-black font-mono tracking-tight text-[10px] uppercase text-right leading-none"
                        style={{ color: time.color }}
                    >
                        {time.label}
                    </span>
                )}
            </div>
            <div className="flex items-center justify-between gap-2 text-[9px] leading-none">
                <span className="font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
                    Live Rules
                </span>
                <LiveBadges badges={live} size="compact" />
            </div>
        </div>
    );
};

export const ShiftRuleHeader = React.memo(ShiftRuleHeaderImpl);

export default ShiftRuleHeader;
