// src/modules/templates/ui/constants.ts
// Shared constants for the Templates module UI

import { Building2, LayoutGrid, Theater, Film } from 'lucide-react';
import React from 'react';

/**
 * Default groups seeded when a new template is created.
 * This must match the database trigger `trigger_seed_fixed_template_groups`.
 */
export const DEFAULT_GROUPS = [
    { name: 'Convention Centre', color: '#3b82f6', icon: 'building' },
    { name: 'Exhibition Centre', color: '#22c55e', icon: 'layout-grid' },
    { name: 'Theatre', color: '#ef4444', icon: 'theater' },
    { name: 'The Cutaway', color: '#f59e0b', icon: 'film' },
] as const;

/**
 * Visual configuration for each group type.
 * Used by TemplateEditor and related components.
 */
export const GROUP_CONFIG: Record<
    string,
    {
        icon: React.ReactNode;
        gradient: string;
        border: string;
        badge: string;
    }
> = {
    'Convention Centre': {
        icon: React.createElement(Building2, { className: 'h-5 w-5' }),
        gradient: 'from-blue-600/30 via-blue-500/10 to-transparent dark:from-blue-600/20 dark:via-blue-500/10',
        border: 'border-blue-500/30',
        badge: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30',
    },
    'Exhibition Centre': {
        icon: React.createElement(LayoutGrid, { className: 'h-5 w-5' }),
        gradient: 'from-emerald-600/30 via-emerald-500/10 to-transparent dark:from-emerald-600/20 dark:via-emerald-500/10',
        border: 'border-emerald-500/30',
        badge: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    },
    Theatre: {
        icon: React.createElement(Theater, { className: 'h-5 w-5' }),
        gradient: 'from-red-600/30 via-red-500/10 to-transparent dark:from-red-600/20 dark:via-red-500/10',
        border: 'border-red-500/30',
        badge: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
    },
    'The Cutaway': {
        icon: React.createElement(Film, { className: 'h-5 w-5' }),
        gradient: 'from-amber-600/30 via-amber-500/10 to-transparent dark:from-amber-600/20 dark:via-amber-500/10',
        border: 'border-amber-500/30',
        badge: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
    },
};

/**
 * Color map for group names (simpler version for ShiftCard etc.)
 */
export const GROUP_COLOR_MAP: Record<string, string> = {
    'Convention Centre': 'blue',
    'Exhibition Centre': 'green',
    Theatre: 'red',
    'The Cutaway': 'amber',
};

export function getGroupColor(groupName: string): string {
    return GROUP_COLOR_MAP[groupName] || 'blue';
}
