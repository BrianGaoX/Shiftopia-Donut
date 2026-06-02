import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  X, Trash2, TrendingUp, Loader2, Undo2, UserCheck,
  CheckCircle2, AlertTriangle, RefreshCw,
} from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';

// =============================================================================
// EXPORTED TYPES (imported by parent pages)
// =============================================================================

/** Structured result returned by every bulk action callback. */
export type BulkActionResult = {
  successCount: number;
  failedCount: number;
  failedDetails?: Array<{ id: string; reason: string }>;
};

/**
 * Result of async compliance pre-validation.
 * Returned by `onValidatePublish` — matches the shape of
 * `shiftsCommands.validateBulkPublishCompliance`.
 */
export type BulkPublishValidationResult = {
  eligible: string[];
  complianceFailed: Array<{ id: string; reason: string }>;
  skipped: Array<{ id: string; reason: string }>;
};

/**
 * Pre-computed preflight summary (sync, no network).
 * Parent computes from Shift[] via bulk-action-engine.ts.
 */
export interface ToolbarPreflightData {
  publish:   { eligible: number; blocked: number; warned: number };
  unpublish: { eligible: number; blocked: number; warned: number };
  delete:    { eligible: number; warned: number };
  unassign:  { eligible: number; blocked: number };
}

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Six-state machine — mutex by construction.
 *
 * idle → validating (async compliance) → confirming (with results) → processing → result
 *
 * The `validating` state is a REAL async state — visible in UI as a spinner.
 * The `confirming` state carries the preflight/validated counts and validated IDs.
 * The `result` state carries the execution outcome including per-shift failure details.
 */
type ConfirmAction = 'delete' | 'publish' | 'unpublish';

type ActionPreview = {
  eligible: number;
  blocked: number;
  warned: number;
};

type ActionState =
  | { type: 'idle' }
  | { type: 'validating'; action: ConfirmAction }
  | {
      type: 'confirming';
      action: ConfirmAction;
      preview: ActionPreview;
      /** IDs returned by async validation — passed directly to execution (skips re-check). */
      validatedIds?: string[];
    }
  | { type: 'processing'; action: ConfirmAction }
  | {
      type: 'result';
      action: ConfirmAction;
      result: BulkActionResult;
      /** IDs that were attempted — used for retry. */
      attemptedIds: string[];
    };

const IDLE: ActionState = { type: 'idle' };

// =============================================================================
// PROPS
// =============================================================================

interface BulkActionsToolbarProps {
  selectedCount: number;
  selectedV8ShiftIds: string[];
  onClearSelection: () => void;
  onDelete: () => Promise<BulkActionResult>;
  onSelectAll?: () => void;
  onPublish?: (shiftIds: string[]) => Promise<BulkActionResult>;
  onUnpublish?: (shiftIds: string[]) => Promise<BulkActionResult>;
  onAssign?: () => void;
  onUnassign?: () => void;
  stateCounts?: {
    assignedCount: number;
    unassignedCount: number;
    draftCount: number;
    publishedCount: number;
  };
  preflightData?: ToolbarPreflightData;
  allowedActions?: {
    canPublish: boolean;
    canUnpublish: boolean;
    canUnpublishReason?: string;
  };
  /**
   * Total selectable shifts in the current view (after locking filter).
   * Used to determine "Select All" vs "Deselect All" state and show scope label.
   */
  totalVisibleCount?: number;
  /**
   * Optional async compliance validator.
   * When provided: clicking Publish enters the `validating` state, runs compliance
   * for all assigned draft shifts, then transitions to `confirming` with full results.
   * When absent: sync preflight only (instant, no compliance pre-check).
   */
  onValidatePublish?: (shiftIds: string[]) => Promise<BulkPublishValidationResult>;
}

// =============================================================================
// HELPERS
// =============================================================================

function eligibleSuffix(eligible: number, total: number): string {
  if (eligible === total || eligible === 0) return '';
  return ` (${eligible})`;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const BulkActionsToolbar: React.FC<BulkActionsToolbarProps> = ({
  selectedCount,
  selectedV8ShiftIds,
  onClearSelection,
  onSelectAll,
  onDelete,
  onPublish,
  onUnpublish,
  onAssign,
  onUnassign,
  stateCounts,
  preflightData,
  allowedActions,
  totalVisibleCount,
  onValidatePublish,
}) => {
  const [actionState, setActionState] = useState<ActionState>(IDLE);
  const { toast } = useToast();

  // ── Derived booleans ─────────────────────────────────────────────────────
  const isValidating  = actionState.type === 'validating';
  const showDeleteDialog    = actionState.type === 'confirming' && actionState.action === 'delete';
  const showPublishDialog   = actionState.type === 'confirming' && actionState.action === 'publish';
  const showUnpublishDialog = actionState.type === 'confirming' && actionState.action === 'unpublish';
  const isDeleting    = actionState.type === 'processing' && actionState.action === 'delete';
  const isPublishing  = actionState.type === 'processing' && actionState.action === 'publish';
  const isUnpublishing = actionState.type === 'processing' && actionState.action === 'unpublish';

  /** Lock all controls while any async operation runs. */
  const isBusy = actionState.type === 'processing' || actionState.type === 'validating';

  /** True when every selectable shift in the current view is selected. */
  const isAllSelected = totalVisibleCount !== undefined
    && totalVisibleCount > 0
    && selectedCount === totalVisibleCount;

  // ── Eligibility counts for button labels ─────────────────────────────────
  const publishEligible   = preflightData?.publish.eligible   ?? (stateCounts?.draftCount     ?? 0);
  const unpublishEligible = preflightData?.unpublish.eligible ?? (stateCounts?.publishedCount ?? 0);
  const unassignEligible  = preflightData?.unassign.eligible  ?? (stateCounts?.assignedCount  ?? 0);

  const publishEnabled   = publishEligible > 0;
  const unpublishEnabled = unpublishEligible > 0;
  const assignEnabled    = stateCounts ? stateCounts.unassignedCount > 0 : true;
  const unassignEnabled  = unassignEligible > 0;

  // Preview from confirming state
  const preview = actionState.type === 'confirming' ? actionState.preview : null;

  // ==========================================================================
  // CLICK HANDLERS (enter confirming — optionally via async validating)
  // ==========================================================================

  const handleClickPublish = async () => {
    if (!onPublish) return;

    if (onValidatePublish) {
      // ── ASYNC PATH: real VALIDATING state ──────────────────────────────
      setActionState({ type: 'validating', action: 'publish' });
      try {
        const validation = await onValidatePublish(selectedV8ShiftIds);
        setActionState({
          type: 'confirming',
          action: 'publish',
          preview: {
            eligible: validation.eligible.length,
            // compliance failures + already-published are both "blocked" from the user's perspective
            blocked: validation.complianceFailed.length + validation.skipped.length,
            // warned = compliance-flagged eligible shifts (currently zero since compliance_failed = blocked)
            warned: 0,
          },
          validatedIds: validation.eligible,
        });
      } catch {
        toast({ title: 'Validation failed', description: 'Could not run compliance checks.', variant: 'destructive' });
        setActionState(IDLE);
      }
    } else {
      // ── SYNC PATH: use preflight data (no compliance) ──────────────────
      setActionState({
        type: 'confirming',
        action: 'publish',
        preview: {
          eligible: preflightData?.publish.eligible ?? publishEligible,
          blocked:  preflightData?.publish.blocked  ?? 0,
          warned:   preflightData?.publish.warned   ?? 0,
        },
      });
    }
  };

  const handleClickUnpublish = () => {
    setActionState({
      type: 'confirming',
      action: 'unpublish',
      preview: {
        eligible: preflightData?.unpublish.eligible ?? unpublishEligible,
        blocked:  preflightData?.unpublish.blocked  ?? 0,
        warned:   preflightData?.unpublish.warned   ?? 0,
      },
    });
  };

  const handleClickDelete = () => {
    setActionState({
      type: 'confirming',
      action: 'delete',
      preview: {
        eligible: selectedCount,
        blocked:  0,
        warned:   preflightData?.delete.warned ?? (stateCounts?.publishedCount ?? 0),
      },
    });
  };

  // ==========================================================================
  // EXECUTION HANDLERS
  // ==========================================================================

  const handleDelete = async () => {
    setActionState({ type: 'processing', action: 'delete' });
    try {
      const result = await onDelete();
      const msg = result.failedCount > 0
        ? `${result.successCount} deleted · ${result.failedCount} could not be removed`
        : `${result.successCount} shift${result.successCount !== 1 ? 's' : ''} deleted`;
      toast({
        title: result.failedCount > 0 ? 'Partial Delete' : 'Deleted',
        description: msg,
        variant: result.failedCount > 0 ? 'destructive' : 'default',
      });
      setActionState(IDLE);
      onClearSelection();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete shifts.', variant: 'destructive' });
      setActionState(IDLE);
    }
  };

  const handlePublish = async () => {
    if (!onPublish) return;

    // Use validated IDs from async validation if available (avoids double compliance check)
    const idsToPublish =
      actionState.type === 'confirming' && actionState.validatedIds
        ? actionState.validatedIds
        : selectedV8ShiftIds;

    setActionState({ type: 'processing', action: 'publish' });
    try {
      const result = await onPublish(idsToPublish);
      setActionState({ type: 'result', action: 'publish', result, attemptedIds: idsToPublish });
    } catch {
      toast({ title: 'Error', description: 'Failed to publish shifts.', variant: 'destructive' });
      setActionState(IDLE);
    }
  };

  const handleUnpublish = async () => {
    if (!onUnpublish) return;
    setActionState({ type: 'processing', action: 'unpublish' });
    try {
      const result = await onUnpublish(selectedV8ShiftIds);
      if (result.failedCount === 0) {
        toast({
          title: 'Unpublished',
          description: `${result.successCount} shift${result.successCount !== 1 ? 's' : ''} reverted to Draft.`,
        });
        setActionState(IDLE);
        onClearSelection();
      } else {
        setActionState({ type: 'result', action: 'unpublish', result, attemptedIds: selectedV8ShiftIds });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to unpublish shifts.', variant: 'destructive' });
      setActionState(IDLE);
    }
  };

  // ==========================================================================
  // RETRY HANDLER — re-runs the same action on failed IDs only
  // ==========================================================================

  const handleRetry = async () => {
    if (actionState.type !== 'result') return;
    const { action, result } = actionState;

    const failedIds = result.failedDetails?.map(f => f.id) ?? [];
    if (failedIds.length === 0) return;

    setActionState({ type: 'processing', action });
    try {
      let retryResult: BulkActionResult | undefined;
      if (action === 'publish'   && onPublish)   retryResult = await onPublish(failedIds);
      if (action === 'unpublish' && onUnpublish)  retryResult = await onUnpublish(failedIds);

      if (retryResult) {
        setActionState({ type: 'result', action, result: retryResult, attemptedIds: failedIds });
      } else {
        setActionState(IDLE);
      }
    } catch {
      toast({ title: 'Retry failed', variant: 'destructive' });
      setActionState(IDLE);
    }
  };

  const dismissResult = () => {
    setActionState(IDLE);
    onClearSelection();
  };

  if (selectedCount === 0) return null;

  // ==========================================================================
  // RESULT PANEL
  // ==========================================================================

  if (actionState.type === 'result') {
    const { result, action } = actionState;
    const isPartial   = result.failedCount > 0 && result.successCount > 0;
    const isAllFailed = result.successCount === 0;
    const canRetry    = result.failedDetails && result.failedDetails.length > 0
                        && (action === 'publish' || action === 'unpublish');

    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-300">
        <div className={cn(
          'backdrop-blur-xl border shadow-[0_8px_32px_rgba(0,0,0,0.15)] rounded-2xl px-6 py-4 flex flex-col gap-3 min-w-[320px] max-w-[520px]',
          isAllFailed
            ? 'bg-destructive/10 border-destructive/30'
            : isPartial
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-emerald-500/10 border-emerald-500/30',
        )}>
          <div className="flex items-start gap-3">
            {isAllFailed ? (
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            ) : isPartial ? (
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              {isAllFailed ? (
                <p className="text-sm font-medium text-destructive">
                  {action === 'publish' ? 'Publish failed' : 'Action failed'} — {result.failedCount} shift{result.failedCount !== 1 ? 's' : ''} could not be processed.
                </p>
              ) : isPartial ? (
                <p className="text-sm font-medium text-amber-300">
                  {result.successCount} succeeded · {result.failedCount} failed
                </p>
              ) : (
                <p className="text-sm font-medium text-emerald-300">
                  {result.successCount} shift{result.successCount !== 1 ? 's' : ''} {action === 'publish' ? 'published' : action === 'unpublish' ? 'unpublished' : 'processed'} successfully.
                </p>
              )}
              {result.failedDetails && result.failedDetails.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Reason{result.failedDetails.length > 1 ? 's' : ''}:{' '}
                  {Array.from(new Set(result.failedDetails.map(f => f.reason))).slice(0, 3).join(' · ')}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={dismissResult} className="rounded-full hover:bg-muted shrink-0 -mt-1">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Retry row */}
          {canRetry && (
            <div className="flex items-center gap-3 pt-1 border-t border-border/50">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                disabled={(actionState as any).type === 'processing'}
                className="gap-1.5 h-7 text-xs rounded-full"
              >
                <RefreshCw className="h-3 w-3" />
                Retry {result.failedCount} Failed
              </Button>
              <span className="text-xs text-muted-foreground">or</span>
              <Button variant="ghost" size="sm" onClick={dismissResult} className="h-7 text-xs rounded-full text-muted-foreground">
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // MAIN TOOLBAR
  // ==========================================================================

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-300">
        <div className="bg-background/95 dark:bg-popover/90 backdrop-blur-xl border border-border shadow-[0_8px_32px_rgba(0,0,0,0.15)] rounded-full px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-4">

            {/* Selection badge */}
            <div className="flex flex-col items-start min-w-[120px]">
              <Badge variant="glass" className="px-3 py-1.5 text-sm font-medium bg-primary/20 text-primary dark:text-white border-primary/20 shadow-glow whitespace-nowrap flex-shrink-0">
                {isAllSelected ? `All ${selectedCount}` : selectedCount} Selected
              </Badge>
              <div className="flex gap-2 mt-1 px-1">
                {/* Scope indicator */}
                {totalVisibleCount !== undefined && !isAllSelected && (
                  <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap">of {totalVisibleCount} in view</span>
                )}
                {isAllSelected && (
                  <span className="text-[10px] text-primary/70 whitespace-nowrap">entire view</span>
                )}
                {stateCounts && selectedCount > 0 && (
                  <>
                    {stateCounts.assignedCount > 0 && (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{stateCounts.assignedCount} assigned</span>
                    )}
                    {stateCounts.unassignedCount > 0 && (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{stateCounts.unassignedCount} unassigned</span>
                    )}
                    {stateCounts.draftCount > 0 && (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{stateCounts.draftCount} draft</span>
                    )}
                    {stateCounts.publishedCount > 0 && (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{stateCounts.publishedCount} published</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Select All / Deselect All — toggles based on whether all visible shifts are selected */}
            {onSelectAll && (
              isAllSelected ? (
                <Button
                  variant="ghost" size="sm"
                  onClick={onClearSelection}
                  disabled={isBusy}
                  className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
                >
                  <X className="h-4 w-4" />
                  Deselect All
                </Button>
              ) : (
                <Button
                  variant="ghost" size="sm"
                  onClick={onSelectAll}
                  disabled={isBusy}
                  className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
                >
                  <TrendingUp className="h-4 w-4" />
                  Select All{totalVisibleCount !== undefined ? ` (${totalVisibleCount})` : ''}
                </Button>
              )
            )}

            {/* Publish — async validating path shows spinner on button */}
            {onPublish && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="default" size="sm"
                      disabled={isBusy || !publishEnabled}
                      onClick={handleClickPublish}
                      className={cn(
                        'gap-2 shadow-glow rounded-full',
                        publishEnabled
                          ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                          : 'bg-muted text-muted-foreground/30',
                      )}
                    >
                      {(isPublishing || (isValidating && actionState.action === 'publish')) ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {isValidating ? 'Checking…' : 'Publishing…'}
                        </>
                      ) : (
                        <>
                          <TrendingUp className="h-4 w-4" />
                          Publish{eligibleSuffix(publishEligible, selectedCount)}
                        </>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!publishEnabled && (
                  <TooltipContent><p>No eligible draft shifts in selection</p></TooltipContent>
                )}
                {publishEnabled && preflightData && preflightData.publish.blocked > 0 && !isBusy && (
                  <TooltipContent>
                    <p>{preflightData.publish.blocked} shift{preflightData.publish.blocked !== 1 ? 's' : ''} will be skipped (already published or cancelled)</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            {/* Unpublish */}
            {onUnpublish && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="default" size="sm"
                      disabled={isBusy || !unpublishEnabled}
                      onClick={handleClickUnpublish}
                      className={cn(
                        'gap-2 rounded-full',
                        unpublishEnabled
                          ? 'bg-transparent border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 shadow-glow'
                          : 'bg-muted text-muted-foreground/30',
                      )}
                    >
                      {isUnpublishing ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Unpublishing…</>
                      ) : (
                        <><Undo2 className="h-4 w-4" />Unpublish{eligibleSuffix(unpublishEligible, selectedCount)}</>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!unpublishEnabled && (
                  <TooltipContent><p>{allowedActions?.canUnpublishReason ?? 'No published shifts in selection'}</p></TooltipContent>
                )}
                {unpublishEnabled && preflightData && preflightData.unpublish.blocked > 0 && !isBusy && (
                  <TooltipContent>
                    <p>{preflightData.unpublish.blocked} in bidding — cannot unpublish</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            <div className="w-px h-6 bg-border mx-1" />

            {/* Assign */}
            {onAssign && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="default" size="sm"
                      disabled={isBusy || !assignEnabled}
                      onClick={onAssign}
                      className={cn(
                        'gap-2 rounded-full shadow-glow',
                        assignEnabled ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : 'bg-muted text-muted-foreground/30',
                      )}
                    >
                      <UserCheck className="h-4 w-4" />Assign
                    </Button>
                  </span>
                </TooltipTrigger>
                {!assignEnabled && <TooltipContent><p>No unassigned shifts in selection</p></TooltipContent>}
              </Tooltip>
            )}

            {/* Unassign */}
            {onUnassign && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="ghost" size="sm"
                      disabled={isBusy || !unassignEnabled}
                      onClick={onUnassign}
                      className={cn(
                        'gap-2 rounded-full',
                        unassignEnabled ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10' : 'text-muted-foreground/30',
                      )}
                    >
                      <X className="h-4 w-4" />
                      Unassign{eligibleSuffix(unassignEligible, selectedCount)}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!unassignEnabled && <TooltipContent><p>No assigned shifts eligible for unassign</p></TooltipContent>}
                {unassignEnabled && preflightData && preflightData.unassign.blocked > 0 && !isBusy && (
                  <TooltipContent>
                    <p>{preflightData.unassign.blocked} in bidding or not assigned — will be skipped</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            {/* Delete */}
            <Button
              variant="ghost" size="sm"
              disabled={isBusy}
              onClick={handleClickDelete}
              className="gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full"
            >
              {isDeleting ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Deleting…</>
              ) : (
                <><Trash2 className="h-4 w-4" />Delete</>
              )}
            </Button>

            <div className="w-px h-6 bg-border mx-2" />

            <Button variant="ghost" size="icon" onClick={onClearSelection} className="text-muted-foreground hover:text-foreground rounded-full hover:bg-muted">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => !open && setActionState(IDLE)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Shift{selectedCount > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>This action cannot be undone.</p>
                {preview && preview.warned > 0 && (
                  <p className="text-amber-400 font-medium">
                    ⚠ {preview.warned} shift{preview.warned !== 1 ? 's are' : ' is'} published —
                    {stateCounts && stateCounts.assignedCount > 0 ? ' employees will be notified.' : ' removed from employee view.'}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete {selectedCount} Shift{selectedCount > 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Confirmation — shows compliance-validated preview when available */}
      <AlertDialog open={showPublishDialog} onOpenChange={(open) => !open && setActionState(IDLE)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Publish {preview?.eligible ?? 0} Shift{(preview?.eligible ?? 0) !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {/* Compliance validation ran — show detailed results */}
                {actionState.type === 'confirming' && actionState.validatedIds ? (
                  <>
                    <p className="text-emerald-400 font-medium">
                      ✓ Compliance checked — {preview!.eligible} shift{preview!.eligible !== 1 ? 's' : ''} ready to publish.
                    </p>
                    {preview!.blocked > 0 && (
                      <p className="text-destructive text-xs">
                        {preview!.blocked} shift{preview!.blocked !== 1 ? 's' : ''} failed compliance or were already published — excluded.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p>Compliance will be checked during publishing. Only passing shifts will be published.</p>
                    {preview && preview.blocked > 0 && (
                      <p className="text-muted-foreground/70 text-xs">
                        {preview.blocked} already-published/cancelled shift{preview.blocked !== 1 ? 's' : ''} will be skipped.
                      </p>
                    )}
                  </>
                )}
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Assigned shifts will be sent as Offers to employees.</li>
                  <li>Unassigned shifts will go to Open Bidding.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={(e) => { e.preventDefault(); handlePublish(); }}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Publishing…</>
              ) : 'Confirm Publish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unpublish Confirmation — shows preflight preview + retraction warning */}
      <AlertDialog open={showUnpublishDialog} onOpenChange={(open) => !open && setActionState(IDLE)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unpublish {preview?.eligible ?? 0} Shift{(preview?.eligible ?? 0) !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Selected shifts will revert to Draft and be hidden from employees.</p>
                {preview && preview.blocked > 0 && (
                  <p className="text-muted-foreground/70 text-xs">
                    {preview.blocked} shift{preview.blocked !== 1 ? 's are' : ' is'} in bidding or not published — will be skipped.
                  </p>
                )}
                {preview && preview.warned > 0 && (
                  <p className="text-amber-400 font-medium">
                    ⚠ {preview.warned} assigned shift{preview.warned !== 1 ? 's' : ''} — pending offers will be retracted from employees.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnpublishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={(e) => { e.preventDefault(); handleUnpublish(); }}
              disabled={isUnpublishing}
            >
              {isUnpublishing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Unpublishing…</>
              ) : 'Confirm Unpublish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
