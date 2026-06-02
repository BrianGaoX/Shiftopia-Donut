import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/realtime/client';
import { broadcastKeys } from '../api/queryKeys';

export interface AnalyticsData {
    totalGroups: number;
    totalBroadcasts: number;
    totalMembers: number;
    recentBroadcasts: Array<{
        id: string;
        subject: string;
        groupName: string;
        sentAt: string;
    }>;
}

interface UseBroadcastAnalyticsReturn {
    analytics: AnalyticsData | null;
    isLoading: boolean;
    error: string | null;
    refetch: () => void;
}

// Single RPC call — replaces 4-6 client-side queries
async function fetchBroadcastAnalytics(): Promise<AnalyticsData> {
    const { data, error } = await supabase.rpc('get_broadcast_analytics');
    if (error) throw error;
    return data as unknown as AnalyticsData;
}

export function useBroadcastAnalytics(): UseBroadcastAnalyticsReturn {
    const { user } = useAuth();

    const query = useQuery({
        queryKey: broadcastKeys.analytics.all,
        queryFn: fetchBroadcastAnalytics,
        enabled: !!user?.id,
        staleTime: 60_000,
    });

    return {
        analytics: query.data ?? null,
        isLoading: query.isPending || query.isLoading,
        error: query.error ? (query.error instanceof Error ? query.error.message : 'Failed to load analytics') : null,
        refetch: () => { void query.refetch(); },
    };
}
