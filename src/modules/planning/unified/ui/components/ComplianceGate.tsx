/**
 * ComplianceGate
 *
 * Displays a compliance result snapshot for either a BID or SWAP request.
 *
 * BID  → single-column rule hit list
 * SWAP → two-column party layout (Party A | Party B) with shared rule hits
 *
 * Blocking hits are highlighted with a red border. Student visa enforcement
 * is called out with a dedicated flag pill. The overall PASS / WARNING /
 * BLOCKING verdict is shown as a banner at the top.
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type {
  BidComplianceSnapshot,
  SwapComplianceSnapshot,
  PlanningRequestType,
} from '@/modules/planning/unified/types';
import {
  isSwapSnapshot,
  isBidSnapshot,
  isStudentVisaEnforced,
} from '@/modules/planning/unified/types';
import type { V8Hit, V8Status } from '@/modules/compliance/v8/types';
import type { V8OrchestratorResult } from '@/modules/compliance/v8/orchestrator/types';

// =============================================================================
// TYPES
// =============================================================================

interface ComplianceGateProps {
  snapshot: BidComplianceSnapshot | SwapComplianceSnapshot;
  requestType: PlanningRequestType;
  partyALabel?: string;
  partyBLabel?: string;
  compact?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatV8Status(status: V8Status): {
  label: string;
  icon: React.ElementType;
  containerCls: string;
  textCls: string;
  iconCls: string;
} {
  switch (status) {
    case 'PASS':
      return {
        label: 'Compliance Passed',
        icon: CheckCircle2,
        containerCls: 'bg-emerald-500/10 border-emerald-500/20',
        textCls: 'text-emerald-700 dark:text-emerald-400',
        iconCls: 'text-emerald-500',
      };
    case 'WARNING':
      return {
        label: 'Compliance Warning',
        icon: AlertTriangle,
        containerCls: 'bg-amber-500/10 border-amber-500/20',
        textCls: 'text-amber-700 dark:text-amber-400',
        iconCls: 'text-amber-500',
      };
    case 'BLOCKING':
      return {
        label: 'Compliance Blocked',
        icon: XCircle,
        containerCls: 'bg-rose-500/10 border-rose-500/20',
        textCls: 'text-rose-700 dark:text-rose-400',
        iconCls: 'text-rose-500',
      };
  }
}

function severityBadgeCls(severity: 'BLOCKING' | 'WARNING'): string {
  return severity === 'BLOCKING'
    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
}

// =============================================================================
// RULE HIT ROW
// =============================================================================

interface RuleHitRowProps {
  hit: V8Hit;
  isBlocking: boolean;
  compact: boolean;
}

function RuleHitRow({ hit, isBlocking, compact }: RuleHitRowProps) {
  const [expanded, setExpanded] = useState(!compact && isBlocking);

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200',
        isBlocking
          ? 'border-rose-500/25 bg-rose-500/5'
          : 'border-amber-500/20 bg-amber-500/5',
      )}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        {/* V8Severity icon */}
        {isBlocking ? (
          <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
        )}

        <div className="min-w-0 flex-1">
          {/* Rule ID chip + message */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider',
                severityBadgeCls(hit.status as 'WARNING' | 'BLOCKING'),
              )}
            >
              {hit.rule_id}
            </span>
            <span
              className={cn(
                'text-[11px] font-semibold',
                isBlocking
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-amber-700 dark:text-amber-300',
              )}
            >
              {hit.summary}
            </span>
          </div>
        </div>

        {/* Expand toggle */}
        <span className="mt-0.5 flex-shrink-0 text-muted-foreground/40">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* Resolution hint */}
      {expanded && hit.details && (
        <div className="border-t border-border/30 px-3 pb-3 pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-black uppercase tracking-wider text-muted-foreground/60">
              Resolution:{' '}
            </span>
            {hit.details}
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PARTY COLUMN
// =============================================================================

interface PartyColumnProps {
  label: string;
  result: V8OrchestratorResult;
  compact: boolean;
}

function PartyColumn({ label, result, compact }: PartyColumnProps) {
  const blockingHits = result.hits.filter((h) => h.status === 'BLOCKING');
  const warningHits = result.hits.filter((h) => h.status === 'WARNING');
  const hasHits = result.hits.length > 0;

  const overallCls =
    result.overall_status === 'PASS'
      ? 'border-emerald-500/20 bg-emerald-500/5'
      : result.overall_status === 'BLOCKING'
      ? 'border-rose-500/20 bg-rose-500/5'
      : 'border-amber-500/20 bg-amber-500/5';

  const statusIconCls =
    result.overall_status === 'PASS'
      ? 'text-emerald-500'
      : result.overall_status === 'BLOCKING'
      ? 'text-rose-500'
      : 'text-amber-500';

  return (
    <div className="flex flex-col gap-2">
      {/* Party header */}
      <div
        className={cn(
          'flex items-center justify-between rounded-xl border px-3 py-2',
          overallCls,
        )}
      >
        <span className="text-[10px] font-black uppercase tracking-widest text-foreground/70">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {result.overall_status === 'PASS' ? (
            <CheckCircle2 className={cn('h-4 w-4', statusIconCls)} />
          ) : result.overall_status === 'BLOCKING' ? (
            <XCircle className={cn('h-4 w-4', statusIconCls)} />
          ) : (
            <AlertTriangle className={cn('h-4 w-4', statusIconCls)} />
          )}
          <span
            className={cn(
              'text-[9px] font-black uppercase tracking-widest',
              statusIconCls,
            )}
          >
            {result.overall_status}
          </span>
        </div>
      </div>

      {/* Hit list */}
      {hasHits ? (
        <div className="space-y-1.5">
          {blockingHits.map((hit, i) => (
            <RuleHitRow key={`${hit.rule_id}-${i}`} hit={hit} isBlocking compact={compact} />
          ))}
          {warningHits.map((hit, i) => (
            <RuleHitRow key={`${hit.rule_id}-${i}`} hit={hit} isBlocking={false} compact={compact} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            All rules passed
          </span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ComplianceGate({
  snapshot,
  requestType,
  partyALabel = 'Party A',
  partyBLabel = 'Party B',
  compact = false,
}: ComplianceGateProps) {
  // Resolve overall status and per-party data
  const overallStatus: V8Status = isSwapSnapshot(snapshot)
    ? snapshot.combined_status
    : snapshot.overall_status;

  const statusDisplay = formatV8Status(overallStatus);
  const StatusIcon = statusDisplay.icon;

  // Determine if student visa enforcement is flagged
  const studentVisa = isSwapSnapshot(snapshot)
    ? isStudentVisaEnforced(snapshot.party_a, snapshot.party_b)
    : isStudentVisaEnforced(snapshot as V8OrchestratorResult);

  // Count blocking hits across all parties
  const allBlockingHits: V8Hit[] = isSwapSnapshot(snapshot)
    ? [
        ...snapshot.party_a.hits.filter((h) => h.status === 'BLOCKING'),
        ...snapshot.party_b.hits.filter((h) => h.status === 'BLOCKING'),
      ]
    : (snapshot as V8OrchestratorResult).hits.filter(
        (h) => h.status === 'BLOCKING',
      );

  const allWarningHits: V8Hit[] = isSwapSnapshot(snapshot)
    ? [
        ...snapshot.party_a.hits.filter((h) => h.status === 'WARNING'),
        ...snapshot.party_b.hits.filter((h) => h.status === 'WARNING'),
      ]
    : (snapshot as V8OrchestratorResult).hits.filter(
        (h) => h.status === 'WARNING',
      );

  return (
    <div className="space-y-3">
      {/* ── Overall verdict banner ── */}
      <div
        className={cn(
          'flex items-start gap-3 rounded-2xl border p-4',
          statusDisplay.containerCls,
        )}
      >
        <StatusIcon
          className={cn('mt-0.5 h-5 w-5 flex-shrink-0', statusDisplay.iconCls)}
        />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[13px] font-black tracking-tight',
              statusDisplay.textCls,
            )}
          >
            {statusDisplay.label}
          </p>
          {!compact && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {allBlockingHits.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  <span className="h-1 w-1 rounded-full bg-rose-500" />
                  {allBlockingHits.length} blocking
                </span>
              )}
              {allWarningHits.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  {allWarningHits.length} warning{allWarningHits.length > 1 ? 's' : ''}
                </span>
              )}
              {overallStatus === 'PASS' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <span className="h-1 w-1 rounded-full bg-emerald-500" />
                  All rules passed
                </span>
              )}
            </div>
          )}
        </div>

        {/* Student visa enforcement flag */}
        {studentVisa && (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <Zap className="h-3 w-3" />
            Student Visa
          </span>
        )}

        {/* Shield icon for PASS */}
        {overallStatus === 'PASS' && !compact && (
          <Shield className="h-5 w-5 flex-shrink-0 text-emerald-400/40" />
        )}
      </div>

      {/* ── Rule hits ── */}
      {!compact && (
        <>
          {/* SWAP: two-column party layout */}
          {requestType === 'SWAP' && isSwapSnapshot(snapshot) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PartyColumn
                label={partyALabel}
                result={snapshot.party_a}
                compact={compact}
              />
              <PartyColumn
                label={partyBLabel}
                result={snapshot.party_b}
                compact={compact}
              />
            </div>
          )}

          {/* BID: single-column */}
          {requestType === 'BID' && isBidSnapshot(snapshot) && (
            <div className="space-y-1.5">
              {snapshot.hits.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    All compliance rules passed
                  </span>
                </div>
              ) : (
                snapshot.hits.map((hit, i) => (
                  <RuleHitRow
                    key={`${hit.rule_id}-${i}`}
                    hit={hit}
                    isBlocking={hit.status === 'BLOCKING'}
                    compact={compact}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Compact mode: show only count summary */}
      {compact && (allBlockingHits.length > 0 || allWarningHits.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {allBlockingHits.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
              {allBlockingHits.length} blocking
            </span>
          )}
          {allWarningHits.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {allWarningHits.length} warning{allWarningHits.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default ComplianceGate;
