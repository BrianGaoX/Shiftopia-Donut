import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/hooks/use-toast';

// Types
export interface Skill {
    id: string;
    name: string;
    description?: string;
    category: 'Safety' | 'Operational' | 'Technical' | 'Compliance';
    requires_expiration: boolean;
    default_validity_months?: number;
}

export interface EmployeeSkill {
    id: string;
    employee_id: string;
    skill_id: string;
    proficiency_level: 'Novice' | 'Competent' | 'Proficient' | 'Expert';
    verified_at?: string;
    expiration_date?: string;
    status: 'Active' | 'Expired' | 'Pending' | 'Revoked';
    notes?: string;
    issue_date?: string;
    created_at: string;
    updated_at: string;
    // Joined fields
    skill?: Skill;
}

export interface NewEmployeeSkill {
    employee_id: string;
    skill_id: string;
    proficiency_level?: 'Novice' | 'Competent' | 'Proficient' | 'Expert';
    verified_at?: string;
    expiration_date?: string;
    issue_date?: string;
    notes?: string;
}

// Hook to fetch all skills catalog
export const useSkills = () => {
    return useQuery({
        queryKey: ['skills'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('skills')
                .select('*')
                .order('category', { ascending: true })
                .order('name', { ascending: true });

            if (error) throw error;
            return data as Skill[];
        },
    });
};

// Hook to fetch employee's skills
export const useEmployeeSkills = (employeeId: string) => {
    return useQuery({
        queryKey: ['employee_skills', employeeId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_skills')
                .select(`
          *,
          skill:skills(*)
        `)
                .eq('employee_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data as EmployeeSkill[];
        },
        enabled: !!employeeId,
    });
};

// Hook to add employee skill
export const useAddEmployeeSkill = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async (skill: NewEmployeeSkill) => {
            const { data, error } = await supabase
                .from('employee_skills')
                .insert(skill)
                .select(`
          *,
          skill:skills(*)
        `)
                .single();

            if (error) throw error;
            return data as EmployeeSkill;
        },
        onSuccess: async (_, variables) => {
            await queryClient.invalidateQueries({ queryKey: ['employee_skills', variables.employee_id] });
            toast({ title: 'Success', description: 'Skill added successfully' });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to add skill',
                variant: 'destructive'
            });
        },
    });
};

// Hook to update employee skill
export const useUpdateEmployeeSkill = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmployeeSkill> }) => {
            const { data, error } = await supabase
                .from('employee_skills')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select(`
          *,
          skill:skills(*)
        `)
                .single();

            if (error) throw error;
            return data as EmployeeSkill;
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: ['employee_skills', data.employee_id] });
            toast({ title: 'Success', description: 'Skill updated successfully' });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to update skill',
                variant: 'destructive'
            });
        },
    });
};

// Hook to remove employee skill
export const useRemoveEmployeeSkill = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ id, employeeId }: { id: string; employeeId: string }) => {
            const { error } = await supabase
                .from('employee_skills')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return { id, employeeId };
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: ['employee_skills', data.employeeId] });
            toast({ title: 'Success', description: 'Skill removed successfully' });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to remove skill',
                variant: 'destructive'
            });
        },
    });
};
