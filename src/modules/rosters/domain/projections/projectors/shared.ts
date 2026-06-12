/**
 * Shared projector utilities
 *
 * Functions used by multiple projectors — kept here to avoid circular imports.
 * Pure functions, no React, no side effects.
 *
 * Phase 3: Builds an AwardContext before the cost loop so holiday and
 * day-of-week lookups are O(1) map reads for every shift on the same date.
 */

import type { Shift } from '../../shift.entity';
import type { ProjectionStats } from '../types';
import { netMinutesFromShift } from '../utils/duration';
import { estimateDetailedShiftCost } from '../utils/cost/index';
import { buildAwardContext } from '../utils/cost/award-context';
import type { AwardContext } from '../utils/cost/award-context';

/**
 * Compute the top-level ProjectionStats bag from a flat Shift array.
 * Called by every projector so the returned `stats` field is consistent
 * across all four modes regardless of which projector is active.
 */
export function buildStats(shifts: Shift[]): ProjectionStats {
  const nonCancelled = shifts.filter(s => !s.is_cancelled);

  // ── Phase 3: Pre-compute date context for the entire batch ─────────
  const assignedShifts = nonCancelled.filter(s => !!s.assigned_employee_id);
  const ctx = buildAwardContext(assignedShifts.map(s => s.shift_date).filter(Boolean));

  let totalNetMinutes = 0;
  let estimatedCost   = 0;
  const costBreakdown = {
    base: 0,
    penalty: 0,
    overtime: 0,
    allowance: 0,
    leave: 0,
  };

  for (const shift of nonCancelled) {
    const mins = netMinutesFromShift(shift);
    totalNetMinutes += mins;

    // Cost is employee-dependent — only compute for assigned shifts
    if (shift.assigned_employee_id) {
      const roleName = shift.roles?.name;
      const empType = shift.target_employment_type;

      const detail = estimateDetailedShiftCost({
        netMinutes: mins,
        start_time: shift.start_time,
        end_time: shift.end_time,
        rate: (shift as any).actual_hourly_rate || shift.remuneration_rate,
        scheduled_length_minutes: shift.scheduled_length_minutes ?? 0,
        is_overnight: !!shift.is_overnight,
        is_cancelled: !!shift.is_cancelled,
        shift_date: shift.shift_date,
        allowances: shift.allowances,
        isAnnualLeave: (shift as any).isAnnualLeave,
        isPersonalLeave: (shift as any).isPersonalLeave,
        isCarerLeave: (shift as any).isCarerLeave,
        previousWage: (shift as any).previousWage,
        employmentType: empType === 'FT' ? 'Full-Time' : empType === 'PT' ? 'Part-Time' : (empType as any || 'Casual'),
        isSecurityRole: roleName?.toLowerCase().includes('security'),
        classificationLevel: roleName?.match(/(?:L|Level\s*)(\d)/i)
          ? `LEVEL_${roleName.match(/(?:L|Level\s*)(\d)/i)![1]}`
          : undefined,
      } as any, ctx);

      estimatedCost += detail.totalCost;
      costBreakdown.base += detail.ordinaryCost;
      costBreakdown.penalty += detail.penaltyCost;
      costBreakdown.overtime += detail.overtimeCost;
      costBreakdown.allowance += detail.allowanceCost ?? 0;
    }
  }

  return {
    totalShifts:    nonCancelled.length,
    assignedShifts: assignedShifts.length,
    openShifts:     nonCancelled.length - assignedShifts.length,
    publishedShifts: nonCancelled.filter(s => ['Published', 'InProgress', 'Completed'].includes(s.lifecycle_status)).length,
    totalNetMinutes,
    estimatedCost:  Math.round(estimatedCost * 100) / 100,
    costBreakdown,
  };
}
