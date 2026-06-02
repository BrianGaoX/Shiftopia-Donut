/**
 * ModalFooter — Save gate diagnostics + step navigation
 *
 * Adds a GateStatusBar above the action buttons that shows exactly which
 * requirement is still blocking the "Create Shift" save action.
 *
 * Gates (in priority order):
 *   1. Schedule — Step 1 fields complete + valid duration
 *   2. Hard validation — times/overlap errors
 *   3. Roster — roster selected (or template mode)
 *   4. Department — department resolved
 *   5. Compliance — run and passed (only when employee assigned)
 *
 * WCAG 2.1 AA: aria-busy on submit, aria-disabled mirrors disabled prop.
 */

import React, { useMemo } from 'react';
import { DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Loader2, Lock, Check, ArrowRight, Undo2,
    CheckCircle2, XCircle, AlertCircle, Circle, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { TOTAL_STEPS } from '../constants';
import type { HardValidationResult } from '@/modules/compliance';

// ── Gate item ─────────────────────────────────────────────────────────────

type GateState = 'pass' | 'fail' | 'warn' | 'skip';

interface Gate {
    id: string;
    label: string;
    state: GateState;
    hint?: string;
}

function GateChip({ gate }: { gate: Gate }) {
    const styles: Record<GateState, string> = {
        pass: 'border-emerald-500/25 bg-emerald-500/8 text-emerald-400',
        fail: 'border-red-500/30   bg-red-500/8    text-red-400',
        warn: 'border-amber-500/30  bg-amber-500/8  text-amber-400',
        skip: 'border-border/40     bg-muted/30     text-muted-foreground/50',
    };

    const Icon = gate.state === 'pass' ? CheckCircle2
                : gate.state === 'fail' ? XCircle
                : gate.state === 'warn' ? AlertCircle
                : Circle;

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold tracking-wide uppercase transition-colors duration-200',
                styles[gate.state],
            )}
            title={gate.hint}
        >
            <Icon className="h-3 w-3 shrink-0" />
            {gate.label}
        </div>
    );
}

// ── Gate status bar ────────────────────────────────────────────────────────

interface GateStatusBarProps {
    isLastStep:      boolean;
    canSave:         boolean;
    isTemplateMode:  boolean;
    isStepValid:     (step: number) => boolean;
    hardValidation:  HardValidationResult;
    hasDepartment:   boolean;
    hasRoster:       boolean;
    watchEmployeeId: string | null | undefined;
    compliancePanelStatus:   string;
    compliancePanelProceed:  boolean;
}

function GateStatusBar({
    isLastStep,
    canSave,
    isTemplateMode,
    isStepValid,
    hardValidation,
    hasDepartment,
    hasRoster,
    watchEmployeeId,
    compliancePanelStatus,
    compliancePanelProceed,
}: GateStatusBarProps) {
    const gates = useMemo<Gate[]>(() => {
        const step1 = isStepValid(1);
        const hvPassed = hardValidation.passed;
        const rosterOk = isTemplateMode || hasRoster;
        const deptOk   = hasDepartment;
        const needsCompliance = !isTemplateMode && !!watchEmployeeId;
        const complianceRun    = compliancePanelStatus === 'results';
        const compliancePassed = complianceRun && compliancePanelProceed;

        const scheduleHint: string | undefined = !step1
            ? 'Fill in shift date, times, group, and sub-group in Step 1'
            : !hvPassed
                ? (typeof hardValidation.errors[0] === 'string'
                    ? hardValidation.errors[0]
                    : (hardValidation.errors[0] as any)?.message ?? 'Fix time validation errors')
                : undefined;

        return [
            {
                id: 'schedule',
                label: 'Schedule',
                state: (step1 && hvPassed) ? 'pass' : 'fail',
                hint: scheduleHint,
            },
            {
                id: 'roster',
                label: isTemplateMode ? 'Template' : 'Roster',
                state: rosterOk ? 'pass' : 'fail',
                hint: rosterOk ? undefined : 'Select a roster in Step 1',
            },
            {
                id: 'dept',
                label: 'Department',
                state: deptOk ? 'pass' : 'fail',
                hint: deptOk ? undefined : 'Department not resolved — check the context header',
            },
            {
                id: 'compliance',
                label: 'Compliance',
                state: !needsCompliance
                    ? 'skip'
                    : !complianceRun
                        ? 'warn'
                        : compliancePassed
                            ? 'pass'
                            : 'fail',
                hint: !needsCompliance
                    ? 'No employee assigned — compliance check skipped'
                    : !complianceRun
                        ? 'Click RE-RUN to check compliance for the assigned employee'
                        : compliancePassed
                            ? 'All compliance rules passed'
                            : 'One or more compliance blockers must be resolved',
            },
        ];
    }, [isStepValid, hardValidation, isTemplateMode, hasRoster, hasDepartment, watchEmployeeId, compliancePanelStatus, compliancePanelProceed]);

    // Only show bar on last step and when relevant
    if (!isLastStep) return null;

    const allGood = canSave;

    return (
        <div className={cn(
            'flex items-center justify-between px-2 py-2 rounded-xl border mb-3 transition-all duration-300',
            allGood
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-border/50 bg-muted/20',
        )}>
            <div className="flex items-center gap-2 flex-wrap">
                {gates.map(g => <GateChip key={g.id} gate={g} />)}
            </div>
            {allGood && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-bold uppercase tracking-wide pl-2 shrink-0">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Ready
                </div>
            )}
        </div>
    );
}

// ── Main footer component ─────────────────────────────────────────────────

interface ModalFooterProps {
    currentStep:     number;
    isStepValid:     (step: number) => boolean;
    isLoading:       boolean;
    canSave:         boolean;
    isPast:          boolean;
    isStarted?:      boolean;
    isPublished:     boolean;
    editMode:        boolean;
    isTemplateMode:  boolean;
    hardValidation:  HardValidationResult;
    hasDepartment:   boolean;
    hasRoster:       boolean;
    watchEmployeeId: string | null | undefined;
    compliancePanel: { status: string; canProceed: boolean };
    onCancel:        () => void;
    onPrevStep:      () => void;
    onNextStep:      () => void;
    onSubmit:        () => void;
    onUnpublish:     () => void;
    canUnpublish:    boolean;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
    currentStep,
    isStepValid,
    isLoading,
    canSave,
    isPast,
    isStarted,
    isPublished,
    editMode,
    isTemplateMode,
    hardValidation,
    hasDepartment,
    hasRoster,
    watchEmployeeId,
    compliancePanel,
    onCancel,
    onPrevStep,
    onNextStep,
    onSubmit,
    onUnpublish,
    canUnpublish,
}) => {
    const isLastStep   = currentStep >= TOTAL_STEPS;
    const nextDisabled = !isStepValid(currentStep);
    const saveDisabled = isLoading || !canSave;

    const saveLabel = isLoading
        ? `Saving shift${editMode ? ' changes' : ''}…`
        : editMode
            ? 'Update Shift'
            : 'Create Shift';

    return (
        <DialogFooter className="px-6 py-4 border-t border-border bg-background">
            {/* ── Gate status bar (last step only) ──────────────────────── */}
            <GateStatusBar
                isLastStep={isLastStep}
                canSave={canSave}
                isTemplateMode={isTemplateMode}
                isStepValid={isStepValid}
                hardValidation={hardValidation}
                hasDepartment={hasDepartment}
                hasRoster={hasRoster}
                watchEmployeeId={watchEmployeeId}
                compliancePanelStatus={compliancePanel.status}
                compliancePanelProceed={compliancePanel.canProceed}
            />

            {/* ── Actions row ───────────────────────────────────────────── */}
            <div className="flex items-center justify-between w-full">
                {/* Dismiss */}
                <Button
                    variant="ghost"
                    onClick={onCancel}
                    aria-label="Discard changes and close"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                    Cancel
                </Button>

                {/* Navigation */}
                <div className="flex items-center gap-3" role="group" aria-label="Step navigation">
                    {currentStep > 1 && (
                        <Button
                            variant="outline"
                            onClick={onPrevStep}
                            aria-label={`Go back to step ${currentStep - 1}`}
                            className="border-border text-foreground hover:bg-muted"
                        >
                            Back
                        </Button>
                    )}

                    {!isLastStep && (
                        <Button
                            onClick={onNextStep}
                            disabled={nextDisabled}
                            aria-disabled={nextDisabled}
                            aria-label={
                                nextDisabled
                                    ? 'Complete required fields to proceed'
                                    : `Continue to step ${currentStep + 1}`
                            }
                            className="bg-emerald-600 hover:bg-emerald-700 text-primary-foreground gap-2"
                        >
                            Next Step
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Button>
                    )}

                    {isLastStep && isPublished && canUnpublish && (
                        <Button
                            onClick={onUnpublish}
                            variant="outline"
                            aria-label="Unpublish shift and revert to Draft"
                            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 gap-2"
                        >
                            <Undo2 className="h-4 w-4" aria-hidden />
                            Unpublish
                        </Button>
                    )}

                    {isLastStep && isPublished && !canUnpublish && (
                        <Button
                            disabled
                            variant="secondary"
                            aria-disabled
                            aria-label="Shift is published and cannot be unpublished from this state"
                            className="bg-muted text-muted-foreground/50 cursor-not-allowed border-0 gap-2"
                        >
                            <Lock className="h-4 w-4" aria-hidden />
                            Published
                        </Button>
                    )}

                    {isLastStep && !isPublished && !isPast && !isStarted && (
                        <Button
                            onClick={onSubmit}
                            disabled={saveDisabled}
                            aria-disabled={saveDisabled}
                            aria-busy={isLoading}
                            aria-label={saveLabel}
                            className={cn(
                                'gap-2 transition-all duration-200',
                                saveDisabled
                                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                    : 'bg-emerald-600 hover:bg-emerald-700 text-primary-foreground shadow-sm shadow-emerald-500/20',
                            )}
                        >
                            {isLoading
                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                : <Check className="h-4 w-4" aria-hidden />
                            }
                            <span aria-hidden>{editMode ? 'Update Shift' : 'Create Shift'}</span>
                            {isLoading && <span className="sr-only">Saving…</span>}
                        </Button>
                    )}
                </div>
            </div>
        </DialogFooter>
    );
};
