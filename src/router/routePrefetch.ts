/**
 * Route chunk prefetch registry.
 *
 * Every page in AppRouter is `lazy(() => import(...))`, so the FIRST visit to a
 * route must fetch + parse its JS chunk before anything renders (you see the
 * Suspense <PageLoader/> meanwhile). Calling the SAME dynamic-import specifier
 * here — on nav hover — warms Vite's module cache so the click resolves the
 * chunk instantly instead of going to the network.
 *
 * The specifiers below MUST mirror the `lazy(() => import('…'))` calls in
 * `src/router/AppRouter.tsx`. Same specifier string ⇒ same chunk, so warming it
 * here is exactly the chunk `lazy()` will await on click.
 */

// Keyed by the route's `to` path used in the sidebar / NavLink.
const routeImporters: Record<string, () => Promise<unknown>> = {
  // ── My Workspace ──
  '/profile':            () => import('@/modules/users/pages/ProfilePage.tsx'),
  '/my-roster':          () => import('@/modules/rosters/pages/MyRosterPage.tsx'),
  '/my-attendance':      () => import('@/modules/rosters/pages/AttendancePage.tsx'),
  '/my-availabilities':  () => import('@/modules/availability/pages/AvailabilityPage.tsx'),
  '/my-bids':            () => import('@/modules/planning/bidding/ui/pages/EmployeeBids.page.tsx'),
  '/my-swaps':           () => import('@/modules/planning/swapping/ui/pages/EmployeeSwaps.page.tsx'),
  '/my-notifications':   () => import('@/modules/core/pages/MyNotificationsPage.tsx'),
  '/my-broadcasts':      () => import('@/modules/broadcasts/ui/pages/MyBroadcastsPage.tsx'),

  // ── Rostering ──
  '/templates':          () => import('@/modules/templates/pages/TemplatesPage'),
  '/rosters':            () => import('@/modules/rosters/pages/RostersPlannerPage'),
  '/rosters/shift/new':  () => import('@/modules/rosters/pages/ShiftFormPage'),
  '/labor-demand':       () => import('@/modules/rosters/pages/LaborDemandForecastingPage'),
  '/timesheet':          () => import('@/modules/timesheets/ui/TimesheetPage'),

  // ── Management ──
  '/management/bids':    () => import('@/modules/planning/bidding/ui/pages/ManagerBids.page.tsx'),
  '/management/swaps':   () => import('@/modules/planning/swapping/ui/pages/ManagerSwaps.page.tsx'),
  '/performance':        () => import('@/modules/users/pages/PerformancePage.tsx'),

  // ── Broadcast ──
  '/broadcast':          () => import('@/modules/broadcasts/ui/pages/BroadcastsManager.page.tsx'),

  // ── Insights ──
  '/insights':           () => import('@/modules/insights/pages/InsightsPage.tsx'),
  '/grid':               () => import('@/modules/insights/pages/GridPage.tsx'),

  // ── Other ──
  '/compliance/rejections': () => import('@/modules/compliance/ui/pages/RejectionsPage.tsx'),
  '/users':              () => import('@/modules/users/pages/UsersPage.tsx'),
  '/settings':           () => import('@/modules/settings/pages/SettingsPage.tsx'),
  '/search':             () => import('@/modules/search/pages/SearchPage.tsx'),
};

// Paths already warmed this session — avoids re-triggering import() on every
// hover (import() is idempotent, but this skips the redundant microtask churn).
const warmed = new Set<string>();

/**
 * Warm a route's lazy JS chunk. Safe to call repeatedly; no-ops after the first
 * successful prefetch. On failure we clear the flag so a later hover can retry.
 */
export function prefetchRouteChunk(path: string): void {
  const importer = routeImporters[path];
  if (!importer || warmed.has(path)) return;
  warmed.add(path);
  importer().catch(() => {
    warmed.delete(path);
  });
}
