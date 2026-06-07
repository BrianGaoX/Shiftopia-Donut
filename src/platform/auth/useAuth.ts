// src/hooks/useAuth.ts
// FIXED VERSION - Proper role checking with corrected role names

import { useContext } from 'react';
import { AuthContext, Role, AccessScope } from '@/platform/auth/AuthProvider';
import type { AccessLevel } from './types';

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  const {
    user,
    activeContract,
    activeContractId,
    setActiveContractId,
    activeCertificate,
    activeCertificateId,
    setActiveCertificateId,
    isLoading
  } = context;

  /* ============================================================
     Role Checking Helpers
     ============================================================ */

  // Check if user has a specific role (DEPRECATED: Use access level instead)
  const hasRole = (role: Role | Role[]): boolean => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.systemRole);
  };

  // Helper to get the current resolved access level
  const getEffectiveLevel = (): AccessLevel => {
    // 1. Priority: Active Certificate (Type X/Y)
    if (activeCertificate?.accessLevel) {
      return activeCertificate.accessLevel;
    }

    // 2. Superuser Fallback (delta+)
    if (['delta', 'epsilon', 'zeta'].includes(user?.highestAccessLevel || '')) {
      return user!.highestAccessLevel;
    }

    // 3. Baseline: Position Contract
    return activeContract?.accessLevel || 'alpha';
  };

  // Check if active contract OR certificate is delta, epsilon or zeta
  const isAdmin = (): boolean =>
    ['delta', 'epsilon', 'zeta'].includes(getEffectiveLevel());

  // Check if active contract OR certificate is gamma or above
  const isManagerOrAbove = (): boolean =>
    ['gamma', 'delta', 'epsilon', 'zeta'].includes(getEffectiveLevel());

  // Check if active contract OR certificate is beta or above
  const isTeamLeadOrAbove = (): boolean =>
    ['beta', 'gamma', 'delta', 'epsilon', 'zeta'].includes(getEffectiveLevel());

  /* ============================================================
     Role-aware Landing Page
     ============================================================ */

  // Where this user should land after login (or when a generic
  // "home"/"workspace" target is needed). Managers and above (gamma+)
  // go to the Roster Planner; everyone else to their My Roster view.
  // Mirrors the FeatureGate guard on the /rosters route.
  const getLandingPage = (): string =>
    isManagerOrAbove() ? '/rosters' : '/my-roster';

  /* ============================================================
     Feature Permission Checking
     ============================================================ */

  const hasPermission = (feature: string): boolean => {
    const level = getEffectiveLevel();

    // Define feature permissions based on AccessLevel
    const permissions: Record<string, AccessLevel[]> = {
      // Everyone (alpha+)
      'my-roster': ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      availabilities: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      bids: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      'my-swaps': ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      'my-broadcasts': ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      profile: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],

      // Beta and above
      'timesheet-view': ['beta', 'gamma', 'delta', 'epsilon', 'zeta'],

      // Gamma and above
      templates: ['gamma', 'delta', 'epsilon', 'zeta'],
      rosters: ['gamma', 'delta', 'epsilon', 'zeta'],
      'timesheet-edit': ['gamma', 'delta', 'epsilon', 'zeta'],
      management: ['gamma', 'delta', 'epsilon', 'zeta'],
      broadcast: ['gamma', 'delta', 'epsilon', 'zeta'],
      insights: ['gamma', 'delta', 'epsilon', 'zeta'],

      // Delta and above (Managers)
      audit: ['delta', 'epsilon', 'zeta'],
      configurations: ['delta', 'epsilon', 'zeta'],

      // Epsilon and above
      users: ['epsilon', 'zeta'],

      read: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      create: ['gamma', 'delta', 'epsilon', 'zeta'],
      update: ['gamma', 'delta', 'epsilon', 'zeta'],
      delete: ['delta', 'epsilon', 'zeta'],
    };

    const allowedLevels = permissions[feature];

    if (!allowedLevels) {
      // Unknown feature - default to delta/epsilon/zeta only
      console.warn(
        `[Auth] Unknown feature: ${feature}, defaulting to delta/epsilon/zeta only`
      );
      return ['delta', 'epsilon', 'zeta'].includes(level);
    }

    return allowedLevels.includes(level);
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
    user,
    activeContract,
    activeContractId,
    setActiveContractId,
    activeCertificateId,
    setActiveCertificateId,
    isLoading,
    hasRole,
    isAdmin,
    isManagerOrAbove,
    isTeamLeadOrAbove,
    getLandingPage,
    hasPermission,
    isEligibleForShift,
    checkWorkHourCompliance,
  };
};
