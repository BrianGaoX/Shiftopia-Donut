/**
 * Unit tests for the L3 baseline executor.
 * Pure tests — no DB, no network.
 *
 * Covers:
 *   - single-rule evaluation per slice
 *   - applies_when filtering
 *   - cell aggregation when multiple rules hit the same (slice, function, level)
 *   - pass-1 / pass-2 ordering: supervisor ratios read pass-1 totals
 *   - runtime errors are captured, not thrown
 *   - deterministic ordering of contributing_rule_codes
 */

import { describe, it, expect } from 'vitest';

import { compileRules, runBaseline } from '../ruleBaseline.service';
import type { DemandRuleRow, EventFeatureForRules } from '../../domain/ruleEngine.types';

function rule(
    rule_code: string,
    formula: string,
    overrides: Partial<DemandRuleRow> & { service_type?: any } = {},
): DemandRuleRow {
    return {
        id: rule_code,
        rule_code,
        function_code: 'F&B',
        level: 1,
        applies_when: {},
        formula,
        priority: 100,
        version: 1,
        is_active: true,
        notes: null,
        ...overrides,
    };
}

const feature: EventFeatureForRules = {
    event_id: 'e1',
    event_type: 'Conference',
    pax: 500,
    start_iso: '2026-05-04T16:00:00+10:00',
    end_iso: '2026-05-04T22:00:00+10:00',
    duration_min: 360,
    service_type: 'buffet',
    alcohol: true,
    room_count: 2,
    total_sqm: 0,
    bump_in_min: 120,
    bump_out_min: 60,
    layout_complexity: 'standard',
    first_slice_idx: 32,
    last_slice_idx: 33, // 2 slices to keep cell counts small
};

describe('ruleBaseline — pass-1 evaluation', () => {
    it('produces one cell per (slice, function, level) for a single rule', () => {
        const { compiled } = compileRules([
            rule('fb_buffet', 'ceil(pax / 50)', { service_type: undefined as any }),
        ]);
        const out = runBaseline(feature, compiled);

        expect(out.cells).toHaveLength(2); // 2 slices × 1 cell
        expect(out.cells[0]).toMatchObject({
            slice_idx: 32,
            function_code: 'F&B',
            level: 1,
            headcount: 10, // 500 / 50
            contributing_rule_codes: ['fb_buffet'],
        });
        expect(out.runtimeErrors).toHaveLength(0);
    });

    it('skips rules whose applies_when does not match', () => {
        const { compiled } = compileRules([
            rule('fb_buffet', 'ceil(pax / 50)', { applies_when: { service_type: 'buffet' } }),
            rule('fb_plated', 'ceil(pax / 12)', { applies_when: { service_type: 'plated' } }),
        ]);
        const out = runBaseline(feature, compiled);

        // Only fb_buffet should fire (feature.service_type === 'buffet').
        for (const cell of out.cells) {
            expect(cell.contributing_rule_codes).toEqual(['fb_buffet']);
        }
    });

    it('aggregates multiple rules that hit the same cell', () => {
        const { compiled } = compileRules([
            rule('sec_baseline', 'max(2, ceil(pax / 200))', {
                rule_code: 'sec_baseline',
                function_code: 'Security',
                level: 3,
                priority: 100,
            }),
            rule('sec_alcohol', 'ceil(pax / 200)', {
                rule_code: 'sec_alcohol',
                function_code: 'Security',
                level: 3,
                priority: 110,
                applies_when: { alcohol: true },
            }),
        ]);
        const out = runBaseline(feature, compiled);

        const securityCells = out.cells.filter(
            (c) => c.function_code === 'Security' && c.level === 3,
        );
        // pax=500 → baseline=max(2, 3)=3; alcohol uplift=ceil(500/200)=3 → 6
        for (const cell of securityCells) {
            expect(cell.headcount).toBe(6);
            expect(cell.contributing_rule_codes).toEqual(['sec_baseline', 'sec_alcohol']);
        }
    });
});

describe('ruleBaseline — pass-2 (level-dependent rules)', () => {
    it('supervisor ratio reads pass-1 totals from same slice', () => {
        const { compiled } = compileRules([
            // Pass-1: 10 L1 staff (500/50)
            rule('fb_buffet', 'ceil(pax / 50)', {
                rule_code: 'fb_buffet',
                function_code: 'F&B',
                level: 1,
            }),
            // Pass-2: 1 supervisor per 8 L1 staff → ceil(10/8) = 2
            rule('fb_sup', 'ceil(staff_at_levels[1] / 8)', {
                rule_code: 'fb_sup',
                function_code: 'F&B',
                level: 5,
                priority: 200,
            }),
        ]);
        const out = runBaseline(feature, compiled);

        const supCells = out.cells.filter(
            (c) => c.function_code === 'F&B' && c.level === 5,
        );
        expect(supCells).toHaveLength(2); // 2 slices
        for (const cell of supCells) {
            expect(cell.headcount).toBe(2);
            expect(cell.contributing_rule_codes).toEqual(['fb_sup']);
        }
    });

    it('pass-2 rule sees zero staff if no pass-1 rule fired in slice', () => {
        const { compiled } = compileRules([
            rule('fb_sup', 'ceil(staff_at_levels[1] / 8)', {
                rule_code: 'fb_sup',
                function_code: 'F&B',
                level: 5,
                priority: 200,
            }),
        ]);
        const out = runBaseline(feature, compiled);

        // No L1 staff in pass-1 → ceil(0/8) = 0 → no L5 cell created.
        expect(out.cells.filter((c) => c.level === 5)).toHaveLength(0);
    });
});

describe('ruleBaseline — robustness', () => {
    it('captures runtime errors without aborting the whole event', () => {
        const { compiled } = compileRules([
            rule('bad', 'pax / 0'),
            rule('good', 'ceil(pax / 50)', { rule_code: 'good' }),
        ]);
        const out = runBaseline(feature, compiled);

        // 'good' still produced cells.
        expect(out.cells.some((c) => c.contributing_rule_codes.includes('good'))).toBe(true);
        // 'bad' was logged in runtimeErrors per slice.
        expect(out.runtimeErrors.length).toBeGreaterThanOrEqual(2);
        expect(out.runtimeErrors.every((e) => e.rule_code === 'bad')).toBe(true);
    });

    it('compileRules collects parse errors instead of throwing', () => {
        const { compiled, errors } = compileRules([
            rule('bad', '(2 + '),    // unbalanced
            rule('good', 'pax + 1'),
        ]);
        expect(compiled).toHaveLength(1);
        expect(errors).toHaveLength(1);
        expect(errors[0].rule_code).toBe('bad');
    });

    it('inactive rules are skipped', () => {
        const { compiled } = compileRules([
            rule('fb_buffet', 'ceil(pax / 50)', { is_active: false }),
        ]);
        const out = runBaseline(feature, compiled);
        expect(out.cells).toHaveLength(0);
    });

    it('produces deterministic output across runs', () => {
        const { compiled } = compileRules([
            rule('a', 'ceil(pax / 50)', { rule_code: 'a' }),
            rule('b', 'ceil(pax / 100)', { rule_code: 'b' }),
        ]);
        const a = runBaseline(feature, compiled);
        const b = runBaseline(feature, compiled);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});
