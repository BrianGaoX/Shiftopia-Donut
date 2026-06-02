import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Button } from '@/modules/core/ui/primitives/button';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/modules/core/ui/primitives/dropdown-menu';
import { SearchBar } from '../components/SearchBar';
import { BroadcastNotifications } from '../components/broadcast/BroadcastNotifications';
import { ThemeSelector } from '../components/ThemeSelector';
import { NavBreadcrumb } from '../components/NavBreadcrumb';
import { Menu, Bell, User, Search, LogOut, Settings } from 'lucide-react';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { toggleSidebar, state } = useSidebar();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-50 w-full flex-shrink-0 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 md:mr-2"
                  onClick={toggleSidebar}
                  aria-label="Toggle sidebar"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">{state === "collapsed" ? "Expand" : "Collapse"} Sidebar</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {state === "collapsed" ? "Expand" : "Collapse"} Sidebar
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <div className="hidden md:block">
            <NavBreadcrumb />
          </div>
        </div>

        <div className="hidden md:block flex-1 max-w-md mx-4">
          <SearchBar />
        </div>

        <nav className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-11 w-11 flex" onClick={() => navigate('/search')}>
                    <span className="sr-only">Search</span>
                    <Search className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Search
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <ThemeSelector />
            
            {user && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <BroadcastNotifications />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Notifications
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {user ? (
            <DropdownMenu>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="rounded-full">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar} alt={user.name} />
                          <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                        </Avatar>
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Profile Menu
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenuContent className="w-56 bg-popover/95 backdrop-blur-sm" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">Login</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/register">Register</Link>
              </Button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
