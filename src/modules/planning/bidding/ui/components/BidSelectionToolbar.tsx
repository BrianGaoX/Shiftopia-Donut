import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ThumbsUp, XCircle, Loader2, ListChecks } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import type { ShiftOpportunity } from '../types';

interface Props {
    selectedIds: any[];
    visibleOpportunities: ShiftOpportunity[];   // currently rendered list (date/priority filtered)
    onSelectAllVisible: (ids: any[]) => void;
    onClear: () => void;
    onBidSelected: (ids: any[]) => void;
    onWithdrawSelected: (bidIds: string[]) => void;
    isBidding: boolean;
    isWithdrawing: boolean;
    isBulkModeActive: boolean;
    onCloseBulkMode: () => void;
    inline?: boolean;
}

export const BidSelectionToolbar: React.FC<Props> = ({
    selectedIds, visibleOpportunities,
    onSelectAllVisible, onClear,
    onBidSelected, onWithdrawSelected,
    isBidding, isWithdrawing,
    isBulkModeActive, onCloseBulkMode,
    inline = false,
}) => {
    const { isDark } = useTheme();
    const selectedCount = selectedIds.length;
    const visible = visibleOpportunities;
    const selectedSet = new Set(selectedIds.map(String));
    const selectedOpps = visible.filter(o => selectedSet.has(String(o.id)));

    // Bidable shifts are selected shifts that are not_participated and eligible
    const bidableIds = selectedOpps
        .filter(o => o.participationStatus === 'not_participated' && o.isEligible)
        .map(o => o.id);

    // Withdrawable bids are selected shifts that are pending and have an active bid record
    const withdrawableBidIds = selectedOpps
        .filter(o => o.participationStatus === 'pending' && o.currentBid)
        .map(o => o.currentBid!.id as string);

    const allVisibleIds = visible.map(o => o.id);

    const allSelected =
        allVisibleIds.length > 0 &&
        allVisibleIds.every(id => selectedSet.has(String(id)));

    return (
        <AnimatePresence>
            {isBulkModeActive && (
                <motion.div
                    key={inline ? "sel-toolbar-inline" : "sel-toolbar-fixed"}
                    initial={inline ? { opacity: 0, height: 0, marginTop: 0 } : { opacity: 0, y: 40, scale: 0.95 }}
                    animate={inline ? { opacity: 1, height: 'auto', marginTop: 4 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={inline ? { opacity: 0, height: 0, marginTop: 0 } : { opacity: 0, y: 40, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                    className={cn(
                        inline 
                            ? 'w-full overflow-hidden'
                            : cn(
                                'fixed z-40',
                                // Mobile: full-width, above bottom navbar
                                'inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]',
                                // Desktop: centered near bottom
                                'md:inset-x-0 md:bottom-6 md:flex md:justify-center md:pointer-events-none'
                              )
                    )}
                >
                    {/* Inner Container: Configured inline or floating */}
                    <div className={cn(
                        "flex flex-row items-center justify-between gap-1.5 w-full transition-all duration-300 p-1.5 rounded-2xl border shadow-sm",
                        isDark
                            ? "bg-[#1c2333]/95 border-white/5 text-white"
                            : "bg-slate-100/95 border-slate-200/60 text-slate-900 shadow-sm"
                    )}>
                        
                        {/* 1. Toggle Selection (All / None) */}
                        <button
                            type="button"
                            onClick={() => {
                                if (allSelected) {
                                    onClear();
                                } else {
                                    onSelectAllVisible(allVisibleIds);
                                }
                            }}
                            className={cn(
                                "rounded-xl font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 active:scale-95 shrink-0",
                                "h-10 px-3.5 text-[11px]", // Mobile
                                "md:h-8 md:px-2.5 md:text-[10px]", // Desktop
                                allSelected
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : isDark 
                                        ? "bg-white/5 text-white/70 hover:bg-white/10" 
                                        : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200/50"
                            )}
                        >
                            <ListChecks className="h-4.5 w-4.5 md:h-3.5 md:w-3.5" />
                            <span>{allSelected ? "None" : "All"}</span>
                        </button>

                        {/* 2. Count Badge */}
                        <div className={cn(
                            "flex items-center justify-center gap-1 rounded-xl font-black tracking-wider uppercase shrink-0",
                            "h-10 px-2.5 text-[10px]", // Mobile
                            "md:h-8 md:px-2 md:text-[9px]", // Desktop
                            selectedCount > 0
                                ? "bg-indigo-500/10 text-indigo-500"
                                : isDark ? "bg-white/5 text-white/40" : "bg-white text-slate-400 border border-slate-200/50"
                        )}>
                            <span className="tabular-nums font-bold">{selectedCount}</span>
                            <span>Sel</span>
                        </div>

                        {/* 3. Transaction Actions (Stretches to fill space) */}
                        <div className="flex-1 flex gap-1 min-w-0">
                            {/* Bid Selected */}
                            {(bidableIds.length > 0 || selectedCount === 0 || withdrawableBidIds.length === 0) && (
                                <button
                                    type="button"
                                    onClick={() => onBidSelected(bidableIds)}
                                    disabled={isBidding || bidableIds.length === 0}
                                    className={cn(
                                        "rounded-xl font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 flex-1 min-w-0 disabled:opacity-20 disabled:pointer-events-none active:scale-95 shadow-sm border-none text-white",
                                        "h-10 text-[11px]", // Mobile
                                        "md:h-8 md:text-[10px]", // Desktop
                                        "bg-indigo-600 hover:bg-indigo-500"
                                    )}
                                >
                                    {isBidding ? (
                                        <Loader2 className="h-3.5 w-3.5 md:h-3 md:w-3 animate-spin" />
                                    ) : (
                                        <ThumbsUp className="h-4.5 w-4.5 md:h-3 md:w-3" />
                                    )}
                                    <span className="truncate">Bid {bidableIds.length > 0 && `(${bidableIds.length})`}</span>
                                </button>
                            )}

                            {/* Withdraw Selected */}
                            {withdrawableBidIds.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => onWithdrawSelected(withdrawableBidIds)}
                                    disabled={isWithdrawing}
                                    className={cn(
                                        "rounded-xl font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 flex-1 min-w-0 disabled:opacity-20 disabled:pointer-events-none active:scale-95 shadow-sm border-none text-white",
                                        "h-10 text-[11px]", // Mobile
                                        "md:h-8 md:text-[10px]", // Desktop
                                        "bg-rose-500 hover:bg-rose-600"
                                    )}
                                >
                                    {isWithdrawing ? (
                                        <Loader2 className="h-3.5 w-3.5 md:h-3 md:w-3 animate-spin" />
                                    ) : (
                                        <XCircle className="h-4.5 w-4.5 md:h-3 md:w-3" />
                                    )}
                                    <span className="truncate">Withdraw {`(${withdrawableBidIds.length})`}</span>
                                </button>
                            )}
                        </div>

                        {/* 4. Close (Exit) button */}
                        <button
                            type="button"
                            onClick={onCloseBulkMode}
                            className={cn(
                                "rounded-xl flex items-center justify-center transition-all active:scale-95 shrink-0",
                                "h-10 w-10", // Mobile
                                "md:h-8 md:w-8", // Desktop
                                isDark 
                                    ? "bg-white/5 text-white/40 hover:text-white" 
                                    : "bg-white text-slate-400 hover:text-slate-600 border border-slate-200/50"
                            )}
                            title="Exit Bulk Mode"
                        >
                            <X className="h-4.5 w-4.5 md:h-4 md:w-4" strokeWidth={2.5} />
                        </button>

                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
