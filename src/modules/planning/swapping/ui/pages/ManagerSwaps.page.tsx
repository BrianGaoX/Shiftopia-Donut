import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { Check, X, ChevronRight, ArrowLeftRight, Clock, CheckCircle, XCircle, Calendar, AlertTriangle, Shield, Gavel, RefreshCw, ShieldCheck, ShieldAlert, ShieldX, ScanSearch, Megaphone, UserCheck as LucideUserCheck, Circle, Minus } from 'lucide-react';
import { ManagerComplianceApprovalModal } from '../components/ManagerComplianceApprovalModal';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { useToast } from '@/modules/core/hooks/use-toast';
import { format, differenceInHours, parseISO, parse } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { swapsApi } from '../../api/swaps.api';
import { motion, AnimatePresence } from 'framer-motion';

import { SwapRequestWithDetails, SwapStatus } from '../../model/swap.types';
import { SwapPriority, PRIORITY_CONFIG } from './EmployeeSwaps.page';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

/* ============================================================
   DESIGN TOKENS (Deprecated hex scales, using theme-aware variables)
   ============================================================ */

/* ============================================================
   HELPERS
   ============================================================ */

const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};



// Authoritative: shift.group_type is the only signal. No name/uuid fallbacks.
function getDeptGlassClass(data?: { groupType?: string }): string {
    const g = (data?.groupType || '').toLowerCase();
    if (g.includes('convention')) return 'dept-card-glass-convention';
    if (g.includes('exhibition')) return 'dept-card-glass-exhibition';
    if (g.includes('theatre'))    return 'dept-card-glass-theatre';
    return 'dept-card-glass-default';
}




function getDeptAccent(dept?: string | null): string {
    const d = (dept || '').toLowerCase();
    if (d.includes('convention')) return 'text-blue-600 dark:text-blue-400';
    if (d.includes('exhibition')) return 'text-emerald-600 dark:text-emerald-400';
    if (d.includes('theatre')) return 'text-rose-600 dark:text-rose-400';
    return 'text-muted-foreground';
}


function getDeptGlow(dept?: string | null): string {
    const d = (dept || '').toLowerCase();
    if (d.includes('convention')) return 'shadow-blue-500/10';
    if (d.includes('exhibition')) return 'shadow-emerald-500/10';
    if (d.includes('theatre')) return 'shadow-rose-500/10';
    return 'shadow-white/5';
}

/* ============================================================
   STATUS TABS
   ============================================================ */

const STATUS_TABS = [
    { id: 'MANAGER_PENDING', label: 'Pending', icon: Clock, accent: 'amber' },
    { id: 'OPEN', label: 'Open', icon: ArrowLeftRight, accent: 'blue' },
    { id: 'APPROVED', label: 'Approved', icon: CheckCircle, accent: 'emerald' },
    { id: 'REJECTED', label: 'Rejected', icon: XCircle, accent: 'red' },
    { id: 'all', label: 'All', icon: Shield, accent: 'slate' },
] as const;

const accentMap: Record<string, { bg: string; text: string; ring: string; glow: string }> = {
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-500/20', glow: 'shadow-amber-500/10' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', ring: 'ring-blue-500/20', glow: 'shadow-blue-500/10' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/20', glow: 'shadow-emerald-500/10' },
    red: { bg: 'bg-red-500/10', text: 'text-rose-600 dark:text-rose-400', ring: 'ring-rose-500/20', glow: 'shadow-rose-500/10' },
    slate: { bg: 'bg-muted/50', text: 'text-muted-foreground', ring: 'ring-border', glow: 'shadow-sm' },
};

/* ============================================================
   EMPLOYEE SHIFT PANE (within card)
   ============================================================ */

const ShiftPane: React.FC<{
    label: string;
    data: SwapRequestManagement['requestor'] | SwapRequestManagement['recipient'];
    isRequester: boolean;
}> = ({ label, data, isRequester }) => {
    const { isDark } = useTheme();
    if (!data) {
        return (
            <div className="flex-1 min-h-[140px] rounded-[32px] border border-dashed border-border/40 flex flex-col items-center justify-center gap-3 bg-muted/5 opacity-40 grayscale">
                <Circle className="h-6 w-6 text-muted-foreground/30" />
                <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest font-black">Open Market Swap</span>
            </div>
        );
    }

    const deptClass = getDeptGlassClass({ groupType: data.groupType });

    const startTimeRaw = data.time?.split(' - ')[0] || '00:00';
    const endTimeRaw = data.time?.split(' - ')[1] || '00:00';
    return (
        <div className="flex-1 min-w-0">
            <SharedShiftCard
                variant="timecard"
                isFlat={false}
                organization={data.orgName || 'ICC Sydney'}
                department={data.deptName || 'Department'}
                subGroup={data.subGroupName}
                role={data.roleName || 'Shift'}
                shiftDate={data.formattedDate || 'N/A'}
                startTime={startTimeRaw.slice(0, 5)}
                endTime={endTimeRaw.slice(0, 5)}
                netLength={data.netLengthMinutes}
                paidBreak={data.paidBreakMinutes}
                unpaidBreak={data.unpaidBreakMinutes}
                lifecycleStatus={data.lifecycleStatus}
                estimatedPay={data.estimatedPay > 0 ? `$${data.estimatedPay.toFixed(2)}` : undefined}
                groupVariant={
                    deptClass.includes('convention') ? 'convention' :
                    deptClass.includes('exhibition') ? 'exhibition' :
                    deptClass.includes('theatre') ? 'theatre' : 'default'
                }
                employeeName={data.employeeName}
                avatarUrl={data.avatar}
                topContent={
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className={cn(
                                "h-1.5 w-6 rounded-full",
                                isRequester ? "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                            )} />
                            <span className={cn(
                                "text-[9px] font-black uppercase tracking-[0.25em]",
                                isRequester ? "text-indigo-600 dark:text-indigo-400" : "text-emerald-600 dark:text-emerald-400"
                            )}>
                                {label}
                            </span>
                        </div>
                    </div>
                }
                className={cn(
                    "h-full border-none",
                    isRequester 
                        ? (isDark ? "bg-[#1c2333]/65 shadow-indigo-500/10" : "bg-white/80 shadow-indigo-200/50") 
                        : (isDark ? "bg-[#141d2e]/65 shadow-emerald-500/10" : "bg-white/60 shadow-emerald-200/50")
                )}
            />
        </div>
    );
};


/* ============================================================
   SWAP ARROW (center divider)
   ============================================================ */

type ComplianceStatus = 'PASS' | 'WARNING' | 'BLOCKING' | null;

const COMPLIANCE_STYLES: Record<'PASS' | 'WARNING' | 'BLOCKING', {
    ring: string; icon: React.ReactNode; label: string;
}> = {
    PASS:     { ring: 'bg-emerald-500/10 border-emerald-500/20', icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />, label: 'Compliance Passed' },
    WARNING:  { ring: 'bg-amber-500/10 border-amber-500/20',   icon: <ShieldAlert  className="h-3.5 w-3.5 text-amber-500"  />, label: 'Compliance Warnings' },
    BLOCKING: { ring: 'bg-rose-500/10 border-rose-500/20',     icon: <ShieldX      className="h-3.5 w-3.5 text-rose-500"   />, label: 'Compliance Blocked' },
};

const SwapDivider: React.FC<{ hoursDiff: number; payDiff: number; compliance: ComplianceStatus }> = ({ hoursDiff, payDiff, compliance }) => {
    const hoursColor = hoursDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : hoursDiff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/30';
    const payColor = payDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : payDiff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/30';
    const cStyle = compliance ? COMPLIANCE_STYLES[compliance] : null;

    return (
        <div className="flex sm:flex-col items-center justify-center px-4 py-6 gap-3 flex-shrink-0 relative">
            <div className="h-px w-8 sm:h-8 sm:w-px bg-border/50 absolute top-0 left-1/2 -translate-x-1/2 hidden sm:block" />
            <div className="h-px w-8 sm:h-8 sm:w-px bg-border/50 absolute bottom-0 left-1/2 -translate-x-1/2 hidden sm:block" />

            <div className="h-12 w-12 rounded-full bg-background border border-border flex items-center justify-center shadow-xl relative z-10 transition-transform group-hover:scale-110">
                <ArrowLeftRight className="h-5 w-5 text-primary" />
            </div>

            <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
                <Badge variant="secondary" className={cn("text-[10px] font-black font-mono shadow-none px-2", hoursColor)}>
                    {hoursDiff > 0 ? '+' : ''}{hoursDiff.toFixed(1)}h
                </Badge>
                {payDiff !== 0 && (
                    <span className={cn("text-[9px] font-mono font-black opacity-60", payColor)}>
                        {payDiff > 0 ? '+' : ''}${payDiff.toFixed(0)}
                    </span>
                )}
                {cStyle && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger className="mt-1">
                                <div className={cn("h-6 w-6 rounded-full flex items-center justify-center border", cStyle.ring)}>
                                    {cStyle.icon}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="bg-popover text-popover-foreground border-border shadow-xl">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[10px] font-black uppercase tracking-wider">{cStyle.label}</span>
                                    <span className="text-[9px] font-mono text-muted-foreground opacity-60">Engine v2</span>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
        </div>
    );
};


/* ============================================================
   UI TYPES & MAPPER
   ============================================================ */

interface SwapRequestManagement {
    id: string;
    requestor: {
        employeeName: string;
        roleName: string;
        date: string;
        formattedDate: string;
        time: string;
        duration: string;
        durationNum: number;
        hourlyRate: number;
        netLengthMinutes: number;
        paidBreakMinutes: number;
        unpaidBreakMinutes: number;
        estimatedPay: number;
        avatar?: string;
        deptName?: string;
        subGroupName?: string;
        orgName?: string;
        groupType?: string;
        organizationId?: string;
        subDepartmentId?: string;
        lifecycleStatus?: string;
        stateId?: string;
    };




    recipient: {
        employeeName: string;
        roleName: string;
        date: string;
        formattedDate: string;
        time: string;
        duration: string;
        durationNum: number;
        hourlyRate: number;
        netLengthMinutes: number;
        paidBreakMinutes: number;
        unpaidBreakMinutes: number;
        estimatedPay: number;
        avatar?: string;
        deptName?: string;
        subGroupName?: string;
        orgName?: string;
        groupType?: string;
        organizationId?: string;
        subDepartmentId?: string;
        lifecycleStatus?: string;
        stateId?: string;
    } | null;




    status: SwapStatus;
    reason: string;
    requestedAt: string;
    tags: string[];
    hoursDiff: number;
    payDiff: number;
    complianceStatus: ComplianceStatus;
    priority?: SwapPriority;
    shiftStateId: string;
    combinedStateId: string;
    deptName: string;
    // Raw IDs needed for manager compliance re-check
    requesterEmployeeId: string;
    offererEmployeeId: string | null;
    requesterV8ShiftId: string;
    offererV8ShiftId: string | null;
    // Compliance snapshot saved at acceptance time (from swap_offers)
    complianceSnapshot: any | null;
}

/** Compute duration hours from camelCase timing strings */
const computeShiftHours = (s: { startTime: string; endTime: string; unpaidBreakMinutes?: number }): number => {
    try {
        const [sh, sm] = s.startTime.slice(0, 5).split(':').map(Number);
        const [eh, em] = s.endTime.slice(0, 5).split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins < 0) mins += 1440;
        return Math.max(0, mins - (s.unpaidBreakMinutes || 0)) / 60;
    } catch { return 0; }
};

const mapToUIModel = (apiData: SwapRequestWithDetails): SwapRequestManagement => {
    const getShiftValue = (shift?: any) => {
        if (!shift) return { rate: 0, durationHours: 0, value: 0 };
        const netLength = shift?.net_length_minutes ?? shift?.netLength ?? 0;
        const durationHours = netLength / 60;
        const totalCost = estimateDetailedCostFromShift(shift).totalCost || 0;
        const rate = durationHours > 0 ? totalCost / durationHours : 0;
        return { rate, durationHours, value: totalCost };
    };

    const reqVal = getShiftValue(apiData.originalShift);
    const recVal = getShiftValue(apiData.requestedShift);

    const activeOffer = apiData.swap_offers?.find(o =>
        (o.offered_shift_id === apiData.offered_shift_id) ||
        (o.status === 'SELECTED')
    ) ?? apiData.swap_offers?.find(o => o.status !== 'rejected' && o.status !== 'withdrawn');

    const snap = activeOffer?.compliance_snapshot;
    let complianceStatus: ComplianceStatus = null;
    if (snap !== null && snap !== undefined) {
        if (snap.status === 'PASS' || snap.status === 'WARNING' || snap.status === 'BLOCKING') {
            complianceStatus = snap.status as ComplianceStatus;
        } else if (snap.passed === true) {
            complianceStatus = (snap.warnings_count ?? 0) > 0 ? 'WARNING' : 'PASS';
        } else if (snap.passed === false) {
            complianceStatus = 'BLOCKING';
        }
    }

    // Duration / pay delta — use offered_shift when requestedShift absent
    const offerVal = activeOffer?.offered_shift ? getShiftValue(activeOffer.offered_shift) : { rate: 0, durationHours: 0, value: 0 };
    const offerDurationHours = offerVal.durationHours;
    const hoursDiff = apiData.requestedShift
        ? (recVal.durationHours - reqVal.durationHours)
        : activeOffer?.offered_shift
            ? (offerDurationHours - reqVal.durationHours)
            : -reqVal.durationHours;
    const payDiff = apiData.requestedShift
        ? (recVal.value - reqVal.value)
        : activeOffer?.offered_shift
            ? (offerVal.value - reqVal.value)
            : -reqVal.value;

    // Auto-compute priority from shift date/time (shared TTS utility)
    const priority: SwapPriority = computeShiftUrgency(
        apiData.originalShift?.shiftDate ?? '',
        apiData.originalShift?.startTime ?? '',
    );

    // Build recipient — fall back to activeOffer.offered_shift for open-market swaps
    let recipient: SwapRequestManagement['recipient'] = null;
    if (apiData.requestedShift || apiData.targetEmployee) {
        const recNet = apiData.requestedShift?.netLength ?? Math.round(recVal.durationHours * 60);
        recipient = {
            employeeName: apiData.targetEmployee?.fullName || (apiData.requestedShift ? 'Open Swap' : 'Unknown'),
            roleName: apiData.requestedShift?.roles?.name || 'Any Role',
            date: apiData.requestedShift?.shiftDate || '',
            formattedDate: apiData.requestedShift?.shiftDate ? format(parse(apiData.requestedShift.shiftDate, 'yyyy-MM-dd', new Date()), 'EEE, MMM d, yyyy') : '',
            time: apiData.requestedShift ? `${apiData.requestedShift.startTime} - ${apiData.requestedShift.endTime}` : 'No Shift',
            duration: recVal.durationHours > 0 ? `${recVal.durationHours.toFixed(1)}h` : '0h',
            durationNum: recVal.durationHours,
            hourlyRate: recVal.rate,
            netLengthMinutes: recNet,
            paidBreakMinutes: apiData.requestedShift?.paidBreakDuration ?? 0,
            unpaidBreakMinutes: apiData.requestedShift?.unpaidBreakDuration ?? 0,
            estimatedPay: recVal.value,
            avatar: apiData.targetEmployee?.avatarUrl,
            deptName: apiData.requestedShift?.departments?.name || 'General',
            subGroupName: apiData.requestedShift?.sub_departments?.name,
            orgName: apiData.requestedShift?.organizations?.name || '',
            groupType: apiData.requestedShift?.group_type || '',
            organizationId: apiData.requestedShift?.organizationId,
            subDepartmentId: apiData.requestedShift?.subDepartmentId,
            lifecycleStatus: apiData.requestedShift?.lifecycleStatus || 'Published',
            stateId: apiData.requestedShift?.stateId || 'S?',
        };
    } else if (activeOffer?.offered_shift) {
        // Open-market swap where an offer was accepted
        const os = activeOffer.offered_shift;
        const offererName = activeOffer.offerer
            ? `${activeOffer.offerer.first_name} ${activeOffer.offerer.last_name}`.trim()
            : 'Offerer';
        const osNet = Math.round(offerDurationHours * 60);
        const osDateRaw = os.shiftDate;
        const osStart = os.startTime ?? '00:00:00';
        const osEnd = os.endTime ?? '00:00:00';
        recipient = {
            employeeName: offererName,
            roleName: os.roles?.name || 'Unknown Role',
            date: osDateRaw,
            formattedDate: osDateRaw ? format(parse(osDateRaw, 'yyyy-MM-dd', new Date()), 'EEE, MMM d, yyyy') : '',
            time: `${osStart} - ${osEnd}`,
            duration: `${offerDurationHours.toFixed(1)}h`,
            durationNum: offerDurationHours,
            hourlyRate: offerVal.rate,
            netLengthMinutes: osNet,
            paidBreakMinutes: 0,
            unpaidBreakMinutes: os.unpaidBreakMinutes ?? 0,
            estimatedPay: offerVal.value,
            avatar: activeOffer.offerer?.avatar_url,
            deptName: os.departments?.name || 'General',
            subGroupName: undefined,
            orgName: undefined,
            groupType: '',
            organizationId: undefined,
            subDepartmentId: undefined,
            lifecycleStatus: os.lifecycleStatus ?? 'Published',
            stateId: os.stateId || 'S?',
        };
    }

    return {
        id: apiData.id,
        requestor: {
            employeeName: apiData.requestorEmployee?.fullName || 'Unknown',
            roleName: apiData.originalShift?.roles?.name || 'Unknown Role',
            date: apiData.originalShift?.shiftDate || '',
            formattedDate: apiData.originalShift?.shiftDate ? format(parse(apiData.originalShift.shiftDate, 'yyyy-MM-dd', new Date()), 'EEE, MMM d, yyyy') : '',
            time: `${apiData.originalShift?.startTime} - ${apiData.originalShift?.endTime}`,
            duration: `${reqVal.durationHours.toFixed(1)}h`,
            durationNum: reqVal.durationHours,
            hourlyRate: reqVal.rate,
            netLengthMinutes: apiData.originalShift?.netLength ?? Math.round(reqVal.durationHours * 60),
            paidBreakMinutes: apiData.originalShift?.paidBreakDuration ?? 0,
            unpaidBreakMinutes: apiData.originalShift?.unpaidBreakDuration ?? 0,
            estimatedPay: reqVal.value,
            avatar: apiData.requestorEmployee?.avatarUrl,
            deptName: apiData.originalShift?.departments?.name || 'General',
            subGroupName: apiData.originalShift?.sub_departments?.name,
            orgName: apiData.originalShift?.organizations?.name || '',
            groupType: apiData.originalShift?.group_type || '',
            organizationId: apiData.originalShift?.organizationId,
            subDepartmentId: apiData.originalShift?.subDepartmentId,
            lifecycleStatus: apiData.originalShift?.lifecycleStatus || 'Published',
            stateId: apiData.originalShift?.stateId || 'S?',
        },
        recipient,
        status: apiData.status as any,
        reason: apiData.reason || '',
        requestedAt: apiData.created_at,
        tags: [apiData.originalShift?.departments?.name || 'General'],
        hoursDiff,
        payDiff,
        complianceStatus,
        priority,
        deptName: apiData.originalShift?.departments?.name || 'General',
        ...deriveStateIds(apiData.status),
        requesterEmployeeId: apiData.requested_by_employee_id,
        offererEmployeeId: apiData.swap_with_employee_id || activeOffer?.offerer_id || null,
        requesterV8ShiftId: apiData.original_shift_id,
        offererV8ShiftId: apiData.offered_shift_id || activeOffer?.offered_shift_id || null,
        complianceSnapshot: activeOffer?.compliance_snapshot ?? null,
    };
};


const deriveStateIds = (status: string): { shiftStateId: string; combinedStateId: string } => {
    switch (status) {
        case 'OPEN': return { shiftStateId: 'S9', combinedStateId: 'C2' };
        case 'MANAGER_PENDING': return { shiftStateId: 'S10', combinedStateId: 'C3' };
        case 'APPROVED': return { shiftStateId: 'S4', combinedStateId: 'C4' };
        case 'REJECTED': return { shiftStateId: 'S4', combinedStateId: 'C5' };
        case 'CANCELLED': return { shiftStateId: 'S4', combinedStateId: 'C6' };
        case 'EXPIRED': return { shiftStateId: 'S4', combinedStateId: 'C7' };
        default: return { shiftStateId: '??', combinedStateId: '??' };
    }
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export const ManagerSwapsPage: React.FC = () => {
    const { toast } = useToast();
    const { activeContract } = useAuth();
    const isMobile = useIsMobile();
    const orgSelection = useOrgSelection();
    const { scope, setScope, scopeKey, isGammaLocked } = useScopeFilter('managerial');
    const { isDark } = useTheme();

    const currentOrgId = scope.org_ids[0] || orgSelection.organizationId;
    const currentDeptId = scope.dept_ids.length === 1 ? scope.dept_ids[0] : undefined;
    const currentSubDeptId = scope.subdept_ids.length === 1 ? scope.subdept_ids[0] : undefined;

    // ==================== STATE ====================
    const [statusFilter, setStatusFilter] = useState<SwapStatus | 'all'>('MANAGER_PENDING');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [actionConfirm, setActionConfirm] = useState<{
        ids: string[];
        status: 'approved' | 'rejected';
        reason?: string;
    } | null>(null);
    // Single-item compliance approval modal (replaces simple confirm for single approvals)
    const [complianceApprovalTarget, setComplianceApprovalTarget] = useState<SwapRequestManagement | null>(null);
    const [swapRequests, setSwapRequests] = useState<SwapRequestManagement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [searchQuery, setSearchQuery] = useState('');

    // ==================== DATA FETCHING ====================
    const fetchData = async () => {
        if (!currentOrgId) return;

        setIsLoading(true);
        try {
            const apiData = await swapsApi.fetchSwapRequests({
                organizationId: currentOrgId,
                departmentId: currentDeptId,
                subDepartmentId: currentSubDeptId
            });
            const uiData = apiData.map(mapToUIModel);
            setSwapRequests(uiData);
        } catch (error) {
            console.error(error);
            toast({
                title: 'Error fetching requests',
                description: 'Failed to load swap requests.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Use scopeKey to stabilize deps and prevent infinite re-fetching
    useEffect(() => {
        if (currentOrgId) {
            fetchData();
        }
        const interval = setInterval(() => {
            if (currentOrgId) fetchData();
        }, 30000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, scopeKey]);

    // ==================== COMPUTED ====================
    const filteredRequests = useMemo(() => {
        let base = statusFilter === 'all' ? swapRequests : swapRequests.filter(r => r.status === statusFilter);
        
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            base = base.filter(r => 
                r.requestor.employeeName.toLowerCase().includes(q) ||
                r.recipient?.employeeName?.toLowerCase().includes(q) ||
                r.requestor.roleName.toLowerCase().includes(q)
            );
        }
        
        return base;
    }, [swapRequests, statusFilter, searchQuery]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {
            MANAGER_PENDING: 0, OPEN: 0, APPROVED: 0, REJECTED: 0, all: 0
        };
        swapRequests.forEach(r => {
            if (counts[r.status] !== undefined) counts[r.status]++;
        });
        counts.all = swapRequests.length;
        return counts;
    }, [swapRequests]);

    // ==================== HANDLERS ====================
    const handleAction = (ids: string[], status: 'approved' | 'rejected') => {
        // Single-item approval → open compliance gate modal
        if (status === 'approved' && ids.length === 1) {
            const target = swapRequests.find(r => r.id === ids[0]);
            if (target) {
                setComplianceApprovalTarget(target);
                return;
            }
        }
        // Batch or rejection → simple confirm dialog
        setActionConfirm({ ids, status });
    };

    const handleConfirmAction = async () => {
        if (!actionConfirm) return;

        const { ids, status } = actionConfirm;
        const previousState = [...swapRequests];
        setSwapRequests(prev => prev.map(r => ids.includes(r.id) ? { ...r, status: status === 'approved' ? 'APPROVED' : 'REJECTED' } : r));

        try {
            if (status === 'approved') {
                await Promise.all(ids.map(id => swapsApi.approveSwapRequest(id)));
            } else {
                await Promise.all(ids.map(id => swapsApi.rejectSwapRequest(id, actionConfirm.reason || 'Manager Action')));
            }
            toast({ title: 'Success', description: `Request(s) ${status} successfully` });
            fetchData();
        } catch (error) {
            console.error('Failed to process swap:', error);
            setSwapRequests(previousState);
            toast({
                title: 'Operation Failed',
                description: error instanceof Error ? error.message : 'Could not complete the action.',
                variant: 'destructive',
            });
        }

        setSelectedIds(new Set());
        setActionConfirm(null);
    };

    const toggleSelection = (id: string) => {
        setSelectedIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    const handleSelectAll = () => {
        if (selectedIds.size === filteredRequests.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(filteredRequests.map(r => r.id)));
    };

    // ==================== RENDER ====================
    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* Ambient glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/[0.05] blur-[150px] rounded-full pointer-events-none" />

            {/* ── GOLD STANDARD HEADER (Rows 1 · 2 · 3) ── */}
            <GoldStandardHeader
                title="Swap Requests"
                Icon={ArrowLeftRight}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onRefresh={fetchData}
                isLoading={isLoading}
                functionBarChildren={
                    <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/30 border border-border flex-nowrap overflow-x-auto scrollbar-hide">
                        {STATUS_TABS.map(tab => {
                            const isActive = statusFilter === tab.id;
                            const colors = accentMap[tab.accent];
                            const TabIcon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setStatusFilter(tab.id as any)}
                                    className={cn(
                                        "relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-black transition-all duration-300",
                                        isActive
                                            ? `${colors.bg} ${colors.text} shadow-sm`
                                            : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/50"
                                    )}
                                >
                                    <TabIcon className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                    <span className={cn(
                                        "min-w-[18px] h-[18px] rounded-full text-[9px] font-black flex items-center justify-center px-1",
                                        isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.ring}` : "bg-muted text-muted-foreground/40"
                                    )}>
                                        {statusCounts[tab.id] || 0}
                                    </span>
                                    {isActive && (
                                        <motion.div
                                            layoutId="activeSwapTab"
                                            className={`absolute inset-0 rounded-xl ring-1 ${colors.ring}`}
                                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                }
            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-4 lg:px-6 py-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-32 gap-4">
                            <div className="h-10 w-10 rounded-full border-2 border-border border-t-indigo-500 animate-spin" />
                            <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-[0.3em]">Loading requests</span>
                        </div>
                    ) : filteredRequests.length === 0 ? (
                        /* Empty State */
                        <div className="flex flex-col items-center justify-center py-32 gap-6">
                            <div className="relative">
                                <div className="h-20 w-20 rounded-3xl bg-muted/40 border border-border flex items-center justify-center shadow-2xl">
                                    <ArrowLeftRight className="h-8 w-8 text-muted-foreground/20" />
                                </div>
                                <div className="absolute -inset-4 bg-primary/5 rounded-full blur-2xl animate-pulse" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-black text-foreground/40 mb-1 uppercase tracking-widest">No {statusFilter === 'all' ? '' : statusFilter.replace('_', ' ').toLowerCase()} requests</p>
                                <p className="text-[11px] text-muted-foreground/40 font-mono font-black">Check back later or adjust your filters</p>
                            </div>
                        </div>
                    ) : (
                        /* Request Cards */
                        <div className="space-y-4">
                            {/* Select All (for pending) */}
                            {statusFilter === 'MANAGER_PENDING' && filteredRequests.length > 1 && (
                                <div className="flex items-center gap-3 px-4 py-2">
                                    <Checkbox
                                        checked={selectedIds.size === filteredRequests.length}
                                        onCheckedChange={handleSelectAll}
                                        className="border-border/50"
                                    />
                                    <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                                        Select All ({filteredRequests.length})
                                    </span>
                                </div>
                            )}

                            <AnimatePresence mode="popLayout">
                                {filteredRequests.map((request, idx) => (
                                    <motion.div
                                        key={request.id}
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.96 }}
                                        transition={{ delay: idx * 0.05, duration: 0.3, ease: "easeOut" }}
                                        className={cn(
                                            "group rounded-2xl md:rounded-[2.5rem] border transition-all duration-300 hover:shadow-2xl overflow-hidden bg-card/40 backdrop-blur-md",
                                            "hover:translate-y-[-2px] border-border shadow-sm",
                                            selectedIds.has(request.id) && "ring-2 ring-primary border-primary/40 shadow-primary/20"
                                        )}
                                    >

                                        <div className="flex flex-col lg:flex-row">
                                            {/* Left: Checkbox + State Badges */}
                                            {statusFilter === 'MANAGER_PENDING' && (
                                                <div className="flex lg:flex-col items-center justify-center gap-3 p-4 lg:px-5 lg:border-r border-border/50 bg-muted/5">
                                                    <Checkbox
                                                        checked={selectedIds.has(request.id)}
                                                        onCheckedChange={() => toggleSelection(request.id)}
                                                        className="border-border shadow-sm"
                                                    />
                                                    <div className="flex lg:flex-col gap-1">
                                                        <Badge variant="outline" className="text-[8px] text-primary/50 border-primary/10 font-mono px-1.5 py-0 bg-background/50">
                                                            {request.shiftStateId}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-[8px] text-muted-foreground/30 border-border font-mono px-1.5 py-0">
                                                            {request.combinedStateId}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Center: Swap Comparison */}
                                            <div className="flex-1 flex flex-col sm:flex-row items-center gap-2 p-3">
                                                <ShiftPane data={request.requestor} label="REQUESTER" isRequester={true} />
                                                <SwapDivider
                                                    hoursDiff={request.hoursDiff}
                                                    payDiff={request.payDiff}
                                                    compliance={request.complianceStatus}
                                                />
                                                <ShiftPane data={request.recipient} label="OFFERER" isRequester={false} />
                                            </div>


                                            {/* Right: Action Panel */}
                                            <div className="flex flex-row lg:flex-col items-center justify-between gap-3 p-5 lg:pl-0 lg:border-l border-border/50 min-w-[180px] bg-muted/5">
                                                {/* Meta */}
                                                <div className="lg:flex-1 flex flex-col items-start lg:items-end gap-1.5 w-full">
                                                    <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest font-black">
                                                        {format(parseISO(request.requestedAt), 'MMM d, h:mm a')}
                                                    </span>
                                                    {request.reason && (
                                                        <p className="text-[10px] text-foreground/50 line-clamp-2 lg:text-right leading-relaxed max-w-[160px] italic font-medium">
                                                            "{request.reason}"
                                                        </p>
                                                    )}
                                                    <div className="flex gap-1.5 flex-wrap">
                                                        {request.tags.map(tag => (
                                                            <Badge key={tag} variant="outline" className={cn(
                                                                "text-[8px] font-black font-mono px-1.5 py-0 border-border/50 bg-background/50",
                                                                getDeptAccent(tag)
                                                            )}>
                                                                {tag}
                                                            </Badge>
                                                        ))}
                                                        {request.priority && (() => {
                                                            const pc = PRIORITY_CONFIG[request.priority];
                                                            const PIcon = pc.icon;
                                                            return (
                                                                <span className={cn(
                                                                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[8px] font-black font-mono uppercase tracking-wider",
                                                                    pc.badgeCls
                                                                )}>
                                                                    <PIcon className="h-2.5 w-2.5" />
                                                                    {pc.label}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                {request.status === 'MANAGER_PENDING' ? (
                                                    <div className="flex flex-col gap-2 w-full">
                                                        {/* Re-check compliance */}
                                                        <Button
                                                            onClick={() => setComplianceApprovalTarget(request)}
                                                            size="sm"
                                                            variant="outline"
                                                            className="flex-1 min-h-[44px] h-9 rounded-xl border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground text-[10px] font-black uppercase tracking-wider transition-all"
                                                        >
                                                            <ScanSearch className="h-3 w-3 mr-1.5" />
                                                            Check Compliance
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleAction([request.id], 'rejected')}
                                                            size="sm"
                                                            className="flex-1 min-h-[44px] h-9 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-black uppercase tracking-wider transition-all"
                                                        >
                                                            <X className="h-3 w-3 mr-1.5" />
                                                            Reject
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className={cn(
                                                        "flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border",
                                                        request.status === 'APPROVED'
                                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                                            : request.status === 'REJECTED'
                                                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                                                                : "bg-muted text-muted-foreground/50 border-border"
                                                    )}>
                                                        {request.status === 'APPROVED' && <CheckCircle className="h-3.5 w-3.5" />}
                                                        {request.status === 'REJECTED' && <XCircle className="h-3.5 w-3.5" />}
                                                        {request.status}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>
        </div>

            {/* ── BULK ACTION BAR ── */}
            <AnimatePresence>
                {selectedIds.size > 0 && (
                    <motion.div
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="sticky bottom-24 md:bottom-4 z-20 backdrop-blur-xl border border-primary/20 shadow-2xl shadow-primary/10 rounded-[2rem] mx-4 md:mx-6"
                        style={{ background: 'hsl(var(--card) / 0.9)' }}
                    >
                        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                    <span className="text-[11px] font-black text-primary">{selectedIds.size}</span>
                                </div>
                                <span className="text-[11px] font-black text-foreground/50 uppercase tracking-widest">
                                    Requests Selected
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => handleAction(Array.from(selectedIds), 'rejected')}
                                    size="sm"
                                    className="h-9 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-black uppercase tracking-wider"
                                >
                                    <X className="h-3 w-3 mr-1.5" />
                                    Reject Batch
                                </Button>
                                <Button
                                    onClick={() => handleAction(Array.from(selectedIds), 'approved')}
                                    size="sm"
                                    className="h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 text-[10px] font-black uppercase tracking-wider border-none"
                                >
                                    <Check className="h-3 w-3 mr-1.5" />
                                    Approve Batch
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── COMPLIANCE APPROVAL MODAL (single-item approve) ── */}
            <AnimatePresence>
                {complianceApprovalTarget && (
                    <ManagerComplianceApprovalModal
                        isOpen={!!complianceApprovalTarget}
                        onClose={() => setComplianceApprovalTarget(null)}
                        onApprove={async () => {
                            const id = complianceApprovalTarget.id;
                            const previousState = [...swapRequests];
                            setSwapRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'APPROVED' } : r));
                            setComplianceApprovalTarget(null);
                            try {
                                await swapsApi.approveSwapRequest(id);
                                toast({ title: 'Approved', description: 'Swap request approved successfully.' });
                                fetchData();
                            } catch (error) {
                                setSwapRequests(previousState);
                                toast({
                                    title: 'Approval Failed',
                                    description: error instanceof Error ? error.message : 'Could not approve swap.',
                                    variant: 'destructive',
                                });
                            }
                            setSelectedIds(new Set());
                        }}
                        onReject={(reason?: string) => {
                            const id = complianceApprovalTarget.id;
                            setComplianceApprovalTarget(null);
                            setActionConfirm({ ids: [id], status: 'rejected', reason });
                        }}
                        swapId={complianceApprovalTarget.id}
                        requesterEmployeeId={complianceApprovalTarget.requesterEmployeeId}
                        requesterName={complianceApprovalTarget.requestor.employeeName}
                        requesterV8ShiftId={complianceApprovalTarget.requesterV8ShiftId}
                        offererEmployeeId={complianceApprovalTarget.offererEmployeeId}
                        offererName={complianceApprovalTarget.recipient?.employeeName ?? 'Offerer'}
                        offererV8ShiftId={complianceApprovalTarget.offererV8ShiftId}
                        storedSnapshot={complianceApprovalTarget.complianceSnapshot}
                    />
                )}
            </AnimatePresence>

            {/* ── CONFIRMATION DIALOG ── */}
            <AnimatePresence>
                {actionConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                            className="relative max-w-md w-full rounded-[2.5rem] border border-border shadow-3xl overflow-hidden bg-card"
                        >
                            {/* Status stripe */}
                            <div className={cn(
                                "h-1.5",
                                actionConfirm.status === 'approved' ? "bg-emerald-500" : "bg-rose-500"
                            )} />

                            <div className="p-8">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={cn(
                                        "h-12 w-12 rounded-2xl flex items-center justify-center border",
                                        actionConfirm.status === 'approved'
                                            ? "bg-emerald-500/10 border-emerald-500/20"
                                            : "bg-rose-500/10 border-rose-500/20"
                                    )}>
                                        <Gavel className={cn(
                                            "h-6 w-6",
                                            actionConfirm.status === 'approved' ? "text-emerald-500" : "text-rose-500"
                                        )} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-foreground tracking-tight">
                                            Confirm {actionConfirm.status === 'approved' ? 'Approval' : 'Rejection'}
                                        </h3>
                                        <p className="text-[11px] font-mono text-muted-foreground font-black uppercase tracking-widest">
                                            {actionConfirm.ids.length} request{actionConfirm.ids.length > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                </div>

                                <p className="text-sm text-muted-foreground/80 mb-8 leading-relaxed font-medium">
                                    This action will {actionConfirm.status === 'approved' ? 'approve and execute' : 'reject'} the
                                    selected swap {actionConfirm.ids.length > 1 ? 'requests' : 'request'}. This cannot be undone.
                                </p>

                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setActionConfirm(null)}
                                        className="rounded-xl text-muted-foreground hover:bg-muted font-black uppercase tracking-widest text-[10px]"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleConfirmAction}
                                        className={cn(
                                            "rounded-xl text-primary-foreground text-[11px] font-black uppercase tracking-wider shadow-lg border-none h-11 px-6",
                                            actionConfirm.status === 'approved'
                                                ? "bg-primary hover:bg-primary/90 shadow-primary/20"
                                                : "bg-rose-600 hover:bg-rose-500 shadow-rose-500/20"
                                        )}

                                    >
                                        {actionConfirm.status === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ManagerSwapsPage;
