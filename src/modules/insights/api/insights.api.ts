import { supabase } from '@/platform/realtime/client';
import {
    InsightsFilters,
    InsightsSummary,
    TrendRow,
    DeptBreakdownRow,
} from '../model/metric.types';

/**
 * Insights API — real Supabase queries via RPC functions.
 * All functions are read-only. Scope filtering passed server-side.
 */
export const insightsApi = {
    /**
     * Single-call aggregate for all Overview KPIs in a date range.
     * Backed by get_insights_summary RPC.
     */
    async getSummary(filters: InsightsFilters): Promise<InsightsSummary> {
        const { data, error } = await supabase.rpc('get_insights_summary', {
            p_start_date:  filters.startDate,
            p_end_date:    filters.endDate,
            p_org_ids:     filters.orgIds?.length     ? filters.orgIds     : undefined,
            p_dept_ids:    filters.deptIds?.length    ? filters.deptIds    : undefined,
            p_subdept_ids: filters.subdeptIds?.length ? filters.subdeptIds : undefined,
        });
        if (error) throw error;
        return data as unknown as InsightsSummary;
    },

    /**
     * Daily fill-rate and cost by department — used for trend line chart.
     * Backed by get_insights_trend RPC.
     */
    async getTrend(filters: InsightsFilters): Promise<TrendRow[]> {
        const { data, error } = await supabase.rpc('get_insights_trend', {
            p_start_date: filters.startDate,
            p_end_date:   filters.endDate,
            p_org_ids:    filters.orgIds?.length  ? filters.orgIds  : undefined,
            p_dept_ids:   filters.deptIds?.length ? filters.deptIds : undefined,
        });
        if (error) throw error;
        return (data ?? []) as TrendRow[];
    },

    /**
     * Per-department aggregates — used for breakdown table & bar chart.
     * Backed by get_dept_insights_breakdown RPC.
     */
    async getDeptBreakdown(filters: InsightsFilters): Promise<DeptBreakdownRow[]> {
        const { data, error } = await supabase.rpc('get_dept_insights_breakdown', {
            p_start_date: filters.startDate,
            p_end_date:   filters.endDate,
            p_org_ids:    filters.orgIds?.length  ? filters.orgIds  : undefined,
            p_dept_ids:   filters.deptIds?.length ? filters.deptIds : undefined,
        });
        if (error) throw error;
        return (data ?? []) as DeptBreakdownRow[];
    },

    /**
     * Comprehensive analysis for a specific metric.
     * Backed by get_metric_detailed_analysis RPC.
     */
    async getMetricAnalysis(metricId: string, filters: InsightsFilters) {
        const { data, error } = await supabase.rpc('get_metric_detailed_analysis', {
            p_metric_id:  metricId,
            p_start_date: filters.startDate,
            p_end_date:    filters.endDate,
            p_org_ids:     filters.orgIds?.length     ? filters.orgIds     : undefined,
            p_dept_ids:    filters.deptIds?.length    ? filters.deptIds    : undefined,
        });
        if (error) throw error;
        return data;
    }
};

// Re-export for convenience
export type { InsightsFilters };
