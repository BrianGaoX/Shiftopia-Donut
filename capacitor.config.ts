import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shiftopia.app',
  appName: 'Shiftopia',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true,
      showSpinner: false,
    },
  },
};

export default config;
