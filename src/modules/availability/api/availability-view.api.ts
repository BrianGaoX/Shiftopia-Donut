/**
 * Availability View API
 *
 * Provides the combined view endpoint described in the spec:
 *   GET /user/{id}/availability-view
 *
 * Returns:
 *   - declaredSlots  (AvailabilitySlot[]) — from availability_slots table
 *   - assignedShifts (AssignedShiftInterval[]) — from shifts table (locked intervals)
 *
 * The FRONTEND computes the final cell state:
 *   LOCKED   → overlaps an assigned shift
 *   AVAILABLE → covered by declared availability slot
 *   UNSET    → neither
 *
 * Source of truth for locks is ALWAYS the shifts table.
 * No separate lock table exists or should be created.
 */

import { supabase } from '@/platform/supabase/client';
import { getAvailabilitySlots } from './availability.api';
import { AvailabilitySlot } from '../model/availability.types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A shift interval derived from the shifts table that represents a LOCKED slot.
 * Locked = the employee is already assigned to a shift during this time.
 */
export interface AssignedShiftInterval {
  id: string;
  shift_date: string;          // yyyy-MM-dd
  start_time: string;          // HH:mm:ss
  end_time: string;            // HH:mm:ss
  role_name: string | null;
  department_name: string | null;
  lifecycle_status: string;
}

export interface AvailabilityViewResult {
  declaredSlots: AvailabilitySlot[];
  assignedShifts: AssignedShiftInterval[];
}

// ============================================================================
// FETCH ASSIGNED SHIFTS (LOCKED INTERVALS)
// ============================================================================

/**
 * Fetch all assigned shifts for a user in a date range.
 * These represent locked intervals that block future assignments.
 *
 * Excludes Cancelled and deleted shifts.
 * Ordered by date + start_time for efficient interval merging on the frontend.
 */
export async function getAssignedShiftsForAvailability(
  profileId: string,
  startDate: string, // yyyy-MM-dd
  endDate: string    // yyyy-MM-dd
): Promise<AssignedShiftInterval[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select(`
      id,
      shift_date,
      start_time,
      end_time,
      lifecycle_status,
      roles(name),
      departments(name)
    `)
    .eq('assigned_employee_id', profileId)
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)
    .neq('lifecycle_status', 'Cancelled')
    .or('is_cancelled.is.null,is_cancelled.eq.false')
    .is('deleted_at', null)
    .order('shift_date')
    .order('start_time');

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    shift_date: row.shift_date,
    start_time: row.start_time,
    end_time: row.end_time,
    lifecycle_status: row.lifecycle_status,
    role_name: row.roles?.name ?? null,
    department_name: row.departments?.name ?? null,
  }));
}

// ============================================================================
// COMBINED VIEW (declared + locked)
// ============================================================================

/**
 * Fetch the combined availability view for a user.
 * Equivalent to GET /user/{id}/availability-view
 *
 * Frontend computes final state from the two arrays.
 */
export async function getAvailabilityView(
  profileId: string,
  startDate: string,
  endDate: string
): Promise<AvailabilityViewResult> {
  const [declaredSlots, assignedShifts] = await Promise.all([
    getAvailabilitySlots(profileId, startDate, endDate),
    getAssignedShiftsForAvailability(profileId, startDate, endDate),
  ]);

  return { declaredSlots, assignedShifts };
}

// ============================================================================
// INTERVAL OVERLAP UTILITIES (used by assignShift command)
// ============================================================================

/**
 * Parse time string (HH:mm or HH:mm:ss) to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  return parts[0] * 60 + (parts[1] ?? 0);
}

/**
 * Check if two time intervals overlap (end-exclusive comparison).
 * Both intervals are on the same date.
 */
export function intervalsOverlap(
  aStart: string, aEnd: string,
  bStart: string, bEnd: string
): boolean {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  return as < be && bs < ae;
}

/**
 * Check if a candidate time range is covered by at least one declared slot.
 * Used for isUserAvailable() check.
 */
export function isCoveredBySlots(
  candidateStart: string,
  candidateEnd: string,
  slots: Array<{ start_time: string; end_time: string }>
): boolean {
  const cStart = timeToMinutes(candidateStart);
  const cEnd   = timeToMinutes(candidateEnd);

  const sorted = [...slots].sort(
    (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
  );

  let coveredUntil = cStart;
  for (const slot of sorted) {
    const sStart = timeToMinutes(slot.start_time);
    const sEnd   = timeToMinutes(slot.end_time);
    if (sStart > coveredUntil) break;         // gap in coverage
    if (sEnd > coveredUntil) coveredUntil = sEnd;
    if (coveredUntil >= cEnd) return true;
  }
  return coveredUntil >= cEnd;
}

/**
 * isUserAvailable — checks declared availability slots for a given date + time.
 * Returns true if the candidate shift is fully covered by declared availability.
 */
export function isUserAvailable(
  shiftDate: string,
  shiftStart: string,
  shiftEnd: string,
  slots: Array<{ slot_date: string; start_time: string; end_time: string }>
): boolean {
  const daySlots = slots.filter(s => s.slot_date === shiftDate);
  if (daySlots.length === 0) return false;
  return isCoveredBySlots(shiftStart, shiftEnd, daySlots);
}

/**
 * hasOverlap — checks if a candidate shift overlaps with any already-assigned shift.
 * Returns the overlapping shift if found, null otherwise.
 */
export function hasOverlap(
  shiftDate: string,
  shiftStart: string,
  shiftEnd: string,
  assignedShifts: AssignedShiftInterval[]
): AssignedShiftInterval | null {
  const dayShifts = assignedShifts.filter(s => s.shift_date === shiftDate);
  for (const existing of dayShifts) {
    if (intervalsOverlap(shiftStart, shiftEnd, existing.start_time, existing.end_time)) {
      return existing;
    }
  }
  return null;
}
