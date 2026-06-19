/**
 * AssignmentStep — Two-pane layout for Employee Assignment + Compliance Inspector
 *
 * Left Pane: Employee Pool — searchable list of employees with hover/select
 * Right Pane: Compliance Inspector — dynamic compliance checks per employee
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/modules/core/lib/utils';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import {
    Users,
    Shield,
    Search,
    UserCircle,
    CheckCircle2,
    AlertTriangle,
    Gavel,
    X,
    Zap,
    MousePointer2,
} from 'lucide-react';
import type { AssignmentStepProps } from '../types';

/* ═══════════════════════════════════════════════════════════════════════
   EMPLOYEE CARD — compact card for the employee list
   ═══════════════════════════════════════════════════════════════════════ */
const EmployeeCard = ({
    employee,
    isSelected,
    isHovered,
    onSelect,
    onHover,
    onLeave,
}: {
    employee: { id: string; first_name: string; last_name: string; full_name?: string; profiles?: { full_name?: string } };
    isSelected: boolean;
    isHovered: boolean;
    onSelect: () => void;
    onHover: () => void;
    onLeave: () => void;
}) => {
    const displayName = employee.profiles?.full_name || employee.full_name || `${employee.first_name} ${employee.last_name}`;
    const initials = `${employee.first_name?.[0] || ''}${employee.last_name?.[0] || ''}`.toUpperCase();

    return (
        <button
            type="button"
            onClick={onSelect}
            onMouseEnter={onHover}
            onMouseLeave={onLeave}
            className={cn(
                'w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left group/emp',
                isSelected
                    ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_20px_-5px_rgba(16,185,129,0.2)]'
                    : isHovered
                        ? 'bg-white/[0.04] border-white/15 shadow-md'
                        : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
            )}
        >
            {/* Avatar */}
            <div className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all',
                isSelected
                    ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/30'
                    : 'bg-muted/50 text-muted-foreground group-hover/emp:bg-muted group-hover/emp:text-foreground'
            )}>
                {initials}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className={cn(
                    'text-sm font-semibold truncate transition-colors',
                    isSelected ? 'text-emerald-500' : 'text-foreground/80 group-hover/emp:text-foreground'
                )}>
                    {displayName}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                    ID: {employee.id.slice(0, 8)}…
                </p>
            </div>

            {/* Selected indicator */}
            {isSelected && (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            )}
        </button>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   ASSIGNMENT STEP MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export const AssignmentStep: React.FC<AssignmentStepProps> = ({
    form,
    isReadOnly,
    isLoadingData,
    isTemplateMode,
    employees,
    isEmployeeLocked,
    existingShift,
    // Compliance
    watchEmployeeId,
    hardValidation,
    compliancePanel,
    runChecks,
    clearResults,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);

    const selectedEmployeeId = form.watch('assigned_employee_id');

    // Debounced compliance run on hover
    React.useEffect(() => {
        const targetId = hoveredEmployeeId || selectedEmployeeId;
        
        if (!targetId) {
            // No target, clear if there were results (prevent leak)
            return;
        }

        const timer = setTimeout(() => {
            runChecks(targetId);
        }, 300);

        return () => clearTimeout(timer);
    }, [hoveredEmployeeId, selectedEmployeeId, runChecks]);

    // Filtered employees
    const filteredEmployees = useMemo(() => {
        if (!searchQuery.trim()) return employees;
        const q = searchQuery.toLowerCase();
        return employees.filter(emp => {
            const name = `${emp.first_name} ${emp.last_name}`.toLowerCase();
            const fullName = (emp.profiles?.full_name || emp.full_name || '').toLowerCase();
            return name.includes(q) || fullName.includes(q);
        });
    }, [employees, searchQuery]);

    const handleSelectEmployee = (employeeId: string | null) => {
        if (isReadOnly || isEmployeeLocked) return;
        form.setValue('assigned_employee_id', employeeId, { shouldDirty: true });
        
        if (employeeId) {
            // Trigger immediately on click
            runChecks(employeeId);
        } else {
            // Unassigned selected
            clearResults();
        }
    };

    // Active employee for the compliance pane (hovered or selected)
    const inspectedEmployeeId = hoveredEmployeeId || selectedEmployeeId;
    const inspectedEmployee = employees.find(e => e.id === inspectedEmployeeId);

    return (
        <div className="flex flex-col lg:flex-row gap-4 h-[calc(100%-1rem)]" style={{ minHeight: '480px' }}>
            {/* ═══════ LEFT PANE: EMPLOYEE POOL ═══════ */}
            <div className="w-full lg:w-[45%] flex flex-col rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-border bg-muted/50 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                        <Users className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-bold text-foreground tracking-tight uppercase">Employee Pool</h3>
                        <p className="text-[10px] text-muted-foreground font-medium">
                            {filteredEmployees.length} available · Hover to inspect
                        </p>
                    </div>
                </div>

                {/* Search */}
                <div className="px-4 py-3 border-b border-border">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search employees..."
                            className="h-9 pl-9 bg-muted/50 border-border text-foreground text-sm rounded-xl focus:border-cyan-500/30"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Emergency Assign Warning */}
                {(() => {
                    let isLocked = false;
                    if (existingShift && existingShift.shift_date && existingShift.start_time) {
                        const [h, m] = existingShift.start_time.split(':').map(Number);
                        const shiftStart = new Date(existingShift.shift_date);
                        shiftStart.setHours(h, m, 0, 0);
                        const now = new Date(); // approximate, enough for UI warning
                        const diffMs = shiftStart.getTime() - now.getTime();
                        const diffHours = diffMs / (1000 * 60 * 60);
                        if (diffHours >= 0 && diffHours <= 4) isLocked = true;
                    }
                    if (!isLocked) return null;

                    return (
                        <div className="mx-4 mt-3 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
                            <div className="flex items-start gap-2">
                                <Zap className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-[11px] font-bold text-orange-400 uppercase tracking-wider">Emergency Assignment</p>
                                    <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                                        The standard offer window has closed. Assigning an employee now will bypass bidding and require direct confirmation.
                                    </p>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Bidding Warning */}
                {existingShift?.is_on_bidding && (
                    <div className="mx-4 mt-3 p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                        <div className="flex items-start gap-2">
                            <Gavel className="h-4 w-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-[11px] font-medium text-indigo-300">On Bidding</p>
                                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                    Assigning will close bidding and assign directly.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Template Mode Warning */}
                {isTemplateMode && (
                    <div className="mx-4 mt-3 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-[11px] font-medium text-amber-300">Templates Only</p>
                                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                    Assign employees when applying the template to a roster.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Employee List */}
                <ScrollArea className="flex-1 px-4 py-3">
                    <div className="space-y-2">
                        {/* Unassigned Option */}
                        <button
                            type="button"
                            onClick={() => handleSelectEmployee(null)}
                            disabled={isReadOnly || isEmployeeLocked || isTemplateMode}
                            onMouseEnter={() => setHoveredEmployeeId(null)}
                            className={cn(
                                'w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left',
                                !selectedEmployeeId
                                    ? 'bg-accent border-border shadow-md'
                                    : 'bg-muted/30 border-border hover:bg-accent hover:border-border',
                                (isReadOnly || isEmployeeLocked || isTemplateMode) && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                                <UserCircle className="h-5 w-5 text-muted-foreground/40" />
                            </div>
                            <div>
                                <p className={cn(
                                    'text-sm font-semibold',
                                    !selectedEmployeeId ? 'text-foreground' : 'text-muted-foreground/50'
                                )}>
                                    Unassigned
                                </p>
                                <p className="text-[10px] text-muted-foreground/40">Leave shift open</p>
                            </div>
                            {!selectedEmployeeId && (
                                <CheckCircle2 className="h-5 w-5 text-emerald-500/80 ml-auto flex-shrink-0" />
                            )}
                        </button>

                        {/* Employee Cards */}
                        {!isTemplateMode && filteredEmployees.map(emp => (
                            <EmployeeCard
                                key={emp.id}
                                employee={emp}
                                isSelected={selectedEmployeeId === emp.id}
                                isHovered={hoveredEmployeeId === emp.id}
                                onSelect={() => handleSelectEmployee(emp.id)}
                                onHover={() => setHoveredEmployeeId(emp.id)}
                                onLeave={() => setHoveredEmployeeId(null)}
                            />
                        ))}

                        {!isTemplateMode && filteredEmployees.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground/40 text-sm">
                                No employees match your search.
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {/* Notes under employee list */}
                {selectedEmployeeId && !isTemplateMode && (
                    <div className="px-4 py-3 border-t border-border bg-muted/20">
                        <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wide font-bold mb-1">Selected</p>
                        <p className="text-sm text-emerald-500 font-semibold">
                            {inspectedEmployee
                                ? (inspectedEmployee.profiles?.full_name || inspectedEmployee.full_name || `${inspectedEmployee.first_name} ${inspectedEmployee.last_name}`)
                                : 'Unknown'}
                        </p>
                    </div>
                )}
            </div>

            {/* ═══════ RIGHT PANE: COMPLIANCE INSPECTOR ═══════ */}
            <div className="w-full lg:w-[55%] flex flex-col rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-border bg-muted/50 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                        <Shield className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-bold text-foreground tracking-tight uppercase">Compliance Inspector</h3>
                        <p className="text-[10px] text-muted-foreground font-medium">
                            {inspectedEmployee
                                ? `Inspecting: ${inspectedEmployee.profiles?.full_name || inspectedEmployee.full_name || `${inspectedEmployee.first_name} ${inspectedEmployee.last_name}`}`
                                : hoveredEmployeeId
                                    ? 'Loading...'
                                    : 'Select an employee first!'}
                        </p>
                    </div>
                </div>

                {/* Compliance Content */}
                <ScrollArea className="flex-1">
                    <div className="p-4 h-full">
                        {isTemplateMode && !watchEmployeeId ? (
                            <div className="text-center py-16 border border-border rounded-xl bg-muted/50">
                                <Shield className="h-12 w-12 text-emerald-500 mx-auto mb-4 opacity-60" />
                                <h3 className="text-base font-semibold text-foreground mb-2">Compliance Checks Passed</h3>
                                <p className="text-muted-foreground/60 max-w-sm mx-auto text-sm">
                                    Templated shifts are validated when assigned to an employee.
                                    You can proceed without further checks.
                                </p>
                            </div>
                        ) : !inspectedEmployeeId ? (
                             <div className="flex flex-col items-center justify-center py-20 text-center opacity-60">
                                <div className="p-4 rounded-full bg-muted mb-4">
                                    <MousePointer2 className="h-8 w-8 text-muted-foreground/50" />
                                </div>
                                <h4 className="text-sm font-bold text-foreground mb-1 uppercase tracking-wider">Select an employee first!</h4>
                                <p className="text-xs text-muted-foreground max-w-[200px]">
                                    Hover over or select an employee from the pool to run compliance checks.
                                </p>
                            </div>
                        ) : (
                            <CompliancePanel hook={compliancePanel} />
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
};
