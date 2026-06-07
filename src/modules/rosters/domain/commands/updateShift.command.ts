/**
 * Update Shift Command
 * Domain layer - orchestrates shift updates
 */

import { supabase } from '@/platform/supabase/client';

export interface UpdateShiftInput {
    shiftId: string;
    startTime?: string;
    endTime?: string;
    roleId?: string;
    remunerationLevelId?: string;
    shiftGroupId?: string;
    shiftSubgroupId?: string;
    assignedEmployeeId?: string | null;
    isDraft?: boolean;
    status?: string;
}

export interface UpdateShiftOutput {
    success: boolean;
    error?: string;
}

/**
 * Execute update shift command
 */
export async function executeUpdateShift(
    input: UpdateShiftInput
): Promise<UpdateShiftOutput> {
    const { shiftId, ...updates } = input;

    if (!shiftId) {
        return { success: false, error: 'Shift ID is required' };
    }

    // Build update object with only provided fields
    const updateData: Record<string, any> = {};

    if (updates.startTime !== undefined) updateData.start_time = updates.startTime;
    if (updates.endTime !== undefined) updateData.end_time = updates.endTime;
    if (updates.roleId !== undefined) updateData.role_id = updates.roleId;
    if (updates.remunerationLevelId !== undefined) updateData.remuneration_level_id = updates.remunerationLevelId;
    if (updates.shiftGroupId !== undefined) updateData.shift_group_id = updates.shiftGroupId;
    if (updates.shiftSubgroupId !== undefined) updateData.shift_subgroup_id = updates.shiftSubgroupId;
    if (updates.assignedEmployeeId !== undefined) updateData.assigned_employee_id = updates.assignedEmployeeId;
    if (updates.isDraft !== undefined) updateData.is_draft = updates.isDraft;
    if (updates.status !== undefined) updateData.status = updates.status;

    if (Object.keys(updateData).length === 0) {
        return { success: false, error: 'No fields to update' };
    }

    try {
        const { error } = await supabase
            .from('shifts')
            .update(updateData)
            .eq('id', shiftId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}
