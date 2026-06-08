/**
 * Create Shift Command
 * Domain layer - orchestrates shift creation
 */

import { supabase } from '@/platform/supabase/client';

export interface CreateShiftInput {
    organizationId?: string;
    departmentId: string;
    subDepartmentId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    roleId?: string;
    remunerationLevelId?: string;
    shiftGroupId?: string;
    shiftSubgroupId?: string;
    assignedEmployeeId?: string;
    rosterId: string;
    isDraft?: boolean;
}

export interface CreateShiftOutput {
    success: boolean;
    shiftId?: string;
    error?: string;
}

/**
 * Execute create shift command
 */
export async function executeCreateShift(
    input: CreateShiftInput
): Promise<CreateShiftOutput> {
    const {
        departmentId,
        subDepartmentId,
        shiftDate,
        startTime,
        endTime,
        roleId,
        remunerationLevelId,
        shiftGroupId,
        shiftSubgroupId,
        rosterId,
        assignedEmployeeId,
        isDraft = true,
    } = input;

    // Validation
    if (!departmentId || !subDepartmentId) {
        return { success: false, error: 'Department and Sub-department are required' };
    }

    if (!shiftDate || !startTime || !endTime) {
        return { success: false, error: 'Date and times are required' };
    }

    let finalRemunerationLevelId = remunerationLevelId;

    try {
        // If roleId is provided but remunerationLevelId is not, fetch it from the role
        if (roleId && !finalRemunerationLevelId) {
            const { data: roleData } = await supabase
                .from('roles')
                .select('remuneration_level_id')
                .eq('id', roleId)
                .single();

            if (roleData?.remuneration_level_id) {
                finalRemunerationLevelId = roleData.remuneration_level_id;
            }
        }

        const { data, error } = await (supabase as any)
            .from('shifts')
            .insert({
                department_id: departmentId,
                sub_department_id: subDepartmentId,
                shift_date: shiftDate,
                start_time: startTime,
                end_time: endTime,
                roster_id: rosterId,
                role_id: roleId || null,
                remuneration_level_id: finalRemunerationLevelId || null,
                shift_group_id: shiftGroupId || null,
                roster_subgroup_id: shiftSubgroupId || null,
                assigned_employee_id: assignedEmployeeId || null,
                is_draft: isDraft,
            })
            .select('id')
            .single();

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, shiftId: data.id };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}
