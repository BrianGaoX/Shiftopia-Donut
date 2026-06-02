/**
 * Shift UI Context
 *
 * Pure logic layer — derives all display-relevant context from a shift's
 * FSM state + emergency_source + time-to-start.
 *
 * Rules:
 *  - State  → from getShiftFSMState() (canonical, never re-derived here)
 *  - Urgency → runtime TTS calculation (visual only, never affects actions)
 *  - Emergency label → from emergency_source column (historical, write-once)
 *  - Actions → from FSM state + Emergent policy (S1 restricted if TTS < 4h)
 *
 * IMPORTANT: Do NOT write emergency_source from UI.
 * Only backend assignment APIs (set_emergency_source) may write it.
 */

import {
    getShiftFSMState,
    FSM_STATE_META,
    type ShiftStateID,
    type ShiftFSMInput,
    type EmergencySource,
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
    scheduled_start: string | Date | null | undefined;
    /** UTC timestamp of the shift end — used to detect No Show */
    scheduled_end: string | Date | null | undefined;
    /** Actual clock-in time — used to detect "Late" (past start, not clocked in) */
    actual_start?: string | null | undefined;
    /** Written by backend assignment APIs — never set from UI */
    emergency_source: EmergencySource;
}

export interface ShiftUIContext {
    state: ShiftStateID;
    /** Seconds until shift starts (0 if already started) */
    ttsSec: number;
    /** TTS < 24h — visual indicator only */
    isUrgent: boolean;
    /** TTS < 4h — visual indicator only */
    isEmergency: boolean;
    /** Display label derived from emergency_source; null if not an emergency assignment */
    emergencyLabel: string | null;
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
    const start = shift.scheduled_start
        ? new Date(shift.scheduled_start).getTime()
        : 0;
    const ttsSec = start > 0 ? Math.max(0, Math.floor((start - now) / 1000)) : 0;

    const isUrgent    = ttsSec < 24 * 60 * 60;
    const isEmergency = ttsSec < 4  * 60 * 60;

    const emergencyLabel: string | null =
        shift.emergency_source === 'manual' ? 'Emergency'
        : shift.emergency_source === 'auto'  ? 'Auto Emergency'
        : null;

    const urgency: ShiftUrgency =
        ttsSec === 0         ? 'emergent'
        : ttsSec < 4  * 3600 ? 'emergent'
        : ttsSec < 24 * 3600 ? 'urgent'
        : 'normal';

    // ── Ring color — priority ordered ─────────────────────────────────────────
    // Purple  > Emerald > Yellow > Red > Orange > Blue
    const isPastStart = start > 0 && now > start;
    const isPastEnd = shift.scheduled_end ? now > new Date(shift.scheduled_end).getTime() : false;

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

    return { state, ttsSec, isUrgent, isEmergency, emergencyLabel, urgency, ringColor };
}

/**
 * Build ordered badge list for a shift card.
 *
 * Order: State → Trade → Emergency (historical) → Urgency (runtime) → Terminal
 *
 * Guardrail: if emergencyLabel is present, Urgent badge is suppressed
 * (historical context takes precedence over runtime TTS indicator).
 */
export function getBadges(ctx: ShiftUIContext): ShiftBadge[] {
    const badges: ShiftBadge[] = [];

    // State badge (always present)
    const meta = FSM_STATE_META[ctx.state];
    badges.push({ label: meta.label, tone: 'info' });

    // Trade badges coexist with state badge
    if (ctx.state === 'S9')  badges.push({ label: 'Trade Requested', tone: 'warning' });
    if (ctx.state === 'S10') badges.push({ label: 'Trade Accepted',  tone: 'warning' });

    // Emergency (historical — write-once field from DB)
    if (ctx.emergencyLabel) {
        badges.push({ label: ctx.emergencyLabel, tone: 'danger' });
    }

    // Urgency (runtime TTS — suppressed if emergency badge shown or in terminal state)
    const terminalStates = ['S13', 'S15'];
    if (!ctx.emergencyLabel && !terminalStates.includes(ctx.state)) {
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

// ─── Status dot ──────────────────────────────────────────────────────────────

export interface ShiftDotInput {
    lifecycle_status:   string;
    is_cancelled?:      boolean | null;
    assignment_outcome?: string | null;
    attendance_status?: string | null;
    actual_start?:      string | null;
    actual_end?:        string | null;
    start_at?:          string | null;
    end_at?:            string | null;
    shift_date?:        string | null;
    start_time?:        string | null;
    end_time?:          string | null;
    attendance_note?:   string | null;
    adjusted_start?:    string | null;
    adjusted_end?:      string | null;
}

export interface StatusBadge {
    color: string;
    label: string;
}

/**
 * Robustly parses standard ISO date strings or time-only strings (e.g. "14:00:00", "2:00 PM")
 * into milliseconds epoch time, or returns null if invalid.
 */
function parseToMs(dateStr: string | Date | null | undefined, shiftDate?: string | null): number | null {
    if (!dateStr || dateStr === '-') return null;
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

/**
 * Returns the status badge info (color + label) for the status dot and text
 * that replaces the left vertical strip on shift cards.
 *
 * One dot, one label, one color — same signal, clearer communication.
 */
export function getStatusDotInfo(shift: ShiftDotInput): StatusBadge | null {
    const lc = (shift.lifecycle_status || '').toLowerCase();
    const isCancelled = lc === 'cancelled' || shift.is_cancelled;

    // ── Check Override No-Show ───────────────────────────────────────────────
    const isOverridden = shift.attendance_note === 'No-Show overridden by manager' || 
                        (shift.attendance_status === 'unknown' && shift.attendance_note?.toLowerCase().includes('override'));

    if (isOverridden) {
        const schedEndMs = shift.end_at ? parseToMs(shift.end_at) : parseToMs(shift.end_time, shift.shift_date);
        const adjustedEndMs = parseToMs(shift.adjusted_end, shift.shift_date);
        const effectiveEndMs = adjustedEndMs ?? schedEndMs;
        if (effectiveEndMs !== null && schedEndMs !== null) {
            const diff = effectiveEndMs - schedEndMs;
            if (diff < 0) return { color: '#14B8A6', label: 'Overridden (Early-Out)' };
            if (diff > 0) return { color: '#6D28D9', label: 'Overridden (OverTime)' };
            return { color: '#8B5CF6', label: 'Overridden (OnTime)' };
        }
        return { color: '#8B5CF6', label: 'Overridden (OnTime)' };
    }

    // 1. No Show — checked first, can coexist with any lifecycle
    if (shift.assignment_outcome === 'no_show') {
        return { color: '#7F1D1D', label: 'No Show' };
    }

    // 2. Auto clock-out — system-enforced completion, overrides generic Completed
    if (shift.attendance_status === 'auto_clock_out') {
        return { color: '#A855F7', label: 'Completed - Auto Clock-Out' };
    }

    // 3. Cancelled → no dot
    if (isCancelled) return null;

    // ── Pre-calculate times ───────────────────────────────────────────────────
    const schedStartMs = shift.start_at ? parseToMs(shift.start_at) : parseToMs(shift.start_time, shift.shift_date);
    const schedEndMs = shift.end_at ? parseToMs(shift.end_at) : parseToMs(shift.end_time, shift.shift_date);

    const actualStartMs = parseToMs(shift.actual_start, shift.shift_date);
    const actualEndMs = parseToMs(shift.actual_end, shift.shift_date);
    const now = Date.now();

    // 3. Completed (has actual_end)
    // We check actual times REGARDLESS of lifecycle_status to fix UI lag
    if (actualEndMs !== null) {
        if (schedEndMs !== null) {
            const diff = actualEndMs - schedEndMs;
            if (diff < -5 * 60 * 1000) return { color: '#14B8A6', label: 'Completed (Early Exit)' };
            if (diff >  5 * 60 * 1000) return { color: '#6D28D9', label: 'Completed (Overtime)' };
            return { color: '#8B5CF6', label: 'Completed (On Time)' };
        }
        return { color: '#8B5CF6', label: 'Completed (On Time)' };
    }

    // 4. In Progress (has actual_start but no actual_end)
    if (actualStartMs !== null) {
        if (schedStartMs !== null) {
            const diff = actualStartMs - schedStartMs;
            if (diff < -5 * 60 * 1000) return { color: '#6366F1', label: 'In Progress (Early)' };
            if (diff >  5 * 60 * 1000) return { color: '#FBBF24', label: 'In Progress (Late)' };
        }
        return { color: '#10B981', label: 'In Progress (On Time)' };
    }

    // 5. Past start, no clock-in
    if (schedStartMs !== null && now > schedStartMs) {
        // Drafts past start get no dot
        if (lc === 'draft') return null;

        // If the shift has already ended and no clock-in was recorded, it's a No Show
        if (schedEndMs !== null && now > schedEndMs) {
            return { color: '#7F1D1D', label: 'No Show' };
        }
        
        // Any other shift that has passed its start time without clock-in is Late
        return { color: '#EAB308', label: 'Late (Missing)' };
    }

    // 6. Future/Current — TTS-based
    if (schedStartMs === null) return { color: '#3B82F6', label: 'Normal' };

    const ttsMs = schedStartMs - now;
    
    // Only apply urgency labels to future shifts
    if (ttsMs > 0 && ttsMs <= 4  * 60 * 60 * 1000) return { color: '#EF4444', label: 'Emergency' };
    if (ttsMs > 0 && ttsMs <= 24 * 60 * 60 * 1000) return { color: '#F59E0B', label: 'Urgent'    };
    
    // For anything further out, or any unhandled past edge cases
    return { color: '#3B82F6', label: 'Normal' };
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

