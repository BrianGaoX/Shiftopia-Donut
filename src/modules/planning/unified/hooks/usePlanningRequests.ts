/**
 * usePlanningRequests
 *
 * Paginated list of PlanningRequest rows filtered by any combination of:
 *   type, status (scalar or array), initiated_by, target_employee_id,
 *   shift_id, page, pageSize.
 *
 * Uses TanStack Query (useQuery) to match the existing swaps hook pattern
 * in this codebase. The query key encodes every filter field so React Query
 * re-runs the fetch automatically whenever any filter changes.
 *
 * Returns:
 *   requests  — page slice of PlanningRequest[]
 *   total     — total matching row count (for pagination controls)
 *   isLoading — true while the initial fetch is in-flight
 *   error     — Error or null
 *   refetch   — manual invalidation trigger
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { PlanningRequest, PlanningRequestStatus } from '../types';

const db = supabase as any;

// =============================================================================
// TYPES
// =============================================================================

export interface UsePlanningRequestsFilters {
  type?: 'BID' | 'SWAP';
  status?: PlanningRequestStatus | PlanningRequestStatus[];
  /** Filter to requests initiated by this employee */
  initiated_by?: string;
  /** Filter to requests where this employee is the target */
  target_employee_id?: string;
  /** Filter to requests linked to a specific shift */
  shift_id?: string;
  /** 1-indexed page number (default: 1) */
  page?: number;
  /** Rows per page (default: 20) */
  pageSize?: number;
}

interface PlanningRequestsPage {
  requests: PlanningRequest[];
  total: number;
}

// =============================================================================
// QUERY KEY FACTORY
// =============================================================================

export const planningRequestKeys = {
  all: ['planningRequests'] as const,
  list: (filters: UsePlanningRequestsFilters) =>
    ['planningRequests', 'list', filters] as const,
  detail: (id: string) =>
    ['planningRequests', 'detail', id] as const,
};

// =============================================================================
// CORE FETCH FUNCTION
// =============================================================================

async function fetchPlanningRequests(
  filters: UsePlanningRequestsFilters,
): Promise<PlanningRequestsPage> {
  const {
    type,
    status,
    initiated_by,
    target_employee_id,
    shift_id,
    page = 1,
    pageSize = 20,
  } = filters;

  const offset = (page - 1) * pageSize;
  const rangeEnd = offset + pageSize - 1;

  // Start query with exact count for pagination
  let query = db
    .from('planning_requests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, rangeEnd);

  // Apply optional filters
  if (type) {
    query = query.eq('type', type);
  }

  if (status) {
    if (Array.isArray(status)) {
      query = query.in('status', status);
    } else {
      query = query.eq('status', status);
    }
  }

  if (initiated_by) {
    query = query.eq('initiated_by', initiated_by);
  }

  if (target_employee_id) {
    query = query.eq('target_employee_id', target_employee_id);
  }

  if (shift_id) {
    query = query.eq('shift_id', shift_id);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message ?? 'Failed to fetch planning requests');
  }

  return {
    requests: (data ?? []) as PlanningRequest[],
    total: count ?? 0,
  };
}

// =============================================================================
// HOOK
// =============================================================================

export interface UsePlanningRequestsResult {
  requests: PlanningRequest[];
  total: number;
  isLoading: boolean;
  error: Error | null;
  refetch: UseQueryResult<PlanningRequestsPage>['refetch'];
}

export function usePlanningRequests(
  filters: UsePlanningRequestsFilters = {},
): UsePlanningRequestsResult {
  // Determine whether the query should fire — require at least one scoping filter
  // to avoid inadvertently fetching the entire table without context.
  const hasScope =
    !!filters.initiated_by ||
    !!filters.target_employee_id ||
    !!filters.shift_id ||
    !!filters.type ||
    !!filters.status;

  const query = useQuery<PlanningRequestsPage, Error>({
    queryKey: planningRequestKeys.list(filters),
    queryFn: () => fetchPlanningRequests(filters),
    enabled: hasScope,
    staleTime: 30_000,   // 30 seconds — fast enough for planning UI
    gcTime: 5 * 60_000,  // keep unused cache for 5 minutes
  });

  return {
    requests: query.data?.requests ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
