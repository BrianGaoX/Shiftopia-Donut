// src/contexts/AuthContext.tsx
// DEBUG VERSION - Find exactly where it's hanging

import React, { createContext, useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';

export type Role = 'admin' | 'manager' | 'teamlead' | 'member';

export interface User {
  id: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string | null;
  fullName: string;
  email: string;
  systemRole: Role;
  employmentType: string;
  isActive: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const mapRole = (r: string | null): Role => {
  const map: Record<string, Role> = {
    admin: 'admin',
    manager: 'manager',
    team_lead: 'teamlead',
    team_member: 'member',
  };
  return map[(r || '').toLowerCase()] || 'member';
};

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Simple profile fetch with detailed logging
  const fetchProfile = async (userId: string): Promise<User | null> => {
    console.log('[Auth] fetchProfile START:', userId);
    console.log('[Auth] Supabase URL:', (supabase as any).supabaseUrl);

    try {
      console.log('[Auth] Making query...');

      // Use a simple fetch with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout after 5s')), 5000);
      });

      const queryPromise = supabase
        .from('profiles')
        .select(
          'id, employee_code, first_name, last_name, full_name, email, legacy_system_role, employment_type, is_active'
        )
        .eq('id', userId)
        .single();

      const { data, error: err } = (await Promise.race([
        queryPromise,
        timeoutPromise,
      ])) as any;

      console.log(
        '[Auth] Query complete. Error:',
        err?.message,
        'Data:',
        !!data
      );

      if (err) {
        console.error('[Auth] Query error:', err);
        return null;
      }

      if (!data) {
        console.error('[Auth] No data returned');
        return null;
      }

      console.log('[Auth] Profile data:', JSON.stringify(data));

      return {
        id: data.id,
        employeeCode: data.employee_code,
        firstName: data.first_name || 'User',
        lastName: data.last_name,
        fullName: data.full_name || data.first_name || 'User',
        email: data.email,
        systemRole: mapRole(data.legacy_system_role),
        employmentType: data.employment_type || 'casual',
        isActive: data.is_active ?? true,
      };
    } catch (e: any) {
      console.error('[Auth] fetchProfile EXCEPTION:', e.message);
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;
    console.log('[Auth] useEffect START');

    const init = async () => {
      console.log('[Auth] init START');

      try {
        console.log('[Auth] Getting session...');
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();
        console.log(
          '[Auth] Session result:',
          session?.user?.email,
          'Error:',
          sessionErr?.message
        );

        if (!mounted) return;

        if (session?.user) {
          console.log('[Auth] Have session, fetching profile...');
          const profile = await fetchProfile(session.user.id);
          console.log('[Auth] Profile fetch complete:', profile?.email);

          if (mounted && profile) {
            setUser(profile);
          }
        }
      } catch (e: any) {
        console.error('[Auth] init ERROR:', e.message);
      } finally {
        console.log('[Auth] init DONE, setting isLoading=false');
        if (mounted) setIsLoading(false);
      }
    };

    init();

    // Simplified auth listener - only handle sign out
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      console.log('[Auth] onAuthStateChange:', event);
      if (event === 'SIGNED_OUT' && mounted) {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    console.log('[Auth] login START:', email);
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      console.log(
        '[Auth] signIn result:',
        data?.user?.email,
        'Error:',
        signInError?.message
      );

      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }

      if (data.user) {
        console.log('[Auth] Fetching profile after login...');
        const profile = await fetchProfile(data.user.id);
        console.log('[Auth] Profile after login:', profile?.email);

        if (!profile) {
          setError('Profile not found');
          await supabase.auth.signOut();
          throw new Error('Profile not found');
        }

        setUser(profile);
        console.log('[Auth] login SUCCESS');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  console.log('[Auth] render - isLoading:', isLoading, 'user:', user?.email);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, error, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};
