
import { supabase } from '@/platform/realtime/client';
import type { BroadcastGroup, GroupMember, Broadcast, Notification, Employee } from '@/platform/types/broadcast';
import { MockStorage } from './mock-storage';

// Helper class to provide typed methods for accessing broadcast tables
export class BroadcastDbClient {
  // Check if Supabase is properly connected
  static async testConnection() {
    try {
      // Table shift_bids is now in generated types
      const { data, error } = await supabase.from('shift_bids').select('count').limit(1);
      return !error;
    } catch (error) {
      console.error('Supabase connection test failed:', error);
      return false;
    }
  }

  // Broadcast Groups methods - Using real database tables
  static async fetchBroadcastGroups() {
    try {
      const { data, error } = await supabase
        .from('broadcast_groups')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as BroadcastGroup[];
    } catch (error) {
      console.error('Error fetching broadcast groups:', error);
      return MockStorage.getGroups() as BroadcastGroup[];
    }
  }

  static async createBroadcastGroup(name: string) {
    try {
      const { data, error } = await supabase
        .from('broadcast_groups')
        .insert([{
          name,
          created_by: '00000000-0000-0000-0000-000000000000' // TODO: Get actual user ID from auth
        }])
        .select();

      if (error) throw error;
      return await this.fetchBroadcastGroups();
    } catch (error) {
      console.error('Error creating broadcast group:', error);
      const newGroup = { id: Date.now().toString(), name, created_at: new Date().toISOString() };
      return MockStorage.addGroup(newGroup) as BroadcastGroup[];
    }
  }

  static async updateBroadcastGroup(id: string, name: string) {
    try {
      const { error } = await supabase
        .from('broadcast_groups')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating broadcast group:', error);
      MockStorage.updateGroup(id, name);
    }
  }

  static async deleteBroadcastGroup(id: string) {
    try {
      const { error } = await supabase
        .from('broadcast_groups')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting broadcast group:', error);
      MockStorage.deleteGroup(id);
    }
  }

  // Group Members methods - Using real database tables
  static async fetchGroupMembers(groupId: string) {
    try {
      const { data, error } = await supabase
        .from('broadcast_group_members')
        .select('*, employees(id, first_name, last_name, email, status)')
        .eq('group_id', groupId);

      if (error) throw error;

      return data.map((m: any) => ({
        id: m.id,
        group_id: m.group_id,
        user_id: m.employee_id,
        is_admin: m.is_admin,
        user: {
          id: m.employees?.id,
          name: `${m.employees?.first_name} ${m.employees?.last_name}`,
          email: m.employees?.email,
          role: m.employees?.status || 'member',
          department: 'General'
        }
      })) as GroupMember[];
    } catch (error) {
      console.error('Error fetching group members:', error);
      return MockStorage.getGroupMembers(groupId) as GroupMember[];
    }
  }

  static async addGroupMember(groupId: string, userId: string, isAdmin: boolean = false) {
    try {
      const { error } = await supabase
        .from('broadcast_group_members')
        .insert([{
          group_id: groupId,
          employee_id: userId,
          is_admin: isAdmin
        }]);

      if (error) throw error;
    } catch (error) {
      console.error('Error adding group member:', error);
      const newMember = {
        id: Date.now().toString(),
        group_id: groupId,
        user_id: userId,
        is_admin: isAdmin,
        user: {
          id: userId,
          name: 'New User',
          email: 'newuser@example.com',
          role: 'member',
          department: 'General'
        }
      };
      MockStorage.addMember(newMember);
    }
  }

  static async removeGroupMember(memberId: string) {
    try {
      const { error } = await supabase
        .from('broadcast_group_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
    } catch (error) {
      console.error('Error removing group member:', error);
      MockStorage.removeMember(memberId);
    }
  }

  static async updateMemberAdminStatus(memberId: string, isAdmin: boolean) {
    try {
      const { error } = await supabase
        .from('broadcast_group_members')
        .update({ is_admin: isAdmin })
        .eq('id', memberId);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating member admin status:', error);
      MockStorage.updateMemberAdminStatus(memberId, isAdmin);
    }
  }

  // User Groups methods - Using real database tables
  static async fetchUserGroups(userId: string) {
    try {
      const { data, error } = await supabase
        .from('broadcast_group_members')
        .select('*, broadcast_groups(*)')
        .eq('employee_id', userId);

      if (error) throw error;

      return data.map((membership: any) => ({
        ...membership.broadcast_groups,
        is_admin: membership.is_admin
      }));
    } catch (error) {
      console.error('Error fetching user groups:', error);
      return MockStorage.getUserGroups(userId);
    }
  }

  // Broadcasts methods - Schema incompatible, using mock data
  static async createBroadcast(groupId: string, senderId: string, message: string) {
    // NOTE: broadcasts table schema doesn't match application expectations
    // Table has: title, content, created_by, organization_id (no group_id, sender_id, message)
    // Using mock data until schema is updated
    console.warn('Broadcast database schema incompatible - using mock data');
    const newBroadcast = {
      id: Date.now().toString(),
      group_id: groupId,
      sender_id: senderId,
      message: message,
      created_at: new Date().toISOString(),
      sender: { id: senderId, name: 'Demo User' },
      group: { id: groupId, name: 'Demo Group' }
    };
    return MockStorage.addBroadcast(newBroadcast) as Broadcast;
  }

  // Fetch broadcasts for a specific group - Schema incompatible, using mock data
  static async fetchGroupBroadcasts(groupId: string) {
    // NOTE: broadcasts table schema doesn't match application expectations
    // Using mock data until schema is updated
    console.warn('Broadcast database schema incompatible - using mock data');
    return MockStorage.getGroupBroadcasts(groupId) as Broadcast[];
  }

  // Notifications methods - Schema incompatible (broadcasts doesn't match expectations)
  static async fetchUserNotifications(userId: string) {
    // NOTE: broadcasts table schema doesn't support this query structure
    // broadcasts.message, broadcast_groups relation, employees join all incompatible
    console.warn('Notification database schema incompatible - returning empty array');
    return [] as Notification[];
  }

  static async markNotificationAsRead(notificationId: string) {
    try {
      const { error } = await supabase
        .from('broadcast_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }

  static async markAllNotificationsAsRead(userId: string) {
    try {
      const { error } = await supabase
        .from('broadcast_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('employee_id', userId)
        .eq('is_read', false);

      if (error) throw error;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }

  static async createNotificationsForBroadcast(broadcastId: string, userIds: string[]) {
    try {
      const notifications = userIds.map(userId => ({
        broadcast_id: broadcastId,
        employee_id: userId,
        is_read: false
      }));

      const { error } = await supabase
        .from('broadcast_notifications')
        .insert(notifications);

      if (error) throw error;
    } catch (error) {
      console.error('Error creating notifications for broadcast:', error);
    }
  }

  // Employees / Users methods - Using user_contracts and profiles
  static async fetchUsers(departmentId?: string, subDepartmentId?: string) {
    console.log('Fetching users with active contracts', { departmentId, subDepartmentId });

    try {
      const isConnected = await this.testConnection();
      if (!isConnected) {
        console.warn('Supabase not connected, returning mock users');
        return [
          { id: '1', name: 'John Doe', email: 'john@example.com', role: 'admin', department: 'IT' },
          { id: '2', name: 'Jane Smith', email: 'jane@example.com', role: 'member', department: 'HR' },
          { id: '3', name: 'Bob Johnson', email: 'bob@example.com', role: 'manager', department: 'Sales' }
        ] as Employee[];
      }

      let query = supabase
        .from('user_contracts')
        .select(`
          user_id,
          status,
          profiles:user_id (
            id,
            first_name,
            last_name,
            email
          )
        `)
        .eq('status', 'active')
        .lte('start_date', new Date().toISOString())
        .or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`);

      if (departmentId) {
        query = query.eq('department_id', departmentId);
      }

      if (subDepartmentId) {
        query = query.eq('sub_department_id', subDepartmentId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching employees:', error);
        throw error;
      }

      // Filter out invalid profiles and map to Employee type
      const mappedEmployees = data
        .filter((contract: any) => contract.profiles)
        .map((contract: any) => ({
          id: contract.profiles.id,
          name: `${contract.profiles.first_name} ${contract.profiles.last_name}`,
          email: contract.profiles.email,
          role: 'member', // Default role for broadcast purposes
          department: 'General' // We could fetch this but it's not strictly needed for the UI right now
        }));

      // Deduplicate users (in case of multiple active contracts)
      const uniqueEmployees = Array.from(
        new Map(mappedEmployees.map(emp => [emp.id, emp])).values()
      );

      console.log(`Found ${uniqueEmployees.length} active employees`);
      return uniqueEmployees as Employee[];
    } catch (error) {
      console.error('Error in fetchUsers:', error);
      return [];
    }
  }
}
