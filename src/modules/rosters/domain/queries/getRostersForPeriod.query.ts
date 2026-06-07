/**
 * Get Rosters For Period Query
 * Domain layer - fetches rosters for a date range
 */

import { supabase } from '@/platform/supabase/client';

export interface RosterSummary {
    id: string;
    shiftDate: string;
    departmentId: string;
    subDepartmentId: string;
    status: 'draft' | 'published';
    createdAt: string;
    createdBy?: string;
    finalizedAt?: string;
}

export interface GetRostersInput {
    departmentId: string;
    subDepartmentId: string;
    startDate: string;
    endDate: string;
}

/**
 * Fetch rosters for a given period and department/sub-department
 */
export async function getRostersForPeriod(
    input: GetRostersInput
): Promise<RosterSummary[]> {
    const { departmentId, subDepartmentId, startDate, endDate } = input;

    if (!departmentId || !subDepartmentId) {
        return [];
    }

    // TODO: 'shift_date' does not exist on the rosters table in the current schema.
    // The generated types use start_date/end_date/published_at. Cast as any to bridge
    // the gap until the query is aligned with the actual DB columns.
    const { data, error } = await (supabase
        .from('rosters')
        .select('id, start_date, department_id, sub_department_id, status, created_at, created_by, published_at')
        .eq('department_id', departmentId)
        .eq('sub_department_id', subDepartmentId)
        .gte('start_date', startDate)
        .lte('start_date', endDate)
        .order('start_date', { ascending: false }) as unknown as Promise<{ data: any[] | null; error: any }>);

    if (error) {
        console.error('[getRostersForPeriod] Error:', error);
        return [];
    }

    return ((data as any[]) || []).map((r: any) => ({
        id: r.id,
        shiftDate: r.start_date,
        departmentId: r.department_id,
        subDepartmentId: r.sub_department_id,
        status: (r.status || 'draft') as 'draft' | 'published',
        createdAt: r.created_at || '',
        createdBy: r.created_by || undefined,
        finalizedAt: r.published_at || undefined,
    }));
}

/**
 * Fetch a single roster by ID
 */
export async function getRosterById(
    rosterId: string
): Promise<RosterSummary | null> {
    if (!rosterId) return null;

    // TODO: same schema drift as getRostersForPeriod — cast as any until columns are aligned.
    const { data, error } = await (supabase
        .from('rosters')
        .select('id, start_date, department_id, sub_department_id, status, created_at, created_by, published_at')
        .eq('id', rosterId)
        .single() as unknown as Promise<{ data: any | null; error: any }>);

    if (error || !data) {
        console.error('[getRosterById] Error:', error);
        return null;
    }

    const r = data as any;
    return {
        id: r.id,
        shiftDate: r.start_date,
        departmentId: r.department_id,
        subDepartmentId: r.sub_department_id,
        status: (r.status || 'draft') as 'draft' | 'published',
        createdAt: r.created_at || '',
        createdBy: r.created_by || undefined,
        finalizedAt: r.published_at || undefined,
    };
}
