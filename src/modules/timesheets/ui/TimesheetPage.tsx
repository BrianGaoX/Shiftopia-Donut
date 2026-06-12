import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { Clock, RefreshCw, ListFilter } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';

import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { UnifiedRosterNavigator, ViewType, DateRange, computeRange } from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import { TimesheetTable } from './components/TimesheetTable';
import {
    getShiftsForTimesheet,
    updateTimesheetEntry,
    bulkUpdateTimesheetStatus,
    TimesheetShiftRow,
    TimesheetFilters,
    markShiftAsNoShow,
} from '../api/timesheets.supabase.api';
import { useScopeFilter, ScopeMode } from '@/platform/auth/useScopeFilter';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';

/**
 * TimesheetPage
 *
 * Owns: scope, date, search query, raw data fetch.
 * Categorical filters (group, subgroup, role, status) are managed inside TimesheetTable.
 */
export const TimesheetPage: React.FC = () => {
    const { isDark } = useTheme();
    const { isManagerOrAbove, hasPermission, user } = useAuth();

    const scopeMode: ScopeMode = isManagerOrAbove() ? 'managerial' : 'personal';
    const canEdit = hasPermission('timesheet-edit');

    const { scope, setScope, isGammaLocked } = useScopeFilter(scopeMode);

    const selectedOrganizationId = scope.org_ids?.[0] || null;
    const selectedDepartmentId   = scope.dept_ids?.[0] || null;
    const selectedSubDepartmentId = scope.subdept_ids?.[0] || null;

    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [viewType, setViewType] = useState<ViewType>('day');
    const [range, setRange] = useState<DateRange>(computeRange(new Date(), 'day'));
    const [viewMode, setViewMode] = useState<'table' | 'timecard'>('timecard');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'no_show'>('all');

    const [shifts, setShifts] = useState<TimesheetShiftRow[]>([]);
    const [loading, setLoading] = useState(false);

    const { toast } = useToast();

    // ── Data load (scope + date range + search only; categorical filters are client-side) ──
    const loadShifts = useCallback(async () => {
        if (!selectedOrganizationId) return;
        setLoading(true);
        try {
            const startStr = format(range.start, 'yyyy-MM-dd');
            const endStr = format(range.end, 'yyyy-MM-dd');
            const filters: TimesheetFilters = {
                organizationId: selectedOrganizationId,
                departmentId: selectedDepartmentId,
                subDepartmentId: selectedSubDepartmentId,
                searchQuery: searchQuery || undefined,
            };
            const data = await getShiftsForTimesheet(startStr, filters, endStr);
            setShifts(data);
        } catch (error) {
            console.error('Error loading shifts:', error);
            toast({
                title: 'Error loading data',
                description: 'Failed to load timesheet data. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [range, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId, searchQuery, toast]);

    useEffect(() => {
        if (selectedOrganizationId) loadShifts();
    }, [loadShifts, selectedOrganizationId]);

    // ── Formatting helpers ─────────────────────────────────────────────────────
    const formatMinutes = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}:${m.toString().padStart(2, '0')}`;
    };

    const formatClockDisplay = (value: string | null | undefined): string => {
        if (!value || value === '-') return '-';
        const d = new Date(value);
        if (!isNaN(d.getTime())) return format(d, 'h:mm a');
        const parts = value.split(':').map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const h = parts[0], m = parts[1];
            return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        }
        return value;
    };

    // ── Data transform ─────────────────────────────────────────────────────────
    const entries = useMemo(() => shifts
        .filter(shift => {
            const isDraft = shift.lifecycleStatus === 'Draft';
            const isUnassigned = !shift.employeeId || shift.employeeName?.toLowerCase().includes('unassigned');
            if (isDraft || isUnassigned) return false;

            const tsStatus = shift.timesheetStatus?.toLowerCase() || 'draft';
            const attStatus = shift.attendanceStatus?.toLowerCase() || null;

            if (statusFilter === 'pending') return tsStatus === 'draft' || tsStatus === 'submitted';
            if (statusFilter === 'approved') return tsStatus === 'approved';
            if (statusFilter === 'rejected') return tsStatus === 'rejected';
            if (statusFilter === 'no_show') return attStatus === 'no_show' || tsStatus === 'no_show';
            
            return true;
        })
        .map(shift => ({
        id: shift.id,
        shiftId: shift.shiftId,
        timesheetId: shift.timesheetId || undefined,
        date: shift.shiftDate,
        employeeId: shift.employeeId || '',
        employee: shift.employeeName,
        organization: shift.organizationName,
        department: shift.departmentName,
        subDepartment: shift.subDepartmentName,
        group: shift.groupType || '',
        subGroup: shift.subGroupName || '',
        role: shift.roleName,
        remunerationLevel: shift.remunerationLevel || '',
        scheduledStart: shift.scheduledStart,
        scheduledEnd: shift.scheduledEnd,
        clockIn: formatClockDisplay(shift.clockIn),
        clockOut: formatClockDisplay(shift.clockOut),
        adjustedStart: shift.adjustedStart || '',
        adjustedEnd: shift.adjustedEnd || '',
        adjustedStartSource: shift.adjustedStartSource,
        adjustedEndSource: shift.adjustedEndSource,
        isAdjustedManual: shift.isAdjustedManual,
        length: formatMinutes(shift.scheduledLengthMinutes),
        netLength: formatMinutes(shift.netLengthMinutes),
        paidBreak: String(shift.paidBreakMinutes),
        unpaidBreak: String(shift.unpaidBreakMinutes),
        approximatePay: shift.estimatedPay ? `$${shift.estimatedPay.toFixed(2)}` : '-',
        differential: shift.varianceMinutes ? String(shift.varianceMinutes) : '0',
        varianceMinutes: shift.varianceMinutes,
        clockInVarianceMinutes: shift.clockInVarianceMinutes,
        clockOutVarianceMinutes: shift.clockOutVarianceMinutes,
        timesheetStatus: shift.timesheetStatus?.toLowerCase() || 'draft',
        attendanceStatus: shift.attendanceStatus || null,
        attendanceNote: shift.attendanceNote || null,
        liveStatus: shift.lifecycleStatus || '',
        notes: shift.notes,
        rejectedReason: shift.rejectedReason,
    })), [shifts, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps


    // ── Actions ────────────────────────────────────────────────────────────────
    const handleRefresh = () => loadShifts();

    const handleSaveEntry = async (id: string, updates: any) => {
        if (!canEdit) return;
        const success = await updateTimesheetEntry(id, {
            ...updates,
            status: updates.timesheetStatus?.toLowerCase(),
        });
        if (success) { toast({ title: 'Entry Updated' }); await loadShifts(); }
    };

    const handleBulkAction = async (ids: string[], action: 'approve' | 'reject') => {
        if (!canEdit) return;
        const result = await bulkUpdateTimesheetStatus(
            ids, user?.id || '',
            action === 'approve' ? 'approved' : 'rejected',
        );
        if (result.success) { toast({ title: 'Bulk action complete' }); await loadShifts(); }
    };

    const handleMarkNoShow = async (shiftId: string) => {
        if (!canEdit) return;
        const success = await markShiftAsNoShow(shiftId, user?.id || '');
        if (success) { toast({ title: 'Shift marked as No-Show' }); await loadShifts(); }
    };



    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
            <GoldStandardHeader
                title="Timesheets"
                Icon={Clock}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                mode={scopeMode}
                // Row 3 Structured Props
                viewMode={viewMode === 'timecard' ? 'card' : 'table'}
                onViewModeChange={(mode) => setViewMode(mode === 'card' ? 'timecard' : 'table')}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onRefresh={handleRefresh}
                isLoading={loading}
                leftContent={
                    <UnifiedRosterNavigator
                        variant="full"
                        date={selectedDate}
                        viewType={viewType}
                        onChange={(date, newRange) => {
                            setSelectedDate(date);
                            setRange(newRange);
                        }}
                        onViewTypeChange={(view) => {
                            let newDate = selectedDate;
                            if (view === 'week') {
                                newDate = startOfWeek(selectedDate, { weekStartsOn: 1 });
                            } else if (view === 'month') {
                                newDate = startOfMonth(selectedDate);
                            }
                            setSelectedDate(newDate);
                            setViewType(view);
                            setRange(computeRange(newDate, view));
                        }}
                    />
                }
                functionBarChildren={
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05]">
                            <ListFilter className="h-3 w-3 text-muted-foreground/40" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mr-1">Status</span>
                            
                            <ToggleGroup 
                                type="single" 
                                value={statusFilter} 
                                onValueChange={(val) => val && setStatusFilter(val as any)}
                                className="bg-transparent"
                            >
                                <ToggleGroupItem value="all" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg">All</ToggleGroupItem>
                                <ToggleGroupItem value="pending" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg data-[state=on]:bg-amber-500/10 data-[state=on]:text-amber-500">Pending</ToggleGroupItem>
                                <ToggleGroupItem value="approved" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg data-[state=on]:bg-emerald-500/10 data-[state=on]:text-emerald-500">Approved</ToggleGroupItem>
                                <ToggleGroupItem value="rejected" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg data-[state=on]:bg-rose-500/10 data-[state=on]:text-rose-500">Rejected</ToggleGroupItem>
                                <ToggleGroupItem value="no_show" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg data-[state=on]:bg-slate-500/20">No-Show</ToggleGroupItem>
                            </ToggleGroup>
                        </div>
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
                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                        <TimesheetTable
                            entries={entries}
                            selectedDate={selectedDate}
                            onDateChange={setSelectedDate}
                            readOnly={!canEdit}
                            viewMode={viewMode}
                            onViewChange={setViewMode}
                            searchQuery={searchQuery}
                            setSearchQuery={setSearchQuery}
                            onSaveEntry={handleSaveEntry}
                            onBulkAction={handleBulkAction}
                            onMarkNoShow={handleMarkNoShow}
                            onRefresh={handleRefresh}
                            isRefreshing={loading}
                            hideTopControls
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TimesheetPage;
