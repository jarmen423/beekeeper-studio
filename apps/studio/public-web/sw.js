const CACHE = 'bks-shell-__BUILD__';
const SHELL = ['/index.html', '/manifest.webmanifest', '/icons/192.png', '/icons/512.png', '/icons/maskable.png', /* ASSETS */];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bks-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || /^\/(api|ws)(\/|$)/.test(url.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(async response => {
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        const cache = await caches.open(CACHE);
        await cache.put('/index.html', response.clone());
      }
      return response;
    }).catch(() => caches.match('/index.html')));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(async response => {
      if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    })));
  }
});
