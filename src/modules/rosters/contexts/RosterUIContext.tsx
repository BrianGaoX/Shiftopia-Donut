/**
 * RosterUIContext — Backward-compatibility shim
 *
 * All state has moved to `useRosterStore` (Zustand).
 * This file now:
 *  1. Re-exports the types callers import from here
 *  2. Provides a `RosterUIProvider` that owns the one auth-sync effect
 *  3. Exposes `useRosterUI()` / `useRosterUIOptional()` as compatibility hooks
 *     that read directly from the Zustand store — no Context overhead, no
 *     Provider re-render cascade
 *
 * No state lives here anymore. No localStorage.setItem effects.
 * Migrating a component to Zustand directly:
 *   - Before: const { viewType } = useRosterUI();
 *   - After:  const viewType = useRosterStore(s => s.viewType);
 *
 * DEFAULT VIEW / DATE (performance note)
 * ──────────────────────────────────────
 * viewType defaults to 'day' in useRosterStore (persisted in localStorage under
 * 'roster-ui-v2'). This is already a present-centric, small-window default —
 * no change required here. If the persisted value is ever widened to 'week' or
 * 'month', update the Zustand store default back to 'day' or '3day' to keep the
 * initial fetch set small and avoid the SHIFT_RENDER_BUDGET advisory banner.
 *
 * selectedDate (_selectedDateISO) is NOT persisted — it always resets to today
 * on each page load (see useRosterStore partialize config).
 */

import React, { useCallback, useMemo, useEffect } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import {
  useRosterStore,
  selectDepartmentId,
  selectSubDepartmentId,
  selectHasActiveFilters,
  selectDateRange,
  selectDaysInRange,
  VIEW_OPTIONS,
  type CalendarView,
  type RosterMode,
  type AdvancedFilters,
  type DateRange,
  type ComplianceFilterStatus,
} from '../state/useRosterStore';
import { eachDayOfInterval } from 'date-fns';

// ── Re-export types (callers import from this path) ──────────────────────────

export type { CalendarView, RosterMode, ComplianceFilterStatus, AdvancedFilters, DateRange };

// ── Context value interface (unchanged public API) ────────────────────────────

interface RosterUIContextValue {
  viewType:                    CalendarView;
  setViewType:                 (view: CalendarView) => void;
  selectedDate:                Date;
  setSelectedDate:             (date: Date) => void;
  activeMode:                  RosterMode;
  setActiveMode:               (mode: RosterMode) => void;
  selectedOrganizationId:      string | null;
  setSelectedOrganizationId:   (id: string | null) => void;
  selectedDepartmentIds:       string[];
  setSelectedDepartmentIds:    (ids: string[]) => void;
  selectedSubDepartmentIds:    string[];
  setSelectedSubDepartmentIds: (ids: string[]) => void;
  selectedDepartmentId:        string | null;
  setSelectedDepartmentId:     (id: string | null) => void;
  selectedSubDepartmentId:     string | null;
  setSelectedSubDepartmentId:  (id: string | null) => void;
  advancedFilters:             AdvancedFilters;
  setAdvancedFilters:          (filters: Partial<AdvancedFilters>) => void;
  resetAdvancedFilters:        () => void;
  hasActiveFilters:            boolean;
  bulkModeActive:              boolean;
  setBulkModeActive:           (active: boolean) => void;
  selectedV8ShiftIds:            Set<string>;
  setSelectedV8ShiftIds:         (ids: Set<string>) => void;
  toggleShiftSelection:        (id: string) => void;
  selectMultiple:              (ids: string[]) => void;
  clearSelection:              () => void;
  navigatePrevious:            () => void;
  navigateNext:                () => void;
  navigateToToday:             () => void;
  getDateRange:                () => DateRange;
  getDaysInRange:              () => Date[];
  viewOptions:                 typeof VIEW_OPTIONS;
}

// ── Provider — owns ONLY the auth-sync effect ─────────────────────────────────

interface RosterUIProviderProps { children: React.ReactNode }

export const RosterUIProvider: React.FC<RosterUIProviderProps> = ({ children }) => {
  const { activeContract, accessScope } = useAuth();

  const selectedOrganizationId      = useRosterStore(s => s.selectedOrganizationId);
  const selectedDepartmentIds       = useRosterStore(s => s.selectedDepartmentIds);
  const selectedSubDepartmentIds    = useRosterStore(s => s.selectedSubDepartmentIds);
  const setSelectedOrganizationId   = useRosterStore(s => s.setSelectedOrganizationId);
  const setSelectedDepartmentIds    = useRosterStore(s => s.setSelectedDepartmentIds);
  const setSelectedSubDepartmentIds = useRosterStore(s => s.setSelectedSubDepartmentIds);

  useEffect(() => {
    if (!activeContract) return;

    // Sync org from active contract
    if (activeContract.organizationId && selectedOrganizationId !== activeContract.organizationId) {
      setSelectedOrganizationId(activeContract.organizationId);
    }

    // Dept-restricted roles (gamma/beta/alpha = Manager and below)
    const effectiveAccess = accessScope?.accessLevel ?? activeContract.accessLevel;
    const isDeptRestricted = ['gamma', 'beta', 'alpha'].includes(effectiveAccess);

    if (isDeptRestricted && activeContract.departmentId &&
        !selectedDepartmentIds.includes(activeContract.departmentId)) {
      setSelectedDepartmentIds([activeContract.departmentId]);
    }

    // Sub-dept-restricted roles (beta/alpha = Team Lead + Member)
    const isSubDeptRestricted = ['beta', 'alpha'].includes(effectiveAccess);
    if (isSubDeptRestricted && activeContract.subDepartmentId &&
        !selectedSubDepartmentIds.includes(activeContract.subDepartmentId)) {
      setSelectedSubDepartmentIds([activeContract.subDepartmentId]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContract?.organizationId, activeContract?.departmentId, activeContract?.subDepartmentId, accessScope?.accessLevel]);

  return <>{children}</>;
};

// ── useRosterUI — reads Zustand, exposes the legacy Context API ───────────────

/**
 * Hook providing the same API as the old RosterUIContext.
 * Internally reads from the Zustand store — no Context needed.
 * Every field is a stable selector so consumers don't re-render unnecessarily.
 */
export const useRosterUI = (): RosterUIContextValue => {
  // Granular Zustand subscriptions
  const viewType               = useRosterStore(s => s.viewType);
  const activeMode             = useRosterStore(s => s.activeMode);
  const selectedOrganizationId = useRosterStore(s => s.selectedOrganizationId);
  const selectedDepartmentIds  = useRosterStore(s => s.selectedDepartmentIds);
  const selectedSubDepartmentIds = useRosterStore(s => s.selectedSubDepartmentIds);
  const advancedFilters        = useRosterStore(s => s.advancedFilters);
  const bulkModeActive         = useRosterStore(s => s.bulkModeActive);
  const selectedV8ShiftIds       = useRosterStore(s => s.selectedV8ShiftIds);

  // Derived selectors (computed, not stored)
  // NOTE: selectSelectedDate returns `new Date(...)` — always a new object reference.
  // Subscribe to the raw ISO string (a primitive) and memoize the Date so that
  // useSyncExternalStore's Object.is comparison stays stable.
  const _selectedDateISO       = useRosterStore(s => s._selectedDateISO);
  const selectedDate           = useMemo(() => new Date(_selectedDateISO), [_selectedDateISO]);
  const selectedDepartmentId   = useRosterStore(selectDepartmentId);
  const selectedSubDepartmentId = useRosterStore(selectSubDepartmentId);
  const hasActiveFilters       = useRosterStore(selectHasActiveFilters);

  // Actions (stable references from Zustand — never recreated)
  const setViewType                 = useRosterStore(s => s.setViewType);
  const setSelectedDate             = useRosterStore(s => s.setSelectedDate);
  const setActiveMode               = useRosterStore(s => s.setActiveMode);
  const setSelectedOrganizationId   = useRosterStore(s => s.setSelectedOrganizationId);
  const setSelectedDepartmentIds    = useRosterStore(s => s.setSelectedDepartmentIds);
  const setSelectedSubDepartmentIds = useRosterStore(s => s.setSelectedSubDepartmentIds);
  const setSelectedDepartmentId     = useRosterStore(s => s.setSelectedDepartmentId);
  const setSelectedSubDepartmentId  = useRosterStore(s => s.setSelectedSubDepartmentId);
  const setAdvancedFilters          = useRosterStore(s => s.setAdvancedFilters);
  const resetAdvancedFilters        = useRosterStore(s => s.resetAdvancedFilters);
  const setBulkModeActive           = useRosterStore(s => s.setBulkModeActive);
  const setSelectedV8ShiftIds         = useRosterStore(s => s.setSelectedV8ShiftIds);
  const toggleShiftSelection        = useRosterStore(s => s.toggleShiftSelection);
  const selectMultiple              = useRosterStore(s => s.selectMultiple);
  const clearSelection              = useRosterStore(s => s.clearSelection);
  const navigatePrevious            = useRosterStore(s => s.navigatePrevious);
  const navigateNext                = useRosterStore(s => s.navigateNext);
  const navigateToToday             = useRosterStore(s => s.navigateToToday);

  // Utility functions that need current state
  const getDateRange  = useCallback(
    () => selectDateRange(useRosterStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewType, selectedDate],
  );

  const getDaysInRange = useCallback(
    () => selectDaysInRange(useRosterStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewType, selectedDate],
  );

  return useMemo<RosterUIContextValue>(() => ({
    viewType,
    setViewType,
    selectedDate,
    setSelectedDate,
    activeMode,
    setActiveMode,
    selectedOrganizationId,
    setSelectedOrganizationId,
    selectedDepartmentIds,
    setSelectedDepartmentIds,
    selectedSubDepartmentIds,
    setSelectedSubDepartmentIds,
    selectedDepartmentId,
    setSelectedDepartmentId,
    selectedSubDepartmentId,
    setSelectedSubDepartmentId,
    advancedFilters,
    setAdvancedFilters,
    resetAdvancedFilters,
    hasActiveFilters,
    bulkModeActive,
    setBulkModeActive,
    selectedV8ShiftIds,
    setSelectedV8ShiftIds,
    toggleShiftSelection,
    selectMultiple,
    clearSelection,
    navigatePrevious,
    navigateNext,
    navigateToToday,
    getDateRange,
    getDaysInRange,
    viewOptions: VIEW_OPTIONS,
  }), [
    viewType, setViewType,
    selectedDate, setSelectedDate,
    activeMode, setActiveMode,
    selectedOrganizationId, setSelectedOrganizationId,
    selectedDepartmentIds, setSelectedDepartmentIds,
    selectedSubDepartmentIds, setSelectedSubDepartmentIds,
    selectedDepartmentId, setSelectedDepartmentId,
    selectedSubDepartmentId, setSelectedSubDepartmentId,
    advancedFilters, setAdvancedFilters, resetAdvancedFilters,
    hasActiveFilters,
    bulkModeActive, setBulkModeActive,
    selectedV8ShiftIds, setSelectedV8ShiftIds,
    toggleShiftSelection, selectMultiple, clearSelection,
    navigatePrevious, navigateNext, navigateToToday,
    getDateRange, getDaysInRange,
  ]);
};

/**
 * Optional variant — returns null if called before store hydrates.
 * Kept for backward compat only; prefer useRosterUI() in new code.
 */
export const useRosterUIOptional = (): RosterUIContextValue | null => {
  try {
    return useRosterUI();
  } catch {
    return null;
  }
};
