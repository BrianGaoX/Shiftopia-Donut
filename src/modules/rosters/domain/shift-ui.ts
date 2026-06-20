/**
 * Shift UI Context
 *
 * Pure logic layer — derives all display-relevant context from a shift's
 * FSM state + time-to-start.
 *
 * Rules:
 *  - State  → from getShiftFSMState() (canonical, never re-derived here)
 *  - Urgency → runtime TTS calculation (visual only, never affects actions)
 *  - Emergency label → runtime TTS calculation (TTS < 4h); there is no persisted
 *    emergency_source/is_urgent column — urgency & emergency are pure time facts.
 *  - Actions → from FSM state + Emergent policy (S1 restricted if TTS < 4h)
 */

import {
    getShiftFSMState,
    FSM_STATE_META,
    type ShiftStateID,
    type ShiftFSMInput,
} from './shift-fsm';
import { type ShiftUrgency } from './bidding-urgency';
import { 
    ShieldCheck, 
    Lock, 
    Edit, 
    Shield,
    Clock,
    CheckCircle2,
} from 'lucide-react';
import { type Shift } from './shift.entity';
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';

// ─── Tone ────────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

/**
 * Priority-ordered ring color for shift cards across all views.
 *
 * purple  — Completed (S13)
 * emerald — In Progress / clocked in (S11)
 * yellow  — Late: Published, past start time, no actual_start (clock-in missing)
 * red     — Emergent: TTS ≤ 4h
 * orange  — Urgent: TTS ≤ 24h
 * blue    — Normal: everything else
 */
export type RingColor = 'purple' | 'emerald' | 'yellow' | 'red' | 'orange' | 'blue' | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShiftUIContextInput extends ShiftFSMInput {
    /** UTC timestamp of the shift start — used for TTS calculation */
    scheduled_start?: string | Date | null | undefined;
    /** UTC timestamp of the shift end — used to detect No Show */
    scheduled_end?: string | Date | null | undefined;
    /** New UTC-at-Rest fields */
    start_at?: string | Date | null | undefined;
    end_at?: string | Date | null | undefined;
    /** Actual clock-in time — used to detect "Late" (past start, not clocked in) */
    actual_start?: string | null | undefined;
}

export interface ShiftUIContext {
    state: ShiftStateID;
    /** Seconds until shift starts (0 if already started) */
    ttsSec: number;
    /** TTS < 24h — visual indicator only */
    isUrgent: boolean;
    /** TTS < 4h — visual indicator only */
    isEmergency: boolean;
    /** TTS-based urgency — visual only, never gates actions */
    urgency: ShiftUrgency;
    /** Priority-ordered ring color for card borders/glows across all views */
    ringColor: RingColor;
}

export interface ShiftBadge {
    label: string;
    tone: BadgeTone;
}

export interface ShiftLockState {
    /** All fields locked — offer sent, in progress, terminal */
    fullyLocked: boolean;
    /** Schedule locked but notes/comments still editable */
    partialLock: boolean;
}

export type ShiftAction =
    | 'PUBLISH' | 'UNPUBLISH' | 'DELETE'
    | 'ASSIGN' | 'UNASSIGN'
    | 'ACCEPT' | 'REJECT'
    | 'SELECT_BID_WINNER' | 'EMERGENCY_ASSIGN'
    | 'SWAP_REQUEST' | 'CANCEL_REQUEST' | 'ACCEPT_TRADE' | 'REJECT_TRADE' | 'APPROVE_TRADE'
    | 'CLOCK_IN' | 'CLOCK_OUT' | 'MARK_NO_SHOW'
    | 'CANCEL';

export interface ProtectionContext {
    status: 'LOCKED' | 'PROTECTED' | 'DRAFT';
    label: string;
    isLocked: boolean;
    isProtected: boolean;
    icon: React.ComponentType<{ className?: string, size?: number | string }> | undefined;
    colorClass: string;
    icons: Array<{
        Icon: React.ComponentType<{ className?: string, size?: number | string }>;
        label: string;
        colorClass: string;
    }>;
}

export interface ShiftStatusIcon {
    icon: React.ComponentType<{ className?: string; size?: string | number }>;
    tooltip: string;
    color: string;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Derive all display context for a shift.
 * Single entry point — call this once per render, pass `ctx` to all sub-helpers.
 */
export function getShiftUIContext(shift: ShiftUIContextInput): ShiftUIContext {
    const state = getShiftFSMState(shift);

    const now  = Date.now();
    const startStr = shift.start_at ?? shift.scheduled_start;
    const endStr = shift.end_at ?? shift.scheduled_end;
    const start = startStr
        ? new Date(startStr).getTime()
        : 0;
    const ttsSec = start > 0 ? Math.max(0, Math.floor((start - now) / 1000)) : 0;

    const isUrgent    = ttsSec < 24 * 60 * 60;
    const isEmergency = ttsSec < 4  * 60 * 60;

    const urgency: ShiftUrgency =
        ttsSec === 0         ? 'emergent'
        : ttsSec < 4  * 3600 ? 'emergent'
        : ttsSec < 24 * 3600 ? 'urgent'
        : 'normal';

    // ── Ring color — priority ordered ─────────────────────────────────────────
    // Purple  > Emerald > Yellow > Red > Orange > Blue
    const isPastStart = start > 0 && now > start;
    const isPastEnd = endStr ? now > new Date(endStr).getTime() : false;

    const ringColor: RingColor = (() => {
        // Special case: Draft shifts past start_time should have NO strip
        if (shift.lifecycle_status === 'Draft' && isPastStart) return null;

        if (state === 'S13') return 'purple';                          // Completed
        if (state === 'S11') return 'emerald';                         // In Progress
        
        // Late / No Show detection logic
        if (
            isPastStart &&
            !shift.actual_start &&
            shift.lifecycle_status === 'Published'
        ) {
            // If the shift has ended, it's a No Show → Red (Danger)
            if (isPastEnd) return 'red';
            // Otherwise it's just Late → Yellow (Warning)
            return 'yellow';
        }

        if (urgency === 'emergent') return 'red';
        if (urgency === 'urgent')   return 'orange';
        return 'blue';
    })();

    return { state, ttsSec, isUrgent, isEmergency, urgency, ringColor };
}

/**
 * Build ordered badge list for a shift card.
 *
 * Order: State → Trade → Urgency (runtime TTS) → Terminal
 */
export function getBadges(ctx: ShiftUIContext): ShiftBadge[] {
    const badges: ShiftBadge[] = [];

    // State badge (always present)
    const meta = FSM_STATE_META[ctx.state];
    badges.push({ label: meta.label, tone: 'info' });

    // Trade badges coexist with state badge
    if (ctx.state === 'S9')  badges.push({ label: 'Trade Requested', tone: 'warning' });
    if (ctx.state === 'S10') badges.push({ label: 'Trade Accepted',  tone: 'warning' });

    // Urgency (runtime TTS — suppressed in terminal states)
    const terminalStates = ['S13', 'S15'];
    if (!terminalStates.includes(ctx.state)) {
        if (ctx.urgency === 'emergent') {
            badges.push({ label: 'Emergent', tone: 'danger' });
        } else if (ctx.urgency === 'urgent') {
            badges.push({ label: 'Urgent', tone: 'warning' });
        }
    }

    // Terminal states
    if (ctx.state === 'S13') badges.push({ label: 'Completed', tone: 'success' });
    if (ctx.state === 'S15') badges.push({ label: 'Cancelled', tone: 'neutral'  });

    return badges;
}

/**
 * Field-level lock state for a shift.
 *
 * S1/S2 (draft) → nothing locked
 * S4/S5/S9/S10 (published, active) → schedule locked, notes editable
 * S3/S11/S13/S15 → fully locked
 */
export function getLockState(state: ShiftStateID | string): ShiftLockState {
    if (state === 'S1' || state === 'S2') {
        return { fullyLocked: false, partialLock: false };
    }
    // S3, S4, S5, S9, S10 (published, active) — schedule locked, notes editable
    if (state === 'S3' || state === 'S4' || state === 'S5' || state === 'S9' || state === 'S10') {
        return { fullyLocked: false, partialLock: true };
    }
    // S11, S13, S15 — fully locked
    return { fullyLocked: true, partialLock: false };
}

/**
 * Get protection and lock state context for a shift
 */
export function getProtectionContext(
    shift: Partial<Shift>, 
    isPast: boolean
): ProtectionContext {
    const status = (shift.lifecycle_status || '').toLowerCase();
    const tsStatus = (shift.timesheet_status || '').toLowerCase();
    const attStatus = (shift.attendance_status || '').toLowerCase();

    const icons: ProtectionContext['icons'] = [];

    // 1. Clock Icon: Finalized or No Show
    const isNoShow = attStatus === 'no_show' || tsStatus === 'no_show';
    const isFinalized = ['submitted', 'verified', 'approved', 'rejected'].includes(tsStatus);

    if (isFinalized || isNoShow) {
        icons.push({ 
            Icon: Clock, 
            label: isNoShow ? 'No Show' : 'Finalized',
            colorClass: 'text-slate-400'
        });
    }

    // 2. Shield Icon: Published
    if (status === 'published' || status === 'completed') {
        icons.push({ 
            Icon: Shield, 
            label: 'Published',
            colorClass: 'text-slate-400'
        });
    }

    // 3. Lock Icon: Past
    if (isPast) {
        icons.push({ 
            Icon: Lock, 
            label: 'Past',
            colorClass: 'text-slate-400'
        });
    }

    // Legacy return for backward compatibility if still used as single object
    // Default to the most "important" state for the legacy fields
    if (isPast) {
        return {
            status: 'LOCKED',
            label: 'Locked',
            isLocked: true,
            isProtected: false,
            icon: Lock,
            colorClass: 'text-slate-500',
            icons
        };
    }

    if (status === 'published' || status === 'completed') {
        return {
            status: 'PROTECTED',
            label: 'Protected',
            isLocked: false,
            isProtected: true,
            icon: Shield,
            colorClass: 'text-slate-400',
            icons
        };
    }

    return {
        status: 'DRAFT',
        label: 'Open',
        isLocked: false,
        isProtected: false,
        icon: undefined,
        colorClass: '',
        icons
    };
}

/**
 * Derives specific status icons for Roster Planner cards.
 * 
 * 1. Lock -> Past shifts (now())
 * 2. Shield -> Published & Future shifts
 * 3. CheckCircle2 -> Finalized timesheets (approved/rejected/no_show)
 */
export function getShiftStatusIcons(shift: Partial<Shift>): ShiftStatusIcon[] {
    const icons: ShiftStatusIcon[] = [];
    const now = Date.now();
    const schedStartMs = shift.start_at ? new Date(shift.start_at).getTime() : 
                        (shift.shift_date && shift.start_time ? parseZonedDateTime(shift.shift_date, shift.start_time).getTime() : null);
    const schedEndMs = shift.end_at ? new Date(shift.end_at).getTime() :
                      (shift.shift_date && shift.end_time ? parseZonedDateTime(shift.shift_date, shift.end_time).getTime() : null);
    
    // Use the actual end time if available, otherwise scheduled end
    const effectiveEndMs = shift.actual_end ? new Date(shift.actual_end).getTime() : (schedEndMs || 0);
    
    // A shift is considered "Past" (Locked) as soon as it starts for Manager view
    // But for general status, we use start time for the Lock icon consistency
    const isPast = schedStartMs && now > schedStartMs;

    // 1. Clock for Finalized or No Show
    const tsStatus = (shift.timesheet_status || '').toLowerCase();
    const attStatus = (shift.attendance_status || '').toLowerCase();
    const isNoShow = attStatus === 'no_show' || tsStatus === 'no_show';
    const isFinalized = ['submitted', 'verified', 'approved', 'rejected'].includes(tsStatus);

    if (isFinalized || isNoShow) {
        icons.push({
            icon: Clock,
            tooltip: isNoShow ? 'No Show' : 'Finalized',
            color: 'text-slate-400'
        });
    }

    // 2. Lock for Past shifts
    if (isPast) {
        icons.push({
            icon: Lock,
            tooltip: 'Past shift (Locked)',
            color: 'text-slate-400'
        });
    }

    // 3. Shield for Published shifts
    const status = (shift.lifecycle_status || '').toLowerCase();
    if (status === 'published' || status === 'completed') {
        icons.push({
            icon: Shield,
            tooltip: 'Published (Protected)',
            color: 'text-slate-400'
        });
    }

    return icons;
}

// ─── Time Rules & Live Rules ───────────────────────────────────────────────────
//
export interface ShiftDotInput {
    shift_date?:        string | null;
    start_time?:        string | null;
    end_time?:          string | null;
    attendance_note?:   string | null;
    adjusted_start?:    string | null;
    adjusted_end?:      string | null;
    actual_start?:      string | null;
    actual_end?:        string | null;
    start_at?:          string | Date | null;
    end_at?:            string | Date | null;
    attendance_status?: string | null;
    lifecycle_status?:  string | null;
    is_cancelled?:      boolean | null;
    /**
     * True when `adjusted_start`/`adjusted_end` were manually committed by a
     * manager override (vs. auto/snapped billable times). This is the single
     * canonical signal that drives the `*` suffix, so it must be plumbed
     * identically on every surface (roster, my-roster, timesheets).
     */
    adjusted_is_manual?: boolean;
}

/**
 * Robustly parses standard ISO date strings or time-only strings (e.g. "14:00:00", "2:00 PM")
 * into milliseconds epoch time, or returns null if invalid.
 */
function parseToMs(dateStr: string | Date | null | undefined, shiftDate?: string | null): number | null {
    if (!dateStr || dateStr === '-') return null;
    if (dateStr instanceof Date) {
        return isNaN(dateStr.getTime()) ? null : dateStr.getTime();
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.getTime();
    
    if (shiftDate && typeof dateStr === 'string') {
        let timePart = dateStr;
        if (/^\d{3,4}$/.test(timePart)) {
            timePart = timePart.length === 3 
                ? `0${timePart.slice(0, 1)}:${timePart.slice(1)}:00`
                : `${timePart.slice(0, 2)}:${timePart.slice(2)}:00`;
        } else if (timePart.split(':').length === 2) {
            timePart = `${timePart}:00`;
        }

        if (dateStr.includes('AM') || dateStr.includes('PM')) {
            const match = dateStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
            if (match) {
                let hour = parseInt(match[1], 10);
                const min = match[2];
                const ampm = match[3].toUpperCase();
                if (ampm === 'PM' && hour < 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                timePart = `${hour.toString().padStart(2, '0')}:${min}:00`;
            }
        }
        const combined = new Date(`${shiftDate}T${timePart}`);
        if (!isNaN(combined.getTime())) return combined.getTime();
    }
    return null;
}

// Two NEW, independent nomenclatures shown together on every shift card
// (Rosters / My Roster / Timesheets). They are derived purely from the shift's
// schedule + attendance records.
//
//  • Time Rules → 5-state lifecycle from the clock vs scheduled start/end.
//  • Live Rules → 13-state attendance lifecycle from clock-in/clock-out + time.
//
// Several "impossible" attendance states (missing/invalid/multiple clock-ins,
// etc.) are intentionally NOT modelled — the platform's clock-in window,
// single clock-in/out, and 12.5h auto clock-out constraints prevent them.

const GRACE_MS = 5 * 60 * 1000;             // on-time tolerance (spec default)
const CLOCKIN_WINDOW_MS = 60 * 60 * 1000;   // clock-in opens 1h before start
const AUTO_CLOCKOUT_MS = 12.5 * 60 * 60 * 1000;

export type TimeRule = 'Standard' | 'Urgent' | 'Emergent' | 'Live' | 'Closed';

/** Arrival half of the two-badge Live Rules model. */
export type ArrivalRule =
    | 'Scheduled' | 'Awaiting Check-In' | 'Missing' | 'No Show'
    | 'Early In' | 'On Time In' | 'Late In';

/** Departure half of the two-badge Live Rules model. */
export type DepartureRule =
    | 'Early Out' | 'On Time Out' | 'Late Out'
    | 'Working Overtime' | 'Auto Clock-Out';

export type LiveRule = ArrivalRule | DepartureRule;

export interface ShiftRuleBadge {
    label: TimeRule | LiveRule | string;
    color: string;
}

/**
 * The two-badge Live Rules result. `arrival` is present in every live state;
 * `departure` only appears once the employee has left, run into overtime, or
 * been auto-clocked-out. A genuine No Show carries an arrival badge and no
 * departure.
 */
export interface LiveRuleBadges {
    arrival: ShiftRuleBadge | null;
    departure: ShiftRuleBadge | null;
}

// ─── Live Rule palette ─────────────────────────────────────────────────────────
const LR = {
    scheduled: '#3B82F6', // blue     — upcoming, clock-in window not yet open
    awaiting:  '#0EA5E9', // sky      — clock-in window open, not checked in
    missing:   '#EAB308', // yellow   — started, no clock-in, not yet ended
    noShow:    '#7F1D1D', // dark red — ended, never clocked in
    earlyIn:   '#6366F1', // indigo
    onTimeIn:  '#22C55E', // green
    lateIn:    '#F59E0B', // amber
    earlyOut:  '#14B8A6', // teal
    onTimeOut: '#22C55E', // green
    lateOut:   '#8B5CF6', // violet
    overtime:  '#F97316', // orange
    autoOut:   '#A855F7', // purple
} as const;

/** Classify a clock-in time against scheduled start. `suffix` marks overrides. */
function classifyArrival(ci: number, start: number, suffix = ''): ShiftRuleBadge {
    if (ci < start - GRACE_MS) return { label: `Early In${suffix}`,   color: LR.earlyIn };
    if (ci > start + GRACE_MS) return { label: `Late In${suffix}`,    color: LR.lateIn };
    return { label: `On Time In${suffix}`, color: LR.onTimeIn };
}

/** Classify a clock-out time against scheduled end. `suffix` marks overrides. */
function classifyDeparture(co: number, end: number, suffix = ''): ShiftRuleBadge {
    if (co < end - GRACE_MS) return { label: `Early Out${suffix}`,   color: LR.earlyOut };
    if (co > end + GRACE_MS) return { label: `Late Out${suffix}`,    color: LR.lateOut };
    return { label: `On Time Out${suffix}`, color: LR.onTimeOut };
}

/**
 * Time Rules — 5-state lifecycle derived purely from the clock vs the
 * scheduled start/end. Independent of attendance. Returns null when the start
 * time can't be parsed.
 */
export function getTimeRule(shift: ShiftDotInput): ShiftRuleBadge | null {
    const start = shift.start_at ? parseToMs(shift.start_at) : parseToMs(shift.start_time, shift.shift_date);
    const end = shift.end_at ? parseToMs(shift.end_at) : parseToMs(shift.end_time, shift.shift_date);
    if (start === null) return null;

    const now = Date.now();

    if (now >= start) {
        // After start: Live until end, Closed once ended. If end is unparseable,
        // fall back to the auto clock-out horizon so the card never sticks on Live.
        const effectiveEnd = end ?? start + AUTO_CLOCKOUT_MS;
        return now < effectiveEnd
            ? { label: 'Live', color: '#10B981' }    // emerald
            : { label: 'Closed', color: '#64748B' }; // slate
    }

    const tts = start - now;
    if (tts <= 4 * 60 * 60 * 1000)  return { label: 'Emergent', color: '#EF4444' }; // red
    if (tts <= 24 * 60 * 60 * 1000) return { label: 'Urgent',   color: '#F59E0B' }; // amber
    return { label: 'Standard', color: '#3B82F6' };                                 // blue
}

/**
 * Live Rules — two-badge attendance model, fully independent of Time Rules.
 *
 * Returns an {@link LiveRuleBadges} pair so the card can tell the whole story
 * without collapsing information:
 *
 *   • `arrival`   — quality of the clock-in (or the pre-/post-shift stand-in:
 *                   Scheduled / Awaiting Check-In / Missing / No Show).
 *   • `departure` — quality of the clock-out, or Working Overtime / Auto
 *                   Clock-Out. Stays null while the employee is still clocked
 *                   in mid-shift and on a genuine No Show.
 *
 * e.g. a late arrival who leaves early reads `Late In` + `Early Out` instead
 * of the old single-badge model that only surfaced `Early Clock-Out`.
 *
 * Returns `{ arrival: null, departure: null }` when the start time can't be
 * parsed.
 */
export function getLiveRuleBadges(shift: ShiftDotInput): LiveRuleBadges {
    const empty: LiveRuleBadges = { arrival: null, departure: null };
    const start = shift.start_at ? parseToMs(shift.start_at) : parseToMs(shift.start_time, shift.shift_date);
    const end = shift.end_at ? parseToMs(shift.end_at) : parseToMs(shift.end_time, shift.shift_date);
    if (start === null) return empty;

    const now = Date.now();
    const effectiveEnd = end ?? start + AUTO_CLOCKOUT_MS;

    // ── Manager override ──────────────────────────────────────────────────────
    // When a manager has manually committed billable times (the only case where
    // `adjusted_is_manual` is set), those times are the source of truth. Both
    // halves are re-derived from them and marked with `*`. This is the single
    // canonical override signal — identical on every surface — so the `*` only
    // ever reflects a finalized manual override, never auto/snapped billable.
    if (shift.adjusted_is_manual && shift.adjusted_start && shift.adjusted_end) {
        const adjIn = parseToMs(shift.adjusted_start, shift.shift_date);
        const adjOut = parseToMs(shift.adjusted_end, shift.shift_date);
        if (adjIn !== null && adjOut !== null) {
            return {
                arrival: classifyArrival(adjIn, start, '*'),
                departure: end !== null ? classifyDeparture(adjOut, end, '*') : null,
            };
        }
    }

    const ci = parseToMs(shift.actual_start, shift.shift_date);   // clock-in
    const co = parseToMs(shift.actual_end, shift.shift_date);     // clock-out

    // ── Never clocked in — arrival stand-in only ──────────────────────────────
    if (ci === null) {
        if (now > effectiveEnd) return { arrival: { label: 'No Show', color: LR.noShow }, departure: null };
        if (now > start)        return { arrival: { label: 'Missing', color: LR.missing }, departure: null };
        if (now >= start - CLOCKIN_WINDOW_MS) return { arrival: { label: 'Awaiting Check-In', color: LR.awaiting }, departure: null };
        return { arrival: { label: 'Scheduled', color: LR.scheduled }, departure: null };
    }

    // ── Clocked in — arrival quality is fixed for the rest of the shift ───────
    const arrival = classifyArrival(ci, start);

    // ── Departure half ────────────────────────────────────────────────────────
    let departure: ShiftRuleBadge | null = null;
    if (shift.attendance_status === 'auto_clock_out') {
        departure = { label: 'Auto Clock-Out', color: LR.autoOut };
    } else if (co !== null) {
        departure = end !== null ? classifyDeparture(co, end) : { label: 'On Time Out', color: LR.onTimeOut };
    } else if (now > effectiveEnd && now < start + AUTO_CLOCKOUT_MS) {
        departure = { label: 'Working Overtime', color: LR.overtime };
    }
    // else: still clocked in mid-shift → no departure badge yet

    return { arrival, departure };
}

/**
 * Single-badge Live Rule — backward-compatible adapter over
 * {@link getLiveRuleBadges}. Surfaces the most significant half (departure
 * quality wins over arrival), preserving the `*` override suffix for callers
 * that detect overridden No-Shows by it. Prefer `getLiveRuleBadges` in UI.
 */
export function getLiveRule(shift: ShiftDotInput): ShiftRuleBadge | null {
    const { arrival, departure } = getLiveRuleBadges(shift);
    return departure ?? arrival;
}

/**
 * Terminal-attendance gate for manager timesheet review.
 *
 * A manager may only approve / reject / edit a timesheet once the shift has
 * reached a definitive attendance outcome — i.e. one of:
 *
 *   • No-Show          — the shift ended and the employee never clocked in
 *   • Clock-Out exists — the employee clocked out (`actual_end` recorded)
 *   • Auto Clock-Out   — the system auto-closed the shift at the 12.5h horizon
 *
 * Every non-terminal Live Rule state must block review:
 *   Scheduled · Awaiting Check-In · Missing · (still clocked in mid-shift) ·
 *   Working Overtime.
 *
 * Derived from the same {@link getLiveRuleBadges} engine the badges use, so the
 * gate a manager hits and the badge they see can never disagree. Time-dependent
 * (a "Missing" shift becomes a reviewable "No Show" once it ends), exactly like
 * the badges.
 */
export function isTimesheetReviewable(shift: ShiftDotInput): boolean {
    // An explicitly-marked no-show is always terminal, regardless of clocks.
    if ((shift.attendance_status ?? '').toLowerCase() === 'no_show') return true;

    const { arrival, departure } = getLiveRuleBadges(shift);

    // No-Show stand-in: ended, never clocked in.
    if (arrival?.label === 'No Show') return true;

    // A departure badge is present for a real clock-out, an Auto Clock-Out, or
    // Working Overtime. Only Working Overtime is non-terminal (ended but still
    // clocked in with no auto-out yet), so it alone must NOT unlock review.
    if (departure && departure.label !== 'Working Overtime') return true;

    return false;
}

/**
 * Available FSM actions for a given state.
 * This is the single source of truth for action menus.
 * 
 * NOTE: As of 2026-04-02, S1 (Draft-Unassigned) publication is restricted 
 * to non-emergent shifts only. Emergent S1 shifts must be assigned (to S2) 
 * before they can be published (triggers direct-to-confirmed).
 */
export function getAvailableActions(state: ShiftStateID | string, urgency?: ShiftUrgency): ShiftAction[] {
    switch (state) {
        case 'S1': {
            const actions: ShiftAction[] = ['ASSIGN', 'DELETE'];
            if (urgency !== 'emergent') {
                actions.push('PUBLISH');
            }
            return actions;
        }
        case 'S2':  return ['UNASSIGN', 'PUBLISH', 'DELETE'];
        case 'S3':  return ['ACCEPT', 'REJECT', 'UNPUBLISH', 'CANCEL'];
        case 'S4':  return ['SWAP_REQUEST', 'EMERGENCY_ASSIGN', 'UNPUBLISH', 'CLOCK_IN', 'CANCEL'];
        case 'S5':  return ['SELECT_BID_WINNER', 'EMERGENCY_ASSIGN', 'UNPUBLISH', 'CANCEL'];
        case 'S9':  return ['CANCEL_REQUEST', 'ACCEPT_TRADE', 'REJECT_TRADE'];
        case 'S10': return ['APPROVE_TRADE', 'REJECT_TRADE'];
        case 'S11': return ['CLOCK_OUT', 'MARK_NO_SHOW', 'CANCEL'];
        case 'S13': return [];
        case 'S15': return [];
        default:    return [];
    }
}

