/**
 * SelectFromPoolModal — role-contracted employee picker.
 *
 * Opened from the Assignment step. Lists every employee eligible for the shift's
 * selected role/contract (the `employees` prop is already scoped upstream by the
 * orchestrator) and lets the manager either pick one or leave the shift open.
 *
 * Selection is committed on click and the dialog closes immediately — the parent
 * owns the form value and the compliance re-check.
 */

import React, { useMemo, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { cn } from '@/modules/core/lib/utils';
import { Search, X, UserCircle, CheckCircle2, Users } from 'lucide-react';

export interface PoolEmployee {
    id: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    profiles?: { full_name?: string };
}

interface SelectFromPoolModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    employees: PoolEmployee[];
    /** Currently-selected employee id (null = unassigned) */
    selectedId: string | null;
    /** Role name for the header context, if known */
    roleName?: string;
    /** Commit a selection (employee id or null for unassigned) */
    onSelect: (employeeId: string | null) => void;
}

const displayNameOf = (e: PoolEmployee) =>
    e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee';

const initialsOf = (e: PoolEmployee) =>
    `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '??';

export const SelectFromPoolModal: React.FC<SelectFromPoolModalProps> = ({
    open,
    onOpenChange,
    employees,
    selectedId,
    roleName,
    onSelect,
}) => {
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(e => displayNameOf(e).toLowerCase().includes(q));
    }, [employees, query]);

    const commit = (id: string | null) => {
        onSelect(id);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md p-0 gap-0 overflow-hidden border-border bg-card dark:bg-[#0c0d12]">
                <DialogHeader className="px-5 py-4 border-b border-border bg-muted/40">
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
                            <Users className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-[11px] font-black uppercase tracking-[0.18em] text-foreground/90 leading-none">
                                Select From Pool
                            </DialogTitle>
                            <DialogDescription className="text-[10px] text-muted-foreground/70 font-medium mt-1 truncate">
                                {employees.length} eligible{roleName ? ` · ${roleName}` : ''}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {/* Search */}
                <div className="px-5 py-3 border-b border-border">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                        <Input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search employees by name…"
                            className="h-9 pl-9 bg-background border-border text-xs rounded-lg focus:border-indigo-500/40 focus:ring-indigo-500/30"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* List */}
                <ScrollArea className="max-h-[380px]">
                    <div className="p-3 space-y-1.5">
                        {/* Leave Unassigned */}
                        <button
                            type="button"
                            onClick={() => commit(null)}
                            className={cn(
                                'w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-150 text-left',
                                selectedId === null
                                    ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30'
                                    : 'bg-muted/30 border-border hover:bg-muted/50',
                            )}
                        >
                            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center border border-border shrink-0">
                                <UserCircle className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={cn(
                                    'text-sm font-semibold',
                                    selectedId === null ? 'text-indigo-600 dark:text-indigo-400' : 'text-foreground',
                                )}>
                                    Leave Unassigned
                                </p>
                                <p className="text-[10px] text-muted-foreground/50">Keep the shift open</p>
                            </div>
                            {selectedId === null && (
                                <CheckCircle2 className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                            )}
                        </button>

                        {/* Employees */}
                        {filtered.map((emp, i) => {
                            const isSelected = selectedId === emp.id;
                            return (
                                <button
                                    key={emp.id}
                                    type="button"
                                    onClick={() => commit(emp.id)}
                                    style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
                                    className={cn(
                                        'w-full flex items-center gap-3 p-2.5 rounded-xl border text-left',
                                        'animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-both',
                                        'transition-colors',
                                        isSelected
                                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
                                            : 'bg-muted/30 border-border hover:bg-muted/60 hover:border-border',
                                    )}
                                >
                                    <div className={cn(
                                        'h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors',
                                        isSelected
                                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 ring-2 ring-emerald-500/20'
                                            : 'bg-muted text-muted-foreground',
                                    )}>
                                        {initialsOf(emp)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={cn(
                                            'text-sm font-semibold truncate',
                                            isSelected ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
                                        )}>
                                            {displayNameOf(emp)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground/50 font-mono">
                                            ID: {emp.id.slice(0, 8)}…
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                                    )}
                                </button>
                            );
                        })}

                        {filtered.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground/50 text-sm">
                                No employees match your search.
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};

export default SelectFromPoolModal;
