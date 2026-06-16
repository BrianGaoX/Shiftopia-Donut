/**
 * Scheduling Module — Shared Types
 *
 * Types shared between the OR-Tools client, solution parser,
 * auto-scheduler controller, and the UI layer.
 */

// =============================================================================
// OPTIMIZER REQUEST
// =============================================================================

export interface OptimizerShift {
    id: string;
    shift_date: string;           // YYYY-MM-DD
    start_time: string;           // HH:MM
    end_time: string;             // HH:MM
    duration_minutes: number;
    role_id?: string | null;
    required_skill_ids?: string[];
    required_license_ids?: string[];
    priority?: number;            // 1 (default) → higher = more important
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: 'FT' | 'PT' | 'Casual' | null;
    level?: number;
    /** Used by SC-1 to apply award-rate multipliers (1.5× / 2.5×). */
    is_sunday?: boolean;
    is_public_holiday?: boolean;
    /** Lower min-engagement floor (training shifts can be 2h vs 3h). */
    is_training?: boolean;
    /** Required by `_calculate_effective_minutes` for fatigue scoring. */
    unpaid_break_minutes?: number;
    /** 'NORMAL' or 'MULTI_HIRE' — shorter rest gap (480m) for multi-hire. */
    shift_type?: 'NORMAL' | 'MULTI_HIRE';
}

export interface ExistingShiftRef {
    id: string;
    shift_date: string;     // YYYY-MM-DD
    start_time: string;     // HH:MM
    end_time: string;       // HH:MM
    duration_minutes: number;
    unpaid_break_minutes: number;
}

/**
 * A single declared availability window. Sent to the optimizer as the
 * authoritative "yes I am available here" signal. If an employee has
 * `has_availability_data: true` and a shift falls outside every slot, the
 * optimizer treats them as unavailable for that shift.
 */
export interface AvailabilitySlotRef {
    slot_date: string;     // YYYY-MM-DD
    start_time: string;    // HH:MM
    end_time: string;      // HH:MM
}

export interface OptimizerEmployee {
    id: string;
    name: string;
    role_id?: string | null;
    contracted_role_ids?: string[];
    contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
    employment_type?: string;
    hourly_rate?: number;
    min_contract_minutes?: number;   // FT/PT contract minimum (0 for Casuals)
    contract_weekly_minutes?: number; // Raw weekly contract base
    max_weekly_minutes?: number;  // Default 2400 (40h)
    skill_ids?: string[];
    license_ids?: string[];
    preferred_shift_ids?: string[];
    unavailable_dates?: string[];
    level?: number;
    is_flexible?: boolean;
    is_student?: boolean;
    visa_limit?: number;
    existing_shifts?: ExistingShiftRef[];
    contracts?: any[];
    qualifications?: any[];
    /**
     * Declared availability windows in the optimization range. Empty array
     * means "no data on file" (treated as universally available);
     * non-empty means "available only when a shift fits within one of
     * these windows" (treated as unavailable otherwise).
     */
    availability_slots?: AvailabilitySlotRef[];
    /**
     * True if the employee has *any* availability record on file —
     * including outside the current window. Distinguishes "not yet
     * onboarded" (no records ever → universally available) from "has
     * declared availability but none in this window" (records elsewhere →
     * universally unavailable for this window).
     */
    has_availability_data?: boolean;
    /**
     * Severity-based availability windows: tuples of
     * `[start_time, end_time, severity]` where severity is 'HARD',
     * 'SOFT', or 'PREFERENCE'. HARD entries are pre-filter blockers;
     * SOFT/PREFERENCE add penalties to the objective. The TS controller
     * doesn't currently populate these (they come from a future bulk
     * leave-management feature) but the field exists on the wire to
     * forward-compat the Python service.
     */
    availability_overrides?: Array<[string, string, 'HARD' | 'SOFT' | 'PREFERENCE']>;
    /** F1: Ledger debts. Positive = penalty for assigning more, Negative = bonus. */
    fairness_debts?: Record<string, number>;
}

export interface OptimizerStrategy {
    fatigue_weight?: number;      // 0-100, default 50
    fairness_weight?: number;     // 0-100, default 50
    cost_weight?: number;         // 0-100, default 50
    coverage_weight?: number;     // 0-100, default 100 (critical)
}

export interface OptimizerConstraints {
    min_rest_minutes?: number;       // Default 600 (10h)
    enforce_role_match?: boolean;    // Default true
    enforce_skill_match?: boolean;   // Default true
    allow_partial?: boolean;         // Default true — allow uncovered shifts
    relax_constraints?: boolean;     // If true, softens overlap/rest-gap to soft constraints
}

export interface OptimizeRequest {
    shifts: OptimizerShift[];
    employees: OptimizerEmployee[];
    constraints: OptimizerConstraints;
    strategy?: OptimizerStrategy;
    solver_params?: {
        max_time_seconds?: number;
        num_workers?: number;
        enable_greedy_hint?: boolean;
        /** B4 — also compute Pareto "what-if" alternatives for the explorer. */
        compute_alternatives?: boolean;
        /**
         * Month-long rosters: solve each ISO week in sequence so the
         * fairness/cost tiers aren't time-starved on one large monolithic solve.
         * Auto-skipped (monolithic) by the solver when the horizon is <2 ISO weeks.
         */
        decompose_by_week?: boolean;
    };
}

// =============================================================================
// SERVER-SIDE AUDIT (replaces per-pair simulate() fan-out)
// =============================================================================

export interface AuditRequest {
    shifts: OptimizerShift[];
    employees: OptimizerEmployee[];
    constraints: OptimizerConstraints;
    /** Subset of shift IDs to audit. Omit to audit every shift in `shifts`. */
    target_shift_ids?: string[];
}

export interface AuditEmployeeRow {
    employee_id: string;
    status: 'PASS' | 'FAIL';
    /** Reason codes (e.g. 'ROLE_MISMATCH', 'OUTSIDE_DECLARED_AVAILABILITY'). */
    rejection_reasons: string[];
}

export interface AuditShiftRow {
    shift_id: string;
    /** Map of reason code → number of employees rejected for that reason. */
    rejection_summary: Record<string, number>;
    employees: AuditEmployeeRow[];
}

export interface AuditResponse {
    audited_shift_count: number;
    rows: AuditShiftRow[];
    elapsed_ms: number;
}

// =============================================================================
// OPTIMIZER RESPONSE
// =============================================================================

export type OptimizerStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN' | 'MODEL_INVALID';

/** B5 — per-assignment "why this person" factors from the solver. */
export interface AssignmentRationale {
    /** 1 = cheapest of the eligible pool for this shift; null if unknown. */
    cost_rank: number | null;
    eligible_count: number;
    cheapest_eligible: boolean;
    /** Sum of the employee's positive fairness-ledger debts (excl. preferences). */
    fairness_debt: number;
    /** emp.level − shift.level (positive = over-qualified). */
    qual_gap: number;
}

export interface AssignmentProposal {
    shift_id: string;
    employee_id: string;
    employment_type: string;
    cost: number;
    rationale?: AssignmentRationale | null;
}

/** B3/B5 — four-pillar scorecard derived from the solution (single-mode UX). */
export interface PillarScores {
    coverage: { score: number; covered: number; total: number };
    cost: { total: number; currency: string; avg_per_shift: number };
    fairness: { score: number; employees_used: number; spread_minutes: number; peak_minutes: number };
    fatigue: { score: number; amber: number; critical: number };
}

/** B5 — why a shift was left uncovered (drives the U5 banner). */
export interface BindingConstraint {
    shift_id: string;
    eligible_count: number;
    reason: string;
}

/** B4 — a Pareto "what-if" alternative for the trade-off explorer. */
export interface ParetoAlternative {
    key: string;          // 'cheapest' | 'fairest' | ...
    label: string;        // human label
    pillars: PillarScores;
}

export interface OptimizeResponse {
    status: OptimizerStatus;
    assignments: AssignmentProposal[];
    unassigned_shift_ids: string[];
    objective_value: number;
    solve_time_ms: number;
    num_variables: number;
    num_constraints: number;
    total_time_ms: number;
    /** Per-category breakdown of the solver objective value (cents).
     *  Null when the solver returned INFEASIBLE / UNKNOWN / MODEL_INVALID.
     *  Categories: cost, fairness, fatigue, coverage, continuity,
     *  employment_mix, relaxed_violations, availability, other. */
    objective_breakdown?: Record<string, number> | null;
    /** B3 — per-tier objective optima (coverage / guardrail / cost). */
    tier_values?: Record<string, number> | null;
    /** B5 — four-pillar scorecard. */
    pillars?: PillarScores | null;
    /** B5 — reasons for uncovered shifts. */
    binding_constraints?: BindingConstraint[] | null;
    /** B4 — Pareto "what-if" alternatives. */
    alternatives?: ParetoAlternative[] | null;
}

// =============================================================================
// AUTO-SCHEDULER RESULT (after compliance validation)
// =============================================================================

export type ProposalValidationStatus = 'PASS' | 'WARN' | 'FAIL';

export interface ValidatedProposal {
    shiftId: string;
    employeeId: string;
    employeeName: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    optimizerCost: number;
    employmentType: string;
    complianceStatus: ProposalValidationStatus;
    violations: Array<{
        type: string;
        description: string;
        blocking: boolean;
    }>;
    fatigueScore?: number;
    utilization?: number;
    roleName?: string;
    roleId?: string | null;
    passing: boolean;
}

export interface UncoveredAudit {
    shiftId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    rejectionSummary: Record<string, number>; // violationType -> count
    roleName?: string;
    roleId?: string | null;
    employeeDetails: Array<{
        employeeId: string;
        employeeName: string;
        status: ProposalValidationStatus;
        violations: Array<{ type: string; description: string }>;
    }>;
}

/**
 * Per-day demand vs. supply snapshot computed BEFORE the optimizer runs.
 * `deficitMinutes > 0` means there is mathematically not enough labour
 * to cover the day, regardless of how the solver assigns people.
 */
export interface CapacityDayBreakdown {
    date: string;                 // YYYY-MM-DD
    shiftCount: number;
    demandMinutes: number;        // Sum of shift durations
    supplyMinutes: number;        // Sum of employee daily caps
    employeeCount: number;
    deficitMinutes: number;       // max(0, demand - supply)
    sufficient: boolean;
}

export interface CapacityCheck {
    sufficient: boolean;          // Overall: every day satisfies demand ≤ supply
    totalDemandMinutes: number;
    totalSupplyMinutes: number;
    deficitDays: CapacityDayBreakdown[]; // Days where demand > supply
    perDay: CapacityDayBreakdown[];      // All days
}

export interface AutoSchedulerResult {
    optimizerStatus: OptimizerStatus;
    solveTimeMs: number;
    validationTimeMs: number;
    totalProposals: number;
    passing: number;
    failing: number;
    uncoveredV8ShiftIds: string[];
    uncoveredAudit?: UncoveredAudit[];
    /** Number of uncovered shifts actually audited (audit may be capped for performance). */
    auditedUncoveredCount?: number;
    capacityCheck?: CapacityCheck;
    proposals: ValidatedProposal[];
    canCommit: boolean;
    usedFallback: boolean;
    /** Per-category solver objective breakdown forwarded from the Python service.
     *  Null/undefined when the optimizer was unreachable or returned no solution
     *  (greedy fallback path). Safe to access with optional-chaining. */
    objective_breakdown?: Record<string, number> | null;
    /** Org scope echoed from the run input, so commit() can write the F1
     *  fairness ledger back. Undefined when no org was supplied (ledger off). */
    organizationId?: string;
    /** B3/B5 — single-mode transparency, forwarded from the solver for the UI
     *  scorecard, constraint banner, and trade-off explorer. */
    pillars?: PillarScores | null;
    bindingConstraints?: BindingConstraint[] | null;
    alternatives?: ParetoAlternative[] | null;
    /** B5 — per-assignment rationale keyed by shiftId ("why this person"). */
    rationaleByShift?: Record<string, AssignmentRationale>;
}

// =============================================================================
// CONNECTION STATUS
// =============================================================================

export interface OptimizerHealth {
    available: boolean;
    url: string;
    latencyMs?: number;
    error?: string;
}
