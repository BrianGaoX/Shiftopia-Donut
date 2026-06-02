/**
 * AutoSchedulerController — Two-Layer Pipeline Orchestration (v2)
 *
 * Layer 1 — Optimization (OR-Tools CP-SAT):
 *   Sends unassigned shifts + employees to the Python service.
 *   Receives proposed assignment map (proposals only, never writes DB).
 *
 * Layer 2 — Compliance Validation:
 *   BulkAssignmentController.simulate() validates each proposal against the
 *   employee's real schedule (incremental feasibility check).
 *
 * Concurrency Recheck (Critical):
 *   Before final DB commit, simulate() is re-run with fresh DB state to
 *   catch any assignments made by other users since the preview was shown.
 *
 * Fallback Strategy:
 *   INFEASIBLE / UNKNOWN / CONNECTION_REFUSED → falls back to the incremental
 *   bulk assignment engine (greedy first-fit over unfilled shifts).
 *
 * Usage:
 *   const preview = await autoSchedulerController.run(shifts, employees);
 *   // Manager reviews preview in AutoSchedulerPanel
 *   const result  = await autoSchedulerController.commit(preview);
 */

import { optimizerClient, OptimizerError } from './optimizer/optimizer.client';
import { solutionParser } from './optimizer/solution-parser';
import { bulkAssignmentController, type BulkAssignmentResult } from '@/modules/rosters/bulk-assignment';
import { format } from 'date-fns';
import { estimateShiftCost, extractLevel } from '../rosters/domain/projections/utils/cost';
import { calculateFatigueWithRecovery } from '../rosters/domain/projections/utils/fatigue';
import { calculateUtilization } from '../rosters/domain/projections/utils/fairness';
import type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
import type { ExistingShiftRef } from './types';
import { auditor } from './audit/auditor';
import { rosterFetcher, durationMinutes } from './data/roster-fetcher';
import type {
    OptimizeRequest,
    OptimizerEmployee,
    OptimizerShift,
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerConstraints,
    OptimizerStrategy,
    OptimizerHealth,
    OptimizerStatus,
    UncoveredAudit,
    CapacityCheck,
    CapacityDayBreakdown,
} from './types';

// Default per-employee daily working-minute cap used by the capacity pre-check
// when employee.max_daily_minutes is not supplied. 10h = 600m.
const DEFAULT_MAX_DAILY_MINUTES = 600;

// Mirrors the Python service guards (ortools_runner.py). Surface to the user
// before we serialize a giant payload and round-trip to the optimizer.
export const MAX_OPTIMIZER_SHIFTS = 2000;
export const MAX_OPTIMIZER_EMPLOYEES = 500;

export class AutoSchedulerInputTooLargeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AutoSchedulerInputTooLargeError';
    }
}

// =============================================================================
// INPUT / OPTIONS
// =============================================================================

export interface AutoSchedulerInput {
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    employeeDetails?: Map<string, Partial<OptimizerEmployee>>;
    constraints?: OptimizerConstraints;
    strategy?: OptimizerStrategy;
    timeLimitSeconds?: number;
    numWorkers?: number;
    /** Allows the caller to abort an in-flight run before it overwrites state. */
    signal?: AbortSignal;
}

export interface CommitResult {
    success: boolean;
    totalCommitted: number;
    failedEmployees: string[];
    concurrencyConflicts: string[];   // Shift IDs that failed the recheck
}

// =============================================================================
// FALLBACK: Greedy Incremental Assignment
// =============================================================================

/**
 * When OR-Tools is unavailable or returns INFEASIBLE, fall back to a greedy
 * first-fit strategy: iterate employees in load-ascending order, assign each
 * unfilled shift to the first employee that passes compliance simulation.
 *
 * This guarantees the user always gets a usable result and integrates 
 * Fatigue and Fairness (Utilization) into the scoring.
 */
async function greedyFallback(
    shifts: ShiftMeta[],
    employees: EmployeeMeta[],
    employeeDetails: Map<string, Partial<OptimizerEmployee>>,
    existingRoster: Map<string, ExistingShiftRef[]>,
    strategy?: OptimizerStrategy,
): Promise<ValidatedProposal[]> {
    // Resolve strategy once here with the same defaults used when building
    // the Python optimizer request (see OptimizeRequest construction below).
    // This ensures the greedy fallback honours UI slider values instead of
    // always using baked-in constants.
    const resolvedStrategy = strategy ?? {
        fatigue_weight: 50,
        fairness_weight: 50,
        cost_weight: 50,
        coverage_weight: 100,
    };
    const proposals: ValidatedProposal[] = [];
    const assignedByEmployee = new Map<string, string[]>();

    for (const emp of employees) {
        assignedByEmployee.set(emp.id, []);
    }

    for (const shift of shifts) {
        let assigned = false;

        // Score each employee for this shift
        const candidateScores = employees.map(emp => {
            const currentAssignments = assignedByEmployee.get(emp.id) ?? [];
            const existingShifts = existingRoster.get(emp.id) ?? [];
            
            // Map assigned IDs back to shift data for the health utilities
            // This is a bit expensive in O(S) but necessary for a smart fallback
            const totalShiftsForEmp = [
                ...existingShifts,
                ...currentAssignments.map(id => {
                    const s = shifts.find(x => x.id === id);
                    return s ? {
                        id: s.id,
                        shift_date: s.shift_date,
                        start_time: s.start_time,
                        end_time: s.end_time,
                        unpaid_break_minutes: s.unpaid_break_minutes
                    } : null;
                }).filter(Boolean)
            ];

            // 1. Fatigue Score
            const health = calculateFatigueWithRecovery(
                totalShiftsForEmp as any,
                shift.shift_date,
                { start_time: shift.start_time, end_time: shift.end_time, unpaid_break_minutes: shift.unpaid_break_minutes }
            );

            // 2. Utilization Score
            const details = employeeDetails.get(emp.id);
            const contractedMins = details?.min_contract_minutes ?? 0;
            const scheduledMins = totalShiftsForEmp.reduce((acc, s) => acc + (s as any).duration_minutes || 0, 0);
            const utl = calculateUtilization(scheduledMins / 60, contractedMins / 60);

            // Strategy multipliers — mirrors optimizer-service/model_builder.py `_strategy_mult`:
            //   symmetric exponential, 0% → 0.5×, 50% → 1.0×, 100% → 2.0×.
            // cost_weight is honoured only by the Python OR-Tools optimizer; the greedy
            // fallback does not compute per-shift cost and leaves that term at default.
            const strategyMult = (w: number) => Math.pow(2, (w - 50) / 50);
            const fatigueMult  = strategyMult(resolvedStrategy.fatigue_weight  ?? 50);
            const fairnessMult = strategyMult(resolvedStrategy.fairness_weight ?? 50);

            // Penalty Calculation
            // High fatigue (> 15) is penalized exponentially, scaled by fatigue_weight
            const fatiguePenalty = health.projected > 15 ? Math.pow(health.projected - 15, 2) * 50 * fatigueMult : 0;
            // Over-utilization (> 100%) is a hard over-cap, not a strategy lever
            const utilizationPenalty = utl > 100 ? (utl - 100) * 10 : 0;
            // Under-utilization (< 80%) gets a fairness bonus, scaled by fairness_weight
            const fairnessBonus = utl < 80 ? (80 - utl) * 5 * fairnessMult : 0;

            const score = 1000 - fatiguePenalty - utilizationPenalty + fairnessBonus;

            return { 
                emp, 
                score, 
                fatigueScore: health.projected,
                utilization: utl 
            };
        });

        // Try employees in order of highest score
        const sorted = candidateScores
            .filter(c => {
                // HC-Skill (Pre-filter to avoid network call). Treat
                // missing level data as 0 on both sides — never silently
                // exclude an employee because their level field wasn't
                // populated upstream.
                const empLevel = c.emp.level ?? 0;
                const shiftLevel = shift.level ?? 0;
                if (empLevel < shiftLevel) return false;

                // HC-EmploymentType: kept as a SOFT preference upstream in
                // the optimizer (see SC-1 Employment Isolation). Don't
                // hard-reject here — that would block legitimate
                // cross-assignments when the right pool is exhausted.
                
                return true;
            })
            .sort((a, b) => b.score - a.score);

        if (sorted.length === 0) {
            console.debug('[AutoScheduler] No eligible employees for shift %s (Role/Skill mismatch)', shift.id);
        }

        for (const candidate of sorted) {
            const { emp } = candidate;
            
            // Skill Alignment Penalty: small penalty for senior doing junior work
            const levelGap = (emp.level ?? 0) - (shift.level ?? 0);
            const alignmentPenalty = levelGap > 0 ? levelGap * 50 : 0;
            const finalScore = candidate.score - alignmentPenalty;

            const existingV8ShiftIds = assignedByEmployee.get(emp.id) ?? [];
            const candidateIds = [...existingV8ShiftIds, shift.id];

            try {
                // Build injected context from pre-fetched maps
                const details = employeeDetails.get(emp.id);
                const existing = existingRoster.get(emp.id) ?? [];
                
                // Only simulate if they passed the basic pre-filters above
                const simResult = await bulkAssignmentController.simulate(
                    candidateIds,
                    emp.id,
                    { 
                        mode: 'PARTIAL_APPLY',
                        injectedData: {
                            candidateShifts: shifts.filter(s => candidateIds.includes(s.id)) as any,
                            existingShifts: existing.map(e => ({
                                id: e.id,
                                shift_date: e.shift_date,
                                start_time: e.start_time,
                                end_time: e.end_time,
                                assigned_employee_id: emp.id,
                                unpaid_break_minutes: e.unpaid_break_minutes ?? 0,
                            })) as any,
                            employee: {
                                id: emp.id,
                                name: emp.name,
                                contracts: details?.contracts || [],
                                qualifications: details?.qualifications || [],
                            } as any
                        }
                    },
                );
                const shiftResult = simResult.results.find(r => r.shiftId === shift.id);
                if (shiftResult?.passing) {
                    assignedByEmployee.get(emp.id)!.push(shift.id);
                    proposals.push({
                        shiftId: shift.id,
                        employeeId: emp.id,
                        employeeName: emp.name,
                        shiftDate: shift.shift_date,
                        startTime: shift.start_time,
                        endTime: shift.end_time,
                        optimizerCost: 0,
                        employmentType: /casual/i.test(emp.contract_type || '') ? 'Casual' : 'Full-Time',
                        complianceStatus: 'PASS',
                        violations: [],
                        passing: true,
                        fatigueScore: candidate.fatigueScore,
                        utilization: candidate.utilization,
                    });
                    assigned = true;
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!assigned) {
            proposals.push({
                shiftId: shift.id,
                employeeId: '',
                employeeName: '',
                shiftDate: shift.shift_date,
                startTime: shift.start_time,
                endTime: shift.end_time,
                optimizerCost: 0,
                employmentType: 'Casual',
                complianceStatus: 'FAIL',
                violations: [{ type: 'NO_ELIGIBLE_EMPLOYEE', description: 'No available employee passed compliance for this shift.', blocking: true }],
                passing: false,
            });
        }
    }

    return proposals;
}

// =============================================================================
// CONTROLLER
// =============================================================================

export class AutoSchedulerController {

    /**
     * Full pipeline: optimize → validate compliance → return preview for manager.
     * Does NOT write to database.
     */
    async run(input: AutoSchedulerInput): Promise<AutoSchedulerResult> {
        // Run-level correlation ID. Logged on every controller line so a
        // user-reported run can be traced from browser → optimizer →
        // commit. The optimizer client generates its own ID for its HTTP
        // call; the two are linked via the [AutoScheduler] Preview ready
        // line which logs both.
        const runId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);

        // ── Layer -1: Request-size guard (matches Python service) ────────────
        // Done before any I/O so the user sees a useful error instead of a
        // late HTTP 400 from the optimizer.
        if (input.shifts.length > MAX_OPTIMIZER_SHIFTS) {
            throw new AutoSchedulerInputTooLargeError(
                `Too many shifts (${input.shifts.length}). The optimizer accepts at most ${MAX_OPTIMIZER_SHIFTS} per run — narrow the date range.`,
            );
        }
        if (input.employees.length > MAX_OPTIMIZER_EMPLOYEES) {
            throw new AutoSchedulerInputTooLargeError(
                `Too many employees (${input.employees.length}). The optimizer accepts at most ${MAX_OPTIMIZER_EMPLOYEES} per run — narrow the scope filter.`,
            );
        }

        const throwIfAborted = () => {
            if (input.signal?.aborted) {
                throw new DOMException('AutoScheduler run aborted', 'AbortError');
            }
        };

        const t0 = performance.now();
        console.debug('[AutoScheduler] Starting — shifts=%d employees=%d', input.shifts.length, input.employees.length);

        // ── Layer 0: Demand-vs-supply pre-check ──────────────────────────────
        // Cheap arithmetic check before we burn CPU on the solver. Surfaces
        // mathematically-impossible days (more shift-hours than worker-hours)
        // that would otherwise just appear as silently uncovered shifts.
        const capacityCheck = this._capacityCheck(input.shifts, input.employees, input.employeeDetails);
        if (!capacityCheck.sufficient) {
            console.warn(
                '[AutoScheduler] Capacity deficit detected on %d day(s) — total deficit %d min',
                capacityCheck.deficitDays.length,
                capacityCheck.deficitDays.reduce((a, d) => a + d.deficitMinutes, 0),
            );
        }

        // ── Roster awareness: fetch existing committed shifts ────────────────
        // Without this, the optimizer is blind to shifts already assigned to
        // these employees (e.g. from a previous Apply within the same session
        // or work scheduled outside the current planner view). The solver
        // will then propose conflicting work that compliance rejects, so a
        // re-optimize collapses from many passing proposals to almost none.
        const existingRoster = await rosterFetcher.fetchExistingRoster(
            input.shifts, input.employees,
        );
        // ── Availability awareness: fetch declared slots ─────────────────────
        // Used as a hard filter in `employee_eligible` on the Python side.
        // Policy: an employee with zero availability records on file is
        // treated as universally available (not yet onboarded); an employee
        // with *any* records on file is treated as unavailable for any
        // shift not covered by a declared slot in the optimization window.
        const availabilityData = await rosterFetcher.fetchAvailability(
            input.shifts, input.employees,
        );
        throwIfAborted();
        const totalExisting = Array.from(existingRoster.values())
            .reduce((acc, list) => acc + list.length, 0);
        if (totalExisting > 0) {
            console.debug(
                '[AutoScheduler] Roster context: %d existing shifts across %d employees',
                totalExisting, existingRoster.size,
            );
        }

        // ── Layer 0.5: Past-shift identification ─────────────────────────────
        // We identify shifts that have already started and exclude them from
        // the optimizer. This prevents the solver from wasting capacity on
        // shifts that can't be assigned, and ensures the user sees a clear
        // failure reason for them.
        const now = Date.now();
        const pastShifts: ShiftMeta[] = [];
        const futureShifts: ShiftMeta[] = [];

        for (const s of input.shifts) {
            // Re-use logic from IncrementalValidator but on ShiftMeta
            // Note: ShiftMeta doesn't have start_at, but we can fetch it if needed.
            // For now, use shift_date + start_time.
            const start = new Date(`${s.shift_date}T${s.start_time}`);
            if (start.getTime() <= now) {
                pastShifts.push(s);
            } else {
                futureShifts.push(s);
            }
        }

        if (pastShifts.length > 0) {
            console.debug('[AutoScheduler] Found %d past shifts — excluding from optimizer', pastShifts.length);
        }

        // ── Layer 1: Build optimizer request ─────────────────────────────────
        const dates = input.shifts.map(s => s.shift_date).sort();
        const start = new Date(dates[0]);
        const end = new Date(dates[dates.length - 1]);
        const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const weekScale = diffDays / 7;

        console.debug('[AutoScheduler] Scaling limits for %f week(s) (%d days)', weekScale.toFixed(2), diffDays);

        const optimizerShifts: OptimizerShift[] = futureShifts.map(s => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            duration_minutes: durationMinutes(s.start_time, s.end_time),
            role_id: s.role_id,
            priority: s.demand_source === 'baseline' ? 10 : 1, // Prioritize baseline shifts
            demand_source: s.demand_source,
            target_employment_type: s.target_employment_type,
            level: s.level ?? 0,
            is_training: (s as any).is_training ?? false,
            unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
        }));

        // Total demand across the window — used to cap per-employee minimum
        // obligations so HC-7 (min contract hours) cannot dominate HC-1
        // (coverage). Without this cap, on a long horizon `weekScale` blows
        // up the min-contract obligation past the total available demand,
        // and the solver leaves shifts uncovered to satisfy the floor.
        const totalDemandMinutes = futureShifts.reduce(
            (acc, s) => acc + durationMinutes(s.start_time, s.end_time),
            0,
        );
        const employeeCount = Math.max(1, input.employees.length);

        const optimizerEmployees: OptimizerEmployee[] = input.employees.map(e => {
            const det = input.employeeDetails?.get(e.id);
            const isFT = e.contract_type === 'FT' || /full/i.test(e.contract_type || '');
            const isPT = e.contract_type === 'PT' || /part/i.test(e.contract_type || '');

            // Default to 38h/wk (2280m) if FT, 20h/wk (1200m) if PT, else 40h/wk max for Casuals
            const baseMax = isFT ? 2280 : isPT ? 1200 : 2400;
            const baseMin = isFT ? 2280 : isPT ? 1200 : 0;

            // Window-aware minimum: scale the weekly contract by `weekScale`,
            // but cap at the demand each employee could plausibly absorb
            // (fair-share + 20% buffer). Prevents the solver from preferring
            // "leave shifts uncovered" over "violate min-contract slack" when
            // the window has more obligation than work.
            const scaledMin = (det?.min_contract_minutes ?? baseMin) * weekScale;
            const fairShareCap = (totalDemandMinutes / employeeCount) * 1.2;
            const cappedMin = Math.min(scaledMin, fairShareCap);

            return {
                id: e.id,
                name: e.name,
                contract_type: e.contract_type,

                hourly_rate: e.remuneration_rate ?? (isFT ? 25.65 : isPT ? 25.65 : 32.06),
                // Scale limits by the number of weeks in the request to support averaging
                min_contract_minutes: Math.round(cappedMin),
                max_weekly_minutes: Math.round((det?.max_weekly_minutes ?? baseMax) * weekScale),
                contract_weekly_minutes: (e.contracted_weekly_hours || 38) * 60,
                level: det?.level ?? 0,
                is_flexible: det?.is_flexible ?? false,
                is_student: det?.is_student ?? false,
                visa_limit: (det as any)?.visa_limit ?? 2880,
                employment_type: /casual/i.test(e.contract_type || '') ? 'Casual' : isPT ? 'Part-Time' : 'Full-Time',
                initial_fatigue_score: calculateFatigueWithRecovery(
                  existingRoster.get(e.id) ?? [],
                  format(new Date(), 'yyyy-MM-dd') // Today's fatigue as baseline
                ).current,
                ...det,
                existing_shifts: existingRoster.get(e.id) ?? [],
                availability_slots: availabilityData.get(e.id)?.slots ?? [],
                has_availability_data: availabilityData.get(e.id)?.hasAnyData ?? false,
            };
        });

        let optimizerStatus: OptimizerStatus = 'UNKNOWN';
        let solveTimeMs = 0;
        let validationTimeMs = 0;
        let uncoveredV8ShiftIds: string[] = [];
        let validatedProposals: ValidatedProposal[] = [];
        let usedFallback = false;
        let optimizerObjectiveBreakdown: Record<string, number> | null = null;

        // ── Layer 2: Call optimizer (with fallback) ───────────────────────────
        // Auto-scale the solver budget with problem size. Preprocess time
        // grows roughly linearly with raw_pairs; large rosters (e.g. 624
        // shifts × 103 employees → ~64k vars / 1.5M constraints) need
        // ~7-8s of preprocess + adequate solve time on top. A flat 30s cap
        // forces those runs to time out and engage greedy unnecessarily.
        const rawPairs = optimizerShifts.length * optimizerEmployees.length;
        const dynamicBudget = rawPairs > 30_000
            ? 90       // big problems: 90s
            : rawPairs > 10_000
                ? 60   // medium: 60s
                : 30;  // small: 30s default
        const solverBudget = input.timeLimitSeconds ?? dynamicBudget;
        if (input.timeLimitSeconds == null && dynamicBudget > 30) {
            console.info(
                '[AutoScheduler] [run=%s] Auto-scaled solver budget to %ds for %d raw pairs',
                runId, dynamicBudget, rawPairs,
            );
        }

        try {
            const optimizeReq: OptimizeRequest = {
                shifts: optimizerShifts,
                employees: optimizerEmployees,
                constraints: input.constraints ?? { min_rest_minutes: 600, relax_constraints: false },
                strategy: input.strategy ?? { fatigue_weight: 50, fairness_weight: 50, cost_weight: 50, coverage_weight: 100 },
                solver_params: {
                    max_time_seconds: solverBudget,
                    num_workers: input.numWorkers ?? 8,
                },
            };

            const optimizeResponse = await optimizerClient.optimize(optimizeReq, input.signal);
            throwIfAborted();
            optimizerStatus = optimizeResponse.status;
            solveTimeMs = optimizeResponse.solve_time_ms;
            optimizerObjectiveBreakdown = optimizeResponse.objective_breakdown ?? null;

            if (optimizerStatus === 'INFEASIBLE' || optimizerStatus === 'UNKNOWN' || optimizerStatus === 'MODEL_INVALID') {
                // Optimizer cannot find a solution → fall back to greedy
                console.warn('[AutoScheduler] Optimizer returned %s — falling back to greedy engine', optimizerStatus);
                usedFallback = true;
                const validationStart = performance.now();
                // Note: greedyFallback still processes all shifts, it will naturally handle the past ones
                validatedProposals = await greedyFallback(input.shifts, input.employees, input.employeeDetails ?? new Map(), existingRoster, input.strategy);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredV8ShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                // ── Parse + compliance validate ───────────────────────────────
                const { shiftMap, employeeMap } = solutionParser.buildMaps(input.shifts, input.employees);
                const { groups, uncoveredV8ShiftIds: uncov } = solutionParser.parse(optimizeResponse, shiftMap, employeeMap);
                
                // Add back the past shifts as uncovered (since optimizer never saw them)
                uncoveredV8ShiftIds = [...uncov, ...pastShifts.map(s => s.id)];

                const validationStart = performance.now();
                validatedProposals = await this._validateProposals(
                    groups, 
                    input.employeeDetails ?? new Map(), 
                    existingRoster
                );

                // Add back the past shifts as explicitly failed proposals (for UI visibility)
                for (const ps of pastShifts) {
                    validatedProposals.push({
                        shiftId: ps.id,
                        employeeId: '',
                        employeeName: '',
                        shiftDate: ps.shift_date,
                        startTime: ps.start_time,
                        endTime: ps.end_time,
                        optimizerCost: 0,
                        employmentType: 'Casual',
                        complianceStatus: 'FAIL',
                        violations: [{ type: 'PAST_SHIFT', description: 'This shift has already started and cannot be assigned.', blocking: true }],
                        passing: false,
                    });
                }

                validationTimeMs = Math.round(performance.now() - validationStart);
                console.debug('[AutoScheduler] Compliance validation: %dms', validationTimeMs);
            }
        } catch (err) {
            if (err instanceof OptimizerError &&
                (err.code === 'CONNECTION_REFUSED' || err.code === 'SOLVER_ERROR')) {
                console.warn(
                    '[AutoScheduler] Optimizer %s — falling back to greedy engine',
                    err.code === 'CONNECTION_REFUSED' ? 'offline' : 'budget exceeded',
                );
                usedFallback = true;
                optimizerStatus = 'UNKNOWN';
                const validationStart = performance.now();
                validatedProposals = await greedyFallback(input.shifts, input.employees, input.employeeDetails ?? new Map(), existingRoster, input.strategy);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredV8ShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                throw err;
            }
        }
        throwIfAborted();

        // ── Layer 2.5: Enrich with Health Metrics (Fatigue/Fairness/Cost) ────
        // We calculate production-grade metrics for all proposals to ensure
        // the manager has an accurate audit of the projected roster health.
        if (validatedProposals.length > 0) {
            const employeeMap = new Map(input.employees.map(e => [e.id, e]));
            
            for (const p of validatedProposals) {
                if (!p.employeeId) continue;
                const emp = employeeMap.get(p.employeeId);
                const shift = input.shifts.find(s => s.id === p.shiftId);
                
                // 1. Calculate Production Cost
                if (shift && emp) {
                    const mins = durationMinutes(shift.start_time, shift.end_time);
                    p.optimizerCost = estimateShiftCost(
                        mins,
                        shift.start_time,
                        shift.end_time,
                        emp.remuneration_rate ?? 25,
                        mins,
                        (shift as any).is_overnight ?? false,
                        false, // is_cancelled
                        shift.shift_date,
                        undefined, // allowances
                        false,
                        false,
                        false,
                        undefined,
                        emp.contract_type === 'CASUAL' || /casual/i.test(emp.contract_type || '') ? 'Casual' : /part/i.test(emp.contract_type || '') ? 'Part-Time' : 'Full-Time',
                        shift.roleName?.toLowerCase().includes('security'),
                        undefined, undefined, undefined, undefined, // Apprentice params
                        undefined, undefined, undefined, undefined, // Trainee params
                        undefined, undefined, undefined, undefined, // Trainee params
                        undefined, undefined, undefined, undefined, // SWS params
                        undefined, 
                        extractLevel(shift.roleName) // 19th arg: classificationLevel
                    );
                }

                // 2. Calculate Fatigue
                const empShifts = existingRoster.get(p.employeeId) ?? [];
                const proposedForEmp = validatedProposals.filter(pr => pr.employeeId === p.employeeId && pr.passing);
                
                const totalShifts = [
                    ...empShifts,
                    ...proposedForEmp.map(pr => ({
                        id: pr.shiftId,
                        shift_date: pr.shiftDate,
                        start_time: pr.startTime,
                        end_time: pr.endTime,
                        duration_minutes: durationMinutes(pr.startTime, pr.endTime),
                        unpaid_break_minutes: input.shifts.find(s => s.id === pr.shiftId)?.unpaid_break_minutes ?? 0
                    })),
                ];

                p.fatigueScore = calculateFatigueWithRecovery(
                    totalShifts as any,
                    p.shiftDate,
                ).current;

                // 3. Calculate Utilization (Fairness)
                const scheduledMins = totalShifts.reduce((acc, s) => acc + (s as any).duration_minutes || 0, 0);
                const contractedMins = (emp?.max_weekly_minutes ?? 2400) * weekScale;
                p.utilization = calculateUtilization(scheduledMins / 60, contractedMins / 60);
            }
        }

        const passing = validatedProposals.filter(p => p.passing).length;
        const failing = validatedProposals.length - passing;

        const result: AutoSchedulerResult = {
            optimizerStatus,
            solveTimeMs,
            validationTimeMs,
            totalProposals: validatedProposals.length,
            passing,
            failing,
            uncoveredV8ShiftIds,
            proposals: validatedProposals,
            canCommit: passing > 0,
            usedFallback,
            capacityCheck,
            // Forward the per-category breakdown from the Python service.
            // Null when the greedy fallback path was taken (usedFallback=true)
            // because greedyFallback never calls the optimizer.
            objective_breakdown: optimizerObjectiveBreakdown,
        };



        // ── Layer 3: Audit uncovered shifts (the "Why") ───────────────────────
        if (result.uncoveredV8ShiftIds.length > 0 || result.failing > 0) {
            throwIfAborted();
            const auditStart = performance.now();
            
            // We audit both:
            // 1. Uncovered shifts (optimizer couldn't place)
            // 2. Failed shifts (optimizer placed but compliance rejected)
        const shiftsToAudit = [
                ...result.uncoveredV8ShiftIds,
                ...result.proposals.filter(p => !p.passing).map(p => p.shiftId)
            ];
            // Remove duplicates
            const uniqueAuditIds = Array.from(new Set(shiftsToAudit));

            result.uncoveredAudit = await auditor.audit({
                targetShiftIds: uniqueAuditIds,
                allShifts: input.shifts,
                allEmployees: input.employees,
                proposals: result.proposals,
                optimizerShifts,
                optimizerEmployees,
                constraints: input.constraints ?? { min_rest_minutes: 600, relax_constraints: false },
                capacityCheck,
                availabilityData,
            });
            result.auditedUncoveredCount = result.uncoveredAudit.length;
            console.debug('[AutoScheduler] Audit complete: %dms', Math.round(performance.now() - auditStart));
        }

        console.info('[AutoScheduler] Preview ready:', {
            run_id: runId,
            status: optimizerStatus, passing, failing,
            uncovered: uncoveredV8ShiftIds.length, fallback: usedFallback,
            totalMs: Math.round(performance.now() - t0),
        });

        return result;
    }

    /**
     * Commit passing proposals with concurrency recheck.
     *
     * CRITICAL: Re-runs simulate() with fresh DB state per employee group
     * before calling commit(). Catches races where another user assigned
     * one of the target shifts between preview and confirm.
     */
    async commit(result: AutoSchedulerResult): Promise<CommitResult> {
        const byEmployee = new Map<string, string[]>();
        for (const p of result.proposals) {
            if (!p.passing || !p.employeeId) continue;
            const list = byEmployee.get(p.employeeId) ?? [];
            list.push(p.shiftId);
            byEmployee.set(p.employeeId, list);
        }

        // ── Per-employee commits run in chunks ─────────────────────────────
        // We process in small batches (e.g., 5 at a time) to avoid browser lock
        // contention during the massive recheck/commit phase.
        type EmpOutcome = { employeeId: string; committed: number; failed: boolean; conflicts: string[] };
        const outcomes: EmpOutcome[] = [];
        const entries = Array.from(byEmployee.entries());
        const CHUNK_SIZE = 5;

        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            const chunk = entries.slice(i, i + CHUNK_SIZE);
            const chunkOutcomes = await Promise.all(
                chunk.map(async ([employeeId, shiftIds]): Promise<EmpOutcome> => {
                    let freshResult: BulkAssignmentResult;
                    try {
                        freshResult = await bulkAssignmentController.simulate(
                            shiftIds, employeeId, { mode: 'PARTIAL_APPLY' },
                        );
                    } catch (err) {
                        console.error('[AutoScheduler] Recheck failed for employee', employeeId, err);
                        return { employeeId, committed: 0, failed: true, conflicts: [] };
                    }

                    const nowFailing = freshResult.failedV8ShiftIds;
                    if (freshResult.passedV8ShiftIds.length === 0) {
                        console.warn('[AutoScheduler] All shifts failed recheck for', employeeId);
                        return { employeeId, committed: 0, failed: true, conflicts: nowFailing };
                    }

                    try {
                        const commitResult = await bulkAssignmentController.commit(freshResult, employeeId);
                        if (commitResult.success) {
                            if (nowFailing.length > 0) {
                                console.warn('[AutoScheduler] Concurrency: skipped %d shifts for %s', nowFailing.length, employeeId);
                            }
                            return { employeeId, committed: commitResult.committed.length, failed: false, conflicts: nowFailing };
                        }
                        return { employeeId, committed: 0, failed: true, conflicts: nowFailing };
                    } catch (err) {
                        console.error('[AutoScheduler] Commit error for', employeeId, err);
                        return { employeeId, committed: 0, failed: true, conflicts: nowFailing };
                    }
                })
            );
            outcomes.push(...chunkOutcomes);
        }

        const totalCommitted = outcomes.reduce((acc, o) => acc + o.committed, 0);
        const failedEmployees = outcomes.filter(o => o.failed).map(o => o.employeeId);
        const concurrencyConflicts = outcomes.flatMap(o => o.conflicts);

        console.debug('[AutoScheduler] Commit complete:', { totalCommitted, failedEmployees, concurrencyConflicts });

        return {
            success: failedEmployees.length === 0 && concurrencyConflicts.length === 0,
            totalCommitted,
            failedEmployees,
            concurrencyConflicts,
        };
    }

    async checkHealth(): Promise<OptimizerHealth> {
        return optimizerClient.healthCheck();
    }



    /**
     * Demand-vs-supply pre-check. Compares total shift-minutes per day
     * against available employee-minutes per day. Pure arithmetic, no
     * solver involvement. Surfaces days that are mathematically impossible
     * to fully cover before we waste cycles asking the optimizer.
     */
    capacityCheck(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
        employeeDetails?: Map<string, Partial<OptimizerEmployee>>,
    ): CapacityCheck {
        return this._capacityCheck(shifts, employees, employeeDetails);
    }

    private _capacityCheck(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
        employeeDetails?: Map<string, Partial<OptimizerEmployee>>,
    ): CapacityCheck {
        // Per-employee daily cap (default 8h). Today employees don't carry
        // a max_daily_minutes field on the public type, but the optimizer
        // overrides do — fall back to default for the rest.
        const dailyCapFor = (empId: string): number => {
            const det = employeeDetails?.get(empId) as Partial<OptimizerEmployee> | undefined;
            const weekly = det?.max_weekly_minutes;
            // Approximate daily cap as weekly / 5 if provided (matches typical
            // 5-day work weeks); else default.
            if (weekly && weekly > 0) return Math.round(weekly / 5);
            return DEFAULT_MAX_DAILY_MINUTES;
        };

        // aggregate demand by day
        const demandByDate = new Map<string, { minutes: number; count: number; pastMinutes: number }>();
        const now = Date.now();
        
        for (const s of shifts) {
            const mins = durationMinutes(s.start_time, s.end_time);
            const cur = demandByDate.get(s.shift_date) ?? { minutes: 0, count: 0, pastMinutes: 0 };
            cur.minutes += mins;
            cur.count += 1;
            
            // Identify if this shift is already started
            const start = new Date(`${s.shift_date}T${s.start_time}`);
            if (start.getTime() <= now) {
                cur.pastMinutes += mins;
            }
            
            demandByDate.set(s.shift_date, cur);
        }

        // Supply per day = sum of all employees' daily caps. Employees can
        // theoretically work any day, so this is an upper bound on supply
        // (real availability windows would only reduce it further).
        const supplyPerDay = employees.reduce((acc, e) => acc + dailyCapFor(e.id), 0);

        const perDay: CapacityDayBreakdown[] = [];
        let totalDemand = 0;
        let totalSupply = 0;

        for (const [date, demand] of demandByDate) {
            // For capacity calculation, past shifts should subtract from supply OR add to deficit.
            // Here we treat them as "unfillable demand" that reduces effective supply.
            const availableSupply = demand.pastMinutes > 0 ? Math.max(0, supplyPerDay - demand.pastMinutes) : supplyPerDay;
            
            const deficit = Math.max(0, demand.minutes - availableSupply);
            const day: CapacityDayBreakdown = {
                date,
                shiftCount: demand.count,
                demandMinutes: demand.minutes,
                supplyMinutes: supplyPerDay,
                employeeCount: employees.length,
                deficitMinutes: deficit,
                sufficient: deficit === 0,
            };
            perDay.push(day);
            totalDemand += demand.minutes;
            totalSupply += supplyPerDay;
        }

        perDay.sort((a, b) => a.date.localeCompare(b.date));
        const deficitDays = perDay.filter(d => !d.sufficient);

        return {
            sufficient: deficitDays.length === 0,
            totalDemandMinutes: totalDemand,
            totalSupplyMinutes: totalSupply,
            deficitDays,
            perDay,
        };
    }

    private async _validateProposals(
        groups: ReturnType<typeof solutionParser.parse>['groups'],
        employeeDetails: Map<string, Partial<OptimizerEmployee>>,
        existingRoster: Map<string, ExistingShiftRef[]>,
    ): Promise<ValidatedProposal[]> {
        const all: ValidatedProposal[] = [];

        for (const group of groups) {
            let bulkResult: BulkAssignmentResult;
            try {
                const details = employeeDetails.get(group.employeeId);
                const existing = existingRoster.get(group.employeeId) ?? [];

                bulkResult = await bulkAssignmentController.simulate(
                    group.shiftIds, 
                    group.employeeId, 
                    { 
                        mode: 'PARTIAL_APPLY',
                        injectedData: {
                            // Pass candidate shifts in their unassigned
                            // (draft) state. The bulk validator's Rule 2
                            // (`ALREADY_ASSIGNED`) rejects any shift whose
                            // `assigned_employee_id` is set — pre-stamping
                            // the optimizer's target employee here makes
                            // every proposal flunk validation. The intended
                            // assignee is conveyed via `group.employeeId`
                            // (the second argument to simulate()).
                            candidateShifts: group.proposals.map(p => ({
                                id: p.shiftId,
                                shift_date: p.shiftDate,
                                start_time: p.startTime,
                                end_time: p.endTime,
                                assigned_employee_id: null,
                                role_id: p.roleId,
                                lifecycle_status: 'draft',
                                unpaid_break_minutes: p.unpaidBreakMinutes ?? 0,
                            })) as any,
                            existingShifts: existing.map(e => ({
                                id: e.id,
                                shift_date: e.shift_date,
                                start_time: e.start_time,
                                end_time: e.end_time,
                                assigned_employee_id: group.employeeId,
                                unpaid_break_minutes: e.unpaid_break_minutes ?? 0,
                            })) as any,
                            employee: {
                                id: group.employeeId,
                                name: group.employeeName,
                                contracts: details?.contracts || [],
                                qualifications: details?.qualifications || [],
                            } as any
                        }
                    },
                );
            } catch (err) {
                for (const p of group.proposals) {
                    all.push({
                        shiftId: p.shiftId, employeeId: p.employeeId, employeeName: p.employeeName,
                        shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
                        optimizerCost: p.cost, employmentType: p.employmentType, complianceStatus: 'FAIL',
                        roleName: p.roleName,
                        violations: [{ type: 'SYSTEM', description: 'Compliance check error', blocking: true }],
                        passing: false,
                    });
                }
                continue;
            }

            const resultByShift = new Map(bulkResult.results.map(r => [r.shiftId, r]));

            // Diagnostic: surface why proposals are flunking validation. The
            // optimizer can return 100% coverage while the validator marks
            // every proposal as failing, leaving the UI showing 0 success.
            // This log lets us see *which* rule disagrees with the solver.
            const groupPass = bulkResult.results.filter(r => r.passing).length;
            const groupFail = bulkResult.results.filter(r => !r.passing).length;
            if (groupFail > 0) {
                const violationCounts: Record<string, number> = {};
                for (const r of bulkResult.results) {
                    for (const v of r.violations ?? []) {
                        violationCounts[v.violation_type] = (violationCounts[v.violation_type] ?? 0) + 1;
                    }
                }
                console.warn(
                    '[AutoScheduler] Validation: %s passing=%d failing=%d violations=%o',
                    group.employeeName, groupPass, groupFail, violationCounts,
                );
            }

            for (const p of group.proposals) {
                const cr = resultByShift.get(p.shiftId);
                all.push({
                    shiftId: p.shiftId, employeeId: p.employeeId, employeeName: p.employeeName,
                    shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
                    optimizerCost: p.cost,
                    employmentType: p.employmentType,
                    roleName: p.roleName,
                    complianceStatus: cr?.status === 'PASS' ? 'PASS' : cr?.status === 'WARN' ? 'WARN' : 'FAIL',
                    violations: (cr?.violations ?? []).map(v => ({
                        type: v.violation_type, description: v.description, blocking: v.blocking,
                    })),
                    passing: cr?.passing ?? false,
                });
            }
        }

        return all;
    }

}

export const autoSchedulerController = new AutoSchedulerController();
