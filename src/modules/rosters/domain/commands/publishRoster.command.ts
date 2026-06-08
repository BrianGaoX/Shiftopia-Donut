/**
 * Publish Roster Command
 * Domain layer - publishes a roster and its shifts
 */

import { supabase } from '@/platform/supabase/client';

export interface PublishRosterInput {
    rosterId: string;
}

export interface PublishRosterOutput {
    success: boolean;
    error?: string;
    publishedShiftCount?: number;
}

/**
 * Execute publish roster command
 * - Updates roster status to 'published'
 * - Marks all draft shifts as published
 */
export async function executePublishRoster(
    input: PublishRosterInput
): Promise<PublishRosterOutput> {
    const { rosterId } = input;

    if (!rosterId) {
        return { success: false, error: 'Roster ID is required' };
    }

    try {
        // First, update the roster status
        const { error: rosterError } = await supabase
            .from('rosters')
            .update({
                status: 'published',
                finalized_at: new Date().toISOString(),
            })
            .eq('id', rosterId);

        if (rosterError) {
            return { success: false, error: rosterError.message };
        }

        // Get roster details to find associated shifts
        const { data: rosterData, error: fetchError } = await supabase
            .from('rosters')
            .select('department_id, sub_department_id, start_date')
            .eq('id', rosterId)
            .single();

        const roster = rosterData as any;
        if (fetchError || !roster) {
            return { success: false, error: 'Could not fetch roster details' };
        }

        // Update all draft shifts in this roster to published
        const { data: updatedShifts, error: shiftsError } = await supabase
            .from('shifts')
            .update({
                is_draft: false,
                lifecycle_status: 'Published',
            })
            .eq('department_id', roster.department_id)
            .eq('sub_department_id', roster.sub_department_id)
            .eq('shift_date', roster.start_date)
            .eq('is_draft', true)
            .select('id');

        if (shiftsError) {
            return { success: false, error: shiftsError.message };
        }

        return {
            success: true,
            publishedShiftCount: updatedShifts?.length || 0,
        };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}
