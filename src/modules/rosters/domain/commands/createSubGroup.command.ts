/**
 * Create Sub-Group Command
 * Domain layer - creates a new shift subgroup
 */

import { supabase } from '@/platform/supabase/client';

export interface CreateSubGroupInput {
    groupId: string;
    name: string;
}

export interface CreateSubGroupOutput {
    success: boolean;
    subGroupId?: string;
    error?: string;
}

/**
 * Execute create sub-group command
 */
export async function executeCreateSubGroup(
    input: CreateSubGroupInput
): Promise<CreateSubGroupOutput> {
    const { groupId, name } = input;

    if (!groupId) {
        return { success: false, error: 'Group ID is required' };
    }

    if (!name || name.trim().length === 0) {
        return { success: false, error: 'Sub-group name is required' };
    }

    try {
        // Check for duplicate name in same group
        const { data: existing } = await supabase
            .from('shift_subgroups')
            .select('id')
            .eq('group_id', groupId)
            .eq('name', name.trim())
            .maybeSingle();

        if (existing) {
            return { success: false, error: 'A sub-group with this name already exists' };
        }

        const { data, error } = await supabase
            .from('shift_subgroups')
            .insert({
                group_id: groupId,
                name: name.trim(),
                is_draft: false,
            })
            .select('id')
            .single();

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, subGroupId: data.id };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}
