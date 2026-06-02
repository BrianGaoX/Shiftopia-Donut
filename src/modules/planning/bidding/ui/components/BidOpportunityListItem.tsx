import React from 'react';
import { motion } from 'framer-motion';
import { Check, X, Ban, CheckCircle, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { cn } from '@/modules/core/lib/utils';
import { calculateTimeRemaining } from '../views/OpenBidsView/utils';
import { getDeptAccent } from '../utils/bid-dept-styles';
import type { ShiftOpportunity } from '../types';

interface Props {
    opp: ShiftOpportunity;
    isSelected: boolean;
    onToggleSelect: (id: any) => void;
    onOpen: (opp: ShiftOpportunity) => void;
    onQuickBid: (opp: ShiftOpportunity) => void;
    onWithdraw: (bidId: string) => void;
    isPlacingBid: boolean;
    placingBidId: any;
    isWithdrawing: boolean;
    isBulkModeActive?: boolean;
}

export const BidOpportunityListItem: React.FC<Props> = ({
    opp, isSelected, onToggleSelect, onOpen,
    onQuickBid, onWithdraw, isPlacingBid, placingBidId, isWithdrawing,
    isBulkModeActive = false,
}) => {
    const { participationStatus, currentBid } = opp;
    const shiftStart = opp.startAt
        ? new Date(opp.startAt)
        : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
    const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
    const tr = calculateTimeRemaining(biddingCloses.toISOString());
    const isExpired = tr.isExpired;
    const accent = getDeptAccent(opp.groupType, opp.department);
    const isClosed = participationStatus === 'expired' ||
                     participationStatus === 'auto_rejected' ||
                     (participationStatus === 'not_participated' && isExpired);

    const netH = Math.floor(opp.netLength / 60);
    const netM = Math.round(opp.netLength % 60);
    const netStr = netH > 0 ? `${netH}h${netM > 0 ? ` ${netM}m` : ''}` : `${netM}m`;

    const placingThis = isPlacingBid && placingBidId === opp.id;

    const action = (() => {
        if (participationStatus === 'not_participated' && opp.isEligible && !isExpired) {
            return (
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onQuickBid(opp); }}
                    disabled={isPlacingBid}
                    className="shrink-0 h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {placingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Bid'}
                </button>
            );
        }
        if (participationStatus === 'pending' && currentBid && !isExpired) {
            return (
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onWithdraw(currentBid.id); }}
                    disabled={isWithdrawing}
                    className="shrink-0 h-9 px-3 rounded-lg border border-border/60 hover:bg-rose-500/10 hover:border-rose-500/40 hover:text-rose-500 text-foreground/80 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-60"
                >
                    Withdraw
                </button>
            );
        }
        if (participationStatus === 'selected') {
            return <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />;
        }
        if (participationStatus === 'dropped' || participationStatus === 'rejected_offer') {
            return <X className="h-5 w-5 text-rose-500 shrink-0" />;
        }
        if (participationStatus === 'not_participated' && !opp.isEligible) {
            return <Ban className="h-5 w-5 text-rose-500/70 shrink-0" />;
        }
        if (participationStatus === 'auto_rejected') {
            return <Ban className="h-5 w-5 text-rose-500/70 shrink-0" strokeWidth={3} />;
        }
        if (participationStatus === 'expired' || (participationStatus === 'not_participated' && isExpired)) {
            return <Ban className="h-5 w-5 text-slate-400 shrink-0" />;
        }
        if (participationStatus === 'rejected') {
            return <Ban className="h-5 w-5 text-slate-400 shrink-0" />;
        }
        return <span className="min-w-[60px]" aria-hidden />;
    })();

    return (
        <motion.div
            key={opp.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn(
                'grid items-center gap-2 pr-3 border-b border-border/40 last:border-0 active:brightness-95 dark:active:brightness-110 transition-all cursor-pointer border-l-4',
                isBulkModeActive ? 'grid-cols-[44px_1fr_auto]' : 'grid-cols-[1fr_auto]',
                accent.bg,
                accent.stripe,
                isClosed && 'opacity-55',
                isSelected && 'ring-1 ring-inset ring-primary/50',
            )}
            onClick={() => {
                if (isBulkModeActive) {
                    onToggleSelect(opp.id);
                } else {
                    onOpen(opp);
                }
            }}
        >
            {/* Select — 44px grid column tap target. Only shown when bulk mode active. */}
            {isBulkModeActive && (
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onToggleSelect(opp.id); }}
                    aria-label={isSelected ? 'Deselect shift' : 'Select shift'}
                    aria-pressed={isSelected}
                    className="h-full flex items-center justify-center"
                >
                    <span
                        className={cn(
                            'h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors',
                            isSelected
                                ? 'bg-primary border-primary'
                                : 'border-border/70 bg-background/60'
                        )}
                    >
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
                    </span>
                </button>
            )}

            {/* Compact content */}
            <div className="min-w-0 py-3">
                <div className="text-[13px] font-semibold text-foreground truncate leading-snug">{opp.role}</div>
                <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 leading-none">
                    {opp.department}{opp.subGroup && opp.subGroup !== opp.department ? ` · ${opp.subGroup}` : ''}
                </p>
                <div className="flex items-center gap-1 mt-1">
                    <span className="text-[11px] text-muted-foreground/60 font-medium">{format(parseISO(opp.date), 'EEE d MMM')}</span>
                    <span className="text-muted-foreground/25">·</span>
                    <span className="text-[11px] text-muted-foreground/60 font-mono">{opp.startTime}–{opp.endTime}</span>
                    <span className="text-muted-foreground/25">·</span>
                    <span className="text-[11px] text-muted-foreground/50">{netStr}</span>
                </div>
            </div>

            {/* Action */}
            {action}
        </motion.div>
    );
};
