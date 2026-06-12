import { memo, useState } from 'react';
import { useLocation, NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { biddingApi, swapsApi } from '@/modules/planning';
import { prefetchRouteChunk } from '@/router/routePrefetch';
import {
  Calendar,
  Clock,
  Users,
  Workflow,
  CalendarDays,
  FileSpreadsheet,
  BellRing,
  BadgeCheck,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  HelpCircle,
  Settings,
  TrendingUp,
  UserCircle2,
  Shield,
  FolderKanban,
  Sparkles,
  Radio,
  LucideIcon,
  ClipboardList,
  FileText,
  LogOut,
  Activity,
  BarChart3,
  Grid3x3,
  Fingerprint,
} from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ThemeSelector } from '@/modules/core/ui/components/ThemeSelector';
import { useNotifications } from '@/modules/core/hooks/useNotifications';
import { ACCESS_LEVEL_CONFIG } from '@/platform/auth/constants';
import { SidebarUser } from './SidebarUser';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/modules/core/ui/primitives/collapsible';
import { useTranslation } from 'react-i18next';

/* ============================================================
   ICON COLOR MAP
   ============================================================ */
type IconColorKey =
  | 'workspace'
  | 'myRoster'
  | 'availabilities'
  | 'myBids'
  | 'mySwaps'
  | 'myBroadcasts'
  | 'attendance'
  | 'templates'
  | 'rosters'
  | 'timesheet'
  | 'openBids'
  | 'swapRequests'
  | 'broadcast'
  | 'insights'
  | 'notifications'

  | 'management'
  | 'sectionMyWorkspace'
  | 'sectionRostering'
  | 'sectionManagement'
  | 'sectionFeatures'
  | 'logo'
  | 'help'
  | 'contracts'
  | 'laborDemand'
  | 'performance';

const iconColorMap: Record<IconColorKey, string> = {
  workspace: 'text-purple-400',
  myRoster: 'text-cyan-400',
  availabilities: 'text-teal-400',
  myBids: 'text-pink-400',
  mySwaps: 'text-orange-400',
  myBroadcasts: 'text-rose-400',
  attendance: 'text-emerald-400',
  templates: 'text-sky-400',
  rosters: 'text-indigo-400',
  timesheet: 'text-amber-400',
  openBids: 'text-green-400',
  swapRequests: 'text-rose-400',
  broadcast: 'text-red-400',
  insights: 'text-yellow-400',
  notifications: 'text-orange-400',

  management: 'text-lime-400',
  sectionMyWorkspace: 'text-purple-400',
  sectionRostering: 'text-blue-400',
  sectionManagement: 'text-green-400',
  sectionFeatures: 'text-amber-400',
  logo: 'text-white',
  help: 'text-blue-400',
  contracts: 'text-violet-400',
  laborDemand: 'text-fuchsia-400',
  performance: 'text-emerald-400',
};

/* ============================================================
   NAVIGATION ITEM COMPONENT
   ============================================================ */
interface NavigationItemProps {
  to: string;
  icon: LucideIcon;
  iconColor: string;
  label: string;
  isActive: boolean;
  badge?: string;
  description?: string;
  onMouseEnter?: () => void;
}

const NavigationItem = memo<NavigationItemProps>(
  ({ to, icon: Icon, iconColor, label, isActive, badge, description, onMouseEnter }) => (
    <NavLink
      to={to}
      onMouseEnter={() => {
        // Warm the route's lazy JS chunk so the click resolves instantly
        // instead of hitting the network for the Suspense fallback.
        prefetchRouteChunk(to);
        // Optional per-route data prefetch (bids/swaps) still runs.
        onMouseEnter?.();
      }}
      onFocus={() => {
        // Same warm-up for keyboard / tab navigation (no hover event).
        prefetchRouteChunk(to);
        onMouseEnter?.();
      }}
      className={cn(
        'group flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 relative overflow-hidden',
        isActive
          ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary border border-primary/20 shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute left-0 top-0 h-full w-1 bg-primary rounded-r-full" />
      )}

      {/* Icon */}
      <Icon
        className={cn(
          'h-6 w-6 transition-transform duration-200 group-hover:scale-110',
          iconColor,
          isActive ? 'drop-shadow' : ''
        )}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-center text-base">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {badge}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {description}
          </p>
        )}
      </div>

      {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
    </NavLink>
  )
);

NavigationItem.displayName = 'NavigationItem';

/* ============================================================
   COLLAPSIBLE SECTION COMPONENT
   ============================================================ */
interface CollapsibleSectionProps {
  icon: LucideIcon;
  title: string;
  color?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  icon: Icon,
  title,
  color = 'text-primary',
  children,
  defaultOpen = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-1">
      <CollapsibleTrigger className="flex items-center w-full group py-1 px-2 rounded-lg hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 flex-1 px-[25px]">
          <Icon className={cn('h-5 w-5', color)} />
          <span className="uppercase tracking-wider text-muted-foreground font-semibold text-sm">
            {title}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground/50 transition-transform duration-200",
            isOpen ? "rotate-0" : "-rotate-90"
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-1 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="pt-1 pb-2">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};


/* ============================================================
   APP SIDEBAR COMPONENT
   ============================================================ */
const AppSidebar: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, hasPermission, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const queryClient = useQueryClient();

  // Helper function to check if a route is active
  const isRouteActive = (path: string): boolean => {
    if (path === location.pathname) return true;
    if (path !== '/' && location.pathname.startsWith(path))
      return true;
    return false;
  };

  // Prefetching logic for predictive loading
  const handlePrefetch = (route: string) => {
    switch (route) {
      case '/my-bids':
        if (user?.id) {
          queryClient.prefetchQuery({
            queryKey: ['bids', 'employee', user.id],
            queryFn: () => biddingApi.getMyBids(user.id),
          });
        }
        break;
      case '/management/bids':
        queryClient.prefetchQuery({
          queryKey: ['bids'],
          queryFn: biddingApi.getAllBids,
        });
        break;
      case '/my-swaps':
        if (user?.id) {
          queryClient.prefetchQuery({
            queryKey: ['swapRequests', 'my', user.id],
            queryFn: () => swapsApi.getMySwaps(user.id),
          });
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className="h-screen w-[280px] flex flex-col bg-card/95 backdrop-blur-sm border-r border-border/50 shadow-lg">
      {/* ==================== HEADER ==================== */}
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-md">
            <Sparkles className={cn('h-6 w-6', iconColorMap.logo)} />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
              ShiftoPia <span className="text-[8px] text-primary/40 tracking-tight ml-2 font-light">v9.0</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Workforce Management
            </p>
          </div>
        </div>
      </div>

      {/* ==================== NAVIGATION ==================== */}
      <div className="flex-1 overflow-y-auto space-y-4 py-4 px-[15px]">

        {/* ---------- Work Section ---------- */}
        <CollapsibleSection
          icon={UserCircle2}
          title={t('nav.work', 'Work')}
          color={iconColorMap.sectionMyWorkspace}
          defaultOpen={true}
        >
          <NavigationItem
            to="/my-roster"
            icon={Calendar}
            iconColor={iconColorMap.myRoster}
            label={t('nav.my_roster')}
            isActive={isRouteActive('/my-roster')}
            description="Your assigned shifts"
          />

          <NavigationItem
            to="/my-attendance"
            icon={Fingerprint}
            iconColor={iconColorMap.attendance}
            label={t('nav.my_attendance')}
            isActive={isRouteActive('/my-attendance')}
            description="Clock in & out"
          />

          <NavigationItem
            to="/my-availabilities"
            icon={CalendarDays}
            iconColor={iconColorMap.availabilities}
            label={t('nav.my_availabilities')}
            isActive={isRouteActive('/my-availabilities')}
            description="Manage your schedule"
          />
        </CollapsibleSection>

        {/* ---------- Requests Section ---------- */}
        <CollapsibleSection
          icon={BadgeCheck}
          title={t('nav.requests', 'Requests')}
          color={iconColorMap.myBids}
          defaultOpen={true}
        >
          <NavigationItem
            to="/my-bids"
            icon={BadgeCheck}
            iconColor={iconColorMap.myBids}
            label={t('nav.my_bids')}
            isActive={isRouteActive('/my-bids')}
            description="Shift bid requests"
            onMouseEnter={() => handlePrefetch('/my-bids')}
          />

          <NavigationItem
            to="/my-swaps"
            icon={RefreshCw}
            iconColor={iconColorMap.mySwaps}
            label={t('nav.my_swaps')}
            isActive={isRouteActive('/my-swaps')}
            description="Manage shift swaps"
            onMouseEnter={() => handlePrefetch('/my-swaps')}
          />
        </CollapsibleSection>

        {/* ---------- Communication Section ---------- */}
        <CollapsibleSection
          icon={BellRing}
          title={t('nav.communication', 'Communication')}
          color={iconColorMap.myBroadcasts}
          defaultOpen={true}
        >
          <NavigationItem
            to="/my-broadcasts"
            icon={Radio}
            iconColor={iconColorMap.myBroadcasts}
            label={t('nav.my_broadcasts')}
            isActive={isRouteActive('/my-broadcasts')}
            description="View announcements"
          />

          <NavigationItem
            to="/my-notifications"
            icon={BellRing}
            iconColor={iconColorMap.notifications}
            label={t('nav.my_notifications')}
            isActive={isRouteActive('/my-notifications')}
            badge={unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : undefined}
            description="View workspace updates"
          />
        </CollapsibleSection>

        {/* ---------- Rostering Section ---------- */}
        {(hasPermission('templates') ||
          hasPermission('rosters') ||
          hasPermission('timesheet-view')) && (
            <CollapsibleSection
              icon={FolderKanban}
              title={t('nav.rostering')}
              color={iconColorMap.sectionRostering}
              defaultOpen={true}
            >
              {hasPermission('templates') && (
                <NavigationItem
                  to="/templates"
                  icon={Workflow}
                  iconColor={iconColorMap.templates}
                  label={t('nav.templates')}
                  isActive={isRouteActive('/templates')}
                  description="Shift templates"
                />
              )}

              {hasPermission('rosters') && (
                <NavigationItem
                  to="/rosters"
                  icon={FileSpreadsheet}
                  iconColor={iconColorMap.rosters}
                  label={t('nav.rosters')}
                  isActive={isRouteActive('/rosters')}
                  description="Manage schedules"
                />
              )}

              {hasPermission('rosters') && (
                <NavigationItem
                  to="/labor-demand"
                  icon={Activity}
                  iconColor={iconColorMap.laborDemand}
                  label={t('nav.labor_demand')}
                  isActive={isRouteActive('/labor-demand')}
                  description="Demand forecasting"
                />
              )}

              {hasPermission('timesheet-view') && (
                <NavigationItem
                  to="/timesheet"
                  icon={Clock}
                  iconColor={iconColorMap.timesheet}
                  label={t('nav.timesheet')}
                  isActive={isRouteActive('/timesheet')}
                  description="Time tracking"
                />
              )}
            </CollapsibleSection>
          )}

        {/* ---------- Management Section ---------- */}
        {hasPermission('management') && (
          <CollapsibleSection
            icon={Shield}
            title={t('nav.management')}
            color={iconColorMap.sectionManagement}
            defaultOpen={true}
          >
            <NavigationItem
              to="/management/bids"
              icon={BadgeCheck}
              iconColor={iconColorMap.openBids}
              label={t('nav.open_bids')}
              isActive={isRouteActive('/management/bids')}
              description="Review bid requests"
              onMouseEnter={() => handlePrefetch('/management/bids')}
            />

            <NavigationItem
              to="/management/swaps"
              icon={RefreshCw}
              iconColor={iconColorMap.swapRequests}
              label={t('nav.swap_requests')}
              isActive={isRouteActive('/management/swaps')}
              description="Approve shift swaps"
            />
          </CollapsibleSection>
        )}

        {/* ---------- Features Section ---------- */}
        {(hasPermission('broadcast') ||
          hasPermission('insights') ||
          hasPermission('management')) && (
            <CollapsibleSection
              icon={Sparkles}
              title={t('nav.features')}
              color={iconColorMap.sectionFeatures}
              defaultOpen={true}
            >
              {hasPermission('broadcast') && (
                <NavigationItem
                  to="/broadcast"
                  icon={BellRing}
                  iconColor={iconColorMap.broadcast}
                  label={t('nav.broadcast')}
                  isActive={isRouteActive('/broadcast')}
                  description="Send notifications"
                />
              )}

              {hasPermission('insights') && (
                <NavigationItem
                  to="/insights"
                  icon={TrendingUp}
                  iconColor={iconColorMap.insights}
                  label={t('nav.insights')}
                  isActive={isRouteActive('/insights')}
                  description="Analytics & reports"
                />
              )}

              {hasPermission('management') && (
                <NavigationItem
                  to="/performance"
                  icon={BarChart3}
                  iconColor={iconColorMap.performance}
                  label={t('nav.performance')}
                  isActive={isRouteActive('/performance')}
                  description="Quarterly metrics"
                />
              )}
            </CollapsibleSection>
          )}

        {/* ---------- Admin Section ---------- */}
        {(hasPermission('insights') || hasPermission('management')) && (
          <CollapsibleSection
            icon={Shield}
            title={t('common.admin')}
            color={iconColorMap.sectionManagement}
            defaultOpen={true}
          >
            {hasPermission('insights') && (
              <NavigationItem
                to="/grid"
                icon={Grid3x3}
                iconColor={iconColorMap.insights}
                label={t('nav.grid')}
                isActive={isRouteActive('/grid')}
                description="Annual Shift Grid"
              />
            )}

            {hasPermission('management') && (
              <NavigationItem
                to="/users"
                icon={Users}
                iconColor={iconColorMap.contracts}
                label={t('nav.users')}
                isActive={isRouteActive('/users')}
                description="Manage users"
              />
            )}
          </CollapsibleSection>
        )}


      </div>

      {/* ==================== FOOTER ==================== */}
      <div className="p-4 border-t border-border/50 space-y-4">
        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <ThemeSelector />
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="rounded-full h-10 w-10 hover:bg-white/5 text-slate-400 hover:text-white transition-all"
          >
            <NavLink to="/settings" title={t('common.settings')}>
              <Settings className="h-5 w-5" />
            </NavLink>
          </Button>
        </div>

        <Separator className="bg-border/30" />

        {/* User Profile */}
        <SidebarUser />
      </div>
    </div>
  );
};

export default AppSidebar;
