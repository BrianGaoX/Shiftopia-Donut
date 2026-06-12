import React, { useState } from 'react';
import {
    Edit,
    Megaphone,
    Hourglass,
    CheckCircle,
    XCircle,
    Zap,
    Flame,
    Lock,
    ArrowLeftRight,
    ShieldAlert,
    ChevronDown,
    ChevronUp,
    HelpCircle,
    CopyPlus,
    Clock,
    UserPlus,
    Gavel,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface BadgeCodeItem {
    type: 'Planning' | 'Live' | 'Terminal' | 'System';
    dot?: string; // Hex color
    code?: string;
    icon: React.ReactNode;
    label: string;
    description: string;
}

// ============================================================================
// LEGEND DATA (Unified Source of Truth)
// ============================================================================

const BADGE_CODES: BadgeCodeItem[] = [
    // PLANNING
    { type: 'Planning', dot: '#3B82F6', code: 'S1-S5', icon: <Edit className="h-3 w-3" />, label: 'Normal', description: '> 24h until shift start' },
    { type: 'Planning', dot: '#F59E0B', code: 'S3-S5', icon: <Zap className="h-3 w-3" />, label: 'Urgent', description: '< 24h until shift start' },
    { type: 'Planning', dot: '#EF4444', code: 'S3-S6', icon: <Flame className="h-3 w-3" />, label: 'Emergency', description: '< 4h until start (Locks S1 Publication)' },
    
    // LIVE — ARRIVAL BADGE
    { type: 'Live', dot: '#6366F1', code: 'S11', icon: <Hourglass className="h-3 w-3" />, label: 'Early In', description: 'Clocked in > 5m before start' },
    { type: 'Live', dot: '#22C55E', code: 'S11', icon: <Hourglass className="h-3 w-3" />, label: 'On Time In', description: 'Clocked in within 5m window' },
    { type: 'Live', dot: '#F59E0B', code: 'S11', icon: <Hourglass className="h-3 w-3" />, label: 'Late In', description: 'Clocked in > 5m after start' },
    { type: 'Live', dot: '#EAB308', code: 'S11', icon: <Clock className="h-3 w-3" />, label: 'Missing', description: 'Start time passed; no clock-in recorded' },
    { type: 'Terminal', dot: '#7F1D1D', code: 'S13', icon: <XCircle className="h-3 w-3" />, label: 'No Show', description: 'Shift ended; never clocked in' },

    // LIVE — DEPARTURE BADGE
    { type: 'Terminal', dot: '#14B8A6', code: 'S13', icon: <CheckCircle className="h-3 w-3" />, label: 'Early Out', description: 'Clocked out > 5m before scheduled end' },
    { type: 'Terminal', dot: '#22C55E', code: 'S13', icon: <CheckCircle className="h-3 w-3" />, label: 'On Time Out', description: 'Clocked out within 5m window' },
    { type: 'Terminal', dot: '#8B5CF6', code: 'S13', icon: <CheckCircle className="h-3 w-3" />, label: 'Late Out', description: 'Clocked out > 5m after scheduled end' },
    { type: 'Terminal', dot: '#F97316', code: 'S13', icon: <Clock className="h-3 w-3" />, label: 'Working Overtime', description: 'Still clocked in past scheduled end' },
    { type: 'Terminal', dot: '#A855F7', code: 'S13', icon: <CheckCircle className="h-3 w-3" />, label: 'Auto Clock-Out', description: 'System-enforced auto clock-out' },
    
    // SYSTEM SIGNALS
    { type: 'System', code: 'S9/S10', icon: <ArrowLeftRight className="h-3 w-3" />, label: 'Trading', description: 'Shift swap or trade request active' },
    { type: 'System', code: 'S5', icon: <Gavel className="h-3 w-3" />, label: 'Bidding', description: 'Open for employee expressions of interest' },
    { type: 'System', code: '-', icon: <ShieldAlert className="h-3 w-3" />, label: 'Violation', description: 'Compliance breech (Rest/Length/Skills)' },
    { type: 'System', code: '-', icon: <CopyPlus className="h-3 w-3" />, label: 'Template', description: 'Generated from an institutional roster' },
    { type: 'System', code: '-', icon: <Lock className="h-3 w-3" />, label: 'Locked', description: 'Locked by manager or institutional rule' },
];

// ============================================================================
// PROPS
// ============================================================================

export interface ShiftCardLegendProps {
    className?: string;
    defaultCollapsed?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const ShiftCardLegend: React.FC<ShiftCardLegendProps> = ({
    className,
    defaultCollapsed = true,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

    return (
        <div className={cn(
            'rounded-xl border border-slate-200 dark:border-white/10 bg-white/40 dark:bg-black/20 backdrop-blur-xl overflow-hidden transition-all duration-300',
            className
        )}>
            {/* Toggle Header */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                        <HelpCircle className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col items-start leading-tight">
                        <span className="text-[11px] font-black uppercase tracking-widest text-foreground">Badge Legend</span>
                        <span className="text-[9px] font-medium text-muted-foreground/60 uppercase">Indicator & Status Reference</span>
                    </div>
                </div>
                {isCollapsed ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground/40" />
                ) : (
                    <ChevronUp className="h-4 w-4 text-muted-foreground/40" />
                )}
            </button>

            {/* Legend Body - Detailed Table */}
            {!isCollapsed && (
                <div className="px-1 pb-1">
                    <div className="overflow-x-auto rounded-lg border border-border/40 bg-card/30">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-muted/30">
                                    <th className="px-3 py-2 text-[9px] font-black uppercase tracking-tighter text-muted-foreground/50 border-b border-border/40">Status</th>
                                    <th className="px-2 py-2 text-[9px] font-black uppercase tracking-tighter text-muted-foreground/50 border-b border-border/40 text-center">Dot</th>
                                    <th className="px-2 py-2 text-[9px] font-black uppercase tracking-tighter text-muted-foreground/50 border-b border-border/40 text-center">Code</th>
                                    <th className="px-3 py-2 text-[9px] font-black uppercase tracking-tighter text-muted-foreground/50 border-b border-border/40">Trigger / Context</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {BADGE_CODES.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-primary/5 transition-colors group">
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1 rounded bg-black/5 dark:bg-white/5 text-muted-foreground group-hover:text-foreground transition-colors">
                                                    {item.icon}
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-tight text-foreground/80 break-keep">
                                                    {item.label}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-2.5 text-center">
                                            {item.dot ? (
                                                <div 
                                                    className="inline-block h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.2)] ring-1 ring-black/10" 
                                                    style={{ backgroundColor: item.dot }} 
                                                />
                                            ) : (
                                                <span className="text-[8px] text-muted-foreground/30">—</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2.5 text-center font-mono">
                                            <span className={cn(
                                                "text-[9px] font-black px-1 py-0.5 rounded leading-none transition-all",
                                                item.code !== '-' ? "bg-black/10 dark:bg-white/10 text-foreground/60 group-hover:bg-primary/20 group-hover:text-primary" : "text-muted-foreground/20"
                                            )}>
                                                {item.code}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <p className="text-[9px] font-medium text-muted-foreground/70 leading-[1.3] group-hover:text-muted-foreground transition-colors">
                                                {item.description}
                                            </p>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShiftCardLegend;
