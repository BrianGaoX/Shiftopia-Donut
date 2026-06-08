import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';

import {
    PerformanceMetrics,
    EmployeePerformanceRow,
    PerformanceFilters,
    PerformanceTrendPoint,
    PerformanceEventTimelineItem
} from '../model/performance.types';

export type {
    PerformanceMetrics,
    EmployeePerformanceRow,
    PerformanceFilters,
    PerformanceTrendPoint,
    PerformanceEventTimelineItem
};

// Backward-compat alias — PerformancePage and WorkforceTab import this type
export type QuarterlyReportRow = EmployeePerformanceRow;

// ---------------------------------------------------------------------------
// EmployeeMetricsSnapshot — typed to match employee_performance_metrics columns
// ---------------------------------------------------------------------------
export interface EmployeeMetricsSnapshot {
    id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    quarter_year: string;
    is_locked: boolean;

    // Raw counts
    total_offers: number;
    shifts_accepted: number;
    shifts_rejected: number;
    shifts_assigned: number;
    emergency_assignments: number;
    shifts_worked: number;
    shifts_swapped: number;
    shifts_dropped: number;
    standard_cancellations: number;
    late_cancellations: number;
    no_shows: number;
    offer_expirations: number;
    early_clock_outs: number;
    late_clock_ins: number;

    // Calculated rates (%)
    acceptance_rate: number;
    drop_rate: number;
    rejection_rate: number;
    offer_expiration_rate: number;
    cancellation_rate_standard: number;
    cancellation_rate_late: number;
    swap_ratio: number;
    reliability_score: number;
    late_clock_in_rate: number;
    early_clock_out_rate: number;
    no_show_rate: number;
    punctuality_rate: number;

    calculated_at: string;
}

// ---------------------------------------------------------------------------
// EMPTY_METRICS — safe default; all counts 0, reliability_score 100
// ---------------------------------------------------------------------------
export const EMPTY_METRICS: EmployeeMetricsSnapshot = {
    id: '',
    employee_id: '',
    period_start: '',
    period_end: '',
    quarter_year: '',
    is_locked: false,
    total_offers: 0,
    shifts_accepted: 0,
    shifts_rejected: 0,
    shifts_assigned: 0,
    emergency_assignments: 0,
    shifts_worked: 0,
    shifts_swapped: 0,
    shifts_dropped: 0,
    standard_cancellations: 0,
    late_cancellations: 0,
    no_shows: 0,
    offer_expirations: 0,
    early_clock_outs: 0,
    late_clock_ins: 0,
    acceptance_rate: 0,
    drop_rate: 0,
    rejection_rate: 0,
    offer_expiration_rate: 0,
    cancellation_rate_standard: 0,
    cancellation_rate_late: 0,
    swap_ratio: 0,
    reliability_score: 100,
    late_clock_in_rate: 0,
    early_clock_out_rate: 0,
    no_show_rate: 0,
    punctuality_rate: 100,
    calculated_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// METRIC_THRESHOLDS
// ---------------------------------------------------------------------------
export const METRIC_THRESHOLDS = {
    acceptance_rate:          { good: 80, warn: 50 },
    reliability_score:        { good: 85, warn: 70 },
    rejection_rate:           { good: 10, warn: 20 },
    cancellation_rate_standard: { good: 5,  warn: 15 },
    cancellation_rate_late:   { good: 3,  warn: 10 },
    swap_ratio:               { good: 10, warn: 20 },
    offer_expiration_rate:    { good: 10, warn: 25 },
    late_clock_in_rate:       { good: 5,  warn: 15 },
    early_clock_out_rate:     { good: 5,  warn: 15 },
    no_show_rate:             { good: 2,  warn: 5  },
} as const;

type MetricThresholdKey = keyof typeof METRIC_THRESHOLDS;

// ---------------------------------------------------------------------------
// getMetricStatus — deterministic, explainable
// ---------------------------------------------------------------------------
export const getMetricStatus = (metricType: string, value: number): 'good' | 'warn' | 'critical' => {
    const thresholds = METRIC_THRESHOLDS[metricType as MetricThresholdKey];
    if (!thresholds) return 'good';

    const higherIsBetter: MetricThresholdKey[] = ['acceptance_rate', 'reliability_score'];
    if (higherIsBetter.includes(metricType as MetricThresholdKey)) {
        if (value >= thresholds.good) return 'good';
        if (value >= thresholds.warn) return 'warn';
        return 'critical';
    } else {
        if (value <= thresholds.good) return 'good';
        if (value <= thresholds.warn) return 'warn';
        return 'critical';
    }
};

// ---------------------------------------------------------------------------
// Quarter helpers
// ---------------------------------------------------------------------------
export const getCurrentQuarter = () => {
    const now = new Date();
    return {
        year: now.getFullYear(),
        quarter: Math.floor(now.getMonth() / 3) + 1,
    };
};

export const getQuarterDateRange = (quarterYear: string): { start: Date; end: Date } | null => {
    if (quarterYear === 'ALL_TIME') return null;

    const [q, year] = quarterYear.split('_');
    const quarterNum = parseInt(q.substring(1));
    const yearNum = parseInt(year);
    const startMonth = (quarterNum - 1) * 3;

    return {
        start: new Date(yearNum, startMonth, 1),
        end: new Date(yearNum, startMonth + 3, 0, 23, 59, 59),
    };
};

export const getQuarterOptions = () => {
    const quarters: string[] = [];
    const { year: currentYear, quarter: currentQuarter } = getCurrentQuarter();

    quarters.push(`Q${currentQuarter}_${currentYear}`);

    for (let i = 1; i <= 4; i++) {
        let quarter = currentQuarter - i;
        let year = currentYear;

        if (quarter <= 0) {
            quarter += 4;
            year -= 1;
        }

        quarters.push(`Q${quarter}_${year}`);
    }

    return quarters;
};

export const formatQuarter = (quarterYear: string): string => {
    if (quarterYear === 'ALL_TIME') return 'All Time';
    const [q, year] = quarterYear.split('_');
    return `${q} ${year}`;
};

// ---------------------------------------------------------------------------
// usePerformanceMetrics — reads from employee_performance_metrics table
// Signature: (employeeId: string, quarterYear: string) — 2 args
// ---------------------------------------------------------------------------
export const usePerformanceMetrics = (employeeId: string, quarterYear: string) => {
    return useQuery({
        queryKey: ['performance_metrics', employeeId, quarterYear],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_performance_metrics')
                .select('*')
                .eq('employee_id', employeeId)
                .eq('quarter_year', quarterYear)
                .maybeSingle();

            if (error) throw error;
            return data as EmployeeMetricsSnapshot | null;
        },
        enabled: !!employeeId && !!quarterYear,
    });
};

// ---------------------------------------------------------------------------
// useQuarterlyReport — calls get_quarterly_performance_report RPC
// Signature: (year: number, quarter: number, scope: ScopeSelection)
// ---------------------------------------------------------------------------
export const useQuarterlyReport = (year: number, quarter: number, scope: ScopeSelection) => {
    return useQuery({
        queryKey: ['quarterly_performance_report', year, quarter, scope],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_quarterly_performance_report', {
                p_year: year,
                p_quarter: quarter,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;
            return (data ?? []) as EmployeePerformanceRow[];
        },
        enabled: !!year && !!quarter && !!scope,
    });
};

// ---------------------------------------------------------------------------
// refreshAllPerformanceMetrics — calls refresh_all_performance_metrics RPC
// ---------------------------------------------------------------------------
export const refreshAllPerformanceMetrics = async (): Promise<void> => {
    // Cast through any because refresh_all_performance_metrics is not in the
    // generated RPC type registry but the function exists in the deployed DB.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('refresh_all_performance_metrics');
    if (error) throw error;
};

// ---------------------------------------------------------------------------
// REPORT_THRESHOLDS — thresholds tuned for the global report table
// ---------------------------------------------------------------------------
export const REPORT_THRESHOLDS = {
    acceptance_rate:  { good: 70, warn: 40 },
    drop_rate:        { good: 5,  warn: 15 },
    cancel_rate:      { good: 10, warn: 25 },
    late_cancel_rate: { good: 5,  warn: 15 },
    no_show_rate:     { good: 2,  warn: 5  },
    reliability_score: { good: 90, warn: 75 },
    bid_success_rate:  { good: 70, warn: 40 },
} as const;

type ReportThresholdKey = keyof typeof REPORT_THRESHOLDS;

export const getReportCellStatus = (metricType: string, value: number): 'good' | 'warn' | 'critical' => {
    const thresholds = REPORT_THRESHOLDS[metricType as ReportThresholdKey];
    if (!thresholds) return 'good';

    const higherIsBetter = ['acceptance_rate', 'reliability_score'];
    if (higherIsBetter.includes(metricType)) {
        if (value >= thresholds.good) return 'good';
        if (value >= thresholds.warn) return 'warn';
        return 'critical';
    } else {
        if (value <= thresholds.good) return 'good';
        if (value <= thresholds.warn) return 'warn';
        return 'critical';
    }
};
