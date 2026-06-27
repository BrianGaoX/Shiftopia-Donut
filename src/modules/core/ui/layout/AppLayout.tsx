import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import AppSidebar from './sidebar/AppSidebar';
import BottomNavbar from './BottomNavbar';
import { cn } from '@/modules/core/lib/utils';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Sheet, SheetContent } from '@/modules/core/ui/primitives/sheet';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import { useTranslation } from 'react-i18next';

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, noPadding = false }) => {
  const { t } = useTranslation();
  const { state, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">

      {/* Mobile Sidebar Drawer */}
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="p-0 w-[280px] border-r border-border">
          <AppSidebar />
        </SheetContent>
      </Sheet>

      {/* Sidebar - Fixed position, slides in/out (desktop only) */}
      <div
        className={cn(
          "hidden md:block fixed left-0 top-0 h-screen z-40 transition-transform duration-300 ease-in-out",
          isCollapsed ? "-translate-x-full" : "translate-x-0"
        )}
      >
        <AppSidebar />
      </div>

      {/* Collapse Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => toggleSidebar()}
        className={cn(
          "hidden md:flex fixed top-4 z-[100] h-8 w-8 rounded-full bg-card border border-border/50 shadow-md hover:bg-muted transition-all duration-300",
          isCollapsed ? "left-4" : "left-[268px]"
        )}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      {/* Main Area */}
      <main
        className={cn(
          "flex-1 min-h-0 transition-all duration-300 ease-in-out",
          isCollapsed ? "md:ml-0" : "md:ml-[280px]",
          // Roster pages must not scroll at top level
          noPadding
            ? "p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] overflow-hidden bg-background md:pt-0 md:pb-0"
            // Normal pages scroll normally
            : "px-4 pb-32 pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:p-6 md:p-8 md:pb-8 overflow-auto bg-background bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"
        )}
      >
        {/* Critical Fix: use min-h-0 instead of h-full */}
        <div className="min-h-0 w-full h-full">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navbar */}
      <BottomNavbar />
    </div>
  );
};

export default AppLayout;
