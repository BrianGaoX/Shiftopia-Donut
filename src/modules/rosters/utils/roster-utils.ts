import { Shift, TemplateGroupType } from '../domain/shift.entity';
import { parseZonedDateTime, SYDNEY_TZ, getSydneyNow } from '@/modules/core/lib/date.utils';
import { isShiftLocked as isShiftLockedUtil, LockContext } from '../domain/shift-locking.utils';

/**
 * Resolve the correct group type (Convention, Exhibition, Theatre) for a shift.
 * This helper centralizes the logic for color inheritance across all roster modes.
 *
 * @param shift - The shift object (can be a raw Shift or a mode-specific wrapper)
 * @returns The resolved TemplateGroupType or 'default_yellow' as a default
 */
export function resolveGroupType(shift: any): TemplateGroupType | 'default_yellow' {
    if (!shift) return 'default_yellow';

    // 1. Check direct group_type (standard in Phase 2)
    if (shift.group_type) return shift.group_type as TemplateGroupType;

    // 2. Check groupColor (sometimes used in PeopleModeShift)
    // Note: We need to map 'emerald' to 'exhibition_centre' if it exists for backward compatibility
    if (shift.groupColor) {
        if (shift.groupColor === 'emerald' || shift.groupColor === 'green') return 'exhibition_centre';
        if (shift.groupColor === 'blue') return 'convention_centre';
        if (shift.groupColor === 'red') return 'theatre';
        if (shift.groupColor === 'amber') return 'the_cutaway';

        // If it's already a valid group key, use it
        if (['convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway'].includes(shift.groupColor)) {
            return shift.groupColor as TemplateGroupType;
        }
    }

    // 3. Check rawShift.template_groups.type (common in nested API responses)
    const rawShift = shift.rawShift || (shift.id ? shift : null);
    if (rawShift?.template_groups?.type) {
        return rawShift.template_groups.type as TemplateGroupType;
    }

    // 4. Check roster_subgroup hierarchy (common in Roles Mode)
    if (rawShift?.roster_subgroup?.roster_group?.type) {
        return rawShift.roster_subgroup.roster_group.type as TemplateGroupType;
    }

    // Default fallback
    return 'default_yellow';
}

/**
 * Resolve the shift status (Locked vs Past) using centralized logic.
 * Use this in all roster modes to ensure consistent behavior.
 * 
 * @param shift - Raw shift data from API
 * @param context - The context for locking (default: roster_management)
 * @returns { isPast: boolean; isLocked: boolean }
 */
export function resolveShiftStatus(
    shift: Shift | any, 
    context: LockContext = 'roster_management'
): { isPast: boolean; isLocked: boolean } {
    const rawShift = shift.rawShift || (shift.id ? shift : null);
    if (!rawShift) return { isPast: false, isLocked: false };

    const { shift_date, start_time } = rawShift;
    if (!shift_date || !start_time) return { isPast: false, isLocked: false };

    // Standard Sydney-based computation
    const now = getSydneyNow();
    const shiftStartAt = parseZonedDateTime(shift_date, start_time, SYDNEY_TZ);
    
    const isPast = now >= shiftStartAt;
    
    // isShiftLocked already exists and handles different context rules
    const isLocked = isShiftLockedUtil(shift_date, start_time, context);

    return { isPast, isLocked };
}
