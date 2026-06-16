/**
 * AutoSchedulerInsights — single-mode transparency panel.
 *
 * Replaces the old cost/fatigue/fairness sensitivity sliders. The autoscheduler
 * now runs ONE fixed lexicographic policy (coverage » wellbeing guardrails »
 * cost), so instead of asking the manager to tune weights we SHOW them:
 *
 *   • U2 — a four-pillar scorecard (Coverage / Fairness / Fatigue / Cost),
 *   • U5 — a constraint banner explaining any shifts left uncovered,
 *   • U3 — a Pareto "what-if" trade-off explorer (radar) comparing the chosen
 *          roster to the cheapest / most-balanced alternatives.
 *
 * All data comes from the solver via AutoSchedulerResult (pillars,
 * bindingConstraints, alternatives). Purely presentational.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend,
} from 'recharts';
import { AlertTriangle, ShieldCheck, Scale, BatteryCharging, DollarSign, CalendarCheck } from 'lucide-react';
import { Card } from '@/modules/core/ui/primitives/card';
import { Alert, AlertDescription, AlertTitle } from '@/modules/core/ui/primitives/alert';
import type {
    AutoSchedulerResult, PillarScores, ParetoAlternative,
} from '../types';

// ── pillar score → semantic colour band ──────────────────────────────────────
function band(score: number): { text: string; bar: string; chip: string } {
    if (score >= 85) return { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
    if (score >= 65) return { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' };
    return { text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500', chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' };
}

// Cost is a $ value, not a 0-100 score — give it a neutral (non-graded) treatment
// so it reads as "a figure", not "a passing grade".
const NEUTRAL_BAND = { text: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500', chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' };

const fmtMoney = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);

// ── one pillar card — the SINGLE uniform metric card used across the scorecard ──
// `score` (0-100) drives the colour band, the "/100" chip and the bar fill.
// `unit` (e.g. "AUD") opts a card out of grading: neutral band, full bar, the
// unit shown in place of the score chip. Every card shares identical chrome so
// the row reads as one coherent set, not competing widgets.
function PillarCard({
    icon, label, value, sub, score, unit, index,
}: {
    icon: React.ReactNode; label: string; value: string; sub: string;
    score?: number; unit?: string; index: number;
}) {
    const c = unit ? NEUTRAL_BAND : band(score ?? 0);
    const fill = unit ? 100 : Math.max(2, Math.min(100, score ?? 0));
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="group relative h-full overflow-hidden rounded-2xl border border-border/60 bg-card/70 dark:bg-card/40 p-4 shadow-sm transition-colors hover:border-border">
                {/* score-coloured accent hairline */}
                <div className={`absolute inset-x-0 top-0 h-px ${c.bar} opacity-70`} />
                <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${c.chip}`}>{icon}</span>
                        <span className="truncate">{label}</span>
                    </span>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${c.chip}`}>
                        {unit ?? `${score}/100`}
                    </span>
                </div>
                <div className="mt-3 text-2xl font-black tracking-tight tabular-nums text-foreground">{value}</div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
                    <motion.div
                        className={`h-full rounded-full ${c.bar}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${fill}%` }}
                        transition={{ delay: index * 0.06 + 0.15, duration: 0.5, ease: 'easeOut' }}
                    />
                </div>
                <div className="mt-2 truncate text-[11px] text-muted-foreground/80 tabular-nums">{sub}</div>
            </div>
        </motion.div>
    );
}

// ── normalise a pillar set onto a 0-100 radar (cost inverted → "value") ───────
function toRadarRow(axis: string, get: (p: PillarScores) => number, options: Array<{ key: string; pillars: PillarScores }>) {
    const row: Record<string, number | string> = { axis };
    for (const o of options) row[o.key] = Math.round(get(o.pillars));
    return row;
}

export function AutoSchedulerInsights({ result }: { result: AutoSchedulerResult }) {
    const pillars = result.pillars ?? null;
    const alternatives: ParetoAlternative[] = result.alternatives ?? [];
    const binding = result.bindingConstraints ?? [];

    // Options for the radar: the chosen roster + each alternative.
    const radarData = useMemo(() => {
        if (!pillars) return null;
        const options = [
            { key: 'chosen', label: 'Chosen', pillars },
            ...alternatives.map(a => ({ key: a.key, label: a.label, pillars: a.pillars })),
        ];
        // Cost → a 0-100 "cost value" where the cheapest option scores 100.
        const costs = options.map(o => o.pillars.cost.total);
        const minCost = Math.min(...costs);
        const maxCost = Math.max(...costs, minCost + 1);
        const costScore = (c: number) => 100 - Math.round(((c - minCost) / (maxCost - minCost)) * 100);
        const rows = [
            toRadarRow('Coverage', p => p.coverage.score, options),
            toRadarRow('Fairness', p => p.fairness.score, options),
            toRadarRow('Wellbeing', p => p.fatigue.score, options),
            { axis: 'Cost value', ...Object.fromEntries(options.map(o => [o.key, costScore(o.pillars.cost.total)])) },
        ];
        return { rows, options };
    }, [pillars, alternatives]);

    if (!pillars) return null;

    const cheapest = alternatives.find(a => a.key === 'cheapest');
    const costDelta = cheapest ? pillars.cost.total - cheapest.pillars.cost.total : 0;
    const fairnessDelta = cheapest ? pillars.fairness.score - cheapest.pillars.fairness.score : 0;

    // Compliance pass-rate — folded into the single scorecard as a 5th pillar
    // (was a separate, redundant stats tile). One source of truth per metric.
    const compliancePct = result.totalProposals > 0
        ? Math.round((result.passing / result.totalProposals) * 100)
        : 100;

    const radarColors: Record<string, string> = {
        chosen: '#10b981', cheapest: '#f59e0b', fairest: '#6366f1',
    };

    return (
        <div className="space-y-4">
            {/* Single-mode header */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>
                    <span className="font-medium text-foreground">Optimal roster.</span>{' '}
                    Balanced automatically for coverage, wellbeing, and cost — in that priority order.
                </span>
            </div>

            {/* THE scorecard — one uniform card per headline metric. This is the
                single source of truth: the old second stats grid (Total Cost /
                Avg Fatigue / Uncovered / Coverage / Compliance) duplicated four of
                these and split fatigue into two conflicting numbers, so it was
                removed. Per-person fatigue/cost live in the staff table below. */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <PillarCard
                    index={0}
                    icon={<CalendarCheck className="h-3.5 w-3.5" />}
                    label="Coverage"
                    score={pillars.coverage.score}
                    value={`${pillars.coverage.score}%`}
                    sub={`${pillars.coverage.covered}/${pillars.coverage.total} shifts filled`}
                />
                <PillarCard
                    index={1}
                    icon={<BatteryCharging className="h-3.5 w-3.5" />}
                    label="Wellbeing"
                    score={pillars.fatigue.score}
                    value={`${pillars.fatigue.score}`}
                    sub={pillars.fatigue.critical > 0
                        ? `${pillars.fatigue.critical} over-tired`
                        : pillars.fatigue.amber > 0
                            ? `${pillars.fatigue.amber} near limit`
                            : 'all well-rested'}
                />
                <PillarCard
                    index={2}
                    icon={<Scale className="h-3.5 w-3.5" />}
                    label="Fairness"
                    score={pillars.fairness.score}
                    value={`${pillars.fairness.score}`}
                    sub={`${pillars.fairness.employees_used} staff · ${Math.round(pillars.fairness.spread_minutes / 60)}h spread`}
                />
                <PillarCard
                    index={3}
                    icon={<ShieldCheck className="h-3.5 w-3.5" />}
                    label="Compliance"
                    score={compliancePct}
                    value={`${compliancePct}%`}
                    sub={`${result.passing}/${result.totalProposals} passing`}
                />
                <PillarCard
                    index={4}
                    icon={<DollarSign className="h-3.5 w-3.5" />}
                    label="Labour cost"
                    unit="AUD"
                    value={fmtMoney(pillars.cost.total)}
                    sub={`${fmtMoney(pillars.cost.avg_per_shift)}/shift avg`}
                />
            </div>

            {/* U5 — constraint banner */}
            {binding.length > 0 && (
                <Alert variant="destructive" className="bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{binding.length} shift{binding.length !== 1 ? 's' : ''} could not be filled</AlertTitle>
                    <AlertDescription>
                        <ul className="mt-1 space-y-0.5 text-xs">
                            {binding.slice(0, 4).map(b => (
                                <li key={b.shift_id}>• {b.reason}</li>
                            ))}
                            {binding.length > 4 && <li className="text-muted-foreground">…and {binding.length - 4} more</li>}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            {/* U3 — Pareto trade-off explorer */}
            {radarData && alternatives.length > 0 && (
                <Card className="p-4 bg-card border-border">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-foreground">What else was possible?</h4>
                        <span className="text-xs text-muted-foreground">chosen vs. alternatives</span>
                    </div>
                    <div className="grid md:grid-cols-[1fr_auto] gap-4 items-center">
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <RadarChart data={radarData.rows} outerRadius="72%">
                                    <PolarGrid className="stroke-border" />
                                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-muted-foreground" />
                                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                                    {radarData.options.map(o => (
                                        <Radar
                                            key={o.key}
                                            name={o.label}
                                            dataKey={o.key}
                                            stroke={radarColors[o.key] ?? '#94a3b8'}
                                            fill={radarColors[o.key] ?? '#94a3b8'}
                                            fillOpacity={o.key === 'chosen' ? 0.35 : 0.08}
                                            strokeWidth={o.key === 'chosen' ? 2 : 1.5}
                                        />
                                    ))}
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                </RadarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="text-xs text-muted-foreground max-w-[16rem] space-y-2">
                            {cheapest && (
                                <p>
                                    The <span className="font-medium text-amber-600 dark:text-amber-400">cheapest</span> roster would
                                    {costDelta > 0
                                        ? <> save <span className="font-semibold text-foreground">{fmtMoney(costDelta)}</span></>
                                        : <> cost about the same</>}
                                    {fairnessDelta > 0
                                        ? <>, but fairness drops <span className="font-semibold text-foreground">{fairnessDelta} pts</span>.</>
                                        : <>.</>}
                                </p>
                            )}
                            <p>Higher is better on every axis (cost shown as value-for-money). The chosen roster is optimised for wellbeing before cost.</p>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
