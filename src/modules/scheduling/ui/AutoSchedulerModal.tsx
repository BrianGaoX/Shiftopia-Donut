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
    LayoutGrid,
    List,
    ArrowUpDown,
    ChevronUp,
    ChevronDown,
    Download,
    HelpCircle,
    Bookmark,
    X as XIcon,
    Plus,
} from 'lucide-react';
import { 
    PieChart, 
    Pie, 
    Cell, 
    ResponsiveContainer, 
    Tooltip as RechartsTooltip 
} from 'recharts';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
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
    shifts,
    employees,
    onComplete,
}: AutoSchedulerModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [health, setHealth] = useState<OptimizerHealth | null>(null);
    const [phase, setPhase] = useState<PipelinePhase>('idle');
    const [result, setResult] = useState<AutoSchedulerResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [sortField, setSortField] = useState<'name' | 'utilization' | 'shifts' | 'compliance' | 'cost' | 'fatigue'>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [hoveredDistId, setHoveredDistId] = useState<string | null>(null);
    const runAbortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const ESTIMATED_TOTAL_SECONDS = 30; // Matches solver timeout

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
    const defaultStart = useMemo(() => shifts.length > 0 ? [...shifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date))[0].shift_date : '', [shifts]);
    const defaultEnd = useMemo(() => shifts.length > 0 ? [...shifts].sort((a, b) => b.shift_date.localeCompare(a.shift_date))[0].shift_date : '', [shifts]);

    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);

    // Strategy & Tuning state
    const [fatigueWeight, setFatigueWeight] = useState(50);
    const [fairnessWeight, setFairnessWeight] = useState(50);
    const [costWeight, setCostWeight] = useState(50);
    const [coverageWeight, setCoverageWeight] = useState(100);
    const [relaxConstraints, setRelaxConstraints] = useState(false);
    // Fix 5: min rest hours — converted to minutes when sent to the solver
    const [minRestHours, setMinRestHours] = useState(10);

    // Fix 6: Load persisted strategy from localStorage on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem('autoScheduler.strategy');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed.fatigueWeight === 'number') setFatigueWeight(parsed.fatigueWeight);
                if (typeof parsed.fairnessWeight === 'number') setFairnessWeight(parsed.fairnessWeight);
                if (typeof parsed.costWeight === 'number') setCostWeight(parsed.costWeight);
                if (typeof parsed.coverageWeight === 'number') setCoverageWeight(parsed.coverageWeight);
                if (typeof parsed.minRestHours === 'number') setMinRestHours(parsed.minRestHours);
                if (typeof parsed.relaxConstraints === 'boolean') setRelaxConstraints(parsed.relaxConstraints);
            }
        } catch {
            // Corrupted localStorage — silently ignore and keep defaults
        }
    }, []);

    // Fix 6: Persist strategy to localStorage whenever any slider changes
    useEffect(() => {
        try {
            localStorage.setItem('autoScheduler.strategy', JSON.stringify({
                fatigueWeight,
                fairnessWeight,
                costWeight,
                coverageWeight,
                minRestHours,
                relaxConstraints,
            }));
        } catch {
            // Storage write failures are non-fatal
        }
    }, [fatigueWeight, fairnessWeight, costWeight, coverageWeight, minRestHours, relaxConstraints]);

    // Gap 9: Named strategy presets
    type StrategyPreset = {
        fatigueWeight: number;
        fairnessWeight: number;
        costWeight: number;
        coverageWeight: number;
        minRestHours: number;
        relaxConstraints: boolean;
    };
    const BUILTIN_PRESETS: Record<string, StrategyPreset> = useMemo(() => ({
        Balanced:           { fatigueWeight: 50,  fairnessWeight: 50, costWeight: 50,  coverageWeight: 100, minRestHours: 10, relaxConstraints: false },
        'Cost-First':       { fatigueWeight: 30,  fairnessWeight: 30, costWeight: 100, coverageWeight: 80,  minRestHours: 10, relaxConstraints: false },
        'Fatigue-Safe':     { fatigueWeight: 100, fairnessWeight: 80, costWeight: 30,  coverageWeight: 100, minRestHours: 11, relaxConstraints: false },
        'Weekend Coverage': { fatigueWeight: 50,  fairnessWeight: 30, costWeight: 30,  coverageWeight: 150, minRestHours: 10, relaxConstraints: false },
    }), []);
    const [userPresets, setUserPresets] = useState<Record<string, StrategyPreset>>({});
    const [presetSaveOpen, setPresetSaveOpen] = useState(false);
    const [presetNameDraft, setPresetNameDraft] = useState('');

    useEffect(() => {
        try {
            const raw = localStorage.getItem('autoScheduler.presets');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') setUserPresets(parsed);
            }
        } catch {
            // Corrupted presets — ignore
        }
    }, []);
    useEffect(() => {
        try {
            localStorage.setItem('autoScheduler.presets', JSON.stringify(userPresets));
        } catch {
            // non-fatal
        }
    }, [userPresets]);

    const applyPreset = useCallback((p: StrategyPreset) => {
        setFatigueWeight(p.fatigueWeight);
        setFairnessWeight(p.fairnessWeight);
        setCostWeight(p.costWeight);
        setCoverageWeight(p.coverageWeight);
        setMinRestHours(p.minRestHours);
        setRelaxConstraints(p.relaxConstraints);
    }, []);
    const saveCurrentAsPreset = useCallback(() => {
        const name = presetNameDraft.trim();
        if (!name) return;
        setUserPresets(prev => ({
            ...prev,
            [name]: { fatigueWeight, fairnessWeight, costWeight, coverageWeight, minRestHours, relaxConstraints },
        }));
        setPresetNameDraft('');
        setPresetSaveOpen(false);
    }, [presetNameDraft, fatigueWeight, fairnessWeight, costWeight, coverageWeight, minRestHours, relaxConstraints]);
    const deletePreset = useCallback((name: string) => {
        setUserPresets(prev => {
            const next = { ...prev };
            delete next[name];
            return next;
        });
    }, []);
    const activePresetName = useMemo(() => {
        const current: StrategyPreset = { fatigueWeight, fairnessWeight, costWeight, coverageWeight, minRestHours, relaxConstraints };
        const matches = (p: StrategyPreset) =>
            p.fatigueWeight === current.fatigueWeight &&
            p.fairnessWeight === current.fairnessWeight &&
            p.costWeight === current.costWeight &&
            p.coverageWeight === current.coverageWeight &&
            p.minRestHours === current.minRestHours &&
            p.relaxConstraints === current.relaxConstraints;
        const builtin = Object.entries(BUILTIN_PRESETS).find(([, p]) => matches(p));
        if (builtin) return builtin[0];
        const user = Object.entries(userPresets).find(([, p]) => matches(p));
        return user ? user[0] : null;
    }, [fatigueWeight, fairnessWeight, costWeight, coverageWeight, minRestHours, relaxConstraints, userPresets, BUILTIN_PRESETS]);

    const filteredShifts = useMemo(() => {
        if (!startDate || !endDate) return shifts;
        return shifts.filter(s => s.shift_date >= startDate && s.shift_date <= endDate);
    }, [shifts, startDate, endDate]);

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
                signal: ac.signal,
                timeLimitSeconds: ESTIMATED_TOTAL_SECONDS,
                strategy: {
                    fatigue_weight: fatigueWeight,
                    fairness_weight: fairnessWeight,
                    cost_weight: costWeight,
                    coverage_weight: coverageWeight,
                },
                constraints: {
                    relax_constraints: relaxConstraints,
                    // Fix 5: convert minRestHours (user-facing) to minutes for the solver
                    min_rest_minutes: Math.round(minRestHours * 60),
                }
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
    }, [filteredShifts, employees, toast, fatigueWeight, fairnessWeight, costWeight, coverageWeight, relaxConstraints, minRestHours]);

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
        if (!result || !result.uncoveredAudit) return;
        setIsDownloading(true);

        try {
            const csvEscape = (v: string | number) => {
                const s = String(v ?? '');
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };

            const totalUncovered = result.uncoveredV8ShiftIds.length;
            const audited = result.uncoveredAudit.length;

            const lines = [
                'AUTOSCHEDULER AUDIT REPORT',
                `Generated: ${new Date().toLocaleString()}`,
                `Status: ${result.optimizerStatus}`,
                `Total Passing: ${result.passing}`,
                `Total Failing: ${result.failing}`,
                `Uncovered: ${totalUncovered}`,
                `Audited: ${audited}${audited < totalUncovered ? ` (capped — ${totalUncovered - audited} not detailed below)` : ''}`,
                '',
            ];

            if (result.capacityCheck) {
                const cc = result.capacityCheck;
                lines.push('--- CAPACITY PRE-CHECK ---');
                lines.push(`Status: ${cc.sufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}`);
                lines.push(`Total Demand (min): ${cc.totalDemandMinutes}`);
                lines.push(`Total Supply (min): ${cc.totalSupplyMinutes}`);
                lines.push('Date,Shifts,Employees,Demand (min),Supply (min),Deficit (min),Sufficient');
                for (const day of cc.perDay) {
                    lines.push([
                        day.date, day.shiftCount, day.employeeCount, day.demandMinutes,
                        day.supplyMinutes, day.deficitMinutes, day.sufficient ? 'YES' : 'NO'
                    ].map(csvEscape).join(','));
                }
                lines.push('');
            }

            lines.push('--- UNCOVERED SHIFT ANALYSIS ---');
            lines.push('Shift Date,Time,Rejection Summary');

            for (const audit of result.uncoveredAudit) {
                const summary = Object.entries(audit.rejectionSummary)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join(' | ');
                lines.push([
                    audit.shiftDate, `${audit.startTime}-${audit.endTime}`, summary || 'No reasons recorded'
                ].map(csvEscape).join(','));
            }

            lines.push('', '--- EMPLOYEE REJECTION DETAILS ---');
            lines.push('Shift Date,Time,Employee,Status,Violations');

            for (const audit of result.uncoveredAudit) {
                for (const detail of audit.employeeDetails) {
                    const violations = detail.violations.map(v => v.description).join('; ');
                    lines.push([
                        audit.shiftDate, `${audit.startTime}-${audit.endTime}`,
                        detail.employeeName, detail.status, violations
                    ].map(csvEscape).join(','));
                }
            }

            const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Autoscheduler_Audit_Report_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to generate report', err);
        } finally {
            setIsDownloading(false);
        }
    }, [result]);

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
            const levelDist: Record<string, number> = {};
            proposals.forEach(p => {
                const match = p.roleName?.match(/\(L([0-7])\)/i);
                const level = match ? `L${match[1].toUpperCase()}` : 'Other';
                levelDist[level] = (levelDist[level] ?? 0) + 1;
            });

            // Sort by level name (L0, L1, ...)
            const sortedDist = Object.entries(levelDist)
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
                                    className="h-10 bg-background border-border rounded-xl text-xs font-bold focus:ring-primary/20"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Range End</Label>
                                <Input 
                                    type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                    className="h-10 bg-background border-border rounded-xl text-xs font-bold focus:ring-primary/20"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Tuning Sidebar — Fixes 4, 5, 7 + Gap 9 (presets) */}
                    <div className="space-y-6 mt-8">
                        {/* Gap 9: Named strategy presets */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Bookmark className="h-3 w-3 text-muted-foreground/50" />
                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Presets</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPresetSaveOpen(v => !v)}
                                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted/40"
                                    title="Save current settings as a preset"
                                >
                                    <Plus className="h-3 w-3" />
                                    Save
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {Object.entries(BUILTIN_PRESETS).map(([name, p]) => {
                                    const isActive = activePresetName === name;
                                    return (
                                        <button
                                            key={name}
                                            type="button"
                                            onClick={() => applyPreset(p)}
                                            className={cn(
                                                "text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-lg border transition-all",
                                                isActive
                                                    ? "bg-primary/15 border-primary/40 text-primary"
                                                    : "bg-muted/30 border-border/40 text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground"
                                            )}
                                        >
                                            {name}
                                        </button>
                                    );
                                })}
                                {Object.entries(userPresets).map(([name, p]) => {
                                    const isActive = activePresetName === name;
                                    return (
                                        <div
                                            key={name}
                                            className={cn(
                                                "group flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide pl-2.5 pr-1 py-1 rounded-lg border transition-all",
                                                isActive
                                                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                                                    : "bg-muted/30 border-border/40 text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground"
                                            )}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => applyPreset(p)}
                                                className="cursor-pointer"
                                            >
                                                {name}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deletePreset(name)}
                                                className="opacity-50 hover:opacity-100 hover:text-rose-500 transition-opacity p-0.5"
                                                title={`Delete preset "${name}"`}
                                            >
                                                <XIcon className="h-2.5 w-2.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                                {Object.keys(userPresets).length === 0 && (
                                    <span className="text-[10px] text-muted-foreground/40 italic px-1 py-1">
                                        Save your own below
                                    </span>
                                )}
                            </div>
                            {presetSaveOpen && (
                                <div className="flex gap-1.5 pt-1">
                                    <Input
                                        type="text"
                                        value={presetNameDraft}
                                        onChange={e => setPresetNameDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveCurrentAsPreset(); } }}
                                        placeholder="Preset name…"
                                        autoFocus
                                        className="h-7 text-[11px] flex-1"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={saveCurrentAsPreset}
                                        disabled={!presetNameDraft.trim() || presetNameDraft.trim() in BUILTIN_PRESETS}
                                        className="h-7 text-[10px] font-black uppercase tracking-widest px-2.5"
                                    >
                                        Save
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => { setPresetSaveOpen(false); setPresetNameDraft(''); }}
                                        className="h-7 text-[10px] font-black uppercase tracking-widest px-2.5"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Optimization Strategy</div>
                        <div className="space-y-4">

                            {/* Fix 7: Fatigue Bias with tooltip */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <div className="flex items-center gap-1">
                                        <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Fatigue Bias</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-popover border-border p-3 max-w-[220px] shadow-2xl">
                                                <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                    Penalty weight on amber-zone (&gt;20h/wk) and critical-zone (&gt;30h/wk) minutes in the optimizer objective. 0% = penalty halved (solver packs shifts more densely). 50% = default weighting. 100% = penalty doubled (solver spreads fatigue aggressively). Hard compliance limits (R03 daily max, R04 consecutive days) remain enforced at any setting.
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <span className="text-[10px] font-bold text-primary">{fatigueWeight}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="100" value={fatigueWeight}
                                    onChange={e => setFatigueWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>

                            {/* Fix 7: Fairness Bias with tooltip */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <div className="flex items-center gap-1">
                                        <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Fairness Bias</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-popover border-border p-3 max-w-[220px] shadow-2xl">
                                                <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                    Penalty weight on workload deviation from each employee's baseline. 0% = penalty halved (solver may concentrate shifts). 50% = default weighting. 100% = penalty doubled (solver spreads shifts evenly across the team).
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <span className="text-[10px] font-bold text-primary">{fairnessWeight}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="100" value={fairnessWeight}
                                    onChange={e => setFairnessWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>

                            {/* Fix 7: Cost Sensitivity with tooltip */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <div className="flex items-center gap-1">
                                        <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Cost Sensitivity</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-popover border-border p-3 max-w-[220px] shadow-2xl">
                                                <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                    Per-minute cost penalty in the objective. 0% = penalty halved (cost matters less, solver may pick expensive employees). 50% = default weighting. 100% = penalty doubled (solver prefers cheaper rosters). Total spend can still rise if coverage also rises — this controls preference, not budget.
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <span className="text-[10px] font-bold text-primary">{costWeight}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="100" value={costWeight}
                                    onChange={e => setCostWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>

                            {/* Fix 4: Coverage Priority slider (was hardcoded at 100, now user-controlled) */}
                            {/* Fix 7: Coverage Priority with tooltip */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <div className="flex items-center gap-1">
                                        <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Coverage Priority</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-popover border-border p-3 max-w-[220px] shadow-2xl">
                                                <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                    Penalty per uncovered shift. Default 100 = strong pressure to fill every shift. Lower values let the solver leave shifts uncovered in exchange for better cost/fatigue/fairness. Raise above 100 for safety-critical roles.
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <span className="text-[10px] font-bold text-primary">{coverageWeight}</span>
                                </div>
                                <input
                                    type="range" min="50" max="200" step="10" value={coverageWeight}
                                    onChange={e => setCoverageWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>

                            {/* Fix 5: Min Rest Hours numeric input */}
                            <div className="space-y-2 pt-2">
                                <div className="flex items-center gap-1 px-1">
                                    <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Min Rest Hours</Label>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-popover border-border p-3 max-w-[220px] shadow-2xl">
                                            <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                Minimum hours of rest required between consecutive shifts for each employee. EBA standard is 10h. Reducing below 10h requires a formal exemption.
                                            </p>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <Input
                                    type="number"
                                    min={3} max={15} step={0.5}
                                    value={minRestHours}
                                    onChange={e => setMinRestHours(parseFloat(e.target.value) || 10)}
                                    className="h-8 bg-background border-border rounded-xl text-xs font-bold focus:ring-primary/20"
                                />
                                {minRestHours < 10 && (
                                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                                        <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide leading-tight">
                                            Below EBA minimum — use only with formal exemption
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Fix 7: Relax Blockers with tooltip */}
                            <div className="pt-2 flex items-center justify-between px-1">
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1">
                                        <Label className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Relax Blockers</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-popover border-border p-3 max-w-[220px] shadow-2xl">
                                                <p className="text-[11px] text-popover-foreground leading-relaxed">
                                                    When enabled, the solver may violate hard overlap/rest constraints at a $10M-per-violation penalty rather than rejecting infeasible regions. Use only after the optimizer returns INFEASIBLE.
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <span className="text-[7px] text-muted-foreground/40 uppercase font-bold">Soften Overlaps</span>
                                </div>
                                <button
                                    onClick={() => setRelaxConstraints(!relaxConstraints)}
                                    className={cn(
                                        "h-5 w-9 rounded-full transition-all relative flex items-center px-1",
                                        relaxConstraints ? "bg-emerald-500" : "bg-muted"
                                    )}
                                >
                                    <div className={cn(
                                        "h-3 w-3 rounded-full bg-white transition-all shadow-sm",
                                        relaxConstraints ? "ml-4" : "ml-0"
                                    )} />
                                </button>
                            </div>

                        </div>
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
                            <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[8px] font-black text-primary/60 uppercase">Fairness</span>
                                    <span className="text-lg font-black text-primary">{totals.fairness.toFixed(0)}%</span>
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
                                    {filteredShifts.length} Shifts · {employees.length} Staff
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {result && (
                                <div className="flex items-center bg-muted rounded-lg p-1 mr-2 border border-border/50">
                                    <button 
                                        onClick={() => setViewMode('grid')}
                                        className={cn(
                                            "p-1.5 rounded-md transition-all",
                                            viewMode === 'grid' ? "bg-background text-primary shadow-sm" : "text-muted-foreground/40 hover:text-muted-foreground"
                                        )}
                                    >
                                        <LayoutGrid className="h-3.5 w-3.5" />
                                    </button>
                                    <button 
                                        onClick={() => setViewMode('list')}
                                        className={cn(
                                            "p-1.5 rounded-md transition-all",
                                            viewMode === 'list' ? "bg-background text-primary shadow-sm" : "text-muted-foreground/40 hover:text-muted-foreground"
                                        )}
                                    >
                                        <List className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
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
                                        
                                        {/* Result Stats Grid — Fix 1: replaced "Success Rate" (compliance pass-rate)
                                            with "Coverage" (assigned / total shifts asked). Added "Compliance Pass-Rate"
                                            as a 5th tile; used grid-cols-5 with tighter padding so all fit at xl width. */}
                                        <div className="grid grid-cols-5 gap-3">
                                            <div className="p-5 rounded-[2rem] bg-muted/20 border border-border flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground/50 tracking-widest mb-1">Total Cost</span>
                                                <span className="text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tighter">${totals.cost.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</span>
                                            </div>
                                            <div className="p-5 rounded-[2rem] bg-muted/20 border border-border flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground/50 tracking-widest mb-1">Avg Fatigue</span>
                                                <span className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tighter">{totals.fatigue.toFixed(1)}</span>
                                                <span className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-widest">p95 {totals.p95Fatigue.toFixed(1)}</span>
                                            </div>
                                            <div className="p-5 rounded-[2rem] bg-muted/20 border border-border flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground/50 tracking-widest mb-1">Uncovered</span>
                                                <span className="text-2xl font-black text-muted-foreground/40 tracking-tighter">{result.uncoveredV8ShiftIds.length}</span>
                                            </div>
                                            {/* Fix 1: Coverage = (assigned / total) — primary signal for how many shifts got staffed */}
                                            <div className="p-5 rounded-[2rem] bg-muted/20 border border-border flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground/50 tracking-widest mb-1">Coverage</span>
                                                {(() => {
                                                    const totalShifts = result.proposals.length + result.uncoveredV8ShiftIds.length;
                                                    const covered = result.proposals.length;
                                                    const pct = totalShifts > 0 ? Math.round((covered / totalShifts) * 100) : 0;
                                                    return <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tighter">{pct}%</span>;
                                                })()}
                                            </div>
                                            {/* Fix 1: Compliance pass-rate retained as separate tile — still useful but no longer the headline */}
                                            <div className="p-5 rounded-[2rem] bg-muted/20 border border-border flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-muted-foreground/50 tracking-widest mb-1">Compliance</span>
                                                <span className="text-2xl font-black text-violet-600 dark:text-violet-400 tracking-tighter">{((result.passing / result.totalProposals) * 100 || 0).toFixed(0)}%</span>
                                                <span className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-widest">Pass Rate</span>
                                            </div>
                                        </div>

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
                                                    <div className="flex items-baseline justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Objective Breakdown</span>
                                                        <span className="text-[10px] font-bold text-muted-foreground/40 tracking-wide">Total: {Math.round(total).toLocaleString()}</span>
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
                                                                <span className="text-[10px] font-black text-foreground/90 ml-auto tabular-nums">{((Math.abs(v) / total) * 100).toFixed(0)}%</span>
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
                                        <AnimatePresence mode="wait">
                                            {viewMode === 'grid' ? (
                                                <div 
                                                    key="grid"
                                                    className="grid grid-cols-1 lg:grid-cols-2 gap-6"
                                                >
                                            {employeeGroups.map(group => (
                                                <div key={group.id} className="group p-8 rounded-[2.5rem] bg-muted/10 border border-border hover:bg-muted/20 hover:border-primary/40 transition-all duration-500 shadow-xl flex flex-col">
                                                    <div className="flex items-start justify-between mb-8">
                                                        <div className="flex items-start gap-5">
                                                            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-background to-muted border border-border flex items-center justify-center font-black text-lg uppercase text-primary shadow-lg group-hover:scale-110 transition-transform duration-500">
                                                                {group.name.split(' ').map(n => n[0]).join('')}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-xl font-black tracking-tight text-foreground">{group.name}</span>
                                                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                                                    <Badge className="bg-primary text-white text-[9px] font-black uppercase tracking-widest border-none shadow-lg shadow-primary/20">{group.employmentType}</Badge>
                                                                    <Badge variant="outline" className="text-muted-foreground/60 text-[9px] font-black uppercase tracking-widest border-border bg-muted/30">{group.contractedHours}h Contract</Badge>
                                                                    <Popover open={hoveredDistId === group.id} onOpenChange={(o) => !o && setHoveredDistId(null)}>
                                                                        <PopoverTrigger asChild>
                                                                            <div 
                                                                                className="cursor-help"
                                                                                onMouseEnter={() => setHoveredDistId(group.id)}
                                                                                onMouseLeave={() => setHoveredDistId(null)}
                                                                            >
                                                                                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[8px] font-black uppercase tracking-widest border-none">{group.proposals.length} SHIFTS</Badge>
                                                                            </div>
                                                                        </PopoverTrigger>
                                                                        <PopoverContent 
                                                                            side="top" 
                                                                            align="center"
                                                                            className="w-[240px] p-0 overflow-hidden bg-background border-border shadow-2xl rounded-2xl z-[1000] pointer-events-none"
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
                                                                                                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LEVEL_COLORS[rd.name] || LEVEL_COLORS.default }} />
                                                                                                <span className="text-[10px] font-bold text-foreground/80">{rd.name}</span>
                                                                                            </div>
                                                                                            <span className="text-[10px] font-black text-primary">{rd.value}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        </PopoverContent>
                                                                    </Popover>
                                                                    <div className="flex items-center gap-1 ml-2">
                                                                        <Activity className="h-3 w-3 text-emerald-500" />
                                                                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Fatigue: </span>
                                                                        <span className={cn(
                                                                            "text-[10px] font-black",
                                                                            group.avgFatigue > 8 ? "text-red-500" : group.avgFatigue > 5 ? "text-amber-500" : "text-emerald-500"
                                                                        )}>{group.avgFatigue.toFixed(1)}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1 mt-2">
                                                                    {group.assignedRoles.map(role => (
                                                                        <Badge key={role} variant="outline" className="h-4 px-2 text-[8px] font-black uppercase border-none bg-primary/5 text-primary/60">
                                                                            {role}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-2xl font-black tracking-tight text-foreground/80">${group.totalCost.toLocaleString('en-AU')}</div>
                                                            <div className="text-[10px] font-black uppercase text-muted-foreground/30 tracking-widest mt-1">Est. Cost</div>
                                                        </div>
                                                    </div>

                                                    {/* Role Distribution Chart (Improved Layout) */}
                                                    <div className="flex items-center gap-10 mb-8 p-8 rounded-[2.5rem] bg-muted/30 border border-border shadow-inner">
                                                        <div className="h-40 w-40 shrink-0 relative">
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <PieChart>
                                                                    <Pie
                                                                        data={group.roleDistribution}
                                                                        innerRadius={45}
                                                                        outerRadius={65}
                                                                        paddingAngle={4}
                                                                        dataKey="value"
                                                                        stroke="currentColor"
                                                                        className="text-border"
                                                                        strokeWidth={1}
                                                                    >
                                                                        {group.roleDistribution.map((entry, index) => (
                                                                            <Cell key={`cell-${index}`} fill={LEVEL_COLORS[entry.name] || LEVEL_COLORS.default} />
                                                                        ))}
                                                                    </Pie>
                                                                    <RechartsTooltip 
                                                                        contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: '10px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                                                                        itemStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 'bold' }}
                                                                        cursor={{ fill: 'hsl(var(--muted))' }}
                                                                    />
                                                                </PieChart>
                                                            </ResponsiveContainer>
                                                            {/* Center Stat */}
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                                                <span className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-widest leading-none">Total</span>
                                                                <span className="text-sm font-black text-foreground/80">{group.proposals.length}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 flex flex-col gap-2 max-h-32 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted-foreground/10">
                                                            {group.roleDistribution.map((rd, idx) => (
                                                                <div key={rd.name} className="flex items-center justify-between group/item py-0.5">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <div className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)] dark:shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: LEVEL_COLORS[rd.name] || LEVEL_COLORS.default }} />
                                                                        <span className="text-[11px] font-bold text-muted-foreground group-hover/item:text-foreground transition-colors truncate max-w-[120px]">{rd.name}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[10px] font-black text-muted-foreground/60">{rd.value}</span>
                                                                        <span className="text-[8px] font-medium text-muted-foreground/20">({((rd.value / group.proposals.length) * 100).toFixed(0)}%)</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="space-y-3">
                                                        {group.proposals.map(p => (
                                                            <div key={p.shiftId} className="flex flex-col p-3 rounded-2xl bg-muted/20 border border-border/50 gap-2">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={cn(
                                                                            "h-6 w-6 rounded-lg flex items-center justify-center",
                                                                            p.complianceStatus === 'PASS' ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-red-500/20 text-red-600 dark:text-red-400"
                                                                        )}>
                                                                            {p.complianceStatus === 'PASS' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[8px] font-black uppercase text-muted-foreground/40 tracking-widest">{format(new Date(p.shiftDate), 'EEE dd MMM')}</span>
                                                                                {p.roleName && <Badge variant="outline" className="h-3.5 px-1.5 text-[7px] border-border bg-muted/50 text-muted-foreground uppercase font-black">{p.roleName}</Badge>}
                                                                            </div>
                                                                            <span className="text-xs font-bold text-foreground">{p.startTime} – {p.endTime}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                {p.violations.length > 0 && (
                                                                    <div className="px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1">
                                                                        {p.violations.map((v, i) => (
                                                                            <div key={i} className="flex items-start gap-2 text-[10px] text-red-600 dark:text-red-400/80 leading-tight">
                                                                                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                                                                <span>{v.description}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                                </div>
                                            ) : (
                                                <div 
                                                    key="list"
                                                    className="space-y-2"
                                                >
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
                                                                                                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LEVEL_COLORS[rd.name] || LEVEL_COLORS.default }} />
                                                                                                <span className="text-[10px] font-bold text-foreground/80">{rd.name}</span>
                                                                                            </div>
                                                                                            <span className="text-[10px] font-black text-primary">{rd.value}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                    {group.roleDistribution.length === 0 && (
                                                                                        <div className="col-span-2 text-center py-2 text-[10px] text-muted-foreground/40 italic">No level data</div>
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
                                            )}
                                        </AnimatePresence>

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
                                    disabled={!health?.available || filteredShifts.length === 0}
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
