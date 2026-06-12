/**
 * useShiftFormOrchestrator
 *
 * Owns all business logic for the EnhancedAddShiftModal:
 *   - form setup + watchers
 *   - context resolution (UUID lookup from names)
 *   - read-only & lock rules
 *   - step navigation wiring
 *   - compliance lifecycle (v2 engine)
 *   - create / update submission
 *
 * The modal component itself becomes a pure rendering layer that
 * spreads these values into its JSX.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { isEqual } from 'lodash';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, startOfDay, parse, getDay } from 'date-fns';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useCreateShift, useUpdateShift, useUnpublishShift } from '@/modules/rosters/state/useRosterShifts';
import { formatInTimezone, isPastInTimezone, isPublicHoliday, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';
import type { TemplateGroupType } from '@/modules/rosters/domain/shift.entity';
import { calculateShiftLength, isDateInPast, isShiftStarted } from '../utils';
import { formSchema, FormValues, EnhancedAddShiftModalProps, ShiftContext } from '../types';
import { useShiftFormData } from './useShiftFormData';
import { useHardValidation } from './useHardValidation';
import { useComplianceRunner } from './useComplianceRunner';
import { runV8Orchestrator } from '@/modules/compliance/v8';
import { buildAssignInput, buildSkeletonInput } from '@/modules/planning/unified/compliance/input-builder';
import type { V8OrchestratorInput, V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';
import { useCompliancePanel } from '@/modules/compliance/ui/useCompliancePanel';
import type { UseCompliancePanelReturn } from '@/modules/compliance/ui/useCompliancePanel';
import { fetchV8EmployeeContext } from '@/modules/compliance/employee-context';
import { getAvailabilityView } from '@/modules/availability/api/availability-view.api';

const SYDNEY_TZ = 'Australia/Sydney';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShiftFormOrchestrator({
    isOpen,
    onClose,
    onSuccess,
    context,
    isTemplateMode = false,
    editMode = false,
    existingShift,
    onShiftCreated,
}: EnhancedAddShiftModalProps) {
    const safeContext = context ?? {};
    const { toast } = useToast();
    const { scopeTree } = useScopeFilter('managerial');

    // ── Mutations ────────────────────────────────────────────────────────────
    const createShiftMutation = useCreateShift();
    const updateShiftMutation = useUpdateShift();
    const isLoading = createShiftMutation.isPending || updateShiftMutation.isPending;

    // ── Local UI state ───────────────────────────────────────────────────────
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [selectedRosterId, setSelectedRosterId] = useState<string>(safeContext.rosterId || '');

    // ── Compliance state ─────────────────────────────────────────────────────
    const [complianceHasRun, setComplianceHasRun] = useState(false);
    const [complianceNeedsRerun, setComplianceNeedsRerun] = useState(false);
    const [complianceResults, setComplianceResults] = useState<Record<string, any>>({});

    // Stable setter with equality guard (takes full results map)
    const setComplianceResultsWithGuard = useCallback((results: Record<string, any>) => {
        setComplianceResults(prev => {
            if (isEqual(prev, results)) return prev;
            return results;
        });
    }, []);

    // ── Form ─────────────────────────────────────────────────────────────────
    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            paid_break_minutes: undefined,
            unpaid_break_minutes: undefined,
            timezone: SYDNEY_TZ,
            assigned_employee_id: safeContext.employeeId || null,
            required_skills: [],
            required_licenses: [],
            event_ids: [],
            notes: '',
            group_type: (safeContext.group_type || safeContext.groupName?.toLowerCase().replace(/\s+/g, '_')) as FormValues['group_type'],
            sub_group_name: safeContext.sub_group_name || safeContext.subGroupName || '',
        },
    });

    // ── Watchers ─────────────────────────────────────────────────────────────
    const watchStart = form.watch('start_time');
    const watchEnd = form.watch('end_time');
    const watchUnpaidBreak = form.watch('unpaid_break_minutes');
    const watchV8RoleId = form.watch('role_id');
    const watchSkills = form.watch('required_skills');
    const watchLicenses = form.watch('required_licenses');
    const watchEmployeeId = form.watch('assigned_employee_id');
    const watchShiftDate = form.watch('shift_date');
    const watchRemLevel = form.watch('remuneration_level_id');
    const watchTimezone = form.watch('timezone') || SYDNEY_TZ;
    const watchGroup = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchIsTraining = form.watch('is_training');

    // ── Data hooks ───────────────────────────────────────────────────────────
    const {
        roles,
        remunerationLevels,
        employees,
        skills,
        licenses,
        events,
        rosters,
        rosterStructure,
        activeSubGroups,
        isLoadingData,
    } = useShiftFormData({
        isOpen,
        context: safeContext,
        editMode,
        existingShift,
        selectedRosterId,
        setSelectedRosterId,
        selectedV8RoleId: watchV8RoleId,
        selectedSkills: watchSkills,
        selectedLicenses: watchLicenses,
    });

    // ── Context resolution ───────────────────────────────────────────────────
    // Translate string names from the grid launch context into DB UUIDs using
    // the scope tree + loaded roster groups.
    const resolvedContext = useMemo((): ShiftContext => {
        const orgId = safeContext.organizationId;
        const deptId = safeContext.departmentId || safeContext.departmentIds?.[0];
        const subDeptId = safeContext.subDepartmentId || safeContext.subDepartmentIds?.[0];

        const orgInfo = scopeTree?.organizations?.find(o => o.id === orgId);

        const roster = rosters.find(r => r.id === (selectedRosterId || safeContext.rosterId));

        let groupId = isValidUuid(safeContext.groupId) ? safeContext.groupId : null;
        let subGroupId = isValidUuid(safeContext.subGroupId) ? safeContext.subGroupId : null;

        if (roster && (safeContext.groupName || safeContext.group_type) && !groupId) {
            const searchName = safeContext.groupName?.trim().toLowerCase();
            const searchType = safeContext.group_type;

            const group = roster.groups?.find(g => {
                if (searchType && g.external_id === searchType) return true;
                if (!searchName) return false;
                const dbName = g.name.trim().toLowerCase();
                return dbName === searchName || dbName.replace(/\s+/g, '_') === searchName;
            });

            if (group) {
                groupId = group.id;
                if (safeContext.subGroupName && !subGroupId) {
                    const sub = safeContext.subGroupName.trim().toLowerCase();
                    const found = group.subGroups?.find(sg => {
                        const dbSub = sg.name.trim().toLowerCase();
                        return dbSub === sub || dbSub.replace(/\s+/g, '_') === sub;
                    });
                    if (found) subGroupId = found.id;
                }
            }
        }

        const effectiveDeptId = roster ? (roster.department_id || null) : deptId;
        const effectiveSubDeptId = roster ? (roster.sub_department_id || null) : subDeptId;
        const effectiveDeptInfo = orgInfo?.departments?.find(d => d.id === effectiveDeptId);
        const effectiveSubDeptInfo = effectiveDeptInfo?.subdepartments?.find(sd => sd.id === effectiveSubDeptId);

        // For people/roles modes: the user selects a group from the dropdown — resolve
        // its UUID from the current form value so the submit payload carries the right IDs.
        if (!groupId && watchGroup) {
            const activeRoster = rosters.find(r => r.id === (selectedRosterId || safeContext.rosterId));
            const grp = activeRoster?.groups?.find(g =>
                g.external_id === watchGroup ||
                g.name.trim().toLowerCase().replace(/\s+/g, '_') === watchGroup,
            );
            if (grp) {
                groupId = grp.id;
                if (!subGroupId && watchSubGroupName) {
                    const sub = grp.subGroups?.find(sg =>
                        sg.name.trim().toLowerCase() === watchSubGroupName.trim().toLowerCase(),
                    );
                    if (sub) subGroupId = sub.id;
                }
            }
        }

        return {
            ...safeContext,
            organizationId: orgId,
            organizationName: orgInfo?.name || safeContext.organizationName,
            departmentId: effectiveDeptId ?? undefined,
            departmentName: effectiveDeptInfo?.name || (effectiveDeptId === null ? 'All Departments' : safeContext.departmentName),
            subDepartmentId: effectiveSubDeptId ?? undefined,
            subDepartmentName: effectiveSubDeptInfo?.name || (effectiveSubDeptId === null ? 'All Sub-Departments' : safeContext.subDepartmentName),
            groupId: groupId || (isValidUuid(safeContext.groupId) ? safeContext.groupId : undefined),
            subGroupId: subGroupId || (isValidUuid(safeContext.subGroupId) ? safeContext.subGroupId : undefined),
        };
    }, [scopeTree, rosters, selectedRosterId, safeContext, watchGroup, watchSubGroupName]);

    // ── Hard validation ──────────────────────────────────────────────────────
    const { hardValidation, employeeExistingShifts, studentVisaEnforcement, isLoadingShifts } = useHardValidation({
        watchStart,
        watchEnd,
        watchShiftDate,
        watchEmployeeId,
        isTemplateMode,
        existingV8ShiftId: existingShift?.id,
        timezone: watchTimezone,
    });

    // ── Computed values ──────────────────────────────────────────────────────
    const shiftLength = useMemo(
        () => calculateShiftLength(watchStart, watchEnd),
        [watchStart, watchEnd],
    );

    const netLength = useMemo(() => {
        const unpaid = watchUnpaidBreak || 0;
        return Math.max(0, shiftLength - unpaid / 60);
    }, [shiftLength, watchUnpaidBreak]);

    const selectedRemLevel = remunerationLevels.find(r => r.id === watchRemLevel);
    const minShiftHours = useMemo(() => {
        if (watchIsTraining) return 2.0;
        if (!watchShiftDate) return 3.0;
        const day = getDay(watchShiftDate);
        if (day === 0 || isPublicHoliday(watchShiftDate)) return 4.0;
        return 3.0;
    }, [watchIsTraining, watchShiftDate]);

    const isMinLengthValid = netLength >= minShiftHours;
    const isNetLengthValid = netLength > 0 && netLength <= 12 && isMinLengthValid;

    // ── Read-only checks ─────────────────────────────────────────────────────
    const isPast = useMemo(() => isDateInPast(watchShiftDate, watchTimezone), [watchShiftDate, watchTimezone]);
    const isStarted = useMemo(() => isShiftStarted(watchShiftDate, watchStart, watchTimezone), [watchShiftDate, watchStart, watchTimezone]);
    const isPublished = useMemo(() => !isTemplateMode && existingShift?.lifecycle_status === 'Published', [isTemplateMode, existingShift]);

    // Hard read-only ONLY for existing shifts or published shifts.
    // For NEW shifts, we allow the fields to be editable even if "past" so the user can fix their inputs.
    const isReadOnly = (editMode && (isPast || isStarted)) || isPublished;

    // ── Emergency assignment detection ───────────────────────────────────────
    // True when TTS ≤ 4h OR bidding closed without winner — assigning in this
    // state bypasses standard bidding and writes 'emergency_assigned' as outcome.
    const isEmergencyAssignment = useMemo(() => {
        if (!editMode || !existingShift) return false;
        if (existingShift.bidding_status === 'bidding_closed_no_winner') return true;
        if (watchShiftDate && watchStart) {
            const shiftDateStr = format(watchShiftDate, 'yyyy-MM-dd');
            const urgency = computeShiftUrgency(shiftDateStr, watchStart, existingShift.start_at ?? undefined);
            if (urgency === 'emergent') return true;
        }
        return false;
    }, [editMode, existingShift, watchShiftDate, watchStart]);

    // ── Unpublish eligibility (state-machine.md §8.1) ───────────────────────
    // Unpublish is allowed from: S3 (Offered), S5/S6 (OnBidding), S8 (BiddingClosedNoWinner)
    // Blocked for: S4 (Confirmed), S7 (EmergencyAssigned), InProgress, Completed, Cancelled
    const canUnpublish = useMemo(() => {
        if (!editMode || !existingShift || isTemplateMode || isPast || isStarted) return false;
        const lifecycle = existingShift.lifecycle_status;
        if (lifecycle !== 'Published') return false;
        const outcome = existingShift.assignment_outcome;
        const bidding = existingShift.bidding_status;
        // S4: Confirmed — blocked
        if (outcome === 'confirmed') return false;
        // S7: EmergencyAssigned — blocked
        if (outcome === 'emergency_assigned') return false;
        // S3: Offered — allowed
        if (outcome === 'offered') return true;
        // S5/S6: OnBidding — allowed
        if (bidding === 'on_bidding_normal' || bidding === 'on_bidding_urgent' || bidding === 'on_bidding') return true;
        // S8: BiddingClosedNoWinner — allowed
        if (bidding === 'bidding_closed_no_winner') return true;
        return false;
    }, [editMode, existingShift, isTemplateMode, isPast, isStarted]);

    // ── Roster / context locks ───────────────────────────────────────────────
    const isGridLaunch = safeContext.launchSource === 'grid';
    const isEditModeSource = safeContext.launchSource === 'edit';

    const hasDepartment = !!resolvedContext.departmentId;
    const derivedRosterId = selectedRosterId || safeContext.rosterId || (editMode ? existingShift?.roster_id : null);
    const hasRoster = !!derivedRosterId;

    const selectedRoster = useMemo(() => rosters.find(r => r.id === derivedRosterId), [rosters, derivedRosterId]);
    const isRosterActive = isTemplateMode || selectedRoster?.status === 'published' || selectedRoster?.status === 'draft';

    const isContextInherited = isGridLaunch || isEditModeSource;

    const isRosterLocked = isContextInherited && !!derivedRosterId;
    const isGroupLocked = (isContextInherited && (!!resolvedContext.groupId || !!resolvedContext.groupName || !!resolvedContext.group_type) && safeContext.mode === 'group')
        || (safeContext.mode === 'template' && (!!safeContext.groupName || !!safeContext.group_type));
    const isSubGroupLocked = (isContextInherited && (!!resolvedContext.subGroupId || !!resolvedContext.subGroupName) && safeContext.mode === 'group')
        || (safeContext.mode === 'template' && !!safeContext.subGroupName);
    const isRoleLocked = isContextInherited && safeContext.mode === 'roles' && !!safeContext.roleId;
    const isEmployeeLocked = isContextInherited && safeContext.mode === 'people' && !!safeContext.employeeId;

    // Assignment is disabled for templates (always unassigned) and in read-only modes.
    // In Group/Role modes, we allow selection even if times aren't set yet (though compliance will be pending).
    const isScheduleDefined = !!watchV8RoleId && (!!watchShiftDate || isTemplateMode) && !!watchStart && !!watchEnd;
    const isAssignmentEnabled = !isReadOnly && !isTemplateMode;

    // ── Effects ──────────────────────────────────────────────────────────────

    // Invalidate compliance whenever any scheduling input changes
    useEffect(() => {
        setComplianceNeedsRerun(true);
        setComplianceHasRun(false);
        compliancePanel.markStale();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        watchStart, watchEnd,
        watchShiftDate?.toISOString(),
        watchV8RoleId, watchEmployeeId,
        watchUnpaidBreak,
        watchIsTraining,
        // stringify to avoid object identity issues
        JSON.stringify(watchSkills),
        JSON.stringify(watchLicenses),
    ]);

    // Auto-select remuneration level when the chosen role has a default
    useEffect(() => {
        if (watchV8RoleId && roles.length > 0) {
            const role = roles.find(r => r.id === watchV8RoleId);
            if (role?.remuneration_level_id) {
                form.setValue('remuneration_level_id', role.remuneration_level_id);
            }
        }
    }, [watchV8RoleId, roles, form]);

    // Late-sync: role data may arrive after context propagates defaultValues
    useEffect(() => {
        if (isOpen && !editMode && safeContext.roleId && !watchV8RoleId && roles.length > 0) {
            const match = roles.find(r => r.id === safeContext.roleId);
            if (match) {
                form.setValue('role_id', match.id);
                if (match.remuneration_level_id) {
                    form.setValue('remuneration_level_id', match.remuneration_level_id);
                }
            }
        }
    }, [isOpen, editMode, safeContext.roleId, watchV8RoleId, roles, form]);

    // Reset on open / mode change
    useEffect(() => {
        if (!isOpen) return;

        if (editMode && existingShift) {
            form.reset({
                group_type: (existingShift.group_type || existingShift.groupName?.toLowerCase().replace(/\s+/g, '_') || safeContext.group_type || safeContext.groupName?.toLowerCase().replace(/\s+/g, '_')) as FormValues['group_type'] || undefined,
                sub_group_name: existingShift.sub_group_name || existingShift.subGroupName || safeContext.sub_group_name || safeContext.subGroupName || '',
                role_id: existingShift.role_id || existingShift.roleId || '',
                remuneration_level_id: existingShift.remuneration_level_id || existingShift.remunerationLevelId || '',
                shift_date: existingShift.shift_date ? startOfDay(parse(existingShift.shift_date, 'yyyy-MM-dd', new Date())) : undefined,
                start_time: existingShift.start_time || existingShift.startTime || '',
                end_time: existingShift.end_time || existingShift.endTime || '',
                paid_break_minutes: existingShift.paid_break_minutes ?? existingShift.paidBreakDuration ?? undefined,
                unpaid_break_minutes: existingShift.unpaid_break_minutes ?? existingShift.unpaidBreakDuration ?? undefined,
                timezone: existingShift.timezone || SYDNEY_TZ,
                assigned_employee_id: existingShift.assigned_employee_id || existingShift.assignedEmployeeId || null,
                required_skills: (existingShift.required_skills || existingShift.skills || []).map((s: any) => typeof s === 'object' && s ? s.id : s),
                required_licenses: (existingShift.required_licenses || existingShift.licenses || []).map((l: any) => typeof l === 'object' && l ? l.id : l),
                event_ids: existingShift.event_ids || [],
                notes: existingShift.notes || '',
                is_training: existingShift.is_training || false,
            });
            if (!selectedRosterId && existingShift.roster_id) {
                setSelectedRosterId(existingShift.roster_id);
            }
        } else {
            form.reset({
                group_type: (context?.group_type || context?.groupName?.toLowerCase().replace(/\s+/g, '_')) as FormValues['group_type'],
                sub_group_name: context?.sub_group_name || context?.subGroupName || '',
                role_id: context?.roleId || '',
                remuneration_level_id: context?.remunerationLevelId || '',
                shift_date: context?.date ? startOfDay(parse(context.date, 'yyyy-MM-dd', new Date())) : undefined,
                start_time: context?.eventStartTime || '',
                end_time: context?.eventEndTime || '',
                paid_break_minutes: undefined,
                unpaid_break_minutes: undefined,
                timezone: SYDNEY_TZ,
                assigned_employee_id: isTemplateMode ? null : (context?.employeeId || null),
                required_skills: [],
                required_licenses: [],
                event_ids: [],
                notes: '',
                is_training: false,
            });
        }// eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, editMode, existingShift, context, isTemplateMode]);

    // ── Compliance (v1 runner — used by AssignmentStep hover/select flow) ────
    const buildComplianceInput = useCallback(() => ({
        employee_id: watchEmployeeId || 'preview',
        action_type: 'add' as const,
        candidate_shift: {
            start_time: watchStart || '',
            end_time: watchEnd || '',
            shift_date: isTemplateMode
                ? formatInTimezone(new Date(), watchTimezone, 'yyyy-MM-dd')
                : (watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : formatInTimezone(new Date(), watchTimezone, 'yyyy-MM-dd')),
            unpaid_break_minutes: watchUnpaidBreak || 0,
        },
        existing_shifts: employeeExistingShifts,
        exclude_shift_id: existingShift?.id || undefined,
        overrideV8RoleId: watchV8RoleId || undefined,
        overrideSkillIds: watchSkills?.length ? watchSkills : undefined,
        overrideLicenseIds: watchLicenses?.length ? watchLicenses : undefined,
        candidate_is_training: watchIsTraining || false,
        student_visa_enforcement: studentVisaEnforcement,
    }), [watchEmployeeId, watchStart, watchEnd, watchShiftDate, watchUnpaidBreak, isTemplateMode, employeeExistingShifts, watchTimezone, existingShift?.id, watchV8RoleId, watchSkills, watchLicenses, watchIsTraining, studentVisaEnforcement]);

    const {
        runChecks,
        clearResults,
        isRunning: isComplianceRunning
    } = useComplianceRunner({
        buildComplianceInput,
        hardValidation,
        setComplianceResults: setComplianceResultsWithGuard,
        needsRerun: complianceNeedsRerun,
        setNeedsRerun: setComplianceNeedsRerun,
        setHasRun: setComplianceHasRun,
        shiftId: existingShift?.id,
    });

    // ── Compliance v2 engine integration ─────────────────────────────────────

    // Build the v2 V8OrchestratorInput from current form state.
    // Returns null if required fields are missing.
    const buildV2ComplianceInput = useCallback((): V8OrchestratorInput | null => {
        // Base requirements for any check: times and role.
        if (!watchStart || !watchEnd || !watchV8RoleId) {
            return null;
        }

        // Rostered shifts REQUIRE a date and an employee.
        // Templates do not (they use mocks if missing).
        if (!isTemplateMode && (!watchEmployeeId || !watchShiftDate)) {
            return null;
        }

        const shiftDateStr = watchShiftDate 
            ? format(watchShiftDate, 'yyyy-MM-dd') 
            : format(new Date(), 'yyyy-MM-dd');

        return {
            employee_id: watchEmployeeId ?? '',
            // employee_context is a placeholder — buildInputs replaces it with
            // the real context fetched from fetchV8EmployeeContext()
            employee_context: {
                employee_id:             watchEmployeeId || 'unassigned',
                contract_type:           'CASUAL',
                contracted_weekly_hours: 0,
                assigned_role_ids:       [],
                contracts:               [],
                qualifications:          [],
            },
            existing_shifts: (employeeExistingShifts || [])
                .filter((s: any) => {
                    // Only filter if we are in EDIT mode (existingShift has an ID)
                    if (!existingShift?.id) return true;
                    return s.shift_id !== existingShift.id && s.id !== existingShift.id;
                })
                .map((s: any) => ({
                    id: s.shift_id || s.id || String(Math.random()),
                    date: s.shift_date,
                    shift_date: s.shift_date,
                    start_time: (s.start_time || '').slice(0, 5),
                    end_time: (s.end_time || '').slice(0, 5),
                    role_id: s.role_id || watchV8RoleId || '',
                    required_qualifications: [],
                    is_ordinary_hours: s.is_ordinary_hours ?? true,
                    break_minutes: s.unpaid_break_minutes || 0,
                    unpaid_break_minutes: s.unpaid_break_minutes || 0,
                    is_training: s.is_training || false,
                })),
            candidate_changes: {
                add_shifts: [{
                    id:                existingShift?.id ?? `candidate-${Date.now()}`,
                    date:              shiftDateStr,
                    shift_date:        shiftDateStr,
                    start_time:        (watchStart || '').slice(0, 5),
                    end_time:          (watchEnd || '').slice(0, 5),
                    role_id:           watchV8RoleId,
                    // Org/dept hierarchy for R10 contract matching
                    organization_id:   resolvedContext.organizationId ?? undefined,
                    department_id:     resolvedContext.departmentId ?? undefined,
                    sub_department_id: resolvedContext.subDepartmentId ?? undefined,
                    required_qualifications: [],
                    is_ordinary_hours: true,
                    is_training: watchIsTraining || false,
                    break_minutes:     0,
                    unpaid_break_minutes: Number(watchUnpaidBreak) || 0,
                }],
                remove_shifts: existingShift?.id ? [existingShift.id] : [],
            },
            mode: 'SIMULATED',
            operation_type: 'ASSIGN',
            stage: 'DRAFT',
            // config: min_shift_hours is not a V8Config field; omit to avoid type error
            config: {},
        };
    }, [watchEmployeeId, watchStart, watchEnd, watchShiftDate, watchV8RoleId, watchUnpaidBreak, employeeExistingShifts, existingShift, resolvedContext, minShiftHours]);

    const compliancePanel = useCompliancePanel({
        buildInputs: useCallback(async () => {
            if (isLoadingShifts) throw new Error('Fetching employee information...');
            const input = buildV2ComplianceInput();
            
            if (!input) {
                // If the form is incomplete, don't throw a red error. 
                // Return a skeleton that the engine can process silently or that the UI can label as "Pending".
                const mockDateStr = watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
                return [{
                    employee_id: watchEmployeeId || 'incomplete',
                    employee_context: {
                        employee_id: watchEmployeeId || 'incomplete',
                        contract_type: 'CASUAL',
                        contracted_weekly_hours: 0,
                        assigned_role_ids: [],
                        contracts: [],
                        qualifications: [],
                    },
                    existing_shifts: [],
                    candidate_changes: {
                        add_shifts: [{
                            id: 'skeleton',
                            date: mockDateStr,
                            shift_date: mockDateStr,
                            start_time: watchStart || '09:00',
                            end_time: watchEnd || '17:00',
                            role_id: watchV8RoleId || 'unassigned',
                            is_ordinary_hours: true,
                            is_training: watchIsTraining || false,
                            break_minutes: 0,
                            unpaid_break_minutes: Number(watchUnpaidBreak) || 0,
                            required_qualifications: [],
                        }],
                        remove_shifts: [],
                    },
                    mode: 'SIMULATED',
                    operation_type: 'ASSIGN',
                    stage: 'DRAFT',
                }] as [V8OrchestratorInput];
            }
            // Fetch real employee context (contracts, qualifications, visa flag) from DB
            const employeeCtx = await fetchV8EmployeeContext(input.employee_id);

            // Fetch declared availability + assigned shifts so R_AVAILABILITY_MATCH can run
            let availabilityData: V8OrchestratorInput['availability_data'] | undefined;
            if (input.employee_id && watchShiftDate) {
                try {
                    const shiftDateStr = format(watchShiftDate, 'yyyy-MM-dd');
                    const avView = await getAvailabilityView(input.employee_id, shiftDateStr, shiftDateStr);
                    availabilityData = {
                        declared_slots: avView.declaredSlots.map(s => ({
                            slot_date:  s.slot_date,
                            start_time: s.start_time,
                            end_time:   s.end_time,
                        })),
                        assigned_shifts: avView.assignedShifts
                            // Exclude the shift being edited so we don't flag its own slot
                            .filter(s => s.id !== existingShift?.id)
                            .map(s => ({
                                id:         s.id,
                                date:       s.shift_date,
                                shift_date: s.shift_date,
                                start_time: s.start_time,
                                end_time:   s.end_time,
                                is_ordinary_hours: true,
                            })),
                    };
                } catch {
                    // Availability fetch failed — skip AV rule silently (don't block compliance)
                }
            }

            return [{ ...input, employee_context: employeeCtx, availability_data: availabilityData }] as [V8OrchestratorInput];
        }, [buildV2ComplianceInput, watchStart, watchEnd, watchShiftDate, watchV8RoleId, watchUnpaidBreak, existingShift?.id, minShiftHours, isLoadingShifts]),
        stage: 'DRAFT',
    });

    // ── Save guard ───────────────────────────────────────────────────────────
    // All four gates must pass for the Create Shift button to be enabled:
    //   1. Step 1 complete (schedule fields + valid duration)
    //   2. Hard validation (no time/overlap errors)
    //   3. Department + roster selected
    //   4. Compliance run and passed (skipped in template mode or unassigned)
    const canSave = useMemo(() => {
        if (isReadOnly) return false;
        // Required fields check
        const hasBaseFields = !!watchV8RoleId && (!!watchShiftDate || isTemplateMode) && !!watchStart && !!watchEnd && hasDepartment && (hasRoster || isTemplateMode);
        if (!hasBaseFields) return false;

        // Hard validation check
        if (!hardValidation.passed) return false;

        if (isTemplateMode) return true;

        // Compliance check
        if (compliancePanel.status !== 'results') return false;
        
        // If employee assigned, must pass all checks (including employee-specific)
        // If no employee, must pass shift-level checks (which are the only ones that run)
        return compliancePanel.canProceed;
    }, [watchV8RoleId, watchShiftDate, watchStart, watchEnd, hasDepartment, hasRoster, isTemplateMode, hardValidation.passed, compliancePanel.status, compliancePanel.canProceed]);

    // v2-powered "Run All" — replaces v1 rule runners in ComplianceTabContent.
    // Maps v2 V8Hit[] results back to the v1 ComplianceResult format so
    // existing rule card visualizations continue to work unchanged.
    const runV2Compliance = useCallback(async (): Promise<void> => {
        const v2Input = buildV2ComplianceInput();
        if (!v2Input) return;

        const v2Result = runV8Orchestrator(v2Input, { stage: 'DRAFT' }) as V8OrchestratorResult;
        const hits = v2Result.hits;
        const hitMap = new Map(hits.map(h => [h.rule_id.toUpperCase(), h]));

        // Map v2 rule IDs → v1 rule IDs used by ComplianceTabContent cards
        // R02 removed (duration validated in Step 1; training exemption handled there)
        // R09 removed (R04 is the authoritative work-pattern limit)
        // R12 removed (merged into R11 — single "qualifications" rule)
        const V2_TO_V1: Record<string, string> = {
            'R01_NO_OVERLAP':          'NO_OVERLAP',
            'R03_MAX_DAILY_HOURS':     'MAX_DAILY_HOURS',
            'R04_MAX_WORKING_DAYS':    'WORKING_DAYS_CAP',
            'R05_STUDENT_VISA':        'STUDENT_VISA_48H',
            'R06_ORD_HOURS_AVG':       'AVG_FOUR_WEEK_CYCLE',
            'R07_REST_GAP':            'MIN_REST_GAP',
            'R10_ROLE_CONTRACT_MATCH': 'ROLE_CONTRACT_MATCH',
            'R11_QUALIFICATIONS':      'QUALIFICATION_MATCH',
        };

        const delta = v2Result.delta_explanation;

        // Build a full v1 results map — one entry per mapped v1 rule ID.
        const newResults: Record<string, any> = {};

        Object.entries(V2_TO_V1).forEach(([v2Id, v1Id]) => {
            const hit = hitMap.get(v2Id);

            if (!hit) {
                // Rule passed — mark as pass with a minimal valid calculation
                newResults[v1Id] = {
                    rule_id: v1Id,
                    rule_name: v1Id.replace(/_/g, ' '),
                    status: 'pass',
                    summary: 'Check passed',
                    details: '',
                    calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                    blocking: false,
                };
            } else {
                // Rule fired — map severity to v1 status
                const isBlocking = hit.status === 'BLOCKING';

                // Build calculation object enriched for specific rule visualizations
                const calculation: Record<string, unknown> = {
                    existing_hours: delta?.before?.peak_daily_hours ?? 0,
                    candidate_hours: 0,
                    total_hours: delta?.after?.peak_daily_hours ?? 0,
                    limit: 12,
                };

                if (v1Id === 'WORKING_DAYS_CAP' && delta) {
                    calculation.days_worked = delta.after.working_days_28d;
                    calculation.limit = 20;
                    calculation.period_days = 28;
                } else if (v1Id === 'AVG_FOUR_WEEK_CYCLE' && delta) {
                    calculation.total_hours = delta.after.total_hours_28d;
                    calculation.limit = 38 * 4;
                    calculation.average_weekly_hours = delta.after.total_hours_28d / 4;
                }

                newResults[v1Id] = {
                    rule_id: v1Id,
                    rule_name: v1Id.replace(/_/g, ' '),
                    status: isBlocking ? 'fail' : 'warning',
                    summary: hit.summary,
                    details: hit.details || hit.summary,
                    calculation,
                    blocking: isBlocking,
                };
            }
        });

        // Commit all results atomically
        setComplianceResultsWithGuard(newResults);
        setComplianceHasRun(true);
        setComplianceNeedsRerun(false);
    }, [buildV2ComplianceInput, setComplianceResultsWithGuard, setComplianceHasRun, setComplianceNeedsRerun]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleComplianceComplete = useCallback(() => {
        setComplianceHasRun(true);
        setComplianceNeedsRerun(false);
    }, []);

    const handleCancel = useCallback(() => {
        if (form.formState.isDirty) {
            setShowCancelConfirm(true);
        } else {
            onClose();
        }
    }, [form.formState.isDirty, onClose]);

    const unpublishMutation = useUnpublishShift();

    const handleUnpublish = useCallback(async () => {
        if (!existingShift?.id || !canUnpublish) {
            toast({
                title: 'Cannot Unpublish',
                description: 'This shift cannot be unpublished from its current state.',
                variant: 'destructive',
            });
            return;
        }

        try {
            await unpublishMutation.mutateAsync({ shiftId: existingShift.id, reason: 'Unpublished via Edit Modal' });
            toast({
                title: 'Shift Unpublished',
                description: 'The shift has been reverted to Draft.',
            });
            onSuccess?.();
            onClose();
        } catch (err: any) {
            toast({
                title: 'Unpublish Failed',
                description: err?.message || 'Failed to unpublish shift.',
                variant: 'destructive',
            });
        }
    }, [existingShift?.id, canUnpublish, unpublishMutation, toast, onSuccess, onClose]);

    const handleSubmit = useCallback(async (values: FormValues) => {
        if (!canSave) {
            if (!hardValidation.passed) {
                toast({
                    title: 'Validation Failed',
                    description: hardValidation.errors.join('. ') || 'Hard validation failed.',
                    variant: 'destructive',
                });
            } else if (!isTemplateMode && !complianceHasRun) {
                toast({
                    title: 'Compliance Required',
                    description: 'Please run compliance checks before saving this shift.',
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Validation Error',
                    description: `Please check: ${!hasDepartment ? 'Department ' : ''}${!hasRoster ? 'Roster ' : ''}${!watchV8RoleId ? 'Role' : ''}`.trim(),
                    variant: 'destructive',
                });
            }
            return;
        }

        if (!resolvedContext.departmentId) {
            toast({ title: 'Missing Context', description: 'Department is required.', variant: 'destructive' });
            return;
        }

        const rosterId = selectedRosterId || resolvedContext.rosterId || existingShift?.roster_id;
        if (!rosterId && !isTemplateMode) {
            toast({ title: 'Missing Roster', description: 'Please select a roster.', variant: 'destructive' });
            return;
        }

        if (!isTemplateMode && values.shift_date && !editMode) {
            if (isPastInTimezone(values.shift_date, watchTimezone)) {
                toast({ title: 'Invalid Date', description: 'Cannot create shifts on past dates.', variant: 'destructive' });
                return;
            }
        }

        const onMutationSuccess = () => {
            toast({
                title: editMode ? 'Shift Updated' : 'Shift Created',
                description: `Shift ${editMode ? 'updated' : 'created'} for ${format(values.shift_date!, 'dd MMM yyyy')}`,
            });
            onSuccess?.();
            form.reset();
            onClose();
        };

        const onMutationError = (error: unknown) => {
            toast({
                title: 'Error',
                description: (error as Error)?.message || `Failed to ${editMode ? 'update' : 'create'} shift`,
                variant: 'destructive',
            });
        };

        try {
            if (isTemplateMode && onShiftCreated) {
                const role = roles.find(r => r.id === values.role_id);
                const remLevel = remunerationLevels.find(r => r.id === values.remuneration_level_id);
                const assignedEmployee = employees.find(e => e.id === values.assigned_employee_id);

                onShiftCreated({
                    name: role?.name || 'Shift',
                    role_id: values.role_id,
                    roleId: values.role_id,
                    roleName: role?.name,
                    remuneration_level_id: values.remuneration_level_id,
                    remunerationLevelId: values.remuneration_level_id,
                    remunerationLevel: remLevel?.level_name,
                    start_time: values.start_time,
                    startTime: values.start_time,
                    end_time: values.end_time,
                    endTime: values.end_time,
                    paid_break_minutes: values.paid_break_minutes || 0,
                    paidBreakDuration: values.paid_break_minutes || 0,
                    unpaid_break_minutes: values.unpaid_break_minutes || 0,
                    unpaidBreakDuration: values.unpaid_break_minutes || 0,
                    skills: values.required_skills || [],
                    licenses: values.required_licenses || [],
                    notes: values.notes,
                    netLength,
                    assigned_employee_id: values.assigned_employee_id || null,
                    assignedEmployeeId: values.assigned_employee_id || null,
                    assignedEmployeeName: assignedEmployee?.profiles?.full_name || assignedEmployee?.full_name || null,
                    // Groups/SubGroups are inherited by TemplateEditor but we pass them for completeness/UI
                    group_type: values.group_type,
                    sub_group_name: values.sub_group_name,
                    shift_group_id: resolvedContext.groupId,
                    shift_subgroup_id: resolvedContext.subGroupId,
                    is_training: values.is_training || false,
                });

                toast({ title: 'Shift Added' });
                onSuccess?.();
                form.reset();
                onClose();
            } else {
                const basePayload = {
                    roster_id: rosterId,
                    shift_date: format(values.shift_date!, 'yyyy-MM-dd'),
                    start_time: values.start_time,
                    end_time: values.end_time,
                    organization_id: resolvedContext.organizationId || null,
                    department_id: resolvedContext.departmentId,
                    sub_department_id: resolvedContext.subDepartmentId || null,
                    group_type: (values.group_type || (resolvedContext.groupName?.toLowerCase().replace(/\s+/g, '_') || null)) as TemplateGroupType | null,
                    sub_group_name: values.sub_group_name || resolvedContext.subGroupName || null,
                    shift_group_id: resolvedContext.groupId || null,
                    shift_subgroup_id: resolvedContext.subGroupId || null,
                    role_id: values.role_id || null,
                    remuneration_level_id: values.remuneration_level_id || null,
                    paid_break_minutes: values.paid_break_minutes || 0,
                    unpaid_break_minutes: values.unpaid_break_minutes || 0,
                    timezone: values.timezone,
                    assigned_employee_id: values.assigned_employee_id || null,
                    required_skills: values.required_skills || [],
                    required_licenses: values.required_licenses || [],
                    event_ids: values.event_ids || [],
                    notes: values.notes || null,
                    display_order: 0,
                    // Source tracking
                    creation_source: isTemplateMode ? 'template' : 'manual',
                    assignment_source: values.assigned_employee_id
                        ? (editMode ? 'manual' : 'direct')
                        : null,
                    // Emergency assignment — set when manager assigns within the 4H lockout
                    // or after bidding closed with no winner (bypasses standard bidding flow)
                    assignment_outcome: (values.assigned_employee_id
                        ? (isEmergencyAssignment ? 'emergency_assigned' : 'pending')
                        : null) as 'emergency_assigned' | 'pending' | null,
                    is_training: values.is_training ?? false,
                };

                // Calculate UTC canonical timestamps (start_at, end_at)
                const shiftDateStr = format(values.shift_date!, 'yyyy-MM-dd');
                const tzone = values.timezone || SYDNEY_TZ;
                const startAtDate = parseZonedDateTime(shiftDateStr, values.start_time, tzone);

                const [sh, sm] = values.start_time.split(':').map(Number);
                const [eh, em] = values.end_time.split(':').map(Number);
                const startMin = sh * 60 + sm;
                let endMin = eh * 60 + em;
                const isOvernight = endMin <= startMin;

                let endAtDate = parseZonedDateTime(shiftDateStr, values.end_time, tzone);
                if (isOvernight) {
                    endAtDate.setDate(endAtDate.getDate() + 1);
                }

                const basePayloadWithUtc = {
                    ...basePayload,
                    start_at: startAtDate.toISOString(),
                    end_at: endAtDate.toISOString(),
                };

                // Only include lifecycle_status for new shifts — updateShift ignores it
                // and including it causes the optimistic cache to flash wrong status.
                const payload = editMode
                    ? basePayloadWithUtc
                    : { ...basePayloadWithUtc, lifecycle_status: 'Draft' as const, fulfillment_status: (values.assigned_employee_id ? 'scheduled' : 'none') as 'scheduled' | 'none' };

                if (editMode && existingShift?.id) {
                    updateShiftMutation.mutate(
                        { shiftId: existingShift.id, updates: payload },
                        { onSuccess: onMutationSuccess, onError: onMutationError },
                    );
                } else {
                    createShiftMutation.mutate(
                        payload,
                        { onSuccess: onMutationSuccess, onError: onMutationError },
                    );
                }
            }
        } catch (error: unknown) {
            if (!editMode && !createShiftMutation.isPending && !updateShiftMutation.isPending) {
                toast({
                    title: 'Error',
                    description: (error as Error)?.message || 'An unexpected error occurred',
                    variant: 'destructive',
                });
            }
        }
    }, [
        canSave, hardValidation, hasDepartment, hasRoster, watchV8RoleId,
        resolvedContext, selectedRosterId, isTemplateMode, editMode, watchTimezone,
        onShiftCreated, roles, remunerationLevels, employees, netLength,
        onSuccess, form, onClose, createShiftMutation, updateShiftMutation,
        existingShift, toast, complianceHasRun, isEmergencyAssignment,
    ]);

    // ── Return ────────────────────────────────────────────────────────────────
    const exposedValues = {
        form,
        isLoading,

        // UI state
        showCancelConfirm,
        setShowCancelConfirm,

        // Data
        roles,
        remunerationLevels,
        employees,
        skills,
        licenses,
        events,
        rosters,
        rosterStructure,
        activeSubGroups,
        isLoadingData,

        // Resolved context for step props + header
        resolvedContext,
        safeContext,

        // Step navigation
        isAssignmentEnabled,

        // Computed values
        shiftLength,
        netLength,
        minShiftHours,
        isMinLengthValid,
        selectedRemLevel,

        // Lock state
        isRosterLocked,
        isGroupLocked,
        isSubGroupLocked,
        isRoleLocked,
        isEmployeeLocked,

        // Read-only
        isPast,
        isStarted,
        isPublished,
        isReadOnly,

        // Roster
        selectedRosterId,
        setSelectedRosterId,
        derivedRosterId,

        // Validation
        canSave,
        hasDepartment,
        hasRoster,
        hardValidation,
        studentVisaEnforcement,
        isLoadingShifts,

        // Compliance
        complianceResults,
        setComplianceResults,
        complianceHasRun,
        complianceNeedsRerun,
        isComplianceRunning,
        runChecks,
        clearResults,
        buildComplianceInput,
        handleComplianceComplete,
        compliancePanel,

        // Watched fields passed to steps
        watchEmployeeId,
        watchTimezone,

        isEmergencyAssignment,
        isScheduleDefined,
    };

    // ── Sync v2 panel → legacy complianceHasRun ──────────────────────────────
    // The RE-RUN button calls compliancePanel.run() directly (v2 path).
    // Without this sync, complianceHasRun (v1 flag used by isStepValid) would
    // never become true after the panel run, keeping canSave = false even when
    // all 9 rules pass.
    useEffect(() => {
        if (compliancePanel.status === 'results') {
            setComplianceHasRun(true);
            setComplianceNeedsRerun(false);
        }
    }, [compliancePanel.status]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        ...exposedValues,
        // Handlers
        handleSubmit,
        handleCancel,
        handleUnpublish,
        canUnpublish,
    };
}
