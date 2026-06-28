import React from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { RefreshCcw, LayoutGrid, List, Search, Calendar, Settings, Layers, Filter } from 'lucide-react';
import { CustomDateRangePicker } from './CustomDateRangePicker';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { startOfWeek, endOfWeek, addDays, differenceInCalendarDays, format } from 'date-fns';
import { Calendar as RangeCalendar } from '@/modules/core/ui/primitives/calendar';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerDescription } from '@/modules/core/ui/primitives/drawer';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

interface UnifiedModuleFunctionBarProps {
    startDate?: Date;
    endDate?: Date;
    onDateChange?: (start: Date, end: Date) => void;
    viewMode: 'card' | 'table';
    onViewModeChange: (mode: 'card' | 'table') => void;
    onRefresh?: () => void;
    isLoading?: boolean;
    filters?: React.ReactNode;
    leftContent?: React.ReactNode;
    className?: string;
    transparent?: boolean;
    searchQuery?: string;
    onSearchChange?: (val: string) => void;
    children?: React.ReactNode;
}

const unwrapChildren = (children: React.ReactNode): React.ReactNode[] => {
    if (!children) return [];
    if (React.isValidElement(children) && children.type === React.Fragment) {
        return React.Children.toArray(children.props.children);
    }
    return React.Children.toArray(children);
};

/* ────────────────────────────────────────────────────────────────────────────
   MobileIconButton – 44×44 touch target (WCAG / ARIA compliant), 20×20 icon
   ──────────────────────────────────────────────────────────────────────────── */
export const MobileIconButton = React.forwardRef<
    HTMLButtonElement,
    {
        icon: React.ReactNode;
        label: string;
        onClick?: () => void;
        isActive?: boolean;
        disabled?: boolean;
        isDark: boolean;
        className?: string;
    }
>(({ icon, label, onClick, isActive, disabled, isDark, className, ...props }, ref) => (
    <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
            "h-11 w-full flex items-center justify-center rounded-xl transition-all active:scale-95",
            isActive
                ? isDark
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-primary/10 text-primary ring-1 ring-primary/20"
                : isDark
                    ? "bg-white/5 text-white/70 active:bg-white/10"
                    : "bg-slate-100 text-slate-600 active:bg-slate-200",
            disabled && "opacity-40 pointer-events-none",
            className
        )}
        {...props}
    >
        {icon}
    </button>
));
MobileIconButton.displayName = 'MobileIconButton';

export const UnifiedModuleFunctionBar: React.FC<UnifiedModuleFunctionBarProps> = ({
    startDate,
    endDate,
    onDateChange,
    viewMode,
    onViewModeChange,
    onRefresh,
    isLoading = false,
    filters,
    leftContent,
    className,
    transparent = false,
    searchQuery,
    onSearchChange,
    children
}) => {
    const { isDark } = useTheme();
    const breakpoint = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const [isDateDrawerOpen, setIsDateDrawerOpen] = React.useState(false);

    if (isMobile) {
        const datePickerActive = !!(startDate && endDate && onDateChange);
        const viewModeActive = !!onViewModeChange;
        const refreshActive = !!onRefresh;
        const unwrappedFilters = unwrapChildren(filters);
        const unwrappedChildrenList = unwrapChildren(children);

        const columnTracks = [
            ...(datePickerActive ? ['minmax(44px, 0.7fr)'] : []),
            ...(viewModeActive ? ['minmax(44px, 0.7fr)'] : []),
            ...unwrappedFilters.map(() => 'minmax(0, 1.8fr)'),
            ...(refreshActive ? ['minmax(44px, 0.55fr)'] : []),
        ];

        return (
            <div 
                className={cn(
                    "grid w-full gap-1.5 p-1.5 rounded-2xl",
                    !transparent && (
                        isDark 
                            ? "bg-[#1c2333]/40 backdrop-blur-md border border-white/5 shadow-2xl shadow-black/20" 
                            : "bg-white/60 backdrop-blur-md border border-white/80 shadow-lg shadow-slate-200/50"
                    ),
                    className
                )}
                style={{
                    gridTemplateColumns: columnTracks.join(' ')
                }}
            >
                {/* 1. Filter by Date */}
                {datePickerActive && (
                    <Drawer open={isDateDrawerOpen} onOpenChange={setIsDateDrawerOpen}>
                        <DrawerTrigger asChild>
                            <MobileIconButton
                                icon={<Calendar className="h-5 w-5" />}
                                label="Filter by date"
                                isDark={isDark}
                            />
                        </DrawerTrigger>
                        <DrawerContent className="rounded-t-[2.5rem] border-t-0 bg-background/95 backdrop-blur-2xl px-3 pt-6 pb-6 flex flex-col items-center h-[82vh] max-h-[85vh]">
                            {/* Accessible Drawer Title for screen readers */}
                            <DrawerTitle className="sr-only">Select Date Range</DrawerTitle>
                            {/* Selected Date Range Header (Airbnb-style) */}
                            {startDate && endDate && (
                                <div className="text-center mb-4 flex-shrink-0 flex flex-col gap-1 select-none">
                                    <DrawerDescription className="sr-only">Select start and end dates for bidding shift opportunities</DrawerDescription>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/45 leading-none">Select Date Range</span>
                                    <h3 className="text-2xl font-black text-foreground tracking-tight mt-1.5 leading-none">
                                        {(() => {
                                            const days = differenceInCalendarDays(endDate, startDate) + 1;
                                            return days === 1 ? '1-Day Selected' : `${days}-Days Selected`;
                                        })()}
                                    </h3>
                                    <p className="text-[11px] font-mono font-black text-primary uppercase tracking-widest mt-1">
                                        {format(startDate, 'EEE, d MMM')} – {format(endDate, 'EEE, d MMM')}
                                    </p>
                                </div>
                            )}
                            
                            {/* Scrollable multi-month container */}
                            <div className="w-full overflow-y-auto flex-1 flex flex-col items-center py-2 px-1 scrollbar-none">
                                <RangeCalendar
                                    mode="range"
                                    numberOfMonths={2}
                                    weekStartsOn={1}
                                    selected={{
                                        from: startDate,
                                        to: endDate
                                    }}
                                    onSelect={(range) => {
                                        if (range?.from) {
                                            const toDate = range.to || range.from;
                                            onDateChange!(range.from, toDate);
                                            // Close drawer only when a complete range is selected and it is not a single day selection (unless they choose today)
                                            if (range.to && range.from.getTime() !== range.to.getTime()) {
                                                setTimeout(() => setIsDateDrawerOpen(false), 250);
                                            }
                                        }
                                    }}
                                    defaultMonth={startDate}
                                    className={cn(
                                        "w-full border-none pointer-events-auto p-2",
                                        isDark ? "bg-transparent text-white" : "bg-transparent text-slate-900"
                                    )}
                                    classNames={{
                                        months: "w-full flex flex-col space-y-8",
                                        month: "w-full space-y-4",
                                        table: "w-full",
                                        head_row: "flex w-full justify-between mb-2",
                                        head_cell: "text-muted-foreground/60 w-12 h-12 text-xs font-black uppercase flex items-center justify-center flex-1",
                                        row: "flex w-full justify-between mt-2",
                                        cell: "relative p-0 text-center text-base focus-within:relative focus-within:z-20 h-12 flex-1 flex items-center justify-center",
                                        day: "h-12 w-12 p-0 font-bold rounded-xl flex items-center justify-center text-sm transition-all duration-200 active:scale-95"
                                    }}
                                />
                            </div>
                            
                            {/* Preset shortcuts sticky footer */}
                            <div className={cn(
                                "w-full border-t pt-4 mt-2 flex gap-1.5 justify-center bg-background/95 backdrop-blur-md sticky bottom-0 left-0 right-0 z-10 flex-shrink-0",
                                isDark ? "border-white/5" : "border-slate-100"
                            )}>
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-xl font-black uppercase text-[9px] tracking-widest h-10 border-none bg-accent/20 hover:bg-accent/40 transition-all active:scale-95"
                                    onClick={() => {
                                        const today = new Date();
                                        onDateChange!(today, today);
                                        setTimeout(() => setIsDateDrawerOpen(false), 200);
                                    }}
                                >
                                    Today
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-xl font-black uppercase text-[9px] tracking-widest h-10 border-none bg-accent/20 hover:bg-accent/40 transition-all active:scale-95"
                                    onClick={() => {
                                        const start = startOfWeek(new Date(), { weekStartsOn: 1 });
                                        const end = endOfWeek(new Date(), { weekStartsOn: 1 });
                                        onDateChange!(start, end);
                                        setTimeout(() => setIsDateDrawerOpen(false), 200);
                                    }}
                                >
                                    This Week
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-xl font-black uppercase text-[9px] tracking-widest h-10 border-none bg-accent/20 hover:bg-accent/40 transition-all active:scale-95"
                                    onClick={() => {
                                        const start = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7);
                                        const end = addDays(endOfWeek(new Date(), { weekStartsOn: 1 }), 7);
                                        onDateChange!(start, end);
                                        setTimeout(() => setIsDateDrawerOpen(false), 200);
                                    }}
                                >
                                    Next Week
                                </Button>
                            </div>
                        </DrawerContent>
                    </Drawer>
                )}

                {/* 2. Card/List View toggle */}
                {viewModeActive && (
                    <MobileIconButton
                        icon={viewMode === 'card'
                            ? <List className="h-5 w-5" />
                            : <LayoutGrid className="h-5 w-5" />
                        }
                        label={viewMode === 'card' ? 'Switch to list view' : 'Switch to card view'}
                        onClick={() => onViewModeChange!(viewMode === 'card' ? 'table' : 'card')}
                        isDark={isDark}
                    />
                )}

                {/* 3. Group By / Filters */}
                {unwrappedFilters.map((filter, idx) => (
                    <div key={`filter-${idx}`} className="w-full min-w-0">
                        {filter}
                    </div>
                ))}

                {/* 4. Bulk Mode & Settings (passed as children) */}
                {unwrappedChildrenList.map((child, idx) => (
                    <div key={`child-${idx}`} className="w-full col-span-full [&_button]:w-full [&_button]:justify-center">
                        {child}
                    </div>
                ))}

                {/* 5. Refresh */}
                {refreshActive && (
                    <MobileIconButton
                        icon={<RefreshCcw className={cn("h-5 w-5", isLoading && "animate-spin")} />}
                        label="Refresh data"
                        onClick={onRefresh}
                        disabled={isLoading}
                        isDark={isDark}
                    />
                )}
            </div>
        );
    }

    return (
        <div className={cn(
            "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden",
            !transparent && (
                isDark 
                    ? "bg-[#1c2333]/40 backdrop-blur-md border border-white/5 shadow-2xl shadow-black/20" 
                    : "bg-white/60 backdrop-blur-md border border-white/80 shadow-lg shadow-slate-200/50"
            ),
            className
        )}>
            {/* 1. Left Content (Title or Tabs) - Visible on Desktop, Hidden on small mobile to save space if needed */}
            {leftContent && (
                <div className="hidden lg:flex items-center px-1 flex-shrink-0">
                    {leftContent}
                </div>
            )}

            {/* Scrollable Container for all tools */}
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
                {/* 2. Date Range Picker (Start, End, Today) */}
                {startDate && endDate && onDateChange && (
                    <div className="flex-shrink-0">
                        <CustomDateRangePicker
                            startDate={startDate}
                            endDate={endDate}
                            onDateChange={onDateChange}
                        />
                    </div>
                )}

                {filters && (
                    <>
                        <div className="h-6 w-px bg-border/20 flex-shrink-0" />
                        {/* 3. Custom Filters (Priority toggles etc) */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            {filters}
                        </div>
                    </>
                )}

                <div className="h-6 w-px bg-border/20 flex-shrink-0" />

                {/* 4. View Toggle (Card/Table) */}
                <div className={cn(
                    "flex items-center gap-1 p-1 rounded-xl flex-shrink-0",
                    isDark ? "bg-[#111827]/60" : "bg-slate-100"
                )}>
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onViewModeChange('table')}
                                    className={cn(
                                        "h-8 w-8 lg:h-9 lg:w-9 rounded-lg transition-all",
                                        viewMode === 'table' ? (isDark ? "bg-[#0f172a] text-white shadow-sm" : "bg-white text-slate-900 shadow-sm") : "text-muted-foreground hover:bg-muted/50"
                                    )}
                                >
                                    <List className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] uppercase font-bold">List View</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onViewModeChange('card')}
                                    className={cn(
                                        "h-8 w-8 lg:h-9 lg:w-9 rounded-lg transition-all",
                                        viewMode === 'card' ? (isDark ? "bg-[#0f172a] text-white shadow-sm" : "bg-white text-slate-900 shadow-sm") : "text-muted-foreground hover:bg-muted/50"
                                    )}
                                >
                                    <LayoutGrid className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] uppercase font-bold">Card View</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                {/* 5. Children (e.g. status tabs) */}
                {children && (
                    <>
                        <div className="h-6 w-px bg-border/20 flex-shrink-0" />
                        {children}
                    </>
                )}

                {/* 6. Search Input */}
                {onSearchChange !== undefined && (
                    <>
                        <div className="h-6 w-px bg-border/20 flex-shrink-0" />
                        <div className={cn(
                            "flex items-center gap-2 px-3 h-10 rounded-xl min-w-[200px] border transition-all",
                            isDark ? "bg-[#111827]/60 border-white/5" : "bg-slate-100 border-slate-200"
                        )}>
                            <Search className="h-3.5 w-3.5 text-muted-foreground/40" />
                            <input
                                type="text"
                                value={searchQuery || ''}
                                onChange={(e) => onSearchChange(e.target.value)}
                                placeholder="SEARCH..."
                                className="bg-transparent border-none text-[10px] font-black uppercase tracking-wider placeholder:text-muted-foreground/20 focus:ring-0 w-full"
                            />
                        </div>
                    </>
                )}

                {/* 7. Refresh Button */}
                {onRefresh && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onRefresh}
                        disabled={isLoading}
                        className={cn(
                            "h-10 w-10 lg:h-11 lg:w-11 rounded-xl flex-shrink-0 transition-all",
                            isDark ? "bg-[#111827]/60 hover:bg-[#111827]/80" : "bg-slate-100 hover:bg-slate-200"
                        )}
                    >
                        <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </Button>
                )}
            </div>
        </div>
    );
};
