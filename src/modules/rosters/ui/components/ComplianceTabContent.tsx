/**
 * Compliance Tab Content Component
 *
 * Renders all 10 compliance rule cards (7 client-side + 3 server-side).
 * Includes toggles for:
 *   - Student Visa enforcement (Rule 8): warning → blocking
 *   - Rest Gap relaxed mode (Rule 10): 10h default → 8h relaxed
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Circle,
    Play,
    ChevronDown,
    Loader2,
    Clock,
    Calendar,
    Moon,
    Zap,
    AlertOctagon,
    Shield,
    Layers,
    Server,
    FileCheck,
    BadgeCheck,
    Timer
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import {
    getRegisteredRules,
    runRule,
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult,
    ComplianceRule
} from '@/modules/compliance';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';
import { format, parseISO } from 'date-fns';

function calcNetMinutes(s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

// =============================================================================
// TYPES
// =============================================================================

interface ComplianceTabContentProps {
    hardValidation: HardValidationResult;
    buildComplianceInput: () => ComplianceCheckInput;
    ruleResults: Record<string, ComplianceResult | null>;
    /** Granular callback — parent merges result into its own state. */
    onRuleResult: (ruleId: string, result: ComplianceResult | null) => void;
    needsRerun?: boolean;
    onChecksComplete?: () => void;
    /** The shift ID (UUID) — required for server-side qualification compliance check */
    shiftId?: string;
    /** Optional override for the "Run All" action (e.g. for bulk or specialized modals) */
    onRunAll?: () => Promise<void>;
}

type RuleStatus = 'pass' | 'fail' | 'warning' | 'not-run';

// Server-only rule definitions (Rules 1–3 — backed by validateCompliance RPC)
const SERVER_RULES = [
    {
        id: 'ROLE_CONTRACT_MATCH',
        name: 'Position Contract Match',
        description: "Employee must have a contract matching the org/dept/subdept/role hierarchy of this shift.",
        icon: <FileCheck className="h-5 w-5" />
    },
    {
        id: 'QUALIFICATION_MATCH',
        name: 'Qualification Match',
        description: 'Employee must hold all required active skills and licences for this shift.',
        icon: <BadgeCheck className="h-5 w-5" />
    }
] as const;

type Bucket = 'Eligibility' | 'Legal' | 'Workload';

const RULE_BUCKETS: Record<string, Bucket> = {
    // Bucket A: Eligibility
    ROLE_CONTRACT_MATCH: 'Eligibility',
    QUALIFICATION_MATCH: 'Eligibility',

    // Bucket B: Legal
    STUDENT_VISA_48H: 'Legal',

    // Bucket D: Workload
    NO_OVERLAP: 'Workload',
    MAX_DAILY_HOURS: 'Workload',
    WORKING_DAYS_CAP: 'Workload',
    AVG_FOUR_WEEK_CYCLE: 'Workload',
    MIN_REST_GAP: 'Workload',
};

const BUCKET_ORDER: Bucket[] = ['Eligibility', 'Legal', 'Workload'];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ComplianceTabContent({
    hardValidation,
    buildComplianceInput,
    ruleResults,
    onRuleResult,
    needsRerun = false,
    onChecksComplete,
    shiftId,
    onRunAll: onRunAllOverride
}: ComplianceTabContentProps) {
    const [isRunningAll, setIsRunningAll] = useState(false);
    const [restGapRelaxed, setRestGapRelaxed] = useState(false);
    const [staleRules, setStaleRules] = useState<Set<string>>(new Set());
    const rules = getRegisteredRules();

    // Student visa enforcement is DB-driven (set on Users page > Work Rights)
    const studentVisaEnforced = useMemo(
        () => buildComplianceInput().student_visa_enforcement ?? false,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [buildComplianceInput]
    );

    // Merge rest gap toggle into the compliance input (student_visa_enforcement comes from DB)
    const buildInput = useCallback((): ComplianceCheckInput => ({
        ...buildComplianceInput(),
        rest_gap_hours: restGapRelaxed ? 8 : 10
    }), [buildComplianceInput, restGapRelaxed]);

    // Summary stats across all results (client + server)
    const summaryStats = useMemo(() => {
        const results = Object.values(ruleResults).filter(Boolean) as ComplianceResult[];
        const hardPassed = hardValidation.passed;
        const blockingFails = results.filter(r => r.status === 'fail' && r.blocking).length + (hardPassed ? 0 : 1);
        const warnings = results.filter(r => (r.status === 'warning') || (r.status === 'fail' && !r.blocking)).length;
        const passed = results.filter(r => r.status === 'pass').length + (results.length > 0 && hardPassed ? 1 : 0);
        const notRun = rules.filter(r => !ruleResults[r.id]).length
            + SERVER_RULES.filter(r => !ruleResults[r.id]).length;
        return { blockingFails, warnings, passed, notRun };
    }, [ruleResults, hardValidation, rules]);

    const canProceed = hardValidation.passed &&
        Object.keys(ruleResults).length > 0 &&
        !Object.values(ruleResults).some(r => r?.status === 'fail' && r?.blocking);

    const handleRunRule = useCallback(async (ruleId: string) => {
        const input = buildInput();
        const result = await runRule(ruleId, input);
        onRuleResult(ruleId, result as any);
        setStaleRules(prev => { const next = new Set(prev); next.delete(ruleId); return next; });
    }, [buildInput, onRuleResult]);

    const handleRunAll = useCallback(async () => {
        if (onRunAllOverride) {
            await onRunAllOverride();
            return;
        }
        setIsRunningAll(true);
        await new Promise(resolve => setTimeout(resolve, 300));
        try {
            const input = buildInput();
            const newResults: Record<string, ComplianceResult | null> = {};

            // Client-side rules (fast, local data)
            for (const rule of rules) {
                newResults[rule.id] = (await runRule(rule.id, input)) as any;
            }

            // Server-side checks (Rules 1–3 + authoritative overlap)
            if (input.employee_id && input.employee_id !== 'preview') {
                try {
                    const serverResult = await validateCompliance({
                        employeeId: input.employee_id,
                        shiftDate: input.candidate_shift.shift_date,
                        startTime: input.candidate_shift.start_time,
                        endTime: input.candidate_shift.end_time,
                        netLengthMinutes: calcNetMinutes(input.candidate_shift),
                        excludeV8ShiftId: input.exclude_shift_id,
                        shiftId
                    });

                    // Authoritative overlap overrides client result
                    if (serverResult.checksPerformed.includes('overlap')) {
                        const hasOverlap = serverResult.violations.some(v => v.toLowerCase().includes('overlap'));
                        const clientCalc = newResults['NO_OVERLAP']?.calculation;
                        newResults['NO_OVERLAP'] = {
                            rule_id: 'NO_OVERLAP',
                            rule_name: 'No Overlapping Shifts',
                            status: hasOverlap ? 'fail' : 'pass',
                            summary: hasOverlap
                                ? 'Employee already has a shift at this time'
                                : 'No overlapping shifts found',
                            details: hasOverlap
                                ? (serverResult.violations.find(v => v.toLowerCase().includes('overlap')) ?? 'Shift overlap detected')
                                : 'No overlapping shifts found.',
                            calculation: hasOverlap
                                ? (clientCalc ?? {
                                    existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0,
                                    existing_start_time: '',
                                    existing_end_time: '',
                                    candidate_start_time: input.candidate_shift.start_time,
                                    candidate_end_time: input.candidate_shift.end_time,
                                })
                                : { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                            blocking: true
                        };
                    }

                    // Rules 1–3: split qualification violations by type
                    if (serverResult.checksPerformed.includes('qualification')) {
                        const allViolations = serverResult.qualificationViolations || [];

                        const roleViolations = allViolations.filter(v => v.type === 'ROLE_MISMATCH');
                        const missingViolations = allViolations.filter(v =>
                            v.type === 'LICENSE_MISSING' || v.type === 'SKILL_MISSING');
                        const expiredViolations = allViolations.filter(v =>
                            v.type === 'LICENSE_EXPIRED' || v.type === 'SKILL_EXPIRED');

                        newResults['ROLE_CONTRACT_MATCH'] = {
                            rule_id: 'ROLE_CONTRACT_MATCH',
                            rule_name: 'Position Contract Match',
                            status: roleViolations.length > 0 ? 'fail' : 'pass',
                            summary: roleViolations.length > 0
                                ? `Role mismatch: no contract found for this org/dept/role`
                                : 'Employee has a matching role contract',
                            details: roleViolations.length > 0
                                ? roleViolations.map(v => v.message).join('\n')
                                : 'Role and contract hierarchy verified for this shift.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0, violations: roleViolations },
                            blocking: true
                        };

                        newResults['QUALIFICATION_MATCH'] = {
                            rule_id: 'QUALIFICATION_MATCH',
                            rule_name: 'Qualification Match',
                            status: missingViolations.length > 0 ? 'fail' : 'pass',
                            summary: missingViolations.length > 0
                                ? `${missingViolations.length} missing qualification(s)`
                                : 'All required qualifications present',
                            details: missingViolations.length > 0
                                ? missingViolations.map(v => v.message).join('\n')
                                : 'All required skills, certifications, and licences confirmed.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0, violations: missingViolations },
                            blocking: true
                        };
                    }
                } catch {
                    // Server unavailable — client results stand as best-effort
                }
            }

            Object.entries(newResults).forEach(([id, res]) => onRuleResult(id, res));
            setStaleRules(new Set());
            onChecksComplete?.();
        } finally {
            setIsRunningAll(false);
        }
    }, [buildInput, rules, onRuleResult, onChecksComplete, shiftId]);

    // Rest Gap toggle — marks result as stale instead of clearing, so card stays expanded
    const handleRestGapToggle = (relaxed: boolean) => {
        setRestGapRelaxed(relaxed);
        setStaleRules(prev => new Set([...prev, 'MIN_REST_GAP']));
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {needsRerun && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-4 backdrop-blur-md">
                    <div className="p-2 bg-amber-500/20 rounded-lg">
                        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-amber-700 dark:text-amber-500">Inputs Changed</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                            Shift details have been modified. Re-run compliance checks to ensure validity.
                        </p>
                    </div>
                </div>
            )}

            {/* Header Banner */}
            <div className={cn(
                "relative overflow-hidden rounded-2xl border p-6 transition-all duration-500 shadow-xl",
                canProceed
                    ? "bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/80 border-emerald-500/20 dark:from-emerald-950/80 dark:via-emerald-950/40 dark:to-slate-900/80 dark:border-emerald-500/30"
                    : summaryStats.blockingFails > 0
                        ? "bg-gradient-to-br from-red-50/80 via-white to-red-50/80 border-red-500/20 dark:from-red-950/80 dark:via-red-950/40 dark:to-slate-900/80 dark:border-red-500/30"
                        : "bg-gradient-to-br from-background via-muted/20 to-background border-border dark:from-slate-900/90 dark:via-slate-800/50 dark:to-slate-900/90 dark:border-white/10"
            )}>
                <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay dark:opacity-[0.05]" />
                <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <div className={cn(
                            "h-14 w-14 rounded-2xl flex items-center justify-center shadow-lg border transition-all duration-300",
                            canProceed
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                                : summaryStats.blockingFails > 0
                                    ? "bg-red-500/10 border-red-500/20 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                                    : "bg-muted border-border text-muted-foreground dark:bg-slate-700/30 dark:border-white/10 dark:text-slate-400"
                        )}>
                            {canProceed
                                ? <Shield className="h-7 w-7" />
                                : summaryStats.blockingFails > 0
                                    ? <AlertOctagon className="h-7 w-7" />
                                    : <Circle className="h-7 w-7" />}
                        </div>
                        <div>
                            <h3 className={cn(
                                "text-xl font-black tracking-tight uppercase",
                                canProceed ? "text-emerald-700 dark:text-emerald-400"
                                    : summaryStats.blockingFails > 0 ? "text-red-700 dark:text-red-400"
                                        : "text-foreground"
                            )}>
                                {canProceed ? "Compliance Passed"
                                    : summaryStats.blockingFails > 0 ? "Compliance Failed"
                                        : "Validation Required"}
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1 font-medium">
                                {summaryStats.blockingFails > 0
                                    ? `${summaryStats.blockingFails} blocking issue${summaryStats.blockingFails > 1 ? 's' : ''} prevents saving`
                                    : summaryStats.notRun > 0
                                        ? "Run compliance checks to validate this shift"
                                        : "All checks passed successfully"}
                            </p>
                        </div>
                    </div>

                    <Button
                        type="button"
                        size="sm"
                        onClick={handleRunAll}
                        disabled={isRunningAll}
                        className={cn(
                            "h-10 px-6 font-black uppercase tracking-widest shadow-lg transition-all active:scale-95",
                            canProceed
                                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                                : "bg-indigo-600 hover:bg-indigo-500 text-white"
                        )}
                    >
                        {isRunningAll ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Validating...</>
                        ) : (
                            <><Play className="h-4 w-4 mr-2 fill-current" />{summaryStats.notRun === 0 ? "Re-Run Checks" : "Run Checks"}</>
                        )}
                    </Button>
                </div>

                {/* Stats pills */}
                <div className="relative mt-6 flex gap-3 flex-wrap">
                    {summaryStats.blockingFails > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-300">
                            <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                            {summaryStats.blockingFails} Blocking
                        </div>
                    )}
                    {summaryStats.warnings > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-300">
                            <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            {summaryStats.warnings} Warning{summaryStats.warnings > 1 ? 's' : ''}
                        </div>
                    )}
                    {summaryStats.passed > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {summaryStats.passed} Passed
                        </div>
                    )}
                    {summaryStats.notRun > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-muted border border-border flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                            {summaryStats.notRun} Pending
                        </div>
                    )}
                </div>
            </div>

            {/* Rule Buckets */}
            {BUCKET_ORDER.map(bucket => {
                const bucketRules = rules.filter(r => RULE_BUCKETS[r.id] === bucket);
                const bucketServerRules = SERVER_RULES.filter(r => RULE_BUCKETS[r.id] === bucket);

                if (bucketRules.length === 0 && bucketServerRules.length === 0) return null;

                return (
                    <div key={bucket} className="space-y-4">
                        <div className="flex items-center gap-3 px-1">
                            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
                                {bucket}
                            </h4>
                            <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
                        </div>
                        
                        <div className="space-y-3">
                            {/* Server-side Rules first within bucket */}
                            {bucketServerRules.map(serverRule => (
                                <ServerRuleCard
                                    key={serverRule.id}
                                    ruleId={serverRule.id}
                                    ruleName={serverRule.name}
                                    ruleDescription={serverRule.description}
                                    ruleIcon={serverRule.icon}
                                    result={ruleResults[serverRule.id]}
                                    onRunAll={handleRunAll}
                                    isRunningAll={isRunningAll}
                                />
                            ))}

                            {/* Client-side Rules */}
                            {(bucketRules as any[]).map((rule: ComplianceRule) => (
                                <ComplianceRuleCard
                                    key={rule.id}
                                    rule={rule}
                                    result={ruleResults[rule.id]}
                                    onRun={() => handleRunRule(rule.id)}
                                    isStale={staleRules.has(rule.id)}
                                    toggle={
                                        rule.id === 'STUDENT_VISA_48H'
                                            ? {
                                                label: studentVisaEnforced ? 'Enforcement ON' : 'Enforcement OFF',
                                                description: 'Configured on Users page › Work Rights (Subclass 500)',
                                                enabled: studentVisaEnforced,
                                                readOnly: true,
                                            }
                                            : rule.id === 'MIN_REST_GAP'
                                                ? {
                                                    label: 'Relaxed mode (8h)',
                                                    description: 'Allow 8h rest gap instead of the default 10h',
                                                    enabled: restGapRelaxed,
                                                    onChange: handleRestGapToggle
                                                }
                                                : undefined
                                    }
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// =============================================================================
// HARD VALIDATION CARD
// =============================================================================

function HardValidationCard({ result }: { result: HardValidationResult }) {
    const [expanded, setExpanded] = useState(!result.passed);
    return (
        <div className="rounded-xl overflow-hidden border border-red-500/30 bg-red-500/5 dark:bg-red-950/20 shadow-lg transition-all duration-300">
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-red-500/5 dark:hover:bg-white/5 transition-colors" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center text-red-600 dark:text-red-400 border border-red-500/20">
                        <XCircle className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="font-black text-red-900 dark:text-white flex items-center gap-2 tracking-tight uppercase text-sm">
                            Scheduling Conflict
                            <span className="text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest bg-red-600 text-white border border-red-600 shadow-sm">
                                BLOCKING
                            </span>
                        </div>
                        <div className="text-xs text-red-700/70 dark:text-red-200/60 mt-0.5 font-medium">Critical scheduling error detected</div>
                    </div>
                </div>
                <ChevronDown className={cn("h-5 w-5 text-red-900/30 dark:text-white/40 transition-transform duration-300", expanded && "rotate-180")} />
            </div>
            {expanded && (
                <div className="border-t border-red-500/20 bg-white/50 dark:bg-red-950/30 p-5 space-y-4">
                    {result.errors.map((err, idx) => (
                        <div key={idx} className="p-4 bg-red-500/5 dark:bg-red-500/10 rounded-xl border border-red-500/10 text-sm text-red-800 dark:text-red-200 font-medium leading-relaxed">
                            {err.message}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// COMPLIANCE RULE CARD (CLIENT-SIDE)
// =============================================================================

interface ToggleConfig {
    label: string;
    description: string;
    enabled: boolean;
    onChange?: (enabled: boolean) => void;
    readOnly?: boolean;
}

function ComplianceRuleCard({
    rule, result, onRun, toggle, isStale
}: {
    rule: ComplianceRule;
    result: ComplianceResult | null | undefined;
    onRun: () => void;
    toggle?: ToggleConfig;
    isStale?: boolean;
}) {
    const status: RuleStatus = result?.status || 'not-run';
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
    const isExpanded = manualExpanded !== null ? manualExpanded : (status === 'fail' || status === 'warning');
    const toggle_ = () => setManualExpanded(!isExpanded);

    const styles = getStatusStyles(isStale ? 'warning' : status);

    return (
        <div className={cn("rounded-xl border transition-all duration-300 overflow-hidden backdrop-blur-sm shadow-sm", styles.card)}>
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/5 transition-colors" onClick={toggle_}>
                <div className="flex items-center gap-4">
                    <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center border transition-all duration-300", styles.icon)}>
                        {status === 'pass' && !isStale ? <CheckCircle2 className="h-5 w-5" /> : getRuleIcon(rule.id)}
                    </div>
                    <div>
                        <div className="font-bold text-foreground dark:text-white flex items-center gap-2 uppercase tracking-tight text-sm flex-wrap">
                            {rule.name}
                            {isStale ? (
                                <span className="text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest border shadow-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                    STALE
                                </span>
                            ) : (
                                <span className={cn("text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest border shadow-sm", styles.badge)}>
                                    {status === 'not-run' ? 'PENDING'
                                        : status === 'fail' && !result?.blocking ? 'WARNING'
                                            : status.toUpperCase()}
                                </span>
                            )}
                            {/* Toggle indicator pill */}
                            {toggle && (
                                <span className={cn(
                                    "text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest border shadow-sm",
                                    toggle.readOnly ? "cursor-default" : "cursor-pointer",
                                    toggle.enabled
                                        ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20"
                                        : "bg-muted text-muted-foreground border-border"
                                )}
                                    onClick={e => {
                                        e.stopPropagation();
                                        if (!toggle.readOnly) toggle.onChange?.(!toggle.enabled);
                                    }}
                                    title={toggle.description}
                                >
                                    {toggle.label}
                                </span>
                            )}
                        </div>
                        <div className={cn("text-xs mt-0.5 font-medium", styles.text)}>
                            {result?.summary || rule.description}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground/40 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                        onClick={e => { e.stopPropagation(); onRun(); }}
                    >
                        <Play className="h-3.5 w-3.5 fill-current" />
                    </Button>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground/30 dark:text-white/30 transition-transform duration-300", isExpanded && "rotate-180")} />
                </div>
            </div>

            {isExpanded && result && (
                <div className="border-t border-border dark:border-white/5 bg-muted/30 dark:bg-black/20 p-6 animate-in slide-in-from-top-2 duration-300 space-y-5">
                    {/* Stale warning banner */}
                    {isStale && (
                        <div className="flex items-center gap-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                            <div className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                                Settings changed — re-run to see updated result
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="ml-auto h-6 px-2 text-[10px] font-black uppercase tracking-widest text-amber-600 hover:bg-amber-500/20"
                                onClick={e => { e.stopPropagation(); onRun(); }}
                            >
                                Re-run
                            </Button>
                        </div>
                    )}
                    {/* Toggle control — shown inline in expanded view */}
                    {toggle && !toggle.readOnly && (
                        <div className="flex items-center justify-between p-3 bg-indigo-500/5 rounded-lg border border-indigo-500/20">
                            <div>
                                <div className="text-xs font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">{toggle.label}</div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">{toggle.description}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => toggle.onChange?.(!toggle.enabled)}
                                className={cn(
                                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                                    toggle.enabled ? "bg-indigo-600" : "bg-muted-foreground/20"
                                )}
                            >
                                <span className={cn(
                                    "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
                                    toggle.enabled ? "translate-x-4" : "translate-x-1"
                                )} />
                            </button>
                        </div>
                    )}
                    {/* Read-only toggle info (e.g. student visa) */}
                    {toggle?.readOnly && (
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
                            <div>
                                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">{toggle.label}</div>
                                <div className="text-[11px] text-muted-foreground/70 mt-0.5">{toggle.description}</div>
                            </div>
                            <span className={cn(
                                "text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest border",
                                toggle.enabled
                                    ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20"
                                    : "bg-muted text-muted-foreground border-border"
                            )}>
                                {toggle.enabled ? 'ENFORCED' : 'WARNING ONLY'}
                            </span>
                        </div>
                    )}
                    <RuleVisualization rule={rule} result={result} />
                </div>
            )}
        </div>
    );
}

// =============================================================================
// SERVER RULE CARD (Rules 1–3)
// =============================================================================

function ServerRuleCard({
    ruleId, ruleName, ruleDescription, ruleIcon, result, onRunAll, isRunningAll
}: {
    ruleId: string;
    ruleName: string;
    ruleDescription: string;
    ruleIcon: React.ReactNode;
    result: ComplianceResult | null | undefined;
    onRunAll: () => void;
    isRunningAll: boolean;
}) {
    const status: RuleStatus = result?.status || 'not-run';
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
    const isExpanded = manualExpanded !== null ? manualExpanded : (status === 'fail');
    const toggle_ = () => setManualExpanded(!isExpanded);

    const styles = getStatusStyles(status);
    const violations = (result?.calculation as any)?.violations || [];

    return (
        <div className={cn("rounded-xl border transition-all duration-300 overflow-hidden backdrop-blur-sm shadow-sm", styles.card)}>
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/5 transition-colors" onClick={status !== 'not-run' ? toggle_ : undefined}>
                <div className="flex items-center gap-4">
                    <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center border transition-all duration-300", styles.icon)}>
                        {status === 'pass' ? <CheckCircle2 className="h-5 w-5" /> : ruleIcon}
                    </div>
                    <div>
                        <div className="font-bold text-foreground dark:text-white flex items-center gap-2 uppercase tracking-tight text-sm">
                            {ruleName}
                            <span className={cn("text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest border shadow-sm", styles.badge)}>
                                {status === 'not-run' ? 'PENDING' : status.toUpperCase()}
                            </span>
                            <span className="text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest bg-slate-500/10 text-slate-500 border border-slate-500/20 flex items-center gap-1">
                                <Server className="h-2.5 w-2.5" />SERVER
                            </span>
                        </div>
                        <div className={cn("text-xs mt-0.5 font-medium", styles.text)}>
                            {status === 'not-run'
                                ? ruleDescription
                                : result?.summary}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {status === 'not-run' && (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-3 text-xs text-muted-foreground/60 hover:text-indigo-600 hover:bg-indigo-500/10"
                            onClick={e => { e.stopPropagation(); onRunAll(); }}
                            disabled={isRunningAll}
                        >
                            {isRunningAll ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Run All'}
                        </Button>
                    )}
                    {status !== 'not-run' && (
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground/30 dark:text-white/30 transition-transform duration-300", isExpanded && "rotate-180")} />
                    )}
                </div>
            </div>

            {isExpanded && result && violations.length > 0 && (
                <div className="border-t border-border dark:border-white/5 bg-muted/30 dark:bg-black/20 p-6 animate-in slide-in-from-top-2 duration-300 space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
                        <Shield className="h-3 w-3" />
                        {violations.length} violation{violations.length > 1 ? 's' : ''} found
                    </div>
                    {violations.map((v: any, i: number) => (
                        <div key={i} className={cn(
                            "flex items-start gap-3 p-4 rounded-xl border",
                            v.type?.includes('EXPIRED') ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20'
                        )}>
                            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-xs font-black uppercase tracking-widest mb-1">
                                    {v.type?.replace(/_/g, ' ')}
                                </div>
                                <div className="text-sm font-medium opacity-80">{v.message}</div>
                                {v.expiration_date && (
                                    <div className="text-xs mt-1 opacity-60">Expired: {v.expiration_date}</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isExpanded && result && result.status === 'pass' && (
                <div className="border-t border-border dark:border-white/5 bg-muted/30 dark:bg-black/20 p-6 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        <div className="text-sm text-emerald-700 dark:text-emerald-200">{result.details}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// RULE VISUALIZATIONS
// =============================================================================

function RuleVisualization({ rule, result }: { rule: ComplianceRule; result: ComplianceResult }) {
    switch (rule.id) {
        case 'NO_OVERLAP': return <OverlapViz result={result} />;
        case 'MAX_DAILY_HOURS': return <MaxDailyHoursViz result={result} />;
        case 'MIN_REST_GAP': return <MinRestGapViz result={result} />;
        case 'STUDENT_VISA_48H': return <StudentVisaViz result={result} />;
        case 'MIN_SHIFT_LENGTH': return <MinShiftLengthViz result={result} />;
        case 'WORKING_DAYS_CAP': return <WorkingDaysCapViz result={result} />;
        case 'AVG_FOUR_WEEK_CYCLE': return <AvgFourWeekCycleViz result={result} />;
        default: return <DefaultViz result={result} />;
    }
}

// --- OVERLAP ---

function OverlapViz({ result }: { result: ComplianceResult }) {
    if (result.status === 'pass') {
        return (
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div className="text-sm text-emerald-700 dark:text-emerald-200">No overlapping shifts found. The employee is available during this time.</div>
            </div>
        );
    }

    const calc = result.calculation;
    
    // Handle 2-way swap results if they exist
    if (calc.requester_calc || calc.offerer_calc) {
        return (
            <div className="space-y-6">
                {calc.requester_calc && (
                    <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 ml-1">Requester Conflict</div>
                        <OverlapVisualization 
                            error={{ 
                                message: result.details.split('\n')[0] || result.details,
                                context: {
                                    existing_start: calc.requester_calc.existing_start_time,
                                    existing_end: calc.requester_calc.existing_end_time,
                                    new_start: calc.requester_calc.candidate_start_time || calc.requester_candidate?.start,
                                    new_end: calc.requester_calc.candidate_end_time || calc.requester_candidate?.end
                                }
                            }} 
                        />
                    </div>
                )}
                {calc.offerer_calc && (
                    <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 ml-1">Your Conflict (Offerer)</div>
                        <OverlapVisualization 
                            error={{ 
                                message: result.details.split('\n').pop() || result.details,
                                context: {
                                    existing_start: calc.offerer_calc.existing_start_time,
                                    existing_end: calc.offerer_calc.existing_end_time,
                                    new_start: calc.offerer_calc.candidate_start_time || calc.offerer_candidate?.start,
                                    new_end: calc.offerer_calc.candidate_end_time || calc.offerer_candidate?.end
                                }
                            }} 
                        />
                    </div>
                )}
                {!calc.requester_calc && !calc.offerer_calc && (
                     <OverlapVisualization error={{ message: result.details }} />
                )}
            </div>
        );
    }

    const error = {
        message: result.details,
        context: {
            existing_start: calc.existing_start_time || '',
            existing_end: calc.existing_end_time || '',
            new_start: calc.candidate_start_time || '',
            new_end: calc.candidate_end_time || '',
            overlap_minutes: (calc.total_hours || 0) * 60
        }
    };
    return <OverlapVisualization error={error} />;
}

function OverlapVisualization({ error }: { error: { message: string; context?: { existing_start?: string; existing_end?: string; new_start?: string; new_end?: string } } }) {
    const norm = (t: string) => { 
        if (!t) return '00:00'; 
        // Remove seconds if present
        const parts = t.split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1] || '00'}`; 
    };

    const parseMsg = (msg: string) => {
        // Try to find shift times in various formats (HH:mm - HH:mm) or (HH:mm:ss - HH:mm:ss)
        // Matches "10:30 - 15:00" or "(10:30-15:00)"
        const timePairRegex = /(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/g;
        const matches = Array.from(msg.matchAll(timePairRegex));
        
        if (matches.length === 0) return null;
        
        // If there's only one pair, it's probably the existing shift
        if (matches.length === 1) {
            return { existingStart: norm(matches[0][1]), existingEnd: norm(matches[0][2]), newStart: '', newEnd: '' };
        }
        
        // If there are two pairs, first is existing, second is new (usually)
        return { 
            existingStart: norm(matches[0][1]), 
            existingEnd: norm(matches[0][2]), 
            newStart: norm(matches[1][1]), 
            newEnd: norm(matches[1][2]) 
        };
    };

    const parsed = parseMsg(error.message);
    const existingStart = error.context?.existing_start || parsed?.existingStart || '';
    const existingEnd = error.context?.existing_end || parsed?.existingEnd || '';
    // Note: candidate shifts are often stored in calculations differently than existing ones if not provided in context
    const newStart = error.context?.new_start || parsed?.newStart || '';
    const newEnd = error.context?.new_end || parsed?.newEnd || '';

    if (!existingStart || !existingEnd || !newStart || !newEnd) {
        return (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 backdrop-blur-md">
                <div className="flex items-center gap-2 font-bold mb-1 uppercase tracking-tight text-xs">
                    <Layers className="h-4 w-4" /> Shift Overlap Detected
                </div>
                <div className="text-sm font-medium opacity-90 leading-relaxed">
                    {error.message || 'The employee has another shift assigned during this time.'}
                </div>
                {(existingStart && existingEnd) && (
                    <div className="mt-2 text-[10px] font-black uppercase tracking-widest bg-red-500/10 p-2 rounded-lg border border-red-500/20 flex items-center gap-2">
                        <Clock className="h-3 w-3" /> Conflicting Shift: {norm(existingStart)} - {norm(existingEnd)}
                    </div>
                )}
            </div>
        );
    }

    const nExS = norm(existingStart), nExE = norm(existingEnd);
    const nNwS = norm(newStart), nNwE = norm(newEnd);
    
    // Time grid math
    const toP = (t: string) => { 
        const [h, m] = t.split(':').map(Number); 
        return ((h * 60 + m) / (24 * 60)) * 100; 
    };
    
    // Normalize times for percentage calculation (handle day wrap)
    let s1 = toP(existingStart), e1 = toP(existingEnd);
    if (e1 <= s1) e1 += 100;
    
    let s2 = toP(newStart), e2 = toP(newEnd);
    if (e2 <= s2) e2 += 100;
    
    // Viewport window (zoom into the relevant 8-hour block around the overlap)
    const viewStart = Math.min(s1, s2) - 5;
    const viewEnd = Math.max(e1, e2) + 5;
    const viewRange = viewEnd - viewStart;
    
    const pct = (p: number) => ((p - viewStart) / viewRange) * 100;

    const exS = pct(s1), exW = pct(e1) - exS;
    const nwS = pct(s2), nwW = pct(e2) - nwS;
    const olS = Math.max(exS, nwS), olE = Math.min(exS + exW, nwS + nwW);

    return (
        <div className="space-y-4">
            <div className="text-sm font-bold text-red-700 dark:text-red-300 flex items-center gap-2 uppercase tracking-tight">
                <Layers className="h-4 w-4" /> Shift Conflict Breakdown
            </div>
            <div className="flex gap-4">
                <div className="w-16 relative h-28 border-r border-border/50 pr-2 shrink-0">
                    <div className="absolute top-4 right-2 h-8 flex items-center text-[9px] uppercase font-black tracking-widest text-muted-foreground/40 text-right leading-none">Existing</div>
                    <div className="absolute bottom-4 right-2 h-8 flex items-center text-[9px] uppercase font-black tracking-widest text-indigo-600 dark:text-indigo-400 text-right leading-none">New</div>
                </div>
                <div className="flex-1 relative h-28 bg-muted/50 rounded-xl border border-border/50 overflow-hidden shadow-inner">
                    <div className="absolute inset-0 flex">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="flex-1 border-r border-border/20 last:border-r-0" />
                        ))}
                    </div>
                    
                    {/* Conflict Highlight */}
                    {olE > olS && (
                        <div className="absolute top-0 bottom-0 bg-red-500/10 border-x-2 border-red-500/30 z-10" style={{ left: `${olS}%`, width: `${olE - olS}%` }}>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                                <AlertOctagon className="h-5 w-5 text-red-600 dark:text-red-400 animate-pulse" />
                            </div>
                        </div>
                    )}
                    
                    {/* Existing Shift */}
                    <div className="absolute top-4 h-8 rounded-lg bg-slate-600 dark:bg-slate-400 shadow-sm flex items-center px-2 border border-black/10 z-20 group" 
                         style={{ left: `${exS}%`, width: `${Math.max(exW, 5)}%`, minWidth: '60px' }}>
                        <span className="text-[10px] text-white font-black font-mono truncate">{nExS} - {nExE}</span>
                    </div>
                    
                    {/* Candidate Shift */}
                    <div className="absolute bottom-4 h-8 rounded-lg border-2 border-indigo-500 flex items-center px-2 shadow-md z-20 group" 
                         style={{ 
                             left: `${nwS}%`, 
                             width: `${Math.max(nwW, 5)}%`, 
                             minWidth: '60px',
                             background: 'repeating-linear-gradient(45deg, rgba(79,70,229,.1), rgba(79,70,229,.1) 5px, rgba(79,70,229,.05) 5px, rgba(79,70,229,.05) 10px)'
                         }}>
                        <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-black font-mono truncate">{nNwS} - {nNwE}</span>
                    </div>
                </div>
            </div>
            <div className="text-[10px] text-muted-foreground/60 italic px-1">
                Note: Overlap confirmed by server security layer.
            </div>
        </div>
    );
}

// --- MAX DAILY HOURS ---

function MaxDailyHoursViz({ result }: { result: ComplianceResult }) {
    const { existing_hours: existingHours = 0, candidate_hours: candidateHours = 0, total_hours: totalHours = 0, limit = 12 } = result.calculation;
    const existingPct = (existingHours / limit) * 100;
    const candidatePct = (candidateHours / limit) * 100;
    const totalPct = (totalHours / limit) * 100;
    const overflowPct = Math.max(0, totalPct - 100);
    return (
        <div className="space-y-6">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
                <Clock className="h-3 w-3" />{result.status === 'fail' ? `Daily cap reached (${limit}h limit)` : `Daily projection: Within ${limit}h limit`}
            </div>
            <div className="relative pt-6">
                <div className="absolute right-0 top-0 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/40"><Shield className="h-2.5 w-2.5" /><span>Limit {limit}h</span></div>
                <div className="h-16 bg-muted rounded-xl border border-border overflow-visible relative shadow-inner">
                    <div className="absolute top-0 bottom-0 bg-muted-foreground/40 dark:bg-slate-600 rounded-l-xl flex items-center justify-center transition-all duration-500" style={{ width: `${Math.min(existingPct, 100)}%` }}>
                        {existingPct > 20 && <div className="text-center px-2"><span className="text-xs text-white font-black uppercase tracking-tighter">{existingHours}h</span><div className="text-[8px] text-white/60 font-black uppercase leading-none">Existing</div></div>}
                    </div>
                    <div className={cn("absolute top-0 bottom-0 flex items-center justify-center transition-all duration-500 shadow-lg", result.status === 'fail' ? "bg-red-500" : "bg-indigo-500", totalPct >= 99 ? "rounded-r-xl" : "")} style={{ left: `${Math.min(existingPct, 100)}%`, width: `${Math.min(candidatePct, 100 - Math.min(existingPct, 100))}%` }}>
                        {candidatePct > 15 && <div className="text-center px-2"><span className="text-xs text-white font-black uppercase tracking-tighter">+{candidateHours}h</span><div className="text-[8px] text-white/80 font-black uppercase leading-none">New</div></div>}
                    </div>
                    {overflowPct > 0 && <div className="absolute top-0 bottom-0 right-0 bg-red-600 rounded-r-xl flex items-center justify-center border-l-2 border-white/30" style={{ width: `${Math.min(overflowPct, 25)}%`, transform: 'translateX(100%)' }}><AlertTriangle className="h-5 w-5 text-white animate-pulse" /></div>}
                    <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-red-500/50 dark:bg-white/60 z-20" />
                </div>
            </div>
            <div className={cn("flex items-center justify-between p-4 rounded-xl border border-border shadow-sm", result.status === 'fail' ? "bg-red-500/5" : "bg-emerald-500/5")}>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">Total Projected</div>
                <div className={cn("flex items-baseline gap-1", result.status === 'fail' ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                    <span className="text-3xl font-black tracking-tighter">{totalHours}</span>
                    <span className="text-sm font-bold uppercase tracking-widest opacity-60">Hours</span>
                </div>
            </div>
        </div>
    );
}

// --- MIN SHIFT LENGTH (context-aware) ---

function MinShiftLengthViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    // candidate_hours is the actual duration; shift_duration is also set since the rule fix
    const duration = (calc.shift_duration as number) || (calc.candidate_hours as number) || 0;
    const limit = (calc.limit as number) || 3;
    const contextLabel = (calc.context_label as string) || 'Weekday shift';
    const isFail = result.status === 'fail';
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className={cn("text-4xl font-black tracking-tighter", isFail ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                        {duration.toFixed(1)}<span className="text-lg opacity-40 ml-1">h</span>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mt-1">Shift Duration</div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-black text-muted-foreground/20">{limit}h</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Min Required</div>
                </div>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border font-medium">
                Context: <span className="font-black text-foreground">{contextLabel}</span>
            </div>
            <div className="h-4 bg-muted rounded-full border border-border overflow-hidden relative shadow-inner">
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500/50 dark:bg-white/40 z-10" style={{ left: `${(limit / 10) * 100}%` }} />
                <div className={cn("h-full rounded-full transition-all duration-700 shadow-lg", isFail ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min((duration / 10) * 100, 100)}%` }} />
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 flex justify-between px-1"><span>0h</span><span>10h+</span></div>
        </div>
    );
}

// --- WORKING DAYS CAP ---

function WorkingDaysCapViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const count = (calc.days_worked as number) || 0;
    const limit = (calc.limit as number) || 20;
    const period = (calc.period_days as number) || 28;
    const isFail = result.status === 'fail';
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className={cn("text-4xl font-black tracking-tighter", isFail ? "text-red-600 dark:text-red-400" : "text-foreground dark:text-white")}>
                        {count}<span className="text-lg opacity-40 font-bold uppercase tracking-widest ml-1">days</span>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mt-1">Worked in last {period} days</div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-black text-muted-foreground/20">{limit}</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Max Allowed</div>
                </div>
            </div>
            <div className="h-4 bg-muted rounded-full border border-border overflow-hidden shadow-inner">
                <div className={cn("h-full rounded-full transition-all duration-700 relative shadow-lg", isFail ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min((count / limit) * 100, 100)}%` }}>
                    {isFail && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
                </div>
            </div>
        </div>
    );
}

// --- ORDINARY HOURS AVERAGING ---

function AvgFourWeekCycleViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const cycleWeeks = (calc.cycle_weeks as number) || 4;
    const weeklyLimit = (calc.weekly_limit as number) || 38;

    // Use all_cycles from rule calculation if available; otherwise synthesize from main result
    type CycleEntry = { weeks: number; total_hours: number; limit: number; average_weekly_hours: number; status: 'pass' | 'fail' };
    const allCycles: CycleEntry[] = (calc.all_cycles as CycleEntry[]) || [{
        weeks: cycleWeeks,
        total_hours: (calc.total_hours as number) || 0,
        limit: (calc.limit as number) || (cycleWeeks * 38),
        average_weekly_hours: (calc.average_weekly_hours as number) || 0,
        status: result.status === 'fail' ? 'fail' : 'pass',
    }];

    const CYCLE_LABELS: Record<number, string> = { 1: '1-Week', 2: '2-Week', 3: '3-Week', 4: '4-Week' };

    return (
        <div className="space-y-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
                <Clock className="h-3 w-3" />All Cycle Windows · Max {weeklyLimit}h/wk avg
            </div>
            <div className="grid grid-cols-2 gap-3">
                {allCycles.map(cycle => {
                    const isActive = cycle.weeks === cycleWeeks;
                    const isFail = cycle.status === 'fail';
                    const pct = Math.min((cycle.total_hours / cycle.limit) * 100, 110);
                    return (
                        <div key={cycle.weeks} className={cn(
                            "p-4 rounded-2xl border shadow-sm relative overflow-hidden",
                            isFail ? "bg-red-500/5 border-red-500/20" : "bg-card border-border",
                            isActive && "ring-2 ring-indigo-500/30"
                        )}>
                            {isActive && (
                                <div className="absolute top-2 right-2 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                    Active
                                </div>
                            )}
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-2">
                                {CYCLE_LABELS[cycle.weeks] || `${cycle.weeks}-Week`}
                            </div>
                            <div className={cn("text-2xl font-black tracking-tighter", isFail ? "text-red-600 dark:text-red-400" : "text-foreground dark:text-white")}>
                                {cycle.total_hours.toFixed(1)}<span className="text-xs opacity-40 ml-0.5">h</span>
                            </div>
                            <div className="mt-1 text-[9px] text-muted-foreground/50 font-bold">
                                avg {cycle.average_weekly_hours.toFixed(1)}h/wk · limit {cycle.limit}h
                            </div>
                            <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                    className={cn("h-full rounded-full transition-all duration-700", isFail ? "bg-red-500" : "bg-emerald-500")}
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// --- MIN REST GAP ---

function MinRestGapViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const prevGap = calc.prev_day_gap_hours as number | null;
    const nextGap = calc.next_day_gap_hours as number | null;
    const limit = (calc.limit as number) || 10;
    const mode = (calc.rest_gap_mode as string) || 'standard';

    const GapCard = ({ label, value, isViolation }: { label: string; value: number | null; isViolation: boolean }) => (
        <div className={cn("p-5 rounded-2xl border shadow-sm overflow-hidden relative", isViolation ? "bg-red-500/5 border-red-500/20" : value != null ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted border-border")}>
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-3">{label}</div>
            {value != null ? (
                <>
                    <div className={cn("text-3xl font-black tracking-tighter", isViolation ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                        {value.toFixed(1)}<span className="text-xs opacity-40 ml-1">h</span>
                    </div>
                    <div className="mt-4 h-2 bg-muted-foreground/10 dark:bg-slate-900 rounded-full overflow-hidden shadow-inner">
                        <div className={cn("h-full rounded-full transition-all duration-700 shadow-lg", isViolation ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min((value / (limit * 1.5)) * 100, 100)}%` }} />
                    </div>
                    <div className="text-[9px] font-black uppercase tracking-widest mt-2 opacity-50">{isViolation ? `Below ${limit}h min` : `Above ${limit}h min`}</div>
                </>
            ) : (
                <div className="text-muted-foreground/30 text-lg font-black uppercase tracking-widest py-2">No shift</div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border font-medium">
                Minimum rest gap: <span className="font-black text-foreground">{limit}h</span>
                {mode === 'relaxed' && <span className="ml-2 text-[9px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-black uppercase tracking-widest">RELAXED MODE</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
                <GapCard label="Gap from Previous Day" value={prevGap} isViolation={prevGap != null && prevGap < limit} />
                <GapCard label="Gap to Next Day" value={nextGap} isViolation={nextGap != null && nextGap < limit} />
            </div>
        </div>
    );
}

// --- STUDENT VISA ---

function StudentVisaViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const limit = (calc.limit as number) || 48;
    const isFail = result.status === 'fail';
    const isEnforced = (calc.enforcement_enabled as boolean) || false;
    const hasNewFormat = calc.weeks && typeof calc.weeks === 'object' && !Array.isArray(calc.weeks);

    if (hasNewFormat) {
        const weeksData = calc.weeks as Record<string, { hours: number; dates: string }>;
        const weekKeys = Object.keys(weeksData).sort();
        const windowsEvaluated = (calc.windows_evaluated || []) as Array<{ weeks: string[]; hours: number; status: string }>;
        const violations = (calc.violations || []) as Array<{ weeks: string[]; hours: number }>;
        const violatingWeeks = new Set<string>();
        violations.forEach(v => v.weeks.forEach(w => violatingWeeks.add(w)));
        const worstWindow = windowsEvaluated.length > 0 ? windowsEvaluated.reduce((w, c) => c.hours > w.hours ? c : w, windowsEvaluated[0]) : null;
        const maxHours = Math.max(...Object.values(weeksData).map(w => w.hours), 30);

        return (
            <div className="space-y-6">
                <div className="text-[11px] font-medium text-muted-foreground leading-relaxed p-4 bg-muted/30 rounded-xl border border-border">
                    Cannot work more than <span className="font-black text-foreground">{limit} hours</span> in any rolling fortnight.
                    {isEnforced
                        ? <span className="ml-1 text-[9px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-black uppercase tracking-widest">ENFORCEMENT ON</span>
                        : <span className="ml-1 text-[9px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border font-black uppercase tracking-widest">WARNING ONLY</span>}
                    {isFail && <span className="text-red-600 dark:text-red-400 font-black uppercase tracking-tight ml-1"> Limit exceeded.</span>}
                </div>
                <div className="space-y-4 max-h-56 overflow-y-auto pr-3">
                    {weekKeys.map((weekKey, idx) => {
                        const weekData = weeksData[weekKey];
                        const barWidth = (weekData.hours / maxHours) * 100;
                        const isViolating = violatingWeeks.has(weekKey);
                        const weekLabel = weekKey.split('-')[1] || weekKey;
                        return (
                            <div key={`${weekKey}-${idx}`}>
                                <div className="flex items-center gap-5 mb-1.5">
                                    <div className="w-24 flex-shrink-0">
                                        <div className={cn("text-xs font-black uppercase tracking-widest", isViolating ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{weekLabel}</div>
                                        <div className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-tighter">{weekData.dates}</div>
                                    </div>
                                    <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden shadow-inner">
                                        <div className={cn("h-full transition-all duration-700 rounded-full relative shadow-sm", isViolating ? "bg-gradient-to-r from-red-600 to-red-400" : "bg-muted-foreground/30 dark:bg-slate-600")} style={{ width: `${barWidth}%` }}>
                                            {isViolating && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
                                        </div>
                                    </div>
                                    <div className={cn("w-12 text-right text-xs font-black tracking-tight", isViolating ? "text-red-600 dark:text-red-400" : "text-foreground dark:text-white")}>
                                        {weekData.hours}<span className="text-[10px] opacity-40">h</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className={cn("p-5 rounded-2xl border flex items-center justify-between shadow-lg", isFail ? "bg-red-500/10 border-red-500/30" : "bg-card border-border")}>
                    <div className="flex items-center gap-3">
                        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center border", isFail ? "bg-red-500/20 border-red-500/20 text-red-600 dark:text-red-400" : "bg-muted border-border text-muted-foreground")}>
                            <Clock className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Fortnight Peak</div>
                            <div className="text-[11px] font-bold text-foreground truncate max-w-[140px]">{worstWindow ? `${worstWindow.weeks[0]} + ${worstWindow.weeks[1]}` : 'No peak window'}</div>
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={cn("text-4xl font-black tracking-tighter", isFail ? "text-red-600 dark:text-red-400" : "text-foreground dark:text-white")}>
                            {worstWindow?.hours || 0}<span className="text-base opacity-40 ml-0.5">h</span>
                        </span>
                        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground/30">/ {limit}h</span>
                    </div>
                </div>
            </div>
        );
    }
    return <DefaultViz result={result} />;
}

// --- DEFAULT ---

function DefaultViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation as Record<string, any>;

    // Extract key numeric fields from calculation and render as readable pills
    // Never dump raw JSON to the UI — extract only what's meaningful
    type Pill = { label: string; value: string; highlight: boolean };
    const pills: Pill[] = [];
    if (typeof calc.existing_hours === 'number')        pills.push({ label: 'Current hours',  value: `${calc.existing_hours.toFixed(1)}h`,  highlight: false });
    if (typeof calc.candidate_hours === 'number')       pills.push({ label: 'Added by shift', value: `+${calc.candidate_hours.toFixed(1)}h`, highlight: false });
    if (typeof calc.total_hours === 'number')           pills.push({ label: 'Total projected', value: `${calc.total_hours.toFixed(1)}h`,     highlight: result.status === 'fail' });
    if (typeof calc.limit === 'number')                 pills.push({ label: 'Limit',           value: `${calc.limit}h`,                      highlight: false });
    if (typeof calc.average_weekly_hours === 'number')  pills.push({ label: 'Avg / wk',        value: `${calc.average_weekly_hours.toFixed(1)}h`, highlight: result.status === 'fail' });
    if (typeof calc.days_worked === 'number')           pills.push({ label: 'Days worked',     value: `${calc.days_worked}`,                 highlight: result.status === 'fail' });
    if (typeof calc.period_days === 'number')           pills.push({ label: 'Period',          value: `${calc.period_days} days`,            highlight: false });
    if (typeof calc.shift_duration === 'number')        pills.push({ label: 'Duration',        value: `${calc.shift_duration.toFixed(1)}h`,  highlight: result.status === 'fail' });

    return (
        <div className="space-y-4">
            {result.details && (
                <div className="text-sm font-medium text-muted-foreground leading-relaxed italic">{result.details}</div>
            )}
            {pills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {pills.map(p => (
                        <div key={p.label} className={cn(
                            'px-3 py-1.5 rounded-lg border text-center min-w-[72px]',
                            p.highlight ? 'bg-red-500/5 border-red-500/20' : 'bg-muted/50 border-border'
                        )}>
                            <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">{p.label}</div>
                            <div className={cn('text-sm font-black mt-0.5', p.highlight ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>{p.value}</div>
                        </div>
                    ))}
                </div>
            )}
            {pills.length === 0 && !result.details && (
                <p className="text-xs text-muted-foreground/50 italic">No additional details available.</p>
            )}
        </div>
    );
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

function getStatusStyles(status: RuleStatus) {
    switch (status) {
        case 'pass': return {
            card: "border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/10",
            icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
            badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
            text: "text-emerald-800/60 dark:text-emerald-100/60"
        };
        case 'fail': return {
            card: "border-red-500/20 bg-red-500/5 dark:bg-red-950/20",
            icon: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
            badge: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
            text: "text-red-800/60 dark:text-red-100/60"
        };
        case 'warning': return {
            card: "border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20",
            icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
            badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
            text: "text-amber-800/60 dark:text-amber-100/60"
        };
        default: return {
            card: "border-border bg-card dark:bg-slate-900/40",
            icon: "bg-muted text-muted-foreground border-border",
            badge: "bg-muted text-muted-foreground border-border",
            text: "text-muted-foreground/60"
        };
    }
}

function getRuleIcon(ruleId: string) {
    switch (ruleId) {
        case 'MAX_DAILY_HOURS': return <Clock className="h-5 w-5" />;
        case 'MIN_REST_GAP': return <Moon className="h-5 w-5" />;
        case 'STUDENT_VISA_48H': return <Zap className="h-5 w-5" />;
        case 'NO_OVERLAP': return <Layers className="h-5 w-5" />;
        case 'WORKING_DAYS_CAP': return <Calendar className="h-5 w-5" />;
        case 'AVG_FOUR_WEEK_CYCLE': return <Clock className="h-5 w-5" />;
        default: return <Shield className="h-5 w-5" />;
    }
}

export default ComplianceTabContent;
