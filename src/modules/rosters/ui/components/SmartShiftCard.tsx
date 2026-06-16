/**
 * SmartShiftCard - Phase 2 Enterprise Component
 *
 * A "Smart Card" with two rendering modes:
 * - Compact: Minimal footprint for grid views (replaces ShiftCardCompact in dense layouts)
 * - Detailed: Full info card with compliance warnings, skills, and actions
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
    Clock,
    User,
    AlertTriangle,
    Megaphone,
    Edit,
    XCircle,
    CheckCircle,
    Hourglass,
    GripVertical,
    MoreHorizontal,
    Flame,
    Lock,
    CopyPlus,
    Shield,
    Sparkles,
    Gavel,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import type { Shift } from '../../domain/shift.entity';
import { 
    getShiftUIContext, 
    getLockState, 
    getProtectionContext,
    getShiftStatusIcons
} from '../../domain/shift-ui';
import { ShiftRuleHeader } from './ShiftRuleHeader';
import type { ShiftCostBreakdown } from '../../domain/projections/utils/cost/types';
import { ZERO_COST_BREAKDOWN } from '../../domain/projections/utils/cost/constants';
import { estimateDetailedCostFromShift } from '../../domain/projections/utils/cost';


// ============================================================================
// TYPES & HELPERS
// ============================================================================

export type ShiftCardVariant = 'compact' | 'detailed';
export interface ComplianceInfo {
    status: 'compliant' | 'warning' | 'violation';
    violations: string[];
    warnings: string[];
    weeklyHours?: number;
    maxWeeklyHours?: number;
}

export interface SmartShiftCardProps {
    shift: Shift;
    variant?: ShiftCardVariant;
    compliance?: ComplianceInfo;
    onClick?: (e: React.MouseEvent) => void;
    isSelected?: boolean;
    onSelect?: (shiftId: string) => void;
    isDragging?: boolean;
    isDragOver?: boolean;
    headerAction?: React.ReactNode;
    groupColor?: string;
    isLocked?: boolean;
    isPast?: boolean;
    isDnDActive?: boolean;
    className?: string;
    compliancePending?: boolean;
    showStatusIcons?: boolean;
    /**
     * Pre-computed cost breakdown. When provided, the card skips its own
     * call to the payroll engine — meaningful for dense grids where the
     * projector already computed it once for every shift.
     */
    detailedCost?: ShiftCostBreakdown;
}

const GROUP_COLORS: Record<string, { header: string; accent: string; text: string; badge: string }> = {
    blue: { header: 'bg-blue-600 dark:bg-blue-600', accent: 'border-blue-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    green: { header: 'bg-emerald-600 dark:bg-emerald-600', accent: 'border-emerald-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    red: { header: 'bg-red-600 dark:bg-red-600', accent: 'border-red-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    orange: { header: 'bg-orange-600 dark:bg-orange-600', accent: 'border-orange-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    purple: { header: 'bg-purple-600 dark:bg-purple-600', accent: 'border-purple-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    amber: { header: 'bg-amber-500 dark:bg-amber-500', accent: 'border-amber-500/30', text: 'text-white', badge: 'bg-white/20 dark:bg-white/10' },
    convention_centre: { header: 'bg-blue-600', accent: 'border-blue-500/30', text: 'text-white', badge: 'bg-white/20' },
    exhibition_centre: { header: 'bg-emerald-600', accent: 'border-emerald-500/30', text: 'text-white', badge: 'bg-white/20' },
    theatre: { header: 'bg-red-600', accent: 'border-red-500/30', text: 'text-white', badge: 'bg-white/20' },
    the_cutaway: { header: 'bg-amber-500', accent: 'border-amber-500/30', text: 'text-white', badge: 'bg-white/20' },
    default_yellow: { header: 'bg-amber-400', accent: 'border-amber-400/30', text: 'text-amber-950', badge: 'bg-black/10' },
};

function formatTime(time: string | null): string {
    if (!time) return '--:--';
    const timePart = time.includes('T') ? time.split('T')[1].substring(0, 5) : time;
    const parts = timePart.split(':');
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    return timePart;
}

function getInitials(name: string): string {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().substring(0, 2);
}

function getLifecycleIcon(status: string) {
    const s = (status || 'draft').toLowerCase();
    if (s === 'draft') return <Edit className="h-3.5 w-3.5 text-slate-400" />;
    if (s === 'published') return null;
    if (s === 'inprogress' || s === 'on_going') return <Hourglass className="h-3.5 w-3.5 text-slate-400" />;
    if (s === 'completed') return <CheckCircle className="h-3.5 w-3.5 text-slate-400" />;
    if (s === 'cancelled') return <XCircle className="h-3.5 w-3.5 text-slate-400" />;
    return <Edit className="h-3.5 w-3.5 text-slate-400" />;
}

/**
 * Normalizes shift lifecycle status for inconsistent API responses.
 */
function getNormalizedStatus(shift: any): string {
    return (shift.lifecycle_status || shift.lifecycleStatus || 'draft').toLowerCase();
}




/**
 * Renders the cost breakdown tooltip content.
 */
const CostBreakdownTooltip: React.FC<{ breakdown: any }> = ({ breakdown }) => {
    if (!breakdown) return null;
    
    const { totalCost, ordinaryCost, overtimeCost, allowanceCost, ordinaryHours, overtimeHours, breakdown: details } = breakdown;
    
    return (
        <div className="space-y-2 p-1 min-w-[180px]">
            <div className="flex justify-between items-center pb-1 border-b border-white/10">
                <span className="text-[10px] uppercase tracking-wider opacity-60">Estimated Pay</span>
                <span className="text-xs font-bold text-emerald-400">${totalCost.toFixed(2)}</span>
            </div>
            
            <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                    <span>Ordinary ({ordinaryHours.toFixed(1)}h @ ${details.penaltyRate.toFixed(2)})</span>
                    <span>${ordinaryCost.toFixed(2)}</span>
                </div>
                
                {overtimeCost > 0 && (
                    <div className="flex justify-between text-orange-300">
                        <span>Overtime ({overtimeHours.toFixed(1)}h)</span>
                        <span>${overtimeCost.toFixed(2)}</span>
                    </div>
                )}
                
                {allowanceCost > 0 && (
                    <div className="flex justify-between text-blue-300">
                        <span>Night Allowance ({details.nightHours.toFixed(1)}h)</span>
                        <span>${allowanceCost.toFixed(2)}</span>
                    </div>
                )}
            </div>
            
            <div className="pt-1 text-[9px] opacity-40 italic border-t border-white/5">
                Calculated per ICC Sydney EA 2025
            </div>
        </div>
    );
};

/**
 * Simple card shell that replaces the previous 3D tilt version.
 * This ensures UI stability and prevents child components (like dropdowns)
 * from unmounting during hover state transitions.
 */
interface CardShellProps {
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
    children: React.ReactNode;
}

const CardShell: React.FC<CardShellProps> = ({ className, onClick, children }) => {
    return (
        <div
            className={className}
            onClick={onClick}
        >
            {children}
        </div>
    );
};

// ============================================================================
// COMPACT VARIANT
// ============================================================================

const CompactCard: React.FC<SmartShiftCardProps> = ({
    shift,
    onClick,
    isSelected,
    isDragging,
    isDragOver,
    isLocked,
    isPast,
    isDnDActive,
    headerAction,
    groupColor = 'default_yellow',
    className,
    showStatusIcons,
    detailedCost,
}) => {
    const colors = useMemo(
        () => GROUP_COLORS[groupColor] || GROUP_COLORS.default_yellow,
        [groupColor],
    );
    const employeeName = shift.assigned_employee_id ? (shift as any).assigned_profiles ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}` : 'Assigned' : null;
    const roleName = shift.roles?.name || 'No Role';

    const ctx = useMemo(() => getShiftUIContext({
        lifecycle_status:   shift.lifecycle_status  ?? 'Draft',
        assignment_status:  shift.assignment_status ?? 'unassigned',
        assignment_outcome: shift.assignment_outcome ?? null,
        trading_status:     shift.trading_status    ?? null,
        is_cancelled:       shift.is_cancelled      ?? false,
        scheduled_start:    shift.scheduled_start   ?? null,
        scheduled_end:      shift.scheduled_end     ?? null,
        start_at:           shift.start_at          ?? null,
        end_at:             shift.end_at            ?? null,
        actual_start:       shift.actual_start      ?? null,
        emergency_source:   (shift as any).emergency_source ?? null,
    }), [shift.lifecycle_status, shift.is_cancelled, shift.assignment_status, shift.assignment_outcome, shift.trading_status, shift.scheduled_start, shift.scheduled_end, shift.start_at, shift.end_at, shift.actual_start, (shift as any).emergency_source]);

    const isBiddingActive = !!(shift.bidding_status && shift.bidding_status !== 'not_on_bidding');
    const isBiddingClosedNoWinner = shift.bidding_status === 'bidding_closed_no_winner';
    const biddingUrgency = useMemo(() => {
        if (!isBiddingActive) return null;
        if (isBiddingClosedNoWinner) return 'closed';
        if (shift.bidding_status === 'on_bidding_urgent' || ctx.urgency === 'urgent' || ctx.urgency === 'emergent') return 'urgent';
        return 'standard';
    }, [shift.bidding_status, ctx.urgency, isBiddingActive, isBiddingClosedNoWinner]);

    const stateId = ctx.state;
    const fsmLock = getLockState(ctx.state);
    // FSM-based lock overrides — differentiation between interactive protection vs absolute lock
    const isFullyLocked = isLocked || fsmLock.fullyLocked || isPast;
    
    // Centralized protection logic
    const protection = useMemo(() => getProtectionContext({ lifecycle_status: shift.lifecycle_status }, !!isPast), [shift.lifecycle_status, isPast]);
    const isProtected = protection.isProtected || fsmLock.partialLock;
    
    const statusStr = getNormalizedStatus(shift);

    const isDraft = statusStr === 'draft';
    const isPublished = statusStr === 'published';

    const statusIcons = useMemo(() =>
        showStatusIcons ? getShiftStatusIcons(shift) : [],
    [shift, showStatusIcons]);

    const costBreakdown = useMemo(() => {
        if (detailedCost && detailedCost.totalCost > 0) return detailedCost;
        return estimateDetailedCostFromShift(shift);
    }, [detailedCost, shift]);

    const headerBgAndText = useMemo(() => {
        if (isPast) {
            return isDraft
                ? 'bg-black text-white dark:bg-black'
                : 'bg-slate-500 text-white dark:bg-slate-600';
        }
        if (shift.bidding_status === 'bidding_closed_no_winner') {
            return 'bg-orange-500/20 text-orange-900 dark:text-orange-100';
        }
        return cn(
            colors.header,
            colors.text,
            isDraft ? 'bg-opacity-40 backdrop-blur-[2px]' : 'bg-opacity-100'
        );
    }, [isPast, isDraft, shift.bidding_status, colors.header, colors.text]);

    return (
        <CardShell
            className={cn(
                'relative group/card cursor-pointer rounded-lg overflow-hidden bg-card',
                'transition-[border-color,box-shadow,transform,background-color] duration-300',
                // CSS containment: scope style + paint to this subtree so popovers
                // opening elsewhere in the grid don't force a global recalc.
                '[contain:layout_paint_style]',
                onClick && (!isFullyLocked || isSelected) && 'cursor-pointer hover:shadow-md',
                isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background bg-primary/5 dark:bg-primary/20',
                isDragging && 'opacity-50 scale-95',
                isDragOver && 'ring-2 ring-blue-400 ring-offset-1',
                isPast && (isDraft ? 'grayscale opacity-60 cursor-not-allowed' : 'grayscale opacity-80 cursor-not-allowed'),
                className
            )}
            onClick={isFullyLocked || isPast ? undefined : onClick}
        >
            {/* Content container — body greyscales on past, header (dot) stays crisp */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Header */}
                <div className={cn('px-3 py-1.5 flex justify-between items-center transition-[background-color,color] duration-300 relative z-[20]',
                    headerBgAndText)}>
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("text-[9px] font-mono font-bold px-1 py-0.5 rounded", isFullyLocked ? "bg-black/20 dark:bg-black/50 opacity-70" : colors.badge)}>
                            {isBiddingClosedNoWinner ? 'S8'
                            : ctx.state === 'S3' && ctx.urgency === 'emergent' ? 'S3*'
                            : ctx.state === 'S5' && ctx.urgency === 'emergent' ? 'S5*'
                            : stateId}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest truncate opacity-80">
                            {shift.roster_subgroup?.name || shift.sub_group_name || roleName}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        {shift.is_from_template && <div className="mr-1" title="From Template"><CopyPlus className="h-3 w-3 opacity-60" /></div>}
                        {shift.notes?.startsWith('Generated') && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="mr-1 cursor-help"><Sparkles className="h-3 w-3 text-indigo-400 dark:text-indigo-300 opacity-90" /></div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-indigo-950 text-indigo-50 border-indigo-800 py-1.5 px-3 text-[11px] max-w-[220px] text-center font-medium shadow-lg" sideOffset={4}>
                                    {shift.notes}
                                </TooltipContent>
                            </Tooltip>
                        )}
                        {ctx.emergencyLabel && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center justify-center bg-rose-500/20 rounded p-0.5">
                                        <Flame className="h-3 w-3 text-rose-500" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-rose-600 text-white border-none py-1 px-2 text-[10px] font-medium">{ctx.emergencyLabel}</TooltipContent>
                            </Tooltip>
                        )}

                        <div onClick={(e) => e.stopPropagation()} className="relative z-30">
                            {headerAction || (!isFullyLocked && (
                                <button className="h-8 w-8 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 rounded transition-colors -mr-1">
                                    <MoreHorizontal className="h-3 w-3 opacity-60" />
                                </button>
                            ))}
                        </div>

                        {showStatusIcons && statusIcons.length > 0 && (
                            <div className="flex items-center gap-1 ml-1">
                                {/* Native title — Radix Tooltip per status icon costs
                                    ~5k extra portal wirings across a 1.4k-card grid. */}
                                {statusIcons.map((si, i) => (
                                    <span key={i} title={si.tooltip} className="inline-flex items-center">
                                        <si.icon
                                            className={cn("h-3 w-3", si.color)}
                                            aria-label={si.tooltip}
                                        />
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Body */}
                <div className={cn("px-3 py-1.5 flex flex-col gap-1 flex-1 relative z-[20]")}>
                    <ShiftRuleHeader shift={shift} variant="compact" className="mb-0.5" />
                    <div className="flex flex-col items-center justify-center min-h-[24px] gap-0.5">
                        <div className="text-[11px] font-bold text-foreground truncate text-center leading-none">{employeeName || 'Unassigned'}</div>
                        <div className="text-[9px] text-foreground/60 font-medium uppercase tracking-tight truncate">{roleName}</div>
                    </div>
                    <div className="flex justify-center mb-1">
                        <div className="bg-muted/50 rounded-md px-2 py-0.5 flex items-center gap-1.5 text-xs">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono font-medium text-foreground text-[9px]">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                        </div>
                    </div>
                    
                    {/* Cost Badge — shown for all shifts */}
                    {costBreakdown.totalCost > 0 && (
                        <div className="flex justify-center mt-auto">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 cursor-help">
                                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                            {employeeName ? '=' : '≈'} ${costBreakdown.totalCost.toFixed(2)}
                                        </span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-900 text-white border-white/10 shadow-xl">
                                    <CostBreakdownTooltip breakdown={costBreakdown} />
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    )}

                    {/* Bidding Icon — floating in bottom right */}
                    {isBiddingActive && biddingUrgency && (
                        <div className="absolute bottom-1.5 right-1.5 z-30">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className={cn(
                                        "p-1.5 rounded-lg border flex items-center justify-center shadow-sm cursor-help hover:scale-105 transition-all duration-300",
                                        biddingUrgency === 'urgent' && "bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400",
                                        biddingUrgency === 'closed' && "bg-slate-500/10 border-slate-500/20 text-slate-500 dark:text-slate-400 opacity-60 hover:opacity-100",
                                        biddingUrgency === 'standard' && "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400"
                                    )}>
                                        <Gavel className="h-4.5 w-4.5" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-900 text-white border-none py-1.5 px-3 text-[10px] font-bold">
                                    {biddingUrgency === 'urgent' && 'Urgent Bidding Active'}
                                    {biddingUrgency === 'closed' && 'Bidding Closed (No Winner)'}
                                    {biddingUrgency === 'standard' && 'Bidding Active'}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    )}
                </div>
            </div>

            {/* DnD Blocking Overlay (highest layer) */}
            {isDnDActive && isLocked && isPublished && (
                <div
                    className="absolute inset-0 bg-stripe-red pointer-events-none rounded-inherit z-[100] border-2 border-red-500/50 shadow-[inset_0_0_20px_rgba(239,68,68,0.3)]"
                    aria-hidden="true"
                />
            )}
        </CardShell>
    );
};

// ============================================================================
// DETAILED VARIANT
// ============================================================================

const DetailedCard: React.FC<SmartShiftCardProps> = ({
    shift,
    compliance,
    onClick,
    isSelected,
    isDragging,
    isDragOver,
    isLocked,
    isPast,
    isDnDActive,
    headerAction,
    groupColor = 'default_yellow',
    className,
    showStatusIcons,
    detailedCost,
}) => {
    const colors = useMemo(
        () => GROUP_COLORS[groupColor] || GROUP_COLORS.default_yellow,
        [groupColor],
    );
    const employeeName = shift.assigned_employee_id ? (shift as any).assigned_profiles ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}` : 'Assigned' : null;
    const roleName = shift.roles?.name || 'No Role';
    const hasComplianceIssue = compliance && compliance.status !== 'compliant';
    const totalHours = shift.net_length_minutes ? (shift.net_length_minutes / 60).toFixed(1) : null;
    
    const statusStr = getNormalizedStatus(shift);
    const ctx = useMemo(() => getShiftUIContext({
        lifecycle_status:   shift.lifecycle_status  ?? 'Draft',
        assignment_status:  shift.assignment_status ?? 'unassigned',
        assignment_outcome: shift.assignment_outcome ?? null,
        trading_status:     shift.trading_status    ?? null,
        is_cancelled:       shift.is_cancelled      ?? false,
        scheduled_start:    shift.scheduled_start   ?? null,
        scheduled_end:      shift.scheduled_end     ?? null,
        start_at:           shift.start_at          ?? null,
        end_at:             shift.end_at            ?? null,
        actual_start:       shift.actual_start      ?? null,
        emergency_source:   (shift as any).emergency_source ?? null,
    }), [shift.lifecycle_status, shift.is_cancelled, shift.assignment_status, shift.assignment_outcome, shift.trading_status, shift.scheduled_start, shift.scheduled_end, shift.start_at, shift.end_at, shift.actual_start, (shift as any).emergency_source]);

    const isBiddingActive = !!(shift.bidding_status && shift.bidding_status !== 'not_on_bidding');
    const isBiddingClosedNoWinner = shift.bidding_status === 'bidding_closed_no_winner';
    const biddingUrgency = useMemo(() => {
        if (!isBiddingActive) return null;
        if (isBiddingClosedNoWinner) return 'closed';
        if (shift.bidding_status === 'on_bidding_urgent' || ctx.urgency === 'urgent' || ctx.urgency === 'emergent') return 'urgent';
        return 'standard';
    }, [shift.bidding_status, ctx.urgency, isBiddingActive, isBiddingClosedNoWinner]);
    
    const fsmLock = getLockState(ctx.state);
    const isFullyLocked = isLocked || fsmLock.fullyLocked;
    
    // Centralized protection logic
    const protection = useMemo(() => getProtectionContext({ lifecycle_status: shift.lifecycle_status }, !!isPast), [shift.lifecycle_status, isPast]);
    const isProtected = protection.isProtected || fsmLock.partialLock;
    const isDraft = statusStr === 'draft';
    const isPublished = statusStr === 'published';

    const statusIcons = useMemo(() => 
        showStatusIcons ? getShiftStatusIcons(shift) : [], 
    [shift, showStatusIcons]);

    const costBreakdown = useMemo(() => {
        if (detailedCost && detailedCost.totalCost > 0) return detailedCost;
        return estimateDetailedCostFromShift(shift);
    }, [detailedCost, shift]);

    const stateLabel =
        // Display-only decoration: a closed-no-winner shift is FSM state S5
        // (Published + unassigned), shown as S8 to distinguish it from active
        // bidding. The FSM (shift-fsm.ts) and DB still derive S5 — this is a
        // card-level decoration, like the '*' emergent suffix below.
        isBiddingClosedNoWinner ? 'S8'
        : ctx.state === 'S3' && ctx.urgency === 'emergent' ? 'S3*'
        : ctx.state === 'S5' && ctx.urgency === 'emergent' ? 'S5*'
        : ctx.state;

    const headerBgAndText = useMemo(() => {
        if (isPast) {
            return isDraft
                ? 'bg-black text-white dark:bg-black'
                : 'bg-slate-500 text-white dark:bg-slate-600';
        }
        if (shift.bidding_status === 'bidding_closed_no_winner') {
            return 'bg-orange-500/20 text-orange-900 dark:text-orange-100';
        }
        return cn(
            colors.header,
            colors.text,
            isDraft ? 'bg-opacity-40 backdrop-blur-[2px]' : 'bg-opacity-100'
        );
    }, [isPast, isDraft, shift.bidding_status, colors.header, colors.text]);

    return (
        <CardShell
            className={cn(
                'relative group/card cursor-pointer rounded-xl overflow-hidden bg-card',
                'transition-[border-color,box-shadow,transform,background-color] duration-300',
                // CSS containment: scope style + paint so opening a popover/dropdown
                // in a sibling card doesn't trigger a grid-wide recalc.
                '[contain:layout_paint_style]',
                onClick && !isFullyLocked && 'cursor-pointer hover:shadow-lg',
                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5 dark:bg-primary/20',
                isDragging && 'opacity-50 scale-95',
                isDragOver && 'ring-2 ring-blue-400 ring-offset-2',
                isPast && (isDraft ? 'grayscale opacity-70 cursor-not-allowed' : 'grayscale opacity-80 cursor-not-allowed'),
                className
            )}
            onClick={isFullyLocked || isPast ? undefined : onClick}
        >
            {/* Content container — body greyscales on past, header (dot) stays crisp */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Header */}
                <div className={cn('px-4 py-2.5 flex justify-between items-center transition-[background-color,color] duration-300 relative z-[20]',
                    headerBgAndText)}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <GripVertical className={cn("h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-40 transition-opacity", isFullyLocked ? "cursor-not-allowed" : "cursor-grab")} />
                        <span className={cn("text-[9px] font-mono font-bold px-1 py-0.5 rounded",
                            isFullyLocked ? "bg-black/20 dark:bg-black/50 opacity-70" : colors.badge)}>
                            {stateLabel}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-widest truncate opacity-80">
                            {shift.roster_subgroup?.name || shift.sub_group_name || 'Shift'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {shift.is_from_template && <Badge variant="outline" className="text-[9px] bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 h-4 px-1 gap-1"><CopyPlus className="h-2.5 w-2.5" />Template</Badge>}

                        {getLifecycleIcon(statusStr)}
                        <div onClick={(e) => e.stopPropagation()} className="relative z-30">
                            {headerAction || (!isFullyLocked && (
                                <button className="h-9 w-9 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-colors -mr-1">
                                    <MoreHorizontal className="h-4 w-4 opacity-60" />
                                </button>
                            ))}
                        </div>

                        {showStatusIcons && statusIcons.length > 0 && (
                            <div className="flex items-center gap-1.5 ml-1">
                                {/* Native title — see CompactCard comment */}
                                {statusIcons.map((si, i) => (
                                    <span key={i} title={si.tooltip} className="inline-flex items-center">
                                        <si.icon
                                            className={cn("h-3.5 w-3.5", si.color)}
                                            aria-label={si.tooltip}
                                        />
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Body */}
                <div className={cn("p-4 space-y-3 relative z-[20]")}>
                    <ShiftRuleHeader shift={shift} variant="detailed" />
                    <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border border-border">
                            <AvatarFallback className={cn('text-xs font-bold', employeeName ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground')}>
                                {employeeName ? getInitials(employeeName) : <User className="h-4 w-4" />}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">{employeeName || 'Unassigned'}</p>
                            <p className="text-xs text-muted-foreground truncate">{roleName}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="bg-muted/50 rounded-lg px-3 py-1.5 flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-mono font-bold text-foreground">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            {totalHours && <Badge variant="secondary" className="text-xs">{totalHours}h net</Badge>}
                             {/* Cost Badge — shown for all shifts */}
                             {costBreakdown.totalCost > 0 && (
                                 <Tooltip>
                                     <TooltipTrigger asChild>
                                         <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 cursor-help hover:bg-emerald-500/20 transition-colors">
                                             <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                                 {employeeName ? '=' : '≈'} ${costBreakdown.totalCost.toFixed(2)}
                                             </span>
                                         </div>
                                     </TooltipTrigger>
                                     <TooltipContent className="bg-slate-900 text-white border-white/10 shadow-2xl" side="right">
                                         <CostBreakdownTooltip breakdown={costBreakdown} />
                                     </TooltipContent>
                                 </Tooltip>
                             )}
                        </div>
                    </div>

                    {hasComplianceIssue && (
                        <div className={cn('rounded-lg p-2.5 text-xs border', compliance?.status === 'violation' ? 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300')}>
                            <div className="flex items-center gap-1.5 font-semibold mb-1"><AlertTriangle className="h-3.5 w-3.5" />{compliance?.status === 'violation' ? 'Compliance Violation' : 'Compliance Warning'}</div>
                            <ul className="space-y-0.5 pl-5 list-disc">
                                {compliance?.violations.map((v, i) => <li key={`v-${i}`}>{v}</li>)}
                                {compliance?.warnings.map((w, i) => <li key={`w-${i}`}>{w}</li>)}
                            </ul>
                        </div>
                    )}

                    {shift.notes?.startsWith('Generated') ? (
                        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2.5 flex items-start gap-2 text-indigo-700 dark:text-indigo-300">
                            <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <p className="text-[11px] leading-relaxed font-medium">{shift.notes}</p>
                        </div>
                    ) : shift.notes ? (
                        <p className="text-xs text-muted-foreground italic truncate">{shift.notes}</p>
                    ) : null}

                    {/* Bidding Icon — floating in bottom right */}
                    {biddingUrgency && (
                        <div className="absolute bottom-2 right-2 z-30">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className={cn(
                                        "p-1.5 rounded-lg border flex items-center justify-center shadow-sm cursor-help hover:scale-105 transition-all duration-300",
                                        biddingUrgency === 'urgent' && "bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400",
                                        biddingUrgency === 'closed' && "bg-slate-500/10 border-slate-500/20 text-slate-500 dark:text-slate-400 opacity-60 hover:opacity-100",
                                        biddingUrgency === 'standard' && "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400"
                                    )}>
                                        <Gavel className="h-4.5 w-4.5" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-900 text-white border-none py-1.5 px-3 text-[10px] font-bold">
                                    {biddingUrgency === 'urgent' && 'Urgent Bidding Active'}
                                    {biddingUrgency === 'closed' && 'Bidding Closed (No Winner)'}
                                    {biddingUrgency === 'standard' && 'Bidding Active'}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    )}
                </div>
            </div>

            {/* DnD Blocking Overlay (highest layer) */}
            {isDnDActive && isLocked && isPublished && (
                <div
                    className="absolute inset-0 bg-stripe-red pointer-events-none rounded-inherit z-[100] border-2 border-red-500/50 shadow-[inset_0_0_20px_rgba(239,68,68,0.3)]"
                    aria-hidden="true"
                />
            )}
        </CardShell>
    );
};

const SmartShiftCardImpl: React.FC<SmartShiftCardProps> = (props) => {
    const { variant = 'compact' } = props;

    return variant === 'detailed' ? <DetailedCard {...props} /> : <CompactCard {...props} />;
};

export const SmartShiftCard = React.memo(SmartShiftCardImpl);

export default SmartShiftCard;
