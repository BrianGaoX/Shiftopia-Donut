/**
 * Availability API Layer – Phase-3 (Slots Are Authoritative)
 *
 * RESPONSIBILITIES:
 * - Raw Supabase queries only
 * - CRUD on availability_rules
 * - READ-ONLY access to availability_slots
 *
 * MUST NOT:
 * - Expand rules into slots
 * - Perform recurrence logic
 * - Manage state
 * - Trigger Edge Functions
 * - Contain UI or layout logic
 */

import { supabase } from "@/platform/supabase/client";
import {
  AvailabilityRule,
  AvailabilitySlot,
} from "../model/availability.types";

// ============================================================================
// CREATE (RULES)
// ============================================================================

export async function createAvailabilityRule(
  rule: Omit<AvailabilityRule, "id" | "created_at" | "updated_at">
): Promise<AvailabilityRule> {
  const { data, error } = await supabase
    .from("availability_rules")
    .insert(rule)
    .select()
    .single();

  if (error) throw error;
  return data as AvailabilityRule;
}

// ============================================================================
// READ (RULES – EDITING ONLY)
// ============================================================================

/**
 * Fetch availability rules for a profile.
 * Used ONLY for listing and editing rules.
 */
export async function getAvailabilityRules(
  profileId: string
): Promise<AvailabilityRule[]> {
  const { data, error } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as AvailabilityRule[]) ?? [];
}

/**
 * Fetch a single availability rule by ID.
 */
export async function getAvailabilityRule(
  ruleId: string
): Promise<AvailabilityRule | null> {
  const { data, error } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("id", ruleId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data as AvailabilityRule;
}

// ============================================================================
// READ (SLOTS – CALENDAR & SCHEDULER)
// ============================================================================

/**
 * Fetch availability slots for calendar rendering.
 *
 * IMPORTANT:
 * - Slots are authoritative
 * - No rule expansion here
 * - No recurrence logic
 */
export async function getAvailabilitySlots(
  profileId: string,
  startDate: string, // yyyy-MM-dd
  endDate: string // yyyy-MM-dd
): Promise<AvailabilitySlot[]> {
  const { data, error } = await supabase
    .from("availability_slots")
    .select("*")
    .eq("profile_id", profileId)
    .gte("slot_date", startDate)
    .lte("slot_date", endDate)
    .order("slot_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return (data as AvailabilitySlot[]) ?? [];
}

// ============================================================================
// UPDATE (DISALLOWED)
// ============================================================================

/**
 * @deprecated
 * Direct updates are forbidden.
 * Editing MUST use delete + create.
 */
export async function updateAvailabilityRule(): Promise<never> {
  throw new Error(
    "Direct updates are not allowed. Use delete + create pattern."
  );
}

// ============================================================================
// DELETE (RULES)
// ============================================================================

/**
 * Delete a single availability rule.
 * Slots are removed automatically via ON DELETE CASCADE.
 */
export async function deleteAvailabilityRule(ruleId: string): Promise<void> {
  const { error } = await supabase
    .from("availability_rules")
    .delete()
    .eq("id", ruleId);

  if (error) throw error;
}

/**
 * Delete all rules for a profile overlapping a date range.
 * Used for bulk replace flows.
 */
export async function deleteAvailabilityRulesInRange(
  profileId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { error, count } = await supabase
    .from("availability_rules")
    .delete({ count: "exact" })
    .eq("profile_id", profileId)
    .lte("start_date", endDate)
    .gte("end_date", startDate);

  if (error) throw error;
  return count ?? 0;
}

// ============================================================================
// AUTH HELPERS
// ============================================================================

/**
 * Resolve the current user's profile ID.
 */
export async function getCurrentProfileId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}
