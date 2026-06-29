import React from 'react';
import { LucideIcon } from 'lucide-react';
import { ScopeSelection } from '@/platform/auth/types';
import { PersonalPageHeader } from './PersonalPageHeader';
import { UnifiedModuleFunctionBar } from './UnifiedModuleFunctionBar';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

/**
 * GoldStandardHeader
 *
 * THE single header used on every page. Renders as a self-contained glass
 * card disconnected on all four sides — equal padding to the sidebar, top,
 * right edge, and the body component below.
 *
 * Internal layout (3 rows, stacked inside the glass card):
 *   Row 1 — Page title (left) + live clock (right)
 *   Row 2 — Global scope filter (location / department / sub-department)
 *   Row 3 — Function bar (date range, filters, view toggle, search, actions)
 *
 * Usage modes:
 *   1. Pass a `functionBar` slot for fully custom Row-3 content (e.g. Roster
 *      DAY/3D/WEEK/MONTH switcher, Broadcasts category tabs).
 *   2. Pass the structured props (viewMode, startDate, filters, etc.) to use
 *      the built-in UnifiedModuleFunctionBar — convenient for planning pages.
 *
 * Pages must NEVER render their own title / scope filter / function bar
 * outside this component. Body content sits below this header as its own
 * disconnected glass card with matching margins.
 */

// ─── Row 1 props ────────────────────────────────────────────────────────────
interface TitleRowProps {
    title: string;
    Icon: LucideIcon;
    rightActions?: React.ReactNode;
}

// ─── Row 2 props ────────────────────────────────────────────────────────────
interface ScopeRowProps {
    scope?: ScopeSelection;
    setScope?: (scope: ScopeSelection) => void;
    isGammaLocked?: boolean;
    mode?: 'personal' | 'managerial';
    multiSelect?: boolean;
}

// ─── Row 3 props (structured fallback to UnifiedModuleFunctionBar) ──────────
interface BuiltInFunctionBarProps {
    viewMode?: 'card' | 'table';
    onViewModeChange?: (mode: 'card' | 'table') => void;
    startDate?: Date;
    endDate?: Date;
    onDateChange?: (start: Date, end: Date) => void;
    onRefresh?: () => void;
    isLoading?: boolean;
    filters?: React.ReactNode;
    leftContent?: React.ReactNode;
    searchQuery?: string;
    onSearchChange?: (val: string) => void;
    /** Passed as children to UnifiedModuleFunctionBar (e.g. status tabs) */
    functionBarChildren?: React.ReactNode;
}

export interface GoldStandardHeaderProps
    extends TitleRowProps,
        ScopeRowProps,
        BuiltInFunctionBarProps {
    /**
     * Fully custom Row-3 content. When provided, the structured function-bar
     * props are ignored and this slot is rendered as the function bar.
     * Use for pages with non-standard controls (e.g. Roster, Broadcasts).
     */
    functionBar?: React.ReactNode;
    subFunctionBar?: React.ReactNode;
    className?: string;
}

export const GoldStandardHeader: React.FC<GoldStandardHeaderProps> = ({
    // Row 1
    title,
    Icon,
    rightActions,
    // Row 2
    scope,
    setScope,
    isGammaLocked,
    mode = 'personal',
    multiSelect,
    // Row 3 (custom slot)
    functionBar,
    subFunctionBar,
    // Row 3 (structured)
    viewMode,
    onViewModeChange,
    startDate,
    endDate,
    onDateChange,
    onRefresh,
    isLoading,
    filters,
    leftContent,
    searchQuery,
    onSearchChange,
    functionBarChildren,
    className,
}) => {
    const { isDark } = useTheme();
    const usingBuiltIn = functionBar === undefined && viewMode !== undefined && onViewModeChange !== undefined;
    const showFunctionBar = functionBar !== undefined || usingBuiltIn;

    return (
        // Outer wrapper provides equal padding on all four sides — disconnects
        // the header card from the sidebar, top, right edge, and the body below.
        // We use pb-2 to ensure the gap between header and body is consistent with the top/sides.
        <div className={cn("flex-shrink-0 px-2 pt-2 pb-4 lg:p-6", className)}>
            <div className={cn(
                "rounded-[32px] px-3 py-4 lg:p-6 transition-all border relative overflow-hidden",
                isDark
                    ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20 backdrop-blur-xl"
                    : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
            )}>
                {/* Subtle highlight effect for glassmorphism */}
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent" />

                {/* ── Rows 1 & 2: Title · Clock · Scope Filter ── */}
                <PersonalPageHeader
                    title={title}
                    Icon={Icon}
                    scope={scope}
                    setScope={setScope}
                    isGammaLocked={isGammaLocked}
                    mode={mode}
                    multiSelect={multiSelect}
                    rightActions={rightActions}
                />

                {/* ── Row 3: Function Bar ── */}
                {showFunctionBar && (
                    functionBar !== undefined ? (
                        functionBar
                    ) : (
                        <UnifiedModuleFunctionBar
                            viewMode={viewMode!}
                            onViewModeChange={onViewModeChange!}
                            startDate={startDate}
                            endDate={endDate}
                            onDateChange={onDateChange}
                            onRefresh={onRefresh}
                            isLoading={isLoading}
                            filters={filters}
                            leftContent={leftContent}
                            searchQuery={searchQuery}
                            onSearchChange={onSearchChange}
                            transparent
                        >
                            {functionBarChildren}
                        </UnifiedModuleFunctionBar>
                    )
                )}

                {/* ── Row 4: Sub-Function Bar (e.g. Bulk Selection Toolbar) ── */}
                {subFunctionBar && (
                    <div className="mt-1 pt-1 border-t border-border/10 md:mt-3 md:pt-3">
                        {subFunctionBar}
                    </div>
                )}
            </div>
        </div>
    );
};
