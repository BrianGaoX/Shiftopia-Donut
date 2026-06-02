/**
 * UnifiedSwapModal (SIMPLIFIED)
 *
 * 1-step flow: Select your shift → auto Bucket A eligibility check → Send Offer
 *
 * Bucket A checks (via validateCompliance edge function):
 *   ✓ Role Contract Match (blocking)
 *   ✓ Qualification Match (blocking)
 *   ✓ Availability / overlap (non-blocking warning)
 *
 * Full compliance (A+B+C+D) now runs on the Manager's Swap Requests page.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import {
    Drawer,
    DrawerContent,
    DrawerTitle,
    DrawerDescription,
} from '@/modules/core/ui/primitives/drawer';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, parse, differenceInHours } from 'date-fns';
import {
    Loader2, Calendar, Clock, ArrowLeftRight, Info,
    Send, Building, Lock, Sparkles,
    History as HistoryIcon, Check, ShieldCheck,
    AlertTriangle, XCircle, CheckCircle2,
    Zap, Signal, Inbox,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { getTodayInTimezone, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { useMinuteTick } from '@/modules/core/hooks/useMinuteTick';
import { swapsApi } from '../../api/swaps.api';
import { shiftsApi } from '@/modules/rosters';
import { validateCompliance, QualificationViolation } from '@/modules/rosters/services/compliance.service';
import { getSwapTimer } from '../pages/EmployeeSwaps.page';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';

// =============================================================================
// TYPES
// =============================================================================

export interface UnifiedSwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirmOffer: (shiftId: string | undefined) => void;
    isSubmitting: boolean;
    swapId: string;
}

interface EligibilityResult {
    eligible: boolean;
    reasons: string[];
    warnings: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

const fmtTime = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const getInitials = (name: string) => {
    const p = name.trim().split(' ');
    return p.length >= 2 ? `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
};

const getGroupColor = (groupType?: string | null, deptName = '') => {
    const type = groupType || '';
    const name = deptName.toLowerCase();
    if (type === 'convention_centre' || name.includes('convention')) return 'bg-blue-600/10 border-blue-500/20 text-blue-400';
    if (type === 'exhibition_centre' || name.includes('exhibition')) return 'bg-emerald-600/10 border-emerald-500/20 text-emerald-400';
    if (type === 'theatre' || name.includes('theatre')) return 'bg-rose-600/10 border-rose-500/20 text-rose-400';
    return 'bg-slate-800/50 border-slate-700 text-slate-300';
};

const calcNetMinutes = (s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number => {
    const p = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = p(s.end_time) - p(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(1, gross - (s.unpaid_break_minutes ?? 0));
};

const resolveGroupVariant = (groupType?: string | null, deptName = ''): 'convention' | 'exhibition' | 'theatre' | 'default' => {
    const type = (groupType || '').toLowerCase();
    const name = deptName.toLowerCase();
    if (type.includes('convention') || name.includes('convention')) return 'convention';
    if (type.includes('exhibition') || name.includes('exhibition')) return 'exhibition';
    if (type.includes('theatre') || type.includes('theater') || name.includes('theatre')) return 'theatre';
    return 'default';
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const UnifiedSwapModal: React.FC<UnifiedSwapModalProps> = ({
    isOpen, onClose, onConfirmOffer, isSubmitting, swapId,
}) => {
    const isMobile = useIsMobile();
    const { user } = useAuth();
    const now = useMinuteTick();

    // ── UI state
    const [selectedV8ShiftId, setSelectedV8ShiftId] = useState<string | null>(null);

    // ── Reset on open/close
    useEffect(() => {
        if (!isOpen) {
            setSelectedV8ShiftId(null);
        }
    }, [isOpen]);

    // ── Queries: swap details
    const { data: currentSwap } = useQuery({
        queryKey: ['swapById', swapId],
        queryFn: () => swapsApi.getSwapById(swapId),
        enabled: isOpen && !!swapId,
    });

    const requesterName = currentSwap?.requestorEmployee?.fullName || 'Teammate';
    const theirShift = currentSwap?.originalShift as any;
    const offererId: string | null = user?.id || null;

    // ── Queries: offer de-dupe
    const { data: existingOffers } = useQuery({
        queryKey: ['swapOffers', swapId],
        queryFn: () => swapsApi.getSwapOffers(swapId),
        enabled: isOpen && !!swapId,
    });

    const alreadyOfferedForThisSwapIds = new Set(
        existingOffers
            ?.filter(o => o.offerer_id === user?.id && o.status !== 'REJECTED' && o.status !== 'WITHDRAWN')
            .map(o => o.offered_shift_id).filter(Boolean) as string[]
    );

    const { data: allMyActiveOffers } = useQuery({
        queryKey: ['myActiveOfferDetails', user?.id],
        queryFn: () => swapsApi.getMyActiveOfferDetails(user!.id),
        enabled: isOpen && !!user?.id,
    });

    const offeredElsewhereIds = new Set(
        allMyActiveOffers
            ?.filter(o => o.swap_request_id !== swapId)
            .map(o => o.offered_shift_id).filter(Boolean) as string[]
    );

    // ── Queries: my future shifts
    const { data: myShifts, isLoading: isLoadingShifts } = useQuery({
        queryKey: ['myFutureShifts', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const today = getTodayInTimezone();
            const future = addDays(today, 90);
            return shiftsApi.getEmployeeShifts(user.id, format(today, 'yyyy-MM-dd'), format(future, 'yyyy-MM-dd'));
        },
        enabled: isOpen && !!user?.id,
    });

    const selectedShift = myShifts?.find(s => s.id === selectedV8ShiftId) as any;

    // ── Timer / expiry
    const timerText = getSwapTimer(
        now,
        theirShift?.start_at,
        theirShift?.shift_date,
        theirShift?.start_time,
        theirShift?.tz_identifier,
    );
    const isExpired = timerText === 'Expired';

    // =========================================================================
    // BUCKET A ELIGIBILITY (auto-run per shift via validateCompliance)
    // =========================================================================

    // Build stable query key from shift IDs
    const shiftIds = useMemo(
        () => (myShifts || []).map(s => s.id).sort().join(','),
        [myShifts]
    );

    const { data: eligibilityMap = new Map<string, EligibilityResult>(), isFetching: eligibilityLoading } = useQuery({
        queryKey: ['swapEligibility', shiftIds, theirShift?.id, offererId],
        queryFn: async (): Promise<Map<string, EligibilityResult>> => {
            const newMap = new Map<string, EligibilityResult>();
            if (!myShifts || !theirShift || !offererId) return newMap;

            // For each of my shifts, check if I'm eligible to RECEIVE the requester's shift
            const results = await Promise.allSettled(
                myShifts.map(s => validateCompliance({
                    employeeId: offererId,
                    shiftDate: theirShift.shift_date,
                    startTime: (theirShift.start_time || '00:00').slice(0, 5) + ':00',
                    endTime: (theirShift.end_time || '00:00').slice(0, 5) + ':00',
                    netLengthMinutes: calcNetMinutes(theirShift),
                    shiftId: theirShift.id,
                    excludeV8ShiftId: s.id, // Exclude the shift I'm giving away
                }))
            );

            myShifts.forEach((s, i) => {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    const qv: QualificationViolation[] = result.value.qualificationViolations;
                    const hardBlocks: string[] = [];
                    const softWarnings: string[] = [];

                    // Bucket A: Role + Qualification (HARD BLOCK)
                    for (const v of qv) {
                        if (v.type === 'ROLE_MISMATCH') hardBlocks.push('Role mismatch — no matching contract');
                        else if (v.type === 'LICENSE_MISSING') hardBlocks.push(`Missing licence: ${v.license_name || 'required'}`);
                        else if (v.type === 'SKILL_MISSING') hardBlocks.push(`Missing skill: ${v.skill_name || 'required'}`);
                        else if (v.type === 'LICENSE_EXPIRED') hardBlocks.push(`Expired licence: ${v.license_name || 'required'}`);
                        else if (v.type === 'SKILL_EXPIRED') hardBlocks.push(`Expired skill: ${v.skill_name || 'required'}`);
                    }

                    // Availability warnings (NON-BLOCKING)
                    for (const w of result.value.warnings || []) {
                        if (!hardBlocks.length || true) softWarnings.push(w);
                    }
                    for (const v of result.value.violations || []) {
                        if (v.toLowerCase().includes('overlap')) softWarnings.push('Schedule overlap detected');
                        else if (v.toLowerCase().includes('weekly') || v.toLowerCase().includes('hours')) softWarnings.push('May exceed weekly hours');
                        else if (v.toLowerCase().includes('rest') || v.toLowerCase().includes('fatigue')) softWarnings.push('Fatigue risk');
                    }

                    newMap.set(s.id, {
                        eligible: hardBlocks.length === 0,
                        reasons: hardBlocks,
                        warnings: softWarnings,
                    });
                } else {
                    // Edge function unreachable → fail-open (optimistic pass)
                    newMap.set(s.id, { eligible: true, reasons: [], warnings: [] });
                }
            });

            return newMap;
        },
        enabled: isOpen && !!offererId && !!theirShift?.id && (myShifts || []).length > 0,
        staleTime: 30_000, // Cache for 30s
    });

    // ── Selected shift eligibility
    const selectedEligibility = selectedV8ShiftId ? eligibilityMap.get(selectedV8ShiftId) : undefined;
    const canSendOffer = !!selectedV8ShiftId && (selectedEligibility?.eligible ?? true) && !isExpired;

    // ── Event handlers
    const handleConfirmOffer = () => {
        onConfirmOffer(selectedV8ShiftId || undefined);
        handleClose();
    };

    const handleClose = () => {
        setSelectedV8ShiftId(null);
        onClose();
    };

    // ── Timeline
    const timeline = {
        created: true,
        selection: !!selectedV8ShiftId,
        eligible: selectedV8ShiftId ? (selectedEligibility?.eligible ?? null) : null,
        sent: false,
    };

    // ==========================================================================
    // RENDER
    // ==========================================================================

    const modalContent = (
        <>
                <VisuallyHidden>
                    <DialogTitle>Offer a Shift Swap</DialogTitle>
                    <DialogDescription>Select a shift and send your offer. Manager will run full compliance.</DialogDescription>
                </VisuallyHidden>

                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className={cn("flex flex-1 min-h-0 overflow-hidden", isMobile ? "flex-col overflow-y-auto" : "h-full")}
                >
                    {/* LEFT PANE: YOUR SHIFTS */}
                    <div className={cn("border-white/5 flex flex-col bg-[#0D0F12] shrink-0", isMobile ? "border-b" : "w-[320px] border-r")}>
                        <div className="p-8 pb-6">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600/20 to-indigo-400/10 flex items-center justify-center border border-indigo-500/20">
                                    <Building className="h-4 w-4 text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white tracking-tight leading-none">Your Shifts</h2>
                                    <p className="text-[9px] text-slate-500 uppercase font-black tracking-[0.15em] mt-1.5 opacity-60">Select one to offer</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-2 custom-scrollbar">
                            {isLoadingShifts ? (
                                <div className="space-y-2 px-2">
                                    {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl bg-white/[0.02]" />)}
                                </div>
                            ) : !myShifts || myShifts.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                                    <Calendar className="h-8 w-8 mb-4 stroke-[1]" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No Shifts Found</p>
                                </div>
                            ) : (
                                myShifts.map(shift => {
                                    const s = shift as any;
                                    const isOfferedHere = alreadyOfferedForThisSwapIds.has(shift.id);
                                    const isOfferedElsewhere = offeredElsewhereIds.has(shift.id);

                                    const urgency = computeShiftUrgency(s.shift_date, s.start_time, s.start_at);
                                    const isLocked = urgency === 'emergent';

                                    const elig = eligibilityMap.get(shift.id);
                                    const isIneligible = elig?.eligible === false;
                                    const hasWarnings = (elig?.warnings?.length || 0) > 0;

                                    const isUnavailable = isOfferedHere || isOfferedElsewhere || isLocked;
                                    const isSelected = selectedV8ShiftId === shift.id;

                                    const groupVariant = resolveGroupVariant(s.group_type || s.roles?.groupType, s.departments?.name);

                                    // Status override badge (urgency badges handled by SharedShiftCard)
                                    const statusBadge = isOfferedHere ? (
                                        <Badge className="text-[7px] h-3.5 px-1 font-black uppercase tracking-widest border-none bg-slate-500/10 text-slate-500">Offered</Badge>
                                    ) : isOfferedElsewhere ? (
                                        <Badge className="text-[7px] h-3.5 px-1 font-black uppercase tracking-widest border-none bg-slate-500/10 text-slate-500">Elsewhere</Badge>
                                    ) : isIneligible ? (
                                        <Badge className="text-[7px] h-3.5 px-1 font-black uppercase tracking-widest border-none bg-amber-500/10 text-amber-500">Ineligible</Badge>
                                    ) : hasWarnings ? (
                                        <Badge className="text-[7px] h-3.5 px-1 font-black uppercase tracking-widest border-none bg-amber-500/10 text-amber-400">
                                            <AlertTriangle className="w-2 h-2 mr-0.5 inline" />Warning
                                        </Badge>
                                    ) : eligibilityLoading && !elig ? (
                                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" />
                                    ) : null;

                                    return (
                                        <div key={shift.id} className="relative group">
                                            <SharedShiftCard
                                                variant="timecard"
                                                organization={s.organization_name || ''}
                                                department={s.departments?.name || ''}
                                                subGroup={s.sub_departments?.name || ''}
                                                role={s.roles?.name || 'Shift'}
                                                shiftDate={format(parse(s.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d')}
                                                startTime={fmtTime(s.start_time)}
                                                endTime={fmtTime(s.end_time)}
                                                netLength={calcNetMinutes(s)}
                                                paidBreak={0}
                                                unpaidBreak={s.unpaid_break_minutes || 0}
                                                urgency={urgency}
                                                groupVariant={groupVariant}
                                                onClick={isUnavailable ? undefined : () => setSelectedV8ShiftId(shift.id)}
                                                className={cn(
                                                    isUnavailable && 'opacity-30 grayscale cursor-not-allowed pointer-events-none',
                                                    isSelected && 'ring-2 ring-indigo-500/50',
                                                )}
                                                statusIcons={statusBadge ? (
                                                    <div className="col-span-3 flex items-center gap-1.5">
                                                        {statusBadge}
                                                    </div>
                                                ) : undefined}
                                                topContent={
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="radio"
                                                            name="select-offer-shift"
                                                            checked={isSelected}
                                                            onChange={() => setSelectedV8ShiftId(shift.id)}
                                                            disabled={isUnavailable}
                                                            className="h-4 w-4 rounded-full border-white/10 text-indigo-600 focus:ring-indigo-500/30 accent-indigo-600 cursor-pointer"
                                                        />
                                                        <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">
                                                            {isSelected ? "Selected" : "Select"}
                                                        </span>
                                                    </div>
                                                }
                                            />
                                            {/* Ineligibility tooltip */}
                                            {isIneligible && elig?.reasons && elig.reasons.length > 0 && (
                                                <div className="absolute left-full top-0 ml-2 z-50 hidden group-hover:block w-56">
                                                    <div className="bg-[#1a1d22] border border-rose-500/20 rounded-xl p-3 shadow-xl">
                                                        <div className="text-[9px] font-black uppercase tracking-widest text-rose-500 mb-1.5">Ineligible</div>
                                                        {elig.reasons.map((r, i) => (
                                                            <div key={i} className="flex items-start gap-1.5 text-[10px] text-rose-400/80 mb-1">
                                                                <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                                                                <span>{r}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* MIDDLE PANE: TRADE CONSTRUCTION */}
                    <div className="flex-1 flex flex-col bg-[#0A0C0E] relative overflow-hidden h-full">
                        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 blur-[120px] rounded-full pointer-events-none" />
                        <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-blue-600/5 blur-[100px] rounded-full pointer-events-none" />
                        <div className="flex-1 flex flex-col p-10 relative z-10 overflow-y-auto custom-scrollbar">
                            <div className="max-w-[520px] mx-auto w-full flex flex-col h-full">
                                <div className="mb-10 text-center">
                                    <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-indigo-600/10 border border-indigo-500/20">
                                        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Quick Offer</span>
                                    </div>
                                    <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-4">Swap Offer</h2>
                                    <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-[400px] mx-auto">
                                        Select a shift to offer. {requesterName} will review your proposal, then manager gives final approval.
                                    </p>
                                </div>

                                {/* Shift comparison */}
                                <div className="flex items-center gap-4 mb-8">
                                    <div className={cn(
                                        'flex-1 p-5 rounded-3xl border flex flex-col items-center gap-3 transition-all duration-500',
                                        selectedShift
                                            ? getGroupColor(selectedShift?.group_type || selectedShift?.roles?.groupType, selectedShift?.departments?.name)
                                            : 'bg-[#121418] border-white/5 opacity-50'
                                    )}>
                                        <span className="text-[9px] font-black uppercase tracking-widest opacity-60">You Give</span>
                                        {selectedShift ? (
                                            <div className="text-center">
                                                <div className="text-sm font-black text-white">{format(parse(selectedShift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d')}</div>
                                                <div className="text-[11px] font-bold opacity-80">{fmtTime(selectedShift.start_time)} – {fmtTime(selectedShift.end_time)}</div>
                                            </div>
                                        ) : (
                                            <div className="h-10 flex items-center justify-center">
                                                <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Select a shift →</div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                        <ArrowLeftRight className="h-4 w-4 text-slate-500" />
                                    </div>
                                    <div className={cn('flex-1 p-5 rounded-3xl border flex flex-col items-center gap-3',
                                        getGroupColor(theirShift?.group_type || theirShift?.roles?.groupType, theirShift?.departments?.name))}>
                                        <span className="text-[9px] font-black uppercase tracking-widest opacity-60">You Get</span>
                                        <div className="text-center">
                                            <div className="text-sm font-black text-white">
                                                {theirShift?.shift_date ? format(parse(theirShift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : 'N/A'}
                                            </div>
                                            <div className="text-[11px] font-bold opacity-80">
                                                {theirShift ? `${fmtTime(theirShift.start_time)} – ${fmtTime(theirShift.end_time)}` : 'N/A'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Eligibility status panel */}
                                {selectedShift && selectedEligibility && (
                                    <div className="space-y-3 mb-6">
                                        {/* Hard block banner */}
                                        {!selectedEligibility.eligible && (
                                            <div className="flex items-start gap-3 p-4 rounded-2xl bg-rose-500/5 border border-rose-500/15">
                                                <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                                                <div>
                                                    <p className="text-[11px] font-black text-rose-400 mb-1">Cannot offer this shift</p>
                                                    {selectedEligibility.reasons.map((r, i) => (
                                                        <p key={i} className="text-[10px] text-rose-400/70 leading-relaxed">• {r}</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Soft warnings banner */}
                                        {selectedEligibility.eligible && selectedEligibility.warnings.length > 0 && (
                                            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                                                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                                <div>
                                                    <p className="text-[11px] font-black text-amber-400 mb-1">Availability notice</p>
                                                    {selectedEligibility.warnings.map((w, i) => (
                                                        <p key={i} className="text-[10px] text-amber-400/70 leading-relaxed">• {w}</p>
                                                    ))}
                                                    <p className="text-[9px] text-amber-500/50 mt-1 italic">Manager will review full compliance before approval.</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* All clear */}
                                        {selectedEligibility.eligible && selectedEligibility.warnings.length === 0 && (
                                            <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/15">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                                                <p className="text-[11px] font-bold text-emerald-400">Eligible — no conflicts detected</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Loading eligibility */}
                                {selectedShift && !selectedEligibility && eligibilityLoading && (
                                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 mb-6">
                                        <Loader2 className="h-4 w-4 animate-spin text-indigo-400 shrink-0" />
                                        <p className="text-[11px] text-slate-500 font-medium">Checking eligibility…</p>
                                    </div>
                                )}

                                {/* Info banner */}
                                <div className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 mb-6">
                                    <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-indigo-300/70 font-medium leading-relaxed">
                                        Your manager will run full compliance checks (fatigue, hours, overlap) before approving the trade.
                                    </p>
                                </div>

                                {/* Send Offer button */}
                                <div className="flex flex-col gap-3 mt-auto mb-4">
                                    <Button
                                        onClick={handleConfirmOffer}
                                        disabled={!canSendOffer || isSubmitting}
                                        className="h-14 rounded-2xl font-black text-sm uppercase tracking-[0.2em] bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_10px_30px_-10px_rgba(79,70,229,0.3)] border-b-4 border-indigo-800 active:scale-[0.98] active:border-b-0 transition-all disabled:opacity-50 disabled:grayscale"
                                    >
                                        {isSubmitting ? (
                                            <div className="flex items-center gap-2">
                                                <Loader2 className="h-5 w-5 animate-spin" />
                                                <span>Sending…</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <Send className="h-5 w-5" />
                                                <span>Send Offer</span>
                                            </div>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT PANE: TRADE PROTOCOL (hidden on mobile) */}
                    <div className={cn("border-l border-white/5 flex flex-col bg-[#0D0F12] shrink-0", isMobile ? "hidden" : "w-[300px]")}>
                        <div className="p-10 pb-6">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                    <HistoryIcon className="h-4 w-4 text-amber-400" />
                                </div>
                                <h2 className="text-xs font-black text-white uppercase tracking-widest opacity-80">Trade Protocol</h2>
                            </div>
                            <Separator className="bg-white/5" />
                        </div>
                        <div className="flex-1 overflow-y-auto px-8 pb-10 custom-scrollbar">
                            {timerText && (
                                <div className="mb-10 text-center">
                                    <div className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-xl border font-black uppercase tracking-[0.1em] text-[10px]',
                                        isExpired ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' : 'bg-purple-500/10 border-purple-500/20 text-purple-400')}>
                                        <Clock className="h-3 w-3" />
                                        {timerText}
                                    </div>
                                </div>
                            )}
                            <div className="space-y-8 relative pl-6 before:absolute before:left-0 before:top-1 before:bottom-0 before:w-px before:bg-white/5">
                                {([
                                    { id: 'created',    label: 'Market Entry',      icon: Check,       active: timeline.created,    desc: 'Request is live in exchange.' },
                                    { id: 'selection',  label: 'Shift Selection',    icon: Building,    active: timeline.selection,  desc: 'Choose your offer shift.' },
                                    { id: 'eligible',   label: 'Eligibility Check',  icon: ShieldCheck, active: timeline.eligible === true, desc: timeline.eligible === false ? 'Not eligible for this trade.' : timeline.eligible === true ? 'Eligible — no hard blocks.' : 'Auto-verified on selection.' },
                                    { id: 'sent',       label: 'Proposal Sent',      icon: Send,        active: timeline.sent,       desc: 'Awaiting teammate approval.' },
                                ] as const).map(item => (
                                    <div key={item.id} className="relative">
                                        <div className={cn(
                                            'absolute left-[-30px] top-0 h-4 w-4 rounded-full border-2 border-[#0D0F12] transition-all duration-500 flex items-center justify-center',
                                            item.active ? 'bg-indigo-500 shadow-[0_0_12px_rgba(79,70,229,0.4)]'
                                                : item.id === 'eligible' && timeline.eligible === false ? 'bg-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
                                                : 'bg-slate-800 border-white/5'
                                        )}>
                                            <item.icon className={cn('h-2 w-2', item.active ? 'text-white' : item.id === 'eligible' && timeline.eligible === false ? 'text-white' : 'text-slate-600')} />
                                        </div>
                                        <div className={cn('text-[10px] font-black uppercase tracking-widest mb-1', item.active ? 'text-slate-200' : item.id === 'eligible' && timeline.eligible === false ? 'text-rose-400' : 'text-slate-600')}>{item.label}</div>
                                        <div className={cn('text-[9px]', item.active ? 'text-slate-400' : item.id === 'eligible' && timeline.eligible === false ? 'text-rose-400/60' : 'text-slate-700')}>{item.desc}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-20">
                                <div className="flex items-center gap-3 w-full p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                                    <Avatar className="h-8 w-8 border border-white/5">
                                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-700 text-white text-[10px] font-black">
                                            {getInitials(requesterName)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Proposed By</p>
                                        <p className="text-[11px] font-bold text-slate-200 leading-none mt-1">{requesterName}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-8 border-t border-white/5 bg-black/5">
                            <Button onClick={handleClose} className="w-full h-10 rounded-xl bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest border border-white/10">
                                Cancel & Return
                            </Button>
                        </div>
                    </div>
                </motion.div>
        </>
    );

    return isMobile ? (
        <Drawer open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DrawerContent className="h-[92dvh] bg-[#0A0C0E] border-white/10 p-0 overflow-hidden flex flex-col" aria-describedby={undefined}>
                <VisuallyHidden>
                    <DrawerTitle>Offer a Shift Swap</DrawerTitle>
                    <DrawerDescription>Select one of your future shifts to offer in exchange for the requested shift</DrawerDescription>
                </VisuallyHidden>
                {modalContent}
            </DrawerContent>
        </Drawer>
    ) : (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-[1040px] h-[720px] max-h-[90vh] bg-[#0A0C0E] border border-white/10 p-0 overflow-hidden shadow-[0_0_80px_-15px_rgba(0,0,0,0.8)] flex flex-col rounded-[2.5rem] [&>button]:hidden" aria-describedby={undefined}>
                {modalContent}
            </DialogContent>
        </Dialog>
    );
};

export default UnifiedSwapModal;
