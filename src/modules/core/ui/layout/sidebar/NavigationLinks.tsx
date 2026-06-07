
import React from 'react';
import {
  Calendar,
  CalendarDays,
  BadgeCheck,
  Clock,
  FileSpreadsheet,
  PanelLeft,
  Workflow,
  Users,
  BellRing,
  Settings,
  TrendingUp,
  RefreshCw,
  ScrollText,
  BarChart3,
  ClipboardList,
  Fingerprint,
  Radio,
  Activity,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import NavItem from './NavItem';
import NavSection from './NavSection';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import { useTranslation } from 'react-i18next';

interface NavigationLinksProps {
  openMenus: { [key: string]: boolean };
  toggleMenu: (menu: string) => void;
}

const NavigationLinks: React.FC<NavigationLinksProps> = ({ openMenus, toggleMenu }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { hasPermission } = useAuth();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const isRouteActive = (path: string) => {
    if (path === location.pathname) return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <div className="flex-1 overflow-y-auto py-4 px-3">

      <NavSection
        title={t('nav.overview')}
        isOpen={openMenus['workspace']}
        onToggle={() => toggleMenu('workspace')}
        collapsed={isCollapsed}
        sectionColor="purple"
      >
        <NavItem
          icon={<Calendar className="h-5 w-5" />}
          label={t('nav.my_roster')}
          path="/my-roster"
          active={isRouteActive('/my-roster')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<CalendarDays className="h-5 w-5" />}
          label={t('nav.my_availabilities')}
          path="/my-availabilities"
          active={isRouteActive('/my-availabilities')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<Fingerprint className="h-5 w-5" />}
          label={t('nav.my_attendance')}
          path="/my-attendance"
          active={isRouteActive('/my-attendance')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<BadgeCheck className="h-5 w-5" />}
          label={t('nav.my_bids')}
          path="/my-bids"
          active={isRouteActive('/my-bids')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<RefreshCw className="h-5 w-5" />}
          label={t('nav.my_swaps')}
          path="/my-swaps"
          active={isRouteActive('/my-swaps')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<Radio className="h-5 w-5" />}
          label={t('nav.my_broadcasts')}
          path="/my-broadcasts"
          active={isRouteActive('/my-broadcasts')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<BellRing className="h-5 w-5" />}
          label={t('nav.my_notifications')}
          path="/my-notifications"
          active={isRouteActive('/my-notifications')}
          indent
          sectionColor="purple"
        />
      </NavSection>

      {(hasPermission('templates') || hasPermission('rosters') || hasPermission('timesheet-view')) && (
        <NavSection
          title={t('nav.rostering')}
          isOpen={openMenus['rostering']}
          onToggle={() => toggleMenu('rostering')}
          collapsed={isCollapsed}
          sectionColor="blue"
        >
          {hasPermission('templates') && (
            <NavItem
              icon={<Workflow className="h-5 w-5" />}
              label={t('nav.templates')}
              path="/templates"
              active={isRouteActive('/templates')}
              indent
              sectionColor="blue"
            />
          )}
          {hasPermission('rosters') && (
            <NavItem
              icon={<FileSpreadsheet className="h-5 w-5" />}
              label={t('nav.rosters')}
              path="/rosters"
              active={isRouteActive('/rosters')}
              indent
              sectionColor="blue"
            />
          )}
          {hasPermission('timesheet-view') && (
            <NavItem
              icon={<Clock className="h-5 w-5" />}
              label={t('nav.timesheet')}
              path="/timesheet"
              active={isRouteActive('/timesheet')}
              indent
              sectionColor="blue"
            />
          )}
          {hasPermission('rosters') && (
            <NavItem
              icon={<Activity className="h-5 w-5" />}
              label={t('nav.labor_demand', 'Labor Demand')}
              path="/labor-demand"
              active={isRouteActive('/labor-demand')}
              indent
              sectionColor="blue"
            />
          )}
        </NavSection>
      )}

      {hasPermission('management') && (
        <NavSection
          title={t('nav.management')}
          isOpen={openMenus['management']}
          onToggle={() => toggleMenu('management')}
          collapsed={isCollapsed}
          sectionColor="green"
        >
          <NavItem
            icon={<BadgeCheck className="h-5 w-5" />}
            label={t('nav.open_bids')}
            path="/management/bids"
            active={isRouteActive('/management/bids')}
            indent
            sectionColor="green"
          />

          <NavItem
            icon={<RefreshCw className="h-5 w-5" />}
            label={t('nav.swap_requests')}
            path="/management/swaps"
            active={isRouteActive('/management/swaps')}
            indent
            sectionColor="green"
          />
        </NavSection>
      )}

      {hasPermission('broadcast') && (
        <NavItem
          icon={<BellRing className="h-5 w-5" />}
          label={t('nav.broadcast')}
          path="/broadcast"
          active={isRouteActive('/broadcast')}
          sectionColor="amber"
        />
      )}

      {hasPermission('insights') && (
        <NavItem
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('nav.insights')}
          path="/insights"
          active={isRouteActive('/insights')}
          sectionColor="amber"
        />
      )}


      {hasPermission('management') && (
        <NavItem
          icon={<BarChart3 className="h-5 w-5" />}
          label={t('nav.performance')}
          path="/performance"
          active={isRouteActive('/performance')}
          sectionColor="green"
        />
      )}

      <div className="mt-auto pt-4 border-t border-border/20">
        <NavItem
          icon={<Settings className="h-5 w-5" />}
          label={t('common.settings')}
          path="/settings"
          active={isRouteActive('/settings')}
          sectionColor="blue"
        />
      </div>



    </div>
  );
};

export default NavigationLinks;
