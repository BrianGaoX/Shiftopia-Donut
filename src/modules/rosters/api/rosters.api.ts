// src/modules/rosters/api/rosters.api.ts
import { eachDayOfInterval, format, parse } from 'date-fns';
import { supabase } from '@/platform/realtime/client';
import { Roster, Group } from '@/modules/core/types';
import { RosterDay } from '../model/roster.types';

export interface CreateRosterFromTemplateParams {
    templateId: string;
    startDate: string;
    endDate: string;
    departmentId: string;
    subDepartmentId?: string;
    overrideExisting?: boolean;
}

export interface RosterCreateResult {
    success: boolean;
    created: number;
    skipped: number;
    errors: string[];
}

export const rostersApi = {
    /**
     * Create rosters from a template for a date range
     */
    createRostersFromTemplate: async (
        params: CreateRosterFromTemplateParams
    ): Promise<RosterCreateResult> => {
        const {
            templateId,
            startDate,
            endDate,
            departmentId,
            subDepartmentId,
            overrideExisting = false
        } = params;

        const result: RosterCreateResult = {
            success: false,
            created: 0,
            skipped: 0,
            errors: [],
        };

        try {
            // Fetch the template
            const { data: template, error: templateError } = await supabase
                .from('shift_templates')
                .select('*')
                .eq('id', templateId)
                .single();

            if (templateError || !template) {
                result.errors.push('Template not found');
                return result;
            }

            // Generate all dates in the range
            // Use parse to safely create Local Date objects from YYYY-MM-DD strings at midnight
            const dates = eachDayOfInterval({
                start: parse(startDate, 'yyyy-MM-dd', new Date(`${startDate}T12:00:00`)),
                end: parse(endDate, 'yyyy-MM-dd', new Date(`${endDate}T12:00:00`)),
            });

            // Check for existing rosters if not overriding
            if (!overrideExisting) {
                const { data: existingRosters } = await supabase
                    .from('rosters')
                    .select('start_date')
                    .eq('department_id', departmentId)
                    .gte('start_date', startDate)
                    .lte('start_date', endDate);

                const existingDates = new Set(
                    existingRosters?.map((r) => r.start_date) || []
                );

                // Filter out dates that already have rosters
                // Use format to get YYYY-MM-DD string from Local Date
                const datesToCreate = dates.filter(
                    (date) => !existingDates.has(format(date, 'yyyy-MM-dd'))
                );

                result.skipped = dates.length - datesToCreate.length;

                if (datesToCreate.length === 0) {
                    result.success = true;
                    return result;
                }

                // Create rosters for remaining dates
                const rostersToCreate = datesToCreate.map((date) => ({
                    start_date: format(date, 'yyyy-MM-dd'),
                    end_date: format(date, 'yyyy-MM-dd'),
                    template_id: templateId,
                    department_id: departmentId,
                    sub_department_id: subDepartmentId || null,
                    groups: (template as any).groups || [],
                    status: 'draft',
                    is_locked: false,
                }));

                const { data, error } = await supabase
                    .from('rosters')
                    .insert(rostersToCreate as any)
                    .select();

                if (error) {
                    result.errors.push(error.message);
                    return result;
                }

                result.created = data?.length || 0;
                result.success = true;
            } else {
                // Override mode: delete existing and create new
                const { error: deleteError } = await supabase
                    .from('rosters')
                    .delete()
                    .eq('department_id', departmentId)
                    .gte('start_date', startDate)
                    .lte('start_date', endDate);

                if (deleteError) {
                    result.errors.push(`Delete error: ${deleteError.message}`);
                    return result;
                }

                // Create new rosters
                const rostersToCreate = dates.map((date) => ({
                    start_date: format(date, 'yyyy-MM-dd'),
                    end_date: format(date, 'yyyy-MM-dd'),
                    template_id: templateId,
                    department_id: departmentId,
                    sub_department_id: subDepartmentId || null,
                    groups: (template as any).groups || [],
                    status: 'draft',
                    is_locked: false,
                }));

                const { data, error } = await supabase
                    .from('rosters')
                    .insert(rostersToCreate as any)
                    .select();

                if (error) {
                    result.errors.push(error.message);
                    return result;
                }

                result.created = data?.length || 0;
                result.success = true;
            }

            return result;
        } catch (error) {
            result.errors.push(
                error instanceof Error ? error.message : 'Unknown error'
            );
            return result;
        }
    },

    /**
     * Get roster by date
     */
    getRosterByDate: async (date: string, departmentId: string): Promise<Roster | null> => {
        try {
            const { data, error } = await supabase
                .from('rosters')
                .select('*')
                .eq('start_date', date)
                .eq('department_id', departmentId)
                .maybeSingle();

            if (error) {
                console.error('Error fetching roster:', error);
                return null;
            }

            if (!data) return null;

            // Convert DB roster to app Roster format
            return {
                id: data.id,
                organizationId: data.organization_id,
                startDate: data.start_date,
                endDate: data.end_date,
                status: data.status as any,
                notes: data.description || '', // Map description to notes
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                isLocked: (data as any).is_locked,
                lockedAt: undefined, // Not in DB
                lockedBy: undefined, // Not in DB
                groups: ((data as any).groups as Group[]) || [],
                appliedTemplates: [],
                groupCount: 0,
                subgroupCount: 0,
                shiftCount: 0,
                assignedCount: 0
            } as unknown as Roster;
        } catch (error) {
            console.error('Error in getRosterByDate:', error);
            return null;
        }
    },

    /**
     * Get rosters for a date range
     */
    getRostersByDateRange: async (
        startDate: string,
        endDate: string,
        departmentId: string,
        organizationId?: string,
        subDepartmentId?: string
    ): Promise<Roster[]> => {
        try {
            let query = supabase
                .from('rosters')
                .select('*')
                .eq('department_id', departmentId)
                .gte('start_date', startDate)
                .lte('start_date', endDate)
                .order('start_date', { ascending: true });

            if (organizationId) {
                query = query.eq('organization_id', organizationId);
            }

            if (subDepartmentId) {
                query = query.eq('sub_department_id', subDepartmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching rosters:', error);
                return [];
            }

            return (data || []).map((roster) => ({
                id: roster.id,
                startDate: roster.start_date,
                endDate: roster.end_date,
                // ... simplified mapping
                groups: ((roster as any).groups as Group[]) || [],
                status: (roster.status as any) || 'draft',
                isLocked: (roster as any).is_locked,
                createdAt: roster.created_at,
                updatedAt: roster.updated_at
            } as unknown as Roster));
        } catch (error) {
            console.error('Error in getRostersByDateRange:', error);
            return [];
        }
    },

    /**
     * Update roster
     */
    updateRoster: async (
        rosterId: string,
        updates: Partial<{
            groups: Group[];
            status: 'draft' | 'published';
            is_locked: boolean;
        }>
    ): Promise<Roster | null> => {
        try {
            // Cast groups to any to bypass strict Json type check
            const payload = { ...updates } as any;

            const { data, error } = await supabase
                .from('rosters')
                .update(payload)
                .eq('id', rosterId)
                .select()
                .single();

            if (error) {
                console.error('Error updating roster:', error);
                return null;
            }

            return {
                id: data.id,
                startDate: data.start_date,
                endDate: data.end_date,
                groups: ((data as any).groups as Group[]) || [],
                status: data.status as any,
                isLocked: (data as any).is_locked,
                createdAt: data.created_at,
                updatedAt: data.updated_at
            } as unknown as Roster;
        } catch (error) {
            console.error('Error in updateRoster:', error);
            return null;
        }
    },

    /**
     * Assign employee to a shift in a roster
     */
    assignEmployeeToShift: async (
        rosterId: string,
        groupId: number,
        subGroupId: number,
        shiftId: string,
        employeeId: string
    ): Promise<Roster | null> => {
        try {
            // First, get the current roster
            const { data: roster, error: fetchError } = await supabase
                .from('rosters')
                .select('*')
                .eq('id', rosterId)
                .single();

            if (fetchError || !roster) {
                console.error('Error fetching roster for assignment:', fetchError);
                return null;
            }

            // Update the groups structure
            const groups = JSON.parse(JSON.stringify((roster as any).groups)) as Group[];
            const group = groups.find((g) => String(g.id) === String(groupId));

            if (!group) return null;

            const subGroup = group.subGroups.find((sg) => String(sg.id) === String(subGroupId));

            if (!subGroup) return null;

            const shift = subGroup.shifts.find((s) => String(s.id) === String(shiftId));

            if (!shift) return null;

            // Assign the employee
            (shift as any).assignment = {
                id: `asn-${Date.now()}`, // Temporary ID generation
                employeeId: employeeId,
                status: 'assigned',
                assignedAt: new Date().toISOString()
            };
            // Keep legacy fields if needed
            (shift as any).employeeId = employeeId;
            (shift as any).status = 'Assigned';

            // Update the roster
            const { data: updatedRoster, error: updateError } = await (supabase as any)
                .from('rosters')
                .update({ groups: groups as any }) // Cast to any for Json compatibility
                .eq('id', rosterId)
                .select()
                .single();

            if (updateError) {
                console.error('Error updating roster with assignment:', updateError);
                return null;
            }

            return {
                id: updatedRoster.id,
                startDate: updatedRoster.start_date,
                endDate: updatedRoster.end_date,
                groups: ((updatedRoster as any).groups as Group[]) || [],
                status: updatedRoster.status,
                isLocked: (updatedRoster as any).is_locked,
                createdAt: updatedRoster.created_at,
                updatedAt: updatedRoster.updated_at
            } as unknown as Roster;
        } catch (error) {
            console.error('Error in assignEmployeeToShift:', error);
            return null;
        }
    },

    /**
     * Check for conflicting rosters in a date range
     */
    checkDateRangeConflict: async (
        startDate: string,
        endDate: string,
        departmentId: string
    ): Promise<boolean> => {
        try {
            const { data, error } = await supabase
                .from('rosters')
                .select('id')
                .eq('department_id', departmentId)
                .gte('start_date', startDate)
                .lte('start_date', endDate)
                .limit(1);

            if (error) {
                console.error('Error checking conflicts:', error);
                return false;
            }

            return (data?.length || 0) > 0;
        } catch (error) {
            console.error('Error in checkDateRangeConflict:', error);
            return false;
        }
    },
};
