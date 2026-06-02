/**
 * AttendancePage
 *
 * Two tabs:
 *  - Today  → live Clock In / Clock Out actions for today's shifts
 *  - Logs   → D / 3D / W / M attendance history, calendar picker, filters, totals
 */

import React, { useEffect, useState, useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  format, parseISO, differenceInMinutes, isToday,
} from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  Fingerprint, MapPin, Loader2, UserX, LogIn, LogOut,
  CheckCircle, Timer,
  BarChart3, Filter, ArrowUp, ArrowDown, XCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { CustomDateRangePicker } from '@/modules/core/ui/components/CustomDateRangePicker';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/realtime/client';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { useClockIn, useClockOut } from '@/modules/rosters/state/useClockInOut';
import { useSettings } from '@/modules/settings/hooks/useSettings';
import { TimesheetMobileCard } from '@/modules/timesheets/ui/components/TimesheetMobileCard';
import type { TimesheetRow } from '@/modules/timesheets/model/timesheet.types';
import { snapToQuarterHour } from '@/modules/timesheets/api/timesheets.supabase.api';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import type { Shift, AttendanceStatus } from '@/modules/rosters/domain/shift.entity';
import {
  captureGPS,
  analyzeGPS,
  formatDistance,
  confidenceColor,
  flagLabel,
  type GPSCapture,
  type GPSAnalysis,
} from '@/modules/rosters/utils/gps';

import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { UnifiedModuleFunctionBar } from '@/modules/core/ui/components/UnifiedModuleFunctionBar';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { TimesheetRow as TimesheetRowComponent } from '@/modules/timesheets/ui/components/TimesheetRow';
import { TimesheetTable } from '@/modules/timesheets/ui/components/TimesheetTable';

// ── Motion variants ────────────────────────────────────────────────────────────

const pageVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { ease: [0.16, 1, 0.3, 1], duration: 0.4 } },
};

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'checked_in' | 'late' | 'no_show' | 'unknown';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMs(shift: Shift, type: 'start' | 'end'): number {
  if (type === 'start') {
    // Always prefer local string combination as it is the direct user input.
    // UTC fields (start_at) are secondary and may be stale after an edit.
    return new Date(`${shift.shift_date}T${shift.start_time}`).getTime();
  }

  // Handle end time with overnight support
  const end = new Date(`${shift.shift_date}T${shift.end_time}`);
  if (shift.is_overnight) {
    end.setDate(end.getDate() + 1);
  }
  return end.getTime();
}

function formatHM(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0m';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Shift timing ──────────────────────────────────────────────────────────────

type ShiftTiming = 'before_window' | 'in_window' | 'window_closed' | 'completed';

function getShiftTiming(shift: Shift, now: Date): ShiftTiming {
  // Always derive start/end from shift_date + start_time/end_time (local strings)
  // so stale start_at/end_at UTC values after edits never affect window logic.
  const startMs    = toMs(shift, 'start');
  const endMs      = toMs(shift, 'end');
  const windowOpen = startMs - 60 * 60 * 1000;          // 1 h before start
  const windowClose = startMs + 12.5 * 60 * 60 * 1000; // 12.5 h after start
  const nowMs      = now.getTime();
  if (nowMs > endMs)        return 'completed';
  if (nowMs > windowClose)  return 'window_closed';
  if (nowMs >= windowOpen)  return 'in_window';
  return 'before_window';
}

// ── Unified Attendance Card (combines history + live clocking) ───────────────

interface AttendanceCardProps {
  shift: Shift;
  now: Date;
  useGroupColoring?: boolean;
}

const AttendanceCard: React.FC<AttendanceCardProps> = ({ shift, now, useGroupColoring }) => {
  const clockIn  = useClockIn();
  const clockOut = useClockOut();

  const startMs    = toMs(shift, 'start');
  const endMs      = toMs(shift, 'end');
  const windowOpen = startMs - 60 * 60 * 1000;
  const nowMs      = now.getTime();

  const timing   = getShiftTiming(shift, now);
  const status   = (shift.attendance_status ?? 'unknown') as AttendanceStatus;
  const isAutoClockOut = shift.attendance_note === 'auto_clocked_out';

  const canClockIn  = status === 'unknown' && timing === 'in_window' && !shift.actual_end;
  const canClockOut = (status === 'checked_in' || status === 'late') && !shift.actual_end && timing !== 'before_window';

  const minsUntilWindow = timing === 'before_window'
    ? Math.max(0, Math.floor((windowOpen - nowMs) / 60000)) : 0;
  const minsRemaining = timing !== 'completed'
    ? Math.max(0, Math.floor((endMs - nowMs) / 60000)) : 0;
  const minsElapsed = Math.max(0, Math.floor((nowMs - startMs) / 60000));

  // ── GPS pre-capture ────────────────────────────────────────────────────────
  const [gpsCapture, setGpsCapture]   = useState<GPSCapture | null>(null);
  const [gpsAnalysis, setGpsAnalysis] = useState<GPSAnalysis | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);

  useEffect(() => {
    if (!canClockIn && !canClockOut) return;
    if (gpsCapture) return;
    let cancelled = false;
    setGpsCapturing(true);
    captureGPS().then((capture) => {
      if (cancelled) return;
      setGpsCapture(capture);
      setGpsAnalysis(analyzeGPS(capture, null, null));
      setGpsCapturing(false);
    });
    return () => { cancelled = true; };
  }, [canClockIn, canClockOut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress bar for InProgress shifts
  const progress = shift.lifecycle_status === 'InProgress'
    ? Math.min(100, ((nowMs - startMs) / (endMs - startMs)) * 100) : 0;

  // ── GPS indicator (MapPin + popover) ──────────────────────────────────────
  const gpsIndicator = (canClockIn || canClockOut) ? (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 focus:outline-none" aria-label="GPS status">
          {gpsCapturing ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />
          ) : (
            <MapPin className={`h-3 w-3 ${gpsAnalysis ? confidenceColor(gpsAnalysis.confidence) : 'text-muted-foreground/40'}`} />
          )}
          <span className={`text-[9px] font-mono font-bold uppercase ${gpsAnalysis ? confidenceColor(gpsAnalysis.confidence) : 'text-muted-foreground/40'}`}>
            {gpsCapturing ? 'locating…' : gpsAnalysis ? gpsAnalysis.confidence : 'no gps'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2 text-xs" align="start">
        <p className="font-bold text-foreground text-[11px] uppercase tracking-wide">GPS Signal</p>
        {gpsAnalysis?.hasLocation ? (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
              <span className="text-muted-foreground">Lat</span>
              <span className="text-foreground">{gpsCapture!.lat.toFixed(5)}</span>
              <span className="text-muted-foreground">Lon</span>
              <span className="text-foreground">{gpsCapture!.lon.toFixed(5)}</span>
              <span className="text-muted-foreground">Accuracy</span>
              <span className="text-foreground">{Math.round(gpsCapture!.accuracy)} m</span>
              {gpsAnalysis.distanceFromSite !== null && (
                <>
                  <span className="text-muted-foreground">Distance</span>
                  <span className="text-foreground">{formatDistance(gpsAnalysis.distanceFromSite)}</span>
                </>
              )}
            </div>
            {gpsAnalysis.flags.length > 0 && (
              <div className="pt-1 border-t border-border/40 space-y-0.5">
                {gpsAnalysis.flags.map(f => (
                  <p key={f} className="text-amber-500 text-[9px] font-semibold uppercase tracking-wide">
                    ⚠ {flagLabel(f)}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-red-500 text-[10px] font-semibold">GPS unavailable — clock-in is blocked until a fix is obtained.</p>
        )}
      </PopoverContent>
    </Popover>
  ) : null;

  let topContent: React.ReactNode = null;
  if (isAutoClockOut) {
    topContent = (
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30">
          <LogOut className="h-3 w-3" />DID NOT CLOCK OUT
        </span>
      </div>
    );
  } else if (timing === 'before_window' || shift.lifecycle_status === 'InProgress') {
    topContent = (
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {timing === 'before_window' && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-500 dark:text-slate-400 border border-slate-500/30">
            <Timer className="h-3 w-3" />Opens in {formatHM(minsUntilWindow)}
          </span>
        )}
        {shift.lifecycle_status === 'InProgress' && shift.actual_start && !shift.actual_end && (
          <div className="w-full mt-1">
            <div className="flex items-center justify-between text-[9px] text-muted-foreground/60 mb-0.5 font-mono">
              <span>{formatHM(minsElapsed)} in</span>
              <span>{formatHM(minsRemaining)} left</span>
            </div>
            <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-1000" style={{ width: `${Math.max(2, progress)}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  const footerActions = (canClockIn || canClockOut) ? (
    <div className="px-4 pb-4 pt-1 flex items-center gap-3">
      <div className="flex-1 flex gap-2">
        {canClockIn && (
          <Button size="sm"
            onClick={() => clockIn.mutate({ shiftId: shift.id, preCapture: gpsCapture })}
            disabled={clockIn.isPending || gpsCapturing || !gpsCapture}
            title={!gpsCapture && !gpsCapturing ? 'Waiting for GPS fix…' : undefined}
            className="flex-1 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 rounded-xl font-bold text-xs disabled:opacity-50">
            {clockIn.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />In…</>
              : gpsCapturing
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Locating…</>
              : <><LogIn className="h-3.5 w-3.5 mr-1.5" />Clock In</>}
          </Button>
        )}
        {canClockOut && (
          <Button size="sm"
            onClick={() => clockOut.mutate({ shiftId: shift.id })}
            disabled={clockOut.isPending}
            className="flex-1 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20 rounded-xl font-bold text-xs shadow-none">
            {clockOut.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Out…</>
              : <><LogOut className="h-3.5 w-3.5 mr-1.5" />Clock Out</>}
          </Button>
        )}
      </div>
      {gpsIndicator}
    </div>
  ) : null;

  // Map to TimesheetRow structure for the shared card component
  const timesheetEntry: TimesheetRow = useMemo(() => {
    return {
      id: shift.id,
      date: shift.shift_date,
      employeeId: shift.assigned_employee_id || '',
      employee: shift.assigned_profiles ? `${shift.assigned_profiles.first_name || ''} ${shift.assigned_profiles.last_name || ''}`.trim() : 'Unknown',
      organization: shift.organizations?.name || '',
      department: shift.departments?.name || '',
      subDepartment: shift.sub_departments?.name || '',
      group: shift.roster_subgroup?.roster_group?.name || shift.group_type || '',
      subGroup: shift.sub_group_name || '',
      role: shift.roles?.name || '',
      remunerationLevel: (shift.remuneration_levels?.level_name && !shift.remuneration_levels.level_name.toLowerCase().includes('team lead') && !shift.remuneration_levels.level_name.toLowerCase().includes('operational control')) ? shift.remuneration_levels.level_name : '',
      scheduledStart: shift.start_time,
      scheduledEnd: shift.end_time,
      clockIn: shift.actual_start || '',
      clockOut: shift.actual_end || '',
      adjustedStart: (() => {
          if (shift.timesheet_start_time) return shift.timesheet_start_time;
          return snapToQuarterHour(shift.actual_start) ?? '';
      })(),
      adjustedEnd: (() => {
          if (shift.timesheet_end_time) return shift.timesheet_end_time;
          return snapToQuarterHour(shift.actual_end) ?? '';
      })(),
      isAdjustedManual: !!shift.timesheet_start_time,
      length: String(shift.scheduled_length_minutes || 0),
      paidBreak: String(shift.paid_break_minutes || 0),
      unpaidBreak: String(shift.unpaid_break_minutes || 0),
      netLength: String(shift.net_length_minutes || 0),
      approximatePay: '',
      differential: '0', 
      liveStatus: shift.lifecycle_status || '',
      timesheetStatus: shift.timesheet_status || 'draft',
      attendanceStatus: shift.attendance_status,
      notes: shift.timesheet_notes,
      rejectedReason: shift.timesheet_rejected_reason,
      groupType: shift.group_type,
    };
  }, [shift]);

  return (
    <TimesheetMobileCard
      entry={timesheetEntry}
      isSelected={false}
      isSelectMode={false}
      onToggleSelect={() => {}}
      readOnly={false}
      isManager={false}
      employeeHeader={
        <div className="mb-2 space-y-2">
            {topContent}
        </div>
      }
      employeeActions={footerActions}
      hideGlow={true}
      useGroupColoring={useGroupColoring}
    />
  );
};

// ── Totals bar ─────────────────────────────────────────────────────────────────

const TotalsBar: React.FC<{ shifts: Shift[] }> = ({ shifts }) => {
  const totals = useMemo(() => {
    let hoursWorked = 0;
    let lateInCount  = 0;
    let earlyOutCount = 0;
    let noShowCount  = 0;

    for (const s of shifts) {
      const tsStatus = (s.timesheet_status || '').toLowerCase();
      
      // No-Show metric: counts finalized no-shows
      if (tsStatus === 'no_show' || s.attendance_status === 'no_show') {
        noShowCount++;
        continue; // No hours worked for no-shows
      }

      // Worked, Late, and Early metrics only count for APPROVED timesheets
      if (tsStatus === 'approved' && s.timesheet_start_time && s.timesheet_end_time) {
        // Calculate worked hours from adjusted (billable) times
        const start = new Date(`${s.shift_date}T${s.timesheet_start_time}`);
        const end = new Date(`${s.shift_date}T${s.timesheet_end_time}`);
        if (end < start) end.setDate(end.getDate() + 1); // Overnight support
        
        const durationMins = differenceInMinutes(end, start);
        const unpaidSub = s.unpaid_break_minutes || 0;
        hoursWorked += Math.max(0, durationMins - unpaidSub);

        // Late In: based on adjusted start vs scheduled start
        const scheduledStart = new Date(`${s.shift_date}T${s.start_time}`).getTime();
        // If adjusted start is >5 mins after scheduled, count as late
        if (start.getTime() > scheduledStart + 5 * 60 * 1000) {
          lateInCount++;
        }

        // Early Out: based on adjusted end vs scheduled end
        const scheduledEnd = toMs(s, 'end');
        // If adjusted end is <5 mins before scheduled, count as early out
        if (end.getTime() < scheduledEnd - 5 * 60 * 1000) {
          earlyOutCount++;
        }
      }
    }

    return {
      hoursWorked: (hoursWorked / 60).toFixed(1),
      lateInCount,
      earlyOutCount,
      noShowCount,
    };
  }, [shifts]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
      className="grid grid-cols-4 gap-3 p-4 rounded-2xl bg-muted/40 border border-border"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05, duration: 0.35 }}
        className="text-center"
      >
        <p className="text-xl font-black font-mono text-foreground tabular-nums">{totals.hoursWorked}h</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Worked</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.35 }}
        className="text-center"
      >
        <p className="text-xl font-black font-mono text-amber-500 tabular-nums">{totals.lateInCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Late In</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        className="text-center"
      >
        <p className="text-xl font-black font-mono text-orange-500 tabular-nums">{totals.earlyOutCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Early Out</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="text-center"
      >
        <p className="text-xl font-black font-mono text-red-500 tabular-nums">{totals.noShowCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">No Show</p>
      </motion.div>
    </motion.div>
  );
};

// ── Status Filter Drawer ────────────────────────────────────────────────────────

interface StatusFilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: StatusFilter;
  onSelect: (filter: StatusFilter) => void;
}

const StatusFilterDrawer: React.FC<StatusFilterDrawerProps> = ({ open, onOpenChange, current, onSelect }) => {
  const options: { value: StatusFilter; label: string; icon: React.FC<any>; color: string }[] = [
    { value: 'all', label: 'All statuses', icon: BarChart3, color: 'text-muted-foreground' },
    { value: 'checked_in', label: 'Completed', icon: CheckCircle, color: 'text-emerald-500' },
    { value: 'late', label: 'Late In', icon: Timer, color: 'text-amber-500' },
    { value: 'no_show', label: 'No Show', icon: UserX, color: 'text-rose-500' },
    { value: 'unknown', label: 'No Record', icon: Fingerprint, color: 'text-muted-foreground' },
  ];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>Filter by Status</ResponsiveDialog.Title>
        <ResponsiveDialog.Description>Show records with a specific attendance status</ResponsiveDialog.Description>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body className="p-4 pt-0">
        <div className="grid grid-cols-1 gap-2">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onSelect(opt.value);
                onOpenChange(false);
              }}
              className={cn(
                "flex items-center gap-3 w-full p-4 rounded-xl border text-sm font-bold transition-all",
                current === opt.value
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50"
              )}
            >
              <opt.icon className={cn("h-5 w-5", opt.color)} />
              <span>{opt.label}</span>
              {current === opt.value && <div className="ml-auto h-2 w-2 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      </ResponsiveDialog.Body>
    </ResponsiveDialog>
  );
};

const AttendancePage: React.FC = () => {
  const { user } = useAuth();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [endDate, setEndDate]     = useState<Date>(() => new Date());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [sortField, setSortField] = useState<keyof TimesheetRow | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const { isDark } = useTheme();
  const { orgBranding } = useSettings();
  const useGroupColoring = (orgBranding as any)?.enable_group_coloring || false;

  const rangeStart = format(startDate, 'yyyy-MM-dd');
  const rangeEnd   = format(endDate,   'yyyy-MM-dd');

  // Consider current date for short polling interval if viewing current range
  const now = new Date();
  const isViewingToday = now >= parseISO(rangeStart) && now <= parseISO(rangeEnd);

  const { data: logShifts = [], isLoading: logsLoading, refetch } = useQuery({
    queryKey: shiftKeys.attendance(user?.id ?? '', rangeStart, rangeEnd),
    queryFn:  () => shiftsQueries.getEmployeeShiftsForAttendance(user!.id, rangeStart, rangeEnd),
    enabled:  !!user?.id,
    staleTime: isViewingToday ? 30 * 1000 : 2 * 60 * 1000,
    refetchInterval: isViewingToday ? 60 * 1000 : false,
  });

  // Listen to timesheet updates in real-time
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('timesheets_attendance')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'timesheets',
          filter: `employee_id=eq.${user.id}`,
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refetch]);

  const filteredLogs = useMemo(() => {
    let sorted = [...logShifts].sort((a, b) => {
      // Show most recent dates first in the unified log
      const d = b.shift_date.localeCompare(a.shift_date);
      // For same date, sort chronologically
      return d !== 0 ? d : a.start_time.localeCompare(b.start_time);
    });

    // ── Apply Client-Side Sorting if set ───────────────────────────────────────
    if (sortField) {
        sorted.sort((a, b) => {
            // Map Shift back to TimesheetRow-like access for sorting
            const getVal = (s: Shift, field: keyof TimesheetRow) => {
                if (field === 'date') return s.shift_date;
                if (field === 'employee') return `${s.assigned_profiles?.first_name || ''} ${s.assigned_profiles?.last_name || ''}`;
                if (field === 'role') return s.roles?.name || '';
                if (field === 'scheduledStart') return s.start_time;
                if (field === 'scheduledEnd') return s.end_time;
                if (field === 'clockIn') return s.actual_start || '';
                if (field === 'clockOut') return s.actual_end || '';
                // Add more as needed or just fallback
                return (s as any)[field] || '';
            };

            const av = getVal(a, sortField);
            const bv = getVal(b, sortField);

            if (typeof av === "string" && typeof bv === "string")
                return sortDirection === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
            if (typeof av === "number" && typeof bv === "number")
                return sortDirection === "asc" ? av - bv : bv - av;
            return 0;
        });
    }

    // 1. Apply Scope Filters (Organization, Department, Sub-Department)
    if (scope && sorted.length > 0) {
      if (scope.org_ids?.length > 0) {
        sorted = sorted.filter(s => s.organization_id && scope.org_ids.includes(s.organization_id));
      }
      if (scope.dept_ids?.length > 0) {
        sorted = sorted.filter(s => scope.dept_ids.includes(s.department_id));
      }
      if (scope.subdept_ids?.length > 0) {
        // Support department-level shifts (null subdept) if parent department is selected
        sorted = sorted.filter(s => {
          const subDeptMatch = s.sub_department_id && scope.subdept_ids.includes(s.sub_department_id);
          const isDeptLevel = !s.sub_department_id;
          return subDeptMatch || isDeptLevel;
        });
      }
    }

    if (statusFilter === 'all') return sorted;
    return sorted.filter(s => (s.attendance_status ?? 'unknown') === statusFilter);
  }, [logShifts, statusFilter, scope]);

  const groupedLogs = useMemo(() => {
    const groups: { date: string; shifts: Shift[] }[] = [];
    let cur = '';
    for (const s of filteredLogs) {
      if (s.shift_date !== cur) { cur = s.shift_date; groups.push({ date: cur, shifts: [] }); }
      groups[groups.length - 1].shifts.push(s);
    }
    return groups;
  }, [filteredLogs]);

  // Map to TimesheetRow structure for the table view
  const timesheetEntries: TimesheetRow[] = useMemo(() => {
    return filteredLogs.map(shift => ({
      id: shift.id,
      date: shift.shift_date,
      employeeId: shift.assigned_employee_id || '',
      employee: shift.assigned_profiles ? `${shift.assigned_profiles.first_name || ''} ${shift.assigned_profiles.last_name || ''}`.trim() : 'Unknown',
      organization: shift.organizations?.name || '',
      department: shift.departments?.name || '',
      subDepartment: shift.sub_departments?.name || '',
      group: shift.roster_subgroup?.roster_group?.name || shift.group_type || '',
      subGroup: shift.sub_group_name || '',
      role: shift.roles?.name || '',
      remunerationLevel: (shift.remuneration_levels?.level_name && !shift.remuneration_levels.level_name.toLowerCase().includes('team lead') && !shift.remuneration_levels.level_name.toLowerCase().includes('operational control')) ? shift.remuneration_levels.level_name : '',
      scheduledStart: shift.start_time,
      scheduledEnd: shift.end_time,
      clockIn: shift.actual_start || '',
      clockOut: shift.actual_end || '',
      adjustedStart: shift.timesheet_start_time || snapToQuarterHour(shift.actual_start) || '',
      adjustedEnd: shift.timesheet_end_time || snapToQuarterHour(shift.actual_end) || '',
      isAdjustedManual: !!shift.timesheet_start_time,
      length: String(shift.scheduled_length_minutes || 0),
      paidBreak: String(shift.paid_break_minutes || 0),
      unpaidBreak: String(shift.unpaid_break_minutes || 0),
      netLength: String(shift.net_length_minutes || 0),
      approximatePay: '',
      differential: '0', 
      liveStatus: shift.lifecycle_status || '',
      timesheetStatus: shift.timesheet_status || 'draft',
      attendanceStatus: shift.attendance_status,
      notes: shift.timesheet_notes,
      rejectedReason: shift.timesheet_rejected_reason,
      groupType: shift.group_type,
    }));
  }, [filteredLogs]);


  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4"
    >
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30">
        <div className={cn(
            "rounded-[32px] p-4 lg:p-6 transition-all border",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {/* Row 1 & 2: Identity & Scope Filter */}
          <PersonalPageHeader
            title="My Attendance"
            Icon={Fingerprint}
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
            className="mb-4 lg:mb-6"
          />

          {/* Row 3: Function Bar */}
          <UnifiedModuleFunctionBar
            transparent
            startDate={startDate}
            endDate={endDate}
            onDateChange={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
            viewMode={viewMode}
            onViewModeChange={(v) => setViewMode(v as 'card' | 'table')}
            onRefresh={() => refetch()}
            isLoading={logsLoading}
            className="mt-1"
            filters={
              <>
                {/* Mobile: icon-only, 44×44 ARIA-compliant touch target */}
                <button
                  onClick={() => setFilterDrawerOpen(true)}
                  aria-label="Filter by status"
                  className={cn(
                    'md:hidden h-11 w-full flex items-center justify-center rounded-xl transition-all active:scale-95',
                    statusFilter !== 'all'
                      ? isDark ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'bg-primary/10 text-primary ring-1 ring-primary/20'
                      : isDark ? 'bg-white/5 text-white/70 active:bg-white/10' : 'bg-slate-100 text-slate-600 active:bg-slate-200',
                  )}
                >
                  <Filter className="h-5 w-5" />
                </button>
                {/* Desktop: full text button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilterDrawerOpen(true)}
                  className={cn(
                    'hidden md:flex h-10 lg:h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all shadow-sm',
                    isDark ? "bg-[#111827]/60 border-white/5" : "bg-slate-100 border-slate-200/50",
                    statusFilter !== 'all' && (isDark ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-primary/5 border-primary/10 text-primary'),
                  )}
                >
                  <Filter className="h-3.5 w-3.5 mr-2 opacity-50" />
                  <span>Filter</span>
                </Button>

                <StatusFilterDrawer
                  open={filterDrawerOpen}
                  onOpenChange={setFilterDrawerOpen}
                  current={statusFilter}
                  onSelect={setStatusFilter}
                />
              </>
            }
          />
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn(
            "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {logsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
                <span className="text-sm text-muted-foreground font-medium tracking-wide">
                  Loading attendance records…
                </span>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 lg:px-6 py-4 pb-32 scrollbar-none">
              {/* Totals */}
              {logShifts.length > 0 && <TotalsBar shifts={logShifts} />}


              {viewMode === 'card' ? (
                groupedLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                    <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-base font-bold text-foreground">No attendance records</p>
                    <p className="text-sm text-muted-foreground">
                      {statusFilter !== 'all' ? 'Try removing the filter' : 'No shifts found for this period'}
                    </p>
                  </div>
                ) : (
                  groupedLogs.map(({ date, shifts }) => {
                    const d = parseISO(date);
                    const isTodayDate = isToday(d);
                    return (
                      <div key={date}>
                        {/* Day header */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className={cn(
                            'text-xs font-black uppercase tracking-widest font-mono',
                            isTodayDate ? 'text-emerald-500' : 'text-muted-foreground',
                          )}>
                            {isTodayDate ? 'Today' : format(d, 'EEEE')}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{format(d, 'd MMMM yyyy')}</div>
                          <div className="flex-1 h-px bg-border" />
                          <div className="text-[10px] text-muted-foreground/60 font-mono">{shifts.length} shift{shifts.length > 1 ? 's' : ''}</div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5 mb-4">
                          {shifts.map(s => <AttendanceCard key={s.id} shift={s} now={now} useGroupColoring={useGroupColoring} />)}
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                <div className="flex-1 min-h-0">
                  <TimesheetTable
                    entries={timesheetEntries}
                    selectedDate={startDate}
                    readOnly={true}
                    viewMode="table"
                    onViewChange={() => {}}
                    hideTopControls={true}
                    showDate={true}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </motion.div>
  );
};

export default AttendancePage;
