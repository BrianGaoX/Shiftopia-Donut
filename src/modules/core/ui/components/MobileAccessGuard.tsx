/**
 * MobileAccessGuard
 *
 * Route-level guard that intercepts navigation on mobile devices.
 * If the user is on a mobile viewport AND the current path is NOT in the
 * ALLOWED_MOBILE_ROUTES allowlist, we render a full-screen "Desktop Only"
 * instruction page instead of the requested route.
 *
 * Integration: wrap restricted route groups with <MobileAccessGuard> in AppRouter.
 */

import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { Monitor, Wifi, ArrowRight, Layout, BarChart3, Users, Settings } from 'lucide-react';

// ── Allowlist ──────────────────────────────────────────────────────────────────
// These paths are fully optimised for mobile and pass through the guard.

export const ALLOWED_MOBILE_ROUTES = new Set([
  '/profile',
  '/my-roster',
  '/my-attendance',
  '/my-availabilities',
  '/my-bids',
  '/my-swaps',
  '/my-broadcasts',
  '/my-notifications',
  '/management/bids',
  '/management/swaps',
  '/templates',
  '/broadcast',
  '/labor-demand',
  '/performance',

  '/insights',
  '/grid',
  '/contracts',
  '/users',
  '/search',
  '/settings',
  '/timesheet',
]);

// ── Desktop-Only Screen ────────────────────────────────────────────────────────

const DESKTOP_FEATURES = [
  { icon: Layout,   label: 'Roster Planner',    desc: 'Drag-and-drop scheduling across teams' },
  { icon: BarChart3, label: 'Insights & Analytics', desc: 'Rich charts and workforce reports' },
  { icon: Users,    label: 'Team Management',   desc: 'Contracts, permissions, and user admin' },
  { icon: Settings, label: 'Configuration',     desc: 'Org settings, templates, and integrations' },
];

function DesktopOnlyScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12 text-center relative overflow-hidden">

      {/* Ambient background glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[100px] rounded-full pointer-events-none" />

      {/* Icon */}
      <div className="relative mb-8">
        <div className="h-24 w-24 rounded-[2rem] bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shadow-2xl shadow-primary/10">
          <Monitor className="h-10 w-10 text-primary" strokeWidth={1.5} />
        </div>
        <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
          <Wifi className="h-3 w-3 text-amber-500" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-3xl font-black tracking-tight text-foreground mb-3">
        Desktop Required
      </h1>
      <p className="text-sm text-muted-foreground max-w-[300px] leading-relaxed mb-10">
        This section is optimised for larger screens. Please open it on a desktop or laptop for the best experience.
      </p>

      {/* Feature pills */}
      <div className="w-full max-w-sm space-y-3 mb-10">
        {DESKTOP_FEATURES.map(({ icon: Icon, label, desc }) => (
          <div
            key={label}
            className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-border text-left"
          >
            <div className="h-9 w-9 rounded-xl bg-background border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-black text-foreground tracking-tight leading-none mb-1">{label}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0 ml-auto" />
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
        Your workspace is available below
      </p>
    </div>
  );
}

// ── Guard (Outlet wrapper) ─────────────────────────────────────────────────────

const MobileAccessGuard: React.FC = () => {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();

  const isAllowed = ALLOWED_MOBILE_ROUTES.has(pathname)
    || pathname.startsWith('/insights/');

  if (isMobile && !isAllowed) {
    return <DesktopOnlyScreen />;
  }

  return <Outlet />;
};

export { MobileAccessGuard, DesktopOnlyScreen };
