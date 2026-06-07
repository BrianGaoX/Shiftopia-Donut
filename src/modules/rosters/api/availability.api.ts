/**
 * Availability API Service
 * 
 * Fetches availability data from Supabase and provides resolved availability
 * for use in the Peoples Mode grid.
 */

import { supabase } from '@/platform/supabase/client';
import { format } from 'date-fns';
import {
    RawAvailability,
    EmployeeAvailability,
} from '@/modules/rosters/domain/availabilityResolution.types';
import {
    resolveAvailabilityBatch,
    toEmployeeAvailability,
} from '@/modules/rosters/domain/availabilityResolution';

/* ============================================================
   API FUNCTIONS
   ============================================================ */

/**
 * Fetch raw availability rows from the database for given profiles and date range
 */
export async function fetchRawAvailabilities(
    profileIds: string[],
    startDate: Date,
    endDate: Date
): Promise<RawAvailability[]> {
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');

    const { data, error } = await supabase
        .from('availabilities')
        .select('*')
        .in('profile_id', profileIds)
        .lte('start_date', endDateStr) // Rule starts before or on view end
        .gte('end_date', startDateStr) // Rule ends after or on view start
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching availabilities:', error);
        return [];
    }

    return (data || []) as RawAvailability[];
}

/**
 * Get resolved availability for multiple profiles across a date range
 * Returns a nested Map: profileId -> date -> EmployeeAvailability
 */
export async function getResolvedAvailabilities(
    profileIds: string[],
    startDate: Date,
    endDate: Date
): Promise<Map<string, Map<string, EmployeeAvailability>>> {
    // Skip if no profiles
    if (profileIds.length === 0) {
        return new Map();
    }

    // Fetch raw availability rules
    const rawRules = await fetchRawAvailabilities(profileIds, startDate, endDate);

    // Resolve using the resolution service
    const resolved = resolveAvailabilityBatch(profileIds, startDate, endDate, rawRules);

    // Convert to EmployeeAvailability format for UI
    const result = new Map<string, Map<string, EmployeeAvailability>>();

    for (const [profileId, dateMap] of resolved) {
        const employeeMap = new Map<string, EmployeeAvailability>();

        for (const [date, dayAvailability] of dateMap) {
            employeeMap.set(date, toEmployeeAvailability(dayAvailability));
        }

        result.set(profileId, employeeMap);
    }

    return result;
}

/**
 * Get availability for a single profile on a single date
 * Convenience function for simpler use cases
 */
export async function getEmployeeAvailabilityForDate(
    profileId: string,
    date: Date
): Promise<EmployeeAvailability | null> {
    const result = await getResolvedAvailabilities([profileId], date, date);
    const profileMap = result.get(profileId);

    if (!profileMap) return null;

    const dateStr = format(date, 'yyyy-MM-dd');
    return profileMap.get(dateStr) || null;
}

export const availabilityApi = {
    fetchRawAvailabilities,
    getResolvedAvailabilities,
    getEmployeeAvailabilityForDate,
};
