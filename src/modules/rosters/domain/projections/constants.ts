/**
 * Roster Projection Engine — Design Constants
 *
 * THE authoritative source for every colour, glass-morphism style, and label
 * string used across the four roster modes.  Import from here — never
 * re-declare these values in a view component.
 *
 * Canonical `theatre` accent = RED.  Any purple mapping in RolesModeView was
 * a bug that this file permanently fixes.
 */

import type { GroupColorSet } from './types';
import type { TemplateGroupType } from '../shift.entity';

// ── Group colour tokens ────────────────────────────────────────────────────────

export const GROUP_COLORS: Record<TemplateGroupType, GroupColorSet> = {
  convention_centre: {
    card:           'bg-blue-500/10 hover:bg-blue-500/15',
    cardBorder:     'border-l-blue-500',
    badge:          'bg-blue-100 text-blue-700 border-blue-200',
    accent:         'blue',
    dndHighlight:   'ring-blue-400',
    glassContainer: 'bg-blue-500/5 backdrop-blur-xl border border-blue-500/20 shadow-[0_8px_32px_rgba(59,130,246,0.15)]',
    glassHeader:    'bg-gradient-to-r from-blue-600/90 to-blue-500/80 backdrop-blur-md border-b border-blue-400/30',
  },
  exhibition_centre: {
    card:           'bg-emerald-500/10 hover:bg-emerald-500/15',
    cardBorder:     'border-l-emerald-500',
    badge:          'bg-emerald-100 text-emerald-700 border-emerald-200',
    accent:         'emerald',
    dndHighlight:   'ring-emerald-400',
    glassContainer: 'bg-emerald-500/5 backdrop-blur-xl border border-emerald-500/20 shadow-[0_8px_32px_rgba(16,185,129,0.15)]',
    glassHeader:    'bg-gradient-to-r from-emerald-600/90 to-emerald-500/80 backdrop-blur-md border-b border-emerald-400/30',
  },
  theatre: {
    card:           'bg-red-500/10 hover:bg-red-500/15',
    cardBorder:     'border-l-red-500',
    badge:          'bg-red-100 text-red-700 border-red-200',
    accent:         'red',                    // ← RED — never purple
    dndHighlight:   'ring-red-400',
    glassContainer: 'bg-red-500/5 backdrop-blur-xl border border-red-500/20 shadow-[0_8px_32px_rgba(239,68,68,0.15)]',
    glassHeader:    'bg-gradient-to-r from-red-600/90 to-red-500/80 backdrop-blur-md border-b border-red-400/30',
  },
  the_cutaway: {                              // ← "Warmest white" — warm amber/cream
    card:           'bg-amber-500/10 hover:bg-amber-500/15',
    cardBorder:     'border-l-amber-500',
    badge:          'bg-amber-100 text-amber-700 border-amber-200',
    accent:         'amber',
    dndHighlight:   'ring-amber-400',
    glassContainer: 'bg-amber-500/5 backdrop-blur-xl border border-amber-500/20 shadow-[0_8px_32px_rgba(245,158,11,0.15)]',
    glassHeader:    'bg-gradient-to-r from-amber-600/90 to-amber-500/80 backdrop-blur-md border-b border-amber-400/30',
  },
};

/** Colour set for shifts/groups that have no group_type (orphan/unassigned) */
export const UNASSIGNED_COLORS: GroupColorSet = {
  card:           'bg-gray-500/10 hover:bg-gray-500/15',
  cardBorder:     'border-l-gray-500',
  badge:          'bg-gray-100 text-gray-700 border-gray-200',
  accent:         'gray',
  dndHighlight:   'ring-gray-400',
  glassContainer: 'bg-gray-500/5 backdrop-blur-xl border border-gray-500/30 border-dashed shadow-[0_8px_32px_rgba(107,114,128,0.15)]',
  glassHeader:    'bg-gradient-to-r from-gray-600/90 to-gray-500/80 backdrop-blur-md border-b border-gray-400/30',
};

// ── Group metadata ─────────────────────────────────────────────────────────────

export const GROUP_DISPLAY_NAMES: Record<TemplateGroupType | 'unassigned', string> = {
  convention_centre: 'Convention Centre',
  exhibition_centre: 'Exhibition Centre',
  theatre:           'Theatre',
  the_cutaway:       'The Cutaway',
  unassigned:        'Unassigned',
};

export const ALL_GROUP_TYPES: TemplateGroupType[] = [
  'convention_centre',
  'exhibition_centre',
  'theatre',
  'the_cutaway',
];

// ── Level colour mapping ───────────────────────────────────────────────────────

/**
 * Returns Tailwind class string for a remuneration level badge.
 * Single source of truth — replaces the ad-hoc getLevelColor() in RolesModeView.
 */
export function levelColorClass(levelNumber: number): string {
  if (levelNumber >= 7) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  if (levelNumber >= 5) return 'bg-blue-500/10   text-blue-400   border-blue-500/20';
  if (levelNumber >= 3) return 'bg-cyan-500/10   text-cyan-400   border-cyan-500/20';
  return                       'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
}

// ── Avatars ────────────────────────────────────────────────────────────────────

export const UNASSIGNED_BUCKET_ID = 'unassigned-bucket';

export function dicebearUrl(seed: string, style: 'avataaars' | 'shapes' = 'avataaars'): string {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}
