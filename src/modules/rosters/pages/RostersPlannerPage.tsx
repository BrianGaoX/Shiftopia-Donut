import React, { useMemo, useState, useRef } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { cn } from '@/modules/core/lib/utils';

// Components
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import {
  RosterFunctionBar,
  ViewType,
} from '@/modules/rosters/ui/components/RosterFunctionBar';
import PeopleModeGrid, { EmployeeShift } from '@/modules/rosters/ui/modes/PeopleModeGrid';
import type { PeopleModeEmployee, PeopleModeShift } from '@/modules/rosters/ui/modes/people-mode.types';
import UnfilledShiftsPanel, {
  UnfilledShift,
} from '@/modules/rosters/ui/modes/UnfilledShiftsPanel';
import { GroupModeView } from '@/modules/rosters/ui/modes/GroupModeView';
import { EventsModeView } from '@/modules/rosters/ui/modes/EventsModeView';
import { RolesModeView } from '@/modules/rosters/ui/modes/RolesModeView';
import { DrillDownPanel } from '@/modules/rosters/ui/components/DrillDownPanel';
import type { ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { BulkActionsToolbar, type BulkActionResult, type BulkPublishValidationResult } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import { RosterModals, type RosterModalsHandle } from '@/modules/rosters/ui/components/RosterModals';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useShallow } from 'zustand/react/shallow';
import { DndAssignModal } from '@/modules/rosters/ui/dialogs/DndAssignModal';
import { UNASSIGNED_BUCKET_ID } from '@/modules/rosters/domain/projections/constants';
import { prefetchRouteChunk } from '@/router/routePrefetch';

// Hooks & Services - Enterprise TanStack Query hooks
import { useAuth } from '@/platform/auth/useAuth';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  useShiftsByDateRange,
  useEmployees,
  useRoles,
  useRemunerationLevels,
  useEvents,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  useBulkAssignShifts,
  useBulkPublishShifts,
  useBulkDeleteShifts,
  useBulkUnassignShifts,
  useBulkUnpublishShifts,
  useAcceptOffer,
  useRequestTrade,
  useCancelShift,
  useUnpublishShift,
  useShiftDeltaSync,
} from '@/modules/rosters/state/useRosterShifts';
import { useRosterSummary } from '@/modules/rosters/state/useRosterSummary';
import { EligibilityService } from '@/modules/rosters/services/eligibility.service';
import {
  TemplateGroupType,
} from '@/modules/rosters/domain/shift.entity';
import {
  GROUP_DISPLAY_NAMES,
} from '@/modules/rosters/domain/projections/constants';
import { useRosterUI, RosterMode, CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import {
  Shift,
} from '@/modules/rosters/api/shifts.api';
import { useRosterProjections } from '@/modules/rosters/hooks/useRosterProjections';
import { useRosterStructure } from '@/modules/rosters/state/useRosterStructure';
import { useRostersByDateRange } from '@/modules/rosters/state/useEnhancedRosters';
import { usePublishRoster } from '@/modules/rosters/state/useRosterMutations';
import { useRosterViewPrefetch } from '@/modules/rosters/hooks/useRosterViewPrefetch';
import { shiftKeys, type ShiftFilters } from '@/modules/rosters/api/queryKeys';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import {
  preflightPublish,
  preflightUnpublish,
  preflightDelete,
  preflightUnassign,
} from '@/modules/rosters/domain/bulk-action-engine';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { LayoutGrid, Search } from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import type { ToolbarPreflightData } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import { executeAssignShift } from '@/modules/rosters/domain/commands/assignShift.command';
import { resolveGroupType } from '@/modules/rosters/utils/roster-utils';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

// Server-side pagination cap on the employee lookup. Hoisted to module
// scope so the BFF prefetch hook can reuse it as part of the cache key
// (the seeded key must match the read key, which includes this limit).
const EMPLOYEE_PAGE_SIZE = 200;

// Month view is bounded to the selected month ± this many days (calendar
// continuity buffer). Keep in sync with GroupModeView / RolesModeView, which
// compute their own month windows for rendering.
const MONTH_BUFFER_DAYS = 3;

// Maximum shifts to render before showing a performance advisory banner.
// Exceeding this threshold does not block rendering — it is informational only.
const SHIFT_RENDER_BUDGET = 3000;

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
const NewRostersPage: React.FC = () => {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
  const queryClient = useQueryClient();

  const { showUnfilledPanel, setShowUnfilledPanel, isDnDModeActive } = useRosterStore(
    useShallow((s) => ({
      showUnfilledPanel: s.showUnfilledPanel,
      setShowUnfilledPanel: s.setShowUnfilledPanel,
      isDnDModeActive: s.isDnDModeActive,
    })),
  );
  // ==================== SESSION-SCOPED STATE FROM CONTEXT ====================
  // These persist across navigation but reset on browser refresh
  const {
    activeMode,
    setActiveMode,
    viewType,
    setViewType,
    selectedDate,
    setSelectedDate,
    selectedOrganizationId,
    setSelectedOrganizationId,
    selectedDepartmentIds,
    setSelectedDepartmentIds,
    selectedSubDepartmentIds,
    setSelectedSubDepartmentIds,
    toggleShiftSelection,
    clearSelection,
    bulkModeActive,
    setBulkModeActive,
    selectedV8ShiftIds,
    selectMultiple,
  } = useRosterUI();

  // ==================== GROUP BUCKET VIEW (scalability) ====================
  // Group-mode default summary grid: 3-Day / Week / Month, NOT in DnD mode,
  // and NOT bulk mode. In this state the grid renders aggregate summary cells only.
  const isGroupBucketView =
    activeMode === 'group' &&
    !isDnDModeActive &&
    !bulkModeActive;

  // Sync Unfilled/Contracted Panel with DnD Mode
  React.useEffect(() => {
    if (isDnDModeActive && (activeMode === 'people' || activeMode === 'roles')) {
      setShowUnfilledPanel(true);
    }
  }, [isDnDModeActive, activeMode, setShowUnfilledPanel]);

  // Warm up the ShiftFormPage bundle chunk immediately on Roster Planner load
  React.useEffect(() => {
    prefetchRouteChunk('/rosters/shift/new');
  }, []);
  
  // Pending DnD Assignment (Compliance-gated)
  const [pendingDndAssign, setPendingDndAssign] = useState<{
    shift: UnfilledShift | (PeopleModeShift & { id: string }) | Shift | any;
    employeeId: string;
    employeeName: string;
    dateKey: string;
  } | null>(null);
  const [isExecutingDnd, setIsExecutingDnd] = useState(false);

  // Drill-down panel state
  const [drillDownState, setDrillDownState] = useState<{
    isOpen: boolean;
    date: string;
    groupType: string;
    subGroupName?: string;
  }>({ isOpen: false, date: '', groupType: '' });

  const selectedCount = selectedV8ShiftIds.size;

  // ==================== SYNC SCOPE FILTER → ROSTER UI CONTEXT ====================
  // Batched: a single Zustand setState applies all three scope fields in one
  // commit so consumers re-render once per scope change instead of three times.
  React.useEffect(() => {
    useRosterStore.setState({
      ...(scope.org_ids.length > 0 ? { selectedOrganizationId: scope.org_ids[0] } : {}),
      selectedDepartmentIds: scope.dept_ids,
      selectedSubDepartmentIds: scope.subdept_ids,
    });
  }, [scope.org_ids.join(','), scope.dept_ids.join(','), scope.subdept_ids.join(',')]);

  // ==================== CONTEXT STATE ====================
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null);

  // ==================== TEMPLATE DATE BOUNDS (for Ghost Cell navigation) ====================
  const [templateStartDate, setTemplateStartDate] = useState<Date | undefined>(undefined);
  const [templateEndDate, setTemplateEndDate] = useState<Date | undefined>(undefined);

  // ==================== TOGGLE STATES ====================
  // const [isLocked, setIsLocked] = useState(false); // REMOVED local state
  const [showAvailabilities, setShowAvailabilities] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // ==================== MODAL REF ====================
  // All modal open/close state lives in RosterModals; page calls imperative methods.
  const modalsRef = useRef<RosterModalsHandle>(null);

  const [dayZoom, setDayZoom] = useState<60>(60);

  // ==================== DERIVED ====================

  // ==================== DATE CALCULATION ====================
  // Use selectedDate as the start of the range (controlled by RosterFunctionBar)
  const dates = useMemo(() => {
    const arr: Date[] = [];
    switch (viewType) {
      case 'day':
        arr.push(selectedDate);
        break;
      case '3day':
        for (let i = 0; i < 3; i++) {
          arr.push(addDays(selectedDate, i));
        }
        break;
      case 'week': {
        // Use selectedDate as start (not startOfWeek to avoid crossing month boundary)
        for (let i = 0; i < 7; i++) {
          arr.push(addDays(selectedDate, i));
        }
        break;
      }
      case 'month': {
        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const lastOfMonth = new Date(year, month + 1, 0);
        // Bound the month window to the selected month ± a small buffer for
        // calendar continuity. This caps the fetched + rendered column count
        // (~36 instead of a template-driven slide across multiple months) —
        // column count drives both payload size and DOM-node count.
        const windowStart = addDays(firstOfMonth, -MONTH_BUFFER_DAYS);
        const windowEnd = addDays(lastOfMonth, MONTH_BUFFER_DAYS);
        for (let cur = windowStart; cur <= windowEnd; cur = addDays(cur, 1)) {
          arr.push(cur);
        }
        break;
      }
    }
    return arr;
  }, [selectedDate, viewType]);

  // ==================== DATA LOADING (TanStack Query) ====================
  const queryFilters: ShiftFilters = useMemo(() => ({
    departmentIds: selectedDepartmentIds.length > 0 ? selectedDepartmentIds : undefined,
    subDepartmentIds: selectedSubDepartmentIds.length > 0 ? selectedSubDepartmentIds : undefined,
  }), [selectedDepartmentIds, selectedSubDepartmentIds]);

  // Calculate date range from dates array
  const startDate = useMemo(() =>
    dates.length > 0 ? format(dates[0], 'yyyy-MM-dd') : null
    , [dates]);

  const endDate = useMemo(() =>
    dates.length > 0 ? format(dates[dates.length - 1], 'yyyy-MM-dd') : null
    , [dates]);

  // ==================== BFF PREFETCH ====================
  // Single round-trip that seeds the shift list + lookup caches before the
  // individual hooks fire. On navigation back to this page the caches are
  // already warm — no waterfall of 5-7 separate network requests.
  useRosterViewPrefetch({
    orgId: selectedOrganizationId,
    startDate,
    endDate,
    deptIds: selectedDepartmentIds,
    subDeptIds: selectedSubDepartmentIds,
    shiftFilters: queryFilters,
    // Must match the limit passed to useEmployees below so the BFF-seeded
    // cache key collides with the consumer's read key (else duplicate fetch).
    employeePageSize: EMPLOYEE_PAGE_SIZE,
  });

  // ==================== DELTA SYNC ====================
  // Subscribes to Realtime and applies surgical cache patches instead of
  // full list invalidations when shifts change in the background.
  useShiftDeltaSync({
    orgId: selectedOrganizationId,
    deptIds: selectedDepartmentIds.length > 0 ? selectedDepartmentIds : undefined,
    subDeptIds: selectedSubDepartmentIds.length > 0 ? selectedSubDepartmentIds : undefined,
    startDate,
    endDate,
  });

  // ==================== LOCK STATUS ====================
  // Fetch Rosters for Lock Status
  const { data: rosters = [] } = useRostersByDateRange(
    startDate || '',
    endDate || '',
    selectedDepartmentIds[0] || '',
    selectedOrganizationId || undefined,
    selectedSubDepartmentIds[0] || undefined
  );

  // Derive lock status from fetched rosters
  // LOCK FEATURE REMOVED - Always editable if permission allows
  const isLocked = false;
  const canEdit = hasPermission('update');

  // Query shifts for date range (supports day, week, month views)
  const {
    data: shifts = [],
    isLoading,
    isFetching: isRefreshing,
    refetch,
  } = useShiftsByDateRange(
    // Group Bucket View renders aggregate summary cells only — skip the heavy
    // per-shift fetch by gating the query off (null orgId → enabled = false).
    // React Query auto-refetches when this flips back to a real org id on
    // switching into DnD / Collapse / Bulk / Day view.
    isGroupBucketView ? null : selectedOrganizationId,
    startDate,
    endDate,
    queryFilters
  );

  // Mutation hooks
  const bulkPublish = useBulkPublishShifts();
  const bulkDelete = useBulkDeleteShifts();
  const bulkAssign = useBulkAssignShifts();
  const bidShiftMutation = useAcceptOffer();
  const swapShiftMutation = useRequestTrade();
  const cancelShiftMutation = useCancelShift();
  const unpublishShiftMutation = useUnpublishShift();
  const bulkUnassign = useBulkUnassignShifts();
  const bulkUnpublishByHook = useBulkUnpublishShifts();
  const updateShiftMutation = useUpdateShift();

  // Bucket View summary fetching — powers the default summary cells for the
  // 3-Day / Week / Month grids. Day view uses the timeline, so it's excluded.
  const {
    summaryMap,
    isLoading: isSummaryLoading,
  } = useRosterSummary(
    selectedOrganizationId,
    startDate,
    endDate,
    queryFilters
  );


  // Employee search + pagination cap (server-side).
  // Grid is bounded to EMPLOYEE_PAGE_SIZE rows (hoisted to module scope);
  // managers must search to find someone outside the top slice.
  const [employeeSearchInput, setEmployeeSearchInput] = useState('');
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setEmployeeSearchTerm(employeeSearchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [employeeSearchInput]);

  // Employees lookup
  const { data: employees = [] } = useEmployees(
    selectedOrganizationId || undefined,
    selectedDepartmentIds[0] || undefined,
    selectedSubDepartmentIds[0] || undefined,
    undefined,
    employeeSearchTerm || undefined,
    EMPLOYEE_PAGE_SIZE,
  );
  const employeesTruncated = employees.length >= EMPLOYEE_PAGE_SIZE;

  // Escape key exits bulk selection mode
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && bulkModeActive) {
        setBulkModeActive(false);
        clearSelection();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bulkModeActive, setBulkModeActive, clearSelection]);

  // Roster structures for Group mode projection
  const { data: rosterStructures = [] } = useRosterStructure(
    selectedOrganizationId || undefined,
    startDate,
    endDate,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );

  // Lookup data for projections (stable TanStack Query cache refs)
  const { data: roles = [] } = useRoles(selectedOrganizationId || undefined, selectedDepartmentIds[0], selectedSubDepartmentIds[0]);
  const { data: levels = [] } = useRemunerationLevels();
  const { data: eventsData = [] } = useEvents(selectedOrganizationId || undefined);

  // ==================== PROJECTION ENGINE ====================
  const projection = useRosterProjections({
    shifts,
    employees,
    roles,
    levels,
    events: eventsData,
    rosterStructures,
  });

  // Derive unfilled shifts from cached query data
  const unfilledShifts: UnfilledShift[] = useMemo(() => {
    return shifts
      .filter((s: Shift) => !s.assigned_employee_id && !s.is_cancelled && !s.deleted_at && (s.is_draft ?? true))
      .map((s: Shift) => ({
        id: s.id,
        title: s.sub_group_name || 'Shift',
        role: (s as any).roles?.name || 'Unknown Role',
        department: (s as any).departments?.name || 'Unknown Dept',
        date: s.shift_date,
        start: s.start_time,
        end: s.end_time,
        // DnD fields — used by DroppableDateCell to validate before calling onAssign
        isDraft: s.is_draft ?? true,
        isPublished: s.is_published ?? false,
      }));
  }, [shifts]);

  // refreshKey REMOVED - Using React Query invalidation instead

  // ==================== VIEW TYPE HANDLER ====================
  const handleViewTypeChange = (nextView: ViewType) => {
    if (nextView === 'week') {
      setSelectedDate(startOfWeek(selectedDate, { weekStartsOn: 1 }));
      setViewType(nextView);
      return;
    }
    if (nextView === 'month') {
      setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
      setViewType(nextView);
      return;
    }
    // For day/3day, no change needed to selectedDate
    setViewType(nextView);
  };

  // ==================== MODAL HANDLERS ====================
  const handleAddShift = () => {
    const context: ShiftContext = {
      mode: activeMode as ShiftContext['mode'],
      launchSource: 'global', // Date will be editable
      date: format(selectedDate, 'yyyy-MM-dd'),
      organizationId: selectedOrganizationId || undefined,
      rosterId: selectedRosterId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    };
    modalsRef.current?.openAddShift(context);
  };

  const handleAddShiftWithGroup = (
    groupName: string,
    subGroupName: string,
    groupColor: string,
    date?: Date,
    rosterId?: string
  ) => {
    const context: ShiftContext = {
      mode: 'group',
      launchSource: 'grid', // Date will be locked
      date: format(date || selectedDate, 'yyyy-MM-dd'),
      organizationId: selectedOrganizationId || undefined,
      rosterId: rosterId || selectedRosterId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
      groupName,
      subGroupName,
      groupColor,
    };
    modalsRef.current?.openAddShift(context);
  };

  const handlePickUnfilled = (shift: UnfilledShift) => {
    const context: ShiftContext = {
      mode: 'group',
      launchSource: 'grid', // Date will be locked
      date: shift.date,
      organizationId: selectedOrganizationId || undefined,
      rosterId: selectedRosterId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    };
    modalsRef.current?.openAddShift(context);
  };


  const handleShiftCreated = () => {
    // Mutation hooks auto-invalidate; no manual refresh needed
    toast({
      title: 'Success',
      description: 'Shift created successfully.',
    });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    toast({
      title: 'Refreshed',
      description: 'Roster data has been refreshed.',
    });
  };


  // ==================== GHOST CELL NAVIGATION ====================
  // When user clicks a ghost cell, navigate to that month (reset to 1st of month)
  const handleNavigateToMonth = (date: Date) => {
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    setSelectedDate(firstOfMonth);
    toast({
      title: 'Switched Month',
      description: `Navigated to ${format(date, 'MMMM yyyy')}. Please select the template for this month.`,
    });
  };

  // ==================== BULK HANDLERS ====================
  const handleToggleShiftSelection = (shiftId: string) => {
    toggleShiftSelection(shiftId);
  };

  const handleClearSelection = () => {
    clearSelection();
  };

  const handleBulkModeToggle = (active: boolean) => {
    setBulkModeActive(active);
  };

  const selectedShiftsData = useMemo(() => {
    return shifts.filter(s => selectedV8ShiftIds.has(s.id));
  }, [shifts, selectedV8ShiftIds]);

  // Stable array view of the selection Set. Memoized so downstream React.memo
  // boundaries (rows, toolbar) don't see a fresh array on every page render.
  const selectedV8ShiftIdsArray = useMemo(
    () => Array.from(selectedV8ShiftIds),
    [selectedV8ShiftIds],
  );

  const stateCounts = useMemo(() => {
    const counts = {
      assignedCount: 0,
      unassignedCount: 0,
      draftCount: 0,
      publishedCount: 0,
    };

    selectedShiftsData.forEach(s => {
      if (s.assigned_employee_id) counts.assignedCount++;
      else counts.unassignedCount++;

      if (['Published', 'InProgress', 'Completed'].includes(s.lifecycle_status)) counts.publishedCount++;
      else counts.draftCount++;
    });

    return counts;
  }, [selectedShiftsData]);

  /**
   * Pre-flight summary computed from local shift data (sync, no network).
   * Passed to BulkActionsToolbar so each action button can show
   * "N eligible, M blocked" before the user confirms.
   */
  const preflightData = useMemo((): ToolbarPreflightData | undefined => {
    if (selectedShiftsData.length === 0) return undefined;

    const pub     = preflightPublish(selectedShiftsData);
    const unpub   = preflightUnpublish(selectedShiftsData);
    const del     = preflightDelete(selectedShiftsData);
    const unassign = preflightUnassign(selectedShiftsData);

    return {
      publish:   { eligible: pub.eligibleIds.length,     blocked: pub.blocked.length,     warned: pub.warned.length },
      unpublish: { eligible: unpub.eligibleIds.length,   blocked: unpub.blocked.length,   warned: unpub.warned.length },
      delete:    { eligible: del.eligibleIds.length,     warned: del.warned.length },
      unassign:  { eligible: unassign.eligibleIds.length, blocked: unassign.blocked.length },
    };
  }, [selectedShiftsData]);

  /**
   * Async compliance pre-validation for Publish action.
   * Called by the toolbar's VALIDATING phase — runs compliance for all selected shifts
   * and returns eligible/blocked counts BEFORE the user confirms.
   */
  const handleValidatePublish = async (shiftIds: string[]): Promise<BulkPublishValidationResult> => {
    const shiftsToValidate = selectedShiftsData.filter(s => shiftIds.includes(s.id));
    return shiftsCommands.validateBulkPublishCompliance(shiftsToValidate);
  };

  /**
   * Total selectable shifts in the current view (not locked).
   * Passed to the toolbar so it can show "Select All (N)" and flip to "Deselect All"
   * when all N are selected.
   */
  const totalSelectableCount = useMemo(() => {
    return shifts.filter(s => !isShiftLocked(s.shift_date, s.start_time, 'roster_management')).length;
  }, [shifts]);

  const handleSelectAll = () => {
    // `shifts` is already filtered by date range and queryFilters — select all unlocked.
    const visibleAndUnlockedIds = shifts
      .filter(s => !isShiftLocked(s.shift_date, s.start_time, 'roster_management'))
      .map(s => s.id);

    setBulkModeActive(true);
    selectMultiple(visibleAndUnlockedIds);
  };

  // Toolbar owns result feedback; page owns data and cache management.
  // `shiftIds` are pre-validated by the toolbar's VALIDATING phase — use them directly.
  const handleBulkPublish = async (shiftIds: string[]): Promise<BulkActionResult> => {
    if (shiftIds.length === 0) return { successCount: 0, failedCount: 0 };

    const result = await bulkPublish.mutateAsync(shiftIds);
    clearSelection();
    setBulkModeActive(false);
    return {
      successCount: result.publishedIds.length,
      failedCount: result.complianceFailed.length + result.dbFailed.length,
      failedDetails: [...result.complianceFailed, ...result.dbFailed],
    };
  };

  const handleBulkUnpublish = async (_shiftIds: string[]): Promise<BulkActionResult> => {
    // Use preflight-eligible IDs only (published, not in bidding)
    const eligibleIds = preflightData?.unpublish.eligible
      ? selectedShiftsData
          .filter(s => s.lifecycle_status === 'Published' && s.bidding_status === 'not_on_bidding')
          .map(s => s.id)
      : selectedShiftsData.filter(s => s.lifecycle_status === 'Published').map(s => s.id);

    if (eligibleIds.length === 0) return { successCount: 0, failedCount: 0 };

    const result = await bulkUnpublishByHook.mutateAsync(eligibleIds);
    clearSelection();
    setBulkModeActive(false);
    return {
      successCount: result.unpublishedIds.length,
      failedCount:  result.failed.length,
      failedDetails: result.failed,
    };
  };

  const handleBulkUnassign = async () => {
    const assignedIds = selectedShiftsData
      .filter(s => s.assigned_employee_id)
      .map(s => s.id);

    if (assignedIds.length === 0) return;

    try {
      await bulkUnassign.mutateAsync(assignedIds);
      toast({
        title: 'Unassigned',
        description: `Unassigned ${assignedIds.length} shift${assignedIds.length !== 1 ? 's' : ''} successfully.`,
      });
      clearSelection();
      setBulkModeActive(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to unassign shifts', variant: 'destructive' });
    }
  };

  const handleBulkDelete = async (): Promise<BulkActionResult> => {
    if (selectedV8ShiftIds.size === 0) return { successCount: 0, failedCount: 0 };
    const result = await bulkDelete.mutateAsync(selectedV8ShiftIdsArray);
    clearSelection();
    setBulkModeActive(false);
    return {
      successCount: result.deletedIds.length,
      failedCount: result.failed.length,
      failedDetails: result.failed,
    };
  };

  // ==================== EMPLOYEES WITH SHIFTS ====================
  // Use the projected people directly from our data engine.
  // This avoids re-running expensive cost/fatigue logic in the UI render loop.
  const employeesWithShifts = useMemo(() => {
    return (projection.people?.employees || []) as any[];
  }, [projection.people]);

  // ── Drag-and-drop assignment ─────────────────────────────────────────
  // shifts and employees churn on every optimistic mutation. If the DnD
  // handlers close over them directly, their identity changes on every
  // shift update — which re-registers the drop spec on every one of
  // ~1.4k DroppableDateCells. Read via refs to keep the handlers stable.
  const shiftsRef = useRef(shifts);
  const employeesRef = useRef(employees);
  React.useEffect(() => { shiftsRef.current = shifts; }, [shifts]);
  React.useEffect(() => { employeesRef.current = employees; }, [employees]);

  // handleDndAssign: Used in People Mode (Unfilled Shift -> Employee row)
  const handleDndAssign = React.useCallback(
    async (shift: UnfilledShift, employeeId: string, dateKey: string) => {
      const employee = employeesRef.current.find(e => e.id === employeeId);
      if (!employee) return;
      setPendingDndAssign({
        shift,
        employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        dateKey,
      });
    },
    [],
  );

  // handleDndAssignToShift: Used in Group/Roles Mode (Staff Member -> Shift Card)
  const handleDndAssignToShift = React.useCallback(
    async (shiftId: string, employeeId: string, employeeName: string) => {
      const shift = shiftsRef.current.find(s => s.id === shiftId);
      if (!shift) return;
      setPendingDndAssign({
        shift,
        employeeId,
        employeeName,
        dateKey: shift.shift_date,
      });
    },
    [],
  );

  const handleDndMove = React.useCallback(
    async (shiftId: string, targetContext: { employeeId?: string; roleId?: string; roleName?: string; shiftDate: string }) => {
      const shift = shiftsRef.current.find(s => s.id === shiftId);
      if (!shift) return;

      const { employeeId, roleId, roleName, shiftDate } = targetContext;

      // Special Case: Unassigning (drag to Open Shifts)
      if (employeeId === UNASSIGNED_BUCKET_ID) {
        try {
          setIsExecutingDnd(true);
          await updateShiftMutation.mutateAsync({
            shiftId: shiftId,
            updates: { 
              assigned_employee_id: null,
              shift_date: shiftDate 
            },
          });
          toast({ title: 'Shift updated', description: 'Moved to open shifts on ' + shiftDate });
          queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
        } catch (error) {
          toast({ title: 'Failed to unassign', variant: 'destructive' });
        } finally {
          setIsExecutingDnd(false);
        }
        return;
      }

      // Reassignment or date/role move
      if (employeeId) {
        const targetEmployee = employeesRef.current.find(e => e.id === employeeId);
        if (!targetEmployee) return;
        setPendingDndAssign({
          shift,
          employeeId,
          employeeName: `${targetEmployee.first_name} ${targetEmployee.last_name}`,
          dateKey: shiftDate,
        });
      } else if (roleId) {
        // Roles Mode Move
        // If the shift is assigned, we should check hierarchy (Org -> Dept -> SubDept -> Role)
        if (shift.assigned_employee_id) {
          try {
            setIsExecutingDnd(true);
            const eligibleEmployees = await EligibilityService.getEligibleEmployees({
              organizationId: shift.organization_id || '',
              departmentId: shift.department_id || '',
              subDepartmentId: shift.sub_department_id || '',
              roleId: roleId
            });
            
            const isEligible = eligibleEmployees.some(e => e.id === shift.assigned_employee_id);
            
            if (!isEligible) {
              toast({
                title: 'Invalid Move',
                description: `Employee is not contracted for the ${roleName || 'selected'} role.`,
                variant: 'destructive',
              });
              return;
            }

            // If eligible, we still trigger the compliance modal for date/time changes
            const profile = (shift as any).profiles || (shift as any).assigned_profiles;
            const employeeName = profile ? `${profile.first_name} ${profile.last_name}` : 'Employee';
            
            setPendingDndAssign({
              shift: { ...shift, role_id: roleId, roleName: roleName || (shift as any).role_name },
              employeeId: shift.assigned_employee_id,
              employeeName,
              dateKey: shiftDate,
            });
          } catch (error) {
            console.error('Hierarchy check failed:', error);
            toast({ title: 'Validation Error', description: 'Could not verify role eligibility.', variant: 'destructive' });
          } finally {
            setIsExecutingDnd(false);
          }
        } else {
          // Unassigned shift move to different role/date
          try {
            setIsExecutingDnd(true);
            await updateShiftMutation.mutateAsync({
              shiftId,
              updates: {
                role_id: roleId,
                shift_date: shiftDate,
              }
            });
            toast({ title: 'Shift moved' });
            queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
          } catch {
            toast({ title: 'Move failed', variant: 'destructive' });
          } finally {
            setIsExecutingDnd(false);
          }
        }
      }
    },
    [updateShiftMutation, toast, queryClient],
  );

  const executePendingAssignment = async (options: { ignoreWarnings: boolean }) => {
    if (!pendingDndAssign) return;
    setIsExecutingDnd(true);
    try {
      const { shift, employeeId, dateKey } = pendingDndAssign;
      const originalDate = (shift as any).rawShift?.shift_date || (shift as any).date;
      const dateChanged = originalDate !== dateKey;

      const result = await executeAssignShift({
        shiftId: shift.id,
        employeeId,
        context: 'MANUAL',
        targetDate: dateChanged ? dateKey : undefined,
        ignoreWarnings: options.ignoreWarnings,
      });

      if (!result.success) {
        toast({
          title: 'Assignment blocked',
          description: result.error ?? 'Compliance check failed.',
          variant: 'destructive',
        });
        return;
      }

      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      toast({ title: 'Success', description: 'Shift updated successfully.' });
      setPendingDndAssign(null);
    } catch (error) {
      toast({
        title: 'Action failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsExecutingDnd(false);
    }
  };

  // ==================== COMPUTED STATS (from projection engine) ====================
  const {
    assignedShifts: totalAssignedShifts,
    openShifts: totalUnfilledShifts,
    totalShifts,
    estimatedCost,
  } = projection.stats;
  const budget = 15000;
  const remainingBudget = budget - estimatedCost;

  // ==================== SINGLE SHIFT HANDLERS (via mutation hooks) ====================
  const handleBidShift = async (shiftId: string) => {
    try {
      await bidShiftMutation.mutateAsync(shiftId);
      toast({ title: 'Bid Placed', description: 'You have successfully bid on this shift.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to bid on shift', variant: 'destructive' });
    }
  };

  const handleSwapShift = async (shiftId: string) => {
    try {
      await swapShiftMutation.mutateAsync(shiftId);
      toast({ title: 'Trade Requested', description: 'Trade request submitted successfully.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to request trade', variant: 'destructive' });
    }
  };

  const handleCancelSingleShift = async (shiftId: string) => {
    try {
      await cancelShiftMutation.mutateAsync({ shiftId, reason: 'User initiated cancel' });
      toast({ title: 'Shift Cancelled', description: 'Shift has been cancelled.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to cancel shift', variant: 'destructive' });
    }
  };

  const handleUnpublishShift = async (shiftId: string) => {
    // Determine the shift from the collection to check for locking
    const shift = shifts.find(s => s.id === shiftId);
    if (shift && isShiftLocked(shift.shift_date, shift.start_time, 'roster_management')) {
      toast({
        title: 'Action Locked',
        description: 'Cannot unpublish a shift that has already started.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await unpublishShiftMutation.mutateAsync({ shiftId, reason: 'Unpublished via Roster' });
      toast({ title: 'Shift Unpublished', description: 'Shift reverted to Draft.' });
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error', description: error.message || 'Failed to unpublish shift', variant: 'destructive' });
    }
  };

  const handleEditShift = (shift: any) => {
    if (!canEdit) return;
    const rawShift = shift.rawShift || shift;

    modalsRef.current?.openEditShift(rawShift, {
      mode: activeMode,
      launchSource: 'edit',
      date: rawShift.shift_date,
      organizationId: rawShift.organization_id || selectedOrganizationId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
      rosterId: rawShift.roster_id || selectedRosterId || undefined,
      roleId: rawShift.role_id || undefined,
      employeeId: rawShift.assigned_employee_id || undefined,
      group_type: rawShift.group_type || undefined,
      sub_group_name: rawShift.sub_group_name || undefined,
    });
  };

  // ==================== RENDER ====================
  return (
    <div 
      className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4"
    >
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30">
        <div className="rounded-[32px] p-4 lg:p-6 transition-all border bg-white/95 border-white shadow-xl shadow-slate-200/50 dark:bg-[#1c2333] dark:border-white/5 dark:shadow-2xl dark:shadow-black/20">
          {/* Row 1: Identity & Clock + Row 2: Scope Filter */}
          <PersonalPageHeader
            title="Roster Planner"
            Icon={LayoutGrid}
            mode="managerial"
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
          />

          {/* Row 3: Function Bar */}
          <div className="mt-4 lg:mt-6">
            <RosterFunctionBar
              transparent
              // Context state
              selectedOrganizationId={selectedOrganizationId}
              selectedRosterId={selectedRosterId}
              selectedDepartmentId={selectedDepartmentIds[0] || null}
              selectedSubDepartmentId={selectedSubDepartmentIds[0] || null}
              // Context callbacks
              onRosterChange={setSelectedRosterId}
              // Ghost Cell Navigation - receive template date bounds
              onTemplateDatesChange={(startDate, endDate) => {
                setTemplateStartDate(startDate);
                setTemplateEndDate(endDate);
              }}
              // Date & View
              selectedDate={selectedDate}
              viewType={viewType}
              onDateChange={setSelectedDate}
              onViewTypeChange={handleViewTypeChange}
              // Toggle states
              showAvailabilities={showAvailabilities}
              showUnfilledPanel={showUnfilledPanel}
              isRefreshing={isRefreshing}
              // Toggle callbacks
              onAvailabilitiesToggle={() => setShowAvailabilities(!showAvailabilities)}
              onUnfilledPanelToggle={() => setShowUnfilledPanel(!showUnfilledPanel)}
              onRefresh={handleRefresh}
              onFiltersClick={() => setShowFilters(!showFilters)}
              canEdit={canEdit}
              // Bulk Mode
              isBulkMode={bulkModeActive}
              onBulkModeToggle={() => handleBulkModeToggle(!bulkModeActive)}
              onAutoScheduleClick={() => modalsRef.current?.openAutoScheduler()}
            />
          </div>
        </div>
      </div>

      {/* Bulk Mode Banner — sticky amber bar shown while bulk selection is active */}
      {bulkModeActive && (
        <div className="flex-shrink-0 bg-amber-500/10 border-y border-amber-500/30 px-6 py-2 flex items-center justify-between mb-2">
          <div className="flex items-center gap-3 text-amber-700 dark:text-amber-300 text-sm font-medium">
            <span>Bulk selection active — click shifts to select</span>
            {selectedV8ShiftIds.size > 0 && (
              <span className="bg-amber-500/20 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full text-xs font-bold">
                {selectedV8ShiftIds.size} selected
              </span>
            )}
          </div>
          <button
            onClick={() => { setBulkModeActive(false); clearSelection(); }}
            className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
          >
            Press Esc to exit
          </button>
        </div>
      )}

      {/* Over-budget Banner — informational sky bar shown when the loaded shift count is large */}
      {shifts.length >= SHIFT_RENDER_BUDGET && (
        <div className="flex-shrink-0 bg-sky-500/10 border-y border-sky-500/30 px-6 py-2 flex items-center text-sky-700 dark:text-sky-300 text-sm">
          Showing {shifts.length} shifts — performance may degrade. Narrow the date range or department filter for best results.
        </div>
      )}

      {/* ── Main Content Area ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full rounded-[32px] overflow-hidden transition-all border flex flex-col bg-white/95 border-white shadow-xl shadow-slate-200/50 dark:bg-[#1c2333] dark:border-white/5 dark:shadow-2xl dark:shadow-black/20">
          <DndProvider backend={HTML5Backend}>
            <div className="flex-1 min-h-0 overflow-hidden flex relative">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-2" />
              <p className="text-white/80 dark:text-white/80 font-medium">Loading shifts...</p>
            </div>
          </div>
        )}

        {/* Grid Area - Using global background/layout */}
        <div
          className={cn(
            'min-h-0 overflow-hidden transition-all duration-300 ease-in-out relative',
            showUnfilledPanel ? 'flex-1' : 'w-full'
          )}
        >
          {activeMode === 'people' && (
            <>
              <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-2">
                <div className="relative max-w-sm flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={employeeSearchInput}
                    onChange={(e) => setEmployeeSearchInput(e.target.value)}
                    placeholder="Search employees by name…"
                    className="pl-8 h-9"
                  />
                </div>
                <div className="text-xs font-mono tabular-nums text-muted-foreground">
                  {employeesTruncated ? (
                    <>
                      Showing first <span className="text-foreground font-medium">{EMPLOYEE_PAGE_SIZE}</span>
                      {employeeSearchTerm ? ' matches' : ' employees'} — refine search to see more
                    </>
                  ) : (
                    <>
                      Showing <span className="text-foreground font-medium">{employees.length}</span>
                      {employeeSearchTerm ? ` match${employees.length === 1 ? '' : 'es'}` : ' employees'}
                    </>
                  )}
                </div>
              </div>
              <PeopleModeGrid
                employees={employeesWithShifts}
              onAssignShift={handleDndAssign}
              onMoveShift={(shiftId, targetEmployeeId, targetDate) =>
                handleDndMove(shiftId, { employeeId: targetEmployeeId, shiftDate: targetDate })
              }
              canEdit={canEdit}
              dates={dates}
              showAvailabilities={showAvailabilities}
              isBulkMode={bulkModeActive}
              selectedShifts={selectedV8ShiftIdsArray}
              onToggleShiftSelection={handleToggleShiftSelection}
              onAddShift={(employee, date) => {
                const context: ShiftContext = {
                  mode: 'people',
                  launchSource: 'grid', // Date will be locked
                  date: format(date || selectedDate, 'yyyy-MM-dd'),
                  organizationId: selectedOrganizationId || undefined,
                  rosterId: selectedRosterId || undefined,
                  departmentIds: selectedDepartmentIds,
                  subDepartmentIds: selectedSubDepartmentIds,
                  employeeId: employee?.id,
                };
                modalsRef.current?.openAddShift(context);
              }}
              onViewShift={(shift: EmployeeShift) => {
                handleEditShift(shift);
              }}
              onBidShift={handleBidShift}
              onSwapShift={handleSwapShift}
              onCancelShift={handleCancelSingleShift}
              onUnpublishShift={handleUnpublishShift}

              />
            </>
          )}

          {activeMode === 'group' && (
            <GroupModeView

              selectedDate={selectedDate}
              viewType={viewType}
              canEdit={canEdit}
              organizationId={selectedOrganizationId || undefined}
              organizationName={undefined} // TODO: Get from context
              rosterId={selectedRosterId || undefined}
              departmentId={selectedDepartmentIds[0] || undefined}
              departmentName={undefined} // TODO: Get from RosterFunctionBar
              subDepartmentId={selectedSubDepartmentIds[0] || undefined}
              subDepartmentName={undefined}
              // Ghost Cell Navigation props
              templateStartDate={templateStartDate}
              templateEndDate={templateEndDate}
              onNavigateToMonth={handleNavigateToMonth}
              onAddShift={handleAddShiftWithGroup}
              // Bulk Mode
              isBulkMode={bulkModeActive}
              onBulkModeToggle={handleBulkModeToggle}
              selectedV8ShiftIds={selectedV8ShiftIdsArray}
              onToggleShiftSelection={handleToggleShiftSelection}
              // Day zoom
              dayZoom={dayZoom}
              // Data from unified hook
              shifts={shifts}
              isShiftsLoading={isLoading}
              showLegend={true}
              projection={projection.group ?? undefined}
              // Centralized DnD assignment (employee → shift card)
              onAssignShift={handleDndAssignToShift}
              // Bucket View summary + drill-down — default for Day / 3-Day / Week / Month
              summaryData={summaryMap}
              onDrillDown={(date, groupType, subGroupName) => setDrillDownState({ isOpen: true, date, groupType, subGroupName })}
            />
          )}

          {activeMode === 'events' && (
            <EventsModeView

              selectedDate={selectedDate}
              viewType={viewType}
              shifts={shifts}
              isShiftsLoading={isLoading}
              organizationId={selectedOrganizationId || undefined}
              projection={projection.events ?? undefined}
              onEditShift={handleEditShift}
            />
          )}

          {activeMode === 'roles' && (
            <RolesModeView
              selectedDate={selectedDate}
              viewType={viewType}
              canEdit={canEdit}
              organizationId={selectedOrganizationId || undefined}
              departmentIds={selectedDepartmentIds}
              subDepartmentIds={selectedSubDepartmentIds}
              rosterId={selectedRosterId || undefined}
              shifts={shifts}
              projection={projection.roles ?? undefined}
              onEditShift={handleEditShift}
              onMoveShift={handleDndMove}
              onAssignShift={handleDndAssignToShift}
              selectedV8ShiftIds={selectedV8ShiftIdsArray}
              isBulkMode={bulkModeActive}
              onToggleShiftSelection={handleToggleShiftSelection}
              summaryData={viewType !== 'day' ? summaryMap : undefined}
              onDrillDown={(date, groupType, subGroupName) => setDrillDownState({ isOpen: true, date, groupType, subGroupName })}
            />
          )}
        </div>

        {/* Unfilled Shifts Panel */}
        <div
          className={cn(
            'min-h-0 overflow-hidden border-l border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/10 backdrop-blur-md transition-all duration-300 ease-in-out',
            showUnfilledPanel ? 'w-80' : 'w-0 border-l-0'
          )}
        >
          <div
            className={cn(
              'w-80 h-full overflow-auto transition-opacity duration-300',
              showUnfilledPanel ? 'opacity-100' : 'opacity-0'
            )}
          >
            <UnfilledShiftsPanel
              unfilledShifts={unfilledShifts}
              onPickShift={handlePickUnfilled}
            />
          </div>
          </div>
          </div>
          </DndProvider>
        </div>
      </div>

      {/* Bulk Toolbar */}
      {bulkModeActive && selectedV8ShiftIds.size > 0 && viewType !== 'month' && (
        <BulkActionsToolbar
          selectedCount={selectedCount}
          selectedV8ShiftIds={selectedV8ShiftIdsArray}
          stateCounts={stateCounts}
          preflightData={preflightData}
          totalVisibleCount={totalSelectableCount}
          onClearSelection={handleClearSelection}
          onSelectAll={handleSelectAll}
          onDelete={handleBulkDelete}
          onPublish={handleBulkPublish}
          onUnpublish={handleBulkUnpublish}
          onAssign={() => modalsRef.current?.openBulkAssign()}
          onUnassign={handleBulkUnassign}
          onValidatePublish={handleValidatePublish}
          allowedActions={{
            canPublish: stateCounts.draftCount > 0,
            canUnpublish: stateCounts.publishedCount > 0,
          }}
        />
      )}

      {/* Modals (add/edit shift, bulk assign, auto-scheduler) */}
      <RosterModals
        ref={modalsRef}
        organizationId={selectedOrganizationId || undefined}
        selectedV8ShiftIds={selectedV8ShiftIdsArray}
        employees={employees.map((e) => ({
          id: e.id,
          name: `${e.first_name} ${e.last_name}`.trim() || e.id,
          avatarUrl: (e as any).avatar_url ?? undefined,
          role: (e as any).role_name ?? undefined,
        }))}
        autoSchedulerShifts={shifts
          .filter((s) => !s.assigned_employee_id && !s.is_cancelled && !s.deleted_at)
          .map((s) => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            role_id: (s as any).role_id ?? null,
            roleName: (s as any).role_name || (s as any).roles?.name || '',
            unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
          }))}
        autoSchedulerEmployees={employees.map((e) => ({
          id: e.id,
          name: `${e.first_name} ${e.last_name}`.trim() || e.id,
          contracted_weekly_hours: (e as any).contracted_weekly_hours,
          contract_type: (e as any).contract_type,
        }))}
        onShiftSaved={handleShiftCreated}
        onAssignComplete={() => { clearSelection(); setBulkModeActive(false); }}
        onAutoScheduleComplete={() => {}}
      />

      {/* DnD Assignment Modal */}
      {pendingDndAssign && (
        <DndAssignModal
          open={!!pendingDndAssign}
          onClose={() => setPendingDndAssign(null)}
          onConfirm={executePendingAssignment}
          isAssigning={isExecutingDnd}
          shiftId={pendingDndAssign.shift.id}
          employeeId={pendingDndAssign.employeeId}
          employeeName={pendingDndAssign.employeeName}
          shiftRole={(pendingDndAssign.shift as any).role || (pendingDndAssign.shift as any).roleName || 'Shift'}
          shiftDate={pendingDndAssign.dateKey}
          shiftStartTime={(pendingDndAssign.shift as any).startTime || (pendingDndAssign.shift as any).start_time || (pendingDndAssign.shift as any).start}
          shiftEndTime={(pendingDndAssign.shift as any).endTime || (pendingDndAssign.shift as any).end_time || (pendingDndAssign.shift as any).end}
        />
      )}

      {/* Drill-Down Panel (Phase 4 of Millions-of-Shifts endgame) */}
      <DrillDownPanel
        isOpen={drillDownState.isOpen}
        onClose={() => setDrillDownState({ ...drillDownState, isOpen: false })}
        date={drillDownState.date}
        groupType={drillDownState.groupType}
        subGroupName={drillDownState.subGroupName}
        organizationId={selectedOrganizationId || undefined}
        departmentId={selectedDepartmentIds[0] || undefined}
        subDepartmentId={selectedSubDepartmentIds[0] || undefined}
        groupName={GROUP_DISPLAY_NAMES[drillDownState.groupType as TemplateGroupType | 'unassigned'] || drillDownState.groupType}
        rosterId={selectedRosterId || undefined}
      />

      {/* Footer Summary */}
      <div className="border-t border-slate-200 dark:border-white/5 bg-white dark:bg-black/20 backdrop-blur-md px-6 py-3 flex-shrink-0">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between text-sm gap-3">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-muted-foreground/60">Total Shifts:</span>
              <span className="ml-2 font-medium text-foreground">{totalShifts}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Assigned:</span>
              <span className="ml-2 font-medium text-emerald-400">{totalAssignedShifts}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Unfilled:</span>
              <span className="ml-2 font-medium text-amber-400">{totalUnfilledShifts}</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Redundant Auto-Schedule button removed (now in Function Bar) */}
            <div>
              <span className="text-muted-foreground/60">Est. Cost:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-2 font-medium text-foreground cursor-help hover:text-primary transition-colors underline decoration-dotted decoration-muted-foreground/30 underline-offset-4">
                      ${estimatedCost.toFixed(2)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="w-64 p-4 bg-zinc-900 border-white/10 shadow-2xl" side="top" sideOffset={10}>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Global Labour Estimate</p>
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Award Compliant</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-white/50">Ordinary Base Pay</span>
                          <span className="text-white font-mono">{formatCost(projection.stats.costBreakdown.base)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/50">Weekend & Night Penalties</span>
                          <span className="text-emerald-400 font-mono">+{formatCost(projection.stats.costBreakdown.penalty)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/50">Overtime Loadings</span>
                          <span className="text-amber-400 font-mono">+{formatCost(projection.stats.costBreakdown.overtime)}</span>
                        </div>
                        {projection.stats.costBreakdown.allowance > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-white/50">Meal & Industry Allowances</span>
                            <span className="text-blue-400 font-mono">+{formatCost(projection.stats.costBreakdown.allowance)}</span>
                          </div>
                        )}
                        {projection.stats.costBreakdown.leave > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-white/50">Annual Leave Loading (17.5%)</span>
                            <span className="text-purple-400 font-mono">+{formatCost(projection.stats.costBreakdown.leave)}</span>
                          </div>
                        )}
                        <div className="pt-2 border-t border-white/10 flex justify-between text-sm font-bold">
                          <span className="text-white">Total Roster Cost</span>
                          <span className="text-white font-mono">{formatCost(estimatedCost)}</span>
                        </div>
                      </div>
                      <div className="pt-1">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-white/30 italic">Target Budget</span>
                          <span className="text-white/40 font-mono">{formatCost(budget)}</span>
                        </div>
                        <div className="flex justify-between text-[10px] mt-0.5">
                          <span className="text-white/30 italic">Variance</span>
                          <span className={cn("font-mono", remainingBudget >= 0 ? "text-emerald-500/60" : "text-red-500/60")}>
                            {remainingBudget >= 0 ? '-' : '+'}{formatCost(Math.abs(remainingBudget))}
                          </span>
                        </div>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Budget:</span>
              <span className="ml-2 font-medium text-foreground">${budget.toFixed(2)}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Remaining:</span>
              <span
                className={cn(
                  'ml-2 font-medium',
                  remainingBudget >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                ${remainingBudget.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewRostersPage;
