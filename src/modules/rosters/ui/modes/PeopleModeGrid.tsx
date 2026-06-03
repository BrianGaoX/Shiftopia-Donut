import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';


import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { 
  Activity, 
  Heart, 
  Scale, 
  Plus, 
  MoreHorizontal, 
  Undo2, 
  Edit2, 
  Zap,
  Info,
  Scale as ScaleIcon,
  Flame,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { AvailabilityBar } from '@/modules/rosters/ui/components/AvailabilityBar';
import { resolveGroupType, resolveShiftStatus } from '@/modules/rosters/utils/roster-utils';
import { DroppableDateCell } from '@/modules/rosters/ui/components/DroppableDateCell';
import { useResolvedAvailability } from '@/modules/rosters/hooks/useResolvedAvailability';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { isSydneyPast } from '@/modules/core/lib/date.utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useCreateShift } from '@/modules/rosters/state/useRosterShifts';
import { 
  PeopleModeEmployee, 
  PeopleModeShift, 
  DND_UNFILLED_SHIFT, 
  DND_SHIFT_TYPE,
  ShiftDragItem
} from './people-mode.types';
import type { UnfilledShift } from './UnfilledShiftsPanel';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useShallow } from 'zustand/react/shallow';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { useDrag } from 'react-dnd';
import { canDragShift } from '@/modules/rosters/utils/dnd.utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import { getUtilizationStatus } from '@/modules/rosters/domain/projections/utils/fairness';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

/* ============================================================
   INTERFACES
   ============================================================ */

// Re-export for backward compatibility if needed, or just use the imported ones
export type EmployeeShift = PeopleModeShift;
export type Employee = PeopleModeEmployee;

// ── Module-scope no-op so that an absent onAssignShift prop doesn't bust
//    referential equality on every render of every DroppableDateCell.
const NOOP_ASSIGN: (shift: UnfilledShift, employeeId: string, dateKey: string) => void = () => {};

// ── Virtualization constants ─────────────────────────────────────────────────
// Estimated row height in px. Real rows vary with shift count per day, but the
// majority cluster around 200–240px. Spacer math drifts at most a row or two
// for very-busy operators, which OVERSCAN absorbs.
const VIRT_ROW_HEIGHT = 220;
const VIRT_OVERSCAN = 5;
const VIRT_THRESHOLD = 30;

// ── canUnpublish — any Published shift can be unpublished (→ S1 or S2) ───────
function canUnpublish(shift: PeopleModeShift): boolean {
  return shift.lifecycleStatus === 'published';
}

interface PeopleModeGridProps {
  employees: PeopleModeEmployee[];
  dates: Date[];
  canEdit: boolean;
  showAvailabilities: boolean;
  isBulkMode?: boolean;
  selectedShifts?: string[];
  onToggleShiftSelection?: (shiftId: string) => void;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onViewShift?: (shift: PeopleModeShift) => void;
  /** Compliance data map: shiftId -> ComplianceInfo */
  complianceMap?: Record<string, ComplianceInfo>;
  /** Card variant: compact (default) or detailed */
  cardVariant?: 'compact' | 'detailed';
  // Interactive Handlers
  onBidShift?: (shiftId: string) => void;
  onSwapShift?: (shiftId: string) => void;
  onCancelShift?: (shiftId: string) => void;
  onUnpublishShift?: (shiftId: string) => void;

  /** Called when an unfilled shift is drag-dropped onto an employee date cell */
  onAssignShift?: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  /** Called when an existing shift is moved */
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
}

/* ============================================================
   DRAGGABLE SHIFT CARD WRAPPER
   ============================================================ */

interface DraggableShiftCardProps {
  shift: PeopleModeShift;
  employee: PeopleModeEmployee;
  children: React.ReactNode;
  disabled?: boolean;
}

const DraggableShiftCardImpl: React.FC<DraggableShiftCardProps> = ({
  shift,
  employee,
  children,
  disabled,
}) => {
  const shiftId = shift.id;
  const subGroup = shift.subGroup;
  const startTime = shift.startTime;
  const endTime = shift.endTime;
  const isPublished = shift.lifecycleStatus === 'published';
  const isCancelled = shift.isCancelled;
  const shiftDate = shift.rawShift?.shift_date || '';
  const sourceGroupType = (shift as any).groupType || 'people-mode';

  // canDrag reads isDnDModeActive via getState() so flipping the global flag
  // does NOT re-render every card or re-register every drag spec. Previously
  // this was a reactive subscription + dep — measured as ~800ms INP on the
  // DnD toggle in the 1.4k-card grid.
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DND_SHIFT_TYPE,
    item: {
      shiftId,
      sourceGroupType,
      sourceSubGroup: subGroup || 'Unassigned',
      shiftDate,
      startTime,
      endTime,
      lifecycle_status: isPublished ? 'Published' : 'Draft',
      is_cancelled: isCancelled,
    } as ShiftDragItem,
    canDrag: () => canDragShift(
      {
        lifecycle_status: isPublished ? 'Published' : 'Draft',
        is_cancelled: isCancelled,
      },
      useRosterStore.getState().isDnDModeActive,
    ) && !disabled,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [shiftId, subGroup, startTime, endTime, isPublished, isCancelled, shiftDate, sourceGroupType, disabled, employee.id]);

  return (
    <div
      ref={drag}
      className={cn(
        'transition-all duration-300',
        isDragging && 'opacity-40 scale-95 rotate-1 grayscale shadow-none'
      )}
    >
      {React.cloneElement(children as React.ReactElement, { isDragging })}
    </div>
  );
};

const DraggableShiftCard = React.memo(DraggableShiftCardImpl);

/* ============================================================
   SHIFT ROW MENU (memoized)
   ============================================================ */

interface ShiftRowMenuProps {
  shift: PeopleModeShift;
  onEdit: (shift: PeopleModeShift) => void;
  onClone: (shift: PeopleModeShift) => void;
  onUnpublish?: (shiftId: string) => void;
}

const ShiftRowMenu = React.memo<ShiftRowMenuProps>(({ shift, onEdit, onClone, onUnpublish }) => {
  return (
    // modal={false}: skip Radix focus trap + body lock. A 3-item menu over a
    // shift card doesn't need either; the trap traversal showed up as the
    // FocusOnMount span in the INP trace.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="h-4 w-4 flex items-center justify-center hover:bg-muted dark:hover:bg-white/20 rounded transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3 text-muted-foreground dark:text-white/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px] z-50">
        <DropdownMenuItem
          onClick={() => onEdit(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => onClone(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Plus className="h-4 w-4 mr-2" />
          Clone Shift
        </DropdownMenuItem>

        {canUnpublish(shift) && onUnpublish && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => onUnpublish(shift.id)}
              className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Unpublish Shift
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
ShiftRowMenu.displayName = 'ShiftRowMenu';

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const PeopleModeGrid: React.FC<PeopleModeGridProps> = ({
  employees,
  dates,
  canEdit,
  showAvailabilities,
  isBulkMode: propIsBulkMode = false,
  selectedShifts: propsSelectedShifts = [],
  onToggleShiftSelection,
  onAddShift,
  onViewShift,
  complianceMap,
  cardVariant = 'compact',
  onBidShift,
  onSwapShift,
  onCancelShift,
  onUnpublishShift,

  onAssignShift,
  onMoveShift,
}) => {
  const { toast } = useToast();
  const createShiftMutation = useCreateShift();
  const {
    bulkModeActive: globalBulkModeActive,
    selectedV8ShiftIds: globalSelectedV8ShiftIds,
    toggleShiftSelection: globalToggleShiftSelection,
  } = useRosterStore(
    useShallow((s) => ({
      bulkModeActive: s.bulkModeActive,
      selectedV8ShiftIds: s.selectedV8ShiftIds,
      toggleShiftSelection: s.toggleShiftSelection,
    })),
  );

  const isBulkMode = propIsBulkMode || globalBulkModeActive;
  const { toggleShiftSelection: uiToggleShiftSelection } = useRosterUI();

  const currentSelectedShifts = propsSelectedShifts;
  // O(1) lookup for the selection check that runs once per shift card.
  // Memoized on the array reference so identical selection state doesn't
  // rebuild the Set on every render of the parent.
  const currentSelectedShiftsSet = useMemo(
    () => new Set(currentSelectedShifts),
    [currentSelectedShifts],
  );

  const handleCloneShift = useCallback(async (shift: PeopleModeShift) => {
    try {
      const { rawShift } = shift;
      if (!rawShift) {
        toast({ title: 'Error', description: 'Could not find raw shift data to clone.', variant: 'destructive' });
        return;
      }

      const cloneData: any = {
        roster_id: rawShift.roster_id,
        department_id: rawShift.department_id,
        sub_department_id: rawShift.sub_department_id,
        shift_date: rawShift.shift_date,
        start_time: rawShift.start_time,
        end_time: rawShift.end_time,
        organization_id: rawShift.organization_id,
        group_type: rawShift.group_type,
        sub_group_name: rawShift.sub_group_name,
        shift_group_id: rawShift.shift_group_id,
        shift_subgroup_id: rawShift.shift_subgroup_id || (rawShift as any).roster_subgroup_id,
        role_id: rawShift.role_id,
        remuneration_level_id: rawShift.remuneration_level_id,
        paid_break_minutes: rawShift.paid_break_minutes,
        unpaid_break_minutes: rawShift.unpaid_break_minutes,
        timezone: rawShift.timezone,
        required_skills: rawShift.required_skills || [],
        required_licenses: rawShift.required_licenses || [],
        event_ids: rawShift.event_ids || [],
        tags: rawShift.tags || [],
        notes: rawShift.notes,
        is_training: rawShift.is_training,
      };

      await createShiftMutation.mutateAsync(cloneData);
      toast({
        title: 'Shift Cloned',
        description: 'A new draft replica has been created (unassigned).',
      });
    } catch (error: any) {
      toast({
        title: 'Clone Failed',
        description: error.message || 'Could not clone shift.',
        variant: 'destructive',
      });
    }
  }, [createShiftMutation, toast]);

  const handleEditShift = useCallback((shift: PeopleModeShift) => {
    onViewShift?.(shift);
  }, [onViewShift]);

  const handleShiftClick = useCallback((shift: PeopleModeShift) => {
    if (isBulkMode) {
      // Prioritize prop-based toggle, then global store, then UI context
      if (onToggleShiftSelection) {
        onToggleShiftSelection(shift.id);
      } else if (globalToggleShiftSelection) {
        globalToggleShiftSelection(shift.id);
      } else {
        uiToggleShiftSelection(shift.id);
      }
    } else {
      onViewShift?.(shift);
    }
  }, [isBulkMode, onToggleShiftSelection, globalToggleShiftSelection, uiToggleShiftSelection, onViewShift]);

  const stableOnAssign = onAssignShift ?? NOOP_ASSIGN;
  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);
  // Get all profile IDs for availability lookup
  const profileIds = useMemo(() => employees.map(e => e.id), [employees]);

  // Fetch resolved availability from database
  const { getAvailability, isLoading: availabilityLoading } = useResolvedAvailability(
    profileIds,
    dates,
    showAvailabilities // Only fetch when availabilities are shown
  );

  const showFatigueHeatmap = useRosterStore(s => s.showFatigueHeatmap);

  // ── Virtualization: track scroll position + viewport height to compute the
  //    visible row window. Disabled below VIRT_THRESHOLD employees (rendering
  //    everything is cheaper than the bookkeeping for small lists).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const shouldVirtualize = employees.length > VIRT_THRESHOLD && viewportHeight > 0;
  const startIdx = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / VIRT_ROW_HEIGHT) - VIRT_OVERSCAN)
    : 0;
  const endIdx = shouldVirtualize
    ? Math.min(
        employees.length,
        startIdx + Math.ceil(viewportHeight / VIRT_ROW_HEIGHT) + 2 * VIRT_OVERSCAN
      )
    : employees.length;
  const topSpacer = startIdx * VIRT_ROW_HEIGHT;
  const bottomSpacer = (employees.length - endIdx) * VIRT_ROW_HEIGHT;
  const totalCols = dates.length + 1;

  return (
    <TooltipProvider delayDuration={200}>
      {showFatigueHeatmap && (
        <div className="absolute top-4 right-4 z-[60] flex items-center gap-4 animate-in fade-in slide-in-from-right-4 duration-500">
          <Badge className="px-4 py-2 bg-amber-500/90 text-white backdrop-blur-md border border-amber-400/50 shadow-[0_0_20px_rgba(245,158,11,0.2)] flex items-center gap-2 text-xs font-bold rounded-full">
            <Flame className="h-3.5 w-3.5 animate-pulse" />
            HEALTH MODE
          </Badge>
          
          <div className="hidden md:flex items-center gap-3 px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10">
            {[
              { color: 'bg-emerald-500', label: 'Optimal' },
              { color: 'bg-amber-500', label: 'Risk' },
              { color: 'bg-red-500', label: 'Critical' },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={cn("h-1.5 w-1.5 rounded-full", l.color)} />
                <span className="text-[8px] font-black uppercase tracking-wider text-white/60">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* DnD Mode Indicator */}
      {isDnDModeActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500 pointer-events-none">
          <Badge className="px-6 py-2 bg-emerald-500/90 text-white backdrop-blur-md border border-emerald-400/50 shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center gap-2 text-sm font-medium rounded-full">
            <Zap className="h-4 w-4 animate-pulse" />
            DnD Mode Active
          </Badge>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto custom-scrollbar"
      >
        <div className="p-6">
          {/* ==================== TABLE CONTAINER ==================== */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse relative">
                {/* ==================== HEADER ROW ==================== */}
                <thead>
                  <tr className="bg-muted/30">
                    {/* Employee Column Header */}
                    <th className="sticky top-0 left-0 z-30 bg-muted/30 border-r border-b border-border px-4 py-3 text-left min-w-[200px]">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Employee</span>
                    </th>

                    {/* Date Column Headers */}
                    {dates.map((date, idx) => {
                      const dateIsToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                      return (
                        <th
                          key={idx}
                          className={cn(
                            'sticky top-0 z-20 bg-muted/30 border-b border-border px-3 py-3 text-center min-w-[160px]',
                            idx < dates.length - 1 && 'border-r',
                            dateIsToday && 'bg-primary/5'
                          )}
                        >
                          <div className={cn("text-[10px] font-bold uppercase tracking-[0.12em] font-mono", dateIsToday ? "text-primary" : "text-muted-foreground")}>{format(date, 'EEE')}</div>
                          <div className={cn("text-sm font-mono tabular-nums mt-0.5", dateIsToday ? "text-primary font-bold" : "text-muted-foreground/50 font-medium")}>
                            {format(date, 'MMM d')}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* ==================== BODY ROWS ==================== */}
                <tbody>
                  {topSpacer > 0 && (
                    <tr aria-hidden style={{ height: topSpacer }}>
                      <td colSpan={totalCols} />
                    </tr>
                  )}
                  {employees.slice(startIdx, endIdx).map((employee, i) => {
                    const empIdx = startIdx + i;
                    return (
                      <EmployeeRow
                        key={employee.id}
                        employee={employee}
                        empIdx={empIdx}
                        isLastRow={empIdx === employees.length - 1}
                        dates={dates}
                        canEdit={canEdit}
                        isBulkMode={isBulkMode}
                        showAvailabilities={showAvailabilities}
                        showFatigueHeatmap={showFatigueHeatmap}
                        cardVariant={cardVariant}
                        complianceMap={complianceMap}
                        currentSelectedShifts={currentSelectedShiftsSet}
                        isDnDModeActive={isDnDModeActive}
                        getAvailability={getAvailability}
                        onAddShift={onAddShift}
                        onClickShift={handleShiftClick}
                        onEditShift={handleEditShift}
                        onCloneShift={handleCloneShift}
                        onUnpublishShift={onUnpublishShift}
                        onAssign={stableOnAssign}
                        onMoveShift={onMoveShift}
                      />
                    );
                  })}
                  {bottomSpacer > 0 && (
                    <tr aria-hidden style={{ height: bottomSpacer }}>
                      <td colSpan={totalCols} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default PeopleModeGrid;

/* ============================================================
   EMPLOYEE ROW (memoized)
   ============================================================ */

interface EmployeeRowProps {
  employee: PeopleModeEmployee;
  empIdx: number;
  isLastRow: boolean;
  dates: Date[];
  canEdit: boolean;
  isBulkMode: boolean;
  showAvailabilities: boolean;
  showFatigueHeatmap: boolean;
  cardVariant: 'compact' | 'detailed';
  complianceMap?: Record<string, ComplianceInfo>;
  currentSelectedShifts: Set<string>;
  isDnDModeActive: boolean;
  getAvailability: (employeeId: string, dateKey: string) => any;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onClickShift: (shift: PeopleModeShift) => void;
  onEditShift: (shift: PeopleModeShift) => void;
  onCloneShift: (shift: PeopleModeShift) => void;
  onUnpublishShift?: (shiftId: string) => void;
  onAssign: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
}

const EmployeeRowImpl: React.FC<EmployeeRowProps> = ({
  employee,
  empIdx,
  isLastRow,
  dates,
  canEdit,
  isBulkMode,
  showAvailabilities,
  showFatigueHeatmap,
  cardVariant,
  complianceMap,
  currentSelectedShifts,
  isDnDModeActive,
  getAvailability,
  onAddShift,
  onClickShift,
  onEditShift,
  onCloneShift,
  onUnpublishShift,
  onAssign,
  onMoveShift,
}) => {
  return (
    <tr
      className={cn(
        'group relative border-b border-border/50',
        empIdx % 2 === 0 ? 'bg-card' : 'bg-muted/30'
      )}
    >
      {showFatigueHeatmap && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none',
            employee.fatigueScore < 10 ? 'bg-emerald-500/5' :
            employee.fatigueScore < 20 ? 'bg-amber-500/10' :
            'bg-red-500/15'
          )}
        />
      )}
      {/* ========== EMPLOYEE INFO CELL ========== */}
      <td className="sticky left-0 z-10 bg-card group-hover:bg-accent/50 transition-colors border-r border-border px-4 py-3 align-top">
        <div className="flex items-center gap-3">
          <Avatar className={cn(
            'h-10 w-10 shrink-0 ring-2 ring-offset-1',
            employee.overHoursWarning ? 'ring-amber-400/70' : 'ring-transparent'
          )}>
            <AvatarImage src={employee.avatar} alt={employee.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {employee.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{employee.name}</div>
            <div className="text-[10px] tracking-[0.08em] uppercase font-mono text-muted-foreground/70">
              {employee.employeeId}
            </div>
            <div className="mt-1.5 space-y-0.5">
              <div className="flex items-center justify-between">
                <span className={cn(
                  'text-[10px] font-mono tabular-nums',
                  employee.overHoursWarning ? 'text-amber-400' : 'text-muted-foreground'
                )}>
                  {employee.currentHours.toFixed(1)}h
                  <span className="text-muted-foreground/50"> / {employee.contractedHours}h</span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] font-mono tabular-nums text-emerald-400/80 cursor-help hover:text-emerald-400 transition-colors">
                      {formatCost(employee.estimatedPay)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="w-52 p-3 bg-zinc-900 border-white/10 shadow-xl" side="right" sideOffset={15}>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{employee.name.split(' ')[0]}'s Estimate</p>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-white/60">Base Pay</span>
                          <span className="text-white font-medium">{formatCost(employee.payBreakdown.base)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/60">Penalties</span>
                          <span className="text-emerald-400 font-medium">+{formatCost(employee.payBreakdown.penalty)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/60">Overtime</span>
                          <span className="text-amber-400 font-medium">+{formatCost(employee.payBreakdown.overtime)}</span>
                        </div>
                        {employee.payBreakdown.allowance > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-white/60">Allowances</span>
                            <span className="text-blue-400 font-medium">+{formatCost(employee.payBreakdown.allowance)}</span>
                          </div>
                        )}
                        {employee.payBreakdown.leave > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-white/60">Leave Loading</span>
                            <span className="text-purple-400 font-medium">+{formatCost(employee.payBreakdown.leave)}</span>
                          </div>
                        )}
                        <div className="pt-1 border-t border-white/10 flex justify-between text-xs font-bold">
                          <span className="text-white">Total</span>
                          <span className="text-white">{formatCost(employee.estimatedPay)}</span>
                        </div>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={cn(
                        'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider cursor-help transition-all border backdrop-blur-sm',
                        employee.fatigueScore < 10 ? 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5 shadow-[0_0_10px_rgba(52,211,153,0.1)]' :
                        employee.fatigueScore < 20 ? 'text-amber-400 border-amber-400/20 bg-amber-400/5 shadow-[0_0_10px_rgba(251,191,36,0.1)]' :
                        'text-red-400 border-red-400/30 bg-red-400/10 shadow-[0_0_15px_rgba(248,113,113,0.2)] animate-pulse'
                      )}>
                        <Activity className="h-2.5 w-2.5" />
                        FTG {employee.fatigueScore.toFixed(0)}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="w-60 p-4 bg-zinc-900/98 backdrop-blur-md border-white/10 shadow-2xl rounded-xl" side="right">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'p-2 rounded-lg',
                            employee.fatigueScore < 10 ? 'bg-emerald-400/20' :
                            employee.fatigueScore < 20 ? 'bg-amber-400/20' : 'bg-red-400/20'
                          )}>
                            <Activity className={cn(
                              'h-4 w-4',
                              employee.fatigueScore < 10 ? 'text-emerald-400' :
                              employee.fatigueScore < 20 ? 'text-amber-400' : 'text-red-400'
                            )} />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Fatigue Health</p>
                            <p className="text-xs font-bold text-white">Projected: {employee.fatigueScore.toFixed(1)}</p>
                          </div>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full',
                              employee.fatigueScore < 10 ? 'bg-emerald-400' :
                              employee.fatigueScore < 20 ? 'bg-amber-400' : 'bg-red-400'
                            )}
                            style={{ width: `${Math.min((employee.fatigueScore / 25) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-white/70 leading-relaxed italic">
                          {employee.fatigueScore < 10 ? 'Optimal recovery state. Ready for high-intensity shifts.' :
                            employee.fatigueScore < 20 ? 'Moderate accumulation. Monitor for cognitive decline.' :
                              'Critical fatigue detected. Mandatory rest recommended per MA000080.'}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={cn(
                        'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider cursor-help transition-all border backdrop-blur-sm',
                        employee.utilization < 80 ? 'text-blue-400 border-blue-400/20 bg-blue-400/5 shadow-[0_0_8px_rgba(96,165,250,0.1)]' :
                        employee.utilization <= 105 ? 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5 shadow-[0_0_8px_rgba(52,211,153,0.1)]' :
                        'text-amber-400 border-amber-400/20 bg-amber-400/5 shadow-[0_0_10px_rgba(251,191,36,0.1)]'
                      )}>
                        <Scale className="h-2.5 w-2.5" />
                        UTL {employee.utilization.toFixed(0)}%
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="w-60 p-4 bg-zinc-900/98 backdrop-blur-md border-white/10 shadow-2xl rounded-xl" side="right">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'p-2 rounded-lg',
                            employee.utilization < 80 ? 'bg-blue-400/20' :
                            employee.utilization <= 105 ? 'bg-emerald-400/20' : 'bg-amber-400/20'
                          )}>
                            <Scale className={cn(
                              'h-4 w-4',
                              employee.utilization < 80 ? 'text-blue-400' :
                              employee.utilization <= 105 ? 'text-emerald-400' : 'bg-amber-400'
                            )} />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Fairness / Utilization</p>
                            <p className="text-xs font-bold text-white">{employee.utilization.toFixed(0)}% of Contract</p>
                          </div>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full',
                              employee.utilization < 80 ? 'bg-blue-400' :
                              employee.utilization <= 105 ? 'bg-emerald-400' : 'bg-amber-400'
                            )}
                            style={{ width: `${Math.min(employee.utilization, 120)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-white/70 leading-relaxed italic">
                          {employee.utilization < 80 ? 'Under-utilized. Priority candidate for additional shifts.' :
                            employee.utilization <= 105 ? 'Perfect balance. Meeting contractual obligations.' :
                              'Over-utilized. High risk of overtime penalties and burnout.'}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                {employee.overHoursWarning && (
                  <span className="text-[9px] font-mono tracking-wider text-amber-400 uppercase">OT</span>
                )}
              </div>
              <div className="h-[3px] w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    employee.overHoursWarning ? 'bg-amber-400' : 'bg-primary/60'
                  )}
                  style={{
                    width: `${Math.min(100, employee.contractedHours > 0
                      ? (employee.currentHours / employee.contractedHours) * 100
                      : 0
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </td>

      {/* ========== DATE CELLS ========== */}
      {dates.map((date, dateIdx) => (
        <EmployeeDateCell
          key={dateIdx}
          employee={employee}
          date={date}
          isLastCol={dateIdx === dates.length - 1}
          canEdit={canEdit}
          isBulkMode={isBulkMode}
          showAvailabilities={showAvailabilities}
          cardVariant={cardVariant}
          complianceMap={complianceMap}
          currentSelectedShifts={currentSelectedShifts}
          isDnDModeActive={isDnDModeActive}
          getAvailability={getAvailability}
          onAddShift={onAddShift}
          onClickShift={onClickShift}
          onEditShift={onEditShift}
          onCloneShift={onCloneShift}
          onUnpublishShift={onUnpublishShift}
          onAssign={onAssign}
          onMoveShift={onMoveShift}
        />
      ))}
    </tr>
  );
};

const EmployeeRow = React.memo(EmployeeRowImpl);

/* ============================================================
   EMPLOYEE DATE CELL (memoized — one cell per (employee, date))
   ============================================================ */

interface EmployeeDateCellProps {
  employee: PeopleModeEmployee;
  date: Date;
  isLastCol: boolean;
  canEdit: boolean;
  isBulkMode: boolean;
  showAvailabilities: boolean;
  cardVariant: 'compact' | 'detailed';
  complianceMap?: Record<string, ComplianceInfo>;
  currentSelectedShifts: Set<string>;
  isDnDModeActive: boolean;
  getAvailability: (employeeId: string, dateKey: string) => any;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onClickShift: (shift: PeopleModeShift) => void;
  onEditShift: (shift: PeopleModeShift) => void;
  onCloneShift: (shift: PeopleModeShift) => void;
  onUnpublishShift?: (shiftId: string) => void;
  onAssign: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
}

const EmployeeDateCellImpl: React.FC<EmployeeDateCellProps> = ({
  employee,
  date,
  isLastCol,
  canEdit,
  isBulkMode,
  showAvailabilities,
  cardVariant,
  complianceMap,
  currentSelectedShifts,
  isDnDModeActive,
  getAvailability,
  onAddShift,
  onClickShift,
  onEditShift,
  onCloneShift,
  onUnpublishShift,
  onAssign,
  onMoveShift,
}) => {
  const dateKey = format(date, 'yyyy-MM-dd');
  const shifts = employee.shifts[dateKey] ?? [];
  const availability = getAvailability(employee.id, dateKey);
  const datePast = isSydneyPast(date);

  const cellClassName = cn(
    'px-3 py-3 align-top relative group/cell',
    !isLastCol && 'border-r border-border',
    canEdit && !isBulkMode && 'cursor-pointer',
  );

  const cellOnClick = useCallback(() => {
    if (canEdit && !isBulkMode && shifts.length === 0 && !datePast) {
      onAddShift(employee, date);
    }
  }, [canEdit, isBulkMode, shifts.length, datePast, onAddShift, employee, date]);

  const handleAddClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAddShift(employee, date);
  }, [onAddShift, employee, date]);

  return (
    <DroppableDateCell
      employeeId={employee.id}
      dateKey={dateKey}
      className={cellClassName}
      onClick={cellOnClick}
      onAssign={onAssign}
      onMove={onMoveShift}
    >
      <div className={cn('space-y-2', showAvailabilities ? 'min-h-[110px]' : 'min-h-[80px]')}>
        {shifts.length > 0
          ? shifts.map((shift) => {
              const { isPast, isLocked: isManagementLocked } = resolveShiftStatus(shift);
              const isLocked = isManagementLocked || (isDnDModeActive && shift.lifecycleStatus !== 'draft');
              const rawShift = shift.rawShift;
              if (!rawShift) return null;

              return (
                <DraggableShiftCard
                  key={shift.id}
                  shift={shift}
                  employee={employee}
                  disabled={isManagementLocked}
                >
                  <SmartShiftCard
                    headerAction={
                      canEdit && !isBulkMode ? (
                        <ShiftRowMenu
                          shift={shift}
                          onEdit={onEditShift}
                          onClone={onCloneShift}
                          onUnpublish={onUnpublishShift}
                        />
                      ) : undefined
                    }
                    shift={rawShift}
                    variant={cardVariant}
                    groupColor={resolveGroupType(rawShift)}
                    compliance={complianceMap?.[shift.id]}
                    isSelected={currentSelectedShifts.has(shift.id)}
                    isLocked={isLocked}
                    isPast={isPast}
                    isDnDActive={isDnDModeActive}
                    showStatusIcons={true}
                    detailedCost={shift.detailedCost}
                    onClick={() => onClickShift(shift)}
                  />
                </DraggableShiftCard>
              );
            })
          : null}

        {!isBulkMode && canEdit && !datePast && (
          <div
            className={cn(
              'absolute inset-0 flex pointer-events-none z-10',
              shifts.length > 0 ? 'items-end justify-end p-2' : 'items-center justify-center'
            )}
          >
            <button
              className={cn(
                'flex items-center justify-center rounded-full transition-[transform,background-color,opacity,box-shadow] duration-200 pointer-events-auto',
                'bg-primary/30 text-primary border border-primary/40 backdrop-blur-md',
                'hover:bg-primary/60 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(var(--primary),0.3)]',
                shifts.length > 0
                  ? 'w-7 h-7 opacity-0 scale-75 group-hover/cell:opacity-100 group-hover/cell:scale-100'
                  : 'w-9 h-9 opacity-40 scale-90 hover:opacity-100',
                'group/add'
              )}
              onClick={handleAddClick}
              title="Add Shift"
            >
              <Plus className={cn(
                shifts.length > 0 ? 'h-4 w-4' : 'h-5 w-5',
                'transition-transform group-hover/add:rotate-90'
              )} />
            </button>
          </div>
        )}

        {showAvailabilities && (
          <AvailabilityBar availability={availability} className="pt-1" />
        )}
      </div>
    </DroppableDateCell>
  );
};

const EmployeeDateCell = React.memo(EmployeeDateCellImpl);
