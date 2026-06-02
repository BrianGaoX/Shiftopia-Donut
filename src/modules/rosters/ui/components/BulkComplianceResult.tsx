import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock,
    Shield,
    Users,
    Zap,
    Calendar,
    Coffee,
    Moon
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    BulkComplianceCheckResponse,
    BulkShiftComplianceResult,
    BulkRuleDetail
} from '@/modules/compliance';
import { StudentVisaViz, DailyHoursViz, StreakViz, ShiftLengthViz, RestPeriodViz } from './ComplianceVisuals';

interface BulkComplianceResultProps {
    response: BulkComplianceCheckResponse;
    shifts: { id: string; shift_date: string; start_time: string; end_time: string }[];
    onPartialApplyChange?: (enabled: boolean) => void;
    partialApplyEnabled: boolean;
}

interface RuleGroup {
    ruleId: string;
    ruleName: string;
    blocking: boolean;
    status: 'FAIL' | 'WARNING' | 'PASS';
    explanation: string;
    affectedV8ShiftIds: Set<string>;
    data?: any; // Data from the first violation for viz
    // Aggregated daily data for MAX_DAILY_HOURS
    dailyData?: Map<string, { existing: number; candidate: number; limit: number }>;
    // Aggregated shift length data for MAX_SHIFT_LENGTH
    shiftLengthData?: { date: string; time: string; net_hours: number }[];
    // Aggregated rest impact data for MIN_REST_GAP
    restImpactData?: {
        date: string;
        shift_time: string;
        rest_before_hours: number | null;
        rest_after_hours: number | null;
        limit: number
    }[];
}

export const BulkComplianceResult: React.FC<BulkComplianceResultProps> = ({
    response,
    shifts,
    onPartialApplyChange,
    partialApplyEnabled
}) => {
    // Group results by Rule - SHOW ALL RULES (pass, warning, fail)
    const ruleGroups = React.useMemo(() => {
        const groups: Map<string, RuleGroup> = new Map();

        response.results.forEach(result => {
            // Find the shift for this result to get date/time info
            const shift = shifts.find(s => s.id === result.shiftId);

            // Process ALL results, not just failures
            result.details.forEach(detail => {
                const existing = groups.get(detail.ruleId) || {
                    ruleId: detail.ruleId,
                    ruleName: getRuleName(detail.ruleId),
                    blocking: detail.blocking,
                    status: detail.status === 'FAIL' ? 'FAIL' : detail.status === 'WARNING' ? 'WARNING' : 'PASS',
                    explanation: detail.explanation,
                    affectedV8ShiftIds: new Set(),
                    data: detail.data,
                    dailyData: new Map(),
                    shiftLengthData: [] as { date: string; time: string; net_hours: number }[],
                    restImpactData: [] as { date: string; shift_time: string; rest_before_hours: number | null; rest_after_hours: number | null; limit: number }[]
                };

                // Upgrade status: FAIL > WARNING > PASS
                if (detail.status === 'FAIL') {
                    existing.status = 'FAIL';
                } else if (detail.status === 'WARNING' && existing.status === 'PASS') {
                    existing.status = 'WARNING';
                }
                if (detail.blocking && detail.status === 'FAIL') existing.blocking = true;

                // Track ALL affected shifts (not just failures) so user can see what was checked
                existing.affectedV8ShiftIds.add(result.shiftId);

                // For MAX_DAILY_HOURS: aggregate per-day data
                if (detail.ruleId === 'MAX_DAILY_HOURS' && detail.data) {
                    const targetDate = detail.data.target_date || detail.data.date;
                    if (targetDate && existing.dailyData) {
                        const existingDay = existing.dailyData.get(targetDate) || { existing: 0, candidate: 0, limit: detail.data.limit || 12 };
                        existingDay.candidate += detail.data.candidate_hours || 0;
                        existingDay.existing = detail.data.existing_hours || existingDay.existing;
                        existing.dailyData.set(targetDate, existingDay);
                    }
                }

                // For MAX_SHIFT_LENGTH: collect individual shift data
                if (detail.ruleId === 'MAX_SHIFT_LENGTH' && detail.data && shift) {
                    existing.shiftLengthData?.push({
                        date: shift.shift_date,
                        time: `${shift.start_time} - ${shift.end_time}`,
                        net_hours: detail.data.candidate_hours || detail.data.total_hours || 0
                    });
                }

                // For MIN_REST_GAP: collect rest impact data
                if (detail.ruleId === 'MIN_REST_GAP' && detail.data && shift) {
                    existing.restImpactData?.push({
                        date: shift.shift_date,
                        shift_time: `${shift.start_time} - ${shift.end_time}`,
                        rest_before_hours: detail.data.prev_day_gap_hours ?? null,
                        rest_after_hours: detail.data.next_day_gap_hours ?? null,
                        limit: detail.data.limit || 8
                    });
                }

                groups.set(detail.ruleId, existing);
            });
        });

        // Convert to array and sort (Blocking first, then Warnings, then Pass)
        return Array.from(groups.values()).sort((a, b) => {
            // Blocking failures first
            if (a.blocking && a.status === 'FAIL' && !(b.blocking && b.status === 'FAIL')) return -1;
            if (b.blocking && b.status === 'FAIL' && !(a.blocking && a.status === 'FAIL')) return 1;
            // Then warnings
            if (a.status === 'WARNING' && b.status === 'PASS') return -1;
            if (b.status === 'WARNING' && a.status === 'PASS') return 1;
            // Pass last
            if (a.status === 'PASS' && b.status !== 'PASS') return 1;
            if (b.status === 'PASS' && a.status !== 'PASS') return -1;
            return 0;
        });
    }, [response]);

    // FIXED: Only count rules that are blocking AND actually failed
    const blockingCount = ruleGroups.filter(g => g.blocking && g.status === 'FAIL').length;
    const warningCount = ruleGroups.filter(g => g.status === 'WARNING').length;
    const affectedShiftTotal = new Set(ruleGroups.flatMap(g => Array.from(g.affectedV8ShiftIds))).size;

    return (
        <div className="space-y-6">
            {/* Decision Banner */}
            <div className={cn(
                "p-4 rounded-xl border-2 flex items-start gap-3",
                blockingCount > 0
                    ? "bg-red-950/30 border-red-500/30"
                    : warningCount > 0
                        ? "bg-amber-950/30 border-amber-500/30"
                        : "bg-emerald-950/30 border-emerald-500/30"
            )}>
                <div className={cn(
                    "p-2 rounded-lg bg-black/20",
                    blockingCount > 0 ? "text-red-400" : warningCount > 0 ? "text-amber-400" : "text-emerald-400"
                )}>
                    {blockingCount > 0 ? <AlertTriangle className="h-6 w-6" /> : warningCount > 0 ? <AlertTriangle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                </div>
                <div className="flex-1">
                    <h3 className={cn(
                        "text-lg font-semibold",
                        blockingCount > 0 ? "text-red-100" : "text-white"
                    )}>
                        {blockingCount > 0
                            ? "Bulk assignment cannot be completed"
                            : warningCount > 0
                                ? "Bulk assignment has warnings"
                                : "Bulk assignment is compliant"}
                    </h3>
                    <p className="text-white/60 text-sm mt-1">
                        {blockingCount > 0
                            ? `${blockingCount} blocking issues causing ${affectedShiftTotal} shifts to fail.`
                            : warningCount > 0
                                ? `${warningCount} warnings detected. You can still proceed.`
                                : "All checks passed. You can proceed with assignment."}
                    </p>
                </div>
            </div>

            {/* Rule Groups List */}
            <div className="space-y-3">
                {ruleGroups.map((group) => (
                    <RuleGroupCard
                        key={group.ruleId}
                        group={group}
                        allShifts={shifts}
                    />
                ))}
            </div>

            {ruleGroups.length === 0 && (
                <div className="text-center py-8 text-white/30 italic">
                    No compliance issues detected.
                </div>
            )}
        </div>
    );
};

const RuleGroupCard: React.FC<{ group: RuleGroup, allShifts: any[] }> = ({ group, allShifts }) => {
    // Only auto-expand blocking failures, not warnings or passes
    const [expanded, setExpanded] = useState(group.blocking && group.status === 'FAIL');

    // Find affected shifts details
    const affectedShifts = allShifts.filter(s => group.affectedV8ShiftIds.has(s.id));

    // Determine colors based on status
    const getStatusColors = () => {
        if (group.status === 'PASS') {
            return {
                bg: 'bg-emerald-950/10 border-emerald-500/20',
                icon: 'text-emerald-400',
                badge: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
                label: 'PASS'
            };
        }
        if (group.blocking && group.status === 'FAIL') {
            return {
                bg: 'bg-red-950/10 border-red-500/20',
                icon: 'text-red-400',
                badge: 'border-red-500/30 text-red-400 bg-red-500/10',
                label: 'BLOCKING'
            };
        }
        return {
            bg: 'bg-amber-950/10 border-amber-500/20',
            icon: 'text-amber-400',
            badge: 'border-amber-500/30 text-amber-400 bg-amber-500/10',
            label: 'WARNING'
        };
    };

    const colors = getStatusColors();

    // Helper to render specific viz (show for ALL statuses including PASS)
    const renderViz = () => {
        switch (group.ruleId) {
            case 'STUDENT_VISA_48H':
                return group.data ? <StudentVisaViz data={group.data} /> : null;
            case 'MAX_DAILY_HOURS':
                // Use aggregated daily data if available
                if (group.dailyData && group.dailyData.size > 0) {
                    return <DailyHoursViz dailyData={group.dailyData} />;
                }
                return group.data ? <DailyHoursViz data={group.data} /> : null;
            case 'MAX_CONSECUTIVE_DAYS':
                // Pass all_working_dates from calculation data
                if (group.data) {
                    return <StreakViz data={{
                        all_working_dates: group.data.all_working_dates,
                        streak_start: group.data.streak_start,
                        streak_end: group.data.streak_end,
                        limit: group.data.limit || 12
                    }} />;
                }
                return null;
            case 'MAX_SHIFT_LENGTH':
                // Use aggregated shift length data
                if (group.shiftLengthData && group.shiftLengthData.length > 0) {
                    return <ShiftLengthViz aggregatedShifts={group.shiftLengthData} data={{ limit: group.data?.limit || 12 }} />;
                }
                return group.data ? <ShiftLengthViz data={group.data} /> : null;
            case 'MIN_REST_GAP':
                // Use aggregated rest impact data
                if (group.restImpactData && group.restImpactData.length > 0) {
                    return <RestPeriodViz restImpacts={group.restImpactData} />;
                }
                return group.data ? <RestPeriodViz data={group.data} /> : null;
            default:
                return null;
        }
    };

    // Determine if we should hide the "Affected Shifts" section for this rule
    // (when we have a dedicated visualization that shows the data better)
    const hideAffectedShifts = ['MAX_CONSECUTIVE_DAYS', 'MAX_SHIFT_LENGTH', 'MIN_REST_GAP'].includes(group.ruleId);

    return (
        <div className={cn(
            "rounded-lg border transition-all overflow-hidden",
            colors.bg
        )}>
            {/* Header */}
            <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/5"
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <ChevronDown className="h-4 w-4 text-white/40" /> : <ChevronRight className="h-4 w-4 text-white/40" />}

                <div className={cn(
                    "h-8 w-8 rounded flex items-center justify-center bg-black/20",
                    colors.icon
                )}>
                    {group.status === 'PASS' ? <CheckCircle2 className="h-4 w-4" /> : getIcon(group.ruleId)}
                </div>

                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium text-white text-sm">{group.ruleName}</h4>
                        <Badge variant="outline" className={cn(
                            "text-[10px] h-5",
                            colors.badge
                        )}>
                            {colors.label}
                        </Badge>
                    </div>
                </div>
            </div>

            {/* Content - show for ALL statuses when expanded */}
            {expanded && (
                <div className="px-4 pb-4 pl-14 space-y-4">
                    <p className="text-sm text-white/70">{group.explanation}</p>

                    {/* Visual Evidence */}
                    {renderViz() && (
                        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                            {renderViz()}
                        </div>
                    )}

                    {/* Affected Shifts List - hide for rules with dedicated visualizations */}
                    {!hideAffectedShifts && affectedShifts.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-white/50 mb-2 uppercase tracking-wide">
                                Affected Shifts ({affectedShifts.length})
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {affectedShifts.map(shift => (
                                    <div key={shift.id} className="flex flex-col bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-xs">
                                        <span className="text-white/80 font-medium">
                                            {format(parseISO(shift.shift_date), 'MMM d')}
                                        </span>
                                        <span className="text-white/50 text-[10px]">
                                            {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Simple pass message */}
            {expanded && group.status === 'PASS' && (
                <div className="px-4 pb-4 pl-14">
                    <p className="text-sm text-emerald-400/70">✓ All shifts comply with this rule</p>
                </div>
            )}
        </div>
    );
};

function getIcon(ruleId: string) {
    switch (ruleId) {
        case 'MAX_DAILY_HOURS': return <Clock className="h-4 w-4" />;
        case 'MIN_REST_GAP': return <Moon className="h-4 w-4" />;
        case 'STUDENT_VISA_48H': return <Zap className="h-4 w-4" />;
        case 'MAX_CONSECUTIVE_DAYS': return <Calendar className="h-4 w-4" />;
        case 'BREAK_REQUIREMENTS': return <Coffee className="h-4 w-4" />;
        default: return <Shield className="h-4 w-4" />;
    }
}

function getRuleName(ruleId: string) {
    switch (ruleId) {
        case 'STUDENT_VISA_48H': return 'Student Visa - 8202 (Rolling Fortnight)';
        case 'MAX_DAILY_HOURS': return 'Maximum Daily Hours';
        case 'MAX_CONSECUTIVE_DAYS': return 'Consecutive Working Days';
        case 'MIN_REST_GAP': return 'Minimum Rest Period';
        case 'BREAK_REQUIREMENTS': return 'Break Requirements';
        case 'OVERLAPPING_SHIFTS': return 'Overlapping Shifts';
        default: return ruleId.replace(/_/g, ' ');
    }
}
