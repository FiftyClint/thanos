/**
 * Service worker for the Thanos Program PWA.
 *
 * Two caches with different rules:
 *   - the app shell and hashed build assets are cached and served offline;
 *   - GET API responses are network-first with a cached fallback, so an offline
 *     phone still shows the day's program and your last logged numbers.
 *
 * Writes are NOT handled here. They go through the IndexedDB queue in
 * src/lib/offlineQueue.ts, which survives the tab closing — a background sync
 * in the worker would not.
 */

const VERSION = 'v2';
const SHELL_CACHE = `thanos-shell-${VERSION}`;
const DATA_CACHE = `thanos-data-${VERSION}`;

const SHELL_ASSETS = ['/', '/manifest.json', '/favicon.png'];

/** API GETs worth keeping a copy of for offline reading. */
const CACHEABLE_API = [/^\/api\/exercises/, /^\/api\/user$/, /^\/api\/workouts/, /^\/api\/sets\/previous/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // A single missing asset must not fail the whole install.
      Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== SHELL_CACHE && name !== DATA_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isCacheableApi(pathname) {
  return CACHEABLE_API.some((pattern) => pattern.test(pathname));
}

/** Network first, falling back to the last good copy. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      // Marked so the UI can tell live data from a cached copy.
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', 'true');
      return new Response(cached.body, { status: cached.status, headers });
    }
    return new Response(JSON.stringify({ error: 'Offline and no cached copy available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Serve from cache immediately, refresh in the background. */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  if (request.mode === 'navigate') {
    const shell = await caches.match('/');
    if (shell) return shell;
  }
  return new Response('Offline', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache another origin, or a photo (they are private and large).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/objects/')) return;

  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApi(url.pathname)) {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/** Lets the page trigger an immediate update instead of waiting for a reload. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
