// ============================================================
// BROADCASTS QUERIES — all read-only operations
// Location: src/modules/broadcasts/api/broadcasts.queries.ts
//
// N+1 fixes applied:
//   getByChannelId  — nested select fetches profiles + attachments in 1 query,
//                     then a single batch RPC call for ack stats.
//   getForEmployee  — nested select fetches profiles + attachments + channel
//                     group_id in 1 query; role lookup collapsed to a single
//                     IN query across all author_ids.
// ============================================================

import { supabase } from '@/platform/supabase/client';
import type {
    BroadcastGroupWithStats,
    BroadcastGroupFull,
    EmployeeBroadcastGroup,
    BroadcastChannelWithStats,
    BroadcastWithDetails,
    BroadcastAckStats,
    BroadcastNotification,
    GroupParticipantWithDetails,
    BroadcastParticipantRole,
    BroadcastFilters,
    PaginationOptions,
    PaginatedResponse,
} from '../model/broadcast.types';
import { toCamelCase, normalizeAuthor } from './broadcasts.dto';

// ── Broadcast Groups ──────────────────────────────────────────────────────────

export const broadcastGroupQueries = {
    /**
     * Get all groups (manager view with full stats)
     */
    async getAll(
        filters?: { organizationId?: string; departmentId?: string; subDepartmentId?: string }
    ): Promise<BroadcastGroupWithStats[]> {
        let query = supabase
            .from('v_broadcast_groups_with_stats')
            .select('*')
            .order('name');

        if (filters?.organizationId) {
            query = query.eq('organization_id', filters.organizationId);
        }
        if (filters?.departmentId) {
            query = query.eq('department_id', filters.departmentId);
        }
        if (filters?.subDepartmentId) {
            query = query.eq('sub_department_id', filters.subDepartmentId);
        }

        // Cast result to break infinite recursion in type inference
        const { data, error } = (await query) as any;

        if (error) throw error;
        return toCamelCase(data || []);
    },

    /**
     * Get groups for employee (with unread counts)
     * Uses 3 parallel queries instead of N sequential ones.
     */
    async getForEmployee(
        employeeId: string,
        scope?: { organizationId?: string; departmentId?: string; subDepartmentId?: string }
    ): Promise<EmployeeBroadcastGroup[]> {
        // 1. Resolve group membership (including hierarchy-based)
        const { data: participantGroups, error: pgError } = await (supabase as any)
            .from('v_group_all_participants')
            .select('group_id')
            .eq('employee_id', employeeId);

        if (pgError) throw pgError;

        const groupIds = (participantGroups || []).map((p: any) => p.group_id);
        if (groupIds.length === 0) return [];

        // 2. Fan out the three dependent reads in parallel
        let groupsQuery = supabase
            .from('v_broadcast_groups_with_stats')
            .select('*')
            .in('id', groupIds);

        if (scope?.organizationId) groupsQuery = groupsQuery.eq('organization_id', scope.organizationId);
        if (scope?.departmentId)   groupsQuery = groupsQuery.eq('department_id', scope.departmentId);
        if (scope?.subDepartmentId) groupsQuery = groupsQuery.eq('sub_department_id', scope.subDepartmentId);

        const [groupsRes, channelsRes, unreadRes] = await Promise.all([
            groupsQuery,
            supabase
                .from('v_channels_with_stats')
                .select('*')
                .in('group_id', groupIds)
                .eq('is_active', true),
            supabase
                .from('v_unread_broadcasts_by_group')
                .select('*')
                .eq('employee_id', employeeId),
        ]);

        if (groupsRes.error)   throw groupsRes.error;
        if (channelsRes.error) throw channelsRes.error;
        if (unreadRes.error)   throw unreadRes.error;

        // 3. Merge in memory
        const unreadMap = new Map((unreadRes.data || []).map((s: any) => [s.group_id, s]));
        const channelsMap = new Map<string, any[]>();
        (channelsRes.data || []).forEach((c: any) => {
            if (!channelsMap.has(c.group_id)) channelsMap.set(c.group_id, []);
            channelsMap.get(c.group_id)!.push(c);
        });

        return toCamelCase(
            (groupsRes.data || []).map((group: any) => {
                const stats = unreadMap.get(group.id) as any;
                return {
                    ...group,
                    channels: channelsMap.get(group.id) || [],
                    unreadCount: stats?.unread_count || 0,
                    hasUrgentMessages: stats?.has_urgent_unread || false,
                    hasPendingAcknowledgements: stats?.has_pending_ack || false,
                };
            })
        );
    },

    /**
     * Get single group with full details
     */
    async getById(groupId: string): Promise<BroadcastGroupFull | null> {
        // Three parallel reads: the raw group row, its channels, its participants
        const [groupRes, channelsRes, participantsRes, statsRes] = await Promise.all([
            supabase
                .from('broadcast_groups')
                .select('*')
                .eq('id', groupId)
                .single(),
            supabase
                .from('v_channels_with_stats')
                .select('*')
                .eq('group_id', groupId)
                .eq('is_active', true),
            supabase
                .from('group_participants')
                .select('*, profiles(id, first_name, last_name, email)')
                .eq('group_id', groupId),
            supabase
                .from('v_broadcast_groups_with_stats')
                .select('*')
                .eq('id', groupId)
                .single(),
        ]);

        if (groupRes.error) {
            if (groupRes.error.code === 'PGRST116') return null;
            throw groupRes.error;
        }
        if (!groupRes.data) return null;
        if (channelsRes.error) throw channelsRes.error;
        if (participantsRes.error) throw participantsRes.error;
        if (statsRes.error && statsRes.error.code !== 'PGRST116') throw statsRes.error;

        const stats = statsRes.data as any;

        const transformedParticipants = (participantsRes.data || []).map((p: any) => ({
            ...p,
            employee: p.profiles
                ? {
                    id: p.profiles.id,
                    name: `${p.profiles.first_name} ${p.profiles.last_name}`,
                    email: p.profiles.email,
                }
                : null,
        }));

        return toCamelCase({
            ...groupRes.data,
            channelCount:          stats?.channel_count          || 0,
            participantCount:      stats?.participant_count       || 0,
            activeBroadcastCount:  stats?.active_broadcast_count  || 0,
            totalBroadcastCount:   stats?.total_broadcast_count   || 0,
            lastBroadcastAt:       stats?.last_broadcast_at,
            channels:              channelsRes.data || [],
            participants:          transformedParticipants,
        });
    },
};

// ── Broadcast Channels ────────────────────────────────────────────────────────

export const broadcastChannelQueries = {
    /**
     * Get channels for a group
     */
    async getByGroupId(groupId: string): Promise<BroadcastChannelWithStats[]> {
        const { data, error } = await supabase
            .from('v_channels_with_stats')
            .select('*')
            .eq('group_id', groupId)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        return toCamelCase(data || []);
    },
};

// ── Broadcasts ────────────────────────────────────────────────────────────────

export const broadcastQueries = {
    /**
     * Get broadcasts for a channel (manager view).
     *
     * N+1 fix: a single relational select pulls author profiles and attachments
     * in one round-trip.  Ack stats still require an RPC per broadcast that
     * requires acknowledgement, but those are now batched in parallel instead
     * of being issued inside a sequential loop.
     */
    async getByChannelId(
        channelId: string,
        filters?: BroadcastFilters,
        pagination?: PaginationOptions
    ): Promise<PaginatedResponse<BroadcastWithDetails>> {
        // Build the base query with nested selects to avoid N+1
        let query = supabase
            .from('broadcasts')
            .select(
                `*,
                profiles!author_id(id, first_name, last_name, email),
                broadcast_attachments(*),
                broadcast_channels!inner(group_id)`,
                { count: 'exact' }
            )
            .eq('channel_id', channelId);

        // Filters
        if (filters?.priority) {
            query = query.eq('priority', filters.priority);
        }
        if (filters?.isPinned !== undefined) {
            query = query.eq('is_pinned', filters.isPinned);
        }
        if (filters?.requiresAcknowledgement !== undefined) {
            query = query.eq('requires_acknowledgement', filters.requiresAcknowledgement);
        }
        if (filters?.search) {
            query = query.or(
                `subject.ilike.%${filters.search}%,content.ilike.%${filters.search}%`
            );
        }

        // Sorting + pagination
        query = query
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

        const page     = pagination?.page     || 1;
        const pageSize = pagination?.pageSize || 20;
        const from     = (page - 1) * pageSize;
        query = query.range(from, from + pageSize - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        const rows = data || [];

        // Collect all unique group_ids so we can resolve author roles in one query
        const groupIds = [...new Set(rows.map((b: any) => b.broadcast_channels?.group_id).filter(Boolean))];
        const authorIds = [...new Set(rows.map((b: any) => b.author_id).filter(Boolean))];

        // Single query for all relevant group_participants (covers all authors + groups)
        let roleMap = new Map<string, string>(); // key = `${groupId}:${employeeId}`
        if (groupIds.length > 0 && authorIds.length > 0) {
            const { data: participants } = await supabase
                .from('group_participants')
                .select('group_id, employee_id, role')
                .in('group_id', groupIds)
                .in('employee_id', authorIds);

            (participants || []).forEach((p: any) => {
                roleMap.set(`${p.group_id}:${p.employee_id}`, p.role);
            });
        }

        // Batch ack-stats RPCs in parallel (only for broadcasts that need them)
        const ackNeeded = rows.filter((b: any) => b.requires_acknowledgement);
        const ackResults = await Promise.all(
            ackNeeded.map((b: any) =>
                supabase
                    .rpc('get_broadcast_ack_stats', { broadcast_uuid: b.id })
                    .then(({ data: stats }) =>
                        [b.id, stats && stats.length > 0 ? toCamelCase<BroadcastAckStats>(stats[0]) : undefined] as const
                    )
            )
        );
        const ackMap = new Map<string, BroadcastAckStats | undefined>(ackResults);

        // Assemble final rows
        const broadcasts = rows.map((broadcast: any) => {
            const groupId    = broadcast.broadcast_channels?.group_id;
            const authorRole = groupId
                ? roleMap.get(`${groupId}:${broadcast.author_id}`) ?? 'member'
                : 'member';

            return {
                ...broadcast,
                author:      normalizeAuthor(broadcast.profiles),
                authorRole,
                attachments: broadcast.broadcast_attachments ?? [],
                ackStats:    ackMap.get(broadcast.id),
            };
        });

        return {
            data: toCamelCase(broadcasts),
            total:      count || 0,
            page,
            pageSize,
            totalPages: Math.ceil((count || 0) / pageSize),
        };
    },

    /**
     * Get broadcasts for employee view (with read status).
     *
     * N+1 fix: a single relational select pulls author profiles, attachments,
     * and the channel's group_id together.  Author roles are then resolved with
     * a single batch query instead of one query per broadcast.
     */
    async getForEmployee(
        channelId: string,
        employeeId: string,
        pagination?: PaginationOptions
    ): Promise<PaginatedResponse<BroadcastWithDetails>> {
        let query = supabase
            .from('broadcasts')
            .select(
                `*,
                profiles!author_id(id, first_name, last_name, email),
                broadcast_attachments(*),
                broadcast_channels!inner(group_id)`,
                { count: 'exact' }
            )
            .eq('channel_id', channelId)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

        const page     = pagination?.page     || 1;
        const pageSize = pagination?.pageSize || 20;
        const from     = (page - 1) * pageSize;
        query = query.range(from, from + pageSize - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        const rows       = data || [];
        const broadcastIds = rows.map((b: any) => b.id);

        // Resolve read status for this employee in a single query
        let readMap = new Map<string, string>();
        if (broadcastIds.length > 0) {
            const { data: readStatuses } = await supabase
                .from('broadcast_read_status')
                .select('broadcast_id, read_at')
                .eq('employee_id', employeeId)
                .in('broadcast_id', broadcastIds);

            readMap = new Map(
                (readStatuses || []).map((r: any) => [r.broadcast_id, r.read_at])
            );
        }

        // Resolve author roles: collect unique group+author combos, then one query
        const groupIds  = [...new Set(rows.map((b: any) => b.broadcast_channels?.group_id).filter(Boolean))];
        const authorIds = [...new Set(rows.map((b: any) => b.author_id).filter(Boolean))];

        let roleMap = new Map<string, string>();
        if (groupIds.length > 0 && authorIds.length > 0) {
            const { data: participants } = await supabase
                .from('group_participants')
                .select('group_id, employee_id, role')
                .in('group_id', groupIds)
                .in('employee_id', authorIds);

            (participants || []).forEach((p: any) => {
                roleMap.set(`${p.group_id}:${p.employee_id}`, p.role);
            });
        }

        const broadcasts = rows.map((broadcast: any) => {
            const groupId    = broadcast.broadcast_channels?.group_id;
            const authorRole = groupId
                ? roleMap.get(`${groupId}:${broadcast.author_id}`) ?? 'member'
                : 'member';

            return {
                ...broadcast,
                author:                 normalizeAuthor(broadcast.profiles),
                authorRole,
                attachments:            broadcast.broadcast_attachments ?? [],
                isRead:                 readMap.has(broadcast.id),
                acknowledgementStatus:  'pending',
                acknowledgedAt:         undefined,
            };
        });

        return {
            data: toCamelCase(broadcasts),
            total:      count || 0,
            page,
            pageSize,
            totalPages: Math.ceil((count || 0) / pageSize),
        };
    },
};

// ── Group Participants ────────────────────────────────────────────────────────

export const groupParticipantQueries = {
    /**
     * Get participants for a group.
     * Uses a single relational select instead of N profile lookups.
     */
    async getByGroupId(groupId: string): Promise<GroupParticipantWithDetails[]> {
        const { data, error } = await supabase
            .from('group_participants')
            .select('*, profiles(id, first_name, last_name, email)')
            .eq('group_id', groupId)
            .order('role')
            .order('joined_at');

        if (error) throw error;

        const rows = (data || []).map((p: any) => ({
            ...p,
            employee: p.profiles
                ? {
                    id:    p.profiles.id,
                    name:  `${p.profiles.first_name} ${p.profiles.last_name}`,
                    email: p.profiles.email,
                }
                : null,
        }));

        return toCamelCase(rows);
    },

    /**
     * Get user's role in a group
     */
    async getUserRole(
        groupId: string,
        employeeId: string
    ): Promise<BroadcastParticipantRole | null> {
        // Use the RPC for hierarchy-aware role resolution
        const { data, error } = await supabase
            .rpc('get_broadcast_group_role', { p_group_id: groupId });

        if (error) throw error;
        return data as BroadcastParticipantRole | null;
    },
};

// ── Broadcast Notifications ───────────────────────────────────────────────────

export const broadcastNotificationQueries = {
    /**
     * Get notifications for a user
     */
    async getForUser(
        employeeId: string,
        unreadOnly = false
    ): Promise<BroadcastNotification[]> {
        let query = supabase
            .from('broadcast_notifications')
            .select('*')
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (unreadOnly) {
            query = query.eq('is_read', false);
        }

        const { data, error } = await query;
        if (error) throw error;
        return toCamelCase(data || []);
    },

    /**
     * Get unread count
     */
    async getUnreadCount(employeeId: string): Promise<number> {
        const { count, error } = await supabase
            .from('broadcast_notifications')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .eq('is_read', false);

        if (error) throw error;
        return count || 0;
    },
};
