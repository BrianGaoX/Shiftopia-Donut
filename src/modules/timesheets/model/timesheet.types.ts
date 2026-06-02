/**
 * Timesheet Status State Machine
 * 
 * Flow:
 * DRAFT -> SUBMITTED
 * SUBMITTED -> APPROVED | REJECTED
 * REJECTED -> DRAFT
 * APPROVED -> LOCKED
 */
export type TimesheetStatus =
    | "DRAFT"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED"
    | "LOCKED"

/**
 * Core Timesheet Interface
 * Immutability and versioning are key for payroll safety.
 */
export interface Timesheet {
    id: string | number // Legacy uses number, new uses string
    employeeId: string
    periodStart: string // ISO Date
    periodEnd: string   // ISO Date
    status: TimesheetStatus | string // Legacy uses string
    totalHours: number
    totalPay?: number // From legacy
    rosterId?: number | string // From legacy
    groups?: any[] // From legacy
    version: number
    createdAt: string
    updatedAt: string
}

/**
 * Legacy TimesheetRow / UI Entry
 */
export interface TimesheetRow {
    id: string | number;
    // Update IDs
    groupId?: string | number;
    subGroupId?: string | number;

    date: Date | string;
    // Employee Info
    employeeId: string;
    employee: string;
    // Hierarchy 1
    organization: string;
    department: string;
    subDepartment: string;
    // Hierarchy 2
    group: string;
    subGroup: string;
    role: string;
    remunerationLevel: string;
    // Scheduled
    scheduledStart: string;
    scheduledEnd: string;
    // Geofenced
    clockIn: string;
    clockOut: string;
    // Adjusted (editable)
    adjustedStart: string;
    adjustedEnd: string;
    /**
     * true  → manager has explicitly saved a custom time (stored in timesheets.start_time)
     * false → auto-snapped from Actual (or fell back to Scheduled). Display dimmed.
     */
    isAdjustedManual: boolean;
    adjustedStartSource?: 'manual' | 'snapped' | null;
    adjustedEndSource?: 'manual' | 'snapped' | null;
    length: string; // Auto-calculated
    paidBreak: string;
    unpaidBreak: string;
    netLength: string; // Auto-calculated
    // Payroll
    approximatePay: string;
    // Differential
    differential: string; // Scheduled vs Adjusted (financial) difference
    // Statuses
    liveStatus: 'Completed' | 'Cancelled' | 'Active' | 'No-Show' | 'Swapped' | string;
    timesheetStatus: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | string;
    // Attendance (from shifts.attendance_status)
    attendanceStatus?: string | null;
    attendanceNote?: string | null;
    varianceMinutes?: number | null;
    clockInVarianceMinutes?: number | null;
    clockOutVarianceMinutes?: number | null;
    // Minutes delta: adjusted_start vs actual_start (positive = adjusted later than actual)
    adjustedVarianceMinutes?: number | null;
    // Manager notes
    notes?: string | null;
    rejectedReason?: string | null;
    // Status Dot (Badge)
    statusDot?: { color: string; label: string } | null;
    // Raw fields for internal UI logic (indicators)
    rawActualStart?: string | null;
    rawActualEnd?: string | null;
    rawStartAt?: string | null;
    rawEndAt?: string | null;
    groupType?: 'convention_centre' | 'exhibition_centre' | 'theatre' | string | null;
}

/**
 * Individual entry within a timesheet (Domain Model)
 */
export interface TimesheetEntry {
    id: string
    timesheetId: string
    date: string
    startTime: string
    endTime: string
    breakMinutes: number
    totalHours: number
    description?: string
    isOvertime: boolean
}

/**
 * Extended Timesheet with entries
 */
export interface TimesheetWithEntries extends Timesheet {
    entries: TimesheetEntry[]
}
