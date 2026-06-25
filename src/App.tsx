
import React from 'react';
import { ProviderWrapper, ErrorBoundary } from '@/modules/core';
import AppRouter from './router/AppRouter';
import { DevPerfOverlayGate } from '@/modules/core/ui/components/DevPerfOverlay';
import { useInstallPrompt } from '@/modules/core/hooks/useInstallPrompt';

const InstallBanner = () => {
  const { canInstall, triggerInstall } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 9999,
      background: '#1565C0', color: '#fff', borderRadius: 12,
      padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
    }}>
      <span>Install Shiftopia for quick access</span>
      <button onClick={triggerInstall} style={{
        background: '#fff', color: '#1565C0', border: 'none',
        borderRadius: 8, padding: '6px 14px', fontWeight: 600, cursor: 'pointer'
      }}>Install</button>
    </div>
  );
};

const App = () => (
  <ErrorBoundary module="App">
    <ProviderWrapper>
      <AppRouter />
      <InstallBanner />
      {/* Dev-only performance overlay — zero production cost (tree-shaken) */}
      <DevPerfOverlayGate />
    </ProviderWrapper>
  </ErrorBoundary>
);

export default App;
