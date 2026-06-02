import { LucideIcon } from 'lucide-react';

/* ============================================================
   THEME TYPES
   ============================================================ */
export type Theme = 'light' | 'dark';

/* ============================================================
   NAVIGATION TYPES
   ============================================================ */
export interface NavItemType {
  path: string;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
  description?: string;
  badge?: string;
  requiredFeature?: string;
}

export interface NavSectionType {
  title: string;
  icon: LucideIcon;
  color?: string;
  items: NavItemType[];
  requiredFeature?: string;
}

/* ============================================================
   COMPONENT PROPS
   ============================================================ */
export interface ThemeToggleProps {
  isCollapsed?: boolean;
  theme: Theme;
  onToggle: () => void;
}

export interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  path: string;
  active: boolean;
  indent?: boolean;
  sectionColor?: 'primary' | 'purple' | 'blue' | 'green' | 'amber';
}

export interface NavSectionProps {
  title: string;
  children: React.ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  collapsed?: boolean;
  sectionColor?: string;
}

export interface UserProfileProps {
  user: {
    name: string;
    role: string;
    avatar?: string;
    email?: string;
  } | null;
  isCollapsed?: boolean;
  handleLogout?: () => void;
}

export interface LogoSectionProps {
  isCollapsed?: boolean;
}
