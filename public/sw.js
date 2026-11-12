/**
 * Premier ERP / POS Service Worker
 * Provides offline App Shell loading while explicitly preserving live
 * transaction semantics for all API and Supabase communication.
 */

const CACHE_NAME = 'premier-app-shell-v2-dev'; // __PREMIER_BUILD_CACHE__
const BUILD_ASSETS = []; // __PREMIER_BUILD_ASSETS__
const SCOPE = new URL(self.registration.scope);
const SCOPED_CACHE_NAME = SCOPE.pathname === '/' ? CACHE_NAME : `${CACHE_NAME}:${SCOPE.pathname}`;
const scopedPath = (asset) => new URL(asset.replace(/^\//, ''), SCOPE).pathname;

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/app-icon.svg',
  '/manifest.webmanifest',
  ...BUILD_ASSETS,
].map(scopedPath);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SCOPED_CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            const inScope = SCOPE.pathname === '/' ? !name.includes(':') : name.endsWith(`:${SCOPE.pathname}`);
            if (name.startsWith('premier-app-shell-') && inScope && name !== SCOPED_CACHE_NAME) {
              return caches.delete(name);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Do not intercept other origins (including cloud API, CDN, analytics).
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE.pathname)) return;

  // 1. Only intercept GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 2. CRITICAL EXCLUSION: Never cache Supabase API, Auth, REST, or Realtime requests
  if (
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/realtime') ||
    url.hostname.includes('supabase.co')
  ) {
    return;
  }

  // 3. Navigation requests (HTML document): Network-first with cache fallback.
  // SPA routes load their lazy modules from the versioned BUILD_ASSETS precache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SCOPED_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match(scopedPath('/index.html'));
          return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // 4. Static assets (JS, CSS, fonts, SVG, webmanifest): Stale-While-Revalidate
  const isStaticAsset =
    url.pathname.startsWith(scopedPath('/assets/')) ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname === scopedPath('/manifest.webmanifest');

  if (isStaticAsset) {
    event.respondWith(
      caches.open(SCOPED_CACHE_NAME).then(async (cache) => {
        // Vite assets are immutable build files. Browsers send different
        // Accept/Vary request headers for module scripts, preload and CSS.
        // Match the same-origin asset by its exact pathname regardless of
        // those headers; never use this for API/auth/business data.
        const cachedResponse = await cache.match(url.pathname, { ignoreVary: true });
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              const clone = networkResponse.clone();
              caches.open(SCOPED_CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
