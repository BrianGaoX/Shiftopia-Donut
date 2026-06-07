/**
 * Get Shift Details Query
 * Domain layer - fetches full shift details with joins
 */

import { supabase } from '@/platform/supabase/client';

export interface ShiftDetails {
    id: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    departmentId: string;
    departmentName?: string;
    subDepartmentId: string;
    subDepartmentName?: string;
    roleId?: string;
    roleName?: string;
    assignedEmployeeId?: string;
    assignedEmployeeName?: string;
    remunerationLevelId?: string;
    remunerationLevel?: number;
    status: string;
    isDraft: boolean;
    shiftGroupId?: string;
    shiftGroupName?: string;
    shiftSubgroupId?: string;
    shiftSubgroupName?: string;
    length?: number;
    netLength?: number;
    paidBreakDuration?: number;
    unpaidBreakDuration?: number;
    createdAt: string;
    updatedAt?: string;
}

// Internal interfaces for Supabase Query Result
interface Department { name: string; }
interface SubDepartment { name: string; }
interface Role { name: string; }
interface Employee { first_name: string; last_name: string; }
interface RemunerationLevel { level: number; }
interface ShiftGroup { name: string; }
interface ShiftSubgroup { name: string; }

interface ShiftQueryResult {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    department_id: string;
    sub_department_id: string;
    role_id: string | null;
    assigned_employee_id: string | null;
    remuneration_level_id: string | null;
    status: string;
    is_draft: boolean;
    shift_group_id: string | null;
    shift_subgroup_id: string | null;
    length: number | null;
    net_length: number | null;
    paid_break_duration: number | null;
    unpaid_break_duration: number | null;
    created_at: string;
    updated_at: string | null;
    // Joined tables
    departments: Department | null;
    sub_departments: SubDepartment | null;
    roles: Role | null;
    employees: Employee | null;
    remuneration_levels: RemunerationLevel | null;
    shift_groups: ShiftGroup | null;
    shift_subgroups: ShiftSubgroup | null;
}

/**
 * Fetch detailed shift information with related data
 */
export async function getShiftDetails(
    shiftId: string
): Promise<ShiftDetails | null> {
    if (!shiftId) return null;

    const { data: rawData, error } = await supabase
        .from('shifts')
        .select(`
      id,
      shift_date,
      start_time,
      end_time,
      department_id,
      sub_department_id,
      role_id,
      assigned_employee_id,
      remuneration_level_id,
      status,
      is_draft,
      shift_group_id,
      shift_subgroup_id,
      length,
      net_length,
      paid_break_duration,
      unpaid_break_duration,
      created_at,
      updated_at,
      departments:department_id(name),
      sub_departments:sub_department_id(name),
      roles:role_id(name),
      employees:assigned_employee_id(first_name, last_name),
      remuneration_levels:remuneration_level_id(level),
      shift_groups:shift_group_id(name),
      shift_subgroups:shift_subgroup_id(name)
    `)
        .eq('id', shiftId)
        .single();

    if (error || !rawData) {
        console.error('[getShiftDetails] Error:', error);
        return null;
    }

    // Cast the raw Supabase response to our typed interface
    // In a perfect world, we'd use the generated Database types, but this is a solid middle ground
    const data = rawData as unknown as ShiftQueryResult;

    return {
        id: data.id,
        shiftDate: data.shift_date,
        startTime: data.start_time,
        endTime: data.end_time,
        departmentId: data.department_id,
        departmentName: data.departments?.name,
        subDepartmentId: data.sub_department_id,
        subDepartmentName: data.sub_departments?.name,
        roleId: data.role_id || undefined,
        roleName: data.roles?.name,
        assignedEmployeeId: data.assigned_employee_id || undefined,
        assignedEmployeeName: data.employees
            ? `${data.employees.first_name} ${data.employees.last_name}`
            : undefined,
        remunerationLevelId: data.remuneration_level_id || undefined,
        remunerationLevel: data.remuneration_levels?.level,
        status: data.status || 'draft',
        isDraft: data.is_draft ?? true,
        shiftGroupId: data.shift_group_id || undefined,
        shiftGroupName: data.shift_groups?.name,
        shiftSubgroupId: data.shift_subgroup_id || undefined,
        shiftSubgroupName: data.shift_subgroups?.name,
        length: data.length || undefined,
        netLength: data.net_length || undefined,
        paidBreakDuration: data.paid_break_duration || undefined,
        unpaidBreakDuration: data.unpaid_break_duration || undefined,
        createdAt: data.created_at || '',
        updatedAt: data.updated_at || undefined,
    };
}
