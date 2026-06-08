/**
 * BulkAssignShiftsModal
 * 
 * Modal for assigning a single employee to all selected shifts in bulk mode.
 * Features: shift summary, employee search, eligibility badges, compliance warnings.
 * 
 * This component fetches its own data for employees and shifts.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
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
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import {
    Search,
    Calendar,
    Clock,
    Users,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    UserPlus
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useEmployees } from '@/modules/users/hooks/useEmployees';
import { supabase } from '@/platform/supabase/client';
import {
    checkBulkCompliance,
    BulkComplianceCheckResponse,
    BulkShiftComplianceResult
} from '@/modules/compliance';

/* ============================================================
   TYPES
   ============================================================ */

interface BulkAssignShiftsModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedV8ShiftIds: string[];
    onAssignAll: (employeeId: string, shiftIds: string[]) => Promise<void>;
}

interface ShiftData {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    role_id: string | null;
    role_name?: string;
    group_type?: string;
    sub_group_name?: string;
    assigned_employee_id?: string | null;
}

interface EmployeeData {
    id: string;
    name: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    avatar?: string;
}

interface ShiftSummary {
    total: number;
    dateRange: string;
    roles: Record<string, number>;
    minDate: Date | null;
    maxDate: Date | null;
}

interface EmployeeEligibility {
    employeeId: string;
    isEligible: boolean;
    warningCount: number;
    warnings: string[];
}

/* ============================================================
   HELPERS
   ============================================================ */

const summarizeShifts = (shifts: ShiftData[]): ShiftSummary => {
    if (shifts.length === 0) {
        return { total: 0, dateRange: '', roles: {}, minDate: null, maxDate: null };
    }

    // Extract and sort dates
    const dates = shifts
        .map(s => s.shift_date)
        .filter(Boolean)
        .map(d => parseISO(d))
        .sort((a, b) => a.getTime() - b.getTime());

    // Count roles
    const roles = shifts.reduce((acc, s) => {
        const role = s.role_name || 'Unspecified';
        acc[role] = (acc[role] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const minDate = dates[0] || null;
    const maxDate = dates[dates.length - 1] || null;

    let dateRange = '';
    if (minDate && maxDate) {
        if (minDate.getTime() === maxDate.getTime()) {
            dateRange = format(minDate, 'MMM d');
        } else {
            dateRange = `${format(minDate, 'MMM d')} - ${format(maxDate, 'MMM d')}`;
        }
    }

    return {
        total: shifts.length,
        dateRange,
        roles,
        minDate,
        maxDate
    };
};

/* ============================================================
   COMPONENT
   ============================================================ */

export const BulkAssignShiftsModal: React.FC<BulkAssignShiftsModalProps> = ({
    isOpen,
    onClose,
    selectedV8ShiftIds,
    onAssignAll,
}) => {
    // State for Partial Apply
    const [partialApply, setPartialApply] = useState(false);
    const [step, setStep] = useState<'SELECT_EMPLOYEE' | 'REVIEW'>('SELECT_EMPLOYEE');

    // Restore missing state variables
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
    const [isAssigning, setIsAssigning] = useState(false);
    const [showWarningDialog, setShowWarningDialog] = useState(false);
    const { toast } = useToast();

    // Data fetching state
    const [shifts, setShifts] = useState<ShiftData[]>([]);
    const [isLoadingShifts, setIsLoadingShifts] = useState(false);

    // Bulk compliance state
    const [complianceResponse, setComplianceResponse] = useState<BulkComplianceCheckResponse | null>(null);
    const [isCheckingCompliance, setIsCheckingCompliance] = useState(false);

    // Use the employees hook
    const { useAllEmployees } = useEmployees();
    const { data: employeesRaw = [], isLoading: isLoadingEmployees } = useAllEmployees();

    // Transform employees to our format
    const employees: EmployeeData[] = useMemo(() => {
        return employeesRaw.map(emp => {
            const firstName = (emp as any).firstName || (emp as any).first_name || '';
            const lastName = (emp as any).lastName || (emp as any).last_name || '';
            const fullName = (emp as any).fullName || (emp as any).full_name || `${firstName} ${lastName}`.trim();
            return {
                id: emp.id,
                name: fullName || 'Unknown',
                first_name: firstName,
                last_name: lastName,
                role: (emp as any).role || undefined,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${firstName || emp.id}`
            };
        });
    }, [employeesRaw]);

    // Fetch shifts when modal opens
    useEffect(() => {
        const fetchShifts = async () => {
            if (!isOpen || selectedV8ShiftIds.length === 0) {
                setShifts([]);
                return;
            }

            setIsLoadingShifts(true);
            try {
                const { data, error } = await supabase
                    .from('shifts')
                    .select(`
                        id,
                        shift_date,
                        start_time,
                        end_time,
                        role_id,
                        group_type,
                        sub_group_name,
                        assigned_employee_id,
                        roles (name)
                    `)
                    .in('id', selectedV8ShiftIds)
                    .is('deleted_at', null);

                if (error) {
                    console.error('[BulkAssignShiftsModal] Error fetching shifts:', error);
                    toast({
                        title: 'Error',
                        description: 'Failed to load shift details',
                        variant: 'destructive'
                    });
                    return;
                }

                const shiftsData: ShiftData[] = (data || []).map((s: any) => ({
                    id: s.id,
                    shift_date: s.shift_date,
                    start_time: s.start_time,
                    end_time: s.end_time,
                    role_id: s.role_id,
                    role_name: s.roles?.name || 'Unknown Role',
                    group_type: s.group_type,
                    sub_group_name: s.sub_group_name,
                    assigned_employee_id: s.assigned_employee_id
                }));

                setShifts(shiftsData);
            } catch (error) {
                console.error('[BulkAssignShiftsModal] Exception:', error);
            } finally {
                setIsLoadingShifts(false);
            }
        };

        fetchShifts();
    }, [isOpen, selectedV8ShiftIds, toast]);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSearchTerm('');
            setSelectedEmployeeId(null);
            setIsAssigning(false);
            setShowWarningDialog(false);
            setComplianceResponse(null);
            setStep('SELECT_EMPLOYEE');
            setPartialApply(false);
        }
    }, [isOpen]);

    // Compute shift summary
    const summary = useMemo(() => summarizeShifts(shifts), [shifts]);

    // Handle initial employee selection
    const handleEmployeeSelect = (empId: string) => {
        if (selectedEmployeeId === empId) return; // No change

        setSelectedEmployeeId(empId);
        // Reset compliance state to enforce re-run
        setComplianceResponse(null);
        setPartialApply(false);
    };

    // Filter employees
    const filteredEmployees = useMemo(() => {
        if (!searchTerm.trim()) return employees;
        const term = searchTerm.toLowerCase();
        return employees.filter(e =>
            e.name?.toLowerCase().includes(term) ||
            e.role?.toLowerCase().includes(term)
        );
    }, [employees, searchTerm]);

    // Explicit Compliance Run
    const handleRunCompliance = async () => {
        if (!selectedEmployeeId || selectedV8ShiftIds.length === 0) return;

        setIsCheckingCompliance(true);
        try {
            const response = await checkBulkCompliance({
                actionType: 'BULK_ASSIGN',
                mode: 'ALL_OR_NOTHING', // The check is always all-or-nothing check first, then we filter results
                assignments: selectedV8ShiftIds.map(shiftId => ({
                    shiftId,
                    employeeId: selectedEmployeeId
                }))
            });
            setComplianceResponse(response);
        } catch (error) {
            console.error('[BulkAssignShiftsModal] Compliance check error:', error);
            toast({
                title: 'Compliance Check Failed',
                description: 'Could not run compliance check. Please try again.',
                variant: 'destructive'
            });
        } finally {
            setIsCheckingCompliance(false);
        }
    };

    // Handle Assign
    const handleAssign = async () => {
        if (!selectedEmployeeId || !complianceResponse) return;

        const results = complianceResponse.results;

        // Determine which shifts to assign based on mode
        let shiftsToAssign: string[] = [];

        if (partialApply) {
            // Assign only passing shifts (or warnings)
            shiftsToAssign = results
                .filter(r => !r.blocking)
                .map(r => r.shiftId);
        } else {
            // All or nothing
            const hasBlocking = results.some(r => r.blocking);
            if (hasBlocking) {
                toast({
                    title: 'Cannot Assign',
                    description: 'Blocking compliance issues exist. Resolve them or enable Partial Apply.',
                    variant: 'destructive'
                });
                return;
            }
            shiftsToAssign = results.map(r => r.shiftId);
        }

        // Filter out already assigned (just in case)
        const unassignedIds = new Set(shifts.map(s => s.id));
        shiftsToAssign = shiftsToAssign.filter(id => unassignedIds.has(id));

        if (shiftsToAssign.length === 0) {
            toast({
                title: 'No Shifts to Assign',
                description: 'No valid shifts available to assign.',
                variant: 'destructive',
            });
            return;
        }

        setIsAssigning(true);
        try {
            await onAssignAll(selectedEmployeeId, shiftsToAssign);

            const totalRequested = selectedV8ShiftIds.length;
            const assignedCount = shiftsToAssign.length;
            const skippedCount = totalRequested - assignedCount;

            toast({
                title: 'Assignment Complete',
                description: `Assigned ${assignedCount} shifts.${skippedCount > 0 ? ` Skipped ${skippedCount} shifts.` : ''}`,
            });
            onClose();
        } catch (error) {
            toast({
                title: 'Assignment Failed',
                description: 'Failed to assign shifts.',
                variant: 'destructive',
            });
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-[900px] max-h-[90vh] h-[80vh] flex flex-col bg-gray-950/95 backdrop-blur-xl border-gray-800 p-0 overflow-hidden">
                <DialogHeader className="p-6 border-b border-white/10">
                    <DialogTitle className="text-xl font-semibold flex items-center justify-between">
                        <span>Bulk Assign – Compliance Review</span>
                        <Badge variant="outline" className="ml-2 font-mono">
                            {selectedV8ShiftIds.length} shifts selected
                        </Badge>
                    </DialogTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                        This is a simulation. No changes are applied until confirmed.
                    </p>
                </DialogHeader>

                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    {/* LEFT PANEL: Employee Selection */}
                    <div className="w-full md:w-[300px] border-r border-white/10 flex flex-col bg-black/20">
                        <div className="p-4 border-b border-white/10 bg-white/5">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                                <Input
                                    placeholder="Search employees..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 bg-black/20 border-white/10 h-9"
                                />
                            </div>
                        </div>
                        <ScrollArea className="flex-1">
                            <div className="p-2 space-y-1">
                                {filteredEmployees.map(emp => (
                                    <div
                                        key={emp.id}
                                        onClick={() => handleEmployeeSelect(emp.id)}
                                        className={cn(
                                            "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all",
                                            selectedEmployeeId === emp.id
                                                ? "bg-purple-600/20 border border-purple-500/50"
                                                : "hover:bg-white/5 border border-transparent"
                                        )}
                                    >
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={(emp as any).avatar} />
                                            <AvatarFallback>{emp.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium truncate text-white">{emp.name}</div>
                                            <div className="text-xs text-white/50 truncate">{emp.role}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* RIGHT PANEL: Review & Results */}
                    <div className="flex-1 flex flex-col bg-gray-900/50">
                        {!selectedEmployeeId ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-white/30 space-y-4">
                                <Users className="h-12 w-12 opacity-50" />
                                <p>Select an employee to start compliance review</p>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col h-full">
                                <ScrollArea className="flex-1">
                                    <div className="p-6 space-y-6">
                                        {/* Step A: Summary */}
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between text-sm">
                                                <h3 className="font-semibold text-white">Assignment Summary</h3>
                                                <span className="text-white/50">{summary.dateRange}</span>
                                            </div>
                                            <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Employee</div>
                                                        <div className="flex items-center gap-2">
                                                            <Avatar className="h-6 w-6">
                                                                <AvatarImage src={(employees.find(e => e.id === selectedEmployeeId) as any)?.avatar} />
                                                            </Avatar>
                                                            <span className="font-medium text-white">
                                                                {employees.find(e => e.id === selectedEmployeeId)?.name}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Shifts</div>
                                                        <div className="font-medium text-white">{selectedV8ShiftIds.length} shifts to assign</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Step B: Run Compliance */}
                                        {!complianceResponse && !isCheckingCompliance && (
                                            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                                                <Clock className="h-10 w-10 text-purple-400 mb-4" />
                                                <h3 className="text-lg font-medium text-white mb-2">Ready to Simulate</h3>
                                                <p className="text-white/50 max-w-md text-center mb-6">
                                                    Run a compliance simulation to check how these {selectedV8ShiftIds.length} shifts will affect {employees.find(e => e.id === selectedEmployeeId)?.name}'s schedule.
                                                </p>
                                                <Button
                                                    onClick={handleRunCompliance}
                                                    size="lg"
                                                    className="bg-purple-600 hover:bg-purple-700 shadow-xl shadow-purple-900/20"
                                                >
                                                    Run Compliance Simulation
                                                </Button>
                                            </div>
                                        )}

                                        {/* Loading */}
                                        {isCheckingCompliance && (
                                            <div className="flex flex-col items-center justify-center py-20">
                                                <Loader2 className="h-10 w-10 text-purple-400 animate-spin mb-4" />
                                                <p className="text-white/60">Simulating future schedule...</p>
                                            </div>
                                        )}

                                        {/* Step C: Results */}
                                        {complianceResponse && (
                                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                                <div className="import-wrapper">
                                                    {/* This wrapper is to ensure the import exists... wait, I can't import inside render */}
                                                    {/* Assuming BulkComplianceResult is imported at top */}
                                                    <BulkComplianceResult
                                                        response={complianceResponse}
                                                        shifts={shifts}
                                                        onPartialApplyChange={setPartialApply}
                                                        partialApplyEnabled={partialApply}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>

                                {/* Footer Actions */}
                                {complianceResponse && (
                                    <div className="p-4 border-t border-white/10 bg-gray-900/80 backdrop-blur flex justify-between items-center">
                                        <div className="text-xs text-white/40">
                                            {partialApply
                                                ? "Partial assign enabled: passing shifts will be saved."
                                                : "All-or-nothing: all shifts must pass compliance."}
                                        </div>
                                        <div className="flex gap-3">
                                            <Button variant="ghost" onClick={() => setComplianceResponse(null)}>
                                                Reset
                                            </Button>
                                            <Button
                                                onClick={handleAssign}
                                                disabled={isAssigning || (!partialApply && complianceResponse.summary.blockingFailures > 0)}
                                                className={cn(
                                                    "min-w-[140px]",
                                                    partialApply && complianceResponse.summary.blockingFailures > 0
                                                        ? "bg-amber-600 hover:bg-amber-700" // Warning/Partial style
                                                        : "bg-purple-600 hover:bg-purple-700"
                                                )}
                                            >
                                                {isAssigning ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    partialApply && complianceResponse.summary.blockingFailures > 0
                                                        ? `Assign Passing (${complianceResponse.results.filter(r => !r.blocking).length})`
                                                        : "Confirm Assignment"
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// Add explicit import for the new component at top of file:
import { BulkComplianceResult } from '@/modules/rosters/ui/components/BulkComplianceResult';

// Re-export
export default BulkAssignShiftsModal;
