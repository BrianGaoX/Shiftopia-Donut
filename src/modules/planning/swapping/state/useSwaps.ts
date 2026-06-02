import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { swapsApi, ShiftSwap, CreateSwapData } from '../api/swaps.api';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';

/**
 * Hook for managing shift swaps with real database data
 */
export const useSwaps = (scopeOverrides?: { 
    organizationId?: string; 
    departmentId?: string | string[] | null; 
    subDepartmentId?: string | string[] | null 
}) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user, activeContract } = useAuth();
    const orgSelection = useOrgSelection();
    const userId = user?.id || '';

    // Hierarchy context: Use overrides if provided, otherwise fallback to Header selection (then active contract)
    const hierarchy = {
        organizationId: scopeOverrides?.organizationId || orgSelection.organizationId || activeContract?.organizationId,
        departmentId: scopeOverrides?.departmentId !== undefined ? scopeOverrides.departmentId : (orgSelection.departmentId || activeContract?.departmentId),
        subDepartmentId: scopeOverrides?.subDepartmentId !== undefined ? scopeOverrides.subDepartmentId : (orgSelection.subDepartmentId || activeContract?.subDepartmentId),
    };

    // Query: Get my swap requests (shifts I've posted for swap)
    const mySwapRequestsQuery = useQuery({
        queryKey: ['mySwapRequests', userId, hierarchy.organizationId],
        queryFn: () => userId ? swapsApi.getMySwaps(userId, { organizationId: hierarchy.organizationId }) : Promise.resolve([]),
        enabled: !!userId,
        staleTime: 60_000, // 1 minute staleTime
    });

    // Query: Get available swaps from other employees (Locked to Org/Dept)
    // IMPORTANT: Available Swaps requires EXPLICIT header selection (no fallback to activeContract)
    const availableSwapsQuery = useQuery({
        queryKey: ['availableSwaps', userId, hierarchy.organizationId, hierarchy.departmentId, hierarchy.subDepartmentId],
        queryFn: () => userId && hierarchy.organizationId ? swapsApi.getAvailableSwaps(userId, {
            organizationId: hierarchy.organizationId,
            departmentId: hierarchy.departmentId || undefined,
            subDepartmentId: hierarchy.subDepartmentId || undefined
        }) : Promise.resolve([]),
        enabled: !!userId && !!hierarchy.organizationId,
        staleTime: 60_000, // 1 minute staleTime
    });

    // Query: Get pending manager approvals (locked to org hierarchy)
    const pendingApprovalsQuery = useQuery({
        queryKey: ['pendingSwapApprovals', hierarchy.organizationId, hierarchy.departmentId, hierarchy.subDepartmentId],
        queryFn: () => hierarchy.organizationId
            ? swapsApi.fetchSwapRequests({
                status: 'MANAGER_PENDING',
                organizationId: hierarchy.organizationId,
                departmentId: hierarchy.departmentId || undefined,
                subDepartmentId: hierarchy.subDepartmentId || undefined
            })
            : Promise.resolve([]),
        enabled: !!hierarchy.organizationId,
        staleTime: 60_000, // 1 minute staleTime
    });

    // Query: Get full offer details for the current user's active offers (locked shifts)
    const myActiveOfferDetailsQuery = useQuery({
        queryKey: ['myActiveOfferDetails', userId],
        queryFn: () => userId ? swapsApi.getMyActiveOfferDetails(userId) : Promise.resolve([]),
        enabled: !!userId,
        staleTime: 2 * 60_000, // 2 minutes staleTime (surgically invalidated on mutation)
    });

    // Query: Get swap IDs where I have an active offer (for "Already Offered" badge)
    const myActiveOffersQuery = useQuery({
        queryKey: ['myActiveOffers', userId],
        queryFn: () => userId ? swapsApi.getMyActiveOffers(userId) : Promise.resolve(new Set<string>()),
        enabled: !!userId,
        staleTime: 2 * 60_000, // 2 minutes staleTime (surgically invalidated on mutation)
    });

    // Mutation: Create a swap request
    const createSwapMutation = useMutation({
        mutationFn: (data: CreateSwapData) => swapsApi.createSwapRequest(
            data.requesterV8ShiftId,
            data.requestedByEmployeeId,
            data.swapWithEmployeeId ?? null,
            data.reason ?? null
        ),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['mySwapRequests'] }),
                // Invalidate roster caches using shared keys
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.byEmployee(userId, '', '') }) // Approximate invalidation
            ]);
            toast({
                title: 'Swap Posted',
                description: 'Your shift is now available for swap.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to create swap request.',
                variant: 'destructive',
            });
            console.error('Create swap error:', error);
        },
    });

    // Query key factory for offers to manual invalidation
    const offersQueryKey = (swapId: string) => ['swapOffers', swapId];

    // Mutation: Make an offer on a swap
    const makeOfferMutation = useMutation({
        mutationFn: ({ swapId, targetV8ShiftId }: { swapId: string; targetV8ShiftId?: string }) => {
            if (!userId) throw new Error("User ID required to make an offer");
            return swapsApi.makeOffer(swapId, targetV8ShiftId, userId);
        },
        onSuccess: async (_, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['availableSwaps'] }),
                queryClient.invalidateQueries({ queryKey: ['mySwapRequests'] }),
                queryClient.invalidateQueries({ queryKey: ['myActiveOffers'] }),
                queryClient.invalidateQueries({ queryKey: ['myActiveOfferDetails'] }),
                queryClient.invalidateQueries({ queryKey: ['swapOffers', variables.swapId] }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
            ]);
            toast({
                title: 'Offer Sent',
                description: 'Your offer has been sent to the employee.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to send offer.',
                variant: 'destructive',
            });
            console.error('Make offer error:', error);
        },
    });

    // Mutation: Accept an offer
    const acceptOfferMutation = useMutation({
        mutationFn: ({ swapId, offerId, offererId, offeredV8ShiftId }: { swapId: string; offerId: string; offererId: string; offeredV8ShiftId?: string }) =>
            swapsApi.acceptTrade(swapId, offerId, offererId, offeredV8ShiftId),
        onSuccess: async (_, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['mySwapRequests'] }),
                queryClient.invalidateQueries({ queryKey: ['pendingSwapApprovals'] }),
                queryClient.invalidateQueries({ queryKey: ['swapOffers'] }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.all })
            ]);
            toast({
                title: 'Offer Accepted',
                description: 'Awaiting manager approval.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to accept offer.',
                variant: 'destructive',
                // Add more detailed error info for debugging if available
            });
            console.error('Accept offer error:', error);
        },
    });

    // Mutation: Decline an offer
    const declineOfferMutation = useMutation({
        mutationFn: (offerId: string) => swapsApi.rejectTrade(offerId), // Updated to rejectTrade
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['swapOffers'] });
            toast({
                title: 'Offer Declined',
                description: 'The offer has been declined.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to decline offer.',
                variant: 'destructive',
            });
            console.error('Decline offer error:', error);
        },
    });

    // Mutation: Cancel swap request
    const cancelSwapMutation = useMutation({
        mutationFn: (swapId: string) => swapsApi.cancelSwapRequest(swapId),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['mySwapRequests'] }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }), // Unified Invalidation
            ]);
            toast({
                title: 'Swap Cancelled',
                description: 'Your swap request has been cancelled.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to cancel swap request.',
                variant: 'destructive',
            });
            console.error('Cancel swap error:', error);
        },
    });

    // Mutation: Manager approves swap
    const approveSwapMutation = useMutation({
        mutationFn: (swapId: string) => swapsApi.approveSwapRequest(swapId),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pendingSwapApprovals'] }),
                queryClient.invalidateQueries({ queryKey: ['mySwapRequests'] }),
                queryClient.invalidateQueries({ queryKey: ['availableSwaps'] }),
                queryClient.invalidateQueries({ queryKey: ['swapOffers'] }),
                // MAJOR FIX: Invalidate Roster using unified keys
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
            ]);
            toast({
                title: 'Swap Approved',
                description: 'The shifts have been reassigned.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to approve swap.',
                variant: 'destructive',
            });
            console.error('Approve swap error:', error);
        },
    });

    // Mutation: Manager rejects swap
    const rejectSwapMutation = useMutation({
        mutationFn: ({ swapId, reason }: { swapId: string; reason: string }) =>
            swapsApi.rejectSwapRequest(swapId, reason),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['pendingSwapApprovals'] }),
                queryClient.invalidateQueries({ queryKey: ['mySwapRequests'] }),
                queryClient.invalidateQueries({ queryKey: ['availableSwaps'] }),
                // Unified Invalidation
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
            ]);
            toast({
                title: 'Swap Rejected',
                description: 'The swap request has been rejected.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Error',
                description: 'Failed to reject swap.',
                variant: 'destructive',
            });
            console.error('Reject swap error:', error);
        },
    });

    return {
        // Queries
        mySwapRequests: mySwapRequestsQuery.data || [],
        availableSwaps: availableSwapsQuery.data || [],
        pendingApprovals: pendingApprovalsQuery.data || [],
        myActiveOfferSwapIds: myActiveOffersQuery.data || new Set<string>(),
        myActiveOfferDetails: myActiveOfferDetailsQuery.data || [],
        isLoadingOfferDetails: myActiveOfferDetailsQuery.isLoading,
        isLoading: mySwapRequestsQuery.isLoading || availableSwapsQuery.isLoading,
        isLoadingApprovals: pendingApprovalsQuery.isLoading,
        error: mySwapRequestsQuery.error || availableSwapsQuery.error,

        // Mutations
        createSwap: createSwapMutation.mutate,
        makeOffer: makeOfferMutation.mutate,
        acceptOffer: acceptOfferMutation.mutate,
        declineOffer: declineOfferMutation.mutate,
        cancelSwap: cancelSwapMutation.mutate,
        approveSwap: approveSwapMutation.mutate,
        rejectSwap: rejectSwapMutation.mutate,

        // Mutation states
        isCreating: createSwapMutation.isPending,
        isMakingOffer: makeOfferMutation.isPending,
        isAccepting: acceptOfferMutation.isPending,
        isDeclining: declineOfferMutation.isPending,
        isCancelling: cancelSwapMutation.isPending,
        isApproving: approveSwapMutation.isPending,
        isRejecting: rejectSwapMutation.isPending,

        // Refetch functions
        refetchMySwaps: mySwapRequestsQuery.refetch,
        refetchAvailable: availableSwapsQuery.refetch,
        refetchApprovals: pendingApprovalsQuery.refetch,
        userId,
    };
};
