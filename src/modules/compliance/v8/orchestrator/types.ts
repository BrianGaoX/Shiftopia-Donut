/**
 * V8 Compliance Engine — Orchestrator Types
 * 
 * Unified type contract for simulation, orchestration, and aggregation.
 */

import { V8ShiftId, V8EmpId, V8RoleId, V8ContractType, V8Status, V8Hit, V8Config, V8Shift, V8Employee } from '../types';

export type { V8ShiftId, V8EmpId, V8RoleId, V8ContractType, V8Status, V8Hit, V8Config, V8Shift, V8Employee };

export type V8OperationType = 'ASSIGN' | 'BID' | 'SWAP';
export type V8EvalMode      = 'CURRENT' | 'SIMULATED';
export type V8Stage         = 'DRAFT' | 'PUBLISH' | 'LIVE';

export interface V8CandidateChanges {
    add_shifts:    V8OrchestratorShift[];
    remove_shifts: V8ShiftId[];
}

export interface V8AvailabilitySlot {
    slot_date:   string;
    start_time:  string;
    end_time:    string;
}

export interface V8AvailabilityData {
    declared_slots:  V8AvailabilitySlot[];
    assigned_shifts: V8Shift[];
}

export interface V8OrchestratorShift extends V8Shift {
    organization_id?:        string;
    department_id?:          string;
    sub_department_id?:      string;
    required_qualifications: string[];
    break_minutes:           number;
}

export interface V8EmployeeContext {
    employee_id:              V8EmpId;
    contract_type:            V8ContractType;
    contracted_weekly_hours:  number;
    skill_ids?:               string[];
    license_ids?:             string[];
    assigned_role_ids?:       string[];
    contracts?:               import('../types').ContractRecordV2[];
    qualifications?:          import('../types').QualificationV2[];
}

export interface V8OrchestratorInput {
    employee_id:                 V8EmpId;
    employee_context:            V8EmployeeContext;
    existing_shifts:             V8OrchestratorShift[];
    candidate_changes:           V8CandidateChanges;
    mode:                        V8EvalMode;
    operation_type:              V8OperationType;
    stage?:                      V8Stage;
    evaluation_reference_date?:  string;
    config?:                     Partial<V8Config>;
    availability_data?:          V8AvailabilityData;
}

export interface V8ConsolidatedGroup {
    group_id:        string;
    summary:         string;
    status:          V8Status;
    hits:            V8Hit[];
    affected_shifts: V8ShiftId[];
}

export interface V8OrchestratorResult {
    passed:                boolean;
    overall_status:        V8Status;
    hits:                  V8Hit[];
    consolidated_groups:   V8ConsolidatedGroup[];
    conflict_pairs:        any[];
    delta_explanation:     any;
    evaluated_shift_count: number;
    evaluation_time_ms:    number;
}
