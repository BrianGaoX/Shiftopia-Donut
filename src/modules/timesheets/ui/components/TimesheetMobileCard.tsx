import React, { useState, useMemo, forwardRef } from 'react';
import {
    UserX,
    ArrowRight,
    Edit3,
    CheckSquare,
    Check,
    X,
    RotateCcw,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { useToast } from '@/modules/core/hooks/use-toast';
import { getProtectionContext } from '@/modules/rosters/domain/shift-ui';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';
import { getGroupColor } from '@/modules/rosters/model/roster.types';
import type { TimesheetRow } from '../../model/timesheet.types';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { isShiftFinished } from './TimesheetTable.utils';

interface TimesheetMobileCardProps {
    entry: TimesheetRow;
    isSelected: boolean;
    isSelectMode: boolean;
    onToggleSelect: () => void;
    onSave?: (id: string, updates: Partial<TimesheetRow>) => void;
    onMarkNoShow?: (id: string) => void;
    onOverrideNoShow?: (id: string) => void;
    readOnly?: boolean;
    isManager?: boolean;
    employeeHeader?: React.ReactNode;
    employeeActions?: React.ReactNode;
    hideGlow?: boolean;
    useGroupColoring?: boolean;
    className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DataRow: React.FC<{
    label: string;
    start: string;
    end?: string;
    emphasis?: boolean;
    muted?: boolean;
    accentColor?: string;
    style?: React.CSSProperties;
}> = ({ label, start, end, emphasis, muted, accentColor, style }) => (
    <div 
        style={style}
        className={cn(
            "flex items-center justify-between py-2 transition-all duration-300",
            muted ? "opacity-30" : "opacity-100"
        )}
    >
        <span className="text-[12px] font-medium text-foreground/50">
            {label}
        </span>
        <div className="flex items-center gap-3">
            <span className={cn(
                "tabular-nums tracking-tight",
                emphasis ? "text-[16px] font-bold text-foreground" : "text-[14px] font-medium text-foreground/90",
                accentColor && !muted ? accentColor : ""
            )}>
                {start}
            </span>
            {end && (
                <>
                    <ArrowRight className="h-3 w-3 text-foreground/20" />
                    <span className={cn(
                        "tabular-nums tracking-tight",
                        emphasis ? "text-[16px] font-bold text-foreground" : "text-[14px] font-medium text-foreground/90",
                        accentColor && !muted ? accentColor : ""
                    )}>
                        {end}
                    </span>
                </>
            )}
        </div>
    </div>
);

function formatTime(t: string | null | undefined): string {
    if (!t || t === '-') return '—';
    if (t.includes('AM') || t.includes('PM')) return t;
    
    let timeStr = t;
    if (t.includes('T')) {
        const d = new Date(t);
        if (!isNaN(d.getTime())) {
            const h = d.getHours();
            const m = d.getMinutes();
            return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        }
    }

    const parts = timeStr.split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const h = parts[0], m = parts[1];
        return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    return timeStr;
}

function getDisplayStatus(entry: TimesheetRow): { label: string; variant: string; isPrimary: boolean } {
    const tsStatus = (entry.timesheetStatus || '').toLowerCase();
    const attStatus = (entry.attendanceStatus || '').toLowerCase();
    const live = entry.liveStatus;

    if (tsStatus === 'approved') return { label: 'Approved', variant: 'APPROVED', isPrimary: true };
    if (tsStatus === 'rejected') return { label: 'Rejected', variant: 'REJECTED', isPrimary: true };
    if (attStatus === 'no_show') return { label: 'No Show', variant: 'NO_SHOW', isPrimary: true };

    if (live === 'Ongoing Session') return { label: 'Active', variant: 'ACTIVE', isPrimary: true };
    if (live === 'Completed') return { label: 'Completed', variant: 'COMPLETED', isPrimary: true };
    if (live === 'Upcoming') return { label: 'Upcoming', variant: 'UPCOMING', isPrimary: true };

    if (tsStatus === 'submitted') return { label: 'Published', variant: 'SUBMITTED', isPrimary: false };
    return { label: 'Draft', variant: 'DRAFT', isPrimary: false };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const TimesheetMobileCard = forwardRef<HTMLDivElement, TimesheetMobileCardProps>(({
    entry,
    isSelected,
    isSelectMode,
    onToggleSelect,
    onSave,
    onMarkNoShow,
    onOverrideNoShow,
    readOnly = false,
    isManager = true,
    employeeHeader,
    employeeActions,
    hideGlow = false,
    useGroupColoring = false,
    className,
}, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localAdjStart, setLocalAdjStart] = useState(entry.adjustedStart || '');
    const [localAdjEnd, setLocalAdjEnd] = useState(entry.adjustedEnd || '');
    const [localPaidBreak, setLocalPaidBreak] = useState(entry.paidBreak || '0');
    const [localUnpaidBreak, setLocalUnpaidBreak] = useState(entry.unpaidBreak || '0');

    const { toast } = useToast();

    const isShiftOver = useMemo(() => 
        isShiftFinished(entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut),
    [entry.date, entry.scheduledStart, entry.scheduledEnd, entry.clockOut]);

    const isPending = entry.timesheetStatus?.toLowerCase() === 'submitted' || entry.timesheetStatus?.toLowerCase() === 'draft';
    
    const theme = useMemo(() => {
        const type = entry.groupType;
        const group = (entry.group || '').toLowerCase();
        const dept = (entry.department || '').toLowerCase();
        const subDept = (entry.subDepartment || '').toLowerCase();
        const org = (entry.organization || '').toLowerCase();
        
        const isConvention = type === 'convention_centre' || group.includes('convention') || dept.includes('convention') || subDept.includes('convention') || org.includes('convention');
        const isExhibition = type === 'exhibition_centre' || group.includes('exhibition') || dept.includes('exhibition') || subDept.includes('exhibition') || org.includes('exhibition');
        const isTheatre = type === 'theatre' || group.includes('theatre') || dept.includes('theatre') || subDept.includes('theatre') || org.includes('theatre');

        if (isConvention) return { 
            color: '#2563eb', 
            secondary: '#3b82f6', 
            atmosphere: ['#1d4ed8', '#2563eb', '#60a5fa'],
            tint: 'rgba(37, 99, 235, 0.04)'
        };
        
        if (isExhibition) return { 
            color: '#10b981', 
            secondary: '#059669', 
            atmosphere: ['#059669', '#10b981', '#34d399'],
            tint: 'rgba(16, 185, 129, 0.04)'
        };
        
        if (isTheatre) return { 
            color: '#ef4444', 
            secondary: '#dc2626', 
            atmosphere: ['#991b1b', '#ef4444', '#f87171'],
            tint: 'rgba(239, 68, 68, 0.04)'
        };
        
        return { color: '#9333ea', secondary: '#a855f7', atmosphere: ['#7e22ce', '#9333ea', '#c084fc'], tint: 'transparent' };
    }, [entry.groupType, entry.group, entry.department, entry.subDepartment, entry.organization]);

    const themeColor = theme.color;

    const isFinalized = useMemo(() => {
        const tsStatus = (entry.timesheetStatus || '').toLowerCase();
        const attStatus = (entry.attendanceStatus || '').toLowerCase();
        return ['approved', 'rejected', 'no_show'].includes(tsStatus) || attStatus === 'no_show';
    }, [entry.timesheetStatus, entry.attendanceStatus]);

    const canAction = isManager && isPending && !readOnly && !isFinalized;
    
    const showNoShowBtn = (!entry.clockIn || entry.clockIn === '-') && (!entry.clockOut || entry.clockOut === '-') && entry.statusDot?.label === 'No Show' && entry.liveStatus === 'Completed' && !readOnly && !!onMarkNoShow && !isFinalized;

    const displayStatus = useMemo(() => getDisplayStatus(entry), [entry]);

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

    const handleApprove = () => {
        if (!canAction) return;
        onSave?.(String(entry.id), { timesheetStatus: 'approved' } as any);
        toast({ title: 'Approved', description: `Timesheet approved for ${entry.employee}.` });
    };

    const handleReject = () => {
        if (!canAction) return;
        onSave?.(String(entry.id), { timesheetStatus: 'rejected' } as any);
        toast({ title: 'Rejected', description: `Timesheet rejected for ${entry.employee}.` });
    };

    const handleSaveAdjustment = () => {
        const formatTimeStr = (t: string) => {
            if (/^\d{3,4}$/.test(t)) {
                return t.length === 3 ? `0${t.slice(0, 1)}:${t.slice(1)}` : `${t.slice(0, 2)}:${t.slice(2)}`;
            }
            return t;
        };
        const finalStart = formatTimeStr(localAdjStart);
        const finalEnd = formatTimeStr(localAdjEnd);

        onSave?.(String(entry.id), {
            adjustedStart: finalStart,
            adjustedEnd: finalEnd,
            paidBreak: localPaidBreak,
            unpaidBreak: localUnpaidBreak,
            isAdjustedManual: true,
        } as any);
        setIsEditing(false);
        toast({ title: 'Record Updated', description: 'Timesheet data has been updated.' });
    };

    return (
        <SharedShiftCard
            variant="timecard"
            organization={entry.organization}
            department={entry.department}
            subGroup={entry.subGroup}
            role={entry.role}
            shiftDate={String(entry.date)}
            startTime={formatTime(entry.scheduledStart)}
            endTime={formatTime(entry.scheduledEnd)}
            netLength={(() => {
                if (!entry.netLength) return 0;
                const parts = entry.netLength.split(':').map(Number);
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    return parts[0] * 60 + parts[1];
                }
                return (parseInt(entry.netLength, 10) || 0) * 60;
            })()}
            paidBreak={parseInt(entry.paidBreak) || 0}
            unpaidBreak={parseInt(entry.unpaidBreak) || 0}
            lifecycleStatus={entry.liveStatus}
            groupVariant={(() => {
                const type = entry.groupType;
                const group = (entry.group || '').toLowerCase();
                const dept = (entry.department || '').toLowerCase();
                if (type === 'convention_centre' || group.includes('convention') || dept.includes('convention')) return 'convention';
                if (type === 'exhibition_centre' || group.includes('exhibition') || dept.includes('exhibition')) return 'exhibition';
                if (type === 'theatre' || group.includes('theatre') || dept.includes('theatre')) return 'theatre';
                return 'default';
            })()}
            employeeName={entry.employee}
            clockIn={formatTime(entry.clockIn)}
            clockOut={formatTime(entry.clockOut)}
            adjustedStart={formatTime(entry.adjustedStart)}
            adjustedEnd={formatTime(entry.adjustedEnd)}
            shiftData={{
                lifecycle_status: entry.liveStatus,
                assignment_outcome: entry.attendanceStatus,
                attendance_status: entry.attendanceStatus,
                attendance_note: entry.attendanceNote,
                actual_start: entry.clockIn,
                actual_end: entry.clockOut,
                adjusted_start: entry.adjustedStart,
                adjusted_end: entry.adjustedEnd,
                shift_date: entry.date,
                start_time: entry.scheduledStart,
                end_time: entry.scheduledEnd,
            }}
            topContent={isSelectMode && (
                <button
                    onClick={onToggleSelect}
                    className={cn(
                        "shrink-0 h-10 w-10 rounded-xl border-2 flex items-center justify-center transition-all",
                        isSelected ? "bg-primary border-primary shadow-lg" : "border-foreground/10 bg-foreground/5"
                    )}
                >
                    {isSelected && <CheckSquare className="w-5 h-5 text-white" />}
                </button>
            )}
            footerActions={
                <div className="flex flex-col gap-3">
                    {isEditing ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Adj In</Label>
                                    <input 
                                        value={localAdjStart} 
                                        onChange={e => setLocalAdjStart(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Adj Out</Label>
                                    <input 
                                        value={localAdjEnd} 
                                        onChange={e => setLocalAdjEnd(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Paid Break</Label>
                                    <input 
                                        value={localPaidBreak} 
                                        onChange={e => setLocalPaidBreak(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Unpaid Break</Label>
                                    <input 
                                        value={localUnpaidBreak} 
                                        onChange={e => setLocalUnpaidBreak(e.target.value)} 
                                        className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2 text-xs text-foreground font-bold tabular-nums focus:ring-1 focus:ring-primary/20 outline-none" 
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleSaveAdjustment}
                                    className="flex-1 h-11 rounded-xl font-bold bg-primary text-white shadow-lg active:scale-95 transition-all"
                                >
                                    <Check className="h-5 w-5 mr-2" /> Save
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setIsEditing(false)}
                                    className="h-11 px-4 rounded-xl border-border/50 text-foreground/40 hover:text-rose-500 hover:bg-rose-500/5 active:scale-95 transition-all"
                                >
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>
                    ) : isManager ? (
                        canAction ? (
                            <div className="flex gap-1 w-full">
                                <Button
                                    onClick={handleApprove}
                                    disabled={!isShiftOver}
                                    className="flex-1 h-9 rounded-xl font-black uppercase text-[9px] tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 transition-all active:scale-95 px-0"
                                >
                                    Approve
                                </Button>
                                <Button
                                    onClick={handleReject}
                                    disabled={!isShiftOver}
                                    className="flex-1 h-9 rounded-xl font-black uppercase text-[9px] tracking-widest bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:bg-rose-500/20 disabled:opacity-30 transition-all active:scale-95 px-0"
                                >
                                    Reject
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setIsEditing(true)}
                                    disabled={!isShiftOver}
                                    className="flex-1 h-9 rounded-xl border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 text-[9px] font-black uppercase tracking-widest disabled:opacity-30 transition-all active:scale-95 px-0"
                                >
                                    Edit
                                </Button>
                                {showNoShowBtn && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onMarkNoShow?.(String(entry.id))}
                                        disabled={!isShiftOver}
                                        className="flex-1 h-9 rounded-xl border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400 text-[8px] font-black uppercase tracking-widest disabled:opacity-30 transition-all active:scale-95 px-1"
                                    >
                                        <UserX className="h-3 w-3 mr-1" /> No-Show
                                    </Button>
                                )}

                            </div>

                        ) : (
                            <div className="w-full flex flex-col gap-2">
                                <div className="w-full flex items-center justify-center px-4 py-3 bg-foreground/[0.04] border border-foreground/5 rounded-2xl text-foreground/40 text-[10px] font-black uppercase tracking-widest">
                                    Finalized Record
                                </div>
                                {entry.attendanceStatus === 'no_show' && !readOnly && onOverrideNoShow && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onOverrideNoShow(String(entry.id))}
                                        className="h-11 rounded-xl border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400 font-bold tracking-wide transition-all active:scale-95"
                                    >
                                        <RotateCcw className="h-4 w-4 mr-2" /> Override No-Show
                                    </Button>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="w-full">
                            {employeeActions}
                        </div>
                    )}
                </div>
            }
            className={cn(
                isSelected && 'ring-2 ring-primary/60',
                className
            )}
            ref={ref}
        />
    );
});
