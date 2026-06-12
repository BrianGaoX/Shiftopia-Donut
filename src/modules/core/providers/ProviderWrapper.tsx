
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { AuthProvider } from '@/platform/auth/AuthProvider';
import { ScopeFilterProvider } from '@/platform/auth/ScopeFilterContext';
import { SearchProvider } from '@/modules/core/contexts/SearchContext';
import { ThemeProvider } from '@/modules/core/contexts/ThemeContext';
import { OrgSelectionProvider } from '@/modules/core/contexts/OrgSelectionContext';
import { RosterUIProvider } from '@/modules/rosters/contexts/RosterUIContext';
import { SidebarProvider } from '@/modules/core/ui/primitives/sidebar';
import { Toaster } from '@/modules/core/ui/primitives/toaster';
import { Toaster as Sonner } from '@/modules/core/ui/primitives/sonner';
import { LocaleProvider } from './LocaleProvider';

/**
 * Smart retry: skip immediately on 4xx client errors (auth failures, validation,
 * not-found) — retrying won't help. Allow up to 2 retries for network errors
 * and 5xx server errors with exponential back-off.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const status = (error as { status?: number })?.status;
  // 4xx = client error; no point retrying
  if (status && status >= 400 && status < 500) return false;
  return true;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:     shouldRetry,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000), // 1s → 2s → cap 10s
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: false,
    },
  },
});

interface ProviderWrapperProps {
  children: React.ReactNode;
}

const ProviderWrapper: React.FC<ProviderWrapperProps> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ScopeFilterProvider>
            <OrgSelectionProvider>
              <LocaleProvider>
                <ThemeProvider>
                  <SearchProvider>
                    <SidebarProvider defaultOpen={true}>
                      <div className="h-full w-full overflow-hidden">
                        <Toaster />
                        <Sonner />
                        <RosterUIProvider>
                           <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: false }}>
                            {children}
                          </BrowserRouter>
                        </RosterUIProvider>
                      </div>
                    </SidebarProvider>
                  </SearchProvider>
                </ThemeProvider>
              </LocaleProvider>
            </OrgSelectionProvider>
          </ScopeFilterProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default ProviderWrapper;

