/**
 * PlanningRequestCard
 *
 * The unified primary surface for both BID and SWAP requests.
 *
 * Layout:
 *   Header  — RequestStatusBadge + type label + relative timestamp
 *   Body    — shift details (or two shifts with ⇌ divider for SWAPs)
 *   Content — status-driven section (offer list / compliance gate / terminal summary)
 *   Footer  — contextual action buttons
 */

import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Briefcase,
  Building2,
  ArrowLeftRight,
  Loader2,
  X,
  RefreshCw,
  Check,
  Gavel,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Hourglass,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { RequestStatusBadge } from './RequestStatusBadge';
import { ComplianceGate } from './ComplianceGate';
import { OfferCard } from './OfferCard';
import type {
  PlanningRequest,
  PlanningOffer,
} from '@/modules/planning/unified/types';
import { isSwapSnapshot, isBidSnapshot } from '@/modules/planning/unified/types';

// =============================================================================
// TYPES
// =============================================================================

interface PlanningRequestCardProps {
  request: PlanningRequest;
  offers: PlanningOffer[];
  viewerId: string;
  viewerRole: 'EMPLOYEE' | 'MANAGER';
  onSelectOffer?: (offerId: string) => Promise<void>;
  onCancel?: () => Promise<void>;
  onReopen?: () => Promise<void>;
  onApprove?: () => Promise<void>;
  onReject?: () => Promise<void>;
  partyALabel?: string;
  partyBLabel?: string;
  isLoading?: boolean;
  // Enrichment for offers — parallel arrays indexed by offer position
  offererNames?: string[];
  offererAvatars?: string[];
  offererRoles?: string[];
  offererDepts?: string[];
  offeredShifts?: Array<{
    shift_date: string;
    start_time: string;
    end_time: string;
    role?: string;
    dept?: string;
  } | undefined>;
  advisoryCompliances?: Array<'PASS' | 'WARNING' | 'BLOCKING' | null | undefined>;
  // Request shift display data
  shiftDate?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  shiftRole?: string;
  shiftDept?: string;
  // For SWAP: the request-side shift
  targetShiftDate?: string;
  targetShiftStartTime?: string;
  targetShiftEndTime?: string;
  targetShiftRole?: string;
  targetShiftDept?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatShiftDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(t?: string): string {
  if (!t) return '—';
  const [h, m] = (t || '00:00').split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return `${display}:${String(m || 0).padStart(2, '0')} ${period}`;
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  } catch {
    return '';
  }
}

// =============================================================================
// SHIFT BLOCK (reusable shift detail row)
// =============================================================================

interface ShiftBlockProps {
  date?: string;
  startTime?: string;
  endTime?: string;
  role?: string;
  dept?: string;
  label?: string;
}

function ShiftBlock({ date, startTime, endTime, role, dept, label }: ShiftBlockProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-3 space-y-1.5">
      {label && (
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Calendar className="h-3.5 w-3.5 text-primary/60" />
        {formatShiftDate(date)}
      </div>
      <div className="flex items-center gap-2 text-sm font-mono font-bold text-foreground/80">
        <Clock className="h-3.5 w-3.5 text-primary/60" />
        {formatTime(startTime)} – {formatTime(endTime)}
      </div>
      {(role || dept) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {role && (
            <span className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {role}
            </span>
          )}
          {dept && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {dept}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// STATUS-DRIVEN CONTENT
// =============================================================================

interface ContentSectionProps {
  request: PlanningRequest;
  offers: PlanningOffer[];
  viewerId: string;
  viewerRole: 'EMPLOYEE' | 'MANAGER';
  isInitiator: boolean;
  partyALabel: string;
  partyBLabel: string;
  onSelectOffer?: (offerId: string) => Promise<void>;
  offererNames: string[];
  offererAvatars: string[];
  offererRoles: string[];
  offererDepts: string[];
  offeredShifts: Array<{ shift_date: string; start_time: string; end_time: string; role?: string; dept?: string } | undefined>;
  advisoryCompliances: Array<'PASS' | 'WARNING' | 'BLOCKING' | null | undefined>;
}

function ContentSection({
  request,
  offers,
  viewerId,
  viewerRole,
  isInitiator,
  partyALabel,
  partyBLabel,
  onSelectOffer,
  offererNames,
  offererAvatars,
  offererRoles,
  offererDepts,
  offeredShifts,
  advisoryCompliances,
}: ContentSectionProps) {
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);

  const handleSelect = async (offerId: string) => {
    if (!onSelectOffer) return;
    setSelectingOfferId(offerId);
    try {
      await onSelectOffer(offerId);
    } finally {
      setSelectingOfferId(null);
    }
  };

  const snapshot = request.compliance_snapshot;
  const isManager = viewerRole === 'MANAGER';

  // OPEN: show offer list for initiator; show "no action" placeholder for others
  if (request.status === 'OPEN') {
    if (isInitiator && offers.length > 0) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
            <CircleDot className="h-3 w-3" />
            {offers.length} offer{offers.length > 1 ? 's' : ''} received
          </div>
          {offers.map((offer, idx) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              requestType={request.type}
              requestStatus={request.status}
              isInitiator={isInitiator}
              onSelect={handleSelect}
              isSelectingOfferId={selectingOfferId}
              offererName={offererNames[idx] ?? 'Unknown'}
              offererAvatar={offererAvatars[idx]}
              offererRole={offererRoles[idx]}
              offererDept={offererDepts[idx]}
              offeredShift={offeredShifts[idx]}
              advisoryCompliance={advisoryCompliances[idx]}
            />
          ))}
        </div>
      );
    }

    if (isInitiator && offers.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 py-8 text-center">
          <Hourglass className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-semibold text-muted-foreground/60">
            Awaiting offers
          </p>
          <p className="text-[11px] text-muted-foreground/40">
            Colleagues can submit offers from the marketplace.
          </p>
        </div>
      );
    }

    // Non-initiator viewing an open request
    return (
      <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
        <p className="text-[11px] text-muted-foreground/60">
          This request is open for offers. Submit your offer from the marketplace.
        </p>
      </div>
    );
  }

  // MANAGER_PENDING: show compliance gate + manager actions
  if (request.status === 'MANAGER_PENDING') {
    return (
      <div className="space-y-3">
        {snapshot &&
          (isSwapSnapshot(snapshot) || isBidSnapshot(snapshot)) && (
            <ComplianceGate
              snapshot={snapshot}
              requestType={request.type}
              partyALabel={partyALabel}
              partyBLabel={partyBLabel}
            />
          )}
        {!snapshot && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Compliance snapshot not yet available.
            </p>
          </div>
        )}
      </div>
    );
  }

  // BLOCKED: show blocking hits from compliance gate
  if (request.status === 'BLOCKED') {
    return (
      <div className="space-y-3">
        {snapshot &&
          (isSwapSnapshot(snapshot) || isBidSnapshot(snapshot)) && (
            <ComplianceGate
              snapshot={snapshot}
              requestType={request.type}
              partyALabel={partyALabel}
              partyBLabel={partyBLabel}
            />
          )}
      </div>
    );
  }

  // APPROVED / REJECTED / CANCELLED / EXPIRED: terminal summary
  if (['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(request.status)) {
    const terminalMessages: Record<string, { message: string; cls: string }> = {
      APPROVED: {
        message: 'This request was approved. Shift ownership has been transferred.',
        cls: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
      },
      REJECTED: {
        message:
          request.manager_notes
            ? `Rejected by manager. Notes: ${request.manager_notes}`
            : 'This request was rejected by the manager.',
        cls: 'border-rose-500/20 bg-rose-500/5 text-rose-700 dark:text-rose-400',
      },
      CANCELLED: {
        message: 'This request was cancelled by the initiator.',
        cls: 'border-slate-500/20 bg-slate-500/5 text-slate-600 dark:text-slate-400',
      },
      EXPIRED: {
        message: 'This request expired before the shift start time.',
        cls: 'border-slate-500/20 bg-slate-500/5 text-slate-600 dark:text-slate-400',
      },
    };

    const info = terminalMessages[request.status];

    return (
      <div className="space-y-3">
        <div className={cn('rounded-xl border px-4 py-3', info.cls)}>
          <p className="text-[12px] font-medium leading-relaxed">{info.message}</p>
          {request.decided_at && (
            <p className="mt-1 text-[10px] font-mono text-muted-foreground/50">
              {formatRelativeTime(request.decided_at)}
            </p>
          )}
        </div>
        {/* Show compact compliance summary if available */}
        {snapshot &&
          request.status === 'REJECTED' &&
          (isSwapSnapshot(snapshot) || isBidSnapshot(snapshot)) && (
            <ComplianceGate
              snapshot={snapshot}
              requestType={request.type}
              partyALabel={partyALabel}
              partyBLabel={partyBLabel}
              compact
            />
          )}
      </div>
    );
  }

  return null;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PlanningRequestCard({
  request,
  offers,
  viewerId,
  viewerRole,
  onSelectOffer,
  onCancel,
  onReopen,
  onApprove,
  onReject,
  partyALabel = 'Requester',
  partyBLabel = 'Offerer',
  isLoading = false,
  offererNames = [],
  offererAvatars = [],
  offererRoles = [],
  offererDepts = [],
  offeredShifts = [],
  advisoryCompliances = [],
  shiftDate,
  shiftStartTime,
  shiftEndTime,
  shiftRole,
  shiftDept,
  targetShiftDate,
  targetShiftStartTime,
  targetShiftEndTime,
  targetShiftRole,
  targetShiftDept,
}: PlanningRequestCardProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [showOffers, setShowOffers] = useState(true);

  const isInitiator = request.initiated_by === viewerId;
  const isManager = viewerRole === 'MANAGER';

  const canCancel =
    isInitiator &&
    (request.status === 'OPEN' || request.status === 'MANAGER_PENDING');
  const canReopen =
    isInitiator &&
    (request.status === 'BLOCKED' ||
      request.status === 'REJECTED' ||
      request.status === 'EXPIRED');
  const canManagerAct = isManager && request.status === 'MANAGER_PENDING';

  const hasBlockingCompliance =
    request.compliance_snapshot !== null &&
    (isSwapSnapshot(request.compliance_snapshot)
      ? request.compliance_snapshot.combined_status === 'BLOCKING'
      : isBidSnapshot(request.compliance_snapshot)
      ? request.compliance_snapshot.overall_status === 'BLOCKING'
      : false);

  const handleCancel = async () => {
    if (!onCancel) return;
    setIsCancelling(true);
    try {
      await onCancel();
    } finally {
      setIsCancelling(false);
    }
  };

  const handleReopen = async () => {
    if (!onReopen) return;
    setIsReopening(true);
    try {
      await onReopen();
    } finally {
      setIsReopening(false);
    }
  };

  const handleApprove = async () => {
    if (!onApprove) return;
    setIsApproving(true);
    try {
      await onApprove();
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!onReject) return;
    setIsRejecting(true);
    try {
      await onReject();
    } finally {
      setIsRejecting(false);
    }
  };

  // Accent stripe color by status
  const stripeColor: Record<string, string> = {
    OPEN: 'bg-blue-500',
    MANAGER_PENDING: 'bg-amber-500',
    BLOCKED: 'bg-rose-500',
    APPROVED: 'bg-emerald-500',
    REJECTED: 'bg-rose-500/50',
    CANCELLED: 'bg-slate-400/50',
    EXPIRED: 'bg-slate-400/50',
  };

  return (
    <div
      className={cn(
        'modern-card relative flex flex-col overflow-hidden',
        isLoading && 'opacity-60',
      )}
    >
      {/* Top accent stripe */}
      <div
        className={cn(
          'h-1 flex-shrink-0',
          stripeColor[request.status] ?? 'bg-primary/30',
        )}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-sm">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <RequestStatusBadge status={request.status} size="sm" />
          <span className="rounded-full border border-border/50 bg-muted/50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
            {request.type === 'BID' ? 'Shift Bid' : 'Shift Swap'}
          </span>
        </div>
        <span className="flex-shrink-0 text-[10px] font-mono text-muted-foreground/40">
          {formatRelativeTime(request.created_at)}
        </span>
      </div>

      {/* ── SHIFT DETAILS ── */}
      <div className="px-5 pb-4">
        {request.type === 'SWAP' ? (
          /* Two shifts side by side with ⇌ divider */
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <ShiftBlock
              date={shiftDate}
              startTime={shiftStartTime}
              endTime={shiftEndTime}
              role={shiftRole}
              dept={shiftDept}
              label="Your Shift"
            />
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>
            <ShiftBlock
              date={targetShiftDate}
              startTime={targetShiftStartTime}
              endTime={targetShiftEndTime}
              role={targetShiftRole}
              dept={targetShiftDept}
              label="Offered Shift"
            />
          </div>
        ) : (
          /* Single shift */
          <ShiftBlock
            date={shiftDate}
            startTime={shiftStartTime}
            endTime={shiftEndTime}
            role={shiftRole}
            dept={shiftDept}
          />
        )}
      </div>

      {/* ── COLLAPSIBLE CONTENT ── */}
      <div className="border-t border-border/30">
        {/* Toggle for offer list section */}
        {request.status === 'OPEN' && offers.length > 0 && isInitiator && (
          <button
            onClick={() => setShowOffers((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
          >
            <span>
              {offers.length} offer{offers.length > 1 ? 's' : ''} waiting
            </span>
            {showOffers ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* Status-driven content body */}
        {(request.status !== 'OPEN' || showOffers) && (
          <div className="px-5 py-4">
            <ContentSection
              request={request}
              offers={offers}
              viewerId={viewerId}
              viewerRole={viewerRole}
              isInitiator={isInitiator}
              partyALabel={partyALabel}
              partyBLabel={partyBLabel}
              onSelectOffer={onSelectOffer}
              offererNames={offererNames}
              offererAvatars={offererAvatars}
              offererRoles={offererRoles}
              offererDepts={offererDepts}
              offeredShifts={offeredShifts}
              advisoryCompliances={advisoryCompliances}
            />
          </div>
        )}
      </div>

      {/* ── FOOTER ACTIONS ── */}
      {(canCancel || canReopen || canManagerAct) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/30 bg-muted/10 px-5 py-3">
          {/* Initiator: Cancel */}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling || isApproving || isRejecting}
              className="h-8 gap-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
            >
              {isCancelling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Cancel Request
            </Button>
          )}

          {/* Initiator: Reopen */}
          {canReopen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReopen}
              disabled={isReopening}
              className="h-8 gap-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-muted-foreground hover:bg-primary/10 hover:text-primary"
            >
              {isReopening ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Reopen
            </Button>
          )}

          {/* Manager: Reject */}
          {canManagerAct && (
            <Button
              size="sm"
              onClick={handleReject}
              disabled={isApproving || isRejecting}
              className="h-8 gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 text-[10px] font-black uppercase tracking-wider text-rose-600 hover:bg-rose-500/20 dark:text-rose-400"
            >
              {isRejecting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Reject
            </Button>
          )}

          {/* Manager: Approve */}
          {canManagerAct && (
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={isApproving || isRejecting || hasBlockingCompliance}
              className={cn(
                'h-8 gap-1.5 rounded-lg px-4 text-[10px] font-black uppercase tracking-wider border-none',
                hasBlockingCompliance
                  ? 'cursor-not-allowed bg-muted text-muted-foreground/40'
                  : 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90',
              )}
            >
              {isApproving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Approving…
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" />
                  <Gavel className="h-3 w-3" />
                  Approve
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default PlanningRequestCard;
