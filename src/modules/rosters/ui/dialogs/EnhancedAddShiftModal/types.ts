import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { ShiftTimeRange, HardValidationResult, ComplianceResult } from '@/modules/compliance';
import type { UseCompliancePanelReturn } from '@/modules/compliance/ui/useCompliancePanel';

/* ============================================================
   FORM SCHEMA
   ============================================================ */
export const formSchema = z.object({
    group_type: z.string().min(1, 'Group is required'),
    sub_group_name: z.string().min(1, 'Sub-group is required'),
    role_id: z.string().min(1, 'Role is required'),
    remuneration_level_id: z.string().optional(),
    shift_date: z.date().optional(),
    start_time: z.string().min(1, 'Start time is required'),
    end_time: z.string().min(1, 'End time is required'),
    paid_break_minutes: z.number().min(0).optional(),
    unpaid_break_minutes: z.number().min(0).optional(),
    timezone: z.string().default('Australia/Sydney'),
    assigned_employee_id: z.string().optional().nullable(),
    required_skills: z.array(z.string()).optional(),
    required_licenses: z.array(z.string()).optional(),
    event_ids: z.array(z.string()).optional(),
    notes: z.string().optional(),
    is_training: z.boolean().optional(),
});

export type FormValues = z.infer<typeof formSchema>;

/* ============================================================
   CONTEXT INTERFACE
   ============================================================ */
export interface ShiftContext {
    mode?: 'group' | 'people' | 'events' | 'roles' | 'template';
    launchSource?: 'grid' | 'global' | 'edit';
    date?: string;
    organizationId?: string;
    organizationName?: string;
    departmentId?: string;
    departmentName?: string;
    subDepartmentId?: string;
    subDepartmentName?: string;
    departmentIds?: string[];
    subDepartmentIds?: string[];
    groupId?: string;
    groupName?: string;
    subGroupId?: string;
    subGroupName?: string;
    groupColor?: string;
    group_type?: string;
    sub_group_name?: string;
    employeeId?: string;
    roleId?: string;
    remunerationLevelId?: string;
    rosterId?: string;
    eventStartTime?: string;
    eventEndTime?: string;
    eventId?: string;
}

export interface EnhancedAddShiftModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    context?: ShiftContext | null;
    isTemplateMode?: boolean;
    editMode?: boolean;
    existingShift?: any;
    onShiftCreated?: (shiftData: any) => void;
}

/* ============================================================
   DATA TYPES
   ============================================================ */
export interface Role {
    id: string;
    name: string;
    remuneration_level_id?: string;
}

export interface RemunerationLevel {
    id: string;
    level_name: string;
    hourly_rate_min: number;
    hourly_rate_max?: number;
}

export interface Employee {
    id: string;
    first_name: string;
    last_name: string;
    full_name?: string;
    profiles?: { full_name?: string };
}

export interface Skill {
    id: string;
    name: string;
}

export interface License {
    id: string;
    name: string;
}

export interface Event {
    id: string;
    name: string;
}

export interface Roster {
    id: string;
    name: string;
    description?: string;
    start_date: string;
    end_date: string;
    department_id?: string;
    status?: string;
    sub_department_id?: string;
    groups?: {
        id: string;
        name: string;
        external_id?: string;
        subGroups: {
            id: string;
            name: string;
        }[]
    }[];
}

export interface ShiftFormData {
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    employees: Employee[];
    skills: Skill[];
    licenses: License[];
    events: Event[];
    rosters: Roster[];
    isLoading: boolean;
}

/* ============================================================
   STEP TYPES
   ============================================================ */
export interface StepProps {
    form: any;
    isReadOnly: boolean;
    isLoadingData: boolean;
    isTemplateMode: boolean;
}

export interface ShiftFormDrawerContentProps {
    form: ReturnType<typeof useForm<FormValues>>;
    isReadOnly: boolean;
    isPast?: boolean;
    isStarted?: boolean;
    isPublished?: boolean;
    isTemplateMode: boolean;
    editMode: boolean;
    existingShift?: any;
    
    // Data
    roles: any[];
    remunerationLevels: any[];
    employees: any[];
    skills: any[];
    licenses: License[];
    events: Event[];
    rosters: any[];
    rosterStructure: any;
    activeSubGroups: any[];
    isLoadingData: boolean;
    isLoadingShifts: boolean;
    isGroupLocked: boolean;
    isSubGroupLocked: boolean;

    // Derived / Computed
    resolvedContext: any;
    selectedRosterId: string;
    setSelectedRosterId: (id: string) => void;
    shiftLength: number;
    netLength: number;
    hardValidation: any;
    isAssignmentEnabled: boolean;
    minShiftHours: number;

    // Compliance
    compliancePanel: any;
    runV2Compliance: () => void;
    
    // Handlers
    onUnpublish?: () => void;
    canUnpublish?: boolean;

    selectedRemLevel?: RemunerationLevel;
    isRoleLocked?: boolean;
    isEmployeeLocked?: boolean;
    isScheduleDefined: boolean;

    /** Active wizard step (1 Details · 2 Assignment · 3 Compliance) */
    currentStep: number;
    /** Jump to a step (used by the in-drawer stepper rail) */
    onStepChange?: (step: number) => void;
    /** Which steps the user has completed (for the stepper checkmarks) */
    completedSteps?: Set<number>;
}

export interface ScheduleStepProps extends StepProps {
    shiftLength: number;
    netLength: number;
    hardValidation: any;
    rosters: any[];
    rosterStructure: any[];
    selectedRosterId: string;
    onRosterChange: (id: string) => void;
    isGroupLocked?: boolean;
    isSubGroupLocked?: boolean;
    isRosterLocked?: boolean;
    context?: ShiftContext | null;
    activeSubGroups?: Record<string, any>;
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    skills: Skill[];
    licenses: License[];
    events: Event[];
    selectedRemLevel?: RemunerationLevel;
    isRoleLocked?: boolean;
}

export interface RoleStepProps extends StepProps {
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    employees: Employee[];
    existingShift?: any;
    netLength: number;
    selectedRemLevel?: any;
    safeContext?: ShiftContext;
    isRoleLocked?: boolean;
    isEmployeeLocked?: boolean;
}

export interface BreakStepProps extends StepProps {
    shiftLength: number;
}

export interface RequirementsStepProps extends StepProps {
    skills: Skill[];
    licenses: License[];
    events: Event[];
}

export interface ComplianceStepProps {
    isTemplateMode: boolean;
    watchEmployeeId: string | null | undefined;
    compliancePanel: UseCompliancePanelReturn;
}

export interface AssignmentStepProps {
    form: any;
    isReadOnly: boolean;
    isLoadingData: boolean;
    isTemplateMode: boolean;
    employees: Employee[];
    isEmployeeLocked?: boolean;
    existingShift?: any;
    // Compliance
    watchEmployeeId: string | null | undefined;
    hardValidation: HardValidationResult;
    compliancePanel: UseCompliancePanelReturn;
    /** v1 per-employee compliance runner for hover/inspect flow */
    runChecks: (overrideEmployeeId?: string) => Promise<void>;
    clearResults: () => void;
}
