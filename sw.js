// sw.js - Service Worker for Droplet PWA
// Version bumped to v4 to force cache refresh after fixes

const CACHE_NAME = 'droplet-v4';

// Files to cache on first install.
// IMPORTANT: Only list files that ACTUALLY exist in your repo.
const ASSETS_TO_CACHE = [
  // Core pages
  '/',
  '/index.html',
  '/offline.html',

  // PWA metadata (matches index.html <link rel="manifest">)
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

  // === Core document converters ===
  '/pdf-to-word.html',
  '/word-to-pdf.html',
  '/pdf-to-txt.html',
  '/epub-to-pdf.html',
  '/txt-to-pdf.html',
  '/pdf-to-pdfa.html',
  '/pdf-to-powerpoint.html',
  '/pdf-to-excel.html',

  // === Image converters ===
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

  // === Data tools ===
  '/json-to-csv.html',
  '/csv-to-json.html',
  '/xml-to-json.html',

  // === PDF Organize ===
  '/merge-pdf.html',
  '/split-pdf.html',
  '/remove-pages.html',
  '/extract-pages.html',
  '/organize-pdf.html',
  '/scan-to-pdf.html',
  '/rotate-pdf.html',
  '/add-page-numbers.html',

  // === PDF Intelligence ===
  '/ai-summarizer.html',
  '/translate-pdf.html',
  '/pdf-to-markdown.html',

  // === PDF Editing & Security ===
  '/add-watermark.html',
  '/crop-pdf.html',
  '/edit-pdf.html',
  '/pdf-forms.html',

  // === Convert to PDF ===
  '/powerpoint-to-pdf.html',
  '/excel-to-pdf.html',
  '/html-to-pdf.html',

  // === Info pages ===
  '/about.html',
  '/privacy.html',
  '/terms.html',
  '/faq.html'
];

// ============================================
// INSTALL — cache assets
// ============================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        // addAll() fails silently if ANY file 404s → use individual adds
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================
// ACTIVATE — clean up old caches
// ============================================
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

// ============================================
// FETCH — cache-first for HTML/CSS/JS, network-first for others
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http schemes
  if (!request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Return cached response if found
      if (cachedResponse) return cachedResponse;

      // Otherwise fetch from network
      return fetch(request)
        .then((response) => {
          // Don't cache invalid responses
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }

          // Clone BEFORE we return — response body can only be read once
          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // Offline fallback for HTML page requests
          const accept = request.headers.get('accept') || '';
          if (accept.includes('text/html')) {
            return caches.match('/offline.html');
          }
          // For non-HTML, return an empty 503
          return new Response('Offline — please check your connection.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
    })
  );
});

// ============================================
// MESSAGE — allow page to trigger SW update
// ============================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
