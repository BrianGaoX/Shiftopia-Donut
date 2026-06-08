/**
 * Get Organization Hierarchy Query
 * Domain layer - fetches org → department → sub-department cascade
 */

import { supabase } from '@/platform/supabase/client';

export interface Organization {
    id: string;
    name: string;
}

export interface Department {
    id: string;
    name: string;
    organizationId: string;
}

export interface SubDepartment {
    id: string;
    name: string;
    departmentId: string;
}

export interface OrgHierarchyOutput {
    organizations: Organization[];
    departments: Department[];
    subDepartments: SubDepartment[];
}

/**
 * Fetch all organizations
 */
export async function getOrganizations(): Promise<Organization[]> {
    const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .order('name');

    if (error) {
        console.error('[getOrganizations] Error:', error);
        return [];
    }

    return data || [];
}

/**
 * Fetch departments for an organization
 */
export async function getDepartments(organizationId: string): Promise<Department[]> {
    if (!organizationId) return [];

    const { data, error } = await supabase
        .from('departments')
        .select('id, name, organization_id')
        .eq('organization_id', organizationId)
        .order('name');

    if (error) {
        console.error('[getDepartments] Error:', error);
        return [];
    }

    return (data || []).map((d) => ({
        id: d.id,
        name: d.name,
        organizationId: d.organization_id,
    }));
}

/**
 * Fetch sub-departments for a department
 */
export async function getSubDepartments(departmentId: string): Promise<SubDepartment[]> {
    if (!departmentId) return [];

    const { data, error } = await supabase
        .from('sub_departments')
        .select('id, name, department_id')
        .eq('department_id', departmentId)
        .order('name');

    if (error) {
        console.error('[getSubDepartments] Error:', error);
        return [];
    }

    return (data || []).map((d) => ({
        id: d.id,
        name: d.name,
        departmentId: d.department_id,
    }));
}

/**
 * Fetch complete hierarchy (for initial load)
 */
export async function getFullOrgHierarchy(): Promise<OrgHierarchyOutput> {
    const [orgs, depts, subDepts] = await Promise.all([
        supabase.from('organizations').select('id, name').order('name'),
        supabase.from('departments').select('id, name, organization_id').order('name'),
        supabase.from('sub_departments').select('id, name, department_id').order('name'),
    ]);

    return {
        organizations: orgs.data || [],
        departments: (depts.data || []).map((d) => ({
            id: d.id,
            name: d.name,
            organizationId: d.organization_id,
        })),
        subDepartments: (subDepts.data || []).map((d) => ({
            id: d.id,
            name: d.name,
            departmentId: d.department_id,
        })),
    };
}
