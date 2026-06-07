
import { useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorHandler } from '@/modules/core/lib/error-handler';

export const useRealTimeUpdates = () => {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Subscribe to broadcast groups changes
    const groupsChannel = supabase
      .channel('broadcast-groups-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'broadcast_groups'
        },
        () => {
          console.log('Broadcast groups updated, invalidating cache');
          queryClient.invalidateQueries({ queryKey: ['broadcast-groups'] });
        }
      );

    // Subscribe to broadcasts changes
    const broadcastsChannel = supabase
      .channel('broadcasts-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'broadcasts'
        },
        (payload) => {
          console.log('Broadcasts updated:', payload);
          queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
          queryClient.invalidateQueries({ queryKey: ['user-groups'] });
        }
      );

    // Subscribe to notifications changes
    const notificationsChannel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'broadcast_notifications'
        },
        () => {
          console.log('Notifications updated, invalidating cache');
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      );

    // Subscribe to all channels
    const subscribeChannels = async () => {
      try {
        await Promise.all([
          groupsChannel.subscribe((status) => {
            console.log('Groups channel status:', status);
            setIsConnected(status === 'SUBSCRIBED');
          }),
          broadcastsChannel.subscribe((status) => {
            console.log('Broadcasts channel status:', status);
          }),
          notificationsChannel.subscribe((status) => {
            console.log('Notifications channel status:', status);
          })
        ]);
      } catch (error) {
        ErrorHandler.logError(
          error as Error,
          { component: 'useRealTimeUpdates', action: 'subscribe' },
          'medium'
        );
      }
    };

    subscribeChannels();

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(groupsChannel);
      supabase.removeChannel(broadcastsChannel);
      supabase.removeChannel(notificationsChannel);
    };
  }, [queryClient]);

  return { isConnected };
};
