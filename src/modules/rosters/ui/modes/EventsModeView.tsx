import React, { useState, useMemo } from 'react';
import { Calendar, Users, AlertTriangle, Plus, ChevronDown, ChevronRight, MoreHorizontal, Undo2, Edit2 } from 'lucide-react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Card } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { format, parseISO } from 'date-fns';
import { useShiftFormNav } from '@/modules/rosters/hooks/useShiftFormNav';
import { Shift } from '@/modules/rosters/api/shifts.api';
import { useEvents, useUnpublishShift, useCreateShift } from '@/modules/rosters/state/useRosterShifts';
import { SmartShiftCard, ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { useToast } from '@/modules/core/hooks/use-toast';
import { resolveGroupType, resolveShiftStatus } from '@/modules/rosters/utils/roster-utils';
import { cn } from '@/modules/core/lib/utils';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { isShiftLocked } from '@/modules/rosters/domain/policies/canEditShift.policy';
import type { EventsProjection } from '@/modules/rosters/domain/projections/types';
import { coverageVariant } from '@/modules/rosters/domain/projections/utils/coverage';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
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

// Per-event card cap — bounds DOM nodes when an event has many shifts.
// Renders the first N and collapses the rest behind a "+N more" toggle.
// Higher than the grid-mode cap because event cards span the full width
// (3 columns), so ~12 cards is roughly 4 rows before truncating.
const MAX_CARDS_PER_EVENT = 12;

interface EventsModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  /** Shifts data from parent */
  shifts?: Shift[];
  /** Loading state from parent */
  isShiftsLoading?: boolean;
  /** Organization ID for fetching events */
  organizationId?: string;
  /** Compliance data map */
  complianceMap?: Record<string, ComplianceInfo>;
  /** Phase-2: typed projection snapshot from useRosterProjections */
  projection?: EventsProjection;
  onEditShift?: (shift: any) => void;
}

// ── Normalised render structure (same shape from both data sources) ────────────

interface EventGroup {
  eventId: string;
  eventName: string;
  eventDate: Date | null;
  startTime: string;
  endTime: string;
  location: string;
  shifts: Shift[];
  totalHours: number;
  assignedCount: number;
  unassignedCount: number;
  /** Coverage ratio 0–1 (null when no projection available) */
  coverageRatio: number;
}

// ── Coverage LED bar (8-segment version for event cards) ─────────────────────

const EventCoverageBar: React.FC<{ pct: number; variant: string }> = ({ pct, variant }) => {
  const segments = 8;
  const filled = Math.round((pct / 100) * segments);
  const colorMap: Record<string, string> = {
    default: 'bg-emerald-400',
    secondary: 'bg-amber-400',
    destructive: 'bg-red-400',
    outline: 'bg-slate-400',
  };
  const barColor = colorMap[variant] ?? 'bg-slate-400';
  return (
    <div className="flex items-center gap-[2px]" aria-label={`${pct}% staffed`}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{ animationDelay: `${i * 30}ms` }}
          className={cn(
            'h-[4px] w-[10px] rounded-sm transition-all',
            i < filled ? cn(barColor, 'opacity-90') : 'bg-muted dark:bg-white/10'
          )}
        />
      ))}
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

// ── canUnpublish — any Published shift can be unpublished (→ S1 or S2) ───────
function canUnpublish(shift: Shift): boolean {
  return shift.lifecycle_status === 'Published';
}

export const EventsModeView: React.FC<EventsModeViewProps> = ({
  selectedDate,
  viewType,
  shifts = [],
  isShiftsLoading = false,
  organizationId,
  complianceMap,
  projection,
  onEditShift,
}) => {
  const { toast } = useToast();
  const createShiftMutation = useCreateShift();
  const openShiftForm = useShiftFormNav();
  const [collapsedEvents, setCollapsedEvents] = useState<Set<string>>(new Set());

  // Per-event "+N more" expansion (session-only), keyed by eventId.
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());
  const toggleEventExpanded = React.useCallback((eventId: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  // ── Roster Store ────────────────────────────────────────────────────────────
  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);

  // ── Unpublish ────────────────────────────────────────────────────────────────
  const unpublishMutation = useUnpublishShift();
  const [confirmV8ShiftId, setConfirmV8ShiftId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const handleRequestUnpublish = (shiftId: string) => {
    setConfirmV8ShiftId(shiftId);
    setIsConfirmOpen(true);
  };

  const handleConfirmUnpublish = async () => {
    if (!confirmV8ShiftId) return;
    try {
      await unpublishMutation.mutateAsync({ shiftId: confirmV8ShiftId, reason: 'Unpublished via Events view' });
    } catch {
      // mutation onError handles rollback; toast not needed here
    } finally {
      setIsConfirmOpen(false);
      setConfirmV8ShiftId(null);
    }
  };

  const handleCloneShift = async (shift: Shift) => {
    try {
      const cloneData: any = {
        roster_id: shift.roster_id,
        department_id: shift.department_id,
        sub_department_id: shift.sub_department_id,
        shift_date: shift.shift_date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        organization_id: shift.organization_id,
        group_type: shift.group_type,
        sub_group_name: shift.sub_group_name,
        shift_group_id: (shift as any).shift_group_id,
        shift_subgroup_id: (shift as any).shift_subgroup_id || (shift as any).roster_subgroup_id,
        role_id: shift.role_id,
        remuneration_level_id: shift.remuneration_level_id,
        paid_break_minutes: shift.paid_break_minutes,
        unpaid_break_minutes: shift.unpaid_break_minutes,
        timezone: shift.timezone,
        required_skills: shift.required_skills || [],
        required_licenses: shift.required_licenses || [],
        event_ids: shift.event_ids || [],
        tags: shift.tags || [],
        notes: shift.notes,
        is_training: shift.is_training,
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
  };

  const buildShiftMenu = (shift: any) => (
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
          onClick={() => onEditShift?.(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => handleCloneShift(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Plus className="h-4 w-4 mr-2" />
          Clone Shift
        </DropdownMenuItem>

        {canUnpublish(shift) && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => handleRequestUnpublish(shift.id)}
              className="text-amber-400 hover:bg-amber-500/10 cursor-pointer"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Unpublish Shift
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Keep for modal context (event name / date for new shift creation)
  const { data: events = [] } = useEvents(organizationId);

  // ── Normalise to EventGroup[] from whichever source is active ──────────────
  const eventGroups = useMemo((): EventGroup[] => {
    if (projection) {
      // Phase-2 path: map from typed projection snapshot
      return projection.events.map(pe => ({
        eventId: pe.eventId,
        eventName: pe.eventName,
        eventDate: pe.eventDate ? parseISO(pe.eventDate) : null,
        startTime: pe.startTime,
        endTime: pe.endTime,
        location: pe.location,
        shifts: pe.shifts.map(ps => ({
          ...ps.raw,
          detailedCost: ps.detailedCost
        })) as any,
        totalHours: pe.totalHours,
        assignedCount: pe.assignedCount,
        unassignedCount: pe.totalCount - pe.assignedCount,
        coverageRatio: pe.coverage.ratio,
      }));
    }

    // Legacy fallback: derive from raw shifts + events lookup
    const groupMap = new Map<string, Shift[]>();
    const noEventShifts: Shift[] = [];

    shifts.forEach(shift => {
      const eventIds = shift.event_ids || [];
      if (eventIds.length === 0) {
        noEventShifts.push(shift);
      } else {
        eventIds.forEach(eventId => {
          if (!groupMap.has(eventId)) groupMap.set(eventId, []);
          groupMap.get(eventId)!.push(shift);
        });
      }
    });

    const groups: EventGroup[] = [];

    groupMap.forEach((groupShifts, eventId) => {
      const eventData = events.find((e: any) => e.id === eventId);
      let totalHours = 0;
      let assignedCount = 0;
      let unassignedCount = 0;

      groupShifts.forEach(shift => {
        if (shift.start_time && shift.end_time) {
          const [sh, sm] = shift.start_time.split(':').map(Number);
          const [eh, em] = shift.end_time.split(':').map(Number);
          const hours = (eh * 60 + em - sh * 60 - sm) / 60;
          totalHours += hours > 0 ? hours : 0;
        }
        if (shift.assigned_employee_id) assignedCount++; else unassignedCount++;
      });

      groups.push({
        eventId,
        eventName: eventData?.name || `Event ${eventId.slice(0, 8)}…`,
        eventDate: eventData?.start_date ? parseISO(eventData.start_date) : null,
        startTime: groupShifts[0]?.start_time || '00:00',
        endTime: groupShifts[0]?.end_time || '00:00',
        location: eventData?.venue || 'Unknown Location',
        shifts: groupShifts,
        totalHours,
        assignedCount,
        unassignedCount,
        coverageRatio: groupShifts.length > 0 ? assignedCount / groupShifts.length : 1,
      });
    });

    if (noEventShifts.length > 0) {
      let totalHours = 0; let assignedCount = 0; let unassignedCount = 0;
      noEventShifts.forEach(shift => {
        if (shift.start_time && shift.end_time) {
          const [sh, sm] = shift.start_time.split(':').map(Number);
          const [eh, em] = shift.end_time.split(':').map(Number);
          const hours = (eh * 60 + em - sh * 60 - sm) / 60;
          totalHours += hours > 0 ? hours : 0;
        }
        if (shift.assigned_employee_id) assignedCount++; else unassignedCount++;
      });
      groups.push({
        eventId: '_no_event_',
        eventName: 'Unassigned to Event',
        eventDate: null,
        startTime: '', endTime: '', location: 'General Roster',
        shifts: noEventShifts,
        totalHours,
        assignedCount,
        unassignedCount,
        coverageRatio: noEventShifts.length > 0 ? assignedCount / noEventShifts.length : 1,
      });
    }

    return groups.sort((a, b) => {
      if (a.eventId === '_no_event_') return 1;
      if (b.eventId === '_no_event_') return -1;
      if (a.eventDate && b.eventDate) return a.eventDate.getTime() - b.eventDate.getTime();
      return a.eventName.localeCompare(b.eventName);
    });
  }, [projection, shifts, events]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const toggleEventCollapse = (eventId: string) => {
    setCollapsedEvents(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  };

  const getCoveragePct = (group: EventGroup) =>
    Math.min(100, Math.round(group.coverageRatio * 100));

  const getBadgeVariant = (group: EventGroup) => {
    const r = group.coverageRatio;
    if (r >= 1) return 'default' as const;
    if (r >= 0.8) return 'secondary' as const;
    return 'destructive' as const;
  };

  const getBadgeLabel = (group: EventGroup) => {
    const r = group.coverageRatio;
    if (r >= 1) return 'Fully Staffed';
    if (r >= 0.8) return 'Nearly Staffed';
    if (r >= 0.5) return 'Low Coverage';
    return 'Critical';
  };

  const handleAddShiftClick = (group: EventGroup) => {
    openShiftForm({
      context: {
        mode: 'events',
        date: group.eventDate ? format(group.eventDate, 'yyyy-MM-dd') : format(selectedDate, 'yyyy-MM-dd'),
        eventStartTime: group.startTime,
        eventEndTime: group.endTime,
        eventId: group.eventId !== '_no_event_' ? group.eventId : undefined,
      },
    });
  };

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isShiftsLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading events…
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const totalShifts = projection?.stats?.totalShifts ?? shifts.length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header strip */}
      <div className="px-6 py-3 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="text-[10px] font-mono tracking-[0.12em] uppercase text-muted-foreground">
          <span className="text-foreground tabular-nums">{eventGroups.length}</span> event{eventGroups.length !== 1 ? 's' : ''}
          <span className="mx-2 text-border">·</span>
          <span className="text-foreground tabular-nums">{totalShifts}</span> shifts
          {projection?.stats && (
            <>
              <span className="mx-2 text-border">·</span>
              <span className="text-emerald-500/70 tabular-nums">{(projection.stats.totalNetMinutes / 60).toFixed(1)}h</span>
              <span className="mx-2 text-border">·</span>
              <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-emerald-500/70 tabular-nums cursor-help hover:text-emerald-400 transition-colors">
                            ${projection.stats.estimatedCost.toFixed(0)}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="w-56 p-3 bg-zinc-900 border-white/10 shadow-xl" side="bottom">
                        <div className="space-y-2">
                            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Event Mode Estimate</p>
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/60">Base Pay</span>
                                    <span className="text-white font-medium">{formatCost(projection.stats.costBreakdown.base)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/60">Penalties</span>
                                    <span className="text-emerald-400 font-medium">+{formatCost(projection.stats.costBreakdown.penalty)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/60">Overtime</span>
                                    <span className="text-amber-400 font-medium">+{formatCost(projection.stats.costBreakdown.overtime)}</span>
                                </div>
                                {projection.stats.costBreakdown.allowance > 0 && (
                                    <div className="flex justify-between text-xs">
                                        <span className="text-white/60">Allowances</span>
                                        <span className="text-blue-400 font-medium">+{formatCost(projection.stats.costBreakdown.allowance)}</span>
                                    </div>
                                )}
                                {projection.stats.costBreakdown.leave > 0 && (
                                    <div className="flex justify-between text-xs">
                                        <span className="text-white/60">Leave Loading</span>
                                        <span className="text-purple-400 font-medium">+{formatCost(projection.stats.costBreakdown.leave)}</span>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-white/10 flex justify-between text-sm font-bold">
                                    <span className="text-white">Total</span>
                                    <span className="text-white">{formatCost(projection.stats.estimatedCost)}</span>
                                </div>
                            </div>
                        </div>
                    </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">
          {eventGroups.map((group, groupIdx) => {
            const isCollapsed = collapsedEvents.has(group.eventId);
            const badgeVariant = getBadgeVariant(group);
            const badgeLabel = getBadgeLabel(group);
            const coveragePct = getCoveragePct(group);
            const eventExpanded = expandedEvents.has(group.eventId);
            const visibleShifts = eventExpanded ? group.shifts : group.shifts.slice(0, MAX_CARDS_PER_EVENT);

            return (
              <Card
                key={group.eventId}
                style={{ contentVisibility: 'auto' as any, containIntrinsicSize: 'auto 400px' }}
                className={cn(
                  'overflow-hidden border border-border bg-card',
                  group.eventId === '_no_event_' && 'border-dashed border-border/50'
                )}
              >
                {/* Event Header */}
                <button
                  onClick={() => toggleEventCollapse(group.eventId)}
                  className={cn(
                    'w-full px-5 py-4 flex items-start justify-between hover:bg-accent/50 transition-colors text-left border-t border-border',
                    group.eventId === '_no_event_' && 'bg-muted/30'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1 text-slate-500">
                      {isCollapsed
                        ? <ChevronRight className="h-4 w-4" />
                        : <ChevronDown className="h-4 w-4" />}
                    </div>
                    <div>
                      <h3 className="text-[13px] font-bold text-foreground tracking-[0.08em] uppercase">
                        {group.eventName}
                      </h3>
                      {/* Coverage LED bar + label */}
                      <div className="flex items-center gap-3 mt-1.5">
                        <EventCoverageBar pct={coveragePct} variant={badgeVariant} />
                        <span className="text-[10px] font-mono tracking-[0.12em] text-muted-foreground">
                          {group.assignedCount}/{group.shifts.length} filled
                        </span>
                      </div>
                      {group.eventDate && (
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-[0.1em]">
                          <Calendar className="h-3 w-3" />
                          {format(group.eventDate, 'MMM d, yyyy')}
                          {group.startTime && (
                            <span className="tabular-nums">· {group.startTime}–{group.endTime}</span>
                          )}
                          <span>· {group.location}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <div className="text-right text-[10px] font-mono text-muted-foreground tabular-nums">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Users className="h-3 w-3" />
                        <span>{group.assignedCount}/{group.shifts.length}</span>
                      </div>
                      <div>{group.totalHours.toFixed(1)}h</div>
                    </div>
                    <Badge
                      variant={badgeVariant}
                      className="text-[9px] tracking-[0.12em] uppercase font-mono px-2 py-0.5"
                    >
                      {badgeLabel}
                    </Badge>
                  </div>
                </button>

                {/* Shift grid (collapsible) */}
                {!isCollapsed && (
                  <div className="px-5 pb-5 pt-2 border-t border-border relative group/cell">
                    {group.unassignedCount > 0 && (
                      <div className="mb-3 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-md flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-red-400">
                          {group.unassignedCount} unfilled shift{group.unassignedCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {visibleShifts.map((shift, shiftIdx) => {
                        const { isPast, isLocked: isManagementLocked } = resolveShiftStatus(shift);
                        const isLocked = isManagementLocked || (isDnDModeActive && shift.lifecycle_status !== 'Published');

                        return (
                          <div
                            key={shift.id}
                            style={{ animationDelay: `calc(${shiftIdx} * 35ms)` }}
                            className="animate-[slideUpFade_0.2s_ease_forwards]"
                          >
                            <SmartShiftCard
                              shift={shift}
                              variant="compact"
                              groupColor={resolveGroupType(shift)}
                              compliance={complianceMap?.[shift.id]}
                              isLocked={isLocked}
                              isPast={isPast}
                              isDnDActive={isDnDModeActive}
                              showStatusIcons={true}
                              headerAction={buildShiftMenu(shift)}
                              detailedCost={(shift as any).detailedCost}
                              onClick={() => onEditShift?.(shift)}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {group.shifts.length > MAX_CARDS_PER_EVENT && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleEventExpanded(group.eventId); }}
                        className="relative z-10 mt-3 text-[11px] font-semibold text-primary/80 hover:text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-md px-3 py-1.5 transition-colors"
                      >
                        {eventExpanded ? 'Show fewer shifts' : `+${group.shifts.length - MAX_CARDS_PER_EVENT} more shift${group.shifts.length - MAX_CARDS_PER_EVENT !== 1 ? 's' : ''}`}
                      </button>
                    )}

                    {/* Unified Add Shift Button — Repositioned to corner if shifts exist */}
                    <div className={cn(
                      "absolute inset-0 flex pointer-events-none z-10",
                      group.shifts.length > 0 ? "items-end justify-end p-4" : "items-center justify-center pt-10"
                    )}>
                      <button
                        onClick={() => handleAddShiftClick(group)}
                        className={cn(
                          "flex items-center justify-center rounded-full transition-all duration-300 pointer-events-auto",
                          "bg-primary/30 text-primary border border-primary/40 backdrop-blur-md",
                          "hover:bg-primary/60 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(var(--primary),0.3)]",
                          group.shifts.length > 0 
                            ? "w-8 h-8 opacity-0 scale-75 group-hover/cell:opacity-100 group-hover/cell:scale-100" 
                            : "w-10 h-10 opacity-40 scale-90 hover:opacity-100",
                          "group/add"
                        )}
                        title="Add shift to event"
                      >
                        <Plus className={cn(
                          group.shifts.length > 0 ? "h-5 w-5" : "h-6 w-6",
                          "transition-transform group-hover/add:rotate-90"
                        )} />
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}

          {eventGroups.length === 0 && (
            <div className="text-center py-12 text-[10px] font-mono tracking-[0.12em] uppercase text-muted-foreground">
              No events or shifts for this period
            </div>
          )}
        </div>
      </ScrollArea>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="bg-popover border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Unpublish Shift</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This shift will be reverted to Draft and removed from all employee-facing surfaces immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-accent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmUnpublish}
              className="bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
