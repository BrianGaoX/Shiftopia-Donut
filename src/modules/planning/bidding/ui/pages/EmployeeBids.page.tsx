import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';

import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, addDays, startOfWeek, endOfWeek } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { biddingApi } from '../../api/bidding.api';
import { validateCompliance, type ComplianceResult, type QualificationViolation } from '@/modules/rosters/services/compliance.service';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import {
    Info, User,
    Calendar, Clock, ThumbsUp, Ban,
    Megaphone, UserPlus, UserCheck as LucideUserCheck, Circle, Minus, Gavel, Coffee, Shield, Loader2, CheckCircle, XCircle,
    X, Filter, History, ChevronDown, ListChecks, Settings2, Layers
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { BidStatusBadge } from '../components/BidStatusBadge';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { calculateTimeRemaining, formatTimeRemaining } from '../views/OpenBidsView/utils';

import { BidComplianceModal } from '../components/BidComplianceModal';
import { BidConfirmComplianceDialog } from '../components/BidConfirmComplianceDialog';
import { BidOpportunityDrawer } from '../components/BidOpportunityDrawer';
import { BidOpportunityCard } from '../components/BidOpportunityCard';
import { BidOpportunityListItem } from '../components/BidOpportunityListItem';
import { BidOpportunityListSection } from '../components/BidOpportunityListSection';
import { BidSelectionToolbar } from '../components/BidSelectionToolbar';
import { groupOpportunities, type BidGroupBy } from '../utils/bid-grouping';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Popover, PopoverTrigger, PopoverContent } from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { Check } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { getBidPriority } from '../utils/bid-priority';
import { getDeptColor, getRowClass } from '../utils/bid-dept-styles';
import { getParticipationStatus } from '../utils/bid-participation';
import type { ShiftData, BidData, ShiftOpportunity } from '../types';

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
// ============================================================================
// COMPONENT
// ============================================================================
export const EmployeeBidsPage: React.FC = () => {
    const { user } = useAuth();
    const breakpoint = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const { scope, setScope, scopeKey, isGammaLocked, isLoading: isScopeLoading } = useScopeFilter('personal');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { isDark } = useTheme();
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [startDate, setStartDate] = useState<Date>(() => {
        const saved = localStorage.getItem('bids_filter_start_date');
        if (saved) {
            const parsed = new Date(saved);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d;
    });
    const [endDate, setEndDate]     = useState<Date>(() => {
        const saved = localStorage.getItem('bids_filter_end_date');
        if (saved) {
            const parsed = new Date(saved);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d;
    });

    React.useEffect(() => {
        localStorage.setItem('bids_filter_start_date', startDate.toISOString());
    }, [startDate]);

    React.useEffect(() => {
        localStorage.setItem('bids_filter_end_date', endDate.toISOString());
    }, [endDate]);

    const [drawerOpp, setDrawerOpp] = useState<ShiftOpportunity | null>(null);
    const [groupBy, setGroupBy] = useState<BidGroupBy>('date');
    const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
    const [showIneligible, setShowIneligible] = useState(false);
    const [showExpired, setShowExpired] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayDate = React.useMemo(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todayStr]);

    // Selection (for bulk bid on not_participated eligible shifts)
    const [selectedV8ShiftIds, setSelectedV8ShiftIds] = useState<any[]>([]);
    const [isBulkModeActive, setIsBulkModeActive] = useState<boolean>(false);

    // Compliance Check State
    const [checkingV8ShiftId, setCheckingV8ShiftId] = useState<string | null>(null);
    const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
    const [showComplianceDialog, setShowComplianceDialog] = useState(false);
    const [pendingBidShift, setPendingBidShift] = useState<ShiftData | null>(null);

    // Compliance Modal State
    const [complianceModalShift, setComplianceModalShift] = useState<ShiftData | null>(null);
    const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);

    const hierarchyFilters = {
        organizationId: scope.org_ids[0] ?? '',
        departmentId: scope.dept_ids,
        subDepartmentId: scope.subdept_ids,
    };

    // ========================================================================
    // DATA FETCHING
    // ========================================================================
    const { data: rawAvailableShifts = [] } = useQuery({
        queryKey: ['openBidShifts', scopeKey, hierarchyFilters.organizationId, hierarchyFilters.departmentId, hierarchyFilters.subDepartmentId],
        queryFn: () => biddingApi.getOpenBidShifts(hierarchyFilters),
        enabled: !!user && !!hierarchyFilters.organizationId && !isScopeLoading,
        staleTime: 60_000, // 1 minute staleTime
    });

    const { data: rawMyBids = [] } = useQuery({
        queryKey: ['myBids', user?.id],
        queryFn: () => (user ? biddingApi.getMyBids(user.id) : Promise.resolve([])),
        enabled: !!user,
        staleTime: 60_000, // 1 minute staleTime
    });

    // ========================================================================
    // BUCKET A: ELIGIBILITY SCAN (5-min cache)
    // ========================================================================
    const eligibilityQueryKey = rawAvailableShifts.map(s => s.id).join('|');

    const { data: eligibilityMap = new Map<string, { eligible: boolean; reasons: string[] }>(), isPending: eligibilityPending, isFetching: eligibilityLoading } = useQuery({
        queryKey: ['bidEligibilityScan', eligibilityQueryKey, user?.id],
        queryFn: async (): Promise<Map<string, { eligible: boolean; reasons: string[] }>> => {
            const newMap = new Map<string, { eligible: boolean; reasons: string[] }>();
            const results = await Promise.allSettled(
                rawAvailableShifts.map(s => validateCompliance({
                    employeeId: user!.id,
                    shiftDate: s.shift_date,
                    startTime: (s.start_time || '00:00').slice(0, 5) + ':00',
                    endTime:   (s.end_time   || '00:00').slice(0, 5) + ':00',
                    netLengthMinutes: (() => {
                        const toMin = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
                        const sMin = toMin(s.start_time || '00:00');
                        const eMin = toMin(s.end_time   || '00:00');
                        const dur  = eMin > sMin ? eMin - sMin : eMin + 1440 - sMin;
                        return Math.max(1, dur - (s.unpaid_break_minutes || 0));
                    })(),
                    shiftId: s.id,
                }))
            );
            rawAvailableShifts.forEach((s, i) => {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    const qv: QualificationViolation[] = result.value.qualificationViolations;
                    if (qv.length > 0) {
                        newMap.set(s.id, {
                            eligible: false,
                            reasons: qv.map(v => {
                                if (v.type === 'ROLE_MISMATCH')     return 'Role mismatch — no matching contract';
                                if (v.type === 'LICENSE_MISSING')   return `Missing licence: ${v.license_name || 'required'}`;
                                if (v.type === 'LICENSE_EXPIRED')   return `Expired licence: ${v.license_name || 'required'}`;
                                if (v.type === 'SKILL_MISSING')     return `Missing skill: ${v.skill_name || 'required'}`;
                                if (v.type === 'SKILL_EXPIRED')     return `Expired skill: ${v.skill_name || 'required'}`;
                                return v.message;
                            }),
                        });
                    } else {
                        newMap.set(s.id, { eligible: true, reasons: [] });
                    }
                } else {
                    newMap.set(s.id, { eligible: true, reasons: [] });
                }
            });
            return newMap;
        },
        enabled: !!user && rawAvailableShifts.length > 0,
        staleTime: 5 * 60_000,
        gcTime:    10 * 60_000,
    });

    // ========================================================================
    // MUTATIONS
    // ========================================================================
    const placeBidMutation = useMutation({
        mutationFn: (shiftId: string) => biddingApi.placeBid(shiftId, user!.id),
        onSuccess: () => {
            toast({ title: 'Bid Submitted', description: 'Your bid has been placed successfully.' });
            queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
            queryClient.invalidateQueries({ queryKey: ['myBids'] });
            setSelectedV8ShiftIds([]);
        },
        onError: (error: any) => {
            toast({ title: 'Bid Failed', description: error.message || 'Failed to place bid.', variant: 'destructive' });
        }
    });

    const withdrawBidMutation = useMutation({
        mutationFn: (bidId: string) => biddingApi.withdrawBid(bidId),
        onSuccess: () => {
            toast({ title: 'Bid Withdrawn', description: 'You have withdrawn from the bid.' });
            queryClient.invalidateQueries({ queryKey: ['myBids'] });
            setSelectedV8ShiftIds([]);
        },
        onError: () => {
            toast({ title: 'Withdraw Failed', description: 'Failed to withdraw bid.', variant: 'destructive' });
        }
    });

    // ========================================================================
    // DATA TRANSFORMATION
    // ========================================================================
    const availableShifts: ShiftData[] = React.useMemo(() => {
        return rawAvailableShifts.map(s => {
            const shiftStartAt = (s as any).start_at ? new Date((s as any).start_at) : parseZonedDateTime(s.shift_date, s.start_time, (s as any).tz_identifier || SYDNEY_TZ);
            const shiftEndAt = (s as any).end_at ? new Date((s as any).end_at) : parseZonedDateTime(s.shift_date, s.end_time, (s as any).tz_identifier || SYDNEY_TZ);

            if (!(s as any).end_at && shiftEndAt < shiftStartAt) {
                shiftEndAt.setDate(shiftEndAt.getDate() + 1);
            }

            const durationMin = (shiftEndAt.getTime() - shiftStartAt.getTime()) / (1000 * 60);
            const paidBreak = s.paid_break_minutes || 0;
            const unpaidBreak = s.unpaid_break_minutes || 0;
            const netLength = durationMin - unpaidBreak;

            const timeToStartHours = (shiftStartAt.getTime() - new Date().getTime()) / (1000 * 60 * 60);
            const isUrgent = timeToStartHours > 0 && timeToStartHours < 24;

            return {
                id: s.id,
                role: s.roles?.name || 'Unknown',
                organization: (s as any).organizations?.name || 'MCEC',
                department: s.departments?.name || 'Unknown',
                subDepartment: s.sub_departments?.name || 'General',
                group: (() => {
                    const t = s.group_type;
                    if (!t) return 'General';
                    const map: Record<string, string> = {
                        'convention_centre': 'Convention Centre',
                        'exhibition_centre': 'Exhibition Centre',
                        'theatre': 'Theatre'
                    };
                    return map[t] || t.replace(/_/g, ' ');
                })(),
                subGroupName: s.sub_group_name || 'General',
                subGroup: s.sub_departments?.name || 'General',
                date: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : s.shift_date,
                weekday: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'EEE') : format(parseISO(s.shift_date), 'EEE'),
                startTime: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.start_time.slice(0, 5),
                endTime: (s as any).end_at ? formatInTimezone(new Date((s as any).end_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.end_time.slice(0, 5),
                startAt: shiftStartAt.toISOString(),
                endAt: (s as any).end_at,
                tzIdentifier: (s as any).tz_identifier,
                paidBreak,
                unpaidBreak,
                netLength,
                remunerationLevel: s.remuneration_levels?.level_name || 'Level-4',
                assignedTo: s.assigned_employee_id,
                isEligible:          eligibilityMap.get(s.id)?.eligible ?? true,
                ineligibilityReason: eligibilityMap.get(s.id)?.reasons.join(' · ') ?? undefined,
                groupType: s.group_type,
                priority: isUrgent ? 'urgent' : 'normal',
                biddingWindowOpens: (s as any).bidding_open_at || null,
                biddingWindowCloses: (s as any).bidding_close_at || null,
                isUrgent,
                stateId: determineShiftState(s as any),
                lifecycleStatus: s.lifecycle_status,
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || ''),
                droppedById: (s as any).dropped_by_id,
                last_dropped_by: (s as any).last_dropped_by,
                last_rejected_by: (s as any).last_rejected_by ?? null
            };
        });
    }, [rawAvailableShifts, eligibilityMap]);

    const myBids: BidData[] = React.useMemo(() => {
        return rawMyBids.map(b => {
            const s = b.shift;
            if (!s) return null;
            const shiftStartAt = (s as any).start_at ? new Date((s as any).start_at) : parseZonedDateTime(s.shift_date, s.start_time, (s as any).tz_identifier || SYDNEY_TZ);
            const shiftEndAt = (s as any).end_at ? new Date((s as any).end_at) : parseZonedDateTime(s.shift_date, s.end_time, (s as any).tz_identifier || SYDNEY_TZ);

            if (!(s as any).end_at && shiftEndAt < shiftStartAt) {
                shiftEndAt.setDate(shiftEndAt.getDate() + 1);
            }

            const durationMin = (shiftEndAt.getTime() - shiftStartAt.getTime()) / (1000 * 60);
            const paidBreak = s.paid_break_minutes || 0;
            const unpaidBreak = s.unpaid_break_minutes || 0;
            const netLength = durationMin - unpaidBreak;

            return {
                id: b.id,
                shiftId: s.id,
                role: s.roles?.name || 'Unknown',
                organization: (s as any).organizations?.name || 'MCEC',
                department: s.departments?.name || 'Unknown',
                subDepartment: s.sub_departments?.name || 'General',
                group: (() => {
                    const t = s.group_type;
                    if (!t) return 'General';
                    const map: Record<string, string> = {
                        'convention_centre': 'Convention Centre',
                        'exhibition_centre': 'Exhibition Centre',
                        'theatre': 'Theatre'
                    };
                    return map[t] || t.replace(/_/g, ' ');
                })(),
                subGroupName: s.sub_group_name || 'General',
                subGroup: s.sub_departments?.name || 'General',
                date: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : s.shift_date,
                weekday: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'EEE') : format(parseISO(s.shift_date), 'EEE'),
                startTime: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.start_time.slice(0, 5),
                endTime: (s as any).end_at ? formatInTimezone(new Date((s as any).end_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.end_time.slice(0, 5),
                startAt: shiftStartAt.toISOString(),
                endAt: (s as any).end_at,
                tzIdentifier: (s as any).tz_identifier,
                paidBreak,
                unpaidBreak,
                netLength,
                remunerationLevel: s.remuneration_levels?.level_name || 'Level-4',
                status: b.status as any,
                lifecycleStatus: s.lifecycle_status,
                bidTime: format(parseISO(b.created_at), 'yyyy-MM-dd HH:mm'),
                notes: b.notes,
                groupType: s.group_type,
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || '')
            };
        }).filter(Boolean) as BidData[];
    }, [rawMyBids]);

    // ========================================================================
    // SORTING
    // ========================================================================
    const shiftsTableSort = useTableSorting(availableShifts, { key: 'date', direction: 'asc' });

    // ========================================================================
    // UNIFIED BID OPPORTUNITIES
    // Each open shift enriched with current-iteration participation status + history
    // ========================================================================
    const bidOpportunities: ShiftOpportunity[] = React.useMemo(() => {
        return shiftsTableSort.sortedData.map(shift => {
            const currentBid = myBids.find(b =>
                String(b.shiftId) === String(shift.id) &&
                b.status !== 'withdrawn'
            ) || null;

            const participationStatus = getParticipationStatus(shift, myBids, user?.id || '');

            return { ...shift, participationStatus, currentBid };
        });
    }, [shiftsTableSort.sortedData, myBids, user?.id]);

    // ========================================================================
    // SHIFT COUNTS BY DATE (dot indicators — pre-date-filter)
    // ========================================================================
    const shiftsByDate = React.useMemo(() => {
        const map = new Map<string, { count: number; hasUrgent: boolean }>();
        shiftsTableSort.sortedData.forEach(shift => {
            const existing = map.get(shift.date) || { count: 0, hasUrgent: false };
            map.set(shift.date, {
                count: existing.count + 1,
                hasUrgent: existing.hasUrgent || getBidPriority(shift) === 'urgent',
            });
        });
        return map;
    }, [shiftsTableSort.sortedData]);

    // ========================================================================
    // DATE-FILTERED BID OPPORTUNITIES
    // ========================================================================
    const filteredBidOpportunities = React.useMemo(() => {
        const startStr = format(startDate, 'yyyy-MM-dd');
        const endStr = format(endDate, 'yyyy-MM-dd');
        const now = Date.now();
        return bidOpportunities.filter(opp => {
            if (opp.date < startStr || opp.date > endStr) return false;

            const shiftStart = opp.startAt
                ? new Date(opp.startAt).getTime()
                : new Date(`${opp.date}T${opp.startTime}:00`).getTime();
            const biddingCloses = new Date(shiftStart - 4 * 60 * 60 * 1000);
            const isExpired = now >= biddingCloses.getTime();

            // Ineligible check: if not eligible and showIneligible is false, filter out
            if (!opp.isEligible && !showIneligible) {
                return false;
            }

            // Expired check: if expired (either by status or closed window) and showExpired is false, filter out
            const isWindowExpired = opp.participationStatus === 'expired' || 
                                    isExpired || 
                                    (opp.participationStatus === 'not_participated' && isExpired) ||
                                    (opp.participationStatus === 'pending' && isExpired);

            if (isWindowExpired && !showExpired) {
                return false;
            }

            return true;
        });
    }, [bidOpportunities, startDate, endDate, showIneligible, showExpired]);

    // ========================================================================
    // SELECTION HANDLERS (only applicable to not_participated eligible shifts)
    // ========================================================================
    const handleSelectAll = (isChecked: boolean) => {
        if (isChecked) {
            const allIds = filteredBidOpportunities.map(o => o.id);
            setSelectedV8ShiftIds(allIds);
        } else {
            setSelectedV8ShiftIds([]);
        }
    };

    const handleSelectShift = (id: any) => {
        setSelectedV8ShiftIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };



    // ========================================================================
    // COMPLIANCE HANDLERS
    // ========================================================================
    const runV8LegacyBridgeAndBid = async (shift: ShiftData) => {
        if (!user) return;
        setCheckingV8ShiftId(shift.id);
        try {
            const result = await validateCompliance({
                employeeId: user.id,
                shiftDate: shift.date,
                startTime: shift.startTime + ':00',
                endTime: shift.endTime + ':00',
                netLengthMinutes: shift.netLength,
                shiftId: shift.id,
            });
            setCheckingV8ShiftId(null);

            if (result.status === 'violated' || result.status === 'warned') {
                setComplianceResult(result);
                setPendingBidShift(shift);
                setShowComplianceDialog(true);
            } else {
                placeBidMutation.mutate(shift.id);
            }
        } catch {
            setCheckingV8ShiftId(null);
            toast({ title: 'Compliance Check Unavailable', description: 'Proceeding with bid.', variant: 'default' });
            placeBidMutation.mutate(shift.id);
        }
    };

    const handleConfirmBidWithWarning = () => {
        if (pendingBidShift) placeBidMutation.mutate(pendingBidShift.id);
        setShowComplianceDialog(false);
        setPendingBidShift(null);
        setComplianceResult(null);
    };

    const handleCancelBid = () => {
        setShowComplianceDialog(false);
        setPendingBidShift(null);
        setComplianceResult(null);
    };

    // ========================================================================
    // ACTION HANDLERS
    // ========================================================================
    // Quick bid — Bucket A already checked at scan time; B/C/D advisory in background
    const handleQuickBid = (shift: ShiftData) => {
        placeBidMutation.mutate(shift.id, {
            onSuccess: () => {
                validateCompliance({
                    employeeId: user!.id,
                    shiftDate: shift.date,
                    startTime: shift.startTime + ':00',
                    endTime:   shift.endTime   + ':00',
                    netLengthMinutes: shift.netLength,
                    shiftId: shift.id,
                }).then(result => {
                    const hasNonEligibilityIssues =
                        (result.violations.length > 0 || result.warnings.length > 0) &&
                        result.qualificationViolations.length === 0;
                    if (hasNonEligibilityIssues) {
                        toast({
                            title: 'Advisory notice',
                            description: result.violations[0] || result.warnings[0],
                            variant: 'default',
                        });
                    }
                }).catch(() => {});
            },
        });
    };

    const handleWithdrawBid = (bidId: string) => {
        withdrawBidMutation.mutate(bidId);
    };

    // ========================================================================
    // RENDER: Shift Opportunity Card
    // ========================================================================
    const renderOpportunityCard = (opp: ShiftOpportunity) => (
        <BidOpportunityCard
            key={opp.id}
            opp={opp}
            rawShift={rawAvailableShifts.find(s => s.id === opp.id)}
            isSelected={selectedV8ShiftIds.includes(opp.id)}
            onToggleSelect={handleSelectShift}
            onQuickBid={handleQuickBid}
            onWithdraw={handleWithdrawBid}
            isPlacingBid={placeBidMutation.isPending}
            placingBidId={placeBidMutation.variables}
            isWithdrawing={withdrawBidMutation.isPending}
            isBulkModeActive={isBulkModeActive}
        />
    );

    // ========================================================================
    // RENDER: Compact mobile list row (table view on mobile)
    // ========================================================================
    const renderBidListItem = (opp: ShiftOpportunity) => (
        <BidOpportunityListItem
            key={opp.id}
            opp={opp}
            isSelected={selectedV8ShiftIds.includes(opp.id)}
            onToggleSelect={handleSelectShift}
            onOpen={setDrawerOpp}
            onQuickBid={handleQuickBid}
            onWithdraw={handleWithdrawBid}
            isPlacingBid={placeBidMutation.isPending}
            placingBidId={placeBidMutation.variables}
            isWithdrawing={withdrawBidMutation.isPending}
            isBulkModeActive={isBulkModeActive}
        />
    );

    // Bulk bid on the provided ids (the toolbar pre-filters to bidable opps).
    const handleBulkBidForIds = async (ids: any[]) => {
        if (!user || ids.length === 0) return;
        const results = await Promise.allSettled(ids.map(id => biddingApi.placeBid(id, user.id)));
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed    = results.filter(r => r.status === 'rejected').length;
        toast({
            title: `${succeeded} bid${succeeded !== 1 ? 's' : ''} placed`,
            description: failed > 0 ? `${failed} failed` : undefined,
        });
        setSelectedV8ShiftIds([]);
        queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        queryClient.invalidateQueries({ queryKey: ['myBids'] });
    };

    // Bulk withdraw selected pending bids (used by mobile selection toolbar)
    const handleBulkWithdraw = async (bidIds: string[]) => {
        if (bidIds.length === 0) return;
        const results = await Promise.allSettled(bidIds.map(id => biddingApi.withdrawBid(id)));
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed    = results.filter(r => r.status === 'rejected').length;
        toast({
            title: `${succeeded} bid${succeeded !== 1 ? 's' : ''} withdrawn`,
            description: failed > 0 ? `${failed} failed` : undefined,
        });
        setSelectedV8ShiftIds([]);
        queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        queryClient.invalidateQueries({ queryKey: ['myBids'] });
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── GOLD STANDARD HEADER (Rows 1 · 2 · 3) ── */}
            <GoldStandardHeader
                title="My Bids"
                Icon={Gavel}
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
                onRefresh={() => {
                    queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
                    queryClient.invalidateQueries({ queryKey: ['myBids'] });
                }}
                isLoading={eligibilityLoading}
                subFunctionBar={isBulkModeActive ? (
                    <BidSelectionToolbar
                        selectedIds={selectedV8ShiftIds}
                        visibleOpportunities={filteredBidOpportunities}
                        onSelectAllVisible={(ids) => setSelectedV8ShiftIds(ids)}
                        onClear={() => setSelectedV8ShiftIds([])}
                        onBidSelected={handleBulkBidForIds}
                        onWithdrawSelected={handleBulkWithdraw}
                        isBidding={placeBidMutation.isPending}
                        isWithdrawing={withdrawBidMutation.isPending}
                        isBulkModeActive={isBulkModeActive}
                        onCloseBulkMode={() => {
                            setIsBulkModeActive(false);
                            setSelectedV8ShiftIds([]);
                        }}
                        inline={true}
                    />
                ) : undefined}
                functionBarChildren={
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setIsBulkModeActive(prev => {
                                    const next = !prev;
                                    if (!next) setSelectedV8ShiftIds([]);
                                    return next;
                                });
                            }}
                            className={cn(
                                "flex items-center justify-center md:gap-2 transition-all font-black text-[10px] uppercase tracking-wider flex-shrink-0 active:scale-95",
                                "h-11 w-full rounded-xl p-0", // Mobile: uniform 44px, full width
                                "md:h-9 md:w-auto md:px-3.5 md:rounded-xl", // Desktop
                                isBulkModeActive 
                                    ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/30" 
                                    : isDark ? "bg-[#111827]/60 hover:bg-[#111827]/80 text-muted-foreground" : "bg-slate-100 hover:bg-slate-200 text-muted-foreground"
                            )}
                        >
                            <ListChecks className="h-5 w-5 md:h-4 md:w-4" />
                            <span className="hidden md:inline">Bulk Mode</span>
                        </Button>

                        <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                        "flex items-center justify-center transition-all p-0 flex-shrink-0 active:scale-95",
                                        "h-11 w-full rounded-xl", // Mobile: uniform 44px, full width
                                        "md:h-9 md:w-9 md:rounded-xl", // Desktop
                                        isSettingsOpen
                                            ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                                            : isDark ? "bg-[#111827]/60 hover:bg-[#111827]/80 text-muted-foreground" : "bg-slate-100 hover:bg-slate-200 text-muted-foreground"
                                    )}
                                >
                                    <Settings2 className="h-5 w-5 md:h-4 md:w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className={cn(
                                "rounded-xl border border-border shadow-2xl p-4 w-60 z-50",
                                isDark ? "bg-[#1c2333] text-white" : "bg-white text-slate-900"
                            )}>
                                <h4 className="font-black uppercase tracking-widest text-[10px] text-muted-foreground/80 mb-3 select-none">Bidding Settings</h4>
                                <div className="space-y-3">
                                    <label className="flex items-center gap-3 cursor-pointer group select-none">
                                        <input
                                            type="checkbox"
                                            checked={showIneligible}
                                            onChange={(e) => setShowIneligible(e.target.checked)}
                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                        />
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black uppercase tracking-wider group-hover:text-primary transition-colors">Show Ineligible</span>
                                            <span className="text-[9px] text-muted-foreground/60 leading-tight">Display shifts for which qualification is missing</span>
                                        </div>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer group select-none">
                                        <input
                                            type="checkbox"
                                            checked={showExpired}
                                            onChange={(e) => setShowExpired(e.target.checked)}
                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                        />
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black uppercase tracking-wider group-hover:text-primary transition-colors">Show Expired</span>
                                            <span className="text-[9px] text-muted-foreground/60 leading-tight">Display closed or expired shift opportunities</span>
                                        </div>
                                    </label>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </>
                }
                leftContent={
                    <div className="flex items-center gap-1.5 lg:gap-2">
                        <Calendar className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-primary" />
                        <span className="text-[10px] lg:text-sm font-black text-foreground tracking-tight whitespace-nowrap uppercase">
                            <span className="hidden sm:inline">Open Shifts</span>
                            <span className="sm:hidden">Shifts</span>
                        </span>
                        <span className="inline-flex items-center justify-center h-4 lg:h-5 min-w-[16px] lg:min-w-[20px] px-1 lg:px-1.5 rounded-full bg-primary/10 text-primary text-[9px] lg:text-[10px] font-black tabular-nums">
                            {filteredBidOpportunities.length}
                        </span>
                    </div>
                }
                filters={viewMode === 'table' || isMobile ? (
                    <Popover open={isGroupDropdownOpen} onOpenChange={setIsGroupDropdownOpen}>
                        <PopoverTrigger asChild>
                            <button
                                className={cn(
                                    "flex items-center justify-center md:justify-between transition-all duration-300 relative z-50 rounded-xl border border-border p-0 active:scale-95",
                                    "h-11 w-full", // Mobile: uniform 44px, full width
                                    "md:h-14 md:w-auto md:min-w-[180px] md:px-4 md:py-2.5", // Desktop
                                    isGroupDropdownOpen
                                        ? isMobile
                                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                                            : "ring-2 ring-primary bg-primary/5 shadow-primary/20"
                                        : isDark 
                                            ? "bg-[#1c2333] text-white hover:bg-[#252d40] border-white/5" 
                                            : "bg-white text-slate-700 hover:bg-indigo-50/50 shadow-lg shadow-black/5 border-slate-200",
                                    groupBy !== 'none' && !isGroupDropdownOpen && (
                                        isMobile 
                                            ? isDark ? "bg-primary/15 text-primary border-primary/30" : "bg-primary/10 text-primary border-primary/20"
                                            : ""
                                    )
                                )}
                                type="button"
                            >
                                <div className="hidden md:flex flex-col items-start gap-0.5">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30 leading-none">Group By</span>
                                    <span className="truncate max-w-[120px] sm:max-w-[180px] text-xs sm:text-sm font-semibold">
                                        {(() => {
                                            const map: Record<string, string> = {
                                                'subDepartment': 'SubDepartment',
                                                'group': 'Group',
                                                'subGroupName': 'Sub-Group',
                                                'role': 'Role',
                                                'date': 'Date',
                                                'none': 'None'
                                            };
                                            return map[groupBy] || groupBy;
                                        })()}
                                    </span>
                                </div>
                                <ChevronDown className="hidden md:block w-3.5 h-3.5 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform" />
                                
                                {/* Mobile Icon */}
                                <Layers className="md:hidden h-5 w-5" />
                            </button>
                        </PopoverTrigger>

                            <PopoverContent 
                                className="w-[200px] md:w-[var(--radix-popover-trigger-width)] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
                                sideOffset={10}
                                align="center"
                            >
                                <Command 
                                    className="bg-transparent overflow-visible w-full outline-none"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            setIsGroupDropdownOpen(false);
                                            e.preventDefault();
                                        }
                                    }}
                                >
                                    <div className="flex flex-col gap-1.5 w-full">
                                        {/* Search Bar Container */}
                                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                                            <CommandInput 
                                                placeholder="Search grouping..." 
                                                className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                                autoFocus
                                            />
                                        </div>

                                        {/* Results Container */}
                                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                                            <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                                                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">No grouping found.</CommandEmpty>
                                                
                                                <CommandGroup heading="Group By" className="px-1">
                                                    {([
                                                        { k: 'subDepartment', label: 'SubDepartment' },
                                                        { k: 'group',         label: 'Group' },
                                                        { k: 'subGroupName',  label: 'Sub-Group' },
                                                        { k: 'role',          label: 'Role' },
                                                        { k: 'date',          label: 'Date' },
                                                        { k: 'none',          label: 'None' },
                                                    ] as const).map(opt => {
                                                        const isSelected = groupBy === opt.k;
                                                        return (
                                                            <CommandItem
                                                                key={opt.k}
                                                                onSelect={() => {
                                                                    setGroupBy(opt.k);
                                                                    setIsGroupDropdownOpen(false);
                                                                }}
                                                                className={cn(
                                                                    "flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                                                                    "aria-selected:bg-primary aria-selected:text-primary-foreground group"
                                                                )}
                                                            >
                                                                <div className={cn(
                                                                    "w-5 h-5 rounded-md border flex items-center justify-center transition-all",
                                                                    isSelected 
                                                                        ? "bg-white border-white text-primary" 
                                                                        : "border-muted-foreground/30 group-aria-selected:border-white/40"
                                                                )}>
                                                                    {isSelected && <Check className="w-3.5 h-3.5 text-primary" strokeWidth={3} />}
                                                                </div>
                                                                <span className="font-semibold text-sm sm:text-base">{opt.label}</span>
                                                                <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                                                            </CommandItem>
                                                        );
                                                    })}
                                                </CommandGroup>
                                            </CommandList>
                                            
                                            <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
                                                <div className="flex items-center gap-4">
                                                    <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↑↓</kbd> Nav</span>
                                                    <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↵</kbd> Select</span>
                                                </div>
                                                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close</span>
                                            </div>
                                        </div>
                                    </div>
                                </Command>
                            </PopoverContent>
                        </Popover>
                ) : undefined}
            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                {isScopeLoading || (eligibilityPending && rawAvailableShifts.length > 0) ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                        <p className="text-xs text-muted-foreground/60 uppercase tracking-widest font-black animate-pulse">Scanning Compliance...</p>
                    </div>
                ) : viewMode === 'card' ? (
                <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={`${startDate.toISOString()}-${endDate.toISOString()}`}
                            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4"
                            variants={pageVariants}
                            initial="hidden"
                            animate="show"
                            exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        >
                        {filteredBidOpportunities.map(opp => renderOpportunityCard(opp))}
                        {filteredBidOpportunities.length === 0 && (
                            <motion.div variants={itemVariants} className="col-span-full">
                                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                    <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                        <Calendar className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-foreground/60">No shifts match your filters</p>
                                        <p className="text-xs text-muted-foreground/40 mt-1">Try expanding your date range or clearing priority filters.</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                        </motion.div>
                    </AnimatePresence>
                </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                        {/* Mobile: vertical list rows, tap → bottom drawer. Group-by chips live in header. */}
                        <div className="md:hidden">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={`list-${groupBy}-${startDate.toISOString()}-${endDate.toISOString()}`}
                                    className="border border-border/40 rounded-xl overflow-hidden bg-background/40"
                                    variants={pageVariants}
                                    initial="hidden"
                                    animate="show"
                                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                                >
                                    {filteredBidOpportunities.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                            <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                                <Calendar className="h-6 w-6 text-muted-foreground/40" />
                                            </div>
                                            <p className="text-sm font-semibold text-foreground/60">No shifts match your filters</p>
                                        </div>
                                    ) : groupBy === 'none' ? (
                                        filteredBidOpportunities.map(renderBidListItem)
                                    ) : (
                                        groupOpportunities(filteredBidOpportunities, groupBy).map(g => (
                                            <BidOpportunityListSection
                                                key={g.key}
                                                label={g.label}
                                                count={g.items.length}
                                                accent={g.accent}
                                            >
                                                {g.items.map(renderBidListItem)}
                                            </BidOpportunityListSection>
                                        ))
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>

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
                                                        filteredBidOpportunities.length > 0 &&
                                                        filteredBidOpportunities.every(o => selectedV8ShiftIds.includes(o.id))
                                                    }
                                                    onChange={(e) => handleSelectAll(e.target.checked)}
                                                    className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                />
                                            </th>
                                        )}
                                        <SortableTableHeader sortKey="department" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Department</SortableTableHeader>
                                        <SortableTableHeader sortKey="subDepartment" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>SubDepartment</SortableTableHeader>
                                        <SortableTableHeader sortKey="group" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Group</SortableTableHeader>
                                        <SortableTableHeader sortKey="subGroupName" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>SubGroup</SortableTableHeader>
                                        <SortableTableHeader sortKey="role" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Role</SortableTableHeader>
                                        <SortableTableHeader sortKey="date" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Date</SortableTableHeader>
                                        <SortableTableHeader sortKey="startAt" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Time</SortableTableHeader>
                                        <SortableTableHeader sortKey="netLength" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Net</SortableTableHeader>
                                        <th className="p-3 text-left w-[120px]">Expires in</th>
                                        <th className="p-3 text-left w-[200px]">Action</th>
                                    </tr>
                                </thead>
                                {(groupBy === 'none'
                                    ? [{ key: '__all__', label: '', items: filteredBidOpportunities, accent: undefined } as const]
                                    : groupOpportunities(filteredBidOpportunities, groupBy)
                                ).map(g => (
                                  <tbody key={g.key}>
                                    {groupBy !== 'none' && (
                                        <tr className="bg-muted/40">
                                            <td colSpan={isBulkModeActive ? 11 : 10} className="px-3 py-1.5">
                                                <div className="flex items-center gap-2">
                                                    {g.accent && <span className={cn('h-2 w-2 rounded-full', g.accent.dot)} />}
                                                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-foreground/70">{g.label}</span>
                                                    <span className="text-[10px] font-bold tabular-nums text-muted-foreground/60">{g.items.length}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {g.items.map(opp => {
                                        const { participationStatus, currentBid } = opp;
                                        const shiftStart = opp.startAt
                                            ? new Date(opp.startAt)
                                            : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
                                        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                                        const isExpired = new Date() >= biddingCloses;
                                        const canSelect = (participationStatus === 'not_participated' && opp.isEligible) ||
                                                          (participationStatus === 'pending' && !!currentBid);

                                        return (
                                            <tr 
                                                key={opp.id} 
                                                className={cn(
                                                    "border-t border-border/50 transition-colors cursor-pointer",
                                                    getRowClass(opp.groupType, opp.department)
                                                )}
                                                onClick={() => {
                                                    if (isBulkModeActive) {
                                                        if (canSelect) {
                                                            handleSelectShift(opp.id);
                                                        }
                                                    }
                                                }}
                                            >
                                                {isBulkModeActive && (
                                                    <td className="p-3" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedV8ShiftIds.includes(opp.id)}
                                                            onChange={() => handleSelectShift(opp.id)}
                                                            disabled={!canSelect}
                                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-3 font-medium">{opp.department}</td>
                                                <td className="p-3 text-muted-foreground/80">{opp.subDepartment}</td>
                                                <td className="p-3 font-medium text-foreground/80">{opp.group}</td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn("w-1.5 h-1.5 rounded-full", opp.subGroupColor || 'bg-slate-400')} />
                                                        {opp.subGroupName}
                                                    </div>
                                                </td>
                                                <td className="p-3 font-bold text-primary">{opp.role}</td>
                                                <td className="p-3">{format(parseISO(opp.date), 'EEE d MMM')}</td>
                                                <td className="p-3 tabular-nums font-mono">{opp.startTime}–{opp.endTime}</td>
                                                <td className="p-3 font-mono text-muted-foreground">
                                                    {(() => {
                                                        const h = Math.floor(opp.netLength / 60);
                                                        const m = Math.round(opp.netLength % 60);
                                                        return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                                                    })()}
                                                </td>
                                                <td className="p-3 font-mono text-[11px] tabular-nums">
                                                    {(() => {
                                                        const tr = calculateTimeRemaining(biddingCloses.toISOString());
                                                        if (tr.isExpired) return <span className="text-muted-foreground/50 italic">Closed</span>;
                                                        const totalMs = biddingCloses.getTime() - Date.now();
                                                        const urgent = totalMs < 4 * 60 * 60 * 1000;
                                                        return (
                                                            <span className={cn(urgent ? 'text-amber-500 font-bold' : 'text-foreground/70')}>
                                                                {formatTimeRemaining(tr)}
                                                            </span>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="p-3">
                                                    {participationStatus === 'dropped' && (
                                                        <span className="text-xs text-rose-500 flex items-center gap-1 font-bold"><XCircle size={12} /> Dropped</span>
                                                    )}
                                                    {participationStatus === 'rejected_offer' && (
                                                        <span className="text-xs text-rose-500 flex items-center gap-1 font-bold"><XCircle size={12} /> Rejected</span>
                                                    )}
                                                    {participationStatus === 'not_participated' && !isExpired && (
                                                        opp.isEligible ? (
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-xs font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                                                                disabled={placeBidMutation.isPending}
                                                                onClick={() => handleQuickBid(opp)}
                                                            >
                                                                {placeBidMutation.isPending && placeBidMutation.variables === opp.id
                                                                    ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                                    : <ThumbsUp className="mr-1 h-3 w-3" />
                                                                }
                                                                Bid
                                                            </Button>
                                                        ) : (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <span className="text-xs text-rose-500 flex items-center gap-1 font-medium opacity-60 cursor-help"><Ban size={12} /> Ineligible</span>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="max-w-[220px] text-[10px] font-black uppercase tracking-wider p-2.5 rounded-xl border border-border/45 shadow-xl bg-background text-foreground z-50">
                                                                        {opp.ineligibilityReason ?? 'You are not eligible for this shift'}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )
                                                    )}
                                                    {participationStatus === 'not_participated' && isExpired && (
                                                        <span className="text-xs text-slate-400 flex items-center gap-1 font-medium italic"><Ban size={12} /> Closed</span>
                                                    )}
                                                    {participationStatus === 'pending' && (
                                                        <div className="flex gap-2 items-center">
                                                            <span className="text-xs text-amber-500 flex items-center gap-1 font-bold"><Clock size={12} /> Pending</span>
                                                            {!isExpired && currentBid && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-[10px] font-black uppercase tracking-widest border-border/40 hover:bg-red-500/10 hover:text-red-400"
                                                                    onClick={() => handleWithdrawBid(currentBid.id)}
                                                                    disabled={withdrawBidMutation.isPending}
                                                                >
                                                                    Withdraw
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                    {participationStatus === 'selected' && (
                                                        <span className="text-xs text-emerald-400 flex items-center gap-1 font-bold"><CheckCircle size={12} /> Selected</span>
                                                    )}
                                                    {participationStatus === 'rejected' && (
                                                        <span className="text-xs text-slate-400 flex items-center gap-1 font-medium"><Ban size={12} /> Not Selected</span>
                                                    )}
                                                    {participationStatus === 'expired' && (
                                                        <span className="text-xs text-slate-400 flex items-center gap-1 font-medium"><Ban size={12} /> Expired</span>
                                                    )}
                                                    {participationStatus === 'auto_rejected' && (
                                                        <span className="text-xs text-rose-500 flex items-center gap-1 font-bold"><Ban size={12} /> Auto-Rejected</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                  </tbody>
                                ))}
                                {filteredBidOpportunities.length === 0 && (
                                    <tbody>
                                        <tr>
                                            <td colSpan={isBulkModeActive ? 11 : 10} className="p-12 text-center text-muted-foreground/60 italic text-sm">
                                                No matching shifts found.
                                            </td>
                                        </tr>
                                    </tbody>
                                )}
                            </table>
                        </div>
                    </div>
                )}
                </div>
            </div>



            {/* ── COMPLIANCE WARNING DIALOG ── */}
            <BidConfirmComplianceDialog
                open={showComplianceDialog}
                onOpenChange={setShowComplianceDialog}
                result={complianceResult}
                onCancel={handleCancelBid}
                onConfirm={handleConfirmBidWithWarning}
            />

            {/* ── COMPLIANCE DETAIL MODAL ── */}
            {complianceModalShift && (
                <BidComplianceModal
                    isOpen={isComplianceModalOpen}
                    onClose={() => { setIsComplianceModalOpen(false); setComplianceModalShift(null); }}
                    shift={complianceModalShift as any}
                    onConfirmBid={() => {
                        if (complianceModalShift) placeBidMutation.mutate(complianceModalShift.id);
                        setIsComplianceModalOpen(false);
                        setComplianceModalShift(null);
                    }}
                    isPending={placeBidMutation.isPending}
                />
            )}

            {/* ── BID DETAIL DRAWER (mobile list tap) ── */}
            <BidOpportunityDrawer
                opp={drawerOpp}
                onClose={() => setDrawerOpp(null)}
                onQuickBid={handleQuickBid}
                onWithdraw={handleWithdrawBid}
                rawShift={drawerOpp ? rawAvailableShifts.find(s => s.id === drawerOpp.id) : null}
                isPlacingBid={placeBidMutation.isPending}
                placingBidId={placeBidMutation.variables}
                isWithdrawing={withdrawBidMutation.isPending}
            />
        </div>
    );
};

export default EmployeeBidsPage;
