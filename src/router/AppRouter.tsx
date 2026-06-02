import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import AppLayout from '@/modules/core/ui/layout/AppLayout';
import { useAuth } from '@/platform/auth/useAuth';
import { MobileAccessGuard } from '@/modules/core/ui/components/MobileAccessGuard';
import { ErrorBoundary } from '@/modules/core';

/* =======================
   EAGER LOADED PAGES
   ======================= */
import Index from '@/modules/core/pages/Index';
import LoginPage from '@/modules/auth/pages/LoginPage';

/* =======================
   LAZY LOADED PAGES
   ======================= */
// Admin / Auth Utilities
const UnauthorizedPage = lazy(() => import('@/modules/auth/pages/UnauthorizedPage.tsx'));
const PendingAccessPage = lazy(() => import('@/modules/auth/pages/PendingAccessPage.tsx'));
const SignUpPage = lazy(() => import('@/modules/auth/pages/SignUpPage.tsx'));
const NotFound = lazy(() => import('@/modules/core/pages/NotFound.tsx'));


// My Workspace
const ProfilePage = lazy(() => import('@/modules/users/pages/ProfilePage.tsx'));
const MyRosterPage = lazy(() => import('@/modules/rosters/pages/MyRosterPage.tsx'));
const AvailabilityPage = lazy(() => import('@/modules/availability/pages/AvailabilityPage.tsx'));
const EmployeeBidsPage = lazy(() => import('@/modules/planning/bidding/ui/pages/EmployeeBids.page.tsx'));
const EmployeeSwapsPage = lazy(() => import('@/modules/planning/swapping/ui/pages/EmployeeSwaps.page.tsx'));
const MyBroadcastsPage = lazy(() => import('@/modules/broadcasts/ui/pages/MyBroadcastsPage.tsx'));
const AttendancePage = lazy(() => import('@/modules/rosters/pages/AttendancePage.tsx'));
const MyNotificationsPage = lazy(() => import('@/modules/core/pages/MyNotificationsPage.tsx'));

// Rostering
const TemplatesPage = lazy(() => import('@/modules/templates/pages/TemplatesPage'));
const RostersPlannerPage = lazy(() => import('@/modules/rosters/pages/RostersPlannerPage'));
const LaborDemandForecastingPage = lazy(() => import('@/modules/rosters/pages/LaborDemandForecastingPage'));
const TimesheetPage = lazy(() => import('@/modules/timesheets/ui/TimesheetPage'));

// Management
const ManagerBidsPage = lazy(() => import('@/modules/planning/bidding/ui/pages/ManagerBids.page.tsx'));
const ManagerSwapsPage = lazy(() => import('@/modules/planning/swapping/ui/pages/ManagerSwaps.page.tsx'));
const BroadcastManagerPage = lazy(() => import('@/modules/broadcasts/ui/pages/BroadcastsManager.page.tsx'));

// Features
const InsightsPage = lazy(() => import('@/modules/insights/pages/InsightsPage.tsx'));
const AnalysisPage = lazy(() => import('@/modules/insights/pages/AnalysisPage.tsx'));
const GridPage = lazy(() => import('@/modules/insights/pages/GridPage.tsx'));
const ComplianceRejectionsPage = lazy(() => import('@/modules/compliance/ui/pages/RejectionsPage.tsx'));
const UsersPage = lazy(() => import('@/modules/users/pages/UsersPage.tsx'));
const PerformancePage = lazy(() => import('@/modules/users/pages/PerformancePage.tsx'));

const SettingsPage = lazy(() => import('@/modules/settings/pages/SettingsPage.tsx'));

// Utility
const SearchPage = lazy(() => import('@/modules/search/pages/SearchPage.tsx'));

/* =======================
   LOADING FALLBACK
   ======================= */
const PageLoader: React.FC = () => (
    <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
    </div>
);

/* =======================
   ROUTES WHERE MAIN AREA HAS NO PADDING (fullscreen canvas pages)
   ======================= */
const NO_PADDING_ROUTES = new Set(['/rosters', '/settings']);

/* =======================
   PERSISTENT AUTH LAYOUT
   Renders once and stays mounted across all protected navigations.
   AppSidebar no longer remounts on every route change.
   ======================= */
const AuthLayout: React.FC = () => {
    const { user, isAuthenticated, isLoading, hasActiveContracts } = useAuth();
    const location = useLocation();
    const noPadding = NO_PADDING_ROUTES.has(location.pathname);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted-foreground text-sm">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (!hasActiveContracts) {
        return <Navigate to="/pending-access" replace />;
    }

    return (
        <AppLayout noPadding={noPadding}>
            <ErrorBoundary module="AuthLayout">
                <Suspense fallback={<PageLoader />}>
                    <Outlet />
                </Suspense>
            </ErrorBoundary>
        </AppLayout>
    );
};

/* =======================
   FEATURE GATE
   Optional per-route permission check — wraps child routes that need
   a specific feature permission. Redirects to /unauthorized if denied.
   ======================= */
const FeatureGate: React.FC<{ feature: string }> = ({ feature }) => {
    const { hasPermission } = useAuth();
    if (!hasPermission(feature)) {
        return <Navigate to="/unauthorized" replace />;
    }
    return <Outlet />;
};

/* =======================
   APP ROUTER
   ======================= */
const AppRouter: React.FC = () => {
    return (
        <Routes>
            {/* ================= Public ================= */}
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<Suspense fallback={<PageLoader />}><UnauthorizedPage /></Suspense>} />
            <Route path="/pending-access" element={<Suspense fallback={<PageLoader />}><PendingAccessPage /></Suspense>} />
            <Route path="/signup" element={<Suspense fallback={<PageLoader />}><SignUpPage /></Suspense>} />

            {/* ================= Protected (persistent layout) =================
                All child routes share ONE AppLayout + AppSidebar instance.
                Navigating between them no longer remounts the sidebar.
            ================= */}
            <Route element={<AuthLayout />}>

                {/* MobileAccessGuard: blocks non-workspace paths on mobile viewports */}
                <Route element={<MobileAccessGuard />}>


                    {/* ── My Workspace ── */}
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/my-roster" element={<MyRosterPage />} />
                    <Route path="/my-attendance" element={<AttendancePage />} />
                    <Route path="/my-availabilities" element={<AvailabilityPage />} />
                    <Route path="/my-bids" element={<EmployeeBidsPage />} />
                    <Route path="/my-swaps" element={<EmployeeSwapsPage />} />
                    <Route path="/my-notifications" element={<MyNotificationsPage />} />

                    <Route element={<FeatureGate feature="my-broadcasts" />}>
                        <Route path="/my-broadcasts" element={<MyBroadcastsPage />} />
                    </Route>

                    {/* ── Rostering ── */}
                    <Route element={<FeatureGate feature="templates" />}>
                        <Route path="/templates" element={<TemplatesPage />} />
                    </Route>

                    <Route element={<FeatureGate feature="rosters" />}>
                        <Route path="/rosters" element={<RostersPlannerPage />} />
                        <Route path="/labor-demand" element={<LaborDemandForecastingPage />} />
                    </Route>

                    <Route element={<FeatureGate feature="timesheet-view" />}>
                        <Route path="/timesheet" element={<TimesheetPage />} />
                    </Route>

                    {/* ── Management ── */}
                    <Route element={<FeatureGate feature="management" />}>
                        <Route path="/management/bids" element={<ManagerBidsPage />} />
                        <Route path="/management/swaps" element={<ManagerSwapsPage />} />
                        <Route path="/performance" element={<PerformancePage />} />

                    </Route>

                    {/* ── Broadcast ── */}
                    <Route element={<FeatureGate feature="broadcast" />}>
                        <Route path="/broadcast" element={<BroadcastManagerPage />} />
                    </Route>

                    {/* ── Insights ── */}
                    <Route element={<FeatureGate feature="insights" />}>
                        <Route path="/insights" element={<InsightsPage />} />
                        <Route path="/insights/:metricId" element={<AnalysisPage />} />
                        <Route path="/grid" element={<GridPage />} />
                    </Route>

                    {/* ── Compliance audit ── */}
                    <Route path="/compliance/rejections" element={<ComplianceRejectionsPage />} />


                    <Route element={<FeatureGate feature="users" />}>
                        <Route path="/users" element={<UsersPage />} />
                    </Route>

                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/:section" element={<SettingsPage />} />

                    {/* ── Utility ── */}
                    <Route path="/search" element={<SearchPage />} />

                </Route>{/* /MobileAccessGuard */}

            </Route>

            {/* ================= Catch All ================= */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

export default AppRouter;
