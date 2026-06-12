import React from 'react';
import { Clock, CheckSquare, Square } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { TimesheetMobileCard } from './TimesheetMobileCard';
import type { TimesheetRow } from '../../model/timesheet.types';
import { Button } from '@/modules/core/ui/primitives/button';

interface TimesheetTimecardViewProps {
    entries: TimesheetRow[];
    selectedIds: string[];
    isSelectMode: boolean;
    onToggleSelect: (id: string) => void;
    onSelectAll?: () => void;
    onClearSelection?: () => void;
    totalSelectable?: number;
    onSaveEntry?: (id: string, updates: Partial<TimesheetRow>) => void;
    onMarkNoShow?: (id: string) => void;
    readOnly?: boolean;
    onClearFilters?: () => void;
}

export const TimesheetTimecardView: React.FC<TimesheetTimecardViewProps> = ({
    entries,
    selectedIds,
    isSelectMode,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    totalSelectable = 0,
    onSaveEntry,
    onMarkNoShow,
    readOnly = false,
    onClearFilters,
}) => {
    if (entries.length === 0) {
        return (
            <div
                className="flex flex-col items-center justify-center py-24 px-6 text-center"
            >
                <div className="relative mb-8">
                    <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
                    <div className="relative h-24 w-24 rounded-[2.5rem] bg-gradient-to-br from-background to-muted/30 border border-border/40 shadow-xl flex items-center justify-center">
                        <Clock className="h-11 w-11 text-primary/30" />
                    </div>
                </div>
                <h3 className="font-black text-2xl text-foreground mb-3">No entries found</h3>
                <p className="text-[14px] text-muted-foreground/80 max-w-[300px] leading-relaxed mx-auto font-medium">
                    Try adjusting your filters or search query to see more staff.
                </p>
                {onClearFilters && (
                    <div className="mt-10">
                        <Button
                            onClick={onClearFilters}
                            className="rounded-full px-10 h-14 font-black text-xs uppercase tracking-widest bg-primary shadow-[0_8px_25px_rgba(var(--primary-rgb),0.25)] transition-all active:scale-95"
                        >
                            Clear All Filters
                        </Button>
                    </div>
                )}
            </div>
        );
    }

    const allSelected = totalSelectable > 0 && selectedIds.length === totalSelectable;

    return (
        <div className="space-y-4">
            {isSelectMode && (
                <div
                    className="overflow-hidden"
                >
                        <div className="flex items-center gap-3 px-1 pb-1">
                            <button
                                onClick={allSelected ? onClearSelection : onSelectAll}
                                className={cn(
                                    'flex items-center gap-2 h-8 px-3.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all active:scale-95',
                                    allSelected
                                        ? 'bg-primary/10 border-primary/30 text-primary'
                                        : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                )}
                            >
                                {allSelected
                                    ? <CheckSquare className="h-3.5 w-3.5" />
                                    : <Square className="h-3.5 w-3.5" />
                                }
                                {allSelected ? 'Deselect All' : `Select All (${totalSelectable})`}
                            </button>
                            {selectedIds.length > 0 && !allSelected && (
                                <button
                                    onClick={onClearSelection}
                                    className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-foreground transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5 pb-12">
                {entries.map((entry) => (
                        <TimesheetMobileCard
                            key={entry.id}
                            entry={entry}
                            isSelected={selectedIds.includes(String(entry.id))}
                            isSelectMode={isSelectMode}
                            onToggleSelect={() => onToggleSelect(String(entry.id))}
                            onSave={onSaveEntry}
                            onMarkNoShow={onMarkNoShow}
                            readOnly={readOnly}
                        />
                ))}
            </div>
        </div>
    );
};
