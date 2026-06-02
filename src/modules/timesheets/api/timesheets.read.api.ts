import { Timesheet } from '../model/timesheet.types';
// Mock Data Inlined due to missing file
const currentWeekTimesheets: Timesheet[] = [];
const currentWeekRosters: any[] = [];

const generateTimesheet = (roster: any): Timesheet => ({
    id: `generated-${Date.now()}`,
    employeeId: roster.employeeId || 'unknown',
    periodStart: new Date().toISOString(),
    periodEnd: new Date().toISOString(),
    status: 'DRAFT',
    totalHours: 0,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
});

/**
 * In-memory timesheet store (Mock Data)
 * In a real app, this would be a Supabase client.
 */
let timesheets = [...currentWeekTimesheets];

/**
 * Read-only Timesheet API
 * Safe for any data visualization.
 */
export const timesheetReadApi = {
    getAllTimesheets: async (): Promise<Timesheet[]> => {
        return Promise.resolve([...timesheets]);
    },

    getTimesheetsByDateRange: async (
        startDate: string,
        endDate: string,
    ): Promise<Timesheet[]> => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const filtered = (timesheets as any[]).filter((t: any) => {
            const d = new Date(t.date);
            return d >= start && d <= end;
        });
        return Promise.resolve(filtered as any);
    },

    getTimesheetByDate: async (date: string): Promise<Timesheet | null> => {
        const dateStr = date.split('T')[0];
        const ts = (timesheets as any[]).find((t: any) => (t.date as string).split('T')[0] === dateStr);

        if (ts) return Promise.resolve(ts as any);

        /* auto‑generate from roster if missing */
        const roster = currentWeekRosters.find((r: any) => (r.date as string).split('T')[0] === dateStr) || null;
        if (!roster) return Promise.resolve(null);

        const newTs = generateTimesheet(roster);
        timesheets.push(newTs);
        return Promise.resolve(newTs as any);
    },

    // Internal helper for write API to access the store
    _getInternalStore: () => timesheets,
    _setInternalStore: (newStore: any[]) => { timesheets = newStore; }
};
