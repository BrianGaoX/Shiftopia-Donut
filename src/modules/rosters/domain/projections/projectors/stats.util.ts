/**
 * Top-level ProjectionStats aggregation (worker-safe)
 *
 * Computes the projection's summary stats from already-projected shifts.
 * Pure, no heavy cost engine — costs are read from each projected shift's
 * cached breakdown (unassigned shifts contribute zero by design).
 *
 * Cancelled shifts are passed through into the projection so the UI can
 * render them, but they are excluded from every stat.
 */

import type { ProjectionStats } from '../types';
import type { ProjectedShiftResult } from '../worker/protocol';

export function statsFromProjectedShifts(
  shifts: ProjectedShiftResult[],
): ProjectionStats {
  const live = shifts.filter(s => !s.isCancelled);

  const costBreakdown = { base: 0, penalty: 0, overtime: 0, allowance: 0, leave: 0 };
  let totalNetMinutes = 0;
  let estimatedCost   = 0;
  let assignedShifts  = 0;
  let publishedShifts = 0;

  for (const s of live) {
    totalNetMinutes += s.netMinutes;
    estimatedCost   += s.estimatedCost;
    if (s.employeeId)  assignedShifts++;
    if (s.isPublished) publishedShifts++;
    costBreakdown.base      += s.costBreakdown.base;
    costBreakdown.penalty   += s.costBreakdown.penalty;
    costBreakdown.overtime  += s.costBreakdown.overtime;
    costBreakdown.allowance += s.costBreakdown.allowance;
    costBreakdown.leave     += s.costBreakdown.leave;
  }

  return {
    totalShifts:    live.length,
    assignedShifts,
    openShifts:     live.length - assignedShifts,
    publishedShifts,
    totalNetMinutes,
    estimatedCost:  Math.round(estimatedCost * 100) / 100,
    costBreakdown,
  };
}
