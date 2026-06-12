import { describe, it, expect } from 'vitest';
import { getTimeRule, getLiveRule, getLiveRuleBadges } from '../shift-ui';

// ─── Time Rules ────────────────────────────────────────────────────────────────

describe('getTimeRule - 5-state schedule lifecycle', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;

    it('Standard when start is more than 24h away', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+30 * HOUR), end_at: iso(+38 * HOUR) }))
            .toEqual({ label: 'Standard', color: '#3B82F6' });
    });

    it('Urgent when start is between 4h and 24h away', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+10 * HOUR), end_at: iso(+18 * HOUR) })?.label)
            .toBe('Urgent');
    });

    it('Emergent when start is within 4h', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+2 * HOUR), end_at: iso(+10 * HOUR) })?.label)
            .toBe('Emergent');
    });

    it('Live when now is between start and end', () => {
        expect(getTimeRule({ lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+2 * HOUR) })?.label)
            .toBe('Live');
    });

    it('Closed when now is after end', () => {
        expect(getTimeRule({ lifecycle_status: 'Completed', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('returns null when the start time is unparseable', () => {
        expect(getTimeRule({ lifecycle_status: 'Published' })).toBeNull();
    });
});

// ─── Live Rules ────────────────────────────────────────────────────────────────

describe('getLiveRuleBadges - two-badge arrival/departure model', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    const arrival = (s: Parameters<typeof getLiveRuleBadges>[0]) => getLiveRuleBadges(s).arrival?.label;
    const departure = (s: Parameters<typeof getLiveRuleBadges>[0]) => getLiveRuleBadges(s).departure?.label;

    // ── Pre-shift: arrival stand-in only, no departure ──────────────────────────
    it('Scheduled when upcoming and clock-in window not yet open', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(+5 * HOUR), end_at: iso(+13 * HOUR) };
        expect(arrival(s)).toBe('Scheduled');
        expect(departure(s)).toBeUndefined();
    });

    it('Awaiting Check-In when clock-in window open and not checked in', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(+30 * MIN), end_at: iso(+8 * HOUR) };
        expect(arrival(s)).toBe('Awaiting Check-In');
        expect(departure(s)).toBeUndefined();
    });

    // ── During shift: arrival quality, departure null until they leave ──────────
    it('Missing when shift started, no clock-in, not yet ended', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(-30 * MIN), end_at: iso(+4 * HOUR) };
        expect(arrival(s)).toBe('Missing');
        expect(departure(s)).toBeUndefined();
    });

    it('Early In with no departure while clocked in mid-shift', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR - 20 * MIN) };
        expect(arrival(s)).toBe('Early In');
        expect(departure(s)).toBeUndefined();
    });

    it('On Time In persists mid-shift when clocked in within grace', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR + 2 * MIN) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBeUndefined();
    });

    it('Late In persists mid-shift (arrival quality is kept)', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR + 20 * MIN) };
        expect(arrival(s)).toBe('Late In');
        expect(departure(s)).toBeUndefined();
    });

    // ── Completed: both halves present ──────────────────────────────────────────
    it('On Time In + On Time Out for a clean shift', () => {
        const s = { lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 1 * MIN), actual_end: iso(-1 * HOUR + 2 * MIN) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('On Time Out');
    });

    it('Late In + Early Out preserves both halves (no information lost)', () => {
        const s = { lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 20 * MIN), actual_end: iso(-2 * HOUR) };
        expect(arrival(s)).toBe('Late In');
        expect(departure(s)).toBe('Early Out');
    });

    it('Early In + Late Out for an over-committed shift', () => {
        const s = { lifecycle_status: 'Completed', start_at: iso(-9 * HOUR), end_at: iso(-2 * HOUR),
            actual_start: iso(-9 * HOUR - 15 * MIN), actual_end: iso(-1 * HOUR) };
        expect(arrival(s)).toBe('Early In');
        expect(departure(s)).toBe('Late Out');
    });

    // ── Exceptional ─────────────────────────────────────────────────────────────
    it('No Show carries an arrival badge and no departure', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) };
        expect(arrival(s)).toBe('No Show');
        expect(departure(s)).toBeUndefined();
    });

    it('Working Overtime departure when clocked in, past end, before auto threshold', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-9 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('Working Overtime');
    });

    it('Auto Clock-Out departure wins on attendance_status flag', () => {
        const s = { lifecycle_status: 'Completed', attendance_status: 'auto_clock_out',
            start_at: iso(-13 * HOUR), end_at: iso(-5 * HOUR), actual_start: iso(-13 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('Auto Clock-Out');
    });

    it('manual override re-derives both halves with a * suffix', () => {
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed', attendance_status: 'no_show',
            adjusted_is_manual: true,
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            adjusted_start: iso(-8 * HOUR + 20 * MIN), adjusted_end: iso(-2 * HOUR) });
        expect(badges.arrival?.label).toBe('Late In*');
        expect(badges.departure?.label).toBe('Early Out*');
    });

    it('auto/snapped billable times do NOT get a * (no manual override)', () => {
        // adjusted times present but not manually committed → derive from actual clock punches
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed',
            adjusted_is_manual: false,
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 2 * MIN), actual_end: iso(-1 * HOUR + 1 * MIN),
            adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR) });
        expect(badges.arrival?.label).toBe('On Time In');
        expect(badges.departure?.label).toBe('On Time Out');
    });

    it('returns both null when the start time is unparseable', () => {
        expect(getLiveRuleBadges({ lifecycle_status: 'Published' })).toEqual({ arrival: null, departure: null });
    });
});

describe('getLiveRule - single-badge adapter (departure wins over arrival)', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    it('surfaces the departure half once the employee has left', () => {
        expect(getLiveRule({ lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 20 * MIN), actual_end: iso(-2 * HOUR) })?.label).toBe('Early Out');
    });

    it('falls back to the arrival half mid-shift', () => {
        expect(getLiveRule({ lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR + 20 * MIN) })?.label).toBe('Late In');
    });

    it('keeps the * suffix so manual overrides are still detectable', () => {
        expect(getLiveRule({ lifecycle_status: 'Completed', attendance_status: 'no_show',
            adjusted_is_manual: true, start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            adjusted_start: iso(-8 * HOUR + 2 * MIN), adjusted_end: iso(-1 * HOUR + 2 * MIN) })?.label.endsWith('*'))
            .toBe(true);
    });
});
