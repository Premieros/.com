import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { GuestEntryGate } from './features/qr/GuestEntryGate';
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

// BUNKER's printed branch QR opens its brand site. The order button uses
// ?bunker_order=1 to enter the existing QR ordering flow without redirecting back.
const isBunkerQr = window.location.hash.slice(5) === '3236a6be44494d89ba2b2a4e7c55fb140564f5a6ae5f4db7bcd7ace6eadeaf62' && window.location.hash.startsWith('#/qr/');
const redirectToBunker = isBunkerQr && new URLSearchParams(window.location.search).get('bunker_order') !== '1';
if (redirectToBunker) {
  window.location.replace(new URL('bunker/', new URL(import.meta.env.BASE_URL, document.baseURI)).href);
} else {
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {window.location.hash.startsWith('#/qr/')
        ? <GuestEntryGate key={window.location.hash.slice(5)} token={window.location.hash.slice(5)} />
        : <Suspense fallback={<div role="status">جارٍ التحميل…</div>}><App /></Suspense>}
    </ErrorBoundary>
  </StrictMode>
);

}
