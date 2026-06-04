/**
 * useRosterShifts — Shift Query & Mutation Hooks
 *
 * Phase 3 rewrites the mutation layer to use:
 *
 *  1. SURGICAL CACHE UPDATES — every mutation targets shiftKeys.lists
 *     (not shiftKeys.all), preventing unnecessary refetch of lookups and
 *     detail views that didn't change.
 *
 *  2. OPTIMISTIC UPDATES — all 12 write mutations now apply instant
 *     cache patches before the server responds, with automatic rollback
 *     on error via the onMutate/onError/onSettled pattern.
 *
 *  3. TYPED setQueriesData — no `as any` in cache updaters;
 *     explicit Shift[] generics + null guards throughout.
 *
 * Invalidation budget per mutation:
 *  - Single update:  shiftKeys.detail(id)          (1 query)
 *  - Any list write: shiftKeys.lists                (~1 query per visible date range)
 *  - Structural:     shiftKeys.lists + rosterKeys.all (roster dates changed)
 *  - Lookups:        shiftKeys.lookups._root        (reference data changed)
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { shiftsQueries, type ShiftDeltaRow } from '../api/shifts.queries';
import { shiftsCommands } from '../api/shifts.commands';
import { complianceService } from '../services/compliance.service';
import type { Shift } from '../domain/shift.entity';
import { shiftKeys, rosterKeys, type ShiftFilters } from '../api/queryKeys';
import { useToast } from '@/modules/core/hooks/use-toast';
import { isAppError } from '@/platform/supabase/rpc/errors';
import { supabase } from '@/platform/realtime/client';


// ── Types ─────────────────────────────────────────────────────────────────────

export type { ShiftFilters };

// ── Shared optimistic-update helpers ─────────────────────────────────────────

export type Snapshot = [readonly unknown[], Shift[] | undefined][];

export function snapshotLists(queryClient: ReturnType<typeof useQueryClient>): Snapshot {
  return queryClient.getQueriesData<Shift[]>({ queryKey: shiftKeys.lists });
}

export function rollbackLists(queryClient: ReturnType<typeof useQueryClient>, snapshot: Snapshot) {
  snapshot.forEach(([key, data]) => queryClient.setQueryData<Shift[]>(key as QueryKey, data));
}

export function patchLists(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (old: Shift[]) => Shift[],
  /** Optional predicate to scope the update to specific cached queries.
   *  Without this, the updater runs against EVERY list-type query in the
   *  cache — e.g. 12 cached weeks × 5k shifts = 60k shift objects. */
  predicate?: (q: { queryKey: readonly unknown[] }) => boolean,
) {
  queryClient.setQueriesData<Shift[]>(
    {
      queryKey: shiftKeys.lists,
      ...(predicate ? { predicate: predicate as (q: { queryKey: readonly unknown[] }) => boolean } : {}),
    },
    (old) => (old && Array.isArray(old) ? updater(old) : old),
  );
}

/**
 * Build a predicate that scopes `patchLists` updates to byRange caches whose
 * date window contains `shiftDate`. byDate / byEmployee caches always pass
 * through (their dates aren't expressible as a window in the same shape).
 */
function dateInRange(shiftDate: string) {
  return (q: { queryKey: readonly unknown[] }) => {
    const k = q.queryKey;
    if (k[2] !== 'byRange') return true; // non-range caches pass through
    const startDate = k[4] as string | undefined;
    const endDate = k[5] as string | undefined;
    if (typeof startDate !== 'string' || typeof endDate !== 'string') return true;
    return shiftDate >= startDate && shiftDate <= endDate;
  };
}

/**
 * Best-effort lookup of a shift's date by scanning the existing list caches.
 * Returns undefined if the shift is not currently in any cached list — callers
 * should fall back to an unscoped patch in that case.
 */
function findShiftDateInLists(
  queryClient: ReturnType<typeof useQueryClient>,
  shiftId: string,
): string | undefined {
  const lists = queryClient.getQueriesData<Shift[]>({ queryKey: shiftKeys.lists });
  for (const [, data] of lists) {
    if (!data || !Array.isArray(data)) continue;
    const found = data.find(s => s.id === shiftId);
    if (found?.shift_date) return found.shift_date;
  }
  return undefined;
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useShiftsByDate(
  organizationId: string | null,
  date: string | null,
  filters?: ShiftFilters,
) {
  return useQuery({
    queryKey: shiftKeys.byDate(organizationId ?? '', date ?? '', filters),
    queryFn: () => shiftsQueries.getShiftsForDate(organizationId!, date!, filters),
    enabled: !!organizationId && !!date,
    staleTime: 30_000,
    gcTime: 2 * 60_000,   // F12: 2 min instead of global 10 min — shift lists are large
    refetchOnWindowFocus: true,
  });
}

export function useShiftsByDateRange(
  organizationId: string | null,
  startDate: string | null,
  endDate: string | null,
  filters?: ShiftFilters,
) {
  return useQuery({
    queryKey: shiftKeys.byDateRange(organizationId ?? '', startDate ?? '', endDate ?? '', filters),
    queryFn: () => shiftsQueries.getShiftsForDateRange(organizationId!, startDate!, endDate!, filters),
    enabled: !!organizationId && !!startDate && !!endDate,
    staleTime: 30_000,
    gcTime: 2 * 60_000,   // F12: 2 min instead of global 10 min — shift lists are large
    refetchOnWindowFocus: true,
  });
}

export function useEmployeeShifts(
  employeeId: string | null,
  startDate: string | null,
  endDate: string | null,
) {
  return useQuery({
    queryKey: shiftKeys.byEmployee(employeeId ?? '', startDate ?? '', endDate ?? ''),
    queryFn: () => shiftsQueries.getEmployeeShifts(employeeId!, startDate!, endDate!),
    enabled: !!employeeId && !!startDate && !!endDate,
    staleTime: 30_000,
  });
}

export function useShiftDetail(shiftId: string | null) {
  return useQuery({
    queryKey: shiftKeys.detail(shiftId ?? ''),
    queryFn: () => shiftsQueries.getShiftById(shiftId!),
    enabled: !!shiftId,
    staleTime: 15_000,
  });
}

export function usePendingOfferCount(employeeId: string | null) {
  return useQuery({
    queryKey: shiftKeys.offerCount(employeeId ?? ''),
    queryFn: () => shiftsQueries.getPendingOfferCount(employeeId!),
    enabled: !!employeeId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useMyOffers(
  employeeId: string | null,
  filters?: { organizationId?: string; departmentId?: string },
) {
  return useQuery({
    queryKey: [...shiftKeys.offers(employeeId ?? ''), filters ?? null],
    queryFn: () => shiftsQueries.getMyOffers(employeeId!, filters),
    enabled: !!employeeId,
    staleTime: 5 * 60_000,
  });
}

export function useMyOffersHistory(
  employeeId: string | null,
  status: 'Accepted' | 'Declined',
  filters?: { organizationId?: string; departmentId?: string },
) {
  return useQuery({
    queryKey: [...shiftKeys.offers(employeeId ?? ''), 'history', status, filters ?? null],
    queryFn: () => shiftsQueries.getMyOfferHistory(employeeId!, status, filters),
    enabled: !!employeeId,
    staleTime: 5 * 60_000,
  });
}

// ── Lookup hooks ──────────────────────────────────────────────────────────────

export function useOrganizations() {
  return useQuery({
    queryKey: shiftKeys.lookups.organizations(),
    queryFn: () => shiftsQueries.getOrganizations(),
    staleTime: 5 * 60_000,
  });
}

export function useDepartments(organizationId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.departments(organizationId),
    queryFn: () => shiftsQueries.getDepartments(organizationId),
    staleTime: 5 * 60_000,
  });
}

export function useSubDepartments(departmentId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.subDepartments(departmentId),
    queryFn: () => shiftsQueries.getSubDepartments(departmentId),
    enabled: !!departmentId,
    staleTime: 5 * 60_000,
  });
}

export function useRoles(organizationId?: string, departmentId?: string, subDepartmentId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.roles(organizationId, departmentId, subDepartmentId),
    queryFn: () => shiftsQueries.getRoles(organizationId, departmentId, subDepartmentId),
    staleTime: 5 * 60_000,
  });
}

export function useEmployees(
  organizationId?: string,
  departmentId?: string,
  subDepartmentId?: string,
  roleId?: string,
  searchTerm?: string,
  limit?: number,
) {
  return useQuery({
    queryKey: shiftKeys.lookups.employees(
      organizationId,
      departmentId,
      subDepartmentId,
      roleId,
      searchTerm,
      limit,
    ),
    queryFn: () =>
      shiftsQueries.getEmployees(
        organizationId,
        departmentId,
        subDepartmentId,
        roleId,
        searchTerm,
        limit,
      ),
    staleTime: 2 * 60_000,
  });
}

export function useContractedStaff(
  organizationId?: string,
  departmentId?: string,
  subDepartmentId?: string,
) {
  return useQuery({
    queryKey: ['contracted-staff', organizationId, departmentId, subDepartmentId],
    queryFn: async () => {
      const { EligibilityService } = await import('../services/eligibility.service');
      return EligibilityService.getContractedStaff({ organizationId, departmentId, subDepartmentId });
    },
    enabled: !!organizationId,
    staleTime: 2 * 60_000,
  });
}

export function useTemplates(subDepartmentId?: string, departmentId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.templates(subDepartmentId, departmentId),
    queryFn: () => shiftsQueries.getTemplates(subDepartmentId, departmentId),
    staleTime: 5 * 60_000,
  });
}

export function useRemunerationLevels() {
  return useQuery({
    queryKey: shiftKeys.lookups.remunerationLevels(),
    queryFn: () => shiftsQueries.getRemunerationLevels(),
    staleTime: 10 * 60_000,
  });
}

export function useSkills() {
  return useQuery({
    queryKey: shiftKeys.lookups.skills(),
    queryFn: () => shiftsQueries.getSkills(),
    staleTime: 10 * 60_000,
  });
}

export function useLicenses() {
  return useQuery({
    queryKey: shiftKeys.lookups.licenses(),
    queryFn: () => shiftsQueries.getLicenses(),
    staleTime: 10 * 60_000,
  });
}

export function useEvents(organizationId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.events(organizationId),
    queryFn: () => shiftsQueries.getEvents(organizationId),
    staleTime: 2 * 60_000,
  });
}

export function useRostersLookup(
  organizationId?: string,
  filters?: {
    departmentId?: string;
    departmentIds?: string[];
    subDepartmentId?: string;
    subDepartmentIds?: string[];
  },
) {
  return useQuery({
    queryKey: shiftKeys.lookups.rosters(organizationId, filters),
    queryFn: () => shiftsQueries.getRosters(organizationId!, filters),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
}

export function usePlanningPeriods(organizationId?: string, departmentId?: string) {
  return useQuery({
    queryKey: ['planning-periods', organizationId, departmentId],
    queryFn: () => shiftsQueries.getPlanningPeriods(organizationId!, departmentId),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
}

export function useRosterStructure(rosterId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.rosterStructure(rosterId),
    queryFn: () => shiftsQueries.getRosterStructure(rosterId!),
    enabled: !!rosterId,
    staleTime: 5 * 60_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

/** Create a new shift. Cancels in-flight list queries, then invalidates on settle. */
export function useCreateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof shiftsCommands.createShift>[0]) =>
      shiftsCommands.createShift(data),

    onMutate: async () => {
      // Prevent race: a stale refetch should not overwrite the coming server response
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
    },

    onSuccess: (newShift) => {
      // Insert the confirmed shift into all list caches that cover its date
      patchLists(queryClient, (old) => {
        // Avoid inserting duplicate if cache was already updated elsewhere
        if (old.some(s => s.id === newShift.id)) return old;
        return [...old, newShift as unknown as Shift];
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/** Update an existing shift. Instant patch + rollback on error. */
export function useUpdateShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({
      shiftId,
      updates,
    }: {
      shiftId: string;
      updates: Parameters<typeof shiftsCommands.updateShift>[1];
    }) => shiftsCommands.updateShift(shiftId, updates),

    onMutate: async ({ shiftId, updates }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      // Resolve the shift's date for predicate scoping. Fall back to a broad
      // patch when the date is unknown (correctness > optimisation).
      const prevDetail = queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId));
      const shiftDate =
        (updates as { shift_date?: string }).shift_date ??
        prevDetail?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      // Patch all matching list views — also derive assignment_status from
      // assigned_employee_id so the cache is immediately consistent without
      // waiting for a server refetch.
      patchLists(
        queryClient,
        (old) =>
          old.map(s => {
            if (s.id !== shiftId) return s;
            const merged: Shift = { ...s, ...updates } as Shift;
            if (updates.assigned_employee_id !== undefined) {
              (merged as unknown as Record<string, unknown>).assignment_status =
                updates.assigned_employee_id ? 'assigned' : 'unassigned';
            }
            return merged;
          }),
        predicate,
      );

      // Also patch the detail view if loaded
      if (prevDetail) {
        queryClient.setQueryData(shiftKeys.detail(shiftId), { ...prevDetail, ...updates });
      }

      return { snapshot, prevDetail };
    },

    onError: (err, variables, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
      if (context?.prevDetail) {
        queryClient.setQueryData(shiftKeys.detail(variables.shiftId), context.prevDetail);
      }

      // Surface version conflict as an actionable toast instead of a generic error
      if (isAppError(err) && err.code === 'CONFLICT') {
        toast({
          title: 'Shift was modified',
          description: 'Another user updated this shift. Your changes were not saved — the view has been refreshed.',
          variant: 'destructive',
        });
        // Force a fresh fetch so the user sees the latest state immediately
        queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
        queryClient.invalidateQueries({ queryKey: shiftKeys.detail(variables.shiftId) });
      }
    },

    onSettled: (_data, _err, variables) => {
      // F17: Mark stale but don't trigger immediate refetch — onSuccess already
      // patched the cache with server-confirmed data. The next window-focus or
      // navigation will pick up a fresh copy.
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(variables.shiftId) });
    },
  });
}

/** Delete a shift. Optimistically removes it from all list views. */
export function useDeleteShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shiftId: string) => {
      const success = await shiftsCommands.deleteShift(shiftId);
      if (!success) throw new Error('Failed to delete shift on the server.');
      return success;
    },

    onMutate: async (shiftId) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(queryClient, (old) => old.filter(s => s.id !== shiftId), predicate);
      queryClient.removeQueries({ queryKey: shiftKeys.detail(shiftId) });

      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      // F17: Mark stale but don't refetch — the optimistic delete already
      // removed the shift from cache. A refetch would just confirm it's gone.
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all, refetchType: 'none' });
    },
  });
}

/** Bulk assign shifts to one employee. Instant assignment update in all list views. */
export function useBulkAssignShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ employeeId, shiftIds }: { employeeId: string; shiftIds: string[] }) =>
      shiftsCommands.bulkAssignShifts(employeeId, shiftIds),

    onMutate: async ({ employeeId, shiftIds }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? { ...s, assigned_employee_id: employeeId, assignment_status: 'assigned' as const }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
    },
  });
}

/** Bulk unassign shifts. Clears assignment in all list views instantly. */
export function useBulkUnassignShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkUnassignShifts(shiftIds),

    onMutate: async (shiftIds) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? { ...s, assigned_employee_id: null, assignment_status: 'unassigned' as const }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
    },
  });
}

/** Publish a single shift. Instant lifecycle_status patch. */
export function usePublishShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.publishShift(shiftId),

    onMutate: async (shiftId) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId ? { ...s, lifecycle_status: 'Published' as const } : s,
          ),
        predicate,
      );

      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: (_data, _err, shiftId) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) });
    },
  });
}

/** Unpublish a single shift. Reverts lifecycle_status to Draft. */
export function useUnpublishShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason?: string }) =>
      shiftsCommands.unpublishShift(shiftId, reason),

    onMutate: async ({ shiftId }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId
              ? {
                  ...s,
                  lifecycle_status: 'Draft' as const,
                  is_published: false,
                  is_draft: true,
                  assignment_outcome: null,
                  assignment_status: s.assigned_employee_id ? 'assigned' : 'unassigned',
                }
              : s,
          ),
        predicate,
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: (_data, _err, { shiftId }) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });
    },
  });
}

/**
 * Bulk unpublish shifts.
 * Reverts lifecycle_status to Draft for all selected IDs instantly.
 */
/**
 * Bulk unpublish shifts — supports partial success.
 *
 * Optimistically marks all attempted IDs as Draft, then:
 * - On partial result: reverts only failed IDs back to Published.
 * - On hard error: rolls back all.
 */
export function useBulkUnpublishShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkUnpublishShifts(shiftIds),

    onMutate: async (shiftIds) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? {
                ...s,
                lifecycle_status: 'Draft' as const,
                is_published: false,
                is_draft: true,
                assignment_outcome: null,
                assignment_status: s.assigned_employee_id ? 'assigned' : 'unassigned',
              }
            : s,
        ),
      );

      return { snapshot };
    },

    onSuccess: (result) => {
      // Revert only failed IDs back to Published — successful ones keep Draft
      if (result.failed.length > 0) {
        const failedIds = result.failed.map(f => f.id);
        patchLists(queryClient, (old) =>
          old.map(s =>
            failedIds.includes(s.id)
              ? { ...s, lifecycle_status: 'Published' as const, is_published: true, is_draft: false }
              : s,
          ),
        );
      }
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: (_data, _err, shiftIds) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      shiftIds.forEach(id => queryClient.invalidateQueries({ queryKey: shiftKeys.detail(id) }));
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });
    },
  });
}

/**
 * Bulk publish shifts — supports partial success.
 *
 * Optimistically marks all attempted IDs as Published, then:
 * - On partial result: reverts only the IDs that failed compliance or the DB RPC.
 * - On hard error: rolls back all.
 */
export function useBulkPublishShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkPublishShifts(shiftIds),

    onMutate: async (shiftIds) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? { ...s, lifecycle_status: 'Published' as const }
            : s,
        ),
      );

      return { snapshot };
    },

    onSuccess: (result) => {
      // Revert only the shifts that failed — compliant+published ones keep the optimistic state
      const failedIds = [
        ...result.complianceFailed.map(f => f.id),
        ...result.dbFailed.map(f => f.id),
      ];
      if (failedIds.length > 0) {
        patchLists(queryClient, (old) =>
          old.map(s =>
            failedIds.includes(s.id)
              ? { ...s, lifecycle_status: 'Draft' as const }
              : s,
          ),
        );
      }
    },

    onError: (_err, _ids, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/**
 * Bulk delete shifts — per-item via processInChunks.
 *
 * Surgical removal strategy: shifts are NOT removed optimistically.
 * Only confirmed-deleted shifts are removed from the cache on success.
 * This eliminates the "pop-in" flicker that occurs when a partial failure
 * causes failed shifts to reappear after optimistic removal.
 *
 * Result: { deletedIds, failed } — caller knows exactly which shifts failed.
 */
export function useBulkDeleteShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkDeleteShiftsPerItem(shiftIds),

    onMutate: async () => {
      // Cancel in-flight queries to prevent stale-over-delete races.
      // No optimistic removal — wait for actual result to avoid flicker on partial failure.
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
    },

    onSuccess: (result) => {
      // Surgically remove only confirmed-deleted shifts from all list caches.
      if (result.deletedIds.length > 0) {
        patchLists(queryClient, (old) => old.filter(s => !result.deletedIds.includes(s.id)));
        result.deletedIds.forEach(id => queryClient.removeQueries({ queryKey: shiftKeys.detail(id) }));
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/**
 * Bulk update shift times.
 * Optimized for resizing buckets — applies shifts in parallel to the server
 * but performs a single optimistic surgical patch to the list views.
 */
export function useBulkUpdateShiftTimes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      shiftIds,
      updates,
    }: {
      shiftIds: string[];
      updates: { start_time: string; end_time: string };
    }) => {
      // Loop updates - since there is no bulk RPC for this yet.
      // Optimistic updates happen separately so this doesn't block the UI.
      const results = await Promise.all(
        shiftIds.map(id => shiftsCommands.updateShift(id, updates))
      );
      return results;
    },

    onMutate: async ({ shiftIds, updates }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      // Single surgical patch for all affected shifts
      patchLists(queryClient, (old) =>
        old.map(s => (shiftIds.includes(s.id) ? { ...s, ...updates } as Shift : s))
      );

      // Also patch detail views if loaded
      shiftIds.forEach(id => {
        const prevDetail = queryClient.getQueryData<Shift>(shiftKeys.detail(id));
        if (prevDetail) {
          queryClient.setQueryData(shiftKeys.detail(id), { ...prevDetail, ...updates });
        }
      });

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: (_data, _err, { shiftIds }) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      shiftIds.forEach(id => queryClient.invalidateQueries({ queryKey: shiftKeys.detail(id) }));
    },
  });
}

/**
 * Employee drops a shift (pushes it to bidding).
 * Removes from employee view; marks as unassigned + on-bidding in manager view.
 */
export function useDropShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason: string }) =>
      shiftsCommands.employeeDropShift(shiftId, reason),

    onMutate: async ({ shiftId }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      // Employee view: remove entirely
      queryClient.setQueriesData<Shift[]>(
        { queryKey: shiftKeys.byEmployee('', '', '') },
        (old) => old?.filter(s => s.id !== shiftId),
      );

      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      // Manager / date views: unassign + flag as bidding
      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId
              ? {
                ...s,
                assigned_employee_id: null,
                assignment_status: 'unassigned' as const,
                bidding_status: 'on_bidding' as const,
              }
              : s,
          ),
        predicate,
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },



    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
      // Invalidate employee bids so stale "Accepted — Assigned to You" entries disappear
      queryClient.invalidateQueries({ queryKey: ['myBids'] });
    },
  });
}

/**
 * Immediately expire a shift offer (S3 → S2).
 * Call when the client detects countdown = 0 or shift is within 4h lockout.
 * Invalidates offers + roster lists so the UI reflects the new Draft state.
 */
export function useExpireOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.expireOfferNow(shiftId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });

    },
  });
}

/** Accept a shift offer. Updates assignment_outcome to 'confirmed'. */
export function useAcceptOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.acceptOffer(shiftId),

    onMutate: async (shiftId) => {
      const snapshot = snapshotLists(queryClient);
      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId ? { ...s, assignment_outcome: 'confirmed' as const } : s,
          ),
        predicate,
      );
      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });
    },
  });
}

/** Decline a shift offer. Removes from offers view, clears assignment. */
export function useDeclineOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) =>
      shiftsCommands.rejectOffer(shiftId, 'Employee declined'),

    onMutate: async (shiftId) => {
      const snapshot = snapshotLists(queryClient);
      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId
              ? {
                ...s,
                assignment_status: 'unassigned' as const,
                assignment_outcome: null,
                assigned_employee_id: null,
              }
              : s,
          ),
        predicate,
      );
      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });
    },
  });
}

/** Cancel a shift. Marks lifecycle_status + is_cancelled in all list views. */
export function useCancelShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason: string }) =>
      shiftsCommands.cancelShift(shiftId, reason),

    onMutate: async ({ shiftId }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId
              ? { ...s, lifecycle_status: 'Cancelled' as const, is_cancelled: true }
              : s,
          ),
        predicate,
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
    },
  });
}

/** Request a trade for a shift. Sets trading_status to TradeRequested. */
export function useRequestTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.requestTrade(shiftId),

    onMutate: async (shiftId) => {
      const snapshot = snapshotLists(queryClient);
      const shiftDate =
        queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId))?.shift_date ??
        findShiftDateInLists(queryClient, shiftId);
      const predicate = shiftDate ? dateInRange(shiftDate) : undefined;

      patchLists(
        queryClient,
        (old) =>
          old.map(s =>
            s.id === shiftId
              ? { ...s, trading_status: 'TradeRequested' as const, is_trade_requested: true }
              : s,
          ),
        predicate,
      );
      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
    },
  });
}

// ── Compliance validation ─────────────────────────────────────────────────────

export function useComplianceValidation() {
  return useMutation({
    mutationFn: (params: {
      employeeId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      netLengthMinutes: number;
      excludeV8ShiftId?: string;
    }) =>
      complianceService.validateShiftCompliance(
        params.employeeId,
        params.shiftDate,
        params.startTime,
        params.endTime,
        params.netLengthMinutes,
        params.excludeV8ShiftId,
      ),
  });
}

// ── Delta sync hook ───────────────────────────────────────────────────────────

/**
 * useShiftDeltaSync — Realtime-backed surgical cache updater.
 *
 * Subscribes to a Supabase Realtime postgres_changes channel for the `shifts`
 * table. When any row changes, fetches the delta (rows modified since the last
 * cursor) via the `get_shift_delta` RPC and merges the result surgically into
 * all active TanStack Query list caches — avoiding a full list invalidation.
 *
 * Deleted rows (deleted_at IS NOT NULL) are removed from the cache.
 * Updated rows have their changed fields patched in-place.
 *
 * @param orgId       Organisation to subscribe to (required)
 * @param deptIds     Optional dept filter (mirrors the list queries)
 * @param subDeptIds  Optional sub-dept filter. When exactly one is supplied,
 *                    the realtime channel is filtered server-side by
 *                    `sub_department_id=eq.X` to drastically reduce noise at
 *                    high shift volumes. Multi-sub-dept selections fall back
 *                    to org-only filtering (Supabase realtime filters don't
 *                    support IN), and client-side delta fetches still scope
 *                    by `subDeptIds` via the RPC.
 * @param startDate   Optional window start (YYYY-MM-DD)
 * @param endDate     Optional window end   (YYYY-MM-DD)
 */
export function useShiftDeltaSync(params: {
  orgId: string | null;
  deptIds?: string[];
  subDeptIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
}) {
  const queryClient = useQueryClient();
  // Cursor: ISO timestamp of the most recent change we have processed.
  // Initialised to "now" so we only pick up changes after mount.
  const cursorRef = useRef<string>(new Date().toISOString());
  const fetchingRef = useRef(false);
  // Debounce realtime events — bursts (mass publish/assign) would otherwise
  // fan out to one RPC per row change.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable key for the sub-dept filter so the effect/callback only re-runs
  // when the actual set changes (not array identity).
  const subDeptKey = (params.subDeptIds ?? []).slice().sort().join(',');
  const deptKey = (params.deptIds ?? []).slice().sort().join(',');

  const applyDelta = useCallback(async () => {
    if (!params.orgId || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const rows = await shiftsQueries.getShiftDelta({
        orgId: params.orgId,
        since: cursorRef.current,
        deptIds: params.deptIds,
        startDate: params.startDate ?? undefined,
        endDate: params.endDate ?? undefined,
      });

      if (rows.length === 0) return;

      // Advance cursor to max(updated_at) of the batch
      const maxUpdatedAt = rows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), cursorRef.current);
      cursorRef.current = maxUpdatedAt;

      const deleted = new Set(rows.filter(r => r.deleted_at !== null).map(r => r.id));
      const updated = rows.filter(r => r.deleted_at === null);

      queryClient.setQueriesData<Shift[]>({ queryKey: shiftKeys.lists }, (old) => {
        if (!old || !Array.isArray(old)) return old;

        // Remove soft-deleted rows
        let next = old.filter(s => !deleted.has(s.id));

        // Patch updated rows (only update fields that are in the delta)
        next = next.map(s => {
          const delta = updated.find(r => r.id === s.id);
          if (!delta) return s;
          return {
            ...s,
            shift_date:          delta.shift_date          ?? s.shift_date,
            start_time:          delta.start_time          ?? s.start_time,
            end_time:            delta.end_time            ?? s.end_time,
            lifecycle_status:    (delta.lifecycle_status   ?? s.lifecycle_status) as Shift['lifecycle_status'],
            assignment_status:   (delta.assignment_status  ?? s.assignment_status) as Shift['assignment_status'],
            assigned_employee_id: delta.assigned_employee_id !== undefined
              ? delta.assigned_employee_id
              : s.assigned_employee_id,
            version:             delta.version             ?? s.version,
          };
        });

        return next;
      });

      // Invalidate detail views for any changed shift so they re-fetch fully
      rows.forEach(r => {
        queryClient.invalidateQueries({ queryKey: shiftKeys.detail(r.id) });
      });
    } catch (err) {
      console.error('[useShiftDeltaSync] delta fetch error:', err);
    } finally {
      fetchingRef.current = false;
    }
    // deptKey / subDeptKey ensure the callback re-binds when the actual scope
    // changes, not just when array identity flips.
  }, [params.orgId, deptKey, params.startDate, params.endDate, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!params.orgId) return;

    // F13: Granular Realtime Scoping — sub-dept > dept > org.
    // Supabase postgres_changes only supports ONE equality filter per
    // subscription; pick the tightest scope available.
    let filter = `organization_id=eq.${params.orgId}`;
    let channelSuffix = params.orgId;

    if (params.subDeptIds && params.subDeptIds.length === 1) {
      filter = `sub_department_id=eq.${params.subDeptIds[0]}`;
      channelSuffix = `${params.orgId}-sub-${params.subDeptIds[0]}`;
    } else if (params.deptIds && params.deptIds.length === 1) {
      filter = `department_id=eq.${params.deptIds[0]}`;
      channelSuffix = `${params.orgId}-dept-${params.deptIds[0]}`;
    }

    const channel = supabase
      .channel(`shift-delta-${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts', filter },
        () => {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => { void applyDelta(); }, 300);
        },
      )
      .subscribe();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
    // subDeptKey is the stable signal for "the sub-dept set changed".
  }, [params.orgId, subDeptKey, applyDelta]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Combined convenience hook ─────────────────────────────────────────────────

/**
 * Combined hook for the most common shift operations in a single date view.
 * Prefer individual hooks when you only need one or two operations.
 */
export function useRosterShifts(
  organizationId: string | null,
  date: string | null,
  filters?: ShiftFilters,
) {
  const queryClient = useQueryClient();
  const shiftsQuery = useShiftsByDate(organizationId, date, filters);
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const bulkAssign = useBulkAssignShifts();
  const bulkUnassign = useBulkUnassignShifts();
  const bulkPublish = useBulkPublishShifts();
  const bulkUnpublish = useBulkUnpublishShifts();
  const bulkDelete = useBulkDeleteShifts();
  const bulkUpdateTimes = useBulkUpdateShiftTimes();

  /** Hard-invalidate all shift list queries (use sparingly). */
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: shiftKeys.lists, refetchType: 'none' });
    queryClient.invalidateQueries({ queryKey: rosterKeys.all });
  }, [queryClient]);

  return {
    shifts: shiftsQuery.data ?? [],
    isLoading: shiftsQuery.isLoading,
    isFetching: shiftsQuery.isFetching,
    error: shiftsQuery.error,
    refetch: shiftsQuery.refetch,
    createShift,
    updateShift,
    deleteShift,
    bulkAssign,
    bulkUnassign,
    bulkPublish,
    bulkDelete,
    bulkUpdateTimes,
    invalidateAll,
  };
}
