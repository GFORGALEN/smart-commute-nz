/* Static manual-mode shell only. Never cache Google Maps/Places responses or routes. */
const CACHE = 'smart-commute-shell-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', './favicon.svg']))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('smart-commute-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  if (url.pathname.includes('/assets/') || /\.(svg|png|webmanifest)$/.test(url.pathname)) {
    // These are public, versioned app assets. Preview servers add Vary: Origin;
    // precache fetches and module/style requests can send different Origin headers.
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(event.request, { ignoreVary: true }))
        .then(
          (cached) =>
            cached ||
            fetch(event.request).then((response) => {
              if (response.ok) {
                const copy = response.clone();
                void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
              }
              return response;
            }),
        ),
    );
  } else if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(event.request, { ignoreVary: true });
        return cached || cache.match(new URL('index.html', self.registration.scope).href);
      }),
    );
  }
});
