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
import { assignmentCommitter } from '@/modules/rosters/bulk-assignment/engine/assignment-committer';
import { format } from 'date-fns';
import { estimateShiftCost, extractLevel } from '../rosters/domain/projections/utils/cost';
import { calculateFatigueWithRecovery } from '../rosters/domain/projections/utils/fatigue';
import { calculateUtilization } from '../rosters/domain/projections/utils/fairness';
import type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
import type { ExistingShiftRef } from './types';
import { auditor } from './audit/auditor';
import { rosterFetcher, durationMinutes } from './data/roster-fetcher';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import { debtsToMap, type ShiftForFairness } from '@/modules/rosters/domain/fairness-ledger';
import type {
    OptimizeRequest,
    OptimizeResponse,
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
    PillarScores,
    BindingConstraint,
    ParetoAlternative,
    AssignmentRationale,
} from './types';

// B1 — Single-mode policy. The autoscheduler no longer exposes cost/fatigue/
// fairness sliders: the solver optimises a fixed lexicographic priority
// (coverage » guardrails » cost, see model_builder.py). Weights are sent only
// because the wire schema requires them; under lexicographic tiers they are
// cross-tier-irrelevant and pinned to the calibrated 1.0× defaults.
const SINGLE_MODE_STRATEGY: OptimizerStrategy = {
    fatigue_weight: 50, fairness_weight: 50, cost_weight: 50, coverage_weight: 100,
};

// Default per-employee daily working-minute cap used by the capacity pre-check
// when employee.max_daily_minutes is not supplied. 10h = 600m.
const DEFAULT_MAX_DAILY_MINUTES = 600;

// Upper bound on the initial fatigue score handed to the optimizer. The raw
// score is unbounded — a single near-38h shift yields ~450 from the
// -76·ln(1-h/38) curve near its asymptote — and a huge value distorts the
// solver's fatigue objective (and previously, with the solver's old fixed
// 5000-minute var domains, could force the whole model INFEASIBLE → silent
// greedy fallback). The solver's accumulator domains are now horizon-derived
// so this no longer risks infeasibility, but clamping keeps the penalty
// meaningful and bounded. (audit fix C4)
const MAX_INITIAL_FATIGUE_SCORE = 60;

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
    /**
     * Org scope for the F1 fairness ledger. When provided, the optimizer reads
     * each employee's cumulative fairness debts and biases the roster toward
     * whoever is "owed" undesirable shifts, then writes the committed shifts
     * back to the ledger. When ABSENT, the ledger is cleanly skipped (no debts,
     * no write-back) — the feature is purely additive.
     */
    organizationId?: string;
    /** B4 — when true, the solver also returns Pareto "what-if" alternatives
     *  (cheapest / most-balanced) for the trade-off explorer. Adds solve time,
     *  so the UI requests it explicitly. */
    computeAlternatives?: boolean;
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
        const shift_is_weekend = [0, 6].includes(new Date(shift.shift_date).getDay());
        // Simple night check: overlaps 00:00-06:00
        const startH = parseInt(shift.start_time.split(':')[0]);
        const endH = parseInt(shift.end_time.split(':')[0]);
        const isCrossMidnight = endH <= startH;
        const shift_is_night = startH < 6 || isCrossMidnight;

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

            // F1 Ledger Bonus/Penalty
            let debtBonus = 0;
            const debts = details?.fairness_debts;
            if (debts) {
                if (shift_is_weekend) {
                    if (debts.weekend_shifts < 0) debtBonus += Math.abs(debts.weekend_shifts) * 50; // owed weekend off -> bonus for this shift? No, wait.
                    // If they are owed a weekend off (positive debt), we want to PENALIZE assigning them this weekend shift.
                    // If they owe a weekend shift (negative debt), we want to BONUS assigning them.
                    if (debts.weekend_shifts > 0) debtBonus -= debts.weekend_shifts * 50;
                    if (debts.weekend_shifts < 0) debtBonus += Math.abs(debts.weekend_shifts) * 50;
                }
                if (shift_is_night) {
                    if (debts.night_shifts > 0) debtBonus -= debts.night_shifts * 50;
                    if (debts.night_shifts < 0) debtBonus += Math.abs(debts.night_shifts) * 50;
                }
            }

            // Preference discount/bonus
            const pref = new Set(details?.preferred_shift_ids || []);
            let preferenceBonus = 0;
            if (pref.has(shift.id)) {
                preferenceBonus += 50; // base preference bonus ($5.00 equivalent)
                if (debts && debts.denied_preferences > 0) {
                    // boost preference bonus based on denied_preferences debt
                    preferenceBonus += debts.denied_preferences * 20 * fairnessMult; 
                }
            }

            const score = 1000 - fatiguePenalty - utilizationPenalty + fairnessBonus + debtBonus + preferenceBonus;

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
                // Role-set eligibility — mirrors the solver's employee_eligible
                // and the manual/bulk R10 rule: an employee may work a shift only
                // if they hold a contract for the shift's role. (Replaces the old
                // numeric level-hierarchy gate, which let any higher-level person
                // take lower-level work and diverged from the solver.) Skip when
                // the shift carries no role requirement.
                if (shift.role_id) {
                    const roles = c.emp.contracted_role_ids ?? [];
                    if (!roles.includes(shift.role_id)) return false;
                }

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
            
            // No overqualification penalty (single-mode policy): holding a
            // role's contract makes that shift a legitimate assignment, so a
            // multi-role employee is not penalised for taking a lower role.
            const finalScore = candidate.score;

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
        const fairShareCap = (totalDemandMinutes / employeeCount) * 1.2;

        // F1 Ledger: fetch cumulative fairness debts for the optimizer run.
        // Requires a real org scope. When absent we SKIP entirely rather than
        // invent one — the ledger's organization_id is a uuid, so a fabricated
        // value would error and silently disable the feature anyway.
        const orgId = input.organizationId;
        let debtsMap: Map<string, Record<string, number>> | null = null;
        if (orgId) {
            try {
                const rawDebts = await fairnessLedgerService.getEmployeeDebts(
                    orgId,
                    input.employees.map(e => e.id),
                );
                debtsMap = debtsToMap(rawDebts);
                console.debug('[AutoScheduler] Fetched fairness debts for %d employees', debtsMap?.size ?? 0);
            } catch (err) {
                console.warn('[AutoScheduler] Failed to fetch fairness ledger, continuing without it:', err);
            }
        }

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
            const cappedMin = Math.min(scaledMin, fairShareCap);

            return {
                id: e.id,
                name: e.name,
                contract_type: e.contract_type,
                contracted_role_ids: e.contracted_role_ids ?? [],

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
                initial_fatigue_score: Math.min(
                  MAX_INITIAL_FATIGUE_SCORE,
                  calculateFatigueWithRecovery(
                    existingRoster.get(e.id) ?? [],
                    format(new Date(), 'yyyy-MM-dd') // Today's fatigue as baseline
                  ).current,
                ),
                ...det,
                fairness_debts: debtsMap?.get(e.id) ?? {},
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
        // B3/B5 — single-mode transparency, forwarded to the UI.
        let optimizerPillars: PillarScores | null = null;
        let optimizerBinding: BindingConstraint[] | null = null;
        let optimizerAlternatives: ParetoAlternative[] | null = null;
        let optimizerRationaleByShift: Record<string, AssignmentRationale> | undefined;

        // ── Layer 2: Call optimizer (with fallback) ───────────────────────────
        // Auto-scale the solver budget with problem size. Preprocess time
        // grows roughly linearly with raw_pairs; large rosters (e.g. 624
        // shifts × 103 employees → ~64k vars / 1.5M constraints) need
        // ~7-8s of preprocess + adequate solve time on top. A flat 30s cap
        // forces those runs to time out and engage greedy unnecessarily.
        const rawPairs = optimizerShifts.length * optimizerEmployees.length;
        // Extra wall-clock headroom for the largest monthly rosters. This
        // composes with the solver's front-loaded per-tier time allocation,
        // giving heavy runs enough budget to finish instead of timing out.
        const dynamicBudget = rawPairs > 30_000
            ? 120      // big problems (large monthly rosters): 120s
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
                // B1 — single-mode: always send the pinned policy (no sliders).
                strategy: SINGLE_MODE_STRATEGY,
                solver_params: {
                    max_time_seconds: solverBudget,
                    num_workers: input.numWorkers ?? 8,
                    compute_alternatives: input.computeAlternatives ?? false,
                    // Large month-long rosters time-starve the fairness/cost
                    // tiers on one monolithic solve. For big problems, decompose
                    // by ISO week (solver pins prior weeks → cross-week rest,
                    // hour caps and cumulative fairness are preserved). The
                    // solver auto-skips to monolithic when the range is <2 weeks,
                    // so this is safe for any large single-week problem too.
                    decompose_by_week: rawPairs > 30_000,
                },
            };

            const optimizeResponse = await optimizerClient.optimize(optimizeReq, input.signal);
            throwIfAborted();
            optimizerStatus = optimizeResponse.status;
            solveTimeMs = optimizeResponse.solve_time_ms;
            optimizerObjectiveBreakdown = optimizeResponse.objective_breakdown ?? null;
            // B3/B5/B4 — capture single-mode transparency for the UI.
            optimizerPillars = optimizeResponse.pillars ?? null;
            optimizerBinding = optimizeResponse.binding_constraints ?? null;
            optimizerAlternatives = optimizeResponse.alternatives ?? null;
            optimizerRationaleByShift = Object.fromEntries(
                optimizeResponse.assignments
                    .filter(a => a.rationale)
                    .map(a => [a.shift_id, a.rationale as AssignmentRationale]),
            );

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

        // ── Layer 2.4: Compliance repair — re-home rejected assignments ───────
        // Maximise COMPLIANT coverage. Any shift whose optimizer assignment
        // failed the compliance validator is re-solved onto a DIFFERENT compliant
        // employee (the failing pair is excluded), pinning the kept roster so
        // cross-assignment rest/hours still hold. Bounded + best-effort: it never
        // blocks the preview, and only runs on the real optimizer path (greedy
        // fallback has no solver to re-solve). Whatever still can't be placed
        // compliantly is left uncovered by the hard gate below.
        if (!usedFallback && validatedProposals.some(p => !p.passing)) {
            throwIfAborted();
            const repairStart = performance.now();
            const before = validatedProposals.filter(p => !p.passing).length;
            validatedProposals = await this._repairCompliance({
                proposals: validatedProposals,
                optimizerShifts,
                optimizerEmployees,
                inputShifts: input.shifts,
                inputEmployees: input.employees,
                employeeDetails: input.employeeDetails ?? new Map(),
                existingRoster,
                constraints: input.constraints ?? { min_rest_minutes: 600, relax_constraints: false },
                budgetSeconds: Math.min(30, Math.max(10, Math.round(solverBudget / 4))),
                signal: input.signal,
            });
            const after = validatedProposals.filter(p => !p.passing).length;
            console.info(
                '[AutoScheduler] Compliance repair: re-homed %d of %d rejected shift(s) in %dms (%d left uncovered for compliance)',
                before - after, before, Math.round(performance.now() - repairStart), after,
            );
        }

        // ── Layer 2.5: Enrich with Health Metrics (Fatigue/Fairness/Cost) ────
        // We calculate production-grade metrics for all proposals to ensure
        // the manager has an accurate audit of the projected roster health.
        if (validatedProposals.length > 0) {
            const employeeMap = new Map(input.employees.map(e => [e.id, e]));
            
            for (const p of validatedProposals) {
                if (!p.employeeId) continue;
                const emp = employeeMap.get(p.employeeId);
                const shift = input.shifts.find(s => s.id === p.shiftId);
                
                // 1. Cost (dollars, AUD)
                // On the optimizer path the solver already returned the
                // per-assignment cost it actually optimized — it is threaded
                // here as `p.optimizerCost` (set from `proposal.cost` in
                // `_validateProposals`, which originates in solution-parser).
                // That solver value IS the single source of truth and is what
                // the pillar "Labour cost" (`pillars.cost.total`) sums, so the
                // grid "Total Cost" reconciles with the pillar only if we leave
                // it untouched. Re-estimating client-side via `estimateShiftCost`
                // here is a different cost engine that diverges by ~15%.
                //
                // The greedy fallback never calls the optimizer, so no solver
                // cost exists — in that case we DO re-estimate. Both engines
                // return dollars, so no unit conversion is needed.
                if (usedFallback && shift && emp) {
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

        // ── Compliance is a HARD gate ─────────────────────────────────────────
        // A non-compliant assignment is NEVER applied (commit() drops it at the
        // recheck step), so it must not be presented as a "proposal" either —
        // otherwise the scorecard shows <100% compliance for a roster we would
        // never actually book. Reclassify every failing proposal as an UNCOVERED
        // shift: the applied roster is then 100% compliant BY CONSTRUCTION, and
        // coverage honestly reflects the compliant maximum the solver reached.
        const compliantProposals = validatedProposals.filter(p => p.passing);
        const droppedForCompliance = validatedProposals.filter(p => !p.passing);
        uncoveredV8ShiftIds = Array.from(
            new Set([...uncoveredV8ShiftIds, ...droppedForCompliance.map(p => p.shiftId)]),
        );

        const passing = compliantProposals.length;
        const failing = 0; // by construction — nothing non-compliant reaches the roster

        // Recompute coverage + cost pillars over the COMPLIANT set so the
        // scorecard matches what will actually be booked (the solver computed
        // them over every proposal, including the ones we just uncovered).
        // Fairness/wellbeing move only marginally and need solver-side
        // effective-minute state to recompute, so they are left as reported.
        let pillars = optimizerPillars;
        if (pillars) {
            const total = pillars.coverage?.total ?? (passing + uncoveredV8ShiftIds.length);
            const compliantCost = compliantProposals.reduce((s, p) => s + (p.optimizerCost || 0), 0);
            pillars = {
                ...pillars,
                coverage: {
                    ...pillars.coverage,
                    score: total > 0 ? Math.round((passing / total) * 1000) / 10 : 100,
                    covered: passing,
                    total,
                },
                cost: {
                    ...pillars.cost,
                    total: Math.round(compliantCost * 100) / 100,
                    avg_per_shift: passing > 0 ? Math.round((compliantCost / passing) * 100) / 100 : 0,
                },
            };
        }

        // Tell the U5 banner WHY each compliance-dropped shift is uncovered (the
        // solver's own binding list only covers shifts it couldn't place at all).
        const complianceBinding = droppedForCompliance
            .filter(p => p.violations?.length)
            .map(p => ({
                shift_id: p.shiftId,
                eligible_count: 0,
                reason: (p.violations.find(v => v.blocking) ?? p.violations[0])?.description
                    ?? 'Left uncovered to keep the roster 100% compliant',
            }));

        const result: AutoSchedulerResult = {
            optimizerStatus,
            solveTimeMs,
            validationTimeMs,
            totalProposals: passing,        // compliant-only → compliance pillar reads 100%
            passing,
            failing,
            uncoveredV8ShiftIds,
            proposals: compliantProposals,  // only assignments we will actually book
            canCommit: passing > 0,
            usedFallback,
            capacityCheck,
            // Forward the per-category breakdown from the Python service.
            // Null when the greedy fallback path was taken (usedFallback=true)
            // because greedyFallback never calls the optimizer.
            objective_breakdown: optimizerObjectiveBreakdown,
            organizationId: input.organizationId,
            // B3/B5/B4 — single-mode transparency for the scorecard, constraint
            // banner, trade-off explorer, and per-shift "why" panel.
            pillars,
            bindingConstraints: [...(optimizerBinding ?? []), ...complianceBinding],
            alternatives: optimizerAlternatives,
            rationaleByShift: optimizerRationaleByShift,
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
     * Commit passing proposals with concurrency recheck — atomic multi-pair path.
     *
     * Flow:
     *   1. Group passing proposals by employee (same as before).
     *   2. Re-run simulate() in parallel chunks per employee to refresh
     *      compliance against current DB state (TOCTOU guard — same as before).
     *   3. Collect ALL freshly-passing (employeeId → shiftIds) pairs from the
     *      recheck step into a single list.
     *   4. Send the entire list to sm_bulk_assign_atomic via ONE RPC call, with
     *      a per-attempt idempotency key (crypto.randomUUID). This makes the
     *      commit atomic across all employees: if the DB throws a hard error
     *      nothing is written; if the tab closes after the RPC was dispatched a
     *      retry with the same key is a no-op.
     *   5. Map the RPC's per_employee breakdown back to CommitResult shape.
     *
     * Idempotency key is generated fresh per commit attempt so a manager
     * clicking Apply twice gets two independent attempts — each is idempotent
     * within itself (retry-safe) but does not deduplicate across attempts.
     */
    async commit(result: AutoSchedulerResult): Promise<CommitResult> {
        const byEmployee = new Map<string, string[]>();
        for (const p of result.proposals) {
            if (!p.passing || !p.employeeId) continue;
            const list = byEmployee.get(p.employeeId) ?? [];
            list.push(p.shiftId);
            byEmployee.set(p.employeeId, list);
        }

        if (byEmployee.size === 0) {
            return { success: true, totalCommitted: 0, failedEmployees: [], concurrencyConflicts: [] };
        }

        // ── Step 1: Per-employee compliance recheck (TOCTOU guard) ────────────
        // Run in chunks of 5 to avoid browser lock contention.
        type RecheckOutcome = {
            employeeId: string;
            passingShiftIds: string[];
            recheckFailed: boolean;
            recheckConflicts: string[]; // shifts that newly-failed recheck
        };

        const entries = Array.from(byEmployee.entries());
        const CHUNK_SIZE = 5;
        const recheckOutcomes: RecheckOutcome[] = [];

        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            const chunk = entries.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(
                chunk.map(async ([employeeId, shiftIds]): Promise<RecheckOutcome> => {
                    let freshResult: BulkAssignmentResult;
                    try {
                        freshResult = await bulkAssignmentController.simulate(
                            shiftIds, employeeId, { mode: 'PARTIAL_APPLY' },
                        );
                    } catch (err) {
                        console.error('[AutoScheduler] Recheck failed for employee', employeeId, err);
                        return { employeeId, passingShiftIds: [], recheckFailed: true, recheckConflicts: shiftIds };
                    }

                    if (freshResult.passedV8ShiftIds.length === 0) {
                        console.debug('[AutoScheduler] All shifts failed recheck for', employeeId);
                        return {
                            employeeId,
                            passingShiftIds: [],
                            recheckFailed: true,
                            recheckConflicts: freshResult.failedV8ShiftIds,
                        };
                    }

                    // Per-employee conflicts are aggregated into ONE summary after
                    // the recheck loop (see below) — no per-employee warn flood.
                    return {
                        employeeId,
                        passingShiftIds: freshResult.passedV8ShiftIds,
                        recheckFailed: false,
                        recheckConflicts: freshResult.failedV8ShiftIds,
                    };
                }),
            );
            recheckOutcomes.push(...chunkResults);
        }

        // One aggregated recheck summary instead of a per-employee warn flood.
        const recheckNewlyFailed = recheckOutcomes.reduce((s, o) => s + o.recheckConflicts.length, 0);
        const recheckAffected = recheckOutcomes.filter(o => o.recheckConflicts.length > 0).length;
        if (recheckNewlyFailed > 0) {
            console.warn(
                '[AutoScheduler] Concurrency recheck: %d shift(s) across %d staff newly failed and were skipped from the commit',
                recheckNewlyFailed, recheckAffected,
            );
        }

        // Employees whose recheck entirely failed — they will not be in the
        // atomic commit at all and are reported as failedEmployees.
        const recheckFailedEmployees = recheckOutcomes
            .filter(o => o.recheckFailed)
            .map(o => o.employeeId);

        // Shifts that newly-failed compliance recheck → concurrency conflicts.
        const recheckConflicts = recheckOutcomes.flatMap(o => o.recheckConflicts);

        // Build the assignment list for the atomic RPC — only employees with
        // at least one passing shift.
        const atomicAssignments = recheckOutcomes
            .filter(o => !o.recheckFailed && o.passingShiftIds.length > 0)
            .map(o => ({ employeeId: o.employeeId, shiftIds: o.passingShiftIds }));

        if (atomicAssignments.length === 0) {
            return {
                success: recheckFailedEmployees.length === 0,
                totalCommitted: 0,
                failedEmployees: recheckFailedEmployees,
                concurrencyConflicts: recheckConflicts,
            };
        }

        // ── Step 2: ONE atomic RPC call for all employee pairs ────────────────
        const idempotencyKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : undefined;

        const atomicResult = await assignmentCommitter.commitAtomic(atomicAssignments, idempotencyKey);

        // Merge recheck-failed employees with any DB-level failures reported by
        // the atomic committer (e.g. employee had 0 committed after RPC).
        const allFailedEmployees = Array.from(
            new Set([...recheckFailedEmployees, ...atomicResult.failedEmployees]),
        );
        const allConflicts = Array.from(
            new Set([...recheckConflicts, ...atomicResult.concurrencyConflicts]),
        );

        console.debug('[AutoScheduler] Atomic commit complete:', {
            totalCommitted: atomicResult.totalCommitted,
            failedEmployees: allFailedEmployees,
            concurrencyConflicts: allConflicts,
            idempotencyKey: idempotencyKey ?? 'none',
        });

        // ── F1 fairness-ledger write-back ─────────────────────────────────────
        // Record the shifts we actually committed so future runs see updated
        // weekend/night/PH/hours debts. Fire-and-forget: a ledger hiccup must
        // never fail an already-committed roster. Skipped when no org scope.
        if (result.organizationId && atomicResult.totalCommitted > 0) {
            const conflictSet = new Set(allConflicts);
            const proposalById = new Map(result.proposals.map(p => [p.shiftId, p]));
            const committedShifts: ShiftForFairness[] = [];
            for (const pair of atomicAssignments) {
                for (const shiftId of pair.shiftIds) {
                    if (conflictSet.has(shiftId)) continue;
                    const p = proposalById.get(shiftId);
                    if (!p) continue;
                    committedShifts.push({
                        id: shiftId,
                        employeeId: pair.employeeId,
                        shiftDate: p.shiftDate,
                        startTime: p.startTime,
                        endTime: p.endTime,
                    });
                }
            }
            if (committedShifts.length > 0) {
                fairnessLedgerService
                    .updateAfterCommit(result.organizationId, committedShifts)
                    .catch(err =>
                        console.error('[AutoScheduler] Fairness ledger write-back failed:', err),
                    );
            }
        }

        return {
            success: atomicResult.success && allFailedEmployees.length === 0 && allConflicts.length === 0,
            totalCommitted: atomicResult.totalCommitted,
            failedEmployees: allFailedEmployees,
            concurrencyConflicts: allConflicts,
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

    /**
     * Compliance repair loop — maximise COMPLIANT coverage.
     *
     * The optimizer assigns the best (cheapest/fairest) eligible employee per
     * shift, but the TS compliance engine may reject some of those assignments
     * (rules the solver doesn't model). Rather than just dropping them, we
     * re-solve the rejected shifts onto a DIFFERENT employee:
     *
     *   1. Keep the compliant assignments; collect the rejected ones.
     *   2. Re-solve ONLY the rejected shifts, with: the kept roster pinned as
     *      existing_shifts (cross-assignment rest/hours preserved) and every
     *      known-bad (employee, shift) pair excluded (so the solver must pick a
     *      different employee, or leave the shift uncovered).
     *   3. Validate the new assignments; fold the passers into the roster, add
     *      any new failures to the exclusion set, and repeat.
     *
     * Converges because the exclusion set grows monotonically and each shift has
     * finitely many eligible employees; bounded by MAX_ITERS for safety. The
     * re-solves are tiny (only the rejected shifts) so the added time is small.
     * Best-effort: any re-solve error keeps the current roster.
     */
    private async _repairCompliance(args: {
        proposals: ValidatedProposal[];
        optimizerShifts: OptimizerShift[];
        optimizerEmployees: OptimizerEmployee[];
        inputShifts: ShiftMeta[];
        inputEmployees: EmployeeMeta[];
        employeeDetails: Map<string, Partial<OptimizerEmployee>>;
        existingRoster: Map<string, ExistingShiftRef[]>;
        constraints: OptimizerConstraints;
        budgetSeconds: number;
        signal?: AbortSignal;
    }): Promise<ValidatedProposal[]> {
        const {
            proposals, optimizerShifts, optimizerEmployees, inputShifts, inputEmployees,
            employeeDetails, existingRoster, constraints, budgetSeconds, signal,
        } = args;
        const MAX_ITERS = 3;
        const SEP = ' ';
        const shiftById = new Map(optimizerShifts.map(s => [s.id, s]));
        const { shiftMap, employeeMap } = solutionParser.buildMaps(inputShifts, inputEmployees);

        // Only retry genuine compliance failures with a known assignee — never a
        // PAST_SHIFT (unfixable) or a SYSTEM error, and never an empty employee.
        const isRepairable = (p: ValidatedProposal) =>
            !!p.employeeId && !(p.violations ?? []).some(v => v.type === 'PAST_SHIFT' || v.type === 'SYSTEM');

        let compliant = proposals.filter(p => p.passing);
        const failing = proposals.filter(p => !p.passing);
        const nonRepairable = failing.filter(p => !isRepairable(p));
        const pending = failing.filter(isRepairable);
        if (pending.length === 0) return proposals;

        const excluded = new Set<string>();
        const unresolved = new Map<string, ValidatedProposal>();
        for (const p of pending) {
            excluded.add(`${p.employeeId}${SEP}${p.shiftId}`);
            unresolved.set(p.shiftId, p);
        }

        for (let iter = 0; iter < MAX_ITERS && unresolved.size > 0; iter++) {
            if (signal?.aborted) break;

            // Pin the kept compliant roster as existing_shifts (for BOTH the
            // solver and the validator) so the repair respects rest/hours/overlap
            // against assignments we are keeping.
            const pinsByEmp = new Map<string, ExistingShiftRef[]>();
            for (const p of compliant) {
                const s = shiftById.get(p.shiftId);
                if (!s || !p.employeeId) continue;
                const arr = pinsByEmp.get(p.employeeId) ?? [];
                arr.push({
                    id: s.id, shift_date: s.shift_date, start_time: s.start_time,
                    end_time: s.end_time, duration_minutes: s.duration_minutes,
                    unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
                });
                pinsByEmp.set(p.employeeId, arr);
            }
            const repairEmployees: OptimizerEmployee[] = optimizerEmployees.map(e => ({
                ...e,
                existing_shifts: [...(e.existing_shifts ?? []), ...(pinsByEmp.get(e.id) ?? [])],
            }));
            const repairShifts = optimizerShifts.filter(s => unresolved.has(s.id));

            let repairResp: OptimizeResponse;
            try {
                repairResp = await optimizerClient.optimize({
                    shifts: repairShifts,
                    employees: repairEmployees,
                    constraints,
                    strategy: SINGLE_MODE_STRATEGY,
                    solver_params: { max_time_seconds: budgetSeconds, num_workers: 8 },
                    excluded_pairs: Array.from(excluded).map(k => {
                        const [employee_id, shift_id] = k.split(SEP);
                        return { employee_id, shift_id };
                    }),
                }, signal);
            } catch (err) {
                console.warn('[AutoScheduler] Compliance repair re-solve failed; keeping current roster', err);
                break;
            }

            const { groups } = solutionParser.parse(repairResp, shiftMap, employeeMap);

            // Validator must also see the pinned roster (rest/hours) → augment.
            const augmentedRoster = new Map(existingRoster);
            for (const [empId, pins] of pinsByEmp) {
                augmentedRoster.set(empId, [...(existingRoster.get(empId) ?? []), ...pins]);
            }
            const repairValidated = await this._validateProposals(groups, employeeDetails, augmentedRoster);

            const placed = new Set(repairValidated.map(p => p.shiftId));
            const newlyPassing = repairValidated.filter(p => p.passing);
            const newlyFailing = repairValidated.filter(p => !p.passing);

            compliant = [...compliant, ...newlyPassing];
            for (const p of newlyPassing) unresolved.delete(p.shiftId);
            for (const p of newlyFailing) {
                excluded.add(`${p.employeeId}${SEP}${p.shiftId}`);
                if (unresolved.has(p.shiftId)) unresolved.set(p.shiftId, p); // latest failing attempt
            }
            // A pending shift the solver couldn't place at all this round has no
            // remaining compliant candidate → give up on it (leave uncovered).
            for (const sid of Array.from(unresolved.keys())) {
                if (!placed.has(sid)) unresolved.delete(sid);
            }
            if (newlyFailing.length === 0) break; // nothing new failed → converged
        }

        // Kept compliant + whatever still couldn't be re-homed (stays failing →
        // uncovered by the hard gate) + the unfixable failures.
        return [...compliant, ...Array.from(unresolved.values()), ...nonRepairable];
    }

    private async _validateProposals(
        groups: ReturnType<typeof solutionParser.parse>['groups'],
        employeeDetails: Map<string, Partial<OptimizerEmployee>>,
        existingRoster: Map<string, ExistingShiftRef[]>,
    ): Promise<ValidatedProposal[]> {
        const all: ValidatedProposal[] = [];

        // Aggregate compliance-failure diagnostics into ONE summary log at the
        // end, instead of one noisy console line per employee (100+ staff floods
        // the console and reads like an error storm).
        let failTotal = 0;
        const failedStaff = new Set<string>();
        const failByRule: Record<string, number> = {};

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

            // Diagnostic: accumulate WHICH rule disagrees with the solver, so the
            // single end-of-pass summary can report it. (The optimizer can return
            // 100% coverage while the validator rejects some proposals; those are
            // then left uncovered to keep the roster compliant.)
            const groupFail = bulkResult.results.filter(r => !r.passing).length;
            if (groupFail > 0) {
                failTotal += groupFail;
                failedStaff.add(group.employeeName);
                for (const r of bulkResult.results) {
                    for (const v of r.violations ?? []) {
                        failByRule[v.violation_type] = (failByRule[v.violation_type] ?? 0) + 1;
                    }
                }
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

        if (failTotal > 0) {
            console.warn(
                '[AutoScheduler] Validation: %d assignment(s) across %d staff failed compliance and will be left uncovered — by rule: %o',
                failTotal, failedStaff.size, failByRule,
            );
        }

        return all;
    }

}

export const autoSchedulerController = new AutoSchedulerController();
