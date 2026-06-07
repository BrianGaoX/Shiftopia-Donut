import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectGroup } from '../../projections/projectors/group.projector';
import type { Shift } from '../../shift.entity';
import type { WorkerShiftDTO } from '../../projections/worker/protocol';
import { shiftToDTO } from '../../projections/worker/mappers';
import { GROUP_COLORS } from '../../projections/constants';
import type { TemplateGroupType } from '../../shift.entity';

// ── Shift factory ─────────────────────────────────────────────────────────────

let _id = 0;
function makeShift(overrides: Partial<Shift> = {}): WorkerShiftDTO {
  _id++;
  return shiftToDTO(({
    id: `shift-${_id}`,
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
    role_id: 'role-1',
    role_level: null,
    remuneration_level_id: null,
    remuneration_rate: 25,
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
    net_length_minutes: 480,
    total_hours: 8,
    timezone: 'Australia/Sydney',
    assigned_employee_id: null,
    assignment_id: null,
    assigned_at: null,
    lifecycle_status: 'Published',
    assignment_status: 'unassigned',
    fulfillment_status: 'none',
    is_draft: false,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_by_user_id: null,
    cancellation_reason: null,
    bidding_status: 'not_on_bidding',
    bidding_priority_text: 'normal',
    trade_requested_at: null,
    required_skills: [],
    required_licenses: [],
    eligibility_snapshot: null,
    event_ids: [],
    tags: [],
    compliance_snapshot: null,
    compliance_checked_at: null,
    compliance_override: false,
    compliance_override_reason: null,
    is_published: true,
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
    roles: { id: 'role-1', name: 'V8Stage Hand' },
    ...overrides,
  } as unknown as Shift));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('projectGroup — canonical groups', () => {
  it('always returns 3 canonical groups even with zero shifts', () => {
    const result = projectGroup([]);
    const types = result.groups.map(g => g.type);
    expect(types).toContain('convention_centre');
    expect(types).toContain('exhibition_centre');
    expect(types).toContain('theatre');
  });

  it('omits the unassigned group when all shifts have a group_type', () => {
    const shifts = [makeShift({ group_type: 'convention_centre' })];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    expect(result.groups.find(g => g.type === 'unassigned')).toBeUndefined();
  });

  it('includes the unassigned group when a shift has no group_type', () => {
    const shifts = [makeShift({ group_type: null })];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    expect(result.groups.find(g => g.type === 'unassigned')).toBeDefined();
  });
});

describe('projectGroup — shift routing', () => {
  it('routes convention_centre shifts to the correct group', () => {
    const shifts = [
      makeShift({ group_type: 'convention_centre', sub_group_name: 'Hall A', shift_date: '2025-03-15' }),
    ];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    const cc = result.groups.find(g => g.type === 'convention_centre')!;
    expect(cc.subGroups.length).toBeGreaterThanOrEqual(1);
    const hallA = cc.subGroups.find(sg => sg.name === 'Hall A');
    expect(hallA).toBeDefined();
    expect(hallA!.shiftsByDate['2025-03-15']).toHaveLength(1);
  });

  it('places null sub_group_name shifts under "General" subgroup', () => {
    const shifts = [makeShift({ group_type: 'theatre', sub_group_name: null })];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    const theatre = result.groups.find(g => g.type === 'theatre')!;
    const general = theatre.subGroups.find(sg => sg.name === 'General');
    expect(general).toBeDefined();
    expect(general!.shiftsByDate['2025-03-15']).toHaveLength(1);
  });
});

describe('projectGroup — stats', () => {
  it('stats.totalShifts excludes cancelled shifts', () => {
    const shifts = [
      makeShift({ group_type: 'convention_centre', is_cancelled: false }),
      makeShift({ group_type: 'convention_centre', is_cancelled: true }),
    ];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    // cancelled shifts are passed through but stats should only count non-cancelled
    expect(result.stats.totalShifts).toBe(1);
  });

  it('stats.assignedShifts counts only shifts with an employee', () => {
    const shifts = [
      makeShift({ group_type: 'exhibition_centre', assigned_employee_id: 'emp-1' }),
      makeShift({ group_type: 'exhibition_centre', assigned_employee_id: null }),
    ];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    expect(result.stats.assignedShifts).toBe(1);
    expect(result.stats.openShifts).toBe(1);
  });

  it('group stats roll up from subgroup shifts', () => {
    const shifts = [
      makeShift({ group_type: 'theatre', sub_group_name: 'V8Stage', net_length_minutes: 480, remuneration_rate: 30 }),
      makeShift({ group_type: 'theatre', sub_group_name: 'V8Stage', net_length_minutes: 240, remuneration_rate: 30 }),
    ];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    const theatre = result.groups.find(g => g.type === 'theatre')!;
    expect(theatre.stats.totalShifts).toBe(2);
    expect(theatre.stats.totalHours).toBeCloseTo(12); // (480+240)/60
  });
});

describe('projectGroup — projected shift fields', () => {
  it('correctly maps isLocked from shift.is_locked', () => {
    const shifts = [makeShift({ group_type: 'convention_centre', is_locked: true })];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    const cc = result.groups.find(g => g.type === 'convention_centre')!;
    const sg = cc.subGroups[0];
    const ps = Object.values(sg.shiftsByDate).flat()[0];
    expect(ps.isLocked).toBe(true);
  });

  it('correctly maps isUrgent from bidding_status', () => {
    // Shift is at 2025-03-15T09:00. Mock now = 12h before → TTS = 12h → urgent window (4–24h).
    const shiftStart = new Date('2025-03-15T09:00:00').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(shiftStart - 12 * 60 * 60 * 1000);
    try {
      const shifts = [makeShift({ group_type: 'convention_centre', bidding_status: 'on_bidding_urgent' })];
      const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
      const cc = result.groups.find(g => g.type === 'convention_centre')!;
      const ps = Object.values(cc.subGroups[0].shiftsByDate).flat()[0];
      expect(ps.isUrgent).toBe(true);
      expect(ps.isOnBidding).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('groupColors for theatre uses red accent', () => {
    const shifts = [makeShift({ group_type: 'theatre' })];
    const result = projectGroup(shifts as unknown as WorkerShiftDTO[]);
    const theatre = result.groups.find(g => g.type === 'theatre')!;
    const ps = Object.values(theatre.subGroups[0].shiftsByDate).flat()[0];
    // The projected shift carries a lightweight color KEY; the UI resolves it
    // to the canonical color set. Theatre's accent must be red.
    expect(ps.groupColorKey).toBe('theatre');
    expect(GROUP_COLORS[ps.groupColorKey as TemplateGroupType].accent).toBe('red');
  });
});
