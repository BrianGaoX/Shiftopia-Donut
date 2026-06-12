/* ============================================================
   ENUMS & TYPES - Must match database
   ============================================================ */

export type ShiftStatus =
    | 'open'
    | 'assigned'
    | 'confirmed'
    | 'completed'
    | 'cancelled';

export type AttendanceStatus = 'unknown' | 'checked_in' | 'no_show' | 'late' | 'excused' | 'auto_clock_out';

export type TemplateGroupType = 'convention_centre' | 'exhibition_centre' | 'theatre' | 'the_cutaway';

export type AssignmentStatusText =
    | 'unassigned'
    | 'assigned'
    | 'pending'
    | 'declined';
export type AssignmentMethodText =
    | 'manual'
    | 'template'
    | 'bid'
    | 'trade'
    | 'auto';
export type CancellationTypeText = 'standard' | 'late' | 'critical' | 'no_show';
export type BiddingPriorityText = 'normal' | 'urgent' | 'critical';
export type ComplianceStatusText =
    | 'compliant'
    | 'warning'
    | 'violation'
    | 'pending'
    | 'overridden';
export type LockReasonText = 'published' | 'timesheet' | 'admin' | 'payroll';

/* ============================================================
   INTERFACES
   ============================================================ */

export interface Shift {
    id: string;
    organization_id: string | null;
    department_id: string;
    sub_department_id: string | null;
    created_by_user_id: string | null;
    created_at: string;
    updated_at: string;
    version: number;
    roster_id: string;
    roster_date: string;
    shift_date: string;
    template_id: string | null;
    template_group: TemplateGroupType | null;
    template_sub_group: string | null;
    is_from_template: boolean;
    template_instance_id: string | null;
    group_type: TemplateGroupType | null;
    sub_group_name: string | null;
    display_order: number;
    shift_group_id: string | null;
    shift_subgroup_id: string | null;
    role_id: string | null;
    role_level: number | null;
    remuneration_level_id: string | null;
    remuneration_rate: number | null;
    actual_hourly_rate: number | null;
    currency: string;
    cost_center_id: string | null;
    start_time: string;
    end_time: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
    is_overnight: boolean;
    scheduled_length_minutes: number | null;
    break_minutes: number;
    paid_break_minutes: number;
    unpaid_break_minutes: number;
    net_length_minutes: number | null;
    total_hours: number | null;
    timezone: string;

    // New UTC-at-Rest fields
    start_at?: string | null;
    end_at?: string | null;
    tz_identifier?: string | null;

    assigned_employee_id: string | null;
    assignment_id: string | null;

    assigned_at: string | null;

    lifecycle_status: 'Draft' | 'Published' | 'InProgress' | 'Completed' | 'Cancelled';
    assignment_status?: AssignmentStatusText; // Made optional as sometimes missing from simple queries
    assignment_outcome?: 'confirmed' | 'no_show' | 'emergency_assigned' | 'pending' | null;
    emergency_source?: 'manual' | 'auto' | null;
    fulfillment_status: 'scheduled' | 'bidding' | 'offered' | 'none';
    is_draft: boolean;
    is_cancelled: boolean;
    is_on_bidding: boolean;
    cancelled_at: string | null;
    cancelled_by_user_id: string | null;
    cancellation_reason: string | null;

    offer_expires_at?: string | null; // Made optional as not in all views
    bidding_status: 'not_on_bidding' | 'on_bidding' | 'on_bidding_normal' | 'on_bidding_urgent' | 'bidding_closed_no_winner';
    bidding_priority_text: string;

    trade_requested_at: string | null;
    is_trade_requested?: boolean;
    trading_status?: 'NoTrade' | 'TradeRequested' | 'TradeAccepted';

    // Attendance
    attendance_status?: AttendanceStatus;
    required_skills: string[];
    required_licenses: string[];
    eligibility_snapshot: Record<string, any> | null;
    event_ids: string[];
    tags: string[];

    compliance_snapshot: Record<string, any> | null;
    compliance_checked_at: string | null;
    compliance_override: boolean;
    compliance_override_reason: string | null;
    is_published: boolean;
    published_at: string | null;
    published_by_user_id: string | null;
    is_locked: boolean;
    lock_reason_text: string | null;
    timesheet_id: string | null;
    actual_start: string | null;
    actual_end: string | null;
    actual_net_minutes: number | null;
    attendance_note: string | null;
    payroll_exported: boolean;
    last_modified_by: string | null;
    last_modified_reason: string | null;
    deleted_at: string | null;
    deleted_by: string | null;
    notes: string | null;
    is_training: boolean;
    // Joined Timesheet Data
    timesheet_status?: string | null;
    timesheet_notes?: string | null;
    timesheet_rejected_reason?: string | null;
    timesheet_start_time?: string | null;
    timesheet_end_time?: string | null;
    /**
     * Billable (adjusted) clock times, mirrored from the joined timesheet so
     * Live Rules derive identically on roster and timesheet surfaces.
     * Present ONLY when a manager manually committed an override (the timesheet
     * stores nothing here for auto/snapped billable times).
     */
    adjusted_start?: string | null;
    adjusted_end?: string | null;
    /** True when the billable times above were manually set by a manager. */
    adjusted_is_manual?: boolean;
    
    is_recurring: boolean;
    recurrence_rule: string | null;
    confirmed_at: string | null;
    organizations?: { id: string; name: string } | null;
    departments?: { id: string; name: string } | null;
    sub_departments?: { id: string; name: string } | null;
    roles?: { id: string; name: string } | null;
    remuneration_levels?: {
        id: string;
        level_number: number;
        level_name: string;
        hourly_rate_min: number;
        hourly_rate_max?: number;
    } | null;
    assigned_profiles?: {
        first_name: string;
        last_name: string;
    } | null;
    roster_subgroup?: {
        name: string;
        roster_group?: {
            name: string;
            external_id: string | null;
        } | null;
    } | null;

    // Labor Forecasting Metadata
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: 'FT' | 'PT' | 'Casual' | 'Unassigned' | null;
    demand_group_id?: string | null;

    // Allowances
    allowances?: {
        meal?: boolean;
        firstAid?: boolean;
        proteinSpill?: boolean;
        splitShift?: boolean;
    };

    // Leave Entitlements
    isAnnualLeave?: boolean;
    isPersonalLeave?: boolean;
    isCarerLeave?: boolean;

    // Apprentice Information
    apprenticeInfo?: {
        year: number;
        completedYear12: boolean;
        isAdultApprentice: boolean;
    }

    previousWage?: number
}

/* ============================================================
   HELPERS - FIXED UUID VALIDATION
   ============================================================ */

/**
 * Check if value is a valid UUID (accepts all standard UUID formats)
 * This regex accepts:
 * - Standard UUIDs (v1-v5)
 * - Nil UUIDs (00000000-0000-0000-0000-000000000000)
 * - Custom UUIDs with any hex characters
 */
export const isValidUuid = (value: string | null | undefined): boolean => {
    if (!value || typeof value !== 'string') return false;
    // More permissive UUID regex - accepts any 8-4-4-4-12 hex pattern
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
    );
};

/** Safe UUID - returns null for invalid/mock UUIDs */
export const safeUuid = (value?: string | null): string | null => {
    if (!value || value.trim() === '') return null;
    if (!isValidUuid(value)) {
        console.warn(`Invalid UUID detected: "${value}", returning null`);
        return null;
    }
    return value;
};

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

export function calculateMinutesBetweenTimes(
    startTime: string,
    endTime: string
): number {
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    let startMinutes = startHour * 60 + startMin;
    let endMinutes = endHour * 60 + endMin;

    if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
    }

    return endMinutes - startMinutes;
}

/**
 * A shift truly crosses midnight if it has duration in the day AFTER its start day.
 * 
 * Logic:
 * 1. If explicitly marked as `is_overnight`, it's overnight.
 * 2. If `end_time < start_time` (chronologically), it's overnight UNLESS the
 *    end time is exactly midnight (00:00:00), as that has zero duration in the next day.
 */
export function doesShiftTrulyCrossMidnight(shift: {
    start_time: string;
    end_time: string;
    is_overnight?: boolean;
}): boolean {
    if (shift.is_overnight) return true;

    // Use minutes for robust comparison regardless of string formatting/padding
    const [startH, startM] = (shift.start_time || '00:00').split(':').map(Number);
    const [endH, endM] = (shift.end_time || '00:00').split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // If it ends exactly at midnight (0), it doesn't "cross" into the next day with duration
    if (endMinutes === 0 && startMinutes > 0) return false;

    return endMinutes < startMinutes;
}

