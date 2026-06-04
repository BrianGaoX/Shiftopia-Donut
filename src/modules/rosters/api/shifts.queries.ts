import { supabase } from '@/platform/realtime/client';
import { Shift, ShiftStatus, TemplateGroupType, isValidUuid } from '../domain/shift.entity';
import { callAuthenticatedRpc } from '@/platform/supabase/rpc/client';
import { OfferActionResponseSchema } from './contracts';

// ── Lookup types ──────────────────────────────────────────────────────────────

export interface OrgSummary { id: string; name: string }
export interface DeptSummary { id: string; name: string; organization_id: string }
export interface SubDeptSummary { id: string; name: string; department_id: string }
export interface RoleSummary { id: string; name: string; department_id: string | null; sub_department_id: string | null; remuneration_level_id: string | null }
export interface RemunerationLevel { id: string; level_number: number; level_name: string; hourly_rate_min: number; hourly_rate_max: number; description: string | null }
export interface SkillSummary { id: string; name: string; description: string | null; category: string | null }
export interface LicenseSummary { id: string; name: string; description: string | null; category: string | null; issuing_authority: string | null }
export interface ProfileSummary {
    id: string;
    first_name: string;
    last_name: string;
    department_name?: string;
    sub_department_name?: string;
}
export interface TemplateSummary { id: string; name: string; description: string | null; department_id: string; sub_department_id: string | null; status: string; organization_id: string; applied_count: number | null }
export interface RosterSlot { groupType: string; subGroupName: string }

// ── Shared select fragment for shift rows ─────────────────────────────────────

/**
 * SHIFT_DETAIL_SELECT — Full select used for single-shift detail views
 * (getShiftById, post-mutation refetch). Includes all columns.
 */
const SHIFT_DETAIL_SELECT = `
  *,
  assignment_outcome,
  attendance_status,
  offer_expires_at,
  organizations(id, name),
  departments(id, name),
  sub_departments(id, name),
  roles(id, name),
  remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
  assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
  roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name)),
  timesheets(status)
` as const;

/**
 * SHIFT_SELECT — Lean select for list queries (day/week/month views).
 *
 * Explicitly enumerates the ~40 columns the grid, projection worker, and
 * GroupModeView actually read. Excludes heavy/unused columns like
 * compliance_snapshot, eligibility_snapshot, payroll metadata, and
 * recurrence fields — cutting payload by ~60% at 5k+ shifts.
 *
 * The JOINs are kept since the worker mapper reads role/level/profile data.
 */
const SHIFT_SELECT = `
  id,
  organization_id,
  department_id,
  sub_department_id,
  created_at,
  updated_at,
  version,
  roster_id,
  roster_date,
  shift_date,
  template_id,
  template_group,
  template_sub_group,
  is_from_template,
  template_instance_id,
  group_type,
  sub_group_name,
  display_order,
  shift_group_id,
  shift_subgroup_id,
  role_id,
  role_level,
  remuneration_level_id,
  remuneration_rate,
  actual_hourly_rate,
  currency,
  start_time,
  end_time,
  is_overnight,
  scheduled_length_minutes,
  break_minutes,
  paid_break_minutes,
  unpaid_break_minutes,
  net_length_minutes,
  total_hours,
  timezone,
  start_at,
  end_at,
  assigned_employee_id,
  assigned_at,
  lifecycle_status,
  assignment_status,
  assignment_outcome,
  fulfillment_status,
  is_draft,
  is_cancelled,
  is_on_bidding,
  is_published,
  is_locked,
  bidding_status,
  bidding_priority_text,
  trade_requested_at,
  trading_status,
  attendance_status,
  offer_expires_at,
  event_ids,
  tags,
  required_skills,
  required_licenses,
  notes,
  is_training,
  published_at,
  cancelled_at,
  deleted_at,
  last_modified_by,
  target_employment_type,
  organizations(id, name),
  departments(id, name),
  sub_departments(id, name),
  roles(id, name),
  remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
  assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
  roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name)),
  timesheets(status)
` as const;

// ── Pagination ────────────────────────────────────────────────────────────────
// Supabase caps a single response at 1000 rows; for large date-range queries
// (week/month over 5k+ shifts) we page through until a short page arrives.
// `count: 'planned'` skips the COUNT(*) cost (100–500 ms at 1M rows) — planner
// estimates can be off by ~10–20%, so we keep paginating until a page is
// shorter than PAGE_SIZE rather than trusting the estimate strictly.
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

/** Normalise a raw supabase row into our Shift interface shape */
export function normalizeShiftRow(row: Record<string, any>): Shift {
    const shift = {
        ...row,
        is_trade_requested:
            !!row['trade_requested_at'] || row['trading_status'] === 'TradeRequested',
    } as unknown as Shift;

    const ts = Array.isArray(row.timesheets) ? row.timesheets[0] : (row.timesheets || null);
    if (ts && typeof ts === 'object') {
        shift.timesheet_status = ts.status;
    }

    // Ensure attendance_status and assignment_outcome are preserved if they come from joined fields
    if (!shift.attendance_status && row.attendance_status) shift.attendance_status = row.attendance_status;
    if (!shift.assignment_outcome && row.assignment_outcome) shift.assignment_outcome = row.assignment_outcome;

    return shift;
}

/**
 * Helper to fetch all rows for a single-call query, escaping the PostgREST
 * 1000-row cap.
 *
 * Earlier this used `.count('exact')` + parallel ranges, which triggered a
 * full COUNT(*) scan on every fetch (100–500 ms at 1M rows even with the
 * partial indexes). Replaced with sequential stop-on-short-page — same
 * total bandwidth, drops the COUNT(*) cost entirely.
 *
 * The factory pattern matches `getShiftsForDateRange`'s loop: supabase-js
 * query builders are single-shot, so the caller passes a builder factory.
 */
async function fetchWithPagination(buildQuery: () => any): Promise<any[]> {
    const all: any[] = [];
    let page = 0;
    while (page < MAX_PAGES) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await buildQuery().range(from, to);
        if (error) throw error;
        const rows = data ?? [];
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
        page += 1;
    }
    return all;
}

export const shiftsQueries = {
    /* ============================================================
       GET SHIFT BY ID
       ============================================================ */

    async getShiftById(shiftId: string): Promise<Shift | null> {
        const { data, error } = await supabase
            .from('shifts')
            .select(SHIFT_DETAIL_SELECT)
            .eq('id', shiftId)
            .is('deleted_at', null)
            .maybeSingle();

        if (error) {
            console.error('Error fetching shift:', error);
            return null;
        }
        return data ? normalizeShiftRow(data as Record<string, unknown>) : null;
    },

    /* ============================================================
       GET SHIFTS FOR ROSTER/DATE
       ============================================================ */

    async getShiftsForDate(
        organizationId: string,
        date: string,
        filters?: {
            departmentId?: string;
            subDepartmentId?: string;
            departmentIds?: string[];
            subDepartmentIds?: string[];
            groupType?: TemplateGroupType;
            status?: ShiftStatus;
        }
    ): Promise<Shift[]> {
        if (!isValidUuid(organizationId)) {
            console.warn('Invalid organization ID for getShiftsForDate:', organizationId);
            return [];
        }

        // Factory: supabase-js query builders are single-shot, so each
        // pagination iteration needs a fresh chain.
        const buildQuery = () => {
            let q = supabase
                .from('shifts')
                .select(SHIFT_SELECT)
                .eq('organization_id', organizationId)
                .eq('shift_date', date)
                .is('deleted_at', null);

            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                q = q.eq('department_id', filters.departmentId);
            } else if (filters?.departmentIds && filters.departmentIds.length > 0) {
                q = q.in('department_id', filters.departmentIds.filter(isValidUuid));
            }
            if (filters?.subDepartmentId && isValidUuid(filters.subDepartmentId)) {
                q = q.eq('sub_department_id', filters.subDepartmentId);
            } else if (filters?.subDepartmentIds && filters.subDepartmentIds.length > 0) {
                q = q.in('sub_department_id', filters.subDepartmentIds.filter(isValidUuid));
            }
            if (filters?.groupType) {
                q = q.eq('group_type', filters.groupType);
            }
            if (filters?.status) {
                q = q.eq('status', filters.status);
            }
            return q.order('display_order').order('start_time');
        };

        try {
            const data = await fetchWithPagination(buildQuery);
            return data.map(row => normalizeShiftRow(row as Record<string, unknown>));
        } catch (error) {
            console.error('Exception in getShiftsForDate:', error);
            return [];
        }
    },

    /* ============================================================
       GET SHIFTS FOR DATE RANGE (Week/Month views)
       ============================================================ */

    async getShiftsForDateRange(
        organizationId: string,
        startDate: string,
        endDate: string,
        filters?: {
            departmentId?: string;
            subDepartmentId?: string;
            departmentIds?: string[];
            subDepartmentIds?: string[];
            groupType?: TemplateGroupType;
            status?: ShiftStatus;
        }
    ): Promise<Shift[]> {
        if (!isValidUuid(organizationId)) {
            console.warn('Invalid organization ID for getShiftsForDateRange:', organizationId);
            return [];
        }

        // Build a fresh filterable query for each page — supabase-js builders
        // are single-shot (you can't reuse one after `.range()` resolves).
        const buildQuery = () => {
            let q = supabase
                .from('shifts')
                .select(SHIFT_SELECT, { count: 'planned', head: false })
                .eq('organization_id', organizationId)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null);

            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                q = q.eq('department_id', filters.departmentId);
            } else if (filters?.departmentIds && filters.departmentIds.length > 0) {
                q = q.in('department_id', filters.departmentIds.filter(isValidUuid));
            }
            if (filters?.subDepartmentId && isValidUuid(filters.subDepartmentId)) {
                q = q.eq('sub_department_id', filters.subDepartmentId);
            } else if (filters?.subDepartmentIds && filters.subDepartmentIds.length > 0) {
                q = q.in('sub_department_id', filters.subDepartmentIds.filter(isValidUuid));
            }
            if (filters?.groupType) {
                q = q.eq('group_type', filters.groupType);
            }
            if (filters?.status) {
                q = q.eq('status', filters.status);
            }
            return q.order('shift_date').order('display_order').order('start_time');
        };

        try {
            // Page through until a short page arrives. `count: 'planned'` is
            // cheap but only an estimate (±10–20%), so we trust the actual
            // page length, not the count, as the stop condition.
            const all: any[] = [];
            let page = 0;
            // Safety cap (MAX_PAGES) at module scope: 100 × 1000 = 100k shifts,
            // well above any realistic week/month window.
            while (page < MAX_PAGES) {
                const from = page * PAGE_SIZE;
                const to = from + PAGE_SIZE - 1;
                const { data, error } = await buildQuery().range(from, to);
                if (error) {
                    console.error('Error fetching shifts for date range:', error);
                    return all.map(row => normalizeShiftRow(row as Record<string, unknown>));
                }
                const rows = data ?? [];
                all.push(...rows);
                // Short page = no more results, regardless of what the planner estimated.
                if (rows.length < PAGE_SIZE) break;
                page += 1;
            }

            return all.map(row => normalizeShiftRow(row as Record<string, unknown>));
        } catch (error) {
            console.error('Exception in getShiftsForDateRange:', error);
            return [];
        }
    },

    /* ============================================================
       GET SHIFTS FOR EMPLOYEE
       ============================================================ */

    async getEmployeeShifts(
        employeeId: string,
        startDate: string,
        endDate: string
    ): Promise<Shift[]> {
        if (!isValidUuid(employeeId)) return [];

        try {
            const { data, error } = await supabase
                .from('shifts')
                .select(`
                  *,
                  assignment_outcome,
                  organizations(id, name),
                  departments(id, name),
                  sub_departments(id, name),
                  roles(id, name),
                  remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
                  assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
                  roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name, external_id))
                `)
                .eq('assigned_employee_id', employeeId)
                .in('lifecycle_status', ['Published', 'InProgress', 'Completed'])
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .order('shift_date')
                .order('start_time');

            if (error) {
                console.error('Error fetching employee shifts:', error);
                return [];
            }

            return (data || []).map(row => normalizeShiftRow(row as Record<string, unknown>));
        } catch (error) {
            console.error('Exception in getEmployeeShifts:', error);
            return [];
        }
    },

    /* ============================================================
       GET SHIFTS FOR EMPLOYEE — ATTENDANCE (includes InProgress + Completed)
       Used by AttendancePage so shifts are visible after cron moves them
       out of 'Published' into 'InProgress' or 'Completed'.
       ============================================================ */

    async getEmployeeShiftsForAttendance(
        employeeId: string,
        startDate: string,
        endDate: string
    ): Promise<Shift[]> {
        if (!isValidUuid(employeeId)) return [];

        try {
            const { data, error } = await supabase
                .from('shifts')
                .select(`
                  *,
                  assignment_outcome,
                  organizations(id, name),
                  departments(id, name),
                  sub_departments(id, name),
                  roles(id, name),
                  remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
                  assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
                  roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name, external_id)),
                  timesheets(status, notes, rejected_reason, start_time, end_time)
                `)
                .eq('assigned_employee_id', employeeId)
                .in('lifecycle_status', ['Published', 'InProgress', 'Completed'])
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .order('shift_date')
                .order('start_time');

            if (error) {
                console.error('Error fetching employee attendance shifts:', error);
                return [];
            }

            return (data || []).map((row: any) => {
                const shift = normalizeShiftRow(row as Record<string, unknown>);
                const ts = Array.isArray(row.timesheets) ? row.timesheets[0] : row.timesheets;
                if (ts) {
                    shift.timesheet_status = ts.status;
                    shift.timesheet_notes = ts.notes;
                    shift.timesheet_rejected_reason = ts.rejected_reason;
                    shift.timesheet_start_time = ts.start_time;
                    shift.timesheet_end_time = ts.end_time;
                }
                return shift;
            });
        } catch (error) {
            console.error('Exception in getEmployeeShiftsForAttendance:', error);
            return [];
        }
    },

    /* ============================================================
       LOOKUPS
       ============================================================ */

    async getOrganizations(): Promise<OrgSummary[]> {
        try {
            const { data, error } = await supabase
                .from('organizations')
                .select('id, name')
                .order('name');

            if (error) {
                console.error('Error fetching organizations:', error);
                return [];
            }
            return (data || []) as OrgSummary[];
        } catch (error) {
            console.error('Exception in getOrganizations:', error);
            return [];
        }
    },

    async getDepartments(organizationId?: string): Promise<DeptSummary[]> {
        try {
            let query = supabase
                .from('departments')
                .select('id, name, organization_id')
                .order('name');

            if (organizationId && isValidUuid(organizationId)) {
                query = query.eq('organization_id', organizationId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching departments:', error);
                return [];
            }
            return (data || []) as DeptSummary[];
        } catch (error) {
            console.error('Exception in getDepartments:', error);
            return [];
        }
    },

    async getSubDepartments(departmentId?: string): Promise<SubDeptSummary[]> {
        try {
            if (departmentId && !isValidUuid(departmentId)) {
                console.warn('Invalid department ID for getSubDepartments:', departmentId);
                return [];
            }

            let query = supabase
                .from('sub_departments')
                .select('id, name, department_id')
                .order('name');

            if (departmentId) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching sub_departments:', error);
                return [];
            }
            return (data || []) as SubDeptSummary[];
        } catch (error) {
            console.error('Exception in getSubDepartments:', error);
            return [];
        }
    },

    async getRoles(organizationId?: string, departmentId?: string, subDepartmentId?: string): Promise<RoleSummary[]> {
        try {
            let query = supabase
                .from('roles')
                .select('id, name, department_id, sub_department_id, remuneration_level_id')
                .order('name');

            if (subDepartmentId && isValidUuid(subDepartmentId)) {
                // To avoid complex nested OR/AND string parsing issues in Supabase JS:
                // Fetch roles that match the explicit sub_department_id
                // PLUS roles that match the parent department_id AND have is.null sub_department_id
                // PLUS global roles that have is.null department_id

                // We execute two queries and merge to ensure correct hierarchy mapping
                const [explicitSubDeptRes, parentDeptAndGlobalRes] = await Promise.all([
                    supabase
                        .from('roles')
                        .select('id, name, department_id, sub_department_id, remuneration_level_id')
                        .eq('sub_department_id', subDepartmentId), // Explicit to this node
                    supabase
                        .from('roles')
                        .select('id, name, department_id, sub_department_id, remuneration_level_id')
                        .is('sub_department_id', null)             // Must NOT be mapped to another subdept
                        .or(`department_id.eq.${departmentId},department_id.is.null`) // Parent dept OR Global
                ]);

                if (explicitSubDeptRes.error) console.error(explicitSubDeptRes.error);
                if (parentDeptAndGlobalRes.error) console.error(parentDeptAndGlobalRes.error);

                const mergedRoles = [
                    ...(explicitSubDeptRes.data || []),
                    ...(parentDeptAndGlobalRes.data || [])
                ];

                // Sort and return early since we bypassed the single query flow
                return mergedRoles.sort((a, b) => a.name.localeCompare(b.name)) as RoleSummary[];

            } else if (departmentId && isValidUuid(departmentId)) {
                // Dept level:
                // 1. Roles explicitly mapped to this Dept with NO SubDept
                // 2. Global roles (NO Dept AND NO SubDept)
                query = query
                    .is('sub_department_id', null)
                    .or(`department_id.eq.${departmentId},department_id.is.null`);
            } else if (organizationId && isValidUuid(organizationId)) {
                // Org level: all roles for this Org (not mapped to a sub-dept)
                const { data: orgDepts } = await supabase
                    .from('departments')
                    .select('id')
                    .eq('organization_id', organizationId);

                const deptIds = orgDepts?.map(d => d.id) || [];
                query = query.is('sub_department_id', null);

                if (deptIds.length > 0) {
                    query = query.or(`department_id.in.(${deptIds.join(',')}),department_id.is.null`);
                } else {
                    query = query.is('department_id', null);
                }
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching roles:', error);
                return [];
            }

            return (data || []) as RoleSummary[];
        } catch (error) {
            console.error('Exception in getRoles:', error);
            return [];
        }
    },

    async getTemplates(subDepartmentId?: string, departmentId?: string): Promise<TemplateSummary[]> {
        console.log('[shiftsQueries.getTemplates] Fetching with:', { subDepartmentId, departmentId });
        try {
            let query = supabase
                .from('v_template_full')
                .select('id, name, description, department_id, sub_department_id, status, published_month, start_date, end_date, organization_id, applied_count')
                .eq('status', 'published')
                .order('name');

            const cleanSubDeptId = subDepartmentId?.trim();
            const cleanDeptId = departmentId?.trim();

            if (cleanSubDeptId && isValidUuid(cleanSubDeptId)) {
                if (cleanDeptId && isValidUuid(cleanDeptId)) {
                    query = query.or(`sub_department_id.eq.${cleanSubDeptId},and(department_id.eq.${cleanDeptId},sub_department_id.is.null)`);
                } else {
                    query = query.eq('sub_department_id', cleanSubDeptId);
                }
            } else if (cleanDeptId && isValidUuid(cleanDeptId)) {
                query = query.eq('department_id', cleanDeptId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[shiftsQueries.getTemplates] Error:', error);
                return [];
            }

            console.log('[shiftsQueries.getTemplates] Found:', data?.length ?? 0, 'templates');
            return (data || []) as TemplateSummary[];
        } catch (error) {
            console.error('[shiftsQueries.getTemplates] Exception:', error);
            return [];
        }
    },

    async getRemunerationLevels(): Promise<RemunerationLevel[]> {
        try {
            const { data, error } = await supabase
                .from('remuneration_levels')
                .select('id, level_number, level_name, hourly_rate_min, hourly_rate_max, description')
                .order('level_number');

            if (error) {
                console.error('Error fetching remuneration_levels:', error);
                return [];
            }
            return (data || []) as RemunerationLevel[];
        } catch (error) {
            console.error('Exception in getRemunerationLevels:', error);
            return [];
        }
    },

    async getEmployees(
        organizationId?: string,
        departmentId?: string,
        subDepartmentId?: string,
        roleId?: string,
        searchTerm?: string,
        limit?: number,
    ): Promise<ProfileSummary[]> {
        const { EligibilityService } = await import('../services/eligibility.service');
        return EligibilityService.getEligibleEmployees({
            organizationId,
            departmentId,
            subDepartmentId,
            roleId,
            searchTerm,
            limit,
        });
    },

    async getSkills(): Promise<SkillSummary[]> {
        try {
            const { data, error } = await supabase
                .from('skills')
                .select('id, name, description, category')
                .eq('is_active', true)
                .order('category')
                .order('name');

            if (error) {
                console.error('Error fetching skills:', error);
                return [];
            }
            return (data || []) as SkillSummary[];
        } catch (error) {
            console.error('Exception in getSkills:', error);
            return [];
        }
    },

    async getLicenses(): Promise<LicenseSummary[]> {
        try {
            const { data, error } = await supabase
                .from('licenses')
                .select('id, name, description, category, issuing_authority')
                .eq('is_active', true)
                .order('category')
                .order('name');

            if (error) {
                console.error('Error fetching licenses:', error);
                return [];
            }
            return (data || []) as LicenseSummary[];
        } catch (error) {
            console.error('Exception in getLicenses:', error);
            return [];
        }
    },

    async getEvents(organizationId?: string): Promise<{
        id: string; name: string; description: string | null;
        event_type: string | null; venue: string | null;
        start_date: string; end_date: string; status: string | null;
    }[]> {
        try {
            let query = supabase
                .from('events')
                .select('id, name, description, event_type, venue, start_date, end_date, status')
                .eq('is_active', true)
                .order('start_date', { ascending: true });

            if (organizationId && isValidUuid(organizationId)) {
                query = query.eq('organization_id', organizationId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching events:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getEvents:', error);
            return [];
        }
    },

    async getRosters(organizationId: string, filters?: {
        departmentId?: string;
        departmentIds?: string[];
        subDepartmentId?: string;
        subDepartmentIds?: string[];
    }): Promise<{
        id: string; start_date: string; end_date: string;
        organization_id: string; department_id: string | null;
        sub_department_id: string | null; status: string | null;
        description: string | null; is_locked: boolean | null;
        groups: { id: string; name: string; subGroups: { id: string; name: string }[] }[];
    }[]> {
        try {
            if (!isValidUuid(organizationId)) return [];

            let query = supabase
                .from('rosters')
                .select(`
                id,
                start_date,
                end_date,
                organization_id,
                department_id,
                sub_department_id,
                status,
                description,
                is_locked,
                groups: roster_groups(
                    id,
                    name,
                    subGroups: roster_subgroups(id, name)
                )
            `)
                .eq('organization_id', organizationId)
                .order('start_date', { ascending: false });

            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.or(`department_id.eq.${filters.departmentId},department_id.is.null`);
            } else if (filters?.departmentIds && filters.departmentIds.length > 0) {
                const deptIds = filters.departmentIds.filter(isValidUuid);
                if (deptIds.length > 0) {
                    query = query.or(`department_id.in.(${deptIds.join(',')}),department_id.is.null`);
                }
            }

            if (filters?.subDepartmentId && isValidUuid(filters.subDepartmentId)) {
                query = query.eq('sub_department_id', filters.subDepartmentId);
            } else if (filters?.subDepartmentIds !== undefined) {
                if (filters.subDepartmentIds.length > 0) {
                    query = query.in('sub_department_id', filters.subDepartmentIds.filter(isValidUuid));
                } else {
                    query = query.is('sub_department_id', null);
                }
            }

            const { data, error } = await query;

            if (error) {
                console.error('[getRosters] Error fetching rosters:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('[getRosters] Exception:', error);
            return [];
        }
    },

    async getPlanningPeriods(organizationId: string, departmentId?: string): Promise<{
        id: string;
        department_id: string;
        sub_department_ids: string[];
        start_date: string;
        end_date: string;
        status: string;
    }[]> {
        try {
            if (!isValidUuid(organizationId)) return [];

            let query = supabase
                .from('planning_periods')
                .select('id, department_id, sub_department_ids, start_date, end_date, status')
                .eq('organization_id', organizationId)
                .order('start_date', { ascending: false });

            if (departmentId && isValidUuid(departmentId)) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[getPlanningPeriods] Error:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('[getPlanningPeriods] Exception:', error);
            return [];
        }
    },

    /**
     * Get the full structure for a specific roster (groups and subgroups)
     */
    async getRosterStructure(rosterId: string): Promise<RosterSlot[]> {
        try {
            if (!isValidUuid(rosterId)) return [];

            const { data, error } = await supabase
                .from('roster_groups')
                .select(`
                id,
                name,
                subGroups: roster_subgroups(
                    id,
                    name
                )
            `)
                .eq('roster_id', rosterId)
                .order('sort_order', { ascending: true });

            if (error) {
                console.error('Error fetching roster structure:', error);
                return [];
            }

            if (!data) return [];

            const flattened: RosterSlot[] = [];
            (data as { name: string; subGroups: { name: string }[] }[]).forEach(group => {
                const normalizedGroup = group.name.toLowerCase().replace(/\s+/g, '_');
                if (group.subGroups && group.subGroups.length > 0) {
                    group.subGroups.forEach(sub => {
                        flattened.push({ groupType: normalizedGroup, subGroupName: sub.name });
                    });
                } else {
                    flattened.push({ groupType: normalizedGroup, subGroupName: '' });
                }
            });

            return flattened;
        } catch (error) {
            console.error('Exception in getRosterStructure:', error);
            return [];
        }
    },

    /**
     * Get count of pending shift offers (S3 - Published + Offered) for an employee
     */
    async getPendingOfferCount(employeeId: string): Promise<number> {
        try {
            if (!isValidUuid(employeeId)) return 0;

            const { count, error } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('assigned_employee_id', employeeId)
                .eq('lifecycle_status', 'Published')
                .is('assignment_outcome', null)
                .is('deleted_at', null);

            if (error) {
                console.error('Error fetching pending offer count:', error);
                return 0;
            }
            return count ?? 0;
        } catch (error) {
            console.error('Exception in getPendingOfferCount:', error);
            return 0;
        }
    },

    /**
     * L4 — Labor Demand Timecard Adjustment.
     * Calculates the historical attendance ratio (actual_minutes / scheduled_minutes)
     * for completed shifts in the last 14 days.
     */
    async getTimecardMultipliers(organizationId: string, daysBack: number = 14): Promise<Map<string, number>> {
        if (!isValidUuid(organizationId)) return new Map<string, number>();

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('shifts')
            .select('role_id, scheduled_length_minutes, actual_net_minutes')
            .eq('organization_id', organizationId)
            .eq('lifecycle_status', 'Completed')
            .gte('shift_date', startDateStr)
            .not('actual_net_minutes', 'is', null)
            .not('role_id', 'is', null);

        if (error) {
            console.error('Error fetching timecard multipliers:', error);
            return new Map<string, number>();
        }

        const totals = new Map<string, { actual: number; scheduled: number }>();
        for (const row of data || []) {
            const roleId = row.role_id as string;
            const actual = row.actual_net_minutes || 0;
            const scheduled = row.scheduled_length_minutes || 0;
            if (scheduled === 0) continue;

            const existing = totals.get(roleId) ?? { actual: 0, scheduled: 0 };
            totals.set(roleId, {
                actual: existing.actual + actual,
                scheduled: existing.scheduled + scheduled,
            });
        }

        const result = new Map<string, number>();
        totals.forEach((v, roleId) => {
            const ratio = v.actual / v.scheduled;
            // Clamp to sensible range [0.5, 1.5] to prevent data outliers from wrecking the engine
            result.set(roleId, Math.max(0.5, Math.min(1.5, ratio)));
        });

        return result;
    },

    /**
     * Get shift offers for an employee (S3 - Published + Offered status)
     */
    async getMyOffers(employeeId: string, filters?: { organizationId?: string; departmentId?: string }) {
        try {
            if (!isValidUuid(employeeId)) return [];

            let query = supabase
                .from('shifts')
                .select(`
                id,
                shift_date,
                start_time,
                end_time,
                notes,
                assignment_outcome,
                published_at,
                paid_break_minutes,
                unpaid_break_minutes,
                break_minutes,
                timezone,
                offer_expires_at,
                group_type,
                sub_group_name,
                roles(name),
                departments(id, name),
                sub_departments(name),
                organizations(id, name),
                remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max)
            `)
                .eq('assigned_employee_id', employeeId)
                .eq('lifecycle_status', 'Published')
                .is('assignment_outcome', null)
                .is('deleted_at', null);

            if (filters?.organizationId && isValidUuid(filters.organizationId)) {
                query = query.eq('organization_id', filters.organizationId);
            }
            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.or(`department_id.eq.${filters.departmentId},department_id.is.null`);
            }

            const { data, error } = await query
                .order('shift_date', { ascending: true });

            if (error) {
                console.error('Error fetching my offers:', error);
                throw error;
            }

            return (data || []).map(shift => ({
                id: shift.id,
                shift_id: shift.id,
                status: 'Pending' as const,
                offered_at: shift.published_at,
                offer_expires_at: (shift as any).offer_expires_at,
                offered_by_name: 'Admin',
                shift: {
                    id: shift.id,
                    shift_date: shift.shift_date,
                    start_time: shift.start_time,
                    end_time: shift.end_time,
                    roles: shift.roles,
                    departments: shift.departments,
                    sub_departments: shift.sub_departments,
                    organizations: shift.organizations,
                    notes: shift.notes,
                    break_minutes: shift.break_minutes,
                    paid_break_minutes: shift.paid_break_minutes,
                    unpaid_break_minutes: shift.unpaid_break_minutes,
                    offer_expires_at: (shift as any).offer_expires_at,
                    remuneration_levels: shift.remuneration_levels,
                    group_type: shift.group_type,
                },
            }));
        } catch (error) {
            console.error('Exception in getMyOffers:', error);
            throw error;
        }
    },

    /**
     * Get offer history (Accepted/Declined) for an employee
     */
    async getMyOfferHistory(employeeId: string, status: 'Accepted' | 'Declined', filters?: { organizationId?: string; departmentId?: string }) {
        try {
            if (!isValidUuid(employeeId)) return [];

            // 1. Identify relevant shifts via shift_events to ensure persistence of history.
            //    Using the events table allows us to see rejections and acceptances even if
            //    the current state of the shift has changed (e.g., someone else accepted it later).
            const eventType = status === 'Accepted' ? 'ACCEPTED' : 'REJECTED';
            const { data: eventData, error: eventError } = await supabase
                .from('shift_events')
                .select('shift_id')
                .eq('employee_id', employeeId)
                .eq('event_type', eventType);

            if (eventError) {
                console.error(`[getMyOfferHistory] Event fetch error:`, eventError);
                // Fallback to legacy behavior if events cannot be reached
            }

            let query = supabase
                .from('shifts')
                .select(`
                    id,
                    shift_date,
                    start_time,
                    end_time,
                    notes,
                    assignment_outcome,
                    published_at,
                    paid_break_minutes,
                    unpaid_break_minutes,
                    break_minutes,
                    timezone,
                    offer_expires_at,
                    group_type,
                    sub_group_name,
                    roles(name),
                    departments(id, name),
                    sub_departments(name),
                    organizations(id, name),
                    remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max)
                `)
                .is('deleted_at', null);

            // 2. Apply identity filter based on events if available, otherwise fallback to column matching
            if (eventData && eventData.length > 0) {
                const shiftIds = [...new Set(eventData.map(e => e.shift_id))].filter((id): id is string => id !== null);
                query = query.in('id', shiftIds);
            } else if (!eventError) {
                // If query succeeded but returned no events, and we aren't in error,
                // we should still try the legacy column check just in case events are missing
                // but the columns are still set.
                if (status === 'Accepted') {
                    query = query
                        .eq('assigned_employee_id', employeeId)
                        .eq('assignment_outcome', 'confirmed' as const);
                } else {
                    query = query
                        .eq('last_rejected_by', employeeId);
                }
            } else {
                // Hard fallback on RPC error
                if (status === 'Accepted') {
                    query = query.eq('assigned_employee_id', employeeId).eq('assignment_outcome', 'confirmed' as const);
                } else {
                    query = query.eq('last_rejected_by', employeeId);
                }
            }

            if (filters?.organizationId && isValidUuid(filters.organizationId)) {
                query = query.eq('organization_id', filters.organizationId);
            }
            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.or(`department_id.eq.${filters.departmentId},department_id.is.null`);
            }

            const { data, error } = await query
                .order('shift_date', { ascending: false });

            if (error) {
                console.error(`Error fetching my offer history (${status}):`, error);
                throw error;
            }

            return (data || []).map(shift => ({
                id: shift.id,
                shift_id: shift.id,
                status: status,
                offered_at: shift.published_at,
                offer_expires_at: (shift as any).offer_expires_at,
                offered_by_name: 'System',
                shift: {
                    id: shift.id,
                    shift_date: shift.shift_date,
                    start_time: shift.start_time,
                    end_time: shift.end_time,
                    roles: shift.roles,
                    departments: shift.departments,
                    sub_departments: shift.sub_departments,
                    organizations: shift.organizations,
                    notes: shift.notes,
                    break_minutes: shift.break_minutes,
                    paid_break_minutes: shift.paid_break_minutes,
                    unpaid_break_minutes: shift.unpaid_break_minutes,
                    offer_expires_at: (shift as any).offer_expires_at,
                    remuneration_levels: shift.remuneration_levels,
                    group_type: shift.group_type,
                },
            }));
        } catch (error) {
            console.error('Exception in getMyOfferHistory:', error);
            throw error;
        }
    },

    /**
     * Accept a shift offer — delegates to the typed RPC client.
     * Prefer shiftsCommands.acceptOffer() for new code; this alias is kept
     * for backward compatibility with components that import from shiftsQueries.
     */
    async acceptOffer(shiftId: string) {
        return callAuthenticatedRpc(
            'sm_accept_offer',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId }),
            OfferActionResponseSchema,
        );
    },

    /**
     * Decline a shift offer — delegates to the typed RPC client.
     */
    async declineOffer(shiftId: string) {
        return callAuthenticatedRpc(
            'sm_decline_offer',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId }),
            OfferActionResponseSchema,
        );
    },

    /**
     * Get all open shifts available for bidding (S5/S6)
     * Enforces Access Control: Org -> Dept -> SubDept
     */
    async getOpenShifts(filters: {
        organizationId: string;
        departmentId?: string;
        subDepartmentId?: string;
    }): Promise<Shift[]> {
        try {
            const { organizationId, departmentId, subDepartmentId } = filters;

            if (!isValidUuid(organizationId)) {
                console.warn('Invalid organization ID for getOpenShifts:', organizationId);
                return [];
            }

            let query = supabase
                .from('shifts')
                .select(`
                *,
                organizations(name),
                departments(name),
                sub_departments(name),
                roles(name),
                remuneration_levels(level_name, hourly_rate_min)
            `)
                .eq('organization_id', organizationId)
                .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent'])
                .is('deleted_at', null)
                .eq('is_cancelled', false);

            if (subDepartmentId && isValidUuid(subDepartmentId)) {
                query = query.eq('sub_department_id', subDepartmentId);
            } else if (departmentId && isValidUuid(departmentId)) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query
                .order('shift_date', { ascending: true });

            if (error) {
                console.error('Error fetching open shifts:', error);
                return [];
            }
            return (data || []) as unknown as Shift[];
        } catch (error) {
            console.error('Exception in getOpenShifts:', error);
            return [];
        }
    },

    /**
     * Get all bids for a specific shift
     */
    async getShiftBids(shiftId: string): Promise<{
        id: string;
        shift_id: string;
        employee_id: string;
        status: string;
        created_at: string;
        profiles: { id: string; full_name: string | null; first_name: string | null; last_name: string | null; employment_type: string | null } | null;
    }[]> {
        try {
            if (!isValidUuid(shiftId)) return [];

            const { data, error } = await supabase
                .from('shift_bids')
                .select(`
                    id, shift_id, employee_id, status, created_at,
                    profiles!shift_bids_employee_id_fkey(
                        id, full_name, first_name, last_name, employment_type
                    )
                `)
                .eq('shift_id', shiftId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching shift bids:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getShiftBids:', error);
            return [];
        }
    },

    /**
     * Get shifts for manager bid management across all three categories:
     * - Urgent: bidding_status = 'on_bidding_urgent'
     * - Normal: bidding_status = 'on_bidding_normal'
     * - Resolved: assigned_employee_id IS NOT NULL (winner assigned)
     */
    async getManagerBidShifts(filters: {
        organizationId: string;
        departmentId?: string;
        subDepartmentId?: string;
        startDate?: string;
        endDate?: string;
    }): Promise<Shift[]> {
        try {
            const { organizationId, departmentId, subDepartmentId, startDate, endDate } = filters;

            if (!isValidUuid(organizationId)) {
                console.warn('Invalid organization ID for getManagerBidShifts:', organizationId);
                return [];
            }

            // Fetch all shifts that have ever been on bidding (normal or urgent)
            // OR are currently assigned after bidding
            let query = supabase
                .from('shifts')
                .select(`
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name),
                    roles(name),
                    remuneration_levels(level_name, hourly_rate_min),
                    assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
                    shift_bids(id)
                `)
                .eq('organization_id', organizationId)
                .is('deleted_at', null)
                .eq('is_cancelled', false)
                // Fetch shifts that are or were on bidding
                .eq('lifecycle_status', 'Published');

            if (startDate) {
                query = query.gte('shift_date', startDate);
            }
            if (endDate) {
                query = query.lte('shift_date', endDate);
            }

            if (subDepartmentId && isValidUuid(subDepartmentId)) {
                query = query.eq('sub_department_id', subDepartmentId);
            } else if (departmentId && isValidUuid(departmentId)) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query
                .order('shift_date', { ascending: true });

            if (error) {
                console.error('[getManagerBidShifts] Supabase error:', error);
                return [];
            }

            console.log(`[getManagerBidShifts] Fetched ${data?.length || 0} shifts using filters:`, filters);
            return (data || []) as unknown as Shift[];
        } catch (error) {
            console.error('[getManagerBidShifts] Exception:', error);
            return [];
        }
    },

    /* ============================================================
       GET SHIFT DELTA  (delta-sync)
       Returns only rows that changed since a given cursor timestamp.
       Client applies these surgically to the TanStack Query cache
       instead of invalidating the full shift list.
       ============================================================ */

    async getShiftDelta(params: {
        orgId: string;
        since: string;           // ISO 8601 timestamptz
        deptIds?: string[];
        startDate?: string;
        endDate?: string;
    }): Promise<ShiftDeltaRow[]> {
        if (!isValidUuid(params.orgId)) return [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('get_shift_delta', {
            p_org_id:    params.orgId,
            p_since:     params.since,
            p_dept_ids:  params.deptIds ?? null,
            p_start_date: params.startDate ?? null,
            p_end_date:   params.endDate ?? null,
        });

        if (error) {
            console.error('[getShiftDelta] RPC error:', error);
            return [];
        }

        return (data ?? []) as ShiftDeltaRow[];
    },
};

// ── Delta sync types ──────────────────────────────────────────────────────────

/** Lightweight row returned by get_shift_delta — only changed fields */
export interface ShiftDeltaRow {
    id: string;
    updated_at: string;
    deleted_at: string | null;
    shift_date: string | null;
    start_time: string | null;
    end_time: string | null;
    lifecycle_status: string | null;
    assignment_status: string | null;
    assigned_employee_id: string | null;
    version: number;
    department_id: string | null;
    sub_department_id: string | null;
    role_id: string | null;
}

