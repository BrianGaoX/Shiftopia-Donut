import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, XCircle, Loader2, ListChecks, Ban } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import type { ShiftSwap } from '../../api/swaps.api';

interface Props {
    selectedIds: string[];
    visibleSwaps: ShiftSwap[];   // currently rendered list in the active tab
    onSelectAllVisible: (ids: string[]) => void;
    onClear: () => void;
    onActionSelected: () => void;
    actionType: 'none' | 'withdraw' | 'cancel';
    isPending?: boolean;
    isBulkModeActive: boolean;
    onCloseBulkMode: () => void;
    inline?: boolean;
}

export const SwapSelectionToolbar: React.FC<Props> = ({
    selectedIds,
    visibleSwaps,
    onSelectAllVisible,
    onClear,
    onActionSelected,
    actionType,
    isPending = false,
    isBulkModeActive,
    onCloseBulkMode,
    inline = false,
}) => {
    const { isDark } = useTheme();
    const selectedCount = selectedIds.length;

    // Filter to visible swaps that can actually be selected/acted upon
    // (For available swaps, you can't bulk-withdraw or bulk-cancel, but you can select them. 
    // In my-offers we withdraw. In my-swaps we cancel.)
    const selectableSwaps = visibleSwaps;
    const allVisibleIds = selectableSwaps.map(s => s.id);
    const selectedSet = new Set(selectedIds);

    const allSelected =
        allVisibleIds.length > 0 &&
        allVisibleIds.every(id => selectedSet.has(id));

    return (
        <AnimatePresence>
            {isBulkModeActive && (
                <motion.div
                    key={inline ? "swap-sel-toolbar-inline" : "swap-sel-toolbar-fixed"}
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
                                    ? "bg-[#7b61ff] text-white shadow-sm"
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
                                ? "bg-[#7b61ff]/10 text-[#7b61ff] dark:text-indigo-400"
                                : isDark ? "bg-white/5 text-white/40" : "bg-white text-slate-400 border border-slate-200/50"
                        )}>
                            <span className="tabular-nums font-bold">{selectedCount}</span>
                            <span>Sel</span>
                        </div>

                        {/* 3. Transaction Actions (Stretches to fill space) */}
                        <div className="flex-1 flex gap-1 min-w-0">
                            {actionType === 'withdraw' && (
                                <button
                                    type="button"
                                    onClick={onActionSelected}
                                    disabled={isPending || selectedCount === 0}
                                    className={cn(
                                        "rounded-xl font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 flex-1 min-w-0 disabled:opacity-20 disabled:pointer-events-none active:scale-[0.98] shadow-sm border-none text-white",
                                        "h-10 text-[11px]", // Mobile
                                        "md:h-8 md:text-[10px]", // Desktop
                                        "bg-rose-500 hover:bg-rose-600"
                                    )}
                                >
                                    {isPending ? (
                                        <Loader2 className="h-3.5 w-3.5 md:h-3 md:w-3 animate-spin" />
                                    ) : (
                                        <XCircle className="h-4.5 w-4.5 md:h-3 md:w-3" />
                                    )}
                                    <span className="truncate">Withdraw Selected {selectedCount > 0 && `(${selectedCount})`}</span>
                                </button>
                            )}

                            {actionType === 'cancel' && (
                                <button
                                    type="button"
                                    onClick={onActionSelected}
                                    disabled={isPending || selectedCount === 0}
                                    className={cn(
                                        "rounded-xl font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 flex-1 min-w-0 disabled:opacity-20 disabled:pointer-events-none active:scale-[0.98] shadow-sm border-none text-white",
                                        "h-10 text-[11px]", // Mobile
                                        "md:h-8 md:text-[10px]", // Desktop
                                        "bg-rose-500 hover:bg-rose-600"
                                    )}
                                >
                                    {isPending ? (
                                        <Loader2 className="h-3.5 w-3.5 md:h-3 md:w-3 animate-spin" />
                                    ) : (
                                        <Ban className="h-4.5 w-4.5 md:h-3 md:w-3" />
                                    )}
                                    <span className="truncate">Cancel Selected {selectedCount > 0 && `(${selectedCount})`}</span>
                                </button>
                            )}

                            {actionType === 'none' && (
                                <div className={cn(
                                    "flex-1 flex items-center justify-center rounded-xl font-bold border border-dashed text-[10px] uppercase tracking-widest shrink-0 px-2 text-center",
                                    isDark ? "border-white/10 text-white/40" : "border-slate-300 text-slate-400"
                                )}>
                                    Select cards to view details
                                </div>
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
