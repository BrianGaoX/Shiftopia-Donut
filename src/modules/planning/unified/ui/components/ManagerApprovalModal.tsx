/**
 * ManagerApprovalModal
 *
 * Full-screen 3-section modal for manager approval of planning requests.
 *
 * Layout:
 *   Left  (40%) — Exchange Pane: who is giving what to whom
 *   Center(40%) — Compliance Pane: ComplianceGate with full detail
 *   Right (20%) — Decision Pane: approve/reject + notes + staleness warning
 *
 * Staleness: if compliance snapshot is >10 minutes old, a warning banner is
 * shown in the decision pane to prompt re-evaluation before acting.
 *
 * Replaces the legacy ManagerComplianceApprovalModal.
 */

import React, { useState, useMemo } from 'react';
import {
  X,
  Shield,
  ArrowLeftRight,
  Calendar,
  Clock,
  Briefcase,
  Building2,
  AlertTriangle,
  Check,
  Gavel,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/modules/core/ui/primitives/drawer';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { ComplianceGate } from './ComplianceGate';
import type {
  PlanningRequest,
  PlanningOffer,
  SwapComplianceSnapshot,
  BidComplianceSnapshot,
} from '@/modules/planning/unified/types';
import { isSwapSnapshot, isBidSnapshot } from '@/modules/planning/unified/types';
import type { V8Status } from '@/modules/compliance/v8/types';

// =============================================================================
// TYPES
// =============================================================================

interface ManagerApprovalModalProps {
  request: PlanningRequest;
  offer: PlanningOffer;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (notes?: string) => Promise<void>;
  onReject: (notes?: string) => Promise<void>;
  partyALabel: string;
  partyBLabel: string;
  isSubmitting?: boolean;
  // Enriched shift details for exchange pane
  partyAShift?: {
    shift_date: string;
    start_time: string;
    end_time: string;
    role?: string;
    dept?: string;
  };
  partyBShift?: {
    shift_date: string;
    start_time: string;
    end_time: string;
    role?: string;
    dept?: string;
  };
}

// =============================================================================
// HELPERS
// =============================================================================

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function isSnapshotStale(evaluatedAt?: string): boolean {
  if (!evaluatedAt) return false;
  try {
    return Date.now() - new Date(evaluatedAt).getTime() > STALE_THRESHOLD_MS;
  } catch {
    return false;
  }
}

function getOverallStatus(
  snapshot: BidComplianceSnapshot | SwapComplianceSnapshot | null,
): V8Status | null {
  if (!snapshot) return null;
  if (isSwapSnapshot(snapshot)) return snapshot.combined_status;
  if (isBidSnapshot(snapshot)) return snapshot.overall_status;
  return null;
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatShiftDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(t?: string): string {
  if (!t) return '—';
  const [h, m] = (t || '00:00').split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${period}`;
}

// =============================================================================
// PARTY EXCHANGE ROW
// =============================================================================

interface PartyRowProps {
  label: string;
  personLabel: string;
  shift?: {
    shift_date: string;
    start_time: string;
    end_time: string;
    role?: string;
    dept?: string;
  };
  avatarColor: string;
}

function PartyRow({ label, personLabel, shift, avatarColor }: PartyRowProps) {
  return (
    <div className="space-y-3">
      {/* Person header */}
      <div className="flex items-center gap-3">
        <Avatar className="h-9 w-9 ring-2 ring-border">
          <AvatarFallback
            className={cn('text-[11px] font-black text-white', avatarColor)}
          >
            {getInitials(personLabel)}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-black text-foreground">{personLabel}</p>
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
            {label}
          </p>
        </div>
      </div>

      {/* Shift detail */}
      {shift ? (
        <div className="rounded-xl border border-border/50 bg-muted/30 p-3 space-y-1.5 ml-12">
          <div className="flex items-center gap-2 text-[12px] font-bold text-foreground">
            <Calendar className="h-3.5 w-3.5 text-primary/60" />
            {formatShiftDate(shift.shift_date)}
          </div>
          <div className="flex items-center gap-2 font-mono text-[12px] font-bold text-foreground/80">
            <Clock className="h-3.5 w-3.5 text-primary/60" />
            {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
          </div>
          {shift.role && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Briefcase className="h-3 w-3" />
              {shift.role}
              {shift.dept && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <Building2 className="h-3 w-3" />
                  {shift.dept}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="ml-12 rounded-xl border border-dashed border-border/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground/40">
            No shift details available
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ManagerApprovalModal({
  request,
  offer,
  isOpen,
  onClose,
  onApprove,
  onReject,
  partyALabel,
  partyBLabel,
  isSubmitting = false,
  partyAShift,
  partyBShift,
}: ManagerApprovalModalProps) {
  const [notes, setNotes] = useState('');
  const [isApprovingLocal, setIsApprovingLocal] = useState(false);
  const [isRejectingLocal, setIsRejectingLocal] = useState(false);
  const [activePane, setActivePane] = useState<'exchange' | 'compliance' | 'decision'>('exchange');
  const isMobile = useIsMobile();

  const snapshot = request.compliance_snapshot;
  const overallStatus = getOverallStatus(snapshot);

  const stale = useMemo(() => {
    if (!snapshot) return false;
    const evaluatedAt = isSwapSnapshot(snapshot)
      ? snapshot.evaluated_at
      : isBidSnapshot(snapshot)
      ? snapshot.evaluated_at
      : undefined;
    return isSnapshotStale(evaluatedAt);
  }, [snapshot]);

  const isBlocking = overallStatus === 'BLOCKING';

  const handleApprove = async () => {
    setIsApprovingLocal(true);
    try {
      await onApprove(notes.trim() || undefined);
    } finally {
      setIsApprovingLocal(false);
    }
  };

  const handleReject = async () => {
    setIsRejectingLocal(true);
    try {
      await onReject(notes.trim() || undefined);
    } finally {
      setIsRejectingLocal(false);
    }
  };

  if (!isOpen) return null;

  const isBusy = isSubmitting || isApprovingLocal || isRejectingLocal;

  // Compliance accent line color
  const accentColor =
    overallStatus === 'PASS'
      ? 'bg-emerald-500'
      : overallStatus === 'BLOCKING'
      ? 'bg-rose-500'
      : overallStatus === 'WARNING'
      ? 'bg-amber-500'
      : 'bg-primary/30';

  // -------------------------------------------------------------------------
  // Inner content shared between mobile Drawer and desktop overlay
  // -------------------------------------------------------------------------
  const innerContent = (
    <>
      {/* Top accent stripe */}
      <div className={cn('h-1.5 flex-shrink-0', accentColor)} />

      {/* ── MODAL HEADER ── */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-black tracking-tight text-foreground">
              Approval Review
            </h2>
            <p className="text-[10px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">
              {request.type === 'SWAP' ? 'Shift Swap' : 'Shift Bid'} · Manager Gate
            </p>
          </div>
        </div>

        {/* Pane switcher — all sub-lg screens including mobile */}
        <div className="flex items-center gap-1 rounded-xl border border-border/50 bg-muted/30 p-1 lg:hidden">
          {(['exchange', 'compliance', 'decision'] as const).map((pane) => (
            <button
              key={pane}
              onClick={() => setActivePane(pane)}
              className={cn(
                'min-h-[44px] rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-wider transition-all',
                activePane === pane
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-muted-foreground',
              )}
            >
              {pane === 'exchange' ? 'Exchange' : pane === 'compliance' ? 'Compliance' : 'Decision'}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          disabled={isBusy}
          className="flex h-11 w-11 min-h-[44px] items-center justify-center rounded-xl text-muted-foreground/40 transition-all hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── 3-PANE BODY ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ══ PANE 1: EXCHANGE (left 40%) ══ */}
        <div
          className={cn(
            'flex-shrink-0 overflow-y-auto border-r border-border/30 bg-muted/10 px-6 py-6',
            'w-full lg:w-[40%]',
            'lg:block',
            activePane !== 'exchange' && 'hidden lg:block',
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
              Shift Exchange
            </h3>
            <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
          </div>

          <div className="space-y-6">
            {/* Party A */}
            <PartyRow
              label="Requester (Party A)"
              personLabel={partyALabel}
              shift={partyAShift}
              avatarColor="bg-indigo-600"
            />

            {/* Arrow divider */}
            <div className="flex items-center justify-center py-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>

            {/* Party B */}
            <PartyRow
              label="Offerer (Party B)"
              personLabel={partyBLabel}
              shift={partyBShift}
              avatarColor="bg-emerald-600"
            />

            {/* Request metadata */}
            <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">
                Request Details
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Type</span>
                <span className="text-[11px] font-bold text-foreground">
                  {request.type === 'SWAP' ? 'Shift Swap' : 'Shift Bid'}
                </span>
              </div>
              {request.reason && (
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Reason</span>
                  <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-foreground/80">
                    {request.reason}
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Status</span>
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Pending Approval
                </span>
              </div>
            </div>
          </div>

          {/* Next pane cue on desktop */}
          <div className="mt-4 hidden items-center justify-center lg:flex">
            <ChevronRight className="h-4 w-4 text-muted-foreground/20" />
          </div>
        </div>

        {/* ══ PANE 2: COMPLIANCE (center 40%) ══ */}
        <div
          className={cn(
            'flex-1 overflow-y-auto border-r border-border/30 px-6 py-6',
            'lg:block',
            activePane !== 'compliance' && 'hidden lg:block',
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
              Compliance Analysis
            </h3>
            <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
          </div>

          {snapshot &&
          (isSwapSnapshot(snapshot) || isBidSnapshot(snapshot)) ? (
            <ComplianceGate
              snapshot={snapshot}
              requestType={request.type}
              partyALabel={partyALabel}
              partyBLabel={partyBLabel}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/50 py-16 text-center">
              <Shield className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm font-semibold text-muted-foreground/50">
                No compliance snapshot
              </p>
              <p className="text-[11px] text-muted-foreground/30 max-w-xs">
                Compliance was not evaluated for this request.
              </p>
            </div>
          )}
        </div>

        {/* ══ PANE 3: DECISION (right 20%) ══ */}
        <div
          className={cn(
            'flex w-full flex-shrink-0 flex-col gap-4 overflow-y-auto bg-muted/10 px-6 py-6',
            'lg:w-[20%] lg:min-w-[220px]',
            'lg:block',
            activePane !== 'decision' && 'hidden lg:block',
          )}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50">
              Decision
            </h3>
            <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
          </div>

          {/* Staleness warning */}
          {stale && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Snapshot Stale
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-amber-700/80 dark:text-amber-300/80">
                  Compliance data is over 10 minutes old. Schedules may have
                  changed — verify before approving.
                </p>
              </div>
            </div>
          )}

          {/* Blocking warning */}
          {isBlocking && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
              <p className="text-[10px] font-black leading-relaxed text-rose-600 dark:text-rose-400">
                Blocking violations prevent approval. Resolve them first.
              </p>
            </div>
          )}

          {/* Notes textarea */}
          <div className="space-y-2">
            <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
              Manager Notes (optional)
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note for the employee…"
              rows={4}
              disabled={isBusy}
              className="resize-none rounded-xl border-border/50 bg-card text-[12px] placeholder:text-muted-foreground/30 focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {/* Approve */}
            <Button
              onClick={handleApprove}
              disabled={isBlocking || isBusy}
              className={cn(
                'min-h-[44px] w-full gap-2 rounded-xl text-[11px] font-black uppercase tracking-wider border-none',
                isBlocking || isBusy
                  ? 'cursor-not-allowed bg-muted text-muted-foreground/40'
                  : 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90',
              )}
            >
              {isApprovingLocal ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Approving…
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <Gavel className="h-3.5 w-3.5" />
                  Approve
                </>
              )}
            </Button>

            {/* Reject */}
            <Button
              onClick={handleReject}
              disabled={isBusy}
              className="min-h-[44px] w-full gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 text-[11px] font-black uppercase tracking-wider text-rose-600 hover:bg-rose-500/20 dark:text-rose-400"
            >
              {isRejectingLocal ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Rejecting…
                </>
              ) : (
                <>
                  <X className="h-3.5 w-3.5" />
                  Reject
                </>
              )}
            </Button>

            {/* Dismiss */}
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isBusy}
              className="min-h-[44px] w-full rounded-xl text-[10px] font-black uppercase tracking-wider text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
          </div>

          {/* Offer metadata */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-3 space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">
              Offer Info
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Status</span>
              <span className="rounded-full border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                {offer.status}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Submitted</span>
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {new Date(offer.created_at).toLocaleDateString('en-AU', {
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && !isBusy && onClose()}>
        <DrawerContent className="h-[92dvh] bg-card border-border p-0 overflow-hidden flex flex-col">
          <VisuallyHidden>
            <DrawerTitle>Approval Review</DrawerTitle>
            <DrawerDescription>Review details and compliance gates for planning request approval</DrawerDescription>
          </VisuallyHidden>
          {innerContent}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
      onClick={(e) => e.target === e.currentTarget && !isBusy && onClose()}
    >
      <div
        className="relative flex w-full max-w-5xl max-h-[92vh] flex-col rounded-[2rem] border border-border bg-card shadow-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {innerContent}
      </div>
    </div>
  );
}

export default ManagerApprovalModal;
