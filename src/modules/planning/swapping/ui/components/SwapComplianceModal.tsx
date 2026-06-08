/**
 * SwapComplianceModal
 *
 * Validates compliance for both parties before an employee can offer a swap.
 *
 * Architecture:
 *   Uses the Constraint Solver (src/modules/compliance/solver) instead of
 *   sequential per-rule checks. The solver builds a hypothetical schedule
 *   for BOTH parties simultaneously and evaluates all constraints at once —
 *   the same approach used in airline and hospital scheduling systems.
 *
 *   Solver flow:
 *     1. ScenarioBuilder  — applies the swap to both rosters hypothetically
 *     2. V8SwapEngine — evaluates ALL constraints simultaneously
 *     3. SolverResult     — feasible / infeasible + per-party violations
 *     4. Adapter          — converts to ComplianceResult map for the UI
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import {
    ComplianceResult,
    HardValidationResult,
    HardValidationError,
    swapEvaluator,
    solverResultToComplianceResults,
    getScenarioWindow,
} from '@/modules/compliance';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { Loader2, Shield, ArrowRightLeft, Play, Send } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';

function calcNetMinutes(s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

// =============================================================================
// TYPES
// =============================================================================

interface ShiftData {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
    role_name?: string;
    department_name?: string;
}

interface SwapComplianceModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The shift we are OFFERING (our shift — given away by offerer). */
    offeredShift: ShiftData | null;
    /** The requester's original shift (the one they are swapping OUT). */
    requesterShift: ShiftData | null;
    requesterId: string | null;
    requesterName: string;
    offererId: string | null;
    offererName: string;
    onConfirmOffer: () => void;
    isSubmitting?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SwapComplianceModal({
    isOpen,
    onClose,
    offeredShift,
    requesterShift,
    requesterId,
    requesterName,
    offererId,
    offererName,
    onConfirmOffer,
    isSubmitting = false,
}: SwapComplianceModalProps) {
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const [isRunningChecks, setIsRunningChecks] = useState(false);
    const [checksComplete, setChecksComplete] = useState(false);

    // -------------------------------------------------------------------------
    // Roster fetches (both parties, ±30 days)
    // -------------------------------------------------------------------------

    const { data: requesterRoster = [] } = useQuery({
        queryKey: ['requesterRosterForSwapCompliance', requesterId, offeredShift?.shift_date],
        queryFn: async () => {
            if (!requesterId || !offeredShift?.shift_date) return [];
            const { start: startDate, end: endDate } = getScenarioWindow(offeredShift.shift_date);
            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', requesterId)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .is('is_cancelled', false);
            if (error) return [];
            return data || [];
        },
        enabled: isOpen && !!requesterId && !!offeredShift?.shift_date,
    });

    const { data: offererRoster = [] } = useQuery({
        queryKey: ['offererRosterForSwapCompliance', offererId, requesterShift?.shift_date],
        queryFn: async () => {
            if (!offererId || !requesterShift?.shift_date) return [];
            const { start: startDate, end: endDate } = getScenarioWindow(requesterShift.shift_date);
            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', offererId)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .is('is_cancelled', false);
            if (error) return [];
            return data || [];
        },
        enabled: isOpen && !!offererId && !!requesterShift?.shift_date,
    });

    // -------------------------------------------------------------------------
    // Hard validation (overlap pre-check — instant, before solver)
    // -------------------------------------------------------------------------

    const hardValidation: HardValidationResult = useMemo(() => {
        const errors: HardValidationError[] = [];

        // Requester takes offeredShift — check for overlap with their current schedule
        if (offeredShift && requesterId) {
            const theirSchedule = requesterRoster.filter(s => s.id !== requesterShift?.id);
            const sameDayShifts = theirSchedule.filter(s => s.shift_date === offeredShift.shift_date);
            const cs = offeredShift.start_time.slice(0, 5);
            const ce = offeredShift.end_time.slice(0, 5);
            for (const ex of sameDayShifts) {
                if (cs < ex.end_time.slice(0, 5) && ce > ex.start_time.slice(0, 5)) {
                    errors.push({ field: 'time', rule: 'OVERLAP', message: `[${requesterName}] Overlap with existing shift (${ex.start_time.slice(0, 5)} - ${ex.end_time.slice(0, 5)})` });
                }
            }
        }

        // Offerer takes requesterShift — check for overlap with their current schedule
        if (requesterShift && offererId) {
            const theirSchedule = offererRoster.filter(s => s.id !== offeredShift?.id);
            const sameDayShifts = theirSchedule.filter(s => s.shift_date === requesterShift.shift_date);
            const cs = requesterShift.start_time.slice(0, 5);
            const ce = requesterShift.end_time.slice(0, 5);
            for (const ex of sameDayShifts) {
                if (cs < ex.end_time.slice(0, 5) && ce > ex.start_time.slice(0, 5)) {
                    errors.push({ field: 'time', rule: 'OVERLAP', message: `[${offererName}] Overlap with existing shift (${ex.start_time.slice(0, 5)} - ${ex.end_time.slice(0, 5)})` });
                }
            }
        }

        return { passed: errors.length === 0, errors };
    }, [offeredShift, requesterShift, requesterRoster, offererRoster, requesterId, offererId, requesterName, offererName]);

    // -------------------------------------------------------------------------
    // Reset when modal closes
    // -------------------------------------------------------------------------

    useEffect(() => {
        if (!isOpen) {
            setRuleResults({});
            setChecksComplete(false);
        }
    }, [isOpen]);

    // -------------------------------------------------------------------------
    // Main compliance check — uses the Constraint Solver
    // -------------------------------------------------------------------------

    const handleRunAllChecks = useCallback(async () => {
        if (!offeredShift || !requesterShift || !requesterId || !offererId) return;

        setIsRunningChecks(true);
        await new Promise(resolve => setTimeout(resolve, 300));

        // ── Layer 1–3: Constraint Solver ──────────────────────────────────────
        //
        // Build hypothetical scenario for both parties simultaneously,
        // then evaluate ALL constraints at once (no sequential rule loop).
        //
        // partyA = requester: gives requesterShift, receives offeredShift
        // partyB = offerer:   gives offeredShift,   receives requesterShift

        const solverResult = swapEvaluator.evaluate({
            partyA: {
                employee_id: requesterId,
                name: requesterName,
                current_shifts: requesterRoster as any,
                shift_to_give: requesterShift as any,
            },
            partyB: {
                employee_id: offererId,
                name: offererName,
                current_shifts: offererRoster as any,
                shift_to_give: offeredShift as any,
            },
        });

        // Adapt solver output → ComplianceResult map expected by ComplianceTabContent
        const newResults: Record<string, ComplianceResult | null> =
            solverResultToComplianceResults(solverResult, requesterId);

        // ── Layer 4: Server-side checks (qualifications, authoritative overlap) ─

        try {
            const [serverReq, serverOff] = await Promise.all([
                // Requester takes offeredShift
                validateCompliance({
                    employeeId: requesterId,
                    shiftDate: offeredShift.shift_date,
                    startTime: offeredShift.start_time,
                    endTime: offeredShift.end_time,
                    netLengthMinutes: calcNetMinutes(offeredShift),
                    shiftId: offeredShift.id,
                    excludeV8ShiftId: requesterShift.id,
                }),
                // Offerer takes requesterShift
                validateCompliance({
                    employeeId: offererId,
                    shiftDate: requesterShift.shift_date,
                    startTime: requesterShift.start_time,
                    endTime: requesterShift.end_time,
                    netLengthMinutes: calcNetMinutes(requesterShift),
                    shiftId: requesterShift.id,
                    excludeV8ShiftId: offeredShift.id,
                }),
            ]);

            const mergeServerRule = (ruleId: string, name: string) => {
                const reqV = serverReq.qualificationViolations.filter(v =>
                    ruleId === 'ROLE_CONTRACT_MATCH' ? v.type === 'ROLE_MISMATCH' :
                    ruleId === 'QUALIFICATION_MATCH' ? (v.type === 'LICENSE_MISSING' || v.type === 'SKILL_MISSING') :
                    (v.type === 'LICENSE_EXPIRED' || v.type === 'SKILL_EXPIRED')
                );
                const offV = serverOff.qualificationViolations.filter(v =>
                    ruleId === 'ROLE_CONTRACT_MATCH' ? v.type === 'ROLE_MISMATCH' :
                    ruleId === 'QUALIFICATION_MATCH' ? (v.type === 'LICENSE_MISSING' || v.type === 'SKILL_MISSING') :
                    (v.type === 'LICENSE_EXPIRED' || v.type === 'SKILL_EXPIRED')
                );

                const hasReqFail = reqV.length > 0;
                const hasOffFail = offV.length > 0;

                newResults[ruleId] = {
                    rule_id: ruleId,
                    rule_name: name,
                    status: (hasReqFail || hasOffFail) ? 'fail' : 'pass',
                    summary: (hasReqFail && hasOffFail)
                        ? `Both parties failed ${name}`
                        : hasReqFail ? `[${requesterName}] Failed ${name}`
                        : hasOffFail ? `[${offererName}] Failed ${name}`
                        : `Both parties passed ${name}`,
                    details: [
                        ...(hasReqFail ? reqV.map(v => `[${requesterName}] ${v.message}`) : []),
                        ...(hasOffFail ? offV.map(v => `[${offererName}] ${v.message}`) : []),
                    ].join('\n'),
                    blocking: true,
                    calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                };
            };

            mergeServerRule('ROLE_CONTRACT_MATCH', 'Role Contract Match');
            mergeServerRule('QUALIFICATION_MATCH', 'Qualification & Certification');
            mergeServerRule('QUALIFICATION_EXPIRY', 'Qualification Expiry');

            // Server overlap is authoritative — override solver result if needed
            const reqOverlap = serverReq.violations.some(v => v.toLowerCase().includes('overlap'));
            const offOverlap = serverOff.violations.some(v => v.toLowerCase().includes('overlap'));

            if (reqOverlap || offOverlap) {
                const serverDetail = (reqOverlap && offOverlap)
                    ? 'Server confirmed schedule conflicts for both employees.'
                    : reqOverlap
                        ? `Server confirmed a schedule conflict for ${requesterName}.`
                        : `Server confirmed a schedule conflict for ${offererName}.`;

                newResults['NO_OVERLAP'] = {
                    ...(newResults['NO_OVERLAP'] || {
                        rule_id: 'NO_OVERLAP',
                        rule_name: 'No Overlapping Shifts',
                        blocking: true,
                        calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                    }),
                    status: 'fail',
                    summary: (reqOverlap && offOverlap) ? 'Overlap detected for both parties' :
                             reqOverlap ? `[${requesterName}] Overlap detected by server` :
                             `[${offererName}] Overlap detected by server`,
                    details: serverDetail,
                    blocking: true,
                };
            }
        } catch (err) {
            console.error('[SwapComplianceModal] Server check failed:', err);
        }

        setRuleResults(newResults);
        setIsRunningChecks(false);
        setChecksComplete(true);
    }, [
        offeredShift, requesterShift, requesterId, offererId,
        requesterRoster, offererRoster, requesterName, offererName,
    ]);

    // -------------------------------------------------------------------------
    // Derived state
    // -------------------------------------------------------------------------

    const failureAnalysis = useMemo(() => {
        if (!checksComplete) return null;
        const failures = Object.values(ruleResults || {}).filter(r => r?.status === 'fail');
        if (failures.length === 0) return null;

        const myFailures = failures.filter(f => f?.summary.includes(`[${offererName}`));
        const theirFailures = failures.filter(f => f?.summary.includes(`[${requesterName}]`));

        if (myFailures.length > 0 && theirFailures.length > 0) return 'BOTH_FAILED';
        if (myFailures.length > 0) return 'YOU_FAILED';
        if (theirFailures.length > 0) return 'THEY_FAILED';
        return 'UNKNOWN_FAILURE';
    }, [ruleResults, checksComplete, offererName, requesterName]);

    const canProceed = useMemo(() => {
        if (!checksComplete) return false;
        if (!hardValidation.passed) return false;
        return !Object.values(ruleResults).some(r => r?.status === 'fail' && r?.blocking);
    }, [checksComplete, hardValidation, ruleResults]);

    const hasWarnings = useMemo(
        () => Object.values(ruleResults).some(r => r?.status === 'warning'),
        [ruleResults],
    );

    if (!offeredShift) return null;

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------

    return (
        <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()} dialogClassName="w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border-white/10" drawerClassName="h-[85dvh]">
                <ResponsiveDialog.Header>
                    <ResponsiveDialog.Title className="flex items-center gap-2 text-white">
                        <Shield className="h-5 w-5 text-purple-400" />
                        Swap Compliance Check (2-Way)
                    </ResponsiveDialog.Title>
                    <ResponsiveDialog.Description className="text-white/50">
                        Verifying compliance for both {requesterName} and {offererName}.
                    </ResponsiveDialog.Description>
                </ResponsiveDialog.Header>
                <ResponsiveDialog.Body className="overflow-y-auto max-h-[70dvh]">

                {/* Swap Summary */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-white/50 mb-1">They're swapping out:</div>
                            <div className="text-sm font-medium text-white/70">{requesterShift?.shift_date}</div>
                            <div className="text-sm text-white/50">
                                {requesterShift?.start_time?.slice(0, 5)} - {requesterShift?.end_time?.slice(0, 5)}
                            </div>
                        </div>
                        <div className="flex items-center justify-center">
                            <ArrowRightLeft className="h-5 w-5 text-purple-400" />
                        </div>
                    </div>

                    <div className="border-t border-white/10 my-3" />

                    <div>
                        <div className="text-xs text-white/50 mb-1">You're offering:</div>
                        <div className="font-semibold text-white">{offeredShift.role_name || 'Shift'}</div>
                        <div className="text-sm text-white/70">
                            {offeredShift.shift_date} • {offeredShift.start_time?.slice(0, 5)} - {offeredShift.end_time?.slice(0, 5)}
                        </div>
                        {offeredShift.department_name && (
                            <div className="text-xs text-white/50 mt-1">{offeredShift.department_name}</div>
                        )}
                    </div>
                </div>

                {/* Compliance content */}
                {!isRunningChecks && (
                    <ComplianceTabContent
                        hardValidation={hardValidation}
                        ruleResults={ruleResults}
                        onRuleResult={(ruleId, result) => setRuleResults(prev => ({ ...prev, [ruleId]: result }))}
                        buildComplianceInput={() => ({
                            employee_id: requesterId!,
                            action_type: 'swap',
                            candidate_shift: {
                                shift_date: offeredShift.shift_date,
                                start_time: offeredShift.start_time,
                                end_time: offeredShift.end_time,
                                unpaid_break_minutes: offeredShift.unpaid_break_minutes || 0,
                            },
                            existing_shifts: requesterRoster.filter(s => s.id !== requesterShift?.id).map(s => ({
                                shift_date: s.shift_date,
                                start_time: s.start_time,
                                end_time: s.end_time,
                                unpaid_break_minutes: s.unpaid_break_minutes || 0,
                            })),
                        })}
                        needsRerun={false}
                        onChecksComplete={() => setChecksComplete(true)}
                        onRunAll={handleRunAllChecks}
                    />
                )}

                {isRunningChecks && (
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                            <Loader2 className="h-8 w-8 animate-spin text-purple-400 mx-auto mb-3" />
                            <p className="text-white/70">Running compliance checks...</p>
                        </div>
                    </div>
                )}

                {/* Failure analysis banner */}
                {failureAnalysis && (
                    <div className={cn(
                        "mx-4 mt-4 p-3 rounded-lg border text-sm flex items-start gap-3",
                        failureAnalysis === 'BOTH_FAILED' ? "bg-red-950/30 border-red-800 text-red-200" :
                        failureAnalysis === 'YOU_FAILED'  ? "bg-amber-950/30 border-amber-800 text-amber-200" :
                                                            "bg-orange-950/30 border-orange-800 text-orange-200"
                    )}>
                        <Shield className="h-5 w-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold mb-1">
                                {failureAnalysis === 'BOTH_FAILED' ? 'Compliance Failed for Both Parties' :
                                 failureAnalysis === 'YOU_FAILED'  ? 'You cannot take this shift' :
                                                                     'Request cannot be fulfilled'}
                            </p>
                            <p className="opacity-90">
                                {failureAnalysis === 'BOTH_FAILED'    && 'Neither you nor the requester can legally work these shifts.'}
                                {failureAnalysis === 'YOU_FAILED'     && 'Taking this shift would put YOU in violation of compliance rules.'}
                                {failureAnalysis === 'THEY_FAILED'    && `Taking your shift would put ${requesterName} in violation of compliance rules.`}
                                {failureAnalysis === 'UNKNOWN_FAILURE' && 'Compliance checks failed.'}
                            </p>
                        </div>
                    </div>
                )}

                </ResponsiveDialog.Body>
                <ResponsiveDialog.Footer className="mt-6 gap-2">
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} className="border-white/10 min-h-[44px]">
                            Cancel
                        </Button>
                        {checksComplete && (
                            <Button
                                variant="secondary"
                                onClick={handleRunAllChecks}
                                disabled={isRunningChecks}
                                className="gap-2 bg-slate-800 hover:bg-slate-700 text-purple-400 border border-purple-500/20 min-h-[44px]"
                            >
                                <Play className="h-4 w-4 fill-current" />
                                Re-Run Checks
                            </Button>
                        )}
                    </div>

                    {checksComplete && (
                        <Button
                            onClick={onConfirmOffer}
                            disabled={!canProceed || isSubmitting}
                            className={cn(
                                'gap-2 min-h-[44px]',
                                canProceed
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-white/10 text-white/50 cursor-not-allowed',
                            )}
                        >
                            {isSubmitting ? (
                                <><Loader2 className="h-4 w-4 animate-spin" />Sending...</>
                            ) : canProceed ? (
                                <><Send className="h-4 w-4" />{hasWarnings ? 'Send Offer Anyway' : 'Send Offer'}</>
                            ) : (
                                'Cannot Proceed'
                            )}
                        </Button>
                    )}
                </ResponsiveDialog.Footer>
        </ResponsiveDialog>
    );
}

export default SwapComplianceModal;
