
import { supabase } from '@/platform/supabase/client';
import { Employee } from '../model/employee.types';

/**
 * Employee Service
 * 
 * Fetches employee data from the profiles table.
 */
export const employeeService = {
    getAllEmployees: async (orgIds?: string[], deptIds?: string[]): Promise<Employee[]> => {
        // When scope filters are provided, resolve matching user IDs via contracts first
        let filteredUserIds: string[] | null = null;
        if (orgIds?.length || deptIds?.length) {
            let contractsQuery = supabase.from('user_contracts').select('user_id');
            if (orgIds?.length)  contractsQuery = contractsQuery.in('organization_id', orgIds);
            if (deptIds?.length) contractsQuery = contractsQuery.in('department_id',   deptIds);
            const { data: contractRows } = await contractsQuery;
            filteredUserIds = [...new Set((contractRows ?? []).map((c: { user_id: string }) => c.user_id))];
            if (filteredUserIds.length === 0) return [];
        }

        let query = supabase
            .from('profiles')
            .select(`
                id,
                first_name,
                last_name,
                full_name,
                email,
                avatar_url,
                user_contracts (
                    id,
                    organization_id,
                    department_id,
                    sub_department_id,
                    status
                )
            `)
            .order('full_name');

        if (filteredUserIds !== null) {
            query = query.in('id', filteredUserIds);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[employeeService] Error fetching employees:', error);
            return [];
        }

        const now = new Date().toISOString();
        return (data || []).map((p: any) => ({
            id: p.id,
            firstName: p.first_name || '',
            lastName: p.last_name || '',
            fullName: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown',
            email: p.email || '',
            avatarUrl: p.avatar_url ?? undefined,
            is_active: true,
            createdAt: now,
            updatedAt: now,
            contracts: p.user_contracts as any
        })) as Employee[];
    },

    getEmployeeById: async (id: string): Promise<Employee | null> => {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, email, avatar_url')
            .eq('id', id)
            .single();

        if (error || !data) {
            return null;
        }

        const now = new Date().toISOString();
        return {
            id: data.id,
            firstName: data.first_name || '',
            lastName: data.last_name || '',
            fullName: data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown',
            email: data.email || '',
            avatarUrl: data.avatar_url ?? undefined,
            is_active: true,
            createdAt: now,
            updatedAt: now
        } as Employee;
    },

    getEmployeesByDepartment: async (department: string): Promise<Employee[]> => {
        // TODO: Add department filtering when contracts are properly linked
        return employeeService.getAllEmployees();
    },

    getAvailableEmployeesForShift: async (
        date: string,
        department: string,
        role: string,
        startTime: string,
        endTime: string
    ): Promise<Employee[]> => {
        // TODO: Add availability filtering
        return employeeService.getAllEmployees();
    }
};
