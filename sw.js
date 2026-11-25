/* Droplet: cache pages and resources after use; online services still need internet. */
const CACHE = 'droplet-site-2026-11-25-v11';
const CORE = ['/', '/offline', '/faq', '/contact', '/assets/home.css', '/assets/site-ui.css', '/assets/site-ui.js', '/assets/droplet-fixes.css', '/assets/home.js', '/assets/theme.js', '/assets/droplet-runtime.js', '/favicon-96x96.png', '/site.webmanifest'];
const LIBRARY_HOSTS = new Set(['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com']);
const MAX_ENTRIES = 150;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(CORE.map(url => cache.add(url)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('droplet-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
async function keep(request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  const keys = await cache.keys();
  const protectedPaths = new Set(CORE.map(path => new URL(path, self.location.origin).href));
  let extra = keys.length - MAX_ENTRIES;
  for (const key of keys) {
    if (extra <= 0) break;
    if (!protectedPaths.has(key.url)) { await cache.delete(key); extra--; }
  }
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;
  const library = LIBRARY_HOSTS.has(url.hostname) && /\.(?:js|mjs|wasm|css)(?:$|\?)/.test(url.pathname);
  if (!local && !library) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      event.waitUntil(keep(request, response).catch(() => {}));
      return response;
    }).catch(async () => await caches.match(request, { ignoreSearch: true }) || await caches.match('/offline') || new Response('You are offline. Reconnect to open this tool.', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
    return;
  }
  // Revalidate editable UI code; immutable vendor files keep the fast offline cache.
  if(local && /\.(?:js|css)$/.test(url.pathname) && !url.pathname.startsWith('/assets/vendor/')) {
    event.respondWith(fetch(request).then(response=>{event.waitUntil(keep(request,response).catch(()=>{}));return response;}).catch(async()=>await caches.match(request)||Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    event.waitUntil(keep(request, response).catch(() => {}));
    return response;
  })));
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
