import React, { useCallback, useState } from 'react';
import { OpenBidsView } from '../views/OpenBidsView';
import type { BidToggle, ToggleCounts } from '../views/OpenBidsView/types';
import { useAuth } from '@/platform/auth/useAuth';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { Button } from '@/modules/core/ui/primitives/button';
import { Gavel, Flame, Clock, CheckCircle, Zap, Loader2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

const TOGGLE_CONFIG: Record<BidToggle, { label: string; Icon: typeof Flame; activeClass: string }> = {
    urgent:   { label: 'Urgent',   Icon: Flame,       activeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
    normal:   { label: 'Normal',   Icon: Clock,       activeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    resolved: { label: 'Resolved', Icon: CheckCircle, activeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

export const ManagerBidsPage: React.FC = () => {
    const { activeContract } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { isDark } = useTheme();

    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeToggle, setActiveToggle] = useState<BidToggle>('urgent');
    const [counts, setCounts] = useState<ToggleCounts>({ urgent: 0, normal: 0, resolved: 0 });
    const [autoAssign, setAutoAssign] = useState<{ run: () => void; isRunning: boolean }>({ run: () => {}, isRunning: false });
    // Bids are inherently forward-looking — default to a window that includes
    // upcoming open shifts (matches the employee bids page: −7 → +30 days).
    const [startDate, setStartDate] = useState<Date>(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d;
    });
    const [endDate, setEndDate]     = useState<Date>(() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d;
    });

    const handleAutoAssignReady = useCallback((fn: { run: () => void; isRunning: boolean }) => {
        setAutoAssign(fn);
    }, []);

    if (!activeContract) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 font-mono text-xs uppercase tracking-widest bg-background">
                Please select a manager certificate to view open bids.
            </div>
        );
    }

    const toggleChips = (
        <div className={cn(
            "flex items-center justify-center gap-1 p-1 h-9 rounded-lg",
            isDark ? "bg-[#111827]/60" : "bg-slate-200/50"
        )}>
            {(Object.keys(TOGGLE_CONFIG) as BidToggle[]).map(key => {
                const conf = TOGGLE_CONFIG[key];
                const active = activeToggle === key;
                const ChipIcon = conf.Icon;
                return (
                    <button
                        key={key}
                        onClick={() => setActiveToggle(key)}
                        className={cn(
                            'flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[10px] font-black uppercase tracking-wider transition-all border',
                            active
                                ? `${conf.activeClass}`
                                : 'border-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted/30'
                        )}
                    >
                        <ChipIcon className="h-3 w-3" />
                        <span className="hidden sm:inline">{conf.label}</span>
                        <span className="inline-flex items-center justify-center h-4 min-w-[18px] px-1 rounded-full bg-foreground/10 text-[9px] font-black tabular-nums">
                            {counts[key]}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    const autoAssignButton = (
        <Button
            onClick={autoAssign.run}
            disabled={autoAssign.isRunning}
            size="sm"
            className="h-9 px-4 text-[10px] font-black uppercase tracking-wider rounded-xl shadow-lg shadow-primary/15"
        >
            {autoAssign.isRunning ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Assigning…</>
            ) : (
                <><Zap className="h-3.5 w-3.5 mr-2" /> Auto-Assign Safe Bids</>
            )}
        </Button>
    );

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
            <GoldStandardHeader
                title="Open Bids Manager"
                Icon={Gavel}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                startDate={startDate}
                endDate={endDate}
                onDateChange={(start: Date, end: Date) => {
                    setStartDate(start);
                    setEndDate(end);
                }}
                filters={toggleChips}
                functionBarChildren={autoAssignButton}
            />

            {/* ── BODY ── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <OpenBidsView
                        organizationId={scope.org_ids[0] ?? null}
                        departmentId={scope.dept_ids[0] ?? null}
                        subDepartmentId={scope.subdept_ids[0] ?? null}
                        externalSearchQuery={searchQuery}
                        viewMode={viewMode}
                        activeToggle={activeToggle}
                        onToggleChange={setActiveToggle}
                        onCountsChange={setCounts}
                        onAutoAssignReady={handleAutoAssignReady}
                        startDate={startDate}
                        endDate={endDate}
                    />
                </div>
            </div>
        </div>
    );
};

export default ManagerBidsPage;
