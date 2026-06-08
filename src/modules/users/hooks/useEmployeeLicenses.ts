import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/hooks/use-toast';

// Types
export interface EmployeeLicense {
    id: string;
    employee_id: string;
    license_id: string;
    issue_date?: string;
    expiration_date?: string;
    status: 'Active' | 'Expired' | 'Suspended';
    verification_status?: 'Unverified' | 'Verified' | 'Failed' | 'Expired';
    verified_at?: string;
    last_checked_at?: string;
    verification_metadata?: Record<string, any>;
    license_type?: 'Standard' | 'WorkRights' | 'Professional';
    has_restricted_work_limit?: boolean;
    created_at: string;
    updated_at: string;
    // Joined fields
    license?: {
        id: string;
        name: string;
        description?: string;
    };
}

export interface NewEmployeeLicense {
    employee_id: string;
    license_id: string;
    issue_date?: string;
    expiration_date?: string;
    status?: 'Active' | 'Expired' | 'Suspended';
    license_type?: 'Standard' | 'WorkRights' | 'Professional';
}

// Hook to fetch employee's licenses
export const useEmployeeLicenses = (
    employeeId: string,
    options?: { filter?: { license_type?: string } }
) => {
    return useQuery({
        queryKey: ['employee_licenses', employeeId, options?.filter],
        queryFn: async () => {
            let query = supabase
                .from('employee_licenses')
                .select(`
          *,
          license:licenses(id, name, description)
        `)
                .eq('employee_id', employeeId);

            if (options?.filter?.license_type) {
                query = query.eq('license_type', options.filter.license_type);
            }

            const { data, error } = await query.order('created_at', { ascending: false });

            if (error) throw error;
            return data as EmployeeLicense[];
        },
        enabled: !!employeeId,
    });
};

// Hook to add employee license
export const useAddEmployeeLicense = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async (license: NewEmployeeLicense) => {
            const { data, error } = await supabase
                .from('employee_licenses')
                .insert(license)
                .select(`
          *,
          license:licenses(id, name, description)
        `)
                .single();

            if (error) throw error;
            return data as EmployeeLicense;
        },
        onSuccess: async (_, variables) => {
            await queryClient.invalidateQueries({ queryKey: ['employee_licenses', variables.employee_id] });
            toast({ title: 'Success', description: 'License added successfully' });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to add license',
                variant: 'destructive'
            });
        },
    });
};

// Hook to update employee license
export const useUpdateEmployeeLicense = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmployeeLicense> }) => {
            const { data, error } = await supabase
                .from('employee_licenses')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select(`
          *,
          license:licenses(id, name, description)
        `)
                .single();

            if (error) throw error;
            return data as EmployeeLicense;
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: ['employee_licenses', data.employee_id] });
            toast({ title: 'Success', description: 'License updated successfully' });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to update license',
                variant: 'destructive'
            });
        },
    });
};

// Hook to remove employee license
export const useRemoveEmployeeLicense = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ id, employeeId }: { id: string; employeeId: string }) => {
            const { error } = await supabase
                .from('employee_licenses')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return { id, employeeId };
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: ['employee_licenses', data.employeeId] });
            toast({ title: 'Success', description: 'License removed successfully' });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to remove license',
                variant: 'destructive'
            });
        },
    });
};
