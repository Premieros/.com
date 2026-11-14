import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicQrMenu } from './features/qr/PublicQrMenu';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './mobile-layer-fix.css';

const App = lazy(() => import('./app/App'));

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI)).catch((err) => {
      console.warn('[ServiceWorker] Registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {window.location.hash.startsWith('#/qr/')
        ? <PublicQrMenu token={window.location.hash.slice(5)} />
        : <Suspense fallback={<div role="status">جارٍ التحميل…</div>}><App /></Suspense>}
    </ErrorBoundary>
  </StrictMode>
);
