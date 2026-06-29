/**
 * DevPerfOverlay — Mission Control observability panel
 *
 * Only mounted when import.meta.env.DEV is true. Production builds
 * tree-shake this entire component.
 *
 * Design direction: NASA Mission Control telemetry feed
 *   - Monospaced font throughout (reading numbers, not prose)
 *   - Teal/cyan primary accent — distinct from app's emerald/amber palette
 *   - Tight, data-dense layout with animated live indicators
 *   - Minimal chrome, zero decoration beyond the data itself
 *   - Collapsible to a compact status pill that stays out of the way
 *
 * Shows:
 *   ① Cache health   — total queries, stale count, error count
 *   ② Recent queries — key, duration, rating as a progress bar
 *   ③ Web Vitals     — CLS, LCP, FID/INP with pass/fail colouring
 *
 * Keyboard: Alt+P toggles expand/collapse
 */

import React, { useEffect, useReducer, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    queryPerfTracker,
    webVitalsCollector,
    type QueryPerfEntry,
    type WebVitalsSnapshot,
} from '@/modules/core/lib/performance';

// ── CSS injected once ─────────────────────────────────────────────────────────

const OVERLAY_CSS = `
@keyframes dpo-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
@keyframes dpo-bar-grow {
  from { width: 0; }
}
.dpo-live  { animation: dpo-blink 1.6s ease-in-out infinite; }
.dpo-bar   { animation: dpo-bar-grow 0.4s ease-out both; }
`;

let cssInjected = false;
function injectCSS() {
    if (cssInjected || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);
    cssInjected = true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RATING_COLOR: Record<QueryPerfEntry['rating'], string> = {
    'good':               '#2dd4bf', // teal-400
    'needs-improvement':  '#fbbf24', // amber-400
    'poor':               '#f87171', // red-400
};

const RATING_BG: Record<QueryPerfEntry['rating'], string> = {
    'good':               'rgba(45,212,191,0.18)',
    'needs-improvement':  'rgba(251,191,36,0.18)',
    'poor':               'rgba(248,113,113,0.18)',
};

const MAX_BAR_MS = 1000;

function VitalsBadge({ label, value, unit, threshold }: {
    label:     string;
    value?:    number;
    unit:      string;
    threshold: number;
}) {
    const ok    = value !== undefined && value <= threshold;
    const color = value === undefined ? '#475569' : ok ? '#2dd4bf' : '#f87171';
    return (
        <div className="flex items-center justify-between gap-2">
            <span style={{ color: '#64748b', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                {label}
            </span>
            <span style={{ color, fontFamily: 'monospace', fontSize: 10, fontWeight: 600 }}>
                {value !== undefined ? `${value}${unit}` : '—'}
            </span>
        </div>
    );
}

function QueryBar({ entry }: { entry: QueryPerfEntry }) {
    const pct  = Math.min(100, (entry.duration / MAX_BAR_MS) * 100);
    const color = RATING_COLOR[entry.rating];
    const bg    = RATING_BG[entry.rating];

    // Truncate long keys
    const shortKey = entry.key.length > 28 ? entry.key.slice(0, 26) + '…' : entry.key;

    return (
        <div style={{ marginBottom: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#94a3b8', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 160 }}>
                    {shortKey}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color, flexShrink: 0, marginLeft: 6 }}>
                    {entry.duration}ms
                </span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                    className="dpo-bar"
                    style={{ height: '100%', width: `${pct}%`, background: bg, borderRadius: 2, borderRight: `1px solid ${color}` }}
                />
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DevPerfOverlay() {
    injectCSS();

    const queryClient       = useQueryClient();
    const [, forceUpdate]   = useReducer(x => x + 1, 0);
    const [expanded, setExpanded] = useState(false);
    const [visible, setVisible]   = useState(true);

    // Start trackers once
    const started = useRef(false);
    if (!started.current) {
        queryPerfTracker.start(queryClient);
        webVitalsCollector.start();
        started.current = true;
    }

    // Subscribe to updates
    useEffect(() => {
        const unsub1 = queryPerfTracker.onUpdate(forceUpdate);
        const unsub2 = webVitalsCollector.onUpdate(forceUpdate);
        return () => { unsub1(); unsub2(); };
    }, []);

    // Alt+P keyboard toggle
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.altKey && e.key === 'p') {
            e.preventDefault();
            setExpanded(v => !v);
        }
    }, []);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // ── Live data ────────────────────────────────────────────────────────────
    const cache       = queryClient.getQueryCache();
    const allQueries  = cache.getAll();
    const total       = allQueries.length;
    const staleCount  = allQueries.filter(q => q.isStale()).length;
    const recent      = queryPerfTracker.getRecent(8);
    const avgMs       = queryPerfTracker.getAverageDuration();
    const errorCount  = queryPerfTracker.getErrorCount();
    const vitals      = webVitalsCollector.getSnapshot() as WebVitalsSnapshot;

    // Overall health dot
    const healthColor = errorCount > 0 ? '#f87171' : avgMs > 800 ? '#fbbf24' : '#2dd4bf';

    if (!visible) return null;

    // ── Collapsed pill ───────────────────────────────────────────────────────
    if (!expanded) {
        return (
            <button
                onClick={() => setExpanded(true)}
                title="Open Performance Monitor (Alt+P)"
                aria-label="Open performance monitor"
                style={{
                    position:     'fixed',
                    bottom:       16,
                    right:        16,
                    zIndex:       9999,
                    display:      'flex',
                    alignItems:   'center',
                    gap:          6,
                    padding:      '5px 10px',
                    background:   'rgba(2,8,23,0.92)',
                    border:       `1px solid rgba(45,212,191,0.25)`,
                    borderRadius: 6,
                    cursor:       'pointer',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                }}
            >
                <span
                    className="dpo-live"
                    style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: healthColor }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#2dd4bf', letterSpacing: '0.1em' }}>
                    PERF
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>
                    {total}q · {avgMs || '—'}ms
                </span>
            </button>
        );
    }

    // ── Expanded panel ───────────────────────────────────────────────────────
    return (
        <div
            role="region"
            aria-label="Performance monitor"
            style={{
                position:     'fixed',
                bottom:       16,
                right:        16,
                zIndex:       9999,
                width:        260,
                background:   'rgba(2,8,23,0.96)',
                border:       '1px solid rgba(45,212,191,0.2)',
                borderRadius: 8,
                overflow:     'hidden',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow:    '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
        >
            {/* ── Header bar ───────────────────────────────────────────────── */}
            <div style={{
                display:       'flex',
                alignItems:    'center',
                justifyContent:'space-between',
                padding:       '7px 10px',
                borderBottom:  '1px solid rgba(45,212,191,0.12)',
                background:    'rgba(45,212,191,0.04)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                        className="dpo-live"
                        style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: healthColor, flexShrink: 0 }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#2dd4bf', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                        Mission Control
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button
                        onClick={() => setExpanded(false)}
                        title="Collapse (Alt+P)"
                        aria-label="Collapse performance monitor"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 14, lineHeight: 1, padding: 0 }}
                    >
                        −
                    </button>
                    <button
                        onClick={() => setVisible(false)}
                        aria-label="Close performance monitor"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 14, lineHeight: 1, padding: 0 }}
                    >
                        ×
                    </button>
                </div>
            </div>

            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* ── Cache health ─────────────────────────────────────────── */}
                <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#2dd4bf', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 5 }}>
                        Cache
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
                        {[
                            { label: 'Total',  value: total,      color: '#94a3b8' },
                            { label: 'Stale',  value: staleCount, color: staleCount > 0 ? '#fbbf24' : '#94a3b8' },
                            { label: 'Errors', value: errorCount, color: errorCount > 0 ? '#f87171' : '#94a3b8' },
                        ].map(({ label, value, color }) => (
                            <div key={label} style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
                                <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>
                                    {value}
                                </div>
                                <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#475569', marginTop: 2, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                    {label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Recent queries ───────────────────────────────────────── */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#2dd4bf', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                            Recent
                        </span>
                        <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#475569' }}>
                            avg&nbsp;{avgMs || '—'}ms
                        </span>
                    </div>
                    {recent.length === 0 ? (
                        <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#334155', textAlign: 'center', padding: '8px 0' }}>
                            No queries recorded yet
                        </p>
                    ) : (
                        recent.map((entry, i) => <QueryBar key={`${entry.key}-${entry.timestamp}-${i}`} entry={entry} />)
                    )}
                </div>

                {/* ── Web Vitals ───────────────────────────────────────────── */}
                <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#2dd4bf', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 5 }}>
                        Web Vitals
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <VitalsBadge label="CLS" value={vitals.cls} unit=""   threshold={0.1}  />
                        <VitalsBadge label="LCP" value={vitals.lcp} unit="ms" threshold={2500} />
                        <VitalsBadge label="FID" value={vitals.fid} unit="ms" threshold={100}  />
                        <VitalsBadge label="INP" value={vitals.inp} unit="ms" threshold={200}  />
                    </div>
                </div>

                {/* ── Footer ───────────────────────────────────────────────── */}
                <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#1e293b', textAlign: 'center', margin: 0 }}>
                    Dev only · Alt+P to toggle
                </p>
            </div>
        </div>
    );
}

/**
 * Drop-in gate: renders nothing in production, renders the overlay in dev.
 * Import this instead of DevPerfOverlay directly to avoid any production cost.
 */
export function DevPerfOverlayGate() {
    if (!import.meta.env.DEV) return null;
    if (window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) return null;
    return <DevPerfOverlay />;
}
