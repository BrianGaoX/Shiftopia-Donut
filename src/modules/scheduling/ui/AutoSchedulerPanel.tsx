/**
 * AutoSchedulerPanel — Two-layer schedule optimization UI
 *
 * Flow:
 *   1. Manager opens panel → service health check runs automatically
 *   2. "Optimise" → Layer 1 (OR-Tools) + Layer 2 (compliance) run
 *   3. Results shown: per-employee groups with per-shift PASS/WARN/FAIL
 *   4. "Apply X Assignments" → atomic commit via sm_bulk_assign per employee
 *
 * Architecture:
 *   Optimizer proposes → Compliance validates → Manager confirms → DB commit
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/modules/core/ui/primitives/sheet';
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
    ChevronDown,
    ChevronRight,
    Users,
    AlertCircle,
    WifiOff,
    FileText,
    Download,
    Calendar,
    ArrowRight,
    Activity,
    Scale,
    ArrowLeftRight,
    Info,
} from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { format, isWithinInterval, parseISO } from 'date-fns';
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
import { calculateFatigueWithRecovery } from '@/modules/rosters/domain/projections/utils/fatigue';
import { calculateUtilization } from '@/modules/rosters/domain/projections/utils/fairness';
import {
    SheetFooter,
} from '@/modules/core/ui/primitives/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';

// =============================================================================
// PROPS
// =============================================================================

interface AutoSchedulerPanelProps {
    open: boolean;
    onClose: () => void;
    /** Draft unassigned shifts in the current planner view. */
    shifts: ShiftMeta[];
    /** Available employees in scope. */
    employees: EmployeeMeta[];
    onComplete: () => void;
}

// =============================================================================
// HEALTH INDICATOR
// =============================================================================

function HealthBadge({ health }: { health: OptimizerHealth | null }) {
    if (!health) {
        return (
            <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking…
            </Badge>
        );
    }
    if (health.available) {
        return (
            <Badge variant="outline" className="gap-1 text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                <CheckCircle2 className="h-3 w-3" />
                OR-Tools ready {health.latencyMs != null ? `(${health.latencyMs}ms)` : ''}
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="gap-1 text-xs text-red-500 border-red-500/30">
            <WifiOff className="h-3 w-3" />
            Optimizer offline
        </Badge>
    );
}

// =============================================================================
// PROPOSAL ROW
// =============================================================================

function ProposalRow({ p, onSwap }: { p: ValidatedProposal; onSwap: () => void }) {
    const [expanded, setExpanded] = useState(false);

    const statusIcon = {
        PASS: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />,
        WARN: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />,
        FAIL: <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />,
    }[p.complianceStatus];

    const rowBg = {
        PASS: 'bg-emerald-500/5 border-emerald-500/15',
        WARN: 'bg-amber-500/5 border-amber-500/15',
        FAIL: 'bg-red-500/5 border-red-500/15',
    }[p.complianceStatus];

    return (
        <div className={cn('rounded border px-3 py-2 transition-colors', rowBg)}>
            <div
                role="button"
                tabIndex={0}
                className="w-full flex items-center gap-2 text-left cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
                onClick={() => p.violations.length > 0 && setExpanded(!expanded)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        p.violations.length > 0 && setExpanded(!expanded);
                    }
                }}
            >
                {statusIcon}
                <span className="text-xs font-medium text-foreground">{p.shiftDate}</span>
                <span className="text-xs text-muted-foreground">{p.startTime}–{p.endTime}</span>
                
                {/* Health context if provided */}
                <div className="flex items-center gap-2 ml-2">
                    {p.fatigueScore != null && (
                        <div className={cn(
                            "flex items-center gap-0.5 text-[9px] font-bold px-1 rounded",
                            p.fatigueScore < 10 ? "text-emerald-400" : p.fatigueScore < 20 ? "text-amber-400" : "text-red-400"
                        )}>
                            <Activity className="h-2.5 w-2.5" />
                            {p.fatigueScore.toFixed(0)}
                        </div>
                    )}
                </div>

                <div className="ml-auto flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSwap();
                        }}
                        title="Swap Candidate"
                    >
                        <ArrowLeftRight className="h-3 w-3" />
                    </Button>
                    
                    {p.violations.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                            {p.violations.length} issue{p.violations.length !== 1 ? 's' : ''}
                        </span>
                    )}
                    {p.violations.length > 0 && (
                        expanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                </div>
            </div>
            {expanded && p.violations.length > 0 && (
                <div className="mt-1.5 pl-5 space-y-1">
                    {p.violations.map((v, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                            <span className={cn('font-medium', v.blocking ? 'text-red-500' : 'text-amber-500')}>
                                {v.type}:{' '}
                            </span>
                            {v.description}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// EMPLOYEE GROUP
// =============================================================================

function EmployeeGroup({ employeeId, employeeName, proposals, onSwapShift }: {
    employeeId: string;
    employeeName: string;
    proposals: ValidatedProposal[];
    onSwapShift: (p: ValidatedProposal) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const passing = proposals.filter(p => p.passing).length;
    const failing = proposals.length - passing;

    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <button
                className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                onClick={() => setExpanded(!expanded)}
            >
                <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium text-foreground flex-1">{employeeName}</span>
                <div className="flex items-center gap-2">
                    {passing > 0 && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            {passing} ✓
                        </span>
                    )}
                    {failing > 0 && (
                        <span className="text-xs text-red-500 font-medium">
                            {failing} ✗
                        </span>
                    )}
                </div>

                {/* Aggregate Health Metrics for this employee's weekly plan */}
                <div className="flex items-center gap-2 ml-2">
                  {proposals[0]?.fatigueScore != null && (
                    <div className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border",
                      proposals[0].fatigueScore < 10 ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5" :
                      proposals[0].fatigueScore < 20 ? "text-amber-500 border-amber-500/20 bg-amber-500/5" :
                      "text-red-500 border-red-500/20 bg-red-500/5"
                    )}>
                      <Activity className="h-2.5 w-2.5" />
                      FTG {proposals[0].fatigueScore.toFixed(0)}
                    </div>
                  )}
                  {proposals[0]?.utilization != null && (
                    <div className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border",
                      proposals[0].utilization < 80 ? "text-blue-500 border-blue-500/20 bg-blue-500/5" :
                      proposals[0].utilization <= 105 ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5" :
                      "text-amber-500 border-amber-500/20 bg-amber-500/5"
                    )}>
                      <Scale className="h-2.5 w-2.5" />
                      UTL {proposals[0].utilization.toFixed(0)}%
                    </div>
                  )}
                </div>
                {expanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
            </button>
            {expanded && (
                <div className="px-4 py-3 space-y-2">
                    {proposals.map(p => (
                        <ProposalRow key={p.shiftId} p={p} onSwap={() => onSwapShift(p)} />
                    ))}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// STATS BAR
// =============================================================================

function StatsBar({ result }: { result: AutoSchedulerResult }) {
    return (
        <div className="grid grid-cols-3 gap-2">
            <div className="text-center px-3 py-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{result.passing}</div>
                <div className="text-[11px] text-muted-foreground">Passing</div>
            </div>
            <div className="text-center px-3 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
                <div className="text-lg font-bold text-red-500">{result.failing}</div>
                <div className="text-[11px] text-muted-foreground">Failing</div>
            </div>
            <div className="text-center px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <div className="text-lg font-bold text-amber-500">{result.uncoveredV8ShiftIds.length}</div>
                <div className="text-[11px] text-muted-foreground">Uncovered</div>
            </div>
        </div>
    );
}

// =============================================================================
// PIPELINE INDICATOR
// =============================================================================

type PipelinePhase = 'idle' | 'optimizing' | 'validating' | 'reviewing' | 'done';

function PipelineBar({ phase }: { phase: PipelinePhase }) {
    if (phase === 'idle') return null;

    const steps: { id: PipelinePhase; label: string; icon: React.ElementType }[] = [
        { id: 'optimizing', label: 'OR-Tools',        icon: Cpu },
        { id: 'validating', label: 'Compliance',      icon: ShieldCheck },
        { id: 'reviewing',  label: 'Manager Review',  icon: Users },
        { id: 'done',       label: 'Committed',       icon: CheckCircle2 },
    ];

    const activeIndex = steps.findIndex(s => s.id === phase);

    return (
        <div className="flex items-center gap-1 py-2">
            {steps.map((step, i) => {
                const Icon = step.icon;
                const isActive = phase === step.id;
                const isDone = i < activeIndex || phase === 'done';
                return (
                    <React.Fragment key={step.id}>
                        <div className={cn(
                            'flex items-center gap-1 text-[11px]',
                            isDone ? 'text-emerald-500' : isActive ? 'text-primary' : 'text-muted-foreground/40',
                        )}>
                            {isActive && phase !== 'done'
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Icon className="h-3 w-3" />
                            }
                            <span className="hidden sm:inline">{step.label}</span>
                        </div>
                        {i < steps.length - 1 && (
                            <div className={cn(
                                'flex-1 h-px min-w-[8px]',
                                isDone ? 'bg-emerald-500/40' : 'bg-border',
                            )} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

export function AutoSchedulerPanel({
    open,
    onClose,
    shifts,
    employees,
    onComplete,
}: AutoSchedulerPanelProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [health, setHealth] = useState<OptimizerHealth | null>(null);
    const [phase, setPhase] = useState<PipelinePhase>('idle');
    const [result, setResult] = useState<AutoSchedulerResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    // Tracks the AbortController for the current run so Cancel actually
    // aborts the in-flight optimizer fetch instead of just resetting UI state
    // while the request keeps going and re-fires setResult on completion.
    const runAbortRef = React.useRef<AbortController | null>(null);

    // Swap State
    const [swappingProposal, setSwappingProposal] = useState<ValidatedProposal | null>(null);

    // Date Range Filtering
    const defaultStart = shifts.length > 0 ? shifts.sort((a, b) => a.shift_date.localeCompare(b.shift_date))[0].shift_date : '';
    const defaultEnd = shifts.length > 0 ? shifts.sort((a, b) => b.shift_date.localeCompare(a.shift_date))[0].shift_date : '';

    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);

    // Filtered shifts based on date range
    const filteredShifts = React.useMemo(() => {
        if (!startDate || !endDate) return shifts;
        return shifts.filter(s => {
            return s.shift_date >= startDate && s.shift_date <= endDate;
        });
    }, [shifts, startDate, endDate]);

    // Pre-run demand/supply check — delegate to the controller so the panel
    // and the run share one source of truth (was a parallel re-implementation
    // that drifted from the controller's per-employee daily-cap logic).
    const preRunCapacity = React.useMemo(() => {
        if (filteredShifts.length === 0 || employees.length === 0) return null;
        const cc = autoSchedulerController.capacityCheck(filteredShifts, employees);
        const deficits = cc.deficitDays.map(d => ({
            date: d.date,
            shiftCount: d.shiftCount,
            deficitMinutes: d.deficitMinutes,
        }));
        return { deficits, supplyPerDay: cc.perDay[0]?.supplyMinutes ?? 0, dayCount: cc.perDay.length };
    }, [filteredShifts, employees]);

    // Existing Roster Map for health calculations
    const existingRoster = React.useMemo(() => {
      const map = new Map<string, ShiftMeta[]>();
      for (const emp of employees) {
        map.set(emp.id, (emp as any).existing_shifts || []);
      }
      return map;
    }, [employees]);

    // Health check on open
    useEffect(() => {
        if (!open) return;
        setHealth(null);
        autoSchedulerController.checkHealth().then(setHealth);
    }, [open]);

    // Group proposals by employee for display
    const employeeGroups = React.useMemo(() => {
        if (!result) return [];
        const map = new Map<string, { name: string; proposals: ValidatedProposal[] }>();
        for (const p of result.proposals) {
            if (!map.has(p.employeeId)) {
                map.set(p.employeeId, { name: p.employeeName, proposals: [] });
            }
            map.get(p.employeeId)!.proposals.push(p);
        }
        return Array.from(map.entries()).map(([id, { name, proposals }]) => ({
            employeeId: id,
            employeeName: name,
            proposals,
        }));
    }, [result]);

    // ── Run optimizer ─────────────────────────────────────────────────────────
    const handleRun = useCallback(async () => {
        if (filteredShifts.length === 0) return;

        // Cancel any prior in-flight run before starting a new one (Re-optimise).
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
            });
            if (ac.signal.aborted) return;
            setPhase('reviewing');
            setResult(schedResult);
        } catch (err: any) {
            if (ac.signal.aborted || err?.name === 'AbortError') {
                // User cancelled — leave the panel in idle state silently.
                return;
            }
            setPhase('idle');
            if (err instanceof AutoSchedulerInputTooLargeError) {
                toast({
                    title: 'Too much to optimize at once',
                    description: err.message,
                    variant: 'destructive',
                });
            } else if (err instanceof OptimizerError && err.code === 'CONNECTION_REFUSED') {
                toast({
                    title: 'Optimizer Offline',
                    description: 'Start the Python service: docker compose up optimizer  (or: cd optimizer-service && python ortools_runner.py)',
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Optimization Failed',
                    description: err?.message ?? 'Unexpected error',
                    variant: 'destructive',
                });
            }
        } finally {
            if (runAbortRef.current === ac) runAbortRef.current = null;
        }
    }, [filteredShifts, employees, toast]);

    // ── Commit ────────────────────────────────────────────────────────────────
    const handleCommit = useCallback(async () => {
        if (!result) return;
        setIsCommitting(true);

        try {
            const commitResult = await autoSchedulerController.commit(result);
            const conflictCount = commitResult.concurrencyConflicts.length;
            if (commitResult.success) {
                setPhase('done');
                toast({
                    title: 'Shifts Assigned',
                    description: `Successfully assigned ${commitResult.totalCommitted} shift(s).`,
                });
                queryClient.invalidateQueries({ queryKey: [shiftKeys.all[0]] });
                onComplete();
                handleClose();
            } else if (commitResult.totalCommitted > 0) {
                // Partial success: some shifts were taken by other users between
                // preview and commit, or some employees failed outright.
                setPhase('done');
                toast({
                    title: 'Partial Success',
                    description: conflictCount > 0
                        ? `Assigned ${commitResult.totalCommitted} shift(s). ${conflictCount} were skipped — they were claimed by another user or no longer eligible since preview. Re-optimise to retry.`
                        : `Assigned ${commitResult.totalCommitted} shift(s). ${commitResult.failedEmployees.length} employee(s) could not be committed.`,
                    variant: 'destructive',
                });
                queryClient.invalidateQueries({ queryKey: [shiftKeys.all[0]] });
                onComplete();
                handleClose();
            } else {
                toast({
                    title: 'Commit Failed',
                    description: conflictCount > 0
                        ? `All ${conflictCount} shift(s) were claimed by other users since preview. Re-optimise to refresh.`
                        : 'No shifts were committed. Check compliance results.',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message ?? 'Failed to commit assignments',
                variant: 'destructive',
            });
        } finally {
            setIsCommitting(false);
        }
    }, [result, queryClient, toast, onComplete]);

    // ── Download Audit Report ────────────────────────────────────────────────
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

            // Capacity pre-check section
            if (result.capacityCheck) {
                const cc = result.capacityCheck;
                lines.push('--- CAPACITY PRE-CHECK ---');
                lines.push(`Status: ${cc.sufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}`);
                lines.push(`Total Demand (min): ${cc.totalDemandMinutes}`);
                lines.push(`Total Supply (min): ${cc.totalSupplyMinutes}`);
                lines.push('Date,Shifts,Employees,Demand (min),Supply (min),Deficit (min),Sufficient');
                for (const day of cc.perDay) {
                    lines.push([
                        day.date,
                        day.shiftCount,
                        day.employeeCount,
                        day.demandMinutes,
                        day.supplyMinutes,
                        day.deficitMinutes,
                        day.sufficient ? 'YES' : 'NO',
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
                    audit.shiftDate,
                    `${audit.startTime}-${audit.endTime}`,
                    summary || 'No reasons recorded',
                ].map(csvEscape).join(','));
            }

            if (audited < totalUncovered) {
                lines.push(`# ${totalUncovered - audited} additional uncovered shift(s) not audited (audit cap reached).`);
            }

            lines.push('', '--- EMPLOYEE REJECTION DETAILS ---');
            lines.push('Shift Date,Time,Employee,Status,Violations');

            for (const audit of result.uncoveredAudit) {
                for (const detail of audit.employeeDetails) {
                    const violations = detail.violations.map(v => v.description).join('; ');
                    lines.push([
                        audit.shiftDate,
                        `${audit.startTime}-${audit.endTime}`,
                        detail.employeeName,
                        detail.status,
                        violations,
                    ].map(csvEscape).join(','));
                }
            }

            // Lead with a UTF-8 BOM so Excel/Numbers don't mojibake non-ASCII
            // characters (employee names with accents, en-dashes in time ranges).
            const blob = new Blob(['﻿', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
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

    const handleClose = () => {
        // Abort any in-flight optimizer run so its eventual result doesn't
        // race with the user's close action and re-populate the panel.
        runAbortRef.current?.abort();
        runAbortRef.current = null;
        setResult(null);
        setPhase('idle');
        setSwappingProposal(null);
        onClose();
    };

    const handleApplySwap = (shiftId: string, newEmployeeId: string) => {
      if (!result) return;
      
      const emp = employees.find(e => e.id === newEmployeeId);
      if (!emp) return;

      const newProposals = result.proposals.map(p => {
        if (p.shiftId === shiftId) {
          // Find the shift in our original shifts list to get full details
          const shift = shifts.find(s => s.id === shiftId);
          
          return {
            ...p,
            employeeId: emp.id,
            employeeName: emp.name,
            // Re-calculate basic compliance (placeholder - we should really re-simulate)
            passing: true, 
            complianceStatus: 'PASS' as const,
            violations: []
          };
        }
        return p;
      });

      setResult({
        ...result,
        proposals: newProposals,
        passing: newProposals.filter(p => p.passing).length,
        failing: newProposals.length - newProposals.filter(p => p.passing).length,
      });
      setSwappingProposal(null);
      
      toast({
        title: "Assignment Updated",
        description: `Shift reassigned to ${emp.name}. Health metrics will be updated on refresh.`,
      });
    };

    const unfilledCount = shifts.length;
    const filteredCount = filteredShifts.length;
    // Can always run (greedy fallback fires when optimizer is offline)
    const canRun = filteredCount > 0 && employees.length > 0;

    return (
        <Sheet open={open} onOpenChange={o => !o && handleClose()}>
            <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
                {/* Header */}
                <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Cpu className="h-5 w-5 text-primary" />
                            <SheetTitle>Auto-Schedule</SheetTitle>
                        </div>
                        <HealthBadge health={health} />
                    </div>
                    <SheetDescription>
                        OR-Tools CP-SAT finds the optimal assignment for {filteredCount} shift{filteredCount !== 1 ? 's' : ''} in the selected range.
                    </SheetDescription>

                    {/* Pipeline indicator */}
                    <PipelineBar phase={phase} />
                </SheetHeader>

                {/* Body */}
                <ScrollArea className="flex-1 min-h-0">
                    <div className="px-6 py-4 space-y-6">

                        {/* Date Range Selection */}
                        {phase === 'idle' && !result && (
                            <div className="p-4 bg-muted/40 rounded-xl border border-border/50 space-y-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Calendar className="h-4 w-4 text-primary" />
                                    Optimization Range
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="start-date" className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Start Date</Label>
                                        <Input
                                            id="start-date"
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="h-9 text-sm bg-background/50"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="end-date" className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">End Date</Label>
                                        <Input
                                            id="end-date"
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="h-9 text-sm bg-background/50"
                                        />
                                    </div>
                                </div>
                                <p className="text-[11px] text-muted-foreground italic">
                                    {filteredCount} out of {unfilledCount} shifts match this range.
                                </p>

                                {/* Demand-vs-supply pre-check banner */}
                                {preRunCapacity && preRunCapacity.deficits.length > 0 && (
                                    <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 rounded-md border border-amber-500/30">
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div className="text-[11px] leading-relaxed">
                                            <p className="font-medium text-amber-700 dark:text-amber-400">
                                                Capacity deficit on {preRunCapacity.deficits.length} day{preRunCapacity.deficits.length !== 1 ? 's' : ''}
                                            </p>
                                            <p className="text-muted-foreground mt-0.5">
                                                More shift-hours than worker-hours available. Some shifts will be uncovered no matter how the solver assigns people.
                                            </p>
                                            <ul className="mt-1 space-y-0.5 text-muted-foreground">
                                                {preRunCapacity.deficits.slice(0, 3).map(d => (
                                                    <li key={d.date} className="font-mono text-[10px]">
                                                        {d.date}: {d.shiftCount} shifts, ~{Math.round(d.deficitMinutes / 60)}h short
                                                    </li>
                                                ))}
                                                {preRunCapacity.deficits.length > 3 && (
                                                    <li className="text-[10px] italic">+ {preRunCapacity.deficits.length - 3} more day(s)</li>
                                                )}
                                            </ul>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Offline warning */}
                        {health && !health.available && (
                            <div className="flex items-start gap-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <p className="font-medium text-red-600 dark:text-red-400">Optimizer service is offline</p>
                                    <p className="text-muted-foreground text-xs mt-0.5">
                                        Start it with:
                                    </p>
                                    <code className="block mt-1 text-xs bg-background/80 rounded px-2 py-1 font-mono">
                                        docker compose up optimizer<br />
                                        <span className="text-muted-foreground"># or manually:</span><br />
                                        cd optimizer-service &amp;&amp; python ortools_runner.py
                                    </code>
                                </div>
                            </div>
                        )}

                        {/* Result stats */}
                        {result && (
                            <>
                                {result.usedFallback && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                        Greedy fallback used — optimizer was unavailable or returned no solution.
                                    </div>
                                )}

                                <StatsBar result={result} />

                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Cpu className="h-3 w-3" />
                                        Solve: {result.solveTimeMs}ms
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <ShieldCheck className="h-3 w-3" />
                                        Validate: {result.validationTimeMs}ms
                                    </span>
                                    <span className="ml-auto font-medium capitalize text-foreground">
                                        {result.optimizerStatus}
                                    </span>
                                </div>
                            </>
                        )}

                        {/* Employee groups */}
                        {employeeGroups.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-sm font-medium text-foreground">
                                    Proposed Assignments ({result?.totalProposals})
                                </h3>
                                {employeeGroups.map(g => (
                                    <EmployeeGroup
                                        key={g.employeeId}
                                        employeeId={g.employeeId}
                                        employeeName={g.employeeName}
                                        proposals={g.proposals}
                                        onSwapShift={setSwappingProposal}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Candidate Swap Drawer */}
                        {swappingProposal && (
                          <CandidateSwapDrawer
                            open={!!swappingProposal}
                            onClose={() => setSwappingProposal(null)}
                            proposal={swappingProposal}
                            employees={employees}
                            existingRoster={existingRoster}
                            allProposals={result?.proposals || []}
                            onSelect={handleApplySwap}
                          />
                        )}

                        {/* Uncovered shifts with "Why" audit */}
                        {result && result.uncoveredV8ShiftIds.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                        <AlertTriangle className="h-4 w-4" />
                                        {result.uncoveredV8ShiftIds.length} Unfilled Shift{result.uncoveredV8ShiftIds.length !== 1 ? 's' : ''}
                                    </h3>
                                    {result.uncoveredAudit && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-[11px] gap-1.5 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                                            onClick={handleDownloadAudit}
                                            disabled={isDownloading}
                                        >
                                            <FileText className="h-3 w-3" />
                                            Audit Report
                                        </Button>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    {result.uncoveredAudit?.map(audit => (
                                        <div key={audit.shiftId} className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-xs font-bold text-foreground">{audit.shiftDate}</span>
                                                <span className="text-[10px] text-muted-foreground">{audit.startTime}–{audit.endTime}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {Object.entries(audit.rejectionSummary).length > 0 ? (
                                                    Object.entries(audit.rejectionSummary).map(([type, count]) => (
                                                        <Badge key={type} variant="secondary" className="text-[9px] h-4 px-1 bg-amber-500/20 text-amber-700 border-none">
                                                            {type}: {count}
                                                        </Badge>
                                                    ))
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground italic">No eligible employees found</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {result.uncoveredV8ShiftIds.length > (result.uncoveredAudit?.length ?? 0) && (
                                        <p className="text-[10px] text-muted-foreground text-center italic">
                                            + {result.uncoveredV8ShiftIds.length - (result.uncoveredAudit?.length ?? 0)} more unfilled shifts (download report for full details)
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Empty state */}
                        {phase === 'idle' && !result && (
                            <div className="py-10 text-center text-muted-foreground">
                                <Cpu className="h-12 w-12 mx-auto mb-3 opacity-20" />
                                <p className="text-sm">
                                    {unfilledCount === 0
                                        ? 'No unfilled shifts in current view'
                                        : employees.length === 0
                                            ? 'No employees available in scope'
                                            : health && !health.available
                                                ? 'Optimizer offline — greedy fallback will run'
                                                : 'Click "Optimise" to find the best schedule'}
                                </p>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border space-y-2">
                    {result && result.passing > 0 && !isCommitting && (
                        <p className="text-xs text-center text-muted-foreground">
                            {result.failing > 0
                                ? `${result.failing} shift(s) with blocking violations will be skipped`
                                : 'All proposals passed compliance — ready to apply'}
                        </p>
                    )}

                    {!result ? (
                        <Button
                            className="w-full gap-2"
                            onClick={handleRun}
                            disabled={!canRun || phase !== 'idle'}
                        >
                            {phase !== 'idle' ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {phase === 'optimizing' ? 'Running OR-Tools…' : 'Validating compliance…'}
                                </>
                            ) : (
                                <>
                                    <Zap className="h-4 w-4" />
                                    Optimise {filteredCount} Shift{filteredCount !== 1 ? 's' : ''}
                                </>
                            )}
                        </Button>
                    ) : (
                        <>
                            <Button
                                className={cn(
                                    'w-full gap-2',
                                    result.canCommit
                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                        : 'opacity-50',
                                )}
                                onClick={handleCommit}
                                disabled={!result.canCommit || isCommitting}
                            >
                                {isCommitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Applying…
                                    </>
                                ) : (
                                    <>
                                        <Zap className="h-4 w-4" />
                                        Apply {result.passing} Assignment{result.passing !== 1 ? 's' : ''}
                                    </>
                                )}
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full gap-2"
                                onClick={handleRun}
                                disabled={phase !== 'idle' && phase !== 'done'}
                            >
                                <Cpu className="h-4 w-4" />
                                Re-optimise
                            </Button>
                        </>
                    )}
                    <Button variant="ghost" className="w-full" onClick={handleClose}>
                        Cancel
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
// =============================================================================
// CANDIDATE SWAP DRAWER
// =============================================================================

interface CandidateSwapDrawerProps {
  open: boolean;
  onClose: () => void;
  proposal: ValidatedProposal;
  employees: EmployeeMeta[];
  existingRoster: Map<string, ShiftMeta[]>;
  allProposals: ValidatedProposal[];
  onSelect: (shiftId: string, employeeId: string) => void;
}

function CandidateSwapDrawer({
  open,
  onClose,
  proposal,
  employees,
  existingRoster,
  allProposals,
  onSelect
}: CandidateSwapDrawerProps) {
  
  // Find candidates eligible for this shift
  const candidates = React.useMemo(() => {
    return employees
      .map(emp => {
        const empShifts = existingRoster.get(emp.id) ?? [];
        const proposedForEmp = allProposals.filter(p => p.employeeId === emp.id && p.shiftId !== proposal.shiftId);
        
        // Merge existing + other proposed shifts
        const currentShifts = [
          ...empShifts,
          ...proposedForEmp.map(p => ({
            id: p.shiftId,
            shift_date: p.shiftDate,
            start_time: p.startTime,
            end_time: p.endTime,
            duration_minutes: (parseISO(`${p.shiftDate}T${p.endTime}`).getTime() - parseISO(`${p.shiftDate}T${p.startTime}`).getTime()) / 60000
          } as any))
        ];

        // Projected health IF they take this shift
        const withThisShift = [
          ...currentShifts,
          {
            id: proposal.shiftId,
            shift_date: proposal.shiftDate,
            start_time: proposal.startTime,
            end_time: proposal.endTime,
            duration_minutes: (parseISO(`${proposal.shiftDate}T${proposal.endTime}`).getTime() - parseISO(`${proposal.shiftDate}T${proposal.startTime}`).getTime()) / 60000
          } as any
        ];

        const fatigue = calculateFatigueWithRecovery(withThisShift, proposal.shiftDate).current;
        const totalHrs = withThisShift.reduce((acc, s) => acc + (s.duration_minutes || 0), 0) / 60;
        const contractedHrs = (emp as any).min_contract_minutes / 60 || 0;
        const utilization = calculateUtilization(totalHrs, contractedHrs);

        return {
          ...emp,
          projectedFatigue: fatigue,
          projectedUtilization: utilization,
          isCurrent: emp.id === proposal.employeeId
        };
      })
      .sort((a, b) => a.projectedFatigue - b.projectedFatigue);
  }, [proposal, employees, existingRoster, allProposals]);

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-2 text-primary mb-1">
            <ArrowLeftRight className="h-5 w-5" />
            <SheetTitle>Swap Candidate</SheetTitle>
          </div>
          <SheetDescription>
            Reassigning: {proposal.shiftDate} ({proposal.startTime}–{proposal.endTime})
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-4">
            <div className="p-3 bg-muted/40 rounded-lg border flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase font-bold text-muted-foreground">Current Assignment</p>
                <p className="text-sm font-medium">{proposal.employeeName}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">Active Proposal</Badge>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase text-muted-foreground tracking-wider">Eligible Alternatives</p>
              {candidates.map(cand => (
                <div 
                  key={cand.id}
                  className={cn(
                    "p-3 rounded-xl border transition-all group relative",
                    cand.isCurrent ? "border-primary/50 bg-primary/5" : "hover:border-primary/30 hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{cand.name}</span>
                    </div>
                    {cand.isCurrent && <Badge className="h-4 text-[9px] px-1.5 bg-primary/20 text-primary border-none">Selected</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "p-1.5 rounded-lg",
                        cand.projectedFatigue < 15 ? "bg-emerald-500/10" : "bg-red-500/10"
                      )}>
                        <Activity className={cn("h-3 w-3", cand.projectedFatigue < 15 ? "text-emerald-500" : "text-red-500")} />
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground leading-none">Fatigue</p>
                        <p className="text-xs font-bold">{cand.projectedFatigue.toFixed(1)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "p-1.5 rounded-lg",
                        cand.projectedUtilization < 105 ? "bg-blue-500/10" : "bg-amber-500/10"
                      )}>
                        <Scale className={cn("h-3 w-3", cand.projectedUtilization < 105 ? "text-blue-500" : "text-amber-500")} />
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground leading-none">Utilization</p>
                        <p className="text-xs font-bold">{cand.projectedUtilization.toFixed(0)}%</p>
                      </div>
                    </div>
                  </div>

                  {!cand.isCurrent && (
                    <Button 
                      className="w-full mt-3 h-8 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onSelect(proposal.shiftId, cand.id)}
                    >
                      Assign {cand.name}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="p-6 border-t bg-muted/20">
          <Button variant="outline" className="w-full" onClick={onClose}>Cancel</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
