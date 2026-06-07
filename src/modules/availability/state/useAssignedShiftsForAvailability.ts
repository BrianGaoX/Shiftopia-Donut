/**
 * useAssignedShiftsForAvailability — React Query hook + real-time subscription
 *
 * Fetches the user's assigned shifts for the current month and subscribes to
 * real-time changes on the `shifts` table. Any INSERT/UPDATE/DELETE that affects
 * the employee's assignments immediately invalidates the cache so the calendar
 * re-renders with up-to-date locked slots.
 *
 * RESPONSIBILITIES:
 * - Query assigned shifts for the displayed month
 * - Subscribe to shifts table changes for this employee
 * - Invalidate on any relevant event (assign, cancel, drop)
 *
 * MUST NOT:
 * - Render UI
 * - Handle edit state
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';

import { supabase } from '@/platform/supabase/client';
import {
  getAssignedShiftsForAvailability,
  AssignedShiftInterval,
} from '../api/availability-view.api';
import { resolveProfileId } from '../api/availability.service';

// ============================================================================
// QUERY KEY FACTORY
// ============================================================================

export const assignedShiftsQueryKey = (
  profileId: string,
  startDate: string,
  endDate: string
) => ['availability', 'assigned-shifts', profileId, startDate, endDate] as const;

// ============================================================================
// HOOK
// ============================================================================

export interface UseAssignedShiftsForAvailabilityResult {
  assignedShifts: AssignedShiftInterval[];
  isLoading: boolean;
}

/**
 * Hook: fetch assigned shifts (locked intervals) for the given month.
 *
 * Real-time: subscribes to any change on the shifts table where
 * assigned_employee_id matches the current user. On change, the query is
 * invalidated so the calendar reflects the new lock state instantly.
 *
 * Events that trigger refresh:
 *   - Shift assigned   (INSERT or UPDATE: assigned_employee_id set)
 *   - Shift unassigned (UPDATE: assigned_employee_id cleared)
 *   - Shift cancelled  (UPDATE: lifecycle_status = 'Cancelled')
 *   - Shift dropped    (DELETE or status change)
 */
export function useAssignedShiftsForAvailability(
  profileId: string = 'current-user',
  month: Date = new Date()
): UseAssignedShiftsForAvailabilityResult {
  const queryClient = useQueryClient();
  const startDate   = format(startOfMonth(month), 'yyyy-MM-dd');
  const endDate     = format(endOfMonth(month), 'yyyy-MM-dd');
  const channelRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: assignedShifts = [], isLoading } = useQuery({
    queryKey: assignedShiftsQueryKey(profileId, startDate, endDate),
    queryFn: async () => {
      const resolvedId = await resolveProfileId(profileId);
      return getAssignedShiftsForAvailability(resolvedId, startDate, endDate);
    },
    staleTime: 1000 * 30,   // 30 s — refreshed by real-time anyway
    retry: 2,
  });

  // ── Real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const resolvedId = await resolveProfileId(profileId);
      if (cancelled) return;

      const channelName = `avail-locks-${resolvedId}-${startDate}`;

      // Clean up any previous subscription for this employee
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }

      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shifts',
            filter: `assigned_employee_id=eq.${resolvedId}`,
          },
          () => {
            // Any mutation to this employee's shifts → invalidate locked intervals
            queryClient.invalidateQueries({
              queryKey: assignedShiftsQueryKey(profileId, startDate, endDate),
            });
          }
        )
        .subscribe();

      channelRef.current = channel;
    };

    setup();

    return () => {
      cancelled = true;
      channelRef.current?.unsubscribe();
      channelRef.current = null;
    };
  }, [profileId, startDate, endDate, queryClient]);

  return { assignedShifts, isLoading };
}
