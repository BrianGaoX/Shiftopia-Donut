import React, { useState, useMemo } from "react";
import { ArrowUp, ArrowDown, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { TimesheetRow } from "../../model/timesheet.types";

import { cn } from "@/modules/core/lib/utils";
import { TimesheetMobileView } from "./TimesheetMobileView";
import { TimesheetTimecardView } from "./TimesheetTimecardView";
import { TimesheetRow as TimesheetRowComponent } from "./TimesheetRow";
import { TimesheetFunctionBar } from "./TimesheetHeader";
import {
    ActiveFilters,
    EMPTY_FILTERS,
    countActiveFilters,
    applyTimesheetFilters,
} from "./TimesheetFilterDrawer";
import { exportTimesheetXLSX, exportTimesheetPDF } from "./timesheet.export";
import { isShiftFinished } from "./TimesheetTable.utils";

// ── Props ─────────────────────────────────────────────────────────────────────

interface TimesheetTableProps {
    entries: TimesheetRow[];
    selectedDate: Date;
    readOnly?: boolean;
    viewMode: "table" | "timecard";
    onViewChange: (view: "table" | "timecard") => void;
    searchQuery?: string;
    setSearchQuery?: (q: string) => void;
    onSaveEntry?: (id: string, updates: Partial<TimesheetRow>) => void;
    onBulkAction?: (ids: string[], action: "approve" | "reject") => void;
    onMarkNoShow?: (id: string) => void;
    onDateChange?: (date: Date) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    hideTopControls?: boolean;
    showDate?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TimesheetTable: React.FC<TimesheetTableProps> = ({
    entries,
    selectedDate,
    readOnly = false,
    viewMode,
    onViewChange,
    searchQuery = "",
    setSearchQuery,
    onSaveEntry,
    onBulkAction,
    onMarkNoShow,
    onDateChange,
    onRefresh,
    isRefreshing,
    hideTopControls = false,
    showDate = false,
}) => {
    // ── Filter state (owned here, shared to both mobile + desktop) ─────────────
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
    const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);

    // ── Sort state ─────────────────────────────────────────────────────────────
    const [sortField, setSortField] = useState<keyof TimesheetRow | null>(null);
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

    // ── Bulk selection state ───────────────────────────────────────────────────
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isSelectMode, setIsSelectMode] = useState(false);

    useTheme();
    const { toast } = useToast();

    // ── Filtering (shared logic from TimesheetFilterDrawer) ────────────────────
    const filteredEntries = useMemo(
        () => applyTimesheetFilters(entries, appliedFilters, searchQuery),
        [entries, appliedFilters, searchQuery],
    );

    // ── Sorting ────────────────────────────────────────────────────────────────
    const handleSort = (field: keyof TimesheetRow) => {
        setSortField(f => {
            if (f === field) {
                setSortDirection(d => (d === "asc" ? "desc" : "asc"));
                return f;
            }
            setSortDirection("asc");
            return field;
        });
    };

    const getSortIndicator = (field: keyof TimesheetRow) => {
        if (sortField !== field) return null;
        return sortDirection === "asc"
            ? <ArrowUp className="inline h-3 w-3 ml-1" />
            : <ArrowDown className="inline h-3 w-3 ml-1" />;
    };

    const sortedEntries = useMemo(() => {
        if (!sortField) return filteredEntries;
        return [...filteredEntries].sort((a, b) => {
            const av = a[sortField], bv = b[sortField];
            if (typeof av === "string" && typeof bv === "string")
                return sortDirection === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
            if (typeof av === "number" && typeof bv === "number")
                return sortDirection === "asc" ? av - bv : bv - av;
            return 0;
        });
    }, [filteredEntries, sortField, sortDirection]);

    const SortableHeader = ({ field, label, className }: { field: keyof TimesheetRow, label: string, className?: string }) => (
        <th
            className={cn(
                "p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 cursor-pointer hover:bg-muted/50 border-b border-border/50 text-left group transition-colors",
                className
            )}
            onClick={() => handleSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                <div className={cn("transition-opacity", sortField === field ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                    {getSortIndicator(field) || <ArrowDown className="h-3 w-3 text-muted-foreground/30" />}
                </div>
            </div>
        </th>
    );

    // ── Export handlers (operate on the currently filtered + sorted view) ──────
    const handleExportXLSX = () => exportTimesheetXLSX(sortedEntries, selectedDate);
    const handleExportPDF  = () => exportTimesheetPDF(sortedEntries, selectedDate);

    // ── Selection helpers ──────────────────────────────────────────────────────
    const selectableIds = useMemo(
        () =>
            sortedEntries
                .filter(e => {
                    const s = (e.timesheetStatus || "").toLowerCase();
                    if (s !== "draft" && s !== "submitted") return false;
                    return isShiftFinished(e.date, e.scheduledStart, e.scheduledEnd, e.clockOut);
                })
                .map(e => String(e.id)),
        [sortedEntries],
    );

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleSelectAll = () => {
        if (selectedIds.length === selectableIds.length && selectableIds.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(selectableIds);
        }
    };

    const handleToggleSelectMode = () => {
        setIsSelectMode(v => {
            if (v) setSelectedIds([]);
            return !v;
        });
    };

    const handleBulkApprove = () => {
        if (selectedIds.length === 0) {
            toast({ title: "No entries selected", description: "Select at least one pending entry.", variant: "destructive" });
            return;
        }
        onBulkAction?.(selectedIds, "approve");
        toast({ title: "Bulk Approval", description: `${selectedIds.length} timesheet(s) approved.` });
        setSelectedIds([]);
    };

    const handleBulkReject = () => {
        if (selectedIds.length === 0) {
            toast({ title: "No entries selected", description: "Select at least one pending entry.", variant: "destructive" });
            return;
        }
        onBulkAction?.(selectedIds, "reject");
        toast({ title: "Bulk Rejection", description: `${selectedIds.length} timesheet(s) rejected.` });
        setSelectedIds([]);
    };



    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="md:mt-8 mt-0">

            {/* ── Mobile view (< md) ── */}
            <div className="block md:hidden">
                <TimesheetMobileView
                    entries={entries}
                    selectedDate={selectedDate}
                    readOnly={readOnly}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    appliedFilters={appliedFilters}
                    onApplyFilters={setAppliedFilters}
                    activeFilterCount={activeFilterCount}
                    onSaveEntry={onSaveEntry}
                    onBulkAction={onBulkAction}
                    onMarkNoShow={onMarkNoShow}
                    onDateChange={onDateChange}
                    onRefresh={onRefresh}
                    isRefreshing={isRefreshing}
                    onExportPDF={handleExportPDF}
                    onExportSpreadsheet={handleExportXLSX}
                />
            </div>

            {/* ── Desktop view (≥ md) ── */}
            <div className="hidden md:block space-y-5">

                {/* Unified function bar */}
                {!hideTopControls && (
                    <TimesheetFunctionBar
                        viewMode={viewMode}
                        onViewChange={onViewChange}
                        selectedDate={selectedDate}
                        onDateChange={onDateChange ?? (() => {})}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery ?? (() => {})}
                        entries={entries}
                        appliedFilters={appliedFilters}
                        onApplyFilters={setAppliedFilters}
                        activeFilterCount={activeFilterCount}
                        onExportPDF={handleExportPDF}
                        onExportSpreadsheet={handleExportXLSX}
                        onRefresh={onRefresh ?? (() => {})}
                        isRefreshing={isRefreshing ?? false}
                        isSelectMode={isSelectMode}
                        onToggleSelectMode={handleToggleSelectMode}
                        selectedCount={selectedIds.length}
                        onBulkApprove={handleBulkApprove}
                        onBulkReject={handleBulkReject}
                    />
                )}



                {/* Timecard View */}
                {viewMode === "timecard" && (
                    <TimesheetTimecardView
                        entries={sortedEntries}
                        selectedIds={selectedIds}
                        isSelectMode={isSelectMode}
                        onToggleSelect={handleToggleSelect}
                        onSelectAll={handleSelectAll}
                        onClearSelection={() => setSelectedIds([])}
                        totalSelectable={selectableIds.length}
                        onSaveEntry={onSaveEntry}
                        onMarkNoShow={onMarkNoShow}
                        readOnly={readOnly}
                        onClearFilters={() => setAppliedFilters(EMPTY_FILTERS)}
                    />
                )}

                {/* Table View */}
                {viewMode === "table" && (
                    <div className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur-md overflow-hidden shadow-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse min-w-[2200px]">
                                <thead>
                                    <tr>
                                        {/* Multi-header groups */}
                                        <th className="p-3 border-b-2 border-border/50"></th>
                                        {showDate && <th className="p-3 border-b-2 border-border/50 border-r border-border/30"></th>}
                                        <th colSpan={2} className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 border-r border-border/30">
                                            Employee
                                        </th>
                                        <th colSpan={4} className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 border-r border-border/30">
                                            Organization & Role
                                        </th>
                                        <th colSpan={2} className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 border-r border-border/30">
                                            Scheduled
                                        </th>
                                        <th colSpan={2} className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 border-r border-border/30">
                                            Attendance (Actual)
                                        </th>
                                        <th colSpan={6} className="p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 bg-primary/5 border-r border-border/30">
                                            Adjusted (Inline Edit)
                                        </th>
                                        <th colSpan={2} className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 border-r border-border/30">
                                            Payroll & Diff
                                        </th>
                                        <th colSpan={2} className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 border-r border-border/30">
                                            Statuses
                                        </th>
                                        <th className="p-3 border-b-2 border-border/50"></th>
                                    </tr>
                                    <tr className="bg-muted/20">
                                        {/* Select All */}
                                        <th className="w-10 p-3 border-b border-border/50 border-r border-border/30">
                                            <div className="flex justify-center">
                                                <div className="h-4 w-4 rounded border-border bg-background" />
                                            </div>
                                        </th>
                                        {/* Date */}
                                        {showDate && (
                                            <SortableHeader field="date" label="Date" className="border-r border-border/30" />
                                        )}
                                        {/* Employee */}
                                        <SortableHeader field="employeeId" label="ID" />
                                        <SortableHeader field="employee" label="Name" className="border-r border-border/30" />
                                        {/* Organization */}
                                        <SortableHeader field="group" label="Group" />
                                        <SortableHeader field="subGroup" label="Sub-Group" />
                                        <SortableHeader field="role" label="Role" />
                                        <SortableHeader field="remunerationLevel" label="Level" className="border-r border-border/30" />
                                        {/* Scheduled */}
                                        <SortableHeader field="scheduledStart" label="Start" />
                                        <SortableHeader field="scheduledEnd" label="End" className="border-r border-border/30" />
                                        {/* Actual */}
                                        <SortableHeader field="clockIn" label="Clock In" />
                                        <SortableHeader field="clockOut" label="Clock Out" className="border-r border-border/30" />
                                        {/* Adjusted */}
                                        <SortableHeader field="adjustedStart" label="Start" className="bg-primary/5" />
                                        <SortableHeader field="adjustedEnd" label="End" className="bg-primary/5" />
                                        <SortableHeader field="length" label="Length" className="bg-primary/5 border-r border-border/30" />
                                        <th className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 border-b border-border/50 text-left bg-primary/5">Paid</th>
                                        <th className="p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 border-b border-border/50 text-left bg-primary/5">Unpaid</th>
                                        <SortableHeader field="netLength" label="Net" className="bg-primary/5 border-r border-border/30" />
                                        {/* Payroll */}
                                        <SortableHeader field="approximatePay" label="Pay" />
                                        <SortableHeader field="differential" label="Diff" className="border-r border-border/30" />
                                        {/* Statuses */}
                                        <SortableHeader field="liveStatus" label="Time Rules" />
                                        <SortableHeader field="timesheetStatus" label="Live Rules" className="border-r border-border/30" />
                                        {/* Actions */}
                                        <th className="p-3 text-[10px] font-black uppercase tracking-widest text-foreground/70 text-center border-b border-border/50">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedEntries.length === 0 ? (
                                        <tr>
                                            <td colSpan={showDate ? 24 : 23} className="p-20 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center gap-4">
                                                    <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center">
                                                        <XCircle className="h-8 w-8 text-muted-foreground/40" />
                                                    </div>
                                                    <div>
                                                        <p className="text-lg font-black text-foreground">No records found</p>
                                                        <p className="text-sm">Try adjusting your filters or search query.</p>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedEntries.map((entry) => (
                                            <TimesheetRowComponent
                                                key={entry.id}
                                                entry={entry}
                                                readOnly={readOnly}
                                                isSelected={selectedIds.includes(String(entry.id))}
                                                onToggleSelect={() => handleToggleSelect(String(entry.id))}
                                                onSave={onSaveEntry}
                                                onMarkNoShow={onMarkNoShow}
                                                showDate={showDate}
                                            />
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
