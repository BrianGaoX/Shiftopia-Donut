import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogOverlay,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    Loader2,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Cpu,
    ShieldCheck,
    Zap,
    Users,
    AlertCircle,
    WifiOff,
    Calendar,
    Activity,
    Scale,
    ArrowUpDown,
    ChevronUp,
    ChevronDown,
    Download,
    HelpCircle,
} from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { AutoSchedulerInsights } from './AutoSchedulerInsights';
import { WhyThisPerson } from './WhyThisPerson';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import {
    autoSchedulerController,
    AutoSchedulerInputTooLargeError,
    OptimizerError,
} from '@/modules/scheduling';
import type {
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerHealth,
    ShiftMeta,
    EmployeeMeta,
} from '@/modules/scheduling';
import { useShiftsByDateRange, type ShiftFilters } from '@/modules/rosters/state/useRosterShifts';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/modules/core/ui/primitives/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/core/ui/primitives/popover";

// =============================================================================
// TYPES & PROPS
// =============================================================================

interface AutoSchedulerModalProps {
    open: boolean;
    onClose: () => void;
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    onComplete: () => void;
    /** Org scope for the F1 fairness ledger. When omitted, the ledger is skipped. */
    organizationId?: string;
    queryFilters?: ShiftFilters;
}

type PipelinePhase = 'idle' | 'optimizing' | 'validating' | 'reviewing' | 'done';
const LEVEL_COLORS: Record<string, string> = {
    'L0': '#64748b', // Slate
    'L1': '#3b82f6', // Blue
    'L2': '#10b981', // Emerald
    'L3': '#f59e0b', // Amber
    'L4': '#ef4444', // Red
    'L5': '#8b5cf6', // Violet
    'L6': '#ec4899', // Pink
    'L7': '#f97316', // Orange
    'default': '#94a3b8'
};

const ROLE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const getRoleColor = (roleName: string) => {
    const match = roleName.match(/\(L([0-7])\)/i);
    if (match) return LEVEL_COLORS[`L${match[1].toUpperCase()}`] || LEVEL_COLORS.default;
    
    // Fallback for names without L pattern
    let hash = 0;
    for (let i = 0; i < roleName.length; i++) {
        hash = roleName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return ROLE_COLORS[Math.abs(hash) % ROLE_COLORS.length];
};

// =============================================================================
// SUB-COMPONENTS (PREMIUM DESIGN)
// =============================================================================



// =============================================================================
// MAIN MODAL
// =============================================================================

export function AutoSchedulerModal({
    open,
    onClose,
    shifts: initialShifts,
    employees,
    onComplete,
    organizationId,
    queryFilters,
}: AutoSchedulerModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [health, setHealth] = useState<OptimizerHealth | null>(null);
    const [phase, setPhase] = useState<PipelinePhase>('idle');
    const [result, setResult] = useState<AutoSchedulerResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    const [sortField, setSortField] = useState<'name' | 'utilization' | 'shifts' | 'compliance' | 'cost' | 'fatigue'>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [hoveredDistId, setHoveredDistId] = useState<string | null>(null);
    const runAbortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Timer for "Estimated Time Left"
    useEffect(() => {
        if (phase === 'optimizing') {
            setElapsedTime(0);
            timerRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [phase]);


    // Date Range Selection
    const defaultStart = useMemo(() => initialShifts.length > 0 ? [...initialShifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date))[0].shift_date : '', [initialShifts]);
    const defaultEnd = useMemo(() => initialShifts.length > 0 ? [...initialShifts].sort((a, b) => b.shift_date.localeCompare(a.shift_date))[0].shift_date : '', [initialShifts]);

    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);

    const validationError = useMemo(() => {
        if (!startDate || !endDate) {
            return "Please select both start and end dates.";
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return "Invalid date format.";
        }
        if (start > end) {
            return "Start date cannot be after end date.";
        }
        const diffTime = end.getTime() - start.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // inclusive
        if (diffDays > 31) {
            return "Date range cannot exceed 31 days.";
        }
        return null;
    }, [startDate, endDate]);

    // Operational limits (single-mode: cost/fatigue/fairness weight sliders +
    // presets were removed — the solver runs a fixed lexicographic policy).

    const { data: rawShifts = [], isFetching: isShiftsLoading } = useShiftsByDateRange(
        organizationId || null,
        validationError ? null : (startDate || null),
        validationError ? null : (endDate || null),
        queryFilters
    );

    const filteredShifts = useMemo(() => {
        if (!startDate || !endDate || validationError) return [];
        return rawShifts
            .filter((s) => !s.assigned_employee_id && !s.is_cancelled && !s.deleted_at)
            .map((s) => ({
                id: s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                role_id: (s as any).role_id ?? null,
                roleName: (s as any).role_name || (s as any).roles?.name || '',
                unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
            } as ShiftMeta));
    }, [rawShifts, startDate, endDate, validationError]);

    const ESTIMATED_TOTAL_SECONDS = useMemo(() => {
        // Must stay in sync with dynamicBudget in auto-scheduler.controller.ts.
        // Largest bucket gets extra headroom for big monthly rosters; this
        // composes with the solver's front-loaded per-tier time allocation.
        const rawPairs = filteredShifts.length * employees.length;
        if (rawPairs > 30000) return 120;
        if (rawPairs > 10000) return 60;
        return 30;
    }, [filteredShifts.length, employees.length]);

    const preRunCapacity = useMemo(() => {
        if (filteredShifts.length === 0 || employees.length === 0) return null;
        return autoSchedulerController.capacityCheck(filteredShifts, employees);
    }, [filteredShifts, employees]);

    useEffect(() => {
        if (!open) return;
        setHealth(null);
        autoSchedulerController.checkHealth().then(setHealth);
    }, [open]);

    const handleRun = useCallback(async () => {
        if (filteredShifts.length === 0) return;
        runAbortRef.current?.abort();
        const ac = new AbortController();
        runAbortRef.current = ac;

        setResult(null);
        setPhase('optimizing');

        try {
            const schedResult = await autoSchedulerController.run({
                shifts: filteredShifts,
                employees,
                organizationId,
                signal: ac.signal,
                timeLimitSeconds: ESTIMATED_TOTAL_SECONDS,
                // Single-mode: no cost/fatigue/fairness sliders. The solver runs a
                // fixed lexicographic policy (coverage » guardrails » cost). We
                // also request Pareto "what-if" alternatives for the explorer.
                computeAlternatives: true,
            });
            if (ac.signal.aborted) return;
            setPhase('reviewing');
            setResult(schedResult);
        } catch (err: any) {
            if (ac.signal.aborted || err?.name === 'AbortError') {
                console.debug('[AutoScheduler] Run aborted by user');
                return;
            }
            setPhase('idle');
            toast({
                title: err instanceof AutoSchedulerInputTooLargeError ? 'Too much to optimize' : 'Optimization Failed',
                description: err?.message ?? 'Unexpected error',
                variant: 'destructive',
            });
        } finally {
            if (runAbortRef.current === ac) runAbortRef.current = null;
        }
    }, [filteredShifts, employees, toast, organizationId]);

    const handleCancel = useCallback(() => {
        if (runAbortRef.current) {
            runAbortRef.current.abort();
            runAbortRef.current = null;
        }
        setPhase('idle');
        setResult(null);
        toast({
            title: 'Operation Cancelled',
            description: 'The optimization process was stopped.',
        });
    }, [toast]);

    const handleCommit = useCallback(async () => {
        if (!result) return;
        setIsCommitting(true);

        try {
            const commitResult = await autoSchedulerController.commit(result);
            if (commitResult.success || commitResult.totalCommitted > 0) {
                setPhase('done');
                toast({
                    title: 'Shifts Assigned',
                    description: `Successfully assigned ${commitResult.totalCommitted} shift(s).`,
                });
                queryClient.invalidateQueries({ queryKey: [shiftKeys.all[0]] });
                onComplete();
                handleClose();
            } else {
                toast({
                    title: 'Commit Failed',
                    description: 'No shifts were committed. Check compliance results.',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            toast({ title: 'Error', description: err?.message ?? 'Failed to commit', variant: 'destructive' });
        } finally {
            setIsCommitting(false);
        }
    }, [result, queryClient, toast, onComplete]);

    const handleClose = () => {
        runAbortRef.current?.abort();
        runAbortRef.current = null;
        setResult(null);
        setPhase('idle');
        onClose();
    };

    const handleDownloadAudit = useCallback(() => {
        // Generate for ANY completed run — a clean 100%-compliant roster deserves
        // an audit report too. (Old guard required `uncoveredAudit`, which is only
        // computed when shifts are uncovered, so the button silently did nothing
        // on a perfect run.)
        if (!result) return;
        setIsDownloading(true);

        try {
            const csvEscape = (v: string | number) => {
                const s = String(v ?? '');
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };
            const money = (n: number) =>
                new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
            const row = (...cells: (string | number)[]) => cells.map(csvEscape).join(',');

            const audit = result.uncoveredAudit ?? [];
            const totalUncovered = result.uncoveredV8ShiftIds.length;
            const audited = audit.length;
            const compliancePct = result.totalProposals > 0
                ? Math.round((result.passing / result.totalProposals) * 100)
                : 100;

            const lines: string[] = [
                'AUTO-SCHEDULE AUDIT REPORT',
                row('Generated', new Date().toLocaleString()),
                row('Window', `${startDate} to ${endDate}`),
                row('Optimizer status', result.optimizerStatus),
                '',
            ];

            // ── Scorecard — the new single-source-of-truth metrics (matches the
            //    on-screen pillars: Coverage / Wellbeing / Fairness / Compliance /
            //    Labour cost), NOT the old Passing/Failing-proposal framing. ──
            const p = result.pillars;
            if (p) {
                lines.push('--- SCORECARD ---');
                lines.push(row('Metric', 'Score', 'Detail'));
                lines.push(row('Coverage', `${p.coverage.score}%`, `${p.coverage.covered}/${p.coverage.total} shifts filled`));
                lines.push(row('Wellbeing', `${p.fatigue.score}/100`,
                    p.fatigue.critical > 0 ? `${p.fatigue.critical} over-tired`
                        : p.fatigue.amber > 0 ? `${p.fatigue.amber} near limit` : 'all well-rested'));
                lines.push(row('Fairness', `${p.fairness.score}/100`, `${p.fairness.employees_used} staff · ${Math.round(p.fairness.spread_minutes / 60)}h spread`));
                lines.push(row('Compliance', `${compliancePct}%`, `${result.passing}/${result.totalProposals} assignments passing`));
                lines.push(row('Labour cost', money(p.cost.total), `${money(p.cost.avg_per_shift)}/shift avg`));
                lines.push('');
            }

            // ── Summary — compliance is a hard gate (100% by construction). ──
            lines.push('--- SUMMARY ---');
            lines.push(row('Compliant assignments booked', result.passing));
            lines.push(row('Uncovered shifts', totalUncovered));
            lines.push(row('Compliance policy', '100% by construction — non-compliant assignments are never booked; they are left uncovered.'));
            lines.push('');

            if (result.capacityCheck) {
                const cc = result.capacityCheck;
                lines.push('--- CAPACITY PRE-CHECK ---');
                lines.push(row('Status', cc.sufficient ? 'SUFFICIENT' : 'INSUFFICIENT'));
                lines.push(row('Total Demand (min)', cc.totalDemandMinutes));
                lines.push(row('Total Supply (min)', cc.totalSupplyMinutes));
                lines.push('Date,Shifts,Employees,Demand (min),Supply (min),Deficit (min),Sufficient');
                for (const day of cc.perDay) {
                    lines.push(row(day.date, day.shiftCount, day.employeeCount, day.demandMinutes,
                        day.supplyMinutes, day.deficitMinutes, day.sufficient ? 'YES' : 'NO'));
                }
                lines.push('');
            }

            // ── Uncovered analysis — only when there is something uncovered. ──
            if (totalUncovered > 0) {
                lines.push('--- UNCOVERED SHIFT ANALYSIS ---');
                lines.push(row('Audited', `${audited}${audited < totalUncovered ? ` (capped — ${totalUncovered - audited} not detailed)` : ''}`));
                lines.push('Shift Date,Time,Reason Summary');
                for (const a of audit) {
                    const summary = Object.entries(a.rejectionSummary).map(([type, count]) => `${type}: ${count}`).join(' | ');
                    lines.push(row(a.shiftDate, `${a.startTime}-${a.endTime}`, summary || 'No reasons recorded'));
                }
                lines.push('', '--- UNCOVERED — PER-EMPLOYEE DETAIL ---');
                lines.push('Shift Date,Time,Employee,Status,Violations');
                for (const a of audit) {
                    for (const detail of a.employeeDetails) {
                        lines.push(row(a.shiftDate, `${a.startTime}-${a.endTime}`,
                            detail.employeeName, detail.status, detail.violations.map(v => v.description).join('; ')));
                    }
                }
                lines.push('');
            }

            // ── Booked roster — keeps the report substantive even at 100%
            //    coverage (every row here is compliant by the hard gate). ──
            lines.push('--- BOOKED ASSIGNMENTS ---');
            lines.push('Shift Date,Time,Employee,Role,Est. Cost,Compliance');
            const sortedProposals = [...result.proposals].sort((a, b) =>
                a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime));
            for (const pr of sortedProposals) {
                lines.push(row(pr.shiftDate, `${pr.startTime}-${pr.endTime}`, pr.employeeName,
                    pr.roleName ?? '', money(pr.optimizerCost ?? 0), pr.complianceStatus));
            }

            const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Auto-Schedule_Audit_${startDate || new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to generate report', err);
        } finally {
            setIsDownloading(false);
        }
    }, [result, startDate, endDate]);

    const { totals, employeeGroups } = useMemo(() => {
        if (!result) return { totals: { cost: 0, fatigue: 0, p95Fatigue: 0, fairness: 0 }, employeeGroups: [] };
        
        const map = new Map<string, { name: string; proposals: ValidatedProposal[] }>();
        let totalCost = 0;
        let totalFatigue = 0;
        let totalUtilization = 0;
        let proposalCount = 0;

        for (const p of result.proposals) {
            if (!map.has(p.employeeId)) map.set(p.employeeId, { name: p.employeeName, proposals: [] });
            map.get(p.employeeId)!.proposals.push(p);
            totalCost += p.optimizerCost || 0;
            if (p.fatigueScore != null) {
                totalFatigue += p.fatigueScore;
                proposalCount++;
            }
            if (p.utilization != null) {
                totalUtilization += p.utilization;
            }
        }

        const groups = Array.from(map.entries()).map(([id, { name, proposals }]) => {
            const emp = employees.find(e => e.id === id);
            const roleDist: Record<string, number> = {};
            proposals.forEach(p => {
                const role = p.roleName || 'Unassigned';
                roleDist[role] = (roleDist[role] ?? 0) + 1;
            });

            const sortedDist = Object.entries(roleDist)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => a.name.localeCompare(b.name));

            // Fix 2: use LAST proposal's utilization — the scorer accumulates it
            // cumulatively as shifts are added, so proposals[0] reflects only the
            // first shift. The final entry reflects all shifts assigned to this employee.
            const utilization = proposals.at(-1)?.utilization ?? 0;

            // Fix 3: use LAST proposal's fatigueScore per employee (final cumulative
            // value), then the caller averages across employees — not across assignments.
            const finalFatigue = proposals.at(-1)?.fatigueScore ?? 0;

            return {
                id,
                name,
                proposals,
                roleDistribution: sortedDist,
                totalCost: proposals.reduce((acc, p) => acc + (p.optimizerCost || 0), 0),
                avgFatigue: finalFatigue,
                utilization,
                employmentType: emp?.contract_type || 'Casual',
                contractedHours: emp?.contracted_weekly_hours || 0,
                assignedRoles: Array.from(new Set(proposals.map(p => p.roleName).filter(Boolean))) as string[],
            };
        });

        const aggregateFairness = groups.length > 0
            ? groups.reduce((acc, g) => acc + g.utilization, 0) / groups.length
            : 0;

        // Fix 3: average fatigue across employees (each employee's final cumulative
        // fatigue score), not across individual assignments.
        const avgFatiguePerEmployee = groups.length > 0
            ? groups.reduce((acc, g) => acc + g.avgFatigue, 0) / groups.length
            : 0;

        // p95 fatigue across employees for additional signal
        const sortedFatigue = [...groups].map(g => g.avgFatigue).sort((a, b) => a - b);
        const p95FatigueIdx = Math.floor(sortedFatigue.length * 0.95);
        const p95Fatigue = sortedFatigue.length > 0 ? (sortedFatigue[Math.min(p95FatigueIdx, sortedFatigue.length - 1)] ?? 0) : 0;

        return {
            totals: {
                cost: totalCost,
                fatigue: avgFatiguePerEmployee,
                p95Fatigue,
                fairness: aggregateFairness
            },
            employeeGroups: groups
        };
    }, [result]);

    return (
        <Dialog open={open} onOpenChange={o => !o && handleClose()}>
            <DialogOverlay className="bg-background/80 backdrop-blur-2xl" />
            <DialogContent className="max-w-[95vw] xl:max-w-[1400px] h-[min(900px,90vh)] p-0 overflow-hidden bg-background border-border/50 rounded-[2.5rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.3)] dark:shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] text-foreground ring-1 ring-border/50 flex flex-row">
                <TooltipProvider delayDuration={0}>
                
                {/* ── LEFT SIDEBAR: CONTROL & METRICS ─────────────────────────── */}
                <div className="w-[320px] flex-shrink-0 border-r border-border/50 bg-muted/20 flex flex-col p-8 overflow-y-auto">
                    {/* Brand/Identity */}
                    <div className="flex items-center gap-3 mb-10">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-lg shadow-primary/20">
                            <Cpu className="h-5 w-5" strokeWidth={2} />
                        </div>
                        <div className="flex flex-col">
                            <DialogTitle className="text-lg font-black tracking-tight text-foreground leading-tight">Auto-Schedule</DialogTitle>
                            <DialogDescription className="sr-only">Evaluate and audit shift assignments generated by the V8 optimizer.</DialogDescription>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                {!health ? (
                                    <span className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest animate-pulse">Syncing...</span>
                                ) : health.available ? (
                                    <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                                        <div className="h-1 w-1 rounded-full bg-emerald-500" /> V8.0 Active
                                    </span>
                                ) : (
                                    <span className="text-[8px] font-bold text-red-500 uppercase tracking-widest">Offline</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Pipeline Progress (Vertical) */}
                    <div className="space-y-6 mb-12">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50 mb-4">Pipeline Status</div>
                        {[
                            { id: 'optimizing', label: 'Optimization', icon: Cpu, active: phase === 'optimizing', done: ['validating', 'reviewing', 'done'].includes(phase) },
                            { id: 'validating', label: 'Compliance', icon: ShieldCheck, active: phase === 'validating', done: ['reviewing', 'done'].includes(phase) },
                            { id: 'reviewing',  label: 'Review & Audit', icon: Users, active: phase === 'reviewing', done: phase === 'done' },
                        ].map((step, idx, arr) => (
                            <div key={step.id} className="relative flex items-center gap-4">
                                {idx < arr.length - 1 && (
                                    <div className={cn("absolute left-4 top-8 w-px h-6 bg-border/50", step.done && "bg-emerald-500/20")} />
                                )}
                                <div className={cn(
                                    "h-8 w-8 rounded-lg flex items-center justify-center transition-all",
                                    step.done ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                                    step.active ? "bg-primary/10 text-primary animate-pulse ring-2 ring-primary/20" :
                                    "bg-muted text-muted-foreground/40"
                                )}>
                                    {step.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <step.icon className="h-4 w-4" />}
                                </div>
                                <span className={cn("text-[10px] font-bold uppercase tracking-widest", step.active ? "text-foreground" : "text-muted-foreground/60")}>{step.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-6">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Active Window</div>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Range Start</Label>
                                <Input 
                                    type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                    className={cn(
                                        "h-10 bg-background border-border rounded-xl text-xs font-bold focus:ring-primary/20",
                                        validationError && "border-red-500/50 focus:ring-red-500/20"
                                    )}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Range End</Label>
                                <Input 
                                    type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                    className={cn(
                                        "h-10 bg-background border-border rounded-xl text-xs font-bold focus:ring-primary/20",
                                        validationError && "border-red-500/50 focus:ring-red-500/20"
                                    )}
                                />
                            </div>
                            {validationError && (
                                <div className="flex items-start gap-1.5 p-2 rounded-lg bg-red-500/5 border border-red-500/20 text-red-500 mt-1">
                                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span className="text-[10px] font-medium leading-tight">{validationError}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tuning Sidebar — Fixes 4, 5, 7 + Gap 9 (presets) */}
                    <div className="space-y-6 mt-8">
                        {/* Single-mode notice — the cost/fatigue/fairness/coverage
                            sensitivity sliders + presets were removed in favour of one
                            fixed lexicographic policy (coverage » wellbeing » cost).
                            After a run, AutoSchedulerInsights shows the achieved scores
                            and the Pareto alternatives. */}
                        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1">
                            <div className="flex items-center gap-1.5">
                                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">One optimal mode</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                The scheduler optimises a fixed priority —{' '}
                                <span className="font-semibold text-foreground">coverage → wellbeing → cost</span>{' '}
                                — so there are no weights to tune. After it runs you'll see exactly how it
                                scored on each, and what the alternatives would have cost.
                            </p>
                        </div>

                        {/* Min-Rest-Hours + Relax-Blockers controls removed: rest is
                            always the 10h EBA default (per-case 8h exemption handled
                            elsewhere) and constraint relaxation is not exposed. The
                            solver uses its hard defaults (600m rest, no relaxation). */}
                    </div>

                    {/* Quick Metrics Section (Only visible after run) */}
                    {result && (
                        <div className="mt-auto pt-8 border-t border-border/50 space-y-4">
                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Solution Health</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex flex-col">
                                    <span className="text-[8px] font-black text-emerald-600/70 dark:text-emerald-500/60 uppercase">Passing</span>
                                    <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">{result.passing}</span>
                                </div>
                                <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 flex flex-col">
                                    <span className="text-[8px] font-black text-red-600/70 dark:text-red-500/60 uppercase">Failing</span>
                                    <span className="text-lg font-black text-red-600 dark:text-red-400">{result.failing}</span>
                                </div>
                            </div>
                            {/* Bug 1 fix: source Fairness from the SAME pillar score as the
                                AutoSchedulerInsights card (workload-evenness, 0-100), so the two
                                surfaces always agree. On the greedy fallback path pillars may be
                                absent — there we show the average-utilization value but RELABEL it
                                honestly ("Avg Utilization") so it is never mislabeled as Fairness. */}
                            <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[8px] font-black text-primary/60 uppercase">
                                        {result.pillars ? 'Fairness' : 'Avg Utilization'}
                                    </span>
                                    {result.pillars ? (
                                        <span className="text-lg font-black text-primary">
                                            {result.pillars.fairness.score.toFixed(0)}
                                            <span className="text-[10px] font-bold text-primary/50">/100</span>
                                        </span>
                                    ) : (
                                        <span className="text-lg font-black text-primary">{totals.fairness.toFixed(0)}%</span>
                                    )}
                                </div>
                                <Zap className="h-5 w-5 text-primary/30" />
                            </div>
                        </div>
                    )}
                </div>

                {/* ── RIGHT CANVAS: CONTENT & RESULTS ─────────────────────────── */}
                <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
                    
                    {/* Toolbar / Actions Header */}
                    <div className="h-16 px-8 flex items-center justify-between border-b border-border/50 bg-muted/10">
                        <div className="flex-1 flex items-center gap-4">
                            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted border border-border">
                                <Calendar className="h-3 w-3 text-muted-foreground/60" />
                                <span className="text-[10px] font-bold text-muted-foreground tracking-tight">
                                    {isShiftsLoading ? 'Loading shifts...' : `${filteredShifts.length} Shifts`} · {employees.length} Staff
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {result && (
                                <Button onClick={handleDownloadAudit} variant="outline" className="h-8 gap-2 rounded-lg bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                                    <Download className="h-3.5 w-3.5" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest">Audit Report</span>
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Scrollable Canvas Area */}
                    <ScrollArea className="flex-1">
                        <div className="p-8">
                            <AnimatePresence mode="wait">
                                {phase === 'idle' &&
                                    <motion.div 
                                        className="max-w-3xl mx-auto space-y-8 py-12"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                    >
                                        <div className="flex flex-col items-center text-center gap-4 mb-12">
                                            <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center text-primary shadow-2xl shadow-primary/20 mb-4">
                                                <Cpu className="h-10 w-10" />
                                            </div>
                                            <h3 className="text-3xl font-black tracking-tight text-foreground">Ready to Optimize</h3>
                                            <p className="text-muted-foreground/60 max-w-sm text-sm leading-relaxed">
                                                The CP-SAT solver will evaluate billions of combinations to find the highest-fairness, lowest-fatigue roster possible.
                                            </p>
                                        </div>

                                        {preRunCapacity && preRunCapacity.deficitDays.length > 0 ? (
                                            <div className="p-8 rounded-[2rem] bg-amber-500/10 border border-amber-500/20 space-y-4">
                                                <div className="flex items-center gap-3">
                                                    <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-500" />
                                                    <span className="text-lg font-black text-amber-700 dark:text-amber-400">Demand Warning</span>
                                                </div>
                                                <p className="text-sm text-muted-foreground/80 leading-relaxed">
                                                    Detected capacity shortages on <span className="text-amber-600 dark:text-amber-400 font-bold">{preRunCapacity.deficitDays.length} days</span>. This means some shifts will remain uncovered regardless of assignment strategy.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="p-8 rounded-[2rem] bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-6">
                                                <div className="h-12 w-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-500 flex-shrink-0">
                                                    <CheckCircle2 className="h-6 w-6" />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-lg font-black text-emerald-700 dark:text-emerald-400">Optimal Supply Found</span>
                                                    <span className="text-xs text-muted-foreground/60">Total workforce minutes satisfy current shift demand.</span>
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                }

                                {phase === 'optimizing' &&
                                    <div className="py-24 flex flex-col items-center gap-8 max-w-xl mx-auto">
                                        <div className="relative">
                                            <div className="h-32 w-32 rounded-full border-2 border-primary/20 animate-ping absolute" />
                                            <div className="h-32 w-32 rounded-[2.5rem] bg-primary/10 flex items-center justify-center text-primary relative shadow-2xl shadow-primary/20">
                                                <Cpu className="h-12 w-12 animate-pulse" />
                                            </div>
                                        </div>
                                        <div className="text-center space-y-4 w-full">
                                            <div className="space-y-2">
                                                <p className="text-2xl font-black tracking-tight text-foreground">Computing Optimal Set</p>
                                                <p className="text-sm text-muted-foreground/60 font-mono tracking-widest uppercase">Solving Constraint Logic...</p>
                                            </div>
                                            
                                            {/* Progress Bar & Est. Time */}
                                            <div className="space-y-3 pt-4">
                                                <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border">
                                                    <motion.div 
                                                        className="h-full bg-primary shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                                                        initial={{ width: 0 }}
                                                        animate={{ 
                                                            width: elapsedTime < ESTIMATED_TOTAL_SECONDS 
                                                                ? `${(elapsedTime / ESTIMATED_TOTAL_SECONDS) * 100}%` 
                                                                : "98%" 
                                                        }}
                                                        transition={{ duration: 1, ease: "linear" }}
                                                    />
                                                </div>
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">Elapsed: {elapsedTime}s</span>
                                                    <span className="text-[10px] font-black text-primary uppercase tracking-widest animate-pulse">
                                                        {elapsedTime < ESTIMATED_TOTAL_SECONDS 
                                                            ? `Est. ${ESTIMATED_TOTAL_SECONDS - elapsedTime}s Left`
                                                            : "Almost there... Wrapping up"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                }

                                {['reviewing', 'done'].includes(phase) && result &&
                                    <motion.div
                                        className="space-y-12"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                    >

                                        {/* U2/U3/U5 — single-mode transparency: four-pillar scorecard,
                                            constraint banner, and Pareto trade-off explorer. */}
                                        <AutoSchedulerInsights result={result} />

                                        {/* The second stats grid (Total Cost / Avg Fatigue / Uncovered /
                                            Coverage / Compliance) was removed: it duplicated Coverage and
                                            Cost from the scorecard above, restated Uncovered as the inverse
                                            of Coverage, and showed a SECOND, conflicting fatigue number
                                            (avg 14.0) next to the Wellbeing pillar (62). Compliance is now a
                                            pillar in AutoSchedulerInsights; per-person fatigue/cost live in
                                            the staff table below. One uniform scorecard = one source of truth. */}

                                        {/* Objective breakdown — shows which strategy term drove the solver's score */}
                                        {(() => {
                                            const breakdown = result.objective_breakdown;
                                            if (!breakdown) return null;
                                            const entries = Object.entries(breakdown).filter(([, v]) => Number.isFinite(v));
                                            const total = entries.reduce((s, [, v]) => s + Math.abs(v), 0);
                                            if (total === 0) return null;
                                            const colorOf = (cat: string): string => {
                                                switch (cat) {
                                                    case 'cost': return 'bg-blue-500';
                                                    case 'fairness': return 'bg-purple-500';
                                                    case 'fatigue': return 'bg-amber-500';
                                                    case 'coverage': return 'bg-rose-500';
                                                    case 'continuity': return 'bg-emerald-500';
                                                    default: return 'bg-muted-foreground/40';
                                                }
                                            };
                                            const labelOf = (cat: string): string => cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                            const fmtValue = (cat: string, v: number): string =>
                                                cat === 'cost' ? `$${Math.round(v / 100).toLocaleString()}` : Math.round(v).toLocaleString();
                                            const sorted = [...entries].sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));
                                            return (
                                                <div className="p-5 rounded-[2rem] bg-card/40 dark:bg-card/20 border border-border/40 shadow-xl flex flex-col gap-4">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-baseline justify-between">
                                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Objective Breakdown</span>
                                                            <span className="text-[10px] font-bold text-muted-foreground/40 tracking-wide">Total: {Math.round(total).toLocaleString()}</span>
                                                        </div>
                                                        {/* Bug 2 fix: clarify these are penalty magnitudes, not priority weights.
                                                            The solver optimises in strict lexicographic tiers, so categories in
                                                            different tiers are never traded off against each other — presenting
                                                            them as competing percentages of one total would imply a false ranking. */}
                                                        <p className="text-[10px] leading-snug text-muted-foreground/50">
                                                            Share of total penalty magnitude by category — not priority weights. The solver optimises in fixed tiers: coverage » wellbeing » cost.
                                                        </p>
                                                    </div>
                                                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/30">
                                                        {sorted.map(([cat, v]) => (
                                                            <div
                                                                key={cat}
                                                                className={`${colorOf(cat)} h-full transition-all`}
                                                                style={{ width: `${(Math.abs(v) / total) * 100}%` }}
                                                                title={`${labelOf(cat)}: ${fmtValue(cat, v)}`}
                                                            />
                                                        ))}
                                                    </div>
                                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
                                                        {sorted.map(([cat, v]) => (
                                                            <div key={cat} className="flex items-center gap-2 min-w-0">
                                                                <span className={`${colorOf(cat)} h-2 w-2 rounded-sm shrink-0`} />
                                                                <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wide truncate">{labelOf(cat)}</span>
                                                                <span
                                                                    className="text-[10px] font-black text-foreground/90 ml-auto tabular-nums"
                                                                    title={`${labelOf(cat)}: ${((Math.abs(v) / total) * 100).toFixed(0)}% of total penalty magnitude — not a priority weight`}
                                                                >{((Math.abs(v) / total) * 100).toFixed(0)}%</span>
                                                                <span className="text-[10px] font-bold text-muted-foreground/50 tabular-nums shrink-0">{fmtValue(cat, v)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Optimizer Fallback Notice — surfaces silently-degraded runs */}
                                        {(result.usedFallback || result.optimizerStatus === 'INFEASIBLE' || result.optimizerStatus === 'UNKNOWN' || result.optimizerStatus === 'MODEL_INVALID') && (
                                            <div className="p-6 rounded-[2rem] bg-rose-500/5 border border-rose-500/20 flex items-start gap-5 shadow-2xl">
                                                <div className="h-12 w-12 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
                                                    <WifiOff className="h-6 w-6" />
                                                </div>
                                                <div className="flex flex-col gap-1.5">
                                                    <span className="text-lg font-black text-rose-700 dark:text-rose-300 tracking-tight uppercase">
                                                        {result.usedFallback ? 'Greedy Fallback Engaged' : `Optimizer Status: ${result.optimizerStatus}`}
                                                    </span>
                                                    <p className="text-muted-foreground/80 dark:text-white/60 leading-relaxed text-sm">
                                                        {result.usedFallback
                                                            ? <>The CP-SAT optimizer was unreachable or returned no solution, so a greedy first-fit engine produced these proposals. Quality (cost, fatigue, fairness) will be lower than a full optimization. Start the service: <code className="text-rose-600 dark:text-rose-300 bg-rose-500/10 px-1.5 py-0.5 rounded text-xs">cd optimizer-service &amp;&amp; python ortools_runner.py</code></>
                                                            : <>The solver returned <span className="text-rose-600 dark:text-rose-300 font-bold">{result.optimizerStatus}</span>. Coverage may be partial — review uncovered shifts below.</>
                                                        }
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Physical Capacity Alert (Explains uncovered shifts) */}
                                        {result.capacityCheck && !result.capacityCheck.sufficient && (
                                            <div className="p-8 rounded-[2.5rem] bg-amber-500/5 border border-amber-500/20 flex items-start gap-6 shadow-2xl">
                                                <div className="h-14 w-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0 mt-1">
                                                    <AlertTriangle className="h-8 w-8" />
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    <span className="text-xl font-black text-amber-700 dark:text-amber-400 tracking-tight uppercase">Labor Deficit Detected</span>
                                                    <p className="text-muted-foreground/80 dark:text-white/60 leading-relaxed text-sm">
                                                        Your workforce is short by <span className="text-amber-700 dark:text-amber-400 font-bold">{(result.capacityCheck.deficitDays.reduce((a, d) => a + d.deficitMinutes, 0) / 60).toFixed(0)} hours</span> for this period. 
                                                        Even with perfect optimization, <span className="text-foreground font-bold">{result.uncoveredV8ShiftIds.length} shifts</span> cannot be covered because there are physically more shift hours than staff hours available.
                                                    </p>
                                                    <div className="flex items-center gap-4 mt-2">
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-black uppercase text-muted-foreground/40 tracking-widest">Total Demand</span>
                                                            <span className="text-xs font-bold text-foreground">{(result.capacityCheck.totalDemandMinutes / 60).toFixed(0)}h</span>
                                                        </div>
                                                        <div className="h-4 w-px bg-border" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-black uppercase text-muted-foreground/40 tracking-widest">Total Supply</span>
                                                            <span className="text-xs font-bold text-foreground">{(result.capacityCheck.totalSupplyMinutes / 60).toFixed(0)}h</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Employee Results Cards */}
                                        <div className="space-y-2">
                                            {/* Header for List View */}
                                            <div className="flex items-center px-6 py-3 border-b border-border/30 text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 gap-4">
                                                <div className="w-10" />
                                                <button 
                                                    onClick={() => {
                                                        if (sortField === 'name') setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                        else { setSortField('name'); setSortDirection('asc'); }
                                                    }}
                                                    className="flex-1 min-w-[150px] flex items-center gap-1.5 hover:text-foreground transition-colors group"
                                                >
                                                    Staff Member
                                                    {sortField === 'name' ? (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                                                </button>
                                                <div className="w-24 text-center">Employment</div>
                                                <div className="w-20 text-center">Contract</div>
                                                <button 
                                                    onClick={() => {
                                                        if (sortField === 'utilization') setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                        else { setSortField('utilization'); setSortDirection('desc'); }
                                                    }}
                                                    className="w-24 flex items-center justify-center gap-1.5 hover:text-foreground transition-colors group"
                                                >
                                                    Utilization
                                                    {sortField === 'utilization' ? (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (sortField === 'fatigue') setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                        else { setSortField('fatigue'); setSortDirection('desc'); }
                                                    }}
                                                    className="w-20 flex items-center justify-center gap-1.5 hover:text-foreground transition-colors group"
                                                >
                                                    Fatigue
                                                    {sortField === 'fatigue' ? (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (sortField === 'shifts') setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                        else { setSortField('shifts'); setSortDirection('desc'); }
                                                    }}
                                                    className="w-20 flex items-center justify-center gap-1.5 hover:text-foreground transition-colors group"
                                                >
                                                    Shifts
                                                    {sortField === 'shifts' ? (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (sortField === 'compliance') setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                        else { setSortField('compliance'); setSortDirection('desc'); }
                                                    }}
                                                    className="w-28 flex items-center justify-center gap-1.5 hover:text-foreground transition-colors group"
                                                >
                                                    Compliance
                                                    {sortField === 'compliance' ? (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (sortField === 'cost') setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                        else { setSortField('cost'); setSortDirection('desc'); }
                                                    }}
                                                    className="w-28 flex items-center justify-end gap-1.5 hover:text-foreground transition-colors group"
                                                >
                                                    Est. Cost
                                                    {sortField === 'cost' ? (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                                                </button>
                                            </div>
                                            
                                            {[...employeeGroups].sort((a, b) => {
                                                const getComplianceRate = (g: any) => {
                                                    const p = g.proposals.filter((pr: any) => pr.complianceStatus === 'PASS').length;
                                                    return g.proposals.length > 0 ? (p / g.proposals.length) : 0;
                                                };
                                                
                                                let valA: any, valB: any;
                                                switch (sortField) {
                                                    case 'name': valA = a.name; valB = b.name; break;
                                                    case 'utilization': valA = a.utilization; valB = b.utilization; break;
                                                    case 'shifts': valA = a.proposals.length; valB = b.proposals.length; break;
                                                    case 'compliance': valA = getComplianceRate(a); valB = getComplianceRate(b); break;
                                                    case 'cost': valA = a.totalCost; valB = b.totalCost; break;
                                                    case 'fatigue': valA = a.avgFatigue; valB = b.avgFatigue; break;
                                                    default: valA = a.name; valB = b.name;
                                                }
                                                
                                                if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                                                if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                                                return 0;
                                            }).map(group => {
                                                const passing = group.proposals.filter(p => p.complianceStatus === 'PASS').length;
                                                const total = group.proposals.length;
                                                const rate = total > 0 ? (passing / total) * 100 : 0;
                                                
                                                return (
                                                    <div key={group.id} className="group flex items-center px-6 py-4 rounded-[1.25rem] bg-muted/10 border border-border/40 hover:bg-muted/20 hover:border-primary/30 transition-all duration-300 gap-4">
                                                        <div className="h-10 w-10 shrink-0 rounded-lg bg-gradient-to-br from-background to-muted border border-border flex items-center justify-center font-black text-xs uppercase text-primary">
                                                            {group.name.split(' ').map(n => n[0]).join('')}
                                                        </div>
                                                        
                                                        <div className="flex-1 min-w-[150px] flex flex-col">
                                                            <span className="text-sm font-black tracking-tight text-foreground">{group.name}</span>
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {group.assignedRoles.slice(0, 2).map(role => (
                                                                    <Badge key={role} variant="outline" className="h-3.5 px-1.5 text-[7px] font-black uppercase border-none bg-muted/50 text-muted-foreground/60">
                                                                        {role}
                                                                    </Badge>
                                                                ))}
                                                                {group.assignedRoles.length > 2 && <span className="text-[7px] font-bold text-muted-foreground/30 ml-1">+{group.assignedRoles.length - 2}</span>}
                                                            </div>
                                                        </div>

                                                        <div className="w-24 flex justify-center">
                                                            <Badge className="bg-muted text-muted-foreground/60 text-[9px] font-black border-none uppercase tracking-widest">{group.employmentType}</Badge>
                                                        </div>

                                                        <div className="w-20 text-center">
                                                            <span className="text-xs font-bold text-foreground/70">{group.contractedHours}h</span>
                                                        </div>
                                                        
                                                        <div className="w-24 flex justify-center">
                                                            <div className="flex flex-col items-center">
                                                                <span className="text-[10px] font-black text-foreground">{group.utilization.toFixed(0)}%</span>
                                                                <div className="h-1 w-12 bg-muted rounded-full mt-1 overflow-hidden">
                                                                    <div 
                                                                        className={cn(
                                                                            "h-full transition-all",
                                                                            group.utilization > 90 ? "bg-red-500" : group.utilization > 70 ? "bg-amber-500" : "bg-emerald-500"
                                                                        )} 
                                                                        style={{ width: `${Math.min(group.utilization, 100)}%` }} 
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="w-20 text-center">
                                                            <span className={cn(
                                                                "text-xs font-black",
                                                                group.avgFatigue > 8 ? "text-red-500" : group.avgFatigue > 5 ? "text-amber-500" : "text-emerald-500"
                                                            )}>
                                                                {group.avgFatigue.toFixed(1)}
                                                            </span>
                                                        </div>
                                                        
                                                        <div className="w-20 flex justify-center">
                                                            <Popover open={hoveredDistId === group.id} onOpenChange={(o) => !o && setHoveredDistId(null)}>
                                                                <PopoverTrigger asChild>
                                                                    <div 
                                                                        className="cursor-help"
                                                                        onMouseEnter={() => setHoveredDistId(group.id)}
                                                                        onMouseLeave={() => setHoveredDistId(null)}
                                                                    >
                                                                        <Badge variant="outline" className="bg-muted text-muted-foreground/60 text-[9px] font-black border-none hover:bg-muted/50 transition-colors">
                                                                            {group.proposals.length}
                                                                        </Badge>
                                                                    </div>
                                                                </PopoverTrigger>
                                                                <PopoverContent 
                                                                    side="top" 
                                                                    align="center"
                                                                    className="w-[240px] p-0 overflow-hidden bg-background border-border shadow-2xl rounded-2xl z-[1000] pointer-events-none"
                                                                    onMouseEnter={() => setHoveredDistId(group.id)}
                                                                >
                                                                    <div className="p-4 space-y-3">
                                                                        <div className="flex items-center justify-between border-b border-border/50 pb-2">
                                                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Shift Distribution</span>
                                                                            <span className="text-[10px] font-black text-primary">{group.proposals.length} Total</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 gap-2">
                                                                            {group.roleDistribution.map(rd => (
                                                                                <div key={rd.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/50">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getRoleColor(rd.name) }} />
                                                                                        <span className="text-[10px] font-bold text-foreground/80">{rd.name}</span>
                                                                                    </div>
                                                                                    <span className="text-[10px] font-black text-primary">{rd.value}</span>
                                                                                </div>
                                                                            ))}
                                                                            {group.roleDistribution.length === 0 && (
                                                                                <div className="col-span-2 text-center py-2 text-[10px] text-muted-foreground/40 italic">No role data</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </PopoverContent>
                                                            </Popover>
                                                        </div>
                                                        
                                                        <div className="w-28 flex flex-col items-center gap-1">
                                                            <div className="flex items-center gap-1">
                                                                <div className={cn("h-1.5 w-1.5 rounded-full", rate === 100 ? "bg-emerald-500" : rate > 0 ? "bg-amber-500" : "bg-red-500")} />
                                                                <span className="text-[10px] font-black text-foreground">{rate.toFixed(0)}% Clear</span>
                                                            </div>
                                                            <span className="text-[7px] font-bold text-muted-foreground/40 uppercase tracking-widest">{passing}/{total} Passing</span>
                                                        </div>
                                                        
                                                        <div className="w-28 text-right">
                                                            <div className="text-sm font-black tracking-tight text-foreground/80">${group.totalCost.toLocaleString('en-AU')}</div>
                                                            <div className="text-[8px] font-bold uppercase text-muted-foreground/20 tracking-tighter">Estimated</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                            {/* Coverage Gaps Card */}
                                            {result.uncoveredAudit && result.uncoveredAudit.length > 0 && (
                                                <div className="p-6 rounded-[2.5rem] bg-amber-500/5 border border-amber-500/20 shadow-xl">
                                                    <div className="flex items-center gap-4 mb-8">
                                                        <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-500">
                                                            <AlertTriangle className="h-6 w-6" />
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-lg font-black tracking-tight text-amber-700 dark:text-amber-400">Coverage Gaps</span>
                                                            <span className="text-[8px] font-black uppercase text-amber-600/40 dark:text-amber-500/40 tracking-widest">{result.uncoveredV8ShiftIds.length} Unstaffed Shifts</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="space-y-4">
                                                        {result.uncoveredAudit.slice(0, 5).map(audit => (
                                                            <div key={audit.shiftId} className="p-4 rounded-2xl bg-muted/30 border border-border/50 space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[8px] font-black uppercase text-muted-foreground/40 tracking-widest">{format(new Date(audit.shiftDate), 'EEE dd MMM')}</span>
                                                                            {audit.roleName && <Badge variant="outline" className="h-3.5 px-1.5 text-[7px] border-border bg-muted text-muted-foreground uppercase font-black">{audit.roleName}</Badge>}
                                                                        </div>
                                                                        <span className="text-xs font-bold text-foreground">{audit.startTime} – {audit.endTime}</span>
                                                                    </div>
                                                                    <Badge variant="outline" className="text-[8px] border-amber-500/20 text-amber-600 dark:text-amber-400">UNRESOLVED</Badge>
                                                                </div>
                                                                <div className="pt-2 border-t border-border/50">
                                                                    <p className="text-[9px] font-black uppercase text-muted-foreground/30 mb-2 tracking-widest">Primary Blockers</p>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {Object.entries(audit.rejectionSummary).map(([reason, count]) => (
                                                                                <Tooltip key={reason}>
                                                                                    <TooltipTrigger asChild>
                                                                                        <div className="px-2 py-1 rounded-md bg-muted/50 text-[9px] text-muted-foreground border border-border cursor-help hover:bg-muted transition-colors">
                                                                                            {reason}: {count} staff
                                                                                        </div>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent className="bg-popover border-border p-3 max-w-xs shadow-2xl">
                                                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{reason}</p>
                                                                                        <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                                                            {reason === 'CAPACITY_CONFLICT' 
                                                                                                ? "The optimizer assigned this staff member to a different shift at the same time to maximize overall roster efficiency."
                                                                                                : reason === 'OPTIMIZER_TRADEOFF'
                                                                                                ? "The solver prioritized other shifts to satisfy complex labor rules or cost targets."
                                                                                                : "Multiple staff were rejected due to compliance rules (rest gaps, weekly hours, or role mismatch)."}
                                                                                        </p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                        ))}
                                                                        {Object.keys(audit.rejectionSummary).length === 0 && (
                                                                            <span className="text-[10px] text-muted-foreground/30 italic">No specific reasons provided by solver</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {result.uncoveredV8ShiftIds.length > 5 && (
                                                            <p className="text-center text-[9px] font-black uppercase text-muted-foreground/20 tracking-widest py-2">
                                                                + {result.uncoveredV8ShiftIds.length - 5} more gaps (See full audit CSV)
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    }
                                </AnimatePresence>
                            </div>
                        </ScrollArea>

                    {/* ACTION DECK: FLOATING FOOTER */}
                    <div className="p-8 flex justify-center bg-gradient-to-t from-background to-transparent pt-12">
                        <div className="bg-muted/80 backdrop-blur-2xl rounded-full p-2 border border-border flex items-center gap-2 shadow-2xl shadow-background/80 ring-1 ring-border/50">
                            {phase === 'idle' && (
                                <Button 
                                    onClick={handleRun}
                                    disabled={!health?.available || filteredShifts.length === 0 || !!validationError}
                                    className="rounded-full px-10 h-14 bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-[10px] gap-3 shadow-lg shadow-primary/30 group"
                                >
                                    <Zap className="h-4 w-4 fill-current group-hover:scale-125 transition-transform" />
                                    Compute Optimal Solution
                                </Button>
                            )}
                            {phase === 'optimizing' && (
                                <Button 
                                    onClick={handleCancel}
                                    variant="destructive"
                                    className="rounded-full px-10 h-14 bg-red-500/20 hover:bg-red-500/30 text-red-500 border border-red-500/20 font-black uppercase tracking-widest text-[10px] gap-3 shadow-lg shadow-red-500/10 group"
                                >
                                    <XCircle className="h-4 w-4" />
                                    Cancel Optimization
                                </Button>
                            )}
                            {['reviewing', 'done'].includes(phase) && (
                                <>
                                    <Button 
                                        onClick={handleRun}
                                        variant="ghost"
                                        className="rounded-full h-14 px-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted font-black uppercase tracking-widest text-[10px]"
                                    >
                                        Re-Optimise
                                    </Button>
                                    <Button 
                                        onClick={handleCommit}
                                        disabled={isCommitting || result?.passing === 0}
                                        className="rounded-full px-10 h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-[10px] gap-3 shadow-lg shadow-emerald-500/30"
                                    >
                                        {isCommitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                                        Apply {result?.passing} Assignments
                                    </Button>
                                </>
                            )}
                            {phase !== 'idle' && phase !== 'done' && (
                                <Button 
                                    onClick={handleClose}
                                    variant="ghost"
                                    className="rounded-full h-14 px-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted font-black uppercase tracking-widest text-[10px]"
                                >
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
                </TooltipProvider>
            </DialogContent>
        </Dialog>
    );
}

const RefreshCw = ({ className }: { className?: string }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="24" 
        height="24" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
    </svg>
);
