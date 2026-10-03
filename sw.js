// sw.js - Service Worker for Droplet PWA
// Cache version bumped to force refresh

const CACHE_NAME = 'droplet-v5';

// Only files that ACTUALLY exist in the repo.
// Missing files here will NOT break the service worker
// (we use Promise.allSettled instead of cache.addAll).
const ASSETS_TO_CACHE = [
  // Core pages
  '/',
  '/index.html',
  '/offline.html',

  // PWA metadata
  '/site.webmanifest',

  // Logos / images
  '/Gemini_Generated_Image_sdu6v7sdu6v7sdu6.jpg',
  '/Untitled design.png',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',

  // Core documents
  '/pdf-to-word.html',
  '/word-to-pdf.html',
  '/pdf-to-txt.html',
  '/epub-to-pdf.html',
  '/txt-to-pdf.html',
  '/pdf-to-pdfa.html',
  '/pdf-to-powerpoint.html',
  '/pdf-to-excel.html',

  // Image converters
  '/heic-to-jpg.html',
  '/webp-to-jpg.html',
  '/webp-to-png.html',
  '/avif-to-png.html',
  '/gif-to-png.html',
  '/psd-to-png.html',
  '/raw-to-jpg.html',
  '/tiff-to-pdf.html',
  '/jpg-to-pdf.html',
  '/pdf-to-jpg.html',
  '/svg-to-png.html',
  '/eps-to-svg.html',

  // Data tools
  '/json-to-csv.html',
  '/csv-to-json.html',
  '/xml-to-json.html',

  // PDF Organize
  '/merge-pdf.html',
  '/split-pdf.html',
  '/remove-pages.html',
  '/extract-pages.html',
  '/organize-pdf.html',
  '/scan-to-pdf.html',
  '/rotate-pdf.html',
  '/add-page-numbers.html',

  // PDF Intelligence
  '/ai-summarizer.html',
  '/translate-pdf.html',
  '/pdf-to-markdown.html',

  // PDF Editing & Security
  '/add-watermark.html',
  '/crop-pdf.html',
  '/edit-pdf.html',
  '/pdf-forms.html',

  // Convert to PDF
  '/powerpoint-to-pdf.html',
  '/excel-to-pdf.html',
  '/html-to-pdf.html',

  // Info pages
  '/about.html',
  '/privacy.html',
  '/terms.html',
  '/faq.html'
];

// INSTALL — cache files individually so one 404 doesn't break everything
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching files...');
        // Use allSettled + individual add() so missing files don't crash install
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// FETCH — network-first for HTML, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests
  if (!request.url.startsWith(self.location.origin)) return;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const isHTML = (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // NETWORK-FIRST for HTML pages (fixes stale cache issue)
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: try cache, then offline.html
          return caches.match(request).then(cached => cached || caches.match('/offline.html'));
        })
    );
  } else {
    // CACHE-FIRST for assets (images, CSS, JS)
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});

// MESSAGE — allow page to trigger SW update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
