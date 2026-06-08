
import { useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export interface ContractFormState {
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    role_id: string;
    rem_level_id: string;
    employment_status: string;
    contracted_weekly_hours: number;
    annual_guaranteed_hours?: number;
    is_apprentice?: boolean;
    apprentice_type?: 'standard' | 'adult' | 'school_based';
    apprentice_year?: number;
    has_completed_year_12?: boolean;
    is_trainee?: boolean;
    trainee_category?: 'junior' | 'adult' | 'school_based';
    trainee_level?: 'A' | 'B';
    trainee_exit_year?: number;
    trainee_years_out?: number;
    trainee_aqf_level?: number;
    trainee_year?: number;
    is_training_on_job?: boolean;
    prefers_sba_loading?: boolean;
    is_sws?: boolean;
    sws_capacity_percentage?: number;
    is_sws_trial?: boolean;
    sws_trial_start_date?: string;
}

const INITIAL_STATE: ContractFormState = {
    organization_id: '',
    department_id: '',
    sub_department_id: '',
    role_id: '',
    rem_level_id: '',
    employment_status: '',
    contracted_weekly_hours: 0,
    annual_guaranteed_hours: 0,
    is_apprentice: false,
    apprentice_type: 'standard',
    apprentice_year: 1,
    has_completed_year_12: false,
    is_trainee: false,
    trainee_category: 'junior',
    trainee_level: 'A',
    trainee_exit_year: 12,
    trainee_years_out: 0,
    trainee_aqf_level: 3,
    trainee_year: 1,
    is_training_on_job: false,
    prefers_sba_loading: false,
    is_sws: false,
    sws_capacity_percentage: 50,
    is_sws_trial: false,
    sws_trial_start_date: ''
};

export const useContractForm = (employeeId: string, onSuccess?: () => void) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<ContractFormState>(INITIAL_STATE);

    const updateField = (field: keyof ContractFormState, value: any) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value };

            if (field === 'organization_id') {
                next.department_id = '';
                next.sub_department_id = '';
                next.role_id = '';
            } else if (field === 'department_id') {
                next.sub_department_id = '';
                next.role_id = '';
            } else if (field === 'sub_department_id') {
                next.role_id = '';
            }

            // Auto-update hours based on status
            if (field === 'employment_status') {
                if (value === 'Full-Time') {
                    next.contracted_weekly_hours = 38;
                    next.annual_guaranteed_hours = 0;
                } else if (value === 'Part-Time') {
                    next.contracted_weekly_hours = 20;
                    next.annual_guaranteed_hours = 0;
                } else if (value === 'Flexible Part-Time') {
                    next.contracted_weekly_hours = 0; // FPT usually has no weekly minimum
                    next.annual_guaranteed_hours = 624;
                } else {
                    next.contracted_weekly_hours = 0;
                    next.annual_guaranteed_hours = 0;
                }
            }

            // Apprentice resets
            if (field === 'is_apprentice' && value) {
                next.is_trainee = false;
                next.is_sws = false;
            }
            if (field === 'is_trainee' && value) {
                next.is_apprentice = false;
                next.is_sws = false;
            }
            if (field === 'is_sws' && value) {
                next.is_apprentice = false;
                next.is_trainee = false;
            }

            // Trainee resets
            if (field === 'is_trainee' && !value) {
                next.trainee_category = 'junior';
                next.trainee_level = 'A';
                next.trainee_exit_year = 12;
                next.trainee_years_out = 0;
            }
            
            return next;
        });
    };

    const updateRole = (roleId: string, linkedRemLevelId?: string, employmentType?: string) => {
        setFormData(prev => {
            let nextStatus = prev.employment_status;
            if (employmentType) {
                const lower = employmentType.toLowerCase();
                if (lower.includes('full time')) nextStatus = 'Full-Time';
                else if (lower.includes('part time')) nextStatus = 'Part-Time';
                else if (lower.includes('casual')) nextStatus = 'Casual';
            }

            let nextHours = prev.contracted_weekly_hours;
            let nextAnnualHours = prev.annual_guaranteed_hours;

            if (nextStatus === 'Full-Time') {
                nextHours = 38;
                nextAnnualHours = 0;
            } else if (nextStatus === 'Part-Time') {
                nextHours = 20;
                nextAnnualHours = 0;
            } else if (nextStatus === 'Flexible Part-Time') {
                nextHours = 0;
                nextAnnualHours = 624;
            } else {
                nextHours = 0;
                nextAnnualHours = 0;
            }

            return {
                ...prev,
                role_id: roleId,
                rem_level_id: linkedRemLevelId || prev.rem_level_id,
                employment_status: nextStatus,
                contracted_weekly_hours: nextHours,
                annual_guaranteed_hours: nextAnnualHours
            };
        });
    };

    const validate = (): string[] => {
        const missing: string[] = [];
        if (!formData.organization_id) missing.push('Organization');
        if (!formData.department_id) missing.push('Department');
        if (!formData.sub_department_id) missing.push('Sub-Department');
        if (!formData.role_id) missing.push('Role');
        if (!formData.rem_level_id) missing.push('Remuneration Level');
        return missing;
    };

    const submit = async () => {
        const missing = validate();
        if (missing.length > 0) {
            toast({
                title: 'Validation Error',
                description: `Please select the following: ${missing.join(', ')}`,
                variant: 'destructive'
            });
            return false;
        }

        setIsSubmitting(true);
        try {
            const { error } = await (supabase as any).from('user_contracts').insert({
                user_id: employeeId,
                organization_id: formData.organization_id,
                department_id: formData.department_id,
                sub_department_id: formData.sub_department_id,
                role_id: formData.role_id,
                rem_level_id: formData.rem_level_id,
                employment_status: formData.employment_status,
                contracted_weekly_hours: formData.contracted_weekly_hours,
                annual_guaranteed_hours: formData.annual_guaranteed_hours,
                is_apprentice: formData.is_apprentice,
                apprentice_type: formData.apprentice_type,
                apprentice_year: formData.apprentice_year,
                has_completed_year_12: formData.has_completed_year_12,
                is_trainee: formData.is_trainee,
                trainee_category: formData.trainee_category,
                trainee_level: formData.trainee_level,
                trainee_exit_year: formData.trainee_exit_year,
                trainee_years_out: formData.trainee_years_out,
                trainee_aqf_level: formData.trainee_aqf_level,
                trainee_year: formData.trainee_year,
                is_training_on_job: formData.is_training_on_job,
                prefers_sba_loading: formData.prefers_sba_loading,
                is_sws: formData.is_sws,
                sws_capacity_percentage: formData.sws_capacity_percentage,
                is_sws_trial: formData.is_sws_trial,
                sws_trial_start_date: formData.sws_trial_start_date || null
            });

            if (error) throw error;

            toast({ title: 'Success', description: 'Contract added successfully' });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });

            setFormData(prev => ({
                ...prev,
                role_id: '',
                rem_level_id: '',
            }));

            if (onSuccess) onSuccess();
            return true;
        } catch (error: any) {
            console.error('Error adding contract:', error);
            toast({ title: 'Error', description: error.message || 'Failed to add contract', variant: 'destructive' });
            return false;
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        formData,
        isSubmitting,
        updateField,
        updateRole,
        submit,
        setFormData
    };
};
