/**
 * ShiftFormPage — Full-page Add / Edit Shift
 *
 * Dedicated route (/rosters/shift/new) that replaces the old centered Dialog.
 * Because there is NO Radix Dialog wrapping the form, the body is never
 * pointer-events:none, so all nested Select / Popover / Command dropdowns work
 * natively with zero modal-layering conflicts.
 *
 * Launch context (org/dept/group/role/date/rosterId, editMode, existingShift)
 * is passed via router location state by the launcher (e.g. DrillDownPanel).
 * Reuses the exact same orchestrator + render layer as the modal did, so all
 * business logic (compliance, validation, submit) is unchanged.
 */

import React from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Loader2, X, Plus, Save, Undo2, Zap, ArrowLeft } from 'lucide-react';

import { Form } from '@/modules/core/ui/primitives/form';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';


import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { CalendarPlus, CalendarCheck } from 'lucide-react';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { ShiftFormDrawerContent } from '../ui/dialogs/EnhancedAddShiftModal/components/ShiftFormDrawerContent';
import { CancelConfirmDialog } from '../ui/dialogs/EnhancedAddShiftModal/components';
import { useShiftFormOrchestrator } from '../ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator';
import type { ShiftContext } from '../ui/dialogs/EnhancedAddShiftModal/types';

interface ShiftFormPageState {
    context?: ShiftContext | null;
    editMode?: boolean;
    existingShift?: any;
    isTemplateMode?: boolean;
}

const ShiftFormPage: React.FC = () => {
    const navigate = useNavigate();
    const { isDark } = useTheme();
    const location = useLocation();
    const state = (location.state ?? null) as ShiftFormPageState | null;

    const hasContext = !!state?.context;
    const editMode = state?.editMode ?? false;
    const isTemplateMode = state?.isTemplateMode ?? false;

    // Return to the roster grid. The shift mutations already invalidate the
    // roster queries, so the grid refetches on arrival.
    const goBack = React.useCallback(() => navigate('/rosters'), [navigate]);

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
    } = useShiftFormOrchestrator({
        isOpen: hasContext,
        onClose: goBack,
        context: state?.context ?? null,
        editMode,
        existingShift: state?.existingShift,
        isTemplateMode,
    });

    // Guard: page reached without launch context (e.g. hard refresh / deep link).
    // Hook is always called above, so this conditional return is hooks-safe.
    if (!hasContext) {
        return <Navigate to="/rosters" replace />;
    }

    return (
        <div
            className={cn(
                'h-full flex flex-col',
                isReadOnly
                    ? 'bg-[#0a0a0c]'
                    : isPublished
                        ? 'bg-[#0c0512]'
                        : isEmergencyAssignment
                            ? 'bg-[#09090b]'
                            : 'bg-card dark:bg-[#0a0c10]',
            )}
        >
            
            {/* ── GOLD STANDARD HEADER ── */}
            <GoldStandardHeader
                title={editMode ? 'Edit Shift' : 'Create Shift'}
                Icon={editMode ? CalendarCheck : CalendarPlus}
                functionBar={
                    <div className={cn(
                        "flex flex-row items-center justify-between gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden",
                        isDark ? "bg-[#111827]/60" : "bg-slate-100"
                    )}>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleCancel}
                                className={cn(
                                    "h-9 lg:h-11 px-3 lg:px-4 rounded-xl text-muted-foreground hover:text-foreground font-bold transition-all flex items-center gap-1.5 text-xs",
                                    isDark ? "hover:bg-[#111827]/80" : "hover:bg-slate-200/50"
                                )}
                            >
                                <X className="h-4 w-4" />
                                <span className="hidden sm:inline">Cancel</span>
                            </Button>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={(e) => {
                                    e.preventDefault();
                                    runChecks();
                                }}
                                className={cn(
                                    "h-9 lg:h-11 px-3 lg:px-4 rounded-xl font-bold transition-all flex items-center gap-1.5 text-xs",
                                    isDark ? "text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10" : "text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                )}
                            >
                                <Zap className="h-4 w-4" />
                                <span className="hidden sm:inline">Run Compliance</span>
                            </Button>

                            <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

                            {canUnpublish && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleUnpublish}
                                    className="h-9 lg:h-11 px-3 lg:px-4 rounded-xl text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 font-bold text-xs flex items-center gap-1.5 border border-purple-500/20"
                                >
                                    <Undo2 className="h-4 w-4" />
                                    Unpublish
                                </Button>
                            )}

                            {!isPublished && !isEmergencyAssignment && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        handleSubmit(form.getValues());
                                    }}
                                    disabled={!canSave || isLoading}
                                    className={cn(
                                        "h-9 lg:h-11 px-4 lg:px-6 rounded-xl font-black uppercase tracking-[0.12em] text-[10px] transition-all flex items-center gap-2",
                                        isDark ? "border-white/10 hover:bg-white/5 text-white/80" : "border-slate-200 hover:bg-slate-100 text-slate-700"
                                    )}
                                >
                                    Save Draft
                                </Button>
                            )}

                            <Button
                                type="button"
                                onClick={() => {
                                    handleSubmit(form.getValues());
                                }}
                                disabled={!canSave || isLoading}
                                className={cn(
                                    'h-9 lg:h-11 px-4 lg:px-8 rounded-xl font-black uppercase tracking-[0.12em] text-[10px] lg:text-xs transition-all flex items-center gap-2 shadow-sm',
                                    canSave
                                        ? isPublished
                                            ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-500/20 border border-purple-400/20'
                                            : isEmergencyAssignment
                                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 border border-indigo-400/20'
                                                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20 border border-amber-400/20'
                                        : 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed border border-border',
                                )}
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : isEmergencyAssignment ? (
                                    <Zap className="h-4 w-4" />
                                ) : editMode ? (
                                    <Save className="h-3.5 w-3.5" />
                                ) : (
                                    <Plus className="h-3.5 w-3.5" />
                                )}
                                {isEmergencyAssignment
                                    ? (editMode ? 'Emergency Update' : 'Emergency Assign')
                                    : (editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Create Shift')}
                            </Button>
                        </div>
                    </div>
                }
            />

            {/* ── BODY ── */}
            <div className={cn(
                "flex-1 min-h-0 flex flex-col overflow-hidden mx-4 lg:mx-6 mb-4 lg:mb-6 rounded-[32px] border transition-all",
                isDark
                    ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
                    : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
            )}>
<Form {...form}>
                <form
                    id="shift-form"
                    onSubmit={form.handleSubmit(handleSubmit)}
                    className="flex-1 min-h-0 flex flex-col overflow-hidden"
                >
                    {/* ── Card grid (same render layer as the old modal) ── */}
                    <ShiftFormDrawerContent
                        form={form}
                        isReadOnly={isReadOnly}
                        isPast={isPast}
                        isStarted={isStarted}
                        isPublished={isPublished}
                        isTemplateMode={isTemplateMode}
                        editMode={editMode}
                        existingShift={state?.existingShift}
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

                    </form>
                </Form>
            </div>
            <CancelConfirmDialog
                open={showCancelConfirm}
                onOpenChange={setShowCancelConfirm}
                onConfirm={goBack}
            />
        </div>
    );
};

export default ShiftFormPage;
