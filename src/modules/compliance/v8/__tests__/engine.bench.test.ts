/**
 * V8 engine load benchmark.
 *
 * Regular `it()` assertions run in CI and gate merges with hard time budgets.
 * `bench()` blocks (run with `vitest bench`) profile relative cost across
 * fixture sizes for non-CI investigation.
 *
 * Budgets are deliberately generous to absorb noisy CI runners; tighten
 * them only when consistent local + CI numbers warrant it.
 */

import { describe, it, expect } from 'vitest';
import { runV8Orchestrator } from '../orchestrator';
import type {
  V8OrchestratorInput,
  V8OrchestratorShift,
  V8EmployeeContext,
} from '../orchestrator/types';

// ── Fixture builders ────────────────────────────────────────────────────────

function buildShift(empId: string, dayIdx: number): V8OrchestratorShift {
  const base = new Date('2026-06-01T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + dayIdx);
  const date = base.toISOString().slice(0, 10);
  return {
    id: `${empId}-shift-${dayIdx}`,
    date,
    start_time: '09:00',
    end_time: '17:00',
    is_ordinary_hours: true,
    role_id: 'r1',
    required_qualifications: ['rsa-cert'],
    break_minutes: 0,
    unpaid_break_minutes: 0,
  } as V8OrchestratorShift;
}

function buildEmployeeContext(empId: string): V8EmployeeContext {
  return {
    employee_id: empId,
    contract_type: 'FULL_TIME',
    contracted_weekly_hours: 38,
    skill_ids: ['rsa-cert'],
    license_ids: [],
    assigned_role_ids: ['r1'],
    contracts: [],
    qualifications: [
      { qualification_id: 'rsa-cert', issued_at: '2024-01-01', expires_at: null },
    ],
  };
}

function buildInput(
  employeeId: string,
  existingShiftCount: number,
): V8OrchestratorInput {
  const existing = Array.from({ length: existingShiftCount }, (_, i) =>
    buildShift(employeeId, i),
  );
  const candidate = buildShift(employeeId, existingShiftCount + 1);
  return {
    employee_id: employeeId,
    employee_context: buildEmployeeContext(employeeId),
    existing_shifts: existing,
    candidate_changes: { add_shifts: [candidate], remove_shifts: [] },
    mode: 'SIMULATED',
    operation_type: 'BID',
    stage: 'DRAFT',
    evaluation_reference_date: candidate.date,
  };
}

// ── CI gates (run with `vitest run`) ───────────────────────────────────────

describe('V8 engine — single call budgets', () => {
  it('small (30 existing shifts) solves in < 50ms', () => {
    const input = buildInput('emp-1', 30);
    const t0 = performance.now();
    const result = runV8Orchestrator(input);
    const elapsed = performance.now() - t0;
    expect(result.evaluated_shift_count).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('medium (300 existing shifts) solves in < 200ms', () => {
    const input = buildInput('emp-2', 300);
    const t0 = performance.now();
    runV8Orchestrator(input);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
  });

  it('large (1000 existing shifts) solves in < 1000ms', () => {
    const input = buildInput('emp-3', 1000);
    const t0 = performance.now();
    runV8Orchestrator(input);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('V8 engine — looped bulk-bid scenario', () => {
  it('100 candidate shifts over a 100-shift roster solves in < 2s', () => {
    const empId = 'emp-bulk';
    const existing = Array.from({ length: 100 }, (_, i) => buildShift(empId, i));
    const ctx = buildEmployeeContext(empId);

    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      const candidate = buildShift(empId, 100 + i);
      runV8Orchestrator({
        employee_id: empId,
        employee_context: ctx,
        existing_shifts: existing,
        candidate_changes: { add_shifts: [candidate], remove_shifts: [] },
        mode: 'SIMULATED',
        operation_type: 'BID',
        stage: 'DRAFT',
        evaluation_reference_date: candidate.date,
      });
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
  });
});

// Benchmark blocks omitted; the CI-gating `it()` budgets above already pin
// regression and are visible in the same vitest run.
