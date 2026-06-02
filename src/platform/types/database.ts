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
      app_access_certificates: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          certificate_type: string
          created_at: string | null
          created_by: string | null
          department_id: string | null
          id: string
          is_active: boolean
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
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
      bid_eligibility_checks: {
        Row: {
          availability_check: boolean | null
          bid_id: string
          checked_at: string | null
          eligibility_errors: Json | null
          employee_id: string
          hours_limit_check: boolean | null
          id: string
          is_eligible: boolean | null
          rest_period_check: boolean | null
          shift_id: string
          skills_check: boolean | null
        }
        Insert: {
          availability_check?: boolean | null
          bid_id: string
          checked_at?: string | null
          eligibility_errors?: Json | null
          employee_id: string
          hours_limit_check?: boolean | null
          id?: string
          is_eligible?: boolean | null
          rest_period_check?: boolean | null
          shift_id: string
          skills_check?: boolean | null
        }
        Update: {
          availability_check?: boolean | null
          bid_id?: string
          checked_at?: string | null
          eligibility_errors?: Json | null
          employee_id?: string
          hours_limit_check?: boolean | null
          id?: string
          is_eligible?: boolean | null
          rest_period_check?: boolean | null
          shift_id?: string
          skills_check?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_eligibility_checks_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "shift_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_eligibility_checks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_eligibility_checks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
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
        Relationships: []
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
            foreignKeyName: "broadcasts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "broadcast_channels"
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
      compliance_checks: {
        Row: {
          action_type: string
          candidate_shift: Json
          employee_id: string
          id: string
          passed: boolean
          performed_at: string | null
          performed_by: string | null
          results: Json
          shift_id: string | null
        }
        Insert: {
          action_type: string
          candidate_shift: Json
          employee_id: string
          id?: string
          passed: boolean
          performed_at?: string | null
          performed_by?: string | null
          results: Json
          shift_id?: string | null
        }
        Update: {
          action_type?: string
          candidate_shift?: Json
          employee_id?: string
          id?: string
          passed?: boolean
          performed_at?: string | null
          performed_by?: string | null
          results?: Json
          shift_id?: string | null
        }
        Relationships: []
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
          calculated_at: string | null
          cancellation_rate_late: number | null
          cancellation_rate_standard: number | null
          created_at: string | null
          employee_id: string
          id: string
          is_locked: boolean | null
          late_cancellations: number | null
          metric_version: number | null
          no_show_rate: number | null
          no_shows: number | null
          period_end: string
          period_start: string
          punctuality_rate: number | null
          quarter_year: string
          rejection_rate: number | null
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
          calculated_at?: string | null
          cancellation_rate_late?: number | null
          cancellation_rate_standard?: number | null
          created_at?: string | null
          employee_id: string
          id?: string
          is_locked?: boolean | null
          late_cancellations?: number | null
          metric_version?: number | null
          no_show_rate?: number | null
          no_shows?: number | null
          period_end: string
          period_start: string
          punctuality_rate?: number | null
          quarter_year: string
          rejection_rate?: number | null
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
          calculated_at?: string | null
          cancellation_rate_late?: number | null
          cancellation_rate_standard?: number | null
          created_at?: string | null
          employee_id?: string
          id?: string
          is_locked?: boolean | null
          late_cancellations?: number | null
          metric_version?: number | null
          no_show_rate?: number | null
          no_shows?: number | null
          period_end?: string
          period_start?: string
          punctuality_rate?: number | null
          quarter_year?: string
          rejection_rate?: number | null
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
      login_audit: {
        Row: {
          id: string
          ip_address: string | null
          login_at: string | null
          logout_at: string | null
          session_duration: unknown
          user_agent: string | null
          user_id: string
        }
        Insert: {
          id?: string
          ip_address?: string | null
          login_at?: string | null
          logout_at?: string | null
          session_duration?: unknown
          user_agent?: string | null
          user_id: string
        }
        Update: {
          id?: string
          ip_address?: string | null
          login_at?: string | null
          logout_at?: string | null
          session_duration?: unknown
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
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
          code: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          phone?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          updated_at?: string | null
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
            foreignKeyName: "rest_period_violations_second_shift_id_fkey"
            columns: ["second_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
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
      roles: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          level: number
          name: string
          remuneration_level_id: string | null
          responsibilities: string[] | null
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          level: number
          name: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          level?: number
          name?: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
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
      roster_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          notes: string | null
          old_data: Json | null
          roster_day_id: string | null
          roster_shift_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          notes?: string | null
          old_data?: Json | null
          roster_day_id?: string | null
          roster_shift_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          notes?: string | null
          old_data?: Json | null
          roster_day_id?: string | null
          roster_shift_id?: string | null
        }
        Relationships: []
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
          name: string
          roster_group_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          roster_group_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
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
      roster_templates: {
        Row: {
          created_at: string
          created_by: string | null
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
          created_at?: string
          created_by?: string | null
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
          created_at?: string
          created_by?: string | null
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
          date: string
          department_id: string | null
          description: string | null
          end_date: string
          groups: Json
          id: string
          is_locked: boolean
          name: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id: string | null
          template_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          department_id?: string | null
          description?: string | null
          end_date: string
          groups?: Json
          id?: string
          is_locked?: boolean
          name: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          department_id?: string | null
          description?: string | null
          end_date?: string
          groups?: Json
          id?: string
          is_locked?: boolean
          name?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
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
            foreignKeyName: "rosters_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_audit_events: {
        Row: {
          batch_id: string | null
          created_at: string
          event_category: string
          event_type: string
          field_changed: string | null
          id: string
          metadata: Json | null
          new_data: Json | null
          new_value: string | null
          old_data: Json | null
          old_value: string | null
          performed_by_id: string | null
          performed_by_name: string
          performed_by_role: string
          shift_id: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          event_category: string
          event_type: string
          field_changed?: string | null
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_by_id?: string | null
          performed_by_name: string
          performed_by_role: string
          shift_id: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          event_category?: string
          event_type?: string
          field_changed?: string | null
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_by_id?: string | null
          performed_by_name?: string
          performed_by_role?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_audit_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
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
        ]
      }
      shift_lifecycle_log: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          created_at: string | null
          id: string
          new_status: string
          old_status: string | null
          reason: string | null
          shift_id: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_status: string
          old_status?: string | null
          reason?: string | null
          shift_id: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_status?: string
          old_status?: string | null
          reason?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_lifecycle_log_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
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
          id: string
          manager_approved: boolean | null
          reason: string | null
          rejection_reason: string | null
          requester_id: string
          requester_shift_id: string
          status: Database["public"]["Enums"]["swap_request_status"] | null
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
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id: string
          requester_shift_id: string
          status?: Database["public"]["Enums"]["swap_request_status"] | null
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
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id?: string
          requester_shift_id?: string
          status?: Database["public"]["Enums"]["swap_request_status"] | null
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
          assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
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
          currency: string | null
          deleted_at: string | null
          deleted_by: string | null
          department_id: string
          display_order: number | null
          eligibility_snapshot: Json | null
          end_time: string
          event_ids: Json | null
          event_tags: Json | null
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
          is_urgent: boolean | null
          last_modified_by: string | null
          last_modified_reason: string | null
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
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
          roster_id: string
          roster_shift_id: string | null
          roster_subgroup_id: string
          roster_template_id: string | null
          scheduled_end: string | null
          scheduled_length_minutes: number | null
          scheduled_start: string | null
          shift_date: string
          shift_group_id: string | null
          shift_subgroup_id: string | null
          start_time: string
          sub_department_id: string | null
          sub_group_name: string | null
          tags: Json | null
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
          assignment_status?: Database["public"]["Enums"]["shift_assignment_status"]
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
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          department_id: string
          display_order?: number | null
          eligibility_snapshot?: Json | null
          end_time: string
          event_ids?: Json | null
          event_tags?: Json | null
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
          is_urgent?: boolean | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
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
          roster_id: string
          roster_shift_id?: string | null
          roster_subgroup_id: string
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date: string
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_time: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          tags?: Json | null
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
          assignment_status?: Database["public"]["Enums"]["shift_assignment_status"]
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
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string
          display_order?: number | null
          eligibility_snapshot?: Json | null
          end_time?: string
          event_ids?: Json | null
          event_tags?: Json | null
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
          is_urgent?: boolean | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
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
          roster_id?: string
          roster_shift_id?: string | null
          roster_subgroup_id?: string
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date?: string
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_time?: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          tags?: Json | null
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
      template_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_by: string | null
          created_at: string | null
          details: Json | null
          id: string
          new_data: Json | null
          new_version: number | null
          old_data: Json | null
          old_version: number | null
          template_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_by?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          new_data?: Json | null
          new_version?: number | null
          old_data?: Json | null
          old_version?: number | null
          template_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          changed_by?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          new_data?: Json | null
          new_version?: number | null
          old_data?: Json | null
          old_version?: number | null
          template_id?: string | null
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
          end_time: string
          id: string
          net_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          profile_id: string
          rejected_reason: string | null
          shift_id: string | null
          start_time: string
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
          end_time: string
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time: string
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
          end_time?: string
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id?: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time?: string
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
        ]
      }
      user_department_audit: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: []
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
      v_template_full: {
        Row: {
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
      apply_monthly_template: {
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
          p_user_id?: string
        }
        Returns: Json
      }
      apply_template_to_date_range_v2: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_template_id: string
          p_user_id: string
        }
        Returns: Json
      }
      approve_swap_request: { Args: { request_id: string }; Returns: undefined }
      archive_old_audit_events: { Args: never; Returns: undefined }
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
          late_cancellations: number
          no_show_rate: number
          no_shows: number
          punctuality_rate: number
          rejection_rate: number
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
        Args: { p_lat?: number; p_lon?: number; p_shift_id: string }
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
      check_shift_compliance: {
        Args: { p_employee_id: string; p_roster_shift_id: string }
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
        Args: { p_days_ahead?: number; p_employee_id?: string; p_state: string }
        Returns: string
      }
      create_test_shift_v3: {
        Args: {
          p_employee_id?: string
          p_start_offset: unknown
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
      delete_shift_cascade: {
        Args: { p_deleted_by?: string; p_shift_id: string }
        Returns: boolean
      }
      delete_shift_with_audit: {
        Args: { p_deleted_by?: string; p_reason?: string; p_shift_id: string }
        Returns: boolean
      }
      delete_template_shifts_cascade: {
        Args: { p_template_id: string }
        Returns: number
      }
      emergency_assign_shift: {
        Args: {
          p_assigned_by?: string
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
      ensure_shift_events_partitions: { Args: never; Returns: undefined }
      fn_get_shift_lock_statuses: {
        Args: { p_shift_ids: string[] }
        Returns: {
          is_locked: boolean
          shift_id: string
        }[]
      }
      fn_is_shift_locked: { Args: { p_shift_id: string }; Returns: boolean }
      get_broadcast_ack_stats: {
        Args: { broadcast_uuid: string }
        Returns: {
          ack_percentage: number
          acknowledged_count: number
          pending_count: number
          total_recipients: number
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
      get_my_department_ids: { Args: never; Returns: string[] }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["system_role"]
      }
      get_or_create_roster_day: {
        Args: { p_date: string; p_organization_id: string; p_user_id?: string }
        Returns: string
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
      get_roster_days_in_range: {
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
      get_shift_flags: { Args: { p_shift_id: string }; Returns: string[] }
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
      log_shift_event: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_new_status: string
          p_prev_status: string
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
      process_shift_time_transitions: { Args: never; Returns: undefined }
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
          p_published_by_user_id?: string
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
      publish_template_range: {
        Args: {
          p_end_date: string
          p_force_override?: boolean
          p_start_date: string
          p_template_id: string
          p_user_id: string
        }
        Returns: Json
      }
      push_shift_to_bidding_on_cancel: {
        Args: { p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      recalculate_shift_urgency: {
        Args: { p_shift_id: string }
        Returns: boolean
      }
      reject_shift_offer: {
        Args: { p_employee_id?: string; p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      reject_swap_request: {
        Args: { reason: string; request_id: string }
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
      resolve_user_permissions: { Args: never; Returns: Json }
      restore_deleted_shift: { Args: { p_shift_id: string }; Returns: boolean }
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
      sm_accept_trade: {
        Args: { p_accepting_employee_id: string; p_shift_id: string }
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
      sm_close_bidding: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_create_shift: {
        Args: { p_shift_data: Json; p_user_id: string }
        Returns: Json
      }
      sm_decline_offer: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_delete_shift: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_emergency_assign: {
        Args: {
          p_employee_id: string
          p_reason?: string
          p_shift_id: string
          p_user_id?: string
        }
        Returns: Json
      }
      sm_employee_cancel: {
        Args: { p_employee_id: string; p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      sm_employee_drop_shift: {
        Args: { p_employee_id: string; p_reason: string; p_shift_id: string }
        Returns: Json
      }
      sm_manager_cancel: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_process_time_transitions: { Args: never; Returns: Json }
      sm_publish_shift: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_reject_offer: {
        Args: { p_employee_id: string; p_reason?: string; p_shift_id: string }
        Returns: Json
      }
      sm_request_trade: {
        Args: { p_shift_id: string; p_target_employee_id?: string }
        Returns: Json
      }
      sm_select_bid_winner: {
        Args: { p_shift_id: string; p_user_id?: string; p_winner_id: string }
        Returns: Json
      }
      sm_unpublish_shift: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_update_shift: {
        Args: { p_shift_data: Json; p_shift_id: string; p_user_id: string }
        Returns: Json
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
        Args: { p_count: number; p_hours_from_now?: unknown; p_state: string }
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
          p_reason?: string
          p_roster_shift_id: string
          p_unpublished_by_user_id?: string
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
      audit_action: "create" | "update" | "delete" | "publish" | "unpublish"
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
      shift_assignment_status: "assigned" | "unassigned"
      shift_attendance_status:
        | "unknown"
        | "checked_in"
        | "no_show"
        | "late"
        | "excused"
      shift_bidding_status:
        | "not_on_bidding"
        | "on_bidding_normal"
        | "on_bidding_urgent"
        | "bidding_closed_no_winner"
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
      timesheet_status: "draft" | "submitted" | "approved" | "rejected"
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
      ],
      shift_assignment_status: ["assigned", "unassigned"],
      shift_attendance_status: [
        "unknown",
        "checked_in",
        "no_show",
        "late",
        "excused",
      ],
      shift_bidding_status: [
        "not_on_bidding",
        "on_bidding_normal",
        "on_bidding_urgent",
        "bidding_closed_no_winner",
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
      timesheet_status: ["draft", "submitted", "approved", "rejected"],
    },
  },
} as const
