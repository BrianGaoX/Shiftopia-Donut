/* ------------------------------------------------------------------
   TimesheetRow.tsx - Migrated to new module
------------------------------------------------------------------- */

import React, { useState, useMemo } from "react";
import {
    CheckCircle,
    XCircle,
    Save,
    X,
    AlertTriangle,
    MessageSquare,
    UserX,
    Lock,
    ShieldCheck,
    RotateCcw,
} from "lucide-react";
import { TimesheetStatusBadge } from "./TimesheetStatusBadge";


import { cn } from "@/modules/core/lib/utils";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import type { TimesheetRow as TimesheetRowType } from "../../model/timesheet.types";
import { calculateHoursBetween, formatHours, formatDifferential, isShiftFinished } from "./TimesheetTable.utils";
import { getProtectionContext, getTimeRule, getLiveRuleBadges } from "@/modules/rosters/domain/shift-ui";
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { ZERO_COST_BREAKDOWN } from '@/modules/rosters/domain/projections/utils/cost/constants';

interface TimesheetRowProps {
    entry: TimesheetRowType;
    readOnly?: boolean;
    isSelected?: boolean;
    onToggleSelect?: () => void;
    onSave?: (id: string, updates: Partial<TimesheetRowType>) => void;
    onMarkNoShow?: (id: string) => void;
    showDate?: boolean;
}

export const TimesheetRow: React.FC<TimesheetRowProps> = ({
    entry,
    readOnly = false,
    isSelected = false,
    onToggleSelect,
    onSave,
    onMarkNoShow,
    showDate = false,
}) => {
    /* -- state -------------------------------------------------- */
    const [isEditingAdjusted, setIsEditingAdjusted] = useState(false);
    const [timingError, setTimingError] = useState('');

    // Approve flow
    const [warningsOpen, setWarningsOpen] = useState(false);
    const [overrideReason, setOverrideReason] = useState('');

    // Reject flow — requires a reason
    const [rejectOpen, setRejectOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    const { toast } = useToast();

    // Decision is finalized — no more edits allowed
    const isFinalized = useMemo(() => {
        const tsStatus = (entry.timesheetStatus || '').toLowerCase();
        const attStatus = (entry.attendanceStatus || '').toLowerCase();
        return ['approved', 'rejected', 'no_show'].includes(tsStatus) || attStatus === 'no_show';
    }, [entry.timesheetStatus, entry.attendanceStatus]);

    const [editedAdjusted, setEditedAdjusted] = useState({
        adjustedStart: entry.adjustedStart || "",
        adjustedEnd: entry.adjustedEnd || "",
        paidBreak: entry.paidBreak || "0",
        unpaidBreak: entry.unpaidBreak || "0",
    });

    // Shift is currently running — block both approve and reject until it ends
    const isShiftOver = useMemo(() => 
        isShiftFinished(entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut),
    [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut]);
    
    const isInProgress = entry.liveStatus === 'InProgress' || !isShiftOver;

    const isPast = useMemo(() => {
        if (!entry.date || !entry.scheduledEnd) return false;
        try {
            const endStr = `${entry.date}T${entry.scheduledEnd}`;
            return new Date(endStr).getTime() < Date.now();
        } catch {
            return false;
        }
    }, [entry.date, entry.scheduledEnd]);

    const protection = useMemo(() => getProtectionContext(
        { lifecycle_status: entry.liveStatus as any },
        isPast
    ), [entry.liveStatus, isPast]);

    const shiftInput = useMemo(() => ({
        lifecycle_status: entry.liveStatus,
        attendance_status: entry.attendanceStatus,
        attendance_note: entry.attendanceNote,
        actual_start: entry.rawActualStart ?? entry.clockIn,
        actual_end: entry.rawActualEnd ?? entry.clockOut,
        adjusted_start: entry.adjustedStart,
        adjusted_end: entry.adjustedEnd,
        adjusted_is_manual: entry.isAdjustedManual,
        start_at: entry.rawStartAt,
        end_at: entry.rawEndAt,
        shift_date: typeof entry.date === 'string' ? entry.date : undefined,
        start_time: entry.scheduledStart,
        end_time: entry.scheduledEnd,
    }), [entry]);

    const timeRuleBadge = useMemo(() => getTimeRule(shiftInput), [shiftInput]);
    const liveRuleBadges = useMemo(() => getLiveRuleBadges(shiftInput), [shiftInput]);

    // Attendance warnings — drives the approval modal
    const warnings = useMemo(() => {
        const list: { text: string; severity: 'error' | 'warning' }[] = [];
        if (isInProgress) {
            list.push({ text: 'Shift is currently in progress — approval is only available after the shift has ended', severity: 'error' });
        }
        if (entry.attendanceStatus === 'no_show') {
            list.push({ text: 'Employee was marked as no-show for this shift', severity: 'error' });
        }
        const isActiveOrComplete = entry.liveStatus === 'InProgress' || entry.liveStatus === 'Completed';
        const noCheckIn = !entry.clockIn || entry.clockIn === '-';
        // Missing check-in on an active/completed shift is an error — requires override reason
        if (noCheckIn && isActiveOrComplete && entry.attendanceStatus !== 'no_show') {
            list.push({ text: 'No clock-in recorded — cannot verify attendance', severity: 'error' });
        }
        if (entry.varianceMinutes != null && entry.varianceMinutes > 15) {
            list.push({ text: `Late arrival: ${entry.varianceMinutes} min after scheduled start`, severity: 'warning' });
        }
        const noCheckOut = !entry.clockOut || entry.clockOut === '-';
        if (noCheckOut && entry.liveStatus === 'Completed' && !noCheckIn) {
            list.push({ text: 'No clock-out recorded — auto clock-out may have been applied', severity: 'warning' });
        }
        return list;
    }, [entry, isInProgress]);

    const requiresReason = warnings.some(w => w.severity === 'error') && !isInProgress;

    // Auto-calculate Length and Net Length when editing
    const calculatedValues = useMemo(() => {
        const start = editedAdjusted.adjustedStart;
        const end = editedAdjusted.adjustedEnd;
        const unpaidBreak = parseFloat(editedAdjusted.unpaidBreak) || 0;
        const length = calculateHoursBetween(start, end);
        const netLength = Math.max(0, length - (unpaidBreak / 60));
        const scheduledHours = calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd);
        const differential = length - scheduledHours;
        return {
            length: formatHours(length),
            netLength: formatHours(netLength),
            differential: formatDifferential(differential),
        };
    }, [editedAdjusted, entry.scheduledStart, entry.scheduledEnd]);

    // Calculate display values for non-edit mode
    const displayValues = useMemo(() => {
        if (entry.attendanceStatus === 'no_show') {
            return {
                length: '0.00',
                netLength: '0.00',
                approximatePay: '$0.00',
                differential: formatDifferential(0 - calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd)),
            };
        }
        if (!entry.adjustedStart || !entry.adjustedEnd) {
            return {
                length: '0.00',
                netLength: '0.00',
                differential: formatDifferential(0 - calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd)),
            };
        }
        const length = calculateHoursBetween(entry.adjustedStart, entry.adjustedEnd);
        const unpaidBreak = parseFloat(entry.unpaidBreak) || 0;
        const netLength = Math.max(0, length - (unpaidBreak / 60));
        const scheduledHours = calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd);
        const differential = length - scheduledHours;
        return {
            length: formatHours(length),
            netLength: formatHours(netLength),
            differential: formatDifferential(differential),
        };
    }, [entry]);

    /* -- handlers ---------------------------------------------- */

    // Approve
    const doApprove = () => {
        onSave?.(String(entry.id), {
            timesheetStatus: 'approved',
            ...(overrideReason.trim() ? { notes: overrideReason.trim() } : {}),
        } as any);
        toast({ title: 'Timesheet Approved', description: `Timesheet for ${entry.employee} approved.` });
        setWarningsOpen(false);
        setOverrideReason('');
    };

    const handleApprove = () => {
        const status = entry.timesheetStatus?.toLowerCase();
        if (status !== 'submitted' && status !== 'draft') return;
        if (entry.attendanceStatus === 'no_show') {
            toast({
                title: 'Cannot Approve',
                description: 'Shift is marked as No-Show. Marks as approved is only for worked shifts.',
                variant: 'destructive',
            });
            return;
        }
        if (warnings.length > 0) { setWarningsOpen(true); return; }
        doApprove();
    };

    // Reject — always prompt for reason so employees can understand the decision
    const doReject = () => {
        if (!rejectReason.trim()) return;
        onSave?.(String(entry.id), {
            timesheetStatus: 'rejected',
            ...({ rejectedReason: rejectReason.trim() } as any),
        } as any);
        toast({ title: 'Timesheet Rejected', description: `Timesheet for ${entry.employee} rejected.` });
        setRejectOpen(false);
        setRejectReason('');
    };

    const handleReject = () => {
        const status = entry.timesheetStatus?.toLowerCase();
        if (status !== 'submitted' && status !== 'draft') return;
        if (isInProgress) {
            toast({
                title: 'Cannot Reject Yet',
                description: 'Shift is still in progress. Wait until the shift ends.',
                variant: 'destructive',
            });
            return;
        }
        setRejectOpen(true);
    };

    const handleSaveAdjusted = () => {
        // Timing validation
        let { adjustedStart, adjustedEnd } = editedAdjusted;
        
        // Auto-format "1600" -> "16:00"
        const formatTimeStr = (t: string) => {
            if (/^\d{3,4}$/.test(t)) {
                return t.length === 3 ? `0${t.slice(0, 1)}:${t.slice(1)}` : `${t.slice(0, 2)}:${t.slice(2)}`;
            }
            return t;
        };
        adjustedStart = formatTimeStr(adjustedStart);
        adjustedEnd = formatTimeStr(adjustedEnd);

        if (adjustedStart && adjustedEnd) {
            const [sh, sm] = adjustedStart.split(':').map(Number);
            const [eh, em] = adjustedEnd.split(':').map(Number);
            if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) {
                const msg = 'Invalid time format. Use HH:MM or HHMM.';
                setTimingError(msg);
                toast({ title: 'Invalid Times', description: msg, variant: 'destructive' });
                return;
            }
            const startMins = sh * 60 + sm;
            let endMins = eh * 60 + em;
            if (endMins < startMins) endMins += 24 * 60; // overnight
            if (endMins <= startMins) {
                const msg = 'Adjusted end time must be after start time';
                setTimingError(msg);
                toast({ title: 'Invalid Times', description: msg, variant: 'destructive' });
                return;
            }
        }
        setTimingError('');

        const fakeShift = {
            shift_date: String(entry.date),
            start_time: adjustedStart,
            end_time: adjustedEnd,
            roles: { name: entry.role },
            unpaid_break_minutes: parseFloat(editedAdjusted.unpaidBreak) || 0,
            scheduled_length_minutes: calculateHoursBetween(entry.scheduledStart, entry.scheduledEnd) * 60,
        };

        const cost = estimateDetailedCostFromShift(fakeShift);
        const approximatePay = `$${cost.totalCost.toFixed(2)}`;

        onSave?.(String(entry.id), {
            adjustedStart,
            adjustedEnd,
            paidBreak: editedAdjusted.paidBreak,
            unpaidBreak: editedAdjusted.unpaidBreak,
            length: calculatedValues.length,
            netLength: calculatedValues.netLength,
            differential: calculatedValues.differential,
            approximatePay,
        });
        toast({ title: 'Adjusted Values Saved', description: 'Timesheet adjustments updated.' });
        setIsEditingAdjusted(false);
    };

    const handleCancelEdit = () => {
        setEditedAdjusted({
            adjustedStart: entry.adjustedStart || "",
            adjustedEnd: entry.adjustedEnd || "",
            paidBreak: entry.paidBreak || "0",
            unpaidBreak: entry.unpaidBreak || "0",
        });
        setTimingError('');
        setIsEditingAdjusted(false);
    };

    const handleAdjustedCellClick = () => {
        if (!readOnly && !isEditingAdjusted && entry.liveStatus !== 'Cancelled') {
            setEditedAdjusted({
                adjustedStart: entry.adjustedStart || entry.scheduledStart || "",
                adjustedEnd: entry.adjustedEnd || entry.scheduledEnd || "",
                paidBreak: entry.paidBreak || "0",
                unpaidBreak: entry.unpaidBreak || "0",
            });
            setIsEditingAdjusted(true);
        }
    };

    const getDifferentialColor = (diff: string) => {
        if (!diff || diff === '-' || diff === '0.00' || diff === '0.00 h') return 'text-muted-foreground/60';
        if (diff.startsWith('+')) return 'text-green-500';
        if (diff.startsWith('-')) return 'text-red-500';
        return 'text-muted-foreground/60';
    };

    // Notes from prior actions (override reason or rejection reason)
    const actionNote = (entry as any).notes || (entry as any).rejectedReason;

    /* -- render ------------------------------------------------ */
    const cellClass = "p-3 text-sm whitespace-nowrap border-b border-border/50 transition-all duration-200";
    const editableCellClass = cn(
        cellClass,
        (!isFinalized && !readOnly && !isInProgress)
            ? "cursor-pointer hover:bg-primary/5 hover:text-primary font-medium text-foreground/80"
            : "font-medium text-foreground/60"
    );

    return (
        <>{/* TimesheetRow.tsx */}
            <tr className={cn(
            "group hover:bg-muted/30 transition-all duration-300",
            entry.attendanceStatus === 'no_show' && "bg-red-500/5 hover:bg-red-500/10",
        )}>
                {/* Select */}
                <td className={`${cellClass} text-center border-r border-border/30`}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={onToggleSelect}
                        className="rounded border-border bg-background focus:ring-primary h-4 w-4 transition-all"
                        disabled={
                            (entry.timesheetStatus !== 'SUBMITTED' && entry.timesheetStatus !== 'DRAFT') ||
                            isInProgress
                        }
                    />
                </td>
 
                {/* Date column (Optional) */}
                {showDate && (
                    <td className={`${cellClass} font-black text-xs text-primary border-r border-border/30`}>
                        {String(entry.date)}
                    </td>
                )}

                {/* Employee Info */}
                <td className={`${cellClass} font-black text-[11px] text-muted-foreground/60 uppercase tracking-tighter`}>{entry.employeeId}</td>
                <td className={`${cellClass} font-black tracking-tight text-foreground border-r border-border/30`}>{entry.employee}</td>

                {/* Hierarchy */}
                <td className={cellClass}>{entry.group}</td>
                <td className={cellClass}>{entry.subGroup}</td>
                <td className={cellClass}>{entry.role}</td>
                <td className={`${cellClass} border-r border-border/30`}>
                    {entry.remunerationLevel && !entry.remunerationLevel.toLowerCase().includes('team lead') && !entry.remunerationLevel.toLowerCase().includes('operational control') && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-primary/10 text-primary border border-primary/20 shadow-sm">
                            {entry.remunerationLevel}
                        </span>
                    )}
                </td>

                {/* Scheduled — always first to match header order */}
                <td className={cellClass}>{entry.scheduledStart}</td>
                <td className={`${cellClass} border-r border-border/30`}>{entry.scheduledEnd}</td>

                {/* Clock (Actual) */}
                <td className={cellClass}>
                    <div className="flex flex-col">
                        <span className="font-bold">{entry.clockIn || '-'}</span>
                        {entry.varianceMinutes !== null && entry.varianceMinutes !== undefined && (
                            <span className={cn(
                                "text-[9px] font-black uppercase tracking-tighter",
                                entry.varianceMinutes > 5 ? "text-amber-500" : entry.varianceMinutes < -5 ? "text-emerald-500" : "text-muted-foreground/40"
                            )}>
                                {entry.varianceMinutes > 0 ? `+${entry.varianceMinutes}m` : `${entry.varianceMinutes}m`}
                            </span>
                        )}
                        {/* Missing check-in badge */}
                        {(!entry.clockIn || entry.clockIn === '-') &&
                            (entry.liveStatus === 'InProgress' || entry.liveStatus === 'Completed') && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 w-fit border border-red-500/20">
                                <AlertTriangle className="h-2.5 w-2.5" />Missing
                            </span>
                        )}
                    </div>
                </td>
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className="flex flex-col gap-0.5">
                        <span className="font-bold">{entry.clockOut || '-'}</span>
                        {entry.clockOutVarianceMinutes !== null && entry.clockOutVarianceMinutes !== undefined && (
                            <span className={cn(
                                "text-[9px] font-black uppercase tracking-tighter",
                                entry.clockOutVarianceMinutes > 5 ? "text-amber-500" : entry.clockOutVarianceMinutes < -5 ? "text-emerald-500" : "text-muted-foreground/40"
                            )}>
                                {entry.clockOutVarianceMinutes > 0 ? `+${entry.clockOutVarianceMinutes}m` : `${entry.clockOutVarianceMinutes}m`}
                            </span>
                        )}
                        {/* Missing check-out badge — shown when a completed/in-progress shift has no clock-out */}
                        {(!entry.clockOut || entry.clockOut === '-') &&
                            (entry.liveStatus === 'Completed') && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 w-fit border border-red-500/20">
                                <AlertTriangle className="h-2.5 w-2.5" />Missing
                            </span>
                        )}
                    </div>
                </td>

                {/* Adjusted (Inline Editable) */}
                {isEditingAdjusted ? (
                    <>
                        <td className={`${cellClass} ${timingError ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedStart}
                                onChange={(e) => { setEditedAdjusted({ ...editedAdjusted, adjustedStart: e.target.value }); setTimingError(''); }}
                                className={cn("bg-background border rounded-lg px-2 py-1 w-24 text-xs font-black shadow-sm", timingError ? "border-red-500/50" : "border-primary/30")}
                            />
                        </td>
                        <td className={`${cellClass} ${timingError ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                            <input
                                type="time"
                                value={editedAdjusted.adjustedEnd}
                                onChange={(e) => { setEditedAdjusted({ ...editedAdjusted, adjustedEnd: e.target.value }); setTimingError(''); }}
                                className={cn("bg-background border rounded-lg px-2 py-1 w-24 text-xs font-black shadow-sm", timingError ? "border-red-500/50" : "border-primary/30")}
                            />
                            {timingError && <p className="text-[8px] text-red-500 mt-0.5 font-bold">{timingError}</p>}
                        </td>
                        <td className={`${cellClass} bg-primary/10 border-r border-border/30`}>
                            <div className="flex flex-col">
                                <span className="font-black text-primary">{calculatedValues.length}</span>
                                <span className="text-[8px] font-black uppercase text-muted-foreground tracking-widest leading-none">Auto</span>
                            </div>
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={editedAdjusted.paidBreak}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, paidBreak: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-16 text-xs font-black shadow-sm"
                            />
                        </td>
                        <td className={`${cellClass} bg-primary/5`}>
                            <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={editedAdjusted.unpaidBreak}
                                onChange={(e) => setEditedAdjusted({ ...editedAdjusted, unpaidBreak: e.target.value })}
                                className="bg-background border border-primary/30 rounded-lg px-2 py-1 w-16 text-xs font-black shadow-sm"
                            />
                        </td>
                        <td className={`${cellClass} bg-primary/10 border-r border-border/30`}>
                            <div className="flex flex-col">
                                <span className={cn(
                                    "font-black",
                                    calculatedValues.netLength === '0.00' ? "text-muted-foreground/40" : "text-primary"
                                )}>
                                    {calculatedValues.netLength}
                                </span>
                                <span className="text-[8px] font-black uppercase text-muted-foreground/30 tracking-widest leading-none">Preview</span>
                            </div>
                        </td>
                    </>
                ) : (
                    <>
                        <td className={cn(
                            editableCellClass,
                            (!entry.adjustedStart || entry.adjustedStart === '-') && "bg-muted/5"
                        )} onClick={handleAdjustedCellClick}>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-1">
                                                {readOnly && <Lock className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />}
                                                <span className={cn(
                                                    "font-bold",
                                                    entry.adjustedStartSource === 'manual' ? "text-indigo-600 dark:text-indigo-400" :
                                                    entry.adjustedStartSource === 'snapped' ? "text-sky-600 dark:text-sky-400 font-bold" :
                                                    "text-muted-foreground/30 italic font-medium"
                                                )}>
                                                    {entry.adjustedStart || '-'}
                                                </span>
                                            </div>
                                            {entry.adjustedStartSource === 'snapped' && entry.adjustedStart && (
                                                <span className="text-[8px] font-black uppercase text-muted-foreground/30 tracking-widest leading-none">
                                                    snapped
                                                </span>
                                            )}
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {readOnly ? 'Read-only timesheet' : 
                                         entry.liveStatus === 'Cancelled' ? 'Cancelled shift — cannot edit billable times' : 
                                         'Click to edit billable times'}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </td>
                        {/* Adjusted End — color coded by source */}
                        <td className={cn(
                            editableCellClass,
                            (!entry.adjustedEnd || entry.adjustedEnd === '-') && "bg-muted/5"
                        )} onClick={handleAdjustedCellClick}>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-1">
                                                {readOnly && <Lock className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />}
                                                <span className={cn(
                                                    "font-bold",
                                                    entry.adjustedEndSource === 'manual' ? "text-indigo-600 dark:text-indigo-400" :
                                                    entry.adjustedEndSource === 'snapped' ? "text-sky-600 dark:text-sky-400 font-bold" :
                                                    "text-muted-foreground/30 italic font-medium"
                                                )}>
                                                    {entry.adjustedEnd || '-'}
                                                </span>
                                            </div>
                                            {entry.adjustedEndSource === 'snapped' && entry.adjustedEnd && (
                                                <span className="text-[8px] font-black uppercase text-muted-foreground/30 tracking-widest leading-none">
                                                    snapped
                                                </span>
                                            )}
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {readOnly ? 'Read-only timesheet' : 
                                         entry.liveStatus === 'Cancelled' ? 'Cancelled shift — cannot edit billable times' : 
                                         'Click to edit billable times'}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </td>
                        <td className={`${cellClass} font-black text-foreground border-r border-border/30`}>
                            {displayValues.length}
                        </td>
                        <td className={editableCellClass} onClick={handleAdjustedCellClick}>
                            {entry.paidBreak || '0'}
                        </td>
                        <td className={editableCellClass} onClick={handleAdjustedCellClick}>
                            {entry.unpaidBreak || '0'}
                        </td>
                        <td className={`${cellClass} font-black text-foreground border-r border-border/30`}>
                            {displayValues.netLength}
                        </td>
                    </>
                )}

                {/* Payroll */}
                <td className={`${cellClass} font-black text-primary tracking-tight`}>
                    {entry.approximatePay || '-'}
                </td>

                {/* Differential */}
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className={`px-2 py-1 rounded-lg text-[10px] font-black text-center w-fit ${getDifferentialColor(isEditingAdjusted ? calculatedValues.differential : displayValues.differential).replace('text-', 'bg-').replace('-400', '/10 text-')}`}>
                        {isEditingAdjusted ? calculatedValues.differential : displayValues.differential}
                    </div>
                </td>


                {/* Time Rules */}
                <td className={cellClass}>
                    {timeRuleBadge && (
                        <span 
                            className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black font-mono tracking-tight uppercase border w-fit whitespace-nowrap"
                            style={{
                                color: timeRuleBadge.color,
                                backgroundColor: `${timeRuleBadge.color}10`,
                                borderColor: `${timeRuleBadge.color}20`,
                            }}
                        >
                            {timeRuleBadge.label}
                        </span>
                    )}
                </td>
                {/* Live Rules */}
                <td className={`${cellClass} border-r border-border/30`}>
                    <div className="flex flex-col gap-1 items-start">
                        {[liveRuleBadges.arrival, liveRuleBadges.departure].map((badge, i) => badge && (
                            <span
                                key={i}
                                className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black font-mono tracking-tight uppercase border w-fit whitespace-nowrap"
                                style={{
                                    color: badge.color,
                                    backgroundColor: `${badge.color}10`,
                                    borderColor: `${badge.color}20`,
                                }}
                            >
                                {badge.label}
                            </span>
                        ))}
                        {/* Show action note (override/rejection reason) */}
                        {actionNote && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1 text-[8px] text-muted-foreground/60 cursor-default mt-0.5">
                                            <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                                            <span className="truncate max-w-[80px]">{actionNote}</span>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">{actionNote}</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </td>

                {/* Actions */}
                <td className={`${cellClass} text-center`}>
                    <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isEditingAdjusted ? (
                            <>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleSaveAdjusted}
                                                className="h-8 w-8 rounded-xl text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                            >
                                                <Save size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Save Changes</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>

                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={handleCancelEdit}
                                                className="h-8 w-8 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                            >
                                                <X size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Cancel</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </>
                        ) : (
                            <>
                                {/* Approve — blocked while InProgress or if No-Show */}
                                {(entry.timesheetStatus?.toLowerCase() === 'submitted' || entry.timesheetStatus?.toLowerCase() === 'draft') && entry.attendanceStatus !== 'no_show' && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleApprove}
                                                    disabled={isInProgress}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        isInProgress
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                                    )}
                                                >
                                                    <CheckCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {isInProgress ? 'Shift Ongoing — action available after scheduled end' : 'Approve'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Reject — also blocked while InProgress; always requires reason; hidden if No-Show */}
                                {(entry.timesheetStatus?.toLowerCase() === 'submitted' || entry.timesheetStatus?.toLowerCase() === 'draft') && entry.attendanceStatus !== 'no_show' && !readOnly && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleReject}
                                                    disabled={isInProgress}
                                                    className={cn(
                                                        "h-8 w-8 rounded-xl",
                                                        isInProgress
                                                            ? "text-muted-foreground/40 cursor-not-allowed"
                                                            : "text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                                    )}
                                                >
                                                    <XCircle size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {isInProgress ? 'Shift Ongoing — action available after scheduled end' : 'Reject'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {/* Mark as No-Show — only available when shift is over + no clocks recorded */}
                                {(!entry.clockIn || entry.clockIn === '-') && (!entry.clockOut || entry.clockOut === '-') && isShiftOver && entry.attendanceStatus !== 'no_show' && !readOnly && onMarkNoShow && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onMarkNoShow(String(entry.id))}
                                                    className="h-8 w-8 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                                >
                                                    <UserX size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Mark as No-Show</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </>
                        )}
                    </div>
                </td>
            </tr>

            {/* ── Approve warnings modal ── */}
            <Dialog open={warningsOpen} onOpenChange={open => { setWarningsOpen(open); if (!open) setOverrideReason(''); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className={cn("h-5 w-5", isInProgress ? "text-red-500" : "text-amber-500")} />
                            {isInProgress ? 'Approval Blocked' : 'Attendance Issues Detected'}
                        </DialogTitle>
                        <DialogDescription>
                            {isInProgress
                                ? <>Approval for <strong>{entry.employee}</strong>'s timesheet is blocked until the shift ends.</>
                                : <>Review the following issues before approving <strong>{entry.employee}</strong>'s timesheet.</>
                            }
                        </DialogDescription>
                    </DialogHeader>

                    <ul className="space-y-2 my-2">
                        {warnings.map((w, i) => (
                            <li key={i} className={cn(
                                'flex items-start gap-2 text-sm px-3 py-2 rounded-lg',
                                w.severity === 'error'
                                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
                                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
                            )}>
                                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                {w.text}
                            </li>
                        ))}
                    </ul>

                    {requiresReason && (
                        <div className="space-y-1.5">
                            <Label htmlFor="override-reason" className="text-sm font-semibold">
                                Override reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="override-reason"
                                placeholder="e.g. Supervisor confirmed attendance verbally…"
                                value={overrideReason}
                                onChange={e => setOverrideReason(e.target.value)}
                                className="text-sm"
                            />
                            <p className="text-[11px] text-muted-foreground">This reason will be saved and visible to the employee.</p>
                        </div>
                    )}

                    <DialogFooter className="gap-2 flex-wrap">
                        {!isInProgress && (
                            <Button variant="outline" onClick={() => { setWarningsOpen(false); handleAdjustedCellClick(); }}>
                                Adjust Times
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => setWarningsOpen(false)}>
                            {isInProgress ? 'OK' : 'Cancel'}
                        </Button>
                        {!isInProgress && (
                            <Button
                                onClick={doApprove}
                                disabled={requiresReason && !overrideReason.trim()}
                                className="bg-green-600 hover:bg-green-700 text-white"
                            >
                                <CheckCircle className="h-4 w-4 mr-1.5" />
                                Approve Anyway
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Reject reason modal ── */}
            <Dialog open={rejectOpen} onOpenChange={open => { setRejectOpen(open); if (!open) setRejectReason(''); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <XCircle className="h-5 w-5 text-red-500" />
                            Reject Timesheet
                        </DialogTitle>
                        <DialogDescription>
                            Provide a reason for rejecting <strong>{entry.employee}</strong>'s timesheet.
                            This reason will be visible to the employee.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-1.5 my-2">
                        <Label htmlFor="reject-reason" className="text-sm font-semibold">
                            Rejection reason <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="reject-reason"
                            placeholder="e.g. Clock-in times do not match scheduled hours. Please review and resubmit."
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="text-sm"
                            rows={3}
                        />
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setRejectOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={doReject}
                            disabled={!rejectReason.trim()}
                        >
                            <XCircle className="h-4 w-4 mr-1.5" />
                            Confirm Rejection
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
