import React, { forwardRef } from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import {
    Clock,
    Calendar,
    Building2,
    ShieldCheck,
    ArrowLeftRight,
    MapPin,
    Signal,
    Zap,
    Lock,
    Flame,
} from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { getStatusDotInfo, getProtectionContext } from '@/modules/rosters/domain/shift-ui';

export interface SharedShiftCardProps {
    organization: string;
    department: string;
    subGroup?: string;
    role: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    netLength: number; // in minutes
    paidBreak: number;
    unpaidBreak: number;
    timerText?: string | null;
    isExpired?: boolean;
    lifecycleStatus?: string;
    isUrgent?: boolean;
    /** Full three-zone urgency badge. When provided, supersedes isUrgent. */
    urgency?: ShiftUrgency;
    groupVariant?: 'convention' | 'exhibition' | 'theatre' | 'default';
    complianceLabel?: string;
    isPast?: boolean;
    statusIcons?: React.ReactNode;
    footerActions?: React.ReactNode;
    topContent?: React.ReactNode;
    className?: string;
    onClick?: () => void;
    variant?: 'default' | 'nested' | 'timecard';
    /** Standardised shift for status dot derivation */
    shiftData?: any;
    /** Removes outer border, shadow and background for seamless embedding */
    isFlat?: boolean;
    /** Attendance / Timesheet specific data */
    employeeName?: string;
    avatarUrl?: string;
    clockIn?: string | null;
    clockOut?: string | null;
    adjustedStart?: string | null;
    adjustedEnd?: string | null;
    estimatedPay?: React.ReactNode;
}

const DataRow: React.FC<{
    label: string;
    value: React.ReactNode;
    emphasis?: boolean;
    accentColor?: string;
}> = ({ label, value, emphasis, accentColor }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-foreground/[0.04] last:border-0">
        <span className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
            {label}
        </span>
        <div className={cn(
            "tabular-nums tracking-tight font-black font-mono flex items-center gap-2 text-right justify-end",
            emphasis ? "text-[14px] text-foreground" : "text-[12px] text-foreground/70",
            accentColor
        )}>
            {value}
        </div>
    </div>
);

export const SharedShiftCard = forwardRef<HTMLDivElement, SharedShiftCardProps>(({
    avatarUrl,
    organization,
    department,
    subGroup,
    role,
    shiftDate,
    startTime,
    endTime,
    netLength,
    paidBreak,
    unpaidBreak,
    timerText,
    isExpired,
    lifecycleStatus = 'Published',
    isUrgent,
    urgency,
    groupVariant = 'default',
    complianceLabel = 'Compliant',
    isPast = false,
    statusIcons,
    footerActions,
    topContent,
    className,
    onClick,
    variant = 'default',
    shiftData,
    isFlat = false,
    employeeName,
    clockIn,
    clockOut,
    adjustedStart,
    adjustedEnd,
    estimatedPay,
}, ref) => {
    const protection = React.useMemo(() => getProtectionContext(
        { lifecycle_status: lifecycleStatus as 'Draft' | 'Published' | 'InProgress' | 'Completed' | 'Cancelled' },
        isPast
    ), [lifecycleStatus, isPast]);

    // Premium Department Color Styling (Badges)
    const getTheme = () => {
        const base = 'dept-card-glass-base';
        switch (groupVariant) {
            case 'convention': return { 
                badge: 'dept-badge-convention', 
                cardBg: `${base} dept-card-glass-convention`,
                accent: 'text-blue-500',
                color: '#2563eb',
                secondary: '#3b82f6',
                atmosphere: ['#1d4ed8', '#2563eb', '#60a5fa'],
            };
            case 'exhibition': return { 
                badge: 'dept-badge-exhibition', 
                cardBg: `${base} dept-card-glass-exhibition`,
                accent: 'text-emerald-500',
                color: '#10b981',
                secondary: '#059669',
                atmosphere: ['#059669', '#10b981', '#34d399'],
            };
            case 'theatre': return { 
                badge: 'dept-badge-theatre', 
                cardBg: `${base} dept-card-glass-theatre`,
                accent: 'text-rose-500',
                color: '#ef4444',
                secondary: '#dc2626',
                atmosphere: ['#991b1b', '#ef4444', '#f87171'],
            };
            default: return { 
                badge: 'dept-badge-default', 
                cardBg: `${base} dept-card-glass-default`,
                accent: 'text-primary',
                color: '#9333ea',
                secondary: '#a855f7',
                atmosphere: ['#7e22ce', '#9333ea', '#c084fc'],
            };
        }
    };

    const isNested = variant === 'nested';
    const isTimecard = variant === 'timecard';
    const theme = getTheme();

    const breadcrumbs = (
        <div className={cn(
            "text-[9px] mb-1 tracking-tight font-mono font-black uppercase flex items-center gap-1",
            isTimecard ? "text-foreground/30" : "text-muted-foreground/40"
        )}>
            <span>{organization}</span>
            <span className="text-primary/30">→</span>
            <span>{department}</span>
            {subGroup && subGroup !== 'General' && (
                <>
                    <span className="text-primary/30">→</span>
                    <span>{subGroup}</span>
                </>
            )}
        </div>
    );

    const statusDotInfo = shiftData ? getStatusDotInfo(shiftData) : null;

    const statusDot = (() => {
        if (!statusDotInfo) return null;
        return (
            <div className="flex items-center gap-2">
                <div
                    className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.3)]"
                    style={{ backgroundColor: statusDotInfo.color }}
                />
                <span className="text-[10px] font-black font-mono text-foreground uppercase tracking-widest">
                    {statusDotInfo.label}
                </span>
            </div>
        );
    })();

    if (isTimecard) {
        return (
                <div
                    ref={ref}
                    className={cn(
                        'relative overflow-hidden transition-all duration-500',
                        !isFlat && 'rounded-[32px] border backdrop-blur-3xl bg-white/65 dark:bg-zinc-950/95 shadow-lg',
                        isFlat && 'bg-transparent border-none shadow-none rounded-none',
                        (isExpired || (isPast && protection.status === 'LOCKED')) && "opacity-60 grayscale-[0.5]",
                        className
                    )}
                    style={!isFlat ? {
                        borderColor: 'rgba(120, 120, 120, 0.08)',
                        boxShadow: '0 8px 32px -4px rgba(0,0,0,0.1)',
                    } : undefined}
                >
                {/* Glows */}
                <div 
                    style={{ 
                        background: `radial-gradient(circle at center, ${theme.atmosphere[0]}, ${theme.atmosphere[1]}, ${theme.atmosphere[2]})`,
                        mixBlendMode: 'screen'
                    }}
                    className="absolute -top-32 -right-32 w-96 h-96 blur-[120px] opacity-[0.35] dark:opacity-[0.2] pointer-events-none" 
                />

                <div className="px-6 py-6 relative z-20 flex flex-col h-full">
                    {topContent && (
                        <div className="mb-1.5">
                            {topContent}
                        </div>
                    )}
                    <div className="mb-2">
                        {breadcrumbs}
                        <div className="flex items-center justify-between gap-4 mt-2">
                            <div className="flex-1 min-w-0">
                                <h1 className="text-[16px] font-black text-foreground tracking-tight leading-tight uppercase font-mono truncate">
                                    {role}
                                </h1>
                                {employeeName && (
                                    <div className="flex items-center gap-2 mt-1">
                                        {avatarUrl && (
                                            <div className="h-4 w-4 rounded-full overflow-hidden ring-1 ring-primary/20">
                                                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                                            </div>
                                        )}
                                        <p className="text-[11px] font-black text-primary/60 uppercase tracking-[0.2em] font-mono">
                                            {employeeName}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-0 mb-4 bg-foreground/[0.02] dark:bg-white/[0.02] p-4 rounded-2xl border border-foreground/[0.03]">
                        <DataRow label="Shift Date" value={shiftDate} emphasis />
                        <DataRow label="Scheduled" value={`${startTime} – ${endTime}`} emphasis />
                        <DataRow label="Breaks" value={`Paid ${paidBreak}m · Unpaid ${unpaidBreak}m`} />
                        <DataRow 
                            label="Net Length" 
                            value={(() => {
                                const h = Math.floor(netLength / 60);
                                const m = Math.round(netLength % 60);
                                return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                            })()} 
                            accentColor={theme.accent} 
                        />
                        
                        {(clockIn || clockOut || adjustedStart || adjustedEnd) && (
                            <div className="pt-1.5 mt-1.5 border-t border-foreground/[0.03] space-y-0">
                                {(clockIn || clockOut) && (
                                    <DataRow 
                                        label="Actual In / Out" 
                                        value={`${clockIn || '--:--'} – ${clockOut || '--:--'}`} 
                                    />
                                )}
                                {(adjustedStart || adjustedEnd) && (
                                    <DataRow 
                                        label="Billable In / Out" 
                                        value={`${adjustedStart || '--:--'} – ${adjustedEnd || '--:--'}`} 
                                        accentColor="text-indigo-500"
                                    />
                                )}
                            </div>
                        )}

                        {estimatedPay && (
                            <div className="pt-1.5 mt-1.5 border-t border-foreground/[0.03]">
                                <DataRow label="Estimated Pay" value={estimatedPay} emphasis accentColor="text-emerald-500" />
                            </div>
                        )}

                        {statusDot && (
                            <div className="mt-1 pt-1 border-t border-foreground/[0.01]">
                                <DataRow label="Live Status" value={statusDot} />
                            </div>
                        )}
                    </div>

                    {/* COUNTDOWN (for offers) */}
                    {timerText && (
                        <div className={cn(
                            "mb-6 px-4 py-3 rounded-2xl text-[11px] font-black font-mono flex items-center justify-between tracking-tight transition-all",
                            isExpired 
                                ? "bg-rose-500/10 text-rose-500 border border-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.15)]" 
                                : "bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
                        )}>
                            <div className="flex items-center gap-2.5">
                                <Clock className={cn("w-3.5 h-3.5", !isExpired && "animate-pulse")} />
                                <span className="uppercase tracking-widest">{isExpired ? 'OFFER CLOSED' : 'OFFER EXPIRES'}</span>
                            </div>
                            <span className="bg-foreground/5 px-2.5 py-1 rounded-full text-[10px]">
                                {isExpired ? 'EXPIRED' : timerText}
                            </span>
                        </div>
                    )}

                    {statusIcons && (
                        <div className="grid grid-cols-3 gap-2 mb-2">
                            {statusIcons}
                        </div>
                    )}

                    <div className="flex-1" />

                    {footerActions && (
                        <div className="pt-2">
                            {footerActions}
                        </div>
                    )}
                </div>
                </div>
        );
    }

    const content = (
        <>
            {/* Optional TOP Content (e.g. Checkbox) */}
            {topContent && (
                <div className="px-4 pt-3">
                    {topContent}
                </div>
            )}

            {/* COMPACT BODY (px-4 py-3) */}
            <div className={cn("px-4 py-3 flex flex-col flex-1", isNested && "px-0 py-0")}>
                {/* BREADCRUMB */}
                {breadcrumbs}

                {/* ROLE + PRIORITY */}
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                        <h3 className="font-black text-sm text-foreground/90 tracking-tight leading-tight uppercase font-mono truncate">
                            {role}
                        </h3>
                        {employeeName && (
                            <p className="text-[9px] font-black text-primary/60 uppercase tracking-widest mt-0.5 font-mono">
                                {employeeName}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {statusDot}
                    </div>
                </div>

                {/* TIMING BOXES */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {/* Date */}
                    <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-lg border border-border/50 backdrop-blur-sm">
                        <Calendar className="h-3 w-3 text-primary/60" />
                        <span className="text-[10px] font-black font-mono tracking-tight leading-none uppercase">{shiftDate}</span>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-lg border border-border/50 backdrop-blur-sm">
                        <Clock className="h-3 w-3 text-primary/60" />
                        <span className="text-[10px] font-black font-mono tracking-tight leading-none uppercase">{startTime} – {endTime}</span>
                    </div>

                    {/* Clock In/Out compact */}
                    {(clockIn || clockOut) && (
                        <div className="flex items-center gap-1.5 bg-indigo-500/10 px-2 py-1 rounded-lg border border-indigo-500/20 backdrop-blur-sm">
                            <Signal className="h-3 w-3 text-indigo-500/60" />
                            <span className="text-[10px] font-black font-mono tracking-tight leading-none uppercase text-indigo-500/80">
                                {clockIn || '--:--'} – {clockOut || '--:--'}
                            </span>
                        </div>
                    )}
                </div>

                {/* BREAKS & LENGTH */}
                <div className="flex items-center gap-2 mb-3 text-[9px] tracking-widest text-muted-foreground/50 uppercase font-black">
                    <div className="flex items-center gap-1">
                        <span className="font-black font-mono">Paid {paidBreak}m · Unpaid {unpaidBreak}m</span>
                    </div>
                    <span className="text-border">|</span>
                    <span className="text-primary font-black font-mono">
                        Net Length: {(() => {
                            const h = Math.floor(netLength / 60);
                            const m = Math.round(netLength % 60);
                            return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                        })()}
                    </span>
                </div>

                {estimatedPay && (
                    <div className="mb-3 px-3 py-2 bg-emerald-500/5 border border-emerald-500/10 rounded-xl flex items-center justify-between">
                        <span className="text-[10px] font-black text-emerald-500/60 uppercase tracking-widest">Est. Pay</span>
                        <div className="text-sm font-black text-emerald-500 tabular-nums">
                            {estimatedPay}
                        </div>
                    </div>
                )}

                {/* COUNTDOWN */}
                {timerText && (
                    <div className={cn(
                        "mb-3 px-3 py-1.5 rounded-lg text-[10px] font-black font-mono flex items-center gap-2 tracking-tight transition-colors",
                        isExpired 
                            ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" 
                            : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                    )}>
                        <Clock className="w-3 h-3" />
                        <span className="uppercase">{isExpired ? 'CLOSED' : timerText}</span>
                    </div>
                )}

                {/* STATUS INDICATORS GRID (3x2) */}
                {statusIcons && (
                    <div className="pt-3 border-t border-border/20">
                        <div className="grid grid-cols-3 gap-y-2 gap-x-1 text-center items-center">
                            {statusIcons}
                        </div>
                    </div>
                )}
            </div>

            {/* ACTION FOOTER */}
            {footerActions && (
                <div className="p-2 pt-0 w-full">
                    {footerActions}
                </div>
            )}
        </>
    );

    if (isNested) {
        return (
            <div 
                ref={ref}
                className={cn("flex flex-col h-full", className)} 
                onClick={onClick}
            >
                {content}
            </div>
        );
    }

    return (
        <div
            ref={ref}
            onClick={onClick}
            className={cn(
                "group flex flex-col overflow-hidden transition-all duration-300 h-full relative",
                !isFlat && theme.cardBg,
                !isFlat && "rounded-[1.2rem] border border-border/50 shadow-lg",
                isFlat && "rounded-none border-none bg-transparent backdrop-blur-none shadow-none",
                onClick && !isFlat && "cursor-pointer hover:shadow-2xl hover:translate-y-[-2px] hover:border-primary/40",
                (isExpired || (isPast && protection.status === 'LOCKED')) && "opacity-60 grayscale-[0.8]",
                className
            )}
        >
            {content}
        </div>
    );
});
