import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import {
    Loader2,
    Calendar,
    Clock,
    Check,
    ArrowLeftRight,
    ShieldCheck,
    Info,
    Send,
    MessageSquare,
    UserCheck,
    CheckCircle2,
    Inbox,
    History as HistoryIcon,
    X,
    AlertCircle,
    Sparkles,
    Building,
    Shield,
    Lock
} from 'lucide-react';
import { format, addDays, parse, differenceInHours } from 'date-fns';
import { swapsApi } from '../../api/swaps.api';
import { shiftsApi } from '@/modules/rosters';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { getTodayInTimezone } from '@/modules/core/lib/date.utils';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { motion, AnimatePresence } from 'framer-motion';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { SwapComplianceReviewModal } from './SwapComplianceReviewModal';
import { useMinuteTick } from '@/modules/core/hooks/useMinuteTick';
import { getSwapTimer } from '../pages/EmployeeSwaps.page';
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';

interface OfferSwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirmOffer: (shiftId: string | undefined) => void;
    isSubmitting: boolean;
    swapId: string;
}

const SYDNEY_TZ = 'Australia/Sydney';

const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};

const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
};

const getGroupColor = (groupType: string | null = null, deptName: string = '') => {
    const type = groupType || '';
    const name = deptName.toLowerCase();

    if (type === 'convention_centre' || name.includes('convention')) return 'bg-blue-600/10 border-blue-500/20 text-blue-400';
    if (type === 'exhibition_centre' || name.includes('exhibition')) return 'bg-emerald-600/10 border-emerald-500/20 text-emerald-400';
    if (type === 'theatre' || name.includes('theatre')) return 'bg-rose-600/10 border-rose-500/20 text-rose-400';

    return 'bg-slate-800/50 border-slate-700 text-slate-300';
};

export const OfferSwapModal: React.FC<OfferSwapModalProps> = ({
    isOpen,
    onClose,
    onConfirmOffer,
    isSubmitting,
    swapId,
}) => {
    const isMobile = useIsMobile();
    const { user } = useAuth();
    const now = useMinuteTick();
    const [selectedV8ShiftId, setSelectedV8ShiftId] = useState<string | null>(null);
    const [showComplianceModal, setShowComplianceModal] = useState(false);

    // Fetch the swap request details
    const { data: currentSwap } = useQuery({
        queryKey: ['swapById', swapId],
        queryFn: () => swapsApi.getSwapById(swapId),
        enabled: isOpen && !!swapId,
    });

    const requesterName = currentSwap?.requestorEmployee?.fullName || 'Teammate';
    const theirShift = currentSwap?.originalShift;

    // Fetch existing offers for this swap
    const { data: existingOffers } = useQuery({
        queryKey: ['swapOffers', swapId],
        queryFn: () => swapsApi.getSwapOffers(swapId),
        enabled: isOpen && !!swapId,
    });

    const alreadyOfferedForThisSwapIds = new Set(
        existingOffers
            ?.filter(o => o.offerer_id === user?.id && o.status !== 'REJECTED' && o.status !== 'WITHDRAWN')
            .map(o => o.offered_shift_id)
            .filter(Boolean) as string[]
    );

    const { data: allMyActiveOffers } = useQuery({
        queryKey: ['myActiveOfferDetails', user?.id],
        queryFn: () => swapsApi.getMyActiveOfferDetails(user!.id),
        enabled: isOpen && !!user?.id,
    });

    const offeredElsewhereIds = new Set(
        allMyActiveOffers
            ?.filter(o => o.swap_request_id !== swapId)
            .map(o => o.offered_shift_id)
            .filter(Boolean) as string[]
    );

    // Fetch user's future shifts
    const { data: myShifts, isLoading: isLoadingShifts } = useQuery({
        queryKey: ['myFutureShifts', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const today = getTodayInTimezone();
            const future = addDays(today, 90);
            return shiftsApi.getEmployeeShifts(
                user.id,
                format(today, 'yyyy-MM-dd'),
                format(future, 'yyyy-MM-dd')
            );
        },
        enabled: isOpen && !!user?.id,
    });

    const selectedShift = myShifts?.find(s => s.id === selectedV8ShiftId);
    const selectedShiftIsLocked = selectedShift ? (() => {
        const start = parseZonedDateTime(selectedShift.shift_date, (selectedShift as any).start_time);
        const hours = differenceInHours(start, now);
        return hours >= 0 && hours < 4;
    })() : false;

    // Timer calculation for original request
    const timerText = getSwapTimer(
        now,
        (theirShift as any)?.start_at ?? undefined,
        (theirShift as any)?.shift_date,
        (theirShift as any)?.start_time,
        (theirShift as any)?.tz_identifier ?? undefined
    );
    const isExpired = timerText === 'Expired';

    // Lifecycle Timeline Logic
    const getTimeline = () => {
        const hasSelection = !!selectedV8ShiftId;
        return {
            created: true,
            selection: hasSelection,
            compliance: false, // Will move forward on click
            sent: false
        };
    };
    const timeline = getTimeline();

    const handleOpenComplianceCheck = () => {
        if (selectedV8ShiftId) setShowComplianceModal(true);
    };

    const handleConfirmFromComplianceModal = () => {
        onConfirmOffer(selectedV8ShiftId || undefined);
        setShowComplianceModal(false);
        setSelectedV8ShiftId(null);
    };

    const handleClose = () => {
        setSelectedV8ShiftId(null);
        setShowComplianceModal(false);
        onClose();
    };

    const modalContent = (
        <>
                    <VisuallyHidden>
                        <DialogTitle>Make an Offer</DialogTitle>
                        <DialogDescription>
                            Select a shift to trade for this swap request.
                        </DialogDescription>
                    </VisuallyHidden>

                    <div className={cn("flex flex-1 min-h-0", isMobile ? "flex-col overflow-y-auto" : "h-full")}>
                        {/* LEFT PANE: ELIGIBLE SHIFTS */}
                        <div className={cn("border-white/5 flex flex-col bg-[#0D0F12]", isMobile ? "border-b" : "w-[320px] border-r")}>
                            <div className="p-8 pb-6">
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600/20 to-indigo-400/10 flex items-center justify-center border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                                        <Building className="h-4.5 w-4.5 text-indigo-400" />
                                    </div>
                                    <div className="flex flex-col">
                                        <h2 className="text-lg font-black text-white tracking-tight leading-none">Your Shifts</h2>
                                        <p className="text-[9px] text-slate-500 uppercase font-black tracking-[0.15em] mt-1.5 opacity-60">
                                            Eligible for trade
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-2 custom-scrollbar">
                                {isLoadingShifts ? (
                                    <div className="space-y-2 px-2">
                                        {[1, 2, 3].map(i => (
                                            <Skeleton key={i} className="h-20 w-full rounded-xl bg-white/[0.02]" />
                                        ))}
                                    </div>
                                ) : !myShifts || myShifts.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                                        <Calendar className="h-8 w-8 mb-4 stroke-[1]" />
                                        <p className="text-[10px] font-black uppercase tracking-widest leading-none">No Shifts Found</p>
                                    </div>
                                ) : (
                                    myShifts.map((shift) => {
                                        const isOfferedHere = alreadyOfferedForThisSwapIds.has(shift.id);
                                        const isOfferedElsewhere = offeredElsewhereIds.has(shift.id);
                                        
                                        // §9 Time Lock Check
                                        const shiftStart = parseZonedDateTime(shift.shift_date, (shift as any).start_time);
                                        const hoursUntilStart = differenceInHours(shiftStart, now);
                                        const isLocked = hoursUntilStart >= 0 && hoursUntilStart < 4;
                                        const isPast = hoursUntilStart < 0;
                                        
                                        const isUnavailable = isOfferedHere || isOfferedElsewhere || isLocked || isPast;
                                        const isSelected = selectedV8ShiftId === shift.id;

                                        return (
                                            <button
                                                key={shift.id}
                                                disabled={isUnavailable}
                                                onClick={() => setSelectedV8ShiftId(shift.id)}
                                                className={cn(
                                                    "w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative overflow-hidden group active:scale-[0.98]",
                                                    isUnavailable ? "opacity-30 grayscale cursor-not-allowed border-white/5" :
                                                        isSelected
                                                            ? "bg-indigo-600/10 border-indigo-500/40 shadow-[0_4px_20px_-5px_rgba(79,70,229,0.15)]"
                                                            : "bg-[#121418] border-white/5 hover:border-white/10 hover:bg-[#16191D]"
                                                )}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className={cn(
                                                        "text-[13px] font-black tracking-tight transition-colors",
                                                        isSelected ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                                                    )}>
                                                        {shift.roles?.name || 'Shift'}
                                                    </span>
                                                    {isUnavailable && (
                                                        <Badge className={cn(
                                                            "text-[7px] h-3.5 px-1 font-black uppercase tracking-widest border-none",
                                                            isLocked ? "bg-rose-500/10 text-rose-500" : "bg-slate-500/10 text-slate-500"
                                                        )}>
                                                            {isLocked ? (
                                                                <div className="flex items-center gap-1">
                                                                    <Lock className="w-2 h-2" />
                                                                    <span>Locked</span>
                                                                </div>
                                                            ) : isPast ? 'Past' : isOfferedHere ? 'Offered' : 'Elsewhere'}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 tracking-tight">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-white font-medium group-hover:text-amber-300 transition-colors">
                                                            {format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-white/40">
                                                        <Clock className="w-3 h-3" />
                                                        <span>{formatTime((shift as any).start_time)} - {formatTime((shift as any).end_time)}</span>
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <motion.div layoutId="activeInboxGlow" className="absolute inset-0 rounded-xl ring-1 ring-indigo-500/50" />
                                                )}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* MIDDLE PANE: TRADE CONSTRUCTION */}
                        <div className={cn("flex-1 flex flex-col bg-[#0A0C0E] relative overflow-hidden", isMobile ? "" : "h-full")}>
                            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 blur-[120px] rounded-full pointer-events-none" />
                            <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-blue-600/5 blur-[100px] rounded-full pointer-events-none" />

                            <div className="flex-1 flex flex-col p-10 relative z-10 overflow-y-auto custom-scrollbar">
                                <div className="max-w-[520px] mx-auto w-full flex flex-col h-full">
                                    {/* Hero Area */}
                                    <div className="mb-10 text-center">
                                        <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-indigo-600/10 border border-indigo-500/20 shadow-inner shadow-indigo-500/5">
                                            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">
                                                Trade Construction
                                            </span>
                                        </div>
                                        <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-4">
                                            Swap Protocol
                                        </h2>
                                        <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-[400px] mx-auto">
                                            Review the shift exchange terms. Your teammate {requesterName} will need to accept this offer before manager review.
                                        </p>
                                    </div>

                                    {/* Swap Comparison */}
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className={cn(
                                            "flex-1 p-5 rounded-3xl border flex flex-col items-center gap-3 transition-all duration-500",
                                            selectedShift
                                                ? getGroupColor((selectedShift as any).group_type || (selectedShift as any).roles?.groupType, (selectedShift as any).departments?.name)
                                                : "bg-[#121418] border-white/5 opacity-50"
                                        )}>
                                            <span className="text-[9px] font-black uppercase tracking-widest opacity-60">You Give</span>
                                            {selectedShift ? (
                                                <div className="text-center">
                                                    <div className="text-sm font-black text-white">
                                                        {format(parse((selectedShift as any).shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d')}
                                                    </div>
                                                    <div className="text-[11px] font-bold opacity-80">
                                                        {formatTime((selectedShift as any).start_time)} - {formatTime((selectedShift as any).end_time)}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-10 flex items-center justify-center">
                                                    <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Pending</div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                                            <ArrowLeftRight className="h-4 w-4 text-slate-500" />
                                        </div>

                                        <div className={cn(
                                            "flex-1 p-5 rounded-3xl border flex flex-col items-center gap-3",
                                            getGroupColor((theirShift as any)?.group_type || (theirShift as any)?.roles?.groupType, (theirShift as any)?.departments?.name)
                                        )}>
                                            <span className="text-[9px] font-black uppercase tracking-widest opacity-60">You Get</span>
                                            <div className="text-center">
                                                <div className="text-sm font-black text-white">
                                                    {theirShift ? format(parse((theirShift as any).shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : 'N/A'}
                                                </div>
                                                <div className="text-[11px] font-bold opacity-80">
                                                    {theirShift ? `${formatTime((theirShift as any).start_time)} - ${formatTime((theirShift as any).end_time)}` : 'N/A'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Logic Note */}
                                    <div className="space-y-4 mb-10">
                                        <div className="bg-white/[0.02] border border-white/5 p-5 rounded-3xl space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                                                        <Building className="h-3.5 w-3.5 text-indigo-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Operation Center</div>
                                                        <div className="text-[11px] font-bold text-slate-200">
                                                            {(theirShift as any)?.departments?.name || 'Department'} • {(theirShift as any)?.roles?.name || 'Role'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <Separator className="bg-white/5" />

                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                                        <ShieldCheck className="h-4 w-4 text-emerald-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Proposed Terms</div>
                                                        <div className="text-[11px] font-bold text-slate-200">
                                                            Awaiting Offerer Selection
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                                            <Info className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                            <p className="text-[11px] text-amber-500/80 font-medium leading-relaxed">
                                                This trade will be validated against fatigue rules and roster constraints before final submission.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex flex-col gap-3 mt-auto mb-4">
                                        <Button
                                            onClick={handleOpenComplianceCheck}
                                            disabled={isSubmitting || !selectedV8ShiftId || isExpired || selectedShiftIsLocked}
                                            className="h-14 rounded-2xl font-black text-sm uppercase tracking-[0.2em] bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_10px_30px_-10px_rgba(79,70,229,0.3)] border-b-4 border-indigo-800 active:scale-[0.98] active:border-b-0 transition-all disabled:opacity-50 disabled:grayscale"
                                        >
                                            {isSubmitting ? (
                                                <Loader2 className="h-5 w-5 animate-spin" />
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <Shield className="h-5 w-5" />
                                                    <span>Check Compliance & Offer</span>
                                                </div>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT PANE: TRADE PROTOCOL (hidden on mobile) */}
                        <div className={cn("border-l border-white/5 flex flex-col bg-[#0D0F12]", isMobile ? "hidden" : "w-[300px]")}>
                            <div className="p-10 pb-6">
                                <div className="flex items-center gap-3 mb-8 text-amber-500/80">
                                    <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                        <HistoryIcon className="h-4.5 w-4.5" />
                                    </div>
                                    <h2 className="text-xs font-black text-white uppercase tracking-widest opacity-80">Trade Protocol</h2>
                                </div>
                                <Separator className="bg-white/5" />
                            </div>

                            <div className="flex-1 overflow-y-auto px-8 pb-10 custom-scrollbar">
                                {/* Expiration Timer specifically for the request */}
                                {timerText && (
                                    <div className="mb-10 text-center">
                                        <div className={cn(
                                            "inline-flex items-center gap-2 px-4 py-2 rounded-xl border font-black uppercase tracking-[0.1em] text-[10px]",
                                            isExpired ? "bg-rose-500/10 border-rose-500/20 text-rose-500" : "bg-purple-500/10 border-purple-500/20 text-purple-400"
                                        )}>
                                            <Clock className="h-3 w-3" />
                                            {timerText}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-8 relative pl-6 before:absolute before:left-0 before:top-1 before:bottom-0 before:w-px before:bg-white/5">
                                    {[
                                        { id: 'created', label: 'Market Entry', icon: Check, active: timeline.created, desc: 'Request is live in exchange.' },
                                        { id: 'selection', label: 'Shift Selection', icon: Building, active: timeline.selection, desc: 'Choose your offer shift.' },
                                        { id: 'compliance', label: 'Validation', icon: ShieldCheck, active: timeline.compliance, desc: 'Verify fatigue compliance.' },
                                        { id: 'sent', label: 'Proposal Sent', icon: Send, active: timeline.sent, desc: 'Awaiting teammate approval.' }
                                    ].map((step) => (
                                        <div key={step.id} className="relative">
                                            <div className={cn(
                                                "absolute left-[-30px] top-0 h-4 w-4 rounded-full border-2 border-[#0D0F12] transition-all duration-500 flex items-center justify-center",
                                                step.active ? "bg-indigo-500 shadow-[0_0_12px_rgba(79,70,229,0.4)]" : "bg-slate-800 border-white/5"
                                            )}>
                                                <step.icon className={cn("h-2 w-2", step.active ? "text-white" : "text-slate-600")} />
                                            </div>
                                            <div className={cn(
                                                "text-[10px] font-black uppercase tracking-widest mb-1 transition-colors",
                                                step.active ? "text-slate-200" : "text-slate-600"
                                            )}>
                                                {step.label}
                                            </div>
                                            <div className={cn(
                                                "text-[9px] font-medium leading-tight",
                                                step.active ? "text-slate-400" : "text-slate-700"
                                            )}>
                                                {step.desc}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-20 flex flex-col items-center gap-4">
                                    <div className="flex items-center gap-3 w-full p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                                        <Avatar className="h-8 w-8 bg-slate-800 border border-white/5">
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
                                <Button
                                    onClick={handleClose}
                                    className="w-full h-10 rounded-xl bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest border border-white/10 transition-all font-inter"
                                >
                                    Cancel & Return
                                </Button>
                            </div>
                        </div>
                    </div>
        </>
    );

    return (
        <>
            {isMobile ? (
                <Drawer open={isOpen} onOpenChange={(open) => !open && handleClose()}>
                    <DrawerContent className="h-[92dvh] bg-[#0A0C0E] border-white/10 p-0 overflow-hidden flex flex-col">
                        <VisuallyHidden>
                            <DrawerTitle>Make an Offer</DrawerTitle>
                            <DrawerDescription>Select a shift to trade for this swap request</DrawerDescription>
                        </VisuallyHidden>
                        {modalContent}
                    </DrawerContent>
                </Drawer>
            ) : (
                <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
                    <DialogContent
                        className="sm:max-w-[1040px] h-[720px] max-h-[85vh] bg-[#0A0C0E] border border-white/10 p-0 overflow-hidden shadow-[0_0_80px_-15px_rgba(0,0,0,0.8)] flex flex-col rounded-[2.5rem] [&>button]:hidden"
                    >
                        {modalContent}
                    </DialogContent>
                </Dialog>
            )}

            {selectedShift && theirShift && (
                <SwapComplianceReviewModal
                    isOpen={showComplianceModal}
                    onClose={() => setShowComplianceModal(false)}
                    offeredShift={{
                        id: selectedShift.id,
                        shift_date: (selectedShift as any).shift_date,
                        start_time: (selectedShift as any).start_time,
                        end_time: (selectedShift as any).end_time,
                        unpaid_break_minutes: (selectedShift as any).unpaid_break_minutes,
                        role_name: (selectedShift as any).roles?.name,
                        department_name: (selectedShift as any).departments?.name,
                    }}
                    requesterShift={{
                        id: theirShift.id,
                        shift_date: (theirShift as any).shift_date,
                        start_time: (theirShift as any).start_time,
                        end_time: (theirShift as any).end_time,
                        unpaid_break_minutes: (theirShift as any).unpaid_break_minutes,
                        role_name: (theirShift as any).roles?.name,
                    }}
                    requesterId={currentSwap?.requested_by_employee_id || null}
                    requesterName={requesterName}
                    offererId={user?.id || null}
                    offererName={(user as any)?.user_metadata?.full_name || 'You'}
                    onConfirmOffer={handleConfirmFromComplianceModal}
                    isSubmitting={isSubmitting}
                />
            )}
        </>
    );
};
