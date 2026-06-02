
import React from 'react';
import { Link } from 'react-router-dom';
import { Users, Settings, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { UserProfileProps } from './types';

const UserProfile: React.FC<UserProfileProps> = ({ user, isCollapsed, handleLogout }) => {
  // Determine online status (this could be dynamic based on user data)
  const isOnline = true;

  if (!user) return null;

  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                className={cn(
                  "w-full flex items-center gap-3 px-3 relative transition-all duration-200 hover:bg-muted/50", 
                  isCollapsed ? "justify-center" : "justify-start"
                )}
              >
                <div className="relative">
                  <Avatar className="h-8 w-8 ring-2 ring-background transition-transform duration-200 hover:scale-105">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <motion.div 
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                      isOnline ? "bg-green-500" : "bg-gray-400"
                    )}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                  />
                </div>
                {!isCollapsed && (
                  <div className="flex flex-col items-start overflow-hidden">
                    <span className="text-sm font-medium truncate">{user.name}</span>
                    <span className="text-xs text-muted-foreground truncate">{user.role}</span>
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={isCollapsed ? "right" : "top"}>Profile</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-start gap-2 p-2">
          <Avatar className="h-9 w-9">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">{user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
            <div className="flex items-center pt-1">
              <div className={cn(
                "h-2 w-2 rounded-full mr-1",
                isOnline ? "bg-green-500" : "bg-gray-400"
              )} />
              <span className="text-xs">{isOnline ? "Online" : "Offline"}</span>
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <Link to="/profile">
          <DropdownMenuItem className="cursor-pointer transition-colors hover:bg-accent/50">
            <Users className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
        </Link>
        <Link to="/settings">
          <DropdownMenuItem className="cursor-pointer transition-colors hover:bg-accent/50">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        </Link>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout ?? undefined}
          className="cursor-pointer transition-colors hover:bg-accent/50 hover:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserProfile;
