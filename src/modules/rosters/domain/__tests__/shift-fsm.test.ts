/**
 * shift-fsm.test.ts
 *
 * Unit tests for:
 *   - getShiftFSMState      (all 10 valid states + edge cases)
 *   - getLockState
 *   - getAvailableActions
 *   - getBadges
 *
 * All tests are pure — no mocking, no network calls.
 */

import { describe, it, expect } from 'vitest';

import {
    getShiftFSMState,
    FSM_STATE_META,
    type ShiftFSMInput,
    type ShiftStateID,
} from '../shift-fsm';

import {
    getBadges,
    getLockState,
    getAvailableActions,
    type ShiftUIContext,
} from '../shift-ui';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ShiftFSMInput; all optional fields default to safe values. */
function fsmInput(overrides: Partial<ShiftFSMInput> & { lifecycle_status?: string }): ShiftFSMInput {
    return {
        lifecycle_status:   'Draft',
        assignment_status:  'unassigned',
        assignment_outcome: null,
        trading_status:     null,
        is_cancelled:       false,
        ...overrides,
    };
}

function assertState(input: Partial<ShiftFSMInput>, expected: ShiftStateID) {
    expect(getShiftFSMState(fsmInput(input))).toBe(expected);
}

// ─── 1. getShiftFSMState — all 10 valid states ───────────────────────────────

describe('getShiftFSMState — 10 canonical states', () => {

    it('S1  — Draft + unassigned', () => {
        assertState({ lifecycle_status: 'Draft', assignment_status: 'unassigned' }, 'S1');
    });

    it('S2  — Draft + assigned', () => {
        assertState({ lifecycle_status: 'Draft', assignment_status: 'assigned' }, 'S2');
    });

    it('S3  — Published + assigned + outcome=null', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: null,
        }, 'S3');
    });

    it('S4  — Published + assigned + outcome=confirmed', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S4');
    });

    it('S5  — Published + unassigned', () => {
        assertState({
            lifecycle_status:  'Published',
            assignment_status: 'unassigned',
        }, 'S5');
    });

    it('S9  — Published + assigned + confirmed + TradeRequested', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeRequested',
        }, 'S9');
    });

    it('S10 — Published + assigned + confirmed + TradeAccepted', () => {
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeAccepted',
        }, 'S10');
    });

    it('S11 — InProgress + assigned + confirmed', () => {
        assertState({
            lifecycle_status:   'InProgress',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S11');
    });

    it('S13 — Completed + assigned + confirmed', () => {
        assertState({
            lifecycle_status:   'Completed',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S13');
    });

    it('S15 — is_cancelled=true (any other fields)', () => {
        assertState({
            lifecycle_status:   'Draft',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            is_cancelled:       true,
        }, 'S15');
    });
});

// ─── 2. Edge cases ────────────────────────────────────────────────────────────

describe('getShiftFSMState — edge cases', () => {

    it('assignment_outcome=no_show + InProgress → S11 (lifecycle wins)', () => {
        // The FSM returns S11 for any InProgress shift regardless of outcome value;
        // no_show does not route to a different state here.
        assertState({
            lifecycle_status:   'InProgress',
            assignment_status:  'assigned',
            assignment_outcome: 'no_show',
        }, 'S11');
    });

    it('emergency_source present → does NOT affect derived state (S4 still S4)', () => {
        // emergency_source is not part of ShiftFSMInput — it lives on ShiftUIContextInput only.
        // We verify by building a plain confirmed Published shift and checking S4.
        assertState({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
        }, 'S4');
    });

    it('bidding_status=on_bidding_urgent (legacy) → still S5 (bidding_status not an FSM input)', () => {
        // ShiftFSMInput has no bidding_status field; FSM ignores it entirely.
        // A Published + unassigned shift is always S5.
        assertState({
            lifecycle_status:  'Published',
            assignment_status: 'unassigned',
        }, 'S5');
    });

    it('is_cancelled=true + lifecycle_status=Completed → S15 (cancelled overrides everything)', () => {
        assertState({
            lifecycle_status:   'Completed',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            is_cancelled:       true,
        }, 'S15');
    });

    it('S9 takes precedence over S4 (trade overrides assignment outcome)', () => {
        // Even though assignment_outcome=confirmed, trading_status=TradeRequested → S9
        const result = getShiftFSMState(fsmInput({
            lifecycle_status:   'Published',
            assignment_status:  'assigned',
            assignment_outcome: 'confirmed',
            trading_status:     'TradeRequested',
        }));
        expect(result).toBe('S9');
        expect(result).not.toBe('S4');
    });

    it('invalid combination (empty lifecycle_status) → returns UNKNOWN', () => {
        // FSM no longer throws; it warns and returns the neutral 'UNKNOWN' fallback
        // so the UI can render a placeholder card instead of crashing the boundary.
        expect(getShiftFSMState(fsmInput({ lifecycle_status: '' }))).toBe('UNKNOWN');
    });
});

// ─── 3. getLockState ─────────────────────────────────────────────────────────

describe('getLockState', () => {

    it('S1 → { fullyLocked: false, partialLock: false }', () => {
        expect(getLockState('S1')).toEqual({ fullyLocked: false, partialLock: false });
    });

    it('S2 → { fullyLocked: false, partialLock: false }', () => {
        expect(getLockState('S2')).toEqual({ fullyLocked: false, partialLock: false });
    });

    it('S4 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S4')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S5 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S5')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S9 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S9')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S10 → { fullyLocked: false, partialLock: true }', () => {
        expect(getLockState('S10')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S3  → { fullyLocked: false, partialLock: true } (published, schedule-locked but notes editable)', () => {
        expect(getLockState('S3')).toEqual({ fullyLocked: false, partialLock: true });
    });

    it('S11 → { fullyLocked: true, partialLock: false }', () => {
        expect(getLockState('S11')).toEqual({ fullyLocked: true, partialLock: false });
    });

    it('S13 → { fullyLocked: true, partialLock: false }', () => {
        expect(getLockState('S13')).toEqual({ fullyLocked: true, partialLock: false });
    });

    it('S15 → { fullyLocked: true, partialLock: false }', () => {
        expect(getLockState('S15')).toEqual({ fullyLocked: true, partialLock: false });
    });
});

// ─── 5. getAvailableActions ───────────────────────────────────────────────────

describe('getAvailableActions', () => {

    it('S1 → includes PUBLISH, ASSIGN, DELETE', () => {
        const actions = getAvailableActions('S1');
        expect(actions).toContain('PUBLISH');
        expect(actions).toContain('ASSIGN');
        expect(actions).toContain('DELETE');
    });

    it('S5 → includes EMERGENCY_ASSIGN, SELECT_BID_WINNER', () => {
        const actions = getAvailableActions('S5');
        expect(actions).toContain('EMERGENCY_ASSIGN');
        expect(actions).toContain('SELECT_BID_WINNER');
    });

    it('S13 → empty array', () => {
        expect(getAvailableActions('S13')).toEqual([]);
    });

    it('S15 → empty array', () => {
        expect(getAvailableActions('S15')).toEqual([]);
    });

    it('S2 → includes UNASSIGN, PUBLISH, DELETE (not ASSIGN)', () => {
        const actions = getAvailableActions('S2');
        expect(actions).toContain('UNASSIGN');
        expect(actions).toContain('PUBLISH');
        expect(actions).toContain('DELETE');
        expect(actions).not.toContain('ASSIGN');
    });

    it('S9 → includes CANCEL_REQUEST, ACCEPT_TRADE, REJECT_TRADE', () => {
        const actions = getAvailableActions('S9');
        expect(actions).toContain('CANCEL_REQUEST');
        expect(actions).toContain('ACCEPT_TRADE');
        expect(actions).toContain('REJECT_TRADE');
    });

    it('S10 → includes APPROVE_TRADE, REJECT_TRADE', () => {
        const actions = getAvailableActions('S10');
        expect(actions).toContain('APPROVE_TRADE');
        expect(actions).toContain('REJECT_TRADE');
    });

    it('S11 → includes CLOCK_OUT, MARK_NO_SHOW', () => {
        const actions = getAvailableActions('S11');
        expect(actions).toContain('CLOCK_OUT');
        expect(actions).toContain('MARK_NO_SHOW');
    });

    it('unknown state → empty array (safe fallback)', () => {
        expect(getAvailableActions('S99')).toEqual([]);
    });
});

// ─── 6. getBadges ─────────────────────────────────────────────────────────────

/** Build a ShiftUIContext directly without calling getShiftFSMState inside a test. */
function ctx(overrides: Partial<ShiftUIContext> & { state: ShiftStateID }): ShiftUIContext {
    return {
        ttsSec:         0,
        isUrgent:       false,
        isEmergency:    false,
        urgency:        'normal',
        ringColor:      'none',
        ...overrides,
    } as ShiftUIContext;
}

describe('getBadges', () => {

    it('S5 + urgency=urgent → includes badge with label "Urgent"', () => {
        const badges = getBadges(ctx({ state: 'S5', isUrgent: true, urgency: 'urgent' }));
        const labels = badges.map(b => b.label);
        expect(labels).toContain('Urgent');
    });

    it('S4 + urgency=urgent → includes "Urgent" badge (urgency is pure TTS, no emergency suppression)', () => {
        const badges = getBadges(ctx({ state: 'S4', isUrgent: true, urgency: 'urgent' }));
        const labels = badges.map(b => b.label);
        expect(labels).toContain('Urgent');
    });

    it('S9 → includes "Trade Requested" badge', () => {
        const badges = getBadges(ctx({ state: 'S9' }));
        const labels = badges.map(b => b.label);
        expect(labels).toContain('Trade Requested');
    });

    it('S13 → includes "Completed" success badge', () => {
        const badges = getBadges(ctx({ state: 'S13' }));
        // The state badge (tone='info') and the terminal badge (tone='success') both use the label
        // from FSM_STATE_META['S13'].label === 'Completed'. We check that a success-tone one exists.
        const successBadge = badges.find(b => b.tone === 'success');
        expect(successBadge).toBeDefined();
        expect(successBadge!.label).toBe('Completed');
    });

    it('S15 → includes "Cancelled" neutral badge', () => {
        const badges = getBadges(ctx({ state: 'S15' }));
        // Same situation: 'Cancelled' appears as both state badge (info) and terminal badge (neutral).
        const neutralBadge = badges.find(b => b.tone === 'neutral');
        expect(neutralBadge).toBeDefined();
        expect(neutralBadge!.label).toBe('Cancelled');
    });

    it('always starts with a state badge matching FSM_STATE_META label', () => {
        const stateId: ShiftStateID = 'S4';
        const badges = getBadges(ctx({ state: stateId }));
        expect(badges[0].label).toBe(FSM_STATE_META[stateId].label);
    });

    it('S10 → includes "Trade Accepted" badge', () => {
        const badges = getBadges(ctx({ state: 'S10' }));
        const labels = badges.map(b => b.label);
        expect(labels).toContain('Trade Accepted');
    });

    it('S5 + isUrgent=false → does NOT include "Urgent" badge', () => {
        const badges = getBadges(ctx({ state: 'S5', isUrgent: false }));
        const labels = badges.map(b => b.label);
        expect(labels).not.toContain('Urgent');
    });

    it('S5 + urgency=emergent → includes "Emergent" badge', () => {
        const badges = getBadges(ctx({ state: 'S5', urgency: 'emergent' }));
        const labels = badges.map(b => b.label);
        expect(labels).toContain('Emergent');
    });

    it('state badge tone is always "info"', () => {
        const stateIds: ShiftStateID[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S9', 'S10', 'S11', 'S13', 'S15'];
        for (const stateId of stateIds) {
            const badges = getBadges(ctx({ state: stateId }));
            expect(badges[0].tone).toBe('info');
        }
    });
});
