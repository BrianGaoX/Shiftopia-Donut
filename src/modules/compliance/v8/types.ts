/**
 * V8 Compliance Engine — Unified Type Contract
 * 
 * The single source of truth for all compliance data structures in Shiftopia.
 * Replaces all V1/V2/Solver types.
 */

export type ComplianceCheckInput = any; // Legacy alias
export type ComplianceResult = any;     // Legacy alias

export type V8ShiftId = string;
export type V8EmpId   = string;
export type V8RoleId  = string;

export type V8ContractType = 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'STUDENT_VISA' | 'FLEXI_PART_TIME';
export type V8Severity     = 'WARNING' | 'BLOCKING';
export type V8Status       = 'PASS' | 'WARNING' | 'BLOCKING';

/** Unified shift representation for the V8 engine */
export interface V8Shift {
    id:                    V8ShiftId;
    date:                  string;    // YYYY-MM-DD
    shift_date?:           string;    // Alias for compatibility
    start_time:            string;    // HH:mm
    end_time:              string;    // HH:mm
    is_ordinary_hours:     boolean;
    unpaid_break_minutes?: number;
    role_id?:              V8RoleId;
    is_training?:          boolean;
    is_sunday?:            boolean;
    is_public_holiday?:    boolean;
    shift_type?:           'NORMAL' | 'MULTI_HIRE';
}

/** Unified employee context */
export interface V8Employee {
    id:                      V8EmpId;
    name:                    string;
    contract_type:           V8ContractType;
    contracted_weekly_hours: number;
    skill_ids?:              string[];
    license_ids?:            string[];
    /** Rich qualification records with expiry dates. When present, the
     *  qualification rule uses these instead of skill_ids / license_ids so
     *  that expired credentials are never silently treated as valid. */
    qualifications?:         QualificationV2[];
}

export interface QualificationV2 {
    qualification_id: string;
    issued_at:        string;
    expires_at:       string | null;
}

export interface ContractRecordV2 {
    organization_id:   string;
    department_id:     string;
    sub_department_id: string | null;
    role_id:           string;
}

export type ContractType = V8ContractType;

/** Global EBA/Policy configuration for the V8 engine */
export interface V8Config {
    /** Ordinary Hours Averaging */
    ord_avg_cycle_weeks:    number;   // default 4
    ord_avg_weekly_limit:   number;   // default 38
    
    /** Daily Limits */
    max_daily_hours:        number;   // default 12
    
    /** Rest & Recovery */
    min_rest_gap_minutes:   number;   // default 600 (10h)
    max_consecutive_days:   number;   // default 6
    
    /** Legal / Visa */
    student_visa_fortnightly_limit: number; // default 48
    
    /** Thresholds */
    meal_break_threshold_minutes: number;   // default 300 (5h)
}

export const DEFAULT_V8_CONFIG: V8Config = {
    ord_avg_cycle_weeks:    4,
    ord_avg_weekly_limit:   38,
    max_daily_hours:        12,
    min_rest_gap_minutes:   600,
    max_consecutive_days:   6,
    student_visa_fortnightly_limit: 48,
    meal_break_threshold_minutes: 300,
};

/** A violation detected by a V8 rule */
export interface V8Hit {
    rule_id:         string;
    rule_name:       string;
    status:          V8Status;
    summary:         string;
    details:         string;
    affected_shifts: V8ShiftId[];
    blocking:        boolean;
    calculation?:    Record<string, any>;
}

/** Final output from the V8 engine */
export interface V8Result {
    passed:             boolean;
    overall_status:     V8Status;
    hits:               V8Hit[];
    solve_time_ms:      number;
    evaluated_shifts:   number;
}

/** Context provided to every V8 rule evaluator */
export interface V8RuleContext {
    employee:          V8Employee;
    shifts:            V8Shift[];         // Combined existing + proposed
    candidate_shift?:  V8Shift;           // The shift being added/assigned (if any)
    config:            V8Config;
    reference_date:    string;            // YYYY-MM-DD
}

export type V8RuleEvaluator = (ctx: V8RuleContext) => V8Hit[];
