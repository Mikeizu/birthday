/* These two placeholders are replaced in dist/sw.js after the Vite build. */
const PRECACHE_FILES = __PRECACHE_FILES__;
const CACHE_NAME = 'impact23-shell-__CACHE_VERSION__';
const CACHE_PREFIX = 'impact23-shell-';
const PRECACHE_URLS = new Set(PRECACHE_FILES.map((path) => new URL(path, self.location.origin).href));

function isApi(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // An incomplete build must never be advertised as available offline.
    if (!PRECACHE_FILES.includes('/index.html')) throw new Error('Offline app shell is missing index.html.');
    for (const path of PRECACHE_FILES) {
      const url = new URL(path, self.location.origin);
      if (url.origin !== self.location.origin || isApi(url)) throw new Error('Only local app assets may be precached.');
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_FILES);
    // Updates deliberately wait. The app can request SKIP_WAITING after the
    // user chooses to install an update, avoiding an unexpected mid-edit swap.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function navigate(request) {
  let networkResponse;
  try {
    networkResponse = await fetch(request);
    if (networkResponse.ok) return networkResponse;
  } catch {
    // Fall through to the installed version's complete, immutable app shell.
  }
  const cache = await caches.open(CACHE_NAME);
  const shell = await cache.match('/index.html');
  if (shell) return shell;
  if (networkResponse) return networkResponse;
  // Defensive fallback if storage was evicted after this worker activated.
  return new Response('Impact23 is not available offline on this device yet. Reconnect once to download the app.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function asset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cacheControl = response.headers.get('Cache-Control') || '';
    // Never persist authenticated or explicitly private/no-store responses.
    if (response.ok && response.type !== 'opaque' && request.cache !== 'no-store' &&
      !request.headers.has('Authorization') && !/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl)) {
      try { await cache.put(request, response.clone()); } catch { /* Storage may be full or unavailable. */ }
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // API state is deliberately handled by the application, never this cache.
  // Cross-origin traffic is never cached, proxied, or fabricated by this worker.
  if (url.origin !== self.location.origin || isApi(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  const assetDestinations = new Set(['script', 'style', 'font', 'image', 'manifest', 'audio', 'video']);
  if (PRECACHE_URLS.has(url.href) || assetDestinations.has(request.destination)) event.respondWith(asset(request));
});
