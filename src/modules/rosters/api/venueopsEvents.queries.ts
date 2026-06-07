import { supabase } from '@/platform/supabase/client';
import { fromZonedTime } from 'date-fns-tz';

const ICC_TIMEZONE = 'Australia/Sydney';

export interface EventSummary {
    event_id: string;
    name: string;
    event_type_name: string | null;
    estimated_total_attendance: number;
    start_date_time: string;
    end_date_time: string;
    venue_name: string | null;
    room_name: string | null;
}

interface EventRowWithFunctions {
    event_id: string;
    name: string;
    event_type_name: string | null;
    estimated_total_attendance: number | null;
    start_date_time: string;
    end_date_time: string;
    venueops_functions: Array<{ venue_name: string | null; room_name: string | null }> | null;
}

export const venueopsEventsQueries = {
    async fetchEventsForDate(date: string): Promise<EventSummary[]> {
        const dayStart = fromZonedTime(`${date}T00:00:00`, ICC_TIMEZONE).toISOString();
        const dayEnd   = fromZonedTime(`${date}T23:59:59.999`, ICC_TIMEZONE).toISOString();
        const { data, error } = await supabase
            .from('venueops_events')
            .select(`
                event_id,
                name,
                event_type_name,
                estimated_total_attendance,
                start_date_time,
                end_date_time,
                venueops_functions ( venue_name, room_name )
            `)
            .lte('start_date_time', dayEnd)
            .gte('end_date_time', dayStart)
            .eq('is_canceled', false);
        if (error) throw new Error(`fetchEventsForDate failed: ${error.message}`);
        const rows = (data ?? []) as EventRowWithFunctions[];
        return rows.map(row => {
            const firstFunction = row.venueops_functions?.[0] ?? null;
            return {
                event_id: row.event_id,
                name: row.name,
                event_type_name: row.event_type_name,
                estimated_total_attendance: row.estimated_total_attendance ?? 0,
                start_date_time: row.start_date_time,
                end_date_time: row.end_date_time,
                venue_name: firstFunction?.venue_name ?? null,
                room_name: firstFunction?.room_name ?? null,
            };
        });
    },
};
