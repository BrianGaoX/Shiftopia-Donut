import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Calendar,
  Fingerprint,
  CalendarDays,
  BadgeCheck,
  RefreshCw,
  Radio,
  BellRing,
  Menu,
  X,
  Gavel,
  ArrowLeftRight,
  ClipboardList,
  LayoutTemplate,
  Megaphone,
  BarChart3,
  Grid3x3,
  Users,
  ShieldCheck,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useEmployeeBroadcastGroups, useBroadcastNotifications } from '@/modules/broadcasts/state/useBroadcasts';
import { useAuth } from '@/platform/auth/useAuth';

const BottomNavbar: React.FC = () => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [isBottomDrawerActive, setIsBottomDrawerActive] = useState(false);
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkDrawer = () => {
      const activeElements = document.querySelectorAll('[data-state="open"], [data-vaul-drawer]');
      let found = false;
      
      activeElements.forEach((el) => {
        const className = el.className || '';
        const hasBottomClass = typeof className === 'string' && (
          className.includes('bottom-0') || 
          className.includes('slide-in-from-bottom') ||
          className.includes('inset-x-0')
        );
        const isVaulDrawer = el.hasAttribute('data-vaul-drawer') || el.closest('[data-vaul-drawer]') !== null;
        
        if (hasBottomClass || isVaulDrawer) {
          found = true;
        }
      });
      
      setIsBottomDrawerActive(found);
    };

    checkDrawer();

    const observer = new MutationObserver(() => {
      checkDrawer();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'class', 'data-vaul-drawer'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isBottomDrawerActive) {
      setMoreOpen(false);
    }
  }, [isBottomDrawerActive]);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Smooth scroll active item into view
  useEffect(() => {
    if (scrollContainerRef.current) {
      setTimeout(() => {
        const activeItem = scrollContainerRef.current?.querySelector('.nav-item-active');
        if (activeItem) {
          activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }, 100);
    }
  }, [location.pathname]);

  // UNREAD COUNTS INTEGRATION
  const { user } = useAuth();
  const { groups: broadcastGroups } = useEmployeeBroadcastGroups();
  const { unreadCount: notificationsUnread } = useBroadcastNotifications();

  const broadcastsUnread = useMemo(() => 
    broadcastGroups.reduce((acc, g) => acc + (g.unreadCount || 0), 0),
    [broadcastGroups]
  );

  const getBadgeCount = (key?: string) => {
    if (key === 'broadcasts') return broadcastsUnread;
    if (key === 'notifications') return notificationsUnread;
    return 0;
  };

  const middleItems = [
    { label: 'Roster', icon: Calendar, path: '/my-roster' },
    { label: 'Atten', icon: Fingerprint, path: '/my-attendance' },
    { label: 'Avail', icon: CalendarDays, path: '/my-availabilities' },
    { label: 'Bids', icon: BadgeCheck, path: '/my-bids' },
    { label: 'Swaps', icon: RefreshCw, path: '/my-swaps' },
    { label: 'Radio', icon: Radio, path: '/my-broadcasts', badgeKey: 'broadcasts' },
    { label: 'Notif', icon: BellRing, path: '/my-notifications', badgeKey: 'notifications' },
  ];

  const moreItems = [
    { label: 'Manager Bids',  Icon: Gavel,          path: '/management/bids' },
    { label: 'Manager Swaps', Icon: ArrowLeftRight,  path: '/management/swaps' },
    { label: 'Timesheets', Icon: ClipboardList,   path: '/timesheet' },
    { label: 'Templates',  Icon: LayoutTemplate,  path: '/templates' },
    { label: 'Broadcast',  Icon: Megaphone,       path: '/broadcast' },
    { label: 'Insights',   Icon: BarChart3,       path: '/insights' },
    { label: 'Grid',       Icon: Grid3x3,         path: '/grid' },
    { label: 'Users',      Icon: Users,           path: '/users' },

    { label: 'Settings',   Icon: Settings,        path: '/settings' },
    { label: 'Perform',    Icon: TrendingUp,      path: '/performance' },
  ];

  const isMoreRouteActive = moreItems.some((item) => location.pathname.startsWith(item.path));

  // CSS-only expanding pill (no Framer Motion layout conflicts)
  const NavItem = ({ item }: { item: typeof middleItems[0] }) => (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        cn(
          "relative flex items-center justify-center h-full rounded-full transition-all duration-300 ease-out flex-shrink-0 overflow-hidden",
          isActive 
            ? "bg-foreground text-background shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_12px_rgba(255,255,255,0.05)] px-4 max-w-[150px] nav-item-active" 
            : "w-[48px] max-w-[48px] px-0 text-muted-foreground hover:bg-muted/50"
        )
      }
    >
      {({ isActive }) => {
        const badgeCount = getBadgeCount(item.badgeKey);
        
        return (
          <div className="flex items-center gap-2">
            <div className="relative">
              <item.icon className={cn("h-5 w-5 flex-shrink-0 transition-colors", isActive ? "text-background" : "text-muted-foreground")} strokeWidth={isActive ? 2.5 : 2} />
              {badgeCount > 0 && (
                <span className={cn(
                  "absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-black border-2",
                  isActive 
                    ? "bg-red-500 text-white border-foreground" 
                    : "bg-red-500 text-white border-card"
                )}>
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </div>
            
            <div className={cn(
               "overflow-hidden transition-all duration-300 ease-out flex items-center",
               isActive ? "max-w-[100px] opacity-100" : "max-w-0 opacity-0"
            )}>
              <span className="text-[11px] font-black uppercase tracking-[0.15em] whitespace-nowrap pt-[1px] block">
                {item.label}
              </span>
            </div>
          </div>
        );
      }}
    </NavLink>
  );

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            key="more-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[58] bg-background/40 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {moreOpen && (
          <motion.div
            key="more-panel"
            initial={{ opacity: 0, y: 30, scale: 0.95, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 20, scale: 0.95, filter: "blur(10px)" }}
            transition={{ 
              default: { type: 'spring', damping: 25, stiffness: 350 },
              filter: { type: 'tween', duration: 0.2, ease: 'easeOut' }
            }}
            className="fixed bottom-[110px] left-4 right-4 z-[59] rounded-[32px] bg-card/80 backdrop-blur-3xl border border-white/20 dark:border-white/10 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.3)] overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 dark:from-white/10 dark:to-white/0 pointer-events-none" />
            <div className="relative p-5">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-4 ml-1">
                Management & Tools
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {moreItems.map(({ label, Icon, path }) => {
                  const isActive = location.pathname.startsWith(path);
                  return (
                    <NavLink
                      key={path}
                      to={path}
                      className={({ isActive }) => cn(
                        'flex flex-col items-center justify-center gap-2 p-3.5 rounded-2xl transition-all duration-300',
                        isActive
                          ? 'bg-foreground text-background shadow-xl scale-105 rotate-1'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                      )}
                    >
                      <div className={cn('transition-all duration-300', isActive && 'scale-110 -translate-y-0.5')}>
                        <Icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
                      </div>
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-widest text-center leading-tight mt-1",
                        isActive ? "text-background" : "text-muted-foreground/80"
                      )}>
                        {label}
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.nav
        initial={{ y: 100, opacity: 0 }}
        animate={{ 
          y: isBottomDrawerActive ? 120 : 0, 
          opacity: isBottomDrawerActive ? 0 : 1 
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        style={{ pointerEvents: isBottomDrawerActive ? 'none' : 'auto' }}
        className="md:hidden fixed bottom-6 left-4 right-4 z-[60] h-[72px] bg-background/80 dark:bg-black/60 backdrop-blur-3xl border border-white/20 dark:border-white/10 shadow-[0_24px_40px_-10px_rgba(0,0,0,0.3)] rounded-[36px] flex items-center p-2 gap-2 overflow-hidden"
      >
        {/* SCROLLABLE TRACK */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 h-full overflow-x-auto no-scrollbar flex items-center justify-between px-3 relative"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {middleItems.map(item => <NavItem key={item.path} item={item} />)}
        </div>

        {/* DIVIDER */}
        <div className="w-px h-8 bg-border/40 rounded-full flex-shrink-0 mx-0.5" />

        {/* MORE TOGGLE (Pinned Right - Fixed Width) */}
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={cn(
            "relative flex items-center justify-center h-full w-[48px] rounded-full transition-all duration-300 flex-shrink-0 z-10",
            (moreOpen || isMoreRouteActive)
              ? "bg-foreground text-background shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_12px_rgba(255,255,255,0.05)]" 
              : "bg-card text-foreground shadow-sm hover:bg-muted"
          )}
        >
          {moreOpen ? <X className="h-5 w-5" strokeWidth={2.5} /> : <Menu className="h-5 w-5" strokeWidth={isMoreRouteActive ? 2.5 : 2} />}
        </button>
      </motion.nav>
    </>
  );
};

export default BottomNavbar;
