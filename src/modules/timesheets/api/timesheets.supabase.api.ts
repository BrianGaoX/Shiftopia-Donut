/**
 * Timesheets Supabase API
 * Fetches shift data with timesheet overlays from Supabase
 */

import { supabase } from '@/platform/supabase/client';
import { isShiftFinished } from '../ui/components/TimesheetTable.utils';


export interface TimesheetShiftRow {
    id: string;
    shiftId: string;
    timesheetId: string | null;

    // Employee info
    employeeId: string | null;
    employeeName: string;

    // Organizational hierarchy
    organizationId: string | null;
    organizationName: string;
    departmentId: string;
    departmentName: string;
    subDepartmentId: string;
    subDepartmentName: string;

    // Group info
    groupType: string | null;
    subGroupName: string | null;

    // Role & Remuneration
    roleId: string | null;
    roleName: string;
    remunerationLevelId: string | null;
    remunerationLevel: string;

    // Scheduled times
    shiftDate: string;
    scheduledStart: string;
    scheduledEnd: string;

    // Actual/Clock times (from timesheet if exists)
    clockIn: string | null;
    clockOut: string | null;

    // Adjusted times (manager edits)
    adjustedStart: string | null;
    adjustedEnd: string | null;
    adjustedStartSource: 'manual' | 'snapped' | null;
    adjustedEndSource: 'manual' | 'snapped' | null;
    isAdjustedManual: boolean;

    // Breaks
    paidBreakMinutes: number;
    unpaidBreakMinutes: number;
    paidBreak: string;
    unpaidBreak: string;

    // Calculated
    scheduledLengthMinutes: number;
    netLengthMinutes: number;

    // Status
    shiftStatus: string;
    lifecycleStatus: string;
    liveStatus: string;
    timesheetStatus: string | null;
    rawStartAt: string | null;
    rawEndAt: string | null;

    // Attendance (from shifts table)
    attendanceStatus: string | null;
    attendanceNote: string | null;
    // Minutes between actual times and scheduled times
    clockInVarianceMinutes: number | null;
    clockOutVarianceMinutes: number | null;
    varianceMinutes: number | null; // Legacy for clock-in

    // Pay
    hourlyRate: number | null;
    estimatedPay: number | null;

    // Manager notes (override reason on approve / rejection reason)
    notes: string | null;
    rejectedReason: string | null;
}

export interface TimesheetFilters {
    organizationId?: string | null;
    departmentId?: string | null;
    subDepartmentId?: string | null;
    searchQuery?: string;
    shiftStatus?: string | null;
    timesheetStatus?: string | null;
    roleId?: string | null;
    groupType?: string | null;
    subGroupName?: string | null;
}

/**
 * Fetch shifts for timesheet display
 */

/**
 * Snap an HH:MM or ISO datetime string to the nearest 15-minute boundary.
 * e.g. "09:07" → "09:00", "09:08" → "09:15", "09:52" → "09:45"
 * When given an ISO timestamp, the LOCAL wall-clock time is used (browser TZ).
 * Returns null if value is falsy or unparseable.
 */
export function snapToQuarterHour(value: string | null | undefined): string | null {
    if (!value) return null;

    let h: number;
    let m: number;

    if (value.includes('T') || (value.length > 8 && value.includes('-'))) {
        // ISO datetime → use Date for correct local-timezone extraction
        const d = new Date(value);
        if (isNaN(d.getTime())) return null;
        h = d.getHours();   // local hour
        m = d.getMinutes(); // local minute
    } else {
        // Plain HH:MM or HH:MM:SS string
        const parts = value.split(':').map(Number);
        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
        h = parts[0];
        m = parts[1];
    }

    const snapped = Math.round(m / 15) * 15;
    if (snapped === 60) {
        const nextH = (h + 1) % 24;
        return `${nextH.toString().padStart(2, '0')}:00`;
    }
    return `${h.toString().padStart(2, '0')}:${snapped.toString().padStart(2, '0')}`;
}

export async function getShiftsForTimesheet(
    startDate: string,
    filters: TimesheetFilters = {},
    endDate?: string
): Promise<TimesheetShiftRow[]> {
    try {
        // Query shifts without the employee join (no FK relationship)
        let query = supabase
            .from('shifts')
            .select(`
                id,
                shift_date,
                start_time,
                end_time,
                start_at,
                end_at,
                assignment_status,
                lifecycle_status,
                attendance_status,
                actual_start,
                actual_end,
                attendance_note,
                group_type,
                sub_group_name,
                roster_subgroup_id,
                paid_break_minutes,
                unpaid_break_minutes,
                net_length_minutes,
                scheduled_length_minutes,
                remuneration_rate,
                organization_id,
                department_id,
                sub_department_id,
                role_id,
                remuneration_level_id,
                assigned_employee_id,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name),
                remuneration_levels(id, level_name, hourly_rate_min),
                roster_subgroups!roster_subgroup_id(name, roster_groups(name))
            `)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate || startDate)
            .in('lifecycle_status', ['Published', 'InProgress', 'Completed'])
            .is('deleted_at', null)
            .order('start_time');

        // Apply filters
        if (filters.organizationId) {
            query = query.eq('organization_id', filters.organizationId);
        }
        if (filters.departmentId) {
            query = query.eq('department_id', filters.departmentId);
        }
        if (filters.subDepartmentId) {
            query = query.eq('sub_department_id', filters.subDepartmentId);
        }
        if (filters.shiftStatus) {
            query = query.eq('assignment_status', filters.shiftStatus as any);
        }
        if (filters.groupType) {
            query = query.eq('group_type', filters.groupType as any);
        }
        if (filters.roleId) {
            query = query.eq('role_id', filters.roleId);
        }

        const { data: shifts, error } = await query;

        if (error) {
            console.error('[getShiftsForTimesheet] Error:', error);
            return [];
        }

        if (!shifts || shifts.length === 0) {
            return [];
        }

        // Fetch employees separately (no FK relationship in schema)
        const employeeIds: string[] = Array.from(new Set(shifts.map(s => s.assigned_employee_id).filter((id): id is string => !!id)));
        let employeeMap = new Map<string, { first_name: string; last_name: string }>();

        if (employeeIds.length > 0) {
            const { data: profiles } = await supabase
                .from('profiles')
                .select('id, first_name, last_name')
                .in('id', employeeIds);

            if (profiles) {
                employeeMap = new Map(profiles.map(p => [p.id, {
                    first_name: p.first_name || '',
                    last_name: p.last_name || ''
                }]));
            }
        }

        // Fetch timesheets for these shifts
        const shiftIds: string[] = shifts.map(s => s.id);
        const { data: timesheets } = await supabase
            .from('timesheets')
            .select('*')
            .in('shift_id', shiftIds);

        const timesheetMap = new Map(
            (timesheets || []).map(t => [t.shift_id, t])
        );

        // Map to TimesheetShiftRow
        const rows: TimesheetShiftRow[] = shifts.map((shift: any) => {
            const timesheet = timesheetMap.get(shift.id);
            const employee = shift.assigned_employee_id ? employeeMap.get(shift.assigned_employee_id) : null;
            const org = shift.organizations;
            const dept = shift.departments;
            const subDept = shift.sub_departments;
            const role = shift.roles;
            const remLevel = shift.remuneration_levels;

            const employeeName = employee
                ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
                : 'Unassigned';

            const scheduledMins = shift.scheduled_length_minutes ||
                calculateMinutes(shift.start_time, shift.end_time);
            const netMins = shift.net_length_minutes ||
                (scheduledMins - (shift.unpaid_break_minutes || 0));

            const hourlyRate = remLevel?.hourly_rate_min || shift.remuneration_rate || 0;
            const calculatedNetMins = (() => {
                const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time);
                const startRaw = timesheet?.start_time || (finished ? snapToQuarterHour(shift.actual_start) : null);
                const endRaw = timesheet?.end_time || (finished ? snapToQuarterHour(shift.actual_end) : null);
                if (!startRaw || !endRaw || startRaw === 'NIL' || endRaw === 'NIL') return 0;
                
                try {
                    const [startH, startM] = startRaw.split(':').map(Number);
                    const [endH, endM] = endRaw.split(':').map(Number);
                    
                    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return 0;
                    
                    let diffMins = (endH * 60 + endM) - (startH * 60 + startM);
                    if (diffMins < 0) diffMins += 24 * 60; // Overnight
                    
                    const unpaidBreak = timesheet?.unpaid_break_minutes !== undefined ? timesheet.unpaid_break_minutes : (shift.unpaid_break_minutes || 0);
                    return Math.max(0, diffMins - unpaidBreak);
                } catch {
                    return 0;
                }
            })();

            const currentEstimatedPay = (calculatedNetMins / 60) * hourlyRate;

            return {
                id: shift.id,
                shiftId: shift.id,
                timesheetId: timesheet?.id || null,

                employeeId: shift.assigned_employee_id,
                employeeName,

                organizationId: shift.organization_id,
                organizationName: org?.name || '',
                departmentId: shift.department_id,
                departmentName: dept?.name || '',
                subDepartmentId: shift.sub_department_id,
                subDepartmentName: subDept?.name || '',

                // Prefer normalized roster_subgroups join; fall back to legacy columns
                groupType: shift.roster_subgroups?.roster_groups?.name ?? shift.group_type ?? null,
                subGroupName: shift.roster_subgroups?.name ?? shift.sub_group_name ?? null,

                roleId: shift.role_id,
                roleName: role?.name || '',
                remunerationLevelId: shift.remuneration_level_id,
                remunerationLevel: remLevel?.level_name || '',

                shiftDate: shift.shift_date,
                scheduledStart: shift.start_time,
                scheduledEnd: shift.end_time,

                // Actual/Clock times
                // Source of truth: ALWAYS shift.actual_start / actual_end (raw data)
                // We deliberately do NOT fall back to timesheet adjustments here, as 
                // the "Actual" column must preserve the true history record.
                clockIn: shift.actual_start ?? null,
                clockOut: shift.actual_end ?? null,

                // Adjusted times (billable) — two-tier logic:
                //   1. Explicit manager edit  → timesheet.start_time / end_time  (isAdjustedManual = true)
                //   2. Snapped actual clock   → snap actual_start AFTER scheduled end (isAdjustedManual = false)
                adjustedStart: (() => {
                    if (timesheet?.start_time) return timesheet.start_time;
                    const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time, shift.actual_end);
                    return finished ? snapToQuarterHour(shift.actual_start) : null;
                })(),
                adjustedEnd: (() => {
                    if (timesheet?.end_time) return timesheet.end_time;
                    const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time, shift.actual_end);
                    return finished ? snapToQuarterHour(shift.actual_end) : null;
                })(),
                // Whether the manager has explicitly saved a custom adjusted time
                adjustedStartSource: (() => {
                    if (timesheet?.start_time) return 'manual';
                    const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time, shift.actual_end);
                    if (finished && shift.actual_start) return 'snapped';
                    return null;
                })(),
                adjustedEndSource: (() => {
                    if (timesheet?.end_time) return 'manual';
                    const finished = isShiftFinished(shift.shift_date, shift.start_time, shift.end_time);
                    if (finished && shift.actual_end) return 'snapped';
                    return null;
                })(),
                isAdjustedManual: !!(timesheet?.start_time || timesheet?.end_time),

                paidBreakMinutes: timesheet?.paid_break_minutes !== undefined ? timesheet.paid_break_minutes : (shift.paid_break_minutes || 0),
                unpaidBreakMinutes: timesheet?.unpaid_break_minutes !== undefined ? timesheet.unpaid_break_minutes : (shift.unpaid_break_minutes || 0),
                paidBreak: String(timesheet?.paid_break_minutes !== undefined ? timesheet.paid_break_minutes : (shift.paid_break_minutes || 0)),
                unpaidBreak: String(timesheet?.unpaid_break_minutes !== undefined ? timesheet.unpaid_break_minutes : (shift.unpaid_break_minutes || 0)),
                scheduledLengthMinutes: scheduledMins,
                netLengthMinutes: calculatedNetMins,

                shiftStatus: shift.assignment_status || 'open',
                lifecycleStatus: shift.lifecycle_status || 'scheduled',
                liveStatus: shift.lifecycle_status || 'Scheduled',
                timesheetStatus: timesheet?.status || null,
                rawStartAt: shift.start_at || null,
                rawEndAt: shift.end_at || null,

                attendanceStatus: shift.attendance_status || null,
                attendanceNote: shift.attendance_note || null,
                clockInVarianceMinutes: (() => {
                    if (!shift.actual_start) return null;
                    const scheduledMs = new Date(
                        shift.start_at || `${shift.shift_date}T${shift.start_time}`
                    ).getTime();
                    return Math.round((new Date(shift.actual_start).getTime() - scheduledMs) / 60000);
                })(),
                clockOutVarianceMinutes: (() => {
                    if (!shift.actual_end) return null;
                    const scheduledMs = new Date(
                        shift.end_at || `${shift.shift_date}T${shift.end_time}`
                    ).getTime();
                    return Math.round((new Date(shift.actual_end).getTime() - scheduledMs) / 60000);
                })(),
                varianceMinutes: (() => {
                    if (!shift.actual_start) return null;
                    const scheduledMs = new Date(
                        shift.start_at || `${shift.shift_date}T${shift.start_time}`
                    ).getTime();
                    return Math.round((new Date(shift.actual_start).getTime() - scheduledMs) / 60000);
                })(),

                hourlyRate,
                estimatedPay: Math.round(currentEstimatedPay * 100) / 100,

                notes: timesheet?.notes || null,
                rejectedReason: timesheet?.rejected_reason || null,
            };
        });

        // Apply search filter client-side (searches name, role, department, sub-group)
        if (filters.searchQuery) {
            const q = filters.searchQuery.toLowerCase();
            return rows.filter(row =>
                row.employeeName.toLowerCase().includes(q) ||
                row.roleName.toLowerCase().includes(q) ||
                row.departmentName.toLowerCase().includes(q) ||
                (row.subGroupName ?? '').toLowerCase().includes(q) ||
                (row.groupType ?? '').toLowerCase().includes(q)
            );
        }

        return rows;
    } catch (error) {
        console.error('[getShiftsForTimesheet] Exception:', error);
        return [];
    }
}

/**
 * Calculate minutes between two HH:MM:SS time strings
 */
function calculateMinutes(start: string, end: string): number {
    if (!start || !end) return 0;

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);

    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;

    // Handle overnight
    if (endMins < startMins) {
        endMins += 24 * 60;
    }

    return endMins - startMins;
}

/** Returns true if value looks like an ISO datetime string (not a plain HH:MM time) */
function isIsoTimestamp(value: string): boolean {
    return value.includes('T') || value.includes(' ') || /^\d{4}-/.test(value);
}

/**
 * Update timesheet entry
 */
export async function updateTimesheetEntry(
    shiftId: string,
    updates: {
        clockIn?: string;
        clockOut?: string;
        adjustedStart?: string;
        adjustedEnd?: string;
        status?: string;
        notes?: string;
        rejectedReason?: string;
        length?: string;
        netLength?: string;
        approximatePay?: string;
        paidBreak?: string;
        unpaidBreak?: string;
    }
): Promise<boolean> {
    try {
        // 1. Check if timesheet exists
        const { data: existing } = await supabase
            .from('timesheets')
            .select('id, status')
            .eq('shift_id', shiftId)
            .maybeSingle();

        // 2. Safety Guard: If it's already Approved, Rejected, or No-Show
        // Block updates to finalized records, UNLESS manager is editing metrics.
        let currentStatus = (existing?.status || '').toLowerCase();
        
        // If no timesheet record yet, check the shift record for attendance_status
        if (!currentStatus) {
            const { data: shift } = await supabase
                .from('shifts')
                .select('attendance_status')
                .eq('id', shiftId)
                .single();
            if (shift?.attendance_status === 'no_show') {
                currentStatus = 'no_show';
            }
        }

        const isEditingMetrics = 
            updates.adjustedStart !== undefined || 
            updates.adjustedEnd !== undefined || 
            updates.paidBreak !== undefined || 
            updates.unpaidBreak !== undefined;

        if (['approved', 'rejected', 'no_show'].includes(currentStatus)) {
            if (!isEditingMetrics) {
                // Allow idempotency if the only change is setting the SAME status
                const isStatusOnly = Object.keys(updates).length === 1 && updates.status;
                if (isStatusOnly && updates.status?.toLowerCase() === currentStatus) return true;
                
                console.warn(`[updateTimesheetEntry] Blocking update for finalized shift ${shiftId} (Current: ${currentStatus})`);
                return true; 
            }
        }

        // If transitioning from a no_show state by editing metrics, clear the shift no_show status
        if (isEditingMetrics && currentStatus === 'no_show') {
            const { error: shiftUpdateErr } = await supabase
                .from('shifts')
                .update({
                    attendance_status: null,
                    attendance_note: 'No-Show overridden by manager',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', shiftId);

            if (shiftUpdateErr) {
                console.error('[updateTimesheetEntry] Shift attendance status clearance error:', shiftUpdateErr);
            }
        }

        // 3. Build payload
        const payload: any = {
            updated_at: new Date().toISOString()
        };

        // clock_in/clock_out are timestamptz — only set if value is a proper ISO timestamp
        if (updates.clockIn !== undefined && updates.clockIn && isIsoTimestamp(updates.clockIn)) {
            payload.clock_in = updates.clockIn;
        }
        if (updates.clockOut !== undefined && updates.clockOut && isIsoTimestamp(updates.clockOut)) {
            payload.clock_out = updates.clockOut;
        }

        const validTime = (val: string | undefined): string | null | undefined => {
            if (val === undefined) return undefined;
            if (!val || val === '-' || val === 'NIL' || val.trim() === '') return null;
            if (/^\d{1,2}:\d{2}$/.test(val)) return `${val.padStart(5, '0')}:00`;
            return val;
        };

        const adjStart = validTime(updates.adjustedStart);
        if (adjStart !== undefined) payload.start_time = adjStart;
        
        const adjEnd = validTime(updates.adjustedEnd);
        if (adjEnd !== undefined) payload.end_time = adjEnd;

        // Reset status to submitted if editing metrics on a finalized timesheet
        if (isEditingMetrics && ['approved', 'rejected', 'no_show'].includes(currentStatus)) {
            payload.status = (updates.status || 'submitted').toLowerCase();
        } else if (updates.status !== undefined) {
            payload.status = updates.status.toLowerCase();
        }

        if (updates.notes !== undefined) payload.notes = updates.notes;
        if (updates.rejectedReason !== undefined) payload.rejected_reason = updates.rejectedReason;
        
        // Breaks (minutes)
        if (updates.paidBreak !== undefined) payload.paid_break_minutes = parseInt(updates.paidBreak, 10) || 0;
        if (updates.unpaidBreak !== undefined) payload.unpaid_break_minutes = parseInt(updates.unpaidBreak, 10) || 0;
        
        // NEW: Support for direct metric overrides (e.g. from No-Show marking)
        if (updates.length !== undefined) payload.length = updates.length;
        if (updates.netLength !== undefined) payload.net_length = updates.netLength;
        if (updates.approximatePay !== undefined) payload.approximate_pay = updates.approximatePay;

        if (existing) {
            // Update existing
            const { error } = await supabase
                .from('timesheets')
                .update(payload)
                .eq('id', existing.id);

            if (error) throw error;
        } else {
            // Get shift details for new timesheet
            const { data: shift } = await supabase
                .from('shifts')
                .select('assigned_employee_id, shift_date, start_time, end_time, start_at, end_at, actual_start, actual_end')
                .eq('id', shiftId)
                .single();

            if (!shift) throw new Error('Shift not found');
            if (!shift.assigned_employee_id) throw new Error('Cannot create timesheet for unassigned shift');

            const clockInTs: string = updates.clockIn
                ? (isIsoTimestamp(updates.clockIn) ? updates.clockIn : `${shift.shift_date}T${shift.start_time}`)
                : (shift.actual_start ?? shift.start_at ?? `${shift.shift_date}T${shift.start_time}`);

            const clockOutTs: string | null = updates.clockOut
                ? (isIsoTimestamp(updates.clockOut) ? updates.clockOut : null)
                : (shift.actual_end ?? shift.end_at ?? null);

            const { error: insertError } = await supabase
                .from('timesheets')
                .insert({
                    shift_id: shiftId,
                    employee_id: shift.assigned_employee_id,
                    profile_id: shift.assigned_employee_id,
                    work_date: shift.shift_date,
                    clock_in: clockInTs,
                    ...(clockOutTs ? { clock_out: clockOutTs } : {}),
                    status: (updates.status || 'draft').toLowerCase(),
                    ...payload,
                });
            if (insertError) throw insertError;
        }

        // Cleanup: If approved, mark shift as Completed
        if (updates.status === 'approved') {
            const { data: shiftData } = await supabase
                .from('shifts')
                .select('lifecycle_status')
                .eq('id', shiftId)
                .single();

            if (shiftData && !['Completed', 'Cancelled', 'Draft'].includes(shiftData.lifecycle_status)) {
                await supabase
                    .from('shifts')
                    .update({ lifecycle_status: 'Completed', updated_at: new Date().toISOString() })
                    .eq('id', shiftId);
            }
        }

        return true;
    } catch (error) {
        console.error('[updateTimesheetEntry] Error:', error);
        return false;
    }
}

/**
 * Bulk approve timesheets
 */
export async function bulkUpdateTimesheetStatus(
    ids: string[],
    userId: string,
    status: 'approved' | 'rejected'
): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const shiftId of ids) {
        const result = await updateTimesheetEntry(shiftId, { 
            status,
            notes: `Bulk ${status} by manager`
        });

        if (result) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

/**
 * Mark a shift as No-Show
 */
export async function markShiftAsNoShow(
    shiftId: string,
    userId: string
): Promise<boolean> {
    try {
        // Update shift status
        const { error: shiftError } = await supabase
            .from('shifts')
            .update({
                attendance_status: 'no_show',
                lifecycle_status: 'Completed',
                updated_at: new Date().toISOString(),
                last_modified_by: userId
            })
            .eq('id', shiftId);

        if (shiftError) {
            console.error('[markShiftAsNoShow] Shift error:', shiftError);
            return false;
        }

        // NEW: Ensure a timesheet entry exists with status 'no_show' AND zero hours/pay
        await updateTimesheetEntry(shiftId, { 
            status: 'no_show',
            length: '0.00',
            netLength: '0.00',
            approximatePay: '$0.00',
            notes: 'Marked as No-Show by manager'
        });

        return true;
    } catch (error) {
        console.error('[markShiftAsNoShow] Error:', error);
        return false;
    }
}
