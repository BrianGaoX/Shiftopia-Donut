/**
 * EnhancedAddShiftModal — Redesigned 3-Step Flow
 *
 * Step 1: Schedule & Details (Hierarchy, Context, Timings, Breaks, Criteria, Notes)
 * Step 2: Assignment & Compliance (Two-pane: Employee Pool + Compliance Inspector)
 * Step 3: Review Logs
 *
 * Pure rendering layer — all business logic lives in useShiftFormOrchestrator.
 * Step panels are lazy-loaded for fast initial paint.
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/modules/core/ui/primitives/sheet';
import { Form } from '@/modules/core/ui/primitives/form';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, X, Plus, Save, Undo2, Zap, ShieldAlert } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { ShiftFormDrawerContent } from './components/ShiftFormDrawerContent';

import type { EnhancedAddShiftModalProps } from './types';
import { useShiftFormOrchestrator } from './hooks/useShiftFormOrchestrator';

// ── Always-visible chrome (imported eagerly — zero extra latency) ──────────
import {
    CancelConfirmDialog,
} from './components';

// ── Fallback while a step chunk loads ─────────────────────────────────────
function StepSkeleton() {
    return (
        <div className="flex items-center justify-center h-48">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────
export const EnhancedAddShiftModal: React.FC<EnhancedAddShiftModalProps> = (props) => {
    const { isOpen, onClose } = props;
    const isTemplateMode = props.isTemplateMode ?? false;
    const editMode = props.editMode ?? false;

    const {
        form,
        isLoading,
        showCancelConfirm,
        setShowCancelConfirm,

        // Data
        roles,
        remunerationLevels,
        employees,
        skills,
        licenses,
        events,
        rosters,
        rosterStructure,
        activeSubGroups,
        isLoadingData,

        // Context
        resolvedContext,

        // Statuses
        isAssignmentEnabled,
        minShiftHours,

        // Values
        shiftLength,
        netLength,
        selectedRemLevel,

        // Locks
        isRosterLocked,
        isGroupLocked,
        isSubGroupLocked,
        isRoleLocked,
        isEmployeeLocked,

        // Read-only
        isPast,
        isStarted,
        isPublished,
        isReadOnly,


        // Roster
        selectedRosterId,
        setSelectedRosterId,

        // Validation
        canSave,
        hasDepartment,
        hasRoster,
        hardValidation,

        // Compliance
        compliancePanel,
        runChecks,
        clearResults,

        // Watched fields
        watchEmployeeId,

        // Emergency state
        isEmergencyAssignment,
        isScheduleDefined,

        // Handlers
        handleSubmit,
        handleCancel,
        handleUnpublish,
        canUnpublish,
    } = useShiftFormOrchestrator(props);

    return (
        <>
            <Sheet open={isOpen} onOpenChange={onClose}>
                <SheetContent
                    side="right"
                    className={cn(
                        "sm:max-w-[600px] p-0 gap-0 overflow-hidden flex flex-col focus-visible:ring-0 focus:outline-none transition-all duration-500",
                        isReadOnly 
                            ? "bg-[#0a0a0c] dark:bg-[#0a0a0c] border-slate-800/60 shadow-none grayscale opacity-90"
                            : isPublished
                                ? "bg-[#0c0512] dark:bg-[#0c0512] border-purple-900/40 shadow-[0_0_50px_-12px_rgba(168,85,247,0.2)]"
                                : isEmergencyAssignment
                                    ? "bg-[#050505] dark:bg-[#09090b] border-indigo-500/20 shadow-[0_0_50px_-12px_rgba(99,102,241,0.15)]"
                                    : "bg-card dark:bg-slate-950 border-border"
                    )}
                    aria-describedby={undefined}
                >
                    <SheetHeader className="sr-only">
                        <SheetTitle>
                            {isEmergencyAssignment
                                ? (editMode ? 'Emergency Update' : 'Emergency Assign')
                                : (editMode ? 'Update Shift' : 'Create Shift')}
                        </SheetTitle>
                    </SheetHeader>
                    <Form {...form}>
                        <form
                            id="shift-form"
                            onSubmit={form.handleSubmit(handleSubmit)}
                            className="flex flex-col h-full overflow-hidden"
                        >
                            {/* ── Emergency mode banner ───────────────────── */}
                            <ShiftFormDrawerContent
                                form={form}
                                isReadOnly={isReadOnly}
                                isPast={isPast}
                                isStarted={isStarted}
                                isPublished={isPublished}
                                isTemplateMode={isTemplateMode}
                                editMode={editMode}
                                existingShift={props.existingShift}
                                roles={roles}
                                remunerationLevels={remunerationLevels}
                                employees={employees}
                                skills={skills}
                                licenses={licenses}
                                events={events}
                                rosters={rosters}
                                rosterStructure={rosterStructure}
                                activeSubGroups={Object.values(activeSubGroups).flat()}
                                isLoadingData={isLoadingData}
                                isLoadingShifts={false}
                                resolvedContext={resolvedContext}
                                selectedRosterId={selectedRosterId}
                                setSelectedRosterId={setSelectedRosterId}
                                shiftLength={shiftLength}
                                netLength={netLength}
                                hardValidation={hardValidation}
                                isAssignmentEnabled={isAssignmentEnabled}
                                minShiftHours={minShiftHours}
                                compliancePanel={compliancePanel}
                                runV2Compliance={runChecks}
                                onUnpublish={handleUnpublish}
                                canUnpublish={canUnpublish}
                                isGroupLocked={isGroupLocked}
                                isSubGroupLocked={isSubGroupLocked}
                                isRoleLocked={isRoleLocked}
                                isEmployeeLocked={isEmployeeLocked}
                                isScheduleDefined={isScheduleDefined}
                            />

                            {/* STICKY FOOTER ACTIONS */}
                            <div className={cn(
                                "flex-shrink-0 px-6 py-4 border-t backdrop-blur-xl flex items-center justify-between gap-4 z-20 transition-all duration-300",
                                isReadOnly
                                    ? "border-slate-800/40 bg-slate-950/40 grayscale"
                                    : isPublished
                                        ? "border-purple-500/20 bg-purple-950/20"
                                        : isEmergencyAssignment
                                            ? "border-indigo-500/20 bg-indigo-950/20"
                                            : "border-border bg-card/90 dark:bg-slate-900/80"
                            )}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleCancel}
                                    className="h-11 px-6 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 font-bold transition-all flex items-center gap-2"
                                >
                                    <X className="h-4 w-4" />
                                    <span>Cancel</span>
                                </Button>

                                <div className="flex items-center gap-3">
                                    {canUnpublish && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={handleUnpublish}
                                            className="h-11 px-6 rounded-xl text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 font-bold transition-all flex items-center gap-2 border border-purple-500/20"
                                        >
                                            <Undo2 className="h-4 w-4" />
                                            <span>Unpublish</span>
                                        </Button>
                                    )}

                                    <Button
                                        type="submit"
                                        disabled={!canSave || isLoading}
                                        className={cn(
                                            "h-11 px-8 rounded-xl font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg",
                                            canSave
                                                ? isPublished
                                                    ? "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-500/25 border border-purple-400/20"
                                                    : isEmergencyAssignment
                                                        ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/25 border border-indigo-400/20"
                                                        : "bg-slate-950 hover:bg-slate-900 text-white shadow-indigo-500/20 border border-white/5"
                                                : "bg-slate-900/50 text-slate-500 cursor-not-allowed border border-white/5"
                                        )}
                                    >
                                        {isLoading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : isEmergencyAssignment ? (
                                            <Zap className="h-4 w-4" />
                                        ) : editMode ? (
                                            <Save className="h-4 w-4" />
                                        ) : (
                                            <Plus className="h-4 w-4" />
                                        )}
                                        <span>
                                            {isEmergencyAssignment
                                                ? (editMode ? 'Emergency Update' : 'Emergency Assign')
                                                : (editMode ? 'Update Shift' : 'Create Shift')}
                                        </span>
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </Form>
                </SheetContent>
            </Sheet>

            <CancelConfirmDialog
                open={showCancelConfirm}
                onOpenChange={setShowCancelConfirm}
                onConfirm={onClose}
            />
        </>
    );
};

export default EnhancedAddShiftModal;
export * from './types';
