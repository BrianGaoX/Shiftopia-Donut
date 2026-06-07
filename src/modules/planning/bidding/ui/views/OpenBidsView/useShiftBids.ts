// src/modules/planning/bidding/ui/views/OpenBidsView/useShiftBids.ts

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import type { EmployeeBid } from './types';

interface UseShiftBidsReturn {
  bids: EmployeeBid[];
  isLoading: boolean;
  refetch: () => void;
}

export function useShiftBids(shiftId: string | null): UseShiftBidsReturn {
  const {
    data: bids = [],
    isLoading,
    refetch
  } = useQuery({
    queryKey: shiftKeys.bids(shiftId || ''),
    queryFn: async () => {
      if (!shiftId) return [];

      const { data: rows, error } = await supabase
        .from('shift_bids')
        .select(`
          id, shift_id, employee_id, status, created_at,
          profiles!shift_bids_employee_id_fkey(
            id, full_name, first_name, last_name, employment_type
          )
        `)
        .eq('shift_id', shiftId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching shift bids:', error);
        return [];
      }

      return (rows || []).map((b: any) => {
        const profile = b.profiles;
        const name = profile
          ? (profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown')
          : 'Unknown';
        return {
          id: b.id,
          shiftId: b.shift_id,
          employeeId: b.employee_id,
          employeeName: name,
          employmentType: profile?.employment_type || 'Casual',
          status: b.status,
          submittedAt: b.created_at,
          isWinner: b.status === 'accepted' || b.status === 'assigned',
        };
      });
    },
    enabled: !!shiftId,
    staleTime: 10000,
  });

  return { bids, isLoading, refetch };
}
