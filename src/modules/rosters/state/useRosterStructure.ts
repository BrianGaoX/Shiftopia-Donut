import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { RosterStructure } from '../model/roster.types';
import { isValidUuid } from '@/modules/rosters/api/shifts.api';

export const ROSTER_STRUCTURE_KEY = 'rosterStructure';

async function fetchRosterStructure(
    organizationId: string | undefined,
    startDate: string,
    endDate: string,
    filters?: { departmentIds?: string[]; subDepartmentIds?: string[] }
): Promise<RosterStructure[]> {
    if (!organizationId || !isValidUuid(organizationId)) return [];

    // Fetch Rosters with Hierarchy
    let query = supabase
        .from('rosters')
        .select(`
            id,
            start_date,
            end_date,
            roster_template_applications (
                template_id
            ),
            roster_groups (
                id,
                name,
                sort_order,
                external_id,
                roster_subgroups (
                    id,
                    name,
                    sort_order
                )
            )
        `)
        .eq('organization_id', organizationId)
        .gte('start_date', startDate)
        .lte('start_date', endDate);

    if (filters?.departmentIds && filters.departmentIds.length > 0) {
        query = query.in('department_id', filters.departmentIds.filter(id => isValidUuid(id)));
    }

    if (filters?.subDepartmentIds !== undefined) {
        if (filters.subDepartmentIds.length > 0) {
            query = query.in('sub_department_id', filters.subDepartmentIds.filter(id => isValidUuid(id)));
        } else {
            // Explicitly empty array means "Global only" (sub_department_id is null)
            query = query.is('sub_department_id', null);
        }
    }

    const { data, error } = await query.order('start_date');

    if (error) {
        console.error('Error fetching roster structure:', error);
        return [];
    }

    if (!data) return [];

    // Transform to friendly structure
    return data.map((roster: any) => ({
        rosterId: roster.id,
        startDate: roster.start_date,
        endDate: roster.end_date,
        appliedTemplateIds: (roster.roster_template_applications || []).map((app: any) => app.template_id),
        groups: (roster.roster_groups || [])
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((group: any) => ({
                id: group.id,
                name: group.name,
                externalId: group.external_id,
                sortOrder: group.sort_order,
                subGroups: (group.roster_subgroups || [])
                    .sort((a: any, b: any) => a.sort_order - b.sort_order)
                    .map((sg: any) => ({
                        id: sg.id,
                        name: sg.name,
                        sortOrder: sg.sort_order
                    }))
            }))
    }));
}

export function useRosterStructure(
    organizationId: string | undefined,
    startDate: string | null,
    endDate: string | null,
    filters?: { departmentIds?: string[]; subDepartmentIds?: string[] }
) {
    return useQuery({
        queryKey: [ROSTER_STRUCTURE_KEY, organizationId, startDate, endDate, filters],
        queryFn: () => fetchRosterStructure(organizationId, startDate!, endDate!, filters),
        enabled: !!organizationId && !!startDate && !!endDate,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
