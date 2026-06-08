// ============================================================
// BROADCASTS API — backwards-compatible re-export barrel
// Location: src/modules/broadcasts/api/broadcasts.api.ts
//
// This file intentionally re-exports everything from the three
// split modules so that all existing import paths continue to
// work without modification.
//
//   broadcasts.dto.ts     — transformation / normalisation helpers
//   broadcasts.queries.ts — read-only operations
//   broadcasts.commands.ts — mutation operations
// ============================================================

// ── DTO helpers ───────────────────────────────────────────────────────────────
export {
    toCamelCase,
    toSnakeCase,
    getFileTypeFromName,
    normalizeAuthor,
    normalizeBroadcastRow,
    BroadcastDbClient,
} from './broadcasts.dto';

// ── Read operations ───────────────────────────────────────────────────────────
export {
    broadcastGroupQueries,
    broadcastChannelQueries,
    broadcastQueries,
    groupParticipantQueries,
    broadcastNotificationQueries,
} from './broadcasts.queries';

// ── Mutation operations ───────────────────────────────────────────────────────
export {
    broadcastGroupCommands,
    broadcastChannelCommands,
    broadcastCommands,
    broadcastAttachmentCommands,
    groupParticipantCommands,
    broadcastNotificationCommands,
} from './broadcasts.commands';

// ── Legacy service aliases ────────────────────────────────────────────────────
// These composite objects merge queries + commands under the same names that
// existed before the split so that all callers (useBroadcasts.ts, etc.) work
// without any changes.

import { broadcastGroupQueries, broadcastChannelQueries, broadcastQueries, groupParticipantQueries, broadcastNotificationQueries } from './broadcasts.queries';
import { broadcastGroupCommands, broadcastChannelCommands, broadcastCommands, broadcastAttachmentCommands, groupParticipantCommands, broadcastNotificationCommands } from './broadcasts.commands';
import { toCamelCase } from './broadcasts.dto';
import { supabase } from '@/platform/supabase/client';
import type {
    Broadcast,
    BroadcastAcknowledgement,
    BroadcastNotification,
} from '../model/broadcast.types';

export const broadcastGroupService = {
    ...broadcastGroupQueries,
    ...broadcastGroupCommands,
};

export const broadcastChannelService = {
    ...broadcastChannelQueries,
    ...broadcastChannelCommands,
};

export const broadcastService = {
    ...broadcastQueries,
    ...broadcastCommands,
};

export const broadcastAttachmentService = {
    ...broadcastAttachmentCommands,
};

export const groupParticipantService = {
    ...groupParticipantQueries,
    ...groupParticipantCommands,
};

export const broadcastNotificationService = {
    ...broadcastNotificationQueries,
    ...broadcastNotificationCommands,
};

// ── Real-time subscriptions ───────────────────────────────────────────────────
// Kept inline here: realtime helpers are thin wrappers around supabase.channel()
// and do not belong in queries or commands.

export const broadcastRealtimeService = {
    subscribeToChannel(
        channelId: string,
        onInsert: (broadcast: Broadcast) => void,
        onUpdate: (broadcast: Broadcast) => void,
        onDelete: (id: string) => void
    ) {
        return supabase
            .channel(`broadcasts:${channelId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'broadcasts',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload) => onInsert(toCamelCase(payload.new))
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'broadcasts',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload) => onUpdate(toCamelCase(payload.new))
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'broadcasts',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload) => onDelete(payload.old.id)
            )
            .subscribe();
    },

    subscribeToAcknowledgements(
        broadcastId: string,
        onInsert: (ack: BroadcastAcknowledgement) => void
    ) {
        return supabase
            .channel(`acks:${broadcastId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'broadcast_acknowledgements',
                    filter: `broadcast_id=eq.${broadcastId}`,
                },
                (payload) => onInsert(toCamelCase(payload.new))
            )
            .subscribe();
    },

    subscribeToNotifications(
        employeeId: string,
        onInsert: (notification: BroadcastNotification) => void
    ) {
        return supabase
            .channel(`notifications:${employeeId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'broadcast_notifications',
                    filter: `employee_id=eq.${employeeId}`,
                },
                (payload) => onInsert(toCamelCase(payload.new))
            )
            .subscribe();
    },

    async unsubscribe(subscription: ReturnType<typeof supabase.channel>) {
        if (!subscription || subscription.state === 'closed') {
            return;
        }
        try {
            await supabase.removeChannel(subscription);
        } catch (_error) {
            // Ignore — channel may already be closed
        }
    },
};

// ── Aggregate service object (original default export shape) ──────────────────

export const broadcastServices = {
    groups:        broadcastGroupService,
    channels:      broadcastChannelService,
    broadcasts:    broadcastService,
    attachments:   broadcastAttachmentService,
    participants:  groupParticipantService,
    notifications: broadcastNotificationService,
    realtime:      broadcastRealtimeService,
};

export default broadcastServices;
