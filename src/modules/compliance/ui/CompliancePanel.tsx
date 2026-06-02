/**
 * CompliancePanel — Shared compliance UI component.
 *
 * Renders all 5 states driven by useCompliancePanel hook:
 *   idle    → "Run Compliance" CTA + rule list preview
 *   running → spinner
 *   results → A/B/C/D bucket sections + warning acknowledgment + Re-run
 *   stale   → results + amber "Inputs changed" banner + Re-run
 *   error   → error message + Retry
 *
 * NO auto-run logic here or in the hook. The user always clicks first.
 */

import React, { useState } from 'react';
import {
    Shield, AlertOctagon, AlertTriangle, CheckCircle2, XCircle,
    Play, Loader2, RefreshCw, Circle, ChevronDown, Info,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { V8_RULE_METADATA as RULE_METADATA } from '@/modules/compliance/v8/metadata';
import type { UseCompliancePanelReturn } from './useCompliancePanel';
import type { V8Hit } from '@/modules/compliance/v8/types';
import { type PassedRule, UI_VALIDATED_RULES } from './bucket-map';

// =============================================================================
// TYPES
// =============================================================================

export interface CompliancePanelProps {
    hook:        UseCompliancePanelReturn;
    className?:  string;
    /** For swaps: labels for the two parties in the 3-column view */
    partyAName?: string;
    partyBName?: string;
    disabled?: boolean;
}

// =============================================================================
// BUCKET CONFIG
// =============================================================================

const BUCKET_CONFIG = {
    A: {
        label:    'Blockers',
        sublabel: 'Must be resolved before proceeding',
        dotCls:   'bg-red-500',
        badgeCls: 'bg-red-500 text-white',
        borderCls:'border-red-500/20 bg-red-500/5',
        textCls:  'text-red-600 dark:text-red-400',
        icon:     (cls?: string) => <XCircle className={cn('h-3.5 w-3.5 text-red-500', cls)} />,
    },
    B: {
        label:    'Warnings',
        sublabel: 'Acknowledge to proceed',
        dotCls:   'bg-amber-500',
        badgeCls: 'bg-amber-500 text-white',
        borderCls:'border-amber-500/20 bg-amber-500/5',
        textCls:  'text-amber-600 dark:text-amber-400',
        icon:     (cls?: string) => <AlertTriangle className={cn('h-3.5 w-3.5 text-amber-500', cls)} />,
    },
    C: {
        label:    'Passed',
        sublabel: 'All clear',
        dotCls:   'bg-emerald-500',
        badgeCls: 'bg-emerald-500 text-white',
        borderCls:'border-emerald-500/20 bg-emerald-500/5',
        textCls:  'text-emerald-600 dark:text-emerald-400',
        icon:     (cls?: string) => <CheckCircle2 className={cn('h-3.5 w-3.5 text-emerald-500', cls)} />,
    },
    D: {
        label:    'System',
        sublabel: 'Role & qualification checks',
        dotCls:   'bg-blue-500',
        badgeCls: 'bg-blue-500 text-white',
        borderCls:'border-blue-500/20 bg-blue-500/5',
        textCls:  'text-blue-600 dark:text-blue-400',
        icon:     (cls?: string) => <Shield className={cn('h-3.5 w-3.5 text-blue-500', cls)} />,
    },
} as const;

// =============================================================================
// HELPERS
// =============================================================================

/** Display codes matching rule numbers — all active rules registered in the engine */
const DISPLAY_CODE: Record<string, string> = {
    'V8_NO_OVERLAP':            'R01',
    'V8_MIN_SHIFT_LENGTH':      'R02',
    'V8_MAX_DAILY_HOURS':       'R03',
    'V8_STUDENT_VISA_LIMIT':    'R05',
    'V8_ORD_HOURS_AVG':         'R06',
    'V8_MIN_REST_GAP':          'R07',
    'V8_MEAL_BREAK':            'R08',
    'V8_MAX_CONSECUTIVE_DAYS':  'R09',
    'V8_QUALIFICATIONS':        'R11',
    'V8_AVAILABILITY_CONFLICT': 'AV',
};


/** Extract sequential display code: R01_NO_OVERLAP → "R01", R_AVAILABILITY_MATCH → "AV" */
function getRuleCode(ruleId: string): string {
    if (!ruleId) return '';
    return DISPLAY_CODE[ruleId.toUpperCase()] ?? DISPLAY_CODE[ruleId] ?? ruleId.replace(/^R_/, '').slice(0, 2).toUpperCase();
}

/** Get the human-readable description from RULE_METADATA, falling back to formatted rule_id */
function getRuleDescription(ruleId: string): string {
    if (!ruleId) return '';
    const meta = RULE_METADATA[ruleId.toUpperCase()] ?? RULE_METADATA[ruleId];
    return meta?.description ?? ruleId.replace(/_/g, ' ');
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CompliancePanel({ 
    hook, 
    className,
    partyAName = 'Requester',
    partyBName = 'Offerer',
    disabled = false,
}: CompliancePanelProps) {
    const { status, result, error, warningsAcknowledged, canProceed, run, acknowledgeWarnings } = hook;
    const isSwap = !!result?.partyB;

    return (
        <div className={cn('space-y-4', className)}>
            {/* Stale banner */}
            {status === 'stale' && result && (
                <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="text-xs font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">Inputs Changed</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Re-run compliance to validate current inputs.</p>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => run()}
                        disabled={disabled}
                        className="h-7 px-2 text-[10px] font-black uppercase tracking-widest text-amber-600 hover:bg-amber-500/20"
                    >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Re-run
                    </Button>
                </div>
            )}

            {/* Header banner */}
            <HeaderBanner 
                status={status} 
                result={result} 
                canProceed={canProceed} 
                onRun={run} 
                disabled={disabled}
            />

            {/* Content by state */}
            {(status === 'idle') && <IdleRuleList />}
            {(status === 'running') && <RunningState />}
            {(status === 'error') && <ErrorState error={error} onRetry={run} disabled={disabled} />}
            {(status === 'results' || status === 'stale') && result && (
                <div className="space-y-6">
                    {/* Column Headers for Swap */}
                    {isSwap && (
                        <div className="grid grid-cols-[1fr,80px,80px] gap-4 px-4 pb-2 border-b border-border/30">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Rule Check</span>
                            <span className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500/60 truncate">{partyAName}</span>
                            <span className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500/60 truncate">{partyBName}</span>
                        </div>
                    )}
                    
                    <ResultBuckets
                        result={result}
                        warningsAcknowledged={warningsAcknowledged}
                        onAcknowledge={acknowledgeWarnings}
                        isStale={status === 'stale'}
                        isSwap={isSwap}
                        disabled={disabled}
                    />
                </div>
            )}
        </div>
    );
}

// =============================================================================
// HEADER BANNER
// =============================================================================

function HeaderBanner({
    status, result, canProceed, onRun, disabled,
}: {
    status: UseCompliancePanelReturn['status'];
    result: UseCompliancePanelReturn['result'];
    canProceed: boolean;
    onRun: () => void;
    disabled: boolean;
}) {
    const isRunning = status === 'running';
    const hasResults = status === 'results' || status === 'stale';
    const isStale = status === 'stale';
    const isIdle = status === 'idle';
    const isError = status === 'error';

    const blockers = result?.summary.blockers ?? 0;
    const warnings = result?.summary.warnings ?? 0;
    const passed   = result?.summary.passed   ?? 0;
    const systemFails = result?.summary.systemFails ?? 0;

    const hasBlockers = blockers > 0 || systemFails > 0;

    const bannerCls = cn(
        'relative overflow-hidden rounded-2xl border p-4 md:p-5 transition-all duration-300 shadow-sm',
        hasResults && canProceed && !isStale
            ? 'bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/80 border-emerald-500/20 dark:from-emerald-950/80 dark:via-emerald-950/40 dark:to-slate-900/80 dark:border-emerald-500/30'
            : hasResults && hasBlockers
                ? 'bg-gradient-to-br from-red-50/80 via-white to-red-50/80 border-red-500/20 dark:from-red-950/80 dark:via-red-950/40 dark:to-slate-900/80 dark:border-red-500/30'
                : hasResults && warnings > 0
                    ? 'bg-gradient-to-br from-amber-50/80 via-white to-amber-50/80 border-amber-500/20 dark:from-amber-950/80 dark:via-amber-950/40 dark:to-slate-900/80 dark:border-amber-500/30'
                    : 'bg-gradient-to-br from-background via-muted/20 to-background border-border dark:from-slate-900/90 dark:via-slate-800/50 dark:to-slate-900/90 dark:border-white/10',
    );

    return (
        <div className={bannerCls}>
            <div className="flex items-center justify-between gap-4">
                {/* Icon + title */}
                <div className="flex items-center gap-4">
                    <div className={cn(
                        'h-12 w-12 rounded-2xl flex items-center justify-center border transition-all duration-300 shrink-0',
                        hasResults && canProceed && !isStale
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                            : hasResults && hasBlockers
                                ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:bg-red-500/20 dark:text-red-400'
                                : hasResults && warnings > 0
                                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
                                    : 'bg-muted border-border text-muted-foreground dark:bg-slate-700/30 dark:border-white/10 dark:text-slate-400',
                    )}>
                        {isRunning
                            ? <Loader2 className="h-6 w-6 animate-spin" />
                            : hasResults && canProceed && !isStale
                                ? <Shield className="h-6 w-6" />
                                : hasResults && hasBlockers
                                    ? <AlertOctagon className="h-6 w-6" />
                                    : hasResults && warnings > 0
                                        ? <AlertTriangle className="h-6 w-6" />
                                        : <Circle className="h-6 w-6" />}
                    </div>
                    <div>
                        <h3 className={cn(
                            'text-base font-black tracking-tight uppercase',
                            hasResults && canProceed && !isStale ? 'text-emerald-700 dark:text-emerald-400'
                                : hasResults && hasBlockers       ? 'text-red-700 dark:text-rose-400'
                                : hasResults && warnings > 0      ? 'text-amber-700 dark:text-amber-400'
                                : 'text-foreground',
                        )}>
                            {isIdle    ? 'Compliance Check Required'
                             : isRunning? 'Validating...'
                             : isError  ? 'Check Failed'
                             : isStale  ? 'Results Stale'
                             : canProceed ? 'Compliance Passed'
                             : hasBlockers ? 'Compliance Failed'
                             : warnings > 0 ? 'Warnings Detected'
                             : 'All Checks Passed'}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                            {isIdle    ? 'Run compliance before proceeding'
                             : isRunning? 'Checking workforce rules...'
                             : isError  ? 'An error occurred during evaluation'
                             : isStale  ? 'Inputs changed — re-run to refresh'
                             : hasBlockers
                                ? `${blockers + systemFails} blocking issue${blockers + systemFails > 1 ? 's' : ''} prevent proceeding`
                             : warnings > 0
                                ? `${warnings} warning${warnings > 1 ? 's' : ''} — acknowledge to proceed`
                             : `${passed} rule${passed !== 1 ? 's' : ''} passed`}
                        </p>
                    </div>
                </div>

                {/* CTA button */}
                {!isRunning && (
                    <Button
                        type="button"
                        size="sm"
                        onClick={onRun}
                        disabled={disabled}
                        className={cn(
                            'h-9 px-5 font-black uppercase tracking-widest text-[10px] shadow-lg transition-all active:scale-95 shrink-0',
                            isIdle
                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                : canProceed && !isStale
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white',
                        )}
                    >
                        {isIdle
                            ? <><Play className="h-3.5 w-3.5 mr-1.5 fill-current" />Run Compliance</>
                            : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Re-run</>}
                    </Button>
                )}
            </div>

            {/* Stats pills */}
            {hasResults && (
                <div className="flex flex-wrap gap-2 mt-4">
                    {(blockers + systemFails) > 0 && (
                        <StatPill color="red"    label={`${blockers + systemFails} Blocking`} />
                    )}
                    {warnings > 0 && (
                        <StatPill color="amber"  label={`${warnings} Warning${warnings > 1 ? 's' : ''}`} />
                    )}
                    {passed > 0 && (
                        <StatPill color="emerald" label={`${passed} Passed`} />
                    )}
                </div>
            )}
        </div>
    );
}

function StatPill({ color, label }: { color: 'red' | 'amber' | 'emerald'; label: string }) {
    const cls = {
        red:     'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-300',
        amber:   'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-300',
        emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-300',
    }[color];
    return (
        <div className={cn('px-2.5 py-1 rounded-lg border flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest', cls)}>
            <div className={cn('h-1.5 w-1.5 rounded-full', `bg-${color}-500`)} />
            {label}
        </div>
    );
}

// =============================================================================
// IDLE STATE — preview rule list
// =============================================================================

function IdleRuleList() {
    const rules = Object.values(RULE_METADATA).filter(r => r.id && !UI_VALIDATED_RULES.has(r.id));
    return (
        <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 px-1">
                Rules that will be checked
            </p>
            <div className="space-y-1.5">
                {rules.map(rule => (
                    <div key={rule.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-colors">
                        <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-muted/80 border border-border/80 text-muted-foreground/60 shrink-0 min-w-[2.2rem] text-center shadow-sm">
                            {getRuleCode(rule.id)}
                        </span>
                        <span className="text-[11px] text-muted-foreground/50 font-medium truncate">{rule.description}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// =============================================================================
// RUNNING STATE
// =============================================================================

function RunningState() {
    return (
        <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            <span className="text-sm font-bold text-muted-foreground/60 uppercase tracking-wider">Checking compliance rules…</span>
        </div>
    );
}

// =============================================================================
// ERROR STATE
// =============================================================================

function ErrorState({ error, onRetry, disabled }: { error: string | null; onRetry: () => void; disabled: boolean }) {
    return (
        <div className="flex items-start gap-3 p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
            <AlertOctagon className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="text-sm font-bold text-red-700 dark:text-red-400">Compliance Check Failed</p>
                <p className="text-xs text-muted-foreground mt-1">{error ?? 'An unexpected error occurred.'}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={onRetry} disabled={disabled} className="text-red-600 hover:bg-red-500/10 text-[10px] font-black uppercase tracking-widest h-7 px-2">
                Retry
            </Button>
        </div>
    );
}

// =============================================================================
// RESULT BUCKETS
// =============================================================================

function ResultBuckets({
    result, warningsAcknowledged, onAcknowledge, isStale, isSwap, disabled,
}: {
    result: NonNullable<UseCompliancePanelReturn['result']>;
    warningsAcknowledged: boolean;
    onAcknowledge: (v: boolean) => void;
    isStale: boolean;
    isSwap: boolean;
    disabled: boolean;
}) {
    const { buckets } = result;
    const [passedExpanded, setPassedExpanded] = useState(false);

    // Rules are already filtered by classifyBuckets() via bucket-map.ts
    const hitsA = buckets.A;
    const hitsB = buckets.B;
    const hitsC = buckets.C;
    const hitsD = buckets.D;

    return (
        <div className="space-y-3">
            {/* Bucket A — Blockers */}
            {hitsA.length > 0 && (
                <BucketSection bucket="A" hits={hitsA} isSwap={isSwap} result={result} />
            )}

            {/* Bucket D — System/Quals */}
            {hitsD.length > 0 && (
                <BucketSection bucket="D" hits={hitsD} isSwap={isSwap} result={result} />
            )}

            {/* Bucket B — Warnings */}
            {hitsB.length > 0 && (
                <>{/* ... */}
                    <BucketSection bucket="B" hits={hitsB} isSwap={isSwap} result={result} />
                    {/* Warning acknowledgment */}
                    {!isStale && (
                        <label className={cn(
                            'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors',
                            warningsAcknowledged
                                ? 'border-amber-500/30 bg-amber-500/10'
                                : 'border-border bg-muted/30 hover:bg-muted/50',
                        )}>
                             <input
                                type="checkbox"
                                checked={warningsAcknowledged}
                                onChange={e => onAcknowledge(e.target.checked)}
                                disabled={disabled}
                                className="h-4 w-4 rounded border-border accent-amber-500 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <div>
                                <p className="text-xs font-black uppercase tracking-widest text-foreground">Acknowledge Warnings</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    I understand the warnings and wish to proceed
                                </p>
                            </div>
                        </label>
                    )}
                </>
            )}

            {/* Bucket C — Passed (collapsible) */}
            {hitsC.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setPassedExpanded(v => !v)}
                        className="w-full flex items-center gap-2 px-1 py-1 group"
                    >
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors flex items-center gap-1.5">
                            <span className="font-mono px-1 py-px rounded bg-emerald-500/10 text-emerald-600/60 dark:text-emerald-400/60 text-[8px]">C</span>
                            {hitsC.length} Passed
                        </span>
                        <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
                        <ChevronDown className={cn(
                            'h-3.5 w-3.5 text-muted-foreground/30 transition-transform duration-200',
                            passedExpanded && 'rotate-180',
                        )} />
                    </button>
                    {passedExpanded && (
                        <div className="mt-2 space-y-1.5">
                            {hitsC.map(rule => (
                                <div key={rule.rule_id} className={cn(
                                    "rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.08]",
                                    isSwap ? "grid grid-cols-[1fr,80px,80px] gap-4 items-center px-4 py-3" : "flex items-center gap-3 px-3 py-2.5"
                                )}>
                                    <div className="flex items-center gap-3 min-w-0">
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                        <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 shrink-0 min-w-[2.2rem] text-center">
                                            {getRuleCode(rule.rule_id)}
                                        </span>
                                        <p className="text-[11px] text-foreground/70 dark:text-muted-foreground font-medium truncate">{rule.description}</p>
                                    </div>
                                    {isSwap ? (
                                        <>
                                            <span className="text-center text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">PASS</span>
                                            <span className="text-center text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">PASS</span>
                                        </>
                                    ) : (
                                        <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 shrink-0">PASS</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// BUCKET SECTION — renders A, B, or D hits
// =============================================================================

function BucketSection({ 
    bucket, hits, isSwap, result 
}: { 
    bucket: 'A' | 'B' | 'D'; 
    hits: V8Hit[]; 
    isSwap: boolean;
    result: NonNullable<UseCompliancePanelReturn['result']>;
}) {
    const cfg = BUCKET_CONFIG[bucket];

    return (
        <div className={cn('rounded-2xl border overflow-hidden', cfg.borderCls)}>
            {/* Bucket header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.05]">
                <span className={cn('text-[8px] font-black px-1.5 py-0.5 rounded', cfg.badgeCls)}>{bucket}</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex-1">
                    {cfg.label}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground/40">{hits.length}</span>
                {cfg.icon()}
            </div>

            {/* Hit rows */}
            <div className="px-3 py-2.5 space-y-1.5">
                {hits.map((hit, i) => (
                    <HitRow 
                        key={`${hit.rule_id}-${i}`} 
                        hit={hit} 
                        bucket={bucket} 
                        isSwap={isSwap} 
                        result={result} 
                    />
                ))}
            </div>
        </div>
    );
}

function HitRow({ 
    hit, bucket, isSwap, result 
}: { 
    hit: V8Hit; 
    bucket: 'A' | 'B' | 'D'; 
    isSwap: boolean;
    result: NonNullable<UseCompliancePanelReturn['result']>;
}) {
    const cfg = BUCKET_CONFIG[bucket];
    const [expanded, setExpanded] = useState(bucket === 'A');
    const code = getRuleCode(hit.rule_id);
    const description = getRuleDescription(hit.rule_id);

    // Swap status logic
    let statusA: 'PASS' | 'FAIL' | 'WARN' = 'PASS';
    let statusB: 'PASS' | 'FAIL' | 'WARN' = 'PASS';

    if (isSwap) {
        const hitA = result.rawResult.hits?.find(h => h.rule_id === hit.rule_id);
        const hitB = result.partyB?.rawResult.hits?.find(h => h.rule_id === hit.rule_id);

        if (hitA) statusA = hitA.status === 'BLOCKING' ? 'FAIL' : 'WARN';
        if (hitB) statusB = hitB.status === 'BLOCKING' ? 'FAIL' : 'WARN';
    } else {
        statusA = hit.status === 'BLOCKING' ? 'FAIL' : 'WARN';
    }

    return (
        <div className="space-y-1">
            <div className={cn(
                "w-full text-left",
                isSwap ? "grid grid-cols-[1fr,80px,80px] gap-4 items-start" : "flex items-start gap-2"
            )}>
                <button
                    type="button"
                    className="flex items-start gap-2 text-left min-w-0"
                    onClick={() => setExpanded(v => !v)}
                >
                    {cfg.icon('mt-0.5 shrink-0')}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className={cn(
                                'text-[9px] font-black font-mono px-1 py-0.5 rounded shrink-0',
                                cfg.badgeCls,
                            )}>{code}</span>
                            <p className={cn('text-[11px] font-bold leading-tight truncate', cfg.textCls)}>
                                {description}
                            </p>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 leading-snug mt-0.5 max-w-[90%]">
                            {hit.summary}
                        </p>
                    </div>
                    <ChevronDown className={cn(
                        'h-3.5 w-3.5 text-muted-foreground/30 shrink-0 mt-0.5 transition-transform duration-200',
                        expanded && 'rotate-180',
                    )} />
                </button>

                {isSwap ? (
                    <>
                        <div className="flex justify-center pt-1">
                            <StatusBadge status={statusA} />
                        </div>
                        <div className="flex justify-center pt-1">
                            <StatusBadge status={statusB} />
                        </div>
                    </>
                ) : null}
            </div>

            {expanded && hit.details && (
                <div className={cn(
                    "flex items-start gap-2 p-2.5 bg-muted/40 rounded-lg border border-border/50",
                    isSwap ? "mr-[176px]" : "ml-5" // match the button width if swap
                )}>
                    <Info className="h-3 w-3 text-muted-foreground/40 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{hit.details}</p>
                </div>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: 'PASS' | 'FAIL' | 'WARN' }) {
    const cls = {
        PASS: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
        FAIL: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
        WARN: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    }[status];

    return (
        <span className={cn('px-1.5 py-0.5 rounded text-[8px] font-black tracking-tighter border uppercase', cls)}>
            {status}
        </span>
    );
}

export default CompliancePanel;
