import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    ArrowLeftRight,
    Loader2,
    Eye,
    X,
    Clock,
    Calendar,
    Building2,
    CheckCircle2,
    XCircle,
    ShieldCheck,
    AlertTriangle,
    Lock,
    Zap,
    Signal,
    Filter,
    Flame,
    Gavel,
    UserPlus,
    Circle,
    UserCheck as LucideUserCheck,
    Megaphone,
    Hourglass,
    Ban,
    ThumbsUp,
    CheckCircle,
    Minus,
    ChevronRight,
    ListChecks,
    Check
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useSwaps } from '../../state/useSwaps';
import { ShiftSwap, swapsApi } from '../../api/swaps.api';
import { format, differenceInMinutes, parse } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { ViewOffersModal } from '../components/ViewOffersModal';
import { UnifiedSwapModal } from '../components/UnifiedSwapModal';
import { SwapSelectionToolbar } from '../components/SwapSelectionToolbar';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerClose } from '@/modules/core/ui/primitives/drawer';
import { useQuery } from '@tanstack/react-query';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useMinuteTick } from '@/modules/core/hooks/useMinuteTick';
import { computeShiftUrgency, ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';
import { calculateTimeRemaining, formatTimeRemaining } from '../../../../planning/bidding/ui/views/OpenBidsView/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';

type TabType = 'available-swaps' | 'my-offers' | 'my-swaps';
type SortOption = 'date-soonest' | 'date-latest';

// Helper to format time
const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};

// Premium Department Color Styling (Badges)
function getDeptColor(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return 'dept-badge-convention';
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return 'dept-badge-exhibition';
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return 'dept-badge-theatre';
    return 'dept-badge-default';
}

// Premium Card Background Styling — semantic CSS classes handle light/dark
function getCardBg(groupType: string | null | undefined, dept: string): string {
    const base = 'dept-card-glass-base';
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return `${base} dept-card-glass-convention`;
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return `${base} dept-card-glass-exhibition`;
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return `${base} dept-card-glass-theatre`;
    return `${base} dept-card-glass-default`;
}

function getRowClass(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return 'dept-row-convention';
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return 'dept-row-exhibition';
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return 'dept-row-theatre';
    return 'dept-row-default';
}

// Status configuration with icons, colors, and labels
const getStatusConfig = (status: string) => {
    switch (status) {
        case 'OPEN':
            return {
                icon: Clock,
                label: 'Open',
                helperText: 'Awaiting offers',
                textColor: 'text-amber-400',
            };
        case 'MANAGER_PENDING':
            return {
                icon: LucideUserCheck,
                label: 'Pending Manager',
                helperText: 'Awaiting approval',
                textColor: 'text-blue-400',
            };
        case 'APPROVED':
            return {
                icon: CheckCircle2,
                label: 'Approved',
                helperText: 'Approved',
                textColor: 'text-emerald-400',
            };
        case 'REJECTED':
            return {
                icon: XCircle,
                label: 'Rejected',
                helperText: 'Rejected',
                textColor: 'text-red-400',
            };
        case 'CANCELLED':
            return {
                icon: X,
                label: 'Cancelled',
                helperText: 'Cancelled',
                textColor: 'text-gray-400',
            };
        case 'EXPIRED':
            return {
                icon: Clock,
                label: 'Expired',
                helperText: 'Expired',
                textColor: 'text-gray-400',
            };
        default:
            return {
                icon: Clock,
                label: status,
                helperText: '',
                textColor: 'text-gray-400',
            };
    }
};

// =============================================================================
// SWAP PRIORITY — unified TTS derivation via shared bidding-urgency utility
// Rules: TTS > 24h = normal | 4–24h = urgent | <4h = locked
// =============================================================================

// Status configuration for table badges and consistency
const STATUS_CONFIG: Record<string, { label: string; icon: any; badgeCls: string }> = {
    OPEN: {
        label: 'Open',
        icon: Clock,
        badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
    MANAGER_PENDING: {
        label: 'Pending Manager',
        icon: LucideUserCheck,
        badgeCls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    },
    APPROVED: {
        label: 'Approved',
        icon: CheckCircle2,
        badgeCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    REJECTED: {
        label: 'Rejected',
        icon: XCircle,
        badgeCls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    },
    CANCELLED: {
        label: 'Cancelled',
        icon: X,
        badgeCls: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    },
    EXPIRED: {
        label: 'Expired',
        icon: AlertTriangle,
        badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    },
};

/** Re-export so ManagerSwaps can import from one place */
export type SwapPriority = ShiftUrgency;

/**
 * Compute swap/offer priority — delegates to the shared TTS utility.
 * Accepts either (shiftDate, startTime) or an ISO startAt datetime.
 */
export const getSwapPriority = (
    _now: Date,
    shiftDate?: string,
    startTime?: string,
    startAt?: string,
    _tzIdentifier?: string,
): SwapPriority => {
    return computeShiftUrgency(shiftDate ?? '', startTime ?? '', startAt);
};

export const PRIORITY_CONFIG: Record<SwapPriority, {
    label: string;
    badgeCls: string;
    icon: React.ElementType;
    chipActiveCls: string;
    color: string;
}> = {
    emergent: {
        label: 'Emergent',
        badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
        icon: Flame,
        chipActiveCls: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
        color: 'text-rose-500',
    },
    urgent: {
        label: 'Urgent',
        badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        icon: Zap,
        chipActiveCls: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
        color: 'text-amber-500',
    },
    normal: {
        label: 'Normal',
        badgeCls: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
        icon: Signal,
        chipActiveCls: 'bg-muted/40 border-border text-foreground',
        color: 'text-slate-400',
    },
};

// ============================================================================
// MOTION VARIANTS
// ============================================================================
const pageVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } }
};
const itemVariants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { ease: [0.16, 1, 0.3, 1], duration: 0.4 } }
};
const listItemSpring = {
    layout: true as const,
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } },
    exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }
};

// =============================================================================
// Calculate countdown to shift close (4h before start) in Sydney timezone

// Helper to check if a swap is expired (4h before start)
export const getSwapTimer = (now: Date, startAt?: string, shiftDate?: string, startTime?: string, tzIdentifier?: string) => {
    if (!startAt && (!shiftDate || !startTime)) return null;

    // Safety: ensure startTime is only HH:mm if it contains seconds
    const cleanStartTime = startTime?.includes(':') ? startTime.split(':').slice(0, 2).join(':') : startTime;

    const shiftStartUtc = startAt
        ? new Date(startAt)
        : parseZonedDateTime(shiftDate as string, cleanStartTime as string, tzIdentifier || SYDNEY_TZ);

    if (isNaN(shiftStartUtc.getTime())) {
        console.warn('[Timer] Invalid shift start date/time:', { shiftDate, startTime, cleanStartTime });
        return null;
    }

    const closeTime = new Date(shiftStartUtc.getTime() - 4 * 60 * 60 * 1000); // 4 hours before
    const diffMs = closeTime.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `Expires in ${hours}h ${minutes}m`;
    }
    return `Expires in ${minutes}m`;
};

// Simplified check for styling
const isSwapExpired = (now: Date, startAt?: string, shiftDate?: string, startTime?: string, tzIdentifier?: string): boolean => {
    const tr = calculateTimeRemaining(startAt || (shiftDate && startTime ? `${shiftDate}T${startTime}` : ''));
    return tr.isExpired;
};

export const EmployeeSwapsPage: React.FC = () => {
    const now = useMinuteTick();
    const { toast } = useToast();
    const { isDark } = useTheme();
    // Personal scope filter
    const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

    const {
        mySwapRequests,
        availableSwaps,
        myActiveOfferSwapIds,
        isLoading,
        makeOffer,
        acceptOffer,
        declineOffer,
        cancelSwap,
        refetchMySwaps,
        refetchAvailable,
        isMakingOffer,
        isAccepting,
        isDeclining,
        isCancelling,
        userId,
    } = useSwaps({
        organizationId: scope.org_ids[0],
        departmentId: scope.dept_ids.length > 0 ? scope.dept_ids : null,
        subDepartmentId: scope.subdept_ids.length > 0 ? scope.subdept_ids : null
    });

    // §2 Combined State helper — derive C1-C7 from swap status
    const getCombinedState = (status: string): string => {
        switch (status) {
            case 'OPEN': return 'C2: S9/OPEN';
            case 'MANAGER_PENDING': return 'C3: S10/MGR_PENDING';
            case 'APPROVED': return 'C4: S4/APPROVED';
            case 'REJECTED': return 'C5: S4/REJECTED';
            case 'CANCELLED': return 'C6: S4/CANCELLED';
            case 'EXPIRED': return 'C7: S4/EXPIRED';
            default: return `?/${status}`;
        }
    };

    // State
    const [activeTab, setActiveTab] = useState<TabType>('available-swaps');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [priorityFilter, setPriorityFilter] = useState<ShiftUrgency | 'all'>('all');
    const [startDate, setStartDate] = useState<Date>(() => {
        const saved = localStorage.getItem('swaps_filter_start_date');
        if (saved) {
            const parsed = new Date(saved);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d;
    });
    const [endDate, setEndDate]     = useState<Date>(() => {
        const saved = localStorage.getItem('swaps_filter_end_date');
        if (saved) {
            const parsed = new Date(saved);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d;
    });
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

    React.useEffect(() => {
        localStorage.setItem('swaps_filter_start_date', startDate.toISOString());
    }, [startDate]);

    React.useEffect(() => {
        localStorage.setItem('swaps_filter_end_date', endDate.toISOString());
    }, [endDate]);

    // Modal State
    const [offerSwapTarget, setOfferSwapTarget] = useState<ShiftSwap | null>(null);
    const [viewOffersSwapId, setViewOffersSwapId] = useState<string | null>(null);

    // Confirmation dialog state
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        swap: ShiftSwap | null;
    }>({
        isOpen: false,
        swap: null,
    });

    // Selection State
    const [selectedSwapIds, setSelectedSwapIds] = useState<string[]>([]);
    const [isBulkModeActive, setIsBulkModeActive] = useState<boolean>(false);
    const [drawerSwap, setDrawerSwap] = useState<{ swap: ShiftSwap; tab: TabType } | null>(null);

    // Clear selection when switching tabs or exiting bulk mode
    React.useEffect(() => {
        setSelectedSwapIds([]);
    }, [activeTab, isBulkModeActive]);

    // Handle refresh
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await Promise.all([refetchMySwaps(), refetchAvailable()]);
        setIsRefreshing(false);
        toast({
            title: 'Refreshed',
            description: 'Swap requests have been updated.',
        });
    }, [refetchMySwaps, refetchAvailable, toast]);

    // Sorting
    const availableSort = useTableSorting(availableSwaps, { key: 'created_at', direction: 'desc' });
    const myOffersSort = useTableSorting(mySwapRequests.filter(s => s.requester_id !== userId), { key: 'created_at', direction: 'desc' });
    const mySwapsSort = useTableSorting(mySwapRequests.filter(s => s.requester_id === userId), { key: 'created_at', direction: 'desc' });

    // Handle Make Offer Confirmation
    const handleMakeOffer = (targetV8ShiftId: string | undefined) => {
        if (offerSwapTarget) {
            makeOffer({ swapId: offerSwapTarget.id, targetV8ShiftId });
            setOfferSwapTarget(null);
        }
    };

    // Confirm cancel
    const confirmCancel = useCallback(() => {
        if (confirmDialog.swap) {
            cancelSwap(confirmDialog.swap.id);
            setConfirmDialog({ isOpen: false, swap: null });
        }
    }, [confirmDialog, cancelSwap]);

    // 1. Manager Review Swaps — includes requests I created AND swaps where I offered
    const managerReviewSwaps = mySwapRequests.filter(s => s.status === 'MANAGER_PENDING');

    // 2. Filter my swap requests (Consolidated View)
    //    Include: OPEN, MANAGER_PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED
    //    Where I am the requester.
    const filteredMySwaps = React.useMemo(() => {
        const startStr = format(startDate, 'yyyy-MM-dd');
        const endStr = format(endDate, 'yyyy-MM-dd');
        return mySwapsSort.sortedData.filter((swap) => {
            // Only show swaps I created
            if (swap.requester_id !== userId) return false;

            const shift = (swap as any).requester_shift;
            
            // Date filter
            const shiftDateStr = shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : shift?.shift_date;
            if (shiftDateStr && (shiftDateStr < startStr || shiftDateStr > endStr)) return false;

            // Priority filter
            if (priorityFilter !== 'all') {
                const p = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
                if (p !== priorityFilter) return false;
            }

            return true;
        });
    }, [mySwapsSort.sortedData, userId, priorityFilter, now, startDate, endDate]);

    // 3. Filter available swaps — NO DUPLICATES with My Swap Offers
    const filteredAvailableSwaps = React.useMemo(() => {
        const startStr = format(startDate, 'yyyy-MM-dd');
        const endStr = format(endDate, 'yyyy-MM-dd');
        return availableSort.sortedData.filter((swap) => {
            // Exclude my own swaps (safety check)
            if (swap.requester_id === userId) return false;
            // Exclude if already pending manager (not open for offers anymore)
            if (swap.status === 'MANAGER_PENDING') return false;
            // Exclude if I already offered on this swap
            if (myActiveOfferSwapIds.has(swap.id)) return false;

            const shift = (swap as any).requester_shift;
            
            // Date filter
            const shiftDateStr = shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : shift?.shift_date;
            if (shiftDateStr && (shiftDateStr < startStr || shiftDateStr > endStr)) return false;

            // Priority filter
            if (priorityFilter !== 'all') {
                const p = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
                if (p !== priorityFilter) return false;
            }

            return true;
        });
    }, [availableSort.sortedData, userId, myActiveOfferSwapIds, priorityFilter, now, startDate, endDate]);

    // 4. My Swap Offers — swaps where I offered (requester_id !== userId)
    const filteredMyOffers = React.useMemo(() => {
        const startStr = format(startDate, 'yyyy-MM-dd');
        const endStr = format(endDate, 'yyyy-MM-dd');
        return myOffersSort.sortedData.filter((swap) => {
            // Already filtered in myOffersSort for requester_id !== userId
            // But double check my offer exists
            const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
            if (!myOffer) return false;
            
            const shift = (swap as any).requester_shift;
            
            // Date filter
            const shiftDateStr = shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : shift?.shift_date;
            if (shiftDateStr && (shiftDateStr < startStr || shiftDateStr > endStr)) return false;
            
            return true;
        });
    }, [myOffersSort.sortedData, userId, startDate, endDate]);


    // ========================================================================
    // SELECTION HANDLERS
    // ========================================================================
    const handleSelectSwap = (id: string, label: string) => {
        setSelectedSwapIds(prev => {
            const isAdding = !prev.includes(id);
            if (isAdding) {
                toast({
                    description: `Selected: ${label}`,
                    duration: 1500,
                });
                return [...prev, id];
            } else {
                return prev.filter(i => i !== id);
            }
        });
    };

    const handleSelectAll = (ids: string[]) => {
        setSelectedSwapIds(ids);
        if (ids.length > 0) {
            toast({
                description: `Selected all ${ids.length} items`,
                duration: 2000,
            });
        }
    };

    const handleDeselectAll = () => {
        setSelectedSwapIds([]);
        toast({
            description: "Deselected all items",
            duration: 1500,
        });
    };


    const handleBulkWithdraw = async () => {
        const results = await Promise.allSettled(
            selectedSwapIds.map(id => {
                const swap = mySwapRequests.find(s => s.id === id);
                const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
                if (myOffer) {
                    return declineOffer(myOffer.id); 
                }
                return Promise.resolve();
            })
        );
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        toast({ title: `${succeeded} offer(s) withdrawn` });
        setSelectedSwapIds([]);
        refetchMySwaps();
    };

    const handleBulkCancel = async () => {
        const results = await Promise.allSettled(
            selectedSwapIds.map(id => cancelSwap(id))
        );
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        toast({ title: `${succeeded} request(s) cancelled` });
        setSelectedSwapIds([]);
        refetchMySwaps();
    };

    // ========================================================================
    // RENDER: My Swap Offer Card (state-machine driven)
    // ========================================================================
    const renderMyOfferCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);

        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const isExpired = tr.isExpired;

        // Terminal check for timer redundancy
        const isTerminalSwap = swap.status === 'APPROVED' || swap.status === 'REJECTED' || swap.status === 'CANCELLED' || swap.status === 'MANAGER_PENDING' || myOffer?.status === 'WITHDRAWN';
        const timerDisplay = isTerminalSwap ? null : (isExpired ? 'Expired' : timerText ? `Closes in ${timerText}` : null);

        // Derive status from state machine
        const deriveOfferStatus = () => {
            if (isExpired) return { label: 'Expired', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
            if (myOffer?.status === 'WITHDRAWN') return { label: 'Withdrawn', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
            if (myOffer?.status === 'REJECTED') return { label: 'Peer Rejected', color: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400' };
            if (swap.status === 'APPROVED') return { label: 'Accepted', color: 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' };
            if (swap.status === 'REJECTED') return { label: 'Rejected', color: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400' };
            if (myOffer?.status === 'SELECTED' && swap.status === 'MANAGER_PENDING') return { label: 'Pending Manager Review', color: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400' };
            if (myOffer?.status === 'SUBMITTED') return { label: 'Pending Peer Review', color: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400' };
            return { label: 'Pending', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
        };

        const status = deriveOfferStatus();

        // Consistent groupVariant derivation (same as renderMySwapCard / renderAvailableSwapCard)
        const offerGroupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' =
            (shift?.group_type === 'convention_centre' || shift?.roles?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || shift?.roles?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || shift?.roles?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        // Derive status icon + label for the icon grid
        const isAwaitingMgr = myOffer?.status === 'SELECTED' && swap.status === 'MANAGER_PENDING';
        const isAwaitingPeer = myOffer?.status === 'SUBMITTED';
        const offerStatusIcon = isExpired || myOffer?.status === 'WITHDRAWN' || swap.status === 'REJECTED' || myOffer?.status === 'REJECTED'
            ? <Ban className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />
            : swap.status === 'APPROVED'
                ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500/60" />
                : isAwaitingMgr
                    ? <LucideUserCheck className="w-3.5 h-3.5 text-amber-500/60" />
                    : isAwaitingPeer
                        ? <Hourglass className="w-3.5 h-3.5 text-blue-500/60" />
                        : <Clock className="w-3.5 h-3.5 text-muted-foreground/40" />;
        const offerStatusLabel = isExpired ? 'Expired'
            : myOffer?.status === 'WITHDRAWN' ? 'Withdrawn'
            : swap.status === 'APPROVED' ? 'Accepted'
            : swap.status === 'REJECTED' || myOffer?.status === 'REJECTED' ? 'Rejected'
            : isAwaitingMgr ? 'Pending Manager Review'
            : isAwaitingPeer ? 'Pending Peer Review'
            : 'Pending';

        return (
            <motion.div key={swap.id} {...listItemSpring} whileHover={{ y: -2, transition: { duration: 0.15 } }} whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}>
                <SharedShiftCard
                    variant="timecard"
                    organization={shift?.organizations?.name || ''}
                    department={shift?.departments?.name || ''}
                    subGroup={shift?.sub_departments?.name}
                    role={shift?.roles?.name || 'Unknown Role'}
                    shiftDate={shift?.shift_date || ''}
                    startTime={shift?.start_time || ''}
                    endTime={shift?.end_time || ''}
                    netLength={shift?.net_length_minutes || 0}
                    paidBreak={shift?.paid_break_minutes ?? 0}
                    unpaidBreak={shift?.unpaid_break_minutes ?? 0}
                    timerText={timerDisplay}
                    isExpired={isExpired}
                    groupVariant={offerGroupVariant}

                    footerActions={
                        <div className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-sm font-medium ${status.color}`}>
                            {status.label === 'Accepted' ? <CheckCircle className="h-4 w-4" /> :
                             status.label === 'Expired' || status.label === 'Withdrawn' ? <Ban className="h-4 w-4" /> :
                             status.label.includes('Rejected') ? <XCircle className="h-4 w-4" /> :
                             <Clock className="h-4 w-4" />}
                            {status.label}
                        </div>
                    }
                    topContent={
                        isBulkModeActive ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={selectedSwapIds.includes(swap.id)}
                                    onChange={() => handleSelectSwap(swap.id, `Offer: ${shift?.roles?.name || 'Shift'}`)}
                                    className="h-4 w-4 rounded border-border/50 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                                />
                                <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">Select</span>
                            </div>
                        ) : undefined
                    }
                />
            </motion.div>
        );
    };


    // Render swap card for "My Requests" and "Manager Review" tab
    const renderMySwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const statusConfig = getStatusConfig(swap.status);
        const StatusIcon = statusConfig.icon;
        
        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const priority = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
        
        const isExpired = tr.isExpired;
        const isTerminalRequest = swap.status === 'APPROVED' || swap.status === 'REJECTED' || swap.status === 'CANCELLED' || swap.status === 'MANAGER_PENDING';
        const timerDisplay = isTerminalRequest ? null : timerText;

        const groupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' = 
            (shift?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        return (
            <motion.div key={swap.id} {...listItemSpring} whileHover={{ y: -2, transition: { duration: 0.15 } }} whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}>
                <SharedShiftCard
                    variant="timecard"
                    organization={shift?.organizations?.name || 'ICC Sydney'}
                    department={shift?.departments?.name || 'Department'}
                    subGroup={shift?.sub_departments?.name}
                    role={shift?.roles?.name || 'Shift'}
                    shiftDate={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEEE, MMM d, yyyy') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEEE, MMM d, yyyy') : 'Unknown')}
                    startTime={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.start_time ? formatTime(shift.start_time) : '00:00')}
                    endTime={shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.end_time ? formatTime(shift.end_time) : '00:00')}
                    netLength={shift?.net_length_minutes || 0}
                    paidBreak={shift?.paid_break_minutes || 0}
                    unpaidBreak={shift?.unpaid_break_minutes || 0}
                    timerText={timerDisplay}
                    isExpired={isExpired}
                    urgency={priority}
                    lifecycleStatus={shift?.lifecycle_status}
                    groupVariant={groupVariant}

                    footerActions={
                        <div className="flex flex-col gap-1.5">
                            {/* ── EXPIRY GLOBAL OVERRIDE ── */}
                            {isExpired ? (
                                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm font-medium">
                                <Ban className="h-4 w-4" /> Expired
                            </div>
                        ) : swap.status === 'APPROVED' ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                <CheckCircle className="h-4 w-4" /> Accepted
                            </div>
                        ) : swap.status === 'REJECTED' ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                                <XCircle className="h-4 w-4" /> Rejected
                            </div>
                        ) : swap.status === 'CANCELLED' ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm font-medium">
                                <Ban className="h-4 w-4" /> Cancelled
                            </div>
                        ) : swap.status === 'MANAGER_PENDING' ? (
                            <>
                                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                                    <Clock className="h-4 w-4" /> Awaiting Manager Review
                                </div>
                                <Button
                                    variant="outline"
                                    className="w-full border-border/10 hover:bg-primary/10 h-9"
                                    onClick={() => setViewOffersSwapId(swap.id)}
                                >
                                    <Eye className="mr-1.5 h-4 w-4" /> Details
                                </Button>
                            </>
                        ) : (
                            /* OPEN state */
                            <>
                                <SwapCardOfferButton
                                    swapId={swap.id}
                                    onClick={() => setViewOffersSwapId(swap.id)}
                                />
                                <Button
                                    variant="outline"
                                    className="w-full border-border/10 hover:bg-rose-500/10 hover:text-rose-400 h-9"
                                    onClick={() => setConfirmDialog({ isOpen: true, swap })}
                                    disabled={isCancelling}
                                >
                                    <X className="mr-1.5 h-4 w-4" /> Cancel
                                </Button>
                            </>
                        )}
                    </div>
                }
                    topContent={
                        isBulkModeActive ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={selectedSwapIds.includes(swap.id)}
                                    onChange={() => handleSelectSwap(swap.id, `Swap: ${shift?.roles?.name || 'Shift'}`)}
                                    className="h-4 w-4 rounded border-border/50 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                                />
                                <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">Select</span>
                            </div>
                        ) : undefined
                    }
                />
            </motion.div>
        );
    };

    // Render available swap card
    const renderAvailableSwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const requesterName = (swap as any).requested_by?.full_name || (swap as any).requested_by?.email || 'Someone';
        
        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const isExpired = tr.isExpired;
        const hasOffered = myActiveOfferSwapIds.has(swap.id);
        const priority = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);

        const groupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' = 
            (shift?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        return (
            <motion.div key={swap.id} {...listItemSpring} whileHover={{ y: -2, transition: { duration: 0.15 } }} whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}>
                <SharedShiftCard
                variant="timecard"
                organization={shift?.organizations?.name || 'ICC Sydney'}
                department={shift?.departments?.name || 'Department'}
                subGroup={shift?.sub_departments?.name}
                role={shift?.roles?.name || 'Shift'}
                shiftDate={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEE, MMM d') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : 'Unknown')}
                startTime={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.start_time ? formatTime(shift.start_time) : '00:00')}
                endTime={shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.end_time ? formatTime(shift.end_time) : '00:00')}
                netLength={shift?.net_length_minutes || 0}
                paidBreak={shift?.paid_break_minutes || 0}
                unpaidBreak={shift?.unpaid_break_minutes || 0}
                timerText={timerText}
                isExpired={isExpired}
                urgency={priority}
                lifecycleStatus={shift?.lifecycle_status}
                groupVariant={groupVariant}

                footerActions={
                    isExpired ? (
                        <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm font-medium">
                            <Ban className="h-4 w-4" /> Expired
                        </div>
                    ) : (
                        <Button
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold h-10"
                            onClick={() => setOfferSwapTarget(swap)}
                            disabled={isMakingOffer}
                        >
                            <ArrowLeftRight className="mr-1.5 h-4 w-4" />
                            Offer Swap
                        </Button>
                    )
                }
                topContent={
                    isBulkModeActive ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={selectedSwapIds.includes(swap.id)}
                                onChange={() => handleSelectSwap(swap.id, `Market: ${shift?.roles?.name || 'Shift'}`)}
                                className="h-4 w-4 rounded border-border/50 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                                disabled={hasOffered}
                            />
                            <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">Select</span>
                        </div>
                    ) : undefined
                }
            />
            </motion.div>
        );
    };

    // ========================================================================
    // RENDER: Compact mobile list row (table view on mobile)
    // ========================================================================
    const renderSwapListItem = (swap: ShiftSwap, tab: TabType) => {
        const shift = (swap as any).requester_shift;
        const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
        const hasOffered = myActiveOfferSwapIds.has(swap.id);
        
        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const isExpired = tr.isExpired;

        const priority = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
        
        const groupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' = 
            (shift?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        const isSelected = selectedSwapIds.includes(swap.id);

        return (
            <motion.div
                key={swap.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className={cn(
                    "border-b border-border/40 last:border-0",
                    isBulkModeActive ? "flex items-center" : ""
                )}
            >
                {isBulkModeActive && (
                    <button
                        type="button"
                        onClick={e => {
                            e.stopPropagation();
                            if (tab !== 'available-swaps' || !hasOffered) {
                                handleSelectSwap(swap.id, `${tab === 'my-offers' ? 'Offer' : 'Swap'}: ${shift?.roles?.name || 'Shift'}`);
                            }
                        }}
                        disabled={tab === 'available-swaps' && hasOffered}
                        aria-label={isSelected ? 'Deselect swap' : 'Select swap'}
                        aria-pressed={isSelected}
                        className="pl-3 pr-1 h-full flex items-center justify-center shrink-0 disabled:opacity-40"
                    >
                        <span
                            className={cn(
                                'h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors',
                                isSelected
                                    ? 'bg-[#7b61ff] border-[#7b61ff]'
                                    : 'border-border/70 bg-background/60'
                            )}
                        >
                            {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                        </span>
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <SharedShiftCard
                        variant="default"
                        isFlat={true}
                        organization={shift?.organizations?.name || 'ICC Sydney'}
                        department={shift?.departments?.name || 'Department'}
                        subGroup={shift?.sub_departments?.name}
                        role={shift?.roles?.name || 'Shift'}
                        shiftDate={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEE d MMM') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE d MMM') : '—')}
                        startTime={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.start_time ? shift.start_time.slice(0, 5) : '—')}
                        endTime={shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.end_time ? shift.end_time.slice(0, 5) : '—')}
                        netLength={shift?.net_length_minutes || shift?.net_length || 0}
                        paidBreak={shift?.paid_break_minutes || 0}
                        unpaidBreak={shift?.unpaid_break_minutes || 0}
                        timerText={isExpired ? 'Closed' : timerText}
                        isExpired={isExpired}
                        urgency={priority}
                        groupVariant={groupVariant}
                        shiftData={{
                            lifecycle_status: swap.status,
                        }}
                        onClick={() => {
                            if (isBulkModeActive) {
                                if (tab !== 'available-swaps' || !hasOffered) {
                                    handleSelectSwap(swap.id, `${tab === 'my-offers' ? 'Offer' : 'Swap'}: ${shift?.roles?.name || 'Shift'}`);
                                }
                            } else {
                                setDrawerSwap({ swap, tab });
                            }
                        }}
                    />
                </div>
            </motion.div>
        );
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── GOLD STANDARD HEADER (Rows 1 · 2 · 3) ── */}
            <GoldStandardHeader
                title="My Swaps"
                Icon={ArrowLeftRight}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                startDate={startDate}
                endDate={endDate}
                onDateChange={(start: Date, end: Date) => {
                    setStartDate(start);
                    setEndDate(end);
                }}
                onRefresh={handleRefresh}
                isLoading={isLoading || isRefreshing}
                subFunctionBar={isBulkModeActive ? (
                    <SwapSelectionToolbar
                        selectedIds={selectedSwapIds}
                        visibleSwaps={
                            activeTab === 'available-swaps' ? filteredAvailableSwaps :
                            activeTab === 'my-offers' ? filteredMyOffers : filteredMySwaps
                        }
                        onSelectAllVisible={(ids) => setSelectedSwapIds(ids)}
                        onClear={() => setSelectedSwapIds([])}
                        onActionSelected={
                            activeTab === 'my-offers' ? handleBulkWithdraw :
                            activeTab === 'my-swaps' ? handleBulkCancel : () => {}
                        }
                        actionType={
                            activeTab === 'available-swaps' ? 'none' :
                            activeTab === 'my-offers' ? 'withdraw' : 'cancel'
                        }
                        isPending={activeTab === 'my-offers' ? isDeclining : isCancelling}
                        isBulkModeActive={isBulkModeActive}
                        onCloseBulkMode={() => {
                            setIsBulkModeActive(false);
                            setSelectedSwapIds([]);
                        }}
                        inline={true}
                    />
                ) : undefined}
                functionBarChildren={
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setIsBulkModeActive(prev => {
                                const next = !prev;
                                if (!next) setSelectedSwapIds([]);
                                return next;
                            });
                        }}
                        className={cn(
                            "flex items-center justify-center md:gap-2 transition-all font-black text-[10px] uppercase tracking-wider flex-shrink-0 active:scale-95",
                            "h-11 w-full rounded-xl p-0", // Mobile: uniform 44px, full width
                            "md:h-9 md:w-auto md:px-3.5 md:rounded-xl", // Desktop
                            isBulkModeActive 
                                ? "bg-[#7b61ff]/20 text-[#7b61ff] border border-[#7b61ff]/30 hover:bg-[#7b61ff]/30" 
                                : isDark ? "bg-[#111827]/60 hover:bg-[#111827]/80 text-muted-foreground" : "bg-slate-100 hover:bg-slate-200 text-muted-foreground"
                        )}
                    >
                        <ListChecks className="h-5 w-5 md:h-4 md:w-4" />
                        <span className="hidden md:inline">Bulk Mode</span>
                    </Button>
                }
                leftContent={
                    <div className={cn(
                        "flex items-center gap-1 p-1 rounded-xl",
                        isDark ? "bg-[#111827]/60" : "bg-slate-200/50"
                    )}>
                        {([
                            { id: 'available-swaps' as TabType, label: 'Available', mobileLabel: 'Available', icon: ArrowLeftRight, count: filteredAvailableSwaps.length },
                            { id: 'my-offers'       as TabType, label: 'My Offers', mobileLabel: 'Offers',    icon: ThumbsUp,       count: filteredMyOffers.length },
                            { id: 'my-swaps'        as TabType, label: 'My Swaps',  mobileLabel: 'Mine',      icon: Calendar,       count: filteredMySwaps.length },
                        ] as const).map(tab => {
                            const isActive = activeTab === tab.id;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'flex items-center gap-1.5 px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
                                        isActive
                                            ? 'bg-[#7b61ff] text-white shadow-sm'
                                            : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-900/40 hover:text-slate-900 hover:bg-slate-900/5')
                                    )}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                    <span className="sm:hidden">{tab.mobileLabel}</span>
                                    <span className={cn(
                                        "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[9px] font-black tabular-nums",
                                        isActive
                                            ? "bg-white/20 text-white"
                                            : (isDark ? "bg-white/5 text-white/40" : "bg-slate-900/5 text-slate-900/40")
                                    )}>
                                        {tab.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                }

            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6 flex flex-col">
                {/* Mobile Tabs Switcher */}
                <div className="lg:hidden mb-3 p-1 rounded-2xl bg-slate-100/85 dark:bg-[#1c2333]/85 border border-slate-200/50 dark:border-white/5 flex items-center justify-between gap-1 shadow-sm shrink-0">
                    {([
                        { id: 'available-swaps' as TabType, label: 'Available', mobileLabel: 'Available', icon: ArrowLeftRight, count: filteredAvailableSwaps.length },
                        { id: 'my-offers'       as TabType, label: 'My Offers', mobileLabel: 'Offers',    icon: ThumbsUp,       count: filteredMyOffers.length },
                        { id: 'my-swaps'        as TabType, label: 'My Swaps',  mobileLabel: 'Mine',      icon: Calendar,       count: filteredMySwaps.length },
                    ] as const).map(tab => {
                        const isActive = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98]',
                                    isActive
                                        ? 'bg-[#7b61ff] text-white shadow-sm'
                                        : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-900/40 hover:text-slate-900 hover:bg-slate-900/5')
                                )}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="xs:inline">{tab.mobileLabel}</span>
                                <span className={cn(
                                    "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[9px] font-black tabular-nums",
                                    isActive
                                        ? "bg-white/20 text-white"
                                        : (isDark ? "bg-white/5 text-white/40" : "bg-slate-900/5 text-slate-900/40")
                                )}>
                                    {tab.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className={cn(
                    "flex-1 min-h-0 rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                    <span className="ml-2 text-muted-foreground">Loading swaps...</span>
                </div>
            ) : activeTab === 'available-swaps' ? (
                viewMode === 'card' ? (
                    <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 scrollbar-none">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`available-card-${priorityFilter}`}
                                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4"
                                variants={pageVariants}
                                initial="hidden"
                                animate="show"
                                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                            >
                                {filteredAvailableSwaps.length === 0 ? (
                                    <motion.div variants={itemVariants} className="col-span-full">
                                        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                            <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                                <ArrowLeftRight className="h-6 w-6 text-muted-foreground/40" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-foreground/60">No available swaps</p>
                                                <p className="text-xs text-muted-foreground/40 mt-1">
                                                    {priorityFilter !== 'all' ? 'Try clearing the priority filter.' : 'Check back later for opportunities.'}
                                                </p>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    filteredAvailableSwaps.map(renderAvailableSwapCard)
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                        {/* Mobile: list row view */}
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`available-list-${priorityFilter}`}
                                className="md:hidden border border-border/40 rounded-xl overflow-hidden"
                                variants={pageVariants}
                                initial="hidden"
                                animate="show"
                                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                            >
                                {filteredAvailableSwaps.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                        <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                            <ArrowLeftRight className="h-6 w-6 text-muted-foreground/40" />
                                        </div>
                                        <p className="text-sm font-semibold text-foreground/60">No available swaps</p>
                                    </div>
                                ) : (
                                    filteredAvailableSwaps.map(swap => renderSwapListItem(swap, 'available-swaps'))
                                )}
                            </motion.div>
                        </AnimatePresence>

                        {/* Desktop: traditional sortable table */}
                        <div className="hidden md:block overflow-x-auto border border-border rounded-lg">
                            <table className="w-full text-sm text-foreground">
                                <thead className="bg-muted/60 text-xs text-muted-foreground uppercase tracking-wider font-black">
                                    <tr>
                                        {isBulkModeActive && (
                                            <th className="p-3 text-left w-[40px]">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        filteredAvailableSwaps.length > 0 &&
                                                        filteredAvailableSwaps.every(s => selectedSwapIds.includes(s.id))
                                                    }
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            handleSelectAll(filteredAvailableSwaps.map(s => s.id));
                                                        } else {
                                                            handleDeselectAll();
                                                        }
                                                    }}
                                                    className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                />
                                            </th>
                                        )}
                                        <SortableTableHeader sortKey="requested_by.full_name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Requester</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.departments.name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Dept</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.sub_departments.name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Sub</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.roles.name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Role</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.shift_date" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Date</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.start_time" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Time</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.net_length_minutes" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Net</SortableTableHeader>
                                        <th className="p-3 text-left w-[180px]">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAvailableSwaps.map(swap => {
                                        const shift = swap.requester_shift;
                                        const requesterName = swap.requested_by?.full_name || swap.requested_by?.email || 'Someone';
                                        const hasOffered = myActiveOfferSwapIds.has(swap.id);
                                        
                                        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
                                        const tr = calculateTimeRemaining(deadline);
                                        const isExpired = tr.isExpired;

                                        return (
                                            <tr
                                                key={swap.id}
                                                className={cn(
                                                    "border-t border-border/50 transition-colors",
                                                    isBulkModeActive && !hasOffered && "cursor-pointer hover:bg-muted/20",
                                                    getRowClass(shift?.group_type || shift?.roles?.group_type, shift?.departments?.name || '')
                                                )}
                                                onClick={() => {
                                                    if (isBulkModeActive && !hasOffered) {
                                                        handleSelectSwap(swap.id, `Market: ${shift?.roles?.name || 'Shift'}`);
                                                    }
                                                }}
                                            >
                                                {isBulkModeActive && (
                                                    <td className="p-3" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedSwapIds.includes(swap.id)}
                                                            onChange={() => handleSelectSwap(swap.id, `Market: ${shift?.roles?.name || 'Shift'}`)}
                                                            disabled={hasOffered}
                                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-3 font-semibold">{requesterName}</td>
                                                <td className="p-3 font-medium">{shift?.departments?.name || '—'}</td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                                        {shift?.sub_departments?.name || '—'}
                                                    </div>
                                                </td>
                                                <td className="p-3 font-bold text-[#7b61ff]">{shift?.roles?.name || 'Shift'}</td>
                                                <td className="p-3">{shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE d MMM') : '—'}</td>
                                                <td className="p-3 font-mono">{shift?.start_time ? shift.start_time.slice(0, 5) : '00:00'}–{shift?.end_time ? shift.end_time.slice(0, 5) : '00:00'}</td>
                                                <td className="p-3 font-mono text-muted-foreground">
                                                    {(() => {
                                                        const net = shift?.net_length_minutes || 0;
                                                        const h = Math.floor(net / 60);
                                                        const m = Math.round(net % 60);
                                                        return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                                                    })()}
                                                </td>
                                                <td className="p-3">
                                                    {isExpired ? (
                                                        <span className="text-xs text-slate-400 flex items-center gap-1 font-medium italic"><Ban size={12} /> Expired</span>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            className="h-8 text-xs font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                                                            onClick={() => setOfferSwapTarget(swap)}
                                                            disabled={isMakingOffer}
                                                        >
                                                            <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />
                                                            Offer
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredAvailableSwaps.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="p-12 text-center text-muted-foreground/60 italic text-sm">
                                                No matching shifts found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            ) : activeTab === 'my-offers' ? (
                viewMode === 'card' ? (
                    <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 scrollbar-none">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`my-offers-card-${priorityFilter}`}
                                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                variants={pageVariants}
                                initial="hidden"
                                animate="show"
                                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                            >
                                {filteredMyOffers.length === 0 ? (
                                    <motion.div variants={itemVariants} className="col-span-full">
                                        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                            <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                                <ArrowLeftRight className="h-6 w-6 text-muted-foreground/40" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-foreground/60">No swap offers yet</p>
                                                <p className="text-xs text-muted-foreground/40 mt-1">Go to Available Swaps and offer on a colleague's request.</p>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    filteredMyOffers.map(renderMyOfferCard)
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                        {/* Mobile: list row view */}
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`my-offers-list-${priorityFilter}`}
                                className="md:hidden border border-border/40 rounded-xl overflow-hidden"
                                variants={pageVariants}
                                initial="hidden"
                                animate="show"
                                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                            >
                                {filteredMyOffers.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                        <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                            <ArrowLeftRight className="h-6 w-6 text-muted-foreground/40" />
                                        </div>
                                        <p className="text-sm font-semibold text-foreground/60">No swap offers yet</p>
                                    </div>
                                ) : (
                                    filteredMyOffers.map(swap => renderSwapListItem(swap, 'my-offers'))
                                )}
                            </motion.div>
                        </AnimatePresence>

                        {/* Desktop: traditional sortable table */}
                        <div className="hidden md:block overflow-x-auto border border-border rounded-lg">
                            <table className="w-full text-sm text-foreground">
                                <thead className="bg-muted/60 text-xs text-muted-foreground uppercase tracking-wider font-black">
                                    <tr>
                                        {isBulkModeActive && (
                                            <th className="p-3 text-left w-[40px]">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        filteredMyOffers.length > 0 &&
                                                        filteredMyOffers.every(s => selectedSwapIds.includes(s.id))
                                                    }
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            handleSelectAll(filteredMyOffers.map(s => s.id));
                                                        } else {
                                                            handleDeselectAll();
                                                        }
                                                    }}
                                                    className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                />
                                            </th>
                                        )}
                                        <SortableTableHeader sortKey="requested_by.full_name" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Owner</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.departments.name" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Dept</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.sub_departments.name" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Sub</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.roles.name" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Role</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.shift_date" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Date</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.start_time" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Time</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.net_length_minutes" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Net</SortableTableHeader>
                                        <SortableTableHeader sortKey="status" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Status / Action</SortableTableHeader>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMyOffers.map(swap => {
                                        const shift = swap.requester_shift;
                                        const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
                                        const ownerName = swap.requested_by?.full_name || swap.requested_by?.email || 'Someone';

                                        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
                                        const tr = calculateTimeRemaining(deadline);
                                        const isExpired = tr.isExpired;

                                        const deriveOfferStatus = () => {
                                            if (isExpired) return { label: 'Expired', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
                                            if (myOffer?.status === 'WITHDRAWN') return { label: 'Withdrawn', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
                                            if (myOffer?.status === 'REJECTED') return { label: 'Peer Rejected', color: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400' };
                                            if (swap.status === 'APPROVED') return { label: 'Accepted', color: 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' };
                                            if (swap.status === 'REJECTED') return { label: 'Rejected', color: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400' };
                                            if (myOffer?.status === 'SELECTED' && swap.status === 'MANAGER_PENDING') return { label: 'Pending Manager', color: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400' };
                                            if (myOffer?.status === 'SUBMITTED') return { label: 'Pending Peer', color: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400' };
                                            return { label: 'Pending', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
                                        };

                                        const status = deriveOfferStatus();

                                        return (
                                            <tr
                                                key={swap.id}
                                                className={cn(
                                                    "border-t border-border/50 transition-colors",
                                                    isBulkModeActive && "cursor-pointer hover:bg-muted/20",
                                                    getRowClass(shift?.group_type || shift?.roles?.group_type, shift?.departments?.name || '')
                                                )}
                                                onClick={() => {
                                                    if (isBulkModeActive) {
                                                        handleSelectSwap(swap.id, `Offer: ${shift?.roles?.name || 'Shift'}`);
                                                    }
                                                }}
                                            >
                                                {isBulkModeActive && (
                                                    <td className="p-3" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedSwapIds.includes(swap.id)}
                                                            onChange={() => handleSelectSwap(swap.id, `Offer: ${shift?.roles?.name || 'Shift'}`)}
                                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-3 font-semibold">{ownerName}</td>
                                                <td className="p-3 font-medium">{shift?.departments?.name || '—'}</td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                                        {shift?.sub_departments?.name || '—'}
                                                    </div>
                                                </td>
                                                <td className="p-3 font-bold text-[#7b61ff]">{shift?.roles?.name || 'Shift'}</td>
                                                <td className="p-3">{shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE d MMM') : '—'}</td>
                                                <td className="p-3 font-mono">{shift?.start_time ? shift.start_time.slice(0, 5) : '00:00'}–{shift?.end_time ? shift.end_time.slice(0, 5) : '00:00'}</td>
                                                <td className="p-3 font-mono text-muted-foreground">
                                                    {(() => {
                                                        const net = shift?.net_length_minutes || 0;
                                                        const h = Math.floor(net / 60);
                                                        const m = Math.round(net % 60);
                                                        return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                                                    })()}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn("px-2 py-1 rounded text-xs font-semibold border", status.color)}>
                                                            {status.label}
                                                        </span>
                                                        {myOffer && myOffer.status === 'SUBMITTED' && swap.status === 'OPEN' && !isExpired && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 text-[10px] font-black uppercase tracking-widest border-border/40 hover:bg-red-500/10 hover:text-red-400"
                                                                onClick={() => declineOffer(myOffer.id)}
                                                                disabled={isDeclining}
                                                            >
                                                                Withdraw
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredMyOffers.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="p-12 text-center text-muted-foreground/60 italic text-sm">
                                                No matching offers found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            ) : (
                viewMode === 'card' ? (
                    <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 scrollbar-none">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`my-swaps-card-${priorityFilter}`}
                                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                variants={pageVariants}
                                initial="hidden"
                                animate="show"
                                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                            >
                                {filteredMySwaps.length === 0 ? (
                                    <motion.div variants={itemVariants} className="col-span-full">
                                        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                            <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                                <ArrowLeftRight className="h-6 w-6 text-muted-foreground/40" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-foreground/60">No swap requests</p>
                                                <p className="text-xs text-muted-foreground/40 mt-1">
                                                    {priorityFilter !== 'all' ? 'Try clearing the priority filter.' : 'Create a swap request from your roster to get started.'}
                                                </p>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    filteredMySwaps.map(renderMySwapCard)
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                        {/* Mobile: list row view */}
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`my-swaps-list-${priorityFilter}`}
                                className="md:hidden border border-border/40 rounded-xl overflow-hidden"
                                variants={pageVariants}
                                initial="hidden"
                                animate="show"
                                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                            >
                                {filteredMySwaps.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                        <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                            <ArrowLeftRight className="h-6 w-6 text-muted-foreground/40" />
                                        </div>
                                        <p className="text-sm font-semibold text-foreground/60">No swap requests</p>
                                    </div>
                                ) : (
                                    filteredMySwaps.map(swap => renderSwapListItem(swap, 'my-swaps'))
                                )}
                            </motion.div>
                        </AnimatePresence>

                        {/* Desktop: traditional sortable table */}
                        <div className="hidden md:block overflow-x-auto border border-border rounded-lg">
                            <table className="w-full text-sm text-foreground">
                                <thead className="bg-muted/60 text-xs text-muted-foreground uppercase tracking-wider font-black">
                                    <tr>
                                        {isBulkModeActive && (
                                            <th className="p-3 text-left w-[40px]">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        filteredMySwaps.length > 0 &&
                                                        filteredMySwaps.every(s => selectedSwapIds.includes(s.id))
                                                    }
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            handleSelectAll(filteredMySwaps.map(s => s.id));
                                                        } else {
                                                            handleDeselectAll();
                                                        }
                                                    }}
                                                    className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                />
                                            </th>
                                        )}
                                        <SortableTableHeader sortKey="requester_shift.departments.name" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Dept</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.sub_departments.name" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Sub</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.roles.name" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Role</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.shift_date" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Date</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.start_time" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Time</SortableTableHeader>
                                        <SortableTableHeader sortKey="requester_shift.net_length_minutes" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Net</SortableTableHeader>
                                        <SortableTableHeader sortKey="status" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Status / Action</SortableTableHeader>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMySwaps.map(swap => {
                                        const shift = swap.requester_shift;
                                        
                                        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
                                        const tr = calculateTimeRemaining(deadline);
                                        const isExpired = tr.isExpired;

                                        return (
                                            <tr
                                                key={swap.id}
                                                className={cn(
                                                    "border-t border-border/50 transition-colors",
                                                    isBulkModeActive && "cursor-pointer hover:bg-muted/20",
                                                    getRowClass(shift?.group_type || shift?.roles?.group_type, shift?.departments?.name || '')
                                                )}
                                                onClick={() => {
                                                    if (isBulkModeActive) {
                                                        handleSelectSwap(swap.id, `Swap: ${shift?.roles?.name || 'Shift'}`);
                                                    }
                                                }}
                                            >
                                                {isBulkModeActive && (
                                                    <td className="p-3" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedSwapIds.includes(swap.id)}
                                                            onChange={() => handleSelectSwap(swap.id, `Swap: ${shift?.roles?.name || 'Shift'}`)}
                                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-3 font-medium">{shift?.departments?.name || '—'}</td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                                        {shift?.sub_departments?.name || '—'}
                                                    </div>
                                                </td>
                                                <td className="p-3 font-bold text-[#7b61ff]">{shift?.roles?.name || 'Shift'}</td>
                                                <td className="p-3">{shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE d MMM') : '—'}</td>
                                                <td className="p-3 font-mono">{shift?.start_time ? shift.start_time.slice(0, 5) : '00:00'}–{shift?.end_time ? shift.end_time.slice(0, 5) : '00:00'}</td>
                                                <td className="p-3 font-mono text-muted-foreground">
                                                    {(() => {
                                                        const net = shift?.net_length_minutes || 0;
                                                        const h = Math.floor(net / 60);
                                                        const m = Math.round(net % 60);
                                                        return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                                                    })()}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        {isExpired ? (
                                                            <span className="text-xs text-slate-400 flex items-center gap-1 font-medium italic"><Ban size={12} /> Expired</span>
                                                        ) : swap.status === 'APPROVED' ? (
                                                            <span className="text-xs text-emerald-400 flex items-center gap-1 font-bold"><CheckCircle size={12} /> Accepted</span>
                                                        ) : swap.status === 'REJECTED' ? (
                                                            <span className="text-xs text-rose-500 flex items-center gap-1 font-bold"><XCircle size={12} /> Rejected</span>
                                                        ) : swap.status === 'CANCELLED' ? (
                                                            <span className="text-xs text-slate-400 flex items-center gap-1 font-medium"><Ban size={12} /> Cancelled</span>
                                                        ) : swap.status === 'MANAGER_PENDING' ? (
                                                            <>
                                                                <span className="text-xs text-amber-500 flex items-center gap-1 font-bold"><Clock size={12} /> Pending Manager</span>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 border-border/10 hover:bg-primary/10"
                                                                    onClick={() => setViewOffersSwapId(swap.id)}
                                                                >
                                                                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Details
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            /* OPEN State */
                                                            <>
                                                                <SwapTableOfferButton
                                                                    swapId={swap.id}
                                                                    onClick={() => setViewOffersSwapId(swap.id)}
                                                                />
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 border-border/10 hover:bg-rose-500/10 hover:text-rose-400"
                                                                    onClick={() => setConfirmDialog({ isOpen: true, swap })}
                                                                    disabled={isCancelling}
                                                                >
                                                                    <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredMySwaps.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="p-12 text-center text-muted-foreground/60 italic text-sm">
                                                No matching swaps found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))
            }
                </div>
            </div>

            {/* Modals */}
            <UnifiedSwapModal
                isOpen={!!offerSwapTarget}
                onClose={() => setOfferSwapTarget(null)}
                onConfirmOffer={handleMakeOffer}
                isSubmitting={isMakingOffer}
                swapId={offerSwapTarget?.id || ''}
            />

            <ViewOffersModal
                isOpen={!!viewOffersSwapId}
                onClose={() => setViewOffersSwapId(null)}
                swapResquestId={viewOffersSwapId || ''}
                onAccept={(offer) => {
                    acceptOffer({
                        swapId: offer.swap_request_id,
                        offerId: offer.id,
                        offererId: offer.offerer_id,
                        offeredV8ShiftId: offer.offered_shift_id
                    });
                    setViewOffersSwapId(null);
                }}
                onDecline={(offerId) => declineOffer(offerId)}
                isAccepting={isAccepting}
                isDeclining={isDeclining}
            />

            {/* Cancel Confirmation Dialog */}
            <Dialog
                open={confirmDialog.isOpen}
                onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, isOpen: open }))}
            >
                <DialogContent className="max-w-sm" aria-describedby={undefined}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
                            Cancel Request
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to cancel this swap request? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 mt-4">
                        <Button
                            variant="outline"
                            onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                            className="flex-1 h-11"
                        >
                            Go Back
                        </Button>
                        <Button
                            onClick={confirmCancel}
                            className="flex-1 h-11 bg-destructive hover:bg-destructive/90"
                        >
                            Yes, Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>



            {/* ── SWAP DETAIL DRAWER (mobile list tap) ── */}
            <Drawer open={drawerSwap !== null} onOpenChange={open => { if (!open) setDrawerSwap(null); }}>
                <DrawerContent className="max-h-[88dvh] flex flex-col rounded-t-[32px]" aria-describedby={undefined}>
                    {/* Screen reader only Title and Description for Radix/Vaul accessibility */}
                    <DrawerTitle className="sr-only">Swap Details</DrawerTitle>
                    <DrawerDescription className="sr-only">View full swap request details and offer actions</DrawerDescription>
                    <div className="flex-1 px-4 pb-8 pt-6">
                        {drawerSwap && (() => {
                            const { swap, tab } = drawerSwap;
                            const shift = (swap as any).requester_shift;
                            const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
                            const hasOffered = myActiveOfferSwapIds.has(swap.id);
                            const statusCfg = STATUS_CONFIG[swap.status] ?? STATUS_CONFIG.EXPIRED;
                            const StatusIcon = statusCfg.icon;

                            const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift.shift_date}T${shift.start_time}` : '');
                            const tr = calculateTimeRemaining(deadline);
                            const timerStr = formatTimeRemaining(tr);
                            const isExpired = tr.isExpired;

                            const footerActions = (
                                <div className="flex flex-col gap-2 mt-4">
                                    {tab === 'available-swaps' && (
                                        hasOffered ? (
                                            <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-black uppercase tracking-wider">
                                                <CheckCircle2 className="h-5 w-5 shrink-0" /> Offer Already Submitted
                                            </div>
                                        ) : isExpired ? (
                                            <div className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-muted/30 border border-border/30 text-muted-foreground text-sm font-black uppercase tracking-wider">
                                                <Ban className="h-5 w-5 shrink-0" /> Expired
                                            </div>
                                        ) : (
                                            <Button
                                                className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-base uppercase tracking-widest shadow-xl shadow-indigo-900/30 rounded-2xl transition-all active:scale-[0.98]"
                                                onClick={() => { setOfferSwapTarget(swap); setDrawerSwap(null); }}
                                            >
                                                <ThumbsUp className="mr-3 h-5 w-5" /> Offer Swap
                                            </Button>
                                        )
                                    )}
                                    {tab === 'my-offers' && myOffer && (
                                        myOffer.status === 'SUBMITTED' && !isExpired ? (
                                            <Button
                                                variant="outline"
                                                className="w-full h-12 border-border/50 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl"
                                                onClick={() => { declineOffer(myOffer.id); setDrawerSwap(null); }}
                                                disabled={isDeclining}
                                            >
                                                {isDeclining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                                                Withdraw Offer
                                            </Button>
                                        ) : (
                                            <div className={cn('w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl border text-sm font-black uppercase tracking-wider', STATUS_CONFIG[swap.status]?.badgeCls ?? 'bg-muted/30 border-border/30 text-muted-foreground')}>
                                                <StatusIcon className="h-5 w-5 shrink-0" />{statusCfg.label}
                                            </div>
                                        )
                                    )}
                                    {tab === 'my-swaps' && (
                                        swap.status === 'OPEN' && !isExpired ? (
                                            <>
                                                <Button
                                                    className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-base uppercase tracking-widest shadow-xl shadow-indigo-900/30 rounded-2xl transition-all active:scale-[0.98]"
                                                    onClick={() => { setViewOffersSwapId(swap.id); setDrawerSwap(null); }}
                                                >
                                                    <Eye className="mr-3 h-5 w-5" /> View Offers
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-12 border-border/50 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl"
                                                    onClick={() => { setConfirmDialog({ isOpen: true, swap }); setDrawerSwap(null); }}
                                                    disabled={isCancelling}
                                                >
                                                    <X className="mr-2 h-4 w-4" /> Cancel Request
                                                </Button>
                                            </>
                                        ) : (
                                            <div className={cn('w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl border text-sm font-black uppercase tracking-wider', STATUS_CONFIG[swap.status]?.badgeCls ?? 'bg-muted/30 border-border/30 text-muted-foreground')}>
                                                <StatusIcon className="h-5 w-5 shrink-0" />{statusCfg.label}
                                            </div>
                                        )
                                    )}
                                </div>
                            );

                            return (
                                <div className="space-y-6">
                                    <div className="flex justify-center mb-2">
                                        <div className="w-12 h-1.5 rounded-full bg-border/40" />
                                    </div>
                                    
                                    <SharedShiftCard
                                        variant="timecard"
                                        organization={shift?.organizations?.name || '—'}
                                        department={shift?.departments?.name || '—'}
                                        subGroup={shift?.sub_departments?.name}
                                        role={shift?.roles?.name || 'Unknown Role'}
                                        shiftDate={shift?.shift_date}
                                        startTime={shift?.start_time}
                                        endTime={shift?.end_time}
                                        netLength={shift?.net_length_minutes || shift?.net_length}
                                        paidBreak={shift?.paid_break_minutes}
                                        unpaidBreak={shift?.unpaid_break_minutes}
                                        timerText={isExpired ? 'Swap Closed' : `Closes in ${timerStr}`}
                                        isExpired={isExpired}
                                        isUrgent={swap.priority === 'URGENT'}
                                        lifecycleStatus={swap.status}
                                        footerActions={footerActions}
                                        isFlat={false}
                                        className="shadow-2xl border-white/10"
                                    />

                                    <div className="px-2 pb-4">
                                        <Button 
                                            variant="ghost" 
                                            className="w-full h-12 rounded-2xl text-muted-foreground/50 font-black uppercase tracking-widest text-[10px] hover:bg-muted/50 transition-all"
                                            onClick={() => setDrawerSwap(null)}
                                        >
                                            Dismiss Detail
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                </DrawerContent>
            </Drawer>
        </div>
    );
};

// Sub-component for View Offers button with count styled for tables
const SwapTableOfferButton: React.FC<{ swapId: string; onClick: () => void }> = ({ swapId, onClick }) => {
    const { data: offers, isLoading } = useQuery({
        queryKey: ['swapOffers', swapId],
        queryFn: () => swapsApi.getSwapOffers(swapId),
    });

    const pendingCount = offers?.filter(o => o.status === 'SUBMITTED').length || 0;

    return (
        <Button
            size="sm"
            className={cn(
                "h-8 text-xs font-black uppercase tracking-wider shadow-sm",
                pendingCount > 0
                    ? "bg-[#7b61ff] hover:bg-[#684ff0] text-white"
                    : "bg-muted/60 hover:bg-muted/80 text-foreground/60"
            )}
            onClick={onClick}
            disabled={isLoading}
        >
            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {isLoading ? (
                '...'
            ) : pendingCount > 0 ? (
                `Offers (${pendingCount})`
            ) : (
                'No Offers'
            )}
        </Button>
    );
};

// Sub-component for View Offers button with count
const SwapCardOfferButton: React.FC<{ swapId: string; onClick: () => void }> = ({ swapId, onClick }) => {
    const { data: offers, isLoading } = useQuery({
        queryKey: ['swapOffers', swapId],
        queryFn: () => swapsApi.getSwapOffers(swapId),
    });

    const pendingCount = offers?.filter(o => o.status === 'SUBMITTED').length || 0;

    return (
        <button
            className={cn(
                "w-full h-12 flex items-center justify-center gap-3 text-[11px] font-black tracking-[0.3em] uppercase transition-all backdrop-blur-md",
                pendingCount > 0
                    ? "bg-primary/20 text-primary hover:bg-primary/30"
                    : "bg-muted/30 text-foreground/40 hover:bg-muted/40"
            )}
            onClick={onClick}
            disabled={isLoading}
        >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {isLoading ? (
                'Loading...'
            ) : pendingCount > 0 ? (
                `View Offers (${pendingCount})`
            ) : (
                'No Offers Yet'
            )}
        </button>
    );
};

// Empty State Component
const EmptyState: React.FC<{
    icon: React.ElementType;
    title: string;
    description: string;
}> = ({ icon: Icon, title, description }) => (
    <div className="text-center py-16 bg-slate-100/60 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-700">
        <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
    </div>
);

export default EmployeeSwapsPage;

// Force reload: Sun Mar 22 13:03:21 AEDT 2026
