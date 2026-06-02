import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
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
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
} from '@/modules/core/ui/primitives/drawer';
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
    ChevronRight,
    Sparkles,
    Building,
    History as HistoryIcon,
    X,
    AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { SwapOffer, swapsApi } from '../../api/swaps.api';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/modules/core/lib/utils';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { motion, AnimatePresence } from 'framer-motion';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

interface ViewOffersModalProps {
    isOpen: boolean;
    onClose: () => void;
    swapResquestId: string;
    onAccept: (offer: SwapOffer) => void;
    onDecline: (offerId: string) => void;
    isAccepting: boolean;
    isDeclining: boolean;
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


export const ViewOffersModal: React.FC<ViewOffersModalProps> = ({
    isOpen,
    onClose,
    swapResquestId,
    onAccept,
    onDecline,
    isAccepting,
    isDeclining,
}) => {
    const isMobile = useIsMobile();
    const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
    const [showRejectConfirm, setShowRejectConfirm] = useState<string | null>(null);

    // Fetch offers
    const { data: offers, isLoading: isLoadingOffers } = useQuery({
        queryKey: ['swapOffers', swapResquestId],
        queryFn: () => swapsApi.getSwapOffers(swapResquestId),
        enabled: isOpen && !!swapResquestId,
    });

    // Fetch current swap request details
    const { data: currentSwap } = useQuery({
        queryKey: ['swapById', swapResquestId],
        queryFn: () => swapsApi.getSwapById(swapResquestId),
        enabled: isOpen && !!swapResquestId,
    });

    const myShift = currentSwap?.originalShift;
    const pendingOffers = offers?.filter(o => o.status === 'SUBMITTED') || [];
    const acceptedOffer = offers?.find(o => o.status === 'SELECTED');

    // Determine what to display based on status
    const displayOffers = (currentSwap?.status === 'MANAGER_PENDING' || currentSwap?.status === 'APPROVED')
        ? (acceptedOffer ? [acceptedOffer] : [])
        : (offers || []);

    // Set initial selection
    useEffect(() => {
        if (isOpen && displayOffers.length > 0 && !selectedOfferId) {
            setSelectedOfferId(displayOffers[0].id);
        }
    }, [isOpen, displayOffers, selectedOfferId]);

    const selectedOffer = displayOffers.find(o => o.id === selectedOfferId);

    // Timeline state logic
    const getTimelineState = () => {
        if (!currentSwap) return { created: true, offerReceived: false, selection: false, manager: false };

        const hasSubmitted = offers?.some(o => o.status === 'SUBMITTED');
        const hasAccepted = offers?.some(o => o.status === 'SELECTED');
        const isManagerPending = currentSwap.status === 'MANAGER_PENDING';
        const isApproved = currentSwap.status === 'APPROVED';

        return {
            created: true,
            offerReceived: hasSubmitted || hasAccepted || isManagerPending || isApproved,
            selection: hasAccepted || isManagerPending || isApproved,
            manager: isApproved
        };
    };

    const timeline = getTimelineState();

    const handleAccept = () => {
        if (selectedOffer) {
            onAccept(selectedOffer);
        }
    };

    const handleReject = () => {
        if (showRejectConfirm) {
            onDecline(showRejectConfirm);
            setShowRejectConfirm(null);
        }
    };

    // ── Mobile Drawer layout ────────────────────────────────────────────────────
    if (isMobile) {
        return (
            <>
                <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
                    <DrawerContent className="bg-background border-border max-h-[92vh] flex flex-col">
                        <DrawerHeader className="pb-4">
                            <DrawerTitle className="text-xl font-black tracking-tight">
                                Swap Offers
                            </DrawerTitle>
                            <DrawerDescription className="text-sm font-medium mt-1 text-muted-foreground">
                                {displayOffers.length} active offer{displayOffers.length !== 1 ? 's' : ''} for this request
                            </DrawerDescription>
                        </DrawerHeader>

                        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6 custom-scrollbar">
                            {isLoadingOffers ? (
                                [1, 2].map(i => <Skeleton key={i} className="h-64 w-full rounded-[2rem] bg-muted/40" />)
                            ) : displayOffers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 opacity-30">
                                    <MessageSquare className="h-8 w-8 mb-3 stroke-[1]" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No Offers Yet</p>
                                </div>
                            ) : (
                                displayOffers.map((offer) => (
                                    <div key={offer.id} className="space-y-4 p-5 rounded-[2rem] border border-border bg-card shadow-sm">
                                        {/* Header */}
                                        <div className="flex items-center justify-between pb-4 border-b border-border/50">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-10 w-10 border border-border/50">
                                                    <AvatarFallback className="text-[11px] font-black bg-muted">
                                                        {getInitials(offer.offerer?.full_name || '?')}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="text-sm font-black text-foreground">
                                                        {offer.offerer?.full_name || 'Anonymous'}
                                                    </p>
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                                                        {[offer.offered_shift?.organizations?.name, offer.offered_shift?.departments?.name, offer.offered_shift?.sub_departments?.name].filter(Boolean).join(' → ') || 'Unspecified'}
                                                    </p>
                                                </div>
                                            </div>
                                            <Badge className={cn(
                                                'text-[9px] h-5 px-2 font-black uppercase tracking-widest',
                                                offer.status === 'SUBMITTED' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                                    offer.status === 'SELECTED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                        'bg-slate-500/10 text-slate-500 border-slate-500/20'
                                            )} variant="outline">
                                                {offer.status === 'SUBMITTED' ? 'Pending' : offer.status}
                                            </Badge>
                                        </div>

                                        {/* Swap comparison */}
                                        <div className="flex items-center gap-3">
                                            <div className={cn('flex-1 p-4 rounded-2xl border flex flex-col items-center gap-2 text-center', getGroupColor(offer.offered_shift?.group_type || offer.offered_shift?.roles?.group_type || offer.offered_shift?.roles?.groupType, offer.offered_shift?.departments?.name))}>
                                                <span className="text-[9px] font-black uppercase tracking-widest opacity-60">They Give</span>
                                                <div className="text-xs font-black text-foreground">
                                                    {offer.offered_shift ? format(new Date(offer.offered_shift.shiftDate), 'EEE, MMM d') : 'N/A'}
                                                </div>
                                                <div className="text-[10px] font-bold opacity-70">
                                                    {offer.offered_shift ? `${formatTime(offer.offered_shift.startTime)} – ${formatTime(offer.offered_shift.endTime)}` : 'N/A'}
                                                </div>
                                            </div>
                                            <div className="h-8 w-8 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0">
                                                <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                                            </div>
                                            <div className={cn('flex-1 p-4 rounded-2xl border flex flex-col items-center gap-2 text-center', getGroupColor((myShift as any)?.group_type || (myShift as any)?.roles?.group_type || (myShift as any)?.roles?.groupType, (myShift as any)?.departments?.name))}>
                                                <span className="text-[9px] font-black uppercase tracking-widest opacity-60">You Give</span>
                                                <div className="text-xs font-black text-foreground">
                                                    {myShift ? format(new Date(myShift.shiftDate), 'EEE, MMM d') : 'N/A'}
                                                </div>
                                                <div className="text-[10px] font-bold opacity-70">
                                                    {myShift ? `${formatTime(myShift.startTime)} – ${formatTime(myShift.endTime)}` : 'N/A'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                                            <Info className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                            <p className="text-[11px] text-amber-500/80 font-medium leading-relaxed">
                                                Approving this offer will automatically decline all other pending offers.
                                            </p>
                                        </div>

                                        {/* Actions */}
                                        {offer.status === 'SUBMITTED' && currentSwap?.status === 'OPEN' ? (
                                            <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
                                                <Button
                                                    onClick={() => onAccept(offer)}
                                                    disabled={isAccepting || isDeclining}
                                                    className="h-13 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-indigo-600 hover:bg-indigo-500 text-white mt-2"
                                                >
                                                    {isAccepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" />Approve & Send to Manager</>}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => setShowRejectConfirm(offer.id)}
                                                    disabled={isAccepting || isDeclining}
                                                    className="h-11 rounded-2xl font-black text-[10px] uppercase tracking-widest text-muted-foreground hover:text-rose-500 hover:bg-rose-500/5"
                                                >
                                                    Reject Offer
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className={cn(
                                                'flex items-center justify-center gap-3 p-4 rounded-2xl border text-[11px] font-black uppercase tracking-widest mt-2',
                                                offer.status === 'SELECTED' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-slate-500/10 border-slate-500/30 text-slate-500'
                                            )}>
                                                {offer.status === 'SELECTED' ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                                {offer.status === 'SELECTED' ? 'Awaiting Manager' : offer.status}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="px-4 pb-6 pt-2 border-t border-border">
                            <Button
                                onClick={onClose}
                                className="w-full h-11 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-[10px] font-black uppercase tracking-widest border border-border"
                            >
                                Dismiss
                            </Button>
                        </div>
                    </DrawerContent>
                </Drawer>

                <AlertDialog open={!!showRejectConfirm} onOpenChange={() => setShowRejectConfirm(null)}>
                    <AlertDialogContent className="bg-background border border-border rounded-[2rem] p-8 max-w-sm">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-xl font-black tracking-tight">Decline Offer?</AlertDialogTitle>
                            <AlertDialogDescription className="text-muted-foreground text-sm font-medium">
                                This specific offer will be rejected. You can still accept other offers for this request.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="mt-6 gap-3">
                            <AlertDialogCancel className="h-12 rounded-xl font-black text-[10px] uppercase tracking-widest bg-muted/50 border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                className="flex-1 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-500/10 transition-all"
                                onClick={handleReject}
                                disabled={isDeclining}
                            >
                                {isDeclining ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Confirm Rejection
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </>
        );
    }

    const modalContent = (
        <>
                    <VisuallyHidden>
                        <DialogTitle>Received Offers</DialogTitle>
                        <DialogDescription>
                            Review and respond to shift swap offers for your request.
                        </DialogDescription>
                    </VisuallyHidden>

                    <div className={cn("flex flex-1 min-h-0", isMobile ? "flex-col overflow-y-auto" : "h-full")}>
                        {/* LEFT PANE: INBOX */}
                        <div className={cn("border-border flex flex-col bg-muted/20", isMobile ? "border-b" : "w-[320px] border-r")}>

                            <div className="p-8 pb-6">
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600/20 to-indigo-400/10 flex items-center justify-center border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                                        <Inbox className="h-4.5 w-4.5 text-indigo-400" />
                                    </div>
                                    <div className="flex flex-col">
                                        <h2 className="text-lg font-black text-foreground tracking-tight leading-none">Offers</h2>
                                        <p className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.15em] mt-1.5 opacity-60">
                                            Swap Inbox
                                        </p>
                                    </div>

                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-2 custom-scrollbar">
                                {isLoadingOffers ? (
                                    <div className="space-y-2 px-2">
                                        {[1, 2, 3].map(i => (
                                            <Skeleton key={i} className="h-20 w-full rounded-xl bg-muted/40" />
                                        ))}
                                    </div>

                                ) : displayOffers.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                                        <MessageSquare className="h-8 w-8 mb-4 stroke-[1]" />
                                        <p className="text-[10px] font-black uppercase tracking-widest leading-none">No Offers</p>
                                    </div>
                                ) : (
                                    displayOffers.map((offer) => (
                                        <button
                                            key={offer.id}
                                            onClick={() => setSelectedOfferId(offer.id)}
                                            className={cn(
                                                "w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative overflow-hidden group active:scale-[0.98]",
                                                selectedOfferId === offer.id
                                                    ? "bg-indigo-500/10 border-indigo-500/40 shadow-sm"
                                                    : "bg-card border-border hover:bg-muted/50"
                                            )}

                                        >
                                            <div className="flex items-center justify-between">
                                                <span className={cn(
                                                    "text-[13px] font-black tracking-tight transition-colors",
                                                    selectedOfferId === offer.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                                                )}>
                                                    {offer.offerer?.full_name || 'Anonymous'}
                                                </span>

                                                <Badge className={cn(
                                                    "text-[8px] h-4 px-1 px-1.5 font-black uppercase tracking-widest",
                                                    offer.status === 'SUBMITTED' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                                        offer.status === 'SELECTED' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                                            "bg-slate-500/10 text-slate-500 border-slate-500/20"
                                                )} variant="outline">
                                                    {offer.status === 'SUBMITTED' ? 'Pending' : offer.status}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground tracking-tight">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3 opacity-50" />
                                                    {offer.offered_shift ? format(new Date(offer.offered_shift.shiftDate), 'MMM d') : 'N/A'}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3 opacity-50" />
                                                    {offer.offered_shift ? offer.offered_shift.startTime.slice(0, 5) : 'N/A'}
                                                </div>
                                            </div>

                                            {selectedOfferId === offer.id && (
                                                <motion.div layoutId="activeInboxGlow" className="absolute inset-0 rounded-xl ring-1 ring-indigo-500/50" />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* MIDDLE PANE: DETAILS */}
                        <div className="flex-1 flex flex-col bg-background relative overflow-hidden h-full">

                            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 blur-[120px] rounded-full pointer-events-none" />
                            <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-blue-600/5 blur-[100px] rounded-full pointer-events-none" />

                            <AnimatePresence mode="wait">
                                {selectedOffer ? (
                                    <motion.div
                                        key={selectedOffer.id}
                                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.98, y: -10 }}
                                        transition={{ duration: 0.3, ease: "easeOut" }}
                                        className="flex-1 flex flex-col p-10 relative z-10 overflow-y-auto custom-scrollbar"
                                    >
                                        <div className="max-w-[520px] mx-auto w-full flex flex-col h-full">
                                            {/* Hero Area */}
                                            <div className="mb-10 text-center">
                                                <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-indigo-600/10 border border-indigo-500/20 shadow-inner shadow-indigo-500/5">
                                                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                                                        Swap Offer Details
                                                    </span>
                                                </div>
                                                <h2 className="text-4xl font-black text-foreground tracking-tighter leading-none mb-4">
                                                    {selectedOffer.offered_shift?.roles?.name || 'Open Shift'}
                                                </h2>
                                                <p className="text-sm text-muted-foreground font-medium leading-relaxed max-w-[400px] mx-auto">
                                                    Offered by {selectedOffer.offerer?.full_name || 'a teammate'} in exchange for your shift.
                                                </p>

                                            </div>

                                            {/* Swap Comparison */}
                                            <div className="flex items-center gap-4 mb-8">
                                                <div className={cn(
                                                    "flex-1 p-5 rounded-3xl border flex flex-col items-center gap-3",
                                                    getGroupColor(selectedOffer.offered_shift?.group_type || selectedOffer.offered_shift?.roles?.group_type || selectedOffer.offered_shift?.roles?.groupType, selectedOffer.offered_shift?.departments?.name)
                                                )}>
                                                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">They Give</span>
                                                    <div className="text-center">
                                                        <div className="text-sm font-black text-foreground">
                                                            {selectedOffer.offered_shift ? format(new Date(selectedOffer.offered_shift.shiftDate), 'EEE, MMM d') : 'N/A'}
                                                        </div>
                                                        <div className="text-[11px] font-bold opacity-80">
                                                            {selectedOffer.offered_shift ? `${formatTime(selectedOffer.offered_shift.startTime)} - ${formatTime(selectedOffer.offered_shift.endTime)}` : 'N/A'}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="h-10 w-10 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0">
                                                    <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                                                </div>


                                                <div className={cn(
                                                    "flex-1 p-5 rounded-3xl border flex flex-col items-center gap-3",
                                                    getGroupColor((myShift as any)?.group_type || (myShift as any)?.roles?.group_type || (myShift as any)?.roles?.groupType, (myShift as any)?.departments?.name)
                                                )}>
                                                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">You Give</span>
                                                    <div className="text-center">
                                                        <div className="text-sm font-black text-foreground">
                                                            {myShift ? format(new Date(myShift.shiftDate), 'EEE, MMM d') : 'N/A'}
                                                        </div>
                                                        <div className="text-[11px] font-bold opacity-80">
                                                            {myShift ? `${formatTime(myShift.startTime)} - ${formatTime(myShift.endTime)}` : 'N/A'}
                                                        </div>
                                                    </div>
                                                </div>

                                            </div>

                                            {/* Detailed Info Cards */}
                                            <div className="space-y-4 mb-10 text-slate-300">
                                                <div className="bg-white/[0.02] border border-white/5 p-5 rounded-3xl space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                                                <Building className="h-4 w-4 text-emerald-400" />
                                                            </div>
                                                            <div>
                                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Location</div>
                                                                <div className="text-[11px] font-bold text-foreground">

                                                                    {[
                                                                        selectedOffer.offered_shift?.organizations?.name,
                                                                        selectedOffer.offered_shift?.departments?.name,
                                                                        selectedOffer.offered_shift?.sub_departments?.name
                                                                    ].filter(Boolean).join(' → ') || 'Unspecified'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <Separator className="bg-white/5" />

                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                                <ShieldCheck className="h-4 w-4 text-blue-400" />
                                                            </div>
                                                            <div>
                                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Compliance & Validation</div>
                                                                <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">

                                                                    <Check className="h-3 w-3" />
                                                                    Validated - No Conflicts
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                                                    <Info className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                                    <p className="text-[11px] text-amber-500/80 font-medium leading-relaxed">
                                                        Approving this offer will automatically decline all other pending offers for this swap request.
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            {selectedOffer.status === 'SUBMITTED' && currentSwap?.status === 'OPEN' ? (
                                                <div className="flex flex-col gap-3 mt-auto mb-4">
                                                    <Button
                                                        onClick={handleAccept}
                                                        disabled={isAccepting || isDeclining}
                                                        className="h-14 rounded-2xl font-black text-sm uppercase tracking-[0.2em] bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_10px_30px_-10px_rgba(79,70,229,0.3)] border-b-4 border-indigo-800 active:scale-[0.98] active:border-b-0 transition-all"
                                                    >
                                                        {isAccepting ? (
                                                            <Loader2 className="h-5 w-5 animate-spin" />
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <Send className="h-5 w-5" />
                                                                <span>Approve & Send to Manager</span>
                                                            </div>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        onClick={() => setShowRejectConfirm(selectedOffer.id)}
                                                        disabled={isAccepting || isDeclining}
                                                        className="h-12 rounded-2xl font-black text-[10px] uppercase tracking-widest text-muted-foreground hover:text-rose-500 hover:bg-rose-500/5 transition-all"
                                                    >
                                                        Reject Offer
                                                    </Button>

                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center py-6 mt-auto">
                                                    <div className={cn(
                                                        "inline-flex items-center gap-3 px-8 py-4 rounded-3xl border text-sm font-black uppercase tracking-widest mb-2",
                                                        (selectedOffer.status === 'SELECTED') ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-500/10 border-slate-500/30 text-slate-400"
                                                    )}>
                                                        {(selectedOffer.status === 'SELECTED') ? <CheckCircle2 className="h-5 w-5" /> : <X className="h-5 w-5" />}
                                                        {selectedOffer.status === 'SELECTED' ? 'Awaiting Manager' : selectedOffer.status}
                                                    </div>
                                                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest text-center max-w-[300px]">
                                                        {selectedOffer.status === 'SELECTED'
                                                            ? 'This offer has been selected and is awaiting final administrative verification.'
                                                            : 'This offer is no longer active for selection.'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center p-12">
                                        <div className="h-28 w-28 rounded-[2.5rem] bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/5 flex items-center justify-center mb-10 shadow-2xl">
                                            <Inbox className="h-10 w-10 text-slate-700 animate-pulse" />
                                        </div>
                                        <h3 className="text-2xl font-black text-white mb-3 tracking-tighter">Selection Required</h3>
                                        <p className="text-sm text-slate-500 max-w-[280px] font-medium leading-relaxed">
                                            Select an offer from the inbox to analyze swap terms and compliance metrics.
                                        </p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* RIGHT PANE: REQUEST STATUS / HISTORY (hidden on mobile) */}
                        <div className={cn("border-l border-border flex flex-col bg-muted/20", isMobile ? "hidden" : "w-[300px]")}>

                            <div className="p-10 pb-6">
                                <div className="flex items-center gap-3 mb-8 text-amber-500">
                                    <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                        <HistoryIcon className="h-4.5 w-4.5" />
                                    </div>
                                    <h2 className="text-xs font-black text-foreground uppercase tracking-widest opacity-80">Request Lifecycle</h2>
                                </div>
                                <Separator className="bg-border/50" />

                            </div>

                            <div className="flex-1 overflow-y-auto px-8 pb-10 custom-scrollbar">
                                <div className="space-y-8 relative pl-6 before:absolute before:left-0 before:top-1 before:bottom-0 before:w-px before:bg-border">

                                    {/* Lifecycle Steps */}
                                    {[
                                        { id: 'created', label: 'Request Created', icon: Check, active: timeline.created, desc: 'Your swap request is live.' },
                                        { id: 'offered', label: 'Offer Received', icon: Inbox, active: timeline.offerReceived, desc: 'Teammates have sent offers.' },
                                        { id: 'selected', label: 'Selection Made', icon: UserCheck, active: timeline.selection, desc: 'Awaiting manager approval.' },
                                        { id: 'manager', label: 'Final Approval', icon: CheckCircle2, active: timeline.manager, desc: 'Swap is fully completed.' }
                                    ].map((step, idx) => (
                                        <div key={step.id} className="relative">
                                            <div className={cn(
                                                "absolute left-[-30px] top-0 h-4 w-4 rounded-full border-2 border-background transition-all duration-500 flex items-center justify-center",
                                                step.active ? "bg-indigo-500 shadow-[0_0_12px_rgba(79,70,229,0.4)]" : "bg-muted border-border"
                                            )}>

                                                <step.icon className={cn("h-2 w-2", step.active ? "text-white" : "text-slate-600")} />
                                            </div>
                                            <div className={cn(
                                                "text-[10px] font-black uppercase tracking-widest mb-1 transition-colors",
                                                step.active ? "text-foreground" : "text-muted-foreground/40"
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

                                <div className="mt-20 p-5 rounded-2xl bg-muted/30 border border-border">
                                    <div className="flex gap-3 mb-3">
                                        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/30 mt-0.5" />
                                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Compliance Note</div>
                                    </div>
                                    <p className="text-[10px] font-medium leading-relaxed text-muted-foreground/60">
                                        All swaps are subject to shift eligibility, fatigue management, and manager verification.
                                    </p>
                                </div>

                            </div>

                            <div className="p-8 border-t border-border bg-muted/10">
                                <Button
                                    onClick={onClose}
                                    className="w-full h-10 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-[10px] font-black uppercase tracking-widest border border-border transition-all font-inter"
                                >
                                    Dismiss Portal
                                </Button>
                            </div>

                        </div>
                    </div>
        </>
    );

    return (
        <>
            {isMobile ? (
                <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
                    <DrawerContent className="h-[92dvh] bg-background border-border p-0 overflow-hidden flex flex-col">
                        {modalContent}
                    </DrawerContent>
                </Drawer>
            ) : (
                <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                    <DialogContent
                        className="sm:max-w-[1040px] h-[720px] max-h-[85vh] bg-background border border-border p-0 overflow-hidden shadow-2xl flex flex-col rounded-[2.5rem] [&>button]:hidden"
                    >
                        {modalContent}
                    </DialogContent>
                </Dialog>
            )}

            <AlertDialog open={!!showRejectConfirm} onOpenChange={() => setShowRejectConfirm(null)}>
                <AlertDialogContent className="bg-background border border-border rounded-[2rem] p-8 max-w-sm">

                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-xl font-black text-white tracking-tight">Decline Offer?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-500 text-sm font-medium">
                            This specific offer will be rejected. You can still accept other offers for this request.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-8 gap-3">
                        <AlertDialogCancel className="h-12 rounded-xl font-black text-[10px] uppercase tracking-widest bg-muted/50 border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                            Cancel
                        </AlertDialogCancel>

                        <AlertDialogAction
                            className="flex-1 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-500/10 transition-all"
                            onClick={handleReject}
                            disabled={isDeclining}
                        >
                            {isDeclining ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Confirm Rejection
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
