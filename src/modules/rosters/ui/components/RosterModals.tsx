/**
 * RosterModals — Centralised modal state owner for RostersPlannerPage.
 *
 * Holds all modal open/close state internally and exposes an imperative handle
 * so the parent page can trigger modals without lifting state. This removes 9
 * useState hooks and ~200 lines of modal JSX from RostersPlannerPage.
 *
 * Usage:
 *   const modalsRef = useRef<RosterModalsHandle>(null);
 *   modalsRef.current?.openAddShift(context);
 */

import React, { useState, forwardRef, useImperativeHandle, Suspense, lazy } from 'react';
import { useShiftFormNav } from '@/modules/rosters/hooks/useShiftFormNav';

// Heavy modals are lazy-loaded so the Rosters page chunk doesn't pay for
// them on first paint. Each is ~500-1700 LOC and pulls in its own form
// stack, compliance engine bindings, and validation logic.
const BulkAssignmentPanel = lazy(() =>
    import('@/modules/rosters/ui/dialogs/BulkAssignmentPanel').then((m) => ({
        default: m.BulkAssignmentPanel,
    })),
);
const AutoSchedulerModal = lazy(() =>
    import('@/modules/scheduling/ui/AutoSchedulerModal').then((m) => ({
        default: m.AutoSchedulerModal,
    })),
);

import type { ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import type { BulkAssignmentEmployee } from '@/modules/rosters/ui/dialogs/BulkAssignmentPanel';

// =============================================================================
// TYPES
// =============================================================================

interface AutoSchedulerShift {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    role_id: string | null;
    roleName?: string;
    unpaid_break_minutes: number;
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: 'FT' | 'PT' | 'Casual' | null;
}

interface RosterModalsProps {
    /** Shift IDs currently selected (forwarded to BulkAssignmentPanel). */
    selectedV8ShiftIds: string[];
    /** Employee list for BulkAssignmentPanel. */
    employees: BulkAssignmentEmployee[];
    /** Unassigned shifts for AutoSchedulerPanel. */
    autoSchedulerShifts: AutoSchedulerShift[];
    /** Employee summary for AutoSchedulerPanel. */
    autoSchedulerEmployees: Array<{
        id: string;
        name: string;
        contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
        contracted_weekly_hours?: number;
    }>;
    /** Called when a shift is created or saved successfully. */
    onShiftSaved: () => void;
    /** Called after bulk assignment completes (clears selection). */
    onAssignComplete: () => void;
    /** Called after auto-scheduler finishes. */
    onAutoScheduleComplete: () => void;
}

/** Imperative handle — parent calls these to open modals. */
export interface RosterModalsHandle {
    openAddShift: (context: ShiftContext) => void;
    openEditShift: (shift: any, context: ShiftContext) => void;

    openBulkAssign: () => void;
    openAutoScheduler: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const RosterModals = forwardRef<RosterModalsHandle, RosterModalsProps>((
    {
        selectedV8ShiftIds,
        employees,
        autoSchedulerShifts,
        autoSchedulerEmployees,
        onShiftSaved,
        onAssignComplete,
        onAutoScheduleComplete,
    },
    ref,
) => {
    const openShiftForm = useShiftFormNav();

    const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
    const [isAutoSchedulerOpen, setIsAutoSchedulerOpen] = useState(false);

    useImperativeHandle(ref, () => ({
        // Add/Edit now navigate to the dedicated full-page form route
        // (no Dialog → no nested-popover pointer-events conflicts). The page's
        // create/update mutations invalidate the roster queries on success.
        openAddShift: (context) => openShiftForm({ context }),
        openEditShift: (shift, context) =>
            openShiftForm({ context, editMode: true, existingShift: shift }),

        openBulkAssign: () => setIsBulkAssignOpen(true),
        openAutoScheduler: () => setIsAutoSchedulerOpen(true),
    }));

    return (
        <>
            {/* Auto-Scheduler Modal — 1.7k LOC, deferred */}
            {isAutoSchedulerOpen && (
                <Suspense fallback={null}>
                    <AutoSchedulerModal
                        open={isAutoSchedulerOpen}
                        onClose={() => setIsAutoSchedulerOpen(false)}
                        shifts={autoSchedulerShifts}
                        employees={autoSchedulerEmployees}
                        onComplete={onAutoScheduleComplete}
                    />
                </Suspense>
            )}

            {/* Bulk Assignment Panel */}
            {isBulkAssignOpen && (
                <Suspense fallback={null}>
                    <BulkAssignmentPanel
                        open={isBulkAssignOpen}
                        onClose={() => setIsBulkAssignOpen(false)}
                        selectedV8ShiftIds={selectedV8ShiftIds}
                        employees={employees}
                        onAssignComplete={onAssignComplete}
                    />
                </Suspense>
            )}
        </>
    );
});

RosterModals.displayName = 'RosterModals';
