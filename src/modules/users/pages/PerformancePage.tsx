import React, { useState, useMemo } from 'react';
import { BarChart3, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { cn } from '@/modules/core/lib/utils';
import {
    useQuarterlyReport,
    getCurrentQuarter,
    getReportCellStatus,
    refreshAllPerformanceMetrics,
    type QuarterlyReportRow,
} from '@/modules/users/hooks/usePerformanceMetrics';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Button } from '@/modules/core/ui/primitives/button';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { PerformanceFunctionBar } from '../ui/components/PerformanceFunctionBar';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { Info } from 'lucide-react';

/* ═══════════════════ TYPES ═══════════════════ */
type SortKey = keyof QuarterlyReportRow;
type SortDir = 'asc' | 'desc';

/* ═══════════════════ COLOR HELPERS ═══════════════════ */
const statusTextColor = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    critical: 'text-red-600 dark:text-red-400',
} as const;

const statusCellBg = {
    good: 'bg-emerald-500/5',
    warn: 'bg-amber-500/5',
    critical: 'bg-red-500/5',
} as const;

/* ═══════════════════ COLUMN DEFINITIONS ═══════════════════ */
interface ColumnDef {
    key: SortKey;
    label: string;
    group: string;
    isRate?: boolean;
    thresholdKey?: string;
}


/* ═══════════════════ QUARTER OPTIONS ═══════════════════ */
const buildQuarterOptions = () => {
    const opts: { year: number; quarter: number; label: string }[] = [];
    const { year, quarter } = getCurrentQuarter();
    for (let i = 0; i < 5; i++) {
        let q = quarter - i;
        let y = year;
        while (q <= 0) { q += 4; y -= 1; }
        opts.push({ year: y, quarter: q, label: `Q${q} ${y}` });
    }
    return opts;
};

/* ═══════════════════ MAIN COMPONENT ═══════════════════ */
export default function PerformancePage() {
    const queryClient = useQueryClient();
    const quarterOptions = useMemo(buildQuarterOptions, []);
    const defaultQ = quarterOptions[0];

    const [selectedYear, setSelectedYear] = useState(defaultQ.year);
    const [selectedQuarter, setSelectedQuarter] = useState(defaultQ.quarter);
    const [sortKey, setSortKey] = useState<SortKey>('employee_name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { isDark } = useTheme();
    const { t } = useTranslation();

    const columns: ColumnDef[] = [
        // Identity
        { key: 'employee_name', label: t('nav.users'), group: 'Identity' },
        // Offer Behaviour
        { key: 'total_offers', label: 'Total Offers', group: 'Offer Behaviour' },
        { key: 'acceptance_rate', label: 'Accept %', group: 'Offer Behaviour', isRate: true, thresholdKey: 'acceptance_rate' },
        { key: 'drop_rate', label: 'Drop Rate', group: 'Offer Behaviour', isRate: true },
        { key: 'rejection_rate', label: 'Reject %', group: 'Offer Behaviour', isRate: true },
        { key: 'ignorance_rate', label: 'Ignored %', group: 'Offer Behaviour', isRate: true },
        // Assignment
        { key: 'assigned', label: t('nav.rostering'), group: 'Assignment' },
        { key: 'emergency_assigned', label: 'Emergency', group: 'Assignment' },
        // Reliability
        { key: 'cancel_rate', label: 'Cancel %', group: 'Reliability', isRate: true, thresholdKey: 'cancel_rate' },
        { key: 'late_cancel_rate', label: 'Late Cancel %', group: 'Reliability', isRate: true, thresholdKey: 'late_cancel_rate' },
        { key: 'swap_rate', label: 'Swap %', group: 'Reliability', isRate: true },
        // Attendance
        { key: 'late_clock_in_rate', label: 'Late In %', group: 'Attendance', isRate: true },
        { key: 'early_clock_out_rate', label: 'Early Out %', group: 'Attendance', isRate: true },
        { key: 'no_show_rate', label: 'No-Show %', group: 'Attendance', isRate: true, thresholdKey: 'no_show_rate' },
        // Bidding
        { key: 'total_bids', label: 'Bids', group: 'Bidding' },
        { key: 'bids_accepted', label: 'Success', group: 'Bidding' },
        { key: 'bid_success_rate', label: 'Success %', group: 'Bidding', isRate: true, thresholdKey: 'bid_success_rate' },
        // Overall
        { key: 'reliability_score', label: 'Overall Score', group: 'Overall', isRate: true, thresholdKey: 'reliability_score' },
    ];

    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { data: rows = [], isLoading } = useQuarterlyReport(selectedYear, selectedQuarter, scope);

    /* ─── Sorting ─── */
    const sortedRows = useMemo(() => {
        const copy = rows.map(r => {
            // Calculate a weighted overall score on the fly
            // Weights: Reliability (35%), Acceptance (25%), Punctuality (20%), Bid Success (20%)
            const punctuality = Math.max(0, 100 - (r.late_clock_in_rate + r.early_clock_out_rate));
            const overall = 
                (r.reliability_score * 0.35) + 
                (r.acceptance_rate * 0.25) + 
                (punctuality * 0.20) + 
                (r.bid_success_rate * 0.20);
            
            return { ...r, reliability_score: overall }; // Overwrite for display/sort
        });
        
        copy.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'string' && typeof bv === 'string') {
                return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
            }
            const an = Number(av) || 0;
            const bn = Number(bv) || 0;
            return sortDir === 'asc' ? an - bn : bn - an;
        });
        return copy;
    }, [rows, sortKey, sortDir]);

    /* ─── Summary Row ─── */
    const summary = useMemo(() => {
        if (rows.length === 0) return null;
        const avg = (fn: (r: QuarterlyReportRow) => number) =>
            rows.reduce((s, r) => s + fn(r), 0) / rows.length;
        
        const avg_reliability = avg(r => r.reliability_score);
        const avg_acceptance = avg(r => r.acceptance_rate);
        const avg_punctuality = avg(r => Math.max(0, 100 - (r.late_clock_in_rate + r.early_clock_out_rate)));
        const avg_bid_success = avg(r => r.bid_success_rate);

        const weighted_overall = 
            (avg_reliability * 0.35) + 
            (avg_acceptance * 0.25) + 
            (avg_punctuality * 0.20) + 
            (avg_bid_success * 0.20);

        return {
            acceptance_rate: avg_acceptance,
            drop_rate: avg(r => r.drop_rate),
            cancel_rate: avg(r => r.cancel_rate),
            no_show_rate: avg(r => r.no_show_rate),
            reliability_score: weighted_overall,
        };
    }, [rows]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const handleQuarterChange = (val: string) => {
        const opt = quarterOptions.find(o => o.label === val);
        if (opt) { setSelectedYear(opt.year); setSelectedQuarter(opt.quarter); }
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            // Recompute employee_performance_metrics for the current quarter
            // (used by individual profile pages). The report table below is live.
            await refreshAllPerformanceMetrics();
            await queryClient.invalidateQueries({ queryKey: ['quarterly_performance_report'] });
            await queryClient.invalidateQueries({ queryKey: ['performance_metrics'] });
        } catch (err) {
            console.error('Refresh error:', err);
        } finally {
            setIsRefreshing(false);
        }
    };

    /* ─── Render ─── */
    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
        return sortDir === 'asc'
            ? <ArrowUp className="w-3 h-3 text-primary" />
            : <ArrowDown className="w-3 h-3 text-primary" />;
    };

    const cellValue = (row: QuarterlyReportRow, col: ColumnDef) => {
        const v = row[col.key];
        if (col.isRate) return `${Number(v).toFixed(1)}%`;
        if (col.key === 'employee_name') return v;
        return Number(v);
    };

    const cellClass = (row: QuarterlyReportRow, col: ColumnDef) => {
        if (!col.thresholdKey) return '';
        const v = Number(row[col.key]);
        const st = getReportCellStatus(col.thresholdKey, v);
        return cn(statusTextColor[st], statusCellBg[st]);
    };

    // Build group headers
    const groups: { name: string; span: number }[] = [];
    let prev = '';
    for (const c of columns) {
        if (c.group !== prev) { groups.push({ name: c.group, span: 1 }); prev = c.group; }
        else { groups[groups.length - 1].span++; }
    }

    const groupColors: Record<string, string> = {
        'Identity': 'bg-muted/30',
        'Offer Behaviour': 'bg-blue-500/5 text-blue-600 dark:text-blue-400',
        'Assignment': 'bg-purple-500/5 text-purple-600 dark:text-purple-400',
        'Reliability': 'bg-amber-500/5 text-amber-600 dark:text-amber-400',
        'Attendance': 'bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
        'Bidding': 'bg-indigo-500/5 text-indigo-600 dark:text-indigo-400',
        'Overall': 'bg-primary/5 text-primary',
    };

    return (
        <div className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4">
            {/* ── Unified Header Block (Rows 1-3) ────────────────────────────── */}
            <div className="flex-shrink-0">
                <div className={cn(
                    "rounded-[32px] p-4 lg:p-6 transition-all border",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    {/* Row 1 & 2: Identity & Scope Filter */}
                    <PersonalPageHeader
                        title={t('nav.performance')}
                        Icon={BarChart3}
                        scope={scope}
                        setScope={setScope}
                        isGammaLocked={isGammaLocked}
                        mode="managerial"
                        multiSelect={true}
                        className="mb-4 lg:mb-6"
                    />

                    {/* Row 3: Module Function Bar */}
                    <PerformanceFunctionBar
                        selectedQuarterLabel={`Q${selectedQuarter} ${selectedYear}`}
                        quarterOptions={quarterOptions}
                        onQuarterChange={handleQuarterChange}
                        onRefresh={handleRefresh}
                        isLoading={isRefreshing}
                        className="mt-1"
                    />
                </div>
            </div>

            {/* ── Main Content Area ────────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                {/* ═══ SUMMARY ROW ═══ */}
                {summary && (
                    <TooltipProvider>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            {([
                                { label: 'Avg Acceptance', value: summary.acceptance_rate, key: 'acceptance_rate' },
                                { label: 'Avg Drop Rate', value: summary.drop_rate, key: 'drop_rate' },
                                { label: 'Avg Cancellation', value: summary.cancel_rate, key: 'cancel_rate' },
                                { label: 'Avg No-Show', value: summary.no_show_rate, key: 'no_show_rate' },
                                { label: 'Overall Score', value: summary.reliability_score, key: 'reliability_score' },
                            ] as const).map(s => {
                                const st = getReportCellStatus(s.key, s.value);
                                return (
                                    <div
                                        key={s.key}
                                        className={cn(
                                            'rounded-[24px] border p-5 transition-all',
                                            isDark 
                                                ? "bg-[#1c2333]/40 border-white/5 shadow-lg" 
                                                : "bg-white/70 backdrop-blur-md border-white shadow-md",
                                            st === 'good' ? 'bg-emerald-500/5' :
                                                st === 'warn' ? 'bg-amber-500/5' :
                                                    'bg-red-500/5',
                                        )}
                                    >
                                        <div className="flex items-center justify-between mb-1.5">
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-black opacity-60">{s.label}</p>
                                            {s.key === 'reliability_score' && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Info className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help transition-colors" />
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="max-w-[280px] text-[11px] p-3 leading-relaxed">
                                                        <p className="font-bold mb-1">Overall Performance Formula</p>
                                                        <div className="space-y-1 font-mono text-[10px]">
                                                            <p>• Reliability: 35% (Cancel/No-Show)</p>
                                                            <p>• Acceptance: 25% (Offer Response)</p>
                                                            <p>• Punctuality: 20% (Late In/Early Out)</p>
                                                            <p>• Bid Success: 20% (Skill Fit)</p>
                                                        </div>
                                                        <p className="mt-2 opacity-70 italic">Weighted average of all behavioral and operational KPIs.</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </div>
                                        <p className={cn('text-3xl font-black tabular-nums tracking-tight', statusTextColor[st])}>
                                            {s.value.toFixed(1)}%
                                        </p>
                                        <p className="text-[10px] text-muted-foreground/50 mt-1 font-medium">Company Average</p>
                                    </div>
                                );
                            })}
                        </div>
                    </TooltipProvider>
                )}

                {/* ═══ TABLE ═══ */}
                <div className={cn(
                    "rounded-[32px] border transition-all overflow-hidden",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <p className="text-muted-foreground text-sm animate-pulse">Loading report…</p>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex items-center justify-center h-48">
                        <p className="text-muted-foreground text-sm">No data for this quarter. Click "Refresh All" to populate.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            {/* Group Headers */}
                            <thead>
                                <tr className="border-b border-border/50">
                                    {groups.map(g => (
                                        <th
                                            key={g.name}
                                            colSpan={g.span}
                                            className={cn(
                                                'px-3 py-2 text-[9px] font-black uppercase tracking-widest text-center border-r border-border/30 last:border-r-0',
                                                groupColors[g.name] || '',
                                            )}
                                        >
                                            {g.name}
                                        </th>
                                    ))}
                                </tr>
                                {/* Column Headers */}
                                <tr className="border-b border-border bg-muted/20">
                                    <TooltipProvider>
                                        {columns.map(col => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-muted/40 transition-colors select-none whitespace-nowrap"
                                            >
                                                <div className="flex items-center gap-1">
                                                    {col.label}
                                                    {col.key === 'reliability_score' && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Info className="h-3 w-3 text-muted-foreground/50 hover:text-foreground cursor-help ml-0.5" />
                                                            </TooltipTrigger>
                                                            <TooltipContent className="text-[11px] p-2">
                                                                Weighted: Reliability (35%), Acceptance (25%), Punctuality (20%), Bid Success (20%)
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                    <SortIcon col={col.key} />
                                                </div>
                                            </th>
                                        ))}
                                    </TooltipProvider>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row, idx) => (
                                    <tr
                                        key={row.employee_id}
                                        className={cn(
                                            'border-b border-border/30 hover:bg-muted/20 transition-colors',
                                            idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/5',
                                        )}
                                    >
                                        {columns.map(col => (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    'px-3 py-2.5 whitespace-nowrap tabular-nums font-semibold',
                                                    col.key === 'employee_name' ? 'font-bold text-foreground' : '',
                                                    cellClass(row, col),
                                                )}
                                            >
                                                {cellValue(row, col)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
          </div>

          {/* ═══ FOOTER ═══ */}
          <div className="flex justify-end pt-2">
            <p className="text-[10px] text-muted-foreground/60 font-black uppercase tracking-widest">
              {rows.length} {rows.length === 1 ? 'Employee' : 'Employees'} &bull; Q{selectedQuarter} {selectedYear}
            </p>
          </div>
        </div>
    );
}
