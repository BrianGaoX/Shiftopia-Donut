// src/platform/auth/AuthProvider.tsx
// Certificate-driven auth with Type X/Y permission model

import React, { createContext, useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { User, AccessLevel, Role, UserContract, AccessCertificate, PermissionObject } from './types';
import { authService } from './auth.service';
import { hasAccess as checkAccess } from './access.policy';

// Re-export types for backward compatibility with existing imports
export type { User, AccessLevel, Role };
export type { UserContract, AccessCertificate, PermissionObject } from './types';

/**
 * AccessScope represents the organizational boundaries derived from the user's
 * Access Certificate (NOT Position Contract). This determines what data the user
 * can view/edit across the application.
 */
export interface AccessScope {
  organizationId: string | null;
  organizationName: string;
  departmentId: string | null;
  departmentName: string | null;
  subDepartmentId: string | null;
  subDepartmentName: string | null;
  accessLevel: AccessLevel;
  isOrgLocked: boolean;
  isDeptLocked: boolean;
  isSubDeptLocked: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /** True if the user has at least one active contract */
  hasActiveContracts: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasAccess: (feature: string, subDeptId?: string) => boolean;
  activeContractId: string | null;
  activeContract: UserContract | null;
  setActiveContractId: (id: string | null) => void;
  /** The user's highest-level access certificate (determines data scope) */
  activeCertificate: AccessCertificate | null;
  /** Active certificate ID for manual switching */
  activeCertificateId: string | null;
  /** Setter for manual certificate switching */
  setActiveCertificateId: (id: string | null) => void;
  /** Derived access scope from the certificate - use this for data filtering */
  accessScope: AccessScope | null;
  /** Full permission object from resolve_user_permissions RPC */
  permissionObject: PermissionObject | null;
  /** Whether permissions are still loading */
  isPermissionsLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [activeCertificateId, setActiveCertificateId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionObject, setPermissionObject] = useState<PermissionObject | null>(null);
  const [isPermissionsLoading, setIsPermissionsLoading] = useState(false);

  // Profile fetch delegate
  const fetchProfile = async (userId: string): Promise<User | null> => {
    return authService.getUserProfile(userId);
  };

  // Fetch resolved permissions from RPC
  const fetchPermissions = async () => {
    setIsPermissionsLoading(true);
    try {
      const permissions = await authService.fetchPermissions();
      if (permissions) {
        setPermissionObject(permissions);
        console.log('[Auth] Permissions loaded:', {
          typeX: permissions.typeX?.length || 0,
          typeY: permissions.typeY?.level || 'none',
          orgs: permissions.allowed_scope_tree?.organizations?.length || 0,
        });
      }
    } catch (e: any) {
      console.error('[Auth] Permission fetch error:', e.message);
    } finally {
      setIsPermissionsLoading(false);
    }
  };

  /**
   * Centralized feature access check
   * Delegates to AccessPolicy
   */
  const hasAccess = (feature: string, subDeptId?: string): boolean => {
    return checkAccess(user, feature, activeContract, activeCertificate);
  };

  useEffect(() => {
    let mounted = true;
    console.log('[Auth] useEffect START');

    const init = async () => {
      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.user) {
          const profile = await fetchProfile(session.user.id);

          if (mounted && profile) {
            setUser(profile);
          }
        }
      } catch (e: any) {
        console.error('[Auth] init ERROR:', e.message);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    init();

    // Simplified auth listener - only handle sign out
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && mounted) {
        setUser(null);
        setPermissionObject(null);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch permissions when user is loaded
  useEffect(() => {
    if (user) {
      fetchPermissions();
    } else {
      setPermissionObject(null);
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }

      if (data.user) {
        const profile = await fetchProfile(data.user.id);

        if (!profile) {
          setError('Profile not found');
          await supabase.auth.signOut();
          throw new Error('Profile not found');
        }

        setUser(profile);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
    }
    setUser(null);
    setActiveContractId(null);
    setActiveCertificateId(null);
    setPermissionObject(null);
  };

  // Auto-select first active contract if none selected
  useEffect(() => {
    if (user && user.contracts.length > 0 && !activeContractId) {
      const firstActive = user.contracts.find(c => c.status === 'Active') || user.contracts[0];
      if (firstActive) {
        setActiveContractId(firstActive.id);
      }
    }
  }, [user, activeContractId]);

  // Derived active contract object
  const activeContract = user?.contracts.find(c => c.id === activeContractId) || null;

  // Derive hasActiveContracts (Access allowed if Contracts OR Certificates exist)
  const hasActiveContracts = (user?.contracts?.length ?? 0) > 0 || (user?.certificates?.length ?? 0) > 0;

  // Find the user's active access certificate
  const activeCertificate: AccessCertificate | null = React.useMemo(() => {
    if (!user || user.certificates.length === 0) return null;

    // 1. If manual selection exists, use it
    if (activeCertificateId) {
      const selected = user.certificates.find(c => c.id === activeCertificateId);
      if (selected) return selected;
    }

    // 2. Fallback to highest access level certificate
    const levels: AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

    let highest: AccessCertificate | null = null;
    let highestIdx = -1;

    user.certificates.forEach(cert => {
      const idx = levels.indexOf(cert.accessLevel);
      if (idx > highestIdx) {
        highestIdx = idx;
        highest = cert;
      }
    });

    return highest;
  }, [user, activeCertificateId]);

  // Derive access scope from the certificate or fallback to allowed_scope_tree
  const accessScope: AccessScope | null = React.useMemo(() => {
    // 1. Primary source: Active Certificate
    if (activeCertificate) {
      return {
        organizationId: activeCertificate.organizationId,
        organizationName: activeCertificate.organizationName || 'Organization',
        departmentId: activeCertificate.departmentId,
        departmentName: activeCertificate.departmentName || null,
        subDepartmentId: activeCertificate.subDepartmentId,
        subDepartmentName: activeCertificate.subDepartmentName || null,
        accessLevel: activeCertificate.accessLevel,
        isOrgLocked: true,
        isDeptLocked: activeCertificate.departmentId !== null,
        isSubDeptLocked: activeCertificate.subDepartmentId !== null,
      };
    }

    // 2. Secondary source: Fallback to first organization in permission tree (for administrative global access)
    // Only if the user has Zeta/Epsilon permissions (Type Y equivalents)
    const firstOrg = permissionObject?.allowed_scope_tree?.organizations?.[0];
    if (firstOrg && (permissionObject?.typeY || (permissionObject?.typeX?.length ?? 0) > 0)) {
      return {
        organizationId: firstOrg.id,
        organizationName: firstOrg.name,
        departmentId: null,
        departmentName: null,
        subDepartmentId: null,
        subDepartmentName: null,
        accessLevel: permissionObject.typeY?.level || 'alpha',
        isOrgLocked: false,
        isDeptLocked: false,
        isSubDeptLocked: false,
      };
    }

    return null;
  }, [activeCertificate, permissionObject]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        error,
        hasActiveContracts,
        login,
        logout,
        hasAccess,
        activeContractId,
        activeContract,
        setActiveContractId,
        activeCertificate,
        activeCertificateId,
        setActiveCertificateId,
        accessScope,
        permissionObject,
        isPermissionsLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
