/**
 * Compliance Service
 *
 * Delegates all four compliance checks to the `evaluate-compliance` Edge
 * Function, which runs them in parallel server-side using the service_role
 * key — bypassing RLS so cross-department shifts are always visible.
 *
 * Benefits over the previous per-RPC approach:
 *  - 1 HTTP round-trip instead of 4 (saves ~150 ms on a typical connection)
 *  - All checks run with service_role — no RLS blind spots
 *  - Server-side fault isolation: one check failure never cancels the others
 *  - The overall status is 'unavailable' only if ALL checks failed —
 *    never silently treated as 'passed'
 *
 * Legacy adapter at the bottom maintains backward compatibility with
 * existing callers using complianceService.validateShiftCompliance().
 */

import { supabase } from '@/platform/supabase/client';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';

// ── Types ──────────────────────────────────────────────────────────────────

export type ComplianceStatus =
  | 'passed'       // All checks passed — safe to save
  | 'violated'     // Hard violation — save MUST be blocked
  | 'warned'       // Soft warning — save can proceed with acknowledgment
  | 'unavailable'; // Engine unreachable — surface to UI, NEVER treat as passed

export interface QualificationViolation {
  type: 'ROLE_MISMATCH' | 'LICENSE_MISSING' | 'LICENSE_EXPIRED' | 'SKILL_MISSING' | 'SKILL_EXPIRED';
  message: string;
  role_id?: string;
  license_id?: string;
  license_name?: string;
  skill_id?: string;
  skill_name?: string;
  expiration_date?: string;
}

export interface ComplianceResult {
  /** Overall result status */
  status: ComplianceStatus;
  /** Hard violations — present when status = 'violated' */
  violations: string[];
  /** Soft warnings — may be present alongside any status */
  warnings: string[];
  /** Projected weekly hours after this shift is added */
  weeklyHours: number;
  /** Configured maximum weekly hours */
  maxWeeklyHours: number;
  /** Which checks actually ran successfully */
  checksPerformed: string[];
  /** Which checks could not reach the database */
  checksSkipped: string[];
  /** Structured qualification violations (role/license/skill) */
  qualificationViolations: QualificationViolation[];
}

export interface ComplianceInput {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  netLengthMinutes: number;
  excludeV8ShiftId?: string;
  /** The shift ID (UUID) — required for qualification compliance check */
  shiftId?: string;
  /** Optional override for required role */
  overrideV8RoleId?: string;
  /** Optional override for required skills */
  overrideSkillIds?: string[];
  /** Optional override for required licenses */
  overrideLicenseIds?: string[];
}

// ── Main compliance entry point ────────────────────────────────────────────

const MAX_WEEKLY_HOURS = 48;

const UNAVAILABLE_RESULT: ComplianceResult = {
  status: 'unavailable',
  violations: [],
  warnings: ['Cannot validate compliance without a valid employee assignment'],
  weeklyHours: 0,
  maxWeeklyHours: MAX_WEEKLY_HOURS,
  checksPerformed: [],
  checksSkipped: ['overlap', 'weekly_hours', 'rest_period', 'qualification'],
  qualificationViolations: [],
};

/**
 * Run all four compliance checks via the evaluate-compliance Edge Function.
 *
 * All checks run server-side in parallel with service_role access.
 * Falls back to 'unavailable' (never silent pass) if the function errors.
 */
export async function validateCompliance(input: ComplianceInput): Promise<ComplianceResult> {
  if (!isValidUuid(input.employeeId)) {
    return UNAVAILABLE_RESULT;
  }

  const { data, error } = await supabase.functions.invoke<ComplianceResult>('evaluate-compliance', {
    body: {
      employee_id:          input.employeeId,
      shift_date:           input.shiftDate,
      start_time:           input.startTime,
      end_time:             input.endTime,
      net_length_minutes:   input.netLengthMinutes,
      exclude_shift_id:     input.excludeV8ShiftId ?? null,
      shift_id:             input.shiftId ?? null,
      override_role_id:     input.overrideV8RoleId ?? null,
      override_skill_ids:   input.overrideSkillIds ?? null,
      override_license_ids: input.overrideLicenseIds ?? null,
    },
  });

  if (error || !data) {
    console.error('[validateCompliance] Edge function error:', error);
    return {
      status: 'unavailable',
      violations: [],
      warnings: ['Compliance engine unreachable — checks could not be performed'],
      weeklyHours: 0,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
      checksPerformed: [],
      checksSkipped: ['overlap', 'weekly_hours', 'rest_period', 'qualification'],
      qualificationViolations: [],
    };
  }

  return data;
}

// ── Legacy adapter ─────────────────────────────────────────────────────────
// Backward compatible with existing callers. New code should call
// validateCompliance() directly to access the full ComplianceResult.

export const complianceService = {
  async validateShiftCompliance(
    employeeId: string,
    shiftDate: string,
    startTime: string,
    endTime: string,
    netLengthMinutes: number,
    excludeV8ShiftId?: string,
  ) {
    const result = await validateCompliance({
      employeeId, shiftDate, startTime, endTime, netLengthMinutes, excludeV8ShiftId,
    });
    // F5: 'unavailable' must NOT be treated as valid. Only 'passed' and 'warned'
    // mean the check ran and found no blocking violation. Any other status
    // (including 'unavailable') is treated as invalid to prevent silent saves
    // when the compliance engine is unreachable.
    return {
      isValid: result.status === 'passed' || result.status === 'warned',
      violations: result.violations,
      warnings: result.warnings,
      weeklyHours: result.weeklyHours,
      maxWeeklyHours: result.maxWeeklyHours,
    };
  },
};
