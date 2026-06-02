// src/modules/planning/ui/views/OpenBidsView/hooks/useHierarchyData.ts

import { useState, useEffect } from 'react';
import { supabase } from '@/platform/realtime/client';
import type { Organization, Department, SubDepartment } from '@/modules/rosters/domain/queries/getOrgHierarchy.query';

interface UseHierarchyDataReturn {
  organizations: Organization[];
  departments: Department[];
  subDepartments: SubDepartment[];
  isLoading: boolean;
}

export function useHierarchyData(): UseHierarchyDataReturn {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchHierarchy = async () => {
      setIsLoading(true);
      try {
        const [orgsResult, deptsResult, subDeptsResult] = await Promise.all([
          supabase.from('organizations').select('id, name'),
          supabase.from('departments').select('id, name, organization_id'),
          supabase.from('sub_departments').select('id, name, department_id'),
        ]);

        if (orgsResult.data) setOrganizations(orgsResult.data as any);
        if (deptsResult.data) setDepartments(deptsResult.data as any);
        if (subDeptsResult.data) setSubDepartments(subDeptsResult.data as any);
      } catch (error) {
        console.error('Failed to load hierarchy data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHierarchy();
  }, []);

  return {
    organizations,
    departments,
    subDepartments,
    isLoading,
  };
}
