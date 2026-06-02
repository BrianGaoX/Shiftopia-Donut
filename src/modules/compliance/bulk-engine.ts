/**
 * Bulk Compliance Engine
 * 
 * Evaluates compliance for bulk shift assignments with batch optimization.
 * 
 * Key optimizations:
 * - Fetch data once per employee (batch query)
 * - Build simulated timeline once, reuse across rules
 * - Short-circuit: stop rule execution on first blocking failure
 * - Process employees in deterministic order (sorted)
 * 
 * Flow:
 * 1. Group assignments by employee
 * 2. Batch fetch existing shifts for all employees
 * 3. Batch fetch candidate shifts
 * 4. For each employee: simulate timeline → run rules → aggregate results
 * 5. Build overall summary and response
 */

import { supabase } from '@/platform/realtime/client';
import {
    BulkComplianceCheckRequest,
    BulkComplianceCheckResponse,
    BulkComplianceSummary,
    BulkShiftComplianceResult,
    BulkRuleDetail,
    BulkAssignment,
    ShiftForCompliance,
    EmployeeTimeline,
    AssignmentsByEmployee,
    BulkComplianceResultStatus
} from './bulk-types';
import {
    ComplianceCheckInput,
    ComplianceResult,
    ShiftTimeRange
} from './types';
import { runV8LegacyBridge } from './v8';
import { fetchV8EmployeeContext } from './employee-context';
import { V8Employee } from './v8/types';
import { checkBulkRestGaps, ShiftForRestGap, BulkRestGapResult } from './bulk-rest-gap';
import { checkBulkStudentVisa, ShiftForVisa, BulkStudentVisaResult } from './bulk-student-visa';
import { parseISO, format, addDays, subDays, min, max } from 'date-fns';

// =============================================================================
// CONSTANTS
// =============================================================================

/** 
 * Date window for fetching existing shifts (before and after candidate dates).
 * Needed for rules like min-rest-gap and consecutive-days.
 */
const SHIFT_FETCH_BUFFER_DAYS = 14;

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Run bulk compliance check for multiple shift assignments.
 * 
 * @param request - The bulk compliance check request
 * @returns Bulk compliance response with per-shift results and summary
 */
export async function checkBulkCompliance(
    request: BulkComplianceCheckRequest
): Promise<BulkComplianceCheckResponse> {
    const bulkCheckId = crypto.randomUUID();
    console.log(`[BulkCompliance] Starting check ${bulkCheckId} with ${request.assignments.length} assignments`);

    // Step 1: Group assignments by employee
    const assignmentsByEmployee = groupByEmployee(request.assignments);
    const employeeIds = Array.from(assignmentsByEmployee.keys()).sort();
    console.log(`[BulkCompliance] ${employeeIds.length} unique employees`);

    // Step 2: Get all unique shift IDs
    const shiftIds = request.assignments.map(a => a.shiftId);

    // Step 3: Batch fetch candidate shifts
    const candidateShifts = await fetchShiftsByIds(shiftIds);
    const candidateShiftMap = new Map(candidateShifts.map(s => [s.id, s]));

    // Step 4: Determine date range for existing shift fetch
    const dateRange = computeDateRange(candidateShifts);

    // Step 5: Batch fetch existing shifts for all employees
    const existingShiftsByEmployee = await fetchExistingShiftsByEmployee(
        employeeIds,
        dateRange.minDate,
        dateRange.maxDate
    );

    // Step 5b: Batch fetch employee contexts for EBA accuracy
    const contexts = await Promise.all(employeeIds.map(id => fetchV8EmployeeContext(id)));
    const employeeMap = new Map<string, V8Employee>(contexts.map(ctx => [
        ctx.employee_id,
        {
            id: ctx.employee_id,
            name: 'Employee',
            contract_type: ctx.contract_type as any, // Cast to V8ContractType
            contracted_weekly_hours: ctx.contracted_weekly_hours,
            skill_ids: (ctx.qualifications ?? []).map(q => q.qualification_id)
        }
    ]));

    // Step 6: Evaluate compliance for each employee
    const allResults: BulkShiftComplianceResult[] = [];
    const resultsByEmployee = new Map<string, BulkShiftComplianceResult[]>();

    for (const employeeId of employeeIds) {
        const assignments = assignmentsByEmployee.get(employeeId) || [];
        const existingShifts = existingShiftsByEmployee.get(employeeId) || [];

        // Build candidate shifts for this employee
        const employeeCandidates = assignments
            .map(a => candidateShiftMap.get(a.shiftId))
            .filter((s): s is ShiftForCompliance => s !== undefined)
            .map(s => ({ ...s, is_candidate: true }));

        // ========== OPTIMIZED REST GAP: O(n log n) ==========
        // Pre-compute rest gaps for ALL shifts at once (sort once, scan once)
        const existingForRestGap: ShiftForRestGap[] = existingShifts.map(s => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            isCandidate: false
        }));
        const candidatesForRestGap: ShiftForRestGap[] = employeeCandidates.map(s => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            isCandidate: true
        }));


        // F2: pass the configurable rest-gap threshold so bulk and single-shift
        // paths evaluate the same threshold. Default 10h unless relaxed.
        const restGapMinHours = request.restGapHours ?? undefined;
        const restGapResult = checkBulkRestGaps(existingForRestGap, candidatesForRestGap, restGapMinHours);
        // =====================================================

        // ========== OPTIMIZED STUDENT VISA: O(n) =============
        // Pre-compute visa violations (single timeline aggregation)
        const existingForVisa: ShiftForVisa[] = existingShifts.map(s => ({
            id: s.id, // TS-Fix: Map optional property if needed, simplified here
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            unpaid_break_minutes: s.unpaid_break_minutes,
            isCandidate: false
        }));
        const candidatesForVisa: ShiftForVisa[] = employeeCandidates.map(s => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            unpaid_break_minutes: s.unpaid_break_minutes,
            isCandidate: true
        }));

        const studentVisaResult = checkBulkStudentVisa(existingForVisa, candidatesForVisa);
        // =====================================================

        // Evaluate each candidate shift
        const employeeResults: BulkShiftComplianceResult[] = [];

        for (const candidate of employeeCandidates) {
            const result = await evaluateShiftForEmployee(
                employeeId,
                candidate,
                existingShifts,
                employeeCandidates,
                employeeMap.get(employeeId), // Pass pre-fetched employee
                restGapResult,  // Pass pre-computed rest gaps
                studentVisaResult // Pass pre-computed visa results
            );
            employeeResults.push(result);
            allResults.push(result);
        }

        resultsByEmployee.set(employeeId, employeeResults);
    }

    // Step 7: Compute summary
    const summary = computeSummary(allResults, request.mode);

    console.log(`[BulkCompliance] Check ${bulkCheckId} complete: ${summary.passes} pass, ${summary.warnings} warn, ${summary.blockingFailures} fail`);

    return {
        bulkCheckId,
        summary,
        results: allResults,
        resultsByEmployee
    };
}

// =============================================================================
// GROUPING & BATCH FETCH
// =============================================================================

/**
 * Group assignments by employee ID.
 */
function groupByEmployee(assignments: BulkAssignment[]): AssignmentsByEmployee {
    const map = new Map<string, BulkAssignment[]>();
    for (const assignment of assignments) {
        const existing = map.get(assignment.employeeId) || [];
        existing.push(assignment);
        map.set(assignment.employeeId, existing);
    }
    return map;
}

/**
 * Fetch shifts by their IDs.
 */
async function fetchShiftsByIds(shiftIds: string[]): Promise<ShiftForCompliance[]> {
    if (shiftIds.length === 0) return [];

    const { data, error } = await supabase
        .from('shifts')
        .select('id, shift_date, start_time, end_time, assigned_employee_id, unpaid_break_minutes, role_id')
        .in('id', shiftIds)
        .is('deleted_at', null);

    if (error) {
        console.error('[BulkCompliance] Error fetching shifts:', error);
        return [];
    }

    return (data || []).map(s => ({
        ...s,
        unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
        assigned_employee_id: s.assigned_employee_id || null,
        role_id: s.role_id || null
    })) as any[];
}

/**
 * Fetch existing shifts for multiple employees within a date range.
 * Returns a map of employeeId -> shifts.
 */
async function fetchExistingShiftsByEmployee(
    employeeIds: string[],
    minDate: string,
    maxDate: string
): Promise<Map<string, ShiftForCompliance[]>> {
    const map = new Map<string, ShiftForCompliance[]>();

    if (employeeIds.length === 0) return map;

    const { data, error } = await supabase
        .from('shifts')
        .select('id, shift_date, start_time, end_time, assigned_employee_id, unpaid_break_minutes, role_id')
        .in('assigned_employee_id', employeeIds)
        .gte('shift_date', minDate)
        .lte('shift_date', maxDate)
        .is('deleted_at', null)
        .is('is_cancelled', false);

    if (error) {
        console.error('[BulkCompliance] Error fetching existing shifts:', error);
        return map;
    }

    // Group by employee
    for (const shift of data || []) {
        if (!shift.assigned_employee_id) continue;
        const existing = map.get(shift.assigned_employee_id) || [];
        existing.push({
            ...shift,
            unpaid_break_minutes: shift.unpaid_break_minutes ?? 0
        } as any);
        map.set(shift.assigned_employee_id, existing);
    }

    return map;
}

/**
 * Compute the date range needed for fetching existing shifts.
 * Adds buffer for rules that look at surrounding days.
 */
function computeDateRange(shifts: ShiftForCompliance[]): { minDate: string; maxDate: string } {
    if (shifts.length === 0) {
        const today = new Date();
        return {
            minDate: format(subDays(today, SHIFT_FETCH_BUFFER_DAYS), 'yyyy-MM-dd'),
            maxDate: format(addDays(today, SHIFT_FETCH_BUFFER_DAYS), 'yyyy-MM-dd')
        };
    }

    const dates = shifts.map(s => parseISO(s.shift_date));
    const minShiftDate = dates.reduce((a, b) => a < b ? a : b);
    const maxShiftDate = dates.reduce((a, b) => a > b ? a : b);

    return {
        minDate: format(subDays(minShiftDate, SHIFT_FETCH_BUFFER_DAYS), 'yyyy-MM-dd'),
        maxDate: format(addDays(maxShiftDate, SHIFT_FETCH_BUFFER_DAYS), 'yyyy-MM-dd')
    };
}

// =============================================================================
// COMPLIANCE EVALUATION
// =============================================================================

/**
 * Evaluate a single candidate shift for an employee.
 * Uses the existing compliance engine under the hood.
 * 
 * @param employeeId - The employee being assigned
 * @param candidate - The candidate shift
 * @param existingShifts - Employee's existing assigned shifts
 * @param otherCandidates - Other candidate shifts in this bulk operation
 */
async function evaluateShiftForEmployee(
    employeeId: string,
    candidate: ShiftForCompliance,
    existingShifts: ShiftForCompliance[],
    otherCandidates: ShiftForCompliance[],
    employeeOverride?: V8Employee,
    restGapResult?: BulkRestGapResult,
    studentVisaResult?: BulkStudentVisaResult
): Promise<BulkShiftComplianceResult> {
    // Build simulated timeline: existing + all candidates (including this one)
    // This ensures we check the combined effect of all assignments
    const simulatedExisting = [
        ...existingShifts,
        ...otherCandidates.filter(c => c.id !== candidate.id)  // Other candidates become "existing"
    ];

    // Convert to compliance engine format
    const candidateShift: ShiftTimeRange = {
        shift_date: candidate.shift_date,
        start_time: candidate.start_time,
        end_time: candidate.end_time,
        unpaid_break_minutes: candidate.unpaid_break_minutes
    };

    const existingShiftRanges: ShiftTimeRange[] = simulatedExisting.map(s => ({
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        unpaid_break_minutes: s.unpaid_break_minutes
    }));

    // Run compliance check using existing engine
    // OPTIMIZATION: Skip slow rules if we have pre-computed results
    const excludeRules: string[] = [];
    if (restGapResult) excludeRules.push('MIN_REST_GAP');
    if (studentVisaResult) excludeRules.push('STUDENT_VISA_48H');

    const input: ComplianceCheckInput = {
        employee_id: employeeId,
        action_type: 'assign',
        candidate_shift: candidateShift,
        existing_shifts: existingShiftRanges,
        excludeRules
    };

    const complianceResult = await runV8LegacyBridge(input, employeeOverride);

    // Convert to bulk result format
    const details: BulkRuleDetail[] = complianceResult.results.map(r => ({
        ruleId: r.rule_id,
        status: mapStatus(r.status),
        blocking: r.blocking,
        explanation: r.details || r.summary,
        data: r.calculation
    }));

    // Inject Optimized Rest Gap Result if available
    if (restGapResult) {
        const violations = restGapResult.perShiftViolations.get(candidate.id) || [];
        const impact = restGapResult.restImpacts.get(candidate.id);

        // Determine status (FAIL if any violation)
        const hasViolation = violations.length > 0;
        const status: BulkComplianceResultStatus = hasViolation ? 'FAIL' : 'PASS';

        const restGapMinHours = 10; // Unified default
        // Construct rich data for visualization
        const calculationData = {
            limit: restGapMinHours, // F2: unified default
            // Basic data for simple views
            prev_day_gap_hours: impact?.rest_before_hours ?? null,
            next_day_gap_hours: impact?.rest_after_hours ?? null,
            shortest_gap_hours: violations.length > 0
                ? Math.min(...violations.map(v => v.gapHours))
                : (impact?.rest_before_hours ?? 24),
            // Violations for detail view
            violations
        };

        details.push({
            ruleId: 'MIN_REST_GAP',
            status,
            blocking: true, // MIN_REST_GAP is always blocking
            explanation: hasViolation
                ? `Minimum rest period of 8 hours not met (${violations.length} violation${violations.length > 1 ? 's' : ''})`
                : 'Rest period requirements met',
            data: calculationData
        });
    }

    // Inject Optimized Student Visa Result if available
    if (studentVisaResult) {
        const violations = studentVisaResult.perShiftViolations.get(candidate.id) || [];
        // Use window check for peak hours summary
        const windowCheck = studentVisaResult.shiftWindowCheck.get(candidate.id);

        const hasViolation = violations.length > 0;
        const status: BulkComplianceResultStatus = hasViolation ? 'FAIL' : 'PASS';
        const worstViolation = windowCheck?.worstViolation;
        const peakHours = windowCheck?.peakHours || 0;

        // Construct rich data for visualization matches StudentVisa48hRule output structure
        const calculationData = {
            limit: 48,
            status: hasViolation ? 'fail' : 'pass',
            total_hours: worstViolation?.totalHours || peakHours,
            // Reconstruct minimal weekly data for viz if needed, or pass full breakdown
            // The StudentVisaViz expects 'weeks' map and 'violations' array
            weeks: Object.fromEntries(
                Array.from(studentVisaResult.weeklyData.entries()).map(([k, v]) => [k, { hours: v.hours, dates: v.dateRange }])
            ),
            violations: violations.map(v => ({
                weeks: v.weeks,
                hours: v.totalHours,
                breakdown: v.breakdown
            }))
        };

        details.push({
            ruleId: 'STUDENT_VISA_48H',
            status,
            blocking: false,
            explanation: hasViolation
                ? `Exceeds 48h limit: ${worstViolation!.totalHours}h in fortnight`
                : `Within 48h limit (${peakHours}h peak)`,
            data: calculationData
        });
    }

    // Recalculate failed rules and blocking status with the injected result
    const failedRules = details
        .filter(r => r.status === 'FAIL')
        .map(r => r.ruleId);

    const hasBlockingFailure = details.some(r => r.status === 'FAIL' && r.blocking);

    return {
        employeeId,
        shiftId: candidate.id,
        status: mapStatus(hasBlockingFailure ? 'fail' : (failedRules.length > 0 ? 'warning' : 'pass')),
        blocking: hasBlockingFailure,
        failedRules,
        details
    };
}

/**
 * Map compliance status to bulk result status.
 */
function mapStatus(status: 'pass' | 'fail' | 'warning'): BulkComplianceResultStatus {
    switch (status) {
        case 'pass': return 'PASS';
        case 'fail': return 'FAIL';
        case 'warning': return 'WARNING';
    }
}

// =============================================================================
// SUMMARY COMPUTATION
// =============================================================================

/**
 * Compute overall summary from all results.
 */
function computeSummary(
    results: BulkShiftComplianceResult[],
    mode: 'ALL_OR_NOTHING' | 'PARTIAL_APPLY'
): BulkComplianceSummary {
    const totalAssignments = results.length;
    const blockingFailures = results.filter(r => r.blocking).length;
    const warnings = results.filter(r => r.status === 'WARNING').length;
    const passes = results.filter(r => r.status === 'PASS').length;

    // Determine if we can proceed based on mode
    let canProceed: boolean;
    if (mode === 'ALL_OR_NOTHING') {
        canProceed = blockingFailures === 0;
    } else {
        // PARTIAL_APPLY: can proceed if at least one passes
        canProceed = passes > 0 || (totalAssignments > 0 && blockingFailures < totalAssignments);
    }

    return {
        totalAssignments,
        blockingFailures,
        warnings,
        passes,
        canProceed
    };
}
