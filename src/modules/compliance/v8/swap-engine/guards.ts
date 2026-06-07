/**
 * Swap Pre-Flight Guards
 *
 * These are fast, cheap database checks that run BEFORE the constraint solver.
 * They catch entity-level problems that make the scenario invalid regardless
 * of schedule compliance.
 *
 * Addressed edge cases:
 *   #1  Concurrent race conditions  — concurrent swap lock check
 *   #2  Schedule drift              — shift state snapshot comparison
 *   #16 Cancelled shifts            — shift validity check
 *   #20 Locked roster shifts        — shift lock status check
 *   #21 Employee termination        — employee active status check
 *   #25 Deleted users/roles         — entity existence check
 *
 * Usage in the swap API:
 *   const guard = await runSwapGuards(supabase, { shiftIds, employeeIds, swapId });
 *   if (!guard.passed) throw new SwapGuardError(guard);
 */

import { supabase } from '@/platform/supabase/client';

// =============================================================================
// TYPES
// =============================================================================

export interface GuardViolation {
    /** Machine-readable code for programmatic handling. */
    code: GuardViolationCode;
    message: string;
    /** Affected entity ID (shift or employee). */
    entity_id?: string;
}

export type GuardViolationCode =
    | 'SHIFT_NOT_FOUND'          // #16, #25
    | 'SHIFT_CANCELLED'          // #16
    | 'SHIFT_LOCKED'             // #20
    | 'SHIFT_ALREADY_IN_SWAP'   // #1  — another active swap holds this shift
    | 'EMPLOYEE_INACTIVE'        // #21
    | 'EMPLOYEE_NOT_FOUND'       // #25
    | 'SCHEDULE_DRIFTED';        // #2  — shift changed since snapshot

export interface GuardResult {
    passed: boolean;
    violations: GuardViolation[];
}

export interface SwapGuardInput {
    /** Shift IDs involved in the swap (requester + offerer shifts). */
    shiftIds: string[];
    /** Employee IDs involved in the swap (requester + offerer). */
    employeeIds: string[];
    /** Current swap request ID — used to exclude it from concurrent-swap check. */
    currentSwapId?: string;
    /**
     * Optional snapshot of shift times recorded when the swap was created.
     * If provided, the guard verifies the shifts haven't changed (drift check #2).
     */
    shiftSnapshot?: Array<{
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
    }>;
}

export class SwapGuardError extends Error {
    constructor(public readonly result: GuardResult) {
        const codes = result.violations.map(v => v.code).join(', ');
        super(`Swap pre-flight guard failed: ${codes}`);
        this.name = 'SwapGuardError';
    }
}

// =============================================================================
// INDIVIDUAL GUARDS
// =============================================================================

/** #16, #25 — Verify shifts exist, are not deleted, and are not cancelled. */
async function checkShiftsValid(shiftIds: string[]): Promise<GuardViolation[]> {
    const violations: GuardViolation[] = [];

    const { data, error } = await (supabase as any)
        .from('shifts')
        .select('id, is_cancelled, deleted_at, lifecycle_status')
        .in('id', shiftIds);

    if (error) return violations; // Fail open — let solver catch it

    const foundIds = new Set((data || []).map((s: any) => s.id));

    for (const id of shiftIds) {
        if (!foundIds.has(id)) {
            violations.push({ code: 'SHIFT_NOT_FOUND', message: `Shift ${id} no longer exists.`, entity_id: id });
            continue;
        }
        const row = (data || []).find((s: any) => s.id === id);
        if (row?.deleted_at || row?.is_cancelled) {
            violations.push({ code: 'SHIFT_CANCELLED', message: `Shift ${id} has been cancelled or deleted.`, entity_id: id });
        }
    }

    return violations;
}

/**
 * #20 — Verify shifts are not in a locked state (time-locked or manager-locked).
 * Checks both the 4-hour time lock rule AND any manual lock flags on the shift.
 */
async function checkShiftsNotLocked(shiftIds: string[]): Promise<GuardViolation[]> {
    const violations: GuardViolation[] = [];

    const { data, error } = await (supabase as any)
        .from('shifts')
        .select('id, is_locked, trading_status, start_at')
        .in('id', shiftIds);

    if (error || !data) return violations;

    const now = new Date();

    for (const row of data) {
        // Manual lock flag
        if (row.is_locked) {
            violations.push({
                code: 'SHIFT_LOCKED',
                message: `Shift on ${row.shift_date} is locked by a manager and cannot be swapped.`,
                entity_id: row.id,
            });
            continue;
        }

        // 4-hour time lock (#9 from spec)
        if (row.start_at) {
            const shiftStart = new Date(row.start_at);
            const hoursUntil = (shiftStart.getTime() - now.getTime()) / 36e5;
            if (hoursUntil >= 0 && hoursUntil < 4) {
                violations.push({
                    code: 'SHIFT_LOCKED',
                    message: `Shift starting at ${shiftStart.toLocaleString()} starts in less than 4 hours and is time-locked.`,
                    entity_id: row.id,
                });
            }
        }
    }

    return violations;
}

/**
 * #1 — Concurrent swap race condition check.
 * Verifies that no OTHER active swap is already holding one of these shifts.
 * A shift should only be in one active swap at a time.
 */
async function checkNoConcurrentSwap(shiftIds: string[], currentSwapId?: string): Promise<GuardViolation[]> {
    const violations: GuardViolation[] = [];

    let query = (supabase as any)
        .from('shift_swaps')
        .select('id, requester_shift_id, target_shift_id, status')
        .in('status', ['OPEN', 'MANAGER_PENDING'])
        .or(`requester_shift_id.in.(${shiftIds.join(',')}),target_shift_id.in.(${shiftIds.join(',')})`);

    if (currentSwapId) {
        query = query.neq('id', currentSwapId);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) return violations;

    for (const concurrentSwap of data) {
        const conflictV8ShiftId = shiftIds.find(
            id => id === concurrentSwap.requester_shift_id || id === concurrentSwap.target_shift_id,
        );
        if (conflictV8ShiftId) {
            violations.push({
                code: 'SHIFT_ALREADY_IN_SWAP',
                message: `Shift ${conflictV8ShiftId} is already part of another active swap (${concurrentSwap.id}). Try again after that swap resolves.`,
                entity_id: conflictV8ShiftId,
            });
        }
    }

    return violations;
}

/**
 * #21, #25 — Verify employees are active (not terminated, suspended, or deleted).
 */
async function checkEmployeesActive(employeeIds: string[]): Promise<GuardViolation[]> {
    const violations: GuardViolation[] = [];

    const { data, error } = await (supabase as any)
        .from('profiles')
        .select('id, status, is_active')
        .in('id', employeeIds);

    if (error || !data) return violations;

    const foundIds = new Set((data || []).map((p: any) => p.id));

    for (const id of employeeIds) {
        if (!foundIds.has(id)) {
            violations.push({ code: 'EMPLOYEE_NOT_FOUND', message: `Employee ${id} not found.`, entity_id: id });
            continue;
        }
        const profile = (data || []).find((p: any) => p.id === id);
        if (profile?.is_active === false) {
            violations.push({ code: 'EMPLOYEE_INACTIVE', message: `Employee ${id} account is inactive.`, entity_id: id });
            continue;
        }
        // Check for explicit inactive/terminated/suspended status if your profiles table has a status column
        if (profile?.status && !['active', 'Active', 'ACTIVE'].includes(profile.status)) {
            violations.push({
                code: 'EMPLOYEE_INACTIVE',
                message: `Employee ${id} is not active (status: ${profile.status}). Swap cannot proceed.`,
                entity_id: id,
            });
        }
    }

    return violations;
}

/**
 * #2 — Schedule drift detection.
 * Compares current shift data against a snapshot taken at offer creation time.
 * If a shift has been rescheduled, the original compliance check is stale.
 */
async function checkScheduleNotDrifted(
    snapshot: NonNullable<SwapGuardInput['shiftSnapshot']>,
): Promise<GuardViolation[]> {
    const violations: GuardViolation[] = [];
    const ids = snapshot.map(s => s.id);

    const { data, error } = await (supabase as any)
        .from('shifts')
        .select('id, shift_date, start_time, end_time')
        .in('id', ids);

    if (error || !data) return violations;

    for (const snap of snapshot) {
        const current = (data || []).find((s: any) => s.id === snap.id);
        if (!current) continue; // Already caught by checkShiftsValid

        if (
            current.shift_date !== snap.shift_date ||
            current.start_time.slice(0, 5) !== snap.start_time.slice(0, 5) ||
            current.end_time.slice(0, 5) !== snap.end_time.slice(0, 5)
        ) {
            violations.push({
                code: 'SCHEDULE_DRIFTED',
                message: `Shift ${snap.id} was rescheduled since the swap was created. Compliance check is stale — please re-evaluate.`,
                entity_id: snap.id,
            });
        }
    }

    return violations;
}

// =============================================================================
// COMPOSITE GUARD
// =============================================================================

/**
 * Run all pre-flight guards for a swap action.
 * Returns immediately if any critical guard fails — cheaper guards run first.
 *
 * Execution order (cheapest → most expensive):
 *   1. checkShiftsValid         (small DB query, no join)
 *   2. checkEmployeesActive     (small DB query, no join)
 *   3. checkShiftsNotLocked     (small DB query, checks time calc)
 *   4. checkNoConcurrentSwap    (slightly larger query)
 *   5. checkScheduleNotDrifted  (only when snapshot provided)
 */
export async function runSwapGuards(input: SwapGuardInput): Promise<GuardResult> {
    const allViolations: GuardViolation[] = [];

    // Run independent guards in parallel
    const [shiftViolations, employeeViolations, lockViolations, concurrentViolations] =
        await Promise.all([
            checkShiftsValid(input.shiftIds),
            checkEmployeesActive(input.employeeIds),
            checkShiftsNotLocked(input.shiftIds),
            checkNoConcurrentSwap(input.shiftIds, input.currentSwapId),
        ]);

    allViolations.push(
        ...shiftViolations,
        ...employeeViolations,
        ...lockViolations,
        ...concurrentViolations,
    );

    // Drift check only when a snapshot is available (#2 — manager approval path)
    if (input.shiftSnapshot && input.shiftSnapshot.length > 0) {
        const driftViolations = await checkScheduleNotDrifted(input.shiftSnapshot);
        allViolations.push(...driftViolations);
    }

    return {
        passed: allViolations.length === 0,
        violations: allViolations,
    };
}
