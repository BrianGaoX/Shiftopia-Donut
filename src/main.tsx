import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './modules/core/styles/theme.css';
import './platform/i18n';
import { initSentry } from './platform/observability/sentry';
import { SplashScreen } from '@capacitor/splash-screen';

initSentry();

createRoot(document.getElementById('root')!).render(<App />);

SplashScreen.hide();
