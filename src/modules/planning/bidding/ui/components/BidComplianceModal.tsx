/**
 * BidComplianceModal
 * 
 * Modal dialog that runs compliance checks before allowing an employee to bid on a shift.
 * Reuses the visual ComplianceTabContent for consistent UI/UX with EnhancedAddShiftModal.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import {
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult,
    assignmentEvaluator,
    assignmentResultToComplianceResults,
    getScenarioWindow,
} from '@/modules/compliance';
import { useAuth } from '@/platform/auth/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { ThumbsUp, Loader2, Shield, AlertTriangle, XCircle, Play } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';

function calcNetMinutes(s: { startTime: string; endTime: string; unpaidBreak?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.endTime) - parse(s.startTime);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaidBreak ?? 0));
}

// =============================================================================
// TYPES
// =============================================================================

interface ShiftData {
    id: any;
    role: string;
    organization: string;
    department: string;
    subGroup: string;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    assignedTo: string | null;
    isEligible: boolean;
    ineligibilityReason?: string;
    groupType?: string | null;
    priority?: string | null;
    biddingWindowOpens?: string | null;
    biddingWindowCloses?: string | null;
    isUrgent?: boolean;
    stateId?: string;
    subGroupColor?: string;
    droppedById?: string | null;
}

interface BidComplianceModalProps {
    isOpen: boolean;
    onClose: () => void;
    shift: ShiftData | null;
    onConfirmBid: () => void;
    isPending?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function BidComplianceModal({
    isOpen,
    onClose,
    shift,
    onConfirmBid,
    isPending = false,
}: BidComplianceModalProps) {
    const { user } = useAuth();
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const [isRunningChecks, setIsRunningChecks] = useState(false);
    const [checksComplete, setChecksComplete] = useState(false);

    // Fetch existing shifts for the employee around the target date
    const {
        data: existingShifts = [],
        isLoading: isLoadingShifts,
    } = useQuery({
        queryKey: ['employeeShiftsForCompliance', user?.id, shift?.date],
        queryFn: async () => {
            if (!user?.id || !shift?.date) return [];

            // Fetch shifts ±28 days — covers every constraint's required window.
            const { start: startDate, end: endDate } = getScenarioWindow(shift.date);

            console.log('[BidComplianceModal] Fetching shifts for employee:', user.id);
            console.log('[BidComplianceModal] Date range:', startDate, 'to', endDate);

            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, net_length_minutes, unpaid_break_minutes')
                .eq('assigned_employee_id', user.id)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .eq('is_cancelled', false);

            if (error) {
                console.error('[BidComplianceModal] Error fetching shifts:', error);
                return [];
            }

            console.log('[BidComplianceModal] Found existing shifts:', data?.length, data);
            return data || [];
        },
        enabled: isOpen && !!user?.id && !!shift?.date,
    });

    // Hard validation — kept minimal for bid flow (overlap is handled by solver)
    const hardValidation: HardValidationResult = useMemo(() => {
        return { passed: true, errors: [] };
    }, []);

    // Build compliance input for the rule engine
    // IMPORTANT: The compliance engine expects snake_case property names
    const buildComplianceInput = useCallback((): ComplianceCheckInput => {
        if (!shift || !user) {
            return {
                employee_id: '',
                action_type: 'bid',
                candidate_shift: { shift_date: '', start_time: '', end_time: '' },
                existing_shifts: [],
            };
        }

        console.log('[BidComplianceModal] Building compliance input:', {
            shift,
            existingShifts,
            userId: user.id,
        });

        return {
            employee_id: user.id,
            action_type: 'bid',
            candidate_shift: {
                shift_date: shift.date,
                start_time: shift.startTime + ':00',
                end_time: shift.endTime + ':00',
                unpaid_break_minutes: shift.unpaidBreak || 0,
            },
            existing_shifts: existingShifts.map(s => ({
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                unpaid_break_minutes: s.unpaid_break_minutes || 0,
            })),
        };
    }, [shift, existingShifts, user]);

    const handleRunAllChecks = useCallback(async () => {
        if (!shift || !user) return;

        setIsRunningChecks(true);
        await new Promise(resolve => setTimeout(resolve, 400));

        const input = buildComplianceInput();

        // ── 1. Constraint Solver — all constraints simultaneously (OR-Tools pattern) ──
        //
        // Bidding uses the same AssignmentEvaluator as assignment/add.
        // WORKING_DAYS_CAP is excluded for 'bid' (bids don't commit to days worked yet).
        const toV8Shift = (s: { shift_date: string; start_time: string; end_time: string; unpaid_break_minutes?: number }, idx: number) => ({
            id:                   `existing-${idx}`,
            date:                 s.shift_date,
            shift_date:           s.shift_date,
            start_time:           s.start_time,
            end_time:             s.end_time,
            unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
            is_ordinary_hours:    true,
        });

        const solverResult = assignmentEvaluator.evaluate({
            employee_id:     input.employee_id,
            name:            input.employee_id,
            current_shifts:  input.existing_shifts.map(toV8Shift),
            candidate_shift: {
                id:                   shift.id ? String(shift.id) : 'candidate',
                date:                 input.candidate_shift.shift_date,
                shift_date:           input.candidate_shift.shift_date,
                start_time:           input.candidate_shift.start_time,
                end_time:             input.candidate_shift.end_time,
                unpaid_break_minutes: input.candidate_shift.unpaid_break_minutes ?? 0,
                is_ordinary_hours:    true,
            },
            action_type:     'bid',
        });

        const newResults: Record<string, ComplianceResult | null> = {
            ...assignmentResultToComplianceResults(solverResult, input.employee_id),
        };

        // 2. Server-side checks
        try {
            const serverResult = await validateCompliance({
                employeeId: user.id,
                shiftDate: shift.date,
                startTime: shift.startTime + ':00',
                endTime: shift.endTime + ':00',
                netLengthMinutes: calcNetMinutes(shift),
                shiftId: shift.id
            });

            // Rules 1–3: update with server results
            const updateServerRule = (ruleId: string, name: string) => {
                const violations = serverResult.qualificationViolations.filter(v => 
                    ruleId === 'ROLE_CONTRACT_MATCH' ? v.type === 'ROLE_MISMATCH' :
                    ruleId === 'QUALIFICATION_MATCH' ? (v.type === 'LICENSE_MISSING' || v.type === 'SKILL_MISSING') :
                    v.type === 'LICENSE_EXPIRED' || v.type === 'SKILL_EXPIRED'
                );

                newResults[ruleId] = {
                    rule_id: ruleId,
                    rule_name: name,
                    status: violations.length > 0 ? 'fail' : 'pass',
                    summary: violations.length > 0
                        ? `${violations.length} issue(s) detected`
                        : 'Rule passed successfully',
                    details: violations.length > 0
                        ? violations.map(v => v.message).join('\n')
                        : 'Validation confirmed by server.',
                    blocking: true,
                    calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0, violations }
                };
            };

            updateServerRule('ROLE_CONTRACT_MATCH', 'Role Contract Match');
            updateServerRule('QUALIFICATION_MATCH', 'Qualification & Certification');
            updateServerRule('QUALIFICATION_EXPIRY', 'Qualification Expiry');

            // Override overlap with server result for accuracy if available
            if (serverResult.checksPerformed.includes('overlap')) {
                const hasOverlap = serverResult.violations.some(v => v.toLowerCase().includes('overlap'));
                newResults['NO_OVERLAP'] = {
                    ...newResults['NO_OVERLAP']!,
                    status: hasOverlap ? 'fail' : 'pass',
                    summary: hasOverlap ? 'Overlap detected by server' : 'No overlap confirmed',
                    details: hasOverlap ? 'The server confirms this employee is already scheduled during this time.' : 'Server verified schedule availability.',
                    blocking: true
                };
            }

        } catch (err) {
            console.error('[BidComplianceModal] Server check failed:', err);
        }

        setRuleResults(newResults);
        setIsRunningChecks(false);
        setChecksComplete(true);
    }, [buildComplianceInput, shift, user]);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setRuleResults({});
            setChecksComplete(false);
        }
    }, [isOpen]);

    const isDroppedByMe = useMemo(() => {
        return user?.id === shift?.droppedById;
    }, [user?.id, shift?.droppedById]);

    // Determine if user can proceed
    const canProceed = useMemo(() => {
        if (isDroppedByMe) return false;
        if (!checksComplete) return false;
        if (!hardValidation.passed) return false;

        // Check for blocking failures
        const hasBlockingFailure = Object.values(ruleResults).some(
            r => r?.status === 'fail' && r?.blocking
        );

        return !hasBlockingFailure;
    }, [isDroppedByMe, checksComplete, hardValidation, ruleResults]);

    const hasWarnings = useMemo(() => {
        return Object.values(ruleResults).some(r => r?.status === 'warning');
    }, [ruleResults]);

    if (!shift) return null;

    return (
        <ResponsiveDialog
            open={isOpen}
            onOpenChange={(open) => !open && onClose()}
            dialogClassName="w-[calc(100vw-2rem)] max-w-2xl bg-background border-border shadow-2xl"
        >
            <ResponsiveDialog.Header>
                <ResponsiveDialog.Title className="flex items-center gap-2 text-foreground">
                    <Shield className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
                    Compliance Check
                </ResponsiveDialog.Title>
                <ResponsiveDialog.Description className="text-muted-foreground">
                    Review compliance rules before expressing interest in this shift.
                </ResponsiveDialog.Description>
            </ResponsiveDialog.Header>

            <ResponsiveDialog.Body className="overflow-y-auto max-h-[70dvh]">
                {/* Shift Summary */}
                <div className="bg-muted/50 rounded-xl p-5 border border-border mb-6">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Checking eligibility for:</div>
                    <div className="text-lg font-black text-foreground mb-1">{shift.role}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground/80">{shift.date}</span>
                        <span className="opacity-30">•</span>
                        <span>{shift.startTime} - {shift.endTime}</span>
                        <span className="opacity-30">•</span>
                        <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded text-xs font-bold">
                            {(() => {
                                const h = Math.floor(shift.netLength / 60);
                                const m = Math.round(shift.netLength % 60);
                                return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                            })()}
                        </span>
                    </div>
                    <div className="text-xs text-muted-foreground/70 mt-3 flex items-center gap-1.5 font-medium">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        {shift.organization} <span className="opacity-40">/</span> {shift.department}
                    </div>
                </div>

                {/* Loading State */}
                {(isLoadingShifts || isRunningChecks) && (
                    <div className="flex flex-col items-center justify-center py-16 animate-in fade-in zoom-in duration-300">
                        <div className="relative">
                            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full animate-pulse" />
                            <Loader2 className="h-10 w-10 animate-spin text-indigo-600 dark:text-indigo-400 relative z-10" />
                        </div>
                        <p className="text-muted-foreground mt-4 font-medium">
                            {isLoadingShifts ? "Preparing compliance data..." : "Analyzing compliance rules..."}
                        </p>
                    </div>
                )}

                {/* Dropped Shift Block Alert */}
                {isDroppedByMe && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 mb-6 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <h4 className="text-sm font-black text-rose-700 dark:text-rose-400 uppercase tracking-wider">Bidding Restricted</h4>
                            <p className="text-sm text-rose-600/80 dark:text-rose-400/70 font-medium">
                                You previously dropped this shift. Employees are not permitted to bid on shifts they have recently dropped.
                            </p>
                        </div>
                    </div>
                )}

                {/* Compliance Content - Show whenever not actively running */}
                {!isRunningChecks && !isLoadingShifts && (
                    <ComplianceTabContent
                        hardValidation={hardValidation}
                        ruleResults={ruleResults}
                        onRuleResult={(ruleId, result) => setRuleResults(prev => ({ ...prev, [ruleId]: result }))}
                        buildComplianceInput={buildComplianceInput}
                        onChecksComplete={() => setChecksComplete(true)}
                        onRunAll={handleRunAllChecks}
                        shiftId={shift?.id}
                    />
                )}
            </ResponsiveDialog.Body>

            <ResponsiveDialog.Footer className="mt-8 gap-3">
                    <div className="flex gap-2">
                         <Button
                            variant="outline"
                            onClick={onClose}
                            className="border-border hover:bg-muted font-bold px-6 min-h-[44px]"
                        >
                            Cancel
                        </Button>
                        {checksComplete && (
                            <Button
                                variant="secondary"
                                onClick={handleRunAllChecks}
                                disabled={isRunningChecks}
                                className="gap-2 border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold min-h-[44px]"
                            >
                                <Play className="h-4 w-4 fill-current" />
                                Re-Run Checks
                            </Button>
                        )}
                    </div>

                {checksComplete && (
                    <Button
                        onClick={onConfirmBid}
                        disabled={!canProceed || isPending}
                        className={cn(
                            "gap-2 min-h-[44px] px-8 font-black uppercase tracking-widest shadow-lg transition-all active:scale-95",
                            canProceed
                                ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20"
                                : "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                        )}
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Processing...
                            </>
                        ) : canProceed ? (
                            <>
                                <ThumbsUp className="h-4 w-4" />
                                {hasWarnings ? 'Bid Anyway' : 'Confirm Bid'}
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4" />
                                Ineligible
                            </>
                        )}
                    </Button>
                )}
            </ResponsiveDialog.Footer>
        </ResponsiveDialog>
    );
}

export default BidComplianceModal;
