/**
 * V8 Compliance Engine — Swap Engine Types
 */

import { V8Status, V8Shift } from '../types';

export type RosterShift = V8Shift;

export interface SwapParty {
    employee_id:           string;
    name:                  string;
    hypothetical_schedule: RosterShift[];
    received_shift:        RosterShift;
    given_shift:           RosterShift;
    is_student_visa?:      boolean;
}

export interface SwapScenario {
    partyA: SwapParty;
    partyB: SwapParty;
}

export interface SwapPartyInput {
    employee_id:     string;
    name:            string;
    current_shifts:  RosterShift[];
    shift_to_give:   RosterShift;
    is_student_visa?: boolean;
}

export interface SwapEvaluationInput {
    partyA:  SwapPartyInput;
    partyB:  SwapPartyInput;
    config?: SolverConfig;
}

export interface SolverConfig {
    max_daily_hours?:          number;
    rest_gap_hours?:           number;
    max_consecutive_days?:     number;
    averaging_cycle_weeks?:    number;
    student_visa_enforcement?: boolean;
    public_holiday_dates?:     string[];
    candidate_is_training?:    boolean;
    action_type?:              'add' | 'assign' | 'bid' | 'swap';
}

export interface ConstraintViolation {
    id:            string;
    constraint_id: string; // Alias for id
    name:          string;
    constraint_name: string; // Alias for name
    employee_id:   string;
    employee_name?: string;
    status:        'pass' | 'fail' | 'warning';
    summary:       string;
    details:       string;
    blocking:      boolean;
    calculation?:  Record<string, any>;
}

export interface SolverResult {
    feasible:       boolean;
    violations:     ConstraintViolation[];
    warnings:       ConstraintViolation[];
    all_results:    ConstraintViolation[];
    solve_time_ms:  number;
    scenario:       SwapScenario;
}
