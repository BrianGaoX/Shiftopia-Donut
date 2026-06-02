/**
 * DnD Utilities — Single Source of Truth for Roster DnD Logic
 */
import { ShiftDisplay } from '../domain/queries/getGroupsModeGrid.query';
import { getSydneyNow, isSydneyStarted } from '@/modules/core/lib/date.utils';
import { format } from 'date-fns';

/**
 * Determines if a shift can be dragged.
 * Rules:
 * 1. DnD Mode must be active.
 * 2. Shift must be in 'Draft' status.
 * 3. Shift must NOT be cancelled.
 */
export const canDragShift = (
  shift: { lifecycle_status: string; is_cancelled?: boolean } | ShiftDisplay,
  isDnDModeActive: boolean
): boolean => {
  if (!isDnDModeActive) return false;

  // Handle both raw shift object and ShiftDisplay wrapper
  const status = 'lifecycle_status' in shift ? shift.lifecycle_status : (shift as ShiftDisplay).status;
  const isCancelled = 'is_cancelled' in shift ? shift.is_cancelled : (shift as ShiftDisplay).isCancelled;
  const shiftDate = 'shift_date' in shift ? shift.shift_date : (shift as any).rawShift?.shift_date;
  const startTime = 'start_time' in shift ? shift.start_time : (shift as ShiftDisplay).startTime;

  // Granular check: has the shift already started?
  if (shiftDate && startTime && isSydneyStarted(shiftDate as string, startTime as string)) return false;

  return status === 'Draft' && !isCancelled;
};

/**
 * Determines if a shift can be dropped onto a target.
 *
 * Granular past-time guard:
 *   If targetDate is today (Sydney) and startTime is earlier than now,
 *   the drop is blocked — prevents moving a shift to a time slot that has
 *   already passed even though the date itself is not "past".
 */
export const canDropOnTarget = (
  isDnDModeActive: boolean,
  shift: { lifecycle_status: string; is_cancelled?: boolean } | ShiftDisplay,
  targetContext?: {
    isPast?: boolean;
    isLocked?: boolean;
    /** ISO date string 'yyyy-MM-dd' of the target cell */
    targetDate?: string;
    /** HH:mm start time of the dragged shift — used for intra-day past check */
    startTime?: string;
  }
): boolean => {
  if (!isDnDModeActive) return false;

  // Re-verify shift status (safety)
  const status = 'lifecycle_status' in shift ? shift.lifecycle_status : (shift as ShiftDisplay).status;
  const isCancelled = 'is_cancelled' in shift ? shift.is_cancelled : (shift as ShiftDisplay).isCancelled;

  if (status !== 'Draft' || isCancelled) return false;

  // Whole-day past check
  if (targetContext?.isPast) return false;
  if (targetContext?.isLocked) return false;

  // Granular: today + start time already passed (Sydney clock)
  if (targetContext?.targetDate && targetContext?.startTime) {
    if (isSydneyStarted(targetContext.targetDate, targetContext.startTime)) return false;
  }

  return true;
};
