/**
 * OrgSelectionContext
 *
 * Manages organizational hierarchy selection state based on the user's Access Certificate.
 *
 * Access Level Rules:
 * - epsilon: org=locked, dept=SELECT, subdept=SELECT (from selected dept)
 * - delta:   org=locked, dept=locked, subdept=SELECT (from locked dept)
 * - gamma:   org=locked, dept=locked, subdept=locked
 * - beta:    org=locked, dept=locked, subdept=locked
 * - alpha:   org=locked, dept=locked, subdept=locked
 *
 * This context provides the "effective" filter values that pages should use for data queries.
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { useAuth } from '@/platform/auth/useAuth';
import type { AccessLevel } from '@/platform/auth/types';

interface Department {
    id: string;
    name: string;
}

interface SubDepartment {
    id: string;
    name: string;
    departmentId: string;
}

interface OrgSelectionState {
    // The effective filter values - use these for data queries
    organizationId: string | null;
    departmentId: string | null;
    subDepartmentId: string | null;

    // Display names for the UI
    organizationName: string | null;
    departmentName: string | null;
    subDepartmentName: string | null;

    // What's locked vs selectable based on access level
    isOrgLocked: boolean;
    isDeptLocked: boolean;
    isSubDeptLocked: boolean;

    // Access level from certificate
    accessLevel: AccessLevel | null;

    // Available options for selectable levels
    availableDepartments: Department[];
    availableSubDepartments: SubDepartment[];

    // Loading states
    isLoadingDepartments: boolean;
    isLoadingSubDepartments: boolean;

    // Selection methods (only work for unlocked levels)
    selectDepartment: (id: string | null) => void;
    selectSubDepartment: (id: string | null) => void;

    // Whether selections are complete (for pages that require full selection)
    hasCompleteSelection: boolean;
}

const OrgSelectionContext = createContext<OrgSelectionState | null>(null);

export const useOrgSelection = (): OrgSelectionState => {
    const context = useContext(OrgSelectionContext);
    if (!context) {
        throw new Error('useOrgSelection must be used within an OrgSelectionProvider');
    }
    return context;
};

export const OrgSelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { accessScope } = useAuth();

    // Selection state for unlocked levels
    const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
    const [selectedSubDeptId, setSelectedSubDeptId] = useState<string | null>(null);

    // Determine what's locked based on access level
    // epsilon: can select dept + subdept
    // delta: dept locked, can select subdept
    // gamma/beta/alpha: everything locked
    const canSelectDept = accessScope?.accessLevel === 'epsilon';
    const canSelectSubDept = accessScope?.accessLevel === 'epsilon' || accessScope?.accessLevel === 'delta';

    // The dept ID to use for fetching subdepts
    // For epsilon: use selected dept
    // For delta: use locked dept from certificate
    const effectiveDeptIdForSubDepts = canSelectDept
        ? selectedDeptId
        : accessScope?.departmentId;

    // Fetch departments for epsilon users
    const { data: departments = [], isLoading: isLoadingDepartments } = useQuery({
        queryKey: ['org-selection-departments', accessScope?.organizationId],
        queryFn: async () => {
            if (!accessScope?.organizationId) return [];
            const { data, error } = await supabase
                .from('departments')
                .select('id, name')
                .eq('organization_id', accessScope.organizationId)
                .order('name');
            if (error) {
                console.error('[OrgSelection] Failed to fetch departments:', error);
                return [];
            }
            return (data || []) as Department[];
        },
        enabled: canSelectDept && !!accessScope?.organizationId,
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });

    // Fetch subdepartments for epsilon/delta users
    const { data: subDepartments = [], isLoading: isLoadingSubDepartments } = useQuery({
        queryKey: ['org-selection-subdepartments', effectiveDeptIdForSubDepts],
        queryFn: async () => {
            if (!effectiveDeptIdForSubDepts) return [];
            const { data, error } = await supabase
                .from('sub_departments')
                .select('id, name, department_id')
                .eq('department_id', effectiveDeptIdForSubDepts)
                .order('name');
            if (error) {
                console.error('[OrgSelection] Failed to fetch subdepartments:', error);
                return [];
            }
            return (data || []).map(sd => ({
                id: sd.id,
                name: sd.name,
                departmentId: sd.department_id,
            })) as SubDepartment[];
        },
        enabled: canSelectSubDept && !!effectiveDeptIdForSubDepts,
        staleTime: 5 * 60 * 1000,
    });

    // Reset subdept selection when dept changes (for epsilon users)
    useEffect(() => {
        if (canSelectDept) {
            setSelectedSubDeptId(null);
        }
    }, [selectedDeptId, canSelectDept]);

    // Get display name for selected department
    const selectedDeptName = useMemo(() => {
        if (!canSelectDept) return accessScope?.departmentName || null;
        if (!selectedDeptId) return null;
        return departments.find(d => d.id === selectedDeptId)?.name || null;
    }, [canSelectDept, selectedDeptId, departments, accessScope?.departmentName]);

    // Get display name for selected subdepartment
    const selectedSubDeptName = useMemo(() => {
        if (!canSelectSubDept) return accessScope?.subDepartmentName || null;
        if (!selectedSubDeptId) return null;
        return subDepartments.find(sd => sd.id === selectedSubDeptId)?.name || null;
    }, [canSelectSubDept, selectedSubDeptId, subDepartments, accessScope?.subDepartmentName]);

    // Selection handlers
    const selectDepartment = useCallback((id: string | null) => {
        if (canSelectDept) {
            setSelectedDeptId(id);
        }
    }, [canSelectDept]);

    const selectSubDepartment = useCallback((id: string | null) => {
        if (canSelectSubDept) {
            setSelectedSubDeptId(id);
        }
    }, [canSelectSubDept]);

    // Calculate effective filter values
    const effectiveOrgId = accessScope?.organizationId || null;

    const effectiveDeptId = canSelectDept
        ? selectedDeptId
        : accessScope?.departmentId || null;

    const effectiveSubDeptId = canSelectSubDept
        ? selectedSubDeptId
        : accessScope?.subDepartmentId || null;

    // Check if selection is complete
    // For epsilon: need dept selected (subdept optional but recommended)
    // For delta: need subdept selected
    // For others: always complete (locked)
    const hasCompleteSelection = useMemo(() => {
        if (!accessScope) return false;

        if (canSelectDept && !selectedDeptId) return false;
        if (canSelectSubDept && !selectedSubDeptId) return false;

        return true;
    }, [accessScope, canSelectDept, canSelectSubDept, selectedDeptId, selectedSubDeptId]);

    const value: OrgSelectionState = {
        organizationId: effectiveOrgId,
        departmentId: effectiveDeptId,
        subDepartmentId: effectiveSubDeptId,

        organizationName: accessScope?.organizationName || null,
        departmentName: selectedDeptName,
        subDepartmentName: selectedSubDeptName,

        isOrgLocked: true, // Always locked
        isDeptLocked: !canSelectDept,
        isSubDeptLocked: !canSelectSubDept,

        accessLevel: accessScope?.accessLevel || null,

        availableDepartments: departments,
        availableSubDepartments: subDepartments,

        isLoadingDepartments,
        isLoadingSubDepartments,

        selectDepartment,
        selectSubDepartment,

        hasCompleteSelection,
    };

    return (
        <OrgSelectionContext.Provider value={value}>
            {children}
        </OrgSelectionContext.Provider>
    );
};

export default OrgSelectionContext;
