/**
 * DroppableDateCell
 *
 * A <td> wrapper that accepts drag-drops of unfilled shift cards (DND_UNFILLED_SHIFT).
 * When a valid shift is dropped, it calls `onAssign` — the parent is responsible
 * for calling executeAssignShift() which runs full compliance + DB write.
 *
 * Intentionally has NO direct DB calls and NO compliance logic.
 * All validation happens inside executeAssignShift (assignShift.command.ts).
 */
import React from 'react';
import { useDrop } from 'react-dnd';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { DND_UNFILLED_SHIFT, DND_SHIFT_TYPE, type ShiftDragItem } from '../modes/people-mode.types';
import type { UnfilledShift } from '../modes/UnfilledShiftsPanel';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { parse } from 'date-fns';
import { canDropOnTarget } from '@/modules/rosters/utils/dnd.utils';
import { isSydneyPast } from '@/modules/core/lib/date.utils';

interface DroppableDateCellProps {
  employeeId: string;
  dateKey: string;                // 'yyyy-MM-dd'
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  onAssign: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  onMove?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
}

const DroppableDateCellImpl: React.FC<DroppableDateCellProps> = ({
  employeeId,
  dateKey,
  className,
  onClick,
  children,
  onAssign,
  onMove,
}) => {
  const { toast } = useToast();

  // canDrop reads isDnDModeActive imperatively so flipping DnD mode does NOT
  // re-render this cell or re-register its drop spec. With 1.4k cells in a
  // week view, that was the main source of the ~800ms INP on the DnD toggle.
  const [{ isOver, canDrop }, drop] = useDrop<
    UnfilledShift | ShiftDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(
    () => ({
      accept: [DND_UNFILLED_SHIFT, DND_SHIFT_TYPE],
      canDrop: (item: any) => {
        return canDropOnTarget(
          useRosterStore.getState().isDnDModeActive,
          {
            lifecycle_status: 'lifecycle_status' in item
              ? item.lifecycle_status
              : (item.isPublished ? 'Published' : 'Draft'),
            is_cancelled: item.is_cancelled || false,
          },
          {
            isPast: isSydneyPast(parse(dateKey, 'yyyy-MM-dd', new Date())),
          }
        );
      },
      drop: (item: any) => {
        // Validation (already checked in canDrop, but let's be safe)
        const isDraft = 'lifecycle_status' in item 
          ? item.lifecycle_status === 'Draft' 
          : !item.isPublished;
        
        if (!isDraft) {
          toast({
            title: 'Cannot move',
            description: 'Only draft shifts can be moved.',
            variant: 'destructive',
          });
          return;
        }

        if ('shiftId' in item) {
          // It's an existing shift move
          onMove?.(item.shiftId, employeeId, dateKey);
        } else {
          // It's a new assignment from the panel
          onAssign(item as UnfilledShift, employeeId, dateKey);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [employeeId, dateKey, onAssign, onMove],
  );

  return (
    <td
      ref={drop}
      className={cn(
        className,
        'transition-[background-color,box-shadow,transform,ring-color] duration-300 relative overflow-hidden',
        isOver && canDrop  && 'ring-2 ring-emerald-400 ring-inset bg-emerald-500/10 shadow-[inset_0_0_20px_rgba(16,185,129,0.2)] scale-[1.02] z-10',
        isOver && !canDrop && 'ring-2 ring-red-400 ring-inset bg-red-500/5 opacity-60 cursor-no-drop',
      )}
      onClick={onClick}
    >
      {children}
    </td>
  );
};

export const DroppableDateCell = React.memo(DroppableDateCellImpl);
export default DroppableDateCell;
