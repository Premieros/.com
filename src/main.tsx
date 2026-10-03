import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './mobile-layer-fix.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ServiceWorker] Registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
