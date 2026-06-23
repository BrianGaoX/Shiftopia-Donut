// src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addDays, subDays } from 'date-fns';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { Drawer, DrawerContent } from '@/modules/core/ui/primitives/drawer';
import {
  Search, Flame, Clock, CheckCircle, Loader2, Inbox,
  Users, Zap, ShieldCheck, ShieldAlert, Shield,
  CircleCheck, CircleX, TriangleAlert, ChevronDown, ChevronRight, ChevronLeft,
  Sparkles, UserCheck as LucideUserCheck, History,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
  runHardValidation,
  ComplianceCheckInput,
  ShiftTimeRange,
} from '@/modules/compliance';
import { runV8Orchestrator } from '@/modules/compliance/v8';
import { buildBidInput } from '@/modules/planning/unified/compliance/input-builder';
import type { V8Hit, V8Result } from '@/modules/compliance/v8/types';
import type { V8OrchestratorInput } from '@/modules/compliance/v8/orchestrator/types';
import { fetchV8EmployeeContext } from '@/modules/compliance/employee-context';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import type { ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { calculateTimeRemaining, formatTimeRemaining } from './utils';
import type { BidToggle, ManagerBidShift, EmployeeBid, ToggleCounts } from './types';
import { useManagerBidShifts } from './useOpenShifts';
import { useShiftBids } from './useShiftBids';
import { useTimeTicker } from './useTimeTicker';
import { getAvailabilitySlots } from '@/modules/availability/api/availability.api';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { classifyBuckets, getBucketSummary } from '@/modules/compliance/ui/bucket-map';
import type { UseCompliancePanelReturn, PanelStatus, PanelResult } from '@/modules/compliance/ui/useCompliancePanel';

// =============================================================================
// GROUP COLOR SYSTEM — venue-inherited theming
// All class strings are written statically so Tailwind can scan them.
// =============================================================================

type GroupVariant = 'convention' | 'exhibition' | 'theatre' | 'default';

const GROUP_THEME: Record<GroupVariant, {
  bar: string;       // left stripe color
  tint: string;      // subtle card bg
  ring: string;      // focus ring
  text: string;      // accent text
  boost: string;     // Boost CTA bg + text
  badge: string;     // group badge
  dot: string;       // selection dot fill
}> = {
  convention: {
    bar:   'bg-blue-500',
    tint:  'bg-blue-500/[0.05]',
    ring:  'ring-blue-500/30',
    text:  'text-blue-600 dark:text-blue-400',
    boost: 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/25',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    dot:   'bg-blue-500',
  },
  exhibition: {
    bar:   'bg-emerald-500',
    tint:  'bg-emerald-500/[0.05]',
    ring:  'ring-emerald-500/30',
    text:  'text-emerald-600 dark:text-emerald-400',
    boost: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    dot:   'bg-emerald-500',
  },
  theatre: {
    bar:   'bg-rose-500',
    tint:  'bg-rose-500/[0.05]',
    ring:  'ring-rose-500/30',
    text:  'text-rose-600 dark:text-rose-400',
    boost: 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/25',
    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    dot:   'bg-rose-500',
  },
  default: {
    bar:   'bg-violet-500',
    tint:  'bg-violet-500/[0.05]',
    ring:  'ring-violet-500/30',
    text:  'text-violet-600 dark:text-violet-400',
    boost: 'bg-violet-500 hover:bg-violet-600 text-white shadow-violet-500/25',
    badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
    dot:   'bg-violet-500',
  },
};

function getGroupVariant(groupType?: string | null, dept?: string): GroupVariant {
  const d = (dept || '').toLowerCase();
  const g = (groupType || '').toLowerCase();
  if (g.includes('convention') || d.includes('convention')) return 'convention';
  if (g.includes('exhibition') || d.includes('exhibition')) return 'exhibition';
  if (g.includes('theatre') || g.includes('theater') || d.includes('theatre') || d.includes('theater')) return 'theatre';
  return 'default';
}

// =============================================================================
// HELPERS
// =============================================================================

function formatTimeLeft(deadline: string): { label: string; colorCls: string; isUrgent: boolean } {
  const tr = calculateTimeRemaining(deadline);
  if (tr.isExpired) return { label: 'EXPIRED', colorCls: 'text-rose-600 dark:text-rose-400', isUrgent: true };
  const totalHours = tr.hours;
  if (totalHours === 0) return { label: `${tr.minutes}m`, colorCls: 'text-rose-600 dark:text-rose-400', isUrgent: true };
  if (totalHours < 2) return { label: `${totalHours}h ${tr.minutes}m`, colorCls: 'text-rose-600 dark:text-rose-400', isUrgent: true };
  const days = Math.floor(totalHours / 24);
  const label = days > 0 ? `${days}d ${totalHours % 24}h` : `${totalHours}h ${tr.minutes}m`;
  return { label, colorCls: 'text-amber-600 dark:text-amber-400', isUrgent: false };
}

function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

// =============================================================================
// useBidsCompliancePanel — custom hook wrapping DB-fetch compliance for bids
// =============================================================================

function useBidsCompliancePanel(
  selectedBid: EmployeeBid | null,
  expandedShift: ReturnType<typeof useManagerBidShifts>['shifts'][number] | null,
  toastFn: ReturnType<typeof useToast>['toast'],
): UseCompliancePanelReturn {
  const [status, setStatus]   = useState<PanelStatus>('idle');
  const [result, setResult]   = useState<PanelResult | null>(null);
  const [error,  setError]    = useState<string | null>(null);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const runningRef = useRef(false);

  // Reset when selection changes
  useEffect(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
    setWarningsAcknowledged(false);
  }, [selectedBid?.id, expandedShift?.id]);

  const run = useCallback(async () => {
    if (!selectedBid || !expandedShift || runningRef.current) return;
    runningRef.current = true;
    setStatus('running');
    setError(null);
    setWarningsAcknowledged(false);

    try {
      const shiftDate = new Date(expandedShift.date);
      const LOOKBACK_DAYS  = 30;
      const LOOKAHEAD_DAYS = 14;
      const startDate = format(subDays(shiftDate, LOOKBACK_DAYS),  'yyyy-MM-dd');
      const endDate   = format(addDays(shiftDate, LOOKAHEAD_DAYS), 'yyyy-MM-dd');

      // Fetch existing shifts
      const { data: existingRaw } = await supabase
        .from('shifts')
        .select('id, start_time, end_time, shift_date, unpaid_break_minutes')
        .eq('assigned_employee_id', selectedBid.employeeId)
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)
        .is('deleted_at', null)
        .eq('is_cancelled', false);

      const existingShifts = (existingRaw || [])
        .filter((s: any) => s.id !== expandedShift.id)
        .map((s: any, idx: number) => ({
          id:                      s.id || `s-${idx}`,
          date:                    s.shift_date,
          start_time:              (s.start_time || '').replace(/:\d{2}$/, ''),
          end_time:                (s.end_time   || '').replace(/:\d{2}$/, ''),
          role_id:                 '',
          required_qualifications: [],
          is_ordinary_hours:       true,
          break_minutes:           s.unpaid_break_minutes || 0,
          unpaid_break_minutes:    s.unpaid_break_minutes || 0,
        }));

      // Fetch real employee context (contracted role_ids, qualifications, visa flag)
      const employeeCtx = await fetchV8EmployeeContext(selectedBid.employeeId);

      // Build v2 input
      const v2Input = buildBidInput({
        employeeId: selectedBid.employeeId,
        employeeContext: employeeCtx,
        existingShifts,
        candidateShift: {
          id:                      expandedShift.id,
          date:                    expandedShift.date,
          shift_date:              expandedShift.date,
          start_time:              expandedShift.startTime,
          end_time:                expandedShift.endTime,
          role_id:                 expandedShift.roleId || '',
          organization_id:         expandedShift.organizationId,
          department_id:           expandedShift.departmentId,
          sub_department_id:       expandedShift.subDepartmentId,
          required_qualifications: [],
          is_ordinary_hours:       true,
          break_minutes:           0,
          unpaid_break_minutes:    expandedShift.unpaidBreak || 0,
        },
        stage: 'DRAFT',
      });

      // Run v2 engine
      const v2Result = runV8Orchestrator(v2Input);
      const allHits: V8Hit[] = [...(v2Result.hits || [])];

      // Server-side qual/eligibility check → convert to V8Hit
      try {
        const _toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
        const _sMin = _toMin(expandedShift.startTime);
        const _eMin = _toMin(expandedShift.endTime);
        const _dur  = _eMin > _sMin ? _eMin - _sMin : _eMin + 1440 - _sMin;
        const _net  = Math.max(1, _dur - (expandedShift.unpaidBreak || 0));

        const bucketAResult = await validateCompliance({
          employeeId:       selectedBid.employeeId,
          shiftDate:        expandedShift.date,
          startTime:        expandedShift.startTime + ':00',
          endTime:          expandedShift.endTime   + ':00',
          netLengthMinutes: _net,
          shiftId:          expandedShift.id,
          excludeV8ShiftId:   expandedShift.id,
        });

        (bucketAResult.qualificationViolations ?? []).forEach((v: any) => {
          allHits.push({
            rule_id:         'V8_QUALIFICATIONS',
            rule_name:       'Qualifications',
            status:          'BLOCKING',
            summary:         v.message || 'Missing required qualification.',
            details:         'Employee must hold all required qualifications.',
            affected_shifts: [expandedShift.id],
            blocking:        true,
          });
        });

        (bucketAResult.violations || []).filter((v: string) =>
          v.toLowerCase().includes('contract') || v.toLowerCase().includes('role')
        ).forEach((v: string) => {
          allHits.push({
            rule_id:         'V8_QUALIFICATIONS',
            rule_name:       'Qualifications',
            status:          'BLOCKING',
            summary:         v,
            details:         'Ensure employee is contracted for the required role.',
            affected_shifts: [expandedShift.id],
            blocking:        true,
          } as V8Hit);
        });

        (bucketAResult.warnings || []).filter((w: string) =>
          w.toLowerCase().includes('availability') || w.toLowerCase().includes('locked')
        ).forEach((w: string) => {
          allHits.push({
            rule_id:         'V8_AVAILABILITY_CONFLICT',
            rule_name:       'Availability Conflict',
            status:          'WARNING',
            summary:         w,
            details:         '',
            affected_shifts: [expandedShift.id],
            blocking:        false,
          } as V8Hit);
        });
      } catch { /* server check optional */ }

      // Availability check: lightweight inline overlap test against the
      // employee's declared slots for the shift date. The deeper, V8-engine
      // version of this check has been removed; the server-side compliance
      // pass below covers the authoritative case.
      if (!allHits.some(h => h.rule_id === 'V8_AVAILABILITY_CONFLICT')) {
        try {
          const slots = await getAvailabilitySlots(selectedBid.employeeId, expandedShift.date, expandedShift.date);
          const toMins = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
          };
          const sStart = toMins(expandedShift.startTime);
          const sEnd = toMins(expandedShift.endTime);
          const adjustedEnd = sEnd <= sStart ? sEnd + 1440 : sEnd;
          const covered = (slots ?? []).some((slot: any) => {
            if (!slot?.start_time || !slot?.end_time) return false;
            const aStart = toMins(slot.start_time);
            const aEnd = toMins(slot.end_time);
            const adjustedSlotEnd = aEnd <= aStart ? aEnd + 1440 : aEnd;
            return aStart <= sStart && adjustedSlotEnd >= adjustedEnd;
          });
          if (!covered) {
            allHits.push({
              rule_id:         'V8_AVAILABILITY_CONFLICT',
              rule_name:       'Availability Conflict',
              status:          'WARNING',
              summary:         'Shift falls outside declared availability.',
              details:         '',
              affected_shifts: [expandedShift.id],
              blocking:        false,
            } as V8Hit);
          }
        } catch { /* availability check optional */ }
      }

      const buckets = classifyBuckets(allHits);
      const summary  = getBucketSummary(buckets);

      setResult({
        buckets,
        summary,
        evaluatedAt: new Date(),
        rawResult:   v2Result,
      });
      setStatus('results');
    } catch (e: unknown) {
      console.error('[useBidsCompliancePanel] Error during compliance check:', e);
      setError(e instanceof Error ? e.message : 'Compliance check failed');
      setStatus('error');
    } finally {
      runningRef.current = false;
    }
  }, [selectedBid, expandedShift, toastFn]);

  const canProceed =
    status === 'results' &&
    result !== null &&
    result.buckets.A.length   === 0 &&
    result.summary.systemFails === 0 &&
    (result.buckets.B.length  === 0 || warningsAcknowledged);

  return {
    status,
    result,
    error,
    warningsAcknowledged,
    canProceed,
    run,
    acknowledgeWarnings: setWarningsAcknowledged,
    markStale: () => setStatus(prev => prev === 'results' ? 'stale' : prev),
    reset: () => { setStatus('idle'); setResult(null); setError(null); setWarningsAcknowledged(false); },
  };
}

// =============================================================================
// BIDDER ROW — selection dot drives Compliance Engine
// =============================================================================

interface BidderRowProps {
  bid: EmployeeBid;
  index: number;
  isSelected: boolean;
  isWinner: boolean;
  groupVariant: GroupVariant;
  onSelect: () => void;
}

const BidderRow: React.FC<BidderRowProps> = ({ bid, index, isSelected, isWinner, groupVariant, onSelect }) => {
  const theme = GROUP_THEME[groupVariant];

  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04, ease: [0.23, 1, 0.32, 1] }}
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl transition-colors text-left group/bid relative overflow-hidden',
        isSelected
          ? `bg-white/[0.06] ring-1 ${theme.ring}`
          : 'hover:bg-white/[0.03]',
        isWinner && 'opacity-50 pointer-events-none',
      )}
    >
      {/* Selected left bar */}
      {isSelected && (
        <motion.div
          layoutId="bidder-bar"
          className={cn('absolute left-0 top-2 bottom-2 w-[3px] rounded-full', theme.bar)}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}

      {/* Avatar */}
      <Avatar className="h-7 w-7 shrink-0 border border-white/[0.08]">
        <AvatarFallback className={cn(
          'text-[9px] font-black tracking-tight',
          isWinner
            ? 'bg-emerald-500/20 text-emerald-400'
            : isSelected
            ? 'bg-primary/20 text-primary'
            : 'bg-white/[0.04] text-white/30',
        )}>
          {getInitials(bid.employeeName)}
        </AvatarFallback>
      </Avatar>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-[12px] font-semibold leading-none block truncate transition-colors',
          isSelected ? 'text-white' : 'text-white/55'
        )}>
          {bid.employeeName}
        </span>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">{bid.employmentType}</span>
          {bid.fatigueRisk === 'high' && (
            <span className="text-[8px] font-black text-rose-500/70 bg-rose-500/10 px-1 rounded leading-none py-0.5">FATIGUE</span>
          )}
        </div>
      </div>

      {/* Right badge */}
      {isWinner ? (
        <CheckCircle className="h-3.5 w-3.5 text-emerald-500/60 shrink-0" />
      ) : isSelected ? (
        <motion.div
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          className={cn('h-1.5 w-1.5 rounded-full', theme.dot)}
        />
      ) : null}
    </motion.button>
  );
};

// =============================================================================
// ROLE CARD — debit card design with venue-inherited theming
// =============================================================================

interface RoleCardProps {
  shift: ManagerBidShift;
  isSelected: boolean;
  onSelect: () => void;
}

const RoleCard: React.FC<RoleCardProps> = ({
  shift, isSelected, onSelect,
}) => {
  const groupVariant = getGroupVariant(shift.groupType, shift.department);
  const theme = GROUP_THEME[groupVariant];
  const isResolved = shift.toggle === 'resolved';

  useTimeTicker(1000);

  const netLength = (() => {
    const toMin = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = toMin(shift.endTime) - toMin(shift.startTime);
    if (gross < 0) gross += 1440;
    return Math.max(1, gross - shift.unpaidBreak);
  })();

  const h = Math.floor(netLength / 60);
  const m = Math.round(netLength % 60);
  const netStr = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;

  return (
    <motion.button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-4 py-1.5 rounded-full border transition-all text-left group relative overflow-hidden",
        isSelected
          ? "bg-primary/10 border-primary/40 ring-1 ring-primary/20 shadow-md"
          : "bg-white dark:bg-slate-900 border-border/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-border",
        isResolved && "opacity-60"
      )}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Selected highlight bar (pill style) */}
      {isSelected && (
        <motion.div
          layoutId="role-pill-bar"
          className={cn('absolute left-0 top-0 bottom-0 w-1', theme.bar)}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}

      <div className="flex items-center gap-3 min-w-0">
        {/* Date */}
        <div className="flex flex-col shrink-0 min-w-[32px]">
          <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground/60 leading-none">
            {shift.dayLabel.slice(0, 3)}
          </span>
          <span className="text-[11px] font-mono font-bold text-foreground leading-none mt-1">
            {format(new Date(shift.date), 'dd')}
          </span>
        </div>

        <div className="w-px h-4 bg-border/40 shrink-0" />

        {/* Time & Net */}
        <div className="flex flex-col shrink-0">
          <span className="text-[11px] font-mono font-bold text-foreground leading-none">
            {shift.startTime}–{shift.endTime}
          </span>
          <span className="text-[9px] font-medium text-muted-foreground/50 mt-1 leading-none">
            Net: {netStr}
          </span>
        </div>

        <div className="w-px h-4 bg-border/40 shrink-0" />

        {/* Role & Dept */}
        <div className="flex flex-col min-w-0">
          <span className="text-[12px] font-bold text-primary truncate leading-none">
            {shift.role}
          </span>
          <span className="text-[9px] text-muted-foreground/60 truncate leading-none mt-1">
            {shift.department}
          </span>
        </div>
      </div>

      {/* Right side: Bids & Status */}
      <div className="flex items-center gap-2 shrink-0">
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-black tabular-nums transition-all",
          isSelected 
            ? "bg-primary text-primary-foreground border-primary" 
            : "bg-muted/50 text-muted-foreground/60 border-transparent group-hover:border-border/50"
        )}>
          <Users className="h-2.5 w-2.5" />
          <span>{shift.bidCount}</span>
        </div>
        
        {isResolved && (
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
        )}
      </div>
    </motion.button>
  );
};

// ===================================
// PANE HELPERS
// ===================================

const PaneHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode; count?: number; accentClass?: string }> = ({ title, subtitle, icon, count, accentClass }) => (
  <div className="shrink-0 px-5 pt-5 pb-4 border-b border-white/[0.05] flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      {icon && (
        <div className={cn('shrink-0', accentClass ?? 'text-white/20')}>
          {icon}
        </div>
      )}
      <div>
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 block leading-none">{title}</span>
        {subtitle && <span className="text-[9px] text-white/20 mt-1.5 block leading-none font-mono truncate max-w-[160px]">{subtitle}</span>}
      </div>
    </div>
    {count !== undefined && (
      <span className="text-[11px] font-bold tabular-nums text-white/25">
        {count}
      </span>
    )}
  </div>
);

// Toggle Chip Helper

interface ToggleChipProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  activeClass: string;
}

const ToggleChip: React.FC<ToggleChipProps> = ({ active, onClick, icon, label, count, activeClass }) => (
  <button
    onClick={onClick}
    className={cn(
      'relative px-3.5 py-1.5 rounded-xl text-[11px] font-semibold uppercase tracking-wider transition-colors duration-150 flex items-center gap-2 border',
      active
        ? activeClass
        : 'text-white/25 border-transparent hover:text-white/50 hover:bg-white/[0.03]',
    )}
  >
    {icon}
    {label}
    <span className={cn(
      'text-[10px] font-bold tabular-nums min-w-[18px] text-center',
      active ? 'opacity-80' : 'text-white/20',
    )}>
      {count}
    </span>
  </button>
);

// =============================================================================
// MAIN VIEW
// =============================================================================

interface OpenBidsViewProps {
  organizationId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
  externalSearchQuery?: string;
  viewMode?: 'card' | 'table';
  /**
   * Controlled filter state. When provided, parent owns the toggle and the
   * view's internal toolbar is hidden — parent must render the filter UI
   * (e.g. inside GoldStandardHeader).
   */
  activeToggle?: BidToggle;
  onToggleChange?: (toggle: BidToggle) => void;
  /** Reports filtered counts up so parent can render badges. */
  onCountsChange?: (counts: ToggleCounts) => void;
  /** Hands a ready-to-call auto-assign function back to the parent. */
  onAutoAssignReady?: (fn: { run: () => void; isRunning: boolean }) => void;
  startDate?: Date;
  endDate?: Date;
}

export const OpenBidsView: React.FC<OpenBidsViewProps> = ({
  organizationId,
  departmentId,
  subDepartmentId,
  externalSearchQuery,
  viewMode,
  activeToggle: controlledToggle,
  onToggleChange,
  onCountsChange,
  onAutoAssignReady,
  startDate,
  endDate,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Updates countdown timers every 10 seconds
  useTimeTicker(10000);

  // Parent-controlled when `controlledToggle` is provided; otherwise local.
  const isControlled = controlledToggle !== undefined;
  const isToolbarHidden = isControlled || externalSearchQuery !== undefined;

  // ── State ──────────────────────────────────────────────────────────────────
  const [internalToggle, setInternalToggle] = useState<BidToggle>('urgent');
  const activeToggle = isControlled ? controlledToggle! : internalToggle;
  const setActiveToggle = (next: BidToggle) => {
    if (isControlled) onToggleChange?.(next);
    else setInternalToggle(next);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedV8ShiftId, setExpandedV8ShiftId] = useState<string | null>(null);
  const [selectedBid, setSelectedBid] = useState<EmployeeBid | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);

  // ── Mobile State ───────────────────────────────────────────────────────────
  const [mobileStep, setMobileStep] = useState<'roles' | 'bidders'>('roles');
  const [drawerBidId, setDrawerBidId] = useState<string | null>(null);

  // ── Data ───────────────────────────────────────────────────────────────────
  const { shifts, isLoading } = useManagerBidShifts({
    organizationId: organizationId ?? undefined,
    departmentId: departmentId ?? undefined,
    subDepartmentId: subDepartmentId ?? undefined,
    startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
    endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
  });

  const { bids, isLoading: isLoadingBids } = useShiftBids(expandedV8ShiftId);

  // ── Derived ────────────────────────────────────────────────────────────────
  const expandedShift = useMemo(
    () => shifts.find(s => s.id === expandedV8ShiftId) ?? null,
    [shifts, expandedV8ShiftId],
  );

  const counts: ToggleCounts = useMemo(() => ({
    urgent:   shifts.filter(s => s.toggle === 'urgent').length,
    normal:   shifts.filter(s => s.toggle === 'normal').length,
    resolved: shifts.filter(s => s.toggle === 'resolved').length,
  }), [shifts]);

  // Report counts up to controlling parent (GoldStandardHeader filter chips).
  useEffect(() => {
    onCountsChange?.(counts);
  }, [counts, onCountsChange]);

  const activeSearchQuery = externalSearchQuery !== undefined ? externalSearchQuery : searchQuery;

  const filteredShifts = useMemo(() => {
    let result = shifts.filter(s => s.toggle === activeToggle);
    if (activeSearchQuery) {
      const q = activeSearchQuery.toLowerCase();
      result = result.filter(s =>
        s.role.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.subDepartment.toLowerCase().includes(q),
      );
    }
    return result;
  }, [shifts, activeToggle, searchQuery]);

  // If the expanded shift is no longer visible under the active toggle/search
  // (toggle switched, search narrowed, or it moved to "Resolved" after being
  // assigned), clear the expansion + candidate selection so the Bidders /
  // Intelligence panes don't keep showing a stale shift's bidders.
  useEffect(() => {
    if (expandedV8ShiftId && !filteredShifts.some(s => s.id === expandedV8ShiftId)) {
      setExpandedV8ShiftId(null);
      setSelectedBid(null);
      setDrawerBidId(null);
    }
  }, [filteredShifts, expandedV8ShiftId]);

  // ── Compliance Panel ───────────────────────────────────────────────────────
  const bidsPanel = useBidsCompliancePanel(selectedBid, expandedShift, toast);

  // Derived from bidsPanel.result for Intelligence pane
  const blockingIssues = bidsPanel.result?.buckets.A ?? [];
  const warningIssues  = bidsPanel.result?.buckets.B ?? [];
  // Hard blocks = compliance blockers (bucket A) or failing system/qual checks
  // (bucket D). Warnings (bucket B) are NOT hard blocks — they are overridable
  // via the amber "Override & Assign" button (clicking it IS the acknowledgment).
  // Mirrors the canonical gate in CompliancePanel.tsx.
  const systemFails    = bidsPanel.result?.summary.systemFails ?? 0;
  const hardBlocked    = blockingIssues.length > 0 || systemFails > 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleExpand = useCallback((shiftId: string) => {
    setExpandedV8ShiftId(prev => {
      const next = prev === shiftId ? null : shiftId;
      if (next !== prev) {
        setSelectedBid(null);
      }
      return next;
    });
    // On mobile, transition to the bidders step when a role is tapped
    setMobileStep('bidders');
  }, []);

  const handleSelectBid = useCallback((bid: EmployeeBid, openDrawer = false) => {
    setSelectedBid(prev => prev?.id === bid.id ? null : bid);
    if (openDrawer) {
      setDrawerBidId(bid.id);
    }
  }, []);

  const handleAssign = useCallback(async () => {
    if (!selectedBid || !expandedV8ShiftId || isAssigning) return;
    // Only hard blocks prevent assignment — compliance blockers (bucket A) or
    // failing system/qual checks (bucket D). Warnings are overridable, so the
    // amber "Override & Assign" button must proceed without a separate ack step.
    const result = bidsPanel.result;
    if (!result || result.buckets.A.length > 0 || (result.summary.systemFails ?? 0) > 0) return;

    setIsAssigning(true);
    try {
      const { error } = await (supabase as any).rpc('sm_select_bid_winner', {
        p_shift_id:  expandedV8ShiftId,
        p_winner_id: selectedBid.employeeId,
        p_user_id:   (await supabase.auth.getUser()).data.user?.id,
      });
      if (error) throw error;

      toast({ title: 'Shift Assigned', description: `Assigned to ${selectedBid.employeeName}.` });
      queryClient.invalidateQueries({ queryKey: shiftKeys.managerBidShiftsRoot });
      queryClient.invalidateQueries({ queryKey: shiftKeys.bids(expandedV8ShiftId) });
      setSelectedBid(null);
      bidsPanel.reset();
    } catch (err: any) {
      toast({ title: 'Assignment Failed', description: err.message || 'Failed to assign.', variant: 'destructive' });
    } finally {
      setIsAssigning(false);
    }
  }, [selectedBid, expandedV8ShiftId, bidsPanel, isAssigning, toast, queryClient, organizationId]);


  const handleAutoAssign = useCallback(async () => {
    // All unfilled open shifts (urgent + normal) with at least one bid.
    // Sort chronologically so streak/window rules see assignments accumulate in
    // order — processing out-of-order lets MAX_CONSECUTIVE_DAYS be fooled by
    // short isolated fragments that never individually breach the 20-day limit.
    const urgentShifts = shifts
      .filter(s => s.toggle !== 'resolved' && s.bidCount > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (urgentShifts.length === 0) {
      toast({ title: 'No Eligible Shifts', description: 'No open shifts with active bids.' });
      return;
    }

    setIsAutoAssigning(true);
    let assigned = 0, skipped = 0, failed = 0;
    // Per-reason breakdown for shifts the hardened RPC rejected (returns a row,
    // not a thrown error): SHIFT_TIME_LOCKED / WINNER_NOT_PENDING / ILLEGAL_STATE /
    // SHIFT_GONE / … . These are skipped-with-reason, NOT generic failures.
    const rpcRejections = new Map<string, number>();
    const userId = (await supabase.auth.getUser()).data.user?.id;

    // Cache student-visa enforcement flag per employee to avoid redundant DB calls.
    // Keyed by employee_id → has_restricted_work_limit from employee_licenses.
    const visaFlagCache = new Map<string, boolean>();
    const getVisaFlag = async (employeeId: string): Promise<boolean> => {
      if (visaFlagCache.has(employeeId)) return visaFlagCache.get(employeeId)!;
      // S3 fix: an employee can hold MORE than one 'WorkRights' license row, so
      // `.maybeSingle()` would THROW (PGRST116) and abort this bidder entirely.
      // Fetch all matching rows and reduce with OR — restricted if ANY says so.
      const { data } = await supabase
        .from('employee_licenses')
        .select('has_restricted_work_limit')
        .eq('employee_id', employeeId)
        .eq('license_type', 'WorkRights');
      const flag = (data ?? []).some(r => r.has_restricted_work_limit === true);
      visaFlagCache.set(employeeId, flag);
      return flag;
    };

    // R4/R5 fix: the candidate shift's required qualifications + role live on the
    // `shifts` table (required_skills / required_licenses are skills.id / licenses.id
    // UUIDs — the SAME namespace as employee_skills.skill_id / employee_licenses.license_id,
    // i.e. the qualification_ids fetchV8EmployeeContext hydrates). They are NOT on the
    // client ManagerBidShift object, so fetch them once per shift and cache (no N calls).
    // required_qualifications = union(required_licenses, required_skills) so the V8
    // qualifications rule fires for unqualified bidders instead of being silently disabled.
    const shiftQualCache = new Map<string, { roleId: string; requiredQualifications: string[] }>();
    const getShiftQuals = async (shiftId: string, fallbackRoleId: string) => {
      if (shiftQualCache.has(shiftId)) return shiftQualCache.get(shiftId)!;
      const { data } = await supabase
        .from('shifts')
        .select('role_id, required_skills, required_licenses')
        .eq('id', shiftId)
        .maybeSingle();
      const entry = {
        roleId: (data?.role_id as string | null) ?? fallbackRoleId,
        requiredQualifications: [
          ...((data?.required_licenses as string[] | null) ?? []),
          ...((data?.required_skills   as string[] | null) ?? []),
        ].filter(Boolean),
      };
      shiftQualCache.set(shiftId, entry);
      return entry;
    };

    for (const shift of urgentShifts) {
      try {
        // Fetch ALL pending bids in FIFO order; try each until one passes compliance
        const { data: allBids } = await supabase
          .from('shift_bids')
          .select('id, employee_id')
          .eq('shift_id', shift.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });

        if (!allBids || allBids.length === 0) { skipped++; continue; }

        // F3 — Preference equity: the loop below awards the shift to the FIRST
        // compliance-clear bidder, so order bidders the fairness ledger says are
        // "owed" (highest denied-preference debt) ahead of the rest. Stable sort
        // preserves FIFO within equal debt. Falls back to plain FIFO when there
        // is no org scope or no ledger data.
        let orderedBids = allBids;
        if (organizationId && allBids.length > 1) {
          try {
            const debts = await fairnessLedgerService.getEmployeeDebts(
              organizationId,
              allBids.map(b => b.employee_id),
            );
            const owed = new Map<string, number>();
            for (const d of debts) {
              if (d.metric === 'denied_preferences') owed.set(d.employeeId, d.debt);
            }
            if (owed.size > 0) {
              orderedBids = [...allBids].sort(
                (a, b) => (owed.get(b.employee_id) ?? 0) - (owed.get(a.employee_id) ?? 0),
              );
            }
          } catch (err) {
            console.warn('[Bidding] F3 preference-equity ordering skipped:', err);
          }
        }

        // D-30: covers D-27 lookback for WORKING_DAYS_CAP / AVG_FOUR_WEEK_CYCLE,
        // plus one extra day for cross-midnight shifts (MIN_REST_GAP / NO_OVERLAP).
        // D+14: catches next-shift rest-gap.
        const shiftDate = new Date(shift.date);
        const AA_LOOKBACK  = 30;
        const AA_LOOKAHEAD = 14;
        const startDate = format(subDays(shiftDate, AA_LOOKBACK),  'yyyy-MM-dd');
        const endDate   = format(addDays(shiftDate, AA_LOOKAHEAD), 'yyyy-MM-dd');

        let winnerBid: { id: string; employee_id: string } | null = null;

        // R4/R5: resolve the candidate shift's real role + required qualifications
        // ONCE per shift (identical for every bidder) so the V8 qualifications/role
        // rules enforce instead of being disabled by a hardcoded [] / ''.
        const candidateQuals = await getShiftQuals(shift.id, shift.roleId || '');

        for (const bid of orderedBids) {
          const { data: existingRaw } = await supabase
            .from('shifts')
            .select('id, start_time, end_time, shift_date, unpaid_break_minutes, role_id, required_skills, required_licenses')
            .eq('assigned_employee_id', bid.employee_id)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)
            .is('deleted_at', null)
            .eq('is_cancelled', false);

          // R5 fix: keep each existing shift's real role_id + required_qualifications
          // so cross-shift role/qual rules can fire (was '' / [] before). Carried on the
          // ShiftTimeRange via extra fields the V8 mapper below reads.
          const existingRows = (existingRaw || []).filter((s: any) => s.id !== shift.id);
          const existingShifts: ShiftTimeRange[] = existingRows.map((s: any) => ({
            shift_date:           s.shift_date,
            start_time:           s.start_time,
            end_time:             s.end_time,
            unpaid_break_minutes: s.unpaid_break_minutes || 0,
            // non-ShiftTimeRange extras consumed only by the V8 existing-shift mapper:
            id:                   s.id,
            role_id:              s.role_id || '',
            required_qualifications: [
              ...((s.required_licenses as string[] | null) ?? []),
              ...((s.required_skills   as string[] | null) ?? []),
            ].filter(Boolean),
          })) as ShiftTimeRange[];

          // Fetch the student-visa enforcement flag for this bidder.
          // This makes STUDENT_VISA_48H blocking (not just a warning) when the
          // employee has has_restricted_work_limit = true on their WorkRights license.
          const studentVisaEnforcement = await getVisaFlag(bid.employee_id);

          const input: ComplianceCheckInput = {
            employee_id:              bid.employee_id,
            action_type:              'bid',
            shifts_window_days:       AA_LOOKBACK + AA_LOOKAHEAD, // enables MAX_CONSECUTIVE_DAYS F11 guard
            student_visa_enforcement: studentVisaEnforcement,
            candidate_shift: {
              shift_date:           shift.date,
              start_time:           shift.startTime + ':00',
              end_time:             shift.endTime   + ':00',
              unpaid_break_minutes: shift.unpaidBreak || 0,
            },
            existing_shifts: existingShifts,
          };

          const hv = runHardValidation({
            shift_date:      input.candidate_shift.shift_date,
            start_time:      input.candidate_shift.start_time,
            end_time:        input.candidate_shift.end_time,
            employee_id:     input.employee_id,
            existing_shifts: input.existing_shifts,
            current_time:    new Date(),
            is_template:     false,
          });

          let hasBlocker = !hv.passed;
          if (!hasBlocker) {
            const autoEmployeeCtx = await fetchV8EmployeeContext(input.employee_id);
            const v2AutoInput = buildBidInput({
              employeeId: input.employee_id,
              employeeContext: autoEmployeeCtx,
              existingShifts: existingShifts.map((s, idx) => ({
                id:                      (s as any).id || `s-${idx}`,
                date:                    s.shift_date,
                shift_date:              s.shift_date,
                start_time:              (s.start_time || '').replace(/:\d{2}$/, ''),
                end_time:                (s.end_time   || '').replace(/:\d{2}$/, ''),
                role_id:                 (s as any).role_id || '',
                required_qualifications: (s as any).required_qualifications || [],
                is_ordinary_hours:       true,
                break_minutes:           s.unpaid_break_minutes || 0,
                unpaid_break_minutes:    s.unpaid_break_minutes || 0,
              })),
              candidateShift: {
                id:                      shift.id,
                date:                    shift.date,
                shift_date:              shift.date,
                start_time:              shift.startTime,
                end_time:                shift.endTime,
                role_id:                 candidateQuals.roleId,
                organization_id:         shift.organizationId,
                department_id:           shift.departmentId,
                sub_department_id:       shift.subDepartmentId,
                required_qualifications: candidateQuals.requiredQualifications,
                is_ordinary_hours:       true,
                break_minutes:           0,
                unpaid_break_minutes:    shift.unpaidBreak || 0,
              },
              stage: 'DRAFT',
            });
            const v2AutoResult = runV8Orchestrator(v2AutoInput);
            hasBlocker = v2AutoResult.hits.some(h => h.blocking);
          }

          if (!hasBlocker) {
            winnerBid = bid;
            break; // first compliance-clear bidder wins
          }
        }

        if (!winnerBid) { skipped++; continue; }

        // Assign the compliance-clear winner.
        // The hardened sm_select_bid_winner now returns a jsonb ROW
        // ({ success, error }) on a guarded rejection (FOUND / FSM / winner-pending /
        // TTS) — supabase.rpc surfaces that as `data`, NOT as `error`. Only a true
        // transport/DB exception lands in `error`. Inspect both.
        const { data: rpcData, error } = await (supabase as any).rpc('sm_select_bid_winner', {
          p_shift_id:  shift.id,
          p_winner_id: winnerBid.employee_id,
          p_user_id:   userId,
        });

        if (error) {
          // Transport / unexpected DB exception → genuine failure.
          failed++;
        } else if (rpcData && rpcData.success === false) {
          // Guarded rejection — skipped-with-reason, not a failure.
          const reason = (rpcData.error as string) || 'REJECTED';
          rpcRejections.set(reason, (rpcRejections.get(reason) ?? 0) + 1);
          skipped++;
        } else {
          assigned++;
        }
      } catch {
        failed++;
      }
    }

    setIsAutoAssigning(false);
    queryClient.invalidateQueries({ queryKey: shiftKeys.managerBidShiftsRoot });
    // Human-readable breakdown of guarded RPC rejections, appended to the toast.
    const REJECTION_LABELS: Record<string, string> = {
      SHIFT_TIME_LOCKED:  'time-locked',
      WINNER_NOT_PENDING: 'bid no longer pending',
      ILLEGAL_STATE:      'not open for selection',
      SHIFT_GONE:         'shift removed',
    };
    const rejectionBreakdown = [...rpcRejections.entries()]
      .map(([reason, n]) => `${n} ${REJECTION_LABELS[reason] ?? reason.toLowerCase()}`)
      .join(', ');
    toast({
      title:       'Auto-Assign Complete',
      description:
        `${assigned} assigned · ${skipped} skipped · ${failed} failed` +
        (rejectionBreakdown ? ` (${rejectionBreakdown})` : ''),
    });
  }, [shifts, toast, queryClient, organizationId]);

  // Expose auto-assign to controlling parent (so the button lives in
  // GoldStandardHeader, not duplicated inside the view).
  useEffect(() => {
    onAutoAssignReady?.({ run: handleAutoAssign, isRunning: isAutoAssigning });
  }, [handleAutoAssign, isAutoAssigning, onAutoAssignReady]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-[calc(100vh-64px)] bg-background select-none text-foreground overflow-hidden">

      {/* Internal toolbar removed — parent (GoldStandardHeader) owns title,
          scope filter, search, view toggle, status chips, and auto-assign.
          See onCountsChange / onAutoAssignReady props. */}
      {!isToolbarHidden && (
        isMobile ? (
          <div className="shrink-0 border-b border-border/60 flex flex-col gap-2 px-4 py-3 bg-card/40 backdrop-blur-xl">
            <div className="relative group/search">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within/search:text-primary transition-colors" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search roles…"
                className="w-full h-10 bg-muted/30 border-border/50 pl-9 text-[13px] placeholder:text-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-primary/30 rounded-xl"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto flex-nowrap pb-0.5 -mx-1 px-1">
              <ToggleChip active={activeToggle === 'urgent'} onClick={() => setActiveToggle('urgent')} icon={<Flame className="h-3 w-3" />} label="Urgent" count={counts.urgent} activeClass="bg-rose-500/10 text-rose-400 border-rose-500/20" />
              <ToggleChip active={activeToggle === 'normal'} onClick={() => setActiveToggle('normal')} icon={<Clock className="h-3 w-3" />} label="Normal" count={counts.normal} activeClass="bg-amber-500/10 text-amber-400 border-amber-500/20" />
              <ToggleChip active={activeToggle === 'resolved'} onClick={() => setActiveToggle('resolved')} icon={<CheckCircle className="h-3 w-3" />} label="Resolved" count={counts.resolved} activeClass="bg-emerald-500/10 text-emerald-400 border-emerald-500/20" />
            </div>
          </div>
        ) : (
          <div className="shrink-0 h-14 border-b border-border/60 flex items-center px-6 gap-4 bg-card/40 backdrop-blur-xl">
            <div className="relative group/search">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within/search:text-primary transition-colors" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search roles…"
                className="w-60 h-9 bg-muted/30 border-border/50 pl-9 text-[13px] placeholder:text-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-primary/30 rounded-xl"
              />
            </div>

            <Separator orientation="vertical" className="h-5 bg-border/40" />

            <div className="flex items-center gap-1 p-0.5 bg-muted/20 rounded-xl border border-border/40">
              <ToggleChip active={activeToggle === 'urgent'} onClick={() => setActiveToggle('urgent')} icon={<Flame className="h-3 w-3" />} label="Urgent" count={counts.urgent} activeClass="bg-rose-500/10 text-rose-400 border-rose-500/20" />
              <ToggleChip active={activeToggle === 'normal'} onClick={() => setActiveToggle('normal')} icon={<Clock className="h-3 w-3" />} label="Normal" count={counts.normal} activeClass="bg-amber-500/10 text-amber-400 border-amber-500/20" />
              <ToggleChip active={activeToggle === 'resolved'} onClick={() => setActiveToggle('resolved')} icon={<CheckCircle className="h-3 w-3" />} label="Resolved" count={counts.resolved} activeClass="bg-emerald-500/10 text-emerald-400 border-emerald-500/20" />
            </div>

            <div className="flex-1" />

            <Button
              onClick={handleAutoAssign}
              disabled={isAutoAssigning}
              size="sm"
              className="h-9 px-5 text-[11px] font-semibold uppercase tracking-wider rounded-xl shadow-lg shadow-primary/15"
            >
              <AnimatePresence mode="wait" initial={false}>
                {isAutoAssigning ? (
                  <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Assigning…
                  </motion.span>
                ) : (
                  <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5" /> Auto-Assign Safe Bids
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>
        )
      )}

      {/* ─── MOBILE LAYOUT ────────────────────────────────────────────── */}
      {isMobile ? (
        <div className="flex-1 flex flex-col overflow-hidden relative">

          <AnimatePresence mode="wait" initial={false}>

            {/* ── Mobile Step 1: Roles List ── */}
            {mobileStep === 'roles' && (
              <motion.div
                key="mobile-roles"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2">
                    <AnimatePresence mode="wait">
                      {isLoading ? (
                        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/30">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="text-[10px] uppercase tracking-widest font-semibold">Loading…</span>
                        </motion.div>
                      ) : filteredShifts.length === 0 ? (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                          <Inbox className="h-6 w-6" />
                          <p className="text-[10px] uppercase tracking-widest font-semibold">No roles</p>
                        </motion.div>
                      ) : (
                        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                          {filteredShifts.map((s) => (
                            <RoleCard
                              key={s.id}
                              shift={s}
                              isSelected={expandedV8ShiftId === s.id}
                              onSelect={() => handleExpand(s.id)}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </ScrollArea>
              </motion.div>
            )}

            {/* ── Mobile Step 2: Bidders List ── */}
            {mobileStep === 'bidders' && (
              <motion.div
                key="mobile-bidders"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                {/* Back button */}
                <button
                  onClick={() => {
                    setMobileStep('roles');
                    setExpandedV8ShiftId(null);
                    setSelectedBid(null);
                  }}
                  className="shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-black border-b border-border/40 bg-card/20 text-foreground/70 hover:text-foreground transition-colors min-h-[44px]"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {expandedShift?.role ?? 'Roles'}
                </button>

                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-1">
                    <AnimatePresence mode="wait">
                      {isLoadingBids ? (
                        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex justify-center text-muted-foreground/20">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </motion.div>
                      ) : bids.length === 0 ? (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                          <Users className="h-5 w-5" />
                          <p className="text-[10px] uppercase tracking-widest font-semibold">No bids yet</p>
                        </motion.div>
                      ) : (
                        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                          {bids.map((bid, i) => (
                            <BidderRow
                              key={bid.id}
                              bid={bid}
                              index={i}
                              isSelected={selectedBid?.id === bid.id}
                              isWinner={expandedShift ? (expandedShift.assignedEmployeeId === bid.employeeId || (!expandedShift.assignedEmployeeId && bid.isWinner)) : false}
                              groupVariant={getGroupVariant(expandedShift?.groupType, expandedShift?.department)}
                              onSelect={() => {
                                handleSelectBid(bid, true);
                              }}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>


                  </div>
                </ScrollArea>
              </motion.div>
            )}

          </AnimatePresence>



          {/* ── Bid Detail Drawer ── */}
          <Drawer
            open={!!drawerBidId}
            onOpenChange={(open) => {
              if (!open) {
                setDrawerBidId(null);
              }
            }}
          >
            <DrawerContent className="h-[85dvh] flex flex-col">
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Drawer header */}
                <div className="shrink-0 px-5 pt-2 pb-4 border-b border-border/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50">Bid Review</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5 truncate">
                        {selectedBid?.employeeName ?? '—'}
                      </p>
                    </div>
                    {selectedBid && (
                      <div className="text-right text-[9px] font-mono text-muted-foreground/40">
                        <div>{expandedShift?.role}</div>
                        <div>{expandedShift ? `${expandedShift.startTime} – ${expandedShift.endTime}` : ''}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Compliance panel */}
                <ScrollArea className="flex-1">
                  <div className="p-4">
                    {selectedBid && (
                      <>
                        {/* Intelligence cards inline */}
                        {(bidsPanel.status === 'results' || bidsPanel.status === 'stale') && (
                          <div className="mb-4 space-y-2">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/40">
                              {(blockingIssues.length + warningIssues.length) > 0
                                ? `${blockingIssues.length} blocker${blockingIssues.length !== 1 ? 's' : ''} · ${warningIssues.length} warning${warningIssues.length !== 1 ? 's' : ''}`
                                : 'All checks passed'}
                            </p>
                            {blockingIssues.map((hit, i) => (
                              <div key={`b-${i}`} className="rounded-2xl border overflow-hidden border-rose-500/20 bg-rose-500/[0.04]">
                                <div className="px-3.5 py-2 border-b border-white/[0.04] flex items-center gap-2">
                                  <CircleX className="h-3 w-3 text-rose-400 shrink-0" />
                                  <span className="text-[10px] font-semibold text-rose-400">{hit.rule_id.replace(/_/g, ' ')}</span>
                                </div>
                                <div className="px-3.5 py-2.5">
                                  <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{hit.summary}</p>
                                  {hit.details && <p className="text-[9px] text-foreground/50 leading-relaxed mt-1.5 border-t border-white/[0.04] pt-1.5">{hit.details}</p>}
                                </div>
                              </div>
                            ))}
                            {warningIssues.map((hit, i) => (
                              <div key={`w-${i}`} className="rounded-2xl border overflow-hidden border-amber-500/20 bg-amber-500/[0.04]">
                                <div className="px-3.5 py-2 border-b border-white/[0.04] flex items-center gap-2">
                                  <TriangleAlert className="h-3 w-3 text-amber-400 shrink-0" />
                                  <span className="text-[10px] font-semibold text-amber-400">{hit.rule_id.replace(/_/g, ' ')}</span>
                                </div>
                                <div className="px-3.5 py-2.5">
                                  <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{hit.summary}</p>
                                  {hit.details && <p className="text-[9px] text-foreground/50 leading-relaxed mt-1.5 border-t border-white/[0.04] pt-1.5">{hit.details}</p>}
                                </div>
                              </div>
                            ))}
                            {blockingIssues.length === 0 && warningIssues.length === 0 && (
                              <div className="py-8 flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04]">
                                <ShieldCheck className="h-6 w-6 text-emerald-400/50" />
                                <div className="text-center">
                                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/70">All Clear</p>
                                  <p className="text-[9px] text-muted-foreground/30 mt-1 font-mono">{bidsPanel.result?.summary.passed ?? 0} checks passed</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                      </>
                    )}
                  </div>
                </ScrollArea>

                {/* Action footer */}
                <div className="shrink-0 p-4 border-t border-border/40 space-y-2 bg-card/30 backdrop-blur-sm">
                  {bidsPanel.status === 'idle' || bidsPanel.status === 'error' ? (
                    <Button
                      onClick={bidsPanel.run}
                      disabled={!selectedBid}
                      className="w-full min-h-[44px] text-[11px] font-semibold uppercase tracking-wider rounded-xl shadow-md shadow-primary/10"
                    >
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      Run Compliance
                    </Button>
                  ) : bidsPanel.status === 'running' ? (
                    <Button disabled className="w-full min-h-[44px] rounded-xl text-[11px] font-semibold uppercase tracking-wider">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analyzing…
                    </Button>
                  ) : (
                    <motion.div whileTap={{ scale: hardBlocked ? 1 : 0.98 }}>
                      <Button
                        onClick={handleAssign}
                        disabled={isAssigning || hardBlocked}
                        className={cn(
                          'w-full min-h-[44px] rounded-xl text-[11px] font-semibold uppercase tracking-wider shadow-lg',
                          hardBlocked
                            ? 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed shadow-none border border-border/40'
                            : warningIssues.length > 0
                            ? 'bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-amber-500/20'
                            : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-emerald-500/20',
                        )}
                      >
                        {isAssigning
                          ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          : <LucideUserCheck className="h-4 w-4 mr-2" />}
                        {hardBlocked
                          ? 'Blocked by Compliance'
                          : warningIssues.length > 0
                          ? 'Override & Assign'
                          : 'Assign Role'}
                      </Button>
                    </motion.div>
                  )}
                </div>
              </div>
            </DrawerContent>
          </Drawer>

        </div>
      ) : (

      /* ─── 4-PANE SYSTEM (desktop only) ───────────────────────────── */
      <div className="flex-1 flex overflow-hidden divide-x divide-border/40">

        {/* ── Pane 1: Open Roles ─────────────────────────────────────── */}
        <div className="w-[22%] min-w-[240px] max-w-[300px] flex flex-col bg-card/20">
          <PaneHeader
            title="Open Roles"
            subtitle={`${activeToggle} · ${filteredShifts.length} shifts`}
            icon={<Inbox className="h-3.5 w-3.5" />}
            count={filteredShifts.length}
          />
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/30">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-[10px] uppercase tracking-widest font-semibold">Loading…</span>
                  </motion.div>
                ) : filteredShifts.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                    <Inbox className="h-6 w-6" />
                    <p className="text-[10px] uppercase tracking-widest font-semibold">No roles</p>
                  </motion.div>
                ) : (
                  <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                    {filteredShifts.map((s) => (
                      <RoleCard
                        key={s.id}
                        shift={s}
                        isSelected={expandedV8ShiftId === s.id}
                        onSelect={() => handleExpand(s.id)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </div>

        {/* ── Pane 2: Bidders ────────────────────────────────────────── */}
        <div className="w-[18%] min-w-[200px] max-w-[260px] flex flex-col bg-card/10">
          <PaneHeader
            title="Bidders"
            subtitle={expandedShift?.role ?? 'Select a role'}
            icon={<Users className="h-3.5 w-3.5" />}
            count={expandedShift ? bids.length : undefined}
          />
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              <AnimatePresence mode="wait">
                {!expandedShift ? (
                  <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                    <ChevronRight className="h-5 w-5" />
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-center">Select a role</p>
                  </motion.div>
                ) : isLoadingBids ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex justify-center text-muted-foreground/20">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </motion.div>
                ) : bids.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                    <Users className="h-5 w-5" />
                    <p className="text-[10px] uppercase tracking-widest font-semibold">No bids yet</p>
                  </motion.div>
                ) : (
                  <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                    {bids.map((bid, i) => (
                      <BidderRow
                        key={bid.id}
                        bid={bid}
                        index={i}
                        isSelected={selectedBid?.id === bid.id}
                        isWinner={expandedShift.assignedEmployeeId === bid.employeeId || (!expandedShift.assignedEmployeeId && bid.isWinner)}
                        groupVariant={getGroupVariant(expandedShift.groupType, expandedShift.department)}
                        onSelect={() => handleSelectBid(bid)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>


            </div>
          </ScrollArea>
        </div>



        {/* ── Pane 3: Intelligence & Actions ─────────────────────────── */}
        <div className="flex-1 flex flex-col bg-card/20 min-w-0">
          <PaneHeader
            title="Intelligence"
            subtitle="Recommendations & actions"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            accentClass="text-violet-400/50"
          />

          <div className="flex-1 flex flex-col overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <AnimatePresence mode="wait">
                  {!selectedBid ? (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                      <Zap className="h-5 w-5" />
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-center">No candidate<br/>selected</p>
                    </motion.div>
                  ) : bidsPanel.status === 'idle' || bidsPanel.status === 'running' ? (
                    <motion.div key="prerun" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4 pt-2">
                      {/* Context card */}
                      <div className="rounded-2xl border border-border/50 bg-muted/10 overflow-hidden">
                        <div className="px-3.5 py-2.5 border-b border-border/40">
                          <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">Candidate</p>
                        </div>
                        <div className="p-3.5 space-y-2.5">
                          {[
                            ['Employee', selectedBid.employeeName],
                            ['Role', expandedShift?.role ?? '—'],
                            ['Shift', expandedShift ? `${expandedShift.startTime} – ${expandedShift.endTime}` : '—'],
                            ['Date', expandedShift?.dayLabel ?? '—'],
                          ].map(([k, v]) => (
                            <div key={k} className="flex justify-between items-baseline gap-2">
                              <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wider shrink-0">{k}</span>
                              <span className="text-[10px] font-semibold text-foreground/60 truncate text-right">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ) : bidsPanel.status === 'error' ? (
                    <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-rose-500/50">
                      <CircleX className="h-5 w-5" />
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-center">Engine Error</p>
                      <p className="text-[9px] font-mono text-center max-w-[200px] break-words">
                        {bidsPanel.error}
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                      {/* Summary label */}
                      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/40 px-0.5">
                        {(blockingIssues.length + warningIssues.length) > 0
                          ? `${blockingIssues.length} blocker${blockingIssues.length !== 1 ? 's' : ''} · ${warningIssues.length} warning${warningIssues.length !== 1 ? 's' : ''}`
                          : 'All checks passed'}
                      </p>

                      {/* Issue cards — blockers */}
                      {blockingIssues.map((hit, i) => (
                        <motion.div
                          key={`${hit.rule_id}-${i}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.06, ease: [0.23, 1, 0.32, 1] }}
                          className="rounded-2xl border overflow-hidden border-rose-500/20 bg-rose-500/[0.04]"
                        >
                          <div className="px-3.5 py-2 border-b border-white/[0.04] flex items-center gap-2">
                            <CircleX className="h-3 w-3 text-rose-400 shrink-0" />
                            <span className="text-[10px] font-semibold text-rose-400">
                              {hit.rule_name || hit.rule_id.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="px-3.5 py-2.5">
                            <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{hit.summary || (hit as any).message}</p>
                            {(hit.details || (hit as any).resolution_hint) && (
                              <p className="text-[9px] text-foreground/50 leading-relaxed mt-1.5 border-t border-white/[0.04] pt-1.5">
                                {hit.details || (hit as any).resolution_hint}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      ))}

                      {/* Issue cards — warnings */}
                      {warningIssues.map((hit, i) => (
                        <motion.div
                          key={`${hit.rule_id}-w-${i}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: (blockingIssues.length + i) * 0.06, ease: [0.23, 1, 0.32, 1] }}
                          className="rounded-2xl border overflow-hidden border-amber-500/20 bg-amber-500/[0.04]"
                        >
                          <div className="px-3.5 py-2 border-b border-white/[0.04] flex items-center gap-2">
                            <TriangleAlert className="h-3 w-3 text-amber-400 shrink-0" />
                            <span className="text-[10px] font-semibold text-amber-400">
                              {hit.rule_name || hit.rule_id.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="px-3.5 py-2.5">
                            <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{hit.summary || (hit as any).message}</p>
                            {(hit.details || (hit as any).resolution_hint) && (
                              <p className="text-[9px] text-foreground/50 leading-relaxed mt-1.5 border-t border-white/[0.04] pt-1.5">
                                {hit.details || (hit as any).resolution_hint}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      ))}

                      {/* All clear */}
                      {blockingIssues.length === 0 && warningIssues.length === 0 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="py-10 flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04]"
                        >
                          <ShieldCheck className="h-7 w-7 text-emerald-400/50" />
                          <div className="text-center">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/70">All Clear</p>
                            <p className="text-[9px] text-muted-foreground/30 mt-1 font-mono">
                              {bidsPanel.result?.summary.passed ?? 0} checks passed
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScrollArea>

            {/* Action Footer */}
            <div className="shrink-0 p-5 border-t border-white/[0.05] bg-white/[0.02] backdrop-blur-md">
              <AnimatePresence mode="wait">
                {!selectedBid ? (
                  <div className="h-[44px] flex items-center justify-center rounded-xl border border-dashed border-white/[0.05] bg-white/[0.01]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/10">Select a candidate</span>
                  </div>
                ) : bidsPanel.status === 'idle' || bidsPanel.status === 'error' ? (
                  <Button
                    onClick={bidsPanel.run}
                    className="w-full h-11 text-[11px] font-semibold uppercase tracking-wider rounded-xl shadow-lg shadow-primary/10"
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Run Compliance Check
                  </Button>
                ) : bidsPanel.status === 'running' ? (
                  <Button disabled className="w-full h-11 rounded-xl text-[11px] font-semibold uppercase tracking-wider bg-white/5">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Compliance logic running…
                  </Button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileTap={{ scale: hardBlocked ? 1 : 0.98 }}
                  >
                    <Button
                      onClick={handleAssign}
                      disabled={isAssigning || hardBlocked}
                      className={cn(
                        'w-full h-11 rounded-xl text-[11px] font-semibold uppercase tracking-wider shadow-lg transition-all duration-300',
                        hardBlocked
                          ? 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed shadow-none border border-border/40'
                          : warningIssues.length > 0
                          ? 'bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-amber-500/20'
                          : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-emerald-500/20',
                      )}
                    >
                      {isAssigning
                        ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        : <LucideUserCheck className="h-4 w-4 mr-2" />}
                      {hardBlocked
                        ? 'Blocked by Compliance'
                        : warningIssues.length > 0
                        ? 'Override & Assign Role'
                        : 'Finalize Assignment'}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

      </div>

      )} {/* end isMobile ternary */}

    </div>
  </TooltipProvider>
);
};

export default OpenBidsView;
