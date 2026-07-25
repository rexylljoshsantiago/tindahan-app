const CACHE_NAME = 'tindahan-v14';
const APP_SHELL = ['./index.html', './styles.css', './app.js', './manifest.json'];
const STATIC_ASSETS = ['./icon-192.png', './icon-512.png'];
const ASSETS = [...APP_SHELL, ...STATIC_ASSETS];

// Cache the app shell as soon as the service worker installs
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Clean up old caches when a new version activates
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isAppShellRequest(url){
  return APP_SHELL.some(path => url.pathname.endsWith(path.replace('./','/')));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // App shell (html/js/css): network-first. This is the fix for "forgot to
  // bump the cache version" — as long as the user is online they always get
  // the latest code; the cache only kicks in when offline.
  if (event.request.mode === 'navigate' || isAppShellRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Only cache genuinely successful responses — never a 404/500/error
          // page. Caching a failed response here is what let a broken deploy
          // get "stuck" as the offline fallback even after the real site was fixed.
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Icons/static assets: cache-first, refresh in background. These change
  // rarely, so instant-from-cache is worth more than always-fresh here.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
