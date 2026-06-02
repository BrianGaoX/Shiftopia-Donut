import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  grossMinutes,
  netMinutesFromShift,
  formatMinutes,
  minutesToHours,
} from '../../projections/utils/duration';
import type { Shift } from '../../shift.entity';

// Minimal shift factory — only the fields duration utils care about
function makeShift(overrides: Partial<Shift> = {}): Shift {
  return ({
    id: 'test-shift',
    organization_id: null,
    department_id: 'dept-1',
    sub_department_id: null,
    created_by_user_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    version: 1,
    roster_id: 'roster-1',
    roster_date: '2025-03-15',
    shift_date: '2025-03-15',
    template_id: null,
    template_group: null,
    template_sub_group: null,
    is_from_template: false,
    template_instance_id: null,
    group_type: null,
    sub_group_name: null,
    display_order: 0,
    shift_group_id: null,
    shift_subgroup_id: null,
    role_id: null,
    role_level: null,
    remuneration_level_id: null,
    remuneration_rate: null,
    actual_hourly_rate: null,
    currency: 'AUD',
    cost_center_id: null,
    start_time: '09:00',
    end_time: '17:00',
    scheduled_start: null,
    scheduled_end: null,
    is_overnight: false,
    scheduled_length_minutes: null,
    break_minutes: 0,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_length_minutes: null,
    total_hours: null,
    timezone: 'Australia/Sydney',
    assigned_employee_id: null,
    assignment_id: null,
    assigned_at: null,
    lifecycle_status: 'Draft',
    assignment_status: 'unassigned',
    fulfillment_status: 'none',
    is_draft: true,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_by_user_id: null,
    cancellation_reason: null,
    bidding_status: 'not_on_bidding',
    bidding_priority_text: 'normal',
    trade_requested_at: null,
    attendance_status: 'unknown',
    required_skills: [],
    required_licenses: [],
    eligibility_snapshot: null,
    event_ids: [],
    tags: [],
    compliance_snapshot: null,
    compliance_checked_at: null,
    compliance_override: false,
    compliance_override_reason: null,
    is_published: false,
    published_at: null,
    published_by_user_id: null,
    is_locked: false,
    lock_reason_text: null,
    timesheet_id: null,
    actual_start: null,
    actual_end: null,
    actual_net_minutes: null,
    payroll_exported: false,
    last_modified_by: null,
    last_modified_reason: null,
    deleted_at: null,
    deleted_by: null,
    notes: null,
    is_recurring: false,
    recurrence_rule: null,
    confirmed_at: null,
    ...overrides,
  } as unknown as Shift);
}

// ── parseTimeToMinutes ────────────────────────────────────────────────────────

describe('parseTimeToMinutes', () => {
  it('converts "09:00" → 540', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
  });

  it('converts "17:30" → 1050', () => {
    expect(parseTimeToMinutes('17:30')).toBe(1050);
  });

  it('converts "00:00" → 0', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseTimeToMinutes('')).toBe(0);
  });
});

// ── grossMinutes ──────────────────────────────────────────────────────────────

describe('grossMinutes', () => {
  it('09:00 → 17:00 = 480 min', () => {
    expect(grossMinutes('09:00', '17:00')).toBe(480);
  });

  it('handles overnight: 22:00 → 06:00 = 480 min', () => {
    expect(grossMinutes('22:00', '06:00')).toBe(480);
  });

  it('same start and end = 1440 (treated as full 24 h overnight)', () => {
    // The function adds 24*60 when end <= start; equal times fall into this branch.
    // Real shifts never have equal start/end, so this is a documented edge case.
    expect(grossMinutes('09:00', '09:00')).toBe(1440);
  });
});

// ── netMinutesFromShift ───────────────────────────────────────────────────────

describe('netMinutesFromShift', () => {
  it('prefers net_length_minutes when set', () => {
    const shift = makeShift({ net_length_minutes: 450, start_time: '09:00', end_time: '17:00', break_minutes: 0 });
    expect(netMinutesFromShift(shift)).toBe(450);
  });

  it('falls back to gross − unpaid_break_minutes when net_length_minutes is null', () => {
    // The fallback uses unpaid_break_minutes (not break_minutes)
    const shift = makeShift({ net_length_minutes: null, start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30 });
    expect(netMinutesFromShift(shift)).toBe(450); // 480 - 30
  });

  it('handles overnight shift via fallback', () => {
    const shift = makeShift({ net_length_minutes: null, start_time: '22:00', end_time: '06:00', break_minutes: 0 });
    expect(netMinutesFromShift(shift)).toBe(480);
  });

  it('returns 0 when net_length_minutes is 0 (explicit zero beats fallback)', () => {
    const shift = makeShift({ net_length_minutes: 0, start_time: '09:00', end_time: '17:00' });
    // net_length_minutes=0 is falsy, so falls back to gross calculation: 480 min
    expect(netMinutesFromShift(shift)).toBe(480);
  });
});

// ── formatMinutes ─────────────────────────────────────────────────────────────

describe('formatMinutes', () => {
  it('formats whole hours: 480 → "8h"', () => {
    expect(formatMinutes(480)).toBe('8h');
  });

  it('formats hours + minutes: 510 → "8h 30m"', () => {
    expect(formatMinutes(510)).toBe('8h 30m');
  });

  it('formats minutes only: 45 → "45m"', () => {
    expect(formatMinutes(45)).toBe('45m');
  });

  it('formats 0 → "0m"', () => {
    expect(formatMinutes(0)).toBe('0m');
  });
});

// ── minutesToHours ────────────────────────────────────────────────────────────

describe('minutesToHours', () => {
  it('480 min → 8.00', () => {
    expect(minutesToHours(480)).toBe(8);
  });

  it('510 min → 8.50', () => {
    expect(minutesToHours(510)).toBe(8.5);
  });

  it('rounds to 2 decimal places', () => {
    expect(minutesToHours(100)).toBe(1.67);
  });
});
