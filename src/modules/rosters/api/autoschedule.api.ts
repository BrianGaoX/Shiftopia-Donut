import { supabase } from '@/platform/realtime/client';
import { runV8LegacyBridge } from '@/modules/compliance/v8';
import { ShiftTimeRange } from '@/modules/compliance/types';
import { EligibilityService } from '../services/eligibility.service';

// ── State Machine ──────────────────────────────────────────────────────────────

export type AutoScheduleState =
    | 'BASELINE_LOADING'
    | 'BASELINE_READY'
    | 'SIMULATING'
    | 'SIMULATION_READY'
    | 'SIMULATION_ERROR'
    | 'SNAPSHOT_INVALID';

// ── Context ───────────────────────────────────────────────────────────────────

export interface AutoScheduleContext {
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    dateStart?: string;
    dateEnd?: string;
}

// ── Baseline Scan ─────────────────────────────────────────────────────────────

export interface BaselineScan {
    snapshot_version: string;
    unassigned_count: number;
    assigned_count: number;
    available_staff_count: number;
    potential_conflicts: number;
    overtime_exposure: number;
    eligible_shifts: string[];
}

// ── Simulation ────────────────────────────────────────────────────────────────

export type SimulationScope = 'ALL_ELIGIBLE' | 'SELECTED';
export type SimulationStrategy = 'BALANCED' | 'COST_OPTIMIZED' | 'COVERAGE_MAXIMIZED';

export interface SoftConstraints {
    minimize_overtime: boolean;
    fairness: boolean;
    prioritize_senior: boolean;
    minimize_travel: boolean;
}

export interface SimulationConfig {
    scope: SimulationScope;
    selectedV8ShiftIds?: string[];
    strategy: SimulationStrategy;
    softConstraints: SoftConstraints;
    snapshotVersion: string;
}

export interface SimulationAssignment {
    shiftId: string;
    employeeId: string;
    employeeName: string;
    /** Time fields returned by v5 edge function — used by the compliance gate. */
    shiftDate?: string;
    startTime?: string | null;
    endTime?: string | null;
    unpaidBreakMinutes?: number;
}

export interface SimulationConflict {
    shiftId: string;
    description: string;
    type: 'ROLE_MISMATCH' | 'CAPACITY' | 'UNASSIGNABLE' | 'COMPLIANCE_BLOCKED';
    /** Rule names that caused the compliance block (populated for COMPLIANCE_BLOCKED only). */
    blockedBy?: string[];
}

export interface SimulationSummary {
    total_shifts: number;
    assigned_shifts: number;
    unassigned_shifts: number;
    cost_estimate: number;
}

export interface SimulationResult {
    sessionId: string;
    snapshotVersion: string;
    solverHash: string;
    assignments: SimulationAssignment[];
    conflicts: SimulationConflict[];
    summary: SimulationSummary;
}

// ── Commit ────────────────────────────────────────────────────────────────────

export interface CommitResult {
    success: boolean;
    updatedCount: number;
}

// ── Snapshot conflict error ───────────────────────────────────────────────────

export class SnapshotConflictError extends Error {
    readonly code = 'SNAPSHOT_CONFLICT';
    constructor() {
        super('Roster changed during simulation. Please re-fetch baseline and re-run.');
        this.name = 'SnapshotConflictError';
    }
}

// ── Edge function caller ──────────────────────────────────────────────────────

async function invokeEdgeFunction<T>(
    functionName: string,
    body: Record<string, unknown>
): Promise<T> {
    const { data, error } = await supabase.functions.invoke<T>(functionName, { body });

    if (error) {
        let errorPayload: { error?: string; message?: string } = {};
        try {
            const ctx = (error as unknown as { context?: Response }).context;
            if (ctx?.json) {
                errorPayload = await ctx.json();
            }
        } catch {
            // Ignore parse failures
        }

        if (
            errorPayload?.error === 'SNAPSHOT_CONFLICT' ||
            (error as unknown as { status?: number }).status === 409
        ) {
            throw new SnapshotConflictError();
        }

        throw new Error(errorPayload?.message || error.message || `${functionName} failed`);
    }

    return data as T;
}

// ── Snapshot hash helper (Web Crypto API) ─────────────────────────────────────

async function buildSnapshotHash(
    rows: Array<{ id: string; version: number; assignment_status: string }>
): Promise<string> {
    const input = rows
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(r => `${r.id}:${r.version}:${r.assignment_status}`)
        .join(',');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input || 'empty'));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `snap_${hex.slice(0, 16)}`;
}

// ── Compliance Gate ───────────────────────────────────────────────────────────
//
// After the greedy solver in the edge function proposes assignments, this gate
// runs every proposed assignment through the existing Compliance Engine
// (runV8LegacyBridge / NoOverlapRule, MinRestGapRule, MaxDailyHoursRule, …).
//
// This is the authoritative compliance check — the edge function's overlap
// detection is a performance optimisation; the Compliance Engine is the
// source of truth.
//
// Process:
//   1. Fetch each proposed employee's existing committed shifts from DB
//   2. For each assignment (in greedy-solver order), run runV8LegacyBridge()
//      against DB-committed shifts PLUS any earlier session assignments for
//      that employee (so within-session double-bookings are also caught)
//   3. Assignments that pass → validAssignments
//      Assignments that fail → complianceConflicts (type COMPLIANCE_BLOCKED)
//   4. The corrected result is written back to the session in Supabase so
//      autoschedule-save-draft and autoschedule-commit operate on clean data.

async function runComplianceGate(
    raw: SimulationResult
): Promise<{
    validAssignments: SimulationAssignment[];
    allConflicts: SimulationConflict[];
    correctedSummary: SimulationSummary;
}> {
    const { assignments, conflicts: solverConflicts, summary, sessionId } = raw;

    // Nothing to validate
    if (assignments.length === 0) {
        return { validAssignments: [], allConflicts: solverConflicts, correctedSummary: summary };
    }

    // 1. Batch-fetch existing committed shifts for all proposed employees
    const uniqueEmployeeIds = [...new Set(assignments.map(a => a.employeeId))];

    const { data: existingRows } = await supabase
        .from('shifts')
        .select('assigned_employee_id, shift_date, start_time, end_time, unpaid_break_minutes')
        .in('assigned_employee_id', uniqueEmployeeIds)
        .eq('assignment_status', 'assigned')
        .eq('is_cancelled', false)
        .is('deleted_at', null);

    // Group by employee — normalise HH:MM:SS → HH:MM (PostgreSQL time type)
    const existingByEmp = new Map<string, ShiftTimeRange[]>();
    for (const row of (existingRows ?? [])) {
        if (!row.assigned_employee_id || !row.start_time || !row.end_time) continue;
        const list = existingByEmp.get(row.assigned_employee_id) ?? [];
        list.push({
            shift_date: row.shift_date as string,
            start_time: (row.start_time as string).slice(0, 5),
            end_time: (row.end_time as string).slice(0, 5),
            unpaid_break_minutes: (row.unpaid_break_minutes as number) ?? 0,
        });
        existingByEmp.set(row.assigned_employee_id, list);
    }

    // 2. Run compliance check for each proposed assignment in order
    const validAssignments: SimulationAssignment[] = [];
    const complianceConflicts: SimulationConflict[] = [];
    // session-level tracking: shifts already approved in this gate pass
    const sessionByEmp = new Map<string, ShiftTimeRange[]>();

    for (const assignment of assignments) {
        // If edge function didn't return time details (shouldn't happen with v5),
        // pass the assignment through to avoid silently dropping it.
        if (!assignment.startTime || !assignment.endTime || !assignment.shiftDate) {
            validAssignments.push(assignment);
            continue;
        }

        const candidateShift: ShiftTimeRange = {
            shift_date: assignment.shiftDate,
            start_time: assignment.startTime.slice(0, 5),
            end_time: assignment.endTime.slice(0, 5),
            unpaid_break_minutes: assignment.unpaidBreakMinutes ?? 0,
        };

        const existingShifts: ShiftTimeRange[] = [
            ...(existingByEmp.get(assignment.employeeId) ?? []),
            ...(sessionByEmp.get(assignment.employeeId) ?? []),
        ];

        const result = await runV8LegacyBridge({
            employee_id: assignment.employeeId,
            action_type: 'assign',
            candidate_shift: candidateShift,
            existing_shifts: existingShifts,
        });

        if (result.passed) {
            validAssignments.push(assignment);
            // Track for within-session overlap detection
            const sessionList = sessionByEmp.get(assignment.employeeId) ?? [];
            sessionList.push(candidateShift);
            sessionByEmp.set(assignment.employeeId, sessionList);
        } else {
            const blockerNames = result.blockers.map(b => b.rule_name);
            const primaryBlocker = result.blockers[0];
            complianceConflicts.push({
                shiftId: assignment.shiftId,
                description: `${primaryBlocker?.rule_name ?? 'Compliance'}: ${primaryBlocker?.summary ?? 'violation detected'}`,
                type: 'COMPLIANCE_BLOCKED',
                blockedBy: blockerNames,
            });
        }
    }

    const allConflicts = [...solverConflicts, ...complianceConflicts];
    const correctedSummary: SimulationSummary = {
        ...summary,
        assigned_shifts: validAssignments.length,
        unassigned_shifts: allConflicts.length,
    };

    // 3. Persist the compliance-filtered result back to the session so that
    //    autoschedule-save-draft and autoschedule-commit use the clean list.
    if (sessionId) {
        await supabase
            .from('autoschedule_sessions')
            .update({
                simulation_result: {
                    // Strip time fields — commit only needs shiftId/employeeId/employeeName
                    assignments: validAssignments.map(a => ({
                        shiftId: a.shiftId,
                        employeeId: a.employeeId,
                        employeeName: a.employeeName,
                    })),
                    conflicts: allConflicts,
                    summary: correctedSummary,
                } as any,
            })
            .eq('id', sessionId);
    }

    return { validAssignments, allConflicts, correctedSummary };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Phase 1 — Direct Supabase query (no edge function).
 *
 * Gaps fixed vs. prior edge-function approach:
 *   • user_contracts.status is 'Active' (capital A), not 'active'
 *   • shifts.start_at is NULL on seed data; uses shift_date + start_time instead
 *   • lifecycle_status = 'Cancelled' shifts are excluded in addition to is_cancelled flag
 *   • Potential conflicts = shifts whose role_id has zero matching Active contracts
 *   • Overtime exposure = distinct employees already assigned > 35h in the date range
 */
export async function fetchBaseline(context: AutoScheduleContext): Promise<BaselineScan> {
    const { organizationId, departmentId, subDepartmentId, dateStart, dateEnd } = context;

    if (!organizationId || !dateStart || !dateEnd) {
        throw new Error('organizationId, dateStart, and dateEnd are required for baseline scan');
    }

    // ── 1. All shifts in scope ─────────────────────────────────────────────
    let shiftsQ = supabase
        .from('shifts')
        .select('id, version, assignment_status, role_id, shift_date, net_length_minutes, assigned_employee_id')
        .eq('organization_id', organizationId)
        .gte('shift_date', dateStart)
        .lte('shift_date', dateEnd)
        .eq('is_cancelled', false)
        .is('deleted_at', null)
        .not('lifecycle_status', 'eq', 'Cancelled');

    if (departmentId) shiftsQ = shiftsQ.eq('department_id', departmentId);
    if (subDepartmentId) shiftsQ = shiftsQ.eq('sub_department_id', subDepartmentId);

    const { data: shifts, error: shiftsError } = await shiftsQ;
    if (shiftsError) throw new Error(shiftsError.message);

    const allShifts = shifts ?? [];
    const unassignedShifts = allShifts.filter(s => s.assignment_status === 'unassigned');
    const assignedShifts = allShifts.filter(s => s.assignment_status === 'assigned');

    // ── 2. Deterministic snapshot hash ────────────────────────────────────
    const snapshotVersion = await buildSnapshotHash(allShifts as Parameters<typeof buildSnapshotHash>[0]);

    // ── 3. Active staff contracts — via shared EligibilityService ───────────
    const activeContracts = await EligibilityService.getEligibleContracts({
        organizationId,
        departmentId,
        subDepartmentId,
    });

    // ── 4. Available staff pool + potential conflicts ──────────────────────
    const eligibleStaffIds = new Set<string>();
    let potentialConflicts = 0;

    for (const shift of unassignedShifts) {
        const shiftV8RoleId = (shift as Record<string, unknown>).role_id as string | null;
        const eligibleForShift = activeContracts.filter(c =>
            !shiftV8RoleId || c.role_id === shiftV8RoleId
        );
        if (eligibleForShift.length === 0) {
            potentialConflicts++;
        } else {
            for (const c of eligibleForShift) eligibleStaffIds.add(c.user_id);
        }
    }

    // ── 5. Overtime exposure: staff already > 35h assigned in the period ──
    const minutesByEmp = new Map<string, number>();
    for (const shift of assignedShifts) {
        if (!shift.assigned_employee_id) continue;
        minutesByEmp.set(
            shift.assigned_employee_id,
            (minutesByEmp.get(shift.assigned_employee_id) ?? 0) + (shift.net_length_minutes ?? 0)
        );
    }
    let overtimeExposure = 0;
    for (const [, mins] of minutesByEmp) {
        if (mins > 2100) overtimeExposure++;
    }

    return {
        snapshot_version: snapshotVersion,
        unassigned_count: unassignedShifts.length,
        assigned_count: assignedShifts.length,
        available_staff_count: eligibleStaffIds.size,
        potential_conflicts: potentialConflicts,
        overtime_exposure: overtimeExposure,
        eligible_shifts: unassignedShifts.map(s => s.id),
    };
}

/**
 * Phase 2 — Run greedy simulation then validate every proposed assignment
 * through the existing Compliance Engine before returning results.
 *
 * Flow:
 *   1. Call autoschedule-simulate edge function (greedy solver, v5)
 *   2. Run runComplianceGate() — filters out any assignment that violates
 *      NO_OVERLAP, MIN_REST_GAP, MAX_DAILY_HOURS, or any other registered rule
 *   3. Persist compliance-filtered result back to the DB session so that
 *      save-draft and commit operate on the verified assignment list
 */
export async function runSimulation(
    context: AutoScheduleContext,
    config: SimulationConfig
): Promise<SimulationResult> {
    // Step 1: greedy solver
    const raw = await invokeEdgeFunction<SimulationResult>('autoschedule-simulate', {
        organizationId: context.organizationId,
        departmentId: context.departmentId,
        subDepartmentId: context.subDepartmentId,
        dateStart: context.dateStart,
        dateEnd: context.dateEnd,
        scope: config.scope,
        selectedV8ShiftIds: config.selectedV8ShiftIds ?? [],
        strategy: config.strategy,
        softConstraints: config.softConstraints,
        snapshotVersion: config.snapshotVersion,
    });

    // Step 2 & 3: compliance gate + session update
    const { validAssignments, allConflicts, correctedSummary } =
        await runComplianceGate(raw);

    return {
        ...raw,
        assignments: validAssignments,
        conflicts: allConflicts,
        summary: correctedSummary,
    };
}

export async function saveAsDraft(
    sessionId: string,
    snapshotVersion: string
): Promise<{ success: boolean; draftCount: number }> {
    return invokeEdgeFunction('autoschedule-save-draft', { sessionId, snapshotVersion });
}

export async function commitAssignments(
    sessionId: string,
    snapshotVersion: string
): Promise<CommitResult> {
    return invokeEdgeFunction<CommitResult>('autoschedule-commit', { sessionId, snapshotVersion });
}
