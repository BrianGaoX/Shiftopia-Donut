/**
 * SwapComplianceReviewModal
 *
 * Unified 3-step compliance review for shift swaps.
 * Works as a drop-in replacement for SwapComplianceModal.
 *
 * Step 1 — EXCHANGE:  Shows both shifts being traded (times, roles, duration)
 * Step 2 — ANALYSIS:  Runs solver → displays results grouped by severity bucket
 *                     A: Blockers | B: Warnings | C: Passed | D: System
 * Step 3 — DECISION:  Final verdict + action buttons
 *
 * Key improvements over SwapComplianceModal:
 *   ✓ No raw JSON dumps — all calculation data rendered as human-readable cards
 *   ✓ Bucket classification (A/B/C/D) with visual hierarchy
 *   ✓ Per-employee status strips with before→after hour context
 *   ✓ Student visa enforcement status sourced from solver calculation
 *   ✓ Deterministic: same input → same output every time
 *   ✓ Symmetrical: both employees shown correctly side-by-side
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import {
    CheckCircle2, XCircle, AlertTriangle, Circle, Shield,
    ArrowLeftRight, Loader2, Clock, Zap, Layers,
    BadgeCheck, FileCheck, ChevronDown, Send, RefreshCw,
    AlertOctagon, X, Moon, Calendar, TimerIcon,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { Dialog, DialogPortal, DialogOverlay } from '@/modules/core/ui/primitives/dialog';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/modules/core/ui/primitives/drawer';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { cn } from '@/modules/core/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import {
    swapEvaluator,
    ConstraintViolation,
    getScenarioWindow,
} from '@/modules/compliance';
import type { SolverResult } from '@/modules/compliance/v8/swap-engine/types';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';

// =============================================================================
// TYPES
// =============================================================================

interface ShiftData {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
    role_name?: string;
    department_name?: string;
}

interface RosterShift {
    id?: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
}

export interface SwapComplianceReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Offerer's shift — the shift being offered to the requester (B gives this). */
    offeredShift: ShiftData | null;
    /** Requester's shift — the shift the requester is giving away (A gives this). */
    requesterShift: ShiftData | null;
    requesterId: string | null;
    requesterName: string;
    offererId: string | null;
    offererName: string;
    onConfirmOffer: () => void;
    isSubmitting?: boolean;
}

type Step = 'exchange' | 'analysis' | 'decision';
type Bucket = 'A' | 'B' | 'C' | 'D';

interface GroupedConstraint {
    id: string;
    name: string;
    bucket: Bucket;
    requesterResult: ConstraintViolation | undefined;
    offererResult: ConstraintViolation | undefined;
    /** Row-level worst status */
    rowStatus: 'pass' | 'fail' | 'warning' | 'pending';
    blocking: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

const calcNetHours = (s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number => {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0)) / 60;
};

const calcNetMinutes = (s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number =>
    Math.round(calcNetHours(s) * 60);

/** Adapt a raw DB/ShiftData row to the V8Shift shape required by swapEvaluator */
function toV8Shift(s: { id: string; shift_date: string; start_time: string; end_time: string; unpaid_break_minutes?: number }) {
    return {
        id: s.id,
        date: s.shift_date,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        unpaid_break_minutes: s.unpaid_break_minutes,
        is_ordinary_hours: true as const,
    };
}

const fmtTime = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtDate = (d: string) => {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch { return d; }
};

const getInitials = (name: string) => {
    const p = name.trim().split(' ');
    return p.length >= 2 ? `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
};

/** Classify a constraint into a severity bucket. */
function getBucket(id: string, status: string, blocking: boolean): Bucket {
    // D — System (qualification / role checks — always their own category)
    if (['ROLE_CONTRACT_MATCH', 'QUALIFICATION_MATCH', 'QUALIFICATION_EXPIRY'].includes(id)) return 'D';
    // A — Blockers (hard failures)
    if (status === 'fail' && blocking) return 'A';
    // B — Warnings / soft failures
    if (status === 'fail' || status === 'warning') return 'B';
    // C — Passed / informational
    return 'C';
}

function overallRowStatus(
    req: ConstraintViolation | undefined,
    off: ConstraintViolation | undefined,
): 'pass' | 'fail' | 'warning' | 'pending' {
    const statuses = [req?.status, off?.status].filter(Boolean) as string[];
    if (statuses.includes('fail')) return 'fail';
    if (statuses.includes('warning')) return 'warning';
    if (statuses.includes('pass')) return 'pass';
    return 'pending';
}

/** Extract structured groups from solver all_results */
function groupConstraints(
    allResults: ConstraintViolation[],
    requesterId: string,
    offererId: string,
): GroupedConstraint[] {
    const map = new Map<string, { name: string; req?: ConstraintViolation; off?: ConstraintViolation }>();

    for (const r of allResults) {
        if (!map.has(r.constraint_id)) map.set(r.constraint_id, { name: r.constraint_name });
        const entry = map.get(r.constraint_id)!;
        if (r.employee_id === requesterId) entry.req = r;
        else if (r.employee_id === offererId) entry.off = r;
    }

    return Array.from(map.entries()).map(([id, { name, req, off }]) => {
        const rowStatus = overallRowStatus(req, off);
        const blocking = (req?.blocking || off?.blocking) ?? false;
        return {
            id,
            name,
            bucket: getBucket(id, rowStatus, blocking),
            requesterResult: req,
            offererResult: off,
            rowStatus,
            blocking,
        };
    });
}

// =============================================================================
// ICON HELPERS
// =============================================================================

function constraintIcon(id: string) {
    switch (id) {
        case 'NO_OVERLAP': return <Layers className="h-4 w-4" />;
        case 'MAX_DAILY_HOURS': return <Clock className="h-4 w-4" />;
        case 'MIN_REST_GAP': return <Moon className="h-4 w-4" />;
        case 'STUDENT_VISA_48H': return <Zap className="h-4 w-4" />;
        case 'WORKING_DAYS_CAP': return <Calendar className="h-4 w-4" />;
        case 'AVG_FOUR_WEEK_CYCLE': return <TimerIcon className="h-4 w-4" />;
        case 'ROLE_CONTRACT_MATCH': return <FileCheck className="h-4 w-4" />;
        case 'QUALIFICATION_MATCH':
        case 'QUALIFICATION_EXPIRY': return <BadgeCheck className="h-4 w-4" />;
        default: return <Shield className="h-4 w-4" />;
    }
}

function StatusIcon({ status, size = 4 }: { status: string; size?: number }) {
    const cls = `h-${size} w-${size}`;
    if (status === 'pass')    return <CheckCircle2 className={cn(cls, 'text-emerald-500')} />;
    if (status === 'fail')    return <XCircle      className={cn(cls, 'text-rose-500')} />;
    if (status === 'warning') return <AlertTriangle className={cn(cls, 'text-amber-500')} />;
    return <Circle className={cn(cls, 'text-muted-foreground/30')} />;
}

function StatusBadge({ status, label }: { status: string; label: string }) {
    const cls = status === 'pass'    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
                status === 'fail'    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' :
                status === 'warning' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                                      'bg-muted/50 text-muted-foreground/40 border-border';
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider', cls)}>
            {label}
        </span>
    );
}

// =============================================================================
// CONSTRAINT DETAIL RENDERER — no JSON dumps
// =============================================================================

function ConstraintDetailPanel({ violation }: { violation: ConstraintViolation }) {
    const calc = violation.calculation as Record<string, any>;
    const id = violation.constraint_id;

    if (violation.status === 'pass') {
        return (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {violation.details || 'All checks passed.'}
            </div>
        );
    }

    // AVG_FOUR_WEEK_CYCLE — rolling window breakdown
    if (id === 'AVG_FOUR_WEEK_CYCLE') {
        const weeklyLimit = calc.weekly_limit ?? 38;
        type CycleEntry = { weeks: number; total_hours: number; limit: number; average_weekly_hours: number; status: string };
        const cycles: CycleEntry[] = calc.all_cycles ?? [{
            weeks: calc.cycle_weeks ?? 4,
            total_hours: calc.total_hours ?? 0,
            limit: calc.limit ?? 0,
            average_weekly_hours: calc.average_weekly_hours ?? 0,
            status: violation.status,
        }];
        return (
            <div className="space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
                    Rolling window check · max {weeklyLimit}h/wk avg
                </div>
                {cycles.map(c => {
                    const isFail = c.status === 'fail';
                    return (
                        <div key={c.weeks} className={cn('p-3 rounded-lg border', isFail ? 'bg-rose-500/5 border-rose-500/20' : 'bg-muted/30 border-border')}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{c.weeks}-Week window</span>
                                {isFail && <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase tracking-widest">EXCEEDS LIMIT</span>}
                            </div>
                            <div className="flex items-baseline gap-3">
                                <span className={cn('text-2xl font-black', isFail ? 'text-rose-500' : 'text-foreground')}>{c.total_hours.toFixed(1)}h</span>
                                <span className="text-xs text-muted-foreground/50">avg {c.average_weekly_hours.toFixed(1)}h/wk · limit {c.limit}h ({weeklyLimit}h/wk × {c.weeks}wk)</span>
                            </div>
                            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className={cn('h-full rounded-full', isFail ? 'bg-rose-500' : 'bg-emerald-500')}
                                    style={{ width: `${Math.min((c.total_hours / c.limit) * 100, 100)}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // STUDENT_VISA_48H — fortnight window breakdown
    if (id === 'STUDENT_VISA_48H') {
        const limit = calc.limit ?? 48;
        const isEnforced = calc.enforcement_enabled ?? false;
        const hasWeeks = calc.weeks && typeof calc.weeks === 'object' && !Array.isArray(calc.weeks);
        const weeksData = hasWeeks ? calc.weeks as Record<string, { hours: number; dates: string }> : {};
        const weekKeys = Object.keys(weeksData).sort();
        const windows: Array<{ weeks: string[]; hours: number; status: string }> = calc.windows_evaluated ?? [];
        const violations: Array<{ weeks: string[]; hours: number }> = calc.violations ?? [];
        const violatingWeeks = new Set<string>(violations.flatMap(v => v.weeks));
        const worstWindow = windows.reduce((best, w) => w.hours > (best?.hours ?? 0) ? w : best, windows[0]);

        return (
            <div className="space-y-3">
                <div className={cn('flex items-center gap-2 p-3 rounded-lg border text-xs',
                    isEnforced ? 'bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-300' : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300')}>
                    <Zap className="h-4 w-4 shrink-0" />
                    <span>
                        <strong>Limit: {limit}h / fortnight</strong>
                        {isEnforced
                            ? ' — Enforcement ON (blocking)'
                            : ' — Enforcement OFF (warning only, set via Users › Work Rights)'}
                    </span>
                </div>

                {worstWindow && (
                    <div className={cn('p-3 rounded-lg border', violation.status === 'fail' ? 'bg-rose-500/10 border-rose-500/30' : 'bg-amber-500/10 border-amber-500/30')}>
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1">Peak fortnight</div>
                        <div className="flex items-baseline gap-2">
                            <span className={cn('text-2xl font-black', violation.status === 'fail' ? 'text-rose-500' : 'text-amber-500')}>
                                {worstWindow.hours.toFixed(1)}h
                            </span>
                            <span className="text-xs text-muted-foreground/60">of {limit}h limit</span>
                            {worstWindow.hours > limit && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase tracking-widest ml-2">
                                    +{(worstWindow.hours - limit).toFixed(1)}h over
                                </span>
                            )}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                            {worstWindow.weeks.join(' + ')}
                        </div>
                    </div>
                )}

                {weekKeys.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 px-1">Weekly breakdown</div>
                        {weekKeys.map(wk => {
                            const w = weeksData[wk];
                            const isViolating = violatingWeeks.has(wk);
                            return (
                                <div key={wk} className="flex items-center gap-3">
                                    <div className="w-20 shrink-0">
                                        <div className={cn('text-[10px] font-black', isViolating ? 'text-rose-500' : 'text-muted-foreground')}>
                                            {wk.split('-W').pop() ? `W${wk.split('-W').pop()}` : wk}
                                        </div>
                                        <div className="text-[9px] text-muted-foreground/40">{w.dates}</div>
                                    </div>
                                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                        <div className={cn('h-full rounded-full', isViolating ? 'bg-rose-500' : 'bg-muted-foreground/30')}
                                            style={{ width: `${Math.min((w.hours / Math.max(limit, w.hours)) * 100, 100)}%` }} />
                                    </div>
                                    <span className={cn('w-10 text-right text-xs font-black', isViolating ? 'text-rose-500' : 'text-foreground')}>{w.hours}h</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // MAX_DAILY_HOURS — daily bar
    if (id === 'MAX_DAILY_HOURS') {
        const existing = calc.existing_hours ?? 0;
        const candidate = calc.candidate_hours ?? 0;
        const total = calc.total_hours ?? 0;
        const limit = calc.limit ?? 10;
        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Daily projection (limit: {limit}h)</span>
                </div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                        <span className="w-24">Existing shifts</span>
                        <span className="font-black text-foreground">{existing.toFixed(1)}h</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                        <span className="w-24">Received shift</span>
                        <span className="font-black text-foreground">+{candidate.toFixed(1)}h</span>
                    </div>
                    <div className={cn('flex items-center gap-2 text-xs font-black', total > limit ? 'text-rose-500' : 'text-emerald-500')}>
                        <span className="w-24">Total projected</span>
                        <span className="text-lg">{total.toFixed(1)}h</span>
                        {total > limit && <span className="text-[9px] ml-1">(+{(total - limit).toFixed(1)}h over)</span>}
                    </div>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', total > limit ? 'bg-rose-500' : 'bg-emerald-500')}
                        style={{ width: `${Math.min((total / limit) * 100, 100)}%` }} />
                </div>
            </div>
        );
    }

    // MIN_REST_GAP
    if (id === 'MIN_REST_GAP') {
        const prev = calc.prev_day_gap_hours as number | null;
        const next = calc.next_day_gap_hours as number | null;
        const limit = calc.limit ?? 10;
        return (
            <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Min rest gap: {limit}h required</div>
                <div className="grid grid-cols-2 gap-2">
                    {[{ label: 'Before shift', val: prev }, { label: 'After shift', val: next }].map(({ label, val }) => {
                        const fail = val != null && val < limit;
                        return (
                            <div key={label} className={cn('p-3 rounded-lg border text-center', fail ? 'bg-rose-500/5 border-rose-500/20' : val != null ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-muted/30 border-border')}>
                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1">{label}</div>
                                {val != null
                                    ? <div className={cn('text-xl font-black', fail ? 'text-rose-500' : 'text-emerald-500')}>{val.toFixed(1)}h</div>
                                    : <div className="text-muted-foreground/30 text-sm">–</div>}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // WORKING_DAYS_CAP
    if (id === 'WORKING_DAYS_CAP') {
        const days = calc.days_worked ?? 0;
        const limit = calc.limit ?? 20;
        const period = calc.period_days ?? 28;
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Working days in last {period} days</span>
                </div>
                <div className={cn('text-3xl font-black', violation.status === 'fail' ? 'text-rose-500' : 'text-foreground')}>
                    {days}<span className="text-sm font-bold text-muted-foreground/40 ml-1">/ {limit} max</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', violation.status === 'fail' ? 'bg-rose-500' : 'bg-emerald-500')}
                        style={{ width: `${Math.min((days / limit) * 100, 100)}%` }} />
                </div>
            </div>
        );
    }

    // NO_OVERLAP
    if (id === 'NO_OVERLAP') {
        return (
            <div className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
                <Layers className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{violation.details || 'Schedule conflict detected. These shifts overlap in time.'}</span>
            </div>
        );
    }

    // QUALIFICATION checks — show violation list
    if (['ROLE_CONTRACT_MATCH', 'QUALIFICATION_MATCH', 'QUALIFICATION_EXPIRY'].includes(id)) {
        const qViolations = (calc.violations as any[]) ?? [];
        return (
            <div className="space-y-2">
                {qViolations.length > 0
                    ? qViolations.map((v: any, i: number) => (
                        <div key={i} className={cn('flex items-start gap-2 p-3 rounded-lg border text-xs',
                            v.type?.includes('EXPIRED') ? 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-300')}>
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{v.message}</span>
                        </div>
                    ))
                    : <div className="text-xs text-muted-foreground italic">{violation.details}</div>
                }
            </div>
        );
    }

    // Fallback — human-readable, no JSON
    return (
        <div className="space-y-2">
            {violation.summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{violation.summary}</p>
            )}
            {violation.details && violation.details !== violation.summary && (
                <p className="text-xs text-muted-foreground/70 italic leading-relaxed">{violation.details}</p>
            )}
            {/* Key numbers from calculation — rendered as pills, never as JSON */}
            <div className="flex flex-wrap gap-2 mt-2">
                {typeof calc.existing_hours === 'number' && <NumberPill label="Current" value={`${calc.existing_hours.toFixed(1)}h`} />}
                {typeof calc.candidate_hours === 'number' && <NumberPill label="Added" value={`+${calc.candidate_hours.toFixed(1)}h`} />}
                {typeof calc.total_hours === 'number' && <NumberPill label="After" value={`${calc.total_hours.toFixed(1)}h`} highlight={violation.status === 'fail'} />}
                {typeof calc.limit === 'number' && <NumberPill label="Limit" value={`${calc.limit}h`} />}
                {typeof calc.average_weekly_hours === 'number' && <NumberPill label="Avg/wk" value={`${calc.average_weekly_hours.toFixed(1)}h`} highlight={violation.status === 'fail'} />}
            </div>
        </div>
    );
}

function NumberPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={cn('px-2 py-1 rounded-md border text-center', highlight ? 'bg-rose-500/5 border-rose-500/20' : 'bg-muted/50 border-border')}>
            <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">{label}</div>
            <div className={cn('text-xs font-black', highlight ? 'text-rose-500' : 'text-foreground')}>{value}</div>
        </div>
    );
}

// =============================================================================
// CONSTRAINT ROW
// =============================================================================

function ConstraintRow({ constraint, requesterName, offererName }: {
    constraint: GroupedConstraint;
    requesterName: string;
    offererName: string;
}) {
    const [expanded, setExpanded] = useState(
        constraint.rowStatus === 'fail' || constraint.rowStatus === 'warning'
    );

    const borderCls = constraint.rowStatus === 'fail'    ? 'border-rose-500/20 bg-rose-500/5' :
                      constraint.rowStatus === 'warning' ? 'border-amber-500/20 bg-amber-500/5' :
                                                           'border-border bg-card/30';

    const hasDetails = constraint.requesterResult || constraint.offererResult;

    return (
        <div className={cn('rounded-xl border transition-all duration-200', borderCls)}>
            <button
                onClick={() => hasDetails && setExpanded(e => !e)}
                className={cn('w-full flex items-center gap-3 px-4 py-3 text-left', !hasDetails && 'cursor-default')}
            >
                <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center border shrink-0',
                    constraint.rowStatus === 'fail' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' :
                    constraint.rowStatus === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                    constraint.rowStatus === 'pass' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                    'bg-muted border-border text-muted-foreground/40')}>
                    {constraint.rowStatus === 'pass' ? <CheckCircle2 className="h-4 w-4" /> : constraintIcon(constraint.id)}
                </div>
                <span className="flex-1 text-[12px] font-bold text-foreground text-left">{constraint.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-muted-foreground/40 uppercase">{requesterName.split(' ')[0]}</span>
                        <StatusBadge status={constraint.requesterResult?.status ?? 'pass'}
                            label={constraint.requesterResult?.status ?? '—'} />
                    </div>
                    <span className="text-muted-foreground/20 text-[10px]">·</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-muted-foreground/40 uppercase">{offererName.split(' ')[0]}</span>
                        <StatusBadge status={constraint.offererResult?.status ?? 'pass'}
                            label={constraint.offererResult?.status ?? '—'} />
                    </div>
                    {hasDetails && <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground/30 transition-transform', expanded && 'rotate-180')} />}
                </div>
            </button>

            <AnimatePresence>
                {expanded && hasDetails && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="border-t border-border/30 px-4 pb-4 pt-3 space-y-4">
                            {[
                                { label: requesterName, result: constraint.requesterResult },
                                { label: offererName,   result: constraint.offererResult },
                            ].map(({ label, result }) => result && result.status !== 'pass' && (
                                <div key={label}>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1.5">[{label}]</div>
                                    <ConstraintDetailPanel violation={result} />
                                </div>
                            ))}
                            {/* If both pass, show one combined pass message */}
                            {constraint.rowStatus === 'pass' && constraint.requesterResult && (
                                <ConstraintDetailPanel violation={constraint.requesterResult} />
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// =============================================================================
// BUCKET SECTION
// =============================================================================

const BUCKET_META: Record<Bucket, { label: string; color: string; dot: string }> = {
    A: { label: 'BLOCKERS', color: 'text-rose-500',    dot: 'bg-rose-500 animate-pulse' },
    B: { label: 'WARNINGS', color: 'text-amber-500',   dot: 'bg-amber-500' },
    C: { label: 'PASSED',   color: 'text-emerald-500', dot: 'bg-emerald-500' },
    D: { label: 'SYSTEM',   color: 'text-blue-500',    dot: 'bg-blue-500' },
};

function BucketSection({ bucket, constraints, requesterName, offererName }: {
    bucket: Bucket;
    constraints: GroupedConstraint[];
    requesterName: string;
    offererName: string;
}) {
    if (constraints.length === 0) return null;
    const meta = BUCKET_META[bucket];
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
                <div className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                <span className={cn('text-[9px] font-black uppercase tracking-[0.2em]', meta.color)}>
                    Bucket {bucket} — {meta.label}
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
            </div>
            {constraints.map(c => (
                <ConstraintRow key={c.id} constraint={c} requesterName={requesterName} offererName={offererName} />
            ))}
        </div>
    );
}

// =============================================================================
// SHIFT CARD (used in Pane 1) — uses SharedShiftCard for visual consistency
// =============================================================================

function ShiftCard({ shift, label, color }: { shift: ShiftData; label: string; color: 'indigo' | 'emerald' }) {
    const clr = color === 'indigo'
        ? { border: 'border-indigo-500/20', accent: 'text-indigo-600 dark:text-indigo-400', dot: 'bg-indigo-500', divider: 'border-indigo-500/10' }
        : { border: 'border-emerald-500/20', accent: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', divider: 'border-emerald-500/10' };

    return (
        <div className={cn('rounded-2xl border flex-1 overflow-hidden', clr.border)}>
            <div className={cn('text-[9px] font-black uppercase tracking-widest py-2 px-4 flex items-center gap-1.5 border-b', clr.accent, clr.divider)}>
                <div className={cn('h-1.5 w-1.5 rounded-full', clr.dot)} />
                {label}
            </div>
            <SharedShiftCard
                variant="timecard"
                isFlat={true}
                organization=""
                department={shift.department_name || ''}
                role={shift.role_name || 'Shift'}
                shiftDate={fmtDate(shift.shift_date)}
                startTime={fmtTime(shift.start_time)}
                endTime={fmtTime(shift.end_time)}
                netLength={calcNetMinutes(shift)}
                paidBreak={0}
                unpaidBreak={shift.unpaid_break_minutes ?? 0}
            />
        </div>
    );
}

// =============================================================================
// EMPLOYEE SUMMARY STRIP
// =============================================================================

function EmployeeSummaryStrip({ name, overallStatus, constraints }: {
    name: string;
    overallStatus: 'pass' | 'fail' | 'warning';
    constraints: GroupedConstraint[];
}) {
    const blockers = constraints.filter(c => c.rowStatus === 'fail' && c.blocking && (c.requesterResult?.employee_name === name || c.offererResult?.employee_name === name));
    const warnings = constraints.filter(c => (c.rowStatus === 'warning' || (c.rowStatus === 'fail' && !c.blocking)) && (c.requesterResult?.employee_name === name || c.offererResult?.employee_name === name));

    // Find hours data from AVG_FOUR_WEEK_CYCLE or MAX_DAILY_HOURS
    const hoursConstraint = constraints.find(c => c.id === 'AVG_FOUR_WEEK_CYCLE' || c.id === 'MAX_DAILY_HOURS');
    const myHoursResult = hoursConstraint?.requesterResult?.employee_name === name
        ? hoursConstraint?.requesterResult : hoursConstraint?.offererResult?.employee_name === name
        ? hoursConstraint?.offererResult : undefined;
    const calc = myHoursResult?.calculation as Record<string, any> | undefined;
    const existingH = calc?.existing_hours;
    const totalH = calc?.total_hours;

    const statusCls = overallStatus === 'pass' ? 'border-emerald-500/20 bg-emerald-500/5' :
                      overallStatus === 'fail'  ? 'border-rose-500/20 bg-rose-500/5' :
                                                  'border-amber-500/20 bg-amber-500/5';

    return (
        <div className={cn('rounded-xl border px-4 py-3 flex items-center gap-3', statusCls)}>
            <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className={cn('text-[10px] font-black text-white',
                    overallStatus === 'pass' ? 'bg-emerald-600' : overallStatus === 'fail' ? 'bg-rose-600' : 'bg-amber-600')}>
                    {getInitials(name)}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black text-foreground truncate">{name}</div>
                <div className="text-[9px] text-muted-foreground/50 font-mono uppercase tracking-widest">
                    {blockers.length > 0 ? `${blockers.length} blocker${blockers.length > 1 ? 's' : ''}` :
                     warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` :
                     'All clear'}
                </div>
            </div>
            {existingH != null && totalH != null && (
                <div className="text-right shrink-0">
                    <div className="text-[9px] text-muted-foreground/40 font-mono uppercase tracking-wider">hrs (excl. given → after swap)</div>
                    <div className={cn('text-xs font-black', overallStatus === 'fail' ? 'text-rose-500' : 'text-foreground')}>
                        {existingH.toFixed(1)}h → {totalH.toFixed(1)}h
                    </div>
                </div>
            )}
            <StatusIcon status={overallStatus} size={5} />
        </div>
    );
}

// =============================================================================
// STEP INDICATOR
// =============================================================================

function StepIndicator({ current }: { current: Step }) {
    const steps: { key: Step; label: string }[] = [
        { key: 'exchange', label: 'Exchange' },
        { key: 'analysis', label: 'Analysis' },
        { key: 'decision', label: 'Decision' },
    ];
    const idx = steps.findIndex(s => s.key === current);

    return (
        <div className="flex items-center gap-0 px-8 py-3 border-b border-border/40 bg-muted/20">
            {steps.map((step, i) => (
                <div key={step.key} className="flex items-center">
                    <div className="flex items-center gap-1.5">
                        <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-black border transition-all',
                            i < idx  ? 'bg-primary border-primary text-primary-foreground' :
                            i === idx ? 'bg-primary/10 border-primary text-primary' :
                                        'bg-muted border-border text-muted-foreground/40')}>
                            {i < idx ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                        </div>
                        <span className={cn('text-[10px] font-black uppercase tracking-widest',
                            i <= idx ? 'text-foreground' : 'text-muted-foreground/40')}>
                            {step.label}
                        </span>
                    </div>
                    {i < steps.length - 1 && (
                        <div className={cn('h-px w-8 mx-2', i < idx ? 'bg-primary' : 'bg-border/50')} />
                    )}
                </div>
            ))}
        </div>
    );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function SwapComplianceReviewModal({
    isOpen,
    onClose,
    offeredShift,
    requesterShift,
    requesterId,
    requesterName,
    offererId,
    offererName,
    onConfirmOffer,
    isSubmitting = false,
}: SwapComplianceReviewModalProps) {
    const isMobile = useIsMobile();
    const [step, setStep] = useState<Step>('exchange');
    const [isRunning, setIsRunning] = useState(false);
    const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // ------------------------------------------------------------------
    // Roster fetches
    // ------------------------------------------------------------------

    const { data: requesterRosterRaw = [] } = useQuery({
        queryKey: ['swapCompliance.reqRoster', requesterId, offeredShift?.shift_date],
        queryFn: async (): Promise<RosterShift[]> => {
            if (!requesterId || !offeredShift?.shift_date) return [];
            const { start, end } = getScenarioWindow(offeredShift.shift_date);
            const { data, error } = await supabase.from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', requesterId)
                .gte('shift_date', start).lte('shift_date', end)
                .is('deleted_at', null).is('is_cancelled', false);
            if (error) return [];
            return (data || []).map(r => ({
                id: r.id,
                shift_date: r.shift_date,
                start_time: r.start_time,
                end_time: r.end_time,
                unpaid_break_minutes: r.unpaid_break_minutes ?? undefined,
            }));
        },
        enabled: isOpen && !!requesterId && !!offeredShift?.shift_date,
    });
    const requesterRoster: RosterShift[] = requesterRosterRaw;

    const { data: offererRosterRaw = [] } = useQuery({
        queryKey: ['swapCompliance.offRoster', offererId, requesterShift?.shift_date],
        queryFn: async (): Promise<RosterShift[]> => {
            if (!offererId || !requesterShift?.shift_date) return [];
            const { start, end } = getScenarioWindow(requesterShift.shift_date);
            const { data, error } = await supabase.from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', offererId)
                .gte('shift_date', start).lte('shift_date', end)
                .is('deleted_at', null).is('is_cancelled', false);
            if (error) return [];
            return (data || []).map(r => ({
                id: r.id,
                shift_date: r.shift_date,
                start_time: r.start_time,
                end_time: r.end_time,
                unpaid_break_minutes: r.unpaid_break_minutes ?? undefined,
            }));
        },
        enabled: isOpen && !!offererId && !!requesterShift?.shift_date,
    });
    const offererRoster: RosterShift[] = offererRosterRaw;

    // ------------------------------------------------------------------
    // Reset on close
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!isOpen) {
            setStep('exchange');
            setSolverResult(null);
            setErrorMsg(null);
            setIsRunning(false);
        }
    }, [isOpen]);

    // ------------------------------------------------------------------
    // Run compliance checks
    // ------------------------------------------------------------------

    const runChecks = useCallback(async () => {
        if (!offeredShift || !requesterShift || !requesterId || !offererId) return;

        setIsRunning(true);
        setErrorMsg(null);
        setSolverResult(null);

        try {
            await new Promise(r => setTimeout(r, 200));

            // Layer 1-3: constraint solver
            const result = swapEvaluator.evaluate({
                partyA: {
                    employee_id: requesterId,
                    name: requesterName,
                    current_shifts: requesterRoster.map(toV8Shift),
                    shift_to_give: toV8Shift(requesterShift),
                },
                partyB: {
                    employee_id: offererId,
                    name: offererName,
                    current_shifts: offererRoster.map(toV8Shift),
                    shift_to_give: toV8Shift(offeredShift),
                },
            });

            // Layer 4: server-side qualification checks
            let finalResult: SolverResult = result;
            try {
                const [reqQual, offQual] = await Promise.all([
                    validateCompliance({
                        employeeId: requesterId,
                        shiftDate: offeredShift.shift_date,
                        startTime: offeredShift.start_time,
                        endTime: offeredShift.end_time,
                        netLengthMinutes: calcNetMinutes(offeredShift),
                        shiftId: offeredShift.id,
                        excludeV8ShiftId: requesterShift.id,
                    }),
                    validateCompliance({
                        employeeId: offererId,
                        shiftDate: requesterShift.shift_date,
                        startTime: requesterShift.start_time,
                        endTime: requesterShift.end_time,
                        netLengthMinutes: calcNetMinutes(requesterShift),
                        shiftId: requesterShift.id,
                        excludeV8ShiftId: offeredShift.id,
                    }),
                ]);

                const QUAL_FILTERS: Record<string, (v: any) => boolean> = {
                    ROLE_CONTRACT_MATCH:   v => v.type === 'ROLE_MISMATCH',
                    QUALIFICATION_MATCH:   v => v.type === 'SKILL_MISSING'  || v.type === 'LICENSE_MISSING',
                    QUALIFICATION_EXPIRY:  v => v.type === 'SKILL_EXPIRED'  || v.type === 'LICENSE_EXPIRED',
                };
                const QUAL_NAMES: Record<string, string> = {
                    ROLE_CONTRACT_MATCH:  'Role Contract Match',
                    QUALIFICATION_MATCH:  'Qualification & Certification',
                    QUALIFICATION_EXPIRY: 'Qualification Expiry',
                };

                const extraResults: ConstraintViolation[] = [];
                for (const [cid, filter] of Object.entries(QUAL_FILTERS)) {
                    const reqV = reqQual.qualificationViolations.filter(filter);
                    const offV = offQual.qualificationViolations.filter(filter);
                    const reqStatus: 'fail' | 'pass' = reqV.length > 0 ? 'fail' : 'pass';
                    const offStatus: 'fail' | 'pass' = offV.length > 0 ? 'fail' : 'pass';
                    extraResults.push(
                        { id: cid, constraint_id: cid, name: QUAL_NAMES[cid], constraint_name: QUAL_NAMES[cid],
                          employee_id: requesterId, employee_name: requesterName,
                          status: reqStatus, summary: reqV.length > 0 ? `${reqV.length} issue(s)` : 'Passed',
                          details: reqV.map((v: any) => v.message).join('\n'), calculation: { violations: reqV }, blocking: true },
                        { id: cid, constraint_id: cid, name: QUAL_NAMES[cid], constraint_name: QUAL_NAMES[cid],
                          employee_id: offererId, employee_name: offererName,
                          status: offStatus, summary: offV.length > 0 ? `${offV.length} issue(s)` : 'Passed',
                          details: offV.map((v: any) => v.message).join('\n'), calculation: { violations: offV }, blocking: true },
                    );
                }

                // Server-authoritative overlap override
                const reqOverlap = reqQual.violations.some(v => v.toLowerCase().includes('overlap'));
                const offOverlap = offQual.violations.some(v => v.toLowerCase().includes('overlap'));
                const existingOverlap = result.all_results.filter(r => r.constraint_id === 'NO_OVERLAP');
                const noOverlapResults: ConstraintViolation[] = (reqOverlap || offOverlap)
                    ? [
                        { id: 'NO_OVERLAP', constraint_id: 'NO_OVERLAP', name: 'No Overlapping Shifts', constraint_name: 'No Overlapping Shifts',
                          employee_id: requesterId, employee_name: requesterName,
                          status: reqOverlap ? 'fail' : 'pass', summary: reqOverlap ? 'Overlap confirmed by server' : 'No overlap',
                          details: reqOverlap ? 'Server confirmed a schedule conflict for this employee.' : '', calculation: {}, blocking: true },
                        { id: 'NO_OVERLAP', constraint_id: 'NO_OVERLAP', name: 'No Overlapping Shifts', constraint_name: 'No Overlapping Shifts',
                          employee_id: offererId, employee_name: offererName,
                          status: offOverlap ? 'fail' : 'pass', summary: offOverlap ? 'Overlap confirmed by server' : 'No overlap',
                          details: offOverlap ? 'Server confirmed a schedule conflict for this employee.' : '', calculation: {}, blocking: true },
                      ]
                    : existingOverlap;

                const withoutOverlapAndQual = result.all_results.filter(r =>
                    r.constraint_id !== 'NO_OVERLAP' &&
                    !Object.keys(QUAL_FILTERS).includes(r.constraint_id)
                );
                const newAllResults = [...withoutOverlapAndQual, ...noOverlapResults, ...extraResults];
                const newViolations = newAllResults.filter(r => r.status === 'fail');
                finalResult = {
                    ...result,
                    feasible: newViolations.filter(v => v.blocking).length === 0,
                    violations: newViolations,
                    all_results: newAllResults,
                };
            } catch {
                // Server unavailable — solver result stands
            }

            setSolverResult(finalResult);
            setStep('analysis');
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Compliance check failed.');
        } finally {
            setIsRunning(false);
        }
    }, [offeredShift, requesterShift, requesterId, offererId,
        requesterName, offererName, requesterRoster, offererRoster]);

    // ------------------------------------------------------------------
    // Derived state
    // ------------------------------------------------------------------

    const grouped = useMemo<GroupedConstraint[]>(() => {
        if (!solverResult || !requesterId || !offererId) return [];
        return groupConstraints(solverResult.all_results, requesterId, offererId);
    }, [solverResult, requesterId, offererId]);

    const byBucket = useMemo(() => {
        const map: Record<Bucket, GroupedConstraint[]> = { A: [], B: [], C: [], D: [] };
        for (const c of grouped) map[c.bucket].push(c);
        return map;
    }, [grouped]);

    const canProceed = solverResult?.feasible === true;
    const blockingViolations = solverResult?.violations.filter(v => v.blocking) ?? [];

    const requesterOverall: 'pass' | 'fail' | 'warning' = useMemo(() => {
        const myResults = grouped.flatMap(c => [c.requesterResult]).filter(Boolean) as ConstraintViolation[];
        if (myResults.some(r => r.status === 'fail' && r.blocking)) return 'fail';
        if (myResults.some(r => r.status === 'fail' || r.status === 'warning')) return 'warning';
        return 'pass';
    }, [grouped]);

    const offererOverall: 'pass' | 'fail' | 'warning' = useMemo(() => {
        const myResults = grouped.flatMap(c => [c.offererResult]).filter(Boolean) as ConstraintViolation[];
        if (myResults.some(r => r.status === 'fail' && r.blocking)) return 'fail';
        if (myResults.some(r => r.status === 'fail' || r.status === 'warning')) return 'warning';
        return 'pass';
    }, [grouped]);

    if (!offeredShift) return null;

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    const innerContent = (
        <>
                {/* Top stripe */}
                <div className={cn('h-1.5 shrink-0',
                    step === 'exchange' ? 'bg-primary/40' :
                    isRunning           ? 'bg-primary/40 animate-pulse' :
                    canProceed          ? 'bg-emerald-500' : 'bg-rose-500')} />

                {/* Header */}
                <div className="flex items-center justify-between px-8 pt-5 pb-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Shield className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-foreground tracking-tight">Swap Compliance Review</h2>
                            <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">
                                {requesterName} ↔ {offererName}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose}
                        className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <StepIndicator current={step} />

                {/* Body */}
                <div className="flex-1 overflow-y-auto">
                    <AnimatePresence mode="wait">

                        {/* ── STEP 1: EXCHANGE ── */}
                        {step === 'exchange' && (
                            <motion.div key="exchange" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }} className="px-8 py-6 space-y-5">
                                <p className="text-xs text-muted-foreground/70 font-medium">
                                    These two shifts will be exchanged between employees.
                                    Review the schedule details before running compliance checks.
                                </p>
                                <div className="flex items-stretch gap-3">
                                    <ShiftCard shift={requesterShift!} label={`${requesterName} gives`} color="indigo" />
                                    <div className="flex items-center justify-center shrink-0">
                                        <div className="h-8 w-8 rounded-full bg-muted/80 border border-border flex items-center justify-center">
                                            <ArrowLeftRight className="h-4 w-4 text-muted-foreground/50" />
                                        </div>
                                    </div>
                                    <ShiftCard shift={offeredShift} label={`${offererName} gives`} color="emerald" />
                                </div>
                                {requesterShift && offeredShift && (() => {
                                    const hA = calcNetHours(requesterShift);
                                    const hB = calcNetHours(offeredShift);
                                    const diff = hB - hA;
                                    return Math.abs(diff) > 0.1 ? (
                                        <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                                            <AlertTriangle className="h-4 w-4 shrink-0" />
                                            Unequal shift lengths: {hA.toFixed(1)}h vs {hB.toFixed(1)}h
                                            ({diff > 0 ? '+' : ''}{diff.toFixed(1)}h difference after swap)
                                        </div>
                                    ) : null;
                                })()}
                            </motion.div>
                        )}

                        {/* ── STEP 2: ANALYSIS ── */}
                        {step === 'analysis' && (
                            <motion.div key="analysis" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }} className="px-8 py-6 space-y-5">

                                {isRunning && (
                                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                                        <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                            <Loader2 className="h-7 w-7 text-primary animate-spin" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-black text-foreground/70">Running compliance checks…</p>
                                            <p className="text-[10px] text-muted-foreground/40 font-mono mt-1">Evaluating all constraints for both employees</p>
                                        </div>
                                    </div>
                                )}

                                {errorMsg && !isRunning && (
                                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                                        <div className="h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                                            <XCircle className="h-7 w-7 text-rose-500" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-black text-rose-500">Check failed</p>
                                            <p className="text-[11px] text-muted-foreground/60 mt-1 max-w-sm font-mono">{errorMsg}</p>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={runChecks} className="gap-2 text-[10px] font-black uppercase tracking-wider">
                                            <RefreshCw className="h-3.5 w-3.5" /> Retry
                                        </Button>
                                    </div>
                                )}

                                {solverResult && !isRunning && (
                                    <>
                                        {/* Employee summary strips */}
                                        <div className="space-y-2">
                                            <EmployeeSummaryStrip name={requesterName} overallStatus={requesterOverall} constraints={grouped} />
                                            <EmployeeSummaryStrip name={offererName}   overallStatus={offererOverall}   constraints={grouped} />
                                        </div>

                                        {/* Overall verdict */}
                                        <div className={cn('flex items-center gap-3 p-4 rounded-2xl border',
                                            canProceed ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20')}>
                                            {canProceed
                                                ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                                                : <AlertOctagon className="h-5 w-5 text-rose-500 shrink-0" />}
                                            <div className="flex-1">
                                                <p className={cn('text-[13px] font-black',
                                                    canProceed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                                                    {canProceed ? 'All constraints satisfied — swap can proceed' : 'Compliance violations prevent this swap'}
                                                </p>
                                                {!canProceed && blockingViolations.length > 0 && (
                                                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">
                                                        {blockingViolations.length} blocking violation{blockingViolations.length > 1 ? 's' : ''} must be resolved
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Bucketed constraint results */}
                                        <div className="space-y-5">
                                            {(['A', 'B', 'D', 'C'] as Bucket[]).map(b => (
                                                <BucketSection
                                                    key={b}
                                                    bucket={b}
                                                    constraints={byBucket[b]}
                                                    requesterName={requesterName}
                                                    offererName={offererName}
                                                />
                                            ))}
                                        </div>
                                    </>
                                )}
                            </motion.div>
                        )}

                        {/* ── STEP 3: DECISION ── */}
                        {step === 'decision' && solverResult && (
                            <motion.div key="decision" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }} className="px-8 py-6 space-y-5">

                                <div className={cn('p-6 rounded-2xl border text-center',
                                    canProceed ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20')}>
                                    <div className="flex justify-center mb-3">
                                        {canProceed
                                            ? <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                                            : <XCircle className="h-10 w-10 text-rose-500" />}
                                    </div>
                                    <h3 className={cn('text-lg font-black', canProceed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                                        {canProceed ? 'Swap Compliant' : 'Swap Cannot Proceed'}
                                    </h3>
                                    <p className="text-xs text-muted-foreground/70 mt-1">
                                        {canProceed
                                            ? 'All compliance checks passed. This swap is safe to proceed.'
                                            : 'One or more blocking compliance rules prevent this swap.'}
                                    </p>
                                </div>

                                {!canProceed && blockingViolations.length > 0 && (
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-rose-500 px-1">
                                            Swap cannot proceed due to:
                                        </p>
                                        {blockingViolations.map((v, i) => (
                                            <div key={i} className="flex items-start gap-2 p-3 bg-rose-500/5 border border-rose-500/20 rounded-xl">
                                                <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                                                <div>
                                                    <span className="text-[10px] font-black text-rose-500 uppercase tracking-wider">[{v.employee_name}]</span>
                                                    <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium ml-2">{v.summary}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {canProceed && (
                                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                                        <Shield className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                                        <div className="text-xs text-emerald-700 dark:text-emerald-300">
                                            <strong>Compliance verified</strong> for both {requesterName} and {offererName}.
                                            Sending your offer will notify {requesterName} for acceptance.
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer */}
                <div className="shrink-0 border-t border-border/50 px-8 py-4 bg-card/80">
                    {step === 'exchange' && (
                        <div className="flex justify-between">
                            <Button variant="ghost" onClick={onClose}
                                className="rounded-xl text-muted-foreground text-[10px] font-black uppercase tracking-widest h-9 px-4">
                                Cancel
                            </Button>
                            <Button onClick={() => { setStep('analysis'); runChecks(); }}
                                className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest h-9 px-5 gap-2">
                                <Shield className="h-3.5 w-3.5" />
                                Run Compliance Checks
                            </Button>
                        </div>
                    )}

                    {step === 'analysis' && (
                        <div className="flex justify-between">
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => setStep('exchange')}
                                    className="rounded-xl text-muted-foreground text-[10px] font-black uppercase tracking-widest h-9 px-4">
                                    ← Back
                                </Button>
                                {solverResult && (
                                    <Button variant="ghost" onClick={runChecks} disabled={isRunning}
                                        className="rounded-xl text-muted-foreground/60 hover:bg-muted text-[10px] font-black uppercase tracking-widest h-9 px-4 gap-1.5">
                                        <RefreshCw className="h-3 w-3" />
                                        Re-run
                                    </Button>
                                )}
                            </div>
                            {solverResult && !isRunning && (
                                <Button onClick={() => setStep('decision')}
                                    className={cn('rounded-xl text-[10px] font-black uppercase tracking-widest h-9 px-5',
                                        canProceed
                                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20')}>
                                    {canProceed ? 'Continue →' : 'View Decision →'}
                                </Button>
                            )}
                        </div>
                    )}

                    {step === 'decision' && (
                        <div className="flex justify-between">
                            <Button variant="ghost" onClick={() => setStep('analysis')}
                                className="rounded-xl text-muted-foreground text-[10px] font-black uppercase tracking-widest h-9 px-4">
                                ← Back
                            </Button>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={onClose}
                                    className="rounded-xl text-muted-foreground text-[10px] font-black uppercase tracking-widest h-9 px-4">
                                    Cancel
                                </Button>
                                <Button
                                    onClick={onConfirmOffer}
                                    disabled={!canProceed || isSubmitting}
                                    className={cn('rounded-xl text-[10px] font-black uppercase tracking-widest h-9 px-5 gap-1.5',
                                        canProceed
                                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                            : 'bg-muted text-muted-foreground/40 cursor-not-allowed')}
                                >
                                    {isSubmitting
                                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Sending…</>
                                        : canProceed
                                            ? <><Send className="h-3.5 w-3.5" />Send Offer</>
                                            : 'Cannot Proceed'}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
        </>
    );

    if (isMobile) {
        return (
            <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DrawerContent className="h-[90dvh] bg-card border-border p-0 overflow-hidden flex flex-col">
                    <VisuallyHidden>
                        <DrawerTitle>Swap Compliance Review</DrawerTitle>
                        <DrawerDescription>Review shift exchange details and evaluate compliance rules</DrawerDescription>
                    </VisuallyHidden>
                    {innerContent}
                </DrawerContent>
            </Drawer>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogPortal>
                <DialogOverlay className="backdrop-blur-md" />
                <RadixDialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-2xl max-h-[92vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-[2rem] border border-border shadow-2xl overflow-hidden bg-card focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                    {innerContent}
                </RadixDialog.Content>
            </DialogPortal>
        </Dialog>
    );
}

export default SwapComplianceReviewModal;
