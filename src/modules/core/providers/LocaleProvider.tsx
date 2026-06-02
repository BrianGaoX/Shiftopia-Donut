import React, { useEffect } from 'react';
import i18n from '@/platform/i18n';
import { useSettings } from '@/modules/settings/hooks/useSettings';

interface LocaleProviderProps {
  children: React.ReactNode;
}

export const LocaleProvider: React.FC<LocaleProviderProps> = ({ children }) => {
  const { orgBranding } = useSettings();

  useEffect(() => {
    if ((orgBranding as any)?.language) {
      i18n.changeLanguage((orgBranding as any).language);
    }
  }, [(orgBranding as any)?.language, i18n]);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.language) {
        i18n.changeLanguage(detail.language);
      }
    };

    window.addEventListener('branding-updated', handleUpdate);
    return () => window.removeEventListener('branding-updated', handleUpdate);
  }, [i18n]);

  return <>{children}</>;
};
