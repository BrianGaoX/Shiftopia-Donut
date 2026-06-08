import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { usePerformanceMetrics, getMetricStatus, EMPTY_METRICS } from '@/modules/users/hooks/usePerformanceMetrics';
import { BarChart3, RefreshCw, Shield, Inbox, CheckCircle2, CalendarCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { cn } from '@/modules/core/lib/utils';

interface PerformanceSectionProps {
    employeeId: string;
    quarterYear: string;
}

/* ═══════════════════════════ STATUS COLORS ═══════════════════════════ */
const statusColors = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-500 dark:text-amber-400',
    critical: 'text-red-500 dark:text-red-400',
} as const;

const statusBg = {
    good: 'bg-emerald-500/10 border-emerald-500/20',
    warn: 'bg-amber-500/10 border-amber-500/20',
    critical: 'bg-red-500/10 border-red-500/20',
} as const;

/* ═══════════════════════════ METRIC CARD ═══════════════════════════ */
const MetricCard = ({
    label,
    value,
    metricType,
    suffix = '%',
    hasData = true,
}: {
    label: string;
    value: number;
    metricType: string;
    suffix?: string;
    hasData?: boolean;
}) => {
    const status = !hasData ? 'good' : getMetricStatus(metricType, value);

    return (
        <div className={cn(
            'rounded-lg border p-3 transition-colors',
            statusBg[status]
        )}>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest font-medium">{label}</p>
            <div className={cn('mt-1', !hasData ? 'text-muted-foreground' : statusColors[status])}>
                {!hasData ? (
                    <span className="text-[11px] uppercase tracking-wider font-semibold opacity-70">—</span>
                ) : (
                    <span className="text-2xl font-black tabular-nums">{value.toFixed(1)}{suffix}</span>
                )}
            </div>
        </div>
    );
};

/* ═══════════════════════════ COUNT PILL ═══════════════════════════ */
const CountPill = ({ label, value }: { label: string; value: number }) => (
    <div className="flex flex-col items-center">
        <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">{label}</span>
        <span className="text-sm font-black text-foreground tabular-nums">{value}</span>
    </div>
);

/* ═══════════════════════════ SECTION HEADER ═══════════════════════════ */
const SectionHeader = ({
    icon: Icon,
    label,
    color,
}: {
    icon: React.ElementType;
    label: string;
    color: string;
}) => (
    <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn('w-3.5 h-3.5', color)} />
        <h4 className={cn('text-[10px] font-bold uppercase tracking-widest', color)}>{label}</h4>
    </div>
);

/* ═══════════════════════════ MAIN COMPONENT ═══════════════════════════ */
const PerformanceSection: React.FC<PerformanceSectionProps> = ({ employeeId, quarterYear }) => {
    const queryClient = useQueryClient();
    const [isRefreshing, setIsRefreshing] = React.useState(false);

    const { data: fetchedMetrics, isLoading } = usePerformanceMetrics(employeeId, quarterYear);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            const { error } = await supabase.rpc('compute_employee_quarter_metrics', {
                p_employee_id: employeeId,
                p_quarter_year: quarterYear,
            });
            if (error) throw error;

            await queryClient.invalidateQueries({
                queryKey: ['performance_metrics', employeeId, quarterYear]
            });
        } catch (error) {
            console.error('Error refreshing metrics:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const m = fetchedMetrics ? { ...EMPTY_METRICS, ...fetchedMetrics } : EMPTY_METRICS;

    const assignedCount = m.shifts_assigned || 0;
    const offeredCount = (m as any).shifts_offered;

    const hasAssigned = assignedCount > 0;
    const hasOffered = offeredCount > 0;

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        Performance
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing || isLoading}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
                        title="Refresh metrics"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading performance metrics...</p>
                ) : (
                    <div className="space-y-4">

                        {/* ─── PRIMARY KPI: Reliability Score ─── */}
                        <div className={cn(
                            'rounded-xl border-2 p-4 text-center transition-all',
                            hasAssigned
                                ? statusBg[getMetricStatus('reliability_score', m.reliability_score)]
                                : 'bg-muted/30 border-border'
                        )}>
                            <div className="flex items-center justify-center gap-2 mb-1">
                                <Shield className={cn('w-5 h-5', hasAssigned ? statusColors[getMetricStatus('reliability_score', m.reliability_score)] : 'text-muted-foreground')} />
                                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Reliability Score</span>
                            </div>
                            <p className={cn(
                                'text-5xl font-black tabular-nums',
                                !hasAssigned ? 'text-muted-foreground text-3xl' : statusColors[getMetricStatus('reliability_score', m.reliability_score)]
                            )}>
                                {!hasAssigned ? '—' : `${m.reliability_score.toFixed(0)}%`}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                                {hasAssigned
                                    ? `Based on ${m.shifts_assigned} assigned shift${m.shifts_assigned !== 1 ? 's' : ''}`
                                    : 'No shift data yet'
                                }
                            </p>
                        </div>

                        {/* ─── OFFER BEHAVIOR ─── */}
                        <div>
                            <SectionHeader icon={Inbox} label="Offer Behavior" color="text-blue-500" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <MetricCard
                                    label="Acceptance"
                                    value={m.acceptance_rate}
                                    metricType="acceptance_rate"
                                    hasData={hasOffered}
                                />
                                <MetricCard
                                    label="Rejection"
                                    value={m.rejection_rate}
                                    metricType="rejection_rate"
                                    hasData={hasOffered}
                                />
                                <MetricCard
                                    label="Ignorance"
                                    value={m.offer_expiration_rate}
                                    metricType="offer_expiration_rate"
                                    hasData={hasOffered}
                                />
                            </div>
                        </div>

                        {/* ─── RELIABILITY ─── */}
                        <div>
                            <SectionHeader icon={Shield} label="Reliability" color="text-amber-500" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <MetricCard
                                    label="Standard Cancellation"
                                    value={m.cancellation_rate_standard}
                                    metricType="cancellation_rate_standard"
                                    hasData={hasAssigned}
                                />
                                <MetricCard
                                    label="Late Cancellation"
                                    value={m.cancellation_rate_late}
                                    metricType="cancellation_rate_late"
                                    hasData={hasAssigned}
                                />
                                <MetricCard
                                    label="Swap Ratio"
                                    value={m.swap_ratio}
                                    metricType="swap_ratio"
                                    hasData={hasAssigned}
                                />
                            </div>
                        </div>

                        {/* ─── ATTENDANCE ─── */}
                        <div>
                            <SectionHeader icon={CalendarCheck} label="Attendance" color="text-emerald-500" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <MetricCard
                                    label="Late Clock-Ins"
                                    value={m.late_clock_in_rate}
                                    metricType="late_clock_in_rate"
                                    hasData={hasAssigned}
                                />
                                <MetricCard
                                    label="Early Clock-Outs"
                                    value={m.early_clock_out_rate}
                                    metricType="early_clock_out_rate"
                                    hasData={hasAssigned}
                                />
                                <MetricCard
                                    label="No-Shows"
                                    value={m.no_show_rate}
                                    metricType="no_show_rate"
                                    hasData={hasAssigned}
                                />
                            </div>
                        </div>

                        {/* ─── SHIFT SUMMARY (counts) ─── */}
                        <div className="bg-muted/40 dark:bg-card/40 rounded-lg border border-border p-3">
                            <div className="flex items-center gap-1.5 mb-2">
                                <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Summary Metrics</span>
                            </div>
                            <div className="flex flex-wrap justify-start gap-4 px-2">
                                <CountPill label="No. of Shifts Offered" value={(m as any).shifts_offered} />
                                <CountPill label="No. of Shifts Currently Assigned" value={m.shifts_assigned} />
                                <CountPill label="No. of Times Emergency Assigned" value={m.emergency_assignments} />
                            </div>
                        </div>
                    </div>
                )}

                <p className="text-[10px] text-muted-foreground mt-2 text-right">
                    Last refreshed: {m.calculated_at ? new Date(m.calculated_at).toLocaleTimeString() : 'Never'}
                </p>
            </CardContent>
        </Card>
    );
};

export default PerformanceSection;
