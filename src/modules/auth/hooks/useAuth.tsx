// src/hooks/useAuth.ts
// FIXED VERSION - Proper role checking with corrected role names

import { useContext } from 'react';
import { AuthContext, Role } from '@/platform/auth/AuthProvider';

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  const { user } = context;

  /* ============================================================
     Role Checking Helpers
     ============================================================ */

  // Check if user has a specific role
  const hasRole = (role: Role | Role[]): boolean => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.systemRole);
  };

  // Check if user is admin
  const isAdmin = (): boolean => user?.systemRole === 'admin';

  // Check if user is manager or above
  const isManagerOrAbove = (): boolean => hasRole(['admin', 'manager']);

  // Check if user is team lead or above
  const isTeamLeadOrAbove = (): boolean =>
    hasRole(['admin', 'manager', 'teamlead']);

  /* ============================================================
     Feature Permission Checking
     ============================================================ */

  const hasPermission = (feature: string): boolean => {
    if (!user) return false;

    const role = user.systemRole;

    // Define feature permissions
    const permissions: Record<string, Role[]> = {
      // Everyone can access
      'my-roster': ['admin', 'manager', 'teamlead', 'member'],
      availabilities: ['admin', 'manager', 'teamlead', 'member'],
      bids: ['admin', 'manager', 'teamlead', 'member'],
      'my-swaps': ['admin', 'manager', 'teamlead', 'member'],
      'my-broadcasts': ['admin', 'manager', 'teamlead', 'member'],
      profile: ['admin', 'manager', 'teamlead', 'member'],

      // Manager and above
      templates: ['admin', 'manager'],
      rosters: ['admin', 'manager'],
      'timesheet-edit': ['admin', 'manager'],
      management: ['admin', 'manager'],
      broadcast: ['admin', 'manager', 'teamlead'],
      insights: ['admin', 'manager'],

      // Team lead and above
      'timesheet-view': ['admin', 'manager', 'teamlead'],
      // CRUD style permissions
      create: ['admin', 'manager'],
      read: ['admin', 'manager', 'teamlead', 'member'],
      update: ['admin', 'manager'],
      delete: ['admin'],

      // Admin only

    };

    const allowedRoles = permissions[feature];

    if (!allowedRoles) {
      // Unknown feature - default to admin only
      console.warn(
        `[Auth] Unknown feature: ${feature}, defaulting to admin only`
      );
      return role === 'admin';
    }

    return allowedRoles.includes(role);
  };

  /* ============================================================
     Shift Eligibility (placeholder for your business logic)
     ============================================================ */

  const isEligibleForShift = (
    shiftDepartment: string,
    shiftRole: string
  ): boolean => {
    if (!user) return false;

    // Admin can bid on any shift
    if (user.systemRole === 'admin') return true;

    // Add your business logic here
    return true;
  };

  /* ============================================================
     Work Hour Compliance (placeholder)
     ============================================================ */

  const checkWorkHourCompliance = (shiftDate: string, shiftHours: number) => {
    return {
      compliant: true,
      dailyHours: shiftHours,
      weeklyHours: shiftHours * 5,
      monthlyHours: shiftHours * 20,
      dailyLimit: 12,
      weeklyLimit: 48,
      monthlyLimit: 152,
    };
  };

  return {
    ...context,
    hasRole,
    isAdmin,
    isManagerOrAbove,
    isTeamLeadOrAbove,
    hasPermission,
    isEligibleForShift,
    checkWorkHourCompliance,
  };
};
