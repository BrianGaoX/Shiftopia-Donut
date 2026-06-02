import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addDays, subDays } from 'date-fns';
import {
    Loader2,
    ShieldCheck,
    ShieldAlert,
    AlertTriangle,
    X,
    User,
    Calendar,
    Clock
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { supabase } from '@/platform/realtime/client';
import { cn } from '@/modules/core/lib/utils';
import {
    runHardValidation,
    runRule,
    getRegisteredRules,
    ComplianceCheckInput,
    ComplianceResult,
    HardValidationResult,
    ShiftTimeRange
} from '@/modules/compliance';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import { EmployeeBid, ManagerBidShift } from './types';

interface ComplianceDiagnosticDialogProps {
    isOpen: boolean;
    onClose: () => void;
    shift: ManagerBidShift | null;
    bid: EmployeeBid | null;
    onAssign: (bid: EmployeeBid) => Promise<void>;
    isAssigning: boolean;
}

const SYDNEY_TZ = 'Australia/Sydney';

export const ComplianceDiagnosticDialog: React.FC<ComplianceDiagnosticDialogProps> = ({
    isOpen,
    onClose,
    shift,
    bid,
    onAssign,
    isAssigning
}) => {
    const [isLoadingShifts, setIsLoadingShifts] = useState(false);
    const [employeeShifts, setEmployeeShifts] = useState<ShiftTimeRange[]>([]);
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const [hardValidation, setHardValidation] = useState<HardValidationResult>({ passed: true, errors: [] });
    const [hasRun, setHasRun] = useState(false);

    // 1. Fetch Existing Shifts for Context
    useEffect(() => {
        if (!isOpen || !bid || !shift) {
            setHasRun(false);
            setRuleResults({});
            return;
        }

        const fetchShifts = async () => {
            setIsLoadingShifts(true);
            const shiftDate = new Date(shift.date);
            const startDate = format(subDays(shiftDate, 14), 'yyyy-MM-dd');
            const endDate = format(addDays(shiftDate, 14), 'yyyy-MM-dd');

            try {
                const { data, error } = await supabase
                    .from('shifts')
                    .select('id, start_time, end_time, shift_date, unpaid_break_minutes')
                    .eq('assigned_employee_id', bid.employeeId)
                    .gte('shift_date', startDate)
                    .lte('shift_date', endDate)
                    .is('deleted_at', null)
                    .eq('is_cancelled', false);

                if (!error && data) {
                    // Filter out current shift if it's already assigned (though in bidding it shouldn't be)
                    const mapped = data
                        .filter(s => s.id !== shift.id)
                        .map(s => ({
                            start_time: s.start_time,
                            end_time: s.end_time,
                            shift_date: s.shift_date,
                            unpaid_break_minutes: s.unpaid_break_minutes || 0
                        }));
                    setEmployeeShifts(mapped);
                }
            } catch (err) {
                console.error('Error fetching employee shifts:', err);
            } finally {
                setIsLoadingShifts(false);
            }
        };

        fetchShifts();
    }, [isOpen, bid, shift]);

    // 2. Run Engine when data is ready
    const buildComplianceInput = useCallback((): ComplianceCheckInput => {
        if (!shift || !bid) throw new Error('Missing shift or bid context');

        return {
            employee_id: bid.employeeId,
            action_type: 'bid',
            candidate_shift: {
                start_time: shift.startTime,
                end_time: shift.endTime,
                shift_date: shift.date,
                unpaid_break_minutes: shift.unpaidBreak || 0,
            },
            existing_shifts: employeeShifts,
        };
    }, [shift, bid, employeeShifts]);

    const runAllChecks = useCallback(async () => {
        if (!shift || !bid) return;

        const input = buildComplianceInput();

        // Hard Validation (Layer 1)
        const hv = runHardValidation({
            shift_date: input.candidate_shift.shift_date,
            start_time: input.candidate_shift.start_time,
            end_time: input.candidate_shift.end_time,
            employee_id: input.employee_id,
            existing_shifts: input.existing_shifts,
            current_time: new Date(), // Use local time for comparison in bidder
            is_template: false
        });
        setHardValidation(hv);

        // Rule Engines (Layer 2)
        const rules = getRegisteredRules();
        const newResults: Record<string, ComplianceResult | null> = {};
        for (const rule of rules) {
            newResults[rule.id] = (await runRule(rule.id, input)) as any;
        }

        setRuleResults(newResults);
        setHasRun(true);
    }, [shift, bid, employeeShifts, buildComplianceInput]);

    useEffect(() => {
        if (isOpen && !isLoadingShifts && bid && shift && employeeShifts.length >= 0 && !hasRun) {
            runAllChecks();
        }
    }, [isOpen, isLoadingShifts, bid, shift, employeeShifts, hasRun, runAllChecks]);

    // 3. Status Summary
    const stats = useMemo(() => {
        const results = Object.values(ruleResults).filter(Boolean) as ComplianceResult[];
        const blockingFails = results.filter(r => r.status === 'fail' && r.blocking).length + (hardValidation.passed ? 0 : 1);
        const warnings = results.filter(r => r.status === 'warning').length;
        const passed = results.filter(r => r.status === 'pass').length + (hardValidation.passed ? 1 : 0);

        return { blockingFails, warnings, passed };
    }, [ruleResults, hardValidation]);

    if (!shift || !bid) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 bg-card border-border overflow-hidden shadow-3xl rounded-[2rem]">
                <DialogHeader className="px-8 py-6 border-b border-border bg-muted/30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm shadow-primary/5">
                                <ShieldCheck className="h-7 w-7" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black text-foreground tracking-tight">Compliance Diagnostic</DialogTitle>
                                <div className="flex items-center gap-2 mt-1.5">
                                    <Badge variant="outline" className="bg-primary text-primary-foreground border-none px-2 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-lg shadow-primary/20">
                                        Full Engine v2.0
                                    </Badge>
                                    <span className="text-muted-foreground/60 text-[11px] font-mono font-black uppercase tracking-wider italic">Verifying {bid.employeeName}</span>
                                </div>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-xl hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-all">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 flex flex-col">
                    {/* Quick Context Bar */}
                    <div className="bg-muted/10 px-8 py-4 border-b border-border grid grid-cols-3 gap-6">
                        <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest">
                            <User className="h-4 w-4 text-primary/40" />
                            <span className="text-muted-foreground/50">Employee:</span>
                            <span className="text-foreground truncate">{bid.employeeName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest">
                            <Calendar className="h-4 w-4 text-primary/40" />
                            <span className="text-muted-foreground/50">Date:</span>
                            <span className="text-foreground">{format(new Date(shift.date), 'EEE, MMM d')}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest">
                            <Clock className="h-4 w-4 text-primary/40" />
                            <span className="text-muted-foreground/50">Time:</span>
                            <span className="text-foreground">{shift.startTime} - {shift.endTime}</span>
                        </div>
                    </div>

                    <ScrollArea className="flex-1">
                        <div className="p-6">
                            {isLoadingShifts ? (
                                <div className="flex flex-col items-center justify-center py-24 gap-6">
                                    <div className="relative">
                                        <Loader2 className="h-12 w-12 animate-spin text-primary/40" />
                                        <ShieldCheck className="h-6 w-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                    </div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 animate-pulse">Running diagnostic engine…</p>
                                </div>
                            ) : (
                                <ComplianceTabContent
                                    hardValidation={hardValidation}
                                    buildComplianceInput={buildComplianceInput}
                                    ruleResults={ruleResults}
                                    onRuleResult={(id, r) => setRuleResults(prev => ({ ...prev, [id]: r }))}
                                    onChecksComplete={() => { }}
                                    shiftId={shift?.id}
                                />
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <DialogFooter className="px-8 py-5 border-t border-border bg-muted/30 flex items-center justify-between sm:justify-between">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className={cn("h-2.5 w-2.5 rounded-full", stats.blockingFails > 0 ? "bg-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]" : "bg-muted")} />
                            <span className="text-[10px] uppercase font-black text-muted-foreground/60 tracking-[0.1em] font-mono">Blockers: {stats.blockingFails}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={cn("h-2.5 w-2.5 rounded-full", stats.warnings > 0 ? "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.4)]" : "bg-muted")} />
                            <span className="text-[10px] uppercase font-black text-muted-foreground/60 tracking-[0.1em] font-mono">Warnings: {stats.warnings}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button variant="ghost" onClick={onClose} disabled={isAssigning} className="text-muted-foreground/60 hover:text-foreground hover:bg-muted font-black uppercase tracking-widest text-[11px] rounded-xl px-4">
                            Cancel
                        </Button>
                        <Button
                            className={cn(
                                "min-w-[160px] h-11 font-black uppercase tracking-[0.15em] text-[11px] rounded-xl transition-all duration-300 shadow-lg",
                                stats.blockingFails > 0
                                    ? "bg-muted text-muted-foreground/30 border-none shadow-none cursor-not-allowed"
                                    : stats.warnings > 0
                                        ? "bg-amber-500 hover:bg-amber-600 text-amber-950 shadow-amber-500/30"
                                        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20"
                            )}
                            disabled={isAssigning || stats.blockingFails > 0}
                            onClick={() => onAssign(bid)}
                        >
                            {isAssigning ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Assigning...
                                </>
                            ) : stats.blockingFails > 0 ? (
                                <>
                                    <ShieldAlert className="h-4 w-4 mr-2" />
                                    Blocked
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="h-4 w-4 mr-2" />
                                    {stats.warnings > 0 ? 'Force Assign' : 'Assign Shift'}
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
