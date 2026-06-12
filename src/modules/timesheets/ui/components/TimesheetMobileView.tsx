import React, { useState, useMemo } from 'react';
import {
    CheckCircle,
    XCircle,
    CheckSquare,
    X,
    ChevronRight,
    AlertTriangle,
    Clock,
    Search,
    ChevronLeft,
    Download,
    RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addDays, subDays } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { useToast } from '@/modules/core/hooks/use-toast';
import { TimesheetMobileCard } from './TimesheetMobileCard';
import { TimesheetFilterDrawer } from './TimesheetFilterDrawer';
import type { TimesheetRow } from '../../model/timesheet.types';
import type { ActiveFilters } from './TimesheetFilterDrawer';
import { applyTimesheetFilters } from './TimesheetFilterDrawer';
import { getLiveRule } from '@/modules/rosters/domain/shift-ui';

// ── Props ─────────────────────────────────────────────────────────────────────

interface TimesheetMobileViewProps {
    entries: TimesheetRow[];
    selectedDate: Date;
    readOnly?: boolean;
    searchQuery?: string;
    setSearchQuery?: (query: string) => void;
    /** Filter state owned by TimesheetTable — shared with desktop view */
    appliedFilters: ActiveFilters;
    onApplyFilters: (f: ActiveFilters) => void;
    activeFilterCount: number;
    onSaveEntry?: (id: string, updates: Partial<TimesheetRow>) => void;
    onBulkAction?: (ids: string[], action: 'approve' | 'reject') => void;
    onMarkNoShow?: (id: string) => void;
    onDateChange?: (date: Date) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    onExportPDF?: () => void;
    onExportSpreadsheet?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPending(entry: TimesheetRow): boolean {
    const ts = (entry.timesheetStatus || '').toLowerCase();
    return ts === 'submitted' || ts === 'draft';
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TimesheetMobileView: React.FC<TimesheetMobileViewProps> = ({
    entries,
    selectedDate,
    readOnly = false,
    searchQuery = '',
    setSearchQuery,
    appliedFilters,
    onApplyFilters,
    activeFilterCount,
    onSaveEntry,
    onBulkAction,
    onMarkNoShow,
    onDateChange,
    onRefresh,
    isRefreshing,
    onExportPDF,
}) => {
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const { toast } = useToast();

    // Apply shared filter logic (same function used by desktop table)
    const displayEntries = useMemo(
        () => applyTimesheetFilters(entries, appliedFilters, searchQuery),
        [entries, appliedFilters, searchQuery],
    );

    // ── Selection ──────────────────────────────────────────────────────────────
    const handleToggleSelect = (id: string) => {
        const entry = entries.find(e => String(e.id) === id);
        if (!entry || !isPending(entry)) return;
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleClearSelection = () => setSelectedIds([]);

    const handleToggleSelectMode = () => {
        setIsSelectMode(v => {
            if (v) setSelectedIds([]);
            return !v;
        });
    };

    const handleBulkApprove = () => {
        if (selectedIds.length === 0) return;
        const validIds = entries
            .filter(e => selectedIds.includes(String(e.id)) && e.liveStatus !== 'InProgress')
            .map(e => String(e.id));
        const ongoingCount = selectedIds.length - validIds.length;
        if (validIds.length > 0) {
            onBulkAction?.(validIds, 'approve');
            toast({
                title: 'Bulk Approval',
                description: `${validIds.length} approved.${ongoingCount > 0 ? ` (${ongoingCount} skipped — ongoing)` : ''}`,
            });
        } else {
            toast({ title: 'Action Blocked', description: 'Cannot approve ongoing shifts until they finish.', variant: 'destructive' });
        }
        setSelectedIds([]);
        setIsSelectMode(false);
    };

    const handleBulkReject = () => {
        if (selectedIds.length === 0) return;
        const validIds = entries
            .filter(e => selectedIds.includes(String(e.id)) && e.liveStatus !== 'InProgress')
            .map(e => String(e.id));
        const ongoingCount = selectedIds.length - validIds.length;
        if (validIds.length > 0) {
            onBulkAction?.(validIds, 'reject');
            toast({
                title: 'Bulk Rejection',
                description: `${validIds.length} rejected.${ongoingCount > 0 ? ` (${ongoingCount} skipped — ongoing)` : ''}`,
            });
        } else {
            toast({ title: 'Action Blocked', description: 'Cannot reject ongoing shifts until they finish.', variant: 'destructive' });
        }
        setSelectedIds([]);
        setIsSelectMode(false);
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="relative pb-28">
            {/* Select Mode Background Tint */}
            <AnimatePresence>
                {isSelectMode && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 pointer-events-none z-0 bg-primary/[0.015] dark:bg-primary/[0.03]"
                    />
                )}
            </AnimatePresence>

            {/* ── Sticky Header ── */}
            <div className="sticky top-0 z-30 -mx-4 px-4 bg-background/95 backdrop-blur-md pt-3 pb-2 border-b border-border/10">
                <div className="flex flex-col gap-3">

                    {/* Search + Filter drawer trigger */}
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40 pointer-events-none" />
                            <Input
                                placeholder="Search employee, role, or ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery?.(e.target.value)}
                                className="pl-10 bg-background border-border h-11 rounded-xl w-full font-bold text-[14px] placeholder:text-muted-foreground/70"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery?.('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>

                        {/* Bottom-sheet filter drawer */}
                        <TimesheetFilterDrawer
                            entries={entries}
                            appliedFilters={appliedFilters}
                            onApply={onApplyFilters}
                            activeCount={activeFilterCount}
                        />
                    </div>

                    {/* Date Navigator + Action Icons */}
                    <div className="flex items-center justify-between gap-1 h-10">
                        <div className="flex items-center bg-muted/40 rounded-full border border-border/40 p-0.5 h-full">
                            <button
                                onClick={() => onDateChange?.(subDays(selectedDate, 1))}
                                className="h-8 w-8 flex items-center justify-center text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 rounded-full transition-colors active:scale-90"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="px-2 font-black text-[12px] text-foreground flex items-center justify-center gap-1.5 min-w-[105px]">
                                <span className={cn(
                                    'w-1.5 h-1.5 rounded-full shrink-0',
                                    format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                                        ? 'bg-primary'
                                        : 'bg-transparent',
                                )} />
                                {format(selectedDate, 'EEE, MMM dd')}
                            </div>
                            <button
                                onClick={() => onDateChange?.(addDays(selectedDate, 1))}
                                className="h-8 w-8 flex items-center justify-center text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 rounded-full transition-colors active:scale-90"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex items-center gap-1 ml-auto">
                            <button
                                onClick={onExportPDF}
                                aria-label="Export"
                                className="h-10 w-10 flex items-center justify-center rounded-full bg-muted/50 border border-border/40 text-muted-foreground/70 hover:text-foreground hover:bg-muted/70 transition-all active:scale-90"
                            >
                                <Download className="h-4 w-4" />
                            </button>
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                aria-label="Refresh"
                                className="h-10 w-10 flex items-center justify-center rounded-full bg-muted/50 border border-border/40 text-primary/80 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-50 active:scale-90"
                            >
                                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                            </button>
                            {!readOnly && (
                                <button
                                    onClick={handleToggleSelectMode}
                                    aria-label="Toggle Bulk Select"
                                    className={cn(
                                        'h-10 w-10 flex items-center justify-center rounded-full border transition-all active:scale-90',
                                        isSelectMode
                                            ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30 scale-105'
                                            : 'bg-muted/50 text-muted-foreground/70 border-border/40 hover:bg-muted/70',
                                    )}
                                >
                                    <CheckSquare className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Attendance flags ── */}
            <div className="mt-4">
                {(() => {
                    const lateCount    = displayEntries.filter(e => e.attendanceStatus === 'late').length;

                    // Use getLiveRule to detect overridden No-Shows — they'll have *-suffixed labels
                    let noShowCount = 0;
                    const overrideCounts: Record<string, number> = {};
                    displayEntries.forEach(e => {
                        if (e.attendanceStatus === 'no_show') {
                            const rule = getLiveRule({
                                shift_date: String(e.date),
                                start_time: e.scheduledStart,
                                end_time: e.scheduledEnd,
                                actual_start: e.clockIn,
                                actual_end: e.clockOut,
                                adjusted_start: e.adjustedStart,
                                adjusted_end: e.adjustedEnd,
                                adjusted_is_manual: e.isAdjustedManual,
                                attendance_status: e.attendanceStatus,
                                attendance_note: e.attendanceNote,
                            });
                            const label = rule?.label || 'No Show';
                            if (label.endsWith('*')) {
                                overrideCounts[label] = (overrideCounts[label] || 0) + 1;
                            } else {
                                noShowCount++;
                            }
                        }
                    });

                    const missingCount = displayEntries.filter(e => {
                        const active = e.liveStatus === 'InProgress' || e.liveStatus === 'Completed';
                        const noIn   = !e.clockIn || e.clockIn === '-';
                        return active && noIn && e.attendanceStatus !== 'no_show';
                    }).length;

                    const overrideLabels = Object.entries(overrideCounts);
                    if (!lateCount && !noShowCount && !missingCount && overrideLabels.length === 0) return null;
                    return (
                        <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-amber-500/[0.04] border border-amber-500/15 flex-wrap">
                            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mr-1">Flags</span>
                            {lateCount > 0 && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/10">
                                    {lateCount} Late
                                </span>
                            )}
                            {noShowCount > 0 && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10">
                                    {noShowCount} No-Show
                                </span>
                            )}
                            {overrideLabels.map(([label, count]) => (
                                <span key={label} className="text-[9px] font-black px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/10">
                                    {count} {label}
                                </span>
                            ))}
                            {missingCount > 0 && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10">
                                    {missingCount} Missing Clock-In
                                </span>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* ── Card list ── */}
            <AnimatePresence mode="popLayout">
                {displayEntries.length === 0 ? (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.02 }}
                        className="flex flex-col items-center justify-center py-24 px-6 text-center mx-2"
                    >
                        <div className="relative mb-8">
                            <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
                            <div className="relative h-24 w-24 rounded-[2.5rem] bg-gradient-to-br from-background to-muted/30 border border-border/40 shadow-xl flex items-center justify-center">
                                <Clock className="h-11 w-11 text-primary/30" />
                            </div>
                        </div>
                        <h3 className="font-black text-2xl text-foreground mb-3">No entries found</h3>
                        <p className="text-[14px] text-muted-foreground/80 max-w-[260px] leading-relaxed mx-auto font-medium">
                            {activeFilterCount > 0
                                ? 'No entries match the current filters.'
                                : 'Try adjusting your search query to see more staff.'}
                        </p>
                        {activeFilterCount > 0 && (
                            <div className="mt-10">
                                <Button
                                    onClick={() => onApplyFilters({ statuses: [], groupTypes: [], subGroups: [], roles: [] })}
                                    className="rounded-full px-10 h-14 font-black text-xs uppercase tracking-widest bg-primary shadow-[0_8px_25px_rgba(var(--primary-rgb),0.25)] transition-all active:scale-95"
                                >
                                    Clear All Filters
                                </Button>
                            </div>
                        )}
                    </motion.div>
                ) : (
                    <div className="space-y-3">
                        {displayEntries.map(entry => (
                            <TimesheetMobileCard
                                key={entry.id}
                                entry={entry}
                                isSelected={selectedIds.includes(String(entry.id))}
                                isSelectMode={isSelectMode}
                                onToggleSelect={() => handleToggleSelect(String(entry.id))}
                                onSave={onSaveEntry}
                                onMarkNoShow={onMarkNoShow}
                                readOnly={readOnly}
                            />
                        ))}
                    </div>
                )}
            </AnimatePresence>

            {/* ── Floating bulk action bar ── */}
            <AnimatePresence>
                {isSelectMode && selectedIds.length > 0 && (
                    <div className="fixed bottom-32 left-0 right-0 z-50 px-5 pointer-events-none">
                        <motion.div
                            key="bulk-bar"
                            initial={{ y: 100, opacity: 0, scale: 0.9 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={{ y: 100, opacity: 0, scale: 0.9 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            className="pointer-events-auto rounded-[2.5rem] border border-white/20 dark:border-white/10 bg-background/80 backdrop-blur-3xl shadow-[0_25px_60px_rgba(0,0,0,0.25)] dark:shadow-none p-5"
                        >
                            <div className="flex items-center justify-between mb-4 px-2">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                    <span className="text-sm font-black text-foreground tracking-tight">
                                        <span className="text-primary">{selectedIds.length}</span>
                                        {' '}Actionable Selection
                                    </span>
                                </div>
                                <button
                                    onClick={handleClearSelection}
                                    className="px-3 py-1.5 rounded-full bg-muted/50 text-[10px] font-black text-muted-foreground uppercase tracking-wider hover:text-foreground hover:bg-muted transition-all active:scale-90"
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleBulkApprove}
                                    className="flex-1 flex items-center justify-center gap-2.5 h-14 rounded-2xl bg-emerald-500 shadow-[0_8px_20px_rgba(16,185,129,0.3)] hover:bg-emerald-600 text-white font-black text-[13px] uppercase tracking-widest transition-all active:scale-[0.96]"
                                >
                                    <CheckCircle className="h-4 w-4" />
                                    Approve
                                </button>
                                <button
                                    onClick={handleBulkReject}
                                    className="flex-1 flex items-center justify-center gap-2.5 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 font-black text-[13px] uppercase tracking-widest hover:bg-rose-500/15 transition-all active:scale-[0.96]"
                                >
                                    <XCircle className="h-4 w-4" />
                                    Reject
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
