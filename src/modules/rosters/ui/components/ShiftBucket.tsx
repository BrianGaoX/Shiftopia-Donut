/**
 * ShiftBucket - Container component for a group of identical shifts.
 * Renders a ShiftBucketHeader and, when expanded, a list of ShiftBucketRows.
 */
import React, { useState, useCallback } from 'react';
import { cn } from '@/modules/core/lib/utils';
import { ShiftBucketHeader } from './ShiftBucketHeader';
import { ShiftBucketRow } from './ShiftBucketRow';
import { type ShiftBucket as ShiftBucketType } from '@/modules/rosters/utils/bucket.utils';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { useToast } from '@/modules/core/hooks/use-toast';

/** Minimal shift data needed by the bucket row */
export interface BucketShiftData {
    id: string;
    role: string;
    startTime: string;
    endTime: string;
    employeeName?: string;
    isAssigned: boolean;
    isPublished: boolean;
    isDraft: boolean;
    isLocked: boolean;
    assignedEmployeeId?: string | null;
    rawShift?: any;
}

export interface ShiftBucketProps {
    bucket: ShiftBucketType;
    /** The actual shift display data for each shift in the bucket */
    shifts: BucketShiftData[];
    canEdit: boolean;
    /** Callbacks */
    onEditShift: (shiftId: string) => void;
    onDeleteShift: (shiftId: string) => void;
    onPublishShift: (shiftId: string) => void;
    onUnpublishShift: (shiftId: string) => void;
    onBulkPublish: (shiftIds: string[]) => void;
    onBulkUnpublish: (shiftIds: string[]) => void;
    onBulkDelete: (shiftIds: string[]) => void;
    /** Group color accent for theming */
    accentColor?: string;
}

const ShiftBucketImpl: React.FC<ShiftBucketProps> = ({
    bucket,
    shifts,
    canEdit,
    onEditShift,
    onDeleteShift,
    onPublishShift,
    onUnpublishShift,
    onBulkPublish,
    onBulkUnpublish,
    onBulkDelete,
    accentColor,
}) => {
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const handleToggle = useCallback(() => {
        setIsExpanded(prev => !prev);
    }, []);

    const handlePublishBucket = useCallback(() => {
        // Only publish draft shifts
        const draftShifts = shifts.filter(s => s.isDraft && !s.isPublished);
        const skippedCount = shifts.length - draftShifts.length;

        if (draftShifts.length === 0) {
            toast({
                title: 'Nothing to publish',
                description: `All ${shifts.length} shifts are already published.`,
            });
            return;
        }

        onBulkPublish(draftShifts.map(s => s.id));

        if (skippedCount > 0) {
            toast({
                title: 'Bucket Published',
                description: `Published ${draftShifts.length} shifts. ${skippedCount} shift${skippedCount !== 1 ? 's' : ''} skipped (already published).`,
            });
        } else {
            toast({
                title: 'Bucket Published',
                description: `Successfully published all ${draftShifts.length} shifts.`,
            });
        }
    }, [shifts, onBulkPublish, toast]);

    const handleUnpublishBucket = useCallback(() => {
        const publishedShifts = shifts.filter(s => s.isPublished);
        const skippedCount = shifts.length - publishedShifts.length;

        if (publishedShifts.length === 0) {
            toast({
                title: 'Nothing to unpublish',
                description: `No published shifts found in this bucket.`,
            });
            return;
        }

        onBulkUnpublish(publishedShifts.map(s => s.id));

        if (skippedCount > 0) {
            toast({
                title: 'Bucket Unpublished',
                description: `Unpublished ${publishedShifts.length} shifts. ${skippedCount} shift${skippedCount !== 1 ? 's' : ''} skipped (already draft).`,
            });
        } else {
            toast({
                title: 'Bucket Unpublished',
                description: `Successfully unpublished all ${publishedShifts.length} shifts.`,
            });
        }
    }, [shifts, onBulkUnpublish, toast]);

    const handleDeleteBucket = useCallback(() => {
        setDeleteDialogOpen(true);
    }, []);

    const confirmDeleteBucket = useCallback(() => {
        const allIds = shifts.map(s => s.id);
        onBulkDelete(allIds);
        setDeleteDialogOpen(false);
    }, [shifts, onBulkDelete]);

    return (
        <div className="mb-1.5">
            {/* Header */}
            <ShiftBucketHeader
                startTime={bucket.startTime}
                endTime={bucket.endTime}
                stats={bucket.stats}
                isExpanded={isExpanded}
                canEdit={canEdit}
                onToggle={handleToggle}
                onPublishBucket={handlePublishBucket}
                onUnpublishBucket={handleUnpublishBucket}
                onDeleteBucket={handleDeleteBucket}
                accentColor={accentColor}
            />

            {/* Expanded rows */}
            {isExpanded && (
                <div
                    className={cn(
                        'border-2 border-t-0 border-border rounded-b-lg overflow-hidden transition-all duration-200',
                        'bg-accent/5 shadow-inner'
                    )}
                    style={{ 
                        borderColor: `${accentColor}99`,
                        borderLeftWidth: '6px',
                        borderLeftColor: accentColor 
                    }}
                >
                    {shifts.map(shift => (
                        <ShiftBucketRow
                            key={shift.id}
                            shiftId={shift.id}
                            role={shift.role}
                            employeeName={shift.employeeName}
                            isAssigned={shift.isAssigned}
                            isPublished={shift.isPublished}
                            isDraft={shift.isDraft}
                            isLocked={shift.isLocked}
                            rawShift={shift.rawShift}
                            canEdit={canEdit}
                            onEdit={onEditShift}
                            onDelete={onDeleteShift}
                            onPublish={onPublishShift}
                            onUnpublish={onUnpublishShift}
                            accentColor={accentColor}
                        />
                    ))}
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Bucket</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete all <strong>{shifts.length}</strong> shifts
                            in this bucket ({bucket.startTime.substring(0, 5)} → {bucket.endTime.substring(0, 5)}).
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteBucket}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Delete All
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// Memoized so a Bucket-view toggle in GroupModeView doesn't re-render every
// ShiftBucket on cells whose own props didn't change. The parent must pass
// stable handler refs (useCallback) for memo to actually take effect.
export const ShiftBucket = React.memo(ShiftBucketImpl);

export default ShiftBucket;
