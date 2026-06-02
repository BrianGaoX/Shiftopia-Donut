import { describe, it, expect } from 'vitest';
import { projectRoles } from '../../projections/projectors/roles.projector';
import type { Shift } from '../../shift.entity';
import type { RoleRecord, LevelRecord } from '../../projections/types';
import type { WorkerShiftDTO } from '../../projections/worker/protocol';

// ── Factories ─────────────────────────────────────────────────────────────────

let _id = 0;
function makeShift(overrides: Partial<Shift> = {}): Shift {
  _id++;
  return ({
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
    remuneration_level_id: 'level-1',
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
    remuneration_levels: {
      id: 'level-1',
      level_name: 'Level 3 – Tech',
      level_number: 3,
      hourly_rate_min: 25,
    },
    ...overrides,
  } as unknown as Shift);
}

const ROLES: RoleRecord[] = [
  { id: 'role-1', name: 'V8Stage Hand',  code: 'SH',  remuneration_level_id: 'level-1' },
  { id: 'role-2', name: 'AV Tech',     code: 'AVT', remuneration_level_id: 'level-1' },
  { id: 'role-3', name: 'Usher',       code: 'USH', remuneration_level_id: 'level-2' },
];

const LEVELS: LevelRecord[] = [
  { id: 'level-1', level_name: 'Level 3 – Tech',     level_number: 3 },
  { id: 'level-2', level_name: 'Level 1 – Casual',   level_number: 1 },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('projectRoles — level structure', () => {
  it('groups shifts under their remuneration level', () => {
    const shifts = [
      makeShift({ role_id: 'role-1', remuneration_level_id: 'level-1' }),
    ];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[], { roles: ROLES as any, levels: LEVELS as any });
    const lv = result.levels.find(l => l.id === 'level-1');
    expect(lv).toBeDefined();
    expect(lv!.roles.find(r => r.id === 'role-1')).toBeDefined();
  });

  it('sorts levels by level_number ascending', () => {
    const shifts = [
      makeShift({ role_id: 'role-1', remuneration_level_id: 'level-1' }),
      makeShift({ role_id: 'role-3', remuneration_level_id: 'level-2',
        roles: { id: 'role-3', name: 'Usher' },
        remuneration_levels: { id: 'level-2', level_name: 'Level 1 – Casual', level_number: 1, hourly_rate_min: 15 },
      }),
    ];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[], { roles: ROLES as any, levels: LEVELS as any });
    expect(result.levels[0].levelNumber).toBeLessThan(result.levels[1].levelNumber);
  });

  it('levels with no shifts are omitted', () => {
    const shifts = [makeShift({ role_id: 'role-1', remuneration_level_id: 'level-1' })];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[], { roles: ROLES as any, levels: LEVELS as any });
    // level-2 has no shifts
    expect(result.levels.find(l => l.id === 'level-2')).toBeUndefined();
  });
});

describe('projectRoles — unassigned roles', () => {
  it('places shifts with no remuneration_level_id in unassignedRoles', () => {
    const shifts = [
      makeShift({ remuneration_level_id: null, roles: { id: 'role-x', name: 'Runner' } }),
    ];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[]);
    expect(result.unassignedRoles).toHaveLength(1);
    expect(result.unassignedRoles[0].name).toBe('Runner');
  });
});

describe('projectRoles — shiftsByDate', () => {
  it('groups shifts under the correct date key', () => {
    const shifts = [
      makeShift({ shift_date: '2025-03-15', role_id: 'role-1', remuneration_level_id: 'level-1' }),
      makeShift({ shift_date: '2025-03-16', role_id: 'role-1', remuneration_level_id: 'level-1' }),
    ];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[], { roles: ROLES as any, levels: LEVELS as any });
    const lv     = result.levels.find(l => l.id === 'level-1')!;
    const role   = lv.roles.find(r => r.id === 'role-1')!;
    expect(Object.keys(role.shiftsByDate)).toHaveLength(2);
    expect(role.shiftsByDate['2025-03-15']).toHaveLength(1);
    expect(role.shiftsByDate['2025-03-16']).toHaveLength(1);
  });
});

describe('projectRoles — totalHours / totalCost aggregation', () => {
  it('level totalHours sums across all roles in that level', () => {
    const shifts = [
      makeShift({ role_id: 'role-1', remuneration_level_id: 'level-1', net_length_minutes: 480, remuneration_rate: 30 }),
      makeShift({ role_id: 'role-2', remuneration_level_id: 'level-1', net_length_minutes: 240, remuneration_rate: 30,
        roles: { id: 'role-2', name: 'AV Tech' },
      }),
    ];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[], { roles: ROLES as any, levels: LEVELS as any });
    const lv = result.levels.find(l => l.id === 'level-1')!;
    expect(lv.totalHours).toBeCloseTo(12); // 8h + 4h
    expect(lv.totalCost).toBeCloseTo(360);  // 8*30 + 4*30
  });
});

describe('projectRoles — levelColorClass', () => {
  it('applies a purple colour class for level ≥ 7', () => {
    const lvShift = makeShift({
      remuneration_level_id: 'level-9',
      remuneration_levels: { id: 'level-9', level_name: 'Level 9', level_number: 9, hourly_rate_min: 50 },
    });
    const result = projectRoles([lvShift] as unknown as WorkerShiftDTO[], {
      levels: [{ id: 'level-9', level_name: 'Level 9', level_number: 9 }] as any,
    });
    const lv = result.levels.find(l => l.id === 'level-9')!;
    expect(lv.colorClass).toContain('purple');
  });
});

describe('projectRoles — stats', () => {
  it('stats counts non-cancelled shifts only', () => {
    const shifts = [
      makeShift({ is_cancelled: false }),
      makeShift({ is_cancelled: true }),
    ];
    const result = projectRoles(shifts as unknown as WorkerShiftDTO[]);
    expect(result.stats.totalShifts).toBe(1);
  });
});
