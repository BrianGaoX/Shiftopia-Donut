/**
 * F1 — Fairness Ledger Service.
 *
 * Orchestrates the domain logic and DB queries to maintain the ledger.
 *
 * Exposes:
 *   - getEmployeeDebts: fetch current debts for the optimizer.
 *   - recomputeLedger: full rebuild from shift history (expensive, authoritative).
 *   - updateAfterCommit: fast incremental update when new shifts are assigned.
 */

import { addDays, subDays, format } from 'date-fns';
import { fairnessLedgerQueries, type FairnessLedgerUpsertRow } from '../api/fairnessLedger.queries';
import {
    classifyShift,
    computeDebts,
    aggregateShiftsToEntries,
    DEFAULT_WINDOW_DAYS,
    type FairnessDebt,
    type ShiftForFairness,
    type FairnessMetric,
} from '../domain/fairness-ledger';

// TODO: In a production app, fetch from employees table.
// For now, we mock a flat 38h contract for everyone to enable OT calculation.
async function fetchContractedHours(orgId: string, employeeIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const id of employeeIds) {
        map.set(id, 38);
    }
    return map;
}

export const fairnessLedgerService = {
    /**
     * Fetch the current fairness debts for a set of employees.
     * Used by the auto-scheduler to inject `fairness_debts` into `OptimizerEmployee`.
     *
     * @param organizationId  The org ID.
     * @param employeeIds     The employees to fetch.
     * @param windowDays      Length of the rolling window (default 91).
     * @param asOfDate        The date to consider "today" (defaults to current date).
     */
    async getEmployeeDebts(
        organizationId: string,
        employeeIds: string[],
        windowDays = DEFAULT_WINDOW_DAYS,
        asOfDate = new Date(),
    ): Promise<FairnessDebt[]> {
        if (employeeIds.length === 0) return [];

        const windowEndStr = format(asOfDate, 'yyyy-MM-dd');
        const rows = await fairnessLedgerQueries.getDebts(organizationId, employeeIds, windowEndStr);

        // If no rows exist for this window (e.g. feature just turned on or new day),
        // we should ideally trigger a background rebuild. For now, we return zero debts.
        // We do NOT block the optimizer to do a synchronous full rebuild.
        return rows.map(r => ({
            employeeId: r.employee_id,
            metric: r.metric,
            rollingValue: r.rolling_value,
            teamAverage: r.team_average,
            debt: r.debt,
        }));
    },

    /**
     * Recompute the entire ledger for a given window.
     * Authoritative but expensive. Scans all shifts in the window.
     *
     * @param organizationId  The org ID.
     * @param windowEnd       End date of the rolling window.
     * @param departmentId    Optional scope filter.
     * @param windowDays      Length of the rolling window (default 91).
     */
    async recomputeLedger(
        organizationId: string,
        windowEnd: Date,
        departmentId?: string,
        windowDays = DEFAULT_WINDOW_DAYS,
    ): Promise<void> {
        const windowStart = subDays(windowEnd, windowDays - 1);
        const windowStartStr = format(windowStart, 'yyyy-MM-dd');
        const windowEndStr = format(windowEnd, 'yyyy-MM-dd');

        console.debug('[FairnessLedger] Recomputing for window:', windowStartStr, 'to', windowEndStr);

        // 1. Fetch all assigned shifts in the window
        const rawShifts = await fairnessLedgerQueries.fetchAssignedShifts(
            organizationId,
            windowStartStr,
            windowEndStr,
            departmentId,
        );

        if (rawShifts.length === 0) {
            console.debug('[FairnessLedger] No shifts found; clearing ledger.');
            await fairnessLedgerQueries.deleteForWindow(organizationId, windowEndStr);
            return;
        }

        // 2. Classify shifts
        const classified = rawShifts.map(s => {
            const shiftForFairness: ShiftForFairness = {
                id: s.id,
                shiftDate: s.shift_date,
                startTime: s.start_time,
                endTime: s.end_time,
                employeeId: s.assigned_employee_id,
                unpaidBreakMinutes: s.unpaid_break_minutes,
            };
            return {
                ...shiftForFairness,
                flags: classifyShift(s.shift_date, s.start_time, s.end_time),
            };
        });

        // 2.5 Fetch denied preferences for the window
        const deniedPrefsList = await fairnessLedgerQueries.fetchDeniedPreferences(
            organizationId,
            windowStartStr,
            windowEndStr,
        );
        const deniedPrefsCount = new Map<string, number>();
        for (const dp of deniedPrefsList) {
            deniedPrefsCount.set(dp.employee_id, (deniedPrefsCount.get(dp.employee_id) ?? 0) + 1);
        }

        // 3. Aggregate into employee entries
        const employeeIds = Array.from(new Set([
            ...classified.map(s => s.employeeId),
            ...deniedPrefsCount.keys()
        ]));
        const contractedMap = await fetchContractedHours(organizationId, employeeIds);
        const entries = aggregateShiftsToEntries(classified, contractedMap, windowDays / 7, deniedPrefsCount);

        // 4. Compute debts
        const debts = computeDebts(entries);

        // 5. Upsert to DB
        const upsertRows: FairnessLedgerUpsertRow[] = debts.map(d => ({
            organization_id: organizationId,
            employee_id: d.employeeId,
            metric: d.metric,
            window_start: windowStartStr,
            window_end: windowEndStr,
            rolling_value: d.rollingValue,
            team_average: d.teamAverage,
            debt: d.debt,
            updated_by_run: null, // explicit recompute
        }));

        await fairnessLedgerQueries.upsertBatch(upsertRows);
        console.info(`[FairnessLedger] Recomputed ${upsertRows.length} rows for ${employeeIds.length} employees.`);
    },

    /**
     * Fast incremental update after shifts are committed.
     * Takes the just-committed shifts, classifies them, and updates the existing ledger.
     *
     * @param organizationId  The org ID.
     * @param committedShifts The shifts that were just assigned.
     * @param asOfDate        The date to consider "today" (defaults to current date).
     * @param runId           Optional ID of the process that triggered this.
     */
    async updateAfterCommit(
        organizationId: string,
        committedShifts: ShiftForFairness[],
        asOfDate = new Date(),
        runId?: string,
    ): Promise<void> {
        if (committedShifts.length === 0) return;

        const windowEndStr = format(asOfDate, 'yyyy-MM-dd');
        const employeeIds = Array.from(new Set(committedShifts.map(s => s.employeeId)));

        // 1. Fetch current ledger state for the whole team
        // (We need the whole team to recompute the team average accurately)
        const currentLedger = await fairnessLedgerQueries.getAllForWindow(organizationId, windowEndStr);

        // If the ledger is completely empty for this window, we MUST do a full recompute.
        // Incremental updates on an empty ledger would mean only the newly-assigned shifts
        // are tracked, which is wrong.
        if (currentLedger.length === 0) {
            console.warn('[FairnessLedger] Ledger empty for current window; falling back to full recompute.');
            await this.recomputeLedger(organizationId, asOfDate);
            return;
        }

        // 2. Classify and aggregate the newly committed shifts
        const classifiedNew = committedShifts.map(s => ({
            ...s,
            flags: classifyShift(s.shiftDate, s.startTime, s.endTime),
        }));
        
        // We pass 0 for windowWeeks because we are ONLY aggregating the delta,
        // not re-evaluating the whole 13-week OT threshold.
        // Actually, incremental OT is tricky. For Phase 1, we just add the raw hours
        // and let the next full recompute fix the OT threshold boundary.
        // 2.5 Fetch any denied preferences that occurred as a result of these shifts
        // For an incremental update, we just fetch denied preferences specifically for the committed shifts.
        // Wait, the DB status might not be updated to 'rejected' yet if this hook runs concurrently.
        // But assuming sm_select_bid_winner runs before this, they will be 'rejected'.
        // Let's just fetch rejected bids for these specific shifts.
        const committedShiftIds = committedShifts.map(s => s.id).filter(Boolean) as string[];
        const deniedPrefsCount = new Map<string, number>();
        
        if (committedShiftIds.length > 0) {
            const dps = await fairnessLedgerQueries.fetchDeniedPreferences(
                organizationId,
                format(subDays(asOfDate, 365), 'yyyy-MM-dd'), // wide window, we filter by shift_id below
                format(addDays(asOfDate, 365), 'yyyy-MM-dd')
            );
            
            // Filter to just the shifts we are committing now
            const relevantDps = (dps ?? []).filter(dp => committedShiftIds.includes(dp.shift_id));
            for (const dp of relevantDps) {
                deniedPrefsCount.set(dp.employee_id, (deniedPrefsCount.get(dp.employee_id) ?? 0) + 1);
            }
        }

        const deltaEntries = aggregateShiftsToEntries(classifiedNew, new Map(), 0, deniedPrefsCount);

        // 3. Apply deltas to current state
        const stateByEmp = new Map<string, Record<string, number>>();
        for (const row of currentLedger) {
            const cur = stateByEmp.get(row.employee_id) ?? {};
            cur[row.metric] = row.rolling_value;
            stateByEmp.set(row.employee_id, cur);
        }

        for (const delta of deltaEntries) {
            const cur = stateByEmp.get(delta.employeeId) ?? {};
            for (const [metric, val] of Object.entries(delta.values)) {
                cur[metric] = (cur[metric] ?? 0) + val;
            }
            stateByEmp.set(delta.employeeId, cur);
        }

        // 4. Re-shape into EmployeeLedgerEntry and re-run computeDebts
        const updatedEntries = Array.from(stateByEmp.entries()).map(([employeeId, values]) => ({
            employeeId,
            values: values as Record<FairnessMetric, number>,
        }));

        const newDebts = computeDebts(updatedEntries);

        // 5. Upsert ALL employees (because team_average changed for everyone)
        const windowStartStr = currentLedger[0].window_start; // preserve existing window start
        const upsertRows: FairnessLedgerUpsertRow[] = newDebts.map(d => ({
            organization_id: organizationId,
            employee_id: d.employeeId,
            metric: d.metric,
            window_start: windowStartStr,
            window_end: windowEndStr,
            rolling_value: d.rollingValue,
            team_average: d.teamAverage,
            debt: d.debt,
            updated_by_run: runId,
        }));

        await fairnessLedgerQueries.upsertBatch(upsertRows);
        console.debug(`[FairnessLedger] Incremental update applied for ${committedShifts.length} shifts.`);
    },
};
