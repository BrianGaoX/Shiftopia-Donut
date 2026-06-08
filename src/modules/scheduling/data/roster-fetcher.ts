/**
 * RosterFetcher — Supabase data-loading for the AutoScheduler.
 *
 * Extracted from `auto-scheduler.controller.ts` in Phase 2 (H5). The
 * controller used to own three responsibilities this module now handles:
 *
 *   1. **Existing roster context** — fetches each candidate employee's
 *      already-committed shifts within (and around) the optimization
 *      window so the solver can enforce rest-gap / fatigue constraints.
 *
 *   2. **Declared availability** — loads employee availability slots and
 *      a has-any-data flag to distinguish "not onboarded" from
 *      "declared but empty in window."
 *
 *   3. **Time/date utilities** shared with the controller — normalizeTime,
 *      shiftDate, durationMinutes.
 *
 * Design decision: the class takes a Supabase client so tests can inject
 * a mock. The exported singleton wires the real production client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as prodSupabase } from '@/platform/supabase/client';
import type { ExistingShiftRef } from '../types';
import type { ShiftMeta, EmployeeMeta } from '../optimizer/solution-parser';

// =============================================================================
// SHARED UTILITIES — pure functions, no I/O
// =============================================================================

/** Postgres returns 'HH:MM:SS' for time columns; the optimizer expects 'HH:MM'. */
export function normalizeTime(t: string): string {
    if (!t) return t;
    const parts = t.split(':');
    return `${parts[0]}:${parts[1]}`;
}

/** Add or subtract calendar days from YYYY-MM-DD without timezone drift. */
export function shiftDate(date: string, offsetDays: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + offsetDays);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/** Compute shift duration in minutes from HH:MM strings, wrapping past midnight. */
export function durationMinutes(start: string, end: string): number {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) mins += 1440;
    return mins;
}

// =============================================================================
// AVAILABILITY RESULT TYPE
// =============================================================================

export interface AvailabilityResult {
    slots: Array<{ slot_date: string; start_time: string; end_time: string }>;
    hasAnyData: boolean;
}

// =============================================================================
// ROSTER FETCHER
// =============================================================================

export class RosterFetcher {
    constructor(private readonly supabase: SupabaseClient = prodSupabase) {}

    // ── Existing Roster ──────────────────────────────────────────────────────

    /**
     * Fetch each candidate employee's already-committed shifts within (and
     * just outside) the optimization window. The window is widened by one day
     * on each side so shifts adjacent to the window can still anchor rest-gap
     * checks (e.g. a Sunday-night shift constrains a Monday-morning proposal).
     *
     * Uses the SECURITY DEFINER RPC `get_employee_shift_window` so cross-
     * department shifts remain visible regardless of the calling manager's
     * RLS scope — the same correctness reasoning the bulk-assignment scenario
     * loader uses. A direct `.from('shifts')` query is RLS-scoped and can
     * silently omit shifts in other departments, producing false-pass
     * proposals that would later be rejected by compliance.
     *
     * OPTIMIZATION (Bulk): We now use a single RPC call for all employees to
     * avoid browser request limits and Navigator Lock timeouts (common with
     * 50+ staff).
     */
    async fetchExistingRoster(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, ExistingShiftRef[]>> {
        const result = new Map<string, ExistingShiftRef[]>();
        if (shifts.length === 0 || employees.length === 0) return result;

        const dates = shifts.map(s => s.shift_date).sort();
        // Look back 28 days to support V8 rolling average context (2W/3W/4W checks)
        const windowStart = shiftDate(dates[0], -28);
        const windowEnd = shiftDate(dates[dates.length - 1], +1);
        const candidateV8ShiftIds = new Set(shifts.map(s => s.id));

        console.debug('[RosterFetcher] Fetching roster context for %d employees...', employees.length);

        try {
            // ── Try Bulk Fetch First (New RPC) ───────────────────────────────
            const { data, error } = await (this.supabase.rpc as any)('get_employees_shift_window_bulk', {
                p_employee_ids: employees.map(e => e.id),
                p_start_date: windowStart,
                p_end_date: windowEnd,
            });

            if (!error && data) {
                const rows = data as Array<{
                    id: string;
                    assigned_employee_id: string;
                    shift_date: string;
                    start_time: string;
                    end_time: string;
                    unpaid_break_minutes: number;
                }>;

                // Group by employee
                for (const emp of employees) {
                    const empRows = rows.filter(r => r.assigned_employee_id === emp.id);
                    const refs: ExistingShiftRef[] = empRows
                        .filter(r => !candidateV8ShiftIds.has(r.id))
                        .map(r => ({
                            id: r.id,
                            shift_date: r.shift_date,
                            start_time: normalizeTime(r.start_time),
                            end_time: normalizeTime(r.end_time),
                            duration_minutes: durationMinutes(
                                normalizeTime(r.start_time),
                                normalizeTime(r.end_time),
                            ),
                            unpaid_break_minutes: r.unpaid_break_minutes ?? 0,
                        }));
                    result.set(emp.id, refs);
                }
                console.debug('[RosterFetcher] Bulk roster fetch successful (%d total shifts)', rows.length);
                return result;
            }

            console.warn('[RosterFetcher] Bulk roster fetch failed or RPC missing, falling back to chunked sequential...', error);
        } catch (err) {
            console.warn('[RosterFetcher] Bulk roster fetch threw, falling back...', err);
        }

        // ── Fallback: Chunked Sequential Fetch ──────────────────────────────
        // We process in small batches (e.g., 5 at a time) to avoid browser lock contention
        const CHUNK_SIZE = 5;
        for (let i = 0; i < employees.length; i += CHUNK_SIZE) {
            const chunk = employees.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async emp => {
                try {
                    const { data, error } = await (this.supabase.rpc as any)('get_employee_shift_window', {
                        p_employee_id: emp.id,
                        p_start_date: windowStart,
                        p_end_date: windowEnd,
                        p_exclude_id: null,
                    });
                    if (error) {
                        console.warn('[RosterFetcher] Roster fetch failed for', emp.id, error);
                        result.set(emp.id, []);
                        return;
                    }
                    const rows = (data ?? []) as any[];
                    const refs: ExistingShiftRef[] = rows
                        .filter(r => !candidateV8ShiftIds.has(r.id))
                        .map(r => ({
                            id: r.id,
                            shift_date: r.shift_date,
                            start_time: normalizeTime(r.start_time),
                            end_time: normalizeTime(r.end_time),
                            duration_minutes: durationMinutes(
                                normalizeTime(r.start_time),
                                normalizeTime(r.end_time),
                            ),
                            unpaid_break_minutes: r.unpaid_break_minutes ?? 0,
                        }));
                    result.set(emp.id, refs);
                } catch (err) {
                    console.warn('[RosterFetcher] Roster fetch threw for', emp.id, err);
                    result.set(emp.id, []);
                }
            }));
        }

        return result;
    }

    // ── Availability ─────────────────────────────────────────────────────────

    /**
     * Fetch declared availability slots for each employee within the
     * optimization window, plus a flag indicating whether the employee has
     * *any* availability records on file at all (anywhere, anytime).
     *
     * The flag distinguishes:
     *   - "not yet onboarded" (0 records ever) → universally available
     *   - "has declared availability" (records exist somewhere) → only
     *     available where slots cover the shift
     *
     * Returns a Map keyed by employee id with { slots, hasAnyData }.
     */
    async fetchAvailability(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, AvailabilityResult>> {
        const result = new Map<string, AvailabilityResult>();
        if (shifts.length === 0 || employees.length === 0) return result;

        const dates = shifts.map(s => s.shift_date).sort();
        const windowStart = dates[0];
        const windowEnd = dates[dates.length - 1];
        const employeeIds = employees.map(e => e.id);

        // Slots in the window
        const { data: slotRows, error: slotErr } = await this.supabase
            .from('availability_slots')
            .select('profile_id,slot_date,start_time,end_time')
            .in('profile_id', employeeIds)
            .gte('slot_date', windowStart)
            .lte('slot_date', windowEnd);

        if (slotErr) {
            console.warn('[RosterFetcher] Availability slot fetch failed — treating all employees as universally available', slotErr);
            for (const emp of employees) {
                result.set(emp.id, { slots: [], hasAnyData: false });
            }
            return result;
        }

        // Has-any-records check (lookup any rule, not just slots in window).
        // We use availability_rules because it's the source of declared
        // intent; the slots table is materialized output.
        const { data: hasDataRows, error: hasErr } = await this.supabase
            .from('availability_rules')
            .select('profile_id')
            .in('profile_id', employeeIds)
            .limit(employeeIds.length);

        if (hasErr) {
            // Fall back to inferring from in-window slots: if the employee
            // has any in-window slots, they have data; otherwise we
            // conservatively treat them as no-data (universally available)
            // rather than blocking everyone on a transient query failure.
            console.warn('[RosterFetcher] Availability rule fetch failed — falling back to slot-presence inference', hasErr);
        }

        const hasDataSet = new Set<string>(
            (hasDataRows ?? []).map(r => (r as any).profile_id as string),
        );

        const slotsByEmp = new Map<string, Array<{ slot_date: string; start_time: string; end_time: string }>>();
        for (const r of (slotRows ?? []) as any[]) {
            const list = slotsByEmp.get(r.profile_id) ?? [];
            list.push({
                slot_date: r.slot_date,
                start_time: normalizeTime(r.start_time),
                end_time: normalizeTime(r.end_time),
            });
            slotsByEmp.set(r.profile_id, list);
        }

        for (const emp of employees) {
            const slots = slotsByEmp.get(emp.id) ?? [];
            const hasAnyData = hasErr
                ? slots.length > 0
                : hasDataSet.has(emp.id);
            result.set(emp.id, { slots, hasAnyData });
        }

        const enforced = Array.from(result.values()).filter(v => v.hasAnyData).length;
        console.info(
            '[RosterFetcher] Availability: %d/%d employees have declared records (will be hard-filtered); %d treated as universally available',
            enforced, employees.length, employees.length - enforced,
        );

        return result;
    }
}

/** Singleton wired against the production Supabase client. Tests construct
 *  `new RosterFetcher(mockClient)` to inject a fake. */
export const rosterFetcher = new RosterFetcher();
