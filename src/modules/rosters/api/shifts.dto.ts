import { TemplateGroupType } from '../domain/shift.entity';

export interface CreateShiftData {
    roster_id: string;
    department_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    organization_id?: string | null;
    sub_department_id?: string | null;
    group_type?: TemplateGroupType | null;
    sub_group_name?: string | null;
    display_order?: number;
    shift_group_id?: string | null;
    shift_subgroup_id?: string | null;
    role_id?: string | null;
    remuneration_level_id?: string | null;
    paid_break_minutes?: number;
    unpaid_break_minutes?: number;
    timezone?: string;
    start_at?: string | null;
    end_at?: string | null;
    assigned_employee_id?: string | null;
    required_skills?: string[];
    required_licenses?: string[];
    event_ids?: string[];
    tags?: string[];
    notes?: string | null;
    template_id?: string | null;
    template_group?: TemplateGroupType | null;
    template_sub_group?: string | null;
    is_from_template?: boolean;
    template_instance_id?: string | null;
    /** How the shift was created: 'manual' | 'template' | 'autoscheduler' */
    creation_source?: string;
    /** How the employee was assigned: 'direct' | 'manual' | 'autoscheduler' | 'dnd' */
    assignment_source?: string | null;
    assignment_outcome?: 'confirmed' | 'no_show' | 'emergency_assigned' | 'pending' | null;
    is_training?: boolean;
    synthesis_run_id?: string | null;
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: 'FT' | 'PT' | 'Casual' | null;
    demand_group_id?: string | null;
}

export interface UpdateShiftData extends Partial<CreateShiftData> {
    cancellation_reason?: string | null;
    /** Current version read from the shift — enables optimistic concurrency.
     *  If provided and the DB version has moved on, the server returns a
     *  VERSION_CONFLICT error (SQLSTATE 40001 → AppError code 'CONFLICT').
     *  Omit (undefined) to skip the check for non-critical updates. */
    expectedVersion?: number;
}
