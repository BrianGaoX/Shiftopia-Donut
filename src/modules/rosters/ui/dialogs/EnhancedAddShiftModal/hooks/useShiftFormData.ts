import React from 'react';
import {
    useRoles,
    useRemunerationLevels,
    useEmployees,
    useSkills,
    useLicenses,
    useEvents,
    useRostersLookup,
    useRosterStructure,
    useShiftsByDate,
} from '@/modules/rosters/state/useRosterShifts';
import type {
    Role,
    RemunerationLevel,
    Employee,
    Skill,
    License,
    Event,
    Roster,
    ShiftContext
} from '../types';

const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT: any = {};

interface UseShiftFormDataProps {
    isOpen: boolean;
    context: ShiftContext;
    editMode: boolean;
    existingShift?: any;
    selectedRosterId: string;
    setSelectedRosterId: (id: string) => void;
    selectedV8RoleId?: string;
    selectedSkills?: string[];
    selectedLicenses?: string[];
}

interface UseShiftFormDataReturn {
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    employees: Employee[];
    skills: Skill[];
    licenses: License[];
    events: Event[];
    rosters: Roster[];
    rosterStructure: { groupType: string; subGroupName: string }[];
    activeSubGroups: Record<string, string[]>;
    isLoadingData: boolean;
}

export function useShiftFormData({
    isOpen,
    context,
    editMode,
    existingShift,
    selectedRosterId,
    setSelectedRosterId,
    selectedV8RoleId,
    selectedSkills,
    selectedLicenses,
}: UseShiftFormDataProps): UseShiftFormDataReturn {
    // Determine correct IDs for fetching roles
    // 1. Context IDs (from props/existing shift) - used for fetching generic data
    const contextDeptId = (editMode && existingShift?.department_id) || context.departmentId;
    const contextSubDeptId = (editMode && existingShift?.sub_department_id) || context.subDepartmentId;

    // 2. Fetch Rosters first (to potentialy resolve department context)
    const { data: rosters = EMPTY_ARRAY, isLoading: isLoadingRosters } = useRostersLookup(
        isOpen ? context.organizationId : undefined,
        {
            departmentId: isOpen ? contextDeptId : undefined,
            departmentIds: isOpen ? context.departmentIds : undefined,
            subDepartmentId: isOpen ? contextSubDeptId : undefined,
            subDepartmentIds: isOpen ? context.subDepartmentIds : undefined,
        }
    );

    // Note: previous debug logs here serialized the entire rosters array on
    // every effect run, which showed up as 100+ ms of main-thread work on
    // modal open in dev mode. Drop them — TanStack Devtools is the right
    // surface for this kind of inspection.

    // 3. Metadata Hooks (Restored)
    // 3. Metadata Hooks (Restored)
    const { data: remunerationLevels = EMPTY_ARRAY, isLoading: isLoadingRem } = useRemunerationLevels();
    const { data: skills = EMPTY_ARRAY, isLoading: isLoadingSkills } = useSkills();
    const { data: licenses = EMPTY_ARRAY, isLoading: isLoadingLicenses } = useLicenses();
    // Events are org-scoped. Calling useEvents() with no orgId here fetched
    // every event in the system on every modal open — confirmed via DevTools
    // INP trace (~100 ms of network + parse on the click handler).
    const { data: events = EMPTY_ARRAY, isLoading: isLoadingEvents } = useEvents(
        isOpen ? context.organizationId : undefined,
    );

    // 4. Derive Role Context - Prefer specific roster context if available, fallback to global context
    const selectedRoster = rosters.find(r => r.id === (selectedRosterId || context.rosterId));

    // If context.departmentId is missing (e.g. "All Departments" view), use the roster's department
    // This fixes the issue where "All Roles" are shown because departmentId is undefined
    const roleDeptId = contextDeptId || selectedRoster?.department_id;
    const roleSubDeptId = contextSubDeptId || selectedRoster?.sub_department_id;

    const { data: employees = EMPTY_ARRAY, isLoading: isLoadingEmps } = useEmployees(
        isOpen ? context.organizationId : undefined,
        isOpen ? roleDeptId : undefined,
        isOpen ? roleSubDeptId : undefined,
        isOpen ? selectedV8RoleId : undefined,
        undefined, // searchTerm
        undefined, // limit
        isOpen ? selectedSkills : undefined,
        isOpen ? selectedLicenses : undefined
    );

    // All queries are enabled only when the modal is open
    const { data: roles = EMPTY_ARRAY } = useRoles(
        isOpen ? context.organizationId : undefined,
        isOpen ? roleDeptId : undefined,
        isOpen ? roleSubDeptId : undefined
    );
    const { data: rosterStructure = EMPTY_ARRAY } = useRosterStructure(selectedRosterId || context.rosterId);

    // 5. Active Sub-Groups Detection
    // Hint UI used only by the CREATE flow to show "this subgroup already has
    // shifts on this date". For EDIT mode the user is operating on an existing
    // shift, so skip the fetch entirely — it's a per-modal-open network call
    // for data that the parent page's byDateRange cache often already covers.
    const { data: existingShifts = EMPTY_ARRAY } = useShiftsByDate(
        isOpen && !editMode ? context.organizationId ?? null : null,
        isOpen && !editMode ? context.date || null : null,
    );

    // activeSubGroups is now a mapping of groupType -> uniqueSubGroupNames[]
    const activeSubGroups = React.useMemo(() => {
        if (!existingShifts.length) return EMPTY_OBJECT;

        const mapping: Record<string, Set<string>> = {};

        existingShifts
            .filter(s => s.roster_id === (selectedRosterId || context.rosterId) && s.sub_group_name && (s.group_type || (s as any).group_name))
            .forEach(s => {
                const rawGroup = s.group_type || (s as any).group_name!;
                const groupType = rawGroup.toLowerCase().replace(/\s+/g, '_');
                if (!mapping[groupType]) mapping[groupType] = new Set();
                mapping[groupType].add(s.sub_group_name!);
            });

        // Convert Sets to Arrays
        const result: Record<string, string[]> = {};
        Object.keys(mapping).forEach(key => {
            result[key] = Array.from(mapping[key]);
        });

        return result;
    }, [existingShifts, selectedRosterId, context.rosterId]);

    // Auto-select roster matching the date
    React.useEffect(() => {
        // Condition 1: Context specifies a roster ID (Strongest constraint)
        if (context.rosterId) {
            // Only select if it matches the requested ID. 
            // If it's not in the list yet (race condition), we wait. 
            // We DO NOT fall back to other matching rosters to avoid selecting Templates or other incorrect rosters.
            if (!selectedRosterId || selectedRosterId !== context.rosterId) {
                const target = rosters.find(r => r.id === context.rosterId);
                if (target) {
                    setSelectedRosterId(target.id);
                }
            }
            return;
        }

        // Condition 2: No specific roster requested, try to find one for the date
        // Only run if we don't have a selection yet
        if (!selectedRosterId && rosters.length > 0 && context.date) {
            // Find roster strictly containing the date
            // Prefer rosters matching the current sub-department context if available
            const matchingRoster = rosters.find(r => {
                const dateMatch = context.date! >= r.start_date && context.date! <= r.end_date;
                if (!dateMatch) return false;

                // If we have a sub-department context, prefer rosters matching it
                if (contextSubDeptId && r.sub_department_id === contextSubDeptId) return true;

                // If no sub-department context or no specific match, first one wins
                return true;
            });

            if (matchingRoster) {
                setSelectedRosterId(matchingRoster.id);
            }
        }
    }, [rosters, selectedRosterId, context.rosterId, context.date, contextSubDeptId, setSelectedRosterId]);

    const isLoadingData = isLoadingRem || isLoadingEmps || isLoadingSkills || isLoadingLicenses || isLoadingEvents || isLoadingRosters;

    return {
        roles: roles as Role[],
        remunerationLevels: remunerationLevels as RemunerationLevel[],
        employees: employees as Employee[],
        skills: skills as Skill[],
        licenses: licenses as License[],
        events: events as Event[],
        rosters: rosters as Roster[],
        rosterStructure,
        activeSubGroups,
        isLoadingData,
    };
}
