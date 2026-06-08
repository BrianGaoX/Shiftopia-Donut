import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';

export interface ReferenceDataState {
    organizations: any[];
    departments: any[];
    subDepartments: any[];
    roles: any[];
    remLevels: any[];
}

export const useReferenceData = (shouldLoad: boolean = false) => {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [data, setData] = useState<ReferenceDataState>({
        organizations: [],
        departments: [],
        subDepartments: [],
        roles: [],
        remLevels: [],
    });
    const [isLoaded, setIsLoaded] = useState(false);

    const loadReferenceData = useCallback(async () => {
        if (isLoaded || isLoading) return;

        setIsLoading(true);
        try {
            const [orgsRes, deptsRes, subDeptsRes, rolesRes, remLevelsRes] = await Promise.all([
                supabase.from('organizations').select('id, name').order('name'),
                supabase.from('departments').select('id, name, organization_id').order('name'),
                supabase.from('sub_departments').select('id, name, department_id').order('name'),
                supabase.from('roles').select('id, name, level, sub_department_id, remuneration_level_id, employment_type').order('name'),
                supabase.from('remuneration_levels').select('id, level_number, level_name, hourly_rate_min').order('level_number'),
            ]);

            setData({
                organizations: orgsRes.data || [],
                departments: deptsRes.data || [],
                subDepartments: subDeptsRes.data || [],
                roles: rolesRes.data || [],
                remLevels: remLevelsRes.data || [],
            });
            setIsLoaded(true);
        } catch (error) {
            console.error('Error loading reference data:', error);
            toast({ title: 'Error', description: 'Failed to load form options', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [isLoaded, isLoading, toast]);

    useEffect(() => {
        if (shouldLoad && !isLoaded) {
            loadReferenceData();
        }
    }, [shouldLoad, isLoaded, loadReferenceData]);

    return {
        ...data,
        isLoading,
        loadReferenceData
    };
};
