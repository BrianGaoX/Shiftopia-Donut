import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { Clock, MoreHorizontal, Gavel, ArrowLeftRight, Ban, X, Check, Flame, Edit, Megaphone, Hourglass, CheckCircle, XCircle, UserPlus, UserCheck, Users, MailOpen, BadgeCheck, Zap, Circle, Lock, Minus, Handshake, ShieldCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { determineShiftState, getShiftStateDebugString } from '../../domain/shift-state.utils';
import { Shift } from '../../api/shifts.api';
import { computeShiftUrgency } from '../../domain/bidding-urgency';
import { getProtectionContext, getShiftStatusIcons } from '../../domain/shift-ui';

/* ============================================================
   TYPES
   ============================================================ */
type GroupColor = 'blue' | 'green' | 'red' | 'orange' | 'purple' | string;

export type ShiftLifecycleStatus = 'draft' | 'published' | 'completed' | 'cancelled';
export type ShiftAssignmentStatus = 'assigned' | 'unassigned';
export type ShiftFulfillmentStatus = 'scheduled' | 'bidding' | 'offered' | 'none';

interface BaseShift {
  id: string;
  role: string;
  startTime: string;
  endTime: string;
  // New Orthogonal States
  lifecycleStatus: ShiftLifecycleStatus;
  assignmentStatus: ShiftAssignmentStatus;
  fulfillmentStatus?: ShiftFulfillmentStatus;
  assignmentOutcome?: 'pending' | 'offered' | 'confirmed' | 'emergency_assigned';

  eventTags?: Array<{ name: string; color: string }>;
  requiredSkills?: string[];
  subGroup?: string;
  groupColor?: GroupColor;
  employeeName?: string;
  isTradeRequested?: boolean;
  isCancelled?: boolean;
  isOnBidding?: boolean;
}

// Union type for flexibility
type ShiftType = BaseShift & {
  // Allow any extra properties
  [key: string]: any;
};

interface ShiftCardCompactProps {
  shift: ShiftType;
  variant?: 'group' | 'people' | 'roles';
  onClick?: (e: React.MouseEvent) => void;
  headerAction?: React.ReactNode;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onCheckboxChange?: () => void;
  isDragging?: boolean;
  isPast?: boolean;
  className?: string; // Allow custom classes
  // Interactive Handlers
  onBid?: (shiftId: string) => void;
  onSwap?: (shiftId: string) => void;
  onCancel?: (shiftId: string) => void;
  showStatusIcons?: boolean;
}

/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */

/**
 * Get header background color based on group color
 */
const getHeaderColor = (color: GroupColor = 'blue'): string => {
  const map: Record<string, string> = {
    blue: 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100',
    green: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100',
    red: 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100',
    orange: 'bg-orange-100 dark:bg-orange-900 text-orange-900 dark:text-orange-100',
    purple: 'bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-purple-100',
    default: 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
  };
  return map[color] || map.default;
};

const formatTime = (time: string) => {
  if (!time) return '';
  const timePart = time.includes('T') ? time.split('T')[1].substring(0, 5) : time;
  // Simple check for HH:MM:SS
  const parts = timePart.split(':');
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return timePart;
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const ShiftCardCompact: React.FC<ShiftCardCompactProps> = ({
  shift,
  onClick,
  headerAction,
  isSelected = false,
  isDragging = false,
  isPast = false,
  className,
  onBid,
  onSwap,
  onCancel,
  showStatusIcons,
}) => {
  const headerColor = getHeaderColor(shift.groupColor);
  const isDraft = shift.lifecycleStatus === 'draft';
  const isPublished = shift.lifecycleStatus === 'published' || shift.lifecycleStatus === 'completed';
  const isCancelled = shift.lifecycleStatus === 'cancelled' || shift.isCancelled;
  const isTrading = shift.isTradeRequested || !!(shift.rawShift as any)?.trade_requested_at || (shift.rawShift as any)?.trading_status === 'TradeRequested';

  const rawShift = shift.rawShift || shift;

  const stateId = useMemo(
    () => determineShiftState(rawShift as unknown as Shift),
    [
      rawShift.lifecycle_status,
      rawShift.is_cancelled,
      rawShift.assignment_status,
      rawShift.assignment_outcome,
      rawShift.bidding_status,
      (rawShift as any).trade_requested_at,
    ],
  );

  const urgency = computeShiftUrgency(
    rawShift.shift_date || shift.shiftDate || '',
    rawShift.start_time || shift.startTime || ''
  );
  
  const statusIcons = useMemo(() => 
    showStatusIcons ? getShiftStatusIcons(rawShift as any) : [], 
  [rawShift, showStatusIcons]);


  const protection = useMemo(() => getProtectionContext(
    { lifecycle_status: rawShift.lifecycle_status || shift.lifecycleStatus }, 
    !!isPast
  ), [rawShift.lifecycle_status, shift.lifecycleStatus, isPast]);

  return (
    <motion.div
      className={cn(
        'relative flex flex-col rounded-xl overflow-hidden border bg-card shadow-sm transition-all h-full group select-none',
        // Removed urgency rings to make room for left strip

        // Hover effect for interactivity
        onClick && 'cursor-pointer hover:shadow-lg',
        isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        isDragging && 'opacity-50',
        isPast && 'grayscale opacity-30 cursor-not-allowed',
        className
      )}
      onClick={isPast ? undefined : onClick}
    >
      {/* HEADER */}
      <div className={cn('px-4 py-2 flex justify-between items-center min-h-[40px]', headerColor)}>
        <span className="text-[11px] font-bold uppercase tracking-widest truncate flex-1 opacity-90">
          {shift.subGroup || 'Shift'}
        </span>
        {headerAction ? (
          <div onClick={(e) => e.stopPropagation()}>
            {headerAction}
          </div>
        ) : (
          <MoreHorizontal className="h-4 w-4 opacity-50" />
        )}

        {showStatusIcons && statusIcons.length > 0 && (
          <div className="flex items-center gap-1 ml-1.5 shrink-0">
            {statusIcons.map((si, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <si.icon className={cn("h-3 w-3", si.color)} />
                </TooltipTrigger>
                <TooltipContent className="text-[10px] py-1 px-2">{si.tooltip}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      {/* BODY */}
      <div className={cn("p-3 flex flex-col gap-2 flex-1", isPast && "grayscale opacity-30")}>

        {/* IDENTITY */}
        <div className="text-center space-y-1">
          <div className="text-lg font-bold text-foreground leading-none truncate">
            {shift.employeeName || 'Unassigned'}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium truncate">
            {shift.role}
          </div>
          {/* DEEP DEBUG: Removed */}
        </div>

        {/* TIME PILL */}
        <div className="flex justify-center">
          <div className="bg-muted border border-border rounded-lg px-4 py-2 flex items-center gap-3 shadow-inner">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-mono font-medium text-emerald-600 dark:text-emerald-400 tracking-wider">
              {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
            </span>
          </div>
        </div>

        {/* VISUAL STATE GRID - 3x2 */}
        <div className="bg-background rounded-lg border border-border p-2 mt-auto">
          <div className="grid grid-cols-3 gap-y-3 gap-x-1">

            {/* 1. ID */}
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-4 h-4 flex items-center justify-center font-mono font-bold text-[10px] text-muted-foreground border border-border rounded">#</div>
              <span className={cn("text-[9px] font-bold text-center text-blue-600 dark:text-blue-400")}>
                {stateId}
              </span>
            </div>



            {/* 3. ASSIGNMENT */}
            <div className="flex flex-col items-center gap-1">
              {(() => {
                const isAssigned = shift.employeeName || shift.assignedEmployeeId;
                if (isAssigned) return <UserCheck className="w-4 h-4 text-green-600" />;
                return <UserPlus className="w-4 h-4 text-amber-500" />;
              })()}
              <span className="text-[9px] font-bold text-muted-foreground capitalize truncate w-full text-center">
                {shift.employeeName || shift.assignedEmployeeId ? 'Assigned' : 'Unassigned'}
              </span>
            </div>

            {/* 4. OFFER (OUTCOME) */}
            <div className="flex flex-col items-center gap-1">
              {(() => {
                let o = shift.assignmentOutcome;
                // S2 Logic: Draft + Assigned = Pending
                if (stateId === 'S2' && !o) o = 'pending';

                if (!o) return <Circle className="w-4 h-4 text-gray-300" />;
                if (o === 'pending') return <Clock className="w-4 h-4 text-yellow-500" />;
                if (o === 'offered') return <MailOpen className="w-4 h-4 text-blue-500" />;
                if (o === 'confirmed') return <BadgeCheck className="w-4 h-4 text-green-600" />;
                if (o === 'emergency_assigned') return <Zap className="w-4 h-4 text-red-500" />;
                return <Circle className="w-4 h-4 text-gray-300" />;
              })()}
              <span className={cn("text-[9px] font-bold capitalize truncate w-full text-center", 'text-muted-foreground')}>
                {(() => {
                  if (stateId === 'S2' && !shift.assignmentOutcome) return 'Pending';
                  if (typeof shift.assignmentOutcome === 'string') {
                    const o = shift.assignmentOutcome.toLowerCase();
                    if (o === 'pending') return 'Pending';
                    if (o === 'offered') return 'Offered';
                    if (o === 'confirmed') return 'Confirmed';
                    if (o === 'emergency_assigned') return 'EmergencyAssigned';
                  }
                  return 'null';
                })()}
              </span>
            </div>

            {/* 5. BIDDING */}
            <div className="flex flex-col items-center gap-1">
              {(() => {
                const b = rawShift.bidding_status;
                const isActiveBidding = b === 'on_bidding' || b === 'on_bidding_normal' || b === 'on_bidding_urgent';
                if (!isActiveBidding && b !== 'bidding_closed_no_winner') return <Ban className="w-4 h-4 text-gray-400" />;
                if (b === 'bidding_closed_no_winner') return <Ban className="w-4 h-4 text-gray-600" />;
                const urg = computeShiftUrgency(rawShift.shift_date, rawShift.start_time);
                // An actively on-bidding shift (S5) is on bidding — emergent just
                // means the start is imminent/passed, not that bidding expired.
                // "Expired" is `bidding_closed_no_winner` only (handled above).
                if (urg === 'emergent') return <Flame className="w-4 h-4 text-rose-500 animate-[pulse_0.8s_ease-in-out_infinite]" />;
                if (urg === 'urgent')   return <Flame className="w-4 h-4 text-orange-500 animate-pulse" />;
                return <Gavel className="w-4 h-4 text-blue-500" />;
              })()}
              <span className={cn("text-[9px] font-bold truncate w-full text-center", (() => {
                const b = rawShift.bidding_status;
                const isActiveBidding = b === 'on_bidding' || b === 'on_bidding_normal' || b === 'on_bidding_urgent';
                if (isActiveBidding && stateId === 'S5' && computeShiftUrgency(rawShift.shift_date, rawShift.start_time) === 'emergent') return 'text-rose-500';
                return 'text-muted-foreground';
              })())}>
                {(() => {
                  const b = rawShift.bidding_status;
                  const isActiveBidding = b === 'on_bidding' || b === 'on_bidding_normal' || b === 'on_bidding_urgent';
                  if (!isActiveBidding && b !== 'bidding_closed_no_winner') return 'NotOnBidding';
                  if (b === 'bidding_closed_no_winner') return 'ClosedNoWinner';
                  const urg = computeShiftUrgency(rawShift.shift_date, rawShift.start_time);
                  if (urg === 'emergent') return 'Emergent';
                  if (urg === 'urgent')   return 'Urgent';
                  return 'Normal';
                })()}
              </span>
            </div>

            {/* 6. TRADE */}
            <div className="flex flex-col items-center gap-1">
              {(() => {
                if (isTrading) return <ArrowLeftRight className="w-4 h-4 text-purple-500" />;
                // TODO: TradeAccepted? shift.trading_status?
                return <Minus className="w-4 h-4 text-gray-400" />;
              })()}
              <span className="text-[9px] font-bold text-muted-foreground truncate w-full text-center">
                {isTrading ? 'TradeRequested' : 'NoTrade'}
              </span>
            </div>

          </div>
        </div>

      </div>
    </motion.div>
  );
};
