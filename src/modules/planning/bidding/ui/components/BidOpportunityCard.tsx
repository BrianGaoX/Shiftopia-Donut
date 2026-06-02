import React from 'react';
import { motion } from 'framer-motion';
import { XCircle, Ban, CheckCircle, Clock, ThumbsUp, Loader2 } from 'lucide-react';
import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { calculateTimeRemaining, formatTimeRemaining } from '../views/OpenBidsView/utils';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { ZERO_COST_BREAKDOWN } from '@/modules/rosters/domain/projections/utils/cost/constants';
import { CostBreakdownTooltip } from '@/modules/rosters/ui/my-roster/ShiftDetailsDialog';
import type { ShiftOpportunity } from '../types';

const listItemSpring = {
    layout: true as const,
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } },
    exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }
};

interface Props {
    opp: ShiftOpportunity;
    rawShift: any;
    isSelected: boolean;
    onToggleSelect: (id: any) => void;
    onQuickBid: (opp: ShiftOpportunity) => void;
    onWithdraw: (bidId: string) => void;
    isPlacingBid: boolean;
    placingBidId: any;
    isWithdrawing: boolean;
    isBulkModeActive?: boolean;
}

export const BidOpportunityCard: React.FC<Props> = ({
    opp, rawShift, isSelected, onToggleSelect, onQuickBid, onWithdraw,
    isPlacingBid, placingBidId, isWithdrawing, isBulkModeActive = false,
}) => {
    const { participationStatus, currentBid } = opp;

    const shiftStart = opp.startAt
        ? new Date(opp.startAt)
        : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
    const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
    const tr = calculateTimeRemaining(biddingCloses.toISOString());

    const isTerminal = participationStatus === 'selected' ||
                       participationStatus === 'dropped' ||
                       participationStatus === 'rejected_offer' ||
                       participationStatus === 'auto_rejected' ||
                       participationStatus === 'expired';
    const timerDisplay = isTerminal ? null
        : tr.isExpired ? 'Bidding Closed'
        : `Closes in ${formatTimeRemaining(tr)}`;

    const canSelect = (participationStatus === 'not_participated' && opp.isEligible) ||
                      (participationStatus === 'pending' && !!currentBid);

    const footerActions = (
        <div className="flex flex-col gap-2">

            {/* ── STATUS INDICATORS ── */}
            {participationStatus === 'dropped' && (
                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                    <XCircle className="h-4 w-4 shrink-0" /> You dropped this shift
                </div>
            )}

            {participationStatus === 'rejected_offer' && (
                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                    <XCircle className="h-4 w-4 shrink-0" /> You rejected this offer
                </div>
            )}

            {participationStatus === 'not_participated' && (
                opp.isEligible ? (
                    <Button
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 font-bold h-10 transition-all active:scale-[0.98]"
                        onClick={() => onQuickBid(opp)}
                        disabled={isPlacingBid}
                    >
                        {isPlacingBid && placingBidId === opp.id ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                            <ThumbsUp className="mr-1.5 h-4 w-4" />
                        )}
                        {isPlacingBid && placingBidId === opp.id ? 'Placing…' : 'Bid Now'}
                    </Button>
                ) : (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="w-full">
                                    <Button
                                        disabled
                                        className="w-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 cursor-not-allowed opacity-90 pointer-events-none h-10"
                                    >
                                        <Ban className="mr-1.5 h-4 w-4" /> Ineligible
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                                {opp.ineligibilityReason ?? 'You are not eligible for this shift'}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )
            )}

            {participationStatus === 'pending' && (
                <>
                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                        <Clock className="h-4 w-4 shrink-0" /> Awaiting Manager Review
                    </div>
                    {!tr.isExpired && currentBid && (
                        <Button
                            variant="outline"
                            className="w-full border-slate-200 dark:border-white/10 hover:bg-red-500/10 hover:text-red-400 h-10"
                            onClick={() => onWithdraw(currentBid.id)}
                            disabled={isWithdrawing}
                        >
                            <XCircle className="mr-1.5 h-4 w-4" /> Withdraw
                        </Button>
                    )}
                </>
            )}

            {participationStatus === 'selected' && (
                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                    <CheckCircle className="h-4 w-4 shrink-0" /> Bid Selected — Assigned to You
                </div>
            )}

            {participationStatus === 'rejected' && (
                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 text-sm">
                    <Ban className="h-4 w-4 shrink-0" /> Not Selected
                </div>
            )}

            {participationStatus === 'expired' && (
                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm">
                    <Ban className="h-4 w-4 shrink-0" /> Bidding Closed
                </div>
            )}

            {participationStatus === 'auto_rejected' && (
                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium animate-pulse">
                    <Ban className="h-4 w-4 shrink-0" strokeWidth={3} /> Auto-Rejected — Bidding window elapsed
                </div>
            )}
        </div>
    );

    const topContent = isBulkModeActive ? (
        <div className="flex items-center gap-2">
            <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(opp.id)}
                disabled={!canSelect}
                className="h-4 w-4 rounded border-border/50 text-primary focus:ring-primary/30 accent-primary"
            />
            <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">Select</span>
        </div>
    ) : undefined;

    const costBreakdown = rawShift ? estimateDetailedCostFromShift(rawShift as any) : ZERO_COST_BREAKDOWN;
    const isPast = shiftStart.getTime() < Date.now();

    return (
        <motion.div key={opp.id} {...listItemSpring} whileHover={{ y: -2, transition: { duration: 0.15 } }} whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}>
            <SharedShiftCard
                variant="timecard"
                organization={opp.organization}
                department={opp.department}
                subGroup={opp.subGroup}
                role={opp.role}
                shiftDate={opp.date}
                startTime={opp.startTime}
                endTime={opp.endTime}
                netLength={opp.netLength}
                paidBreak={opp.paidBreak}
                unpaidBreak={opp.unpaidBreak}
                timerText={timerDisplay}
                isExpired={isTerminal ? false : tr.isExpired}
                isUrgent={opp.isUrgent}
                isPast={isPast}
                lifecycleStatus={opp.lifecycleStatus || 'Published'}
                groupVariant={
                    opp.groupType === 'convention_centre' ? 'convention' :
                    opp.groupType === 'exhibition_centre' ? 'exhibition' :
                    opp.groupType === 'theatre' ? 'theatre' : 'default'
                }
                footerActions={footerActions}
                topContent={topContent}
                shiftData={rawShift}
                estimatedPay={(
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-end gap-1.5 cursor-help group/pay">
                        <span className="text-[14px] font-black text-emerald-500 tabular-nums">
                          ${(costBreakdown.totalCost || 0).toFixed(2)}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="bg-slate-900 text-white border-white/10 shadow-2xl" side="top">
                      <CostBreakdownTooltip breakdown={costBreakdown} />
                    </TooltipContent>
                  </Tooltip>
                )}
            />
        </motion.div>
    );
};
