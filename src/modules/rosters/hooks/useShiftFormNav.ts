import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ShiftContext } from '../ui/dialogs/EnhancedAddShiftModal/types';

export interface OpenShiftFormOptions {
    context: ShiftContext | null;
    editMode?: boolean;
    existingShift?: any;
}

/**
 * Navigate to the dedicated full-page Add/Edit Shift route (/rosters/shift/new).
 *
 * Replaces the old EnhancedAddShiftModal Dialog at every roster launch point.
 * Because the form lives on a page (no Radix Dialog), its nested Select/Popover
 * dropdowns work without any pointer-events / modal-layer conflicts.
 *
 * Launch context is passed via React-Router location state; ShiftFormPage reads
 * it and redirects to /rosters if it's missing (e.g. on hard refresh).
 */
export function useShiftFormNav() {
    const navigate = useNavigate();
    return useCallback(
        (opts: OpenShiftFormOptions) => {
            navigate('/rosters/shift/new', {
                state: {
                    context: opts.context,
                    editMode: !!opts.editMode,
                    existingShift: opts.existingShift ?? null,
                    isTemplateMode: false,
                },
            });
        },
        [navigate],
    );
}
