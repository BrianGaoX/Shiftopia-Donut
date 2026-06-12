/**
 * EnhancedAddShiftModal — Card-Based Layout
 *
 * Pure rendering layer — all business logic lives in useShiftFormOrchestrator.
 * Card grid layout in ShiftFormDrawerContent handles all form sections.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { Form } from '@/modules/core/ui/primitives/form';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, X, Plus, Save, Undo2, Zap } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { ShiftFormDrawerContent } from './components/ShiftFormDrawerContent';

import type { EnhancedAddShiftModalProps } from './types';
import { useShiftFormOrchestrator } from './hooks/useShiftFormOrchestrator';

// ── Always-visible chrome ──────────────────────────────────────────────
import { CancelConfirmDialog } from './components';

// ── Component ─────────────────────────────────────────────────────────
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

        // Locks
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
        hardValidation,
        isLoadingShifts,

        // Compliance
        compliancePanel,
        runChecks,

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
            <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
                <DialogContent
                    className={cn(
                        "w-[calc(100vw-1rem)] sm:max-w-[900px] h-[85vh] sm:h-[700px] max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col focus-visible:ring-0 focus:outline-none transition-all duration-300 rounded-xl sm:rounded-2xl shadow-2xl border",
                        isReadOnly
                            ? "bg-[#0a0a0c] border-slate-800/50 shadow-none"
                            : isPublished
                                ? "bg-[#0c0512] border-purple-900/30 shadow-[0_0_40px_-12px_rgba(168,85,247,0.15)]"
                                : isEmergencyAssignment
                                    ? "bg-[#09090b] border-indigo-500/15 shadow-[0_0_40px_-12px_rgba(99,102,241,0.1)]"
                                    : "bg-card dark:bg-[#0a0c10] border-border/50"
                    )}
                    aria-describedby={undefined}
                >
                    <DialogHeader className="sr-only">
                        <DialogTitle>
                            {isEmergencyAssignment
                                ? (editMode ? 'Emergency Update' : 'Emergency Assign')
                                : (editMode ? 'Update Shift' : 'Create Shift')}
                        </DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form
                            id="shift-form"
                            onSubmit={form.handleSubmit(handleSubmit)}
                            className="flex flex-col h-full overflow-hidden"
                        >
                            {/* ── Card grid ── */}
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
                                isLoadingShifts={isLoadingShifts}
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
                                currentStep={1}
                            />

                            {/* ── FOOTER ── */}
                            <div className={cn(
                                "flex-shrink-0 px-5 py-3 border-t backdrop-blur-xl flex items-center justify-between gap-3 z-20",
                                isReadOnly
                                    ? "border-slate-800/40 bg-slate-950/40"
                                    : isPublished
                                        ? "border-purple-500/15 bg-purple-950/15"
                                        : isEmergencyAssignment
                                            ? "border-indigo-500/15 bg-indigo-950/15"
                                            : "border-border/50 bg-card/80 dark:bg-[#0a0c10]/80"
                            )}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleCancel}
                                    className="h-9 px-4 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 font-bold transition-all flex items-center gap-1.5 text-xs"
                                >
                                    <X className="h-3.5 w-3.5" />
                                    Cancel
                                </Button>

                                <div className="flex items-center gap-2">
                                    {canUnpublish && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={handleUnpublish}
                                            className="h-9 px-4 rounded-lg text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 font-bold text-xs flex items-center gap-1.5 border border-purple-500/20"
                                        >
                                            <Undo2 className="h-3.5 w-3.5" />
                                            Unpublish
                                        </Button>
                                    )}

                                    <Button
                                        type="submit"
                                        disabled={!canSave || isLoading}
                                        className={cn(
                                            "h-9 px-6 rounded-lg font-black uppercase tracking-[0.12em] text-xs transition-all flex items-center gap-1.5 shadow-lg",
                                            canSave
                                                ? isPublished
                                                    ? "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-500/20 border border-purple-400/20"
                                                    : isEmergencyAssignment
                                                        ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 border border-indigo-400/20"
                                                        : "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20 border border-amber-400/20"
                                                : "bg-slate-800/50 text-slate-500 cursor-not-allowed border border-white/5"
                                        )}
                                    >
                                        {isLoading ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : isEmergencyAssignment ? (
                                            <Zap className="h-3.5 w-3.5" />
                                        ) : editMode ? (
                                            <Save className="h-3.5 w-3.5" />
                                        ) : (
                                            <Plus className="h-3.5 w-3.5" />
                                        )}
                                        {isEmergencyAssignment
                                            ? (editMode ? 'Emergency Update' : 'Emergency Assign')
                                            : (editMode ? 'Update Shift' : 'Create Shift')}
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

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
