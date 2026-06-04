/**
 * DayTimelineView — vertical 15-min-grid timeline for Group Mode (Day view)
 * Replaces the flat card grid when viewType === 'day'.
 *
 * Stories implemented:
 *  S3  — Live current-time line with HH:MM label
 *  S6-9 — Subgroup add/rename/clone/delete via header dropdowns
 *  S12 — Top resize handle (adjusts start time)
 *  S15 — Faint subgroup name watermark inside grid
 *  S17 — Collapse/expand group columns
 *  S19 — Zoom prop (15 min / 30 min / 1 h) — controlled from outside
 *  S21 — Timeline extends to 23:59 (midnight)
 *  S22 — All groups shown; scroll if content exceeds width
 *  S23 — Full-width layout; columns expand to fill container
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import { DND_EMPLOYEE_TYPE, EmployeeDragItem } from './people-mode.types';
import { format, isToday, differenceInHours } from 'date-fns';
import { getSydneyNow, SYDNEY_TZ, parseZonedDateTime } from '@/modules/core/lib/date.utils';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { TemplateGroupType } from '@/modules/rosters/api/shifts.api';
import {
  Edit2, Trash2, Send, Undo2, MoreHorizontal,
  Plus, Copy, ChevronsLeft, ChevronsRight, Lock, Clock,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBulkPublishShifts,
  useBulkUnpublishShifts,
  useBulkDeleteShifts,
  snapshotLists,
  rollbackLists,
  patchLists,
} from '@/modules/rosters/state/useRosterShifts';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import type { RingColor } from '@/modules/rosters/domain/shift-ui';

function ringClasses(color: RingColor): string {
  switch (color) {
    case 'purple':  return 'ring-2 ring-purple-500  shadow-[0_0_15px_rgba(168,85,247,0.45)]';
    case 'emerald': return 'ring-2 ring-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.45)]';
    case 'yellow':  return 'ring-2 ring-yellow-500  shadow-[0_0_12px_rgba(234,179,8,0.40)]';
    case 'red':     return 'ring-2 ring-red-500     shadow-[0_0_15px_rgba(239,68,68,0.45)]';
    case 'orange':  return 'ring-2 ring-orange-500  shadow-[0_0_12px_rgba(249,115,22,0.35)]';
    case 'blue':
    default:        return 'ring-1 ring-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.20)]';
  }
}
import { getShiftUIContext } from '@/modules/rosters/domain/shift-ui';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/modules/core/ui/primitives/alert-dialog';
import { executeAssignShift } from '@/modules/rosters/domain/commands/assignShift.command';

// ─── Fixed layout constants ────────────────────────────────────────────────
const START_HOUR    = 0;            // 00:00
const END_HOUR      = 24;           // 24:00 (= midnight, covers 23:59)
const SNAP_MINS     = 15;
const TOTAL_MINS    = (END_HOUR - START_HOUR) * 60;   // 1080 min
const TIME_COL_W    = 60;           // px — time-axis column width
const MIN_SUBGROUP_W = 160;         // px — minimum subgroup lane width
const COLLAPSED_W   = 28;           // px — collapsed group column width

// ─── Pure helpers ─────────────────────────────────────────────────────────
const toMins   = (t: string)   => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMins = (m: number)   => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const snapTo   = (m: number)   => Math.round(m / SNAP_MINS) * SNAP_MINS;
const clamp    = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ─── Lane assignment ──────────────────────────────────────────────────────
interface LaneInfo { lane: number; total: number; }

function calcLanes(shifts: Array<{ id: string; startTime: string; endTime: string }>): Map<string, LaneInfo> {
  const sorted = [...shifts].sort((a, b) => toMins(a.startTime) - toMins(b.startTime));
  const laneEnds: number[] = [];
  const assigned: Array<{ id: string; lane: number; s: number; e: number }> = [];

  for (const sh of sorted) {
    const s = toMins(sh.startTime);
    let e = toMins(sh.endTime); if (e <= s) e += 1440;
    let lane = laneEnds.findIndex(end => s >= end);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); }
    else laneEnds[lane] = e;
    assigned.push({ id: sh.id, lane, s, e });
  }

  const result = new Map<string, LaneInfo>();
  for (const a of assigned) {
    let maxLane = 1;
    for (const b of assigned) {
      if (b.s < a.e && b.e > a.s) maxLane = Math.max(maxLane, b.lane + 1);
    }
    result.set(a.id, { lane: a.lane, total: maxLane });
  }
  return result;
}

// ─── Group-based card colours (light + dark mode) ─────────────────────────
// Matches the convention used in GroupModeView week/3-day shift cards.
const CARD_COLORS = {
  convention_centre: {
    bg:          'bg-blue-50 dark:bg-blue-900/20',
    border:      'border-blue-200 dark:border-blue-500/30',
    accentStrip: 'bg-blue-500',
    primaryText: 'text-blue-900 dark:text-blue-100',
    secondaryText:'text-blue-600 dark:text-blue-300',
  },
  exhibition_centre: {
    bg:          'bg-emerald-50 dark:bg-emerald-900/20',
    border:      'border-emerald-200 dark:border-emerald-500/30',
    accentStrip: 'bg-emerald-500',
    primaryText: 'text-emerald-900 dark:text-emerald-100',
    secondaryText:'text-emerald-600 dark:text-emerald-300',
  },
  theatre: {
    bg:          'bg-rose-50 dark:bg-rose-900/20',
    border:      'border-rose-200 dark:border-rose-500/30',
    accentStrip: 'bg-rose-500',
    primaryText: 'text-rose-900 dark:text-rose-100',
    secondaryText:'text-rose-600 dark:text-rose-300',
  },
  unassigned: {
    bg:          'bg-slate-50 dark:bg-slate-800/40',
    border:      'border-slate-200 dark:border-slate-500/30',
    accentStrip: 'bg-slate-400',
    primaryText: 'text-slate-800 dark:text-slate-100',
    secondaryText:'text-slate-500 dark:text-slate-300',
  },
} as const;
type CardColorKey = keyof typeof CARD_COLORS;
const cardColors = (groupType: string) =>
  CARD_COLORS[(groupType as CardColorKey) in CARD_COLORS ? (groupType as CardColorKey) : 'unassigned'];

// ─── Group accent config ──────────────────────────────────────────────────
const GROUP_ACCENT: Record<string, {
  headerBg: string; headerText: string; subText: string; dot: string; colBorder: string;
}> = {
  convention_centre: {
    headerBg: 'bg-blue-700', headerText: 'text-white',
    subText: 'text-blue-300', dot: 'bg-blue-400', colBorder: 'border-blue-500/30',
  },
  exhibition_centre: {
    headerBg: 'bg-emerald-700', headerText: 'text-white',
    subText: 'text-emerald-300', dot: 'bg-emerald-400', colBorder: 'border-emerald-500/30',
  },
  theatre: {
    headerBg: 'bg-rose-700', headerText: 'text-white',
    subText: 'text-rose-300', dot: 'bg-rose-400', colBorder: 'border-rose-500/30',
  },
  unassigned: {
    headerBg: 'bg-slate-700', headerText: 'text-white',
    subText: 'text-slate-300', dot: 'bg-slate-400', colBorder: 'border-slate-500/30',
  },
};
const accent = (type: string) => GROUP_ACCENT[type] ?? GROUP_ACCENT.unassigned;

// ─── Shared types ─────────────────────────────────────────────────────────
export interface DTShift {
  id: string;
  startTime: string;   // 'HH:mm'
  endTime: string;     // 'HH:mm'
  employeeName?: string;
  role: string;
  status: string;
  isPublished: boolean;
  isDraft: boolean;
  isLocked?: boolean;
  isCancelled: boolean;
  isOnBidding?: boolean;
  isUrgent?: boolean;
  isTrading?: boolean;
  groupColor: TemplateGroupType;
  subGroup?: string;
  assignedEmployeeId?: string | null;
  assignmentOutcome?: string;
  rawShift: any;
  assignmentStatus?: string;
  biddingStatus?: string;
  lifecycleStatus?: string;
}

export interface DTSubGroup {
  id: string;
  name: string;
  shifts: Record<string, DTShift[]>;  // dateKey → shifts
}

export interface DTGroup {
  id: string;
  name: string;
  type: TemplateGroupType | 'unassigned';
  color: string;
  subGroups: DTSubGroup[];
}

// ─── Props ────────────────────────────────────────────────────────────────
export interface DayTimelineViewProps {
  visualGroups: DTGroup[];
  selectedDate: Date;
  canEdit: boolean;
  isShiftsLoading?: boolean;
  isBulkMode?: boolean;
  isDnDModeActive?: boolean;
  selectedV8ShiftIds?: Set<string>;
  onBulkToggle?: (id: string) => void;
  complianceMap?: Record<string, any>;
  isBucketView?: boolean;
  /** Zoom level (px/hour scale). Controlled from outside via RosterFunctionBar. */
  zoom: 60;
  onSlotClick:       (group: DTGroup, subGroup: DTSubGroup, date: Date) => void;
  onShiftEdit:       (shift: DTShift, group: DTGroup, subGroup: DTSubGroup, date: Date, launchSource?: any) => void;
  onShiftDelete:     (shift: DTShift) => void;
  onShiftPublish:    (shift: DTShift) => void;
  onShiftUnpublish:  (shift: DTShift) => void;
  onShiftClone:      (shift: DTShift) => void;

  onAddSubGroup?:    (group: DTGroup) => void;
  onSubGroupAction?: (action: 'rename' | 'clone' | 'delete', subGroup: DTSubGroup, group: DTGroup) => void;
  onEmployeeDrop?:   (shiftId: string, dragItem: EmployeeDragItem) => void;
}

// ─── DroppableShiftAssign ─────────────────────────────────────────────────
interface DroppableShiftAssignProps {
  shiftId: string;
  shiftRole: string;
  canAccept: boolean;
  onAssign: (shiftId: string, dragItem: EmployeeDragItem) => void;
  children: React.ReactNode;
}

const DroppableShiftAssign: React.FC<DroppableShiftAssignProps> = ({
  shiftId, shiftRole, canAccept, onAssign, children,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop<EmployeeDragItem, void, { isOver: boolean; canDrop: boolean }>(
    () => ({
      accept: DND_EMPLOYEE_TYPE,
      canDrop: (item: EmployeeDragItem) =>
        canAccept && (!item.roleName || item.roleName === shiftRole),
      drop: (item: EmployeeDragItem) => { onAssign(shiftId, item); },
      collect: (monitor) => ({ isOver: monitor.isOver(), canDrop: monitor.canDrop() }),
    }),
    [shiftId, shiftRole, canAccept, onAssign],
  );
  return (
    <div
      ref={drop}
      className={cn(
        isOver && canDrop  && 'ring-2 ring-emerald-400 ring-inset rounded-lg bg-emerald-500/5',
        isOver && !canDrop && 'ring-2 ring-red-400 ring-inset rounded-lg opacity-60',
      )}
    >
      {children}
    </div>
  );
};

// ─── DayTimelineView ─────────────────────────────────────────────────────
const DayTimelineView: React.FC<DayTimelineViewProps> = ({
  visualGroups, selectedDate, canEdit, isShiftsLoading,
  isBulkMode, isDnDModeActive, selectedV8ShiftIds, onBulkToggle,
  isBucketView,
  zoom,
  onSlotClick, onShiftEdit, onShiftDelete, onShiftPublish, onShiftUnpublish, onShiftClone,
  onAddSubGroup, onSubGroupAction, onEmployeeDrop,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const bulkPublish = useBulkPublishShifts();
  const bulkDelete  = useBulkDeleteShifts();
  const bulkUnpublish = useBulkUnpublishShifts();
  const dateKey     = format(selectedDate, 'yyyy-MM-dd');
  const todayDate   = isToday(selectedDate);

  // ── S26/27: Bulk Action State ──────────────────────────────
  const [pendingBulkAction, setPendingBulkAction] = useState<{
    type: 'publish' | 'delete' | 'unpublish' | 'resize';
    bucketKey?: string;
    shiftIds: string[];
    count: number;
    timeRange: string;
    newTimes?: { start: string; end: string };
  } | null>(null);

  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // S2ComplianceRerunModal removed — all timing changes now flow through
  // executeAssignShift which runs the full V2 compliance engine.

  const handleExecuteBulkAction = async () => {
    if (!pendingBulkAction) return;
    setIsBulkProcessing(true);
    try {
      if (pendingBulkAction.type === 'publish') {
        await bulkPublish.mutateAsync(pendingBulkAction.shiftIds);
      } else if (pendingBulkAction.type === 'unpublish') {
        await bulkUnpublish.mutateAsync(pendingBulkAction.shiftIds);
      } else if (pendingBulkAction.type === 'delete') {
        await bulkDelete.mutateAsync(pendingBulkAction.shiftIds);
      } else if (pendingBulkAction.type === 'resize' && pendingBulkAction.newTimes) {
        // Compliance-gated resize: route each shift through the domain command
        // so that R02 (min duration) and R08 (meal break) are enforced.
        let blocked = false;
        for (const sid of pendingBulkAction.shiftIds) {
          const result = await executeAssignShift({
            shiftId: sid,
            employeeId: undefined as any,   // preserve current assignment
            targetStartTime: pendingBulkAction.newTimes.start,
            targetEndTime:   pendingBulkAction.newTimes.end,
          });
          if (!result.success) {
            toast({
              title: 'Resize Blocked',
              description: result.error ?? 'Compliance check failed for one or more shifts.',
              variant: 'destructive',
            });
            blocked = true;
            break;
          }
        }
        if (blocked) {
          setPendingBulkAction(null);
          return;
        }
      }
      setPendingBulkAction(null);
    } catch (err) {
      console.error('[DayTimeline] Bulk action failed', err);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // ── Zoom-derived layout values (Fixed to 1H zoom) ──────────
  const hourH    = 40;
  const minPx    = hourH / 60;
  const minCardH = SNAP_MINS * minPx;
  const timelineH = TOTAL_MINS * minPx;

  // ── S17: Collapse state ───────────────────────────────────
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── S3: Current time ─────────────────────────────────────
  const [nowState, setNowState] = useState<{ mins: number; label: string } | null>(null);
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowState({ mins: n.getHours() * 60 + n.getMinutes(), label: format(n, 'HH:mm') });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const nowTop = useMemo(() => {
    if (!todayDate || !nowState) return null;
    const rel = nowState.mins - START_HOUR * 60;
    if (rel < 0 || rel > TOTAL_MINS) return null;
    return rel * minPx;
  }, [todayDate, nowState, minPx]);

  // ── S23: Measure container for full-width layout ──────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerW(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── S12: Drag/resize state ────────────────────────────────
  interface Drag {
    type: 'move' | 'resize' | 'resize-top';
    shiftId?: string;
    bucketKey?: string;
    targetV8ShiftIds?: string[];
    pointerY: number;
    origS: number; origE: number;
    previewS: number; previewE: number;
  }
  const [drag, setDrag] = useState<Drag | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag) return;
    const dy   = e.clientY - drag.pointerY;
    const dMin = dy / minPx;
    
    // Bounds for resizing (3 hours = 180 mins, 12 hours = 720 mins)
    const MIN_DUR = 180;
    const MAX_DUR = 720;

    if (drag.type === 'move') {
      const dur = drag.origE - drag.origS;
      const newS = snapTo(clamp(drag.origS + dMin, START_HOUR * 60, END_HOUR * 60 - dur));
      setDrag(d => d ? { ...d, previewS: newS, previewE: newS + dur } : d);
    } else if (drag.type === 'resize') {
      // Enforce max duration from origS, and min duration from origS
      const maxE = drag.origS + MAX_DUR;
      const minE = drag.origS + MIN_DUR;
      const newE = snapTo(clamp(drag.origE + dMin, minE, Math.min(END_HOUR * 60, maxE)));
      setDrag(d => d ? { ...d, previewE: newE } : d);
    } else {
      // Enforce max duration from origE, and min duration from origE
      const minS = drag.origE - MAX_DUR;
      const maxS = drag.origE - MIN_DUR;
      const newS = snapTo(clamp(drag.origS + dMin, Math.max(START_HOUR * 60, minS), maxS));
      setDrag(d => d ? { ...d, previewS: newS } : d);
    }
  }, [drag, minPx]);

  const onPointerUp = useCallback(async () => {
    if (!drag) return;
    const prev = drag; setDrag(null);
    const ns = fromMins(snapTo(prev.previewS));
    const ne = fromMins(snapTo(prev.previewE));

    // [Validation] Prevent moving/resizing into the past
    const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
    const now = getSydneyNow();
    const newStartAt = parseZonedDateTime(selectedDateStr, ns, SYDNEY_TZ);

    if (newStartAt < now) {
      toast({
        title: 'Action Blocked',
        description: 'Shifts cannot start in the past. This action has been reverted.',
        variant: 'destructive',
      });
      return;
    }

    if (ns !== fromMins(prev.origS) || ne !== fromMins(prev.origE)) {
      if (!prev.shiftId) return;

      // ── Optimistic update: patch the cache IMMEDIATELY so the UI
      //    reflects the new position without waiting for the server. ──
      const snapshot = snapshotLists(queryClient);
      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === prev.shiftId
            ? { ...s, start_time: ns, end_time: ne }
            : s,
        ),
      );

      try {
        // Unified compliance-gated path: ALL timing changes (move & resize)
        // for both assigned and unassigned shifts flow through executeAssignShift.
        // - Assigned shifts: full V2 compliance (all 12 rules incl. R01 overlap)
        // - Unassigned shifts: skeleton compliance (R02 min duration, R08 meal break)
        const result = await executeAssignShift({
          shiftId: prev.shiftId,
          employeeId: undefined as any,   // preserve current assignment
          targetStartTime: ns,
          targetEndTime:   ne,
        });

        if (!result.success) {
          // ── Rollback: compliance rejected the move ──
          rollbackLists(queryClient, snapshot);
          toast({
            title: 'Timing Change Blocked',
            description: result.error ?? 'Compliance check failed.',
            variant: 'destructive',
          });
          return;
        }

        // Surface advisory warnings (non-blocking)
        if (result.advisories && result.advisories.length > 0) {
          toast({
            title: 'Shift Updated (with warnings)',
            description: result.advisories[0],
          });
        }
      } catch (err) {
        // ── Rollback: network / unexpected error ──
        rollbackLists(queryClient, snapshot);
        console.error('[DayTimeline] Time update failed', err);
        toast({
          title: 'Update Failed',
          description: 'An unexpected error occurred.',
          variant: 'destructive',
        });
      } finally {
        // Always reconcile with the server to pick up any side-effects
        queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
        if (prev.shiftId) {
          queryClient.invalidateQueries({ queryKey: shiftKeys.detail(prev.shiftId) });
        }
      }
    }
  }, [drag, selectedDate, toast, visualGroups, dateKey, queryClient]);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [drag, onPointerMove, onPointerUp]);

  // ── Time grid rows ────────────────────────────────────────
  const timeRows = useMemo(() => {
    const rows: Array<{ label: string | null; major: boolean; top: number }> = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      for (let q = 0; q < 4; q++) {
        rows.push({
          label: q === 0 ? `${String(h % 24).padStart(2, '0')}:00` : null,
          major: q === 0,
          top: ((h - START_HOUR) * 60 + q * SNAP_MINS) * minPx,
        });
      }
    }
    // Final tick = midnight
    rows.push({ label: '00:00', major: true, top: TOTAL_MINS * minPx });
    return rows;
  }, [minPx]);

  // ── Visible subgroups ─────────────────────────────────────
  const visibleGroups = useMemo(() =>
    visualGroups.map(g => ({
      ...g,
      subGroups: g.subGroups.filter(sg => (sg.shifts[dateKey]?.length ?? 0) > 0 || canEdit),
    })).filter(g => g.subGroups.length > 0),
  [visualGroups, dateKey, canEdit]);

  // ── S23: Dynamic subgroup width ───────────────────────────
  const subgroupW = useMemo(() => {
    if (!containerW) return MIN_SUBGROUP_W;
    const activeSubs = visibleGroups.reduce((a, g) =>
      a + (collapsedGroups.has(g.id) ? 0 : g.subGroups.length), 0);
    if (activeSubs === 0) return MIN_SUBGROUP_W;
    const available = containerW - TIME_COL_W;
    return Math.max(MIN_SUBGROUP_W, available / activeSubs);
  }, [containerW, visibleGroups, collapsedGroups]);

  // ── Total col width ───────────────────────────────────────
  const totalColWidth = useMemo(() =>
    visibleGroups.reduce((a, g) =>
      a + (collapsedGroups.has(g.id) ? COLLAPSED_W : g.subGroups.length * subgroupW), 0),
  [visibleGroups, collapsedGroups, subgroupW]);

  // ─────────────────────────────────────────────────────────
  if (isShiftsLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm animate-pulse">
        Loading timeline…
      </div>
    );
  }

  const GROUP_HEADER_H  = 32;
  const SUBGRP_HEADER_H = 28;
  const HEADER_TOTAL    = GROUP_HEADER_H + SUBGRP_HEADER_H;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* ── Single scroll container ───────────────────────── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto relative">
        {/* Inner wrapper: auto-expand to fill container or to fit content */}
        <div style={{ minWidth: TIME_COL_W + totalColWidth, width: '100%' }}>

          {/* Sticky column headers */}
          <div className="sticky top-0 z-30 flex bg-background border-b border-border" style={{ height: HEADER_TOTAL }}>

            {/* Time-axis gutter */}
            <div
              className="flex-shrink-0 border-r border-border bg-background"
              style={{ width: TIME_COL_W, height: HEADER_TOTAL }}
            />

            {/* Group + subgroup headers */}
            {visibleGroups.map(g => {
              const ac = accent(g.type);
              const isCollapsed = collapsedGroups.has(g.id);
              const colWidth = isCollapsed ? COLLAPSED_W : g.subGroups.length * subgroupW;

              return (
                <div key={g.id} className={cn('border-r flex-shrink-0', ac.colBorder)} style={{ width: colWidth }}>
                  {isCollapsed ? (
                    <div
                      className={cn('flex flex-col items-center justify-center gap-1 cursor-pointer select-none', ac.headerBg)}
                      style={{ height: HEADER_TOTAL }}
                      onClick={() => toggleCollapse(g.id)}
                      title={`Expand ${g.name}`}
                    >
                      <ChevronsRight className="w-3 h-3 text-white/60 flex-shrink-0" />
                      <span
                        className={cn('text-[9px] font-bold tracking-widest uppercase', ac.headerText)}
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: HEADER_TOTAL - 20 }}
                      >
                        {g.name}
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* Group row */}
                      <div
                        className={cn('flex items-center gap-1.5 px-2', ac.headerBg)}
                        style={{ height: GROUP_HEADER_H }}
                      >
                        <div className="w-2 h-2 rounded-full bg-white/80 flex-shrink-0" />
                        <span className={cn('text-xs font-bold tracking-wide truncate', ac.headerText)}>
                          {g.name}
                        </span>
                        <span className="text-[10px] text-white/50 font-mono flex-shrink-0">
                          {g.subGroups.reduce((a, sg) => a + (sg.shifts[dateKey]?.length ?? 0), 0)}
                        </span>
                        <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">
                          {canEdit && (
                            <button
                              className="p-0.5 rounded hover:bg-white/20 transition-colors"
                              title="Add subgroup"
                              onClick={(e) => { e.stopPropagation(); onAddSubGroup?.(g); }}
                            >
                              <Plus className="w-3 h-3 text-white/70" />
                            </button>
                          )}
                          <button
                            className="p-0.5 rounded hover:bg-white/20 transition-colors"
                            title="Collapse group"
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(g.id); }}
                          >
                            <ChevronsLeft className="w-3 h-3 text-white/70" />
                          </button>
                        </div>
                      </div>

                      {/* Subgroup row */}
                      <div className="flex" style={{ height: SUBGRP_HEADER_H }}>
                        {g.subGroups.map(sg => (
                          <div
                            key={sg.id}
                            style={{ width: subgroupW }}
                            className="flex items-center gap-1 px-1.5 border-r border-border/30 bg-muted/30 overflow-hidden flex-shrink-0"
                          >
                            <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ac.dot)} />
                            <span className={cn('text-[11px] font-semibold truncate flex-1 min-w-0', ac.subText)}>
                              {sg.name}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                              {sg.shifts[dateKey]?.length ?? 0}
                            </span>
                            {canEdit && (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <button
                                  className="p-0.5 rounded hover:bg-white/10 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSlotClick(g, sg, selectedDate);
                                  }}
                                  title="Add Shift"
                                >
                                  <Plus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                                </button>
                                <DropdownMenu modal={false}>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      className="p-0.5 rounded hover:bg-white/10 transition-colors"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <MoreHorizontal className="w-3 h-3 text-muted-foreground" />
                                    </button>
                                  </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-40"
                                  onClick={e => e.stopPropagation()}
                                  onPointerDown={e => e.stopPropagation()}
                                >
                                  <DropdownMenuItem onSelect={() => onSubGroupAction?.('rename', sg, g)} className="cursor-pointer">
                                    <Edit2 className="h-3.5 w-3.5 mr-2" /> Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => onSubGroupAction?.('clone', sg, g)} className="cursor-pointer">
                                    <Copy className="h-3.5 w-3.5 mr-2" /> Clone
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive cursor-pointer"
                                    onSelect={() => onSubGroupAction?.('delete', sg, g)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Timeline body */}
          <div className="flex relative" style={{ height: timelineH }}>

            {/* Sticky time axis */}
            <div
              className="sticky left-0 z-20 flex-shrink-0 bg-background border-r border-border"
              style={{ width: TIME_COL_W }}
            >
              {timeRows.map((row, i) => (
                <div
                  key={i}
                  className="absolute right-0 flex items-start justify-end pr-2"
                  style={{ top: row.top, height: SNAP_MINS * minPx }}
                >
                  {row.label && (
                    <span className={cn(
                      'text-[10px] font-mono leading-none select-none',
                      row.major ? 'text-muted-foreground' : 'text-muted-foreground/30',
                    )}>
                      {row.label}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Group columns */}
            {visibleGroups.map(g => {
              const ac = accent(g.type);
              const isCollapsed = collapsedGroups.has(g.id);

              if (isCollapsed) {
                return (
                  <div
                    key={g.id}
                    className={cn(
                      'flex-shrink-0 border-r cursor-pointer transition-opacity hover:opacity-70',
                      ac.colBorder, ac.headerBg, 'opacity-40',
                    )}
                    style={{ width: COLLAPSED_W, height: timelineH }}
                    onClick={() => toggleCollapse(g.id)}
                    title={`Expand ${g.name}`}
                  />
                );
              }

              return (
                <div key={g.id} className={cn('flex border-r flex-shrink-0', ac.colBorder)}>
                  {g.subGroups.map(sg => {
                    const dayShifts = sg.shifts[dateKey] ?? [];
                    const lanes = calcLanes(dayShifts);

                    return (
                      <div
                        key={sg.id}
                        className="relative border-r border-border/20 flex-shrink-0"
                        style={{ width: subgroupW, height: timelineH }}
                      >
                        {/* Grid lines */}
                        {timeRows.map((row, i) => (
                          <div
                            key={i}
                            className={cn(
                              'absolute left-0 right-0 pointer-events-none',
                              row.major ? 'border-t border-border/40' : 'border-t border-border/15',
                            )}
                            style={{ top: row.top }}
                          />
                        ))}

                        {/* Alternating hour shading */}
                        {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                          i % 2 === 1 && (
                            <div
                              key={i}
                              className="absolute left-0 right-0 bg-white/[0.015] pointer-events-none"
                              style={{ top: i * hourH, height: hourH }}
                            />
                          )
                        ))}

                        {/* S15: Faint subgroup name watermark */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden select-none">
                          <span
                            className="text-[11px] font-bold tracking-[0.18em] uppercase text-muted-foreground/[0.08]"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                          >
                            {sg.name}
                          </span>
                        </div>


                        {/* Shift cards */}
                        {dayShifts.map(sh => {
                          const isDragging = drag?.shiftId === sh.id;
                          const dispS = isDragging ? drag!.previewS : toMins(sh.startTime);
                          const dispE = isDragging
                            ? drag!.previewE
                            : (() => { let e = toMins(sh.endTime); if (e <= dispS) e += 1440; return e; })();
                          const top  = (dispS - START_HOUR * 60) * minPx;
                          const ht   = Math.max(minCardH, (dispE - dispS) * minPx);
                          const lane = lanes.get(sh.id) ?? { lane: 0, total: 1 };
                          const pad  = 3;
                          const laneW = (subgroupW - pad * 2) / lane.total;
                          const left  = pad + lane.lane * laneW;
                          const cc    = cardColors(sh.groupColor);

                          const canAcceptDrop = !!onEmployeeDrop && sh.isDraft && !sh.isLocked && !sh.isCancelled;
                          const card = (
                            <ShiftCard
                              key={sh.id}
                              shift={sh}
                              top={top}
                              left={left}
                              width={laneW - 2}
                              height={ht}
                              cardColor={cc}
                              group={g}
                              subGroup={sg}
                              selectedDate={selectedDate}
                              canEdit={canEdit}
                              isBulkMode={!!isBulkMode}
                              isDnDModeActive={!!isDnDModeActive}
                              isSelected={!!selectedV8ShiftIds?.has(sh.id)}
                              isDragging={isDragging}
                              onBulkToggle={onBulkToggle}
                              onEdit={onShiftEdit}
                              onDelete={onShiftDelete}
                              onPublish={onShiftPublish}
                              onUnpublish={onShiftUnpublish}
                              onClone={onShiftClone}

                              onDragStart={(id, y) => {
                                const s = toMins(sh.startTime);
                                let e = toMins(sh.endTime); if (e <= s) e += 1440;
                                setDrag({ type: 'move', shiftId: id, pointerY: y, origS: s, origE: e, previewS: s, previewE: e });
                              }}
                              onResizeStart={(id, y) => {
                                const s = toMins(sh.startTime);
                                let e = toMins(sh.endTime); if (e <= s) e += 1440;
                                setDrag({ type: 'resize', shiftId: id, pointerY: y, origS: s, origE: e, previewS: s, previewE: e });
                              }}
                              onResizeTopStart={(id, y) => {
                                const s = toMins(sh.startTime);
                                let e = toMins(sh.endTime); if (e <= s) e += 1440;
                                setDrag({ type: 'resize-top', shiftId: id, pointerY: y, origS: s, origE: e, previewS: s, previewE: e });
                              }}
                            />
                          );
                          return canAcceptDrop ? (
                            <DroppableShiftAssign
                              key={sh.id}
                              shiftId={sh.id}
                              shiftRole={sh.role}
                              canAccept={true}
                              onAssign={onEmployeeDrop!}
                            >
                              {card}
                            </DroppableShiftAssign>
                          ) : card;
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* S3: Current-time overlay — label + red dot + dashed line */}
            {nowTop !== null && (
              <div
                className="absolute left-0 right-0 flex items-center z-20 pointer-events-none"
                style={{ top: nowTop }}
              >
                <div className="sticky left-0 flex items-center justify-end gap-1 pr-1" style={{ width: TIME_COL_W }}>
                  <span className="text-[9px] font-mono text-red-400 tabular-nums leading-none">
                    {nowState?.label}
                  </span>
                  <div className="w-2 h-2 rounded-full bg-red-500 shadow-lg shadow-red-500/50 flex-shrink-0" />
                </div>
                <div className="flex-1 border-t-[1.5px] border-red-500/70" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── S26/27: Bulk Confirmation Dialog ── */}
      <AlertDialog open={!!pendingBulkAction} onOpenChange={(open) => !open && setPendingBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingBulkAction?.type === 'publish' ? 'Publish Shifts?' : 
               pendingBulkAction?.type === 'resize' ? 'Change Shift Timings?' : 'Delete Shifts?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBulkAction?.type === 'publish'
                ? `This will publish ${pendingBulkAction?.count ?? 0} draft shifts in the ${pendingBulkAction?.timeRange ?? ''} bucket. Are you sure?`
                : pendingBulkAction?.type === 'resize'
                ? `Are you sure you wanna change the shift timings? This will update all ${pendingBulkAction?.count ?? 0} shifts in the bucket.`
                : `This will permanently delete all ${pendingBulkAction?.count ?? 0} shifts in the ${pendingBulkAction?.timeRange ?? ''} bucket. This action cannot be undone.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkProcessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleExecuteBulkAction(); }}
              disabled={isBulkProcessing}
              className={pendingBulkAction?.type === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}
            >
              {isBulkProcessing ? 'Processing...' : 
               pendingBulkAction?.type === 'publish' ? 'Publish All' : 
               pendingBulkAction?.type === 'resize' ? 'Confirm Resize' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* S2ComplianceRerunModal removed — timing changes now go through
          executeAssignShift's compliance-gated pipeline (blocking toast UX) */}
    </div>
  );
};


// ─── ShiftCard ────────────────────────────────────────────────────────────
interface ShiftCardProps {
  shift: DTShift;
  top: number; left: number; width: number; height: number;
  cardColor: ReturnType<typeof cardColors>;
  group: DTGroup; subGroup: DTSubGroup; selectedDate: Date;
  canEdit: boolean; isBulkMode: boolean; isDnDModeActive: boolean; isSelected: boolean; isDragging: boolean;
  onBulkToggle?: (id: string) => void;
  onEdit:           (shift: DTShift, group: DTGroup, subGroup: DTSubGroup, date: Date, launchSource?: any) => void;
  onDelete:         (shift: DTShift) => void;
  onPublish:        (shift: DTShift) => void;
  onUnpublish:      (shift: DTShift) => void;
  onClone:          (shift: DTShift) => void;

  onDragStart:      (id: string, y: number) => void;
  onResizeStart:    (id: string, y: number) => void;
  onResizeTopStart: (id: string, y: number) => void;
}

const ShiftCard: React.FC<ShiftCardProps> = ({
  shift, top, left, width, height,
  cardColor: cc, group, subGroup, selectedDate,
  canEdit, isBulkMode, isDnDModeActive, isSelected, isDragging,
  onBulkToggle, onEdit, onDelete, onPublish, onUnpublish, onClone,
  onDragStart, onResizeStart, onResizeTopStart,
}) => {
  const compact = height < 80;
  const micro   = height < 30;

  const stateId = useMemo(() => determineShiftState(shift.rawShift), [shift.rawShift]);

  const ctx = useMemo(() => getShiftUIContext({
    lifecycle_status:   shift.rawShift.lifecycle_status  ?? 'Draft',
    assignment_status:  shift.rawShift.assignment_status ?? 'unassigned',
    assignment_outcome: shift.rawShift.assignment_outcome ?? null,
    trading_status:     shift.rawShift.trading_status    ?? null,
    is_cancelled:       shift.rawShift.is_cancelled      ?? false,
    scheduled_start:    shift.rawShift.scheduled_start   ?? null,
    scheduled_end:      shift.rawShift.scheduled_end     ?? null,
    actual_start:       shift.rawShift.actual_start      ?? null,
    emergency_source:   (shift.rawShift as any).emergency_source ?? null,
  }), [shift.rawShift]);

  return (
    <div
      data-shift-card="true"
      className={cn(
        'absolute rounded-lg border overflow-hidden select-none group/card flex flex-col',
        'transition-all duration-200 bg-card/95 backdrop-blur-[2px]',
        cc.border,
        // RING COLOR (priority: Completed > InProgress > Late > Emergent > Urgent > Normal)
        ringClasses(ctx.ringColor),

        isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background z-30',
        isDragging && 'opacity-50 scale-95 z-50 shadow-2xl bg-slate-100 dark:bg-slate-800',
        shift.isCancelled && 'opacity-40 grayscale',
        !isDragging && 'hover:shadow-lg hover:z-20',
      )}
      style={{
        top, left, width, height,
        position: 'absolute',
        cursor: isDragging ? 'grabbing' : (canEdit && !shift.isLocked && !shift.isPublished && isDnDModeActive) ? 'grab' : 'pointer',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        // Prevent drag if: not editable, bulk mode, published/started, or explicitly locked
        // Added isDnDModeActive check for consistency with other views
        if (!canEdit || isBulkMode || shift.isPublished || shift.isLocked || !isDnDModeActive) return;
        if ((e.target as HTMLElement).closest('[data-resize]')) return;
        if ((e.target as HTMLElement).closest('[data-menu-trigger]')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.stopPropagation();
        onDragStart(shift.id, e.clientY);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isBulkMode) onBulkToggle?.(shift.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (canEdit && !shift.isLocked && !shift.isPublished) onEdit(shift, group, subGroup, selectedDate);
      }}
    >
      {/* S12: Top resize handle */}
      {canEdit && !isBulkMode && !shift.isLocked && !shift.isPublished && isDnDModeActive && height > 20 && (
        <div
          data-resize="true"
          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-black/10 dark:hover:bg-white/20 transition-colors z-20"
          onPointerDown={(e) => {
            if (shift.isPublished || shift.isLocked || !isDnDModeActive) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            onResizeTopStart(shift.id, e.clientY);
          }}
        />
      )}

      {micro ? (
        // Micro variant: Minimal name + time
        <div className="h-full flex items-center px-1 gap-1.5 min-w-0">
          <div className={cn('w-1 h-full shrink-0 rounded-full', cc.accentStrip)} />
          <span className={cn('text-[10px] font-bold truncate flex-1', cc.primaryText)}>
             {shift.employeeName ?? 'Unassigned'}
          </span>
          <span className="text-[9px] font-mono opacity-60 shrink-0">
            {shift.startTime}
          </span>
        </div>
      ) : (
        <>
          <div className={cn(
            'px-2 py-1 flex justify-between items-center shrink-0 h-7',
            cc.bg, cc.primaryText
          )}>
            <div className="flex items-center gap-1.5 min-w-0">
               <span className={cn(
                 "text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none shrink-0",
                 "bg-black/10 dark:bg-black/30"
               )}>
                 {stateId}
               </span>
               <span className="text-[10px] font-bold uppercase tracking-wider truncate opacity-90">
                 {subGroup.name}
               </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {shift.isLocked && (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center bg-amber-500/20 rounded p-0.5">
                        <Lock className="h-3 w-3 text-amber-500" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="bg-amber-600 text-white border-none py-1 px-2">
                       <p className="text-[10px] font-medium">Shift Started & Locked (Read-Only)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {canEdit && !isBulkMode && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                    <button
                      data-menu-trigger="true"
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-black/10 transition-colors"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                    {shift.isDraft && !shift.isLocked && (
                      <DropdownMenuItem onSelect={() => onEdit(shift, group, subGroup, selectedDate)} className="cursor-pointer">
                        <Edit2 className="mr-2 h-4 w-4" /> Edit Shift
                      </DropdownMenuItem>
                    )}
                    {shift.isDraft && !shift.isPublished && (() => {
                      const shiftStart = new Date(shift.rawShift.start_at || `${shift.rawShift.shift_date}T${shift.rawShift.start_time}`);
                      const now = getSydneyNow();
                      const hoursToStart = differenceInHours(shiftStart, now);
                      const isEmergencyPub = hoursToStart < 4;
                      const isUnassigned = !shift.rawShift.assigned_employee_id || shift.rawShift.assignment_status === 'unassigned';
                      
                      return (
                        <DropdownMenuItem 
                          disabled={isEmergencyPub && isUnassigned}
                          onSelect={() => onPublish(shift)} 
                          className={cn(
                            "text-emerald-600 dark:text-emerald-400 cursor-pointer",
                            isEmergencyPub && isUnassigned && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <Send className="mr-2 h-4 w-4" /> 
                          {isEmergencyPub && isUnassigned ? 'Publish (Assign Required)' : 'Publish Shift'}
                        </DropdownMenuItem>
                      );
                    })()}
                    
                    {shift.isPublished && (
                      <DropdownMenuItem onSelect={() => onUnpublish(shift)} className="text-amber-600 dark:text-amber-400 cursor-pointer">
                        <Undo2 className="mr-2 h-4 w-4" /> Unpublish Shift
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem onSelect={() => onClone(shift)} className="text-popover-foreground hover:bg-accent cursor-pointer">
                      <Plus className="mr-2 h-4 w-4" /> Clone Shift
                    </DropdownMenuItem>

                    <DropdownMenuItem onSelect={() => onDelete(shift)} className="text-red-600 dark:text-red-400 cursor-pointer">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Shift
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="px-2 py-2 flex flex-col gap-1.5 flex-1 min-w-0 justify-center">
             <div className="text-xs font-bold text-foreground text-center truncate">
               {shift.employeeName ?? <span className="text-muted-foreground/60 italic font-medium">Unassigned</span>}
             </div>

             {!compact && (
               <div className="flex justify-center">
                 <div className="bg-muted dark:bg-slate-800/80 rounded-full px-2 py-0.5 flex items-center gap-1.5 text-[10px]">
                   <Clock className="h-3 w-3 text-muted-foreground" />
                   <span className="font-mono font-medium">
                     {shift.startTime} – {shift.endTime}
                   </span>
                 </div>
               </div>
             )}
          </div>

        </>
      )}

      {/* Resize Bottom Handle */}
      {canEdit && !isBulkMode && !shift.isLocked && !shift.isPublished && isDnDModeActive && height > 20 && (
        <div
          data-resize="true"
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-black/10 dark:hover:bg-white/20 transition-colors z-20"
          onPointerDown={(e) => {
            if (shift.isPublished || shift.isLocked || !isDnDModeActive) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            onResizeStart(shift.id, e.clientY);
          }}
        />
      )}
    </div>
  );
};


export default DayTimelineView;
