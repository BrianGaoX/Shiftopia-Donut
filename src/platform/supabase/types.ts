export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      actual_labor_attendance: {
        Row: {
          assigned: number
          created_at: string
          event_id: string
          id: string
          present: number
          role: string
          time_slot: number
        }
        Insert: {
          assigned?: number
          created_at?: string
          event_id: string
          id?: string
          present?: number
          role: string
          time_slot: number
        }
        Update: {
          assigned?: number
          created_at?: string
          event_id?: string
          id?: string
          present?: number
          role?: string
          time_slot?: number
        }
        Relationships: []
      }
      allowed_locations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          lat: number
          lng: number
          name: string
          org_id: string
          radius_m: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          lat: number
          lng: number
          name: string
          org_id: string
          radius_m?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number
          lng?: number
          name?: string
          org_id?: string
          radius_m?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowed_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_access_certificates: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          certificate_type: string
          created_at: string | null
          created_by: string | null
          department_id: string | null
          id: string
          is_active: boolean
          organization_id: string | null
          sub_department_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_level: Database["public"]["Enums"]["access_level"]
          certificate_type?: string
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          certificate_type?: string
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_access_certificates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          created_at: string | null
          employee_id: string
          id: string
          minutes_late: number | null
          notes: string | null
          scheduled_end: string
          scheduled_start: string
          shift_id: string
          status: string | null
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          minutes_late?: number | null
          notes?: string | null
          scheduled_end: string
          scheduled_start: string
          shift_id: string
          status?: string | null
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          minutes_late?: number | null
          notes?: string | null
          scheduled_end?: string
          scheduled_start?: string
          shift_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      autoschedule_assignments: {
        Row: {
          committed_at: string | null
          created_at: string | null
          employee_id: string
          id: string
          session_id: string
          shift_id: string
          status: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          session_id: string
          shift_id: string
          status?: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          session_id?: string
          shift_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "autoschedule_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "autoschedule_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      autoschedule_sessions: {
        Row: {
          created_at: string | null
          created_by: string | null
          date_end: string
          date_start: string
          department_id: string | null
          id: string
          organization_id: string
          scope: string
          selected_shift_ids: Json
          simulation_result: Json | null
          snapshot_version: string
          soft_constraints: Json
          solver_hash: string | null
          status: string
          strategy: string
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date_end: string
          date_start: string
          department_id?: string | null
          id?: string
          organization_id: string
          scope?: string
          selected_shift_ids?: Json
          simulation_result?: Json | null
          snapshot_version: string
          soft_constraints?: Json
          solver_hash?: string | null
          status?: string
          strategy?: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date_end?: string
          date_start?: string
          department_id?: string | null
          id?: string
          organization_id?: string
          scope?: string
          selected_shift_ids?: Json
          simulation_result?: Json | null
          snapshot_version?: string
          soft_constraints?: Json
          solver_hash?: string | null
          status?: string
          strategy?: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autoschedule_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_sessions_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      availabilities: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          availability_type: Database["public"]["Enums"]["availability_type"]
          created_at: string | null
          end_date: string
          end_time: string | null
          id: string
          is_approved: boolean | null
          is_recurring: boolean | null
          profile_id: string
          reason: string | null
          recurrence_rule: string | null
          start_date: string
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          availability_type?: Database["public"]["Enums"]["availability_type"]
          created_at?: string | null
          end_date: string
          end_time?: string | null
          id?: string
          is_approved?: boolean | null
          is_recurring?: boolean | null
          profile_id: string
          reason?: string | null
          recurrence_rule?: string | null
          start_date: string
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          availability_type?: Database["public"]["Enums"]["availability_type"]
          created_at?: string | null
          end_date?: string
          end_time?: string | null
          id?: string
          is_approved?: boolean | null
          is_recurring?: boolean | null
          profile_id?: string
          reason?: string | null
          recurrence_rule?: string | null
          start_date?: string
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availabilities_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availabilities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          profile_id: string
          repeat_days: number[] | null
          repeat_end_date: string | null
          repeat_type: string
          start_date: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          profile_id: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          profile_id?: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          profile_id: string
          rule_id: string | null
          slot_date: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          profile_id: string
          rule_id?: string | null
          slot_date: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          profile_id?: string
          rule_id?: string | null
          slot_date?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_acknowledgements: {
        Row: {
          acknowledged_at: string | null
          broadcast_id: string
          employee_id: string
          id: string
        }
        Insert: {
          acknowledged_at?: string | null
          broadcast_id: string
          employee_id: string
          id?: string
        }
        Update: {
          acknowledged_at?: string | null
          broadcast_id?: string
          employee_id?: string
          id?: string
        }
        Relationships: []
      }
      broadcast_attachments: {
        Row: {
          broadcast_id: string
          created_at: string | null
          file_name: string
          file_size: number | null
          file_type: string
          file_url: string
          id: string
          storage_path: string | null
        }
        Insert: {
          broadcast_id: string
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          file_url: string
          id?: string
          storage_path?: string | null
        }
        Update: {
          broadcast_id?: string
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          file_url?: string
          id?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_attachments_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_channels: {
        Row: {
          created_at: string | null
          description: string | null
          group_id: string
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          group_id: string
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          group_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_group_members: {
        Row: {
          employee_id: string
          group_id: string
          id: string
          is_admin: boolean | null
          joined_at: string | null
        }
        Insert: {
          employee_id: string
          group_id: string
          id?: string
          is_admin?: boolean | null
          joined_at?: string | null
        }
        Update: {
          employee_id?: string
          group_id?: string
          id?: string
          is_admin?: boolean | null
          joined_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_groups: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string
          department_id: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by: string
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_notifications: {
        Row: {
          broadcast_id: string
          created_at: string | null
          employee_id: string
          id: string
          is_read: boolean | null
          read_at: string | null
        }
        Insert: {
          broadcast_id: string
          created_at?: string | null
          employee_id: string
          id?: string
          is_read?: boolean | null
          read_at?: string | null
        }
        Update: {
          broadcast_id?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          is_read?: boolean | null
          read_at?: string | null
        }
        Relationships: []
      }
      broadcast_read_status: {
        Row: {
          broadcast_id: string
          employee_id: string
          id: string
          read_at: string | null
        }
        Insert: {
          broadcast_id: string
          employee_id: string
          id?: string
          read_at?: string | null
        }
        Update: {
          broadcast_id?: string
          employee_id?: string
          id?: string
          read_at?: string | null
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          archived_by: string | null
          author_id: string | null
          channel_id: string | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_archived: boolean | null
          is_pinned: boolean | null
          organization_id: string | null
          priority: string | null
          requires_acknowledgement: boolean | null
          subject: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          archived_by?: string | null
          author_id?: string | null
          channel_id?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_archived?: boolean | null
          is_pinned?: boolean | null
          organization_id?: string | null
          priority?: string | null
          requires_acknowledgement?: boolean | null
          subject?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          archived_by?: string | null
          author_id?: string | null
          channel_id?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_archived?: boolean | null
          is_pinned?: boolean | null
          organization_id?: string | null
          priority?: string | null
          requires_acknowledgement?: boolean | null
          subject?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "broadcast_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "v_channels_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_operations: {
        Row: {
          actor_id: string
          completed_at: string | null
          created_at: string
          id: string
          operation_type: string
          status: Database["public"]["Enums"]["bulk_operation_status"]
          summary_json: Json | null
        }
        Insert: {
          actor_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          operation_type: string
          status?: Database["public"]["Enums"]["bulk_operation_status"]
          summary_json?: Json | null
        }
        Update: {
          actor_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          operation_type?: string
          status?: Database["public"]["Enums"]["bulk_operation_status"]
          summary_json?: Json | null
        }
        Relationships: []
      }
      cancellation_history: {
        Row: {
          cancelled_at: string | null
          created_at: string | null
          employee_id: string
          id: string
          notice_period_hours: number | null
          penalty_applied: number | null
          reason: string | null
          shift_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          notice_period_hours?: number | null
          penalty_applied?: number | null
          reason?: string | null
          shift_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          notice_period_hours?: number | null
          penalty_applied?: number | null
          reason?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          issuing_body: string | null
          name: string
          organization_id: string | null
          requires_expiration: boolean | null
          updated_at: string | null
          validity_period_months: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          issuing_body?: string | null
          name: string
          organization_id?: string | null
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          issuing_body?: string | null
          name?: string
          organization_id?: string | null
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "certifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_shifts: {
        Row: {
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          department_id: string | null
          id: string
          organization_id: string | null
          snapshot_data: Json
          template_id: string | null
        }
        Insert: {
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department_id?: string | null
          id: string
          organization_id?: string | null
          snapshot_data: Json
          template_id?: string | null
        }
        Update: {
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department_id?: string | null
          id?: string
          organization_id?: string | null
          snapshot_data?: Json
          template_id?: string | null
        }
        Relationships: []
      }
      demand_forecasts: {
        Row: {
          corrected_count: number | null
          correction_factor: number | null
          created_at: string | null
          event_id: string | null
          id: string
          is_locked: boolean | null
          model_version: string | null
          predicted_count: number
          role: string | null
          role_id: string | null
          source: string | null
          time_slot: number | null
        }
        Insert: {
          corrected_count?: number | null
          correction_factor?: number | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          is_locked?: boolean | null
          model_version?: string | null
          predicted_count?: number
          role?: string | null
          role_id?: string | null
          source?: string | null
          time_slot?: number | null
        }
        Update: {
          corrected_count?: number | null
          correction_factor?: number | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          is_locked?: boolean | null
          model_version?: string | null
          predicted_count?: number
          role?: string | null
          role_id?: string | null
          source?: string | null
          time_slot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecasts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "demand_forecasts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_rules: {
        Row: {
          applies_when: Json
          created_at: string
          created_by: string | null
          formula: string
          function_code: string
          id: string
          is_active: boolean
          level: number
          notes: string | null
          priority: number
          rule_code: string
          updated_at: string
          version: number
        }
        Insert: {
          applies_when?: Json
          created_at?: string
          created_by?: string | null
          formula: string
          function_code: string
          id?: string
          is_active?: boolean
          level: number
          notes?: string | null
          priority?: number
          rule_code: string
          updated_at?: string
          version?: number
        }
        Update: {
          applies_when?: Json
          created_at?: string
          created_by?: string | null
          formula?: string
          function_code?: string
          id?: string
          is_active?: boolean
          level?: number
          notes?: string | null
          priority?: number
          rule_code?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      demand_templates: {
        Row: {
          cluster_key: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_seeded: boolean
          shifts: Json
          source_event_ids: string[]
          superseded_by: string | null
          template_code: string
          updated_at: string
        }
        Insert: {
          cluster_key: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_seeded?: boolean
          shifts: Json
          source_event_ids?: string[]
          superseded_by?: string | null
          template_code: string
          updated_at?: string
        }
        Update: {
          cluster_key?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_seeded?: boolean
          shifts?: Json
          source_event_ids?: string[]
          superseded_by?: string | null
          template_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demand_templates_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "demand_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_tensor: {
        Row: {
          baseline: number
          binding_constraint: string | null
          created_at: string
          event_id: string | null
          execution_timestamp: string
          explanation: Json
          feedback_multiplier_used: number
          function_code: string
          headcount: number
          id: string
          level: number
          rule_version_id: string | null
          slice_idx: number
          synthesis_run_id: string | null
          timecard_ratio_used: number
        }
        Insert: {
          baseline: number
          binding_constraint?: string | null
          created_at?: string
          event_id?: string | null
          execution_timestamp?: string
          explanation?: Json
          feedback_multiplier_used: number
          function_code: string
          headcount: number
          id?: string
          level: number
          rule_version_id?: string | null
          slice_idx: number
          synthesis_run_id?: string | null
          timecard_ratio_used: number
        }
        Update: {
          baseline?: number
          binding_constraint?: string | null
          created_at?: string
          event_id?: string | null
          execution_timestamp?: string
          explanation?: Json
          feedback_multiplier_used?: number
          function_code?: string
          headcount?: number
          id?: string
          level?: number
          rule_version_id?: string | null
          slice_idx?: number
          synthesis_run_id?: string | null
          timecard_ratio_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "demand_tensor_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "demand_tensor_synthesis_run_id_fkey"
            columns: ["synthesis_run_id"]
            isOneToOne: false
            referencedRelation: "synthesis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      department_budgets: {
        Row: {
          budgeted_cost: number | null
          budgeted_hours: number | null
          created_at: string
          created_by: string | null
          currency: string
          dept_id: string
          id: string
          period_end: string
          period_start: string
          updated_at: string
        }
        Insert: {
          budgeted_cost?: number | null
          budgeted_hours?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dept_id: string
          id?: string
          period_end: string
          period_start: string
          updated_at?: string
        }
        Update: {
          budgeted_cost?: number | null
          budgeted_hours?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dept_id?: string
          id?: string
          period_end?: string
          period_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_budgets_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string | null
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_leave_balances: {
        Row: {
          annual_leave_balance_hours: number | null
          created_at: string | null
          employee_id: string
          id: string
          last_updated_at: string | null
          sick_leave_balance_hours: number | null
          updated_at: string | null
        }
        Insert: {
          annual_leave_balance_hours?: number | null
          created_at?: string | null
          employee_id: string
          id?: string
          last_updated_at?: string | null
          sick_leave_balance_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          annual_leave_balance_hours?: number | null
          created_at?: string | null
          employee_id?: string
          id?: string
          last_updated_at?: string | null
          sick_leave_balance_hours?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_licenses: {
        Row: {
          created_at: string | null
          employee_id: string
          expiration_date: string | null
          has_restricted_work_limit: boolean | null
          id: string
          issue_date: string | null
          last_checked_at: string | null
          license_id: string
          license_type: string | null
          status: string | null
          updated_at: string | null
          verification_metadata: Json | null
          verification_status: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          expiration_date?: string | null
          has_restricted_work_limit?: boolean | null
          id?: string
          issue_date?: string | null
          last_checked_at?: string | null
          license_id: string
          license_type?: string | null
          status?: string | null
          updated_at?: string | null
          verification_metadata?: Json | null
          verification_status?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          expiration_date?: string | null
          has_restricted_work_limit?: boolean | null
          id?: string
          issue_date?: string | null
          last_checked_at?: string | null
          license_id?: string
          license_type?: string | null
          status?: string | null
          updated_at?: string | null
          verification_metadata?: Json | null
          verification_status?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_licenses_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_licenses_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_performance_metrics: {
        Row: {
          acceptance_rate: number | null
          al_accrual_ratio: number | null
          al_utilization_ratio: number | null
          attendance_rate: number | null
          calculated_at: string | null
          cancellation_rate_late: number | null
          cancellation_rate_standard: number | null
          created_at: string | null
          early_clock_out_rate: number | null
          early_clock_outs: number | null
          emergency_assignments: number | null
          employee_id: string
          id: string
          is_locked: boolean | null
          late_cancellations: number | null
          late_clock_in_rate: number | null
          late_clock_ins: number | null
          metric_version: number | null
          no_show_rate: number | null
          no_shows: number | null
          offer_expiration_rate: number | null
          offer_expirations: number | null
          period_end: string
          period_start: string
          punctuality_rate: number | null
          quarter_year: string
          rejection_rate: number | null
          reliability_score: number | null
          shifts_accepted: number | null
          shifts_assigned: number | null
          shifts_offered: number | null
          shifts_rejected: number | null
          shifts_swapped: number | null
          shifts_worked: number | null
          standard_cancellations: number | null
          swap_ratio: number | null
          updated_at: string | null
        }
        Insert: {
          acceptance_rate?: number | null
          al_accrual_ratio?: number | null
          al_utilization_ratio?: number | null
          attendance_rate?: number | null
          calculated_at?: string | null
          cancellation_rate_late?: number | null
          cancellation_rate_standard?: number | null
          created_at?: string | null
          early_clock_out_rate?: number | null
          early_clock_outs?: number | null
          emergency_assignments?: number | null
          employee_id: string
          id?: string
          is_locked?: boolean | null
          late_cancellations?: number | null
          late_clock_in_rate?: number | null
          late_clock_ins?: number | null
          metric_version?: number | null
          no_show_rate?: number | null
          no_shows?: number | null
          offer_expiration_rate?: number | null
          offer_expirations?: number | null
          period_end: string
          period_start: string
          punctuality_rate?: number | null
          quarter_year: string
          rejection_rate?: number | null
          reliability_score?: number | null
          shifts_accepted?: number | null
          shifts_assigned?: number | null
          shifts_offered?: number | null
          shifts_rejected?: number | null
          shifts_swapped?: number | null
          shifts_worked?: number | null
          standard_cancellations?: number | null
          swap_ratio?: number | null
          updated_at?: string | null
        }
        Update: {
          acceptance_rate?: number | null
          al_accrual_ratio?: number | null
          al_utilization_ratio?: number | null
          attendance_rate?: number | null
          calculated_at?: string | null
          cancellation_rate_late?: number | null
          cancellation_rate_standard?: number | null
          created_at?: string | null
          early_clock_out_rate?: number | null
          early_clock_outs?: number | null
          emergency_assignments?: number | null
          employee_id?: string
          id?: string
          is_locked?: boolean | null
          late_cancellations?: number | null
          late_clock_in_rate?: number | null
          late_clock_ins?: number | null
          metric_version?: number | null
          no_show_rate?: number | null
          no_shows?: number | null
          offer_expiration_rate?: number | null
          offer_expirations?: number | null
          period_end?: string
          period_start?: string
          punctuality_rate?: number | null
          quarter_year?: string
          rejection_rate?: number | null
          reliability_score?: number | null
          shifts_accepted?: number | null
          shifts_assigned?: number | null
          shifts_offered?: number | null
          shifts_rejected?: number | null
          shifts_swapped?: number | null
          shifts_worked?: number | null
          standard_cancellations?: number | null
          swap_ratio?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_performance_metrics_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_performance_snapshots: {
        Row: {
          acceptance_rate: number | null
          cancel_rate: number | null
          captured_at: string | null
          employee_id: string
          id: string
          no_show_rate: number | null
          reliability_score: number | null
          window_days: number
        }
        Insert: {
          acceptance_rate?: number | null
          cancel_rate?: number | null
          captured_at?: string | null
          employee_id: string
          id?: string
          no_show_rate?: number | null
          reliability_score?: number | null
          window_days: number
        }
        Update: {
          acceptance_rate?: number | null
          cancel_rate?: number | null
          captured_at?: string | null
          employee_id?: string
          id?: string
          no_show_rate?: number | null
          reliability_score?: number | null
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_performance_snapshots_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_reliability_metrics: {
        Row: {
          cancellation_rate: number | null
          created_at: string | null
          employee_id: string
          id: string
          last_updated_at: string | null
          on_time_percentage: number | null
          swap_completion_rate: number | null
          total_cancellations: number | null
          total_late_arrivals: number | null
          total_no_shows: number | null
          total_shifts_assigned: number | null
          total_shifts_completed: number | null
          total_swaps_accepted: number | null
          total_swaps_completed: number | null
        }
        Insert: {
          cancellation_rate?: number | null
          created_at?: string | null
          employee_id: string
          id?: string
          last_updated_at?: string | null
          on_time_percentage?: number | null
          swap_completion_rate?: number | null
          total_cancellations?: number | null
          total_late_arrivals?: number | null
          total_no_shows?: number | null
          total_shifts_assigned?: number | null
          total_shifts_completed?: number | null
          total_swaps_accepted?: number | null
          total_swaps_completed?: number | null
        }
        Update: {
          cancellation_rate?: number | null
          created_at?: string | null
          employee_id?: string
          id?: string
          last_updated_at?: string | null
          on_time_percentage?: number | null
          swap_completion_rate?: number | null
          total_cancellations?: number | null
          total_late_arrivals?: number | null
          total_no_shows?: number | null
          total_shifts_assigned?: number | null
          total_shifts_completed?: number | null
          total_swaps_accepted?: number | null
          total_swaps_completed?: number | null
        }
        Relationships: []
      }
      employee_skills: {
        Row: {
          created_at: string | null
          employee_id: string | null
          expiration_date: string | null
          id: string
          issue_date: string | null
          notes: string | null
          proficiency_level: string | null
          skill_id: string | null
          status: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          proficiency_level?: string | null
          skill_id?: string | null
          status?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          proficiency_level?: string | null
          skill_id?: string | null
          status?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_skills_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_suitability_scores: {
        Row: {
          attendance_score: number | null
          availability_adherence: number | null
          cancellation_penalty: number | null
          created_at: string | null
          employee_id: string
          id: string
          last_calculated_at: string | null
          overall_score: number | null
          skill_match_score: number | null
          swap_reliability: number | null
          updated_at: string | null
        }
        Insert: {
          attendance_score?: number | null
          availability_adherence?: number | null
          cancellation_penalty?: number | null
          created_at?: string | null
          employee_id: string
          id?: string
          last_calculated_at?: string | null
          overall_score?: number | null
          skill_match_score?: number | null
          swap_reliability?: number | null
          updated_at?: string | null
        }
        Update: {
          attendance_score?: number | null
          availability_adherence?: number | null
          cancellation_penalty?: number | null
          created_at?: string | null
          employee_id?: string
          id?: string
          last_calculated_at?: string | null
          overall_score?: number | null
          skill_match_score?: number | null
          swap_reliability?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      event_tags: {
        Row: {
          category: string | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string
          end_time: string | null
          event_type: string | null
          expected_attendance: number | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          start_date: string
          start_time: string | null
          status: string | null
          updated_at: string | null
          venue: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date: string
          end_time?: string | null
          event_type?: string | null
          expected_attendance?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id?: string | null
          start_date: string
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
          venue?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string
          end_time?: string | null
          event_type?: string | null
          expected_attendance?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          start_date?: string
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      function_map: {
        Row: {
          created_at: string
          function_code: string
          sub_department_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          function_code: string
          sub_department_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          function_code?: string
          sub_department_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "function_map_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      group_participants: {
        Row: {
          employee_id: string
          group_id: string
          id: string
          joined_at: string | null
          role: string
        }
        Insert: {
          employee_id: string
          group_id: string
          id?: string
          joined_at?: string | null
          role?: string
        }
        Update: {
          employee_id?: string
          group_id?: string
          id?: string
          joined_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_participants_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_correction_factors: {
        Row: {
          correction_factor: number
          event_type: string
          id: string
          last_updated: string
          role: string
        }
        Insert: {
          correction_factor?: number
          event_type: string
          id?: string
          last_updated?: string
          role: string
        }
        Update: {
          correction_factor?: number
          event_type?: string
          id?: string
          last_updated?: string
          role?: string
        }
        Relationships: []
      }
      leave_requests: {
        Row: {
          approval_date: string | null
          approved_by: string | null
          created_at: string | null
          employee_id: string
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approval_date?: string | null
          approved_by?: string | null
          created_at?: string | null
          employee_id: string
          end_date: string
          id?: string
          leave_type: string
          reason?: string | null
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_date?: string | null
          approved_by?: string | null
          created_at?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      licenses: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          issuing_authority: string | null
          name: string
          requires_expiration: boolean | null
          updated_at: string | null
          validity_period_months: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          issuing_authority?: string | null
          name: string
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          issuing_authority?: string | null
          name?: string
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          dedup_key: string | null
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          message: string | null
          profile_id: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          dedup_key?: string | null
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          message?: string | null
          profile_id: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          dedup_key?: string | null
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          message?: string | null
          profile_id?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          branding: Json | null
          code: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          updated_at: string | null
          venue_lat: number | null
          venue_lon: number | null
          website: string | null
        }
        Insert: {
          address?: string | null
          branding?: Json | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          phone?: string | null
          updated_at?: string | null
          venue_lat?: number | null
          venue_lon?: number | null
          website?: string | null
        }
        Update: {
          address?: string | null
          branding?: Json | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          updated_at?: string | null
          venue_lat?: number | null
          venue_lon?: number | null
          website?: string | null
        }
        Relationships: []
      }
      pay_periods: {
        Row: {
          created_at: string | null
          cutoff_date: string
          id: string
          locked_at: string | null
          locked_by: string | null
          period_end_date: string
          period_start_date: string
          status: string
        }
        Insert: {
          created_at?: string | null
          cutoff_date: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          period_end_date: string
          period_start_date: string
          status?: string
        }
        Update: {
          created_at?: string | null
          cutoff_date?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          period_end_date?: string
          period_start_date?: string
          status?: string
        }
        Relationships: []
      }
      planning_periods: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          end_date: string
          id: string
          organization_id: string
          published_at: string | null
          seeded_at: string | null
          start_date: string
          status: string
          sub_department_ids: string[]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          end_date: string
          id?: string
          organization_id: string
          published_at?: string | null
          seeded_at?: string | null
          start_date: string
          status?: string
          sub_department_ids?: string[]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          end_date?: string
          id?: string
          organization_id?: string
          published_at?: string | null
          seeded_at?: string | null
          start_date?: string
          status?: string
          sub_department_ids?: string[]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_periods_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_periods_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_periods_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      predicted_labor_demand: {
        Row: {
          corrected_count: number
          created_at: string
          event_id: string
          id: string
          model_version: string
          predicted_count: number
          role: string
          time_slot: number
        }
        Insert: {
          corrected_count?: number
          created_at?: string
          event_id: string
          id?: string
          model_version?: string
          predicted_count?: number
          role: string
          time_slot: number
        }
        Update: {
          corrected_count?: number
          created_at?: string
          event_id?: string
          id?: string
          model_version?: string
          predicted_count?: number
          role?: string
          time_slot?: number
        }
        Relationships: [
          {
            foreignKeyName: "predicted_labor_demand_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability: Json | null
          avatar_url: string | null
          can_access_all_departments: boolean | null
          created_at: string | null
          date_of_birth: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_code: string | null
          employee_id: number | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          first_name: string
          full_name: string | null
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          legacy_department_id: string | null
          legacy_employee_id: string | null
          legacy_organization_id: string | null
          legacy_system_role: Database["public"]["Enums"]["system_role"] | null
          middle_name: string | null
          phone: string | null
          preferences: Json | null
          status: string | null
          termination_date: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: Json | null
          avatar_url?: string | null
          can_access_all_departments?: boolean | null
          created_at?: string | null
          date_of_birth?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employee_id?: number | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name: string
          full_name?: string | null
          hire_date?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          legacy_department_id?: string | null
          legacy_employee_id?: string | null
          legacy_organization_id?: string | null
          legacy_system_role?: Database["public"]["Enums"]["system_role"] | null
          middle_name?: string | null
          phone?: string | null
          preferences?: Json | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: Json | null
          avatar_url?: string | null
          can_access_all_departments?: boolean | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employee_id?: number | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name?: string
          full_name?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          legacy_department_id?: string | null
          legacy_employee_id?: string | null
          legacy_organization_id?: string | null
          legacy_system_role?: Database["public"]["Enums"]["system_role"] | null
          middle_name?: string | null
          phone?: string | null
          preferences?: Json | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          applies_to_state: string | null
          created_at: string | null
          holiday_date: string
          holiday_name: string
          id: string
          is_national: boolean | null
        }
        Insert: {
          applies_to_state?: string | null
          created_at?: string | null
          holiday_date: string
          holiday_name: string
          id?: string
          is_national?: boolean | null
        }
        Update: {
          applies_to_state?: string | null
          created_at?: string | null
          holiday_date?: string
          holiday_name?: string
          id?: string
          is_national?: boolean | null
        }
        Relationships: []
      }
      rbac_actions: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
        }
        Relationships: []
      }
      rbac_permissions: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          action_code: string
          scope: Database["public"]["Enums"]["rbac_scope"]
        }
        Insert: {
          access_level: Database["public"]["Enums"]["access_level"]
          action_code: string
          scope: Database["public"]["Enums"]["rbac_scope"]
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          action_code?: string
          scope?: Database["public"]["Enums"]["rbac_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "rbac_permissions_action_code_fkey"
            columns: ["action_code"]
            isOneToOne: false
            referencedRelation: "rbac_actions"
            referencedColumns: ["code"]
          },
        ]
      }
      remuneration_levels: {
        Row: {
          annual_salary_max: number | null
          annual_salary_min: number | null
          created_at: string | null
          description: string | null
          hourly_rate_max: number | null
          hourly_rate_min: number | null
          id: string
          level_name: string
          level_number: number
          updated_at: string | null
        }
        Insert: {
          annual_salary_max?: number | null
          annual_salary_min?: number | null
          created_at?: string | null
          description?: string | null
          hourly_rate_max?: number | null
          hourly_rate_min?: number | null
          id?: string
          level_name: string
          level_number: number
          updated_at?: string | null
        }
        Update: {
          annual_salary_max?: number | null
          annual_salary_min?: number | null
          created_at?: string | null
          description?: string | null
          hourly_rate_max?: number | null
          hourly_rate_min?: number | null
          id?: string
          level_name?: string
          level_number?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      rest_period_violations: {
        Row: {
          employee_id: string
          first_shift_end: string
          first_shift_id: string
          id: string
          rest_hours: number
          second_shift_id: string
          second_shift_start: string
          violation_detected_at: string | null
        }
        Insert: {
          employee_id: string
          first_shift_end: string
          first_shift_id: string
          id?: string
          rest_hours: number
          second_shift_id: string
          second_shift_start: string
          violation_detected_at?: string | null
        }
        Update: {
          employee_id?: string
          first_shift_end?: string
          first_shift_id?: string
          id?: string
          rest_hours?: number
          second_shift_id?: string
          second_shift_start?: string
          violation_detected_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rest_period_violations_first_shift_id_fkey"
            columns: ["first_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rest_period_violations_first_shift_id_fkey"
            columns: ["first_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rest_period_violations_second_shift_id_fkey"
            columns: ["second_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rest_period_violations_second_shift_id_fkey"
            columns: ["second_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      role_levels: {
        Row: {
          hierarchy_rank: number
          id: string
          level_code: string
          remuneration_level_id: string
          role_id: string
        }
        Insert: {
          hierarchy_rank: number
          id?: string
          level_code: string
          remuneration_level_id: string
          role_id: string
        }
        Update: {
          hierarchy_rank?: number
          id?: string
          level_code?: string
          remuneration_level_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_levels_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_levels_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_ml_class_map: {
        Row: {
          ml_class: string
          role_id: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ml_class: string
          role_id: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ml_class?: string
          role_id?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_ml_class_map_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: true
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string | null
          description: string | null
          forecasting_bucket: string | null
          id: string
          is_active: boolean | null
          is_baseline_eligible: boolean | null
          level: number
          name: string
          remuneration_level_id: string | null
          responsibilities: string[] | null
          sub_department_id: string | null
          supervision_ratio_max: number | null
          supervision_ratio_min: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          forecasting_bucket?: string | null
          id?: string
          is_active?: boolean | null
          is_baseline_eligible?: boolean | null
          level: number
          name: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          supervision_ratio_max?: number | null
          supervision_ratio_min?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          forecasting_bucket?: string | null
          id?: string
          is_active?: boolean | null
          is_baseline_eligible?: boolean | null
          level?: number
          name?: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          supervision_ratio_max?: number | null
          supervision_ratio_min?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_groups: {
        Row: {
          created_at: string | null
          external_id: string | null
          id: string
          name: string
          roster_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          external_id?: string | null
          id?: string
          name: string
          roster_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          external_id?: string | null
          id?: string
          name?: string
          roster_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_groups_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_shift_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          confirmed_at: string | null
          employee_id: string
          id: string
          notes: string | null
          roster_shift_id: string
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          confirmed_at?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          roster_shift_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          confirmed_at?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          roster_shift_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "roster_shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shift_assignments_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_subgroups: {
        Row: {
          created_at: string | null
          id: string
          min_headcount: number
          name: string
          required_headcount: number
          roster_group_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          min_headcount?: number
          name: string
          required_headcount?: number
          roster_group_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          min_headcount?: number
          name?: string
          required_headcount?: number
          roster_group_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_subgroups_roster_group_id_fkey"
            columns: ["roster_group_id"]
            isOneToOne: false
            referencedRelation: "roster_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_template_applications: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          id: string
          roster_id: string
          template_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          id?: string
          roster_id: string
          template_id: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          id?: string
          roster_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_template_applications_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_applications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_applications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_template_batches: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string | null
          end_date: string
          id: string
          source: string
          start_date: string
          template_id: string
          updated_at: string | null
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string | null
          end_date: string
          id?: string
          source: string
          start_date: string
          template_id: string
          updated_at?: string | null
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string | null
          end_date?: string
          id?: string
          source?: string
          start_date?: string
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_template_batches_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_templates: {
        Row: {
          applied_count: number | null
          created_at: string
          created_by: string | null
          created_from: string | null
          department_id: string | null
          description: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          is_base_template: boolean | null
          last_edited_by: string | null
          last_used_at: string | null
          name: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          published_month: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["template_status"]
          sub_department_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          applied_count?: number | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          last_used_at?: string | null
          name: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          sub_department_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          applied_count?: number | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          last_used_at?: string | null
          name?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          sub_department_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "roster_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      rosters: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          end_date: string
          id: string
          is_locked: boolean
          organization_id: string
          planning_period_id: string | null
          published_at: string | null
          published_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date: string
          id?: string
          is_locked?: boolean
          organization_id: string
          planning_period_id?: string | null
          published_at?: string | null
          published_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string
          id?: string
          is_locked?: boolean
          organization_id?: string
          planning_period_id?: string | null
          published_at?: string | null
          published_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rosters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_planning_period_id_fkey"
            columns: ["planning_period_id"]
            isOneToOne: false
            referencedRelation: "planning_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_bid_windows: {
        Row: {
          closes_at: string
          created_at: string | null
          id: string
          opens_at: string
          shift_id: string
          status: string
          total_bids: number | null
        }
        Insert: {
          closes_at: string
          created_at?: string | null
          id?: string
          opens_at?: string
          shift_id: string
          status?: string
          total_bids?: number | null
        }
        Update: {
          closes_at?: string
          created_at?: string | null
          id?: string
          opens_at?: string
          shift_id?: string
          status?: string
          total_bids?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_bid_windows_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bid_windows_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_bids: {
        Row: {
          allocation_reason: string | null
          bid_priority: number | null
          bid_rank: number | null
          created_at: string
          employee_id: string
          hours_limit_valid: boolean | null
          id: string
          notes: string | null
          rest_period_valid: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          skill_match_percentage: number | null
          status: string
          suitability_score: number | null
          updated_at: string
        }
        Insert: {
          allocation_reason?: string | null
          bid_priority?: number | null
          bid_rank?: number | null
          created_at?: string
          employee_id: string
          hours_limit_valid?: boolean | null
          id?: string
          notes?: string | null
          rest_period_valid?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          skill_match_percentage?: number | null
          status?: string
          suitability_score?: number | null
          updated_at?: string
        }
        Update: {
          allocation_reason?: string | null
          bid_priority?: number | null
          bid_rank?: number | null
          created_at?: string
          employee_id?: string
          hours_limit_valid?: boolean | null
          id?: string
          notes?: string | null
          rest_period_valid?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          skill_match_percentage?: number | null
          status?: string
          suitability_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_bids_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_compliance_snapshots: {
        Row: {
          checked_at: string | null
          checked_by_user_id: string | null
          compliance_snapshot: Json | null
          created_at: string
          eligibility_snapshot: Json | null
          id: string
          is_overridden: boolean
          overridden_at: string | null
          overridden_by_user_id: string | null
          override_reason: string | null
          shift_id: string
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          checked_by_user_id?: string | null
          compliance_snapshot?: Json | null
          created_at?: string
          eligibility_snapshot?: Json | null
          id?: string
          is_overridden?: boolean
          overridden_at?: string | null
          overridden_by_user_id?: string | null
          override_reason?: string | null
          shift_id: string
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          checked_by_user_id?: string | null
          compliance_snapshot?: Json | null
          created_at?: string
          eligibility_snapshot?: Json | null
          id?: string
          is_overridden?: boolean
          overridden_at?: string | null
          overridden_by_user_id?: string | null
          override_reason?: string | null
          shift_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_compliance_snapshots_checked_by_user_id_fkey"
            columns: ["checked_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_compliance_snapshots_overridden_by_user_id_fkey"
            columns: ["overridden_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_compliance_snapshots_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_compliance_snapshots_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_event_tags: {
        Row: {
          created_at: string | null
          event_tag_id: string
          id: string
          shift_id: string
        }
        Insert: {
          created_at?: string | null
          event_tag_id: string
          id?: string
          shift_id: string
        }
        Update: {
          created_at?: string | null
          event_tag_id?: string
          id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_event_tags_event_tag_id_fkey"
            columns: ["event_tag_id"]
            isOneToOne: false
            referencedRelation: "event_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_event_tags_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_event_tags_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_events: {
        Row: {
          created_at: string | null
          employee_id: string | null
          event_time: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          id: string
          metadata: Json | null
          shift_id: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          event_time?: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          id?: string
          metadata?: Json | null
          shift_id?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          event_time?: string
          event_type?: Database["public"]["Enums"]["shift_event_type"]
          id?: string
          metadata?: Json | null
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_flags: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          flag_type: string
          id: string
          metadata: Json | null
          shift_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          flag_type: string
          id?: string
          metadata?: Json | null
          shift_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          flag_type?: string
          id?: string
          metadata?: Json | null
          shift_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_flags_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_flags_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_licenses: {
        Row: {
          created_at: string | null
          id: string
          is_required: boolean | null
          license_id: string
          shift_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          license_id: string
          shift_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          license_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_licenses_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_licenses_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_licenses_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_offers: {
        Row: {
          created_at: string | null
          employee_id: string
          id: string
          offer_expires_at: string | null
          offered_at: string | null
          responded_at: string | null
          response_notes: string | null
          shift_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          id?: string
          offer_expires_at?: string | null
          offered_at?: string | null
          responded_at?: string | null
          response_notes?: string | null
          shift_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          id?: string
          offer_expires_at?: string | null
          offered_at?: string | null
          responded_at?: string | null
          response_notes?: string | null
          shift_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_offers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_offers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_offers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_payroll_records: {
        Row: {
          actual_end: string | null
          actual_net_minutes: number | null
          actual_start: string | null
          created_at: string
          id: string
          payroll_exported: boolean
          payroll_exported_at: string | null
          payroll_exported_by: string | null
          shift_id: string
          timesheet_id: string | null
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          created_at?: string
          id?: string
          payroll_exported?: boolean
          payroll_exported_at?: string | null
          payroll_exported_by?: string | null
          shift_id: string
          timesheet_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          created_at?: string
          id?: string
          payroll_exported?: boolean
          payroll_exported_at?: string | null
          payroll_exported_by?: string | null
          shift_id?: string
          timesheet_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_payroll_records_payroll_exported_by_fkey"
            columns: ["payroll_exported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payroll_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payroll_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payroll_records_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_skills: {
        Row: {
          created_at: string | null
          id: string
          shift_id: string
          skill_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          shift_id: string
          skill_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          shift_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_skills_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_skills_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_subgroups: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      shift_swaps: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          manager_approved: boolean | null
          reason: string | null
          rejection_reason: string | null
          requester_id: string
          requester_shift_id: string
          status: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at: string | null
          swap_type: string
          target_accepted: boolean | null
          target_id: string | null
          target_response_at: string | null
          target_shift_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id: string
          requester_shift_id: string
          status?: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at?: string | null
          swap_type?: string
          target_accepted?: boolean | null
          target_id?: string | null
          target_response_at?: string | null
          target_shift_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id?: string
          requester_shift_id?: string
          status?: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at?: string | null
          swap_type?: string
          target_accepted?: boolean | null
          target_id?: string | null
          target_response_at?: string | null
          target_shift_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_swaps_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_requester_shift_id_fkey"
            columns: ["requester_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_requester_shift_id_fkey"
            columns: ["requester_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string
          description: string | null
          end_date: string | null
          groups: Json
          id: string
          is_draft: boolean
          name: string
          start_date: string | null
          sub_department_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id: string
          description?: string | null
          end_date?: string | null
          groups?: Json
          id?: string
          is_draft?: boolean
          name: string
          start_date?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string
          description?: string | null
          end_date?: string | null
          groups?: Json
          id?: string
          is_draft?: boolean
          name?: string
          start_date?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          actual_end: string | null
          actual_hourly_rate: number | null
          actual_net_minutes: number | null
          actual_start: string | null
          assigned_at: string | null
          assigned_employee_id: string | null
          assignment_id: string | null
          assignment_outcome:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source: string | null
          assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          attendance_note: string | null
          attendance_status: Database["public"]["Enums"]["shift_attendance_status"]
          bidding_close_at: string | null
          bidding_enabled: boolean | null
          bidding_open_at: string | null
          bidding_opened_at: string | null
          bidding_priority_text: string | null
          bidding_status: Database["public"]["Enums"]["shift_bidding_status"]
          break_minutes: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_user_id: string | null
          compliance_checked_at: string | null
          compliance_override: boolean | null
          compliance_override_reason: string | null
          compliance_snapshot: Json | null
          confirmed_at: string | null
          cost_center_id: string | null
          created_at: string | null
          created_by_user_id: string | null
          creation_source: string | null
          currency: string | null
          deleted_at: string | null
          deleted_by: string | null
          demand_group_id: string | null
          demand_source: string | null
          department_id: string
          display_order: number | null
          dropped_by_id: string | null
          eligibility_snapshot: Json | null
          emergency_assigned_at: string | null
          emergency_assigned_by: string | null
          emergency_source: string | null
          end_at: string | null
          end_time: string
          event_ids: Json | null
          event_tags: Json | null
          final_call_sent_at: string | null
          fulfillment_status: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type: Database["public"]["Enums"]["template_group_type"] | null
          id: string
          is_cancelled: boolean
          is_draft: boolean | null
          is_from_template: boolean
          is_locked: boolean | null
          is_on_bidding: boolean | null
          is_overnight: boolean
          is_published: boolean | null
          is_recurring: boolean | null
          is_training: boolean | null
          is_urgent: boolean | null
          last_dropped_by: string | null
          last_modified_by: string | null
          last_modified_reason: string | null
          last_rejected_by: string | null
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          lock_reason_text: string | null
          locked_at: string | null
          net_length_minutes: number | null
          notes: string | null
          offer_expires_at: string | null
          offer_sent_at: string | null
          organization_id: string | null
          paid_break_minutes: number | null
          payroll_exported: boolean | null
          published_at: string | null
          published_by_user_id: string | null
          recurrence_rule: string | null
          remuneration_level_id: string | null
          remuneration_rate: number | null
          required_certifications: Json | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          role_level: number | null
          roster_date: string | null
          roster_id: string
          roster_shift_id: string | null
          roster_subgroup_id: string
          roster_template_id: string | null
          scheduled_end: string | null
          scheduled_length_minutes: number | null
          scheduled_start: string | null
          shift_date: string
          shift_group_id: string | null
          start_at: string | null
          start_time: string
          sub_department_id: string | null
          sub_group_name: string | null
          synthesis_run_id: string | null
          tags: Json | null
          target_employment_type: string | null
          template_batch_id: string | null
          template_group:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id: string | null
          template_instance_id: string | null
          template_sub_group: string | null
          timesheet_id: string | null
          timezone: string | null
          total_hours: number | null
          trade_requested_at: string | null
          trading_status: Database["public"]["Enums"]["shift_trading"]
          tz_identifier: string | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          user_contract_id: string | null
          version: number
        }
        Insert: {
          actual_end?: string | null
          actual_hourly_rate?: number | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_id?: string | null
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source?: string | null
          assignment_status?: Database["public"]["Enums"]["shift_assignment_status"]
          attendance_note?: string | null
          attendance_status?: Database["public"]["Enums"]["shift_attendance_status"]
          bidding_close_at?: string | null
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_opened_at?: string | null
          bidding_priority_text?: string | null
          bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          break_minutes?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null
          confirmed_at?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          creation_source?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          demand_group_id?: string | null
          demand_source?: string | null
          department_id: string
          display_order?: number | null
          dropped_by_id?: string | null
          eligibility_snapshot?: Json | null
          emergency_assigned_at?: string | null
          emergency_assigned_by?: string | null
          emergency_source?: string | null
          end_at?: string | null
          end_time: string
          event_ids?: Json | null
          event_tags?: Json | null
          final_call_sent_at?: string | null
          fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string
          is_cancelled?: boolean
          is_draft?: boolean | null
          is_from_template?: boolean
          is_locked?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean
          is_published?: boolean | null
          is_recurring?: boolean | null
          is_training?: boolean | null
          is_urgent?: boolean | null
          last_dropped_by?: string | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          last_rejected_by?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          lock_reason_text?: string | null
          locked_at?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          offer_sent_at?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          recurrence_rule?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_certifications?: Json | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          role_level?: number | null
          roster_date?: string | null
          roster_id: string
          roster_shift_id?: string | null
          roster_subgroup_id: string
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date: string
          shift_group_id?: string | null
          start_at?: string | null
          start_time: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          target_employment_type?: string | null
          template_batch_id?: string | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          timesheet_id?: string | null
          timezone?: string | null
          total_hours?: number | null
          trade_requested_at?: string | null
          trading_status?: Database["public"]["Enums"]["shift_trading"]
          tz_identifier?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Update: {
          actual_end?: string | null
          actual_hourly_rate?: number | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_id?: string | null
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source?: string | null
          assignment_status?: Database["public"]["Enums"]["shift_assignment_status"]
          attendance_note?: string | null
          attendance_status?: Database["public"]["Enums"]["shift_attendance_status"]
          bidding_close_at?: string | null
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_opened_at?: string | null
          bidding_priority_text?: string | null
          bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          break_minutes?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null
          confirmed_at?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          creation_source?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          demand_group_id?: string | null
          demand_source?: string | null
          department_id?: string
          display_order?: number | null
          dropped_by_id?: string | null
          eligibility_snapshot?: Json | null
          emergency_assigned_at?: string | null
          emergency_assigned_by?: string | null
          emergency_source?: string | null
          end_at?: string | null
          end_time?: string
          event_ids?: Json | null
          event_tags?: Json | null
          final_call_sent_at?: string | null
          fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string
          is_cancelled?: boolean
          is_draft?: boolean | null
          is_from_template?: boolean
          is_locked?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean
          is_published?: boolean | null
          is_recurring?: boolean | null
          is_training?: boolean | null
          is_urgent?: boolean | null
          last_dropped_by?: string | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          last_rejected_by?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          lock_reason_text?: string | null
          locked_at?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          offer_sent_at?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          recurrence_rule?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_certifications?: Json | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          role_level?: number | null
          roster_date?: string | null
          roster_id?: string
          roster_shift_id?: string | null
          roster_subgroup_id?: string
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date?: string
          shift_group_id?: string | null
          start_at?: string | null
          start_time?: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          target_employment_type?: string | null
          template_batch_id?: string | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          timesheet_id?: string | null
          timezone?: string | null
          total_hours?: number | null
          trade_requested_at?: string | null
          trading_status?: Database["public"]["Enums"]["shift_trading"]
          tz_identifier?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_shifts_assigned_profile"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_shifts_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_shifts_remuneration"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_dropped_by_id_fkey"
            columns: ["dropped_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_last_dropped_by_fkey"
            columns: ["last_dropped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_last_rejected_by_fkey"
            columns: ["last_rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_subgroup_id_fkey"
            columns: ["roster_subgroup_id"]
            isOneToOne: false
            referencedRelation: "roster_subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_template_id_fkey"
            columns: ["roster_template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_template_id_fkey"
            columns: ["roster_template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_synthesis_run_id_fkey"
            columns: ["synthesis_run_id"]
            isOneToOne: false
            referencedRelation: "synthesis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_batch_id_fkey"
            columns: ["template_batch_id"]
            isOneToOne: false
            referencedRelation: "roster_template_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_user_contract_id_fkey"
            columns: ["user_contract_id"]
            isOneToOne: false
            referencedRelation: "user_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: string | null
          created_at: string | null
          default_validity_months: number | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          requires_expiration: boolean | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_validity_months?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          requires_expiration?: boolean | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_validity_months?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          requires_expiration?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sub_departments: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      supervisor_feedback: {
        Row: {
          created_at: string
          event_id: string | null
          function_code: string
          id: string
          level: number
          reason_code: string
          reason_note: string | null
          rule_version_at_event: number | null
          severity: number
          slice_end: number
          slice_start: number
          supervisor_id: string | null
          verdict: Database["public"]["Enums"]["feedback_verdict"]
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          function_code: string
          id?: string
          level: number
          reason_code: string
          reason_note?: string | null
          rule_version_at_event?: number | null
          severity: number
          slice_end: number
          slice_start: number
          supervisor_id?: string | null
          verdict: Database["public"]["Enums"]["feedback_verdict"]
        }
        Update: {
          created_at?: string
          event_id?: string | null
          function_code?: string
          id?: string
          level?: number
          reason_code?: string
          reason_note?: string | null
          rule_version_at_event?: number | null
          severity?: number
          slice_end?: number
          slice_start?: number
          supervisor_id?: string | null
          verdict?: Database["public"]["Enums"]["feedback_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "supervisor_feedback_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "supervisor_feedback_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_approvals: {
        Row: {
          action: string
          actioned_at: string | null
          approver_id: string
          comments: string | null
          id: string
          swap_request_id: string
        }
        Insert: {
          action: string
          actioned_at?: string | null
          approver_id: string
          comments?: string | null
          id?: string
          swap_request_id: string
        }
        Update: {
          action?: string
          actioned_at?: string | null
          approver_id?: string
          comments?: string | null
          id?: string
          swap_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_approvals_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "swap_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          notification_type: string
          recipient_user_id: string
          swap_request_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          notification_type: string
          recipient_user_id: string
          swap_request_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          notification_type?: string
          recipient_user_id?: string
          swap_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_notifications_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "swap_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_offers: {
        Row: {
          compliance_snapshot: Json | null
          created_at: string | null
          id: string
          offered_shift_id: string | null
          offerer_id: string
          status: Database["public"]["Enums"]["swap_offer_status"]
          swap_request_id: string
          updated_at: string | null
        }
        Insert: {
          compliance_snapshot?: Json | null
          created_at?: string | null
          id?: string
          offered_shift_id?: string | null
          offerer_id: string
          status?: Database["public"]["Enums"]["swap_offer_status"]
          swap_request_id: string
          updated_at?: string | null
        }
        Update: {
          compliance_snapshot?: Json | null
          created_at?: string | null
          id?: string
          offered_shift_id?: string | null
          offerer_id?: string
          status?: Database["public"]["Enums"]["swap_offer_status"]
          swap_request_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_offers_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_offerer_id_fkey"
            columns: ["offerer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "shift_swaps"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_requests: {
        Row: {
          approved_by_manager_id: string | null
          created_at: string | null
          department_id: string | null
          id: string
          manager_approved_at: string | null
          offered_shift_id: string | null
          open_swap: boolean | null
          organization_id: string | null
          original_shift_id: string
          priority: string | null
          reason: string | null
          rejection_reason: string | null
          requested_by_employee_id: string
          responded_at: string | null
          status: string
          swap_with_employee_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_by_manager_id?: string | null
          created_at?: string | null
          department_id?: string | null
          id?: string
          manager_approved_at?: string | null
          offered_shift_id?: string | null
          open_swap?: boolean | null
          organization_id?: string | null
          original_shift_id: string
          priority?: string | null
          reason?: string | null
          rejection_reason?: string | null
          requested_by_employee_id: string
          responded_at?: string | null
          status?: string
          swap_with_employee_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_by_manager_id?: string | null
          created_at?: string | null
          department_id?: string | null
          id?: string
          manager_approved_at?: string | null
          offered_shift_id?: string | null
          open_swap?: boolean | null
          organization_id?: string | null
          original_shift_id?: string
          priority?: string | null
          reason?: string | null
          rejection_reason?: string | null
          requested_by_employee_id?: string
          responded_at?: string | null
          status?: string
          swap_with_employee_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_original_shift_id_fkey"
            columns: ["original_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_original_shift_id_fkey"
            columns: ["original_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_validations: {
        Row: {
          daily_hours_check: boolean | null
          employee_id: string
          id: string
          is_valid: boolean | null
          monthly_hours_check: boolean | null
          rest_period_check: boolean | null
          skill_match_check: boolean | null
          swap_request_id: string
          validated_at: string | null
          validation_errors: Json | null
        }
        Insert: {
          daily_hours_check?: boolean | null
          employee_id: string
          id?: string
          is_valid?: boolean | null
          monthly_hours_check?: boolean | null
          rest_period_check?: boolean | null
          skill_match_check?: boolean | null
          swap_request_id: string
          validated_at?: string | null
          validation_errors?: Json | null
        }
        Update: {
          daily_hours_check?: boolean | null
          employee_id?: string
          id?: string
          is_valid?: boolean | null
          monthly_hours_check?: boolean | null
          rest_period_check?: boolean | null
          skill_match_check?: boolean | null
          swap_request_id?: string
          validated_at?: string | null
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_validations_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "swap_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      synthesis_runs: {
        Row: {
          attempted_count: number
          created_at: string
          created_by: string
          created_count: number
          deleted_count: number
          department_id: string
          id: string
          options: Json
          organization_id: string
          rolled_back_at: string | null
          rolled_back_by: string | null
          rolled_back_count: number | null
          roster_id: string
          shift_date: string
          sub_department_id: string | null
        }
        Insert: {
          attempted_count?: number
          created_at?: string
          created_by: string
          created_count?: number
          deleted_count?: number
          department_id: string
          id?: string
          options?: Json
          organization_id: string
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          rolled_back_count?: number | null
          roster_id: string
          shift_date: string
          sub_department_id?: string | null
        }
        Update: {
          attempted_count?: number
          created_at?: string
          created_by?: string
          created_count?: number
          deleted_count?: number
          department_id?: string
          id?: string
          options?: Json
          organization_id?: string
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          rolled_back_count?: number | null
          roster_id?: string
          shift_date?: string
          sub_department_id?: string | null
        }
        Relationships: []
      }
      system_config: {
        Row: {
          config_key: string
          config_value: Json
          description: string | null
          id: string
          last_modified_at: string | null
          last_modified_by: string | null
        }
        Insert: {
          config_key: string
          config_value?: Json
          description?: string | null
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: Json
          description?: string | null
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
        }
        Relationships: []
      }
      template_groups: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_groups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_groups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      template_shifts: {
        Row: {
          assigned_employee_id: string | null
          assigned_employee_name: string | null
          created_at: string | null
          day_of_week: number | null
          end_time: string | null
          event_tags: string[] | null
          id: string
          name: string | null
          net_length_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          remuneration_level: string | null
          remuneration_level_id: string | null
          required_licenses: string[] | null
          required_skills: string[] | null
          role_id: string | null
          role_name: string | null
          site_tags: string[] | null
          sort_order: number | null
          start_time: string | null
          subgroup_id: string | null
          unpaid_break_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          assigned_employee_id?: string | null
          assigned_employee_name?: string | null
          created_at?: string | null
          day_of_week?: number | null
          end_time?: string | null
          event_tags?: string[] | null
          id?: string
          name?: string | null
          net_length_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          remuneration_level?: string | null
          remuneration_level_id?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          site_tags?: string[] | null
          sort_order?: number | null
          start_time?: string | null
          subgroup_id?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          assigned_employee_id?: string | null
          assigned_employee_name?: string | null
          created_at?: string | null
          day_of_week?: number | null
          end_time?: string | null
          event_tags?: string[] | null
          id?: string
          name?: string | null
          net_length_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          remuneration_level?: string | null
          remuneration_level_id?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          site_tags?: string[] | null
          sort_order?: number | null
          start_time?: string | null
          subgroup_id?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_shifts_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_shifts_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_shifts_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "template_subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      template_subgroups: {
        Row: {
          created_at: string | null
          description: string | null
          group_id: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_subgroups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "template_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assignment_id: string | null
          break_minutes: number | null
          clock_in: string
          clock_out: string | null
          created_at: string | null
          employee_id: string | null
          end_time: string | null
          id: string
          net_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          profile_id: string
          rejected_reason: string | null
          shift_id: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at: string | null
          total_hours: number | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          work_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          end_time?: string | null
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at?: string | null
          total_hours?: number | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          work_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          end_time?: string | null
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id?: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at?: string | null
          total_hours?: number | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      user_contracts: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"] | null
          created_at: string | null
          created_by: string | null
          custom_hourly_rate: number | null
          department_id: string | null
          employment_status:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string
          rem_level_id: string
          role_id: string
          start_date: string | null
          status: string
          sub_department_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          created_at?: string | null
          created_by?: string | null
          custom_hourly_rate?: number | null
          department_id?: string | null
          employment_status?:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          rem_level_id: string
          role_id: string
          start_date?: string | null
          status?: string
          sub_department_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          created_at?: string | null
          created_by?: string | null
          custom_hourly_rate?: number | null
          department_id?: string | null
          employment_status?:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          rem_level_id?: string
          role_id?: string
          start_date?: string | null
          status?: string
          sub_department_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_rem_level_id_fkey"
            columns: ["rem_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venueops_booked_spaces: {
        Row: {
          attendance: number
          booked_status: string
          created_at: string
          description: string | null
          end_date: string | null
          end_time: string | null
          event_id: string
          id: string
          is_all_day: boolean
          is_invoiced: boolean
          number_of_hours: number
          option_number: number | null
          room_capacity: number | null
          room_id: string | null
          room_name: string | null
          room_setup: string | null
          space_usage_id: string | null
          space_usage_name: string | null
          square_footage: number | null
          start_date: string | null
          start_time: string | null
          usage_type: string | null
          venue_id: string | null
        }
        Insert: {
          attendance?: number
          booked_status?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          event_id: string
          id: string
          is_all_day?: boolean
          is_invoiced?: boolean
          number_of_hours?: number
          option_number?: number | null
          room_capacity?: number | null
          room_id?: string | null
          room_name?: string | null
          room_setup?: string | null
          space_usage_id?: string | null
          space_usage_name?: string | null
          square_footage?: number | null
          start_date?: string | null
          start_time?: string | null
          usage_type?: string | null
          venue_id?: string | null
        }
        Update: {
          attendance?: number
          booked_status?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          event_id?: string
          id?: string
          is_all_day?: boolean
          is_invoiced?: boolean
          number_of_hours?: number
          option_number?: number | null
          room_capacity?: number | null
          room_id?: string | null
          room_name?: string | null
          room_setup?: string | null
          space_usage_id?: string | null
          space_usage_name?: string | null
          square_footage?: number | null
          start_date?: string | null
          start_time?: string | null
          usage_type?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venueops_booked_spaces_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "venueops_booked_spaces_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "venueops_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      venueops_event_types: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      venueops_events: {
        Row: {
          actual_total_attendance: number | null
          alcohol: boolean | null
          bump_in_min: number | null
          bump_out_min: number | null
          created_at: string
          end_date_time: string
          estimated_total_attendance: number
          event_id: string
          event_type_id: string | null
          event_type_name: string | null
          is_canceled: boolean
          is_definite: boolean
          is_prospect: boolean
          is_tentative: boolean
          layout_complexity: string | null
          name: string
          number_of_event_days: number
          room_ids: string | null
          room_names: string | null
          series_id: string | null
          service_type: string | null
          start_date_time: string
          venue_ids: string | null
          venue_names: string | null
        }
        Insert: {
          actual_total_attendance?: number | null
          alcohol?: boolean | null
          bump_in_min?: number | null
          bump_out_min?: number | null
          created_at?: string
          end_date_time: string
          estimated_total_attendance?: number
          event_id: string
          event_type_id?: string | null
          event_type_name?: string | null
          is_canceled?: boolean
          is_definite?: boolean
          is_prospect?: boolean
          is_tentative?: boolean
          layout_complexity?: string | null
          name: string
          number_of_event_days?: number
          room_ids?: string | null
          room_names?: string | null
          series_id?: string | null
          service_type?: string | null
          start_date_time: string
          venue_ids?: string | null
          venue_names?: string | null
        }
        Update: {
          actual_total_attendance?: number | null
          alcohol?: boolean | null
          bump_in_min?: number | null
          bump_out_min?: number | null
          created_at?: string
          end_date_time?: string
          estimated_total_attendance?: number
          event_id?: string
          event_type_id?: string | null
          event_type_name?: string | null
          is_canceled?: boolean
          is_definite?: boolean
          is_prospect?: boolean
          is_tentative?: boolean
          layout_complexity?: string | null
          name?: string
          number_of_event_days?: number
          room_ids?: string | null
          room_names?: string | null
          series_id?: string | null
          service_type?: string | null
          start_date_time?: string
          venue_ids?: string | null
          venue_names?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venueops_events_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "venueops_event_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venueops_events_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "venueops_series"
            referencedColumns: ["series_id"]
          },
        ]
      }
      venueops_function_types: {
        Row: {
          id: string
          is_performance: boolean
          name: string
          room_setup: string | null
          show_on_calendar: boolean
        }
        Insert: {
          id: string
          is_performance?: boolean
          name: string
          room_setup?: string | null
          show_on_calendar?: boolean
        }
        Update: {
          id?: string
          is_performance?: boolean
          name?: string
          room_setup?: string | null
          show_on_calendar?: boolean
        }
        Relationships: []
      }
      venueops_functions: {
        Row: {
          created_at: string
          date: string
          end_date_time: string
          end_time: string | null
          event_id: string
          event_type_name: string | null
          expected_attendance: number
          function_id: string
          function_type_id: string | null
          function_type_name: string | null
          is_canceled: boolean
          is_performance: boolean
          name: string
          number_of_hours: number
          room_id: string | null
          room_name: string | null
          start_date_time: string
          start_time: string | null
          venue_id: string | null
          venue_name: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_date_time: string
          end_time?: string | null
          event_id: string
          event_type_name?: string | null
          expected_attendance?: number
          function_id: string
          function_type_id?: string | null
          function_type_name?: string | null
          is_canceled?: boolean
          is_performance?: boolean
          name: string
          number_of_hours?: number
          room_id?: string | null
          room_name?: string | null
          start_date_time: string
          start_time?: string | null
          venue_id?: string | null
          venue_name?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_date_time?: string
          end_time?: string | null
          event_id?: string
          event_type_name?: string | null
          expected_attendance?: number
          function_id?: string
          function_type_id?: string | null
          function_type_name?: string | null
          is_canceled?: boolean
          is_performance?: boolean
          name?: string
          number_of_hours?: number
          room_id?: string | null
          room_name?: string | null
          start_date_time?: string
          start_time?: string | null
          venue_id?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venueops_functions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "venueops_functions_function_type_id_fkey"
            columns: ["function_type_id"]
            isOneToOne: false
            referencedRelation: "venueops_function_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venueops_functions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "venueops_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      venueops_ml_features: {
        Row: {
          created_at: string
          day_of_week: number
          entry_peak_flag: boolean
          event_id: string | null
          event_type: string | null
          exit_peak_flag: boolean
          expected_attendance: number
          function_end_datetime: string
          function_id: string | null
          function_start_datetime: string
          function_type: string | null
          id: string
          meal_window_flag: boolean
          month: number
          room_capacity: number
          room_count: number
          simultaneous_event_count: number
          target_role: string
          target_staff_count: number
          time_slice_index: number
          total_sqm: number
          total_venue_attendance_same_time: number
        }
        Insert: {
          created_at?: string
          day_of_week: number
          entry_peak_flag?: boolean
          event_id?: string | null
          event_type?: string | null
          exit_peak_flag?: boolean
          expected_attendance?: number
          function_end_datetime: string
          function_id?: string | null
          function_start_datetime: string
          function_type?: string | null
          id?: string
          meal_window_flag?: boolean
          month: number
          room_capacity?: number
          room_count?: number
          simultaneous_event_count?: number
          target_role: string
          target_staff_count?: number
          time_slice_index: number
          total_sqm?: number
          total_venue_attendance_same_time?: number
        }
        Update: {
          created_at?: string
          day_of_week?: number
          entry_peak_flag?: boolean
          event_id?: string | null
          event_type?: string | null
          exit_peak_flag?: boolean
          expected_attendance?: number
          function_end_datetime?: string
          function_id?: string | null
          function_start_datetime?: string
          function_type?: string | null
          id?: string
          meal_window_flag?: boolean
          month?: number
          room_capacity?: number
          room_count?: number
          simultaneous_event_count?: number
          target_role?: string
          target_staff_count?: number
          time_slice_index?: number
          total_sqm?: number
          total_venue_attendance_same_time?: number
        }
        Relationships: [
          {
            foreignKeyName: "venueops_ml_features_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "venueops_ml_features_function_id_fkey"
            columns: ["function_id"]
            isOneToOne: false
            referencedRelation: "venueops_functions"
            referencedColumns: ["function_id"]
          },
        ]
      }
      venueops_rooms: {
        Row: {
          conflicting_room_ids: string[]
          id: string
          is_active: boolean
          is_combo_room: boolean
          item_code: string | null
          max_capacity: number | null
          name: string
          room_group: string | null
          square_footage: number | null
          sub_room_ids: string[]
          venue_id: string | null
          venue_name: string | null
        }
        Insert: {
          conflicting_room_ids?: string[]
          id: string
          is_active?: boolean
          is_combo_room?: boolean
          item_code?: string | null
          max_capacity?: number | null
          name: string
          room_group?: string | null
          square_footage?: number | null
          sub_room_ids?: string[]
          venue_id?: string | null
          venue_name?: string | null
        }
        Update: {
          conflicting_room_ids?: string[]
          id?: string
          is_active?: boolean
          is_combo_room?: boolean
          item_code?: string | null
          max_capacity?: number | null
          name?: string
          room_group?: string | null
          square_footage?: number | null
          sub_room_ids?: string[]
          venue_id?: string | null
          venue_name?: string | null
        }
        Relationships: []
      }
      venueops_series: {
        Row: {
          announce_date_time: string | null
          name: string
          on_sale_date_time: string | null
          series_id: string
          unique_id: string | null
        }
        Insert: {
          announce_date_time?: string | null
          name: string
          on_sale_date_time?: string | null
          series_id: string
          unique_id?: string | null
        }
        Update: {
          announce_date_time?: string | null
          name?: string
          on_sale_date_time?: string | null
          series_id?: string
          unique_id?: string | null
        }
        Relationships: []
      }
      venueops_tasks: {
        Row: {
          assigned_to: Json
          completion_date: string | null
          creation_date: string
          description: string | null
          due_date: string | null
          event_id: string | null
          event_name: string | null
          id: string
          is_completed: boolean
          result: string | null
          task_type: string | null
          title: string
          venue_ids: string[]
        }
        Insert: {
          assigned_to?: Json
          completion_date?: string | null
          creation_date?: string
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          event_name?: string | null
          id: string
          is_completed?: boolean
          result?: string | null
          task_type?: string | null
          title: string
          venue_ids?: string[]
        }
        Update: {
          assigned_to?: Json
          completion_date?: string | null
          creation_date?: string
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          event_name?: string | null
          id?: string
          is_completed?: boolean
          result?: string | null
          task_type?: string | null
          title?: string
          venue_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "venueops_tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      work_rules: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          rule_name: string
          rule_value: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          rule_name: string
          rule_value?: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          rule_name?: string
          rule_value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      employee_daily_metrics: {
        Row: {
          accepted: number | null
          assigned: number | null
          cancelled: number | null
          early_out: number | null
          emergency: number | null
          employee_id: string | null
          event_date: string | null
          ignored: number | null
          late_cancelled: number | null
          late_in: number | null
          no_show: number | null
          offered: number | null
          rejected: number | null
          swapped: number | null
          worked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_broadcast_groups_with_stats: {
        Row: {
          active_broadcast_count: number | null
          channel_count: number | null
          color: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          icon: string | null
          id: string | null
          is_active: boolean | null
          last_broadcast_at: string | null
          name: string | null
          organization_id: string | null
          participant_count: number | null
          sub_department_id: string | null
          total_broadcast_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      v_channels_with_stats: {
        Row: {
          active_broadcast_count: number | null
          created_at: string | null
          description: string | null
          group_id: string | null
          id: string | null
          is_active: boolean | null
          last_broadcast_at: string | null
          name: string | null
          total_broadcast_count: number | null
          updated_at: string | null
        }
        Insert: {
          active_broadcast_count?: never
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string | null
          is_active?: boolean | null
          last_broadcast_at?: never
          name?: string | null
          total_broadcast_count?: never
          updated_at?: string | null
        }
        Update: {
          active_broadcast_count?: never
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string | null
          is_active?: boolean | null
          last_broadcast_at?: never
          name?: string | null
          total_broadcast_count?: never
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      v_performance_data_quality_alerts: {
        Row: {
          alert_type: string | null
          details: string | null
          employee_id: string | null
          shift_id: string | null
        }
        Relationships: []
      }
      v_shifts_grouped: {
        Row: {
          actual_end: string | null
          actual_hourly_rate: number | null
          actual_net_minutes: number | null
          actual_start: string | null
          assigned_at: string | null
          assigned_employee_id: string | null
          assignment_id: string | null
          assignment_outcome:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_status:
            | Database["public"]["Enums"]["shift_assignment_status"]
            | null
          attendance_status:
            | Database["public"]["Enums"]["shift_attendance_status"]
            | null
          bidding_close_at: string | null
          bidding_enabled: boolean | null
          bidding_open_at: string | null
          bidding_opened_at: string | null
          bidding_priority_text: string | null
          bidding_status:
            | Database["public"]["Enums"]["shift_bidding_status"]
            | null
          break_minutes: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_user_id: string | null
          compliance_checked_at: string | null
          compliance_override: boolean | null
          compliance_override_reason: string | null
          compliance_snapshot: Json | null
          confirmed_at: string | null
          cost_center_id: string | null
          created_at: string | null
          created_by_user_id: string | null
          currency: string | null
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          display_order: number | null
          eligibility_snapshot: Json | null
          end_time: string | null
          event_ids: Json | null
          event_tags: Json | null
          fulfillment_status:
            | Database["public"]["Enums"]["shift_fulfillment_status"]
            | null
          group_type: Database["public"]["Enums"]["template_group_type"] | null
          id: string | null
          is_cancelled: boolean | null
          is_draft: boolean | null
          is_from_template: boolean | null
          is_locked: boolean | null
          is_on_bidding: boolean | null
          is_overnight: boolean | null
          is_published: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          last_modified_by: string | null
          last_modified_reason: string | null
          lifecycle_status:
            | Database["public"]["Enums"]["shift_lifecycle"]
            | null
          lock_reason_text: string | null
          net_length_minutes: number | null
          notes: string | null
          offer_expires_at: string | null
          organization_id: string | null
          paid_break_minutes: number | null
          payroll_exported: boolean | null
          published_at: string | null
          published_by_user_id: string | null
          recurrence_rule: string | null
          remuneration_level_id: string | null
          remuneration_rate: number | null
          required_certifications: Json | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          role_level: number | null
          roster_date: string | null
          roster_id: string | null
          roster_shift_id: string | null
          roster_subgroup_id: string | null
          roster_template_id: string | null
          scheduled_end: string | null
          scheduled_length_minutes: number | null
          scheduled_start: string | null
          shift_date: string | null
          shift_group_id: string | null
          start_time: string | null
          sub_department_id: string | null
          sub_group_name: string | null
          tags: Json | null
          template_group:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id: string | null
          template_instance_id: string | null
          template_sub_group: string | null
          template_subgroup_text: string | null
          timesheet_id: string | null
          timezone: string | null
          total_hours: number | null
          trade_requested_at: string | null
          trading_status: Database["public"]["Enums"]["shift_trading"] | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          user_contract_id: string | null
          version: number | null
        }
        Insert: {
          actual_end?: string | null
          actual_hourly_rate?: number | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_id?: string | null
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_status?:
            | Database["public"]["Enums"]["shift_assignment_status"]
            | null
          attendance_status?:
            | Database["public"]["Enums"]["shift_attendance_status"]
            | null
          bidding_close_at?: string | null
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_opened_at?: string | null
          bidding_priority_text?: string | null
          bidding_status?:
            | Database["public"]["Enums"]["shift_bidding_status"]
            | null
          break_minutes?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null
          confirmed_at?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          display_order?: number | null
          eligibility_snapshot?: Json | null
          end_time?: string | null
          event_ids?: Json | null
          event_tags?: Json | null
          fulfillment_status?:
            | Database["public"]["Enums"]["shift_fulfillment_status"]
            | null
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string | null
          is_cancelled?: boolean | null
          is_draft?: boolean | null
          is_from_template?: boolean | null
          is_locked?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean | null
          is_published?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?:
            | Database["public"]["Enums"]["shift_lifecycle"]
            | null
          lock_reason_text?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          recurrence_rule?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_certifications?: Json | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          role_level?: number | null
          roster_date?: string | null
          roster_id?: string | null
          roster_shift_id?: string | null
          roster_subgroup_id?: string | null
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date?: string | null
          shift_group_id?: string | null
          start_time?: string | null
          sub_department_id?: string | null
          sub_group_name?: string | null
          tags?: Json | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          template_subgroup_text?: string | null
          timesheet_id?: string | null
          timezone?: string | null
          total_hours?: number | null
          trade_requested_at?: string | null
          trading_status?: Database["public"]["Enums"]["shift_trading"] | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number | null
        }
        Update: {
          actual_end?: string | null
          actual_hourly_rate?: number | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_id?: string | null
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_status?:
            | Database["public"]["Enums"]["shift_assignment_status"]
            | null
          attendance_status?:
            | Database["public"]["Enums"]["shift_attendance_status"]
            | null
          bidding_close_at?: string | null
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_opened_at?: string | null
          bidding_priority_text?: string | null
          bidding_status?:
            | Database["public"]["Enums"]["shift_bidding_status"]
            | null
          break_minutes?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null
          confirmed_at?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          display_order?: number | null
          eligibility_snapshot?: Json | null
          end_time?: string | null
          event_ids?: Json | null
          event_tags?: Json | null
          fulfillment_status?:
            | Database["public"]["Enums"]["shift_fulfillment_status"]
            | null
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string | null
          is_cancelled?: boolean | null
          is_draft?: boolean | null
          is_from_template?: boolean | null
          is_locked?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean | null
          is_published?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?:
            | Database["public"]["Enums"]["shift_lifecycle"]
            | null
          lock_reason_text?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          recurrence_rule?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_certifications?: Json | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          role_level?: number | null
          roster_date?: string | null
          roster_id?: string | null
          roster_shift_id?: string | null
          roster_subgroup_id?: string | null
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date?: string | null
          shift_group_id?: string | null
          start_time?: string | null
          sub_department_id?: string | null
          sub_group_name?: string | null
          tags?: Json | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          template_subgroup_text?: string | null
          timesheet_id?: string | null
          timezone?: string | null
          total_hours?: number | null
          trade_requested_at?: string | null
          trading_status?: Database["public"]["Enums"]["shift_trading"] | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_shifts_assigned_profile"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_shifts_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_shifts_remuneration"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_subgroup_id_fkey"
            columns: ["roster_subgroup_id"]
            isOneToOne: false
            referencedRelation: "roster_subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_template_id_fkey"
            columns: ["roster_template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_template_id_fkey"
            columns: ["roster_template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_user_contract_id_fkey"
            columns: ["user_contract_id"]
            isOneToOne: false
            referencedRelation: "user_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      v_template_full: {
        Row: {
          applied_count: number | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          end_date: string | null
          groups: Json | null
          id: string | null
          is_base_template: boolean | null
          last_edited_by: string | null
          name: string | null
          organization_id: string | null
          published_at: string | null
          published_by: string | null
          published_month: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["template_status"] | null
          sub_department_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          applied_count?: never
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          groups?: never
          id?: string | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          name?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"] | null
          sub_department_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          applied_count?: never
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          groups?: never
          id?: string | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          name?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"] | null
          sub_department_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      v_unread_broadcasts_by_group: {
        Row: {
          employee_id: string | null
          group_id: string | null
          has_pending_ack: boolean | null
          has_urgent_unread: boolean | null
          unread_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "group_participants_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_swap_offer: { Args: { p_offer_id: string }; Returns: undefined }
      acknowledge_broadcast: {
        Args: { broadcast_uuid: string; employee_uuid: string }
        Returns: boolean
      }
      activate_roster_for_range: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_org_id: string
          p_start_date: string
          p_sub_dept_id: string
        }
        Returns: Json
      }
      add_roster_shift: {
        Args: {
          p_roster_subgroup_id: string
          p_shift_data: Json
          p_user_id: string
        }
        Returns: {
          error_message: string
          shift_id: string
          success: boolean
        }[]
      }
      add_roster_subgroup_range:
        | {
            Args: {
              p_dept_id: string
              p_end_date: string
              p_group_external_id: string
              p_name: string
              p_org_id: string
              p_start_date: string
              p_sub_dept_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_end_date: string
              p_group_external_id: string
              p_name: string
              p_org_id: string
              p_start_date: string
            }
            Returns: undefined
          }
      admin_delete_shift_rpc: {
        Args: { p_admin_id: string; p_shift_id: string }
        Returns: Json
      }
      apply_monthly_template:
        | {
            Args: {
              p_month: string
              p_organization_id: string
              p_template_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_month: string
              p_organization_id: string
              p_template_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_month: string
              p_organization_id: string
              p_template_id: string
            }
            Returns: Json
          }
      apply_template_to_date_range: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_template_id: string
          p_user_id: string
        }
        Returns: Json
      }
      apply_template_to_date_range_v2: {
        Args: {
          p_end_date: string
          p_force_stack?: boolean
          p_source?: string
          p_start_date: string
          p_target_department_id?: string
          p_target_sub_department_id?: string
          p_template_id: string
          p_user_id: string
        }
        Returns: Json
      }
      approve_swap_request: { Args: { request_id: string }; Returns: undefined }
      assert_all_states: {
        Args: { p_allowed_states: string[]; p_shift_ids: string[] }
        Returns: undefined
      }
      assert_no_invalid_states: { Args: never; Returns: undefined }
      assert_shift_state: {
        Args: { p_expected_state: string; p_shift_id: string }
        Returns: undefined
      }
      assign_employee: {
        Args: {
          p_department_name: string
          p_is_primary?: boolean
          p_profile_id: string
          p_role_name?: string
          p_sub_department_name?: string
        }
        Returns: string
      }
      assign_employee_to_shift: {
        Args: {
          p_employee_id: string
          p_roster_shift_id: string
          p_user_id: string
        }
        Returns: {
          assignment_id: string
          error_message: string
          success: boolean
        }[]
      }
      assign_shift_employee: {
        Args: { p_actor_id?: string; p_employee_id: string; p_shift_id: string }
        Returns: Json
      }
      assign_shift_rpc: {
        Args: { p_employee_id: string; p_shift_id: string }
        Returns: Json
      }
      auth_can_create_template: {
        Args: {
          p_department_id: string
          p_organization_id: string
          p_sub_department_id: string
        }
        Returns: boolean
      }
      auth_can_manage_certificates: { Args: never; Returns: boolean }
      auth_can_manage_rosters: { Args: never; Returns: boolean }
      auth_can_manage_templates: { Args: never; Returns: boolean }
      bid_on_shift_rpc: {
        Args: { p_employee_id: string; p_priority?: number; p_shift_id: string }
        Returns: Json
      }
      bulk_publish_shifts: {
        Args: { p_actor_id?: string; p_shift_ids: string[] }
        Returns: Json
      }
      calculate_employee_metrics: {
        Args: {
          p_employee_id: string
          p_end_date: string
          p_start_date: string
        }
        Returns: {
          acceptance_rate: number
          cancellation_rate_late: number
          cancellation_rate_standard: number
          early_clock_out_rate: number
          early_clock_outs: number
          emergency_assignments: number
          late_cancellations: number
          late_clock_in_rate: number
          late_clock_ins: number
          no_show_rate: number
          no_shows: number
          offer_expiration_rate: number
          offer_expirations: number
          rejection_rate: number
          reliability_score: number
          shifts_accepted: number
          shifts_assigned: number
          shifts_offered: number
          shifts_rejected: number
          shifts_swapped: number
          shifts_worked: number
          standard_cancellations: number
          swap_ratio: number
        }[]
      }
      calculate_net_hours: {
        Args: {
          p_end_time: string
          p_start_time: string
          p_unpaid_break_minutes: number
        }
        Returns: number
      }
      calculate_shift_hours: {
        Args: {
          p_end_time: string
          p_paid_break_minutes: number
          p_start_time: string
          p_unpaid_break_minutes: number
        }
        Returns: {
          net_hours: number
          total_hours: number
        }[]
      }
      calculate_shift_length:
        | {
            Args: {
              p_end_time: string
              p_paid_break_minutes?: number
              p_start_time: string
              p_unpaid_break_minutes?: number
            }
            Returns: {
              net_length: number
              total_length: number
            }[]
          }
        | {
            Args: {
              p_end_time: string
              p_start_time: string
              p_unpaid_break_minutes?: number
            }
            Returns: number
          }
      calculate_weekly_hours: {
        Args: { p_employee_id: string; p_week_start_date: string }
        Returns: number
      }
      can_edit_roster_shift: {
        Args: { p_roster_shift_id: string }
        Returns: boolean
      }
      cancel_shift:
        | {
            Args: {
              p_cancelled_by?: string
              p_reason?: string
              p_shift_id: string
            }
            Returns: Json
          }
        | { Args: { p_reason: string; p_shift_id: string }; Returns: Json }
      cancel_shift_v2:
        | { Args: { p_reason: string; p_shift_id: string }; Returns: Json }
        | {
            Args: { p_actor_id?: string; p_reason: string; p_shift_id: string }
            Returns: Json
          }
      capture_roster_as_template:
        | {
            Args: {
              p_end_date: string
              p_start_date: string
              p_sub_department_id: string
              p_template_name: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_end_date: string
              p_start_date: string
              p_sub_department_id: string
              p_template_name: string
              p_user_id: string
            }
            Returns: Json
          }
      categorize_cancellation: {
        Args: { p_cancelled_at: string; p_shift_start: string }
        Returns: string
      }
      check_daily_hours_limit: {
        Args: {
          p_additional_hours: number
          p_date: string
          p_employee_id: string
        }
        Returns: boolean
      }
      check_in_shift: {
        Args: { p_lat: number; p_lon: number; p_shift_id: string }
        Returns: Json
      }
      check_monthly_hours_limit: {
        Args: {
          p_additional_hours: number
          p_date: string
          p_employee_id: string
        }
        Returns: boolean
      }
      check_rest_period: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_shift_date: string
          p_start_time: string
        }
        Returns: boolean
      }
      check_shift_compliance:
        | {
            Args: { p_employee_id: string; p_roster_shift_id: string }
            Returns: {
              compliance_status: string
              eligibility_snapshot: Json
              is_compliant: boolean
              violations: Json
            }[]
          }
        | {
            Args: {
              p_employee_id: string
              p_license_ids_override?: string[]
              p_role_id_override?: string
              p_roster_shift_id: string
              p_skill_ids_override?: string[]
            }
            Returns: {
              compliance_status: string
              eligibility_snapshot: Json
              is_compliant: boolean
              violations: Json
            }[]
          }
      check_shift_overlap: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_exclude_shift_id?: string
          p_shift_date: string
          p_start_time: string
        }
        Returns: boolean
      }
      check_state_invariants: {
        Args: never
        Returns: {
          check_name: string
          status: string
          violations: number
        }[]
      }
      check_state_machine_invariants_v3: {
        Args: never
        Returns: {
          check_name: string
          status: string
          violations: number
        }[]
      }
      check_template_version: {
        Args: { p_expected_version: number; p_template_id: string }
        Returns: {
          current_version: number
          last_edited_at: string
          last_edited_by: string
          version_match: boolean
        }[]
      }
      cleanup_test_shifts: { Args: never; Returns: undefined }
      clone_roster_subgroup: {
        Args: { p_new_name: string; p_subgroup_id: string }
        Returns: string
      }
      clone_roster_subgroup_v2: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_group_external_id: string
          p_new_name: string
          p_org_id: string
          p_source_name: string
          p_start_date: string
        }
        Returns: undefined
      }
      close_bidding_no_winner:
        | { Args: { p_shift_id: string }; Returns: Json }
        | {
            Args: {
              p_closed_by?: string
              p_reason?: string
              p_shift_id: string
            }
            Returns: Json
          }
      compute_employee_quarter_metrics: {
        Args: { p_employee_id: string; p_quarter_year: string }
        Returns: undefined
      }
      create_planning_period: {
        Args: {
          p_auto_publish?: boolean
          p_auto_seed?: boolean
          p_dept_id: string
          p_end_date: string
          p_org_id: string
          p_override_past?: boolean
          p_start_date: string
          p_sub_dept_ids: string[]
          p_template_id?: string
        }
        Returns: Json
      }
      create_profile_for_user: {
        Args: {
          p_employment_type?: Database["public"]["Enums"]["employment_type"]
          p_first_name?: string
          p_last_name?: string
          p_system_role?: Database["public"]["Enums"]["system_role"]
          p_user_id: string
        }
        Returns: string
      }
      create_swap_rpc: {
        Args: {
          p_reason?: string
          p_requester_id: string
          p_requester_shift_id: string
          p_swap_type?: string
        }
        Returns: Json
      }
      create_test_shift: {
        Args: { p_days_ahead: number; p_employee_id?: string; p_state: string }
        Returns: string
      }
      create_test_shift_v3: {
        Args: {
          p_employee_id?: string
          p_start_offset: string
          p_state: string
        }
        Returns: string
      }
      debug_exec_sql: { Args: { sql: string }; Returns: Json }
      debug_states: {
        Args: { p_shift_ids: string[] }
        Returns: {
          shift_id: string
          state: string
        }[]
      }
      decline_shift_offer: {
        Args: { p_employee_id?: string; p_shift_id: string }
        Returns: Json
      }
      delete_roster_subgroup: {
        Args: { p_subgroup_id: string }
        Returns: undefined
      }
      delete_roster_subgroup_v2: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_group_external_id: string
          p_name: string
          p_org_id: string
          p_start_date: string
        }
        Returns: undefined
      }
      delete_template_shifts_cascade: {
        Args: { p_template_id: string }
        Returns: number
      }
      delete_user_entirely: { Args: { user_uuid: string }; Returns: undefined }
      emergency_assign_shift: {
        Args: {
          p_assigned_by: string
          p_employee_id: string
          p_reason?: string
          p_shift_id: string
        }
        Returns: Json
      }
      employee_cancel_shift: {
        Args: { p_employee_id?: string; p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      expire_locked_swaps: {
        Args: never
        Returns: {
          expired_id: string
          recipient_id: string
          requester_id: string
        }[]
      }
      fn_calculate_performance_flag:
        | {
            Args: {
              p_late_cancel_rate: number
              p_no_show_rate: number
              p_reliability_score: number
            }
            Returns: string
          }
        | {
            Args: {
              p_assigned_count?: number
              p_late_cancel_rate: number
              p_no_show_rate: number
              p_reliability_score: number
            }
            Returns: string
          }
      fn_get_shift_lock_statuses: {
        Args: { p_shift_ids: string[] }
        Returns: {
          is_locked: boolean
          shift_id: string
        }[]
      }
      fn_is_shift_locked: { Args: { p_shift_id: string }; Returns: boolean }
      fn_process_offer_expirations: {
        Args: never
        Returns: {
          from_state: string
          res_shift_id: string
          to_state: string
        }[]
      }
      fn_shift_state: {
        Args: {
          p_assignment_outcome: string
          p_assignment_status: string
          p_bidding_status: string
          p_is_cancelled: boolean
          p_lifecycle_status: string
          p_trading_status: string
        }
        Returns: string
      }
      get_broadcast_ack_stats: {
        Args: { broadcast_uuid: string }
        Returns: {
          ack_percentage: number
          acknowledged_count: number
          pending_count: number
          total_recipients: number
        }[]
      }
      get_broadcast_analytics: { Args: never; Returns: Json }
      get_broadcast_channel_group_id: {
        Args: { p_channel_id: string }
        Returns: string
      }
      get_broadcast_group_role: {
        Args: { p_group_id: string }
        Returns: string
      }
      get_dept_insights_breakdown: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
        }
        Returns: {
          dept_id: string
          dept_name: string
          emergency_count: number
          estimated_cost: number
          fill_rate: number
          no_show_count: number
          shifts_assigned: number
          shifts_total: number
        }[]
      }
      get_eligible_employees_for_shift: {
        Args: { p_shift_id: string }
        Returns: {
          current_weekly_hours: number
          employee_email: string
          employee_id: string
          employee_name: string
          has_availability: boolean
          has_required_skills: boolean
        }[]
      }
      get_employee_event_timeline: {
        Args: { p_employee_id: string; p_limit?: number }
        Returns: {
          event_id: string
          event_time: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          shift_date: string
          shift_id: string
          shift_label: string
        }[]
      }
      get_employee_metrics:
        | {
            Args: {
              p_employee_id: string
              p_end_date?: string
              p_start_date?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_department_id?: string
              p_employee_id: string
              p_end_date?: string
              p_start_date?: string
            }
            Returns: Json
          }
      get_employee_shift_window: {
        Args: {
          p_employee_id: string
          p_end_date: string
          p_exclude_id?: string
          p_start_date: string
        }
        Returns: {
          end_time: string
          id: string
          shift_date: string
          start_time: string
          unpaid_break_minutes: number
        }[]
      }
      get_insights_summary: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
          p_subdept_ids?: string[]
        }
        Returns: Json
      }
      get_insights_trend: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
        }
        Returns: {
          dept_id: string
          dept_name: string
          estimated_cost: number
          fill_rate: number
          period_date: string
          shifts_assigned: number
          shifts_total: number
        }[]
      }
      get_metric_detailed_analysis: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_metric_id: string
          p_org_ids?: string[]
          p_start_date: string
        }
        Returns: Json
      }
      get_my_department_ids: { Args: never; Returns: string[] }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["system_role"]
      }
      get_or_create_roster_day: {
        Args: { p_date: string; p_organization_id: string; p_user_id?: string }
        Returns: string
      }
      get_performance_trends: {
        Args: {
          p_employee_id: string
          p_end_date: string
          p_interval?: string
          p_start_date: string
        }
        Returns: {
          cancel_rate: number
          period_start: string
          reliability_score: number
          worked_count: number
        }[]
      }
      get_publish_target_state: {
        Args: {
          p_has_assignment: boolean
          p_hours_until_start: number
          p_is_confirmed: boolean
        }
        Returns: {
          assignment_outcome: Database["public"]["Enums"]["shift_assignment_outcome"]
          assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          bidding_status: Database["public"]["Enums"]["shift_bidding_status"]
          fulfillment_status: Database["public"]["Enums"]["shift_fulfillment_status"]
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          state_id: string
        }[]
      }
      get_quarterly_performance_report: {
        Args: {
          p_dept_ids?: string[]
          p_org_ids?: string[]
          p_quarter: number
          p_subdept_ids?: string[]
          p_year: number
        }
        Returns: {
          acceptance_rate: number
          accepted: number
          assigned: number
          bid_success_rate: number
          bids_accepted: number
          cancel_late: number
          cancel_rate: number
          cancel_standard: number
          completed: number
          drop_rate: number
          early_clock_out: number
          early_clock_out_rate: number
          emergency_assigned: number
          employee_id: string
          employee_name: string
          expired: number
          ignorance_rate: number
          late_cancel_rate: number
          late_clock_in: number
          late_clock_in_rate: number
          no_show: number
          no_show_rate: number
          rejected: number
          rejection_rate: number
          reliability_score: number
          swap_out: number
          swap_rate: number
          total_bids: number
          total_offers: number
        }[]
      }
      get_roster_day_publish_status: {
        Args: { p_roster_day_id: string }
        Returns: {
          draft_shifts: number
          publish_percentage: number
          published_shifts: number
          roster_date: string
          roster_day_id: string
          total_shifts: number
        }[]
      }
      get_roster_day_shifts: {
        Args: { p_roster_day_id: string }
        Returns: {
          assignment_outcome: string
          assignment_status: string
          bidding_status: string
          employee_id: string
          employee_name: string
          end_time: string
          group_id: string
          group_name: string
          is_live: boolean
          lifecycle_status: string
          role_name: string
          shift_id: string
          sort_order: number
          start_time: string
          state_id: string
          subgroup_id: string
          subgroup_name: string
          trading_status: string
        }[]
      }
      get_roster_days_in_range:
        | {
            Args: {
              p_department_id: string
              p_end_date: string
              p_organization_id: string
              p_start_date: string
              p_sub_department_id: string
            }
            Returns: {
              applied_template_ids: string[]
              assigned_count: number
              has_template: boolean
              roster_date: string
              roster_id: string
              shift_count: number
              status: string
            }[]
          }
        | {
            Args: {
              p_end_date: string
              p_organization_id: string
              p_start_date: string
            }
            Returns: {
              assigned_count: number
              date: string
              has_template: boolean
              roster_day_id: string
              shift_count: number
              status: string
            }[]
          }
      get_roster_shift_state: {
        Args: {
          p_assignment_confirmed: boolean
          p_has_assignment: boolean
          p_lifecycle: string
        }
        Returns: string
      }
      get_shift_delta: {
        Args: {
          p_dept_ids?: string[]
          p_end_date?: string
          p_org_id: string
          p_since: string
          p_start_date?: string
        }
        Returns: {
          assigned_employee_id: string
          assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          deleted_at: string
          department_id: string
          end_time: string
          id: string
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          role_id: string
          shift_date: string
          start_time: string
          sub_department_id: string
          updated_at: string
          version: number
        }[]
      }
      get_shift_flags: { Args: { p_shift_id: string }; Returns: string[] }
      get_shift_fsm_state: {
        Args: {
          p_assignment_outcome: Database["public"]["Enums"]["shift_assignment_outcome"]
          p_assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          p_is_cancelled: boolean
          p_lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          p_trading_status: Database["public"]["Enums"]["shift_trading"]
        }
        Returns: string
      }
      get_shift_start_time: { Args: { p_shift_id: string }; Returns: string }
      get_shift_state_id:
        | {
            Args: {
              p_assignment: Database["public"]["Enums"]["shift_assignment_status"]
              p_bidding: Database["public"]["Enums"]["shift_bidding_status"]
              p_lifecycle: Database["public"]["Enums"]["shift_lifecycle"]
              p_outcome: Database["public"]["Enums"]["shift_assignment_outcome"]
              p_trading: Database["public"]["Enums"]["shift_trading"]
            }
            Returns: string
          }
        | { Args: { p_shift_id: string }; Returns: string }
      get_team_metrics: {
        Args: {
          p_dept_ids?: string[]
          p_end_date?: string
          p_org_ids?: string[]
          p_start_date?: string
          p_subdept_ids?: string[]
        }
        Returns: {
          acceptance_rate: number
          accepted: number
          assigned: number
          cancel_late: number
          cancel_rate: number
          cancel_standard: number
          completed: number
          early_clock_out: number
          early_clock_out_rate: number
          emergency_assigned: number
          employee_id: string
          employee_name: string
          expired: number
          ignorance_rate: number
          late_cancel_rate: number
          late_clock_in: number
          late_clock_in_rate: number
          no_show: number
          no_show_rate: number
          offers_sent: number
          performance_flag: string
          rejected: number
          rejection_rate: number
          reliability_score: number
          responsiveness_minutes: number
          stability_score: number
          swap_out: number
          swap_rate: number
        }[]
      }
      get_template_conflicts: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_template_id: string
        }
        Returns: Json
      }
      get_time_category: {
        Args: { p_scheduled_start: string }
        Returns: string
      }
      get_user_access_levels:
        | {
            Args: never
            Returns: Database["public"]["Enums"]["access_level"][]
          }
        | {
            Args: { _user_id: string }
            Returns: {
              access_level: string
            }[]
          }
      get_user_contracts: {
        Args: never
        Returns: {
          access_level: Database["public"]["Enums"]["access_level"] | null
          created_at: string | null
          created_by: string | null
          custom_hourly_rate: number | null
          department_id: string | null
          employment_status:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string
          rem_level_id: string
          role_id: string
          start_date: string | null
          status: string
          sub_department_id: string | null
          updated_at: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_contracts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_department_ids: { Args: never; Returns: string[] }
      get_user_role: { Args: never; Returns: string }
      has_permission:
        | {
            Args: {
              _required_level: Database["public"]["Enums"]["access_level"]
              _target_sub_dept_id: string
              _user_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              _required_level: string
              _target_sub_dept_id: string
              _user_id: string
            }
            Returns: boolean
          }
      has_shift_started: { Args: { p_shift_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_broadcast_system_manager: { Args: never; Returns: boolean }
      is_manager_or_above: { Args: never; Returns: boolean }
      is_valid_uuid: { Args: { str: string }; Returns: boolean }
      log_compliance_check: {
        Args: {
          p_action_type: string
          p_candidate_shift: Json
          p_employee_id: string
          p_passed: boolean
          p_results: Json
          p_shift_id: string
        }
        Returns: string
      }
      mark_broadcast_read: {
        Args: { broadcast_uuid: string; employee_uuid: string }
        Returns: undefined
      }
      mark_shift_no_show: { Args: { p_shift_id: string }; Returns: Json }
      notify_admins_pending_department_assignments: {
        Args: never
        Returns: undefined
      }
      notify_user:
        | {
            Args: {
              p_dedup_key: string
              p_entity_id: string
              p_entity_type: string
              p_link: string
              p_message: string
              p_profile_id: string
              p_title: string
              p_type: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_arg2?: string
              p_arg3?: string
              p_arg5?: string
              p_arg6?: string
              p_text1?: string
              p_text2?: string
              p_user_id: string
            }
            Returns: undefined
          }
        | { Args: { args?: string[] }; Returns: undefined }
      process_shift_time_transitions: { Args: never; Returns: undefined }
      process_shift_timers: {
        Args: never
        Returns: {
          affected: number
          operation: string
        }[]
      }
      publish_roster_day: {
        Args: {
          p_published_by_user_id?: string
          p_roster_day_id: string
          p_skip_already_published?: boolean
          p_skip_compliance?: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["publish_batch_result"]
        SetofOptions: {
          from: "*"
          to: "publish_batch_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_roster_for_range: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_org_id: string
          p_start_date: string
          p_sub_dept_id: string
          p_user_id?: string
        }
        Returns: Json
      }
      publish_roster_shift: {
        Args: {
          p_published_by_user_id: string
          p_roster_shift_id: string
          p_skip_compliance?: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["publish_shift_result"]
        SetofOptions: {
          from: "*"
          to: "publish_shift_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_shift: {
        Args: { p_actor_id?: string; p_shift_id: string }
        Returns: Json
      }
      publish_template_range:
        | {
            Args: {
              p_end_date: string
              p_force_override?: boolean
              p_start_date: string
              p_template_id: string
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_end_date: string
              p_expected_version?: number
              p_force_override?: boolean
              p_start_date: string
              p_template_id: string
              p_user_id: string
            }
            Returns: Json
          }
      push_shift_to_bidding_on_cancel: {
        Args: { p_reason: string; p_shift_id: string }
        Returns: Json
      }
      quarter_date_range: {
        Args: { p_quarter: number; p_year: number }
        Returns: Record<string, unknown>
      }
      recalculate_shift_urgency: {
        Args: { p_shift_id: string }
        Returns: boolean
      }
      refresh_all_performance_metrics: { Args: never; Returns: undefined }
      refresh_performance_materialized_view: { Args: never; Returns: undefined }
      refresh_performance_metrics: { Args: never; Returns: undefined }
      refresh_performance_snapshots: { Args: never; Returns: undefined }
      reject_shift_offer: {
        Args: { p_employee_id?: string; p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      reject_swap_request: {
        Args: { reason: string; request_id: string }
        Returns: undefined
      }
      rename_roster_subgroup: {
        Args: { p_new_name: string; p_subgroup_id: string }
        Returns: undefined
      }
      rename_roster_subgroup_v2: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_group_external_id: string
          p_new_name: string
          p_old_name: string
          p_org_id: string
          p_start_date: string
        }
        Returns: undefined
      }
      request_shift_trade: {
        Args: { p_employee_id?: string; p_shift_id: string }
        Returns: Json
      }
      request_trade: {
        Args: {
          p_actor_id?: string
          p_shift_id: string
          p_target_employee_id?: string
        }
        Returns: Json
      }
      resolve_shift_state: {
        Args: {
          p_assignment: Database["public"]["Enums"]["shift_assignment_status"]
          p_bidding: Database["public"]["Enums"]["shift_bidding_status"]
          p_lifecycle: Database["public"]["Enums"]["shift_lifecycle"]
          p_outcome: Database["public"]["Enums"]["shift_assignment_outcome"]
          p_trading: Database["public"]["Enums"]["shift_trading"]
        }
        Returns: string
      }
      resolve_user_permissions: { Args: never; Returns: Json }
      rpc_shift_coverage_stats: {
        Args: { p_date_from: string; p_date_to: string; p_org_id: string }
        Returns: {
          assigned_shifts: number
          estimated_cost: number
          group_type: string
          published_shifts: number
          remuneration_level_id: string
          role_id: string
          shift_date: string
          sub_group_name: string
          total_net_minutes: number
          total_shifts: number
        }[]
      }
      safe_uuid: { Args: { str: string }; Returns: string }
      save_template_full: {
        Args: {
          p_description: string
          p_expected_version: number
          p_groups: Json
          p_name: string
          p_template_id: string
          p_user_id: string
        }
        Returns: {
          error_message: string
          new_version: number
          success: boolean
        }[]
      }
      select_bid_winner: {
        Args: {
          p_selected_by?: string
          p_shift_id: string
          p_winner_employee_id: string
        }
        Returns: Json
      }
      select_bidding_winner: {
        Args: { p_admin_id?: string; p_employee_id: string; p_shift_id: string }
        Returns: Json
      }
      set_batch_id: { Args: { batch_id: string }; Returns: undefined }
      set_emergency_source: {
        Args: {
          p_action: string
          p_current: string
          p_time_to_start_sec: number
        }
        Returns: string
      }
      set_roster_day_status: {
        Args: {
          p_roster_day_id: string
          p_status: Database["public"]["Enums"]["roster_day_status"]
          p_user_id: string
        }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      sm_accept_offer: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_accept_trade:
        | {
            Args: { p_accepting_employee_id: string; p_shift_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_compliance_snapshot?: Json
              p_offer_id: string
              p_offer_shift_id?: string
              p_offerer_id: string
              p_swap_id: string
            }
            Returns: Json
          }
      sm_approve_peer_swap: {
        Args: {
          p_offered_shift_id: string
          p_offerer_id: string
          p_requester_id: string
          p_requester_shift_id: string
        }
        Returns: undefined
      }
      sm_approve_trade: {
        Args: {
          p_new_employee_id: string
          p_shift_id: string
          p_user_id?: string
        }
        Returns: Json
      }
      sm_bulk_assign: {
        Args: {
          p_employee_id: string
          p_shift_ids: string[]
          p_user_id?: string
        }
        Returns: Json
      }
      sm_bulk_close_bidding: {
        Args: { p_actor_id?: string; p_reason: string; p_shift_ids: string[] }
        Returns: Json
      }
      sm_bulk_delete_shifts: {
        Args: {
          p_deleted_by?: string
          p_reason?: string
          p_shift_ids: string[]
        }
        Returns: Json
      }
      sm_bulk_emergency_assign: {
        Args: { p_actor_id?: string; p_assignments: Json }
        Returns: Json
      }
      sm_bulk_manager_cancel: {
        Args: { p_actor_id?: string; p_reason: string; p_shift_ids: string[] }
        Returns: Json
      }
      sm_bulk_publish_shifts: {
        Args: { p_actor_id?: string; p_shift_ids: string[] }
        Returns: Json
      }
      sm_cancel_shift: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_cancel_trade_request: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_clear_template_application: {
        Args: { p_roster_id: string; p_template_id: string; p_user_id: string }
        Returns: Json
      }
      sm_clock_in: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_clock_out_shift: {
        Args: {
          p_lat?: number
          p_lon?: number
          p_shift_id: string
          p_user_id: string
        }
        Returns: Json
      }
      sm_close_bidding: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_complete_shift: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_create_shift: {
        Args: { p_shift_data: Json; p_user_id: string }
        Returns: string
      }
      sm_decline_offer: {
        Args: { p_shift_id: string; p_user_id: string }
        Returns: Json
      }
      sm_delete_shift: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_emergency_assign:
        | {
            Args: {
              p_employee_id: string
              p_reason?: string
              p_shift_id: string
              p_user_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_employee_id: string
              p_reason?: string
              p_shift_id: string
              p_user_id?: string
            }
            Returns: Json
          }
      sm_employee_cancel:
        | { Args: { p_employee_id: string; p_shift_id: string }; Returns: Json }
        | {
            Args: {
              p_employee_id: string
              p_reason?: string
              p_shift_id: string
            }
            Returns: Json
          }
      sm_employee_drop_shift: {
        Args: { p_employee_id?: string; p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      sm_expire_offer_now: { Args: { p_shift_id: string }; Returns: Json }
      sm_expire_trade: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_handle_auto_clock_out: {
        Args: never
        Returns: {
          affected_shift_id: string
          previous_status: string
        }[]
      }
      sm_manager_cancel: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_mark_no_show: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_move_shift: {
        Args: {
          p_group_type?: string
          p_roster_subgroup_id?: string
          p_shift_date?: string
          p_shift_group_id?: string
          p_shift_id: string
          p_sub_group_name?: string
          p_user_id?: string
        }
        Returns: Json
      }
      sm_process_time_transitions: { Args: never; Returns: Json }
      sm_publish_shift: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_reject_offer:
        | { Args: { p_shift_id: string; p_user_id: string }; Returns: Json }
        | {
            Args: { p_reason: string; p_shift_id: string; p_user_id: string }
            Returns: Json
          }
      sm_reject_trade: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_request_trade:
        | {
            Args: { p_shift_id: string; p_target_employee_id?: string }
            Returns: Json
          }
        | {
            Args: {
              p_shift_id: string
              p_target_employee_id?: string
              p_user_id: string
            }
            Returns: Json
          }
      sm_select_bid_winner: {
        Args: { p_shift_id: string; p_user_id?: string; p_winner_id: string }
        Returns: Json
      }
      sm_unassign_shift: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_unpublish_shift: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_update_shift:
        | {
            Args: { p_shift_data: Json; p_shift_id: string; p_user_id: string }
            Returns: boolean
          }
        | {
            Args: {
              p_expected_version?: number
              p_shift_data: Json
              p_shift_id: string
              p_user_id: string
            }
            Returns: boolean
          }
      state_machine_regression_snapshot_v3: {
        Args: never
        Returns: {
          key: string
          section: string
          value: string
        }[]
      }
      test_all_transitions: {
        Args: never
        Returns: {
          actual_success: boolean
          details: string
          expected_success: boolean
          from_state: string
          passed: boolean
          test_name: string
          to_state: string
        }[]
      }
      test_concurrency_races_v3: {
        Args: never
        Returns: {
          actor: string
          details: string
          resulting_state: string
          success: boolean
          test_name: string
        }[]
      }
      test_create_shifts: {
        Args: { p_count: number; p_hours_from_now?: string; p_state: string }
        Returns: string[]
      }
      test_identity_and_permissions_v3: {
        Args: never
        Returns: {
          actual_success: boolean
          details: string
          expected_success: boolean
          passed: boolean
          test_name: string
        }[]
      }
      test_reentrancy_and_idempotency_v3: {
        Args: never
        Returns: {
          actual_success: boolean
          details: string
          expected_success: boolean
          passed: boolean
          test_name: string
        }[]
      }
      test_time_boundaries_v3: {
        Args: never
        Returns: {
          actual_success: boolean
          details: string
          expected_success: boolean
          passed: boolean
          test_name: string
        }[]
      }
      test_transition_matrix_v3: {
        Args: never
        Returns: {
          action: string
          details: string
          from_state: string
          success: boolean
          to_state: string
        }[]
      }
      toggle_roster_lock_for_range: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_lock_status: boolean
          p_org_id: string
          p_start_date: string
          p_sub_dept_id: string
        }
        Returns: {
          updated_count: number
        }[]
      }
      undo_template_batch:
        | { Args: { p_batch_id: string }; Returns: Json }
        | { Args: { p_batch_id: string; p_user_id?: string }; Returns: Json }
      unpublish_roster_day: {
        Args: {
          p_reason?: string
          p_roster_day_id: string
          p_unpublished_by_user_id?: string
        }
        Returns: Database["public"]["CompositeTypes"]["publish_batch_result"]
        SetofOptions: {
          from: "*"
          to: "publish_batch_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unpublish_roster_shift: {
        Args: {
          p_reason: string
          p_roster_shift_id: string
          p_unpublished_by_user_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["publish_shift_result"]
        SetofOptions: {
          from: "*"
          to: "publish_shift_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unpublish_shift: { Args: { p_shift_id: string }; Returns: Json }
      update_shift_lifecycle_status: { Args: never; Returns: undefined }
      user_has_action: { Args: { p_action_code: string }; Returns: boolean }
      user_has_action_in_scope: {
        Args: {
          p_action_code: string
          p_dept_id?: string
          p_org_id: string
          p_sub_dept_id?: string
        }
        Returns: boolean
      }
      user_has_any_contract: { Args: { _user_id: string }; Returns: boolean }
      user_has_delta_access: { Args: { _user_id: string }; Returns: boolean }
      user_has_gamma_access_for_subdept: {
        Args: { check_subdept_id: string; check_user_id: string }
        Returns: boolean
      }
      validate_rest_period: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_minimum_hours?: number
          p_shift_date: string
          p_start_time: string
        }
        Returns: boolean
      }
      validate_roster_shift_for_publish: {
        Args: { p_roster_shift_id: string }
        Returns: Database["public"]["CompositeTypes"]["shift_validation_result"]
        SetofOptions: {
          from: "*"
          to: "shift_validation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_shift_swap: {
        Args: {
          p_employee_id: string
          p_shift_id: string
          p_swap_request_id: string
        }
        Returns: Json
      }
      validate_shift_transition: {
        Args: {
          p_allowed_states: string[]
          p_event_code: string
          p_shift_id: string
        }
        Returns: Json
      }
      validate_template_name: {
        Args: {
          p_department_id: string
          p_exclude_id?: string
          p_name: string
          p_organization_id: string
          p_sub_department_id: string
        }
        Returns: Json
      }
      withdraw_bid_rpc: {
        Args: { p_bid_id: string; p_employee_id: string }
        Returns: Json
      }
      withdraw_shift_from_bidding: {
        Args: { p_actor_id?: string; p_shift_id: string }
        Returns: Json
      }
    }
    Enums: {
      access_level: "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "zeta"
      actor_type: "USER" | "SYSTEM"
      assignment_method: "manual" | "template" | "bid" | "trade" | "auto"
      assignment_status:
        | "assigned"
        | "confirmed"
        | "swapped"
        | "dropped"
        | "no_show"
      availability_type: "available" | "unavailable" | "preferred" | "limited"
      bid_status: "pending" | "accepted" | "rejected" | "withdrawn"
      bidding_priority: "normal" | "urgent" | "critical"
      broadcast_priority: "low" | "normal" | "high" | "urgent"
      broadcast_status: "draft" | "scheduled" | "sent" | "cancelled"
      bulk_operation_status: "running" | "completed" | "failed"
      cancellation_type: "standard" | "late" | "critical" | "no_show"
      compliance_status:
        | "compliant"
        | "warning"
        | "violation"
        | "pending"
        | "overridden"
      employment_status:
        | "Full-Time"
        | "Part-Time"
        | "Casual"
        | "Flexible Part-Time"
      employment_type: "full_time" | "part_time" | "casual" | "contractual"
      event_source: "UI" | "API" | "AUTO_JOB" | "SYSTEM_RULE"
      feedback_verdict: "UNDER" | "OVER" | "OK"
      lifecycle_status_enum:
        | "draft"
        | "scheduled"
        | "active"
        | "completed"
        | "cancelled"
      lock_reason: "published" | "timesheet" | "admin" | "payroll"
      notification_type:
        | "shift_assigned"
        | "shift_cancelled"
        | "shift_updated"
        | "swap_request"
        | "swap_approved"
        | "swap_rejected"
        | "bid_accepted"
        | "bid_rejected"
        | "broadcast"
        | "timesheet_approved"
        | "timesheet_rejected"
        | "general"
      rbac_scope: "SELF" | "SUB_DEPT" | "DEPT" | "ORG"
      roster_day_status: "draft" | "published" | "locked"
      roster_status: "draft" | "published" | "archived"
      shift_assignment_outcome:
        | "pending"
        | "offered"
        | "confirmed"
        | "emergency_assigned"
        | "no_show"
      shift_assignment_status: "assigned" | "unassigned"
      shift_attendance_status:
        | "unknown"
        | "checked_in"
        | "no_show"
        | "late"
        | "excused"
        | "auto_clock_out"
      shift_bidding_status:
        | "not_on_bidding"
        | "on_bidding_normal"
        | "on_bidding_urgent"
        | "bidding_closed_no_winner"
        | "on_bidding"
      shift_event_type:
        | "OFFERED"
        | "ACCEPTED"
        | "REJECTED"
        | "IGNORED"
        | "ASSIGNED"
        | "UNASSIGNED"
        | "EMERGENCY_ASSIGNED"
        | "CANCELLED"
        | "LATE_CANCELLED"
        | "SWAPPED_OUT"
        | "SWAPPED_IN"
        | "CHECKED_IN"
        | "LATE_IN"
        | "EARLY_OUT"
        | "NO_SHOW"
      shift_fulfillment_status: "scheduled" | "bidding" | "offered" | "none"
      shift_lifecycle:
        | "Draft"
        | "Published"
        | "InProgress"
        | "Completed"
        | "Cancelled"
      shift_lifecycle_status:
        | "draft"
        | "published"
        | "in_progress"
        | "completed"
        | "cancelled"
      shift_status:
        | "open"
        | "assigned"
        | "confirmed"
        | "completed"
        | "cancelled"
      shift_trading:
        | "NoTrade"
        | "TradeRequested"
        | "TradeAccepted"
        | "TradeApproved"
      swap_offer_status:
        | "SUBMITTED"
        | "SELECTED"
        | "REJECTED"
        | "WITHDRAWN"
        | "EXPIRED"
      swap_request_status:
        | "OPEN"
        | "OFFER_SELECTED"
        | "MANAGER_PENDING"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
        | "EXPIRED"
      swap_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "completed"
        | "pending_employee"
        | "pending_manager"
      system_role: "admin" | "manager" | "team_lead" | "team_member"
      template_group_type: "convention_centre" | "exhibition_centre" | "theatre"
      template_status: "draft" | "published" | "archived"
      timesheet_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "no_show"
    }
    CompositeTypes: {
      publish_batch_result: {
        success: boolean | null
        total_processed: number | null
        shifts_created: number | null
        shifts_updated: number | null
        shifts_skipped: number | null
        errors: Json | null
      }
      publish_shift_result: {
        success: boolean | null
        shift_id: string | null
        roster_shift_id: string | null
        action: string | null
        from_state: string | null
        to_state: string | null
        error_code: string | null
        error_message: string | null
      }
      shift_validation_result: {
        is_valid: boolean | null
        error_code: string | null
        error_message: string | null
        warnings: Json | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_level: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"],
      actor_type: ["USER", "SYSTEM"],
      assignment_method: ["manual", "template", "bid", "trade", "auto"],
      assignment_status: [
        "assigned",
        "confirmed",
        "swapped",
        "dropped",
        "no_show",
      ],
      availability_type: ["available", "unavailable", "preferred", "limited"],
      bid_status: ["pending", "accepted", "rejected", "withdrawn"],
      bidding_priority: ["normal", "urgent", "critical"],
      broadcast_priority: ["low", "normal", "high", "urgent"],
      broadcast_status: ["draft", "scheduled", "sent", "cancelled"],
      bulk_operation_status: ["running", "completed", "failed"],
      cancellation_type: ["standard", "late", "critical", "no_show"],
      compliance_status: [
        "compliant",
        "warning",
        "violation",
        "pending",
        "overridden",
      ],
      employment_status: [
        "Full-Time",
        "Part-Time",
        "Casual",
        "Flexible Part-Time",
      ],
      employment_type: ["full_time", "part_time", "casual", "contractual"],
      event_source: ["UI", "API", "AUTO_JOB", "SYSTEM_RULE"],
      feedback_verdict: ["UNDER", "OVER", "OK"],
      lifecycle_status_enum: [
        "draft",
        "scheduled",
        "active",
        "completed",
        "cancelled",
      ],
      lock_reason: ["published", "timesheet", "admin", "payroll"],
      notification_type: [
        "shift_assigned",
        "shift_cancelled",
        "shift_updated",
        "swap_request",
        "swap_approved",
        "swap_rejected",
        "bid_accepted",
        "bid_rejected",
        "broadcast",
        "timesheet_approved",
        "timesheet_rejected",
        "general",
      ],
      rbac_scope: ["SELF", "SUB_DEPT", "DEPT", "ORG"],
      roster_day_status: ["draft", "published", "locked"],
      roster_status: ["draft", "published", "archived"],
      shift_assignment_outcome: [
        "pending",
        "offered",
        "confirmed",
        "emergency_assigned",
        "no_show",
      ],
      shift_assignment_status: ["assigned", "unassigned"],
      shift_attendance_status: [
        "unknown",
        "checked_in",
        "no_show",
        "late",
        "excused",
        "auto_clock_out",
      ],
      shift_bidding_status: [
        "not_on_bidding",
        "on_bidding_normal",
        "on_bidding_urgent",
        "bidding_closed_no_winner",
        "on_bidding",
      ],
      shift_event_type: [
        "OFFERED",
        "ACCEPTED",
        "REJECTED",
        "IGNORED",
        "ASSIGNED",
        "UNASSIGNED",
        "EMERGENCY_ASSIGNED",
        "CANCELLED",
        "LATE_CANCELLED",
        "SWAPPED_OUT",
        "SWAPPED_IN",
        "CHECKED_IN",
        "LATE_IN",
        "EARLY_OUT",
        "NO_SHOW",
      ],
      shift_fulfillment_status: ["scheduled", "bidding", "offered", "none"],
      shift_lifecycle: [
        "Draft",
        "Published",
        "InProgress",
        "Completed",
        "Cancelled",
      ],
      shift_lifecycle_status: [
        "draft",
        "published",
        "in_progress",
        "completed",
        "cancelled",
      ],
      shift_status: ["open", "assigned", "confirmed", "completed", "cancelled"],
      shift_trading: [
        "NoTrade",
        "TradeRequested",
        "TradeAccepted",
        "TradeApproved",
      ],
      swap_offer_status: [
        "SUBMITTED",
        "SELECTED",
        "REJECTED",
        "WITHDRAWN",
        "EXPIRED",
      ],
      swap_request_status: [
        "OPEN",
        "OFFER_SELECTED",
        "MANAGER_PENDING",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
        "EXPIRED",
      ],
      swap_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "completed",
        "pending_employee",
        "pending_manager",
      ],
      system_role: ["admin", "manager", "team_lead", "team_member"],
      template_group_type: [
        "convention_centre",
        "exhibition_centre",
        "theatre",
      ],
      template_status: ["draft", "published", "archived"],
      timesheet_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "no_show",
      ],
    },
  },
} as const
