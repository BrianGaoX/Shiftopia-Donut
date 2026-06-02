import React from 'react';
import { XCircle, Ban, CheckCircle, Clock, ThumbsUp, Loader2 } from 'lucide-react';
import { SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { Drawer, DrawerContent, DrawerTitle } from '@/modules/core/ui/primitives/drawer';
import { Button } from '@/modules/core/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { calculateTimeRemaining, formatTimeRemaining } from '../views/OpenBidsView/utils';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { ZERO_COST_BREAKDOWN } from '@/modules/rosters/domain/projections/utils/cost/constants';
import { CostBreakdownTooltip } from '@/modules/rosters/ui/my-roster/ShiftDetailsDialog';
import type { ShiftOpportunity } from '../types';

interface Props {
    opp: ShiftOpportunity | null;
    onClose: () => void;
    onQuickBid: (opp: ShiftOpportunity) => void;
    onWithdraw: (bidId: string) => void;
    rawShift: any;
    isPlacingBid: boolean;
    placingBidId: any;
    isWithdrawing: boolean;
}

export const BidOpportunityDrawer: React.FC<Props> = ({
    opp, onClose, onQuickBid, onWithdraw, rawShift,
    isPlacingBid, placingBidId, isWithdrawing,
}) => {
    return (
        <Drawer open={opp !== null} onOpenChange={open => { if (!open) onClose(); }}>
            <DrawerContent className="max-h-[88dvh] flex flex-col rounded-t-[32px]" aria-describedby={undefined}>
                <DrawerTitle className="sr-only">
                    {opp ? `Shift detail — ${opp.role} on ${opp.date}` : 'Shift detail'}
                </DrawerTitle>
                <div className="flex-1 px-4 pb-8 pt-6">
                    {opp && (() => {
                        const { participationStatus, currentBid } = opp;
                        const shiftStart = opp.startAt
                            ? new Date(opp.startAt)
                            : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
                        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                        const tr = calculateTimeRemaining(biddingCloses.toISOString());
                        const isExpired = tr.isExpired;
                        const timerStr = formatTimeRemaining(tr);

                        const isTerminal = participationStatus === 'selected' ||
                                           participationStatus === 'dropped' ||
                                           participationStatus === 'rejected_offer' ||
                                           participationStatus === 'auto_rejected' ||
                                           participationStatus === 'expired';

                        const footerActions = (
                            <div className="flex flex-col gap-2 mt-4">
                                {participationStatus === 'dropped' && (
                                    <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-black uppercase tracking-wider">
                                        <XCircle className="h-5 w-5 shrink-0" /> You dropped this shift
                                    </div>
                                )}
                                {participationStatus === 'rejected_offer' && (
                                    <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-black uppercase tracking-wider">
                                        <XCircle className="h-5 w-5 shrink-0" /> You rejected this offer
                                    </div>
                                )}
                                {participationStatus === 'not_participated' && opp.isEligible && !isExpired && (
                                    <Button
                                        className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-base uppercase tracking-widest shadow-xl shadow-indigo-900/30 rounded-2xl transition-all active:scale-[0.98]"
                                        onClick={() => { onQuickBid(opp); onClose(); }}
                                        disabled={isPlacingBid}
                                    >
                                        {isPlacingBid && placingBidId === opp.id
                                            ? <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                                            : <ThumbsUp className="mr-3 h-5 w-5" />
                                        }
                                        {isPlacingBid && placingBidId === opp.id ? 'Placing…' : 'Bid Now'}
                                    </Button>
                                )}
                                {participationStatus === 'not_participated' && !opp.isEligible && (
                                    <div className="w-full flex flex-col items-center justify-center gap-1.5 py-4 px-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-bold">
                                        <div className="flex items-center gap-2 font-black uppercase tracking-wider">
                                            <Ban className="h-5 w-5 shrink-0" />
                                            Ineligible
                                        </div>
                                        <span className="text-[11px] opacity-70 text-center">{opp.ineligibilityReason ?? 'You do not meet the qualifications for this shift.'}</span>
                                    </div>
                                )}
                                {participationStatus === 'not_participated' && isExpired && (
                                    <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-muted/30 border border-border/30 text-muted-foreground text-sm font-black uppercase tracking-wider">
                                        <Ban className="h-5 w-5 shrink-0" /> Bidding Closed
                                    </div>
                                )}
                                {participationStatus === 'auto_rejected' && (
                                    <div className="w-full flex flex-col items-center justify-center gap-1.5 py-4 px-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-bold">
                                        <div className="flex items-center gap-2 font-black uppercase tracking-wider animate-pulse">
                                            <Ban className="h-5 w-5 shrink-0" strokeWidth={3} />
                                            Auto-Rejected
                                        </div>
                                        <span className="text-[11px] opacity-70 text-center">Bidding window closed without supervisor selection.</span>
                                    </div>
                                )}
                                {participationStatus === 'pending' && (
                                    <>
                                        <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-black uppercase tracking-wider">
                                            <Clock className="h-5 w-5 shrink-0" /> Awaiting Review
                                        </div>
                                        {!isExpired && currentBid && (
                                            <Button
                                                variant="outline"
                                                className="w-full h-12 border-border/50 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl"
                                                onClick={() => { onWithdraw(currentBid.id); onClose(); }}
                                                disabled={isWithdrawing}
                                            >
                                                <XCircle className="mr-2 h-4 w-4" /> Withdraw Bid
                                            </Button>
                                        )}
                                    </>
                                )}
                                {participationStatus === 'selected' && (
                                    <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-black uppercase tracking-wider">
                                        <CheckCircle className="h-5 w-5 shrink-0" /> Assigned to You
                                    </div>
                                )}
                                {participationStatus === 'rejected' && (
                                    <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-muted/30 border border-border/30 text-muted-foreground text-sm font-black uppercase tracking-wider">
                                        <Ban className="h-5 w-5 shrink-0" /> Not Selected
                                    </div>
                                )}
                            </div>
                        );

                        const costBreakdown = rawShift ? estimateDetailedCostFromShift(rawShift as any) : ZERO_COST_BREAKDOWN;
                        const isPast = shiftStart.getTime() < Date.now();

                        return (
                            <div className="space-y-6">
                                <div className="flex justify-center mb-2">
                                    <div className="w-12 h-1.5 rounded-full bg-border/40" />
                                </div>

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
                                    timerText={isTerminal ? undefined : (isExpired ? 'Bidding Closed' : `Closes in ${timerStr}`)}
                                    isExpired={isTerminal ? false : isExpired}
                                    isUrgent={opp.isUrgent}
                                    isPast={isPast}
                                    lifecycleStatus={opp.lifecycleStatus || 'Published'}
                                    groupVariant={
                                        opp.groupType === 'convention_centre' ? 'convention' :
                                        opp.groupType === 'exhibition_centre' ? 'exhibition' :
                                        opp.groupType === 'theatre' ? 'theatre' : 'default'
                                    }
                                    footerActions={footerActions}
                                    isFlat={false}
                                    className="shadow-2xl border-white/10"
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

                                <div className="px-2 pb-4">
                                    <Button
                                        variant="ghost"
                                        className="w-full h-12 rounded-2xl text-muted-foreground/50 font-black uppercase tracking-widest text-[10px] hover:bg-muted/50 transition-all"
                                        onClick={onClose}
                                    >
                                        Dismiss Detail
                                    </Button>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </DrawerContent>
        </Drawer>
    );
};
